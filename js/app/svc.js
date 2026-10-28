// 운행 계통(특급·급행·보통) 편집.
import { formatWon } from '../game/catalog.js';
import { opBadge, operatorOf } from '../game/operators.js';
import {
  canRun, defaultTrainType, lineStations, OPERATING, planService, removeService, SERVICE_KINDS, serviceBuyCost, startService, TRAIN_TYPES, tripsPerDay, updateService,
} from '../game/services.js';
import { effectiveNetwork, FREQ_STEPS, linkAt, linkPending, load, OP_FACTORS, save, startUpgrade } from '../game/state.js';
import { autoBrand } from '../game/trainnames.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { toast } from '../ui/panel.js';
import { base, esc, result, state } from './core.js';
import { allLinks, nodeCoord, nodeNames, refreshLinks } from './mapdata.js';
import { select } from './interact.js';
import { fmtMin } from './route.js';
import { renderAll } from './panels.js';
import { renderSelection } from './econ.js';
import { autoLocalTrains, fundSelect, serviceBrand, serviceOperator } from './operators.js';
import { routeThrough, sectionOf } from './pick.js';
import { drawServiceEdit, header, nextSvcColor, svcColor } from './svcmap.js';
import { popWithin } from './gazette.js';

// ------------------------------------------------------------ 운행 계통 (특급·급행·보통)

export let svcEdit = null;   // 편집 중인 계통 {line, cls, kind, name, trains, nodes: 노선 위 역 순서, stops: Set, id}
export function setSvcEdit(v) { return (svcEdit = v); }
export const SERVICE_DAY_MIN = 1440;   // 24시간 운행

export function railStationSet() {
  const s = new Set(base.stations.map(([, n]) => n));
  for (const n of state.newStations) s.add(n);
  for (const n of state.closedStations || []) s.delete(n);
  return s;
}

export function stationRiders() {
  const m = new Map();
  if (result) result.stations.node.forEach((nd, k) => m.set(nd, result.stations.riders[k]));
  return m;
}

/**
 * 등급별 기본 정차역: 보통은 모든 역, 급행·특급은 큰 역만 (양 끝은 늘 정차).
 * 지역 간 승하차 순위와 역세권 인구(반경 3km) 순위를 더한 점수로 큰 역부터 고르되,
 * 이미 고른 역과 너무 가까우면(특급 25km, 급행 8km) 건너뛴다. 정차역 수는 노선 길이로 정한다 (특급 약 45km, 급행 약 15km마다 한 역).
 * 그래서 대전·동대구처럼 큰 도시 역은 서고 수도권 역이 몰리지 않는다
 */
export function defaultStops(nodes, kind) {
  if (kind === 'local' || kind === 'commuter') return new Set(nodes);
  const r = stationRiders();
  const spacing = kind === 'express' ? 8 : 25, perKm = kind === 'express' ? 15 : 45;
  const coord = new Map(nodes.map((n) => [n, nodeCoord(n)]));
  const pop = new Map(nodes.map((n) => { const c = coord.get(n); return [n, c ? popWithin(c[0], c[1], 3) : 0]; }));
  const rank = (score) => {
    const sorted = [...nodes].sort((a, b) => score(b) - score(a));
    return new Map(sorted.map((n, i) => [n, 1 - i / nodes.length]));
  };
  const rr = rank((n) => r.get(n) || 0), rp = rank((n) => pop.get(n));
  const order = [...nodes].sort((a, b) => (rr.get(b) + rp.get(b)) - (rr.get(a) + rp.get(a)));
  let km = 0;
  for (let i = 1; i < nodes.length; i++) {
    const a = coord.get(nodes[i - 1]), b = coord.get(nodes[i]);
    if (a && b) km += kmBetween(a[0], a[1], b[0], b[1]);
  }
  const target = Math.min(nodes.length, Math.max(3, Math.round(km / perKm) + 1));
  const chosen = [nodes[0], nodes[nodes.length - 1]];
  const far = (n) => chosen.every((m) => { const a = coord.get(n), b = coord.get(m); return !a || !b || kmBetween(a[0], a[1], b[0], b[1]) >= spacing; });
  for (const n of order) {
    if (chosen.length >= target) break;
    if (!chosen.includes(n) && far(n)) chosen.push(n);
  }
  return new Set(chosen);
}

/** 여러 노선의 역을 이어 한 줄로 (경부선 → 평부선 → 평의선처럼 끝과 끝이 가까운 쪽으로 붙인다) */
export function chainStations(net, lines) {
  const set = railStationSet();
  let chain = lineStations(net, set, lines[0]);
  const xy = (n) => nodeCoord(n);
  const d = (a, b) => kmBetween(...xy(a), ...xy(b));
  for (const L of lines.slice(1)) {
    const st = lineStations(net, set, L);
    if (!st.length || !chain.length) { chain = chain.concat(st); continue; }
    const h = chain[0], t = chain[chain.length - 1], s0 = st[0], s1 = st[st.length - 1];
    const opts = [[d(t, s0), () => chain.concat(st)], [d(t, s1), () => chain.concat([...st].reverse())],
      [d(h, s1), () => st.concat(chain)], [d(h, s0), () => [...st].reverse().concat(chain)]];
    chain = opts.sort((x, y) => x[0] - y[0])[0][1]();
  }
  return chain.filter((n, k) => chain.indexOf(n) === k);
}

/** 계통 끝 역 가까이(5km)에서 시작하는 다른 노선들 (이어 갈 수 있는 노선) */
/** 계통 양 끝(5km 안)에서 이어지는 다른 노선: [{ name, end: 0|1 }] (end는 어느 끝에서 이어지는지) */
export function connectableLines(net, e) {
  const ends = [e.nodes[0], e.nodes[e.nodes.length - 1]].map((n) => nodeCoord(n));
  const out = new Map();
  for (const l of net.links) {
    if (l.mode !== 1 || !l.active || l.via || !l.name || e.lines.includes(l.name) || l.ext || out.has(l.name)) continue;
    for (const n of [l.a, l.b]) {
      const c = nodeCoord(n);
      const k = c ? ends.findIndex((q) => kmBetween(q[0], q[1], c[0], c[1]) < 5) : -1;
      if (k >= 0) { out.set(l.name, k); break; }
    }
  }
  return [...out].map(([name, end]) => ({ name, end })).sort((a, b) => a.end - b.end || a.name.localeCompare(b.name));
}

/** 계통 양 끝의 방위 이름: 남북으로 길면 북단·남단, 동서로 길면 서단·동단 */
export function endLabels(e) {
  const a = nodeCoord(e.nodes[0]), b = nodeCoord(e.nodes[e.nodes.length - 1]);
  if (!a || !b) return ['한쪽 끝', '다른 끝'];
  if (Math.abs(a[1] - b[1]) >= Math.abs(a[0] - b[0]) * 0.8) return a[1] > b[1] ? ['북단', '남단'] : ['남단', '북단'];
  return a[0] < b[0] ? ['서단', '동단'] : ['동단', '서단'];
}

export function openServiceEditor(line, cls, id = null) {
  const net = effectiveNetwork(base, state);
  const s = id && state.services.find((x) => x.id === id);
  const lines = s?.lines || [line];
  // 이미 있는 계통은 정차역을 차례로 잇는 경로의 역들로 (여러 노선을 지나는 계통도 순서가 맞게)
  const nodes = (s && s.stops.length >= 2 && routeThrough(s.stops)?.nodes) || chainStations(net, lines);
  if (nodes.length < 2) { alert('이 노선에는 역이 둘 이상 있어야 운행 계통을 짤 수 있습니다.'); return; }
  const under = net.links.filter((l) => lines.includes(l.name) && l.mode === 1 && !l.via);
  svcEdit = s
    ? { line: lines[0], lines, cls, kind: s.kind, name: s.name, type: s.type || defaultTrainType(cls, under), sets: s.sets, nodes, stops: new Set(s.stops), id, nameEdited: true,
      color: svcColor(s, state.services.indexOf(s)) }
    : { line, lines, cls, kind: 'limited', name: `${line} ${SERVICE_KINDS.limited.label}`, type: defaultTrainType(cls, under), sets: 4, nodes, stops: defaultStops(nodes, 'limited'), id: null,
      color: nextSvcColor() };
  select({ type: 'service' });
}

/** 계통에 다른 노선을 이어 붙인다 (직통 운전) */
export function extendServiceLine(name) {
  const e = svcEdit;
  e.lines = [...e.lines, name];
  const before = new Set(e.nodes);
  e.nodes = chainStations(effectiveNetwork(base, state), e.lines);
  // 새로 붙은 역 가운데 큰 역은 기본으로 선다 (등급 기준)
  const add = defaultStops(e.nodes, e.kind);
  for (const n of e.nodes) if (!before.has(n) && add.has(n)) e.stops.add(n);
  if (!e.nameEdited) e.name = `${e.lines.map((x) => x.replace(/선$/, '')).join('·')} 직통 ${SERVICE_KINDS[e.kind].label}`;
  renderSelection();
}

export function servicePlan() {
  const stops = svcEdit.nodes.filter((n) => svcEdit.stops.has(n));
  const links = effectiveNetwork(base, state).links;
  const plan = stops.length >= 2 ? planService(links, railStationSet(), stops, svcEdit.kind, new Set(svcEdit.lines), svcEdit.type) : null;
  if (plan) plan.under = plan.segs.flatMap((sg) => sg.via.map((i) => links[i]));
  return { stops, plan };
}

export function servicePanel() {
  const e = svcEdit, nn = nodeNames(), r = stationRiders();
  const { stops, plan } = servicePlan();
  const cur = e.id ? state.services.find((x) => x.id === e.id) : null;
  const trains = plan ? tripsPerDay(e.sets, plan.runMin) : 0;
  const cost = serviceBuyCost(cur && { ...cur, type: cur.type || e.type }, { type: e.type, sets: e.sets });
  const runnable = (t) => !plan || canRun(t, plan.under);
  const typeOk = runnable(e.type);
  // 전동차를 막는 비전철 구간 (노선별 km): 바로 전철화를 벌일 수 있게
  const noPower = new Map(), noPowerIds = [];
  if (plan) {
    const links = effectiveNetwork(base, state).links, seen = new Set();
    for (const sg of plan.segs) for (const i of sg.via) {
      const l = links[i];
      if (seen.has(i) || !l || (l.power && l.power !== 'none')) continue;
      seen.add(i);
      if (i < base.links.length && linkPending(base, state, i)) continue;
      if (state.projects.some((pj) => pj.status === 'building' && pj.links.includes(i))) continue;
      noPowerIds.push(i);
      noPower.set(l.name || '이름 없는 선로', (noPower.get(l.name || '이름 없는 선로') || 0) + l.len);
    }
  }
  const powerHint = noPower.size ? `<p class="hint" style="color:#b54708">비전철 구간이 있어 전동차는 다닐 수 없습니다: ${[...noPower].map(([n, km]) => `${esc(n)} ${km.toFixed(0)}km`).join(', ')}.
    디젤 객차로 다니거나, 이 구간을 전철화하세요 (완공되면 전동차를 고를 수 있습니다).</p>
    <div class="actions"><button class="small" id="svc-electrify" data-ids="${JSON.stringify(noPowerIds)}">비전철 구간 전철화 (${noPowerIds.length}개 구간)</button></div>` : '';
  // 정차역은 지도에서 눌러 넣고 뺀다. 여기서는 순서대로 보여 주고 ×로 뺄 수 있게만
  const rows = stops.map((n) => `<span class="svc-stop" style="display:inline-flex;align-items:center;gap:2px;margin:2px 4px 2px 0;padding:1px 6px;border-radius:10px;background:var(--chip, #eef1f5)">
      ${esc(nn.get(n)?.name || `역 ${n}`)} <span class="m">${Math.round(r.get(n) || 0).toLocaleString()}</span><a href="#" data-unstop="${n}" title="정차 빼기" style="text-decoration:none">×</a></span>`).join('');
  return `${header(e.id ? `운행 계통: ${e.name}` : `${e.line} 운행 계통 짜기`)}
    <div class="name-row"><span class="kind">이름</span><input type="text" id="svc-name" value="${esc(e.name)}"></div>
    <div class="name-row"><span class="kind">노선 색</span><input type="color" id="svc-color" value="${esc(e.color)}">
      <span class="m">지도에 이 색으로 그립니다</span></div>
    <p class="hint"><b>지도에서 역을 누르면</b> 정차역을 넣고 뺍니다. 계통 밖의 역을 누르면 그 역까지 경로를 늘려 잇습니다.</p>
    ${e.underLink != null ? '<div class="actions"><button class="small" id="svc-under">이 자리 선로(구간) 보기</button></div>' : ''}
    <div class="name-row"><span class="kind">등급</span><select id="svc-kind">${Object.entries(SERVICE_KINDS)
      .map(([k, v]) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <span class="m">정차 방식·요금</span></div>
    <div class="name-row"><span class="kind">열차</span><select id="svc-type">${Object.entries(TRAIN_TYPES)
      .map(([k, v]) => `<option value="${k}" ${k === e.type ? 'selected' : ''} ${runnable(k) ? '' : 'disabled'}>${v.label}${runnable(k) ? '' : ' (비전철 구간 있음)'}</option>`).join('')}</select></div>
    <div class="name-row"><span class="kind">편성</span><input type="range" id="svc-sets" min="1" max="60" value="${e.sets}" style="flex:1">
      <b>${e.sets}편성</b></div>
    ${powerHint}
    <p class="hint">${TRAIN_TYPES[e.type].label}: 정원 ${TRAIN_TYPES[e.type].cap.toLocaleString()}명, 편성당 ${formatWon(TRAIN_TYPES[e.type].setCost)}. 편성을 늘리면 운행 횟수가 저절로 늘어납니다.</p>
    <table class="kv">
      <tr><td>정차역</td><td>${stops.length} / ${e.nodes.length}개</td></tr>
      ${plan ? `<tr><td>운행 거리 · 시간</td><td>${plan.km.toFixed(0)}km · ${fmtMin(plan.runMin)}</td></tr>
      <tr><td>표정 속도</td><td>${(plan.km / (plan.runMin / 60)).toFixed(0)} km/h</td></tr>
      <tr><td>하루 운행 (24시간)</td><td>${trains}회 · 한 방향 약 ${Math.max(1, Math.round(SERVICE_DAY_MIN / Math.max(1, trains / 2)))}분 간격</td></tr>
      <tr><td>하루 수송력</td><td>${(trains * TRAIN_TYPES[e.type].cap).toLocaleString()}명</td></tr>
      ${(() => {
        const st = e.id && svcStats().find((x) => x.s.id === e.id);
        if (!st) return `<tr><td>하루 이용객</td><td class="m">${e.id ? '다음 해 계산부터 나옵니다' : '운행을 시작하면 다음 해부터 나옵니다'}</td></tr>`;
        return `<tr><td>하루 이용객 (어림)</td><td>${Math.round(st.riders).toLocaleString()}명 <span class="m">평균 ${st.avgKm.toFixed(0)}km 탐</span></td></tr>
          <tr><td>가장 붐비는 구간 · 승차율</td><td>${Math.round(st.peak).toLocaleString()}명 · ${Math.round(st.load * 100)}%</td></tr>`;
      })()}
      <tr><td>차량 구입비</td><td>${cost ? formatWon(cost) : '없음'}${cur ? ` (보유 ${cur.sets}편성)` : ''}</td></tr>` : '<tr><td colspan="2">정차역을 둘 이상 고르세요.</td></tr>'}
    </table>
    <p class="hint">특급·급행은 고른 역에만 서서 통과역마다 정차 시간을 줄이고, 정차역의 배차 간격이 짧아집니다. 열차는 같은 선로 용량을 나눠 씁니다. 고친 내용은 다음 해부터 반영됩니다.</p>
    <div class="actions">
      <button class="small" data-svc-preset="local">모든 역</button><button class="small" data-svc-preset="express">큰 역 절반</button>
      <button class="small" data-svc-preset="limited">주요 역만</button></div>
    <div class="name-row"><span class="kind">노선</span><span>${e.lines.map(esc).join(' → ')}</span></div>
    ${(() => {
      const lab = endLabels(e), endName = [nn.get(e.nodes[0])?.name || '', nn.get(e.nodes[e.nodes.length - 1])?.name || ''];
      const c = connectableLines(effectiveNetwork(base, state), e);
      return `<div class="name-row"><span class="kind">구간</span><span>${lab[0]} ${esc(endName[0])} ↔ ${lab[1]} ${esc(endName[1])}</span></div>`
        + (c.length ? `<div class="name-row"><span class="kind">이어 가기</span>
      <select id="svc-ext">${c.map((x) => `<option value="${esc(x.name)}">${lab[x.end]} ${esc(endName[x.end])}에서 → ${esc(x.name)}</option>`).join('')}</select><button class="small" id="svc-ext-ok">노선 잇기 (직통)</button></div>` : '');
    })()}
    <div class="name-row"><span class="kind">정차역</span><span class="m">(숫자: 하루 이용객)</span></div>
    <div style="max-height:200px;overflow:auto;line-height:1.9">${rows || '<span class="m">지도에서 역을 누르세요.</span>'}</div>
    ${e.id ? '' : fundSelect(plan ? [serviceOperator({ segs: plan.segs })] : [])}
    <div class="actions">
      <button class="primary" id="svc-ok" ${plan && typeOk ? '' : 'disabled'}>${e.id ? (cost ? `저장 (차량 ${formatWon(cost)})` : '저장') : `운행 시작 (차량 ${formatWon(cost)} · 1년)`}</button>
      ${e.id ? '<button id="svc-del">운행 중단</button>' : ''}
    </div>${plan && !typeOk ? `<p class="hint" style="color:#b54708">${esc(TRAIN_TYPES[e.type].label)}은(는) 비전철 구간을 달릴 수 없어 저장할 수 없습니다. 열차를 디젤 객차로 바꾸거나 전철화를 마친 뒤 저장하세요.</p>` : ''}`;
}

export function bindService(el) {
  const e = svcEdit;
  if (!e) return;
  el.querySelector('#svc-name').onchange = (ev) => { e.name = ev.target.value.trim() || e.name; e.nameEdited = true; };
  el.querySelector('#svc-electrify')?.addEventListener('click', (ev) => {
    const r = startUpgrade(base, state, JSON.parse(ev.target.dataset.ids), 'electrify');
    if (!r.ok) { alert(r.reason); return; }
    save(state); refreshLinks(); renderAll();
    toast('비전철 구간 전철화를 시작했습니다. 완공되면 이 계통에 전동차를 고를 수 있습니다.');
  });
  el.querySelector('#svc-under')?.addEventListener('click', () => { const id = e.underLink; select({ type: 'link', id, section: sectionOf(id) }); });
  el.querySelector('#svc-color').oninput = (ev) => { e.color = ev.target.value; drawServiceEdit(); };
  drawServiceEdit();
  el.querySelector('#svc-kind').onchange = (ev) => {
    e.kind = ev.target.value;
    if (!e.nameEdited) e.name = `${e.line} ${SERVICE_KINDS[e.kind].label}`;
    if (!e.id) e.stops = defaultStops(e.nodes, e.kind);
    renderSelection();
  };
  el.querySelector('#svc-type').onchange = (ev) => { e.type = ev.target.value; renderSelection(); };
  el.querySelector('#svc-ext-ok')?.addEventListener('click', () => extendServiceLine(el.querySelector('#svc-ext').value));
  el.querySelector('#svc-sets').oninput = (ev) => { e.sets = +ev.target.value; ev.target.nextElementSibling.textContent = `${e.sets}편성`; };
  el.querySelector('#svc-sets').onchange = () => renderSelection();
  el.querySelectorAll('[data-unstop]').forEach((a) => {
    a.onclick = (ev) => { ev.preventDefault(); e.stops.delete(+a.dataset.unstop); renderSelection(); };
  });
  el.querySelectorAll('[data-svc-preset]').forEach((b) => { b.onclick = () => { e.stops = defaultStops(e.nodes, b.dataset.svcPreset); renderSelection(); }; });
  el.querySelector('#svc-ok').onclick = () => {
    const { stops, plan } = servicePlan();
    if (!plan) return;
    const rec = { name: e.name, kind: e.kind, line: e.lines[0], lines: e.lines, cls: e.cls, stops, type: e.type, sets: e.sets, runMin: plan.runMin, km: plan.km, segs: plan.segs, color: e.color,
      underLinks: plan.under };
    const r = e.id ? updateService(state, e.id, rec) : startService(state, rec);
    if (!r.ok) { alert(r.reason); return; }
    svcEdit = null;
    save(state); select(null); renderAll();
  };
  el.querySelector('#svc-del')?.addEventListener('click', () => {
    removeService(state, e.id);
    svcEdit = null;
    save(state); select(null); renderAll();
  });
}

/** 링크 패널의 운행 계통·수익성 (도시철도는 수익성만) */
export function serviceSection(l) {
  const ec = lineEconomics().find((x) => x.name === l.name);
  const econ = ec ? `<p class="hint">이 노선: 연 수입 ${formatWon(ec.rev / 1e8)} · 비용 ${formatWon(ec.cost / 1e8)} · 영업계수 <b class="${ec.ratio > 100 ? 'neg' : ''}">${fmtRatio(ec.ratio)}</b></p>` : '';
  const diagram = '<button class="small" id="line-diagram">노선도 보기 (열차 위치·정차역·혼잡도)</button>';
  if (l.mode === 2) return `<h4>노선도 · 수익성</h4><div class="actions">${diagram}</div>${econ}<p class="hint">도시철도 이용객에는 같은 구 안의 짧은 이용(역세권 인구로 어림)이 들어 있습니다.</p>`;
  const list = (state.services || []).filter((s) => s.line === l.name || s.lines?.includes(l.name));
  // 보통(자동) 열차: 모든 노선에 저절로 다니는 모든 역 정차 열차. 운행 비율(감편)은 여기서도 바꾼다
  const t = autoLocalTrains(l.name, l.cls), f = state.lineFreq?.[l.name] || 1;
  const autoRow = `<div class="item opt"><div class="opt-row">
      <span>${esc(autoBrand(l.cls === 'hsr' ? 'hsr' : 'conv', operatorOf(state, l)))} (자동) <span class="m">모든 역 정차 · 하루 ${t}회 · 약 ${Math.max(1, Math.round(SERVICE_DAY_MIN / Math.max(1, t / 2)))}분 간격 · 노선 최대 이용객에 맞춰 저절로 정함${l.cls === 'hsr' ? '' : ' (광역 전철이 같이 다니는 구간은 전철 운행까지 센 횟수)'}</span></span>
      <select data-freq="${esc(l.name)}" title="보통 열차 운행 비율 (감편)">${FREQ_STEPS.map((x) => `<option value="${x}" ${x === f ? 'selected' : ''}>운행 ${Math.round(x * 100)}%</option>`).join('')}</select></div></div>`;
  return `<h4>노선도 · 운행 계통 · 수익성</h4><div class="actions">${diagram}
    <button class="small" id="st-start" title="두 역 사이를 단순한 곡선으로 새로 놓고 옛 구간은 폐선">구간 직선화 (두 역 고르기)</button></div>${econ}
    <div class="list">${autoRow}${list.map((s) => `<div class="item opt"><div class="opt-row">
      <span>${esc(s.name)} <span class="m">${s.name.includes(serviceBrand(s)) ? '' : `${esc(serviceBrand(s))} · `}${s.name.includes(SERVICE_KINDS[s.kind].label) ? "" : `${SERVICE_KINDS[s.kind].label} · `}${s.stops.length}개 역 · ${TRAIN_TYPES[s.type]?.label.split(' ')[0] || ''} ${s.sets}편성 · 하루 ${s.trains}회${s.built ? '' : ' · 차량 제작 중'}</span></span>
      ${opBadge(state, serviceOperator(s))} <button class="small" data-svc-edit="${s.id}">고치기</button></div></div>`).join('')}</div>
    <div class="actions"><button class="small primary svc-pick" title="설 역을 지도에서 차례로 눌러 계통을 만듭니다 (여러 노선을 지나도 됩니다)">새 운행 계통 짜기 (역 고르기)</button></div>`;
}

export function fmtRatio(r) { return isFinite(r) ? Math.round(r).toLocaleString() : '–'; }

/** 운행 계통별 이용·수지 (시뮬레이션 결과의 가상 링크 순서 = 운행 중 계통의 구간 순서) */
export function svcStats() {
  const sv = result?.links.svcVol;
  const built = (state.services || []).filter((s) => s.built);
  if (!sv || sv.length !== built.reduce((n, s) => n + s.segs.length, 0)) return [];
  let k = 0;
  return built.map((s) => {
    let pkm = 0, peak = 0;
    const vs = [];
    for (const seg of s.segs) {
      const v = sv[k++] || 0;
      vs.push(v);
      pkm += v * seg.via.reduce((a, i) => a + linkAt(base, state, i).len, 0);
      peak = Math.max(peak, v);
    }
    // 하루 이용객(어림): 구간 이용객(양방향)이 늘어난 만큼 그 역에서 탔다고 본다.
    // 한 방향마다 첫 구간 + 늘어난 몫을 더하면 (v₁ + vₙ + Σ|vₖ − vₖ₋₁|) / 2 (같은 역에서 내리고 타는 사람은 빠져 조금 적게 나온다)
    let riders = vs.length ? (vs[0] + vs[vs.length - 1]) / 2 : 0;
    for (let j = 1; j < vs.length; j++) riders += Math.abs(vs[j] - vs[j - 1]) / 2;
    const avgKm = riders > 0 ? pkm / riders : 0;
    const cls = s.cls === 'hsr' ? 'hsr' : 'conv', fare = OPERATING.fareKm[cls] * SERVICE_KINDS[s.kind].fareFactor;
    const rev = pkm * fare * 365;
    // 비용: 열차-km 운행비 + 차량 감가상각(25년)
    const tt = TRAIN_TYPES[s.type] || TRAIN_TYPES.intercity;
    const cost = s.trains * s.km * tt.kmCost * 365 + (s.sets * tt.setCost * 1e8) / 25;
    return { s, peak, riders, avgKm, load: pkm / Math.max(1, s.trains * tt.cap * s.km), rev, cost,
      ratio: rev > 0 ? (cost / rev) * 100 : Infinity, premium: pkm * OPERATING.fareKm[cls] * (SERVICE_KINDS[s.kind].fareFactor - 1) * 365 };
  });
}

/**
 * 노선별 수지 (원/년): 수입 = 구간 이용객 × 거리 × km당 운임, 비용 = 열차-km 운행비 + 선로 유지비.
 * 열차 수는 이용객을 승차율 65%로 실을 만큼 (최소 운행 횟수 이상)으로 잡는다.
 */
export let econCache = null;
export function setEconCache(v) { return (econCache = v); }
export function lineEconomics() {
  if (!result) return [];
  if (econCache?.res === result) return econCache.rows;
  const OP = OPERATING, vol = result.links.vol, lines = new Map();
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode === 0 || !l.name || l.ext || l.cls === 'ferry' || linkPending(base, state, i) || state.replaced?.[i] || i >= vol.length) return;
    if (state.closedLines?.[l.name]) return;
    if (i >= base.links.length && !l.built) return;
    const cls = l.mode === 2 ? 'metro' : l.cls === 'hsr' ? 'hsr' : 'conv';
    let e = lines.get(l.name);
    if (!e) lines.set(l.name, (e = { name: l.name, cls, km: 0, rev: 0, cost: 0, track: 0, peak: 0 }));
    const v = vol[i];
    // 감편한 노선은 최소 운행도 그만큼 줄인다. 북측 구간은 운영사 수지와 같은 운임·비용 보정을 쓴다
    const f = state.lineFreq?.[l.name] || 1;
    const kpRail = l.kp && l.mode === 1 && !state.rail?.merged;
    const trains = Math.max(OP.minTrains[cls] * f * (kpRail ? OP_FACTORS.kpMinTrains : 1), v / (OP.paxPerTrain[cls] * OP.loadFactor));
    e.km += l.len;
    e.peak = Math.max(e.peak, v);
    e.rev += v * l.len * OP.fareKm[cls] * 365 * (l.kp && l.mode === 1 ? OP_FACTORS.kpFare(state.integration) : 1);
    const track = l.len * Math.max(1, Math.min(l.tracks || 2, 4)) * OP.trackKmCost[cls] * (l.kp && l.mode === 1 ? OP_FACTORS.kpTrackCost : 1);
    e.track += track;
    e.cost += trains * l.len * OP.trainKmCost[cls] * 365 * (l.kp && l.mode === 1 ? OP_FACTORS.kpCost : 1) + track;
  });
  // 특급·급행 승객은 등급 요금을 더 낸다
  for (const x of svcStats()) { const e = lines.get(x.s.line); if (e) e.rev += x.premium; }
  // 도시철도의 같은 구 안 이용은 모형이 구간 이용객에 이미 얹는다 (model.metroLocalLoads)
  // 여객 이용이 없는 노선(화물선, 역이 없는 선로)은 여객 열차가 다니지 않으므로 선로 유지비만 든다
  for (const e of lines.values()) if (e.peak < 1) { e.idle = true; e.cost = e.track; }
  const rows = [...lines.values()].filter((e) => e.km >= 5).map((e) => ({ ...e, ratio: e.rev > 0 ? (e.cost / e.rev) * 100 : Infinity }));
  econCache = { res: result, rows };
  return rows;
}

/** 항공 노선 영업계수: 편당 비용(기본비 + 거리비) ÷ 운임 수입 */
export function airRatio(aps, a, b, pax, freq) {
  const A = aps.find((x) => x.id === a), B = aps.find((x) => x.id === b);
  if (!A || !B) return Infinity;
  const km = kmBetween(A.lon, A.lat, B.lon, B.lat);
  const fare = (45000 + 90 * km) * (A.country !== B.country ? 1.6 : 1);
  const cost = 2 * freq * (9e6 + 14000 * km);
  return pax > 0 ? (cost / (pax * fare)) * 100 : Infinity;
}

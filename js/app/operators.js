// 노선 모식도와 철도 운영사.
import { formatWon } from '../game/catalog.js';
import { EQUITY_STEP, FOREIGN_OPERATORS, foreignOpBadge, MERGE_MIN_INTEGRATION, opBadge, operatorOf, OPERATORS, opInfo } from '../game/operators.js';
import { lineStations, OPERATING, railPath, SERVICE_KINDS, setCost, TRAIN_TYPES } from '../game/services.js';
import { effectiveNetwork, isKP, linkAt, linkPending, mergeRail, OP_FACTORS, railDividend, railEquity, save } from '../game/state.js';
import { autoBrand, trainBrand } from '../game/trainnames.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { P } from '../sim/params.js';
import { showLineDiagram } from '../ui/linediagram.js';
import { $, base, esc, result, state } from './core.js';
import { allLinks, nodeCoord, nodeNames } from './mapdata.js';
import { select } from './interact.js';
import { renderAll } from './panels.js';
import { chart } from './econ.js';
import { fmtRatio, lineEconomics, railStationSet, svcStats } from './svc.js';
import { flyToNode } from './transfer.js';

// ------------------------------------------------------------ 노선 모식도

/** 보통(자동) 열차의 하루 운행 횟수: 노선 최대 구간 이용객을 승차율 65%로 실을 만큼 (최소 운행 횟수 ~ 300회) */
export function autoLocalTrains(line, cls, peak) {
  const c = cls === 'metro' ? 'metro' : cls === 'hsr' ? 'hsr' : 'conv';
  if (peak == null) peak = lineEconomics().find((x) => x.name === line)?.peak || 0;
  const f = state.lineFreq?.[line] || 1;
  return Math.round(f * Math.min(300, Math.max(OPERATING.minTrains[c], 2 * Math.round(peak / (2 * OPERATING.paxPerTrain[c] * OPERATING.loadFactor)))));
}

/** 운행 중 계통별 구간(정차역 사이) 이용객 (시뮬레이션 결과의 가상 링크 순서대로) */
export function svcSegVols() {
  const out = new Map(), sv = result?.links.svcVol;
  const built = (state.services || []).filter((s) => s.built);
  if (!sv || sv.length !== built.reduce((n, s) => n + s.segs.length, 0)) return out;
  let k = 0;
  for (const s of built) out.set(s.id, s.segs.map(() => sv[k++]));
  return out;
}

export function openLineDiagram(id) {
  if (!result) return;
  const l0 = linkAt(base, state, id);
  const mode = l0.mode, line = l0.name;
  const net0 = effectiveNetwork(base, state);
  // 도시철도도 새로 놓은 역(railStationSet에 든다)을 역으로 센다 (예전에는 자료의 도시철도역만 세어 새 노선은 역이 없다고 나왔다)
  const stSet = mode === 2 ? new Set([...(base.metro_stations || []).map(([, n]) => n), ...railStationSet()]) : railStationSet();
  let net = net0, nodes = lineStations(net, stSet, line, mode), building = false;
  if (nodes.length < 2) {
    // 공사 중인 노선: 아직 열리지 않은 그 사업의 구간과 새 역으로 그린다
    const work = state.projects.filter((p) => p.status === 'building' && (p.links || []).some((i) => net0.links[i]?.name === line && net0.links[i]?.mode === mode));
    const ids = new Set(work.flatMap((p) => p.links));
    for (const p of work) for (const n of p.stations || []) stSet.add(n);
    net = { ...net0, links: net0.links.map((l, i) => (ids.has(i) && !l.active ? { ...l, active: true } : l)) };
    nodes = lineStations(net, stSet, line, mode);
    building = nodes.length >= 2;
  }
  if (nodes.length < 2) { alert('이 노선에는 역이 둘 이상 있어야 노선도를 그릴 수 있습니다.'); return; }
  const nn = nodeNames(), { vol, vc } = result.links;
  const stations = [], segs = [], segTime = [];
  let km = 0;
  nodes.forEach((n, i) => {
    if (i) {
      const via = railPath(net.links, nodes[i - 1], n, line, mode) || [];
      const len = via.length ? via.reduce((a, k) => a + net.links[k].len, 0) : kmBetween(...net.nodes[nodes[i - 1]], ...net.nodes[n]);
      km += len;
      segs.push({ vc: Math.max(0, ...via.map((k) => vc[k] || 0)), vol: Math.max(0, ...via.map((k) => vol[k] || 0)), gap: !via.length });
      segTime.push(via.length ? via.reduce((a, k) => a + (net.links[k].len / net.links[k].speed) * 60, 0) : (len / 80) * 60);
    }
    stations.push({ name: nn.get(n)?.name || `역 ${n}`, km, node: n });
  });
  const timesFor = (first, last, stops, tf) => {
    const t = [];
    t[first] = 0;
    for (let i = first + 1; i <= last; i++) t[i] = t[i - 1] + (stops.has(i - 1) && i - 1 !== first ? P.railDwellMin : 0) + segTime[i - 1] * tf;
    return t;
  };
  const rows = [];
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const segVols = svcSegVols();
  for (const s of (state.services || []).filter((x) => x.line === line || x.lines?.includes(line))) {
    const stopIdx = s.stops.map((n) => idx.get(n)).filter((i) => i != null).sort((a, b) => a - b);
    if (stopIdx.length < 2) continue;
    const first = stopIdx[0], last = stopIdx[stopIdx.length - 1], stops = new Set(stopIdx);
    const v = segVols.get(s.id);
    const segVC = [];
    if (v) {
      const cap = s.trains * (TRAIN_TYPES[s.type]?.cap || OPERATING.paxPerTrain[s.cls === 'hsr' ? 'hsr' : 'conv']);
      for (let j = 0; j + 1 < stopIdx.length; j++) for (let i = stopIdx[j]; i < stopIdx[j + 1]; i++) segVC[i] = (v[j] || 0) / cap;
    }
    // 열차 종류 최고 속도만큼 늦춘다: 계통 편도 시간에 맞춰 구간 시간을 늘린다
    const baseRun = timesFor(first, last, stops, 1)[last] || 1;
    const brand = serviceBrand(s);
    // 열차의 출발·도착역은 계통 전체의 두 끝 (다른 노선으로 이어 가도). 노선도 왼쪽→오른쪽이 계통 첫 역 쪽인지
    const fwd = (idx.get(s.stops[0]) ?? first) <= (idx.get(s.stops[s.stops.length - 1]) ?? last);
    const ends = [nn.get(s.stops[0])?.name || '', nn.get(s.stops[s.stops.length - 1])?.name || ''];
    rows.push({ name: s.name.includes(brand) ? s.name : `${brand} · ${s.name}`, brand, from: fwd ? ends[0] : ends[1], to: fwd ? ends[1] : ends[0],
      kind: s.kind, first, last, stops, trains: s.built ? s.trains : 0, times: timesFor(first, last, stops, Math.max(1, (s.runMin || baseRun) / baseRun)),
      segVC: v ? segVC : null,
      label: `${SERVICE_KINDS[s.kind].label} · ${TRAIN_TYPES[s.type]?.label.split(' ')[0] || ''} ${s.sets}편성 · ${s.trains}회/일${s.built ? '' : ' · 제작 중'}` });
  }
  // 보통(자동): 모든 노선에 저절로 다니는 모든 역 정차 열차. 운행 횟수는 이용객을 승차율 65%로 실을 만큼
  const baseTrains = autoLocalTrains(line, mode === 2 ? 'metro' : l0.cls, Math.max(0, ...segs.map((s) => s.vol)));
  const all = new Set(nodes.map((_, i) => i));
  const autoName = autoBrand(mode === 2 ? 'metro' : l0.cls, operatorOf(state, l0), nodes.map(foreignCountry).find(Boolean));
  rows.push({ name: `${autoName} (자동)`, brand: autoName, from: stations[0].name, to: stations[stations.length - 1].name, kind: 'base', first: 0, last: nodes.length - 1, stops: all, trains: baseTrains,
    times: timesFor(0, nodes.length - 1, all, 1), segVC: null, label: `모든 역 · 24시간 · ${baseTrains}회/일` });
  showLineDiagram($('#linediagram'), {
    title: `${line} · ${km.toFixed(0)}km · ${nodes.length}역${building ? ' · 공사 중' : ''}`, badge: opBadge(state, operatorOf(state, l0)), stations, segs, rows,
    onStation: (i) => { flyToNode(stations[i].node); select({ type: 'node', id: stations[i].node }); },
  });
}

// ------------------------------------------------------------ 철도 운영사 (코레일·KPRail)

/** 운영사별 한 해 수지 (원/년): 철도 구간마다 수입·비용을 그 구간을 맡은 회사에 매긴다 */
export function operatorEconomics() {
  const out = {};
  if (!result) return out;
  const OP = OPERATING, vol = result.links.vol;
  const kpFare = OP_FACTORS.kpFare(state.integration);
  const idle = new Set(lineEconomics().filter((e) => e.idle).map((e) => e.name));
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode !== 1 || l.ext || linkPending(base, state, i) || state.replaced?.[i] || i >= vol.length) return;
    if (i >= base.links.length && !l.built) return;
    if (state.closedLines?.[l.name]) return;
    const op = operatorOf(state, l);
    const cls = l.cls === 'hsr' ? 'hsr' : 'conv';
    const v = vol[i];
    const f = idle.has(l.name) ? 0 : state.lineFreq?.[l.name] || 1;
    const trains = Math.max(OP.minTrains[cls] * (l.kp ? OP_FACTORS.kpMinTrains : 1) * f, v / (OP.paxPerTrain[cls] * OP.loadFactor));
    const fareF = l.kp ? kpFare : 1;
    const costF = (l.kp ? OP_FACTORS.kpCost : 1) * (op === 'merged' ? OP_FACTORS.mergedCost : 1);
    const e = (out[op] ||= { rev: 0, cost: 0, km: 0 });
    e.km += l.len;
    e.rev += v * l.len * OP.fareKm[cls] * fareF * 365;
    const trackF = (l.kp ? OP_FACTORS.kpTrackCost : 1) * (op === 'merged' ? OP_FACTORS.mergedCost : 1);
    e.cost += trains * l.len * OP.trainKmCost[cls] * 365 * costF + l.len * Math.max(1, Math.min(l.tracks || 2, 4)) * OP.trackKmCost[cls] * trackF;
  });
  // 특급·급행 등급 요금과 차량 감가상각은 그 계통을 맡은 회사에
  for (const x of svcStats()) {
    const op = serviceOperator(x.s);
    const e = (out[op] ||= { rev: 0, cost: 0, km: 0 });
    e.rev += x.premium;
    e.cost += (x.s.sets * setCost(x.s.type) * 1e8) / 25;
  }
  return out;
}

export function serviceOperator(s) {
  const under = s.segs.flatMap((seg) => seg.via.map((i) => linkAt(base, state, i)));
  const kp = under.filter((l) => l.kp).length;
  return operatorOf(state, { mode: 1, kp: kp * 2 > under.length ? 1 : 0 });
}

/** 노드가 국외 거점이면 그 나라 */
export function foreignCountry(node) {
  return (base.foreignNodes || []).find((f) => f.node === node)?.country || null;
}

/** 계통의 열차 이름 (KTX·ITX-새마을·무궁화호, 국외로 가면 그 나라 열차) */
export function serviceBrand(s) {
  const nn = nodeNames();
  const under = s.segs.flatMap((seg) => seg.via.map((i) => linkAt(base, state, i)));
  const country = s.stops.map(foreignCountry).find(Boolean) || null;
  return trainBrand({ type: s.type, kind: s.kind, cls: s.cls, km: s.km, stops: s.stops.map((n) => nn.get(n)?.name), conv: under.some((l) => l.cls === 'conv'), op: serviceOperator(s), country }).short;
}

/** 철도 사업 재원 고르기 (정부 예산 / 운영사 자체 재원) */
export function fundSelect(ops) {
  const r = state.rail, list = [...new Set(ops)].filter(Boolean);
  const bal = list.map((op) => `${opInfo(state, op).name} ${formatWon(r.ops[op]?.cash || 0)}`).join(', ');
  return `<div class="name-row"><span class="kind">재원</span><select class="rail-fund">
      <option value="gov" ${r.fund !== 'op' ? 'selected' : ''}>정부 예산</option>
      <option value="op" ${r.fund === 'op' ? 'selected' : ''}>운영사 자체 재원${bal ? ` (잔액 ${bal})` : ''}</option></select></div>`;
}

export function bindFund(el, rerender) {
  el.querySelectorAll('.rail-fund').forEach((s) => {
    s.onchange = () => { state.rail.fund = s.value; save(state); rerender(); };
  });
}

export function railStatsHTML() {
  const r = state.rail, econ = operatorEconomics();
  const ops = r.merged ? ['merged'] : ['korail', 'kprail'];
  const rows = ops.map((op) => {
    const e = econ[op] || { rev: 0, cost: 0, km: 0 }, o = r.ops[op];
    const ratio = e.rev > 0 ? (e.cost / e.rev) * 100 : Infinity;
    const logo = OPERATORS[op].logo && !(op === 'merged' && r.name && r.name !== OPERATORS.merged.name)
      ? `<img src="${OPERATORS[op].logo}" alt="${esc(opInfo(state, op).name)}" height="18" style="display:block">` : opBadge(state, op);
    return `<tr><td>${logo}<span class="m">${Math.round(e.km).toLocaleString()}km</span></td><td>${formatWon(e.rev / 1e8)}</td><td>${formatWon(e.cost / 1e8)}</td>
      <td class="${e.rev < e.cost ? 'neg' : ''}">${formatWon((e.rev - e.cost) / 1e8)}</td><td class="${ratio > 100 ? 'neg' : ''}">${fmtRatio(ratio)}</td><td>${formatWon(o.cash)}</td></tr>`;
  }).join('');
  const charts = ops.map((op) => (r.ops[op].hist.length > 1 ? chart(`${opInfo(state, op).name} 잔액 (억원)`, r.ops[op].hist.map((h) => [h.year, h.cash])) : '')).join('');
  const actions = ops.map((op) => `<div class="actions">${opBadge(state, op)}
      <button class="small" data-rail-div="${op}" ${r.ops[op].cash > 0 ? '' : 'disabled'}>배당 (잔액 절반 → 정부)</button>
      <button class="small" data-rail-eq="${op}">출자 ${formatWon(EQUITY_STEP)}</button></div>`).join('');
  const canMerge = !r.merged && state.integration >= MERGE_MIN_INTEGRATION;
  return `<h3 style="margin-top:16px">철도 운영사</h3>
    <table class="cmp"><tr><th>회사</th><th>연 수입</th><th>연 비용</th><th>영업이익</th><th>영업계수</th><th>잔액</th></tr>${rows}</table>
    <p class="hint">해마다 영업이익이 잔액에 쌓입니다. 잔액은 건설 탭이나 구간 패널에서 재원을 "운영사 자체 재원"으로 고르면 그 회사 노선의 개량·신설·차량 구입에 씁니다. 적자로 잔액이 0 밑으로 내려가면 정부가 SOC 예산에서 메워 잔액은 0 밑으로 떨어지지 않습니다.
      북측 운임은 남북 통합도만큼 오릅니다 (지금 남측의 ${Math.round(OP_FACTORS.kpFare(state.integration) * 100)}%).</p>
    ${actions}
    ${r.merged ? `<p class="hint">${esc(r.name)}: 코레일과 KPRail이 합병해 모든 철도를 맡습니다 (운영비 5% 절감).</p>`
      : `<h4>합병</h4><div class="name-row"><input type="text" id="merge-name" placeholder="통합 회사 이름" value="${esc(OPERATORS.merged.name)}">
        <button class="small ${canMerge ? 'primary' : ''}" id="rail-merge" ${canMerge ? '' : 'disabled'}>코레일·KPRail 합병</button></div>
        <p class="hint">${canMerge ? '합치면 잔액·노선을 하나로 묶고 운영비가 5% 줄어듭니다. 대신 북측 적자를 남측 흑자로 메우게 됩니다.' : `남북 통합도 ${Math.round(MERGE_MIN_INTEGRATION * 100)}% 이상이면 합병할 수 있습니다 (지금 ${Math.round(state.integration * 100)}%).`}</p>`}
    ${charts}
    ${intlTrainsHTML()}`;
}

/** 국제 열차 운행 현황: 국경을 넘는 철도(국경 철도·해저터널)마다 이용객, 열차 이름, 양쪽 운영사 */
export function intlTrainsHTML() {
  if (!result) return '';
  const nn = nodeNames(), vol = result.links.vol;
  const rows = [];
  allLinks().forEach((l0, i) => {
    const l = linkAt(base, state, i);
    if (l.mode !== 1 || !l.ext || state.replaced?.[i] || l.replaced || (i >= base.links.length && !l.built)) return;
    const fa = foreignCountry(l.a), fb = foreignCountry(l.b);
    const country = fa || fb;
    if (!country) return;
    const home = fa ? l.b : l.a, away = fa ? l.a : l.b;
    const pax = vol[i] || 0;
    const brand = autoBrand(l.cls, null, country);
    const trains = Math.max(2, 2 * Math.round(pax / (2 * OPERATING.paxPerTrain[l.cls === 'hsr' ? 'hsr' : 'conv'] * OPERATING.loadFactor)));
    // 국외 도시끼리 잇는 선(신칸센·CRH 등)은 상대국 운영사만
    const both = fa && fb;
    const homeOp = both ? null : operatorOf(state, { mode: 1, kp: isKP(nodeCoord(home)[1], nodeCoord(home)[0]) ? 1 : 0 });
    rows.push(`<tr><td>${esc(nn.get(home)?.name || (l.name || '').split('–')[0])} – ${esc(nn.get(away)?.name || '')}<div class="m">${esc(l.name || '')}</div></td>
      <td>${esc(brand)}<div class="m">하루 약 ${trains}회</div></td><td>${Math.round(pax).toLocaleString()}명</td>
      <td>${homeOp ? opBadge(state, homeOp) : ''} ${FOREIGN_OPERATORS[country] ? `<img src="${FOREIGN_OPERATORS[country].logo}" alt="${FOREIGN_OPERATORS[country].name}" height="14" style="vertical-align:middle">` : foreignOpBadge(country)}</td></tr>`);
  });
  if (!rows.length) return '';
  return `<h3 style="margin-top:16px">국제 열차 운행 현황</h3>
    <table class="cmp"><tr><th>구간</th><th>열차</th><th>이용 (일)</th><th>운영사</th></tr>${rows.join('')}</table>
    <p class="hint">국경 너머 구간은 상대국 철도(중국국가철로·JR·러시아철도)가 맡고, 국내 구간은 코레일·KPRail(합병 뒤 통합 공사)이 맡아 직통 운행합니다. 로고는 각 회사의 상표이며 비상업 팬 프로젝트에서 식별용으로만 씁니다.</p>`;
}

export function bindRailStats(el) {
  el.querySelectorAll('[data-rail-div]').forEach((b) => {
    b.onclick = () => { const op = b.dataset.railDiv; railDividend(state, op, state.rail.ops[op].cash / 2); save(state); renderAll(); };
  });
  el.querySelectorAll('[data-rail-eq]').forEach((b) => {
    b.onclick = () => { const r = railEquity(state, b.dataset.railEq); if (!r.ok) { alert(r.reason); return; } save(state); renderAll(); };
  });
  el.querySelector('#rail-merge')?.addEventListener('click', () => {
    const r = mergeRail(state, el.querySelector('#merge-name').value.trim());
    if (!r.ok) { alert(r.reason); return; }
    save(state); renderAll();
  });
}

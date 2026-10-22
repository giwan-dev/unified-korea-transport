// 게임 진행과 화면 패널.
import { createMap, addLayers, colorFor, legendHTML, METRICS } from './ui/map.js';
import { Namer } from './game/naming.js';
import {
  newGame, save, load, clearSave, effectiveNetwork, linkAt, startUpgrade, startNewBuild, advanceBudgetYear,
  updateCongestion, defaultFix, updateApproval, canAfford, isKP, linksUnderWork, UPGRADES, NEW_BUILDS, upgradeCost,
} from './game/state.js';
import { DIFFICULTY, KP_COST_FACTOR, resolve, formatWon } from './game/catalog.js';
import { kmBetween } from './sim/model.js';

const $ = (s) => document.querySelector(s);
const CLASS_LABEL = { motorway: '고속도로', trunk: '간선국도', primary: '주요 도로', secondary: '지방 도로', hsr: '고속철도', conv: '일반철도' };
const POLICY_LABEL = { free: '자유 이주', limited: '이주 제한 (허가제)', closed: '이주 통제' };

let map, base, zonesFC, zoneProps, places, namer, worker;
let state, result = null, prevSummary = null, requests = [];
let metric = 'pop';
let selection = null;      // {type:'link'|'zone'|'node', id}
let draft = null;          // 그리기 중인 신설 사업
let busy = false;
let wholeRoute = false;    // 개량을 같은 이름 노선 전체에 적용

init().catch((e) => { console.error(e); alert('불러오기 실패: ' + e.message); });

async function init() {
  const [z, n, p] = await Promise.all([
    fetch('data/zones.geojson').then((r) => r.json()),
    fetch('data/network.json').then((r) => r.json()),
    fetch('data/places.json').then((r) => r.json()),
  ]);
  zonesFC = z; base = n; places = p;
  zoneProps = zonesFC.features.map((f) => f.properties);
  state = load() || newGame('normal');

  // 지도가 뜨는 동안 기준 연도 계산을 먼저 시작한다
  worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    if (ev.data.type === 'result') mapReady.then(() => onWorker(ev));
    else onWorker(ev);
  };
  worker.postMessage({
    type: 'init', zones: zoneProps, net: effectiveNetwork(base, state),
    ctx: ctx(), snapshot: state.snapshot,
  });
  setBusy(true, '데이터 준비 중', 0);

  const mapReady = createMap('map').then((m) => {
    map = m;
    addLayers(map, zonesFC, linksFC());
    refreshPoints();
    resetNamer();
    bindMap();
    bindUI();
    renderAll();
  });
  await mapReady;
  // 콘솔 디버깅용
  window.ukt = { map, get state() { return state; }, get result() { return result; }, get requests() { return requests; } };
}

function ctx() {
  return { integration: state.integration, policy: state.policy };
}

function resetNamer() {
  const existing = [
    ...base.stations.map(([name]) => ({ name, kind: 'station' })),
    ...base.junctions.map(([name]) => ({ name, kind: 'IC' })),
    ...Object.values(state.names).map((v) => ({ name: v.name, kind: v.kind })),
  ];
  namer = new Namer(places, existing);
}

// ------------------------------------------------------------ 시뮬레이션 결과

function onWorker(ev) {
  const m = ev.data;
  if (m.type === 'progress') setBusy(true, m.label, m.value);
  else if (m.type === 'error') { setBusy(false); console.error(m.message); alert('시뮬레이션 오류\n' + m.message); }
  else if (m.type === 'result') applyResult(m);
}

function applyResult(res) {
  const stepped = result !== null && pendingStep;
  pendingStep = false;
  result = res;
  state.snapshot = res.snapshot;

  const { vc, vol } = res.links;
  for (let i = 0; i < vc.length; i++) {
    map.setFeatureState({ source: 'links', id: i }, { vc: vc[i], vol: vol[i] });
  }
  paintZones();

  requests = updateCongestion(base, state, vc, stepped || !state.history.length);
  if (stepped) {
    if (DIFFICULTY[state.difficulty].autoApprove) autoApprove();
    updateApproval(state, requests, res.summary, prevSummary);
  }
  prevSummary = res.summary;
  const congestedKm = roadCongestedKm(vc);
  const last = state.history[state.history.length - 1];
  if (!last || last.year !== state.year) {
    state.history.push({
      year: state.year, krPop: res.summary.KR.pop, kpPop: res.summary.KP.pop,
      krHdi: res.summary.KR.hdi, kpHdi: res.summary.KP.hdi,
      krInc: res.summary.KR.income, kpInc: res.summary.KP.income,
      kpToKr: res.summary.kpToKr, rail: res.totals.rail / res.totals.trips, congestedKm,
    });
  }
  save(state);
  setBusy(false);
  renderAll();
}

let pendingStep = false;

function nextYear() {
  if (busy || !result) return;
  cancelDraft();
  const done = advanceBudgetYear(base, state);
  if (done.length) { refreshLinks(); refreshPoints(); }
  else refreshLinks();
  pendingStep = true;
  setBusy(true, `${state.year}년 계산 중`, 0);
  worker.postMessage({ type: 'step', net: effectiveNetwork(base, state), ctx: ctx() });
}

function autoApprove() {
  for (const r of requests.slice(0, 5)) {
    const fix = defaultFix(linkAt(base, state, r.links[0]));
    if (!fix) continue;
    const cost = r.links.reduce((sum, id) => sum + upgradeCost(fix, linkAt(base, state, id)), 0);
    if (cost / fix.years > state.budget) continue;
    startUpgrade(base, state, r.links, fix.id);
  }
  const work = linksUnderWork(state);
  requests = requests.filter((r) => !r.links.every((id) => work.has(id)));
}

function roadCongestedKm(vc) {
  let km = 0;
  for (let i = 0; i < vc.length; i++) {
    if (vc[i] > 1) { const l = linkAt(base, state, i); if (l.mode === 0) km += l.len; }
  }
  return km;
}

// ------------------------------------------------------------ 지도 데이터

function allLinks() {
  return base.links.concat(state.newLinks);
}

function linksFC() {
  const building = new Set();
  for (const p of state.projects) {
    if (p.status !== 'building') continue;
    if (p.kind === 'new') p.links.forEach((id) => building.add(id));
  }
  const features = allLinks().map((l, i) => {
    const eff = linkAt(base, state, i);
    const g = l.geom;
    const coords = [];
    for (let k = 0; k < g.length; k += 2) coords.push([g[k], g[k + 1]]);
    return {
      type: 'Feature', id: i,
      properties: { id: i, mode: eff.mode, cls: eff.cls, building: building.has(i) ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: coords },
    };
  });
  return { type: 'FeatureCollection', features };
}

function refreshLinks() {
  map.getSource('links').setData(linksFC());
  if (result) {
    const { vc, vol } = result.links;
    for (let i = 0; i < vc.length; i++) map.setFeatureState({ source: 'links', id: i }, { vc: vc[i], vol: vol[i] });
  }
}

function nodeCoord(id) {
  return id < base.nodes.length ? base.nodes[id] : state.newNodes[id - base.nodes.length];
}

/** 노드 id → {name, kind, isNew} (사용자가 바꾼 이름이 우선) */
function nodeNames() {
  const out = new Map();
  for (const [name, node] of base.stations) if (!out.has(node)) out.set(node, { name, kind: 'station', isNew: 0 });
  for (const [name, node] of base.junctions) {
    if (out.has(node)) continue;
    out.set(node, { name, kind: /JCT|분기점/.test(name) ? 'JCT' : 'IC', isNew: 0 });
  }
  for (const [k, v] of Object.entries(state.names)) out.set(+k, { name: v.name, kind: v.kind, isNew: 1 });
  return out;
}

function refreshPoints() {
  const features = [];
  for (const [node, v] of nodeNames()) {
    const c = nodeCoord(node);
    if (!c) continue;
    features.push({ type: 'Feature', properties: { node, ...v }, geometry: { type: 'Point', coordinates: c } });
  }
  map.getSource('points').setData({ type: 'FeatureCollection', features });
}

function paintZones() {
  if (!result) return;
  const z = result.zones;
  const accRef = median(Array.from(z.access));
  for (let i = 0; i < zoneProps.length; i++) {
    let v = null;
    if (metric === 'pop') v = z.pop[i];
    else if (metric === 'popChange') v = z.pop[i] / Math.max(zoneProps[i].pop, 1) - 1;
    else if (metric === 'hdi') v = z.hdi[i];
    else if (metric === 'income') v = z.income[i];
    else if (metric === 'access') v = z.access[i] / accRef;
    map.setFeatureState({ source: 'zones', id: i }, { color: metric === 'none' ? null : colorFor(metric, v) });
  }
}

// ------------------------------------------------------------ 지도 상호작용

function bindMap() {
  map.on('click', (e) => {
    if (draft) { addDraftPoint(e.lngLat); return; }
    const box = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
    const pt = map.queryRenderedFeatures(box, { layers: ['points'] })[0];
    if (pt) return select({ type: 'node', id: pt.properties.node });
    const ln = map.queryRenderedFeatures(box, { layers: ['rails', 'roads', 'building'] })[0];
    if (ln) return select({ type: 'link', id: ln.properties.id });
    const zn = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
    if (zn) return select({ type: 'zone', id: zn.id });
    select(null);
  });
  map.on('dblclick', (e) => { if (draft) { e.preventDefault(); } });
  for (const l of ['roads', 'rails', 'points']) {
    map.on('mouseenter', l, () => { if (!draft) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { if (!draft) map.getCanvas().style.cursor = ''; });
  }
}

function select(sel) {
  if (selection?.type === 'link') map.setFeatureState({ source: 'links', id: selection.id }, { sel: false });
  if (selection?.type === 'zone') map.setFeatureState({ source: 'zones', id: selection.id }, { sel: false });
  selection = sel;
  if (sel?.type === 'link') map.setFeatureState({ source: 'links', id: sel.id }, { sel: true });
  if (sel?.type === 'zone') map.setFeatureState({ source: 'zones', id: sel.id }, { sel: true });
  renderSelection();
}

// ------------------------------------------------------------ 신설 그리기

function startDraft(type) {
  cancelDraft();
  select(null);
  draft = { type, points: [] };
  map.getCanvas().style.cursor = 'crosshair';
  map.doubleClickZoom.disable();
  switchTab('build');
  renderBuild();
}

function cancelDraft() {
  if (!draft) return;
  for (const p of draft.points) if (p.name && p.reserved) namer.release(p.name, p.kind);
  draft = null;
  map.getCanvas().style.cursor = '';
  map.doubleClickZoom.enable();
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  renderBuild();
}

/** 같은 수단의 노드 집합 (신설 중인 링크 포함) */
function nodesOfMode(mode) {
  const s = new Set();
  for (const l of allLinks()) {
    const eff = l;
    if (eff.mode === mode) { s.add(eff.a); s.add(eff.b); }
  }
  return s;
}

function nearestNode(lngLat, mode, maxPx, maxKm) {
  const pt = map.project(lngLat);
  let best = null, bd = Infinity;
  for (const id of nodesOfMode(mode)) {
    const c = nodeCoord(id);
    const km = kmBetween(lngLat.lng, lngLat.lat, c[0], c[1]);
    if (maxKm != null) {
      if (km < bd && km <= maxKm) { bd = km; best = id; }
    } else {
      const q = map.project(c);
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < bd && d <= maxPx) { bd = d; best = id; }
    }
  }
  return best;
}

function addDraftPoint(lngLat) {
  const spec = NEW_BUILDS[draft.type];
  let node = nearestNode(lngLat, spec.mode, 14);
  // 도로는 끝점이 기존 도로망에 붙어야 하므로 첫 점은 20km 안의 가장 가까운 노드로 붙인다
  if (node == null && spec.mode === 0 && draft.points.length === 0) node = nearestNode(lngLat, 0, null, 20);
  const c = node != null ? nodeCoord(node) : [lngLat.lng, lngLat.lat];
  const pt = { node, lon: c[0], lat: c[1] };
  draft.points.push(pt);
  nameDraftPoint(pt, draft.points.length - 1);
  drawDraft();
  renderBuild();
}

function nameDraftPoint(pt) {
  const spec = NEW_BUILDS[draft.type];
  const existing = pt.node != null ? nodeNames().get(pt.node) : null;
  if (spec.mode === 1) {
    if (existing && existing.kind === 'station') { pt.name = existing.name; pt.kind = 'station'; pt.existing = true; return; }
    pt.kind = 'station';
    pt.name = namer.suggest(pt.lon, pt.lat, 'station');
    pt.reserved = true;
  } else if (draft.type === 'motorway' && pt.node != null) {
    if (existing && existing.kind !== 'station') { pt.name = existing.name; pt.kind = existing.kind; pt.existing = true; return; }
    const touchesMotorway = allLinks().some((l, i) => l.mode === 0 && (l.a === pt.node || l.b === pt.node) && linkAt(base, state, i).cls === 'motorway');
    pt.kind = touchesMotorway ? 'JCT' : 'IC';
    pt.name = namer.suggest(pt.lon, pt.lat, pt.kind);
    pt.reserved = true;
  } else {
    pt.kind = null; pt.name = null;
  }
}

function drawDraft() {
  const f = draft.points.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
  if (draft.points.length > 1) {
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: draft.points.map((p) => [p.lon, p.lat]) } });
  }
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
}

function draftCost() {
  const spec = NEW_BUILDS[draft.type];
  let km = 0, cost = 0;
  for (let i = 0; i + 1 < draft.points.length; i++) {
    const a = draft.points[i], b = draft.points[i + 1];
    const len = kmBetween(a.lon, a.lat, b.lon, b.lat) * 1.1;
    const kp = isKP(a.lat, a.lon) && isKP(b.lat, b.lon);
    km += len; cost += spec.perKm * len * (kp ? KP_COST_FACTOR : 1);
  }
  return { km, cost: Math.round(cost), years: spec.years };
}

function commitDraft() {
  if (!draft || draft.points.length < 2) return;
  const spec = NEW_BUILDS[draft.type];
  const last = draft.points[draft.points.length - 1];
  if (spec.mode === 0 && last.node == null) {
    alert('도로의 끝점은 기존 도로에 연결해야 합니다. 마지막 점을 도로 위에 찍어 주세요.');
    return;
  }
  const names = {};
  draft.points.forEach((p, i) => { if (p.name && !p.existing) names[i] = { name: p.name, kind: p.kind, auto: p.auto !== false }; });
  const r = startNewBuild(base, state, { type: draft.type, points: draft.points, names });
  if (!r.ok) { alert(r.reason); return; }
  draft.points.forEach((p) => { p.reserved = false; });
  draft = null;
  map.getCanvas().style.cursor = '';
  map.doubleClickZoom.enable();
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  addFeatureStatesAfterRebuild();
  refreshPoints();
  save(state);
  renderAll();
  switchTab('projects');
}

function addFeatureStatesAfterRebuild() { refreshLinks(); }

// ------------------------------------------------------------ 화면

function bindUI() {
  $('#btn-next').onclick = nextYear;
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
  $('#legend').addEventListener('change', (e) => {
    if (e.target.id === 'metric') { metric = e.target.value; paintZones(); renderLegend(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!draft || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') cancelDraft();
    if (e.key === 'Enter') commitDraft();
    if (e.key === 'Backspace') removeLastPoint();
  });
}

function removeLastPoint() {
  const p = draft.points.pop();
  if (p?.reserved) namer.release(p.name, p.kind);
  drawDraft(); renderBuild();
}

function switchTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === tab));
}

function setBusy(on, label = '', v = 0) {
  busy = on;
  $('#busy').hidden = !on;
  $('.busy-label').textContent = label;
  $('#busy-bar').style.width = `${Math.round(v * 100)}%`;
  $('#btn-next').disabled = on || !result;
}

function renderAll() {
  renderTop(); renderLegend(); renderStatus(); renderBuild(); renderProjects(); renderRequests(); renderSettings(); renderSelection();
}

function renderTop() {
  $('#s-year').textContent = `${state.year}년`;
  $('#s-budget').textContent = formatWon(state.budget);
  $('#s-debt').textContent = formatWon(state.debt);
  $('#s-debt').className = 'v' + (state.debt > 0 ? ' neg' : '');
  $('#s-approval').textContent = `${state.approval.toFixed(0)}%`;
  $('#s-integration').textContent = `${Math.round(state.integration * 100)}%`;
  $('#btn-next').disabled = busy || !result;
}

function renderLegend() { $('#legend').innerHTML = legendHTML(metric); }

function fmtPop(v) { return v >= 1e6 ? `${(v / 1e6).toFixed(2)}백만` : `${Math.round(v / 1000).toLocaleString()}천`; }
function pct(v, d = 1) { return `${(v * 100).toFixed(d)}%`; }

function renderStatus() {
  const el = $('[data-panel=status]');
  if (!result) { el.innerHTML = '<p class="hint">기준 연도 교통수요를 계산하고 있습니다…</p>'; return; }
  const s = result.summary, t = result.totals;
  const tot = s.KR.pop + s.KP.pop;
  const h = state.history;
  const first = h[0];
  const cong = h[h.length - 1]?.congestedKm ?? 0;
  el.innerHTML = `
    <h3>${state.year}년 현황</h3>
    <table class="cmp">
      <tr><th></th><th>남</th><th>북</th><th>전체</th></tr>
      <tr><td>인구</td><td>${fmtPop(s.KR.pop)}</td><td>${fmtPop(s.KP.pop)}</td><td>${fmtPop(tot)}</td></tr>
      <tr><td>HDI</td><td>${s.KR.hdi.toFixed(3)}</td><td>${s.KP.hdi.toFixed(3)}</td><td>${((s.KR.hdi * s.KR.pop + s.KP.hdi * s.KP.pop) / tot).toFixed(3)}</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(s.KR.income).toLocaleString()}</td><td>$${Math.round(s.KP.income).toLocaleString()}</td><td>${(s.KR.income / s.KP.income).toFixed(1)}배 격차</td></tr>
    </table>
    <h4>교통</h4>
    <table class="kv">
      <tr><td>지역 간 통행 (일)</td><td>${fmtPop(t.trips)} 통행</td></tr>
      <tr><td>철도 분담률</td><td>${pct(t.rail / t.trips)}</td></tr>
      <tr><td>남북 간 통행 (일)</td><td>${fmtPop(t.kpkr)} 통행</td></tr>
      <tr><td>정체 도로 (V/C&gt;1)</td><td>${Math.round(cong).toLocaleString()} km</td></tr>
    </table>
    <h4>인구 이동 (지난 1년)</h4>
    <table class="kv">
      <tr><td>북 → 남</td><td>${fmtPop(s.kpToKr || 0)}</td></tr>
      <tr><td>남 → 북</td><td>${fmtPop(s.krToKp || 0)}</td></tr>
    </table>
    ${h.length > 1 ? `<h4>추이</h4><table class="cmp">
      <tr><th>연도</th><th>북 인구</th><th>북 HDI</th><th>소득 격차</th><th>철도</th></tr>
      ${h.slice(-8).reverse().map((r) => `<tr><td>${r.year}</td><td>${fmtPop(r.kpPop)}</td><td>${r.kpHdi.toFixed(3)}</td><td>${(r.krInc / r.kpInc).toFixed(1)}배</td><td>${pct(r.rail, 0)}</td></tr>`).join('')}
    </table>
    <p class="hint">시작(${first.year}) 대비 북 인구 ${pct(h[h.length - 1].kpPop / first.kpPop - 1)}, 북 HDI ${(h[h.length - 1].kpHdi - first.kpHdi >= 0 ? '+' : '')}${(h[h.length - 1].kpHdi - first.kpHdi).toFixed(3)}</p>` : ''}
    <h4>기록</h4>
    <div class="log">${state.log.slice(0, 30).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
}

function renderBuild() {
  const el = $('[data-panel=build]');
  const tools = Object.entries(NEW_BUILDS).map(([k, v]) =>
    `<button data-build="${k}" class="${draft?.type === k ? 'on' : ''}">${v.label}<span class="c">${formatWon(v.perKm)}/km · ${v.years}년</span></button>`).join('');
  let body = `<p class="hint">기존 도로·철도를 개량하려면 지도에서 구간을 누르세요. 새 노선을 놓으려면 아래에서 종류를 고른 뒤 지도를 차례로 누르세요.</p>`;
  if (draft) {
    const spec = NEW_BUILDS[draft.type];
    const { km, cost, years } = draftCost();
    const affordable = canAfford(state, cost, years);
    body = `<h4>${spec.label}</h4>
      <p class="hint">기존 ${spec.mode ? '선로' : '도로'} 근처를 누르면 연결됩니다. ${spec.mode ? '각 점은 역이 됩니다.' : '도로는 양 끝을 기존 도로에 붙여야 합니다.'}
      Backspace: 마지막 점 지우기 · Enter: 착공 · Esc: 취소</p>
      <div>${draft.points.map((p, i) => pointRow(p, i)).join('') || '<p class="hint">시작점을 누르세요.</p>'}</div>
      <table class="kv" style="margin-top:8px">
        <tr><td>연장</td><td>${km.toFixed(1)} km</td></tr>
        <tr><td>사업비</td><td>${formatWon(cost)}</td></tr>
        <tr><td>공사 기간 · 연 분담</td><td>${years}년 · ${formatWon(cost / years)}</td></tr>
      </table>
      ${!affordable && draft.points.length > 1 ? '<p class="hint neg">예산과 차입 한도를 넘습니다.</p>' : ''}
      <div class="row" style="display:flex;gap:6px;margin-top:8px">
        <button class="primary" id="draft-ok" ${draft.points.length < 2 || !affordable ? 'disabled' : ''}>착공</button>
        <button id="draft-cancel">취소</button>
      </div>`;
  }
  el.innerHTML = `<div class="tools">${tools}</div>${body}`;
  el.querySelectorAll('[data-build]').forEach((b) => { b.onclick = () => startDraft(b.dataset.build); });
  if (draft) {
    $('#draft-ok').onclick = commitDraft;
    $('#draft-cancel').onclick = cancelDraft;
    el.querySelectorAll('[data-pname]').forEach((inp) => {
      inp.onchange = () => renameDraftPoint(+inp.dataset.pname, inp.value.trim());
    });
    el.querySelectorAll('[data-pauto]').forEach((b) => {
      b.onclick = () => {
        const p = draft.points[+b.dataset.pauto];
        if (p.reserved) namer.release(p.name, p.kind);
        p.name = namer.suggest(p.lon, p.lat, p.kind); p.reserved = true; p.auto = true;
        renderBuild();
      };
    });
    el.querySelectorAll('[data-ptoggle]').forEach((b) => {
      b.onclick = () => {
        const p = draft.points[+b.dataset.ptoggle];
        if (p.kind) { if (p.reserved) namer.release(p.name, p.kind); p.kind = null; p.name = null; p.reserved = false; }
        else { p.kind = 'station'; p.name = namer.suggest(p.lon, p.lat, 'station'); p.reserved = true; }
        renderBuild();
      };
    });
  }
}

function pointRow(p, i) {
  const spec = NEW_BUILDS[draft.type];
  const tag = p.node != null ? '연결' : '신규';
  if (!p.name) {
    const toggle = spec.mode === 1 ? `<button class="small" data-ptoggle="${i}">역 설치</button>` : '';
    return `<div class="name-row"><span class="kind">${tag}</span><span style="flex:1;color:var(--muted)">경유점 ${i + 1}</span>${toggle}</div>`;
  }
  if (p.existing) return `<div class="name-row"><span class="kind">${tag}</span><span style="flex:1">${esc(p.name)}</span></div>`;
  const toggle = spec.mode === 1 && i > 0 && i < draft.points.length - 1 ? `<button class="small" data-ptoggle="${i}">통과</button>` : '';
  return `<div class="name-row"><span class="kind">${p.kind === 'station' ? '역' : p.kind}</span>
    <input type="text" data-pname="${i}" value="${esc(p.name)}">
    <button class="small" data-pauto="${i}" title="자동 이름">↻</button>${toggle}</div>`;
}

function renameDraftPoint(i, name) {
  const p = draft.points[i];
  if (!name || name === p.name) { renderBuild(); return; }
  if (namer.isUsed(name, p.kind)) { alert(`'${name}'은(는) 이미 쓰이는 이름입니다.`); renderBuild(); return; }
  if (p.reserved) namer.release(p.name, p.kind);
  p.name = name; p.reserved = true; p.auto = false;
  namer.reserve(name, p.kind);
}

function renderProjects() {
  const el = $('[data-panel=projects]');
  const building = state.projects.filter((p) => p.status === 'building');
  const done = state.projects.filter((p) => p.status === 'done').slice(-15).reverse();
  const annual = building.reduce((s, p) => s + p.annual, 0);
  el.innerHTML = `
    <h3>공사 중 (${building.length})</h3>
    <p class="hint">내년 공사비 분담: ${formatWon(annual)} / 연 예산 ${formatWon(DIFFICULTY[state.difficulty].annualBudget)}</p>
    <div class="list">${building.map((p) => {
      const prog = (state.year - p.startYear) / p.years;
      return `<div class="item"><div class="t">${esc(p.label)}</div>
        <div class="m">${formatWon(p.cost)} · ${p.doneYear}년 완공 예정</div>
        <div class="progress"><div style="width:${Math.round(prog * 100)}%"></div></div></div>`;
    }).join('') || '<p class="hint">진행 중인 사업이 없습니다.</p>'}</div>
    <h3 style="margin-top:16px">완공 (${state.projects.length - building.length})</h3>
    <div class="list">${done.map((p) => `<div class="item"><div class="t">${esc(p.label)}</div><div class="m">${p.doneYear}년 완공 · ${formatWon(p.cost)}</div></div>`).join('') || '<p class="hint">아직 없습니다.</p>'}</div>`;
}

function renderRequests() {
  const el = $('[data-panel=requests]');
  const c = $('#req-count');
  c.hidden = requests.length === 0;
  c.textContent = requests.length;
  el.innerHTML = `<h3>확장 요구</h3>
    <p class="hint">혼잡도(V/C)가 1.0을 넘는 상태가 2년 이상 이어진 노선입니다(남은 고속도로·간선국도, 북은 모든 도로, 그리고 철도). 방치하면 지지율이 떨어집니다. 넓혀도 통행비용이 줄면 수요가 다시 늘 수 있습니다.</p>
    <div class="list">${requests.slice(0, 40).map((r, i) => {
      const l = linkAt(base, state, r.links[0]);
      const fix = defaultFix(l);
      const cost = fix ? r.links.reduce((sum, id) => sum + upgradeCost(fix, linkAt(base, state, id)), 0) : 0;
      return `<div class="item"><div class="t">${esc(r.name || CLASS_LABEL[r.cls])} · ${r.km.toFixed(0)}km</div>
        <div class="m">${CLASS_LABEL[r.cls]} · ${r.kp ? '북' : '남'} · 최대 V/C ${r.vc.toFixed(2)} · ${r.years}년째 · ${r.links.length}개 구간</div>
        <div class="row">
          ${fix ? `<button class="small primary" data-fix="${i}">${resolve(fix.label, l)} ${formatWon(cost)}</button>` : ''}
          <button class="small" data-goto="${i}">보기</button>
          <button class="small" data-dismiss="${i}">올해 보류</button>
        </div></div>`;
    }).join('') || '<p class="hint">요구가 없습니다.</p>'}</div>`;
  el.querySelectorAll('[data-fix]').forEach((b) => {
    b.onclick = () => {
      const r = requests[+b.dataset.fix];
      const fix = defaultFix(linkAt(base, state, r.links[0]));
      const res = startUpgrade(base, state, r.links, fix.id);
      if (!res.ok) return alert(res.reason);
      requests = requests.filter((q) => q !== r);
      save(state); refreshLinks(); renderAll();
    };
  });
  el.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => gotoLinks(requests[+b.dataset.goto].links); });
  el.querySelectorAll('[data-dismiss]').forEach((b) => {
    b.onclick = () => {
      const r = requests[+b.dataset.dismiss];
      state.dismissed[r.key] = state.year;
      requests = requests.filter((q) => q !== r);
      save(state); renderRequests();
    };
  });
}

function gotoLinks(ids) {
  const xs = [], ys = [];
  for (const id of ids) {
    const g = allLinks()[id].geom;
    for (let k = 0; k < g.length; k += 2) { xs.push(g[k]); ys.push(g[k + 1]); }
  }
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 11 });
  select({ type: 'link', id: ids[0] });
}

function renderSettings() {
  const el = $('[data-panel=settings]');
  el.innerHTML = `
    <h3>정책</h3>
    <div class="name-row"><span style="flex:1">북→남 이주</span>
      <select id="policy">${Object.entries(POLICY_LABEL).map(([k, v]) => `<option value="${k}" ${state.policy === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <p class="hint">통일 직후 대규모 남하를 막을지 정합니다. 통제할수록 북측 인구는 유지되지만 지지율과 통합 속도에 영향이 있습니다.</p>
    <h3 style="margin-top:16px">새 게임</h3>
    <div class="name-row"><span style="flex:1">난이도</span>
      <select id="difficulty">${Object.entries(DIFFICULTY).map(([k, v]) => `<option value="${k}" ${state.difficulty === k ? 'selected' : ''}>${v.label} (연 ${formatWon(v.annualBudget)})</option>`).join('')}</select></div>
    <button id="btn-new" style="margin-top:6px">이 난이도로 새로 시작</button>
    <p class="hint">진행 상황은 이 브라우저에 자동 저장됩니다.</p>
    <h3 style="margin-top:16px">데이터</h3>
    <p class="hint">도로·철도·행정구역·지명: © OpenStreetMap 기여자 (ODbL)<br>인구 격자: WorldPop 2020 (CC BY 4.0)<br>소득·HDI 초기값과 공사비 단가는 게임용 가정값입니다. 자세한 내용은 저장소의 docs/model.md를 보세요.</p>`;
  $('#policy').onchange = (e) => { state.policy = e.target.value; state.log.unshift(`${state.year}년 이주 정책: ${POLICY_LABEL[state.policy]}`); save(state); renderStatus(); };
  $('#btn-new').onclick = () => {
    if (!confirm('지금 게임을 지우고 새로 시작할까요?')) return;
    clearSave();
    const d = $('#difficulty').value;
    state = newGame(d);
    save(state);
    location.reload();
  };
}

function renderSelection() {
  const el = $('#selection');
  if (!selection) { el.hidden = true; return; }
  el.hidden = false;
  if (selection.type === 'link') el.innerHTML = linkPanel(selection.id);
  else if (selection.type === 'zone') el.innerHTML = zonePanel(selection.id);
  else el.innerHTML = nodePanel(selection.id);
  el.querySelector('.close')?.addEventListener('click', () => select(null));
  el.querySelectorAll('[data-up]').forEach((b) => {
    b.onclick = () => {
      const ids = wholeRoute ? sameRoute(selection.id) : [selection.id];
      const r = startUpgrade(base, state, ids, b.dataset.up);
      if (!r.ok) return alert(r.reason);
      save(state); refreshLinks(); renderAll();
    };
  });
  const wr = el.querySelector('#whole-route');
  if (wr) wr.onchange = () => { wholeRoute = wr.checked; renderSelection(); };
  const inp = el.querySelector('#node-name');
  if (inp) {
    el.querySelector('#node-save').onclick = () => renameNode(selection.id, inp.value.trim());
    el.querySelector('#node-auto').onclick = () => autoRenameNode(selection.id);
  }
}

function header(title) {
  return `<div style="display:flex;justify-content:space-between;align-items:center"><h3>${esc(title)}</h3><button class="small close">닫기</button></div>`;
}

function linkPanel(id) {
  const l = linkAt(base, state, id);
  const vc = result ? result.links.vc[id] : 0, vol = result ? result.links.vol[id] : 0;
  const speed = result ? result.links.speed[id] : 0;
  const busyProj = state.projects.find((p) => p.status === 'building' && p.links.includes(id));
  const isRoad = l.mode === 0;
  const ups = UPGRADES.filter((u) => u.mode === l.mode && u.applies(l));
  const route = sameRoute(id);
  const routeKm = route.reduce((sum, x) => sum + linkAt(base, state, x).len, 0);
  const rows = isRoad
    ? `<tr><td>차로</td><td>${l.lanes}차로${l.paved ? '' : ' (비포장)'}</td></tr>
       <tr><td>설계·실제 속도</td><td>${l.speed} / ${speed.toFixed(0)} km/h</td></tr>
       <tr><td>교통량</td><td>${Math.round(vol).toLocaleString()} PCU/일</td></tr>`
    : `<tr><td>선로</td><td>${l.tracks === 1 ? '단선' : l.tracks === 2 ? '복선' : l.tracks + '선'}</td></tr>
       <tr><td>전력</td><td>${{ AC: '교류 25kV', DC: '직류 3kV', none: '비전철' }[l.power]}</td></tr>
       <tr><td>최고 운행 속도</td><td>${l.speed} km/h</td></tr>
       <tr><td>이용객</td><td>${Math.round(vol).toLocaleString()} 명/일</td></tr>`;
  return `${header(l.name || CLASS_LABEL[l.cls])}
    <table class="kv">
      <tr><td>종류</td><td>${CLASS_LABEL[l.cls]} · ${l.kp ? '북' : '남'}</td></tr>
      <tr><td>연장</td><td>${l.len.toFixed(1)} km</td></tr>
      ${rows}
      <tr><td>혼잡도 (V/C)</td><td class="${vc > 1 ? 'neg' : ''}">${vc.toFixed(2)}</td></tr>
    </table>
    ${busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>` : `<h4>개량</h4>
    ${route.length > 1 ? `<label class="name-row"><input type="checkbox" id="whole-route" ${wholeRoute ? 'checked' : ''}>
      <span>같은 이름 노선 전체 (${route.length}개 구간, ${routeKm.toFixed(0)}km)</span></label>` : ''}
    <div class="list">${ups.map((u) => {
      const ids = (wholeRoute && route.length > 1 ? route : [id]).filter((x) => u.applies(linkAt(base, state, x)));
      const cost = ids.reduce((sum, x) => sum + upgradeCost(u, linkAt(base, state, x)), 0);
      const ok = canAfford(state, cost, u.years);
      return `<div class="item"><div class="row" style="margin:0;justify-content:space-between">
        <span>${resolve(u.label, l)}${ids.length > 1 ? ` · ${ids.length}개 구간` : ''}</span>
        <button class="small ${ok ? 'primary' : ''}" data-up="${u.id}" ${ok ? '' : 'disabled'}>${formatWon(cost)} · ${u.years}년</button></div></div>`;
    }).join('') || '<p class="hint">가능한 개량이 없습니다.</p>'}</div>`}`;
}

/** 이름·등급·남북이 같은 링크들 (노선 전체 개량용) */
function sameRoute(id) {
  const l = linkAt(base, state, id);
  if (!l.name) return [id];
  const out = [];
  allLinks().forEach((_, i) => {
    const m = linkAt(base, state, i);
    if (m.name === l.name && m.mode === l.mode && m.cls === l.cls && m.kp === l.kp) out.push(i);
  });
  return out;
}

function zonePanel(id) {
  const z = zoneProps[id];
  if (!result) return header(z.name);
  const r = result.zones;
  const st = r.station[id];
  const stName = st >= 0 ? nodeNames().get(st)?.name : null;
  const change = r.pop[id] / Math.max(z.pop, 1) - 1;
  const accRef = median(Array.from(r.access));
  return `${header(z.name)}
    <table class="kv">
      <tr><td>소속</td><td>${esc(z.province)} (${z.country === 'KP' ? '북' : '남'})</td></tr>
      <tr><td>인구</td><td>${fmtPop(r.pop[id])} <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>지난해 순이동</td><td>${Math.round(r.netMig[id]).toLocaleString()}명</td></tr>
      <tr><td>HDI</td><td>${r.hdi[id].toFixed(3)}</td></tr>
      <tr><td>기대수명</td><td>${r.le[id].toFixed(1)}세</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(r.income[id]).toLocaleString()}</td></tr>
      <tr><td>접근성 (중앙값=1)</td><td>${(r.access[id] / accRef).toFixed(2)}</td></tr>
      <tr><td>이용 철도역</td><td>${stName ? esc(stName) : '없음 (25km 밖)'}</td></tr>
    </table>`;
}

function nodePanel(id) {
  const n = nodeNames().get(id);
  if (!n) return header('노드');
  const kindLabel = { station: '역', IC: 'IC', JCT: 'JCT' }[n.kind];
  return `${header(n.name)}
    <p class="hint">${kindLabel}${n.isNew ? (state.names[id]?.auto ? ' · 자동 이름' : ' · 직접 지은 이름') : ' · 기존 시설 (OSM)'}</p>
    <div class="name-row"><input type="text" id="node-name" value="${esc(n.name)}">
      <button class="small primary" id="node-save">이름 변경</button>
      <button class="small" id="node-auto" title="자동 이름">↻</button></div>`;
}

function renameNode(id, name) {
  const cur = nodeNames().get(id);
  if (!name || name === cur.name) return;
  if (namer.isUsed(name, cur.kind)) { alert(`'${name}'은(는) 이미 쓰이는 이름입니다.`); return; }
  namer.release(cur.name, cur.kind);
  namer.reserve(name, cur.kind);
  state.names[id] = { name, kind: cur.kind, auto: false };
  save(state); refreshPoints(); renderSelection();
}

function autoRenameNode(id) {
  const cur = nodeNames().get(id);
  const c = nodeCoord(id);
  namer.release(cur.name, cur.kind);
  const name = namer.suggest(c[0], c[1], cur.kind);
  state.names[id] = { name, kind: cur.kind, auto: true };
  save(state); refreshPoints(); renderSelection();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] || 1;
}

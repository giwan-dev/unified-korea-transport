// 게임 진행과 화면 패널.
import { createMap, addLayers, colorFor, legendHTML, METRICS } from './ui/map.js';
import { Namer } from './game/naming.js';
import {
  newGame, save, load, clearSave, effectiveNetwork, linkAt, startUpgrade, startNewBuild, advanceBudgetYear,
  updateCongestion, defaultFix, updateApproval, canAfford, isKP, linksUnderWork, UPGRADES, NEW_BUILDS, upgradeCost,
  placeName, setPlaceName, startRestoreName, RENAME, startAirport, startAirportExpand, renameLine, splitLink,
  initAirRoutes, updateAirRoutes, startOpenRoute, closeRoute, AIR,
} from './game/state.js';
import { AIRPORT } from './game/catalog.js';
import { setNameResolver, refreshNames } from './ui/map.js';
import { DIFFICULTY, KP_COST_FACTOR, resolve, formatWon } from './game/catalog.js';
import { kmBetween, routeKey } from './sim/model.js';
import { decodeNetwork } from './data/netpack.js';
import { smoothSegments, polylineKm } from './game/curve.js';
import { extendWorld } from './game/world.js';
import { autoLineName, cityStem, makeForeignTest } from './game/lines.js';
import { saveSim, loadSim, clearSim } from './game/simstore.js';

const $ = (s) => document.querySelector(s);
const CLASS_LABEL = { motorway: '고속도로', trunk: '간선국도', primary: '주요 도로', secondary: '지방 도로', hsr: '고속철도', conv: '일반철도', metro: '도시철도' };
const POLICY_LABEL = { free: '자유 이주', limited: '이주 제한 (허가제)', closed: '이주 통제' };

let map, base, zonesFC, zoneProps, places, grid, subsFC, subPop0, namer, worker;
let state, result = null, prevSummary = null, requests = [];
let metric = 'pop';
let selection = null;      // {type:'link'|'zone'|'node', id}
let draft = null;          // 그리기 중인 신설 사업
let busy = false;
let historic = [];         // 옛 이름 되찾기 대상 (data/historic_targets.json)
let happiness = null;      // 존별 주민 행복도 (0~100)
let lastIncome = null;
let dataStamp = null;
let isForeign = () => false;   // 외국 땅 판정 (주변국 육지 자료를 받으면 바뀐다)
let multi = null;               // 드래그로 고른 구간들
let measure = null;             // 소요 시간 측정: {from, to}
const snap = { node: true, line: true };   // 그리기: 노드에 붙이기 / 선 위에 붙이기(중간 IC·역)
const MID_COST = { road: 300, rail: 200 };  // 중간 IC·역 설치비 (억원)
const REST = { spacingKm: 40, cost: 150 };  // 고속도로 휴게소: 약 40km마다, 한 곳 설치비 (억원)
let wholeRoute = false;    // 개량을 같은 이름 노선 전체에 적용


async function init() {
  // 1) 데이터 내려받기 (큰 파일은 진행률을 보인다)
  loading.stage('data');
  const dl = new Progress((v) => loading.progress('data', v));
  const [z, nmeta, nbin, g, meta, world] = await Promise.all([
    dl.fetch('data/zones.json', 'json'),
    dl.fetch('data/network.meta.json', 'json'),
    dl.fetch('data/network.bin', 'buffer'),
    dl.fetch('data/grid.bin', 'buffer'),
    fetch('data/meta.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    dl.fetch('data/air_sea.json', 'json'),
  ]);
  zoneProps = z; base = decodeNetwork(nmeta, nbin); grid = new Float32Array(g);
  // 국외 거점·국경 연결·여객선 항로·공항
  extendWorld(base, zoneProps, world);
  // 존 경계는 배경지도와 같은 시군구 도형을 쓴다
  zonesFC = await dl.fetch('data/admin/sgg.geojson', 'json');
  // 지명은 새 역·IC 이름을 지을 때만 필요하므로 첫 화면 뒤에 받는다
  const placesReady = fetch('data/places.json').then((r) => r.json()).then((p) => { places = p; });
  fetch('data/base/world.geojson').then((r) => r.json()).then((w) => { isForeign = makeForeignTest(w); }).catch(() => {});
  fetch('data/historic_targets.json').then((r) => (r.ok ? r.json() : [])).then((h) => { historic = h; }).catch(() => {});
  subPop0 = zoneProps.flatMap((zp) => zp.subs.map((s) => s[2] * zp.pop));
  state = load();
  // 데이터가 바뀌면(노선망·존 구성 변경) 예전 저장 게임은 맞지 않으므로 새로 시작한다
  if (state && meta && state.dataStamp !== meta.stamp) {
    state = newGame(state.difficulty || 'normal');
    state.log.unshift('지도·노선 데이터가 새로 바뀌어 이전 저장 게임 대신 새 게임으로 시작합니다.');
    clearSim();
  }
  state ||= newGame('normal');
  if (meta) state.dataStamp = meta.stamp;
  initAirRoutes(state, world.routes || []);
  assignTourism(await fetch('data/tourism.json').then((r) => r.json()).catch(() => null));
  const baseline = await loadBaseline(meta);
  // 저장된 게임의 그해 계산 상태 (같은 해·같은 데이터일 때만)
  const saved = state.snapshot ? await loadSim() : null;
  const savedOk = saved && saved.year === state.year && saved.stamp === meta?.stamp ? saved : null;
  loading.done('data');
  // 읍면동 경계는 지도에만 쓰므로 기다리지 않는다
  const subsReady = fetch('data/subzones.geojson').then((r) => r.json()).then((fc) => { subsFC = fc; });

  // 2) 시뮬레이션: 지도가 뜨는 동안 먼저 시작한다
  loading.stage('sim');
  worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    if (ev.data.type === 'result') {
      // 계산은 끝났고 지도만 기다리는 중이면 그렇게 보여 준다
      loading.done('sim');
      mapReady.then(() => onWorker(ev));
    } else onWorker(ev);
  };
  worker.postMessage({
    type: 'init', zones: zoneProps, grid: grid.buffer.slice(0), net: effectiveNetwork(base, state),
    ctx: ctx(), snapshot: state.snapshot, baseline, saved: savedOk,
  }, [...(baseline ? [baseline.bin] : []), ...(savedOk ? [savedOk.bin] : [])]);
  dataStamp = meta?.stamp;

  // 3) 지도
  loading.stage('map');
  const mapReady = createMap('map').then((m) => {
    window.__map = m;
    map = m;
    addLayers(map, zonesFC, linksFC(), { type: 'FeatureCollection', features: [] });
    setNameResolver((level, id, original) => placeName(state, level, id, original));
    refreshNames(map);
    subsReady.then(() => map.getSource('subs').setData(subsFC));
    refreshPoints();
    placesReady.then(resetNamer);
    bindMap();
    bindUI();
    renderAll();
    loading.done('map');
  });
  await mapReady;
  // 콘솔 디버깅용
  window.ukt = { map, base, select, selectBox, get state() { return state; }, get result() { return result; }, get requests() { return requests; } };
}

/** 관광지를 가장 가까운 존(국외는 같은 이름의 거점)에 하루 방문객으로 붙인다 */
function assignTourism(t) {
  if (!t) return;
  for (const s of t.sites) {
    // 존 중심이 아니라 읍면동(소구역) 중심 중 가장 가까운 곳의 존 (안동 하회마을이 예천군으로 가지 않도록)
    let best = -1, bd = Infinity;
    zoneProps.forEach((z, i) => {
      if (z.ext) return;
      for (const [x, y] of z.subs) {
        const d = (x - s.lon) ** 2 + (y - s.lat) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    });
    const daily = (s.visitors * 1e6) / 365;
    const z = zoneProps[best];
    if (s.kp) z.tourKP = (z.tourKP || 0) + daily; else z.tour = (z.tour || 0) + daily;
    (z.sites ||= []).push(s.name);
  }
  for (const [name, v] of Object.entries(t.foreign || {})) {
    const z = zoneProps.find((x) => x.ext && x.name === name);
    if (z) z.tour = (z.tour || 0) + (v * 1e6) / 365;
  }
}

/** 미리 계산한 기준 연도 (데이터 버전이 맞을 때만) */
async function loadBaseline(meta) {
  if (!meta) return null;
  try {
    const json = await fetch('data/baseline.json').then((r) => (r.ok ? r.json() : null));
    if (!json || json.meta?.stamp !== meta.stamp) return null;
    const bin = await fetch('data/baseline.bin').then((r) => r.arrayBuffer());
    return { json, bin };
  } catch { return null; }
}

/** 여러 파일을 받으며 전체 진행률을 알린다 */
class Progress {
  constructor(onChange) { this.onChange = onChange; this.files = new Map(); }

  update() {
    let got = 0, total = 0;
    for (const f of this.files.values()) { got += f.got; total += f.total; }
    this.onChange(total ? got / total : 0);
  }

  async fetch(url, as) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    // 압축 전송이면 Content-Length가 실제 길이보다 작을 수 있어 받은 만큼 늘려 잡는다
    const rec = { got: 0, total: +r.headers.get('Content-Length') || 0 };
    this.files.set(url, rec);
    const reader = r.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      rec.got += value.length;
      if (rec.got > rec.total) rec.total = rec.got;
      this.update();
    }
    rec.total = rec.got;
    this.update();
    const buf = new Uint8Array(rec.got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    return as === 'json' ? JSON.parse(new TextDecoder().decode(buf)) : buf.buffer;
  }
}

/** 처음 불러오는 동안 보이는 화면. 단계: data → sim → map (sim과 map은 함께 진행) */
const loading = {
  item(id) { return document.querySelector(`#loading [data-stage=${id}]`); },
  stage(id) { this.item(id)?.classList.add('now'); },
  progress(id, v) {
    this.stage(id);
    const bar = this.item(id)?.querySelector('.p');
    if (bar) bar.style.width = `${Math.round(v * 100)}%`;
  },
  label(id, text) {
    const t = this.item(id)?.querySelector('.s');
    if (t) t.textContent = text;
  },
  done(id) {
    const li = this.item(id);
    if (!li) return;
    li.classList.remove('now');
    li.classList.add('ok');
    const all = [...document.querySelectorAll('#loading [data-stage]')];
    if (all.every((x) => x.classList.contains('ok'))) {
      const el = document.querySelector('#loading');
      el.classList.add('gone');
      setTimeout(() => el.remove(), 400);
    }
  },
};

function ctx() {
  return { integration: state.integration, policy: state.policy };
}

function resetNamer() {
  const existing = [
    ...base.stations.map(([name]) => ({ name, kind: 'station' })),
    ...(base.metro_stations || []).map(([name]) => ({ name, kind: 'station' })),
    ...base.junctions.map(([name]) => ({ name, kind: 'IC' })),
    ...Object.values(state.names).map((v) => ({ name: v.name, kind: v.kind })),
  ];
  namer = new Namer(places, existing);
}

// ------------------------------------------------------------ 시뮬레이션 결과

function onWorker(ev) {
  const m = ev.data;
  if (m.type === 'progress') {
    setBusy(true, m.label, m.value);
    if (!result) { loading.progress('sim', m.value); loading.label('sim', m.label); }
  }
  else if (m.type === 'error') { setBusy(false); console.error(m.message); alert('시뮬레이션 오류\n' + m.message); }
  else if (m.type === 'result') applyResult(m);
  else if (m.type === 'route') showRoute(m.route);
}

function applyResult(res) {
  loading.done('sim');
  const stepped = result !== null && pendingStep;
  pendingStep = false;
  result = res;
  state.snapshot = res.snapshot;

  const { vc, vol } = res.links;
  for (let i = 0; i < vc.length; i++) {
    map.setFeatureState({ source: 'links', id: i }, { vc: vc[i], vol: vol[i] });
  }
  paintZones();
  paintAir(res.air);

  requests = updateCongestion(base, state, vc, stepped || !state.history.length);
  const prevHappy = happiness ? avgHappiness() : null;
  happiness = computeHappiness(res);
  if (stepped) {
    if (DIFFICULTY[state.difficulty].autoApprove) autoApprove();
    updateApproval(state, requests, res.summary, prevSummary);
    // 주민 행복도가 오르면 지지율도 오른다
    updateAirRoutes(state, res.air, airportName);
    if (prevHappy) state.approval = Math.max(0, Math.min(100, state.approval + 0.5 * (avgHappiness().all - prevHappy.all)));
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
      air: res.totals.air / res.totals.trips, road: res.totals.road / res.totals.trips, transit: res.totals.transit / res.totals.trips,
      happyKR: avgHappiness().KR, happyKP: avgHappiness().KP, debt: state.debt, approval: state.approval,
    });
  }
  save(state);
  if (res.sim) saveSim({ year: state.year, stamp: dataStamp, sizes: res.sim.sizes, totals: res.totals, bin: res.sim.bin });
  setBusy(false);
  renderAll();
}

let pendingStep = false;

function nextYear() {
  if (busy || !result) return;
  cancelDraft();
  const done = advanceBudgetYear(base, state);
  if (done.some((p) => p.kind === 'rename')) refreshNames(map);
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

/**
 * 존별 주민 행복도 (0~100): HDI, 접근성, 대중교통 접근, 소득 증가, 사업 효과(옛 이름 되찾기 등)
 */
function computeHappiness(res) {
  const z = res.zones, s = res.subs, Z = zoneProps.length;
  const accRef = median(Array.from(z.access));
  const transit = new Float64Array(Z), wsum = new Float64Array(Z);
  zoneProps.forEach((zp, i) => zp.subs.forEach((_, k) => {
    const sid = zp.sub0 + k;
    if (!(s.pop[sid] > 0)) return;
    transit[i] += Math.min(s.transit[sid], 120) * s.pop[sid];
    wsum[i] += s.pop[sid];
  }));
  const h = new Float64Array(Z);
  for (let i = 0; i < Z; i++) {
    const tr = wsum[i] ? transit[i] / wsum[i] : 60;
    const growth = lastIncome ? Math.min(1, Math.max(0, 0.5 + (z.income[i] / lastIncome[i] - 1) * 5)) : 0.5;
    h[i] = 100 * (0.55 * z.hdi[i] + 0.15 * Math.min(1, z.access[i] / accRef) + 0.15 * Math.exp(-tr / 25) + 0.15 * growth)
      + (state.happyBonus?.[i] || 0);
  }
  lastIncome = Float64Array.from(z.income);
  return h;
}

function avgHappiness() {
  const p = result.zones.pop;
  const out = { KR: [0, 0], KP: [0, 0], all: 0 };
  zoneProps.forEach((zp, i) => { if (zp.ext) return; const c = out[zp.country]; c[0] += happiness[i] * p[i]; c[1] += p[i]; });
  const tot = out.KR[1] + out.KP[1];
  out.all = (out.KR[0] + out.KP[0]) / tot;
  out.KR = out.KR[0] / out.KR[1];
  out.KP = out.KP[0] / out.KP[1];
  return out;
}

function zoneName(i) { return placeName(state, 'zone', i, zoneProps[i].name); }

/** 공항(원 크기 = 여객)과 주요 항공 노선 */
function paintAir(air) {
  const aps = effectiveNetwork(base, state).airports;
  const byId = new Map(aps.map((a) => [a.id, a]));
  const pts = aps.map((a) => {
    const k = air.ids.indexOf(a.id);
    const pax = k >= 0 ? air.pax[k] : 0;
    return { type: 'Feature', properties: { id: a.id, name: a.name, pax, vc: pax / ((a.cap * 1e6) / 365), ext: a.ext ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] } };
  });
  const lines = air.routes.map(([a, b, v]) => {
    const A = byId.get(air.ids[a]), B = byId.get(air.ids[b]);
    return { type: 'Feature', properties: { pax: v }, geometry: { type: 'LineString', coordinates: arc(A, B) } };
  });
  map.getSource('airports').setData({ type: 'FeatureCollection', features: pts });
  map.getSource('airroutes').setData({ type: 'FeatureCollection', features: lines });
}

// 항공 노선은 살짝 휜 호로 그린다
function arc(a, b) {
  const mx = (a.lon + b.lon) / 2, my = (a.lat + b.lat) / 2;
  const dx = b.lon - a.lon, dy = b.lat - a.lat;
  const cx = mx - dy * 0.15, cy = my + dx * 0.15;
  const out = [];
  for (let t = 0; t <= 1.0001; t += 0.1) {
    out.push([(1 - t) ** 2 * a.lon + 2 * (1 - t) * t * cx + t * t * b.lon, (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * cy + t * t * b.lat]);
  }
  return out;
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
    if (state.replaced?.[i] || l.replaced) {
      const p0 = [l.geom[0], l.geom[1]];   // 길이 0인 선: 그려지지 않는다
      return { type: 'Feature', id: i, properties: { id: i, mode: -1 }, geometry: { type: 'LineString', coordinates: [p0, p0] } };
    }
    const g = l.geom;
    const coords = [];
    const parts = [[]];
    for (let k = 0; k < g.length; k += 2) {
      if (Number.isNaN(g[k])) parts.push([]);
      else parts[parts.length - 1].push([g[k], g[k + 1]]);
    }
    return {
      type: 'Feature', id: i,
      properties: { id: i, mode: eff.mode, cls: eff.cls, building: building.has(i) || eff.open > state.year ? 1 : 0, colour: eff.colour || '', ext: eff.ext ? 1 : 0 },
      geometry: parts.length > 1 ? { type: 'MultiLineString', coordinates: parts } : { type: 'LineString', coordinates: parts[0] },
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
  for (const [name, node] of base.metro_stations || []) if (!out.has(node)) out.set(node, { name, kind: 'station', isNew: 0, metro: 1 });
  for (const [name, node] of base.junctions) {
    if (out.has(node)) continue;
    out.set(node, { name, kind: /JCT|분기점/.test(name) ? 'JCT' : 'IC', isNew: 0 });
  }
  for (const f of base.foreignNodes || []) out.set(f.node, { name: f.name, kind: 'city', isNew: 0, country: f.country });
  for (const [k, v] of Object.entries(state.names)) out.set(+k, { name: v.name, kind: v.kind, isNew: 1 });
  (state.restAreas || []).forEach((r, i) => out.set(`rest${i}`, { name: r.name + (r.built ? '' : ' (공사 중)'), kind: 'rest', isNew: 1, coord: [r.lon, r.lat] }));
  return out;
}

function refreshPoints() {
  const features = [];
  for (const [node, v] of nodeNames()) {
    const c = v.coord || nodeCoord(node);
    if (!c) continue;
    features.push({ type: 'Feature', properties: { node, ...v }, geometry: { type: 'Point', coordinates: c } });
  }
  map.getSource('points').setData({ type: 'FeatureCollection', features });
}

/** 인구 밀도 격자 레이어 (처음 켤 때 한 번 만든다) */
function showDensity(on) {
  map.setLayoutProperty('grid-heat', 'visibility', on ? 'visible' : 'none');
  if (!on || map.__gridLoaded) return;
  const features = [];
  for (let k = 0; k < grid.length; k += 4) {
    if (grid[k + 2] < 200) continue;
    features.push({ type: 'Feature', properties: { p: grid[k + 2] }, geometry: { type: 'Point', coordinates: [grid[k], grid[k + 1]] } });
  }
  map.getSource('grid').setData({ type: 'FeatureCollection', features });
  map.__gridLoaded = true;
}

function paintZones() {
  showDensity(metric === 'density');
  const sub = !!METRICS[metric]?.sub;
  for (const l of ['subs-fill', 'subs-line']) map.setLayoutProperty(l, 'visibility', sub ? 'visible' : 'none');
  if (!result) return;
  if (sub) {
    const s = result.subs;
    for (let i = 0; i < s.pop.length; i++) {
      let v;
      if (metric === 'subDensity') v = s.pop[i] / subArea(i);
      else if (metric === 'subChange') v = s.pop[i] / Math.max(subPop0[i], 1) - 1;
      else v = s.transit[i];
      map.setFeatureState({ source: 'subs', id: i }, { color: colorFor(metric, v) });
    }
  }
  const z = result.zones;
  const accRef = median(Array.from(z.access));
  for (let i = 0; i < zoneProps.length; i++) {
    let v = null;
    if (metric === 'pop') v = z.pop[i];
    else if (metric === 'popChange') v = z.pop[i] / Math.max(zoneProps[i].pop, 1) - 1;
    else if (metric === 'hdi') v = z.hdi[i];
    else if (metric === 'income') v = z.income[i];
    else if (metric === 'access') v = z.access[i] / accRef;
    else if (metric === 'happiness') v = happiness?.[i];
    map.setFeatureState({ source: 'zones', id: i }, { color: sub ? null : colorFor(metric, v) });
  }
}

let subIndex = null;
/** 소구역 번호 → [존, 존 안 순번] */
function subInfo(i) {
  if (!subIndex) {
    subIndex = [];
    zoneProps.forEach((zp, z) => zp.subs.forEach((_, k) => subIndex.push([z, k])));
  }
  return subIndex[i];
}

function subArea(i) {
  const [z, k] = subInfo(i);
  return Math.max(zoneProps[z].subs[k][3] ?? 1, 0.05);
}

// ------------------------------------------------------------ 지도 상호작용

function bindMap() {
  map.on('click', (e) => {
    if (measure) { measureClick(e.lngLat); return; }
    if (draft?.type === 'airport') { placeAirport(e.lngLat); return; }
    if (draft) { addDraftPoint(e.lngLat); return; }
    const box = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
    const ap = map.queryRenderedFeatures(box, { layers: ['airports'] })[0];
    if (ap) return select({ type: 'airport', id: ap.properties.id });
    const pt = map.queryRenderedFeatures(box, { layers: ['points'] })[0];
    if (pt) return select({ type: 'node', id: pt.properties.node });
    const ln = map.queryRenderedFeatures(box, { layers: ['rails', 'metro', 'roads', 'ferries', 'ext-links', 'links-building'] })[0];
    if (ln) return select({ type: 'link', id: ln.properties.id });
    if (METRICS[metric]?.sub) {
      const sb = map.queryRenderedFeatures(e.point, { layers: ['subs-fill'] })[0];
      if (sb) return select({ type: 'sub', id: sb.id });
    }
    const zn = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
    if (zn) return select({ type: 'zone', id: zn.id });
    select(null);
  });
  map.on('dblclick', (e) => { if (draft) { e.preventDefault(); } });
  enableBoxSelect();
  for (const l of ['roads', 'rails', 'metro', 'points']) {
    map.on('mouseenter', l, () => { if (!draft) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { if (!draft) map.getCanvas().style.cursor = ''; });
  }
}

/** Shift를 누른 채 끌면 사각형 안의 도로·철도 구간을 한꺼번에 고른다 */
function enableBoxSelect() {
  map.boxZoom.disable();
  const canvas = map.getCanvasContainer();
  let start = null, box = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('mousedown', (e) => {
    if (!e.shiftKey || e.button !== 0 || draft) return;
    e.preventDefault();
    map.dragPan.disable();
    start = pos(e);
    box = document.createElement('div');
    box.className = 'select-box';
    canvas.appendChild(box);
  }, true);
  window.addEventListener('mousemove', (e) => {
    if (!start) return;
    const [x, y] = pos(e);
    Object.assign(box.style, {
      left: `${Math.min(x, start[0])}px`, top: `${Math.min(y, start[1])}px`,
      width: `${Math.abs(x - start[0])}px`, height: `${Math.abs(y - start[1])}px`,
    });
  });
  window.addEventListener('mouseup', (e) => {
    if (!start) return;
    const end = pos(e);
    box.remove(); box = null;
    map.dragPan.enable();
    const bbox = [[Math.min(start[0], end[0]), Math.min(start[1], end[1])], [Math.max(start[0], end[0]), Math.max(start[1], end[1])]];
    start = null;
    if (bbox[1][0] - bbox[0][0] < 5 && bbox[1][1] - bbox[0][1] < 5) return;
    selectBox(bbox);
  });
}

/** 화면 좌표 사각형 안의 구간들을 고른다 (QA·키보드 없이도 쓸 수 있게 따로 둔다) */
function selectBox(bbox) {
  const ids = [...new Set(map.queryRenderedFeatures(bbox, { layers: ['roads', 'rails', 'metro'] }).map((f) => f.properties.id))];
  if (ids.length) select({ type: 'multi', ids });
}

function select(sel) {
  if (selection?.type === 'multi') for (const i of selection.ids) map.setFeatureState({ source: 'links', id: i }, { sel: false });
  if (sel?.type === 'multi') for (const i of sel.ids) map.setFeatureState({ source: 'links', id: i }, { sel: true });
  if (selection?.type === 'link') map.setFeatureState({ source: 'links', id: selection.id }, { sel: false });
  if (selection?.type === 'zone') map.setFeatureState({ source: 'zones', id: selection.id }, { sel: false });
  if (selection?.type === 'sub') map.setFeatureState({ source: 'subs', id: selection.id }, { sel: false });
  selection = sel;
  if (sel?.type === 'sub') map.setFeatureState({ source: 'subs', id: sel.id }, { sel: true });
  if (sel?.type === 'link') map.setFeatureState({ source: 'links', id: sel.id }, { sel: true });
  if (sel?.type === 'zone') map.setFeatureState({ source: 'zones', id: sel.id }, { sel: true });
  renderSelection();
}

// ------------------------------------------------------------ 신설 그리기

function startDraft(type) {
  if (!namer) { alert('지명 데이터를 아직 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'); return; }
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

/** 공항 신설: 한 번 누른 곳에 공항을 놓는다 */
function placeAirport(lngLat) {
  const p = namer.nearbyPlaces(lngLat.lng, lngLat.lat)[0];
  const name = `${p ? p[0].replace(/(특별시|광역시|직할시|시|군|구|읍|면|동|리)$/, '') : '신'}공항`;
  if (!confirm(`${name}을(를) 신설할까요? ${formatWon(AIRPORT.build.cost)} · ${AIRPORT.build.years}년`)) return;
  const r = startAirport(state, { lon: lngLat.lng, lat: lngLat.lat, name });
  if (!r.ok) { alert(r.reason); return; }
  cancelDraft();
  save(state); renderAll(); switchTab('projects');
}

/** 누른 곳에서 가까운 같은 수단 구간 위의 점 (화면 거리 maxPx 안) */
function nearestOnLink(lngLat, mode, maxPx) {
  const p = map.project(lngLat);
  const layers = mode === 0 ? ['roads'] : mode === 1 ? ['rails'] : ['metro'];
  const box = [[p.x - maxPx, p.y - maxPx], [p.x + maxPx, p.y + maxPx]];
  const work = linksUnderWork(state);
  let best = null;
  for (const f of map.queryRenderedFeatures(box, { layers })) {
    const id = f.properties.id;
    if (work.has(id) || draft.points.some((q) => q.split === id)) continue;
    const g = allLinks()[id].geom;
    for (let k = 0; k + 3 < g.length; k += 2) {
      if (Number.isNaN(g[k]) || Number.isNaN(g[k + 2])) continue;
      const a = map.project([g[k], g[k + 1]]), b = map.project([g[k + 2], g[k + 3]]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
      if (d <= maxPx && (!best || d < best.d)) {
        best = { d, link: id, lngLat: map.unproject([a.x + t * dx, a.y + t * dy]) };
      }
    }
  }
  return best;
}

// ------------------------------------------------------------ 두 지점 소요 시간

function startMeasure() {
  cancelDraft();
  measure = { from: null, to: null };
  map.getCanvas().style.cursor = 'crosshair';
  select(null);
  $('#selection').hidden = false;
  $('#selection').innerHTML = `${header('소요 시간 측정')}<p class="hint">출발지를 지도에서 누르세요.</p>`;
  $('#selection .close').onclick = endMeasure;
}

function endMeasure() {
  measure = null;
  map.getCanvas().style.cursor = '';
  map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  select(null);
}

function measureClick(ll) {
  const p = [ll.lng, ll.lat];
  if (!measure.from || measure.to) {
    measure = { from: p, to: null };
    $('#selection').innerHTML = `${header('소요 시간 측정')}<p class="hint">도착지를 누르세요.</p>`;
  } else {
    measure.to = p;
    $('#selection').innerHTML = `${header('소요 시간 측정')}<p class="hint">계산 중…</p>`;
    worker.postMessage({ type: 'route', from: measure.from, to: measure.to });
  }
  $('#selection .close').onclick = endMeasure;
  const pts = [measure.from, measure.to].filter(Boolean).map((c) => ({ type: 'Feature', properties: { k: 'pt' }, geometry: { type: 'Point', coordinates: c } }));
  map.getSource('route').setData({ type: 'FeatureCollection', features: pts });
}

function fmtMin(m) {
  if (!isFinite(m)) return '–';
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h ? `${h}시간 ${mm}분` : `${mm}분`;
}

function showRoute(r) {
  if (!measure) return;
  const name = (k) => ({ car: '승용차', rail: '철도', transit: '버스·도시철도', air: '항공' }[k]);
  const rows = ['car', 'rail', 'transit', 'air'].filter((k) => r[k]).sort((a, b) => r[a].min - r[b].min);
  const best = rows[0];
  const detail = (k) => {
    const v = r[k];
    if (k === 'car') return `${v.km.toFixed(0)}km · 유류비 등 약 ${Math.round(v.cost / 1000).toLocaleString()}천원`;
    if (k === 'rail') {
      const st = (i) => esc(nodeNames().get(result.stations.node[i])?.name || '');
      return `${st(v.s)}→${st(v.t)} · 대기 ${Math.round(v.wait)}분 · 약 ${Math.round(v.cost / 1000)}천원`;
    }
    if (k === 'air') return `${esc(airportName(v.a))}→${esc(airportName(v.b))} · 하루 ${v.freq}편 · 약 ${Math.round(v.cost / 1000)}천원`;
    return `약 ${Math.round(v.cost / 100) * 100}원`;
  };
  $('#selection').innerHTML = `${header('소요 시간 측정')}
    <p class="hint">직선거리 ${r.crowKm.toFixed(0)}km · 올해 혼잡 반영</p>
    <table class="kv">${rows.map((k) => `<tr><td>${k === best ? '<b>' : ''}${name(k)}${k === best ? '</b>' : ''}<div class="m">${detail(k)}</div></td><td>${fmtMin(r[k].min)}</td></tr>`).join('')
      || '<tr><td>이을 수단이 없습니다</td><td></td></tr>'}</table>
    <p class="hint">다른 두 지점을 누르면 다시 잽니다. 닫기를 누르면 끝납니다.</p>`;
  $('#selection .close').onclick = endMeasure;
  const feats = [measure.from, measure.to].map((c) => ({ type: 'Feature', properties: { k: 'pt' }, geometry: { type: 'Point', coordinates: c } }));
  for (const k of ['car', 'rail']) {
    if (!r[k]) continue;
    for (const id of r[k].links) {
      const g = allLinks()[id].geom, parts = [[]];
      for (let i = 0; i < g.length; i += 2) {
        if (Number.isNaN(g[i])) parts.push([]); else parts[parts.length - 1].push([g[i], g[i + 1]]);
      }
      feats.push({ type: 'Feature', properties: { k }, geometry: { type: 'MultiLineString', coordinates: parts } });
    }
  }
  map.getSource('route').setData({ type: 'FeatureCollection', features: feats });
}

function addDraftPoint(lngLat) {
  const spec = NEW_BUILDS[draft.type];
  let node = snap.node ? nearestNode(lngLat, spec.mode, 14) : null;
  let split = null;
  if (node == null && snap.line) {
    const on = nearestOnLink(lngLat, spec.mode, 10);
    if (on) { split = on.link; lngLat = on.lngLat; }
  }
  // 도로는 끝점이 기존 도로망에 붙어야 하므로 첫 점이 허공이면 20km 안의 가장 가까운 노드로 붙인다
  if (node == null && split == null && spec.mode === 0 && draft.points.length === 0) node = nearestNode(lngLat, 0, null, 20);
  const c = node != null ? nodeCoord(node) : [lngLat.lng, lngLat.lat];
  const pt = { node, lon: c[0], lat: c[1], split };
  draft.points.push(pt);
  nameDraftPoint(pt, draft.points.length - 1);
  drawDraft();
  renderBuild();
}

function nameDraftPoint(pt) {
  const spec = NEW_BUILDS[draft.type];
  const existing = pt.node != null ? nodeNames().get(pt.node) : null;
  if (spec.mode >= 1) {
    if (existing && existing.kind === 'station') { pt.name = existing.name; pt.kind = 'station'; pt.existing = true; return; }
    pt.kind = 'station';
    pt.name = namer.suggest(pt.lon, pt.lat, 'station');
    pt.reserved = true;
  } else if (pt.node != null || pt.split != null) {
    if (existing && existing.kind !== 'station') { pt.name = existing.name; pt.kind = existing.kind; pt.existing = true; return; }
    // 고속도로끼리 만나면 JCT, 고속도로와 일반도로가 만나면 IC
    const newMw = draft.type === 'motorway' || draft.type === 'tunnelRoad';
    const touchesMotorway = pt.split != null ? linkAt(base, state, pt.split).cls === 'motorway'
      : allLinks().some((l, i) => l.mode === 0 && (l.a === pt.node || l.b === pt.node) && linkAt(base, state, i).cls === 'motorway');
    pt.kind = newMw && touchesMotorway ? 'JCT' : newMw || touchesMotorway ? 'IC' : null;
    if (!pt.kind) { pt.name = null; return; }
    pt.name = namer.suggest(pt.lon, pt.lat, pt.kind);
    pt.reserved = true;
  } else {
    pt.kind = null; pt.name = null;
  }
}

function drawDraft() {
  const f = draft.points.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
  if (draft.points.length > 1) {
    const line = smoothSegments(draft.points).flatMap((seg, i) => (i ? seg.slice(1) : seg));
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
  }
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
}

function draftCost() {
  const spec = NEW_BUILDS[draft.type];
  let km = 0, cost = 0, foreignKm = 0;
  const segs = smoothSegments(draft.points);
  const segFactor = [];
  for (let i = 0; i + 1 < draft.points.length; i++) {
    const a = draft.points[i], b = draft.points[i + 1];
    const len = polylineKm(segs[i]) * 1.02;
    const kp = isKP(a.lat, a.lon) && isKP(b.lat, b.lon);
    const frac = segs[i].filter(([x, y]) => isForeign(x, y)).length / segs[i].length;
    segFactor.push(1 - 0.5 * frac);
    foreignKm += len * frac;
    km += len; cost += spec.perKm * len * (kp ? KP_COST_FACTOR : 1) * segFactor[i];
  }
  const mids = draft.points.filter((p) => p.split != null).length;
  const rests = restPositions(segs).length;
  const extraCost = mids * (spec.mode === 0 ? MID_COST.road : MID_COST.rail) + rests * REST.cost;
  return { km, cost: Math.round(cost) + extraCost, extraCost, mids, rests, years: spec.years, segFactor, foreignKm };
}

/** 고속도로 휴게소 자리: 곡선을 따라 약 40km마다 (양 끝 20km 안쪽 제외) */
function restPositions(segs) {
  if (!draft || !['motorway', 'tunnelRoad'].includes(draft.type)) return [];
  const line = segs.flatMap((s, i) => (i ? s.slice(1) : s));
  const total = polylineKm(line);
  const out = [];
  let acc = 0, next = REST.spacingKm;
  for (let k = 0; k + 1 < line.length; k++) {
    const d = kmBetween(line[k][0], line[k][1], line[k + 1][0], line[k + 1][1]);
    while (acc + d >= next && next <= total - REST.spacingKm / 2) {
      const t = (next - acc) / d;
      const lon = line[k][0] + t * (line[k + 1][0] - line[k][0]), lat = line[k][1] + t * (line[k + 1][1] - line[k][1]);
      if (!isForeign(lon, lat)) out.push([lon, lat]);
      next += REST.spacingKm;
    }
    acc += d;
  }
  return out;
}

/** 노선 끝 도시 이름: 국외 거점이면 그 도시, 아니면 가까운 시·군 */
function endCity(p) {
  const f = (base.foreignNodes || []).find((x) => x.node === p.node);
  if (f) return f.name;
  const near = namer.nearbyPlaces(p.lon, p.lat, 40, 12).find((q) => q[1] === 'city') || namer.nearbyPlaces(p.lon, p.lat)[0];
  return near ? near[0] : '신설';
}

function usedLineNames() {
  return new Set(allLinks().map((l) => l.name).filter(Boolean));
}

/** 그리는 노선의 첫 점이나 끝점이 같은 종류 기존 노선의 종점이면 그 노선 이름 (연장 후보) */
function extensionOf() {
  if (!draft || draft.points.length < 2) return null;
  const spec = NEW_BUILDS[draft.type];
  for (const p of [draft.points[0], draft.points[draft.points.length - 1]]) {
    if (p.node == null) continue;
    const count = new Map();
    for (const l of allLinks()) {
      if ((l.a !== p.node && l.b !== p.node) || l.mode !== spec.mode || l.cls !== spec.attrs.cls || !l.name || l.ext) continue;
      count.set(l.name, (count.get(l.name) || 0) + 1);
    }
    // 그 점에서 한 구간만 뻗는 노선 = 종점
    for (const [name, n] of count) if (n === 1) return name;
  }
  return null;
}

/** 그리는 중인 노선의 이름 (직접 고쳤으면 그 이름, 기존선 연장이면 그 노선 이름) */
function draftLineName() {
  if (draft.lineNameEdited) return draft.lineName;
  if (draft.points.length < 2) return '';
  const ext = draft.extend !== false ? extensionOf() : null;
  draft.extendOf = ext;
  if (ext) draft.lineName = ext;
  else {
    const a = endCity(draft.points[0]), b = endCity(draft.points[draft.points.length - 1]);
    draft.lineName = autoLineName(draft.type, a, b, usedLineNames());
  }
  return draft.lineName;
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
  const dc = draftCost();
  if (!canAfford(state, dc.cost, dc.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const lineName = draftLineName();
  let split = false;
  for (const p of draft.points) {
    if (p.split == null) continue;
    p.node = splitLink(base, state, p.split, p.lon, p.lat);
    split = true;
  }
  const restAreas = restPositions(smoothSegments(draft.points)).map(([lon, lat]) => ({ lon, lat, name: namer.suggest(lon, lat, 'rest') }));
  const r = startNewBuild(base, state, { type: draft.type, points: draft.points, names, lineName, extendOf: draft.extendOf, segFactor: dc.segFactor, extraCost: dc.extraCost, restAreas });
  if (split) refreshLinks();
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
  $('#btn-measure').onclick = () => (measure ? endMeasure() : startMeasure());
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
  renderTop(); renderLegend(); renderStatus(); renderBuild(); renderProjects(); renderRequests(); renderSettings(); renderStats(); renderSelection();
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
      ${happiness ? (() => { const a = avgHappiness(); return `<tr><td>주민 행복도</td><td>${a.KR.toFixed(1)}</td><td>${a.KP.toFixed(1)}</td><td>${a.all.toFixed(1)}</td></tr>`; })() : ''}
    </table>
    <h4>교통</h4>
    <table class="kv">
      <tr><td>지역 간 통행 (일)</td><td>${fmtPop(t.trips)} 통행</td></tr>
      <tr><td>수단 분담 (승용차·철도·대중교통)</td><td>${pct(t.road / t.trips, 0)} · ${pct(t.rail / t.trips, 0)} · ${pct(t.transit / t.trips, 0)}</td></tr>
      <tr><td>남북 간 통행 (일)</td><td>${fmtPop(t.kpkr)} 통행</td></tr>
      <tr><td>항공 · 국제 통행 (일)</td><td>${fmtPop(t.air || 0)} · ${fmtPop(t.intl || 0)}</td></tr>
      <tr><td>관광 통행 (일)</td><td>${fmtPop(t.tour || 0)} <span class="m">입국 ${fmtPop(t.tourIn || 0)} · 출국 ${fmtPop(t.tourOut || 0)}</span></td></tr>
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
    `<button data-build="${k}" class="${draft?.type === k ? 'on' : ''}">${v.label}<span class="c">${formatWon(v.perKm)}/km · ${v.years}년</span></button>`).join('')
    + `<button data-build="airport" class="${draft?.type === 'airport' ? 'on' : ''}">${AIRPORT.build.label}<span class="c">${formatWon(AIRPORT.build.cost)} · ${AIRPORT.build.years}년</span></button>`;
  let body = `<p class="hint">기존 도로·철도를 개량하려면 지도에서 구간을 누르세요. <b>Shift를 누른 채 끌면</b> 여러 구간을 한꺼번에 골라 개량할 수 있습니다. 새 노선을 놓으려면 아래에서 종류를 고른 뒤 지도를 차례로 누르세요.</p>`;
  if (draft) {
    if (draft.type === 'airport') {
      el.innerHTML = `<h4>${AIRPORT.build.label}</h4><p class="hint">공항을 놓을 곳을 지도에서 한 번 누르세요. ${formatWon(AIRPORT.build.cost)} · ${AIRPORT.build.years}년 · 연 ${AIRPORT.build.cap}백만 명. Esc: 취소</p>
        <button id="draft-cancel">취소</button>`;
      $('#draft-cancel').onclick = cancelDraft;
      return;
    }
    const spec = NEW_BUILDS[draft.type];
    const { km, cost, years, foreignKm } = draftCost();
    const affordable = canAfford(state, cost, years);
    const lineName = draftLineName();
    body = `<h4>${spec.label}</h4>
      ${lineName ? `<div class="name-row"><span class="kind">노선</span><input type="text" id="line-name" value="${esc(lineName)}"></div>` : ''}
      ${draft.extendOf || draft.extend === false ? `<div class="name-row"><label><input type="checkbox" id="draft-extend" ${draft.extendOf ? 'checked' : ''}>
        기존 노선의 연장으로 놓기${draft.extendOf ? ` (${esc(draft.extendOf)})` : ''}</label></div>` : ''}
      ${draft.points.length > 1 ? `<p class="hint">${draft.extendOf ? `기존선 연장: ${esc(draft.extendOf)}의 종점에서 이어 같은 노선 이름을 씁니다.` : '신설 노선: 새 노선 이름을 붙입니다.'}</p>` : ''}
      <p class="hint">기존 ${spec.mode ? '선로' : '도로'} 근처를 누르면 연결됩니다. ${spec.mode ? '각 점은 역이 됩니다.' : '도로는 양 끝을 기존 도로에 붙여야 합니다.'}
      Backspace: 마지막 점 지우기 · Enter: 착공 · Esc: 취소</p>
      <div>${draft.points.map((p, i) => pointRow(p, i)).join('') || '<p class="hint">시작점을 누르세요.</p>'}</div>
      <table class="kv" style="margin-top:8px">
        <tr><td>길이</td><td>${km.toFixed(1)} km</td></tr>
        <tr><td>사업비</td><td>${formatWon(cost)}</td></tr>
        <tr><td>공사 기간 · 연 분담</td><td>${years}년 · ${formatWon(cost / years)}</td></tr>
        ${foreignKm > 0.5 ? `<tr><td>외국 구간 (상대국 절반 부담)</td><td>${foreignKm.toFixed(0)} km</td></tr>` : ''}
        ${draftCost().mids ? `<tr><td>중간 ${spec.mode === 0 ? 'IC' : '역'} ${draftCost().mids}곳</td><td>${formatWon(draftCost().mids * (spec.mode === 0 ? MID_COST.road : MID_COST.rail))}</td></tr>` : ''}
        ${draftCost().rests ? `<tr><td>휴게소 ${draftCost().rests}곳 (약 ${REST.spacingKm}km마다)</td><td>${formatWon(draftCost().rests * REST.cost)}</td></tr>` : ''}
      </table>
      <div class="name-row"><label><input type="checkbox" id="snap-node" ${snap.node ? 'checked' : ''}> 노드에 붙이기</label>
        <label><input type="checkbox" id="snap-line" ${snap.line ? 'checked' : ''}> 선 위에 붙이기 (중간 ${spec.mode === 0 ? 'IC' : '역'})</label></div>
      <p class="hint">노란 점(◆)은 중국·러시아·일본 거점 도시입니다. 끝점을 거점에 붙이면 국제 노선이 됩니다.
        기존 ${spec.mode ? '선로' : '도로'} 중간을 누르면 그 자리에 ${spec.mode === 0 ? 'IC·JCT' : '역'}를 만들고 이어집니다.</p>
      ${!affordable && draft.points.length > 1 ? '<p class="hint neg">예산과 차입 한도를 넘습니다.</p>' : ''}
      <div class="row" style="display:flex;gap:6px;margin-top:8px">
        <button class="primary" id="draft-ok" ${draft.points.length < 2 || !affordable ? 'disabled' : ''}>착공</button>
        <button id="draft-cancel">취소</button>
      </div>`;
  }
  const restore = historic.length ? `<h4>옛 이름 되찾기</h4>
    <p class="hint">북측에서 지도자 이름이나 선전 구호로 바뀐 지명을 바뀌기 전 이름으로 돌립니다. 표지판·행정 문서·지도를 바꾸는 데 예산이 들고, 완공되면 그 지역 주민 행복도가 오릅니다.</p>
    <div class="list">${historic.map((t) => restoreRow(t)).join('')}</div>` : '';
  el.innerHTML = `<div class="tools">${tools}</div>${body}${draft ? '' : restore}`;
  bindRestore(el);
  el.querySelectorAll('[data-build]').forEach((b) => { b.onclick = () => startDraft(b.dataset.build); });
  if (draft) {
    $('#draft-ok').onclick = commitDraft;
    $('#snap-node').onchange = (e) => { snap.node = e.target.checked; };
    $('#snap-line').onchange = (e) => { snap.line = e.target.checked; };
    const ln = $('#line-name');
    if (ln) ln.onchange = () => { draft.lineName = ln.value.trim() || draft.lineName; draft.lineNameEdited = true; };
    const ex = $('#draft-extend');
    if (ex) ex.onchange = () => { draft.extend = ex.checked; draft.lineNameEdited = false; renderBuild(); };
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
    const toggle = spec.mode >= 1 ? `<button class="small" data-ptoggle="${i}">역 설치</button>` : '';
    return `<div class="name-row"><span class="kind">${tag}</span><span style="flex:1;color:var(--muted)">경유점 ${i + 1}</span>${toggle}</div>`;
  }
  if (p.existing) return `<div class="name-row"><span class="kind">${tag}</span><span style="flex:1">${esc(p.name)}</span></div>`;
  const toggle = spec.mode >= 1 && i > 0 && i < draft.points.length - 1 ? `<button class="small" data-ptoggle="${i}">통과</button>` : '';
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
    <div class="list">${requests.map((r, i) => {
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
    for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) { xs.push(g[k]); ys.push(g[k + 1]); }
  }
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 11 });
  select({ type: 'link', id: ids[0] });
}

/** 통계 탭: 항공·철도·도로 순위와 연도별 추이 */
function renderStats() {
  const el = $('[data-panel=stats]');
  if (!el) return;
  if (!result) { el.innerHTML = '<p class="hint">계산 중입니다…</p>'; return; }
  const air = result.air, seats = air.seats;
  const totalAir = air.routes.reduce((s, r) => s + r[2], 0);
  const aps = effectiveNetwork(base, state).airports;
  const country = (id) => aps.find((a) => a.id === id)?.country;
  const intlPax = air.routes.filter(([a, b]) => country(air.ids[a]) !== country(air.ids[b])).reduce((s, r) => s + r[2], 0);
  const routeRows = air.routes.slice(0, 15).map(([a, b, pax, f]) =>
    `<tr><td>${esc(airportName(air.ids[a]))}–${esc(airportName(air.ids[b]))}</td><td>${f}</td><td>${pax.toLocaleString()}</td><td>${Math.round(pax / (2 * f * seats) * 100)}%</td></tr>`).join('');
  const apRows = air.ids.map((id, k) => [id, air.pax[k], air.cap[k]]).sort((x, y) => y[1] - x[1]).slice(0, 10)
    .map(([id, pax, cap]) => `<tr><td>${esc(airportName(id))}</td><td>${Math.round(pax).toLocaleString()}</td><td class="${pax > cap ? 'neg' : ''}">${(pax / cap).toFixed(2)}</td></tr>`).join('');
  const latentRows = air.latent.slice(0, 8).map(([a, b, pax]) =>
    `<tr><td>${esc(airportName(air.ids[a]))}–${esc(airportName(air.ids[b]))}</td><td>${pax.toLocaleString()}</td></tr>`).join('');
  // 철도역
  const nn = nodeNames();
  const stRows = [...result.stations.node].map((nd, k) => [nn.get(nd)?.name || '', result.stations.riders[k]])
    .sort((x, y) => y[1] - x[1]).slice(0, 10).map(([n, v]) => `<tr><td>${esc(n)}</td><td>${Math.round(v).toLocaleString()}</td></tr>`).join('');
  // 노선별 최대 이용객·혼잡 (같은 이름끼리)
  const byName = (mode) => {
    const m = new Map();
    allLinks().forEach((l, i) => {
      const e = linkAt(base, state, i);
      if (e.mode !== mode || !e.name || e.ext || i >= result.links.vc.length) return;
      const cur = m.get(e.name) || { vol: 0, vc: 0, cls: e.cls };
      cur.vol = Math.max(cur.vol, result.links.vol[i]); cur.vc = Math.max(cur.vc, result.links.vc[i]);
      m.set(e.name, cur);
    });
    return [...m.entries()];
  };
  const railRows = byName(1).sort((x, y) => y[1].vol - x[1].vol).slice(0, 10)
    .map(([n, v]) => `<tr><td>${esc(n)}</td><td>${Math.round(v.vol).toLocaleString()}</td><td class="${v.vc > 1 ? 'neg' : ''}">${v.vc.toFixed(2)}</td></tr>`).join('');
  const roadRows = byName(0).filter(([, v]) => v.cls === 'motorway' || v.cls === 'trunk').sort((x, y) => y[1].vc - x[1].vc).slice(0, 10)
    .map(([n, v]) => `<tr><td>${esc(n)}</td><td>${Math.round(v.vol).toLocaleString()}</td><td class="${v.vc > 1 ? 'neg' : ''}">${v.vc.toFixed(2)}</td></tr>`).join('');
  const h = state.history;
  el.innerHTML = `
    <h3>항공</h3>
    <table class="kv">
      <tr><td>운항 노선</td><td>${air.routes.length}개 (${state.air.auto ? '자동 운영' : '수동'})</td></tr>
      <tr><td>하루 항공 여객</td><td>${Math.round(totalAir).toLocaleString()}명 (국제선 ${pct(intlPax / Math.max(totalAir, 1), 0)})</td></tr>
    </table>
    <h4>노선 순위</h4><table class="cmp"><tr><th>노선</th><th>회/일</th><th>여객/일</th><th>탑승률</th></tr>${routeRows}</table>
    <h4>공항 순위</h4><table class="cmp"><tr><th>공항</th><th>여객/일</th><th>V/C</th></tr>${apRows}</table>
    ${latentRows ? `<h4>미취항 잠재 수요</h4><table class="cmp"><tr><th>노선</th><th>여객/일</th></tr>${latentRows}</table>` : ''}
    ${result.totals.tourDest ? `<h3 style="margin-top:16px">관광</h3>
    <table class="cmp"><tr><th>목적지</th><th>관광 통행/일</th></tr>${Object.entries(result.totals.tourDest).sort((x, y) => y[1] - x[1]).slice(0, 10)
      .map(([z, v]) => `<tr><td>${esc(zoneName(+z))}${zoneProps[z].sites ? ` <span class="m">${esc(zoneProps[z].sites.join(', '))}</span>` : ''}</td><td>${Math.round(v).toLocaleString()}</td></tr>`).join('')}</table>` : ''}
    <h3 style="margin-top:16px">철도</h3>
    <h4>역 순위 (지역 간 승하차)</h4><table class="cmp"><tr><th>역</th><th>명/일</th></tr>${stRows}</table>
    <h4>노선 순위 (최대 구간 이용객)</h4><table class="cmp"><tr><th>노선</th><th>명/일</th><th>V/C</th></tr>${railRows}</table>
    <h3 style="margin-top:16px">도로</h3>
    <h4>가장 막히는 고속도로·간선국도</h4><table class="cmp"><tr><th>노선</th><th>PCU/일</th><th>V/C</th></tr>${roadRows}</table>
    ${h.length > 1 ? `<h3 style="margin-top:16px">추이</h3>
      ${chart('북측 인구 (백만)', h.map((r) => [r.year, r.kpPop / 1e6]))}
      ${chart('북측 HDI', h.map((r) => [r.year, r.kpHdi]))}
      ${chart('소득 격차 (배)', h.map((r) => [r.year, r.krInc / r.kpInc]))}
      ${h.some((r) => r.happyKP) ? chart('북측 주민 행복도', h.filter((r) => r.happyKP).map((r) => [r.year, r.happyKP])) : ''}
      ${chart('철도 분담률 (%)', h.map((r) => [r.year, r.rail * 100]))}
      ${h.some((r) => r.air) ? chart('항공 분담률 (%)', h.filter((r) => r.air != null).map((r) => [r.year, r.air * 100])) : ''}
      ${chart('지지율 (%)', h.filter((r) => r.approval != null).map((r) => [r.year, r.approval]))}` : '<p class="hint">해를 넘기면 연도별 추이가 쌓입니다.</p>'}`;
}

/** 작은 꺾은선 그래프 (SVG) */
function chart(title, pts) {
  if (pts.length < 2) return '';
  const W = 320, H = 70, pad = 4;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x) => pad + ((x - x0) / Math.max(x1 - x0, 1)) * (W - 2 * pad);
  const sy = (y) => H - pad - ((y - y0) / Math.max(y1 - y0, 1e-9)) * (H - 2 * pad);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3));
  return `<div class="chart"><div class="chart-t">${title} <span>${fmt(ys[0])} → <b>${fmt(ys[ys.length - 1])}</b></span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg></div>`;
}

function renderSettings() {
  const el = $('[data-panel=settings]');
  el.innerHTML = `
    <h3>정책</h3>
    <div class="name-row"><span style="flex:1">북→남 이주</span>
      <select id="policy">${Object.entries(POLICY_LABEL).map(([k, v]) => `<option value="${k}" ${state.policy === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <p class="hint">통일 직후 대규모 남하를 막을지 정합니다. 통제할수록 북측 인구는 유지되지만 지지율과 통합 속도에 영향이 있습니다.</p>
    <h3 style="margin-top:16px">항공</h3>
    <label class="name-row"><input type="checkbox" id="air-auto" ${state.air?.auto ? 'checked' : ''}>
      <span>항공 노선 자동 운영 (수요에 따른 취항·증편·단항)</span></label>
    <h3 style="margin-top:16px">새 게임</h3>
    <div class="name-row"><span style="flex:1">난이도</span>
      <select id="difficulty">${Object.entries(DIFFICULTY).map(([k, v]) => `<option value="${k}" ${state.difficulty === k ? 'selected' : ''}>${v.label} (연 ${formatWon(v.annualBudget)})</option>`).join('')}</select></div>
    <button id="btn-new" style="margin-top:6px">이 난이도로 새로 시작</button>
    <p class="hint">진행 상황은 이 브라우저에 자동 저장됩니다.</p>
    <h3 style="margin-top:16px">데이터</h3>
    <p class="hint">도로·철도·행정구역·지명: © OpenStreetMap 기여자 (ODbL)<br>인구 격자: WorldPop 2020 (CC BY 4.0)<br>소득·HDI 초기값과 공사비 단가는 게임용 가정값입니다. 자세한 내용은 저장소의 docs/model.md를 보세요.</p>`;
  $('#air-auto').onchange = (e) => { state.air.auto = e.target.checked; save(state); };
  $('#policy').onchange = (e) => { state.policy = e.target.value; state.log.unshift(`${state.year}년 이주 정책: ${POLICY_LABEL[state.policy]}`); save(state); renderStatus(); };
  $('#btn-new').onclick = () => {
    if (!confirm('지금 게임을 지우고 새로 시작할까요?')) return;
    clearSave();
    clearSim();
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
  else if (selection.type === 'sub') el.innerHTML = subPanel(selection.id);
  else if (selection.type === 'airport') el.innerHTML = airportPanel(selection.id);
  else if (selection.type === 'multi') el.innerHTML = multiPanel(selection.ids);
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
  bindRestore(el);
  el.querySelectorAll('[data-mup]').forEach((b) => {
    b.onclick = () => {
      const r = startUpgrade(base, state, JSON.parse(b.dataset.ids), b.dataset.mup);
      if (!r.ok) return alert(r.reason);
      save(state); refreshLinks(); renderAll();
    };
  });
  el.querySelector('#line-rename-ok')?.addEventListener('click', () => {
    const v = el.querySelector('#line-rename').value.trim();
    const old = linkAt(base, state, selection.id).name;
    if (!v || v === old) return;
    renameLine(state, old, v);
    save(state); renderAll();
  });
  el.querySelectorAll('[data-close-route]').forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.closeRoute;
      const r = state.air.routes[key];
      closeRoute(state, key, `${airportName(r.a)}–${airportName(r.b)}`);
      save(state); renderAll();
    };
  });
  const openRoute = (other) => {
    const aps = effectiveNetwork(base, state).airports;
    const r = startOpenRoute(state, aps.find((a) => a.id === selection.id), aps.find((a) => a.id === other));
    if (!r.ok) return alert(r.reason);
    save(state); renderAll();
  };
  el.querySelectorAll('[data-open-route]').forEach((b) => { b.onclick = () => openRoute(b.dataset.openRoute); });
  el.querySelector('#route-open')?.addEventListener('click', () => openRoute(el.querySelector('#route-dest').value));
  el.querySelector('#ap-expand')?.addEventListener('click', () => {
    const ap = effectiveNetwork(base, state).airports.find((a) => a.id === selection.id);
    const r = startAirportExpand(state, ap);
    if (!r.ok) return alert(r.reason);
    save(state); renderAll();
  });
  const zn = el.querySelector('#zone-name');
  if (zn) {
    el.querySelector('#zone-rename').onclick = () => {
      const v = zn.value.trim();
      if (!v) return;
      setPlaceName(state, 'zone', selection.id, v);
      save(state); refreshNames(map); renderAll();
    };
  }
  const inp = el.querySelector('#node-name');
  if (inp) {
    el.querySelector('#node-save').onclick = () => renameNode(selection.id, inp.value.trim());
    el.querySelector('#node-auto').onclick = () => autoRenameNode(selection.id);
  }
}

function bindRestore(el) {
  el.querySelectorAll('[data-restore]').forEach((b) => {
    b.onclick = () => {
      const [level, id] = b.dataset.restore.split(':');
      const t = historic.find((x) => x.level === level && x.id === +id);
      const r = startRestoreName(state, t);
      if (!r.ok) return alert(r.reason);
      save(state); renderAll();
    };
  });
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
  const planned = l.open > state.year;
  const ups = l.ext || l.cls === 'ferry' || planned ? [] : UPGRADES.filter((u) => u.mode === l.mode && u.applies(l));
  const isNew = id >= base.links.length;
  const route = sameRoute(id);
  const routeKm = route.reduce((sum, x) => sum + linkAt(base, state, x).len, 0);
  const rows = l.mode === 2
    ? `<tr><td>표정 속도</td><td>${l.speed} km/h</td></tr>
       <tr><td>이용객</td><td>${Math.round(vol).toLocaleString()} 명/일</td></tr>`
    : isRoad
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
    ${isNew && l.name ? `<h4>노선 이름</h4><div class="name-row"><input type="text" id="line-rename" value="${esc(l.name)}">
      <button class="small" id="line-rename-ok">바꾸기</button></div>` : ''}
    ${planned ? `<p class="hint">현재 공사 중인 노선입니다 (OpenStreetMap 기준). ${l.open}년에 자동으로 개통합니다.</p>`
    : l.ext ? '<p class="hint">국외 거점과 잇는 국경 연결 구간입니다. 개량 대상이 아닙니다.</p>'
    : l.cls === 'ferry' ? '<p class="hint">여객선 항로입니다. 개량 대상이 아닙니다.</p>'
    : busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>` : `<h4>개량</h4>
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

/** 드래그로 고른 여러 구간: 가장 긴 수단 기준으로 개량을 한꺼번에 */
function multiPanel(ids) {
  const work = linksUnderWork(state);
  const km = [0, 0, 0];
  for (const i of ids) km[linkAt(base, state, i).mode] += linkAt(base, state, i).len;
  const mode = km.indexOf(Math.max(...km));
  const pool = ids.filter((i) => {
    const l = linkAt(base, state, i);
    return l.mode === mode && !l.ext && l.cls !== 'ferry' && !(l.open > state.year) && !work.has(i);
  });
  const names = [...new Set(pool.map((i) => linkAt(base, state, i).name).filter(Boolean))].slice(0, 6);
  const ups = UPGRADES.filter((u) => u.mode === mode).map((u) => {
    const app = pool.filter((i) => u.applies(linkAt(base, state, i)));
    const cost = app.reduce((s, i) => s + upgradeCost(u, linkAt(base, state, i)), 0);
    const len = app.reduce((s, i) => s + linkAt(base, state, i).len, 0);
    return { u, app, cost, len };
  }).filter((x) => x.app.length);
  const label = ['도로', '철도', '도시철도'][mode];
  return `${header(`${label} ${pool.length}개 구간 선택`)}
    <p class="hint">${km[mode].toFixed(0)}km · ${names.map(esc).join(', ')}${names.length === 6 ? ' 등' : ''}${pool.length < ids.length ? ` (다른 수단·공사 중 구간 ${ids.length - pool.length}개 제외)` : ''}</p>
    <div class="list">${ups.map(({ u, app, cost, len }) => {
      const ok = canAfford(state, cost, u.years);
      return `<div class="item"><div class="row" style="margin:0;justify-content:space-between">
        <span>${resolve(u.label, linkAt(base, state, app[0]))} · ${app.length}개 구간 ${len.toFixed(0)}km</span>
        <button class="small ${ok ? 'primary' : ''}" data-mup="${u.id}" data-ids="${JSON.stringify(app)}" ${ok ? '' : 'disabled'}>${formatWon(cost)} · ${u.years}년</button></div></div>`;
    }).join('') || '<p class="hint">고른 구간에 가능한 개량이 없습니다.</p>'}</div>`;
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
  const name = zoneName(id);
  if (!result) return header(name);
  const r = result.zones;
  const st = r.station[id];
  const stName = st >= 0 ? nodeNames().get(st)?.name : null;
  const change = r.pop[id] / Math.max(z.pop, 1) - 1;
  const accRef = median(Array.from(r.access));
  const targets = historic.filter((t) => t.zone === id);
  return `${header(name)}
    <table class="kv">
      <tr><td>소속</td><td>${esc(z.province)} (${z.country === 'KP' ? '북' : '남'})${name !== z.name ? ` · 원래 이름 ${esc(z.name)}` : ''}</td></tr>
      ${happiness ? `<tr><td>주민 행복도</td><td>${happiness[id].toFixed(1)}</td></tr>` : ''}
      <tr><td>인구</td><td>${fmtPop(r.pop[id])} <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>지난해 순이동</td><td>${Math.round(r.netMig[id]).toLocaleString()}명</td></tr>
      <tr><td>HDI</td><td>${r.hdi[id].toFixed(3)}</td></tr>
      <tr><td>기대수명</td><td>${r.le[id].toFixed(1)}세</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(r.income[id]).toLocaleString()}</td></tr>
      <tr><td>접근성 (중앙값=1)</td><td>${(r.access[id] / accRef).toFixed(2)}</td></tr>
      <tr><td>이용 철도역</td><td>${stName ? esc(stName) : '없음 (25km 밖)'}</td></tr>
    </table>
    ${targets.map((t) => restoreRow(t)).join('')}
    <h4>이름 바꾸기</h4>
    <div class="name-row"><input type="text" id="zone-name" value="${esc(name)}">
      <button class="small" id="zone-rename">바꾸기</button></div>
    <p class="hint">직접 바꾸는 이름은 비용이 들지 않지만 주민 행복도에는 영향이 없습니다.</p>`;
}

/** 옛 이름 되찾기 사업 한 줄 (지역 패널·건설 탭에서 함께 쓴다) */
function restoreRow(t) {
  const r = RENAME[t.level];
  const proj = state.projects.find((p) => p.kind === 'rename' && p.key === `${t.level === 'zone' ? 'z' : 'u'}:${t.id}`);
  const status = proj ? (proj.status === 'done' ? '완료' : `${proj.doneYear}년 완료 예정`) : '';
  return `<div class="item"><div class="t">${esc(t.current)} → ${esc(t.historic)}</div>
    <div class="m">${t.year}년 개칭 · ${esc(t.reason)}</div>
    <div class="row">${status ? `<span class="m">${status}</span>`
      : `<button class="small primary" data-restore="${t.level}:${t.id}">옛 이름 되찾기 ${formatWon(r.cost)} · ${r.years}년 · 행복도 +${r.bonus}</button>`}</div></div>`;
}

function subPanel(i) {
  const f = subsFC?.features[i];
  const [z] = subInfo(i);
  const name = f ? f.properties.name : '소구역';
  if (!result) return header(name);
  const s = result.subs;
  const change = s.pop[i] / Math.max(subPop0[i], 1) - 1;
  return `${header(name)}
    <table class="kv">
      <tr><td>소속</td><td>${esc(zoneProps[z].province)} ${esc(zoneProps[z].name)}</td></tr>
      <tr><td>인구</td><td>${Math.round(s.pop[i]).toLocaleString()}명 <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>인구 밀도</td><td>${Math.round(s.pop[i] / subArea(i)).toLocaleString()}/km²</td></tr>
      <tr><td>대중교통 접근 (대기 포함)</td><td>${Math.round(s.transit[i])}분</td></tr>
      <tr><td>지역 간 철도역 접근 (대기 포함)</td><td>${s.rail[i] >= 120 ? '역 없음' : Math.round(s.rail[i]) + '분'}</td></tr>
    </table>
    <p class="hint">해마다 주민 일부가 같은 시군구 안에서 대중교통·철도 접근이 좋고 덜 붐비는 곳으로 옮겨 갑니다. 새 역을 놓으면 주변 인구가 늘어납니다.</p>`;
}

function airportPanel(id) {
  const ap = effectiveNetwork(base, state).airports.find((a) => a.id === id);
  if (!ap) return header('공항');
  const k = result?.air.ids.indexOf(id) ?? -1;
  const pax = k >= 0 ? result.air.pax[k] : 0, cap = (ap.cap * 1e6) / 365;
  const busyProj = state.projects.find((p) => p.status === 'building' && p.airport === id);
  const cost = Math.round(AIRPORT.expand.cost * (ap.country === 'KP' ? KP_COST_FACTOR : 1));
  return `${header(ap.name)}
    <table class="kv">
      <tr><td>구분</td><td>${ap.ext ? '국외 공항' : ap.intl ? '국제공항' : '국내공항'}</td></tr>
      <tr><td>일 여객 (출발+도착)</td><td>${Math.round(pax).toLocaleString()}명</td></tr>
      <tr><td>용량</td><td>연 ${ap.cap}백만 명 (일 ${Math.round(cap).toLocaleString()}명)</td></tr>
      <tr><td>혼잡도 (V/C)</td><td class="${pax > cap ? 'neg' : ''}">${(pax / cap).toFixed(2)}</td></tr>
    </table>
    ${ap.ext ? '' : busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>`
      : `<div class="row" style="margin-top:8px"><button class="small primary" id="ap-expand">${AIRPORT.expand.label} ${formatWon(cost)} · ${AIRPORT.expand.years}년</button></div>`}
    ${routePanel(id, k)}`;
}

function airportName(id) {
  return effectiveNetwork(base, state).airports.find((a) => a.id === id)?.name.replace(/(국제공항|공항|비행장)$/, '') || id;
}

/** 공항 패널의 노선 목록: 운항 중 노선(여객·탑승률), 잠재 수요가 큰 미취항 노선, 직접 개설 */
function routePanel(id, k) {
  if (!result || k < 0) return '';
  const air = result.air, seats = air.seats;
  const mine = air.routes.filter(([a, b]) => a === k || b === k);
  const latent = air.latent.filter(([a, b]) => a === k || b === k).slice(0, 5);
  const ORIGIN = { base: '기존', auto: '자동 취항', manual: '직접 개설' };
  const aps = effectiveNetwork(base, state).airports;
  const here = aps.find((a) => a.id === id);
  const options = aps.filter((a) => a.id !== id && !state.air.routes[routeKey(id, a.id)])
    .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  return `<h4>운항 노선 (${mine.length})</h4>
    <div class="list">${mine.map(([a, b, pax, f]) => {
      const other = air.ids[a === k ? b : a];
      const key = routeKey(id, other);
      const r = state.air.routes[key];
      const load = pax / (2 * f * seats);
      return `<div class="item"><div class="row" style="margin:0;justify-content:space-between">
        <span>${esc(airportName(other))} · 하루 ${f}회 · ${pax.toLocaleString()}명 · 탑승률 <span class="${load > 1 ? 'neg' : ''}">${Math.round(load * 100)}%</span>
          <span class="m">${ORIGIN[r?.origin] || ''}</span></span>
        <button class="small" data-close-route="${key}">운항 중단</button></div></div>`;
    }).join('') || '<p class="hint">운항 중인 노선이 없습니다.</p>'}</div>
    ${latent.length ? `<h4>잠재 수요가 큰 미취항 노선</h4><div class="list">${latent.map(([a, b, pax]) => {
      const other = air.ids[a === k ? b : a];
      return `<div class="item"><div class="row" style="margin:0;justify-content:space-between">
        <span>${esc(airportName(other))} · 하루 약 ${pax.toLocaleString()}명</span>
        <button class="small primary" data-open-route="${other}">개설 ${formatWon(AIR.openCost * (here.country !== aps.find((x) => x.id === other)?.country ? 1.5 : 1))}</button></div></div>`;
    }).join('')}</div>` : ''}
    <h4>노선 직접 개설</h4>
    <div class="name-row"><select id="route-dest">${options}</select>
      <button class="small primary" id="route-open">개설 (취항 지원 ${formatWon(AIR.openCost)}~)</button></div>
    <p class="hint">${state.air.auto ? '자동 운영 중: 항공사가 수요에 따라 운항 횟수를 맞추고, 잠재 수요가 하루 1,500명을 넘는 노선에 취항하며, 2년 연속 200명 미만이면 철수합니다. 직접 연 노선은 철수하지 않습니다.' : '자동 운영이 꺼져 있습니다 (설정 탭).'}</p>`;
}

function nodePanel(id) {
  const n = nodeNames().get(id);
  if (!n) return header('노드');
  const kindLabel = { station: '역', IC: 'IC', JCT: 'JCT' }[n.kind];
  let riders = '';
  if (n.kind === 'station' && result) {
    const k = result.stations.node.indexOf(id);
    const metro = n.metro || allLinks().some((l) => l.mode === 2 && (l.a === id || l.b === id));
    riders = k >= 0
      ? `<table class="kv"><tr><td>일 승하차 (지역 간 통행)</td><td>${Math.round(result.stations.riders[k]).toLocaleString()}명</td></tr></table>`
      : metro ? '<p class="hint">도시철도역 (노선별 이용객은 구간을 눌러 보세요)</p>'
        : '<p class="hint">아직 운행하지 않는 역입니다.</p>';
  }
  return `${header(n.name)}
    <p class="hint">${kindLabel}${n.isNew ? (state.names[id]?.auto ? ' · 자동 이름' : ' · 직접 지은 이름') : ' · 기존 시설 (OSM)'}</p>
    ${riders}
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

// 모듈의 모든 선언이 끝난 뒤 시작한다
init().catch((e) => {
  console.error(e);
  const tip = document.querySelector('#loading .ld-tip');
  if (tip) { tip.textContent = `불러오기 실패: ${e.message}`; tip.style.color = 'var(--bad)'; }
});

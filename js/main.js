// 게임 진행과 화면 패널.
import { createMap, addLayers, colorFor, legendHTML, METRICS } from './ui/map.js';
import { Namer } from './game/naming.js';
import {
  newGame, save, load, clearSave, effectiveNetwork, linkAt, startUpgrade, startNewBuild, advanceBudgetYear,
  updateCongestion, defaultFix, updateApproval, canAfford, isKP, linksUnderWork, UPGRADES, NEW_BUILDS, upgradeCost,
  placeName, setPlaceName, startRestoreName, RENAME, startAirport, startAirportExpand, renameLine, splitLink,
  fundFor, settlePPP, settleRail, railDividend, railEquity, mergeRail, OP_FACTORS, initOngoing, linkPending, setProjectPace, PACES,
  initAirRoutes, updateAirRoutes, startOpenRoute, closeRoute, AIR,
} from './game/state.js';
import { AIRPORT } from './game/catalog.js';
import { setNameResolver, refreshNames } from './ui/map.js';
import { DIFFICULTY, KP_COST_FACTOR, resolve, formatWon } from './game/catalog.js';
import { kmBetween, routeKey } from './sim/model.js';
import { decodeNetwork } from './data/netpack.js';
import { smoothSegments, polylineKm } from './game/curve.js';
import { extendWorld, urbanLanes } from './game/world.js';
import { autoLineName, cityStem, makeForeignTest } from './game/lines.js';
import { saveSim, loadSim, clearSim } from './game/simstore.js';
import { SERVICE_KINDS, TRAIN_TYPES, OPERATING, lineStations, planService, railPath, tripsPerDay, setCost, canRun, defaultTrainType, serviceBuyCost, startService, updateService, removeService } from './game/services.js';
import { showLineDiagram, stopLineDiagram } from './ui/linediagram.js';
import { P } from './sim/params.js';
import { PPP_TYPES, PPP_DEFAULTS, initPPP, tollKind, linkToll, annualRevenue, evaluatePPP } from './game/ppp.js';
import {
  PARTIES, initLocal, regionOf, hasAutonomy, leanP, runElection, bumpApproval, governorTitle, mayorTitle, isMetroCity,
  HISTORIC_CITIES, PROMOTE_MIN_POP, ELECTION, EVENT_COST,
} from './game/local.js';
import { initRail, operatorOf, opInfo, opBadge, OPERATORS, MERGE_MIN_INTEGRATION, EQUITY_STEP } from './game/operators.js';

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
let wholeRoute = false;
let lastDone = [];           // 지난번 해 넘김에 완공된 사업 (지자체 실적 계산용)    // 개량을 같은 이름 노선 전체에 적용


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
  urbanLanes(base, grid);
  // 존 경계는 배경지도와 같은 시군구 도형을 쓴다
  zonesFC = await dl.fetch('data/admin/sgg.geojson', 'json');
  // 지명은 새 역·IC 이름을 지을 때만 필요하므로 첫 화면 뒤에 받는다
  const placesReady = fetch('data/places.json').then((r) => r.json()).then((p) => { places = p; });
  fetch('data/base/world.geojson').then((r) => r.json()).then((w) => { isForeign = makeForeignTest(w); }).catch(() => {});
  fetch('data/plans.json').then((r) => (r.ok ? r.json() : { plans: [] })).then((p) => { plans = p.plans || []; if (map) renderBuild(); }).catch(() => {});
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
  initRail(state);
  initLocal(state);
  initPPP(state);
  if (!Object.keys(state.local.offices).length) holdElection('all', '지방선거 (게임 시작 시점)');
  // OSM 공사 중 노선 → 진행 중 사업 (이름 없는 구간은 가까운 시군 이름으로)
  initOngoing(base, state, (l) => {
    const [x, y] = base.nodes[l.a];
    let best = null, bd = Infinity;
    for (const z of zoneProps) { if (z.ext) continue; const d = (z.cx - x) ** 2 + (z.cy - y) ** 2; if (d < bd) { bd = d; best = z; } }
    return `${best ? best.name : ''} ${CLASS_LABEL[l.cls] || ''} 공사`.trim();
  });
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
  window.ukt = { map, base, select, selectBox, renderAll, get state() { return state; }, get result() { return result; }, get requests() { return requests; } };
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
  else if (m.type === 'preview') onPreview(m);
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
    // 철도 운영사 한 해 결산
    settleRail(state, operatorEconomics());
    // 지방선거·단체장 SOC 제안
    localYear(lastDone);
    // 민자사업 정산 (최소운영수입보장·임대료)
    pppYear();
    lastDone = [];
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
  // 노선도는 지난해 결과로 그렸으므로 닫는다
  stopLineDiagram();
  $('#linediagram').hidden = true;
  const done = advanceBudgetYear(base, state);
  lastDone = done;
  afterStraighten(done);
  if (done.some((p) => p.kind === 'rename')) refreshNames(map);
  if (done.length) { refreshLinks(); refreshPoints(); }
  else refreshLinks();
  pendingStep = true;
  setBusy(true, `${state.year}년 계산 중`, 0);
  const opened = done.some((p) => p.kind === 'new');   // 플레이어가 놓은 새 노선 (이어받은 공사는 해마다 열려서 뺀다)
  worker.postMessage({ type: 'step', net: effectiveNetwork(base, state), ctx: ctx(), opened });
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
    const parts = smoothParts(l, i);
    return {
      type: 'Feature', id: i,
      properties: { id: i, mode: eff.mode, cls: eff.cls, building: building.has(i) || (i < base.links.length && linkPending(base, state, i)) ? 1 : 0, colour: eff.colour || '', ext: eff.ext ? 1 : 0 },
      geometry: parts.length > 1 ? { type: 'MultiLineString', coordinates: parts } : { type: 'LineString', coordinates: parts[0] },
    };
  });
  return { type: 'FeatureCollection', features };
}

/** 화면용 도형: 꺾인 점을 부드럽게 (Chaikin 1회, 양 끝은 노드에 그대로). 기본 구간은 한 번만 계산해 둔다 */
const smoothCache = new Map();
function smoothParts(l, i) {
  if (i < base.links.length && smoothCache.has(i)) return smoothCache.get(i);
  const g = l.geom;
  const parts = [[]];
  for (let k = 0; k < g.length; k += 2) {
    if (Number.isNaN(g[k])) parts.push([]);
    else parts[parts.length - 1].push([g[k], g[k + 1]]);
  }
  const out = parts.map((p) => {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let k = 0; k + 1 < p.length; k++) {
      const [x0, y0] = p[k], [x1, y1] = p[k + 1];
      if (k) q.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      if (k + 2 < p.length) q.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    q.push(p[p.length - 1]);
    return q.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
  });
  if (i < base.links.length) smoothCache.set(i, out);
  return out;
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
  const closed = new Set(state.closedStations || []);
  for (const [name, node] of base.stations) if (!out.has(node) && !closed.has(node)) out.set(node, { name, kind: 'station', isNew: 0 });
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
    else if (metric === 'partyMayor') v = partyValue(i, 'mayor');
    else if (metric === 'partyGov') v = partyValue(i, 'gov');
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
    if (straight) { straightenClick(e.lngLat); return; }
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
  const pp = pppPlan();
  if (pp === false) { alert('민자사업은 먼저 수요 예측·민간 수익성 검토를 하고, 민간이 참여할 수 있어야 착공할 수 있습니다.'); return; }
  if (!pp && NEW_BUILDS[draft.type].mode !== 1 && !canAfford(state, dc.cost, dc.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const lineName = draftLineName();
  let split = false;
  for (const p of draft.points) {
    if (p.split == null) continue;
    p.node = splitLink(base, state, p.split, p.lon, p.lat);
    split = true;
  }
  const restAreas = restPositions(smoothSegments(draft.points)).map(([lon, lat]) => ({ lon, lat, name: namer.suggest(lon, lat, 'rest') }));
  const r = startNewBuild(base, state, { type: draft.type, points: draft.points, names, lineName, extendOf: draft.extendOf, plan: draft.plan,
    ppp: pp ? { type: pp.type, subsidy: pp.subsidy, toll: pp.toll } : null, segFactor: dc.segFactor, extraCost: dc.extraCost, restAreas });
  if (split) refreshLinks();
  if (!r.ok) { alert(r.reason); return; }
  if (pp) {
    const proj = state.projects[state.projects.length - 1];
    proj.label = `[민자 ${pp.type.toUpperCase()}] ${proj.label}`;
    addContract(proj, pp, lineName || NEW_BUILDS[draft.type].label);
  }
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
    // 철도 신설은 운영사 자체 재원으로도 지을 수 있다 (찍은 점 대부분이 북측이면 KPRail)
    const draftOp = spec.mode === 1 ? operatorOf(state, { mode: 1, kp: draft.points.filter((p) => isKP(p.lat, p.lon)).length * 2 > draft.points.length ? 1 : 0 }) : null;
    const draftFund = draftOp && state.rail.fund === 'op' ? draftOp : 'gov';
    const affordable = canAfford(state, cost, years, draftFund);
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
      ${pppSection()}
      ${draftOp && (draft.ppp?.type || 'gov') === 'gov' ? fundSelect([draftOp]) : ''}
      <div class="name-row"><label><input type="checkbox" id="snap-node" ${snap.node ? 'checked' : ''}> 노드에 붙이기</label>
        <label><input type="checkbox" id="snap-line" ${snap.line ? 'checked' : ''}> 선 위에 붙이기 (중간 ${spec.mode === 0 ? 'IC' : '역'})</label></div>
      <p class="hint">노란 점(◆)은 중국·러시아·일본 거점 도시입니다. 끝점을 거점에 붙이면 국제 노선이 됩니다.
        기존 ${spec.mode ? '선로' : '도로'} 중간을 누르면 그 자리에 ${spec.mode === 0 ? 'IC·JCT를' : '역을'} 만들고 이어집니다.</p>
      ${!affordable && draft.points.length > 1 ? '<p class="hint neg">예산과 차입 한도를 넘습니다.</p>' : ''}
      <div class="row" style="display:flex;gap:6px;margin-top:8px">
        <button class="primary" id="draft-ok" ${draft.points.length < 2 || !affordable ? 'disabled' : ''}>착공</button>
        <button id="draft-prev" ${draft.points.length < 2 ? 'disabled' : ''}>효과 미리보기</button>
        <button id="draft-cancel">취소</button>
      </div>`;
  }
  const restore = historic.length ? `<h4>옛 이름 되찾기</h4>
    <p class="hint">북측에서 지도자 이름이나 선전 구호로 바뀐 지명을 바뀌기 전 이름으로 돌립니다. 표지판·행정 문서·지도를 바꾸는 데 예산이 들고, 완공되면 그 지역 주민 행복도가 오릅니다.</p>
    <div class="list">${historic.map((t) => restoreRow(t)).join('')}</div>` : '';
  el.innerHTML = `<div class="tools">${tools}</div>${body}${draft ? '' : plansHTML() + restore}`;
  el.querySelectorAll('[data-plan]').forEach((b) => { b.onclick = () => openPlan(b.dataset.plan); });
  bindRestore(el);
  el.querySelectorAll('[data-build]').forEach((b) => { b.onclick = () => startDraft(b.dataset.build); });
  if (draft) {
    $('#draft-ok').onclick = commitDraft;
    $('#draft-prev').onclick = previewDraft;
    $('#snap-node').onchange = (e) => { snap.node = e.target.checked; };
    bindFund(el, renderBuild);
    bindPPP(el);
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
  const building = state.projects.filter((p) => p.status === 'building').sort((x, y) => x.doneYear - y.doneYear);
  const done = state.projects.filter((p) => p.status === 'done').slice(-15).reverse();
  const annual = building.filter((p) => !p.fund || p.fund === 'gov').reduce((s, p) => s + Math.min(p.annual, p.cost - p.paid), 0);
  const row = (p) => {
    const prog = Math.min(1, p.paid / Math.max(1, p.cost));
    const pace = p.pace || 1;
    const by = p.fund === 'ppp' ? ` · 민자 (정부 보조 ${Math.round((p.govShare || 0) * 100)}%)`
      : p.fund && p.fund !== 'gov' ? ` · ${opBadge(state, state.rail.merged ? 'merged' : p.fund)} 자체 재원` : '';
    return `<div class="item"><div class="t">${esc(p.label)}</div>
      <div class="m">${formatWon(p.cost)} · 연 ${formatWon(Math.min(p.annual, p.cost - p.paid))} · ${p.doneYear}년 ${p.kind === 'osm' ? '개통' : '완공'} 예정${by}</div>
      <div class="progress"><div style="width:${Math.round(prog * 100)}%"></div></div>
      ${['service', 'vehicles', 'airRoute', 'rename'].includes(p.kind) ? '' : `<div class="pace">투입 속도 ${PACES.map((x) =>
        `<button class="small ${x === pace ? 'on' : ''}" data-pace="${p.id}" data-v="${x}">${Math.round(x * 100)}%</button>`).join('')}</div>`}</div>`;
  };
  const ongoing = building.filter((p) => p.kind === 'osm'), mine = building.filter((p) => p.kind !== 'osm');
  el.innerHTML = `
    <p class="hint">내년 정부 예산 투입: ${formatWon(annual)} / 연 예산 ${formatWon(DIFFICULTY[state.difficulty].annualBudget)}.
      사업마다 투입 속도를 바꾸면 연 투입액과 완공 연도가 달라집니다 (빠르게 하면 남은 사업비에 할증이 붙습니다).</p>
    <h3>진행 중인 사업 (이어받은 공사 ${ongoing.length})</h3>
    <div class="list">${ongoing.map(row).join('') || '<p class="hint">없습니다.</p>'}</div>
    <h3 style="margin-top:16px">새로 벌인 사업 (${mine.length})</h3>
    <div class="list">${mine.map(row).join('') || '<p class="hint">진행 중인 사업이 없습니다.</p>'}</div>
    ${pppTableHTML()}
    <h3 style="margin-top:16px">완공 (${state.projects.length - building.length})</h3>
    <div class="list">${done.map((p) => `<div class="item"><div class="t">${esc(p.label)}</div><div class="m">${p.doneYear}년 완공 · ${formatWon(p.cost)}</div></div>`).join('') || '<p class="hint">아직 없습니다.</p>'}</div>`;
  el.querySelectorAll('[data-pace]').forEach((b) => {
    b.onclick = () => { setProjectPace(state, b.dataset.pace, +b.dataset.v); save(state); renderProjects(); renderTop(); };
  });
}

function renderRequests() {
  const el = $('[data-panel=requests]');
  const c = $('#req-count');
  c.hidden = requests.length === 0;
  c.textContent = requests.length;
  el.innerHTML = `${proposalsHTML()}<h3>확장 요구</h3>
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
  bindProposals(el);
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
    `<tr><td>${esc(airportName(air.ids[a]))}–${esc(airportName(air.ids[b]))}</td><td>${f}</td><td>${pax.toLocaleString()}</td><td>${Math.round(pax / (2 * f * seats) * 100)}%</td>
      <td class="${airRatio(aps, air.ids[a], air.ids[b], pax, f) > 100 ? 'neg' : ''}">${fmtRatio(airRatio(aps, air.ids[a], air.ids[b], pax, f))}</td></tr>`).join('');
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
  const econRows = lineEconomics().sort((x, y) => y.rev - x.rev).slice(0, 15)
    .map((e) => `<tr><td>${esc(e.name)}</td><td>${formatWon(e.rev / 1e8)}</td><td>${formatWon(e.cost / 1e8)}</td><td class="${e.ratio > 100 ? 'neg' : ''}">${fmtRatio(e.ratio)}</td></tr>`).join('');
  const svcRows = svcStats().map((x) => `<tr><td>${esc(x.s.name)} <span class="m">${x.s.name.includes(SERVICE_KINDS[x.s.kind].label) ? "" : `${SERVICE_KINDS[x.s.kind].label} · `}${x.s.stops.length}역</span></td>
    <td>${x.s.trains}</td><td>${Math.round(x.peak).toLocaleString()}</td><td>${Math.round(x.load * 100)}%</td><td class="${x.ratio > 100 ? 'neg' : ''}">${fmtRatio(x.ratio)}</td></tr>`).join('');
  const roadRows = byName(0).filter(([, v]) => v.cls === 'motorway' || v.cls === 'trunk').sort((x, y) => y[1].vc - x[1].vc).slice(0, 10)
    .map(([n, v]) => `<tr><td>${esc(n)}</td><td>${Math.round(v.vol).toLocaleString()}</td><td class="${v.vc > 1 ? 'neg' : ''}">${v.vc.toFixed(2)}</td></tr>`).join('');
  const h = state.history;
  el.innerHTML = `
    <h3>항공</h3>
    <table class="kv">
      <tr><td>운항 노선</td><td>${air.routes.length}개 (${state.air.auto ? '자동 운영' : '수동'})</td></tr>
      <tr><td>하루 항공 여객</td><td>${Math.round(totalAir).toLocaleString()}명 (국제선 ${pct(intlPax / Math.max(totalAir, 1), 0)})</td></tr>
    </table>
    <h4>노선 순위</h4><table class="cmp"><tr><th>노선</th><th>회/일</th><th>여객/일</th><th>탑승률</th><th>영업계수</th></tr>${routeRows}</table>
    <h4>공항 순위</h4><table class="cmp"><tr><th>공항</th><th>여객/일</th><th>V/C</th></tr>${apRows}</table>
    ${latentRows ? `<h4>미취항 잠재 수요</h4><table class="cmp"><tr><th>노선</th><th>여객/일</th></tr>${latentRows}</table>` : ''}
    ${result.totals.tourDest ? `<h3 style="margin-top:16px">관광</h3>
    <table class="cmp"><tr><th>목적지</th><th>관광 통행/일</th></tr>${Object.entries(result.totals.tourDest).sort((x, y) => y[1] - x[1]).slice(0, 10)
      .map(([z, v]) => `<tr><td>${esc(zoneName(+z))}${zoneProps[z].sites ? ` <span class="m">${esc(zoneProps[z].sites.join(', '))}</span>` : ''}</td><td>${Math.round(v).toLocaleString()}</td></tr>`).join('')}</table>` : ''}
    <h3 style="margin-top:16px">철도</h3>
    <h4>역 순위 (지역 간 승하차)</h4><table class="cmp"><tr><th>역</th><th>명/일</th></tr>${stRows}</table>
    <h4>노선 순위 (최대 구간 이용객)</h4><table class="cmp"><tr><th>노선</th><th>명/일</th><th>V/C</th></tr>${railRows}</table>
    ${railStatsHTML()}
    <h4>노선별 수익성 (철도·도시철도, 연간)</h4><table class="cmp"><tr><th>노선</th><th>수입</th><th>비용</th><th>영업계수</th></tr>${econRows}</table>
    <p class="hint">영업계수 = 영업비용 ÷ 영업수입 × 100 (100 미만이면 흑자). 수입은 구간 이용객 × 거리 × km당 운임, 비용은 운행 열차-km와 선로 유지비로 셈한 추정입니다. 도시철도는 같은 구 안 이용을 역세권 인구로 어림해 더했습니다.</p>
    ${svcRows ? `<h4>운행 계통</h4><table class="cmp"><tr><th>계통</th><th>회/일</th><th>최대 구간</th><th>승차율</th><th>영업계수</th></tr>${svcRows}</table>` : ''}
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
  bindRailStats(el);
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
    <h3 style="margin-top:16px">지방자치·행정구역</h3>
    ${localSettingsHTML()}
    <h3 style="margin-top:16px">항공</h3>
    <label class="name-row"><input type="checkbox" id="air-auto" ${state.air?.auto ? 'checked' : ''}>
      <span>항공 노선 자동 운영 (수요에 따른 취항·증편·단항)</span></label>
    <h3 style="margin-top:16px">저장 슬롯</h3>
    <p class="hint">진행은 자동 저장되고, 여기에 따로 세 개까지 남겨 두었다가 되돌릴 수 있습니다.</p>
    ${slotsHTML()}
    <h3 style="margin-top:16px">새 게임</h3>
    <div class="name-row"><span style="flex:1">난이도</span>
      <select id="difficulty">${Object.entries(DIFFICULTY).map(([k, v]) => `<option value="${k}" ${state.difficulty === k ? 'selected' : ''}>${v.label} (연 ${formatWon(v.annualBudget)})</option>`).join('')}</select></div>
    <button id="btn-new" style="margin-top:6px">이 난이도로 새로 시작</button>
    <p class="hint">진행 상황은 이 브라우저에 자동 저장됩니다.</p>
    <h3 style="margin-top:16px">데이터</h3>
    <p class="hint">도로·철도·행정구역·지명: © OpenStreetMap 기여자 (ODbL)<br>인구 격자: WorldPop 2020 (CC BY 4.0)<br>소득·HDI 초기값과 공사비 단가는 게임용 가정값입니다. 자세한 내용은 저장소의 docs/model.md를 보세요.</p>`;
  $('#air-auto').onchange = (e) => { state.air.auto = e.target.checked; save(state); };
  bindLocalSettings(el);
  bindSlots(el);
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
  else if (selection.type === 'service') el.innerHTML = servicePanel();
  else if (selection.type === 'straighten') { el.innerHTML = straightenPanel(); bindStraighten(el); return; }
  else el.innerHTML = nodePanel(selection.id);
  el.querySelector('.close')?.addEventListener('click', () => select(null));
  if (selection.type === 'service') bindService(el);
  if (selection.type === 'service') bindFund(el, renderSelection);
  el.querySelector('#line-diagram')?.addEventListener('click', () => openLineDiagram(selection.id));
  el.querySelector('#st-start')?.addEventListener('click', () => startStraighten(selection.id));
  el.querySelectorAll('[data-st-diagram]').forEach((b) => { b.onclick = () => openLineDiagram(+b.dataset.stDiagram); });
  el.querySelectorAll('[data-st-goto]').forEach((a) => {
    a.onclick = (ev) => { ev.preventDefault(); const nd = +a.dataset.stGoto; flyToNode(nd); select({ type: 'node', id: nd }); };
  });
  el.querySelector('#svc-new')?.addEventListener('click', (ev) => openServiceEditor(ev.target.dataset.line, ev.target.dataset.cls));
  el.querySelectorAll('[data-svc-edit]').forEach((b) => {
    b.onclick = () => {
      const s = state.services.find((x) => x.id === b.dataset.svcEdit);
      openServiceEditor(s.line, s.cls, s.id);
    };
  });
  el.querySelectorAll('[data-up]').forEach((b) => {
    b.onclick = () => {
      const ids = wholeRoute ? sameRoute(selection.id) : [selection.id];
      const r = startUpgrade(base, state, ids, b.dataset.up);
      if (!r.ok) return alert(r.reason);
      save(state); refreshLinks(); renderAll();
    };
  });
  bindFund(el, renderSelection);
  el.querySelectorAll('[data-prev-up]').forEach((b) => {
    b.onclick = () => {
      const u = UPGRADES.find((x) => x.id === b.dataset.prevUp);
      const ids = (wholeRoute ? sameRoute(selection.id) : [selection.id]).filter((x) => u.applies(linkAt(base, state, x)));
      previewUpgrade(ids, u.id);
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

// ------------------------------------------------------------ 운행 계통 (특급·급행·보통)

let svcEdit = null;   // 편집 중인 계통 {line, cls, kind, name, trains, nodes: 노선 위 역 순서, stops: Set, id}
const SERVICE_DAY_MIN = 1440;   // 24시간 운행

function railStationSet() {
  const s = new Set(base.stations.map(([, n]) => n));
  for (const n of state.newStations) s.add(n);
  for (const n of state.closedStations || []) s.delete(n);
  return s;
}

function stationRiders() {
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
function defaultStops(nodes, kind) {
  if (kind === 'local') return new Set(nodes);
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

function openServiceEditor(line, cls, id = null) {
  const net = effectiveNetwork(base, state);
  const nodes = lineStations(net, railStationSet(), line);
  if (nodes.length < 2) { alert('이 노선에는 역이 둘 이상 있어야 운행 계통을 짤 수 있습니다.'); return; }
  const s = id && state.services.find((x) => x.id === id);
  const under = net.links.filter((l) => l.name === line && l.mode === 1 && !l.via);
  svcEdit = s
    ? { line, cls, kind: s.kind, name: s.name, type: s.type || defaultTrainType(cls, under), sets: s.sets, nodes, stops: new Set(s.stops), id, nameEdited: true }
    : { line, cls, kind: 'limited', name: `${line} ${SERVICE_KINDS.limited.label}`, type: defaultTrainType(cls, under), sets: 4, nodes, stops: defaultStops(nodes, 'limited'), id: null };
  select({ type: 'service' });
}

function servicePlan() {
  const stops = svcEdit.nodes.filter((n) => svcEdit.stops.has(n));
  const links = effectiveNetwork(base, state).links;
  const plan = stops.length >= 2 ? planService(links, railStationSet(), stops, svcEdit.kind, svcEdit.line, svcEdit.type) : null;
  if (plan) plan.under = plan.segs.flatMap((sg) => sg.via.map((i) => links[i]));
  return { stops, plan };
}

function servicePanel() {
  const e = svcEdit, nn = nodeNames(), r = stationRiders();
  const { stops, plan } = servicePlan();
  const cur = e.id ? state.services.find((x) => x.id === e.id) : null;
  const trains = plan ? tripsPerDay(e.sets, plan.runMin) : 0;
  const cost = serviceBuyCost(cur && { ...cur, type: cur.type || e.type }, { type: e.type, sets: e.sets });
  const runnable = (t) => !plan || canRun(t, plan.under);
  const typeOk = runnable(e.type);
  const rows = e.nodes.map((n) => `<label class="name-row" style="margin:2px 0"><input type="checkbox" data-stop="${n}" ${e.stops.has(n) ? 'checked' : ''}>
      <span>${esc(nn.get(n)?.name || `역 ${n}`)}</span><span class="m" style="margin-left:auto">${Math.round(r.get(n) || 0).toLocaleString()}명/일</span></label>`).join('');
  return `${header(e.id ? `운행 계통: ${e.name}` : `${e.line} 운행 계통 짜기`)}
    <div class="name-row"><span class="kind">이름</span><input type="text" id="svc-name" value="${esc(e.name)}"></div>
    <div class="name-row"><span class="kind">등급</span><select id="svc-kind">${Object.entries(SERVICE_KINDS)
      .map(([k, v]) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <span class="m">정차 방식·요금</span></div>
    <div class="name-row"><span class="kind">열차</span><select id="svc-type">${Object.entries(TRAIN_TYPES)
      .map(([k, v]) => `<option value="${k}" ${k === e.type ? 'selected' : ''} ${runnable(k) ? '' : 'disabled'}>${v.label}${runnable(k) ? '' : ' (비전철 구간 있음)'}</option>`).join('')}</select></div>
    <div class="name-row"><span class="kind">편성</span><input type="range" id="svc-sets" min="1" max="60" value="${e.sets}" style="flex:1">
      <b>${e.sets}편성</b></div>
    <p class="hint">${TRAIN_TYPES[e.type].label}: 정원 ${TRAIN_TYPES[e.type].cap.toLocaleString()}명, 편성당 ${formatWon(TRAIN_TYPES[e.type].setCost)}. 편성을 늘리면 운행 횟수가 저절로 늘어납니다.</p>
    <table class="kv">
      <tr><td>정차역</td><td>${stops.length} / ${e.nodes.length}개</td></tr>
      ${plan ? `<tr><td>운행 거리 · 시간</td><td>${plan.km.toFixed(0)}km · ${fmtMin(plan.runMin)}</td></tr>
      <tr><td>표정 속도</td><td>${(plan.km / (plan.runMin / 60)).toFixed(0)} km/h</td></tr>
      <tr><td>하루 운행 (24시간)</td><td>${trains}회 · 한 방향 약 ${Math.max(1, Math.round(SERVICE_DAY_MIN / Math.max(1, trains / 2)))}분 간격</td></tr>
      <tr><td>하루 수송력</td><td>${(trains * TRAIN_TYPES[e.type].cap).toLocaleString()}명</td></tr>
      <tr><td>차량 구입비</td><td>${cost ? formatWon(cost) : '없음'}${cur ? ` (보유 ${cur.sets}편성)` : ''}</td></tr>` : '<tr><td colspan="2">정차역을 둘 이상 고르세요.</td></tr>'}
    </table>
    <p class="hint">특급·급행은 고른 역에만 서서 통과역마다 정차 시간을 줄이고, 정차역의 배차 간격이 짧아집니다. 열차는 같은 선로 용량을 나눠 씁니다. 고친 내용은 다음 해부터 반영됩니다.</p>
    <div class="row" style="display:flex;gap:6px;margin:8px 0">
      <button class="small" data-svc-preset="local">모든 역</button><button class="small" data-svc-preset="express">큰 역 절반</button>
      <button class="small" data-svc-preset="limited">주요 역만</button></div>
    <div style="max-height:240px;overflow:auto">${rows}</div>
    ${e.id ? '' : fundSelect(plan ? [serviceOperator({ segs: plan.segs })] : [])}
    <div class="row" style="display:flex;gap:6px;margin-top:8px">
      <button class="primary" id="svc-ok" ${plan && typeOk ? '' : 'disabled'}>${e.id ? (cost ? `저장 (차량 ${formatWon(cost)})` : '저장') : `운행 시작 (차량 ${formatWon(cost)} · 1년)`}</button>
      ${e.id ? '<button id="svc-del">운행 중단</button>' : ''}
    </div>`;
}

function bindService(el) {
  const e = svcEdit;
  if (!e) return;
  el.querySelector('#svc-name').onchange = (ev) => { e.name = ev.target.value.trim() || e.name; e.nameEdited = true; };
  el.querySelector('#svc-kind').onchange = (ev) => {
    e.kind = ev.target.value;
    if (!e.nameEdited) e.name = `${e.line} ${SERVICE_KINDS[e.kind].label}`;
    if (!e.id) e.stops = defaultStops(e.nodes, e.kind);
    renderSelection();
  };
  el.querySelector('#svc-type').onchange = (ev) => { e.type = ev.target.value; renderSelection(); };
  el.querySelector('#svc-sets').oninput = (ev) => { e.sets = +ev.target.value; ev.target.nextElementSibling.textContent = `${e.sets}편성`; };
  el.querySelector('#svc-sets').onchange = () => renderSelection();
  el.querySelectorAll('[data-stop]').forEach((c) => {
    c.onchange = () => { const n = +c.dataset.stop; if (c.checked) e.stops.add(n); else e.stops.delete(n); renderSelection(); };
  });
  el.querySelectorAll('[data-svc-preset]').forEach((b) => { b.onclick = () => { e.stops = defaultStops(e.nodes, b.dataset.svcPreset); renderSelection(); }; });
  el.querySelector('#svc-ok').onclick = () => {
    const { stops, plan } = servicePlan();
    if (!plan) return;
    const rec = { name: e.name, kind: e.kind, line: e.line, cls: e.cls, stops, type: e.type, sets: e.sets, runMin: plan.runMin, km: plan.km, segs: plan.segs,
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
function serviceSection(l) {
  const ec = lineEconomics().find((x) => x.name === l.name);
  const econ = ec ? `<p class="hint">이 노선: 연 수입 ${formatWon(ec.rev / 1e8)} · 비용 ${formatWon(ec.cost / 1e8)} · 영업계수 <b class="${ec.ratio > 100 ? 'neg' : ''}">${fmtRatio(ec.ratio)}</b></p>` : '';
  const diagram = '<button class="small" id="line-diagram">노선도 보기 (열차 위치·정차역·혼잡도)</button>';
  if (l.mode === 2) return `<h4>노선도 · 수익성</h4>${diagram}${econ}<p class="hint">도시철도 수입에는 같은 구 안 이용을 역세권 인구로 어림해 더했습니다.</p>`;
  const list = (state.services || []).filter((s) => s.line === l.name);
  return `<h4>노선도 · 운행 계통 · 수익성</h4>${diagram}
    <button class="small" id="st-start" title="두 역 사이를 단순한 곡선으로 새로 놓고 옛 구간은 폐선">구간 직선화 (두 역 고르기)</button>${econ}
    <div class="list">${list.map((s) => `<div class="item"><div class="row" style="margin:0;justify-content:space-between">
      <span>${esc(s.name)} <span class="m">${s.name.includes(SERVICE_KINDS[s.kind].label) ? "" : `${SERVICE_KINDS[s.kind].label} · `}${s.stops.length}개 역 · ${TRAIN_TYPES[s.type]?.label.split(' ')[0] || ''} ${s.sets}편성 · 하루 ${s.trains}회${s.built ? '' : ' · 차량 제작 중'}</span></span>
      <button class="small" data-svc-edit="${s.id}">고치기</button></div></div>`).join('')}</div>
    <button class="small" id="svc-new" data-line="${esc(l.name)}" data-cls="${l.cls}">새 운행 계통 짜기 (특급·급행·보통)</button>`;
}

function fmtRatio(r) { return isFinite(r) ? Math.round(r).toLocaleString() : '–'; }

/** 운행 계통별 이용·수지 (시뮬레이션 결과의 가상 링크 순서 = 운행 중 계통의 구간 순서) */
function svcStats() {
  const sv = result?.links.svcVol;
  const built = (state.services || []).filter((s) => s.built);
  if (!sv || sv.length !== built.reduce((n, s) => n + s.segs.length, 0)) return [];
  let k = 0;
  return built.map((s) => {
    let pkm = 0, peak = 0;
    for (const seg of s.segs) {
      const v = sv[k++] || 0;
      pkm += v * seg.via.reduce((a, i) => a + linkAt(base, state, i).len, 0);
      peak = Math.max(peak, v);
    }
    const cls = s.cls === 'hsr' ? 'hsr' : 'conv', fare = OPERATING.fareKm[cls] * SERVICE_KINDS[s.kind].fareFactor;
    const rev = pkm * fare * 365;
    // 비용: 열차-km 운행비 + 차량 감가상각(25년)
    const tt = TRAIN_TYPES[s.type] || TRAIN_TYPES.intercity;
    const cost = s.trains * s.km * tt.kmCost * 365 + (s.sets * tt.setCost * 1e8) / 25;
    return { s, peak, load: pkm / Math.max(1, s.trains * tt.cap * s.km), rev, cost,
      ratio: rev > 0 ? (cost / rev) * 100 : Infinity, premium: pkm * OPERATING.fareKm[cls] * (SERVICE_KINDS[s.kind].fareFactor - 1) * 365 };
  });
}

/**
 * 노선별 수지 (원/년): 수입 = 구간 이용객 × 거리 × km당 운임, 비용 = 열차-km 운행비 + 선로 유지비.
 * 열차 수는 이용객을 승차율 65%로 실을 만큼 (최소 운행 횟수 이상)으로 잡는다.
 */
let econCache = null;
function lineEconomics() {
  if (!result) return [];
  if (econCache?.res === result) return econCache.rows;
  const OP = OPERATING, vol = result.links.vol, lines = new Map();
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode === 0 || !l.name || l.ext || l.cls === 'ferry' || linkPending(base, state, i) || state.replaced?.[i] || i >= vol.length) return;
    if (i >= base.links.length && !l.built) return;
    const cls = l.mode === 2 ? 'metro' : l.cls === 'hsr' ? 'hsr' : 'conv';
    let e = lines.get(l.name);
    if (!e) lines.set(l.name, (e = { name: l.name, cls, km: 0, rev: 0, cost: 0, peak: 0 }));
    const v = vol[i];
    const trains = Math.max(OP.minTrains[cls], v / (OP.paxPerTrain[cls] * OP.loadFactor));
    e.km += l.len;
    e.peak = Math.max(e.peak, v);
    e.rev += v * l.len * OP.fareKm[cls] * 365;
    e.cost += trains * l.len * OP.trainKmCost[cls] * 365 + l.len * Math.max(1, Math.min(l.tracks || 2, 4)) * OP.trackKmCost[cls];
  });
  // 특급·급행 승객은 등급 요금을 더 낸다
  for (const x of svcStats()) { const e = lines.get(x.s.line); if (e) e.rev += x.premium; }
  // 도시철도: 모형에 없는 같은 구 안 이용을 역세권 인구로 어림해 더한다
  for (const e of lines.values()) if (e.cls === 'metro') e.rev += metroIntraRevenue(e.name);
  const rows = [...lines.values()].filter((e) => e.km >= 5).map((e) => ({ ...e, ratio: e.rev > 0 ? (e.cost / e.rev) * 100 : Infinity }));
  econCache = { res: result, rows };
  return rows;
}

/** 항공 노선 영업계수: 편당 비용(기본비 + 거리비) ÷ 운임 수입 */
function airRatio(aps, a, b, pax, freq) {
  const A = aps.find((x) => x.id === a), B = aps.find((x) => x.id === b);
  if (!A || !B) return Infinity;
  const km = kmBetween(A.lon, A.lat, B.lon, B.lat);
  const fare = (45000 + 90 * km) * (A.country !== B.country ? 1.6 : 1);
  const cost = 2 * freq * (9e6 + 14000 * km);
  return pax > 0 ? (cost / (pax * fare)) * 100 : Infinity;
}

// ------------------------------------------------------------ 노선 모식도

/** 보통(자동) 열차의 하루 운행 횟수: 노선 최대 구간 이용객을 승차율 65%로 실을 만큼 (최소 운행 횟수 ~ 300회) */
function autoLocalTrains(line, cls, peak) {
  const c = cls === 'metro' ? 'metro' : cls === 'hsr' ? 'hsr' : 'conv';
  if (peak == null) peak = lineEconomics().find((x) => x.name === line)?.peak || 0;
  return Math.min(300, Math.max(OPERATING.minTrains[c], 2 * Math.round(peak / (2 * OPERATING.paxPerTrain[c] * OPERATING.loadFactor))));
}

/** 운행 중 계통별 구간(정차역 사이) 이용객 (시뮬레이션 결과의 가상 링크 순서대로) */
function svcSegVols() {
  const out = new Map(), sv = result?.links.svcVol;
  const built = (state.services || []).filter((s) => s.built);
  if (!sv || sv.length !== built.reduce((n, s) => n + s.segs.length, 0)) return out;
  let k = 0;
  for (const s of built) out.set(s.id, s.segs.map(() => sv[k++]));
  return out;
}

function openLineDiagram(id) {
  if (!result) return;
  const l0 = linkAt(base, state, id);
  const mode = l0.mode, line = l0.name;
  const net = effectiveNetwork(base, state);
  const stSet = mode === 2 ? new Set((base.metro_stations || []).map(([, n]) => n)) : railStationSet();
  const nodes = lineStations(net, stSet, line, mode);
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
  for (const s of (state.services || []).filter((x) => x.line === line)) {
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
    rows.push({ name: s.name, kind: s.kind, first, last, stops, trains: s.built ? s.trains : 0, times: timesFor(first, last, stops, Math.max(1, (s.runMin || baseRun) / baseRun)),
      segVC: v ? segVC : null,
      label: `${SERVICE_KINDS[s.kind].label} · ${TRAIN_TYPES[s.type]?.label.split(' ')[0] || ''} ${s.sets}편성 · ${s.trains}회/일${s.built ? '' : ' · 제작 중'}` });
  }
  // 보통(자동): 모든 노선에 저절로 다니는 모든 역 정차 열차. 운행 횟수는 이용객을 승차율 65%로 실을 만큼
  const baseTrains = autoLocalTrains(line, mode === 2 ? 'metro' : l0.cls, Math.max(0, ...segs.map((s) => s.vol)));
  const all = new Set(nodes.map((_, i) => i));
  rows.push({ name: `${l0.cls === 'hsr' ? '고속' : '보통'} (자동)`, kind: 'base', first: 0, last: nodes.length - 1, stops: all, trains: baseTrains,
    times: timesFor(0, nodes.length - 1, all, 1), segVC: null, label: `모든 역 · 24시간 · ${baseTrains}회/일` });
  showLineDiagram($('#linediagram'), {
    title: `${line} · ${km.toFixed(0)}km · ${nodes.length}역`, badge: opBadge(state, operatorOf(state, l0)), stations, segs, rows,
    onStation: (i) => { flyToNode(stations[i].node); select({ type: 'node', id: stations[i].node }); },
  });
}

// ------------------------------------------------------------ 철도 운영사 (코레일·KPRail)

/** 운영사별 한 해 수지 (원/년): 철도 구간마다 수입·비용을 그 구간을 맡은 회사에 매긴다 */
function operatorEconomics() {
  const out = {};
  if (!result) return out;
  const OP = OPERATING, vol = result.links.vol;
  const kpFare = OP_FACTORS.kpFare(state.integration);
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode !== 1 || l.ext || linkPending(base, state, i) || state.replaced?.[i] || i >= vol.length) return;
    if (i >= base.links.length && !l.built) return;
    const op = operatorOf(state, l);
    const cls = l.cls === 'hsr' ? 'hsr' : 'conv';
    const v = vol[i];
    const trains = Math.max(OP.minTrains[cls] * (l.kp ? OP_FACTORS.kpMinTrains : 1), v / (OP.paxPerTrain[cls] * OP.loadFactor));
    const fareF = l.kp ? kpFare : 1;
    const costF = (l.kp ? OP_FACTORS.kpCost : 1) * (op === 'merged' ? OP_FACTORS.mergedCost : 1);
    const e = (out[op] ||= { rev: 0, cost: 0, km: 0 });
    e.km += l.len;
    e.rev += v * l.len * OP.fareKm[cls] * fareF * 365;
    e.cost += (trains * l.len * OP.trainKmCost[cls] * 365 + l.len * Math.max(1, Math.min(l.tracks || 2, 4)) * OP.trackKmCost[cls]) * costF;
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

function serviceOperator(s) {
  const under = s.segs.flatMap((seg) => seg.via.map((i) => linkAt(base, state, i)));
  const kp = under.filter((l) => l.kp).length;
  return operatorOf(state, { mode: 1, kp: kp * 2 > under.length ? 1 : 0 });
}

/** 철도 사업 재원 고르기 (정부 예산 / 운영사 자체 재원) */
function fundSelect(ops) {
  const r = state.rail, list = [...new Set(ops)].filter(Boolean);
  const bal = list.map((op) => `${opInfo(state, op).name} ${formatWon(r.ops[op]?.cash || 0)}`).join(', ');
  return `<div class="name-row"><span class="kind">재원</span><select class="rail-fund">
      <option value="gov" ${r.fund !== 'op' ? 'selected' : ''}>정부 예산</option>
      <option value="op" ${r.fund === 'op' ? 'selected' : ''}>운영사 자체 재원${bal ? ` (잔액 ${bal})` : ''}</option></select></div>`;
}

function bindFund(el, rerender) {
  el.querySelectorAll('.rail-fund').forEach((s) => {
    s.onchange = () => { state.rail.fund = s.value; save(state); rerender(); };
  });
}

function railStatsHTML() {
  const r = state.rail, econ = operatorEconomics();
  const ops = r.merged ? ['merged'] : ['korail', 'kprail'];
  const rows = ops.map((op) => {
    const e = econ[op] || { rev: 0, cost: 0, km: 0 }, o = r.ops[op];
    const ratio = e.rev > 0 ? (e.cost / e.rev) * 100 : Infinity;
    return `<tr><td>${opBadge(state, op)} <span class="m">${Math.round(e.km).toLocaleString()}km</span></td><td>${formatWon(e.rev / 1e8)}</td><td>${formatWon(e.cost / 1e8)}</td>
      <td class="${e.rev < e.cost ? 'neg' : ''}">${formatWon((e.rev - e.cost) / 1e8)}</td><td class="${ratio > 100 ? 'neg' : ''}">${fmtRatio(ratio)}</td><td>${formatWon(o.cash)}</td></tr>`;
  }).join('');
  const charts = ops.map((op) => (r.ops[op].hist.length > 1 ? chart(`${opInfo(state, op).name} 잔액 (억원)`, r.ops[op].hist.map((h) => [h.year, h.cash])) : '')).join('');
  const actions = ops.map((op) => `<div class="row" style="display:flex;gap:6px;margin:4px 0;align-items:center">${opBadge(state, op)}
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
    ${charts}`;
}

function bindRailStats(el) {
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

// ------------------------------------------------------------ 계획 사업 (data/plans.json)

let plans = [];

/** 경유지 이름과 좌표로 기존 역(또는 도로 노드)을 찾는다: 같은 이름의 역이 6km 안에 있으면 그 역, 아니면 가까운 노드 */
function resolveWaypoint([name, lon, lat], mode) {
  const lists = mode === 2 ? [base.metro_stations || [], base.stations] : mode === 1 ? [base.stations, base.metro_stations || []] : [];
  for (const list of lists) {
    let best = null, bd = 6;
    for (const [nm, node] of list) {
      if (nm !== name && nm !== `${name}역` && nm.replace(/역$/, '') !== name) continue;
      const c = nodeCoord(node);
      const d = kmBetween(lon, lat, c[0], c[1]);
      if (d < bd) { bd = d; best = node; }
    }
    if (best != null && nodesOfMode(mode).has?.(best) !== false) return best;
  }
  return nearestNode({ lng: lon, lat }, mode, null, mode === 0 ? 4 : 1.5);
}

/** 계획 노선을 그리기로 연다 (경유지가 찍힌 상태). 확인하고 고친 뒤 착공한다 */
function openPlan(id) {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return;
  startDraft(plan.type);
  const spec = NEW_BUILDS[plan.type];
  for (const wp of plan.points) {
    const node = resolveWaypoint(wp, spec.mode);
    const c = node != null ? nodeCoord(node) : [wp[1], wp[2]];
    const pt = { node, lon: c[0], lat: c[1], split: null };
    draft.points.push(pt);
    nameDraftPoint(pt, draft.points.length - 1);
    // 새 역이면 계획에 적힌 역 이름을 쓴다
    if (spec.mode >= 1 && !pt.existing && wp[0]) { if (pt.reserved) namer.release(pt.name, 'station'); pt.name = wp[0]; pt.auto = false; }
  }
  draft.lineName = plan.name;
  draft.lineNameEdited = true;
  draft.plan = plan.id;
  drawDraft();
  renderBuild();
  const xs = draft.points.map((p) => p.lon), ys = draft.points.map((p) => p.lat);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 11 });
}

function plansHTML() {
  if (!plans.length) return '';
  const started = new Set(state.projects.map((p) => p.plan).filter(Boolean));
  const groups = [...new Set(plans.map((p) => p.group))];
  return `<h4>계획 사업</h4>
    <p class="hint">국가·광역 교통계획에 나온 노선입니다. 누르면 경유지가 찍힌 채로 그리기가 열리고, 사업비를 확인한 뒤 착공합니다 (경로는 고칠 수 있습니다).</p>
    ${groups.map((g) => `<div class="m" style="margin:6px 0 2px">${esc(g)}</div><div class="list">${plans.filter((p) => p.group === g).map((p) => {
      let km = 0;
      for (let i = 1; i < p.points.length; i++) km += kmBetween(p.points[i - 1][1], p.points[i - 1][2], p.points[i][1], p.points[i][2]);
      const spec = NEW_BUILDS[p.type];
      return `<div class="item"><div class="row" style="margin:0;justify-content:space-between">
        <span>${esc(p.name)} <span class="m">${spec.label.replace(/ 신설.*$/, '')} · 약 ${Math.round(km * 1.1)}km · ${formatWon(km * 1.1 * spec.perKm)}</span></span>
        <button class="small" data-plan="${p.id}" ${started.has(p.id) ? 'disabled' : ''}>${started.has(p.id) ? '착공함' : '열기'}</button></div></div>`;
    }).join('')}</div>`).join('')}`;
}

// ------------------------------------------------------------ 지방자치·선거·SOC 제안

let rng = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();

/** 광역 단체별 시군구 목록 (지방자치가 시행 중인 곳만) */
function regions() {
  const out = new Map();
  zoneProps.forEach((z, i) => {
    if (z.ext || !hasAutonomy(state, z)) return;
    const r = regionOf(state, z);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(i);
  });
  return out;
}

function zonePop(i) { return result ? result.zones.pop[i] : zoneProps[i].pop; }

/** 지방선거: 광역단체장과 시군구청장을 뽑는다. only: 'all' | 'kp' | 광역 단체 이름 목록 */
function holdElection(only = 'all', reason = '') {
  const L = state.local;
  const regs = regions();
  let gov = { D: 0, P: 0 }, may = { D: 0, P: 0 }, kept = 0, total = 0;
  for (const [r, zs] of regs) {
    if (Array.isArray(only) && !only.includes(r)) continue;
    if (only === 'kp' && !zs.some((i) => zoneProps[i].country === 'KP')) continue;
    let w = 0, s = 0;
    for (const i of zs) { const p = zonePop(i); w += p; s += p * leanP(zoneProps[i]); }
    const key = `g:${r}`, cur = L.offices[key];
    const res = runElection(w > 0 ? s / w : 0.5, cur, rng);
    if (cur && cur.party === res.party) { cur.approval = 50 + (cur.approval - 50) / 2; cur.terms = (cur.terms || 1) + 1; kept++; }
    else L.offices[key] = { title: governorTitle(r), region: r, party: res.party, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
    L.offices[key].share = res.share;
    gov[res.party]++; total++;
    if (only === 'all' || only === 'kp' || Array.isArray(only)) {
      for (const i of zs) {
        if (Array.isArray(only)) break;   // 광역 단체만 새로 뽑는 경우 (행정구역 개편·독립)
        if (only === 'kp' && zoneProps[i].country !== 'KP') continue;
        const z = zoneProps[i], mk = `m:${i}`, mc = L.offices[mk];
        const rm = runElection(leanP(z), mc, rng);
        if (mc && mc.party === rm.party) { mc.approval = 50 + (mc.approval - 50) / 2; mc.terms = (mc.terms || 1) + 1; }
        else L.offices[mk] = { title: mayorTitle(zoneName(i)), zone: i, party: rm.party, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
        L.offices[mk].share = rm.share;
        may[rm.party]++;
      }
    }
  }
  if (!total) return;
  L.elections.push({ year: state.year, gov, may, reason });
  const m = may.D + may.P ? ` · 기초 민주당 ${may.D} 국민의힘 ${may.P}` : '';
  state.log.unshift(`${state.year}년 ${reason || '지방선거'}: 광역 민주당 ${gov.D} 국민의힘 ${gov.P}${m}${kept ? ` (광역 재선 ${kept})` : ''}`);
}

/** 해마다: 선거 연도면 선거, 단체장들이 SOC 사업을 제안한다 */
function localYear(doneProjects) {
  const L = state.local;
  // 완공된 제안 사업은 제안한 단체장의 실적
  for (const p of doneProjects) {
    if (!p.proposal) continue;
    const pr = L.proposals.find((x) => x.id === p.proposal);
    const off = pr && L.offices[pr.office];
    if (off) { off.delivered++; bumpApproval(off, 6); }
    if (pr) pr.status = 'done';
  }
  if (state.year >= ELECTION.firstYear && (state.year - ELECTION.firstYear) % ELECTION.every === 0
    && !L.elections.some((e) => e.year === state.year && !e.reason)) holdElection('all');
  // 오래 묵힌 제안은 거절한 것으로 본다
  for (const pr of L.proposals) {
    if (pr.status === 'open' && state.year - pr.year >= 2) {
      pr.status = 'expired';
      const off = L.offices[pr.office];
      if (off) bumpApproval(off, -4);
    }
  }
  proposeProjects();
}

/** 구간이 속한 존 (구간 가운데에서 가장 가까운 존 중심) */
function zoneOfLink(id) {
  const l = linkAt(base, state, id);
  const a = nodeCoord(l.a), b = nodeCoord(l.b);
  const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
  let best = -1, bd = Infinity;
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    const d = (z.cx - x) ** 2 + (z.cy - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** 단체장 제안: 자기 지역의 혼잡 민원 가운데 가장 급한 것 (광역단체장은 해마다 1건, 시군구청장은 전국에서 6건) */
function proposeProjects() {
  const L = state.local;
  const open = new Set(L.proposals.filter((p) => p.status === 'open').flatMap((p) => p.links));
  const work = linksUnderWork(state);
  const cand = requests.filter((r) => !r.links.some((id) => open.has(id) || work.has(id))).map((r) => {
    const zi = zoneOfLink(r.links[0]);
    return { r, zi, region: zi >= 0 ? regionOf(state, zoneProps[zi]) : null };
  }).filter((c) => c.zi >= 0 && hasAutonomy(state, zoneProps[c.zi]));
  const used = new Set();
  const add = (officeKey, c) => {
    const fix = defaultFix(linkAt(base, state, c.r.links[0]));
    if (!fix) return false;
    const cost = c.r.links.reduce((s, id) => s + upgradeCost(fix, linkAt(base, state, id)), 0);
    const l0 = linkAt(base, state, c.r.links[0]);
    L.proposals.push({ id: crypto.randomUUID(), office: officeKey, year: state.year, status: 'open', links: c.r.links, fix: fix.id, cost,
      title: `${l0.name || CLASS_LABEL[l0.cls]} ${resolve(fix.label, l0)}` });
    used.add(c.r);
    return true;
  };
  for (const [key, off] of Object.entries(L.offices)) {
    if (!key.startsWith('g:')) continue;
    const c = cand.find((x) => !used.has(x.r) && x.region === off.region);
    if (c) add(key, c);
  }
  let n = 0;
  for (const c of cand) {
    if (n >= 6) break;
    if (used.has(c.r) || !L.offices[`m:${c.zi}`]) continue;
    if (add(`m:${c.zi}`, c)) n++;
  }
}

function acceptProposal(id) {
  const L = state.local, pr = L.proposals.find((p) => p.id === id);
  const r = startUpgrade(base, state, pr.links, pr.fix);
  if (!r.ok) { alert(r.reason); return; }
  state.projects[state.projects.length - 1].proposal = pr.id;
  pr.status = 'accepted';
  const off = L.offices[pr.office];
  if (off) { off.accepted++; bumpApproval(off, 3); }
  save(state); refreshLinks(); renderAll();
}

function rejectProposal(id) {
  const L = state.local, pr = L.proposals.find((p) => p.id === id);
  pr.status = 'rejected';
  const off = L.offices[pr.office];
  if (off) bumpApproval(off, -4);
  save(state); renderAll();
}

function partyBadge(p) {
  const x = PARTIES[p];
  return x ? `<span class="op-badge" style="background:${x.color}">${x.short}</span>` : '';
}

function officeLine(off) {
  if (!off) return '<span class="m">지방자치 미시행</span>';
  return `${partyBadge(off.party)} ${esc(off.title)} <span class="m">${off.since}년~ · 지지율 ${Math.round(off.approval)}% · 제안 수용 ${off.accepted} · 완공 ${off.delivered}${off.terms > 1 ? ` · ${off.terms}선` : ''}</span>`;
}

/** 민원 탭에 붙는 지자체 SOC 제안 */
function proposalsHTML() {
  const L = state.local;
  const open = L.proposals.filter((p) => p.status === 'open');
  if (!open.length) return '';
  return `<h3>지자체 SOC 제안 (${open.length})</h3>
    <p class="hint">선거로 뽑힌 단체장이 자기 지역 사업을 중앙정부에 제안합니다. 받아들여 완공하면 그 단체장의 지지율이 올라 재선에 유리합니다. 2년 안에 답하지 않으면 거절한 것으로 봅니다.</p>
    <div class="list">${open.map((p) => {
      const off = L.offices[p.office];
      return `<div class="item"><div class="t">${esc(p.title)}</div>
        <div class="m">${off ? `${partyBadge(off.party)} ${esc(off.title)}` : ''} · ${p.year}년 제안 · ${formatWon(p.cost)}</div>
        <div class="row" style="display:flex;gap:6px;margin-top:4px"><button class="small primary" data-prop-ok="${p.id}">받아들이기</button>
        <button class="small" data-prop-no="${p.id}">거절</button></div></div>`;
    }).join('')}</div>`;
}

function bindProposals(el) {
  el.querySelectorAll('[data-prop-ok]').forEach((b) => { b.onclick = () => acceptProposal(b.dataset.propOk); });
  el.querySelectorAll('[data-prop-no]').forEach((b) => { b.onclick = () => rejectProposal(b.dataset.propNo); });
}

/** 설정 탭: 지방자치·행정구역 이벤트 */
function localSettingsHTML() {
  const L = state.local;
  const pops = new Map();
  zoneProps.forEach((z, i) => { if (!z.ext) pops.set(z.name, (pops.get(z.name) || 0) + zonePop(i)); });
  const promotable = L.historic
    ? HISTORIC_CITIES.filter((c) => !L.independent.includes(c) && zoneProps.some((z) => z.province === c))
    : [...pops].filter(([n, p]) => p >= PROMOTE_MIN_POP && /시$/.test(n) && !isMetroCity(n) && !L.independent.includes(n)
      && zoneProps.some((z) => z.name === n && !isMetroCity(z.province))).map(([n]) => n);
  const next = state.year < ELECTION.firstYear ? ELECTION.firstYear
    : ELECTION.firstYear + Math.ceil((state.year - ELECTION.firstYear + 1) / ELECTION.every) * ELECTION.every;
  return `<h4>지방자치</h4>
    <p class="hint">남측은 지방자치가 시행 중이고, 4년마다(다음: ${next}년) 광역·기초단체장 선거가 열립니다.</p>
    ${L.autonomyKP ? '<p class="hint">북측 지방자치 시행 중.</p>' : `<div class="item"><div class="t">북측 지방자치 도입</div>
      <div class="m">북측에도 도지사·시장·군수를 선거로 뽑습니다. 남북 통합도 30% 이상 · ${formatWon(EVENT_COST.autonomy)}</div>
      <button class="small primary" id="ev-autonomy" ${state.integration >= 0.3 ? '' : 'disabled'}>도입</button></div>`}
    ${L.historic ? '<p class="hint">1945년 이전 13도 체제로 행정구역을 되돌렸습니다.</p>' : `<div class="item"><div class="t">1945년 이전 행정구역 복원 (13도)</div>
      <div class="m">광역시·특별시와 북측의 신설 도(자강·량강 등)를 1945년 이전의 도로 되돌립니다. 광역단체장을 새로 뽑고, 북측 주민 행복도가 조금 오릅니다 · ${formatWon(EVENT_COST.historic)}</div>
      <button class="small primary" id="ev-historic">복원</button></div>`}
    <div class="item"><div class="t">${L.historic ? '광역시 독립' : '광역시 승격'}</div>
      <div class="m">${L.historic ? '1945년 이전 체제에서 큰 도시를 도에서 다시 떼어 냅니다.' : `인구 ${PROMOTE_MIN_POP / 1e4}만 이상 시를 도에서 떼어 광역시로 만듭니다.`} 시장을 따로 뽑습니다 · 한 곳 ${formatWon(EVENT_COST.independence)}</div>
      <div class="row" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${promotable.map((c) => `<button class="small" data-ev-city="${esc(c)}">${esc(c)}</button>`).join('') || '<span class="m">대상 도시가 없습니다.</span>'}</div>
      ${L.independent.length ? `<div class="m" style="margin-top:4px">독립·승격한 도시: ${L.independent.map(esc).join(', ')}</div>` : ''}</div>`;
}

function payEvent(cost) {
  if (!canAfford(state, cost, 1)) { alert('예산과 차입 한도가 부족합니다.'); return false; }
  state.budget -= cost;
  if (state.budget < 0) { state.debt += -state.budget; state.budget = 0; }
  return true;
}

function bindLocalSettings(el) {
  const L = state.local;
  el.querySelector('#ev-autonomy')?.addEventListener('click', () => {
    if (!payEvent(EVENT_COST.autonomy)) return;
    L.autonomyKP = true;
    holdElection('kp', '북측 첫 지방선거');
    save(state); renderAll();
  });
  el.querySelector('#ev-historic')?.addEventListener('click', () => {
    if (!confirm('행정구역을 1945년 이전 13도 체제로 되돌릴까요? 광역단체장을 새로 뽑습니다.')) return;
    if (!payEvent(EVENT_COST.historic)) return;
    L.historic = true;
    for (const k of Object.keys(L.offices)) if (k.startsWith('g:')) delete L.offices[k];
    zoneProps.forEach((z, i) => { if (z.country === 'KP' && !z.ext) state.happyBonus[i] = (state.happyBonus[i] || 0) + 3; });
    holdElection([...regions().keys()], '행정구역 개편 뒤 광역단체장 선거');
    state.log.unshift(`${state.year}년 행정구역을 1945년 이전 13도 체제로 되돌렸습니다.`);
    save(state); renderAll();
  });
  el.querySelectorAll('[data-ev-city]').forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.evCity;
      if (!payEvent(EVENT_COST.independence)) return;
      // 도시가 빠진 도와 새 광역시의 단체장을 다시 뽑는다
      const zc = zoneProps.find((z) => z.province === c || z.name === c);
      const parent = zc ? regionOf(state, zc) : null;
      L.independent.push(c);
      holdElection([c, parent].filter(Boolean), `${c} ${L.historic ? '독립' : '광역시 승격'} 선거`);
      save(state); renderAll();
    };
  });
}

/** 존 패널: 광역·기초 단체장 */
function localZoneHTML(i) {
  const z = zoneProps[i];
  if (z.ext) return '';
  const L = state.local, r = regionOf(state, z);
  return `<h4>지방자치 · ${esc(r)}</h4>
    <div class="m" style="margin:2px 0">${officeLine(L.offices[`g:${r}`])}</div>
    <div class="m" style="margin:2px 0">${officeLine(L.offices[`m:${i}`])}</div>`;
}

/** 정당 지도 값: 국민의힘 1, 민주당 0, 미시행 null */
function partyValue(i, level) {
  const L = state.local, z = zoneProps[i];
  const off = level === 'gov' ? L.offices[`g:${regionOf(state, z)}`] : L.offices[`m:${i}`];
  return off ? (off.party === 'P' ? 1 : 0) : null;
}

// ------------------------------------------------------------ 구간 직선화 (두 역 사이를 가장 단순한 곡선으로)

let straight = null;   // {line, cls, picks: [역 노드], plan}

function startStraighten(linkId) {
  const l = linkAt(base, state, linkId);
  cancelDraft();
  straight = { line: l.name, cls: l.cls, picks: [], plan: null };
  map.getCanvas().style.cursor = 'crosshair';
  select({ type: 'straighten' });
}

function endStraighten() {
  straight = null;
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  if (selection?.type === 'straighten') select(null);
}

/** 노선 위의 역 가운데 누른 곳에서 가장 가까운 역 (화면 30px 안) */
function straightenClick(ll) {
  // 같은 이름 구간에 닿은 역은 모두 고를 수 있다 (노선이 갈라지거나 이름이 끊긴 곳도)
  const stSet = railStationSet();
  const stations = new Set();
  allLinks().forEach((l, i) => {
    const e = linkAt(base, state, i);
    if (e.mode === 1 && e.name === straight.line) for (const n of [e.a, e.b]) if (stSet.has(n)) stations.add(n);
  });
  const p = map.project(ll);
  let best = null, bd = 30;
  for (const n of stations) {
    const q = map.project(nodeCoord(n));
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = n; }
  }
  if (best == null) return;
  if (straight.picks.length >= 2) straight.picks = [];
  if (!straight.picks.includes(best)) straight.picks.push(best);
  straight.plan = straight.picks.length === 2 ? planStraighten() : null;
  drawStraighten();
  renderSelection();
}

/** 옛 경로를 따라 이은 좌표 (A에서 B 방향) */
function pathCoords(links, via, from) {
  const out = [];
  let node = from;
  for (const i of via) {
    const l = links[i];
    const g = allLinks()[i]?.geom || [];
    const pts = [];
    for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) pts.push([g[k], g[k + 1]]);
    const fwd = l.a === node;
    const seq = fwd ? pts : pts.reverse();
    out.push(...(out.length ? seq.slice(1) : seq));
    node = fwd ? l.b : l.a;
  }
  return out;
}

/**
 * 새 선형: 옛 경로가 두 역을 잇는 직선에서 많이 벗어나지 않으면 직선, 아니면 옛 경로의 가운데를 향해 한 번만 휘는 2차 곡선.
 * 사이의 역은 새 선형 위 가장 가까운 자리로 옮기고, 너무 가까워진 역(일반 1.5km, 고속 5km 안)은 이용객이 많은 쪽으로 합친다.
 */
function planStraighten() {
  const net = effectiveNetwork(base, state);
  const [A, B] = straight.picks;
  const via = railPath(net.links, A, B, straight.line);
  if (!via || !via.length) return null;
  const oldKm = via.reduce((s, i) => s + net.links[i].len, 0);
  const oldMin = via.reduce((s, i) => s + (net.links[i].len / net.links[i].speed) * 60, 0);
  const path = pathCoords(net.links, via, A);
  const pa = nodeCoord(A), pb = nodeCoord(B);
  const chord = kmBetween(pa[0], pa[1], pb[0], pb[1]);
  // 옛 경로의 길이 가운데 점과 직선에서 가장 먼 거리
  let acc = 0, mid = path[0], half = polylineKm(path) / 2, dev = 0;
  for (let k = 1; k < path.length; k++) {
    const d = kmBetween(path[k - 1][0], path[k - 1][1], path[k][0], path[k][1]);
    if (acc < half && acc + d >= half) mid = path[k];
    acc += d;
  }
  const m0 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  for (const q of path) dev = Math.max(dev, distToSegKm(q, pa, pb));
  let ctrl = null;
  if (dev > 0.08 * chord) {
    const c = [2 * mid[0] - m0[0], 2 * mid[1] - m0[1]];
    ctrl = [m0[0] + 0.6 * (c[0] - m0[0]), m0[1] + 0.6 * (c[1] - m0[1])];
  }
  const at = (t) => (ctrl
    ? [(1 - t) ** 2 * pa[0] + 2 * (1 - t) * t * ctrl[0] + t * t * pb[0], (1 - t) ** 2 * pa[1] + 2 * (1 - t) * t * ctrl[1] + t * t * pb[1]]
    : [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]);
  const N = 200, curve = Array.from({ length: N + 1 }, (_, k) => at(k / N));
  const newKm = polylineKm(curve) * 1.02;
  // 곡선 반경으로 낼 수 있는 속도 (v ≈ 4.7 √R, R은 m)
  let minR = Infinity;
  for (let k = 1; k < N; k++) {
    const a = curve[k - 1], b = curve[k], c = curve[k + 1];
    const ab = kmBetween(a[0], a[1], b[0], b[1]), bc = kmBetween(b[0], b[1], c[0], c[1]), ac = kmBetween(a[0], a[1], c[0], c[1]);
    const s = (ab + bc + ac) / 2, area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ac)));
    if (area > 1e-12) minR = Math.min(minR, (ab * bc * ac) / (4 * area) * 1000);
  }
  const vmax = straight.cls === 'hsr' ? 300 : 200;
  const speed = Math.round(Math.min(vmax, isFinite(minR) ? 4.7 * Math.sqrt(minR) : vmax) / 10) * 10;
  // 사이의 역: 옛 경로 순서대로, 새 선형 위 가장 가까운 자리로
  const stSet = railStationSet(), riders = stationRiders();
  const mids = [];
  let node = A;
  for (const i of via) { const l = net.links[i]; node = l.a === node ? l.b : l.a; if (node !== B && stSet.has(node)) mids.push(node); }
  const proj = mids.map((n) => {
    const c = nodeCoord(n);
    let bk = 0, bdd = Infinity;
    curve.forEach((q, k) => { const d = kmBetween(c[0], c[1], q[0], q[1]); if (d < bdd) { bdd = d; bk = k; } });
    return { node: n, name: nodeNames().get(n)?.name || '', t: bk / N, pos: curve[bk], moveKm: bdd, riders: riders.get(n) || 0 };
  }).filter((x) => x.t > 0.01 && x.t < 0.99).sort((x, y) => x.t - y.t);
  const gap = straight.cls === 'hsr' ? 5 : 1.5;
  const kept = [];
  for (const s of proj) {
    const prev = kept[kept.length - 1];
    if (prev && kmBetween(prev.pos[0], prev.pos[1], s.pos[0], s.pos[1]) < gap) {
      if (s.riders > prev.riders) { s.merged = [...(prev.merged || []), prev]; kept[kept.length - 1] = s; } else (prev.merged ||= []).push(s);
    } else kept.push(s);
  }
  const spec = NEW_BUILDS[straight.cls === 'hsr' ? 'hsr' : 'rail'];
  const kp = isKP(pa[1], pa[0]) && isKP(pb[1], pb[0]);
  const cost = Math.round(newKm * spec.perKm * (kp ? KP_COST_FACTOR : 1) + kept.length * MID_COST.rail);
  const newMin = (newKm / speed) * 60 + kept.length * P.railDwellMin;
  return { A, B, via, oldKm, oldMin, newKm, newMin, speed, curve, kept, cost, years: spec.years, ctrl: !!ctrl };
}

function distToSegKm(p, a, b) {
  const kx = 111.32 * Math.cos((p[1] * Math.PI) / 180), ky = 110.57;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function drawStraighten() {
  const f = straight.picks.map((n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  const pl = straight.plan;
  if (pl) {
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pl.curve } });
    for (const s of pl.kept) f.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: s.pos } });
  }
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
}

function straightenPanel() {
  const s = straight, pl = s.plan, nn = nodeNames();
  const picks = s.picks.map((n) => esc(nn.get(n)?.name || '')).join(' → ');
  if (!pl) {
    return `${header(`${s.line} 구간 직선화`)}
      <p class="hint">노선 위의 두 역을 차례로 누르세요. ${picks ? `고른 역: ${picks}` : ''}<br>
      두 역 사이를 가장 단순한 곡선(직선 또는 한 번 휜 곡선)으로 새로 놓고, 완공되면 옛 구간은 폐선합니다. 사이의 역은 새 선로 위 가장 알맞은 자리로 옮깁니다.</p>
      ${s.picks.length === 2 ? '<p class="hint neg">두 역 사이 경로를 찾지 못했습니다.</p>' : ''}`;
  }
  const merged = pl.kept.flatMap((k) => (k.merged || []).map((m) => `${esc(m.name)} → ${esc(k.name)}`));
  return `${header(`${s.line} 구간 직선화`)}
    <p class="hint">${picks} · ${pl.ctrl ? '한 번 휜 곡선' : '직선'}</p>
    <table class="kv">
      <tr><td>길이</td><td>${pl.oldKm.toFixed(1)} → <b>${pl.newKm.toFixed(1)}km</b></td></tr>
      <tr><td>최고 속도 (곡선 반경 기준)</td><td>${pl.speed} km/h</td></tr>
      <tr><td>주행 시간 (정차 포함)</td><td>${fmtMin(pl.oldMin)} → <b>${fmtMin(pl.newMin)}</b></td></tr>
      <tr><td>사업비 · 공기</td><td>${formatWon(pl.cost)} · ${pl.years}년</td></tr>
    </table>
    <h4>옮기는 역 (${pl.kept.length})</h4>
    <div class="m">${pl.kept.map((k) => `${esc(k.name)} ${Math.round(k.moveKm * 1000).toLocaleString()}m 이동`).join(' · ') || '사이에 역이 없습니다.'}</div>
    ${merged.length ? `<div class="m" style="margin-top:4px">합치는 역: ${merged.join(' · ')}</div>` : ''}
    <p class="hint">완공되면 옛 구간 ${pl.via.length}개는 폐선하고, 역 이름과 운행 계통의 정차역은 새 자리로 이어집니다.</p>
    ${fundSelect([operatorOf(state, { mode: 1, kp: isKP(nodeCoord(pl.A)[1], nodeCoord(pl.A)[0]) ? 1 : 0 })])}
    <div class="row" style="display:flex;gap:6px;margin-top:8px">
      <button class="primary" id="st-ok">착공</button><button id="st-prev">효과 미리보기</button><button id="st-cancel">취소</button></div>`;
}

function bindStraighten(el) {
  bindFund(el, renderSelection);
  el.querySelector('.close')?.addEventListener('click', endStraighten);
  el.querySelector('#st-cancel')?.addEventListener('click', endStraighten);
  el.querySelector('#st-ok')?.addEventListener('click', commitStraighten);
  el.querySelector('#st-prev')?.addEventListener('click', previewStraighten);
}

function commitStraighten() {
  const pl = straight.plan;
  if (!pl) return;
  const pts = [{ node: pl.A, lon: nodeCoord(pl.A)[0], lat: nodeCoord(pl.A)[1] },
    ...pl.kept.map((k) => ({ node: null, lon: k.pos[0], lat: k.pos[1] })),
    { node: pl.B, lon: nodeCoord(pl.B)[0], lat: nodeCoord(pl.B)[1] }];
  const names = {};
  pl.kept.forEach((k, i) => { names[i + 1] = { name: k.name, kind: 'station', auto: false }; });
  const r = startNewBuild(base, state, { type: straight.cls === 'hsr' ? 'hsr' : 'rail', points: pts, names, lineName: straight.line,
    extendOf: null, extraCost: pl.kept.length * MID_COST.rail });
  if (!r.ok) { alert(r.reason); return; }
  const p = state.projects[state.projects.length - 1];
  // 새 선로 속성: 곡선 반경 속도, 옛 선로의 전철 방식
  const oldL = allLinks()[pl.via[0]];
  for (const id of p.links) {
    const nl = state.newLinks[id - base.links.length];
    nl.speed = pl.speed;
    if (oldL?.power && oldL.power !== 'none') nl.power = oldL.power;
  }
  // 완공 때 폐선할 옛 구간과 역 옮기기 (옛 역 → 새 역, 합친 역은 남는 역으로)
  const newStations = p.stations;
  p.retire = pl.via;
  p.stationMap = {};
  pl.kept.forEach((k, i) => {
    p.stationMap[k.node] = newStations[i];
    for (const m of k.merged || []) p.stationMap[m.node] = newStations[i];
  });
  p.label = `${straight.line} 직선화 ${nodeNames().get(pl.A)?.name}–${nodeNames().get(pl.B)?.name} (${pl.oldKm.toFixed(0)}→${pl.newKm.toFixed(0)}km)`;
  state.log[0] = `${state.year}년 착공: ${p.label} (${formatWon(p.cost)}, ${p.years}년)`;
  endStraighten();
  save(state); refreshLinks(); refreshPoints(); renderAll();
  switchTab('projects');
}

/** 직선화가 완공되면: 운행 계통의 정차역을 새 역으로 바꾸고 경로를 다시 잡는다 */
function afterStraighten(done) {
  const projs = done.filter((p) => p.retire);
  if (!projs.length) return;
  const map_ = Object.assign({}, ...projs.map((p) => p.stationMap));
  const retired = new Set(projs.flatMap((p) => p.retire));
  const links = effectiveNetwork(base, state).links;
  for (const s of state.services || []) {
    const touches = s.segs.some((sg) => sg.via.some((i) => retired.has(i))) || s.stops.some((n) => map_[n] != null);
    if (!touches) continue;
    s.stops = [...new Set(s.stops.map((n) => map_[n] ?? n))];
    const plan = planService(links, railStationSet(), s.stops, s.kind, s.line, s.type);
    if (plan) { s.segs = plan.segs; s.runMin = plan.runMin; s.km = plan.km; s.trains = tripsPerDay(s.sets, plan.runMin); }
  }
}

// ------------------------------------------------------------ 착공 전 효과 미리보기

let previewSeq = 0, previewWait = null;

/**
 * 사업을 다 지었다고 치고 한 해 통행배정을 돌려 본다. mutate(복사한 상태)는 사업을 반영하고 바뀐 구간 id 목록을 돌려준다.
 * 결과는 화면 위 상자에 뜬다 (약 20~40초).
 */
function runPreview(title, mutate, extra = {}) {
  if (busy || !result) return;
  const clone = structuredClone(state);
  let touched;
  try { touched = mutate(clone); } catch (e) { alert(`미리보기를 만들 수 없습니다: ${e.message}`); return; }
  if (!touched) return;
  const net = effectiveNetwork(base, clone);
  const id = ++previewSeq;
  previewWait = { id, title, touched, extra, clone };
  showPreviewBox(`<b>${esc(title)}</b><p class="hint">효과를 계산하는 중입니다 (지금 그대로와 다 지은 뒤를 견주느라 약 40초)…</p>`);
  setBusy(true, '효과 미리보기', 0);
  worker.postMessage({ type: 'preview', id, net, ctx: ctx() });
}

/** 다 지은 상태로 바꾼다: 신설 사업이면 새 구간을 개통으로, 개량이면 속성을 바로 적용 */
function buildNow(clone, p) {
  if (p.kind === 'upgrade') {
    const u = UPGRADES.find((x) => x.id === p.upgrade);
    for (const lid of p.links) clone.overrides[lid] = { ...(clone.overrides[lid] || {}), ...u.apply(linkAt(base, clone, lid)) };
  } else {
    for (const lid of p.links) clone.newLinks[lid - base.links.length].built = true;
    for (const s of p.stations || []) if (!clone.newStations.includes(s)) clone.newStations.push(s);
    for (const lid of p.retire || []) {
      if (lid < base.links.length) (clone.replaced ||= {})[lid] = true; else clone.newLinks[lid - base.links.length].replaced = true;
    }
  }
  clone.projects = clone.projects.filter((x) => x !== p);
  return p.links;
}

function onPreview(m) {
  setBusy(false);
  if (!previewWait || m.id !== previewWait.id) return;
  const { title, touched, extra, clone } = previewWait;
  previewWait = null;
  const B = m.before, A = m.after;
  const len = (i, st) => linkAt(base, st, i).len;
  const congKm = (vc, st, n) => { let s = 0; for (let i = 0; i < n; i++) { const l = linkAt(base, st, i); if (l.mode === 0 && vc[i] > 1 && !st.replaced?.[i]) s += l.len; } return s; };
  const nB = B.vc.length, nA = A.vc.length;
  const newUse = Math.max(0, ...touched.filter((i) => i < nA).map((i) => A.vol[i]));
  // 가장 많이 덜어진 구간 (이름 있는 기존 구간)
  const relief = [];
  for (let i = 0; i < nB; i++) {
    const l = linkAt(base, state, i);
    if (!l.name || touched.includes(i)) continue;
    const d = B.vol[i] - A.vol[i];
    if (d > 0 && B.vc[i] > 0.6) relief.push([d, l.name, B.vc[i], A.vc[i]]);
  }
  relief.sort((x, y) => y[0] - x[0]);
  const seen = new Set(), top = relief.filter(([, n]) => (seen.has(n) ? false : seen.add(n))).slice(0, 4);
  const d = (k) => (A.totals[k] || 0) - (B.totals[k] || 0);
  const sign = (v, f) => `${v >= 0 ? '+' : '−'}${f(Math.abs(v))}`;
  const row = (label, v) => `<tr><td>${label}</td><td>${v}</td></tr>`;
  // 도로 차량 통행 시간 (대·시간/일): 구간 교통량 × 길이 ÷ 실제 속도
  const vht = (R, st, n) => { let s = 0; for (let i = 0; i < n; i++) { const l = linkAt(base, st, i); if (l.mode === 0 && R.speed[i] > 0 && !st.replaced?.[i]) s += (R.vol[i] * l.len) / R.speed[i]; } return s; };
  const vhm = vht(A, clone, nA) - vht(B, state, nB);
  const res = { newUse, dRail: d('rail'), dTrips: d('trips'), dVhm: vhm, congB: congKm(B.vc, state, nB), congA: congKm(A.vc, clone, nA) };
  lastPreview = { title, ...res, touched, extra };
  showPreviewBox(`<b>${esc(title)}</b> <span class="m">다 지었을 때 (한 해 통행배정 기준)</span>
    <table class="kv">
      ${row('새·개량 구간 최대 이용', `${Math.round(newUse).toLocaleString()} ${touched.some((i) => linkAt(base, clone, i).mode === 0) ? 'PCU' : '명'}/일`)}
      ${row('하루 도로 차량 통행 시간', `${sign(vhm, (v) => `${Math.round(v).toLocaleString()}대·시간`)}`)}
      ${row('철도 이용 (지역 간)', `${sign(res.dRail, (v) => `${Math.round(v).toLocaleString()}명/일`)}`)}
      ${row('지역 간 통행 (유발 수요)', `${sign(res.dTrips, (v) => `${Math.round(v).toLocaleString()}통행/일`)}`)}
      ${row('정체 도로 (V/C>1)', `${res.congB.toFixed(0)} → ${res.congA.toFixed(0)} km`)}
    </table>
    ${top.length ? `<div class="m">혼잡이 줄어드는 곳: ${top.map(([, n, b, a]) => `${esc(n)} (V/C ${b.toFixed(2)}→${a.toFixed(2)})`).join(' · ')}</div>` : ''}
    ${extra.html ? extra.html({ ...res, touched }, A, clone) : ''}
    <p class="hint">실제 효과는 해마다 조금씩 나타나고, 인구·소득 변화에 따라 달라집니다.</p>`);
}
let lastPreview = null;

function showPreviewBox(html) {
  let el = $('#previewbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'previewbox';
    $('main').appendChild(el);
  }
  el.innerHTML = `<button class="small close" style="float:right">닫기</button>${html}`;
  el.hidden = false;
  el.querySelector('.close').onclick = () => { el.hidden = true; };
}

/** 그리는 중인 신설 노선 미리보기 (중간 IC·역을 새로 만드는 점은 그 자리 노드 없이 계산) */
function previewDraft() {
  if (!draft || draft.points.length < 2) return;
  const dc = draftCost();
  const pts = draft.points.map((p) => ({ ...p, split: null }));
  runPreview(`${draftLineName() || NEW_BUILDS[draft.type].label} 미리보기`, (c) => {
    const r = startNewBuild(base, c, { type: draft.type, points: pts, names: {}, lineName: draftLineName(), segFactor: dc.segFactor, extraCost: dc.extraCost });
    if (!r.ok) throw new Error(r.reason);
    return buildNow(c, c.projects[c.projects.length - 1]);
  }, { kind: 'new', cost: dc.cost });
}

function previewUpgrade(ids, upId) {
  const u = UPGRADES.find((x) => x.id === upId);
  const l = linkAt(base, state, ids[0]);
  runPreview(`${l.name || CLASS_LABEL[l.cls]} ${resolve(u.label, l)} 미리보기`, (c) => {
    const r = startUpgrade(base, c, ids, upId);
    if (!r.ok) throw new Error(r.reason);
    return buildNow(c, c.projects[c.projects.length - 1]);
  });
}

function previewStraighten() {
  const pl = straight?.plan;
  if (!pl) return;
  runPreview(`${straight.line} 직선화 미리보기`, (c) => {
    const pts = [{ node: pl.A, lon: nodeCoord(pl.A)[0], lat: nodeCoord(pl.A)[1] }, ...pl.kept.map((k) => ({ node: null, lon: k.pos[0], lat: k.pos[1] })),
      { node: pl.B, lon: nodeCoord(pl.B)[0], lat: nodeCoord(pl.B)[1] }];
    const r = startNewBuild(base, c, { type: straight.cls === 'hsr' ? 'hsr' : 'rail', points: pts, names: {}, lineName: straight.line });
    if (!r.ok) throw new Error(r.reason);
    const p = c.projects[c.projects.length - 1];
    for (const lid of p.links) c.newLinks[lid - base.links.length].speed = pl.speed;
    p.retire = pl.via;
    return buildNow(c, p);
  });
}

// ------------------------------------------------------------ 저장 슬롯

const SLOTS = 3;
function slotInfo(n) {
  try { const v = JSON.parse(localStorage.getItem(`ukt-slot-${n}`) || 'null'); return v; } catch { return null; }
}

function slotsHTML() {
  return `<div class="list">${Array.from({ length: SLOTS }, (_, k) => {
    const v = slotInfo(k + 1);
    return `<div class="item"><div class="row" style="margin:0;justify-content:space-between;align-items:center">
      <span>슬롯 ${k + 1} <span class="m">${v ? `${v.state.year}년 · ${new Date(v.savedAt).toLocaleString('ko-KR')}` : '비어 있음'}</span></span>
      <span><button class="small" data-slot-save="${k + 1}">저장</button> <button class="small" data-slot-load="${k + 1}" ${v ? '' : 'disabled'}>불러오기</button></span></div></div>`;
  }).join('')}</div>`;
}

function bindSlots(el) {
  el.querySelectorAll('[data-slot-save]').forEach((b) => {
    b.onclick = () => {
      try {
        localStorage.setItem(`ukt-slot-${b.dataset.slotSave}`, JSON.stringify({ savedAt: Date.now(), state }));
        state.log.unshift(`${state.year}년 슬롯 ${b.dataset.slotSave}에 저장했습니다.`);
        renderAll();
      } catch (e) { alert(`저장하지 못했습니다 (브라우저 저장 공간 부족): ${e.message}`); }
    };
  });
  el.querySelectorAll('[data-slot-load]').forEach((b) => {
    b.onclick = () => {
      const v = slotInfo(b.dataset.slotLoad);
      if (!v || !confirm(`슬롯 ${b.dataset.slotLoad}(${v.state.year}년)을 불러올까요? 지금 진행은 슬롯에 저장하지 않았다면 사라집니다.`)) return;
      save(v.state);
      clearSim();
      location.reload();
    };
  });
}

// ------------------------------------------------------------ 도시철도 구 안 이용 (추정)

/**
 * 도시철도역 하루 승하차 추정: 시군구 사이 통행만 세는 모형에는 같은 구 안 이용이 빠져 있어서,
 * 역 반경 800m 인구 × 0.45회(역세권 주민 1인당 하루 도시철도 승하차, 환승·외부 방문 포함 어림)로 보탠다
 */
const METRO_PER_RESIDENT = 0.45, METRO_TRIP_KM = 7;
const metroEstCache = new Map();
function metroStationEst(node) {
  if (!metroEstCache.has(node)) {
    const c = nodeCoord(node);
    metroEstCache.set(node, c ? popWithin(c[0], c[1], 0.8) * METRO_PER_RESIDENT : 0);
  }
  return metroEstCache.get(node);
}

/** 도시철도 노선별 구 안 이용 수입 (원/년): 노선 위 역 추정 승하차 ÷ 그 역의 노선 수 × 평균 7km × km당 운임 */
function metroIntraRevenue(line) {
  const ms = new Set((base.metro_stations || []).map(([, n]) => n));
  const at = new Map();
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode !== 2 || !l.name) return;
    for (const n of [l.a, l.b]) if (ms.has(n)) { if (!at.has(n)) at.set(n, new Set()); at.get(n).add(l.name); }
  });
  let s = 0;
  for (const [n, lines] of at) if (lines.has(line)) s += metroStationEst(n) / lines.size;
  return (s / 2) * METRO_TRIP_KM * OPERATING.fareKm.metro * 365;   // 승하차 2번이 1통행
}

// ------------------------------------------------------------ 재정사업·민자사업

function pppSig(p) { return JSON.stringify([draft?.points.map((x) => [x.lon, x.lat]), draft?.type, p]); }

/** 그리기 패널: 사업 방식과 민자 조건 */
function pppSection() {
  if (!draft || draft.type === 'airport') return '';
  const p = (draft.ppp ||= { type: 'gov', ...PPP_DEFAULTS });
  const opts = Object.entries(PPP_TYPES).map(([k, v]) => `<option value="${k}" ${k === p.type ? 'selected' : ''}>${v.label}</option>`).join('');
  if (p.type === 'gov') return `<div class="name-row"><span class="kind">방식</span><select id="ppp-type">${opts}</select></div>`;
  const ev = draft.pppEval && draft.pppEval.sig === pppSig(p) ? draft.pppEval : null;
  const sel = (id, vals, cur, fmt) => `<select id="${id}">${vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select>`;
  return `<div class="name-row"><span class="kind">방식</span><select id="ppp-type">${opts}</select></div>
    <div class="ppp-grid">
      <label>운영 기간 ${sel('ppp-years', [20, 30, 40], p.years, (v) => `${v}년`)}</label>
      <label>민간 목표 수익률 ${sel('ppp-target', [0.04, 0.05, 0.06, 0.07, 0.08], p.target, (v) => `${Math.round(v * 100)}%`)}</label>
      ${p.type === 'bto' ? `<label>통행료·운임 (재정 대비) ${sel('ppp-toll', [1, 1.2, 1.3, 1.5, 1.8, 2], p.tollMult, (v) => `${v}배`)}</label>
      <label>최소운영수입보장 ${sel('ppp-mrg', [0, 0.5, 0.7, 0.9], p.mrg, (v) => (v ? `예측의 ${Math.round(v * 100)}%` : '없음'))}</label>` : ''}
      <label>정부 건설보조금 ${sel('ppp-subsidy', [0, 0.1, 0.2, 0.3, 0.4, 0.5], p.subsidy, (v) => `${Math.round(v * 100)}%`)}</label>
    </div>
    <button class="small" id="ppp-eval" ${draft.points.length < 2 ? 'disabled' : ''}>수요 예측·민간 수익성 검토 (약 40초)</button>
    ${ev ? `<table class="kv" style="margin-top:6px">
      <tr><td>예측 이용 (개통 첫해)</td><td>${Math.round(ev.useKm).toLocaleString()} ${ev.kind === 'road' ? '대·km' : '인·km'}/일</td></tr>
      <tr><td>민간 투자비 · 연 운영비</td><td>${formatWon(ev.ev.privateCapex)} · ${formatWon(ev.ev.opex)}</td></tr>
      ${p.type === 'bto' ? `<tr><td>첫해 통행료·운임 수입</td><td>${formatWon(ev.ev.rev1)}</td></tr>
        ${p.mrg ? `<tr><td>최소운영수입보장 기준</td><td>연 ${formatWon(ev.ev.mrgFloor)}</td></tr>` : ''}`
        : `<tr><td>정부 연 임대료 (${p.years}년)</td><td>${formatWon(ev.ev.lease)}</td></tr>`}
      <tr><td>민간 수익률 (IRR)</td><td class="${ev.ev.viable ? 'pos' : 'neg'}">${(ev.ev.irr * 100).toFixed(1)}% (목표 ${Math.round(p.target * 100)}%)</td></tr>
      </table><p class="hint ${ev.ev.viable ? '' : 'neg'}">${ev.ev.viable ? '민간 사업자가 참여합니다. 착공하면 정부는 건설보조금만 냅니다.' : '수익률이 목표에 못 미쳐 민간이 참여하지 않습니다. 보조금·통행료·최소운영수입보장을 올리거나 운영 기간을 늘려 보세요.'}</p>`
      : '<p class="hint">민자로 하려면 먼저 수요를 예측하고 민간 수익성을 검토하세요. 조건을 바꾸면 다시 검토해야 합니다.</p>'}`;
}

function bindPPP(el) {
  const p = draft?.ppp;
  if (!p) return;
  const on = (id, f) => { const x = el.querySelector(id); if (x) x.onchange = () => { f(x.value); renderBuild(); }; };
  on('#ppp-type', (v) => { p.type = v; });
  on('#ppp-years', (v) => { p.years = +v; });
  on('#ppp-target', (v) => { p.target = +v; });
  on('#ppp-toll', (v) => { p.tollMult = +v; });
  on('#ppp-mrg', (v) => { p.mrg = +v; });
  on('#ppp-subsidy', (v) => { p.subsidy = +v; });
  el.querySelector('#ppp-eval')?.addEventListener('click', evaluateDraftPPP);
}

/** 민자 검토: 통행료를 붙인 채로 다 지었다고 치고 배정해 이용을 예측하고, 민간 수익률을 셈한다 */
function evaluateDraftPPP() {
  const p = draft.ppp, spec = NEW_BUILDS[draft.type];
  const kind = tollKind({ mode: spec.mode, cls: spec.attrs.cls });
  const dc = draftCost();
  const pts = draft.points.map((x) => ({ ...x, split: null }));
  const sig = pppSig(p);
  runPreview(`${draftLineName() || spec.label} 수요 예측 (${PPP_TYPES[p.type].label})`, (c) => {
    const r = startNewBuild(base, c, { type: draft.type, points: pts, names: {}, lineName: draftLineName(), segFactor: dc.segFactor, extraCost: dc.extraCost,
      ppp: { type: p.type, subsidy: p.subsidy, toll: linkToll(kind, p.type, p.tollMult) } });
    if (!r.ok) throw new Error(r.reason);
    return buildNow(c, c.projects[c.projects.length - 1]);
  }, {
    html: (res, A, clone) => {
      const useKm = res.touched.filter((i) => i < A.vol.length).reduce((s, i) => s + A.vol[i] * linkAt(base, clone, i).len, 0);
      const ev = evaluatePPP(p, { cost: dc.cost, years: spec.years, km: dc.km, kind, useKm });
      if (draft) { draft.pppEval = { sig, ev, useKm, kind }; renderBuild(); }
      return `<p class="${ev.viable ? 'pos' : 'neg'}">민간 수익률 ${(ev.irr * 100).toFixed(1)}% → ${ev.viable ? '민간 참여 가능' : '민간 참여 불가'}</p>`;
    },
  });
}

/** 착공할 때 민자 계약을 맺는다 */
function pppPlan() {
  const p = draft.ppp;
  if (!p || p.type === 'gov') return null;
  const ev = draft.pppEval && draft.pppEval.sig === pppSig(p) ? draft.pppEval : null;
  if (!ev || !ev.ev.viable) return false;
  const spec = NEW_BUILDS[draft.type];
  return { type: p.type, subsidy: p.subsidy, toll: linkToll(tollKind({ mode: spec.mode, cls: spec.attrs.cls }), p.type, p.tollMult), ev };
}

function addContract(proj, pp, name) {
  const p = draft.ppp;
  initPPP(state).push({
    id: crypto.randomUUID(), project: proj.id, name, params: { ...p }, kind: pp.ev.kind,
    links: proj.links, newLinkIdx: proj.links.map((i) => i - base.links.length), km: draftCost().km,
    forecast: { useKm: pp.ev.useKm }, eval: { rev1: pp.ev.ev.rev1, lease: pp.ev.ev.lease, irr: pp.ev.ev.irr },
    cum: { rev: 0, mrg: 0, lease: 0 }, hist: [],
  });
}

/** 해마다 민자 정산 (실제 이용은 그해 배정 결과) */
function pppYear() {
  const uses = {};
  for (const c of state.ppp || []) uses[c.id] = c.links.filter((i) => i < result.links.vol.length).reduce((s, i) => s + result.links.vol[i] * linkAt(base, state, i).len, 0);
  settlePPP(state, uses, (c, use) => annualRevenue(use, c.kind, c.params.type === 'bto' ? c.params.tollMult : 1) / 1e8);
}

function pppTableHTML() {
  const list = state.ppp || [];
  if (!list.length) return '';
  return `<h3 style="margin-top:16px">민자사업 (${list.length})</h3>
    <table class="cmp"><tr><th>사업</th><th>방식</th><th>예측 대비 이용</th><th>정부 지급 누계</th></tr>${list.map((c) => {
      const last = c.hist[c.hist.length - 1];
      const ratio = last ? last.use / Math.max(1, c.forecast.useKm) : null;
      return `<tr><td>${esc(c.name)} <span class="m">${c.ended ? `${c.ended}년 귀속` : c.hist.length ? `운영 ${c.hist.length}/${c.params.years}년` : '건설 중'}</span></td>
        <td>${c.params.type.toUpperCase()}</td><td class="${ratio != null && ratio < 0.8 ? 'neg' : ''}">${ratio == null ? '–' : `${Math.round(ratio * 100)}%`}</td>
        <td>${formatWon(c.cum.mrg + c.cum.lease)}${c.params.type === 'bto' && c.cum.mrg ? ' (MRG)' : c.params.type === 'btl' ? ' (임대료)' : ''}</td></tr>`;
    }).join('')}</table>`;
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
  const planned = id < base.links.length && linkPending(base, state, id);
  const osmProj = planned && state.projects.find((p) => p.kind === 'osm' && p.status === 'building' && p.links.includes(id));
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
      ${operatorOf(state, l) ? `<tr><td>운영사</td><td>${opBadge(state, operatorOf(state, l))}</td></tr>` : ''}
      <tr><td>연장</td><td>${l.len.toFixed(1)} km</td></tr>
      ${rows}
      <tr><td>혼잡도 (V/C)</td><td class="${vc > 1 ? 'neg' : ''}">${vc.toFixed(2)}</td></tr>
    </table>
    ${l.mode >= 1 && l.name && !l.ext && !planned ? serviceSection(l) : ''}
    ${isNew && l.name ? `<h4>노선 이름</h4><div class="name-row"><input type="text" id="line-rename" value="${esc(l.name)}">
      <button class="small" id="line-rename-ok">바꾸기</button></div>` : ''}
    ${planned ? `<p class="hint">진행 중인 사업 구간입니다: ${esc(osmProj?.label || '')} · ${osmProj ? `${osmProj.doneYear}년 개통 예정` : ''}. 사업 탭에서 예산 투입 속도를 바꿀 수 있습니다.</p>`
    : l.ext ? '<p class="hint">국외 거점과 잇는 국경 연결 구간입니다. 개량 대상이 아닙니다.</p>'
    : l.cls === 'ferry' ? '<p class="hint">여객선 항로입니다. 개량 대상이 아닙니다.</p>'
    : busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>` : `<h4>개량</h4>
    ${l.mode === 1 ? fundSelect([operatorOf(state, l)]) : ''}
    ${route.length > 1 ? `<label class="name-row"><input type="checkbox" id="whole-route" ${wholeRoute ? 'checked' : ''}>
      <span>같은 이름 노선 전체 (${route.length}개 구간, ${routeKm.toFixed(0)}km)</span></label>` : ''}
    <div class="list">${ups.map((u) => {
      const ids = (wholeRoute && route.length > 1 ? route : [id]).filter((x) => u.applies(linkAt(base, state, x)));
      const cost = ids.reduce((sum, x) => sum + upgradeCost(u, linkAt(base, state, x)), 0);
      const ok = canAfford(state, cost, u.years, fundFor(state, ids.map((x) => linkAt(base, state, x))));
      return `<div class="item"><div class="row" style="margin:0;justify-content:space-between">
        <span>${resolve(u.label, l)}${ids.length > 1 ? ` · ${ids.length}개 구간` : ''}</span>
        <span><button class="small" data-prev-up="${u.id}" title="다 지었을 때 효과">미리보기</button>
        <button class="small ${ok ? 'primary' : ''}" data-up="${u.id}" ${ok ? '' : 'disabled'}>${formatWon(cost)} · ${u.years}년</button></span></div></div>`;
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
    return l.mode === mode && !l.ext && l.cls !== 'ferry' && !(i < base.links.length && linkPending(base, state, i)) && !work.has(i);
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
      <tr><td>소속</td><td>${esc(regionOf(state, z))} (${z.country === 'KP' ? '북' : '남'})${name !== z.name ? ` · 원래 이름 ${esc(z.name)}` : ''}</td></tr>
      ${happiness ? `<tr><td>주민 행복도</td><td>${happiness[id].toFixed(1)}</td></tr>` : ''}
      <tr><td>인구</td><td>${fmtPop(r.pop[id])} <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>지난해 순이동</td><td>${Math.round(r.netMig[id]).toLocaleString()}명</td></tr>
      <tr><td>HDI</td><td>${r.hdi[id].toFixed(3)}</td></tr>
      <tr><td>기대수명</td><td>${r.le[id].toFixed(1)}세</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(r.income[id]).toLocaleString()}</td></tr>
      <tr><td>접근성 (중앙값=1)</td><td>${(r.access[id] / accRef).toFixed(2)}</td></tr>
      <tr><td>이용 철도역</td><td>${stName ? esc(stName) : '없음 (25km 밖)'}</td></tr>
    </table>
    ${localZoneHTML(id)}
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
  return `${header(n.name)}
    <p class="hint">${kindLabel}${n.isNew ? (state.names[id]?.auto ? ' · 자동 이름' : ' · 직접 지은 이름') : ' · 기존 시설 (OSM)'}</p>
    ${n.kind === 'station' ? stationPanel(id, n) : ''}
    <h4>이름</h4>
    <div class="name-row"><input type="text" id="node-name" value="${esc(n.name)}">
      <button class="small primary" id="node-save">이름 변경</button>
      <button class="small" id="node-auto" title="자동 이름">↻</button></div>`;
}

// ------------------------------------------------------------ 역 패널

/** 역에 닿는 노선들: 이름별로 수단·종류와 역 앞뒤 구간의 최대 통과 인원, 노선도를 열 구간 */
function linesAt(node) {
  const out = new Map();
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode === 0 || (l.a !== node && l.b !== node) || l.ext || (i < base.links.length && linkPending(base, state, i)) || state.replaced?.[i]) return;
    if (i >= base.links.length && !l.built) return;
    const key = l.name || CLASS_LABEL[l.cls];
    const e = out.get(key) || { name: key, named: !!l.name, mode: l.mode, cls: l.cls, vol: 0, link: i };
    e.vol = Math.max(e.vol, result?.links.vol[i] || 0);
    out.set(key, e);
  });
  return [...out.values()];
}

/** 반경 km 안의 인구 (1km 인구 격자) */
function popWithin(lon, lat, km) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57, r2 = km * km;
  let s = 0;
  for (let c = 0; c < grid.length; c += 4) {
    const dx = (grid[c] - lon) * kx, dy = (grid[c + 1] - lat) * ky;
    if (dx * dx + dy * dy <= r2) s += grid[c + 2];
  }
  return s;
}

function stationPanel(id, n) {
  const c = nodeCoord(id);
  const lines = linesAt(id);
  const k = result ? result.stations.node.indexOf(id) : -1;
  const riders = k >= 0 ? result.stations.riders[k] : null;
  // 운행 계통: 서는 계통과 그냥 지나가는 계통
  const stopping = [], passing = [];
  for (const s of state.services || []) {
    if (s.stops.includes(id)) { stopping.push(s); continue; }
    const passes = s.segs.some((seg) => seg.via.some((i) => { const l = linkAt(base, state, i); return l.a === id || l.b === id; }));
    if (passes) passing.push(s);
  }
  const svcTrains = stopping.filter((s) => s.built).reduce((a, s) => a + s.trains, 0);
  // 도보 환승: 400m 안의 다른 역 (같은 노드의 다른 노선은 위 노선 목록에 있다)
  const nn = nodeNames();
  const near = [];
  for (const [node, v] of nn) {
    if (v.kind !== 'station' || node === id || typeof node !== 'number') continue;
    const p = nodeCoord(node);
    if (!p) continue;
    const d = kmBetween(c[0], c[1], p[0], p[1]);
    if (d <= 0.4) near.push({ node, name: v.name, d, lines: linesAt(node).filter((x) => x.named).map((x) => x.name) });
  }
  near.sort((a, b) => a.d - b.d);
  // 이 역에 이미 있는 노선만 지나는 이웃(같은 노선의 다른 승강장 노드)과 겹치는 항목은 뺀다
  const here = new Set(lines.filter((l) => l.named).map((l) => l.name));
  const seen = new Set();
  for (let i = near.length - 1; i >= 0; i--) {
    const x = near[i];
    if (x.lines.length && x.lines.every((l) => here.has(l))) near.splice(i, 1);
  }
  for (let i = 0; i < near.length; i++) {
    const key = `${near[i].name}|${near[i].lines.join(',')}`;
    if (seen.has(key)) near.splice(i--, 1); else seen.add(key);
  }
  const modeLabel = (l) => (l.mode === 2 ? '도시철도' : CLASS_LABEL[l.cls]);
  const svcRow = (s, stop) => `<tr><td>${esc(s.name)} <span class="m">${SERVICE_KINDS[s.kind].label}${s.built ? '' : ' · 차량 제작 중'}</span></td>
    <td>${stop ? `하루 ${s.trains}회 · 약 ${Math.round(SERVICE_DAY_MIN / Math.max(1, s.trains / 2))}분 간격` : '통과'}</td></tr>`;
  return `
    <h4>노선</h4>
    <table class="kv">${lines.map((l) => `<tr><td>${opBadge(state, operatorOf(state, { mode: l.mode, kp: linkAt(base, state, l.link).kp }))} ${esc(l.name)} <span class="m">${modeLabel(l)}</span>
      ${l.named ? `<button class="small" data-st-diagram="${l.link}">노선도</button>` : ''}</td>
      <td>${Math.round(l.vol).toLocaleString()}명/일 통과</td></tr>`).join('') || '<tr><td colspan="2">운행 중인 노선이 없습니다.</td></tr>'}</table>
    <h4>승하차</h4>
    <table class="kv">
      ${riders != null ? `<tr><td>지역 간 승하차</td><td>${Math.round(riders).toLocaleString()}명/일</td></tr>` : ''}
      ${lines.some((l) => l.mode === 2) ? `<tr><td>도시철도 승하차 (추정, 구 안 이용 포함)</td><td>${Math.round(metroStationEst(id)).toLocaleString()}명/일</td></tr>` : ''}
      <tr><td>역세권 인구 (반경 1km · 3km)</td><td>${fmtPop(popWithin(c[0], c[1], 1))} · ${fmtPop(popWithin(c[0], c[1], 3))}</td></tr>
    </table>
    ${riders == null && !lines.some((l) => l.mode === 2) ? '<p class="hint">아직 운행하지 않는 역입니다.</p>' : ''}
    ${lines.some((l) => l.mode === 2) ? '<p class="hint">도시철도 승하차는 역 반경 800m 인구로 어림한 값입니다 (모형의 시군구 사이 통행에 빠진 구 안 이용 포함).</p>' : ''}
    <h4>운행 계통</h4>
    <table class="kv">${lines.filter((l) => l.named).map((l) => { const t = autoLocalTrains(l.name, l.mode === 2 ? 'metro' : l.cls);
      return `<tr><td>${esc(l.name)} ${l.cls === 'hsr' ? '고속' : '보통'} <span class="m">자동 · 24시간</span></td><td>하루 ${t}회 · 약 ${Math.max(1, Math.round(SERVICE_DAY_MIN / Math.max(1, t / 2)))}분 간격</td></tr>`; }).join('')}
      ${stopping.map((s) => svcRow(s, true)).join('')}${passing.map((s) => svcRow(s, false)).join('')}</table>
    ${svcTrains ? `<p class="hint">이 역에 서는 특급·급행 등 계통 열차 하루 ${svcTrains}회</p>` : '<p class="hint">보통 열차는 모든 노선에 저절로 다닙니다. 철도 구간을 눌러 특급·급행 계통을 짤 수 있습니다.</p>'}
    <h4>환승</h4>
    ${lines.filter((l) => l.named).length > 1 ? `<p class="hint">같은 역 환승: ${lines.filter((l) => l.named).map((l) => esc(l.name)).join(', ')}</p>` : ''}
    ${near.length ? `<table class="kv">${near.map((x) => `<tr><td><a href="#" data-st-goto="${x.node}">${esc(x.name)}</a>
      <span class="m">${x.lines.map(esc).join(', ') || '노선 정보 없음'}</span></td><td>도보 ${Math.round(x.d * 1000)}m</td></tr>`).join('')}</table>`
      : lines.filter((l) => l.named).length > 1 ? '' : '<p class="hint">400m 안에 갈아탈 다른 역이 없습니다.</p>'}`;
}

function flyToNode(node) {
  const c = nodeCoord(node);
  if (c) map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 11) });
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

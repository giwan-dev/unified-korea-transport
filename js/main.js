// 게임 진행과 화면 패널.
import { createMap, addLayers, colorFor, legendHTML, METRICS, setLayerView, LAYER_VIEWS, setBasemap } from './ui/map.js';
import { Namer, stem } from './game/naming.js';
import {
  newGame, START_YEAR, REOPEN_SPEED, baseTransfers, startProject, cancelProject, cancelBlocked, save, load, clearSave, effectiveNetwork, linkAt, startUpgrade, startNewBuild, advanceBudgetYear,
  updateCongestion, defaultFix, updateApproval, canAfford, isKP, linksUnderWork, UPGRADES, NEW_BUILDS, upgradeCost,
  placeName, setPlaceName, startRestoreName, RENAME, startAirport, startAirportExpand, renameLine, splitLink,
  fundFor, settlePPP, settleRail, renameKPLines, KP_LINE_RENAME, LINE_RENAME_COST, railDividend, railEquity, mergeRail, OP_FACTORS, initOngoing, linkPending, setProjectPace, PACES,
  initAirRoutes, updateAirRoutes, startOpenRoute, closeRoute, AIR,
  closeLine, reopenLine, setLineFreq, FREQ_STEPS, CLOSE_APPROVAL, REOPEN_PER_KM, startMega, settleMega,
} from './game/state.js';
import { MEGA, TSR_FREIGHT, megaGeometry, applyMega } from './game/mega.js';
import { AIRPORT } from './game/catalog.js';
import { setNameResolver, setLabelGroup, refreshNames, setRegions, setZoneOutline, setLinks, paintHotspots, setHousing } from './ui/map.js';
import { isNarrow, twinPrimary, mergeTwins, ROAD_RANK, motorwayMainline, bridgeMainlineGaps, flattenMainline, connectJunctions, smoothMainlineEnds, mainlineBubbles, roundMainlineCorners } from './ui/traffic.js';
import { subFold, initPanelUI, toast } from './ui/panel.js';
import { initPalette, openPalette, goSection } from './ui/palette.js';
import { startGuide, guideShouldAutoShow, guideOnNewGame, getGuideMode, setGuideMode, GUIDE_MODES } from './ui/guide.js';
import { DIFFICULTY, KP_COST_FACTOR, resolve, formatWon } from './game/catalog.js';
import { kmBetween, routeKey } from './sim/model.js';
import { decodeNetwork } from './data/netpack.js';
import { helperPorts } from './sim/pool.js';
import { smoothSegments, polylineKm, splineLine, tangentCurve, easeCurves } from './game/curve.js';
import { loadTerrain, terrainReady, terrainRoute, terrainProfile, terrainRule, terrainCostFactor, terrainAt } from './game/terrain.js';
import { trackHeadings, branchTangent, unitDir } from './game/branch.js';
import { stationCost, startStationAdd, nearestLocalRoad, icCost, startICAdd } from './game/points.js';
import { appraise, appraisalHTML, regionOf as appraisalRegion, opexFor } from './game/appraisal.js';
import { extendWorld, urbanLanes } from './game/world.js';
import { autoLineName, cityStem, makeForeignTest } from './game/lines.js';
import { saveSim, loadSim, clearSim } from './game/simstore.js';
import { SERVICE_KINDS, TRAIN_TYPES, OPERATING, EXISTING_SERVICES, lineStations, planService, railPath, tripsPerDay, setCost, canRun, defaultTrainType, serviceBuyCost, startService, updateService, removeService, seedServices, openWaitingServices, refreshExistingServices } from './game/services.js';
import { showLineDiagram, stopLineDiagram } from './ui/linediagram.js';
import { trainBrand, autoBrand } from './game/trainnames.js';
import { seedInterKoreaAir, airlinesHTML } from './game/airlines.js';
import { develPlan, startDevel, settleDevels } from './game/devel.js';
import { HOUSING, housingPlan, startHousing, settleHousing } from './game/housing.js';
import { rollEvent } from './game/events.js';
import { newlyUnlocked, unlockedTourKP, unlockAt } from './game/tourism.js';
import { showNotice } from './ui/notice.js';
import { placeIntroHTML } from './game/cities.js';
import { parseRequest, metroPlan, cityCenter } from './game/recommend.js';
import { addTrainsLayer, setTrainsProvider, invalidateTrains, setTrains, trainsLegend } from './ui/trainsmap.js';
import { registerSentimentMetrics, initSubBase, subGains, zoneGains, nationalFactor, updateMayorApproval, pShare, subValue } from './game/sentiment.js';
import { addPlansLayer, showPlanLine } from './ui/plansmap.js';
import { addRailKindLayer, railKindLegend, railStd, syncRailKind } from './ui/railkind.js';
import { P } from './sim/params.js';
import { PPP_TYPES, PPP_DEFAULTS, initPPP, tollKind, linkToll, annualRevenue, evaluatePPP } from './game/ppp.js';
import {
  PARTIES, initLocal, regionOf, hasAutonomy, leanP, runElection, bumpApproval, governorTitle, mayorTitle, countyTitle, metroName, isMetroCity,
  HISTORIC_CITIES, PROMOTE_MIN_POP, ELECTION, EVENT_COST, ADMIN_OPTIONS, ADMIN_DEFAULT, adminNames, HISTORIC_COUNTIES,
} from './game/local.js';
import { openAdminSetup } from './ui/setup.js';
import { flushSave, saveError, slotMeta, saveSlot, loadSlot, keepBackup, loadBackup } from './game/savestore.js';
import { migrateState, rememberNetwork } from './game/migrate.js';
import { LANG, t, startI18n, setLang } from './i18n.js';
startI18n();
{ const ll = document.querySelector('#ld-lang'); if (ll) { ll.textContent = LANG === 'en' ? '한국어' : 'English'; ll.addEventListener('click', (e) => { e.preventDefault(); setLang(LANG === 'en' ? 'ko' : 'en'); }); } }
import { buildReport, reportHTML, downloadReportImage, TIME_PAIRS, GOALS } from './ui/report.js';
import { openGazette } from './ui/gazette.js';

const APP_VERSION = 'Alpha 0.2';
const BUG_MAIL = 'evrgrn0528@gmail.com';
// 오류 제보에 함께 보낼 최근 오류 (화면에 안 보이는 것도)
const errLog = [];
addEventListener('error', (e) => errLog.push(`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => errLog.push(String(e.reason?.message || e.reason)));
import { initRail, operatorOf, opInfo, opBadge, OPERATORS, MERGE_MIN_INTEGRATION, EQUITY_STEP, FOREIGN_OPERATORS, foreignOpBadge } from './game/operators.js';

const $ = (s) => document.querySelector(s);
registerSentimentMetrics(METRICS);   // 득표율·지자체장 지지율·읍면동 행복도·지지율 지도
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


/** 로딩 단계별 시각 (ms, 페이지 시작부터). 콘솔에서 ukt.perf로 본다 */
const perf = [];
const mark = (name) => perf.push([name, Math.round(performance.now())]);
globalThis.__perf = perf;

async function init() {
  mark('init');
  if (location.hash.startsWith('#s=')) await openSharedFromURL();
  // 계산 워커(와 보조 워커)는 먼저 띄워 둔다: 모듈을 받고 읽는 동안 이쪽은 데이터를 받는다
  worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  const ports = new URLSearchParams(location.search).has('serial') ? [] : helperPorts();   // ?serial: 한 워커로만
  // 배경지도(글꼴·시군구 도형·경계선)는 우리 자료와 상관없으니 처음부터 함께 받고 그리기 시작한다
  const mapCreated = createMap('map');
  // 1) 데이터 내려받기 (큰 파일은 진행률을 보인다). 나중에 쓰는 것도 지금 함께 받기 시작한다
  loading.stage('data');
  const dl = new Progress((v) => loading.progress('data', v));
  const sggP = dl.fetch('data/admin/sgg.geojson', 'json');
  const tourismP = fetch('data/tourism.json').then((r) => r.json()).catch(() => null);
  const baselineP = loadBaseline();
  const [z, nmeta, nbin, g, meta, world] = await Promise.all([
    dl.fetch('data/zones.json', 'json'),
    dl.fetch('data/network.meta.json', 'json'),
    dl.fetch('data/network.bin', 'buffer'),
    dl.fetch('data/grid.bin', 'buffer'),
    fetch('data/meta.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    dl.fetch('data/air_sea.json', 'json'),
  ]);
  mark('data fetched');
  zoneProps = z; base = decodeNetwork(nmeta, nbin); grid = new Float32Array(g);
  mark('network decoded');
  // 국외 거점·국경 연결·여객선 항로·공항
  extendWorld(base, zoneProps, world);
  urbanLanes(base, grid);
  // 존 경계는 배경지도와 같은 시군구 도형을 쓴다
  mark('world+lanes');
  zonesFC = await sggP;
  mark('sgg fetched');
  // 지명은 새 역·IC 이름을 지을 때만 필요하므로 첫 화면 뒤에 받는다
  const placesReady = fetch('data/places.json').then((r) => r.json()).then((p) => { places = p; });
  fetch('data/base/world.geojson').then((r) => r.json()).then((w) => { isForeign = makeForeignTest(w); }).catch(() => {});
  fetch('data/closed_lines.json').then((r) => (r.ok ? r.json() : { lines: [] })).then((c) => { closedLines = c.lines || []; if (map) refreshClosed(); }).catch(() => {});
  fetch('data/plans.json').then((r) => (r.ok ? r.json() : { plans: [] })).then((p) => { plans = p.plans || []; migratePlanLines(); if (map) renderBuild(); }).catch(() => {});
  fetch('data/historic_targets.json').then((r) => (r.ok ? r.json() : [])).then((h) => { historic = h; }).catch(() => {});
  rememberNetwork(meta?.stamp, base, zoneProps);
  subPop0 = zoneProps.flatMap((zp) => zp.subs.map((s) => s[2] * zp.pop));
  state = await load();
  // 데이터가 바뀌면(노선망·존 구성 변경) 예전 저장 게임의 번호(노드·링크·시군)를 새 자료에 맞춰 옮긴다.
  // 옮기지 못하면 예전 저장은 따로 남겨 두고(설정 탭에서 파일로 받을 수 있다) 새로 시작한다
  if (state && meta && state.dataStamp && state.dataStamp !== meta.stamp) {
    const old = state;
    const r = await migrateState(old, { base, zones: zoneProps, stamp: meta.stamp });
    if (r.ok) {
      await keepBackup(JSON.stringify(old), old.dataStamp);   // 옮기기가 잘못됐을 때 되돌릴 수 있게 옮긴 경우에도 남긴다
      state = r.state;
      state.backupStamp = old.dataStamp;
      // 운행 계통 경로는 새 망에서 다시 짠다 (못 짜면 그 계통은 없앤다)
      const links = effectiveNetwork(base, state).links;
      const before = (state.services || []).length;
      state.services = (state.services || []).filter((sv) => {
        if (!sv.replan) return true;
        delete sv.replan;
        const plan = sv.stops.length >= 2 && planService(links, railStationSet(), sv.stops, sv.kind, new Set(sv.lines || [sv.line]), sv.type);
        if (!plan) return false;
        sv.segs = plan.segs; sv.runMin = plan.runMin; sv.km = plan.km; sv.trains = tripsPerDay(sv.sets, plan.runMin);
        return true;
      });
      if (state.services.length < before) r.note = [r.note, `새 지도에서 경로를 찾지 못한 운행 계통 ${before - state.services.length}개는 없앴습니다`].filter(Boolean).join(', ');
      state.log.unshift(`지도·노선 자료가 새로 바뀌어 저장 게임을 새 자료에 맞춰 옮겼습니다${r.note ? ` (${r.note})` : ''}.`);
    } else {
      await keepBackup(JSON.stringify(old), old.dataStamp);
      state = newGame(old.difficulty || 'normal');
      state.backupStamp = old.dataStamp;
      state.log.unshift(`지도·노선 자료가 새로 바뀌어 ${old.year}년 저장 게임을 이어 할 수 없어 새로 시작합니다 (${r.reason}). 예전 저장은 설정 탭에서 파일로 받아 둘 수 있습니다.`);
    }
    clearSim();
  }
  state ||= newGame('normal');
  if (meta) state.dataStamp = meta.stamp;
  initAirRoutes(state, world.routes || []);
  seedInterKoreaAir(state);
  initRail(state);
  seedServices(state, base);
  // 예전 저장의 1호선·4호선 기본 계통을 직통 계통으로 (선로 자료가 바뀌었다)
  if (refreshExistingServices(state, effectiveNetwork(base, state), base.stations).length) state.log.unshift(`${state.year}년: 1호선 계통을 서울역–청량리 직통(신창–소요산, 인천–광운대)으로 바꿨습니다`);
  initLocal(state);
  // 예전 저장: 승격한 도시를 '함흥시' 이름 그대로 광역 단체로 썼다 (직함이 '함흥시도지사'로 나왔다) → 함흥광역시로 옮긴다
  for (const c of state.local.independent || []) {
    const m = metroName(c), off = state.local.offices[`g:${c}`];
    if (m === c || !off) continue;
    state.local.offices[`g:${m}`] = { ...off, region: m, title: governorTitle(m) };
    delete state.local.offices[`g:${c}`];
    for (const pr of state.local.proposals || []) if (pr.office === `g:${c}`) pr.office = `g:${m}`;
  }
  initPPP(state);
  if (!Object.keys(state.local.offices).length) holdElection('all', '지방선거 (게임 시작 시점)');
  // 지방자치가 없는 북측 도의 단체장 (예전 저장: 장단·옹진을 북측 도로 옮기면 그 도에 도지사를 뽑던 것)은 지운다
  { const regs = regions(); for (const k of Object.keys(state.local.offices)) if (k.startsWith('g:') && !regs.has(k.slice(2))) delete state.local.offices[k]; }
  syncMayors();   // 시군 단체장은 한 시군에 하나 (예전 저장: 옛 군 땅 조각마다 군수가 있던 것)
  for (const [k, off] of Object.entries(state.local.offices)) if (k.startsWith('g:')) off.title = governorTitle(k.slice(2));   // 직함은 지금 규칙으로
  // OSM 공사 중 노선 → 진행 중 사업 (이름 없는 구간은 가까운 시군 이름으로)
  initOngoing(base, state, (l) => {
    const [x, y] = base.nodes[l.a];
    let best = null, bd = Infinity;
    for (const z of zoneProps) { if (z.ext) continue; const d = (z.cx - x) ** 2 + (z.cy - y) ** 2; if (d < bd) { bd = d; best = z; } }
    return `${best ? best.name : ''} ${CLASS_LABEL[l.cls] || ''} 공사`.trim();
  });
  // 폐선 표시(replaced)는 직접 놓은 선로가 기존 구간을 나눈 때(split)와 직선화·고속화로 걷어 낸 때(retire)뿐이다.
  // 그 어느 쪽도 아닌 표시는 저장을 새 자료로 옮길 때 잘못 붙은 것이다 (신남포 서쪽 평남선이 사라진 것 등): 되살린다
  if (state.replaced) {
    const ok = new Set();
    // 나눈 두 조각의 끝 노드가 그 구간 끝 노드와 맞아야 진짜 나눈 것이다 (옮기다 번호가 엇갈린 것은 빼고)
    for (const nl of state.newLinks) {
      if (nl.split == null) continue;
      const src = nl.split < base.links.length ? base.links[nl.split] : null;
      if (!src || nl.a === src.a || nl.b === src.b || nl.a === src.b || nl.b === src.a) ok.add(nl.split);
    }
    for (const p of state.projects) if (p.status === 'done') for (const id of p.retire || []) ok.add(id);
    for (const k of Object.keys(state.replaced)) if (!ok.has(+k)) delete state.replaced[k];
  }
  // 예전 저장: 직선화 완공 때 폐역으로 고른 역을 닫지 않았다 (지도에 운행 노선 없는 역으로 남았다)
  for (const p of state.projects) {
    if (p.status !== 'done' || !p.dropStations?.length) continue;
    const closed = new Set(state.closedStations ||= []);
    for (const n of p.dropStations) if (!closed.has(n)) state.closedStations.push(n);
  }
  mark('game state');
  assignTourism(await tourismP);
  const bl = await baselineP;
  // 데이터 버전과 보정 방식(params.js calibVersion)이 맞을 때만: 다르면 쓰지 않고 새로 보정한다
  const baseline = bl && meta && bl.json.meta?.stamp === meta.stamp && (bl.json.meta?.calib ?? 1) === P.calibVersion ? bl : null;
  mark('baseline fetched');
  // 저장된 게임의 그해 계산 상태 (같은 해·같은 데이터일 때만)
  const saved = state.snapshot ? await loadSim() : null;
  const savedOk = saved && saved.year === state.year && saved.stamp === meta?.stamp ? saved : null;
  loading.done('data');
  // 읍면동 경계는 지도에만 쓰므로 기다리지 않는다
  const subsReady = fetch('data/subzones.geojson').then((r) => r.json()).then((fc) => { subsFC = fc; });

  // 2) 시뮬레이션: 지도가 뜨는 동안 먼저 시작한다
  loading.stage('sim');
  worker.onmessage = (ev) => {
    if (ev.data.type === 'result') {
      if (!result) { for (const [n, t] of ev.data.perf || []) perf.push([`worker: ${n}`, t]); mark('worker result'); }
      // 계산은 끝났고 지도만 기다리는 중이면 그렇게 보여 준다
      loading.done('sim');
      mapReady.then(() => onWorker(ev));
    } else onWorker(ev);
  };
  // 해마다 도는 통행배정을 나눠 맡을 보조 워커(ports)는 계산 워커와 포트로 바로 이어진다
  worker.postMessage({
    type: 'init', zones: zoneProps, grid: grid.buffer.slice(0), net: effectiveNetwork(base, state),
    ctx: ctx(), snapshot: state.snapshot, baseline, saved: savedOk, ports,
  }, [...(baseline ? [baseline.bin] : []), ...(savedOk ? [savedOk.bin] : []), ...ports]);
  dataStamp = meta?.stamp;
  mark('worker posted');

  // 3) 지도
  loading.stage('map');
  const mapReady = mapCreated.then((m) => {
    window.__map = m;
    map = m;
    mark('map created');
    const lfc = linksFC();
    mark('linksFC');
    addLayers(map, zonesFC, lfc, { type: 'FeatureCollection', features: [] });
    refreshClosed();
    mark('layers added');
    addRailKindLayer(map);
    addPlansLayer(map);
    addTrainsLayer(map);
    setTrainsProvider(trainsData);
    setNameResolver((level, id, original) => placeName(state, level, id, original));
    setLabelGroup((z) => ({ key: countyKey(z), weight: zoneProps[z]?.area || 0 }));
    refreshNames(map);
    subsReady.then(() => map.getSource('subs').setData(subsFC));
    refreshPoints();
    placesReady.then(resetNamer);
    bindMap();
    bindUI();
    renderAll();
    mark('first render');
    loading.done('map');
  });
  await mapReady;
  // 콘솔 디버깅용
  window.ukt = { planStraighten: () => planStraighten(), openPlan, commitDraft, startServicePick, previewDraft, get lastPreview() { return lastPreview; }, namerSuggest: (x, y) => namer.suggest(x, y, 'station'), perf, map, base, worker: () => worker, packState: () => packState(), countyKey: (i) => countyKey(i), countyRep: (i) => countyRep(i), select, selectBox, renderAll, refreshLinks, startDraft, addDraftPoint, cancelDraft, startStraighten, straightenClick, startPointAdd, pointAddClick, openLineDiagram, recommendRoute, probe: () => worker.postMessage({ type: 'probe' }), get gains() { return gains; }, get zoneProps() { return zoneProps; }, get grid() { return grid; }, net: () => effectiveNetwork(base, state), ctx: () => ctx(), get draft() { return draft; }, get straight() { return straight; }, get state() { return state; }, get result() { return result; }, get requests() { return requests; } };
}

let tourSites = [];   // data/tourism.json 관광지 (북측 관광지 해금 판정)

/** 관광지가 놓인 존: 존 중심이 아니라 읍면동(소구역) 중심 중 가장 가까운 곳의 존 */
function zoneOfSite(s) {
  let best = -1, bd = Infinity;
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    for (const [x, y] of z.subs) { const d = (x - s.lon) ** 2 + (y - s.lat) ** 2; if (d < bd) { bd = d; best = i; } }
  });
  return best;
}

/** 관광지를 가장 가까운 존(국외는 같은 이름의 거점)에 하루 방문객으로 붙인다 */
function assignTourism(t) {
  if (!t) return;
  tourSites = t.sites;
  for (const s of t.sites) {
    // 존 중심이 아니라 읍면동(소구역) 중심 중 가장 가까운 곳의 존 (안동 하회마을이 예천군으로 가지 않도록)
    const best = zoneOfSite(s);
    const daily = (s.visitors * 1e6) / 365;
    const z = zoneProps[best];
    if (s.kp) z.tourKP = (z.tourKP || 0) + daily; else z.tour = (z.tour || 0) + daily;
    // 관광지가 있는 읍면동 (관광 통행이 그 읍면동으로 간다)
    let k = 0, bd = Infinity;
    z.subs.forEach(([x, y], n) => { const d = (x - s.lon) ** 2 + (y - s.lat) ** 2; if (d < bd) { bd = d; k = n; } });
    (z[s.kp ? 'tourSubsKP' : 'tourSubs'] ||= []).push([k, daily]);
    (z.sites ||= []).push(s.name);
  }
  for (const [name, v] of Object.entries(t.foreign || {})) {
    const z = zoneProps.find((x) => x.ext && x.name === name);
    if (z) z.tour = (z.tour || 0) + (v * 1e6) / 365;
  }
}

/** 미리 계산한 기준 연도 (두 파일을 함께 받는다. 데이터 버전 확인은 부르는 쪽에서) */
async function loadBaseline() {
  try {
    const [json, bin] = await Promise.all([
      fetch('data/baseline.json').then((r) => (r.ok ? r.json() : null)),
      fetch('data/baseline.bin').then((r) => (r.ok ? r.arrayBuffer() : null)),
    ]);
    return json && bin ? { json, bin } : null;
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
  return { integration: state.integration, policy: state.policy, sez: (state.sez || []).filter((z) => z.done).map((z) => z.zone) };
}

// ------------------------------------------------------------ 경제특구

const SEZ = { cost: 10000, years: 3, max: 5 };
function sezHTML(i) {
  const z = zoneProps[i];
  if (z.ext || z.country !== 'KP') return '';
  const cur = (state.sez || []).find((s) => s.zone === i);
  if (cur) return `<h4>경제특구</h4><p class="hint">${cur.done ? `${cur.year}년 지정 · 소득이 빨리 오르고 일자리를 찾아 사람이 모입니다.` : `조성 중 (${cur.year + SEZ.years}년 지정)`}</p>`;
  const n = (state.sez || []).length;
  return `<h4>경제특구</h4><p class="hint">외국인·남측 기업 투자를 받는 특구로 지정합니다. 소득 수렴이 빨라지고(×1.8, 목표 +15%) 사람이 모여듭니다. 교통이 좋은 곳일수록 효과가 큽니다.</p>
    <button class="small primary" data-sez="${i}" ${n >= SEZ.max ? 'disabled' : ''}>경제특구 지정 · ${formatWon(SEZ.cost)} · ${SEZ.years}년${n >= SEZ.max ? ` (최대 ${SEZ.max}곳)` : ''}</button>`;
}
function startSEZ(i) {
  if (!canAfford(state, SEZ.cost, SEZ.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const id = crypto.randomUUID();
  (state.sez ||= []).push({ id, zone: i, year: state.year, done: false });
  startProject(state, { id, kind: 'sez', links: [], stations: [], cost: SEZ.cost, years: SEZ.years, label: `${zoneName(i)} 경제특구 조성` });
  save(state); renderAll(); select({ type: 'zone', id: i });
}
function settleSEZ(done) {
  const ids = new Set(done.filter((p) => p.kind === 'sez').map((p) => p.id));
  for (const s of state.sez || []) {
    if (!ids.has(s.id) || s.done) continue;
    s.done = true;
    state.integration = Math.min(1, state.integration + 0.01);
    state.log.unshift(`${state.year}년 ${zoneName(s.zone)} 경제특구 지정 (남북 통합도 +1%p)`);
  }
}

function resetNamer() {
  const existing = [
    ...base.stations.map(([name]) => ({ name, kind: 'station' })),
    ...(base.metro_stations || []).map(([name]) => ({ name, kind: 'station' })),
    ...base.junctions.map(([name]) => ({ name, kind: 'IC' })),
    ...Object.values(state.names).map((v) => ({ name: v.name, kind: v.kind })),
  ];
  namer = new Namer(places, existing);
  namer.stationHints = stationNameHints;
}

// ------------------------------------------------------------ 시뮬레이션 결과

function onWorker(ev) {
  const m = ev.data;
  if (m.type === 'progress') {
    setBusy(true, m.label, m.value);
    if (!result) { loading.progress('sim', m.value); loading.label('sim', m.label); }
  }
  else if (m.type === 'error') { setBusy(false); autoYears = 0; errLog.push(`worker: ${m.message}`); console.error(m.message); alert('시뮬레이션 오류\n' + m.message); }
  else if (m.type === 'result') applyResult(m);
  else if (m.type === 'route') { window.__route = m.route; showRoute(m.route); }
  else if (m.type === 'routes') { routeWaits.get(m.id)?.(m.out); routeWaits.delete(m.id); }
  else if (m.type === 'preview') onPreview(m);
  else if (m.type === 'probe') window.__probe = m.v;
  else if (m.type === 'warn') console.warn(m.message);
}

function applyResult(res) {
  if (pendingStep) { for (const [n, t] of res.perf || []) perf.push([`worker: ${n}`, t]); mark('y: result'); }
  loading.done('sim');
  const stepped = result !== null && pendingStep;
  pendingStep = false;
  result = res;
  state.snapshot = res.snapshot;
  invalidateTrains();
  initSubBase(state, res.subs);
  gains = subGains(state, res.subs);

  const { vc } = res.links;
  paintVolumes();
  paintZones();
  paintAir(res.air);
  refreshPoints();   // 역 중요도는 이용객으로 정한다

  requests = updateCongestion(base, state, vc, stepped || !state.history.length);
  const prevHappy = happiness ? avgHappiness() : null;
  happiness = computeHappiness(res);
  if (stepped) {
    if (DIFFICULTY[state.difficulty].autoApprove) autoApprove();
    updateApproval(state, requests, res.summary, prevSummary, roadCongestedKm(vc), [nationalFactor(res.subs, gains)]);
    updateMayorApproval(state, zoneGains(zoneProps, res.subs, gains));
    // 철도 운영사 한 해 결산
    settleRail(state, operatorEconomics());
    settleMega(state);
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
      kpToKr: res.summary.kpToKr, rail: res.totals.rail / res.totals.trips, congestedKm, trips: res.totals.trips,
      air: res.totals.air / res.totals.trips, road: res.totals.road / res.totals.trips, transit: res.totals.transit / res.totals.trips,
      happyKR: avgHappiness().KR, happyKP: avgHappiness().KP, debt: state.debt, approval: state.approval, integration: state.integration,
    });
  }
  // 결산의 비교 기준: 시작한 해의 상징 구간 소요 시간을 한 번 재 둔다
  if (!state.times0 && state.year === (state.history[0]?.year ?? state.year)) routeTimes().then((t) => { state.times0 = t; save(state); });
  if (state.goal === 'sp90') routeTimes().then((t) => { goalTimes = t; renderStatus(); });
  mark('y: applied');
  save(state);
  mark('y: saved');
  if (res.sim) saveSim({ year: state.year, stamp: dataStamp, sizes: res.sim.sizes, totals: res.totals, bin: res.sim.bin });
  setBusy(false);
  // 해 넘김 뒤에는 보이는 탭만 다시 그린다 (모든 탭을 그리면 1~2초). 다른 탭은 열 때 그린다
  if (stepped) renderVisible(); else renderAll();
  mark('y: rendered');
  // 올해의 사건 (이어 넘기는 중에는 첫 번째 대응을 저절로 고르고 기록만 남긴다)
  if (stepped) { const ev = rollEvent({ state, rng, zones: zoneProps, zoneName, bigCities: bigCities() }); if (ev) showEvent(ev); }
  // 통일 10년째: 결산을 한 번 띄운다 (이어 넘기기도 여기서 멈춘다)
  if (stepped && state.year >= START_YEAR + 10 && !state.report10) {
    state.report10 = true; save(state);
    autoYears = 0; updateAutoBtn();
    setTimeout(() => showReport(), 600);
  } else if (stepped && autoYears > 0) {
    autoYears--;
    if (autoYears > 0 && draft) { autoYears = 0; toast('노선을 그리는 중이라 이어 넘기기를 멈췄습니다.'); }
    updateAutoBtn();
    if (autoYears > 0) setTimeout(() => { if (autoYears > 0 && !busy) nextYear(); }, 500);
  }
}

let pendingStep = false;
// 여러 해 이어 넘기기: 남은 해 (0이면 멈춤)
let autoYears = 0;
function runYears(n) {
  if (autoYears) { autoYears = 0; updateAutoBtn(); toast('이어 넘기기를 멈춥니다 (지금 계산 중인 해까지).'); return; }
  if (busy || !result) return;
  autoYears = n;
  updateAutoBtn();
  nextYear();
}
function updateAutoBtn() {
  const b = $('#btn-next5');
  if (!b) return;
  b.textContent = autoYears ? `멈춤 (${autoYears})` : '5년 ▶▶';
  b.classList.toggle('on', !!autoYears);
  b.disabled = !result || (busy && !autoYears);
}
let gains = null;   // 읍면동 체감 교통 개선 (시작 대비 점수)

function nextYear() {
  if (busy || !result) return;
  mark('y: start');
  cancelDraft();
  // 노선도는 지난해 결과로 그렸으므로 닫는다
  stopLineDiagram();
  $('#linediagram').hidden = true;
  const done = advanceBudgetYear(base, state);
  lastDone = done;
  afterStraighten(done);
  if (done.some((p) => p.kind === 'rename')) refreshNames(map);
  mark('y: budget');
  // 노선 다시 그리기(1~2초)는 완공·개통한 사업이 있는 해에만
  if (done.length) { refreshLinks(); refreshPoints(); }
  mark('y: links');
  pendingStep = true;
  setBusy(true, `${state.year}년 계산 중`, 0);
  // 선로가 열리기를 기다리던 계통(서해선 원시–서화성 직통 등)은 그해부터 다닌다
  openWaitingServices(state, effectiveNetwork(base, state), base.stations);
  const opened = done.some((p) => p.kind === 'new');   // 플레이어가 놓은 새 노선 (이어받은 공사는 해마다 열려서 뺀다)
  // 완공된 역세권 개발: 분양 수익과 인구 순유입
  const dev = [...settleDevels(state, done), ...settleHousing(state, done)];
  settleSEZ(done);
  // 남북 통합도가 오르면 북측 관광지가 하나씩 열린다
  for (const s of newlyUnlocked(state, tourSites)) {
    const z = zoneOfSite(s);
    state.log.unshift(`${state.year}년 관광지 해금: ${s.name} (남북 통합도 ${Math.round(unlockAt(s) * 100)}%)`);
    showNotice(`관광지 해금: ${esc(s.name)}`, `남북 통합도가 ${Math.round(unlockAt(s) * 100)}%에 이르러 <b>${esc(s.name)}</b>(${esc(zoneName(z))}) 관광이 열렸습니다.
      남측과 국외에서 관광객이 찾아오기 시작하고, 통합도가 오를수록 늘어납니다 (많을 때 연 ${s.visitors}백만 명).<br><span class="m">가는 철도·도로를 놓으면 관광 통행이 더 늘어납니다.</span>`);
  }
  const tourKP = unlockedTourKP(state, tourSites, zoneOfSite, zoneProps.length);
  worker.postMessage({ type: 'step', net: effectiveNetwork(base, state), ctx: { ...ctx(), dev, tourKP }, opened });
  mark('y: posted');
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
/** 지도에서 한 시군으로 보이는 존끼리 같은 값: 보이는 이름 + 광역 단체 (옛 군 땅을 떼어 낸 계산용 조각은 몸통과 같다) */
function countyKey(i) { const z = zoneProps[i]; return z.ext ? `ext:${i}` : `${zoneName(i)}|${regionOf(state, z)}`; }

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

// linkTwins: 링크마다 화면에 그리는 대표 링크 (같은 두 노드를 잇는 쌍), shownTraffic: 쌍을 합친 화면용 교통량·혼잡도
let linkTwins = null, shownTraffic = null;
let mainlineNext = new Map();   // 본선 조각 → [a 쪽 이웃 본선들, b 쪽 이웃 본선들]
function linksFC() {
  const building = new Set();
  for (const p of state.projects) {
    if (p.status !== 'building') continue;
    if (p.kind === 'new') p.links.forEach((id) => building.add(id));
  }
  const all = allLinks();
  const pending = (i) => building.has(i) || (i < base.links.length && linkPending(base, state, i));
  // 같은 두 노드를 잇는 쌍은 하나만 그린다 (twinPrimary 참고)
  linkTwins = twinPrimary(all.map((l, i) => (state.replaced?.[i] || l.replaced ? null
    : (() => {
      const e = linkAt(base, state, i);
      // 도로는 등급이 달라도 묶는다 (여객선·국경 연결은 따로), 철도는 고속선·일반선을 따로
      const road = e.mode === 0 && e.cls !== 'ferry' && !e.ext;
      return { a: l.a, b: l.b, mode: e.mode, k: `${road ? 'road' : `${e.cls}:${e.ext ? 1 : 0}`}:${pending(i) ? 1 : 0}`, rank: road ? ROAD_RANK[e.cls] ?? 9 : 0 };
    })())));
  // 고속도로는 본선만 고속도로로 그리고, IC 연결로·접속도로는 일반도로(주요 도로 굵기)로, JC 연결로는 그리지 않는다 (JC가 사거리로 보이게)
  const mainEff = all.map((l, i) => (state.replaced?.[i] || l.replaced ? null : linkAt(base, state, i)));
  const mainline = motorwayMainline(mainEff, nodeCoord, (i) => i >= base.links.length);
  bridgeMainlineGaps(mainEff, mainline);   // 끊긴 본선 두 조각 사이의 짧은 일반도로 링크는 본선으로
  const features = all.map((l, i) => {
    const eff = linkAt(base, state, i);
    // 같은 역의 다른 노선 승강장을 잇는 환승 선로는 계산에만 쓰고 그리지 않는다 (서울역·용산역 주변이 지저분해진다)
    // 같은 두 노드를 잇는 쌍(대표만)·JC 연결로도 그리지 않는다
    if (state.replaced?.[i] || l.replaced || eff.name?.endsWith(' 환승') || linkTwins[i] !== i || mainline[i] === 2) {
      const p0 = [l.geom[0], l.geom[1]];   // 길이 0인 선: 그려지지 않는다
      return { type: 'Feature', id: i, properties: { id: i, mode: -1 }, geometry: { type: 'LineString', coordinates: [p0, p0] } };
    }
    const parts = smoothParts(l, i);
    return {
      type: 'Feature', id: i,
      properties: { id: i, mode: eff.mode, cls: eff.mode === 0 && mainline[i] === 1 ? 'motorway' : eff.cls === 'motorway' && eff.mode === 0 ? 'primary' : eff.cls, minor: eff.mode === 0 && eff.cls === 'secondary' && !eff.kp ? 1 : 0, building: pending(i) ? 1 : 0, colour: eff.colour || '', ext: eff.ext ? 1 : 0, narrow: isNarrow(eff) ? 1 : 0, rstd: railStd(eff) },
      geometry: parts.length > 1 ? { type: 'MultiLineString', coordinates: parts } : { type: 'LineString', coordinates: parts[0] },
    };
  });
  // 본선의 삐죽한 꺾임을 편다
  // 같은 이름 본선이 한 노드에서 갈라졌다 다른 한 노드에서 다시 만나는 상·하행 분리 구간은 한 갈래만 그린다
  const effAll = all.map((l, i) => (state.replaced?.[i] || l.replaced ? null : linkAt(base, state, i)));
  const bubbles = mainlineBubbles(effAll, mainline, (i) => effAll[i] && linkTwins[i] === i);
  for (const [h, to] of bubbles) {
    const p0 = [all[h].geom[0], all[h].geom[1]];
    features[h] = { type: 'Feature', id: h, properties: { id: h, mode: -1 }, geometry: { type: 'LineString', coordinates: [p0, p0] } };
  }
  if (bubbles.size) for (let j = 0; j < linkTwins.length; j++) if (bubbles.has(linkTwins[j])) linkTwins[j] = bubbles.get(linkTwins[j]);
  const linkEnds = (i) => ({ a: all[i].a, b: all[i].b, pa: nodeCoord(all[i].a), name: linkAt(base, state, i).name });
  flattenMainline(features, mainline, linkEnds);
  // JC 연결로를 숨긴 자리: 다른 고속도로에 붙어 끝나는 본선 끝을 상대 본선까지 잇는다 (T자·사거리)
  connectJunctions(features, mainline, linkEnds);
  smoothMainlineEnds(features, mainline);
  // 이음매·꺾인 점을 둥글게 (노드–노드 곡선이 짧은 구간에서 꺾이는 곳). 짧은 조각은 양 끝 이음매를 함께 깎으면
  // 한쪽이 먼저 바뀌어 다른 쪽 이음매를 놓치므로 한 번 더 돈다
  for (let t = 0; t < 2; t++) roundMainlineCorners(features, mainline);
  // 본선 조각마다 양 끝 노드에서 이어지는 본선 조각 (교통량 0 토막 메우기용, paintVolumes)
  const mainAt = new Map();
  features.forEach((f) => { if (mainline[f.id] === 1 && f.properties.mode === 0) for (const nd of [all[f.id].a, all[f.id].b]) { if (!mainAt.has(nd)) mainAt.set(nd, []); mainAt.get(nd).push(f.id); } });
  mainlineNext = new Map();
  for (const ids of mainAt.values()) for (const i of ids) { if (!mainlineNext.has(i)) mainlineNext.set(i, []); mainlineNext.get(i).push(ids.filter((j) => j !== i)); }
  return { type: 'FeatureCollection', features };
}

/**
 * 한 구간 안에서 나란히 달리는 조각(왕복 분리 도로의 두 차도, 복선의 두 선로처럼 따로 그려진 선)은 하나만 남긴다.
 * 긴 조각부터 남기고, 점 대부분이 이미 남긴 조각에서 60m 안에 있는 조각은 버린다 (두 줄로 겹쳐 보이지 않게)
 */
function dropParallel(parts) {
  if (parts.length < 2) return parts;
  const lenOf = (p) => p.reduce((s, q, k) => (k ? s + Math.hypot((q[0] - p[k - 1][0]) * 0.8, q[1] - p[k - 1][1]) : 0), 0);
  const sorted = parts.map((p) => [p, lenOf(p)]).sort((x, y) => y[1] - x[1]).map(([p]) => p);
  const kept = [];
  const TOL = 0.0006;   // 약 60m
  const nearKept = (q) => kept.some((p) => {
    for (let k = 0; k + 1 < p.length; k++) {
      const [x1, y1] = p[k], [x2, y2] = p[k + 1];
      const dx = (x2 - x1) * 0.8, dy = y2 - y1, L = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, (((q[0] - x1) * 0.8) * dx + (q[1] - y1) * dy) / L));
      if (Math.hypot((q[0] - x1) * 0.8 - t * dx, q[1] - y1 - t * dy) < TOL) return true;
    }
    return false;
  });
  for (const p of sorted) {
    const step = Math.max(1, Math.floor(p.length / 8));
    let n = 0, near = 0;
    for (let k = 0; k < p.length; k += step) { n++; if (nearKept(p[k])) near++; }
    if (!kept.length || near < n * 0.7) kept.push(p);
  }
  return kept;
}

/** 화면용 도형: 노드와 노드 사이를 모든 점을 지나는 곡선으로 (양 끝은 노드에 그대로).
 *  노드에서는 곧게 이어지는 같은 수단 구간의 점을 앞뒤 제어점으로 써서 구간 사이도 꺾이지 않게 한다.
 *  기본 구간은 한 번만 계산해 둔다 */
const smoothCache = new Map();
let nodeAdj = null;

/** 노드 n에서 링크 i가 곧게 이어지는(120° 넘게 펴진) 같은 수단 링크의, 노드 바로 너머 점 */
function beyondPoint(i, l, n, inward) {
  const link = (k) => (k < base.links.length ? base.links[k] : state.newLinks[k - base.links.length]);
  if (!nodeAdj) {
    nodeAdj = new Map();
    allLinks().forEach((x, k) => {
      if (x.ext) return;
      for (const m of [x.a, x.b]) { if (!nodeAdj.has(m)) nodeAdj.set(m, []); nodeAdj.get(m).push(k); }
    });
  }
  const c = nodeCoord(n);
  if (!c) return null;
  const dir = (q) => [(q[0] - c[0]) * 0.8, q[1] - c[1]];
  const v = dir(inward), vl = Math.hypot(...v);
  if (!vl) return null;
  let best = null, bc = -0.5;
  for (const k of nodeAdj.get(n) || []) {
    if (k === i) continue;
    const x = link(k);   // allLinks()는 배열을 새로 만들어 여기서 부르면 너무 느리다
    if (!x || x.mode !== l.mode || x.cls === 'ferry') continue;
    const q = nextVertex(x.geom, c);
    if (!q) continue;
    const w = dir(q), wl = Math.hypot(...w);
    const cos = wl ? (v[0] * w[0] + v[1] * w[1]) / (vl * wl) : 0;
    if (cos < bc) { bc = cos; best = q; }
  }
  return best;
}

/** 도형에서 점 c에 가까운 끝의 바로 다음 점 (20m 안의 점은 건너뛴다) */
function nextVertex(g, c) {
  if (!g || g.length < 4 || Number.isNaN(g[0])) return null;
  const n = g.length / 2;
  const at = (k) => [g[2 * k], g[2 * k + 1]];
  const d = (q) => kmBetween(q[0], q[1], c[0], c[1]);
  const fromStart = d(at(0)) <= d(at(n - 1));
  for (let s = 1; s < n; s++) {
    const q = at(fromStart ? s : n - 1 - s);
    if (Number.isNaN(q[0])) return null;
    if (d(q) > 0.02) return q;
  }
  return null;
}
function smoothParts(l, i) {
  if (i < base.links.length && smoothCache.has(i)) return smoothCache.get(i);
  const g = l.geom;
  let parts = [[]];
  for (let k = 0; k < g.length; k += 2) {
    if (Number.isNaN(g[k])) parts.push([]);
    else parts[parts.length - 1].push([g[k], g[k + 1]]);
  }
  parts = dropParallel(parts.filter((p) => p.length > 1));
  // 도형 끝을 노드에 잇는다: 계산망 노드는 격자 칸의 교차점 좌표라 OSM 도형 끝과 떨어져 있을 수 있다.
  // 이웃 구간도 같은 노드로 이어지므로 선이 끊겨 보이지 않는다. 조각 사이 빈틈(500m 안)도 짧게 잇는다
  const pts = parts.filter((p) => p.length);
  if (pts.length && l.a != null && l.b != null) {
    const A = nodeCoord(l.a), B = nodeCoord(l.b);
    const d2 = (p, q) => ((p[0] - q[0]) * 0.8) ** 2 + (p[1] - q[1]) ** 2;
    const ends = pts.flatMap((p) => [p[0], p[p.length - 1]]);
    const near = (q) => ends.reduce((best, e) => (d2(e, q) < d2(best, q) ? e : best), ends[0]);
    const link = [];
    // 600m(≈ 0.0054도)보다 먼 끝은 잇지 않는다: 엉뚱한 곳을 가로지르는 선이 생기지 않게
    if (A) { const e = near(A); if (d2(e, A) > 2.5e-7 && d2(e, A) < 2.9e-5) link.push([A, e]); }
    if (B) { const e = near(B); if (d2(e, B) > 2.5e-7 && d2(e, B) < 2.9e-5) link.push([e, B]); }
    if (pts.length > 1) {
      const verts = pts.map((p, k) => p.map((v) => [v, k])).flat();
      pts.forEach((p, k) => {
        for (const e of [p[0], p[p.length - 1]]) {
          if ((A && d2(e, A) < 1e-7) || (B && d2(e, B) < 1e-7)) continue;
          let best = null, bd = Infinity;
          for (const [v, kk] of verts) { if (kk === k) continue; const dd = d2(v, e); if (dd < bd) { bd = dd; best = v; } }
          if (best && bd > 1e-9 && bd < 2.5e-5) link.push([e, best]);
        }
      });
    }
    parts.push(...link);
  }
  // 한 조각으로 이어진 보통 구간: 노드–노드 곡선 (앞뒤 구간과 매끄럽게 이어진다)
  const single = parts.filter((p) => p.length > 1);
  if (single.length === 1 && l.a != null && l.b != null && l.cls !== 'ferry' && !l.ext) {
    const p = single[0];
    const A = nodeCoord(l.a), B = nodeCoord(l.b);
    const startsAtA = A && kmBetween(p[0][0], p[0][1], A[0], A[1]) <= kmBetween(p[p.length - 1][0], p[p.length - 1][1], A[0], A[1]);
    const line = startsAtA ? p : [...p].reverse();
    const before = A && line.length > 1 ? beyondPoint(i, l, l.a, line[1]) : null;
    const after = B && line.length > 1 ? beyondPoint(i, l, l.b, line[line.length - 2]) : null;
    const out = [splineLine(line, before, after).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])];
    if (i < base.links.length) smoothCache.set(i, out);
    return out;
  }
  const out = parts.filter((p) => p.length > 1).map((p) => {
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
  nodeAdj = null;   // 새 구간이 생기면 노드에서 곧게 이어지는 구간이 바뀐다
  setLinks(map, linksFC());
  invalidateTrains();
  if (result) paintVolumes();
}

/** 지도에 교통량·혼잡도를 칠한다. 같은 두 노드를 잇는 쌍(분리 차로·복선)은 대표 링크 하나에 합쳐 칠한다 */
function paintVolumes() {
  const m = shownTraffic = mergeTwins(linkTwins || twinPrimary([]), result.links.vc, result.links.vol);
  // 교통량이 있는 본선 사이에 낀 0 조각: 노선망에서 같은 두 노드를 잇는 옆 일반도로 등으로 교통이 새는 곳(데이터 결함)이라
  // 지도에는 양옆 본선 가운데 작은 값을 보여 준다 (본선이 회색 토막으로 끊겨 보이지 않게)
  for (const [i, sides] of mainlineNext) {
    if (m.vol[i] > 0 || sides.length !== 2) continue;
    const side = sides.map((ids) => ids.filter((j) => m.vol[j] > 0));
    if (side.some((ids) => !ids.length)) continue;
    const pick = side.map((ids) => ids.reduce((b, j) => (m.vol[j] > m.vol[b] ? j : b), ids[0]));
    const k = m.vol[pick[0]] <= m.vol[pick[1]] ? pick[0] : pick[1];
    m.vol[i] = m.vol[k]; m.vc[i] = m.vc[k];
  }
  for (let i = 0; i < m.vc.length; i++) map.setFeatureState({ source: 'links', id: i }, { vc: m.vc[i], vol: m.vol[i] });
  paintHotspots(map, m.vc);
}

function nodeCoord(id) {
  return id < base.nodes.length ? base.nodes[id] : state.newNodes[id - base.nodes.length];
}

/** 노드 id → {name, kind, isNew} (사용자가 바꾼 이름이 우선) */
/** 닿은 철도·도시철도 구간이 모두 폐선된(직선화로 걷어 낸) 역 노드 */
function retiredStationNodes() {
  const live = new Set(), dead = new Set();
  allLinks().forEach((l, i) => {
    if (l.mode !== 1 && l.mode !== 2) return;
    const gone = i < base.links.length ? !!state.replaced?.[i] : !!l.replaced;
    for (const n of [l.a, l.b]) (gone ? dead : live).add(n);
  });
  for (const n of live) dead.delete(n);
  return dead;
}

function nodeNames() {
  const out = new Map();
  const closed = new Set(state.closedStations || []);
  for (const n of retiredStationNodes()) closed.add(n);
  for (const [name, node] of base.stations) if (!out.has(node) && !closed.has(node)) out.set(node, { name, kind: 'station', isNew: 0 });
  for (const [name, node] of base.metro_stations || []) if (!out.has(node) && !closed.has(node)) out.set(node, { name, kind: 'station', isNew: 0, metro: 1 });
  for (const [name, node] of base.junctions) {
    if (out.has(node)) continue;
    out.set(node, { name, kind: /JCT|분기점/.test(name) ? 'JCT' : /휴게소|졸음쉼터|SA$/.test(name) ? 'rest' : 'IC', isNew: 0 });
  }
  for (const f of base.foreignNodes || []) out.set(f.node, { name: f.name, kind: 'city', isNew: 0, country: f.country });
  // 도로 없는 섬의 항구(독도): 어느 축척에서나 보이게 도시처럼 둔다
  for (const [name, node] of base.ports || []) out.set(node, { name, kind: 'city', isNew: 0 });
  // 문을 닫은 역(직선화로 옮기거나 폐역한 옛 역)은 이름을 바꿨어도 지도에 그리지 않는다
  for (const [k, v] of Object.entries(state.names)) if (!(v.kind === 'station' && closed.has(+k))) out.set(+k, { name: v.name, kind: v.kind, isNew: 1 });
  (state.restAreas || []).forEach((r, i) => out.set(`rest${i}`, { name: r.name + (r.built ? '' : ' (공사 중)'), kind: 'rest', isNew: 1, coord: [r.lon, r.lat] }));
  return out;
}

/** 점의 중요도: 0 도시·새 시설, 1 큰 역(고속철도역·이용 많은 역), 2 일반 역·JCT·휴게소, 3 IC·도시철도역 */
function pointRank(node, v, hsrNodes, riders) {
  if (v.kind === 'city' || v.isNew) return 0;
  if (v.kind === 'station') {
    if (v.metro) return 3;
    return hsrNodes.has(node) || (riders.get(node) || 0) >= 8000 ? 1 : 2;
  }
  if (v.kind === 'JCT' || v.kind === 'rest') return 2;
  return 3;
}

function refreshPoints() {
  const features = [];
  const hsrNodes = new Set();
  for (const l of allLinks()) if (l.mode === 1 && l.cls === 'hsr') { hsrNodes.add(l.a); hsrNodes.add(l.b); }
  const riders = stationRiders();
  for (const [node, v] of nodeNames()) {
    const c = v.coord || nodeCoord(node);
    if (!c) continue;
    features.push({ type: 'Feature', properties: { node, ...v, rank: pointRank(node, v, hsrNodes, riders) }, geometry: { type: 'Point', coordinates: c } });
  }
  // 한 역의 노선별 노드(수서: SRT·3호선·수인분당선)는 지도에 점 하나만: 같은 이름이 600m 안이면 가장 중요한(순위가 높은) 점만 남긴다
  features.sort((a, b) => a.properties.rank - b.properties.rank);
  const shown = new Map(), kept = [];
  for (const f of features) {
    const p = f.properties, [x, y] = f.geometry.coordinates;
    const same = p.kind === 'station' ? (shown.get(p.name) || []) : [];
    if (same.some(([u, w]) => kmBetween(u, w, x, y) < 0.6)) continue;
    if (p.kind === 'station') shown.set(p.name, [...same, [x, y]]);
    kept.push(f);
  }
  map.getSource('points').setData({ type: 'FeatureCollection', features: kept });
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
      else if (['subHappy', 'subApproval', 'subGain'].includes(metric)) v = subMetric(metric, i);
      else v = s.transit[i];
      map.setFeatureState({ source: 'subs', id: i }, { color: colorFor(metric, v) });
    }
  }
  const z = result.zones;
  const accRef = median(Array.from(z.access));
  // 한 시군으로 보이는 존들(옛 군 땅 조각 포함)은 한 색으로: 인구는 합, 나머지는 인구 가중 평균
  const grp = new Map();
  for (let i = 0; i < zoneProps.length; i++) { const r = countyRep(i); if (!grp.has(r)) grp.set(r, []); grp.get(r).push(i); }
  const agg = (i, arr) => {
    const zs = grp.get(countyRep(i));
    if (zs.length === 1) return arr[i];
    let s = 0, w = 0;
    for (const j of zs) { const p = Math.max(z.pop[j], 1); s += arr[j] * p; w += p; }
    return s / w;
  };
  const sumOf = (i, f) => grp.get(countyRep(i)).reduce((t, j) => t + f(j), 0);
  for (let i = 0; i < zoneProps.length; i++) {
    let v = null;
    if (metric === 'pop') v = sumOf(i, (j) => z.pop[j]);
    else if (metric === 'popChange') v = sumOf(i, (j) => z.pop[j]) / Math.max(sumOf(i, (j) => zoneProps[j].pop), 1) - 1;
    else if (metric === 'hdi') v = agg(i, z.hdi);
    else if (metric === 'income') v = agg(i, z.income);
    else if (metric === 'access') v = agg(i, z.access) / accRef;
    else if (metric === 'happiness') v = happiness ? agg(i, happiness) : null;
    else if (metric === 'partyMayor') v = partyValue(i, 'mayor');
    else if (metric === 'partyGov') v = partyValue(i, 'gov');
    else if (metric === 'voteMayor') v = pShare(state.local.offices[mayorKey(i)]);
    else if (metric === 'voteGov') v = zoneProps[i].ext ? null : pShare(state.local.offices[`g:${regionOf(state, zoneProps[i])}`]);
    else if (metric === 'mayorApproval') v = state.local.offices[mayorKey(i)]?.approval ?? null;
    map.setFeatureState({ source: 'zones', id: i }, { color: sub ? null : colorFor(metric, v) });
  }
}

/** 읍면동 행복도·지지율·체감 개선 */
function subMetric(metric, i) {
  const [z] = subInfo(i);
  if (zoneProps[z].ext) return null;
  return subValue(metric, { zoneHappy: happiness?.[z], approval: state.approval, mayor: state.local.offices[mayorKey(z)]?.approval, gain: gains?.[i] || 0 });
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
    if (secPick) { sectionClick(e.lngLat); return; }
    if (svcPick) { servicePickClick(e.lngLat); return; }
    if (svcEdit && selection?.type === 'service') { serviceEditClick(e.lngLat); return; }
    if (pointAdd) { pointAddClick(e.lngLat); return; }
    if (housingPick) { housingClick(e); return; }
    if (draft?.type === 'airport') { placeAirport(e.lngLat); return; }
    if (draft) { addDraftPoint(e.lngLat); return; }
    const box = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
    const pl = shownPlan ? map.queryRenderedFeatures(box, { layers: ['plans-line'] })[0] : null;
    if (pl) { openPlan(pl.properties.id); return; }
    const ap = map.queryRenderedFeatures(box, { layers: ['airports'] })[0];
    if (ap) return select({ type: 'airport', id: ap.properties.id });
    const pt = map.queryRenderedFeatures(box, { layers: ['points'] })[0];
    if (pt) return select({ type: 'node', id: pt.properties.node });
    const ln = map.queryRenderedFeatures(box, { layers: ['rails', 'metro', 'roads', 'roads-minor', 'ferries', 'ext-links', 'links-building'] })[0];
    // 지도에 그린 운행 계통을 누르면 그 계통 고치기 (밑 선로는 편집 창의 '이 자리 선로 보기'로)
    const sv = showServices && !e.originalEvent?.shiftKey && map.getLayer('services-line') ? map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['services-line'] })[0] : null;   // 계통 선은 옆으로 비켜 그려 칸을 넓게
    const svc = sv && state.services.find((x) => x.id === sv.properties.id);
    if (svc) { openServiceEditor(svc.line, svc.cls, svc.id); if (svcEdit && ln) svcEdit.underLink = ln.properties.id; renderSelection(); return; }
    const cl = !ln && map.getLayer('closed-line') ? map.queryRenderedFeatures(box, { layers: ['closed-line'] })[0] : null;
    if (cl) return select({ type: 'closed', id: cl.properties.id });
    if (ln && e.originalEvent?.shiftKey) return toggleMulti(ln.properties.id);
    if (ln) { const sec = sectionOf(ln.properties.id); return select({ type: 'link', id: ln.properties.id, section: sec }); }
    if (METRICS[metric]?.sub) {
      const sb = map.queryRenderedFeatures(e.point, { layers: ['subs-fill'] })[0];
      if (sb) return select({ type: 'sub', id: sb.id });
    }
    const zn = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
    if (zn) return select({ type: 'zone', id: zn.id });
    select(null);
  });
  map.on('dblclick', (e) => { if (draft) { e.preventDefault(); } });
  let catchT = 0;
  map.on('mousemove', (e) => { const t = performance.now(); if (t - catchT < 60) return; catchT = t; catchLabel(e); });
  map.on('mouseout', () => catchLabel(null));
  enableBoxSelect();
  for (const l of ['roads', 'roads-minor', 'rails', 'metro', 'points', 'plans-line', 'closed-line']) {
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

/** Shift를 누른 채 구간을 누르면 그 구간(이어진 같은 노선 구간째)을 고른 묶음에 더하거나 뺀다: 여러 곳을 한꺼번에 개량 */
function toggleMulti(id) {
  const sec = sectionOf(id);
  const add = sec?.ids?.length ? sec.ids : [id];
  const cur = selection?.type === 'multi' ? selection.ids
    : selection?.type === 'link' ? (selection.section?.ids || [selection.id]) : [];
  const has = add.every((i) => cur.includes(i));
  const ids = has ? cur.filter((i) => !add.includes(i)) : [...new Set([...cur, ...add])];
  if (selection?.type === 'link') for (const i of cur) map.setFeatureState({ source: 'links', id: i }, { sel: false });
  select(ids.length ? { type: 'multi', ids } : null);
}

/** 화면 좌표 사각형 안의 구간들을 고른다 (QA·키보드 없이도 쓸 수 있게 따로 둔다) */
function selectBox(bbox) {
  const ids = [...new Set(map.queryRenderedFeatures(bbox, { layers: ['roads', 'roads-minor', 'rails', 'metro'] }).map((f) => f.properties.id))];
  if (ids.length) select({ type: 'multi', ids });
}

function select(sel) {
  if (selection?.type === 'multi') for (const i of selection.ids) map.setFeatureState({ source: 'links', id: i }, { sel: false });
  if (sel?.type === 'multi') for (const i of sel.ids) map.setFeatureState({ source: 'links', id: i }, { sel: true });
  if (selection?.type === 'link') for (const i of selection.section?.ids || [selection.id]) map.setFeatureState({ source: 'links', id: i }, { sel: false });
  if (selection?.type === 'zone') for (const j of countyZones(selection.id)) map.setFeatureState({ source: 'zones', id: j }, { sel: false });
  if (selection?.type === 'sub') map.setFeatureState({ source: 'subs', id: selection.id }, { sel: false });
  if (svcEdit && sel?.type !== 'service') { svcEdit = null; map.getSource('draft').setData({ type: 'FeatureCollection', features: [] }); drawServices(); }
  selection = sel;
  if (sel?.type === 'sub') map.setFeatureState({ source: 'subs', id: sel.id }, { sel: true });
  if (sel?.type === 'link') for (const i of sel.section?.ids || [sel.id]) map.setFeatureState({ source: 'links', id: i }, { sel: true });
  setZoneOutline(map, sel?.type === 'zone' ? countyZones(sel.id) : []);
  renderSelection();
}

// ------------------------------------------------------------ 신설 그리기

function startDraft(type) {
  if (!namer) { alert('지명 데이터를 아직 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'); return; }
  warmPreview();
  if (pointAdd) endPointAdd();
  cancelDraft();
  select(null);
  draft = { type, points: [] };
  // 지형 격자는 노선을 처음 그을 때 받는다 (받고 나면 공사비에 터널·교량이 들어가고 '지형 따라 선형 잡기'를 쓸 수 있다)
  loadTerrain().then(() => { if (draft) renderBuild(); });
  map.getCanvas().style.cursor = 'crosshair';
  map.doubleClickZoom.disable();
  // 철도를 그리는 동안은 어디에 사람이 많은지 보이게 읍면동 인구 밀도로 칠한다 (끝나면 원래 보기로)
  if (NEW_BUILDS[type]?.mode >= 1 && metric !== 'subDensity' && metric !== 'density') {
    metricBeforeDraft = metric;
    metric = 'subDensity';
    paintZones(); renderLegend();
    toast('노선을 그리는 동안 읍면동 인구 밀도를 보여 줍니다. 커서 옆 숫자는 역 반경 인구입니다.');
  }
  switchTab('build');
  renderBuild();
}

let metricBeforeDraft = null;
function endDraftView() {
  catchLabel(null);
  if (metricBeforeDraft == null) return;
  metric = metricBeforeDraft;
  metricBeforeDraft = null;
  paintZones(); renderLegend();
}

/** 역 반경(도시철도 1km, 철도 3km) 인구: 1km 격자를 0.05° 칸으로 묶어 둔 색인으로 빨리 센다 */
let popBins = null;
function popNear(lon, lat, km) {
  if (!popBins) {
    popBins = new Map();
    for (let c = 0; c < grid.length; c += 4) {
      const k = `${Math.floor(grid[c] / 0.05)}:${Math.floor(grid[c + 1] / 0.05)}`;
      if (!popBins.has(k)) popBins.set(k, []);
      popBins.get(k).push(c);
    }
  }
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57, r2 = km * km;
  const bx = Math.floor(lon / 0.05), by = Math.floor(lat / 0.05), rx = Math.ceil(km / kx / 0.05), ry = Math.ceil(km / ky / 0.05);
  let sum = 0;
  for (let i = bx - rx; i <= bx + rx; i++) for (let j = by - ry; j <= by + ry; j++) {
    for (const c of popBins.get(`${i}:${j}`) || []) {
      const dx = (grid[c] - lon) * kx, dy = (grid[c + 1] - lat) * ky;
      if (dx * dx + dy * dy <= r2) sum += grid[c + 2];
    }
  }
  return sum;
}
const catchKm = (type) => (NEW_BUILDS[type]?.mode === 2 ? 1 : 3);
function fmtPeople(v) { return v >= 10000 ? `${(v / 10000).toFixed(1)}만 명` : `${Math.round(v).toLocaleString()}명`; }

/** 커서 옆 역 반경 인구 (철도 그리기 중) */
function catchLabel(e) {
  let el = document.querySelector('#catch');
  if (!e || !draft || !(NEW_BUILDS[draft.type]?.mode >= 1)) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('div'); el.id = 'catch'; document.body.appendChild(el); }
  const km = catchKm(draft.type);
  el.textContent = `반경 ${km}km ${fmtPeople(popNear(e.lngLat.lng, e.lngLat.lat, km))}`;
  const r = map.getContainer().getBoundingClientRect();
  el.style.left = `${r.left + e.point.x + 14}px`;
  el.style.top = `${r.top + e.point.y + 14}px`;
  el.hidden = false;
}

function cancelDraft() {
  if (!draft) return;
  for (const p of draft.points) if (p.name && p.reserved) namer.release(p.name, p.kind);
  draft = null;
  map.getCanvas().style.cursor = '';
  map.doubleClickZoom.enable();
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  endDraftView();
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

/** 화면 maxPx 안의 가장 가까운 일반철도·고속철도역 노드 */
function nearestRailStation(lngLat, maxPx) {
  const pt = map.project(lngLat);
  const st = new Set(effectiveNetwork(base, state).stations);
  let best = null, bd = Infinity;
  for (const id of nodesOfMode(1)) {
    if (!st.has(id)) continue;
    const q = map.project(nodeCoord(id));
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d < bd && d <= maxPx) { bd = d; best = id; }
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
function nearestOnLink(lngLat, mode, maxPx, filter = null) {
  const p = map.project(lngLat);
  const layers = mode === 0 ? ['roads', 'roads-minor'] : mode === 1 ? ['rails'] : ['metro'];
  const box = [[p.x - maxPx, p.y - maxPx], [p.x + maxPx, p.y + maxPx]];
  const work = linksUnderWork(state);
  let best = null;
  for (const f of map.queryRenderedFeatures(box, { layers })) {
    const id = f.properties.id;
    if (work.has(id) || draft?.points.some((q) => q.split === id) || (filter && !filter(linkAt(base, state, id)))) continue;
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
  routeShown = null;
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

const ROUTE_MODES = {
  car: { label: '자동차', color: '#e8782c' },
  rail: { label: '철도 (가장 빠른, 고속철 포함)', color: '#2453c9' },
  conv: { label: '일반철도만', color: '#6c3fa0' },
  transit: { label: '대중교통 (버스·도시철도)', color: '#1a9a6c' },
  air: { label: '항공', color: '#b04a9c' },
};
let routeShown = null;   // 지도에 그릴 수단 (null이면 모두)

function showRoute(r) {
  if (!measure) return;
  measure.result = r;
  // 경로 색: 수단마다 (map.js의 기본은 승용차·철도 두 색)
  map.setPaintProperty('route-line', 'line-color', ['match', ['get', 'k'], ...Object.entries(ROUTE_MODES).flatMap(([k, v]) => [k, v.color]), '#2453c9']);
  const rows = Object.keys(ROUTE_MODES).filter((k) => r[k]).sort((a, b) => r[a].min - r[b].min);
  const best = rows[0];
  const st = (i) => esc(nodeNames().get(result.stations.node[i])?.name || '');
  const detail = (k) => {
    const v = r[k];
    if (k === 'car') return `${v.km.toFixed(0)}km · 유류비 등 약 ${Math.round(v.cost / 1000).toLocaleString()}천원`;
    if (k === 'rail' || k === 'conv') return `${st(v.s)}→${st(v.t)} · ${v.km.toFixed(0)}km${v.hsrKm > 1 ? ` (고속선 ${v.hsrKm.toFixed(0)}km)` : ''} · 대기 ${Math.round(v.wait)}분 · 약 ${Math.round(v.cost / 1000)}천원`;
    if (k === 'air') return `${esc(airportName(v.a))}→${esc(airportName(v.b))} · 하루 ${v.freq}편 · 약 ${Math.round(v.cost / 1000)}천원`;
    return `${v.metroKm > 0.5 ? `도시철도 ${v.metroKm.toFixed(0)}km · ` : ''}버스 ${(v.busKm || 0).toFixed(0)}km · 약 ${Math.round(v.cost / 100) * 100}원`;
  };
  $('#selection').innerHTML = `${header('소요 시간 측정')}
    <p class="hint">직선거리 ${r.crowKm.toFixed(0)}km · 올해 혼잡 반영 · 수단을 누르면 그 경로만 지도에 보입니다.</p>
    <table class="kv">${rows.map((k) => `<tr data-route-k="${k}" style="cursor:pointer;${routeShown && routeShown !== k ? 'opacity:.5' : ''}"><td>
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${ROUTE_MODES[k].color};margin-right:4px"></span>${k === best ? '<b>' : ''}${ROUTE_MODES[k].label}${k === best ? '</b>' : ''}<div class="m">${detail(k)}</div></td><td>${fmtMin(r[k].min)}</td></tr>`).join('')
      || '<tr><td>이을 수단이 없습니다</td><td></td></tr>'}</table>
    ${routeShown ? '<button class="small" id="route-all">모든 경로 보기</button>' : ''}
    <p class="hint">다른 두 지점을 누르면 다시 잽니다. 닫기를 누르면 끝납니다.</p>`;
  $('#selection .close').onclick = endMeasure;
  document.querySelectorAll('[data-route-k]').forEach((tr) => { tr.onclick = () => { routeShown = routeShown === tr.dataset.routeK ? null : tr.dataset.routeK; showRoute(r); }; });
  $('#route-all')?.addEventListener('click', () => { routeShown = null; showRoute(r); });
  const feats = [measure.from, measure.to].map((c) => ({ type: 'Feature', properties: { k: 'pt' }, geometry: { type: 'Point', coordinates: c } }));
  for (const k of ['transit', 'conv', 'car', 'rail']) {
    if (!r[k]?.links || (routeShown && routeShown !== k)) continue;
    for (const id of r[k].links) {
      const g = allLinks()[id]?.geom || [], parts = [[]];
      for (let i = 0; i < g.length; i += 2) {
        if (Number.isNaN(g[i])) parts.push([]); else parts[parts.length - 1].push([g[i], g[i + 1]]);
      }
      feats.push({ type: 'Feature', properties: { k }, geometry: { type: 'MultiLineString', coordinates: parts } });
    }
  }
  map.getSource('route').setData({ type: 'FeatureCollection', features: feats });
}

/** 그리는 중인 새 노선 위(18px 안)를 눌렀으면 그 구간 앞뒤 점 사이에 끼울 자리 {index, lon, lat} */
function draftInsertAt(lngLat) {
  if (!draft || draft.points.length < 2) return null;
  const p = map.project(lngLat);
  // 이미 있는 점 가까이(14px)는 끼우지 않는다 (그 점을 누른 것)
  if (draft.points.some((q) => { const a = map.project([q.lon, q.lat]); return Math.hypot(a.x - p.x, a.y - p.y) < 14; })) return null;
  const segs = smoothSegments(draftPoints());
  let best = null;
  segs.forEach((seg, i) => {
    for (let k = 0; k + 1 < seg.length; k++) {
      const a = map.project(seg[k]), b = map.project(seg[k + 1]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
      if (d <= 18 && (!best || d < best.d)) {
        const ll = map.unproject([a.x + t * dx, a.y + t * dy]);
        best = { d, index: i + 1, lon: ll.lng, lat: ll.lat };
      }
    }
  });
  return best;
}

function addDraftPoint(lngLat) {
  const spec = NEW_BUILDS[draft.type];
  // 새 노선 위를 누르면 끝에 잇지 않고 그 자리에 역(도로는 IC)을 끼운다
  const ins = draftInsertAt(lngLat);
  if (ins) {
    const pt = { node: null, lon: ins.lon, lat: ins.lat, split: null, inserted: true };
    draft.points.splice(ins.index, 0, pt);
    nameDraftPoint(pt, ins.index);
    drawDraft();
    renderBuild();
    return;
  }
  // 노드는 화면 24px, 선은 16px 안이면 붙인다 (정확히 누르지 않아도 되게)
  let node = snap.node ? nearestNode(lngLat, spec.mode, 24) : null;
  // 도시철도는 일반철도역에도 붙일 수 있다: 그 역에서 일반철도와 바로 갈아탄다 (환승 연결로 친다)
  if (node == null && snap.node && spec.mode === 2) node = nearestRailStation(lngLat, 24);
  let split = null;
  if (node == null && snap.line) {
    const on = nearestOnLink(lngLat, spec.mode, 16);
    if (on) { split = on.link; lngLat = on.lngLat; }
  }
  // 도로는 끝점이 기존 도로망에 붙어야 하므로 첫 점이 허공이면 20km 안의 가장 가까운 노드로 붙인다
  if (node == null && split == null && spec.mode === 0 && draft.points.length === 0) node = nearestNode(lngLat, 0, null, 20);
  // 철도를 공항 가까이 누르면 공항역을 놓는다 (공항철도: 그 공항까지 철도로 갈 수 있어 공항 수요가 는다)
  let airport = null;
  if (node == null && split == null && spec.mode >= 1) {
    const p = map.project(lngLat);
    airport = effectiveNetwork(base, state).airports.filter((a) => !a.ext).find((a) => { const q = map.project([a.lon, a.lat]); return Math.hypot(q.x - p.x, q.y - p.y) < 22; }) || null;
    if (airport) lngLat = { lng: airport.lon, lat: airport.lat };
  }
  const c = node != null ? nodeCoord(node) : [lngLat.lng, lngLat.lat];
  const pt = { node, lon: c[0], lat: c[1], split };
  draft.points.push(pt);
  nameDraftPoint(pt, draft.points.length - 1);
  if (airport) {
    if (pt.reserved) namer.release(pt.name, 'station');
    pt.name = `${airportName(airport.id)}공항`; pt.kind = 'station'; pt.reserved = false; pt.auto = false;
  }
  drawDraft();
  renderBuild();
}

function nameDraftPoint(pt) {
  const spec = NEW_BUILDS[draft.type];
  if (pt.via) { pt.kind = null; pt.name = null; return; }
  const existing = pt.node != null ? nodeNames().get(pt.node) : null;
  if (spec.mode >= 1) {
    if (existing && existing.kind === 'station') { pt.name = existing.name; pt.kind = 'station'; pt.existing = true; return; }
    pt.kind = 'station';
    pt.name = namer.suggest(pt.lon, pt.lat, 'station');
    pt.reserved = true;
  } else if (pt.node != null || pt.split != null || pt.inserted) {
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

/** 기존 노드에서 노선이 뻗는 방향(경위도 단위 벡터)들: 그 노드에 닿은 같은 수단 링크마다 약 1km 앞 점 쪽 */
function nodeDirs(node, mode) {
  const c = nodeCoord(node), out = [];
  if (!c) return out;
  allLinks().forEach((l, i) => {
    if (l.ext || (l.a !== node && l.b !== node) || linkAt(base, state, i).mode !== mode || / 환승$/.test(l.name || '')) return;
    const g = l.geom || [];
    const pts = [];
    for (let k = 0; k + 1 < g.length; k += 2) if (g[k] === g[k]) pts.push([g[k], g[k + 1]]);
    if (pts.length < 2) return;
    if (kmBetween(c[0], c[1], pts[0][0], pts[0][1]) > kmBetween(c[0], c[1], pts[pts.length - 1][0], pts[pts.length - 1][1])) pts.reverse();
    let q = pts[1];
    for (const p of pts) { q = p; if (kmBetween(c[0], c[1], p[0], p[1]) > 1) break; }
    const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (d > 0) out.push([(q[0] - c[0]) / d, (q[1] - c[1]) / d]);
  });
  return out;
}

/** 양 끝이 기존 노드에 붙으면 접선 방향(tan)을 붙인 점 목록: 끝선이면 그 선을 그대로 잇고,
 *  중간이면 기존 선의 두 방향 중 다음 점 쪽 방향으로 갈라져 나간다 (분기·합류가 접선 방향) */
function withTangents(points, mode) {
  if (points.length < 2) return points;
  const out = points.map((p) => ({ ...p }));
  for (const [i, j] of [[0, 1], [out.length - 1, out.length - 2]]) {
    const p = out[i], q = out[j];
    delete p.tan; delete p.lead;
    if (p.node == null && p.split == null) continue;
    // 노드에 붙었으면 그 노드에서 뻗는 방향, 선로 중간(아직 자르기 전)이면 그 자리의 선로 앞뒤 방향
    const dirs = p.node != null ? nodeDirs(p.node, mode) : splitDirs(p, mode);
    if (!dirs.length) continue;
    const to = [q.lon - p.lon, q.lat - p.lat], tl = Math.hypot(...to) || 1;
    const cands = dirs.length === 1 ? [[-dirs[0][0], -dirs[0][1]]] : dirs.flatMap((d) => [d, [-d[0], -d[1]]]);
    let best = null, bd = -2;
    for (const d of cands) { const dot = (d[0] * to[0] + d[1] * to[1]) / tl; if (dot > bd) { bd = dot; best = d; } }
    // 다음 점과 아주 반대(120° 넘게)일 때만 접선을 놓는다 (그 밖에는 늘 기존 선로 방향으로 나가고 들어온다)
    if (best && bd > -0.5) {
      p.tan = best;
      if (p.node != null && mode >= 1) Object.assign(p, branchClear(p, q, best, mode));
    }
  }
  return out;
}

/** 노드 n에서 dir 쪽으로 뻗은 같은 수단 선로를 따라간 점들 (노드부터, 곧게 이어지는 다음 구간까지 maxKm) */
function trackFrom(n, mode, dir, maxKm = 4) {
  const pts = [nodeCoord(n)];
  let node = n, d = dir, km = 0;
  const seen = new Set();
  while (km < maxKm) {
    const c = nodeCoord(node);
    let pick = null, bc = 0.9;
    linksAt(node).forEach(([l, i]) => {
      if (seen.has(i) || l.ext || linkAt(base, state, i).mode !== mode || / 환승$/.test(l.name || '')) return;
      const g = [];
      for (let k = 0; k + 1 < (l.geom || []).length; k += 2) if (l.geom[k] === l.geom[k]) g.push([l.geom[k], l.geom[k + 1]]);
      if (g.length < 2) return;
      if (kmBetween(c[0], c[1], g[0][0], g[0][1]) > kmBetween(c[0], c[1], g[g.length - 1][0], g[g.length - 1][1])) g.reverse();
      const q = g.find((v) => kmBetween(c[0], c[1], v[0], v[1]) > 0.05) || g[g.length - 1];
      const w = [q[0] - c[0], q[1] - c[1]], wl = Math.hypot(...w) || 1;
      const cos = (w[0] * d[0] + w[1] * d[1]) / wl;
      if (cos > bc) { bc = cos; pick = { i, g, other: l.a === node ? l.b : l.a }; }
    });
    if (!pick) break;
    seen.add(pick.i);
    for (const v of pick.g.slice(1)) {
      const u = pts[pts.length - 1];
      km += kmBetween(u[0], u[1], v[0], v[1]);
      pts.push(v);
      if (km >= maxKm) break;
    }
    const u = pts[pts.length - 2], v = pts[pts.length - 1];
    const vl = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
    d = [(v[0] - u[0]) / vl, (v[1] - u[1]) / vl];
    node = pick.other;
  }
  return pts;
}

/** 노드에 닿은 링크들 [[링크, 번호]] (새로 놓은 링크까지, 링크 수가 바뀌면 다시 만든다) */
let adjCache = null;
function linksAt(n) {
  const count = base.links.length + state.newLinks.length;
  if (!adjCache || adjCache.count !== count) {
    const all = allLinks(), m = new Map();
    all.forEach((l, i) => { for (const x of [l.a, l.b]) { if (!m.has(x)) m.set(x, []); m.get(x).push([l, i]); } });
    adjCache = { count, m };
  }
  return adjCache.m.get(n) || [];
}

/** 선 ab와 cd가 서로 가로지르는가 */
function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * 접선 방향으로 나가도 기존 선로를 평면으로 가로지르면(다음 점이 선로 반대편이면 곧 굽어 넘어간다),
 * 그 선로를 따라 나란히 가다가 가로지르지 않고 빠질 수 있는 자리(200m씩, 최대 3km)에서 갈라진다.
 * @returns {{tan:number[], lead?:number[][]}} 갈라지는 자리의 접선과, 노드에서 그 자리까지 선로를 따른 점들
 */
function branchClear(p, q, tan, mode) {
  const tracks = nodeDirs(p.node, mode).map((d) => trackFrom(p.node, mode, d, 4));
  const along = trackFrom(p.node, mode, tan, 3);
  const crosses = (lead, t) => {
    const curve = tangentCurve([p.lon, p.lat], [q.lon, q.lat], t, null, { lead1: lead, n: 30 });
    const from = Math.max(0, (lead?.length || 1) - 1) + 2;
    for (let k = from; k + 1 < curve.length; k++) {
      for (const tr of tracks) for (let m = 0; m + 1 < tr.length; m++) if (segCross(curve[k], curve[k + 1], tr[m], tr[m + 1])) return true;
    }
    return false;
  };
  if (!crosses(null, tan)) return { tan };
  const total = kmBetween(p.lon, p.lat, q.lon, q.lat);
  // 선로를 200m 간격으로 따라가며 갈라질 자리를 찾는다
  const lead = [along[0]];
  let s = 0;
  for (let m = 1; m < along.length; m++) {
    const u = along[m - 1], v = along[m];
    const seg = kmBetween(u[0], u[1], v[0], v[1]);
    const steps = Math.max(1, Math.ceil(seg / 0.2));
    const l = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
    const t = [(v[0] - u[0]) / l, (v[1] - u[1]) / l];
    for (let k = 1; k <= steps; k++) {
      const w = [u[0] + (v[0] - u[0]) * (k / steps), u[1] + (v[1] - u[1]) * (k / steps)];
      s += seg / steps;
      lead.push(w);
      if (s > Math.min(3, total * 0.5)) return { tan };
      if (!crosses(lead, t)) return { tan: t, lead: lead.slice() };
    }
  }
  return { tan };
}

/** 선로 중간 한 점에서 선로가 뻗는 두 방향 (경위도 단위 벡터) */
function splitDirs(p, mode) {
  const links = allLinks().map((_, i) => (state.replaced?.[i] ? null : linkAt(base, state, i)));
  const ck = Math.cos((p.lat * Math.PI) / 180);
  return trackHeadings(links, nodeCoord, p, (l) => l.mode === mode && !l.ext && !l.replaced).map(([e, n]) => {
    const v = [e / ck, n], d = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / d, v[1] / d];
  });
}

function draftPoints() {
  return withTangents(draft.points, NEW_BUILDS[draft.type].mode);
}

function drawDraft() {
  // 선형 점(via)은 노선 모양만 잡고 역·IC가 아니므로 그리지 않는다
  const f = draft.points.filter((p) => !p.via).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
  if (draft.points.length > 1) {
    const line = smoothSegments(draftPoints()).flatMap((seg, i) => (i ? seg.slice(1) : seg));
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
  }
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
}

/** 찍은 역·IC(선형 점이 아닌 점) 사이마다 경사·물을 피하는 선형을 잡아 그 사이 선형 점을 바꾼다 */
function terrainAlign() {
  const rule = terrainRule(draft.type);
  if (!rule || !terrainReady()) return;
  const anchors = draft.points.filter((p) => !p.via);
  // 출발·도착이 기존 선로에 붙어 있으면 그 선로의 접선 방향으로 나가고 들어오게:
  // 끝에서 접선 방향으로 1~4km 나간 '이끎 점'을 선형 점으로 두고, 지형 경로는 이끎 점 사이에서 찾는다
  const tans = withTangents(anchors, NEW_BUILDS[draft.type].mode);
  const first = anchors[0], last = anchors[anchors.length - 1];
  const lead = (p, tan, other) => {
    if (!tan) return null;
    const d = kmBetween(p.lon, p.lat, other.lon, other.lat);
    if (d < 1.5) return null;
    const ck = Math.cos((p.lat * Math.PI) / 180);
    const e = tan[0] * ck, nn = tan[1], m = Math.hypot(e, nn) || 1;   // 경위도 방향 → 실제 거리 L(도)만큼
    // 접선이 상대 끝 쪽과 어긋날수록 곧게 나가는 거리를 줄인다 (75° 넘게 어긋나면 두지 않는다: 크게 돌아 S자가 생긴다)
    const ox = (other.lon - p.lon) * ck, oy = other.lat - p.lat, ol = Math.hypot(ox, oy) || 1;
    const cos = (e * ox + nn * oy) / (m * ol);
    if (cos < 0.26) return null;
    const L = Math.min(4, Math.max(0.5, d * 0.25)) * cos * cos / 111;
    const q = { node: null, lon: p.lon + (e / m) * L / ck, lat: p.lat + (nn / m) * L, split: null, via: true, leadPt: true };
    // 이끎 점이 바다·호수 위면 두지 않는다 (항구역에서 접선이 바다를 향하면 그리로 나갔다가 되돌아 고리가 생긴다)
    const t = terrainAt(q.lon, q.lat);
    if (t && (t.sea || t.water)) return null;
    return q;
  };
  const out = [];
  let changed = 0;
  anchors.forEach((p, k) => {
    out.push(p);
    const q = anchors[k + 1];
    if (!q) return;
    const lo = p === first ? lead(p, tans[0].tan, q) : null;
    const li = q === last ? lead(q, tans[tans.length - 1].tan, p) : null;
    const a = lo || p, b = li || q;
    const via = terrainRoute([a.lon, a.lat], [b.lon, b.lat], rule);
    if (!via) {
      // 경로를 못 찾으면(너무 가깝거나 지형 밖) 원래 선형 점을 그대로 둔다
      const i0 = draft.points.indexOf(p), i1 = draft.points.indexOf(q);
      out.push(...draft.points.slice(i0 + 1, i1));
      return;
    }
    changed++;
    if (lo) out.push(lo);
    for (const [lon, lat] of via) out.push({ node: null, lon, lat, split: null, via: true });
    if (li) out.push(li);
  });
  // 지형 경로는 칸을 따라 꺾이므로, 수단별 최소 곡선반경을 지키게 선형 점을 편다 (역·IC·접선 이끎 점은 그대로)
  const dry = (lon, lat) => { const t = terrainAt(lon, lat); return !(t && t.sea); };
  const kinds = out.map((p) => (!p.via ? 2 : p.leadPt ? 1 : 0));
  draft.points = changed ? easeCurves(out, kinds, rule.minRadiusKm * 1.1, ({ lon, lat }) => ({ node: null, lon, lat, split: null, via: true }), dry) : out;
  drawDraft();
  renderBuild();
  if (!changed) alert('지형을 따를 구간이 없습니다 (점 사이가 3km보다 가깝거나 지형 자료 범위 밖).');
}

function draftCost() {
  const spec = NEW_BUILDS[draft.type];
  let km = 0, cost = 0, foreignKm = 0;
  const segs = smoothSegments(draftPoints());
  const segFactor = [];
  const rule = terrainReady() ? terrainRule(draft.type) : null;
  const terrain = { km: 0, tunnelKm: 0, bridgeKm: 0, seaKm: 0 };
  for (let i = 0; i + 1 < draft.points.length; i++) {
    const a = draft.points[i], b = draft.points[i + 1];
    const len = polylineKm(segs[i]) * 1.02;
    const kp = isKP(a.lat, a.lon) && isKP(b.lat, b.lon);
    const frac = segs[i].filter(([x, y]) => isForeign(x, y)).length / segs[i].length;
    // 지형: 터널·깎기·교량 구간 비율만큼 단가가 바뀐다 (지형 격자를 받기 전이나 땅 밑 노선은 그대로)
    const prof = rule ? terrainProfile(segs[i], rule) : null;
    if (prof) for (const k of Object.keys(terrain)) terrain[k] += prof[k];
    segFactor.push((1 - 0.5 * frac) * (prof ? terrainCostFactor(prof) : 1));
    foreignKm += len * frac;
    km += len; cost += spec.perKm * len * (kp ? KP_COST_FACTOR : 1) * segFactor[i];
  }
  const mids = draft.points.filter((p) => p.split != null).length;
  const rests = restPositions(segs).length;
  const extraCost = mids * (spec.mode === 0 ? MID_COST.road : MID_COST.rail) + rests * REST.cost;
  return { km, cost: Math.round(cost) + extraCost, extraCost, mids, rests, years: spec.years, segFactor, foreignKm, terrain: rule ? terrain : null };
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

/** 그리기 점 가운데 새 역·IC가 될 점의 이름 (착공과 미리보기가 같은 역으로 계산하게) */
function draftNames() {
  const names = {};
  draft.points.forEach((p, i) => { if (p.name && !p.existing) names[i] = { name: p.name, kind: p.kind, auto: p.auto !== false }; });
  return names;
}

async function commitDraft() {
  if (!draft || draft.points.length < 2) return;
  if (terrainRule(draft.type) && !terrainReady()) { await loadTerrain(); if (!draft) return; }   // 착공 사업비도 지형을 넣어서
  const spec = NEW_BUILDS[draft.type];
  const last = draft.points[draft.points.length - 1];
  if (spec.mode === 0 && !attachRoadEnd(last)) { alert('끝점 5km 안에 이을 도로가 없습니다. 마지막 점을 도로 가까이에 찍어 주세요.'); return; }
  const names = draftNames();
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
  const restAreas = restPositions(smoothSegments(draftPoints())).map(([lon, lat]) => ({ lon, lat, name: namer.suggest(lon, lat, 'rest') }));
  const r = startNewBuild(base, state, { type: draft.type, points: draftPoints(), names, lineName, extendOf: draft.extendOf, plan: draft.plan, title: draft.planTitle,
    ppp: pp ? { type: pp.type, subsidy: pp.subsidy, toll: pp.toll } : null, segFactor: dc.segFactor, extraCost: dc.extraCost, restAreas });
  if (split) refreshLinks();
  if (!r.ok) { alert(r.reason); return; }
  if (pp) {
    const proj = state.projects[state.projects.length - 1];
    proj.label = `[민자 ${pp.type.toUpperCase()}] ${proj.label}`;
    addContract(proj, pp, lineName || NEW_BUILDS[draft.type].label);
  }
  draft.points.forEach((p) => { p.reserved = false; });
  const builtProj = state.projects[state.projects.length - 1];
  // 고속화·현대화 계획: 완공되면 같은 구간의 옛 선로를 폐선하고 옛 역은 가까운 새 역으로 넘긴다 (직선화와 같다)
  const retirePlan = draft.plan && plans.find((x) => x.id === draft.plan)?.retireLine;
  if (retirePlan) planRetire(builtProj, retirePlan);
  draft = null;
  endDraftView();
  map.getCanvas().style.cursor = '';
  map.doubleClickZoom.enable();
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  addFeatureStatesAfterRebuild();
  refreshPoints();
  save(state);
  renderAll();
  refreshClosed();   // 복원 계획을 벌이면 같은 노선의 폐선 표시도 지운다
  switchTab('projects');
  showGazette(builtProj, { fromBuild: true });
}

function addFeatureStatesAfterRebuild() { refreshLinks(); }

// ------------------------------------------------------------ 화면

function bindUI() {
  $('#btn-next').onclick = nextYear;
  $('#btn-next5').onclick = () => runYears(5);
  // 건설 탭 사업 비교: 안 빼기
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmp-del]');
    if (!b) return;
    if (b.dataset.cmpDel === 'all') state.compare = []; else state.compare.splice(+b.dataset.cmpDel, 1);
    save(state); renderBuild();
  });
  // 현황 탭의 결산 단추 (탭을 다시 그려도 한 번만 묶이게 문서에 건다)
  document.addEventListener('click', (e) => { if (e.target.closest('#btn-report')) showReport(); });
  $('#btn-measure').onclick = () => (measure ? endMeasure() : startMeasure());
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
  watchFolds();
  initPanelUI($('#side'));
  initPalette(paletteCommands);
  $('#btn-find').onclick = () => openPalette();
  $('#btn-help').onclick = showGuide;
  // 상단 바 숫자를 누르면 관련 탭으로 (예산·부채 → 사업, 지지율·통합도 → 현황)
  document.querySelectorAll('#topbar [data-go]').forEach((d) => {
    const go = () => switchTab(d.dataset.go);
    d.onclick = go;
    d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  if (basemap !== 'plain') setBasemap(map, basemap);
  // 통일 첫해: 행정구역 정리 창을 먼저 띄우고, 정하면 사용법 안내로 이어진다
  if (needsAdminSetup()) setTimeout(() => adminSetup(true), 400);
  else if (guideShouldAutoShow()) setTimeout(showGuide, 600);
  $('#legend').addEventListener('click', (e) => {
    if (!e.target.closest('.lg-toggle')) return;
    $('#legend').classList.toggle('open');
    e.target.textContent = $('#legend').classList.contains('open') ? '범례 접기' : '범례 더 보기';
  });
  $('#legend').addEventListener('change', (e) => {
    if (e.target.id === 'metric') { metric = e.target.value; paintZones(); renderLegend(); }
    if (e.target.id === 'basemap') {
      basemap = e.target.value; setBasemap(map, basemap);
      try { localStorage.setItem('ukt-basemap', basemap); } catch { /* 저장 못 해도 된다 */ }
    }
    if (e.target.id === 'layerview') { layerView = e.target.value; setLayerView(map, layerView); syncRailKind(map); renderLegend(); }
    if (e.target.id === 'svc-lines-toggle') {
      showServices = e.target.checked;
      try { localStorage.setItem('ukt-svc-lines', showServices ? '1' : '0'); } catch { /* 저장 못 해도 이번에는 적용 */ }
      drawServices();
    }
    if (e.target.id === 'trains-toggle') {
      if (e.target.checked && !confirm('지도에 열차 위치를 그리면 컴퓨터 부하가 커집니다 (화면에 보이는 열차를 1초에 5번 다시 그립니다). 느려지면 다시 끄세요. 켤까요?')) { e.target.checked = false; return; }
      setTrains(map, e.target.checked);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!draft || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { cancelDraft(); endHousingPick(); }
    if (e.key === 'Enter') commitDraft();
    if (e.key === 'Backspace') removeLastPoint();
  });
}

/** 메뉴 찾기(Ctrl+K)에 넣는 동작. 탭·접는 묶음 제목은 palette.js가 화면에서 따로 모은다 */
function paletteCommands() {
  const cmds = [];
  const add = (group, title, run, extra = {}) => cmds.push({ group, title, run, ...extra });
  add('진행', '다음 해로 넘기기', () => $('#btn-next').click(), { hint: `${state.year}년 → ${state.year + 1}년`, keywords: '턴 진행 연도', order: 0 });
  add('진행', '소요 시간 재기', () => $('#btn-measure').click(), { keywords: '측정 이동 시간 경로', order: 1 });
  for (const [k, v] of Object.entries(NEW_BUILDS)) {
    add('건설', `새로 놓기: ${v.label}`, () => { switchTab('build'); startDraft(k); }, { hint: `${formatWon(v.perKm)}/km`, keywords: '신설 그리기 노선', order: 2 });
  }
  add('건설', `새로 놓기: ${AIRPORT.build.label}`, () => { switchTab('build'); startDraft('airport'); }, { keywords: '공항 신설', order: 2 });
  add('개량', '구간 개량하기', () => toast('지도에서 도로·철도 구간을 누르면 개량 메뉴가 열립니다. Shift를 누른 채 끌면 여러 구간을 한꺼번에 고릅니다.'), { keywords: '확장 복선화 전철화 차로', order: 3 });
  add('개량', '확장 요구 (혼잡 민원) 보기', () => switchTab('requests'), { keywords: '민원 정체 요구', order: 3 });
  add('운행', '역 골라 특급·급행 짜기', () => { switchTab('build'); startServicePick(); }, { keywords: '운행 계통 열차 노선 운행', order: 3 });
  add('예산', '예산·사업 투입 속도', () => switchTab('projects'), { hint: `가용 ${formatWon(state.budget)}`, keywords: '돈 부채 공사 진행', order: 3 });
  add('도움말', '처음 안내 다시 보기', showGuide, { keywords: '튜토리얼 도움말 사용법', order: 9 });
  add('도움말', '오류 제보·의견 보내기', reportBug, { hint: BUG_MAIL, keywords: '버그 오류 신고 제보 문의 메일 error report', order: 9 });
  add('진행', '5년 이어 넘기기', () => runYears(5), { keywords: '여러 해 자동 진행 빨리', order: 0 });
  add('현황', '결산 보기·이미지로 저장', showReport, { keywords: '성적 점수 결과 공유 이미지 캡처', order: 1 });
  // 묶음 안 깊숙한 항목으로 바로 가기 (정책·이벤트는 민원·정책 탭, 운영 성격은 운영 탭)
  const deep = [
    ['정책', '광역시 독립·승격', 'requests', '지방자치', '광역시', '광역시 승격 독립 시 도'],
    ['정책', '북측 지방자치 도입', 'requests', '지방자치', '북측 지방자치', '선거 자치'],
    ['정책', '북측 행정구역 1945년 이전으로 복원', 'requests', '지방자치', '1945', '강원북도 복원 행정구역 개편'],
    ['정책', '남북 행정구역 정리', 'requests', '지방자치', '행정구역 정리', '행정구역 개편 통합 정리'],
    ['정책', '북측 노선 이름을 남측 기준으로', 'requests', '지방자치', '노선 이름', '노선명 이름 바꾸기'],
    ['정책', '이주 정책 (북→남)', 'requests', '이주 정책', null, '이주 남하 통제'],
    ['정책', '국가 대형 사업', 'requests', '국가 대형 사업', null, '한일해저터널 시베리아 메가'],
    ['정책', '옛 이름 되찾기', 'requests', '옛 이름', null, '지명 이름 복원'],
    ['민원', '지자체 SOC 제안', 'requests', '지자체 SOC', null, '제안 단체장 받아들이기'],
    ['운영', '노선 폐선·감편 (영업계수)', 'ops', '영업계수', null, '폐선 감편 적자 수지 재개통'],
    ['운영', '철도 회사 재원·배당·합병', 'ops', '철도 운영사', null, '코레일 운영사 합병 증자 배당'],
    ['운영', '운행 계통 (특급·급행)', 'ops', '철도 운행 계통', null, '열차 계통 특급 급행'],
    ['운영', '항공 노선 자동 운영', 'ops', '항공', null, '취항 증편 단항 비행기'],
    ['설정', '저장 슬롯 (저장·불러오기)', 'settings', '저장 슬롯', null, '세이브 로드 되돌리기'],
    ['설정', '새 게임·난이도', 'settings', '새 게임', null, '처음부터 다시 난이도'],
  ];
  for (const [g, title, tab, sec, find, kw] of deep) add(g, title, () => goSection(tab, sec, find), { keywords: kw, order: 4 });
  for (const m of MEGA) add('국가 대형 사업', m.name, () => goSection('requests', '국가 대형 사업', m.name), { keywords: '대형 사업 메가', order: 4 });
  for (const [k, v] of Object.entries(LAYER_VIEWS)) {
    add('보기', `지도 보기: ${v}`, () => { const sel = $('#layerview'); sel.value = k; sel.dispatchEvent(new Event('change', { bubbles: true })); }, { keywords: '레이어 표시', order: 6 });
  }
  for (const [k, v] of Object.entries(METRICS)) {
    add('보기', `지도 색칠: ${v.label}`, () => { const sel = $('#metric'); sel.value = k; sel.dispatchEvent(new Event('change', { bubbles: true })); }, { keywords: '지표 색 범례', order: 6 });
  }
  for (const p of plans) {
    add('계획 사업', p.name, () => { switchTab('build'); openPlan(p.id); }, { hint: p.group, keywords: `${p.group} 계획`, order: 5 });
  }
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    add('지역', zoneName(i), () => { map.flyTo({ center: [z.cx, z.cy], zoom: 9.5 }); select({ type: 'zone', id: i }); }, { hint: z.province, keywords: `${z.province} 시군구`, order: 7 });
  });
  // 철도·도시철도 노선 이름
  const lines = new Map();
  allLinks().forEach((_, i) => {
    const e = linkAt(base, state, i);
    if (e.mode >= 1 && e.name && !e.ext && !e.name.endsWith(' 환승')) { if (!lines.has(e.name)) lines.set(e.name, []); lines.get(e.name).push(i); }
  });
  for (const [name, ids] of lines) add('노선', name, () => gotoLinks(ids.slice(0, 400)), { keywords: '철도 노선 운행', order: 8 });
  return cmds;
}

function showGuide() {
  switchTab('status');
  const tab = (t) => () => switchTab(t);
  const phone = matchMedia('(max-width: 760px)').matches;   // 휴대폰: 패널이 지도 아래, Shift 끌기·Ctrl+K 없음
  const end = () => { switchTab('status'); const sel = $('#guide-mode'); if (sel) sel.value = getGuideMode(); };
  if (LANG === 'en') {
    startGuide([
      { target: '#map', title: 'Map', body: `Roads, railways and population of the whole peninsula. Road colour shows congestion (green → red); red triangles mark bottlenecks. Click a section to open upgrade options ${phone ? 'below' : 'on the right'}, or a station for its services and line diagram.${phone ? '' : ' <b>Shift-drag</b> to select many sections at once.'}` },
      { target: '#topbar .stats', title: 'Budget and approval', body: 'An infrastructure budget arrives every year and construction is paid over several years. Unspent money carries over for one year only. Approval rises and falls with congestion, unresolved requests, completed projects and debt; as North–South integration grows, more of the North opens up.' },
      { target: '#legend', title: 'Map view', body: 'Filter to roads, rail or air, or colour the map by population, income, happiness and more.' },
      { target: '[data-panel=build]', before: tab('build'), title: 'Build: new lines', body: 'Pick a type (motorway, high-speed rail, metro…) and click points on the map to draw it. Lines follow the terrain and you see the cost and benefit–cost ratio right away. Use <b>Preview effect</b>, then <b>Start construction</b>. Planned projects such as GTX lines or the Seoul–Pyongyang HSR can be opened from the list below.' },
      { target: '[data-panel=projects]', before: tab('projects'), title: 'Projects: money and works', body: 'Ongoing works and what they cost each year. You can speed projects up or slow them down. About 100 real projects under construction are already in progress.' },
      { target: '[data-panel=ops]', before: tab('ops'), title: 'Operations: trains and flights', body: 'Plan express services, check rail operators and route economics, and open domestic or international air routes.' },
      { target: '[data-panel=requests]', before: tab('requests'), title: 'Policy', body: 'Congestion complaints and local proposals pile up here; ignoring them costs approval. Migration policy, northern local autonomy and the administrative boundaries chosen in the first year are here too.' },
      { target: '#btn-find', before: tab('status'), title: 'Find menu', body: `Lost? ${phone ? 'Tap ⌕' : 'Press <b>Ctrl+K</b> (or /)'} and type part of a name to jump to tabs, regions, lines or planned projects.` },
      { target: '#btn-next', title: 'Next year', body: 'When your projects are set, advance the year: trips, congestion and migration are recalculated (10–20 s). <b>5 years ▶▶</b> runs five years in a row and stops when you start drawing. Reopen this tutorial with the <b>?</b> button.' },
    ], end);
    return;
  }
  startGuide([
    { target: '#map', title: '지도', body: `남북 전체의 도로·철도와 인구입니다. 도로 색은 혼잡도(초록 → 빨강)이고, 빨간 세모는 정체가 심한 곳입니다. 구간을 누르면 ${phone ? '아래 패널' : '오른쪽'}에 개량 메뉴가, 역을 누르면 운행 계통과 노선도가 열립니다.${phone ? '' : ' <b>Shift를 누른 채 끌면</b> 여러 구간을 한꺼번에 고릅니다.'}` },
    { target: '#topbar .stats', title: '예산과 지지율', body: '해마다 SOC 예산이 들어오고, 공사비는 몇 해에 나눠 나갑니다. 쓰지 않은 예산은 한 해 치까지만 남습니다. 지지율은 정체·민원·완공 사업·부채로 오르내리고, 남북 통합도가 오르면 북측 관광지와 교류가 열립니다.' },
    { target: '#legend', title: '보기 메뉴', body: '도로만·철도만·항공만 걸러 보거나, 인구·소득·행복도 같은 지표로 지도를 색칠합니다.' },
    { target: '[data-panel=build]', before: tab('build'), title: '건설: 새 노선 놓기', body: '종류(고속도로·고속철도·도시철도 등)를 고르고 지도에 점을 차례로 찍으면 노선이 그려집니다. 산·강은 지형을 따라 돌아가고, 공사비와 B/C가 바로 나옵니다. <b>효과 미리보기</b>로 통행 변화를 본 뒤 <b>착공</b>하세요. 아래 목록의 GTX·서부선·서울–평양 고속철도 같은 계획 사업은 눌러서 바로 열 수 있습니다.' },
    { target: '[data-panel=projects]', before: tab('projects'), title: '사업: 공사와 돈', body: '진행 중인 공사와 해마다 들어갈 돈입니다. 사업마다 투입 속도를 빠르게·느리게 바꿀 수 있습니다. 처음부터 진행 중인 사업 100여 건(실제 공사 중인 노선)이 들어 있습니다.' },
    { target: '[data-panel=ops]', before: tab('ops'), title: '운영: 열차와 항공', body: '역을 골라 특급·급행 계통을 짜고, 코레일·북측 철도 회사의 수지와 노선별 영업계수를 봅니다. 국제선·국내선 항공 노선도 여기서 엽니다.' },
    { target: '[data-panel=requests]', before: tab('requests'), title: '민원·정책', body: '혼잡 구간 확장 요구와 지자체 제안이 쌓입니다. 오래 두면 지지율이 떨어집니다. 이주 정책, 북측 지방자치, 통일 첫해에 정한 행정구역도 여기 있습니다.' },
    { target: '#btn-find', before: tab('status'), title: '메뉴 찾기', body: `어디 있는지 모르겠으면 ${phone ? '⌕ 단추를 누르고' : '<b>Ctrl+K</b>(또는 /)를 누르고'} 이름 일부나 초성을 쳐 보세요. 탭·지역·노선·계획 사업으로 바로 갑니다.` },
    { target: '#btn-next', title: '다음 해', body: '사업을 벌였으면 다음 해로 넘깁니다. 한 해 동안의 통행·혼잡과 인구 이동을 다시 계산합니다 (10~20초). <b>5년 ▶▶</b>는 다섯 해를 이어서 넘기고, 노선을 그리기 시작하면 멈춥니다. 이 안내는 상단의 <b>?</b> 단추로 다시 볼 수 있습니다.' },
  ], () => { switchTab('status'); const sel = $('#guide-mode'); if (sel) sel.value = getGuideMode(); });   // "다시 보지 않기"를 누르면 설정 칸도 맞춘다
}

function removeLastPoint() {
  const p = draft.points.pop();
  if (p?.reserved) namer.release(p.name, p.kind);
  drawDraft(); renderBuild();
}

function switchTab(tab) {
  // 선택 패널은 오른쪽 패널을 다 차지하므로, 탭을 누르면 닫고 그 탭을 보여 준다
  if (!$('#selection').hidden) $('#selection .close')?.click();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === tab));
  if (stalePanels.delete(tab)) PANEL_RENDER()[tab]?.();
  if (tab !== 'build') showPlan(null);
}

/** 계획 노선 하나만 지도에 점선으로 (null이면 지운다). 건설 탭 목록에서 계획을 누를 때 */
let shownPlan = null;
function showPlan(id) {
  if (!map) return;
  shownPlan = id;
  const plan = id ? plans.find((p) => p.id === id) : null;
  const line = showPlanLine(map, plan, plan ? planPreviewLine(plan) : null);
  document.querySelectorAll('[data-plan-show]').forEach((el) => { el.style.textDecoration = el.dataset.planShow === id ? 'underline' : ''; });
  if (!line) return;
  const xs = line.map((c) => c[0]), ys = line.map((c) => c[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 11 });
}

// ---- 접는 묶음: 패널의 소제목(h4, 설정은 h3)마다 그 아래 내용을 <details>로 묶는다. 펼침 상태는 이 브라우저에 남긴다
const FOLD_KEY = 'ukt-folds-v2';   // v2: 사업·설정 탭을 접힌 채로 시작하도록 예전 펼침 기록을 버린다
const FOLD_CLOSED = new Set(['settings:저장 슬롯', 'settings:새 게임', 'settings:데이터', 'status:추이', 'stats:관광', 'stats:추이', 'requests:옛 이름 되찾기']);
// 사업 탭(건설 사업 목록)과 설정 탭은 처음에 모두 접어 둔다
const FOLD_CLOSED_PANELS = new Set(['projects', 'settings']);
let folds = {};
try { folds = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { folds = {}; }

function foldSections(el, key, tag) {
  if (el.hidden || el.querySelector(':scope > details.fold')) return;
  const kids = [...el.children];
  let box = null;
  for (const c of kids) {
    if (c.tagName === tag) {
      const title = c.textContent.trim(), id = `${key}:${title.replace(/\s*[\d(].*$/, '')}`;
      box = document.createElement('details');
      box.className = 'fold';
      box.open = folds[id] ?? !(FOLD_CLOSED.has(id) || FOLD_CLOSED_PANELS.has(key));
      box.ontoggle = () => { folds[id] = box.open; try { localStorage.setItem(FOLD_KEY, JSON.stringify(folds)); } catch { /* 저장 못 해도 된다 */ } };
      const sum = document.createElement('summary');
      sum.innerHTML = c.innerHTML;
      el.insertBefore(box, c);
      box.appendChild(sum);
      c.remove();
    } else if (box) box.appendChild(c);
  }
}

function watchFolds() {
  const spots = [['[data-panel=status]', 'status', 'H4'], ['[data-panel=stats]', 'stats', 'H3'], ['[data-panel=settings]', 'settings', 'H3'],
    ['[data-panel=projects]', 'projects', 'H3'], ['[data-panel=requests]', 'requests', 'H3'], ['[data-panel=ops]', 'ops', 'H3'], ['#selection', 'sel', 'H4']];
  for (const [sel, key, tag] of spots) {
    const el = $(sel);
    const run = () => foldSections(el, key, tag);
    new MutationObserver(run).observe(el, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    run();
  }
}

function setBusy(on, label = '', v = 0) {
  busy = on;
  $('#busy').hidden = !on;
  $('.busy-label').textContent = autoYears ? `${label} · 이어 넘기기 ${autoYears}년 남음` : label;
  $('#busy-bar').style.width = `${Math.round(v * 100)}%`;
  $('#btn-next').disabled = on || !result;
  updateAutoBtn();
}

const PANEL_RENDER = () => ({ status: renderStatus, build: renderBuild, projects: renderProjects, requests: renderRequests,
  ops: renderOps, settings: renderSettings, stats: renderStats });
const stalePanels = new Set();

/** 상단·범례·지도 경계와 지금 보이는 탭만 다시 그리고, 나머지 탭은 열 때 그리도록 표시해 둔다 */
function renderVisible() {
  renderRegions(); renderTop(); renderLegend(); renderSelection();
  const on = document.querySelector('.panel.on')?.dataset.panel;
  for (const [tab, fn] of Object.entries(PANEL_RENDER())) {
    if (tab === on) fn(); else stalePanels.add(tab);
  }
}

/**
 * 오른쪽 패널을 다시 그려도 보던 자리를 지킨다: 패널마다 스크롤 위치와, 펼쳐 둔 접는 묶음(details, 제목으로 짝짓는다).
 * 제안 수락·개량 착공처럼 패널 안 단추를 누른 뒤 목록이 닫히거나 맨 위로 튀지 않게
 */
function keepPanels(fn) {
  const side = document.getElementById('side');
  if (!side) return fn();
  const boxes = [...side.querySelectorAll('#selection, .panel')].map((e) => [e, e.scrollTop]);
  const det = new Map();
  for (const d of side.querySelectorAll('details')) {
    const k = `${d.closest('[data-panel], #selection')?.dataset.panel || 'sel'}|${d.querySelector(':scope > summary')?.textContent.replace(/[\d,.]+/g, '#').trim()}`;
    det.set(k, d.open);
  }
  fn();
  // 소제목 접기(foldSections)는 MutationObserver로 조금 뒤에 붙으므로, 그 뒤에 한 번 더 맞춘다
  const restore = () => {
  for (const d of side.querySelectorAll('details')) {
    const k = `${d.closest('[data-panel], #selection')?.dataset.panel || 'sel'}|${d.querySelector(':scope > summary')?.textContent.replace(/[\d,.]+/g, '#').trim()}`;
    if (det.has(k) && d.open !== det.get(k)) d.open = det.get(k);
  }
  for (const [e, t] of boxes) if (t) e.scrollTop = t;
  };
  restore();
  queueMicrotask(restore);
}

function renderAll() {
  keepPanels(renderAllPanels);
}

function renderAllPanels() {
  stalePanels.clear();
  renderRegions();
  if (map) setHousing(map, state.housing || []);   // 다 지은 택지지구는 배경 지도에 시가지로
  renderTop(); renderLegend(); renderStatus(); renderBuild(); renderProjects(); renderRequests(); renderOps(); renderSettings(); renderStats(); renderSelection();
  drawServices();
}

/** 지도의 광역 단체 경계·이름: 북측 도 복원, 광역시 승격(독립)이 바로 보이게 */
function renderRegions() {
  if (!state || !map) return;
  const short = (n) => { for (const a of ['특별자치시', '특별자치도', '통합특별시', '특별시', '광역시', '직할시']) if (n.endsWith(a) && n.length > a.length + 1) return n.slice(0, -a.length); return n; };
  setRegions(map, zoneProps.map((z) => (z.ext ? '' : regionOf(state, z))), zoneProps.map((z) => z.country), (i) => [zoneProps[i].cx, zoneProps[i].cy], short, zoneProps.map((z, i) => countyKey(i)));
}

function renderTop() {
  $('#s-year').textContent = `${state.year}년`;
  $('#s-budget').textContent = formatWon(state.budget);
  $('#s-debt').textContent = formatWon(state.debt);
  $('#s-debt').className = 'v' + (state.debt > 0 ? ' neg' : '');
  $('#s-approval').textContent = `${state.approval.toFixed(0)}%`;
  $('#s-integration').textContent = `${Math.round(state.integration * 100)}%`;
  $('#btn-next').disabled = busy || !result;
  updateAutoBtn();
}

let layerView = 'all';
let basemap = (() => { try { return localStorage.getItem('ukt-basemap') || 'plain'; } catch { return 'plain'; } })();
function renderLegend() {
  // 좁은 화면에서는 고르기 칸과 색 띠만 보이고, 나머지는 '범례 더 보기'로 편다 (지도를 덜 가리게)
  $('#legend').innerHTML = legendHTML(metric, layerView, basemap) + `<div class="lg-extra">${railKindLegend()}${trainsLegend()}
    <label style="display:flex;gap:4px;align-items:center;font-size:11px;margin-top:4px"><input type="checkbox" id="svc-lines-toggle" ${showServices ? 'checked' : ''}> 운행 계통 노선 보기</label></div>`
    + `<button type="button" class="small lg-toggle">${$('#legend').classList.contains('open') ? '범례 접기' : '범례 더 보기'}</button>`;
}

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
  // 요약 카드: 지난해 대비 변화
  const prev = h.length > 1 ? h[h.length - 2] : null, last = h[h.length - 1];
  const delta = (now, before, fmt, good = 1) => {
    if (before == null || now == null || !Number.isFinite(now - before) || Math.abs(now - before) < 1e-9) return '';
    const up = now > before;
    return `<span class="${(up ? good : -good) > 0 ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${fmt(Math.abs(now - before))}</span>`;
  };
  const tiles = [
    ['지역 간 통행', `${fmtPop(t.trips)}`, delta(t.trips, prev?.trips, fmtPop)],
    ['철도·대중교통 분담', pct((t.rail + t.transit) / t.trips, 0), delta(last && last.rail + last.transit, prev && prev.rail + prev.transit, (v) => `${(v * 100).toFixed(1)}%p`)],
    ['정체 도로', `${Math.round(cong).toLocaleString()}km`, delta(cong, prev?.congestedKm, (v) => `${Math.round(v)}km`, -1)],
    ['남북 소득 격차', `${(s.KR.income / s.KP.income).toFixed(1)}배`, prev ? delta(last.krInc / last.kpInc, prev.krInc / prev.kpInc, (v) => `${v.toFixed(1)}`, -1) : ''],
  ];
  el.innerHTML = `
    <div class="row" style="display:flex;align-items:center;gap:8px"><h3 style="flex:1">${state.year}년 현황</h3>
      <button class="small" id="btn-report" title="시작한 해와 견준 성적표, SNS 공유용 이미지">결산 보기</button></div>
    ${goalHTML()}
    <div class="kpis">${tiles.map(([k, v, d]) => `<div><span class="k">${k}</span><span class="v">${v}</span>${d ? `<span class="d">${d}</span>` : ''}</div>`).join('')}</div>
    ${state.approvalWhy ? `<h4>지지율 ${state.approval.toFixed(0)}% (목표 ${state.approvalTarget.toFixed(0)}%)</h4>
    <table class="kv">${state.approvalWhy.map(([k, v], i) => `<tr><td>${esc(k)}</td><td class="${i && v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${i && v > 0 ? '+' : ''}${v}</td></tr>`).join('')}</table>
    <p class="hint">지지율은 해마다 목표치 쪽으로 35%씩 움직입니다. 정체를 줄이고, 오래된 민원을 풀고, 예산을 남기지 않고 사업을 마치면 오릅니다.</p>` : ''}
    <h4>인구·소득</h4>
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
  let body = `${compareHTML()}<div class="tool-row"><button class="small" data-padd="station">역 신설 (노선 위 한 점)</button><button class="small" data-padd="ic">IC 신설 (고속도로 위 한 점)</button>
    <button class="small svc-pick-b">역 골라 특급·급행 짜기</button><button class="small" id="housing-pick" title="지도에서 고른 곳에 주택 단지를 조성합니다 (인구 순증)">택지지구 개발</button></div>
    <div class="name-row" style="margin-bottom:4px"><input type="text" id="rec-text" placeholder="예: 평양에 도시철도 3호선을 짓고 싶어, 노선을 추천해줘" style="flex:1">
      <button class="small primary" id="rec-go">노선 추천</button></div>
    <p class="hint" id="rec-msg">${esc(recMsg)}</p>
    <div class="name-row"><span class="kind">미리보기</span><select id="prev-years">
      <option value="0" ${previewYears ? '' : 'selected'}>첫해 (빠름)</option><option value="5" ${previewYears ? 'selected' : ''}>5년 뒤 (읍면동 인구 이동 반영, 느림)</option></select></div>
    <p class="hint">기존 도로·철도를 개량하려면 지도에서 구간을 누르세요. <b>Shift를 누른 채 끌면</b> 여러 구간을 한꺼번에 골라 개량할 수 있습니다. 새 노선을 놓으려면 아래에서 종류를 고른 뒤 지도를 차례로 누르세요.</p>`;
  if (draft) {
    if (draft.type === 'airport') {
      el.innerHTML = `<h4>${AIRPORT.build.label}</h4><p class="hint">공항을 놓을 곳을 지도에서 한 번 누르세요. ${formatWon(AIRPORT.build.cost)} · ${AIRPORT.build.years}년 · 연 ${AIRPORT.build.cap}백만 명. Esc: 취소</p>
        <button id="draft-cancel">취소</button>`;
      $('#draft-cancel').onclick = cancelDraft;
      return;
    }
    const spec = NEW_BUILDS[draft.type];
    const { km, cost, years, foreignKm, terrain } = draftCost();
    const tRule = terrainRule(draft.type);
    // 철도 신설은 운영사 자체 재원으로도 지을 수 있다 (찍은 점 대부분이 북측이면 KPRail)
    const draftOp = spec.mode === 1 ? operatorOf(state, { mode: 1, kp: draft.points.filter((p) => isKP(p.lat, p.lon)).length * 2 > draft.points.length ? 1 : 0 }) : null;
    const draftFund = draftOp && state.rail.fund === 'op' ? draftOp : 'gov';
    const affordable = canAfford(state, cost, years, draftFund);
    const lineName = draftLineName();
    body = `<h4>${spec.label}</h4>
      ${draft.recNote ? `<p class="hint">${esc(draft.recNote)}</p>` : ''}
      ${lineName ? `<div class="name-row"><span class="kind">노선</span><input type="text" id="line-name" value="${esc(lineName)}"></div>` : ''}
      ${draft.extendOf || draft.extend === false ? `<div class="name-row"><label><input type="checkbox" id="draft-extend" ${draft.extendOf ? 'checked' : ''}>
        기존 노선의 연장으로 놓기${draft.extendOf ? ` (${esc(draft.extendOf)})` : ''}</label></div>` : ''}
      ${draft.points.length > 1 ? `<p class="hint">${draft.extendOf ? `기존선 연장: ${esc(draft.extendOf)}의 종점에서 이어 같은 노선 이름을 씁니다.` : '신설 노선: 새 노선 이름을 붙입니다.'}</p>` : ''}
      <p class="hint">기존 ${spec.mode ? '선로' : '도로'} 근처를 누르면 연결됩니다. ${spec.mode ? '각 점은 역이 됩니다.' : '도로 끝점이 기존 도로에 닿지 않으면 착공할 때 가장 가까운 도로(5km 안)에 저절로 이어집니다.'}
      Backspace: 마지막 점 지우기 · Enter: 착공 · Esc: 취소</p>
      <div>${draft.points.map((p, i) => (p.via ? '' : pointRow(p, i))).join('') || '<p class="hint">시작점을 누르세요.</p>'}</div>
      ${draft.points.some((p) => p.via) ? `<p class="hint">선형을 잡는 경유점 ${draft.points.filter((p) => p.via).length}개 (역·IC 없음)</p>` : ''}
      ${(() => { const pl = draft.plan && plans.find((x) => x.id === draft.plan); return pl?.source ? `<p class="hint"><b>계획 근거</b>: ${esc(pl.source)}${pl.stationSource ? `<br>역: ${esc(pl.stationSource)}` : ''}</p>` : ''; })()}
      ${draft.planFilled ? `<p class="hint">계획 노선이 기존 국도·지방도와 만나는 곳에 IC ${draft.planFilled}곳을 넣었습니다. 필요 없으면 목록에서 지우세요.</p>` : ''}
      <table class="kv" style="margin-top:8px">
        <tr><td>길이</td><td>${km.toFixed(1)} km</td></tr>
        ${NEW_BUILDS[draft.type].mode >= 1 ? `<tr><td>역 반경 ${catchKm(draft.type)}km 인구</td><td>${fmtPeople(draft.points.filter((q) => q.name && q.kind !== 'IC').reduce((t, q) => t + popNear(q.lon, q.lat, catchKm(draft.type)), 0))} <span class="m">(역 ${draft.points.filter((q) => q.name && q.kind !== 'IC').length}곳, 겹친 곳도 셈)</span></td></tr>` : ''}
        <tr><td>사업비</td><td>${formatWon(cost)}</td></tr>
        <tr><td>공사 기간 · 연 분담</td><td>${years}년 · ${formatWon(cost / years)}</td></tr>
        ${foreignKm > 0.5 ? `<tr><td>외국 구간 (상대국 절반 부담)</td><td>${foreignKm.toFixed(0)} km</td></tr>` : ''}
        ${terrain && draft.points.length > 1 ? `<tr><td>지형 (어림)</td><td>터널·깎기 ${terrain.tunnelKm.toFixed(0)}km · 교량 ${(terrain.bridgeKm + terrain.seaKm).toFixed(1)}km</td></tr>` : ''}
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
      ${tRule ? `<div class="actions"><button id="draft-terrain" ${draft.points.length < 2 || !terrainReady() ? 'disabled' : ''} title="찍은 역·IC 사이를 경사가 급한 산지와 강·바다를 덜 지나는 선형으로 다시 잡습니다">지형 따라 선형 잡기</button></div>` : ''}
      <div class="actions nowrap">
        <button class="primary" id="draft-ok" ${draft.points.length < 2 || !affordable ? 'disabled' : ''}>착공</button>
        <button id="draft-prev" ${draft.points.length < 2 ? 'disabled' : ''}>효과 미리보기</button>
        <button id="draft-cancel">취소</button>
      </div>`;
  }
  el.innerHTML = `<div class="tools">${tools}</div>${body}${draft ? '' : plansHTML() + megaHTML()}`;
  if (!draft) bindMega(el);
  el.querySelectorAll('[data-plan-show]').forEach((b) => { b.onclick = () => showPlan(shownPlan === b.dataset.planShow ? null : b.dataset.planShow); });
  if (draft) showPlan(null);
  el.querySelectorAll('[data-plan]').forEach((b) => { b.onclick = () => openPlan(b.dataset.plan); });
  el.querySelectorAll('.svc-pick-b').forEach((b) => { b.onclick = startServicePick; });
  el.querySelectorAll('[data-padd]').forEach((b) => { b.onclick = () => startPointAdd(b.dataset.padd); });
  const hp = el.querySelector('#housing-pick');
  if (hp) hp.onclick = startHousingPick;
  const py = el.querySelector('#prev-years');
  if (py) py.onchange = () => { previewYears = +py.value; };
  const recGo = () => recommendRoute(el.querySelector('#rec-text').value);
  el.querySelector('#rec-go')?.addEventListener('click', recGo);
  el.querySelector('#rec-text')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); recGo(); } });
  el.querySelectorAll('[data-build]').forEach((b) => { b.onclick = () => startDraft(b.dataset.build); });
  if (draft) {
    $('#draft-ok').onclick = commitDraft;
    $('#draft-prev').onclick = previewDraft;
    const tb = $('#draft-terrain');
    if (tb) tb.onclick = terrainAlign;
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
        else { p.kind = 'station'; p.name = namer.suggest(p.lon, p.lat, 'station'); p.reserved = true; delete p.via; }
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
  const catchment = spec.mode >= 1 ? `<span class="m" title="역 반경 ${catchKm(draft.type)}km 인구">${fmtPeople(popNear(p.lon, p.lat, catchKm(draft.type)))}</span>` : '';
  if (p.existing) return `<div class="name-row"><span class="kind">${tag}</span><span style="flex:1">${esc(p.name)}</span>${catchment}</div>`;
  const toggle = spec.mode >= 1 && i > 0 && i < draft.points.length - 1 ? `<button class="small" data-ptoggle="${i}">통과</button>` : '';
  return `<div class="name-row"><span class="kind">${p.kind === 'station' ? '역' : p.kind}</span>
    <input type="text" data-pname="${i}" value="${esc(p.name)}">
    <button class="small" data-pauto="${i}" title="자동 이름">↻</button>${catchment}${toggle}</div>`;
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
    const name = projectBounds(p) ? `<button class="t link" data-locate="${p.id}" title="지도에서 보기">${esc(p.label)}</button>` : `<div class="t">${esc(p.label)}</div>`;
    return `<div class="item">${name}
      <div class="m">${formatWon(p.cost)} · 연 ${formatWon(Math.min(p.annual, p.cost - p.paid))} · ${p.doneYear}년 ${p.kind === 'osm' ? '개통' : '완공'} 예정${by}</div>
      <div class="progress"><div style="width:${Math.round(prog * 100)}%"></div></div>
      ${['service', 'vehicles', 'airRoute', 'rename'].includes(p.kind) ? '' : `<div class="pace">투입 속도 ${PACES.map((x) =>
        `<button class="small ${x === pace ? 'on' : ''}" data-pace="${p.id}" data-v="${x}">${Math.round(x * 100)}%</button>`).join('')}</div>`}
      <div class="actions">${p.kind === 'new' ? `<button class="small" data-gazette="${p.id}" title="이 사업의 기본계획 고시문 (노선도·정거장 계획·위치도)">계획 고시문</button>` : ''}
        ${cancelBlocked(p) ? '' : `<button class="small danger" data-cancel-proj="${p.id}" title="이미 낸 돈은 돌려받지 못하고 남은 사업비만 아낍니다">사업 취소</button>`}</div></div>`;
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
    ${housingStatusHTML()}
    <h3 style="margin-top:16px">완공 (${state.projects.filter((p) => p.status === 'done').length})</h3>
    <div class="list">${done.map((p) => `<div class="item">${projectBounds(p) ? `<button class="t link" data-locate="${p.id}" title="지도에서 보기">${esc(p.label)}</button>` : `<div class="t">${esc(p.label)}</div>`}<div class="m">${p.doneYear}년 완공 · ${formatWon(p.cost)}${p.kind === 'new' ? ` · <button class="t link" data-gazette="${p.id}">고시문</button>` : ''}</div></div>`).join('') || '<p class="hint">아직 없습니다.</p>'}</div>`;
  el.querySelectorAll('[data-locate]').forEach((b) => { b.onclick = () => locateProject(state.projects.find((x) => x.id === b.dataset.locate)); });
  el.querySelectorAll('[data-gazette]').forEach((b) => { b.onclick = () => showGazette(state.projects.find((x) => x.id === b.dataset.gazette)); });
  el.querySelectorAll('[data-house-go]').forEach((b) => {
    b.onclick = () => { const h = (state.housing || []).find((x) => x.id === b.dataset.houseGo); if (h) map.easeTo({ center: [h.lon, h.lat], zoom: 12.5, duration: 800 }); };
  });
  el.querySelectorAll('[data-pace]').forEach((b) => {
    b.onclick = () => { setProjectPace(state, b.dataset.pace, +b.dataset.v); save(state); renderProjects(); renderTop(); };
  });
  el.querySelectorAll('[data-cancel-proj]').forEach((b) => {
    b.onclick = () => {
      const p = state.projects.find((x) => x.id === b.dataset.cancelProj);
      if (!p) return;
      const left = Math.max(0, p.cost - p.paid);
      const hit = p.cost >= 50000 ? 2 : p.cost >= 10000 ? 1 : 0;
      if (!confirm(`${p.label}

사업을 취소할까요? 지금까지 낸 ${formatWon(p.paid)}은 돌려받지 못하고, 남은 ${formatWon(left)}을 아낍니다.${hit ? ` 짓다 만 사업이라 지지율이 ${hit} 내려갑니다.` : ''}`)) return;
      const r = cancelProject(base, state, p.id);
      if (!r.ok) { alert(r.reason); return; }
      save(state); refreshLinks(); refreshClosed(); renderAll();
    };
  });
}

/** 택지지구 현황: 공사 중(완공 연도·진행)과 입주 완료(입주민·분양 수익), 이름을 누르면 지도에서 본다 */
function housingStatusHTML() {
  const list = state.housing || [];
  if (!list.length) return '';
  const projOf = new Map(state.projects.filter((p) => p.kind === 'housing').map((p) => [p.id, p]));
  const sizeLabel = (k) => HOUSING.sizes[k]?.label || k;
  const done = list.filter((h) => h.done), building = list.filter((h) => !h.done && projOf.get(h.id)?.status === 'building');
  const people = done.reduce((s, h) => s + (h.persons || 0), 0), revenue = done.reduce((s, h) => s + (h.revenue || 0), 0);
  const row = (h) => {
    const p = projOf.get(h.id);
    const prog = p ? Math.min(1, p.paid / Math.max(1, p.cost)) : 1;
    return `<div class="item"><button class="t link" data-house-go="${h.id}" title="지도에서 보기">${esc(h.name)}</button>
      <div class="m">${esc(zoneName(h.zone))} · ${sizeLabel(h.size)} · ${h.done
        ? `입주 ${fmtPeople(h.persons)} (그중 순증 ${fmtPeople(h.net)}) · 분양 수익 ${formatWon(h.revenue)}`
        : `${p?.doneYear ?? ''}년 입주 예정 · 입주 예상 ${fmtPeople(h.persons)}`}</div>
      ${h.done ? '' : `<div class="progress"><div style="width:${Math.round(prog * 100)}%"></div></div>`}</div>`;
  };
  return `<h3 style="margin-top:16px">택지지구 (${list.length})</h3>
    <p class="hint">입주 완료 ${done.length}곳 · 입주민 ${fmtPeople(people)} · 분양 수익 합계 ${formatWon(revenue)}${building.length ? ` · 공사 중 ${building.length}곳` : ''}</p>
    <div class="list">${[...building, ...done].map(row).join('')}</div>`;
}

/** 사업이 놓인 범위 [[서, 남], [동, 북]]: 구간·공항·항공 노선·옛 이름(시군구). 찾을 수 없으면 null */
function projectBounds(p) {
  const pts = [];
  for (const id of p.links || []) {
    const g = allLinks()[id]?.geom;
    if (g) for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) pts.push([g[k], g[k + 1]]);
  }
  const aps = (p.airport || p.kind === 'airRoute') ? effectiveNetwork(base, state).airports : [];
  for (const id of [p.airport, p.a, p.b]) {
    const ap = id != null && aps.find((a) => a.id === id);
    if (ap) pts.push([ap.lon, ap.lat]);
  }
  if (p.kind === 'rename' && p.key?.startsWith('z:')) { const z = zoneProps[+p.key.slice(2)]; if (z) pts.push([z.cx, z.cy]); }
  if (!pts.length) return null;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

/** 사업 이름을 누르면 지도를 그곳으로 옮기고 구간을 잠깐 밝힌다 (오른쪽 패널은 그대로) */
let locateFlash = null;
function locateProject(p) {
  const b = p && projectBounds(p);
  if (!b) return;
  map.fitBounds(b, { padding: 80, maxZoom: p.links?.length ? 12 : 9.5, duration: 900 });
  if (locateFlash) { clearTimeout(locateFlash.t); locateFlash.ids.forEach((i) => map.setFeatureState({ source: 'links', id: i }, { sel: false })); }
  const keep = new Set(selection?.type === 'link' ? selection.section?.ids || [selection.id] : selection?.type === 'multi' ? selection.ids : []);
  const ids = (p.links || []).filter((i) => !keep.has(i));
  ids.forEach((i) => map.setFeatureState({ source: 'links', id: i }, { sel: true }));
  locateFlash = { ids, t: setTimeout(() => { ids.forEach((i) => map.setFeatureState({ source: 'links', id: i }, { sel: false })); locateFlash = null; }, 3000) };
}

let reqSide = 'all';   // 확장 요구 목록: 전체·남·북

/** 패널을 다시 그려도 스크롤 자리를 지킨다 (확장 요구를 들어준 뒤 목록 맨 위로 튀지 않게) */
function keepScroll(el, fn) {
  const boxes = [];
  for (let e = el; e; e = e.parentElement) if (e.scrollTop) boxes.push([e, e.scrollTop]);
  fn();
  for (const [e, t] of boxes) e.scrollTop = t;
}

function renderRequests() {
  const el = $('[data-panel=requests]');
  const c = $('#req-count');
  c.hidden = requests.length === 0;
  c.textContent = requests.length;
  const nKR = requests.filter((r) => !r.kp).length, nKP = requests.length - nKR;
  const shown = requests.map((r, i) => [r, i]).filter(([r]) => reqSide === 'all' || (reqSide === 'KP') === !!r.kp);
  const sideBtn = (v, label) => `<button class="small ${reqSide === v ? 'on' : ''}" data-req-side="${v}">${label}</button>`;
  el.innerHTML = `${proposalsHTML()}<h3>확장 요구 (${requests.length})</h3>
    <p class="hint">혼잡도(V/C)가 1.0을 넘는 상태가 2년 이상 이어진 노선입니다(남은 고속도로·간선국도, 북은 모든 도로, 그리고 철도). 방치하면 지지율이 떨어집니다. 넓혀도 통행비용이 줄면 수요가 다시 늘 수 있습니다.</p>
    <div class="pace">${sideBtn('all', `전체 ${requests.length}`)}${sideBtn('KR', `남 ${nKR}`)}${sideBtn('KP', `북 ${nKP}`)}</div>
    <div class="list">${shown.map(([r, i]) => {
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
    }).join('') || '<p class="hint">요구가 없습니다.</p>'}</div>
    ${policyHTML()}`;
  bindPolicy(el);
  el.querySelectorAll('[data-req-side]').forEach((b) => { b.onclick = () => { reqSide = b.dataset.reqSide; keepScroll(el, renderRequests); }; });
  el.querySelectorAll('[data-fix]').forEach((b) => {
    b.onclick = () => {
      const r = requests[+b.dataset.fix];
      const fix = defaultFix(linkAt(base, state, r.links[0]));
      const res = startUpgrade(base, state, r.links, fix.id);
      if (!res.ok) return alert(res.reason);
      requests = requests.filter((q) => q !== r);
      // 목록을 닫거나 맨 위로 돌리지 않고 그 자리에서 다음 요구를 이어서 볼 수 있게
      save(state); refreshLinks();
      keepScroll(el, () => { renderTop(); renderProjects(); renderRequests(); });
    };
  });
  el.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => gotoLinks(requests[+b.dataset.goto].links); });
  bindProposals(el);
  el.querySelectorAll('[data-dismiss]').forEach((b) => {
    b.onclick = () => {
      const r = requests[+b.dataset.dismiss];
      state.dismissed[r.key] = state.year;
      requests = requests.filter((q) => q !== r);
      save(state); keepScroll(el, renderRequests);
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
      cur.vol = Math.max(cur.vol, shownTraffic.vol[linkTwins[i]]); cur.vc = Math.max(cur.vc, shownTraffic.vc[linkTwins[i]]);
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
    <h4>노선 순위</h4><table class="cmp"><tr><th>노선</th><th>회/일</th><th>여객/일</th><th>탑승률</th><th>영업계수</th></tr>${routeRows}</table>
    <h4>공항 순위</h4><table class="cmp"><tr><th>공항</th><th>여객/일</th><th>V/C</th></tr>${apRows}</table>
    ${latentRows ? `<h4>미취항 잠재 수요</h4><table class="cmp"><tr><th>노선</th><th>여객/일</th></tr>${latentRows}</table>` : ''}
    ${result.totals.tourDest ? `<h3 style="margin-top:16px">관광</h3>
    <table class="cmp"><tr><th>목적지</th><th>관광 통행/일</th></tr>${Object.entries(result.totals.tourDest).sort((x, y) => y[1] - x[1]).slice(0, 10)
      .map(([z, v]) => `<tr><td>${esc(zoneName(+z))}${zoneProps[z].sites ? ` <span class="m">${esc(zoneProps[z].sites.join(', '))}</span>` : ''}</td><td>${Math.round(v).toLocaleString()}</td></tr>`).join('')}</table>` : ''}
    <h3 style="margin-top:16px">철도</h3>
    <h4>역 순위 (지역 간 승하차)</h4><table class="cmp"><tr><th>역</th><th>명/일</th></tr>${stRows}</table>
    <h4>노선 순위 (최대 구간 이용객)</h4><table class="cmp"><tr><th>노선</th><th>명/일</th><th>V/C</th></tr>${railRows}</table>
    <p class="hint">철도 회사 수지·노선별 영업계수·운행 계통은 <a href="#" data-goto-tab="ops">운영 탭</a>에 있습니다.</p>
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
  el.querySelectorAll('[data-goto-tab]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); switchTab(a.dataset.gotoTab); }; });
}

// ---- 영업계수 패널: 노선별 수지를 나쁜 순으로 보고 감편·폐선·재개통한다
let econView = { filter: 'all', sort: 'ratio', all: false };

function lineKmOf(name) {
  let km = 0;
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode >= 1 && l.name === name && !state.replaced?.[i] && !l.replaced && (i < base.links.length || l.built)) km += l.len;
  });
  return km;
}

function econPanelHTML() {
  const rows = lineEconomics().filter((e) => !e.idle && (econView.filter === 'all' || (econView.filter === 'metro') === (e.cls === 'metro')));
  const loss = (e) => e.cost - e.rev;
  rows.sort(econView.sort === 'loss' ? (x, y) => loss(y) - loss(x) : (x, y) => y.ratio - x.ratio);
  const all = lineEconomics().filter((e) => !e.idle), deficit = all.filter((e) => e.ratio > 100);
  const idle = lineEconomics().filter((e) => e.idle);
  const shown = econView.all ? rows : rows.slice(0, 20);
  const closed = Object.entries(state.closedLines || {});
  const chip = (k, v, label) => `<button class="small ${econView[k] === v ? 'on' : ''}" data-econ="${k}:${v}">${label}</button>`;
  const ratioCls = (r) => (r >= 200 ? 'neg' : r > 100 ? 'warn' : 'pos');
  return `<h3 style="margin-top:16px">영업계수 · 노선 정리</h3>
    <div class="kpis">
      <div><span class="k">흑자 노선</span><span class="v">${all.length - deficit.length}</span></div>
      <div><span class="k">적자 노선 (200 이상)</span><span class="v">${deficit.length} <small class="neg">(${all.filter((e) => e.ratio >= 200).length})</small></span></div>
      <div><span class="k">적자 합계 (연)</span><span class="v neg">${formatWon(deficit.reduce((a, e) => a + loss(e), 0) / 1e8)}</span></div>
      <div><span class="k">폐선·감편</span><span class="v">${closed.length} · ${Object.keys(state.lineFreq || {}).length}</span></div>
    </div>
    <div class="econ-bar">${chip('filter', 'all', '전체')}${chip('filter', 'rail', '철도')}${chip('filter', 'metro', '도시철도')}
      <span style="flex:1"></span>${chip('sort', 'ratio', '영업계수순')}${chip('sort', 'loss', '적자액순')}</div>
    <div class="econ-list">${shown.map((e) => {
      const f = state.lineFreq?.[e.name] || 1;
      return `<div class="econ-row"><div class="n"><b>${esc(e.name)}</b><span class="m">${Math.round(e.km)}km · 최대 ${Math.round(e.peak).toLocaleString()}명/일 · 수입 ${formatWon(e.rev / 1e8)} · 비용 ${formatWon(e.cost / 1e8)}</span></div>
        <span class="r ${ratioCls(e.ratio)}">${fmtRatio(e.ratio)}</span>
        <select data-freq="${esc(e.name)}" title="기본 열차 운행 비율">${FREQ_STEPS.map((x) => `<option value="${x}" ${x === f ? 'selected' : ''}>운행 ${Math.round(x * 100)}%</option>`).join('')}</select>
        <button class="small" data-close-line="${esc(e.name)}" title="폐선">폐선</button></div>`;
    }).join('') || '<p class="hint">노선이 없습니다.</p>'}</div>
    ${rows.length > 20 ? `<button class="small" data-econ="all:${!econView.all}" style="margin-top:6px">${econView.all ? '20개만 보기' : `모두 보기 (${rows.length})`}</button>` : ''}
    ${idle.length ? `<p class="hint">여객 이용이 없는 노선 ${idle.length}개(화물선, 역이 없는 선로: ${idle.slice(0, 6).map((e) => esc(e.name)).join(', ')}${idle.length > 6 ? ' 등' : ''})는 순위에서 뺐습니다. 여객 열차 없이 선로 유지비 연 ${formatWon(idle.reduce((a, e) => a + e.cost, 0) / 1e8)}만 셉니다.</p>` : ''}
    ${closed.length ? `<h4>폐선한 노선</h4><div class="list">${closed.map(([n, y]) => `<div class="item opt"><div class="opt-row">
      <span>${esc(n)} <span class="m">${y}년 폐선 · ${Math.round(lineKmOf(n))}km</span></span>
      <button class="small" data-reopen="${esc(n)}">재개통 ${formatWon(lineKmOf(n) * REOPEN_PER_KM)}</button></div></div>`).join('')}</div>` : ''}
    <p class="hint">영업계수 = 영업비용 ÷ 영업수입 × 100 (100 미만이면 흑자, 200 이상이면 수입의 두 배를 씁니다). 수입은 구간 이용객 × 거리 × km당 운임, 비용은 운행 열차-km와 선로 유지비로 셈한 추정입니다. 도시철도는 같은 구 안 이용을 역세권 인구로 어림해 더했습니다.<br>
    운행 비율을 줄이면(감편) 기본 열차의 최소 운행과 비용이 줄지만, 배차가 길어져 기다림이 늘고(절반이면 노선 전체 약 20분) 수송력이 줄어 이용객도 빠집니다. 폐선하면 그 노선의 열차·선로 비용이 없어지고 지나던 계통은 멈추며, 2년 동안 지지율이 노선당 ${CLOSE_APPROVAL}점 깎입니다. 결과는 다음 해부터 반영됩니다.</p>`;
}

function bindEcon(el) {
  el.querySelectorAll('[data-econ]').forEach((b) => {
    b.onclick = () => { const [k, v] = b.dataset.econ.split(':'); econView[k] = k === 'all' ? v === 'true' : v; renderOps(); };
  });
  el.querySelectorAll('[data-freq]').forEach((sel) => {
    sel.onchange = () => { setLineFreq(state, sel.dataset.freq, +sel.value); econCache = null; save(state); renderOps(); renderStatus(); };
  });
  el.querySelectorAll('[data-close-line]').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.closeLine, e = lineEconomics().find((x) => x.name === name);
      const svcs = (state.services || []).filter((x) => (x.lines || [x.line]).includes(name));
      const msg = `${name}을(를) 폐선할까요?
연 수입 ${formatWon(e.rev / 1e8)} · 비용 ${formatWon(e.cost / 1e8)} → 수지 ${e.cost > e.rev ? '개선' : '악화'} ${formatWon(Math.abs(e.cost - e.rev) / 1e8)}/년`
        + `${svcs.length ? `
지나는 운행 계통 ${svcs.length}개가 멈춥니다.` : ''}
지지율 -${CLOSE_APPROVAL} (2년). 재개통에는 ${formatWon(e.km * REOPEN_PER_KM)}이 듭니다.`;
      if (!confirm(msg)) return;
      closeLine(state, name);
      econCache = null; save(state); renderAll();
    };
  });
  el.querySelectorAll('[data-reopen]').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.reopen;
      const r = reopenLine(state, name, lineKmOf(name));
      if (!r.ok) { alert(r.reason); return; }
      econCache = null; save(state); renderAll();
    };
  });
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
    <div class="name-row"><span style="flex:1">언어 · Language</span>
      <select id="lang"><option value="ko" ${LANG === 'ko' ? 'selected' : ''}>한국어</option><option value="en" ${LANG === 'en' ? 'selected' : ''}>English (beta)</option></select></div>
    ${LANG === 'en' ? '<p class="hint">English is in beta: the main screens, tutorial, setup and summary are translated; detailed panels and place names are still in Korean.</p>' : ''}
    <h3>도움말</h3>
    <div class="actions"><button class="small" id="help-guide">처음 안내 다시 보기</button><button class="small" id="help-find">메뉴 찾기 (Ctrl+K)</button></div>
    <div class="name-row"><span style="flex:1">게임을 열 때 처음 안내</span>
      <select id="guide-mode">${Object.entries(GUIDE_MODES).map(([k, v]) => `<option value="${k}" ${getGuideMode() === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="actions"><button class="small" id="help-bug">오류 제보하기</button></div>
    <p class="hint">버전·연도·지도 위치·브라우저 정보가 채워진 메일이 열립니다 (${BUG_MAIL}). 무엇이 이상했는지만 적어 보내 주세요.</p>
    <p class="hint">정책·지방자치·행정구역·국가 대형 사업은 <a href="#" data-goto-tab="requests">민원·정책 탭</a>, 항공 자동 운영·철도 회사·노선 정리는 <a href="#" data-goto-tab="ops">운영 탭</a>에 있습니다.</p>
    <h3 style="margin-top:16px">저장 슬롯</h3>
    <p class="hint">진행은 자동 저장되고, 여기에 따로 세 개까지 남겨 두었다가 되돌릴 수 있습니다.</p>
    ${slotsHTML()}
    <div class="actions"><button class="small" id="save-export">파일로 내보내기</button><button class="small" id="save-import">파일 불러오기</button><button class="small" id="save-link">공유 링크 복사</button></div>
    <input type="file" id="save-file" accept=".json,application/json" hidden>
    <p class="hint">다른 기기·브라우저로 옮기거나 다른 사람과 판을 주고받을 때 씁니다. 지도 자료가 바뀌기 전에 만든 파일은 불러올 수 없습니다.</p>
    <h3 style="margin-top:16px">새 게임</h3>
    <div class="name-row"><span style="flex:1">난이도</span>
      <select id="difficulty">${Object.entries(DIFFICULTY).map(([k, v]) => `<option value="${k}" ${state.difficulty === k ? 'selected' : ''}>${v.label} (연 ${formatWon(v.annualBudget)})</option>`).join('')}</select></div>
    <p class="hint" style="margin-top:8px">남북 행정구역 정리 (시작할 때 정하면 비용·선거 없이 적용됩니다)</p>
    <p class="hint">행정구역 정리(개성·옹진·고성, 분단 전 군 되살리기 등)는 새 게임을 시작하면 뜨는 창에서 정합니다.</p>
    <button id="btn-new" style="margin-top:6px">이 설정으로 새로 시작</button>
    <p class="hint">진행 상황은 이 브라우저에 자동 저장됩니다.</p>
    <h3 style="margin-top:16px">데이터</h3>
    <p class="hint">도로·철도·행정구역·지명: © OpenStreetMap 기여자 (ODbL)<br>인구 격자: WorldPop 2020 (CC BY 4.0)<br>소득·HDI 초기값과 공사비 단가는 게임용 가정값입니다. 자세한 내용은 저장소의 docs/model.md를 보세요.</p>`;
  $('#help-guide').onclick = showGuide;
  $('#lang').onchange = (e) => setLang(e.target.value);
  $('#help-find').onclick = () => openPalette();
  $('#guide-mode').onchange = (e) => { setGuideMode(e.target.value); toast(`처음 안내: ${GUIDE_MODES[e.target.value]}`); };
  el.querySelectorAll('[data-goto-tab]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); switchTab(a.dataset.gotoTab); }; });
  bindSlots(el);
  $('#help-bug').onclick = reportBug;
  $('#save-export').onclick = exportSave;
  $('#save-link').onclick = copyShareLink;
  $('#save-import').onclick = () => $('#save-file').click();
  $('#save-file').onchange = (e) => { const f = e.target.files?.[0]; if (f) importSave(f); e.target.value = ''; };
  $('#btn-new').onclick = async () => {
    if (!confirm('지금 게임을 지우고 새로 시작할까요?')) return;
    guideOnNewGame();
    await clearSave();
    clearSim();
    const d = $('#difficulty').value;
    state = newGame(d);
    save(state);
    await flushSave();
    location.reload();
  };
}

/** 민원·정책 탭 아래쪽: 이주 정책, 지방자치·행정구역 이벤트, 국가 대형 사업, 옛 이름 되찾기 (정책·이벤트 성격은 이 탭에 모은다) */
function policyHTML() {
  return `<h3 style="margin-top:16px">이주 정책</h3>
    <div class="name-row"><span style="flex:1">북→남 이주</span>
      <select id="policy">${Object.entries(POLICY_LABEL).map(([k, v]) => `<option value="${k}" ${state.policy === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <p class="hint">통일 직후 대규모 남하를 막을지 정합니다. 통제할수록 북측 인구는 유지되지만 지지율과 통합 속도에 영향이 있습니다.</p>
    <h3 style="margin-top:16px">지방자치·행정구역</h3>
    ${localSettingsHTML()}
    ${historic.length ? `<h3 style="margin-top:16px">옛 이름 되찾기</h3>
    <p class="hint">북측에서 지도자 이름이나 선전 구호로 바뀐 지명을 바뀌기 전 이름으로 돌립니다. 표지판·행정 문서·지도를 바꾸는 데 예산이 들고, 완공되면 그 지역 주민 행복도가 오릅니다.</p>
    <div class="list">${historic.map((t) => restoreRow(t)).join('')}</div>` : ''}`;
}

function bindPolicy(el) {
  bindLocalSettings(el);
  bindRestore(el);
  el.querySelector('#policy').onchange = (e) => { state.policy = e.target.value; state.log.unshift(`${state.year}년 이주 정책: ${POLICY_LABEL[state.policy]}`); save(state); renderStatus(); };
}

/** 운영 탭: 철도 운행 계통, 철도 회사(재원·합병), 노선 영업계수·감편·폐선, 항공 자동 운영 */
function renderOps() {
  const el = $('[data-panel=ops]');
  if (!el) return;
  if (!result) { el.innerHTML = '<p class="hint">계산 중입니다…</p>'; return; }
  const svcRows = svcStats().map((x) => `<tr><td>${esc(x.s.name)} <span class="m">${x.s.name.includes(SERVICE_KINDS[x.s.kind].label) ? '' : `${SERVICE_KINDS[x.s.kind].label} · `}${x.s.stops.length}역</span></td>
    <td>${x.s.trains}</td><td>${Math.round(x.peak).toLocaleString()}</td><td>${Math.round(x.load * 100)}%</td><td class="${x.ratio > 100 ? 'neg' : ''}">${fmtRatio(x.ratio)}</td></tr>`).join('');
  el.innerHTML = `
    <h3>철도 운행 계통</h3>
    <div class="actions"><button class="small primary svc-pick-b">역 골라 특급·급행 짜기</button></div>
    <p class="hint">역을 누르면 그 역을 지나는 노선의 노선도·운행 계통을 보고 고칠 수 있습니다.</p>
    ${svcRows ? `<table class="cmp"><tr><th>계통</th><th>회/일</th><th>최대 구간</th><th>승차율</th><th>영업계수</th></tr>${svcRows}</table>` : '<p class="hint">아직 짠 계통이 없습니다.</p>'}
    ${railStatsHTML()}
    ${econPanelHTML()}
    <h3 style="margin-top:16px">항공</h3>
    <label class="name-row"><input type="checkbox" id="air-auto" ${state.air?.auto ? 'checked' : ''}>
      <span>항공 노선 자동 운영 (수요에 따른 취항·증편·단항)</span></label>
    <p class="hint">노선을 직접 열거나 닫으려면 지도에서 공항을 누르세요.</p>`;
  el.querySelectorAll('.svc-pick-b').forEach((b) => { b.onclick = startServicePick; });
  el.querySelector('#air-auto').onchange = (e) => { state.air.auto = e.target.checked; save(state); };
  bindRailStats(el);
  bindEcon(el);
}

function renderSelection() {
  const el = $('#selection');
  if (!selection) { el.hidden = true; return; }
  el.hidden = false;
  if (selection.type === 'link') el.innerHTML = linkPanel(selection.id);
  else if (selection.type === 'zone') el.innerHTML = zonePanel(selection.id);
  else if (selection.type === 'closed') el.innerHTML = closedPanel(selection.id);
  else if (selection.type === 'sub') el.innerHTML = subPanel(selection.id);
  else if (selection.type === 'airport') el.innerHTML = airportPanel(selection.id);
  else if (selection.type === 'multi') el.innerHTML = multiPanel(selection.ids);
  else if (selection.type === 'service') el.innerHTML = servicePanel();
  else if (selection.type === 'straighten') { el.innerHTML = straightenPanel(); bindStraighten(el); return; }
  else if (selection.type === 'pointadd') { el.innerHTML = pointAddPanel(); bindPointAdd(el); return; }
  else if (selection.type === 'svcpick') {
    el.innerHTML = servicePickPanel();
    const end = () => { endServicePick(); select(null); };
    el.querySelector('.close').onclick = end;
    el.querySelector('#sp-cancel').onclick = end;
    el.querySelector('#sp-ok').onclick = commitServicePick;
    return;
  }
  else if (selection.type === 'section') {
    el.innerHTML = sectionPanel();
    el.querySelector('.close').onclick = () => { endSection(); select(null); };
    return;
  }
  else el.innerHTML = nodePanel(selection.id);
  el.querySelector('.close')?.addEventListener('click', () => select(null));
  if (selection.type === 'service') bindService(el);
  if (selection.type === 'service') bindFund(el, renderSelection);
  el.querySelector('#line-diagram')?.addEventListener('click', () => openLineDiagram(selection.id));
  el.querySelector('#st-start')?.addEventListener('click', () => startStraighten(selection.id));
  el.querySelectorAll('[data-st-start]').forEach((b) => { b.onclick = () => startStraighten(selection.id); });
  el.querySelectorAll('.sec-start').forEach((b) => { b.onclick = () => startSection(selection.id); });
  el.querySelector('#sec-straight')?.addEventListener('click', () => {
    // 고른 구간의 양 끝 역으로 바로 직선화를 연다 (보통 시작과 같은 상태로: 사이 역 처리 메뉴가 되게)
    const sc = selection.section;
    startStraighten(selection.ids?.[0] ?? sc.via?.[0], { line: sc.line, cls: sc.cls, picks: [sc.A, sc.B] });
  });
  el.querySelector('#sec-prev')?.addEventListener('click', () => {
    const sc = selection.section, b0 = el.querySelector('[data-mup]');
    if (b0) previewUpgrade(JSON.parse(b0.dataset.ids), b0.dataset.mup);
    else alert(`${sc.line || '이 구간'}에 적용할 개량이 없습니다.`);
  });
  el.querySelectorAll('[data-st-diagram]').forEach((b) => { b.onclick = () => openLineDiagram(+b.dataset.stDiagram); });
  el.querySelectorAll('[data-padd]').forEach((b) => { b.onclick = () => { switchTab('build'); startPointAdd(b.dataset.padd); toast(b.dataset.padd === 'ic' ? '고속도로 위 IC 자리를 누르세요.' : '노선 위 역 자리를 누르세요.'); }; });
  el.querySelectorAll('[data-closed-go]').forEach((b) => { b.onclick = () => startClosedReopen(selection.id, b.dataset.closedGo); });
  el.querySelector('#reopen-go')?.addEventListener('click', () => startReopen(selection.id));
  el.querySelectorAll('[data-xfer]').forEach((b) => { b.onclick = () => startTransfer(selection.id, +b.dataset.xfer); });
  el.querySelector('#devel-ok')?.addEventListener('click', (ev) => commitDevel(+ev.target.dataset.node));
  el.querySelectorAll('[data-st-goto]').forEach((a) => {
    a.onclick = (ev) => { ev.preventDefault(); const nd = +a.dataset.stGoto; flyToNode(nd); select({ type: 'node', id: nd }); };
  });
  el.querySelectorAll('.svc-pick').forEach((b) => { b.onclick = () => startServicePick(); });
  el.querySelectorAll('[data-svc-from]').forEach((b) => { b.onclick = () => startServicePick([+b.dataset.svcFrom]); });
  el.querySelectorAll('[data-svc-edit]').forEach((b) => {
    b.onclick = () => {
      const s = state.services.find((x) => x.id === b.dataset.svcEdit);
      openServiceEditor(s.line, s.cls, s.id);
    };
  });
  el.querySelectorAll('[data-up]').forEach((b) => {
    b.onclick = () => {
      const ids = wholeRoute ? sameRoute(selection.id) : (selection.section?.ids || [selection.id]);
      const r = startUpgrade(base, state, ids, b.dataset.up);
      if (!r.ok) return alert(r.reason);
      save(state); refreshLinks(); renderAll();
    };
  });
  bindFund(el, renderSelection);
  el.querySelectorAll('[data-prev-up]').forEach((b) => {
    b.onclick = () => {
      const u = UPGRADES.find((x) => x.id === b.dataset.prevUp);
      const ids = (wholeRoute ? sameRoute(selection.id) : (selection.section?.ids || [selection.id])).filter((x) => u.applies(linkAt(base, state, x)));
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
  el.querySelector('[data-sez]')?.addEventListener('click', (e) => startSEZ(+e.currentTarget.dataset.sez));
  const zn = el.querySelector('#zone-name');
  if (zn) {
    el.querySelector('#zone-rename').onclick = () => {
      const v = zn.value.trim();
      if (!v) return;
      for (const j of countyZones(selection.id)) setPlaceName(state, 'zone', j, v);   // 한 시군으로 보이는 존 모두
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
function chainStations(net, lines) {
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
function connectableLines(net, e) {
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
function endLabels(e) {
  const a = nodeCoord(e.nodes[0]), b = nodeCoord(e.nodes[e.nodes.length - 1]);
  if (!a || !b) return ['한쪽 끝', '다른 끝'];
  if (Math.abs(a[1] - b[1]) >= Math.abs(a[0] - b[0]) * 0.8) return a[1] > b[1] ? ['북단', '남단'] : ['남단', '북단'];
  return a[0] < b[0] ? ['서단', '동단'] : ['동단', '서단'];
}

function openServiceEditor(line, cls, id = null) {
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
function extendServiceLine(name) {
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

function servicePlan() {
  const stops = svcEdit.nodes.filter((n) => svcEdit.stops.has(n));
  const links = effectiveNetwork(base, state).links;
  const plan = stops.length >= 2 ? planService(links, railStationSet(), stops, svcEdit.kind, new Set(svcEdit.lines), svcEdit.type) : null;
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

function bindService(el) {
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
function serviceSection(l) {
  const ec = lineEconomics().find((x) => x.name === l.name);
  const econ = ec ? `<p class="hint">이 노선: 연 수입 ${formatWon(ec.rev / 1e8)} · 비용 ${formatWon(ec.cost / 1e8)} · 영업계수 <b class="${ec.ratio > 100 ? 'neg' : ''}">${fmtRatio(ec.ratio)}</b></p>` : '';
  const diagram = '<button class="small" id="line-diagram">노선도 보기 (열차 위치·정차역·혼잡도)</button>';
  if (l.mode === 2) return `<h4>노선도 · 수익성</h4><div class="actions">${diagram}</div>${econ}<p class="hint">도시철도 이용객에는 같은 구 안의 짧은 이용(역세권 인구로 어림)이 들어 있습니다.</p>`;
  const list = (state.services || []).filter((s) => s.line === l.name || s.lines?.includes(l.name));
  return `<h4>노선도 · 운행 계통 · 수익성</h4><div class="actions">${diagram}
    <button class="small" id="st-start" title="두 역 사이를 단순한 곡선으로 새로 놓고 옛 구간은 폐선">구간 직선화 (두 역 고르기)</button></div>${econ}
    <div class="list">${list.map((s) => `<div class="item opt"><div class="opt-row">
      <span>${esc(s.name)} <span class="m">${s.name.includes(serviceBrand(s)) ? '' : `${esc(serviceBrand(s))} · `}${s.name.includes(SERVICE_KINDS[s.kind].label) ? "" : `${SERVICE_KINDS[s.kind].label} · `}${s.stops.length}개 역 · ${TRAIN_TYPES[s.type]?.label.split(' ')[0] || ''} ${s.sets}편성 · 하루 ${s.trains}회${s.built ? '' : ' · 차량 제작 중'}</span></span>
      ${opBadge(state, serviceOperator(s))} <button class="small" data-svc-edit="${s.id}">고치기</button></div></div>`).join('')}</div>
    <div class="actions"><button class="small primary svc-pick" title="설 역을 지도에서 차례로 눌러 계통을 만듭니다 (여러 노선을 지나도 됩니다)">새 운행 계통 짜기 (역 고르기)</button></div>`;
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
  const f = state.lineFreq?.[line] || 1;
  return Math.round(f * Math.min(300, Math.max(OPERATING.minTrains[c], 2 * Math.round(peak / (2 * OPERATING.paxPerTrain[c] * OPERATING.loadFactor)))));
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

function serviceOperator(s) {
  const under = s.segs.flatMap((seg) => seg.via.map((i) => linkAt(base, state, i)));
  const kp = under.filter((l) => l.kp).length;
  return operatorOf(state, { mode: 1, kp: kp * 2 > under.length ? 1 : 0 });
}

/** 노드가 국외 거점이면 그 나라 */
function foreignCountry(node) {
  return (base.foreignNodes || []).find((f) => f.node === node)?.country || null;
}

/** 계통의 열차 이름 (KTX·ITX-새마을·무궁화호, 국외로 가면 그 나라 열차) */
function serviceBrand(s) {
  const nn = nodeNames();
  const under = s.segs.flatMap((seg) => seg.via.map((i) => linkAt(base, state, i)));
  const country = s.stops.map(foreignCountry).find(Boolean) || null;
  return trainBrand({ type: s.type, kind: s.kind, cls: s.cls, km: s.km, stops: s.stops.map((n) => nn.get(n)?.name), conv: under.some((l) => l.cls === 'conv'), op: serviceOperator(s), country }).short;
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
function intlTrainsHTML() {
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
function resolveWaypoint([name, lon, lat], mode, motorwayEnd = false) {
  // 고속도로 계획의 양 끝은 8km 안의 기존 고속도로 노드에 붙인다 (남북 연결 고속도로가 기존 고속도로와 이어지게)
  if (mode === 0 && motorwayEnd) {
    let best = null, bd = 8;
    allLinks().forEach((l, i) => {
      const e = linkAt(base, state, i);
      if (e.mode !== 0 || e.cls !== 'motorway' || e.ext) return;
      for (const n of [e.a, e.b]) {
        const c = nodeCoord(n);
        const d = c ? kmBetween(lon, lat, c[0], c[1]) : Infinity;
        if (d < bd) { bd = d; best = n; }
      }
    });
    if (best != null) return best;
  }
  // 이름이 같은 기존 역: 같은 종류 철도는 6km 안, 다른 종류(일반철도↔도시철도)는 1km 안이면 그 역에 바로 붙는다.
  // 다른 종류 역에 붙으면 같은 노드라 저절로 환승역이 된다 (예전에는 그 옆에 같은 이름 역을 하나 더 만들었다: 신분당선 용산 등)
  const lists = mode === 2 ? [[base.metro_stations || [], 6], [base.stations, 1]] : mode === 1 ? [[base.stations, 6], [base.metro_stations || [], 1]] : [];
  for (const [list, maxKm] of lists) {
    let best = null, bd = maxKm;
    for (const [nm, node] of list) {
      if (nm !== name && nm !== `${name}역` && nm.replace(/역$/, '') !== name) continue;
      const c = nodeCoord(node);
      const d = kmBetween(lon, lat, c[0], c[1]);
      if (d < bd) { bd = d; best = node; }
    }
    if (best != null) return best;
  }
  // 이름은 달라도 기존 역 바로 그 자리(150m 안)면 그 역이다 (CTX 정부대전청사 = 대전 1호선 정부청사 등)
  if (mode >= 1) {
    let best = null, bd = 0.15;
    for (const [list] of lists) for (const [, node] of list) {
      const c = nodeCoord(node);
      if (!c || Math.abs(c[1] - lat) > 0.01) continue;
      const d = kmBetween(lon, lat, c[0], c[1]);
      if (d < bd) { bd = d; best = node; }
    }
    if (best != null) return best;
  }
  // 이름이 같은 역이 없으면 새 역이다: 그 자리(250m 안)의 노드에만 붙인다.
  // 예전에는 1.5km 안의 아무 역에나 붙여, 서부선의 연희·명지대 등이 홍대입구·증산으로 바뀌어 노선이 엉뚱하게 그려졌다
  return nearestNode({ lng: lon, lat }, mode, null, mode === 0 ? 4 : name ? 0.25 : 1.5);
}

/** 예전 저장: 복원 사업 구간이 계획 이름으로 따로 놓였으면 이어지는 노선 이름으로 바꾼다 (계통이 경의선 → 평부선처럼 이어지게) */
function migratePlanLines() {
  if (!state) return;
  for (const p of state.projects) {
    const pl = p.plan && plans.find((x) => x.id === p.plan);
    if (!pl?.line) continue;
    for (const l of state.newLinks) if (l.name === pl.name) l.name = pl.line;
  }
}

/** 계획 노선을 그리기로 연다 (경유지가 찍힌 상태). 확인하고 고친 뒤 착공한다 */
function openPlan(id) {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return;
  startDraft(plan.type);
  const spec = NEW_BUILDS[plan.type];
  for (const wp of plan.points) {
    // 이름이 없는 경유점은 선형만 잡는 점 (역·IC를 만들지 않는다)
    if (wp[0] == null) { draft.points.push({ node: null, lon: wp[1], lat: wp[2], split: null, via: true }); continue; }
    const isEnd = wp === plan.points[0] || wp === plan.points[plan.points.length - 1];
    const node = resolveWaypoint(wp, spec.mode, isEnd && spec.attrs?.cls === 'motorway');
    const c = node != null ? nodeCoord(node) : [wp[1], wp[2]];
    const pt = { node, lon: c[0], lat: c[1], split: null };
    draft.points.push(pt);
    nameDraftPoint(pt, draft.points.length - 1);
    // 새 역이면 계획에 적힌 역 이름을 쓴다
    if (spec.mode >= 1 && !pt.existing && wp[0]) { if (pt.reserved) namer.release(pt.name, 'station'); pt.name = wp[0]; pt.auto = false; }
  }
  // 복원 사업처럼 기존 노선을 잇는 계획은 그 노선 이름을 이어 쓴다 (사업 이름은 계획 이름)
  draft.lineName = plan.line || plan.name;
  draft.lineNameEdited = true;
  if (plan.line) { draft.extendOf = plan.line; draft.planTitle = plan.name; }
  draft.plan = plan.id;
  // 철도는 계획 자료의 실제 정차역 목록 그대로, 도로는 기존 간선도로와 만나는 곳에 IC를 넣는다
  draft.planFilled = spec.mode === 0 ? fillPlanICs(plan.type) : 0;
  drawDraft();
  renderBuild();
  const xs = draft.points.map((p) => p.lon), ys = draft.points.map((p) => p.lat);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 11 });
}

/** 계획 노선 미리보기 선: 양 끝이 기존 역·노드면 그리기와 같이 그 노선에 접선으로 붙인다 */
function planPreviewLine(plan) {
  const spec = NEW_BUILDS[plan.type];
  if (!spec) return null;
  const pts = plan.points.map((wp, i) => {
    const end = i === 0 || i === plan.points.length - 1;
    const node = end && wp[0] != null ? resolveWaypoint(wp, spec.mode, spec.attrs?.cls === 'motorway') : null;
    const c = node != null ? nodeCoord(node) : [wp[1], wp[2]];
    return { node, lon: c[0], lat: c[1], split: null, via: wp[0] == null };
  });
  if (pts.length < 2) return null;
  return smoothSegments(withTangents(pts, spec.mode), 3).flatMap((sg, i) => (i ? sg.slice(1) : sg));
}

// 계획 노선(고속도로·국도)을 열 때 기존 간선도로와 만나는 곳에 넣는 IC 간격 (km). 철도 역은 계획 자료(plans.json)의 역 목록을 그대로 쓴다
const IC_SPACING = { motorway: 10, trunk: 6 };

/**
 * 그리기에 열린 도로 계획(draft)의 IC 사이를 채운다: 곡선이 기존 국도·지방도와 만나는 곳에 IC (그 도로에 바로 잇는다).
 * 큰 도로부터, 이미 있는 IC·끝점에서 간격의 0.8배 넘게 떨어진 곳만
 * @returns {number} 넣은 IC 수
 */
function fillPlanICs(type) {
  const gap = IC_SPACING[type];
  if (!gap || !draft || draft.points.length < 2) return 0;
  const segs = smoothSegments(draftPoints());
  const samples = [];
  let s = 0;
  segs.forEach((seg, i) => {
    seg.forEach((q, k) => {
      if (k) s += kmBetween(seg[k - 1][0], seg[k - 1][1], q[0], q[1]);
      samples.push({ i, x: q[0], y: q[1], s });
    });
  });
  const segStart = [];
  for (const sm of samples) if (segStart[sm.i] == null) segStart[sm.i] = sm.s;
  const taken = draft.points.map((p, i) => (p.via ? null : segStart[i] ?? s)).filter((v) => v != null);
  taken.push(s);
  const xs = samples.map((q) => q.x), ys = samples.map((q) => q.y);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const cands = [];
  allLinks().forEach((l, id) => {
    const e = linkAt(base, state, id);
    if (e.mode !== 0 || e.ext || !['trunk', 'primary', 'secondary'].includes(e.cls)) return;
    const g = l.geom;
    for (let k = 0; k + 3 < g.length; k += 2) {
      const ax = g[k], ay = g[k + 1], bx = g[k + 2], by = g[k + 3];
      if (Number.isNaN(ax) || Number.isNaN(bx) || Math.max(ax, bx) < bx0 || Math.min(ax, bx) > bx1 || Math.max(ay, by) < by0 || Math.min(ay, by) > by1) continue;
      for (let m = 0; m + 1 < samples.length; m++) {
        const p = samples[m], r = samples[m + 1];
        if (p.i !== r.i) continue;
        const d1x = r.x - p.x, d1y = r.y - p.y, d2x = bx - ax, d2y = by - ay;
        const den = d1x * d2y - d1y * d2x;
        if (!den) continue;
        const t = ((ax - p.x) * d2y - (ay - p.y) * d2x) / den, u = ((ax - p.x) * d1y - (ay - p.y) * d1x) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        cands.push({ q: { i: p.i, x: p.x + t * d1x, y: p.y + t * d1y, s: p.s + t * (r.s - p.s) }, w: { trunk: 3, primary: 2, secondary: 1 }[e.cls], link: id });
      }
    }
  });
  cands.sort((a, b) => b.w - a.w);
  const add = [];
  for (const c of cands) {
    if (taken.some((t) => Math.abs(t - c.q.s) < gap * 0.8)) continue;
    taken.push(c.q.s);
    add.push(c);
  }
  // 뒤에서부터 끼워야 앞 점 번호가 밀리지 않는다 (같은 구간 안에서는 먼 것부터)
  add.sort((a, b) => b.q.i - a.q.i || b.q.s - a.q.s);
  for (const c of add) {
    const pt = { node: null, lon: c.q.x, lat: c.q.y, split: c.link, inserted: true };
    draft.points.splice(c.q.i + 1, 0, pt);
    nameDraftPoint(pt, c.q.i + 1);
  }
  return add.length;
}

function plansHTML() {
  if (!plans.length) return '';
  const started = new Set([...state.projects.filter((p) => p.status !== 'cancelled').map((p) => p.plan).filter(Boolean), ...plansTakenByClosed()]);
  const groups = [...new Set(plans.map((p) => p.group))];
  return `<h4>계획 사업</h4>
    <p class="hint">국가·광역 교통계획(제4·5차 국가철도망 구축계획, 제3차 국가도로망 종합계획 등)에 나온 노선입니다. 계획 이름을 누르면 지도에 그 노선이 점선으로 보이고, 그 선이나 "열기"를 누르면 경유지가 찍힌 채로 그리기가 열립니다. 사업비를 확인한 뒤 착공합니다 (경로는 고칠 수 있습니다).</p>
    ${groups.map((g) => subFold(`plans:${g}`, `${esc(g)} <span class="cnt">${plans.filter((p) => p.group === g).length}</span>`, `<div class="list">${plans.filter((p) => p.group === g).map((p) => {
      let km = 0;
      for (let i = 1; i < p.points.length; i++) km += kmBetween(p.points[i - 1][1], p.points[i - 1][2], p.points[i][1], p.points[i][2]);
      const spec = NEW_BUILDS[p.type];
      return `<div class="item line"><div class="n" data-plan-show="${p.id}" style="cursor:pointer;${shownPlan === p.id ? 'text-decoration:underline' : ''}" title="지도에 노선 보기"><b>${esc(p.name)}</b><span class="m" title="${esc(p.source || '')}">${spec.label.replace(/ 신설.*$/, '')} · 약 ${Math.round(km * 1.1)}km · ${formatWon(km * 1.1 * spec.perKm)}${p.source ? ` · 출처: ${esc(p.source.split(' · 현황')[0].split(/[,(]/)[0].trim())}` : ''}</span>${p.appraisal ? `<span class="m" title="${esc(p.appraisal.note || '')}"> · 예비 평가 B/C <b class="${p.appraisal.bc >= 1 ? 'pos' : 'neg'}">${p.appraisal.bc.toFixed(2)}</b> · AHP <b class="${p.appraisal.ahp >= 0.5 ? 'pos' : 'neg'}">${p.appraisal.ahp.toFixed(2)}</b></span>` : ''}</div>
        <button class="small" data-plan="${p.id}" ${started.has(p.id) ? 'disabled' : ''}>${started.has(p.id) ? '착공함' : '열기'}</button></div>`;
    }).join('')}</div>`)).join('')}`;
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
  // 전국 바람: 선거마다 한쪽으로 쏠린다 (±6%p). 행정구역 개편 같은 보궐 성격 선거에는 약하게
  const mood = (rng() - 0.5) * (only === 'all' ? 0.12 : 0.06);
  for (const [r, zs] of regs) {
    if (Array.isArray(only) && !only.includes(r)) continue;
    if (only === 'kp' && !zs.some((i) => zoneProps[i].country === 'KP')) continue;
    let w = 0, s = 0;
    for (const i of zs) { const p = zonePop(i); w += p; s += p * leanP(zoneProps[i]); }
    const key = `g:${r}`, cur = L.offices[key];
    const res = runElection(w > 0 ? s / w : 0.5, cur, rng, mood);
    if (cur && cur.party === res.party) { cur.approval = 50 + (cur.approval - 50) / 2; cur.terms = (cur.terms || 1) + 1; kept++; }
    else L.offices[key] = { title: governorTitle(r), region: r, party: res.party, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
    L.offices[key].share = res.share;
    gov[res.party]++; total++;
    if (only === 'all' || only === 'kp' || Array.isArray(only)) {
      for (const i of zs) {
        if (Array.isArray(only)) break;   // 광역 단체만 새로 뽑는 경우 (행정구역 개편·독립)
        if (only === 'kp' && zoneProps[i].country !== 'KP') continue;
        if (countyRep(i) !== i) continue;   // 한 시군에 단체장은 하나 (옛 군 땅을 떼어 낸 계산용 조각은 몸통 단체장이 맡는다)
        may[electMayor(i, mood)]++;
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

/** 시군 단체장 선거 (존 i가 그 시군의 대표 존). 이긴 정당을 돌려준다 */
function electMayor(i, mood = 0) {
  const L = state.local, mk = `m:${i}`, mc = L.offices[mk];
  const rm = runElection(leanP(zoneProps[i]), mc, rng, mood);
  if (mc && mc.party === rm.party) { mc.approval = 50 + (mc.approval - 50) / 2; mc.terms = (mc.terms || 1) + 1; mc.title = countyTitle(zoneName(i), regionOf(state, zoneProps[i])); }
  else L.offices[mk] = { title: countyTitle(zoneName(i), regionOf(state, zoneProps[i])), zone: i, party: rm.party, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
  L.offices[mk].share = rm.share;
  return rm.party;
}

// 지도에서 한 시군으로 보이는 존들(countyKey가 같은 존)의 대표: 가장 넓은 존. 시군 단체장·제안은 대표 존 번호로 단다
let countyRepCache = null;
function countyRep(i) {
  const sig = JSON.stringify([state.local?.admin, state.local?.historic, state.local?.independent, state.adminNames, state.placeNames]);
  if (countyRepCache?.sig !== sig) {
    const best = new Map();
    zoneProps.forEach((z, j) => { const k = countyKey(j), b = best.get(k); if (b == null || (z.area || 0) > (zoneProps[b].area || 0)) best.set(k, j); });
    countyRepCache = { sig, rep: zoneProps.map((_, j) => best.get(countyKey(j))) };
  }
  return countyRepCache.rep[i];
}
function mayorKey(i) { return `m:${countyRep(i)}`; }
/** 존 i와 한 시군으로 보이는 존들 (옛 군 땅을 떼어 낸 조각 포함) */
function countyZones(i) { const r = countyRep(i); return zoneProps.map((_, j) => j).filter((j) => countyRep(j) === r); }

/** 행정구역을 바꾼 뒤 시군 단체장 정리: 대표가 아닌 존의 단체장은 없애고, 단체장이 없는 시군은 새로 뽑고, 직함은 지금 이름으로 */
function syncMayors() {
  const L = state.local;
  for (const k of Object.keys(L.offices)) {
    if (!k.startsWith('m:')) continue;
    const i = +k.slice(2);
    if (countyRep(i) !== i || !hasAutonomy(state, zoneProps[i])) { delete L.offices[k]; continue; }
    L.offices[k].title = countyTitle(zoneName(i), regionOf(state, zoneProps[i]));
  }
  for (const [, zs] of regions()) for (const i of zs) if (countyRep(i) === i && !L.offices[`m:${i}`]) electMayor(i);
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
    if (used.has(c.r) || !L.offices[mayorKey(c.zi)]) continue;
    if (add(mayorKey(c.zi), c)) n++;
  }
}

function acceptProposal(id) {
  const L = state.local, pr = L.proposals.find((p) => p.id === id);
  const r = startUpgrade(base, state, proposalCheck(pr).targets, pr.fix);
  if (!r.ok) { alert(r.reason); renderRequests(); return; }
  const proj = state.projects[state.projects.length - 1];
  proj.proposal = pr.id;
  pr.status = 'accepted';
  pr.decided = state.year;
  const off = L.offices[pr.office];
  if (off) { off.accepted++; bumpApproval(off, 3); }
  // 같은 구간의 확장 요구는 공사가 시작됐으므로 목록에서 뺀다
  const work = linksUnderWork(state);
  requests = requests.filter((q) => !q.links.every((lid) => work.has(lid)));
  toast(`<b>받아들임</b> ${esc(pr.title)} · ${formatWon(proj.cost)} · ${proj.doneYear}년 완공 예정 (사업 탭)`);
  save(state); refreshLinks(); renderAll();
}

function rejectProposal(id) {
  const L = state.local, pr = L.proposals.find((p) => p.id === id);
  pr.status = 'rejected';
  pr.decided = state.year;
  const off = L.offices[pr.office];
  if (off) bumpApproval(off, -4);
  toast(`<b>거절</b> ${esc(pr.title)}`, 'no');
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
/** 제안을 지금 받아들일 수 있는지: 이미 공사 중이거나 개량된 구간은 빼고 남는 구간·사업비 */
function proposalCheck(p) {
  const u = UPGRADES.find((x) => x.id === p.fix);
  const work = linksUnderWork(state);
  const targets = u ? p.links.filter((id) => !work.has(id) && u.applies(linkAt(base, state, id))) : [];
  const cost = targets.reduce((a, id) => a + upgradeCost(u, linkAt(base, state, id)), 0);
  return { targets, cost, years: u?.years || 1, afford: targets.length > 0 && canAfford(state, cost, u.years, fundFor(state, targets.map((id) => linkAt(base, state, id)))) };
}

function proposalsHTML() {
  const L = state.local;
  // 다른 경로로 이미 공사·개량이 된 제안은 조용히 닫는다 (거절이 아니므로 지지율은 그대로)
  for (const p of L.proposals) {
    if (p.status === 'open' && !proposalCheck(p).targets.length) { p.status = 'moot'; state.log.unshift(`${state.year}년 지자체 제안 종결 (이미 공사·개량됨): ${p.title}`); }
  }
  const open = L.proposals.filter((p) => p.status === 'open');
  // 올해 답한 제안은 그 자리에 결과 카드로 남긴다 (누른 뒤 무엇이 바뀌었는지 바로 보이게, 다음 해에 빠진다)
  const decided = L.proposals.filter((p) => p.decided === state.year && (p.status === 'accepted' || p.status === 'rejected'));
  const shown = L.proposals.filter((p) => p.status === 'open' || decided.includes(p));
  if (!open.length && !decided.length) return '';
  const doneRow = (p) => {
    const off = L.offices[p.office], proj = p.status === 'accepted' && state.projects.find((x) => x.proposal === p.id);
    return `<div class="item decided ${p.status}"><div class="t">${p.status === 'accepted' ? '✓ ' : ''}${esc(p.title)}</div>
      <div class="m">${off ? `${partyBadge(off.party)} ${esc(off.title)} · ` : ''}${p.status === 'accepted'
        ? `<span class="pos">받아들임 · 공사 시작${proj ? ` · ${proj.doneYear}년 완공 예정` : ''}</span>` : '<span class="neg">거절함</span>'}</div></div>`;
  };
  return `<h3>지자체 SOC 제안 (${open.length})</h3>
    <p class="hint">선거로 뽑힌 단체장이 자기 지역 사업을 중앙정부에 제안합니다. 받아들여 완공하면 그 단체장의 지지율이 올라 재선에 유리합니다. 2년 안에 답하지 않으면 거절한 것으로 봅니다.</p>
    ${decided.length ? `<p class="hint">올해 답한 제안 ${decided.length}건: 받아들인 사업은 사업 탭에서 공사 진행을 볼 수 있습니다.</p>` : ''}
    <div class="list">${shown.map((p) => {
      if (p.status !== 'open') return doneRow(p);
      const off = L.offices[p.office], ck = proposalCheck(p);
      const partial = ck.targets.length < p.links.length ? ` · 일부 구간(${ck.targets.length}/${p.links.length})은 이미 공사 중` : '';
      return `<div class="item"><div class="t">${esc(p.title)}</div>
        <div class="m">${off ? `${partyBadge(off.party)} ${esc(off.title)}` : ''} · ${p.year}년 제안 · ${formatWon(ck.cost)}${partial}</div>
        <div class="actions"><button class="small primary" data-prop-ok="${p.id}" ${ck.afford ? '' : 'disabled title="예산과 차입 한도가 부족합니다"'}>${ck.afford ? '받아들이기' : '받아들이기 (예산 부족)'}</button>
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
  // 복원 뒤에는 북측 옛 직할시(평양·남포)를 다시 독립시킬 수 있고, 모든 도의 인구 50만 이상 시를 광역시로 승격할 수 있다
  // (북측 도시는 지방자치를 도입한 뒤: 시장을 선거로 뽑으므로)
  const promotable = [
    ...(L.historic ? HISTORIC_CITIES.filter((c) => !L.independent.includes(c) && zoneProps.some((z) => z.province === c)) : []),
    ...[...pops].filter(([n, p]) => p >= PROMOTE_MIN_POP && /시$/.test(n) && !isMetroCity(n) && !L.independent.includes(n)
      && zoneProps.some((z) => z.name === n && !z.ext && (z.country === 'KR' || L.autonomyKP) && !isMetroCity(z.province))).map(([n]) => n),
  ];
  const next = state.year < ELECTION.firstYear ? ELECTION.firstYear
    : ELECTION.firstYear + Math.ceil((state.year - ELECTION.firstYear + 1) / ELECTION.every) * ELECTION.every;
  return `<h4>지방자치</h4>
    <p class="hint">남측은 지방자치가 시행 중이고, 4년마다(다음: ${next}년) 광역·기초단체장 선거가 열립니다.</p>
    ${L.autonomyKP ? '<p class="hint">북측 지방자치 시행 중.</p>' : `<div class="item"><div class="t">북측 지방자치 도입</div>
      <div class="m">북측에도 도지사·시장·군수를 선거로 뽑습니다. 남북 통합도 30% 이상 · ${formatWon(EVENT_COST.autonomy)}</div>
      <button class="small primary" id="ev-autonomy" ${state.integration >= 0.3 ? '' : 'disabled'}>도입</button></div>`}
    ${adminSummaryHTML()}
    ${state.linesRenamed ? '<p class="hint">북측 노선 이름을 남측 기준으로 바꿨습니다.</p>' : `<div class="item"><div class="t">북측 노선 이름을 남측 기준으로</div>
      <div class="m">${Object.entries(KP_LINE_RENAME).map(([a, b]) => `${esc(a)}→${esc(b)}`).join(', ')}. 남북을 잇는 노선이 한 이름이 되어 직통 계통·노선도·수익성이 한 노선으로 묶입니다 · ${formatWon(LINE_RENAME_COST)}</div>
      <button class="small primary" id="ev-rename">바꾸기</button></div>`}
    <div class="item"><div class="t">광역시 독립·승격</div>
      <div class="m">${L.historic ? '북측 옛 직할시(평양·남포)를 도에서 다시 떼어 내거나, ' : ''}인구 ${PROMOTE_MIN_POP / 1e4}만 이상 시를 도에서 떼어 광역시로 만듭니다. 시장을 따로 뽑습니다 · 한 곳 ${formatWon(EVENT_COST.independence)}</div>
      <div class="row" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${promotable.map((c) => `<button class="small" data-ev-city="${esc(c)}">${esc(c)}</button>`).join('') || '<span class="m">대상 도시가 없습니다.</span>'}</div>
      ${L.independent.length ? `<div class="m" style="margin-top:4px">독립·승격한 도시: ${L.independent.map(esc).join(', ')}</div>` : ''}</div>`;
}

/** 건설 탭: 국가 대형 사업 목록 (착공 전·공사 중·완공). 선형 보기·효과 미리보기·착공 */
function megaHTML() {
  return `<h4>국가 대형 사업</h4>
    <p class="hint">해마다 예산을 들여 짓는 국가 단위 사업입니다. 선형을 지도에서 보고, 다 지었을 때의 효과와 예비타당성 평가를 미리 볼 수 있습니다.</p>
    <div class="list">${MEGA.map((m) => {
    const p = state.projects.find((x) => x.kind === 'mega' && x.mega === m.id);
    const status = state.mega?.[m.id] ? `<span class="pos">${state.mega[m.id]}년 완공</span>`
      : p ? `공사 중 · ${p.doneYear}년 완공 예정`
      : `<button class="small primary" data-mega="${m.id}" ${m.ready(state) ? '' : 'disabled'}>착공 ${formatWon(m.cost)} · ${m.years}년</button>
        <button class="small" data-mega-prev="${m.id}">효과 미리보기</button>${m.ready(state) || !m.need ? '' : ` <span class="m">조건: ${esc(m.need)}</span>`}`;
    return `<div class="item"><div class="t">${esc(m.name)} <button class="small" data-mega-show="${m.id}">선형 보기</button></div>
      <div class="m">${esc(m.desc)}${m.id === 'tsr' ? ` 화물 수입 연 ${formatWon(TSR_FREIGHT)}.` : ''}</div><div class="row" style="display:flex;gap:4px;flex-wrap:wrap">${status}</div></div>`;
  }).join('')}</div>`;
}

function bindMega(el) {
  el.querySelectorAll('[data-mega]').forEach((b) => {
    b.onclick = () => {
      const m = MEGA.find((x) => x.id === b.dataset.mega);
      if (!confirm(`${m.label}을(를) 착공할까요?
${formatWon(m.cost)} · ${m.years}년 (해마다 ${formatWon(m.cost / m.years)})`)) return;
      const r = startMega(state, m.id);
      if (!r.ok) { alert(r.reason); return; }
      save(state); renderAll();
    };
  });
  el.querySelectorAll('[data-mega-show]').forEach((b) => { b.onclick = () => showMegaLine(b.dataset.megaShow); });
  el.querySelectorAll('[data-mega-prev]').forEach((b) => { b.onclick = () => previewMega(b.dataset.megaPrev); });
}

/** 대형 사업 선형을 지도에 그리고 그쪽으로 옮긴다 */
function showMegaLine(id) {
  const g = megaGeometry(base, id);
  if (!g) return;
  const line = smoothSegments(g.coords.map(([lon, lat]) => ({ lon, lat }))).flatMap((seg, i) => (i ? seg.slice(1) : seg));
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } },
    ...[g.coords[0], g.coords[g.coords.length - 1]].map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })),
  ] });
  const xs = line.map((c) => c[0]), ys = line.map((c) => c[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 10 });
  return g;
}

function previewMega(id) {
  const m = MEGA.find((x) => x.id === id);
  const g = showMegaLine(id);
  if (!m || !g) return;
  const km = id === 'kj-tunnel' ? 230 : id === 'jeju-hsr' ? 167 : polylineKm(g.coords);
  runPreview(`${m.name} 미리보기`, (c) => applyMega(base, c, id),
    { kind: 'mega', cost: m.cost, years: m.years, km, cls: 'hsr', mode: 1, plan: true, border: id === 'tsr' });
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
  el.querySelector('#ev-admin')?.addEventListener('click', () => adminSetup(false));
  el.querySelector('#ev-rename')?.addEventListener('click', () => {
    const r = renameKPLines(base, state);
    if (!r.ok) { alert(r.reason); return; }
    save(state); refreshLinks(); renderAll();
  });
  el.querySelectorAll('[data-ev-city]').forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.evCity;
      if (!payEvent(EVENT_COST.independence)) return;
      // 도시가 빠진 도와 새 광역시의 단체장을 다시 뽑는다
      const zc = zoneProps.find((z) => z.province === c || z.name === c);
      const parent = zc ? regionOf(state, zc) : null;
      L.independent.push(c);
      holdElection([metroName(c), parent].filter(Boolean), `${metroName(c)} ${L.historic ? '독립' : '광역시 승격'} 선거`);
      syncMayors();   // 승격한 도시 전체인 시군의 단체장은 구청장으로
      save(state); renderAll();
    };
  });
}

// ------------------------------------------------------------ 통일 첫해 행정구역 정리 (게임 시작 창)

// 북측 도 체계는 행정구역 정리 창의 한 칸 (예전에는 따로 돈을 내는 이벤트였다)
const HISTORIC_PROV = { key: '_historic', label: '북측 도 체계', choices: [['keep', '지금 북측 도 그대로 (자강·량강·평양 등)'], ['historic', '1945년 이전 도로 되돌린다 (강원북도·강원남도, 개성은 경기도)']] };
const HIST_KEYS = new Set(HISTORIC_COUNTIES.map((h) => h.key));

function needsAdminSetup() {
  return state.year === START_YEAR && !state.local?.adminDecided;
}

/** 행정구역 정리 창. first: 게임을 막 시작한 때 (닫으면 사용법 안내로 이어진다) */
function adminSetup(first) {
  const L = initLocal(state);
  const cur = { ...ADMIN_DEFAULT, ...(L.admin || {}), _historic: L.historic ? 'historic' : 'keep', _goal: state.goal || 'none' };
  const pick = (keys) => ADMIN_OPTIONS.filter((o) => keys.includes(o.key));
  openAdminSetup({
    esc, current: cur, defaults: { ...ADMIN_DEFAULT, _historic: 'keep', _goal: 'none' },
    title: t(`${START_YEAR}년, 통일 첫해 행정구역 정리`, `${START_YEAR}: administrative boundaries after reunification`),
    intro: t('남과 북의 행정구역을 어떻게 맞출지 지금 정합니다. 비용은 들지 않고, 정한 뒤에도 '
      + `${START_YEAR}년 안에는 민원·정책 탭에서 다시 고칠 수 있습니다. 다음 해로 넘기면 그대로 굳습니다. 소속 광역 단체가 바뀐 곳은 단체장을 새로 뽑습니다.`,
    `Decide how to merge the administrative divisions of North and South. It is free, and you can change it from the Policy tab until the end of ${START_YEAR}; after that it is fixed. Provinces whose make-up changes elect new governors. (Place names stay in Korean.)`),
    okLabel: first ? t('정하고 시작하기', 'Confirm and start') : t('이대로 정리', 'Apply'),
    groups: [
      { title: t('이번 판의 목표', 'Goal for this game'), hint: t(`통일 10년째(${START_YEAR + 10}년) 결산에서 달성했는지 봅니다. 현황 탭에서 진행 상황을 볼 수 있습니다.`, `Checked in the ${START_YEAR + 10} summary, ten years after reunification. Track progress in the Overview tab.`),
        options: [{ key: '_goal', label: t('목표', 'Goal'), choices: Object.entries(GOALS).map(([k, g]) => [k, g.label]) }] },
      { title: t('남북 정리', 'North–South'), options: pick(['kaesong', 'propaganda', 'workers', 'ongjin', 'goseong', 'dueum']) },
      { title: t('북측 도 체계', 'Northern provinces'), options: [HISTORIC_PROV, ...pick(['jagang'])] },
      { title: t('분단 전 군 되살리기', 'Restore pre-division counties'), hint: t('분단으로 갈라지거나 없어진 군입니다. 되살리면 그 군에 속했던 읍면이 옛 군 이름으로 한 도에 묶입니다.', 'Counties split or abolished by the division. Restoring one regroups its old townships under the old name in one province.'),
        options: ADMIN_OPTIONS.filter((o) => HIST_KEYS.has(o.key)) },
    ],
    onApply: (c) => {
      const { _historic: hist, _goal: goal, ...admin } = c;
      state.goal = goal;
      const was = cur;
      const changed = ADMIN_OPTIONS.filter((o) => admin[o.key] !== was[o.key]);
      const histChanged = (hist === 'historic') !== !!L.historic;
      const lines = changed.map((o) => o.choices.find((x) => x[0] === admin[o.key])[1]);
      if (histChanged) lines.push(hist === 'historic' ? '북측 도를 1945년 이전으로' : '북측 도를 지금대로');
      if (lines.length) {
        reorganize(() => {
          setAdmin(admin);
          if (histChanged) {
            // 1945년 이전 도로 되돌리면 북측 주민 행복도가 조금 오른다 (되돌리면 그만큼 뺀다)
            const d = hist === 'historic' ? 3 : -3;
            zoneProps.forEach((z, i) => { if (z.country === 'KP' && !z.ext) state.happyBonus[i] = (state.happyBonus[i] || 0) + d; });
            L.historic = hist === 'historic';
          }
        }, `${state.year}년 행정구역 정리: ${lines.join(', ')}`);
        refreshNames(map);
      }
      L.adminDecided = true;
      save(state); renderAll();
      if (first && guideShouldAutoShow()) setTimeout(showGuide, 300);
    },
    onClose: first ? null : () => {},
  });
}

/** 민원·정책 탭: 정한 행정구역 (첫해에는 다시 정하기 단추) */
function adminSummaryHTML() {
  const L = initLocal(state);
  const A = { ...ADMIN_DEFAULT, ...(L.admin || {}) };
  const chosen = ADMIN_OPTIONS.filter((o) => A[o.key] !== ADMIN_DEFAULT[o.key]).map((o) => `${esc(o.label.replace(/ \(.*\)$/, ''))}: ${esc(o.choices.find((c) => c[0] === A[o.key])?.[1] || '')}`);
  if (L.historic) chosen.unshift('북측 도: 1945년 이전으로 되돌림 (강원북도·강원남도)');
  const open = state.year === START_YEAR;
  return `<div class="item"><div class="t">남북 행정구역 정리 (${START_YEAR}년)</div>
    <div class="m">${chosen.length ? chosen.join('<br>') : '모두 지금 행정구역 그대로 두었습니다.'}</div>
    ${open ? `<button class="small primary" id="ev-admin">다시 정하기 (${START_YEAR}년 안에만)</button>` : `<p class="hint">행정구역은 통일 첫해(${START_YEAR}년)에 정했습니다.</p>`}</div>`;
}

/** 행정구역 정리 적용: 소속은 regionOf가, 이름은 state.adminNames가 맡는다 */
function setAdmin(admin) {
  initLocal(state).admin = { ...ADMIN_DEFAULT, ...admin };
  state.adminNames = adminNames(state.local.admin, zoneProps, historic);
}

/** 광역 단체 구성을 바꾸고, 구성(소속 시군구)이 바뀐 단체만 단체장을 새로 뽑는다.
 *  이름만 바뀐 단체(강원특별자치도 → 강원남도)는 단체장을 그대로 이어 간다 */
function reorganize(change, logMsg) {
  const L = state.local;
  const key = (m) => new Map([...m].map(([r, zs]) => [r, zs.join(',')]));
  const before = key(regions());
  change();
  // 이름만 바뀐 단체(강원특별자치도 → 강원남도)는 단체장을 그대로 이어 간다
  const byZones = new Map([...before].map(([r, zs]) => [zs, r]));
  const changed = [];
  for (const [r, zs] of key(regions())) {
    if (before.get(r) === zs) continue;
    const old = byZones.get(zs), off = old && L.offices[`g:${old}`];
    if (off) {
      L.offices[`g:${r}`] = { ...off, region: r, title: governorTitle(r) };
      delete L.offices[`g:${old}`];
      for (const pr of L.proposals || []) if (pr.office === `g:${old}`) pr.office = `g:${r}`;
    } else changed.push(r);
  }
  for (const k of Object.keys(L.offices)) if (k.startsWith('g:') && !regions().has(k.slice(2))) delete L.offices[k];
  holdElection(changed, '행정구역 개편 뒤 광역단체장 선거');
  syncMayors();
  if (result && map) paintZones();   // 한 시군 한 색: 묶음이 바뀌었다
  state.log.unshift(logMsg);
  save(state); renderAll();
}

/** 존 패널: 광역·기초 단체장 */
function localZoneHTML(i) {
  const z = zoneProps[i];
  if (z.ext) return '';
  const L = state.local, r = regionOf(state, z);
  return `<h4>지방자치 · ${esc(r)}</h4>
    <div class="m" style="margin:2px 0">${officeLine(L.offices[`g:${r}`])}</div>
    <div class="m" style="margin:2px 0">${officeLine(L.offices[mayorKey(i)])}</div>`;
}

/** 정당 지도 값: 국민의힘 1, 민주당 0, 미시행 null */
function partyValue(i, level) {
  const L = state.local, z = zoneProps[i];
  const off = level === 'gov' ? L.offices[`g:${regionOf(state, z)}`] : L.offices[mayorKey(i)];
  return off ? (off.party === 'P' ? 1 : 0) : null;
}

// ------------------------------------------------------------ 구간 직선화 (두 역 사이를 가장 단순한 곡선으로)

let straight = null;   // {line, cls, picks: [역 노드], plan}

function startStraighten(linkId, preset = null) {
  const l = linkId != null ? linkAt(base, state, linkId) : null;
  cancelDraft();
  straight = { line: preset?.line ?? l?.name, cls: preset?.cls ?? l?.cls, picks: preset?.picks ? [...preset.picks] : [], plan: null, modes: new Map() };
  warmPreview();
  map.getCanvas().style.cursor = 'crosshair';
  if (straight.picks.length === 2) { straight.plan = planStraighten(); drawStraighten(); }
  select({ type: 'straighten' });
}

function endStraighten() {
  document.querySelector('.st-menu')?.remove();
  straight = null;
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  if (selection?.type === 'straighten') select(null);
}

/** 노선 위의 역 가운데 누른 곳에서 가장 가까운 역 (화면 30px 안) */
function straightenClick(ll) {
  // 두 역을 고른 뒤에는 사이의 역을 누르면 처리(자동·제자리 유지·폐역)를 고르는 메뉴를 띄운다
  if (straight.plan) {
    const p0 = map.project(ll);
    let hit = null, hd = 24;
    // 사이 역은 원래 자리와, 미리보기에서 새 선로 위로 옮겨 그린 자리 어느 쪽을 눌러도 잡는다
    const keptPos = new Map(straight.plan.kept.flatMap((k) => [[k.node, k.pos], ...(k.merged || []).map((m) => [m.node, k.pos])]));
    for (const m of straight.plan.mids) {
      for (const c of [nodeCoord(m.node), keptPos.get(m.node)]) {
        if (!c) continue;
        const q = map.project(c);
        const d = Math.hypot(q.x - p0.x, q.y - p0.y);
        if (d < hd) { hd = d; hit = m; }
      }
    }
    if (hit) { straightMenu(hit, p0); return; }
    // 두 역을 고른 뒤에는 양 끝 역이 아닌 곳을 눌러도 고른 구간을 지우지 않는다 (사이 역을 고르려다 잘못 누른 것)
    const ends = straight.picks.map((n) => map.project(nodeCoord(n)));
    if (!ends.some((q) => Math.hypot(q.x - p0.x, q.y - p0.y) < 30)) return;
  }
  // 같은 노선의 역을 고르고, 둘째 역은 이어진 다른 노선의 역도 고를 수 있다 (평부선–경의선처럼 남북 연결 구간)
  const stSet = railStationSet();
  const stations = new Set();
  allLinks().forEach((l, i) => {
    const e = linkAt(base, state, i);
    if (e.mode === 1 && (e.name === straight.line || straight.picks.length === 1)) for (const n of [e.a, e.b]) if (stSet.has(n)) stations.add(n);
  });
  const p = map.project(ll);
  let best = null, bd = 30;
  for (const n of stations) {
    const q = map.project(nodeCoord(n));
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = n; }
  }
  if (best == null) return;
  if (straight.picks.length >= 2) { straight.picks = []; straight.modes = new Map(); }
  if (!straight.picks.includes(best)) straight.picks.push(best);
  straight.plan = straight.picks.length === 2 ? planStraighten() : null;
  drawStraighten();
  renderSelection();
}

const ST_MODES = [['auto', '자동 (새 선로 위로 옮김)'], ['pin', '제자리 유지 (접선으로 지나감)'], ['drop', '폐역']];

/** 직선화 사이 역의 처리 메뉴: 누른 역 곁에 띄운다 */
function straightMenu(m, pt) {
  document.querySelector('.st-menu')?.remove();
  const el = document.createElement('div');
  el.className = 'st-menu';
  const cur = straight.modes.get(m.node) || 'auto';
  el.innerHTML = `<div class="t">${esc(m.name)}</div>${ST_MODES.map(([k, label]) => `<button class="small ${k === cur ? 'on' : ''}" data-st-mode="${k}">${label}</button>`).join('')}`;
  const box = map.getContainer().getBoundingClientRect();
  Object.assign(el.style, { left: `${Math.min(box.left + pt.x + 12, window.innerWidth - 220)}px`, top: `${Math.min(box.top + pt.y + 12, window.innerHeight - 140)}px` });
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  el.querySelectorAll('[data-st-mode]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.stMode === 'auto') straight.modes.delete(m.node); else straight.modes.set(m.node, b.dataset.stMode);
      close();
      straight.plan = planStraighten();
      drawStraighten(); renderSelection();
    };
  });
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
  // 두 역이 서로 다른 노선이면 두 노선을 함께 따라간다
  const lines = new Set([straight.line, ...linesAt(A).map((x) => x.name), ...linesAt(B).map((x) => x.name)].filter(Boolean));
  const via = railPath(net.links, A, B, lines);
  if (!via || !via.length) return null;
  const oldKm = via.reduce((s, i) => s + net.links[i].len, 0);
  const oldMin = via.reduce((s, i) => s + (net.links[i].len / net.links[i].speed) * 60, 0);
  const path = pathCoords(net.links, via, A);
  const pa = nodeCoord(A), pb = nodeCoord(B);
  const N = 200;
  // 양 끝에서 이어지는 바깥 선로(직선화하지 않는 쪽)의 접선: 새 선형이 그 방향으로 들어오고 나간다
  const viaSet = new Set(via);
  const outer = allLinks().map((_, i) => (viaSet.has(i) || state.replaced?.[i] ? null : linkAt(base, state, i)));
  const okRail = (l) => l.mode === 1 && !l.ext && !l.replaced;
  const chordDir = unitDir(pa, pb);
  const tA = branchTangent(trackHeadings(outer, nodeCoord, { node: A, lon: pa[0], lat: pa[1] }, okRail), chordDir);
  const tB = branchTangent(trackHeadings(outer, nodeCoord, { node: B, lon: pb[0], lat: pb[1] }, okRail), chordDir);
  // 어느 후보든 길이를 따라 고르게 n+1개 점으로 다시 찍는다 (곡률·역 위치 계산이 점 번호를 쓴다)
  const resample = (c, n = N) => {
    const cum = [0];
    for (let k = 1; k < c.length; k++) cum.push(cum[k - 1] + kmBetween(c[k - 1][0], c[k - 1][1], c[k][0], c[k][1]));
    const total = cum[cum.length - 1] || 1e-9, out = [];
    let j = 0;
    for (let k = 0; k <= n; k++) {
      const d = (total * k) / n;
      while (j + 1 < cum.length - 1 && cum[j + 1] < d) j++;
      const t = Math.min(1, Math.max(0, (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j])));
      out.push([c[j][0] + t * (c[j + 1][0] - c[j][0]), c[j][1] + t * (c[j + 1][1] - c[j][1])]);
    }
    return out;
  };
  const offLand = (c) => { let n = 0; for (let k = 0; k < c.length; k += 4) if (!onLand(c[k][0], c[k][1])) n++; return n / Math.ceil(c.length / 4); };
  // 옛 경로에서 점 q에 가장 가까운 점 번호
  const nearestIdx = (q) => { let bk = 0, bd = Infinity; path.forEach((p, k) => { const d = kmBetween(q[0], q[1], p[0], p[1]); if (d < bd) { bd = d; bk = k; } }); return bk; };

  /**
   * 두 닻(역) 사이 한 토막: 옛 경로가 두 점을 잇는 직선에서 많이 벗어나지 않으면 직선, 아니면 옛 경로 가운데를 향해 한 번 휜 곡선.
   * 끝 접선(ta: u에서 떠나는 방향, tb: v로 들어오는 방향, [동, 북])이 있으면 그 방향으로 나가고 들어온다
   */
  const segCurve = (pu, pv, ta, tb, sub) => {
    const chord = kmBetween(pu[0], pu[1], pv[0], pv[1]);
    const subKm = polylineKm(sub);
    let acc = 0, mid = sub[0], dev = 0;
    for (let k = 1; k < sub.length; k++) {
      const d = kmBetween(sub[k - 1][0], sub[k - 1][1], sub[k][0], sub[k][1]);
      if (acc < subKm / 2 && acc + d >= subKm / 2) mid = sub[k];
      acc += d;
    }
    const m0 = [(pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2];
    for (const q of sub) dev = Math.max(dev, distToSegKm(q, pu, pv));
    const cTip = [2 * mid[0] - m0[0], 2 * mid[1] - m0[1]];
    const bezier = (bow) => {
      const c = [m0[0] + bow * (cTip[0] - m0[0]), m0[1] + bow * (cTip[1] - m0[1])];
      // 2차 곡선을 3차로 올린 뒤, 끝 접선이 있으면 제어점 방향만 기존 선로 쪽으로 돌린다 (길이는 그대로)
      const ctl = (p, q, t, sgn) => {
        const v = [(2 / 3) * (q[0] - p[0]), (2 / 3) * (q[1] - p[1])];
        if (!t) return [p[0] + v[0], p[1] + v[1]];
        const ck = Math.cos((p[1] * Math.PI) / 180);
        const len = Math.max(Math.hypot(v[0] * ck, v[1]), (chord / 3) / 111);
        return [p[0] + (sgn * t[0] * len) / ck, p[1] + sgn * t[1] * len];
      };
      const c1 = ctl(pu, c, ta, 1), c2 = ctl(pv, c, tb, -1);
      return Array.from({ length: N + 1 }, (_, k) => {
        const t = k / N, u = 1 - t;
        return [u ** 3 * pu[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * pv[0], u ** 3 * pu[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * pv[1]];
      });
    };
    const smoothSub = () => {
      // 옛 경로를 약 1km 간격으로 솎은 뒤 두 번 다듬는다 (작은 굽이만 편다)
      const pts = [sub[0]];
      let a2 = 0;
      for (let k = 1; k < sub.length; k++) {
        a2 += kmBetween(sub[k - 1][0], sub[k - 1][1], sub[k][0], sub[k][1]);
        if (a2 >= 1) { pts.push(sub[k]); a2 = 0; }
      }
      pts.push(sub[sub.length - 1]);
      let q = pts;
      for (let it = 0; it < 2; it++) {
        const r = [q[0]];
        for (let k = 0; k + 1 < q.length; k++) r.push([0.75 * q[k][0] + 0.25 * q[k + 1][0], 0.75 * q[k][1] + 0.25 * q[k + 1][1]], [0.25 * q[k][0] + 0.75 * q[k + 1][0], 0.25 * q[k][1] + 0.75 * q[k + 1][1]]);
        r.push(q[q.length - 1]);
        q = r;
      }
      return q;
    };
    const cands = [];
    if (dev > 0.08 * chord) cands.push(['한 번 휜 곡선', bezier(0.6)], ['완만하게 휜 곡선', bezier(0.3)]);
    cands.push(['직선', bezier(0)], ['옛 경로를 따라 다듬은 선형', resample(sub.length > 1 ? smoothSub() : [pu, pv])]);
    for (const [label, c] of cands) {
      const km = polylineKm(c) * 1.02;
      if (offLand(c) <= 0.02 && (km < subKm * 0.98 || label.startsWith('옛'))) return { label, curve: c, subKm };
    }
    return { label: cands[cands.length - 1][0], curve: cands[cands.length - 1][1], subKm };
  };

  // 사이의 역: 옛 경로 순서대로. 사용자가 고른 처리(자동: 새 선로 위로 · 제자리 유지 · 폐역)
  const stSet = railStationSet(), riders = stationRiders();
  const mids = [];
  let node = A;
  for (const i of via) { const l = net.links[i]; node = l.a === node ? l.b : l.a; if (node !== B && stSet.has(node)) mids.push(node); }
  const modeOf = (n) => straight.modes?.get(n) || 'auto';
  // 제자리 유지 역에서 토막을 나눈다: 그 역의 옛 선로 진행 방향(접선)으로 들어가고 나온다
  const anchors = [{ node: A, pos: pa, k: 0, tIn: null, tOut: tA }];
  for (const n of mids) {
    if (modeOf(n) !== 'pin') continue;
    const c = nodeCoord(n), k = nearestIdx(c);
    if (k <= anchors[anchors.length - 1].k) continue;
    const p0 = path[Math.max(0, k - 1)], p1 = path[Math.min(path.length - 1, k + 1)];
    const t = unitDir(p0, p1);
    anchors.push({ node: n, pos: c, k, tIn: t, tOut: t });
  }
  anchors.push({ node: B, pos: pb, k: path.length - 1, tIn: tB, tOut: null });
  const segs = [];
  for (let s = 0; s + 1 < anchors.length; s++) {
    const u = anchors[s], v = anchors[s + 1];
    const sub = path.slice(u.k, v.k + 1);
    if (sub.length < 2) sub.push(v.pos);
    sub[0] = u.pos; sub[sub.length - 1] = v.pos;
    segs.push(segCurve(u.pos, v.pos, u.tOut, v.tIn, sub));
  }
  const joined = segs.flatMap((sg, i) => (i ? sg.curve.slice(1) : sg.curve));
  const curve = resample(joined);
  const shape = segs.length === 1 ? segs[0].label : `${segs.length}토막 (${[...new Set(segs.map((sg) => sg.label))].join('·')})`;
  const seaShare = offLand(curve);
  const ctrl = segs.some((sg) => sg.label.includes('휜'));
  const smoothed = segs.every((sg) => sg.label.startsWith('옛'));
  // 옛 경로를 다듬은 선형은 옛 선로보다 길어지지 않는다 (작은 굽이만 편다)
  const newKm = segs.reduce((acc, sg) => acc + (sg.label.startsWith('옛') ? Math.min(polylineKm(sg.curve), sg.subKm * 0.99) : polylineKm(sg.curve) * 1.02), 0);
  // 곡선 반경으로 낼 수 있는 속도 (v ≈ 4.7 √R, R은 m)
  let minR = Infinity;
  for (let k = 1; k < N; k++) {
    const a = curve[k - 1], b = curve[k], c = curve[k + 1];
    const ab = kmBetween(a[0], a[1], b[0], b[1]), bc = kmBetween(b[0], b[1], c[0], c[1]), ac = kmBetween(a[0], a[1], c[0], c[1]);
    const s = (ab + bc + ac) / 2, area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ac)));
    if (area > 1e-12) minR = Math.min(minR, (ab * bc * ac) / (4 * area) * 1000);
  }
  const vmax = straight.cls === 'hsr' ? 300 : 200;
  const oldSpeed = Math.max(...via.map((i) => net.links[i].speed));
  let speed = Math.round(Math.min(vmax, isFinite(minR) ? 4.7 * Math.sqrt(minR) : vmax) / 10) * 10;
  if (smoothed) speed = Math.max(speed, Math.min(vmax, oldSpeed + 20));   // 다듬은 만큼은 옛 선로보다 빠르다
  const nn = nodeNames();
  const proj = mids.filter((n) => modeOf(n) !== 'drop').map((n) => {
    const c = nodeCoord(n);
    let bk = 0, bdd = Infinity;
    curve.forEach((q, k) => { const d = kmBetween(c[0], c[1], q[0], q[1]); if (d < bdd) { bdd = d; bk = k; } });
    const pin = modeOf(n) === 'pin';
    return { node: n, name: nn.get(n)?.name || '', t: bk / N, pos: pin ? c : curve[bk], moveKm: pin ? 0 : bdd, riders: riders.get(n) || 0, pin };
  }).filter((x) => x.t > 0.01 && x.t < 0.99).sort((x, y) => x.t - y.t);
  const gap = straight.cls === 'hsr' ? 5 : 1.5;
  const kept = [];
  for (const s of proj) {
    const prev = kept[kept.length - 1];
    if (prev && kmBetween(prev.pos[0], prev.pos[1], s.pos[0], s.pos[1]) < gap && !(prev.pin && s.pin)) {
      // 너무 가까운 두 역은 하나로: 제자리 유지 역이 남고, 아니면 이용객이 많은 쪽이 남는다
      const sWins = s.pin || (!prev.pin && s.riders > prev.riders);
      if (sWins) { s.merged = [...(prev.merged || []), prev]; kept[kept.length - 1] = s; } else (prev.merged ||= []).push(s);
    } else kept.push(s);
  }
  const dropped = mids.filter((n) => modeOf(n) === 'drop').map((n) => ({ node: n, name: nn.get(n)?.name || '' }));
  const midList = mids.map((n) => ({ node: n, name: nn.get(n)?.name || '', mode: modeOf(n) }));
  const spec = NEW_BUILDS[straight.cls === 'hsr' ? 'hsr' : 'rail'];
  const kp = isKP(pa[1], pa[0]) && isKP(pb[1], pb[0]);
  const cost = Math.round(newKm * spec.perKm * (kp ? KP_COST_FACTOR : 1) + kept.length * MID_COST.rail);
  const newMin = (newKm / speed) * 60 + kept.length * P.railDwellMin;
  return { A, B, via, oldKm, oldMin, newKm, newMin, speed, curve, kept, dropped, mids: midList, cost, years: spec.years, ctrl, shape, seaShare, tA, tB };
}

/** 한반도 육지(시군구 경계) 안인지: 직선화 선형이 바다로 나가지 않게 */
let landIndex = null;
function onLand(lon, lat) {
  if (!landIndex) {
    landIndex = [];
    for (const f of zonesFC.features) {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        landIndex.push({ poly, x0, y0, x1, y1 });
      }
    }
  }
  const inRing = (r) => {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const e of landIndex) {
    if (lon < e.x0 || lon > e.x1 || lat < e.y0 || lat > e.y1) continue;
    if (inRing(e.poly[0]) && !e.poly.slice(1).some(inRing)) return true;
  }
  return false;
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
    for (const d of pl.dropped || []) f.push({ type: 'Feature', properties: { dropped: true }, geometry: { type: 'Point', coordinates: nodeCoord(d.node) } });
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
    <p class="hint">${picks} · ${pl.shape}${pl.shape.startsWith('옛') ? ' (바다·만을 가로지르지 않도록)' : ''}</p>
    ${pl.newKm > pl.oldKm * 0.97 ? '<p class="hint neg">옛 경로가 이미 곧아서 거의 줄어들지 않습니다. 고속화 개량이 나을 수 있습니다.</p>' : ''}
    <table class="kv">
      <tr><td>길이</td><td>${pl.oldKm.toFixed(1)} → <b>${pl.newKm.toFixed(1)}km</b></td></tr>
      <tr><td>최고 속도 (곡선 반경 기준)</td><td>${pl.speed} km/h</td></tr>
      <tr><td>주행 시간 (정차 포함)</td><td>${fmtMin(pl.oldMin)} → <b>${fmtMin(pl.newMin)}</b></td></tr>
      <tr><td>사업비 · 공기</td><td>${formatWon(pl.cost)} · ${pl.years}년</td></tr>
    </table>
    <h4>사이의 역 (${pl.mids.length})</h4>
    <div class="m">${pl.kept.map((k) => `${esc(k.name)} ${k.pin ? '제자리' : `${Math.round(k.moveKm * 1000).toLocaleString()}m 이동`}`).join(' · ') || '사이에 남는 역이 없습니다.'}</div>
    ${pl.dropped.length ? `<div class="m" style="margin-top:4px">폐역: ${pl.dropped.map((d) => esc(d.name)).join(' · ')}</div>` : ''}
    <p class="hint">지도에서 사이의 역을 누르면 그 역을 자동(새 선로 위로)·제자리 유지(옛 자리에서 옛 선로 방향으로 지나감)·폐역 가운데 고를 수 있습니다.</p>
    ${merged.length ? `<div class="m" style="margin-top:4px">합치는 역: ${merged.join(' · ')}</div>` : ''}
    <p class="hint">완공되면 옛 구간 ${pl.via.length}개는 폐선하고, 역 이름과 운행 계통의 정차역은 새 자리로 이어집니다.</p>
    ${fundSelect([operatorOf(state, { mode: 1, kp: isKP(nodeCoord(pl.A)[1], nodeCoord(pl.A)[0]) ? 1 : 0 })])}
    <div class="actions">
      <button class="primary" id="st-ok">착공</button><button id="st-prev">효과 미리보기</button><button id="st-cancel">취소</button></div>`;
}

function bindStraighten(el) {
  bindFund(el, renderSelection);
  el.querySelector('.close')?.addEventListener('click', endStraighten);
  el.querySelector('#st-cancel')?.addEventListener('click', endStraighten);
  el.querySelector('#st-ok')?.addEventListener('click', commitStraighten);
  el.querySelector('#st-prev')?.addEventListener('click', previewStraighten);
}

/** 직선화 선로의 점: 양 끝 역과 옮긴 역. 양 끝은 바깥 선로 접선으로 들어오고 나간다 */
function straightPoints(pl) {
  // 역(양 끝·남는 역) 사이에 곡선을 따라 약 1.5km마다 선형 점: 지은 선로가 미리보기 곡선(제자리 역의 접선 포함) 그대로 간다
  const N = pl.curve.length - 1;
  const at = (pos) => { let bk = 0, bd = Infinity; pl.curve.forEach((q, k) => { const d = kmBetween(pos[0], pos[1], q[0], q[1]); if (d < bd) { bd = d; bk = k; } }); return bk; };
  const stops = [{ node: pl.A, k: 0, pos: nodeCoord(pl.A) }, ...pl.kept.map((s) => ({ node: null, k: at(s.pos), pos: s.pos, st: s })), { node: pl.B, k: N, pos: nodeCoord(pl.B) }];
  const pts = [];
  stops.forEach((s, i) => {
    pts.push({ node: s.node, lon: s.pos[0], lat: s.pos[1], station: !!s.st, ref: s.st });
    const nx = stops[i + 1];
    if (!nx) return;
    const km = polylineKm(pl.curve.slice(s.k, nx.k + 1));
    const n = Math.floor(km / 1.5);
    for (let j = 1; j <= n; j++) {
      const k = Math.round(s.k + ((nx.k - s.k) * j) / (n + 1));
      if (k > s.k && k < nx.k) pts.push({ node: null, lon: pl.curve[k][0], lat: pl.curve[k][1], via: true });
    }
  });
  // curve.js의 tan은 경위도 단위 벡터이고 '그 점에서 새 선로가 떠나는 방향'이다: 끝점은 들어오는 방향을 뒤집는다
  const deg = ([e, n], lat, sgn) => { const v = [(sgn * e) / Math.cos((lat * Math.PI) / 180), sgn * n], d = Math.hypot(v[0], v[1]) || 1; return [v[0] / d, v[1] / d]; };
  if (pl.tA) pts[0].tan = deg(pl.tA, pts[0].lat, 1);
  if (pl.tB) pts[pts.length - 1].tan = deg(pl.tB, pts[pts.length - 1].lat, -1);
  return pts;
}

/** 직선화 새 선로에서 역이 될 점(옮긴 역)의 이름 */
function straightNames(pts) {
  const names = {};
  pts.forEach((q, i) => { if (q.station) names[i] = { name: q.ref.name, kind: 'station', auto: false }; });
  return names;
}

function commitStraighten() {
  const pl = straight.plan;
  if (!pl) return;
  const pts = straightPoints(pl);
  const r = startNewBuild(base, state, { type: straight.cls === 'hsr' ? 'hsr' : 'rail', points: pts, names: straightNames(pts), lineName: straight.line,
    extendOf: null, extraCost: pl.kept.length * MID_COST.rail });
  if (!r.ok) { alert(r.reason); return; }
  const p = state.projects[state.projects.length - 1];
  // 새 선로 속성: 곡선 반경 속도, 옛 선로의 전철 방식
  const oldL = allLinks()[pl.via[0]];
  for (const id of p.links) {
    const nl = state.newLinks[id - base.links.length];
    nl.speed = pl.speed;
    // 전철 구간을 새로 놓으면 승압까지 마친 교류 전철로 (북측 직류 3kV 노선을 직선화해도 새 선로는 교류)
    if (oldL?.power && oldL.power !== 'none') nl.power = 'AC';
  }
  // 완공 때 폐선할 옛 구간과 역 옮기기 (옛 역 → 새 역, 합친 역은 남는 역으로)
  const newStations = p.stations;
  p.retire = pl.via;
  p.dropStations = (pl.dropped || []).map((d) => d.node);   // 폐역: 완공 때 운행 계통 정차역에서 뺀다
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

/**
 * 새 선로가 대신할 옛 선로를 정해 둔다 (고속화·현대화 계획): 새 선로 양 끝 사이를 옛 노선(lineNames)으로 잇는 경로를
 * 완공 때 폐선하고(retire), 옛 역은 3km 안의 새 역으로 넘기며(stationMap), 그런 역이 없으면 닫는다(dropStations).
 * 새 선로 양 끝이 옛 노선 위가 아니면 양 끝에서 가장 가까운(15km 안) 옛 노선 노드 사이를 걷어 낸다
 */
function planRetire(p, lineNames) {
  if (!p?.links?.length) return;
  const net = effectiveNetwork(base, state);
  const L = net.links;
  const lines = new Set(lineNames);
  const ls = p.links.map((id) => linkAt(base, state, id));
  const A = ls[0].a, B = ls[ls.length - 1].b;
  const onLine = new Set();
  L.forEach((l) => { if (l.active && l.mode === 1 && lines.has(l.name)) { onLine.add(l.a); onLine.add(l.b); } });
  const nearestOld = (n) => {
    if (onLine.has(n)) return n;
    const c = nodeCoord(n);
    let best = null, bd = 15;   // 옛 노선이 새 선로 끝 역 조금 앞에서 끝나기도 한다 (충북선은 봉양까지, 고속화는 제천까지)
    for (const m of onLine) { const q = nodeCoord(m); const d = q ? kmBetween(c[0], c[1], q[0], q[1]) : Infinity; if (d < bd) { bd = d; best = m; } }
    return best;
  };
  const a = nearestOld(A), b = nearestOld(B);
  if (a == null || b == null || a === b) return;
  const via = railPath(L, a, b, lines);
  if (!via?.length) return;
  const mine = new Set(p.links);
  p.retire = via.filter((i) => !mine.has(i));
  // 옛 경로의 역: 새 선로 양 끝과 같은 노드는 그대로, 나머지는 가까운 새 역으로 (없으면 닫는다)
  const stSet = railStationSet(), newSt = (p.stations || []).filter((n) => nodeCoord(n));
  p.stationMap = {};
  p.dropStations = [];
  let node = a;
  for (const i of via) {
    const l = L[i];
    node = l.a === node ? l.b : l.a;
    if (node === A || node === B || node === b || !stSet.has(node)) continue;
    const c = nodeCoord(node);
    let best = null, bd = 3;
    for (const n of newSt) { const q = nodeCoord(n); const d = kmBetween(c[0], c[1], q[0], q[1]); if (d < bd) { bd = d; best = n; } }
    if (best != null) p.stationMap[node] = best; else p.dropStations.push(node);
  }
  const nn = nodeNames();
  state.log.unshift(`${state.year}년: ${p.label} 완공 때 옛 ${lineNames.join('·')} ${p.retire.length}개 구간을 폐선합니다 (${nn.get(a)?.name || ''}–${nn.get(b)?.name || ''})`);
}

/** 직선화가 완공되면: 운행 계통의 정차역을 새 역으로 바꾸고 경로를 다시 잡는다 */
function afterStraighten(done) {
  const projs = done.filter((p) => p.retire);
  if (!projs.length) return;
  const map_ = Object.assign({}, ...projs.map((p) => p.stationMap));
  const drop = new Set(projs.flatMap((p) => p.dropStations || []));
  const retired = new Set(projs.flatMap((p) => p.retire));
  const links = effectiveNetwork(base, state).links;
  for (const s of state.services || []) {
    const touches = s.segs.some((sg) => sg.via.some((i) => retired.has(i))) || s.stops.some((n) => map_[n] != null || drop.has(n));
    if (!touches) continue;
    s.stops = [...new Set(s.stops.filter((n) => !drop.has(n)).map((n) => map_[n] ?? n))];
    const plan = planService(links, railStationSet(), s.stops, s.kind, new Set(s.lines || [s.line]), s.type);
    if (plan) { s.segs = plan.segs; s.runMin = plan.runMin; s.km = plan.km; s.trains = tripsPerDay(s.sets, plan.runMin); }
  }
}

// ------------------------------------------------------------ 문장으로 노선 추천

let recMsg = '문장으로 바라는 노선을 적으면(도시·수단), 인구가 많은데 역이 없는 곳을 잇는 안을 만들어 그리기로 엽니다.';

function recommendRoute(text) {
  const req = parseRequest(text || '', zoneProps);
  const say = (m) => { recMsg = m; const el = $('#rec-msg'); if (el) el.textContent = m; };
  if (!req.cities.length) { say('문장에서 도시 이름을 찾지 못했습니다. 예: "대전에 도시철도 3호선", "청주와 전주를 잇는 고속도로".'); return; }
  const mode = req.mode || (req.cities.length === 1 ? 'metro' : 'rail');
  const city = req.cities[0];
  const pop = (i) => zonePop(i);
  const stationXY = [...new Set([...base.stations, ...(base.metro_stations || [])].map((s) => s[1]).concat(state.newStations))]
    .filter((n) => !foreignCountry(n)).map(nodeCoord).filter(Boolean);
  let points, title, why;
  if (mode === 'metro') {
    const subs = new Set(city.zones.flatMap((i) => zoneProps[i].subs.map((_, k) => zoneProps[i].sub0 + k)));
    const plan = metroPlan(grid, subs, stationXY);
    if (!plan) { say(`${city.name}에서 역이 없는 인구 밀집지를 충분히 찾지 못했습니다 (이미 역이 촘촘합니다).`); return; }
    const used = new Set(allLinks().filter((l) => l.mode === 2 && l.name?.startsWith(city.name)).map((l) => l.name));
    const no = req.number || (used.size + 1);
    title = `${city.name} 도시철도 ${no}호선`;
    points = plan.points.map(([lon, lat]) => ({ node: null, lon, lat, split: null }));
    why = `${title} 추천안: 역 ${points.length}곳, 약 ${plan.km.toFixed(0)}km. 지금 역(반경 800m)이 닿지 않는 인구 밀집지 약 ${Math.round(plan.served / 1000).toLocaleString()}천 명을 잇습니다. 지도에서 확인하고 고친 뒤 착공하세요.`;
  } else {
    const spec = NEW_BUILDS[mode];
    const a = cityCenter(zoneProps, city.zones, pop);
    let bCity = req.cities[1];
    if (!bCity) {
      // 가장 가까운 큰 도시 (인구 30만 이상, 같은 도시 제외)
      const big = new Map();
      zoneProps.forEach((z, i) => { if (!z.ext && !city.zones.includes(i)) { const k = z.province?.match(/(시|특별자치시)$/) ? z.province : z.name; if (!big.has(k)) big.set(k, []); big.get(k).push(i); } });
      let best = null, bd = Infinity;
      for (const [k, zs] of big) {
        if (zs.reduce((s0, i) => s0 + pop(i), 0) < 300000) continue;
        const c = cityCenter(zoneProps, zs, pop), d = c && kmBetween(a[0], a[1], c[0], c[1]);
        if (d > 15 && d < bd) { bd = d; best = { name: k.replace(/(특별자치시|특별시|광역시|시)$/, ''), zones: zs }; }
      }
      bCity = best;
    }
    if (!a || !bCity) { say('이을 상대 도시를 찾지 못했습니다.'); return; }
    const b = cityCenter(zoneProps, bCity.zones, pop);
    const snapTo = (c) => {
      const n = nearestNode({ lng: c[0], lat: c[1] }, spec.mode, null, spec.mode === 0 ? 8 : 6);
      return n != null ? { node: n, lon: nodeCoord(n)[0], lat: nodeCoord(n)[1], split: null } : { node: null, lon: c[0], lat: c[1], split: null };
    };
    points = [snapTo(a), snapTo(b)];
    title = `${city.name}–${bCity.name} ${spec.label.replace(/ 신설.*$/, '')}`;
    const d = kmBetween(a[0], a[1], b[0], b[1]);
    why = `${title} 추천안: 두 도시 중심(인구 가중)을 잇는 직선 약 ${d.toFixed(0)}km. 경유지를 눌러 더하거나 기존 ${spec.mode ? '역' : 'IC'}에 붙여 고친 뒤 착공하세요.`;
  }
  const type = mode;
  startDraft(type);
  for (const p of points) { draft.points.push(p); nameDraftPoint(p); }
  draft.lineName = title;
  draft.lineNameEdited = true;
  draft.recNote = why;
  drawDraft();
  renderBuild();
  say(why);
  const xs = draft.points.map((p) => p.lon), ys = draft.points.map((p) => p.lat);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 12 });
}

// ------------------------------------------------------------ 역·IC 신설 (기존 노선 위 한 점)

// ------------------------------------------------------------ 택지지구 개발

let housingPick = false;
function startHousingPick() {
  cancelDraft();
  housingPick = true;
  loadTerrain();   // 평지인지 보려고 지형 격자를 받아 둔다
  map.getCanvas().style.cursor = 'crosshair';
  if (metric !== 'subDensity' && metric !== 'density') { metricBeforeDraft = metric; metric = 'subDensity'; paintZones(); renderLegend(); }
  toast('택지지구를 놓을 곳을 지도에서 누르세요 (Esc: 취소). 교통이 좋은 곳일수록 분양이 잘 됩니다.');
}
function endHousingPick() {
  if (!housingPick) return;
  housingPick = false;
  map.getCanvas().style.cursor = '';
  endDraftView();
}

// 택지지구 자리: 기존 시가지(반경 1km 인구밀도) 밖, 평지(단지 범위 안 표고 차·거칠기), 물·다른 택지지구와 겹치지 않는 곳
const HOUSING_SITE = { r: { s: 0.6, m: 1.0, l: 1.6 }, urbanDensity: 3000, reliefM: 60, roughM: 40, searchKm: 6 };

// 도심(업무지구)은 사는 사람이 적어도 시가지다: 1km 안 도로 교차점·역이 많으면 시가지로 본다
let fabricGrid = null;
function urbanFabric(lon, lat) {
  if (!fabricGrid) {
    fabricGrid = new Map();
    const st = new Set([...base.stations, ...(base.metro_stations || [])].map((x) => x[1]));
    const deg = new Map();
    base.links.forEach((l) => { if (l.mode === 0) for (const n of [l.a, l.b]) deg.set(n, (deg.get(n) || 0) + 1); });
    base.nodes.forEach((c, n) => {
      const w = st.has(n) ? 4 : (deg.get(n) || 0) >= 3 ? 1 : 0;   // 역은 교차점 4개 몫
      if (!w) return;
      const k = `${Math.floor(c[0] / 0.01)},${Math.floor(c[1] / 0.01)}`;
      fabricGrid.set(k, (fabricGrid.get(k) || 0) + w);
    });
  }
  let n = 0;
  const cx = Math.floor(lon / 0.01), cy = Math.floor(lat / 0.01);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) n += fabricGrid.get(`${cx + dx},${cy + dy}`) || 0;
  return n >= 30;   // 약 2.7km × 3.3km 칸에 교차점·역 30개 넘게
}

/** 이 자리에 이 크기의 택지지구를 놓을 수 있는가: null(된다) 또는 안 되는 까닭 */
function housingSiteProblem(lon, lat, size) {
  const R = HOUSING_SITE.r[size];
  if (popWithin(lon, lat, 1) / Math.PI > HOUSING_SITE.urbanDensity || urbanFabric(lon, lat)) return '이미 시가지';
  for (const h of state.housing || []) if (kmBetween(lon, lat, h.lon, h.lat) < R + (HOUSING_SITE.r[h.size] || 1)) return '다른 택지지구와 겹침';
  if (terrainReady()) {
    const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
    const pts = [[0, 0]];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * Math.PI; pts.push([R * Math.cos(a), R * Math.sin(a)], [R * 0.5 * Math.cos(a), R * 0.5 * Math.sin(a)]); }
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dy] of pts) {
      const t = terrainAt(lon + dx / kx, lat + dy / 110.57);
      if (!t) continue;
      if (t.water || t.sea) return '물·바다에 걸침';
      if (t.rough > HOUSING_SITE.roughM) return '산지';
      lo = Math.min(lo, t.elev); hi = Math.max(hi, t.elev);
    }
    if (hi - lo > HOUSING_SITE.reliefM) return '비탈이 심함';
  }
  return null;
}

/** 누른 곳에서 가장 가까운, 이 크기가 들어갈 자리 (0.5km씩 넓혀 가며 찾는다). 없으면 null */
function findHousingSite(lon, lat, size) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  for (let r = 0; r <= HOUSING_SITE.searchKm; r += 0.5) {
    const n = r ? Math.max(8, Math.round(r * 6)) : 1;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const x = lon + (r * Math.cos(a)) / kx, y = lat + (r * Math.sin(a)) / 110.57;
      if (!housingSiteProblem(x, y, size)) return { lon: x, lat: y, moved: r };
    }
  }
  return null;
}

/** 택지지구 이름: 놓인 동(없으면 이웃 동·가까운 지명) + 지구, 겹치면 번호 */
function housingName(lon, lat, zi) {
  const used = new Set((state.housing || []).map((h) => h.name));
  const hints = stationNameHints(lon, lat).filter((h) => !h.sameStation).map((h) => stem(h.name));
  const near = namer ? namer.nearbyPlaces(lon, lat, 8, 3).map((p) => stem(p[0])) : [];
  for (const b of [...hints, ...near, zoneName(zi)]) {
    const nm = `${b}지구`;
    if (!used.has(nm)) return nm;
  }
  for (let i = 2; ; i++) if (!used.has(`${hints[0] || zoneName(zi)}${i}지구`)) return `${hints[0] || zoneName(zi)}${i}지구`;
}

function housingClick(e) {
  const zf = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
  const zi0 = zf ? zf.id : -1;
  if (!(zi0 >= 0) || zoneProps[zi0]?.ext || !result) { toast('남북 땅 안을 누르세요.'); return; }
  // 누른 곳이 시가지·산지·물이면 6km 안에서 가장 가까운 평지로 옮긴다 (가장 작은 소규모 단지 기준)
  const site = findHousingSite(e.lngLat.lng, e.lngLat.lat, 's');
  if (!site) { toast(`여기서 ${HOUSING_SITE.searchKm}km 안에 택지지구를 놓을 평지가 없습니다 (기존 시가지·산지·물 제외).`); return; }
  const { lon, lat } = site;
  const zi = zoneAtPoint(lon, lat) >= 0 ? zoneAtPoint(lon, lat) : zi0;
  const zp = zoneProps[zi];
  const name = housingName(lon, lat, zi);
  if (site.moved) {
    map.easeTo({ center: [lon, lat], duration: 600 });
    toast(`누른 곳(${housingSiteProblem(e.lngLat.lng, e.lngLat.lat, 's')})을 피해 ${site.moved.toFixed(1)}km 떨어진 평지로 옮겼습니다.`);
  }
  const access = result.zones.access[zi] / median(Array.from(result.zones.access));
  endHousingPick();
  const rows = Object.entries(HOUSING.sizes).map(([k, sz]) => {
    const pl = housingPlan({ size: k, zone: zp, lat, lon, access });
    const why = housingSiteProblem(lon, lat, k);
    if (why && LANG !== 'en') return `<div class="item"><div class="t">${sz.label} · ${sz.households.toLocaleString()}세대</div><div class="m">이 자리에는 들어가지 않습니다 (${why}).</div></div>`;
    return LANG === 'en'
      ? `<div class="item"><div class="t">${{ s: 'Small', m: 'Medium', l: 'New town' }[k]} · ${sz.households.toLocaleString('en')} homes</div>
      <div class="m">Cost ${formatWon(pl.cost)} · ${pl.years} yrs · ${pl.persons.toLocaleString('en')} residents (${pl.net.toLocaleString('en')} net growth) · sales revenue ${formatWon(pl.revenue)}</div>
      <button class="small primary" data-housing="${k}">Start construction</button></div>`
      : `<div class="item"><div class="t">${sz.label} · ${sz.households.toLocaleString()}세대</div>
      <div class="m">사업비 ${formatWon(pl.cost)} · ${pl.years}년 · 입주 ${fmtPeople(pl.persons)} (그중 순증 ${fmtPeople(pl.net)}) · 분양 수익 ${formatWon(pl.revenue)}</div>
      <button class="small primary" data-housing="${k}">착공</button></div>`;
  }).join('');
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true"><h2>${t('택지지구 개발', 'Housing district')} · ${esc(name)}</h2>
    <p class="setup-intro">${t(`주택 단지를 조성해 입주민을 받습니다. 입주 인구 가운데 일부는 새로 늘어나는 인구(새 가구·출산·해외 유입)이고, 나머지는 다른 시군에서 옮겨 옵니다.
      지금 반경 3km 인구 ${fmtPeople(popNear(lon, lat, 3))} · 교통 접근성 ${access.toFixed(2)} (전국 중앙값 1, 낮으면 분양이 덜 됩니다)`,
      `Build a housing estate. Part of the new residents is net population growth (new households, births, immigration); the rest moves in from other counties.
      Population within 3 km now: ${Math.round(popNear(lon, lat, 3)).toLocaleString('en')} · accessibility ${access.toFixed(2)} (national median 1; lower sells worse)`)}</p>
    <div class="setup-body">${rows}</div>
    <div class="setup-btns"><span style="flex:1"></span><button class="small" data-housing="cancel">닫기</button></div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-housing]');
    if (!b) return;
    if (b.dataset.housing !== 'cancel') {
      const plan = housingPlan({ size: b.dataset.housing, zone: zp, lat, lon, access });
      const r = startHousing(state, { name, zone: zi, lon, lat, size: b.dataset.housing, plan });
      if (!r.ok) { alert(r.reason); return; }
      save(state); renderAll();
      toast(`${name} 택지지구 착공 (${plan.years}년 뒤 입주)`);
    }
    wrap.remove();
  });
}

let pointAdd = null;   // {kind: 'station'|'ic', pick: {link, lon, lat, mode, name, road}}

function startPointAdd(kind) {
  cancelDraft();
  if (!namer) { alert('지명 데이터를 아직 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'); return; }
  pointAdd = { kind, pick: null };
  map.getCanvas().style.cursor = 'crosshair';
  select({ type: 'pointadd' });
}

function endPointAdd() {
  if (pointAdd?.pick?.reserved) namer.release(pointAdd.pick.name, pointAdd.kind === 'ic' ? 'IC' : 'station');
  pointAdd = null;
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  if (selection?.type === 'pointadd') select(null);
}

function pointAddClick(ll) {
  const isIC = pointAdd.kind === 'ic';
  const on = isIC ? nearestOnLink(ll, 0, 16, (l) => l.cls === 'motorway')
    : nearestOnLink(ll, 1, 16, (l) => !l.ext) || nearestOnLink(ll, 2, 16);
  if (!on) return;
  const lon = on.lngLat.lng, lat = on.lngLat.lat, l = linkAt(base, state, on.link);
  if (pointAdd.pick?.reserved) namer.release(pointAdd.pick.name, isIC ? 'IC' : 'station');
  const pick = { link: on.link, lon, lat, mode: l.mode, line: l.name || CLASS_LABEL[l.cls], name: namer.suggest(lon, lat, isIC ? 'IC' : 'station'), reserved: true };
  if (isIC) {
    const r = nearestLocalRoad(base, state, allLinks().map((_, i) => linkAt(base, state, i)), lon, lat);
    pick.road = r?.node ?? null; pick.roadKm = r?.km ?? null;
  }
  pointAdd.pick = pick;
  const f = [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }];
  if (pick.road != null) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, lat], nodeCoord(pick.road)] } });
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
  renderSelection();
}

function pointAddCost() {
  const pk = pointAdd.pick;
  return pointAdd.kind === 'ic' ? icCost(pk.roadKm || 0, pk.lat, pk.lon) : stationCost({ mode: pk.mode }, pk.lat, pk.lon);
}

function pointAddPanel() {
  const isIC = pointAdd.kind === 'ic', pk = pointAdd.pick;
  const title = isIC ? 'IC 신설' : '역 신설';
  if (!pk) {
    return `${header(title)}<p class="hint">${isIC ? '고속도로 위 IC를 놓을 곳을 누르세요. 가장 가까운 일반도로(6km 안)까지 연결도로를 함께 놓습니다.'
      : '역을 놓을 철도·도시철도 노선 위 한 점을 누르세요. 완공되면 그 자리에 역이 생겨 주변 읍면동에서 역까지 가까워집니다.'}</p>`;
  }
  const c = pointAddCost();
  const noRoad = isIC && pk.road == null;
  return `${header(title)}
    <table class="kv">
      <tr><td>노선</td><td>${esc(pk.line)}</td></tr>
      <tr><td>이름</td><td><input type="text" id="padd-name" value="${esc(pk.name)}" style="width:9em"></td></tr>
      ${isIC ? `<tr><td>연결도로</td><td>${noRoad ? '<span class="neg">6km 안에 이을 일반도로가 없습니다</span>' : `${(pk.roadKm * 1.2).toFixed(1)}km (4차로)`}</td></tr>` : ''}
      <tr><td>사업비 · 공기</td><td>${formatWon(c.cost)} · ${c.years}년</td></tr>
      <tr><td>주변 인구 (반경 1·3km)</td><td>${Math.round(popWithin(pk.lon, pk.lat, 1)).toLocaleString()} · ${Math.round(popWithin(pk.lon, pk.lat, 3)).toLocaleString()}명</td></tr>
    </table>
    <p class="hint">다른 곳을 누르면 자리를 옮깁니다.</p>
    <div class="row" style="display:flex;gap:6px;margin-top:8px">
      <button class="primary" id="padd-ok" ${noRoad ? 'disabled' : ''}>착공</button><button id="padd-prev" ${noRoad ? 'disabled' : ''}>효과 미리보기</button><button id="padd-cancel">취소</button></div>`;
}

function bindPointAdd(el) {
  el.querySelector('.close')?.addEventListener('click', endPointAdd);
  el.querySelector('#padd-cancel')?.addEventListener('click', endPointAdd);
  const nm = el.querySelector('#padd-name');
  if (nm) {
    nm.onchange = () => {
      const v = nm.value.trim();
      if (!v) return;
      if (pointAdd.pick.reserved) namer.release(pointAdd.pick.name, pointAdd.kind === 'ic' ? 'IC' : 'station');
      pointAdd.pick.name = v; pointAdd.pick.reserved = false;
    };
  }
  el.querySelector('#padd-ok')?.addEventListener('click', commitPointAdd);
  el.querySelector('#padd-prev')?.addEventListener('click', previewPointAdd);
}

function doPointAdd(st) {
  const pk = pointAdd.pick;
  return pointAdd.kind === 'ic' ? startICAdd(base, st, { link: pk.link, lon: pk.lon, lat: pk.lat, road: pk.road, name: pk.name })
    : startStationAdd(base, st, { link: pk.link, lon: pk.lon, lat: pk.lat, name: pk.name });
}

function commitPointAdd() {
  if (!pointAdd?.pick) return;
  const r = doPointAdd(state);
  if (!r.ok) { alert(r.reason); return; }
  pointAdd.pick.reserved = false;
  endPointAdd();
  save(state); refreshLinks(); refreshPoints(); renderAll();
  switchTab('projects');
}

function previewPointAdd() {
  const pk = pointAdd?.pick;
  if (!pk) return;
  const c = pointAddCost(), isIC = pointAdd.kind === 'ic';
  runPreview(`${pk.name} ${isIC ? '' : '역 '}신설 미리보기`, (cl) => {
    const n0 = cl.newLinks.length;
    const r = doPointAdd(cl);
    if (!r.ok) throw new Error(r.reason);
    buildNow(cl, cl.projects[cl.projects.length - 1]);
    return cl.newLinks.slice(n0).map((l) => l.id);
  }, { kind: pointAdd.kind, cost: c.cost, years: c.years, mode: pk.mode, km: isIC ? (pk.roadKm || 0) * 1.2 : 0, cls: isIC ? 'primary' : undefined });
}

// ------------------------------------------------------------ 착공 전 효과 미리보기

let previewSeq = 0, previewWait = null;
let previewYears = 0;   // 0: 첫해, 5: 5년 뒤 (읍면동 인구 이동까지, 느림)

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
  showPreviewBox(`<b>${esc(title)}</b><p class="hint">효과를 계산하는 중입니다 (그해 처음은 지금 그대로까지 구하느라 약 30초, 같은 해 두 번째부터는 10~30초${previewYears ? ', 5년 뒤는 조금 더' : ''})…</p>`);
  setBusy(true, '효과 미리보기', 0);
  worker.postMessage({ type: 'preview', id, net, ctx: ctx(), years: previewYears });
}

/**
 * 효과 미리보기 미리 데우기: 새 노선을 그리기 시작하면 그해 '지금 그대로'(대조) 평가를 뒤에서 먼저 해 둔다.
 * 그리는 동안 끝나서, 철도 사업 미리보기는 처리 쪽만 계산하면 된다 (그해 한 번)
 */
let warmedFor = null;
function warmPreview() {
  if (!worker || !result || busy) return;
  const key = `${state.year}:${previewYears}:${state.newLinks.length}:${state.projects.length}`;
  if (warmedFor === key) return;
  warmedFor = key;
  worker.postMessage({ type: 'preview', id: -1, net: effectiveNetwork(base, state), ctx: ctx(), years: previewYears, warmOnly: true });
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
  clone.__built = p;
  return p.links;
}

function onPreview(m) {
  setBusy(false);
  window.__lastPreview = { before: m.before?.totals, after: m.after?.totals, benefit: m.benefit, years: m.years, timing: m.timing };   // 콘솔 디버깅용
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
    // 구간을 잘라 새 구간으로 바꾼 곳(중간 IC·역)은 사라진 것이지 덜어진 것이 아니다
    if (!l.name || touched.includes(i) || clone.replaced?.[i]) continue;
    const d = B.vol[i] - A.vol[i];
    if (d > 0.05 * B.vol[i] && B.vc[i] > 0.6) relief.push([d, l.name, B.vc[i], A.vc[i]]);
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
  showPreviewBox(`<b>${esc(title)}</b> <span class="m">다 지었을 때 (${m.years ? `${m.years}년 뒤: 읍면동 인구 이동 반영` : '지금 교통량 기준'})</span>
    <table class="kv">
      ${row('새·개량 구간 최대 이용', `${Math.round(newUse).toLocaleString()} ${touched.some((i) => linkAt(base, clone, i).mode === 0) ? 'PCU' : '명'}/일`)}
      ${row('하루 도로 차량 통행 시간', `${sign(vhm, (v) => `${Math.round(v).toLocaleString()}대·시간`)}`)}
      ${row('철도 이용 (지역 간)', `${sign(res.dRail, (v) => `${Math.round(v).toLocaleString()}명/일`)}`)}
      ${row('지역 간 통행 (유발 수요)', `${sign(res.dTrips, (v) => `${Math.round(v).toLocaleString()}통행/일`)}`)}
      ${row('정체 도로 (V/C>1)', `${res.congB.toFixed(0)} → ${res.congA.toFixed(0)} km`)}
    </table>
    ${top.length ? `<div class="m">혼잡이 줄어드는 곳: ${top.map(([, n, b, a]) => `${esc(n)} (V/C ${b.toFixed(2)}→${a.toFixed(2)})`).join(' · ')}</div>` : ''}
    ${airDeltaHTML(B, A)}
    ${extra.html ? extra.html({ ...res, touched }, A, clone) : ''}
    ${m.benefit ? previewAppraisal(m.benefit, res, touched, extra, clone) : ''}
    <div class="actions"><button class="small" id="cmp-add">비교에 담기 (A·B·C안)</button></div>
    <p class="hint">실제 효과는 해마다 조금씩 나타나고, 인구·소득 변화에 따라 달라집니다.</p>`);
  const ca = $('#cmp-add');
  if (ca) ca.onclick = () => { addCompare(); ca.disabled = true; ca.textContent = '담았습니다 (건설 탭 위)'; };
}

// ------------------------------------------------------------ 해마다 일어나는 사건

/** 국제 행사 후보 도시: 광역시·평양 (가장 인구가 많은 구) + 북측 큰 도시 */
function bigCities() {
  const out = [];
  for (const prov of ['부산광역시', '인천광역시', '대구광역시', '광주광역시', '대전광역시', '평양시']) {
    let best = -1;
    zoneProps.forEach((z, i) => { if (!z.ext && z.province === prov && (best < 0 || z.pop > zoneProps[best].pop)) best = i; });
    if (best >= 0) out.push([prov.replace(/(광역시|시)$/, ''), best]);
  }
  for (const nm of ['원산시', '함흥시', '청진시', '신의주시']) {
    const i = zoneProps.findIndex((z) => z.name === nm && !z.ext);
    if (i >= 0) out.push([nm.replace(/시$/, ''), i]);
  }
  return out;
}

function showEvent(ev) {
  const decide = (k) => {
    const msg = ev.choices[k].apply(state);
    (state.events ||= []).push({ key: ev.key, year: state.year, choice: k });
    state.log.unshift(`${state.year}년 ${msg}`);
    save(state); renderAll();
  };
  if (autoYears > 0) { decide(0); return; }
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true"><h2>${esc(ev.title)}</h2>
    <p class="setup-intro">${esc(ev.body)}</p>
    <div class="setup-btns" style="flex-direction:column;align-items:stretch">${ev.choices.map((c, k) => `<button class="${k ? '' : 'primary'}" data-ev-choice="${k}">${esc(c.label)}</button>`).join('')}</div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ev-choice]');
    if (!b) return;
    wrap.remove();
    decide(+b.dataset.evChoice);
  });
}

// ------------------------------------------------------------ 사업 비교 (A·B·C안)

/** 마지막 효과 미리보기를 비교 목록에 담는다 (세 개까지, 넘치면 오래된 것부터 뺀다) */
function addCompare() {
  const p = lastPreview;
  if (!p) return;
  const a = p.appraisal;
  const built = previewBuilt();
  const list = (state.compare ||= []);
  list.push({ title: p.title, year: state.year, cost: built.cost, years: built.years, km: built.km,
    newUse: Math.round(p.newUse), dRail: Math.round(p.dRail), dTrips: Math.round(p.dTrips), dVhm: Math.round(p.dVhm),
    congB: Math.round(p.congB), congA: Math.round(p.congA), bc: a ? +a.bc.toFixed(2) : null, ahp: a ? +a.ahp.toFixed(3) : null, npv: a ? Math.round(a.npv) : null });
  while (list.length > 3) list.shift();
  save(state); renderBuild();
}
/** 미리보기한 사업의 사업비·공기·길이 (그리기 중이면 그 노선) */
function previewBuilt() {
  if (draft && draft.type !== 'airport' && draft.points.length > 1) { const d = draftCost(); return { cost: d.cost, years: d.years, km: d.km }; }
  const e = lastPreview?.extra || {};
  return { cost: e.cost ?? null, years: e.years ?? null, km: e.km ?? null };
}

function compareHTML() {
  const list = state.compare || [];
  if (!list.length) return '';
  const L = 'ABC';
  const best = (k, hi = true) => { const v = list.map((x) => x[k]).filter((x) => x != null); return v.length ? (hi ? Math.max(...v) : Math.min(...v)) : null; };
  const cell = (x, k, fmt, hi = true) => { const b = best(k, hi); const v = x[k]; return `<td class="num ${v != null && v === b && list.length > 1 ? 'good' : ''}">${v == null ? '-' : fmt(v)}</td>`; };
  const sg = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString()}`;
  const rows = [
    ['B/C', 'bc', (v) => v.toFixed(2)], ['AHP', 'ahp', (v) => v.toFixed(3)], ['순현재가치', 'npv', (v) => formatWon(v)],
    ['사업비', 'cost', (v) => formatWon(v), false], ['철도 이용 변화 (명/일)', 'dRail', sg], ['유발 통행 (통행/일)', 'dTrips', sg],
    ['도로 차량 시간 (대·시간/일)', 'dVhm', sg, false], ['정체 도로 뒤 (km)', 'congA', (v) => v.toLocaleString(), false], ['새 구간 최대 이용', 'newUse', (v) => v.toLocaleString()],
  ];
  return `<details class="fold" open><summary>사업 비교 (${list.length})</summary>
    <table class="report-t cmp-t"><tr><td></td>${list.map((x, i) => `<td class="num"><b>${L[i]}안</b><div class="m" title="${esc(x.title)}">${esc(x.title.slice(0, 18))}</div></td>`).join('')}</tr>
      ${rows.map(([label, k, f, hi]) => `<tr><td>${label}</td>${list.map((x) => cell(x, k, f, hi !== false)).join('')}</tr>`).join('')}</table>
    <p class="hint">효과 미리보기의 결과입니다. 초록은 그 줄에서 가장 나은 안입니다. 같은 해·같은 조건에서 미리보기한 것끼리 견주세요.</p>
    <div class="actions">${list.map((_, i) => `<button class="small" data-cmp-del="${i}">${L[i]}안 빼기</button>`).join('')}<button class="small" data-cmp-del="all">모두 지우기</button></div>
  </details>`;
}

/** 미리보기: 이용이 크게 바뀌는 공항 (공항철도 등) */
function airDeltaHTML(B, A) {
  if (!B.airIds || !A.airIds) return '';
  const rows = [];
  A.airIds.forEach((id, k) => {
    const j = B.airIds.indexOf(id);
    const b = j >= 0 ? B.airPax[j] : 0, a = A.airPax[k];
    if (Math.abs(a - b) > Math.max(200, 0.03 * b)) rows.push([a - b, id, b, a]);
  });
  rows.sort((x, y) => Math.abs(y[0]) - Math.abs(x[0]));
  return rows.length ? `<div class="m">공항 이용 변화: ${rows.slice(0, 4).map(([, id, b, a]) => `${esc(airportName(id))} ${Math.round(b).toLocaleString()}→${Math.round(a).toLocaleString()}명/일`).join(' · ')}</div>` : '';
}

/** 미리보기 결과로 예타식 평가 (B/C, AHP). 사업비·공기는 미리보기에서 만든 사업(clone.__built)이나 extra에서 */
function previewAppraisal(benefit, res, touched, extra, clone) {
  const p = clone.__built || {};
  const cost = extra.cost ?? p.cost ?? 0, years = extra.years ?? p.years ?? 1;
  if (!(cost > 0)) return '';
  const links = touched.map((i) => linkAt(base, clone, i)).filter(Boolean);
  const km = extra.km ?? links.reduce((s0, l) => s0 + (l.len || 0), 0);
  const cls = extra.cls ?? links[0]?.cls;
  const kind = extra.kind ?? (p.kind === 'upgrade' ? 'upgrade' : 'new');
  const mode = extra.mode ?? links[0]?.mode ?? 0;
  // 사업이 지나는 존: 구간 양 끝과 가운데에서 가장 가까운 존
  const zoneAt = (c) => { let best = -1, bd = Infinity; zoneProps.forEach((z, i) => { if (z.ext) return; const d = (z.cx - c[0]) ** 2 + (z.cy - c[1]) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };
  const nodeAt = (n) => (n < base.nodes.length ? base.nodes[n] : clone.newNodes[n - base.nodes.length]);
  const zones = links.flatMap((l) => [nodeAt(l.a), nodeAt(l.b)].filter(Boolean).map(zoneAt));
  const region = appraisalRegion(zoneProps, result?.zones.income, zones.length ? zones : extra.zones || []);
  const kpN = links.filter((l) => l.kp).length;
  const border = links.some((l) => { const a = nodeAt(l.a), b = nodeAt(l.b); return a && b && isKP(a[1], a[0]) !== isKP(b[1], b[0]); }) || !!extra.border;
  const a = appraise({
    benefit, cost, years, type: extra.type ?? p.type, opex: extra.opex ?? opexFor(kind, { cls, km, cost }),
    policy: { plan: !!(extra.plan || p.plan), congB: res.congB, congA: res.congA, dRail: res.dRail, mode, border, kp: kpN * 2 > links.length, cost },
    region,
  });
  lastPreview.appraisal = a;
  return appraisalHTML(a, formatWon);
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

/** 도로의 끝점이 기존 도로에 닿지 않았으면 가장 가까운 도로(5km 안)로 저절로 잇는다. 이을 곳이 없으면 false */
function attachRoadEnd(pt, rename = true) {
  if (pt.node != null || pt.split != null) return true;
  const ll = { lng: pt.lon, lat: pt.lat };
  const on = nearestOnLink(ll, 0, 60);
  const nd = nearestNode(ll, 0, null, 5);
  const ndKm = nd != null ? kmBetween(pt.lon, pt.lat, ...nodeCoord(nd)) : Infinity;
  const onKm = on ? kmBetween(pt.lon, pt.lat, on.lngLat.lng, on.lngLat.lat) : Infinity;
  if (nd == null && !on) return false;
  if (on && onKm + 0.3 < ndKm) { pt.split = on.link; pt.lon = on.lngLat.lng; pt.lat = on.lngLat.lat; }
  else { pt.node = nd; [pt.lon, pt.lat] = nodeCoord(nd); }
  if (draft && rename) nameDraftPoint(pt);
  return true;
}

/** 그리기 점을 복사한 상태(c)에 맞춘다: 기존 노선 중간에 놓은 점은 그 상태에서 구간을 잘라 새 IC·역 노드로 만든다 */
function draftPointsOn(c) {
  const road = NEW_BUILDS[draft.type].mode === 0;
  return draft.points.map((p, i) => {
    const q = { ...p };
    if (road && i === draft.points.length - 1) attachRoadEnd(q, false);
    if (q.split != null) { q.node = splitLink(base, c, q.split, q.lon, q.lat); q.split = null; }
    return q;
  });
}

/** 그리는 중인 신설 노선 미리보기 (기존 노선 중간에 놓은 점도 그 자리를 잘라 이어서 계산) */
async function previewDraft() {
  if (!draft || draft.points.length < 2) return;
  // 지형 자료를 다 받은 뒤에 사업비를 잡는다 (먼저 누르면 지형 없는 사업비로 B/C가 두 번째와 달라졌다)
  if (terrainRule(draft.type) && !terrainReady()) { await loadTerrain(); if (!draft) return; }
  const dc = draftCost();
  runPreview(`${draftLineName() || NEW_BUILDS[draft.type].label} 미리보기`, (c) => {
    // 새 역 이름을 넘겨야 새 역이 역이 된다 (예전에는 빈 이름을 넘겨 새 역 없이 계산했다: 새 역이 많은 노선은 B/C가 0에 가까웠다)
    const r = startNewBuild(base, c, { type: draft.type, points: draftPointsOn(c), names: draftNames(), lineName: draftLineName(), segFactor: dc.segFactor, extraCost: dc.extraCost });
    if (!r.ok) throw new Error(r.reason);
    return buildNow(c, c.projects[c.projects.length - 1]);
  }, { kind: 'new', cost: dc.cost, years: dc.years, km: dc.km, cls: NEW_BUILDS[draft.type].attrs.cls, mode: NEW_BUILDS[draft.type].mode, plan: !!draft.plan });
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
    const pts = straightPoints(pl);
    const r = startNewBuild(base, c, { type: straight.cls === 'hsr' ? 'hsr' : 'rail', points: pts, names: straightNames(pts), lineName: straight.line });
    if (!r.ok) throw new Error(r.reason);
    const p = c.projects[c.projects.length - 1];
    for (const lid of p.links) c.newLinks[lid - base.links.length].speed = pl.speed;
    p.retire = pl.via;
    return buildNow(c, p);
  }, { kind: 'new', cost: pl.cost, years: pl.years, km: pl.newKm, cls: straight.cls === 'hsr' ? 'hsr' : 'conv', mode: 1 });
}

// ------------------------------------------------------------ 오류 제보·저장 파일·결산

function reportBug() {
  const c = map?.getCenter();
  const lines = ['무엇이 이상했는지 적어 주세요 (어디서, 무엇을 눌렀을 때):', '', '', '---- 아래는 자동으로 채운 정보입니다 ----',
    `버전: ${APP_VERSION} · 데이터 ${dataStamp || '-'}`,
    `게임: ${state?.year}년 · 난이도 ${state?.difficulty} · 사업 ${state?.projects?.length ?? 0}건`,
    `지도: ${c ? `${c.lng.toFixed(4)}, ${c.lat.toFixed(4)} · 확대 ${map.getZoom().toFixed(1)}` : '-'}`,
    `선택: ${selection ? `${selection.type} ${selection.id ?? ''}` : '-'}`,
    `화면: ${innerWidth}×${innerHeight} @${devicePixelRatio}`,
    `브라우저: ${navigator.userAgent}`,
    `최근 오류: ${errLog.slice(-3).join(' | ').slice(0, 600) || '없음'}`,
    `최근 기록: ${(state?.log || []).slice(0, 3).join(' / ').slice(0, 300)}`];
  location.href = `mailto:${BUG_MAIL}?subject=${encodeURIComponent(`[통일 한반도 교통망 ${APP_VERSION}] 오류 제보`)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

// 공유 링크: 저장(계산 상태는 빼고, 기록은 줄여서)을 압축해 주소의 #s= 뒤에 담는다. 받은 쪽은 그 판을 열고 계산을 다시 한다
async function packState() {
  // 받은 쪽에서 다시 만드는 것(계산 상태·체감 기준·혼잡 목록)과 지난 기록(지난 선거·끝난 제안·다 지은 이어받은 공사)은 뺀다
  const { snapshot, subBase, zoneGainPrev, congestion, compare, approvalWhy, ...rest } = state;
  const local = { ...state.local, elections: (state.local?.elections || []).slice(-1), proposals: (state.local?.proposals || []).filter((p) => p.status === 'open') };
  const lite = { ...rest, local, congestion: {}, log: (state.log || []).slice(0, 20), projects: state.projects.filter((p) => !(p.kind === 'osm' && p.status === 'done')) };
  const bytes = new TextEncoder().encode(JSON.stringify({ app: 'unified-korea-transport', v: APP_VERSION, state: lite }));
  const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpackState(code) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(ds).text());
}
async function copyShareLink() {
  try {
    const url = `${location.origin}${location.pathname}#s=${await packState()}`;
    await navigator.clipboard.writeText(url).catch(() => prompt('이 주소를 복사하세요', url));
    toast(url.length > 8000 ? `링크를 복사했습니다 (${Math.round(url.length / 1000)}천 자: 길어서 일부 SNS에서는 잘릴 수 있습니다. 그럴 땐 파일로 내보내 주세요)` : `공유 링크를 복사했습니다 (${url.length.toLocaleString()}자)`);
  } catch (e) { alert(`공유 링크를 만들지 못했습니다: ${e.message}`); }
}
/** 주소에 #s=가 있으면 그 판을 연다 (게임을 시작하기 전에 부른다). 열었으면 true */
async function openSharedFromURL() {
  const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname);
  let v;
  try { v = await unpackState(m[1]); } catch { alert('공유 링크를 읽지 못했습니다.'); return false; }
  const st = v?.state;
  if (v?.app !== 'unified-korea-transport' || !st?.year) return false;
  if (!confirm(`공유받은 ${st.year}년 판을 열까요? 지금 진행은 슬롯이나 파일로 저장해 두지 않았다면 사라집니다.`)) return false;
  st.log = [`공유받은 판을 열었습니다 (${st.year}년). 계산 상태는 처음부터 다시 맞춥니다.`, ...(st.log || [])];
  save(st);
  clearSim();
  return true;
}

function exportSave() {
  const blob = new Blob([JSON.stringify({ app: 'unified-korea-transport', version: APP_VERSION, savedAt: Date.now(), state })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `통일교통망_${state.year}년.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importSave(file) {
  let v;
  try { v = JSON.parse(await file.text()); } catch { alert('저장 파일을 읽지 못했습니다.'); return; }
  const st = v?.state;
  if (v?.app !== 'unified-korea-transport' || !st?.year) { alert('이 게임의 저장 파일이 아닙니다.'); return; }
  if (dataStamp && st.dataStamp && st.dataStamp !== dataStamp) { alert(`지도 자료가 바뀌기 전에 만든 파일이라 불러올 수 없습니다 (파일 ${st.dataStamp} · 지금 ${dataStamp}).`); return; }
  if (!confirm(`${st.year}년 저장 파일을 불러올까요? 지금 진행은 슬롯이나 파일로 저장하지 않았다면 사라집니다.`)) return;
  save(st);
  await flushSave();
  if (saveError()) { alert(`불러온 게임을 저장하지 못했습니다: ${saveError().message || saveError()}`); return; }
  clearSim();
  location.reload();
}

/** 놓은 노선 길이(km)와 완공 사업 수 */
function builtSummary() {
  const out = { hsr: 0, rail: 0, metro: 0, road: 0, done: 0, upgrades: 0 };
  const kind = { hsr: 'hsr', tunnelRail: 'hsr', gtx: 'rail', rail: 'rail', rail1: 'rail', metro: 'metro', motorway: 'road', trunk: 'road', tunnelRoad: 'road' };
  for (const p of state.projects) {
    // 처음부터 이어받은 공사(OSM 공사 중 노선)는 플레이어 사업이 아니므로 세지 않는다
    if (p.status !== 'done' || p.kind === 'osm') continue;
    out.done++;
    if (p.kind === 'upgrade') out.upgrades++;
    if (p.kind !== 'new' || !kind[p.type]) continue;
    out[kind[p.type]] += p.links.reduce((sum, id) => sum + (linkAt(base, state, id)?.len || 0), 0);
  }
  for (const k of ['hsr', 'rail', 'metro', 'road']) out[k] = Math.round(out[k]);
  return out;
}

/** 현황 탭 맨 위: 이번 판의 목표와 지금 상태 */
let goalTimes = null;   // 서울–평양 목표용 최근 소요 시간 (해마다 잰다)
function goalHTML() {
  const G = GOALS[state.goal];
  if (!G?.check || !state.history.length) return '';
  const st = G.check({ h0: state.history[0], h1: state.history[state.history.length - 1], state, times1: goalTimes });
  if (!st) return `<p class="report-goal">${t('목표', 'Goal')} · ${G.label} <span class="m">(${t('재는 중', 'measuring')})</span></p>`;
  return `<p class="report-goal ${st.done ? 'good' : ''}">${t('목표', 'Goal')} · ${G.label}: ${t('지금', 'now')} <b>${st.now}</b> / ${t('목표', 'target')} ${st.target}${st.done ? t(' · 달성', ' · achieved') : ''}
    <span class="m">(${t(`${START_YEAR + 10}년 결산에서 판정`, `judged in the ${START_YEAR + 10} summary`)})</span></p>`;
}

/** 상징 구간(TIME_PAIRS)의 지금 소요 시간 (워커에 묻는다) */
const routeWaits = new Map();
let routeSeq = 0;
function routeTimes() {
  const id = ++routeSeq;
  return new Promise((res) => {
    routeWaits.set(id, res);
    worker.postMessage({ type: 'routes', id, pairs: TIME_PAIRS.map(([, a, b]) => [a, b]) });
  });
}

/** 결산: 시작한 해와 지금을 견준 성적표 (이미지로 저장 단추) */
async function showReport() {
  const h = state.history;
  if (!h.length || !result) { alert('아직 결산할 기록이 없습니다.'); return; }
  const h0 = h[0], h1 = h[h.length - 1];
  const years = [h0.year, state.year];
  const times1 = busy ? null : await routeTimes();
  const r = buildReport({ h0, h1, state, built: builtSummary(), times0: state.times0, times1 });
  showNotice(t(`${years[0]}–${years[1]}년 결산`, `Summary ${years[0]}–${years[1]}`), `${reportHTML(r, years)}
    <div class="actions" style="margin-top:10px"><button class="small primary" id="report-img">이미지로 저장 (SNS 공유용)</button></div>
    ${years[1] === years[0] ? `<p class="hint">${t('한 해 이상 넘겨야 변화가 보입니다.', 'Advance at least one year to see changes.')}</p>` : ''}`);
  lastReport = { r, years };
}
// 결산 알림은 앞선 알림(관광지 해금 등) 뒤에 줄을 서므로 단추는 문서에 걸어 둔다
let lastReport = null;
document.addEventListener('click', async (e) => {
  const b = e.target.closest('#report-img');
  if (!b || !lastReport) return;
  const { r, years } = lastReport;
  b.disabled = true; b.textContent = '저장하는 중…';
  await downloadReportImage(map, r, years, `통일교통망_${years[0]}-${years[1]}_결산.png`);
  b.textContent = '저장했습니다';
});

// ------------------------------------------------------------ 저장 슬롯

const SLOTS = 3;

function slotsHTML() {
  const meta = slotMeta();
  const backup = state.backupStamp ? `<div class="item opt"><div class="opt-row"><span>지도 자료가 바뀌기 전 저장 <span class="m">이어 할 수 없음</span></span>
      <span><button class="small" id="backup-dl">파일로 받기</button></span></div></div>` : '';
  return `<div class="list">${Array.from({ length: SLOTS }, (_, k) => {
    const v = meta[k + 1];
    return `<div class="item opt"><div class="opt-row">
      <span>슬롯 ${k + 1} <span class="m">${v ? `${v.year}년 · ${new Date(v.savedAt).toLocaleString('ko-KR')}` : '비어 있음'}</span></span>
      <span><button class="small" data-slot-save="${k + 1}">저장</button> <button class="small" data-slot-load="${k + 1}" ${v ? '' : 'disabled'}>불러오기</button></span></div></div>`;
  }).join('')}${backup}</div>`;
}

function bindSlots(el) {
  el.querySelectorAll('[data-slot-save]').forEach((b) => {
    b.onclick = async () => {
      const n = b.dataset.slotSave;
      if (slotMeta()[n] && !confirm(`슬롯 ${n}에 덮어쓸까요?`)) return;
      b.disabled = true;
      try {
        await saveSlot(n, state);
        state.log.unshift(`${state.year}년 슬롯 ${n}에 저장했습니다.`);
        save(state);
        renderAll();
        toast(`슬롯 ${n}에 저장했습니다.`);
      } catch (e) { alert(`저장하지 못했습니다: ${e?.message || e}. 설정 탭의 '파일로 내보내기'로 저장해 두세요.`); }
      b.disabled = false;
    };
  });
  el.querySelectorAll('[data-slot-load]').forEach((b) => {
    b.onclick = async () => {
      const n = b.dataset.slotLoad, v = slotMeta()[n];
      if (!v || !confirm(`슬롯 ${n}(${v.year}년)을 불러올까요? 지금 진행은 슬롯에 저장하지 않았다면 사라집니다.`)) return;
      const json = await loadSlot(n);
      if (!json) { alert('슬롯을 읽지 못했습니다.'); return; }
      save(JSON.parse(json));
      await flushSave();
      if (saveError()) { alert(`불러오지 못했습니다: ${saveError().message || saveError()}`); return; }
      clearSim();
      location.reload();
    };
  });
  el.querySelector('#backup-dl')?.addEventListener('click', async () => {
    const json = await loadBackup(state.backupStamp);
    if (!json) { alert('예전 저장을 찾지 못했습니다.'); return; }
    const st = JSON.parse(json);
    const blob = new Blob([JSON.stringify({ app: 'unified-korea-transport', version: APP_VERSION, savedAt: Date.now(), state: st })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `통일교통망_${st.year}년_자료${st.dataStamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  });
}

// ------------------------------------------------------------ 도시철도 구 안 이용 (추정)

/**
 * 도시철도역 하루 승하차 추정: 시군구 사이 통행만 세는 모형에는 같은 구 안 이용이 빠져 있어서,
 * 역 반경 800m 인구 × 0.45회(역세권 주민 1인당 하루 도시철도 승하차, 환승·외부 방문 포함 어림)로 보탠다
 */
const METRO_PER_RESIDENT = 0.45;
const metroEstCache = new Map();
function metroStationEst(node) {
  if (!metroEstCache.has(node)) {
    const c = nodeCoord(node);
    metroEstCache.set(node, c ? popWithin(c[0], c[1], 0.8) * METRO_PER_RESIDENT : 0);
  }
  return metroEstCache.get(node);
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
  const sig = pppSig(p);
  runPreview(`${draftLineName() || spec.label} 수요 예측 (${PPP_TYPES[p.type].label})`, (c) => {
    const r = startNewBuild(base, c, { type: draft.type, points: draftPointsOn(c), names: draftNames(), lineName: draftLineName(), segFactor: dc.segFactor, extraCost: dc.extraCost,
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


// ------------------------------------------------------------ 구간 선택 (두 역·IC를 차례로 눌러)

let secPick = null;   // {mode, line, cls, picks: [노드]}

function startSection(linkId) {
  const l = linkAt(base, state, linkId);
  cancelDraft();
  if (straight) endStraighten();
  secPick = { mode: l.mode, line: l.name, cls: l.cls, picks: [] };
  map.getCanvas().style.cursor = 'crosshair';
  select({ type: 'section' });
}

function endSection() {
  secPick = null;
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
}

/** 누른 곳에서 가장 가까운 역·IC (철도는 역, 도로는 이름 있는 IC·JCT 또는 아무 교차점). 화면 30px 안 */
function sectionClick(ll) {
  const p = map.project(ll);
  const nn = nodeNames();
  const cand = new Set();
  allLinks().forEach((_, i) => {
    const e = linkAt(base, state, i);
    if (e.mode !== secPick.mode || state.replaced?.[i]) return;
    for (const n of [e.a, e.b]) cand.add(n);
  });
  const stations = secPick.mode >= 1 ? railStationSet() : null;
  let best = null, bd = 30;
  for (const n of cand) {
    if (stations && secPick.mode === 1 && !stations.has(n)) continue;
    if (secPick.mode === 2 && nn.get(n)?.kind !== 'station') continue;
    const c = nodeCoord(n);
    if (!c) continue;
    const q = map.project(c);
    const d = Math.hypot(q.x - p.x, q.y - p.y) - (nn.has(n) ? 6 : 0);   // 이름 있는 역·IC를 조금 더 잘 잡는다
    if (d < bd) { bd = d; best = n; }
  }
  if (best == null) return;
  if (secPick.picks.length >= 2) secPick.picks = [];
  secPick.picks.push(best);
  const f = secPick.picks.map((n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
  if (secPick.picks.length < 2) { renderSelection(); return; }
  const [A, B] = secPick.picks;
  const via = railPath(effectiveNetwork(base, state).links, A, B, secPick.line, secPick.mode);
  if (!via || !via.length) { alert('두 곳 사이 경로를 찾지 못했습니다.'); secPick.picks = []; renderSelection(); return; }
  const section = { A, B, line: secPick.line, cls: secPick.cls, mode: secPick.mode };
  const mode = secPick.mode;
  endSection();
  map.getCanvas().style.cursor = '';
  select({ type: 'multi', ids: via, section });
}

function sectionPanel() {
  const nn = nodeNames();
  const what = secPick.mode === 0 ? 'IC·교차점' : '역';
  return `${header('구간 선택')}
    <p class="hint">${esc(secPick.line || '')} 위의 ${what} 두 곳을 차례로 누르세요 (드래그하지 않아도 됩니다).
      ${secPick.picks.length ? `고른 곳: ${secPick.picks.map((n) => esc(nn.get(n)?.name || '이름 없는 교차점')).join(' → ')}` : ''}</p>
    <p class="hint">두 곳 사이 경로(같은 노선을 우선)가 선택되고, 그 구간만 개량하거나${secPick.mode === 1 ? ' 직선화하거나' : ''} 효과를 미리 볼 수 있습니다.</p>`;
}

// ------------------------------------------------------------ 누른 구간을 역과 역(IC와 IC) 사이로 넓히기

/**
 * 누른 링크에서 같은 이름·같은 수단의 링크를 따라 양쪽으로 가다가, 철도는 역에서, 도로는 이름 있는 IC·JCT나
 * 다른 간선(고속도로·간선국도·주요 도로)이 만나는 교차점에서 멈춘다. 갈림길(같은 노선이 세 갈래 이상)에서도 멈춘다.
 * @returns {{ids:number[], A:number, B:number}}
 */
function sectionOf(id) {
  const l0 = linkAt(base, state, id);
  const all = allLinks();
  const at = new Map();   // 노드 → 그 노드에 닿은 링크 id
  all.forEach((_, i) => {
    const e = linkAt(base, state, i);
    if (e.mode !== l0.mode || state.replaced?.[i] || e.replaced || (i >= base.links.length && !e.built)) return;
    for (const n of [e.a, e.b]) { if (!at.has(n)) at.set(n, []); at.get(n).push(i); }
  });
  const nn = nodeNames();
  const stations = l0.mode === 1 ? railStationSet() : null;
  const major = new Set(['motorway', 'trunk', 'primary']);
  const same = (i) => { const e = linkAt(base, state, i); return e.name === l0.name && e.cls === l0.cls; };
  const isStop = (n) => {
    const here = at.get(n) || [];
    if (here.filter(same).length !== 2) return true;          // 끝이나 갈림길
    if (l0.mode === 1) return stations.has(n);
    if (l0.mode === 2) return nn.get(n)?.kind === 'station';
    const k = nn.get(n)?.kind;
    if (k === 'IC' || k === 'JCT' || k === 'rest') return true;
    return here.some((i) => !same(i) && major.has(linkAt(base, state, i).cls));
  };
  if (!l0.name) return { ids: [id], A: l0.a, B: l0.b };
  const ids = [id];
  const walk = (from) => {
    let node = from, prev = id, km = 0;
    while (!isStop(node) && km < 80) {
      const next = (at.get(node) || []).find((i) => i !== prev && same(i) && !ids.includes(i));
      if (next == null) break;
      ids.push(next);
      const e = linkAt(base, state, next);
      km += e.len;
      node = e.a === node ? e.b : e.a;
      prev = next;
    }
    return node;
  };
  const A = walk(l0.a), B = walk(l0.b);
  return { ids, A, B };
}

// ------------------------------------------------------------ 역을 여러 개 골라 계통 짜기

let svcPick = null;   // {picks: [역 노드]}

function startServicePick(first = []) {
  cancelDraft();
  if (straight) endStraighten();
  if (secPick) endSection();
  svcPick = { picks: [...first] };
  map.getCanvas().style.cursor = 'crosshair';
  select({ type: 'svcpick' });
  drawServicePick();
}

/** 화면에서 누른 자리에서 가장 가까운(30px 안) 철도역 */
function nearestStation(ll) {
  const p = map.project(ll), stations = railStationSet();
  let best = null, bd = 30;
  for (const n of stations) {
    const c = nodeCoord(n);
    if (!c) continue;
    const q = map.project(c);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** 고른 역들 사이를 차례로 잇는 철도 경로: 지나는 역 순서(nodes)·노선(lines)·등급(cls). 길이 없으면 null */
function routeThrough(picks) {
  const net = effectiveNetwork(base, state), stSet = railStationSet();
  const lineKm = new Map(), nodes = [picks[0]], segs = [];
  for (let k = 0; k + 1 < picks.length; k++) {
    let via = railPath(net.links, picks[k], picks[k + 1], null);
    if (!via) return null;
    // 가장 빠른 길이 짧은 연결선을 여럿 거치면 계통이 지저분해진다: 길게 지나는 노선만 골라 그 노선을 따라 다시 찾는다
    const km = new Map();
    for (const i of via) { const l = net.links[i]; km.set(l.name, (km.get(l.name) || 0) + l.len); }
    const legKm = [...km.values()].reduce((a, b) => a + b, 0);
    const main = new Set([...km].filter(([, v]) => v >= Math.min(10, legKm * 0.15)).map(([n]) => n));
    via = railPath(net.links, picks[k], picks[k + 1], main) || via;
    segs.push({ a: picks[k], via });
    let node = picks[k];
    for (const i of via) {
      const l = net.links[i];
      if (l.name) lineKm.set(l.name, (lineKm.get(l.name) || 0) + l.len);
      node = l.a === node ? l.b : l.a;
      if (stSet.has(node) && nodes[nodes.length - 1] !== node) nodes.push(node);
    }
  }
  // 몇 km 안 되는 연결선은 계통 노선 목록에서 뺀다 (경로에는 그대로 쓰인다)
  const lines = [...lineKm].filter(([, v]) => v >= 3).map(([n]) => n);
  if (!lines.length) lines.push(...lineKm.keys());
  const cls = net.links.some((l) => lines.includes(l.name) && l.cls === 'hsr') && lines.every((n) => net.links.find((l) => l.name === n)?.cls === 'hsr') ? 'hsr' : 'conv';
  const under = net.links.filter((l) => lines.includes(l.name) && l.mode === 1 && !l.via);
  return { nodes: nodes.filter((n, i) => nodes.indexOf(n) === i), lines, cls, under, segs };
}

function drawServicePick() {
  const picks = svcPick.picks;
  const f = picks.map((n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  const r = picks.length >= 2 ? routeThrough(picks) : null;
  if (r) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: serviceCoords(effectiveNetwork(base, state).links, r.segs) } });
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
}

// ------------------------------------------------------------ 운행 계통을 지도에 노선으로

const SVC_COLORS = ['#e4572e', '#2e86de', '#20a35a', '#9b59b6', '#f0a202', '#d6337f', '#0fa3b1', '#7a5c3e', '#596275', '#c0392b', '#6ab04c', '#30336b'];
let showServices = true;
try { showServices = localStorage.getItem('ukt-svc-lines') !== '0'; } catch { /* 기본은 켬 */ }

function svcColor(s, k) {
  // 예전 저장의 기본 계통은 색이 없다: 실제 노선도 색으로
  return s.color || (s.existing && EXISTING_SERVICES.find((x) => x.name === s.name)?.color) || SVC_COLORS[Math.max(0, k) % SVC_COLORS.length];
}

/** 새 계통 색: 아직 안 쓴 색부터 */
function nextSvcColor() {
  const used = new Set((state.services || []).map((s, k) => svcColor(s, k)));
  return SVC_COLORS.find((c) => !used.has(c)) || SVC_COLORS[(state.services || []).length % SVC_COLORS.length];
}

/** 계통 구간(a에서 via를 따라)들을 이은 좌표 */
function serviceCoords(links, segs) {
  const out = [];
  for (const sg of segs) {
    const c = pathCoords(links, sg.via, sg.a);
    out.push(...(out.length ? c.slice(1) : c));
  }
  return out;
}

/** 운행 계통을 계통 색의 노선으로 그린다 (차량 제작 중이면 옅게, 같은 선로를 지나는 계통은 옆으로 비켜) */
function drawServices() {
  const src = map?.getSource('services');
  if (!src || !state) return;
  const f = [];
  if (showServices && state.services?.length) {
    const links = effectiveNetwork(base, state).links;
    state.services.forEach((s, k) => {
      if (svcEdit?.id === s.id) return;   // 고치는 중인 계통은 편집 미리보기로
      const c = serviceCoords(links, s.segs || []);
      if (c.length > 1) f.push({ type: 'Feature', properties: { id: s.id, color: svcColor(s, k), off: ((k % 5) - 2) * 2.5, built: s.built ? 1 : 0 }, geometry: { type: 'LineString', coordinates: c } });
    });
  }
  src.setData({ type: 'FeatureCollection', features: f });
}

/** 계통 편집 중: 지금 고른 정차역과 경로를 지도에 */
function drawServiceEdit() {
  const e = svcEdit;
  if (!e) return;
  const { plan } = servicePlan();
  const f = [...e.stops].filter((n) => nodeCoord(n)).map((n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  if (plan) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: serviceCoords(effectiveNetwork(base, state).links, plan.segs) } });
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
  const src = map.getSource('services');
  if (src && e.id) drawServices();
}

/** 계통 편집 중 지도에서 역을 누르면: 계통 위 역은 정차를 넣고 빼고, 계통 밖 역은 가장 덜 돌아가는 자리에 넣어 경로를 늘린다 */
function serviceEditClick(ll) {
  const e = svcEdit, n = nearestStation(ll);
  if (n == null) return;
  if (e.nodes.includes(n)) {
    if (e.stops.has(n)) e.stops.delete(n); else e.stops.add(n);
    renderSelection();
    return;
  }
  const stops = e.nodes.filter((x) => e.stops.has(x));
  const d = (a, b) => { const p = nodeCoord(a), q = nodeCoord(b); return kmBetween(p[0], p[1], q[0], q[1]); };
  let at = 0, bc = Infinity;
  for (let k = 0; k <= stops.length; k++) {
    const cost = !stops.length ? 0 : k === 0 ? d(n, stops[0]) : k === stops.length ? d(stops[k - 1], n) : d(stops[k - 1], n) + d(n, stops[k]) - d(stops[k - 1], stops[k]);
    if (cost < bc) { bc = cost; at = k; }
  }
  const picks = [...stops.slice(0, at), n, ...stops.slice(at)];
  const r = picks.length >= 2 ? routeThrough(picks) : null;
  if (!r) { alert('이 역까지 이어지는 철도 경로가 없습니다.'); return; }
  e.lines = r.lines; e.line = r.lines[0]; e.nodes = r.nodes;
  e.stops.add(n);
  renderSelection();
}

function endServicePick() {
  svcPick = null;
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
}

function servicePickClick(ll) {
  const best = nearestStation(ll);
  if (best == null) return;
  const k = svcPick.picks.indexOf(best);
  if (k >= 0) svcPick.picks.splice(k, 1); else svcPick.picks.push(best);   // 다시 누르면 뺀다
  drawServicePick();
  renderSelection();
}

function servicePickPanel() {
  const nn = nodeNames(), picks = svcPick.picks;
  return `${header('역 골라 계통 짜기')}
    <p class="hint">열차가 설 역을 지도에서 차례로 누르세요 (다시 누르면 빠집니다). 노선이 달라도 됩니다 — 사이 경로와 지나는 노선은 저절로 잡고 지도에 미리 그립니다.</p>
    <div class="m">${picks.map((n, i) => `${i + 1}. ${esc(nn.get(n)?.name || '')}`).join(' → ') || '아직 고른 역이 없습니다.'}</div>
    <div class="actions">
      <button class="primary" id="sp-ok" ${picks.length >= 2 ? '' : 'disabled'}>이 역들로 계통 만들기</button><button id="sp-cancel">취소</button></div>`;
}

/** 고른 역들을 차례로 잇는 경로를 찾아, 지나는 노선·역 순서로 계통 편집 창을 연다 */
function commitServicePick() {
  const picks = svcPick.picks;
  const r = routeThrough(picks);
  if (!r) { alert('고른 역 사이를 잇는 철도 경로가 없습니다.'); return; }
  const { nodes, lines, cls, under } = r;
  const nn = nodeNames();
  const kind = picks.length <= Math.max(3, nodes.length / 4) ? 'limited' : 'express';
  svcEdit = { line: lines[0], lines, cls, kind, name: `${nn.get(picks[0])?.name}–${nn.get(picks[picks.length - 1])?.name} ${SERVICE_KINDS[kind].label}`,
    type: defaultTrainType(cls, under), sets: 4, nodes, stops: new Set(picks), id: null, nameEdited: false, color: nextSvcColor() };
  endServicePick();
  select({ type: 'service' });
}

function header(title) {
  return `<div class="sel-head"><h3>${esc(title)}</h3><button class="small close" title="닫기 (Esc)">닫기</button></div>`;
}

function linkPanel(id) {
  const l = linkAt(base, state, id);
  // 분리 차로 쌍은 합친 값 (지도 색과 같게)
  const vc = shownTraffic ? shownTraffic.vc[linkTwins[id]] : 0, vol = shownTraffic ? shownTraffic.vol[linkTwins[id]] : 0;
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
       <tr><td>규격</td><td>${railStd(l) ? '개량 전 북측 철도 (교류 25kV 전철화하면 남측 규격)' : '남측 규격'}</td></tr>
       <tr><td>최고 운행 속도</td><td>${l.speed} km/h</td></tr>
       <tr><td>이용객</td><td>${Math.round(vol).toLocaleString()} 명/일</td></tr>`;
  // 누른 곳이 속한 역–역(IC–IC) 구간
  const sec = selection?.type === 'link' && selection.id === id ? selection.section : null;
  const secIds = sec?.ids || [id];
  const secKm = secIds.reduce((s0, x) => s0 + linkAt(base, state, x).len, 0);
  const nnS = nodeNames();
  const secLabel = sec && secIds.length > 1 ? `${nnS.get(sec.A)?.name || '교차로'} – ${nnS.get(sec.B)?.name || '교차로'}` : '';
  return `${header(l.name || CLASS_LABEL[l.cls])}
    ${secLabel ? `<p class="hint">선택 구간: <b>${esc(secLabel)}</b> · ${secKm.toFixed(1)}km (${secIds.length}개 링크). 개량은 이 구간 전체에 적용됩니다.</p>` : ''}
    <table class="kv">
      <tr><td>종류</td><td>${CLASS_LABEL[l.cls]} · ${l.kp ? '북' : '남'}</td></tr>
      ${operatorOf(state, l) ? `<tr><td>운영사</td><td>${opBadge(state, operatorOf(state, l))}</td></tr>` : ''}
      <tr><td>연장</td><td>${l.len.toFixed(1)} km</td></tr>
      ${rows}
      <tr><td>혼잡도 (V/C)</td><td class="${vc > 1 ? 'neg' : ''}">${vc.toFixed(2)}</td></tr>
    </table>
    ${l.mode >= 1 && l.name && !l.ext && !planned ? serviceSection(l) : ''}
    ${!planned && !busyProj ? reopenHTML(id, l) : ''}
    ${isNew && l.name ? `<h4>노선 이름</h4><div class="name-row"><input type="text" id="line-rename" value="${esc(l.name)}">
      <button class="small" id="line-rename-ok">바꾸기</button></div>` : ''}
    ${planned ? `<p class="hint">진행 중인 사업 구간입니다: ${esc(osmProj?.label || '')} · ${osmProj ? `${osmProj.doneYear}년 개통 예정` : ''}. 사업 탭에서 예산 투입 속도를 바꿀 수 있습니다.</p>`
    : l.ext ? '<p class="hint">국외 거점과 잇는 국경 연결 구간입니다. 개량 대상이 아닙니다.</p>'
    : l.cls === 'ferry' ? '<p class="hint">여객선 항로입니다. 개량 대상이 아닙니다.</p>'
    : busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>` : `<h4>개량</h4>
    <div class="actions"><button class="small sec-start" title="두 역·IC를 차례로 눌러 그 사이만 고릅니다">구간 선택 (${l.mode === 0 ? 'IC' : '역'} 두 곳 누르기)</button>
      ${l.mode >= 1 ? '<button class="small" data-padd="station" title="노선 위 한 점을 눌러 역을 놓습니다">이 노선에 역 신설</button>' : l.cls === 'motorway' ? '<button class="small" data-padd="ic">IC 신설</button>' : ''}
      ${l.mode === 1 ? '<button class="small" data-st-start title="두 역 사이를 단순한 곡선으로 새로 놓고 옛 구간은 폐선합니다. 사이 역은 눌러서 자동·제자리 유지·폐역을 고릅니다">구간 직선화</button>' : ''}</div>
    ${l.mode === 1 ? fundSelect([operatorOf(state, l)]) : ''}
    ${route.length > 1 ? `<label class="name-row"><input type="checkbox" id="whole-route" ${wholeRoute ? 'checked' : ''}>
      <span>같은 이름 노선 전체 (${route.length}개 구간, ${routeKm.toFixed(0)}km)</span></label>` : ''}
    <div class="list">${ups.map((u) => {
      const ids = (wholeRoute && route.length > 1 ? route : secIds).filter((x) => u.applies(linkAt(base, state, x)));
      const cost = ids.reduce((sum, x) => sum + upgradeCost(u, linkAt(base, state, x)), 0);
      const ok = canAfford(state, cost, u.years, fundFor(state, ids.map((x) => linkAt(base, state, x))));
      return `<div class="item opt"><div class="opt-row">
        <span>${resolve(u.label, l)}${ids.length > 1 ? ` · ${ids.length}개 구간` : ''}</span>
        <span class="btns"><button class="small" data-prev-up="${u.id}" title="다 지었을 때 효과">미리보기</button>
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
  const sc = selection?.type === 'multi' ? selection.section : null;
  const nn = nodeNames();
  const title = sc ? `${nn.get(sc.A)?.name || '교차점'} – ${nn.get(sc.B)?.name || '교차점'} 구간` : `${label} ${pool.length}개 구간 선택`;
  return `${header(title)}
    ${sc ? `<div class="actions">${sc.mode === 1 ? '<button class="small" id="sec-straight">이 구간 직선화</button>' : ''}
      <button class="small" id="sec-prev">첫 개량 효과 미리보기</button><button class="small sec-start">다른 구간 고르기</button></div>` : ''}
    <p class="hint">${km[mode].toFixed(0)}km · ${names.map(esc).join(', ')}${names.length === 6 ? ' 등' : ''}${pool.length < ids.length ? ` (다른 수단·공사 중 구간 ${ids.length - pool.length}개 제외)` : ''}<br>Shift를 누른 채 구간을 누르면 더하거나 빼고, Shift를 누른 채 끌면 상자 안 구간을 한꺼번에 고릅니다.</p>
    <div class="list">${ups.map(({ u, app, cost, len }) => {
      const ok = canAfford(state, cost, u.years);
      return `<div class="item opt"><div class="opt-row">
        <span>${resolve(u.label, linkAt(base, state, app[0]))} · ${app.length}개 구간 ${len.toFixed(0)}km</span>
        <button class="small ${ok ? 'primary' : ''}" data-mup="${u.id}" data-ids="${JSON.stringify(app)}" ${ok ? '' : 'disabled'}>${formatWon(cost)} · ${u.years}년</button></div></div>`;
    }).join('') || '<p class="hint">고른 구간에 가능한 개량이 없습니다.</p>'}</div>`;
}

// ------------------------------------------------------------ 폐선 재개통 (수려선·금강산선 등, data/closed_lines.json)

let closedLines = [];
const CLOSED_REUSE = 0.7;   // 옛 노반·터널·교량 자리를 다시 쓰므로 새로 놓는 것보다 싸다

/** 재개통 사업을 벌인(공사 중·완공) 폐선은 지도에서 뺀다 */
function closedTaken() {
  const out = new Set(state.projects.filter((p) => p.closedLine != null && p.status !== 'cancelled').map((p) => p.closedLine));
  // 같은 노선의 복원 계획(plans.json closedLine)을 벌였으면 그 폐선도 이미 벌인 사업이다 (금강산선 복원 = 금강산선 재개통)
  for (const p of state.projects) {
    if (p.status === 'cancelled' || !p.plan) continue;
    const name = plans.find((x) => x.id === p.plan)?.closedLine;
    if (name) closedLines.forEach((c) => { if (c.name === name) out.add(c.id); });
  }
  return out;
}

/** 폐선 재개통과 같은 사업인 복원 계획 id들 (그 폐선을 이미 재개통했으면 계획 목록에서도 벌인 것으로) */
function plansTakenByClosed() {
  const names = new Set(state.projects.filter((p) => p.closedLine != null && p.status !== 'cancelled')
    .map((p) => closedLines.find((c) => c.id === p.closedLine)?.name).filter(Boolean));
  return plans.filter((x) => x.closedLine && names.has(x.closedLine)).map((x) => x.id);
}

function refreshClosed() {
  if (!map?.getSource('closed')) return;
  const taken = closedTaken();
  map.getSource('closed').setData({ type: 'FeatureCollection', features: closedLines.filter((c) => !taken.has(c.id)).map((c) => ({
    type: 'Feature', properties: { id: c.id, name: c.label }, geometry: { type: 'LineString', coordinates: c.geom } })) });
}

function closedCost(c, type) {
  return Math.round(NEW_BUILDS[type].perKm * c.km * CLOSED_REUSE * (c.country === 'KP' ? KP_COST_FACTOR : 1));
}

function closedPanel(id) {
  const c = closedLines.find((x) => x.id === id);
  if (!c) return header('폐선');
  const taken = closedTaken().has(id);
  const opt = (type) => {
    const spec = NEW_BUILDS[type], cost = closedCost(c, type), ok = canAfford(state, cost, spec.years);
    return `<div class="item opt"><div class="opt-row"><span>${spec.label.replace('신설 ', '')}</span>
      <button class="small ${ok ? 'primary' : ''}" data-closed-go="${type}" ${ok && !taken ? '' : 'disabled'}>${formatWon(cost)} · ${spec.years}년</button></div></div>`;
  };
  return `${header(`${c.label} (폐선)`)}
    <table class="kv"><tr><td>연장</td><td>${c.km.toFixed(1)} km · ${c.country === 'KP' ? '북' : '남'}</td></tr>
      <tr><td>옛 역</td><td>${c.stations.length ? c.stations.map((s) => esc(s[0])).join(' · ') : '기록 없음'}</td></tr></table>
    <p class="hint">문을 닫은 철도입니다. 옛 노선 자리를 따라 다시 놓고 옛 역 자리에 역을 엽니다. 노반 자리를 다시 써서 새로 놓는 것보다 30% 쌉니다.
      양 끝이 지금 철도역 가까이(1.5km 안)면 그 역에 잇습니다. 다 지은 뒤 구간을 눌러 복선화·전철화할 수 있습니다.</p>
    ${taken ? '<p class="hint">이미 재개통 사업을 벌였습니다.</p>' : `<div class="list">${opt('rail1')}${opt('rail')}</div>`}`;
}

/** 폐선 도형을 따라 선형 점(via)을, 옛 역 자리에 역을 둔 그리기 점 목록 */
function closedPoints(c) {
  const g = c.geom;
  const cum = [0];
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + kmBetween(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]));
  const along = (x, y) => {   // 선 위 가장 가까운 자리의 누적 거리
    let best = 0, bd = Infinity;
    for (let i = 1; i < g.length; i++) {
      const [ax, ay] = g[i - 1], [bx, by] = g[i];
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2;
      if (d < bd) { bd = d; best = cum[i - 1] + t * (cum[i] - cum[i - 1]); }
    }
    return best;
  };
  const sts = c.stations.map(([name, x, y]) => ({ s: along(x, y), name, lon: x, lat: y })).sort((a, b) => a.s - b.s);
  const items = [
    ...g.map(([x, y], i) => ({ s: cum[i], lon: x, lat: y, via: true })),
    ...sts.map((t) => ({ s: t.s, lon: t.lon, lat: t.lat, name: t.name })),
  ].sort((a, b) => a.s - b.s);
  // 역 가까이(300m)·서로 너무 붙은(500m) 선형 점은 뺀다. 양 끝은 늘 남긴다
  const out = [];
  items.forEach((it, k) => {
    const end = k === 0 || k === items.length - 1;
    if (it.via && !end) {
      if (sts.some((t) => Math.abs(t.s - it.s) < 0.3)) return;
      const prev = out[out.length - 1];
      if (prev && it.s - prev.s < 0.5) return;
    }
    out.push(it);
  });
  // 끝: 지금 철도역(없으면 철도 노드) 1.5km 안이면 거기에 잇는다
  const stSet = new Set(effectiveNetwork(base, state).stations);
  const railNodes = nodesOfMode(1);
  const snapEnd = (it) => {
    let best = null, bd = 1.5;
    for (const n of railNodes) {
      const p = nodeCoord(n);
      if (!p || Math.abs(p[1] - it.lat) > 0.02) continue;
      const d = kmBetween(it.lon, it.lat, p[0], p[1]) - (stSet.has(n) ? 0.5 : 0);   // 역을 조금 더 반긴다
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  for (const k of [0, out.length - 1]) {
    const it = out[k];
    const n = snapEnd(it);
    it.via = false;
    if (n != null) { const p = nodeCoord(n); Object.assign(it, { node: n, lon: p[0], lat: p[1], name: null }); }
  }
  // 끝에 붙은 지금 역 바로 옆(1km 안)의 옛 역은 같은 역으로 본다
  return out.filter((it, k) => !(k > 0 && k < out.length - 1 && !it.via && [out[0], out[out.length - 1]].some((e) => e.node != null && kmBetween(e.lon, e.lat, it.lon, it.lat) < 1)));
}

function startClosedReopen(id, type) {
  const c = closedLines.find((x) => x.id === id);
  if (!c || closedTaken().has(id)) return;
  const pts = closedPoints(c);
  const points = pts.map((it) => ({ node: it.node ?? null, lon: it.lon, lat: it.lat, split: null, via: !!it.via }));
  const names = {};
  pts.forEach((it, i) => {
    if (it.via || it.node != null) return;
    const name = it.name || (namer ? namer.suggest(it.lon, it.lat, 'station') : `${c.name}역`);
    names[i] = { name, kind: 'station', auto: !it.name };
  });
  const segFactor = points.slice(1).map(() => CLOSED_REUSE);
  const n0 = state.projects.length;
  // 양 끝은 기존 선로에 접선으로 붙는다 (옛 선형이 지금 역에 비스듬히 들어오던 것: 토해선–개풍 등)
  const r = startNewBuild(base, state, { type, points: withTangents(points, NEW_BUILDS[type].mode), names, lineName: c.name, title: `${c.label} 재개통`, segFactor });
  if (!r.ok) { alert(r.reason); return; }
  if (state.projects.length > n0) state.projects[state.projects.length - 1].closedLine = id;
  save(state); refreshClosed(); refreshLinks(); renderAll(); switchTab('projects');
  if (state.projects.length > n0) showGazette(state.projects[state.projects.length - 1], { fromBuild: true });
}

// ------------------------------------------------------------ 여객 재개통 (역이 없거나 거의 없어 아무도 타지 않는 선로)

const REOPEN = { perKm: 30, station: 150, years: 2, minPop: 1500, spacingKm: 4, maxStations: 15 };

/** 노선(같은 이름 구간들) 위 노드 가운데 반경 2km 인구가 많은 곳을 서로 4km 이상 떨어지게 골라 역 자리로 */
function reopenPlan(id) {
  const route = sameRoute(id).filter((i) => !(i < base.links.length && linkPending(base, state, i)) && !state.replaced?.[i]);
  const stations = new Set(effectiveNetwork(base, state).stations);
  const nodes = new Set();
  let km = 0, kp = 0;
  for (const i of route) { const l = linkAt(base, state, i); nodes.add(l.a); nodes.add(l.b); km += l.len; if (l.kp) kp += l.len; }
  const have = [...nodes].filter((n) => stations.has(n));
  if (have.length > Math.max(1, km / 15)) return null;   // 역이 이미 넉넉하면 재개통 대상이 아니다
  const far = (n, list) => list.every((m) => { const a = nodeCoord(n), b = nodeCoord(m); return kmBetween(a[0], a[1], b[0], b[1]) >= REOPEN.spacingKm; });
  const cand = [...nodes].filter((n) => !stations.has(n)).map((n) => { const c = nodeCoord(n); return { n, pop: c ? popNear(c[0], c[1], 2) : 0 }; })
    .filter((x) => x.pop >= REOPEN.minPop).sort((a, b) => b.pop - a.pop);
  const pick = [];
  for (const x of cand) {
    if (pick.length >= REOPEN.maxStations) break;
    if (far(x.n, [...have, ...pick.map((p) => p.n)])) pick.push(x);
  }
  if (!pick.length) return null;
  const f = kp * 2 > km ? KP_COST_FACTOR : 1;
  const cost = Math.round((REOPEN.perKm * km + REOPEN.station * pick.length) * f);
  return { route, km, pick, cost, pop: pick.reduce((s, x) => s + x.pop, 0) };
}

function reopenHTML(id, l) {
  if (l.mode !== 1 || l.cls === 'hsr' || l.ext) return '';
  const r = reopenPlan(id);
  if (!r) return '';
  const ok = canAfford(state, r.cost, REOPEN.years);
  return `<h4>여객 재개통</h4>
    <p class="hint">${esc(l.name || '이 선로')}: 여객역이 거의 없어 이용객이 없습니다. 선로를 손보고(시속 ${REOPEN_SPEED}km까지) 인구가 많은 ${r.pick.length}곳에 역을 열면 여객 열차가 다닙니다.
      (역 반경 2km 인구 합계 ${fmtPeople(r.pop)}, 노선 ${r.km.toFixed(0)}km)</p>
    <div class="actions"><button class="small ${ok ? 'primary' : ''}" id="reopen-go" ${ok ? '' : 'disabled'}>재개통 ${formatWon(r.cost)} · ${REOPEN.years}년</button></div>`;
}

function startReopen(id) {
  const r = reopenPlan(id);
  if (!r) return;
  if (!canAfford(state, r.cost, REOPEN.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const l = linkAt(base, state, id);
  const newNames = {};
  for (const x of r.pick) { const c = nodeCoord(x.n); newNames[x.n] = { name: namer ? namer.suggest(c[0], c[1], 'station') : `${l.name || ''}역`, kind: 'station', auto: true }; }
  startProject(state, { id: crypto.randomUUID(), kind: 'reopen', links: [], relinks: r.route, stations: r.pick.map((x) => x.n), newNames,
    cost: r.cost, years: REOPEN.years, fund: fundFor(state, [l]), label: `${l.name || '선로'} 여객 재개통 (역 ${r.pick.length}곳)` });
  save(state); renderAll();
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
  // 한 시군으로 보이는 존들(옛 군 땅 조각 포함)을 합쳐 보인다: 인구·순이동은 더하고, 나머지는 인구 가중 평균
  const zs = countyZones(id);
  const pop = zs.reduce((s, j) => s + r.pop[j], 0), pop0 = zs.reduce((s, j) => s + Math.max(zoneProps[j].pop, 0), 0);
  const avg = (arr) => (pop > 0 ? zs.reduce((s, j) => s + arr[j] * r.pop[j], 0) / pop : arr[id]);
  const main = zs.reduce((b, j) => (r.pop[j] > r.pop[b] ? j : b), zs[0]);
  const st = r.station[main];
  const stName = st >= 0 ? nodeNames().get(st)?.name : null;
  const change = pop / Math.max(pop0, 1) - 1;
  const accRef = median(Array.from(r.access));
  const targets = historic.filter((t) => zs.includes(t.zone));
  const hists = [...new Set(zs.map((j) => zoneProps[j].hist).filter((h) => h && h !== name))];
  return `${header(name)}
    <table class="kv">
      <tr><td>소속</td><td>${esc(regionOf(state, z))} (${z.country === 'KP' ? '북' : '남'})${name !== z.name ? ` · 원래 이름 ${esc(z.name)}` : ''}</td></tr>
      ${hists.length ? `<tr><td>분단 전</td><td>옛 ${hists.map(esc).join('·')} 땅이 들어 있습니다<br><span class="hint">민원·정책 탭 › 행정구역 정리에서 되살릴 수 있습니다 (${START_YEAR}년)</span></td></tr>` : ''}
      ${happiness ? `<tr><td>주민 행복도</td><td>${avg(happiness).toFixed(1)}</td></tr>` : ''}
      <tr><td>인구</td><td>${fmtPop(pop)} <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>지난해 순이동</td><td>${Math.round(zs.reduce((s, j) => s + r.netMig[j], 0)).toLocaleString()}명</td></tr>
      <tr><td>HDI</td><td>${avg(r.hdi).toFixed(3)}</td></tr>
      <tr><td>기대수명</td><td>${avg(r.le).toFixed(1)}세</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(avg(r.income)).toLocaleString()}</td></tr>
      <tr><td>접근성 (중앙값=1)</td><td>${(avg(r.access) / accRef).toFixed(2)}</td></tr>
      <tr><td>이용 철도역</td><td>${stName ? esc(stName) : '없음 (25km 밖)'}</td></tr>
    </table>
    ${localZoneHTML(id)}
    ${sezHTML(id)}
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
  const restored = state.adminNames?.[`${t.level === 'zone' ? 'z' : 'u'}:${t.id}`];
  const status = restored ? '완료 (행정구역 정리)' : proj ? (proj.status === 'done' ? '완료' : `${proj.doneYear}년 완료 예정`) : '';
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
      <tr><td>교통 체감 개선 (시작 대비)</td><td class="${(gains?.[i] || 0) >= 0 ? 'pos' : 'neg'}">${(gains?.[i] || 0) >= 0 ? '+' : ''}${(gains?.[i] || 0).toFixed(1)}점</td></tr>
      <tr><td>주민 행복도 · 지지율</td><td>${subMetric('subHappy', i)?.toFixed(0) ?? '–'} · ${Math.round(subMetric('subApproval', i) ?? 0)}%</td></tr>
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
    ${ap.ext ? '' : airportRailHTML(id, k)}
    ${ap.ext ? '' : busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>`
      : `<div class="actions"><button class="small primary" id="ap-expand">${AIRPORT.expand.label} ${formatWon(cost)} · ${AIRPORT.expand.years}년</button></div>`}
    ${routePanel(id, k)}`;
}

/** 공항 패널: 공항역(철도 연결) */
function airportRailHTML(id, k) {
  const st = k >= 0 ? result?.air.railStation?.[k] : -1;
  if (st >= 0) {
    const n = nodeNames().get(st);
    return `<p class="hint">공항역: <b>${esc(n?.name || '역')}</b> · ${linesAt(st).filter((l) => l.named).map((l) => esc(l.name)).join(', ')}. 철도로 오는 편이 빠른 지역은 철도로 공항에 옵니다.</p>`;
  }
  return '<p class="hint">공항역이 없습니다. 건설 탭에서 철도·도시철도를 그리며 공항 아이콘 가까이를 누르면 공항역이 생기고, 완공되면 철도로 공항에 올 수 있어 공항 이용이 늘어납니다.</p>';
}

function airportName(id) {
  return effectiveNetwork(base, state).airports.find((a) => a.id === id)?.name.replace(/\s*(국제공항|공항|비행장)$/, '').trim() || id;
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
      return `<div class="item opt"><div class="opt-row">
        <span>${esc(airportName(other))} · 하루 ${f}회 · ${pax.toLocaleString()}명 · 탑승률 <span class="${load > 1 ? 'neg' : ''}">${Math.round(load * 100)}%</span>
          <span class="m">${ORIGIN[r?.origin] || ''}</span><br>${airlinesHTML(id, other, f)}</span>
        <button class="small" data-close-route="${key}">운항 중단</button></div></div>`;
    }).join('') || '<p class="hint">운항 중인 노선이 없습니다.</p>'}</div>
    ${latent.length ? `<h4>잠재 수요가 큰 미취항 노선</h4><div class="list">${latent.map(([a, b, pax]) => {
      const other = air.ids[a === k ? b : a];
      return `<div class="item opt"><div class="opt-row">
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
  // 국외 거점 도시는 '해외 도시', 도로 없는 섬의 항구(독도)는 대한민국의 섬
  const abroad = n.kind === 'city' ? foreignCountry(id) : null;
  const island = n.kind === 'city' && !abroad;
  const kindLabel = { station: '역', IC: 'IC', JCT: 'JCT', rest: '휴게소' }[n.kind] || (abroad ? '해외 도시' : island ? '섬' : '');
  const origin = n.isNew ? (state.names[id]?.auto ? ' · 자동 이름' : ' · 직접 지은 이름') : n.kind === 'city' ? '' : ' · 기존 시설 (OSM)';
  return `${header(n.name)}
    <p class="hint">${kindLabel}${origin}</p>
    ${n.kind === 'city' ? placeIntroHTML(n.name, abroad || 'KR') : ''}
    ${n.kind === 'station' ? stationPanel(id, n) : ''}
    <h4>이름</h4>
    <div class="name-row"><input type="text" id="node-name" value="${esc(n.name)}">
      <button class="small" id="node-save">바꾸기</button>
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

// ------------------------------------------------------------ 착공 고시문 (계획안 공문서)

const GZ_COLOR = { hsr: '#1f5fd1', gtx: '#0c7d8c', rail: '#7b3fa0', rail1: '#7b3fa0', metro: '#1a9a6c', motorway: '#2e7d4f', trunk: '#3f8f5a', tunnelRoad: '#2e7d4f', tunnelRail: '#1f5fd1' };
const GZ_AUTO = 'ukt-gazette-auto';

function gazetteAuto() {
  try { return localStorage.getItem(GZ_AUTO) !== '0'; } catch { return true; }
}

/** 기존 노선 짧은 이름 (환승 표시용) */
function shortLine(name) {
  return String(name || '').replace(/^(서울 지하철|수도권 전철|부산 도시철도|대구 도시철도|광주 도시철도|대전 도시철도|인천 도시철도)\s*/, '')
    .replace(/^수도권광역급행철도\s*/, 'GTX-').replace(/인천국제공항선/, '공항철도').slice(0, 7);
}

/** 사업(새 노선)의 고시문 자료. 새 노선 사업이 아니면 null */
function gazetteData(p) {
  if (!p || p.kind !== 'new' || !(p.links || []).length) return null;
  const spec = NEW_BUILDS[p.type];
  if (!spec) return null;
  const mine = new Set(p.links);
  const ls = p.links.map((id) => linkAt(base, state, id)).filter(Boolean);
  if (!ls.length) return null;
  const rail = spec.mode >= 1;
  const lineName = ls[0].name || p.label.replace(/\s*\(.*$/, '');
  const color = GZ_COLOR[p.type] || '#7b3fa0';
  // 노선을 따라 노드 차례와 누적 거리
  const cum = new Map([[ls[0].a, 0]]);
  const order = [ls[0].a];
  const path = [];
  let km = 0;
  for (const l of ls) {
    const g = [];
    for (let k = 0; k + 1 < (l.geom || []).length; k += 2) if (l.geom[k] === l.geom[k]) g.push([l.geom[k], l.geom[k + 1]]);
    const A = nodeCoord(l.a);
    if (g.length && A && kmBetween(A[0], A[1], g[0][0], g[0][1]) > kmBetween(A[0], A[1], g[g.length - 1][0], g[g.length - 1][1])) g.reverse();
    path.push(...(path.length ? g.slice(1) : g));
    km += l.len || 0;
    cum.set(l.b, km);
    order.push(l.b);
  }
  const names = nodeNames();
  // 새 정거장과, 노선이 지나는 기존 역(환승역)
  const stSet = new Set(effectiveNetwork(base, state).stations);
  const stops = rail ? order.filter((n) => (p.stations || []).includes(n) || stSet.has(n))
    : order.filter((n, i) => i === 0 || i === order.length - 1 || names.get(n));
  const code0 = 101;
  const stations = stops.map((n, i) => {
    const c = nodeCoord(n);
    const zi = zoneAtPoint(c[0], c[1]);
    const zf = zonesFC.features[zi]?.properties || {};
    const others = rail ? linesAt(n).filter((x) => !mine.has(x.link) && x.name !== lineName) : [];
    const transfers = others.map((x) => {
      const raw = allLinks()[x.link];
      const col = raw?.colour || (x.cls === 'hsr' ? '#1f5fd1' : x.mode === 2 ? '#1a9a6c' : '#7b3fa0');
      return { name: x.name, short: shortLine(x.name), color: col };
    });
    return {
      node: n, name: names.get(n)?.name || (rail ? `${code0 + i}정거장` : `${i + 1}`), code: rail ? String(code0 + i) : '', km: cum.get(n) || 0,
      // 소재지는 게임 속 지금 이름으로 (행정구역 정리로 바뀐 소속 도·시군 이름: 간성군 등)
      lon: c[0], lat: c[1], transfers, isNew: n >= base.nodes.length,
      place: zi >= 0 ? [regionOf(state, zoneProps[zi]) || zf.province, zoneName(zi)].filter(Boolean).join(' ') : '',
    };
  });
  if (!stations.length) return null;
  const first = stations[0], last = stations[stations.length - 1];
  // 위치도 범위와 둘레 (시군구 경계, 기존 철도·간선도로, 시군구 이름)
  const xs = path.map((q) => q[0]), ys = path.map((q) => q[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padX = Math.max((x1 - x0) * 0.12, 0.02), padY = Math.max((y1 - y0) * 0.12, 0.016);
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const inBox = ([x, y]) => x > x0 && x < x1 && y > y0 && y < y1;
  const boundaries = [];
  for (const f of zonesFC.features) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) if (poly[0].some(inBox)) boundaries.push(poly[0]);
  }
  const lines = [];
  allLinks().forEach((l, i) => {
    if (mine.has(i) || l.ext || state.replaced?.[i]) return;
    const e = linkAt(base, state, i);
    if (e.mode === 0 && !['motorway', 'trunk'].includes(e.cls)) return;
    const g = [];
    for (let k = 0; k + 1 < (l.geom || []).length; k += 2) if (l.geom[k] === l.geom[k]) g.push([l.geom[k], l.geom[k + 1]]);
    if (g.length < 2 || !g.some(inBox)) return;
    const col = e.mode === 0 ? '#d9c9a3' : l.colour || (e.cls === 'hsr' ? '#7fa0de' : e.mode === 2 ? '#8cc9ad' : '#b9a3cc');
    lines.push({ pts: g, color: col, w: e.mode === 0 ? 1.6 : 2 });
  });
  const labels = zoneProps.map((z) => (z.ext || !inBox([z.cx, z.cy]) ? null : { name: z.name, at: [z.cx, z.cy] })).filter(Boolean);
  // 고시 번호·날짜 (사업마다 고정)
  const h = [...p.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const seq = 100 + state.projects.indexOf(p) + 1;
  const date = `${p.startYear}. ${1 + (h % 12)}. ${1 + ((h >> 4) % 28)}.`;
  const kp = ls.every((l) => l.kp);
  const kindWord = (p.type === 'metro' || p.type === 'lrt') ? '도시철도' : p.type === 'hsr' ? '고속철도' : p.type === 'gtx' ? '광역급행철도' : rail ? '철도' : '도로';
  const reopen = p.closedLine != null || !!plans.find((x) => x.id === p.plan)?.closedLine;
  const title = reopen ? `「${lineName} 재개통 사업」 기본계획 고시`
    : (p.type === 'metro' || p.type === 'lrt') ? `「${lineName} 도시철도 건설사업」 기본계획 승인 고시`
      : rail ? `「${lineName} ${p.extension ? '연장 ' : ''}건설사업」 기본계획 고시` : `「${lineName} 건설사업」 도로구역 결정 고시`;
  const law = (p.type === 'metro' || p.type === 'lrt') ? '「도시철도법」' : rail ? '「철도의 건설 및 철도시설 유지관리에 관한 법률」' : '「도로법」';
  const lead = rail
    ? `${law}에 따라 ${lineName} 건설사업의 기본계획을 다음과 같이 수립하였으므로 이를 고시합니다.`
    : `${law}에 따라 ${lineName} 건설사업의 도로구역을 다음과 같이 결정하였으므로 이를 고시합니다.`;
  const total = p.cost;
  const fr = (k, r) => [k, formatWon(Math.round(total * r)), `${Math.round(r * 100)}%`];
  const sum = ['계', formatWon(total), '100%'];
  const funding = p.fund === 'ppp' ? [fr('정부 보조', p.govShare || 0), fr('민간 투자', 1 - (p.govShare || 0)), sum]
    : p.fund && p.fund !== 'gov' ? [['운영사 자체 재원', formatWon(total), '100%'], sum]
      : (p.type === 'metro' || p.type === 'lrt') ? [fr('국비', 0.6), fr('지방비', 0.4), sum]
        : p.type === 'motorway' || p.type === 'tunnelRoad' ? [fr('국비', 0.5), fr('한국도로공사', 0.5), sum]
          : kp ? [fr('국비 (남북 통합 특별회계)', 1), sum] : [fr('국비', 1), sum];
  const stopWord = rail ? '정거장' : 'IC·JCT';
  const transferCount = new Set(stations.flatMap((s) => s.transfers.map((x) => x.name))).size;
  const catch1 = rail ? Math.round(stations.reduce((acc, s) => acc + popWithin(s.lon, s.lat, 1), 0)) : 0;
  const effects = rail ? [
    `${first.name}–${last.name} ${km.toFixed(1)}km 구간에 ${stations.length}개 정거장을 놓아 철도 서비스 소외 지역을 해소`,
    `정거장 반경 1km 안 인구 약 ${(catch1 / 10000).toFixed(1)}만 명에게 철도 접근성 제공`,
    transferCount ? `기존 ${transferCount}개 노선과 환승 연계로 광역 철도망 효율 향상` : '기존 철도망과의 연계 수송 체계 구축',
    kp ? '남북 철도망 통합과 북측 지역 균형 발전에 기여' : '도로 혼잡 완화와 온실가스 감축',
  ] : [
    `${first.name}–${last.name} ${km.toFixed(1)}km 구간 신설로 지역 간 통행 시간 단축`,
    `${stations.length}개 나들목·분기점으로 주변 간선도로와 연결`,
    '기존 도로의 상습 정체 완화와 물류 비용 절감',
  ];
  const org = '통일한국 국토교통부';
  const tracks = spec.attrs?.tracks === 1 ? '단선' : '복선';
  const electric = spec.attrs?.power && spec.attrs.power !== 'none' ? '전철' : '';
  const overview = [
    ['사 업 명', esc(`${lineName} ${reopen ? '재개통' : p.extension ? '연장' : '건설'}사업`)],
    ['사업 구간', esc(`${first.name} ~ ${last.name} (${first.place} ~ ${last.place})`)],
    ['사업 규모', esc(`연장 ${km.toFixed(1)}km, ${stopWord} ${stations.length}개소${rail ? `, ${tracks}${electric}` : ''}`)],
    ['설계 속도', esc(`${spec.attrs?.speed || '-'}km/h`)],
    ['총사업비', esc(formatWon(p.cost))],
    ['사업 기간', esc(`${p.startYear}년 ~ ${p.doneYear}년 (${p.years}년)`)],
    ['사업 방식', esc(p.fund === 'ppp' ? `민간투자사업 (정부 보조 ${Math.round((p.govShare || 0) * 100)}%)` : p.fund && p.fund !== 'gov' ? '운영사 자체 사업' : '재정사업')],
    ['사업 시행자', esc(rail ? ((p.type === 'metro' || p.type === 'lrt') ? (first.place.split(' ')[0] || '해당 광역자치단체') : '국가철도공단')
      : p.type === 'motorway' || p.type === 'tunnelRoad' ? '한국도로공사' : '지방국토관리청')],
  ];
  const offices = [...new Set(stations.map((s) => s.place.split(' ').slice(-1)[0]).filter(Boolean))].slice(0, 6).join('·');
  return {
    org, orgSub: rail ? '철도국 · 철도건설과' : '도로국 · 도로건설과', docNo: `국토교통부 고시 제${p.startYear}-${seq}호`, title, lead, date,
    signer: '국토교통부장관', sealText: '국토교통부|장관인', lineName, color, stations, path, bbox: [[x0, y0], [x1, y1]],
    context: { boundaries, lines, labels }, overview, funding, stopWord,
    schedule: [
      ['기본계획 고시', `${p.startYear}년`, '본 고시'],
      ['기본·실시설계', `${p.startYear}년`, '설계·인허가 병행'],
      ['착공', `${p.startYear}년`, `${kindWord} 공사 착수`],
      [rail ? '개통 목표' : '준공 목표', `${p.doneYear}년`, `공사 기간 ${p.years}년`],
    ],
    effects,
    inspect: `관계 도서는 ${org} ${rail ? '철도국' : '도로국'}과 ${offices || '관할'} 등 관할 시·군·구청에 갖추어 두고 일반에게 보입니다.`,
  };
}

/** 고시문 창. fromBuild: 착공 직후 저절로 여는 경우 ('착공할 때마다 열기'를 끄면 안 연다) */
function showGazette(p, { fromBuild = false } = {}) {
  if (fromBuild && !gazetteAuto()) return false;
  const doc = gazetteData(p);
  if (!doc) return false;
  openGazette(doc, { auto: gazetteAuto(), onAuto: (on) => { try { localStorage.setItem(GZ_AUTO, on ? '1' : '0'); } catch { /* 저장 못 해도 이번 창은 그대로 */ } } });
  return true;
}

/**
 * 새 역 이름 후보: 400m 안의 기존 역(일반철도·도시철도, 환승역은 같은 이름), 역이 놓인 읍면동, 1km 안 이웃 읍면동 차례
 * (동 이름의 번호는 뗀다: 북가좌1동 → 북가좌)
 */
function stationNameHints(lon, lat) {
  const out = [];
  let best = null, bd = 0.4;
  for (const [nm, node] of [...base.stations, ...(base.metro_stations || [])]) {
    const c = base.nodes[node];
    if (!c || Math.abs(c[1] - lat) > 0.01) continue;
    const d = kmBetween(lon, lat, c[0], c[1]);
    if (d < bd) { bd = d; best = nm; }
  }
  if (best) out.push({ name: best, sameStation: true });
  if (subsFC) {
    // 동 이름의 번호는 뗀다: 북가좌1동 → 북가좌동, 종로1·2·3·4가 → 종로
    const dong = (n) => String(n || '').replace(/\s.*$/, '').replace(/제?[\d·,]+(동|가)$/, (m, t) => (t === '동' ? '동' : ''));
    const inside = [], near = [];
    for (const f of subsFC.features) {
      const nm = f.properties?.name;
      if (!nm || !/(동|읍|면|가)$/.test(nm)) continue;
      const g = f.geometry;
      const rings = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
      let hit = false, dmin = Infinity;
      for (const poly of rings) {
        const r = poly[0];
        if (!r.length || Math.abs(r[0][1] - lat) > 0.05 || Math.abs(r[0][0] - lon) > 0.06) continue;
        let inPoly = false;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i], [xj, yj] = r[j];
          if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inPoly = !inPoly;
          dmin = Math.min(dmin, kmBetween(lon, lat, xi, yi));
        }
        if (inPoly) hit = true;
      }
      if (hit) inside.push(dong(nm)); else if (dmin < 1) near.push([dmin, dong(nm)]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const n of [...inside, ...near.map((x) => x[1])]) if (!out.some((o) => o.name === n)) out.push({ name: n });
  }
  return out;
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
  const svcRow = (s, stop) => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(svcColor(s, state.services.indexOf(s)))}"></span>
    ${esc(s.name)} <span class="m">${SERVICE_KINDS[s.kind].label}${s.built ? '' : ' · 차량 제작 중'}</span> <button class="small" data-svc-edit="${s.id}">고치기</button></td>
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
    ${svcTrains ? `<p class="hint">이 역에 서는 특급·급행 등 계통 열차 하루 ${svcTrains}회</p>` : '<p class="hint">보통 열차는 모든 노선에 저절로 다닙니다. 특급·급행은 계통을 짜야 다닙니다.</p>'}
    ${lines.some((l) => l.mode === 1) ? `<div class="actions"><button class="small primary" data-svc-from="${id}" title="이 역에서 시작해, 설 역을 지도에서 차례로 누릅니다">이 역에서 운행 계통 짜기</button></div>` : ''}
    <h4>환승</h4>
    ${lines.filter((l) => l.named).length > 1 ? `<p class="hint">같은 역 환승: ${lines.filter((l) => l.named).map((l) => esc(l.name)).join(', ')}</p>` : ''}
    ${near.length ? `<table class="kv">${near.map((x) => `<tr><td><a href="#" data-st-goto="${x.node}">${esc(x.name)}</a>
      <span class="m">${x.lines.map(esc).join(', ') || '노선 정보 없음'}</span></td><td>도보 ${Math.round(x.d * 1000)}m</td></tr>`).join('')}</table>`
      : lines.filter((l) => l.named).length > 1 ? '' : '<p class="hint">400m 안에 갈아탈 다른 역이 없습니다.</p>'}
    ${transferHTML(id, lines)}
    ${develHTML(id, n)}`;
}

// ------------------------------------------------------------ 일반철도–도시철도 환승 연결

const TRANSFER = { base: 800, perKm: 1000, years: 2, maxKm: 1.5 };

/**
 * 역 패널: 일반철도역이면 가까운 도시철도역, 도시철도역이면 가까운 일반철도역과의 환승 연결.
 * 지으면 도시철도역 근처 사람이 도시철도를 타고 와서 이 철도역에서 갈아탈 수 있다 (모형: 철도 후보 역에 더해짐)
 */
function transferHTML(id, lines) {
  const isRail = lines.some((l) => l.mode === 1), isMetro = lines.some((l) => l.mode === 2);
  if (!isRail && !isMetro) return '';
  const c = nodeCoord(id);
  const builtIn = baseTransfers(base).filter(([r, m]) => r === id || m === id).map(([rail, metro]) => ({ rail, metro, built: true, base: true }));
  const mine = [...builtIn, ...(state.transfers || []).filter((t) => t.rail === id || t.metro === id)];
  const linked = new Set(mine.map((t) => (t.rail === id ? t.metro : t.rail)));
  const cand = [];
  for (const [node, v] of nodeNames()) {
    if (v.kind !== 'station' || node === id || typeof node !== 'number' || linked.has(node)) continue;
    const p = nodeCoord(node);
    if (!p || Math.abs(p[0] - c[0]) > 0.03 || Math.abs(p[1] - c[1]) > 0.02) continue;
    const d = kmBetween(c[0], c[1], p[0], p[1]);
    if (d > TRANSFER.maxKm) continue;
    const ls = linesAt(node);
    // 일반철도역에는 도시철도역을, 도시철도역에는 일반철도역을 (둘 다 있는 역은 양쪽)
    const other = (isRail && ls.some((l) => l.mode === 2)) || (isMetro && ls.some((l) => l.mode === 1));
    if (other) cand.push({ node, name: v.name, d, ls });
  }
  cand.sort((a, b) => a.d - b.d);
  const cost = (d) => Math.round(TRANSFER.base + TRANSFER.perKm * d);
  const nm = (n) => esc(nodeNames().get(n)?.name || '역');
  const rows = mine.map((t) => `<tr><td>${nm(t.rail === id ? t.metro : t.rail)}</td><td>${t.base ? '연결됨 (기존 환승역)' : t.built ? '연결됨' : '공사 중'}</td></tr>`).join('');
  return `<h4>일반철도–도시철도 환승 연결</h4>
    <p class="hint">통로·연결선을 놓아 도시철도로 와서 이 역 열차로 갈아타게 합니다. 도시철도역 근처 주민이 이 역을 쓰게 되어 철도 수요가 늡니다.</p>
    ${rows ? `<table class="kv">${rows}</table>` : ''}
    <div class="list">${cand.slice(0, 5).map((x) => {
      const k = cost(x.d), ok = canAfford(state, k, TRANSFER.years);
      return `<div class="item opt"><div class="opt-row"><span>${esc(x.name)} <span class="m">${x.ls.filter((l) => l.named).map((l) => esc(l.name)).slice(0, 3).join(', ')} · ${Math.round(x.d * 1000)}m</span></span>
        <button class="small ${ok ? 'primary' : ''}" data-xfer="${x.node}" ${ok ? '' : 'disabled'}>${formatWon(k)} · ${TRANSFER.years}년</button></div></div>`;
    }).join('') || (rows ? '' : `<p class="hint">${TRANSFER.maxKm}km 안에 이을 ${isRail ? '도시철도' : '일반철도'}역이 없습니다.</p>`)}</div>`;
}

function startTransfer(id, other) {
  const isRailHere = linesAt(id).some((l) => l.mode === 1) && linesAt(other).some((l) => l.mode === 2);
  const rail = isRailHere ? id : other, metro = isRailHere ? other : id;
  const [a, b] = [nodeCoord(id), nodeCoord(other)];
  const d = kmBetween(a[0], a[1], b[0], b[1]);
  const cost = Math.round(TRANSFER.base + TRANSFER.perKm * d);
  if (!canAfford(state, cost, TRANSFER.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const nn = nodeNames();
  const pid = crypto.randomUUID();
  (state.transfers ||= []).push({ id: pid, rail, metro, built: false });
  startProject(state, { id: pid, kind: 'transfer', links: [], stations: [], cost, years: TRANSFER.years,
    label: `환승 연결: ${nn.get(rail)?.name || '철도역'} ↔ ${nn.get(metro)?.name || '도시철도역'}` });
  save(state); renderAll();
}

/**
 * 지도 열차 위치 자료: 기본 열차는 철도·도시철도 구간마다 (이용객만큼, 최소 운행 이상), 운행 계통은 계통 경로를 따라
 */
function trainsData() {
  if (!result) return null;
  const OP = OPERATING, vol = result.links.vol, nn = nodeNames();
  const links = [];
  allLinks().forEach((l0, i) => {
    const l = linkAt(base, state, i);
    if ((l.mode !== 1 && l.mode !== 2) || l.ext || state.replaced?.[i] || l.replaced || linkPending(base, state, i) || i >= vol.length) return;
    if (i >= base.links.length && !l.built) return;
    if (state.closedLines?.[l.name]) return;
    const cls = l.mode === 2 ? 'metro' : l.cls === 'hsr' ? 'hsr' : 'conv';
    const kp = l.kp && l.mode === 1 && !state.rail?.merged;
    const f = state.lineFreq?.[l.name] || 1;
    const trains = Math.min(300, Math.max(OP.minTrains[cls] * f * (kp ? OP_FACTORS.kpMinTrains : 1), vol[i] / (OP.paxPerTrain[cls] * OP.loadFactor)));
    if (vol[i] < 1 && l.mode === 1) return;   // 여객이 없는 선로 (화물선 등)
    const parts = smoothParts(l0, i);
    const coords = parts.reduce((a, p) => (p.length > a.length ? p : a), []);
    links.push({ coords, trains, speed: l.speed, cls, label: `${autoBrand(cls, operatorOf(state, l))} · ${l.name || CLASS_LABEL[l.cls]}` });
  });
  const net = effectiveNetwork(base, state);
  const services = (state.services || []).filter((s) => s.built).map((s) => {
    const coords = [];
    for (const seg of s.segs) {
      const c = pathCoords(net.links, seg.via, seg.a);
      coords.push(...(coords.length ? c.slice(1) : c));
    }
    const brand = serviceBrand(s), a = nn.get(s.stops[0])?.name || '', b = nn.get(s.stops[s.stops.length - 1])?.name || '';
    return { coords, runMin: s.runMin, trains: s.trains, kind: s.kind, down: `${a}발 ${b}행 ${brand} (${s.name})`, up: `${b}발 ${a}행 ${brand} (${s.name})` };
  });
  return { links, services };
}

/** 역이 놓인 존 (가장 가까운 읍면동 중심의 존) */
function zoneAtPoint(lon, lat) {
  let best = -1, bd = Infinity;
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    for (const [x, y] of z.subs) { const d = (x - lon) ** 2 + (y - lat) ** 2; if (d < bd) { bd = d; best = i; } }
  });
  return best;
}

function develPlanAt(id) {
  const c = nodeCoord(id);
  const zone = zoneAtPoint(c[0], c[1]);
  return { c, zone, plan: develPlan({ pop3km: popWithin(c[0], c[1], 3), zone: zoneProps[zone], lat: c[1], lon: c[0] }) };
}

/** 역 패널: 역세권 개발사업 */
function develHTML(id, n) {
  if (foreignCountry(id) || !linesAt(id).length) return '';
  const d = (state.devels || []).find((x) => x.node === id);
  if (d) {
    const p = state.projects.find((x) => x.id === d.id);
    return `<h4>역세권 개발</h4><p class="hint">${d.done ? `완공 · 인구 ${d.persons.toLocaleString()}명 입주 · 분양 수익 ${formatWon(d.revenue)}` : `공사 중 · ${p?.doneYear ?? ''}년 완공 예정 (순유입 ${d.persons.toLocaleString()}명, 분양 수익 ${formatWon(d.revenue)} 예상)`}</p>`;
  }
  const { zone, plan } = develPlanAt(id);
  const label = { capital: '수도권', metro: '광역시', other: '지방', kp: '북측' }[plan.cls];
  return `<h4>역세권 개발</h4>
    <p class="hint">역 주변에 주거·업무 단지를 지어 인구를 끌어들입니다. 다 지으면 분양 수익이 예산으로 돌아오고, ${esc(zoneName(zone))} 주민 행복도가 오릅니다.</p>
    <table class="kv">
      <tr><td>사업비 · 공기</td><td>${formatWon(plan.cost)} · ${plan.years}년</td></tr>
      <tr><td>인구 순유입 (다른 지역에서)</td><td>${plan.persons.toLocaleString()}명</td></tr>
      <tr><td>분양 수익 (${label}, 완공 때)</td><td class="${plan.revenue >= plan.cost ? 'pos' : ''}">${formatWon(plan.revenue)}</td></tr>
    </table>
    <button class="small primary" id="devel-ok" data-node="${id}">역세권 개발 착공</button>`;
}

function commitDevel(id) {
  const n = nodeNames().get(id);
  const { c, zone, plan } = develPlanAt(id);
  if (!confirm(`${n?.name || ''}역 역세권 개발을 착공할까요? ${formatWon(plan.cost)} · ${plan.years}년`)) return;
  const r = startDevel(state, { node: id, name: (n?.name || '').replace(/역$/, ''), zone, lon: c[0], lat: c[1], plan });
  if (!r.ok) { alert(r.reason); return; }
  save(state); renderAll();
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

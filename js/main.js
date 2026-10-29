// 진입점: 데이터를 받고 계산 워커·지도를 띄운다. 기능은 js/app/*.js 모듈에 나뉘어 있다.
import './app/fresh.js';   // 맨 먼저: 게임 자료를 캐시에서 예전 것으로 쓰지 않게
import {
  APP_VERSION, base, busy, CLASS_LABEL, dataStamp, draft, errLog, grid, gridSent, historic, isForeign, loading, map, mark, namer, perf, places, Progress, requests, result, setBase, setDataStamp, setGrid, setGridSent, setHistoric, setIsForeign, setMap, setPlaces, setState, setSubPop0, setSubsFC, setWorker, setZoneProps, setZonesFC, state, subPop0, subsFC, worker, zoneProps, zonesFC,
} from './app/core.js';
import { fixNetwork, LEN_FIX_V } from './data/netfix.js';
import { decodeNetwork } from './data/netpack.js';
import { seedInterKoreaAir } from './game/airlines.js';
import { makeForeignTest } from './game/lines.js';
import { governorTitle, initLocal, metroName, normalizeUnitKeys, regionOf } from './game/local.js';
import { inferNetSize, migrateState, refFromBase, rememberNetwork, sliceRef } from './game/migrate.js';
import { initRail } from './game/operators.js';
import { initPPP } from './game/ppp.js';
import { clearAuto, getRef, keepBackup, loadAuto } from './game/savestore.js';
import { planService, refreshExistingServices, seedServices, tripsPerDay } from './game/services.js';
import { clearSim, loadSim } from './game/simstore.js';
import { colourNewMetro, dropOrphanNames, effectiveNetwork, initAirRoutes, initOngoing, load, migrateAir, newGame, placeName, save } from './game/state.js';
import { loadTerrain, terrainAt } from './game/terrain.js';
import { extendWorld, urbanLanes } from './game/world.js';
import { t } from './i18n.js';
import { P } from './sim/params.js';
import { helperPorts } from './sim/pool.js';
import { addLayers, createMap, refreshNames, setLabelGroup, setNameResolver, setUnitGroup } from './ui/map.js';
import { addPlansLayer } from './ui/plansmap.js';
import { addRailKindLayer } from './ui/railkind.js';
import { addTrainsLayer, setTrainsProvider } from './ui/trainsmap.js';
import { assignTourism, countyKey, ctx, gains, onWorker, zoneLabel, zoneName } from './app/year.js';
import { renamePyongyangMetro, resetNamer } from './app/sez.js';
import { drawAnnexedSubs, linksFC, refreshLinks, refreshPoints } from './app/mapdata.js';
import { admin, drawHalls, hallList, halls, pieceName, riToDong, setHalls, startUnitPick, unitMyeon } from './app/region.js';
import { drawUnivs, fixPropagandaUnivs, setUnivs, univs } from './app/univ.js';
import { bindMap, select, selectBox } from './app/interact.js';
import { cancelDraft, popNear, startDraft } from './app/draw.js';
import { addDraftPoint, commitDraft } from './app/route.js';
import { bindUI, renderAll, renderBuild } from './app/panels.js';
import { openServiceEditor, railStationSet } from './app/svc.js';
import { openLineDiagram } from './app/operators.js';
import { migratePlanLines, openPlan, plans, setPlans } from './app/plans.js';
import { countyRep, holdElection, localElectionName, regions, syncMayors } from './app/election.js';
import {
  annexTargets, applyKrGu, drawBungu, fixBunguNames, fixExclaves, guNamesOfZone, guUnits, isGeneralGu, loadGuUnits, migrateSubKeys, splitMetroCities, syncGovernors,
} from './app/bungu.js';
import { applyUnivAdmin, setAdmin } from './app/firstyear.js';
import { onLand, planStraighten, startStraighten, straight, straightenClick } from './app/straighten.js';
import { recommendRoute } from './app/recommend.js';
import {
  convertRadialHousingRoads, effectiveGrid, gridEff, growHousingSite, housingDraw, housingPointProblem, loadWater, pointAddClick, riverInfo, startHousingPick,
  startPointAdd,
} from './app/housing.js';
import { lastPreview, previewDraft } from './app/compare.js';
import { openSharedFromURL, packState } from './app/report.js';
import { startServicePick } from './app/pick.js';
import { closedFile, closedLines, refreshClosed, reopenPlan, setClosedFile, setClosedLines, startReopen } from './app/reopen.js';
import { trainsData } from './app/transfer.js';
import { padSubsFC, prepareRiSplits, subsMapData, toModelGrid, workerZones } from './app/risplit.js';

async function init() {
  mark('init');
  if (location.hash.startsWith('#s=')) await openSharedFromURL();
  // 계산 워커(와 보조 워커)는 먼저 띄워 둔다: 모듈을 받고 읽는 동안 이쪽은 데이터를 받는다
  setWorker(new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' }));
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
  setZoneProps(z); setBase(decodeNetwork(nmeta, nbin)); setGrid(new Float32Array(g));
  // 노드 자리 바로잡기: 고속도로 본선이 엉뚱한 분기점 노드로 꺾이던 곳(금토분기점 등), 역에서 엇갈리는 노선의 갈고리(GTX-A 성남·신분당선 판교)
  const jsonOr = (u) => fetch(u).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  // 빠진 다리·틀린 차로·겹친 역 (data/link_fix.json): 노드·구간이 늘거나 바뀌므로 그 판 번호를 자료 판에 붙여 저장 게임 번호를 옮기게 한다
  const linkFix = await jsonOr('data/link_fix.json');
  fixNetwork(base, await jsonOr('data/node_fix.json'), await jsonOr('data/road_geom_fix.json'), linkFix);
  if (meta && linkFix.v) meta.stamp = `${meta.stamp}+f${linkFix.v}`;
  if (meta) meta.stamp = `${meta.stamp}+L${LEN_FIX_V}`;   // 계산 길이를 도형 길이로 맞춘 판 (netfix.js)
  mark('network decoded');
  // 국외 거점·국경 연결·여객선 항로·공항
  extendWorld(base, zoneProps, world);
  urbanLanes(base, grid);
  // 존 경계는 배경지도와 같은 시군구 도형을 쓴다
  mark('world+lanes');
  setZonesFC(await sggP);
  mark('sgg fetched');
  // 지명은 새 역·IC 이름을 지을 때만 필요하므로 첫 화면 뒤에 받는다
  const placesReady = fetch('data/places.json').then((r) => r.json()).then((p) => { setPlaces(p); });
  fetch('data/base/world.geojson').then((r) => r.json()).then((w) => { setIsForeign(makeForeignTest(w)); }).catch(() => {});
  fetch('data/closed_lines.json').then((r) => (r.ok ? r.json() : { lines: [] })).then((c) => { setClosedFile(c.lines || []); setClosedLines(closedFile); if (map) refreshClosed(); }).catch(() => {});
  fetch('data/plans.json').then((r) => (r.ok ? r.json() : { plans: [] })).then((p) => { setPlans(p.plans || []); migratePlanLines(); if (map) renderBuild(); }).catch(() => {});
  fetch('data/historic_targets.json').then((r) => (r.ok ? r.json() : [])).then((h) => { setHistoric(h); }).catch(() => {});
  fetch('data/halls.json').then((r) => (r.ok ? r.json() : [])).then((h) => { setHalls(h); if (map) drawHalls(); }).catch(() => {});
  fetch('data/universities.json').then((r) => (r.ok ? r.json() : [])).then((u) => {
    setUnivs(u);
    // 예전 저장: 바꾼 대학 이름을 목록 번호로 적었다 (대학 목록을 주요 대학으로 줄여 번호가 바뀌었다) → 버린다
    if (state?.univNames) for (const k of Object.keys(state.univNames)) if (/^\d+$/.test(k)) delete state.univNames[k];
    applyUnivAdmin();
    fixPropagandaUnivs();
    if (map) drawUnivs();
  }).catch(() => {});
  rememberNetwork(meta?.stamp, base, zoneProps);
  setSubPop0(zoneProps.flatMap((zp) => zp.subs.map((s) => s[2] * zp.pop)));
  setState(await load());
  // 데이터가 바뀌면(노선망·존 구성 변경) 예전 저장 게임의 번호(노드·링크·시군)를 새 자료에 맞춰 옮긴다.
  // 옮기지 못하면 예전 저장은 따로 남겨 두고(설정 탭에서 파일로 받을 수 있다) 새로 시작한다
  // 자료 판 표시는 같은데 기본 노드·구간 수가 다르면(예전 파일 일부를 캐시에서 쓴 판에서 저장한 경우) 새로 만든 노드·구간 번호가
  // 판 옮기기 없이 밀려, 번호로 묶인 IC·역 이름이 엉뚱한 노드에 붙었다: 저장할 때의 수로 옮긴다
  // 예전 저장(0.5.2 전)은 그 수를 적지 않았으므로 새 구간 도형 끝과 새 노드 자리로 되짚는다 (inferNetSize)
  let ref = null;
  if (state && meta && state.dataStamp) {
    const oldRef = state.dataStamp !== meta.stamp ? await getRef(state.dataStamp) : null;
    const size = state.netSize || inferNetSize(state, oldRef?.N ?? base.nodes.length);
    if (oldRef && size && (size[0] !== oldRef.N || size[1] !== oldRef.L)) ref = sliceRef(oldRef, size);
    else if (!oldRef && state.dataStamp === meta.stamp && size && (size[0] !== base.nodes.length || size[1] !== base.links.length)) ref = refFromBase(base, zoneProps, size[0], size[1]);
  }
  if (state && meta && state.dataStamp && (state.dataStamp !== meta.stamp || ref)) {
    const old = state;
    const r = await migrateState(old, { base, zones: zoneProps, stamp: meta.stamp, ref });
    if (r.ok) {
      await keepBackup(JSON.stringify(old), old.dataStamp);   // 옮기기가 잘못됐을 때 되돌릴 수 있게 옮긴 경우에도 남긴다
      setState(r.state);
      state.backupStamp = old.dataStamp;
      await migrateSubKeys(state, old.dataStamp);
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
      setState(newGame(old.difficulty || 'normal'));
      state.backupStamp = old.dataStamp;
      state.log.unshift(`지도·노선 자료가 새로 바뀌어 ${old.year}년 저장 게임을 이어 할 수 없어 새로 시작합니다 (${r.reason}). 예전 저장은 설정 탭에서 파일로 받아 둘 수 있습니다.`);
    }
    clearSim();
  }
  (state || setState(newGame('normal')));
  if (meta) state.dataStamp = meta.stamp;
  state.netSize = [base.nodes.length, base.links.length];   // 저장할 때의 기본 노드·구간 수 (위의 판 옮기기 판단)
  // 짓다 만 노선이 남긴 IC·역 이름 (예전 판은 사업을 취소해도 이름을 지우지 않았다)
  const orphan = dropOrphanNames(base, state);
  if (orphan.length) state.log.unshift(`${state.year}년 취소한 사업이 남긴 이름 ${orphan.length}곳을 지웠습니다: ${orphan.slice(0, 5).map((v) => v.name).join(', ')}${orphan.length > 5 ? ' 등' : ''}`);
  // 예전 저장: 새로 놓은 선로를 남측 규격으로 (기존 북측 선로를 갈라 생긴 조각은 그대로)
  for (const nl of state.newLinks || []) if (nl.mode >= 1 && !nl.sstd && (nl.split == null || nl.split >= base.links.length)) { nl.sstd = 1; nl.std = 1; }
  if (convertRadialHousingRoads()) save(state);   // 예전 1기 신도시급 방사형 간선 → # 격자
  // 예전 저장: 광역시로 승격한 시 자체는 중구, 편입한 시군은 구가 됐다 → 단체장 직함을 지금 이름으로
  renamePyongyangMetro();
  initLocal(state);
  fixPropagandaUnivs();
  const keysFixed = normalizeUnitKeys(state, zoneProps);
  syncGovernors();
  if (keysFixed || state.local?.independent?.length || Object.keys(state.local?.annex || {}).length) syncMayors();
  if (keysFixed) save(state);
  initAirRoutes(state, world.routes || []);
  migrateAir(state, world.longhaulRoutes || [], new Set(world.foreign.map((f) => f.id)));   // 예전 저장: 장거리 노선, 지정 안 한 새 공항 국제선 정리
  seedInterKoreaAir(state);
  initRail(state);
  seedServices(state, base);
  // 예전 저장의 1호선·4호선 기본 계통을 직통 계통으로 (선로 자료가 바뀌었다)
  colourNewMetro(base, state);   // 예전 저장의 색 없는 새 도시철도 노선
  const refreshed = refreshExistingServices(state, effectiveNetwork(base, state), base.stations);
  if (refreshed.length) state.log.unshift(`${state.year}년: 기본 운행 계통을 지금 선로에 맞춰 다시 짰습니다 (${refreshed.join(', ')})`);
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
  if (!Object.keys(state.local.offices).length) holdElection('all', `${localElectionName(2026)} (게임 시작 시점)`);
  // 지방자치가 없는 북측 도의 단체장 (예전 저장: 장단·옹진을 북측 도로 옮기면 그 도에 도지사를 뽑던 것)은 지운다
  { const regs = regions(); for (const [k, o] of Object.entries(state.local.offices)) if (k.startsWith('g:') && !regs.has(k.slice(2)) && !o.appointed) delete state.local.offices[k]; }
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
    const closed = new Set(state.closedStations ||= []), reopened = new Set(state.reopenedStations || []);
    for (const n of p.dropStations) if (!closed.has(n) && !reopened.has(n)) state.closedStations.push(n);
  }
  // 예전 저장: 나중에 놓은 철도가 문 닫은 역(직선화로 폐역한 옛 역)에 서는데 그 역이 닫힌 채였다
  // (경의고속철도의 금천·평산·서흥이 노선도에서 빠지고 고시에 "104정거장"으로 나오던 것): 새 선로가 닿는 닫힌 역은 다시 연다
  if (state.closedStations?.length) {
    const touched = new Set();
    for (const l of state.newLinks) if (!l.replaced && (l.mode === 1 || l.mode === 2)) { touched.add(l.a); touched.add(l.b); }
    const back = state.closedStations.filter((n) => touched.has(n));
    if (back.length) {
      (state.reopenedStations ||= []).push(...back);
      state.closedStations = state.closedStations.filter((n) => !touched.has(n));
    }
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
  // 편입하면서 떼어 낸 남측 법정리를 다시 뗀다 (계산 워커가 그 소구역 구성으로 모형을 만든다)
  await prepareRiSplits();
  loading.done('data');
  // 읍면동 경계는 지도에만 쓰므로 기다리지 않는다
  const subsReady = fetch('data/subzones.geojson').then((r) => r.json()).then(async (fc) => {
    setSubsFC(fc);
    padSubsFC();
    // 분구 정리 (읍면동이 맞닿는지 알아야 해서 경계를 받은 뒤): 광역시 아래 남은 큰 시는 자치구로, 예전 분구의 월경지는 이웃 구로
    const split = splitMetroCities(), fixed = Object.keys(state.local?.bungu || {}).filter((u) => fixExclaves(u)).length;
    const kr = await applyKrGu();
    if (split || fixed || kr) {
      if (fixed) state.log.unshift(`${state.year}년 분구한 구의 월경지 ${fixed}곳을 맞닿은 구로 옮겼습니다`);
      try { guUnits.clear(); } catch { /* 아직 준비 전이면 처음 그릴 때 채운다 */ }
      syncMayors(); save(state);
      if (map) { drawBungu(); refreshNames(map); }
    }
  });

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
    // 자료 격자로 모델을 만든 뒤 입주 인구를 더한 격자로 바꾼다 (그 소구역 역세권은 기준선 것을 쓰지 않고 다시 구한다)
    // 떼어 낸 남측 법정리가 있으면 존·격자의 소구역을 모형 번호로 (risplit.js)
    type: 'init', zones: workerZones(), grid: toModelGrid(grid).buffer.slice(0), gridEff: (setGridSent(effectiveGrid())) !== grid ? toModelGrid(gridSent).buffer.slice(0) : null, net: effectiveNetwork(base, state),
    ctx: ctx(), snapshot: state.snapshot, baseline, saved: savedOk, ports,
  }, [...(baseline ? [baseline.bin] : []), ...(savedOk ? [savedOk.bin] : []), ...ports]);
  setDataStamp(meta?.stamp);
  mark('worker posted');

  // 3) 지도
  loading.stage('map');
  const mapReady = mapCreated.then((m) => {
    window.__map = m;
    setMap(m);
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
    setNameResolver((level, id, original) => (level === 'zone' && zoneProps[id] ? (guNamesOfZone(id) && !isGeneralGu(id) ? '' : zoneLabel(id)) : level === 'unit' ? riToDong(id, placeName(state, level, id, pieceName(id, original))) : placeName(state, level, id, original)));
    setUnitGroup((i) => unitMyeon(i));
    setLabelGroup((z) => ({ key: countyKey(z), weight: zoneProps[z]?.area || 0 }));
    refreshNames(map);
    subsReady.then(() => {
      map.getSource('subs').setData(subsMapData());   // 국외 존 자리 채움은 빼고, 떼어 낸 남측 법정리는 넣어서
      if (fixBunguNames()) { syncMayors(); save(state); renderAll(); }   // 예전 저장: 거꾸로 붙은 구 이름
      // 읍면동 이름을 받은 뒤 이름표·경계를 다시 그린다: 그 전에 그리면 북측의 지금 읍(○○읍)을 가리지 못해 1945년 면에 묶여 읍이 사라져 보였다
      refreshNames(map);
      drawAnnexedSubs(); drawBungu();
    });
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
  window.ukt = { get guUnits() { return guUnits; }, startUnitPick: () => startUnitPick(), admin: () => admin(), drawBungu: () => drawBungu(), loadGuUnits: () => loadGuUnits(), setAdmin: (a) => setAdmin(a), annexTargets: () => annexTargets(), regionAt: (i) => regionOf(state, zoneProps[i]), zoneName: (i) => zoneName(i), fixBunguNames: () => fixBunguNames(), get busy() { return busy; }, get errLog() { return errLog; }, housingPointProblem: (...a) => housingPointProblem(...a), terrainAt: (...a) => terrainAt(...a), loadTerrain: () => loadTerrain(), growHousingSite: (...a) => growHousingSite(...a), riverInfo: (...a) => riverInfo(...a), loadWater: () => loadWater(), onLand: (...a) => onLand(...a), startHousingPick: () => startHousingPick(), housingDraw: () => housingDraw, holdElection: (o, r) => holdElection(o, r), hallList: () => hallList(), migrateSubKeys: (st, s) => migrateSubKeys(st, s), convertRadialHousingRoads: () => convertRadialHousingRoads(), reopenPlan: (id) => reopenPlan(id), startReopen: (id) => startReopen(id), planStraighten: () => planStraighten(), openPlan, refreshPoints, openServiceEditor, popNear, effectiveGrid, commitDraft, startServicePick, previewDraft, get lastPreview() { return lastPreview; }, namerSuggest: (x, y) => namer.suggest(x, y, 'station'), perf, map, base, worker: () => worker, packState: () => packState(), countyKey: (i) => countyKey(i), countyRep: (i) => countyRep(i), select, selectBox, renderAll, refreshLinks, startDraft, addDraftPoint, cancelDraft, startStraighten, straightenClick, startPointAdd, pointAddClick, openLineDiagram, recommendRoute, probe: () => worker.postMessage({ type: 'probe' }), get gains() { return gains; }, get zoneProps() { return zoneProps; }, get grid() { return grid; }, net: () => effectiveNetwork(base, state), ctx: () => ctx(), get draft() { return draft; }, get straight() { return straight; }, get state() { return state; }, get result() { return result; }, get requests() { return requests; } };
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

// 모듈의 모든 선언이 끝난 뒤 시작한다
init().catch((e) => {
  console.error(e);
  const tip = document.querySelector('#loading .ld-tip');
  if (!tip) return;
  // 어디서 멈췄는지 (제보로 원인을 찾을 수 있게): 오류가 난 첫 파일·줄
  const at = String(e.stack || '').split(/\r?\n/).map((l) => l.match(/([\w.-]+\.js):(\d+)/)).find(Boolean);
  tip.textContent = `불러오기 실패: ${e.message}${at ? ` (${at[1]}:${at[2]}, ${APP_VERSION})` : ''}`;
  tip.style.color = 'var(--bad)';
  // 저장 게임 때문에 열리지 않으면 빠져나올 길: 저장을 파일로 받아 두고 새로 시작 (예전에는 사이트 데이터를 지우는 수밖에 없었다)
  const box = document.createElement('div');
  box.className = 'ld-fail';
  box.innerHTML = '<button class="small" data-fail="dl">저장을 파일로 받기</button> <button class="small" data-fail="new">새로 시작 (저장은 따로 남김)</button>';
  tip.after(box);
  box.querySelector('[data-fail=dl]').onclick = async () => {
    const json = await loadAuto();
    if (!json) { alert('저장된 게임이 없습니다.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`{"app":"unified-korea-transport","version":${JSON.stringify(APP_VERSION)},"savedAt":${Date.now()},"state":${json}}`], { type: 'application/json' }));
    a.download = '통일교통망_불러오기실패_저장.json';
    document.body.appendChild(a); a.click(); a.remove();
  };
  box.querySelector('[data-fail=new]').onclick = async () => {
    if (!confirm('지금 저장된 게임을 두고 새로 시작할까요? 저장은 따로 남겨 두어 설정 탭에서 파일로 받을 수 있습니다.')) return;
    const json = await loadAuto();
    if (json) { let stamp = 'fail'; try { stamp = JSON.parse(json).dataStamp || stamp; } catch { /* 깨진 저장 */ } await keepBackup(json, `${stamp}-불러오기실패`); }
    await clearAuto(); await clearSim();
    location.reload();
  };
});

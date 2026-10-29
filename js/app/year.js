// 시뮬레이션 결과 받기, 해 넘기기, 행복도.
import { DIFFICULTY } from '../game/catalog.js';
import { settleDevels } from '../game/devel.js';
import { rollEvent } from '../game/events.js';
import { settleHousing } from '../game/housing.js';
import { countyDisplayName, regionOf } from '../game/local.js';
import { initSubBase, nationalFactor, subGains, updateMayorApproval, zoneGains } from '../game/sentiment.js';
import { openWaitingServices } from '../game/services.js';
import { saveSim } from '../game/simstore.js';
import {
  advanceBudgetYear, defaultFix, effectiveNetwork, linkAt, linksUnderWork, save, settleMega, settleRail, START_YEAR, startUpgrade, updateAirRoutes, updateApproval,
  updateCongestion, upgradeCost,
} from '../game/state.js';
import { newlyUnlocked, unlockAt, unlockedTourKP } from '../game/tourism.js';
import { t } from '../i18n.js';
import { stopLineDiagram } from '../ui/linediagram.js';
import { refreshNames } from '../ui/map.js';
import { showNotice } from '../ui/notice.js';
import { toast } from '../ui/panel.js';
import {
  $, base, busy, dataStamp, draft, errLog, esc, grid, gridSent, happiness, lastDone, lastIncome, loading, map, mark, median, namer, perf, prevSummary, requests, result,
  setGridSent, setHappiness, setLastDone, setLastIncome, setPrevSummary, setRequests, setResult, state, subsFC, worker, zoneProps,
} from './core.js';
import { resetNamer, settleSEZ } from './sez.js';
import { paintVolumes, paintZones, refreshLinks, refreshPoints, showDensity } from './mapdata.js';
import { adminInvalidate } from './region.js';
import { settleUniv, univFundSeats, univList, univYear } from './univ.js';
import { cancelDraft } from './draw.js';
import { showRoute } from './route.js';
import { allTransitShare, renderAll, renderStatus, renderVisible, setBusy } from './panels.js';
import { operatorEconomics } from './operators.js';
import { localYear, rng } from './election.js';
import { guNamesOfZone, isGeneralGu } from './bungu.js';
import { afterStraighten } from './straighten.js';
import { effectiveGrid, housingComplaints, housingParts, settledDevelopments } from './housing.js';
import { onPreview } from './preview.js';
import { bigCities, showEvent } from './compare.js';
import { goalTimes, routeTimes, routeWaits, setGoalTimes, showReport } from './report.js';
import { pppYear } from './ppp.js';
import { refreshClosed } from './reopen.js';
import { airportName } from './selpanel.js';
import { extraSubs, fromModelSubs, toModelGrid, toModelSub } from './risplit.js';

export let tourSites = [];   // data/tourism.json 관광지 (북측 관광지 해금 판정)

/** 관광지가 놓인 존: 존 중심이 아니라 읍면동(소구역) 중심 중 가장 가까운 곳의 존 */
export function zoneOfSite(s) {
  let best = -1, bd = Infinity;
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    for (const [x, y] of z.subs) { const d = (x - s.lon) ** 2 + (y - s.lat) ** 2; if (d < bd) { bd = d; best = i; } }
  });
  return best;
}

/** 관광지를 가장 가까운 존(국외는 같은 이름의 거점)에 하루 방문객으로 붙인다 */
export function assignTourism(t) {
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

export function ctx() {
  return { integration: state.integration, policy: state.policy, sez: (state.sez || []).filter((z) => z.done).map((z) => z.zone),
    univ: univList().filter((u) => u.built).map((u) => [u.zone, u.seats, u.isNew ? 1 : 0]).concat(univFundSeats()),
    housingSubs: housingSubList().map(toModelSub) };   // 계산 워커의 소구역 번호로 (떼어 낸 남측 법정리, risplit.js)
}

/** 입주한 택지지구가 덮는 읍면동 (존 안 통행에서 도시철도를 더 탄다) */
export function housingSubList() {
  if (!subsFC) return [];
  const out = new Set();
  for (const h of state.housing || []) if ((h.done ? h.persons : h.occupied) > 0) for (const q of housingParts(h)) out.add(q.sub);
  return [...out];
}

// ------------------------------------------------------------ 시뮬레이션 결과

export function onWorker(ev) {
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

export function applyResult(res) {
  if (pendingStep) { for (const [n, t] of res.perf || []) perf.push([`worker: ${n}`, t]); mark('y: result'); }
  res.subs = fromModelSubs(res.subs);   // 계산 워커의 소구역 순서를 전체 번호 순서로 (떼어 낸 남측 법정리, risplit.js)
  loading.done('sim');
  const stepped = result !== null && pendingStep;
  pendingStep = false;
  setResult(res);
  state.snapshot = res.snapshot;
  initSubBase(state, res.subs);
  gains = subGains(state, res.subs);

  const { vc } = res.links;
  paintVolumes();
  paintZones();
  paintAir(res.air);
  refreshPoints();   // 역 중요도는 이용객으로 정한다

  setRequests(updateCongestion(base, state, vc, stepped || !state.history.length));
  const prevHappy = happiness ? avgHappiness() : null;
  setHappiness(computeHappiness(res));
  if (stepped) {
    if (DIFFICULTY[state.difficulty].autoApprove) autoApprove();
    updateApproval(state, requests, res.summary, prevSummary, roadCongestedKm(vc), [nationalFactor(res.subs, gains)]);
    updateMayorApproval(state, zoneGains(zoneProps, res.subs, gains, extraSubs.map((e) => [e.g, e.zone])));
    // 철도 운영사 한 해 결산
    settleRail(state, operatorEconomics());
    settleMega(state, base);
    // 지방선거·단체장 SOC 제안
    localYear(lastDone);
    // 민자사업 정산 (최소운영수입보장·임대료)
    pppYear();
    setLastDone([]);
    // 주민 행복도가 오르면 지지율도 오른다
    updateAirRoutes(state, res.air, airportName);
    if (prevHappy) state.approval = Math.max(0, Math.min(100, state.approval + 0.5 * (avgHappiness().all - prevHappy.all)));
  }
  setPrevSummary(res.summary);
  const congestedKm = roadCongestedKm(vc);
  const last = state.history[state.history.length - 1];
  if (!last || last.year !== state.year) {
    state.history.push({
      year: state.year, krPop: res.summary.KR.pop, kpPop: res.summary.KP.pop,
      krHdi: res.summary.KR.hdi, kpHdi: res.summary.KP.hdi,
      krInc: res.summary.KR.income, kpInc: res.summary.KP.income,
      kpToKr: res.summary.kpToKr, rail: res.totals.rail / res.totals.trips, congestedKm, trips: res.totals.trips,
      air: res.totals.air / res.totals.trips, road: res.totals.road / res.totals.trips, transit: res.totals.transit / res.totals.trips,
      allTransit: allTransitShare(res.totals), localMetro: res.totals.local ? res.totals.local.metro / Math.max(1, res.totals.local.trips) : null,
      happyKR: avgHappiness().KR, happyKP: avgHappiness().KP, debt: state.debt, approval: state.approval, integration: state.integration,
    });
  }
  // 결산의 비교 기준: 시작한 해의 상징 구간 소요 시간을 한 번 재 둔다
  if (!state.times0 && state.year === (state.history[0]?.year ?? state.year)) routeTimes().then((t) => { state.times0 = t; save(state); });
  if (state.goal === 'sp90') routeTimes().then((t) => { setGoalTimes(t); renderStatus(); });
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

export let pendingStep = false;
// 여러 해 이어 넘기기: 남은 해 (0이면 멈춤)
export let autoYears = 0;
export function runYears(n) {
  if (autoYears) { autoYears = 0; updateAutoBtn(); toast('이어 넘기기를 멈춥니다 (지금 계산 중인 해까지).'); return; }
  if (busy || !result) return;
  autoYears = n;
  updateAutoBtn();
  nextYear();
}
export function updateAutoBtn() {
  const b = $('#btn-next5');
  if (!b) return;
  b.textContent = autoYears ? `멈춤 (${autoYears})` : '5년 ▶▶';
  b.classList.toggle('on', !!autoYears);
  b.disabled = !result || (busy && !autoYears);
}
export let gains = null;   // 읍면동 체감 교통 개선 (시작 대비 점수)

export function nextYear() {
  if (busy || !result) return;
  mark('y: start');
  cancelDraft();
  // 노선도는 지난해 결과로 그렸으므로 닫는다
  stopLineDiagram();
  $('#linediagram').hidden = true;
  const done = advanceBudgetYear(base, state);
  setLastDone(done);
  adminInvalidate();   // 이름 되찾기·승격이 끝났을 수 있다
  afterStraighten(done);
  if (done.some((p) => p.kind === 'rename')) { refreshNames(map); if (namer) resetNamer(); }
  mark('y: budget');
  // 노선 다시 그리기(1~2초)는 완공·개통한 사업이 있는 해에만
  if (done.length) { refreshLinks(); refreshPoints(); if (done.some((p) => /^retire[12]$/.test(p.upgrade || ''))) refreshClosed(); }
  mark('y: links');
  pendingStep = true;
  setBusy(true, `${state.year}년 계산 중`, 0);
  // 선로가 열리기를 기다리던 계통(서해선 원시–서화성 직통 등)은 그해부터 다닌다
  openWaitingServices(state, effectiveNetwork(base, state), base.stations);
  const opened = done.some((p) => p.kind === 'new');   // 플레이어가 놓은 새 노선 (이어받은 공사는 해마다 열려서 뺀다)
  // 완공된 역세권 개발: 분양 수익과 인구 순유입
  const dev = [...settleDevels(state, done), ...settleHousing(state, done)];
  housingComplaints();
  settleSEZ(done);
  settleUniv(done);
  univYear();
  // 남북 통합도가 오르면 북측 관광지가 하나씩 열린다
  for (const s of newlyUnlocked(state, tourSites)) {
    const z = zoneOfSite(s);
    state.log.unshift(`${state.year}년 관광지 해금: ${s.name} (남북 통합도 ${Math.round(unlockAt(s) * 100)}%)`);
    showNotice(`관광지 해금: ${esc(s.name)}`, `남북 통합도가 ${Math.round(unlockAt(s) * 100)}%에 이르러 <b>${esc(s.name)}</b>(${esc(zoneName(z))}) 관광이 열렸습니다.
      남측과 국외에서 관광객이 찾아오기 시작하고, 통합도가 오를수록 늘어납니다 (많을 때 연 ${s.visitors}백만 명).<br><span class="m">가는 철도·도로를 놓으면 관광 통행이 더 늘어납니다.</span>`);
  }
  const tourKP = unlockedTourKP(state, tourSites, zoneOfSite, zoneProps.length);
  // 입주로 1km 격자가 바뀌었으면 함께 넘긴다 (시뮬레이션 역세권·도심 밀도)
  const g = effectiveGrid(), gridMsg = g !== gridSent ? toModelGrid(g).buffer.slice(0) : null;
  setGridSent(g);
  if (map.getLayoutProperty('grid-heat', 'visibility') === 'visible') showDensity(true);
  // 예전 저장: 이미 입주한 택지지구·역세권 개발의 인구가 해마다 같은 시군구 다른 읍면동으로 흩어졌다. 한 번 제자리로 돌려놓고 붙든다
  const anchor = state.devAnchored ? null : settledDevelopments().map(({ zone, lon, lat, persons }) => ({ zone, lon, lat, persons }));
  state.devAnchored = 1;
  const modelParts = (parts) => parts.map((q) => ({ ...q, sub: toModelSub(q.sub) }));   // 계산 워커의 소구역 번호로
  for (const d of dev) if (d.hid) { const h = (state.housing || []).find((x) => x.id === d.hid); if (h) d.parts = modelParts(housingParts(h)); }
  // 예전 저장: 한 읍면동에 몰린 택지지구 인구를 지구가 덮는 읍면동들로 (한 번)
  const spread = state.housingSpread ? null : (state.housing || []).filter((h) => (h.done ? h.persons : h.occupied) > 0)
    .map((h) => ({ zone: h.zone, lon: h.lon, lat: h.lat, persons: h.done ? h.persons : h.occupied, parts: modelParts(housingParts(h)) }));
  state.housingSpread = 1;
  if (anchor?.length) state.log.unshift(`${state.year}년: 이미 입주한 택지지구·역세권 개발 ${anchor.length}곳의 인구를 지구 안으로 다시 맞췄습니다 (다른 읍면동으로 흩어진 만큼은 새로 채움, 인구 순증)`);
  worker.postMessage({ type: 'step', net: effectiveNetwork(base, state), ctx: { ...ctx(), dev, tourKP, grid: gridMsg, anchor, spread }, opened });
  mark('y: posted');
}

export function autoApprove() {
  for (const r of requests.slice(0, 5)) {
    const fix = defaultFix(linkAt(base, state, r.links[0]));
    if (!fix) continue;
    const cost = r.links.reduce((sum, id) => sum + upgradeCost(fix, linkAt(base, state, id)), 0);
    if (cost / fix.years > state.budget) continue;
    startUpgrade(base, state, r.links, fix.id);
  }
  const work = linksUnderWork(state);
  setRequests(requests.filter((r) => !r.links.every((id) => work.has(id))));
}

/**
 * 존별 주민 행복도 (0~100): HDI, 접근성, 대중교통 접근, 소득 증가, 사업 효과(옛 이름 되찾기 등)
 */
export function computeHappiness(res) {
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
  setLastIncome(Float64Array.from(z.income));
  return h;
}

export function avgHappiness() {
  const p = result.zones.pop;
  const out = { KR: [0, 0], KP: [0, 0], all: 0 };
  zoneProps.forEach((zp, i) => { if (zp.ext) return; const c = out[zp.country]; c[0] += happiness[i] * p[i]; c[1] += p[i]; });
  const tot = out.KR[1] + out.KP[1];
  out.all = (out.KR[0] + out.KP[0]) / tot;
  out.KR = out.KR[0] / out.KR[1];
  out.KP = out.KP[0] / out.KP[1];
  return out;
}

/** 단체장 직함에 쓰는 시군 이름 (분구한 곳도 존 이름 그대로: 중구) */
/** 시군 이름: 직접 바꾼 이름, 없으면 행정구역 정리 이름 위에 승격·편입을 얹은 이름 (countyDisplayName) */
export function zoneLabel(i) { return state.placeNames?.[`z:${i}`] || countyDisplayName(state, zoneProps[i]); }
export function officeName(i) { return zoneLabel(i); }
export function zoneName(i) { const g = guNamesOfZone(i); return g && !isGeneralGu(i) ? g.join('·') : zoneLabel(i); }
/** 지도에서 한 시군으로 보이는 존끼리 같은 값: 보이는 이름 + 광역 단체 (옛 군 땅을 떼어 낸 계산용 조각은 몸통과 같다) */
export function countyKey(i) { const z = zoneProps[i]; return z.ext ? `ext:${i}` : `${zoneName(i)}|${regionOf(state, z)}`; }

/** 공항(원 크기 = 여객)과 주요 항공 노선 */
export function paintAir(air) {
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
export function arc(a, b) {
  const mx = (a.lon + b.lon) / 2, my = (a.lat + b.lat) / 2;
  const dx = b.lon - a.lon, dy = b.lat - a.lat;
  const cx = mx - dy * 0.15, cy = my + dx * 0.15;
  const out = [];
  for (let t = 0; t <= 1.0001; t += 0.1) {
    out.push([(1 - t) ** 2 * a.lon + 2 * (1 - t) * t * cx + t * t * b.lon, (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * cy + t * t * b.lat]);
  }
  return out;
}

export function roadCongestedKm(vc) {
  let km = 0;
  for (let i = 0; i < vc.length; i++) {
    if (vc[i] > 1) { const l = linkAt(base, state, i); if (l.mode === 0) km += l.len; }
  }
  return km;
}

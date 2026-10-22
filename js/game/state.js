// 게임 상태: 예산, 공사 중 사업, 혼잡 민원, 이름, 저장/불러오기.
import { DIFFICULTY, UPGRADES, NEW_BUILDS, KP_COST_FACTOR, AIRPORT, upgradeCost, resolve, formatWon } from './catalog.js';
import { P } from '../sim/params.js';
import { routeKey } from '../sim/model.js';
import { smoothSegments, polylineKm } from './curve.js';
import { serviceLinks } from './services.js';

const SAVE_KEY = 'ukt-save-v1';
const START_YEAR = 2026;
export const CONGESTION_VC = 1.0;
export const CONGESTION_YEARS = 1;

export function newGame(difficulty = 'normal') {
  const d = DIFFICULTY[difficulty];
  return {
    version: 1,
    difficulty,
    year: START_YEAR,
    budget: d.annualBudget,
    debt: 0,
    approval: 60,
    integration: P.integrationStart,
    policy: 'limited',
    overrides: {},      // 기존 링크 id → 바뀐 속성
    newNodes: [],       // [lon, lat]
    newLinks: [],       // 신설 링크 (id = 기본 링크 수 + 인덱스)
    newStations: [],    // 역이 된 노드 id
    newAirports: [],    // 신설 공항 {id, name, lon, lat, cap, kp, built}
    airportCap: {},     // 공항 id → 확장 뒤 용량
    names: {},          // 노드 id → {name, kind, auto}
    projects: [],
    congestion: {},     // 링크 id → 연속 혼잡 연수
    dismissed: {},      // 링크 id → 민원 무시한 해
    history: [],
    log: [`${START_YEAR}년, 남북이 통일되었습니다. 첫 해 SOC 예산 ${formatWon(d.annualBudget)}이 배정되었습니다.`],
    snapshot: null,
    placeNames: {},     // 'z:존' / 'u:읍면동' → 바뀐 이름
    air: { auto: true, routes: null, banned: [] },  // 항공 노선 (routes: 키 → {a, b, freq, origin, low})
    happyBonus: {},     // 존 → 행복도 가산점 (사업 효과, 해마다 줄어듦)
    services: [],       // 운행 계통 (특급·급행·보통)
  };
}

export function save(state) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export function load() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* 저장소 없음 */ }
}

/** 기본 네트워크 + 개량 + 신설을 합친, 시뮬레이션에 넘길 네트워크 */
export function effectiveNetwork(base, state) {
  const nodes = base.nodes.concat(state.newNodes);
  const building = new Set();
  for (const p of state.projects) if (p.status === 'building' && p.kind === 'upgrade') p.links.forEach((id) => building.add(id));
  const links = base.links.map((l, i) => {
    const o = state.overrides[i];
    const m = o ? { ...l, ...o } : { ...l };
    // OSM에 공사 중으로 올라온 노선은 개통 연도부터 쓴다
    m.active = !(l.open > state.year) && !state.replaced?.[i];
    if (building.has(i) && m.mode === 0) m.speed = Math.round(m.speed * 0.85); // 공사 중 감속
    delete m.geom;
    return m;
  });
  for (const nl of state.newLinks) {
    const o = state.overrides[nl.id];
    const m = o ? { ...nl, ...o } : { ...nl };
    m.active = nl.built && !nl.replaced;
    delete m.geom;
    links.push(m);
  }
  const stations = base.stations.map((s) => s[1])
    .concat((base.metro_stations || []).map((s) => s[1]), state.newStations);
  const airports = (base.airports || []).map((a) => ({ ...a, cap: state.airportCap?.[a.id] ?? a.cap }))
    .concat((state.newAirports || []).filter((a) => a.built).map((a) => ({ ...a, cap: state.airportCap?.[a.id] ?? a.cap, intl: true })));
  const airRoutes = Object.values(state.air?.routes || {}).map((r) => ({ a: r.a, b: r.b, freq: r.freq }));
  // 운행 계통(특급·급행·보통)은 실제 링크 뒤에 가상 링크로 붙는다
  const physCount = links.length;
  links.push(...serviceLinks(state, links));
  const serviceStops = (state.services || []).filter((s) => s.built).map((s) => ({ stops: s.stops, trains: s.trains }));
  return { nodes, links, physCount, serviceStops, stations: [...new Set(stations)], airports, airRoutes, airBanned: state.air?.banned || [] };
}

export function linkAt(base, state, id) {
  const l = id < base.links.length ? base.links[id] : state.newLinks[id - base.links.length];
  const o = state.overrides[id];
  return o ? { ...l, ...o } : l;
}

export function committedThisYear(state) {
  let s = 0;
  for (const p of state.projects) if (p.status === 'building') s += p.annual;
  return s;
}

/** 지금 착공할 수 있는지: 올해 분담액이 남은 예산 + 차입 한도 안이어야 한다 */
export function canAfford(state, cost, years) {
  const d = DIFFICULTY[state.difficulty];
  return cost / years <= state.budget + (d.borrowLimit - state.debt);
}

export function startProject(state, p) {
  p.annual = Math.round(p.cost / p.years);
  p.paid = p.annual;
  p.startYear = state.year;
  p.doneYear = state.year + p.years;
  p.status = 'building';
  pay(state, p.annual);
  state.projects.push(p);
  state.log.unshift(`${state.year}년 착공: ${p.label} (${formatWon(p.cost)}, ${p.years}년)`);
}

function pay(state, amount) {
  state.budget -= amount;
  if (state.budget < 0) { state.debt += -state.budget; state.budget = 0; }
}

/** 공사 중인 링크 id 집합 */
// ------------------------------------------------------------ 항공 노선

export const AIR = {
  openCost: 200,        // 취항 지원 (억원), 국제선·남북 노선은 1.5배
  manualFreq: 7,        // 직접 연 노선의 첫 운항 횟수 (하루 왕복)
  openPax: 1500,        // 자동 취항: 잠재 수요(하루)가 이보다 많으면 항공사가 취항
  closePax: 200,        // 자동 단항: 2년 연속 이보다 적으면 철수
  targetLoad: 0.75,     // 운항 횟수는 탑승률 75%를 목표로 맞춘다
  maxFreq: 150,
  maxNewPerYear: 5,
};

/** 처음 시작할 때 기본 노선표(data/air_sea.json routes)로 채운다 */
export function initAirRoutes(state, defaults) {
  state.air ||= { auto: true, routes: null, banned: [] };
  if (state.air.routes) return;
  state.air.routes = {};
  for (const [a, b, f] of defaults) state.air.routes[routeKey(a, b)] = { a, b, freq: f, origin: 'base', low: 0 };
}

function targetFreq(pax, seats) {
  return Math.min(AIR.maxFreq, Math.max(1, Math.ceil(pax / (2 * seats * AIR.targetLoad))));
}

/**
 * 해마다 노선을 자동 운영한다: 운항 횟수 조정, 수요가 적은 노선 단항, 잠재 수요가 큰 노선 신규 취항.
 * 직접 연 노선(manual)은 단항하지 않는다. 운항을 금지한 노선(banned)은 열지 않는다.
 */
export function updateAirRoutes(state, air, name) {
  const routes = state.air.routes;
  for (const [ai, bi, pax] of air.routes) {
    const key = routeKey(air.ids[ai], air.ids[bi]);
    const r = routes[key];
    if (!r) continue;
    if (state.air.auto) r.freq = Math.max(1, Math.round(r.freq + 0.5 * (targetFreq(pax, air.seats) - r.freq)));
    r.low = pax < AIR.closePax ? (r.low || 0) + 1 : 0;
    if (state.air.auto && r.origin !== 'manual' && r.low >= 2) {
      delete routes[key];
      state.log.unshift(`${state.year}년 단항: ${name(r.a)}–${name(r.b)} (하루 ${Math.round(pax)}명)`);
    }
  }
  if (!state.air.auto) return;
  let opened = 0;
  for (const [ai, bi, pax] of air.latent) {
    if (pax < AIR.openPax || opened >= AIR.maxNewPerYear) break;
    const a = air.ids[ai], b = air.ids[bi], key = routeKey(a, b);
    if (routes[key] || state.air.banned.includes(key)) continue;
    routes[key] = { a, b, freq: targetFreq(pax, air.seats), origin: 'auto', low: 0 };
    state.log.unshift(`${state.year}년 신규 취항: ${name(a)}–${name(b)} (잠재 수요 하루 ${Math.round(pax).toLocaleString()}명)`);
    opened++;
  }
}

/** 노선 직접 개설: 취항 지원금을 내고 1년 뒤 운항 */
export function startOpenRoute(state, apA, apB) {
  const key = routeKey(apA.id, apB.id);
  if (state.air.routes[key]) return { ok: false, reason: '이미 운항 중인 노선입니다.' };
  if (state.projects.some((p) => p.status === 'building' && p.key === key)) return { ok: false, reason: '이미 준비 중인 노선입니다.' };
  const cost = Math.round(AIR.openCost * (apA.country !== apB.country ? 1.5 : 1));
  if (!canAfford(state, cost, 1)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  startProject(state, { id: crypto.randomUUID(), kind: 'airRoute', key, a: apA.id, b: apB.id, links: [], cost, years: 1,
    label: `항공 노선 개설: ${apA.name}–${apB.name}` });
  return { ok: true };
}

/** 노선 운항 중단 (자동 운영으로 다시 열리지 않도록 금지 목록에 넣는다) */
export function closeRoute(state, key, label) {
  delete state.air.routes[key];
  if (!state.air.banned.includes(key)) state.air.banned.push(key);
  state.log.unshift(`${state.year}년 운항 중단: ${label}`);
}

export function linksUnderWork(state) {
  const s = new Set();
  for (const p of state.projects) if (p.status === 'building') p.links.forEach((id) => s.add(id));
  return s;
}

/** 기존 링크 개량. linkIds는 한 링크 또는 같은 노선의 여러 링크 */
export function startUpgrade(base, state, linkIds, upgradeId) {
  const ids = Array.isArray(linkIds) ? linkIds : [linkIds];
  const u = UPGRADES.find((x) => x.id === upgradeId);
  const work = linksUnderWork(state);
  const targets = ids.filter((id) => !work.has(id) && u.applies(linkAt(base, state, id)));
  if (!targets.length) return { ok: false, reason: '이미 공사 중이거나 적용할 수 없는 구간입니다.' };
  let cost = 0, km = 0;
  for (const id of targets) { const l = linkAt(base, state, id); cost += upgradeCost(u, l); km += l.len; }
  if (!canAfford(state, cost, u.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  const first = linkAt(base, state, targets[0]);
  startProject(state, {
    id: crypto.randomUUID(), kind: 'upgrade', upgrade: u.id, links: targets, cost, years: u.years,
    label: `${first.name || '무명 구간'} ${resolve(u.label, first)} (${km.toFixed(0)}km)`,
  });
  return { ok: true };
}

/**
 * 신설 사업. nodes: 경로상 노드 id (기존 노드 또는 새로 만든 노드)
 * @param {{type:string, points:{node:number|null, lon:number, lat:number}[], names:Record<number,{name:string,kind:string}>}} plan
 */
/**
 * 구간 중간에 결절점을 만든다 (중간 IC·역). 원래 구간은 쓰지 않고, 같은 속성의 두 구간으로 바꾼다.
 * @returns {number} 새 노드 id
 */
export function splitLink(base, state, id, lon, lat) {
  const l = linkAt(base, state, id);
  const src = id < base.links.length ? base.links[id] : state.newLinks[id - base.links.length];
  // 도형을 선(NaN으로 나뉜 조각)들로 풀고, 가장 가까운 점에서 자른다
  const parts = [[]];
  for (let k = 0; k < src.geom.length; k += 2) {
    if (Number.isNaN(src.geom[k])) parts.push([]);
    else parts[parts.length - 1].push([src.geom[k], src.geom[k + 1]]);
  }
  let best = { d: Infinity };
  parts.forEach((pts, pi) => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[k + 1];
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy || 1)));
      const px = x1 + t * dx, py = y1 + t * dy;
      const d = (px - lon) ** 2 + (py - lat) ** 2;
      if (d < best.d) best = { d, pi, k, px, py };
    }
  });
  const node = base.nodes.length + state.newNodes.length;
  state.newNodes.push([best.px, best.py]);
  const flat = (ps) => ps.flatMap((pts, i) => (i ? [NaN, NaN] : []).concat(pts.flat()));
  const main = parts[best.pi] || [];
  const before = parts.slice(0, best.pi).concat([main.slice(0, best.k + 1).concat([[best.px, best.py]])]);
  const after = [[[best.px, best.py]].concat(main.slice(best.k + 1))].concat(parts.slice(best.pi + 1));
  const lenOf = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  let fa = lenOf(before[before.length - 1]) / Math.max(lenOf(main), 1e-9);
  // 도형이 b→a 방향으로 저장된 구간이면 비율을 뒤집는다
  const na = l.a < base.nodes.length ? base.nodes[l.a] : state.newNodes[l.a - base.nodes.length];
  if (main.length && na) {
    const d0 = (main[0][0] - na[0]) ** 2 + (main[0][1] - na[1]) ** 2;
    const d1 = (main[main.length - 1][0] - na[0]) ** 2 + (main[main.length - 1][1] - na[1]) ** 2;
    if (d1 < d0) fa = 1 - fa;
  }
  // 개량으로 바뀐 속성까지 이어받는다
  const attrs = { ...l };
  delete attrs.geom; delete attrs.id; delete attrs.replaced;
  const first = base.links.length + state.newLinks.length;
  // 원래 구간의 끝 노드: 도형 방향이 a→b라고 본다 (파이프라인이 그렇게 만든다)
  state.newLinks.push(
    { ...attrs, id: first, a: l.a, b: node, len: Math.max(0.1, Math.round(l.len * fa * 100) / 100), built: true, geom: flat(before), split: id },
    { ...attrs, id: first + 1, a: node, b: l.b, len: Math.max(0.1, Math.round(l.len * (1 - fa) * 100) / 100), built: true, geom: flat(after), split: id },
  );
  if (id < base.links.length) (state.replaced ||= {})[id] = true;
  else state.newLinks[id - base.links.length].replaced = true;
  return node;
}

export function startNewBuild(base, state, plan) {
  const spec = NEW_BUILDS[plan.type];
  const firstId = base.links.length + state.newLinks.length;
  const nodeIds = plan.points.map((pt) => {
    if (pt.node != null) return pt.node;
    state.newNodes.push([pt.lon, pt.lat]);
    return base.nodes.length + state.newNodes.length - 1;
  });
  let total = 0, kmTotal = 0;
  const links = [];
  const segs = smoothSegments(plan.points);   // 찍은 점들을 지나는 곡선. 연장도 곡선 길이로 잡는다
  for (let i = 0; i + 1 < nodeIds.length; i++) {
    const a = plan.points[i], b = plan.points[i + 1];
    const len = polylineKm(segs[i]) * 1.02;
    const kp = isKP(a.lat, a.lon) && isKP(b.lat, b.lon) ? 1 : 0;
    // 외국 땅 위 구간은 상대국이 절반을 부담한다 (main에서 구간별 비율을 넘긴다)
    const cost = Math.round(spec.perKm * len * (kp ? KP_COST_FACTOR : 1) * (plan.segFactor?.[i] ?? 1));
    total += cost; kmTotal += len;
    links.push({
      id: firstId + i, a: nodeIds[i], b: nodeIds[i + 1], mode: spec.mode, len: Math.round(len * 100) / 100,
      kp, name: plan.lineName || '', built: false, geom: segs[i].flat().map((v) => Math.round(v * 1e5) / 1e5), ...spec.attrs,
    });
  }
  total += plan.extraCost || 0;   // 중간 IC·역·휴게소 설치비
  if (!canAfford(state, total, spec.years)) {
    state.newNodes.length -= plan.points.filter((p) => p.node == null).length;
    return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  }
  state.newLinks.push(...links);
  plan.points.forEach((pt, i) => {
    const nm = plan.names[i];
    if (nm) state.names[nodeIds[i]] = { name: nm.name, kind: nm.kind, auto: nm.auto !== false };
  });
  for (const r of plan.restAreas || []) (state.restAreas ||= []).push({ ...r, built: false, links: links.map((l) => l.id) });
  const endName = (i) => plan.points[i].name || nameOf(state, nodeIds[i]) || '';
  // 기존선 연장은 노선 이름을 이어 쓰고, 신설은 새 노선으로 적는다
  const span = `${endName(0)}–${endName(nodeIds.length - 1)} (${kmTotal.toFixed(0)}km)`;
  const label = plan.extendOf ? `${plan.extendOf} 연장 ${span}` : `${plan.lineName ? `${plan.lineName} ` : ''}${spec.label} ${span}`;
  startProject(state, {
    id: crypto.randomUUID(), kind: 'new', type: plan.type, links: links.map((l) => l.id), extension: !!plan.extendOf,
    stations: spec.mode >= 1 ? nodeIds.filter((_, i) => plan.names[i]?.kind === 'station') : [],
    cost: total, years: spec.years, label,
  });
  return { ok: true };
}

// ------------------------------------------------------------ 공항

export function startAirport(state, { lon, lat, name }) {
  const kp = isKP(lat, lon);
  const cost = Math.round(AIRPORT.build.cost * (kp ? KP_COST_FACTOR : 1));
  if (!canAfford(state, cost, AIRPORT.build.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  const id = `NEW${(state.newAirports || []).length + 1}`;
  state.newAirports ||= [];
  state.newAirports.push({ id, name, lon, lat, cap: AIRPORT.build.cap, country: kp ? 'KP' : 'KR', built: false });
  startProject(state, { id: crypto.randomUUID(), kind: 'airport', airport: id, links: [], cost, years: AIRPORT.build.years, label: `${name} 신설` });
  return { ok: true };
}

export function startAirportExpand(state, airport) {
  if (state.projects.some((p) => p.status === 'building' && p.airport === airport.id)) return { ok: false, reason: '이미 공사 중인 공항입니다.' };
  const cost = Math.round(AIRPORT.expand.cost * (airport.country === 'KP' ? KP_COST_FACTOR : 1));
  if (!canAfford(state, cost, AIRPORT.expand.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  startProject(state, {
    id: crypto.randomUUID(), kind: 'airportExpand', airport: airport.id, newCap: airport.cap + AIRPORT.expand.cap, links: [],
    cost, years: AIRPORT.expand.years, label: `${airport.name} 확장 (연 ${airport.cap}→${airport.cap + AIRPORT.expand.cap}백만 명)`,
  });
  return { ok: true };
}

// ------------------------------------------------------------ 지명

/** 옛 이름 되찾기 사업비(억원)와 완공 뒤 행복도 효과 */
export const RENAME = {
  zone: { cost: 300, years: 1, bonus: 6 },
  unit: { cost: 30, years: 1, bonus: 2 },
};

export function placeKey(level, id) { return `${level === 'zone' ? 'z' : 'u'}:${id}`; }

/** 플레이어가 바꾼 이름이 있으면 그것, 없으면 원래 이름 */
export function placeName(state, level, id, original) {
  return state.placeNames?.[placeKey(level, id)] || original;
}

/** 직접 이름 바꾸기: 비용 없이 표시만 바뀐다 */
export function setPlaceName(state, level, id, name) {
  state.placeNames ||= {};
  state.placeNames[placeKey(level, id)] = name;
  state.log.unshift(`${state.year}년 지명 변경: ${name}`);
}

/** 옛 이름 되찾기 사업 (표지판·행정 문서·지도 교체). 완공되면 이름이 바뀌고 주민 행복도가 오른다 */
export function startRestoreName(state, target) {
  const r = RENAME[target.level];
  if (state.projects.some((p) => p.kind === 'rename' && p.key === placeKey(target.level, target.id))) {
    return { ok: false, reason: '이미 진행 중이거나 끝난 사업입니다.' };
  }
  if (!canAfford(state, r.cost, r.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  startProject(state, {
    id: crypto.randomUUID(), kind: 'rename', key: placeKey(target.level, target.id), links: [],
    zone: target.zone, newName: target.historic, bonus: r.bonus, cost: r.cost, years: r.years,
    label: `옛 이름 되찾기: ${target.current} → ${target.historic}`,
  });
  return { ok: true };
}

/** 새로 놓은 노선 이름 바꾸기 (같은 이름의 신설 구간 모두) */
export function renameLine(state, oldName, newName) {
  for (const l of state.newLinks) if (l.name === oldName) l.name = newName;
  for (const p of state.projects) if (p.label.startsWith(`${oldName} `)) p.label = p.label.replace(oldName, newName);
}

export function nameOf(state, node) {
  return state.names[node]?.name;
}

// 대략적인 남북 경계 (군사분계선 근사). 비용 계수 판정용.
export function isKP(lat, lon) {
  const mdl = [[124.6, 37.75], [126.1, 37.75], [126.7, 37.95], [127.1, 38.3], [127.8, 38.3], [128.36, 38.62], [129.5, 38.62]];
  for (let i = 0; i + 1 < mdl.length; i++) {
    const [x1, y1] = mdl[i], [x2, y2] = mdl[i + 1];
    if (lon >= x1 && lon <= x2) return lat > y1 + (y2 - y1) * (lon - x1) / (x2 - x1);
  }
  return lat > 38.3;
}

/** 해 넘기기 전 처리: 공사 진행·완공, 예산 배정, 이자. 완공 사업 목록을 돌려준다 */
export function advanceBudgetYear(base, state) {
  const d = DIFFICULTY[state.difficulty];
  state.year += 1;
  state.budget += d.annualBudget;
  if (state.debt > 0) {
    const interest = Math.round(state.debt * d.interest);
    pay(state, interest);
  }
  const done = [];
  for (const p of state.projects) {
    if (p.status !== 'building') continue;
    if (state.year >= p.doneYear) {
      p.status = 'done';
      done.push(p);
      completeProject(base, state, p);
    } else {
      pay(state, p.annual);
      p.paid += p.annual;
    }
  }
  // 상환: 남은 예산의 일부로 빚을 갚는다
  if (state.debt > 0 && state.budget > 0) {
    const r = Math.min(state.debt, Math.round(state.budget * 0.2));
    state.debt -= r; state.budget -= r;
  }
  state.integration = Math.min(1, state.integration + P.integrationPerYear);
  for (const k of Object.keys(state.happyBonus || {})) {
    state.happyBonus[k] *= 0.9;
    if (state.happyBonus[k] < 0.2) delete state.happyBonus[k];
  }
  for (const p of done) state.log.unshift(`${state.year}년 완공: ${p.label}`);
  // OSM의 공사 중 노선 개통
  // OSM 이름에 붙은 "(2029예정)" 같은 공사 메모는 뗀다
  const opened = new Set(base.links.filter((l) => l.open === state.year)
    .map((l) => (l.name || '').replace(/\s*\([^)]*(예정|개통|공사|건설)[^)]*\)/g, '').trim() || '이름 없는 구간'));
  for (const n of opened) state.log.unshift(`${state.year}년 개통: ${n}`);
  return done;
}

function completeProject(base, state, p) {
  if (p.kind === 'service') {
    const s = (state.services || []).find((x) => x.id === p.service);
    if (s) s.built = true;
    return;
  }
  if (p.kind === 'airRoute') {
    state.air.routes[p.key] = { a: p.a, b: p.b, freq: AIR.manualFreq, origin: 'manual', low: 0 };
    state.air.banned = state.air.banned.filter((k) => k !== p.key);
    return;
  }
  if (p.kind === 'airport') {
    const a = state.newAirports.find((x) => x.id === p.airport);
    if (a) a.built = true;
    return;
  }
  if (p.kind === 'airportExpand') {
    state.airportCap ||= {};
    state.airportCap[p.airport] = p.newCap;
    return;
  }
  if (p.kind === 'rename') {
    state.placeNames ||= {};
    state.happyBonus ||= {};
    state.placeNames[p.key] = p.newName;
    state.happyBonus[p.zone] = (state.happyBonus[p.zone] || 0) + p.bonus;
    return;
  }
  if (p.kind === 'upgrade') {
    const u = UPGRADES.find((x) => x.id === p.upgrade);
    for (const id of p.links) {
      const link = linkAt(base, state, id);
      state.overrides[id] = { ...(state.overrides[id] || {}), ...u.apply(link) };
    }
  } else {
    for (const id of p.links) state.newLinks[id - base.links.length].built = true;
    for (const r of state.restAreas || []) if (p.links.includes(r.links[0])) r.built = true;
    for (const s of p.stations) if (!state.newStations.includes(s)) state.newStations.push(s);
  }
}

/** 민원 대상: 남은 고속도로·간선국도와 철도, 북은 모든 도로·철도 */
function requestable(l) {
  if (l.open > 0) return false; // 아직 개통 전인 공사 중 노선
  if (l.ext || l.cls === 'ferry') return false; // 국경 연결·여객선 항로는 민원 대상이 아니다
  return l.len > 1 && (l.mode === 1 || l.kp || l.cls === 'motorway' || l.cls === 'trunk');
}

/**
 * 결과를 받아 혼잡 민원을 갱신한다. increment가 false면 연수를 늘리지 않고 목록만 만든다.
 * 같은 이름·등급의 혼잡 구간은 한 민원으로 묶는다.
 * @returns {{key:string, links:number[], name:string, cls:string, mode:number, km:number, vc:number, years:number}[]}
 */
export function updateCongestion(base, state, vc, increment = true) {
  const work = linksUnderWork(state);
  for (let i = 0; increment && i < vc.length; i++) {
    const l = linkAt(base, state, i);
    if (vc[i] > CONGESTION_VC && requestable(l) && !work.has(i)) {
      state.congestion[i] = (state.congestion[i] || 0) + 1;
    } else delete state.congestion[i];
  }
  const groups = new Map();
  for (const [k, years] of Object.entries(state.congestion)) {
    const id = +k;
    if (years < CONGESTION_YEARS || work.has(id)) continue;
    const l = linkAt(base, state, id);
    const key = `${l.mode}|${l.cls}|${l.kp}|${l.name || '#' + id}`;
    if (state.dismissed[key] === state.year) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, links: [], name: l.name, cls: l.cls, mode: l.mode, kp: l.kp, km: 0, vc: 0, years });
    g.links.push(id);
    g.km += l.len;
    g.vc = Math.max(g.vc, vc[id]);
    g.years = Math.max(g.years, years);
  }
  // V/C가 높은 노선부터
  return [...groups.values()].sort((a, b) => b.vc - a.vc);
}

/** 민원 대응에 맞는 기본 개량 (도로: 차로 확장, 철도: 복선화 또는 2복선화) */
export function defaultFix(link) {
  const order = link.mode === 0 ? ['widen', 'tomotorway'] : ['double', 'quad', 'speedup'];
  for (const id of order) {
    const u = UPGRADES.find((x) => x.id === id);
    if (u.applies(link)) return u;
  }
  return null;
}

/** 지지율: 민원 방치·부채는 깎고, 북측 HDI 개선은 올린다 */
export function updateApproval(state, requests, summary, prevSummary) {
  let a = state.approval;
  a -= Math.min(requests.length, 15) * 0.3;
  const d = DIFFICULTY[state.difficulty];
  a -= (state.debt / d.borrowLimit) * 3;
  if (prevSummary) a += (summary.KP.hdi - prevSummary.KP.hdi) * 400 + (summary.KR.hdi - prevSummary.KR.hdi) * 200;
  a += (60 - a) * 0.05;
  state.approval = Math.max(0, Math.min(100, a));
}

export { upgradeCost, UPGRADES, NEW_BUILDS };

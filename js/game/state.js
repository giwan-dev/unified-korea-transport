// 게임 상태: 예산, 공사 중 사업, 혼잡 민원, 이름, 저장/불러오기.
import { DIFFICULTY, UPGRADES, NEW_BUILDS, KP_COST_FACTOR, AIRPORT, upgradeCost, resolve, formatWon } from './catalog.js';
import { P } from '../sim/params.js';
import { routeKey } from '../sim/model.js';
import { smoothSegments, polylineKm } from './curve.js';
import { serviceLinks } from './services.js';
import { initRail, operatorOf, OPERATORS, OP_FACTORS, MERGE_MIN_INTEGRATION, EQUITY_STEP } from './operators.js';
import { MEGA, applyMega, TSR_FREIGHT } from './mega.js';

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
    rail: null,         // 철도 운영사 (코레일·KPRail): initRail에서 채운다
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
    m.active = !linkPending(base, state, i) && !state.replaced?.[i];
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
  applyLinePolicy(links, state);
  const stations = base.stations.map((s) => s[1])
    .concat((base.metro_stations || []).map((s) => s[1]), state.newStations);
  const airports = (base.airports || []).map((a) => ({ ...a, cap: state.airportCap?.[a.id] ?? a.cap }))
    .concat((state.newAirports || []).filter((a) => a.built).map((a) => ({ ...a, cap: state.airportCap?.[a.id] ?? a.cap, intl: true })));
  const airRoutes = Object.values(state.air?.routes || {}).map((r) => ({ a: r.a, b: r.b, freq: r.freq }));
  // 운행 계통(특급·급행·보통)은 실제 링크 뒤에 가상 링크로 붙는다
  const physCount = links.length;
  links.push(...serviceLinks(state, links));
  const serviceStops = (state.services || []).filter((s) => s.built).map((s) => ({ stops: s.stops, trains: s.trains }));
  const closed = new Set(state.closedStations || []);
  return { nodes, links, physCount, serviceStops, stations: [...new Set(stations)].filter((n) => !closed.has(n)), airports, airRoutes, airBanned: state.air?.banned || [] };
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

/**
 * 지금 착공할 수 있는지: 올해 분담액이 남은 예산 + 차입 한도 안이어야 한다.
 * 철도 운영사 자체 재원(fund = 'korail' 등)이면 그 회사의 잔액 안이어야 한다 (회사는 빌리지 않는다)
 */
export function canAfford(state, cost, years, fund = 'gov') {
  if (fund !== 'gov') return cost / years <= (railOps(state)[fundOp(state, fund)]?.cash ?? 0);
  const d = DIFFICULTY[state.difficulty];
  return cost / years <= state.budget + (d.borrowLimit - state.debt);
}

// ------------------------------------------------------------ 진행 중 사업 (OSM 공사 중 노선)

/** km당 사업비 어림 (억원): 노선 종류별, 광역급행철도는 대심도라 비싸다 */
const ONGOING_PER_KM = { motorway: 450, trunk: 180, primary: 150, secondary: 100, hsr: 850, conv: 450, metro: 1300, gtx: 1100 };
const ONGOING_TOTAL_YEARS = { 0: 5, 1: 6, 2: 6 };   // 사업 전체 공기 어림 (도로·철도·도시철도)
const ONGOING_UNFUNDED = 0.5;                        // 남은 사업비 중 앞으로 예산에서 내야 하는 몫

/** OSM 이름에 붙은 공사 메모("@2030", "(2029예정)")를 뗀다 */
export function cleanLineName(name) {
  return (name || '').replace(/@\d+/g, '').replace(/\s*\([^)]*(예정|개통|공사|건설)[^)]*\)/g, '').trim();
}

/** 아직 열리지 않은 OSM 공사 중 구간인지 */
export function linkPending(base, state, i) {
  const l = base.links[i];
  if (!l || !(l.open > 0)) return false;
  if (state.osm) return state.osm.auto?.[i] ? l.open > state.year : !state.osm.opened[i];
  return l.open > state.year;
}

/**
 * 게임을 시작할 때 OSM의 공사 중 노선을 같은 이름(이름 없으면 이어진 구간)끼리 묶어 진행 중 사업으로 넣는다.
 * 남은 사업비는 개통 예정 연도까지 남은 해만큼 어림하고, 해마다 예산에서 나간다. 다 지어야 열린다.
 */
export function initOngoing(base, state, labelFor) {
  if (state.osm) return;
  state.osm = { opened: {}, auto: {} };
  const groups = new Map();
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  base.links.forEach((l, i) => {
    if (!(l.open > 0)) return;
    if (l.open <= state.year) { state.osm.opened[i] = true; return; }
    const name = cleanLineName(l.name);
    const key = name ? `${name}|${l.mode}` : `|${l.mode}|${l.cls}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const projects = [];
  for (const [key, ids] of groups) {
    // 이름 없는 구간은 서로 이어진 것끼리만 한 사업으로 본다
    let parts = [ids];
    if (key.startsWith('|')) {
      for (const i of ids) { const l = base.links[i]; for (const n of [l.a, l.b]) if (!parent.has(n)) parent.set(n, n); parent.set(find(l.a), find(l.b)); }
      const comp = new Map();
      for (const i of ids) { const r = find(base.links[i].a); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); }
      parts = [...comp.values()];
    }
    for (const part of parts) {
      const ls = part.map((i) => base.links[i]);
      const km = ls.reduce((s, l) => s + l.len, 0);
      // 이름 없는 짧은 구간(3km 미만)은 사업으로 따로 두지 않고 OSM 개통 예정 연도에 저절로 연다
      if (km < (key.startsWith('|') ? 3 : 0.5)) { for (const i of part) state.osm.auto[i] = true; continue; }
      const l0 = ls[0];
      const open = Math.max(...ls.map((l) => l.open));
      const years = Math.max(1, open - state.year);
      const kind = l0.mode === 2 ? 'metro' : /광역급행/.test(l0.name || '') ? 'gtx' : l0.cls;
      const kp = ls.filter((l) => l.kp).length * 2 > ls.length;
      const full = km * (ONGOING_PER_KM[kind] ?? 300) * (kp ? KP_COST_FACTOR : 1);
      // 남은 공기만큼의 사업비 가운데 절반은 이미 확보된 계속비로 보고, 나머지 절반을 앞으로의 예산에서 낸다
      const share = Math.min(1, years / (ONGOING_TOTAL_YEARS[l0.mode] || 5)) * ONGOING_UNFUNDED;
      const name = cleanLineName(l0.name) || labelFor(l0);
      projects.push({ id: crypto.randomUUID(), kind: 'osm', links: part, cost: Math.round(full * share), years,
        label: `${name} (${km.toFixed(0)}km, 공사 중)`, mode: l0.mode });
    }
  }
  for (const p of projects) startProject(state, p, { quiet: true });
  state.log.unshift(`${state.year}년 진행 중인 사업 ${projects.length}건(OSM 공사 중 노선)을 이어받았습니다. 사업 탭에서 예산 투입 속도를 조절할 수 있습니다.`);
}

/** 사업 속도: 연 투입액을 기본의 pace배로. 빨리 하면 남은 사업비에 할증(초과 근무·동시 시공)이 붙는다 */
export const PACES = [0.5, 0.75, 1, 1.5, 2];
export function setProjectPace(state, id, pace) {
  const p = state.projects.find((x) => x.id === id);
  if (!p || p.status !== 'building') return;
  p.baseAnnual ||= p.annual;
  const old = p.pace || 1;
  const remaining = p.cost - p.paid;
  // 할증은 기본 속도보다 빠른 만큼만 (늦추면 할증을 되돌린다)
  const premium = (x) => 0.1 * Math.max(0, x - 1);
  const base = remaining / (1 + premium(old));
  const newRemaining = Math.round(base * (1 + premium(pace)));
  p.cost = p.paid + newRemaining;
  p.pace = pace;
  p.annual = Math.max(1, Math.round(p.baseAnnual * pace));
  p.doneYear = state.year + Math.max(1, Math.ceil(newRemaining / p.annual));
}

// ------------------------------------------------------------ 철도 운영사 (코레일·KPRail)

function railOps(state) { return initRail(state).ops; }
/** 합병 뒤에는 어느 회사 몫이든 통합 공사가 낸다 */
function fundOp(state, fund) { return state.rail?.merged ? 'merged' : fund; }

/** 철도 사업 재원: 설정이 '운영사 자체 재원'이면 그 링크를 맡는 회사, 아니면 정부 */
export function fundFor(state, links) {
  if (initRail(state).fund !== 'op') return 'gov';
  const list = Array.isArray(links) ? links : [links];
  const rail = list.filter((l) => l && l.mode === 1 && !l.ext);
  if (!rail.length) return 'gov';
  const kp = rail.filter((l) => l.kp).length;
  return operatorOf(state, { mode: 1, kp: kp * 2 > rail.length ? 1 : 0 });
}

/** 운영사 자체 재원 사업: 잔액이 모자라면 모자란 만큼 정부 SOC 예산이 보탠다 (잔액은 0 밑으로 내려가지 않는다) */
function payProject(state, p, amount) {
  if (!p.fund || p.fund === 'gov') { pay(state, amount); return; }
  // 민자사업: 정부는 건설보조금 몫만 낸다
  if (p.fund === 'ppp') { pay(state, amount * (p.govShare ?? 0)); return; }
  const op = fundOp(state, p.fund), o = railOps(state)[op];
  const own = Math.min(amount, Math.max(0, o.cash));
  o.cash -= own;
  if (amount > own) {
    pay(state, amount - own);
    state.log.unshift(`${state.year}년 ${opName(state, op)} 사업비 부족분 SOC 예산 보조: ${formatWon(amount - own)}`);
  }
}

/** 한 해 영업 결산: econ = {운영사: {rev, cost}} (원/년). 적자로 잔액이 0 밑으로 내려가면 정부가 SOC 예산에서 메운다 */
export function settleRail(state, econ) {
  const ops = railOps(state);
  for (const [op, e] of Object.entries(econ)) {
    const o = ops[op];
    if (!o) continue;
    const profit = (e.rev - e.cost) / 1e8;
    o.cash += profit;
    o.hist.push({ year: state.year, rev: e.rev / 1e8, cost: e.cost / 1e8, profit, cash: o.cash });
    if (o.cash < 0) {
      pay(state, -o.cash);
      state.log.unshift(`${state.year}년 ${opName(state, op)} 적자 보전 (SOC 예산): ${formatWon(-o.cash)}`);
      o.hist[o.hist.length - 1].subsidy = -o.cash;
      o.cash = 0;
    }
  }
}

function opName(state, op) { return op === 'merged' && state.rail?.name ? state.rail.name : OPERATORS[op].name; }

/** 배당: 회사 잔액의 일부를 정부 예산으로 */
export function railDividend(state, op, amount) {
  const o = railOps(state)[op];
  const v = Math.max(0, Math.min(o.cash, amount));
  o.cash -= v; state.budget += v;
  state.log.unshift(`${state.year}년 ${opName(state, op)} 배당: 정부 예산으로 ${formatWon(v)}`);
}

/** 출자: 정부 예산을 회사에 넣는다 */
export function railEquity(state, op, amount = EQUITY_STEP) {
  if (!canAfford(state, amount, 1)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  pay(state, amount);
  railOps(state)[op].cash += amount;
  state.log.unshift(`${state.year}년 ${opName(state, op)} 출자: ${formatWon(amount)}`);
  return { ok: true };
}

/** 코레일·KPRail 합병: 잔액을 합치고 모든 철도를 통합 공사가 맡는다 */
export function mergeRail(state, name) {
  const r = initRail(state);
  if (r.merged) return { ok: false, reason: '이미 합병했습니다.' };
  if (state.integration < MERGE_MIN_INTEGRATION) return { ok: false, reason: `남북 통합도가 ${Math.round(MERGE_MIN_INTEGRATION * 100)}% 이상이어야 합병할 수 있습니다.` };
  r.ops.merged = { cash: r.ops.korail.cash + r.ops.kprail.cash, hist: [] };
  r.merged = true;
  r.name = name || OPERATORS.merged.name;
  state.log.unshift(`${state.year}년 코레일·KPRail 합병: ${r.name} 출범 (잔액 ${formatWon(r.ops.merged.cash)})`);
  return { ok: true };
}

export { OP_FACTORS };

// ------------------------------------------------------------ 민자사업 정산

/**
 * 해마다 민자사업을 정산한다. uses: 계약 id → 실제 하루 이용(대·km 또는 인·km), revenueOf(계약, 이용) → 억원/년.
 * BTO: 실제 수입이 최소운영수입보장(MRG) 기준에 못 미치면 정부가 차액을 낸다. BTL: 정부가 임대료를 낸다.
 * 운영 기간이 끝나면 정부로 귀속되어 추가 통행료가 없어진다.
 */
export function settlePPP(state, uses, revenueOf) {
  for (const c of state.ppp || []) {
    const proj = state.projects.find((p) => p.id === c.project);
    if (!proj || proj.status !== 'done' || c.ended) continue;
    c.opStart ||= state.year;
    if (state.year >= c.opStart + c.params.years) {
      c.ended = state.year;
      for (const k of c.newLinkIdx) if (state.newLinks[k]) state.newLinks[k].toll = 0;
      state.log.unshift(`${state.year}년 민자사업 귀속: ${c.name} (운영 기간 ${c.params.years}년 끝, 정부 소유로)`);
      continue;
    }
    const use = uses[c.id] || 0, rev = revenueOf(c, use);
    let mrg = 0, lease = 0;
    // 개통 초기에는 수요가 자리 잡는 중이라 보장 기준을 낮춰 둔다 (1년차 60%, 해마다 +20%p)
    const ramp = Math.min(1, 0.6 + 0.2 * (state.year - c.opStart));
    if (c.params.type === 'bto' && c.params.mrg > 0) mrg = Math.max(0, c.eval.rev1 * c.params.mrg * ramp - rev);
    if (c.params.type === 'btl') lease = c.eval.lease;
    if (mrg + lease > 0) pay(state, mrg + lease);
    c.cum.rev += rev; c.cum.mrg += mrg; c.cum.lease += lease;
    c.hist.push({ year: state.year, use, rev, mrg, lease });
    if (mrg > 0) state.log.unshift(`${state.year}년 ${c.name} 최소운영수입보장 지급: ${formatWon(mrg)} (예측 대비 수요 ${Math.round((use / Math.max(1, c.forecast.useKm)) * 100)}%)`);
  }
}

export function startProject(state, p, { quiet = false } = {}) {
  p.annual = Math.round(p.cost / p.years);
  p.paid = p.annual;
  p.startYear = state.year;
  p.doneYear = state.year + p.years;
  p.status = 'building';
  p.fund ||= 'gov';
  payProject(state, p, p.annual);
  state.projects.push(p);
  const by = p.fund === 'gov' ? '' : p.fund === 'ppp' ? ` · 민자 (정부 보조 ${Math.round((p.govShare || 0) * 100)}%)` : ` · ${opName(state, fundOp(state, p.fund))} 자체 재원`;
  if (!quiet) state.log.unshift(`${state.year}년 착공: ${p.label} (${formatWon(p.cost)}, ${p.years}년${by})`);
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
  const fund = fundFor(state, targets.map((id) => linkAt(base, state, id)));
  if (!canAfford(state, cost, u.years, fund)) return { ok: false, reason: fund === 'gov' ? '예산과 차입 한도가 부족합니다.' : '운영사 잔액이 부족합니다.' };
  const first = linkAt(base, state, targets[0]);
  startProject(state, {
    id: crypto.randomUUID(), kind: 'upgrade', upgrade: u.id, links: targets, cost, years: u.years, fund,
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
  // 선형 점(via)은 곡선 모양만 잡고 노드를 만들지 않는다: 링크는 역·IC(노드) 사이마다 하나
  const stops = plan.points.map((pt, i) => i).filter((i) => !plan.points[i].via || i === 0 || i === plan.points.length - 1);
  const nodeAt = new Map();
  for (const i of stops) {
    const pt = plan.points[i];
    if (pt.node != null) { nodeAt.set(i, pt.node); continue; }
    state.newNodes.push([pt.lon, pt.lat]);
    nodeAt.set(i, base.nodes.length + state.newNodes.length - 1);
  }
  const nodeIds = plan.points.map((_, i) => nodeAt.get(i) ?? null);
  let total = 0, kmTotal = 0;
  const links = [];
  const segs = smoothSegments(plan.points);   // 찍은 점들을 지나는 곡선. 연장도 곡선 길이로 잡는다
  for (let s0 = 0; s0 + 1 < stops.length; s0++) {
    const i0 = stops[s0], i1 = stops[s0 + 1];
    let len = 0, cost = 0, geom = [];
    for (let i = i0; i < i1; i++) {
      const a = plan.points[i], b = plan.points[i + 1];
      const l = polylineKm(segs[i]) * 1.02;
      const kpSeg = isKP(a.lat, a.lon) && isKP(b.lat, b.lon);
      // 외국 땅 위 구간은 상대국이 절반을 부담한다 (main에서 구간별 비율을 넘긴다)
      cost += spec.perKm * l * (kpSeg ? KP_COST_FACTOR : 1) * (plan.segFactor?.[i] ?? 1);
      len += l;
      geom = geom.concat(geom.length ? segs[i].slice(1) : segs[i]);
    }
    const a = plan.points[i0], b = plan.points[i1];
    const kp = isKP(a.lat, a.lon) && isKP(b.lat, b.lon) ? 1 : 0;
    total += Math.round(cost); kmTotal += len;
    links.push({
      id: firstId + links.length, a: nodeIds[i0], b: nodeIds[i1], mode: spec.mode, len: Math.round(len * 100) / 100,
      kp, name: plan.lineName || '', built: false, geom: geom.flat().map((v) => Math.round(v * 1e5) / 1e5), ...spec.attrs,
    });
  }
  total += plan.extraCost || 0;   // 중간 IC·역·휴게소 설치비
  const fund = plan.ppp ? 'ppp' : fundFor(state, links);
  if (plan.ppp) for (const l of links) l.toll = plan.ppp.toll || 0;
  if (!canAfford(state, total * (plan.ppp ? plan.ppp.subsidy : 1), spec.years, plan.ppp ? 'gov' : fund)) {
    state.newNodes.length -= stops.filter((i) => plan.points[i].node == null).length;
    return { ok: false, reason: fund === 'gov' ? '예산과 차입 한도가 부족합니다.' : '운영사 잔액이 부족합니다.' };
  }
  state.newLinks.push(...links);
  plan.points.forEach((pt, i) => {
    const nm = plan.names[i];
    if (nm && nodeIds[i] != null) state.names[nodeIds[i]] = { name: nm.name, kind: nm.kind, auto: nm.auto !== false };
  });
  for (const r of plan.restAreas || []) (state.restAreas ||= []).push({ ...r, built: false, links: links.map((l) => l.id) });
  const endName = (i) => plan.points[i].name || nameOf(state, nodeIds[i]) || '';
  // 기존선 연장은 노선 이름을 이어 쓰고, 신설은 새 노선으로 적는다
  // 끝점 이름이 없으면(이름 없는 도로 노드) 길이만 적는다
  const e0 = endName(0), e1 = endName(nodeIds.length - 1);
  const span = `${e0 && e1 ? `${e0}–${e1} ` : ''}(${kmTotal.toFixed(0)}km)`;
  const label = plan.title ? `${plan.title} ${span}` : plan.extendOf ? `${plan.extendOf} 연장 ${span}` : `${plan.lineName ? `${plan.lineName} · ` : ''}${spec.label} ${span}`;
  startProject(state, {
    id: crypto.randomUUID(), kind: 'new', type: plan.type, links: links.map((l) => l.id), extension: !!plan.extendOf,
    stations: spec.mode >= 1 ? nodeIds.filter((n, i) => n != null && plan.names[i]?.kind === 'station') : [],
    cost: total, years: spec.years, label, fund, plan: plan.plan, govShare: plan.ppp ? plan.ppp.subsidy : undefined,
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
/** 북측 노선 이름을 분단 전·남측 기준 이름으로 (평부선·평의선은 경의선, 강원선은 경원선 등) */
export const KP_LINE_RENAME = { 평부선: '경의선', 평의선: '경의선', 강원선: '경원선', 금강산청년선: '동해선', 황해청년선: '황해선' };
export const LINE_RENAME_COST = 1500;   // 억원 (역·표지판·시간표·전산)

export function renameKPLines(base, state) {
  if (state.linesRenamed) return { ok: false, reason: '이미 바꿨습니다.' };
  if (!canAfford(state, LINE_RENAME_COST, 1)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  pay(state, LINE_RENAME_COST);
  let n = 0;
  base.links.forEach((l, i) => {
    const to = l.mode === 1 && l.kp && KP_LINE_RENAME[l.name];
    if (to) { state.overrides[i] = { ...(state.overrides[i] || {}), name: to }; n++; }
  });
  for (const l of state.newLinks) if (l.kp && KP_LINE_RENAME[l.name]) l.name = KP_LINE_RENAME[l.name];
  for (const s of state.services || []) {
    if (KP_LINE_RENAME[s.line]) s.line = KP_LINE_RENAME[s.line];
    if (s.lines) s.lines = [...new Set(s.lines.map((x) => KP_LINE_RENAME[x] || x))];
  }
  state.linesRenamed = true;
  state.log.unshift(`${state.year}년 북측 노선 이름을 남측 기준으로 바꿨습니다: ${Object.entries(KP_LINE_RENAME).map(([a, b]) => `${a}→${b}`).join(', ')} (${n}개 구간)`);
  return { ok: true };
}

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

// ---- 노선 정리: 폐선과 감편 (영업계수 패널)
export const FREQ_STEPS = [1, 0.75, 0.5];          // 기본 열차 운행 비율
export const FREQ_WAIT_MIN = 20;                    // 운행이 절반이면 노선 전체에서 늘어나는 기다림 (분)
export const REOPEN_PER_KM = 20;                    // 재개통 비용 (억원/km): 선로 점검·신호 복구
export const CLOSE_APPROVAL = 2;                    // 폐선 한 노선당 지지율 감점 (2년)

/** 폐선한 노선은 끊고, 감편한 노선은 수송력을 줄이고 기다림을 노선 길이에 나눠 얹는다 */
function applyLinePolicy(links, state) {
  const closed = state.closedLines || {}, freq = state.lineFreq || {};
  if (!Object.keys(closed).length && !Object.keys(freq).length) return;
  const km = {};
  for (const l of links) if (l.mode >= 1 && l.name && freq[l.name]) km[l.name] = (km[l.name] || 0) + l.len;
  for (const l of links) {
    if (l.mode < 1 || !l.name) continue;
    if (closed[l.name]) l.active = false;
    const f = freq[l.name];
    if (f && f < 1) { l.freq = f; l.freqWait = FREQ_WAIT_MIN * (1 / f - 1) * (l.len / km[l.name]); }
  }
}

export function closeLine(state, name) {
  (state.closedLines ||= {})[name] = state.year;
  delete state.lineFreq?.[name];
  state.log.unshift(`${state.year}년 폐선: ${name}`);
}

export function reopenLine(state, name, km) {
  const cost = Math.round(km * REOPEN_PER_KM);
  if (!canAfford(state, cost, 1)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  pay(state, cost);
  delete state.closedLines[name];
  state.log.unshift(`${state.year}년 재개통: ${name} (${formatWon(cost)})`);
  return { ok: true };
}

export function setLineFreq(state, name, f) {
  if (f >= 1) delete state.lineFreq?.[name];
  else (state.lineFreq ||= {})[name] = f;
  state.log.unshift(`${state.year}년 ${name} 기본 열차 운행 ${Math.round(f * 100)}%로 조정`);
}

/** 국가 대형 사업 착공 (설정 탭) */
export function startMega(state, id) {
  const m = MEGA.find((x) => x.id === id);
  if (!m || !m.ready(state)) return { ok: false, reason: m?.need ? `조건: ${m.need}` : '시작할 수 없습니다.' };
  if (state.projects.some((p) => p.kind === 'mega' && p.mega === id)) return { ok: false, reason: '이미 착공했습니다.' };
  if (!canAfford(state, m.cost, m.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  startProject(state, { id: crypto.randomUUID(), kind: 'mega', mega: id, links: [], cost: m.cost, years: m.years, label: m.label });
  return { ok: true };
}

/** 시베리아 횡단철도: 해마다 대륙 통과 화물 수입을 북측(합병 뒤 통합) 철도 운영사가 얻는다 */
export function settleMega(state) {
  if (!state.mega?.tsr) return;
  const ops = railOps(state);
  const op = state.rail?.merged ? 'merged' : 'kprail';
  if (ops[op]) ops[op].cash += TSR_FREIGHT;
}

/** 해 넘기기 전 처리: 공사 진행·완공, 예산 배정, 이자. 완공 사업 목록을 돌려준다 */
export function advanceBudgetYear(base, state) {
  const d = DIFFICULTY[state.difficulty];
  state.year += 1;
  // 쓰지 않은 예산은 한 해 치까지만 이월하고 나머지는 불용 처리한다 (국고로 돌아간다)
  if (state.budget > d.annualBudget) {
    state.lastLapse = state.budget - d.annualBudget;
    state.log.unshift(`${state.year - 1}년 예산 불용: ${formatWon(state.lastLapse)} (이월은 연 예산 ${formatWon(d.annualBudget)}까지)`);
    state.budget = d.annualBudget;
  } else state.lastLapse = 0;
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
      const amt = Math.min(p.annual, Math.max(0, p.cost - p.paid));
      payProject(state, p, amt);
      p.paid += amt;
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
  for (const p of done) state.log.unshift(`${state.year}년 ${p.kind === 'osm' ? '개통' : '완공'}: ${p.label.replace(', 공사 중', '')}`);
  // 예전 저장 게임(진행 중 사업 없음): OSM 개통 예정 연도에 저절로 연다
  if (!state.osm) {
    const opened = new Set(base.links.filter((l) => l.open === state.year).map((l) => cleanLineName(l.name) || '이름 없는 구간'));
    for (const n of opened) state.log.unshift(`${state.year}년 개통: ${n}`);
  }
  return done;
}

function completeProject(base, state, p) {
  if (p.kind === 'service') {
    const s = (state.services || []).find((x) => x.id === p.service);
    if (s) s.built = true;
    return;
  }
  if (p.kind === 'vehicles') return;
  if (p.kind === 'mega') { applyMega(base, state, p.mega); return; }
  if (p.kind === 'osm') { for (const i of p.links) state.osm.opened[i] = true; return; }   // 계통 차량 추가 구입 (편성 수는 고칠 때 이미 바뀌었다)
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
    // 직선화: 옛 구간은 폐선, 옛 역은 문을 닫는다 (이름은 새 역이 이어받았다)
    for (const id of p.retire || []) {
      if (id < base.links.length) (state.replaced ||= {})[id] = true;
      else state.newLinks[id - base.links.length].replaced = true;
    }
    if (p.stationMap) (state.closedStations ||= []).push(...Object.keys(p.stationMap).map(Number));
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

/**
 * 지지율: 해마다 요인으로 정한 목표치 쪽으로 35%씩 움직인다 (요인은 state.approvalWhy에 남겨 화면에 보인다).
 * - 기본 55
 * - 도로 정체: 시작 연도보다 늘면 깎이고 줄면 오른다 (지금 수준의 정체는 이미 감안된 것으로 본다)
 * - 오래 방치한 민원 (정체가 3년 넘게 이어진 노선)
 * - 최근 2년 완공한 사업 (이어받은 공사 제외), 예산 불용, 부채, 남북 HDI 개선
 */
export function updateApproval(state, requests, summary, prevSummary, congestedKm) {
  const d = DIFFICULTY[state.difficulty];
  const why = [['기본', 55]];
  const cong0 = state.history[0]?.congestedKm || congestedKm || 1;
  if (congestedKm != null) why.push(['도로 정체 (시작 대비)', Math.max(-8, Math.min(12, -(congestedKm / cong0 - 1) * 40))]);
  const old = requests.filter((r) => r.years >= CONGESTION_YEARS + 2).length;
  if (old) why.push([`오래 방치한 민원 ${old}건`, -Math.min(5, old * 0.1)]);
  const built = state.projects.filter((p) => p.status === 'done' && p.kind !== 'osm' && p.doneYear >= state.year - 1).length;
  if (built) why.push([`최근 2년 완공 ${built}건`, Math.min(10, built * 2)]);
  if (state.lastLapse > 0) why.push(['예산 불용', -Math.min(6, (state.lastLapse / d.annualBudget) * 8)]);
  const closedRecent = Object.values(state.closedLines || {}).filter((y) => y >= state.year - 1).length;
  if (closedRecent) why.push([`최근 2년 폐선 ${closedRecent}개 노선`, -Math.min(8, closedRecent * CLOSE_APPROVAL)]);
  if (state.debt > 0) why.push(['부채', -(state.debt / d.borrowLimit) * 8]);
  if (prevSummary) why.push(['남북 HDI 개선', Math.max(-5, Math.min(8, (summary.KP.hdi - prevSummary.KP.hdi) * 300 + (summary.KR.hdi - prevSummary.KR.hdi) * 300))]);
  const target = why.reduce((s0, [, v]) => s0 + v, 0);
  state.approvalWhy = why.map(([k, v]) => [k, Math.round(v * 10) / 10]);
  state.approvalTarget = target;
  state.approval = Math.max(0, Math.min(100, state.approval + (target - state.approval) * 0.35));
}

export { upgradeCost, UPGRADES, NEW_BUILDS };

// 게임 상태: 예산, 공사 중 사업, 혼잡 민원, 이름, 저장/불러오기.
import { DIFFICULTY, UPGRADES, NEW_BUILDS, KP_COST_FACTOR, upgradeCost, resolve, formatWon } from './catalog.js';
import { P } from '../sim/params.js';
import { kmBetween } from '../sim/model.js';

const SAVE_KEY = 'ukt-save-v1';
const START_YEAR = 2026;
export const CONGESTION_VC = 1.0;
export const CONGESTION_YEARS = 2;

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
    names: {},          // 노드 id → {name, kind, auto}
    projects: [],
    congestion: {},     // 링크 id → 연속 혼잡 연수
    dismissed: {},      // 링크 id → 민원 무시한 해
    history: [],
    log: [`${START_YEAR}년, 남북이 통일되었습니다. 첫 해 SOC 예산 ${formatWon(d.annualBudget)}이 배정되었습니다.`],
    snapshot: null,
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
    m.active = true;
    if (building.has(i) && m.mode === 0) m.speed = Math.round(m.speed * 0.85); // 공사 중 감속
    delete m.geom;
    return m;
  });
  for (const nl of state.newLinks) {
    const o = state.overrides[nl.id];
    const m = o ? { ...nl, ...o } : { ...nl };
    m.active = nl.built;
    delete m.geom;
    links.push(m);
  }
  const stations = base.stations.map((s) => s[1])
    .concat((base.metro_stations || []).map((s) => s[1]), state.newStations);
  return { nodes, links, stations: [...new Set(stations)] };
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

function startProject(state, p) {
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
  for (let i = 0; i + 1 < nodeIds.length; i++) {
    const a = plan.points[i], b = plan.points[i + 1];
    const len = kmBetween(a.lon, a.lat, b.lon, b.lat) * 1.1;
    const kp = isKP(a.lat, a.lon) && isKP(b.lat, b.lon) ? 1 : 0;
    const cost = Math.round(spec.perKm * len * (kp ? KP_COST_FACTOR : 1));
    total += cost; kmTotal += len;
    links.push({
      id: firstId + i, a: nodeIds[i], b: nodeIds[i + 1], mode: spec.mode, len: Math.round(len * 100) / 100,
      kp, name: '', built: false, geom: [a.lon, a.lat, b.lon, b.lat], ...spec.attrs,
    });
  }
  if (!canAfford(state, total, spec.years)) {
    state.newNodes.length -= plan.points.filter((p) => p.node == null).length;
    return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  }
  state.newLinks.push(...links);
  plan.points.forEach((pt, i) => {
    const nm = plan.names[i];
    if (nm) state.names[nodeIds[i]] = { name: nm.name, kind: nm.kind, auto: nm.auto !== false };
  });
  const endName = (i) => plan.points[i].name || nameOf(state, nodeIds[i]) || '';
  const label = `${spec.label} ${endName(0)}–${endName(nodeIds.length - 1)} (${kmTotal.toFixed(0)}km)`;
  startProject(state, {
    id: crypto.randomUUID(), kind: 'new', type: plan.type, links: links.map((l) => l.id),
    stations: spec.mode >= 1 ? nodeIds.filter((_, i) => plan.names[i]?.kind === 'station') : [],
    cost: total, years: spec.years, label,
  });
  return { ok: true };
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
  for (const p of done) state.log.unshift(`${state.year}년 완공: ${p.label}`);
  return done;
}

function completeProject(base, state, p) {
  if (p.kind === 'upgrade') {
    const u = UPGRADES.find((x) => x.id === p.upgrade);
    for (const id of p.links) {
      const link = linkAt(base, state, id);
      state.overrides[id] = { ...(state.overrides[id] || {}), ...u.apply(link) };
    }
  } else {
    for (const id of p.links) state.newLinks[id - base.links.length].built = true;
    for (const s of p.stations) if (!state.newStations.includes(s)) state.newStations.push(s);
  }
}

/** 민원 대상: 남은 고속도로·간선국도와 철도, 북은 모든 도로·철도 */
function requestable(l) {
  if (l.mode === 2) return false; // 도시철도는 아직 개량 메뉴가 없다
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
  return [...groups.values()].sort((a, b) => b.km * (b.vc - 1) - a.km * (a.vc - 1));
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

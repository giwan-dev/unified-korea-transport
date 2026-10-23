// 기존 노선 위 한 점에 역·IC를 더하는 사업.
// 역: 철도·도시철도 구간을 그 자리에서 잘라 역을 만든다. 완공되면 역이 되어 주변 읍면동의 역 접근이 좋아진다.
// IC: 고속도로를 잘라 IC를 만들고, 가장 가까운 일반도로 노드까지 연결도로(4차로)를 놓는다.
import { splitLink, startProject, canAfford, isKP, linkAt, fundFor } from './state.js';
import { KP_COST_FACTOR } from './catalog.js';
import { kmBetween } from '../sim/model.js';

export const POINT_ADD = {
  station: {
    1: { label: '일반철도역 신설', cost: 300, years: 2 },
    2: { label: '도시철도역 신설 (지하)', cost: 1000, years: 3 },
  },
  ic: { label: 'IC 신설', cost: 300, years: 2, connectorPerKm: 150, maxKm: 6 },
};

function nodeXY(base, state, n) {
  return n < base.nodes.length ? base.nodes[n] : state.newNodes[n - base.nodes.length];
}

/** 역 신설 사업비·공기 */
export function stationCost(link, lat, lon) {
  const s = POINT_ADD.station[link.mode === 2 ? 2 : 1];
  return { ...s, cost: Math.round(s.cost * (isKP(lat, lon) ? KP_COST_FACTOR : 1)) };
}

export function startStationAdd(base, state, { link, lon, lat, name }) {
  const l = linkAt(base, state, link);
  const c = stationCost(l, lat, lon);
  const fund = fundFor(state, [l]);
  if (!canAfford(state, c.cost, c.years, fund)) return { ok: false, reason: fund === 'gov' ? '예산과 차입 한도가 부족합니다.' : '운영사 잔액이 부족합니다.' };
  const node = splitLink(base, state, link, lon, lat);
  startProject(state, {
    id: crypto.randomUUID(), kind: 'station', links: [], stations: [node], cost: c.cost, years: c.years, fund,
    newNames: { [node]: { name, kind: 'station', auto: false } },
    label: `${l.name || ''} ${name} ${c.label.replace(' 신설', '')} 신설`.trim(),
  });
  return { ok: true, node };
}

/**
 * IC 자리에서 가장 가까운 일반도로 노드 (고속도로만 지나는 노드는 빼고, maxKm 안)
 * @param {object[]} links 모든 링크 (linkAt 적용)
 */
export function nearestLocalRoad(base, state, links, lon, lat) {
  const local = new Set(), mw = new Set();
  links.forEach((l, i) => {
    if (!l || l.mode !== 0 || state.replaced?.[i] || l.replaced || l.ext || l.cls === 'ferry') return;
    (l.cls === 'motorway' ? mw : local).add(l.a);
    (l.cls === 'motorway' ? mw : local).add(l.b);
  });
  let best = null, bd = POINT_ADD.ic.maxKm;
  for (const n of local) {
    const c = nodeXY(base, state, n);
    if (!c) continue;
    const d = kmBetween(lon, lat, c[0], c[1]);
    if (d < bd && d > 0.05) { bd = d; best = n; }
  }
  return best == null ? null : { node: best, km: bd };
}

export function icCost(km, lat, lon) {
  const s = POINT_ADD.ic;
  return { ...s, cost: Math.round((s.cost + s.connectorPerKm * km * 1.2) * (isKP(lat, lon) ? KP_COST_FACTOR : 1)) };
}

export function startICAdd(base, state, { link, lon, lat, road, name }) {
  const l = linkAt(base, state, link);
  const rc = nodeXY(base, state, road);
  const km = kmBetween(lon, lat, rc[0], rc[1]) * 1.2;
  const c = icCost(km / 1.2, lat, lon);
  if (!canAfford(state, c.cost, c.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  const node = splitLink(base, state, link, lon, lat);
  const id = base.links.length + state.newLinks.length;
  const p0 = nodeXY(base, state, node);
  state.newLinks.push({
    id, a: node, b: road, mode: 0, cls: 'primary', lanes: 4, speed: 60, paved: 1, len: Math.max(0.1, Math.round(km * 100) / 100),
    kp: isKP(lat, lon) ? 1 : 0, name: `${name} 연결도로`, built: false,
    geom: [p0[0], p0[1], rc[0], rc[1]].map((v) => Math.round(v * 1e5) / 1e5),
  });
  startProject(state, {
    id: crypto.randomUUID(), kind: 'new', type: 'ic', links: [id], stations: [], cost: c.cost, years: c.years,
    newNames: { [node]: { name, kind: 'IC', auto: false } },
    label: `${l.name || '고속도로'} ${name} 신설 (연결도로 ${km.toFixed(1)}km)`,
  });
  return { ok: true, node };
}

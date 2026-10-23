// 운행 계통: 일본 재래선처럼 같은 선로 위에 특급·급행·보통 열차를 정차역 패턴과 하루 운행 횟수로 짠다.
// 시뮬레이션에서는 정차역 사이를 잇는 가상 철도 링크가 되고, 그 이용객은 밑의 실제 선로 용량을 함께 쓴다.

import { P } from '../sim/params.js';
import { canAfford, startProject } from './state.js';

export const SERVICE_KINDS = {
  limited: { label: '특급', setCost: 300, fareFactor: 1.3 },   // 편성당 차량비 (억원)
  express: { label: '급행', setCost: 200, fareFactor: 1.1 },
  local: { label: '보통', setCost: 150, fareFactor: 1.0 },
};
const SERVICE_DAY_MIN = 1440;   // 하루 운행 시간: 24시간 운행
const TURNAROUND_MIN = 20;      // 종착역 회차

/** 운영비·수입 단가 (게임용 가정값, 원) */
export const OPERATING = {
  trainKmCost: { hsr: 45000, conv: 30000, metro: 25000 },   // 열차 1대가 1km 달리는 데 드는 비용 (인건비·전력·차량 유지)
  trackKmCost: { hsr: 3e8, conv: 1.2e8, metro: 4e8 },        // 선로 1km·1선당 연 유지보수비
  minTrains: { hsr: 40, conv: 16, metro: 200 },               // 이용이 적어도 다니는 하루 열차 수 (양방향)
  paxPerTrain: { hsr: 750, conv: 450, metro: 1000 },
  loadFactor: 0.65,
  fareKm: { hsr: 150, conv: 90, metro: 110 },
};

/** 이름이 같은 철도 구간들에서 가장 긴 경로를 따라 역을 순서대로 늘어놓는다 */
export function lineStations({ links, nodes }, stationSet, name, mode = 1) {
  const adj = new Map();
  links.forEach((l, i) => {
    if (l.name !== name || l.mode !== mode || !l.active || l.via) return;
    for (const [u, v] of [[l.a, l.b], [l.b, l.a]]) {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push([v, l.len, i]);
    }
  });
  if (!adj.size) return [];
  // 두 번의 최장 거리 탐색 (가지가 있으면 가장 긴 줄기를 고른다)
  const far = (src) => {
    const dist = new Map([[src, 0]]), prev = new Map();
    const q = [src];
    while (q.length) {
      const u = q.shift();
      for (const [v, len] of adj.get(u)) {
        if (dist.has(v)) continue;
        dist.set(v, dist.get(u) + len); prev.set(v, u); q.push(v);
      }
    }
    let best = src;
    for (const [v, d] of dist) if (d > dist.get(best)) best = v;
    return { best, prev, dist };
  };
  // OSM에서 이름이 군데군데 끊긴 노선(경부선 등)은 조각마다 줄기를 구해 가까운 끝끼리 잇는다
  const pieces = [];
  const seen = new Set();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const { best: a, dist } = far(start);
    for (const v of dist.keys()) seen.add(v);
    const { best: b, prev, dist: d2 } = far(a);
    const path = [];
    for (let v = b; v !== undefined; v = prev.get(v)) path.push(v);
    pieces.push({ path, km: d2.get(b) });
  }
  pieces.sort((x, y) => y.km - x.km);
  const xy = (n) => nodes[n];
  const gap = (u, v) => Math.hypot((xy(u)[0] - xy(v)[0]) * Math.cos((xy(u)[1] * Math.PI) / 180), xy(u)[1] - xy(v)[1]) * 111;
  let chain = pieces.shift().path;
  for (;;) {
    let best = null;
    for (const [k, p] of pieces.entries()) {
      const h = p.path[0], t = p.path[p.path.length - 1];
      for (const [d, mode] of [[gap(chain[chain.length - 1], h), 'tailHead'], [gap(chain[chain.length - 1], t), 'tailTail'],
        [gap(chain[0], t), 'headTail'], [gap(chain[0], h), 'headHead']]) {
        if (d < 30 && (!best || d < best.d)) best = { d, k, mode };
      }
    }
    if (!best) break;
    const p = pieces.splice(best.k, 1)[0].path;
    if (best.mode === 'tailHead') chain = chain.concat(p);
    else if (best.mode === 'tailTail') chain = chain.concat(p.slice().reverse());
    else if (best.mode === 'headTail') chain = p.concat(chain);
    else chain = p.slice().reverse().concat(chain);
  }
  const out = chain.filter((v) => stationSet.has(v));
  // 노선 이름이 끝에서 바뀌는 경우(경부선 → 부산역의 '경부본선') 2km 안의 종착역을 붙인다
  const inChain = new Set(out);
  const nearestStation = (end) => {
    let best = null, bd = 2;
    for (const st of stationSet) {
      if (inChain.has(st) || !nodes[st]) continue;
      const d = gap(end, st);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  };
  const head = nearestStation(chain[0]), tail = nearestStation(chain[chain.length - 1]);
  if (head != null && (!out.length || gap(chain[0], head) < gap(chain[0], out[0]) + 0.01) && !stationSet.has(chain[0])) out.unshift(head);
  if (tail != null && tail !== head && !stationSet.has(chain[chain.length - 1])) out.push(tail);
  return out.filter((v, k) => out.indexOf(v) === k);
}

/** 철도 최단경로 (주행시간 기준) — 정차역 사이 실제 선로 구간. 제 노선(line)을 따라가고, 다른 노선은 끊긴 곳을 이을 때만 쓴다 */
export function railPath(links, from, to, line, mode = 1) {
  const adj = new Map();
  links.forEach((l, i) => {
    if (l.mode !== mode || !l.active || l.via || l.ext) return;
    const t = (l.len / l.speed) * (line && l.name !== line ? 4 : 1);
    for (const [u, v] of [[l.a, l.b], [l.b, l.a]]) {
      if (!adj.has(u)) adj.set(u, []);
      adj.get(u).push([v, t, i]);
    }
  });
  const dist = new Map([[from, 0]]), prevLink = new Map(), prevNode = new Map();
  const open = [[0, from]];
  while (open.length) {
    let k = 0;
    for (let j = 1; j < open.length; j++) if (open[j][0] < open[k][0]) k = j;
    const [d, u] = open.splice(k, 1)[0];
    if (u === to) break;
    if (d > dist.get(u)) continue;
    for (const [v, t, i] of adj.get(u) || []) {
      const nd = d + t;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prevLink.set(v, i); prevNode.set(v, u); open.push([nd, v]); }
    }
  }
  if (!dist.has(to)) return null;
  const via = [];
  for (let v = to; v !== from; v = prevNode.get(v)) via.push(prevLink.get(v));
  return via.reverse();
}

/**
 * 계통의 구간들: 정차역 사이마다 실제 선로 링크 목록과 지나치는 역 수
 * @returns {{segs:{a,b,via,skip}[], km:number, runMin:number}|null}
 */
export function planService(links, stationSet, stops, kind, line) {
  const segs = [];
  let km = 0, min = 0;
  for (let k = 0; k + 1 < stops.length; k++) {
    const via = railPath(links, stops[k], stops[k + 1], line);
    if (!via) return null;
    let skip = 0, node = stops[k];
    for (const i of via) {
      const l = links[i];
      node = l.a === node ? l.b : l.a;
      if (node !== stops[k + 1] && stationSet.has(node)) skip++;
      km += l.len;
      min += (l.len / l.speed) * 60;
    }
    segs.push({ a: stops[k], b: stops[k + 1], via, skip });
  }
  min = min * P.serviceTimeFactor[kind] + (stops.length - 1) * P.railDwellMin;
  return { segs, km, runMin: min };
}

/** 필요한 편성 수: 하루 운행(양방향 합계)을 왕복 시간으로 나눈 것 + 예비 1편성 */
export function trainsets(trainsPerDay, runMin) {
  const tripsPerSet = SERVICE_DAY_MIN / (runMin + TURNAROUND_MIN);
  return Math.ceil(trainsPerDay / Math.max(tripsPerSet, 0.5)) + 1;
}

export function setCost(kind, cls) {
  return SERVICE_KINDS[kind].setCost * (cls === 'hsr' ? 1.4 : 1);
}

/** 새 계통 편성: 차량을 사서(1년) 운행을 시작한다 */
export function startService(state, svc) {
  const sets = trainsets(svc.trains, svc.runMin);
  const cost = Math.round(sets * setCost(svc.kind, svc.cls));
  if (!canAfford(state, cost, 1)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  const id = `svc${Date.now().toString(36)}`;
  (state.services ||= []).push({ ...svc, id, sets, built: false });
  startProject(state, { id: crypto.randomUUID(), kind: 'service', service: id, links: [], cost, years: 1,
    label: `운행 계통 ${svc.name} (${svc.stops.length}개 역, 하루 ${svc.trains}회, 차량 ${sets}편성)` });
  return { ok: true };
}

/** 운행 중인 계통 고치기: 정차역·이름은 바로, 증편에 모자란 차량은 사들인다 */
export function updateService(state, id, patch) {
  const svc = state.services.find((s) => s.id === id);
  const next = { ...svc, ...patch };
  const need = trainsets(next.trains, next.runMin);
  const extra = Math.max(0, need - svc.sets);
  const cost = Math.round(extra * setCost(next.kind, next.cls));
  if (cost > 0 && !canAfford(state, cost, 1)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  Object.assign(svc, patch, { sets: Math.max(svc.sets, need) });
  if (cost > 0) {
    state.budget -= cost;
    state.log.unshift(`${state.year}년 차량 구입: ${svc.name} ${extra}편성 (${Math.round(cost).toLocaleString()}억원)`);
  }
  return { ok: true, cost };
}

export function removeService(state, id) {
  const svc = state.services.find((s) => s.id === id);
  state.services = state.services.filter((s) => s.id !== id);
  if (svc) state.log.unshift(`${state.year}년 운행 중단: ${svc.name}`);
}

/** 시뮬레이션에 넘길 가상 링크 (정차역 사이). 밑 선로가 하나라도 끊기면 그 구간은 쉰다 */
export function serviceLinks(state, links) {
  const out = [];
  for (const svc of state.services || []) {
    if (!svc.built) continue;
    svc.segs.forEach((s, k) => {
      const under = s.via.map((i) => links[i]);
      out.push({
        a: s.a, b: s.b, mode: 1, cls: svc.cls, via: s.via, skip: s.skip, kind: svc.kind, trains: svc.trains,
        service: svc.id, seg: k, len: under.reduce((sum, l) => sum + (l?.len || 0), 0),
        tracks: 2, power: 'AC', speed: 100, active: under.every((l) => l && l.active),
      });
    });
  }
  return out;
}

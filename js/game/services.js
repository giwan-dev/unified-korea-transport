// 운행 계통: 시티즈: 스카이라인의 철도 노선처럼 정차역, 열차 종류, 편성 수만 정하면 운행 횟수는 저절로 정해진다
// (편성 수 × 하루 24시간 ÷ 편도 시간). 등급(특급·급행·보통)은 정차 패턴과 요금을 나타낸다.
// 시뮬레이션에서는 정차역 사이를 잇는 가상 철도 링크가 되고, 그 이용객은 밑의 실제 선로 용량을 함께 쓴다.

import { P } from '../sim/params.js';
import { canAfford, startProject, fundFor } from './state.js';

export const SERVICE_KINDS = {
  limited: { label: '특급', fareFactor: 1.3 },
  express: { label: '급행', fareFactor: 1.1 },
  local: { label: '보통', fareFactor: 1.0 },
};

/**
 * 열차 종류 (게임용 일반 모델). maxKmh: 최고 속도(선로 속도보다 빠를 수는 없다), cap: 편성 정원,
 * setCost: 편성당 차량비(억원), kmCost: 열차-km당 운행비(원), electric: 전철 구간에서만 다닌다
 */
export const TRAIN_TYPES = {
  hsr: { label: '고속열차 (300km/h급)', maxKmh: 300, cap: 900, setCost: 450, kmCost: 50000, electric: true },
  semi: { label: '준고속 전동차 (250km/h급)', maxKmh: 250, cap: 400, setCost: 250, kmCost: 36000, electric: true },
  intercity: { label: '간선 전동차 (180km/h급)', maxKmh: 180, cap: 420, setCost: 160, kmCost: 30000, electric: true },
  commuter: { label: '광역 통근 전동차 (110km/h급)', maxKmh: 110, cap: 1600, setCost: 120, kmCost: 26000, electric: true },
  diesel: { label: '디젤 객차 (120km/h급, 비전철 가능)', maxKmh: 120, cap: 450, setCost: 100, kmCost: 34000, electric: false },
};

/** 그 선로에 다닐 수 있는 열차 종류인지 (전동차는 비전철 구간을 지날 수 없다) */
export function canRun(typeId, underLinks) {
  const t = TRAIN_TYPES[typeId];
  return !t.electric || underLinks.every((l) => l.power && l.power !== 'none');
}

/** 노선에 맞는 기본 열차 종류 */
export function defaultTrainType(cls, underLinks) {
  if (cls === 'hsr') return 'hsr';
  return canRun('intercity', underLinks) ? 'intercity' : 'diesel';
}
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
export function planService(links, stationSet, stops, kind, line, typeId = 'intercity') {
  const cap = TRAIN_TYPES[typeId]?.maxKmh ?? 999;
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
      min += (l.len / Math.min(l.speed, cap)) * 60;
    }
    segs.push({ a: stops[k], b: stops[k + 1], via, skip });
  }
  min += (stops.length - 1) * P.railDwellMin;
  return { segs, km, runMin: min };
}

/** 편성 수로 하루 운행 횟수(양방향 합계): 편성마다 24시간 동안 편도(+회차 20분)를 되풀이한다 */
export function tripsPerDay(sets, runMin) {
  return Math.max(2, 2 * Math.floor((sets * SERVICE_DAY_MIN) / (2 * (runMin + TURNAROUND_MIN))));
}

export function setCost(typeId) {
  return (TRAIN_TYPES[typeId] || TRAIN_TYPES.intercity).setCost;
}

/** 새 계통 편성: 차량을 사서(1년) 운행을 시작한다 */
export function startService(state, svc) {
  const sets = svc.sets;
  const cost = Math.round(sets * setCost(svc.type));
  const fund = fundFor(state, svc.underLinks || []);
  if (!canAfford(state, cost, 1, fund)) return { ok: false, reason: fund === 'gov' ? '예산과 차입 한도가 부족합니다.' : '운영사 잔액이 부족합니다.' };
  const id = `svc${Date.now().toString(36)}`;
  const { underLinks, ...rec } = svc;
  (state.services ||= []).push({ ...rec, id, sets, fund, trains: tripsPerDay(sets, svc.runMin), built: false });
  startProject(state, { id: crypto.randomUUID(), kind: 'service', service: id, links: [], cost, years: 1, fund,
    label: `운행 계통 ${svc.name} (${TRAIN_TYPES[svc.type].label} ${sets}편성, ${svc.stops.length}개 역)` });
  return { ok: true };
}

/** 새로 사야 하는 차량비: 열차 종류를 바꾸면 편성 전부, 아니면 늘린 편성만 (줄이면 그대로 둔다) */
export function serviceBuyCost(svc, next) {
  if (!svc) return Math.round(next.sets * setCost(next.type));
  if (next.type !== svc.type) return Math.round(next.sets * setCost(next.type));
  return Math.round(Math.max(0, next.sets - svc.sets) * setCost(next.type));
}

/** 운행 중인 계통 고치기: 정차역·이름·편성 수·열차 종류. 모자란 차량은 사들인다 */
export function updateService(state, id, patch) {
  const svc = state.services.find((s) => s.id === id);
  const { underLinks, ...rec } = patch;
  const next = { ...svc, ...rec };
  const cost = serviceBuyCost(svc, next);
  const fund = svc.fund || 'gov';
  if (cost > 0 && !canAfford(state, cost, 1, fund)) return { ok: false, reason: fund === 'gov' ? '예산과 차입 한도가 부족합니다.' : '운영사 잔액이 부족합니다.' };
  Object.assign(svc, rec, { trains: tripsPerDay(next.sets, next.runMin) });
  if (cost > 0) {
    // 차량은 1년 안에 들어온다 (그동안은 지금 차량으로 다닌다)
    startProject(state, { id: crypto.randomUUID(), kind: 'vehicles', service: id, links: [], cost, years: 1, fund,
      label: `차량 구입: ${svc.name} ${TRAIN_TYPES[svc.type].label} (${next.sets}편성)` });
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
        speedCap: TRAIN_TYPES[svc.type]?.maxKmh ?? 999, seatCap: TRAIN_TYPES[svc.type]?.cap,
        service: svc.id, seg: k, len: under.reduce((sum, l) => sum + (l?.len || 0), 0),
        tracks: 2, power: 'AC', speed: 100, active: under.every((l) => l && l.active),
      });
    });
  }
  return out;
}

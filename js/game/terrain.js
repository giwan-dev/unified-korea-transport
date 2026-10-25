// 지형: 새 노선을 그을 때 경사·물을 피하는 선형을 잡고, 터널·교량 비율로 공사비를 늘린다.
// 격자는 pipeline/build_terrain.py가 만든 data/terrain.bin (약 1.1km 칸, 칸 평균 표고와 거칠기, 물·바다).
import { kmBetween } from '../sim/model.js';

let T = null, loading = null;

/** 지형 격자를 받는다 (노선을 그을 때 처음 한 번). 실패하면 null: 지형 없이 직선·곡선 그대로 쓴다 */
export function loadTerrain() {
  loading ||= Promise.all([
    fetch('data/terrain.json').then((r) => (r.ok ? r.json() : null)),
    fetch('data/terrain.bin').then((r) => (r.ok ? r.arrayBuffer() : null)),
  ]).then(([meta, buf]) => {
    if (!meta || !buf) return null;
    const n = meta.rows * meta.cols;
    T = { ...meta, elev: new Int16Array(buf, 0, n), rough: new Uint8Array(buf, n * 2, n) };
    return T;
  }).catch(() => null);
  return loading;
}

export function terrainReady() { return !!T; }

/** 한 점의 지형: {elev 칸 평균 표고(m), rough 칸 안 거칠기(m), water 호수·강, sea 바다}. 지형이 없거나 범위 밖이면 null */
export function terrainAt(lon, lat) {
  if (!T) return null;
  const [c, r] = cellOf(lon, lat);
  if (!inside(c, r)) return null;
  const i = r * T.cols + c, e = T.elev[i];
  return { elev: e, rough: T.rough[i] * 2, water: e === T.water, sea: e === T.sea };
}

/**
 * 수단별 선형 기준. gmax: 이 경사까지는 땅 위로 (넘으면 터널·깎기), tunnel: 터널 1km를 평지 몇 km로 치는지,
 * bridge·sea: 강·호수·바다 위 1km를 몇 km로, rough: 거칠기(m)가 이만큼이면 터널 1km만큼 무겁다
 */
const RULES = {
  hsr: { gmax: 0.025, tunnel: 2.2, bridge: 1.8, sea: 8, rough: 90, simplifyKm: 2.5 },
  conv: { gmax: 0.02, tunnel: 2.8, bridge: 2.0, sea: 9, rough: 70, simplifyKm: 1.5 },
  motorway: { gmax: 0.05, tunnel: 2.6, bridge: 1.9, sea: 9, rough: 80, simplifyKm: 1.5 },
  road: { gmax: 0.08, tunnel: 3.2, bridge: 2.2, sea: 10, rough: 60, simplifyKm: 1 },
};
export function terrainRule(type) {
  // 도시철도·대심도 광역급행철도·해저터널은 땅 밑이라 지형을 보지 않는다
  return { hsr: RULES.hsr, rail: RULES.conv, rail1: RULES.conv, motorway: RULES.motorway, trunk: RULES.road }[type] || null;
}

/** 공사비 배율: 평지만 지나면 평균 단가보다 싸고(0.85), 터널·깎기·교량·바다 위 구간 비율만큼 비싸진다 */
export function terrainCostFactor(p) {
  if (!p || !(p.km > 0)) return 1;
  return 0.85 + 1.3 * (p.tunnelKm / p.km) + 1.0 * (p.bridgeKm / p.km) + 3.5 * (p.seaKm / p.km);
}

const cellOf = (x, y) => [Math.floor((x - T.x0) / T.dx), Math.floor((y - T.y0) / T.dy)];
const inside = (c, r) => c >= 0 && r >= 0 && c < T.cols && r < T.rows;

/** 칸 사이 한 걸음의 가중치(평지 1km = 1): 경사가 기준을 넘는 만큼·거칠수록 터널, 물 위는 교량 */
function stepFactor(rule, i0, i1, km) {
  const e0 = T.elev[i0], e1 = T.elev[i1];
  if (e1 === T.sea) return rule.sea;
  if (e1 === T.water) return rule.bridge;
  if (e0 <= T.water + 1) return 1;
  const grade = Math.abs(e1 - e0) / (km * 1000);
  const steep = Math.max(0, grade - rule.gmax) / rule.gmax;
  const rugged = (T.rough[i1] * 2) / rule.rough;
  return Math.min(rule.tunnel, 1 + (rule.tunnel - 1) * Math.min(1, steep + Math.max(0, rugged - 0.3)));
}

/**
 * 두 점 사이 경사·물을 피하는 선형 (A*, 8방향). 지형이 없거나 너무 멀면 null.
 * @returns {number[][]|null} 양 끝을 뺀 중간 경유점 [[경도, 위도], …] (단순화한 것)
 */
export function terrainRoute(a, b, rule) {
  if (!T || !rule) return null;
  const km = kmBetween(a[0], a[1], b[0], b[1]);
  if (km < 3 || km > 600) return null;
  const [ca, ra] = cellOf(a[0], a[1]), [cb, rb] = cellOf(b[0], b[1]);
  if (!inside(ca, ra) || !inside(cb, rb)) return null;
  // 두 점을 둘러싼 창 (거리의 35%, 최소 15km 여유)
  const margin = Math.max(15, km * 0.35);
  const mc = Math.ceil(margin / (T.dx * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180)));
  const mr = Math.ceil(margin / (T.dy * 111.32));
  const c0 = Math.max(0, Math.min(ca, cb) - mc), c1 = Math.min(T.cols - 1, Math.max(ca, cb) + mc);
  const r0 = Math.max(0, Math.min(ra, rb) - mr), r1 = Math.min(T.rows - 1, Math.max(ra, rb) + mr);
  const W = c1 - c0 + 1, H = r1 - r0 + 1;
  const g = new Float64Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const kx = (r) => T.dx * 111.32 * Math.cos((T.y0 + (r + 0.5) * T.dy) * Math.PI / 180), ky = T.dy * 111.32;
  const h = (c, r) => Math.hypot((c - cb) * kx(r), (r - rb) * ky);
  const heap = [];
  const push = (f, k) => {
    heap.push([f, k]);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, rr = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const start = (ra - r0) * W + (ca - c0), goal = (rb - r0) * W + (cb - c0);
  g[start] = 0;
  push(h(ca, ra), start);
  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === goal) break;
    const lr = Math.floor(k / W), lc = k % W, r = lr + r0, c = lc + c0;
    const i0 = r * T.cols + c;
    for (const [dc, dr] of D8) {
      const nc = lc + dc, nr = lr + dr;
      if (nc < 0 || nr < 0 || nc >= W || nr >= H) continue;
      const nk = nr * W + nc;
      if (closed[nk]) continue;
      const i1 = (nr + r0) * T.cols + (nc + c0);
      const step = Math.hypot(dc * kx(r), dr * ky);
      const ng = g[k] + step * stepFactor(rule, i0, i1, step);
      if (ng < g[nk]) { g[nk] = ng; prev[nk] = k; push(ng + h(nc + c0, nr + r0), nk); }
    }
  }
  if (prev[goal] < 0) return null;
  const cells = [];
  for (let k = goal; k >= 0; k = prev[k]) cells.push(k);
  cells.reverse();
  const pts = cells.map((k) => [T.x0 + ((k % W) + c0 + 0.5) * T.dx, T.y0 + (Math.floor(k / W) + r0 + 0.5) * T.dy]);
  pts[0] = a; pts[pts.length - 1] = b;
  return simplify(pts, rule.simplifyKm).slice(1, -1);
}

/** Douglas–Peucker (km 기준) */
function simplify(pts, tolKm) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const cos = Math.cos(((ay + by) / 2) * Math.PI / 180);
    const ux = (bx - ax) * cos, uy = by - ay, ul = Math.hypot(ux, uy) || 1e-9;
    let best = -1, bd = 0;
    for (let k = i + 1; k < j; k++) {
      const px = (pts[k][0] - ax) * cos, py = pts[k][1] - ay;
      const d = Math.abs(px * uy - py * ux) / ul * 111.32;
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0 && bd > tolKm) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * 선을 따라 지형을 재서 터널·교량 길이를 어림한다 (약 300m 간격).
 * @param {number[][]} line [[경도, 위도], …]
 * @returns {{km:number, tunnelKm:number, bridgeKm:number, seaKm:number}}
 */
export function terrainProfile(line, rule) {
  const out = { km: 0, tunnelKm: 0, bridgeKm: 0, seaKm: 0 };
  if (!T || !rule || line.length < 2) return out;
  let prevIdx = -1;
  for (let k = 0; k + 1 < line.length; k++) {
    const [x0, y0] = line[k], [x1, y1] = line[k + 1];
    const km = kmBetween(x0, y0, x1, y1);
    const n = Math.max(1, Math.ceil(km / 0.3));
    for (let s = 0; s < n; s++) {
      const t = (s + 0.5) / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const [c, r] = cellOf(x, y);
      const step = km / n;
      out.km += step;
      if (!inside(c, r)) continue;
      const i = r * T.cols + c;
      const e = T.elev[i];
      if (e === T.sea) out.seaKm += step;
      else if (e === T.water) out.bridgeKm += step;
      else if (prevIdx >= 0 && T.elev[prevIdx] > T.water + 1) {
        // 칸 평균 표고 차이로 경사, 칸 안 거칠기로 산지 → 둘 중 큰 쪽을 터널·깎기 비율로
        const dist = Math.max(0.3, kmBetween(x, y, T.x0 + (prevIdx % T.cols + 0.5) * T.dx, T.y0 + (Math.floor(prevIdx / T.cols) + 0.5) * T.dy));
        const grade = Math.abs(e - T.elev[prevIdx]) / (dist * 1000);
        const steep = Math.min(1, Math.max(0, grade - rule.gmax) / rule.gmax);
        const rugged = Math.min(1, Math.max(0, (T.rough[i] * 2) / rule.rough - 0.3));
        out.tunnelKm += step * Math.max(steep, rugged);
      }
      if (i !== prevIdx) prevIdx = i;
    }
  }
  return out;
}

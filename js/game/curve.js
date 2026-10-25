// 새 노선을 지도에서 찍은 점들을 지나는 부드러운 곡선으로 만든다 (구심 Catmull-Rom 스플라인).
import { kmBetween } from '../sim/model.js';

/**
 * 양 끝 점에 tan(경위도 단위 방향, 새 노선이 그 점에서 떠나는 방향)이 있으면 그 구간은 그 방향으로 출발·도착하는
 * 3차 베지어로 그린다: 기존 고속도로·철도에 접선 방향으로 붙게 (직각으로 꺾여 들어오지 않게)
 * @param {{lon:number, lat:number, tan?:number[]}[]} pts 제어점 (곡선이 모두 지난다)
 * @param {number} [stepKm] 곡선을 나누는 간격
 * @returns {number[][][]} 제어점 사이 구간마다 [[경도, 위도], ...]
 */
export function smoothSegments(pts, stepKm = 1) {
  const P = pts.map((p) => [p.lon, p.lat]);
  const out = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const p0 = P[i - 1] || reflect(P[i + 1], P[i]);
    const p1 = P[i], p2 = P[i + 1];
    const p3 = P[i + 2] || reflect(P[i], P[i + 1]);
    const km = kmBetween(p1[0], p1[1], p2[0], p2[1]);
    const n = Math.max(2, Math.ceil(km / stepKm));
    const seg = [];
    const t1 = i === 0 && pts[0].tan, t2 = i + 2 === P.length && pts[i + 1].tan;
    if (t1 || t2) {
      // 접선 끝은 먼저 그 방향으로 곧게(구간의 25%, 최대 2km) 나간 뒤 굽는다: 기존 선로와 같은 방향으로 붙어 나가고 들어온다
      const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const S = Math.min(chord * 0.25, 2 / 111);
      const unit = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
      const q1 = t1 ? [p1[0] + t1[0] * S, p1[1] + t1[1] * S] : p1;
      const q2 = t2 ? [p2[0] + t2[0] * S, p2[1] + t2[1] * S] : p2;
      const L = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]) / 2.5;
      const d1 = t1 || unit(p0, p2), d2 = t2 ? [-t2[0], -t2[1]] : unit(p1, p3);
      const c1 = [q1[0] + d1[0] * L, q1[1] + d1[1] * L], c2 = [q2[0] - d2[0] * L, q2[1] - d2[1] * L];
      const mk = Math.max(1, Math.round(n * 0.2));
      if (t1) for (let k = 0; k < mk; k++) seg.push([p1[0] + (q1[0] - p1[0]) * (k / mk), p1[1] + (q1[1] - p1[1]) * (k / mk)]);
      for (let k = 0; k <= n; k++) seg.push(bezier(q1, c1, c2, q2, k / n));
      if (t2) for (let k = mk - 1; k >= 0; k--) seg.push([p2[0] + (q2[0] - p2[0]) * (k / mk), p2[1] + (q2[1] - p2[1]) * (k / mk)]);
    } else for (let k = 0; k <= n; k++) seg.push(catmullRom(p0, p1, p2, p3, k / n));
    seg[0] = p1; seg[seg.length - 1] = p2;
    out.push(seg);
  }
  return out;
}

/**
 * 꺾인 선을 모든 점을 지나는 부드러운 곡선으로 (구심 Catmull-Rom). 화면에 그릴 때만 쓴다.
 * @param {number[][]} pts [[경도, 위도], ...] (양 끝은 노드)
 * @param {number[]|null} before 앞 노드 너머 점 (이어지는 구간의 점: 노드에서 꺾이지 않고 이어지게). 없으면 반사점
 * @param {number[]|null} after 뒤 노드 너머 점
 * @param {number} stepKm 곡선을 나누는 간격
 */
export function splineLine(pts, before = null, after = null, stepKm = 0.12) {
  if (pts.length < 2 || (pts.length === 2 && !before && !after)) return pts;
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    const p0 = i ? pts[i - 1] : before || reflect(p2, p1);
    const p3 = pts[i + 2] || after || reflect(p1, p2);
    const km = kmBetween(p1[0], p1[1], p2[0], p2[1]);
    const n = Math.min(12, Math.max(1, Math.ceil(km / stepKm)));
    for (let k = 1; k < n; k++) out.push(catmullRom(p0, p1, p2, p3, k / n));
    out.push(p2);
  }
  return out;
}

export function polylineKm(line) {
  let d = 0;
  for (let i = 0; i + 1 < line.length; i++) d += kmBetween(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
  return d;
}

function reflect(a, b) {
  return [2 * b[0] - a[0], 2 * b[1] - a[1]];
}

// 구심(alpha=0.5) Catmull-Rom: 점 간격이 고르지 않아도 꼬이지 않는다
function catmullRom(p0, p1, p2, p3, t) {
  const tj = (ti, a, b) => ti + Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1e-9;
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => [
    ((tb - u) * a[0] + (u - ta) * b[0]) / (tb - ta),
    ((tb - u) * a[1] + (u - ta) * b[1]) / (tb - ta),
  ];
  const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function bezier(a, b, c, d, t) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k]);
}

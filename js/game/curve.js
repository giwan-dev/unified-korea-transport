// 새 노선을 지도에서 찍은 점들을 지나는 부드러운 곡선으로 만든다 (구심 Catmull-Rom 스플라인).
import { kmBetween } from '../sim/model.js';

/**
 * @param {{lon:number, lat:number}[]} pts 제어점 (곡선이 모두 지난다)
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
    for (let k = 0; k <= n; k++) seg.push(catmullRom(p0, p1, p2, p3, k / n));
    seg[0] = p1; seg[n] = p2;
    out.push(seg);
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

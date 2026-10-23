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
      const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3;
      const unit = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
      const d1 = t1 || unit(p0, p2), d2 = t2 ? [-t2[0], -t2[1]] : unit(p1, p3);
      const c1 = [p1[0] + d1[0] * L, p1[1] + d1[1] * L], c2 = [p2[0] - d2[0] * L, p2[1] - d2[1] * L];
      for (let k = 0; k <= n; k++) seg.push(bezier(p1, c1, c2, p2, k / n));
    } else for (let k = 0; k <= n; k++) seg.push(catmullRom(p0, p1, p2, p3, k / n));
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

function bezier(a, b, c, d, t) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k]);
}

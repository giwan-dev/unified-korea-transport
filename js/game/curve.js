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
    // 끝점에 방향(tan: 기존 선로 접선)이 정해져 있으면 그 구간은 그 방향으로 나가고 들어오는 3차 곡선
    const t1 = i === 0 && pts[i].tan, t2 = i + 2 === P.length && pts[i + 1].tan;
    if (t1 || t2) {
      const [m1, m2] = hermiteTangents(P, i, t1, t2);
      for (let k = 0; k <= n; k++) seg.push(hermite(p1, p2, m1, m2, k / n));
    } else {
      for (let k = 0; k <= n; k++) seg.push(catmullRom(p0, p1, p2, p3, k / n));
    }
    seg[0] = p1; seg[n] = p2;
    out.push(seg);
  }
  return out;
}

// 경도를 위도 방향과 같은 축척으로 (방향 계산용)
const kx = (lat) => Math.cos((lat * Math.PI) / 180);

/** 구간 i의 양 끝 접선 (경위도 차, 길이는 구간 길이). tan은 [동, 북] 단위 벡터 */
function hermiteTangents(P, i, t1, t2) {
  const p1 = P[i], p2 = P[i + 1], c = kx((p1[1] + p2[1]) / 2);
  const chord = [(p2[0] - p1[0]) * c, p2[1] - p1[1]];
  const d = Math.hypot(chord[0], chord[1]) || 1e-9;
  const unit = (v) => { const n = Math.hypot(v[0], v[1]) || 1e-9; return [v[0] / n, v[1] / n]; };
  const ch = unit(chord);
  const inner = (k) => unit([(P[k + 1][0] - P[k - 1][0]) * c, P[k + 1][1] - P[k - 1][1]]);
  // 접선이 없는 끝: 안쪽 점이면 이웃 두 점 방향, 노선 끝이면 반대편 접선을 현(chord)에 대해 뒤집은 방향
  let a = t1 || (i > 0 ? inner(i) : null);
  let b = t2 || (i + 2 < P.length ? inner(i + 1) : null);
  if (!a) a = unit([2 * ch[0] * (ch[0] * b[0] + ch[1] * b[1]) - b[0], 2 * ch[1] * (ch[0] * b[0] + ch[1] * b[1]) - b[1]]);
  if (!b) b = unit([2 * ch[0] * (ch[0] * a[0] + ch[1] * a[1]) - a[0], 2 * ch[1] * (ch[0] * a[0] + ch[1] * a[1]) - a[1]]);
  return [[(a[0] * d) / c, a[1] * d], [(b[0] * d) / c, b[1] * d]];
}

function hermite(p1, p2, m1, m2, t) {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return [h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0], h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1]];
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

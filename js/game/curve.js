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
      seg.push(...tangentCurve(p1, p2, t1, t2, {
        lead1: i === 0 ? pts[0].lead : null, lead2: i + 2 === P.length ? pts[i + 1].lead : null, p0, p3, n,
      }));
    } else for (let k = 0; k <= n; k++) seg.push(catmullRom(p0, p1, p2, p3, k / n));
    seg[0] = p1; seg[seg.length - 1] = p2;
    out.push(seg);
  }
  return out;
}

/**
 * 접선 끝이 있는 한 구간. 접선 끝은 먼저 그 방향으로 곧게(구간의 25%, 최대 2km) 나간 뒤 굽는다:
 * 기존 선로와 같은 방향으로 붙어 나가고 들어온다. lead1·lead2(끝에서 기존 선로를 따라간 점들, 끝 점부터)가 있으면
 * 그 선로를 따라 나란히 가다가 lead의 마지막 점에서 갈라진다 (평면교차를 피하려고 분기 자리를 옮긴 것)
 * @returns {number[][]} p1에서 p2까지의 점들
 */
export function tangentCurve(p1, p2, t1, t2, { lead1 = null, lead2 = null, p0 = null, p3 = null, n = 24 } = {}) {
  const a = lead1?.length ? lead1[lead1.length - 1] : p1, b = lead2?.length ? lead2[lead2.length - 1] : p2;
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // 접선이 반대 끝 쪽과 어긋날수록 곧게 나가는 거리를 줄인다 (어긋난 채 멀리 곧게 나가면 크게 돌아 S자가 된다)
  const along = (t, from, to) => { if (!t) return 1; const v = [to[0] - from[0], to[1] - from[1]], l = Math.hypot(...v) || 1; return Math.max(0, (t[0] * v[0] + t[1] * v[1]) / l); };
  const S0 = Math.min(chord * 0.25, 2 / 111);
  const S1 = S0 * along(t1, a, b) ** 2, S2 = S0 * along(t2, b, a) ** 2;
  const unit = (u, v) => { const d = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1; return [(v[0] - u[0]) / d, (v[1] - u[1]) / d]; };
  const q1 = t1 ? [a[0] + t1[0] * S1, a[1] + t1[1] * S1] : a;
  const q2 = t2 ? [b[0] + t2[0] * S2, b[1] + t2[1] * S2] : b;
  const L = Math.hypot(q2[0] - q1[0], q2[1] - q1[1]) / 2.5;
  const d1 = t1 || unit(p0 || reflect(p2, p1), p2), d2 = t2 ? [-t2[0], -t2[1]] : unit(p1, p3 || reflect(p1, p2));
  const c1 = [q1[0] + d1[0] * L, q1[1] + d1[1] * L], c2 = [q2[0] - d2[0] * L, q2[1] - d2[1] * L];
  const mk = Math.max(1, Math.round(n * 0.2));
  const seg = [];
  if (lead1?.length) seg.push(...lead1.slice(0, -1));
  if (t1) for (let k = 0; k < mk; k++) seg.push([a[0] + (q1[0] - a[0]) * (k / mk), a[1] + (q1[1] - a[1]) * (k / mk)]);
  for (let k = 0; k <= n; k++) seg.push(bezier(q1, c1, c2, q2, k / n));
  if (t2) for (let k = mk - 1; k >= 0; k--) seg.push([b[0] + (q2[0] - b[0]) * (k / mk), b[1] + (q2[1] - b[1]) * (k / mk)]);
  if (lead2?.length) seg.push(...lead2.slice(0, -1).reverse());
  seg[0] = p1; seg[seg.length - 1] = p2;
  return seg;
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

/**
 * 지형 따라 잡은 꺾인 선형을 곡선반경 rMinKm 아래로 꺾이지 않는 원곡선 선형으로 바꾼다.
 * 1) 펴기: 꼭짓점마다 넣을 수 있는 가장 큰 원곡선 반경(옆 변의 절반까지 쓰는 원) = (짧은 변/2) / tan(꺾인 각/2)을 어림해,
 *    모자라면 그 점을 양 옆 점의 가운데 쪽으로 당긴다. 고정점(kind 1·2)은 움직이지 않고, 모자라면 옆 점을 고정점을 지나는 직선 쪽으로 당긴다.
 * 2) 원곡선: 역·IC(kind 2)가 아닌 꼭짓점은 그 반경의 원호 점들로 바꾼다. 곡선이 꼭짓점을 지나며 꺾이면(Catmull-Rom은 점에서 곡률이 몰린다)
 *    반경이 커도 급해 보이므로, 꼭짓점을 지나지 않고 원호로 돌아 나가게 한다. 접선 이끎 점(kind 1)도 원호로: 접선 위에서 갈라진다
 * ok(lon, lat)가 false인 자리(바다)로는 옮기지 않는다
 * @param {{lon:number, lat:number}[]} pts 선형 점
 * @param {number[]} kind 점마다 0 움직일 수 있음 · 1 움직이지 않지만 원호로 바꿀 수 있음 · 2 그대로 (역·IC)
 * @param {(p:{lon:number, lat:number}) => object} mk 원호 점 객체를 만드는 함수
 * @returns {{lon:number, lat:number}[]}
 */
export function easeCurves(pts, kind, rMinKm, mk, ok = null) {
  if (pts.length < 3 || !(rMinKm > 0)) return pts;
  const ck = Math.cos((pts.reduce((s, p) => s + p.lat, 0) / pts.length) * Math.PI / 180);
  let P = pts.map((p) => [p.lon * ck * 111.32, p.lat * 111.32]);   // km 평면
  const back = (q) => [q[0] / (ck * 111.32), q[1] / 111.32];
  // 변 i→i+1에서 꼭짓점 i가 쓸 수 있는 몫: 양 끝 모두 원호면 절반, 상대가 끝 역이면 거의 다
  const share = (i, j) => (kind[j] === 2 && (j === 0 || j === P.length - 1) ? 0.9 : 0.5);
  const turn = (i) => {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const s1 = Math.hypot(b[0] - a[0], b[1] - a[1]), s2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (s1 < 1e-6 || s2 < 1e-6) return { R: 0, th: Math.PI, s1, s2, t: 0 };
    const cos = ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) / (s1 * s2);
    const th = Math.acos(Math.max(-1, Math.min(1, cos)));
    const t = Math.min(s1 * share(i, i - 1), s2 * share(i, i + 1));
    return { R: th < 1e-4 ? Infinity : t / Math.tan(th / 2), th, s1, s2, t };
  };
  const move = (j, to, w) => {
    const q = [P[j][0] + (to[0] - P[j][0]) * w, P[j][1] + (to[1] - P[j][1]) * w];
    if (ok) { const [lon, lat] = back(q); if (!ok(lon, lat)) return; }
    P[j] = q;
  };
  for (let it = 0; it < 200; it++) {
    let bad = 0;
    for (let i = 1; i + 1 < P.length; i++) {
      const { R, s1, s2 } = turn(i);
      if (R >= rMinKm) continue;
      bad++;
      if (!kind[i]) { move(i, [(P[i - 1][0] + P[i + 1][0]) / 2, (P[i - 1][1] + P[i + 1][1]) / 2], 0.3); continue; }
      const a = P[i - 1], b = P[i], c = P[i + 1];
      if (!kind[i + 1]) move(i + 1, [b[0] + (b[0] - a[0]) / s1 * s2, b[1] + (b[1] - a[1]) / s1 * s2], 0.25);
      if (!kind[i - 1]) move(i - 1, [b[0] + (b[0] - c[0]) / s2 * s1, b[1] + (b[1] - c[1]) / s2 * s1], 0.25);
    }
    if (!bad) break;
  }
  // 거의 곧은(1.5° 아래) 움직일 수 있는 점은 뺀다
  for (let i = 1; i + 1 < P.length; i++) {
    if (!kind[i] && turn(i).th < 0.026) { P.splice(i, 1); kind = kind.filter((_, k) => k !== i); pts = pts.filter((_, k) => k !== i); i--; }
  }
  const out = [pts[0]];
  for (let i = 1; i + 1 < P.length; i++) {
    const { th, t, s1, s2 } = turn(i);
    if (kind[i] === 2 || th < 0.026 || !(t > 0)) {
      if (kind[i] || th >= 0.026) { if (!kind[i]) { const [lon, lat] = back(P[i]); pts[i].lon = lon; pts[i].lat = lat; } out.push(pts[i]); }
      continue;
    }
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const u1 = [(b[0] - a[0]) / s1, (b[1] - a[1]) / s1], u2 = [(c[0] - b[0]) / s2, (c[1] - b[1]) / s2];
    const R = t / Math.tan(th / 2), side = Math.sign(u1[0] * u2[1] - u1[1] * u2[0]) || 1;
    const T1 = [b[0] - u1[0] * t, b[1] - u1[1] * t];
    const C = [T1[0] - u1[1] * side * R, T1[1] + u1[0] * side * R];
    const m = Math.max(2, Math.ceil(th / 0.14));   // 약 8°마다
    for (let k = 0; k <= m; k++) {
      const ang = side * th * (k / m), v = [T1[0] - C[0], T1[1] - C[1]];
      const q = [C[0] + v[0] * Math.cos(ang) - v[1] * Math.sin(ang), C[1] + v[0] * Math.sin(ang) + v[1] * Math.cos(ang)];
      const [lon, lat] = back(q);
      out.push(mk({ lon, lat }));
    }
  }
  out.push(pts[pts.length - 1]);
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

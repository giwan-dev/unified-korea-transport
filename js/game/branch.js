// 기존 선로에서 갈라지는 새 철도의 접선: 첫 구간이 기존 선로 방향으로 자연스럽게 분기하고,
// 마지막 구간도 기존 선로 방향으로 들어오게 한다 (곡선은 curve.js가 점의 tan으로 그린다).
import { kmBetween } from '../sim/model.js';

// 노드에서 선로를 따라 이만큼 간 점으로 방향을 잡는다. 길게 잡으면 역 바로 앞에서 꺾이는 선로(개풍: 려현에서 남쪽으로 오다 역 앞 0.5km에서
// 동쪽으로 꺾여 들어온다)의 방향이 그 너머 쪽으로 틀어져, 직선화·분기 접선이 엉뚱한 쪽을 향한다
const LOOK_KM = 0.5;
const MAX_TURN_DEG = 75;   // 기존 선로와 새 노선 방향이 이보다 크게 꺾이면 접선을 쓰지 않는다

/** 링크 도형을 노드 쪽에서 시작하는 점 목록으로 */
function pointsFrom(link, nodeXY) {
  const g = link.geom || [];
  const pts = [];
  for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) pts.push([g[k], g[k + 1]]);
  if (pts.length < 2) return null;
  const d0 = (pts[0][0] - nodeXY[0]) ** 2 + (pts[0][1] - nodeXY[1]) ** 2;
  const d1 = (pts[pts.length - 1][0] - nodeXY[0]) ** 2 + (pts[pts.length - 1][1] - nodeXY[1]) ** 2;
  return d1 < d0 ? pts.reverse() : pts;
}

/** 점 목록을 따라 LOOK_KM 간 곳 쪽 단위 방향 [동, 북] */
function headingAlong(pts, from = pts[0]) {
  let acc = 0, q = pts[pts.length - 1];
  for (let k = 1; k < pts.length; k++) {
    const d = kmBetween(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    if (acc + d >= LOOK_KM) {
      // 정확히 LOOK_KM 되는 곳 (긴 꼭짓점 간격 탓에 멀리 튀지 않게)
      const t = d > 0 ? (LOOK_KM - acc) / d : 0;
      q = [pts[k - 1][0] + t * (pts[k][0] - pts[k - 1][0]), pts[k - 1][1] + t * (pts[k][1] - pts[k - 1][1])];
      break;
    }
    acc += d;
  }
  const c = Math.cos((from[1] * Math.PI) / 180);
  const v = [(q[0] - from[0]) * c, q[1] - from[1]];
  const n = Math.hypot(v[0], v[1]);
  return n > 0 ? [v[0] / n, v[1] / n] : null;
}

/**
 * 노드(또는 링크 위 한 점)에서 기존 선로가 뻗는 방향들 (노드에서 바깥쪽).
 * @param {object[]} links 모든 링크 (linkAt 적용)
 * @param {{node?:number, split?:number, lon:number, lat:number}} pt
 * @param {(l:object)=>boolean} ok 방향을 따를 선로인지
 */
export function trackHeadings(links, nodeXY, pt, ok) {
  const out = [];
  if (pt.split != null) {
    const l = links[pt.split];
    if (!l || !ok(l)) return out;
    const pts = pointsFrom(l, nodeXY(l.a));
    if (!pts) return out;
    // 누른 곳에서 가장 가까운 꼭짓점에서 앞뒤 방향
    let bk = 0, bd = Infinity;
    pts.forEach((q, k) => { const d = (q[0] - pt.lon) ** 2 + (q[1] - pt.lat) ** 2; if (d < bd) { bd = d; bk = k; } });
    const here = [pt.lon, pt.lat];
    const fwd = headingAlong([here, ...pts.slice(bk + 1)], here), back = headingAlong([here, ...pts.slice(0, bk + 1).reverse()], here);
    if (fwd) out.push(fwd);
    if (back) out.push(back);
    return out;
  }
  if (pt.node == null) return out;
  for (const l of links) {
    if (!l || (l.a !== pt.node && l.b !== pt.node) || !ok(l)) continue;
    const pts = pointsFrom(l, nodeXY(pt.node));
    const h = pts && headingAlong(pts);
    if (h) out.push(h);
  }
  return out;
}

/**
 * 새 노선이 dir(단위 [동, 북]) 쪽으로 나갈 때 따를 기존 선로 접선.
 * 기존 선로 방향과 그 반대(직통 방향) 가운데 dir과 가장 가까운 것, 너무 꺾이면 null
 */
export function branchTangent(headings, dir) {
  let best = null, bd = Math.cos((MAX_TURN_DEG * Math.PI) / 180);
  for (const h of headings) {
    for (const v of [h, [-h[0], -h[1]]]) {
      const dot = v[0] * dir[0] + v[1] * dir[1];
      if (dot > bd) { bd = dot; best = v; }
    }
  }
  return best;
}

/** 두 경위도 점 사이 단위 방향 [동, 북] */
export function unitDir(a, b) {
  const c = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const v = [(b[0] - a[0]) * c, b[1] - a[1]];
  const n = Math.hypot(v[0], v[1]) || 1e-9;
  return [v[0] / n, v[1] / n];
}

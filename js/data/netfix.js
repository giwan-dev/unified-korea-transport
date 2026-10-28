// 불러온 네트워크의 노드 자리 바로잡기 (네트워크를 다시 만들지 않고 게임이 불러올 때).
// 1) 고속도로 본선이 엉뚱한 노드를 지나며 꺾이는 곳(dogleg): data/node_fix.json(pipeline/build_node_fix.py)의 자리로 옮긴다
//    (예: 경부고속도로가 금토분기점에서 용인서울고속도로 쪽 분기점 노드를 지나 서쪽으로 꺾이던 것)
// 2) 두 노선이 한 역에서 엇갈리는데 역 노드가 한 노선 승강장 자리에 있어 다른 노선이 그 자리로 갈고리처럼 꺾여 들어가는 곳
//    (GTX-A 성남, 신분당선 판교): 두 노선의 곧은 줄기가 실제로 엇갈리는 자리로 역 노드를 옮긴다
// 3) 한 노선이 지나는 역에서 역 노드가 옆으로 비켜 있어 노선이 갈고리처럼 꺾여 들어갔다 나오는 곳 (서해선 부천종합운동장·동작·공덕 등
//    환승역 19곳): 역 노드를 노선의 곧은 줄기 위로 옮긴다

const km = (a, b) => Math.hypot((a[0] - b[0]) * 88.6, (a[1] - b[1]) * 111);

/** 구간 도형을 노드 쪽부터 [[x, y], ...]로 (NaN으로 나뉜 여러 조각이면 null) */
function ptsFrom(link, node) {
  const g = link.geom || [];
  if (g.some((v) => Number.isNaN(v))) return null;
  const pts = [];
  for (let k = 0; k + 1 < g.length; k += 2) pts.push([g[k], g[k + 1]]);
  if (pts.length < 2) return null;
  return km(pts[0], node) <= km(pts[pts.length - 1], node) ? pts : pts.reverse();
}

/** 노드에서 도형을 따라 dist km 간 자리 */
function pointAway(pts, dist) {
  let acc = 0;
  for (let k = 1; k < pts.length; k++) {
    const d = km(pts[k - 1], pts[k]);
    if (acc + d >= dist) { const t = (dist - acc) / (d || 1); return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t]; }
    acc += d;
  }
  return pts[pts.length - 1];
}

/** 노드를 p로 옮기고 그 노드에 닿는 구간 끝을 맞춘다. trim km 안의 꺾임 점은 지운다 (only가 있으면 그 구간들만) */
function moveNode(base, n, p, trim, only = null) {
  const old = base.nodes[n];
  base.nodes[n] = p;
  for (const l of base.links) {
    if (l.a !== n && l.b !== n) continue;
    const g = l.geom || [];
    if (g.length < 4) continue;
    const pts = [];
    for (let k = 0; k + 1 < g.length; k += 2) pts.push([g[k], g[k + 1]]);
    const atStart = !Number.isNaN(pts[0][0]) && km(pts[0], old) <= km(pts[pts.length - 1], old);
    let out = atStart ? pts : pts.reverse();
    if (trim > 0 && (!only || only.has(l)) && !out.some((q) => Number.isNaN(q[0]))) {
      let k = 1;
      while (k < out.length - 1 && km(out[k], old) < trim) k++;
      out = [out[0], ...out.slice(k)];
    }
    out[0] = p;
    if (!atStart) out.reverse();
    l.geom = out.flat();
  }
}

/** 두 직선(a1–b1, a2–b2)이 만나는 자리 (평행하면 null) */
function crossAt(a1, b1, a2, b2) {
  const d1 = [b1[0] - a1[0], b1[1] - a1[1]], d2 = [b2[0] - a2[0], b2[1] - a2[1]];
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / den;
  return [a1[0] + d1[0] * t, a1[1] + d1[1] * t];
}

export function fixNetwork(base, nodeFix = {}) {
  let moved = 0;
  for (const [n, p] of Object.entries(nodeFix)) {
    if (base.nodes[+n]) { moveNode(base, +n, p, 0); moved++; }
  }
  // 역에서 엇갈리는 두 노선의 갈고리
  const st = new Set([...base.stations.map((s) => s[1]), ...(base.metro_stations || []).map((s) => s[1])]);
  const inc = new Map();
  base.links.forEach((l, i) => {
    if (l.mode < 1 || !l.name) return;
    for (const n of [l.a, l.b]) if (st.has(n)) { if (!inc.has(n)) inc.set(n, []); inc.get(n).push(i); }
  });
  let hooks = 0;
  for (const [n, ids] of inc) {
    const by = new Map();
    for (const i of ids) { const nm = base.links[i].name; if (!by.has(nm)) by.set(nm, []); by.get(nm).push(i); }
    if (by.size !== 2 || [...by.values()].some((v) => v.length !== 2)) continue;
    const node = base.nodes[n];
    const ends = [...by.values()].map((v) => v.map((i) => { const pts = ptsFrom(base.links[i], node); return pts && pointAway(pts, 0.35); }));
    if (ends.flat().some((q) => !q)) continue;
    const [[a1, b1], [a2, b2]] = ends;
    const v1 = [(b1[0] - a1[0]) * 0.886, b1[1] - a1[1]], v2 = [(b2[0] - a2[0]) * 0.886, b2[1] - a2[1]];
    const cos = Math.abs(v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
    if (cos > Math.cos((40 * Math.PI) / 180)) continue;   // 나란히 가는 두 노선은 그대로
    const x = crossAt(a1, b1, a2, b2);
    if (!x) continue;
    const d = km(x, node);
    if (d < 0.04 || d > 0.4) continue;
    moveNode(base, n, x, 0.3);
    hooks++;
  }
  // 한 노선의 갈고리: 노드 곁 120m 두 방향이 60° 안으로 되돌아 나가고, 노드가 350m 앞뒤 두 점을 이은 줄기에서 40~400m 비켜 있으면
  for (const [n, ids] of inc) {
    const by = new Map();
    for (const i of ids) { const nm = base.links[i].name; if (!by.has(nm)) by.set(nm, []); by.get(nm).push(i); }
    for (const v of by.values()) {
      if (v.length !== 2) continue;
      const node = base.nodes[n];
      const pts = v.map((i) => ptsFrom(base.links[i], node));
      if (pts.some((q) => !q)) continue;
      const near = pts.map((q) => pointAway(q, 0.12)), far = pts.map((q) => pointAway(q, 0.35));
      const w = near.map((q) => [(q[0] - node[0]) * 0.886, q[1] - node[1]]);
      const cos = (w[0][0] * w[1][0] + w[0][1] * w[1][1]) / (Math.hypot(...w[0]) * Math.hypot(...w[1]) || 1);
      if (cos < Math.cos((60 * Math.PI) / 180)) continue;   // 되돌아 나가지 않는다 (60° 넘게 벌어짐)
      const [a, b] = far, dx = (b[0] - a[0]) * 0.886, dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, (((node[0] - a[0]) * 0.886) * dx + (node[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d = km(q, node);
      if (d < 0.04 || d > 0.4) continue;
      moveNode(base, n, q, 0.3, new Set(v.map((i) => base.links[i])));
      hooks++;
      break;
    }
  }
  return { moved, hooks };
}

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

/** 노드 → 닿는 구간 (fixNetwork 한 번에 한 번 만든다: 노드 하나 옮길 때마다 3만 구간을 다 보면 느리다) */
let incident = null;
function linksAt(base, n) {
  if (!incident) {
    incident = new Map();
    for (const l of base.links) for (const x of [l.a, l.b]) { let a = incident.get(x); if (!a) incident.set(x, (a = [])); if (!a.includes(l)) a.push(l); }
  }
  return incident.get(n) || [];
}

/** 노드를 p로 옮기고 그 노드에 닿는 구간 끝을 맞춘다. trim km 안의 꺾임 점은 지운다 (only가 있으면 그 구간들만) */
function moveNode(base, n, p, trim, only = null) {
  const old = base.nodes[n];
  base.nodes[n] = p;
  for (const l of linksAt(base, n)) {
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

/** 점 목록 단순화 (더글러스-포이커, tol km) */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const segD = (p, a, b) => {
    const dx = (b[0] - a[0]) * 88.6, dy = (b[1] - a[1]) * 111, px = (p[0] - a[0]) * 88.6, py = (p[1] - a[1]) * 111;
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(px - t * dx, py - t * dy);
  };
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let k = -1, md = tol;
    for (let i = s + 1; i < e; i++) { const d = segD(pts[i], pts[s], pts[e]); if (d > md) { md = d; k = i; } }
    if (k >= 0) { keep[k] = true; stack.push([s, k], [k, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/** 모서리 깎기(Chaikin) 매끈하게: 양 끝은 그대로 */
function chaikin(pts, n = 3) {
  let out = pts;
  for (let r = 0; r < n && out.length > 2; r++) {
    const nx = [out[0]];
    for (let i = 0; i + 1 < out.length; i++) {
      const [a, b] = [out[i], out[i + 1]];
      if (i > 0) nx.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (i + 1 < out.length - 1) nx.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    nx.push(out[out.length - 1]);
    out = nx;
  }
  return out;
}

/**
 * 구간 자료 고치기 (data/link_fix.json): 메일 제보 등으로 찾은 OSM 자료의 틀린 차로·속도·선로, 빠진 다리·연결로, 겹친 역.
 *  nodes: [[경도, 위도], ...]  새 노드 (add에서 "n0", "n1"처럼 순번으로 부른다)
 *  set:   [{id, a, b, ...속성}]  양 끝(a·b)이 맞는 구간의 속성(차로·속도·선로 수·전철·이름·도형 등)을 바꾼다 (자료가 바뀌어 끝이 다르면 건너뛴다).
 *         to: [새 a, 새 b]를 주면 구간 끝을 다른 노드로 옮긴다 (역을 새로 끼워 구간을 둘로 나눌 때: 앞 구간은 to로 줄이고 뒤 구간은 add)
 *  add:   [{a, b, mode, cls, ..., geom: [경도, 위도, ...]}]  빠진 구간 (도형 양 끝은 노드 자리로 맞춘다)
 *  off:   [{id, a, b}]  있어서는 안 될 구간: 번호는 남기고(저장 게임 번호가 밀리지 않게) 길이 없는 자기 고리로 만든다
 *  stations: {merge: [[없앨 역 노드, 남길 역 노드]], add: [[역 이름, 노드]], metro: [[역 이름, 노드]], rename: [[노드, 새 이름]]}
 *         merge: 같은 역이 두 번 들어간 곳 (없앨 역에 닿던 구간을 남길 역으로 옮긴다), add·metro: 빠진 철도역·도시철도역
 * 구조(노드·구간 수)가 바뀌므로 v를 올리면 자료 판(stamp)도 바뀌어 저장 게임 번호를 옮긴다 (main.js)
 */
export function applyLinkFix(base, fix) {
  const out = { set: 0, add: 0, off: 0, merged: 0, lenSet: new Set() };
  if (!fix?.v) return out;
  const N0 = base.nodes.length;
  for (const p of fix.nodes || []) base.nodes.push(p);
  const node = (x) => (typeof x === 'string' ? N0 + +x.slice(1) : x);
  const same = (l, r) => r.a == null || [l.a, l.b].sort((p, q) => p - q).join() === [node(r.a), node(r.b)].sort((p, q) => p - q).join();
  const pl = (g) => { let s = 0; for (let k = 2; k + 1 < g.length; k += 2) s += km([g[k - 2], g[k - 1]], [g[k], g[k + 1]]); return s; };
  // 도형 양 끝을 a·b 노드 자리로 (도형이 b 쪽에서 시작하면 뒤집는다)
  const fit = (g, a, b) => {
    const na = base.nodes[a], nb = base.nodes[b];
    let pts = [];
    for (let k = 0; k + 1 < g.length; k += 2) pts.push([g[k], g[k + 1]]);
    if (km(pts[0], nb) < km(pts[0], na)) pts = pts.reverse();
    pts[0] = na; pts[pts.length - 1] = nb;
    return pts.flat();
  };
  for (const r of fix.set || []) {
    const l = base.links[r.id];
    if (!l || !same(l, r)) continue;
    const { id, a, b, geom, to, ...attrs } = r;
    Object.assign(l, attrs);
    if ('len' in attrs && !geom && !to) out.lenSet.add(r.id);   // 길이를 손으로 정한 구간: 도형 길이로 다시 매기지 않는다
    if (to) { l.a = node(to[0]); l.b = node(to[1]); if (!geom) { l.geom = fit(l.geom, l.a, l.b); l.len = Math.round(pl(l.geom) * 100) / 100; } }
    if (geom) { l.geom = fit(geom, l.a, l.b); l.len = Math.round(pl(l.geom) * 100) / 100; }
    out.set++;
  }
  for (const r of fix.off || []) {
    const l = base.links[r.id];
    if (!l || !same(l, r)) continue;
    l.b = l.a; l.geom = [...base.nodes[l.a], ...base.nodes[l.a]]; l.len = 0.01; l.off = 1;   // 빈 도형이면 지도(geojson) 처리에서 오류가 난다
    out.off++;
  }
  for (const r of fix.add || []) {
    const { geom, a: ra, b: rb, ...attrs } = r;
    const a = node(ra), b = node(rb);
    if (!base.nodes[a] || !base.nodes[b]) continue;
    const g = fit(geom || [...base.nodes[a], ...base.nodes[b]], a, b);
    base.links.push({ kp: 0, ...attrs, a, b, geom: g, len: attrs.len ?? Math.round(pl(g) * 100) / 100 });
    out.add++;
  }
  for (const [drop, keep] of fix.stations?.merge || []) {
    if (!base.nodes[drop] || !base.nodes[keep]) continue;
    for (const list of [base.stations, base.metro_stations || []]) {
      for (let k = list.length - 1; k >= 0; k--) if (list[k][1] === drop) list.splice(k, 1);
    }
    for (const l of base.links) {
      if (l.a !== drop && l.b !== drop) continue;
      if (l.a === drop) l.a = keep;
      if (l.b === drop) l.b = keep;
      if (l.geom.length >= 4 && !l.geom.some((v) => Number.isNaN(v))) { l.geom = fit(l.geom, l.a, l.b); l.len = Math.max(0.01, Math.round(pl(l.geom) * 100) / 100); }
    }
    out.merged++;
  }
  // rename: [[노드, 새 이름]] 자료에 임시 이름(예: '동탄인덕원111')으로 들어간 역
  for (const [n, name] of fix.stations?.rename || []) for (const list of [base.stations, base.metro_stations || []]) for (const e of list) if (e[1] === node(n)) e[0] = name;
  for (const [name, n] of fix.stations?.add || []) if (base.nodes[node(n)]) base.stations.push([name, node(n)]);
  for (const [name, n] of fix.stations?.metro || []) if (base.nodes[node(n)]) (base.metro_stations ||= []).push([name, node(n)]);
  return out;
}

export function fixNetwork(base, nodeFix = {}, roadFix = {}, linkFix = null) {
  incident = null;
  const lf = applyLinkFix(base, linkFix);
  // 대심도 광역급행철도(GTX): 지도 자료 선형이 역 어귀에서 기존 노선을 따라 구불거린다(대곡 등). 지하 깊이 거의 곧게 가므로
  // 250m 안의 잔굴곡을 없애고 매끈한 곡선으로 (양 끝 역 자리는 그대로)
  for (const l of base.links) {
    if (l.mode !== 1 || !/광역급행철도/.test(l.name || '') || !l.geom || l.geom.some((v) => Number.isNaN(v))) continue;
    const pts = [];
    for (let k = 0; k + 1 < l.geom.length; k += 2) pts.push([l.geom[k], l.geom[k + 1]]);
    if (pts.length < 3) continue;
    l.geom = chaikin(simplify(pts, 0.25)).flat();
  }
  let moved = 0;
  for (const [n, p] of Object.entries(nodeFix)) {
    if (base.nodes[+n]) { moveNode(base, +n, p, 0); moved++; }
  }
  // 고속도로 분기점 손질 (data/road_geom_fix.json, pipeline/build_node_fix.py):
  // rewire: 한 고속도로가 다른 고속도로 위를 따라가던 구간의 끝을 바꿔 잇는다 (안산분기점: 영동은 교차점에서 곧게, 남는 구간은 분기점 연결로)
  // geom: 서로 다른 고속도로가 같은 두 노드 사이를 함께 쓰는 구간을 제 고속도로 선형으로 따로 그린다 (조남 북쪽 서해안·수원문산)
  const pl = (g) => { let s = 0; for (let k = 2; k + 1 < g.length; k += 2) s += km([g[k - 2], g[k - 1]], [g[k], g[k + 1]]); return s; };
  for (const [id, r] of Object.entries(roadFix.rewire || {})) {
    const l = base.links[+id];
    if (!l || l.mode !== 0 || [l.a, l.b].sort().join() !== [...r.from].sort().join()) continue;   // 다른 망이면 건드리지 않는다
    l.a = r.a; l.b = r.b; l.geom = r.geom.slice();
    l.geom.splice(0, 2, ...base.nodes[r.a]); l.geom.splice(-2, 2, ...base.nodes[r.b]);
    l.len = Math.round(pl(l.geom) * 100) / 100;
    // 분기점 연결로는 고속도로끼리 잇는 길이라 고속도로 그대로 둔다 (일반도로로 바꾸면 도로 접속 노드가 늘어 기준선의 역세권 계산을 못 쓰고
    // 불러올 때마다 20초쯤 다시 셌다)
    if (r.name) l.name = r.name;
  }
  for (const [id, g] of Object.entries(roadFix.geom || {})) {
    const l = base.links[+id];
    if (!l || l.mode !== 0 || g.length < 4) continue;
    const ga = [g[0], g[1]], na = base.nodes[l.a], nb = base.nodes[l.b];
    const fwd = km(ga, na) <= km(ga, nb);
    const out = g.slice();
    out.splice(0, 2, ...(fwd ? na : nb)); out.splice(-2, 2, ...(fwd ? nb : na));
    l.geom = out;
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
  const { lenSet, ...lfOut } = lf;
  const lens = fitLengths(base, lenSet);
  return { moved, hooks, lens, ...lfOut };
}

/** 계산 길이(len)를 도형 길이로 맞춘 판. 올리면 자료 판(stamp)에 붙어 기준 연도·저장 게임 번호를 다시 맞춘다 (main.js, tools/baseline.html) */
export const LEN_FIX_V = 1;

/**
 * 구간의 계산 길이를 지도 도형 길이로 맞춘다. 자료(pipeline/build_data.py)의 len은 노드를 합치고 나누는 동안 직선거리·비례로
 * 다시 매겨져, 고속도로 셋 중 하나가 도형의 2/3도 안 됐다 (남해고속도로 한 구간 0.09km ↔ 도형 2.44km): 경로 계산이 그런 구간을 너무 짧게 봐 교통이 몰렸다.
 * 길이를 손으로 정한 구간(link_fix set), 없앤 구간(off), 도형이 없거나 조각난 구간은 그대로 둔다. 바꾼 구간 수를 돌려준다
 */
function fitLengths(base, keep = new Set()) {
  let n = 0;
  base.links.forEach((l, i) => {
    const g = l.geom;
    if (l.off || keep.has(i) || !g || g.length < 4) return;
    let s = 0;
    for (let k = 2; k + 1 < g.length; k += 2) {
      const x0 = g[k - 2], y0 = g[k - 1], x1 = g[k], y1 = g[k + 1];
      if (Number.isNaN(x0) || Number.isNaN(x1)) return;
      const dx = (x1 - x0) * Math.cos(((y0 + y1) / 2) * Math.PI / 180), dy = y1 - y0;
      s += Math.sqrt(dx * dx + dy * dy) * 111.32;
    }
    if (!(s >= 0.01)) return;
    const len = Math.round(s * 100) / 100;
    if (len !== l.len) { l.len = len; n++; }
  });
  return n;
}

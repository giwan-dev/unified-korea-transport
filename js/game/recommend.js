// 문장으로 노선 추천 (서버 없이 게임 안 규칙으로).
// 문장에서 도시와 수단(도시철도·광역철도·고속철도·일반철도·고속도로·국도)과 호선 번호를 읽고,
// - 도시철도: 그 도시에서 인구가 많은데 역(반경 800m)이 없는 곳들을 골라 한 줄로 잇는다
// - 철도·도로: 도시 둘이면 둘을 잇고, 하나면 가장 가까운 큰 도시와 잇는다
// 결과는 그리기(draft)로 열어 플레이어가 고친 뒤 착공한다.

const MODE_WORDS = [
  [/도시철도|지하철|경전철|트램|\d+\s*호선/, 'metro'],
  [/광역급행|GTX|광역철도/i, 'gtx'],
  [/고속철|KTX|SRT|고속열차/i, 'hsr'],
  [/고속도로/, 'motorway'],
  [/국도|도로/, 'trunk'],
  [/철도|기차|열차|선로/, 'rail'],
];

const stem = (s) => s.replace(/(특별자치시|특별자치도|특별시|광역시|직할시|자치시|자치도|시|군|구|구역|도)$/, '');

/** 문장 → {mode, cities: [{name, zones:[존 번호]}], number} */
export function parseRequest(text, zoneProps) {
  const t = text.replace(/\s+/g, ' ');
  let mode = null;
  for (const [re, m] of MODE_WORDS) if (re.test(t)) { mode = m; break; }
  const num = (t.match(/(\d+)\s*호선/) || [])[1];
  // 도시 이름: 광역시·도시(시도 이름), 시군구 이름을 길이가 긴 것부터 찾는다
  const names = new Map();
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    for (const raw of [z.province, z.name]) {
      const s = stem(raw || '');
      if (s.length < 2) continue;
      if (!names.has(s)) names.set(s, new Set());
      // 시도 이름이면 그 시도의 모든 존, 시군구 이름이면 그 존
      if (raw === z.province) { if (/(시|특별자치시)$/.test(raw)) names.get(s).add(i); } else names.get(s).add(i);
    }
  });
  const found = [];
  let rest = t;
  for (const s of [...names.keys()].sort((a, b) => b.length - a.length)) {
    const k = rest.indexOf(s);
    if (k < 0 || !names.get(s).size) continue;
    found.push({ name: s, zones: [...names.get(s)], at: k });
    rest = rest.slice(0, k) + ' '.repeat(s.length) + rest.slice(k + s.length);
  }
  found.sort((a, b) => a.at - b.at);
  return { mode, cities: found, number: num ? +num : null };
}

const KX = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);
const km = (a, b) => Math.hypot((a[0] - b[0]) * KX(a[1]), (a[1] - b[1]) * 110.57);

/**
 * 도시철도 노선안: 도시 안 1km 격자 가운데 인구가 많고 역에서 먼 곳을 골라, 가장 멀리 떨어진 두 곳을 끝으로 하는 띠 안에서 역을 늘어놓는다.
 * @param {Float32Array} grid [경도, 위도, 인구, 소구역] 반복
 * @param {Set<number>} citySubs 도시에 속한 소구역 번호
 * @param {number[][]} stations 기존 역 좌표 (철도·도시철도)
 */
export function metroPlan(grid, citySubs, stations, { spacingKm = 1.3, maxStations = 14 } = {}) {
  // 1km 칸으로 모은다
  const cells = new Map();
  for (let c = 0; c < grid.length; c += 4) {
    if (!citySubs.has(grid[c + 3])) continue;
    const k = `${Math.round(grid[c] / 0.0113)}:${Math.round(grid[c + 1] / 0.009)}`;
    let e = cells.get(k);
    if (!e) cells.set(k, (e = { x: 0, y: 0, p: 0 }));
    e.x += grid[c] * grid[c + 2]; e.y += grid[c + 1] * grid[c + 2]; e.p += grid[c + 2];
  }
  const near = (pt, r) => stations.some((s) => Math.abs(s[1] - pt[1]) < 0.02 && km(s, pt) < r);
  const cand = [...cells.values()].filter((e) => e.p > 0).map((e) => ({ c: [e.x / e.p, e.y / e.p], p: e.p }))
    .filter((e) => !near(e.c, 0.8)).sort((a, b) => b.p - a.p).slice(0, 60);
  if (cand.length < 3) return null;
  // 끝점: 인구가 많은 곳 가운데 서로 가장 먼 둘 (너무 멀면 25km까지)
  const top = cand.slice(0, 20);
  let A = top[0], B = top[1], best = -1;
  for (const a of top) for (const b of top) {
    const d = km(a.c, b.c);
    if (d > 25 || a === b) continue;
    const s = d * Math.sqrt(a.p * b.p);
    if (s > best) { best = s; A = a; B = b; }
  }
  const L = km(A.c, B.c);
  if (L < 2) return null;
  // A에서 B 쪽으로 한 역씩 나아간다: 다음 역은 1~2.5km 앞의 칸 가운데 인구가 많고 B로 가는 방향에서 덜 벗어난 곳
  const all = [...cells.values()].filter((e) => e.p > 0).map((e) => ({ c: [e.x / e.p, e.y / e.p], p: e.p }));
  const path = [A];
  let cur = A;
  for (let guard = 0; guard < maxStations && km(cur.c, B.c) > spacingKm * 1.8; guard++) {
    const toB = km(cur.c, B.c);
    const dir = [(B.c[0] - cur.c[0]) * KX(cur.c[1]) / toB, (B.c[1] - cur.c[1]) * 110.57 / toB];
    let best = null, bs = -1;
    for (const e of all) {
      const d = km(cur.c, e.c);
      if (d < spacingKm * 0.8 || d > spacingKm * 2 || km(e.c, B.c) > toB - spacingKm * 0.5) continue;
      if (path.some((q) => km(q.c, e.c) < spacingKm * 0.8)) continue;
      const v = [(e.c[0] - cur.c[0]) * KX(cur.c[1]), (e.c[1] - cur.c[1]) * 110.57];
      const dev = Math.abs(v[0] * dir[1] - v[1] * dir[0]);
      // 이미 역이 있는 곳은 덜 친다 (역이 없는 밀집지를 잇는 것이 목적)
      const score = e.p * Math.exp(-dev / 0.8) * (near(e.c, 0.8) ? 0.3 : 1);
      if (score > bs) { bs = score; best = e; }
    }
    if (!best) break;
    path.push(best); cur = best;
  }
  path.push(B);
  let len = 0;
  for (let k = 1; k < path.length; k++) len += km(path[k - 1].c, path[k].c);
  const served = path.reduce((s0, e) => s0 + (near(e.c, 0.8) ? 0 : e.p), 0);
  return { points: path.map((e) => e.c), km: len * 1.1, served };
}

/** 도시 대표 좌표: 인구 가중 소구역 중심 */
export function cityCenter(zoneProps, zones, popOf) {
  let x = 0, y = 0, w = 0;
  for (const i of zones) for (const [sx, sy, sw] of zoneProps[i].subs) { const p = sw * popOf(i); x += sx * p; y += sy * p; w += p; }
  return w ? [x / w, y / w] : null;
}

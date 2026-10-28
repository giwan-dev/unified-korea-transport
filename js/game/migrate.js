// 지도·노선 자료를 새로 만들면(파이프라인 재실행) 노드·링크·시군 번호가 바뀐다. 예전 저장 게임을 새 자료에 맞춰 옮긴다.
// 자료 판마다 노드 좌표·링크 양 끝·시군 이름을 IndexedDB에 적어 두고(rememberNetwork),
// 다음 판에서 좌표로 노드를, 양 끝으로 링크를, 이름으로 시군을 찾아 번호를 바꾼다.
// 짝을 못 찾은 개량·민원 같은 것은 버리고, 새로 깐 노선의 끝점처럼 꼭 필요한 것을 못 찾으면 옮기기를 포기한다.

import { putRef, getRef } from './savestore.js';

const modesOf = (nodeCount, links) => {
  const m = new Uint8Array(nodeCount);
  for (const l of links) { m[l.a] |= 1 << l.mode; m[l.b] |= 1 << l.mode; }
  return m;
};

/** 이 자료 판의 좌표표를 남긴다 (이미 있으면 그대로) */
export function rememberNetwork(stamp, base, zones) {
  if (!stamp) return;
  const N = base.nodes.length, L = base.links.length;
  const xy = new Float64Array(N * 2);
  base.nodes.forEach(([x, y], i) => { xy[2 * i] = x; xy[2 * i + 1] = y; });
  const ab = new Int32Array(L * 3);
  base.links.forEach((l, i) => { ab[3 * i] = l.a; ab[3 * i + 1] = l.b; ab[3 * i + 2] = l.mode; });
  const sub = [];
  for (const z of zones) for (const s of z.subs || [[z.cx, z.cy]]) sub.push(s[0], s[1]);
  putRef(stamp, {
    N, L, xy, ab, modes: modesOf(N, base.links),
    zones: zones.map((z) => [z.name, z.country, z.cx, z.cy, (z.subs || [1]).length]),
    sub: Float64Array.from(sub),
  });
}

/**
 * 지금 망에서 앞의 N개 노드·L개 구간만 있던 것으로 친 좌표표: 자료 판 표시는 같은데 기본 노드·구간 수가 다른 저장
 * (판을 올린 뒤 브라우저가 예전 파일 일부를 캐시에서 써서 구간 고치기가 빠진 채 저장한 경우 등)을 옮길 때 쓴다
 */
export function refFromBase(base, zones, N, L) {
  const xy = new Float64Array(N * 2).fill(NaN);
  for (let i = 0; i < Math.min(N, base.nodes.length); i++) { xy[2 * i] = base.nodes[i][0]; xy[2 * i + 1] = base.nodes[i][1]; }
  const ab = new Int32Array(L * 3).fill(-1);
  for (let i = 0; i < Math.min(L, base.links.length); i++) { const l = base.links[i]; ab[3 * i] = l.a; ab[3 * i + 1] = l.b; ab[3 * i + 2] = l.mode; }
  const modes = modesOf(N, base.links.filter((l) => l.a < N && l.b < N));
  return { N, L, xy, ab, modes, zones: zones.map((z) => [z.name, z.country, z.cx, z.cy, (z.subs || [1]).length]) };
}

/** 좌표 격자 색인 */
function grid(xy, n, cell) {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(xy[2 * i] / cell)},${Math.floor(xy[2 * i + 1] / cell)}`;
    let a = m.get(k); if (!a) m.set(k, a = []); a.push(i);
  }
  return {
    near(x, y, r, ok = () => true) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), R = Math.ceil(r / cell);
      let best = -1, bd = r * r;
      for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
        for (const i of m.get(`${cx + dx},${cy + dy}`) || []) {
          const d = (xy[2 * i] - x) ** 2 + ((xy[2 * i + 1] - y) * 1.27) ** 2;   // 위도 38° 언저리: 경도 1도가 위도 1도의 0.79배
          if (d <= bd && ok(i)) { bd = d; best = i; }
        }
      }
      return best;
    },
  };
}

/**
 * @returns {Promise<{ok:true, state:object, note:string} | {ok:false, reason:string}>}
 * state는 고친 사본. 운행 계통 경로(segs)는 main이 새 망에서 다시 짠다 (replanServices 표시).
 */
export async function migrateState(old, { base, zones, ref: given = null }) {
  const ref = given || await getRef(old.dataStamp);
  if (!ref) return { ok: false, reason: '예전 자료의 좌표표가 없습니다' };
  const s = JSON.parse(JSON.stringify(old));
  const N0 = ref.N, L0 = ref.L, N1 = base.nodes.length, L1 = base.links.length;
  const xy1 = new Float64Array(N1 * 2);
  base.nodes.forEach(([x, y], i) => { xy1[2 * i] = x; xy1[2 * i + 1] = y; });
  const modes1 = modesOf(N1, base.links);
  const g1 = grid(xy1, N1, 0.01);
  const lost = { links: 0, nodes: 0 };

  // 노드: 같은 수단이 닿는 가장 가까운 노드 (300m 안), 없으면 수단 상관없이 1km 안
  const nodeMemo = new Map();
  const mN = (id) => {
    if (id == null || id < 0) return -1;
    if (id >= N0) return N1 + (id - N0);   // 게임에서 새로 만든 노드: 번호만 밀린다
    if (nodeMemo.has(id)) return nodeMemo.get(id);
    const x = ref.xy[2 * id], y = ref.xy[2 * id + 1], md = ref.modes[id];
    // 같은 번호의 노드가 같은 수단이고 1.5km 안이면 그 노드다: 데이터를 고칠 때 노드 번호는 두고 자리만 옮긴다
    // (역 노드를 승강장 자리로 수백 m 옮긴 뒤 '가장 가까운 노드'로 찾으면 옆 분기점 등으로 잘못 짝지어진다)
    if (id < N1 && (!md || (modes1[id] & md)) && Math.hypot((xy1[2 * id] - x) * 88, (xy1[2 * id + 1] - y) * 111) < 1.5) {
      nodeMemo.set(id, id);
      return id;
    }
    let n = g1.near(x, y, 0.004, (i) => !md || (modes1[i] & md));
    if (n < 0) n = g1.near(x, y, 0.012);
    nodeMemo.set(id, n);
    return n;
  };
  // 링크: 양 끝을 옮긴 뒤 같은 수단의 링크
  const linkIdx = new Map();
  base.links.forEach((l, i) => { linkIdx.set(`${Math.min(l.a, l.b)}-${Math.max(l.a, l.b)}-${l.mode}`, i); });
  const linkMemo = new Map();
  const mL = (id) => {
    id = +id;
    if (!(id >= 0)) return -1;
    if (id >= L0) return L1 + (id - L0);
    if (linkMemo.has(id)) return linkMemo.get(id);
    const a = mN(ref.ab[3 * id]), b = mN(ref.ab[3 * id + 1]);
    // 같은 번호의 링크가 같은 수단이고 끝 노드 하나 이상이 같으면 그 링크다 (역에서 나눈 링크는 앞쪽이 같은 번호로 남는다)
    const same = id < L1 ? base.links[id] : null;
    if (same && same.mode === ref.ab[3 * id + 2] && (same.a === a || same.b === b || same.a === b || same.b === a)) { linkMemo.set(id, id); return id; }
    const r = a >= 0 && b >= 0 ? linkIdx.get(`${Math.min(a, b)}-${Math.max(a, b)}-${ref.ab[3 * id + 2]}`) ?? -1 : -1;
    linkMemo.set(id, r);
    return r;
  };
  // 시군: 원래 이름·나라가 같은 존 (여럿이면 중심이 가까운 것), 없으면 같은 나라에서 중심이 가장 가까운 존
  const zByName = new Map();
  zones.forEach((z, i) => { const k = `${z.name}|${z.country}`; if (!zByName.has(k)) zByName.set(k, []); zByName.get(k).push(i); });
  const Z0 = ref.zones.length;
  const zMap = ref.zones.map(([name, country, cx, cy]) => {
    const near = (list) => list.reduce((b, i) => ((zones[i].cx - cx) ** 2 + (zones[i].cy - cy) ** 2 < (zones[b].cx - cx) ** 2 + (zones[b].cy - cy) ** 2 ? i : b), list[0]);
    const same = zByName.get(`${name}|${country}`);
    if (same) return near(same);
    const cand = zones.map((_, i) => i).filter((i) => zones[i].country === country && !zones[i].ext);
    return cand.length ? near(cand) : -1;
  });
  const mZ = (id) => (id >= 0 && id < Z0 ? zMap[id] : -1);
  const rekey = (obj, f) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) { const n = f(k); if (n != null && n !== -1) out[n] = v; }
    return out;
  };
  const mapArr = (arr, f) => (arr || []).map(f).filter((x) => x >= 0);
  const zKey = (k) => (k.startsWith('z:') ? (mZ(+k.slice(2)) >= 0 ? `z:${mZ(+k.slice(2))}` : null) : k);

  // 새로 깐 링크: 끝점을 못 찾으면 이 저장은 옮길 수 없다
  for (const [k, nl] of (s.newLinks || []).entries()) {
    nl.id = L1 + k;
    nl.a = mN(nl.a); nl.b = mN(nl.b);
    if (nl.a < 0 || nl.b < 0) return { ok: false, reason: '새로 깐 노선의 끝점을 새 지도에서 찾지 못했습니다' };
    if (nl.split != null) nl.split = mL(nl.split);
  }
  const before = Object.keys(s.overrides || {}).length;
  s.overrides = rekey(s.overrides, mL);
  lost.links += before - Object.keys(s.overrides).length;
  s.replaced = rekey(s.replaced, mL);
  s.newStations = mapArr(s.newStations, mN);
  s.closedStations = mapArr(s.closedStations, mN);
  s.reopenedStations = mapArr(s.reopenedStations, mN);
  s.names = rekey(s.names, (k) => mN(+k));
  for (const r of s.restAreas || []) r.links = mapArr(r.links, mL);
  if (s.osm) { s.osm.opened = rekey(s.osm.opened, mL); s.osm.auto = rekey(s.osm.auto, mL); }
  s.congestion = {};
  s.dismissed = {};
  s.happyBonus = rekey(s.happyBonus, (k) => mZ(+k));
  s.placeNames = rekey(s.placeNames, zKey);
  s.adminNames = rekey(s.adminNames, zKey);
  delete s.subBase; delete s.zoneGainPrev;
  s.compare = [];
  for (const x of s.sez || []) x.zone = mZ(x.zone);
  for (const x of s.housing || []) x.zone = mZ(x.zone);
  for (const x of s.devels || []) { x.zone = mZ(x.zone); x.node = mN(x.node); }
  if (s.sez) s.sez = s.sez.filter((x) => x.zone >= 0);
  for (const t of s.transfers || []) { t.rail = mN(t.rail); t.metro = mN(t.metro); }
  if (s.transfers) s.transfers = s.transfers.filter((t) => t.rail >= 0 && t.metro >= 0);
  for (const sv of s.services || []) { sv.stops = mapArr(sv.stops, mN); sv.replan = true; }
  for (const p of s.ppp || []) p.links = mapArr(p.links, mL);
  if (s.local) {
    // 'm:존' 또는 분구한 구의 'm:존#구'
    const office = (k) => {
      if (!k.startsWith('m:')) return k;
      const [id, gu] = k.slice(2).split('#');
      return mZ(+id) >= 0 ? `m:${mZ(+id)}${gu ? `#${gu}` : ''}` : null;
    };
    s.local.offices = rekey(s.local.offices, office);
    for (const o of Object.values(s.local.offices)) if (o.zone != null) o.zone = mZ(o.zone);
    s.local.proposals = (s.local.proposals || []).filter((pr) => office(pr.office || '') !== null);
    for (const pr of s.local.proposals) { pr.links = mapArr(pr.links, mL); if (pr.office) pr.office = office(pr.office); }
  }
  for (const p of s.projects || []) {
    if (p.links) {
      const n0 = p.links.length;
      p.links = mapArr(p.links, mL);
      if (p.kind === 'upgrade' && p.status === 'building') lost.links += n0 - p.links.length;
    }
    if (p.stations) p.stations = mapArr(p.stations, mN);
    if (p.dropStations) p.dropStations = mapArr(p.dropStations, mN);
    if (p.retire) p.retire = mapArr(p.retire, mL);
    if (p.relinks) p.relinks = mapArr(p.relinks, mL);
    if (p.stationMap) p.stationMap = Object.fromEntries(Object.entries(p.stationMap).map(([a, b]) => [mN(+a), mN(b)]).filter(([a, b]) => a >= 0 && b >= 0));
    if (p.newNames) p.newNames = rekey(p.newNames, (k) => mN(+k));
    if (p.zone != null) p.zone = mZ(p.zone);
    if (p.key && p.kind === 'rename') p.key = zKey(p.key) || p.key;
  }

  // 그해 계산 상태: 시군 배열은 새 시군 순서로 (짝 없는 새 시군은 처음 인구·그 나라 평균), 소구역 배열은 버린다
  const snap = s.snapshot;
  if (snap) {
    const back = new Map();   // 새 존 → 옮겨 오는 옛 존들
    zMap.forEach((n, o) => { if (n >= 0) { if (!back.has(n)) back.set(n, []); back.get(n).push(o); } });
    const Z1 = zones.length;
    const growth = (() => {
      let a = 0, b = 0;
      ref.zones.forEach((_, o) => { if (Array.isArray(snap.pop) && snap.pop[o] > 0) { a += snap.pop[o]; } });
      zones.forEach((z) => { if (!z.ext) b += Math.max(z.pop, 0); });
      return b > 0 ? a / b : 1;
    })();
    const pop0 = Array.isArray(snap.pop) ? snap.pop.slice() : null;
    for (const key of ['pop', 'income', 'le', 'mys', 'eys', 'hdi', 'amenity', 'amenExcess', 'inc0', 'tourKP']) {
      const arr = snap[key];
      if (!Array.isArray(arr) || arr.length !== Z0) { if (arr && arr.length !== Z1) delete snap[key]; continue; }
      const out = new Array(Z1);
      for (let z = 0; z < Z1; z++) {
        const olds = back.get(z);
        if (olds) {
          // 옛 존 여럿이 한 존으로 모이면 인구는 더하고 나머지는 인구 가중 평균
          if (key === 'pop') out[z] = olds.reduce((t, o) => t + arr[o], 0);
          else { let w = 0, v = 0; for (const o of olds) { const p = pop0?.[o] || 1; w += p; v += arr[o] * p; } out[z] = v / w; }
        } else if (key === 'pop') out[z] = Math.max(zones[z].pop, 0) * growth;
        else {
          const same = arr.filter((_, o) => ref.zones[o][1] === zones[z].country);
          out[z] = same.length ? same.reduce((t, v) => t + v, 0) / same.length : arr[0];
        }
      }
      snap[key] = out;
    }
    delete snap.subW; delete snap.subAmenity;
    if (snap.waits) snap.waits = snap.waits.map(([n, w]) => [mN(n), w]).filter(([n]) => n >= 0);
  }
  const notes = [];
  if (lost.links) notes.push(`새 지도에 없는 구간의 개량 ${lost.links}건은 옮기지 못했습니다`);
  return { ok: true, state: s, note: notes.join(', ') };
}

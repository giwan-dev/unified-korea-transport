// 국외 거점(중국·러시아·일본)과 국경 통과점, 여객선 항로, 공항을 기본 네트워크에 붙인다 (data/air_sea.json).
import { kmBetween } from '../sim/model.js';

/**
 * base(네트워크)와 zoneProps(존 속성)를 제자리에서 늘린다.
 * - 국외 거점은 인구·소득이 고정된 외부 존이 된다 (ext: 1).
 * - 중국·러시아 거점은 국경 통과점을 거쳐 북측 도로·철도와 가상 링크로 이어진다.
 * - 여객선 항로는 도로 수단의 항로 링크(cls 'ferry')로 넣는다.
 */
export const FOREIGN_PROVINCE = { CN: '중화인민공화국', RU: '러시아', JP: '일본', TW: '중화민국' };

export function extendWorld(base, zoneProps, world) {
  const roadNodes = new Set(), railNodes = new Set();
  for (const l of base.links) {
    const set = l.mode === 0 ? roadNodes : l.mode === 1 ? railNodes : null;
    if (set) { set.add(l.a); set.add(l.b); }
  }
  const nearest = (set, lon, lat) => {
    let best = -1, bd = Infinity;
    for (const id of set) {
      const [x, y] = base.nodes[id];
      const d = (x - lon) ** 2 + (y - lat) ** 2;
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  };
  const last = zoneProps[zoneProps.length - 1];
  let sub0 = last.sub0 + last.subs.length;
  const cityNode = {};
  for (const f of world.foreign) {
    const id = zoneProps.length;
    zoneProps.push({
      id, name: f.name, province: FOREIGN_PROVINCE[f.country], country: f.country, ext: 1,
      pop: f.pop * 1e6, korean: (f.korean || 0) * 1e6, income: f.income, area: 1000, cx: f.lon, cy: f.lat, subs: [[f.lon, f.lat, 1, 1000]], sub0,
    });
    sub0 += 1;
    cityNode[f.id] = base.nodes.length;
    (base.foreignNodes ||= []).push({ name: f.name, node: base.nodes.length, country: f.country });
    base.nodes.push([f.lon, f.lat]);
    base.stations.push([f.name, cityNode[f.id]]);
  }
  // 경유점(via)을 지나는 선: 국경 철도·도로와 항로를 실제 경로 모양으로 그리고 연장도 그 길이로 잡는다
  const path = (a, b, via = []) => {
    const pts = [base.nodes[a], ...via, base.nodes[b]];
    let km = 0;
    for (let i = 1; i < pts.length; i++) km += kmBetween(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    return { km, geom: pts.flat() };
  };
  const link = (a, b, attrs, name, via) => {
    const p = path(a, b, via);
    // 경유점이 촘촘하면(OSM 경로를 따른 railVia·roadVia) 그 길이 그대로, 성기면 굽이만큼 늘린다
    const f = !via?.length ? 1.25 : via.length > 5 ? 1.02 : 1.1;
    base.links.push({ a, b, len: Math.round(p.km * f * 100) / 100, kp: 1, ext: 1, name, geom: p.geom, ...attrs });
  };
  for (const g of world.gateways) {
    const city = cityNode[g.to];
    // 철도와 도로는 실제 노선을 따라 경유점이 다르다 (railVia·roadVia, 없으면 via)
    if (g.road) link(nearest(roadNodes, g.lon, g.lat), city, { mode: 0, cls: 'trunk', lanes: 4, speed: 80, paved: 1 }, `${g.name} 국경 도로`, g.roadVia || g.via);
    if (g.rail) link(nearest(railNodes, g.lon, g.lat), city, { mode: 1, cls: 'conv', tracks: 2, speed: 100, power: 'AC' }, `${g.name} 국경 철도`, g.railVia || g.via);
  }
  // 국외 도시끼리 잇는 철도·도로 (단둥–선양, 옌지–창춘 등): 국경을 넘은 통행이 국경 도시에서 끊기지 않고 더 먼 도시까지 간다
  for (const c of world.corridors || []) {
    const a = cityNode[c.from], b = cityNode[c.to];
    if (a == null || b == null) continue;
    if (c.road) link(a, b, { mode: 0, cls: 'motorway', lanes: 4, speed: c.roadSpeed || 100, paved: 1, kp: 0 }, `${c.name} 도로`, c.roadVia);
    if (c.rail) link(a, b, { mode: 1, cls: c.hsr ? 'hsr' : 'conv', tracks: 2, speed: c.railSpeed || (c.hsr ? 250 : 100), power: 'AC', kp: 0 }, `${c.name} 철도`, c.railVia);
  }
  // 계산망에 도로가 없는 섬(울릉도·독도: 항로에 node 이름이 적힌 곳)은 항구 노드를 새로 둔다 (같은 이름이면 같은 노드)
  const ports = new Map();
  const port = (lon, lat, name) => {
    if (name && ports.has(name)) return ports.get(name);
    const n = nearest(roadNodes, lon, lat);
    if (!name || (n >= 0 && kmBetween(lon, lat, ...base.nodes[n]) < 5)) return n;
    base.nodes.push([lon, lat]);
    ports.set(name, base.nodes.length - 1);
    (base.ports ||= []).push([name, base.nodes.length - 1]);
    return base.nodes.length - 1;
  };
  for (const f of world.ferries) {
    const a = port(...f.from, f.fromNode);
    const b = typeof f.to === 'string' ? cityNode[f.to] : port(...f.to, f.node);
    const p = path(a, b, f.via);
    const km = p.km * (f.via?.length ? 1.03 : 1.1);
    // 승선 대기·수속 1시간을 속도에 녹인다
    const speed = Math.max(5, Math.round(km / (f.hours + 1)));
    base.links.push({ a, b, len: Math.round(km * 100) / 100, mode: 0, cls: 'ferry', lanes: 2, speed, paved: 1, kp: 0, ext: typeof f.to === 'string' ? 1 : 0, name: `${f.name} 여객선`, geom: p.geom });
  }
  base.airports = world.airports.map((a) => ({ ...a, country: a.kp ? 'KP' : 'KR' }))
    .concat(world.foreign.filter((f) => f.airport !== false).map((f) => ({ id: f.id, name: `${f.name} 공항`, lon: f.lon, lat: f.lat, cap: 60, intl: true, ext: 1, country: f.country })));
  return base;
}

/**
 * 도심 간선도로 차로 수 보정. OSM에 차로 수가 없으면 2차로로 들어오는데,
 * 인구가 많은 곳(주변 3×3km 평균 2,000명/km², 지방 도로는 5,000명/km² 이상)의 간선은 대개 4차로 이상이다.
 * @returns {number} 고친 구간 수
 */
export function urbanLanes(base, grid) {
  const g = grid instanceof Float32Array ? grid : new Float32Array(grid);
  const DX = 0.0113, DY = 0.009;   // 약 1km
  const bins = new Map();
  for (let c = 0; c < g.length; c += 4) {
    const k = `${Math.floor(g[c] / DX)}:${Math.floor(g[c + 1] / DY)}`;
    bins.set(k, (bins.get(k) || 0) + g[c + 2]);
  }
  const density = (x, y) => {
    const i = Math.floor(x / DX), j = Math.floor(y / DY);
    let s = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) s += bins.get(`${i + a}:${j + b}`) || 0;
    return s / 9;
  };
  let n = 0;
  for (const l of base.links) {
    if (l.mode !== 0 || l.lanes >= 4 || !['trunk', 'primary', 'secondary'].includes(l.cls)) continue;
    const [ax, ay] = base.nodes[l.a], [bx, by] = base.nodes[l.b];
    if (density((ax + bx) / 2, (ay + by) / 2) >= (l.cls === 'secondary' ? 5000 : 2000)) { l.lanes = 4; n++; }
  }
  return n;
}

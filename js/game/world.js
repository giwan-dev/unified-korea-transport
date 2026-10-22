// 국외 거점(중국·러시아·일본)과 국경 통과점, 여객선 항로, 공항을 기본 네트워크에 붙인다 (data/air_sea.json).
import { kmBetween } from '../sim/model.js';

/**
 * base(네트워크)와 zoneProps(존 속성)를 제자리에서 늘린다.
 * - 국외 거점은 인구·소득이 고정된 외부 존이 된다 (ext: 1).
 * - 중국·러시아 거점은 국경 통과점을 거쳐 북측 도로·철도와 가상 링크로 이어진다.
 * - 여객선 항로는 도로 수단의 항로 링크(cls 'ferry')로 넣는다.
 */
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
      id, name: f.name, province: { CN: '중국', RU: '러시아', JP: '일본' }[f.country], country: f.country, ext: 1,
      pop: f.pop * 1e6, income: f.income, area: 1000, cx: f.lon, cy: f.lat, subs: [[f.lon, f.lat, 1, 1000]], sub0,
    });
    sub0 += 1;
    cityNode[f.id] = base.nodes.length;
    (base.foreignNodes ||= []).push({ name: f.name, node: base.nodes.length, country: f.country });
    base.nodes.push([f.lon, f.lat]);
    base.stations.push([f.name, cityNode[f.id]]);
  }
  const link = (a, b, attrs, name) => {
    const [x1, y1] = base.nodes[a], [x2, y2] = base.nodes[b];
    base.links.push({ a, b, len: Math.round(kmBetween(x1, y1, x2, y2) * 1.25 * 100) / 100, kp: 1, ext: 1, name, geom: [x1, y1, x2, y2], ...attrs });
  };
  for (const g of world.gateways) {
    const city = cityNode[g.to];
    if (g.road) link(nearest(roadNodes, g.lon, g.lat), city, { mode: 0, cls: 'trunk', lanes: 4, speed: 80, paved: 1 }, `${g.name} 국경 도로`);
    if (g.rail) link(nearest(railNodes, g.lon, g.lat), city, { mode: 1, cls: 'conv', tracks: 2, speed: 100, power: 'AC' }, `${g.name} 국경 철도`);
  }
  for (const f of world.ferries) {
    const a = nearest(roadNodes, ...f.from);
    const b = typeof f.to === 'string' ? cityNode[f.to] : nearest(roadNodes, ...f.to);
    const [x1, y1] = base.nodes[a], [x2, y2] = base.nodes[b];
    const km = kmBetween(x1, y1, x2, y2) * 1.1;
    // 승선 대기·수속 1시간을 속도에 녹인다
    const speed = Math.max(5, Math.round(km / (f.hours + 1)));
    base.links.push({ a, b, len: Math.round(km * 100) / 100, mode: 0, cls: 'ferry', lanes: 2, speed, paved: 1, kp: 0, ext: typeof f.to === 'string' ? 1 : 0, name: `${f.name} 여객선`, geom: [x1, y1, x2, y2] });
  }
  base.airports = world.airports.map((a) => ({ ...a, country: a.kp ? 'KP' : 'KR' }))
    .concat(world.foreign.map((f) => ({ id: f.id, name: `${f.name} 공항`, lon: f.lon, lat: f.lat, cap: 60, intl: true, ext: 1, country: f.country })));
  return base;
}

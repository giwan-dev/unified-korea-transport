// 신설 계획에서 같은 종류의 운영 중 선로를 다시 짓지 않게 한다.
// 가상 운행 계통·도시철도 환승·공사 중·폐선 구간은 선로로 재사용하지 않는다.
import { Graph } from '../sim/graph.js';

const km = (a, b) => Math.hypot((a[0] - b[0]) * 88.4, (a[1] - b[1]) * 111);
const normalName = (name) => String(name || '').replace(/\s+/g, '').replace(/역$/, '');

function path(graph, from, to, costs) {
  graph.shortestPaths(from, costs);
  if (!Number.isFinite(graph.dist[to])) return null;
  const ids = [], nodes = [to];
  let node = to;
  while (graph.predEdge[node] >= 0) {
    const edge = graph.predEdge[node];
    ids.push(graph.edgeLink[edge]);
    node = graph.edgeFrom[edge]; nodes.push(node);
  }
  return { links: ids.reverse(), nodes: nodes.reverse() };
}

/** 서울–행신은 전용 고속선이 아닌 KTX 기존선 공용 구간이다. 속도·등급은 바꾸지 않는다. */
function sharedHighSpeedLinks(net, names, active) {
  const station = (name, hint) => names.filter(([n]) => normalName(n) === name)
    .sort((a, b) => km(net.nodes[a[1]], hint) - km(net.nodes[b[1]], hint))[0]?.[1];
  const from = station('서울', [126.9713, 37.5543]), to = station('행신', [126.8342, 37.6123]);
  if (from == null || to == null) return new Set();
  const g = new Graph(net.nodes.length, net.links.map((l) => l.a), net.links.map((l) => l.b),
    (i) => active(i) && net.links[i].mode === 1 && net.links[i].name === '경의선');
  const route = path(g, from, to, net.links.map((l) => Math.max(0.0001, l.len)));
  return new Set(route?.links || []);
}

export function findRailReuse(net, spec, points, names = []) {
  if (!(spec?.mode >= 1) || points.length < 2) return [];
  const count = net.physCount ?? net.links.length;
  const active = (i) => i < count && net.links[i].active !== false && net.links[i].built !== false
    && !net.links[i].replaced && !net.links[i].closed && !net.links[i].service && !net.links[i].ext;
  const shared = spec.attrs.cls === 'hsr' ? sharedHighSpeedLinks(net, names, active) : new Set();
  const compatible = (i) => {
    const link = net.links[i];
    if (!active(i) || link.mode !== spec.mode) return false;
    return link.cls === spec.attrs.cls || (spec.attrs.cls === 'hsr' && shared.has(i));
  };
  const graph = new Graph(net.nodes.length, net.links.map((l) => l.a), net.links.map((l) => l.b), compatible);
  const costs = net.links.map((l) => Math.max(0.0001, l.len));
  const named = new Map(names.map(([name, node]) => [node, normalName(name)]));
  const candidates = (point) => {
    const coordinate = [point.lon, point.lat], out = [];
    if (point.node != null && graph.offset[point.node + 1] > graph.offset[point.node]) out.push(point.node);
    const name = normalName(point.name || named.get(point.node));
    for (const [label, node] of names) {
      if (out.includes(node) || !net.nodes[node] || graph.offset[node + 1] === graph.offset[node]) continue;
      if ((name && normalName(label) === name && km(coordinate, net.nodes[node]) <= 0.6)
        || km(coordinate, net.nodes[node]) <= 0.05) out.push(node);
    }
    return out;
  };
  const stops = points.map((p, i) => i).filter((i) => !points[i].via || i === 0 || i === points.length - 1);
  const reused = [];
  for (let s = 0; s + 1 < stops.length; s++) {
    const fromIndex = stops[s], toIndex = stops[s + 1];
    const origins = candidates(points[fromIndex]), targets = candidates(points[toIndex]);
    if (!origins.length || !targets.length) continue;
    graph.shortestPaths(origins, costs);
    const to = targets.reduce((best, node) => graph.dist[node] < graph.dist[best] ? node : best);
    if (!Number.isFinite(graph.dist[to])) continue;
    const ids = [], nodes = [to]; let node = to;
    while (graph.predEdge[node] >= 0) {
      const edge = graph.predEdge[node]; ids.push(graph.edgeLink[edge]);
      node = graph.edgeFrom[edge]; nodes.push(node);
    }
    reused.push({ fromIndex, toIndex, links: ids.reverse(), nodes: nodes.reverse(),
      km: graph.dist[to], shared: ids.some((id) => shared.has(id)) });
  }
  return reused;
}

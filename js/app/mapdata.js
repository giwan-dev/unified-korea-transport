// 지도에 그릴 자료: 구간(linksFC)·교통량·역·공항, 행정 경계·이름·존 색칠.
import { splineLine } from '../game/curve.js';
import { kpPlaceText, PROPAGANDA_STEMS, regionOf } from '../game/local.js';
import { pShare, subValue } from '../game/sentiment.js';
import { isKP, linkAt, linkPending } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { colorFor, metricLevel, METRICS, paintHotspots, setExtraLabels, setLinks, setMixedZones, unitFeaturesIn } from '../ui/map.js';
import { railStd } from '../ui/railkind.js';
import {
  bridgeMainlineGaps, connectJunctions, flattenMainline, isNarrow, mainlineBubbles, mergeTwins, motorwayMainline, ROAD_RANK, roundMainlineCorners, smoothMainlineEnds,
  twinPrimary,
} from '../ui/traffic.js';
import { base, grid, happiness, historic, map, median, metric, result, state, subPop0, subsFC, zoneProps } from './core.js';
import { gains } from './year.js';
import { admin, adminCache, splitUnits, subNeighbors, subRegion, unitOfficeKey, unitPick, unitPop, unitRepZone } from './region.js';
import { stationRiders } from './svc.js';
import { countyRep, countyZones, mayorKey } from './election.js';
import { edgeLines, guUnits, unitZones } from './bungu.js';
import { drawGuMetric, GU_METRIC, GU_POP, officeParty, partyValue } from './firstyear.js';
import { effectiveGrid, inRing } from './housing.js';
import { extraOf, extraSubs, extrasOfParent, riPopOf, subXY } from './risplit.js';

// ------------------------------------------------------------ 지도 데이터

/** 기본 구간 + 새 구간 (돌려받은 배열은 고치지 말 것: 새 구간이 늘거나 바뀌기 전까지 같은 배열을 돌려준다) */
export let allLinksMemo = null;
export function allLinks() {
  const nl = state.newLinks, m = allLinksMemo;
  if (m && m.base === base.links && m.nl === nl && m.n === nl.length && m.last === nl[nl.length - 1]) return m.all;
  const all = base.links.concat(nl);
  allLinksMemo = { base: base.links, nl, n: nl.length, last: nl[nl.length - 1], all };
  return all;
}

// linkTwins: 링크마다 화면에 그리는 대표 링크 (같은 두 노드를 잇는 쌍), shownTraffic: 쌍을 합친 화면용 교통량·혼잡도
export let linkTwins = null, shownTraffic = null;
export let mainlineNext = new Map();   // 본선 조각 → [a 쪽 이웃 본선들, b 쪽 이웃 본선들]
export function linksFC() {
  const building = new Set();
  for (const p of state.projects) {
    if (p.status !== 'building') continue;
    if (p.kind === 'new') p.links.forEach((id) => building.add(id));
  }
  const all = allLinks();
  const pending = (i) => building.has(i) || (i < base.links.length && linkPending(base, state, i));
  // 같은 두 노드를 잇는 쌍은 하나만 그린다 (twinPrimary 참고)
  linkTwins = twinPrimary(all.map((l, i) => (state.replaced?.[i] || l.replaced ? null
    : (() => {
      const e = linkAt(base, state, i);
      // 도로는 등급이 달라도 묶는다 (여객선·국경 연결은 따로), 철도는 고속선·일반선을 따로
      const road = e.mode === 0 && e.cls !== 'ferry' && !e.ext;
      return { a: l.a, b: l.b, mode: e.mode, k: `${road ? 'road' : `${e.cls}:${e.ext ? 1 : 0}`}:${pending(i) ? 1 : 0}`, rank: road ? ROAD_RANK[e.cls] ?? 9 : 0 };
    })())));
  // 고속도로는 본선만 고속도로로 그리고, IC 연결로·접속도로는 일반도로(주요 도로 굵기)로, JC 연결로는 그리지 않는다 (JC가 사거리로 보이게)
  const mainEff = all.map((l, i) => (state.replaced?.[i] || l.replaced ? null : linkAt(base, state, i)));
  const mainline = motorwayMainline(mainEff, nodeCoord, (i) => i >= base.links.length);
  bridgeMainlineGaps(mainEff, mainline);   // 끊긴 본선 두 조각 사이의 짧은 일반도로 링크는 본선으로
  const features = all.map((l, i) => {
    const eff = linkAt(base, state, i);
    // 같은 역의 다른 노선 승강장을 잇는 환승 선로는 계산에만 쓰고 그리지 않는다 (서울역·용산역 주변이 지저분해진다)
    // 같은 두 노드를 잇는 쌍(대표만)·JC 연결로도 그리지 않는다
    if (state.replaced?.[i] || l.replaced || eff.name?.endsWith(' 환승') || linkTwins[i] !== i || mainline[i] === 2) {
      const p0 = [l.geom[0], l.geom[1]];   // 길이 0인 선: 그려지지 않는다
      return { type: 'Feature', id: i, properties: { id: i, mode: -1 }, geometry: { type: 'LineString', coordinates: [p0, p0] } };
    }
    const parts = smoothParts(l, i);
    return {
      type: 'Feature', id: i,
      properties: { id: i, mode: eff.mode, cls: eff.mode === 0 && mainline[i] === 1 ? 'motorway' : eff.cls === 'motorway' && eff.mode === 0 ? 'primary' : eff.cls, minor: eff.mode === 0 && eff.cls === 'secondary' && !eff.kp ? 1 : 0, building: pending(i) ? 1 : 0, colour: eff.colour || '', ext: eff.ext ? 1 : 0, narrow: isNarrow(eff) ? 1 : 0, rstd: railStd(eff) },
      geometry: parts.length > 1 ? { type: 'MultiLineString', coordinates: parts } : { type: 'LineString', coordinates: parts[0] },
    };
  });
  // 본선의 삐죽한 꺾임을 편다
  // 같은 이름 본선이 한 노드에서 갈라졌다 다른 한 노드에서 다시 만나는 상·하행 분리 구간은 한 갈래만 그린다
  const effAll = all.map((l, i) => (state.replaced?.[i] || l.replaced ? null : linkAt(base, state, i)));
  const bubbles = mainlineBubbles(effAll, mainline, (i) => effAll[i] && linkTwins[i] === i);
  for (const [h, to] of bubbles) {
    const p0 = [all[h].geom[0], all[h].geom[1]];
    features[h] = { type: 'Feature', id: h, properties: { id: h, mode: -1 }, geometry: { type: 'LineString', coordinates: [p0, p0] } };
  }
  if (bubbles.size) for (let j = 0; j < linkTwins.length; j++) if (bubbles.has(linkTwins[j])) linkTwins[j] = bubbles.get(linkTwins[j]);
  const linkEnds = (i) => ({ a: all[i].a, b: all[i].b, pa: nodeCoord(all[i].a), name: linkAt(base, state, i).name });
  flattenMainline(features, mainline, linkEnds);
  // JC 연결로를 숨긴 자리: 다른 고속도로에 붙어 끝나는 본선 끝을 상대 본선까지 잇는다 (T자·사거리)
  connectJunctions(features, mainline, linkEnds);
  smoothMainlineEnds(features, mainline);
  // 이음매·꺾인 점을 둥글게 (노드–노드 곡선이 짧은 구간에서 꺾이는 곳). 짧은 조각은 양 끝 이음매를 함께 깎으면
  // 한쪽이 먼저 바뀌어 다른 쪽 이음매를 놓치므로 한 번 더 돈다
  for (let t = 0; t < 2; t++) roundMainlineCorners(features, mainline);
  // 본선 조각마다 양 끝 노드에서 이어지는 본선 조각 (교통량 0 토막 메우기용, paintVolumes)
  const mainAt = new Map();
  features.forEach((f) => { if (mainline[f.id] === 1 && f.properties.mode === 0) for (const nd of [all[f.id].a, all[f.id].b]) { if (!mainAt.has(nd)) mainAt.set(nd, []); mainAt.get(nd).push(f.id); } });
  mainlineNext = new Map();
  for (const ids of mainAt.values()) for (const i of ids) { if (!mainlineNext.has(i)) mainlineNext.set(i, []); mainlineNext.get(i).push(ids.filter((j) => j !== i)); }
  return { type: 'FeatureCollection', features };
}

/**
 * 한 구간 안에서 나란히 달리는 조각(왕복 분리 도로의 두 차도, 복선의 두 선로처럼 따로 그려진 선)은 하나만 남긴다.
 * 긴 조각부터 남기고, 점 대부분이 이미 남긴 조각에서 60m 안에 있는 조각은 버린다 (두 줄로 겹쳐 보이지 않게)
 */
export function dropParallel(parts) {
  if (parts.length < 2) return parts;
  const lenOf = (p) => p.reduce((s, q, k) => (k ? s + Math.hypot((q[0] - p[k - 1][0]) * 0.8, q[1] - p[k - 1][1]) : 0), 0);
  const sorted = parts.map((p) => [p, lenOf(p)]).sort((x, y) => y[1] - x[1]).map(([p]) => p);
  const kept = [];
  const TOL = 0.0006;   // 약 60m
  const nearKept = (q) => kept.some((p) => {
    for (let k = 0; k + 1 < p.length; k++) {
      const [x1, y1] = p[k], [x2, y2] = p[k + 1];
      const dx = (x2 - x1) * 0.8, dy = y2 - y1, L = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, (((q[0] - x1) * 0.8) * dx + (q[1] - y1) * dy) / L));
      if (Math.hypot((q[0] - x1) * 0.8 - t * dx, q[1] - y1 - t * dy) < TOL) return true;
    }
    return false;
  });
  for (const p of sorted) {
    const step = Math.max(1, Math.floor(p.length / 8));
    let n = 0, near = 0;
    for (let k = 0; k < p.length; k += step) { n++; if (nearKept(p[k])) near++; }
    if (!kept.length || near < n * 0.7) kept.push(p);
  }
  return kept;
}

/** 화면용 도형: 노드와 노드 사이를 모든 점을 지나는 곡선으로 (양 끝은 노드에 그대로).
 *  노드에서는 곧게 이어지는 같은 수단 구간의 점을 앞뒤 제어점으로 써서 구간 사이도 꺾이지 않게 한다.
 *  기본 구간은 한 번만 계산해 둔다 */
export const smoothCache = new Map();
export let nodeAdj = null;

/** 노드 n에서 링크 i가 곧게 이어지는(120° 넘게 펴진) 같은 수단 링크의, 노드 바로 너머 점 */
export function beyondPoint(i, l, n, inward) {
  const link = (k) => (k < base.links.length ? base.links[k] : state.newLinks[k - base.links.length]);
  if (!nodeAdj) {
    nodeAdj = new Map();
    allLinks().forEach((x, k) => {
      if (x.ext) return;
      for (const m of [x.a, x.b]) { if (!nodeAdj.has(m)) nodeAdj.set(m, []); nodeAdj.get(m).push(k); }
    });
  }
  const c = nodeCoord(n);
  if (!c) return null;
  const dir = (q) => [(q[0] - c[0]) * 0.8, q[1] - c[1]];
  const v = dir(inward), vl = Math.hypot(...v);
  if (!vl) return null;
  let best = null, bc = -0.5;
  for (const k of nodeAdj.get(n) || []) {
    if (k === i) continue;
    const x = link(k);   // allLinks()는 배열을 새로 만들어 여기서 부르면 너무 느리다
    if (!x || x.mode !== l.mode || x.cls === 'ferry') continue;
    const q = nextVertex(x.geom, c);
    if (!q) continue;
    const w = dir(q), wl = Math.hypot(...w);
    const cos = wl ? (v[0] * w[0] + v[1] * w[1]) / (vl * wl) : 0;
    if (cos < bc) { bc = cos; best = q; }
  }
  return best;
}

/** 도형에서 점 c에 가까운 끝의 바로 다음 점 (20m 안의 점은 건너뛴다) */
export function nextVertex(g, c) {
  if (!g || g.length < 4 || Number.isNaN(g[0])) return null;
  const n = g.length / 2;
  const at = (k) => [g[2 * k], g[2 * k + 1]];
  const d = (q) => kmBetween(q[0], q[1], c[0], c[1]);
  const fromStart = d(at(0)) <= d(at(n - 1));
  for (let s = 1; s < n; s++) {
    const q = at(fromStart ? s : n - 1 - s);
    if (Number.isNaN(q[0])) return null;
    if (d(q) > 0.02) return q;
  }
  return null;
}
/**
 * 지도 강조: 이름을 고치는 그리기 중인 역(점), 개량할 구간(선: '같은 이름 노선 전체'를 고르면 그 노선 모두).
 * 인자 없이 부르면 지운다
 */
export function setHighlight({ point = null, links = [] } = {}) {
  if (!map?.getSource('links')) return;
  if (!map.getSource('hl')) {
    map.addSource('hl', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'hl-line', type: 'line', source: 'hl', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff3d7f', 'line-width': 8, 'line-opacity': 0.5 } });
    map.addLayer({ id: 'hl-point', type: 'circle', source: 'hl', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 12, 'circle-color': 'rgba(255,61,127,0.2)', 'circle-stroke-color': '#ff3d7f', 'circle-stroke-width': 3 } });
  }
  const feats = [];
  if (point) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } });
  const all = allLinks();
  for (const id of links) {
    const g = all[id]?.geom;
    if (!g) continue;
    let cur = [];
    for (let k = 0; k <= g.length; k += 2) {
      if (k === g.length || Number.isNaN(g[k])) { if (cur.length > 1) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: cur } }); cur = []; }
      else cur.push([g[k], g[k + 1]]);
    }
  }
  map.getSource('hl').setData({ type: 'FeatureCollection', features: feats });
  if (map.getLayer('hl-line')) { map.moveLayer('hl-line'); map.moveLayer('hl-point'); }
}

/** 강조한 점이 화면 밖이면 그쪽으로 옮긴다 */
export function showPointOnMap(c) {
  const b = map.getBounds();
  if (!b.contains(c)) map.easeTo({ center: c, duration: 400 });
}

export function smoothParts(l, i) {
  if (i < base.links.length && smoothCache.has(i)) return smoothCache.get(i);
  const g = l.geom;
  let parts = [[]];
  for (let k = 0; k < g.length; k += 2) {
    if (Number.isNaN(g[k])) parts.push([]);
    else parts[parts.length - 1].push([g[k], g[k + 1]]);
  }
  parts = dropParallel(parts.filter((p) => p.length > 1));
  // 도형 끝을 노드에 잇는다: 계산망 노드는 격자 칸의 교차점 좌표라 OSM 도형 끝과 떨어져 있을 수 있다.
  // 이웃 구간도 같은 노드로 이어지므로 선이 끊겨 보이지 않는다. 조각 사이 빈틈(500m 안)도 짧게 잇는다
  const pts = parts.filter((p) => p.length);
  if (pts.length && l.a != null && l.b != null) {
    const A = nodeCoord(l.a), B = nodeCoord(l.b);
    const d2 = (p, q) => ((p[0] - q[0]) * 0.8) ** 2 + (p[1] - q[1]) ** 2;
    const ends = pts.flatMap((p) => [p[0], p[p.length - 1]]);
    const near = (q) => ends.reduce((best, e) => (d2(e, q) < d2(best, q) ? e : best), ends[0]);
    const link = [];
    // 600m(≈ 0.0054도)보다 먼 끝은 잇지 않는다: 엉뚱한 곳을 가로지르는 선이 생기지 않게
    if (A) { const e = near(A); if (d2(e, A) > 2.5e-7 && d2(e, A) < 2.9e-5) link.push([A, e]); }
    if (B) { const e = near(B); if (d2(e, B) > 2.5e-7 && d2(e, B) < 2.9e-5) link.push([e, B]); }
    if (pts.length > 1) {
      const verts = pts.map((p, k) => p.map((v) => [v, k])).flat();
      pts.forEach((p, k) => {
        for (const e of [p[0], p[p.length - 1]]) {
          if ((A && d2(e, A) < 1e-7) || (B && d2(e, B) < 1e-7)) continue;
          let best = null, bd = Infinity;
          for (const [v, kk] of verts) { if (kk === k) continue; const dd = d2(v, e); if (dd < bd) { bd = dd; best = v; } }
          if (best && bd > 1e-9 && bd < 2.5e-5) link.push([e, best]);
        }
      });
    }
    parts.push(...link);
  }
  // 한 조각으로 이어진 보통 구간: 노드–노드 곡선 (앞뒤 구간과 매끄럽게 이어진다)
  const single = parts.filter((p) => p.length > 1);
  if (single.length === 1 && l.a != null && l.b != null && l.cls !== 'ferry' && !l.ext) {
    const p = single[0];
    const A = nodeCoord(l.a), B = nodeCoord(l.b);
    const startsAtA = A && kmBetween(p[0][0], p[0][1], A[0], A[1]) <= kmBetween(p[p.length - 1][0], p[p.length - 1][1], A[0], A[1]);
    const line = startsAtA ? p : [...p].reverse();
    const before = A && line.length > 1 ? beyondPoint(i, l, l.a, line[1]) : null;
    const after = B && line.length > 1 ? beyondPoint(i, l, l.b, line[line.length - 2]) : null;
    const out = [splineLine(line, before, after).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])];
    if (i < base.links.length) smoothCache.set(i, out);
    return out;
  }
  const out = parts.filter((p) => p.length > 1).map((p) => {
    if (p.length < 3) return p;
    const q = [p[0]];
    for (let k = 0; k + 1 < p.length; k++) {
      const [x0, y0] = p[k], [x1, y1] = p[k + 1];
      if (k) q.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      if (k + 2 < p.length) q.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    q.push(p[p.length - 1]);
    return q.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
  });
  if (i < base.links.length) smoothCache.set(i, out);
  return out;
}

export function refreshLinks() {
  nodeAdj = null;   // 새 구간이 생기면 노드에서 곧게 이어지는 구간이 바뀐다
  setLinks(map, linksFC());
  if (result) paintVolumes();
}

/** 지도에 교통량·혼잡도를 칠한다. 같은 두 노드를 잇는 쌍(분리 차로·복선)은 대표 링크 하나에 합쳐 칠한다 */
export function paintVolumes() {
  const m = shownTraffic = mergeTwins(linkTwins || twinPrimary([]), result.links.vc, result.links.vol);
  // 교통량이 있는 본선 사이에 낀 0 조각: 노선망에서 같은 두 노드를 잇는 옆 일반도로 등으로 교통이 새는 곳(데이터 결함)이라
  // 지도에는 양옆 본선 가운데 작은 값을 보여 준다 (본선이 회색 토막으로 끊겨 보이지 않게)
  for (const [i, sides] of mainlineNext) {
    if (m.vol[i] > 0 || sides.length !== 2) continue;
    const side = sides.map((ids) => ids.filter((j) => m.vol[j] > 0));
    if (side.some((ids) => !ids.length)) continue;
    const pick = side.map((ids) => ids.reduce((b, j) => (m.vol[j] > m.vol[b] ? j : b), ids[0]));
    const k = m.vol[pick[0]] <= m.vol[pick[1]] ? pick[0] : pick[1];
    m.vol[i] = m.vol[k]; m.vc[i] = m.vc[k];
  }
  for (let i = 0; i < m.vc.length; i++) map.setFeatureState({ source: 'links', id: i }, { vc: m.vc[i], vol: m.vol[i] });
  paintHotspots(map, m.vc);
}

export function nodeCoord(id) {
  return id < base.nodes.length ? base.nodes[id] : state.newNodes[id - base.nodes.length];
}

/** 노드 id → {name, kind, isNew} (사용자가 바꾼 이름이 우선) */
/** 문을 닫은 역이라도 원래 이름 (고시·노선도에 번호 대신 쓴다) */
export function anyStationName(n) {
  const raw = base.stations.find((s) => s[1] === n)?.[0] || (base.metro_stations || []).find((s) => s[1] === n)?.[0];
  return state.names?.[n]?.name || (raw ? shownStation(raw, n) : null);
}

/** 지금 북측 지명에 적용할 선전용 지명 짝: 행정구역 정리로 되돌렸으면 모두, 아니면 옛 이름 되찾기를 마친 곳만 */
export function propagandaPairs() {
  if (state.local?.admin?.propaganda === 'restore') return PROPAGANDA_STEMS;
  const strip = (n) => n.replace(/(군|시|읍)$/, '');
  return historic.filter((t) => state.placeNames?.[`${t.level === 'zone' ? 'z' : 'u'}:${t.id}`] === t.historic).map((t) => [strip(t.current), strip(t.historic)]);
}

export let kpNames = { sig: null };
/** 행정구역 정리·옛 이름 되찾기를 북측 지명에 적용하는 표 (설정이 바뀌면 다시 만든다) */
export function kpNameTable() {
  const sig = JSON.stringify([state.local?.admin, state.placeNames]);
  if (kpNames.sig !== sig) kpNames = { sig, pairs: propagandaPairs(), memo: new Map() };
  return kpNames;
}

/** 북측 지명 한 개에 행정구역 정리를 적용 (남측 지점은 그대로). station: 역 이름 ('…청년' 꼬리도 뗀다) */
export function kpFix(name, lon, lat, station = false) {
  if (!name || !isKP(lat, lon)) return name;
  const t = kpNameTable();
  return kpPlaceText(state.local?.admin, name, t.pairs, station);
}

/**
 * 기존 역의 보이는 이름: 북측 역은 행정구역 정리(선전용 지명 되돌리기·노동자구 폐지·두음법칙)를 따른다 (김책역 → 성진역, 사리원청년역 → 사리원역).
 * 자료의 원래 이름(base.stations)은 계획 노선·운행 계통을 맞출 때 그대로 쓴다
 */
export function shownStation(name, node) {
  const t = kpNameTable(), k = `${node}|${name}`;
  let v = t.memo.get(k);
  if (v === undefined) {
    const c = base.nodes[node];
    v = c ? kpFix(name, c[0], c[1], true) : name;
    t.memo.set(k, v);
  }
  return v;
}

/** 닿은 철도·도시철도 구간이 모두 폐선된(직선화로 걷어 낸) 역 노드 */
export function retiredStationNodes() {
  const live = new Set(), dead = new Set();
  allLinks().forEach((l, i) => {
    if (l.mode !== 1 && l.mode !== 2) return;
    const gone = i < base.links.length ? !!state.replaced?.[i] : !!l.replaced;
    for (const n of [l.a, l.b]) (gone ? dead : live).add(n);
  });
  for (const n of live) dead.delete(n);
  return dead;
}

export function nodeNames() {
  const out = new Map();
  const closed = new Set(state.closedStations || []);
  for (const n of retiredStationNodes()) closed.add(n);
  for (const [name, node] of base.stations) if (!out.has(node) && !closed.has(node)) out.set(node, { name: shownStation(name, node), kind: 'station', isNew: 0 });
  for (const [name, node] of base.metro_stations || []) if (!out.has(node) && !closed.has(node)) out.set(node, { name: shownStation(name, node), kind: 'station', isNew: 0, metro: 1 });
  const restGone = new Set(state.restRemoved || []);
  for (const [name, node] of base.junctions) {
    if (out.has(node) || restGone.has(node)) continue;
    out.set(node, { name, kind: /JCT|분기점/.test(name) ? 'JCT' : /휴게소|졸음쉼터|SA$/.test(name) ? 'rest' : 'IC', isNew: 0 });
  }
  for (const f of base.foreignNodes || []) out.set(f.node, { name: f.name, kind: 'city', isNew: 0, country: f.country });
  // 도로 없는 섬의 항구(독도): 어느 축척에서나 보이게 도시처럼 둔다
  for (const [name, node] of base.ports || []) out.set(node, { name, kind: 'city', isNew: 0 });
  // 문을 닫은 역(직선화로 옮기거나 폐역한 옛 역)은 이름을 바꿨어도 지도에 그리지 않는다
  for (const [k, v] of Object.entries(state.names)) if (!(v.kind === 'station' && closed.has(+k))) out.set(+k, { name: v.name, kind: v.kind, isNew: 1 });
  (state.restAreas || []).forEach((r, i) => !r.removed && out.set(`rest${i}`, { name: r.name + (r.built ? '' : ' (공사 중)'), kind: 'rest', isNew: 1, coord: [r.lon, r.lat] }));
  return out;
}

/** 점의 중요도: 0 도시·새 시설, 1 큰 역(고속철도역·이용 많은 역), 2 일반 역·JCT·휴게소, 3 IC·도시철도역 */
export function pointRank(node, v, hsrNodes, riders, railNodes) {
  if (v.kind === 'city') return 0;
  if (v.kind === 'station') {
    // 도시철도역(새로 놓은 역 포함: 철도 선로가 닿지 않는 역)은 확대해야 보인다. 축소하면 점이 너무 많다
    if (v.metro || !railNodes.has(node)) return 3;
    if (v.isNew) return 1;
    return hsrNodes.has(node) || (riders.get(node) || 0) >= 8000 ? 1 : 2;
  }
  if (v.isNew) return v.kind === 'rest' ? 2 : 1;
  if (v.kind === 'JCT' || v.kind === 'rest') return 2;
  return 3;
}

export function refreshPoints() {
  const features = [];
  const hsrNodes = new Set();
  const railNodes = new Set();
  for (const l of allLinks()) {
    if (l.mode !== 1 || l.replaced) continue;
    railNodes.add(l.a); railNodes.add(l.b);
    if (l.cls === 'hsr') { hsrNodes.add(l.a); hsrNodes.add(l.b); }
  }
  const pointTypes = new Map();
  for (const [id] of allLinks().entries()) {
    const l = linkAt(base, state, id);
    if (state.replaced?.[id] || (id < base.links.length && linkPending(base, state, id))) continue;
    const key = l.mode === 0 ? (l.cls === 'motorway' ? 'motorway' : 'road') : l.mode === 2 ? 'metro' : l.cls === 'hsr' ? 'hsr' : isNarrow(l) ? 'narrow' : 'rail';
    for (const node of [l.a, l.b]) {
      if (!pointTypes.has(node)) pointTypes.set(node, {});
      pointTypes.get(node)[`show_${key}`] = true;
    }
  }
  const riders = stationRiders();
  for (const [node, v] of nodeNames()) {
    const c = v.coord || nodeCoord(node);
    if (!c) continue;
    const types = pointTypes.get(node) || (v.kind === 'station' ? { [v.metro ? 'show_metro' : 'show_rail']: true } : { show_motorway: true });
    features.push({ type: 'Feature', properties: { node, ...v, ...types, rank: pointRank(node, v, hsrNodes, riders, railNodes) }, geometry: { type: 'Point', coordinates: c } });
  }
  // 한 역의 노선별 노드(수서: SRT·3호선·수인분당선)는 지도에 점 하나만: 같은 이름이 600m 안이면 가장 중요한(순위가 높은) 점만 남긴다
  features.sort((a, b) => a.properties.rank - b.properties.rank);
  const shown = new Map(), kept = [];
  for (const f of features) {
    const p = f.properties, [x, y] = f.geometry.coordinates;
    const same = p.kind === 'station' ? (shown.get(p.name) || []) : [];
    const duplicate = same.find((other) => kmBetween(...other.geometry.coordinates, x, y) < 0.6);
    if (duplicate) {
      for (const key of Object.keys(p)) if (key.startsWith('show_') && p[key]) duplicate.properties[key] = true;
      continue;
    }
    if (p.kind === 'station') shown.set(p.name, [...same, f]);
    kept.push(f);
  }
  map.getSource('points').setData({ type: 'FeatureCollection', features: kept });
}

/** 인구 밀도 격자 레이어 (처음 켤 때 한 번 만든다) */
export function showDensity(on) {
  map.setLayoutProperty('grid-heat', 'visibility', on ? 'visible' : 'none');
  const grid = effectiveGrid();
  if (!on || map.__gridLoaded === grid) return;
  const features = [];
  for (let k = 0; k < grid.length; k += 4) {
    if (grid[k + 2] < 200) continue;
    features.push({ type: 'Feature', properties: { p: grid[k + 2] }, geometry: { type: 'Point', coordinates: [grid[k], grid[k + 1]] } });
  }
  map.getSource('grid').setData({ type: 'FeatureCollection', features });
  map.__gridLoaded = grid;   // 입주로 격자가 바뀌면 다시 그린다
}

/**
 * 광역지자체(특별·광역시, 도; 북측 도 복원·광역시 승격 반영)별 인구: 이름 → { pop, pop0(시작), country, zones }.
 * 국외 존은 뺀다
 */
export function provincePops() {
  const out = new Map();
  if (!result) return out;
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    const k = regionOf(state, z);
    const e = out.get(k) || { pop: 0, pop0: 0, country: z.country, zones: [] };
    e.pop += result.zones.pop[i]; e.pop0 += Math.max(z.pop, 0); e.zones.push(i);
    out.set(k, e);
  });
  // 읍면동 단위로 다시 센다 (광역시·다른 도로 편입한 읍면동, 새로 세운 시군): 소속표가 있으면
  const a = admin();
  if (a) for (const [r, e] of a.regionPops()) { const o = out.get(r); if (o) { o.pop = e.pop; o.pop0 = e.pop0; } }
  return out;
}

export function drawAnnexedSubs() { drawAdmin(); }

/**
 * 소속표 그리기: 소속이 바뀐 읍면동이 있는 존(편입·시군구 신설)은 존 경계 대신 읍면동 경계로 시군 경계를 긋고, 새 시군 이름을 단다.
 * 색칠(paintZones)도 그 존은 읍면동마다 그 시군 값으로. 자세한 읍면동 경계(행정동 파일)가 있으면 그것으로, 없으면 계산용 경계로
 */
export let adminLineCache = null, adminFine = new Map(), adminLabels = [];
export async function drawAdmin() {
  if (!map || !subsFC) return;
  const a = admin();
  if (!a) return;
  if (!map.getSource('admin-lines')) {
    map.addSource('admin-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'admin-lines', type: 'line', source: 'admin-lines', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#686d74', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.9, 12, 1.6], 'line-opacity': 0.8 } },
      map.getLayer('zones-sel-edge') ? 'zones-sel-edge' : undefined);
    // 소속이 섞인 존 둘레의 광역 경계 (도 경계 bg-sido와 같은 모양): bg-sido는 그 존에 닿은 조각을 긋지 않는다
    map.addSource('admin-region-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'admin-region-lines', type: 'line', source: 'admin-region-lines', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': map.getPaintProperty('bg-sido', 'line-color') || '#888', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 10, 3.2] } },
      map.getLayer('zones-sel-edge') ? 'zones-sel-edge' : undefined);
  }
  const mixed = [...a.mixed];
  setMixedZones(map, mixed);
  const sig = adminCache?.sig;
  if (adminLineCache?.sig !== sig) {
    // 자세한 경계: 그 존들 둘레의 행정동 파일
    const pts = mixed.flatMap((z) => zoneProps[z].subs);
    let fine = [];
    if (pts.length) {
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      fine = await unitFeaturesIn(map, Math.min(...xs) - 0.1, Math.min(...ys) - 0.1, Math.max(...xs) + 0.1, Math.max(...ys) + 0.1);
    }
    const mset = new Set(mixed);
    // 곁 읍면동: 섞인 존 읍면동과 맞닿은 다른 존의 읍면동 (존 경계 조각을 긋지 않으므로 그 둘레 시군·광역 경계도 여기서 긋는다)
    const side = new Set();
    for (const z of mixed) for (const i of a.subsOfZone(z)) for (const j of subNeighbors(i)) if (!mset.has(subInfo(j)[0])) side.add(j);
    const items = [], have = new Set();
    for (const f of fine) {
      const i = f.properties.id;
      if (!Number.isInteger(i) || have.has(i) || !(mset.has(subInfo(i)[0]) || side.has(i))) continue;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      items.push({ key: a.unitOfSub[i], polys, sub: i, need: !side.has(i) });
      have.add(i);
    }
    for (const i of [...mixed.flatMap((z) => a.subsOfZone(z)), ...side]) {
      if (have.has(i)) continue;
      have.add(i);
      const g = subsFC.features[i]?.geometry;
      if (g) items.push({ key: a.unitOfSub[i], polys: g.type === 'Polygon' ? [g.coordinates] : g.coordinates, sub: i, need: !side.has(i) });
    }
    adminFine = new Map();
    for (const it of items) if (it.need) { if (!adminFine.has(it.sub)) adminFine.set(it.sub, []); adminFine.get(it.sub).push(...it.polys); }
    const asLines = (ls) => ls.map((line) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }));
    const lines = items.length ? asLines(edgeLines(items, 'between', { needOnly: true })) : [];
    const regionLines = items.length ? asLines(edgeLines(items.map((it) => ({ ...it, key: subRegion(it.sub) })), 'between', { needOnly: true })) : [];
    // 떼어 낸 리는 원래 읍면동과 경계 꼭짓점을 같이 쓰지 않아 위에서 잡히지 않는다: 소속 시군이 다르면 리 경계를 긋는다
    for (const e of extraSubs) {
      if (a.unitOfSub[e.g] === a.unitOfSub[e.parent]) continue;
      const g = e.feature.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      const to = subRegion(e.g) !== subRegion(e.parent) ? regionLines : lines;
      for (const pg of polys) to.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pg[0] } });
    }
    adminLineCache = { sig, lines, regionLines };
  }
  map.getSource('admin-lines').setData({ type: 'FeatureCollection', features: adminLineCache.lines });
  map.getSource('admin-region-lines').setData({ type: 'FeatureCollection', features: adminLineCache.regionLines });
  // 새 시군 이름 (시군 이름과 같은 모양): 그 읍면동들 가운데 (인구 가중)
  adminLabels = splitUnits().map((u) => {
    const w = u.subs.map((i) => Math.max(1, result ? result.subs.pop[i] : 1)), W = w.reduce((x, y) => x + y, 0);
    const c = u.subs.map((i) => subXY(i));
    return { type: 'Feature', properties: { name: u.name }, geometry: { type: 'Point', coordinates: [c.reduce((t, q, n) => t + q[0] * w[n], 0) / W, c.reduce((t, q, n) => t + q[1] * w[n], 0) / W] } };
  });
  // 새 시군 이름은 따로 맨 위 층에 (역·IC 이름에 밀려 안 보이지 않게, 시군 이름 모양으로)
  if (!map.getSource('admin-labels')) {
    map.addSource('admin-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'admin-labels', type: 'symbol', source: 'admin-labels', minzoom: 7,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#3d434a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } });
  }
  map.getSource('admin-labels').setData({ type: 'FeatureCollection', features: adminLabels });
  if (result) paintZones();
}

/** 시군 이름 밖에 더 다는 이름: 분구한 구 + 새로 세운 시군 */
export let bunguLabels = [];
export function setBunguLabels(v) { return (bunguLabels = v); }
export function pushExtraLabels() { if (map) setExtraLabels(map, bunguLabels); }

/** 소속이 바뀐 존 색칠: 읍면동마다 그 시군의 값으로 (paintZones가 존 값 vals를 넘긴다) */
export function drawAdminFill(vals) {
  const a = admin();
  if (!a || !map) return;
  if (!map.getSource('admin-fill')) {
    map.addSource('admin-fill', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'admin-fill', type: 'fill', source: 'admin-fill', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55, 'fill-antialias': false } },
      map.getLayer('zones-line') ? 'zones-line' : undefined);
  }
  map.setPaintProperty('admin-fill', 'fill-opacity', map.getPaintProperty('zones-fill', 'fill-opacity') ?? 0.55);
  const feats = [];
  if (vals && !METRICS[metric]?.sub) {
    const colorOf = new Map();
    for (const z of a.mixed) for (const i of a.subsOfZone(z)) {
      const u = a.unitOfSub[i];
      if (!colorOf.has(u)) { const v = unitMetric(u, vals); colorOf.set(u, v == null ? 'rgba(0,0,0,0)' : colorFor(metric, v)); }
      const polys = adminFine.get(i) || (() => { const g = subsFC.features[i]?.geometry; return g ? (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) : []; })();
      for (const pg of polys) feats.push({ type: 'Feature', properties: { color: colorOf.get(u), unit: u }, geometry: { type: 'Polygon', coordinates: pg } });
    }
  }
  map.getSource('admin-fill').setData({ type: 'FeatureCollection', features: feats });
}

export var lastRegionVal = null;   // 광역 층위 지표의 광역 단체 값 (paintZones가 채운다)

// ---- 남측 법정리 (data/kr_ri.json, data/admin/ri/*.geojson — pipeline/build_kr_ri.py)
// 남측 계산 단위는 읍면동이라, 읍·면 안의 법정리는 읍면동 인구를 1km 인구 격자로 나눈 몫으로 센다 (리 인구 = 읍면동 인구 × 몫)
export var krRi = null;          // {읍면동 번호: [[리 이름, 몫, 법정리 코드, 파일 번호], ...]}
export var riCodeMap = null;     // 법정리 코드 → {name, share, sub, file}
export let riIndex = null;
export const riFiles = new Map(), riFeat = new Map();   // 받은 시도 파일, 코드 → 경계 (properties.area: km²)
/** kr_ri.json을 받으면 풀리는 약속 (리 편입을 저장한 게임은 계산 워커를 띄우기 전에 기다린다) */
export const krRiReady = fetch('data/kr_ri.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
  krRi = d?.subs || null;
  riCodeMap = new Map();
  for (const [sub, rows] of Object.entries(krRi || {})) for (const [name, share, code, file] of rows) riCodeMap.set(code, { name, share, sub: +sub, file });
}).catch(() => {});

/** 경위도 다각형 넓이 (km², 평면 어림) */
export function polyAreaKm2(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let a = 0;
  for (const pg of polys) pg.forEach((ring, k) => {
    let t = 0;
    for (let j = 0, n = ring.length - 1; j < n; j++) t += ring[j][0] * ring[j + 1][1] - ring[j + 1][0] * ring[j][1];
    const c = Math.cos((ring[0][1] * Math.PI) / 180);
    a += (k ? -1 : 1) * Math.abs(t / 2) * 111.32 * 111.32 * c;
  });
  return Math.max(a, 0);
}

/** 이 범위의 시도 리 경계를 받는다 */
export async function loadRiFiles(x0, y0, x1, y1) {
  if (!riIndex) riIndex = await fetch('data/admin/ri/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const need = riIndex.filter(({ bbox: [a, b, c, d] }) => c >= x0 && a <= x1 && d >= y0 && b <= y1 && !riFiles.has(e2f(a, b, c, d)));
  function e2f(a, b, c, d) { return riIndex.find((e) => e.bbox[0] === a && e.bbox[1] === b && e.bbox[2] === c && e.bbox[3] === d)?.file; }
  await Promise.all(need.map(async (e) => {
    const fc = await fetch(`data/admin/ri/${e.file}`).then((r) => r.json()).catch(() => null);
    if (!fc) return;
    for (const f of fc.features) { f.properties.area = polyAreaKm2(f.geometry); riFeat.set(f.properties.code, f); }
    riFiles.set(e.file, fc.features);
  }));
  return need.length;
}

/** 리 추정 인구 */
export function riPop(code) { return riPopOf(code); }

/** 누른 자리의 법정리 코드 (그 읍면동 안, 경계를 받은 뒤) */
export async function riAt(ll, sub) {
  await loadRiFiles(ll.lng - 0.05, ll.lat - 0.05, ll.lng + 0.05, ll.lat + 0.05);
  for (const [, , code] of krRi?.[sub] || []) {
    const g = riFeat.get(code)?.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    if (polys.some((pg) => inRing(ll.lng, ll.lat, pg[0]) && !pg.slice(1).some((h) => inRing(ll.lng, ll.lat, h)))) return code;
  }
  return null;
}

/** 리 층위 지도: 남측 리마다 칠하고 경계를 긋는다 (화면에 든 시도 파일만 받는다) */
export let riMoveHooked = false;
export async function drawRiLayer() {
  if (!map) return;
  if (!map.getSource('kr-ri')) {
    map.addSource('kr-ri', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const before = map.getLayer('zones-line') ? 'zones-line' : undefined;
    map.addLayer({ id: 'kr-ri-fill', type: 'fill', source: 'kr-ri', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55 } }, before);
    map.addLayer({ id: 'kr-ri-line', type: 'line', source: 'kr-ri', minzoom: 8, paint: { 'line-color': '#7a7f86', 'line-width': 0.4, 'line-opacity': 0.6 } }, before);
    map.addLayer({ id: 'kr-ri-sel', type: 'line', source: 'kr-ri', filter: ['==', ['get', 'code'], ''], paint: { 'line-color': '#1d4e89', 'line-width': 2.2 } });
  }
  if (!riMoveHooked) { riMoveHooked = true; let t = 0; map.on('moveend', () => { clearTimeout(t); t = setTimeout(drawRiLayer, 300); }); }
  if (metricLevel(metric) !== 'ri' || !METRICS[metric]?.sub || map.getZoom() < 8.5 || !krRi || !result) { map.getSource('kr-ri').setData({ type: 'FeatureCollection', features: [] }); return; }
  const b = map.getBounds();
  await loadRiFiles(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
  const s0 = result.subs, feats = [];
  for (const fs of riFiles.values()) for (const f of fs) {
    const { code, sub, area } = f.properties, r = riCodeMap.get(code);
    if (!r) continue;
    const p = riPopOf(code, s0.pop);
    const v = metric === 'subPop' ? p : metric === 'subDensity' ? p / Math.max(area, 0.01) : metric === 'subChange' ? s0.pop[sub] / Math.max(subPop0[sub], 1) - 1
      : metric === 'subTransit' ? s0.transit[sub] : subMetric(metric, sub);
    feats.push({ type: 'Feature', properties: { code, color: v == null ? 'rgba(0,0,0,0)' : colorFor(metric, v) }, geometry: f.geometry });
  }
  map.getSource('kr-ri').setData({ type: 'FeatureCollection', features: feats });
}

/** 읍면동 층위의 읍면동 경계: 화면에 든 존마다 읍면동(북측은 면)끼리 맞닿는 선. 존마다 기억해 둔다 */
export const emdLineCache = new Map();
export let emdMoveHooked = false;
export function drawEmdLines() {
  if (!map || !subsFC) return;
  if (!map.getSource('emd-lines')) {
    map.addSource('emd-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'emd-lines', type: 'line', source: 'emd-lines', minzoom: 7.5, layout: { 'line-join': 'round' },
      paint: { 'line-color': '#8a8f96', 'line-width': 0.5, 'line-opacity': 0.55 } }, map.getLayer('zones-line') ? 'zones-line' : undefined);
  }
  if (!emdMoveHooked) { emdMoveHooked = true; let t = 0; map.on('moveend', () => { clearTimeout(t); t = setTimeout(drawEmdLines, 250); }); }
  const a = admin();
  if (metricLevel(metric) !== 'emd' || map.getZoom() < 7.5 || !a) { map.getSource('emd-lines').setData({ type: 'FeatureCollection', features: [] }); return; }
  const sig = adminCache?.sig || '';
  const b = map.getBounds(), feats = [];
  zoneProps.forEach((q, z) => {
    if (q.ext || !q.subs.some(([x, y]) => x >= b.getWest() - 0.1 && x <= b.getEast() + 0.1 && y >= b.getSouth() - 0.1 && y <= b.getNorth() + 0.1)) return;
    let c = emdLineCache.get(z);
    if (c?.sig !== sig) {
      const items = [];
      for (let k = 0; k < q.subs.length; k++) {
        const i = q.sub0 + k, g = subsFC.features[i]?.geometry;
        if (g) items.push({ key: a.emdOf[i] || `s:${i}`, polys: g.type === 'Polygon' ? [g.coordinates] : g.coordinates });
      }
      c = { sig, lines: items.length > 1 ? edgeLines(items, 'between') : [] };
      emdLineCache.set(z, c);
    }
    for (const line of c.lines) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
  });
  map.getSource('emd-lines').setData({ type: 'FeatureCollection', features: feats });
}

/** 시군 id의 지도 값: 인구는 읍면동을 더하고, 단체장 값은 그 시군 단체장, 나머지는 대표 존 값 */
export function unitMetric(id, vals) {
  const L = state.local, u = admin().unit(id), rep = unitRepZone(id);
  if (metric === 'pop') return unitPop(id).pop;
  if (metric === 'popChange') { const p = unitPop(id); return p.pop / Math.max(p.pop0, 1) - 1; }
  if (metric === 'popSido') return provincePops().get(u.region)?.pop ?? null;
  if (metricLevel(metric) === 'sido' && lastRegionVal?.size) return lastRegionVal.get(u.region) ?? null;
  const off = L.offices[unitOfficeKey(id)];
  if (metric === 'partyMayor') return officeParty(off);
  if (metric === 'voteMayor') return pShare(off);
  if (metric === 'mayorApproval') return off?.approval ?? null;
  if (metric === 'partyGov') return officeParty(L.offices[`g:${u.region}`]);
  if (metric === 'voteGov') return pShare(L.offices[`g:${u.region}`]);
  return rep >= 0 ? vals[rep] : null;
}

export function paintZones() {
  showDensity(metric === 'density');
  drawGuMetric();
  const sub = !!METRICS[metric]?.sub, lv = metricLevel(metric);
  map.setLayoutProperty('subs-fill', 'visibility', sub ? 'visible' : 'none');
  // 리 경계는 리 층위(또는 시군구 신설로 고를 때)만: 읍면동 층위에서는 읍면동 경계(drawEmdLines)를 긋는다
  map.setLayoutProperty('subs-line', 'visibility', (sub && lv === 'ri') || unitPick ? 'visible' : 'none');
  if (!result) return;
  if (sub) {
    const s = result.subs;
    if (lv === 'emd') {
      // 읍면동(북측은 면) 묶음 값: 인구·밀도·변화는 합으로, 접근·행복도는 인구 가중
      const a = admin();
      for (const g of a?.emds.values() || []) {
        let p = 0, p0 = 0, ar = 0, t = 0, h = 0, hw = 0;
        for (const i of g.subs) {
          p += s.pop[i]; p0 += subPop0[i] || 0; ar += subArea(i); t += s.transit[i] * Math.max(s.pop[i], 1);
          const hv = metric === 'emdHappy' ? subMetric('subHappy', i) : null;
          if (hv != null) { h += hv * Math.max(s.pop[i], 1); hw += Math.max(s.pop[i], 1); }
        }
        const w = g.subs.reduce((x, i) => x + Math.max(s.pop[i], 1), 0);
        const v = metric === 'emdPop' ? p : metric === 'emdDensity' ? p / Math.max(ar, 0.01) : metric === 'emdChange' ? p / Math.max(p0, 1) - 1
          : metric === 'emdTransit' ? t / w : hw ? h / hw : null;
        const c = v == null ? null : colorFor(metric, v);
        for (const i of g.subs) map.setFeatureState({ source: 'subs', id: i }, { color: c });
      }
    } else for (let i = 0; i < s.pop.length; i++) {
      let v;
      if (krRi?.[i] && zoneProps[subInfo(i)[0]].country === 'KR') { map.setFeatureState({ source: 'subs', id: i }, { color: null }); continue; }   // 리 층(drawRiLayer)이 칠한다
      if (metric === 'subDensity') v = s.pop[i] / subArea(i);
      else if (metric === 'subPop') v = s.pop[i];
      else if (metric === 'subChange') v = s.pop[i] / Math.max(subPop0[i], 1) - 1;
      else if (['subHappy', 'subApproval', 'subGain'].includes(metric)) v = subMetric(metric, i);
      else v = s.transit[i];
      map.setFeatureState({ source: 'subs', id: i }, { color: colorFor(metric, v) });
    }
  }
  const z = result.zones;
  const accRef = median(Array.from(z.access));
  // 한 시군으로 보이는 존들(옛 군 땅 조각 포함)은 한 색으로: 인구는 합, 나머지는 인구 가중 평균
  const grp = new Map();
  for (let i = 0; i < zoneProps.length; i++) { const r = countyRep(i); if (!grp.has(r)) grp.set(r, []); grp.get(r).push(i); }
  const agg = (i, arr) => {
    const zs = grp.get(countyRep(i));
    if (zs.length === 1) return arr[i];
    let s = 0, w = 0;
    for (const j of zs) { const p = Math.max(z.pop[j], 1); s += arr[j] * p; w += p; }
    return s / w;
  };
  const sumOf = (i, f) => grp.get(countyRep(i)).reduce((t, j) => t + f(j), 0);
  const sido = metric === 'popSido' || lv === 'sido' ? provincePops() : null;
  // 광역 단체 값 (인구·변화·밀도는 읍면동을 합쳐서, HDI·소득·행복도는 존 인구 가중)
  const regionVal = new Map();
  if (lv === 'sido' && !['popSido', 'partyGov', 'voteGov'].includes(metric)) {
    const acc = new Map();
    zoneProps.forEach((q, j) => {
      if (q.ext) return;
      const r = regionOf(state, q), e = acc.get(r) || { w: 0, hdi: 0, inc: 0, hap: 0, area: 0 }, w = Math.max(z.pop[j], 1);
      e.w += w; e.hdi += z.hdi[j] * w; e.inc += z.income[j] * w; e.hap += (happiness ? happiness[j] : 0) * w; e.area += q.area || 0;
      acc.set(r, e);
    });
    for (const [r, e] of acc) {
      const pp = sido.get(r) || { pop: 0, pop0: 1 };
      regionVal.set(r, metric === 'sidoChange' ? pp.pop / Math.max(pp.pop0, 1) - 1 : metric === 'sidoDensity' ? pp.pop / Math.max(e.area, 1)
        : metric === 'sidoHdi' ? e.hdi / e.w : metric === 'sidoIncome' ? e.inc / e.w : happiness ? e.hap / e.w : null);
    }
  }
  lastRegionVal = regionVal;
  // 구 색을 칠하는 존: 구 모양(guUnits)은 그 시군의 모든 존을 덮으므로 시군 색도 그 모든 존에서 지운다
  // (분구 단위 존만 지우면 편입해 온 존 등은 시군 색 위에 구 색이 겹쳐 진하게 보였다)
  const guZ = GU_METRIC[metric] || GU_POP[metric] ? new Set(Object.entries(state.local?.bungu || {}).filter(([, b]) => !b.general || GU_POP[metric])
    .flatMap(([u]) => [...new Set(unitZones(u).map((z) => countyRep(z)))].filter((r) => guUnits.get(r)?.length > 0).flatMap((r) => countyZones(r)))) : null;
  const vals = new Array(zoneProps.length).fill(null), mixedZ = admin()?.mixed;
  for (let i = 0; i < zoneProps.length; i++) {
    let v = null;
    if (metric === 'pop') v = sumOf(i, (j) => z.pop[j]);
    else if (metric === 'popSido') v = zoneProps[i].ext ? null : sido.get(regionOf(state, zoneProps[i]))?.pop ?? null;
    else if (lv === 'sido' && regionVal.size) v = zoneProps[i].ext ? null : regionVal.get(regionOf(state, zoneProps[i])) ?? null;
    else if (metric === 'popChange') v = sumOf(i, (j) => z.pop[j]) / Math.max(sumOf(i, (j) => zoneProps[j].pop), 1) - 1;
    else if (metric === 'hdi') v = agg(i, z.hdi);
    else if (metric === 'income') v = agg(i, z.income);
    else if (metric === 'access') v = agg(i, z.access) / accRef;
    else if (metric === 'happiness') v = happiness ? agg(i, happiness) : null;
    else if (metric === 'partyMayor') v = partyValue(i, 'mayor');
    else if (metric === 'partyGov') v = partyValue(i, 'gov');
    else if (metric === 'voteMayor') v = pShare(state.local.offices[mayorKey(i)]);
    else if (metric === 'voteGov') v = zoneProps[i].ext ? null : pShare(state.local.offices[`g:${regionOf(state, zoneProps[i])}`]);
    else if (metric === 'mayorApproval') v = state.local.offices[mayorKey(i)]?.approval ?? null;
    vals[i] = v;
    map.setFeatureState({ source: 'zones', id: i }, { color: sub || guZ?.has(i) || mixedZ?.has(i) ? null : colorFor(metric, v) });
  }
  drawAdminFill(vals);
  drawRiLayer();
}

/** 읍면동 행복도·지지율·체감 개선 */
export function subMetric(metric, i) {
  const [z] = subInfo(i);
  if (zoneProps[z].ext) return null;
  return subValue(metric, { zoneHappy: happiness?.[z], approval: state.approval, mayor: state.local.offices[mayorKey(z)]?.approval, gain: gains?.[i] || 0 });
}

export let subIndex = null;
/** 소구역 번호 → [존, 존 안 순번] */
export function subInfo(i) {
  if (!subIndex) {
    subIndex = [];
    zoneProps.forEach((zp, z) => zp.subs.forEach((_, k) => subIndex.push([z, k])));
  }
  if (i >= subIndex.length) { const e = extraOf(i); return e ? [e.zone, -1] : undefined; }   // 떼어 낸 남측 법정리 (risplit.js)
  return subIndex[i];
}

export function subArea(i) {
  // 떼어 낸 남측 법정리는 리 경계 넓이, 원래 읍면동은 뗀 리 넓이를 뺀다 (risplit.js)
  const e = extraOf(i);
  if (e) return Math.max(e.area, 0.05);
  const [z, k] = subInfo(i), cut = extraSubs.length ? extrasOfParent(i).reduce((t, x) => t + x.area, 0) : 0;
  return Math.max((zoneProps[z].subs[k][3] ?? 1) - cut, 0.05);
}

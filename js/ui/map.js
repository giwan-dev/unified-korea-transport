// MapLibre 지도와 레이어. 자체 벡터 배경지도(위성·음영기복을 고르면 Esri 타일), 존 단계구분도, 도로(혼잡도), 철도(교통량), 역·IC 라벨, 그리기 미리보기.

import { hotspotsFC, warnIcon, HOT_VC } from './traffic.js';
import { borderLines } from './borders.js';

// 라벨 글꼴: 한글은 브라우저 글꼴로 그리고(localIdeographFontFamily), 숫자·영문 글리프만 받는다
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const FONT = ['Noto Sans Regular'];

const PALETTE = {
  light: { road: '#fbf8f2', water: '#cddbe4', world: '#e8e5de', land: '#f5f3ee', sido: '#8f8a80', sgg: '#c8c3b8', unit: '#d9d5cb', mdl: '#c23b32', river: '#a9c2d2', label: '#3a3f45', halo: '#ffffff', foreign: '#7a7f86' },
  dark: { road: '#4a515a', water: '#0e1820', world: '#191d21', land: '#22272d', sido: '#5d646c', sgg: '#3a4048', unit: '#30353c', mdl: '#e0645a', river: '#27404f', label: '#d6dadf', halo: '#14181c', foreign: '#8a9097' },
};

function baseStyle() {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const c = dark ? PALETTE.dark : PALETTE.light;
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      world: { type: 'geojson', data: 'data/base/world.geojson' },
      sgg: { type: 'geojson', data: 'data/admin/sgg.geojson' },
      dmz: { type: 'geojson', data: 'data/admin/dmz.geojson' },
      edges: { type: 'geojson', data: 'data/admin/edges.geojson' },
      regionLabels: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      water: { type: 'geojson', data: 'data/base/water.geojson' },
      lines: { type: 'geojson', data: 'data/base/lines.geojson' },
      labels: { type: 'geojson', data: 'data/base/labels.geojson' },
      units: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      unitLabels: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      osmroads: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg-water', type: 'background', paint: { 'background-color': c.water } },
      { id: 'bg-world', type: 'fill', source: 'world', paint: { 'fill-color': c.world } },
      // 육지 면은 시군구 도형으로: 해안선(시군구 경계선 조각)과 같은 도형이라 어긋나지 않는다
      { id: 'bg-land', type: 'fill', source: 'sgg', paint: { 'fill-color': c.land, 'fill-antialias': false } },
      // 비무장지대: 어느 시군구에도 속하지 않는 땅이라 따로 육지 색으로 채운다 (경계선은 군사분계선 하나만)
      { id: 'bg-dmz', type: 'fill', source: 'dmz', paint: { 'fill-color': c.land, 'fill-antialias': false } },
      { id: 'bg-lake', type: 'fill', source: 'water', filter: ['==', ['get', 'kind'], 'lake'], paint: { 'fill-color': c.water } },
      { id: 'bg-river', type: 'line', source: 'water', filter: ['==', ['get', 'kind'], 'river'],
        paint: { 'line-color': c.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 2] } },
      { id: 'bg-unit', type: 'line', source: 'units', minzoom: 9, paint: { 'line-color': c.unit, 'line-width': 0.6 } },
      // OSM 배경 도로는 계산망에 없는 3차 도로(c 4)만: 고속도로·일반국도·간선·2차 도로(c 0~3)는 계산망이
      // 혼잡도 색으로 그리므로 배경에 또 깔면 두 줄로 겹쳐 보인다
      { id: 'bg-roads', type: 'line', source: 'osmroads', minzoom: 12,
        filter: ['>=', ['get', 'c'], 4],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'c'], 0, 1.4, 1, 1.1, 0.8], 13, ['match', ['get', 'c'], 0, 5, 1, 4, 2, 3, 3, 2, 1.4]] } },
      // 해안·국경선(가늘게)과 광역 단체 경계(굵게). 광역 경계는 setRegions가 지금 행정구역(개편·광역시 승격 반영)으로 고른다
      { id: 'bg-coast', type: 'line', source: 'edges', filter: ['==', ['get', 'b'], -1], paint: { 'line-color': c.sido, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1] } },
      { id: 'bg-sido', type: 'line', source: 'edges', filter: ['==', ['get', 'i'], -1],
        // 경계선 조각마다 끝을 둥글게: 조각 끝이 몇 m씩 어긋난 곳(남북·시도 자료가 만나는 곳)이 끊겨 보이지 않게
        layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': c.sido, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.6, 10, 3.2] } },
      // 바다·강 위 도 경계: 점선 (해안에서 약 12km 안, 가장 가까운 시군을 따라 나눈 선)
      { id: 'bg-sido-water', type: 'line', source: 'edges', filter: ['==', ['get', 'i'], -1],
        paint: { 'line-color': c.sido, 'line-opacity': 0.7, 'line-dasharray': [3, 2], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 2] } },
      // 군사분계선은 그리지 않는다: 통일 뒤 남북 경계는 맞닿은 시군의 도 경계로 그린다 (bg-sido)
      { id: 'lb-unit', type: 'symbol', source: 'unitLabels', minzoom: 11,
        layout: { 'symbol-placement': 'point', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 10 },
        paint: { 'text-color': c.foreign, 'text-halo-color': c.halo, 'text-halo-width': 1 } },
      { id: 'lb-sgg', type: 'symbol', source: 'labels', minzoom: 7, filter: ['==', ['get', 'rank'], 2],
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11 },
        paint: { 'text-color': ['case', ['has', 'foreign'], c.foreign, c.label], 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
      { id: 'lb-region', type: 'symbol', source: 'regionLabels', maxzoom: 9,
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 13, 'text-letter-spacing': 0.05 },
        paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.5 } },
      { id: 'lb-sido', type: 'symbol', source: 'labels', maxzoom: 9, filter: ['all', ['==', ['get', 'rank'], 1], ['has', 'foreign']],
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 13, 'text-letter-spacing': 0.05 },
        paint: { 'text-color': ['case', ['has', 'foreign'], c.foreign, c.label], 'text-halo-color': c.halo, 'text-halo-width': 1.5 } },
    ],
  };
}

// 지명 바꾸기: 게임이 바꾼 이름을 라벨에 반영한다
let nameResolver = (_level, _id, original) => original;
let labelData = null;
const unitFiles = new Map();

export function setNameResolver(fn) { nameResolver = fn; }

let regionKey = '';
/**
 * 광역 단체 경계와 이름을 지금 행정구역으로 다시 그린다.
 * @param {string[]} regionOfZone 존 id → 광역 단체 이름 (북측 도 복원·광역시 승격 반영)
 * @param {string[]} countryOfZone 존 id → 'KR' | 'KP' (지금은 쓰지 않는다: 남북 사이 경계도 도 경계로 그린다)
 * @param {(name:string)=>string} short 라벨용 짧은 이름
 */
export function setRegions(map, regionOfZone, countryOfZone, zoneCenter, short = (n) => n, countyOfZone = null) {
  const key = regionOfZone.join('|') + (countyOfZone ? countyOfZone.join('|') : '');
  if (key === regionKey || !map.getLayer('bg-sido') || !map.getLayer('zones-line')) return;
  regionKey = key;
  fetchEdges().then((edges) => {
    const ids = [], inner = [], water = [];
    for (const f of edges) {
      const { i, a, b, w } = f.properties;
      if (b < 0) continue;
      const same = regionOfZone[a] === regionOfZone[b];
      // 물 위 경계는 도가 다를 때만 (같은 도 안 시군 사이 물 위 선은 그리지 않는다)
      if (w) { if (!same) water.push(i); continue; }
      // 한 시군으로 보이는 존 사이(옛 군 땅을 떼어 낸 계산용 조각, 하나로 합친 남북 고성 등)는 선을 긋지 않는다
      if (same && countyOfZone && countyOfZone[a] === countyOfZone[b]) continue;
      (same ? inner : ids).push(i);
    }
    map.setFilter('bg-sido', ['in', ['get', 'i'], ['literal', ids]]);
    map.setFilter('bg-sido-water', ['in', ['get', 'i'], ['literal', water]]);
    if (map.getLayer('zones-line')) map.setFilter('zones-line', ['in', ['get', 'i'], ['literal', inner]]);
  });
  // 이름 자리: 단체에 속한 존 중심들의 가운데에 가장 가까운 존 중심 (바다·다른 도 위에 뜨지 않게)
  const groups = new Map();
  regionOfZone.forEach((r, z) => { if (r) { if (!groups.has(r)) groups.set(r, []); groups.get(r).push(zoneCenter(z)); } });
  const features = [];
  for (const [name, pts] of groups) {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let best = pts[0], bd = Infinity;
    for (const p of pts) { const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2; if (d < bd) { bd = d; best = p; } }
    features.push({ type: 'Feature', properties: { name: short(name) }, geometry: { type: 'Point', coordinates: best } });
  }
  map.getSource('regionLabels')?.setData({ type: 'FeatureCollection', features });
}

/** 고른 시군의 바깥 테두리: 경계선 조각 가운데 한쪽만 고른 시군에 드는 변 (옛 군 조각 사이 안쪽 선은 긋지 않는다) */
export function setZoneOutline(map, zoneIds) {
  const want = new Set(zoneIds);
  if (!map.getLayer('zones-sel-edge')) return;
  // 도 경계(bg-sido)는 배경 층이 나중에 올라오므로 그 위로 옮겨 둔다
  const ls = map.getStyle().layers, k = ls.findIndex((l) => l.id === 'bg-sido-water');
  if (k >= 0 && ls.findIndex((l) => l.id === 'zones-sel-edge') < k) map.moveLayer('zones-sel-edge', ls[k + 1]?.id);
  if (!want.size) { map.setFilter('zones-sel-edge', ['==', ['get', 'i'], -1]); return; }
  fetchEdges().then((edges) => {
    const ids = [];
    for (const f of edges) {
      const { i, a, b, w } = f.properties;
      if (!w && want.has(a) !== (b >= 0 && want.has(b))) ids.push(i);
    }
    map.setFilter('zones-sel-edge', ['in', ['get', 'i'], ['literal', ids]]);
  });
}

let edgeData = null;
/** 시군 경계 조각 (a·b: 맞닿은 두 존, b < 0이면 해안·국경) */
export function fetchEdges() {
  edgeData ||= fetch('data/admin/edges.geojson').then((r) => r.json()).then((d) => d.features);
  return edgeData;
}

function renamed(features, level, idKey) {
  return features.map((f) => {
    const id = f.properties[idKey];
    if (id == null) return f;
    const name = nameResolver(level, id, f.properties.name);
    return name === f.properties.name ? f : { ...f, properties: { ...f.properties, name } };
  });
}

let labelGroup = null;
let extraLabels = [], baseLabels = null;
/** 분구한 구 이름: 원래 있던 구와 같은 시군구 라벨 층(lb-sgg)에 단다 ({name} 점들). 시군구 라벨은 지난번 것을 그대로 쓴다 */
export function setExtraLabels(map, feats) {
  extraLabels = feats.map((f) => ({ ...f, properties: { ...f.properties, rank: 2 } }));
  if (!baseLabels) return refreshNames(map);
  map.getSource('labels')?.setData({ type: 'FeatureCollection', features: [...baseLabels, ...extraLabels] });
  return Promise.resolve();
}
/** 시군 라벨 묶기: 존 번호 → {key, weight}. 같은 key(한 시군으로 보이는 존들)는 weight가 가장 큰 존에만 이름을 단다 */
export function setLabelGroup(fn) { labelGroup = fn; }

/** 시군구 라벨과 읍면동 경계 라벨을 다시 그린다 */
export async function refreshNames(map) {
  if (!labelData) labelData = await fetch('data/base/labels.geojson').then((r) => r.json());
  let feats = renamed(labelData.features, 'zone', 'zone');
  if (labelGroup) {
    const best = new Map();
    for (const f of feats) {
      const z = f.properties.zone;
      if (z == null) continue;
      const g = labelGroup(z);
      if (!best.has(g.key) || g.weight > best.get(g.key).weight) best.set(g.key, { zone: z, weight: g.weight });
    }
    feats = feats.filter((f) => f.properties.zone == null || best.get(labelGroup(f.properties.zone).key).zone === f.properties.zone);
  }
  baseLabels = feats;
  map.getSource('labels').setData({ type: 'FeatureCollection', features: [...feats, ...extraLabels] });
  setUnits(map);
}

function setUnits(map) {
  const fs = renamed([...unitFiles.values()].flat(), 'unit', 'id');
  // 읍면동 경계는 같은 시군구 안의 변만: 시군구 경계와 겹치는 변은 시군구·시도 선이 그린다
  map.getSource('units').setData(borderLines(fs, (f) => f.properties.zone).inner);
  // 이름은 면마다 점 하나에: 면 도형에 바로 글자를 달면 타일마다 하나씩 찍혀 넓은 면은 이름이 여러 번 뜬다
  map.getSource('unitLabels').setData({ type: 'FeatureCollection', features: fs.map((f) => ({ type: 'Feature', properties: { name: f.properties.name }, geometry: { type: 'Point', coordinates: labelPoint(f.geometry) } })) });
}

/** 면의 이름 자리: 가장 큰 고리의 무게중심, 그 점이 면 밖이면(ㄷ자 모양 등) 고리 위 점들 가운데 무게중심에 가장 가까운 안쪽 점 */
function labelPoint(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let ring = polys[0][0], best = 0;
  const area = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); };
  for (const p of polys) { const a = area(p[0]); if (a > best) { best = a; ring = p[0]; } }
  let cx = 0, cy = 0, A = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f; A += f;
  }
  if (!A) return ring[0];
  const c = [cx / (3 * A), cy / (3 * A)];
  const inside = (pt) => { let o = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { if ((ring[i][1] > pt[1]) !== (ring[j][1] > pt[1]) && pt[0] < ((ring[j][0] - ring[i][0]) * (pt[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) o = !o; } return o; };
  if (inside(c)) return c;
  // 고리 위 이웃한 두 점의 가운데를 무게중심 쪽으로 조금 당긴 점 가운데 안쪽에 있는 가장 가까운 점
  let pick = ring[0], pd = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const m = [(ring[i][0] + ring[i - 1][0]) / 2, (ring[i][1] + ring[i - 1][1]) / 2];
    const q = [m[0] + (c[0] - m[0]) * 0.1, m[1] + (c[1] - m[1]) * 0.1];
    const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2;
    if (d < pd && inside(q)) { pd = d; pick = q; }
  }
  return pick;
}

/** 9배 이상 확대하면 화면에 들어온 시도의 OSM 도로 파일만 받아 그린다 */
function enableRoads(map) {
  let index = null;
  const loaded = new Map();
  const update = async () => {
    if (map.getZoom() < 8.5) {   // 멀리 축소하면 3차 도로는 안 보이므로 받아 둔 파일도 비운다
      if (loaded.size) { loaded.clear(); map.getSource('osmroads')?.setData({ type: 'FeatureCollection', features: [] }); }
      return;
    }
    if (!index) index = await fetch('data/base/roads/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    const b = map.getBounds();
    // 3차 도로 파일(minzoom 12)은 많이 확대했을 때만 받는다
    // 간선(c 0~3) 파일은 계산망과 겹치므로 받지 않고 3차 도로 파일(minzoom 있음)만 받는다
    const need = index.filter(({ bbox: [x0, y0, x1, y1], file, minzoom }) => minzoom && !loaded.has(file) && map.getZoom() >= minzoom
      && x1 >= b.getWest() && x0 <= b.getEast() && y1 >= b.getSouth() && y0 <= b.getNorth());
    // 화면에서 멀어진 파일은 버린다: 전국을 둘러보면 받은 도로 파일(모두 40MB 넘게)이 쌓여 메모리를 크게 먹는다
    const padX = (b.getEast() - b.getWest()) * 0.5, padY = (b.getNorth() - b.getSouth()) * 0.5;
    let dropped = 0;
    for (const e of index) {
      if (!loaded.has(e.file)) continue;
      const [x0, y0, x1, y1] = e.bbox;
      if (x1 < b.getWest() - padX || x0 > b.getEast() + padX || y1 < b.getSouth() - padY || y0 > b.getNorth() + padY) { loaded.delete(e.file); dropped++; }
    }
    if (!need.length && !dropped) return;
    await Promise.all(need.map(async (e) => {
      loaded.set(e.file, []);
      const fc = await fetch(`data/base/roads/${e.file}`).then((r) => r.json()).catch(() => null);
      if (fc) loaded.set(e.file, fc.features); else loaded.delete(e.file);   // 실패하면 다음에 다시 받는다
    }));
    map.getSource('osmroads').setData({ type: 'FeatureCollection', features: [...loaded.values()].flat() });
  };
  map.on('moveend', update);
}

let unitIndex = null;

/**
 * 이 범위에 걸친 시도의 자세한 읍면동 경계 (data/admin/units). 지도 경계선과 같은 저장소를 쓰므로 두 번 받지 않고, 받으면 경계선도 그린다.
 * 계산용 소구역(subzones.geojson)은 크게 단순화돼 있어, 그 모양으로 칠하면 지도 경계와 어긋나 쐐기·조각처럼 보인다
 */
export async function unitFeaturesIn(map, x0, y0, x1, y1) {
  if (!unitIndex) unitIndex = await fetch('data/admin/units/index.json').then((r) => r.json()).catch(() => null);
  if (!unitIndex) return [];
  const need = unitIndex.filter(({ bbox: [a, b, c, d] }) => c >= x0 && a <= x1 && d >= y0 && b <= y1);
  let added = false;
  await Promise.all(need.map(async (e) => {
    if (unitFiles.get(e.file)?.length) return;
    const fc = await fetch(`data/admin/units/${e.file}`).then((r) => r.json()).catch(() => null);
    if (fc) { unitFiles.set(e.file, fc.features); added = true; }
  }));
  if (added && map) setUnits(map);
  return need.flatMap((e) => unitFiles.get(e.file) || []);
}

/** 9배 이상 확대하면 화면에 들어온 시도의 읍면동 경계 파일만 받아 그린다 */
function enableUnits(map) {
  const loaded = unitFiles;
  const update = async () => {
    if (map.getZoom() < 8.5) return;
    // 받기에 실패하면(연결 끊김 등) 다음에 지도를 옮길 때 다시 받는다
    if (!unitIndex) unitIndex = await fetch('data/admin/units/index.json').then((r) => r.json()).catch(() => null);
    const index = unitIndex;
    if (!index) return;
    const b = map.getBounds();
    const need = index.filter(({ bbox: [x0, y0, x1, y1] }) => x1 >= b.getWest() && x0 <= b.getEast() && y1 >= b.getSouth() && y0 <= b.getNorth())
      .filter((e) => !loaded.has(e.file));
    if (!need.length) return;
    await Promise.all(need.map(async (e) => {
      loaded.set(e.file, []);
      const fc = await fetch(`data/admin/units/${e.file}`).then((r) => r.json()).catch(() => null);
      if (fc) loaded.set(e.file, fc.features); else loaded.delete(e.file);
    }));
    setUnits(map);
  };
  map.on('moveend', update);
}

/** 도로 혼잡도(V/C) 색 단계 */
export const VC_STOPS = [[0, '#3f9e63'], [0.6, '#c5c23a'], [1, '#f0a030'], [2, '#e0582c'], [4, '#c21f2f'], [7, '#7e1048'], [10, '#2e0a3f']];

const PARTY_NAMES = ['민주당', '국민의힘', '개혁신당', '정의당', '무소속', '관선 (임명)'];
const PARTY_MAP = { ramp: ['#1f5fd1', '#e0383e', '#ff7210', '#e6b800', '#7d848d', '#4b5563'], stops: [0, 1, 2, 3, 4, 5], categorical: PARTY_NAMES, fmt: (v) => PARTY_NAMES[Math.round(v)] || '' };

export const METRICS = {
  none: { label: '표시 안 함' },
  density: { label: '인구 밀도 (1km 격자)' },
  pop: { label: '시군구 인구 (합계)', ramp: ['#f7f4ea', '#f2c48d', '#d9682e', '#8f2318'], stops: [0, 100000, 400000, 1000000], fmt: (v) => `${Math.round(v / 1000).toLocaleString()}천` },
  popSido: { label: '광역지자체 인구 (합계)', ramp: ['#f7f4ea', '#f2c48d', '#d9682e', '#8f2318', '#4a0c0a'], stops: [0, 1500000, 3000000, 6000000, 13000000],
    fmt: (v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}백만` : `${Math.round(v / 1e4).toLocaleString()}만`) },
  subDensity: { label: '읍면동 인구 밀도 (노선 놓을 곳 찾기)', sub: true, ramp: ['#f7f4ea', '#f6c27a', '#e0662c', '#9b1d14', '#4a0c0a'], stops: [100, 1000, 5000, 15000, 30000], fmt: (v) => `${Math.round(v).toLocaleString()}/km²` },
  subChange: { label: '읍면동 인구 변화 (시작 대비)', sub: true, ramp: ['#b2182b', '#f4a582', '#f7f7f7', '#92c5de', '#2166ac'], stops: [-0.2, -0.05, 0, 0.05, 0.2], fmt: (v) => `${(v * 100).toFixed(0)}%` },
  subTransit: { label: '읍면동 대중교통 접근 (분)', sub: true, ramp: ['#1d5c3a', '#5aa36b', '#f5e08a', '#e88a3c', '#8f2318'], stops: [5, 10, 20, 35, 60], fmt: (v) => `${Math.round(v)}분` },
  popChange: { label: '인구 변화 (시작 대비)', ramp: ['#b2182b', '#f4a582', '#f7f7f7', '#92c5de', '#2166ac'], stops: [-0.3, -0.1, 0, 0.1, 0.3], fmt: (v) => `${(v * 100).toFixed(0)}%` },
  hdi: { label: '인간개발지수 (HDI)', ramp: ['#8f2318', '#e88a3c', '#f5e08a', '#7fc29b', '#1f6f4a'], stops: [0.55, 0.65, 0.75, 0.85, 0.95], fmt: (v) => v.toFixed(2) },
  income: { label: '1인당 소득 (PPP $)', ramp: ['#f7f4ea', '#c7d9ee', '#5b8fd1', '#1d3f8f'], stops: [2000, 10000, 30000, 60000], fmt: (v) => `$${Math.round(v / 1000)}k` },
  happiness: { label: '주민 행복도', ramp: ['#8f2318', '#e88a3c', '#f5e08a', '#7fc29b', '#1f6f4a'], stops: [40, 50, 60, 70, 80], fmt: (v) => v.toFixed(0) },
  // 지자체장 소속 정당: 정당마다 한 색 (값은 정당 번호: 민주당 0, 국민의힘 1, 개혁신당 2, 정의당 3, 무소속 4, 관선 5)
  partyMayor: { label: '지자체장 소속 정당 (시군구청장)', ...PARTY_MAP },
  partyGov: { label: '지자체장 소속 정당 (광역단체장)', ...PARTY_MAP },
  access: { label: '접근성 (상대)', ramp: ['#f7f4ea', '#c8e0b4', '#5aa36b', '#1d5c3a'], stops: [0.2, 0.6, 1.2, 2.5], fmt: (v) => v.toFixed(1) },
};

export async function createMap(container) {
  const map = new maplibregl.Map({
    container, style: baseStyle(), center: [127.4, 38.6], zoom: 5.6, minZoom: 4, maxZoom: 14,
    localIdeographFontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
    locale: { 'NavigationControl.ZoomIn': '확대', 'NavigationControl.ZoomOut': '축소', 'NavigationControl.ResetBearing': '북쪽을 위로 (방위 정렬)' },
    attributionControl: {
      compact: true,
      customAttribution: '행정동 경계 © 통계청 SGIS(공공누리 1유형)·vuski/admdongkor (CC BY 4.0) · 도로·철도·북측 경계 © OpenStreetMap 기여자 (ODbL) · WorldPop (CC BY 4.0) · Natural Earth',
    },
  });
  // 출처 표기는 접어 둔 채(ⓘ) 시작한다: 넓은 화면에서 펼쳐진 채로 뜨면 지도 아래를 한 줄 가린다. 누르면 펼쳐진다
  map.once('load', () => container && document.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));
  // 나침반 단추: 지도를 돌리거나 기울였을 때 누르면 북쪽이 위로 돌아온다 (바늘이 지금 방위를 보여 준다)
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-left');
  // 좁은 화면에서는 출처 상자를 ⓘ 단추로 접어 둔다 (눌러서 펼침)
  if (window.matchMedia('(max-width: 760px)').matches) {
    map.once('load', () => {
      const a = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
      a?.classList.remove('maplibregl-compact-show');
      a?.removeAttribute('open');
    });
  }
  // 레이어를 더하는 데는 스타일만 읽히면 된다 ('load'는 모든 배경 도형을 다 나누고 그릴 때까지 기다려 몇 초 늦다)
  await new Promise((res) => (map.isStyleLoaded() ? res() : map.once('style.load', res)));
  enableUnits(map);
  enableRoads(map);
  return map;
}

/** 지도 위 라벨을 가리지 않도록, 배경지도의 첫 심볼 레이어 아래에 넣는다 */
function firstSymbolId(map) {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

// 도로 굵기: 많이 확대하면 굵게 (선이 끊겨 보이지 않도록)
const ROAD_WIDTH = ['interpolate', ['linear'], ['zoom'],
  5, ['match', ['get', 'cls'], 'motorway', 2, 'trunk', 1.2, 'primary', 0.7, 0.4],
  10, ['match', ['get', 'cls'], 'motorway', 6, 'trunk', 4, 'primary', 2.5, 1.5],
  14, ['match', ['get', 'cls'], 'motorway', 11, 'trunk', 8, 'primary', 6, 4]];
// 고속도로 테두리: 혼잡도 색 선보다 조금 굵은 짙은 선을 밑에 깐다
const MOTORWAY_CASING = ['interpolate', ['linear'], ['zoom'], 5, 3.4, 10, 8.4, 14, 14];

const vol = ['coalesce', ['feature-state', 'vol'], 0];
// 혼잡도 0~10: 1을 넘는 곳도 심한 정도가 구분되도록 1·2·4·7·10에서 점점 짙어진다. 이용이 없는 구간은 옅은 회색 (사라지지 않게)
const vcColor = () => ['case', ['>', vol, 0], ['interpolate', ['linear'], ['coalesce', ['feature-state', 'vc'], 0], ...VC_STOPS.flat()], IDLE_COLOR];
const IDLE_COLOR = '#9aa1aa';
const idleOpacity = (on) => ['case', ['>', vol, 0], on, 0.45];
// 철도 기본 색: 고속철 파랑, 협궤 주황, 일반철도 보라
const RAIL_COLOR = ['case', ['==', ['get', 'cls'], 'hsr'], '#2453c9', ['==', ['get', 'narrow'], 1], '#e07b1a', '#6c3fa0'];
const METRO_COLOR = ['case', ['==', ['get', 'colour'], ''], '#1a9a6c', ['get', 'colour']];

let linksCache = null;
/** 계산망 선 자료를 바꾼다 (혼잡 주의 표시를 다시 만들 때 쓰려고 기억해 둔다) */
const HOUSING_R = { s: 0.6, m: 1.0, l: 1.6, xl: 2.6 };

/**
 * 닫힌 꺾은선을 곡선으로 (차이킨 모서리 깎기 3번: 꼭짓점 하나가 8개로)
 * @param {[number,number][]} pts 닫지 않은 꼭짓점들
 */
export function smoothRing(pts, rounds = 3) {
  if (!pts || pts.length < 3) return pts;
  let r = pts;
  for (let k = 0; k < rounds; k++) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    r = out;
  }
  return r;
}   // 택지지구 반지름 (km): 보통은 main.js가 h.R로 넘긴다

/**
 * 택지지구를 배경 지도에 그린다. 다 지은 곳은 시가지 면과 150m 간격 격자 도로(지구마다 방향이 다르다), 공사 중은 점선 경계
 * @param {{id:string, name:string, lon:number, lat:number, size:string, done:boolean}[]} list
 */
export function setHousing(map, list) {
  const src = map?.getSource('housing');
  if (!src) return;
  const features = [];
  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const h of list || []) {
    const R = h.R || HOUSING_R[h.size] || 1;
    const kx = 111.32 * Math.cos((h.lat * Math.PI) / 180), ky = 110.57;
    const at = (x, y) => [h.lon + x / kx, h.lat + y / ky];
    const seed = [...h.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
    // 직접 그린 경계는 곡선으로 지었다(h.smooth). 예전 저장의 꺾은선 경계도 곡선으로 그린다
    let ring = h.ring ? (h.smooth ? h.ring : smoothRing(h.ring)) : null;
    if (ring) ring = [...ring, ring[0]];
    if (!ring) {
      // 둥근 단지가 아니라 조금 일그러진 모양 (지구마다 고정)
      ring = [];
      const wob = (k) => 1 + 0.12 * Math.sin(k * 2 + (seed % 7)) + 0.06 * Math.cos(k * 3 + (seed % 5));
      for (let k = 0; k <= 36; k++) { const t = (k / 36) * 2 * Math.PI; ring.push(at(R * wob(t) * Math.cos(t), R * wob(t) * Math.sin(t))); }
    }
    const built = h.built || h.done;
    features.push({ type: 'Feature', properties: { k: 'area', done: !!built, id: h.id }, geometry: { type: 'Polygon', coordinates: [ring] } });
    features.push({ type: 'Feature', properties: { k: 'label', name: h.done ? h.name : built ? `${h.name} (입주 중)` : `${h.name} (공사 중)` }, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } });
    // (예전에는 다 지은 지구 안에 150m 간격 격자 도로를 그렸다: 확대하면 지저분해 뺐다. 단지 간선도로는 실제 도로망에 있다)
  }
  src.setData({ type: 'FeatureCollection', features });
}

export function setLinks(map, fc) {
  linksCache = fc;
  map.getSource('links').setData(fc);
}

/** 혼잡도가 높은 구간에 주의 표시 */
export function paintHotspots(map, vc) {
  map.getSource('hotspots')?.setData(hotspotsFC(linksCache, vc));
}

export function addLayers(map, zonesFC, linksFC, subsFC) {
  linksCache = linksFC;
  const below = firstSymbolId(map);
  map.addSource('zones', { type: 'geojson', data: zonesFC });
  map.addLayer({
    id: 'zones-fill', type: 'fill', source: 'zones',
    paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], 'rgba(0,0,0,0)'], 'fill-opacity': 0.55 },
  }, below);
  map.addLayer({
    // 시군구 경계: 경계선 조각(edges) 가운데 같은 광역 단체 안의 변만 (도 경계는 bg-sido, 해안은 bg-coast가 한 번씩 그린다)
    id: 'zones-line', type: 'line', source: 'edges', filter: ['==', ['get', 'i'], -1], layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#7a7f86', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.8], 'line-opacity': 0.7 },
  }, below);
  map.addLayer({
    id: 'zones-sel-edge', type: 'line', source: 'edges', filter: ['==', ['get', 'i'], -1], layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#1f5fbf', 'line-width': 2.5 },
  });
  map.addLayer({
    id: 'zones-sel', type: 'line', source: 'zones',
    paint: { 'line-color': '#1f5fbf', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.5, 0] },
  });

  // 읍면동·소구역 (해당 지표를 고를 때만 보인다)
  map.addSource('subs', { type: 'geojson', data: subsFC });
  map.addLayer({
    id: 'subs-fill', type: 'fill', source: 'subs', layout: { visibility: 'none' },
    paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], 'rgba(0,0,0,0)'], 'fill-opacity': 0.65 },
  }, below);
  map.addLayer({
    id: 'subs-line', type: 'line', source: 'subs', layout: { visibility: 'none' }, minzoom: 8,
    paint: { 'line-color': '#7a7f86', 'line-width': 0.4, 'line-opacity': 0.6 },
  }, below);
  map.addLayer({
    id: 'subs-sel', type: 'line', source: 'subs',
    paint: { 'line-color': '#1f5fbf', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.5, 0] },
  });

  map.addSource('grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'grid-heat', type: 'heatmap', source: 'grid', layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'p'], 0, 0, 30000, 1],
      'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 5, 2, 10, 40, 13, 300],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.2],
      'heatmap-opacity': 0.75,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(255,255,255,0)', 0.15, '#fde7b0', 0.4, '#f6a24a', 0.7, '#d9472b', 1, '#7a1414'],
    },
  }, below);

  // 큰 강·호수의 물 면 (OSM): 인구·지표 색칠 위에 그려 한강·낙동강·대동강 등이 보이게 한다
  map.addSource('waterarea', { type: 'geojson', data: 'data/base/waterarea.geojson' });
  map.addLayer({ id: 'water-area', type: 'fill', source: 'waterarea', paint: { 'fill-color': (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? PALETTE.dark : PALETTE.light).water, 'fill-opacity': 0.95 } }, below);
  // 강·호수 물가선: 채움만 있으면 둘레의 땅 색과 섞여 강변이 흐릿하다.
  // 물 면 둘레를 그대로 그으면 이어진 강·하천 조각 사이와 하구(바다와 맞닿은 곳)에도 선이 생기므로, 육지와 맞닿은 둘레만 따로 만든 선을 쓴다
  map.addSource('waterline', { type: 'geojson', data: 'data/base/waterline.geojson' });
  map.addLayer({ id: 'water-area-line', type: 'line', source: 'waterline', minzoom: 8,
    paint: { 'line-color': (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? '#4f86ad' : '#5b8fb5'), 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 11, 1.1, 14, 1.8] } }, below);

  // 택지지구: 공사 중이면 점선 경계, 다 지으면 배경 지도에 시가지 면·단지 안 도로·지구 이름 (setHousing)
  map.addSource('housing', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  map.addLayer({ id: 'housing-fill', type: 'fill', source: 'housing', filter: ['==', ['get', 'k'], 'area'],
    // 밑의 인구 분포(시군구·읍면동 색)가 비쳐 보이게 옅게: 경계선과 단지 안 도로로 지구를 알아본다
    paint: { 'fill-color': dark ? '#4a4540' : '#e9dfcf', 'fill-opacity': ['case', ['get', 'done'], 0.35, 0.15] } }, below);
  map.addLayer({ id: 'housing-edge', type: 'line', source: 'housing', filter: ['all', ['==', ['get', 'k'], 'area'], ['get', 'done']],
    paint: { 'line-color': dark ? '#a39a8c' : '#8a7550', 'line-width': 1.6 } }, below);
  map.addLayer({ id: 'housing-edge-building', type: 'line', source: 'housing', filter: ['all', ['==', ['get', 'k'], 'area'], ['!', ['get', 'done']]],
    paint: { 'line-color': dark ? '#a39a8c' : '#a08a60', 'line-width': 1.4, 'line-dasharray': [3, 2] } }, below);
  map.addLayer({ id: 'housing-label', type: 'symbol', source: 'housing', filter: ['==', ['get', 'k'], 'label'], minzoom: 10,
    layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11.5 },
    paint: { 'text-color': dark ? '#d8cfc0' : '#7a6a4f', 'text-halo-color': dark ? '#22272d' : '#ffffff', 'text-halo-width': 1.4 } });

  map.addSource('links', { type: 'geojson', data: linksFC, promoteId: 'id' });
  // 배경 OSM 도로(골목·이면도로)는 인구 색칠 위, 계산망 도로 아래에 그린다 (색칠 밑에 있으면 도심 도로망이 안 보인다)
  // (지금 맨 위로 올리면 뒤에 더하는 계산망·역 레이어가 그 위에 그려진다)
  if (map.getLayer('bg-roads')) map.moveLayer('bg-roads');
  // 시도 경계(해안선 포함)도 인구 색칠 위로: 밑에 있으면 바다와 땅 사이에 선이 없어 해안이 흐릿하다
  if (map.getLayer('bg-sido')) map.moveLayer('bg-sido');
  if (map.getLayer('bg-sido-water')) map.moveLayer('bg-sido-water');
  const roadBase = ['all', ['==', ['get', 'mode'], 0], ['==', ['get', 'building'], 0], ['!=', ['get', 'cls'], 'ferry'], ['!=', ['get', 'ext'], 1]];
  // 대도시 안의 촘촘한 2차 도로: 확대했을 때만 그린다
  map.addLayer({
    id: 'roads-minor', type: 'line', source: 'links', minzoom: 10,
    filter: ['all', ['==', ['get', 'mode'], 0], ['==', ['get', 'building'], 0], ['==', ['get', 'minor'], 1]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': vcColor(), 'line-width': ROAD_WIDTH, 'line-opacity': idleOpacity(1) },
  });
  // 일반도로 (간선국도·주요 도로)
  map.addLayer({
    id: 'roads', type: 'line', source: 'links',
    filter: ['all', roadBase, ['!=', ['get', 'minor'], 1], ['!=', ['get', 'cls'], 'motorway']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': vcColor(), 'line-width': ROAD_WIDTH, 'line-opacity': idleOpacity(1) },
  });
  // 고속도로: 짙은 테두리를 깔고 그 위에 혼잡도 색 (일반도로 위에 그려 교차하는 국도에 가려지지 않게)
  map.addLayer({
    id: 'roads-casing', type: 'line', source: 'links',
    filter: ['all', roadBase, ['==', ['get', 'cls'], 'motorway']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#27303a', 'line-width': MOTORWAY_CASING, 'line-opacity': ['case', ['>', vol, 0], 0.85, 0.35] },
  });
  map.addLayer({
    id: 'roads-motorway', type: 'line', source: 'links',
    filter: ['all', roadBase, ['==', ['get', 'cls'], 'motorway']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': vcColor(), 'line-width': ROAD_WIDTH, 'line-opacity': idleOpacity(1) },
  });
  // 폐선 (수려선·금강산선 등): 갈색 점선, 눌러서 재개통
  map.addSource('closed', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'closed-line', type: 'line', source: 'closed', minzoom: 6, layout: { 'line-join': 'round' },
    paint: { 'line-color': '#8d6e52', 'line-opacity': 0.75, 'line-dasharray': [2, 1.5], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 11, 3] },
  });
  map.addLayer({
    id: 'closed-label', type: 'symbol', source: 'closed', minzoom: 8,
    layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['get', 'name'], ' (폐선)'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
    paint: { 'text-color': '#7a5c40', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
  });
  map.addLayer({
    id: 'rails', type: 'line', source: 'links', filter: ['all', ['==', ['get', 'mode'], 1], ['==', ['get', 'building'], 0], ['!=', ['get', 'ext'], 1]],
    paint: {
      'line-color': RAIL_COLOR,
      'line-width': ['interpolate', ['linear'], vol, 0, 1.6, 20000, 2.2, 100000, 3.8, 400000, 7],
    },
  });
  map.addLayer({
    id: 'metro', type: 'line', source: 'links', filter: ['all', ['==', ['get', 'mode'], 2], ['==', ['get', 'building'], 0]],
    paint: {
      // 노선 고유색 (OSM colour 태그), 없으면 기본 초록. 굵기 = 이용객 (어느 배율에서나)
      'line-color': METRO_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'],
        7, ['interpolate', ['linear'], vol, 0, 0.6, 100000, 1.6, 400000, 3.2],
        11, ['interpolate', ['linear'], vol, 0, 1.2, 50000, 2.5, 200000, 5, 600000, 9]],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 9, 0.9],
    },
  });
  // 철도만 보기에서 쓰는 혼잡도(V/C) 색 철도·도시철도 (같은 굵기). 색 식을 바꿔 끼우면 feature-state가 다시 칠해지지 않아 따로 둔다
  for (const id of ['rails', 'metro']) {
    const filter = map.getFilter(id);
    map.addLayer({ id: `${id}-vc`, type: 'line', source: 'links', filter, layout: { visibility: 'none', 'line-cap': 'round' },
      paint: { 'line-color': vcColor(), 'line-width': map.getPaintProperty(id, 'line-width'), 'line-opacity': idleOpacity(0.95) } });
  }
  // 여객선 항로와 국경 연결(가상 링크)은 점선
  map.addLayer({
    id: 'ferries', type: 'line', source: 'links', filter: ['==', ['get', 'cls'], 'ferry'],
    paint: { 'line-color': '#2b7bb9', 'line-width': 1.6, 'line-dasharray': [2, 2] },
  });
  map.addLayer({
    id: 'ext-links', type: 'line', source: 'links', filter: ['all', ['==', ['get', 'ext'], 1], ['!=', ['get', 'cls'], 'ferry']],
    paint: { 'line-color': ['case', ['==', ['get', 'mode'], 1], '#6c3fa0', '#7a7f86'], 'line-width': 1.6, 'line-dasharray': [1, 1.5] },
  });
  // 공사 중인 신설 노선은 회색 점선
  map.addLayer({
    id: 'links-building', type: 'line', source: 'links', filter: ['==', ['get', 'building'], 1],
    paint: { 'line-color': '#8a8f96', 'line-width': 3, 'line-dasharray': [2, 1.5] },
  });
  map.addLayer({
    id: 'links-sel', type: 'line', source: 'links',
    paint: { 'line-color': '#1f5fbf', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 9, 0], 'line-opacity': 0.35 },
  });

  // 혼잡 주의 표시 (V/C > 1.5): 심한 곳부터, 겹치면 숨는다. 넓게 볼 때는 V/C 3 넘는 곳만
  if (!map.hasImage('warn')) map.addImage('warn', warnIcon(40), { pixelRatio: 2 });
  map.addSource('hotspots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'hotspots', type: 'symbol', source: 'hotspots', filter: HOT_BASE,
    layout: { 'icon-image': 'warn', 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 10, 1], 'icon-padding': 14, 'symbol-sort-key': ['-', 0, ['get', 'vc']] },
  });

  map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'points', type: 'circle', source: 'points',
    // 중요도(rank 0~3)에 따라 확대할수록 더 많이: 0 도시·새 시설, 1 큰 역, 2 일반 역·JCT, 3 IC·도시철도역
    filter: POINT_BASE.points,
    paint: {
      'circle-radius': ['match', ['get', 'kind'], 'city', 6, 'station', 4, 'rest', 4, 3],
      'circle-color': ['match', ['get', 'kind'], 'city', '#f2c14e', 'station', '#ffffff', 'rest', '#2f8f5b', '#1d232b'],
      'circle-stroke-color': ['case', ['==', ['get', 'metro'], 1], '#1a9a6c', ['==', ['get', 'kind'], 'station'], '#6c3fa0', '#ffffff'],
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'point-labels', type: 'symbol', source: 'points',
    filter: POINT_BASE['point-labels'],
    layout: {
      'text-field': ['get', 'name'], 'text-size': ['case', ['==', ['get', 'isNew'], 1], 13, 11],
      'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-font': FONT,
    },
    paint: { 'text-color': '#1d232b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  });

  // 항공: 운항하는 모든 노선(호, 굵기 = 하루 여객)과 공항(원 크기 = 하루 여객). 이용이 많은 노선을 위에
  map.addSource('airroutes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'airroutes', type: 'line', source: 'airroutes',
    layout: { 'line-sort-key': ['get', 'pax'] },
    paint: {
      'line-color': '#b04a9c', 'line-opacity': ['interpolate', ['linear'], ['get', 'pax'], 0, 0.25, 5000, 0.4, 50000, 0.6],
      'line-width': ['interpolate', ['linear'], ['get', 'pax'], 0, 0.5, 1000, 0.9, 5000, 1.6, 20000, 3, 100000, 7],
    },
  });
  map.addSource('airports', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'airports', type: 'circle', source: 'airports',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'pax'], 0, 3, 50000, 7, 200000, 12],
      'circle-color': ['case', ['>', ['get', 'vc'], 1], '#d9452f', '#b04a9c'],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'airport-labels', type: 'symbol', source: 'airports', minzoom: 6.5,
    layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
    paint: { 'text-color': '#7a3d70', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
  });

  // 소요 시간 측정 경로 (승용차 주황, 철도 파랑)
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['!=', ['get', 'k'], 'pt'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['match', ['get', 'k'], 'car', '#e8782c', '#2453c9'], 'line-width': 6, 'line-opacity': 0.75 } });
  map.addLayer({ id: 'route-pts', type: 'circle', source: 'route', filter: ['==', ['get', 'k'], 'pt'],
    paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#1d232b', 'circle-stroke-width': 3 } });

  // 운행 계통: 계통마다 고른 색의 노선으로 (겹치면 옆으로 비켜 그린다). 역 점 아래에
  map.addSource('services', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'services-line', type: 'line', source: 'services',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    // off: 같은 자리를 함께 지나는 계통 사이 칸 번호 (선 굵기만큼 비켜 나란히)
    paint: { 'line-color': ['get', 'color'], 'line-offset': ['interpolate', ['linear'], ['zoom'], 6, ['*', ['get', 'off'], 2], 10, ['*', ['get', 'off'], 3.5], 13, ['*', ['get', 'off'], 5]],
      'line-opacity': ['case', ['==', ['get', 'built'], 1], 0.9, 0.5],
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 3.5, 13, 5] } }, 'points');

  map.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#1f5fbf', 'line-width': 3, 'line-dasharray': [1.5, 1] } });
  map.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': ['case', ['==', ['get', 'pass'], 1], 4, 6], 'circle-color': ['case', ['==', ['get', 'pass'], 1], '#fff', '#1f5fbf'],
      'circle-stroke-color': ['case', ['==', ['get', 'pass'], 1], '#1f5fbf', '#fff'], 'circle-stroke-width': 2 } });
}

export function colorFor(metric, v) {
  const m = METRICS[metric];
  if (!m || !m.ramp || v == null || !isFinite(v)) return null;
  const { stops, ramp } = m;
  if (v <= stops[0]) return ramp[0];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i]) {
      const t = (v - stops[i - 1]) / (stops[i] - stops[i - 1]);
      return mix(ramp[i - 1], ramp[i], t);
    }
  }
  return ramp[ramp.length - 1];
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t));
  return `rgb(${c.join(',')})`;
}

/** 지도 보기: 전체 / 도로만 / 철도만 (도시철도 포함, 혼잡도 색) / 항공만 / 아무것도 안 보기 (지표 색칠만) */
// 배경: 기본(자체 벡터 지도) · 위성 사진 · 지형(음영기복). 위성·지형은 Esri 타일을 육지 면 위, 호수·경계선 아래에 깐다
export const BASEMAPS = { plain: '기본 지도', sat: '위성 사진', terrain: '지형 (음영기복)' };
const RASTER = {
  sat: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 18,
    attribution: '위성 사진 © Esri, Maxar, Earthstar Geographics' },
  terrain: { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}'], maxzoom: 13,
    attribution: '음영기복 © Esri' },
};
export function setBasemap(map, kind) {
  if (map.getLayer('bg-raster')) map.removeLayer('bg-raster');
  if (map.getSource('bg-raster')) map.removeSource('bg-raster');
  const r = RASTER[kind];
  const sat = kind === 'sat';
  // 위성 사진 위에서는 호수·강 색과 시군 색칠을 옅게 (사진이 보이게)
  for (const id of ['bg-lake', 'bg-river']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', sat ? 'none' : 'visible');
  if (map.getLayer('zones-fill')) map.setPaintProperty('zones-fill', 'fill-opacity', sat ? 0.3 : 0.55);
  if (!r) return;
  map.addSource('bg-raster', { type: 'raster', tiles: r.tiles, tileSize: 256, maxzoom: r.maxzoom, attribution: r.attribution });
  // 위성 사진은 육지 면 대신 맨 밑에, 음영기복은 시군 색칠 위에 반투명으로 얹어 산줄기가 보이게
  map.addLayer({ id: 'bg-raster', type: 'raster', source: 'bg-raster',
    paint: sat ? { 'raster-opacity': 1 } : { 'raster-opacity': 0.4, 'raster-saturation': -0.5, 'raster-contrast': 0.2 } },
  sat || !map.getLayer('zones-line') ? 'bg-lake' : 'zones-line');
}

/** 택지지구 표시(면·경계·단지 안 격자 도로·이름)를 켜고 끈다 */
export function setHousingVisible(map, on) {
  for (const id of ['housing-fill', 'housing-edge', 'housing-edge-building', 'housing-label']) {
    if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

export const LAYER_VIEWS = { all: '모두 보기', road: '도로만', rail: '철도만', air: '항공만', none: '아무것도 안 보기' };
const ROAD_LAYERS = ['roads', 'roads-minor', 'roads-casing', 'roads-motorway', 'bg-roads', 'ferries'];
const RAIL_LAYERS = ['rails', 'metro'];
const RAIL_VC = ['rails-vc', 'metro-vc'];
const AIR_LAYERS = ['airroutes', 'airports', 'airport-labels'];
const CLOSED_LAYERS = ['closed-line', 'closed-label'];
// 철도만 보기: 노선 색 대신 혼잡도(V/C) 색 레이어
const VIEW_HIDE = {
  all: [...RAIL_VC],
  road: [...RAIL_LAYERS, ...RAIL_VC, ...AIR_LAYERS, ...CLOSED_LAYERS],
  rail: [...ROAD_LAYERS, ...RAIL_LAYERS, ...AIR_LAYERS],
  air: [...ROAD_LAYERS, ...RAIL_LAYERS, ...RAIL_VC, ...CLOSED_LAYERS],
  none: [...ROAD_LAYERS, ...RAIL_LAYERS, ...RAIL_VC, ...AIR_LAYERS, ...CLOSED_LAYERS, 'hotspots'],
};
// 공사 중(미개통) 점선·국경 연결·혼잡 주의 표시도 보기에 맞는 수단만: 도로만 보기에서 미개통 철도가 섞여 보이지 않게
const NONE = ['==', ['get', 'mode'], -9];
const VIEW_MODE = { all: null, road: ['==', ['get', 'mode'], 0], rail: ['>=', ['get', 'mode'], 1], air: NONE, none: NONE };
// 역·IC 점도 보기에 맞는 것만: 도로만 보기에는 IC·JCT·휴게소, 철도만 보기에는 역, 항공만·안 보기에는 도시만
const KIND = ['get', 'kind'];
const VIEW_POINTS = {
  all: null,
  road: ['!=', KIND, 'station'],
  rail: ['match', KIND, ['station', 'city'], true, false],
  air: ['==', KIND, 'city'],
  none: ['==', KIND, 'city'],
};
const HOT_BASE = ['any', ['>=', ['zoom'], 7], ['>', ['get', 'vc'], 3]];
// 역·IC 점: 중요도(rank 0~3)에 따라 확대할수록 더 많이
const POINT_BASE = {
  points: ['>=', ['zoom'], ['match', ['get', 'rank'], 0, 0, 1, 6.5, 2, 9, 10.5]],
  'point-labels': ['>=', ['zoom'], ['match', ['get', 'rank'], 0, 0, 1, 8, 2, 10, 11.5]],
};
const VIEW_FILTERED = {
  'links-building': ['==', ['get', 'building'], 1],
  'ext-links': ['all', ['==', ['get', 'ext'], 1], ['!=', ['get', 'cls'], 'ferry']],
  hotspots: HOT_BASE,
};
export function setLayerView(map, view) {
  const hide = new Set(VIEW_HIDE[view] || []);
  for (const id of new Set(Object.values(VIEW_HIDE).flat())) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', hide.has(id) ? 'none' : 'visible');
  }
  const mode = VIEW_MODE[view];
  for (const [id, base] of Object.entries(VIEW_FILTERED)) {
    if (map.getLayer(id)) map.setFilter(id, mode ? ['all', base, mode] : base);
  }
  const pf = VIEW_POINTS[view];
  for (const [id, base] of Object.entries(POINT_BASE)) {
    if (map.getLayer(id)) map.setFilter(id, pf ? ['all', base, pf] : base);
  }
}

const sw = (color, kind = 'line', extra = '') => `<i class="sw ${kind}" style="--c:${color};${extra}"></i>`;

export function legendHTML(metric, view = 'all', basemap = 'plain') {
  const m = METRICS[metric];
  const opts = Object.entries(METRICS).map(([k, v]) => `<option value="${k}" ${k === metric ? 'selected' : ''}>${v.label}</option>`).join('');
  let ramp = '';
  if (m.categorical) {
    // 정당처럼 나뉘는 값은 색 띠 대신 색 칸
    ramp = `<div style="display:flex;flex-wrap:wrap;gap:4px 8px;font-size:11px;margin-top:4px">${m.categorical.map((n, k) => `<span style="display:inline-flex;align-items:center;gap:3px"><i style="width:10px;height:10px;border-radius:2px;background:${m.ramp[k]};display:inline-block"></i>${n}</span>`).join('')}</div>`;
  } else if (m.ramp) {
    ramp = `<div class="ramp" style="background:linear-gradient(to right,${m.ramp.join(',')})"></div>
      <div class="ends"><span>${m.fmt(m.stops[0])}</span><span>${m.fmt(m.stops[m.stops.length - 1])}</span></div>`;
  }
  const road = view === 'all' || view === 'road', rail = view === 'all' || view === 'rail', air = view === 'all' || view === 'air';
  const vcRamp = (title) => `<div class="lg-t">${title}</div>
    <div class="ramp" style="background:linear-gradient(to right,${VC_STOPS.map(([v, c]) => `${c} ${v * 10}%`).join(',')})"></div>
    <div class="ticks">${[0, 1, 2, 4, 7, 10].map((v) => `<span style="left:${v * 10}%">${v}</span>`).join('')}</div>`;
  const rows = [];
  if (road) rows.push(`${sw('#3f9e63', 'line motorway')} 고속도로 ${sw('#3f9e63')} 일반도로`);
  if (view === 'rail') rows.push(`${sw('#6c3fa0', 'line thin')} 굵기 = 이용객 · 색 = 혼잡도`);
  else if (rail) rows.push(`${sw('#2453c9')} 고속철 ${sw('#6c3fa0')} 일반철도 ${sw('#e07b1a')} 협궤`, `${sw('#1a9a6c')} 도시철도 (노선색, 굵기 = 이용객)`);
  if (air) rows.push(`${sw('#b04a9c', 'dot')} 공항 ${sw('#b04a9c')} 항공 노선 (굵기 = 여객)`);
  if (road || rail) rows.push(`${sw(IDLE_COLOR)} 이용 없음 ${sw('#8a8f96', 'dash')} 미개통`);
  if (rail || view === 'rail') rows.push(`${sw('#8d6e52', 'dash')} 폐선 (눌러서 재개통)`);
  if (road) rows.push(`${sw('#2b7bb9', 'dash')} 여객선 ${sw('#7a7f86', 'dash')} 국경 연결`);
  if (view === 'none') rows.push('교통망을 숨기고 지표 색칠만 봅니다.');
  if (view !== 'air' && view !== 'none') rows.push(`<i class="sw warn"></i> 혼잡 주의 (V/C &gt; ${HOT_VC})`);
  return `<select id="layerview" title="지도에 그릴 교통망">${Object.entries(LAYER_VIEWS).map(([k, v]) => `<option value="${k}" ${k === view ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select id="metric">${opts}</select>
    <select id="basemap" title="배경 지도">${Object.entries(BASEMAPS).map(([k, v]) => `<option value="${k}" ${k === basemap ? 'selected' : ''}>배경: ${v}</option>`).join('')}</select>${ramp}
    <div class="lg-more">${(road || view === 'rail') ? vcRamp(view === 'rail' ? '철도 혼잡도 (V/C, 0~10)' : '도로 혼잡도 (V/C, 0~10)') : ''}
    <div class="lg-rows">${rows.map((r) => `<div>${r}</div>`).join('')}</div></div>`;
}

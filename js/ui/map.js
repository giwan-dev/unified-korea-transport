// MapLibre 지도와 레이어. 자체 벡터 배경지도(외부 타일 없음), 존 단계구분도, 도로(혼잡도), 철도(교통량), 역·IC 라벨, 그리기 미리보기.

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
      sido: { type: 'geojson', data: 'data/admin/sido.geojson' },
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
      { id: 'bg-land', type: 'fill', source: 'sido', paint: { 'fill-color': c.land } },
      { id: 'bg-lake', type: 'fill', source: 'water', filter: ['==', ['get', 'kind'], 'lake'], paint: { 'fill-color': c.water } },
      { id: 'bg-river', type: 'line', source: 'water', filter: ['==', ['get', 'kind'], 'river'],
        paint: { 'line-color': c.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 2] } },
      { id: 'bg-unit', type: 'line', source: 'units', minzoom: 9, paint: { 'line-color': c.unit, 'line-width': 0.6 } },
      // OSM 도로 (계산망에 없는 2차 도로까지 실제 모양으로). 계산 구간은 이 위에 혼잡도 색으로 겹친다
      { id: 'bg-roads', type: 'line', source: 'osmroads', minzoom: 9,
        filter: ['any', ['<', ['get', 'c'], 3], ['all', ['==', ['get', 'c'], 3], ['>=', ['zoom'], 11]], ['>=', ['zoom'], 12]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'c'], 0, 1.4, 1, 1.1, 0.8], 13, ['match', ['get', 'c'], 0, 5, 1, 4, 2, 3, 3, 2, 1.4]] } },
      { id: 'bg-sido', type: 'line', source: 'sido', paint: { 'line-color': c.sido, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 10, 1.6] } },
      { id: 'bg-mdl', type: 'line', source: 'lines', paint: { 'line-color': c.mdl, 'line-width': 1.6, 'line-dasharray': [3, 2] } },
      { id: 'lb-unit', type: 'symbol', source: 'unitLabels', minzoom: 11,
        layout: { 'symbol-placement': 'point', 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 10 },
        paint: { 'text-color': c.foreign, 'text-halo-color': c.halo, 'text-halo-width': 1 } },
      { id: 'lb-sgg', type: 'symbol', source: 'labels', minzoom: 7, filter: ['==', ['get', 'rank'], 2],
        layout: { 'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11 },
        paint: { 'text-color': ['case', ['has', 'foreign'], c.foreign, c.label], 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
      { id: 'lb-sido', type: 'symbol', source: 'labels', maxzoom: 9, filter: ['==', ['get', 'rank'], 1],
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

function renamed(features, level, idKey) {
  return features.map((f) => {
    const id = f.properties[idKey];
    if (id == null) return f;
    const name = nameResolver(level, id, f.properties.name);
    return name === f.properties.name ? f : { ...f, properties: { ...f.properties, name } };
  });
}

/** 시군구 라벨과 읍면동 경계 라벨을 다시 그린다 */
export async function refreshNames(map) {
  if (!labelData) labelData = await fetch('data/base/labels.geojson').then((r) => r.json());
  map.getSource('labels').setData({ type: 'FeatureCollection', features: renamed(labelData.features, 'zone', 'zone') });
  setUnits(map);
}

function setUnits(map) {
  const fs = renamed([...unitFiles.values()].flat(), 'unit', 'id');
  map.getSource('units').setData({ type: 'FeatureCollection', features: fs });
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
    if (map.getZoom() < 8.5) return;
    if (!index) index = await fetch('data/base/roads/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
    const b = map.getBounds();
    // 3차 도로 파일(minzoom 12)은 많이 확대했을 때만 받는다
    const need = index.filter(({ bbox: [x0, y0, x1, y1], file, minzoom }) => !loaded.has(file) && map.getZoom() >= (minzoom || 8.5)
      && x1 >= b.getWest() && x0 <= b.getEast() && y1 >= b.getSouth() && y0 <= b.getNorth());
    if (!need.length) return;
    await Promise.all(need.map(async (e) => {
      loaded.set(e.file, []);
      loaded.set(e.file, (await fetch(`data/base/roads/${e.file}`).then((r) => r.json())).features);
    }));
    map.getSource('osmroads').setData({ type: 'FeatureCollection', features: [...loaded.values()].flat() });
  };
  map.on('moveend', update);
}

/** 9배 이상 확대하면 화면에 들어온 시도의 읍면동 경계 파일만 받아 그린다 */
function enableUnits(map) {
  let index = null;
  const loaded = unitFiles;
  const update = async () => {
    if (map.getZoom() < 8.5) return;
    if (!index) index = await fetch('data/admin/units/index.json').then((r) => r.json());
    const b = map.getBounds();
    const need = index.filter(({ bbox: [x0, y0, x1, y1] }) => x1 >= b.getWest() && x0 <= b.getEast() && y1 >= b.getSouth() && y0 <= b.getNorth())
      .filter((e) => !loaded.has(e.file));
    if (!need.length) return;
    await Promise.all(need.map(async (e) => {
      loaded.set(e.file, []);
      loaded.set(e.file, (await fetch(`data/admin/units/${e.file}`).then((r) => r.json())).features);
    }));
    setUnits(map);
  };
  map.on('moveend', update);
}

/** 도로 혼잡도(V/C) 색 단계 */
export const VC_STOPS = [[0, '#3f9e63'], [0.6, '#c5c23a'], [1, '#f0a030'], [2, '#e0582c'], [4, '#c21f2f'], [7, '#7e1048'], [10, '#2e0a3f']];

export const METRICS = {
  none: { label: '표시 안 함' },
  density: { label: '인구 밀도 (1km 격자)' },
  pop: { label: '인구', ramp: ['#f7f4ea', '#f2c48d', '#d9682e', '#8f2318'], stops: [0, 100000, 400000, 1000000], fmt: (v) => `${Math.round(v / 1000).toLocaleString()}천` },
  subDensity: { label: '읍면동 인구 밀도', sub: true, ramp: ['#f7f4ea', '#f6c27a', '#e0662c', '#9b1d14', '#4a0c0a'], stops: [100, 1000, 5000, 15000, 30000], fmt: (v) => `${Math.round(v).toLocaleString()}/km²` },
  subChange: { label: '읍면동 인구 변화 (시작 대비)', sub: true, ramp: ['#b2182b', '#f4a582', '#f7f7f7', '#92c5de', '#2166ac'], stops: [-0.2, -0.05, 0, 0.05, 0.2], fmt: (v) => `${(v * 100).toFixed(0)}%` },
  subTransit: { label: '읍면동 대중교통 접근 (분)', sub: true, ramp: ['#1d5c3a', '#5aa36b', '#f5e08a', '#e88a3c', '#8f2318'], stops: [5, 10, 20, 35, 60], fmt: (v) => `${Math.round(v)}분` },
  popChange: { label: '인구 변화 (시작 대비)', ramp: ['#b2182b', '#f4a582', '#f7f7f7', '#92c5de', '#2166ac'], stops: [-0.3, -0.1, 0, 0.1, 0.3], fmt: (v) => `${(v * 100).toFixed(0)}%` },
  hdi: { label: '인간개발지수 (HDI)', ramp: ['#8f2318', '#e88a3c', '#f5e08a', '#7fc29b', '#1f6f4a'], stops: [0.55, 0.65, 0.75, 0.85, 0.95], fmt: (v) => v.toFixed(2) },
  income: { label: '1인당 소득 (PPP $)', ramp: ['#f7f4ea', '#c7d9ee', '#5b8fd1', '#1d3f8f'], stops: [2000, 10000, 30000, 60000], fmt: (v) => `$${Math.round(v / 1000)}k` },
  happiness: { label: '주민 행복도', ramp: ['#8f2318', '#e88a3c', '#f5e08a', '#7fc29b', '#1f6f4a'], stops: [40, 50, 60, 70, 80], fmt: (v) => v.toFixed(0) },
  partyMayor: { label: '정당 지도 (시군구청장)', ramp: ['#1f5fd1', '#f2f2f2', '#e0383e'], stops: [0, 0.5, 1], fmt: (v) => (v < 0.5 ? '민주당' : '국민의힘') },
  partyGov: { label: '정당 지도 (광역단체장)', ramp: ['#1f5fd1', '#f2f2f2', '#e0383e'], stops: [0, 0.5, 1], fmt: (v) => (v < 0.5 ? '민주당' : '국민의힘') },
  access: { label: '접근성 (상대)', ramp: ['#f7f4ea', '#c8e0b4', '#5aa36b', '#1d5c3a'], stops: [0.2, 0.6, 1.2, 2.5], fmt: (v) => v.toFixed(1) },
};

export async function createMap(container) {
  const map = new maplibregl.Map({
    container, style: baseStyle(), center: [127.4, 38.6], zoom: 5.6, minZoom: 4, maxZoom: 14,
    localIdeographFontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
    attributionControl: {
      compact: true,
      customAttribution: '행정동 경계 © 통계청 SGIS(공공누리 1유형)·vuski/admdongkor (CC BY 4.0) · 도로·철도·북측 경계 © OpenStreetMap 기여자 (ODbL) · WorldPop (CC BY 4.0) · Natural Earth',
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  // 좁은 화면에서는 출처 상자를 ⓘ 단추로 접어 둔다 (눌러서 펼침)
  if (window.matchMedia('(max-width: 760px)').matches) {
    map.once('load', () => {
      const a = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
      a?.classList.remove('maplibregl-compact-show');
      a?.removeAttribute('open');
    });
  }
  await new Promise((res) => map.on('load', res));
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

export function addLayers(map, zonesFC, linksFC, subsFC) {
  const below = firstSymbolId(map);
  map.addSource('zones', { type: 'geojson', data: zonesFC });
  map.addLayer({
    id: 'zones-fill', type: 'fill', source: 'zones',
    paint: { 'fill-color': ['coalesce', ['feature-state', 'color'], 'rgba(0,0,0,0)'], 'fill-opacity': 0.55 },
  }, below);
  map.addLayer({
    id: 'zones-line', type: 'line', source: 'zones',
    paint: { 'line-color': '#7a7f86', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.8], 'line-opacity': 0.5 },
  }, below);
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
  // 강·호수 물가선: 채움만 있으면 둘레의 땅 색과 섞여 강변이 흐릿하다
  map.addLayer({ id: 'water-area-line', type: 'line', source: 'waterarea', minzoom: 8,
    paint: { 'line-color': (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? '#4f86ad' : '#5b8fb5'), 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 11, 1.1, 14, 1.8] } }, below);

  map.addSource('links', { type: 'geojson', data: linksFC, promoteId: 'id' });
  // 혼잡도 0~10: 1을 넘는 곳도 심한 정도가 구분되도록 1·2·4·7·10에서 점점 짙어진다
  const vcColor = ['interpolate', ['linear'], ['coalesce', ['feature-state', 'vc'], 0], ...VC_STOPS.flat()];
  // 배경 OSM 도로(골목·이면도로)는 인구 색칠 위, 계산망 도로 아래에 그린다 (색칠 밑에 있으면 도심 도로망이 안 보인다)
  // (지금 맨 위로 올리면 뒤에 더하는 계산망·역 레이어가 그 위에 그려진다)
  if (map.getLayer('bg-roads')) map.moveLayer('bg-roads');
  // 시도 경계(해안선 포함)도 인구 색칠 위로: 밑에 있으면 바다와 땅 사이에 선이 없어 해안이 흐릿하다
  if (map.getLayer('bg-sido')) map.moveLayer('bg-sido');
  map.addLayer({
    id: 'roads', type: 'line', source: 'links',
    filter: ['all', ['==', ['get', 'mode'], 0], ['==', ['get', 'building'], 0], ['!=', ['get', 'cls'], 'ferry'], ['!=', ['get', 'ext'], 1], ['!=', ['get', 'minor'], 1]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': vcColor, 'line-width': ROAD_WIDTH },
  });
  // 대도시 안의 촘촘한 2차 도로: 확대했을 때만 그린다
  map.addLayer({
    id: 'roads-minor', type: 'line', source: 'links', minzoom: 10,
    filter: ['all', ['==', ['get', 'mode'], 0], ['==', ['get', 'building'], 0], ['==', ['get', 'minor'], 1]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': vcColor, 'line-width': ROAD_WIDTH },
  });
  map.addLayer({
    id: 'rails', type: 'line', source: 'links', filter: ['all', ['==', ['get', 'mode'], 1], ['==', ['get', 'building'], 0], ['!=', ['get', 'ext'], 1]],
    paint: {
      'line-color': ['case', ['==', ['get', 'cls'], 'hsr'], '#2453c9', '#6c3fa0'],
      'line-width': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'vol'], 0], 0, 1, 20000, 1.8, 100000, 3.5, 400000, 7],
    },
  });
  map.addLayer({
    id: 'metro', type: 'line', source: 'links', filter: ['all', ['==', ['get', 'mode'], 2], ['==', ['get', 'building'], 0]],
    paint: {
      // 노선 고유색 (OSM colour 태그), 없으면 기본 초록
      'line-color': ['case', ['==', ['get', 'colour'], ''], '#1a9a6c', ['get', 'colour']],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 11, ['interpolate', ['linear'], ['coalesce', ['feature-state', 'vol'], 0], 0, 2, 300000, 6]],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 9, 0.9],
    },
  });
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

  map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'points', type: 'circle', source: 'points',
    // 중요도(rank 0~3)에 따라 확대할수록 더 많이: 0 도시·새 시설, 1 큰 역, 2 일반 역·JCT, 3 IC·도시철도역
    filter: ['>=', ['zoom'], ['match', ['get', 'rank'], 0, 0, 1, 6.5, 2, 9, 10.5]],
    paint: {
      'circle-radius': ['match', ['get', 'kind'], 'city', 6, 'station', 4, 'rest', 4, 3],
      'circle-color': ['match', ['get', 'kind'], 'city', '#f2c14e', 'station', '#ffffff', 'rest', '#2f8f5b', '#1d232b'],
      'circle-stroke-color': ['case', ['==', ['get', 'metro'], 1], '#1a9a6c', ['==', ['get', 'kind'], 'station'], '#6c3fa0', '#ffffff'],
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'point-labels', type: 'symbol', source: 'points',
    filter: ['>=', ['zoom'], ['match', ['get', 'rank'], 0, 0, 1, 8, 2, 10, 11.5]],
    layout: {
      'text-field': ['get', 'name'], 'text-size': ['case', ['==', ['get', 'isNew'], 1], 13, 11],
      'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-font': FONT,
    },
    paint: { 'text-color': '#1d232b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  });

  // 항공: 노선(호)과 공항(원 크기 = 하루 여객)
  map.addSource('airroutes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'airroutes', type: 'line', source: 'airroutes', filter: ['>=', ['get', 'pax'], 2000],
    paint: {
      'line-color': '#b04a9c', 'line-opacity': 0.3,
      'line-width': ['interpolate', ['linear'], ['get', 'pax'], 300, 0.6, 20000, 2.5, 100000, 6],
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

  map.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#1f5fbf', 'line-width': 3, 'line-dasharray': [1.5, 1] } });
  map.addLayer({ id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': '#1f5fbf', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
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

/** 지도 보기: 전체 / 도로만 / 철도만 (도시철도·공항 포함) */
export const LAYER_VIEWS = { all: '모두 보기', road: '도로만', rail: '철도만' };
const VIEW_HIDE = {
  all: [],
  road: ['rails', 'metro', 'airroutes', 'airports', 'airport-labels'],
  rail: ['roads', 'roads-minor', 'bg-roads', 'ferries'],
};
export function setLayerView(map, view) {
  const hide = new Set(VIEW_HIDE[view] || []);
  for (const id of new Set(Object.values(VIEW_HIDE).flat())) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', hide.has(id) ? 'none' : 'visible');
  }
}

export function legendHTML(metric, view = 'all') {
  const m = METRICS[metric];
  const opts = Object.entries(METRICS).map(([k, v]) => `<option value="${k}" ${k === metric ? 'selected' : ''}>${v.label}</option>`).join('');
  let ramp = '';
  if (m.ramp) {
    ramp = `<div class="ramp" style="background:linear-gradient(to right,${m.ramp.join(',')})"></div>
      <div class="ends"><span>${m.fmt(m.stops[0])}</span><span>${m.fmt(m.stops[m.stops.length - 1])}</span></div>`;
  }
  return `<select id="layerview" title="지도에 그릴 교통망">${Object.entries(LAYER_VIEWS).map(([k, v]) => `<option value="${k}" ${k === view ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select id="metric">${opts}</select>${ramp}
    <div class="lg-more"><div style="margin-top:6px">도로 혼잡도 (V/C, 0~10)</div>
    <div class="ramp" style="background:linear-gradient(to right,${VC_STOPS.map(([v, c]) => `${c} ${v * 10}%`).join(',')})"></div>
    <div class="ticks">${[0, 1, 2, 4, 7, 10].map((v) => `<span style="left:${v * 10}%">${v}</span>`).join('')}</div>
    <div style="margin-top:6px"><span style="color:#2453c9">━</span> 고속철 <span style="color:#6c3fa0">━</span> 일반철도 <span style="color:#1a9a6c">━</span> 도시철도 (노선색)<br>
      <span style="color:#b04a9c">●</span> 공항·항공 노선 <span style="color:#2b7bb9">┅</span> 여객선 <span style="color:#7a7f86">┅</span> 국경 연결<br>(굵기·크기 = 이용객)</div></div>`;
}

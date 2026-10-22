// MapLibre 지도와 레이어. 존 단계구분도, 도로(혼잡도), 철도(교통량), 역·IC 라벨, 그리기 미리보기.

const BASE_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0ec' } }],
};

export const METRICS = {
  none: { label: '표시 안 함' },
  pop: { label: '인구', ramp: ['#f7f4ea', '#f2c48d', '#d9682e', '#8f2318'], stops: [0, 100000, 400000, 1000000], fmt: (v) => `${Math.round(v / 1000).toLocaleString()}천` },
  popChange: { label: '인구 변화 (시작 대비)', ramp: ['#b2182b', '#f4a582', '#f7f7f7', '#92c5de', '#2166ac'], stops: [-0.3, -0.1, 0, 0.1, 0.3], fmt: (v) => `${(v * 100).toFixed(0)}%` },
  hdi: { label: '인간개발지수 (HDI)', ramp: ['#8f2318', '#e88a3c', '#f5e08a', '#7fc29b', '#1f6f4a'], stops: [0.55, 0.65, 0.75, 0.85, 0.95], fmt: (v) => v.toFixed(2) },
  income: { label: '1인당 소득 (PPP $)', ramp: ['#f7f4ea', '#c7d9ee', '#5b8fd1', '#1d3f8f'], stops: [2000, 10000, 30000, 60000], fmt: (v) => `$${Math.round(v / 1000)}k` },
  access: { label: '접근성 (상대)', ramp: ['#f7f4ea', '#c8e0b4', '#5aa36b', '#1d5c3a'], stops: [0.2, 0.6, 1.2, 2.5], fmt: (v) => v.toFixed(1) },
};

export async function createMap(container) {
  let style = BASE_STYLE;
  try {
    const r = await fetch(BASE_STYLE, { method: 'GET' });
    if (!r.ok) style = FALLBACK_STYLE;
  } catch { style = FALLBACK_STYLE; }
  const map = new maplibregl.Map({
    container, style, center: [127.4, 38.6], zoom: 5.6, minZoom: 4, maxZoom: 14,
    attributionControl: { compact: true, customAttribution: '데이터 © OpenStreetMap 기여자 (ODbL), WorldPop (CC BY 4.0)' },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  await new Promise((res) => map.on('load', res));
  return map;
}

/** 지도 위 라벨을 가리지 않도록, 배경지도의 첫 심볼 레이어 아래에 넣는다 */
function firstSymbolId(map) {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

export function addLayers(map, zonesFC, linksFC) {
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

  map.addSource('links', { type: 'geojson', data: linksFC, promoteId: 'id' });
  const vcColor = ['interpolate', ['linear'], ['coalesce', ['feature-state', 'vc'], 0],
    0, '#3f9e63', 0.6, '#c5c23a', 0.85, '#e8962c', 1.0, '#d9452f', 1.3, '#7d1d16'];
  map.addLayer({
    id: 'roads', type: 'line', source: 'links', filter: ['all', ['==', ['get', 'mode'], 0], ['==', ['get', 'building'], 0]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': vcColor,
      'line-width': ['interpolate', ['linear'], ['zoom'],
        5, ['match', ['get', 'cls'], 'motorway', 2, 'trunk', 1.2, 'primary', 0.7, 0.4],
        10, ['match', ['get', 'cls'], 'motorway', 6, 'trunk', 4, 'primary', 2.5, 1.5]],
    },
  });
  map.addLayer({
    id: 'rails', type: 'line', source: 'links', filter: ['all', ['==', ['get', 'mode'], 1], ['==', ['get', 'building'], 0]],
    paint: {
      'line-color': ['case', ['==', ['get', 'cls'], 'hsr'], '#2453c9', '#6c3fa0'],
      'line-width': ['interpolate', ['linear'], ['coalesce', ['feature-state', 'vol'], 0], 0, 1, 20000, 1.8, 100000, 3.5, 400000, 7],
    },
  });
  // 공사 중인 신설 노선은 회색 점선
  map.addLayer({
    id: 'building', type: 'line', source: 'links', filter: ['==', ['get', 'building'], 1],
    paint: { 'line-color': '#8a8f96', 'line-width': 3, 'line-dasharray': [2, 1.5] },
  });
  map.addLayer({
    id: 'links-sel', type: 'line', source: 'links',
    paint: { 'line-color': '#1f5fbf', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 9, 0], 'line-opacity': 0.35 },
  });

  map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'points', type: 'circle', source: 'points',
    filter: ['any', ['==', ['get', 'isNew'], 1], ['>=', ['zoom'], ['match', ['get', 'kind'], 'station', 7, 9]]],
    paint: {
      'circle-radius': ['match', ['get', 'kind'], 'station', 4, 3],
      'circle-color': ['match', ['get', 'kind'], 'station', '#ffffff', '#1d232b'],
      'circle-stroke-color': ['match', ['get', 'kind'], 'station', '#6c3fa0', '#ffffff'],
      'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'point-labels', type: 'symbol', source: 'points',
    filter: ['any', ['==', ['get', 'isNew'], 1], ['>=', ['zoom'], ['match', ['get', 'kind'], 'station', 8, 10]]],
    layout: {
      'text-field': ['get', 'name'], 'text-size': ['case', ['==', ['get', 'isNew'], 1], 13, 11],
      'text-offset': [0, 1.0], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'],
    },
    paint: { 'text-color': '#1d232b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
  });

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

export function legendHTML(metric) {
  const m = METRICS[metric];
  const opts = Object.entries(METRICS).map(([k, v]) => `<option value="${k}" ${k === metric ? 'selected' : ''}>${v.label}</option>`).join('');
  let ramp = '';
  if (m.ramp) {
    ramp = `<div class="ramp" style="background:linear-gradient(to right,${m.ramp.join(',')})"></div>
      <div class="ends"><span>${m.fmt(m.stops[0])}</span><span>${m.fmt(m.stops[m.stops.length - 1])}</span></div>`;
  }
  return `<select id="metric">${opts}</select>${ramp}
    <div style="margin-top:6px">도로 혼잡도 (V/C)</div>
    <div class="ramp" style="background:linear-gradient(to right,#3f9e63,#c5c23a,#e8962c,#d9452f,#7d1d16)"></div>
    <div class="ends"><span>여유</span><span>1.0</span><span>정체</span></div>
    <div style="margin-top:6px"><span style="color:#2453c9">━</span> 고속철 <span style="color:#6c3fa0">━</span> 일반철도 (굵기 = 이용객)</div>`;
}

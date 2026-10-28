// 택지지구 개발: 입지 점수·경계 그리기·입주.
import { formatWon, KP_COST_FACTOR } from '../game/catalog.js';
import { HOUSING, housingPlan, startHousing } from '../game/housing.js';
import { countyDisplayName, isMetroCity, regionOf } from '../game/local.js';
import { stem } from '../game/naming.js';
import { icCost, jctCost, nearestLocalRoad, restCost, startICAdd, startJCTAdd, startRestAdd, startStationAdd, stationCost } from '../game/points.js';
import { addNewNode, addPlannedRoad, isKP, linkAt, NEW_BUILDS, save } from '../game/state.js';
import { loadTerrain, terrainAt, terrainReady } from '../game/terrain.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { smoothRing } from '../ui/map.js';
import { toast } from '../ui/panel.js';
import { base, CLASS_LABEL, draft, esc, grid, isForeign, map, metric, namer, result, selection, setMetric, state, subsFC, zoneProps } from './core.js';
import { zoneName } from './year.js';
import { allLinks, nodeCoord, paintZones, refreshLinks, refreshPoints } from './mapdata.js';
import { subCountyName, subName, subRegion } from './region.js';
import { select } from './interact.js';
import { cancelDraft, endDraftView, fmtPeople, metricBeforeDraft, nearestOnLink, popNear, setMetricBeforeDraft, startDraft } from './draw.js';
import { drawDraft, nameDraftPoint } from './route.js';
import { renderAll, renderBuild, renderLegend } from './panels.js';
import { renderSelection } from './econ.js';
import { railStationSet } from './svc.js';
import { startedNotice } from './plans.js';
import { countyZones } from './election.js';
import { guOfSub } from './bungu.js';
import { onLand } from './straighten.js';
import { buildNow, runPreview } from './preview.js';
import { header } from './svcmap.js';
import { popWithin, stationNameHints } from './gazette.js';
import { zoneAtPoint } from './transfer.js';

/**
 * 1km 인구 격자 + 택지지구·역세권 개발에 들어온 인구. 지도 밀도, 역 반경 인구, 택지지구 입지 점수, 시뮬레이션의 역세권이 이것을 쓴다.
 * (예전에는 자료 격자를 그대로 써서, 입주한 사람이 시군구·읍면동 인구에는 들지만 지도와 역세권에는 보이지 않았다)
 * 택지지구는 그린 경계(없으면 면적만큼의 원) 안 30″ 칸 자리마다 고르게 나눈 새 칸으로 넣는다
 * (자료 칸은 30″ 눈금에 꼭 맞지 않아, 가까운 자료 칸에 얹으면 인구가 지구 경계 밖에 보이기도 했다: 상세 인구에서도 지구 안에 산다)
 */
export const GRID_STEP = 1 / 120;   // 자료 격자 간격 30″ (약 0.9km)
export let gridEff = null;
/**
 * 택지지구 자리 이름: 광역 단체 · 시군(분구했으면 시 + 구) · 읍면동. 지구 가운데가 든 읍면동으로 센다
 * (예전에는 존 이름만 써서 분구한 시에서는 엉뚱한 구나 빈 이름이 나왔다)
 */
export function housingPlace(h, short = false) {
  const i = h.zone >= 0 && zoneProps[h.zone] ? cellSub(h.zone, h.lon, h.lat) : -1;
  if (i < 0) return zoneName(h.zone) || '';
  const parts = [short ? '' : subRegion(i), subCountyName(i), guOfSub(i) || '', subName(i)];
  const out = [];
  for (const p of parts) for (const w of String(p).split(' ')) if (w && !out.includes(w)) out.push(w);
  return out.join(' ');
}

/** 택지지구가 덮는 칸 자리 (그린 경계, 없으면 면적만큼의 원, 반 칸 간격) */
export function housingCells(a) {
  const r = Math.sqrt(a.km2 / Math.PI) / 111;
  const ring = a.ring?.length > 2 ? a.ring : null;
  const xs = ring ? ring.map((q) => q[0]) : [a.lon - r / Math.cos((a.lat * Math.PI) / 180), a.lon + r / Math.cos((a.lat * Math.PI) / 180)];
  const ys = ring ? ring.map((q) => q[1]) : [a.lat - r, a.lat + r];
  const cells = [], st = GRID_STEP / 2;
  for (let i = Math.round(Math.min(...xs) / st); i <= Math.round(Math.max(...xs) / st); i++) {
    for (let j = Math.round(Math.min(...ys) / st); j <= Math.round(Math.max(...ys) / st); j++) {
      const x = i * st, y = j * st;
      if (ring ? inRing(x, y, ring) : kmBetween(x, y, a.lon, a.lat) <= r * 111) cells.push([x, y]);
    }
  }
  if (!cells.length) cells.push([a.lon, a.lat]);
  return cells;
}

/** 칸이 속한 읍면동: 그 시군의 읍면동 경계 안이면 그곳, 아니면 가장 가까운 그 시군 읍면동 */
export function cellSub(zone, x, y) {
  let best = -1, bd = Infinity;
  for (const z of countyZones(zone)) {
    const zp = zoneProps[z];
    for (let k = 0; k < zp.subs.length; k++) {
      const i = zp.sub0 + k, g = subsFC?.features[i]?.geometry;
      const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
      if (polys.some((pg) => inRing(x, y, pg[0]))) return i;
      const d = (zp.subs[k][0] - x) ** 2 + (zp.subs[k][1] - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}

/** 택지지구가 덮는 읍면동과 몫 [{sub, share}]: 지구 칸이 그 읍면동에 든 만큼 (인구를 한 읍면동에 몰지 않고 나눠 넣는다) */
export const housingPartsMemo = new Map();
export function housingParts(h) {
  const a = { lon: h.lon, lat: h.lat, ring: h.ring, km2: Math.max(0.5, Math.PI * housingR(h) ** 2), zone: h.zone };
  const key = `${h.id}|${a.lon}|${a.lat}|${a.km2}|${h.ring?.length || 0}`;
  if (housingPartsMemo.has(key)) return housingPartsMemo.get(key);
  const cells = housingCells(a), cnt = new Map();
  for (const [x, y] of cells) { const s = cellSub(h.zone, x, y); if (s >= 0) cnt.set(s, (cnt.get(s) || 0) + 1); }
  const parts = [...cnt].map(([sub, c]) => ({ sub, share: c / cells.length }));
  housingPartsMemo.set(key, parts);
  return parts;
}

/** 지금까지 입주한 택지지구·역세권 개발 (자리, 입주 인구, 면적) */
export function settledDevelopments() {
  const adds = [];
  for (const h of state?.housing || []) {
    const persons = h.phases ? h.occupied || 0 : h.done ? h.persons : 0;
    if (persons > 0) adds.push({ persons, lon: h.lon, lat: h.lat, ring: h.ring, km2: Math.max(0.5, Math.PI * housingR(h) ** 2), zone: h.zone, hid: h.id });   // 지도에 그린 단지 넓이 안에
  }
  for (const d of state?.devels || []) if (d.done && d.persons > 0) adds.push({ persons: d.persons, lon: d.lon, lat: d.lat, km2: 1, zone: d.zone });
  return adds;
}

export function effectiveGrid() {
  const adds = settledDevelopments();
  const sig = adds.map((a) => `${a.lon.toFixed(4)},${a.lat.toFixed(4)},${Math.round(a.persons)}`).join(';');
  if (gridEff?.sig === sig) return gridEff.grid;
  if (!adds.length) { gridEff = { sig, grid }; return grid; }
  const extra = [];
  for (const a of adds) {
    // 지구 안 칸 자리 (반 칸, 약 450m 간격으로 짚어 작은 지구도 경계 모양대로), 칸마다 그 칸이 든 읍면동
    // (예전에는 모든 칸을 지구 가운데에서 가장 가까운 읍면동 하나에 붙여 큰 지구 인구가 한 읍면동에 몰렸다)
    const cells = housingCells(a);
    if (!zoneProps[a.zone]) continue;
    const each = a.persons / cells.length;
    for (const [x, y] of cells) {
      const sub = cellSub(a.zone, x, y);
      if (sub >= 0) extra.push(x, y, each, sub);
    }
  }
  const g = new Float32Array(grid.length + extra.length);
  g.set(grid);
  g.set(extra, grid.length);
  gridEff = { sig, grid: g };
  return g;
}

// ------------------------------------------------------------ 역·IC 신설 (기존 노선 위 한 점)

// ------------------------------------------------------------ 택지지구 개발

export let housingPick = false;
export let housingDraw = null;   // 경계 그리기 중: {pts: [[경도, 위도], ...]}

export function startHousingPick() {
  cancelDraft();
  housingPick = true;
  housingDraw = null;
  map.getCanvas().style.cursor = 'crosshair';
  map.doubleClickZoom.disable();
  if (metric !== 'subDensity' && metric !== 'density') { setMetricBeforeDraft(metric); setMetric('subDensity'); paintZones(); renderLegend(); }
  housingTool();
  // 평지인지 보려고 지형 격자를 받은 뒤 지금 보이는 곳의 가능 구역을 칠한다 (지도를 옮기면 다시)
  Promise.all([loadTerrain(), loadWater()]).then(() => { if (housingPick) drawHousingSites(); });
  map.on('moveend', drawHousingSites);
  document.addEventListener('keydown', housingKey);
}
export function endHousingPick() {
  if (!housingPick) return;
  housingPick = false;
  housingDraw = null;
  map.getCanvas().style.cursor = '';
  map.doubleClickZoom.enable();
  map.off('moveend', drawHousingSites);
  document.removeEventListener('keydown', housingKey);
  map.getSource('housing-sites')?.setData({ type: 'FeatureCollection', features: [] });
  map.getSource('urban-edge')?.setData({ type: 'FeatureCollection', features: [] });
  map.getSource('housing-draw')?.setData({ type: 'FeatureCollection', features: [] });
  document.getElementById('housing-tool')?.remove();
  endDraftView();
}
export function housingKey(e) {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') endHousingPick();
  if (housingDraw && e.key === 'Enter') finishHousingDraw();
  if (housingDraw && e.key === 'Backspace') { housingDraw.pts.pop(); drawHousingOutline(); }
}

/** 택지지구를 고르는 동안 지도 위에 뜨는 작은 도구: 누른 곳에 놓기 / 경계 그리기, 색 설명 */
export function housingTool() {
  document.getElementById('housing-tool')?.remove();
  const el = document.createElement('div');
  el.id = 'housing-tool';
  el.className = 'map-tool';
  el.innerHTML = `<b>택지지구 개발</b>
    <div class="m">초록 칸: 지을 수 있는 곳 (진할수록 입지가 좋아 분양 수익이 큼 · 철도역·고속도로 IC가 가깝고 둘레 인구가 많은 곳)</div>
    <div class="btns"><button class="small ${housingDraw ? '' : 'primary'}" data-ht="click">누른 곳에 놓기</button>
      <button class="small ${housingDraw ? 'primary' : ''}" data-ht="draw">경계 그리기</button>
      ${housingDraw ? '<button class="small" data-ht="done">완료 (Enter)</button>' : ''}
      <button class="small" data-ht="cancel">취소 (Esc)</button></div>
    ${housingDraw ? `<div class="m">지도를 눌러 꼭짓점을 찍고 완료를 누르세요 (Backspace: 마지막 점 지우기). 면적에 따라 세대 수가 정해집니다 (km²당 ${HOUSING.density.toLocaleString()}세대).</div>` : ''}`;
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ht]');
    if (!b) return;
    if (b.dataset.ht === 'cancel') endHousingPick();
    else if (b.dataset.ht === 'draw') { housingDraw = { pts: [] }; loadWater(); housingTool(); drawHousingOutline(); }
    else if (b.dataset.ht === 'click') { housingDraw = null; housingTool(); drawHousingOutline(); }
    else if (b.dataset.ht === 'done') finishHousingDraw();
  });
  document.getElementById('map').appendChild(el);
}

// ---- 입지 점수: 철도역·고속도로 IC까지 거리와 둘레 수요 (분양 수익과 교통 민원에 쓴다)
export let siteIndex = null;
export function siteIndexes() {
  const sig = `${state.newStations.length}|${state.newLinks.length}|${(state.closedStations || []).length}`;
  if (siteIndex?.sig === sig) return siteIndex;
  const bins = (pts) => {
    const m = new Map();
    for (const c of pts) { if (!c) continue; const k = `${Math.floor(c[0] / 0.1)}:${Math.floor(c[1] / 0.1)}`; if (!m.has(k)) m.set(k, []); m.get(k).push(c); }
    return m;
  };
  const rail = [...railStationSet(), ...(base.metro_stations || []).map(([, n]) => n)].map(nodeCoord);
  const ic = base.junctions.map(([, n]) => nodeCoord(n));
  for (const [k, v] of Object.entries(state.names || {})) if (v.kind === 'IC' || v.kind === 'JCT') ic.push(nodeCoord(+k));
  siteIndex = { sig, rail: bins(rail), ic: bins(ic) };
  return siteIndex;
}
export function nearestKm(binMap, lon, lat, maxKm = 15) {
  const bx = Math.floor(lon / 0.1), by = Math.floor(lat / 0.1);
  let best = Infinity;
  for (let i = bx - 2; i <= bx + 2; i++) for (let j = by - 2; j <= by + 2; j++) {
    for (const c of binMap.get(`${i}:${j}`) || []) { const d = kmBetween(lon, lat, c[0], c[1]); if (d < best) best = d; }
  }
  return Math.min(best, maxKm);
}
/** 입지 점수 0~1과 근거: 철도역(가까울수록, 1km 안 만점·8km 밖 0), 고속도로 IC(2km 안 만점·15km 밖 0), 8km 안 인구(5만 0점·200만 만점) */
export function siteScore(lon, lat) {
  const ix = siteIndexes();
  const railKm = nearestKm(ix.rail, lon, lat), icKm = nearestKm(ix.ic, lon, lat);
  const pop = popNear(lon, lat, 8);
  const sr = Math.max(0, Math.min(1, 1 - (railKm - 1) / 7)), sm = Math.max(0, Math.min(1, 1 - (icKm - 2) / 13));
  const sp = Math.max(0, Math.min(1, Math.log10(Math.max(1, pop) / 5e4) / Math.log10(40)));
  return { score: 0.4 * sr + 0.25 * sm + 0.35 * sp, railKm, icKm, pop };
}

/** 지금 보이는 곳을 칸으로 나눠 택지지구를 놓을 수 있는 칸을 입지 점수로 칠한다 (누를 때와 같은 판정: housingSiteProblem) */
export function drawHousingSites() {
  if (!housingPick || !map) return;
  if (!map.getSource('housing-sites')) {
    map.addSource('housing-sites', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'housing-sites', type: 'fill', source: 'housing-sites',
      paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'sc'], 0, '#e9e4a6', 0.35, '#a6d68a', 0.6, '#4daf4a', 0.85, '#1b6b2f'], 'fill-opacity': 0.4, 'fill-outline-color': 'rgba(0,0,0,0)' } },
    map.getLayer('points') ? 'points' : undefined);
  }
  const z = map.getZoom();
  if (z < 8) { map.getSource('housing-sites').setData({ type: 'FeatureCollection', features: [] }); toast('가능 구역을 보려면 지도를 더 확대하세요.'); return; }
  const b = map.getBounds();
  const cellKm = z >= 11 ? 0.5 : z >= 9.5 ? 1 : 2;
  const lat0 = (b.getSouth() + b.getNorth()) / 2;
  const dy = cellKm / 110.57, dx = cellKm / (111.32 * Math.cos((lat0 * Math.PI) / 180));
  const feats = [];
  for (let y = Math.floor(b.getSouth() / dy) * dy; y < b.getNorth(); y += dy) {
    for (let x = Math.floor(b.getWest() / dx) * dx; x < b.getEast(); x += dx) {
      const cx = x + dx / 2, cy = y + dy / 2;
      // 지구를 시작할 수 있는 칸 (모양은 누르면 땅을 따라 넓힌다): 바다·강·시가지·산지·다른 지구가 아닌 곳
      if (isForeign(cx, cy) || !onLand(cx, cy) || (waterIndex && inRiverOrLake(cx, cy)) || housingPointProblem(cx, cy, { fine: true })) continue;
      feats.push({ type: 'Feature', properties: { sc: Math.round(siteScore(cx, cy).score * 100) / 100 }, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + dx, y], [x + dx, y + dy], [x, y + dy], [x, y]]] } });
    }
  }
  map.getSource('housing-sites').setData({ type: 'FeatureCollection', features: feats });
  drawUrbanEdges();
}

/** 시가지 이름: 광역·특별·직할시면 그 도시(평양 시가지), 시면 시(원산 시가지), 군이면 읍내(장단 읍내) */
export function urbanName(x, y) {
  const z = zoneAtPoint(x, y);
  if (z < 0) return '';
  const zp = zoneProps[z], r = regionOf(state, zp) || '';
  if (isMetroCity(r)) return `${r.replace(/(특별자치시|특별시|광역시|직할시|시)$/, '')} 시가지`;
  const n = (countyDisplayName(state, zp) || zp.name).split(' ')[0];
  return /군$/.test(n) ? `${stem(n)} 읍내` : `${stem(n) || n} 시가지`;
}

/**
 * 택지지구를 고를 때 지금 보이는 곳의 시가지 경계를 점선으로 (장단 읍내, 사리원·평양 시가지처럼 이미 도시인 곳의 테두리).
 * 지구 모양을 넓힐 때와 같은 촘촘한 시가지 판정 (반경 350m 밀도·교차점)
 */
export function drawUrbanEdges() {
  if (!map.getSource('urban-edge')) {
    map.addSource('urban-edge', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'urban-edge', type: 'line', source: 'urban-edge', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-join': 'round' },
      paint: { 'line-color': '#7a4b8c', 'line-width': 1.6, 'line-opacity': 0.85, 'line-dasharray': [2, 1.5] } });
    // 시가지 이름: 평양 시가지, 원산 시가지, 군이면 장단 읍내
    map.addLayer({ id: 'urban-edge-label', type: 'symbol', source: 'urban-edge', filter: ['==', ['geometry-type'], 'Point'],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 13, 'text-allow-overlap': false, 'symbol-sort-key': ['-', 0, ['get', 'n']] },
      paint: { 'text-color': '#5e3570', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
  }
  const z = map.getZoom();
  if (!housingPick || z < 9) { map.getSource('urban-edge').setData({ type: 'FeatureCollection', features: [] }); return; }
  const b = map.getBounds(), lat0 = (b.getSouth() + b.getNorth()) / 2;
  const cell = z >= 11.5 ? 0.15 : z >= 10.5 ? 0.25 : 0.5;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
  const x0 = b.getWest(), y0 = b.getSouth();
  const ni = Math.ceil(((b.getEast() - x0) * kx) / cell), nj = Math.ceil(((b.getNorth() - y0) * ky) / cell);
  if (ni * nj > 40000) return;
  const urban = new Set();
  for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
    const x = x0 + ((i + 0.5) * cell) / kx, y = y0 + ((j + 0.5) * cell) / ky;
    if (popNear(x, y, 0.35) / (Math.PI * 0.35 * 0.35) > HOUSING_SITE.urbanDensity || urbanFabric(x, y, true)) urban.add(`${i},${j}`);
  }
  const lines = traceCells(urban).filter((l) => l.length >= 8)
    .map((l) => smoothRing(l.map(([u, v]) => [x0 + (u * cell) / 2 / kx, y0 + (v * cell) / 2 / ky]), 1))
    .map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...r, r[0]] } }));
  // 이어진 시가지 덩어리마다 이름 하나 (가장 큰 덩어리부터, 같은 이름은 한 번)
  const seen = new Set(), comps = [];
  for (const key of urban) {
    if (seen.has(key)) continue;
    const st = [key], cells = [];
    seen.add(key);
    while (st.length) {
      const c = st.pop(), [i, j] = c.split(',').map(Number);
      cells.push([i, j]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${i + di},${j + dj}`;
        if (urban.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); }
      }
    }
    if (cells.length * cell * cell >= 1.5) comps.push(cells);   // 1.5km² 넘는 시가지만
  }
  comps.sort((a, b) => b.length - a.length);
  const named = new Set(), labels = [];
  for (const cells of comps) {
    // 덩어리 안에서 가운데에 가장 가까운 칸 (휜 시가지도 이름이 시가지 안에)
    const mi = cells.reduce((s0, c) => s0 + c[0], 0) / cells.length, mj = cells.reduce((s0, c) => s0 + c[1], 0) / cells.length;
    const [ci, cj] = cells.reduce((b0, c) => ((c[0] - mi) ** 2 + (c[1] - mj) ** 2 < (b0[0] - mi) ** 2 + (b0[1] - mj) ** 2 ? c : b0));
    const x = x0 + ((ci + 0.5) * cell) / kx, y = y0 + ((cj + 0.5) * cell) / ky;
    const name = urbanName(x, y);
    if (!name || named.has(name)) continue;
    named.add(name);
    labels.push({ type: 'Feature', properties: { name, n: cells.length }, geometry: { type: 'Point', coordinates: [x, y] } });
  }
  map.getSource('urban-edge').setData({ type: 'FeatureCollection', features: [...lines, ...labels] });
}

// 택지지구 자리: 기존 시가지(반경 1km 인구밀도) 밖, 평지(단지 범위 안 표고 차·거칠기), 물·다른 택지지구와 겹치지 않는 곳
export const HOUSING_SITE = { r: { s: 0.6, m: 1.0, l: 1.6, xl: 2.6 },   // xl: 분당 19.6km², 일산 15.7km²
  urbanDensity: 3000, reliefM: 60, roughM: 40, searchKm: 6 };

// 도심(업무지구)은 사는 사람이 적어도 시가지다: 1km 안 도로 교차점·역이 많으면 시가지로 본다
export let fabricGrid = null;
export function urbanFabric(lon, lat, fine = false) {
  if (!fabricGrid) {
    fabricGrid = new Map();
    const st = new Set([...base.stations, ...(base.metro_stations || [])].map((x) => x[1]));
    const deg = new Map();
    base.links.forEach((l) => { if (l.mode === 0) for (const n of [l.a, l.b]) deg.set(n, (deg.get(n) || 0) + 1); });
    base.nodes.forEach((c, n) => {
      const w = st.has(n) ? 4 : (deg.get(n) || 0) >= 3 ? 1 : 0;   // 역은 교차점 4개 몫
      if (!w) return;
      const k = `${Math.floor(c[0] / 0.01)},${Math.floor(c[1] / 0.01)}`;
      fabricGrid.set(k, (fabricGrid.get(k) || 0) + w);
    });
  }
  let n = 0;
  const cx = Math.floor(lon / 0.01), cy = Math.floor(lat / 0.01);
  if (fine) return (fabricGrid.get(`${cx},${cy}`) || 0) >= 6;   // 그 1km 칸 하나에 교차점·역 6개 넘게
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) n += fabricGrid.get(`${cx + dx},${cy + dy}`) || 0;
  return n >= 30;   // 약 2.7km × 3.3km 칸에 교차점·역 30개 넘게
}

/** 택지지구 반지름 (km): 크기 이름 또는 그린 경계의 같은 넓이 원 */
export const housingR = (h) => h.R || HOUSING_SITE.r[h.size] || 1;

/** 경위도 점이 다각형 안인가 */
export function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 한 점이 택지가 될 수 있는가 (그린 경계 안을 훑을 때): null(된다) 또는 까닭 */
export function housingPointProblem(lon, lat, { water = true, fine = false } = {}) {
  // fine: 촘촘한 판정 (반경 350m 밀도, 1km 칸 하나의 교차점): 지구 모양을 넓히거나 그린 경계를 볼 때 시가지 바로 바깥까지 쓸 수 있게
  // (거친 판정은 도시 둘레 1~2km를 통째로 막아 시가지에 붙여 놓을 수 없었다)
  if (fine ? popNear(lon, lat, 0.35) / (Math.PI * 0.35 * 0.35) > HOUSING_SITE.urbanDensity || urbanFabric(lon, lat, true)
    : popNear(lon, lat, 1) / Math.PI > HOUSING_SITE.urbanDensity || urbanFabric(lon, lat)) return '이미 시가지';
  for (const h of state.housing || []) {
    if (h.ring ? inRing(lon, lat, h.ring) : kmBetween(lon, lat, h.lon, h.lat) < housingR(h)) return '다른 택지지구와 겹침';
  }
  if (terrainReady()) {
    const t = terrainAt(lon, lat);
    if (water && (t?.water || t?.sea)) return '물·바다';   // 그린 경계는 정밀한 물 면으로 따로 본다 (지형 격자는 1km 칸이라 물가가 거칠다)
    if (t && t.rough > HOUSING_SITE.roughM) return '산지';
  }
  if (isForeign(lon, lat)) return '국외';
  return null;
}

/** 이 자리에 이 크기의 택지지구를 놓을 수 있는가: null(된다) 또는 안 되는 까닭 */
export function housingSiteProblem(lon, lat, size) {
  const R = HOUSING_SITE.r[size];
  if (popNear(lon, lat, 1) / Math.PI > HOUSING_SITE.urbanDensity || urbanFabric(lon, lat)) return '이미 시가지';
  for (const h of state.housing || []) if (kmBetween(lon, lat, h.lon, h.lat) < R + housingR(h)) return '다른 택지지구와 겹침';
  if (terrainReady()) {
    const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
    const pts = [[0, 0]];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * 2 * Math.PI; pts.push([R * Math.cos(a), R * Math.sin(a)], [R * 0.5 * Math.cos(a), R * 0.5 * Math.sin(a)]); }
    let lo = Infinity, hi = -Infinity;
    for (const [dx, dy] of pts) {
      const t = terrainAt(lon + dx / kx, lat + dy / 110.57);
      if (!t) continue;
      if (t.water || t.sea) return '물·바다에 걸침';
      if (t.rough > HOUSING_SITE.roughM) return '산지';
      lo = Math.min(lo, t.elev); hi = Math.max(hi, t.elev);
    }
    // 넓은 단지일수록 끝과 끝 표고 차가 크다 (분당도 구릉지): 반지름 1.6km 넘으면 그만큼 더 받는다
    if (hi - lo > HOUSING_SITE.reliefM * Math.max(1, R / 1.6)) return '비탈이 심함';
  }
  return null;
}

/** 누른 곳에서 가장 가까운, 지구를 시작할 수 있는 점 (그 점만 본다, 200m씩 넓혀 가며). 없으면 null */
export function findHousingStart(lon, lat) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  for (let r = 0; r <= HOUSING_SITE.searchKm; r += 0.2) {
    const n = r ? Math.max(8, Math.round(r * 15)) : 1;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const x = lon + (r * Math.cos(a)) / kx, y = lat + (r * Math.sin(a)) / 110.57;
      if (onLand(x, y) && !inRiverOrLake(x, y) && !housingPointProblem(x, y, { fine: true })) return { lon: x, lat: y, moved: r };
    }
  }
  return null;
}

/** 누른 곳에서 가장 가까운, 이 크기가 들어갈 자리 (0.5km씩 넓혀 가며 찾는다). 없으면 null */
export function findHousingSite(lon, lat, size) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  for (let r = 0; r <= HOUSING_SITE.searchKm; r += 0.5) {
    const n = r ? Math.max(8, Math.round(r * 6)) : 1;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const x = lon + (r * Math.cos(a)) / kx, y = lat + (r * Math.sin(a)) / 110.57;
      if (!housingSiteProblem(x, y, size)) return { lon: x, lat: y, moved: r };
    }
  }
  return null;
}

/** 택지지구 이름: 놓인 동(없으면 이웃 동·가까운 지명) + 지구, 겹치면 번호 */
export function housingName(lon, lat, zi) {
  const used = new Set((state.housing || []).map((h) => h.name));
  const hints = stationNameHints(lon, lat).filter((h) => !h.sameStation).map((h) => stem(h.name));
  const near = namer ? namer.nearbyPlaces(lon, lat, 8, 3).map((p) => stem(p[0])) : [];
  for (const b of [...hints, ...near, zoneName(zi)]) {
    const nm = `${b}지구`;
    if (!used.has(nm)) return nm;
  }
  for (let i = 2; ; i++) if (!used.has(`${hints[0] || zoneName(zi)}${i}지구`)) return `${hints[0] || zoneName(zi)}${i}지구`;
}

// ---- 경계 그리기
// 강·호수 물 면 (배경 지도 data/base/waterarea.geojson): 경계 안 물은 못 쓰는 땅으로 치지 않고 넓이에서만 뺀다 (가운데로 강이 흐르는 지구)
export let waterIndex = null, waterLoading = null;
export function loadWater() {
  if (waterIndex || waterLoading) return waterLoading;
  waterLoading = fetch('data/base/waterarea.geojson').then((r) => r.json()).then((fc) => {
    waterIndex = [];
    for (const f of fc.features) {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        waterIndex.push({ poly, x0, y0, x1, y1 });
      }
    }
  }).catch(() => { waterIndex = []; });
  return waterLoading;
}
export function inRiverOrLake(lon, lat) {
  for (const e of waterIndex || []) {
    if (lon < e.x0 || lon > e.x1 || lat < e.y0 || lat > e.y1) continue;
    if (inRing(lon, lat, e.poly[0]) && !e.poly.slice(1).some((h) => inRing(lon, lat, h))) return true;
  }
  return false;
}

/**
 * 그린 경계를 쓸 수 있게 다듬는다: 꼭짓점 사이를 곡선으로, 100m 간격으로 촘촘히, 바다로 나간 점은 지구 가운데 쪽으로 해안선까지 당긴다
 * (해안을 경계로 그릴 수 있게). 강·호수 위의 점은 그대로 둔다 (강을 가로지르는 경계)
 */
export function fitHousingRing(raw) {
  const sm = smoothRing(raw);
  const pts = [];
  for (let i = 0; i < sm.length; i++) {
    const a = sm[i], b = sm[(i + 1) % sm.length];
    const n = Math.max(1, Math.ceil(kmBetween(a[0], a[1], b[0], b[1]) / 0.1));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const cx = pts.reduce((t, q) => t + q[0], 0) / pts.length, cy = pts.reduce((t, q) => t + q[1], 0) / pts.length;
  const out = [];
  for (const q of pts) {
    if (onLand(q[0], q[1])) { out.push(q); continue; }
    // 가운데 쪽으로 가며 처음 땅이 나오는 곳을 찾고(40걸음), 그 앞뒤를 반씩 좁혀 해안선에 붙인다
    const at = (t) => [q[0] + (cx - q[0]) * t, q[1] + (cy - q[1]) * t];
    let hi = null;
    for (let k = 1; k <= 40; k++) if (onLand(...at(k / 40))) { hi = k / 40; break; }
    if (hi == null) continue;
    let lo = hi - 1 / 40;
    for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (onLand(...at(m))) hi = m; else lo = m; }
    out.push(at(hi));
  }
  // 거의 같은 자리의 점은 하나로
  return out.filter((q, i) => i === 0 || kmBetween(q[0], q[1], out[i - 1][0], out[i - 1][1]) > 0.02);
}

export function drawHousingOutline() {
  if (!map.getSource('housing-draw')) {
    map.addSource('housing-draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'housing-draw-fill', type: 'fill', source: 'housing-draw', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#e07b1a', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'housing-draw-line', type: 'line', source: 'housing-draw', paint: { 'line-color': '#c0561a', 'line-width': 2, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'housing-draw-pts', type: 'circle', source: 'housing-draw', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#c0561a', 'circle-stroke-width': 2 } });
  }
  const pts = housingDraw?.pts || [];
  const f = pts.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }));
  // 찍은 꼭짓점 사이는 곡선으로 보인다 (착공하면 이 곡선 경계로 짓는다)
  if (pts.length >= 3) { const sm = fitHousingRing(pts); if (sm.length >= 3) f.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...sm, sm[0]]] } }); }
  else if (pts.length === 2) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
  map.getSource('housing-draw').setData({ type: 'FeatureCollection', features: f });
}

/** 다각형 넓이 (km²)와 중심 */
export function ringAreaKm2(ring) {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length, kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0] * kx, y0 = ring[j][1] * ky, x1 = ring[i][0] * kx, y1 = ring[i][1] * ky, f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a /= 2;
  return { km2: Math.abs(a), lon: a ? cx / (6 * a) / kx : ring[0][0], lat: a ? cy / (6 * a) / ky : ring[0][1] };
}

export const HOUSING_DRAW_MAX = 75;   // 직접 그리는 택지지구 최대 넓이 (km²): 세종 행정중심복합도시(73km²)쯤

export async function finishHousingDraw() {
  if ((housingDraw?.pts || []).length < 3) { toast('꼭짓점을 세 개 넘게 찍으세요.'); return; }
  await loadWater();
  const pts = fitHousingRing(housingDraw.pts);   // 곡선 경계, 바다 쪽은 해안선에 붙인다 (넓이·땅 검사·단지 도로도 이 경계로)
  if (pts.length < 3) { toast('경계가 거의 바다에 있습니다. 땅 위에 다시 그리세요.'); return; }
  const whole = ringAreaKm2(pts);
  const { lon, lat } = whole;
  let km2 = whole.km2;
  if (km2 < 0.3) { toast(`너무 좁습니다 (${km2.toFixed(2)}km²). 0.3km² 넘게 그리세요.`); return; }
  if (km2 > HOUSING_DRAW_MAX) { toast(`너무 넓습니다 (${km2.toFixed(1)}km²). ${HOUSING_DRAW_MAX}km² 안으로 그리세요.`); return; }
  // 경계 안을 250m 간격으로 훑어 시가지·산지·물·다른 지구가 15% 넘게 걸리면 안 된다
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), step = 0.25;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const why = new Map();
  let n = 0, bad = 0, wet = 0, all = 0;
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += step / 110.57) {
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step / kx) {
      if (!inRing(x, y, pts)) continue;
      all++;
      // 강·호수·바다는 못 쓰는 땅이 아니라 지구 안의 물: 넓이에서만 뺀다
      if (!onLand(x, y) || inRiverOrLake(x, y)) { wet++; continue; }
      n++;
      const w = housingPointProblem(x, y, { water: false, fine: true });
      if (w) { bad++; why.set(w, (why.get(w) || 0) + 1); }
    }
  }
  if (all && wet) km2 *= (all - wet) / all;
  if (km2 < 0.3) { toast(`물을 빼면 너무 좁습니다 (${km2.toFixed(2)}km²).`); return; }
  if (n && bad / n > 0.15) {
    toast(`경계 안 ${Math.round((bad / n) * 100)}%가 택지로 쓸 수 없는 땅입니다 (${[...why].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / n) * 100)}%`).join(', ')}). 초록 칸 안으로 그리세요.`);
    return;
  }
  const households = Math.max(1000, Math.round((km2 * HOUSING.density) / 100) * 100);
  const ring = pts.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]);
  openHousingDialog({ lon, lat, ring, km2, households });
}

export async function housingClick(e) {
  if (housingDraw) {
    housingDraw.pts.push([e.lngLat.lng, e.lngLat.lat]);
    drawHousingOutline();
    return;
  }
  const lng = e.lngLat.lng, lt = e.lngLat.lat;
  const zi0 = onLand(lng, lt) ? zoneAtPoint(lng, lt) : -1;
  await loadWater();
  // 강 위를 누르면 강이 가운데로 흐르는 지구, 강가(600m 안)를 누르면 강을 경계로 강을 따라 넙데데한 지구
  const rv = riverInfo(lng, lt);
  if (!rv && (!(zi0 >= 0) || zoneProps[zi0]?.ext || !result)) { toast('남북 땅 안을 누르세요.'); return; }
  let lon = lng, lat = lt;
  if (!rv) {
    // 누른 곳이 시가지·산지·물이면 6km 안에서 가장 가까운 쓸 수 있는 점으로 옮긴다 (원 크기를 보지 않아 기존 지구·시가지에 맞붙일 수 있다)
    const site = findHousingStart(lng, lt);
    if (!site) { toast(`여기서 ${HOUSING_SITE.searchKm}km 안에 택지지구를 놓을 평지가 없습니다 (기존 시가지·산지·물 제외).`); return; }
    if (site.moved) {
      map.easeTo({ center: [site.lon, site.lat], duration: 600 });
      toast(`누른 곳(${housingPointProblem(lng, lt, { fine: true }) || '물'})을 피해 ${site.moved.toFixed(1)}km 떨어진 평지로 옮겼습니다.`);
    }
    lon = site.lon; lat = site.lat;
  } else if (rv.mode === 'bank') {
    const w = housingPointProblem(lng, lt, { water: false, fine: true });
    if (w) { toast(`누른 강가가 ${w}이라 놓을 수 없습니다.`); return; }
  }
  openHousingDialog({ lon, lat, zi0: zi0 >= 0 ? zi0 : zoneAtPoint(lon, lat), grow: { crossWater: rv?.mode === 'center', axis: rv?.axis || null, river: rv?.mode || null, bankKm: rv?.mode === 'bank' ? rv.dist : null } });
}

/**
 * 누른 곳 둘레 1.2km의 강·호수: 물 면 점들이 늘어선 방향(강 줄기)과, 누른 곳이 강 위인지(center) 강가인지(bank, 물이 600m 안).
 * 물이 없으면 null. axis: 강 방향 단위 벡터 (동·북 km 기준)
 */
export function riverInfo(lon, lat) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  const onWater = inRiverOrLake(lon, lat);
  const pts = [];
  let nearest = Infinity;
  for (let y = -1.2; y <= 1.2; y += 0.08) {
    for (let x = -1.2; x <= 1.2; x += 0.08) {
      if (x * x + y * y > 1.44 || !inRiverOrLake(lon + x / kx, lat + y / ky)) continue;
      pts.push([x, y]);
      nearest = Math.min(nearest, Math.hypot(x, y));
    }
  }
  if (!onWater && nearest > 0.6) return null;
  if (pts.length < 6) return null;
  const dist = onWater ? 0 : nearest;
  const mx = pts.reduce((t, q) => t + q[0], 0) / pts.length, my = pts.reduce((t, q) => t + q[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { mode: onWater ? 'center' : 'bank', axis: [Math.cos(ang), Math.sin(ang)], dist };
}

/**
 * 칸 묶음('i,j' 집합)의 테두리 고리들: 이웃이 비어 있는 칸 변을 이어 닫힌 고리로. 점은 칸 반 단위 정수 [2i±1, 2j±1]
 */
export function traceCells(filled) {
  const edges = new Map();
  const addE = (a, b) => { const k = `${a[0]},${a[1]}`; if (!edges.has(k)) edges.set(k, []); edges.get(k).push(b); };
  for (const k of filled) {
    const [i, j] = k.split(',').map(Number), x0 = 2 * i - 1, x1 = 2 * i + 1, y0 = 2 * j - 1, y1 = 2 * j + 1;
    if (!filled.has(`${i},${j - 1}`)) addE([x0, y0], [x1, y0]);
    if (!filled.has(`${i + 1},${j}`)) addE([x1, y0], [x1, y1]);
    if (!filled.has(`${i},${j + 1}`)) addE([x1, y1], [x0, y1]);
    if (!filled.has(`${i - 1},${j}`)) addE([x0, y1], [x0, y0]);
  }
  const loops = [];
  for (const [k0, list] of edges) {
    while (list.length) {
      const loop = [k0.split(',').map(Number)];
      let cur = list.pop(), guard = 0;
      while (`${cur[0]},${cur[1]}` !== k0 && guard++ < 200000) {
        loop.push(cur);
        const nx = edges.get(`${cur[0]},${cur[1]}`);
        if (!nx?.length) break;
        cur = nx.pop();
      }
      loops.push(loop);
    }
  }
  return loops;
}

/**
 * 누른 곳에 놓는 택지지구 모양: 100m 칸씩 넓혀 가며 땅 넓이를 채운다 (가까운 칸부터, 이어진 칸만).
 * 바다·다른 택지지구·시가지·산지는 건너뛰어 돌아간다: 갈마반도처럼 바다에 막히면 육지(원산 시내) 쪽으로 퍼진다.
 * crossWater: 강·호수를 건너 넓힌다 (물 칸은 넓이에 넣지 않는다: 강이 가운데로 흐르는 지구).
 * axis: 강 방향. 강가를 누르면(bankKm: 누른 곳에서 물까지 km) 지구 폭이 그 거리의 두 배쯤 되게 강 방향으로 늘인다
 * (강에 가까이 누를수록 얇고 길게). 누른 곳이 무게중심이 되도록 시작점을 옮겨 가며 세 번 다시 넓힌다 (막히면 거기까지).
 * → shape(km2): { ring, km2, lon, lat } 또는 null (둘레에 넓힐 땅이 모자람)
 */
export function growHousingSite(lon, lat, { crossWater = false, axis = null, bankKm = null } = {}) {
  const cell = 0.1, kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  const at = (i, j) => [lon + (i * cell) / kx, lat + (j * cell) / ky];
  const kinds = new Map();   // 칸 종류는 누른 곳 기준 격자에서 한 번만 본다 (크기·시작점을 바꿔 여러 번 넓혀도)
  const kind = (i, j) => {
    const k = i * 4096 + j;
    let t = kinds.get(k);
    if (t) return t;
    const [x, y] = at(i, j);
    t = !onLand(x, y) ? 'sea' : inRiverOrLake(x, y) ? 'water' : housingPointProblem(x, y, { water: false, fine: true }) ? 'bad' : 'ok';
    kinds.set(k, t);
    return t;
  };
  const pass = (t) => t === 'ok' || (crossWater && t === 'water');
  // 한 번 넓히기: (si, sj)에서 시작, 늘이는 정도 str. 칸 목록과 땅 칸 수
  const grow = (si, sj, want, str) => {
    const dist = (i, j) => {
      const di = i - si, dj = j - sj;
      if (!axis) return di * di + dj * dj;
      const a = di * axis[0] + dj * axis[1], b = -di * axis[1] + dj * axis[0];
      return (a / str) ** 2 + b * b;
    };
    const heap = [];
    const push = (e) => { heap.push(e); for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
      return top;
    };
    const seen = new Set([si * 4096 + sj]);
    const cells = [];
    let land = 0;
    push([0, si, sj]);
    while (heap.length && land < want) {
      const [, i, j] = pop();
      const t = kind(i, j);
      cells.push([i, j]);
      if (t === 'ok') land++;
      if (Math.hypot(i, j) * cell > 8) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj, k = ni * 4096 + nj;
        if (seen.has(k)) continue;
        seen.add(k);
        if (pass(kind(ni, nj))) push([dist(ni, nj), ni, nj]);
      }
    }
    return { cells, land };
  };
  return (km2) => {
    const want = Math.ceil(km2 / (cell * cell));
    // 강가: 폭 ≈ 물까지 거리 × 2 (최소 400m), 넓이를 그 폭으로 나눈 길이만큼 늘인다 (최대 10배)
    const str = axis && bankKm != null ? Math.min(10, Math.max(1.8, km2 / (Math.PI * Math.max(0.2, bankKm) ** 2))) : axis ? 1.8 : 1;
    let si = 0, sj = 0, g = null;
    for (let it = 0; it < 4; it++) {
      if (!pass(kind(si, sj)) && !(si === 0 && sj === 0)) break;
      const r = grow(si, sj, want, str);
      if (r.land < want * 0.9) break;
      // 누른 곳은 늘 지구 안에 있어야 한다 (무게중심을 맞추다 누른 곳이 밖으로 밀려나면 그 전 모양)
      if (g && !r.cells.some(([i, j]) => i === 0 && j === 0)) break;
      g = r;
      // 무게중심(땅 칸)을 누른 곳으로
      let cx = 0, cy = 0, n = 0;
      for (const [i, j] of r.cells) if (kind(i, j) === 'ok') { cx += i; cy += j; n++; }
      const di = Math.round(-cx / n), dj = Math.round(-cy / n);
      if (!di && !dj) break;
      if (!pass(kind(si + di, sj + dj))) break;
      si += di; sj += dj;
    }
    if (!g) return null;
    const filled = new Set(g.cells.map(([i, j]) => `${i},${j}`));
    const best = traceCells(filled).reduce((b, l) => (l.length > b.length ? l : b), []);
    // 꺾이는 점만 남기고, 300m보다 촘촘한 점은 솎아 낸 뒤 곡선으로 (경계 점이 수백 개가 되지 않게)
    const corners = best.filter((q, k) => {
      const a = best[(k - 1 + best.length) % best.length], b = best[(k + 1) % best.length];
      return (q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0]) !== 0;
    });
    const thin = [];
    for (const q of corners) if (!thin.length || Math.hypot(q[0] - thin[thin.length - 1][0], q[1] - thin[thin.length - 1][1]) >= 6) thin.push(q);
    const ring = smoothRing(thin.map(([x, y]) => [lon + (x * cell) / 2 / kx, lat + (y * cell) / 2 / ky]), 2)
      .map((q) => [Math.round(q[0] * 1e5) / 1e5, Math.round(q[1] * 1e5) / 1e5]);
    // 지구 가운데(도로망 중심·이름 자리): 무게중심이 지구 밖이면(초승달 모양 등) 그와 가장 가까운 지구 안 땅 칸
    let c = ringAreaKm2(ring);
    if (!inRing(c.lon, c.lat, ring)) {
      let bd = Infinity, bq = null;
      for (const [i, j] of g.cells) {
        if (kind(i, j) !== 'ok') continue;
        const [x, y] = at(i, j), d = ((x - c.lon) * kx) ** 2 + ((y - c.lat) * ky) ** 2;
        if (d < bd && inRing(x, y, ring)) { bd = d; bq = [x, y]; }
      }
      if (bq) c = { lon: bq[0], lat: bq[1] };
    }
    return { ring, km2: g.land * cell * cell, lon: c.lon, lat: c.lat };
  };
}

/**
 * 택지지구 도로망: 단지 가운데에서 네 방향으로 4차로 간선도로(십자 축)를 경계까지 깔고
 * (1기 신도시급은 분당·일산처럼 6차로 간선 두 줄씩을 가로세로로 놓은 # 모양 격자: 교차점 넷, 끝 여덟),
 * 경계 끝마다 바깥 4km 안의 가장 가까운 간선도로 노드에 잇는다. 광역교통개선대책이 있으면 연결도로를 4차로로,
 * 고속도로 IC까지 따로 잇는다(12km 안). 연결도로 공사비(억원)와 링크·노드 계획을 돌려준다 (아직 망에 넣지 않는다)
 */
export function housingRoadPlan({ lon, lat, ring, R, name, levy, households = 0 }) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  const seed = Math.abs(Math.round((lon * 1000 + lat * 777) % 90));
  const ang0 = (seed * Math.PI) / 180;
  // 경계까지 거리: 그린 경계면 반직선과 다각형의 교점, 아니면 원 반지름의 0.95배
  // (ox, oy): 반직선 시작점 (단지 가운데에서 동·북쪽 km)
  const edgeAt = (a, ox = 0, oy = 0) => {
    const ux = Math.cos(a), uy = Math.sin(a);
    if (!ring) {
      const r = R * 0.95, p = ox * ux + oy * uy, t = -p + Math.sqrt(Math.max(0, p * p - ox * ox - oy * oy + r * r));
      return [lon + (ox + t * ux) / kx, lat + (oy + t * uy) / ky];
    }
    let best = null;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][0] - lon) * kx - ox, ay = (ring[j][1] - lat) * ky - oy, bx = (ring[i][0] - lon) * kx - ox, by = (ring[i][1] - lat) * ky - oy;
      const dx = bx - ax, dy = by - ay, den = ux * dy - uy * dx;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * dy - ay * dx) / den, s = (ax * uy - ay * ux) / den;
      if (t > 0 && s >= 0 && s <= 1 && (!best || t < best)) best = t;
    }
    const t = (best || R) * 0.95;
    return [lon + (ox + t * ux) / kx, lat + (oy + t * uy) / ky];
  };
  // 바깥 간선도로 노드 (고속도로 본선 노드는 IC로만 드나든다)
  const roadNodes = new Map();
  allLinks().forEach((l, i) => {
    const e = linkAt(base, state, i);
    if (e.mode !== 0 || e.ext || e.cls === 'motorway' || state.replaced?.[i] || (i >= base.links.length && !l.built)) return;
    if (!['trunk', 'primary', 'secondary'].includes(e.cls)) return;
    for (const n of [l.a, l.b]) roadNodes.set(n, nodeCoord(n));
  });
  const nearestRoad = (p, dir) => {
    let best = null, bd = 4;
    for (const [n, c] of roadNodes) {
      if (!c) continue;
      const d = kmBetween(p[0], p[1], c[0], c[1]);
      if (d >= bd || d < 0.05) continue;
      const vx = (c[0] - p[0]) * kx, vy = (c[1] - p[1]) * ky, vl = Math.hypot(vx, vy) || 1;
      if ((vx * Math.cos(dir) + vy * Math.sin(dir)) / vl < 0.2) continue;   // 단지 바깥쪽으로
      bd = d; best = n;
    }
    return best;
  };
  const arms = [], links = [], nodes = {};
  const stemName = name.replace(/지구$/, '');
  const big = households >= HOUSING.bigTown;
  const ux = Math.cos(ang0), uy = Math.sin(ang0), vx = -uy, vy = ux;
  const at = (a, b) => [lon + (a * ux + b * vx) / kx, lat + (a * uy + b * vy) / ky];   // 단지 축 좌표 (km) → 경위도
  const armDir = [];
  const end = (a, ox, oy) => { const k = arms.length; arms.push(edgeAt(a, ox, oy)); armDir.push(a); nodes[`E${k}`] = arms[k]; return `E${k}`; };
  if (big) {
    // # 모양: 축 방향(u)으로 두 줄, 수직(v)으로 두 줄, 가운데에서 0.42R씩 비켜
    const d = R * 0.42;
    const X = (i, j) => { const key = `X${i}${j}`; nodes[key] ||= at(i ? d : -d, j ? d : -d); return key; };
    const road = (keys, nm) => { for (let k = 0; k + 1 < keys.length; k++) links.push({ from: keys[k], to: keys[k + 1], pts: [nodes[keys[k]], nodes[keys[k + 1]]], attrs: { cls: 'primary', lanes: 6, speed: 60, name: nm } }); };
    for (const j of [0, 1]) {   // u 방향 대로 (v = ±d)
      const s = j ? d : -d, ox = s * vx, oy = s * vy;
      road([end(ang0 + Math.PI, ox, oy), X(0, j), X(1, j), end(ang0, ox, oy)], `${stemName}대로`);
    }
    for (const i of [0, 1]) {   // v 방향 로 (u = ±d)
      const s = i ? d : -d, ox = s * ux, oy = s * uy;
      road([end(ang0 - Math.PI / 2, ox, oy), X(i, 0), X(i, 1), end(ang0 + Math.PI / 2, ox, oy)], `${stemName}로`);
    }
  } else {
    nodes.C = [lon, lat];
    for (let k = 0; k < 4; k++) {
      const e = end(ang0 + (k * Math.PI) / 2, 0, 0);
      links.push({ from: 'C', to: e, pts: [[lon, lat], nodes[e]], attrs: { cls: 'primary', lanes: 4, speed: 50, name: `${stemName}대로` } });
    }
  }
  let connKm = 0;
  for (let k = 0; k < arms.length; k++) {
    const e = arms[k], a = armDir[k];
    const n = nearestRoad(e, a);
    if (n != null) {
      const c = nodeCoord(n);
      connKm += kmBetween(e[0], e[1], c[0], c[1]);
      links.push({ from: `E${k}`, to: n, pts: [e, c], attrs: levy ? { cls: 'trunk', lanes: 4, speed: 60, name: `${name} 연결도로` } : { cls: 'secondary', lanes: 2, speed: 50, name: `${name} 연결도로` } });
    }
  }
  // 광역교통개선대책: 가장 가까운 고속도로 IC까지 4차로 연결도로
  if (levy) {
    let best = null;
    for (const [nm, n] of base.junctions) {
      if (/JCT|분기점|휴게소|졸음쉼터/.test(nm)) continue;
      const c = nodeCoord(n);
      if (!c) continue;
      arms.forEach((e, k) => { const d = kmBetween(e[0], e[1], c[0], c[1]); if (d < 12 && (!best || d < best.d)) best = { d, k, n, nm }; });
    }
    if (best && best.d > 0.3) {
      const e = arms[best.k], c = nodeCoord(best.n);
      connKm += best.d;
      links.push({ from: `E${best.k}`, to: best.n, pts: [e, c], attrs: { cls: 'trunk', lanes: 4, speed: 70, name: `${name} IC 연결도로` }, ic: best.nm });
    }
  }
  const perKm = levy ? NEW_BUILDS.trunk.perKm : 100;
  return { links, nodes, ang: seed, center: [lon, lat], arms, connKm, connCost: Math.round(connKm * 1.1 * perKm * (isKP(lat, lon) ? KP_COST_FACTOR : 1)) };
}

/**
 * 예전 저장: 한때 1기 신도시급을 가운데에서 여덟 방향으로 뻗는 방사형 간선으로 깔았다 → # 모양 격자로 다시 깐다.
 * 옛 간선·연결도로는 걷어 내고(replaced), 새 도로는 옛 도로가 지어졌으면 지은 채로, 공사 중이면 그 사업에 넣는다. 돈은 들지 않는다
 */
export function convertRadialHousingRoads() {
  let n = 0;
  for (const h of state.housing || []) {
    const pid = h.phases?.[0]?.id ?? h.id;
    const p = state.projects.find((x) => x.id === pid);
    const old = (p?.links || []).filter((id) => id >= base.links.length && !state.newLinks[id - base.links.length]?.replaced);
    const nl = (id) => state.newLinks[id - base.links.length];
    const arms = old.filter((id) => /대로$/.test(nl(id)?.name || '') && !/연결도로$/.test(nl(id)?.name || ''));
    const deg = new Map();
    for (const id of arms) for (const v of [nl(id).a, nl(id).b]) deg.set(v, (deg.get(v) || 0) + 1);
    if (Math.max(0, ...deg.values()) < 8) continue;   // 방사형(한 노드에서 여덟 갈래)만
    const built = old.some((id) => nl(id).built);
    const rp = housingRoadPlan({ lon: h.lon, lat: h.lat, ring: h.ring, R: housingR(h), name: h.name, levy: (h.levy || 0) > 0, households: Math.max(h.households || 0, HOUSING.bigTown) });
    for (const id of old) nl(id).replaced = true;
    const ids = addHousingRoads(rp);
    if (built) for (const id of ids) nl(id).built = true;
    p.links = ids;
    h.ang = rp.ang;
    n++;
  }
  if (n) state.log.unshift(`${state.year}년 1기 신도시급 택지지구 ${n}곳의 방사형 간선도로를 # 모양 격자로 다시 깔았습니다.`);
  return n;
}

/** 계획을 망에 넣는다: 새 노드(가운데·교차점·끝)를 만들고 링크를 아직 짓지 않은 상태로 둔다. 링크 id 목록 */
export function addHousingRoads(plan) {
  const node = {};
  for (const [k, c] of Object.entries(plan.nodes)) node[k] = addNewNode(base, state, c[0], c[1]);
  return plan.links.map((r) => addPlannedRoad(base, state, node[r.from], typeof r.to === 'string' ? node[r.to] : r.to, r.pts, r.attrs));
}

/** 택지지구 사업안 창: 입지 점수, 크기(누른 곳) 또는 그린 경계의 세대 수, 단계, 광역교통개선대책, 사업비 */
export function openHousingDialog({ lon, lat, zi0 = -1, ring = null, km2 = null, households = null, grow = null }) {
  const zi = zoneAtPoint(lon, lat) >= 0 ? zoneAtPoint(lon, lat) : zi0;
  const zp = zoneProps[zi];
  let name = housingName(lon, lat, zi);
  // 누른 곳에 놓기: 크기마다 땅을 따라 넓힌 모양 (바다·강·시가지를 피해 돌아간다)
  const shapeOf = grow ? growHousingSite(lon, lat, grow) : null;
  const sc = siteScore(lon, lat);
  const R = ring ? Math.sqrt(km2 / Math.PI) : null;
  endHousingPick();
  const options = ring
    ? [{ key: 'drawn', label: `그린 구역 ${km2.toFixed(1)}km²`, households, R }]
    : shapeOf ? Object.entries(HOUSING.sizes).map(([k, sz]) => {
      const sh = shapeOf(Math.PI * HOUSING_SITE.r[k] ** 2);
      return { key: k, label: sz.label, households: sz.households, R: HOUSING_SITE.r[k], ring: sh?.ring, lon: sh?.lon, lat: sh?.lat, why: sh ? null : '둘레에 넓힐 평지가 모자람' };
    })
    : Object.entries(HOUSING.sizes).map(([k, sz]) => ({ key: k, label: sz.label, households: sz.households, R: HOUSING_SITE.r[k], why: housingSiteProblem(lon, lat, k) }));
  const scoreTxt = `입지 점수 ${Math.round(sc.score * 100)}점 · 철도역 ${sc.railKm >= 15 ? '15km 넘게' : `${sc.railKm.toFixed(1)}km`} · 고속도로 IC ${sc.icKm >= 15 ? '15km 넘게' : `${sc.icKm.toFixed(1)}km`} · 8km 안 인구 ${fmtPeople(sc.pop)}`;
  const rows = options.map((o) => {
    if (o.why) return `<div class="item"><div class="t">${o.label} · ${o.households.toLocaleString()}세대</div><div class="m">이 자리에는 들어가지 않습니다 (${o.why}).</div></div>`;
    const pl = housingPlan({ households: o.households, zone: zp, lat: o.lat ?? lat, lon: o.lon ?? lon, score: sc.score });
    const rp = housingRoadPlan({ lon: o.lon ?? lon, lat: o.lat ?? lat, ring: o.ring ?? ring, R: o.R, name, levy: pl.levy > 0, households: o.households });
    const roadCost = Math.max(0, rp.connCost - pl.levy);   // 연결도로는 분담금으로 놓고, 모자라면 더 낸다
    const phaseSel = o.households >= HOUSING.levyMin
      ? `<label class="m"><input type="checkbox" data-phase="${o.key}"> 2단계로 나눠 짓기 (절반은 ${HOUSING.phase2Lag}년 늦게 준공)</label>` : '';
    return `<div class="item"><div class="t">${o.label} · ${o.households.toLocaleString()}세대 · 입주 ${fmtPeople(pl.persons)} (모두 순증)</div>
      <div class="m">택지 조성 ${formatWon(pl.cost)}${pl.levy ? ` + 광역교통개선대책 분담금 ${formatWon(pl.levy)}` : ''}${roadCost ? ` + 연결도로 ${formatWon(roadCost)}` : ''} · ${pl.years}년 · 분양 수익 ${formatWon(pl.revenue)}</div>
      <div class="m">도로망: 단지 안 ${o.households >= HOUSING.bigTown ? '6차로 간선 가로세로 두 줄씩(# 모양)' : '4차로 간선 십자 축'}, 둘레 간선도로 연결 ${rp.links.filter((r) => /연결도로$/.test(r.attrs.name) && !r.ic).length}곳${rp.links.find((r) => r.ic) ? ` · ${esc(rp.links.find((r) => r.ic).ic)}까지 4차로` : ''} (연결도로 ${rp.connKm.toFixed(1)}km)</div>
      ${phaseSel}
      <button class="small primary" data-housing="${o.key}">착공</button></div>`;
  }).join('');
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true"><h2>택지지구 개발 · <input type="text" id="h-name" value="${esc(name)}" style="font:inherit;width:10em" title="지구 이름 (고칠 수 있습니다)"></h2>
    <p class="setup-intro hint">${esc(zoneName(zi))} · ${scoreTxt}${grow?.river === 'center' ? '<br>강이 지구 가운데로 흐릅니다 (강물은 넓이에서 뺍니다).' : grow?.river === 'bank' ? '<br>강을 경계로 강을 따라 길게 놓습니다.' : ''}<br>지은 세대만큼 인구가 늘고(다 지은 뒤 3년에 걸쳐 입주), 입지 점수가 높을수록 분양 수익이 큽니다.
      ${HOUSING.levyMin.toLocaleString()}세대 넘는 지구는 광역교통개선대책 분담금으로 둘레 간선도로·고속도로 IC까지 4차로 연결도로를 함께 놓습니다.
      ${sc.railKm > HOUSING.complaintKm ? `<br><b>철도역이 ${sc.railKm.toFixed(1)}km 떨어져 있어 입주 뒤 교통 대책 민원이 생깁니다</b> (${HOUSING.complaintKm}km 안에 역을 놓으면 풀립니다).` : ''}</p>
    <div class="setup-body"><div class="list">${rows}</div></div>
    <div class="setup-btns">${sc.railKm > 2 ? '<button class="small" data-housing="rail">연결 철도 그리기</button>' : ''}<span style="flex:1"></span><button class="small" data-housing="cancel">닫기</button></div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-housing]');
    if (!b) return;
    const k = b.dataset.housing;
    if (k === 'rail') {
      // 지구 가운데에서 시작하는 철도 그리기 (가까운 역까지 이어 그린다)
      wrap.remove();
      startDraft('rail1');
      if (draft) { draft.points.push({ node: null, lon, lat, split: null }); nameDraftPoint(draft.points[0], 0); drawDraft(); renderBuild(); }
      map.easeTo({ center: [lon, lat], zoom: 11, duration: 600 });
      toast('지구 가운데에서 시작합니다. 이을 역을 누르세요.');
      return;
    }
    if (k !== 'cancel') {
      const o = options.find((x) => x.key === k);
      name = wrap.querySelector('#h-name')?.value.trim() || name;
      const oRing = o.ring ?? ring, oLon = o.lon ?? lon, oLat = o.lat ?? lat;
      const pl = housingPlan({ households: o.households, zone: zp, lat: oLat, lon: oLon, score: sc.score });
      const rp = housingRoadPlan({ lon: oLon, lat: oLat, ring: oRing, R: o.R, name, levy: pl.levy > 0, households: o.households });
      const roadCost = Math.max(0, rp.connCost - pl.levy);
      const phases = wrap.querySelector(`[data-phase="${k}"]`)?.checked ? 2 : 1;
      const n0 = state.newNodes.length, l0 = state.newLinks.length;
      const roads = addHousingRoads(rp);
      const r = startHousing(state, { name, zone: zi, lon: oLon, lat: oLat, size: oRing ? null : k, ring: oRing, households: o.households, plan: pl, phases, roads, roadCost, score: sc.score, railKm: sc.railKm, ang: rp.ang });
      if (!r.ok) { state.newNodes.length = n0; state.newLinks.length = l0; alert(r.reason); return; }
      const h = state.housing[state.housing.length - 1];
      if (oRing) { h.R = o.R; h.smooth = true; }   // 곡선으로 다듬은 경계 (지도에서 다시 다듬지 않는다)
      save(state); refreshLinks(); renderAll();
      toast(`${name} 택지지구 착공 (${pl.years}년 뒤 준공, 그 뒤 3년에 걸쳐 입주)`);
    }
    wrap.remove();
  });
}

/** 해마다 입주를 마친 택지지구의 교통 민원: 철도역이 멀면 지구 주민 행복도가 깎이고, 가까이 역이 생기면 풀린다 */
export function housingComplaints() {
  for (const h of state.housing || []) {
    if (!h.done || !h.phases) continue;
    const km = siteScore(h.lon, h.lat).railKm;
    h.railKm = km;
    // 민원이 이어지는 동안은 해마다 줄어드는 몫(10%)만큼 다시 깎아 −1을 지킨다
    if (h.complaint && km > HOUSING.complaintKm) { state.happyBonus[h.zone] = (state.happyBonus[h.zone] || 0) - 0.1; continue; }
    if (!h.complaint && km > HOUSING.complaintKm) {
      h.complaint = true;
      state.happyBonus[h.zone] = (state.happyBonus[h.zone] || 0) - 1;
      state.log.unshift(`${state.year}년 ${h.name} 주민 교통 대책 민원: 가장 가까운 철도역이 ${km.toFixed(1)}km (${HOUSING.complaintKm}km 안에 역을 놓으면 풀립니다)`);
    } else if (h.complaint && km <= HOUSING.complaintKm) {
      // 풀리면 더 깎지 않는다 (남은 감점은 해마다 줄어 없어진다)
      h.complaint = false;
      state.log.unshift(`${state.year}년 ${h.name} 교통 대책 민원 해소: 철도역 ${km.toFixed(1)}km`);
    }
  }
}

export const REST_REMOVE_COST = 20;   // 휴게소 철거 (억원)
export let pointAdd = null;   // {kind: 'station'|'ic', pick: {link, lon, lat, mode, name, road}}

export function startPointAdd(kind) {
  endHousingPick();   // 택지지구 고르기 중이면 끝낸다 (지도 클릭을 가로채지 않도록)
  cancelDraft();
  if (!namer) { alert('지명 데이터를 아직 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'); return; }
  pointAdd = { kind, pick: null };
  map.getCanvas().style.cursor = 'crosshair';
  select({ type: 'pointadd' });
}

export function endPointAdd() {
  if (pointAdd?.pick?.reserved) namer.release(pointAdd.pick.name, pointAdd.pick.jct ? 'JCT' : pointAdd.kind === 'ic' ? 'IC' : 'station');
  pointAdd = null;
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  if (selection?.type === 'pointadd') select(null);
}

export function pointAddClick(ll) {
  if (pointAdd.kind === 'rest') {
    const on = nearestOnLink(ll, 0, 16, (l) => l.cls === 'motorway');
    if (!on) return;
    const lon = on.lngLat.lng, lat = on.lngLat.lat, l = linkAt(base, state, on.link);
    if (pointAdd.pick?.reserved) namer.release(pointAdd.pick.name, 'rest');
    pointAdd.pick = { link: on.link, lon, lat, mode: 0, line: l.name || '고속도로', name: namer.suggest(lon, lat, 'rest'), reserved: true };
    map.getSource('draft').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }] });
    renderSelection();
    return;
  }
  const isIC = pointAdd.kind === 'ic';
  const on = isIC ? nearestOnLink(ll, 0, 16, (l) => l.cls === 'motorway')
    : nearestOnLink(ll, 1, 16, (l) => !l.ext) || nearestOnLink(ll, 2, 16);
  if (!on) return;
  const lon = on.lngLat.lng, lat = on.lngLat.lat, l = linkAt(base, state, on.link);
  if (pointAdd.pick?.reserved) namer.release(pointAdd.pick.name, pointAdd.pick.jct ? 'JCT' : isIC ? 'IC' : 'station');
  // 다른 고속도로가 바로 옆(같은 화면 칸)을 지나면 두 고속도로를 잇는 JCT
  const other = isIC ? nearestOnLink(ll, 0, 16, (x) => x.cls === 'motorway' && x.name !== l.name) : null;
  if (other) {
    const nm = namer.suggest(lon, lat, 'JCT');
    pointAdd.pick = { link: on.link, link2: other.link, lon, lat, lon2: other.lngLat.lng, lat2: other.lngLat.lat, mode: 0,
      line: `${l.name || '고속도로'} × ${linkAt(base, state, other.link).name || '고속도로'}`, name: nm, reserved: true, jct: true };
    map.getSource('draft').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }] });
    renderSelection();
    return;
  }
  const pick = { link: on.link, lon, lat, mode: l.mode, line: l.name || CLASS_LABEL[l.cls], name: namer.suggest(lon, lat, isIC ? 'IC' : 'station'), reserved: true };
  if (isIC) {
    const r = nearestLocalRoad(base, state, allLinks().map((_, i) => linkAt(base, state, i)), lon, lat);
    pick.road = r?.node ?? null; pick.roadKm = r?.km ?? null;
  }
  pointAdd.pick = pick;
  const f = [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }];
  if (pick.road != null) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, lat], nodeCoord(pick.road)] } });
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
  renderSelection();
}

export function pointAddCost() {
  const pk = pointAdd.pick;
  if (pointAdd.kind === 'rest') return restCost(pk.lat, pk.lon);
  return pk.jct ? jctCost(pk.lat, pk.lon) : pointAdd.kind === 'ic' ? icCost(pk.roadKm || 0, pk.lat, pk.lon) : stationCost({ mode: pk.mode }, pk.lat, pk.lon);
}

export function pointAddPanel() {
  const isIC = pointAdd.kind === 'ic', pk = pointAdd.pick;
  const title = pointAdd.kind === 'rest' ? '휴게소 신설' : pk?.jct ? 'JCT 신설' : isIC ? 'IC·JCT 신설' : '역 신설';
  if (pointAdd.kind === 'rest') {
    if (!pk) return `${header(title)}<p class="hint">휴게소를 놓을 고속도로 위 한 점을 누르세요.</p>`;
    const c = pointAddCost();
    return `${header(title)}
      <table class="kv"><tr><td>노선</td><td>${esc(pk.line)}</td></tr>
        <tr><td>이름</td><td><input type="text" id="padd-name" value="${esc(pk.name)}" style="width:9em"></td></tr>
        <tr><td>사업비 · 공기</td><td>${formatWon(c.cost)} · ${c.years}년</td></tr></table>
      <p class="hint">다른 곳을 누르면 자리를 옮깁니다. 휴게소는 지도에 표시되는 시설입니다 (통행 계산에는 영향이 없습니다).</p>
      <div class="row" style="display:flex;gap:6px;margin-top:8px"><button class="primary" id="padd-ok">착공</button><button id="padd-cancel">취소</button></div>`;
  }
  if (!pk) {
    return `${header(title)}<p class="hint">${isIC ? '고속도로 위 IC를 놓을 곳을 누르세요. 가장 가까운 일반도로(6km 안)까지 연결도로를 함께 놓습니다. 두 고속도로가 엇갈리는 곳을 누르면 둘을 잇는 JCT가 됩니다.'
      : '역을 놓을 철도·도시철도 노선 위 한 점을 누르세요. 완공되면 그 자리에 역이 생겨 주변 읍면동에서 역까지 가까워집니다.'}</p>`;
  }
  const c = pointAddCost();
  const noRoad = isIC && !pk.jct && pk.road == null;
  return `${header(title)}
    <table class="kv">
      <tr><td>노선</td><td>${esc(pk.line)}</td></tr>
      <tr><td>이름</td><td><input type="text" id="padd-name" value="${esc(pk.name)}" style="width:9em"></td></tr>
      ${pk.jct ? '<tr><td>연결</td><td>두 고속도로를 연결로(램프)로 잇습니다</td></tr>' : ''}
      ${isIC && !pk.jct ? `<tr><td>연결도로</td><td>${noRoad ? '<span class="neg">6km 안에 이을 일반도로가 없습니다</span>' : `${(pk.roadKm * 1.2).toFixed(1)}km (4차로)`}</td></tr>` : ''}
      <tr><td>사업비 · 공기</td><td>${formatWon(c.cost)} · ${c.years}년</td></tr>
      <tr><td>주변 인구 (반경 1·3km)</td><td>${Math.round(popWithin(pk.lon, pk.lat, 1)).toLocaleString()} · ${Math.round(popWithin(pk.lon, pk.lat, 3)).toLocaleString()}명</td></tr>
    </table>
    <p class="hint">다른 곳을 누르면 자리를 옮깁니다.</p>
    <div class="row" style="display:flex;gap:6px;margin-top:8px">
      <button class="primary" id="padd-ok" ${noRoad ? 'disabled' : ''}>착공</button><button id="padd-prev" ${noRoad ? 'disabled' : ''}>효과 미리보기</button><button id="padd-cancel">취소</button></div>`;
}

export function bindPointAdd(el) {
  el.querySelector('.close')?.addEventListener('click', endPointAdd);
  el.querySelector('#padd-cancel')?.addEventListener('click', endPointAdd);
  const nm = el.querySelector('#padd-name');
  if (nm) {
    nm.onchange = () => {
      const v = nm.value.trim();
      if (!v) return;
      if (pointAdd.pick.reserved) namer.release(pointAdd.pick.name, pointAdd.pick.jct ? 'JCT' : pointAdd.kind === 'ic' ? 'IC' : 'station');
      pointAdd.pick.name = v; pointAdd.pick.reserved = false;
    };
  }
  el.querySelector('#padd-ok')?.addEventListener('click', commitPointAdd);
  el.querySelector('#padd-prev')?.addEventListener('click', previewPointAdd);
}

export function doPointAdd(st) {
  const pk = pointAdd.pick;
  if (pointAdd.kind === 'rest') return startRestAdd(base, st, { link: pk.link, lon: pk.lon, lat: pk.lat, name: pk.name });
  if (pk.jct) return startJCTAdd(base, st, { link: pk.link, link2: pk.link2, lon: pk.lon, lat: pk.lat, lon2: pk.lon2, lat2: pk.lat2, name: pk.name });
  return pointAdd.kind === 'ic' ? startICAdd(base, st, { link: pk.link, lon: pk.lon, lat: pk.lat, road: pk.road, name: pk.name })
    : startStationAdd(base, st, { link: pk.link, lon: pk.lon, lat: pk.lat, name: pk.name });
}

export function commitPointAdd() {
  if (!pointAdd?.pick) return;
  const r = doPointAdd(state);
  if (!r.ok) { alert(r.reason); return; }
  pointAdd.pick.reserved = false;
  endPointAdd();
  save(state); refreshLinks(); refreshPoints(); renderAll();
  startedNotice(state.projects[state.projects.length - 1]);
}

export function previewPointAdd() {
  const pk = pointAdd?.pick;
  if (!pk) return;
  const c = pointAddCost(), isIC = pointAdd.kind === 'ic';
  runPreview(`${pk.name} ${isIC ? '' : '역 '}신설 미리보기`, (cl) => {
    const n0 = cl.newLinks.length;
    const r = doPointAdd(cl);
    if (!r.ok) throw new Error(r.reason);
    buildNow(cl, cl.projects[cl.projects.length - 1]);
    return cl.newLinks.slice(n0).map((l) => l.id);
  }, { kind: pointAdd.kind, cost: c.cost, years: c.years, mode: pk.mode, km: pk.jct ? 0.5 : isIC ? (pk.roadKm || 0) * 1.2 : 0, cls: pk.jct ? 'motorway' : isIC ? 'primary' : undefined });
}

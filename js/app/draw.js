// 신설 노선 그리기와 둘레 인구.
import { AIRPORT, formatWon } from '../game/catalog.js';
import { effectiveNetwork, linkAt, linksUnderWork, NEW_BUILDS, save, startAirport } from '../game/state.js';
import { loadTerrain } from '../game/terrain.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { toast } from '../ui/panel.js';
import { base, draft, grid, map, metric, namer, setDraft, setMetric, state } from './core.js';
import { allLinks, nodeCoord, paintZones } from './mapdata.js';
import { select } from './interact.js';
import { renderAll, renderBuild, renderLegend, switchTab } from './panels.js';
import { startedNotice } from './plans.js';
import { effectiveGrid, endHousingPick, endPointAdd, pointAdd } from './housing.js';
import { warmPreview } from './preview.js';

// ------------------------------------------------------------ 신설 그리기

export function startDraft(type) {
  endHousingPick();   // 택지지구 고르기 중이면 끝낸다 (지도 클릭을 가로채지 않도록)
  if (!namer) { alert('지명 데이터를 아직 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'); return; }
  warmPreview();
  if (pointAdd) endPointAdd();
  cancelDraft();
  select(null);
  setDraft({ type, points: [] });
  // 지형 격자는 노선을 처음 그을 때 받는다 (받고 나면 공사비에 터널·교량이 들어가고 '지형 따라 선형 잡기'를 쓸 수 있다)
  loadTerrain().then(() => { if (draft) renderBuild(); });
  map.getCanvas().style.cursor = 'crosshair';
  map.doubleClickZoom.disable();
  // 철도를 그리는 동안은 어디에 사람이 많은지 보이게 읍면동 인구 밀도로 칠한다 (끝나면 원래 보기로)
  if (NEW_BUILDS[type]?.mode >= 1 && metric !== 'subDensity' && metric !== 'density') {
    metricBeforeDraft = metric;
    setMetric('subDensity');
    paintZones(); renderLegend();
    toast('노선을 그리는 동안 읍면동 인구 밀도를 보여 줍니다. 커서 옆 숫자는 역 반경 인구입니다.');
  }
  switchTab('build');
  renderBuild();
}

export let metricBeforeDraft = null;
export function setMetricBeforeDraft(v) { return (metricBeforeDraft = v); }
export function endDraftView() {
  catchLabel(null);
  if (metricBeforeDraft == null) return;
  setMetric(metricBeforeDraft);
  metricBeforeDraft = null;
  paintZones(); renderLegend();
}

/** 역 반경(도시철도 1km, 철도 3km) 인구: 1km 격자를 0.05° 칸으로 묶어 둔 색인으로 빨리 센다 */
export let popBins = null, popBinsGrid = null;
export function popNear(lon, lat, km) {
  const grid = effectiveGrid();
  if (!popBins || popBinsGrid !== grid) {
    popBins = new Map();
    popBinsGrid = grid;
    for (let c = 0; c < grid.length; c += 4) {
      const k = `${Math.floor(grid[c] / 0.05)}:${Math.floor(grid[c + 1] / 0.05)}`;
      if (!popBins.has(k)) popBins.set(k, []);
      popBins.get(k).push(c);
    }
  }
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57, r2 = km * km;
  const bx = Math.floor(lon / 0.05), by = Math.floor(lat / 0.05), rx = Math.ceil(km / kx / 0.05), ry = Math.ceil(km / ky / 0.05);
  let sum = 0;
  for (let i = bx - rx; i <= bx + rx; i++) for (let j = by - ry; j <= by + ry; j++) {
    for (const c of popBins.get(`${i}:${j}`) || []) {
      const dx = (grid[c] - lon) * kx, dy = (grid[c + 1] - lat) * ky;
      if (dx * dx + dy * dy <= r2) sum += grid[c + 2];
    }
  }
  return sum;
}
export const catchKm = (type) => (NEW_BUILDS[type]?.mode === 2 ? 1 : 3);
export function fmtPeople(v) { return v >= 10000 ? `${(v / 10000).toFixed(1)}만 명` : `${Math.round(v).toLocaleString()}명`; }

/** 커서 옆 역 반경 인구 (철도 그리기 중) */
export function catchLabel(e) {
  let el = document.querySelector('#catch');
  if (!e || !draft || !(NEW_BUILDS[draft.type]?.mode >= 1)) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('div'); el.id = 'catch'; document.body.appendChild(el); }
  const km = catchKm(draft.type);
  el.textContent = `반경 ${km}km ${fmtPeople(popNear(e.lngLat.lng, e.lngLat.lat, km))}`;
  const r = map.getContainer().getBoundingClientRect();
  el.style.left = `${r.left + e.point.x + 14}px`;
  el.style.top = `${r.top + e.point.y + 14}px`;
  el.hidden = false;
}

export function cancelDraft() {
  if (!draft) return;
  for (const p of draft.points) if (p.name && p.reserved) namer.release(p.name, p.kind);
  setDraft(null);
  map.getCanvas().style.cursor = '';
  map.doubleClickZoom.enable();
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  endDraftView();
  renderBuild();
}

/** 같은 수단의 노드 집합 (신설 중인 링크 포함) */
export function nodesOfMode(mode) {
  const s = new Set();
  for (const l of allLinks()) {
    const eff = l;
    if (eff.mode === mode) { s.add(eff.a); s.add(eff.b); }
  }
  return s;
}

export function nearestNode(lngLat, mode, maxPx, maxKm) {
  const pt = map.project(lngLat);
  let best = null, bd = Infinity;
  for (const id of nodesOfMode(mode)) {
    const c = nodeCoord(id);
    const km = kmBetween(lngLat.lng, lngLat.lat, c[0], c[1]);
    if (maxKm != null) {
      if (km < bd && km <= maxKm) { bd = km; best = id; }
    } else {
      const q = map.project(c);
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < bd && d <= maxPx) { bd = d; best = id; }
    }
  }
  return best;
}

/** 화면 maxPx 안의 가장 가까운 일반철도·고속철도역 노드 */
export function nearestRailStation(lngLat, maxPx) {
  const pt = map.project(lngLat);
  const st = new Set(effectiveNetwork(base, state).stations);
  let best = null, bd = Infinity;
  for (const id of nodesOfMode(1)) {
    if (!st.has(id)) continue;
    const q = map.project(nodeCoord(id));
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d < bd && d <= maxPx) { bd = d; best = id; }
  }
  return best;
}

/** 공항 신설: 한 번 누른 곳에 공항을 놓는다 */
export function placeAirport(lngLat) {
  const p = namer.nearbyPlaces(lngLat.lng, lngLat.lat)[0];
  const name = `${p ? p[0].replace(/(특별시|광역시|직할시|시|군|구|읍|면|동|리)$/, '') : '신'}공항`;
  if (!confirm(`${name}을(를) 신설할까요? ${formatWon(AIRPORT.build.cost)} · ${AIRPORT.build.years}년`)) return;
  const r = startAirport(state, { lon: lngLat.lng, lat: lngLat.lat, name });
  if (!r.ok) { alert(r.reason); return; }
  cancelDraft();
  save(state); renderAll(); startedNotice(state.projects[state.projects.length - 1]);
}

/** 누른 곳에서 가까운 같은 수단 구간 위의 점 (화면 거리 maxPx 안) */
export function nearestOnLink(lngLat, mode, maxPx, filter = null) {
  const p = map.project(lngLat);
  // 철도만 보기에서는 rails·metro가 숨고 혼잡도 색 rails-vc·metro-vc가 그려진다: 그 층에서도 찾는다 (예전에는 '이 노선에 역 신설'이 안 됐다)
  const layers = (mode === 0 ? ['roads', 'roads-minor', 'roads-motorway', 'roads-casing'] : mode === 1 ? ['rails', 'rails-vc'] : ['metro', 'metro-vc']).filter((id) => map.getLayer(id));
  const box = [[p.x - maxPx, p.y - maxPx], [p.x + maxPx, p.y + maxPx]];
  const work = linksUnderWork(state);
  let best = null;
  for (const f of map.queryRenderedFeatures(box, { layers })) {
    const id = f.properties.id;
    if (work.has(id) || draft?.points.some((q) => q.split === id) || (filter && !filter(linkAt(base, state, id)))) continue;
    const g = allLinks()[id].geom;
    for (let k = 0; k + 3 < g.length; k += 2) {
      if (Number.isNaN(g[k]) || Number.isNaN(g[k + 2])) continue;
      const a = map.project([g[k], g[k + 1]]), b = map.project([g[k + 2], g[k + 3]]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
      if (d <= maxPx && (!best || d < best.d)) {
        best = { d, link: id, lngLat: map.unproject([a.x + t * dx, a.y + t * dy]) };
      }
    }
  }
  return best;
}

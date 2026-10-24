// 계획 노선(data/plans.json)을 지도에 점선으로 그린다. 평소에는 숨기고, 건설 탭 목록에서 계획을 누르면 그 노선만 보인다.
// 그 선을 누르면 계획이 그리기로 열린다 (main.js openPlan).
import { smoothSegments } from '../game/curve.js';

export const PLAN_COLORS = { gtx: '#0b7a8f', hsr: '#2453c9', rail: '#6c3fa0', metro: '#1a9a6c', motorway: '#c0392b', trunk: '#d35400', tunnelRoad: '#c0392b', tunnelRail: '#2453c9' };

export function planLine(p) {
  const pts = p.points.map(([, lon, lat]) => ({ lon, lat }));
  return pts.length > 1 ? smoothSegments(pts, 3).flatMap((s, i) => (i ? s.slice(1) : s)) : [];
}

export function addPlansLayer(map) {
  if (map.getSource('plans')) return;
  map.addSource('plans', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const color = ['match', ['get', 'type'], ...Object.entries(PLAN_COLORS).flat(), '#555'];
  // 흰 바탕 위 굵은 점선: 기존 노선 사이에서도 계획 노선이 눈에 띄게
  map.addLayer({
    id: 'plans-casing', type: 'line', source: 'plans', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4.5, 10, 8], 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'plans-line', type: 'line', source: 'plans', layout: { 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 10, 5], 'line-dasharray': [2, 1.2] },
  });
  map.addLayer({
    id: 'plans-label', type: 'symbol', source: 'plans', minzoom: 6, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Regular'] },
    paint: { 'text-color': color, 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  });
}

/** 계획 하나만 지도에 보인다 (plan이 없으면 지운다). override: 그릴 좌표 (main.js가 기존 노선에 접선으로 붙인 선). 보인 선의 좌표를 돌려준다 */
export function showPlanLine(map, plan, override = null) {
  if (!map.getSource('plans')) return null;
  const line = plan ? override || planLine(plan) : [];
  map.getSource('plans').setData({ type: 'FeatureCollection', features: line.length > 1
    ? [{ type: 'Feature', properties: { id: plan.id, name: plan.name, type: plan.type }, geometry: { type: 'LineString', coordinates: line } }] : [] });
  return line.length > 1 ? line : null;
}

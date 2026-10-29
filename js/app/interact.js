// 지도 상호작용: 누르기·고르기·끌어 고르기.
import { regionOf } from '../game/local.js';
import { t } from '../i18n.js';
import { setZoneOutline } from '../ui/map.js';
import { draft, map, measure, selection, setSelection, state, zoneProps } from './core.js';
import { krRi, loadRiFiles, riAt, riCodeMap } from './mapdata.js';
import { admin, isMetroBody, subAtLngLat, subKey, subRegion, subUnit, unitPick, unitPickClick, unitRepZone } from './region.js';
import { univPick, univPickClick } from './univ.js';
import { catchLabel, placeAirport } from './draw.js';
import { addDraftPoint, draftPress, enableDraftDrag, measureClick } from './route.js';
import { shownPlan } from './panels.js';
import { renderSelection } from './econ.js';
import { openServiceEditor, setSvcEdit, svcEdit } from './svc.js';
import { openPlan } from './plans.js';
import { countyRep, countyZones } from './election.js';
import { drawGuSelection, drawSubsOutline, guEdit, guEditClick, guOfSub, setGuEdit } from './bungu.js';
import { straight, straightenClick } from './straighten.js';
import { housingClick, housingPick, pointAdd, pointAddClick } from './housing.js';
import { secPick, sectionClick, sectionOf, svcPick } from './pick.js';
import { drawServices, serviceEditClick, servicePickClick, showServices } from './svcmap.js';

// ------------------------------------------------------------ 지도 상호작용

export function bindMap() {
  map.on('click', (e) => {
    if (measure) { measureClick(e.lngLat); return; }
    if (straight) { straightenClick(e.lngLat); return; }
    if (secPick) { sectionClick(e.lngLat); return; }
    if (svcPick) { servicePickClick(e.lngLat); return; }
    if (svcEdit && selection?.type === 'service') { serviceEditClick(e.lngLat); return; }
    if (pointAdd) { pointAddClick(e.lngLat); return; }
    if (housingPick) { housingClick(e); return; }
    if (univPick) { univPickClick(e.lngLat); return; }
    if (unitPick) { unitPickClick(e.lngLat); return; }
    if (guEdit) { guEditClick(e.lngLat, e.point); return; }
    if (draft?.type === 'airport') { placeAirport(e.lngLat); return; }
    if (draft) { if (performance.now() - draftPress < 700) return; addDraftPoint(e.lngLat, { pass: !!e.originalEvent?.shiftKey }); return; }
    const box = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
    const pl = shownPlan ? map.queryRenderedFeatures(box, { layers: ['plans-line'] })[0] : null;
    if (pl) { openPlan(pl.properties.id); return; }
    const uv = map.getLayer('univs-dot') ? map.queryRenderedFeatures(box, { layers: ['univs-dot'] })[0] : null;
    if (uv) return select({ type: 'univ', id: uv.properties.key });
    const ap = map.queryRenderedFeatures(box, { layers: ['airports'] })[0];
    if (ap) return select({ type: 'airport', id: ap.properties.id });
    const pt = map.queryRenderedFeatures(box, { layers: ['points'] })[0];
    if (pt) return select({ type: 'node', id: pt.properties.node });
    const ln = map.queryRenderedFeatures(box, { layers: LINK_LAYERS.filter((l) => map.getLayer(l)) })[0];
    // 지도에 그린 운행 계통: 선로를 누르면 선로가 먼저 잡히고(예전에는 1호선·경의중앙선처럼 계통이 지나는 철도를 누르면 계통이 잡혀
    // 선로를 고르기 어려웠다), 선로 곁에 비켜 그린 계통 선을 누르거나 Alt를 누른 채 누르면 계통을 고친다
    const sv = showServices && !e.originalEvent?.shiftKey && (!ln || e.originalEvent?.altKey) && map.getLayer('services-line') ? map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['services-line'] })[0] : null;   // 계통 선은 옆으로 비켜 그려 칸을 넓게
    const svc = sv && state.services.find((x) => x.id === sv.properties.id);
    if (svc) { openServiceEditor(svc.line, svc.cls, svc.id); if (svcEdit && ln) svcEdit.underLink = ln.properties.id; renderSelection(); return; }
    const cl = !ln && map.getLayer('closed-line') ? map.queryRenderedFeatures(box, { layers: ['closed-line'] })[0] : null;
    if (cl) return select({ type: 'closed', id: cl.properties.id });
    if (ln && e.originalEvent?.shiftKey) return toggleMulti(ln.properties.id);
    if (ln) { const sec = sectionOf(ln.properties.id); return select({ type: 'link', id: ln.properties.id, section: sec }); }
    const hs = map.getLayer('housing-fill') ? map.queryRenderedFeatures(e.point, { layers: ['housing-fill'] })[0] : null;
    if (hs?.properties.id) return select({ type: 'housing', id: hs.properties.id });
    // 읍면동·리 지도에서도 한 번 누르면 광역부터 (같은 자리를 다시 누를 때마다 내려간다: drillSelect)
    const zn = map.queryRenderedFeatures(e.point, { layers: ['zones-fill'] })[0];
    // Shift를 누른 채 누르면 시군구를 여럿 골라 함께 본다 (다시 누르면 뺀다)
    if (zn && e.originalEvent?.shiftKey && ['zone', 'zones', 'gu'].includes(selection?.type)) {
      const cur = selection.type === 'zones' ? selection.ids : [countyRep(selection.id)];
      const r = countyRep(zn.id), ids = cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r];
      return select(ids.length > 1 ? { type: 'zones', ids } : ids.length ? { type: 'zone', id: ids[0] } : null);
    }
    if (zn) return drillSelect(zn.id, e.lngLat);
    select(null);
  });
  map.on('dblclick', (e) => { if (draft) { e.preventDefault(); } });
  let catchT = 0;
  map.on('mousemove', (e) => { const t = performance.now(); if (t - catchT < 60) return; catchT = t; catchLabel(e); });
  map.on('mouseout', () => catchLabel(null));
  enableBoxSelect();
  enableDraftDrag();
  for (const l of ['roads', 'roads-minor', 'roads-motorway', 'rails', 'metro', 'rails-vc', 'metro-vc', 'points', 'plans-line', 'closed-line']) {
    map.on('mouseenter', l, () => { if (!draft) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { if (!draft) map.getCanvas().style.cursor = ''; });
  }
}

/**
 * 같은 자리를 누를 때마다 한 단계씩 내려간다: 광역 단체 → 기초 단체(시군, 자치구가 있으면 구) → 읍면동 → 리(북측 면의 리).
 * 다른 곳을 누르거나 맨 아래까지 가면 광역부터 다시. 소속은 소속표를 따른다 (편입·시군구 신설 반영)
 */
export function drillSelect(zid, ll) {
  if (zoneProps[zid].ext || !admin()) return select({ type: 'zone', id: zid });
  const i = subAtLngLat(ll);
  if (i < 0) return select({ type: 'zone', id: zid });
  const a = admin(), r = subRegion(i), u = subUnit(i), emd = a.emdOf[i] || `s:${i}`, rep = unitRepZone(u);
  // 구: 자치구면 기초 단체 자리(광역 → 구 → 동), 일반구(시 안의 구, 새로 나눈 구 포함)면 시 다음 단계(광역 → 시 → 구 → 동)
  const g0 = guOfSub(i), bg = g0 && Object.values(state.local?.bungu || {}).find((x) => x.gu?.[subKey(i)] === g0);
  const split = u.startsWith('split:');
  const autoGu = g0 && !split && bg && !bg.general ? g0 : null, genGu = g0 && (split || bg?.general) ? g0 : null;
  const level2 = split ? { type: 'unit', id: u } : autoGu ? { type: 'gu', id: countyRep(rep), gu: autoGu } : { type: 'zone', id: rep };
  const sel = selection, sameGu = (g) => sel?.type === 'gu' && countyRep(sel.id) === countyRep(rep) && sel.gu === g;
  const inUnit = sel && ((sel.type === 'unit' && sel.id === u) || (sel.type === 'zone' && !split && countyRep(sel.id) === rep) || (autoGu && sameGu(autoGu)));
  const many = (a.emds.get(emd)?.subs.length || 1) > 1, hasRi = !many && krRi?.[i]?.length > 0;
  // 구로 나누지 않은 광역시(광역시 몸통)는 광역 바로 밑이 동
  if (sel?.type === 'region' && sel.id === r) return !g0 && isMetroBody(u) ? select({ type: 'emd', id: emd }) : select(level2);
  if (inUnit && genGu) return select({ type: 'gu', id: countyRep(rep), gu: genGu });
  if (inUnit || (genGu && sameGu(genGu))) {
    if (hasRi) loadRiFiles(ll.lng - 0.05, ll.lat - 0.05, ll.lng + 0.05, ll.lat + 0.05);   // 다음 번 누를 때(리) 바로 고르게 미리 받는다
    return select({ type: 'emd', id: emd });
  }
  // 남측 읍·면: 법정리 (경계를 받은 뒤 누른 자리의 리)
  const toRi = () => riAt(ll, i).then((code) => select(code ? { type: 'ri', id: code } : { type: 'region', id: r }));
  if (sel?.type === 'emd' && sel.id === emd && hasRi) return toRi();
  if (sel?.type === 'ri' && riCodeMap?.get(sel.id)?.sub === i) return riAt(ll, i).then((code) => select(code && code !== sel.id ? { type: 'ri', id: code } : { type: 'region', id: r }));
  if (sel?.type === 'emd' && sel.id === emd) return select(many ? { type: 'sub', id: i } : { type: 'region', id: r });
  if (sel?.type === 'sub' && a.emdOf[sel.id] === emd && many && sel.id !== i) return select({ type: 'sub', id: i });
  return select({ type: 'region', id: r });
}

/** 지도에서 눌러 고를 수 있는 구간 층 (철도만 보기의 혼잡도 색 철도 rails-vc·metro-vc 포함: 그 보기에서는 rails·metro가 숨는다) */
export const LINK_LAYERS = ['rails', 'metro', 'rails-vc', 'metro-vc', 'roads-motorway', 'roads-casing', 'roads', 'roads-minor', 'ferries', 'ext-links', 'links-building'];

/** Shift를 누른 채 끌면 사각형 안의 도로·철도 구간을 한꺼번에 고른다 */
export function enableBoxSelect() {
  map.boxZoom.disable();
  const canvas = map.getCanvasContainer();
  let start = null, box = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('mousedown', (e) => {
    if (!e.shiftKey || e.button !== 0 || draft) return;
    e.preventDefault();
    map.dragPan.disable();
    start = pos(e);
    box = document.createElement('div');
    box.className = 'select-box';
    canvas.appendChild(box);
  }, true);
  window.addEventListener('mousemove', (e) => {
    if (!start) return;
    const [x, y] = pos(e);
    Object.assign(box.style, {
      left: `${Math.min(x, start[0])}px`, top: `${Math.min(y, start[1])}px`,
      width: `${Math.abs(x - start[0])}px`, height: `${Math.abs(y - start[1])}px`,
    });
  });
  window.addEventListener('mouseup', (e) => {
    if (!start) return;
    const end = pos(e);
    box.remove(); box = null;
    map.dragPan.enable();
    const bbox = [[Math.min(start[0], end[0]), Math.min(start[1], end[1])], [Math.max(start[0], end[0]), Math.max(start[1], end[1])]];
    start = null;
    if (bbox[1][0] - bbox[0][0] < 5 && bbox[1][1] - bbox[0][1] < 5) return;
    selectBox(bbox);
  });
}

/** Shift를 누른 채 구간을 누르면 그 구간(이어진 같은 노선 구간째)을 고른 묶음에 더하거나 뺀다: 여러 곳을 한꺼번에 개량 */
export function toggleMulti(id) {
  const sec = sectionOf(id);
  const add = sec?.ids?.length ? sec.ids : [id];
  const cur = selection?.type === 'multi' ? selection.ids
    : selection?.type === 'link' ? (selection.section?.ids || [selection.id]) : [];
  const has = add.every((i) => cur.includes(i));
  const ids = has ? cur.filter((i) => !add.includes(i)) : [...new Set([...cur, ...add])];
  if (selection?.type === 'link') for (const i of cur) map.setFeatureState({ source: 'links', id: i }, { sel: false });
  select(ids.length ? { type: 'multi', ids } : null);
}

/** 화면 좌표 사각형 안의 구간들을 고른다 (QA·키보드 없이도 쓸 수 있게 따로 둔다) */
export function selectBox(bbox) {
  const ids = [...new Set(map.queryRenderedFeatures(bbox, { layers: ['roads', 'roads-minor', 'roads-motorway', 'roads-casing', 'rails', 'metro', 'rails-vc', 'metro-vc'].filter((l) => map.getLayer(l)) }).map((f) => f.properties.id))];
  if (ids.length) select({ type: 'multi', ids });
}

export var selSubIds = [];   // 강조한 읍면동(리) 번호들
export function select(sel) {
  if (selection?.type === 'multi') for (const i of selection.ids) map.setFeatureState({ source: 'links', id: i }, { sel: false });
  if (sel?.type === 'multi') for (const i of sel.ids) map.setFeatureState({ source: 'links', id: i }, { sel: true });
  if (selection?.type === 'link') for (const i of selection.section?.ids || [selection.id]) map.setFeatureState({ source: 'links', id: i }, { sel: false });
  if (selection?.type === 'zone') for (const j of countyZones(selection.id)) map.setFeatureState({ source: 'zones', id: j }, { sel: false });
  for (const i of selSubIds) map.setFeatureState({ source: 'subs', id: i }, { sel: false });
  selSubIds = [];
  if (guEdit && !(sel?.type === 'gu' && countyRep(sel.id) === guEdit.id)) { setGuEdit(null); document.querySelector('.st-menu')?.remove(); map.getCanvas().style.cursor = ''; }
  if (svcEdit && sel?.type !== 'service') { setSvcEdit(null); map.getSource('draft').setData({ type: 'FeatureCollection', features: [] }); drawServices(); }
  setSelection(sel);
  // 여러 리로 된 면(북측)·시군을 고르면 리마다 테두리를 긋지 말고 바깥 테두리만 (예전에는 면 안의 리 경계가 모두 파랗게 보였다)
  const picked = sel?.type === 'sub' ? [sel.id] : sel?.type === 'emd' ? admin()?.emds.get(sel.id)?.subs || [] : sel?.type === 'unit' ? admin()?.unit(sel.id)?.subs || [] : [];
  selSubIds = picked.length === 1 ? picked : [];
  for (const i of selSubIds) map.setFeatureState({ source: 'subs', id: i }, { sel: true });
  drawSubsOutline(picked.length > 1 ? picked : []);
  if (sel?.type === 'link') for (const i of sel.section?.ids || [sel.id]) map.setFeatureState({ source: 'links', id: i }, { sel: true });
  if (map.getLayer('kr-ri-sel')) map.setFilter('kr-ri-sel', ['==', ['get', 'code'], sel?.type === 'ri' ? sel.id : '']);
  setZoneOutline(map, sel?.type === 'zone' ? countyZones(sel.id) : sel?.type === 'zones' ? sel.ids.flatMap((r) => countyZones(r))
    : sel?.type === 'region' ? zoneProps.map((_, j) => j).filter((j) => !zoneProps[j].ext && regionOf(state, zoneProps[j]) === sel.id) : []);
  drawGuSelection(sel?.type === 'gu' ? sel : null);
  renderSelection();
}

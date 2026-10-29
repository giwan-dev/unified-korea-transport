// 두 지점 소요 시간, 그리는 노선의 점 편집·확정.
import { toast } from '../ui/panel.js';
import { setNetworkFilters } from '../ui/map.js';
import { trackHeadings } from '../game/branch.js';
import { KP_COST_FACTOR } from '../game/catalog.js';
import { curveSpeed, easeCurves, minRadiusKm, polylineKm, sharpSpots, smoothSegments, tangentCurve } from '../game/curve.js';
import { autoLineName } from '../game/lines.js';
import { canAfford, effectiveNetwork, isKP, linkAt, NEW_BUILDS, save, splitLink, startNewBuild, reusableRailSegments } from '../game/state.js';
import { loadTerrain, terrainAt, terrainCostFactor, terrainProfile, terrainReady, terrainRoute, terrainRule } from '../game/terrain.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { $, base, draft, esc, isForeign, map, measure, MID_COST, namer, REST, result, setDraft, setMeasure, snap, state, worker } from './core.js';
import { PY_METRO } from './sez.js';
import { allLinks, nodeCoord, nodeNames, refreshLinks, refreshPoints } from './mapdata.js';
import { select } from './interact.js';
import { cancelDraft, endDraftView, nearestNode, nearestOnLink, nearestRailStation } from './draw.js';
import { renderAll, renderBuild, networkFilters } from './panels.js';
import { autoJCTs, plans, startedNotice } from './plans.js';
import { planRetire } from './straighten.js';
import { endHousingPick } from './housing.js';
import { attachRoadEnd } from './compare.js';
import { addContract, pppPlan } from './ppp.js';
import { header } from './svcmap.js';
import { refreshClosed } from './reopen.js';
import { airportName } from './selpanel.js';

// ------------------------------------------------------------ 두 지점 소요 시간

export function startMeasure() {
  endHousingPick();   // 택지지구 고르기 중이면 끝낸다 (지도 클릭을 가로채지 않도록)
  cancelDraft();
  setMeasure({ from: null, to: null });
  map.getCanvas().style.cursor = 'crosshair';
  select(null);
  $('#selection').hidden = false;
  $('#selection').innerHTML = `${header('소요 시간 측정')}<p class="hint">출발지를 지도에서 누르세요.</p>`;
  $('#selection .close').onclick = endMeasure;
}

export function endMeasure() {
  setMeasure(null);
  routeShown = null;
  map.getCanvas().style.cursor = '';
  map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  select(null);
}

export function measureClick(ll) {
  const p = [ll.lng, ll.lat];
  if (!measure.from || measure.to) {
    setMeasure({ from: p, to: null });
    $('#selection').innerHTML = `${header('소요 시간 측정')}<p class="hint">도착지를 누르세요.</p>`;
  } else {
    measure.to = p;
    $('#selection').innerHTML = `${header('소요 시간 측정')}<p class="hint">계산 중…</p>`;
    worker.postMessage({ type: 'route', from: measure.from, to: measure.to });
  }
  $('#selection .close').onclick = endMeasure;
  const pts = [measure.from, measure.to].filter(Boolean).map((c) => ({ type: 'Feature', properties: { k: 'pt' }, geometry: { type: 'Point', coordinates: c } }));
  map.getSource('route').setData({ type: 'FeatureCollection', features: pts });
}

export function fmtMin(m) {
  if (!isFinite(m)) return '–';
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return h ? `${h}시간 ${mm}분` : `${mm}분`;
}

export const ROUTE_MODES = {
  car: { label: '자동차', color: '#e8782c' },
  rail: { label: '철도 (가장 빠른, 고속철 포함)', color: '#2453c9' },
  conv: { label: '일반철도만', color: '#6c3fa0' },
  transit: { label: '대중교통 (버스·도시철도)', color: '#1a9a6c' },
  air: { label: '항공', color: '#b04a9c' },
};
export let routeShown = null;   // 지도에 그릴 수단 (null이면 모두)

export function showRoute(r) {
  if (!measure) return;
  measure.result = r;
  // 경로 색: 수단마다 (map.js의 기본은 승용차·철도 두 색)
  map.setPaintProperty('route-line', 'line-color', ['match', ['get', 'k'], ...Object.entries(ROUTE_MODES).flatMap(([k, v]) => [k, v.color]), '#2453c9']);
  const rows = Object.keys(ROUTE_MODES).filter((k) => r[k]).sort((a, b) => r[a].min - r[b].min);
  const best = rows[0];
  const st = (i) => esc(nodeNames().get(result.stations.node[i])?.name || '');
  // 요금은 백 원 단위로 (예전에는 '69천원'처럼 천 원 단위로 끊겼다)
  const won = (v) => `${(Math.round(v / 100) * 100).toLocaleString()}원`;
  const detail = (k) => {
    const v = r[k];
    if (k === 'car') return `${v.km.toFixed(0)}km · 유류비 등 약 ${won(v.cost)}`;
    if (k === 'rail' || k === 'conv') return `${st(v.s)}→${st(v.t)} · ${v.km.toFixed(0)}km${v.hsrKm > 1 ? ` (고속선 ${v.hsrKm.toFixed(0)}km)` : ''} · 대기 ${Math.round(v.wait)}분 · 약 ${won(v.cost)}`;
    if (k === 'air') return `${esc(airportName(v.a))}→${esc(airportName(v.b))} · 하루 ${v.freq}편 · 약 ${won(v.cost)}`;
    return `${v.metroKm > 0.5 ? `도시철도 ${v.metroKm.toFixed(0)}km · ` : ''}버스 ${(v.busKm || 0).toFixed(0)}km · 약 ${won(v.cost)}`;
  };
  $('#selection').innerHTML = `${header('소요 시간 측정')}
    <p class="hint">직선거리 ${r.crowKm.toFixed(0)}km · 올해 혼잡 반영 · 수단을 누르면 그 경로만 지도에 보입니다.</p>
    <table class="kv route-tbl">${rows.map((k) => `<tr data-route-k="${k}" style="cursor:pointer;${routeShown && routeShown !== k ? 'opacity:.5' : ''}"><td style="white-space:normal">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${ROUTE_MODES[k].color};margin-right:4px"></span>${k === best ? '<b>' : ''}${ROUTE_MODES[k].label}${k === best ? '</b>' : ''}<div class="m">${detail(k)}</div></td><td style="white-space:nowrap;font-weight:600">${fmtMin(r[k].min)}</td></tr>`).join('')
      || '<tr><td>이을 수단이 없습니다</td><td></td></tr>'}</table>
    ${routeShown ? '<button class="small" id="route-all">모든 경로 보기</button>' : ''}
    <p class="hint">다른 두 지점을 누르면 다시 잽니다. 닫기를 누르면 끝납니다.</p>`;
  $('#selection .close').onclick = endMeasure;
  document.querySelectorAll('[data-route-k]').forEach((tr) => { tr.onclick = () => { routeShown = routeShown === tr.dataset.routeK ? null : tr.dataset.routeK; showRoute(r); }; });
  $('#route-all')?.addEventListener('click', () => { routeShown = null; showRoute(r); });
  const feats = [measure.from, measure.to].map((c) => ({ type: 'Feature', properties: { k: 'pt' }, geometry: { type: 'Point', coordinates: c } }));
  for (const k of ['transit', 'conv', 'car', 'rail']) {
    if (!r[k]?.links || (routeShown && routeShown !== k)) continue;
    for (const id of r[k].links) {
      const g = allLinks()[id]?.geom || [], parts = [[]];
      for (let i = 0; i < g.length; i += 2) {
        if (Number.isNaN(g[i])) parts.push([]); else parts[parts.length - 1].push([g[i], g[i + 1]]);
      }
      feats.push({ type: 'Feature', properties: { k }, geometry: { type: 'MultiLineString', coordinates: parts } });
    }
  }
  map.getSource('route').setData({ type: 'FeatureCollection', features: feats });
}

/** 그리는 중인 새 노선 위(18px 안)를 눌렀으면 그 구간 앞뒤 점 사이에 끼울 자리 {index, lon, lat} */
export function draftInsertAt(lngLat) {
  if (!draft || draft.points.length < 2) return null;
  const p = map.project(lngLat);
  // 이미 있는 점 가까이(14px)는 끼우지 않는다 (그 점을 누른 것)
  if (draft.points.some((q) => { const a = map.project([q.lon, q.lat]); return Math.hypot(a.x - p.x, a.y - p.y) < 14; })) return null;
  const segs = smoothSegments(draftPoints());
  let best = null;
  segs.forEach((seg, i) => {
    for (let k = 0; k + 1 < seg.length; k++) {
      const a = map.project(seg[k]), b = map.project(seg[k + 1]);
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
      if (d <= 18 && (!best || d < best.d)) {
        const ll = map.unproject([a.x + t * dx, a.y + t * dy]);
        best = { d, index: i + 1, lon: ll.lng, lat: ll.lat };
      }
    }
  });
  return best;
}

/**
 * 지도를 눌러 점 더하기. 그냥 누르기·Ctrl+누르기: 역(도로는 IC), Shift+누르기: 경유점 (역·IC 없이 선형만 지나는 점).
 * 새 노선 위를 누르면 끝에 잇지 않고 그 자리에 끼운다
 */
export function addDraftPoint(lngLat, { pass = false, explicitStation = null } = {}) {
  const spec = NEW_BUILDS[draft.type];
  const station = explicitStation ?? (spec.mode >= 1 && snap.node ? nearestDraftStation(lngLat, 12) : null);

  const ins = draftInsertAt(lngLat);
  if (pass) {
    const pt = { node: null, lon: lngLat.lng, lat: lngLat.lat, split: null, kind: null, name: null };
    if (ins) draft.points.splice(ins.index, 0, { ...pt, lon: ins.lon, lat: ins.lat }); else draft.points.push(pt);
    drawDraft();
    renderBuild();
    return;
  }
  if (ins) {
    const c = station != null ? nodeCoord(station) : [ins.lon, ins.lat];
    const pt = { node: station, lon: c[0], lat: c[1], split: null, inserted: true };
    draft.points.splice(ins.index, 0, pt);
    nameDraftPoint(pt, ins.index);
    drawDraft();
    renderBuild();
    return;
  }
  const pt = { node: null, lon: lngLat.lng, lat: lngLat.lat, split: null };
  draft.points.push(pt);
  placeDraftPoint(pt, lngLat, station);
  drawDraft();
  renderBuild();
}

/** 점을 누른 자리에 놓는다: 기존 역·노드(24px)나 선(16px), 공항 가까이면 거기에 붙이고 이름을 정한다 */
export function placeDraftPoint(pt, lngLat, explicitStation = null) {
  const station = explicitStation ?? (NEW_BUILDS[draft.type]?.mode >= 1 && snap.node ? nearestDraftStation(lngLat, 12) : null);
  const spec = NEW_BUILDS[draft.type];
  // 노드는 화면 24px, 선은 16px 안이면 붙인다 (정확히 누르지 않아도 되게)
  let node = station ?? (snap.node ? nearestNode(lngLat, spec.mode, 24) : null);
  // 도시철도는 일반철도역에도 붙일 수 있다: 그 역에서 일반철도와 바로 갈아탄다 (환승 연결로 친다)
  if (node == null && snap.node && spec.mode === 2) node = nearestRailStation(lngLat, 24);
  let split = null;
  if (node == null && snap.line) {
    const on = nearestOnLink(lngLat, spec.mode, 16);
    if (on) { split = on.link; lngLat = on.lngLat; }
  }
  // 철도를 공항 가까이 누르면 공항역을 놓는다 (공항철도: 그 공항까지 철도로 갈 수 있어 공항 수요가 는다)
  let airport = null;
  if (node == null && split == null && spec.mode >= 1) {
    const p = map.project(lngLat);
    airport = effectiveNetwork(base, state).airports.filter((a) => !a.ext).find((a) => { const q = map.project([a.lon, a.lat]); return Math.hypot(q.x - p.x, q.y - p.y) < 22; }) || null;
    if (airport) lngLat = { lng: airport.lon, lat: airport.lat };
  }
  const c = node != null ? nodeCoord(node) : [lngLat.lng, lngLat.lat];
  Object.assign(pt, { node, lon: c[0], lat: c[1], split });
  nameDraftPoint(pt, draft.points.indexOf(pt));
  if (airport) {
    if (pt.reserved) namer.release(pt.name, 'station');
    pt.name = `${airportName(airport.id)}공항`; pt.kind = 'station'; pt.reserved = false; pt.auto = false;
  }
}

/**
 * 끌어 옮긴 점을 놓은 자리에 다시 붙인다. 경유점은 그 자리 그대로, 역·IC는 기존 역·선에 다시 붙이고
 * 자동 이름이면 새 자리 이름으로 (직접 지은 이름은 기존 역에 붙지 않는 한 그대로 둔다)
 */
export function moveDraftPoint(i, lngLat) {
  const p = draft?.points[i];
  if (!p) return;
  if (!p.name && !p.kind) { Object.assign(p, { node: null, split: null, lon: lngLat.lng, lat: lngLat.lat }); return; }
  const own = p.auto === false && !p.existing ? { name: p.name, kind: p.kind } : null;
  if (p.reserved) namer.release(p.name, p.kind);
  Object.assign(p, { name: null, kind: null, reserved: false, existing: false, auto: undefined, inserted: undefined });
  placeDraftPoint(p, lngLat);
  if (own && !p.existing && p.kind) {
    if (p.reserved) namer.release(p.name, p.kind);
    Object.assign(p, { name: own.name, auto: false, reserved: true });
    namer.reserve(own.name, p.kind);
  }
}

/** 계획 중인 노선의 역·IC·경유점을 끌어 옮긴다 (누르기만 하면 점이 늘지 않는다) */
export let draftPress = 0;
export function enableDraftDrag() {
  let drag = null;
  map.on('mousedown', 'draft-pts', (e) => {
    if (!draft || draft.type === 'airport' || e.originalEvent.button !== 0 || e.originalEvent.shiftKey) return;
    const i = e.features?.[0]?.properties?.i;
    if (i == null || !draft.points[i]) return;
    map.dragPan.disable();   // 지도 끌기 대신 점 끌기 (preventDefault만으로는 지도가 같이 끌렸다)
    drag = { i, x: e.point.x, y: e.point.y, moved: false };
    // 지도 밖에서 손을 떼면 지도의 mouseup이 오지 않는다: 끌기를 그 자리에서 끝낸다
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const d = drag, p = draft?.points[d.i];
      drag = null;
      map.dragPan.enable();
      if (d.moved && p) { moveDraftPoint(d.i, { lng: p.lon, lat: p.lat }); drawDraft(); renderBuild(); }
    }, { once: true });
    draftPress = performance.now();
  });
  map.on('mousemove', (e) => {
    if (!drag) return;
    const p = draft?.points[drag.i];
    if (!p) { drag = null; return; }
    if (!drag.moved && Math.hypot(e.point.x - drag.x, e.point.y - drag.y) < 4) return;
    drag.moved = true;
    map.getCanvas().style.cursor = 'grabbing';
    p.lon = e.lngLat.lng; p.lat = e.lngLat.lat;
    drawDraft();
  });
  map.on('mouseup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    map.dragPan.enable();
    map.getCanvas().style.cursor = draft ? 'crosshair' : '';
    // 첫 점을 누르기만 하면(점 3개 이상) 클릭으로 넘겨 그 점으로 되돌아오는 순환선이 되게 한다
    if (!d.moved) { if (d.i === 0 && draft?.points.length >= 3) draftPress = 0; return; }
    draftPress = performance.now();
    moveDraftPoint(d.i, e.lngLat);
    drawDraft();
    renderBuild();
  });
}

export function nameDraftPoint(pt) {
  const spec = NEW_BUILDS[draft.type];
  if (pt.via) { pt.kind = null; pt.name = null; return; }
  const existing = pt.node != null ? nodeNames().get(pt.node) : null;
  if (spec.mode >= 1) {
    if (existing && existing.kind === 'station') { pt.name = existing.name; pt.kind = 'station'; pt.existing = true; return; }
    pt.kind = 'station';
    pt.name = namer.suggest(pt.lon, pt.lat, 'station');
    pt.reserved = true;
  } else if (pt.node != null || pt.split != null || pt.inserted) {
    if (existing && existing.kind !== 'station') { pt.name = existing.name; pt.kind = existing.kind; pt.existing = true; return; }
    // 고속도로끼리 만나면 JCT, 고속도로와 일반도로가 만나면 IC
    const newMw = draft.type === 'motorway' || draft.type === 'tunnelRoad';
    const touchesMotorway = pt.split != null ? linkAt(base, state, pt.split).cls === 'motorway'
      : allLinks().some((l, i) => l.mode === 0 && (l.a === pt.node || l.b === pt.node) && linkAt(base, state, i).cls === 'motorway');
    pt.kind = newMw && touchesMotorway ? 'JCT' : newMw || touchesMotorway ? 'IC' : null;
    if (!pt.kind) { pt.name = null; return; }
    pt.name = namer.suggest(pt.lon, pt.lat, pt.kind);
    pt.reserved = true;
  } else {
    pt.kind = null; pt.name = null;
  }
}

/** 기존 노드에서 노선이 뻗는 방향(경위도 단위 벡터)들: 그 노드에 닿은 같은 수단 링크마다 약 1km 앞 점 쪽 */
export function nodeDirs(node, mode) {
  const c = nodeCoord(node), out = [];
  if (!c) return out;
  allLinks().forEach((l, i) => {
    if (l.ext || (l.a !== node && l.b !== node) || linkAt(base, state, i).mode !== mode || / 환승$/.test(l.name || '')) return;
    const g = l.geom || [];
    const pts = [];
    for (let k = 0; k + 1 < g.length; k += 2) if (g[k] === g[k]) pts.push([g[k], g[k + 1]]);
    if (pts.length < 2) return;
    if (kmBetween(c[0], c[1], pts[0][0], pts[0][1]) > kmBetween(c[0], c[1], pts[pts.length - 1][0], pts[pts.length - 1][1])) pts.reverse();
    let q = pts[1];
    for (const p of pts) { q = p; if (kmBetween(c[0], c[1], p[0], p[1]) > 0.4) break; }
    const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (d > 0) out.push([(q[0] - c[0]) / d, (q[1] - c[1]) / d]);
  });
  return out;
}

/** 양 끝이 기존 노드에 붙으면 접선 방향(tan)을 붙인 점 목록: 끝선이면 그 선을 그대로 잇고,
 *  중간이면 기존 선의 두 방향 중 다음 점 쪽 방향으로 갈라져 나간다 (분기·합류가 접선 방향) */
export function withTangents(points, mode) {
  if (points.length < 2) return points;
  const out = points.map((p) => ({ ...p }));
  // 순환선(처음과 끝이 같은 역: GTX-F 대곡): 그 역을 곧게 지나가게 앞뒤 점(끝에서 둘째 → 둘째)을 잇는 방향으로.
  // 기존 선로 방향으로 나가고 들어오게 하면 대곡에서 경의선 방향으로 꺾였다 도는 갈고리(dogleg)가 생겼다
  const first = out[0], last = out[out.length - 1];
  if (out.length > 3 && ((first.node != null && first.node === last.node) || kmBetween(first.lon, first.lat, last.lon, last.lat) < 0.05)) {
    const a = out[out.length - 2], b = out[1], t = [b.lon - a.lon, b.lat - a.lat], tl = Math.hypot(...t) || 1;
    delete first.lead; delete last.lead;
    first.tan = [t[0] / tl, t[1] / tl];
    last.tan = [-t[0] / tl, -t[1] / tl];
    return out;
  }
  for (const [i, j] of [[0, 1], [out.length - 1, out.length - 2]]) {
    const p = out[i], q = out[j];
    delete p.tan; delete p.lead;
    if (p.node == null && p.split == null) continue;
    // 노드에 붙었으면 그 노드에서 뻗는 방향, 선로 중간(아직 자르기 전)이면 그 자리의 선로 앞뒤 방향
    const dirs = p.node != null ? nodeDirs(p.node, mode) : splitDirs(p, mode);
    if (!dirs.length) continue;
    // 각도는 km 공간에서 잰다 (경도 1도가 위도 1도보다 짧아 경위도 그대로 재면 동서 방향 각이 틀어졌다)
    const ck = Math.cos((p.lat * Math.PI) / 180), unit = (v) => { const w = [v[0] * ck, v[1]], n = Math.hypot(...w) || 1; return [w[0] / n, w[1] / n]; };
    const to = unit([q.lon - p.lon, q.lat - p.lat]);
    const cands = dirs.length === 1 ? [[-dirs[0][0], -dirs[0][1]]] : dirs.flatMap((d) => [d, [-d[0], -d[1]]]);
    let best = null, bd = -2;
    for (const d of cands) { const u = unit(d), dot = u[0] * to[0] + u[1] * to[1]; if (dot > bd) { bd = dot; best = d; } }
    // 기존 선로·도로에서 접선 방향으로 갈라져 나간다. 다만 기존 선을 거의 직각(55° 넘게)으로 지나는 곳은 수직 환승 자리로 보고
    // 접선을 두지 않는다 (예전에는 직각 환승역에서도 선로 방향으로 나가려다 S자로 휘었다). 끝 노드에서 잇는 연장은 120°까지 그대로
    const minDot = dirs.length === 1 ? -0.5 : Math.cos((55 * Math.PI) / 180);
    if (best && bd > minDot) {
      p.tan = best;
      if (p.node != null && mode >= 1) Object.assign(p, branchClear(p, q, best, mode));
    }
  }
  return out;
}

/** 노드 n에서 dir 쪽으로 뻗은 같은 수단 선로를 따라간 점들 (노드부터, 곧게 이어지는 다음 구간까지 maxKm) */
export function trackFrom(n, mode, dir, maxKm = 4) {
  const pts = [nodeCoord(n)];
  let node = n, d = dir, km = 0;
  const seen = new Set();
  while (km < maxKm) {
    const c = nodeCoord(node);
    let pick = null, bc = 0.9;
    linksAt(node).forEach(([l, i]) => {
      if (seen.has(i) || l.ext || linkAt(base, state, i).mode !== mode || / 환승$/.test(l.name || '')) return;
      const g = [];
      for (let k = 0; k + 1 < (l.geom || []).length; k += 2) if (l.geom[k] === l.geom[k]) g.push([l.geom[k], l.geom[k + 1]]);
      if (g.length < 2) return;
      if (kmBetween(c[0], c[1], g[0][0], g[0][1]) > kmBetween(c[0], c[1], g[g.length - 1][0], g[g.length - 1][1])) g.reverse();
      const q = g.find((v) => kmBetween(c[0], c[1], v[0], v[1]) > 0.05) || g[g.length - 1];
      const w = [q[0] - c[0], q[1] - c[1]], wl = Math.hypot(...w) || 1;
      const cos = (w[0] * d[0] + w[1] * d[1]) / wl;
      if (cos > bc) { bc = cos; pick = { i, g, other: l.a === node ? l.b : l.a }; }
    });
    if (!pick) break;
    seen.add(pick.i);
    for (const v of pick.g.slice(1)) {
      const u = pts[pts.length - 1];
      km += kmBetween(u[0], u[1], v[0], v[1]);
      pts.push(v);
      if (km >= maxKm) break;
    }
    const u = pts[pts.length - 2], v = pts[pts.length - 1];
    const vl = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
    d = [(v[0] - u[0]) / vl, (v[1] - u[1]) / vl];
    node = pick.other;
  }
  return pts;
}

/** 노드에 닿은 링크들 [[링크, 번호]] (새로 놓은 링크까지, 링크 수가 바뀌면 다시 만든다) */
export let adjCache = null;
export function linksAt(n) {
  const count = base.links.length + state.newLinks.length;
  if (!adjCache || adjCache.count !== count) {
    const all = allLinks(), m = new Map();
    all.forEach((l, i) => { for (const x of [l.a, l.b]) { if (!m.has(x)) m.set(x, []); m.get(x).push([l, i]); } });
    adjCache = { count, m };
  }
  return adjCache.m.get(n) || [];
}

/** 선 ab와 cd가 서로 가로지르는가 */
export function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * 접선 방향으로 나가도 기존 선로를 평면으로 가로지르면(다음 점이 선로 반대편이면 곧 굽어 넘어간다),
 * 그 선로를 따라 나란히 가다가 가로지르지 않고 빠질 수 있는 자리(200m씩, 최대 3km)에서 갈라진다.
 * @returns {{tan:number[], lead?:number[][]}} 갈라지는 자리의 접선과, 노드에서 그 자리까지 선로를 따른 점들
 */
export function branchClear(p, q, tan, mode) {
  const tracks = nodeDirs(p.node, mode).map((d) => trackFrom(p.node, mode, d, 4));
  const along = trackFrom(p.node, mode, tan, 3);
  const crosses = (lead, t) => {
    const curve = tangentCurve([p.lon, p.lat], [q.lon, q.lat], t, null, { lead1: lead, n: 30 });
    const from = Math.max(0, (lead?.length || 1) - 1) + 2;
    for (let k = from; k + 1 < curve.length; k++) {
      for (const tr of tracks) for (let m = 0; m + 1 < tr.length; m++) if (segCross(curve[k], curve[k + 1], tr[m], tr[m + 1])) return true;
    }
    return false;
  };
  if (!crosses(null, tan)) return { tan };
  const total = kmBetween(p.lon, p.lat, q.lon, q.lat);
  // 선로를 200m 간격으로 따라가며 갈라질 자리를 찾는다
  const lead = [along[0]];
  let s = 0;
  for (let m = 1; m < along.length; m++) {
    const u = along[m - 1], v = along[m];
    const seg = kmBetween(u[0], u[1], v[0], v[1]);
    const steps = Math.max(1, Math.ceil(seg / 0.2));
    const l = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
    const t = [(v[0] - u[0]) / l, (v[1] - u[1]) / l];
    for (let k = 1; k <= steps; k++) {
      const w = [u[0] + (v[0] - u[0]) * (k / steps), u[1] + (v[1] - u[1]) * (k / steps)];
      s += seg / steps;
      lead.push(w);
      if (s > Math.min(3, total * 0.5)) return { tan };
      if (!crosses(lead, t)) return { tan: t, lead: lead.slice() };
    }
  }
  return { tan };
}

/** 선로 중간 한 점에서 선로가 뻗는 두 방향 (경위도 단위 벡터) */
export function splitDirs(p, mode) {
  const links = allLinks().map((_, i) => (state.replaced?.[i] ? null : linkAt(base, state, i)));
  const ck = Math.cos((p.lat * Math.PI) / 180);
  return trackHeadings(links, nodeCoord, p, (l) => l.mode === mode && !l.ext && !l.replaced).map(([e, n]) => {
    const v = [e / ck, n], d = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / d, v[1] / d];
  });
}

export function draftPoints() {
  return withTangents(draft.points, NEW_BUILDS[draft.type].mode);
}

function draftReuse() {
  if (!draft || !(NEW_BUILDS[draft.type]?.mode >= 1)) return [];
  return reusableRailSegments(base, state, draft.type, draft.points);
}

export function drawDraft() {
  // i: 끌어 옮길 점 번호, pass: 역·IC가 없는 경유점 (작고 속이 빈 점)
  const f = draft.points.map((p, i) => (p.via ? null : { type: 'Feature', properties: { i, pass: p.name || p.kind ? 0 : 1 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })).filter(Boolean);
  if (draft.points.length > 1) {
    const segs = smoothSegments(draftPoints());
    const reuse = draftReuse(), skipped = new Set();
    for (const r of reuse) {
      for (let i = r.fromIndex; i < r.toIndex; i++) skipped.add(i);
      for (const id of r.links) {
        const g = linkAt(base, state, id).geom || [];
        let part = [];
        const flush = () => { if (part.length > 1) f.push({type: 'Feature', properties: {reused: 1}, geometry: {type: 'LineString', coordinates: part}}); part = []; };
        for (let k = 0; k < g.length; k += 2) { if (!Number.isFinite(g[k])) flush(); else part.push([g[k], g[k + 1]]); }
        flush();
      }
    }
    segs.forEach((segment, i) => {
      if (!skipped.has(i)) f.push({type: 'Feature', properties: {reused: 0}, geometry: {type: 'LineString', coordinates: segment}});
    });

    // 급곡선: 설계 속도를 깎는 곡선 자리를 빨간 점과 그 곡선이 허락하는 속도로 (역·IC 사이마다, draftCost의 lims와 같은 셈)
    const spec = NEW_BUILDS[draft.type];
    if (spec.mode !== 2 && spec.attrs?.speed) {
      const stops = draft.points.map((p, i) => i).filter((i) => !draft.points[i].via || i === 0 || i === draft.points.length - 1);
      for (let s0 = 0; s0 + 1 < stops.length; s0++) {
        if (skipped.has(stops[s0])) continue;
        const g = segs.slice(stops[s0], stops[s0 + 1]).flatMap((q, k) => (k ? q.slice(1) : q));
        // 설계 속도를 내는 데 드는 반경보다 급한 곳 (곡선 하나에 점이 몇 개씩 몰리면 가장 급한 하나만)
        const spots = sharpSpots(g, Infinity).filter(([, , r]) => curveSpeed(r, spec.mode) < spec.attrs.speed);
        const kept = [];
        for (const q of spots) {
          const near = kept.find((w) => Math.hypot(w[0] - q[0], w[1] - q[1]) < 0.01);
          if (!near) kept.push(q); else if (q[2] < near[2]) near.splice(0, 3, ...q);
        }
        for (const [x, y, r] of kept) {
          const v = Math.max(curveSpeed(r, spec.mode), 30);
          f.push({ type: 'Feature', properties: { sharp: 1, label: `${v}km/h · R${r < 1 ? `${Math.round(r * 1000)}m` : `${r.toFixed(1)}km`}` }, geometry: { type: 'Point', coordinates: [x, y] } });
        }
      }
    }
  }
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
}

/** 찍은 역·IC(선형 점이 아닌 점) 사이마다 경사·물을 피하는 선형을 잡아 그 사이 선형 점을 바꾼다 */
export function terrainAlign() {
  const rule = terrainRule(draft.type);
  if (!rule || !terrainReady()) return;
  const anchors = draft.points.filter((p) => !p.via);
  // 출발·도착이 기존 선로에 붙어 있으면 그 선로의 접선 방향으로 나가고 들어오게:
  // 끝에서 접선 방향으로 1~4km 나간 '이끎 점'을 선형 점으로 두고, 지형 경로는 이끎 점 사이에서 찾는다
  const tans = withTangents(anchors, NEW_BUILDS[draft.type].mode);
  const first = anchors[0], last = anchors[anchors.length - 1];
  const lead = (p, tan, other) => {
    if (!tan) return null;
    const d = kmBetween(p.lon, p.lat, other.lon, other.lat);
    if (d < 1.5) return null;
    const ck = Math.cos((p.lat * Math.PI) / 180);
    const e = tan[0] * ck, nn = tan[1], m = Math.hypot(e, nn) || 1;   // 경위도 방향 → 실제 거리 L(도)만큼
    // 접선이 상대 끝 쪽과 어긋날수록 곧게 나가는 거리를 줄인다 (75° 넘게 어긋나면 두지 않는다: 크게 돌아 S자가 생긴다)
    const ox = (other.lon - p.lon) * ck, oy = other.lat - p.lat, ol = Math.hypot(ox, oy) || 1;
    const cos = (e * ox + nn * oy) / (m * ol);
    if (cos < 0.26) return null;
    const L = Math.min(4, Math.max(0.5, d * 0.25)) * cos * cos / 111;
    const q = { node: null, lon: p.lon + (e / m) * L / ck, lat: p.lat + (nn / m) * L, split: null, via: true, leadPt: true };
    // 이끎 점이 바다·호수 위면 두지 않는다 (항구역에서 접선이 바다를 향하면 그리로 나갔다가 되돌아 고리가 생긴다)
    const t = terrainAt(q.lon, q.lat);
    if (t && (t.sea || t.water)) return null;
    return q;
  };
  const out = [];
  let changed = 0;
  anchors.forEach((p, k) => {
    out.push(p);
    const q = anchors[k + 1];
    if (!q) return;
    const lo = p === first ? lead(p, tans[0].tan, q) : null;
    const li = q === last ? lead(q, tans[tans.length - 1].tan, p) : null;
    const a = lo || p, b = li || q;
    const via = terrainRoute([a.lon, a.lat], [b.lon, b.lat], rule);
    if (!via) {
      // 경로를 못 찾으면(너무 가깝거나 지형 밖) 원래 선형 점을 그대로 둔다
      const i0 = draft.points.indexOf(p), i1 = draft.points.indexOf(q);
      out.push(...draft.points.slice(i0 + 1, i1));
      return;
    }
    changed++;
    if (lo) out.push(lo);
    for (const [lon, lat] of via) out.push({ node: null, lon, lat, split: null, via: true });
    if (li) out.push(li);
  });
  // 지형 경로는 칸을 따라 꺾이므로, 수단별 최소 곡선반경을 지키게 선형 점을 편다 (역·IC·접선 이끎 점은 그대로)
  const dry = (lon, lat) => { const t = terrainAt(lon, lat); return !(t && t.sea); };
  const kinds = out.map((p) => (!p.via ? 2 : p.leadPt ? 1 : 0));
  draft.points = changed ? easeCurves(out, kinds, rule.minRadiusKm * 1.1, ({ lon, lat }) => ({ node: null, lon, lat, split: null, via: true }), dry) : out;
  drawDraft();
  renderBuild();
  if (!changed) alert('지형을 따를 구간이 없습니다 (점 사이가 3km보다 가깝거나 지형 자료 범위 밖).');
}

export function draftCost() {
  const spec = NEW_BUILDS[draft.type];
  let km = 0, cost = 0, foreignKm = 0;
  const segs = smoothSegments(draftPoints());
  const reuse = draftReuse(), skipped = new Set();
  for (const r of reuse) for (let i = r.fromIndex; i < r.toIndex; i++) skipped.add(i);
  const reusedKm = reuse.reduce((sum, r) => sum + r.km, 0);
  const segFactor = [];
  const rule = terrainReady() ? terrainRule(draft.type) : null;
  const terrain = { km: 0, tunnelKm: 0, bridgeKm: 0, seaKm: 0 };
  for (let i = 0; i + 1 < draft.points.length; i++) {
    if (skipped.has(i)) { segFactor.push(0); continue; }
    const a = draft.points[i], b = draft.points[i + 1];
    const len = polylineKm(segs[i]) * 1.02;
    const kp = isKP(a.lat, a.lon) && isKP(b.lat, b.lon);
    const frac = segs[i].filter(([x, y]) => isForeign(x, y)).length / segs[i].length;
    // 지형: 터널·깎기·교량 구간 비율만큼 단가가 바뀐다 (지형 격자를 받기 전이나 땅 밑 노선은 그대로)
    const prof = rule ? terrainProfile(segs[i], rule) : null;
    if (prof) for (const k of Object.keys(terrain)) terrain[k] += prof[k];
    segFactor.push((1 - 0.5 * frac) * (prof ? terrainCostFactor(prof) : 1));
    foreignKm += len * frac;
    km += len; cost += spec.perKm * len * (kp ? KP_COST_FACTOR : 1) * segFactor[i];
  }
  const mids = draft.points.filter((p) => p.split != null).length;
  const rests = restPositions(segs).length;
  const extraCost = mids * (spec.mode === 0 ? MID_COST.road : MID_COST.rail) + rests * REST.cost;
  // 역·IC 사이마다 가장 급한 곡선이 허락하는 속도: 착공하면 그 구간의 설계 속도가 된다 (startNewBuild와 같은 셈)
  const stops = draft.points.map((p, i) => i).filter((i) => !draft.points[i].via || i === 0 || i === draft.points.length - 1);
  const lims = [];
  for (let s0 = 0; s0 + 1 < stops.length; s0++) {
    if (skipped.has(stops[s0])) continue;
    const g = segs.slice(stops[s0], stops[s0 + 1]).flatMap((q, k) => (k ? q.slice(1) : q));
    const v = spec.mode === 2 ? Infinity : curveSpeed(minRadiusKm(g), spec.mode);
    lims.push({ v: Math.max(Math.min(v, spec.attrs.speed), 30), r: minRadiusKm(g) });
  }
  return { km, reusedKm, reuse, cost: Math.round(cost) + extraCost, extraCost, mids, rests, years: spec.years, segFactor, foreignKm, terrain: rule ? terrain : null, lims };
}

/** 고속도로 휴게소 자리: 곡선을 따라 약 40km마다 (양 끝 20km 안쪽 제외) */
export function restPositions(segs) {
  if (!draft || !['motorway', 'tunnelRoad'].includes(draft.type)) return [];
  const line = segs.flatMap((s, i) => (i ? s.slice(1) : s));
  const total = polylineKm(line);
  const out = [];
  let acc = 0, next = REST.spacingKm;
  for (let k = 0; k + 1 < line.length; k++) {
    const d = kmBetween(line[k][0], line[k][1], line[k + 1][0], line[k + 1][1]);
    while (acc + d >= next && next <= total - REST.spacingKm / 2) {
      const t = (next - acc) / d;
      const lon = line[k][0] + t * (line[k + 1][0] - line[k][0]), lat = line[k][1] + t * (line[k + 1][1] - line[k][1]);
      if (!isForeign(lon, lat)) out.push([lon, lat]);
      next += REST.spacingKm;
    }
    acc += d;
  }
  return out;
}

/** 노선 끝 도시 이름: 국외 거점이면 그 도시, 아니면 가까운 시·군 */
export function endCity(p) {
  const f = (base.foreignNodes || []).find((x) => x.node === p.node);
  if (f) return f.name;
  const near = namer.nearbyPlaces(p.lon, p.lat, 40, 12).find((q) => q[1] === 'city') || namer.nearbyPlaces(p.lon, p.lat)[0];
  return near ? near[0] : '신설';
}

export function usedLineNames() {
  // 지금 이름으로 (평양 천리마선·혁신선은 평양 도시철도 1·2호선으로 바꿔 부르므로, 새 평양 노선은 3호선부터)
  return new Set([...allLinks().map((_, i) => linkAt(base, state, i)?.name), ...Object.values(PY_METRO)].filter(Boolean));
}

/** 그리는 노선의 첫 점이나 끝점이 같은 종류 기존 노선의 종점이면 그 노선 이름 (연장 후보) */
export function extensionOf() {
  if (!draft || draft.points.length < 2) return null;
  const spec = NEW_BUILDS[draft.type];
  for (const p of [draft.points[0], draft.points[draft.points.length - 1]]) {
    if (p.node == null) continue;
    const count = new Map();
    for (const l of allLinks()) {
      if ((l.a !== p.node && l.b !== p.node) || l.mode !== spec.mode || l.cls !== spec.attrs.cls || !l.name || l.ext) continue;
      count.set(l.name, (count.get(l.name) || 0) + 1);
    }
    // 그 점에서 한 구간만 뻗는 노선 = 종점
    for (const [name, n] of count) if (n === 1) return name;
  }
  return null;
}

/** 그리는 중인 노선의 이름 (직접 고쳤으면 그 이름, 기존선 연장이면 그 노선 이름) */
export function draftLineName() {
  if (draft.lineNameEdited) return draft.lineName;
  if (draft.points.length < 2) return '';
  const ext = draft.extend !== false ? extensionOf() : null;
  draft.extendOf = ext;
  if (ext) draft.lineName = ext;
  else {
    const a = endCity(draft.points[0]), b = endCity(draft.points[draft.points.length - 1]);
    draft.lineName = autoLineName(draft.type, a, b, usedLineNames());
  }
  return draft.lineName;
}

/** 그리기 점 가운데 새 역·IC가 될 점의 이름 (착공과 미리보기가 같은 역으로 계산하게) */
export function draftNames() {
  const names = {};
  draft.points.forEach((p, i) => { if (p.name && !p.existing) names[i] = { name: p.name, kind: p.kind, auto: p.auto !== false }; });
  return names;
}

export async function commitDraft() {
  if (!draft || draft.points.length < 2) return;
  if (terrainRule(draft.type) && !terrainReady()) { await loadTerrain(); if (!draft) return; }   // 착공 사업비도 지형을 넣어서
  autoJCTs();
  const spec = NEW_BUILDS[draft.type];
  const last = draft.points[draft.points.length - 1];
  if (spec.mode === 0) attachRoadEnd(last);
  const names = draftNames();
  const dc = draftCost();
  if (spec.mode >= 1 && dc.km < 0.001) { toast('전 구간이 기존 선로입니다. 새 공사가 필요하지 않습니다.'); return; }

  const pp = pppPlan();
  if (pp === false) { alert('민자사업은 먼저 수요 예측·민간 수익성 검토를 하고, 민간이 참여할 수 있어야 착공할 수 있습니다.'); return; }
  if (!pp && NEW_BUILDS[draft.type].mode !== 1 && !canAfford(state, dc.cost, dc.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const lineName = draftLineName();
  let split = false;
  for (const p of draft.points) {
    if (p.split == null) continue;
    p.node = splitLink(base, state, p.split, p.lon, p.lat);
    split = true;
  }
  const restAreas = restPositions(smoothSegments(draftPoints())).map(([lon, lat]) => ({ lon, lat, name: namer.suggest(lon, lat, 'rest') }));
  const r = startNewBuild(base, state, { type: draft.type, reuseExisting: true, points: draftPoints(), names, lineName, extendOf: draft.extendOf, plan: draft.plan, title: draft.planTitle,
    ppp: pp ? { type: pp.type, subsidy: pp.subsidy, toll: pp.toll } : null, segFactor: dc.segFactor, extraCost: dc.extraCost, restAreas });
  if (split) refreshLinks();
  if (!r.ok) { alert(r.reason); return; }
  if (pp) {
    const proj = state.projects[state.projects.length - 1];
    proj.label = `[민자 ${pp.type.toUpperCase()}] ${proj.label}`;
    addContract(proj, pp, lineName || NEW_BUILDS[draft.type].label);
  }
  draft.points.forEach((p) => { p.reserved = false; });
  const builtProj = state.projects[state.projects.length - 1];
  // 고속화·현대화 계획: 완공되면 같은 구간의 옛 선로를 폐선하고 옛 역은 가까운 새 역으로 넘긴다 (직선화와 같다)
  const retirePlan = draft.retireLines !== undefined ? draft.retireLines : draft.plan && plans.find((x) => x.id === draft.plan)?.retireLine;
  if (retirePlan?.length) planRetire(builtProj, retirePlan);
  if (draft.closedLine != null) builtProj.closedLine = draft.closedLine;   // 폐선 직선화 복원: 그 폐선 표시를 지운다
  // 새 노선이 문 닫은 역(직선화로 폐역한 옛 역 등)에 서면 그 역을 다시 연다 (이름 없는 "104정거장"이 되던 것)
  if (NEW_BUILDS[draft.type].mode >= 1 && state.closedStations?.length) {
    const stops = new Set(draft.points.filter((p) => !p.via && p.node != null).map((p) => p.node));
    for (const n of state.closedStations) if (stops.has(n)) (state.reopenedStations ||= []).push(n);
    state.closedStations = state.closedStations.filter((n) => !stops.has(n));
  }
  setDraft(null);
  endDraftView();
  map.getCanvas().style.cursor = '';
  map.doubleClickZoom.enable();
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  addFeatureStatesAfterRebuild();
  refreshPoints();
  save(state);
  renderAll();
  refreshClosed();   // 복원 계획을 벌이면 같은 노선의 폐선 표시도 지운다
  startedNotice(builtProj);
}

export function addFeatureStatesAfterRebuild() { refreshLinks(); }

/** 그리기 중에는 역을 확대 수준에 맞춰 더 일찍 보이게 한다. */
export function setPlanningStations(on) {
  if (!map?.getLayer('points')) return;
  setNetworkFilters(map, networkFilters);
  if (!on || !(NEW_BUILDS[draft?.type]?.mode >= 1)) return;
  for (const [id, zoom] of [['points', 6.5], ['point-labels', 8]]) {
    const normal = map.getFilter(id);
    map.setFilter(id, ['any', normal, ['all', ['==', ['get', 'kind'], 'station'], ['>=', ['zoom'], zoom]]]);
  }
}

export function draftStationEntries() {
  const net = effectiveNetwork(base, state), live = new Set(), lines = new Map();
  net.links.slice(0, net.physCount).forEach((l) => {
    if (!l.active || (l.mode !== 1 && l.mode !== 2)) return;
    for (const n of [l.a, l.b]) {
      live.add(n); if (!lines.has(n)) lines.set(n, new Set());
      if (l.name) lines.get(n).add(l.name);
    }
  });
  return [...nodeNames()].filter(([node, v]) => typeof node === 'number' && v.kind === 'station' && live.has(node))
    .map(([node, v]) => ({node, name: v.name, lines: [...(lines.get(node) || [])], coord: nodeCoord(node)}));
}

export function nearestDraftStation(lngLat, maxPx) {
  const p = map.project(lngLat); let node = null, gap = maxPx;
  for (const item of draftStationEntries()) {
    const q = map.project(item.coord), d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < gap) { gap = d; node = item.node; }
  }
  return node;
}

export function draftStationPicker() {
  return `<div class="draft-station-picker"><label for="draft-station-query">기존 역을 경유지에 추가</label>
    <div class="name-row"><input id="draft-station-query" type="search" placeholder="역 이름·노선 검색 (예: 서울, 행신)" value="${esc(draft.stationQuery || '')}" style="flex:1"></div>
    <select id="draft-station-select" aria-label="추가할 기존 역" size="4" style="width:100%"></select>
    <div class="name-row"><span class="hint" id="draft-station-count"></span><button class="small" id="draft-station-add">기존 역 추가</button></div>
    <p class="hint">지도에서 역 표식을 눌러도 추가됩니다. 노선 가까이 누르면 두 경유지 사이에 끼워집니다.</p></div>`;
}

export function bindDraftStationPicker() {
  const input = $('#draft-station-query'), select = $('#draft-station-select');
  if (!input || !select) return;
  const entries = draftStationEntries(), center = map.getCenter();
  const update = () => {
    draft.stationQuery = input.value;
    const query = input.value.trim().replace(/역$/, '').toLowerCase();
    const found = entries.filter(s => !query || `${s.name} ${s.lines.join(' ')}`.toLowerCase().includes(query));
    found.sort((a, b) => {
      if (query) { const exact = (b.name.replace(/역$/, '') === query) - (a.name.replace(/역$/, '') === query); if (exact) return exact; }
      return kmBetween(center.lng, center.lat, ...a.coord) - kmBetween(center.lng, center.lat, ...b.coord);
    });
    select.innerHTML = found.slice(0, 80).map(s => `<option value="${s.node}">${esc(s.name)}역 · ${esc(s.lines.slice(0, 3).join(' / '))} (#${s.node})</option>`).join('');
    if (select.options.length) select.selectedIndex = 0;
    $('#draft-station-count').textContent = found.length > 80 ? `${found.length}개 중 가까운 80개` : `${found.length}개 역`;
    $('#draft-station-add').disabled = !found.length;
  };
  const add = () => {
    const item = entries.find(s => s.node === +select.value);
    if (!item) return;
    if (draft.points.some(p => p.node === item.node)) { toast('이미 경유지에 있는 역입니다.'); return; }
    addDraftPoint({lng: item.coord[0], lat: item.coord[1]}, { explicitStation: item.node });
    map.easeTo({center: item.coord, zoom: Math.max(map.getZoom(), 9), duration: 250});
  };
  input.oninput = update;
  for (const el of [input, select]) el.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } };
  $('#draft-station-add').onclick = add;
  update();
}

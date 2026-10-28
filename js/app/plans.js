// 계획 사업 (data/plans.json).
import { formatWon } from '../game/catalog.js';
import { smoothSegments } from '../game/curve.js';
import { effectiveNetwork, linkAt, NEW_BUILDS } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { subFold, toast } from '../ui/panel.js';
import { base, draft, esc, map, namer, state } from './core.js';
import { allLinks, anyStationName, nodeCoord, nodeNames } from './mapdata.js';
import { nearestNode, startDraft } from './draw.js';
import { draftLineName, draftPoints, drawDraft, nameDraftPoint, withTangents } from './route.js';
import { renderBuild, shownPlan, switchTab } from './panels.js';
import { railStationSet } from './svc.js';
import { plansTakenByClosed } from './reopen.js';
import { showGazette } from './gazette.js';

// ------------------------------------------------------------ 계획 사업 (data/plans.json)

export let plans = [];
export function setPlans(v) { return (plans = v); }

/** 경유지 이름과 좌표로 기존 역(또는 도로 노드)을 찾는다: 같은 이름의 역이 6km 안에 있으면 그 역, 아니면 가까운 노드 */
export function resolveWaypoint([name, lon, lat], mode, motorwayEnd = false) {
  // 고속도로 계획의 양 끝은 8km 안의 기존 고속도로 노드에 붙인다 (남북 연결 고속도로가 기존 고속도로와 이어지게)
  if (mode === 0 && motorwayEnd) {
    let best = null, bd = 8;
    allLinks().forEach((l, i) => {
      const e = linkAt(base, state, i);
      if (e.mode !== 0 || e.cls !== 'motorway' || e.ext) return;
      for (const n of [e.a, e.b]) {
        const c = nodeCoord(n);
        const d = c ? kmBetween(lon, lat, c[0], c[1]) : Infinity;
        if (d < bd) { bd = d; best = n; }
      }
    });
    if (best != null) return best;
  }
  // 이름이 같은 기존 역: 같은 종류 철도는 6km(도시철도는 1.5km) 안, 다른 종류(일반철도↔도시철도)는 1km 안이면 그 역에 바로 붙는다.
  // 다른 종류 역에 붙으면 같은 노드라 저절로 환승역이 된다 (예전에는 그 옆에 같은 이름 역을 하나 더 만들었다: 신분당선 용산 등).
  // 도시철도는 역이 촘촘해 6km 안에 같은 이름의 다른 역이 흔하다 (평양 3호선 광복이 3km 떨어진 1호선 광복역으로 끌려가 선이 꺾였다)
  const lists = mode === 2 ? [[base.metro_stations || [], 1.5], [base.stations, 1]] : mode === 1 ? [[base.stations, 6], [base.metro_stations || [], 1]] : [];
  for (const [list, maxKm] of lists) {
    let best = null, bd = maxKm;
    for (const [nm, node] of list) {
      if (nm !== name && nm !== `${name}역` && nm.replace(/역$/, '') !== name) continue;
      const c = nodeCoord(node);
      const d = kmBetween(lon, lat, c[0], c[1]);
      if (d < bd) { bd = d; best = node; }
    }
    if (best != null) return best;
  }
  // 이름은 달라도 기존 역 바로 그 자리(150m 안)면 그 역이다 (CTX 정부대전청사 = 대전 1호선 정부청사 등)
  if (mode >= 1) {
    let best = null, bd = 0.15;
    for (const [list] of lists) for (const [, node] of list) {
      const c = nodeCoord(node);
      if (!c || Math.abs(c[1] - lat) > 0.01) continue;
      const d = kmBetween(lon, lat, c[0], c[1]);
      if (d < bd) { bd = d; best = node; }
    }
    if (best != null) return best;
  }
  // 이름이 같은 역이 없으면 새 역이다: 그 자리(250m 안)의 노드에만 붙인다.
  // 예전에는 1.5km 안의 아무 역에나 붙여, 서부선의 연희·명지대 등이 홍대입구·증산으로 바뀌어 노선이 엉뚱하게 그려졌다
  return nearestNode({ lng: lon, lat }, mode, null, mode === 0 ? 4 : name ? 0.25 : 1.5);
}

/** 예전 저장: 복원 사업 구간이 계획 이름으로 따로 놓였으면 이어지는 노선 이름으로 바꾼다 (계통이 경의선 → 평부선처럼 이어지게) */
export function migratePlanLines() {
  if (!state) return;
  for (const p of state.projects) {
    const pl = p.plan && plans.find((x) => x.id === p.plan);
    if (!pl?.line) continue;
    for (const l of state.newLinks) if (l.name === pl.name) l.name = pl.line;
  }
}

/** 계획의 분기점 [null, 경도, 위도, 노선 이름]: 그 노선 선로 위 가장 가까운 자리(2km 안). 역을 두지 않고 선로를 잘라 잇는다 */
export function planJunction([, lon, lat, line], mode) {
  let best = null, bd = 2;
  const ck = Math.cos((lat * Math.PI) / 180);
  allLinks().forEach((l, i) => {
    if (l.ext || state.replaced?.[i]) return;
    const e = linkAt(base, state, i);
    if (e.mode !== mode || e.name !== line) return;
    const g = l.geom || [];
    for (let k = 0; k + 3 < g.length; k += 2) {
      if (Number.isNaN(g[k]) || Number.isNaN(g[k + 2])) continue;
      const ax = (g[k] - lon) * ck, ay = g[k + 1] - lat, dx = (g[k + 2] - g[k]) * ck, dy = g[k + 3] - g[k + 1];
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const x = g[k] + t * (g[k + 2] - g[k]), y = g[k + 1] + t * (g[k + 3] - g[k + 1]);
      const d = kmBetween(lon, lat, x, y);
      if (d < bd) { bd = d; best = { split: i, lon: x, lat: y }; }
    }
  });
  return best;
}

/** 계획 노선을 그리기로 연다 (경유지가 찍힌 상태). 확인하고 고친 뒤 착공한다 */
export function openPlan(id) {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return;
  startDraft(plan.type);
  const spec = NEW_BUILDS[plan.type];
  for (const wp of plan.points) {
    // 노선 이름이 붙은 이름 없는 점은 그 노선 위의 분기점 (역 없이 선로를 잘라 잇는다: 서해선–경부고속선 연결선)
    const jn = wp[0] == null && wp[3] ? planJunction(wp, spec.mode) : null;
    if (jn) { draft.points.push({ node: null, lon: jn.lon, lat: jn.lat, split: jn.split, kind: null, name: null }); continue; }
    // 이름이 없는 경유점은 선형만 잡는 점 (역·IC를 만들지 않는다)
    if (wp[0] == null) { draft.points.push({ node: null, lon: wp[1], lat: wp[2], split: null, via: true }); continue; }
    const isEnd = wp === plan.points[0] || wp === plan.points[plan.points.length - 1];
    const node = resolveWaypoint(wp, spec.mode, isEnd && spec.attrs?.cls === 'motorway');
    const c = node != null ? nodeCoord(node) : [wp[1], wp[2]];
    const pt = { node, lon: c[0], lat: c[1], split: null };
    draft.points.push(pt);
    nameDraftPoint(pt, draft.points.length - 1);
    // 새 역이면 계획에 적힌 역 이름을 쓴다. 계획서의 가칭 번호('102정거장')는 놓인 곳 지명으로 짓는다
    if (spec.mode >= 1 && !pt.existing && wp[0] && !/^\d+정거장$/.test(wp[0])) { if (pt.reserved) namer.release(pt.name, 'station'); pt.name = wp[0]; pt.auto = false; }
  }
  // 옛 노선을 걷어 내는 계획(현대화·고속화)은 새 선형 곁의 옛 역을 새 노선 역으로 넣는다 (완공 뒤에도 그 역의 여객 영업이 이어진다)
  const oldStops = plan.retireLine && spec.mode === 1 ? addOldLineStops(plan.retireLine) : 0;
  if (oldStops) draft.recNote = `옛 ${plan.retireLine.join('·')} 역 ${oldStops}곳을 새 노선의 역으로 넣었습니다. 완공 때 옛 선로를 걷어 내도 이 역들의 여객 영업이 이어집니다. 서지 않을 역은 '통과'로 바꾸세요.`;
  // 복원 사업처럼 기존 노선을 잇는 계획은 그 노선 이름을 이어 쓴다 (사업 이름은 계획 이름).
  // 옛 노선을 대신하는 계획도 그 노선 이름을 잇는다 (황해청년선 현대화 → 황해청년선: 계획 이름이 노선 이름이 되어 옛 노선이 사라진 것처럼 보였다)
  draft.lineName = plan.line || plan.lineName || (plan.retireLine?.length === 1 ? plan.retireLine[0] : plan.name);
  draft.lineNameEdited = true;
  if (plan.line) draft.extendOf = plan.line;
  if (draft.lineName !== plan.name) draft.planTitle = plan.name;
  draft.plan = plan.id;
  // 철도는 계획 자료의 실제 정차역 목록 그대로, 도로는 기존 간선도로와 만나는 곳에 IC를 넣는다
  draft.planFilled = spec.mode === 0 ? fillPlanICs(plan.type) : 0;
  drawDraft();
  renderBuild();
  const xs = draft.points.map((p) => p.lon), ys = draft.points.map((p) => p.lat);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 11 });
}

/**
 * 옛 노선을 걷어 내는 계획: 새 선형에서 2.5km 안에 있는 옛 노선 역을 새 노선의 역으로 끼운다 (계획 정차역에 없는 역).
 * 계획 정차역만 두면 완공 때 사이 역이 모두 닫혀 그 지역의 여객 영업이 사라졌다 (황해청년선 현대화는 4개 역, 원산–청진은 22개 역만 남았다).
 * 선형 끝 너머의 역, 이미 있는 역에서 0.8km 안인 역은 넣지 않는다. 끼운 역 수를 돌려준다
 */
export function addOldLineStops(lineNames) {
  const lines = new Set(lineNames);
  const st = railStationSet(), names = nodeNames();
  const cand = new Set();
  effectiveNetwork(base, state).links.forEach((l) => { if (l.active && l.mode === 1 && lines.has(l.name)) for (const n of [l.a, l.b]) if (st.has(n)) cand.add(n); });
  for (const p of draft.points) if (p.node != null) cand.delete(p.node);
  const segs = smoothSegments(draftPoints());
  const stops = draft.points.filter((p) => !p.via);
  const picked = [];
  for (const n of cand) {
    const [x, y] = nodeCoord(n);
    const ck = Math.cos((y * Math.PI) / 180);
    let best = null;
    segs.forEach((seg, i) => {
      for (let k = 0; k + 1 < seg.length; k++) {
        const [ax, ay] = seg[k], [bx, by] = seg[k + 1];
        const dx = (bx - ax) * ck, dy = by - ay, px = (x - ax) * ck, py = y - ay;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1e-12)));
        const d = Math.hypot(px - t * dx, py - t * dy) * 111.32;
        if (!best || d < best.d) best = { d, i, t: (k + t) / (seg.length - 1), lon: ax + t * (bx - ax), lat: ay + t * (by - ay) };
      }
    });
    if (!best || best.d > 2.5) continue;
    if ((best.i === 0 && best.t < 0.01) || (best.i === segs.length - 1 && best.t > 0.99)) continue;   // 선형 끝 너머
    const near = (q) => kmBetween(q.lon, q.lat, best.lon, best.lat) < 0.8;
    if (stops.some(near) || picked.some(near)) continue;
    picked.push({ ...best, name: names.get(n)?.name || anyStationName(n) });
  }
  // 뒤에서부터 끼워 앞 번호가 밀리지 않게 (같은 구간 안에서는 먼 쪽부터)
  picked.sort((a, b) => b.i - a.i || b.t - a.t);
  for (const q of picked) {
    draft.points.splice(q.i + 1, 0, { node: null, lon: q.lon, lat: q.lat, split: null, kind: 'station', name: q.name, auto: false, reserved: false });
  }
  return picked.length;
}

/** 계획 노선 미리보기 선: 양 끝이 기존 역·노드면 그리기와 같이 그 노선에 접선으로 붙인다 */
export function planPreviewLine(plan) {
  const spec = NEW_BUILDS[plan.type];
  if (!spec) return null;
  const pts = plan.points.map((wp, i) => {
    const end = i === 0 || i === plan.points.length - 1;
    const jn = wp[0] == null && wp[3] ? planJunction(wp, spec.mode) : null;
    if (jn) return { node: null, lon: jn.lon, lat: jn.lat, split: jn.split };
    const node = end && wp[0] != null ? resolveWaypoint(wp, spec.mode, spec.attrs?.cls === 'motorway') : null;
    const c = node != null ? nodeCoord(node) : [wp[1], wp[2]];
    return { node, lon: c[0], lat: c[1], split: null, via: wp[0] == null };
  });
  if (pts.length < 2) return null;
  return smoothSegments(withTangents(pts, spec.mode), 3).flatMap((sg, i) => (i ? sg.slice(1) : sg));
}

// 계획 노선(고속도로·국도)을 열 때 기존 간선도로와 만나는 곳에 넣는 IC 간격 (km). 철도 역은 계획 자료(plans.json)의 역 목록을 그대로 쓴다
export const IC_SPACING = { motorway: 10, trunk: 6 };

/**
 * 그리기에 열린 도로 계획(draft)의 IC 사이를 채운다: 곡선이 기존 국도·지방도와 만나는 곳에 IC (그 도로에 바로 잇는다).
 * 큰 도로부터, 이미 있는 IC·끝점에서 간격의 0.8배 넘게 떨어진 곳만
 * @returns {number} 넣은 IC 수
 */
export function fillPlanICs(type, jctOnly = false) {
  const gap = IC_SPACING[type] ?? IC_SPACING.motorway;
  if ((!IC_SPACING[type] && !jctOnly) || !draft || draft.points.length < 2) return 0;
  const mw = type === 'motorway' || type === 'tunnelRoad';
  const segs = smoothSegments(draftPoints());
  const samples = [];
  let s = 0;
  segs.forEach((seg, i) => {
    seg.forEach((q, k) => {
      if (k) s += kmBetween(seg[k - 1][0], seg[k - 1][1], q[0], q[1]);
      samples.push({ i, x: q[0], y: q[1], s });
    });
  });
  const segStart = [];
  for (const sm of samples) if (segStart[sm.i] == null) segStart[sm.i] = sm.s;
  const taken = draft.points.map((p, i) => (p.via ? null : segStart[i] ?? s)).filter((v) => v != null);
  taken.push(s);
  const xs = samples.map((q) => q.x), ys = samples.map((q) => q.y);
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
  const cands = [];
  allLinks().forEach((l, id) => {
    const e = linkAt(base, state, id);
    // 고속도로 계획은 기존 고속도로와 만나는 곳마다 JCT (간격과 무관하게)
    const jct = mw && e.cls === 'motorway';
    if (e.mode !== 0 || e.ext || (jctOnly && !jct) || (!jct && !['trunk', 'primary', 'secondary'].includes(e.cls))) return;
    const g = l.geom;
    for (let k = 0; k + 3 < g.length; k += 2) {
      const ax = g[k], ay = g[k + 1], bx = g[k + 2], by = g[k + 3];
      if (Number.isNaN(ax) || Number.isNaN(bx) || Math.max(ax, bx) < bx0 || Math.min(ax, bx) > bx1 || Math.max(ay, by) < by0 || Math.min(ay, by) > by1) continue;
      for (let m = 0; m + 1 < samples.length; m++) {
        const p = samples[m], r = samples[m + 1];
        if (p.i !== r.i) continue;
        const d1x = r.x - p.x, d1y = r.y - p.y, d2x = bx - ax, d2y = by - ay;
        const den = d1x * d2y - d1y * d2x;
        if (!den) continue;
        const t = ((ax - p.x) * d2y - (ay - p.y) * d2x) / den, u = ((ax - p.x) * d1y - (ay - p.y) * d1x) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        cands.push({ q: { i: p.i, x: p.x + t * d1x, y: p.y + t * d1y, s: p.s + t * (r.s - p.s) }, w: { motorway: 4, trunk: 3, primary: 2, secondary: 1 }[e.cls], link: id, jct });
      }
    }
  });
  cands.sort((a, b) => b.w - a.w);
  const add = [];
  for (const c of cands) {
    if (taken.some((t) => Math.abs(t - c.q.s) < (c.jct ? 1 : gap * 0.8))) continue;
    taken.push(c.q.s);
    add.push(c);
  }
  // 뒤에서부터 끼워야 앞 점 번호가 밀리지 않는다 (같은 구간 안에서는 먼 것부터)
  add.sort((a, b) => b.q.i - a.q.i || b.q.s - a.q.s);
  for (const c of add) {
    const pt = { node: null, lon: c.q.x, lat: c.q.y, split: c.link, inserted: true };
    draft.points.splice(c.q.i + 1, 0, pt);
    nameDraftPoint(pt, c.q.i + 1);
  }
  return add.length;
}

/**
 * 직접 그린 고속도로: 기존 고속도로와 만나는데 점이 없는 곳에 JCT를 넣는다 (계획 노선은 열 때 IC와 함께 넣는다).
 * 예전에는 계획 노선에만 넣어, 직접 그린 고속도로는 기존 고속도로와 엇갈려도 이어지지 않았다
 */
export function autoJCTs() {
  if (!draft || !['motorway', 'tunnelRoad'].includes(draft.type)) return 0;
  const n = fillPlanICs(draft.type, true);
  if (n) { drawDraft(); renderBuild(); toast(`기존 고속도로와 만나는 ${n}곳에 JCT를 넣었습니다.`); }
  return n;
}

/**
 * 그리는 노선의 양 끝 가까이(15km 안)를 함께 지나는 같은 수단의 기존 노선: 완공 때 폐선할 후보 (현대화·고속화·재건설).
 * 도로는 고속도로·국도만
 */
export let parallelCache = null;
export function parallelLines() {
  const spec = NEW_BUILDS[draft.type], ps = draft.points;
  const A = [ps[0].lon, ps[0].lat], B = [ps[ps.length - 1].lon, ps[ps.length - 1].lat];
  const key = `${draft.type}:${A}:${B}:${state.newLinks.length}`;
  if (parallelCache?.key === key) return parallelCache.out;
  const near = new Map();
  effectiveNetwork(base, state).links.forEach((l) => {
    if (!l.active || l.mode !== spec.mode || !l.name || l.ext || (spec.mode === 0 && !['motorway', 'trunk'].includes(l.cls))) return;
    const e = near.get(l.name) || { a: false, b: false };
    for (const n of [l.a, l.b]) {
      const c = nodeCoord(n);
      if (!c) continue;
      if (kmBetween(c[0], c[1], A[0], A[1]) < 15) e.a = true;
      if (kmBetween(c[0], c[1], B[0], B[1]) < 15) e.b = true;
    }
    near.set(l.name, e);
  });
  const out = [...near].filter(([nm, e]) => e.a && e.b && nm !== draftLineName()).map(([nm]) => nm).sort((x, y) => x.localeCompare(y, 'ko'));
  parallelCache = { key, out };
  return out;
}

export function retireChoiceHTML() {
  if (!draft || draft.points.length < 2 || draft.type === 'airport' || draft.extendOf) return '';
  const spec = NEW_BUILDS[draft.type];
  const planDef = draft.plan ? plans.find((x) => x.id === draft.plan)?.retireLine : null;
  const cur = draft.retireLines !== undefined ? draft.retireLines : planDef || [];
  const cands = [...new Set([...parallelLines(), ...cur])];
  if (!cands.length) return '';
  const word = spec.mode ? '폐선' : '폐도';
  return `<div class="name-row"><span class="kind">옛 노선</span><select id="draft-retire">
      <option value="">그대로 둔다</option>${cands.map((c) => `<option value="${esc(c)}" ${cur.includes(c) ? 'selected' : ''}>완공 때 ${esc(c)} 나란한 구간 ${word}</option>`).join('')}</select></div>
    ${cur.length ? `<p class="hint">완공되면 새 ${spec.mode ? '노선' : '도로'} 양 끝 사이의 옛 ${esc(cur.join('·'))} 구간을 걷어 냅니다.${spec.mode ? ' 옛 역은 3km 안의 새 역으로 넘기고,' : ''} 옛 ${spec.mode ? '선로' : '고속도로'} 중간에서 갈라지던 ${spec.mode ? '지선·분기 노선은' : '고속도로는'} 새 ${spec.mode ? '노선의 가까운 역' : '도로'}에 연결선을 놓아 잇습니다 (사업비에 더함).</p>` : ''}`;
}

/**
 * 착공 알림: 지금 창(건설 탭·계획 목록)을 그대로 두고 알림 띠만 띄운다 (여러 사업을 잇달아 착공할 수 있게).
 * 예전에는 착공할 때마다 사업 탭으로 넘어갔다. 고시문은 '착공 때 고시문 자동으로 보기'를 켰을 때만 뜬다
 */
export function startedNotice(p) {
  if (!p) return;
  if (showGazette(p, { fromBuild: true })) return;
  toast(`<b>착공</b> ${esc(p.label)} · ${formatWon(p.cost)} · ${p.doneYear}년 완공 예정 <a href="#" data-toast-tab="projects">사업 탭</a>`);
  document.querySelector('#toast [data-toast-tab]')?.addEventListener('click', (e) => { e.preventDefault(); switchTab('projects'); });
}

export function plansHTML() {
  if (!plans.length) return '';
  const started = new Set([...state.projects.filter((p) => p.status !== 'cancelled').map((p) => p.plan).filter(Boolean), ...plansTakenByClosed()]);
  // 다 지은 계획은 목록에서 뺀다 (사업 탭의 완공 사업에서 본다)
  const doneIds = new Set(state.projects.filter((p) => p.status === 'done' && p.plan).map((p) => p.plan));
  const building = new Map(state.projects.filter((p) => p.status === 'building' && p.plan).map((p) => [p.plan, p]));
  const open = plans.filter((p) => !doneIds.has(p.id));
  const groups = [...new Set(open.map((p) => p.group))];
  return `<h4>계획 사업</h4>
    <p class="hint">국가·광역 교통계획(제4·5차 국가철도망 구축계획, 제3차 국가도로망 종합계획 등)에 나온 노선입니다. 계획 이름을 누르면 지도에 그 노선이 점선으로 보이고, 그 선이나 "열기"를 누르면 경유지가 찍힌 채로 그리기가 열립니다. 사업비를 확인한 뒤 착공합니다 (경로는 고칠 수 있습니다).</p>
    ${groups.map((g) => subFold(`plans:${g}`, `${esc(g)} <span class="cnt">${open.filter((p) => p.group === g).length}</span>`, `<div class="list">${open.filter((p) => p.group === g).map((p) => {
      let km = 0;
      for (let i = 1; i < p.points.length; i++) km += kmBetween(p.points[i - 1][1], p.points[i - 1][2], p.points[i][1], p.points[i][2]);
      const spec = NEW_BUILDS[p.type];
      return `<div class="item line"><div class="n" data-plan-show="${p.id}" style="cursor:pointer;${shownPlan === p.id ? 'text-decoration:underline' : ''}" title="지도에 노선 보기"><b>${esc(p.phase ? p.name.replace(/ \d단계/, '') : p.name)}</b>${p.phase ? ` <span class="cnt phase-tag">${esc(p.phase)}</span>` : ''}${p.after && !started.has(p.after) ? ' <span class="m">1단계를 먼저 지으면 같은 노선으로 이어집니다</span>' : ''}${p.note ? ` <span class="m">${esc(p.note)}</span>` : ''}<span class="m" title="${esc(p.source || '')}">${spec.label.replace(/ 신설.*$/, '')} · 약 ${Math.round(km * 1.1)}km · ${formatWon(km * 1.1 * spec.perKm)}${p.source ? ` · 출처: ${esc(p.source.split(' · 현황')[0].split(/[,(]/)[0].trim())}` : ''}</span></div>
        <button class="small" data-plan="${p.id}" ${started.has(p.id) ? 'disabled' : ''}>${building.has(p.id) ? `공사 중 (${building.get(p.id).doneYear}년)` : started.has(p.id) ? '착공함' : '열기'}</button></div>`;
    }).join('')}</div>`)).join('')}`;
}

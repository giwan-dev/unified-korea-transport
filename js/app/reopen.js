// 폐선 재개통과 여객 재개통.
import { isNarrow } from '../ui/traffic.js';
import { formatWon, KP_COST_FACTOR } from '../game/catalog.js';
import { railPath } from '../game/services.js';
import { canAfford, effectiveNetwork, fundFor, isKP, linkAt, linkPending, NEW_BUILDS, REOPEN_SPEED, save, splitLink, startNewBuild, startProject } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { base, draft, esc, map, namer, state } from './core.js';
import { allLinks, nodeCoord, refreshLinks, shownStation } from './mapdata.js';
import { fmtPeople, nodesOfMode, popNear, startDraft } from './draw.js';
import { drawDraft, nameDraftPoint, withTangents } from './route.js';
import { renderAll, renderBuild } from './panels.js';
import { plans, startedNotice } from './plans.js';
import { header } from './svcmap.js';

// ------------------------------------------------------------ 폐선 재개통 (수려선·금강산선 등, data/closed_lines.json)

export let closedLines = [];   // 자료의 옛 폐선 + 게임에서 폐선한 구간 (refreshClosed가 다시 모은다)
export function setClosedLines(v) { return (closedLines = v); }
export let closedFile = [];
export function setClosedFile(v) { return (closedFile = v); }
export const CLOSED_REUSE = 0.7;   // 옛 노반·터널·교량 자리를 다시 쓰므로 새로 놓는 것보다 싸다

/** 재개통 사업을 벌인(공사 중·완공) 폐선은 지도에서 뺀다 */
export function closedTaken() {
  const out = new Set(state.projects.filter((p) => p.closedLine != null && p.status !== 'cancelled').map((p) => p.closedLine));
  // 같은 노선의 복원 계획(plans.json closedLine)을 벌였으면 그 폐선도 이미 벌인 사업이다 (금강산선 복원 = 금강산선 재개통)
  for (const p of state.projects) {
    if (p.status === 'cancelled' || !p.plan) continue;
    const name = plans.find((x) => x.id === p.plan)?.closedLine;
    if (name) closedLines.forEach((c) => { if (c.name === name) out.add(c.id); });
  }
  return out;
}

/** 폐선 재개통과 같은 사업인 복원 계획 id들 (그 폐선을 이미 재개통했으면 계획 목록에서도 벌인 것으로) */
export function plansTakenByClosed() {
  const names = new Set(state.projects.filter((p) => p.closedLine != null && p.status !== 'cancelled')
    .map((p) => closedLines.find((c) => c.id === p.closedLine)?.name).filter(Boolean));
  return plans.filter((x) => x.closedLine && names.has(x.closedLine)).map((x) => x.id);
}

/**
 * 게임에서 폐선한 철도·도시철도 (폐선 사업을 마친 구간): 이어진 구간마다 하나씩, 자료의 옛 폐선과 같은 꼴로.
 * 갈색 점선으로 남아 눌러서 재개통할 수 있다 (옛 역 자리에 역을 다시 연다)
 */
export function retiredClosed() {
  const out = [];
  const all = allLinks();
  const stName = new Map();
  for (const [name, node] of [...base.stations, ...(base.metro_stations || [])]) if (!stName.has(node)) stName.set(node, shownStation(name, node));
  for (const [k, v] of Object.entries(state.names || {})) if (v.kind === 'station') stName.set(+k, v.name);
  for (const p of state.projects) {
    if (p.status !== 'done' || p.kind !== 'upgrade' || !/^retire[12]$/.test(p.upgrade || '')) continue;
    const ids = new Set(p.retire || p.links);
    // 이어진 구간끼리 묶는다 (끝 노드를 공유하는 링크)
    const left = new Set(ids);
    let part = 0;
    while (left.size) {
      const at = new Map();
      for (const i of left) for (const n of [all[i].a, all[i].b]) { if (!at.has(n)) at.set(n, []); at.get(n).push(i); }
      // 한쪽 끝(닿은 링크 1개)에서 시작해 따라간다
      let node = [...at.keys()].find((n) => at.get(n).length === 1) ?? all[[...left][0]].a;
      const coords = [], nodes = [node];
      let km = 0, name = '';
      for (;;) {
        const i = (at.get(node) || []).find((x) => left.has(x));
        if (i == null) break;
        left.delete(i);
        const l = all[i], e = linkAt(base, state, i);
        name ||= e.name || '';
        km += e.len;
        const g = [];
        for (let k = 0; k + 1 < (l.geom || []).length; k += 2) if (l.geom[k] === l.geom[k]) g.push([l.geom[k], l.geom[k + 1]]);
        if (l.a !== node) g.reverse();   // 도형은 a→b 방향
        coords.push(...(coords.length ? g.slice(1) : g));
        node = l.a === node ? l.b : l.a;
        nodes.push(node);
      }
      if (coords.length < 2) continue;
      const stations = nodes.filter((n) => stName.has(n)).map((n) => [stName.get(n), ...nodeCoord(n)]);
      const ends = [nodes[0], nodes[nodes.length - 1]].map((n) => stName.get(n)).filter(Boolean);
      const mode = linkAt(base, state, [...ids][0]).mode;
      out.push({ id: `retired:${p.id}:${part++}`, name: name || '폐선', label: `${name || '폐선'}${ends.length === 2 ? ` ${ends[0]}–${ends[1]}` : ''}`,
        cls: linkAt(base, state, [...ids][0]).cls, narrow: isNarrow(linkAt(base, state, [...ids][0])), km, geom: coords, stations, country: isKP(coords[0][1], coords[0][0]) ? 'KP' : 'KR', mode, retiredYear: p.doneYear });
    }
  }
  return out;
}

export function refreshClosed() {
  closedLines = closedFile.concat(state ? retiredClosed() : []);
  if (!map?.getSource('closed')) return;
  const taken = closedTaken();
  map.getSource('closed').setData({ type: 'FeatureCollection', features: closedLines.filter((c) => !taken.has(c.id)).map((c) => ({
    type: 'Feature', properties: { id: c.id, name: c.label, mode: c.mode ?? 1, cls: c.cls || 'rail', narrow: c.narrow ? 1 : 0 }, geometry: { type: 'LineString', coordinates: c.geom } })) });
}

export function closedCost(c, type) {
  return Math.round(NEW_BUILDS[type].perKm * c.km * CLOSED_REUSE * (c.country === 'KP' ? KP_COST_FACTOR : 1));
}

export function closedPanel(id) {
  const c = closedLines.find((x) => x.id === id);
  if (!c) return header('폐선');
  const taken = closedTaken().has(id);
  const types = c.mode === 2 ? ['lrt', 'metro'] : ['rail1', 'rail'];
  const sp = taken ? [] : closedPoints(c).filter((it) => !it.via);
  let straightKm = 0;
  for (let i = 1; i < sp.length; i++) straightKm += kmBetween(sp[i - 1].lon, sp[i - 1].lat, sp[i].lon, sp[i].lat) * 1.05;
  const opt = (type) => {
    const spec = NEW_BUILDS[type], cost = closedCost(c, type), ok = canAfford(state, cost, spec.years);
    return `<div class="item opt"><div class="opt-row"><span>${spec.label.replace('신설 ', '')}</span>
      <button class="small ${ok ? 'primary' : ''}" data-closed-go="${type}" ${ok && !taken ? '' : 'disabled'}>${formatWon(cost)} · ${spec.years}년</button></div></div>`;
  };
  return `${header(`${c.label} (폐선)`)}
    <table class="kv"><tr><td>연장</td><td>${c.km.toFixed(1)} km · ${c.country === 'KP' ? '북' : '남'}</td></tr>
      <tr><td>옛 역</td><td>${c.stations.length ? c.stations.map((s) => esc(s[0])).join(' · ') : '기록 없음'}</td></tr></table>
    <p class="hint">${c.retiredYear ? `${c.retiredYear}년에 폐선한 구간입니다.` : '문을 닫은 철도입니다.'} 옛 노선 자리를 따라 다시 놓고 옛 역 자리에 역을 엽니다. 노반 자리를 다시 써서 새로 놓는 것보다 30% 쌉니다.
      양 끝이 지금 ${c.mode === 2 ? '도시철도' : '철도'}역 가까이(1.5km 안)면 그 역에 잇습니다. 다 지은 뒤 구간을 눌러 복선화·전철화할 수 있습니다.</p>
    ${taken ? '<p class="hint">이미 재개통 사업을 벌였습니다.</p>' : `<h4>옛 선형 그대로</h4><div class="list">${types.map(opt).join('')}</div>
      <h4>직선화해 복원</h4>
      <p class="hint">옛 역(과 양 끝)만 잇고 선형은 새로 곧게 놓습니다. 굽은 옛 노반을 쓰지 않아 할인은 없지만 짧고 빨라집니다. 그리기로 열려 역과 경로를 고친 뒤 착공합니다.</p>
      <div class="list">${types.map((type) => `<div class="item opt"><div class="opt-row"><span>${NEW_BUILDS[type].label.replace('신설 ', '')}</span>
        <button class="small" data-closed-straight="${type}">그리기로 열기 · 약 ${straightKm.toFixed(0)}km</button></div></div>`).join('')}</div>`}`;
}

/** 폐선 도형을 따라 선형 점(via)을, 옛 역 자리에 역을 둔 그리기 점 목록 */
export function closedPoints(c) {
  const g = c.geom;
  const cum = [0];
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + kmBetween(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]));
  const along = (x, y) => {   // 선 위 가장 가까운 자리의 누적 거리
    let best = 0, bd = Infinity;
    for (let i = 1; i < g.length; i++) {
      const [ax, ay] = g[i - 1], [bx, by] = g[i];
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      const d = (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2;
      if (d < bd) { bd = d; best = cum[i - 1] + t * (cum[i] - cum[i - 1]); }
    }
    return best;
  };
  const sts = c.stations.map(([name, x, y]) => ({ s: along(x, y), name, lon: x, lat: y })).sort((a, b) => a.s - b.s);
  const items = [
    ...g.map(([x, y], i) => ({ s: cum[i], lon: x, lat: y, via: true })),
    ...sts.map((t) => ({ s: t.s, lon: t.lon, lat: t.lat, name: t.name })),
  ].sort((a, b) => a.s - b.s);
  // 역 가까이(300m)·서로 너무 붙은(500m) 선형 점은 뺀다. 양 끝은 늘 남긴다
  const out = [];
  items.forEach((it, k) => {
    const end = k === 0 || k === items.length - 1;
    if (it.via && !end) {
      if (sts.some((t) => Math.abs(t.s - it.s) < 0.3)) return;
      const prev = out[out.length - 1];
      if (prev && it.s - prev.s < 0.5) return;
    }
    out.push(it);
  });
  // 끝: 지금 철도역(없으면 철도 노드) 1.5km 안이면 거기에 잇는다
  const stSet = new Set(effectiveNetwork(base, state).stations);
  const railNodes = nodesOfMode(c.mode === 2 ? 2 : 1);
  const snapEnd = (it) => {
    let best = null, bd = 1.5;
    for (const n of railNodes) {
      const p = nodeCoord(n);
      if (!p || Math.abs(p[1] - it.lat) > 0.02) continue;
      const d = kmBetween(it.lon, it.lat, p[0], p[1]) - (stSet.has(n) ? 0.5 : 0);   // 역을 조금 더 반긴다
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  for (const k of [0, out.length - 1]) {
    const it = out[k];
    const n = snapEnd(it);
    it.via = false;
    if (n != null) { const p = nodeCoord(n); Object.assign(it, { node: n, lon: p[0], lat: p[1], name: null }); }
  }
  // 끝에 붙은 지금 역 바로 옆(1km 안)의 옛 역은 같은 역으로 본다
  return out.filter((it, k) => !(k > 0 && k < out.length - 1 && !it.via && [out[0], out[out.length - 1]].some((e) => e.node != null && kmBetween(e.lon, e.lat, it.lon, it.lat) < 1)));
}

/** 폐선 직선화 복원: 옛 역과 양 끝만 찍은 그리기를 연다 (선형 점은 빼서 곧게, 확인·수정 뒤 착공) */
export function openClosedStraight(id, type) {
  const c = closedLines.find((x) => x.id === id);
  if (!c || closedTaken().has(id)) return;
  let pts = closedPoints(c).filter((it) => !it.via);
  // 지금 역에 붙지 않은 이름 없는 끝(옛 선로 도형의 끝)은 옆 옛 역이 2km 안이면 뺀다 (그 역이 끝이 된다)
  const loose = (it, nb) => it.node == null && !it.name && nb && kmBetween(it.lon, it.lat, nb.lon, nb.lat) < 2;
  if (pts.length > 2 && loose(pts[0], pts[1])) pts = pts.slice(1);
  if (pts.length > 2 && loose(pts[pts.length - 1], pts[pts.length - 2])) pts = pts.slice(0, -1);
  startDraft(type);
  if (!draft) return;
  for (const it of pts) {
    const pt = { node: it.node ?? null, lon: it.lon, lat: it.lat, split: null };
    draft.points.push(pt);
    nameDraftPoint(pt, draft.points.length - 1);
    if (it.node == null && it.name) { if (pt.reserved) namer.release(pt.name, 'station'); pt.name = it.name; pt.auto = false; }
  }
  draft.lineName = c.name;
  draft.lineNameEdited = true;
  draft.planTitle = `${c.label} 직선화 복원`;
  draft.closedLine = id;
  drawDraft();
  renderBuild();
  const xs = draft.points.map((p) => p.lon), ys = draft.points.map((p) => p.lat);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 11 });
}

export function startClosedReopen(id, type) {
  const c = closedLines.find((x) => x.id === id);
  if (!c || closedTaken().has(id)) return;
  const pts = closedPoints(c);
  const points = pts.map((it) => ({ node: it.node ?? null, lon: it.lon, lat: it.lat, split: null, via: !!it.via }));
  const names = {};
  pts.forEach((it, i) => {
    if (it.via || it.node != null) return;
    const name = it.name || (namer ? namer.suggest(it.lon, it.lat, 'station') : `${c.name}역`);
    names[i] = { name, kind: 'station', auto: !it.name };
  });
  const segFactor = points.slice(1).map(() => CLOSED_REUSE);
  const n0 = state.projects.length;
  // 양 끝은 기존 선로에 접선으로 붙는다 (옛 선형이 지금 역에 비스듬히 들어오던 것: 토해선–개풍 등)
  const r = startNewBuild(base, state, { type, points: withTangents(points, NEW_BUILDS[type].mode), names, lineName: c.name, title: `${c.label} 재개통`, segFactor });
  if (!r.ok) { alert(r.reason); return; }
  if (state.projects.length > n0) state.projects[state.projects.length - 1].closedLine = id;
  save(state); refreshClosed(); refreshLinks(); renderAll();
  if (state.projects.length > n0) startedNotice(state.projects[state.projects.length - 1]);
}

// ------------------------------------------------------------ 여객 재개통 (역이 없거나 거의 없어 아무도 타지 않는 선로)

export const REOPEN = { perKm: 30, station: 150, years: 2, minPop: 1500, spacingKm: 4, maxStations: 15, sampleKm: 1, minKm: 5 };
// 여객 재개통 대상이 아닌 선로: 이미 여객 열차가 지나는 노선 사이를 잇는 짧은 연결선·삼각선, 차량기지·시험선, 국경 다리
export const REOPEN_SKIP = /삼각선|연결선|기지선|시험선|진입선|입환|친선교|다리$|고속선/;

/** 구간 도형을 따라 stepKm마다 짚은 점들 [lon, lat] */
export function sampleAlong(geom, stepKm) {
  const out = [];
  let need = stepKm;   // 다음 점까지 남은 거리
  for (let k = 0; k + 3 < geom.length; k += 2) {
    const x1 = geom[k], y1 = geom[k + 1], x2 = geom[k + 2], y2 = geom[k + 3];
    if ([x1, y1, x2, y2].some(Number.isNaN)) continue;
    const d = kmBetween(x1, y1, x2, y2);
    let pos = 0;
    while (d - pos >= need) { pos += need; need = stepKm; out.push([x1 + ((x2 - x1) * pos) / d, y1 + ((y2 - y1) * pos) / d]); }
    need -= d - pos;
  }
  return out;
}

/**
 * 노선(같은 이름 구간들)을 따라 1km마다 짚은 자리 가운데 반경 2km 인구가 많은 곳을 역 자리로 고른다.
 * 기존 역(어느 노선이든)과 고른 역끼리 4km 넘게 떨어지게 한다. 노드가 아닌 자리는 착공 때 선로를 갈라 역을 놓는다
 * (예전에는 선로 노드만 후보여서 긴 선로에 역이 한두 곳뿐이었고, 같은 노선 역하고만 거리를 재서 연결선·삼각선에 큰 역 바로 옆 역을 내던 것)
 */
export function reopenPlan(id) {
  const l0 = linkAt(base, state, id);
  if (REOPEN_SKIP.test(l0.name || '')) return null;
  const route = sameRoute(id).filter((i) => !(i < base.links.length && linkPending(base, state, i)) && !state.replaced?.[i] && !(i >= base.links.length && state.newLinks[i - base.links.length]?.replaced));
  const net = effectiveNetwork(base, state);
  const stations = new Set(net.stations);
  const nodes = new Set();
  let km = 0, kp = 0;
  for (const i of route) { const l = linkAt(base, state, i); nodes.add(l.a); nodes.add(l.b); km += l.len; if (l.kp) kp += l.len; }
  if (km < REOPEN.minKm) return null;
  const have = [...nodes].filter((n) => stations.has(n));
  if (have.length > Math.max(1, km / 15)) return null;   // 역이 이미 넉넉하면 재개통 대상이 아니다
  // 둘레 기존 역 (철도·도시철도 모두): 그 4km 안에는 새 역을 내지 않는다
  const xs = route.flatMap((i) => { const l = linkAt(base, state, i); return [nodeCoord(l.a), nodeCoord(l.b)]; }).filter(Boolean);
  const pad = 0.6;
  const x0 = Math.min(...xs.map((c) => c[0])) - pad, x1 = Math.max(...xs.map((c) => c[0])) + pad, y0 = Math.min(...xs.map((c) => c[1])) - pad, y1 = Math.max(...xs.map((c) => c[1])) + pad;
  const near = [];
  for (const n of stations) { const c = nodeCoord(n); if (c && c[0] > x0 && c[0] < x1 && c[1] > y0 && c[1] < y1) near.push(c); }
  // 후보: 노선 노드 + 구간 도형 위 1km마다
  const cand = [];
  for (const n of nodes) if (!stations.has(n)) { const c = nodeCoord(n); if (c) cand.push({ n, link: null, lon: c[0], lat: c[1] }); }
  for (const i of route) {
    const l = linkAt(base, state, i);
    if (!l.geom) continue;
    for (const [x, y] of sampleAlong(l.geom, REOPEN.sampleKm)) cand.push({ n: null, link: i, lon: x, lat: y });
  }
  for (const c of cand) c.pop = popNear(c.lon, c.lat, 2);
  const far = (c, list) => list.every(([x, y]) => kmBetween(c.lon, c.lat, x, y) >= REOPEN.spacingKm);
  const pick = [];
  for (const c of cand.filter((x) => x.pop >= REOPEN.minPop).sort((a, b) => b.pop - a.pop || (a.n == null) - (b.n == null))) {
    if (pick.length >= REOPEN.maxStations) break;
    if (far(c, near) && far(c, pick.map((q) => [q.lon, q.lat]))) pick.push(c);
  }
  if (!pick.length) return null;
  const f = kp * 2 > km ? KP_COST_FACTOR : 1;
  const cost = Math.round((REOPEN.perKm * km + REOPEN.station * pick.length) * f);
  return { route, km, pick, cost, pop: pick.reduce((s0, x) => s0 + x.pop, 0) };
}

export function reopenHTML(id, l) {
  if (l.mode !== 1 || l.cls === 'hsr' || l.ext) return '';
  const r = reopenPlan(id);
  if (!r) return '';
  const ok = canAfford(state, r.cost, REOPEN.years);
  return `<h4>여객 재개통</h4>
    <p class="hint">${esc(l.name || '이 선로')}: 여객역이 거의 없어 이용객이 없습니다. 선로를 손보고(시속 ${REOPEN_SPEED}km까지) 인구가 많은 ${r.pick.length}곳에 역을 열면 여객 열차가 다닙니다.
      (역 반경 2km 인구 합계 ${fmtPeople(r.pop)}, 노선 ${r.km.toFixed(0)}km)</p>
    <div class="actions"><button class="small ${ok ? 'primary' : ''}" id="reopen-go" ${ok ? '' : 'disabled'}>재개통 ${formatWon(r.cost)} · ${REOPEN.years}년</button></div>`;
}

/** 갈라진(splitLink) 구간이면 그 조각들 가운데 이 점에 가장 가까운 것 */
export function liveLinkAt(id, lon, lat) {
  const gone = (i) => (i < base.links.length ? state.replaced?.[i] : state.newLinks[i - base.links.length]?.replaced);
  while (gone(id)) {
    let best = null, bd = Infinity;
    state.newLinks.forEach((nl, k) => {
      if (nl.split !== id) return;
      const g = nl.geom || [];
      for (let j = 0; j + 1 < g.length; j += 2) { const d = (g[j] - lon) ** 2 + (g[j + 1] - lat) ** 2; if (d < bd) { bd = d; best = base.links.length + k; } }
    });
    if (best == null) return id;
    id = best;
  }
  return id;
}

export function startReopen(id) {
  const r = reopenPlan(id);
  if (!r) return;
  if (!canAfford(state, r.cost, REOPEN.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const l = linkAt(base, state, id);
  // 노드가 아닌 역 자리는 선로를 갈라 노드를 만든다 (역은 완공 때 연다)
  for (const x of r.pick) if (x.n == null) x.n = splitLink(base, state, liveLinkAt(x.link, x.lon, x.lat), x.lon, x.lat);
  // 시속 70km로 손볼 구간: 갈라진 구간은 그 조각 모두
  const pieces = (i) => {
    const gone = i < base.links.length ? state.replaced?.[i] : state.newLinks[i - base.links.length]?.replaced;
    if (!gone) return [i];
    return state.newLinks.flatMap((nl, k) => (nl.split === i ? pieces(base.links.length + k) : []));
  };
  const newNames = {};
  for (const x of r.pick) newNames[x.n] = { name: namer ? namer.suggest(x.lon, x.lat, 'station') : `${l.name || ''}역`, kind: 'station', auto: true };
  startProject(state, { id: crypto.randomUUID(), kind: 'reopen', links: [], relinks: [...new Set(r.route.flatMap(pieces))], stations: r.pick.map((x) => x.n), newNames,
    cost: r.cost, years: REOPEN.years, fund: fundFor(state, [l]), label: `${l.name || '선로'} 여객 재개통 (역 ${r.pick.length}곳)` });
  save(state); renderAll();
}

/** 이름·등급·남북이 같은 링크들 (노선 전체 개량용) */
export function sameRoute(id, withOrigin = false) {
  const l = linkAt(base, state, id);
  if (!l.name) return [id];
  const out = [];
  allLinks().forEach((_, i) => {
    const m = linkAt(base, state, i);
    if (m.name === l.name && m.mode === l.mode && m.cls === l.cls && m.kp === l.kp) out.push(i);
  });
  return withOrigin ? out.concat(originConnector(l, out)) : out;
}

// 실제 기점역까지 선로가 다른 노선 이름으로 적힌 북측 노선: 평라선 열차는 평양–간리를 평의선 선로로 다닌다
export const LINE_ORIGIN = { 평라선: '평양', 평덕선: '평양', 만포선: '순천' };

/** 노선 끝에서 실제 기점역까지 다른 이름 선로로 이어지는 구간 (노선 전체 개량에 함께 넣는다) */
export function originConnector(l, route) {
  const origin = LINE_ORIGIN[l.name];
  if (!origin || l.mode !== 1) return [];
  const all = allLinks(), ns = new Set();
  for (const i of route) { ns.add(all[i].a); ns.add(all[i].b); }
  const targets = base.stations.filter((s) => s[0] === origin).map((s) => s[1]);
  if (!targets.length || targets.some((t) => ns.has(t))) return [];
  let best = null;
  for (const t of targets) {
    const tc = nodeCoord(t);
    for (const n of ns) {
      const c = nodeCoord(n), d = c && tc ? kmBetween(c[0], c[1], tc[0], tc[1]) : Infinity;
      if (d < 40 && (!best || d < best.d)) best = { d, n, t };
    }
  }
  if (!best) return [];
  const via = railPath(effectiveNetwork(base, state).links, best.n, best.t, null) || [];
  return via.filter((i) => i < all.length && !route.includes(i));
}

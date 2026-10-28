// 운행 계통을 지도에 노선으로.
import { formatWon, resolve } from '../game/catalog.js';
import { opBadge, operatorOf } from '../game/operators.js';
import { canRun, defaultTrainType, EXISTING_SERVICES, SERVICE_KINDS } from '../game/services.js';
import { canAfford, effectiveNetwork, fundFor, linkAt, linkPending, linksUnderWork, upgradeCost, UPGRADES } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { railStd } from '../ui/railkind.js';
import { base, CLASS_LABEL, esc, map, result, selection, state, wholeRoute } from './core.js';
import { allLinks, linkTwins, nodeCoord, nodeNames, shownTraffic } from './mapdata.js';
import { select } from './interact.js';
import { renderSelection } from './econ.js';
import { servicePlan, serviceSection, setSvcEdit, svcEdit } from './svc.js';
import { fundSelect } from './operators.js';
import { pathCoords } from './straighten.js';
import { drawServicePick, isCommuterLine, nearestStation, routeThrough, setSvcPick, svcPick } from './pick.js';
import { LINE_ORIGIN, originConnector, reopenHTML, sameRoute } from './reopen.js';

// ------------------------------------------------------------ 운행 계통을 지도에 노선으로

export const SVC_COLORS = ['#e4572e', '#2e86de', '#20a35a', '#9b59b6', '#f0a202', '#d6337f', '#0fa3b1', '#7a5c3e', '#596275', '#c0392b', '#6ab04c', '#30336b'];
export let showServices = true;
export function setShowServices(v) { return (showServices = v); }
try { showServices = localStorage.getItem('ukt-svc-lines') !== '0'; } catch { /* 기본은 켬 */ }
export let showHousing = true;   // 택지지구 면·경계·단지 도로 (범례에서 끌 수 있다)
export function setShowHousing(v) { return (showHousing = v); }
try { showHousing = localStorage.getItem('ukt-housing') !== '0'; } catch { /* 기본은 켬 */ }

export function svcColor(s, k) {
  // 예전 저장의 기본 계통은 색이 없다: 실제 노선도 색으로
  return s.color || (s.existing && EXISTING_SERVICES.find((x) => x.name === s.name)?.color) || SVC_COLORS[Math.max(0, k) % SVC_COLORS.length];
}

/** 새 계통 색: 아직 안 쓴 색부터 */
export function nextSvcColor() {
  const used = new Set((state.services || []).map((s, k) => svcColor(s, k)));
  return SVC_COLORS.find((c) => !used.has(c)) || SVC_COLORS[(state.services || []).length % SVC_COLORS.length];
}

/** 계통 구간(a에서 via를 따라)들을 이은 좌표 */
export function serviceCoords(links, segs) {
  const out = [];
  for (const sg of segs) {
    const c = pathCoords(links, sg.via, sg.a);
    out.push(...(out.length ? c.slice(1) : c));
  }
  return out;
}

/**
 * 운행 계통을 계통 색의 노선으로 그린다 (차량 제작 중이면 옅게).
 * 같은 자리를 지나는 계통은 그 자리에서만 나란히 비켜 그린다: 300m 남짓 조각마다 그곳을 함께 지나는 계통 수만큼 칸을 나눠
 * 선로를 가운데에 두고 늘어놓는다 (경의·중앙선과 GTX-A처럼 선로가 달라도 겹쳐 지나면 같은 자리로 친다).
 * 예전에는 계통 번호로 정한 한 칸을 노선 전체에 써서, 번호가 다섯 차이 나는 계통끼리 겹치고 혼자 다니는 곳에서도 비켜 그렸다
 */
export const SVC_CELL = 0.003;   // 겹침을 보는 칸 (경위도, 약 300m)
export function drawServices() {
  const src = map?.getSource('services');
  if (!src || !state) return;
  const f = [];
  if (showServices && state.services?.length) {
    const links = effectiveNetwork(base, state).links;
    const all = allLinks();
    const list = state.services.map((s, k) => ({ s, k })).filter(({ s }) => svcEdit?.id !== s.id && s.segs?.length);
    // 링크가 덮는 칸 (300m 간격으로 짚은 점)
    const cellMemo = new Map();
    const cellsOf = (i) => {
      let c = cellMemo.get(i);
      if (c) return c;
      c = new Set();
      const g = all[i]?.geom || [];
      for (let k = 0; k + 3 < g.length; k += 2) {
        const [x0, y0, x1, y1] = [g[k], g[k + 1], g[k + 2], g[k + 3]];
        if (Number.isNaN(x0) || Number.isNaN(x1)) continue;
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / SVC_CELL));
        for (let t = 0; t <= n; t++) c.add(`${Math.round((x0 + ((x1 - x0) * t) / n) / SVC_CELL)},${Math.round((y0 + ((y1 - y0) * t) / n) / SVC_CELL)}`);
      }
      cellMemo.set(i, c);
      return c;
    };
    const svcCells = list.map(({ s }) => { const set = new Set(); for (const sg of s.segs) for (const i of sg.via) for (const c of cellsOf(i)) set.add(c); return set; });
    const byCell = new Map();
    svcCells.forEach((set, t) => { for (const c of set) { if (!byCell.has(c)) byCell.set(c, []); byCell.get(c).push(t); } });
    // 링크의 기준 방향: 양 끝을 이은 방향이 동쪽(정북 포함)이면 a→b. 칸 번호는 이 방향의 오른쪽을 +로 센다
    // (나란한 다른 선로라도 같은 쪽을 같은 부호로: 반대로 지나는 계통끼리 같은 쪽에 겹치지 않게)
    const canonMemo = new Map();
    const canon = (i) => {
      if (canonMemo.has(i)) return canonMemo.get(i);
      const g = all[i]?.geom || [], n = g.length;
      const dx = n >= 4 ? g[n - 2] - g[0] : 0, dy = n >= 4 ? g[n - 1] - g[1] : 0;
      const v = dx > 0 || (dx === 0 && dy > 0);
      canonMemo.set(i, v);
      return v;
    };
    // 계통 칸 정하기: 긴 계통부터, 칸을 둘 넘게 함께 쓰는(나란히 가는) 계통이 아직 쓰지 않은 가장 작은 칸
    const slotOf = new Array(list.length).fill(0);
    {
      const order = list.map((_, t) => t).sort((x, y) => svcCells[y].size - svcCells[x].size);
      const done = [];
      for (const t of order) {
        const used = new Set();
        for (const u of done) {
          let shared = 0;
          for (const cc of svcCells[t]) if (svcCells[u].has(cc) && ++shared >= 2) break;
          if (shared >= 2) used.add(slotOf[u]);
        }
        let k = 0;
        while (used.has(k)) k++;
        slotOf[t] = k;
        done.push(t);
      }
    }
    // 구간을 함께 지나는 계통: 그 구간 칸의 절반 넘게에 있는 계통 (구간마다 한 번)
    const groupMemo = new Map();
    const linkGroup = (i) => {
      if (groupMemo.has(i)) return groupMemo.get(i);
      const cells = cellsOf(i), tally = new Map();
      for (const cc of cells) for (const t of byCell.get(cc) || []) tally.set(t, (tally.get(t) || 0) + 1);
      const g = [...tally].filter(([, n]) => n * 2 >= cells.size).map(([t]) => t);
      groupMemo.set(i, g);
      return g;
    };
    // 그 자리(칸과 둘레 8칸)를 지나는 계통
    const groupAt = (x, y) => {
      const cx = Math.round(x / SVC_CELL), cy = Math.round(y / SVC_CELL), g = new Set();
      for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (const t of byCell.get(`${cx + u},${cy + v}`) || []) g.add(t);
      return [...g].sort((a, b) => a - b);
    };
    list.forEach(({ s, k }, j) => {
      const props = { id: s.id, color: svcColor(s, k), built: s.built ? 1 : 0 };
      let cur = null;
      const flush = () => { if (cur && cur.c.length > 1) f.push({ type: 'Feature', properties: { ...props, off: cur.off }, geometry: { type: 'LineString', coordinates: cur.c } }); };
      const put = (p, q, off) => {
        if (cur && cur.off === off) cur.c.push(q);
        else { flush(); cur = { off, c: [p, q] }; }
      };
      for (const sg of s.segs) {
        let node = sg.a;
        for (const i of sg.via) {
          const c = pathCoords(links, [i], node);
          const l = links[i];
          const fwd = l.a === node;
          node = fwd ? l.b : l.a;
          const sign = fwd === canon(i) ? 1 : -1;
          // 계통마다 칸 하나를 처음부터 끝까지 (함께 지나는 계통끼리 다른 칸): 칸이 바뀌지 않아 계통 하나가 끊기지 않은 한 줄이 된다.
          // 칸은 진행 방향 오른쪽으로 센다 (예전에는 구간 방향(동서)마다 칸과 쪽이 바뀌어 남북으로 가는 경강선 등이 토막토막 끊겨 보였다)
          for (let m = 0; m + 1 < c.length; m++) put(c[m], c[m + 1], slotOf[j]);
        }
      }
      flush();
    });
  }
  src.setData({ type: 'FeatureCollection', features: f });
}

/** 계통 편집 중: 지금 고른 정차역과 경로를 지도에 */
export function drawServiceEdit() {
  const e = svcEdit;
  if (!e) return;
  const { plan } = servicePlan();
  const f = [...e.stops].filter((n) => nodeCoord(n)).map((n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  if (plan) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: serviceCoords(effectiveNetwork(base, state).links, plan.segs) } });
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
  const src = map.getSource('services');
  if (src && e.id) drawServices();
}

/** 계통 편집 중 지도에서 역을 누르면: 계통 위 역은 정차를 넣고 빼고, 계통 밖 역은 가장 덜 돌아가는 자리에 넣어 경로를 늘린다 */
export function serviceEditClick(ll) {
  const e = svcEdit, n = nearestStation(ll);
  if (n == null) return;
  if (e.nodes.includes(n)) {
    if (e.stops.has(n)) e.stops.delete(n); else e.stops.add(n);
    renderSelection();
    return;
  }
  const stops = e.nodes.filter((x) => e.stops.has(x));
  const d = (a, b) => { const p = nodeCoord(a), q = nodeCoord(b); return kmBetween(p[0], p[1], q[0], q[1]); };
  let at = 0, bc = Infinity;
  for (let k = 0; k <= stops.length; k++) {
    const cost = !stops.length ? 0 : k === 0 ? d(n, stops[0]) : k === stops.length ? d(stops[k - 1], n) : d(stops[k - 1], n) + d(n, stops[k]) - d(stops[k - 1], stops[k]);
    if (cost < bc) { bc = cost; at = k; }
  }
  const picks = [...stops.slice(0, at), n, ...stops.slice(at)];
  const r = picks.length >= 2 ? routeThrough(picks) : null;
  if (!r) { alert('이 역까지 이어지는 철도 경로가 없습니다.'); return; }
  e.lines = r.lines; e.line = r.lines[0]; e.nodes = r.nodes;
  e.stops.add(n);
  renderSelection();
}

export function endServicePick() {
  setSvcPick(null);
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
}

export function servicePickClick(ll) {
  const best = nearestStation(ll);
  if (best == null) return;
  const k = svcPick.picks.indexOf(best);
  if (k >= 0) svcPick.picks.splice(k, 1); else svcPick.picks.push(best);   // 다시 누르면 뺀다
  drawServicePick();
  renderSelection();
}

export function servicePickPanel() {
  const nn = nodeNames(), picks = svcPick.picks;
  return `${header('역 골라 계통 짜기')}
    <p class="hint">열차가 설 역을 지도에서 차례로 누르세요 (다시 누르면 빠집니다). 노선이 달라도 됩니다 — 사이 경로와 지나는 노선은 저절로 잡고 지도에 미리 그립니다.</p>
    <div class="m">${picks.map((n, i) => `${i + 1}. ${esc(nn.get(n)?.name || '')}`).join(' → ') || '아직 고른 역이 없습니다.'}</div>
    <div class="actions">
      <button class="primary" id="sp-ok" ${picks.length >= 2 ? '' : 'disabled'}>이 역들로 계통 만들기</button><button id="sp-cancel">취소</button></div>`;
}

/** 고른 역들을 차례로 잇는 경로를 찾아, 지나는 노선·역 순서로 계통 편집 창을 연다 */
export function commitServicePick() {
  const picks = svcPick.picks;
  const r = routeThrough(picks);
  if (!r) { alert('고른 역 사이를 잇는 철도 경로가 없습니다.'); return; }
  const { nodes, lines, cls, under } = r;
  const nn = nodeNames();
  // 광역 전철 노선만 지나면 광역 전철(모든 역 정차·통근 전동차)로 시작한다
  const commuterOnly = lines.every(isCommuterLine);
  const kind = commuterOnly ? 'commuter' : picks.length <= Math.max(3, nodes.length / 4) ? 'limited' : 'express';
  setSvcEdit({ line: lines[0], lines, cls, kind, name: `${nn.get(picks[0])?.name}–${nn.get(picks[picks.length - 1])?.name} ${SERVICE_KINDS[kind].label}`,
    type: commuterOnly && canRun('commuter', under) ? 'commuter' : defaultTrainType(cls, under), sets: commuterOnly ? 10 : 4, nodes,
    stops: commuterOnly ? new Set(nodes) : new Set(picks), id: null, nameEdited: false, color: nextSvcColor() });
  endServicePick();
  select({ type: 'service' });
}

export function header(title) {
  return `<div class="sel-head"><h3>${esc(title)}</h3><button class="small close" title="닫기 (Esc)">닫기</button></div>`;
}

export function linkPanel(id) {
  const l = linkAt(base, state, id);
  // 분리 차로 쌍은 합친 값 (지도 색과 같게)
  const vc = shownTraffic ? shownTraffic.vc[linkTwins[id]] : 0, vol = shownTraffic ? shownTraffic.vol[linkTwins[id]] : 0;
  const speed = result ? result.links.speed[id] : 0;
  const busyProj = state.projects.find((p) => p.status === 'building' && p.links.includes(id));
  const isRoad = l.mode === 0;
  const planned = id < base.links.length && linkPending(base, state, id);
  const osmProj = planned && state.projects.find((p) => p.kind === 'osm' && p.status === 'building' && p.links.includes(id));
  const ups = l.ext || l.cls === 'ferry' || planned ? [] : UPGRADES.filter((u) => u.mode === l.mode && u.applies(l));
  const isNew = id >= base.links.length;
  const route = sameRoute(id, true);
  const routeKm = route.reduce((sum, x) => sum + linkAt(base, state, x).len, 0);
  const viaKm = originConnector(l, sameRoute(id)).reduce((sum, x) => sum + linkAt(base, state, x).len, 0);
  // 신호 고도화·장편성 (선로 수 말고 수송력을 키운 개량)
  const capRows = l.sig || l.long ? `<tr><td>수송력 개량</td><td>${[l.sig ? '신호 고도화 (운행 +30%)' : '', l.long ? '장편성 (정원 +50%)' : ''].filter(Boolean).join(' · ')}</td></tr>` : '';
  const rows = l.mode === 2
    ? `<tr><td>표정 속도</td><td>${l.speed} km/h</td></tr>
       ${capRows}
       <tr><td>이용객</td><td>${Math.round(vol).toLocaleString()} 명/일</td></tr>`
    : isRoad
    ? `<tr><td>차로</td><td>${l.lanes}차로${l.paved ? '' : ' (비포장)'}</td></tr>
       <tr><td>설계·실제 속도</td><td>${l.speed} / ${speed.toFixed(0)} km/h</td></tr>
       ${l.cls === 'motorway' && l.kp ? `<tr><td>규격</td><td>${l.speed < 95 ? '북측 규격 (아래 재건축으로 남측 규격)' : '남측 규격'}</td></tr>` : ''}
       <tr><td>교통량</td><td>${Math.round(vol).toLocaleString()} PCU/일</td></tr>`
    : `<tr><td>선로</td><td>${l.tracks === 1 ? '단선' : l.tracks === 2 ? '복선' : l.tracks + '선'}</td></tr>
       <tr><td>전력</td><td>${{ AC: '교류 25kV', DC: '직류 3kV', none: '비전철' }[l.power]}</td></tr>
       <tr><td>규격</td><td>${railStd(l) ? '개량 전 북측 철도 (아래 "남측 규격 일괄 개량"으로 한 번에 바꿀 수 있습니다)' : '남측 규격'}</td></tr>
       <tr><td>최고 운행 속도</td><td>${l.speed} km/h</td></tr>
       ${capRows}
       <tr><td>이용객</td><td>${Math.round(vol).toLocaleString()} 명/일</td></tr>`;
  // 누른 곳이 속한 역–역(IC–IC) 구간
  const sec = selection?.type === 'link' && selection.id === id ? selection.section : null;
  const secIds = sec?.ids || [id];
  const secKm = secIds.reduce((s0, x) => s0 + linkAt(base, state, x).len, 0);
  const nnS = nodeNames();
  const secLabel = sec && secIds.length > 1 ? `${nnS.get(sec.A)?.name || '교차로'} – ${nnS.get(sec.B)?.name || '교차로'}` : '';
  return `${header(l.name || CLASS_LABEL[l.cls])}
    ${secLabel ? `<p class="hint">선택 구간: <b>${esc(secLabel)}</b> · ${secKm.toFixed(1)}km (${secIds.length}개 링크). 개량은 이 구간 전체에 적용됩니다.</p>` : ''}
    <table class="kv">
      <tr><td>종류</td><td>${CLASS_LABEL[l.cls]} · ${l.kp ? '북' : '남'}</td></tr>
      ${operatorOf(state, l) ? `<tr><td>운영사</td><td>${opBadge(state, operatorOf(state, l))}</td></tr>` : ''}
      <tr><td>연장</td><td>${l.len.toFixed(1)} km</td></tr>
      ${rows}
      <tr><td>혼잡도 (V/C)</td><td class="${vc > 1 ? 'neg' : ''}">${vc.toFixed(2)}</td></tr>
    </table>
    ${l.mode >= 1 && l.name && !l.ext && !planned ? serviceSection(l) : ''}
    ${!planned && !busyProj ? reopenHTML(id, l) : ''}
    ${isNew && l.name ? `<h4>노선 이름</h4><div class="name-row"><input type="text" id="line-rename" value="${esc(l.name)}">
      <button class="small" id="line-rename-ok">바꾸기</button></div>` : ''}
    ${planned ? `<p class="hint">진행 중인 사업 구간입니다: ${esc(osmProj?.label || '')} · ${osmProj ? `${osmProj.doneYear}년 개통 예정` : ''}. 사업 탭에서 예산 투입 속도를 바꿀 수 있습니다.</p>`
    : l.ext ? '<p class="hint">국외 거점과 잇는 국경 연결 구간입니다. 개량 대상이 아닙니다.</p>'
    : l.cls === 'ferry' ? '<p class="hint">여객선 항로입니다. 개량 대상이 아닙니다.</p>'
    : busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>` : `<h4>개량</h4>
    <div class="actions"><button class="small sec-start" title="두 역·IC를 차례로 눌러 그 사이만 고릅니다">구간 선택 (${l.mode === 0 ? 'IC' : '역'} 두 곳 누르기)</button>
      ${l.mode >= 1 ? '<button class="small" data-padd="station" title="노선 위 한 점을 눌러 역을 놓습니다">이 노선에 역 신설</button>' : l.cls === 'motorway' ? '<button class="small" data-padd="ic">IC·JCT 신설</button><button class="small" data-padd="rest">휴게소 신설</button>' : ''}
      ${l.mode === 1 ? '<button class="small" data-st-start title="두 역 사이를 단순한 곡선으로 새로 놓고 옛 구간은 폐선합니다. 사이 역은 눌러서 자동·제자리 유지·폐역을 고릅니다">구간 직선화</button>' : ''}</div>
    ${l.mode === 1 ? fundSelect([operatorOf(state, l)]) : ''}
    ${lineBatchHTML(l, id)}
    ${route.length > 1 ? `<label class="name-row"><input type="checkbox" id="whole-route" ${wholeRoute ? 'checked' : ''}>
      <span>같은 이름 노선 전체 (${route.length}개 구간, ${routeKm.toFixed(0)}km${viaKm > 0 ? ` · ${LINE_ORIGIN[l.name]}까지 다른 노선과 함께 쓰는 ${viaKm.toFixed(0)}km 포함` : ''})</span></label>` : ''}
    <div class="list">${ups.map((u) => {
      const ids = (wholeRoute && route.length > 1 ? route : secIds).filter((x) => u.applies(linkAt(base, state, x)));
      const cost = ids.reduce((sum, x) => sum + upgradeCost(u, linkAt(base, state, x)), 0);
      const ok = canAfford(state, cost, u.years, fundFor(state, ids.map((x) => linkAt(base, state, x))));
      return `<div class="item opt"><div class="opt-row">
        <span>${resolve(u.label, l)}${ids.length > 1 ? ` · ${ids.length}개 구간` : ''}${upEffect(u, l) ? `<span class="m" style="display:block">${upEffect(u, l)}${ids.length > 1 ? ' (누른 구간 기준)' : ''}</span>` : ''}</span>
        <span class="btns"><button class="small" data-prev-up="${u.id}" title="다 지었을 때 효과">미리보기</button>
        <button class="small ${ok && !u.retire ? 'primary' : ''}" data-up="${u.id}" ${ok ? '' : 'disabled'}>${formatWon(cost)} · ${u.years}년</button></span></div></div>`;
    }).join('') || '<p class="hint">가능한 개량이 없습니다.</p>'}</div>`}`;
}

/** 개량이 바꾸는 값 (누른 구간 기준): "설계 속도 80→95km/h · 연장 12.0→10.8km" */
export function upEffect(u, l) {
  if (u.retire) return '';
  const d = u.apply(l), out = [];
  const sp = l.mode === 2 ? '표정 속도' : l.mode === 0 ? '설계 속도' : '최고 속도';
  if (d.speed != null && d.speed !== l.speed) out.push(`${sp} ${l.speed}→${d.speed}km/h`);
  if (d.len != null && d.len !== l.len) out.push(`연장 ${l.len.toFixed(1)}→${d.len.toFixed(1)}km`);
  if (d.lanes != null && d.lanes !== l.lanes) out.push(`${l.lanes}→${d.lanes}차로`);
  if (l.mode === 1 && d.tracks != null && d.tracks !== l.tracks) out.push(`선로 ${l.tracks}→${d.tracks}개`);
  if (d.power && d.power !== l.power) out.push(d.power === 'AC' ? '교류 25kV 전철' : d.power);
  if (d.paved && !l.paved) out.push('포장 (수송력 회복)');
  if (u.id === 'straighten') out.push('지도 선형은 그대로 (새 자리에 곧게 놓으려면 위의 구간 직선화)');
  return out.join(' · ');
}

/**
 * 노선 일괄 승압·전철화: 같은 이름 노선(실제 기점역까지 함께 쓰는 구간 포함)의 북측 직류 3kV 구간을 모두 교류 25kV로(승압),
 * 비전철 구간을 모두 전철화한다. 구간을 하나하나 고르지 않아도 되고, 한 사업으로 묶어 10% 덜 든다
 */
export const LINE_BATCH_DISCOUNT = 0.9;
export function lineBatch(id) {
  const work = linksUnderWork(state), u = UPGRADES.find((x) => x.id === 'electrify');
  const route = sameRoute(id, true).filter((i) => !work.has(i) && !(i < base.links.length && linkPending(base, state, i)) && !state.replaced?.[i]);
  const make = (pw) => {
    const ids = route.filter((i) => { const m = linkAt(base, state, i); return m.mode === 1 && !m.ext && m.power === pw; });
    const ls = ids.map((i) => linkAt(base, state, i));
    const cost = Math.round(ls.reduce((s0, m) => s0 + upgradeCost(u, m), 0) * LINE_BATCH_DISCOUNT);
    return { ids, km: ls.reduce((s0, m) => s0 + m.len, 0), cost, ok: ids.length > 0 && canAfford(state, cost, u.years, fundFor(state, ls)) };
  };
  return { DC: make('DC'), none: make('none'), years: u.years };
}
export function lineBatchHTML(l, id) {
  if (l.mode !== 1 || !l.name || l.ext) return '';
  const b = lineBatch(id);
  if (!b.DC.ids.length && !b.none.ids.length) return '';
  const row = (k, label) => (b[k].ids.length ? `<div class="item opt"><div class="opt-row"><span>${label} · ${b[k].km.toFixed(0)}km (${b[k].ids.length}개 구간)</span>
    <span class="btns"><button class="small ${b[k].ok ? 'primary' : ''}" data-line-batch="${k}" ${b[k].ok ? '' : 'disabled'}>${formatWon(b[k].cost)} · ${b.years}년</button></span></div></div>` : '');
  return `<h4>노선 일괄 · ${esc(l.name)}</h4>
    <p class="hint">이 노선의 해당 구간을 모두 한 사업으로 (구간을 고르지 않아도 되고 10% 덜 듭니다). 다 지으면 남측 전동차가 이 노선으로 직통할 수 있습니다.</p>
    <div class="list">${row('DC', '노선 전체 승압 (직류 3kV → 교류 25kV)')}${row('none', '노선 전체 전철화 (비전철 → 교류 25kV)')}</div>`;
}

/** 폐도·폐선은 되돌릴 수 없으니 한 번 더 묻는다 (지나는 운행 계통 수도 알려 준다) */
export function confirmRetire(upId, ids) {
  const u = UPGRADES.find((x) => x.id === upId);
  if (!u?.retire) return true;
  const set = new Set(ids);
  const km = ids.reduce((s0, i) => s0 + linkAt(base, state, i).len, 0);
  const svc = (state.services || []).filter((s) => s.segs?.some((sg) => sg.via.some((i) => set.has(i)))).map((s) => s.name);
  return confirm(`${km.toFixed(1)}km를 ${u.mode === 0 ? '폐도' : '폐선'}합니다. 내년에 걷어 내며 되돌릴 수 없습니다.${svc.length ? `
이 구간을 지나는 운행 계통 ${svc.length}개(${svc.slice(0, 4).join(', ')}${svc.length > 4 ? ' 등' : ''})는 다른 길로 다시 짜고, 길이 없으면 멈춥니다.` : ''}`);
}

/** 드래그로 고른 여러 구간: 가장 긴 수단 기준으로 개량을 한꺼번에 */
export function multiPanel(ids) {
  const work = linksUnderWork(state);
  const km = [0, 0, 0];
  for (const i of ids) km[linkAt(base, state, i).mode] += linkAt(base, state, i).len;
  const mode = km.indexOf(Math.max(...km));
  const pool = ids.filter((i) => {
    const l = linkAt(base, state, i);
    return l.mode === mode && !l.ext && l.cls !== 'ferry' && !(i < base.links.length && linkPending(base, state, i)) && !work.has(i);
  });
  const names = [...new Set(pool.map((i) => linkAt(base, state, i).name).filter(Boolean))].slice(0, 6);
  const ups = UPGRADES.filter((u) => u.mode === mode).map((u) => {
    const app = pool.filter((i) => u.applies(linkAt(base, state, i)));
    const cost = app.reduce((s, i) => s + upgradeCost(u, linkAt(base, state, i)), 0);
    const len = app.reduce((s, i) => s + linkAt(base, state, i).len, 0);
    return { u, app, cost, len };
  }).filter((x) => x.app.length);
  const label = ['도로', '철도', '도시철도'][mode];
  const sc = selection?.type === 'multi' ? selection.section : null;
  const nn = nodeNames();
  const title = sc ? `${nn.get(sc.A)?.name || '교차점'} – ${nn.get(sc.B)?.name || '교차점'} 구간` : `${label} ${pool.length}개 구간 선택`;
  return `${header(title)}
    ${sc ? `<div class="actions">${sc.mode === 1 ? '<button class="small" id="sec-straight">이 구간 직선화</button>' : ''}
      <button class="small" id="sec-prev">첫 개량 효과 미리보기</button><button class="small sec-start">다른 구간 고르기</button></div>` : ''}
    <p class="hint">${km[mode].toFixed(0)}km · ${names.map(esc).join(', ')}${names.length === 6 ? ' 등' : ''}${pool.length < ids.length ? ` (다른 수단·공사 중 구간 ${ids.length - pool.length}개 제외)` : ''}<br>Shift를 누른 채 구간을 누르면 더하거나 빼고, Shift를 누른 채 끌면 상자 안 구간을 한꺼번에 고릅니다.</p>
    <div class="list">${ups.map(({ u, app, cost, len }) => {
      const ok = canAfford(state, cost, u.years);
      return `<div class="item opt"><div class="opt-row">
        <span>${resolve(u.label, linkAt(base, state, app[0]))} · ${app.length}개 구간 ${len.toFixed(0)}km</span>
        <button class="small ${ok && !u.retire ? 'primary' : ''}" data-mup="${u.id}" data-ids="${JSON.stringify(app)}" ${ok ? '' : 'disabled'}>${formatWon(cost)} · ${u.years}년</button></div></div>`;
    }).join('') || '<p class="hint">고른 구간에 가능한 개량이 없습니다.</p>'}</div>`;
}

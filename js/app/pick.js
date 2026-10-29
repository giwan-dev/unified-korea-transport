// 구간 선택·넓히기, 역을 골라 계통 짜기.
import { railPath } from '../game/services.js';
import { effectiveNetwork, linkAt } from '../game/state.js';
import { base, esc, map, state } from './core.js';
import { allLinks, nodeCoord, nodeNames } from './mapdata.js';
import { select } from './interact.js';
import { cancelDraft } from './draw.js';
import { renderSelection } from './econ.js';
import { railStationSet } from './svc.js';
import { endStraighten, straight } from './straighten.js';
import { endHousingPick } from './housing.js';
import { header, serviceCoords } from './svcmap.js';
import { linesAt } from './gazette.js';

// ------------------------------------------------------------ 구간 선택 (두 역·IC를 차례로 눌러)

export let secPick = null;   // {mode, line, cls, picks: [노드]}

export function startSection(linkId) {
  const l = linkAt(base, state, linkId);
  cancelDraft();
  if (straight) endStraighten();
  secPick = { mode: l.mode, line: l.name, cls: l.cls, picks: [] };
  map.getCanvas().style.cursor = 'crosshair';
  select({ type: 'section' });
}

export function endSection() {
  secPick = null;
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
}

/** 누른 곳에서 가장 가까운 역·IC (철도는 역, 도로는 이름 있는 IC·JCT 또는 아무 교차점). 화면 30px 안 */
export function sectionClick(ll) {
  const p = map.project(ll);
  const nn = nodeNames();
  const cand = new Set();
  allLinks().forEach((_, i) => {
    const e = linkAt(base, state, i);
    if (e.mode !== secPick.mode || state.replaced?.[i]) return;
    for (const n of [e.a, e.b]) cand.add(n);
  });
  const stations = secPick.mode >= 1 ? railStationSet() : null;
  let best = null, bd = 30;
  for (const n of cand) {
    if (stations && secPick.mode === 1 && !stations.has(n)) continue;
    if (secPick.mode === 2 && nn.get(n)?.kind !== 'station') continue;
    const c = nodeCoord(n);
    if (!c) continue;
    const q = map.project(c);
    const d = Math.hypot(q.x - p.x, q.y - p.y) - (nn.has(n) ? 6 : 0);   // 이름 있는 역·IC를 조금 더 잘 잡는다
    if (d < bd) { bd = d; best = n; }
  }
  if (best == null) return;
  if (secPick.picks.length >= 2) secPick.picks = [];
  secPick.picks.push(best);
  const f = secPick.picks.map((n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
  if (secPick.picks.length < 2) { renderSelection(); return; }
  const [A, B] = secPick.picks;
  const via = railPath(effectiveNetwork(base, state).links, A, B, secPick.line, secPick.mode);
  if (!via || !via.length) { alert('두 곳 사이 경로를 찾지 못했습니다.'); secPick.picks = []; renderSelection(); return; }
  const section = { A, B, line: secPick.line, cls: secPick.cls, mode: secPick.mode };
  const mode = secPick.mode;
  endSection();
  map.getCanvas().style.cursor = '';
  select({ type: 'multi', ids: via, section });
}

export function sectionPanel() {
  const nn = nodeNames();
  const what = secPick.mode === 0 ? 'IC·교차점' : '역';
  return `${header('구간 선택')}
    <p class="hint">${esc(secPick.line || '')} 위의 ${what} 두 곳을 차례로 누르세요 (드래그하지 않아도 됩니다).
      ${secPick.picks.length ? `고른 곳: ${secPick.picks.map((n) => esc(nn.get(n)?.name || '이름 없는 교차점')).join(' → ')}` : ''}</p>
    <p class="hint">두 곳 사이 경로(같은 노선을 우선)가 선택되고, 그 구간만 개량하거나${secPick.mode === 1 ? ' 직선화하거나' : ''} 효과를 미리 볼 수 있습니다.</p>`;
}

// ------------------------------------------------------------ 누른 구간을 역과 역(IC와 IC) 사이로 넓히기

/**
 * 누른 링크에서 같은 이름·같은 수단의 링크를 따라 양쪽으로 가다가, 철도는 역에서, 도로는 이름 있는 IC·JCT나
 * 다른 간선(고속도로·간선국도·주요 도로)이 만나는 교차점에서 멈춘다. 갈림길(같은 노선이 세 갈래 이상)에서도 멈춘다.
 * @returns {{ids:number[], A:number, B:number}}
 */
export function sectionOf(id) {
  const l0 = linkAt(base, state, id);
  const all = allLinks();
  const at = new Map();   // 노드 → 그 노드에 닿은 링크 id
  all.forEach((_, i) => {
    const e = linkAt(base, state, i);
    if (e.mode !== l0.mode || state.replaced?.[i] || e.replaced || (i >= base.links.length && !e.built)) return;
    for (const n of [e.a, e.b]) { if (!at.has(n)) at.set(n, []); at.get(n).push(i); }
  });
  const nn = nodeNames();
  const stations = l0.mode === 1 ? railStationSet() : null;
  const major = new Set(['motorway', 'trunk', 'primary']);
  const same = (i) => { const e = linkAt(base, state, i); return e.name === l0.name && e.cls === l0.cls; };
  const isStop = (n) => {
    const here = at.get(n) || [];
    if (here.filter(same).length !== 2) return true;          // 끝이나 갈림길
    if (l0.mode === 1) return stations.has(n);
    if (l0.mode === 2) return nn.get(n)?.kind === 'station';
    const k = nn.get(n)?.kind;
    if (k === 'IC' || k === 'JCT' || k === 'rest') return true;
    return here.some((i) => !same(i) && major.has(linkAt(base, state, i).cls));
  };
  if (!l0.name) return { ids: [id], A: l0.a, B: l0.b };
  const ids = [id];
  const walk = (from) => {
    let node = from, prev = id, km = 0;
    while (!isStop(node) && km < 80) {
      const next = (at.get(node) || []).find((i) => i !== prev && same(i) && !ids.includes(i));
      if (next == null) break;
      ids.push(next);
      const e = linkAt(base, state, next);
      km += e.len;
      node = e.a === node ? e.b : e.a;
      prev = next;
    }
    return node;
  };
  const A = walk(l0.a), B = walk(l0.b);
  return { ids, A, B };
}

// ------------------------------------------------------------ 역을 여러 개 골라 계통 짜기

export let svcPick = null;   // {picks: [역 노드]}
export function setSvcPick(v) { return (svcPick = v); }

export function startServicePick(first = []) {
  endHousingPick();   // 택지지구 고르기 중이면 끝낸다 (지도 클릭을 가로채지 않도록)
  cancelDraft();
  if (straight) endStraighten();
  if (secPick) endSection();
  svcPick = { picks: [...first] };
  map.getCanvas().style.cursor = 'crosshair';
  select({ type: 'svcpick' });
  drawServicePick();
}

/** 광역 전철이 다니는 일반철도 노선인지 (분당선·신분당선·경의중앙선 등): 광역철도로 표시하고 계통을 짤 때 통근 전동차로 */
export function isCommuterLine(name) {
  if (!name) return false;
  if (/^(신분당선|분당선|수인선|경강선|경춘선|서해선|수도권|서울 지하철 1호선)/.test(name)) return true;
  return (state.services || []).some((s) => s.kind === 'commuter' && (s.lines || [s.line]).includes(name));
}

/** 화면에서 누른 자리에서 가장 가까운(30px 안) 철도역 */
export function nearestStation(ll) {
  const p = map.project(ll), stations = railStationSet();
  let best = null, bd = 30;
  for (const n of stations) {
    const c = nodeCoord(n);
    if (!c) continue;
    const q = map.project(c);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** 고른 역들 사이를 차례로 잇는 철도 경로: 지나는 역 순서(nodes)·노선(lines)·등급(cls). 길이 없으면 null */
export function routeThrough(picks) {
  const net = effectiveNetwork(base, state), stSet = railStationSet();
  const lineKm = new Map(), nodes = [picks[0]], segs = [];
  // 두 역이 함께 지나는 노선(분당선 왕십리–수원 등)이 있으면 그 노선을 따라 간다: 가장 빠른 길은 고속선(수서평택고속선)으로 새기도 한다
  const common = (a, b) => { const la = new Set(linesAt(a).filter((x) => x.named && x.mode === 1).map((x) => x.name)); return linesAt(b).filter((x) => x.named && x.mode === 1 && la.has(x.name)).map((x) => x.name); };
  for (let k = 0; k + 1 < picks.length; k++) {
    const share = common(picks[k], picks[k + 1]);
    const onLine = share.length ? railPath(net.links, picks[k], picks[k + 1], new Set(share)) : null;
    if (onLine) {
      segs.push({ a: picks[k], via: onLine });
      let node = picks[k];
      for (const i of onLine) {
        const l = net.links[i];
        if (l.name) lineKm.set(l.name, (lineKm.get(l.name) || 0) + l.len);
        node = l.a === node ? l.b : l.a;
        if (stSet.has(node) && nodes[nodes.length - 1] !== node) nodes.push(node);
      }
      continue;
    }
    let via = railPath(net.links, picks[k], picks[k + 1], null);
    if (!via) return null;
    // 가장 빠른 길이 짧은 연결선을 여럿 거치면 계통이 지저분해진다: 길게 지나는 노선만 골라 그 노선을 따라 다시 찾는다
    const km = new Map();
    for (const i of via) { const l = net.links[i]; km.set(l.name, (km.get(l.name) || 0) + l.len); }
    const legKm = [...km.values()].reduce((a, b) => a + b, 0);
    const main = new Set([...km].filter(([, v]) => v >= Math.min(10, legKm * 0.15)).map(([n]) => n));
    via = railPath(net.links, picks[k], picks[k + 1], main) || via;
    segs.push({ a: picks[k], via });
    let node = picks[k];
    for (const i of via) {
      const l = net.links[i];
      if (l.name) lineKm.set(l.name, (lineKm.get(l.name) || 0) + l.len);
      node = l.a === node ? l.b : l.a;
      if (stSet.has(node) && nodes[nodes.length - 1] !== node) nodes.push(node);
    }
  }
  // 몇 km 안 되는 연결선은 계통 노선 목록에서 뺀다 (경로에는 그대로 쓰인다)
  const lines = [...lineKm].filter(([, v]) => v >= 3).map(([n]) => n);
  if (!lines.length) lines.push(...lineKm.keys());
  const cls = net.links.some((l) => lines.includes(l.name) && l.cls === 'hsr') && lines.every((n) => net.links.find((l) => l.name === n)?.cls === 'hsr') ? 'hsr' : 'conv';
  // 열차 종류는 실제로 지나는 구간으로 정한다 (노선 전체로 보면 공사 중인 비전철 구간(신분당선 신사–용산)에 걸려 디젤이 된다)
  const under = segs.flatMap((sg) => sg.via.map((i) => net.links[i])).filter((l) => l && l.mode === 1 && !l.via);
  return { nodes: nodes.filter((n, i) => nodes.indexOf(n) === i), lines, cls, under, segs };
}

export function drawServicePick() {
  const picks = svcPick.picks;
  const f = picks.map((n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  const r = picks.length >= 2 ? routeThrough(picks) : null;
  if (r) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: serviceCoords(effectiveNetwork(base, state).links, r.segs) } });
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
}

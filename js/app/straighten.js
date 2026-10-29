// 구간 직선화.
import { branchTangent, trackHeadings, unitDir } from '../game/branch.js';
import { formatWon, KP_COST_FACTOR } from '../game/catalog.js';
import { polylineKm } from '../game/curve.js';
import { operatorOf } from '../game/operators.js';
import { planService, railPath, tripsPerDay } from '../game/services.js';
import { effectiveNetwork, isKP, linkAt, NEW_BUILDS, save, startNewBuild } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { P } from '../sim/params.js';
import { base, esc, map, MID_COST, selection, state, zonesFC } from './core.js';
import { allLinks, nodeCoord, nodeNames, refreshLinks, refreshPoints } from './mapdata.js';
import { select } from './interact.js';
import { cancelDraft } from './draw.js';
import { fmtMin } from './route.js';
import { renderAll } from './panels.js';
import { renderSelection } from './econ.js';
import { railStationSet, stationRiders } from './svc.js';
import { bindFund, fundSelect } from './operators.js';
import { startedNotice } from './plans.js';
import { endHousingPick, inRing } from './housing.js';
import { warmPreview } from './preview.js';
import { previewStraighten } from './compare.js';
import { header } from './svcmap.js';
import { linesAt } from './gazette.js';

// ------------------------------------------------------------ 구간 직선화 (두 역 사이를 가장 단순한 곡선으로)

export let straight = null;   // {line, cls, picks: [역 노드], plan}

export function startStraighten(linkId, preset = null) {
  endHousingPick();   // 택지지구 고르기 중이면 끝낸다 (지도 클릭을 가로채지 않도록)
  const l = linkId != null ? linkAt(base, state, linkId) : null;
  cancelDraft();
  straight = { line: preset?.line ?? l?.name, cls: preset?.cls ?? l?.cls, picks: preset?.picks ? [...preset.picks] : [], plan: null, modes: new Map() };
  warmPreview();
  map.getCanvas().style.cursor = 'crosshair';
  if (straight.picks.length === 2) { straight.plan = planStraighten(); drawStraighten(); }
  select({ type: 'straighten' });
}

export function endStraighten() {
  document.querySelector('.st-menu')?.remove();
  straight = null;
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
  if (selection?.type === 'straighten') select(null);
}

/** 노선 위의 역 가운데 누른 곳에서 가장 가까운 역 (화면 30px 안) */
export function straightenClick(ll) {
  // 두 역을 고른 뒤에는 사이의 역을 누르면 처리(자동·제자리 유지·폐역)를 고르는 메뉴를 띄운다
  if (straight.plan) {
    const p0 = map.project(ll);
    let hit = null, hd = 24;
    // 사이 역은 원래 자리와, 미리보기에서 새 선로 위로 옮겨 그린 자리 어느 쪽을 눌러도 잡는다
    const keptPos = new Map(straight.plan.kept.flatMap((k) => [[k.node, k.pos], ...(k.merged || []).map((m) => [m.node, k.pos])]));
    for (const m of straight.plan.mids) {
      for (const c of [nodeCoord(m.node), keptPos.get(m.node)]) {
        if (!c) continue;
        const q = map.project(c);
        const d = Math.hypot(q.x - p0.x, q.y - p0.y);
        if (d < hd) { hd = d; hit = m; }
      }
    }
    if (hit) { straightMenu(hit, p0); return; }
    // 두 역을 고른 뒤에는 양 끝 역이 아닌 곳을 눌러도 고른 구간을 지우지 않는다 (사이 역을 고르려다 잘못 누른 것)
    const ends = straight.picks.map((n) => map.project(nodeCoord(n)));
    if (!ends.some((q) => Math.hypot(q.x - p0.x, q.y - p0.y) < 30)) return;
  }
  // 고른 노선의 역을 고른다. 둘째 역은 그 노선 역이 누른 곳 곁에 없을 때만 이어진 다른 일반철도 노선의 역도 (평부선–경의선처럼 남북 연결 구간).
  // 고속선 역은 고르지 않는다 (경의·경원 고속선을 지은 뒤 기존선을 직선화하면 바로 곁의 고속선 역이 잡혔다)
  const stSet = railStationSet();
  const own = new Set(), other = new Set();
  allLinks().forEach((l, i) => {
    const e = linkAt(base, state, i);
    if (e.mode !== 1 || state.replaced?.[i]) return;
    if (e.name === straight.line) { for (const n of [e.a, e.b]) if (stSet.has(n)) own.add(n); }
    else if (straight.picks.length === 1 && e.cls !== 'hsr') for (const n of [e.a, e.b]) if (stSet.has(n)) other.add(n);
  });
  const p = map.project(ll);
  const nearest = (set) => {
    let b = null, bd = 30;
    for (const n of set) {
      const q = map.project(nodeCoord(n));
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) { bd = d; b = n; }
    }
    return b;
  };
  const best = nearest(own) ?? nearest(other);
  if (best == null) return;
  if (straight.picks.length >= 2) { straight.picks = []; straight.modes = new Map(); }
  if (!straight.picks.includes(best)) straight.picks.push(best);
  straight.plan = straight.picks.length === 2 ? planStraighten() : null;
  drawStraighten();
  renderSelection();
}

export const ST_MODES = [['auto', '자동 (새 선로 위로 옮김)'], ['pin', '제자리 유지 (접선으로 지나감)'], ['drop', '폐역']];

/** 직선화 사이 역의 처리 메뉴: 누른 역 곁에 띄운다 */
export function straightMenu(m, pt) {
  document.querySelector('.st-menu')?.remove();
  const el = document.createElement('div');
  el.className = 'st-menu';
  const cur = straight.modes.get(m.node) || 'auto';
  el.innerHTML = `<div class="t">${esc(m.name)}</div>${ST_MODES.map(([k, label]) => `<button class="small ${k === cur ? 'on' : ''}" data-st-mode="${k}">${label}</button>`).join('')}`;
  const box = map.getContainer().getBoundingClientRect();
  Object.assign(el.style, { left: `${Math.min(box.left + pt.x + 12, window.innerWidth - 220)}px`, top: `${Math.min(box.top + pt.y + 12, window.innerHeight - 140)}px` });
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  el.querySelectorAll('[data-st-mode]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.stMode === 'auto') straight.modes.delete(m.node); else straight.modes.set(m.node, b.dataset.stMode);
      close();
      straight.plan = planStraighten();
      drawStraighten(); renderSelection();
    };
  });
}

/** 옛 경로를 따라 이은 좌표 (A에서 B 방향) */
export function pathCoords(links, via, from) {
  const out = [];
  let node = from;
  for (const i of via) {
    const l = links[i];
    const g = allLinks()[i]?.geom || [];
    const pts = [];
    for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) pts.push([g[k], g[k + 1]]);
    const fwd = l.a === node;
    const seq = fwd ? pts : pts.reverse();
    out.push(...(out.length ? seq.slice(1) : seq));
    node = fwd ? l.b : l.a;
  }
  return out;
}

/**
 * 새 선형: 옛 경로가 두 역을 잇는 직선에서 많이 벗어나지 않으면 직선, 아니면 옛 경로의 가운데를 향해 한 번만 휘는 2차 곡선.
 * 사이의 역은 새 선형 위 가장 가까운 자리로 옮기고, 너무 가까워진 역(일반 1.5km, 고속 5km 안)은 이용객이 많은 쪽으로 합친다.
 */
export function planStraighten() {
  const net = effectiveNetwork(base, state);
  const [A, B] = straight.picks;
  // 두 역이 서로 다른 노선이면 두 노선을 함께 따라간다
  const lines = new Set([straight.line, ...linesAt(A).map((x) => x.name), ...linesAt(B).map((x) => x.name)].filter(Boolean));
  let via = railPath(net.links, A, B, lines);
  // 이름이 다른 연결선(보통강–서평양 경의선 연결선 등)으로 훨씬 짧게 이어지면 그 길을 편다: 두 역 노선만 따라가면 평양역을 크게 돌아간다
  const any = railPath(net.links, A, B, null);
  const kmOf = (v) => (v || []).reduce((s0, i) => s0 + net.links[i].len, 0);
  if (any?.length && (!via?.length || kmOf(any) < kmOf(via) * 0.8)) via = any;
  if (!via || !via.length) return null;
  const oldKm = via.reduce((s, i) => s + net.links[i].len, 0);
  const oldMin = via.reduce((s, i) => s + (net.links[i].len / net.links[i].speed) * 60, 0);
  const path = pathCoords(net.links, via, A);
  const pa = nodeCoord(A), pb = nodeCoord(B);
  const N = 200;
  // 양 끝에서 이어지는 바깥 선로(직선화하지 않는 쪽)의 접선: 새 선형이 그 방향으로 들어오고 나간다
  const viaSet = new Set(via);
  const outer = allLinks().map((_, i) => (viaSet.has(i) || state.replaced?.[i] ? null : linkAt(base, state, i)));
  const okRail = (l) => l.mode === 1 && !l.ext && !l.replaced;
  const chordDir = unitDir(pa, pb);
  const runLines = new Set([straight.line, ...via.map((i) => net.links[i].name)].filter(Boolean));   // 곧게 펴는 구간이 실제로 지나는 노선
  // 갈림역(서포 등)에서는 곧게 펴는 노선이 이어지는 선로 방향을 먼저 따른다: 다른 노선(룡성선 등) 방향을 잡으면 새 선형이 크게 돌아 나간다
  const endTangent = (n, p) => {
    const pt = { node: n, lon: p[0], lat: p[1] };
    const own = trackHeadings(outer, nodeCoord, pt, (l) => okRail(l) && runLines.has(l.name));
    return branchTangent(own.length ? own : trackHeadings(outer, nodeCoord, pt, okRail), chordDir);
  };
  const tA = endTangent(A, pa);
  const tB = endTangent(B, pb);
  // 어느 후보든 길이를 따라 고르게 n+1개 점으로 다시 찍는다 (곡률·역 위치 계산이 점 번호를 쓴다)
  const resample = (c, n = N) => {
    const cum = [0];
    for (let k = 1; k < c.length; k++) cum.push(cum[k - 1] + kmBetween(c[k - 1][0], c[k - 1][1], c[k][0], c[k][1]));
    const total = cum[cum.length - 1] || 1e-9, out = [];
    let j = 0;
    for (let k = 0; k <= n; k++) {
      const d = (total * k) / n;
      while (j + 1 < cum.length - 1 && cum[j + 1] < d) j++;
      const t = Math.min(1, Math.max(0, (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j])));
      out.push([c[j][0] + t * (c[j + 1][0] - c[j][0]), c[j][1] + t * (c[j + 1][1] - c[j][1])]);
    }
    return out;
  };
  const offLand = (c) => { let n = 0; for (let k = 0; k < c.length; k += 4) if (!onLand(c[k][0], c[k][1])) n++; return n / Math.ceil(c.length / 4); };
  // 옛 경로에서 점 q에 가장 가까운 점 번호
  const nearestIdx = (q) => { let bk = 0, bd = Infinity; path.forEach((p, k) => { const d = kmBetween(q[0], q[1], p[0], p[1]); if (d < bd) { bd = d; bk = k; } }); return bk; };

  /**
   * 두 닻(역) 사이 한 토막: 옛 경로가 두 점을 잇는 직선에서 많이 벗어나지 않으면 직선, 아니면 옛 경로 가운데를 향해 한 번 휜 곡선.
   * 끝 접선(ta: u에서 떠나는 방향, tb: v로 들어오는 방향, [동, 북])이 있으면 그 방향으로 나가고 들어온다
   */
  const segCurve = (pu, pv, ta, tb, sub) => {
    const chord = kmBetween(pu[0], pu[1], pv[0], pv[1]);
    const subKm = polylineKm(sub);
    let acc = 0, mid = sub[0], dev = 0;
    for (let k = 1; k < sub.length; k++) {
      const d = kmBetween(sub[k - 1][0], sub[k - 1][1], sub[k][0], sub[k][1]);
      if (acc < subKm / 2 && acc + d >= subKm / 2) mid = sub[k];
      acc += d;
    }
    const m0 = [(pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2];
    for (const q of sub) dev = Math.max(dev, distToSegKm(q, pu, pv));
    const cTip = [2 * mid[0] - m0[0], 2 * mid[1] - m0[1]];
    const bezier = (bow) => {
      const c = [m0[0] + bow * (cTip[0] - m0[0]), m0[1] + bow * (cTip[1] - m0[1])];
      // 2차 곡선을 3차로 올린 뒤, 끝 접선이 있으면 제어점 방향만 기존 선로 쪽으로 돌린다 (길이는 그대로)
      const ctl = (p, q, t, sgn) => {
        const v = [(2 / 3) * (q[0] - p[0]), (2 / 3) * (q[1] - p[1])];
        if (!t) return [p[0] + v[0], p[1] + v[1]];
        const ck = Math.cos((p[1] * Math.PI) / 180);
        const len = Math.max(Math.hypot(v[0] * ck, v[1]), (chord / 3) / 111);
        return [p[0] + (sgn * t[0] * len) / ck, p[1] + sgn * t[1] * len];
      };
      const c1 = ctl(pu, c, ta, 1), c2 = ctl(pv, c, tb, -1);
      return Array.from({ length: N + 1 }, (_, k) => {
        const t = k / N, u = 1 - t;
        return [u ** 3 * pu[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * pv[0], u ** 3 * pu[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * pv[1]];
      });
    };
    const smoothSub = () => {
      // 옛 경로를 약 1km 간격으로 솎은 뒤 두 번 다듬는다 (작은 굽이만 편다)
      const pts = [sub[0]];
      let a2 = 0;
      for (let k = 1; k < sub.length; k++) {
        a2 += kmBetween(sub[k - 1][0], sub[k - 1][1], sub[k][0], sub[k][1]);
        if (a2 >= 1) { pts.push(sub[k]); a2 = 0; }
      }
      pts.push(sub[sub.length - 1]);
      let q = pts;
      for (let it = 0; it < 2; it++) {
        const r = [q[0]];
        for (let k = 0; k + 1 < q.length; k++) r.push([0.75 * q[k][0] + 0.25 * q[k + 1][0], 0.75 * q[k][1] + 0.25 * q[k + 1][1]], [0.25 * q[k][0] + 0.75 * q[k + 1][0], 0.25 * q[k][1] + 0.75 * q[k + 1][1]]);
        r.push(q[q.length - 1]);
        q = r;
      }
      return q;
    };
    const cands = [];
    if (dev > 0.08 * chord) cands.push(['한 번 휜 곡선', bezier(0.6)], ['완만하게 휜 곡선', bezier(0.3)]);
    cands.push(['직선', bezier(0)], ['옛 경로를 따라 다듬은 선형', resample(sub.length > 1 ? smoothSub() : [pu, pv])]);
    for (const [label, c] of cands) {
      const km = polylineKm(c) * 1.02;
      if (offLand(c) <= 0.02 && (km < subKm * 0.98 || label.startsWith('옛'))) return { label, curve: c, subKm };
    }
    return { label: cands[cands.length - 1][0], curve: cands[cands.length - 1][1], subKm };
  };

  // 사이의 역: 옛 경로 순서대로. 사용자가 고른 처리(자동: 새 선로 위로 · 제자리 유지 · 폐역)
  const stSet = railStationSet(), riders = stationRiders();
  const mids = [];
  let node = A;
  for (const i of via) { const l = net.links[i]; node = l.a === node ? l.b : l.a; if (node !== B && stSet.has(node)) mids.push(node); }
  const modeOf = (n) => straight.modes?.get(n) || 'auto';
  // 제자리 유지 역에서 토막을 나눈다: 그 역의 옛 선로 진행 방향(접선)으로 들어가고 나온다
  const anchors = [{ node: A, pos: pa, k: 0, tIn: null, tOut: tA }];
  for (const n of mids) {
    if (modeOf(n) !== 'pin') continue;
    const c = nodeCoord(n), k = nearestIdx(c);
    if (k <= anchors[anchors.length - 1].k) continue;
    const p0 = path[Math.max(0, k - 1)], p1 = path[Math.min(path.length - 1, k + 1)];
    const t = unitDir(p0, p1);
    anchors.push({ node: n, pos: c, k, tIn: t, tOut: t });
  }
  anchors.push({ node: B, pos: pb, k: path.length - 1, tIn: tB, tOut: null });
  const segs = [];
  for (let s = 0; s + 1 < anchors.length; s++) {
    const u = anchors[s], v = anchors[s + 1];
    const sub = path.slice(u.k, v.k + 1);
    if (sub.length < 2) sub.push(v.pos);
    sub[0] = u.pos; sub[sub.length - 1] = v.pos;
    segs.push(segCurve(u.pos, v.pos, u.tOut, v.tIn, sub));
  }
  const joined = segs.flatMap((sg, i) => (i ? sg.curve.slice(1) : sg.curve));
  const curve = resample(joined);
  const shape = segs.length === 1 ? segs[0].label : `${segs.length}토막 (${[...new Set(segs.map((sg) => sg.label))].join('·')})`;
  const seaShare = offLand(curve);
  const ctrl = segs.some((sg) => sg.label.includes('휜'));
  const smoothed = segs.every((sg) => sg.label.startsWith('옛'));
  // 옛 경로를 다듬은 선형은 옛 선로보다 길어지지 않는다 (작은 굽이만 편다)
  const newKm = segs.reduce((acc, sg) => acc + (sg.label.startsWith('옛') ? Math.min(polylineKm(sg.curve), sg.subKm * 0.99) : polylineKm(sg.curve) * 1.02), 0);
  // 곡선 반경으로 낼 수 있는 속도 (v ≈ 4.7 √R, R은 m)
  let minR = Infinity;
  for (let k = 1; k < N; k++) {
    const a = curve[k - 1], b = curve[k], c = curve[k + 1];
    const ab = kmBetween(a[0], a[1], b[0], b[1]), bc = kmBetween(b[0], b[1], c[0], c[1]), ac = kmBetween(a[0], a[1], c[0], c[1]);
    const s = (ab + bc + ac) / 2, area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ac)));
    if (area > 1e-12) minR = Math.min(minR, (ab * bc * ac) / (4 * area) * 1000);
  }
  const vmax = straight.cls === 'hsr' ? 300 : 200;
  const oldSpeed = Math.max(...via.map((i) => net.links[i].speed));
  let speed = Math.round(Math.min(vmax, isFinite(minR) ? 4.7 * Math.sqrt(minR) : vmax) / 10) * 10;
  if (smoothed) speed = Math.max(speed, Math.min(vmax, oldSpeed + 20));   // 다듬은 만큼은 옛 선로보다 빠르다
  const nn = nodeNames();
  const proj = mids.filter((n) => modeOf(n) !== 'drop').map((n) => {
    const c = nodeCoord(n);
    let bk = 0, bdd = Infinity;
    curve.forEach((q, k) => { const d = kmBetween(c[0], c[1], q[0], q[1]); if (d < bdd) { bdd = d; bk = k; } });
    const pin = modeOf(n) === 'pin';
    return { node: n, name: nn.get(n)?.name || '', t: bk / N, pos: pin ? c : curve[bk], moveKm: pin ? 0 : bdd, riders: riders.get(n) || 0, pin };
  }).filter((x) => x.t > 0.01 && x.t < 0.99).sort((x, y) => x.t - y.t);
  const gap = straight.cls === 'hsr' ? 5 : 1.5;
  const kept = [];
  for (const s of proj) {
    const prev = kept[kept.length - 1];
    if (prev && kmBetween(prev.pos[0], prev.pos[1], s.pos[0], s.pos[1]) < gap && !(prev.pin && s.pin)) {
      // 너무 가까운 두 역은 하나로: 제자리 유지 역이 남고, 아니면 이용객이 많은 쪽이 남는다
      const sWins = s.pin || (!prev.pin && s.riders > prev.riders);
      if (sWins) { s.merged = [...(prev.merged || []), prev]; kept[kept.length - 1] = s; } else (prev.merged ||= []).push(s);
    } else kept.push(s);
  }
  const dropped = mids.filter((n) => modeOf(n) === 'drop').map((n) => ({ node: n, name: nn.get(n)?.name || '' }));
  const midList = mids.map((n) => ({ node: n, name: nn.get(n)?.name || '', mode: modeOf(n) }));
  const spec = NEW_BUILDS[straight.cls === 'hsr' ? 'hsr' : 'rail'];
  const kp = isKP(pa[1], pa[0]) && isKP(pb[1], pb[0]);
  const cost = Math.round(newKm * spec.perKm * (kp ? KP_COST_FACTOR : 1) + kept.length * MID_COST.rail);
  const newMin = (newKm / speed) * 60 + kept.length * P.railDwellMin;
  return { A, B, via, oldKm, oldMin, newKm, newMin, speed, curve, kept, dropped, mids: midList, cost, years: spec.years, ctrl, shape, seaShare, tA, tB };
}

/** 한반도 육지(시군구 경계) 안인지: 직선화 선형이 바다로 나가지 않게 */
export let landIndex = null;
export function onLand(lon, lat) {
  if (!landIndex) {
    landIndex = [];
    for (const f of zonesFC.features) {
      const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [x, y] of poly[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        landIndex.push({ poly, x0, y0, x1, y1 });
      }
    }
  }
  const inRing = (r) => {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const e of landIndex) {
    if (lon < e.x0 || lon > e.x1 || lat < e.y0 || lat > e.y1) continue;
    if (inRing(e.poly[0]) && !e.poly.slice(1).some(inRing)) return true;
  }
  return false;
}

export function distToSegKm(p, a, b) {
  const kx = 111.32 * Math.cos((p[1] * Math.PI) / 180), ky = 110.57;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function drawStraighten() {
  const f = straight.picks.map((n) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  const pl = straight.plan;
  if (pl) {
    f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pl.curve } });
    for (const s of pl.kept) f.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: s.pos } });
    for (const d of pl.dropped || []) f.push({ type: 'Feature', properties: { dropped: true }, geometry: { type: 'Point', coordinates: nodeCoord(d.node) } });
  }
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
}

export function straightenPanel() {
  const s = straight, pl = s.plan, nn = nodeNames();
  const picks = s.picks.map((n) => esc(nn.get(n)?.name || '')).join(' → ');
  if (!pl) {
    return `${header(`${s.line} 구간 직선화`)}
      <p class="hint">노선 위의 두 역을 차례로 누르세요. ${picks ? `고른 역: ${picks}` : ''}<br>
      두 역 사이를 가장 단순한 곡선(직선 또는 한 번 휜 곡선)으로 새로 놓고, 완공되면 옛 구간은 폐선합니다. 사이의 역은 새 선로 위 가장 알맞은 자리로 옮깁니다.</p>
      ${s.picks.length === 2 ? '<p class="hint neg">두 역 사이 경로를 찾지 못했습니다.</p>' : ''}`;
  }
  const merged = pl.kept.flatMap((k) => (k.merged || []).map((m) => `${esc(m.name)} → ${esc(k.name)}`));
  return `${header(`${s.line} 구간 직선화`)}
    <p class="hint">${picks} · ${pl.shape}${pl.shape.startsWith('옛') ? ' (바다·만을 가로지르지 않도록)' : ''}</p>
    ${pl.newKm > pl.oldKm * 0.97 ? '<p class="hint neg">옛 경로가 이미 곧아서 거의 줄어들지 않습니다. 고속화 개량이 나을 수 있습니다.</p>' : ''}
    <table class="kv">
      <tr><td>길이</td><td>${pl.oldKm.toFixed(1)} → <b>${pl.newKm.toFixed(1)}km</b></td></tr>
      <tr><td>최고 속도 (곡선 반경 기준)</td><td>${pl.speed} km/h</td></tr>
      <tr><td>주행 시간 (정차 포함)</td><td>${fmtMin(pl.oldMin)} → <b>${fmtMin(pl.newMin)}</b></td></tr>
      <tr><td>사업비 · 공기</td><td>${formatWon(pl.cost)} · ${pl.years}년</td></tr>
    </table>
    <h4>사이의 역 (${pl.mids.length})</h4>
    <div class="m">${pl.kept.map((k) => `${esc(k.name)} ${k.pin ? '제자리' : `${Math.round(k.moveKm * 1000).toLocaleString()}m 이동`}`).join(' · ') || '사이에 남는 역이 없습니다.'}</div>
    ${pl.dropped.length ? `<div class="m" style="margin-top:4px">폐역: ${pl.dropped.map((d) => esc(d.name)).join(' · ')}</div>` : ''}
    <p class="hint">지도에서 사이의 역을 누르면 그 역을 자동(새 선로 위로)·제자리 유지(옛 자리에서 옛 선로 방향으로 지나감)·폐역 가운데 고를 수 있습니다.</p>
    ${merged.length ? `<div class="m" style="margin-top:4px">합치는 역: ${merged.join(' · ')}</div>` : ''}
    <div class="name-row"><span class="kind">옛 구간</span><select id="st-retire">
      <option value="retire" ${straight.keepOld ? '' : 'selected'}>완공 때 폐선 (옛 역은 새 자리로)</option>
      <option value="keep" ${straight.keepOld ? 'selected' : ''}>그대로 둔다 (연선 역·지선 유지, 보통열차가 다닐 수 있게)</option></select></div>
    <p class="hint">${straight.keepOld
      ? `옛 구간 ${pl.via.length}개와 그 역은 그대로 남고, 새 선로는 따로 놓입니다. 운행 계통은 그대로 옛 선로로 다니니 새 선로로 다닐 계통은 운행 탭에서 고르세요. 사이의 역은 새 선로 위에 새로 짓습니다.`
      : `완공되면 옛 구간 ${pl.via.length}개는 폐선하고, 역 이름과 운행 계통의 정차역은 새 자리로 이어집니다.`}</p>
    ${fundSelect([operatorOf(state, { mode: 1, kp: isKP(nodeCoord(pl.A)[1], nodeCoord(pl.A)[0]) ? 1 : 0 })])}
    <div class="actions">
      <button class="primary" id="st-ok">착공</button><button id="st-prev">효과 미리보기</button><button id="st-cancel">취소</button></div>`;
}

export function bindStraighten(el) {
  bindFund(el, renderSelection);
  el.querySelector('.close')?.addEventListener('click', endStraighten);
  el.querySelector('#st-cancel')?.addEventListener('click', endStraighten);
  el.querySelector('#st-ok')?.addEventListener('click', commitStraighten);
  el.querySelector('#st-retire')?.addEventListener('change', (e) => { straight.keepOld = e.target.value === 'keep'; renderSelection(); });
  el.querySelector('#st-prev')?.addEventListener('click', previewStraighten);
}

/** 직선화 선로의 점: 양 끝 역과 옮긴 역. 양 끝은 바깥 선로 접선으로 들어오고 나간다 */
export function straightPoints(pl) {
  // 역(양 끝·남는 역) 사이에 곡선을 따라 약 1.5km마다 선형 점: 지은 선로가 미리보기 곡선(제자리 역의 접선 포함) 그대로 간다
  const N = pl.curve.length - 1;
  const at = (pos) => { let bk = 0, bd = Infinity; pl.curve.forEach((q, k) => { const d = kmBetween(pos[0], pos[1], q[0], q[1]); if (d < bd) { bd = d; bk = k; } }); return bk; };
  const stops = [{ node: pl.A, k: 0, pos: nodeCoord(pl.A) }, ...pl.kept.map((s) => ({ node: null, k: at(s.pos), pos: s.pos, st: s })), { node: pl.B, k: N, pos: nodeCoord(pl.B) }];
  const pts = [];
  stops.forEach((s, i) => {
    pts.push({ node: s.node, lon: s.pos[0], lat: s.pos[1], station: !!s.st, ref: s.st });
    const nx = stops[i + 1];
    if (!nx) return;
    const km = polylineKm(pl.curve.slice(s.k, nx.k + 1));
    const n = Math.floor(km / 1.5);
    for (let j = 1; j <= n; j++) {
      const k = Math.round(s.k + ((nx.k - s.k) * j) / (n + 1));
      if (k > s.k && k < nx.k) pts.push({ node: null, lon: pl.curve[k][0], lat: pl.curve[k][1], via: true });
    }
  });
  // curve.js의 tan은 경위도 단위 벡터이고 '그 점에서 새 선로가 떠나는 방향'이다: 끝점은 들어오는 방향을 뒤집는다
  const deg = ([e, n], lat, sgn) => { const v = [(sgn * e) / Math.cos((lat * Math.PI) / 180), sgn * n], d = Math.hypot(v[0], v[1]) || 1; return [v[0] / d, v[1] / d]; };
  if (pl.tA) pts[0].tan = deg(pl.tA, pts[0].lat, 1);
  if (pl.tB) pts[pts.length - 1].tan = deg(pl.tB, pts[pts.length - 1].lat, -1);
  return pts;
}

/** 직선화 새 선로에서 역이 될 점(옮긴 역)의 이름 */
export function straightNames(pts) {
  const names = {};
  pts.forEach((q, i) => { if (q.station) names[i] = { name: q.ref.name, kind: 'station', auto: false }; });
  return names;
}

export function commitStraighten() {
  const pl = straight.plan;
  if (!pl) return;
  const pts = straightPoints(pl);
  const r = startNewBuild(base, state, { type: straight.cls === 'hsr' ? 'hsr' : 'rail', points: pts, names: straightNames(pts), lineName: straight.line,
    extendOf: null, extraCost: pl.kept.length * MID_COST.rail });
  if (!r.ok) { alert(r.reason); return; }
  const p = state.projects[state.projects.length - 1];
  // 새 선로 속성: 곡선 반경 속도, 옛 선로의 전철 방식
  const oldL = allLinks()[pl.via[0]];
  for (const id of p.links) {
    const nl = state.newLinks[id - base.links.length];
    nl.speed = pl.speed;
    // 전철 구간을 새로 놓으면 승압까지 마친 교류 전철로 (북측 직류 3kV 노선을 직선화해도 새 선로는 교류)
    if (oldL?.power && oldL.power !== 'none') nl.power = 'AC';
  }
  p.label = `${straight.line} 직선화 ${nodeNames().get(pl.A)?.name}–${nodeNames().get(pl.B)?.name} (${pl.oldKm.toFixed(0)}→${pl.newKm.toFixed(0)}km)`;
  p.straightKm = [pl.oldKm, pl.newKm];   // 고시문: 연장 단축
  // 옛 구간을 그대로 두면(연선 유지) 폐선·역 옮기기·지선 잇기를 하지 않는다: 옛 선로와 역은 그대로, 새 선로는 따로
  if (straight.keepOld) {
    p.keepOld = true;
    state.log[0] = `${state.year}년 착공: ${p.label} (${formatWon(p.cost)}, ${p.years}년) · 옛 구간은 그대로 둡니다`;
    endStraighten();
    save(state); refreshLinks(); refreshPoints(); renderAll();
    startedNotice(p);
    return;
  }
  // 완공 때 폐선할 옛 구간과 역 옮기기 (옛 역 → 새 역, 합친 역은 남는 역으로)
  const newStations = p.stations;
  p.retire = pl.via;
  p.dropStations = (pl.dropped || []).map((d) => d.node);   // 폐역: 완공 때 운행 계통 정차역에서 뺀다
  p.stationMap = {};
  pl.kept.forEach((k, i) => {
    p.stationMap[k.node] = newStations[i];
    for (const m of k.merged || []) p.stationMap[m.node] = newStations[i];
  });
  // 옛 구간 중간 역에서 갈라지던 지선은 새 선로의 가까운 역에 잇는다 (걷어 내면 끊기던 것)
  const L = effectiveNetwork(base, state).links, viaNodes = [];
  let vn = pl.A;
  for (const i of pl.via) { vn = L[i].a === vn ? L[i].b : L[i].a; viaNodes.push(vn); }
  const onNew = new Set(p.links.flatMap((id) => { const l = linkAt(base, state, id); return [l.a, l.b]; }));
  const conns = reconnectBranches(p, L, viaNodes, new Set(p.retire), onNew, 1, newStations.filter((n) => nodeCoord(n)), new Set([straight.line]));
  state.log[0] = `${state.year}년 착공: ${p.label} (${formatWon(p.cost)}, ${p.years}년)${conns.length ? ` · 갈라지던 ${[...new Set(conns)].join('·')}${obj([...new Set(conns)].pop())} 새 선로에 잇는 연결선 포함` : ''}`;
  endStraighten();
  save(state); refreshLinks(); refreshPoints(); renderAll();
  startedNotice(p);
}

/**
 * 새 선로가 대신할 옛 선로를 정해 둔다 (고속화·현대화 계획): 새 선로 양 끝 사이를 옛 노선(lineNames)으로 잇는 경로를
 * 완공 때 폐선하고(retire), 옛 역은 3km 안의 새 역으로 넘기며(stationMap), 그런 역이 없으면 닫는다(dropStations).
 * 새 선로 양 끝이 옛 노선 위가 아니면 양 끝에서 가장 가까운(15km 안) 옛 노선 노드 사이를 걷어 낸다
 */
export function planRetire(p, lineNames) {
  if (!p?.links?.length) return;
  const net = effectiveNetwork(base, state);
  const L = net.links;
  const lines = new Set(lineNames);
  const ls = p.links.map((id) => linkAt(base, state, id));
  const mode = ls[0].mode;   // 철도 현대화·고속화, 고속도로 재건설 (평양–개성)
  const A = ls[0].a, B = ls[ls.length - 1].b;
  const onLine = new Set();
  L.forEach((l) => { if (l.active && l.mode === mode && lines.has(l.name)) { onLine.add(l.a); onLine.add(l.b); } });
  const nearestOld = (n) => {
    if (onLine.has(n)) return n;
    const c = nodeCoord(n);
    let best = null, bd = 15;   // 옛 노선이 새 선로 끝 역 조금 앞에서 끝나기도 한다 (충북선은 봉양까지, 고속화는 제천까지)
    for (const m of onLine) { const q = nodeCoord(m); const d = q ? kmBetween(c[0], c[1], q[0], q[1]) : Infinity; if (d < bd) { bd = d; best = m; } }
    return best;
  };
  // 옛 노선 가운데 새 선로를 따라 4km 안으로 나란히 가는 노드들: 그 가운데 새 선로 양 끝에 가장 가까운 두 노드 사이를 걷어 낸다
  // (끝점만 보면 새 노선 끝이 옛 노선에서 멀 때 못 찾았다: 평라선 현대화는 원산이 평라선 끝 고원에서 40km)
  const pts = [];
  for (const id of p.links) { const g = allLinks()[id]?.geom || []; for (let k = 0; k < g.length; k += 6) if (!Number.isNaN(g[k])) pts.push([g[k], g[k + 1]]); }
  const along = [...onLine].filter((n) => { const c = nodeCoord(n); return c && pts.some((q) => kmBetween(c[0], c[1], q[0], q[1]) < 4); });
  const closest = (to) => { const t = nodeCoord(to); let best = null, bd = Infinity; for (const n of along) { const c = nodeCoord(n); const d = kmBetween(c[0], c[1], t[0], t[1]); if (d < bd) { bd = d; best = n; } } return best; };
  const a = along.length > 1 ? closest(A) : nearestOld(A), b = along.length > 1 ? closest(B) : nearestOld(B);
  if (a == null || b == null || a === b) return;
  const via = railPath(L, a, b, lines, mode);
  if (!via?.length) return;
  const mine = new Set(p.links);
  p.retire = via.filter((i) => !mine.has(i));
  const onNew = new Set(ls.flatMap((l) => [l.a, l.b]));
  const viaNodes = [];
  let node = a;
  for (const i of via) { const l = L[i]; node = l.a === node ? l.b : l.a; viaNodes.push(node); }
  // 옛 경로의 역: 새 선로가 지나는 역(양 끝, 계획 정차역으로 쓴 옛 역)은 그대로, 나머지는 가까운 새 노선 역으로 (없으면 닫는다)
  const stSet = railStationSet();
  const newSt = [...new Set([...(p.stations || []), ...[...onNew].filter((n) => stSet.has(n))])].filter((n) => nodeCoord(n));
  p.stationMap = {};
  p.dropStations = [];
  if (mode >= 1) {
    for (const n of viaNodes) {
      if (n === A || n === B || n === b || onNew.has(n) || !stSet.has(n)) continue;
      const c = nodeCoord(n);
      let best = null, bd = 3;
      for (const m of newSt) { const q = nodeCoord(m); const d = kmBetween(c[0], c[1], q[0], q[1]); if (d < bd) { bd = d; best = m; } }
      if (best != null) p.stationMap[n] = best; else p.dropStations.push(n);
    }
  }
  const conns = reconnectBranches(p, L, viaNodes, new Set(p.retire), onNew, mode, newSt, lines);
  const nn = nodeNames();
  // 양 끝 이름: 역·IC가 아닌 노드면 가장 가까운 이름 있는 곳
  const named = (n) => nn.get(n)?.name || [...nn].filter(([k, v]) => typeof k === 'number' && v.kind !== 'city').reduce((bst, [k, v]) => { const c = nodeCoord(k), q = nodeCoord(n); const d = c && q ? kmBetween(c[0], c[1], q[0], q[1]) : Infinity; return d < bst.d ? { d, name: v.name } : bst; }, { d: 10, name: '' }).name;
  const ends = [named(a), named(b)].filter(Boolean).join('–');
  state.log.unshift(`${state.year}년: ${p.label} 완공 때 옛 ${lineNames.join('·')} ${p.retire.length}개 구간을 ${mode ? '폐선' : '폐도'}합니다${ends ? ` (${ends})` : ''}${conns.length ? `. 옛 ${mode ? '선로' : '도로'}에서 갈라지던 ${[...new Set(conns)].join('·')}${topic([...new Set(conns)].pop())} 새 ${mode ? '노선' : '도로'}에 잇습니다` : ''}`);
}

/**
 * 옛 노선을 걷어 내면 끊기는 지선·분기 노선(옛 경로 중간에서 갈라지던 다른 노선)을 새 노선의 가까운 역(도로는 가까운 점)에 잇는 연결선을 사업에 넣는다.
 * 철도는 그 지선의 규격(선로 수·전력·속도 120km/h까지), 도로는 고속도로끼리만(일반도로는 옛 도로가 걷혀도 남는다) 잇는다. 이은 지선 이름들
 */
export function reconnectBranches(p, L, viaNodes, retired, onNew, mode, newSt, skipNames = new Set()) {
  const out = [];
  const targets = (mode >= 1 && newSt.length ? newSt : [...onNew]).filter((n) => nodeCoord(n));
  const done = new Set();
  for (const n of viaNodes) {
    if (onNew.has(n) || done.has(n)) continue;
    const br = L.map((l, i) => ({ l, i })).filter(({ l, i }) => l.active && l.mode === mode && !retired.has(i) && !skipNames.has(l.name) && (l.a === n || l.b === n)
      && !/ 환승$/.test(l.name || '') && (mode >= 1 || (l.cls === 'motorway' && l.name && !/연결로$/.test(l.name))));   // 도로는 이름 있는 고속도로만 (IC 램프는 빼고)
    if (!br.length) continue;
    const c = nodeCoord(n);
    let best = null, bd = 12;
    for (const t of targets) { const q = nodeCoord(t); const d = kmBetween(c[0], c[1], q[0], q[1]); if (d < bd) { bd = d; best = t; } }
    if (best == null) continue;
    done.add(n);
    const src = linkAt(base, state, br[0].i), q = nodeCoord(best);
    const km = Math.max(0.2, Math.round(bd * 1.1 * 100) / 100);
    const id = base.links.length + state.newLinks.length;
    state.newLinks.push({
      id, a: n, b: best, mode, cls: mode === 0 ? 'motorway' : src.cls, built: false, len: km, kp: isKP(c[1], c[0]) ? 1 : 0,
      name: src.name || `${nn0(n)} 연결선`,
      ...(mode === 0 ? { lanes: Math.max(2, Math.min(4, src.lanes || 4)), speed: 80, paved: 1 }
        : { tracks: Math.max(1, Math.min(2, src.tracks || 1)), power: src.power || 'AC', speed: Math.min(120, src.speed || 100), sstd: 1, std: 1 }),
      geom: [c[0], c[1], q[0], q[1]].map((v) => Math.round(v * 1e5) / 1e5),
    });
    p.links.push(id);
    const spec = NEW_BUILDS[mode === 0 ? 'motorway' : mode === 2 ? 'metro' : 'rail'];
    p.cost += Math.round(km * spec.perKm * (isKP(c[1], c[0]) ? KP_COST_FACTOR : 1));
    p.annual = Math.round(p.cost / p.years);
    out.push(src.name || '연결선');
  }
  return out;
}
export const nn0 = (n) => nodeNames().get(n)?.name || '';
/** 받침에 맞춘 조사: 은/는, 을/를 */
export const hasBatchim = (w) => { const c = (w || '').charCodeAt((w || '').length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 > 0; };
export const topic = (w) => (hasBatchim(w) ? '은' : '는');
export const obj = (w) => (hasBatchim(w) ? '을' : '를');

/** 직선화가 완공되면: 운행 계통의 정차역을 새 역으로 바꾸고 경로를 다시 잡는다 */
export function afterStraighten(done) {
  const projs = done.filter((p) => p.retire);
  if (!projs.length) return;
  const map_ = Object.assign({}, ...projs.map((p) => p.stationMap));
  const drop = new Set(projs.flatMap((p) => p.dropStations || []));
  const retired = new Set(projs.flatMap((p) => p.retire));
  const links = effectiveNetwork(base, state).links;
  for (const s of state.services || []) {
    const touches = s.segs.some((sg) => sg.via.some((i) => retired.has(i))) || s.stops.some((n) => map_[n] != null || drop.has(n));
    if (!touches) continue;
    s.stops = [...new Set(s.stops.filter((n) => !drop.has(n)).map((n) => map_[n] ?? n))];
    const own = new Set(s.lines || [s.line]);
    const newNames = new Set(projs.flatMap((p) => p.links.map((i) => linkAt(base, state, i).name)).filter(Boolean));
    const plan = planService(links, railStationSet(), s.stops, s.kind, own, s.type)
      || planService(links, railStationSet(), s.stops, s.kind, new Set([...own, ...newNames]), s.type);
    if (plan) { s.segs = plan.segs; s.runMin = plan.runMin; s.km = plan.km; s.trains = tripsPerDay(s.sets, plan.runMin); }
  }
}

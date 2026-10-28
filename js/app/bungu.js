// 군→시 승격, 광역시 편입, 분구.
import { formatWon } from '../game/catalog.js';
import { polylineKm, smoothSegments } from '../game/curve.js';
import {
  adminNames, CITY_UP_MIN_POP, EVENT_COST, governorTitle, hasAutonomy, HISTORIC_CITIES, isMetroCity, metroName, promotedName, REGION_RENAMED, regionBase, regionOf,
  unitId,
} from '../game/local.js';
import { applyMega, kpACCost, kpDCLines, MEGA, megaGeometry, TSR_FREIGHT } from '../game/mega.js';
import { canAfford, renameKPLines, save, startMega } from '../game/state.js';
import { t } from '../i18n.js';
import { fetchEdges, refreshNames, unitFeaturesIn } from '../ui/map.js';
import { toast } from '../ui/panel.js';
import { base, esc, grid, map, median, result, selection, state, subPop0, subsFC, zoneProps } from './core.js';
import { officeName, zoneName } from './year.js';
import { bunguLabels, drawAdmin, nodeNames, paintZones, provincePops, pushExtraLabels, refreshLinks, setBunguLabels, subInfo, subMetric } from './mapdata.js';
import { admin, adminInvalidate, countyNameOf, kpMyeon, mergeSplitUnit, myeonDongDialog, setSubUnit, startUnitPick, subKey, subName, subNeighbors, subRegion, unitName } from './region.js';
import { select } from './interact.js';
import { fmtPop, pct, renderAll } from './panels.js';
import { renderRequests } from './budget.js';
import { renderSelection } from './econ.js';
import { bunguElectionNotice, countyRep, countyZones, guKey, holdElection, mayorKey, mayorTitleOf, officeLine, regions, supportHTML, syncAppointed, syncMayors, zoneAdminHTML, zoneGus, zonePop } from './election.js';
import { adminSetup, drawGuMetric, setAdmin } from './firstyear.js';
import { inRing } from './housing.js';
import { runPreview } from './preview.js';
import { header } from './svcmap.js';
import { bindGuSplit, metroRename } from './selpanel.js';

// ---- 군 → 시 승격, 광역시 편입

/** 시군 단위(옛 군 땅 조각을 합친) 목록: 열쇠 → { name(보이는 이름), z(대표 존), zones, pop, region } */
export function counties() {
  const out = new Map();
  zoneProps.forEach((z, i) => {
    if (z.ext || z.city) return;   // 구(區)는 시에 딸려 있다
    const k = unitId(state, z);
    const e = out.get(k) || { key: k, name: zoneName(i), z, zones: [], pop: 0, region: regionOf(state, z) };
    e.zones.push(i); e.pop += zonePop(i);
    out.set(k, e);
  });
  return out;
}

/** 승격할 수 있는 군: 인구 15만 이상, 광역시에 딸리지 않은 군 (북측은 지방자치 뒤) */
export function cityUpTargets() {
  const L = state.local;
  return [...counties().values()].filter((c) => /군$/.test(c.z.name) && !L.cityUp?.includes(c.key) && !isMetroCity(c.region)
    && (c.z.country === 'KR' || L.autonomyKP) && c.pop >= CITY_UP_MIN_POP).sort((a, b) => b.pop - a.pop);
}

export let zoneAdj = null;   // 존 → 맞닿은 존들 (시군 경계 자료에서)
export function adjacency() {
  if (zoneAdj) return zoneAdj;
  zoneAdj = new Map();
  fetchEdges().then((edges) => {
    for (const f of edges) {
      const { a, b, w } = f.properties;
      if (w || a < 0 || b < 0 || a === b) continue;   // 물 위 경계(제주–전남, 거제–부산 등)로는 잇지 않는다
      for (const [x, y] of [[a, b], [b, a]]) { if (!zoneAdj.has(x)) zoneAdj.set(x, new Set()); zoneAdj.get(x).add(y); }
    }
    zoneAdj.ready = true;
    renderRequests();
    if (selection?.type === 'zone') renderSelection();
  });
  return zoneAdj;
}

/**
 * 편입 대상: 광역시(특별시·광역시)는 맞닿은 다른 광역 단체의 시·군을, 도는 맞닿은 군을 (평양시 강동군 → 평안남도, 철원군 → 강원북도).
 * [[광역 단체, [시군…]]]. 물 위 경계로는 잇지 않는다
 */
export function annexTargets() {
  const adj = adjacency();
  if (!adj.ready) return null;
  const L = state.local, cs = counties();
  const byZone = new Map();
  for (const c of cs.values()) for (const i of c.zones) byZone.set(i, c);
  const regionAt = (i) => byZone.get(i)?.region ?? (zoneProps[i]?.ext ? null : regionOf(state, zoneProps[i]));
  const out = new Map();
  zoneProps.forEach((z, i) => {
    const r = regionAt(i);
    // 세종도, 북측 지방자치 전의 북측 도·시군도 옮길 수 있다 (지방자치 전 북측으로 옮긴 시군의 단체장은 관선이 된다)
    if (!r) return;
    const metro = isMetroCity(r);
    for (const j of adj.get(i) || []) {
      const d = byZone.get(j);
      if (!d || d.region === r || L.independent.includes(d.name)) continue;
      // 광역시는 군·구만 받는다 (도의 군, 다른 광역시의 군·구 통째): 시는 광역시 밑에 둘 수 없다. 도는 군만 (다른 도·광역시의 군)
      if (metro ? !/[군구]$/.test(d.name) : !/군$/.test(d.name)) continue;
      if (!out.has(r)) out.set(r, new Map());
      out.get(r).set(d.key, { ...d, via: i });
    }
  });
  return [...out].map(([r, m]) => [r, [...m.values()].sort((a, b) => b.pop - a.pop)])
    .sort((a, b) => (isMetroCity(b[0]) - isMetroCity(a[0])) || a[0].localeCompare(b[0], 'ko'));
}

/** 편입할 때 적어 둘 대상 단체의 바탕: 맞닿은 그 단체 존의 바탕, 승격한 도시면 그 도시 이름 */
export function annexBase(to, zi) {
  const b = regionBase(state, zoneProps[zi]);
  const c = state.local.independent.find((x) => metroName(x) === to);
  return { prov: c || b.prov, side: b.side };
}

/** 편입한 시군(열쇠)이 지금 속한 광역 단체 */
export function annexRegion(k) {
  const i = zoneProps.findIndex((z) => !z.ext && unitId(state, z) === k);
  return i >= 0 ? regionOf(state, zoneProps[i]) : '';
}

/**
 * 광역단체장 정리: 지금 없는 단체(도 복원으로 이름이 바뀐 강원도 등)의 단체장은 없애고, 직함은 지금 이름으로.
 * 단체장이 없어진 단체는 새로 뽑는다 (예전 저장에서 강원북도·강원남도 단체장이 '강원도지사'로 남던 것)
 */
export function syncGovernors() {
  const L = state.local, now = regions();
  if (!Object.keys(L.offices || {}).some((k) => k.startsWith('g:'))) return;
  const had = new Set();
  for (const k of Object.keys(L.offices)) {
    if (!k.startsWith('g:') || L.offices[k].appointed) continue;
    const r = k.slice(2);
    if (!now.has(r)) {
      // 이름만 바뀐 단체(북측 강원도 → 강원북도)는 단체장을 그대로 옮긴다
      const nr = REGION_RENAMED[r];
      if (nr && now.has(nr) && !L.offices[`g:${nr}`]) { L.offices[`g:${nr}`] = { ...L.offices[k], region: nr, title: governorTitle(nr) }; had.add(nr); }
      delete L.offices[k]; continue;
    }
    had.add(r);
    L.offices[k].title = governorTitle(r);
  }
  // 남측(처음부터 지방자치)과, 북측 지방자치를 시행 중이면 북측 단체도
  const missing = [...now.keys()].filter((r) => !had.has(r) && now.get(r).some((i) => hasAutonomy(state, zoneProps[i])));
  if (missing.length) holdElection(missing, '광역단체장 선거 (행정구역 정리)');
  syncAppointed();
}

// ---- 분구: 광역시로 승격한 시(한 존), 또는 광역시에 편입한 시를 읍면동 묶음으로 여러 구로 나눈다
// state.local.bungu[단위] = { n, gu: {읍면동 열쇠: 구} }. 단위는 승격한 도시 이름(해주시) 또는 편입한 시의 열쇠(황해남도|벽성시).
// 행정 구역 표시만 바뀐다 (계산은 존 하나 그대로). 승격한 도시: 가운데 중구, 나머지 동·서·남·북구.
// 편입한 시: 광역시의 중구·동구와 겹치지 않게 시 이름을 붙인다 (가운데 벽성구, 나머지 벽성동구·벽성서구…)

export const BUNGU_MAX = 5;

/** 승격한 도시의 몸통 존들 (구로 나뉘지 않은 존: 이름이 그 도시) */
export function cityCoreZones(city) {
  return zoneProps.map((z, i) => i).filter((i) => !zoneProps[i].ext && !zoneProps[i].city && promotedName(state, zoneProps[i]) === city);
}

/** 분구 단위의 존들 */
export function unitZones(unit) {
  if (unit.startsWith('split:')) return [...(admin()?.unit(unit)?.zones || [])];   // 새로 세운 시군: 그 읍면동이 든 존들
  return unit.includes('|') ? zoneProps.map((z, i) => i).filter((i) => !zoneProps[i].ext && !zoneProps[i].city && unitId(state, zoneProps[i]) === unit) : cityCoreZones(unit);
}

/** 편입한 시면 이름 앞머리 (벽성시 → 벽성), 승격한 도시면 '' */
export const unitPrefix = (unit) => (unit.includes('|') ? unit.split('|')[1].replace(/(시|군|구역|구)$/, '') : '');

/**
 * opts.general: 일반구 (광역시가 아닌 시의 구: 수원시 장안구처럼 구청장을 뽑지 않고 시장이 임명한다). 이름은 중구·동구…
 */
export function makeBungu(unit, n, opts = {}) {
  const general = !!opts.general;
  const zs = unitZones(unit), pre = general ? '' : unitPrefix(unit);
  // 새로 세운 시군은 그 시군의 읍면동만 (존에는 원래 시군 읍면동도 섞여 있다)
  const members = unit.startsWith('split:') ? new Set(admin()?.unit(unit)?.subs || []) : null;
  const subs = zs.flatMap((z) => zoneProps[z].subs.map((s, k) => ({ i: zoneProps[z].sub0 + k, x: s[0], y: s[1], w: Math.max(1, result ? result.subs.pop[zoneProps[z].sub0 + k] : s[2] * zoneProps[z].pop) })))
    .filter((s) => (!members || members.has(s.i)) && (!opts.only || opts.only.has(s.i)));
  if (subs.length < n || n < 2) return false;
  const W = subs.reduce((t, s) => t + s.w, 0);
  const cx = subs.reduce((t, s) => t + s.x * s.w, 0) / W, cy = subs.reduce((t, s) => t + s.y * s.w, 0) / W;
  const kx = Math.cos((cy * Math.PI) / 180);
  const d2 = (a, b) => ((a.x - b.x) * kx) ** 2 + (a.y - b.y) ** 2;
  // 시작 중심: 도심(인구 가중 중심에 가장 가까운 읍면동) + 서로 먼 읍면동들
  const cen = [subs.reduce((b, s) => (d2(s, { x: cx, y: cy }) < d2(b, { x: cx, y: cy }) ? s : b))];
  while (cen.length < n) cen.push(subs.reduce((b, s) => (Math.min(...cen.map((c) => d2(s, c))) > Math.min(...cen.map((c) => d2(b, c))) ? s : b)));
  let c = cen.map((s) => ({ x: s.x, y: s.y })), lab = [];
  // 구마다 읍면동 수를 고르게: 가까운 짝부터 채우되 한 구에 ceil(읍면동 수 / 구 수)곳까지 (예전에는 가까운 구로만 나눠 한 구에 몰렸다)
  const cap = Math.ceil(subs.length / n);
  const assign = () => {
    const pairs = [];
    subs.forEach((s, j) => c.forEach((q, k) => pairs.push([d2(s, q), j, k])));
    pairs.sort((a, b) => a[0] - b[0]);
    const out = new Array(subs.length).fill(-1), cnt = new Array(n).fill(0);
    for (const [, j, k] of pairs) if (out[j] < 0 && cnt[k] < cap) { out[j] = k; cnt[k]++; }
    return out;
  };
  const centers = () => c.map((q, k) => {
    const m = subs.filter((_, j) => lab[j] === k);
    if (!m.length) return q;
    const w = m.reduce((t, s) => t + s.w, 0);
    return { x: m.reduce((t, s) => t + s.x * s.w, 0) / w, y: m.reduce((t, s) => t + s.y * s.w, 0) / w };
  });
  for (let it = 0; it < 20; it++) { lab = assign(); c = centers(); }
  // 거리로만 나누면 한 구가 이웃 구 너머에 조각(월경지)을 갖는다: 그 중심들에서 출발해 맞닿은 읍면동을 따라 키운다
  // (가장 작은 구부터 한 곳씩, 그 구에 맞닿은 빈 읍면동 가운데 중심에 가장 가까운 것)
  if (subsFC) {
    const adj = subAdjacency(subs.map((s) => s.i)), pos = new Map(subs.map((s, j) => [s.i, j]));
    const out = new Array(subs.length).fill(-1), cnt = new Array(n).fill(0);
    c.forEach((q, k) => {
      let bj = -1;
      subs.forEach((s, j) => { if (out[j] < 0 && (bj < 0 || d2(s, q) < d2(subs[bj], q))) bj = j; });
      out[bj] = k; cnt[k]++;
    });
    for (let left = subs.length - n; left > 0;) {
      let got = false;
      for (const k of [...Array(n).keys()].sort((a, b) => cnt[a] - cnt[b])) {
        let bj = -1;
        subs.forEach((s, j) => {
          if (out[j] !== k) return;
          for (const nb of adj.get(s.i)) { const t = pos.get(nb); if (t != null && out[t] < 0 && (bj < 0 || d2(subs[t], c[k]) < d2(subs[bj], c[k]))) bj = t; }
        });
        if (bj >= 0) { out[bj] = k; cnt[k]++; left--; got = true; break; }
      }
      if (!got) {   // 어느 구와도 맞닿지 않은 읍면동(섬 등): 가장 가까운 중심의 구로
        subs.forEach((s, j) => { if (out[j] < 0) { out[j] = c.reduce((b, q, kk) => (d2(s, q) < d2(s, c[b]) ? kk : b), 0); cnt[out[j]]++; left--; } });
      }
    }
    lab = out;
    c = centers();
  }
  // 이름: 도심에 가장 가까운 묶음은 중구 (둘로 나눌 때는 둘 다 방향으로), 나머지는 도심에서 본 방향
  const core = n >= 3 || pre ? c.reduce((bk, q, k) => (d2(q, { x: cx, y: cy }) < d2(c[bk], { x: cx, y: cy }) ? k : bk), 0) : -1;
  const names = [];
  const order = c.map((q, k) => k).filter((k) => k !== core);
  const dn = dirNames(order.map((k) => (Math.atan2(c[k].y - cy, (c[k].x - cx) * kx) * 180) / Math.PI));
  order.forEach((k, j) => { names[k] = dn[j] || `제${k + 1}구`; });
  if (core >= 0) names[core] = '중구';
  // 편입한 시: 벽성구(가운데)·벽성동구…
  const shown = names.map((nm) => (pre ? (nm === '중구' ? `${pre}구` : `${pre}${nm}`) : nm));
  // 방향 이름(중구·동구·서구…)보다 그 구의 주요 동 이름을 먼저 붙인다: 구에서 인구가 가장 많은 동 이름 줄기(해운대1동 → 해운대구,
  // 정관읍 → 정관구). 같은 광역 단체에 이미 있는 이름, 한 글자 줄기는 건너뛰고, 마땅한 게 없을 때만 방향 이름. 편입한 시의 가운데 구는 시 이름 그대로
  if (subsFC) {
    const region = unit.startsWith('split:') ? state.local.splitUnit[unit].region : regionOf(state, zoneProps[zs[0]]);
    const taken = new Set();
    zoneProps.forEach((q, j) => { if (!q.ext && regionOf(state, q) === region && !zs.includes(j)) { taken.add(zoneName(j)); for (const g of guNamesOfZone(j) || []) taken.add(g); } });
    // 시 이름과 같은 구는 두지 않는다 (신천시 신천구·해주광역시 해주구처럼): 일반구는 그 시, 자치구는 그 광역시 이름 줄기를 뺀다
    // 구 하나를 나눌 때는 같은 시의 다른 구 이름도 피한다
    if (opts.splitGu) for (const g of Object.values(state.local.bungu?.[unit]?.gu || {})) if (g !== opts.splitGu) taken.add(g);
    const used = new Set([...(pre ? [pre] : []), (general ? zoneName(zs[0]) : region).replace(/(특별자치시|특별시|광역시|직할시|시|군)$/, '')]);
    const order = c.map((_, k) => k).sort((a, b2) => subs.reduce((t, s, j) => t + (lab[j] === b2 ? s.w : 0), 0) - subs.reduce((t, s, j) => t + (lab[j] === a ? s.w : 0), 0));
    for (const k of order) {
      if (pre && k === core) continue;
      const stems = new Map();
      subs.forEach((s, j) => {
        if (lab[j] !== k) return;
        const st = dongStem(subName(s.i));
        if (st.length >= 2) stems.set(st, (stems.get(st) || 0) + s.w);
      });
      const pick = [...stems].sort((a, b2) => b2[1] - a[1]).map(([st]) => st).find((st) => !used.has(st) && !taken.has(`${st}구`) && !shown.includes(`${st}구`));
      if (pick) { used.add(pick); shown[k] = `${pick}구`; }
    }
  }
  if (opts.splitGu) {
    // 구 하나를 여럿으로: 인구가 가장 많은 쪽이 원래 이름을 잇는다
    const wOf = (k) => subs.reduce((t, s, j) => t + (lab[j] === k ? s.w : 0), 0);
    const big = c.map((_, k) => k).sort((a, b2) => wOf(b2) - wOf(a))[0];
    shown[big] = opts.splitGu;
    const b = state.local.bungu[unit];
    subs.forEach((s, j) => { b.gu[subKey(s.i)] = shown[lab[j]]; });
    b.n = new Set(Object.values(b.gu)).size;
    guUnits.clear();
    state.log.unshift(`${state.year}년 ${opts.splitGu} 분구: ${[...new Set(shown)].join('·')}`);
    return true;
  }
  const gu = {};
  subs.forEach((s, j) => { gu[subKey(s.i)] = shown[lab[j]]; });
  (state.local.bungu ||= {})[unit] = { n, gu, core: core >= 0 ? shown[core] : null, dirV: 2, ...(general ? { general: true } : {}) };
  guUnits.clear();   // 자세한 경계의 구 배정을 다시 한다
  const where = general ? `${zoneName(zs[0])} 일반구` : pre ? `${annexRegion(unit)} ${pre}구` : metroName(unit);
  state.log.unshift(`${state.year}년 ${where} 분구: ${[...new Set(shown)].join('·')}`);
  return true;
}

/**
 * 묶음들의 방향(도: 동쪽 0, 북쪽 90)에 동·북·서·남구를 겹치지 않게 붙인다: 각도 차이 합이 가장 작은 짝 (묶음은 넷까지).
 * (예전에는 가까운 방향을 고른다면서 정렬한 목록의 맨 끝, 곧 가장 먼 방향을 골라 서쪽 묶음이 동구가 됐다)
 */
export function dirNames(angles) {
  const dirs = [['동구', 0], ['북구', 90], ['서구', 180], ['남구', 270]];
  const dist = (a, b) => { const d = (((a - b) % 360) + 360) % 360; return Math.min(d, 360 - d); };
  let best = null, bestCost = Infinity;
  const perm = (left, picked) => {
    if (picked.length === Math.min(angles.length, dirs.length)) {
      const cost = picked.reduce((t, d, k) => t + dist(angles[k], dirs[d][1]), 0);
      if (cost < bestCost) { bestCost = cost; best = picked.slice(); }
      return;
    }
    for (const d of left) perm(left.filter((x) => x !== d), [...picked, d]);
  };
  perm([0, 1, 2, 3], []);
  return (best || []).map((d) => dirs[d][0]);
}

/**
 * 예전 저장의 분구 이름을 바로잡는다 (방향이 거꾸로 붙던 것): 구마다 인구 중심의 방향으로 다시 붙이고, 구청장 자리도 새 이름으로 옮긴다.
 * 고친 단위에는 dirV를 남겨 한 번만 한다. 바뀐 것이 있으면 true
 */
export function fixBunguNames() {
  const L = state.local;
  let changed = false;
  for (const [unit, b] of Object.entries(L?.bungu || {})) {
    if (b.dirV >= 2) continue;
    b.dirV = 2;
    const zs = unitZones(unit);
    if (!zs.length) continue;
    const pre = b.general ? '' : unitPrefix(unit);
    const cen = new Map();
    let X = 0, Y = 0, Wt = 0;
    for (const z of zs) zoneProps[z].subs.forEach((sp, k) => {
      const i = zoneProps[z].sub0 + k, g = b.gu[subKey(i)];
      if (!g) return;
      const w = Math.max(1, result ? result.subs.pop[i] : sp[2] * zoneProps[z].pop);
      const e = cen.get(g) || { x: 0, y: 0, w: 0 };
      e.x += sp[0] * w; e.y += sp[1] * w; e.w += w; cen.set(g, e);
      X += sp[0] * w; Y += sp[1] * w; Wt += w;
    });
    if (!Wt) continue;
    const cx = X / Wt, cy = Y / Wt, kx = Math.cos((cy * Math.PI) / 180);
    const core = b.core || (cen.has('중구') ? '중구' : cen.has(`${pre}구`) ? `${pre}구` : null);
    const others = [...cen.keys()].filter((g) => g !== core);
    const dn = dirNames(others.map((g) => { const e = cen.get(g); return (Math.atan2(e.y / e.w - cy, (e.x / e.w - cx) * kx) * 180) / Math.PI; }));
    const rename = new Map();
    others.forEach((g, j) => { const nw = dn[j] ? `${pre}${dn[j]}` : g; if (nw !== g) rename.set(g, nw); });
    if (!rename.size) continue;
    for (const k of Object.keys(b.gu)) if (rename.has(b.gu[k])) b.gu[k] = rename.get(b.gu[k]);
    // 구청장 자리: m:존#옛이름 → m:존#새이름 (서로 맞바뀌는 경우가 있어 한꺼번에 옮긴다)
    const moved = [];
    for (const r of new Set(zs.map((z) => countyRep(z)))) {
      for (const [old, nw] of rename) {
        const k = `m:${r}#${old}`;
        if (L.offices[k]) { moved.push([`m:${r}#${nw}`, { ...L.offices[k], gu: nw, title: `${nw}청장` }]); delete L.offices[k]; }
      }
    }
    for (const [k, off] of moved) L.offices[k] = off;
    changed = true;
  }
  if (changed) { guUnits.clear(); state.log.unshift(`${state.year}년 분구한 구의 이름을 방향에 맞게 바로잡았습니다.`); }
  return changed;
}

/** 이 시군(존)을 나눈 분구 단위 열쇠 (없으면 null) */
export function bunguUnitOf(z) {
  const zs = new Set(countyZones(z));
  return Object.keys(state.local?.bungu || {}).find((u) => !u.startsWith('split:') && unitZones(u).some((j) => zs.has(j))) || null;
}

/** 사용자가 쓴 구 이름: 빈칸을 빼고, 끝에 '구'가 없으면 붙인다 */
export const normGu = (v) => { const n = String(v).replace(/\s+/g, ''); return n && !/구$/.test(n) ? `${n}구` : n; };

/**
 * 분구한 단위의 구 이름을 한꺼번에 바꾼다 (names: 옛 이름 → 새 이름, 서로 맞바꿔도 된다).
 * 구 배정·가운데 구·구청장 자리를 함께 옮긴다. 끝에 '구'가 없으면 붙인다. 안 되면 이유 문자열, 되면 null
 */
export function renameGus(unit, names) {
  const L = state.local, b = L.bungu?.[unit];
  if (!b) return '분구하지 않은 곳입니다.';
  const cur = [...new Set(Object.values(b.gu))];
  const fin = cur.map((g) => normGu(names.get(g) ?? g));
  if (fin.some((n) => n.length < 2)) return '구 이름이 비어 있습니다.';
  if (new Set(fin).size !== fin.length) return '구 이름이 겹칩니다.';
  const ren = new Map(cur.map((g, k) => [g, fin[k]]).filter(([a, c]) => a !== c));
  if (!ren.size) return null;
  const reps = [...new Set(unitZones(unit).map((z) => countyRep(z)))];
  // 가운데 구(시군 단체장 자리를 잇는 구)는 이름 순서가 바뀌어도 그대로 (둘로 나눈 곳은 이름 순 첫 구였다)
  if (!b.general && !b.core) b.core = zoneGus(reps[0])?.[0] || null;
  for (const k of Object.keys(b.gu)) if (ren.has(b.gu[k])) b.gu[k] = ren.get(b.gu[k]);
  if (ren.has(b.core)) b.core = ren.get(b.core);
  const moved = [];
  for (const r of reps) for (const [a, c] of ren) {
    const k = `m:${r}#${a}`;
    if (L.offices[k]) { moved.push([`m:${r}#${c}`, { ...L.offices[k], gu: c, title: `${c}청장` }]); delete L.offices[k]; }
  }
  for (const [k, o] of moved) L.offices[k] = o;
  for (const r of reps) if (L.offices[`m:${r}`] && zoneGus(r)) L.offices[`m:${r}`].title = mayorTitleOf(r);
  guUnits.clear();
  state.log.unshift(`${state.year}년 구 이름 변경: ${[...ren].map(([a, c]) => `${a} → ${c}`).join(', ')}`);
  return null;
}

/**
 * 분구 미리보기·조정 창: 분구하면 지도 곁에 떠서, 지도에 구마다 옅은 색을 칠하고 동을 눌러 구를 바꾸게 한다(맞닿은 구로만).
 * 구마다 이름·동 수·인구를 보이고, 구 수를 바꿔 다시 나누거나 이름을 고친 뒤 확정한다 (확정하면 색을 지운다)
 */
export function guNamingDialog(unit, opts = {}) {
  if (!state.local.bungu?.[unit]) return;
  document.querySelector('.gu-float')?.remove();
  const rep = countyRep(unitZones(unit)[0]);
  const el = document.createElement('div');
  el.className = 'gu-float';
  document.body.appendChild(el);
  guPreview = unit;
  const where = () => (state.local.bungu[unit]?.general ? officeName(rep) : regionOf(state, zoneProps[rep]));
  const draw = () => {
    const b = state.local.bungu[unit];
    if (!b) { close(); return; }
    const col = guColorMap(unit), gs = [...col.keys()];
    const typed = new Map([...el.querySelectorAll('[data-gu-old]')].map((x) => [x.dataset.guOld, x.value]));
    el.innerHTML = `<h3>분구 미리보기 · ${esc(where())}</h3>
      <p class="hint">지도에 구마다 색을 칠했습니다. 동을 누르면 그 동이 속할 구를 고를 수 있습니다(맞닿은 구로만, 월경지가 생기지 않게). 이름을 고치고 확정하세요.</p>
      <div class="list">${gs.map((g) => {
        const ss = guSubs(rep, g), pop = result ? ss.reduce((t, i) => t + result.subs.pop[i], 0) : 0;
        const ns = [...ss].sort((x, y) => (result ? result.subs.pop[y] - result.subs.pop[x] : 0)).map((i) => subName(i)).filter(Boolean);
        return `<div class="item"><div class="name-row"><span class="gu-swatch" style="background:${col.get(g)}"></span><input type="text" data-gu-old="${esc(g)}" value="${esc(typed.get(g) ?? g)}" style="flex:1"></div>
          <div class="m">${g === gs[0] && !b.general && gs.length > 2 ? '가운데 구 · ' : ''}동 ${ss.length}곳 · ${fmtPop(pop)} · ${esc(ns.slice(0, 5).join(', '))}${ns.length > 5 ? ' …' : ''}</div></div>`;
      }).join('')}</div>
      ${opts.noResplit ? '' : `<div class="row" style="display:flex;gap:6px;align-items:center;margin-top:6px"><span class="m">구 수</span>
        <select id="gu-float-n" class="small">${[2, 3, 4, 5].map((n) => `<option value="${n}" ${n === gs.length ? 'selected' : ''}>${n}개</option>`).join('')}</select>
        <button class="small" data-gu-act="resplit">다시 나누기</button></div>`}
      <div class="setup-btns" style="margin-top:8px"><span class="m neg" data-gu-err></span><span style="flex:1"></span><button class="small primary" data-gu-act="ok">확정</button></div>`;
  };
  const close = () => {
    el.remove();
    guPreview = null; guPreviewDraw = null;
    endGuEdit();
    drawBungu();
  };
  guPreviewDraw = draw;
  draw();
  drawBungu();
  startGuEdit(rep, unit);
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-gu-act]')?.dataset.guAct;
    if (a === 'resplit') {
      const b = state.local.bungu[unit], n = +el.querySelector('#gu-float-n').value;
      if (!makeBungu(unit, n, { general: !!b?.general })) { el.querySelector('[data-gu-err]').textContent = '이 시군은 그만큼 나눌 수 없습니다.'; return; }
      el.querySelectorAll('[data-gu-old]').forEach((x) => x.remove());   // 새 구는 새 이름으로
      syncMayors(); save(state); drawBungu(); draw(); renderAll();
      if (!guEdit) startGuEdit(rep, unit);
    } else if (a === 'ok') {
      const names = new Map([...el.querySelectorAll('[data-gu-old]')].map((x) => [x.dataset.guOld, x.value]));
      const err = renameGus(unit, names);
      if (err) { el.querySelector('[data-gu-err]').textContent = err; return; }
      close();
      syncMayors(); refreshNames(map); save(state); renderAll();
      bunguElectionNotice(unit);
    }
  });
}

/**
 * 북측 읍면동을 실제 리·동 단위로 다시 나눈 자료(Alpha 0.4)로 옮긴 저장: 읍면동 열쇠(분구한 구 배정, 읍면동 편입)를
 * 옛 읍면동 자리(data/migrate/kp-subs-*.json)에서 가장 가까운 새 리·동으로 옮긴다. 새 자료에 그대로 있는 열쇠(남측)는 그대로
 */
export const KP_SUBS_REF = '20261026193426';   // 북측 리·동 자료 바로 앞 판
export async function migrateSubKeys(st, oldStamp) {
  if (!(oldStamp <= KP_SUBS_REF)) return;
  // 읍면동 단위 옛 이름 되찾기(김형권읍 → 풍산읍)는 읍면동 번호가 바뀌었다. 행정구역 정리 이름은 새 대상표로 다시 만든다 (김정숙읍·김형직읍도 생김)
  const U = { 'u:3808': 'u:4355' };
  const reU = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [U[k] || k, v]));
  st.placeNames = reU(st.placeNames);
  adminInvalidate();
  for (const p of st.projects || []) if (p.kind === 'rename' && U[p.key]) p.key = U[p.key];
  if (st.local?.admin) {
    const hist = await fetch('data/historic_targets.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (hist) st.adminNames = adminNames(st.local.admin, zoneProps, hist);
    adminInvalidate();
  }
  const L = st.local;
  const keys = [...Object.values(L?.bungu || {}).flatMap((b) => Object.keys(b.gu || {})), ...Object.keys(L?.annexSub || {})];
  if (!keys.length) return;
  const old = await fetch(`data/migrate/kp-subs-${KP_SUBS_REF}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const fc = await fetch('data/subzones.geojson').then((r) => r.json()).catch(() => null);
  if (!old || !fc) return;
  const now = new Map();   // 새 열쇠 → [x, y]
  zoneProps.forEach((z) => z.subs.forEach((sp, k) => now.set(`${z.province}|${z.name}|${fc.features[z.sub0 + k]?.properties.name ?? z.sub0 + k}`, [sp[0], sp[1]])));
  const zoneOf = (k) => k.split('|').slice(0, 2).join('|');
  const d2 = (a, b) => ((a[0] - b[0]) * 0.8) ** 2 + (a[1] - b[1]) ** 2;
  const nearestNew = (k) => {
    const c = old[k];
    if (!c) return null;
    let best = null, bd = Infinity;
    for (const [nk, q] of now) if (zoneOf(nk) === zoneOf(k) && d2(c, q) < bd) { bd = d2(c, q); best = nk; }
    return best;
  };
  if (L.annexSub) L.annexSub = Object.fromEntries(Object.entries(L.annexSub).map(([k, v]) => [now.has(k) ? k : nearestNew(k), v]).filter(([k]) => k));
  for (const b of Object.values(L.bungu || {})) {
    const stale = Object.keys(b.gu).filter((k) => !now.has(k) && old[k]);
    if (!stale.length) continue;
    // 그 시군의 새 리·동마다 가장 가까운 옛 읍면동의 구를 준다
    const pts = Object.entries(b.gu).map(([k, g]) => [now.get(k) || old[k], g]).filter(([c]) => c);
    const zonesHere = new Set(Object.keys(b.gu).map(zoneOf));
    const gu = {};
    for (const [nk, q] of now) {
      if (!zonesHere.has(zoneOf(nk))) continue;
      let best = null, bd = Infinity;
      for (const [c, g] of pts) if (d2(c, q) < bd) { bd = d2(c, q); best = g; }
      if (best) gu[nk] = best;
    }
    b.gu = gu;
  }
  guUnits.clear();
}

/** 분구할 수 있는 단위: 승격한 도시, 광역시에 편입한 시 (아직 나누지 않았고 읍면동이 둘 넘는 곳) → [[단위, 보이는 이름]] */
export function bunguUnits() {
  const L = state.local;
  const out = L.independent.filter((c) => !L.bungu?.[c] && cityCoreZones(c).some((z) => zoneProps[z].subs.length >= 2)).map((c) => [c, metroName(c)]);
  for (const k of Object.keys(L.annex || {})) {
    const to = annexRegion(k);
    if (L.bungu?.[k] || !isMetroCity(to) || !(/시$/.test(k.split('|')[1]) || L.cityUp?.includes(k))) continue;
    if (unitZones(k).reduce((t, z) => t + zoneProps[z].subs.length, 0) >= 2) out.push([k, `${to} ${unitPrefix(k)}구`]);
  }
  // 특별시·광역시의 자치구(구·구역) 하나를 여럿으로 (강남구 → 강남구·수서구). 한 구는 원래 이름을 잇는다
  for (const [k, c] of counties()) {
    if (L.bungu?.[k] || !isMetroCity(c.region) || !/(구|구역)$/.test(c.z.name) || c.z.name === c.z.province || L.annex?.[k] || L.gunToGu?.includes(k)) continue;
    if (!hasAutonomy(state, c.z)) continue;
    if (unitZones(k).reduce((t, z) => t + zoneProps[z].subs.length, 0) >= 2) out.push([k, `${c.region} ${c.name}`]);
  }
  // 광역시 산하 군을 구로 바꾼 곳
  for (const k of L.gunToGu || []) {
    if (L.bungu?.[k]) continue;
    if (unitZones(k).reduce((t, z) => t + zoneProps[z].subs.length, 0) >= 2) out.push([k, `${annexRegion(k)} ${unitPrefix(k)}구`]);
  }
  // 도 밑의 시 (승격한 시가 아니어도): 일반구로. 도 밑의 군은 구를 둘 수 없다
  for (const [k, c] of counties()) {
    if (L.bungu?.[k] || L.annex?.[k] || isMetroCity(c.region) || !/시$/.test(c.name) || L.cityUp?.includes(k) || !hasAutonomy(state, c.z)) continue;
    if (unitZones(k).reduce((t, z) => t + zoneProps[z].subs.length, 0) >= 2) out.push([k, `${c.name} (일반구)`]);
  }
  // 군에서 승격한 시 (광역시가 아닌 곳): 일반구
  for (const k of L.cityUp || []) {
    if (L.bungu?.[k] || L.annex?.[k] || isMetroCity(annexRegion(k))) continue;
    if (unitZones(k).reduce((t, z) => t + zoneProps[z].subs.length, 0) >= 2) out.push([k, `${k.split('|')[1].replace(/군$/, '시')} (일반구)`]);
  }
  return out;
}

/** 동 이름 줄기: 해운대1동 → 해운대, 종로1·2·3·4가동 → 종로, 정관읍 → 정관, 관훈동 → 관훈 */
export function dongStem(nm) {
  return String(nm || '').replace(/(로동자구|노동자구|동|읍|면|리)$/, '').replace(/[\d·.,]+가?$/, '').replace(/\d+$/, '').replace(/^제/, '');
}

export const subAdjCache = new Map();
/** 분구 단위 읍면동의 맞닿음 (경계 모양은 바뀌지 않으므로 단위마다 한 번만 센다) */
export function unitAdjacency(unit, idx) {
  const key = `${unit}|${idx.length}`;
  if (!subAdjCache.has(key)) subAdjCache.set(key, subAdjacency(idx));
  return subAdjCache.get(key);
}

/**
 * 남측 시의 실제 일반구(수원시 장안구·화성시 만세구 등, data/kr_gu.json — pipeline/build_kr_gu.py): 시 하나가 한 존이라 구를 고를 수 없었다.
 * 시마다 처음 한 번 일반구로 나눠 둔다 (구청장은 시장이 임명, 선거 없음). 이미 분구했거나 한 번 넣은 시는 건드리지 않는다. 넣었으면 true
 */
export async function applyKrGu() {
  const L = state.local;
  if (!L) return false;
  const data = await fetch('data/kr_gu.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data) return false;
  let n = 0;
  for (const [k, table] of Object.entries(data)) {
    if (L.bungu?.[k] || L.krGuDone?.includes(k)) continue;
    const gu = {};
    for (const z of unitZones(k)) zoneProps[z].subs.forEach((_, j) => {
      const i = zoneProps[z].sub0 + j, g = table[subsFC?.features[i]?.properties.name];
      if (g) gu[subKey(i)] = g;
    });
    const names = new Set(Object.values(gu));
    (L.krGuDone ||= []).push(k);
    if (names.size < 2) continue;
    (L.bungu ||= {})[k] = { n: names.size, gu, core: null, dirV: 2, general: true };
    n++;
  }
  return n > 0;
}

/** 계산용 읍면동끼리 맞닿음: 경계 꼭짓점을 둘 넘게 같이 쓰면 이웃 (읍면동 경계는 이웃끼리 꼭짓점을 공유한다). 번호 → Set */
export function subAdjacency(idxs) {
  const own = new Map(), adj = new Map(idxs.map((i) => [i, new Set()]));
  for (const i of idxs) {
    const g = subsFC?.features[i]?.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const r of poly) for (const q of r) {
      const k = `${q[0].toFixed(5)},${q[1].toFixed(5)}`;
      let s = own.get(k);
      if (!s) own.set(k, (s = new Set()));
      s.add(i);
    }
  }
  const cnt = new Map();
  for (const s of own.values()) {
    if (s.size < 2) continue;
    const a = [...s];
    for (let x = 0; x < a.length; x++) for (let y = x + 1; y < a.length; y++) { const k = a[x] < a[y] ? `${a[x]}|${a[y]}` : `${a[y]}|${a[x]}`; cnt.set(k, (cnt.get(k) || 0) + 1); }
  }
  for (const [k, c] of cnt) if (c >= 2) { const [a, b] = k.split('|').map(Number); adj.get(a)?.add(b); adj.get(b)?.add(a); }
  return adj;
}

/** 읍면동 묶음(번호들)을 맞닿은 덩어리로 나눈다 */
export function subComponents(set, adj) {
  const seen = new Set(), out = [];
  for (const i of set) {
    if (seen.has(i)) continue;
    const comp = [i];
    seen.add(i);
    for (let t = 0; t < comp.length; t++) for (const nb of adj.get(comp[t]) || []) if (set.has(nb) && !seen.has(nb)) { seen.add(nb); comp.push(nb); }
    out.push(comp);
  }
  return out;
}

/** 분구 단위의 월경지(구의 가장 큰 덩어리와 떨어진 조각)를 가장 길게 맞닿은 이웃 구로 옮긴다. 섬처럼 아무 데도 맞닿지 않은 조각은 둔다. 옮겼으면 true */
export function fixExclaves(unit) {
  const b = state.local.bungu?.[unit];
  if (!b || !subsFC) return false;
  const idx = unitZones(unit).flatMap((z) => zoneProps[z].subs.map((_, k) => zoneProps[z].sub0 + k)).filter((i) => b.gu[subKey(i)]);
  const adj = unitAdjacency(unit, idx);
  let moved = false;
  for (let round = 0; round < 10; round++) {
    let any = false;
    const byGu = new Map();
    for (const i of idx) { const g = b.gu[subKey(i)]; if (!byGu.has(g)) byGu.set(g, new Set()); byGu.get(g).add(i); }
    for (const [g, set] of byGu) {
      const comps = subComponents(set, adj).sort((x, y) => y.length - x.length);
      for (const comp of comps.slice(1)) {
        const touch = new Map();
        for (const i of comp) for (const nb of adj.get(i)) { const h = b.gu[subKey(nb)]; if (h && h !== g) touch.set(h, (touch.get(h) || 0) + 1); }
        const to = [...touch].sort((x, y) => y[1] - x[1])[0]?.[0];
        if (!to) continue;
        for (const i of comp) b.gu[subKey(i)] = to;
        any = moved = true;
      }
    }
    if (!any) break;
  }
  return moved;
}

/**
 * 광역시 아래에 시가 남지 않게: 광역시에 든 시(편입한 시, 승격한 뒤 편입한 군)는 구로 부르고(countyDisplayName),
 * 인구 40만이 넘는데 아직 나누지 않았으면 35만 명에 한 구꼴로 자치구 여럿으로 나눈다 (예전 저장에서 한 구로 남은 큰 시). 나눴으면 true
 */
export function splitMetroCities() {
  const L = state.local;
  if (!L) return false;
  let n = 0;
  for (const [k, c] of counties()) {
    const z = c.z, pn = promotedName(state, z);
    if (L.bungu?.[k] || !isMetroCity(c.region) || z.name === z.province || L.independent?.includes(pn)) continue;
    if (!/시$/.test(pn) && !(L.cityUp?.includes(k))) continue;
    if (c.pop < 400000 || unitZones(k).reduce((t, j) => t + zoneProps[j].subs.length, 0) < 4) continue;
    if (makeBungu(k, Math.max(2, Math.min(5, Math.round(c.pop / 350000))))) n++;
  }
  if (n) state.log.unshift(`${state.year}년 광역시 아래에 남아 있던 큰 시 ${n}곳을 자치구로 나눴습니다`);
  return n > 0;
}

/** 일반구로 나눌 단위인가 (군에서 승격한 시, 광역시 소속 아님) */
// 일반구로 나누는 단위: 도 밑의 시 (군에서 승격한 시 포함). 광역시 안이면 자치구, 도 밑의 군은 구를 둘 수 없다
export const isGeneralUnit = (k) => {
  if (state.local.annex?.[k] || isMetroCity(annexRegion(k))) return false;
  if (state.local.cityUp?.includes(k)) return true;
  const z = unitZones(k)[0];
  return z != null && /시$/.test(countyNameOf(z));
};

/** 분구한 읍면동의 구 이름 (없으면 null) */
export function guOfSub(i) {
  const B = state.local?.bungu;
  if (!B) return null;
  const k = subKey(i);
  for (const b of Object.values(B)) if (b.gu[k]) return b.gu[k];
  return null;
}

/** 분구한 단위(승격한 도시 몸통, 편입한 시) 존의 구 이름들 */
export function guNamesOfZone(z) {
  const B = bunguOf(z);
  return B ? [...new Set(Object.values(B.gu))] : null;
}

/** 존의 분구 기록 (없으면 null) */
export function bunguOf(z) {
  if (zoneProps[z]?.city) return null;
  return state.local?.bungu?.[promotedName(state, zoneProps[z])] || state.local?.bungu?.[unitId(state, zoneProps[z])] || null;
}

/** 일반구로 나눈 시 (구청장 없음, 시장 하나) */
export const isGeneralGu = (z) => !!bunguOf(z)?.general;

/** 분구한 시군(존 z) 안 이 점의 구: 점이 든 읍면동, 없으면 가장 가까운 읍면동 */
export function guAt(z, lon, lat) {
  const zp = zoneProps[z];
  // 자세한 읍면동 경계를 받아 두었으면 그 모양으로 (지도에 보이는 경계와 같다)
  for (const u of guUnits.get(countyRep(z)) || []) if (u.polys.some((p) => inRing(lon, lat, p[0]))) return u.gu;
  let best = null, bd = Infinity;
  for (const zz of countyZones(z)) {
    const q = zoneProps[zz];
    for (let k = 0; k < q.subs.length; k++) {
      const i = q.sub0 + k, g = guOfSub(i);
      if (!g) continue;
      const geom = subsFC?.features[i]?.geometry;
      const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
      if (polys.some((p) => inRing(lon, lat, p[0]))) return g;
      const d = (q.subs[k][0] - lon) ** 2 + (q.subs[k][1] - lat) ** 2;
      if (d < bd) { bd = d; best = g; }
    }
  }
  return zp ? best : null;
}

/** 구의 읍면동 번호들 */
export function guSubs(z, gu) {
  const out = [];
  for (const zz of countyZones(z)) { const q = zoneProps[zz]; for (let k = 0; k < q.subs.length; k++) if (guOfSub(q.sub0 + k) === gu) out.push(q.sub0 + k); }
  return out;
}

/** 구 통째 편입 대상: 이 구의 읍면동과 맞닿은 다른 광역시 (구는 광역시 밑에 자치구로만 둔다) */
export function guMoveTargets(subs) {
  const own = new Set(subs.map((i) => subRegion(i))), out = new Set();
  for (const s of subs) for (const j of subNeighbors(s)) { const r = subRegion(j); if (!own.has(r) && isMetroCity(r)) out.add(r); }
  return [...out];
}

/**
 * 구를 통째로 다른 광역시로 옮긴다: 그 구의 읍면동으로 대상 광역시 안에 같은 이름의 자치구를 세운다 (시군구 신설과 같은 장치).
 * 일반구였으면 자치구가 되어 구청장을 뽑는다
 */
export function moveGuTo(subs, gu, to) {
  const a = admin();
  if (!a || !subs.length) return false;
  if ([...a.units.values()].some((u) => u.name === gu && u.region === to)) { alert(`${to}에 이미 ${gu}가 있습니다. 구 이름을 먼저 바꾸세요.`); return false; }
  const from = subRegion(subs[0]), fromUnit = a.unitOfSub[subs[0]];
  if (!payEvent(EVENT_COST.annex)) return false;
  const home = fromUnit.startsWith('z:') ? unitId(state, zoneProps[+fromUnit.slice(2)]) : state.local.splitUnit[fromUnit]?.home || fromUnit;
  const key = `split:${Date.now().toString(36)}`;
  (state.local.splitUnit ||= {})[key] = { name: gu, home, region: to, year: state.year };
  adminInvalidate();
  for (const i of subs) setSubUnit(i, key);
  state.log.unshift(`${state.year}년 ${from} ${unitName(fromUnit)} ${gu}, ${to}로 통째 편입`);
  holdElection([to, from], `${to} 구 편입 선거`);
  syncMayors();
  save(state); drawAdmin(); drawBungu(); refreshNames(map); renderAll();
  select({ type: 'unit', id: key });
  return true;
}

export function guPanel(z, gu) {
  const zp = zoneProps[z], r = regionOf(state, zp), L = state.local, general = isGeneralGu(z);
  const name = general ? `${zoneName(z)} ${gu}` : gu;
  if (!result) return header(name);
  // 원래 있던 구와 같은 창: 인구·행복도는 이 구의 읍면동으로, HDI·소득 등 시군 단위 값은 분구 전 시군의 값 (교통 계산은 시군 하나로 한다)
  const R = result.zones, zs = countyZones(z), subs = guSubs(z, gu);
  const pop = subs.reduce((t, i) => t + result.subs.pop[i], 0), pop0 = subs.reduce((t, i) => t + (subPop0[i] || 0), 0);
  const cpop = zs.reduce((t, j) => t + R.pop[j], 0);
  const avg = (arr) => (cpop > 0 ? zs.reduce((t, j) => t + arr[j] * R.pop[j], 0) / cpop : arr[z]);
  const change = pop / Math.max(pop0, 1) - 1;
  const happy = pop > 0 ? subs.reduce((t, i) => t + (subMetric('subHappy', i) ?? 0) * result.subs.pop[i], 0) / pop : null;
  const st = (() => {   // 이 구 인구가 가장 많은 읍면동에서 가장 가까운 역
    const i = subs.reduce((bk, j) => (result.subs.pop[j] > result.subs.pop[bk] ? j : bk), subs[0]);
    const main = zs.reduce((bk, j) => (R.pop[j] > R.pop[bk] ? j : bk), zs[0]);
    return i != null ? R.station[subInfo(i)[0]] ?? R.station[main] : R.station[main];
  })();
  const stName = st >= 0 ? nodeNames().get(st)?.name : null;
  const accRef = median(Array.from(R.access));
  const p = provincePops().get(r), pc = p ? p.pop / Math.max(p.pop0, 1) - 1 : 0;
  return `${header(name)}
    <table class="kv">
      <tr><td>소속</td><td>${esc(r)} (${zp.country === 'KP' ? '북' : '남'})${general ? ` · ${esc(zoneName(z))}의 일반구 (구청장은 시장이 임명)` : ''}</td></tr>
      ${p ? `<tr><td>${esc(r)} 인구</td><td>${fmtPop(p.pop)} <span class="${pc >= 0 ? 'pos' : 'neg'}">(${pc >= 0 ? '+' : ''}${pct(pc)})</span> · 이 시군구가 ${pct(pop / Math.max(p.pop, 1))}</td></tr>` : ''}
      ${happy != null ? `<tr><td>주민 행복도</td><td>${happy.toFixed(1)}</td></tr>` : ''}
      <tr><td>인구</td><td>${fmtPop(pop)} <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>지난해 순이동</td><td>${Math.round(zs.reduce((t, j) => t + R.netMig[j], 0) * pop / Math.max(cpop, 1)).toLocaleString()}명</td></tr>
      <tr><td>HDI</td><td>${avg(R.hdi).toFixed(3)}</td></tr>
      <tr><td>기대수명</td><td>${avg(R.le).toFixed(1)}세</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(avg(R.income)).toLocaleString()}</td></tr>
      <tr><td>접근성 (중앙값=1)</td><td>${(avg(R.access) / accRef).toFixed(2)}</td></tr>
      <tr><td>이용 철도역</td><td>${stName ? esc(stName) : '없음 (25km 밖)'}</td></tr>
    </table>
    <h4>지방자치 · ${esc(r)}</h4>
    <div class="m" style="margin:2px 0">${officeLine(L.offices[`g:${r}`])}</div>
    <div class="m" style="margin:2px 0">${officeLine(L.offices[general ? mayorKey(z) : guKey(z, gu)])}</div>
    ${supportHTML(z)}
    ${zoneAdminHTML(z)}
    ${(() => {
      const t = guMoveTargets(subs);
      return t.length ? `<h4>구 통째 편입</h4><p class="hint">${esc(gu)}를 통째로 맞닿은 광역시의 자치구로 옮깁니다 (같은 이름, 구청장 선거) · ${formatWon(EVENT_COST.annex)}</p>
        <div class="actions">${t.map((r) => `<button class="small" data-gu-move="${esc(r)}">${esc(r)}에 편입</button>`).join('')}</div>` : '';
    })()}
    <h4>구 경계 조정</h4>
    <p class="hint">${guEdit ? '지도에서 동을 누르면 그 자리에 구 목록이 뜹니다. 옮길 구를 고르세요 (한 구의 마지막 동은 옮길 수 없습니다). Esc로 끝냅니다.' : '단추를 누른 뒤 지도에서 동을 눌러, 그 동이 속할 구를 고릅니다.'}</p>
    <button class="small ${guEdit ? '' : 'primary'}" id="gu-edit">${guEdit ? '경계 조정 끝내기' : '동을 눌러 경계 조정'}</button>
    <h4>이름 바꾸기</h4>
    <div class="name-row"><input type="text" id="gu-name" value="${esc(gu)}">
      <button class="small" id="gu-rename">바꾸기</button></div>
    <p class="hint">직접 바꾸는 이름은 비용이 들지 않지만 주민 행복도에는 영향이 없습니다.</p>`;
}

/**
 * 분구한 시군의 자세한 읍면동(리) 경계마다 구를 정해 둔다: 대표 존 → [{ gu, polys }].
 * 경계 조각의 가운데가 든 계산용 읍면동(없으면 가장 가까운 것)의 구
 */
export const guUnits = new Map();
export async function loadGuUnits(only = null) {
  const reps = new Set();
  for (const unit of Object.keys(state.local?.bungu || {})) for (const z of unitZones(unit)) reps.add(countyRep(z));
  for (const r of [...guUnits.keys()]) if (!reps.has(r)) guUnits.delete(r);
  // only: 이 대표 존들만 (화면에 든 분구 단위). 자세한 읍면동 경계 파일은 크다
  const want = [...reps].filter((r) => !guUnits.has(r) && (!only || only.has(r)));
  if (!want.length) return;
  const zs = want.flatMap((r) => countyZones(r)), zset = new Set(zs);
  const pts = zs.flatMap((z) => zoneProps[z].subs.map((q) => q));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const feats = await unitFeaturesIn(map, Math.min(...xs) - 0.2, Math.min(...ys) - 0.2, Math.max(...xs) + 0.2, Math.max(...ys) + 0.2);
  for (const r of want) guUnits.set(r, []);
  for (const f of feats) {
    const z = f.properties.zone;
    if (!zset.has(z)) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    // 자세한 경계의 번호(id)가 곧 계산용 읍면동 번호다: 그 읍면동의 구를 그대로 쓴다. 예전에는 꼭짓점 평균 자리로 어림해
    // 엉뚱한 구에 든 동이 생겨 구 안의 동 경계가 구 경계로 그려지고 진짜 구 경계는 군데군데 끊겼다
    const own = Number.isInteger(f.properties.id) ? guOfSub(f.properties.id) : null;
    const ring = polys[0][0];
    const gu = own || guByCoarse(z, ring.reduce((t, q) => t + q[0], 0) / ring.length, ring.reduce((t, q) => t + q[1], 0) / ring.length);
    if (gu) guUnits.get(countyRep(z))?.push({ gu, polys, sub: Number.isInteger(f.properties.id) ? f.properties.id : -1 });
  }
}

/** 계산용 읍면동 모양으로 이 점의 구 (점이 든 곳, 없으면 가장 가까운 읍면동) */
export function guByCoarse(z, lon, lat) {
  let best = null, bd = Infinity;
  for (const zz of countyZones(z)) {
    const q = zoneProps[zz];
    for (let k = 0; k < q.subs.length; k++) {
      const i = q.sub0 + k, g = guOfSub(i);
      if (!g) continue;
      const geom = subsFC?.features[i]?.geometry;
      const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
      if (polys.some((p) => inRing(lon, lat, p[0]))) return g;
      const d = (q.subs[k][0] - lon) ** 2 + (q.subs[k][1] - lat) ** 2;
      if (d < bd) { bd = d; best = g; }
    }
  }
  return best;
}

/**
 * 구 경계 조정: 켜 두면 지도에서 동(읍면동)을 누를 때마다 그 자리에 구 목록을 띄워, 고른 구로 옮긴다
 * (같은 분구 단위 안에서만, 한 구를 비우지 않게). 구 창·분구 직후 이름 정하기 창에서 켜고 Esc로 끈다
 */
export var guEdit = null;   // { id: 대표 존, unit } · var: 창 그리기가 이 줄보다 먼저 돌 수 있다
export function setGuEdit(v) { return (guEdit = v); }
export var guSaveT = 0, guPreview = null, guPreviewDraw = null;   // 미리보기 중인 분구 단위와 그 창 다시 그리기
export function startGuEdit(id, unit = bunguUnitOf(id)) {
  if (!unit) return;
  guEdit = { id: countyRep(id), unit };
  map.getCanvas().style.cursor = 'crosshair';
  const esc_ = (e) => { if (e.key === 'Escape') { endGuEdit(); document.removeEventListener('keydown', esc_); } };
  document.addEventListener('keydown', esc_);
  toast('구 경계 조정: 옮길 동을 누르면 구를 고를 수 있습니다 (Esc로 끝내기)');
  renderSelection();
}
export function endGuEdit() {
  if (!guEdit) return;
  guEdit = null;
  document.querySelector('.st-menu')?.remove();
  if (map) map.getCanvas().style.cursor = '';
  renderSelection();
}
export function guEditClick(ll, pt) {
  const unit = guEdit.unit, b = unit && state.local.bungu?.[unit];
  if (!b) { endGuEdit(); return; }
  const zs = new Set(unitZones(unit));
  let hit = -1, bd = Infinity;
  for (const z of zs) zoneProps[z].subs.forEach((sp, k) => {
    const i = zoneProps[z].sub0 + k, geom = subsFC?.features[i]?.geometry;
    const polys = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : [];
    if (polys.some((p) => inRing(ll.lng, ll.lat, p[0]))) { hit = i; bd = -1; return; }
    const d = (sp[0] - ll.lng) ** 2 + (sp[1] - ll.lat) ** 2;
    if (bd >= 0 && d < bd) { bd = d; hit = i; }
  });
  if (hit < 0 || (bd > 0.0004)) { toast('분구한 시군 안의 동을 누르세요 (Esc로 끝내기).'); return; }
  const key = subKey(hit), from = b.gu[key], nm = subName(hit) || '읍면동';
  if (!from) { toast('분구한 시군 안의 동을 누르세요 (Esc로 끝내기).'); return; }
  const gs = (!unit.startsWith('split:') && zoneGus(guEdit.id)) || [...new Set(Object.values(b.gu))].sort((x, y) => x.localeCompare(y, 'ko'));
  const last = Object.values(b.gu).filter((g) => g === from).length <= 1;
  // 월경지가 생기지 않게: 이 동과 맞닿은 구로만 옮기고, 옮기면 지금 구가 둘로 갈리는 동은 옮기지 않는다
  const all = [...zs].flatMap((z) => zoneProps[z].subs.map((_, k) => zoneProps[z].sub0 + k)).filter((i) => b.gu[subKey(i)]);
  const adj = unitAdjacency(unit, all);
  const touching = new Set([...adj.get(hit) || []].map((j) => b.gu[subKey(j)]));
  const rest = new Set(all.filter((i) => i !== hit && b.gu[subKey(i)] === from));
  const splits = rest.size > 0 && subComponents(rest, adj).length > 1;
  const why = (g) => (g === from ? '' : last ? '마지막 동' : splits ? `${from}가 둘로 갈림` : !touching.has(g) ? '맞닿지 않음' : '');
  document.querySelector('.st-menu')?.remove();
  const el = document.createElement('div');
  el.className = 'st-menu';
  el.innerHTML = `<div class="t">${esc(nm)} <span class="m">· 지금 ${esc(from)}</span></div>
    ${gs.map((g) => `<button class="small ${g === from ? 'on' : ''}" data-gu-to="${esc(g)}" ${why(g) ? 'disabled' : ''}>${esc(g)}${g === from ? ' (지금)' : why(g) ? ` <span class="m">· ${why(g)}</span>` : ''}</button>`).join('')}
    ${last ? `<div class="m">${esc(from)}의 마지막 동이라 옮길 수 없습니다</div>` : splits ? `<div class="m">옮기면 ${esc(from)}가 둘로 갈려 월경지가 생깁니다</div>` : ''}`;
  const box = map.getContainer().getBoundingClientRect();
  Object.assign(el.style, { left: `${Math.min(box.left + pt.x + 12, window.innerWidth - 220)}px`, top: `${Math.min(box.top + pt.y + 12, window.innerHeight - 60 - gs.length * 34)}px` });
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  el.querySelectorAll('[data-gu-to]').forEach((btn) => {
    btn.onclick = () => {
      const to = btn.dataset.guTo;
      close();
      if (to === from) return;
      b.gu[key] = to;
      // 빠르게: 자세한 경계는 다시 받지 않고 그 동 조각의 구만 바꾸고, 이 단위의 구 경계·이름과 창만 다시 그린다.
      // 저장(게임 전체를 문자열로)은 잇달아 옮길 때 한 번만
      for (const u of guUnits.get(countyRep(hit < 0 ? guEdit.id : subInfo(hit)[0])) || []) if (u.sub === hit) u.gu = to;
      bunguLineCache.delete(unit);
      toast(`${nm}: ${from} → ${to}`);
      clearTimeout(guSaveT); guSaveT = setTimeout(() => save(state), 800);
      drawBungu();
      if (selection?.type === 'gu') { drawGuSelection(selection); renderSelection(); }
      guPreviewDraw?.();
    };
  });
}

/** 고른 구: 시군을 고를 때와 같은 파란 바깥 테두리 (자세한 읍면동 경계로) */
/** 고른 리 묶음(면·시군)의 바깥 테두리 */
export function drawSubsOutline(ids) {
  if (!map) return;
  if (!map.getSource('subs-outline')) {
    map.addSource('subs-outline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'subs-outline', type: 'line', source: 'subs-outline', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1f5fbf', 'line-width': 2.5 } });
  }
  const items = ids.map((i) => subsFC?.features[i]?.geometry).filter(Boolean).map((g) => ({ key: 1, polys: g.type === 'Polygon' ? [g.coordinates] : g.coordinates }));
  map.getSource('subs-outline').setData({ type: 'FeatureCollection',
    features: (items.length ? edgeLines(items, 'outer') : []).map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) });
}

export function drawGuSelection(sel) {
  if (!map) return;
  if (!map.getSource('gu-sel')) {
    map.addSource('gu-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'gu-sel-line', type: 'line', source: 'gu-sel', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1f5fbf', 'line-width': 2.5 } });
  }
  const set = (us) => map.getSource('gu-sel').setData({ type: 'FeatureCollection',
    features: edgeLines(us.filter((u) => u.gu === sel.gu).map((u) => ({ key: u.gu, polys: u.polys })), 'outer').map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) });
  if (!sel) { map.getSource('gu-sel').setData({ type: 'FeatureCollection', features: [] }); return; }
  const us = guUnits.get(countyRep(sel.id));
  if (us) set(us);
  else loadGuUnits().then(() => { if (selection === sel) set(guUnits.get(countyRep(sel.id)) || []); });
}

/**
 * 읍면동 면들의 변을 이어 선으로: mode 'between'은 서로 다른 key(구)가 함께 가진 변(구와 구 사이), 'outer'는 바깥 테두리.
 * 자세한 읍면동 경계는 이웃끼리 꼭짓점을 공유하지만, 북측 리 경계(지형으로 어림해 그린 것)는 군데군데 이웃과 꼭짓점이 어긋나
 * 가는 틈이 있다: 공유하지 않는 변도 다른 면의 공유하지 않는 변이 40m 안에 나란히 있으면 맞닿은 변으로 친다
 * (예전에는 그런 변이 바깥 테두리로 잡혀 북측에서 분구한 구를 고르면 구 안의 동 경계가 파랗게 그려지고, 구와 구 사이 경계는 끊겼다).
 * 셋 이상이 만나는 점에서 선을 끊는다
 */
export function edgeLines(items, mode) {
  const kp = (q) => `${q[0].toFixed(5)},${q[1].toFixed(5)}`, ek = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const cnt = new Map(), keys = new Map(), coords = new Map(), poly = new Map();
  let pid = 0;
  for (const { key, polys } of items) for (const pg of polys) {
    pid++;
    for (const ring of pg) for (let k = 0; k + 1 < ring.length; k++) {
      const a = kp(ring[k]), c = kp(ring[k + 1]);
      if (a === c) continue;
      const e = ek(a, c);
      cnt.set(e, (cnt.get(e) || 0) + 1);
      if (!keys.has(e)) keys.set(e, new Set());
      keys.get(e).add(key);
      if (!coords.has(e)) coords.set(e, [ring[k], ring[k + 1]]);
      if (!poly.has(e)) poly.set(e, new Set());
      poly.get(e).add(pid);
    }
  }
  // 공유하지 않는 변끼리 40m 안에 나란히 있는 짝 찾기 (격자로 가까운 변만 견준다)
  const single = [...cnt].filter(([, n]) => n === 1).map(([e]) => e);
  const G = 0.002, grid = new Map(), cell = (x, y) => `${Math.floor(x / G)},${Math.floor(y / G)}`;
  for (const e of single) {
    const [p, q] = coords.get(e);
    for (let x = Math.floor(Math.min(p[0], q[0]) / G); x <= Math.floor(Math.max(p[0], q[0]) / G); x++) {
      for (let y = Math.floor(Math.min(p[1], q[1]) / G); y <= Math.floor(Math.max(p[1], q[1]) / G); y++) {
        const c = `${x},${y}`;
        if (!grid.has(c)) grid.set(c, []);
        grid.get(c).push(e);
      }
    }
  }
  const segDist = (m, p, q, kx) => {   // 점 m에서 선분 p-q까지 (km 어림)
    const dx = (q[0] - p[0]) * kx, dy = q[1] - p[1];
    const t = Math.max(0, Math.min(1, (((m[0] - p[0]) * kx) * dx + (m[1] - p[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot((m[0] - p[0]) * kx - t * dx, m[1] - p[1] - t * dy) * 111;
  };
  const near = new Map();   // 공유하지 않는 변 → 틈 건너 맞닿은 면의 key들
  for (const e of single) {
    const [p, q] = coords.get(e), m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], kx = Math.cos((m[1] * Math.PI) / 180);
    const [cx, cy] = cell(m[0], m[1]).split(',').map(Number);
    const mine = poly.get(e), got = new Set();
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const f of grid.get(`${x},${y}`) || []) {
        if (f === e || [...poly.get(f)].some((v) => mine.has(v))) continue;
        const [r, s2] = coords.get(f);
        if (segDist(m, r, s2, kx) < 0.04) for (const k of keys.get(f)) got.add(k);
      }
    }
    if (got.size) near.set(e, got);
  }
  const adj = new Map();
  for (const [e, n] of cnt) {
    let take;
    if (mode === 'between') take = keys.get(e).size >= 2 || (n === 1 && [...(near.get(e) || [])].some((k) => String(k) > String([...keys.get(e)][0])))   // 틈 양쪽 가운데 한쪽만;
    else take = n === 1 && !near.has(e);
    if (!take) continue;
    const [a, c] = e.split('|');
    for (const [x, y] of [[a, c], [c, a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); }
  }
  const used = new Set(), pt = (k) => k.split(',').map(Number), out = [];
  for (const start of adj.keys()) for (const nx0 of adj.get(start)) {
    if (used.has(ek(start, nx0))) continue;
    const line = [pt(start)];
    let cur = nx0;
    used.add(ek(start, nx0));
    for (let guard = 0; guard < 200000; guard++) {
      line.push(pt(cur));
      const nb = adj.get(cur) || [];
      if (nb.length !== 2) break;
      const nx = nb.find((v) => !used.has(ek(cur, v)));
      if (!nx) break;
      used.add(ek(cur, nx));
      cur = nx;
    }
    out.push(line);
  }
  return out;
}

/**
 * 분구한 구를 지도에: 원래 있던 구와 똑같이 보이게 구와 구 사이에 시군구 경계선(zones-line과 같은 모양)을 긋고,
 * 구 이름은 시군구 라벨 층에 단다 (자세한 읍면동 경계로: 계산용 읍면동 모양은 크게 단순화돼 지도 경계와 어긋났다)
 */
export let bunguDrawSeq = 0, bunguMoveHooked = false;
export const bunguLineCache = new Map();   // 분구 단위 → 구 사이 선 (동을 옮기면 그 단위만 다시 센다)
export const GU_COLORS = ['#e4572e', '#2e86de', '#20a35a', '#9b59b6', '#f0a202'];
/** 미리보기 색: 구 순서(가운데 구 먼저)대로 */
export function guColorMap(unit) {
  const b = state.local.bungu?.[unit];
  const gs = zoneGus(countyRep(unitZones(unit)[0])) || [...new Set(Object.values(b?.gu || {}))].sort((x, y) => x.localeCompare(y, 'ko'));
  return new Map(gs.map((g, k) => [g, GU_COLORS[k % GU_COLORS.length]]));
}
export async function drawBungu() {
  if (!map || !subsFC) return;
  if (!map.getSource('bungu')) {
    map.addSource('bungu', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'bungu-line', type: 'line', source: 'bungu', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#7a7f86', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 9, 0.8], 'line-opacity': 0.7 } },
      map.getLayer('zones-sel-edge') ? 'zones-sel-edge' : undefined);
  }
  if (!map.getSource('bungu-prev')) {
    map.addSource('bungu-prev', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'bungu-prev-fill', type: 'fill', source: 'bungu-prev', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.5, 'fill-outline-color': 'rgba(0,0,0,0)' } }, 'bungu-line');
  }
  const seq = ++bunguDrawSeq;
  // 구 사이 선은 자세한 읍면동 경계로 세서 무겁다 (일반구가 있는 시 10곳이면 10초 넘게 걸려 첫 계산 결과를 받는 것까지 막았다):
  // 화면에 든 분구 단위만, 어느 정도 확대했을 때만 세고, 단위 하나를 셀 때마다 쉬어 다른 일을 먼저 하게 한다. 센 것은 기억해 둔다
  if (!bunguMoveHooked) { bunguMoveHooked = true; let t = 0; map.on('moveend', () => { clearTimeout(t); t = setTimeout(() => drawBungu(), 300); }); }
  const vb = map.getBounds(), zoomOk = map.getZoom() >= 7.5;
  const inView = (unit) => unitZones(unit).some((z) => zoneProps[z].subs.some(([x, y]) => x >= vb.getWest() - 0.1 && x <= vb.getEast() + 0.1 && y >= vb.getSouth() - 0.1 && y <= vb.getNorth() + 0.1));
  const need = Object.keys(state.local?.bungu || {}).filter((u) => !bunguLineCache.has(u) && zoomOk && inView(u));
  if (need.length) { const before = guUnits.size; await loadGuUnits(new Set(need.flatMap((u) => unitZones(u).map((z) => countyRep(z))))); if (guUnits.size !== before && result) paintZones(); }
  if (seq !== bunguDrawSeq) return;   // 그사이 다시 그리기 시작했다
  for (const u of bunguLineCache.keys()) if (!state.local?.bungu?.[u]) bunguLineCache.delete(u);
  const feats = [], labels = [];
  for (const [unit, b] of Object.entries(state.local?.bungu || {})) {
    const names = new Set(Object.values(b.gu));
    const pts = new Map();
    const zs = unitZones(unit);
    for (const z of zs) {
      zoneProps[z].subs.forEach((sp, k) => {
        const i = zoneProps[z].sub0 + k, g = b.gu[subKey(i)];
        if (!g) return;
        const w = Math.max(1, result ? result.subs.pop[i] : 1), e = pts.get(g) || { x: 0, y: 0, w: 0 };
        e.x += sp[0] * w; e.y += sp[1] * w; e.w += w; pts.set(g, e);
      });
    }
    const reps = [...new Set(zs.map((z) => countyRep(z)))];
    if (!bunguLineCache.has(unit) && need.includes(unit) && reps.every((r) => guUnits.has(r))) {
      const items = reps.flatMap((r) => guUnits.get(r) || []).filter((u) => names.has(u.gu)).map((u) => ({ key: u.gu, polys: u.polys }));
      bunguLineCache.set(unit, edgeLines(items, 'between').map((line) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } })));
      await new Promise((r) => setTimeout(r, 0));   // 쉬어 가기 (워커 결과·입력을 먼저)
      if (seq !== bunguDrawSeq) return;
    }
    feats.push(...(bunguLineCache.get(unit) || []));
    for (const [g, e] of pts) labels.push({ type: 'Feature', properties: { name: g }, geometry: { type: 'Point', coordinates: [e.x / e.w, e.y / e.w] } });
  }
  map.getSource('bungu').setData({ type: 'FeatureCollection', features: feats });
  setBunguLabels(labels);
  pushExtraLabels();
  // 분구 미리보기: 구마다 옅은 색 (확정하면 지운다)
  const pf = [];
  if (guPreview && state.local?.bungu?.[guPreview]) {
    const col = guColorMap(guPreview);
    for (const r of new Set(unitZones(guPreview).map((z) => countyRep(z)))) for (const u of guUnits.get(r) || []) {
      if (col.has(u.gu)) for (const c of u.polys) pf.push({ type: 'Feature', properties: { color: col.get(u.gu) }, geometry: { type: 'Polygon', coordinates: c } });
    }
  }
  map.getSource('bungu-prev').setData({ type: 'FeatureCollection', features: pf });
  drawGuMetric();
}

export const bunguSelect = (id, none = '분구 안 함 (구 없이)', min = 1) => `<select id="${id}" class="small">${[1, 2, 3, 4, 5].filter((n) => n >= min).map((n) => `<option value="${n}">${n === 1 ? none : `${n}개 구로 분구`}</option>`).join('')}</select>`;

/** 건설 탭: 국가 대형 사업 목록 (착공 전·공사 중·완공). 선형 보기·효과 미리보기·착공 */
export function megaHTML() {
  // 교류화 사업비는 남은 직류 구간 연장으로 (착공 전에만 다시 잰다)
  const ac = MEGA.find((m) => m.id === 'kp-ac');
  if (ac && !state.projects.some((x) => x.kind === 'mega' && x.mega === 'kp-ac')) ac.cost = state.mega?.['kp-ac'] ? ac.cost : kpACCost(base, state);
  return `<h4>국가 대형 사업</h4>
    <p class="hint">해마다 예산을 들여 짓는 국가 단위 사업입니다. 선형을 지도에서 보고, 다 지었을 때의 효과와 예비타당성 평가를 미리 볼 수 있습니다.</p>
    <div class="list">${MEGA.map((m) => {
    const p = state.projects.find((x) => x.kind === 'mega' && x.mega === m.id);
    const status = state.mega?.[m.id] ? `<span class="pos">${state.mega[m.id]}년 완공</span>`
      : p ? `공사 중 · ${p.doneYear}년 완공 예정`
      : `<button class="small primary" data-mega="${m.id}" ${m.ready(state) ? '' : 'disabled'}>착공 ${formatWon(m.cost)} · ${m.years}년</button>
        <button class="small" data-mega-prev="${m.id}">효과 미리보기</button>${m.ready(state) || !m.need ? '' : ` <span class="m">조건: ${esc(m.need)}</span>`}`;
    const acInfo = m.id === 'kp-ac' ? (() => { const L = kpDCLines(base, state); return ` 남은 직류 구간 ${L.length}개 노선 ${Math.round(L.reduce((s0, g) => s0 + g.km, 0)).toLocaleString()}km.`; })() : '';
    return `<div class="item"><div class="t">${esc(m.name)} ${m.id === 'kp-ac' ? '' : `<button class="small" data-mega-show="${m.id}">선형 보기</button>`}</div>
      <div class="m">${esc(m.desc)}${m.id === 'tsr' ? ` 화물 수입 연 ${formatWon(TSR_FREIGHT)}.` : ''}${acInfo}</div><div class="row" style="display:flex;gap:4px;flex-wrap:wrap">${status}</div></div>`;
  }).join('')}</div>`;
}

export function bindMega(el) {
  el.querySelectorAll('[data-mega]').forEach((b) => {
    b.onclick = () => {
      const m = MEGA.find((x) => x.id === b.dataset.mega);
      if (!confirm(`${m.label}을(를) 착공할까요?
${formatWon(m.cost)} · ${m.years}년 (해마다 ${formatWon(m.cost / m.years)})`)) return;
      const r = startMega(state, m.id);
      if (!r.ok) { alert(r.reason); return; }
      save(state); renderAll();
    };
  });
  el.querySelectorAll('[data-mega-show]').forEach((b) => { b.onclick = () => showMegaLine(b.dataset.megaShow); });
  el.querySelectorAll('[data-mega-prev]').forEach((b) => { b.onclick = () => previewMega(b.dataset.megaPrev); });
}

/** 대형 사업 선형을 지도에 그리고 그쪽으로 옮긴다 */
export function showMegaLine(id) {
  const g = megaGeometry(base, id);
  if (!g) return;
  const line = smoothSegments(g.coords.map(([lon, lat]) => ({ lon, lat }))).flatMap((seg, i) => (i ? seg.slice(1) : seg));
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } },
    ...[g.coords[0], g.coords[g.coords.length - 1]].map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })),
  ] });
  const xs = line.map((c) => c[0]), ys = line.map((c) => c[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 10 });
  return g;
}

export function previewMega(id) {
  const m = MEGA.find((x) => x.id === id);
  const g = id === 'kp-ac' ? { coords: [] } : showMegaLine(id);
  if (!m || !g) return;
  const km = id === 'kj-tunnel' ? 230 : id === 'jeju-hsr' ? 167 : id === 'kp-ac' ? kpDCLines(base, state).reduce((s0, x) => s0 + x.km, 0) : polylineKm(g.coords);
  runPreview(`${m.name} 미리보기`, (c) => applyMega(base, c, id),
    { kind: 'mega', cost: m.cost, years: m.years, km, cls: 'hsr', mode: 1, plan: true, border: id === 'tsr' });
}

export function payEvent(cost) {
  if (!canAfford(state, cost, 1)) { alert('예산과 차입 한도가 부족합니다.'); return false; }
  state.budget -= cost;
  if (state.budget < 0) { state.debt += -state.budget; state.budget = 0; }
  return true;
}

export function bindLocalSettings(el) {
  const L = state.local;
  el.querySelector('#ev-autonomy')?.addEventListener('click', () => {
    if (!payEvent(EVENT_COST.autonomy)) return;
    L.autonomyKP = true;
    holdElection('kp', '북측 첫 지방선거');
    save(state); renderAll();
  });
  el.querySelector('#ev-admin')?.addEventListener('click', () => adminSetup(false));
  el.querySelector('[data-unit-new]')?.addEventListener('click', () => startUnitPick());
  el.querySelector('#ev-rename')?.addEventListener('click', () => {
    const r = renameKPLines(base, state);
    if (!r.ok) { alert(r.reason); return; }
    save(state); refreshLinks(); renderAll();
  });
  el.querySelector('[data-gun-gu]')?.addEventListener('click', (e) => {
    const k = e.currentTarget.dataset.gunGu, n = +(el.querySelector('#gun-gu')?.value || 1);
    if (!payEvent(EVENT_COST.cityUp * (n > 1 ? 2 : 1))) return;
    (L.gunToGu ||= []).push(k);
    adminInvalidate();
    state.log.unshift(`${state.year}년 ${annexRegion(k)} ${k.split('|')[1]} → ${k.split('|')[1].replace(/군$/, '구')}`);
    if (n > 1) makeBungu(k, n);
    syncMayors(); drawBungu(); refreshNames(map); save(state); renderAll();
    if (n > 1) guNamingDialog(k);
  });
  el.querySelector('[data-guyeok]')?.addEventListener('click', () => {
    if (!payEvent(EVENT_COST.cityUp)) return;
    setAdmin({ ...(L.admin || {}), guyeok: 'gu' });
    state.log.unshift(`${state.year}년 북측 구역을 구로 부릅니다 (중구역 → 중구 등)`);
    syncMayors(); refreshNames(map); save(state); renderAll();
  });
  el.querySelectorAll('[data-metro-rename]').forEach((b) => { b.onclick = () => metroRename(b.dataset.metroRename); });
  bindGuSplit(el);
  el.querySelectorAll('[data-bungu]').forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.bungu, n = +(el.querySelector('#bungu-n2')?.value || 1);
      if (n < 2) { toast('나눌 구 수를 고르세요.'); return; }
      if (!payEvent(EVENT_COST.cityUp)) return;
      if (!makeBungu(c, n, { general: isGeneralUnit(c) })) { toast('읍면동이 모자라 그만큼 나눌 수 없습니다.'); return; }
      syncMayors();   // 새로 생긴 구마다 구청장
      drawBungu(); refreshNames(map); save(state); renderAll();
      guNamingDialog(c);
    };
  });
  el.querySelectorAll('[data-city-up]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.cityUp, c = counties().get(k);
      if (!c || !payEvent(EVENT_COST.cityUp)) return;
      (L.cityUp ||= []).push(k);
      adminInvalidate();
      (L.cityUpYear ||= {})[k] = state.year;
      state.log.unshift(`${state.year}년 ${c.name} → ${c.name.replace(/군$/, '시')} 승격`);
      const nGu = +(el.querySelector('#bungu-n3')?.value || 1);
      if (nGu > 1) { makeBungu(k, nGu, { general: true }); drawBungu(); }
      syncMayors();   // 군수 → 시장
      refreshNames(map);
      save(state); renderAll();
      const after = () => { if (nGu > 1) guNamingDialog(k); };
      // 군 → 시: 읍면 가운데 동으로 바꿀 곳을 고른다 (군에는 읍면만, 시에는 읍면동 모두)
      if ((kpMyeon && c.z.country === 'KP') || c.z.country === 'KR') myeonDongDialog(k, after); else after();
    };
  });
  el.querySelectorAll('[data-myeon-dong]').forEach((b) => { b.onclick = () => myeonDongDialog(b.dataset.myeonDong); });
  el.querySelectorAll('[data-split-unit]').forEach((b) => { b.onclick = () => startUnitPick(); });
  el.querySelectorAll('[data-unit-go]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); select({ type: 'unit', id: a.dataset.unitGo }); }; });
  el.querySelectorAll('[data-merge-split]').forEach((b) => { b.onclick = () => { if (confirm('나눠 세운 시군을 원래 시군에 다시 합칠까요?')) mergeSplitUnit(b.dataset.mergeSplit); }; });
  el.querySelectorAll('[data-annex]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.annex, to = b.dataset.annexTo, c = counties().get(k);
      const nGu = b.dataset.annexGu ? +(el.querySelector(`#${b.dataset.annexGu}`)?.value || 1) : 1;
      const cost = EVENT_COST.annex + (nGu > 1 ? EVENT_COST.cityUp : 0);
      if (!c || !confirm(`${c.name}(${c.region})을(를) ${to}에 편입할까요?${nGu > 1 ? ` ${nGu}개 자치구로 나눕니다.` : ''} 두 광역 단체장을 다시 뽑습니다. ${formatWon(cost)}`)) return;
      if (!payEvent(cost)) return;
      (L.annex ||= {})[k] = annexBase(to, +b.dataset.annexZone);
      adminInvalidate();
      state.log.unshift(`${state.year}년 ${c.name}, ${c.region}에서 ${to}로 편입`);
      if (nGu > 1) { makeBungu(k, nGu); drawBungu(); }
      holdElection([to, c.region], `${to} 시군 편입 선거`);
      syncMayors();   // 편입한 시·군은 구: 시장·군수 → 구청장
      refreshNames(map);
      save(state); renderAll();
      if (nGu > 1) guNamingDialog(k);
    };
  });
  el.querySelectorAll('[data-ev-city]').forEach((b) => {
    b.onclick = () => {
      const c = b.dataset.evCity;
      if (!confirm(`${c}를 ${metroName(c)}로 ${L.historic && HISTORIC_CITIES.includes(c) ? '독립' : '승격'}할까요? 도에서 떨어져 나와 광역 단체가 되고, 시장·도지사를 다시 뽑습니다. ${formatWon(EVENT_COST.independence)}`)) return;
      if (!payEvent(EVENT_COST.independence)) return;
      // 도시가 빠진 도와 새 광역시의 단체장을 다시 뽑는다
      const zc = zoneProps.find((z) => z.province === c || promotedName(state, z) === c);   // 군에서 승격한 시도
      const parent = zc ? regionOf(state, zc) : null;
      L.independent.push(c);
      adminInvalidate();
      const nGu = +(el.querySelector('#bungu-n')?.value || 1);
      const old = zc && L.bungu?.[unitId(state, zc)];
      if (old?.general) { if (nGu > 1) delete L.bungu[unitId(state, zc)]; else delete old.general; }   // 일반구 → 자치구 (구청장 선거)
      if (nGu > 1) makeBungu(c, nGu);
      drawBungu();
      holdElection([metroName(c), parent].filter(Boolean), `${metroName(c)} ${L.historic ? '독립' : '광역시 승격'} 선거`);
      syncMayors();   // 승격한 도시 자체(한 존)는 중구가 된다: 시장 → 중구청장
      refreshNames(map);
      save(state); renderAll();
      if (nGu > 1) guNamingDialog(c);
    };
  });
}

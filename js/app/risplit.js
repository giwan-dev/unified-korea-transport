// 남측 법정리 편입: 계산 단위는 읍면동이고, 리를 맞닿은 시·광역시로 편입할 때만 그 리를 읍면동에서 떼어 새 소구역으로 만든다.
// 법정리 15,000여 곳을 모두 계산 단위로 하면 소구역이 2.6배로 늘어 해 넘기기가 무거워지므로, 편입한 리만 뗀다.
// - 새 소구역은 자료 소구역(국외 존 포함) 뒤 번호를 받는다. subsFC.features에도 그 번호 자리에 리 경계를 넣고,
//   그 사이 국외 존 번호는 도형 없는 자리 채움으로 메운다 (번호로 도형·이름을 읽는 코드가 그대로 돈다).
// - 계산 워커의 모형은 존마다 소구역 번호가 이어져야 해서, 워커와 주고받을 때만 번호를 바꿔 끼운다 (toModel*/fromModel*).
// - 리 인구는 읍면동 인구 × 법정리 몫(data/kr_ri.json)으로 떼고, 그 뒤 인구 이동은 새 소구역 기준이다.
// - 떼어 낸 리는 state.local.riSplit(법정리 코드, 뗀 순서)에 남는다. 다시 열면 같은 순서로 다시 뗀다.
import { grid, map, result, setGridSent, setSubPop0, state, subsFC, worker, zoneProps } from './core.js';
import { inRing, resetGridEff, housingPartsMemo, effectiveGrid } from './housing.js';
import { krRiReady, loadRiFiles, riCodeMap, riFeat, subInfo } from './mapdata.js';
import { adminInvalidate, subNbCache } from './region.js';
import { ctx } from './year.js';
import { setBusy } from './panels.js';

export let extraSubs = [];   // [{g, code, parent, zone, name, share, x, y, area, feature}] (번호 순)
let subBase = 0;             // 자료 소구역 수 (국외 존 포함): 새 소구역 번호는 여기서부터
let m2g = null, g2m = null;  // 모형 번호 → 전체 번호, 전체 번호 → 모형 번호 (떼어 낸 리가 없으면 null: 같다)

/** 자료 소구역 수 (국외 존 포함) */
function baseCount() {
  if (!subBase) subBase = zoneProps.reduce((n, z) => n + z.subs.length, 0);
  return subBase;
}

/** 떼어 낸 리 소구역이면 그 정보 */
export function extraOf(i) { return i >= baseCount() ? extraSubs[i - subBase] || null : null; }
/** 이 존(원래 읍면동의 존)에서 떼어 낸 리 소구역 번호들 */
export function extrasOfZone(z) { return extraSubs.filter((e) => e.zone === z).map((e) => e.g); }
/** 이 읍면동에서 떼어 낸 리들 */
export function extrasOfParent(p) { return extraSubs.filter((e) => e.parent === p); }
/** 법정리 코드 → 떼어 낸 소구역 번호 (안 뗐으면 -1) */
export function splitSubOf(code) { return extraSubs.find((e) => e.code === code)?.g ?? -1; }
/** 소구역 중심 [경도, 위도] (자료 소구역은 zones.json, 떼어 낸 리는 경계 가운데) */
export function subXY(i) {
  const e = extraOf(i);
  if (e) return [e.x, e.y];
  const [z, k] = subInfo(i);
  return zoneProps[z].subs[k];
}

/** 리 추정 인구: 뗀 리는 그 소구역 인구, 아니면 읍면동 인구 × 몫 (뗀 리가 있는 읍면동은 남은 몫으로 나눈다) */
export function riPopOf(code, pop = result?.subs.pop) {
  const r = riCodeMap?.get(code);
  if (!r || !pop) return 0;
  const g = splitSubOf(code);
  if (g >= 0) return pop[g] || 0;
  const cut = extrasOfParent(r.sub).reduce((t, e) => t + e.share, 0);
  return (pop[r.sub] * r.share) / Math.max(1 - cut, 0.05);
}

/** 모형 순서: 존마다 자료 소구역, 이어서 그 존에서 뗀 리 (뗀 순서) */
function rebuildOrder() {
  if (!extraSubs.length) { m2g = g2m = null; return; }
  const out = [];
  zoneProps.forEach((z, zi) => {
    for (let k = 0; k < z.subs.length; k++) out.push(z.sub0 + k);
    for (const e of extraSubs) if (e.zone === zi) out.push(e.g);
  });
  m2g = Int32Array.from(out);
  g2m = new Int32Array(out.length);
  out.forEach((g, m) => { g2m[g] = m; });
}

/** 전체 번호 → 모형 번호 */
export function toModelSub(i) { return g2m ? g2m[i] : i; }

/** 격자(경도, 위도, 인구, 소구역)의 소구역을 모형 번호로 (떼어 낸 리가 없으면 그대로) */
export function toModelGrid(g) {
  if (!g2m) return g;
  const out = Float32Array.from(g);
  for (let c = 3; c < out.length; c += 4) out[c] = g2m[out[c]];
  return out;
}

/** 워커 결과의 읍면동 배열(모형 순서)을 전체 번호 순서로 */
export function fromModelSubs(subs) {
  if (!m2g || !subs) return subs;
  const out = {};
  for (const [k, arr] of Object.entries(subs)) {
    if (!arr?.length || arr.length !== m2g.length) { out[k] = arr; continue; }
    const o = new arr.constructor(arr.length);
    for (let m = 0; m < arr.length; m++) o[m2g[m]] = arr[m];
    out[k] = o;
  }
  return out;
}

/** 워커에 넘길 존: 리를 뗀 존은 원래 읍면동 몫을 줄이고 뗀 리를 소구역으로 덧붙인다 ([경도, 위도, 몫, 넓이]) */
export function workerZones() {
  if (!extraSubs.length) return zoneProps;
  return zoneProps.map((z, zi) => {
    const ex = extraSubs.filter((e) => e.zone === zi);
    if (!ex.length) return z;
    const subs = z.subs.map((s) => s.slice());
    for (const e of ex) {
      const p = subs[e.parent - z.sub0], w = z.subs[e.parent - z.sub0][2];
      p[2] -= w * e.share;
      if (p[3] != null) p[3] = Math.max(0.05, p[3] - e.area);
      subs.push([e.x, e.y, w * e.share, e.area]);
    }
    return { ...z, subs };
  });
}

/** 리 하나를 떼어 낸 소구역으로 등록한다 (경계를 받은 뒤). 격자 칸 중 리 경계 안의 원래 읍면동 칸을 새 소구역으로 옮긴다 */
function addExtra(code) {
  const r = riCodeMap?.get(code), f = riFeat.get(code);
  if (!r || !f) return null;
  const g = baseCount() + extraSubs.length, [zone] = subInfo(r.sub);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const inside = (x, y) => polys.some((pg) => inRing(x, y, pg[0]) && !pg.slice(1).some((h) => inRing(x, y, h)));
  // 가운데: 경계 안 격자 칸의 인구 가중 (칸이 없으면 바깥 고리 꼭짓점 평균)
  let sx = 0, sy = 0, sw = 0, cells = 0;
  for (let c = 0; c < grid.length; c += 4) {
    if (grid[c + 3] !== r.sub || !inside(grid[c], grid[c + 1])) continue;
    grid[c + 3] = g;
    const w = Math.max(grid[c + 2], 1e-3);
    sx += grid[c] * w; sy += grid[c + 1] * w; sw += w; cells++;
  }
  if (!sw) {
    const ring = polys[0][0];
    for (const [x, y] of ring) { sx += x; sy += y; sw++; }
  }
  const feature = { type: 'Feature', id: g, properties: { id: g, zone, name: r.name, ri: code }, geometry: f.geometry };
  const e = { g, code, parent: r.sub, zone, name: r.name, share: r.share, x: sx / sw, y: sy / sw, area: f.properties.area || 0.1, cells, feature };
  extraSubs.push(e);
  return e;
}

/** 리를 뗀 뒤 함께 맞출 것: 번호 순서, 시작 인구, 지도 자료, 소속표·맞닿음·격자 기억 */
function afterSplit() {
  rebuildOrder();
  // 시작 인구: 원래 읍면동 몫에서 리 몫을 뗀다 (변화율이 리를 뗀 만큼 줄어 보이지 않게)
  const p0 = zoneProps.flatMap((zp) => zp.subs.map((s) => s[2] * zp.pop));
  for (const e of extraSubs) { p0[e.g] = p0[e.parent] * e.share; }
  for (const e of extraSubs) p0[e.parent] -= p0[e.g];
  setSubPop0(p0);
  // 체감 개선의 기준(시작 접근 시간): 새 소구역은 원래 읍면동 값을 잇는다
  const b = state.subBase;
  if (b?.t) for (const e of extraSubs) if (b.t.length === e.g) { b.t.push(b.t[e.parent]); b.r.push(b.r[e.parent]); }
  padSubsFC();
  subNbCache.clear();
  housingPartsMemo.clear();
  resetGridEff();
  adminInvalidate();
}

/** subsFC에 국외 존 자리 채움과 떼어 낸 리 경계를 넣는다 (번호 = 배열 자리) */
export function padSubsFC() {
  if (!subsFC) return;
  const fs = subsFC.features, n = baseCount();
  while (fs.length < n) fs.push({ type: 'Feature', id: fs.length, properties: { id: fs.length, zone: subInfo(fs.length)?.[0] ?? -1, name: '' }, geometry: null });
  for (const e of extraSubs) fs[e.g] = e.feature;
}

/** 지도 'subs' 자료: 도형이 있는 것만 (국외 존 자리 채움은 뺀다) */
export function subsMapData() {
  return subsFC ? { type: 'FeatureCollection', features: subsFC.features.filter((f) => f.geometry) } : { type: 'FeatureCollection', features: [] };
}

/** 리 경계 파일을 받는다 (원래 읍면동 둘레) */
async function loadRiFor(codes) {
  for (const code of codes) {
    const r = riCodeMap?.get(code);
    if (!r || riFeat.has(code)) continue;
    const [x, y] = subXY(r.sub);
    await loadRiFiles(x - 0.05, y - 0.05, x + 0.05, y + 0.05);
  }
}

/** 저장 게임을 열 때: 떼어 둔 리를 같은 순서로 다시 뗀다 (계산 워커를 띄우기 전에) */
export async function prepareRiSplits() {
  const codes = state.local?.riSplit || [];
  if (!codes.length) return;
  await krRiReady;
  await loadRiFor(codes);
  const kept = [];
  for (const code of codes) if (addExtra(code)) kept.push(code);
  if (kept.length !== codes.length) state.local.riSplit = kept;   // 자료가 바뀌어 찾지 못한 리는 놓는다
  afterSplit();
}

/**
 * 게임 중 리 하나를 뗀다: 소구역 구성이 바뀌므로 계산 워커가 모형을 새로 만들고(존 상태·교통량은 그대로) 결과를 다시 보낸다.
 * @returns {Promise<number>} 새 소구역 번호 (못 떼면 -1)
 */
export async function splitRi(code) {
  const had = splitSubOf(code);
  if (had >= 0) return had;
  await krRiReady;
  await loadRiFor([code]);
  const oldG2M = g2m, oldN = baseCount() + extraSubs.length;
  const e = addExtra(code);
  if (!e) return -1;
  (state.local.riSplit ||= []).push(code);
  afterSplit();
  // 모형 번호마다 예전 모형 번호와 몫: 새 리는 원래 읍면동에서 몫만큼, 원래 읍면동은 남은 몫만큼
  const oldM = (g) => (g >= oldN ? -1 : oldG2M ? oldG2M[g] : g);
  const cutBefore = extrasOfParent(e.parent).filter((x) => x.g !== e.g).reduce((t, x) => t + x.share, 0);
  const from = new Int32Array(m2g.length), factor = new Float64Array(m2g.length);
  for (let m = 0; m < m2g.length; m++) {
    const g = m2g[m];
    if (g === e.g) { from[m] = oldM(e.parent); factor[m] = e.share / Math.max(1 - cutBefore, 0.05); }
    else if (g === e.parent) { from[m] = oldM(g); factor[m] = (1 - cutBefore - e.share) / Math.max(1 - cutBefore, 0.05); }
    else { from[m] = oldM(g); factor[m] = 1; }
  }
  // 워커 결과가 오기 전까지 화면이 쓸 어림: 원래 읍면동 값을 나눈다
  if (result?.subs) {
    const s = result.subs, grow = (arr, v) => { const o = new arr.constructor(arr.length + 1); o.set(arr); o[arr.length] = v; return o; };
    const pp = s.pop[e.parent] || 0, f = e.share / Math.max(1 - cutBefore, 0.05);
    s.pop = grow(s.pop, pp * f); s.pop[e.parent] = pp * (1 - f);
    s.transit = grow(s.transit, s.transit[e.parent]); s.rail = grow(s.rail, s.rail[e.parent]);
  }
  if (map?.getSource('subs')) map.getSource('subs').setData(subsMapData());
  const eff = effectiveGrid();
  setGridSent(eff);
  setBusy(true, `${e.name}를 따로 계산하는 중`, 0);
  worker.postMessage({
    type: 'resub', zones: workerZones(), grid: toModelGrid(grid).buffer.slice(0), gridEff: eff !== grid ? toModelGrid(eff).buffer.slice(0) : null,
    from, factor, ctx: ctx(),
  });
  return e.g;
}

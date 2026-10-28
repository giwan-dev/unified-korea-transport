// 경제특구 지정과 역·IC 이름 짓기(namer).
import { formatWon } from '../game/catalog.js';
import { Namer } from '../game/naming.js';
import { canAfford, cleanLineName, linkAt, save, splitLink, startProject } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { base, map, namer, places, setNamer, state, zoneProps } from './core.js';
import { zoneName } from './year.js';
import { allLinks, kpFix, nodeCoord, refreshLinks, refreshPoints, shownStation } from './mapdata.js';
import { hallsNear, univStationNames } from './univ.js';
import { select } from './interact.js';
import { renderAll } from './panels.js';
import { railStationSet } from './svc.js';
import { stationNameHints } from './gazette.js';

// ------------------------------------------------------------ 경제특구

export const SEZ = { cost: 10000, years: 3, max: 5 };
export function sezHTML(i) {
  const z = zoneProps[i];
  if (z.ext || z.country !== 'KP') return '';
  const cur = (state.sez || []).find((s) => s.zone === i);
  if (cur) return `<h4>경제특구</h4><p class="hint">${cur.done ? `${cur.year}년 지정 · 소득이 빨리 오르고 일자리를 찾아 사람이 모입니다.` : `조성 중 (${cur.year + SEZ.years}년 지정)`}</p>`;
  const n = (state.sez || []).length;
  return `<h4>경제특구</h4><p class="hint">외국인·남측 기업 투자를 받는 특구로 지정합니다. 소득 수렴이 빨라지고(×1.8, 목표 +15%) 사람이 모여듭니다. 교통이 좋은 곳일수록 효과가 큽니다.</p>
    <button class="small primary" data-sez="${i}" ${n >= SEZ.max ? 'disabled' : ''}>경제특구 지정 · ${formatWon(SEZ.cost)} · ${SEZ.years}년${n >= SEZ.max ? ` (최대 ${SEZ.max}곳)` : ''}</button>`;
}
export function startSEZ(i) {
  if (!canAfford(state, SEZ.cost, SEZ.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const id = crypto.randomUUID();
  (state.sez ||= []).push({ id, zone: i, year: state.year, done: false });
  startProject(state, { id, kind: 'sez', links: [], stations: [], cost: SEZ.cost, years: SEZ.years, label: `${zoneName(i)} 경제특구 조성` });
  save(state); renderAll(); select({ type: 'zone', id: i });
}
export function settleSEZ(done) {
  const ids = new Set(done.filter((p) => p.kind === 'sez').map((p) => p.id));
  for (const s of state.sez || []) {
    if (!ids.has(s.id) || s.done) continue;
    s.done = true;
    state.integration = Math.min(1, state.integration + 0.01);
    state.log.unshift(`${state.year}년 ${zoneName(s.zone)} 경제특구 지정 (남북 통합도 +1%p)`);
  }
}

/**
 * 평양 지하철 천리마선·혁신선을 평양 도시철도 1·2호선으로 (통일 뒤 남측 도시철도처럼 번호로 부른다). 새 게임·예전 저장 모두.
 * 게임에서 놓은 '평양 지하철 N호선'도 같이
 */
export const PY_METRO = { 천리마선: '평양 도시철도 1호선', 혁신선: '평양 도시철도 2호선' };
export function renamePyongyangMetro() {
  const to = (n) => PY_METRO[n] || (/^평양 지하철 \d+호선$/.test(n || '') ? n.replace('평양 지하철', '평양 도시철도') : null);
  let n = 0;
  base.links.forEach((l, i) => {
    const cur = state.overrides[i]?.name ?? l.name, nw = l.mode === 2 && to(cur);
    if (nw) { state.overrides[i] = { ...(state.overrides[i] || {}), name: nw }; n++; }
  });
  for (const l of state.newLinks) { const nw = l.mode === 2 && to(l.name); if (nw) { l.name = nw; n++; } }
  for (const sv of state.services || []) {
    if (to(sv.line)) sv.line = to(sv.line);
    if (sv.lines) sv.lines = [...new Set(sv.lines.map((x) => to(x) || x))];
    if (sv.name) for (const [a, b] of Object.entries(PY_METRO)) sv.name = sv.name.replace(a, b);
  }
  for (const p of state.projects || []) if (p.label) p.label = p.label.replace(/평양 지하철 (\d+)호선/g, '평양 도시철도 $1호선');
  if (n && !state.pyMetroRenamed) state.log.unshift(`${state.year}년 평양 지하철 천리마선·혁신선을 평양 도시철도 1·2호선으로 부릅니다.`);
  state.pyMetroRenamed = true;
}

export function resetNamer() {
  const existing = [
    ...base.stations.map(([name]) => ({ name, kind: 'station' })),
    ...(base.metro_stations || []).map(([name]) => ({ name, kind: 'station' })),
    ...base.junctions.map(([name]) => ({ name, kind: 'IC' })),
    ...Object.values(state.names).map((v) => ({ name: v.name, kind: v.kind })),
  ];
  // 행정구역 정리로 바뀌어 보이는 북측 역 이름도 쓰이는 이름으로 친다 (새 역이 '성진역'을 또 받지 않도록)
  for (const [name, node] of [...base.stations, ...(base.metro_stations || [])]) { const v = shownStation(name, node); if (v !== name) existing.push({ name: v, kind: 'station' }); }
  setNamer(new Namer(places, existing));
  namer.stationHints = stationNameHints;
  namer.fix = (name, lon, lat) => kpFix(name, lon, lat);
  namer.hallHints = (lon, lat) => [...hallsNear(lon, lat), ...univStationNames(lon, lat)];
  renameNumbered();
  if (state) addOngoingStations().then((n) => { if (n) { save(state); if (map?.getSource('links')) refreshLinks(); } });
}

/**
 * OSM 공사 중 노선 가운데 중간역이 빠진 곳(대장홍대선·7호선 청라연장 등은 긴 구간 하나로만 올라와 개통하면 중간역 없이 열렸다)에
 * 실제 계획 역 자리(data/ongoing_stations.json: 공식 계획·위키백과·OSM에서 확인한 역 이름과 위치)를 넣는다.
 * 그 자리에서 공사 중 구간을 나눠 사업에 붙이고, 개통하면 역이 함께 연다. 이미 역이 있는 자리(500m 안)와 노선에서 1km 넘게 떨어진 자리는 건너뛴다. 사업마다 한 번
 */
export async function addOngoingStations() {
  const data = await fetch('data/ongoing_stations.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data?.lines) return 0;
  let added = 0;
  const stSet = new Set([...railStationSet(), ...(base.metro_stations || []).map(([, n]) => n)]);
  const ptsOf = (id) => { const g = allLinks()[id]?.geom || [], out = []; for (let q = 0; q < g.length; q += 2) if (!Number.isNaN(g[q])) out.push([g[q], g[q + 1]]); return out; };
  const distTo = (pts, x, y) => {
    let bd = Infinity;
    for (let j = 0; j + 1 < pts.length; j++) {
      const [x1, y1] = pts[j], [x2, y2] = pts[j + 1], dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      bd = Math.min(bd, kmBetween(x, y, x1 + t * dx, y1 + t * dy));
    }
    return bd;
  };
  for (const p of state.projects) {
    if (p.kind !== 'osm' || p.status !== 'building' || p.autoStations) continue;
    const l0 = linkAt(base, state, p.links[0]);
    const line = l0 && data.lines[cleanLineName(l0.name)];
    if (!line) continue;
    p.autoStations = true;
    let n0 = added;
    for (const [name, x, y] of line.stations) {
      // 이미 역이 있는 자리(양 끝 기존역 등)는 건너뛴다
      const nodes = new Set(p.links.flatMap((id) => { const l = linkAt(base, state, id); return [l.a, l.b]; }));
      if ([...nodes].some((n) => stSet.has(n) && kmBetween(x, y, ...nodeCoord(n)) < 0.5) || [...nodes].some((n) => kmBetween(x, y, ...nodeCoord(n)) < 0.3)) continue;
      let best = null, bd = 1;
      for (const id of p.links) { const d = distTo(ptsOf(id), x, y); if (d < bd) { bd = d; best = id; } }
      if (best == null) continue;
      const node = splitLink(base, state, best, x, y);
      const a = state.newLinks[state.newLinks.length - 2], b = state.newLinks[state.newLinks.length - 1];
      a.built = false; b.built = false;   // 개통할 때 연다
      p.links = p.links.flatMap((id) => (id === best ? [a.id, b.id] : [id]));
      p.stations = [...(p.stations || []), node];
      const nm = /역$/.test(name) ? name : `${name}역`;
      (p.newNames ||= {})[node] = { name: nm, kind: 'station', auto: false };
      namer?.take?.(nm, 'station');
      added++;
    }
    if (added > n0) state.log.unshift(`${state.year}년 ${cleanLineName(l0.name)}: 공사 자료에 빠진 계획 역 ${added - n0}곳을 넣었습니다`);
  }
  return added;
}

/** 예전 판이 겹치는 자동 이름에 번호를 붙인 것(○○2역·○○3IC)을 붙임말 이름(서○○역·○○입구역 등)으로 바꾼다. 직접 지은 이름은 그대로 */
export function renameNumbered() {
  const done = [];
  for (const [k, v] of Object.entries(state.names || {})) {
    if (!v.auto || !/[가-힣]\d+(역|IC|JCT|휴게소)$/.test(v.name)) continue;
    const c = nodeCoord(+k);
    if (!c) continue;
    namer.release(v.name, v.kind);
    const nw = namer.suggest(c[0], c[1], v.kind);
    done.push(`${v.name} → ${nw}`);
    v.name = nw;
  }
  if (!done.length) return;
  state.log.unshift(`${state.year}년 번호를 붙였던 자동 이름 ${done.length}곳을 바꿨습니다: ${done.slice(0, 5).join(', ')}${done.length > 5 ? ' 등' : ''}`);
  save(state);
  if (map) refreshPoints();
}

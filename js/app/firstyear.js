// 통일 첫해 행정구역 정리 (게임 시작 창).
import { ADMIN_DEFAULT, ADMIN_OPTIONS, adminNames, governorTitle, HISTORIC_COUNTIES, initLocal, normalizeUnitKeys, regionOf } from '../game/local.js';
import { pShare } from '../game/sentiment.js';
import { save, START_YEAR } from '../game/state.js';
import { t } from '../i18n.js';
import { P } from '../sim/params.js';
import { guideShouldAutoShow } from '../ui/guide.js';
import { colorFor, refreshNames } from '../ui/map.js';
import { GOALS } from '../ui/report.js';
import { openAdminSetup } from '../ui/setup.js';
import { draft, esc, historic, map, metric, namer, result, state, subPop0, zoneProps } from './core.js';
import { resetNamer } from './sez.js';
import { paintZones, refreshPoints } from './mapdata.js';
import { admin, adminInvalidate } from './region.js';
import { drawUnivs, univList, univPersonRename, univs } from './univ.js';
import { renderAll, showGuide } from './panels.js';
import { countyRep, countyZones, guKey, holdElection, mayorKey, officeLine, regions, supportHTML, syncMayors } from './election.js';
import { guSubs, guUnits, loadGuUnits, unitZones } from './bungu.js';

// ------------------------------------------------------------ 통일 첫해 행정구역 정리 (게임 시작 창)

// 북측 도 체계는 행정구역 정리 창의 한 칸 (예전에는 따로 돈을 내는 이벤트였다)
export const HISTORIC_PROV = { key: '_historic', label: '북측 도 체계', choices: [['keep', '지금 북측 도 그대로 (자강·량강·평양 등)'], ['historic', '1945년 이전 도로 되돌린다 (강원북도·강원남도, 개성은 경기도)']] };
export const HIST_KEYS = new Set(HISTORIC_COUNTIES.map((h) => h.key));

export function needsAdminSetup() {
  return state.year === START_YEAR && !state.local?.adminDecided;
}

/** 행정구역 정리 창. first: 게임을 막 시작한 때 (닫으면 사용법 안내로 이어진다) */
export function adminSetup(first) {
  const L = initLocal(state);
  const cur = { ...ADMIN_DEFAULT, ...(L.admin || {}), _historic: L.historic ? 'historic' : 'keep', _goal: state.goal || 'none' };
  const pick = (keys) => ADMIN_OPTIONS.filter((o) => keys.includes(o.key));
  openAdminSetup({
    esc, current: cur, defaults: { ...ADMIN_DEFAULT, _historic: 'keep', _goal: 'none' },
    title: t(`${START_YEAR}년, 통일 첫해 행정구역 정리`, `${START_YEAR}: administrative boundaries after reunification`),
    intro: t('남과 북의 행정구역을 어떻게 맞출지 지금 정합니다. 비용은 들지 않고, 정한 뒤에도 '
      + `${START_YEAR}년 안에는 민원·정책 탭에서 다시 고칠 수 있습니다. 다음 해로 넘기면 그대로 굳습니다. 소속 광역 단체가 바뀐 곳은 단체장을 새로 뽑습니다.`,
    `Decide how to merge the administrative divisions of North and South. It is free, and you can change it from the Policy tab until the end of ${START_YEAR}; after that it is fixed. Provinces whose make-up changes elect new governors. (Place names stay in Korean.)`),
    okLabel: first ? t('정하고 시작하기', 'Confirm and start') : t('이대로 정리', 'Apply'),
    groups: [
      { title: t('이번 판의 목표', 'Goal for this game'), hint: t(`통일 10년째(${START_YEAR + 10}년) 결산에서 달성했는지 봅니다. 현황 탭에서 진행 상황을 볼 수 있습니다.`, `Checked in the ${START_YEAR + 10} summary, ten years after reunification. Track progress in the Overview tab.`),
        options: [{ key: '_goal', label: t('목표', 'Goal'), choices: Object.entries(GOALS).map(([k, g]) => [k, g.label]) }] },
      { title: t('남북 정리', 'North–South'), options: pick(['kaesong', 'propaganda', 'workers', 'ongjin', 'goseong', 'dueum', 'guyeok', 'univ']) },
      { title: t('북측 도 체계', 'Northern provinces'), options: [HISTORIC_PROV, ...pick(['jagang'])] },
      { title: t('분단 전 군 되살리기', 'Restore pre-division counties'), hint: t('분단으로 갈라지거나 없어진 군입니다. 되살리면 그 군에 속했던 읍면이 옛 군 이름으로 한 도에 묶입니다.', 'Counties split or abolished by the division. Restoring one regroups its old townships under the old name in one province.'),
        options: ADMIN_OPTIONS.filter((o) => HIST_KEYS.has(o.key)) },
    ],
    onApply: (c) => {
      const { _historic: hist, _goal: goal, ...admin } = c;
      state.goal = goal;
      const was = cur;
      const changed = ADMIN_OPTIONS.filter((o) => admin[o.key] !== was[o.key]);
      const histChanged = (hist === 'historic') !== !!L.historic;
      const lines = changed.map((o) => o.choices.find((x) => x[0] === admin[o.key])[1]);
      if (histChanged) lines.push(hist === 'historic' ? '북측 도를 1945년 이전으로' : '북측 도를 지금대로');
      if (lines.length) {
        reorganize(() => {
          setAdmin(admin);
          if (histChanged) {
            // 1945년 이전 도로 되돌리면 북측 주민 행복도가 조금 오른다 (되돌리면 그만큼 뺀다)
            const d = hist === 'historic' ? 3 : -3;
            zoneProps.forEach((z, i) => { if (z.country === 'KP' && !z.ext) state.happyBonus[i] = (state.happyBonus[i] || 0) + d; });
            L.historic = hist === 'historic';
            adminInvalidate();
          }
        }, `${state.year}년 행정구역 정리: ${lines.join(', ')}`);
        refreshNames(map);
        refreshPoints();   // 북측 역 이름도 정리를 따른다 (김책역 → 성진역)
        if (namer && !draft) resetNamer();
      }
      L.adminDecided = true;
      save(state); renderAll();
      if (first && guideShouldAutoShow()) setTimeout(showGuide, 300);
    },
    onClose: first ? null : () => {},
  });
}

/** 민원·정책 탭: 정한 행정구역 (첫해에는 다시 정하기 단추) */
export function adminSummaryHTML() {
  const L = initLocal(state);
  const A = { ...ADMIN_DEFAULT, ...(L.admin || {}) };
  const chosen = ADMIN_OPTIONS.filter((o) => A[o.key] !== ADMIN_DEFAULT[o.key]).map((o) => `${esc(o.label.replace(/ \(.*\)$/, ''))}: ${esc(o.choices.find((c) => c[0] === A[o.key])?.[1] || '')}`);
  if (L.historic) chosen.unshift('북측 도: 1945년 이전으로 되돌림 (강원북도·강원남도)');
  const open = state.year === START_YEAR;
  return `<div class="item"><div class="t">남북 행정구역 정리 (${START_YEAR}년)</div>
    <div class="m">${chosen.length ? chosen.join('<br>') : '모두 지금 행정구역 그대로 두었습니다.'}</div>
    ${open ? `<button class="small primary" id="ev-admin">다시 정하기 (${START_YEAR}년 안에만)</button>` : `<p class="hint">행정구역은 통일 첫해(${START_YEAR}년)에 정했습니다.</p>`}</div>`;
}

/** 행정구역 정리 적용: 소속은 regionOf가, 이름은 state.adminNames가 맡는다 */
export function setAdmin(admin) {
  initLocal(state).admin = { ...ADMIN_DEFAULT, ...admin };
  state.adminNames = adminNames(state.local.admin, zoneProps, historic);
  adminInvalidate();
  normalizeUnitKeys(state, zoneProps);
  applyUnivAdmin();
}

/** 행정구역 정리의 '북측 인물 이름 대학' 항목: 지명 이름으로 하면 한꺼번에 바꾸고(비용 없음), 그대로 두면 그렇게 바꾼 이름을 되돌린다 */
export function applyUnivAdmin() {
  if (!univs.length || !state?.local) return;
  const on = state.local.admin?.univ === 'restore';
  for (const u of univList()) {
    if (u.isNew || u.country !== 'KP') continue;
    const to = univPersonRename({ ...u, name: u.orig });
    if (!to) continue;
    if (on && !state.univNames?.[u.orig]) (state.univNames ||= {})[u.orig] = to;
    else if (!on && state.univNames?.[u.orig] === to && state.univAuto?.includes(u.orig)) delete state.univNames[u.orig];
    if (on) state.univAuto = [...new Set([...(state.univAuto || []), u.orig])];
  }
  if (!on) state.univAuto = [];
  if (map) drawUnivs();
}

/** 광역 단체 구성을 바꾸고, 구성(소속 시군구)이 바뀐 단체만 단체장을 새로 뽑는다.
 *  이름만 바뀐 단체(강원특별자치도 → 강원남도)는 단체장을 그대로 이어 간다 */
export function reorganize(change, logMsg) {
  const L = state.local;
  const key = (m) => new Map([...m].map(([r, zs]) => [r, zs.join(',')]));
  const before = key(regions());
  change();
  // 이름만 바뀐 단체(강원특별자치도 → 강원남도)는 단체장을 그대로 이어 간다
  const byZones = new Map([...before].map(([r, zs]) => [zs, r]));
  const changed = [];
  for (const [r, zs] of key(regions())) {
    if (before.get(r) === zs) continue;
    const old = byZones.get(zs), off = old && L.offices[`g:${old}`];
    if (off) {
      L.offices[`g:${r}`] = { ...off, region: r, title: governorTitle(r) };
      delete L.offices[`g:${old}`];
      for (const pr of L.proposals || []) if (pr.office === `g:${old}`) pr.office = `g:${r}`;
    } else changed.push(r);
  }
  for (const k of Object.keys(L.offices)) if (k.startsWith('g:') && !regions().has(k.slice(2))) delete L.offices[k];
  holdElection(changed, '행정구역 개편 뒤 광역단체장 선거');
  syncMayors();
  if (result && map) paintZones();   // 한 시군 한 색: 묶음이 바뀌었다
  state.log.unshift(logMsg);
  save(state); renderAll();
}

/** 존 패널: 광역·기초 단체장 */
export function localZoneHTML(i) {
  const z = zoneProps[i];
  if (z.ext) return '';
  const L = state.local, r = regionOf(state, z);
  return `<h4>지방자치 · ${esc(r)}</h4>
    <div class="m" style="margin:2px 0">${officeLine(L.offices[`g:${r}`])}</div>
    <div class="m" style="margin:2px 0">${officeLine(L.offices[mayorKey(i)])}</div>
    ${supportHTML(i)}`;
}

/** 정당 지도 값: 국민의힘 1, 민주당 0, 미시행 null */
export function partyValue(i, level) {
  const L = state.local, z = zoneProps[i];
  return officeParty(level === 'gov' ? L.offices[`g:${regionOf(state, z)}`] : L.offices[mayorKey(i)]);
}
/** 단체장 자리의 정당 지도 값 (관선 5) */
export function officeParty(off) {
  if (!off) return null;
  return off.appointed ? 5 : ({ D: 0, P: 1, R: 2, J: 3, I: 4 }[off.party] ?? null);   // map.js PARTY_MAP 순서
}

/**
 * 분구한 시군은 구마다 구청장이 따로라, 기초단체장 지도(정당·득표율·지지율)를 구마다 그 구청장 값으로 칠한다
 * (시군 색은 가운데 구 구청장 것이라 다른 구의 선거 결과가 지도에 보이지 않았다). 일반구는 시장 하나라 그대로
 */
export const GU_METRIC = { partyMayor: officeParty, voteMayor: (o) => pShare(o), mayorApproval: (o) => o?.approval ?? null };
/** 구마다 칠하는 인구 지표 (구의 읍면동 인구로): 일반구도 (예전에는 광역시 승격 뒤 분구해도 시군구 인구가 광역시 전체로 나왔다) */
export const GU_POP = { pop: (p) => p, popChange: (p, p0) => p / Math.max(p0, 1) - 1 };
export var guMetricLoading = false;
export function drawGuMetric() {
  if (!map?.getSource('zones')) return;
  if (!map.getSource('gu-metric')) {
    map.addSource('gu-metric', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'gu-metric-fill', type: 'fill', source: 'gu-metric', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55, 'fill-antialias': false } }, map.getLayer('zones-line') ? 'zones-line' : undefined);
  }
  const f = GU_METRIC[metric], fp = result ? GU_POP[metric] : null, feats = [];
  if ((f || fp) && state.local?.bungu) {
    let missing = false;
    const drawn = new Set();
    for (const [unit, b] of Object.entries(state.local.bungu)) {
      if (b.general && !fp) continue;
      for (const r of new Set(unitZones(unit).map((z) => countyRep(z)))) {
        if (drawn.has(r)) continue;   // 한 시군을 두 분구 단위가 가리키면 두 번 칠해 진해졌다
        drawn.add(r);
        if (countyZones(r).some((z) => admin()?.mixed.has(z))) continue;   // 소속이 바뀐 존은 읍면동 단위 색칠(drawAdminFill)이 맡는다
        const us = guUnits.get(r);
        if (!us) { missing = true; continue; }
        const popOf = new Map();
        if (fp) for (const g of new Set(us.map((u) => u.gu))) { const ss = guSubs(r, g); popOf.set(g, fp(ss.reduce((t, i) => t + result.subs.pop[i], 0), ss.reduce((t, i) => t + (subPop0[i] || 0), 0))); }
        for (const u of us) {
          const c = colorFor(metric, fp ? popOf.get(u.gu) : f(state.local.offices[guKey(r, u.gu)]));
          for (const poly of u.polys) feats.push({ type: 'Feature', properties: { color: c }, geometry: { type: 'Polygon', coordinates: poly } });
        }
      }
    }
    if (missing && !guMetricLoading) {
      const b = map.getBounds(), inView = new Set();
      for (const u of Object.keys(state.local.bungu)) for (const z of unitZones(u)) if (zoneProps[z].subs.some(([x, y]) => x >= b.getWest() && x <= b.getEast() && y >= b.getSouth() && y <= b.getNorth())) inView.add(countyRep(z));
      if (inView.size) {
        guMetricLoading = true;
        const before = guUnits.size;
        loadGuUnits(inView).then(() => { guMetricLoading = false; if (guUnits.size !== before && result) paintZones(); });
      }
    }
  }
  // 시군 색칠과 같은 투명도 (위성 사진 배경에서는 시군 색칠이 옅어지는데 구 색만 진했다)
  map.setPaintProperty('gu-metric-fill', 'fill-opacity', map.getPaintProperty('zones-fill', 'fill-opacity') ?? 0.55);
  map.getSource('gu-metric').setData({ type: 'FeatureCollection', features: feats });
}

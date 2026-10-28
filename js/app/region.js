// 행정: 읍면동 편입, 북측 1945년 면, 행정 소속표, 시군구 신설, 청사.
import { adminSig, buildAdmin } from '../game/admin.js';
import { formatWon } from '../game/catalog.js';
import { countyDisplayName, EVENT_COST, isMetroCity, metroName, PARTIES, promotedName, regionOf, unitId } from '../game/local.js';
import { stem } from '../game/naming.js';
import { placeName, save } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { METRICS, refreshNames } from '../ui/map.js';
import { toast } from '../ui/panel.js';
import { esc, map, metric, result, selection, state, subPop0, subsFC, zoneProps } from './core.js';
import { officeName, zoneName } from './year.js';
import { drawAdmin, subInfo } from './mapdata.js';
import { select } from './interact.js';
import { fmtPop, renderAll } from './panels.js';
import { countyRep, countyRepCache, countyRepFresh, setCountyRepFresh, syncMayors, zoneGus } from './election.js';
import { guNamesOfZone, isGeneralGu, payEvent, subAdjacency, unitZones } from './bungu.js';
import { endHousingPick, inRing } from './housing.js';
import { extraOf, extraSubs, extrasOfParent, extrasOfZone, padSubsFC } from './risplit.js';

// ---- 읍면동 단위 광역시 편입 (state.local.annexSub: '도|시군|읍면동' → 광역시)

/** 읍면동 열쇠: 자료의 도·시군·읍면동 이름 (존 번호가 바뀌어도 그대로) */
/** 읍면동 이름: 직접 바꾼 이름·행정구역 정리(노동자구 폐지 → 리, 두음법칙)를 반영한다 (자료 이름 그대로 쓰면 창·목록에 '○○로동자구'가 남았다) */
export function subName(i) { return riToDong(i, placeName(state, 'unit', i, subsFC?.features[i]?.properties.name || '')); }

// ------------------------------------------------------------ 북측 읍면 (1945년 면, data/kp_myeon.json)
// 북측은 1952년에 면을 없애 리가 바로 군에 딸린다. 남측처럼 군은 읍·면 단위로, 시는 동 단위로 보이게:
// 지금 리를 1945년 면에 묶어(pipeline/build_myeon.py) 군에서는 면마다 하나로 그리고, 시에서는 동은 그대로, 리는 면으로 묶되
// 동으로 바꾸기로 고른 면(L.dongMyeon[시군 열쇠])의 리는 ○○동으로 하나씩 보인다

export var kpMyeon = null;   // var: 시작할 때 이름 풀이가 이 줄보다 먼저 돌 수 있다
fetch('data/kp_myeon.json').then((r) => (r.ok ? r.json() : null)).then((d) => { kpMyeon = d?.subs || null; if (map) refreshNames(map); }).catch(() => {});

/** 이 시군에서 동으로 바꾼 옛 면들 */
export function dongMyeons(z) { return new Set(state.local?.dongMyeon?.[unitId(state, zoneProps[z])] || []); }

/** 북측 시군의 단위: 'gun'(군: 읍면으로), 'si'(시: 동, 리는 면으로), null(구·구역·광역시 등: 그대로) */
export function kpUnitKind(z) {
  const zp = zoneProps[z];
  if (!zp || zp.ext || zp.country !== 'KP') return null;
  const split = guNamesOfZone(z) && !isGeneralGu(z), n = countyDisplayName(state, zp);
  if (!split && /군$/.test(n)) return 'gun';
  if (!split && /시$/.test(n)) return 'si';
  // 광역시로 승격한 시 자리(구 없는 광역시 그 자체, 자치구로 나눈 구, 편입한 시의 구): 시처럼 동은 그대로, 리는 면으로.
  // 북측 직할시의 ○○구역은 처음부터 동 단위라 그대로
  if (isMetroCity(regionOf(state, zp)) && !/구역$/.test(zp.name) && (split || /(광역시|구)$/.test(n))) return 'si';
  return null;
}

/** 읍면동 번호의 옛 면 묶음 {key, name} (지도에서 한 면으로 그린다). 그대로 보일 것이면 null */
export function unitMyeon(i) {
  const m = kpMyeon?.[i];
  if (!m) return null;
  // 지금의 읍은 1945년 면으로 묶지 않고 하나의 읍으로 둔다 (1945년에는 면이던 군청 소재지가 뒤에 읍이 된 곳이 많아, 묶으면 북측 읍 146곳 가운데 113곳이 사라졌다)
  if (/읍$/.test(subsFC?.features[i]?.properties.name || '')) return null;
  const [z] = subInfo(i), sp = splitOfSub(i);
  const kind = sp ? (/시$/.test(state.local.splitUnit[sp]?.name || '') ? 'si' : 'gun') : kpUnitKind(z);
  if (!kind) return null;
  const dongs = sp ? new Set(state.local.dongMyeon?.[sp] || []) : dongMyeons(z);
  if (kind === 'si' && (/동$/.test(subsFC?.features[i]?.properties.name || '') || dongs.has(m))) return null;
  return { key: `${countyRep(z)}|${m}`, name: m };
}

/** 시에서 동으로 바꾼 면의 리 이름: ○○리 → ○○동 (직접 바꾼 이름은 그대로) */
export function riToDong(i, name) {
  // 남측 시: 동으로 바꾼 읍면은 ○○읍·○○면 → ○○동 (군에는 읍면만, 시에는 읍면동 모두 둘 수 있다)
  const sp = splitOfSub(i), spSi = sp && /시$/.test(state.local.splitUnit[sp]?.name || ''), spDong = sp ? new Set(state.local.dongMyeon?.[sp] || []) : null;
  if (/[읍면]$/.test(name || '') && !state.placeNames?.[`u:${i}`]) {
    const [z] = subInfo(i), raw = subsFC?.features[i]?.properties.name;
    if (sp ? spSi && spDong.has(raw) : krSi(z) && dongMyeons(z).has(raw)) return name.replace(/[읍면]$/, '동');
  }
  if (!kpMyeon || !/리$/.test(name || '') || state.placeNames?.[`u:${i}`]) return name;
  const m = kpMyeon[i], [z] = subInfo(i);
  if (sp) return m && spSi && spDong.has(m) ? name.replace(/리$/, '동') : name;
  return m && kpUnitKind(z) === 'si' && dongMyeons(z).has(m) ? name.replace(/리$/, '동') : name;
}

/** 남측 시 (군이 아닌 시, 광역시 아님): 읍면 가운데 고른 곳을 동으로 둘 수 있다 */
export function krSi(z) {
  const zp = zoneProps[z];
  if (!zp || zp.ext || zp.country !== 'KR' || isMetroCity(regionOf(state, zp))) return false;
  return /시$/.test((countyDisplayName(state, zp) || '').split(' ')[0]);
}

/** 시의 옛 면 목록 (리가 있는 면만): [{name, subs, pop}]. 남측 시는 지금 읍·면 하나하나 */
export function unitMyeonList(k) {
  const out = new Map();
  const zs = unitZones(k);
  if (zs.length && zoneProps[zs[0]].country === 'KR') {
    for (const z of zs) zoneProps[z].subs.forEach((_, j) => {
      const i = zoneProps[z].sub0 + j, nm = subsFC?.features[i]?.properties.name || '';
      if (/[읍면]$/.test(nm)) out.set(nm, { name: nm, subs: 1, pop: result ? result.subs.pop[i] : 0 });
    });
    return [...out.values()].sort((a, b) => b.pop - a.pop);
  }
  for (const z of zs) zoneProps[z].subs.forEach((_, j) => {
    const i = zoneProps[z].sub0 + j, m = kpMyeon?.[i];
    if (!m || /동$/.test(subsFC?.features[i]?.properties.name || '')) return;
    const e = out.get(m) || { name: m, subs: 0, pop: 0 };
    e.subs++; e.pop += result ? result.subs.pop[i] : 0;
    out.set(m, e);
  });
  return [...out.values()].sort((a, b) => b.pop - a.pop);
}

/** 북측 시의 읍면을 동으로 바꾸는 창 (군 → 시 승격 때, 시 창에서 다시): 고른 읍면의 리는 동이 되어 하나씩 보인다 */
export function myeonDongDialog(k, then = null) {
  const list = unitMyeonList(k);
  if (!list.length) { then?.(); return; }
  const kr = zoneProps[unitZones(k)[0]]?.country === 'KR';
  const cur = new Set(state.local.dongMyeon?.[k] ?? (kr ? [] : list.filter((e) => /읍$/.test(e.name)).map((e) => e.name)));
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true"><h2>동으로 바꿀 읍면 · ${esc(k.split('|')[1].replace(/군$/, '시'))}</h2>
    <p class="setup-intro hint">${kr
    ? '군에는 읍·면만 두지만 시에는 읍·면·동을 모두 둘 수 있습니다. 시가지가 된 읍면을 고르면 동이 됩니다(○○읍 → ○○동, 읍장·면장 대신 동장). 고르지 않은 읍면은 그대로 읍·면입니다. 나중에도 시를 눌러 바꿀 수 있습니다.'
    : '군에는 읍·면만 두지만 시에는 읍·면·동을 모두 둘 수 있습니다. 고른 읍면의 리는 동이 되어(○○리 → ○○동) 하나씩 보이고, 고르지 않은 읍면은 읍·면 하나로 보입니다. 읍면은 1945년(분단 직전) 면입니다. 나중에도 시를 눌러 바꿀 수 있습니다.'}</p>
    <div class="actions setup-quick"><button class="small" data-myeon-all>모두</button><button class="small" data-myeon-none>하나도 안 바꿈</button><button class="small" data-myeon-eup>읍만</button></div>
    <div class="setup-body"><div class="list">${list.map((e) => `<label class="item" style="display:flex;gap:8px;align-items:center">
      <input type="checkbox" data-myeon="${esc(e.name)}" ${cur.has(e.name) ? 'checked' : ''}>
      <span class="t" style="flex:1">${esc(e.name)}</span><span class="m">리 ${e.subs}곳${result ? ` · ${fmtPop(e.pop)}` : ''}</span></label>`).join('')}</div></div>
    <div class="setup-btns"><span style="flex:1"></span><button class="small primary" data-myeon-ok>정하기</button></div></div>`;
  document.body.appendChild(wrap);
  const boxes = () => [...wrap.querySelectorAll('[data-myeon]')];
  wrap.querySelector('[data-myeon-all]').onclick = () => boxes().forEach((x) => { x.checked = true; });
  wrap.querySelector('[data-myeon-none]').onclick = () => boxes().forEach((x) => { x.checked = false; });
  wrap.querySelector('[data-myeon-eup]').onclick = () => boxes().forEach((x) => { x.checked = /읍$/.test(x.dataset.myeon); });
  wrap.querySelector('[data-myeon-ok]').onclick = () => {
    (state.local.dongMyeon ||= {})[k] = [...wrap.querySelectorAll('[data-myeon]')].filter((x) => x.checked).map((x) => x.dataset.myeon);
    wrap.remove();
    save(state); refreshNames(map); renderAll();
    then?.();
  };
}

export function subKey(i) {
  const z = zoneProps[subInfo(i)[0]];
  const e = extraOf(i);   // 떼어 낸 남측 법정리: 같은 군의 다른 면에 같은 이름 리가 흔해 법정리 코드를 붙인다
  return `${z.province}|${z.name}|${subsFC?.features[i]?.properties.name || i}${e ? `#${e.code}` : ''}`;
}

/** 따로 편입한 읍면동들: [[소구역 번호, 광역시]] (시군째 편입한 곳은 그 시군을 따른다) */
export let annexSubCache = null;
export function annexedSubs() {
  const A = state.local?.annexSub;
  if (!A || !Object.keys(A).length || !subsFC) return [];
  const sig = JSON.stringify(A);
  if (annexSubCache?.sig !== sig) {
    const out = [];
    for (let i = 0; i < subsFC.features.length; i++) { const to = A[subKey(i)]; if (to) out.push([i, to]); }
    annexSubCache = { sig, out };
  }
  return annexSubCache.out;
}

// ---- 행정 소속표 (js/game/admin.js): 리 → 읍면동 → 시군 → 광역 단체
// 북측은 계산용 소구역이 리라 1945년 면(kpMyeon)으로 묶은 것이 읍면동, 남측은 소구역이 곧 읍면동이다.
// 편입·시군구 신설은 읍면동 단위로 소속을 바꾸고, 경계선·이름·색칠·시군 창·단체장·선거·통계가 모두 이 표를 본다.
export let adminCache = null, adminFresh = false;
export var adminBuilding = null;   // 소속표를 만드는 중이면 그 표 (읍면동 이름을 정할 때 admin()을 다시 부르지 않게)
/** 읍면동 i가 든 새 시군 열쇠 (존 시군이면 null) */
export function splitOfSub(i) {
  const u = adminBuilding ? adminBuilding.unitOfSub[i] : adminCache && adminFresh ? adminCache.a.unitOfSub[i] : admin()?.unitOfSub[i];
  return u && u.startsWith('split:') ? u : null;
}
/** 소속표를 다시 맞춰 보게 한다 (소속을 바꾼 뒤, 화면을 다시 그릴 때) */
export function adminInvalidate() { adminFresh = false; setCountyRepFresh(false); }
export function admin() {
  if (!subsFC || !state?.local) return null;
  // 한 번의 처리 안에서는 표를 다시 맞춰 보지 않는다: 읍면동마다 부르는 곳이 많아, 부를 때마다 행정구역 설정을 견주면 화면 하나 그리는 데 10초가 넘게 걸렸다
  if (adminCache && adminFresh) return adminCache.a;
  adminFresh = true;
  queueMicrotask(() => { adminFresh = false; });
  countyRep(0);   // 시군 대표 존 표를 지금 행정구역으로 (countyRepCache.sig)
  const sig = adminSig(state.local, (countyRepCache?.sig || '') + JSON.stringify(state.local.dongMyeon || null) + (kpMyeon ? 1 : 0) + `|ri${extraSubs.length}`);
  if (adminCache?.sig === sig) return adminCache.a;
  padSubsFC();   // 떼어 낸 남측 법정리 자리 (risplit.js)
  const S = subsFC.features.length;
  const a = buildAdmin({ extrasOfZone,
    zoneProps, S, subInfo, subKey, countyRep,
    unitId: (j) => unitId(state, zoneProps[j]), regionOf: (j) => regionOf(state, zoneProps[j]), zoneName: (j) => countyNameOf(j),
    subPop: (i) => (result ? result.subs.pop[i] : 0), subPop0: (i) => subPop0[i] || 0,
  }, state.local);
  // 읍면동 단계: 북측 리는 면으로 묶는다 (동으로 바꾼 면의 리는 하나하나가 동)
  a.emdOf = new Array(S);
  a.emds = new Map();
  adminBuilding = a;
  for (let i = 0; i < S; i++) {
    if (!a.unitOfSub[i]) continue;
    // 면 묶음은 지금 속한 시군 안에서만: 리 하나만 다른 시로 편입하면 옛 면과 따로 묶인다
    const m = unitMyeon(i), key = m ? `${m.key}@${a.unitOfSub[i]}` : `s:${i}`;
    a.emdOf[i] = key;
    let e = a.emds.get(key);
    if (!e) a.emds.set(key, (e = { key, name: m ? m.name : subName(i), subs: [] }));
    e.subs.push(i);
  }
  adminBuilding = null;
  adminCache = { sig, a };
  return a;
}

/** 시군 이름 (분구한 시군이면 시 이름, 구 목록이 아니라) */
export function countyNameOf(j) { return countyDisplayName(state, zoneProps[j]) || zoneName(j); }

/** 읍면동 i가 지금 속한 시군 id ('z:대표 존' 또는 'split:…') */
export function subUnit(i) { return admin()?.unitOfSub[i] || `z:${countyRep(subInfo(i)[0])}`; }
/** 시군 id → 대표 존 (새로 세운 시군이면 원래 시군의 대표 존: 계산 값을 빌린다) */
export function unitRepZone(id) {
  if (id.startsWith('z:')) return +id.slice(2);
  const u = admin()?.unit(id);
  return u ? countyRep([...u.zones][0]) : -1;
}
/** 시군 id의 보이는 이름 */
export function unitName(id) { const u = admin()?.unit(id); return u ? u.name : id.startsWith('z:') ? countyNameOf(+id.slice(2)) : id; }
/** 시군 id의 단체장 자리 열쇠 */
export function unitOfficeKey(id) { return id.startsWith('z:') ? `m:${id.slice(2)}` : `m:${id}`; }

/** 읍면동이 속한 광역 단체 */
export function subRegion(i) {
  return admin()?.regionOfSub[i] || state.local?.annexSub?.[subKey(i)] || regionOf(state, zoneProps[subInfo(i)[0]]);
}

/** 이 읍면동(북측은 그 면 전체)이 든 읍면동 묶음의 소구역들 */
/** 읍면동·리 편입 비용: 지방자치 전 북측은 중앙에서 고시만 하면 되므로 절반 */
export function annexSubCost(i) {
  return zoneProps[subInfo(i)[0]].country === 'KP' && !state.local.autonomyKP ? EVENT_COST.annexSub / 2 : EVENT_COST.annexSub;
}

/** 편입할 때 함께 옮기는 소구역: 북측 면은 면 전체, one이면 그 리(동) 하나만 */
export function annexGroup(i, one = false) {
  if (one) return [i];
  const a = admin(), key = a?.emdOf[i];
  return key ? a.emds.get(key).subs.slice() : [i];
}

/** 읍면동 소구역들의 맞닿음 (계산용 경계가 꼭짓점을 둘 넘게 같이 쓰면 이웃). 나라별로 한 번 */
export const subNbCache = new Map();
export function subNeighbors(i) {
  // 떼어 낸 남측 법정리: 경계 꼭짓점을 같이 쓰지 않으므로 원래 읍면동과 그 이웃, 같은 읍면동에서 뗀 다른 리를 이웃으로 본다
  const e = extraOf(i);
  if (e) {
    const out = new Set([e.parent, ...subNeighbors(e.parent)]);
    for (const o of extrasOfParent(e.parent)) if (o.g !== i) out.add(o.g);
    out.delete(i);
    return out;
  }
  const own = subNeighborsBase(i), ex = extraSubs.length ? [...own, i].flatMap((j) => extrasOfParent(j).map((o) => o.g)) : [];
  return ex.length ? new Set([...own, ...ex]) : own;
}
function subNeighborsBase(i) {
  const c = zoneProps[subInfo(i)[0]].country;
  if (!subNbCache.has(c)) {
    const idx = [];
    zoneProps.forEach((z) => { if (!z.ext && z.country === c) for (let k = 0; k < z.subs.length; k++) idx.push(z.sub0 + k); });
    subNbCache.set(c, subAdjacency(idx));
  }
  return subNbCache.get(c).get(i) || new Set();
}

/**
 * 이 읍면동(북측은 그 면 전체)을 편입할 수 있는 곳: 맞닿은 광역시(metro: 광역 단체 이름), 맞닿은 시(si: [시군 id, 이름]).
 * 군 단위 편입은 너무 큰 경우가 있어 면 하나씩 옮긴다. 맞닿음은 경계 모양으로 센다
 */
export function subAnnexAll(i, one = false) {
  const zp = zoneProps[subInfo(i)[0]];
  // 북측은 지방자치를 들이기 전에도 리·면을 옮길 수 있다 (단체장·의회 협의가 없어 오히려 싸다: annexSubCost)
  if (zp.ext) return { metro: [], si: [] };
  const own = subRegion(i), ownU = subUnit(i), metro = new Set(), si = new Map();
  const dong = annexGroup(i, one).some((s) => /동$/.test(subName(s)));
  for (const s of annexGroup(i, one)) for (const j of subNeighbors(s)) {
    const r = subRegion(j), u = subUnit(j);
    if (u === ownU) continue;
    if (r !== own && isMetroCity(r)) { metro.add(r); continue; }   // 세종도 받는다
    if (isMetroCity(r)) continue;
    const nm = unitName(u);
    // 시·군 모두 받는다. 군에는 읍·면만 둘 수 있어 동은 군으로 들이지 않는다
    if (/시$/.test(nm) || (/군$/.test(nm) && !dong)) si.set(u, nm);
  }
  return { metro: [...metro], si: [...si] };
}
export function subAnnexTargets(i) { return subAnnexAll(i).metro; }

/** 읍면동을 시군 id로 옮긴다 (원래 시군이면 표에서 지운다). 광역 단체가 다르면 광역 경계도 */
export function setSubUnit(i, id) {
  adminInvalidate();
  const L = state.local, key = subKey(i), home = `z:${countyRep(subInfo(i)[0])}`;
  for (const [bu, b] of Object.entries(L.bungu || {})) if (bu !== id && b.gu?.[key]) delete b.gu[key];
  if (id === home) delete L.annexSubUnit?.[key]; else (L.annexSubUnit ||= {})[key] = id.startsWith('z:') ? unitId(state, zoneProps[+id.slice(2)]) : id;
  const r = id.startsWith('split:') ? L.splitUnit[id].region : regionOf(state, zoneProps[unitRepZone(id)]);
  if (r !== regionOf(state, zoneProps[subInfo(i)[0]])) (L.annexSub ||= {})[key] = r; else delete L.annexSub?.[key];
}

/** 시군 인구 {pop, pop0}: 읍면동을 더해서 (편입·신설 반영) */
export function unitPop(id) { return admin()?.pop(id) || { pop: 0, pop0: 0 }; }

/** 읍면동이 지금 속한 시군 이름 */
export function subCountyName(i) { return unitName(subUnit(i)); }

/** 새로 세운 시군들 */
export function splitUnits() { return admin()?.splits() || []; }

// ---- 시군구 신설 (시티즈: 스카이라인의 구역 칠하기처럼): 단추를 누른 뒤 지도에서 읍면동(북측은 면)을 눌러 고르고 이름을 정해 세운다.
// 군에는 읍면만, 시에는 읍면동 모두, 광역시 안이면 자치구(○○구). 세운 시군은 단체장을 뽑고, 경계·이름·색칠·통계에 시군으로 나온다
export var unitPick = null;   // {subs: Set<소구역>}
export function startUnitPick() {
  endHousingPick?.();
  unitPick = { subs: new Set() };
  if (!map.getSource('unit-pick')) {
    map.addSource('unit-pick', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'unit-pick-fill', type: 'fill', source: 'unit-pick', paint: { 'fill-color': '#e07b39', 'fill-opacity': 0.45 } });
    map.addLayer({ id: 'unit-pick-line', type: 'line', source: 'unit-pick', paint: { 'line-color': '#b2541a', 'line-width': 1.5 } });
  }
  map.setLayoutProperty('subs-line', 'visibility', 'visible');   // 고르는 동안 읍면동 경계를 보인다
  document.querySelector('.unit-pick-bar')?.remove();
  const bar = document.createElement('div');
  bar.className = 'unit-pick-bar';
  bar.innerHTML = `<b>시군구 신설</b><span class="m" data-up-info>지도에서 읍면동을 누르세요 (다시 누르면 뺌, Esc로 그만두기)</span>
    <input type="text" data-up-name placeholder="새 이름 (○○시·○○군·○○구)">
    <button class="small primary" data-up-ok>세우기 · ${formatWon(EVENT_COST.cityUp)}</button><button class="small" data-up-cancel>그만두기</button>`;
  document.body.appendChild(bar);
  bar.querySelector('[data-up-cancel]').onclick = endUnitPick;
  bar.querySelector('[data-up-ok]').onclick = finishUnitPick;
  const esc_ = (e) => { if (e.key === 'Escape') { endUnitPick(); document.removeEventListener('keydown', esc_); } };
  document.addEventListener('keydown', esc_);
  map.getCanvas().style.cursor = 'crosshair';
  drawUnitPick();
}

export function endUnitPick() {
  unitPick = null;
  document.querySelector('.unit-pick-bar')?.remove();
  map.getSource('unit-pick')?.setData({ type: 'FeatureCollection', features: [] });
  if (!METRICS[metric]?.sub) map.setLayoutProperty('subs-line', 'visibility', 'none');
  map.getCanvas().style.cursor = '';
}

/** 누른 자리의 읍면동: 누른 점이 든 계산용 경계를 바로 찾는다 (가까운 존부터 견주던 예전 방식은 경계 가까이에서 이웃 시군을 잡았다) */
export function subAtLngLat(ll) {
  const x = ll.lng, y = ll.lat;
  // 떼어 낸 남측 법정리는 원래 읍면동 경계 안에 겹쳐 있으므로 먼저 본다
  for (const e of extraSubs) {
    if (Math.abs(e.x - x) > 0.2 || Math.abs(e.y - y) > 0.2) continue;
    const g = e.feature.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (polys.some((pg) => inRing(x, y, pg[0]) && !pg.slice(1).some((h) => inRing(x, y, h)))) return e.g;
  }
  let best = -1, bd = Infinity;
  zoneProps.forEach((z) => {
    if (z.ext) return;
    for (let k = 0; k < z.subs.length; k++) {
      const [sx, sy] = z.subs[k];
      if (Math.abs(sx - x) > 0.3 || Math.abs(sy - y) > 0.25) continue;
      const i = z.sub0 + k, g = subsFC?.features[i]?.geometry;
      const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
      if (polys.some((pg) => inRing(x, y, pg[0]) && !pg.slice(1).some((h) => inRing(x, y, h)))) { best = i; bd = -1; return; }
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (bd >= 0 && d < bd) { bd = d; best = i; }
    }
  });
  return best;
}

export function unitPickClick(ll) {
  const i = subAtLngLat(ll);
  if (i < 0) return;
  const zp = zoneProps[subInfo(i)[0]];
  if (zp.country === 'KP' && !state.local.autonomyKP) { toast('북측은 지방자치를 시작한 뒤에 시군구를 세울 수 있습니다.'); return; }
  const first = [...unitPick.subs][0];
  if (first != null && zoneProps[subInfo(first)[0]].country !== zp.country) { toast('남북에 걸친 시군구는 세울 수 없습니다.'); return; }
  const g = annexGroup(i), on = !unitPick.subs.has(i);
  for (const j of g) { if (on) unitPick.subs.add(j); else unitPick.subs.delete(j); }
  drawUnitPick();
}

export function drawUnitPick() {
  if (!unitPick) return;
  const subs = [...unitPick.subs];
  map.getSource('unit-pick').setData({ type: 'FeatureCollection', features: subs.map((i) => ({ type: 'Feature', properties: {}, geometry: subsFC.features[i].geometry })) });
  const bar = document.querySelector('.unit-pick-bar');
  if (!bar) return;
  const pop = result ? subs.reduce((t, i) => t + result.subs.pop[i], 0) : 0;
  const names = [...new Set(subs.map((i) => unitMyeon(i)?.name || subName(i)))];
  bar.querySelector('[data-up-info]').textContent = subs.length
    ? `${names.length}곳${result ? ` · ${fmtPop(pop)}` : ''} (${names.slice(0, 4).join('·')}${names.length > 4 ? ' …' : ''})`
    : '지도에서 읍면동을 누르세요 (다시 누르면 뺌, Esc로 그만두기)';
  const nm = bar.querySelector('[data-up-name]');
  if (!nm.value && names.length) nm.placeholder = `예: ${stem(names[0].replace(/[읍면동리]$/, '')) || names[0]}${regionsOfPick().every(isMetroCity) ? '구' : '시'}`;
}

export function regionsOfPick() { return [...new Set([...unitPick.subs].map((i) => subRegion(i)))]; }

export function finishUnitPick() {
  const subs = [...unitPick.subs], bar = document.querySelector('.unit-pick-bar');
  const name = bar.querySelector('[data-up-name]').value.trim();
  if (!subs.length) { alert('지도에서 읍면동을 고르세요.'); return; }
  const regs = regionsOfPick(), metro = regs.every(isMetroCity);
  if (metro ? !/(구|군)$/.test(name) : !/(시|군)$/.test(name)) { alert(metro ? '광역시 안이면 ○○구 또는 ○○군으로 정하세요.' : '새 이름은 ○○시 또는 ○○군으로 정하세요.'); return; }
  if (/군$/.test(name) && subs.some((i) => /동$/.test(subName(i)))) { alert('군에는 읍·면만 둘 수 있습니다. ○○시로 하거나 동을 빼세요.'); return; }
  const a = admin(), from = new Map();
  for (const i of subs) { const u = a.unitOfSub[i]; from.set(u, (from.get(u) || 0) + 1); }
  // 원래 시군을 통째로 고르면 새로 세울 것이 없다: 적어도 한 시군에는 읍면동이 남아야 한다
  if ([...from].every(([u, n]) => n >= a.unit(u).subs.length)) { alert('원래 시군을 통째로 고르면 새로 세울 것이 없습니다. 이름은 시군 창에서 바꾸세요.'); return; }
  if ([...a.units.values()].some((u) => u.name === name && u.region === regs[0])) { alert(`${regs[0]}에 이미 ${name}이(가) 있습니다.`); return; }
  if (!payEvent(EVENT_COST.cityUp)) return;
  const homeId = [...from].sort((x, y) => y[1] - x[1])[0][0];
  const home = homeId.startsWith('z:') ? unitId(state, zoneProps[+homeId.slice(2)]) : state.local.splitUnit[homeId].home;
  const region = regs.length === 1 ? regs[0] : a.unit(homeId).region;
  const key = `split:${Date.now().toString(36)}`;
  (state.local.splitUnit ||= {})[key] = { name, home, region, year: state.year };
  adminInvalidate();
  for (const i of subs) setSubUnit(i, key);
  state.log.unshift(`${state.year}년 ${name} 신설 (${[...new Set(subs.map((i) => unitMyeon(i)?.name || subName(i)))].slice(0, 6).join('·')})`);
  endUnitPick();
  syncMayors();
  const off = state.local.offices[unitOfficeKey(key)];
  if (off) state.log.unshift(`${state.year}년 ${name} 첫 ${off.title} 선거: ${off.name} (${PARTIES[off.party]?.short || off.party}) 당선`);
  save(state); drawAdmin(); renderAll();
  select({ type: 'unit', id: key });
}

/** 새로 세운 시군을 원래 시군에 다시 합친다 (읍면동은 저마다 원래 존의 시군으로) */
export function mergeSplitUnit(key) {
  const S = state.local.splitUnit?.[key];
  if (!S) return;
  adminInvalidate();
  for (const [k, v] of Object.entries(state.local.annexSubUnit || {})) if (v === key) { delete state.local.annexSubUnit[k]; delete state.local.annexSub?.[k]; }
  delete state.local.splitUnit[key];
  delete state.local.offices[unitOfficeKey(key)];
  state.log.unshift(`${state.year}년 ${S.name}, ${S.home.split('|')[1] || S.home}에 다시 합침`);
  save(state); drawAdmin(); renderAll();
  if (selection?.type === 'unit' && selection.id === key) select(null);
}

/** 예전 편입 표 (광역시로 따로 편입한 읍면동) — 소속표가 대신하지만 예전 함수 이름을 쓰는 곳을 위해 */
export function annexedUnitSubs() {
  const a = admin();
  if (!a) return [];
  const out = [];
  for (let i = 0; i < a.unitOfSub.length; i++) if (a.moved[i]) out.push([i, a.unitOfSub[i]]);
  return out;
}

/** 따로 편입한 읍면동을 광역 경계처럼 굵은 선으로 */
/**
 * 시청·군청·구청 (data/halls.json, OSM 청사 또는 어림한 소재지). 이름은 지금 행정구역을 따른다:
 * 군→시 승격하면 시청, 광역시에 편입한 시는 구청, 광역시로 승격한 시는 광역시청, 분구하면 구마다 구청(가운데 구는 원래 청사, 나머지는 인구가 가장 많은 읍면동).
 * → [{name, kind: 'do'|'si'|'gun'|'gu', lon, lat}]
 */
export let halls = [];
export function setHalls(v) { return (halls = v); }
/** 승격·편입 전의 광역 단체 (도청이 원래 속한 도) */
export function homeRegion(z) {
  const L = state.local, sv = [L.independent, L.annex];
  L.independent = []; L.annex = {};
  try { return regionOf(state, z); } finally { [L.independent, L.annex] = sv; }
}

/** 도청을 옮길 자리: 그 도에 남은 가장 큰 시(없으면 가장 큰 시군)의 시청 곁 */
export function provinceSeat(r) {
  const pops = new Map();
  zoneProps.forEach((z, i) => {
    if (z.ext || regionOf(state, z) !== r) return;
    const k = countyRep(i);
    pops.set(k, (pops.get(k) || 0) + (result ? result.zones.pop[i] : z.pop));
  });
  const cand = [...pops].sort((a, b) => b[1] - a[1]);
  const best = (cand.find(([k]) => /시$/.test(countyDisplayName(state, zoneProps[k]))) || cand[0])?.[0];
  if (best == null) return null;
  const h = halls.find((x) => countyRep(x.z) === best && x.k !== 'do' && x.k !== 'gu');
  const c = h ? [h.x, h.y] : [zoneProps[best].cx, zoneProps[best].cy];
  return [c[0] + 0.004, c[1] + 0.002];
}

export function hallList() {
  if (!state || !zoneProps) return [];
  const L = state.local || {};
  const out = [];
  const bunguZones = new Set(Object.keys(L.bungu || {}).flatMap((u) => unitZones(u)));
  for (const h of halls) {
    const z = zoneProps[h.z];
    if (!z || z.ext) continue;
    let name, kind = h.k, lon = h.x, lat = h.y;
    if (h.k === 'do') {
      const home = homeRegion(z), now = regionOf(state, z);
      if (home !== now && !isMetroCity(home)) {
        // 도청 소재지가 광역시로 떨어져 나갔다 (함흥 → 함흥광역시): 그 도에 남은 가장 큰 시로 옮긴다 (경북도청이 대구에서 나간 것처럼)
        const seat = provinceSeat(home);
        if (!seat) continue;
        name = `${home}청`; lon = seat[0]; lat = seat[1];
      } else name = `${now}청`;
    } else {
      const own = promotedName(state, z);
      const metro = L.independent?.includes(own) && !z.city;
      if (metro) { name = `${metroName(own)}청`; kind = 'do'; }   // 광역시로 승격한 시의 청사는 광역시청 (도청처럼 늘 보이게)
      else if (h.k === 'si' && z.city) name = `${placeName(state, 'zone', h.z, z.city)}청`;   // 일반구가 있는 시(수원시)의 시청
      // 시에 딸린 일반구 구청 (장안구청): 게임에서는 시 하나라 OSM 이름으로. 시 이름을 붙여 적은 것(화성시동탄구청)은 구청 이름만
      else if (h.k === 'gu' && (z.city || /시$/.test(z.name)) && h.osm) name = h.osm.replace(/^[가-힣]+시\s*(?=[가-힣]+구청$)/, '');
      else if (bunguZones.has(h.z) && !isGeneralGu(h.z)) {
        const g = zoneGus(countyRep(h.z));
        name = g ? `${g[0]}청` : `${officeName(h.z)}청`;   // 분구한 시군의 원래 청사는 가운데 구의 구청
      } else name = `${officeName(h.z)}청`;
    }
    out.push({ name, kind, lon, lat, rank: (kind === 'do' ? 10 : 0) + (h.src === 'osm' ? 2 : 0) + (countyRep(h.z) === h.z ? 1 : 0), region: regionOf(state, z),
      unit: h.k === 'gun' || (h.k === 'si' && !z.city) ? unitId(state, z) : null });
  }
  // 한 시군에 청사 하나: 분단 전 경계로 합친 군(연안·배천 → 연백군, 남북 철원)은 옛 군청이 같은 이름으로 둘 남는다 → OSM 청사, 대표 존 쪽만
  const best = new Map();
  for (const h of out) { const k = `${h.name}|${h.region}`; if (!best.has(k) || h.rank > best.get(k).rank) best.set(k, h); }
  // 같은 시군의 시청·군청은 이름이 달라도 하나만 (합친 군의 두 옛 군청)
  const byUnit = new Map();
  for (const h of best.values()) { const k = h.unit ? `u:${h.unit}` : `n:${h.name}|${h.region}`; if (!byUnit.has(k) || h.rank > byUnit.get(k).rank) byUnit.set(k, h); }
  out.splice(0, out.length, ...byUnit.values());
  // 분구한 구의 구청: 가운데 구(원래 청사 자리)를 뺀 구마다, 그 구에서 인구가 가장 많은 읍면동
  for (const [unit, b] of Object.entries(L.bungu || {})) {
    const zs = unitZones(unit);
    if (!zs.length) continue;
    const metroCore = L.independent?.includes(unit);   // 광역시로 승격한 도시: 원래 청사는 광역시청이 되고 중구청은 따로
    const core = b.core || zoneGus(countyRep(zs[0]))?.[0];
    const best = new Map();
    for (const z of zs) zoneProps[z].subs.forEach((sp, k) => {
      const i = zoneProps[z].sub0 + k, g = b.gu[subKey(i)];
      if (!g || (g === core && !metroCore)) return;
      const w = result ? result.subs.pop[i] : sp[2] * zoneProps[z].pop;
      if (!best.has(g) || w > best.get(g).w) best.set(g, { w, lon: sp[0], lat: sp[1] });
    });
    // 실제 구청이 지도 자료에 있는 일반구(수원시 장안구청 등)는 그 자리 그대로: 인구 중심에 또 찍지 않는다
    for (const [g, e] of best) if (!out.some((h) => h.name.endsWith(`${g}청`) && kmBetween(h.lon, h.lat, e.lon, e.lat) < 15)) out.push({ name: `${g}청`, kind: 'gu', lon: e.lon, lat: e.lat });
  }
  return out;
}

export let showHalls = true;
export function setShowHalls(v) { return (showHalls = v); }
try { showHalls = localStorage.getItem('ukt-halls') !== '0'; } catch { /* 기본은 켬 */ }
export function drawHalls() {
  if (!map?.getSource('links')) return;
  if (!map.getSource('halls')) {
    map.addSource('halls', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // 도청·광역시청은 넓게 볼 때부터, 시·군청은 7.5, 구청은 9부터
    const minz = ['match', ['get', 'kind'], 'do', 5.5, 'gu', 9, 7.5];
    map.addLayer({ id: 'halls-dot', type: 'circle', source: 'halls', filter: ['>=', ['zoom'], minz],
      paint: { 'circle-radius': ['match', ['get', 'kind'], 'do', 5, 3.6], 'circle-color': '#ffffff', 'circle-stroke-color': '#1d3f8f', 'circle-stroke-width': ['match', ['get', 'kind'], 'do', 2.2, 1.6] } });
    map.addLayer({ id: 'halls-label', type: 'symbol', source: 'halls', filter: ['all', ['!=', ['get', 'kind'], 'do'], ['>=', ['zoom'], ['+', minz, 1]]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': '#1d3f8f', 'text-halo-color': '#ffffff', 'text-halo-width': 1.3 } });
    // 도청·광역시청 이름은 따로 늘 보이게 (역 이름·시청 이름에 밀려 평안북도청·자강도청이 안 보였다)
    map.addLayer({ id: 'halls-label-do', type: 'symbol', source: 'halls', filter: ['all', ['==', ['get', 'kind'], 'do'], ['>=', ['zoom'], 6.5]],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': '#1d3f8f', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
  }
  const vis = showHalls ? 'visible' : 'none';
  for (const l of ['halls-dot', 'halls-label', 'halls-label-do']) map.setLayoutProperty(l, 'visibility', vis);
  map.getSource('halls').setData({ type: 'FeatureCollection', features: showHalls ? hallList().map((h) => ({ type: 'Feature', properties: { name: h.name, kind: h.kind }, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } })) : [] });
}

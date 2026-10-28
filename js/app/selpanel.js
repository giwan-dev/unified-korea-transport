// 고른 곳의 창: 광역·시군·읍면동·리·새 시군(행정 조정)·편입, 공항·항공 노선·노드.
import { airlinesHTML } from '../game/airlines.js';
import { AIRPORT, formatWon, KP_COST_FACTOR } from '../game/catalog.js';
import { placeIntroHTML } from '../game/cities.js';
import { dueum, EVENT_COST, governorTitle, hasAutonomy, isMetroCity, KP_DIRECT_CITIES, PARTIES, partySupport, regionOf } from '../game/local.js';
import { AIR, effectiveNetwork, IC_REMOVE_COST, load, RENAME, save, START_YEAR } from '../game/state.js';
import { t } from '../i18n.js';
import { routeKey } from '../sim/model.js';
import { refreshNames } from '../ui/map.js';
import { toast } from '../ui/panel.js';
import { base, busy, esc, happiness, historic, map, median, result, selection, setSelection, state, subPop0, subsFC, zoneProps } from './core.js';
import { gains, zoneName } from './year.js';
import { sezHTML } from './sez.js';
import { drawAdmin, krRi, nodeNames, provincePops, riCodeMap, riFeat, subArea, subInfo, subMetric } from './mapdata.js';
import {
  admin, adminInvalidate, annexGroup, annexSubCost, kpMyeon, mergeSplitUnit, riToDong, setSubUnit, subAnnexAll, subCountyName, subKey, subName, subNeighbors, subRegion,
  subUnit, unitMyeon, unitName, unitOfficeKey, unitPop, unitRepZone,
} from './region.js';
import { select } from './interact.js';
import { fmtPop, pct, renderAll } from './panels.js';
import { foreignCountry } from './operators.js';
import { countyRep, countyZones, mayorKey, partyBadge, syncMayors, zoneAdminHTML } from './election.js';
import { bunguSelect, drawBungu, guNamingDialog, guOfSub, makeBungu, payEvent, unitZones } from './bungu.js';
import { localZoneHTML } from './firstyear.js';
import { REST_REMOVE_COST } from './housing.js';
import { header } from './svcmap.js';
import { linesAt, stationPanel } from './gazette.js';
import { riPopOf, splitRi, splitSubOf } from './risplit.js';

export function zonePanel(id) {
  const z = zoneProps[id];
  const name = zoneName(id);
  if (!result) return header(name);
  const r = result.zones;
  // 한 시군으로 보이는 존들(옛 군 땅 조각 포함)을 합쳐 보인다: 인구·순이동은 더하고, 나머지는 인구 가중 평균
  // 시군 인구는 소속표로 (면 단위로 편입해 오거나 내준 읍면동, 새로 떼어 세운 시군 반영). 나머지 값은 존 인구로 가중
  const zs = countyZones(id), up = admin() ? unitPop(`z:${countyRep(id)}`) : null;
  const zpop = zs.reduce((s, j) => s + r.pop[j], 0);
  const pop = up ? up.pop : zpop, pop0 = up ? up.pop0 : zs.reduce((s, j) => s + Math.max(zoneProps[j].pop, 0), 0);
  const avg = (arr) => (zpop > 0 ? zs.reduce((s, j) => s + arr[j] * r.pop[j], 0) / zpop : arr[id]);
  const main = zs.reduce((b, j) => (r.pop[j] > r.pop[b] ? j : b), zs[0]);
  const st = r.station[main];
  const stName = st >= 0 ? nodeNames().get(st)?.name : null;
  const change = pop / Math.max(pop0, 1) - 1;
  const accRef = median(Array.from(r.access));
  const targets = historic.filter((t) => zs.includes(t.zone));
  const hists = [...new Set(zs.map((j) => zoneProps[j].hist).filter((h) => h && h !== name))];
  return `${header(name)}
    <table class="kv">
      <tr><td>소속</td><td>${esc(regionOf(state, z))} (${z.country === 'KP' ? '북' : '남'})${name !== z.name ? ` · 원래 이름 ${esc(z.name)}` : ''}</td></tr>
      ${(() => { const p = z.ext ? null : provincePops().get(regionOf(state, z)); if (!p) return ''; const c = p.pop / Math.max(p.pop0, 1) - 1;
        return `<tr><td>${esc(regionOf(state, z))} 인구</td><td>${fmtPop(p.pop)} <span class="${c >= 0 ? 'pos' : 'neg'}">(${c >= 0 ? '+' : ''}${pct(c)})</span> · 이 시군구가 ${pct(pop / Math.max(p.pop, 1))}</td></tr>`; })()}
      ${hists.length ? `<tr><td>분단 전</td><td>옛 ${hists.map(esc).join('·')} 땅이 들어 있습니다<br><span class="hint">민원·정책 탭 › 행정구역 정리에서 되살릴 수 있습니다 (${START_YEAR}년)</span></td></tr>` : ''}
      ${happiness ? `<tr><td>주민 행복도</td><td>${avg(happiness).toFixed(1)}</td></tr>` : ''}
      <tr><td>인구</td><td>${fmtPop(pop)} <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>지난해 순이동</td><td>${Math.round(zs.reduce((s, j) => s + r.netMig[j], 0)).toLocaleString()}명</td></tr>
      <tr><td>HDI</td><td>${avg(r.hdi).toFixed(3)}</td></tr>
      <tr><td>기대수명</td><td>${avg(r.le).toFixed(1)}세</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(avg(r.income)).toLocaleString()}</td></tr>
      <tr><td>접근성 (중앙값=1)</td><td>${(avg(r.access) / accRef).toFixed(2)}</td></tr>
      <tr><td>이용 철도역</td><td>${stName ? esc(stName) : '없음 (25km 밖)'}</td></tr>
    </table>
    ${localZoneHTML(id)}
    ${zoneAdminHTML(id)}
    ${sezHTML(id)}
    ${targets.map((t) => restoreRow(t)).join('')}
    <h4>이름 바꾸기</h4>
    <div class="name-row"><input type="text" id="zone-name" value="${esc(name)}">
      <button class="small" id="zone-rename">바꾸기</button></div>
    <p class="hint">직접 바꾸는 이름은 비용이 들지 않지만 주민 행복도에는 영향이 없습니다.</p>`;
}

/** Shift로 고른 여러 시군구를 함께: 인구·순이동은 더하고, 나머지는 인구 가중 평균. 시군구마다 한 줄 */
export function zonesPanel(reps) {
  const title = `시군구 ${reps.length}곳`;
  if (!result) return header(title);
  const r = result.zones, zs = reps.flatMap((x) => countyZones(x));
  const pop = zs.reduce((s, j) => s + r.pop[j], 0), pop0 = zs.reduce((s, j) => s + Math.max(zoneProps[j].pop, 0), 0);
  const avg = (arr) => (pop > 0 ? zs.reduce((s, j) => s + arr[j] * r.pop[j], 0) / pop : 0);
  const change = pop / Math.max(pop0, 1) - 1, accRef = median(Array.from(r.access));
  const one = (x) => {
    const up = unitPop(`z:${countyRep(x)}`), p = up.pop, p0 = up.pop0, c = p / Math.max(p0, 1) - 1;
    return `<tr><td><button class="t link" data-zones-one="${x}">${esc(zoneName(x))}</button> <span class="m">${esc(regionOf(state, zoneProps[x]))}</span></td><td>${fmtPop(p)} <span class="${c >= 0 ? 'pos' : 'neg'}">(${c >= 0 ? '+' : ''}${pct(c)})</span></td></tr>`;
  };
  return `${header(title)}
    <table class="kv">
      <tr><td>인구 (합)</td><td>${fmtPop(pop)} <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>지난해 순이동 (합)</td><td>${Math.round(zs.reduce((s, j) => s + r.netMig[j], 0)).toLocaleString()}명</td></tr>
      ${happiness ? `<tr><td>주민 행복도</td><td>${avg(happiness).toFixed(1)}</td></tr>` : ''}
      <tr><td>HDI</td><td>${avg(r.hdi).toFixed(3)}</td></tr>
      <tr><td>기대수명</td><td>${avg(r.le).toFixed(1)}세</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(avg(r.income)).toLocaleString()}</td></tr>
      <tr><td>접근성 (중앙값=1)</td><td>${(avg(r.access) / accRef).toFixed(2)}</td></tr>
    </table>
    <h4>고른 시군구</h4>
    <table class="kv">${[...reps].sort((a, b) => countyZones(b).reduce((s, j) => s + r.pop[j], 0) - countyZones(a).reduce((s, j) => s + r.pop[j], 0)).map(one).join('')}</table>
    <p class="hint">Shift를 누른 채 시군구를 누르면 더하거나 뺍니다. 평균 값은 인구로 가중합니다.</p>`;
}

/** 옛 이름 되찾기 사업 한 줄 (지역 패널·건설 탭에서 함께 쓴다) */
export function restoreRow(t) {
  const r = RENAME[t.level];
  const proj = state.projects.find((p) => p.kind === 'rename' && p.key === `${t.level === 'zone' ? 'z' : 'u'}:${t.id}`);
  const restored = state.adminNames?.[`${t.level === 'zone' ? 'z' : 'u'}:${t.id}`];
  const status = restored ? '완료 (행정구역 정리)' : proj ? (proj.status === 'done' ? '완료' : `${proj.doneYear}년 완료 예정`) : '';
  return `<div class="item"><div class="t">${esc(t.current)} → ${esc(t.historic)}</div>
    <div class="m">${t.year}년 개칭 · ${esc(t.reason)}</div>
    <div class="row">${status ? `<span class="m">${status}</span>`
      : `<button class="small primary" data-restore="${t.level}:${t.id}">옛 이름 되찾기 ${formatWon(r.cost)} · ${r.years}년 · 행복도 +${r.bonus}</button>`}</div></div>`;
}

export function subPanel(i) {
  const f = subsFC?.features[i];
  const [z] = subInfo(i);
  const name = f ? subName(i) : '소구역';
  if (!result) return header(name);
  const s = result.subs;
  const change = s.pop[i] / Math.max(subPop0[i], 1) - 1;
  return `${header(name)}
    <table class="kv">
      <tr><td>소속</td><td>${esc(subRegion(i))} ${esc(guOfSub(i) || subCountyName(i))}${unitMyeon(i) ? ` ${esc(unitMyeon(i).name)}` : ''}${state.local?.annexSubUnit?.[subKey(i)] ? ` <span class="m">(${esc(zoneName(z))}에서 편입)</span>` : state.local?.annexSub?.[subKey(i)] ? ` <span class="m">(${esc(regionOf(state, zoneProps[z]))}에서 편입)</span>` : ''}</td></tr>
      <tr><td>인구</td><td>${Math.round(s.pop[i]).toLocaleString()}명 <span class="${change >= 0 ? 'pos' : 'neg'}">(${change >= 0 ? '+' : ''}${pct(change)})</span></td></tr>
      <tr><td>인구 밀도</td><td>${Math.round(s.pop[i] / subArea(i)).toLocaleString()}/km²</td></tr>
      <tr><td>대중교통 접근 (대기 포함)</td><td>${Math.round(s.transit[i])}분</td></tr>
      <tr><td>지역 간 철도역 접근 (대기 포함)</td><td>${s.rail[i] >= 120 ? '역 없음' : Math.round(s.rail[i]) + '분'}</td></tr>
      <tr><td>교통 체감 개선 (시작 대비)</td><td class="${(gains?.[i] || 0) >= 0 ? 'pos' : 'neg'}">${(gains?.[i] || 0) >= 0 ? '+' : ''}${(gains?.[i] || 0).toFixed(1)}점</td></tr>
      <tr><td>주민 행복도 · 지지율</td><td>${subMetric('subHappy', i)?.toFixed(0) ?? '–'} · ${Math.round(subMetric('subApproval', i) ?? 0)}%</td></tr>
    </table>
    <p class="hint">해마다 주민 일부가 같은 시군구 안에서 대중교통·철도 접근이 좋고 덜 붐비는 곳으로 옮겨 갑니다. 새 역을 놓으면 주변 인구가 늘어납니다.</p>
    ${annexHTML(i, true)}`;
}

/** 편입 단락: 이 읍면동(북측은 면 전체)을 맞닿은 시·광역시로 */
export function annexHTML(i, one = false) {
  return `${(() => {
      const t = subAnnexAll(i, one);
      if (!t.metro.length && !t.si.length) return '';
      // 리(북측)·동 하나만 옮기는 편입은 그 리·동 창에서, 면 전체는 읍면동 창에서
      const single = one && annexGroup(i).length > 1;
      const what = single ? `${subName(i)} 하나만` : unitMyeon(i) ? `${unitMyeon(i).name} 전체(리 ${annexGroup(i).length}곳)` : '이 읍면동만';
      const note = single ? `${unitMyeon(i)?.name || '읍면'}의 다른 리는 그대로 두고, 면 전체는 읍면동 창에서` : '시군 전체는 그 시군을 눌러서';
      return `<h4>${single ? '동·리 단위 편입' : '읍·면·동 단위 편입'}</h4><p class="hint">${esc(what)} 맞닿은 시·광역시로 옮깁니다 (${esc(note)}). 시군·광역 인구와 경계가 바뀝니다 · ${formatWon(annexSubCost(i))}${annexSubCost(i) < EVENT_COST.annexSub ? ' (지방자치 전이라 중앙 고시만으로, 절반)' : ''}</p>
        <div class="actions">${t.metro.map((r) => `<button class="small" data-annex-sub="${esc(r)}">${esc(r)}에 편입</button>`).join('')}
        ${t.si.map(([u, nm]) => `<button class="small" data-annex-unit="${esc(u)}">${esc(nm)}에 편입</button>`).join('')}</div>`;
    })()}`;
}

/** 읍면동·리 창의 편입 단추 (i: 그 읍면동의 소구역, 북측 면은 면 전체를 옮긴다) */
export function bindAnnexButtons(el, i, one = false) {
  el.querySelectorAll('[data-annex-sub]').forEach((b) => {
    b.onclick = () => {
      const to = b.dataset.annexSub, nm = subName(i) || '읍면동', from = subRegion(i);
      if (!confirm(`${nm}(${from} ${zoneName(subInfo(i)[0])})을(를) ${to}에 편입할까요? ${formatWon(annexSubCost(i))}`)) return;
      if (!payEvent(annexSubCost(i))) return;
      // 광역시 편입: 그 광역시에서 맞닿은 시군(구)으로. 소속표가 광역 단체도 따른다
      const nb = annexGroup(i, one).flatMap((j) => [...subNeighbors(j)]).filter((j) => subRegion(j) === to);
      const cnt = new Map();
      for (const j of nb) cnt.set(subUnit(j), (cnt.get(subUnit(j)) || 0) + 1);
      const dst = [...cnt].sort((x, y) => y[1] - x[1])[0]?.[0];
      for (const j of annexGroup(i, one)) {
        if (dst) setSubUnit(j, dst);
        (state.local.annexSub ||= {})[subKey(j)] = to;
      }
      state.log.unshift(`${state.year}년 ${zoneName(subInfo(i)[0])} ${(!one && unitMyeon(i)?.name) || nm}, ${from}에서 ${to}${dst ? ` ${unitName(dst)}` : ''}로 편입`);
      save(state); drawAdmin(); renderAll();
    };
  });
  // 맞닿은 시로 면 단위 편입 (광역 단체가 다르면 광역 경계도 옮긴다)
  el.querySelectorAll('[data-annex-unit]').forEach((b) => {
    b.onclick = () => {
      const u = b.dataset.annexUnit, nm = (!one && unitMyeon(i)?.name) || subName(i) || '읍면동';
      const toName = unitName(u), from = subCountyName(i);
      if (!confirm(`${nm}(${from})을(를) ${toName}에 편입할까요? ${formatWon(annexSubCost(i))}`)) return;
      if (!payEvent(annexSubCost(i))) return;
      for (const j of annexGroup(i, one)) setSubUnit(j, u);
      state.log.unshift(`${state.year}년 ${from} ${nm}, ${toName}로 편입`);
      save(state); drawAdmin(); renderAll();
    };
  });
}

/** 단계 창 안의 이름을 누르면 그 단계로 (광역 창의 시군구, 읍면동 창의 리) */
export function bindLevelLinks(el) {
  el.querySelectorAll('[data-unit-sel]').forEach((x) => { x.onclick = (e) => { e.preventDefault(); const u = x.dataset.unitSel; select(u.startsWith('split:') ? { type: 'unit', id: u } : { type: 'zone', id: unitRepZone(u) }); }; });
  el.querySelectorAll('[data-sub-sel]').forEach((x) => { x.onclick = (e) => { e.preventDefault(); select({ type: 'sub', id: +x.dataset.subSel }); }; });
  el.querySelectorAll('[data-ri-sel]').forEach((x) => { x.onclick = (e) => { e.preventDefault(); select({ type: 'ri', id: x.dataset.riSel }); }; });
  el.querySelectorAll('[data-emd-sel]').forEach((x) => { x.onclick = (e) => { e.preventDefault(); select({ type: 'emd', id: x.dataset.emdSel }); }; });
  el.querySelectorAll('[data-region-sel]').forEach((x) => { x.onclick = (e) => { e.preventDefault(); select({ type: 'region', id: x.dataset.regionSel }); }; });
}

/** 북측 직할시(평양·남포·개성·라선)를 ○○광역시로 부른다 (단체장은 그대로, 직함만) */
export function metroRename(r) {
  const L = state.local, nw = r.replace(/시$/, '광역시');
  if (!payEvent(EVENT_COST.cityUp)) return;
  (L.renamedRegions ||= {})[r] = nw;
  adminInvalidate();
  const off = L.offices[`g:${r}`];
  if (off) { L.offices[`g:${nw}`] = { ...off, region: nw, title: governorTitle(nw) }; delete L.offices[`g:${r}`]; }
  for (const pr of L.proposals || []) { if (pr.office === `g:${r}`) pr.office = `g:${nw}`; if (pr.region === r) pr.region = nw; }
  if (L.support?.[r]) { L.support[nw] = L.support[r]; delete L.support[r]; }
  state.log.unshift(`${state.year}년 ${r}를 ${nw}로 부릅니다`);
  adminInvalidate();
  syncMayors(); refreshNames(map); save(state);
  if (selection?.type === 'region' && selection.id === r) setSelection({ type: 'region', id: nw });
  renderAll();
}

/** 광역 단체 창: 인구·단체장·정당 지지율·HDI·소득과 시군구 목록 */
export function regionPanel(r) {
  if (!result) return header(r);
  const L = state.local, a = admin(), z = result.zones;
  const pp = provincePops().get(r) || { pop: 0, pop0: 0 }, c = pp.pop / Math.max(pp.pop0, 1) - 1;
  const zs = zoneProps.map((_, j) => j).filter((j) => !zoneProps[j].ext && regionOf(state, zoneProps[j]) === r);
  const zp = zs.reduce((t, j) => t + z.pop[j], 0);
  const avg = (arr) => zs.reduce((t, j) => t + arr[j] * z.pop[j], 0) / Math.max(zp, 1);
  const units = [...(a?.units.values() || [])].filter((u) => u.region === r).map((u) => ({ u, p: a.pop(u.id).pop })).sort((x, y) => y.p - x.p);
  const gov = L?.offices[`g:${r}`];
  const acc = {};
  for (const j of zs) {
    if (!hasAutonomy(state, zoneProps[j])) continue;
    const sup = partySupport(zoneProps[j], L.support?.[r], L.offices[mayorKey(j)]?.party);
    for (const [k, v] of Object.entries(sup)) acc[k] = (acc[k] || 0) + v * z.pop[j];
  }
  const tot = Object.values(acc).reduce((t, v) => t + v, 0), rows = Object.entries(acc).map(([k, v]) => [k, v / (tot || 1)]).sort((x, y) => y[1] - x[1]);
  return `${header(r)}
    <table class="kv">
      <tr><td>구분</td><td>${isMetroCity(r) ? '광역시·특별시' : '도'} · ${isMetroCity(r) ? '산하 군·구' : '산하 시·군'} ${units.length}곳</td></tr>
      <tr><td>인구</td><td>${fmtPop(pp.pop)} <span class="${c >= 0 ? 'pos' : 'neg'}">(${c >= 0 ? '+' : ''}${pct(c)})</span></td></tr>
      <tr><td>단체장</td><td>${gov ? `${esc(gov.title)} ${esc(gov.name)} ${gov.appointed ? '(관선)' : partyBadge(gov.party)}${gov.appointed ? '' : ` · 지지율 ${Math.round(gov.approval)}%`}` : '–'}</td></tr>
      <tr><td>HDI · 1인당 소득</td><td>${avg(z.hdi).toFixed(3)} · $${Math.round(avg(z.income)).toLocaleString()}</td></tr>
      ${happiness ? `<tr><td>주민 행복도</td><td>${avg(happiness).toFixed(1)}</td></tr>` : ''}
      <tr><td>지난해 순이동</td><td>${Math.round(zs.reduce((t, j) => t + z.netMig[j], 0)).toLocaleString()}명</td></tr>
    </table>
    ${tot ? `<div class="m" style="margin-top:6px">정당 지지율 (이 광역 단체)</div>
    <div style="display:flex;height:12px;border-radius:3px;overflow:hidden;margin:3px 0">${rows.map(([k, v]) => `<span title="${esc(PARTIES[k].name)} ${(v * 100).toFixed(1)}%" style="width:${v * 100}%;background:${PARTIES[k].color}"></span>`).join('')}</div>
    <div class="m">${rows.map(([k, v]) => `${partyBadge(k)} ${(v * 100).toFixed(1)}%`).join(' ')}</div>` : ''}
    ${KP_DIRECT_CITIES.includes(r) || KP_DIRECT_CITIES.map(dueum).includes(r) ? `<h4>행정 조정</h4><div class="item"><div class="t">광역시로 명칭 변경: ${esc(r)} → ${esc(r.replace(/시$/, '광역시'))}</div>
      <div class="m">직할시(독립시)를 남측처럼 광역시로 부릅니다. 단체장은 그대로 직함만 바뀌고 선거는 하지 않습니다 · ${formatWon(EVENT_COST.cityUp)}</div>
      <div class="actions"><button class="small primary" data-metro-rename="${esc(r)}">바꾸기</button></div></div>` : ''}
    <h4>${isMetroCity(r) ? '산하 군·구' : '산하 시·군'} (인구 순)</h4>
    <table class="kv">${units.slice(0, 60).map(({ u, p }) => `<tr><td><a href="#" data-unit-sel="${esc(u.id)}">${esc(u.name)}</a>${u.split ? ' <span class="m">신설</span>' : ''}</td><td>${fmtPop(p)}</td></tr>`).join('')}</table>
    <p class="hint">같은 자리를 다시 누르면 ${isMetroCity(r) ? '군·구' : '시·군'} → 읍면동 → 리 순으로 내려갑니다.</p>`;
}

/** 남측 법정리 창: 추정 인구·면적·밀도와 그 읍면의 교통 접근 */
export function riPanel(code) {
  const r = riCodeMap?.get(code);
  if (!r) return header('리');
  const i = r.sub, s0 = result?.subs, area = riFeat.get(code)?.properties.area;
  if (!s0) return header(r.name);
  const p = riPopOf(code), c = s0.pop[i] / Math.max(subPop0[i], 1) - 1, emd = admin()?.emdOf[i] || `s:${i}`;
  return `${header(r.name)}
    <table class="kv">
      <tr><td>소속</td><td><a href="#" data-region-sel="${esc(subRegion(i))}">${esc(subRegion(i))}</a> <a href="#" data-unit-sel="${esc(subUnit(i))}">${esc(subCountyName(i))}</a> <a href="#" data-emd-sel="${esc(emd)}">${esc(subName(i))}</a></td></tr>
      <tr><td>추정 인구</td><td>${Math.round(p).toLocaleString()}명 <span class="${c >= 0 ? 'pos' : 'neg'}">(${c >= 0 ? '+' : ''}${pct(c)})</span> <span class="m">· ${esc(subName(i))}의 ${pct(r.share, 0)}</span></td></tr>
      ${area ? `<tr><td>면적 · 밀도</td><td>${area.toFixed(1)}km² · ${Math.round(p / Math.max(area, 0.01)).toLocaleString()}명/km²</td></tr>` : ''}
      <tr><td>대중교통 접근 (대기 포함)</td><td>${Math.round(s0.transit[i])}분 <span class="m">(${esc(subName(i))})</span></td></tr>
      <tr><td>지역 간 철도역 접근 (대기 포함)</td><td>${s0.rail[i] >= 120 ? '역 없음' : `${Math.round(s0.rail[i])}분`}</td></tr>
      <tr><td>법정리 코드</td><td class="m">${esc(code)}</td></tr>
    </table>
    <p class="hint">남측 법정리입니다. 교통·인구 계산은 읍면동 단위라, 리 인구는 읍면동 인구를 1km 인구 격자로 나눈 어림입니다. 같은 자리를 다시 누르면 광역 단체로 돌아갑니다.</p>
    ${riAnnexHTML(code)}`;
}

/**
 * 남측 법정리를 편입할 수 있는 곳: 원래 읍면동의 이웃 가운데 리 경계가 실제로 맞닿는(꼭짓점이 약 300m 안) 시·광역시.
 * 리와 읍면동 경계는 출처가 달라 꼭짓점을 같이 쓰지 않으므로 거리로 본다
 */
export function riAnnexTargets(code) {
  const r = riCodeMap?.get(code), f = riFeat.get(code);
  if (!r || !f || zoneProps[subInfo(r.sub)[0]].country !== 'KR') return { metro: [], si: [] };
  const all = subAnnexAll(r.sub, true), ring = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flatMap((pg) => pg[0]);
  const rp = ring(f.geometry), step = Math.max(1, Math.floor(rp.length / 200)), pts = rp.filter((_, k) => k % step === 0);
  const near = (j) => {
    const g = subsFC?.features[j]?.geometry;
    if (!g) return false;
    const q = ring(g), tol = 0.003;
    return pts.some(([x, y]) => q.some(([u, v]) => Math.abs(u - x) < tol && Math.abs(v - y) < tol));
  };
  const nb = [...subNeighbors(r.sub)].filter((j) => subUnit(j) !== subUnit(r.sub) && near(j));
  return { metro: all.metro.filter((m) => nb.some((j) => subRegion(j) === m)), si: all.si.filter(([u]) => nb.some((j) => subUnit(j) === u)) };
}

/** 리 창의 편입 단락: 이 리만 떼어 맞닿은 시·광역시로 */
export function riAnnexHTML(code) {
  const r = riCodeMap?.get(code);
  if (!r) return '';
  const t = riAnnexTargets(code);
  if (!t.metro.length && !t.si.length) return '';
  return `<h4>리 단위 편입</h4><p class="hint">${esc(r.name)}만 ${esc(subName(r.sub))}에서 떼어 맞닿은 시·광역시로 옮깁니다. 떼어 낸 리는 그 뒤로 따로 계산합니다(인구 이동·교통 접근) · ${formatWon(annexSubCost(r.sub))}</p>
    <div class="actions">${t.metro.map((m) => `<button class="small" data-ri-annex="metro" data-ri-target="${esc(m)}">${esc(m)}에 편입</button>`).join('')}
    ${t.si.map(([u, nm]) => `<button class="small" data-ri-annex="unit" data-ri-target="${esc(u)}">${esc(nm)}에 편입</button>`).join('')}</div>`;
}

/** 리 창의 편입 단추: 리를 새 소구역으로 뗀 뒤 옮긴다 (risplit.js) */
export function bindRiAnnex(el, code) {
  el.querySelectorAll('[data-ri-annex]').forEach((b) => {
    b.onclick = async () => {
      const r = riCodeMap?.get(code), kind = b.dataset.riAnnex, to = b.dataset.riTarget;
      if (!r || busy) return;
      const toName = kind === 'unit' ? unitName(to) : to, from = `${subRegion(r.sub)} ${subCountyName(r.sub)}`, cost = annexSubCost(r.sub);
      if (!confirm(`${r.name}(${from} ${subName(r.sub)})을(를) ${toName}에 편입할까요? 리를 따로 계산하도록 떼어 냅니다. ${formatWon(cost)}`)) return;
      if (!payEvent(cost)) return;
      const g = await splitRi(code);
      if (g < 0) { alert('이 리의 경계를 찾지 못해 편입하지 못했습니다.'); return; }
      if (kind === 'unit') setSubUnit(g, to);
      else {
        // 광역시 편입: 그 광역시에서 맞닿은 시군(구)으로
        const cnt = new Map();
        for (const j of subNeighbors(g)) if (subRegion(j) === to) cnt.set(subUnit(j), (cnt.get(subUnit(j)) || 0) + 1);
        const dst = [...cnt].sort((x, y) => y[1] - x[1])[0]?.[0];
        if (dst) setSubUnit(g, dst);
        (state.local.annexSub ||= {})[subKey(g)] = to;
      }
      state.log.unshift(`${state.year}년 ${from} ${subName(r.sub)} ${r.name}, ${toName}로 편입 (리를 따로 떼어 계산)`);
      save(state); drawAdmin(); select({ type: 'sub', id: g }); renderAll();
    };
  });
}

/** 읍면동 창 (북측은 1945년 면: 그 리들을 합친 값). 리가 여럿이면 리 목록 */
export function emdPanel(key) {
  const a = admin(), g = a?.emds.get(key);
  if (!g) return header('읍면동');
  const i0 = g.subs[0], s0 = result?.subs, many = g.subs.length > 1;
  const name = many ? g.name : subName(i0);
  if (!s0) return header(name);
  const p = g.subs.reduce((t, i) => t + s0.pop[i], 0), p0 = g.subs.reduce((t, i) => t + (subPop0[i] || 0), 0), c = p / Math.max(p0, 1) - 1;
  const area = g.subs.reduce((t, i) => t + subArea(i), 0);
  const wavg = (f) => { let t = 0, w = 0; for (const i of g.subs) { const v = f(i); if (v == null) continue; t += v * Math.max(s0.pop[i], 1); w += Math.max(s0.pop[i], 1); } return w ? t / w : null; };
  const rail = wavg((i) => s0.rail[i]), happy = wavg((i) => subMetric('subHappy', i)), gu = guOfSub(i0);
  return `${header(name)}
    <table class="kv">
      <tr><td>소속</td><td><a href="#" data-region-sel="${esc(subRegion(i0))}">${esc(subRegion(i0))}</a> <a href="#" data-unit-sel="${esc(subUnit(i0))}">${esc(subCountyName(i0))}</a>${gu ? ` ${esc(gu)}` : ''}</td></tr>
      <tr><td>인구</td><td>${Math.round(p).toLocaleString()}명 <span class="${c >= 0 ? 'pos' : 'neg'}">(${c >= 0 ? '+' : ''}${pct(c)})</span></td></tr>
      <tr><td>면적 · 밀도</td><td>${area.toFixed(1)}km² · ${Math.round(p / Math.max(area, 0.01)).toLocaleString()}명/km²</td></tr>
      <tr><td>대중교통 접근 (대기 포함)</td><td>${Math.round(wavg((i) => s0.transit[i]))}분</td></tr>
      <tr><td>지역 간 철도역 접근 (대기 포함)</td><td>${rail >= 120 ? '역 없음' : `${Math.round(rail)}분`}</td></tr>
      ${happy != null ? `<tr><td>주민 행복도</td><td>${happy.toFixed(0)}</td></tr>` : ''}
    </table>
    ${!many && krRi?.[i0]?.length ? `<h4>법정리 ${krRi[i0].length}곳 (추정 인구 순)</h4>
    <table class="kv">${[...krRi[i0]].sort((x, y) => y[1] - x[1]).map(([nm, sh, code]) => `<tr><td><a href="#" data-ri-sel="${esc(code)}">${esc(nm)}</a>${splitSubOf(code) >= 0 ? ` <span class="m">편입 · ${esc(subCountyName(splitSubOf(code)))}</span>` : ''}</td><td>${Math.round(riPopOf(code)).toLocaleString()}명</td></tr>`).join('')}</table>` : ''}
    ${many ? `<h4>리 ${g.subs.length}곳 (인구 순)</h4>
    <table class="kv">${[...g.subs].sort((x, y) => s0.pop[y] - s0.pop[x]).slice(0, 60).map((i) => `<tr><td><a href="#" data-sub-sel="${i}">${esc(subName(i))}</a></td><td>${Math.round(s0.pop[i]).toLocaleString()}명</td></tr>`).join('')}</table>` : ''}
    ${annexHTML(i0)}
    <p class="hint">같은 자리를 다시 누르면 ${many ? '리 → ' : ''}광역 단체로 돌아갑니다.</p>`;
}

/** 새로 세운 시군 창: 소속·인구·읍면동·단체장·정당 지지율, 이름 바꾸기·다시 합치기 */
export function unitPanel(id) {
  const a = admin(), u = a?.unit(id);
  if (!u) return header('시군');
  const L = state.local, off = L.offices[unitOfficeKey(id)], p = unitPop(id), c = p.pop / Math.max(p.pop0, 1) - 1;
  const emds = [...new Set(u.subs.map((i) => a.emdOf[i]))].map((k) => a.emds.get(k));
  const area = u.subs.reduce((t, i) => t + subArea(i), 0), rep = unitRepZone(id);
  const sup = partySupport(zoneProps[rep], L.support?.[u.region], off?.party);
  const rows = Object.entries(sup).sort((x, y) => y[1] - x[1]);
  return `${header(u.name)}
    <table class="kv">
      <tr><td>소속</td><td>${esc(u.region)} · ${u.kind === 'gu' ? '자치구' : u.kind === 'gun' ? '군' : '시'} · ${u.year}년 신설 (${esc((u.home || '').split('|')[1] || '')}에서)</td></tr>
      <tr><td>인구</td><td>${result ? `${fmtPop(p.pop)} <span class="${c >= 0 ? 'pos' : 'neg'}">(${c >= 0 ? '+' : ''}${pct(c)})</span>` : '–'}</td></tr>
      <tr><td>면적 · 밀도</td><td>${Math.round(area).toLocaleString()}km² · ${result ? Math.round(p.pop / Math.max(area, 1)).toLocaleString() : '–'}명/km²</td></tr>
      <tr><td>단체장</td><td>${off ? `${esc(off.title)} ${esc(off.name)} ${partyBadge(off.party)} · 지지율 ${Math.round(off.approval)}%` : '없음 (지방자치 전)'}</td></tr>
      <tr><td>읍면동 ${emds.length}곳</td><td class="m" style="white-space:normal">${emds.map((e) => esc(riToDong(e.subs[0], e.name))).join(' · ')}</td></tr>
    </table>
    <div class="m" style="margin-top:6px">정당 지지율 (이 시군)</div>
    <div style="display:flex;height:12px;border-radius:3px;overflow:hidden;margin:3px 0">${rows.map(([k, v]) => `<span title="${esc(PARTIES[k].name)} ${(v * 100).toFixed(1)}%" style="width:${v * 100}%;background:${PARTIES[k].color}"></span>`).join('')}</div>
    <div class="m">${rows.map(([k, v]) => `${partyBadge(k)} ${(v * 100).toFixed(1)}%`).join(' ')}</div>
    ${splitAdminHTML(id)}
    <h4>이름 바꾸기</h4>
    <div class="name-row"><input type="text" id="unit-name" value="${esc(u.name)}"><button class="small" id="unit-rename">바꾸기</button></div>
    <div class="actions"><button class="small" data-merge-split="${esc(id)}">원래 시군에 다시 합치기</button></div>
    <p class="hint">시군구 신설로 세운 시군입니다. 교통·인구 계산은 원래 계산 단위(존)로 하고, 인구·단체장·선거·지도 색은 이 시군의 읍면동으로 셉니다.</p>`;
}

/** 새 시군 창의 행정 조정: 군 → 시 승격, 동으로 바꿀 읍면, 일반구로 분구 (광역시 안 구·군은 없음) */
export function splitAdminHTML(id) {
  const L = state.local, u = admin()?.unit(id), S = L.splitUnit?.[id];
  if (!u || !S) return '';
  const metro = isMetroCity(u.region), rows = [];
  const item = (t, m, act) => `<div class="item"><div class="t">${t}</div><div class="m">${m}</div><div class="row" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:4px">${act}</div></div>`;
  if (!metro && u.kind === 'gun') {
    rows.push(item(`군 → 시 승격: ${esc(u.name)} → ${esc(u.name.replace(/군$/, '시'))}`, `군수 대신 시장을 뽑습니다. 시에는 읍면동을 모두 둘 수 있어, 승격하면서 동으로 바꿀 읍면을 고릅니다 · ${formatWon(EVENT_COST.cityUp)}`,
      '<button class="small primary" data-split-up>시로 승격</button>'));
  }
  // 구는 광역시·시에만 둔다: 도 밑의 군은 구를 둘 수 없고, 광역시 밑의 군은 통째로 구가 될 수 있다
  if (metro && u.kind === 'gun') {
    rows.push(item(`구로 전환: ${esc(u.name)} → ${esc(u.name.replace(/군$/, '구'))}`, `광역시의 군을 자치구로 바꿉니다(군수 → 구청장) · ${formatWon(EVENT_COST.cityUp)}`,
      '<button class="small primary" data-split-gungu>구로 전환</button>'));
  }
  if (!metro && u.kind === 'si') {
    const n = (L.dongMyeon?.[id] || []).length;
    rows.push(item('동으로 바꿀 읍면', `시가지가 된 읍면을 동으로 (지금 ${n}곳)`, '<button class="small" data-split-dong>고르기</button>'));
    const b = L.bungu?.[id];
    if (b) {
      const names = [...new Set(Object.values(b.gu))].sort((x, y) => x.localeCompare(y, 'ko'));
      rows.push(item(`일반구: ${names.map(esc).join('·')}`, '시장이 구청장을 임명합니다. 구 하나를 다시 여러 구로 나눌 수도 있습니다',
        `<select id="gu-split-name" class="small">${names.map((g) => `<option>${esc(g)}</option>`).join('')}</select> ${bunguSelect('gu-split-n', null, 2)} <button class="small" data-gu-split="${esc(id)}">구 나누기</button> <button class="small" data-gu-adjust="${esc(id)}">구 이름·경계 고치기</button> <button class="small" data-split-unbungu>분구 풀기</button>`));
    } else if (new Set(u.subs.map((i) => admin().emdOf[i])).size >= 4) {
      rows.push(item('일반구로 분구', `시를 일반구 여럿으로 나눕니다 (구청장은 시장이 임명, 선거 없음) · ${formatWon(EVENT_COST.cityUp)}`,
        `${bunguSelect('split-bungu-n', '나누지 않음', 2)} <button class="small primary" data-split-bungu>분구</button>`));
    }
  }
  return rows.length ? `<h4>행정 조정</h4><div class="list">${rows.join('')}</div>` : '';
}

/** 새 시군: 동으로 바꿀 읍면 고르기 (남측은 읍·면, 북측은 1945년 면) */
export function splitDongDialog(id, then = null) {
  const L = state.local, a = admin(), u = a?.unit(id);
  if (!u) return;
  const kp = zoneProps[subInfo(u.subs[0])[0]].country === 'KP';
  const list = new Map();
  for (const i of u.subs) {
    const raw = subsFC?.features[i]?.properties.name || '', key = kp ? kpMyeon?.[i] : raw;
    if (!key || (!kp && !/[읍면]$/.test(raw))) continue;
    const e = list.get(key) || { name: key, n: 0, pop: 0 };
    e.n++; e.pop += result ? result.subs.pop[i] : 0;
    list.set(key, e);
  }
  if (!list.size) { then?.(); return; }
  const cur = new Set(L.dongMyeon?.[id] || []);
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true"><h2>동으로 바꿀 읍면 · ${esc(u.name)}</h2>
    <p class="setup-intro hint">군에는 읍·면만 두지만 시에는 읍·면·동을 모두 둘 수 있습니다. 시가지가 된 읍면을 고르면 동이 됩니다${kp ? '(그 면의 리는 ○○동으로 하나씩 보입니다)' : '(○○읍 → ○○동)'}.</p>
    <div class="actions setup-quick"><button class="small" data-q="all">모두</button><button class="small" data-q="none">하나도 안 바꿈</button><button class="small" data-q="eup">읍만</button></div>
    <div class="setup-body"><div class="list">${[...list.values()].sort((x, y) => y.pop - x.pop).map((e) => `<label class="item" style="display:flex;gap:8px;align-items:center">
      <input type="checkbox" data-myeon="${esc(e.name)}" ${cur.has(e.name) ? 'checked' : ''}><span class="t" style="flex:1">${esc(e.name)}</span>
      <span class="m">${kp ? `리 ${e.n}곳 · ` : ''}${result ? fmtPop(e.pop) : ''}</span></label>`).join('')}</div></div>
    <div class="setup-btns"><span style="flex:1"></span><button class="small primary" data-ok>정하기</button></div></div>`;
  document.body.appendChild(wrap);
  const boxes = () => [...wrap.querySelectorAll('[data-myeon]')];
  wrap.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => boxes().forEach((x) => { x.checked = b.dataset.q === 'all' || (b.dataset.q === 'eup' && /읍$/.test(x.dataset.myeon)); }); });
  wrap.querySelector('[data-ok]').onclick = () => {
    (L.dongMyeon ||= {})[id] = boxes().filter((x) => x.checked).map((x) => x.dataset.myeon);
    wrap.remove();
    adminInvalidate();
    save(state); refreshNames(map); renderAll();
    then?.();
  };
}

/** 구 나누기 단추 (시군 창·새 시군 창) */
export function bindGuSplit(el) {
  el.querySelectorAll('[data-gu-adjust]').forEach((x) => { x.onclick = () => guNamingDialog(x.dataset.guAdjust, { noResplit: true }); });
  el.querySelector('[data-gu-split]')?.addEventListener('click', (e) => {
    const unit = e.currentTarget.dataset.guSplit, gu = el.querySelector('#gu-split-name')?.value, n = +(el.querySelector('#gu-split-n')?.value || 1);
    const b = state.local.bungu?.[unit];
    if (!b || !gu || n < 2) { toast('나눌 구와 구 수를 고르세요.'); return; }
    const only = new Set();
    for (const z of unitZones(unit)) zoneProps[z].subs.forEach((_, k) => { const i = zoneProps[z].sub0 + k; if (b.gu[subKey(i)] === gu) only.add(i); });
    if (only.size < n) { toast('읍면동이 모자라 그만큼 나눌 수 없습니다.'); return; }
    if (!payEvent(EVENT_COST.cityUp)) return;
    if (!makeBungu(unit, n, { general: !!b.general, only, splitGu: gu })) { toast('나눌 수 없습니다.'); return; }
    syncMayors();
    drawBungu(); refreshNames(map); save(state); renderAll();
    guNamingDialog(unit, { noResplit: true });   // 새 구 이름과 경계(동 누르기)를 고친다
  });
}

export function bindUnitPanel(el) {
  bindGuSplit(el);
  const id = selection.id, L = state.local;
  el.querySelector('[data-split-up]')?.addEventListener('click', () => {
    const S = L.splitUnit?.[id];
    if (!S || !payEvent(EVENT_COST.cityUp)) return;
    const to = S.name.replace(/군$/, '시');
    state.log.unshift(`${state.year}년 ${S.name} → ${to} 승격`);
    S.name = to;
    adminInvalidate();
    syncMayors(); save(state); drawAdmin(); renderAll();
    splitDongDialog(id);
  });
  el.querySelector('[data-split-dong]')?.addEventListener('click', () => splitDongDialog(id));
  el.querySelector('[data-split-gungu]')?.addEventListener('click', () => {
    const S = L.splitUnit?.[id];
    if (!S || !payEvent(EVENT_COST.cityUp)) return;
    const to = S.name.replace(/군$/, '구');
    state.log.unshift(`${state.year}년 ${S.name} → ${to} (자치구)`);
    S.name = to;
    adminInvalidate();
    syncMayors(); save(state); drawAdmin(); renderAll();
  });
  el.querySelector('[data-split-bungu]')?.addEventListener('click', () => {
    const n = +(el.querySelector('#split-bungu-n')?.value || 1);
    if (n < 2) { toast('나눌 구 수를 고르세요.'); return; }
    if (!payEvent(EVENT_COST.cityUp)) return;
    if (!makeBungu(id, n, { general: true })) { toast('읍면동이 모자라 그만큼 나눌 수 없습니다.'); return; }
    state.log.unshift(`${state.year}년 ${L.splitUnit[id].name} 일반구 ${n}곳으로 분구`);
    save(state); drawBungu(); refreshNames(map); renderAll();
    guNamingDialog(id);   // 구 이름과 경계(동 누르기)를 고친다
  });
  el.querySelector('[data-split-unbungu]')?.addEventListener('click', () => {
    if (!confirm('일반구를 없앨까요?')) return;
    delete L.bungu[id];
    state.log.unshift(`${state.year}년 ${L.splitUnit[id].name} 일반구 폐지`);
    save(state); drawBungu(); refreshNames(map); renderAll();
  });
  el.querySelector('#unit-rename')?.addEventListener('click', () => {
    const v = el.querySelector('#unit-name').value.trim(), S = state.local.splitUnit?.[selection.id];
    if (!S || !v || v === S.name) return;
    if (/군$/.test(v) && admin().unit(selection.id).subs.some((i) => /동$/.test(subName(i)))) { alert('군에는 읍·면만 둘 수 있습니다.'); return; }
    state.log.unshift(`${state.year}년 ${S.name}을(를) ${v}(으)로 부릅니다`);
    S.name = v;
    adminInvalidate();
    syncMayors(); save(state); drawAdmin(); renderAll();
  });
  el.querySelectorAll('[data-merge-split]').forEach((b) => { b.onclick = () => { if (confirm('원래 시군에 다시 합칠까요?')) mergeSplitUnit(b.dataset.mergeSplit); }; });
}

export function airportPanel(id) {
  const ap = effectiveNetwork(base, state).airports.find((a) => a.id === id);
  if (!ap) return header('공항');
  const k = result?.air.ids.indexOf(id) ?? -1;
  const pax = k >= 0 ? result.air.pax[k] : 0, cap = (ap.cap * 1e6) / 365;
  const busyProj = state.projects.find((p) => p.status === 'building' && p.airport === id);
  const cost = Math.round(AIRPORT.expand.cost * (ap.country === 'KP' ? KP_COST_FACTOR : 1));
  return `${header(ap.name)}
    <table class="kv">
      <tr><td>구분</td><td>${ap.ext ? '국외 공항' : ap.intl ? '국제공항' : '국내공항'}</td></tr>
      <tr><td>일 여객 (출발+도착)</td><td>${Math.round(pax).toLocaleString()}명</td></tr>
      <tr><td>용량</td><td>연 ${ap.cap}백만 명 (일 ${Math.round(cap).toLocaleString()}명)</td></tr>
      <tr><td>혼잡도 (V/C)</td><td class="${pax > cap ? 'neg' : ''}">${(pax / cap).toFixed(2)}</td></tr>
    </table>
    ${ap.ext ? '' : airportRailHTML(id, k)}
    ${ap.ext ? '' : busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>`
      : `<div class="actions"><button class="small primary" id="ap-expand">${AIRPORT.expand.label} ${formatWon(cost)} · ${AIRPORT.expand.years}년</button></div>`}
    ${!ap.ext && !ap.intl && /^NEW/.test(id) ? `<div class="actions"><button class="small" id="ap-intl">국제공항 지정 · ${formatWon(AIR.intlCost)}</button></div>
      <p class="hint">새 공항은 국내선만 뜹니다. 국제공항으로 지정하면(세관·출입국·검역) 가까운 나라 국제선이 열립니다. 장거리(동남아·미주·유럽·대양주)는 허브인 인천에서만 뜹니다.</p>` : ''}
    ${ap.hub ? '<p class="hint">허브 공항: 국제선 운항·연결편이 많아 둘레 300km 안에서 국제선을 타러 오고, 장거리 노선이 여기서만 뜹니다. 혼잡도가 1.1을 넘는 공항에는 새 노선이 생기지 않습니다.</p>' : ''}
    ${routePanel(id, k)}`;
}

/** 공항 패널: 공항역(철도 연결) */
export function airportRailHTML(id, k) {
  const st = k >= 0 ? result?.air.railStation?.[k] : -1;
  if (st >= 0) {
    const n = nodeNames().get(st);
    return `<p class="hint">공항역: <b>${esc(n?.name || '역')}</b> · ${linesAt(st).filter((l) => l.named).map((l) => esc(l.name)).join(', ')}. 철도로 오는 편이 빠른 지역은 철도로 공항에 옵니다.</p>`;
  }
  return '<p class="hint">공항역이 없습니다. 건설 탭에서 철도·도시철도를 그리며 공항 아이콘 가까이를 누르면 공항역이 생기고, 완공되면 철도로 공항에 올 수 있어 공항 이용이 늘어납니다.</p>';
}

export function airportName(id) {
  // 망 전체(effectiveNetwork)를 만들지 않고 공항 목록만 본다: 통계 탭이 노선마다 불러 1.6초를 썼다
  const a = (base.airports || []).find((x) => x.id === id) || (state.newAirports || []).find((x) => x.id === id);
  return a?.name.replace(/\s*(국제공항|공항|비행장)$/, '').trim() || id;
}

/** 공항 패널의 노선 목록: 운항 중 노선(여객·탑승률), 잠재 수요가 큰 미취항 노선, 직접 개설 */
export function routePanel(id, k) {
  if (!result || k < 0) return '';
  const air = result.air, seats = air.seats;
  const mine = air.routes.filter(([a, b]) => a === k || b === k);
  const latent = air.latent.filter(([a, b]) => a === k || b === k).slice(0, 5);
  const ORIGIN = { base: '기존', auto: '자동 취항', manual: '직접 개설' };
  const aps = effectiveNetwork(base, state).airports;
  const here = aps.find((a) => a.id === id);
  const options = aps.filter((a) => a.id !== id && !state.air.routes[routeKey(id, a.id)])
    .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  return `<h4>운항 노선 (${mine.length})</h4>
    <div class="list">${mine.map(([a, b, pax, f]) => {
      const other = air.ids[a === k ? b : a];
      const key = routeKey(id, other);
      const r = state.air.routes[key];
      const load = pax / (2 * f * seats);
      return `<div class="item opt"><div class="opt-row">
        <span>${esc(airportName(other))} · 하루 ${f}회 · ${pax.toLocaleString()}명 · 탑승률 <span class="${load > 1 ? 'neg' : ''}">${Math.round(load * 100)}%</span>
          <span class="m">${ORIGIN[r?.origin] || ''}</span><br>${airlinesHTML(id, other, f)}</span>
        <button class="small" data-close-route="${key}">운항 중단</button></div></div>`;
    }).join('') || '<p class="hint">운항 중인 노선이 없습니다.</p>'}</div>
    ${latent.length ? `<h4>잠재 수요가 큰 미취항 노선</h4><div class="list">${latent.map(([a, b, pax]) => {
      const other = air.ids[a === k ? b : a];
      return `<div class="item opt"><div class="opt-row">
        <span>${esc(airportName(other))} · 하루 약 ${pax.toLocaleString()}명</span>
        <button class="small primary" data-open-route="${other}">개설 ${formatWon(AIR.openCost * (here.country !== aps.find((x) => x.id === other)?.country ? 1.5 : 1))}</button></div></div>`;
    }).join('')}</div>` : ''}
    <h4>노선 직접 개설</h4>
    <div class="name-row"><select id="route-dest">${options}</select>
      <button class="small primary" id="route-open">개설 (취항 지원 ${formatWon(AIR.openCost)}~)</button></div>
    <p class="hint">${state.air.auto ? '자동 운영 중: 항공사가 수요에 따라 운항 횟수를 맞추고, 잠재 수요가 하루 1,500명을 넘는 노선에 취항하며, 2년 연속 200명 미만이면 철수합니다. 직접 연 노선은 철수하지 않습니다.' : '자동 운영이 꺼져 있습니다 (설정 탭).'}</p>`;
}

export function nodePanel(id) {
  const n = nodeNames().get(id);
  if (!n) return header('노드');
  // 국외 거점 도시는 '해외 도시', 도로 없는 섬의 항구(독도)는 대한민국의 섬
  const abroad = n.kind === 'city' ? foreignCountry(id) : null;
  const island = n.kind === 'city' && !abroad;
  const kindLabel = { station: '역', IC: 'IC', JCT: 'JCT', rest: '휴게소' }[n.kind] || (abroad ? '해외 도시' : island ? '섬' : '');
  const origin = n.isNew ? (state.names[id]?.auto ? ' · 자동 이름' : ' · 직접 지은 이름') : n.kind === 'city' ? '' : ' · 기존 시설 (OSM)';
  return `${header(n.name)}
    <p class="hint">${kindLabel}${origin}</p>
    ${n.kind === 'city' ? placeIntroHTML(n.name, abroad || 'KR') : ''}
    ${n.kind === 'station' ? stationPanel(id, n) : ''}
    ${n.kind === 'rest' ? `<div class="actions"><button class="small" id="rest-del">휴게소 철거 (${formatWon(REST_REMOVE_COST)})</button></div>` : ''}
    ${(n.kind === 'IC' || n.kind === 'JCT') && n.isNew ? `<div class="actions"><button class="small" id="ic-del">${n.kind} 철거 (${formatWon(IC_REMOVE_COST)})</button></div>
      <p class="hint">게임에서 놓은 ${n.kind}입니다. 철거하면 이름을 지우고 연결도로를 걷어 냅니다(고속도로 본선은 그대로). 짓는 중이면 그 사업을 접습니다.</p>` : ''}
    <h4>이름</h4>
    <div class="name-row"><input type="text" id="node-name" value="${esc(n.name)}">
      <button class="small" id="node-save">바꾸기</button>
      <button class="small" id="node-auto" title="자동 이름">↻</button></div>`;
}

// 해마다 일어나는 사건과 사업 비교(A·B·C안).
import { appraisalHTML, appraise, opexFor, regionOf as appraisalRegion } from '../game/appraisal.js';
import { formatWon, resolve } from '../game/catalog.js';
import { isKP, linkAt, NEW_BUILDS, save, splitLink, startNewBuild, startUpgrade, UPGRADES } from '../game/state.js';
import { loadTerrain, terrainReady, terrainRule } from '../game/terrain.js';
import { kmBetween } from '../sim/model.js';
import { $, base, CLASS_LABEL, draft, esc, result, state, zoneProps } from './core.js';
import { autoYears } from './year.js';
import { nodeCoord } from './mapdata.js';
import { nearestNode, nearestOnLink } from './draw.js';
import { draftCost, draftLineName, draftNames, nameDraftPoint } from './route.js';
import { renderAll, renderBuild } from './panels.js';
import { autoJCTs } from './plans.js';
import { straight, straightNames, straightPoints } from './straighten.js';
import { buildNow, runPreview } from './preview.js';
import { airportName } from './selpanel.js';

// ------------------------------------------------------------ 해마다 일어나는 사건

/** 국제 행사 후보 도시: 광역시·평양 (가장 인구가 많은 구) + 북측 큰 도시 */
export function bigCities() {
  const out = [];
  for (const prov of ['부산광역시', '인천광역시', '대구광역시', '광주광역시', '대전광역시', '평양시']) {
    let best = -1;
    zoneProps.forEach((z, i) => { if (!z.ext && z.province === prov && (best < 0 || z.pop > zoneProps[best].pop)) best = i; });
    if (best >= 0) out.push([prov.replace(/(광역시|시)$/, ''), best]);
  }
  for (const nm of ['원산시', '함흥시', '청진시', '신의주시']) {
    const i = zoneProps.findIndex((z) => z.name === nm && !z.ext);
    if (i >= 0) out.push([nm.replace(/시$/, ''), i]);
  }
  return out;
}

export function showEvent(ev) {
  const decide = (k) => {
    const msg = ev.choices[k].apply(state);
    (state.events ||= []).push({ key: ev.key, year: state.year, choice: k });
    state.log.unshift(`${state.year}년 ${msg}`);
    save(state); renderAll();
  };
  if (autoYears > 0) { decide(0); return; }
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true"><h2>${esc(ev.title)}</h2>
    <p class="setup-intro">${esc(ev.body)}</p>
    <div class="setup-btns" style="flex-direction:column;align-items:stretch">${ev.choices.map((c, k) => `<button class="${k ? '' : 'primary'}" data-ev-choice="${k}">${esc(c.label)}</button>`).join('')}</div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ev-choice]');
    if (!b) return;
    wrap.remove();
    decide(+b.dataset.evChoice);
  });
}

// ------------------------------------------------------------ 사업 비교 (A·B·C안)

/** 마지막 효과 미리보기를 비교 목록에 담는다 (세 개까지, 넘치면 오래된 것부터 뺀다) */
export function addCompare() {
  const p = lastPreview;
  if (!p) return;
  const a = p.appraisal;
  const built = previewBuilt();
  const list = (state.compare ||= []);
  list.push({ title: p.title, year: state.year, cost: built.cost, years: built.years, km: built.km,
    newUse: Math.round(p.newUse), dRail: Math.round(p.dRail), dTrips: Math.round(p.dTrips), dVhm: Math.round(p.dVhm),
    congB: Math.round(p.congB), congA: Math.round(p.congA), bc: a ? +a.bc.toFixed(2) : null, ahp: a ? +a.ahp.toFixed(3) : null, npv: a ? Math.round(a.npv) : null });
  while (list.length > 3) list.shift();
  save(state); renderBuild();
}
/** 미리보기한 사업의 사업비·공기·길이 (그리기 중이면 그 노선) */
export function previewBuilt() {
  if (draft && draft.type !== 'airport' && draft.points.length > 1) { const d = draftCost(); return { cost: d.cost, years: d.years, km: d.km }; }
  const e = lastPreview?.extra || {};
  return { cost: e.cost ?? null, years: e.years ?? null, km: e.km ?? null };
}

export function compareHTML() {
  const list = state.compare || [];
  if (!list.length) return '';
  const L = 'ABC';
  const best = (k, hi = true) => { const v = list.map((x) => x[k]).filter((x) => x != null); return v.length ? (hi ? Math.max(...v) : Math.min(...v)) : null; };
  const cell = (x, k, fmt, hi = true) => { const b = best(k, hi); const v = x[k]; return `<td class="num ${v != null && v === b && list.length > 1 ? 'good' : ''}">${v == null ? '-' : fmt(v)}</td>`; };
  const sg = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString()}`;
  const rows = [
    ['B/C', 'bc', (v) => v.toFixed(2)], ['AHP', 'ahp', (v) => v.toFixed(3)], ['순현재가치', 'npv', (v) => formatWon(v)],
    ['사업비', 'cost', (v) => formatWon(v), false], ['철도 이용 변화 (명/일)', 'dRail', sg], ['유발 통행 (통행/일)', 'dTrips', sg],
    ['도로 차량 시간 (대·시간/일)', 'dVhm', sg, false], ['정체 도로 뒤 (km)', 'congA', (v) => v.toLocaleString(), false], ['새 구간 최대 이용', 'newUse', (v) => v.toLocaleString()],
  ];
  return `<details class="fold" open><summary>사업 비교 (${list.length})</summary>
    <table class="report-t cmp-t"><tr><td></td>${list.map((x, i) => `<td class="num"><b>${L[i]}안</b><div class="m" title="${esc(x.title)}">${esc(x.title.slice(0, 18))}</div></td>`).join('')}</tr>
      ${rows.map(([label, k, f, hi]) => `<tr><td>${label}</td>${list.map((x) => cell(x, k, f, hi !== false)).join('')}</tr>`).join('')}</table>
    <p class="hint">효과 미리보기의 결과입니다. 초록은 그 줄에서 가장 나은 안입니다. 같은 해·같은 조건에서 미리보기한 것끼리 견주세요.</p>
    <div class="actions">${list.map((_, i) => `<button class="small" data-cmp-del="${i}">${L[i]}안 빼기</button>`).join('')}<button class="small" data-cmp-del="all">모두 지우기</button></div>
  </details>`;
}

/** 미리보기: 이용이 크게 바뀌는 공항 (공항철도 등) */
export function airDeltaHTML(B, A) {
  if (!B.airIds || !A.airIds) return '';
  const rows = [];
  A.airIds.forEach((id, k) => {
    const j = B.airIds.indexOf(id);
    const b = j >= 0 ? B.airPax[j] : 0, a = A.airPax[k];
    if (Math.abs(a - b) > Math.max(200, 0.03 * b)) rows.push([a - b, id, b, a]);
  });
  rows.sort((x, y) => Math.abs(y[0]) - Math.abs(x[0]));
  return rows.length ? `<div class="m">공항 이용 변화: ${rows.slice(0, 4).map(([, id, b, a]) => `${esc(airportName(id))} ${Math.round(b).toLocaleString()}→${Math.round(a).toLocaleString()}명/일`).join(' · ')}</div>` : '';
}

/** 미리보기 결과로 예타식 평가 (B/C, AHP). 사업비·공기는 미리보기에서 만든 사업(clone.__built)이나 extra에서 */
export function previewAppraisal(benefit, res, touched, extra, clone) {
  const p = clone.__built || {};
  const cost = extra.cost ?? p.cost ?? 0, years = extra.years ?? p.years ?? 1;
  if (!(cost > 0)) return '';
  const links = touched.map((i) => linkAt(base, clone, i)).filter(Boolean);
  const km = extra.km ?? links.reduce((s0, l) => s0 + (l.len || 0), 0);
  const cls = extra.cls ?? links[0]?.cls;
  const kind = extra.kind ?? (p.kind === 'upgrade' ? 'upgrade' : 'new');
  const mode = extra.mode ?? links[0]?.mode ?? 0;
  // 사업이 지나는 존: 구간 양 끝과 가운데에서 가장 가까운 존
  const zoneAt = (c) => { let best = -1, bd = Infinity; zoneProps.forEach((z, i) => { if (z.ext) return; const d = (z.cx - c[0]) ** 2 + (z.cy - c[1]) ** 2; if (d < bd) { bd = d; best = i; } }); return best; };
  const nodeAt = (n) => (n < base.nodes.length ? base.nodes[n] : clone.newNodes[n - base.nodes.length]);
  const zones = links.flatMap((l) => [nodeAt(l.a), nodeAt(l.b)].filter(Boolean).map(zoneAt));
  const region = appraisalRegion(zoneProps, result?.zones.income, zones.length ? zones : extra.zones || []);
  const kpN = links.filter((l) => l.kp).length;
  const border = links.some((l) => { const a = nodeAt(l.a), b = nodeAt(l.b); return a && b && isKP(a[1], a[0]) !== isKP(b[1], b[0]); }) || !!extra.border;
  const a = appraise({
    benefit, cost, years, type: extra.type ?? p.type, opex: extra.opex ?? opexFor(kind, { cls, km, cost }),
    policy: { plan: !!(extra.plan || p.plan), congB: res.congB, congA: res.congA, dRail: res.dRail, mode, border, kp: kpN * 2 > links.length, cost },
    region,
  });
  lastPreview.appraisal = a;
  return appraisalHTML(a, formatWon);
}
export let lastPreview = null;
export function setLastPreview(v) { return (lastPreview = v); }

export function showPreviewBox(html) {
  let el = $('#previewbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'previewbox';
    $('main').appendChild(el);
  }
  el.innerHTML = `<button class="small close" style="float:right">닫기</button>${html}`;
  el.hidden = false;
  el.querySelector('.close').onclick = () => { el.hidden = true; };
}

/** 도로의 끝점이 기존 도로 바로 옆(0.5km 안)이면 그 도로에 잇는다. 더 멀면 끝점은 그 자리에 둔다
 * (막다른 도로도 지을 수 있다: 존 접근은 시뮬레이션이 새 도로 노드로 다시 잡는다). 이었으면 true */
export function attachRoadEnd(pt, rename = true) {
  if (pt.node != null || pt.split != null) return true;
  const ll = { lng: pt.lon, lat: pt.lat };
  const on = nearestOnLink(ll, 0, 60);
  const nd = nearestNode(ll, 0, null, 0.5);
  const ndKm = nd != null ? kmBetween(pt.lon, pt.lat, ...nodeCoord(nd)) : Infinity;
  const onKm = on ? kmBetween(pt.lon, pt.lat, on.lngLat.lng, on.lngLat.lat) : Infinity;
  if (nd == null && onKm > 0.5) return false;
  if (on && onKm + 0.3 < ndKm) { pt.split = on.link; pt.lon = on.lngLat.lng; pt.lat = on.lngLat.lat; }
  else { pt.node = nd; [pt.lon, pt.lat] = nodeCoord(nd); }
  if (draft && rename) nameDraftPoint(pt);
  return true;
}

/** 그리기 점을 복사한 상태(c)에 맞춘다: 기존 노선 중간에 놓은 점은 그 상태에서 구간을 잘라 새 IC·역 노드로 만든다 */
export function draftPointsOn(c) {
  const road = NEW_BUILDS[draft.type].mode === 0;
  return draft.points.map((p, i) => {
    const q = { ...p };
    if (road && i === draft.points.length - 1) attachRoadEnd(q, false);
    if (q.split != null) { q.node = splitLink(base, c, q.split, q.lon, q.lat); q.split = null; }
    return q;
  });
}

/** 그리는 중인 신설 노선 미리보기 (기존 노선 중간에 놓은 점도 그 자리를 잘라 이어서 계산) */
export async function previewDraft() {
  if (!draft || draft.points.length < 2) return;
  // 지형 자료를 다 받은 뒤에 사업비를 잡는다 (먼저 누르면 지형 없는 사업비로 B/C가 두 번째와 달라졌다)
  if (terrainRule(draft.type) && !terrainReady()) { await loadTerrain(); if (!draft) return; }
  autoJCTs();
  const dc = draftCost();
  runPreview(`${draftLineName() || NEW_BUILDS[draft.type].label} 미리보기`, (c) => {
    // 새 역 이름을 넘겨야 새 역이 역이 된다 (예전에는 빈 이름을 넘겨 새 역 없이 계산했다: 새 역이 많은 노선은 B/C가 0에 가까웠다)
    const r = startNewBuild(base, c, { type: draft.type, points: draftPointsOn(c), names: draftNames(), lineName: draftLineName(), segFactor: dc.segFactor, extraCost: dc.extraCost });
    if (!r.ok) throw new Error(r.reason);
    return buildNow(c, c.projects[c.projects.length - 1]);
  }, { kind: 'new', cost: dc.cost, years: dc.years, km: dc.km, cls: NEW_BUILDS[draft.type].attrs.cls, mode: NEW_BUILDS[draft.type].mode, plan: !!draft.plan });
}

export function previewUpgrade(ids, upId) {
  const u = UPGRADES.find((x) => x.id === upId);
  const l = linkAt(base, state, ids[0]);
  runPreview(`${l.name || CLASS_LABEL[l.cls]} ${resolve(u.label, l)} 미리보기`, (c) => {
    const r = startUpgrade(base, c, ids, upId);
    if (!r.ok) throw new Error(r.reason);
    return buildNow(c, c.projects[c.projects.length - 1]);
  });
}

export function previewStraighten() {
  const pl = straight?.plan;
  if (!pl) return;
  runPreview(`${straight.line} 직선화 미리보기`, (c) => {
    const pts = straightPoints(pl);
    const r = startNewBuild(base, c, { type: straight.cls === 'hsr' ? 'hsr' : 'rail', points: pts, names: straightNames(pts), lineName: straight.line });
    if (!r.ok) throw new Error(r.reason);
    const p = c.projects[c.projects.length - 1];
    for (const lid of p.links) c.newLinks[lid - base.links.length].speed = pl.speed;
    p.retire = pl.via;
    return buildNow(c, p);
  }, { kind: 'new', cost: pl.cost, years: pl.years, km: pl.newKm, cls: straight.cls === 'hsr' ? 'hsr' : 'conv', mode: 1 });
}

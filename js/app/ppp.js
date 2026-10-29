// 도시철도 구 안 이용 추정, 재정사업·민자사업.
import { formatWon } from '../game/catalog.js';
import { annualRevenue, evaluatePPP, initPPP, linkToll, PPP_DEFAULTS, PPP_TYPES, tollKind } from '../game/ppp.js';
import { linkAt, NEW_BUILDS, settlePPP, startNewBuild } from '../game/state.js';
import { base, draft, esc, result, state } from './core.js';
import { nodeCoord } from './mapdata.js';
import { draftCost, draftLineName, draftNames } from './route.js';
import { renderBuild } from './panels.js';
import { buildNow, runPreview } from './preview.js';
import { draftPointsOn } from './compare.js';
import { popWithin } from './gazette.js';

// ------------------------------------------------------------ 도시철도 구 안 이용 (추정)

/**
 * 도시철도역 하루 승하차 추정: 시군구 사이 통행만 세는 모형에는 같은 구 안 이용이 빠져 있어서,
 * 역 반경 800m 인구 × 0.45회(역세권 주민 1인당 하루 도시철도 승하차, 환승·외부 방문 포함 어림)로 보탠다
 */
export const METRO_PER_RESIDENT = 0.45;
export const metroEstCache = new Map();
export function metroStationEst(node) {
  if (!metroEstCache.has(node)) {
    const c = nodeCoord(node);
    metroEstCache.set(node, c ? popWithin(c[0], c[1], 0.8) * METRO_PER_RESIDENT : 0);
  }
  return metroEstCache.get(node);
}

// ------------------------------------------------------------ 재정사업·민자사업

export function pppSig(p) { return JSON.stringify([draft?.points.map((x) => [x.lon, x.lat]), draft?.type, p]); }

/** 그리기 패널: 사업 방식과 민자 조건 */
export function pppSection() {
  if (!draft || draft.type === 'airport') return '';
  const p = (draft.ppp ||= { type: 'gov', ...PPP_DEFAULTS });
  const opts = Object.entries(PPP_TYPES).map(([k, v]) => `<option value="${k}" ${k === p.type ? 'selected' : ''}>${v.label}</option>`).join('');
  if (p.type === 'gov') return `<div class="name-row"><span class="kind">방식</span><select id="ppp-type">${opts}</select></div>`;
  const ev = draft.pppEval && draft.pppEval.sig === pppSig(p) ? draft.pppEval : null;
  const sel = (id, vals, cur, fmt) => `<select id="${id}">${vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${fmt(v)}</option>`).join('')}</select>`;
  return `<div class="name-row"><span class="kind">방식</span><select id="ppp-type">${opts}</select></div>
    <div class="ppp-grid">
      <label>운영 기간 ${sel('ppp-years', [20, 30, 40], p.years, (v) => `${v}년`)}</label>
      <label>민간 목표 수익률 ${sel('ppp-target', [0.04, 0.05, 0.06, 0.07, 0.08], p.target, (v) => `${Math.round(v * 100)}%`)}</label>
      ${p.type === 'bto' ? `<label>통행료·운임 (재정 대비) ${sel('ppp-toll', [1, 1.2, 1.3, 1.5, 1.8, 2], p.tollMult, (v) => `${v}배`)}</label>
      <label>최소운영수입보장 ${sel('ppp-mrg', [0, 0.5, 0.7, 0.9], p.mrg, (v) => (v ? `예측의 ${Math.round(v * 100)}%` : '없음'))}</label>` : ''}
      <label>정부 건설보조금 ${sel('ppp-subsidy', [0, 0.1, 0.2, 0.3, 0.4, 0.5], p.subsidy, (v) => `${Math.round(v * 100)}%`)}</label>
    </div>
    <button class="small" id="ppp-eval" ${draft.points.length < 2 ? 'disabled' : ''}>수요 예측·민간 수익성 검토 (약 40초)</button>
    ${ev ? `<table class="kv" style="margin-top:6px">
      <tr><td>예측 이용 (개통 첫해)</td><td>${Math.round(ev.useKm).toLocaleString()} ${ev.kind === 'road' ? '대·km' : '인·km'}/일</td></tr>
      <tr><td>민간 투자비 · 연 운영비</td><td>${formatWon(ev.ev.privateCapex)} · ${formatWon(ev.ev.opex)}</td></tr>
      ${p.type === 'bto' ? `<tr><td>첫해 통행료·운임 수입</td><td>${formatWon(ev.ev.rev1)}</td></tr>
        ${p.mrg ? `<tr><td>최소운영수입보장 기준</td><td>연 ${formatWon(ev.ev.mrgFloor)}</td></tr>` : ''}`
        : `<tr><td>정부 연 임대료 (${p.years}년)</td><td>${formatWon(ev.ev.lease)}</td></tr>`}
      <tr><td>민간 수익률 (IRR)</td><td class="${ev.ev.viable ? 'pos' : 'neg'}">${(ev.ev.irr * 100).toFixed(1)}% (목표 ${Math.round(p.target * 100)}%)</td></tr>
      </table><p class="hint ${ev.ev.viable ? '' : 'neg'}">${ev.ev.viable ? '민간 사업자가 참여합니다. 착공하면 정부는 건설보조금만 냅니다.' : '수익률이 목표에 못 미쳐 민간이 참여하지 않습니다. 보조금·통행료·최소운영수입보장을 올리거나 운영 기간을 늘려 보세요.'}</p>`
      : '<p class="hint">민자로 하려면 먼저 수요를 예측하고 민간 수익성을 검토하세요. 조건을 바꾸면 다시 검토해야 합니다.</p>'}`;
}

export function bindPPP(el) {
  const p = draft?.ppp;
  if (!p) return;
  const on = (id, f) => { const x = el.querySelector(id); if (x) x.onchange = () => { f(x.value); renderBuild(); }; };
  on('#ppp-type', (v) => { p.type = v; });
  on('#ppp-years', (v) => { p.years = +v; });
  on('#ppp-target', (v) => { p.target = +v; });
  on('#ppp-toll', (v) => { p.tollMult = +v; });
  on('#ppp-mrg', (v) => { p.mrg = +v; });
  on('#ppp-subsidy', (v) => { p.subsidy = +v; });
  el.querySelector('#ppp-eval')?.addEventListener('click', evaluateDraftPPP);
}

/** 민자 검토: 통행료를 붙인 채로 다 지었다고 치고 배정해 이용을 예측하고, 민간 수익률을 셈한다 */
export function evaluateDraftPPP() {
  const p = draft.ppp, spec = NEW_BUILDS[draft.type];
  const kind = tollKind({ mode: spec.mode, cls: spec.attrs.cls });
  const dc = draftCost();
  const sig = pppSig(p);
  runPreview(`${draftLineName() || spec.label} 수요 예측 (${PPP_TYPES[p.type].label})`, (c) => {
    const r = startNewBuild(base, c, { type: draft.type, reuseExisting: true, points: draftPointsOn(c), names: draftNames(), lineName: draftLineName(), segFactor: dc.segFactor, extraCost: dc.extraCost,
      ppp: { type: p.type, subsidy: p.subsidy, toll: linkToll(kind, p.type, p.tollMult) } });
    if (!r.ok) throw new Error(r.reason);
    return buildNow(c, c.projects[c.projects.length - 1]);
  }, {
    html: (res, A, clone) => {
      const useKm = res.touched.filter((i) => i < A.vol.length).reduce((s, i) => s + A.vol[i] * linkAt(base, clone, i).len, 0);
      const ev = evaluatePPP(p, { cost: dc.cost, years: spec.years, km: dc.km, kind, useKm });
      if (draft) { draft.pppEval = { sig, ev, useKm, kind }; renderBuild(); }
      return `<p class="${ev.viable ? 'pos' : 'neg'}">민간 수익률 ${(ev.irr * 100).toFixed(1)}% → ${ev.viable ? '민간 참여 가능' : '민간 참여 불가'}</p>`;
    },
  });
}

/** 착공할 때 민자 계약을 맺는다 */
export function pppPlan() {
  const p = draft.ppp;
  if (!p || p.type === 'gov') return null;
  const ev = draft.pppEval && draft.pppEval.sig === pppSig(p) ? draft.pppEval : null;
  if (!ev || !ev.ev.viable) return false;
  const spec = NEW_BUILDS[draft.type];
  return { type: p.type, subsidy: p.subsidy, toll: linkToll(tollKind({ mode: spec.mode, cls: spec.attrs.cls }), p.type, p.tollMult), ev };
}

export function addContract(proj, pp, name) {
  const p = draft.ppp;
  initPPP(state).push({
    id: crypto.randomUUID(), project: proj.id, name, params: { ...p }, kind: pp.ev.kind,
    links: proj.links, newLinkIdx: proj.links.map((i) => i - base.links.length), km: draftCost().km,
    forecast: { useKm: pp.ev.useKm }, eval: { rev1: pp.ev.ev.rev1, lease: pp.ev.ev.lease, irr: pp.ev.ev.irr },
    cum: { rev: 0, mrg: 0, lease: 0 }, hist: [],
  });
}

/** 해마다 민자 정산 (실제 이용은 그해 배정 결과) */
export function pppYear() {
  const uses = {};
  for (const c of state.ppp || []) uses[c.id] = c.links.filter((i) => i < result.links.vol.length).reduce((s, i) => s + result.links.vol[i] * linkAt(base, state, i).len, 0);
  settlePPP(state, uses, (c, use) => annualRevenue(use, c.kind, c.params.type === 'bto' ? c.params.tollMult : 1) / 1e8);
}

export function pppTableHTML() {
  const list = state.ppp || [];
  if (!list.length) return '';
  return `<h3 style="margin-top:16px">민자사업 (${list.length})</h3>
    <table class="cmp"><tr><th>사업</th><th>방식</th><th>예측 대비 이용</th><th>정부 지급 누계</th></tr>${list.map((c) => {
      const last = c.hist[c.hist.length - 1];
      const ratio = last ? last.use / Math.max(1, c.forecast.useKm) : null;
      return `<tr><td>${esc(c.name)} <span class="m">${c.ended ? `${c.ended}년 귀속` : c.hist.length ? `운영 ${c.hist.length}/${c.params.years}년` : '건설 중'}</span></td>
        <td>${c.params.type.toUpperCase()}</td><td class="${ratio != null && ratio < 0.8 ? 'neg' : ''}">${ratio == null ? '–' : `${Math.round(ratio * 100)}%`}</td>
        <td>${formatWon(c.cum.mrg + c.cum.lease)}${c.params.type === 'bto' && c.cum.mrg ? ' (MRG)' : c.params.type === 'btl' ? ' (임대료)' : ''}</td></tr>`;
    }).join('')}</table>`;
}

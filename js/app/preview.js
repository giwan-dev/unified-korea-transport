// 착공 전 효과 미리보기.
import { upgradeAttrs } from '../game/catalog.js';
import { effectiveNetwork, linkAt, UPGRADES } from '../game/state.js';
import { $, base, busy, esc, result, state, worker } from './core.js';
import { ctx } from './year.js';
import { setBusy } from './panels.js';
import { addCompare, airDeltaHTML, lastPreview, previewAppraisal, setLastPreview, showPreviewBox } from './compare.js';

// ------------------------------------------------------------ 착공 전 효과 미리보기

export let previewSeq = 0, previewWait = null;
export let previewYears = 0;   // 0: 첫해, 5: 5년 뒤 (읍면동 인구 이동까지, 느림)
export function setPreviewYears(v) { return (previewYears = v); }

/**
 * 사업을 다 지었다고 치고 한 해 통행배정을 돌려 본다. mutate(복사한 상태)는 사업을 반영하고 바뀐 구간 id 목록을 돌려준다.
 * 결과는 화면 위 상자에 뜬다 (약 20~40초).
 */
export function runPreview(title, mutate, extra = {}) {
  if (busy || !result) return;
  const clone = structuredClone(state);
  let touched;
  try { touched = mutate(clone); } catch (e) { alert(`미리보기를 만들 수 없습니다: ${e.message}`); return; }
  if (!touched) return;
  const net = effectiveNetwork(base, clone);
  const id = ++previewSeq;
  previewWait = { id, title, touched, extra, clone };
  showPreviewBox(`<b>${esc(title)}</b><p class="hint">효과를 계산하는 중입니다 (그해 처음은 지금 그대로까지 구하느라 약 30초, 같은 해 두 번째부터는 10~30초${previewYears ? ', 5년 뒤는 조금 더' : ''})…</p>`);
  setBusy(true, '효과 미리보기', 0);
  worker.postMessage({ type: 'preview', id, net, ctx: ctx(), years: previewYears });
}

/**
 * 효과 미리보기 미리 데우기: 새 노선을 그리기 시작하면 그해 '지금 그대로'(대조) 평가를 뒤에서 먼저 해 둔다.
 * 그리는 동안 끝나서, 철도 사업 미리보기는 처리 쪽만 계산하면 된다 (그해 한 번)
 */
export let warmedFor = null;
export function warmPreview() {
  if (!worker || !result || busy) return;
  const key = `${state.year}:${previewYears}:${state.newLinks.length}:${state.projects.length}`;
  if (warmedFor === key) return;
  warmedFor = key;
  worker.postMessage({ type: 'preview', id: -1, net: effectiveNetwork(base, state), ctx: ctx(), years: previewYears, warmOnly: true });
}

/** 다 지은 상태로 바꾼다: 신설 사업이면 새 구간을 개통으로, 개량이면 속성을 바로 적용 */
export function buildNow(clone, p) {
  if (p.kind === 'upgrade') {
    const u = UPGRADES.find((x) => x.id === p.upgrade);
    for (const lid of p.links) {
      if (u.retire) { if (lid < base.links.length) (clone.replaced ||= {})[lid] = true; else clone.newLinks[lid - base.links.length].replaced = true; continue; }
      clone.overrides[lid] = { ...(clone.overrides[lid] || {}), ...upgradeAttrs(u, linkAt(base, clone, lid)) };
    }
  } else {
    for (const lid of p.links) clone.newLinks[lid - base.links.length].built = true;
    for (const s of p.stations || []) if (!clone.newStations.includes(s)) clone.newStations.push(s);
    for (const lid of p.retire || []) {
      if (lid < base.links.length) (clone.replaced ||= {})[lid] = true; else clone.newLinks[lid - base.links.length].replaced = true;
    }
  }
  clone.projects = clone.projects.filter((x) => x !== p);
  clone.__built = p;
  return p.links;
}

export function onPreview(m) {
  setBusy(false);
  window.__lastPreview = { before: m.before?.totals, after: m.after?.totals, benefit: m.benefit, years: m.years, timing: m.timing };   // 콘솔 디버깅용
  if (!previewWait || m.id !== previewWait.id) return;
  const { title, touched, extra, clone } = previewWait;
  previewWait = null;
  const B = m.before, A = m.after;
  const len = (i, st) => linkAt(base, st, i).len;
  const congKm = (vc, st, n) => { let s = 0; for (let i = 0; i < n; i++) { const l = linkAt(base, st, i); if (l.mode === 0 && vc[i] > 1 && !st.replaced?.[i]) s += l.len; } return s; };
  const nB = B.vc.length, nA = A.vc.length;
  const newUse = Math.max(0, ...touched.filter((i) => i < nA).map((i) => A.vol[i]));
  // 가장 많이 덜어진 구간 (이름 있는 기존 구간)
  const relief = [];
  for (let i = 0; i < nB; i++) {
    const l = linkAt(base, state, i);
    // 구간을 잘라 새 구간으로 바꾼 곳(중간 IC·역)은 사라진 것이지 덜어진 것이 아니다
    if (!l.name || touched.includes(i) || clone.replaced?.[i]) continue;
    const d = B.vol[i] - A.vol[i];
    if (d > 0.05 * B.vol[i] && B.vc[i] > 0.6) relief.push([d, l.name, B.vc[i], A.vc[i]]);
  }
  relief.sort((x, y) => y[0] - x[0]);
  const seen = new Set(), top = relief.filter(([, n]) => (seen.has(n) ? false : seen.add(n))).slice(0, 4);
  const d = (k) => (A.totals[k] || 0) - (B.totals[k] || 0);
  const sign = (v, f) => `${v >= 0 ? '+' : '−'}${f(Math.abs(v))}`;
  const row = (label, v) => `<tr><td>${label}</td><td>${v}</td></tr>`;
  // 도로 차량 통행 시간 (대·시간/일): 구간 교통량 × 길이 ÷ 실제 속도
  const vht = (R, st, n) => { let s = 0; for (let i = 0; i < n; i++) { const l = linkAt(base, st, i); if (l.mode === 0 && R.speed[i] > 0 && !st.replaced?.[i]) s += (R.vol[i] * l.len) / R.speed[i]; } return s; };
  const vhm = vht(A, clone, nA) - vht(B, state, nB);
  const res = { newUse, dRail: d('rail'), dTrips: d('trips'), dVhm: vhm, congB: congKm(B.vc, state, nB), congA: congKm(A.vc, clone, nA) };
  setLastPreview({ title, ...res, touched, extra });
  showPreviewBox(`<b>${esc(title)}</b> <span class="m">다 지었을 때 (${m.years ? `${m.years}년 뒤: 읍면동 인구 이동 반영` : '지금 교통량 기준'})</span>
    <table class="kv">
      ${row('새·개량 구간 최대 이용', `${Math.round(newUse).toLocaleString()} ${touched.some((i) => linkAt(base, clone, i).mode === 0) ? 'PCU' : '명'}/일`)}
      ${row('하루 도로 차량 통행 시간', `${sign(vhm, (v) => `${Math.round(v).toLocaleString()}대·시간`)}`)}
      ${row('철도 이용 (지역 간)', `${sign(res.dRail, (v) => `${Math.round(v).toLocaleString()}명/일`)}`)}
      ${row('지역 간 통행 (유발 수요)', `${sign(res.dTrips, (v) => `${Math.round(v).toLocaleString()}통행/일`)}`)}
      ${row('정체 도로 (V/C>1)', `${res.congB.toFixed(0)} → ${res.congA.toFixed(0)} km`)}
    </table>
    ${top.length ? `<div class="m">혼잡이 줄어드는 곳: ${top.map(([, n, b, a]) => `${esc(n)} (V/C ${b.toFixed(2)}→${a.toFixed(2)})`).join(' · ')}</div>` : ''}
    ${airDeltaHTML(B, A)}
    ${extra.html ? extra.html({ ...res, touched }, A, clone) : ''}
    ${m.benefit ? previewAppraisal(m.benefit, res, touched, extra, clone) : ''}
    <div class="actions"><button class="small" id="cmp-add">비교에 담기 (A·B·C안)</button></div>
    <p class="hint">실제 효과는 해마다 조금씩 나타나고, 인구·소득 변화에 따라 달라집니다.</p>`);
  const ca = $('#cmp-add');
  if (ca) ca.onclick = () => { addCompare(); ca.disabled = true; ca.textContent = '담았습니다 (건설 탭 위)'; };
}

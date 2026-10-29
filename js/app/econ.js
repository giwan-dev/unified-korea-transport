// 영업계수 패널(노선별 수지·감편·폐선)과 설정·정책·선택 패널.
import { DIFFICULTY, formatWon } from '../game/catalog.js';
import { flushSave } from '../game/savestore.js';
import { SERVICE_KINDS } from '../game/services.js';
import { clearSim } from '../game/simstore.js';
import { clearSave, CLOSE_APPROVAL, closeLine, closeRoute, designateIntl, effectiveNetwork, FREQ_STEPS, IC_REMOVE_COST, linkAt, newGame, removeIC, renameLine, REOPEN_PER_KM, reopenLine, save, setLineFreq, setPlaceName, startAirportExpand, startOpenRoute, startRestoreName, startUpgrade, UPGRADES } from '../game/state.js';
import { LANG, setLang, t } from '../i18n.js';
import { getGuideMode, GUIDE_MODES, guideOnNewGame, setGuideMode } from '../ui/guide.js';
import { refreshNames } from '../ui/map.js';
import { openPalette } from '../ui/palette.js';
import { toast } from '../ui/panel.js';
import { $, APP_VERSION, autoRenameNode, base, BUG_MAIL, esc, historic, map, namer, POLICY_LABEL, result, selection, setState, setWholeRoute, state, wholeRoute } from './core.js';
import { startSEZ } from './sez.js';
import { allLinks, nodeNames, refreshLinks, refreshPoints, setHighlight } from './mapdata.js';
import { admin, adminInvalidate } from './region.js';
import { bindUnivPanel, univPanel } from './univ.js';
import { select } from './interact.js';
import { renderAll, renderStatus, showGuide, switchTab } from './panels.js';
import { bindHousingRename, housingRowHTML } from './budget.js';
import { bindService, econCache, fmtRatio, lineEconomics, openServiceEditor, servicePanel, setEconCache, svcStats } from './svc.js';
import { bindFund, bindRailStats, openLineDiagram, railStatsHTML } from './operators.js';
import { countyZones, localSettingsHTML } from './election.js';
import { bindLocalSettings, bunguUnitOf, drawBungu, endGuEdit, guEdit, guPanel, guSubs, moveGuTo, normGu, payEvent, renameGus, startGuEdit } from './bungu.js';
import { bindStraighten, startStraighten, straightenPanel } from './straighten.js';
import { bindPointAdd, pointAddPanel, REST_REMOVE_COST, startPointAdd } from './housing.js';
import { previewUpgrade } from './compare.js';
import { bindSlots, copyShareLink, exportSave, importSave, reportBug, slotsHTML } from './report.js';
import { endSection, sectionPanel, startSection, startServicePick } from './pick.js';
import { commitServicePick, confirmRetire, endServicePick, header, LINE_BATCH_DISCOUNT, lineBatch, linkPanel, multiPanel, servicePickPanel } from './svcmap.js';
import { closedPanel, openClosedStraight, sameRoute, startClosedReopen, startReopen } from './reopen.js';
import {
  airportName, airportPanel, bindAnnexButtons, bindLevelLinks, bindUnitPanel, emdPanel, metroRename, nodePanel, regionPanel, restoreRow, riPanel, subPanel, unitPanel,
  zonePanel, zonesPanel,
} from './selpanel.js';
import { showGazette } from './gazette.js';
import { commitDevel, flyToNode, renameNode, startTransfer } from './transfer.js';
import { splitSubOf } from './risplit.js';
import { bindRiAnnex } from './selpanel.js';
import { EVENT_COST } from '../game/local.js';

// ---- 영업계수 패널: 노선별 수지를 나쁜 순으로 보고 감편·폐선·재개통한다
export let econView = { filter: 'all', sort: 'ratio', all: false };

export function lineKmOf(name) {
  let km = 0;
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode >= 1 && l.name === name && !state.replaced?.[i] && !l.replaced && (i < base.links.length || l.built)) km += l.len;
  });
  return km;
}

export function econPanelHTML() {
  const rows = lineEconomics().filter((e) => !e.idle && (econView.filter === 'all' || (econView.filter === 'metro') === (e.cls === 'metro')));
  const loss = (e) => e.cost - e.rev;
  rows.sort(econView.sort === 'loss' ? (x, y) => loss(y) - loss(x) : (x, y) => y.ratio - x.ratio);
  const all = lineEconomics().filter((e) => !e.idle), deficit = all.filter((e) => e.ratio > 100);
  const idle = lineEconomics().filter((e) => e.idle);
  const shown = econView.all ? rows : rows.slice(0, 20);
  const closed = Object.entries(state.closedLines || {});
  const chip = (k, v, label) => `<button class="small ${econView[k] === v ? 'on' : ''}" data-econ="${k}:${v}">${label}</button>`;
  const ratioCls = (r) => (r >= 200 ? 'neg' : r > 100 ? 'warn' : 'pos');
  return `<h3 style="margin-top:16px">영업계수 · 노선 정리</h3>
    <div class="kpis">
      <div><span class="k">흑자 노선</span><span class="v">${all.length - deficit.length}</span></div>
      <div><span class="k">적자 노선 (200 이상)</span><span class="v">${deficit.length} <small class="neg">(${all.filter((e) => e.ratio >= 200).length})</small></span></div>
      <div><span class="k">적자 합계 (연)</span><span class="v neg">${formatWon(deficit.reduce((a, e) => a + loss(e), 0) / 1e8)}</span></div>
      <div><span class="k">폐선·감편</span><span class="v">${closed.length} · ${Object.keys(state.lineFreq || {}).length}</span></div>
    </div>
    <div class="econ-bar">${chip('filter', 'all', '전체')}${chip('filter', 'rail', '철도')}${chip('filter', 'metro', '도시철도')}
      <span style="flex:1"></span>${chip('sort', 'ratio', '영업계수순')}${chip('sort', 'loss', '적자액순')}</div>
    <div class="econ-list">${shown.map((e) => {
      const f = state.lineFreq?.[e.name] || 1;
      return `<div class="econ-row"><div class="n"><b>${esc(e.name)}</b><span class="m">${Math.round(e.km)}km · 최대 ${Math.round(e.peak).toLocaleString()}명/일 · 수입 ${formatWon(e.rev / 1e8)} · 비용 ${formatWon(e.cost / 1e8)}</span></div>
        <span class="r ${ratioCls(e.ratio)}">${fmtRatio(e.ratio)}</span>
        <select data-freq="${esc(e.name)}" title="기본 열차 운행 비율">${FREQ_STEPS.map((x) => `<option value="${x}" ${x === f ? 'selected' : ''}>운행 ${Math.round(x * 100)}%</option>`).join('')}</select>
        <button class="small" data-close-line="${esc(e.name)}" title="폐선">폐선</button></div>`;
    }).join('') || '<p class="hint">노선이 없습니다.</p>'}</div>
    ${rows.length > 20 ? `<button class="small" data-econ="all:${!econView.all}" style="margin-top:6px">${econView.all ? '20개만 보기' : `모두 보기 (${rows.length})`}</button>` : ''}
    ${idle.length ? `<p class="hint">여객 이용이 없는 노선 ${idle.length}개(화물선, 역이 없는 선로: ${idle.slice(0, 6).map((e) => esc(e.name)).join(', ')}${idle.length > 6 ? ' 등' : ''})는 순위에서 뺐습니다. 여객 열차 없이 선로 유지비 연 ${formatWon(idle.reduce((a, e) => a + e.cost, 0) / 1e8)}만 셉니다.</p>` : ''}
    ${closed.length ? `<h4>폐선한 노선</h4><div class="list">${closed.map(([n, y]) => `<div class="item opt"><div class="opt-row">
      <span>${esc(n)} <span class="m">${y}년 폐선 · ${Math.round(lineKmOf(n))}km</span></span>
      <button class="small" data-reopen="${esc(n)}">재개통 ${formatWon(lineKmOf(n) * REOPEN_PER_KM)}</button></div></div>`).join('')}</div>` : ''}
    <p class="hint">영업계수 = 영업비용 ÷ 영업수입 × 100 (100 미만이면 흑자, 200 이상이면 수입의 두 배를 씁니다). 수입은 구간 이용객 × 거리 × km당 운임, 비용은 운행 열차-km와 선로 유지비로 셈한 추정입니다. 도시철도는 같은 구 안 이용을 역세권 인구로 어림해 더했습니다.<br>
    운행 비율을 줄이면(감편) 기본 열차의 최소 운행과 비용이 줄지만, 배차가 길어져 기다림이 늘고(절반이면 노선 전체 약 20분) 수송력이 줄어 이용객도 빠집니다. 폐선하면 그 노선의 열차·선로 비용이 없어지고 지나던 계통은 멈추며, 2년 동안 지지율이 노선당 ${CLOSE_APPROVAL}점 깎입니다. 결과는 다음 해부터 반영됩니다.</p>`;
}

export function bindEcon(el) {
  el.querySelectorAll('[data-econ]').forEach((b) => {
    b.onclick = () => { const [k, v] = b.dataset.econ.split(':'); econView[k] = k === 'all' ? v === 'true' : v; renderOps(); };
  });
  el.querySelectorAll('[data-freq]').forEach((sel) => {
    sel.onchange = () => { setLineFreq(state, sel.dataset.freq, +sel.value); setEconCache(null); save(state); renderOps(); renderStatus(); };
  });
  el.querySelectorAll('[data-close-line]').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.closeLine, e = lineEconomics().find((x) => x.name === name);
      const svcs = (state.services || []).filter((x) => (x.lines || [x.line]).includes(name));
      const msg = `${name}을(를) 폐선할까요?
연 수입 ${formatWon(e.rev / 1e8)} · 비용 ${formatWon(e.cost / 1e8)} → 수지 ${e.cost > e.rev ? '개선' : '악화'} ${formatWon(Math.abs(e.cost - e.rev) / 1e8)}/년`
        + `${svcs.length ? `
지나는 운행 계통 ${svcs.length}개가 멈춥니다.` : ''}
지지율 -${CLOSE_APPROVAL} (2년). 재개통에는 ${formatWon(e.km * REOPEN_PER_KM)}이 듭니다.`;
      if (!confirm(msg)) return;
      closeLine(state, name);
      setEconCache(null); save(state); renderAll();
    };
  });
  el.querySelectorAll('[data-reopen]').forEach((b) => {
    b.onclick = () => {
      const name = b.dataset.reopen;
      const r = reopenLine(state, name, lineKmOf(name));
      if (!r.ok) { alert(r.reason); return; }
      setEconCache(null); save(state); renderAll();
    };
  });
}

/** 작은 꺾은선 그래프 (SVG) */
export function chart(title, pts) {
  if (pts.length < 2) return '';
  const W = 320, H = 70, pad = 4;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sx = (x) => pad + ((x - x0) / Math.max(x1 - x0, 1)) * (W - 2 * pad);
  const sy = (y) => H - pad - ((y - y0) / Math.max(y1 - y0, 1e-9)) * (H - 2 * pad);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3));
  return `<div class="chart"><div class="chart-t">${title} <span>${fmt(ys[0])} → <b>${fmt(ys[ys.length - 1])}</b></span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg></div>`;
}

export function renderSettings() {
  const el = $('[data-panel=settings]');
  el.innerHTML = `
    <div class="name-row"><span style="flex:1">언어 · Language</span>
      <select id="lang"><option value="ko" ${LANG === 'ko' ? 'selected' : ''}>한국어</option><option value="en" ${LANG === 'en' ? 'selected' : ''}>English (beta)</option></select></div>
    ${LANG === 'en' ? '<p class="hint">English is in beta: the main screens, tutorial, setup and summary are translated; detailed panels and place names are still in Korean.</p>' : ''}
    <div class="name-row"><span style="flex:1">버전 <b>${APP_VERSION}</b></span><button class="small" id="app-refresh">최신 판 다시 받기</button></div>
    <p class="hint">새 판은 게임을 열 때 저절로 받습니다. 그래도 예전 화면이 보이면 눌러 주세요 (진행은 그대로 남습니다).</p>
    <h3>도움말</h3>
    <div class="actions"><button class="small" id="help-guide">처음 안내 다시 보기</button><button class="small" id="help-find">메뉴 찾기 (Ctrl+K)</button></div>
    <div class="name-row"><span style="flex:1">게임을 열 때 처음 안내</span>
      <select id="guide-mode">${Object.entries(GUIDE_MODES).map(([k, v]) => `<option value="${k}" ${getGuideMode() === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="actions"><button class="small" id="help-bug">오류 제보하기</button></div>
    <p class="hint">버전·연도·지도 위치·브라우저 정보가 채워진 메일이 열립니다 (${BUG_MAIL}). 무엇이 이상했는지만 적어 보내 주세요.</p>
    <p class="hint">정책·지방자치·행정구역·국가 대형 사업은 <a href="#" data-goto-tab="requests">민원·정책 탭</a>, 항공 자동 운영·철도 회사·노선 정리는 <a href="#" data-goto-tab="ops">운영 탭</a>에 있습니다.</p>
    <h3 style="margin-top:16px">저장 슬롯</h3>
    <p class="hint">진행은 자동 저장되고, 여기에 따로 세 개까지 남겨 두었다가 되돌릴 수 있습니다.</p>
    ${slotsHTML()}
    <div class="actions"><button class="small" id="save-export">파일로 내보내기</button><button class="small" id="save-import">파일 불러오기</button><button class="small" id="save-link">공유 링크 복사</button></div>
    <input type="file" id="save-file" accept=".json,application/json" hidden>
    <p class="hint">다른 기기·브라우저로 옮기거나 다른 사람과 판을 주고받을 때 씁니다. 지도 자료가 바뀌기 전에 만든 파일은 불러올 수 없습니다.</p>
    <h3 style="margin-top:16px">새 게임</h3>
    <div class="name-row"><span style="flex:1">난이도</span>
      <select id="difficulty">${Object.entries(DIFFICULTY).map(([k, v]) => `<option value="${k}" ${state.difficulty === k ? 'selected' : ''}>${v.label} (연 ${formatWon(v.annualBudget)})</option>`).join('')}</select></div>
    <p class="hint" style="margin-top:8px">남북 행정구역 정리 (시작할 때 정하면 비용·선거 없이 적용됩니다)</p>
    <p class="hint">행정구역 정리(개성·옹진·고성, 분단 전 군 되살리기 등)는 새 게임을 시작하면 뜨는 창에서 정합니다.</p>
    <button id="btn-new" style="margin-top:6px">이 설정으로 새로 시작</button>
    <p class="hint">진행 상황은 이 브라우저에 자동 저장됩니다.</p>
    <h3 style="margin-top:16px">데이터</h3>
    <p class="hint">도로·철도·행정구역·지명: © OpenStreetMap 기여자 (ODbL)<br>인구 격자: WorldPop 2020 (CC BY 4.0)<br>소득·HDI 초기값과 공사비 단가는 게임용 가정값입니다. 자세한 내용은 저장소의 docs/model.md를 보세요.</p>`;
  $('#help-guide').onclick = showGuide;
  $('#app-refresh').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = '받는 중…';
    save(state); await flushSave();
    if (window.uktRefresh) await window.uktRefresh(); else location.reload();
  };
  $('#lang').onchange = (e) => setLang(e.target.value);
  $('#help-find').onclick = () => openPalette();
  $('#guide-mode').onchange = (e) => { setGuideMode(e.target.value); toast(`처음 안내: ${GUIDE_MODES[e.target.value]}`); };
  el.querySelectorAll('[data-goto-tab]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); switchTab(a.dataset.gotoTab); }; });
  bindSlots(el);
  $('#help-bug').onclick = reportBug;
  $('#save-export').onclick = exportSave;
  $('#save-link').onclick = copyShareLink;
  $('#save-import').onclick = () => $('#save-file').click();
  $('#save-file').onchange = (e) => { const f = e.target.files?.[0]; if (f) importSave(f); e.target.value = ''; };
  $('#btn-new').onclick = async () => {
    if (!confirm('지금 게임을 지우고 새로 시작할까요?')) return;
    guideOnNewGame();
    await clearSave();
    clearSim();
    const d = $('#difficulty').value;
    setState(newGame(d));
    save(state);
    await flushSave();
    location.reload();
  };
}

/** 민원·정책 탭 아래쪽: 이주 정책, 지방자치·행정구역 이벤트, 국가 대형 사업, 옛 이름 되찾기 (정책·이벤트 성격은 이 탭에 모은다) */
export function policyHTML() {
  return `<h3 style="margin-top:16px">이주 정책</h3>
    <div class="name-row"><span style="flex:1">북→남 이주</span>
      <select id="policy">${Object.entries(POLICY_LABEL).map(([k, v]) => `<option value="${k}" ${state.policy === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <p class="hint">통일 직후 대규모 남하를 막을지 정합니다. 통제할수록 북측 인구는 유지되지만 지지율과 통합 속도에 영향이 있습니다.</p>
    <h3 style="margin-top:16px">지방자치·행정구역</h3>
    ${localSettingsHTML()}
    ${historic.length ? `<h3 style="margin-top:16px">옛 이름 되찾기</h3>
    <p class="hint">북측에서 지도자 이름이나 선전 구호로 바뀐 지명을 바뀌기 전 이름으로 돌립니다. 표지판·행정 문서·지도를 바꾸는 데 예산이 들고, 완공되면 그 지역 주민 행복도가 오릅니다.</p>
    <div class="list">${historic.map((t) => restoreRow(t)).join('')}</div>` : ''}`;
}

export function bindPolicy(el) {
  bindLocalSettings(el);
  bindRestore(el);
  el.querySelector('#policy').onchange = (e) => { state.policy = e.target.value; state.log.unshift(`${state.year}년 이주 정책: ${POLICY_LABEL[state.policy]}`); save(state); renderStatus(); };
}

/** 운영 탭: 철도 운행 계통, 철도 회사(재원·합병), 노선 영업계수·감편·폐선, 항공 자동 운영 */
export function renderOps() {
  const el = $('[data-panel=ops]');
  if (!el) return;
  if (!result) { el.innerHTML = '<p class="hint">계산 중입니다…</p>'; return; }
  const svcRows = svcStats().map((x) => `<tr><td>${esc(x.s.name)} <span class="m">${x.s.name.includes(SERVICE_KINDS[x.s.kind].label) ? '' : `${SERVICE_KINDS[x.s.kind].label} · `}${x.s.stops.length}역</span></td>
    <td>${x.s.trains}</td><td>${Math.round(x.riders).toLocaleString()}</td><td>${Math.round(x.peak).toLocaleString()}</td><td>${Math.round(x.load * 100)}%</td><td class="${x.ratio > 100 ? 'neg' : ''}">${fmtRatio(x.ratio)}</td></tr>`).join('');
  el.innerHTML = `
    <h3>철도 운행 계통</h3>
    <div class="actions"><button class="small primary svc-pick-b">역 골라 특급·급행 짜기</button></div>
    <p class="hint">역을 누르면 그 역을 지나는 노선의 노선도·운행 계통을 보고 고칠 수 있습니다.</p>
    ${svcRows ? `<table class="cmp"><tr><th>계통</th><th>회/일</th><th title="하루 이용객 (어림: 구간 이용객이 늘어난 만큼 탄 것으로 셈)">이용객/일</th><th title="가장 붐비는 구간의 하루 이용객">최대 구간</th><th>승차율</th><th>영업계수</th></tr>${svcRows}</table>` : '<p class="hint">아직 짠 계통이 없습니다.</p>'}
    ${railStatsHTML()}
    ${econPanelHTML()}
    <h3 style="margin-top:16px">항공</h3>
    <label class="name-row"><input type="checkbox" id="air-auto" ${state.air?.auto ? 'checked' : ''}>
      <span>항공 노선 자동 운영 (수요에 따른 취항·증편·단항)</span></label>
    <p class="hint">노선을 직접 열거나 닫으려면 지도에서 공항을 누르세요.</p>`;
  el.querySelectorAll('.svc-pick-b').forEach((b) => { b.onclick = startServicePick; });
  el.querySelector('#air-auto').onchange = (e) => { state.air.auto = e.target.checked; save(state); };
  bindRailStats(el);
  bindEcon(el);
}

export function renderSelection() {
  const el = $('#selection');
  if (!selection) { el.hidden = true; setHighlight(); return; }
  el.hidden = false;
  if (selection.type === 'link') el.innerHTML = linkPanel(selection.id);
  else if (selection.type === 'zone') el.innerHTML = zonePanel(selection.id);
  else if (selection.type === 'gu') {
    el.innerHTML = guPanel(selection.id, selection.gu);
    el.querySelector('[data-gu-county]')?.addEventListener('click', () => select({ type: 'zone', id: selection.id }));
    el.querySelector('#gu-edit')?.addEventListener('click', () => { if (guEdit) endGuEdit(); else startGuEdit(selection.id); });
    el.querySelectorAll('[data-gu-move]').forEach((b) => b.addEventListener('click', () => {
      const { id, gu } = selection, to = b.dataset.guMove;
      if (confirm(`${gu}를 통째로 ${to}의 자치구로 옮길까요? 두 광역 단체장과 구청장을 다시 뽑습니다. ${formatWon(EVENT_COST.annex)}`)) moveGuTo(guSubs(id, gu), gu, to);
    }));
    el.querySelector('#gu-rename')?.addEventListener('click', () => {
      const { id, gu } = selection, unit = bunguUnitOf(id), v = el.querySelector('#gu-name').value;
      const err = unit ? renameGus(unit, new Map([[gu, v]])) : '분구하지 않은 곳입니다.';
      if (err) { toast(err); return; }
      drawBungu(); refreshNames(map); save(state);
      select({ type: 'gu', id, gu: normGu(v) });
      renderAll();
    });
  }
  else if (selection.type === 'closed') el.innerHTML = closedPanel(selection.id);
  else if (selection.type === 'zones') {
    el.innerHTML = zonesPanel(selection.ids);
    el.querySelectorAll('[data-zones-one]').forEach((b) => { b.onclick = () => select({ type: 'zone', id: +b.dataset.zonesOne }); });
  }
  else if (selection.type === 'housing') {
    const h = (state.housing || []).find((x) => x.id === selection.id);
    el.innerHTML = h ? housingRowHTML(h, { panel: true }) : header('택지지구');
    bindHousingRename(el);
  }
  else if (selection.type === 'region') {
    el.innerHTML = regionPanel(selection.id);
    bindLevelLinks(el);
    el.querySelectorAll('[data-metro-rename]').forEach((b) => { b.onclick = () => metroRename(b.dataset.metroRename); });
  }
  else if (selection.type === 'ri') {
    // 이미 떼어 낸 리는 그 소구역 창으로 (다시 다른 곳으로 옮길 수 있다)
    const g = splitSubOf(selection.id);
    if (g >= 0) { el.innerHTML = subPanel(g); bindAnnexButtons(el, g, true); }
    else { el.innerHTML = riPanel(selection.id); bindLevelLinks(el); bindRiAnnex(el, selection.id); }
  }
  else if (selection.type === 'emd') {
    const g = admin()?.emds.get(selection.id);
    el.innerHTML = emdPanel(selection.id);
    bindLevelLinks(el);
    if (g) bindAnnexButtons(el, g.subs[0]);
  }
  else if (selection.type === 'sub') {
    el.innerHTML = subPanel(selection.id);
    bindAnnexButtons(el, selection.id, true);
  }
  else if (selection.type === 'unit') { el.innerHTML = unitPanel(selection.id); bindUnitPanel(el); }
  else if (selection.type === 'airport') el.innerHTML = airportPanel(selection.id);
  else if (selection.type === 'univ') { el.innerHTML = univPanel(selection.id); bindUnivPanel(el); }
  else if (selection.type === 'multi') el.innerHTML = multiPanel(selection.ids);
  else if (selection.type === 'service') el.innerHTML = servicePanel();
  else if (selection.type === 'straighten') { el.innerHTML = straightenPanel(); bindStraighten(el); return; }
  else if (selection.type === 'pointadd') { el.innerHTML = pointAddPanel(); bindPointAdd(el); return; }
  else if (selection.type === 'svcpick') {
    el.innerHTML = servicePickPanel();
    const end = () => { endServicePick(); select(null); };
    el.querySelector('.close').onclick = end;
    el.querySelector('#sp-cancel').onclick = end;
    el.querySelector('#sp-ok').onclick = commitServicePick;
    return;
  }
  else if (selection.type === 'section') {
    el.innerHTML = sectionPanel();
    el.querySelector('.close').onclick = () => { endSection(); select(null); };
    return;
  }
  else el.innerHTML = nodePanel(selection.id);
  el.querySelector('.close')?.addEventListener('click', () => select(null));
  if (selection.type === 'service') bindService(el);
  if (selection.type === 'service') bindFund(el, renderSelection);
  el.querySelector('#line-diagram')?.addEventListener('click', () => openLineDiagram(selection.id));
  el.querySelectorAll('[data-freq]').forEach((sel) => {
    sel.onchange = () => { setLineFreq(state, sel.dataset.freq, +sel.value); setEconCache(null); save(state); renderSelection(); renderOps(); renderStatus(); };
  });
  el.querySelector('#st-start')?.addEventListener('click', () => startStraighten(selection.id));
  el.querySelectorAll('[data-st-start]').forEach((b) => { b.onclick = () => startStraighten(selection.id); });
  el.querySelectorAll('.sec-start').forEach((b) => { b.onclick = () => startSection(selection.id); });
  el.querySelector('#sec-straight')?.addEventListener('click', () => {
    // 고른 구간의 양 끝 역으로 바로 직선화를 연다 (보통 시작과 같은 상태로: 사이 역 처리 메뉴가 되게)
    const sc = selection.section;
    startStraighten(selection.ids?.[0] ?? sc.via?.[0], { line: sc.line, cls: sc.cls, picks: [sc.A, sc.B] });
  });
  el.querySelector('#sec-prev')?.addEventListener('click', () => {
    const sc = selection.section, b0 = el.querySelector('[data-mup]');
    if (b0) previewUpgrade(JSON.parse(b0.dataset.ids), b0.dataset.mup);
    else alert(`${sc.line || '이 구간'}에 적용할 개량이 없습니다.`);
  });
  el.querySelectorAll('[data-st-diagram]').forEach((b) => { b.onclick = () => openLineDiagram(+b.dataset.stDiagram); });
  el.querySelectorAll('[data-padd]').forEach((b) => { b.onclick = () => { switchTab('build'); startPointAdd(b.dataset.padd); toast({ ic: '고속도로 위 IC 자리(두 고속도로가 엇갈리는 곳이면 JCT)를 누르세요.', rest: '휴게소를 놓을 고속도로 위 자리를 누르세요.' }[b.dataset.padd] || '노선 위 역 자리를 누르세요.'); }; });
  el.querySelectorAll('[data-closed-go]').forEach((b) => { b.onclick = () => startClosedReopen(selection.id, b.dataset.closedGo); });
  el.querySelectorAll('[data-closed-straight]').forEach((b) => { b.onclick = () => openClosedStraight(selection.id, b.dataset.closedStraight); });
  el.querySelector('#reopen-go')?.addEventListener('click', () => startReopen(selection.id));
  el.querySelectorAll('[data-xfer]').forEach((b) => { b.onclick = () => startTransfer(selection.id, +b.dataset.xfer); });
  el.querySelector('#devel-ok')?.addEventListener('click', (ev) => commitDevel(+ev.target.dataset.node));
  el.querySelectorAll('[data-st-goto]').forEach((a) => {
    a.onclick = (ev) => { ev.preventDefault(); const nd = +a.dataset.stGoto; flyToNode(nd); select({ type: 'node', id: nd }); };
  });
  el.querySelectorAll('.svc-pick').forEach((b) => { b.onclick = () => startServicePick(); });
  el.querySelectorAll('[data-svc-from]').forEach((b) => { b.onclick = () => startServicePick([+b.dataset.svcFrom]); });
  el.querySelectorAll('[data-svc-edit]').forEach((b) => {
    b.onclick = () => {
      const s = state.services.find((x) => x.id === b.dataset.svcEdit);
      openServiceEditor(s.line, s.cls, s.id);
    };
  });
  el.querySelectorAll('[data-line-batch]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.lineBatch, x = lineBatch(selection.id)[k], name = linkAt(base, state, selection.id).name;
      const r = startUpgrade(base, state, x.ids, k === 'kpstd' ? 'kpstd' : 'electrify', { discount: LINE_BATCH_DISCOUNT, label: `${name} ${k === 'kpstd' ? '노선 전체 남측 규격 개량' : k === 'DC' ? '노선 전체 승압 (교류 25kV)' : '노선 전체 전철화'}` });
      if (!r.ok) return alert(r.reason);
      save(state); refreshLinks(); renderAll();
      showGazette(state.projects[state.projects.length - 1], { fromBuild: true });
    };
  });
  el.querySelectorAll('[data-up]').forEach((b) => {
    b.onclick = () => {
      const ids = wholeRoute ? sameRoute(selection.id, true) : (selection.section?.ids || [selection.id]);
      if (!confirmRetire(b.dataset.up, ids)) return;
      const r = startUpgrade(base, state, ids, b.dataset.up);
      if (!r.ok) return alert(r.reason);
      save(state); refreshLinks(); renderAll();
      showGazette(state.projects[state.projects.length - 1], { fromBuild: true });
    };
  });
  bindFund(el, renderSelection);
  el.querySelectorAll('[data-prev-up]').forEach((b) => {
    b.onclick = () => {
      const u = UPGRADES.find((x) => x.id === b.dataset.prevUp);
      const ids = (wholeRoute ? sameRoute(selection.id, true) : (selection.section?.ids || [selection.id])).filter((x) => u.applies(linkAt(base, state, x)));
      previewUpgrade(ids, u.id);
    };
  });
  const wr = el.querySelector('#whole-route');
  if (wr) wr.onchange = () => { setWholeRoute(wr.checked); renderSelection(); };
  if (selection.type === 'link') {
    const upIds = (u) => (wholeRoute && wr ? sameRoute(selection.id, true) : (selection.section?.ids || [selection.id])).filter((x) => !u || u.applies(linkAt(base, state, x)));
    const base0 = () => setHighlight(wholeRoute && wr ? { links: upIds(null) } : {});
    base0();
    el.querySelectorAll('[data-up]').forEach((b) => {
      const it = b.closest('.item'), u = UPGRADES.find((x) => x.id === b.dataset.up);
      it?.addEventListener('mouseenter', () => setHighlight({ links: upIds(u) }));
      it?.addEventListener('mouseleave', base0);
    });
  } else if (selection.type !== 'multi') setHighlight();
  bindRestore(el);
  el.querySelectorAll('[data-mup]').forEach((b) => {
    b.onclick = () => {
      if (!confirmRetire(b.dataset.mup, JSON.parse(b.dataset.ids))) return;
      const r = startUpgrade(base, state, JSON.parse(b.dataset.ids), b.dataset.mup);
      if (!r.ok) return alert(r.reason);
      save(state); refreshLinks(); renderAll();
      showGazette(state.projects[state.projects.length - 1], { fromBuild: true });
    };
  });
  el.querySelector('#line-rename-ok')?.addEventListener('click', () => {
    const v = el.querySelector('#line-rename').value.trim();
    const old = linkAt(base, state, selection.id).name;
    if (!v || v === old) return;
    renameLine(state, old, v);
    save(state); renderAll();
  });
  el.querySelectorAll('[data-close-route]').forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.closeRoute;
      const r = state.air.routes[key];
      closeRoute(state, key, `${airportName(r.a)}–${airportName(r.b)}`);
      save(state); renderAll();
    };
  });
  const openRoute = (other) => {
    const aps = effectiveNetwork(base, state).airports;
    const r = startOpenRoute(state, aps.find((a) => a.id === selection.id), aps.find((a) => a.id === other));
    if (!r.ok) return alert(r.reason);
    save(state); renderAll();
  };
  el.querySelectorAll('[data-open-route]').forEach((b) => { b.onclick = () => openRoute(b.dataset.openRoute); });
  el.querySelector('#route-open')?.addEventListener('click', () => openRoute(el.querySelector('#route-dest').value));
  el.querySelector('#ap-expand')?.addEventListener('click', () => {
    const ap = effectiveNetwork(base, state).airports.find((a) => a.id === selection.id);
    const r = startAirportExpand(state, ap);
    if (!r.ok) return alert(r.reason);
    save(state); renderAll();
  });
  el.querySelector('#ap-intl')?.addEventListener('click', () => {
    const r = designateIntl(state, selection.id);
    if (!r.ok) return alert(r.reason);
    state.log.unshift(`${state.year}년 ${airportName(selection.id)} 국제공항 지정`);
    save(state); renderAll();
  });
  el.querySelector('[data-sez]')?.addEventListener('click', (e) => startSEZ(+e.currentTarget.dataset.sez));
  if (selection.type === 'zone' || selection.type === 'gu') bindLocalSettings(el);   // 행정구역 조정 단추
  const zn = el.querySelector('#zone-name');
  if (zn) {
    el.querySelector('#zone-rename').onclick = () => {
      const v = zn.value.trim();
      if (!v) return;
      for (const j of countyZones(selection.id)) setPlaceName(state, 'zone', j, v);   // 한 시군으로 보이는 존 모두
      adminInvalidate();
      save(state); refreshNames(map); renderAll();
    };
  }
  el.querySelector('#ic-del')?.addEventListener('click', () => {
    const id = selection.id, n = nodeNames().get(id);
    if (!n || !confirm(`${n.name}을(를) 철거할까요? 연결도로를 걷어 내고 이름을 지웁니다. ${formatWon(IC_REMOVE_COST)}`)) return;
    const r = removeIC(base, state, id);
    if (!r.ok) { alert(r.reason); return; }
    namer?.release(r.name.name, r.name.kind);
    save(state); select(null); refreshLinks(); refreshPoints(); renderAll();
  });
  el.querySelector('#rest-del')?.addEventListener('click', () => {
    const id = selection.id, n = nodeNames().get(id);
    if (!n || !confirm(`${n.name}을(를) 철거할까요? ${formatWon(REST_REMOVE_COST)}`)) return;
    if (!payEvent(REST_REMOVE_COST)) return;
    if (typeof id === 'string' && id.startsWith('rest')) {
      const r = state.restAreas[+id.slice(4)];
      r.removed = true;
      if (!r.built) state.projects = state.projects.filter((p) => p.id !== r.project);   // 공사 중이면 사업도 접는다
    } else (state.restRemoved ||= []).push(id);
    state.log.unshift(`${state.year}년 ${n.name.replace(/ \(공사 중\)$/, '')} 철거`);
    save(state); select(null); refreshPoints(); renderAll();
  });
  const inp = el.querySelector('#node-name');
  if (inp) {
    el.querySelector('#node-save').onclick = () => renameNode(selection.id, inp.value.trim());
    el.querySelector('#node-auto').onclick = () => autoRenameNode(selection.id);
  }
}

export function bindRestore(el) {
  el.querySelectorAll('[data-restore]').forEach((b) => {
    b.onclick = () => {
      const [level, id] = b.dataset.restore.split(':');
      const t = historic.find((x) => x.level === level && x.id === +id);
      const r = startRestoreName(state, t);
      adminInvalidate();
      if (!r.ok) return alert(r.reason);
      save(state); renderAll();
    };
  });
}

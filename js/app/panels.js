// 화면: 상단 바·탭·패널 그리기(renderAll)·접는 묶음.
import { AIRPORT, formatWon } from '../game/catalog.js';
import { hasAutonomy, PARTIES, partySupport, regionOf } from '../game/local.js';
import { MEGA } from '../game/mega.js';
import { operatorOf } from '../game/operators.js';
import { canAfford, isKP, linkAt, NEW_BUILDS, save } from '../game/state.js';
import { terrainReady, terrainRule } from '../game/terrain.js';
import { LANG, t } from '../i18n.js';
import { getGuideMode, guideShouldAutoShow, startGuide } from '../ui/guide.js';
import { NETWORK_GROUPS, DEFAULT_NETWORK_FILTERS, legendHTML, metricLevel, METRICS, setBasemap, setHousing, setHousingVisible, setNetworkFilters, setRegions } from '../ui/map.js';
import { goSection, initPalette, openPalette } from '../ui/palette.js';
import { initPanelUI, toast } from '../ui/panel.js';
import { showPlanLine } from '../ui/plansmap.js';
import { railKindLegend } from '../ui/railkind.js';
import {
  $, base, BUG_MAIL, busy, draft, esc, happiness, map, mapLevel, measure, metric, MID_COST, namer, requests, REST, result, setBusyValue, setMapLevel, setMetric, snap,
  state, zoneProps,
} from './core.js';
import { autoYears, avgHappiness, countyKey, nextYear, runYears, updateAutoBtn, zoneName } from './year.js';
import { allLinks, drawEmdLines, paintZones, setHighlight, showPointOnMap } from './mapdata.js';
import { adminInvalidate, drawHalls, setShowHalls, showHalls } from './region.js';
import { drawUnivs, setShowUnivs, showUnivs, startUnivPick } from './univ.js';
import { select } from './interact.js';
import { cancelDraft, catchKm, fmtPeople, popNear, startDraft } from './draw.js';
import { commitDraft, draftCost, draftLineName, drawDraft, endMeasure, startMeasure, terrainAlign, setPlanningStations, draftStationPicker, bindDraftStationPicker } from './route.js';
import { gotoLinks, renderProjects, renderRequests, renderStats } from './budget.js';
import { renderOps, renderSelection, renderSettings } from './econ.js';
import { bindFund, fundSelect } from './operators.js';
import { openPlan, planPreviewLine, plans, plansHTML, retireChoiceHTML } from './plans.js';
import { mayorKey, partyBadge } from './election.js';
import { bindMega, megaHTML } from './bungu.js';
import { adminSetup, needsAdminSetup } from './firstyear.js';
import { recMsg, recommendRoute } from './recommend.js';
import { endHousingPick, housingR, startHousingPick, startPointAdd } from './housing.js';
import { previewYears, setPreviewYears } from './preview.js';
import { compareHTML, previewDraft } from './compare.js';
import { goalHTML, reportBug, showReport } from './report.js';
import { bindPPP, pppSection } from './ppp.js';
import { startServicePick } from './pick.js';
import { drawServices, setShowHousing, setShowServices, showHousing, showServices } from './svcmap.js';

// ------------------------------------------------------------ 화면

export function bindUI() {
  $('#btn-next').onclick = nextYear;
  $('#btn-next5').onclick = () => runYears(5);
  // 건설 탭 사업 비교: 안 빼기
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmp-del]');
    if (!b) return;
    if (b.dataset.cmpDel === 'all') state.compare = []; else state.compare.splice(+b.dataset.cmpDel, 1);
    save(state); renderBuild();
  });
  // 현황 탭의 결산 단추 (탭을 다시 그려도 한 번만 묶이게 문서에 건다)
  document.addEventListener('click', (e) => { if (e.target.closest('#btn-report')) showReport(); });
  $('#btn-measure').onclick = () => (measure ? endMeasure() : startMeasure());
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
  watchFolds();
  initPanelUI($('#side'));
  initPalette(paletteCommands);
  $('#btn-find').onclick = () => openPalette();
  $('#btn-help').onclick = showGuide;
  // 상단 바 숫자를 누르면 관련 탭으로 (예산·부채 → 사업, 지지율·통합도 → 현황)
  document.querySelectorAll('#topbar [data-go]').forEach((d) => {
    const go = () => switchTab(d.dataset.go);
    d.onclick = go;
    d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  if (basemap !== 'plain') setBasemap(map, basemap);
  // 통일 첫해: 행정구역 정리 창을 먼저 띄우고, 정하면 사용법 안내로 이어진다
  if (needsAdminSetup()) setTimeout(() => adminSetup(true), 400);
  else if (guideShouldAutoShow()) setTimeout(showGuide, 600);
  $('#legend').addEventListener('click', (e) => {
    if (!e.target.closest('.lg-toggle')) return;
    $('#legend').classList.toggle('open');
    e.target.textContent = $('#legend').classList.contains('open') ? '범례 접기' : '범례 더 보기';
  });
  $('#legend').addEventListener('change', (e) => {
    if (e.target.id === 'metric') { setMetric(e.target.value); paintZones(); renderLegend(); drawEmdLines(); }
    if (e.target.id === 'basemap') {
      basemap = e.target.value; setBasemap(map, basemap);
      try { localStorage.setItem('ukt-basemap', basemap); } catch { /* 저장 못 해도 된다 */ }
    }
    if (e.target.dataset.networkFilter || e.target.dataset.networkGroup) {
      const group = NETWORK_GROUPS[e.target.dataset.networkGroup];
      for (const key of group ? Object.keys(group.types) : [e.target.dataset.networkFilter]) networkFilters[key] = e.target.checked;
      setPlanningStations(!!draft); drawServices(); renderLegend();
    }
    if (e.target.id === 'svc-lines-toggle') {
      setShowServices(e.target.checked);
      try { localStorage.setItem('ukt-svc-lines', showServices ? '1' : '0'); } catch { /* 저장 못 해도 이번에는 적용 */ }
      drawServices();
    }
    if (e.target.id === 'univs-toggle') {
      setShowUnivs(e.target.checked);
      try { localStorage.setItem('ukt-univs', showUnivs ? '1' : '0'); } catch { /* 저장 못 해도 이번에는 적용 */ }
      drawUnivs();
    }
    if (e.target.id === 'halls-toggle') {
      setShowHalls(e.target.checked);
      try { localStorage.setItem('ukt-halls', showHalls ? '1' : '0'); } catch { /* 저장 못 해도 이번에는 적용 */ }
      drawHalls();
    }
    if (e.target.id === 'housing-toggle') {
      setShowHousing(e.target.checked);
      try { localStorage.setItem('ukt-housing', showHousing ? '1' : '0'); } catch { /* 저장 못 해도 이번에는 적용 */ }
      setHousingVisible(map, showHousing);
    }

  });
  document.addEventListener('keydown', (e) => {
    if (!draft || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    if (e.key === 'Escape') { cancelDraft(); endHousingPick(); }
    if (e.key === 'Enter') commitDraft();
    if (e.key === 'Backspace') removeLastPoint();
  });
}

/** 메뉴 찾기(Ctrl+K)에 넣는 동작. 탭·접는 묶음 제목은 palette.js가 화면에서 따로 모은다 */
export function paletteCommands() {
  const cmds = [];
  const add = (group, title, run, extra = {}) => cmds.push({ group, title, run, ...extra });
  add('진행', '다음 해로 넘기기', () => $('#btn-next').click(), { hint: `${state.year}년 → ${state.year + 1}년`, keywords: '턴 진행 연도', order: 0 });
  add('진행', '소요 시간 재기', () => $('#btn-measure').click(), { keywords: '측정 이동 시간 경로', order: 1 });
  for (const [k, v] of Object.entries(NEW_BUILDS)) {
    add('건설', `새로 놓기: ${v.label}`, () => { switchTab('build'); startDraft(k); }, { hint: `${formatWon(v.perKm)}/km`, keywords: '신설 그리기 노선', order: 2 });
  }
  add('건설', `새로 놓기: ${AIRPORT.build.label}`, () => { switchTab('build'); startDraft('airport'); }, { keywords: '공항 신설', order: 2 });
  add('개량', '구간 개량하기', () => toast('지도에서 도로·철도 구간을 누르면 개량 메뉴가 열립니다. Shift를 누른 채 끌면 여러 구간을 한꺼번에 고릅니다.'), { keywords: '확장 복선화 전철화 차로', order: 3 });
  add('개량', '확장 요구 (혼잡 민원) 보기', () => switchTab('requests'), { keywords: '민원 정체 요구', order: 3 });
  add('운행', '역 골라 특급·급행 짜기', () => { switchTab('build'); startServicePick(); }, { keywords: '운행 계통 열차 노선 운행', order: 3 });
  add('예산', '예산·사업 투입 속도', () => switchTab('projects'), { hint: `가용 ${formatWon(state.budget)}`, keywords: '돈 부채 공사 진행', order: 3 });
  add('도움말', '처음 안내 다시 보기', showGuide, { keywords: '튜토리얼 도움말 사용법', order: 9 });
  add('도움말', '오류 제보·의견 보내기', reportBug, { hint: BUG_MAIL, keywords: '버그 오류 신고 제보 문의 메일 error report', order: 9 });
  add('진행', '5년 이어 넘기기', () => runYears(5), { keywords: '여러 해 자동 진행 빨리', order: 0 });
  add('현황', '결산 보기·이미지로 저장', showReport, { keywords: '성적 점수 결과 공유 이미지 캡처', order: 1 });
  // 묶음 안 깊숙한 항목으로 바로 가기 (정책·이벤트는 민원·정책 탭, 운영 성격은 운영 탭)
  const deep = [
    ['정책', '광역시 독립·승격', 'requests', '지방자치', '광역시', '광역시 승격 독립 시 도'],
    ['정책', '북측 지방자치 도입', 'requests', '지방자치', '북측 지방자치', '선거 자치'],
    ['정책', '북측 행정구역 1945년 이전으로 복원', 'requests', '지방자치', '1945', '강원북도 복원 행정구역 개편'],
    ['정책', '남북 행정구역 정리', 'requests', '지방자치', '행정구역 정리', '행정구역 개편 통합 정리'],
    ['정책', '북측 노선 이름을 남측 기준으로', 'requests', '지방자치', '노선 이름', '노선명 이름 바꾸기'],
    ['정책', '이주 정책 (북→남)', 'requests', '이주 정책', null, '이주 남하 통제'],
    ['정책', '국가 대형 사업', 'requests', '국가 대형 사업', null, '한일해저터널 시베리아 메가'],
    ['정책', '옛 이름 되찾기', 'requests', '옛 이름', null, '지명 이름 복원'],
    ['민원', '지자체 SOC 제안', 'requests', '지자체 SOC', null, '제안 단체장 받아들이기'],
    ['운영', '노선 폐선·감편 (영업계수)', 'ops', '영업계수', null, '폐선 감편 적자 수지 재개통'],
    ['운영', '철도 회사 재원·배당·합병', 'ops', '철도 운영사', null, '코레일 운영사 합병 증자 배당'],
    ['운영', '운행 계통 (특급·급행)', 'ops', '철도 운행 계통', null, '열차 계통 특급 급행'],
    ['운영', '항공 노선 자동 운영', 'ops', '항공', null, '취항 증편 단항 비행기'],
    ['설정', '저장 슬롯 (저장·불러오기)', 'settings', '저장 슬롯', null, '세이브 로드 되돌리기'],
    ['설정', '새 게임·난이도', 'settings', '새 게임', null, '처음부터 다시 난이도'],
  ];
  for (const [g, title, tab, sec, find, kw] of deep) add(g, title, () => goSection(tab, sec, find), { keywords: kw, order: 4 });
  for (const m of MEGA) add('국가 대형 사업', m.name, () => goSection('requests', '국가 대형 사업', m.name), { keywords: '대형 사업 메가', order: 4 });
  for (const [k, g] of Object.entries(NETWORK_GROUPS)) {
    add('보기', `지도 표시 전환: ${g.label}`, () => { const input = $(`[data-network-group="${k}"]`); input.checked = !input.checked; input.dispatchEvent(new Event('change', { bubbles: true })); }, { keywords: '레이어 표시 필터', order: 6 });
  }
  for (const [k, v] of Object.entries(METRICS)) {
    add('보기', `지도 색칠: ${v.label}`, () => { const sel = $('#metric'); sel.value = k; sel.dispatchEvent(new Event('change', { bubbles: true })); }, { keywords: '지표 색 범례', order: 6 });
  }
  for (const p of plans) {
    add('계획 사업', p.name, () => { switchTab('build'); openPlan(p.id); }, { hint: p.group, keywords: `${p.group} 계획`, order: 5 });
  }
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    add('지역', zoneName(i), () => { map.flyTo({ center: [z.cx, z.cy], zoom: 9.5 }); select({ type: 'zone', id: i }); }, { hint: z.province, keywords: `${z.province} 시군구`, order: 7 });
  });
  // 철도·도시철도 노선 이름
  const lines = new Map();
  allLinks().forEach((_, i) => {
    const e = linkAt(base, state, i);
    if (e.mode >= 1 && e.name && !e.ext && !e.name.endsWith(' 환승')) { if (!lines.has(e.name)) lines.set(e.name, []); lines.get(e.name).push(i); }
  });
  for (const [name, ids] of lines) add('노선', name, () => gotoLinks(ids.slice(0, 400)), { keywords: '철도 노선 운행', order: 8 });
  return cmds;
}

export function showGuide() {
  switchTab('status');
  const tab = (t) => () => switchTab(t);
  const phone = matchMedia('(max-width: 760px)').matches;   // 휴대폰: 패널이 지도 아래, Shift 끌기·Ctrl+K 없음
  const end = () => { switchTab('status'); const sel = $('#guide-mode'); if (sel) sel.value = getGuideMode(); };
  if (LANG === 'en') {
    startGuide([
      { target: '#map', title: 'Map', body: `Roads, railways and population of the whole peninsula. Road colour shows congestion (green → red); red triangles mark bottlenecks. Click a section to open upgrade options ${phone ? 'below' : 'on the right'}, or a station for its services and line diagram.${phone ? '' : ' <b>Shift-drag</b> to select many sections at once.'}` },
      { target: '#topbar .stats', title: 'Budget and approval', body: 'An infrastructure budget arrives every year and construction is paid over several years. Unspent money carries over for one year only. Approval rises and falls with congestion, unresolved requests, completed projects and debt; as North–South integration grows, more of the North opens up.' },
      { target: '#legend', title: 'Map view', body: 'Filter to roads, rail or air, or colour the map by population, income, happiness and more.' },
      { target: '[data-panel=build]', before: tab('build'), title: 'Build: new lines', body: 'Pick a type (motorway, high-speed rail, metro…) and click points on the map to draw it. Lines follow the terrain and you see the cost and benefit–cost ratio right away. Use <b>Preview effect</b>, then <b>Start construction</b>. Planned projects such as GTX lines or the Seoul–Pyongyang HSR can be opened from the list below.' },
      { target: '[data-panel=projects]', before: tab('projects'), title: 'Projects: money and works', body: 'Ongoing works and what they cost each year. You can speed projects up or slow them down. About 100 real projects under construction are already in progress.' },
      { target: '[data-panel=ops]', before: tab('ops'), title: 'Operations: trains and flights', body: 'Plan express services, check rail operators and route economics, and open domestic or international air routes.' },
      { target: '[data-panel=requests]', before: tab('requests'), title: 'Policy', body: 'Congestion complaints and local proposals pile up here; ignoring them costs approval. Migration policy, northern local autonomy and the administrative boundaries chosen in the first year are here too.' },
      { target: '#btn-find', before: tab('status'), title: 'Find menu', body: `Lost? ${phone ? 'Tap ⌕' : 'Press <b>Ctrl+K</b> (or /)'} and type part of a name to jump to tabs, regions, lines or planned projects.` },
      { target: '#btn-next', title: 'Next year', body: 'When your projects are set, advance the year: trips, congestion and migration are recalculated (10–20 s). <b>5 years ▶▶</b> runs five years in a row and stops when you start drawing. Reopen this tutorial with the <b>?</b> button.' },
    ], end);
    return;
  }
  startGuide([
    { target: '#map', title: '지도', body: `남북 전체의 도로·철도와 인구입니다. 도로 색은 혼잡도(초록 → 빨강)이고, 빨간 세모는 정체가 심한 곳입니다. 구간을 누르면 ${phone ? '아래 패널' : '오른쪽'}에 개량 메뉴가, 역을 누르면 운행 계통과 노선도가 열립니다.${phone ? '' : ' <b>Shift를 누른 채 끌면</b> 여러 구간을 한꺼번에 고릅니다.'}` },
    { target: '#topbar .stats', title: '예산과 지지율', body: '해마다 SOC 예산이 들어오고, 공사비는 몇 해에 나눠 나갑니다. 쓰지 않은 예산은 한 해 치까지만 남습니다. 지지율은 정체·민원·완공 사업·부채로 오르내리고, 남북 통합도가 오르면 북측 관광지와 교류가 열립니다.' },
    { target: '#legend', title: '보기 메뉴', body: '도로·철도·항공 그룹과 종류별 토글로 표시를 고르고, 인구·소득·행복도 같은 지표로 지도를 색칠합니다.' },
    { target: '[data-panel=build]', before: tab('build'), title: '건설: 새 노선 놓기', body: '종류(고속도로·고속철도·도시철도 등)를 고르고 지도에 점을 차례로 찍으면 노선이 그려집니다. 산·강은 지형을 따라 돌아가고, 공사비와 B/C가 바로 나옵니다. <b>효과 미리보기</b>로 통행 변화를 본 뒤 <b>착공</b>하세요. 아래 목록의 GTX·서부선·서울–평양 고속철도 같은 계획 사업은 눌러서 바로 열 수 있습니다.' },
    { target: '[data-panel=projects]', before: tab('projects'), title: '사업: 공사와 돈', body: '진행 중인 공사와 해마다 들어갈 돈입니다. 사업마다 투입 속도를 빠르게·느리게 바꿀 수 있습니다. 처음부터 진행 중인 사업 100여 건(실제 공사 중인 노선)이 들어 있습니다.' },
    { target: '[data-panel=ops]', before: tab('ops'), title: '운영: 열차와 항공', body: '역을 골라 특급·급행 계통을 짜고, 코레일·북측 철도 회사의 수지와 노선별 영업계수를 봅니다. 국제선·국내선 항공 노선도 여기서 엽니다.' },
    { target: '[data-panel=requests]', before: tab('requests'), title: '민원·정책', body: '혼잡 구간 확장 요구와 지자체 제안이 쌓입니다. 오래 두면 지지율이 떨어집니다. 이주 정책, 북측 지방자치, 통일 첫해에 정한 행정구역도 여기 있습니다.' },
    { target: '#btn-find', before: tab('status'), title: '메뉴 찾기', body: `어디 있는지 모르겠으면 ${phone ? '⌕ 단추를 누르고' : '<b>Ctrl+K</b>(또는 /)를 누르고'} 이름 일부나 초성을 쳐 보세요. 탭·지역·노선·계획 사업으로 바로 갑니다.` },
    { target: '#btn-next', title: '다음 해', body: '사업을 벌였으면 다음 해로 넘깁니다. 한 해 동안의 통행·혼잡과 인구 이동을 다시 계산합니다 (10~20초). <b>5년 ▶▶</b>는 다섯 해를 이어서 넘기고, 노선을 그리기 시작하면 멈춥니다. 이 안내는 상단의 <b>?</b> 단추로 다시 볼 수 있습니다.' },
  ], () => { switchTab('status'); const sel = $('#guide-mode'); if (sel) sel.value = getGuideMode(); });   // "다시 보지 않기"를 누르면 설정 칸도 맞춘다
}

export function removeLastPoint() {
  const p = draft.points.pop();
  if (p?.reserved) namer.release(p.name, p.kind);
  drawDraft(); renderBuild();
}

export function switchTab(tab) {
  if (tab !== 'build') endHousingPick();
  // 선택 패널은 오른쪽 패널을 다 차지하므로, 탭을 누르면 닫고 그 탭을 보여 준다
  if (!$('#selection').hidden) $('#selection .close')?.click();
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === tab));
  if (stalePanels.delete(tab)) PANEL_RENDER()[tab]?.();
  if (tab !== 'build') showPlan(null);
}

/** 계획 노선 하나만 지도에 점선으로 (null이면 지운다). 건설 탭 목록에서 계획을 누를 때 */
export let shownPlan = null;
export function showPlan(id) {
  if (!map) return;
  shownPlan = id;
  const plan = id ? plans.find((p) => p.id === id) : null;
  const line = showPlanLine(map, plan, plan ? planPreviewLine(plan) : null);
  document.querySelectorAll('[data-plan-show]').forEach((el) => { el.style.textDecoration = el.dataset.planShow === id ? 'underline' : ''; });
  if (!line) return;
  const xs = line.map((c) => c[0]), ys = line.map((c) => c[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 11 });
}

// ---- 접는 묶음: 패널의 소제목(h4, 설정은 h3)마다 그 아래 내용을 <details>로 묶는다. 펼침 상태는 이 브라우저에 남긴다
export const FOLD_KEY = 'ukt-folds-v2';   // v2: 사업·설정 탭을 접힌 채로 시작하도록 예전 펼침 기록을 버린다
export const FOLD_CLOSED = new Set(['settings:저장 슬롯', 'settings:새 게임', 'settings:데이터', 'status:추이', 'stats:관광', 'stats:추이', 'requests:옛 이름 되찾기']);
// 사업 탭(건설 사업 목록)과 설정 탭은 처음에 모두 접어 둔다
export const FOLD_CLOSED_PANELS = new Set(['projects', 'settings']);
export let folds = {};
try { folds = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { folds = {}; }

export function foldSections(el, key, tag) {
  if (el.hidden || el.querySelector(':scope > details.fold')) return;
  const kids = [...el.children];
  let box = null;
  for (const c of kids) {
    if (c.tagName === tag) {
      const title = c.textContent.trim(), id = `${key}:${title.replace(/\s*[\d(].*$/, '')}`;
      box = document.createElement('details');
      box.className = 'fold';
      box.open = folds[id] ?? !(FOLD_CLOSED.has(id) || FOLD_CLOSED_PANELS.has(key));
      // box는 반복문에서 다음 묶음으로 바뀌므로, 이벤트가 발생한 묶음의 상태를 읽는다.
      box.ontoggle = (e) => { folds[id] = e.currentTarget.open; try { localStorage.setItem(FOLD_KEY, JSON.stringify(folds)); } catch { /* 저장 못 해도 된다 */ } };
      const sum = document.createElement('summary');
      sum.innerHTML = c.innerHTML;
      el.insertBefore(box, c);
      box.appendChild(sum);
      c.remove();
    } else if (box) box.appendChild(c);
  }
}

export function watchFolds() {
  const spots = [['[data-panel=status]', 'status', 'H4'], ['[data-panel=stats]', 'stats', 'H3'], ['[data-panel=settings]', 'settings', 'H3'],
    ['[data-panel=projects]', 'projects', 'H3'], ['[data-panel=requests]', 'requests', 'H3'], ['[data-panel=ops]', 'ops', 'H3'], ['#selection', 'sel', 'H4']];
  for (const [sel, key, tag] of spots) {
    const el = $(sel);
    const run = () => foldSections(el, key, tag);
    new MutationObserver(run).observe(el, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    run();
  }
}

export function setBusy(on, label = '', v = 0) {
  setBusyValue(on);
  $('#busy').hidden = !on;
  $('.busy-label').textContent = autoYears ? `${label} · 이어 넘기기 ${autoYears}년 남음` : label;
  $('#busy-bar').style.width = `${Math.round(v * 100)}%`;
  $('#btn-next').disabled = on || !result;
  updateAutoBtn();
}

export const PANEL_RENDER = () => ({ status: renderStatus, build: renderBuild, projects: renderProjects, requests: renderRequests,
  ops: renderOps, settings: renderSettings, stats: renderStats });
export const stalePanels = new Set();

/** 상단·범례·지도 경계와 지금 보이는 탭만 다시 그리고, 나머지 탭은 열 때 그리도록 표시해 둔다 */
export function renderVisible() {
  renderRegions(); renderTop(); renderLegend(); renderSelection();
  const on = document.querySelector('.panel.on')?.dataset.panel;
  for (const [tab, fn] of Object.entries(PANEL_RENDER())) {
    if (tab === on) fn(); else stalePanels.add(tab);
  }
}

/**
 * 오른쪽 패널을 다시 그려도 보던 자리를 지킨다: 패널마다 스크롤 위치와, 펼쳐 둔 접는 묶음(details, 제목으로 짝짓는다).
 * 제안 수락·개량 착공처럼 패널 안 단추를 누른 뒤 목록이 닫히거나 맨 위로 튀지 않게
 */
export function keepPanels(fn) {
  const side = document.getElementById('side');
  if (!side) return fn();
  const boxes = [...side.querySelectorAll('#selection, .panel')].map((e) => [e, e.scrollTop]);
  const det = new Map();
  for (const d of side.querySelectorAll('details')) {
    const k = `${d.closest('[data-panel], #selection')?.dataset.panel || 'sel'}|${d.querySelector(':scope > summary')?.textContent.replace(/[\d,.]+/g, '#').trim()}`;
    det.set(k, d.open);
  }
  fn();
  // 소제목 접기(foldSections)는 MutationObserver로 조금 뒤에 붙으므로, 그 뒤에 한 번 더 맞춘다
  const restore = () => {
  for (const d of side.querySelectorAll('details')) {
    const k = `${d.closest('[data-panel], #selection')?.dataset.panel || 'sel'}|${d.querySelector(':scope > summary')?.textContent.replace(/[\d,.]+/g, '#').trim()}`;
    if (det.has(k) && d.open !== det.get(k)) d.open = det.get(k);
  }
  for (const [e, t] of boxes) if (t) e.scrollTop = t;
  };
  restore();
  queueMicrotask(restore);
}

export function renderAll() {
  adminInvalidate();
  keepPanels(renderAllPanels);
}

export function renderAllPanels() {
  stalePanels.clear();
  renderRegions();
  // 다 지은 택지지구는 배경 지도에 시가지로 (반지름은 여기 크기표를 따른다: 지도 쪽 표에 1기 신도시급이 없어 1km 원으로 그리던 것)
  if (map) { setHousing(map, (state.housing || []).map((h) => ({ ...h, R: housingR(h) }))); setHousingVisible(map, showHousing); }
  renderTop(); renderLegend(); renderStatus(); renderBuild(); renderProjects(); renderRequests(); renderOps(); renderSettings(); renderStats(); renderSelection();
  drawServices();
  drawHalls();
  drawUnivs();
}

/** 지도의 광역 단체 경계·이름: 북측 도 복원, 광역시 승격(독립)이 바로 보이게 */
export function renderRegions() {
  if (!state || !map) return;
  const regs = zoneProps.map((z) => (z.ext ? '' : regionOf(state, z))), names = new Set(regs);
  // 줄인 이름이 다른 단체 이름의 앞부분이면(강원특별자치도 → '강원' 옆에 강원북도) 줄이지 않는다
  const short = (n) => { for (const a of ['특별자치시', '특별자치도', '통합특별시', '특별시', '광역시', '직할시']) if (n.endsWith(a) && n.length > a.length + 1) { const s = n.slice(0, -a.length); return [...names].some((m) => m !== n && m.startsWith(s)) ? n : s; } return n; };
  setRegions(map, regs, zoneProps.map((z) => z.country), (i) => [zoneProps[i].cx, zoneProps[i].cy], short, zoneProps.map((z, i) => countyKey(i)));
}

export function renderTop() {
  $('#s-year').textContent = `${state.year}년`;
  $('#s-budget').textContent = formatWon(state.budget);
  $('#s-debt').textContent = formatWon(state.debt);
  $('#s-debt').className = 'v' + (state.debt > 0 ? ' neg' : '');
  $('#s-approval').textContent = `${state.approval.toFixed(0)}%`;
  $('#s-integration').textContent = `${Math.round(state.integration * 100)}%`;
  $('#btn-next').disabled = busy || !result;
  updateAutoBtn();
}

export const networkFilters = { ...DEFAULT_NETWORK_FILTERS };
export let basemap = (() => { try { return localStorage.getItem('ukt-basemap') || 'plain'; } catch { return 'plain'; } })();
export function renderLegend() {
  // 좁은 화면에서는 고르기 칸과 색 띠만 보이고, 나머지는 '범례 더 보기'로 편다 (지도를 덜 가리게)
  if (metricLevel(metric) !== 'all') setMapLevel(metricLevel(metric));
  $('#legend').innerHTML = legendHTML(metric, networkFilters, basemap, mapLevel) + `<div class="lg-extra">${(networkFilters.hsr || networkFilters.rail || networkFilters.narrow) && !networkFilters.railCongestion ? railKindLegend() : ''}
    <label style="display:flex;gap:4px;align-items:center;font-size:11px;margin-top:4px"><input type="checkbox" id="svc-lines-toggle" ${showServices ? 'checked' : ''}> 운행 계통 노선 보기</label>
    <label style="display:flex;gap:4px;align-items:center;font-size:11px;margin-top:2px"><input type="checkbox" id="housing-toggle" ${showHousing ? 'checked' : ''}> 택지지구 경계·단지 보기</label>
    <label style="display:flex;gap:4px;align-items:center;font-size:11px;margin-top:2px"><input type="checkbox" id="halls-toggle" ${showHalls ? 'checked' : ''}> 시청·군청·구청 보기</label>
    <label style="display:flex;gap:4px;align-items:center;font-size:11px;margin-top:2px"><input type="checkbox" id="univs-toggle" ${showUnivs ? 'checked' : ''}> 대학 보기</label></div>`
    + `<button type="button" class="small lg-toggle">${$('#legend').classList.contains('open') ? '범례 접기' : '범례 더 보기'}</button>`;
  for (const input of $('#legend').querySelectorAll('[data-network-group]')) {
    const keys = Object.keys(NETWORK_GROUPS[input.dataset.networkGroup].types);
    input.indeterminate = keys.some((k) => networkFilters[k]) && !keys.every((k) => networkFilters[k]);
  }

}

export function fmtPop(v) { return v >= 1e6 ? `${(v / 1e6).toFixed(2)}백만` : `${Math.round(v / 1000).toLocaleString()}천`; }
export function pct(v, d = 1) { return `${(v * 100).toFixed(d)}%`; }

/** 현황: 전국 정당 지지율 (지방자치를 하는 시군의 지지율을 인구로 가중, 남·북 따로) */
export function nationalSupportHTML() {
  if (!result || !state.local) return '';
  const acc = { all: {}, KR: {}, KP: {} }, w = { all: 0, KR: 0, KP: 0 };
  zoneProps.forEach((z, i) => {
    if (z.ext || !hasAutonomy(state, z)) return;
    const pp = result.zones.pop[i];
    if (!(pp > 0)) return;
    const sup = partySupport(z, state.local.support?.[regionOf(state, z)], state.local.offices[mayorKey(i)]?.party);
    for (const g of ['all', z.country]) { w[g] += pp; for (const [k, v] of Object.entries(sup)) acc[g][k] = (acc[g][k] || 0) + v * pp; }
  });
  if (!w.all) return '';
  const bar = (g) => {
    const rows = Object.entries(acc[g]).map(([k, v]) => [k, v / w[g]]).sort((a, b) => b[1] - a[1]);
    return `<div style="display:flex;height:12px;border-radius:3px;overflow:hidden;margin:3px 0">${rows.map(([k, v]) => `<span title="${esc(PARTIES[k].name)} ${(v * 100).toFixed(1)}%" style="width:${v * 100}%;background:${PARTIES[k].color}"></span>`).join('')}</div>
      <div class="m">${rows.map(([k, v]) => `${partyBadge(k)} ${(v * 100).toFixed(1)}%`).join(' ')}</div>`;
  };
  const kp = w.KP > 0;
  return `<h4>정당 지지율 (전국)</h4>${bar('all')}
    ${kp ? `<div class="m" style="margin-top:4px">남측</div>${bar('KR')}<div class="m" style="margin-top:4px">북측</div>${bar('KP')}` : ''}
    <p class="hint">시군마다 지역 성향·현직 단체장·정당 제안을 받아 주거나 거절한 결과를 인구로 가중한 값입니다.${kp ? '' : ' 북측은 지방자치를 시행하면 함께 셉니다.'}</p>`;
}

/** 철도·대중교통 분담: 지역 간 통행 + 시군구 안 통행(버스·도시철도) */
export function allTransitShare(t) {
  const L = t.local || { trips: 0, bus: 0, metro: 0 };
  return (t.rail + t.transit + L.bus + L.metro) / Math.max(1, t.trips + L.trips);
}

export function renderStatus() {
  const el = $('[data-panel=status]');
  if (!result) { el.innerHTML = '<p class="hint">기준 연도 교통수요를 계산하고 있습니다…</p>'; return; }
  const s = result.summary, t = result.totals;
  const tot = s.KR.pop + s.KP.pop;
  const h = state.history;
  const first = h[0];
  const cong = h[h.length - 1]?.congestedKm ?? 0;
  // 요약 카드: 지난해 대비 변화
  const prev = h.length > 1 ? h[h.length - 2] : null, last = h[h.length - 1];
  const delta = (now, before, fmt, good = 1) => {
    if (before == null || now == null || !Number.isFinite(now - before) || Math.abs(now - before) < 1e-9) return '';
    const up = now > before;
    return `<span class="${(up ? good : -good) > 0 ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${fmt(Math.abs(now - before))}</span>`;
  };
  const tiles = [
    ['지역 간 통행', `${fmtPop(t.trips)}`, delta(t.trips, prev?.trips, fmtPop)],
    ['철도·대중교통 분담', pct(allTransitShare(t), 0), delta(last?.allTransit, prev?.allTransit, (v) => `${(v * 100).toFixed(1)}%p`)],
    ['정체 도로', `${Math.round(cong).toLocaleString()}km`, delta(cong, prev?.congestedKm, (v) => `${Math.round(v)}km`, -1)],
    ['남북 소득 격차', `${(s.KR.income / s.KP.income).toFixed(1)}배`, prev ? delta(last.krInc / last.kpInc, prev.krInc / prev.kpInc, (v) => `${v.toFixed(1)}`, -1) : ''],
  ];
  el.innerHTML = `
    <div class="row" style="display:flex;align-items:center;gap:8px"><h3 style="flex:1">${state.year}년 현황</h3>
      <button class="small" id="btn-report" title="시작한 해와 견준 성적표, SNS 공유용 이미지">결산 보기</button></div>
    ${goalHTML()}
    <div class="kpis">${tiles.map(([k, v, d]) => `<div><span class="k">${k}</span><span class="v">${v}</span>${d ? `<span class="d">${d}</span>` : ''}</div>`).join('')}</div>
    ${state.approvalWhy ? `<h4>지지율 ${state.approval.toFixed(0)}% (목표 ${state.approvalTarget.toFixed(0)}%)</h4>
    <table class="kv">${state.approvalWhy.map(([k, v], i) => `<tr><td>${esc(k)}</td><td class="${i && v > 0 ? 'pos' : v < 0 ? 'neg' : ''}">${i && v > 0 ? '+' : ''}${v}</td></tr>`).join('')}</table>
    <p class="hint">지지율은 해마다 목표치 쪽으로 35%씩 움직입니다. 정체를 줄이고, 오래된 민원을 풀고, 예산을 남기지 않고 사업을 마치면 오릅니다.</p>` : ''}
    ${nationalSupportHTML()}
    <h4>인구·소득</h4>
    <table class="cmp">
      <tr><th></th><th>남</th><th>북</th><th>전체</th></tr>
      <tr><td>인구</td><td>${fmtPop(s.KR.pop)}</td><td>${fmtPop(s.KP.pop)}</td><td>${fmtPop(tot)}</td></tr>
      <tr><td>HDI</td><td>${s.KR.hdi.toFixed(3)}</td><td>${s.KP.hdi.toFixed(3)}</td><td>${((s.KR.hdi * s.KR.pop + s.KP.hdi * s.KP.pop) / tot).toFixed(3)}</td></tr>
      <tr><td>1인당 소득</td><td>$${Math.round(s.KR.income).toLocaleString()}</td><td>$${Math.round(s.KP.income).toLocaleString()}</td><td>${(s.KR.income / s.KP.income).toFixed(1)}배 격차</td></tr>
      ${happiness ? (() => { const a = avgHappiness(); return `<tr><td>주민 행복도</td><td>${a.KR.toFixed(1)}</td><td>${a.KP.toFixed(1)}</td><td>${a.all.toFixed(1)}</td></tr>`; })() : ''}
    </table>
    <h4>교통</h4>
    <table class="kv">
      <tr><td>지역 간 통행 (일)</td><td>${fmtPop(t.trips)} 통행</td></tr>
      <tr><td>수단 분담 (승용차·철도·대중교통)</td><td>${pct(t.road / t.trips, 0)} · ${pct(t.rail / t.trips, 0)} · ${pct(t.transit / t.trips, 0)}</td></tr>
      ${t.local ? `<tr><td>시군구 안 통행 (일) · 승용차·버스·도시철도</td><td>${fmtPop(t.local.trips)} · ${pct(t.local.car / t.local.trips, 0)} · ${pct(t.local.bus / t.local.trips, 0)} · ${pct(t.local.metro / t.local.trips, 0)}</td></tr>
      <tr><td>전체 대중교통 분담 (시군구 안 포함)</td><td>${pct(allTransitShare(t), 1)}</td></tr>` : ''}
      <tr><td>남북 간 통행 (일)</td><td>${fmtPop(t.kpkr)} 통행</td></tr>
      <tr><td>항공 · 국제 통행 (일)</td><td>${fmtPop(t.air || 0)} · ${fmtPop(t.intl || 0)}</td></tr>
      <tr><td>관광 통행 (일)</td><td>${fmtPop(t.tour || 0)} <span class="m">입국 ${fmtPop(t.tourIn || 0)} · 출국 ${fmtPop(t.tourOut || 0)}</span></td></tr>
      <tr><td>정체 도로 (V/C&gt;1)</td><td>${Math.round(cong).toLocaleString()} km</td></tr>
    </table>
    <h4>인구 이동 (지난 1년)</h4>
    <table class="kv">
      <tr><td>북 → 남</td><td>${fmtPop(s.kpToKr || 0)}</td></tr>
      <tr><td>남 → 북</td><td>${fmtPop(s.krToKp || 0)}</td></tr>
    </table>
    ${h.length > 1 ? `<h4>추이</h4><table class="cmp">
      <tr><th>연도</th><th>북 인구</th><th>북 HDI</th><th>소득 격차</th><th>철도</th></tr>
      ${h.slice(-8).reverse().map((r) => `<tr><td>${r.year}</td><td>${fmtPop(r.kpPop)}</td><td>${r.kpHdi.toFixed(3)}</td><td>${(r.krInc / r.kpInc).toFixed(1)}배</td><td>${pct(r.rail, 0)}</td></tr>`).join('')}
    </table>
    <p class="hint">시작(${first.year}) 대비 북 인구 ${pct(h[h.length - 1].kpPop / first.kpPop - 1)}, 북 HDI ${(h[h.length - 1].kpHdi - first.kpHdi >= 0 ? '+' : '')}${(h[h.length - 1].kpHdi - first.kpHdi).toFixed(3)}</p>` : ''}
    <h4>기록</h4>
    <div class="log">${state.log.slice(0, 30).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
}

export function renderBuild() {
  const el = $('[data-panel=build]');
  const tools = Object.entries(NEW_BUILDS).map(([k, v]) =>
    `<button data-build="${k}" class="${draft?.type === k ? 'on' : ''}">${v.label}<span class="c">${formatWon(v.perKm)}/km · ${v.years}년</span></button>`).join('')
    + `<button data-build="airport" class="${draft?.type === 'airport' ? 'on' : ''}">${AIRPORT.build.label}<span class="c">${formatWon(AIRPORT.build.cost)} · ${AIRPORT.build.years}년</span></button>`;
  let body = `${compareHTML()}<div class="tool-row"><button class="small" data-padd="station">역 신설 (노선 위 한 점)</button><button class="small" data-padd="ic">IC·JCT 신설 (고속도로 위 한 점)</button><button class="small" data-padd="rest">휴게소 신설</button><button class="small" id="univ-start">대학 설립</button>
    <button class="small svc-pick-b">역 골라 특급·급행 짜기</button><button class="small" id="housing-pick" title="지도에서 고른 곳에 주택 단지를 조성합니다 (인구 순증)">택지지구 개발</button></div>
    <div class="name-row" style="margin-bottom:4px"><input type="text" id="rec-text" placeholder="예: 평양에 도시철도 3호선을 짓고 싶어, 노선을 추천해줘" style="flex:1">
      <button class="small primary" id="rec-go">노선 추천</button></div>
    <p class="hint" id="rec-msg">${esc(recMsg)}</p>
    <div class="name-row"><span class="kind">미리보기</span><select id="prev-years">
      <option value="0" ${previewYears ? '' : 'selected'}>첫해 (빠름)</option><option value="5" ${previewYears ? 'selected' : ''}>5년 뒤 (읍면동 인구 이동 반영, 느림)</option></select></div>
    <p class="hint">기존 도로·철도를 개량하려면 지도에서 구간을 누르세요. <b>Shift를 누른 채 끌면</b> 여러 구간을 한꺼번에 골라 개량할 수 있습니다. 새 노선을 놓으려면 아래에서 종류를 고른 뒤 지도를 차례로 누르세요.</p>`;
  if (draft) {
    if (draft.type === 'airport') {
      el.innerHTML = `<h4>${AIRPORT.build.label}</h4><p class="hint">공항을 놓을 곳을 지도에서 한 번 누르세요. ${formatWon(AIRPORT.build.cost)} · ${AIRPORT.build.years}년 · 연 ${AIRPORT.build.cap}백만 명. Esc: 취소</p>
        <button id="draft-cancel">취소</button>`;
      $('#draft-cancel').onclick = cancelDraft;
      return;
    }
    const spec = NEW_BUILDS[draft.type];
    const { km, cost, years, foreignKm, terrain, lims, reuse, reusedKm } = draftCost();
    const slow = lims.filter((x) => x.v < spec.attrs.speed), minR = Math.min(...lims.map((x) => x.r));
    const tRule = terrainRule(draft.type);
    // 철도 신설은 운영사 자체 재원으로도 지을 수 있다 (찍은 점 대부분이 북측이면 KPRail)
    const draftOp = spec.mode === 1 ? operatorOf(state, { mode: 1, kp: draft.points.filter((p) => isKP(p.lat, p.lon)).length * 2 > draft.points.length ? 1 : 0 }) : null;
    const draftFund = draftOp && state.rail.fund === 'op' ? draftOp : 'gov';
    const affordable = canAfford(state, cost, years, draftFund);
    const lineName = draftLineName();
    body = `<h4>${spec.label}</h4>
      ${draft.recNote ? `<p class="hint">${esc(draft.recNote)}</p>` : ''}
      ${lineName ? `<div class="name-row"><span class="kind">노선</span><input type="text" id="line-name" value="${esc(lineName)}"></div>` : ''}
      ${draft.extendOf || draft.extend === false ? `<div class="name-row"><label><input type="checkbox" id="draft-extend" ${draft.extendOf ? 'checked' : ''}>
        기존 노선의 연장으로 놓기${draft.extendOf ? ` (${esc(draft.extendOf)})` : ''}</label></div>` : ''}
      ${retireChoiceHTML()}
      ${draft.points.length > 1 ? `<p class="hint">${draft.extendOf ? `기존선 연장: ${esc(draft.extendOf)}의 종점에서 이어 같은 노선 이름을 씁니다.` : '신설 노선: 새 노선 이름을 붙입니다.'}</p>` : ''}
      <p class="hint">기존 ${spec.mode ? '선로' : '도로'} 근처를 누르면 연결됩니다. ${spec.mode ? '각 점은 역이 됩니다.' : '끝점이 기존 도로 0.5km 안이면 그 도로에 이어지고, 더 멀면 막다른 도로로 그 자리에서 끝납니다.'}
      <b>Shift+누르기</b>: 역 없는 경유점 · <b>점 끌기</b>: 역·경유점 옮기기 · Backspace: 마지막 점 지우기 · Enter: 착공 · Esc: 취소</p>
      ${spec.mode >= 1 ? draftStationPicker() : ''}
      ${reuse?.length ? `<p class="hint reuse-note">초록색은 기존선 이용 구간입니다. 사업비·공사 대상에서 제외합니다.${reuse.some(r => r.shared) ? ' 서울–행신은 KTX 기존선 공용 구간을 이용합니다.' : ''}</p>` : ''}
      <div>${draft.points.map((p, i) => (p.via ? '' : pointRow(p, i))).join('') || '<p class="hint">시작점을 누르세요.</p>'}</div>
      ${draft.points.some((p) => p.via) ? `<p class="hint">선형을 잡는 경유점 ${draft.points.filter((p) => p.via).length}개 (역·IC 없음)</p>` : ''}
      ${(() => { const pl = draft.plan && plans.find((x) => x.id === draft.plan); return pl?.source ? `<p class="hint"><b>계획 근거</b>: ${esc(pl.source)}${pl.stationSource ? `<br>역: ${esc(pl.stationSource)}` : ''}</p>` : ''; })()}
      ${draft.planFilled ? `<p class="hint">계획 노선이 기존 국도·지방도와 만나는 곳에 IC ${draft.planFilled}곳을 넣었습니다. 필요 없으면 목록에서 지우세요.</p>` : ''}
      <table class="kv" style="margin-top:8px">
        <tr><td>신설 연장</td><td>${km.toFixed(1)} km</td></tr>${reusedKm > 0 ? `<tr class="reuse-summary"><td>기존선 이용 · 공사 제외</td><td>${reusedKm.toFixed(1)} km</td></tr>` : ''}
        ${NEW_BUILDS[draft.type].mode >= 1 ? `<tr><td>역 반경 ${catchKm(draft.type)}km 인구</td><td>${fmtPeople(draft.points.filter((q) => q.name && q.kind !== 'IC').reduce((t, q) => t + popNear(q.lon, q.lat, catchKm(draft.type)), 0))} <span class="m">(역 ${draft.points.filter((q) => q.name && q.kind !== 'IC').length}곳, 겹친 곳도 셈)</span></td></tr>` : ''}
        <tr><td>사업비</td><td>${formatWon(cost)}</td></tr>
        ${lims.length && spec.mode !== 2 ? `<tr><td>${spec.mode === 0 ? '설계 속도' : '최고 속도'} (선형)</td><td>${slow.length
          ? `<span class="neg">${Math.min(...slow.map((x) => x.v))}~${spec.attrs.speed}km/h</span> <span class="m">급곡선(반경 ${minR < 1 ? `${Math.round(minR * 1000)}m` : `${minR.toFixed(1)}km`}) 때문에 ${slow.length}/${lims.length}개 구간이 느림 (지도의 빨간 점) · 경유점을 옮겨 곡선을 펴면 오릅니다</span>`
          : `${spec.attrs.speed}km/h <span class="m">${Number.isFinite(minR) ? `가장 급한 곡선 반경 ${minR.toFixed(1)}km` : '직선'}</span>`}</td></tr>` : ''}
        <tr><td>공사 기간 · 연 분담</td><td>${years}년 · ${formatWon(cost / years)}</td></tr>
        ${foreignKm > 0.5 ? `<tr><td>외국 구간 (상대국 절반 부담)</td><td>${foreignKm.toFixed(0)} km</td></tr>` : ''}
        ${terrain && draft.points.length > 1 ? `<tr><td>지형 (어림)</td><td>터널·깎기 ${terrain.tunnelKm.toFixed(0)}km · 교량 ${(terrain.bridgeKm + terrain.seaKm).toFixed(1)}km</td></tr>` : ''}
        ${draftCost().mids ? `<tr><td>중간 ${spec.mode === 0 ? 'IC' : '역'} ${draftCost().mids}곳</td><td>${formatWon(draftCost().mids * (spec.mode === 0 ? MID_COST.road : MID_COST.rail))}</td></tr>` : ''}
        ${draftCost().rests ? `<tr><td>휴게소 ${draftCost().rests}곳 (약 ${REST.spacingKm}km마다)</td><td>${formatWon(draftCost().rests * REST.cost)}</td></tr>` : ''}
      </table>
      ${pppSection()}
      ${draftOp && (draft.ppp?.type || 'gov') === 'gov' ? fundSelect([draftOp]) : ''}
      <div class="name-row"><label><input type="checkbox" id="snap-node" ${snap.node ? 'checked' : ''}> 노드에 붙이기</label>
        <label><input type="checkbox" id="snap-line" ${snap.line ? 'checked' : ''}> 선 위에 붙이기 (중간 ${spec.mode === 0 ? 'IC' : '역'})</label></div>
      <p class="hint">노란 점(◆)은 중국·러시아·일본 거점 도시입니다. 끝점을 거점에 붙이면 국제 노선이 됩니다.
        기존 ${spec.mode ? '선로' : '도로'} 중간을 누르면 그 자리에 ${spec.mode === 0 ? 'IC·JCT를' : '역을'} 만들고 이어집니다.</p>
      ${!affordable && draft.points.length > 1 ? '<p class="hint neg">예산과 차입 한도를 넘습니다.</p>' : ''}
      ${tRule ? `<div class="actions"><button id="draft-terrain" ${draft.points.length < 2 || !terrainReady() ? 'disabled' : ''} title="찍은 역·IC 사이를 경사가 급한 산지와 강·바다를 덜 지나는 선형으로 다시 잡습니다">지형 따라 선형 잡기</button></div>` : ''}
      <div class="actions nowrap">
        <button class="primary" id="draft-ok" ${draft.points.length < 2 || !affordable || (spec.mode >= 1 && km < 0.001) ? 'disabled' : ''}>${spec.mode >= 1 && draft.points.length > 1 && km < 0.001 ? '전 구간 기존선 이용' : '착공'}</button>
        <button id="draft-prev" ${draft.points.length < 2 || (spec.mode >= 1 && km < 0.001) ? 'disabled' : ''}>효과 미리보기</button>
        <button id="draft-cancel">취소</button>
      </div>`;
  }
  el.innerHTML = `<div class="tools">${tools}</div>${body}${draft ? '' : plansHTML() + megaHTML()}`;
  if (!draft) bindMega(el);
  el.querySelectorAll('[data-plan-show]').forEach((b) => { b.onclick = () => showPlan(shownPlan === b.dataset.planShow ? null : b.dataset.planShow); });
  if (draft) showPlan(null);
  el.querySelectorAll('[data-plan]').forEach((b) => { b.onclick = () => openPlan(b.dataset.plan); });
  el.querySelectorAll('.svc-pick-b').forEach((b) => { b.onclick = startServicePick; });
  el.querySelectorAll('[data-padd]').forEach((b) => { b.onclick = () => startPointAdd(b.dataset.padd); });
  el.querySelector('#univ-start')?.addEventListener('click', startUnivPick);
  const hp = el.querySelector('#housing-pick');
  if (hp) hp.onclick = startHousingPick;
  const py = el.querySelector('#prev-years');
  if (py) py.onchange = () => { setPreviewYears(+py.value); };
  const recGo = () => recommendRoute(el.querySelector('#rec-text').value);
  el.querySelector('#rec-go')?.addEventListener('click', recGo);
  el.querySelector('#rec-text')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); recGo(); } });
  el.querySelectorAll('[data-build]').forEach((b) => { b.onclick = () => startDraft(b.dataset.build); });
  if (draft) {
    bindDraftStationPicker();
    $('#draft-ok').onclick = commitDraft;
    $('#draft-prev').onclick = previewDraft;
    const tb = $('#draft-terrain');
    if (tb) tb.onclick = terrainAlign;
    $('#snap-node').onchange = (e) => { snap.node = e.target.checked; };
    bindFund(el, renderBuild);
    bindPPP(el);
    $('#snap-line').onchange = (e) => { snap.line = e.target.checked; };
    const ln = $('#line-name');
    if (ln) ln.onchange = () => { draft.lineName = ln.value.trim() || draft.lineName; draft.lineNameEdited = true; };
    const ex = $('#draft-extend');
    if (ex) ex.onchange = () => { draft.extend = ex.checked; draft.lineNameEdited = false; renderBuild(); };
    const rt = $('#draft-retire');
    if (rt) rt.onchange = () => { draft.retireLines = rt.value ? [rt.value] : []; renderBuild(); };
    $('#draft-cancel').onclick = cancelDraft;
    el.querySelectorAll('[data-pname]').forEach((inp) => {
      inp.onchange = () => renameDraftPoint(+inp.dataset.pname, inp.value.trim());
    });
    // 이름 줄에 마우스를 올리거나 칸을 고르면 그 역을 지도에 강조 (이름을 고치는 역이 어디인지)
    el.querySelectorAll('[data-prow]').forEach((row) => {
      const on = () => { const q = draft?.points[+row.dataset.prow]; if (q) { setHighlight({ point: [q.lon, q.lat] }); showPointOnMap([q.lon, q.lat]); } };
      row.addEventListener('mouseenter', on);
      row.addEventListener('focusin', on);
      row.addEventListener('mouseleave', () => { if (!row.contains(document.activeElement)) setHighlight(); });
      row.addEventListener('focusout', () => setHighlight());
    });
    el.querySelectorAll('[data-pauto]').forEach((b) => {
      b.onclick = () => {
        const p = draft.points[+b.dataset.pauto];
        if (p.reserved) namer.release(p.name, p.kind);
        p.name = namer.suggest(p.lon, p.lat, p.kind); p.reserved = true; p.auto = true;
        renderBuild();
      };
    });
    el.querySelectorAll('[data-pdel]').forEach((b) => { b.onclick = () => removeDraftPoint(+b.dataset.pdel); });
    el.querySelectorAll('[data-ptoggle]').forEach((b) => {
      b.onclick = () => {
        const p = draft.points[+b.dataset.ptoggle];
        if (p.kind) { if (p.reserved) namer.release(p.name, p.kind); p.kind = null; p.name = null; p.reserved = false; }
        else { p.kind = 'station'; p.name = namer.suggest(p.lon, p.lat, 'station'); p.reserved = true; delete p.via; }
        renderBuild();
      };
    });
  }
}

export function pointRow(p, i) {
  const spec = NEW_BUILDS[draft.type];
  const tag = p.node != null ? '연결' : '신규';
  // 잘못 놓았거나 필요 없어진 역·경유점을 하나씩 뺀다 (마지막 점만 지우던 것)
  const del = `<button class="small" data-pdel="${i}" title="이 점 빼기">✕</button>`;
  if (!p.name) {
    const toggle = spec.mode >= 1 ? `<button class="small" data-ptoggle="${i}">역 설치</button>` : '';
    return `<div class="name-row" data-prow="${i}"><span class="kind">${tag}</span><span style="flex:1;color:var(--muted)">경유점 ${i + 1}</span>${toggle}${del}</div>`;
  }
  const catchment = spec.mode >= 1 ? `<span class="m" title="역 반경 ${catchKm(draft.type)}km 인구">${fmtPeople(popNear(p.lon, p.lat, catchKm(draft.type)))}</span>` : '';
  if (p.existing) return `<div class="name-row" data-prow="${i}"><span class="kind">${tag}</span><span style="flex:1">${esc(p.name)}</span>${catchment}${del}</div>`;
  const toggle = spec.mode >= 1 && i > 0 && i < draft.points.length - 1 ? `<button class="small" data-ptoggle="${i}">통과</button>` : '';
  return `<div class="name-row" data-prow="${i}"><span class="kind">${p.kind === 'station' ? '역' : p.kind}</span>
    <input type="text" data-pname="${i}" value="${esc(p.name)}">
    <button class="small" data-pauto="${i}" title="자동 이름">↻</button>${catchment}${toggle}${del}</div>`;
}

/** 그리는 노선에서 점 하나를 뺀다. 그 점을 지나려고 앞뒤에 깐 선형 점(지형·접선)도 함께 빼, 앞뒤 역·경유점을 곧게 잇는다 */
export function removeDraftPoint(i) {
  const pts = draft?.points, p = pts?.[i];
  if (!p) return;
  if (p.reserved) namer.release(p.name, p.kind);
  let a = i, b = i;
  while (a > 0 && pts[a - 1].via) a--;
  while (b < pts.length - 1 && pts[b + 1].via) b++;
  pts.splice(a, b - a + 1);
  setHighlight();
  drawDraft(); renderBuild();
}

export function renameDraftPoint(i, name) {
  const p = draft.points[i];
  if (!name || name === p.name) { renderBuild(); return; }
  if (namer.isUsed(name, p.kind)) { alert(`'${name}'은(는) 이미 쓰이는 이름입니다.`); renderBuild(); return; }
  if (p.reserved) namer.release(p.name, p.kind);
  p.name = name; p.reserved = true; p.auto = false;
  namer.reserve(name, p.kind);
}

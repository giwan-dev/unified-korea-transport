// 영어판 (베타): 처음 보는 화면(불러오기·상단 바·탭·보기 메뉴·안내·시작 창·현황·결산·사건)을 영어로 바꾼다.
// 화면에 그려지는 글을 지켜보다가(MutationObserver) 사전에 있는 글, 또는 숫자·단위만 바꾸면 한글이 남지 않는 글만 바꾼다.
// 그래서 지명이 섞인 글은 한국어 그대로 남는다 (반쯤 바뀐 글이 생기지 않게). 긴 글은 코드에서 t()로 고른다.

export const LANG = (() => {
  try {
    const v = localStorage.getItem('ukt-lang');
    if (v) return v;
  } catch { /* 저장소 없음 */ }
  return (navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
})();

export function setLang(v) {
  try { localStorage.setItem('ukt-lang', v); } catch { /* 저장 못 해도 된다 */ }
  location.reload();
}

/** 글 그대로 바꿀 것 (앞뒤 빈칸은 두고 견준다) */
const EXACT = {
  // 불러오기 화면
  '통일 한반도 교통망': 'Unified Korea Transport',
  '2026년, 남북이 오늘 통일되었습니다. 한정된 SOC 예산으로 고속도로·철도·도시철도를 놓고 국토를 다시 짜 보세요.': 'It is 2026 and the two Koreas have just reunified. Rebuild the peninsula with a limited infrastructure budget: motorways, railways and subways.',
  '데이터 내려받기': 'Downloading data', '도로·철도·인구 격자': 'roads · rail · population grid',
  '시뮬레이션 준비': 'Preparing simulation', '기준 연도 교통 흐름': 'base-year traffic',
  '지도 그리기': 'Drawing the map', '배경 지도와 노선': 'basemap and network',
  '팁: 지도의 도로·철도 구간을 누르면 개량할 수 있고, 건설 탭에서 새 노선을 그릴 수 있습니다.': 'Tip: click a road or rail section to upgrade it, or draw new lines in the Build tab.',
  '개발자 연락처 ·': 'Developer contact ·',
  // 상단 바·탭
  '연도': 'Year', '가용 예산': 'Budget', '부채': 'Debt', '지지율': 'Approval', '남북 통합도': 'Integration',
  '메뉴 찾기': 'Find menu', '소요 시간': 'Travel time', '다음 해 ▶': 'Next year ▶', '5년 ▶▶': '5 years ▶▶',
  '현황': 'Overview', '건설': 'Build', '사업': 'Projects', '운영': 'Operations', '민원·정책': 'Policy', '통계': 'Stats', '설정': 'Settings',
  '계산 중': 'Computing', '닫기': 'Close', '확인': 'OK', '취소': 'Cancel', '착공': 'Start construction', '다음': 'Next', '이전': 'Back', '건너뛰기': 'Skip', '시작하기': 'Start',
  '다시 보지 않기 (설정 › 도움말에서 바꿀 수 있습니다)': "Don't show again (change in Settings › Help)",
  // 보기 메뉴
  '모두 보기': 'Show all', '도로만': 'Roads only', '철도만': 'Rail only', '항공만': 'Air only', '아무것도 안 보기': 'Hide network',
  '표시 안 함': 'None', '인구 밀도 (1km 격자)': 'Population density (1 km grid)', '시군구 인구 (합계)': 'County population (total)',
  '읍면동 인구 밀도 (노선 놓을 곳 찾기)': 'Neighbourhood density (where to build)', '읍면동 인구 변화 (시작 대비)': 'Neighbourhood population change',
  '읍면동 대중교통 접근 (분)': 'Neighbourhood transit access (min)', '인구 변화 (시작 대비)': 'Population change', '인간개발지수 (HDI)': 'Human Development Index (HDI)',
  '1인당 소득 (PPP $)': 'Income per capita (PPP $)', '주민 행복도': 'Resident happiness', '접근성 (상대)': 'Accessibility (relative)',
  '정당 지도 (시군구청장)': 'Party map (mayors)', '정당 지도 (광역단체장)': 'Party map (governors)',
  '득표율 지도 (시군구청장, 국민의힘)': 'Vote share (mayors, PPP)', '득표율 지도 (광역단체장, 국민의힘)': 'Vote share (governors, PPP)',
  '지자체장 지지율 (시군구청장)': 'Mayor approval', '읍면동 주민 행복도': 'Neighbourhood happiness',
  '범례 더 보기': 'More legend', '범례 접기': 'Less legend', '도로 혼잡도 (V/C, 0~10)': 'Road congestion (V/C, 0–10)', '철도 혼잡도 (V/C, 0~10)': 'Rail congestion (V/C, 0–10)',
  '고속도로': 'Motorway', '일반도로': 'Road', '고속철': 'High-speed rail', '일반철도': 'Rail', '협궤': 'Narrow gauge', '도시철도 (노선색, 굵기 = 이용객)': 'Metro (line colour, width = riders)',
  '공항': 'Airport', '항공 노선 (굵기 = 여객)': 'Air route (width = passengers)', '이용 없음': 'Unused', '미개통': 'Not open', '여객선': 'Ferry', '국경 연결': 'Border link',
  '혼잡 주의 (V/C > 1.5)': 'Congested (V/C > 1.5)', '지도에 열차 위치 보기': 'Show trains on map', '(부하 큼)': '(heavy)',
  '남측 규격 철도 (개량된 북측 선로 포함)': 'Southern-standard rail (incl. upgraded northern lines)', '개량 전 북측 철도 (직류 3kV·비전철)': 'Unupgraded northern rail (3 kV DC / non-electrified)',
  // 현황 탭
  '결산 보기': 'Summary', '지역 간 통행': 'Inter-regional trips', '철도·대중교통 분담': 'Rail & transit share', '정체 도로': 'Congested roads', '남북 소득 격차': 'North–South income gap',
  '인구·소득': 'Population & income', '교통': 'Transport', '인구 이동 (지난 1년)': 'Migration (last year)', '기록': 'Log', '추이': 'Trends',
  '남': 'South', '북': 'North', '전체': 'Total', '인구': 'Population', '1인당 소득': 'Income per capita', '소득 격차': 'Income gap',
  '지역 간 통행 (일)': 'Inter-regional trips (daily)', '수단 분담 (승용차·철도·대중교통)': 'Mode share (car · rail · transit)', '남북 간 통행 (일)': 'North–South trips (daily)',
  '항공 · 국제 통행 (일)': 'Air · international (daily)', '관광 통행 (일)': 'Tourism trips (daily)', '정체 도로 (V/C>1)': 'Congested roads (V/C>1)',
  '북 → 남': 'North → South', '남 → 북': 'South → North',
  '지지율은 해마다 목표치 쪽으로 35%씩 움직입니다. 정체를 줄이고, 오래된 민원을 풀고, 예산을 남기지 않고 사업을 마치면 오릅니다.': 'Approval moves 35% of the way toward its target each year. Cut congestion, resolve old requests, spend the budget and finish projects to raise it.',
  '기본': 'Base', '도로 정체 (시작 대비)': 'Road congestion (vs. start)', '예산 불용': 'Unspent budget', '남북 HDI 개선': 'North–South HDI gains', '읍면동 체감 교통 개선': 'Felt transport improvement',
  // 건설 탭
  '역 신설 (노선 위 한 점)': 'New station (on a line)', 'IC 신설 (고속도로 위 한 점)': 'New interchange (on a motorway)', '역 골라 특급·급행 짜기': 'Plan express services', '택지지구 개발': 'Housing district',
  '노선 추천': 'Suggest a line', '미리보기': 'Preview', '첫해 (빠름)': 'First year (fast)', '5년 뒤 (읍면동 인구 이동 반영, 느림)': 'After 5 years (with migration, slow)',
  '고속도로 신설 (4차로)': 'New motorway (4 lanes)', '국도 신설 (4차로)': 'New national road (4 lanes)', '고속철도 신설': 'New high-speed rail', '광역급행철도 신설 (대심도)': 'New GTX express (deep tunnel)',
  '일반철도 신설 (복선전철)': 'New rail (double-track electric)', '도시철도 신설 (지하)': 'New metro (underground)', '해저터널 (고속철도)': 'Undersea tunnel (HSR)', '해저터널 (고속도로)': 'Undersea tunnel (motorway)', '공항 신설': 'New airport',
  '효과 미리보기': 'Preview effect', '비교에 담기 (A·B·C안)': 'Add to comparison (A/B/C)', '모두 지우기': 'Clear all', '계획 사업': 'Planned projects',
  // 설정
  '도움말': 'Help', '처음 안내 다시 보기': 'Show the tutorial again', '오류 제보하기': 'Report a bug', '저장 슬롯': 'Save slots', '새 게임': 'New game', '난이도': 'Difficulty', '데이터': 'Data',
  '파일로 내보내기': 'Export to file', '파일 불러오기': 'Import file', '공유 링크 복사': 'Copy share link', '이 설정으로 새로 시작': 'Start a new game',
  '저장': 'Save', '불러오기': 'Load', '비어 있음': 'empty', '언어': 'Language',
  // 결산·목표
  '이미지로 저장 (SNS 공유용)': 'Save as image (for sharing)', '저장했습니다': 'Saved', '저장하는 중…': 'Saving…',
  '철도·대중교통 분담 ': 'Rail & transit share', '북측 주민 행복도': 'Northern happiness', '남측 주민 행복도': 'Southern happiness', '주요 구간 소요 시간 (가장 빠른 수단)': 'Key journey times (fastest mode)',
  // 해마다 사건 (본문은 events.js가 고른다)
  '해외 도시': 'Foreign city', '섬': 'Island',
  // 시작 창: 행정구역 정리
  '목표': 'Goal', '개성 지역 (개성시·개풍·판문·장풍)': 'Kaesong area (Kaesong, Kaepung, Panmun, Changpung)', '선전용 지명 (김정숙군·김책시 등)': 'Propaganda place names (Kimjongsuk, Kimchaek…)',
  '노동자구': "Workers' districts", '옹진군 (인천·황해남도)': 'Ongjin county (Incheon / S. Hwanghae)', '고성군 (강원 남·북)': 'Goseong county (South / North Gangwon)',
  '북측 지명 두음법칙': 'Initial-sound rule for northern names', '북측 도 체계': 'Northern provinces', '자강도·량강도 (1945년 이전 도 복원 때)': 'Chagang / Ryanggang (if pre-1945 provinces)',
  '장단군 (1972년 파주·연천에 편입, 북측은 장풍·판문)': 'Jangdan county (absorbed into Paju/Yeoncheon 1972; North: Changpung/Panmun)',
  '김화군 (1963년 남측은 철원군에 편입)': 'Gimhwa county (southern part absorbed into Cheorwon 1963)', '철원군 (강원 남·북, 연천 신서면은 옛 철원)': 'Cheorwon county (South / North; Sinseo-myeon was Cheorwon)',
  '연천군 (북측 철원·장풍에 옛 연천 땅)': 'Yeoncheon county (old Yeoncheon land in northern Cheorwon/Changpung)', '연백군 (북측 연안군·배천군으로 나뉨)': 'Yeonbaek county (split into Yonan / Paechon)',
  '인제군 (옛 서화면 북쪽이 북측 금강군에)': 'Inje county (northern Seohwa now in Kumgang)',
  '개성특급시로 둔다': 'Keep as Kaesong special city', '경기도에 편입': 'Merge into Gyeonggi', '그대로 둔다': 'Keep as is', '옛 이름으로 되돌린다': 'Restore old names',
  '폐지 (리로 바꾼다)': 'Abolish (back to villages)', '남북 따로 둔다': 'Keep separate', '하나로 합쳐 황해(남)도에': 'Merge into one in S. Hwanghae', '하나로 합쳐 인천광역시에': 'Merge into one in Incheon',
  '남측 고성군을 간성군으로': 'Rename southern Goseong to Ganseong', '하나로 합쳐 남측 강원에': 'Merge into southern Gangwon', '하나로 합쳐 북측 강원에': 'Merge into northern Gangwon',
  '평안북도·함경남도로 합친다': 'Merge into N. Pyongan / S. Hamgyong', '도로 남겨 둔다': 'Keep as provinces', '북측 표기 그대로 (량강도·룡천)': 'Keep northern spelling (Ryanggang, Ryongchon)',
  '남측 표기로 (양강도·용천)': 'Southern spelling (Yanggang, Yongcheon)', '지금 북측 도 그대로 (자강·량강·평양 등)': 'Keep current northern provinces',
  '1945년 이전 도로 되돌린다 (강원북도·강원남도, 개성은 경기도)': 'Restore pre-1945 provinces', '지금대로 둔다': 'Keep as is',
  '장단군을 되살려 경기도에': 'Restore Jangdan in Gyeonggi', '장단군을 되살려 개성시에': 'Restore Jangdan in Kaesong', '김화군을 되살려 남측 강원에': 'Restore Gimhwa in southern Gangwon',
  '김화군을 되살려 북측 강원에': 'Restore Gimhwa in northern Gangwon', '분단 전 경계로 합쳐 남측 강원에': 'Reunite on old borders in southern Gangwon', '분단 전 경계로 합쳐 북측 강원에': 'Reunite on old borders in northern Gangwon',
  '분단 전 경계로 되찾는다': 'Restore pre-division borders', '연안군·배천군으로 둔다': 'Keep Yonan / Paechon', '연백군으로 합친다': 'Merge back into Yeonbaek',
  '모두 기본값으로': 'Reset to defaults',
  // 목표
  '목표 없이 자유롭게': 'No goal (sandbox)', '서울–평양 90분 (철도·도로로)': 'Seoul–Pyongyang in 90 min (by rail or road)', '남북 소득 격차 10배 이하, 빚 없이': 'Income gap under 10× with no debt',
  '정체 도로 절반으로': 'Halve congested roads', '철도·대중교통 분담 50%': '50% rail & transit share', '북측 주민 행복도 70': 'Northern happiness 70',
};

/** 숫자·단위: 이것만 바꿔 한글이 남지 않으면 쓴다 */
const won = (n) => { const v = Number(String(n).replace(/,/g, '')); return v >= 10000 ? `₩${(v / 10000).toFixed(1)}T` : `₩${(v / 10).toLocaleString('en', { maximumFractionDigits: 1 })}B`; };
const TOKENS = [
  [/(\d{4})년 현황/g, '$1 overview'], [/(\d{4})년/g, '$1'], [/(\d+)년/g, '$1 yr'],
  [/([\d.]+)조/g, (m, a) => `₩${a}T`], [/([\d,.]+)억(원)?/g, (m, a) => won(a)],
  [/([\d.,]+)백만/g, '$1M'], [/([\d,.]+)천/g, '$1K'], [/([\d.]+)배/g, '$1×'], [/([\d,]+)명/g, '$1'], [/([\d,]+)곳/g, '$1'],
  [/(\d+)분/g, '$1 min'], [/(\d+)시간/g, '$1 h'], [/ · /g, ' · '],
  [/ 통행/g, ' trips'], [/× 격차/g, '× gap'], [/입국 /g, 'inbound '], [/출국 /g, 'outbound '],
];
const HANGUL = /[가-힣]/;

export function tr(s) {
  if (LANG !== 'en' || !s || !HANGUL.test(s)) return s;
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const core = m[2];
  if (EXACT[core]) return m[1] + EXACT[core] + m[3];
  let out = core;
  for (const [re, rep] of TOKENS) out = out.replace(re, rep);
  return HANGUL.test(out) ? s : m[1] + out + m[3];
}

/** 코드에서 고르는 글: 영어판이면 en, 아니면 ko */
export const t = (ko, en) => (LANG === 'en' && en != null ? en : ko);

function walk(root) {
  if (root.nodeType === 3) { const v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; return; }
  if (root.nodeType !== 1 || root.closest?.('.maplibregl-canvas-container')) return;
  for (const a of ['title', 'placeholder', 'aria-label']) {
    const v = root.getAttribute?.(a);
    if (v && HANGUL.test(v)) { const n = tr(v); if (n !== v) root.setAttribute(a, n); }
  }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
    else for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = n.getAttribute(a);
      if (v && HANGUL.test(v)) { const x = tr(v); if (x !== v) n.setAttribute(a, x); }
    }
  }
}

/** 영어판이면 지금 화면을 바꾸고, 뒤로 그려지는 것도 바꾼다 */
export function startI18n() {
  if (LANG !== 'en') return;
  document.documentElement.lang = 'en';
  document.title = 'Unified Korea Transport';
  walk(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') { const v = tr(m.target.nodeValue); if (v !== m.target.nodeValue) m.target.nodeValue = v; continue; }
      for (const n of m.addedNodes) walk(n);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

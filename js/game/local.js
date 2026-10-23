// 지방자치: 행정구역(현행 / 1945년 이전 13도 + 독립 광역시), 4년마다 지방선거, 단체장의 SOC 제안.
// 정당 성향은 2022년 지방선거 시도별 결과를 단순화한 게임용 가정값이다. 두 정당에 같은 규칙을 쓴다.

export const PARTIES = {
  D: { name: '더불어민주당', short: '민주당', color: '#1f5fd1' },
  P: { name: '국민의힘', short: '국민의힘', color: '#e0383e' },
};

/** 시도별 국민의힘 양당 득표율 어림 (2022 지방선거 광역단체장 기준 단순화). 북측은 반반에서 시작 */
const LEAN_P = {
  서울특별시: 0.59, 부산광역시: 0.67, 대구광역시: 0.79, 인천광역시: 0.52, 광주광역시: 0.16, 대전광역시: 0.51,
  울산광역시: 0.60, 세종특별자치시: 0.53, 전남광주통합특별시: 0.18, 경기도: 0.49, 강원특별자치도: 0.54, 강원도: 0.54, 충청북도: 0.58, 충청남도: 0.54,
  전북특별자치도: 0.17, 전라북도: 0.17, 전라남도: 0.20, 경상북도: 0.78, 경상남도: 0.66, 제주특별자치도: 0.42,
};

/**
 * 1945년 이전 행정구역 복원은 북측에만 한다 (북측의 신설 도·직할시를 옛 도로).
 * 강원도는 남북으로 나뉜 채로 강원북도(북측)·강원남도(남측)로 부른다. 개성은 옛 경기도로 돌아간다.
 */
const HISTORIC = {
  황해남도: '황해도', 황해북도: '황해도',
  평안남도: '평안남도', 평양시: '평안남도', 남포시: '평안남도', 평안북도: '평안북도', 자강도: '평안북도',
  함경남도: '함경남도', 량강도: '함경남도', 함경북도: '함경북도', 라선시: '함경북도',
  강원도: '강원북도', 개성시: '경기도',
};
/** 복원 뒤 남측 강원은 강원남도로 부른다 */
const HISTORIC_KR = { 강원특별자치도: '강원남도', 강원도: '강원남도' };

/** 복원 뒤 다시 독립시킬 수 있는 북측 도시 (원래 직할시) */
export const HISTORIC_CITIES = ['평양시', '남포시'];
/** 현행 체제에서 광역시로 승격시킬 수 있는 인구 기준 */
export const PROMOTE_MIN_POP = 1_000_000;

export const ELECTION = { firstYear: 2030, every: 4 };
export const EVENT_COST = { historic: 5000, autonomy: 2000, independence: 1000 };   // 억원 (표지판·행정 전산·청사)

export function initLocal(state) {
  state.local ||= { autonomyKP: false, historic: false, independent: [], offices: {}, proposals: [], elections: [] };
  return state.local;
}

/** 존이 속한 광역 단체 이름 */
export function regionOf(state, z) {
  const L = initLocal(state);
  const prov = z.province || z.name;
  // 독립(승격)한 도시는 그 자체가 광역 단체
  for (const c of L.independent) if (prov === c || z.city === c || z.name === c) return c;
  if (L.historic) return (z.country === 'KP' ? HISTORIC[prov] : HISTORIC_KR[prov]) || prov;
  return prov;
}

export function isMetroCity(name) { return /(특별시|광역시|직할시|특별자치시)$/.test(name) || ['평양시', '남포시', '라선시', '개성시'].includes(name); }

export function governorTitle(region) {
  if (isMetroCity(region) || /광역시$/.test(region)) return `${region.replace(/(특별시|광역시|특별자치시)$/, '')}시장`;
  return `${region.replace(/(특별자치도|도)$/, '')}도지사`;
}

export function mayorTitle(name) {
  if (/구역$/.test(name)) return `${name}장`;
  if (/구$/.test(name)) return `${name}청장`;
  if (/군$/.test(name)) return `${name}수`;
  return `${name}장`;
}

/** 이 존(시군구)에 지방자치가 시행 중인지: 남측은 처음부터, 북측은 도입 이벤트 뒤 */
export function hasAutonomy(state, z) {
  return z.country === 'KR' || initLocal(state).autonomyKP;
}

/** 같은 입력이면 같은 값 (지역마다 고정된 성향 차이) */
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/** 시군구의 기본 국민의힘 성향 */
export function leanP(z) {
  const base = LEAN_P[z.province] ?? 0.5;
  return Math.min(0.92, Math.max(0.08, base + (hash01(z.name + z.province) - 0.5) * 0.14));
}

/** 선거 한 번: 현직 정당의 득표에 지지율(50 기준)과 실적을 반영. rnd: 0~1 난수 함수 */
/** mood: 이번 선거의 전국 바람 (국민의힘 쪽 +, 모든 지역에 같이 붙는다) */
export function runElection(lean, office, rnd, mood = 0) {
  let p = lean + mood;
  if (office) {
    const swing = ((office.approval - 50) / 50) * 0.12 + Math.min(0.06, (office.delivered || 0) * 0.015);
    p += office.party === 'P' ? swing : -swing;
  }
  p += (rnd() - 0.5) * 0.08;
  p = Math.min(0.97, Math.max(0.03, p));
  return { party: p >= 0.5 ? 'P' : 'D', share: p >= 0.5 ? p : 1 - p };
}

/** 단체장 지지율 변화: 받아들인 제안 +3, 완공 +6, 거절 -4 (0~100) */
export function bumpApproval(office, d) {
  office.approval = Math.max(0, Math.min(100, office.approval + d));
}

export { HISTORIC };

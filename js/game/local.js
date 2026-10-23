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
export const EVENT_COST = { historic: 5000, autonomy: 2000, independence: 1000, admin: 3000 };   // 억원 (표지판·행정 전산·청사)

/**
 * 남북 행정구역 정리: 게임을 시작할 때 고르고, 진행 중에는 이벤트(비용·선거)로 바꾼다.
 * 계산용 존은 그대로 두고 소속 광역 단체와 이름만 바꾼다 (합친 군은 같은 이름·같은 단체로 묶인다).
 */
export const ADMIN_OPTIONS = [
  { key: 'kaesong', label: '개성 지역 (개성시·개풍·판문·장풍)', choices: [['keep', '개성특급시로 둔다'], ['gyeonggi', '경기도에 편입']] },
  { key: 'propaganda', label: '선전용 지명 (김정숙군·김책시 등)', choices: [['keep', '그대로 둔다'], ['restore', '옛 이름으로 되돌린다']] },
  { key: 'workers', label: '노동자구', choices: [['keep', '그대로 둔다'], ['abolish', '폐지 (리로 바꾼다)']] },
  { key: 'ongjin', label: '옹진군 (인천·황해남도)', choices: [['separate', '남북 따로 둔다'], ['hwanghae', '하나로 합쳐 황해(남)도에'], ['incheon', '하나로 합쳐 인천광역시에']] },
  { key: 'goseong', label: '고성군 (강원 남·북)', choices: [['separate', '남북 따로 둔다'], ['ganseong', '남측 고성군을 간성군으로'], ['south', '하나로 합쳐 남측 강원에'], ['north', '하나로 합쳐 북측 강원에']] },
  { key: 'cheorwon', label: '철원군 (강원 남·북)', choices: [['separate', '남북 따로 둔다'], ['south', '하나로 합쳐 남측 강원에'], ['north', '하나로 합쳐 북측 강원에']] },
  { key: 'jagang', label: '자강도·량강도 (1945년 이전 도 복원 때)', choices: [['merge', '평안북도·함경남도로 합친다'], ['keep', '도로 남겨 둔다']] },
  { key: 'dueum', label: '북측 지명 두음법칙', choices: [['keep', '북측 표기 그대로 (량강도·룡천)'], ['apply', '남측 표기로 (양강도·용천)']] },
];

/** 두음법칙: 첫 음절의 ㄹ·ㄴ을 남측 표기로 (량강→양강, 룡천→용천, 락원→낙원, 녕변→영변) */
export function dueum(name) {
  if (!name) return name;
  const c = name.charCodeAt(0) - 0xac00;
  if (c < 0 || c >= 11172) return name;
  const L = Math.floor(c / 588), V = Math.floor((c % 588) / 28), T = c % 28;
  const iy = [2, 6, 7, 12, 17, 20].includes(V);   // ㅑ ㅕ ㅖ ㅛ ㅠ ㅣ
  let nl = L;
  if (L === 5) nl = iy ? 11 : 2;                    // ㄹ → ㅇ / ㄴ
  else if (L === 2 && iy && V !== 2) nl = 11;       // ㄴ → ㅇ (녀·뇨·뉴·니)
  if (nl === L) return name;
  return String.fromCharCode(0xac00 + nl * 588 + V * 28 + T) + name.slice(1);
}
export const ADMIN_DEFAULT = Object.fromEntries(ADMIN_OPTIONS.map((o) => [o.key, o.choices[0][0]]));

const KR_GANGWON = ['강원특별자치도', '강원도'];
const isZone = (z, name, country, provs) => z.name === name && z.country === country && provs.includes(z.province);

/** 행정구역 정리로 바뀐 소속: {province, side} (side는 도 이름 규칙을 따를 쪽: 'KR' | 'KP') 또는 null */
export function adminOverride(state, z) {
  const A = state.local?.admin;
  if (!A || z.ext) return null;
  if (A.kaesong === 'gyeonggi' && z.country === 'KP' && z.province === '개성시') return { province: '경기도', side: 'KR' };
  if (z.name === '옹진군') {
    if (A.ongjin === 'hwanghae' && z.country === 'KR') return { province: '황해남도', side: 'KP' };
    if (A.ongjin === 'incheon' && z.country === 'KP') return { province: '인천광역시', side: 'KR' };
  }
  for (const key of ['goseong', 'cheorwon']) {
    const name = key === 'goseong' ? '고성군' : '철원군';
    if (A[key] === 'south' && isZone(z, name, 'KP', ['강원도'])) return { province: '강원특별자치도', side: 'KR' };
    if (A[key] === 'north' && isZone(z, name, 'KR', KR_GANGWON)) return { province: '강원도', side: 'KP' };
  }
  return null;
}

/** 행정구역 정리로 바뀌는 시군 이름 (존 번호 → 새 이름). 선전용 지명은 targets(data/historic_targets.json)에서 */
export function adminNames(admin, zones, targets = []) {
  const out = {};
  if (admin.dueum === 'apply') zones.forEach((z, i) => { if (z.country === 'KP' && !z.ext && dueum(z.name) !== z.name) out[`z:${i}`] = dueum(z.name); });
  if (admin.goseong === 'ganseong') zones.forEach((z, i) => { if (isZone(z, '고성군', 'KR', KR_GANGWON)) out[`z:${i}`] = '간성군'; });
  if (admin.propaganda === 'restore') for (const t of targets) out[`${t.level === 'zone' ? 'z' : 'u'}:${t.id}`] = t.historic;
  return out;
}

export function initLocal(state) {
  state.local ||= { autonomyKP: false, historic: false, independent: [], offices: {}, proposals: [], elections: [] };
  return state.local;
}

/** 존이 속한 광역 단체 이름 */
export function regionOf(state, z) {
  const L = initLocal(state);
  const o = adminOverride(state, z);
  const prov = o?.province || z.province || z.name, side = o?.side || z.country;
  // 독립(승격)한 도시는 그 자체가 광역 단체
  for (const c of L.independent) if (prov === c || z.city === c || z.name === c) return c;
  const A = L.admin || {};
  let r = prov;
  if (L.historic && !(A.jagang === 'keep' && side === 'KP' && ['자강도', '량강도', '양강도'].includes(prov))) {
    r = (side === 'KP' ? HISTORIC[prov] : HISTORIC_KR[prov]) || prov;
  }
  return A.dueum === 'apply' && side === 'KP' ? dueum(r) : r;
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

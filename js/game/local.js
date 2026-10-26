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
/** 광역시로 승격시킬 수 있는 인구 기준 (모든 도의 시, 북측은 지방자치 도입 뒤) */
export const PROMOTE_MIN_POP = 500_000;

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
/**
 * 분단으로 갈라지거나 없어진 군 되살리기. 존의 hist는 1945년 소속 군, piece는 지금 시군 안에서 떼어 낸 옛 군 땅
 * (pipeline/build_admin.py tag_historic, 조사 자료 pipeline/historic_counties.json). '지금대로'면 조각은 원래 시군 이름으로 보이고,
 * 되살리면 같은 옛 군의 존들이 그 군 이름으로 한 도에 묶인다 (계산 존은 그대로, 이름·소속만 바뀐다).
 * prov: 고른 값 → [도, 도 이름 규칙을 따를 쪽]
 */
const KR_GW = ['강원특별자치도', 'KR'], KP_GW = ['강원도', 'KP'];
export const HISTORIC_COUNTIES = [
  { key: 'jangdan', name: '장단군', label: '장단군 (1972년 파주·연천에 편입, 북측은 장풍·판문)',
    choices: [['keep', '지금대로 둔다'], ['south', '장단군을 되살려 경기도에'], ['north', '장단군을 되살려 개성시에']], prov: { south: ['경기도', 'KR'], north: ['개성시', 'KP'] } },
  { key: 'gimhwa', name: '김화군', label: '김화군 (1963년 남측은 철원군에 편입)',
    choices: [['keep', '지금대로 둔다'], ['south', '김화군을 되살려 남측 강원에'], ['north', '김화군을 되살려 북측 강원에']], prov: { south: KR_GW, north: KP_GW } },
  { key: 'cheorwon', name: '철원군', label: '철원군 (강원 남·북, 연천 신서면은 옛 철원)',
    choices: [['keep', '남북 따로 둔다'], ['south', '분단 전 경계로 합쳐 남측 강원에'], ['north', '분단 전 경계로 합쳐 북측 강원에']], prov: { south: KR_GW, north: KP_GW } },
  { key: 'yeoncheon', name: '연천군', label: '연천군 (북측 철원·장풍에 옛 연천 땅)',
    choices: [['keep', '지금대로 둔다'], ['restore', '분단 전 경계로 되찾는다']], prov: { restore: ['경기도', 'KR'] } },
  { key: 'yeonbaek', name: '연백군', label: '연백군 (북측 연안군·배천군으로 나뉨)',
    choices: [['keep', '연안군·배천군으로 둔다'], ['restore', '연백군으로 합친다']], prov: { restore: ['황해남도', 'KP'] } },
  { key: 'inje', name: '인제군', label: '인제군 (옛 서화면 북쪽이 북측 금강군에)',
    choices: [['keep', '지금대로 둔다'], ['restore', '분단 전 경계로 되찾는다']], prov: { restore: KR_GW } },
];
const HIST_BY_NAME = Object.fromEntries(HISTORIC_COUNTIES.map((h) => [h.name, h]));
ADMIN_OPTIONS.push(...HISTORIC_COUNTIES.map(({ key, label, choices }) => ({ key, label, choices })));

/** 이 존을 되살린 옛 군: {name, province, side} 또는 null. 예전 저장의 철원 'separate'는 '지금대로' */
export function restoredCounty(state, z) {
  const h = z.hist && HIST_BY_NAME[z.hist];
  const v = h && state.local?.admin?.[h.key];
  const pr = v && h.prov[v];
  return pr ? { name: h.name, province: pr[0], side: pr[1] } : null;
}

export const ADMIN_DEFAULT = Object.fromEntries(ADMIN_OPTIONS.map((o) => [o.key, o.choices[0][0]]));

const KR_GANGWON = ['강원특별자치도', '강원도'];
const isZone = (z, name, country, provs) => z.name === name && z.country === country && provs.includes(z.province);

/** 행정구역 정리로 바뀐 소속: {province, side} (side는 도 이름 규칙을 따를 쪽: 'KR' | 'KP') 또는 null */
export function adminOverride(state, z) {
  const A = state.local?.admin;
  if (!A || z.ext) return null;
  const h = restoredCounty(state, z);
  if (h) return { province: h.province, side: h.side };
  if (A.kaesong === 'gyeonggi' && z.country === 'KP' && z.province === '개성시') return { province: '경기도', side: 'KR' };
  if (z.name === '옹진군') {
    if (A.ongjin === 'hwanghae' && z.country === 'KR') return { province: '황해남도', side: 'KP' };
    if (A.ongjin === 'incheon' && z.country === 'KP') return { province: '인천광역시', side: 'KR' };
  }
  if (A.goseong === 'south' && isZone(z, '고성군', 'KP', ['강원도'])) return { province: '강원특별자치도', side: 'KR' };
  if (A.goseong === 'north' && isZone(z, '고성군', 'KR', KR_GANGWON)) return { province: '강원도', side: 'KP' };
  return null;
}

// 선전용 지명의 지명 부분 (data/historic_names.json): 역 이름·새 역 이름 후보에도 옛 이름을 쓴다
export const PROPAGANDA_STEMS = [['김정숙', '신파'], ['김형직', '후창'], ['김형권', '풍산'], ['김책', '성진'], ['금야', '영흥'], ['선봉', '웅기'], ['은덕', '경흥'], ['새별', '경원']];

/**
 * 북측 지명(역 이름 등)에 행정구역 정리를 적용한다: 선전용 지명 되돌리기(pairs), 노동자구 폐지, 두음법칙.
 * station이면 역 이름 끝의 '청년'(청년동맹이 지었다며 덧붙인 이름: 사리원청년역 → 사리원역)도 뗀다
 */
export function kpPlaceText(admin, name, pairs, station = false) {
  if (!name) return name;
  let out = name;
  for (const [a, b] of pairs || []) out = out.replace(a, b);
  if (station && admin?.propaganda === 'restore' && out.length >= 3 && out.endsWith('청년')) out = out.slice(0, -2);
  if (admin?.workers === 'abolish') out = out.replace(/[노로]동자구$/, '리');
  if (admin?.dueum === 'apply') out = dueum(out);
  return out;
}

/** 행정구역 정리로 바뀌는 시군 이름 (존 번호 → 새 이름). 선전용 지명은 targets(data/historic_targets.json)에서 */
export function adminNames(admin, zones, targets = []) {
  const out = {};
  if (admin.dueum === 'apply') zones.forEach((z, i) => { if (z.country === 'KP' && !z.ext && dueum(z.name) !== z.name) out[`z:${i}`] = dueum(z.name); });
  if (admin.goseong === 'ganseong') zones.forEach((z, i) => { if (isZone(z, '고성군', 'KR', KR_GANGWON)) out[`z:${i}`] = '간성군'; });
  if (admin.propaganda === 'restore') for (const t of targets) out[`${t.level === 'zone' ? 'z' : 'u'}:${t.id}`] = t.historic;
  // 되살린 옛 군: 그 군에 속했던 존(떼어 낸 조각 포함)을 모두 그 군 이름으로
  zones.forEach((z, i) => { const h = z.hist && HIST_BY_NAME[z.hist]; if (h && admin[h.key] && h.prov[admin[h.key]]) out[`z:${i}`] = h.name; });
  return out;
}

export function initLocal(state) {
  state.local ||= { autonomyKP: false, historic: false, independent: [], offices: {}, proposals: [], elections: [] };
  if (state.local.admin?.cheorwon === 'separate') state.local.admin.cheorwon = 'keep';   // 예전 저장 (철원 '남북 따로')
  return state.local;
}

/** 존이 속한 광역 단체 이름 */
export function regionOf(state, z) {
  const L = initLocal(state);
  const o = adminOverride(state, z);
  const prov = o?.province || z.province || z.name, side = o?.side || z.country;
  // 독립(승격)한 도시는 그 자체가 광역 단체 (함흥시 → 함흥광역시)
  for (const c of L.independent) if (prov === c || z.city === c || z.name === c) return metroName(c);
  const A = L.admin || {};
  let r = prov;
  if (L.historic && !(A.jagang === 'keep' && side === 'KP' && ['자강도', '량강도', '양강도'].includes(prov))) {
    r = (side === 'KP' ? HISTORIC[prov] : HISTORIC_KR[prov]) || prov;
  }
  return A.dueum === 'apply' && side === 'KP' ? dueum(r) : r;
}

/** 승격한 도시의 광역 단체 이름: 옛 직할시(평양·남포)는 그대로, 나머지 시는 ○○광역시 */
export function metroName(c) { return isMetroCity(c) ? c : c.replace(/시$/, '광역시'); }

export function isMetroCity(name) { return /(특별시|광역시|직할시|특별자치시)$/.test(name) || ['평양시', '남포시', '라선시', '개성시'].includes(name); }

export function governorTitle(region) {
  // 특별시·광역시·특별자치시장은 단체 이름 그대로 (함흥광역시장), 옛 직할시는 ○○시장
  if (isMetroCity(region)) return `${region}장`;
  return `${region.replace(/(특별자치도|도)$/, '')}도지사`;
}

/** 시군 단체장 직함. 광역시로 승격한 도시 전체가 한 시군(존)이면 따로 뽑는 기초단체장이 없다
 *  (청진시 → 청진광역시: 그 땅의 단체장은 청진광역시장뿐, "청진광역시 구청장"은 없는 직책): null */
export function countyTitle(name, region) {
  if (/광역시$/.test(region) && name.replace(/시$/, '') === region.replace(/광역시$/, '')) return null;
  return mayorTitle(name);
}

export function mayorTitle(name) {
  if (/구역$/.test(name)) return `${name}장`;
  if (/구$/.test(name)) return `${name}청장`;
  if (/군$/.test(name)) return `${name}수`;
  return `${name}장`;
}

/** 이 존(시군구)에 지방자치가 시행 중인지: 남측은 처음부터, 북측은 도입 이벤트 뒤.
 *  남북은 지금 소속 광역 단체 쪽으로 가른다: 북측 도로 옮긴 남측 군(장단 → 개성시, 옹진 → 황해남도)은 북측과 같이,
 *  남측 도로 옮긴 북측 군(개성 → 경기도)은 남측과 같이 */
export function hasAutonomy(state, z) {
  const side = adminOverride(state, z)?.side || z.country;
  return side === 'KR' || initLocal(state).autonomyKP;
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

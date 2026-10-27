// 사업 종류와 단가. 금액 단위는 억원.
// 단가는 예타 보고서들에서 본 대략적인 규모를 게임용으로 단순화한 값이다 (docs/model.md).

export const KP_COST_FACTOR = 1.15; // 북한 지역: 기반 열악, 자재 운송 등

export const DIFFICULTY = {
  easy: { label: '쉬움', annualBudget: 500000, interest: 0.02, autoApprove: true, borrowLimit: 2000000 },
  normal: { label: '보통', annualBudget: 300000, interest: 0.03, autoApprove: false, borrowLimit: 1000000 },
  hard: { label: '어려움', annualBudget: 200000, interest: 0.045, autoApprove: false, borrowLimit: 300000 },
};

/** 기존 링크 개량. applies(link) 가 true일 때만 선택지로 보인다. */
export const UPGRADES = [
  {
    id: 'pave', mode: 0, label: '포장·보수', perKm: 20, years: 1,
    applies: (l) => !l.paved,
    apply: (l) => ({ paved: 1, speed: Math.round(l.speed / 0.6) }),
  },
  {
    id: 'realign', mode: 0, label: '선형 개량', perKm: 60, years: 2,
    applies: (l) => l.cls !== 'motorway' && l.speed < roadMaxSpeed(l.cls),
    apply: (l) => ({ speed: Math.min(l.speed + 15, roadMaxSpeed(l.cls)) }),
  },
  {
    id: 'widen', mode: 0, label: '차로 확장 (+2)', years: 3,
    perKm: (l) => (l.cls === 'motorway' ? 200 : 120),
    applies: (l) => l.lanes < 10,
    apply: (l) => ({ lanes: l.lanes + 2 }),
  },
  {
    id: 'tomotorway', mode: 0, label: '고속도로 격상 (4차로)', perKm: 300, years: 4,
    applies: (l) => l.cls !== 'motorway',
    apply: (l) => ({ cls: 'motorway', lanes: Math.max(4, l.lanes), speed: 95, paved: 1 }),
  },
  {
    id: 'railimprove', mode: 1, label: '선형개량·노반 보강', perKm: 70, years: 3,
    applies: (l) => l.cls === 'conv' && l.speed < 150,
    apply: (l) => ({ speed: Math.min(Math.max(Math.round(l.speed * 1.5), l.speed + 30), 150) }),
  },
  {
    id: 'straighten', mode: 1, label: '직선화 (곡선 구간 펴기)', perKm: 250, years: 5,
    applies: (l) => l.cls === 'conv' && !l.straight,
    apply: (l) => ({ straight: 1, len: Math.round(l.len * 0.9 * 100) / 100, speed: Math.min(200, Math.max(l.speed + 40, 160)) }),
  },
  {
    id: 'double', mode: 1, label: '복선화', perKm: 140, years: 4,
    applies: (l) => l.tracks < 2,
    apply: () => ({ tracks: 2 }),
  },
  {
    id: 'quad', mode: 1, label: '2복선화 (선로 4개)', perKm: 260, years: 5,
    applies: (l) => l.tracks >= 2 && l.tracks < 4,
    apply: () => ({ tracks: 4 }),
  },
  {
    id: 'electrify', mode: 1, years: 2,
    label: (l) => (l.power === 'DC' ? '교류 25kV 전환 (북 직류 3kV)' : '전철화 (교류 25kV)'),
    perKm: (l) => (l.power === 'DC' ? 15 : 25),
    applies: (l) => l.power !== 'AC',
    apply: () => ({ power: 'AC' }),
  },
  {
    id: 'metroexpress', mode: 2, label: '급행화 (대피선·급행 운행)', perKm: 150, years: 3,
    applies: (l) => l.speed < 50,
    apply: (l) => ({ speed: Math.min(l.speed + 12, 50) }),
  },
  {
    id: 'metrocap', mode: 2, label: '증편 (신호 개량·차량 증차)', perKm: 60, years: 2,
    applies: (l) => !(l.tracks >= 3),
    apply: () => ({ tracks: 3 }),
  },
  {
    id: 'speedup', mode: 1, label: '고속화 (200km/h급)', perKm: 400, years: 5,
    applies: (l) => l.cls === 'conv' && l.speed < 200,
    apply: (l) => ({ speed: 200, tracks: Math.max(2, l.tracks), power: 'AC' }),
  },
  // 북측 철도를 한 번에 남측 규격으로: 선형·노반 보강 + 복선 + 교류 25kV + 표준궤 (따로 하는 개량들의 합)
  {
    id: 'kpstd', mode: 1, label: '남측 규격 일괄 개량 (복선·교류 25kV·120km/h·표준궤)', years: 5,
    perKm: (l) => 70 + (l.tracks < 2 ? 140 : 0) + (l.power === 'AC' ? 0 : l.power === 'DC' ? 15 : 25),
    applies: (l) => !!l.kp && !l.sstd && l.cls === 'conv' && (l.speed < 120 || l.tracks < 2 || l.power !== 'AC' || !l.std),
    apply: (l) => ({ speed: Math.max(l.speed, 120), tracks: Math.max(2, l.tracks), power: 'AC' }),
  },
  // 고속도로 재건축: 북측 고속도로(시속 60km급)는 남측 규격으로, 남측의 2차로 고속도로는 4차로로 다시 짓는다
  {
    id: 'mwrebuild', mode: 0, years: 4,
    label: (l) => (l.kp ? '남측 규격 고속도로로 재건축 (4차로 이상·95km/h)' : '고속도로 재건축 (4차로 이상·95km/h)'),
    perKm: (l) => (l.lanes < 4 ? 300 : 220),
    applies: (l) => l.cls === 'motorway' && (l.speed < 95 || l.lanes < 4 || !l.paved),
    apply: (l) => ({ speed: Math.max(l.speed, 95), lanes: Math.max(4, l.lanes), paved: 1 }),
  },
  // 폐도·폐선: 완공되면 구간을 걷어 낸다 (지도와 계산에서 빠지고, 선로가 다 없어진 역은 닫힌다)
  ...[[0, '폐도 (도로 철거)'], [1, '폐선 (선로 철거)'], [2, '폐선 (도시철도 운행 중단·철거)']].map(([mode, label]) => ({
    id: `retire${mode}`, mode, label, perKm: 5, years: 1, retire: true,
    applies: () => true,
    apply: () => ({}),
  })),
];

/** 신설 사업 */
export const NEW_BUILDS = {
  motorway: { mode: 0, label: '고속도로 신설 (4차로)', perKm: 450, years: 5, attrs: { cls: 'motorway', lanes: 4, speed: 100, paved: 1 } },
  trunk: { mode: 0, label: '국도 신설 (4차로)', perKm: 180, years: 3, attrs: { cls: 'trunk', lanes: 4, speed: 70, paved: 1 } },
  hsr: { mode: 1, label: '고속철도 신설', perKm: 850, years: 6, attrs: { cls: 'hsr', tracks: 2, speed: 250, power: 'AC' } },
  gtx: { mode: 1, label: '광역급행철도 신설 (대심도)', perKm: 1100, years: 6, attrs: { cls: 'conv', tracks: 2, speed: 120, power: 'AC' } },   // 최고 180km/h, 역마다 서고 가감속하므로 평균(표정) 속도로
  rail: { mode: 1, label: '일반철도 신설 (복선전철)', perKm: 400, years: 5, attrs: { cls: 'conv', tracks: 2, speed: 150, power: 'AC' } },
  // 단선 비전철: 싸고 빨리 짓지만 열차를 많이 못 다니고 느리다. 나중에 구간을 눌러 복선화·전철화할 수 있다
  rail1: { mode: 1, label: '일반철도 신설 (단선 비전철)', perKm: 200, years: 4, attrs: { cls: 'conv', tracks: 1, speed: 120, power: 'none' } },
  metro: { mode: 2, label: '도시철도 신설 (지하)', perKm: 1300, years: 6, attrs: { cls: 'metro', tracks: 2, speed: 35, power: 'AC' } },
  // 경전철·트램: 지상·고가라 지하철의 3분의 1 값이지만 느리고(표정 25km/h) 수송력이 작다
  lrt: { mode: 2, label: '경전철·트램 신설 (지상·고가)', perKm: 450, years: 5, attrs: { cls: 'metro', tracks: 2, speed: 25, power: 'AC' } },
  // 지하 경전철 (난곡선·서남선·하단녹산선 등): 지하라 비싸지만 중전철보다 정거장·차량이 작다 (실제 사업비 900~1,100억/km)
  lrtug: { mode: 2, label: '경전철 신설 (지하)', perKm: 900, years: 6, attrs: { cls: 'metro', tracks: 2, speed: 32, power: 'AC' } },
  tunnelRail: { mode: 1, label: '해저터널 (고속철도)', perKm: 3500, years: 10, attrs: { cls: 'hsr', tracks: 2, speed: 250, power: 'AC' } },
  tunnelRoad: { mode: 0, label: '해저터널 (고속도로)', perKm: 2500, years: 10, attrs: { cls: 'motorway', lanes: 4, speed: 90, paved: 1 } },
};

/** 공항 사업 (사업비 억원, 용량 연간 백만 명) */
export const AIRPORT = {
  build: { label: '공항 신설', cost: 20000, years: 6, cap: 10 },
  expand: { label: '공항 확장 (+1천만 명)', cost: 8000, years: 4, cap: 10 },
};

export function roadMaxSpeed(cls) {
  return { motorway: 100, trunk: 80, primary: 70, secondary: 60 }[cls] ?? 60;
}

export function resolve(v, l) {
  return typeof v === 'function' ? v(l) : v;
}

export function upgradeCost(u, link) {
  return Math.round(resolve(u.perKm, link) * link.len * (link.kp ? KP_COST_FACTOR : 1));
}

export function formatWon(eok) {
  if (Math.abs(eok) >= 10000) return `${(eok / 10000).toFixed(1)}조`;
  return `${Math.round(eok).toLocaleString()}억`;
}

/** 개량을 적용한 속성. 철도 개량은 선로를 다시 까므로 북측 협궤(762mm)도 표준궤가 된다 (std) */
export function upgradeAttrs(u, link) {
  const a = u.apply(link);
  return u.mode === 1 ? { ...a, std: 1 } : a;
}

// 재정사업과 민자사업 (BTO·BTL). 수요 예측은 효과 미리보기(한 해 통행배정)로 하고, 민간 수익률(IRR)로 참여 여부를 정한다.
// 단가와 기준은 게임용 가정값이다.

export const PPP_TYPES = {
  gov: { label: '재정사업 (정부 예산)' },
  bto: { label: '민자 BTO (통행료·운임으로 회수)' },
  btl: { label: '민자 BTL (정부가 임대료 지급)' },
};

/** 재정 기준 통행료·운임 (원/km): 도로는 차 1대, 철도는 1인 */
export const BASE_TOLL = { road: 50, conv: 90, hsr: 150, metro: 110 };
/** 운영비 (억원/km/년) */
export const OPEX_PER_KM = { road: 3, conv: 12, hsr: 20, metro: 30 };
export const DEMAND_GROWTH = 0.01;   // 해마다 수요 증가 (예측용)

export const PPP_DEFAULTS = { years: 30, target: 0.06, tollMult: 1.3, subsidy: 0.3, mrg: 0 };

export function initPPP(state) {
  state.ppp ||= [];
  return state.ppp;
}

/** 노선 종류 → 요금 종류 */
export function tollKind(link) {
  if (link.mode === 0) return 'road';
  if (link.mode === 2) return 'metro';
  return link.cls === 'hsr' ? 'hsr' : 'conv';
}

/**
 * 민자로 짓는 구간에 붙이는 추가 통행료·운임 (원/km, 모형의 일반화비용에 더해져 이용을 줄인다).
 * 도로는 통행료 전부, 철도는 재정 운임보다 비싼 몫만 (재정 운임은 모형에 이미 들어 있다)
 */
export function linkToll(kind, type, tollMult) {
  if (type !== 'bto') return 0;
  return kind === 'road' ? BASE_TOLL.road * tollMult : BASE_TOLL[kind] * Math.max(0, tollMult - 1);
}

/** 한 해 영업수입 (원): 이용(대·km 또는 인·km/일) × 요금 × 365 */
export function annualRevenue(useKm, kind, tollMult) {
  return useKm * BASE_TOLL[kind] * tollMult * 365;
}

function irr(flows) {
  // 이분법 (−50% ~ 50%)
  const npv = (r) => flows.reduce((s, f, t) => s + f / (1 + r) ** t, 0);
  let lo = -0.5, hi = 0.5;
  if (npv(lo) * npv(hi) > 0) return npv(0) > 0 ? hi : lo;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * 민자 검토. cost: 총사업비(억원), years: 공기, km: 연장, kind: 요금 종류, useKm: 개통 첫해 하루 이용(대·km 또는 인·km).
 * @returns {{privateCapex, rev1, opex, irr, viable, lease, mrgFloor, mrgExpected, flows}}
 */
export function evaluatePPP({ type, years: opYears, target, tollMult, subsidy, mrg }, { cost, years, km, kind, useKm }) {
  const privateCapex = cost * (1 - subsidy);         // 억원
  const opex = OPEX_PER_KM[kind] * km;               // 억원/년
  const rev1 = annualRevenue(useKm, kind, tollMult) / 1e8;
  const flows = [];
  for (let t = 0; t < years; t++) flows.push(-privateCapex / years);
  let lease = 0;
  if (type === 'btl') {
    // 임대료: 민간 투자비를 목표 수익률로 운영 기간에 나눠 갚는 연금 + 운영비
    const a = target / (1 - (1 + target) ** -opYears);
    lease = privateCapex * a + opex;
    for (let t = 0; t < opYears; t++) flows.push(lease - opex);
  } else {
    for (let t = 0; t < opYears; t++) {
      const rev = rev1 * (1 + DEMAND_GROWTH) ** t;
      const floor = mrg > 0 ? rev1 * mrg : 0;      // 최소운영수입보장: 예측 수입의 mrg배까지 정부가 메운다
      flows.push(Math.max(rev, floor) - opex);
    }
  }
  const r = irr(flows);
  return { privateCapex, rev1, opex, irr: r, viable: type === 'btl' || r >= target, lease, mrgFloor: mrg > 0 ? rev1 * mrg : 0, flows };
}

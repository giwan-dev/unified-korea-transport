// 예비타당성조사식 사업 평가: 다 지었다고 치고 돌린 효과 미리보기(대조·처리 통행배정)로 편익을 잡는다.
// - 경제성(B/C): 통행시간 절감·차량운행비 절감·교통사고 감소 편익 ÷ 사업비 + 운영비, 30년 운영·할인율 4.5%
// - 종합평가(AHP): 경제성·정책성·지역균형발전 점수의 가중 평균, 0.5 이상이면 시행 타당
// 단가·가중치는 예타 지침의 규모를 게임용으로 단순화한 값이다 (금액 단위 억원).
import { P } from '../sim/params.js';

export const APPRAISAL = {
  rate: 0.045,            // 사회적 할인율
  years: 30,              // 운영 기간
  daysPerYear: 365,
  vocPerVehKm: 160,       // 차량운행비 (원/대·km, 화물차 포함 평균)
  accidentPerVehKm: 60,   // 교통사고 비용 (원/대·km)
  // 연 운영·유지관리비 (억원/km·년, 또는 사업비 대비 비율)
  opexPerKm: { motorway: 0.6, trunk: 0.3, primary: 0.25, secondary: 0.2, hsr: 3, conv: 2.5, metro: 25, ferry: 0 },
  opexShare: { upgrade: 0.005, mega: 0.01, station: 0.03, ic: 0.02 },
  // AHP 가중치: 수도권 사업은 지역균형 항목을 보지 않는다
  weights: { capital: { econ: 0.65, policy: 0.35, balance: 0 }, region: { econ: 0.45, policy: 0.3, balance: 0.25 } },
};

const CAPITAL = /^(서울|인천|경기)/;

// 도로 이용 비용 (원/대·km): 차량운행비는 속도가 낮을수록(막힐수록) 크고, 사고 비용은 고속도로가 일반도로보다 작다
export const ROAD_COST = {
  voc: (kmh) => 110 + 1800 / Math.max(8, kmh || 8),   // 10km/h 약 290원, 30km/h 170원, 60km/h 140원, 100km/h 128원
  accident: { motorway: 25, trunk: 55, primary: 70, secondary: 80 },
};

/**
 * 도로 구간들의 하루 차량운행비·사고 비용 (원): 구간 교통량 × 길이 × 그 속도의 운행비·그 등급의 사고 비용
 * @param {ArrayLike<number>} vol 구간 교통량 (대/일)  @param {ArrayLike<number>} speed 구간 속도 (km/h)  @param {object[]} links 망 구간
 */
export function roadUserCost(vol, speed, links) {
  let voc = 0, acc = 0;
  const n = Math.min(vol.length, links.length);
  for (let k = 0; k < n; k++) {
    const l = links[k];
    if (!l || l.mode !== 0 || !(vol[k] > 0)) continue;
    const vkm = vol[k] * l.len;
    voc += vkm * ROAD_COST.voc(speed[k] || l.speed);
    acc += vkm * (ROAD_COST.accident[l.cls] ?? 70);
  }
  return { voc, acc };
}

/** 현재가치 계수: 착공 후 years년 공사, 그 뒤 운영 기간 동안 해마다 1 */
function annuityAfter(start, n, r) {
  let s = 0;
  for (let t = start; t < start + n; t++) s += 1 / (1 + r) ** t;
  return s;
}

/**
 * @param {object} o
 * @param {{timeMin:number, dVkt:number}} o.benefit 하루 편익 (워커 미리보기)
 * @param {number} o.cost 사업비 (억원)
 * @param {number} o.years 공사 기간
 * @param {number} o.opex 연 운영·유지관리비 (억원)
 * @param {object} o.policy 정책성 항목 {plan, congB, congA, dRail, mode, border, kp, cost}
 * @param {{income:number, avgIncome:number, capital:boolean}} o.region 사업 지역
 */
export function appraise(o) {
  const A = APPRAISAL, r = A.rate, d = A.daysPerYear;
  // 연 편익 (억원): 원 → 억원
  const time = (o.benefit.timeMin * P.vot * d) / 1e8;
  // 구간별(속도·등급별) 비용 차이가 있으면 그것으로, 없으면(옛 미리보기) 주행거리 차이 × 평균 단가로
  const voc = o.benefit.vocWon != null ? (o.benefit.vocWon * d) / 1e8 : (-o.benefit.dVkt * A.vocPerVehKm * d) / 1e8;
  const acc = o.benefit.accWon != null ? (o.benefit.accWon * d) / 1e8 : (-o.benefit.dVkt * A.accidentPerVehKm * d) / 1e8;
  const annualB = time + voc + acc;
  const fOp = annuityAfter(o.years, A.years, r);
  const pvB = annualB * fOp;
  const pvCap = (o.cost / o.years) * annuityAfter(0, o.years, r);
  const pvOp = o.opex * fOp;
  const pvC = pvCap + pvOp;
  // 편익 합계가 음수면(사업 뒤 오히려 통행 비용이 늘면) B/C는 0으로 본다: 비율이 음수가 되면 뜻이 없다
  const bc = pvC > 0 ? Math.max(0, pvB) / pvC : 0;
  // AHP 점수 (0~1)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const econ = bc > 0 ? bc / (1 + bc) : 0;   // B/C 1이면 0.5
  const pol = o.policy;
  const items = [
    ['국가 계획 부합', pol.plan ? 0.8 : 0.5],
    ['혼잡 완화', clamp(0.5 + (pol.congB - pol.congA) / 60, 0.3, 0.9)],
    ['남북 통합 기여', pol.border ? 0.85 : pol.kp ? 0.7 : 0.5],
    ['친환경 수단 전환', pol.mode >= 1 ? clamp(0.5 + pol.dRail / 40000, 0.4, 0.85) : clamp(0.45 - (o.benefit.dVkt > 0 ? 0.05 : 0), 0.35, 0.5)],
    ['사업 추진 위험', pol.cost > 100000 ? 0.35 : pol.cost > 30000 ? 0.45 : 0.55],
  ];
  const policy = items.reduce((s, [, v]) => s + v, 0) / items.length;
  const rel = o.region.avgIncome > 0 ? o.region.income / o.region.avgIncome : 1;
  const balance = clamp(0.5 + (1 - rel) * 0.5, 0.2, 0.9);
  const w = o.region.capital ? A.weights.capital : A.weights.region;
  const ahp = w.econ * econ + w.policy * policy + w.balance * balance;
  return { time, voc, acc, annualB, pvB, pvCap, pvOp, pvC, bc, noBenefit: pvB <= 0, npv: pvB - pvC, econ, policy, items, balance, w, ahp, ok: ahp >= 0.5, rel };
}

/** 사업이 놓이는 지역: 존들의 평균 소득과 수도권 여부 */
export function regionOf(zoneProps, incomes, zoneIds) {
  const ids = [...new Set(zoneIds)].filter((i) => i >= 0 && !zoneProps[i]?.ext);
  let pop = 0, inc = 0, cap = 0, tp = 0, ti = 0;
  // 낙후도는 남측 평균 소득에 견준다 (북측은 크게 낮아 지역균형 점수가 높다)
  zoneProps.forEach((z, i) => { if (!z.ext && z.country !== 'KP') { tp += z.pop; ti += z.pop * (incomes?.[i] ?? 0); } });
  for (const i of ids) {
    const z = zoneProps[i];
    pop += z.pop; inc += z.pop * (incomes?.[i] ?? 0);
    if (CAPITAL.test(z.province || z.name || '')) cap += z.pop;
  }
  return { income: pop ? inc / pop : 0, avgIncome: tp ? ti / tp : 0, capital: pop > 0 && cap / pop > 0.5, zones: ids };
}

export function opexFor(kind, { cls, km = 0, cost = 0 }) {
  const A = APPRAISAL;
  if (A.opexShare[kind] != null) return cost * A.opexShare[kind];
  return (A.opexPerKm[cls] ?? 0.5) * km;
}

/** 평가 표 */
export function appraisalHTML(a, fmt) {
  const n2 = (v) => v.toFixed(2);
  const row = (k, v, cls = '') => `<tr><td>${k}</td><td class="${cls}">${v}</td></tr>`;
  return `<h4 style="margin:8px 0 2px">예비타당성 평가 (다 지었을 때)</h4>
    <table class="kv">
      ${row('통행시간 절감 편익 (연)', fmt(a.time))}
      ${row('차량운행비 절감 편익 (연)', fmt(a.voc))}
      ${row('교통사고 감소 편익 (연)', fmt(a.acc))}
      ${row(`편익 현재가치 (${APPRAISAL.years}년)`, fmt(a.pvB))}
      ${row('비용 현재가치 (사업비 + 운영비)', `${fmt(a.pvC)} <span class="m">(${fmt(a.pvCap)} + ${fmt(a.pvOp)})</span>`)}
      ${row('<b>B/C</b> · 순현재가치', `<b class="${a.bc >= 1 ? 'pos' : 'neg'}">${n2(a.bc)}</b> · ${fmt(a.npv)}`)}
    </table>
    ${a.noBenefit ? '<p class="hint">이 사업은 다 지어도 통행 시간·운행비가 오히려 늘어 편익이 없습니다 (B/C 0). 경로가 돌아가거나 막히는 곳으로 교통이 몰리는지 보세요.</p>' : ''}
    <table class="kv" style="margin-top:4px">
      <tr><td><b>AHP 항목</b></td><td><span class="m">가중치 · 점수</span></td></tr>
      ${row(`경제성 (B/C ${n2(a.bc)})`, `${n2(a.w.econ)} · ${n2(a.econ)}`)}
      ${row('정책성', `${n2(a.w.policy)} · ${n2(a.policy)}`)}
      ${a.items.map(([k, v]) => row(`<span class="m">　${k}</span>`, `<span class="m">${n2(v)}</span>`)).join('')}
      ${row(`지역균형발전 <span class="m">(소득 남측 평균의 ${Math.round(a.rel * 100)}%)</span>`, a.w.balance ? `${n2(a.w.balance)} · ${n2(a.balance)}` : '<span class="m">수도권 사업 (보지 않음)</span>')}
      ${row('<b>AHP 종합</b>', `<b class="${a.ok ? 'pos' : 'neg'}">${n2(a.ahp)} · ${a.ok ? '시행 타당' : '시행 부적절'}</b>`)}
    </table>
    <p class="hint">할인율 ${(APPRAISAL.rate * 100).toFixed(1)}% · 운영 ${APPRAISAL.years}년 · 하루 편익 × ${APPRAISAL.daysPerYear}일. 편익은 지금 교통량을 그대로 두고 지금 망(대조)과 다 지은 망(처리)으로 수단·경로를 다시 구한 차이이며(바뀐 구간만 교통량을 다시 정함), 이용자 편익은 반분법(rule of half)으로 셉니다. 차량운행비·사고 편익은 기존 통행 기준이며, 사업으로 새로 생긴 통행이 달린 거리는 비용으로 치지 않습니다. AHP 0.5 이상이면 시행이 타당하다고 봅니다.</p>`;
}

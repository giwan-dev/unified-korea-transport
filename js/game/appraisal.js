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
  const voc = (-o.benefit.dVkt * A.vocPerVehKm * d) / 1e8;
  const acc = (-o.benefit.dVkt * A.accidentPerVehKm * d) / 1e8;
  const annualB = time + voc + acc;
  const fOp = annuityAfter(o.years, A.years, r);
  const pvB = annualB * fOp;
  const pvCap = (o.cost / o.years) * annuityAfter(0, o.years, r);
  const pvOp = o.opex * fOp;
  const pvC = pvCap + pvOp;
  const bc = pvC > 0 ? pvB / pvC : 0;
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
  return { time, voc, acc, annualB, pvB, pvCap, pvOp, pvC, bc, npv: pvB - pvC, econ, policy, items, balance, w, ahp, ok: ahp >= 0.5, rel };
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
    <table class="kv" style="margin-top:4px">
      <tr><td><b>AHP 항목</b></td><td><span class="m">가중치 · 점수</span></td></tr>
      ${row(`경제성 (B/C ${n2(a.bc)})`, `${n2(a.w.econ)} · ${n2(a.econ)}`)}
      ${row('정책성', `${n2(a.w.policy)} · ${n2(a.policy)}`)}
      ${a.items.map(([k, v]) => row(`<span class="m">　${k}</span>`, `<span class="m">${n2(v)}</span>`)).join('')}
      ${row(`지역균형발전 <span class="m">(소득 남측 평균의 ${Math.round(a.rel * 100)}%)</span>`, a.w.balance ? `${n2(a.w.balance)} · ${n2(a.balance)}` : '<span class="m">수도권 사업 (보지 않음)</span>')}
      ${row('<b>AHP 종합</b>', `<b class="${a.ok ? 'pos' : 'neg'}">${n2(a.ahp)} · ${a.ok ? '시행 타당' : '시행 부적절'}</b>`)}
    </table>
    <p class="hint">할인율 ${(APPRAISAL.rate * 100).toFixed(1)}% · 운영 ${APPRAISAL.years}년 · 하루 편익 × ${APPRAISAL.daysPerYear}일. 편익은 지금 그대로(대조군)와 다 지은 뒤(처리군)의 한 해 통행배정 차이로, 이용자 편익은 반분법(rule of half)으로 셉니다. AHP 0.5 이상이면 시행이 타당하다고 봅니다.</p>`;
}

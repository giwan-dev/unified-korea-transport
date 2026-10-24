// 택지지구 개발: 지도에서 고른 곳에 주택 단지를 조성한다. 다 지으면 입주가 시작되고, 분양 수익이 예산으로 돌아온다.
// 입주 인구 가운데 일부(netShare)는 전국 인구가 새로 느는 몫(새 가구 형성·출산·해외 유입)이고, 나머지는 같은 쪽(남·북)의
// 다른 시군에서 옮겨 온다. 교통이 나쁜 곳(접근성이 낮은 곳)은 분양이 덜 되어 입주가 적다. 금액 단위 억원.
import { startProject, canAfford } from './state.js';
import { regionClass } from './devel.js';

export const HOUSING = {
  sizes: {
    s: { label: '소규모', households: 10000, years: 4 },
    m: { label: '중규모', households: 25000, years: 6 },
    l: { label: '신도시급', households: 50000, years: 8 },
  },
  householdSize: 2.4,
  siteCost: { capital: 0.9, metro: 0.6, other: 0.4, kp: 0.25 },   // 세대당 토지 보상·기반시설 (억원)
  unitPrice: { capital: 6, metro: 3.5, other: 2.2, kp: 0.8 },     // 세대당 분양가 (억원)
  margin: 0.2,                                                    // 분양가 가운데 시행자(공공)에게 남는 몫
  netShare: { KR: 0.3, KP: 0.2 },
  happy: 1,
};

/**
 * 택지지구 사업안. access: 그 시군 접근성 / 전국 중앙값
 * @returns {{cost:number, persons:number, net:number, revenue:number, years:number, uptake:number, cls:string}}
 */
export function housingPlan({ size, zone, lat, lon, access }) {
  const H = HOUSING, sz = H.sizes[size];
  const cls = regionClass(zone, lat, lon);
  const uptake = Math.max(0.5, Math.min(1, 0.45 + 0.4 * Math.min(1.5, access || 1)));
  const persons = Math.round(sz.households * H.householdSize * uptake);
  const net = Math.round(persons * H.netShare[cls === 'kp' ? 'KP' : 'KR']);
  const cost = Math.round(sz.households * H.siteCost[cls]);
  const revenue = Math.round(sz.households * uptake * H.unitPrice[cls] * H.margin);
  return { cost, persons, net, revenue, years: sz.years, uptake, cls };
}

export function startHousing(state, { name, zone, lon, lat, size, plan }) {
  if (!canAfford(state, plan.cost, plan.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  const id = crypto.randomUUID();
  (state.housing ||= []).push({ id, name, zone, lon, lat, size, persons: plan.persons, net: plan.net, revenue: plan.revenue, done: false, applied: false });
  startProject(state, { id, kind: 'housing', links: [], stations: [], cost: plan.cost, years: plan.years,
    label: `${name} 택지지구 (${HOUSING.sizes[size].label}, 입주 ${plan.persons.toLocaleString()}명)` });
  return { ok: true };
}

/**
 * 완공된 택지지구: 분양 수익과 행복도, 시뮬레이션에 넘길 입주 목록 (한 번만).
 * net: 입주 인구 가운데 전국 인구가 새로 느는 비율
 */
export function settleHousing(state, doneProjects) {
  const ids = new Set(doneProjects.filter((p) => p.kind === 'housing').map((p) => p.id));
  const out = [];
  for (const h of state.housing || []) {
    if (ids.has(h.id)) {
      h.done = true;
      state.budget += h.revenue;
      state.happyBonus[h.zone] = (state.happyBonus[h.zone] || 0) + HOUSING.happy;
      state.log.unshift(`${state.year}년 ${h.name} 택지지구 입주: ${h.persons.toLocaleString()}명 (순증 ${h.net.toLocaleString()}명), 분양 수익 ${h.revenue.toLocaleString()}억원`);
    }
    if (h.done && !h.applied) { h.applied = true; out.push({ zone: h.zone, lon: h.lon, lat: h.lat, persons: h.persons, net: h.net / Math.max(1, h.persons) }); }
  }
  return out;
}

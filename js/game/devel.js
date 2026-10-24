// 역세권 개발사업: 역 주변에 주거·업무 단지를 지어 인구를 끌어들이고, 다 지으면 분양 수익이 예산으로 돌아온다.
// 사업비는 역세권 인구(반경 3km)가 많을수록 크고, 분양가는 지역(수도권·광역시·그 밖·북측)에 따라 다르다.
// 순유입 인구는 같은 쪽(남·북)의 다른 존에서 인구 비례로 옮겨 온다 (전국 인구는 그대로). 금액 단위 억원.
import { startProject, canAfford, isKP } from './state.js';

export const DEVEL = {
  years: 4,
  baseCost: 1500,          // 기본 사업비
  costPer1000: 10,         // 역세권(3km) 인구 1,000명당 더하는 사업비
  maxCost: 8000,
  persons: { base: 4000, perPop: 0.03, max: 30000 },   // 순유입 인구
  householdSize: 2.4,
  unitPrice: { capital: 6, metro: 3.5, other: 2.2, kp: 0.8 },   // 세대당 분양가 (억원)
  margin: 0.15,            // 분양가 가운데 공공 시행자에게 남는 몫
  happy: 2,                // 완공 뒤 그 존 주민 행복도 가산
};

const CAPITAL = /^(서울|인천|경기)/;
const METRO_CITY = /광역시|특별시|특별자치시/;

export function regionClass(zone, lat, lon) {
  if (isKP(lat, lon)) return 'kp';
  const prov = zone?.province || '';
  if (CAPITAL.test(prov)) return 'capital';
  if (METRO_CITY.test(prov)) return 'metro';
  return 'other';
}

/** 역세권 개발 사업안 */
export function develPlan({ pop3km, zone, lat, lon }) {
  const D = DEVEL;
  const cls = regionClass(zone, lat, lon);
  const cost = Math.round(Math.min(D.maxCost, D.baseCost + (pop3km / 1000) * D.costPer1000) * (cls === 'kp' ? 0.7 : 1));
  const persons = Math.round(Math.min(D.persons.max, D.persons.base + pop3km * D.persons.perPop) * (cls === 'kp' ? 0.6 : 1));
  const revenue = Math.round((persons / D.householdSize) * D.unitPrice[cls] * D.margin);
  return { cost, persons, revenue, years: D.years, cls };
}

export function startDevel(state, { node, name, zone, lon, lat, plan }) {
  if ((state.devels || []).some((d) => d.node === node)) return { ok: false, reason: '이미 역세권 개발을 했거나 하는 중인 역입니다.' };
  if (!canAfford(state, plan.cost, plan.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  const id = crypto.randomUUID();
  (state.devels ||= []).push({ id, node, name, zone, lon, lat, persons: plan.persons, revenue: plan.revenue, done: false, applied: false });
  startProject(state, { id, kind: 'devel', links: [], stations: [], cost: plan.cost, years: plan.years, label: `${name}역 역세권 개발 (순유입 ${plan.persons.toLocaleString()}명)` });
  return { ok: true };
}

/**
 * 완공된 역세권 개발: 분양 수익을 예산에 넣고 행복도를 올린다. 시뮬레이션에 넘길 인구 이동 목록을 돌려준다 (한 번만)
 * @returns {{zone:number, lon:number, lat:number, persons:number}[]}
 */
export function settleDevels(state, doneProjects) {
  const ids = new Set(doneProjects.filter((p) => p.kind === 'devel').map((p) => p.id));
  const out = [];
  for (const d of state.devels || []) {
    if (ids.has(d.id)) {
      d.done = true;
      state.budget += d.revenue;
      state.happyBonus[d.zone] = (state.happyBonus[d.zone] || 0) + DEVEL.happy;
      state.log.unshift(`${state.year}년 ${d.name}역 역세권 개발 완공: 분양 수익 ${d.revenue.toLocaleString()}억원, 인구 ${d.persons.toLocaleString()}명 입주`);
    }
    if (d.done && !d.applied) { d.applied = true; out.push({ zone: d.zone, lon: d.lon, lat: d.lat, persons: d.persons }); }
  }
  return out;
}

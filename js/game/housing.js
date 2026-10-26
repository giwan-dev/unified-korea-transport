// 택지지구 개발: 지도에서 고른 곳(또는 직접 그린 경계)에 주택 단지를 조성한다.
// 지은 세대만큼 인구가 순증한다 (미분양 없음, 다른 시군에서 빼 오지 않는다). 다 지으면 3년에 걸쳐 입주하고,
// 분양 수익은 입지(철도역·고속도로 IC까지 거리, 둘레 수요)가 좋을수록 크다.
// 큰 지구(2만 세대 이상)는 광역교통개선대책 분담금을 내고, 그 돈으로 지구 둘레 간선도로·고속도로 IC까지 연결도로를 함께 놓는다.
// 단지 안에는 신도시처럼 간선도로망(십자 축)을 깔아 실제 도로망에 잇는다. 금액 단위 억원.
import { startProject, canAfford } from './state.js';
import { regionClass } from './devel.js';

export const HOUSING = {
  sizes: {
    s: { label: '소규모', households: 10000 },
    m: { label: '중규모', households: 25000 },
    l: { label: '신도시급', households: 50000 },
  },
  density: 6000,             // 직접 그린 구역: km²당 세대 (3기 신도시 평균쯤)
  householdSize: 2.4,
  siteCost: { capital: 0.9, metro: 0.6, other: 0.4, kp: 0.25 },   // 세대당 토지 보상·단지 안 기반시설 (억원)
  unitPrice: { capital: 6, metro: 3.5, other: 2.2, kp: 0.8 },     // 세대당 분양가 (억원)
  margin: 0.2,                                                    // 분양가 가운데 시행자(공공)에게 남는 몫
  levy: { capital: 0.15, metro: 0.1, other: 0.07, kp: 0.04 },     // 광역교통개선대책 분담금 (세대당 억원)
  levyMin: 20000,            // 이 세대 수 이상이면 광역교통개선대책을 세운다
  moveIn: [0.4, 0.35, 0.25], // 다 지은 뒤 해마다 입주하는 몫
  phase2Lag: 3,              // 2단계는 1단계보다 이만큼 늦게 끝난다 (년)
  happy: 1,
  complaintKm: 3,            // 입주를 마쳤는데 이보다 먼 곳에만 철도역이 있으면 교통 대책 민원
};

/** 세대 수에 따른 공기 (1만 세대 5년, 5만 세대 8년쯤) */
export function housingYears(households) {
  return Math.round(Math.min(9, 4 + households / 12500));
}

/**
 * 택지지구 사업안. score: 입지 점수 0~1 (철도·고속도로 접근과 둘레 수요)
 * @returns {{cost:number, levy:number, persons:number, revenue:number, years:number, cls:string, households:number}}
 */
export function housingPlan({ households, zone, lat, lon, score = 0.5, years }) {
  const H = HOUSING;
  const cls = regionClass(zone, lat, lon);
  const persons = Math.round(households * H.householdSize);
  const cost = Math.round(households * H.siteCost[cls]);
  const levy = households >= H.levyMin ? Math.round(households * H.levy[cls]) : 0;
  // 입지가 좋을수록 분양가가 오른다 (점수 0이면 기준의 70%, 1이면 130%)
  const revenue = Math.round(households * H.unitPrice[cls] * H.margin * (0.7 + 0.6 * score));
  return { cost, levy, persons, revenue, years: years || housingYears(households), cls, households };
}

/**
 * 착공. phases 2면 세대를 반씩 나눠 2단계는 phase2Lag년 늦게 끝난다.
 * roads: 함께 놓는 도로 링크 id (단지 안 간선도로·연결도로, 1단계와 함께 완공). roadCost: 그 공사비
 */
export function startHousing(state, { name, zone, lon, lat, size, ring = null, households, plan, phases = 1, roads = [], roadCost = 0, score = 0.5, railKm = null }) {
  const total = plan.cost + plan.levy + roadCost;
  if (!canAfford(state, total, plan.years)) return { ok: false, reason: '예산과 차입 한도가 부족합니다.' };
  const id = crypto.randomUUID();
  const split = phases === 2 ? [Math.round(households / 2), households - Math.round(households / 2)] : [households];
  const ph = split.map((hh, k) => ({ id: k ? crypto.randomUUID() : id, households: hh, done: false }));
  (state.housing ||= []).push({
    id, name, zone, lon, lat, size, ring, households, persons: plan.persons, net: plan.persons, revenue: plan.revenue,
    score, railKm, levy: plan.levy, phases: ph, moving: [], occupied: 0, done: false, built: false, applied: true,
  });
  ph.forEach((p, k) => {
    const share = p.households / households;
    const cost = Math.round(plan.cost * share + (k ? 0 : plan.levy + roadCost));
    startProject(state, { id: p.id, kind: 'housing', links: k ? [] : roads, stations: [], cost, years: plan.years + (k ? HOUSING.phase2Lag : 0),
      label: `${name} 택지지구${phases === 2 ? ` ${k + 1}단계` : ''} (${p.households.toLocaleString()}세대${!k && plan.levy ? ', 광역교통개선대책 포함' : ''})` });
  });
  return { ok: true };
}

/**
 * 해마다: 완공된 단계는 분양 수익을 받고 입주를 시작하며, 입주는 3년에 걸쳐 이어진다.
 * 시뮬레이션에 넘길 입주 목록을 돌려준다 (그해 들어오는 사람만, 모두 순증)
 */
export function settleHousing(state, doneProjects) {
  const ids = new Set(doneProjects.filter((p) => p.kind === 'housing').map((p) => p.id));
  const out = [];
  for (const h of state.housing || []) {
    // 예전 저장 (단계 없이 한 번에 입주하던 지구): 이미 입주를 마쳤다
    if (!h.phases) {
      if (ids.has(h.id)) {
        h.done = h.built = true;
        state.budget += h.revenue;
        out.push({ zone: h.zone, lon: h.lon, lat: h.lat, persons: h.persons, net: 1 });
      }
      continue;
    }
    for (const p of h.phases) {
      if (!ids.has(p.id) || p.done) continue;
      p.done = true;
      h.built = true;
      const share = p.households / h.households;
      const rev = Math.round(h.revenue * share);
      state.budget += rev;
      h.moving.push({ persons: Math.round(h.persons * share), step: 0 });
      if (p === h.phases[0]) state.happyBonus[h.zone] = (state.happyBonus[h.zone] || 0) + HOUSING.happy;
      state.log.unshift(`${state.year}년 ${h.name} 택지지구${h.phases.length > 1 ? ` ${h.phases.indexOf(p) + 1}단계` : ''} 준공: ${p.households.toLocaleString()}세대 입주 시작, 분양 수익 ${rev.toLocaleString()}억원`);
    }
    let inc = 0;
    for (const m of h.moving) {
      if (m.step >= HOUSING.moveIn.length) continue;
      inc += Math.round(m.persons * HOUSING.moveIn[m.step]);
      m.step++;
    }
    h.moving = h.moving.filter((m) => m.step < HOUSING.moveIn.length);
    if (inc > 0) {
      h.occupied = Math.min(h.persons, (h.occupied || 0) + inc);
      out.push({ zone: h.zone, lon: h.lon, lat: h.lat, persons: inc, net: 1 });
    }
    if (!h.done && h.phases.every((p) => p.done) && !h.moving.length) {
      h.done = true;
      h.occupied = h.persons;
      state.log.unshift(`${state.year}년 ${h.name} 택지지구 입주 완료: ${h.persons.toLocaleString()}명`);
    }
  }
  return out;
}

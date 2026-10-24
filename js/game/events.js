// 해마다 일어나는 사건: 해 넘김 결과가 나온 뒤 어떤 해는(약 40%) 하나가 생기고, 두 가지 대응 가운데 하나를 고른다.
// 같은 사건은 5년 안에 다시 생기지 않는다. 금액 단위 억원. 효과는 예산·부채·지지율·남북 통합도·시군 행복도·공사 기간.

import { t } from '../i18n.js';

const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];

/**
 * 사건 목록. make(ctx)는 {title, body, choices:[{label, apply(state) → 기록 문장}]}를 돌려주거나, 생길 수 없으면 null.
 * ctx: {state, rng, zones(존 목록), zoneName(i), bigCities: [[이름, 존 번호]]}
 */
export const EVENTS = [
  {
    key: 'flood', weight: 3,
    make: ({ state, rng, zones, zoneName }) => {
      const cand = zones.map((z, i) => [z, i]).filter(([z]) => !z.ext && z.pop > 50000);
      if (!cand.length) return null;
      const [z, i] = pick(cand, rng);
      const kp = z.country === 'KP';
      const cost = kp ? 1500 : 3000;
      return {
        title: t(`집중호우: ${zoneName(i)} 철도·도로 피해`, `Heavy rain: rail and road damage in ${zoneName(i)}`),
        body: t(`여름 장마로 ${zoneName(i)} 일대 선로와 도로가 끊겼습니다. ${kp ? '북측은 배수 시설이 낡아 피해가 큽니다.' : ''}`, `Monsoon rains cut tracks and roads around ${zoneName(i)}.${kp ? ' Old drainage in the North makes the damage worse.' : ''}`),
        choices: [
          { label: t(`긴급 복구 (${(cost / 10000).toFixed(2)}조, 지지율 +1)`, `Emergency repairs (₩${(cost / 10).toFixed(0)}B, approval +1)`), apply: (s) => { s.budget -= cost; s.approval = Math.min(100, s.approval + 1); return `${zoneName(i)} 호우 피해 긴급 복구 (${cost.toLocaleString()}억원)`; } },
          { label: t('예산이 빠듯하니 미룬다 (지지율 −3, 그 지역 행복도 −3)', 'Postpone, the budget is tight (approval −3, local happiness −3)'), apply: (s) => { s.approval = Math.max(0, s.approval - 3); s.happyBonus[i] = (s.happyBonus[i] || 0) - 3; return `${zoneName(i)} 호우 피해 복구를 미뤘습니다`; } },
        ],
      };
    },
  },
  {
    key: 'oil', weight: 2,
    make: () => ({
      title: t('국제 유가 급등', 'Oil price spike'),
      body: t('중동 정세가 나빠져 기름값이 크게 올랐습니다. 자가용 통근자의 불만이 커지고, 대중교통 요금을 묶어 달라는 요구가 나옵니다.', 'Fuel prices have soared. Drivers are angry and there are calls to freeze public transport fares.'),
      choices: [
        { label: t('대중교통 요금 동결 지원 (4,000억, 지지율 +2)', 'Subsidise a fare freeze (₩400B, approval +2)'), apply: (s) => { s.budget -= 4000; s.approval = Math.min(100, s.approval + 2); return '유가 급등: 대중교통 요금 동결을 지원했습니다 (4,000억원)'; } },
        { label: t('시장에 맡긴다 (지지율 −2)', 'Leave it to the market (approval −2)'), apply: (s) => { s.approval = Math.max(0, s.approval - 2); return '유가 급등: 별도 지원 없이 넘겼습니다'; } },
      ],
    }),
  },
  {
    key: 'expo', weight: 1,
    make: ({ rng, bigCities }) => {
      const c = pick(bigCities, rng);
      if (!c) return null;
      const [name, zi] = c;
      const what = pick(t(['세계박람회(엑스포)', '아시안게임', '세계청년축제'], ['a World Expo', 'the Asian Games', 'a World Youth Festival']), rng);
      return {
        title: t(`국제 행사 유치 제안: ${name} ${what}`, `Bid to host ${what} in ${name}`),
        body: t(`${name}이 ${what} 유치를 추진합니다. 정부가 지원하면 도시 위상이 오르고 남북 화합의 상징이 됩니다.`, `${name} wants to host ${what}. Government backing would raise its profile and symbolise reconciliation.`),
        choices: [
          { label: t('유치를 지원한다 (1조, 그 도시 행복도 +4, 통합도 +2%p)', 'Back the bid (₩1T, city happiness +4, integration +2 pts)'), apply: (s) => { s.budget -= 10000; s.happyBonus[zi] = (s.happyBonus[zi] || 0) + 4; s.integration = Math.min(1, s.integration + 0.02); return `${name} ${what} 유치 지원 (1조원)`; } },
          { label: t('지원하지 않는다', 'Decline'), apply: () => `${name} ${what} 유치를 지원하지 않았습니다` },
        ],
      };
    },
  },
  {
    key: 'exchange', weight: 2,
    make: ({ state }) => (state.integration >= 0.95 ? null : {
      title: t('남북 교류 행사', 'North–South exchange event'),
      body: t('이산가족 상봉과 남북 친선 경기가 열립니다. 행사장까지 특별 열차를 띄우자는 의견이 있습니다.', 'Family reunions and friendly matches are planned. Some suggest running special trains to the venue.'),
      choices: [
        { label: t('특별 열차를 띄운다 (500억, 통합도 +3%p)', 'Run special trains (₩50B, integration +3 pts)'), apply: (s) => { s.budget -= 500; s.integration = Math.min(1, s.integration + 0.03); return '남북 교류 행사: 특별 열차 운행 (통합도 +3%p)'; } },
        { label: t('행사만 치른다 (통합도 +1%p)', 'Just hold the event (integration +1 pt)'), apply: (s) => { s.integration = Math.min(1, s.integration + 0.01); return '남북 교류 행사 (통합도 +1%p)'; } },
      ],
    }),
  },
  {
    key: 'accident', weight: 2,
    make: ({ state, rng }) => {
      const cand = state.projects.filter((p) => p.status === 'building' && p.kind !== 'osm' && p.kind !== 'rename' && p.doneYear > state.year);
      if (!cand.length) return null;
      const p = pick(cand, rng);
      return {
        title: t(`공사 현장 사고: ${p.label}`, `Construction accident: ${p.label}`),
        body: t('공사 현장에서 안전사고가 났습니다. 전면 안전 점검을 하면 공사가 한 해 늦어집니다.', 'A safety accident occurred on site. A full safety review would delay the project by a year.'),
        choices: [
          { label: t('전면 안전 점검 (공기 +1년, 지지율 +1)', 'Full safety review (+1 year, approval +1)'), apply: (s) => { p.doneYear += 1; s.approval = Math.min(100, s.approval + 1); return `${p.label}: 안전 점검으로 완공이 ${p.doneYear}년으로 늦어졌습니다`; } },
          { label: t('공기를 지킨다 (지지율 −3)', 'Keep the schedule (approval −3)'), apply: (s) => { s.approval = Math.max(0, s.approval - 3); return `${p.label}: 사고 뒤에도 공기를 지켰습니다 (지지율 −3)`; } },
        ],
      };
    },
  },
  {
    key: 'boom', weight: 1,
    make: () => ({
      title: t('경기 호황으로 세수 증가', 'Economic boom, tax windfall'),
      body: t('경기가 좋아 세금이 예상보다 많이 걷혔습니다. 남는 돈을 어디에 쓸지 정합니다.', 'Tax revenue came in above forecast. Decide what to do with the surplus.'),
      choices: [
        { label: t('SOC 예산에 보탠다 (예산 +2조)', 'Add to the infrastructure budget (+₩2T)'), apply: (s) => { s.budget += 20000; return '세수 증가분 2조원을 SOC 예산에 보탰습니다'; } },
        { label: t('빚부터 갚는다 (부채 −2조, 지지율 +1)', 'Pay down debt (−₩2T debt, approval +1)'), apply: (s) => { const pay = Math.min(s.debt, 20000); s.debt -= pay; s.budget += 20000 - pay; s.approval = Math.min(100, s.approval + 1); return `세수 증가분으로 부채 ${pay.toLocaleString()}억원을 갚았습니다`; } },
      ],
    }),
  },
  {
    key: 'austerity', weight: 1,
    make: () => ({
      title: t('재정 긴축 요구', 'Austerity demand'),
      body: t('복지 지출이 늘어 기획재정부가 SOC 예산을 줄이자고 합니다.', 'With welfare spending rising, the finance ministry wants to cut the infrastructure budget.'),
      choices: [
        { label: t('받아들인다 (예산 −1.5조)', 'Accept (budget −₩1.5T)'), apply: (s) => { s.budget -= 15000; return '재정 긴축: SOC 예산 1.5조원 감액'; } },
        { label: t('국채를 찍어 버틴다 (부채 +1.5조, 지지율 −1)', 'Issue bonds instead (debt +₩1.5T, approval −1)'), apply: (s) => { s.debt += 15000; s.approval = Math.max(0, s.approval - 1); return '재정 긴축 요구를 국채 발행(1.5조원)으로 버텼습니다'; } },
      ],
    }),
  },
];

/** 올해 사건 하나 (없으면 null). 같은 사건은 5년 안에 다시 안 생긴다 */
export function rollEvent(ctx) {
  const { state, rng } = ctx;
  if (rng() > 0.4) return null;
  const recent = new Set((state.events || []).filter((e) => e.year > state.year - 5).map((e) => e.key));
  const pool = EVENTS.filter((e) => !recent.has(e.key));
  const total = pool.reduce((t, e) => t + e.weight, 0);
  let r = rng() * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) {
      const ev = e.make(ctx);
      return ev ? { key: e.key, ...ev } : null;
    }
  }
  return null;
}

// 철도 운영사: 남측 코레일, 북측 KPRail (합병하면 하나의 통합 공사).
// 배지·색은 게임에서 만든 것이며 실제 회사의 상표가 아니다.

export const OPERATORS = {
  korail: { name: '코레일', en: 'KORAIL', color: '#1f5fbf' },
  kprail: { name: 'KPRail', en: 'KPRail', color: '#b3263a' },
  merged: { name: '통합 철도공사', en: 'K-RAIL', color: '#6b3fa0' },
};

/** 운영사별 운임·비용 보정: 북측은 운임이 낮고(통합도만큼 오른다), 인건비·전력비도 낮다 */
export const OP_FACTORS = {
  kpFare: (integration) => 0.3 + 0.7 * integration,
  kpCost: 0.6,
  kpMinTrains: 0.4,     // 북측은 지금 운행 횟수가 적다 (최소 운행 열차를 이만큼만)
  mergedCost: 0.95,     // 합병 뒤 중복 조직·차량기지 정리
};

export const RAIL_START = { korailCash: 10000, kprailCash: 0 };   // 억원
export const MERGE_MIN_INTEGRATION = 0.4;
export const EQUITY_STEP = 5000;   // 출자 한 번 (억원)

export function initRail(state) {
  state.rail ||= {
    merged: false, name: '', fund: 'gov',
    ops: { korail: { cash: RAIL_START.korailCash, hist: [] }, kprail: { cash: RAIL_START.kprailCash, hist: [] } },
  };
  return state.rail;
}

/** 링크를 맡는 운영사 id (철도가 아니면 null) */
export function operatorOf(state, link) {
  if (!link || link.mode !== 1 || link.ext) return null;
  if (state.rail?.merged) return 'merged';
  return link.kp ? 'kprail' : 'korail';
}

export function opInfo(state, op) {
  const o = OPERATORS[op];
  return op === 'merged' && state.rail?.name ? { ...o, name: state.rail.name } : o;
}

export function opBadge(state, op) {
  if (!op) return '';
  const o = opInfo(state, op);
  return `<span class="op-badge" style="background:${o.color}" title="${o.name}">${op === 'merged' ? o.name : o.en}</span>`;
}

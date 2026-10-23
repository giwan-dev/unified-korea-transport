// 철도 운영사: 남측 코레일, 북측 KPRail (합병하면 하나의 통합 공사).
// 코레일 로고는 실제 로고(위키미디어 공용, 상표)이고, KPRail·통합 공사는 게임 속 가상 회사라 게임에서 그린 표시다.

export const OPERATORS = {
  korail: { name: '코레일', en: 'KORAIL', color: '#163E7A', logo: 'assets/brand/korail.svg' },
  kprail: { name: 'KPRail', en: 'KPRail', color: '#8E1F2C', logo: 'assets/brand/kprail.svg' },
  merged: { name: '통합 철도공사', en: 'K-RAIL', color: '#4B2A78', logo: 'assets/brand/merged.svg' },
};

/** 운영사별 운임·비용 보정: 북측은 운임이 낮고(통합도만큼 오른다), 인건비·전력비도 낮다 */
export const OP_FACTORS = {
  kpFare: (integration) => 0.3 + 0.7 * integration,
  kpCost: 0.6,          // 열차 운행비 (인건비·전력비가 낮다)
  kpTrackCost: 0.3,     // 선로 유지비: 북측은 보수 수준이 낮고 인건비가 싸다 (첫해 영업계수가 수천이 되지 않게)
  kpMinTrains: 0.25,    // 북측은 지금 운행 횟수가 적다 (최소 운행 열차를 이만큼만, 하루 4회 남짓)
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

// 국외 철도 운영사 (국제 열차 운행 현황): 로고는 위키미디어 공용의 공용 영역 파일이며 각 회사의 상표다 (비상업 식별용).
export const FOREIGN_OPERATORS = {
  CN: { name: '중국국가철로', en: 'China Railway', color: '#B22222', logo: 'assets/brand/cr.svg' },
  JP: { name: 'JR', en: 'JR', color: '#1E7B4A', logo: 'assets/brand/jr.svg' },
  RU: { name: '러시아철도', en: 'RZD', color: '#7A1E1E', logo: 'assets/brand/rzd.svg' },
};

export function foreignOpBadge(country) {
  const o = FOREIGN_OPERATORS[country];
  return o ? `<span class="op-badge" style="background:${o.color}" title="${o.name}">${o.en}</span>` : '';
}

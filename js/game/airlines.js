// 항공사: 합병과 상관없이 대한항공·아시아나항공 두 회사가 노선을 나눠 맡는다 (게임용 배분, 실제 노선 배분과 다를 수 있다).
// 운항이 많은 노선(하루 6회 이상)은 두 회사가 나눠 띄우고, 적은 노선은 한 회사가 맡는다.
// 배지는 게임에서 그린 색 표시이며 실제 회사 상표가 아니다.
import { routeKey } from '../sim/model.js';

export const AIRLINES = {
  KE: { name: '대한항공', color: '#1b64b8' },
  OZ: { name: '아시아나항공', color: '#9b2335' },
};

// 통일 직후 처음부터 다니는 남북 간 국내선 (철도·도로가 끊겨 있어 하늘길부터 연다): [공항, 공항, 하루 왕복]
export const INTER_KOREA_ROUTES = [
  ['GMP', 'FNJ', 8], ['ICN', 'FNJ', 2], ['PUS', 'FNJ', 3], ['CJU', 'FNJ', 2],
  ['GMP', 'WOS', 3], ['GMP', 'RGO', 1], ['GMP', 'DSO', 1], ['GMP', 'YJS', 1],
];

/** 새 게임(또는 남북 노선이 없는 예전 저장)에 남북 간 국내선을 넣는다 */
export function seedInterKoreaAir(state) {
  if (state.air?.interSeeded || !state.air?.routes) return;
  state.air.interSeeded = true;
  for (const [a, b, f] of INTER_KOREA_ROUTES) {
    const key = routeKey(a, b);
    if (!state.air.routes[key]) state.air.routes[key] = { a, b, freq: f, origin: 'base', low: 0, keep: true };   // 수요가 적어도 남북을 잇는 노선이라 철수하지 않는다
  }
}

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** 노선을 맡는 항공사와 하루 운항 횟수 [{code, freq}] */
export function airlinesOf(a, b, freq) {
  const key = routeKey(a, b);
  const first = hash(key) % 2 ? 'KE' : 'OZ', second = first === 'KE' ? 'OZ' : 'KE';
  if (freq < 6) return [{ code: first, freq }];
  const f1 = Math.round(freq * (first === 'KE' ? 0.58 : 0.52));
  return [{ code: first, freq: f1 }, { code: second, freq: freq - f1 }];
}

export function airlineBadge(code) {
  const a = AIRLINES[code];
  return `<span class="op-badge" style="background:${a.color}" title="${a.name} (게임 표시)">${a.name}</span>`;
}

export function airlinesHTML(a, b, freq) {
  return airlinesOf(a, b, freq).map((x) => `${airlineBadge(x.code)} ${x.freq}회`).join(' ');
}

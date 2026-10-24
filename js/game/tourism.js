// 북측 관광지 해금: 남북 통합도가 관광지마다 정한 값에 이르면 열린다. 열린 관광지만 관광 수요(방문객)를 끌어들인다.
// 해금 기준은 게임용 가정값이다 (군사분계선 가까운 곳·이미 남측 관광객을 받았던 곳이 먼저).

const UNLOCK = {
  '개성 (고려 왕도)': 0.2,
  금강산: 0.25,
  '평양 시내': 0.35,
  '원산·갈마 해변': 0.4,
  묘향산: 0.5,
  칠보산: 0.55,
  '백두산 (천지·삼지연)': 0.6,
  개마고원: 0.5,
};
const DEFAULT_UNLOCK = 0.45;

export function unlockAt(site) {
  return UNLOCK[site.name] ?? DEFAULT_UNLOCK;
}

/** 이번에 새로 열린 북측 관광지 (state.tourUnlocked에 적는다) */
export function newlyUnlocked(state, sites) {
  const done = new Set(state.tourUnlocked || []);
  const out = sites.filter((s) => s.kp && !done.has(s.name) && state.integration >= unlockAt(s));
  if (out.length) state.tourUnlocked = [...done, ...out.map((s) => s.name)];
  return out;
}

/** 존별 열린 북측 관광지 하루 방문객 (시뮬레이션의 tourKP) */
export function unlockedTourKP(state, sites, zoneOfSite, Z) {
  const done = new Set(state.tourUnlocked || []);
  const out = new Array(Z).fill(0);
  for (const s of sites) if (s.kp && done.has(s.name)) { const z = zoneOfSite(s); if (z >= 0) out[z] += (s.visitors * 1e6) / 365; }
  return out;
}

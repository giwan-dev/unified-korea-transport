// 읍면동 단위 체감: 시작 때보다 대중교통·철도역까지 가까워진 만큼 주민이 좋아진 것을 느낀다.
// - 읍면동 주민 행복도 = 시군구 행복도 + 체감 개선
// - 읍면동 지지율 = 전국 지지율 + 체감 개선 + 그 지역 단체장 지지율 영향
// - 전국 지지율 요인에 '읍면동 체감 교통 개선'(인구 가중 평균)을 더하고, 시군구청장 지지율도 해마다 체감 변화만큼 움직인다.

export const SENTI = {
  transitWeight: 0.5,   // 대중교통 접근 1분 단축당 점수
  railWeight: 0.2,      // 지역 간 철도역 접근 1분 단축당 점수
  minGain: -10, maxGain: 15,
  happyShare: 0.6,      // 체감 개선이 읍면동 행복도에 얹히는 몫
  approvalShare: 0.8,   // 읍면동 지지율에 얹히는 몫
  nationalWeight: 0.6, nationalMax: 8,   // 전국 지지율 요인 (인구 가중 평균 체감 × 가중, 상한)
  mayorStep: 1.5, mayorMax: 3,           // 시군구청장 지지율: 체감이 한 해에 1점 늘 때마다 1.5점 (한 해 ±3점까지)
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 첫 결과의 읍면동 접근 시간을 기준으로 남긴다 (저장 게임에 들어간다) */
export function initSubBase(state, subs) {
  if (state.subBase?.t?.length === subs.transit.length) return;
  const r1 = (v) => (isFinite(v) ? Math.round(Math.min(v, 300) * 10) / 10 : 300);
  state.subBase = { t: Array.from(subs.transit, r1), r: Array.from(subs.rail, r1) };
}

/** 읍면동별 체감 개선 점수 */
export function subGains(state, subs) {
  const b = state.subBase, n = subs.transit.length, out = new Float32Array(n);
  if (!b || b.t.length !== n) return out;
  for (let i = 0; i < n; i++) {
    const t = Math.min(subs.transit[i], 300), r = Math.min(subs.rail[i], 300);
    out[i] = clamp((b.t[i] - (isFinite(t) ? t : 300)) * SENTI.transitWeight + (b.r[i] - (isFinite(r) ? r : 300)) * SENTI.railWeight, SENTI.minGain, SENTI.maxGain);
  }
  return out;
}

/** 존별 인구 가중 평균 체감 개선 */
export function zoneGains(zoneProps, subs, gains) {
  const g = new Float64Array(zoneProps.length), w = new Float64Array(zoneProps.length);
  zoneProps.forEach((z, i) => z.subs.forEach((_, k) => {
    const s = z.sub0 + k, p = subs.pop[s];
    if (!(p > 0)) return;
    g[i] += gains[s] * p; w[i] += p;
  }));
  for (let i = 0; i < g.length; i++) g[i] = w[i] ? g[i] / w[i] : 0;
  return g;
}

/** 전국 지지율 요인 [이름, 점수] (해마다 updateApproval에 넘긴다) */
export function nationalFactor(subs, gains) {
  let s = 0, w = 0;
  for (let i = 0; i < gains.length; i++) { const p = subs.pop[i]; if (p > 0) { s += gains[i] * p; w += p; } }
  const avg = w ? s / w : 0;
  return ['읍면동 체감 교통 개선', clamp(avg * SENTI.nationalWeight, -SENTI.nationalMax, SENTI.nationalMax)];
}

/** 시군구청장 지지율: 지난해보다 체감이 좋아진 만큼 오르고 나빠진 만큼 내린다 */
export function updateMayorApproval(state, zGains) {
  const prev = state.zoneGainPrev || [];
  for (const [k, off] of Object.entries(state.local?.offices || {})) {
    if (!k.startsWith('m:')) continue;
    const i = parseInt(k.slice(2), 10);   // 분구한 구의 구청장은 'm:존#구'
    const d = (zGains[i] || 0) - (prev[i] ?? zGains[i] ?? 0);
    off.approval = clamp(off.approval + clamp(d * SENTI.mayorStep, -SENTI.mayorMax, SENTI.mayorMax), 0, 100);
  }
  state.zoneGainPrev = Array.from(zGains, (v) => Math.round(v * 100) / 100);
}

/** 지도 색칠 항목 (map.js METRICS에 더한다) */
export function registerSentimentMetrics(METRICS) {
  const party = ['#1f5fd1', '#9db8ec', '#f2f2f2', '#f3a3a6', '#e0383e'];
  Object.assign(METRICS, {
    voteMayor: { label: '득표율 지도 (시군구청장, 국민의힘)', ramp: party, stops: [0.3, 0.42, 0.5, 0.58, 0.7], fmt: (v) => `${Math.round(v * 100)}%` },
    voteGov: { label: '득표율 지도 (광역단체장, 국민의힘)', ramp: party, stops: [0.3, 0.42, 0.5, 0.58, 0.7], fmt: (v) => `${Math.round(v * 100)}%` },
    mayorApproval: { label: '지자체장 지지율 (시군구청장)', ramp: ['#8f2318', '#e88a3c', '#f5e08a', '#7fc29b', '#1f6f4a'], stops: [30, 40, 50, 60, 70], fmt: (v) => `${Math.round(v)}%` },
    subHappy: { label: '읍면동 주민 행복도', sub: true, ramp: ['#8f2318', '#e88a3c', '#f5e08a', '#7fc29b', '#1f6f4a'], stops: [40, 50, 60, 70, 80], fmt: (v) => v.toFixed(0) },
    subApproval: { label: '읍면동 지지율', sub: true, ramp: ['#8f2318', '#e88a3c', '#f5e08a', '#7fc29b', '#1f6f4a'], stops: [35, 45, 55, 65, 75], fmt: (v) => `${Math.round(v)}%` },
    subGain: { label: '읍면동 교통 체감 개선 (시작 대비)', sub: true, ramp: ['#b2182b', '#f4a582', '#f7f7f7', '#92c5de', '#2166ac'], stops: [-5, -1, 0, 3, 10], fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}점` },
  });
}

/** 득표율 (국민의힘 몫): 단체장의 정당과 득표율로 */
export function pShare(off) {
  if (!off || off.share == null || off.appointed) return null;
  if (off.party !== 'P' && off.party !== 'D') return null;   // 3당·무소속 당선: 두 큰 정당 득표율 지도에서는 비운다
  return off.party === 'P' ? off.share : 1 - off.share;
}

/** 읍면동 값: 행복도·지지율 */
export function subValue(metric, { zoneHappy, approval, mayor, gain }) {
  if (metric === 'subHappy') return zoneHappy == null ? null : zoneHappy + gain * SENTI.happyShare;
  if (metric === 'subApproval') return clamp(approval + gain * SENTI.approvalShare + (mayor != null ? (mayor - 50) * 0.2 : 0), 0, 100);
  if (metric === 'subGain') return gain;
  return null;
}

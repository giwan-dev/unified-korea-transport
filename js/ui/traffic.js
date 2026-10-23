// 교통 표시 보조: 북측 협궤 노선 목록과 혼잡 주의 표시(V/C가 높은 구간)

/**
 * 북측 협궤(762mm) 노선. 계산망 자료에 궤간 정보가 없어 이름으로 가린다 (북측 구간만).
 * 출처: 북한 철도 노선 개요(위키백과 등)에서 협궤로 알려진 노선 가운데 계산망에 있는 것
 */
export const NARROW_GAUGE = new Set(['백무선', '삼지연선', '신흥선', '서호선', '허천선', '금골선', '옹진선', '배천선', '장진선']);

export function isNarrow(l) {
  return l.mode === 1 && !!l.kp && NARROW_GAUGE.has(l.name);
}

/** 주의 표시를 붙이는 혼잡도 기준 */
export const HOT_VC = 1.5;

/** 선 도형에서 가장 긴 조각의 가운데 점 */
function midPoint(g) {
  const parts = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
  let best = null, bl = -1;
  for (const p of parts) {
    let len = 0;
    for (let k = 1; k < p.length; k++) len += Math.hypot((p[k][0] - p[k - 1][0]) * 0.8, p[k][1] - p[k - 1][1]);
    if (len > bl) { bl = len; best = p; }
  }
  if (!best || bl <= 0) return null;
  let half = bl / 2;
  for (let k = 1; k < best.length; k++) {
    const [x0, y0] = best[k - 1], [x1, y1] = best[k];
    const d = Math.hypot((x1 - x0) * 0.8, y1 - y0);
    if (d >= half) { const t = d ? half / d : 0; return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]; }
    half -= d;
  }
  return best[best.length - 1];
}

/** 혼잡도가 기준을 넘는 운행 중 구간마다 점 하나 (mode, vc를 속성으로: 보기 메뉴가 수단별로 거른다) */
export function hotspotsFC(linksFC, vc) {
  const features = [];
  if (!linksFC || !vc) return { type: 'FeatureCollection', features };
  for (const f of linksFC.features) {
    const i = f.id, p = f.properties;
    if (i >= vc.length || !(vc[i] > HOT_VC) || p.mode < 0 || p.building || p.ext || p.cls === 'ferry') continue;
    const c = midPoint(f.geometry);
    if (c) features.push({ type: 'Feature', properties: { mode: p.mode, vc: Math.round(vc[i] * 100) / 100 }, geometry: { type: 'Point', coordinates: c } });
  }
  // 심한 곳이 먼저 자리를 차지하도록 (겹치면 뒤의 것이 숨는다)
  features.sort((a, b) => b.properties.vc - a.properties.vc);
  return { type: 'FeatureCollection', features };
}

/** 주의 표시 그림: 빨간 삼각형에 느낌표 */
export function warnIcon(size = 40) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size;
  g.beginPath();
  g.moveTo(s / 2, s * 0.08); g.lineTo(s * 0.95, s * 0.88); g.lineTo(s * 0.05, s * 0.88); g.closePath();
  g.fillStyle = '#d62f2f'; g.strokeStyle = '#ffffff'; g.lineWidth = s * 0.07; g.lineJoin = 'round';
  g.stroke(); g.fill();
  g.fillStyle = '#ffffff';
  g.fillRect(s * 0.46, s * 0.33, s * 0.08, s * 0.3);
  g.fillRect(s * 0.46, s * 0.69, s * 0.08, s * 0.08);
  return g.getImageData(0, 0, s, s);
}

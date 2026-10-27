// 개량 전 북측 철도(직류 3kV·비전철)와 남측 규격 철도(교류 25kV)를 지도에서 구별한다.
// 개량 전 북측 선로 위에 붉은 점선을 덧그리고, 교류 전철화로 남측과 같은 규격이 되면 점선이 사라져 남측 철도로 보인다.

export const KP_STD_COLOR = '#c0392b';

/** 링크가 북측 규격인지 (선로 피처의 rstd 속성) */
export function railStd(eff) {
  if (!eff || eff.mode !== 1 || eff.ext || eff.sstd) return 0;   // 새로 놓은 선로는 남측 규격 (비전철이어도)
  return eff.kp && eff.power !== 'AC' ? 1 : 0;
}

export function addRailKindLayer(map) {
  if (map.getLayer('rails-kpstd')) return;
  map.addLayer({
    id: 'rails-kpstd', type: 'line', source: 'links',
    filter: ['all', ['==', ['get', 'mode'], 1], ['==', ['get', 'building'], 0], ['==', ['get', 'rstd'], 1]],
    layout: { 'line-cap': 'butt' },
    paint: {
      'line-color': KP_STD_COLOR,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 8, 2.4, 11, 3.5],
      'line-dasharray': [2, 2],
      'line-opacity': 0.9,
    },
  }, map.getLayer('metro') ? 'metro' : undefined);
}

/** 범례 한 줄 */
export function railKindLegend() {
  return `<div class="legend-railkind" style="display:flex;gap:10px;align-items:center;font-size:11px;margin-top:4px">
    <span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#6c3fa0" stroke-width="3"/></svg> 남측 규격 철도 (개량된 북측 선로 포함)</span>
    <span><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#6c3fa0" stroke-width="3"/><line x1="0" y1="3" x2="22" y2="3" stroke="${KP_STD_COLOR}" stroke-width="2" stroke-dasharray="4 4"/></svg> 개량 전 북측 철도 (직류 3kV·비전철)</span>
  </div>`;
}

/** 보기 메뉴(도로만 보기 등)에 맞춰 철도 선로와 같이 켜고 끈다 */
export function syncRailKind(map) {
  if (!map.getLayer('rails-kpstd') || !map.getLayer('rails')) return;
  map.setLayoutProperty('rails-kpstd', 'visibility', map.getLayoutProperty('rails', 'visibility') || 'visible');
}

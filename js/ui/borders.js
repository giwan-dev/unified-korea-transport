// 경계선을 한 번씩만 그린다.
// 면(시군구·읍면동) 도형을 그대로 선으로 그리면 이웃한 두 면이 같은 변을 두 번 그리고,
// 따로 단순화한 시도 경계는 시군구 경계와 조금 어긋나 도 경계가 두 줄로 보인다.
// 그래서 같은 좌표의 변을 한 번만 모으고, 양쪽 면의 묶음(도·시군구)이 다른 변은 바깥 경계로 나눈다.

function rings(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return g.coordinates;
  if (g.type === 'MultiPolygon') return g.coordinates.flat();
  return [];
}

const pk = (p) => `${p[0]},${p[1]}`;

/**
 * @param {object[]} features 면 피처
 * @param {(f:object)=>string|number} groupOf 묶음 (같은 묶음끼리 맞닿은 변은 안쪽 경계)
 * @returns {{inner: object, outer: object}} 안쪽 경계·바깥 경계(묶음 사이, 해안·국경) 선 FeatureCollection
 */
export function borderLines(features, groupOf, sameOf = null) {
  // 변마다 붙은 면의 묶음 (sameOf: 같은 묶음 안에서 이 값이 같은 면끼리 맞닿은 변은 긋지 않는다 — 북측 군의 리를 옛 면으로 묶을 때)
  const seg = new Map();
  for (const f of features) {
    const gk = groupOf(f), sk = sameOf ? sameOf(f) : null;
    for (const r of rings(f.geometry)) {
      for (let k = 1; k < r.length; k++) {
        const a = pk(r[k - 1]), b = pk(r[k]);
        if (a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const s = seg.get(key);
        if (s) { s.n++; if (s.g !== gk) s.mixed = true; if (s.s !== sk) s.sMixed = true; } else seg.set(key, { n: 1, g: gk, s: sk, mixed: false, sMixed: false, done: false });
      }
    }
  }
  // 고리를 따라가며 같은 종류의 이어진 변을 한 줄로 묶는다 (이미 그린 변은 건너뛴다)
  const inner = [], outer = [];
  for (const f of features) {
    for (const r of rings(f.geometry)) {
      let run = null, runOuter = false;
      const flush = () => { if (run && run.length > 1) (runOuter ? outer : inner).push(run); run = null; };
      for (let k = 1; k < r.length; k++) {
        const a = pk(r[k - 1]), b = pk(r[k]);
        if (a === b) continue;
        const s = seg.get(a < b ? `${a}|${b}` : `${b}|${a}`);
        if (s.done) { flush(); continue; }
        s.done = true;
        const isOuter = s.n === 1 || s.mixed;
        if (!isOuter && sameOf && !s.sMixed) { flush(); continue; }   // 같은 옛 면 안의 리 경계
        if (run && runOuter === isOuter) run.push(r[k]);
        else { flush(); run = [r[k - 1], r[k]]; runOuter = isOuter; }
      }
      flush();
    }
  }
  const fc = (lines) => ({ type: 'FeatureCollection', features: lines.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }] : [] });
  return { inner: fc(inner), outer: fc(outer) };
}

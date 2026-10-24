// 지도 고속도로 표시 전국 검사. 게임 화면의 콘솔에서:
//   (await import('/tools/mapcheck.js')).checkMotorways(ukt)
// 화면에 그린 고속도로 본선(링크 피처)만 보고, 눈으로 전국을 훑지 않아도 끊김·틈·꺾임을 센다.
//   sharedNodeNotTouching   같은 노드를 쓰는 본선 두 조각의 끝이 30m 넘게 떨어진 곳 (선이 끊겨 보인다) → 0이어야 한다
//   looseEnds               본선 끝이 다른 본선과 닿지 않은 채 400m 안에 있는 곳 (JC에서 연결점이 사라져 보인다)
//   sharpInside             본선 안에서 짧은(300m 안) 마디가 120° 미만으로 꺾이는 곳 (삐죽 튀어나와 보인다)
//   zeroBetweenLoaded       교통량이 있는 본선 사이에 낀 교통량 0 조각 (회색으로 비어 보인다)

const km = (p, q) => Math.hypot((p[0] - q[0]) * 88.6, (p[1] - q[1]) * 111);
const angle = (p, q, r) => {
  const a = [(p[0] - q[0]) * 0.8, p[1] - q[1]], b = [(r[0] - q[0]) * 0.8, r[1] - q[1]];
  const c = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};
const proj = (p, a, b) => {
  const ax = (b[0] - a[0]) * 88.6, ay = (b[1] - a[1]) * 111, px = (p[0] - a[0]) * 88.6, py = (p[1] - a[1]) * 111;
  const L2 = ax * ax + ay * ay || 1e-12, t = Math.max(0, Math.min(1, (px * ax + py * ay) / L2));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

export function checkMotorways(ukt, { examples = 5 } = {}) {
  const { map } = ukt;
  const fc = map.getSource('links')._data;
  const L = ukt.base.links.concat(ukt.state.newLinks || []);
  const feats = fc.features.filter((f) => f.properties.mode === 0 && f.properties.cls === 'motorway' && f.geometry.type === 'LineString');
  const ends = (f) => { const c = f.geometry.coordinates; return [c[0], c[c.length - 1]]; };
  const vol = (i) => map.getFeatureState({ source: 'links', id: i }).vol || 0;
  const ex = { sharedNodeNotTouching: [], looseEnds: [], sharpInside: [], zeroBetweenLoaded: [] };
  const note = (k, v) => { if (ex[k].length < examples) ex[k].push(v); };

  // 선분 격자 (400m 간격으로 칸에 넣는다)
  const CELL = 0.005, grid = new Map();
  for (const f of feats) {
    const c = f.geometry.coordinates;
    for (let k = 1; k < c.length; k++) {
      const n = Math.max(1, Math.ceil(km(c[k - 1], c[k]) / 0.4));
      for (let t = 0; t <= n; t++) {
        const kk = `${Math.floor((c[k - 1][0] + ((c[k][0] - c[k - 1][0]) * t) / n) / CELL)}:${Math.floor((c[k - 1][1] + ((c[k][1] - c[k - 1][1]) * t) / n) / CELL)}`;
        if (!grid.has(kk)) grid.set(kk, []);
        grid.get(kk).push([f, k]);
      }
    }
  }
  const nearestLine = (p, self) => {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    let bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const [f, k] of grid.get(`${cx + dx}:${cy + dy}`) || []) {
        if (f === self) continue;
        const c = f.geometry.coordinates;
        bd = Math.min(bd, km(p, proj(p, c[k - 1], c[k])));
      }
    }
    return bd;
  };

  let looseEnds = 0;
  for (const f of feats) for (const p of ends(f)) {
    const d = nearestLine(p, f);
    if (d > 0.03 && d < 0.4) { looseEnds++; note('looseEnds', [L[f.id].name, `${Math.round(d * 1000)}m`, p]); }
  }

  const at = new Map();
  for (const f of feats) { const l = L[f.id]; for (const nd of [l.a, l.b]) { if (!at.has(nd)) at.set(nd, []); at.get(nd).push(f); } }
  let notTouching = 0, zeroBetween = 0;
  for (const fs of at.values()) {
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
      const a = ends(fs[i]), b = ends(fs[j]);
      const d = Math.min(...a.flatMap((p) => b.map((q) => km(p, q))));
      if (d > 0.03) { notTouching++; note('sharedNodeNotTouching', [L[fs[i].id].name, L[fs[j].id].name, `${Math.round(d * 1000)}m`, a[0]]); }
    }
  }
  for (const f of feats) {
    if (vol(f.id) > 0) continue;
    const l = L[f.id];
    if ([l.a, l.b].every((nd) => (at.get(nd) || []).some((g) => g !== f && vol(g.id) > 0))) { zeroBetween++; note('zeroBetweenLoaded', [l.name, f.geometry.coordinates[0]]); }
  }

  let sharp = 0;
  for (const f of feats) {
    const c = f.geometry.coordinates;
    for (let k = 1; k + 1 < c.length; k++) {
      if (angle(c[k - 1], c[k], c[k + 1]) < 120 && (km(c[k - 1], c[k]) < 0.3 || km(c[k], c[k + 1]) < 0.3)) { sharp++; note('sharpInside', [L[f.id].name, c[k]]); }
    }
  }
  return { mainlineFeatures: feats.length, sharedNodeNotTouching: notTouching, looseEnds, sharpInside: sharp, zeroBetweenLoaded: zeroBetween, examples: ex };
}

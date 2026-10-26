// 교통 표시 보조: 북측 협궤 노선 목록과 혼잡 주의 표시(V/C가 높은 구간)

/**
 * 북측 협궤(762mm) 노선. 계산망 자료에 궤간 정보가 없어 이름으로 가린다 (북측 구간만).
 * 출처: 북한 철도 노선 개요(위키백과 등)에서 협궤로 알려진 노선 가운데 계산망에 있는 것
 */
export const NARROW_GAUGE = new Set(['백무선', '삼지연선', '신흥선', '서호선', '허천선', '금골선', '옹진선', '배천선', '장진선']);

export function isNarrow(l) {
  // 개량한 구간은 표준궤: std 표시, 또는 예전 저장처럼 표시가 없어도 협궤 기본(40km/h·교류 아님)보다 좋아졌으면
  return l.mode === 1 && !!l.kp && !l.std && !(l.speed > 40) && l.power !== 'AC' && NARROW_GAUGE.has(l.name);
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

/**
 * 같은 두 노드를 잇는 같은 수단 링크를 묶는다: 왕복 분리 도로의 두 차로·복선의 두 선로가 따로 들어온 것,
 * 그리고 노선망에서 고속도로 노드에 옆 일반도로가 붙어 같은 두 노드를 함께 잇게 된 것(데이터 결함, 전국 약 500곳).
 * 화면에는 묶음의 대표 링크(등급이 가장 높은 것)만 그리고 교통량은 합친다: 둘 다 그리면 살짝 어긋난 두 선이
 * 다른 색으로 겹치거나, 짧은 일반도로로 교통이 빠진 고속도로 구간이 회색으로 비어 고속도로가 토막토막 끊겨 보인다.
 * @param {{a:number,b:number,mode:number,k?:string,rank?:number}[]} links 화면용 링크 (그리지 않는 링크는 null 또는 mode < 0,
 *   k가 다르면 묶지 않는다, rank가 작을수록 대표가 된다)
 * @returns {Int32Array} 링크마다 묶음 대표 링크 번호 (자기 자신이면 대표)
 */
export function twinPrimary(links) {
  const out = new Int32Array(links.length);
  const seen = new Map();
  links.forEach((l, i) => {
    out[i] = i;
    if (!l || l.mode < 0) return;
    const key = `${l.mode}:${l.k ?? ''}:${Math.min(l.a, l.b)}-${Math.max(l.a, l.b)}`;
    const p = seen.get(key);
    if (p == null) seen.set(key, i);
    else if ((l.rank ?? 0) < (links[p].rank ?? 0)) seen.set(key, i);
  });
  links.forEach((l, i) => {
    if (!l || l.mode < 0) return;
    out[i] = seen.get(`${l.mode}:${l.k ?? ''}:${Math.min(l.a, l.b)}-${Math.max(l.a, l.b)}`);
  });
  return out;
}

/** 도로 등급 순위 (묶음 대표를 고를 때) */
export const ROAD_RANK = { motorway: 0, trunk: 1, primary: 2, secondary: 3 };

/** 묶음 대표 링크에 묶음 전체의 교통량과 혼잡도(교통량 합 ÷ 용량 합)를 싣는다. 용량은 교통량 ÷ V/C로 되짚는다 */
export function mergeTwins(primary, vc, vol) {
  const n = Math.min(vc.length, primary.length);
  const sv = new Float64Array(n), sc = new Float64Array(n), cnt = new Int32Array(n), known = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const p = primary[i];
    sv[p] += vol[i]; cnt[p]++;
    if (vol[i] > 0 && vc[i] > 0) { sc[p] += vol[i] / vc[i]; known[p]++; }
  }
  const outVc = Float64Array.from(vc.subarray ? vc.subarray(0, n) : vc.slice(0, n)), outVol = Float64Array.from(vol.subarray ? vol.subarray(0, n) : vol.slice(0, n));
  for (let p = 0; p < n; p++) {
    if (cnt[p] < 2) continue;
    outVol[p] = sv[p];
    // 용량을 모르는 링크(교통량 0)는 아는 링크들의 평균 용량으로 본다
    const cap = known[p] ? sc[p] * cnt[p] / known[p] : 0;
    outVc[p] = cap > 0 ? sv[p] / cap : 0;
  }
  return { vc: outVc, vol: outVol };
}

// 고속도로 본선 이름: 남측 "…고속도로", 북측 평양원산관광도로·청년영웅도로(평양–남포)
const MAINLINE_NAME = /고속도로|고속국도|관광도로|영웅도로/;

/**
 * 고속도로(motorway) 링크 가운데 본선을 고른다. 나머지(IC·JCT 연결로, 본선에 붙은 "○○대로" 접속도로)는
 * 지도에서 일반도로처럼 그린다.
 * - 이름이 본선 이름이면 본선
 * - 이름 없는 터널·교량 조각이 이어진 사슬은, 양 끝이 본선에 닿고 끝마다 본선과 거의 일직선(35° 안)으로
 *   이어지면 본선 (연결로는 본선에서 비스듬히 갈라진다). 이름 없이 3km 넘게 이어진 사슬도 본선
 * @param {{a:number,b:number,mode:number,cls:string,name?:string,len:number}[]} links 링크 (그리지 않는 링크는 null)
 * @param {(n:number)=>number[]} nodeXY 노드 좌표
 * @param {(i:number)=>boolean} [isNew] 플레이어가 새로 놓은 링크 (새 고속도로는 모두 본선)
 * @returns {Uint8Array} 1 본선, 2 JC 연결로(양 끝이 모두 본선에 붙은 연결로·고리: 지도에서 그리지 않아 JC가 사거리로 보인다), 0 그 밖의 연결로·접속도로
 */
export function motorwayMainline(links, nodeXY, isNew = () => false) {
  const n = links.length;
  const isMw = (l) => l && l.mode === 0 && l.cls === 'motorway';
  const main = new Uint8Array(n);
  const at = new Map();   // 노드 → 고속도로 링크들
  links.forEach((l, i) => {
    if (!isMw(l)) return;
    if (MAINLINE_NAME.test(l.name || '') || isNew(i)) main[i] = 1;
    for (const nd of [l.a, l.b]) { if (!at.has(nd)) at.set(nd, []); at.get(nd).push(i); }
  });
  const other = (l, nd) => (l.a === nd ? l.b : l.a);
  // nd에서 링크 i를 따라 나가는 방향 (라디안)
  const dir = (i, nd) => {
    const p = nodeXY(nd), q = nodeXY(other(links[i], nd));
    return Math.atan2(q[1] - p[1], (q[0] - p[0]) * Math.cos((p[1] * Math.PI) / 180));
  };
  const straight = (i, nd) => {
    // 본선 링크 가운데 하나가 i와 반대 방향(일직선)으로 nd에서 나가면 참
    const a = dir(i, nd);
    return (at.get(nd) || []).some((j) => {
      if (j === i || !main[j]) return false;
      let d = Math.abs(a - dir(j, nd)) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return Math.PI - d < (35 * Math.PI) / 180;
    });
  };
  const done = new Uint8Array(n);
  const chains = [];
  links.forEach((l, i) => {
    if (!isMw(l) || main[i] || done[i]) return;
    // 본선이 아닌 고속도로 링크끼리 둘만 만나는 노드를 따라 사슬을 모은다
    const chain = [i];
    done[i] = 1;
    const ends = [];
    for (const start of [l.a, l.b]) {
      let cur = i, nd = start;
      for (;;) {
        const here = at.get(nd) || [];
        const next = here.filter((j) => j !== cur && !main[j]);
        if (here.length !== 2 || next.length !== 1 || done[next[0]]) { ends.push([cur, nd]); break; }
        cur = next[0]; done[cur] = 1; chain.push(cur);
        nd = other(links[cur], nd);
      }
    }
    const km = chain.reduce((s, j) => s + (links[j].len || 0), 0);
    const bridged = ends.every(([j, nd]) => straight(j, nd));
    const unnamed = chain.every((j) => !links[j].name);
    if (bridged || (km >= 3 && unnamed)) for (const j of chain) main[j] = 1;
    else chains.push([chain, ends]);
  });
  // 본선을 다 정한 뒤: 양 끝이 모두 본선 노드에 붙은 사슬은 JC 연결로.
  // 다만 양 끝이 같은 이름의 본선에 붙으면(한 고속도로의 끊긴 두 조각을 잇는 짧은 조각) 본선으로 본다: 숨기면 본선에 틈이 생긴다
  const mainNames = (nd) => new Set((at.get(nd) || []).filter((j) => main[j] === 1).map((j) => links[j].name || ''));
  for (const [chain, ends] of chains) {
    if (chain.some((j) => main[j])) continue;
    const names = ends.map(([, nd]) => mainNames(nd));
    if (!names.every((s) => s.size)) continue;
    const same = [...names[0]].some((n) => n && names[1].has(n));
    for (const j of chain) main[j] = same ? 1 : 2;
  }
  return main;
}

/** 선 안에서 짧은(300m 안) 마디가 날카롭게(120° 미만) 꺾이는 점을 지운다 (양 끝점은 그대로) */
export function despikeLine(c) {
  const kmXY = (p, q) => Math.hypot((p[0] - q[0]) * 88.6, (p[1] - q[1]) * 111);
  const angle = (p, q, r) => {
    const a = [(p[0] - q[0]) * 0.8, p[1] - q[1]], b = [(r[0] - q[0]) * 0.8, r[1] - q[1]];
    const cs = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cs))) * 180) / Math.PI;
  };
  let changed = true;
  while (changed && c.length > 2) {
    changed = false;
    for (let k = 1; k + 1 < c.length; k++) {
      if (angle(c[k - 1], c[k], c[k + 1]) < 120 && (kmXY(c[k - 1], c[k]) < 0.3 || kmXY(c[k], c[k + 1]) < 0.3)) { c.splice(k, 1); changed = true; break; }
    }
  }
  return c;
}

/**
 * 고속도로 본선 도형을 고르게 편다 (화면용, 도형을 복사해 바꾼다).
 * - 선 안에서 짧은(300m 안) 두 마디가 날카롭게(120° 미만) 꺾이는 점은 지운다: OSM 도형이 연결로 쪽으로 잠깐 휘었다 돌아오는 곳
 * - 같은 노드에서 이어지는 본선 두 조각이 날카롭게 꺾이면, 두 끝점을 양옆 점의 가운데로 옮긴다:
 *   계산망 노드가 본선에서 조금 벗어난 곳(격자 교차점·JC 중심)에 있어 선이 노드로 삐죽 튀어나왔다 돌아오는 곳
 * @param {object[]} features 링크 피처 (id = 링크 번호)
 * @param {Uint8Array} main motorwayMainline 결과
 * @param {(i:number)=>{a:number,b:number}} linkOf
 */
export function flattenMainline(features, main, linkOf) {
  const kmXY = (p, q) => Math.hypot((p[0] - q[0]) * 88.6, (p[1] - q[1]) * 111);
  const angle = (p, q, r) => {
    const a = [(p[0] - q[0]) * 0.8, p[1] - q[1]], b = [(r[0] - q[0]) * 0.8, r[1] - q[1]];
    const c = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
  };
  const despike = despikeLine;
  const ends = new Map();   // 노드 → [{c, first}]
  for (const f of features) {
    if (main[f.id] !== 1 || f.properties.mode !== 0) continue;
    const g = f.geometry;
    if (g.type !== 'LineString') continue;
    const c = despike(g.coordinates.map((p) => p.slice()));
    f.geometry = { type: 'LineString', coordinates: c };
    const l = linkOf(f.id);
    // 도형 방향: 첫 점이 a 노드 쪽인지
    const aFirst = kmXY(c[0], l.pa) <= kmXY(c[c.length - 1], l.pa);
    for (const [nd, first] of [[l.a, aFirst], [l.b, !aFirst]]) {
      if (!ends.has(nd)) ends.set(nd, []);
      ends.get(nd).push({ c, first });
    }
  }
  // 두 조각만 만나는 노드에서만 편다. 셋 이상 만나는 교차점(JC)은 노드 자리를 그대로 두어
  // 두 고속도로가 한 점에서 엇갈리게(사거리) 한다: 끝점을 옮기면 다른 조각과 떨어진다
  for (const list of ends.values()) {
    if (list.length !== 2) continue;
    const [x, y] = list, limit = 120;
    if (x.c.length < 2 || y.c.length < 2) continue;
    const xe = x.first ? x.c[0] : x.c[x.c.length - 1], xp = x.first ? x.c[1] : x.c[x.c.length - 2];
    const ye = y.first ? y.c[0] : y.c[y.c.length - 1], yp = y.first ? y.c[1] : y.c[y.c.length - 2];
    if (kmXY(xe, ye) > 0.05) continue;   // 끝이 서로 떨어져 있으면 건드리지 않는다
    if (angle(xp, xe, yp) >= limit) continue;
    const mid = [(xp[0] + yp[0]) / 2, (xp[1] + yp[1]) / 2];
    // 짧은 조각은 끝점을 옮기면 꺾임이 다음 점으로 옮겨 갈 뿐이므로, 끝점 바로 안쪽 점이 짧으면 그 점을 지운다
    for (const e of [x, y]) {
      const c = e.c;
      if (c.length > 2) {
        const inner = e.first ? 1 : c.length - 2;
        if (kmXY(c[inner], mid) < 0.3) c.splice(inner, 1);
      }
      if (e.first) c[0] = mid.slice(); else c[c.length - 1] = mid.slice();
    }
  }
}

/**
 * JC 연결로를 그리지 않으면, 다른 고속도로에 붙어 끝나는 본선(예: 호남고속도로지선 → 경부고속도로 회덕JC)이
 * 상대 본선에 닿지 못하고 끝난다. 그런 끝(다른 본선 어디에도 30m 안으로 닿지 않는 끝)을
 * 400m 안 가장 가까운 다른 본선 위의 점까지 이어 T자·사거리로 만든다.
 * 크게 꺾여 되돌아가는 방향이면 점을 덧붙이지 않고 끝점을 그 점으로 옮긴다 (삐죽한 꺾임 대신).
 * @param {object[]} features 링크 피처 (flattenMainline 뒤)
 * @param {Uint8Array} main motorwayMainline 결과
 * @param {(i:number)=>{a:number,b:number,pa:number[]}} linkOf
 */
export function connectJunctions(features, main, linkOf) {
  const kmXY = (p, q) => Math.hypot((p[0] - q[0]) * 88.6, (p[1] - q[1]) * 111);
  const CELL = 0.005;
  const mains = features.filter((f) => main[f.id] === 1 && f.properties.mode === 0 && f.geometry.type === 'LineString');
  const grid = new Map();
  for (const f of mains) {
    const c = f.geometry.coordinates;
    for (let k = 1; k < c.length; k++) {
      const n = Math.max(1, Math.ceil(kmXY(c[k - 1], c[k]) / 0.4));
      const keys = new Set();
      for (let t = 0; t <= n; t++) keys.add(`${Math.floor((c[k - 1][0] + ((c[k][0] - c[k - 1][0]) * t) / n) / CELL)}:${Math.floor((c[k - 1][1] + ((c[k][1] - c[k - 1][1]) * t) / n) / CELL)}`);
      // 선분 번호가 아니라 양 끝 좌표를 넣는다 (아래에서 선을 고쳐도 어긋나지 않게)
      const seg = [f, c[k - 1].slice(), c[k].slice()];
      for (const kk of keys) { if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(seg); }
    }
  }
  const proj = (p, a, b) => {
    const ax = (b[0] - a[0]) * 88.6, ay = (b[1] - a[1]) * 111, px = (p[0] - a[0]) * 88.6, py = (p[1] - a[1]) * 111;
    const L2 = ax * ax + ay * ay || 1e-12, t = Math.max(0, Math.min(1, (px * ax + py * ay) / L2));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const touching = (p, self) => {
    const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const [f, a, b] of grid.get(`${cx + dx}:${cy + dy}`) || []) {
        if (f === self) continue;
        if (kmXY(p, proj(p, a, b)) < 0.03) return true;
      }
    }
    return false;
  };
  let added = 0;
  for (const f of mains) {
    const l = linkOf(f.id);
    const c = f.geometry.coordinates;
    const aFirst = kmXY(c[0], l.pa) <= kmXY(c[c.length - 1], l.pa);
    for (const [nd, first] of [[l.a, aFirst], [l.b, !aFirst]]) {
      const p = first ? c[0] : c[c.length - 1];
      if (touching(p, f)) continue;
      // 400m 안 가장 가까운 다른 본선 위의 점
      let best = null, bd = 0.4;
      const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const [g, a, b] of grid.get(`${cx + dx}:${cy + dy}`) || []) {
          if (g === f) continue;
          const q = proj(p, a, b);
          const d = kmXY(p, q);
          if (d < bd) { bd = d; best = q; }
        }
      }
      if (!best) continue;
      // 진행 방향에서 60° 넘게 꺾이면 점을 덧붙이지 않고 끝점을 옮긴다
      const q = first ? c[1] : c[c.length - 2];
      let turn = false;
      if (q) {
        const v1 = [(p[0] - q[0]) * 0.8, p[1] - q[1]], v2 = [(best[0] - p[0]) * 0.8, best[1] - p[1]];
        turn = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1) < 0.5;
      }
      if (turn && c.length > 2) { if (first) c[0] = best; else c[c.length - 1] = best; }
      else if (first) c.unshift(best); else c.push(best);
      // 이은 끝 바로 안쪽에 생긴 날카로운 꺾임만 편다 (선 가운데 점은 다른 본선이 닿아 있을 수 있어 건드리지 않는다)
      for (let t = 0; t < 2 && c.length > 2; t++) {
        const k = first ? 1 : c.length - 2;
        const [u, v, w] = first ? [c[0], c[1], c[2]] : [c[c.length - 1], c[c.length - 2], c[c.length - 3]];
        const a1 = [(u[0] - v[0]) * 0.8, u[1] - v[1]], a2 = [(w[0] - v[0]) * 0.8, w[1] - v[1]];
        const cs = (a1[0] * a2[0] + a1[1] * a2[1]) / (Math.hypot(a1[0], a1[1]) * Math.hypot(a2[0], a2[1]) || 1);
        if (cs > -0.5) c.splice(k, 1); else break;   // 120° 미만으로 꺾이면 그 점을 지운다
      }
      added++;
    }
  }
  return added;
}

/**
 * 마지막 정리: 본선 조각마다 끝점 바로 안쪽에서 날카롭게(120° 미만) 꺾이는 짧은(300m 안) 점을 지운다.
 * 교차점 정리·JC 잇기로 끝점이 옮겨진 뒤 생긴 꺾임이다. 끝점은 그대로 두어 이어진 곳은 떨어지지 않는다.
 */
export function smoothMainlineEnds(features, main) {
  const kmXY = (p, q) => Math.hypot((p[0] - q[0]) * 88.6, (p[1] - q[1]) * 111);
  const sharp = (p, q, r) => {
    const a = [(p[0] - q[0]) * 0.8, p[1] - q[1]], b = [(r[0] - q[0]) * 0.8, r[1] - q[1]];
    return (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1) > -0.5;
  };
  for (const f of features) {
    if (main[f.id] !== 1 || f.properties.mode !== 0 || f.geometry.type !== 'LineString') continue;
    const c = f.geometry.coordinates;
    for (let t = 0; t < 3 && c.length > 2; t++) {
      let changed = false;
      for (const k of [1, c.length - 2]) {
        if (k < 1 || k > c.length - 2) continue;
        if (sharp(c[k - 1], c[k], c[k + 1]) && (kmXY(c[k - 1], c[k]) < 0.3 || kmXY(c[k], c[k + 1]) < 0.3)) { c.splice(k, 1); changed = true; break; }
      }
      if (!changed) break;
    }
  }
}

/**
 * 같은 이름 본선이 한 노드에서 두 갈래(상·하행 분리 차로)로 갈라졌다가 다른 한 노드에서 다시 만나는 곳은 한 갈래만 그린다.
 * 갈라진 두 끝이 같은 노드라서 한 갈래를 숨겨도 본선이 끊기지 않는다 (아무 쪽이나 숨기면 상·하행을 번갈아 남겨 틈이 생긴다).
 * @param {{a:number,b:number,mode:number,cls:string,name?:string,len:number}[]} links
 * @param {Uint8Array} main motorwayMainline 결과 (1 본선)
 * @param {(i:number)=>boolean} shown 화면에 그리는 링크인지 (쌍 합치기로 숨긴 것은 뺀다)
 * @returns {Map<number, number>} 숨길 링크 → 교통량을 합칠 남긴 갈래의 링크
 */
export function mainlineBubbles(links, main, shown) {
  const at = new Map();
  links.forEach((l, i) => {
    if (main[i] !== 1 || !shown(i)) return;
    for (const nd of [l.a, l.b]) { if (!at.has(nd)) at.set(nd, []); at.get(nd).push(i); }
  });
  const other = (l, nd) => (l.a === nd ? l.b : l.a);
  const out = new Map();
  for (const [x, ids] of at) {
    if (ids.length < 3) continue;   // 갈라지는 노드
    const branches = new Map();     // `${끝 노드}:${이름}` → [{links, km}]
    for (const first of ids) {
      if (out.has(first)) continue;
      const name = links[first].name || '';
      const chain = [first];
      let km = links[first].len || 0, nd = other(links[first], x), cur = first;
      while ((at.get(nd) || []).length === 2 && chain.length < 200) {
        const next = at.get(nd).find((j) => j !== cur);
        if ((links[next].name || '') !== name) break;
        chain.push(next); km += links[next].len || 0; cur = next; nd = other(links[next], nd);
      }
      if (nd === x || !name) continue;
      const key = `${nd}:${name}`;
      if (!branches.has(key)) branches.set(key, []);
      branches.get(key).push({ chain, km });
    }
    for (const list of branches.values()) {
      if (list.length < 2) continue;
      list.sort((p, q) => q.km - p.km);
      const keep = list[0];
      for (const b of list.slice(1)) {
        if (b.km > 8 || keep.km > b.km * 1.6 + 0.3) continue;   // 길이가 많이 다르면 다른 길이다
        // 숨긴 갈래의 각 링크는 남긴 갈래에서 순서상 같은 자리쯤의 링크에 교통량을 합친다
        b.chain.forEach((j, k) => out.set(j, keep.chain[Math.min(keep.chain.length - 1, Math.floor((k * keep.chain.length) / b.chain.length))]));
      }
    }
  }
  return out;
}

/**
 * 본선 모서리 둥글리기 (마지막 단계): 두 조각만 만나는 이음매와 선 안의 꺾인 점(170° 미만)을
 * 2차 베지어 곡선으로 깎는다. 짧은 링크는 곡선을 만들어도 점이 두 개뿐이라 직선이 되고, 계산망 노드가
 * 본선에서 조금 벗어나 있으면 두 조각이 노드로 들어갔다 나오며 꺾인다. 이음매에서는 두 조각이 곡선의
 * 가운데 점을 함께 가져 이어진 채로 둥글어진다. 셋 이상 만나는 교차점(JC)은 사거리로 두므로 건드리지 않는다.
 */
export function roundMainlineCorners(features, main) {
  const kmXY = (p, q) => Math.hypot((p[0] - q[0]) * 88.6, (p[1] - q[1]) * 111);
  const angle = (p, q, r) => {
    const a = [(p[0] - q[0]) * 0.8, p[1] - q[1]], b = [(r[0] - q[0]) * 0.8, r[1] - q[1]];
    const cs = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, cs))) * 180) / Math.PI;
  };
  // 모서리 양쪽으로 최대 400m, 이웃 점까지 거리의 절반까지만 깎는다 (이웃 모서리와 겹치지 않게)
  const toward = (q, p) => { const d = kmXY(q, p), r = Math.min(0.4, d / 2); const t = d ? r / d : 0; return [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]; };
  const bez = (p0, p1, p2, t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]];
  // 곡선 점 수: 깎는 길이 약 40m마다 하나 (2~8개)
  const steps = (a, q, b) => Math.max(2, Math.min(8, Math.round((kmXY(a, q) + kmXY(q, b)) / 0.04)));
  const mains = features.filter((f) => main[f.id] === 1 && f.properties.mode === 0 && f.geometry.type === 'LineString');
  // 0) 깎기 전에 잔 점을 지운다 (양 끝은 그대로라 이어진 곳은 떨어지지 않는다)
  //    - 좌표 반올림(약 1m)으로 생긴 10m 안의 점: 아주 짧은 마디는 각도가 제멋대로다
  //    - 12m 안에서 크게(150° 미만) 꺾이는 점: 지방도를 고속도로로 고치는 이어받은 공사 구간처럼 원래 도형이 잘게 구불거리는 곳
  //    지운 자리에 생기는 모서리는 아래에서 깎는다 (그래서 이 정리는 깎기 앞에서만 한다)
  for (const f of mains) {
    const c = f.geometry.coordinates;
    for (let k = c.length - 2; k >= 1; k--) if (kmXY(c[k], c[k + 1]) < 0.01 || kmXY(c[k], c[k - 1]) < 0.01) c.splice(k, 1);
    for (let changed = true, guard = 0; changed && guard < 50; guard++) {
      changed = false;
      for (let k = 1; k + 1 < c.length; k++) {
        if ((kmXY(c[k], c[k - 1]) < 0.012 || kmXY(c[k], c[k + 1]) < 0.012) && angle(c[k - 1], c[k], c[k + 1]) < 150) { c.splice(k, 1); changed = true; break; }
      }
    }
  }
  // 1) 선 안의 꺾인 점
  for (const f of mains) {
    const c = f.geometry.coordinates;
    for (let k = 1; k + 1 < c.length; k++) {
      if (angle(c[k - 1], c[k], c[k + 1]) >= 170) continue;
      // 이웃 점이 20m도 안 되는 아주 작은 모서리는 깎는 대신 그 점을 지운다 (곡선 점이 몇 m 안에 몰려 고리가 생긴다)
      if (kmXY(c[k], c[k - 1]) < 0.02 || kmXY(c[k], c[k + 1]) < 0.02) { c.splice(k, 1); k--; continue; }
      const a = toward(c[k], c[k - 1]), b = toward(c[k], c[k + 1]), n = steps(a, c[k], b);
      const pts = [];
      for (let s = 0; s <= n; s++) pts.push(bez(a, c[k], b, s / n));
      c.splice(k, 1, ...pts);
      k += n;
    }
  }
  // 2) 두 조각만 만나는 이음매: 두 조각이 곡선의 가운데 점을 함께 가진다
  const ends = new Map();
  for (const f of mains) {
    const c = f.geometry.coordinates;
    if (c.length < 2) continue;
    for (const first of [true, false]) {
      const e = first ? c[0] : c[c.length - 1];
      const key = `${e[0].toFixed(5)},${e[1].toFixed(5)}`;
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key).push({ c, first });
    }
  }
  for (const list of ends.values()) {
    if (list.length !== 2) continue;
    const [x, y] = list;
    if (x.c === y.c) continue;
    const e = x.first ? x.c[0] : x.c[x.c.length - 1];
    const xp = x.first ? x.c[1] : x.c[x.c.length - 2], yp = y.first ? y.c[1] : y.c[y.c.length - 2];
    if (!xp || !yp || angle(xp, e, yp) >= 170) continue;
    // 이음매 바로 옆 점이 20m 안이면 그 점을 지워 팔을 늘린다 (끝점은 그대로). 조각이 두 점뿐이면 그대로 깎는다
    let shortArm = false;
    for (const z of [x, y]) {
      while (z.c.length > 2 && kmXY(e, z.first ? z.c[1] : z.c[z.c.length - 2]) < 0.02) z.c.splice(z.first ? 1 : z.c.length - 2, 1);
      if (kmXY(e, z.first ? z.c[1] : z.c[z.c.length - 2]) < 0.004) shortArm = true;
    }
    if (shortArm) continue;
    const xp2 = x.first ? x.c[1] : x.c[x.c.length - 2], yp2 = y.first ? y.c[1] : y.c[y.c.length - 2];
    if (angle(xp2, e, yp2) >= 170) continue;
    const a = toward(e, xp2), b = toward(e, yp2), n = 2 * Math.ceil(steps(a, e, b) / 2), half = n / 2;
    const xs = [], ys = [];   // 바깥(이웃 점 쪽)에서 가운데로
    for (let s = 0; s <= half; s++) { xs.push(bez(a, e, b, s / n)); ys.push(bez(b, e, a, s / n)); }
    if (x.first) x.c.splice(0, 1, ...xs.reverse()); else x.c.splice(x.c.length - 1, 1, ...xs);
    if (y.first) y.c.splice(0, 1, ...ys.reverse()); else y.c.splice(y.c.length - 1, 1, ...ys);
  }

}

/**
 * 고속도로 본선이 노선망에서 두 조각으로 끊기고 그 사이를 짧은 일반도로 링크가 잇는 곳(예: 평양희천고속도로 순안 부근
 * "순안거리" 300m)은 그 링크를 본선으로 이어 그린다: 양 끝 노드가 모두 본선 조각 하나씩에만 닿는(본선이 거기서 끝나는)
 * 1.5km 안쪽의 도로 링크로, 양쪽 본선이 이름이 같은 한 고속도로일 때. main 배열에서 그 링크를 1(본선)로 바꾼다.
 */
export function bridgeMainlineGaps(links, main) {
  const ends = new Map();   // 노드 → 닿은 본선 링크들
  links.forEach((l, i) => {
    if (!l || main[i] !== 1) return;
    for (const nd of [l.a, l.b]) { if (!ends.has(nd)) ends.set(nd, []); ends.get(nd).push(i); }
  });
  let n = 0;
  links.forEach((l, i) => {
    if (!l || l.mode !== 0 || l.cls === 'motorway' || l.cls === 'ferry' || l.ext || main[i] || !(l.len <= 1.5)) return;
    const ea = ends.get(l.a), eb = ends.get(l.b);
    // 양 끝에서 본선이 하나씩 끝나고, 그 둘이 이름이 같은 한 고속도로일 때만
    // (서로 다른 고속도로의 끝이나, 이름 없는 조각 사이의 동네 도로는 잇지 않는다)
    const na = links[ea?.[0]]?.name, nb = links[eb?.[0]]?.name;
    if (ea?.length === 1 && eb?.length === 1 && ea[0] !== eb[0] && na && na === nb) { main[i] = 1; n++; }
  });
  return n;
}

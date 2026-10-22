// 신규 역·IC·JCT 이름 자동 생성.
// 가장 가까운 지명(도시 > 읍 > 동·마을 순으로 가중)을 따고, 겹치면 방향 접두어(동·서·남·북)를 붙인다.

import { kmBetween } from '../sim/model.js';

const SUFFIX = { station: '역', IC: 'IC', JCT: 'JCT' };
const PLACE_WEIGHT = { city: 3, town: 2, suburb: 1.3, village: 1 };
const ADMIN_TAIL = /(특별자치시|특별자치도|특별시|광역시|직할시|노동자구|구역|시|군|구|읍|면|동|리)$/;

export class Namer {
  /**
   * @param {[string,string,number,number][]} places [이름, 종류, 경도, 위도]
   * @param {{name:string, kind:string}[]} existing 이미 쓰이는 이름
   */
  constructor(places, existing) {
    this.places = places;
    this.used = new Set();
    for (const e of existing) this.reserve(e.name, e.kind);
  }

  // 역과 IC는 이름 공간이 다르다 (서울역과 서울IC는 공존). IC와 JCT는 함께 본다.
  key(name, kind) { return (kind === 'station' ? 's:' : 'r:') + normalize(name); }
  reserve(name, kind) { this.used.add(this.key(name, kind)); }
  release(name, kind) { this.used.delete(this.key(name, kind)); }
  isUsed(name, kind) { return this.used.has(this.key(name, kind)); }

  /** 가까운 지명들 (도시 > 읍 > 동·마을 가중 거리순) */
  nearbyPlaces(lon, lat, maxKm = 20, limit = 6) {
    const out = [];
    for (const p of this.places) {
      if (Math.abs(p[2] - lon) > 0.3 || Math.abs(p[3] - lat) > 0.25) continue;
      const d = kmBetween(lon, lat, p[2], p[3]);
      if (d > maxKm) continue;
      out.push([d / (PLACE_WEIGHT[p[1]] ?? 1), p]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.slice(0, limit).map((x) => x[1]);
  }

  /**
   * 이름 후보: 가장 가까운 지명 → 방향 접두어(서평양 등) → 다음으로 가까운 지명 → 번호
   * @param {number} lon
   * @param {number} lat
   * @param {'station'|'IC'|'JCT'} kind
   */
  suggest(lon, lat, kind) {
    const suffix = SUFFIX[kind];
    const near = this.nearbyPlaces(lon, lat);
    const base = near.length ? stem(near[0][0]) : '신설';
    const candidates = [base + suffix];
    if (near.length) {
      const dir = bearingWord(near[0][2], near[0][3], lon, lat);
      if (dir) candidates.push(dir + base + suffix);
      // 대체 이름은 가까운 동네(동·읍·마을)부터: 멀리 있는 큰 도시 이름이 붙지 않도록
      const local = this.places.filter((p) => p[1] !== 'city' && Math.abs(p[2] - lon) < 0.06 && Math.abs(p[3] - lat) < 0.05)
        .map((p) => [kmBetween(lon, lat, p[2], p[3]), p]).filter(([d]) => d < 5).sort((x, y) => x[0] - y[0]);
      for (const [, p] of local) candidates.push(stem(p[0]) + suffix);
      for (const p of near.slice(1)) candidates.push(stem(p[0]) + suffix);
    }
    for (const c of candidates) if (!this.isUsed(c, kind)) return this.take(c, kind);
    for (let i = 2; i < 100; i++) {
      const c = `${base}${i}${suffix}`;
      if (!this.isUsed(c, kind)) return this.take(c, kind);
    }
    return this.take(`${base}${Date.now() % 1000}${suffix}`, kind);
  }

  take(name, kind) { this.reserve(name, kind); return name; }
}

export function stem(name) {
  const s = name.replace(/\s.*$/, '');
  const t = s.replace(ADMIN_TAIL, '');
  return t.length >= 2 ? t : s;
}

function normalize(n) {
  return n.replace(/\s/g, '').replace(/(역|IC|JCT|나들목|분기점|톨게이트|TG)$/i, '');
}

// 지명에서 본 지점의 방향. 가까우면 접두어를 붙이지 않는다.
function bearingWord(plon, plat, lon, lat) {
  const dx = (lon - plon) * Math.cos(plat * Math.PI / 180), dy = lat - plat;
  if (Math.hypot(dx, dy) * 111 < 1.5) return '';
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? '동' : '서';
  return dy > 0 ? '북' : '남';
}

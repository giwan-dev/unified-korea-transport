// 신규 역·IC·JCT 이름 자동 생성.
// 역은 곁의 기존 역(환승)·놓인 동 이름을 먼저 보고(stationHints), 없으면 가장 가까운 지명(도시 > 읍 > 동·마을 순으로 가중)을 따고,
// 겹치면 번호(○○2역)를 붙이지 않고 접두어·접미어로 가린다: 방향(서평양), 큰 도시 이름(평택지제·천안아산처럼), 신(신경주), 입구·중앙.

import { kmBetween } from '../sim/model.js';

const SUFFIX = { station: '역', IC: 'IC', JCT: 'JCT', rest: '휴게소' };
const PLACE_WEIGHT = { city: 3, town: 2, suburb: 1.3, village: 1 };
const ADMIN_TAIL = /(특별자치시|특별자치도|특별시|광역시|직할시|[노로]동자구|구역|시|군|구|읍|면|동|리)$/;

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
  key(name, kind) { return (kind === 'station' ? 's:' : kind === 'rest' ? 'h:' : 'r:') + normalize(name); }
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
   * 이름 후보: 가장 가까운 지명 → 방향 접두어(서평양 등) → 가까운 동네 이름 → 다음으로 가까운 지명
   * → 지명마다 도시 이름 접두어(평택지제)·다른 방향·신(新)·입구·중앙
   * @param {number} lon
   * @param {number} lat
   * @param {'station'|'IC'|'JCT'} kind
   */
  suggest(lon, lat, kind) {
    const suffix = SUFFIX[kind];
    // 역: 바로 곁(400m)의 다른 종류 기존 역 이름(환승역은 같은 이름), 그다음 역이 놓인 동·이웃 동 이름을 먼저 본다
    if (kind === 'station' && this.stationHints) {
      for (const h of this.stationHints(lon, lat)) {
        const c = stem(h.name).replace(/역$/, '') + suffix;
        if (h.sameStation || !this.isUsed(c, kind)) return this.take(c, kind);
      }
    }
    const near = this.nearbyPlaces(lon, lat);
    // fix: 행정구역 정리(선전용 지명·노동자구·두음법칙)를 지명에 적용 (북측 지명: 김책 → 성진)
    const st = (q) => (this.fix ? this.fix(stem(q[0]), q[2], q[3]) : stem(q[0]));
    const base = near.length ? st(near[0]) : '신설';
    const candidates = [base + suffix];
    if (near.length) {
      const dir = bearingWord(near[0][2], near[0][3], lon, lat);
      if (dir) candidates.push(dir + base + suffix);
      // 대체 이름은 가까운 동네(동·읍·마을)부터: 멀리 있는 큰 도시 이름이 붙지 않도록
      const local = this.places.filter((p) => p[1] !== 'city' && Math.abs(p[2] - lon) < 0.06 && Math.abs(p[3] - lat) < 0.05)
        .map((p) => [kmBetween(lon, lat, p[2], p[3]), p]).filter(([d]) => d < 5).sort((x, y) => x[0] - y[0]);
      for (const [, p] of local) candidates.push(st(p) + suffix);
      for (const p of near.slice(1)) candidates.push(st(p) + suffix);
    }
    for (const c of candidates) if (!this.isUsed(c, kind)) return this.take(c, kind);
    // 그래도 겹치면 붙임말로 가린다 (예전에는 ○○2역처럼 번호를 붙였다)
    const stems0 = new Set(candidates.map((c) => c.slice(0, c.length - suffix.length)));
    const city = near.find((p) => p[1] === 'city');
    const cityStem = city ? st(city) : '';
    // 이미 방향·신을 붙인 후보(서수원)는 다시 꾸미지 않는다 (동서수원·수원서수원이 되던 것)
    const stems = [...new Set(candidates.map((c) => c.slice(0, c.length - suffix.length)))].filter((b) => !(/^[동서남북신]/.test(b) && stems0.has(b.slice(1))));
    const decorate = (b) => [
      ...(cityStem && !b.includes(cityStem) ? [cityStem + b] : []),
      ...['동', '서', '남', '북'].map((d) => d + b),
      '신' + b, b + '입구', b + '중앙',
      ...(cityStem && !b.includes(cityStem) ? ['동', '서', '남', '북', '신'].map((d) => cityStem + d + b) : []),
    ];
    for (const b of stems) for (const c of decorate(b)) if (!this.isUsed(c + suffix, kind)) return this.take(c + suffix, kind);
    // 거의 일어나지 않는다: 가까운 두 동네 이름을 잇는다 (가좌·수색처럼)
    for (const a of stems) for (const b of stems) if (a !== b && !this.isUsed(a + b + suffix, kind)) return this.take(a + b + suffix, kind);
    return this.take(`신${cityStem}${base}${suffix}`, kind);
  }

  take(name, kind) { this.reserve(name, kind); return name; }
}

export function stem(name) {
  const s = name.replace(/\s.*$/, '');
  // 동 번호는 뗀다: 룡당2동 → 룡당, 장유1동 → 장유 (역 이름에 번호가 붙지 않게)
  const t = s.replace(ADMIN_TAIL, '').replace(/제?\d+(?:\.\d+)?가?$/, '');
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

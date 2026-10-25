// 새 노선 이름 짓기와 국외 구간 판정.

// 노선 이름에 쓰는 도시 약칭 (경부선·경의선·호남선처럼 관례적인 것). 없으면 첫 글자.
const ABBR = {
  서울: '경', 경성: '경', 부산: '부', 신의주: '의', 인천: '인', 원산: '원', 평양: '평', 대전: '전',
  목포: '목', 광주: '광', 강릉: '강', 춘천: '춘', 청주: '청', 대구: '대', 울산: '울', 포항: '포',
  함흥: '함', 청진: '청', 남포: '남', 개성: '개', 해주: '해', 나진: '나', 라선: '라', 혜산: '혜',
  사리원: '사', 만포: '만', 강계: '강', 김책: '김', 단둥: '단', 선양: '선', 블라디보스토크: '블',
  후쿠오카: '복', 오사카: '대', 도쿄: '동', 제주: '제',
};

// 전통 축 이름: 양 끝이 같은 축 위에 있으면 그 이름을 쓴다 (서울–평양 → 경의, 서울–원산 → 경원)
const CORRIDORS = [
  ['경의', ['서울', '고양', '파주', '개성', '개풍', '금천', '평산', '사리원', '황주', '평양', '숙천', '안주', '박천', '정주', '선천', '용천', '신의주']],
  ['경원', ['서울', '의정부', '양주', '동두천', '연천', '철원', '평강', '세포', '고산', '안변', '원산']],
  ['경부', ['서울', '성남', '수원', '오산', '평택', '천안', '세종', '대전', '옥천', '영동', '김천', '구미', '칠곡', '대구', '경산', '청도', '밀양', '양산', '부산']],
  ['호남', ['대전', '논산', '익산', '김제', '정읍', '장성', '광주', '나주', '무안', '목포']],
  ['경인', ['서울', '부천', '인천']],
  ['경춘', ['서울', '남양주', '가평', '춘천']],
  ['경강', ['서울', '하남', '양평', '원주', '평창', '강릉']],
  ['평라', ['평양', '순천', '양덕', '고원', '금야', '함흥', '신포', '북청', '단천', '김책', '길주', '청진', '회령', '나진', '라선']],
  ['동해', ['부산', '울산', '경주', '포항', '영덕', '울진', '삼척', '동해', '강릉', '속초', '고성', '통천', '원산']],
];

function corridorOf(a, b) {
  for (const [name, cities] of CORRIDORS) if (cities.includes(a) && cities.includes(b)) return name;
  return null;
}

const KIND = {
  hsr: '고속철도', rail: '선', rail1: '선', motorway: '고속도로', trunk: '국도', metro: '도시철도',
  tunnelRail: '해저고속철도', tunnelRoad: '해저고속도로',
};

/** 도시 이름 줄기: '서울특별시' → '서울', '선양' 그대로 */
export function cityStem(name) {
  return name.replace(/\s.*$/, '').replace(/(특별자치시|특별시|광역시|직할시|시|군|구|읍|면|동|리|역|공항)$/, '') || name;
}

function abbr(stem) {
  return ABBR[stem] ?? stem[0];
}

/**
 * 노선 이름을 지어 준다.
 * @param {string} type NEW_BUILDS 키
 * @param {string} from 시작 도시 이름
 * @param {string} to 끝 도시 이름
 * @param {Set<string>} used 이미 쓰는 노선 이름
 */
export function autoLineName(type, from, to, used) {
  const a = cityStem(from), b = cityStem(to);
  let base;
  if (type === 'metro' || type === 'lrt') {
    let n = 1;
    while (used.has(`${a} 도시철도 ${n}호선`)) n++;
    return `${a} 도시철도 ${n}호선`;
  }
  const corridor = a !== b ? corridorOf(a, b) : null;
  if (type === 'trunk') base = `${a}–${b} 국도`;
  else base = `${corridor ?? `${abbr(a)}${abbr(b)}`}${KIND[type] ?? '선'}`;
  if (!used.has(base)) return base;
  for (let n = 2; n < 10; n++) if (!used.has(`제${n}${base}`)) return `제${n}${base}`;
  return `${a}–${b} ${KIND[type] ?? '선'}`;
}

/** 점이 외국(중국·러시아·일본) 땅 위인지. data/base/world.geojson의 다각형으로 판정 */
export function makeForeignTest(worldFC) {
  const polys = [];
  for (const f of worldFC.features) {
    const g = f.geometry;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of list) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      polys.push({ rings, bbox: [x0, y0, x1, y1] });
    }
  }
  return (lon, lat) => polys.some(({ rings, bbox }) => lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
    && inRing(rings[0], lon, lat) && !rings.slice(1).some((h) => inRing(h, lon, lat)));
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

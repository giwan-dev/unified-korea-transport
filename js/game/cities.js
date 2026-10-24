// 지도에서 누르는 국외 도시·섬의 소개와 국기 (노드 패널). 국기는 윈도에서 이모지 국기가 글자로 보여 SVG로 그린다.

/** 나라: 패널에 쓰는 정식 이름과 국기 */
export const COUNTRIES = {
  KR: { name: '대한민국' },
  CN: { name: '중화인민공화국' },
  TW: { name: '중화민국' },
  JP: { name: '일본' },
  RU: { name: '러시아 연방' },
};

/** 도시 소개 (한두 문장) */
const INFO = {
  단둥: '압록강을 사이에 두고 신의주와 마주한 국경 도시입니다. 조중우의교로 철도·도로가 이어져 북중 교역의 대부분이 이곳을 지납니다.',
  선양: '랴오닝성의 성도이자 둥베이 지방 최대 도시입니다. 베이징·하얼빈·다롄으로 가는 고속철도가 모이는 교통 중심지입니다.',
  다롄: '랴오둥반도 끝의 항구 도시로, 둥베이 지방의 바다 관문입니다. 인천·평택과 여객선이 오갑니다.',
  창춘: '지린성의 성도로, 중국 자동차 산업과 영화 산업의 오랜 중심지입니다.',
  '옌지(연변)': '옌볜 조선족 자치주의 주도입니다. 조선족이 많이 살아 한국어 간판이 흔하고, 백두산 관광의 출발점입니다.',
  하얼빈: '헤이룽장성의 성도로 시베리아 횡단철도와 이어지는 북만주 철도의 중심입니다. 겨울 빙설제로 유명합니다.',
  베이징: '중화인민공화국의 수도입니다. 정치·문화의 중심이며, 단둥·선양을 거쳐 평양까지 국제열차가 다닙니다.',
  칭다오: '산둥반도의 항구 도시로, 한국 기업이 많이 진출해 있습니다. 인천·평택과 여객선이 오갑니다.',
  상하이: '중화인민공화국 최대의 경제 도시이자 세계적인 무역항입니다. 대한민국 임시정부 청사가 있던 곳이기도 합니다.',
  훈춘: '두만강 하구 가까이에서 북한·러시아와 국경을 맞댄 도시입니다. 나선과 도로로 이어집니다.',
  통화: '지린성 남부, 압록강 너머 자강도와 가까운 도시입니다. 고구려 유적이 있는 지안이 이 지역에 속합니다.',
  지린: '쑹화강 변의 도시로, 옛 지린성의 성도였습니다. 겨울 상고대(무빙) 풍경으로 알려져 있습니다.',
  무단장: '헤이룽장성 동남부의 도시로, 수이펀허를 거쳐 러시아 연해주로 가는 철도가 지납니다.',
  블라디보스토크: '러시아 연해주의 중심 도시이자 태평양 함대의 모항입니다. 시베리아 횡단철도의 동쪽 종착역이 있습니다.',
  우수리스크: '블라디보스토크 북쪽의 철도 교차점으로, 고려인 이주 역사의 중심지입니다.',
  하바롭스크: '아무르강 변의 극동 러시아 최대 도시 가운데 하나로, 시베리아 횡단철도가 지납니다.',
  후쿠오카: '규슈 최대 도시로, 부산과 고속선·여객선으로 몇 시간이면 닿는 가장 가까운 일본 대도시입니다.',
  오사카: '간사이 지방의 중심 도시입니다. 재일 한국인이 많이 사는 곳으로, 부산과 여객선이 오갑니다.',
  도쿄: '일본의 수도이자 세계 최대 규모의 도시권입니다.',
  나고야: '주부 지방의 중심 도시로, 자동차 산업이 발달했습니다.',
  삿포로: '홋카이도의 중심 도시로, 겨울 눈 축제로 유명합니다.',
  히로시마: '세토 내해에 면한 주고쿠 지방의 중심 도시입니다.',
  기타큐슈: '규슈 북쪽 끝의 공업 도시로, 시모노세키 해협을 사이에 두고 혼슈와 마주합니다.',
  '오키나와(나하)': '오키나와현의 현청 소재지로, 옛 류큐 왕국의 중심지였습니다.',
  타이베이: '중화민국의 수도입니다. 정치·경제의 중심이며, 타이베이 101과 고궁박물원으로 알려져 있습니다.',
  가오슝: '타이완 남부의 최대 항구 도시이자 중화민국 제2의 도시입니다.',
  독도: '경상북도 울릉군에 속한 대한민국의 동쪽 끝 섬입니다. 동도와 서도, 그 주변의 바위섬으로 이루어져 있으며, 울릉도에서 여객선이 오갑니다.',
};

/** 노드 패널 머리말: 분류 한 줄과 국기·소개 (해당 자료가 없으면 빈 문자열) */
export function placeIntroHTML(name, country) {
  const c = COUNTRIES[country];
  const info = INFO[name];
  if (!c && !info) return '';
  const label = country === 'KR' ? `${c.name}의 영토` : c ? `${c.name}의 도시` : '';
  return `<div class="place-intro">
    ${c ? `<div class="place-country">${flagSVG(country)}<b>${label}</b></div>` : ''}
    ${info ? `<p>${info}</p>` : ''}
  </div>`;
}

// ------------------------------------------------------------ 국기 (가로 3 : 세로 2)

function star(cx, cy, r, rot = -90) {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = ((rot + k * 36) * Math.PI) / 180, rr = k % 2 ? r * 0.382 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}

function taegukgi() {
  // 태극 (기울기 약 33.7°)과 네 괘
  const bars = (cx, cy, ang, pattern) => pattern.map((broken, k) => {
    const y = -1.5 + k * 1.5;
    const g = broken
      ? `<rect x="-3" y="${y - 0.5}" width="2.75" height="1"/><rect x="0.25" y="${y - 0.5}" width="2.75" height="1"/>`
      : `<rect x="-3" y="${y - 0.5}" width="6" height="1"/>`;
    return `<g transform="translate(${cx} ${cy}) rotate(${ang})">${g}</g>`;
  }).join('');
  return `<rect width="30" height="20" fill="#fff"/>
    <g transform="rotate(33.69 15 10)">
      <circle cx="15" cy="10" r="5" fill="#0047a0"/>
      <path d="M10 10 A5 5 0 0 1 20 10 A2.5 2.5 0 0 1 15 10 A2.5 2.5 0 0 0 10 10 Z" fill="#cd2e3a"/>
    </g>
    <g fill="#000">
      ${bars(6.4, 4.3, 33.69 + 90, [0, 0, 0])}
      ${bars(23.6, 15.7, 33.69 + 90, [1, 1, 1])}
      ${bars(23.6, 4.3, -33.69 + 90, [1, 0, 1])}
      ${bars(6.4, 15.7, -33.69 + 90, [0, 1, 0])}
    </g>`;
}

const FLAGS = {
  KR: taegukgi,
  CN: () => `<rect width="30" height="20" fill="#de2910"/><g fill="#ffde00">${star(5, 5, 3)}${star(10, 2, 1, -36)}${star(12, 4, 1, -66)}${star(12, 7, 1, -90)}${star(10, 9, 1, -120)}</g>`,
  TW: () => {
    const rays = [];
    for (let k = 0; k < 12; k++) {
      const a = (k * 30 * Math.PI) / 180, b = ((k * 30 + 15) * Math.PI) / 180, c = ((k * 30 - 15) * Math.PI) / 180;
      rays.push(`${(7.5 + 3.75 * Math.cos(a)).toFixed(2)},${(5 + 3.75 * Math.sin(a)).toFixed(2)} ${(7.5 + 2 * Math.cos(b)).toFixed(2)},${(5 + 2 * Math.sin(b)).toFixed(2)} ${(7.5 + 2 * Math.cos(c)).toFixed(2)},${(5 + 2 * Math.sin(c)).toFixed(2)}`);
    }
    return `<rect width="30" height="20" fill="#fe0000"/><rect width="15" height="10" fill="#000095"/>
      <g fill="#fff">${rays.map((r) => `<polygon points="${r}"/>`).join('')}</g>
      <circle cx="7.5" cy="5" r="2.1" fill="#000095"/><circle cx="7.5" cy="5" r="1.8" fill="#fff"/>`;
  },
  JP: () => '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/>',
  RU: () => '<rect width="30" height="20" fill="#d52b1e"/><rect width="30" height="13.33" fill="#0039a6"/><rect width="30" height="6.67" fill="#fff"/>',
};

export function flagSVG(country) {
  const f = FLAGS[country];
  return f ? `<svg class="flag" viewBox="0 0 30 20" width="30" height="20" role="img" aria-label="${COUNTRIES[country]?.name || country} 국기">${f()}</svg>` : '';
}

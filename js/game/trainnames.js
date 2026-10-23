// 열차 이름 체계: 계통의 열차 종류·등급·운영사·지나는 나라로 실제 열차 이름(브랜드)을 붙인다.
// 남측(코레일·통합 공사): KTX·KTX-산천·KTX-이음·SRT·ITX-새마을·ITX-마음·새마을호·무궁화호·누리로
// 북측 KPRail(합병 전): 급행·보통열차 / 일본: 신칸센 노조미·히카리·고다마 / 중국: 复兴号·和谐号 / 러시아: 로시야호·라스토치카
// 자동으로 다니는 기본 보통열차는 무궁화호(고속선은 KTX)다.

/**
 * @param {object} s {type, kind, cls, km, stops?: 정차역 이름들, conv?: 일반 선로를 지나는지, op?: 'korail'|'kprail'|'merged', country?: 'JP'|'CN'|'RU'}
 * @returns {{name:string, short:string}}
 */
export function trainBrand(s) {
  const kind = s.kind || 'local';
  if (s.country === 'JP') {
    const n = kind === 'limited' ? '노조미' : kind === 'express' ? '히카리' : '고다마';
    return { name: `신칸센 ${n}`, short: n };
  }
  if (s.country === 'CN') return s.type === 'hsr' || s.cls === 'hsr' ? { name: '复兴号 (푸싱호)', short: '复兴号' } : { name: '和谐号 (허셰호)', short: '和谐号' };
  if (s.country === 'RU') return (s.km || 0) > 500 ? { name: '로시야호', short: '로시야호' } : { name: '라스토치카', short: '라스토치카' };
  if (kind === 'commuter') return { name: '광역전철', short: '광역전철' };
  if (s.op === 'kprail') {
    const n = s.type === 'hsr' || s.cls === 'hsr' ? '고속열차' : kind === 'limited' ? '특급열차' : kind === 'express' ? '급행열차' : '보통열차';
    return { name: n, short: n };
  }
  const t = s.type || (s.cls === 'hsr' ? 'hsr' : 'auto');
  let n;
  if (t === 'hsr') n = (s.stops || []).includes('수서') ? 'SRT' : s.conv ? 'KTX-산천' : 'KTX';
  else if (t === 'semi') n = 'KTX-이음';
  else if (t === 'intercity') n = kind === 'limited' ? 'ITX-새마을' : kind === 'express' || (s.km || 0) < 150 ? 'ITX-마음' : '무궁화호';
  else if (t === 'commuter') n = kind === 'local' ? '누리로' : '광역전철';
  else if (t === 'diesel') n = kind === 'limited' ? '새마을호' : '무궁화호';
  else n = s.cls === 'metro' ? '도시철도' : '무궁화호';
  return { name: n, short: n };
}

/** 자동으로 다니는 기본 열차 이름 (모든 역 정차) */
export function autoBrand(cls, op, country) {
  if (cls === 'metro') return '도시철도';
  if (country) return trainBrand({ cls, kind: 'local', country }).short;
  if (op === 'kprail') return cls === 'hsr' ? '고속열차' : '보통열차';
  return cls === 'hsr' ? 'KTX' : '무궁화호';
}

/** "도쿄발 서울행 노조미" */
export function trainTitle(from, to, brand) {
  return `${from}발 ${to}행 ${brand}`;
}

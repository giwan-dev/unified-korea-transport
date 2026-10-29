// 대학: 목록·순위·재정 투입·신설.
import { formatWon, KP_COST_FACTOR } from '../game/catalog.js';
import { isMetroCity, regionOf } from '../game/local.js';
import { stem } from '../game/naming.js';
import { canAfford, isKP, save, startProject } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { toast } from '../ui/panel.js';
import { base, draft, esc, map, namer, result, selection, state, zoneProps } from './core.js';
import { zoneName } from './year.js';
import { hallList } from './region.js';
import { cancelDraft } from './draw.js';
import { renderAll } from './panels.js';
import { renderStats } from './budget.js';
import { renderSelection } from './econ.js';
import { startedNotice } from './plans.js';
import { onLand } from './straighten.js';
import { header } from './svcmap.js';
import { zoneAtPoint } from './transfer.js';

// ------------------------------------------------------------ 대학 (data/universities.json, 게임에서 세운 대학)

export let univs = [];
export function setUnivs(v) { return (univs = v); }
export let showUnivs = true;
export function setShowUnivs(v) { return (showUnivs = v); }
try { showUnivs = localStorage.getItem('ukt-univs') !== '0'; } catch { /* 기본은 켬 */ }
export const UNIV_SEATS = { univ: 10000, college: 4000 };

// ------------------------------------------------------------ 대학 순위·재정 투입
/**
 * 대학 평판 바탕값 (0~100, 게임 가정값): 순위의 출발점. 해마다 재정 투입(최대 +15)과, 북측 대학은 남북 통합도(최대 +8)를 따라 오른다.
 * 표에 없는 대학은 이름으로(국립·교육대학교 70, 과학기술원 85) 또는 남 66 · 북 58
 */
export const UNIV_REP = {
  서울대학교: 100, 한국과학기술원: 97, 포항공과대학교: 95, 연세대학교: 95, 고려대학교: 94, 성균관대학교: 91, 한양대학교: 89, 서강대학교: 88,
  울산과학기술원: 88, 광주과학기술원: 86, 대구경북과학기술원: 86, 중앙대학교: 86, 경희대학교: 85, 이화여자대학교: 85, 한국외국어대학교: 84,
  서울시립대학교: 84, 부산대학교: 82, 건국대학교: 82, 동국대학교: 82, 경북대학교: 81, 홍익대학교: 81, 인하대학교: 81, 아주대학교: 80,
  숙명여자대학교: 79, 전남대학교: 78, 국민대학교: 78, 숭실대학교: 78, 충남대학교: 77, 세종대학교: 77, 가톨릭대학교: 77, 서울과학기술대학교: 77,
  전북대학교: 76, 광운대학교: 76, 단국대학교: 76, 인천대학교: 75, 한국항공대학교: 75, 한국교원대학교: 75, 한국기술교육대학교: 75,
  충북대학교: 74, 강원대학교: 74, 부경대학교: 74, 가천대학교: 74, 경상국립대학교: 73, 영남대학교: 73, 명지대학교: 73, 상명대학교: 72,
  서울여자대학교: 72, 성신여자대학교: 72, 제주대학교: 71, 동아대학교: 71, 계명대학교: 70, 경기대학교: 70, 동덕여자대학교: 70, 덕성여자대학교: 70,
  김일성종합대학: 80, 김책공업종합대학: 78, 리과대학: 75, 평양의학대학: 72, 평양과학기술대학: 72, 평양외국어대학: 70, 김형직사범대학: 68,
  인민경제대학: 66, 평양건축종합대학: 66, 평양철도종합대학: 64, 고려성균관대학: 62,
};
/** 분교 (법적으로 따로인 캠퍼스): 순위를 따로 센다. 그 밖의 여러 캠퍼스는 이원화 캠퍼스로 본교와 함께 센다 */
export const UNIV_BRANCH = [/^고려대학교 세종/, /^연세대학교 (미래|원주)/, /^동국대학교$/, /^건국대학교 글로컬/, /^한양대학교 ERICA/, /^홍익대학교 세종/];
export const UNIV_FUNDS = [0, 50, 100, 300, 500, 1000, 3000, 5000, 10000];   // 연 재정 투입 바로 고르기 (억원). 그 밖의 금액도 직접 넣는다 (위 한도 없음)
// 효과는 대학 크기(정원)에 맞춰 잰다: 정원 1만 명 대학이면 500억이 한 단위. 평판은 투입이 늘수록 로그로 계속 오르고(한도 없이 체감),
// 평판 점수는 120점에서 멈춘다. 교육 효과는 정원 상당 최대 +100%까지
export const univFundUnit = (seats) => 500 * Math.max(0.3, (seats || 10000) / 10000);
export const univFundBonus = (f, seats) => 9 * Math.log1p(f / univFundUnit(seats));
export const univFundShare = (f, seats) => 1 - Math.exp(-f / (2 * univFundUnit(seats)));
export const UNIV_SCORE_MAX = 120;
export const UNIV_NEW_FUND_YEARS = 5;
/** 최대 투입: 교육 효과가 95% 차는 금액 (한 단위의 6배, 백억 단위) */
export const univMaxFund = (seats) => Math.round((6 * univFundUnit(seats)) / 100) * 100;
export let univRankAll = false;
export function setUnivRankAll(v) { return (univRankAll = v); }
export const univPicked = new Set();   // 통계 탭 대학 순위에서 함께 고른 대학 (여러 대학에 한꺼번에 재정 투입)
export let univPickAmt = 100;
export function setUnivPickAmt(v) { return (univPickAmt = v); }

/** 순위를 세는 단위: 대학(이원화 캠퍼스는 함께)·분교·게임에서 세운 대학 */
export function univEntries() {
  const m = new Map();
  for (const u of univList()) {
    if (!u.built) continue;
    const orig = u.orig || u.name, fam = orig.split(' ')[0];
    const branch = !u.isNew && UNIV_BRANCH.some((rx) => rx.test(orig));
    const key = u.isNew ? u.key : branch ? `${fam}|분교` : fam;
    if (!m.has(key)) {
      const famRep = UNIV_REP[fam] ?? (/과학기술원$/.test(fam) ? 85 : /^국립|교육대학교$/.test(fam) ? 70 : u.country === 'KP' ? 58 : 66);
      const base = u.isNew ? ({ comp: 60, kaist: 72, branch: 55 }[u.kind] ?? 60) : branch ? famRep - 12 : famRep;
      const shown = u.name.split(' ')[0];
      const name = u.isNew ? u.name : branch ? `${u.name.includes(' ') ? u.name : `${u.name} ${stem(zoneName(u.zone))}캠퍼스`} (분교)` : shown;
      m.set(key, { key, name, base, branch, campuses: [], seats: 0, country: u.country || zoneProps[u.zone]?.country, zone: u.zone });
    }
    const e = m.get(key);
    e.campuses.push(u); e.seats += u.seats;
  }
  const out = [...m.values()];
  for (const e of out) {
    e.score = state.univScore?.[e.key] ?? e.base;
    // 본교 캠퍼스(지역·바로가기): 관악·신촌, 대학 이름 그대로인 곳(KAIST 대전), 서울캠퍼스·인문 등, 아니면 사람이 가장 많은 시군의 캠퍼스
    // (서울대학교라는 이름만 붙은 점은 세종의 시설이라 관악캠퍼스를 먼저)
    const nm = (c) => c.orig || c.name;
    e.main = e.campuses.find((c) => /관악|신촌/.test(nm(c))) || e.campuses.find((c) => nm(c) === e.key) || e.campuses.find((c) => /서울캠퍼스|인문|본교/.test(nm(c)))
      || e.campuses.reduce((x, y) => (zoneProps[y.zone].pop > zoneProps[x.zone].pop ? y : x));
    e.zone = e.main.zone;
  }
  out.sort((a, b) => b.score - a.score || b.seats - a.seats);
  out.forEach((e, k) => { e.rank = k + 1; });
  return out;
}

/** 재정 투입이 교육 효과로: 넣은 대학 캠퍼스마다 정원의 최대 50%를 '새 정원'처럼 친다 */
export function univFundSeats() {
  const F = state.univFund || {};
  if (!Object.keys(F).length) return [];
  return univEntries().flatMap((e) => (F[e.key] ? e.campuses.map((c) => [c.zone, Math.round(c.seats * univFundShare(F[e.key], e.seats)), 1]) : []));
}

/** 해마다: 재정 투입을 예산에서 내고, 평판을 목표(바탕 + 재정 + 북측은 통합도)로 15%씩 다가가게 */
export function univYear() {
  const F = state.univFund || {};
  // 기한을 둔 투입(신설 대학 5년)이 끝났으면 멈춘다
  for (const [k, y] of Object.entries(state.univFundUntil || {})) {
    if (state.year < y) continue;
    delete state.univFundUntil[k];
    if (F[k]) { delete F[k]; state.log.unshift(`${state.year}년 ${univEntries().find((x) => x.key === k)?.name || '대학'} 개교 재정 투입 끝 (${UNIV_NEW_FUND_YEARS}년)`); }
  }
  let total = 0;
  for (const e of univEntries()) {
    const f = F[e.key] || 0;
    total += f;
    const target = Math.min(UNIV_SCORE_MAX, e.base + univFundBonus(f, e.seats) + (e.country === 'KP' ? 8 * (state.integration || 0) : 0));
    (state.univScore ||= {})[e.key] = Math.round((e.score + 0.15 * (target - e.score)) * 10) / 10;
  }
  if (total) {
    state.budget -= total;
    if (state.budget < 0) { state.debt += -state.budget; state.budget = 0; }
    state.log.unshift(`${state.year}년 대학 재정 투입: ${formatWon(total)}`);
  }
}

/** 대학 창: 순위와 재정 투입 */
/**
 * 과학기술원 영문 약자: 지명 첫 글자(로마자) + IST. 두 지명을 붙인 이름은 둘의 첫 글자 (대구경북 → DGIST).
 * 실제로 있는 곳은 그 약자 (KAIST·GIST·DGIST·UNIST)
 */
export const KAIST_REAL = { 한국: 'KAIST', 광주: 'GIST', 대구경북: 'DGIST', 울산: 'UNIST' };
export function kaistAcronym(name) {
  const st = name.replace(/과학기술원.*$/, '').replace(/^제\d+/, '');
  if (KAIST_REAL[st]) return KAIST_REAL[st];
  const INI = ['G', 'K', 'N', 'D', 'T', 'R', 'M', 'B', 'P', 'S', 'S', '', 'J', 'J', 'C', 'K', 'T', 'P', 'H'];
  const MED = ['A', 'A', 'Y', 'Y', 'E', 'E', 'Y', 'Y', 'O', 'W', 'W', 'O', 'Y', 'U', 'W', 'W', 'W', 'Y', 'E', 'U', 'I'];
  const rom = (ch) => {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) return '';
    const i = Math.floor(c / 588);
    return INI[i] || MED[Math.floor((c % 588) / 28)];
  };
  const chars = [...st];
  const picks = chars.length >= 4 ? [chars[0], chars[2]] : [chars[0]];
  return `${picks.map(rom).join('')}IST`;
}

export function univRankHTML(u) {
  if (!u.built) {
    const proj = state.projects.find((p) => p.kind === 'univ' && p.status === 'building' && `n${p.id}` === u.key);
    const f = univMaxFund(u.seats), all = univEntries();
    const base = { comp: 60, kaist: 72, branch: 55 }[u.kind] ?? 60, rank = all.filter((e) => e.score > base).length + 1;
    return `<h4>설립·순위·재정</h4>
    <table class="kv">
      <tr><td>개교 예정</td><td>${proj ? `${proj.doneYear}년 (착공 ${proj.startYear}년, 사업비 ${formatWon(proj.cost)})` : '설립 중'}</td></tr>
      <tr><td>개교 때 평판·순위 (어림)</td><td>${base}점 · 지금 기준 전국 ${rank}위 / ${all.length + 1}곳</td></tr>
      <tr><td>개교 뒤 재정 투입</td><td>연 ${formatWon(f)} × ${UNIV_NEW_FUND_YEARS}년 (최대, 합계 ${formatWon(f * UNIV_NEW_FUND_YEARS)})</td></tr>
    </table>`;
  }
  const all = univEntries(), e = all.find((x) => x.campuses.some((c) => c.key === u.key));
  if (!e) return '';
  const f = state.univFund?.[e.key] || 0;
  return `<h4>순위·재정 투입</h4>
    <table class="kv">
      <tr><td>평판</td><td>${e.score.toFixed(1)}점 · 전국 ${e.rank}위 / ${all.length}곳</td></tr>
      <tr><td>순위 단위</td><td>${esc(e.name)}${e.branch ? ' · 분교로 따로 셈' : e.campuses.length > 1 ? ` · 캠퍼스 ${e.campuses.length}곳 함께 셈 (이원화)` : ''}</td></tr>
    </table>
    <div class="name-row"><span>연 재정 투입 (억원)</span><input type="number" id="univ-fund" data-key="${esc(e.key)}" class="small" min="0" step="50" value="${f}" list="univ-fund-list" style="width:110px">
      <datalist id="univ-fund-list">${UNIV_FUNDS.map((v) => `<option value="${v}">${v ? formatWon(v) : '없음'}</option>`).join('')}</datalist></div>
    ${state.univFundUntil?.[e.key] ? `<p class="hint">개교 재정 투입 중: ${state.univFundUntil[e.key]}년까지 연 ${formatWon(f)} (직접 바꾸면 기한 없이 그 금액으로)</p>` : ''}
    <p class="hint">금액은 한도 없이 정합니다. 효과는 대학 크기에 맞춰 잽니다(이 대학은 ${formatWon(Math.round(univFundUnit(e.seats)))}이 한 단위): 지금 금액이면 평판 목표 +${univFundBonus(f, e.seats).toFixed(1)}점(투입이 늘수록 덜 오름, 평판은 ${UNIV_SCORE_MAX}점까지, 해마다 15%씩 다가감), 둘레 시군 교육 효과 정원 상당 +${Math.round(univFundShare(f, e.seats) * 100)}%. 해마다 예산에서 나갑니다.${e.country === 'KP' ? ' 북측 대학은 남북 통합도가 오를수록 평판이 따라 오릅니다.' : ''}</p>`;
}

/** 통계 탭: 대학 순위 (상위 20, 펼쳐 보기) */
export function univRankTable() {
  const all = univEntries();
  if (!all.length) return '';
  const F = state.univFund || {}, total = Object.values(F).reduce((s, v) => s + v, 0);
  const rows = (univRankAll ? all : all.slice(0, 20)).map((e) => `<tr><td><input type="checkbox" data-univ-pick="${esc(e.key)}" ${univPicked.has(e.key) ? 'checked' : ''}> ${e.rank}</td>
    <td><a href="#" data-univ-go="${esc(e.main.key)}">${esc(e.name)}</a>${!e.branch && e.campuses.length > 1 ? ` <span class="m">캠퍼스 ${e.campuses.length}</span>` : ''}</td>
    <td class="m">${esc(regionOf(state, zoneProps[e.zone]))}</td><td>${e.score.toFixed(1)}</td><td>${F[e.key] ? formatWon(F[e.key]) : ''}</td></tr>`).join('');
  return `<h3 style="margin-top:16px">대학 순위</h3>
    <table class="cmp"><tr><th><input type="checkbox" data-univ-pick-all title="보이는 대학 모두 고르기"> 순위</th><th>대학</th><th>지역</th><th>평판</th><th>재정/년</th></tr>${rows}</table>
    <div class="name-row" style="margin-top:6px;flex-wrap:wrap;gap:6px"><span>고른 대학 <b data-univ-pick-n>${univPicked.size}</b>곳에 연</span>
      <input type="number" data-univ-pick-amt class="small" min="0" step="50" value="${univPickAmt}" style="width:100px"><span>억원</span>
      <button class="small primary" data-univ-pick-apply>재정 투입</button><button class="small" data-univ-pick-max title="대학마다 교육 효과가 거의 다 차는 금액">대학마다 최대로</button><button class="small" data-univ-pick-clear>고른 대학 투입 끄기</button></div>
    ${all.length > 20 ? `<button class="small" data-univ-more>${univRankAll ? '상위 20곳만 보기' : `전체 보기 (${all.length}곳)`}</button>` : ''}
    <p class="hint">평판은 게임 속 가정값에서 출발해 재정 투입과(북측은) 남북 통합도를 따라 해마다 오르내립니다. 분교(고려대 세종·연세대 미래·동국대 경주·건국대 글로컬·한양대 ERICA·홍익대 세종)는 따로, 이원화 캠퍼스는 본교와 함께 셉니다.${total ? ` 재정 투입 합계 연 ${formatWon(total)}.` : ''}</p>`;
}   // 정원 어림 (OSM에 없다): 4년제 1만, 전문대·단과대 4천
/** 기존 대학 정원 어림: 북측은 종합대학만 1만, 나머지 단과대학(교원·사범·농업대학 등)은 3천 */
export const univSeats = (u) => (u.c === 'KP' ? (/종합대학/.test(u.n) ? 10000 : 3000) : UNIV_SEATS[u.k] || UNIV_SEATS.univ);
export const UNIV_TYPES = {
  comp: { label: '종합대학', seats: 20000, cost: 8000, years: 6 },
  kaist: { label: '과학기술원', seats: 5000, cost: 5000, years: 5 },
  branch: { label: '국립대 분교·캠퍼스', seats: 5000, cost: 2000, years: 3 },
};
// 북측 대학 이름의 인물 (지도자·가족·혁명가): 개칭 사업으로 지명 이름으로 바꾼다
export const UNIV_PERSONS = ['김일성', '김정일', '김정은', '김정숙', '김형직', '김형권', '김철주', '김보현', '강반석', '김책', '김원균', '리수덕', '조군실', '차광수', '김종태', '최현', '오중흡', '리계순', '한덕수'];
export const UNIV_RENAME = { cost: 100, years: 1, bonus: 2 };

/** 모든 대학: [{key, name, lon, lat, zone, kind, seats, built, isNew, idx}] */
export function univList() {
  const out = univs.map((u, i) => ({ key: `b${i}`, idx: i, orig: u.n, name: state.univNames?.[u.n] || u.n, lon: u.x, lat: u.y, zone: u.z, kind: u.k,
    seats: univSeats(u), built: true, isNew: false, country: u.c }));
  for (const u of state.univNew || []) out.push({ key: `n${u.id}`, name: u.name, lon: u.lon, lat: u.lat, zone: u.zone, kind: u.type, seats: u.seats, built: !!u.done, isNew: true });
  return out;
}

/** 인물 이름이 든 북측 대학의 바꿀 이름: 인물 이름을 빼고, 지명이 없으면 소재 도시 이름을 앞에 (김일성종합대학 → 평양종합대학) */
export function univPersonRename(u) {
  const p = UNIV_PERSONS.find((x) => u.name.includes(x));
  if (!p || u.country !== 'KP') return null;
  let rest = u.name.replace(p, '');
  const city = stem(zoneProps[u.zone]?.province?.match(/시$/) ? zoneProps[u.zone].province : zoneProps[u.zone]?.name || '');
  if (!rest.startsWith(city) && !/^(평양|남포|원산|함흥|청진|신의주|해주|사리원|개성|강계|혜산|평성|순천|라선|김책|단천|송림|안주)/.test(rest)) rest = city + rest;
  return rest;
}

/**
 * 선전용 인물 이름이 든 북측 대학(김일성종합대학 등)을 지명 이름으로 한꺼번에 (2026년 통일 첫해에 한 번, 예전 저장은 불러올 때 한 번).
 * 하나씩 돈 들여 바꾸던 '이름 되돌리기'는 그대로 남는다 (이미 바꾼 대학은 뜨지 않는다)
 */
export function fixPropagandaUnivs() {
  if (!state?.local || !zoneProps || !univs?.length || state.univPropagandaDone) return;
  let n = 0;
  for (const u of univList()) {
    if (u.isNew || u.name !== u.orig) continue;
    const to = univPersonRename(u);
    if (!to) continue;
    (state.univNames ||= {})[u.orig] = to;
    n++;
  }
  state.univPropagandaDone = true;
  if (n) state.log.unshift(`${state.year}년 선전용 인물 이름이 든 북측 대학 ${n}곳을 지명 이름으로 일괄 변경 (예: ${univPersonRename({ ...univList().find((u) => state.univNames[u.orig] && u.orig !== state.univNames[u.orig]), name: '' }) || ''})`);
}

export function drawUnivs() {
  if (!map?.getSource('links')) return;
  if (!map.getSource('univs')) {
    map.addSource('univs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'univs-dot', type: 'circle', source: 'univs', minzoom: 7.5,
      paint: { 'circle-radius': ['case', ['==', ['get', 'kind'], 'college'], 3, 4], 'circle-color': ['case', ['get', 'built'], '#2e7d4f', '#ffffff'], 'circle-stroke-color': '#1b5e20', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'univs-label', type: 'symbol', source: 'univs', minzoom: 10,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': '#1b5e20', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } });
    for (const l of ['univs-dot']) {
      map.on('mouseenter', l, () => { if (!draft) map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', l, () => { if (!draft) map.getCanvas().style.cursor = ''; });
    }
  }
  for (const l of ['univs-dot', 'univs-label']) map.setLayoutProperty(l, 'visibility', showUnivs ? 'visible' : 'none');
  map.getSource('univs').setData({ type: 'FeatureCollection', features: univList().map((u) => ({ type: 'Feature',
    properties: { key: u.key, name: u.built ? u.name : `${u.name} (설립 중)`, kind: u.kind, built: u.built }, geometry: { type: 'Point', coordinates: [u.lon, u.lat] } })) });
}

export function univPanel(key) {
  const u = univList().find((x) => x.key === key);
  if (!u) return header('대학');
  const kindLabel = u.isNew ? UNIV_TYPES[u.kind]?.label : u.kind === 'college' ? '전문대·단과대학' : '대학교';
  const to = !u.isNew && u.name === u.orig ? univPersonRename(u) : null;
  const proj = state.projects.find((p) => p.kind === 'univRename' && p.univName === u.orig && p.status === 'building');
  const edu = result?.zones?.edu?.[u.zone];
  return `${header(u.name)}
    <table class="kv">
      <tr><td>소재</td><td>${esc(regionOf(state, zoneProps[u.zone]))} ${esc(zoneName(u.zone))}</td></tr>
      <tr><td>종류</td><td>${esc(kindLabel || '')}${u.isNew ? ' · 게임에서 세움' : ''}</td></tr>
      <tr><td>정원 (어림)</td><td>${u.seats.toLocaleString()}명</td></tr>
      ${u.built ? '' : '<tr><td>상태</td><td>설립 중</td></tr>'}
      ${edu ? `<tr><td>새 대학·재정 효과 (이 시군)</td><td>기대 교육연수 목표 +${edu.toFixed(2)}년</td></tr>` : ''}
    </table>
    ${univRankHTML(u)}
    ${to ? `<h4>이름 되돌리기</h4><p class="hint">인물 이름이 든 대학을 지명 이름으로 바꿉니다: <b>${esc(to)}</b>. 교표·문서·간판을 바꾸는 데 예산이 들고, 끝나면 그 시군 주민 행복도가 오릅니다.</p>
      ${proj ? `<p class="hint">${proj.doneYear}년 완료 예정</p>` : `<button class="small primary" data-univ-restore="${u.idx}">이름 되돌리기 · ${formatWon(UNIV_RENAME.cost)} · ${UNIV_RENAME.years}년 · 행복도 +${UNIV_RENAME.bonus}</button>`}` : ''}
    <h4>이름 바꾸기</h4>
    <div class="name-row"><input type="text" id="univ-name" value="${esc(u.name)}"><button class="small" id="univ-rename">바꾸기</button></div>
    <p class="hint">새 대학을 세우면 90분 안팎에 닿는 시군의 교육 수준(기대·평균 교육연수, HDI)이 오르고 청년이 조금 모입니다. 건설 탭의 '대학 설립'으로 세웁니다.</p>`;
}

export function bindUnivPanel(el) {
  el.querySelector('#univ-fund')?.addEventListener('change', (e) => {
    const k = e.target.dataset.key, v = Math.max(0, Math.round(+e.target.value || 0));
    delete state.univFundUntil?.[k];
    if (v) (state.univFund ||= {})[k] = v; else if (state.univFund) delete state.univFund[k];
    state.log.unshift(`${state.year}년 ${univEntries().find((x) => x.key === k)?.name || '대학'} 재정 투입: 연 ${formatWon(v)}`);
    save(state); renderSelection(); renderStats();
  });
  el.querySelector('#univ-rename')?.addEventListener('click', () => {
    const key = selection.id, v = el.querySelector('#univ-name').value.trim();
    if (!v) return;
    if (key.startsWith('b')) (state.univNames ||= {})[univs[+key.slice(1)].n] = v;
    else { const u = (state.univNew || []).find((x) => `n${x.id}` === key); if (u) u.name = v; }
    save(state); drawUnivs(); renderSelection();
  });
  el.querySelector('[data-univ-restore]')?.addEventListener('click', (e) => {
    const i = +e.currentTarget.dataset.univRestore, u = univList().find((x) => x.idx === i), to = univPersonRename(u);
    if (!to || !canAfford(state, UNIV_RENAME.cost, UNIV_RENAME.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
    startProject(state, { id: crypto.randomUUID(), kind: 'univRename', univName: u.orig, to, links: [], stations: [], cost: UNIV_RENAME.cost, years: UNIV_RENAME.years, label: `${u.name} → ${to} 개칭` });
    save(state); renderAll();
  });
}

/** 완공: 새 대학 개교, 대학 개칭 */
export function settleUniv(done) {
  for (const p of done) {
    if (p.kind === 'univ') {
      const u = (state.univNew || []).find((x) => x.id === p.id);
      if (!u || u.done) continue;
      u.done = true;
      state.happyBonus[u.zone] = (state.happyBonus[u.zone] || 0) + 2;
      state.log.unshift(`${state.year}년 ${u.name} 개교 (정원 ${u.seats.toLocaleString()}명): 둘레 시군의 교육 수준이 오릅니다`);
      // 새 대학은 개교 뒤 5년간 최대 재정을 넣는다 (교육 효과가 거의 다 차는 금액): 끝나면 저절로 멈추고, 대학 창에서 바꿀 수 있다
      const key = `n${u.id}`, f = univMaxFund(u.seats);
      (state.univFund ||= {})[key] = f;
      (state.univFundUntil ||= {})[key] = state.year + UNIV_NEW_FUND_YEARS;
      state.log.unshift(`${state.year}년 ${u.name} 개교 재정 투입: 연 ${formatWon(f)}, ${UNIV_NEW_FUND_YEARS}년간`);
    } else if (p.kind === 'univRename') {
      const key = p.univName ?? univs[p.univ]?.n;
      if (key) (state.univNames ||= {})[key] = p.to;
      const z = univs.find((u) => u.n === key)?.z;
      if (z != null) state.happyBonus[z] = (state.happyBonus[z] || 0) + UNIV_RENAME.bonus;
      state.log.unshift(`${state.year}년 대학 개칭 완료: ${p.label.replace(/ 개칭$/, '')}`);
    }
  }
  if (done.some((p) => p.kind === 'univ' || p.kind === 'univRename')) drawUnivs();
}

/**
 * 광역 단체 이름 줄임 (대학 이름용): 황해남도 → 황남, 평안북도 → 평북, 충청남도 → 충남, 경기도 → 경기, 강원특별자치도 → 강원,
 * 북측 강원(강원북도) → 북강원, 평양광역시 → 평양
 */
export function regionAbbr(r) {
  if (r === '강원북도') return '북강원';
  if (r === '강원남도') return '강원';
  const m = r.match(/^(.)[^남북]*(남|북)도$/);
  if (m) return m[1] + m[2];
  const t = r.replace(/(특별자치도|특별자치시|특별시|광역시|직할시|통합특별시)$/, '');
  if (t !== r) return stem(t) || t;
  return r.replace(/도$/, '').replace(/시$/, '');
}

// 대학 설립: 지도에서 자리를 누르면 종류를 고르는 창
export let univPick = false;
export function startUnivPick() {
  cancelDraft();
  univPick = true;
  map.getCanvas().style.cursor = 'crosshair';
  toast('대학을 세울 자리를 지도에서 누르세요 (Esc: 취소).');
  const esc_ = (e) => { if (e.key === 'Escape') { univPick = false; map.getCanvas().style.cursor = ''; document.removeEventListener('keydown', esc_); } };
  document.addEventListener('keydown', esc_);
}
export function univPickClick(ll) {
  univPick = false;
  map.getCanvas().style.cursor = '';
  const zi = onLand(ll.lng, ll.lat) ? zoneAtPoint(ll.lng, ll.lat) : -1;
  if (!(zi >= 0) || zoneProps[zi].ext) { toast('남북 땅 안을 누르세요.'); return; }
  const place = namer?.nearbyPlaces(ll.lng, ll.lat, 8, 1)[0];
  const base0 = place ? stem(place[0]) : stem(zoneName(zi));
  const used = new Set(univList().map((u) => u.name));
  // 이름 후보: 도 이름 줄임(충남대학교·경북대학교처럼 황남대학교·평북대학교), 지명, 국립 지명. 아직 쓰이지 않은 첫 후보가 기본
  const prov = regionAbbr(regionOf(state, zoneProps[zi]));
  const cands = [...new Set([`${prov}대학교`, `${base0}대학교`, `국립${base0}대학교`, `국립${prov}대학교`])].filter((n) => !used.has(n));
  const nm = cands[0] || `${base0}${prov}대학교`;
  // 과학기술원은 도시 이름 (광주·대구경북·울산과학기술원처럼): 광역시면 그 이름, 시면 시 이름, 군이면 가까운 지명
  const rg = regionOf(state, zoneProps[zi]), zn = zoneName(zi);
  const city = isMetroCity(rg) ? regionAbbr(rg) : /시$/.test(zn) ? stem(zn) : base0;
  const kaistName = [`${city}과학기술원`, `${city}${prov}과학기술원`, `${prov}과학기술원`].find((n) => !used.has(n)) || `제2${city}과학기술원`;
  const kp = isKP(ll.lat, ll.lng);
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true"><h2>대학 설립 · <input type="text" id="u-name" value="${esc(nm)}" list="u-names" style="font:inherit;width:11em"><datalist id="u-names">${cands.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></h2>
    <p class="hint">이름 후보: ${cands.map(esc).join(' · ')} (칸을 눌러 고르거나 직접 쓰세요)</p>
    <p class="setup-intro hint">${esc(regionOf(state, zoneProps[zi]))} ${esc(zoneName(zi))}. 개교하면 이 시군과 90분 안팎에 닿는 시군의 기대 교육연수가 오르고(최대 +1.5년, 정원이 모자란 곳일수록 크게), 평균 교육연수·HDI가 수십 년에 걸쳐 따라 오릅니다. 교통망이 좋을수록 효과가 멀리 퍼집니다.</p>
    <div class="setup-body"><div class="list">${Object.entries(UNIV_TYPES).map(([k, t]) => {
      const cost = Math.round(t.cost * (kp ? KP_COST_FACTOR : 1));
      return `<div class="item"><div class="t">${t.label} · 정원 ${t.seats.toLocaleString()}명</div><div class="m">${formatWon(cost)} · ${t.years}년${k === 'kaist' ? ` · 이름은 ${esc(kaistName)}(${kaistAcronym(kaistName)}) (이름 칸을 고치면 그 이름)` : ''}</div>
        <button class="small primary" data-univ-type="${k}">설립</button></div>`;
    }).join('')}</div></div>
    <div class="setup-btns"><span style="flex:1"></span><button class="small" data-univ-type="cancel">닫기</button></div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-univ-type]');
    if (!b) return;
    const k = b.dataset.univType;
    if (k !== 'cancel') {
      const t = UNIV_TYPES[k], cost = Math.round(t.cost * (kp ? KP_COST_FACTOR : 1));
      if (!canAfford(state, cost, t.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
      const typed = wrap.querySelector('#u-name').value.trim();
      let name = k === 'kaist' && (!typed || typed === nm) ? kaistName : typed || nm;
      if (k === 'kaist' && /과학기술원$/.test(name)) name = `${name}(${kaistAcronym(name)})`;
      const id = crypto.randomUUID();
      (state.univNew ||= []).push({ id, name, lon: ll.lng, lat: ll.lat, zone: zi, type: k, seats: t.seats, done: false });
      startProject(state, { id, kind: 'univ', links: [], stations: [], cost, years: t.years, label: `${name} 설립 (${t.label})` });
      save(state); drawUnivs(); renderAll();
      startedNotice(state.projects[state.projects.length - 1]);
    }
    wrap.remove();
  });
}

/** 캠퍼스 500m 안 새 역 이름: 고려대학교 서울캠퍼스 → 고려대, 김책공업종합대학 → 김책공대 (역 이름은 대학 줄임말로) */
export function univStationNames(lon, lat) {
  return univList().filter((u) => u.built && kmBetween(lon, lat, u.lon, u.lat) < 0.5)
    .sort((a, b) => kmBetween(lon, lat, a.lon, a.lat) - kmBetween(lon, lat, b.lon, b.lat))
    .map((u) => u.name.split(' ')[0].replace(/공업종합대학$/, '공대').replace(/(대학교|종합대학|대학)$/, '대').replace(/^국립/, ''));
}

/** 이 자리 가까이(km)의 청사 이름: 새 역 이름 '○○시청역'용 */
export function hallsNear(lon, lat, km = 0.6) {
  return hallList().map((h) => ({ h, d: kmBetween(lon, lat, h.lon, h.lat) })).filter((x) => x.d < km).sort((a, b) => a.d - b.d).map((x) => x.h.name);
}

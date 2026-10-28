// 역 패널과 착공 고시문.
import { formatWon, resolve, upgradeAttrs } from '../game/catalog.js';
import { regionOf } from '../game/local.js';
import { stem } from '../game/naming.js';
import { opBadge, operatorOf } from '../game/operators.js';
import { SERVICE_KINDS } from '../game/services.js';
import { effectiveNetwork, linkAt, linkPending, NEW_BUILDS, UPGRADES } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { openGazette } from '../ui/gazette.js';
import { base, CLASS_LABEL, esc, grid, namer, result, state, subsFC, zoneProps, zonesFC } from './core.js';
import { zoneName } from './year.js';
import { allLinks, anyStationName, kpFix, nodeCoord, nodeNames, shownStation } from './mapdata.js';
import { fmtPop } from './panels.js';
import { SERVICE_DAY_MIN } from './svc.js';
import { autoLocalTrains } from './operators.js';
import { plans } from './plans.js';
import { effectiveGrid } from './housing.js';
import { metroStationEst } from './ppp.js';
import { isCommuterLine } from './pick.js';
import { svcColor } from './svcmap.js';
import { develHTML, transferHTML, zoneAtPoint } from './transfer.js';

// ------------------------------------------------------------ 역 패널

/** 역에 닿는 노선들: 이름별로 수단·종류와 역 앞뒤 구간의 최대 통과 인원, 노선도를 열 구간 */
export function linesAt(node) {
  const out = new Map();
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode === 0 || (l.a !== node && l.b !== node) || l.ext || (i < base.links.length && linkPending(base, state, i)) || state.replaced?.[i]) return;
    if (i >= base.links.length && !l.built) return;
    const key = l.name || CLASS_LABEL[l.cls];
    const e = out.get(key) || { name: key, named: !!l.name, mode: l.mode, cls: l.cls, vol: 0, link: i };
    e.vol = Math.max(e.vol, result?.links.vol[i] || 0);
    out.set(key, e);
  });
  return [...out.values()];
}

// ------------------------------------------------------------ 착공 고시문 (계획안 공문서)

export const GZ_COLOR = { hsr: '#1f5fd1', gtx: '#0c7d8c', rail: '#7b3fa0', rail1: '#7b3fa0', metro: '#1a9a6c', motorway: '#2e7d4f', trunk: '#3f8f5a', tunnelRoad: '#2e7d4f', tunnelRail: '#1f5fd1' };
export const GZ_AUTO = 'ukt-gazette-auto';

export function gazetteAuto() {
  try { return localStorage.getItem(GZ_AUTO) !== '0'; } catch { return true; }
}

/** 기존 노선 짧은 이름 (환승 표시용) */
export function shortLine(name) {
  return String(name || '').replace(/^(서울 지하철|수도권 전철|부산 도시철도|대구 도시철도|광주 도시철도|대전 도시철도|인천 도시철도)\s*/, '')
    .replace(/^수도권광역급행철도\s*/, 'GTX-').replace(/인천국제공항선/, '공항철도').slice(0, 7);
}

/** 개량 사업 고시문의 사업 이름 말 (UPGRADES id → 「경부선 복선화 사업」) */
export const GZ_UPGRADE = {
  pave: '포장·보수', realign: '선형개량', widen: '확장', tomotorway: '고속도로 격상', mwrebuild: '재건축',
  railimprove: '선형개량', straighten: '직선화', double: '복선화', quad: '2복선화', electrify: '전철화', speedup: '고속화', kpstd: '남측 규격 개량',
  metroexpress: '급행화', metrocap: '수송력 증강', retire0: '폐지', retire1: '폐지', retire2: '폐지',
};

/**
 * 링크들을 끝끼리 이어 사슬로 묶는다 (떨어진 구간은 따로, 긴 사슬부터). 링크 차례·방향이 뒤섞인 개량 구간도 노선 차례로 늘어놓는다
 * @returns {{nodes:number[], steps:{l:object, rev:boolean}[]}[]}
 */
export function linkChains(ls, start = null) {
  const adj = new Map();
  ls.forEach((l, k) => { for (const n of [l.a, l.b]) { if (!adj.has(n)) adj.set(n, []); adj.get(n).push(k); } });
  const used = new Set(), chains = [];
  const walk = (u) => {
    const ch = { nodes: [u], steps: [] };
    for (;;) {
      const k = (adj.get(u) || []).find((x) => !used.has(x));
      if (k == null) break;
      used.add(k);
      const l = ls[k], rev = l.a !== u;
      ch.steps.push({ l, rev });
      u = rev ? l.a : l.b;
      ch.nodes.push(u);
    }
    return ch;
  };
  // 끝(한 링크만 닿는 노드)에서 걷기 시작한다 (주어진 시작 노드가 끝이면 거기서)
  const ends = [...adj].filter(([, ks]) => ks.length === 1).map(([n]) => n);
  if (start != null && ends.includes(start)) ends.unshift(start);
  for (const n of ends) if ((adj.get(n) || []).some((x) => !used.has(x))) chains.push(walk(n));
  for (const [n, ks] of adj) if (ks.some((x) => !used.has(x))) chains.push(walk(n));   // 고리
  const len = (c) => c.steps.reduce((t, x) => t + (x.l.len || 0), 0);
  return chains.sort((a, b) => len(b) - len(a));
}

/** 사업의 고시문 자료 (새 노선·직선화·개량). 고시할 노선이 없는 사업이면 null */
export function gazetteData(p) {
  if (!p || !(p.links || []).length || !['new', 'upgrade'].includes(p.kind)) return null;
  const up = p.kind === 'upgrade' ? UPGRADES.find((x) => x.id === p.upgrade) : null;
  if (p.kind === 'upgrade' && !up) return null;
  const spec = p.kind === 'new' ? NEW_BUILDS[p.type] : null;
  if (p.kind === 'new' && !spec) return null;
  const mine = new Set(p.links);
  const ls = p.links.map((id) => linkAt(base, state, id)).filter(Boolean);
  if (!ls.length) return null;
  const mode = spec ? spec.mode : ls[0].mode;
  const rail = mode >= 1;
  const metro = mode === 2;
  const retire = !!up?.retire;
  const straightened = p.kind === 'new' && !!p.retire && (!!p.straightKm || /직선화/.test(p.label || ''));
  const word = up ? GZ_UPGRADE[up.id] || resolve(up.label, ls[0]) : straightened ? '선형개량(직선화)' : '';
  const lineName = ls[0].name || (up ? CLASS_LABEL[ls[0].cls] : '') || p.label.replace(/\s*\(.*$/, '');
  const color = up ? (ls[0].colour || (ls[0].cls === 'hsr' ? '#1f5fd1' : metro ? '#1a9a6c' : rail ? '#7b3fa0' : '#2e7d4f')) : GZ_COLOR[p.type] || '#7b3fa0';
  // 노선을 따라 노드 차례와 누적 거리 (떨어진 구간은 이어서 센다)
  const cum = new Map();
  const order = [];
  const paths = [];
  let km = 0;
  for (const ch of linkChains(ls, ls[0].a)) {
    const path = [];
    if (!cum.has(ch.nodes[0])) cum.set(ch.nodes[0], km);
    order.push(ch.nodes[0]);
    for (const { l, rev } of ch.steps) {
      const g = [];
      for (let k = 0; k + 1 < (l.geom || []).length; k += 2) if (l.geom[k] === l.geom[k]) g.push([l.geom[k], l.geom[k + 1]]);
      const A = nodeCoord(rev ? l.b : l.a);
      if (g.length && A && kmBetween(A[0], A[1], g[0][0], g[0][1]) > kmBetween(A[0], A[1], g[g.length - 1][0], g[g.length - 1][1])) g.reverse();
      path.push(...(path.length ? g.slice(1) : g));
      km += l.len || 0;
      const n = rev ? l.a : l.b;
      if (!cum.has(n)) cum.set(n, km);
      order.push(n);
    }
    if (path.length > 1) paths.push(path);
  }
  if (!paths.length) return null;
  const names = nodeNames();
  // 새 정거장과, 노선이 지나는 기존 역(환승역). 개량 구간 끝이 역이 아니면 가까운 지명으로 적는다
  const stSet = new Set(effectiveNetwork(base, state).stations);
  const ends = new Set([order[0], order[order.length - 1]]);
  const stops = [...new Set(rail ? order.filter((n) => (p.stations || []).includes(n) || stSet.has(n) || (up && ends.has(n)))
    : order.filter((n, i) => i === 0 || i === order.length - 1 || names.get(n)))];
  const code0 = 101;
  const nearPlace = (c) => { const q = namer?.nearbyPlaces(c[0], c[1], 10, 1)[0]; return q ? `${kpFix(stem(q[0]), q[2], q[3])} 부근` : ''; };
  const stations = stops.map((n, i) => {
    const c = nodeCoord(n);
    const zi = zoneAtPoint(c[0], c[1]);
    const zf = zonesFC.features[zi]?.properties || {};
    const others = rail ? linesAt(n).filter((x) => !mine.has(x.link) && x.name !== lineName) : [];
    const transfers = others.map((x) => {
      const raw = allLinks()[x.link];
      const col = raw?.colour || (x.cls === 'hsr' ? '#1f5fd1' : x.mode === 2 ? '#1a9a6c' : '#7b3fa0');
      return { name: x.name, short: shortLine(x.name), color: col };
    });
    const named = names.get(n)?.name || anyStationName(n);
    return {
      node: n, name: named || (up ? nearPlace(c) || `${i + 1}` : rail ? `${code0 + i}정거장` : `${i + 1}`), code: rail && !up ? String(code0 + i) : '', km: cum.get(n) || 0,
      // 소재지는 게임 속 지금 이름으로 (행정구역 정리로 바뀐 소속 도·시군 이름: 간성군 등)
      lon: c[0], lat: c[1], transfers, isNew: n >= base.nodes.length && !up,
      place: zi >= 0 ? [regionOf(state, zoneProps[zi]) || zf.province, zoneName(zi)].filter(Boolean).join(' ') : '',
    };
  });
  if (!stations.length) return null;
  const first = stations[0], last = stations[stations.length - 1];
  // 위치도 범위와 둘레 (시군구 경계, 기존 철도·간선도로, 시군구 이름)
  const all = paths.flat();
  const xs = all.map((q) => q[0]), ys = all.map((q) => q[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padX = Math.max((x1 - x0) * 0.12, 0.02), padY = Math.max((y1 - y0) * 0.12, 0.016);
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const inBox = ([x, y]) => x > x0 && x < x1 && y > y0 && y < y1;
  const boundaries = [];
  for (const f of zonesFC.features) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) if (poly[0].some(inBox)) boundaries.push(poly[0]);
  }
  const lines = [];
  allLinks().forEach((l, i) => {
    if (mine.has(i) || l.ext || state.replaced?.[i]) return;
    const e = linkAt(base, state, i);
    if (e.mode === 0 && !['motorway', 'trunk'].includes(e.cls)) return;
    const g = [];
    for (let k = 0; k + 1 < (l.geom || []).length; k += 2) if (l.geom[k] === l.geom[k]) g.push([l.geom[k], l.geom[k + 1]]);
    if (g.length < 2 || !g.some(inBox)) return;
    const col = e.mode === 0 ? '#d9c9a3' : l.colour || (e.cls === 'hsr' ? '#7fa0de' : e.mode === 2 ? '#8cc9ad' : '#b9a3cc');
    lines.push({ pts: g, color: col, w: e.mode === 0 ? 1.6 : 2 });
  });
  const labels = zoneProps.map((z) => (z.ext || !inBox([z.cx, z.cy]) ? null : { name: z.name, at: [z.cx, z.cy] })).filter(Boolean);
  // 고시 번호·날짜 (사업마다 고정)
  const h = [...p.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const seq = 100 + state.projects.indexOf(p) + 1;
  const date = `${p.startYear}. ${1 + (h % 12)}. ${1 + ((h >> 4) % 28)}.`;
  const kp = ls.every((l) => l.kp);
  const kindWord = metro ? '도시철도' : p.type === 'hsr' || ls[0].cls === 'hsr' ? '고속철도' : p.type === 'gtx' ? '광역급행철도' : rail ? '철도' : '도로';
  const reopen = p.closedLine != null || !!plans.find((x) => x.id === p.plan)?.closedLine;
  const law = metro ? '「도시철도법」' : rail ? '「철도의 건설 및 철도시설 유지관리에 관한 법률」' : '「도로법」';
  const work = up || straightened ? `${lineName} ${word}` : `${lineName} ${reopen ? '재개통' : p.extension ? '연장 ' : ''}건설`;
  const title = retire ? `「${lineName} ${first.name}–${last.name} 구간」 ${rail ? '철도 폐지' : '노선 폐지'} 고시`
    : up && !rail ? `「${work} 사업」 도로구역 변경 고시`
      : up || straightened ? `「${work} 사업」 기본계획 ${metro ? '승인 ' : ''}고시`
        : reopen ? `「${lineName} 재개통 사업」 기본계획 고시`
          : metro ? `「${lineName} 도시철도 건설사업」 기본계획 승인 고시`
            : rail ? `「${lineName} ${p.extension ? '연장 ' : ''}건설사업」 기본계획 고시` : `「${lineName} 건설사업」 도로구역 결정 고시`;
  const lead = retire ? `${law}에 따라 ${lineName} ${first.name}–${last.name} 구간을 다음과 같이 폐지하기로 하였으므로 이를 고시합니다.`
    : rail ? `${law}에 따라 ${work}사업의 기본계획을 다음과 같이 수립하였으므로 이를 고시합니다.`
      : up ? `${law}에 따라 ${work}사업의 도로구역을 다음과 같이 변경하였으므로 이를 고시합니다.`
        : `${law}에 따라 ${lineName} 건설사업의 도로구역을 다음과 같이 결정하였으므로 이를 고시합니다.`;
  const total = p.cost;
  const fr = (k, r) => [k, formatWon(Math.round(total * r)), `${Math.round(r * 100)}%`];
  const sum = ['계', formatWon(total), '100%'];
  const motorwayWork = p.type === 'motorway' || p.type === 'tunnelRoad' || (up && ls[0].cls === 'motorway') || up?.id === 'tomotorway';
  const funding = p.fund === 'ppp' ? [fr('정부 보조', p.govShare || 0), fr('민간 투자', 1 - (p.govShare || 0)), sum]
    : p.fund && p.fund !== 'gov' ? [['운영사 자체 재원', formatWon(total), '100%'], sum]
      : metro ? [fr('국비', 0.6), fr('지방비', 0.4), sum]
        : motorwayWork && !kp ? [fr('국비', 0.5), fr('한국도로공사', 0.5), sum]
          : kp ? [fr('국비 (남북 통합 특별회계)', 1), sum] : [fr('국비', 1), sum];
  const stopWord = rail ? '정거장' : 'IC·JCT';
  const transferCount = new Set(stations.flatMap((s) => s.transfers.map((x) => x.name))).size;
  const catch1 = rail ? Math.round(stations.reduce((acc, s) => acc + popWithin(s.lon, s.lat, 1), 0)) : 0;
  const sk = p.straightKm;
  const effects = retire ? [
    `이용이 적은 ${first.name}–${last.name} ${km.toFixed(1)}km 구간을 정리해 유지관리 비용 절감`,
    '폐지한 부지는 지역 개발·녹지 등으로 활용',
  ] : straightened ? [
    sk ? `${first.name}–${last.name} 구간 연장을 ${sk[0].toFixed(1)}km에서 ${sk[1].toFixed(1)}km로 ${(sk[0] - sk[1]).toFixed(1)}km 단축` : `${first.name}–${last.name} 구간의 굽은 선형을 펴 운행 거리 단축`,
    '곡선 구간 속도 제한을 풀어 열차 운행 시간 단축',
    kp ? '남북 철도망 통합과 북측 지역 균형 발전에 기여' : '철도 경쟁력 향상으로 도로 혼잡 완화와 온실가스 감축',
  ] : up && rail ? [
    `${first.name}–${last.name} ${km.toFixed(1)}km 구간 ${word}로 선로 용량과 운행 속도 향상`,
    '열차 운행 시간 단축과 정시성 향상',
    kp ? '남북 철도망 통합과 북측 지역 균형 발전에 기여' : '철도 수송 분담률을 높여 도로 혼잡 완화와 온실가스 감축',
  ] : up ? [
    `${first.name}–${last.name} ${km.toFixed(1)}km 구간 ${word}로 통행 속도 향상과 상습 정체 완화`,
    '교통사고 감소와 물류 비용 절감',
  ] : rail ? [
    `${first.name}–${last.name} ${km.toFixed(1)}km 구간에 ${stations.length}개 정거장을 놓아 철도 서비스 소외 지역을 해소`,
    `정거장 반경 1km 안 인구 약 ${(catch1 / 10000).toFixed(1)}만 명에게 철도 접근성 제공`,
    transferCount ? `기존 ${transferCount}개 노선과 환승 연계로 광역 철도망 효율 향상` : '기존 철도망과의 연계 수송 체계 구축',
    kp ? '남북 철도망 통합과 북측 지역 균형 발전에 기여' : '도로 혼잡 완화와 온실가스 감축',
  ] : [
    `${first.name}–${last.name} ${km.toFixed(1)}km 구간 신설로 지역 간 통행 시간 단축`,
    `${stations.length}개 나들목·분기점으로 주변 간선도로와 연결`,
    '기존 도로의 상습 정체 완화와 물류 비용 절감',
  ];
  const org = '통일한국 국토교통부';
  // 사업 규모·설계 속도: 개량은 개량 뒤 속성으로
  const after = up && !retire ? { ...ls[0], ...(upgradeAttrs(up, ls[0]) || {}) } : spec ? spec.attrs : ls[0];
  const tracks = after?.tracks === 1 ? '단선' : after?.tracks >= 4 ? '2복선' : '복선';
  const electric = after?.power && after.power !== 'none' ? '전철' : '';
  const scale = retire ? `연장 ${km.toFixed(1)}km 폐지`
    : up ? `연장 ${km.toFixed(1)}km, ${resolve(up.label, ls[0])}${rail ? ` (개량 뒤 ${tracks}${electric})` : after?.lanes ? ` (개량 뒤 ${after.lanes}차로)` : ''}`
      : `연장 ${km.toFixed(1)}km, ${stopWord} ${stations.length}개소${rail ? `, ${tracks}${electric}` : ''}`;
  const overview = [
    ['사 업 명', esc(retire ? `${lineName} ${first.name}–${last.name} 구간 폐지` : `${work}사업`)],
    ['사업 구간', esc(`${first.name} ~ ${last.name} (${first.place} ~ ${last.place})`)],
    ['사업 규모', esc(scale)],
    ...(retire ? [] : [['설계 속도', esc(`${after?.speed || '-'}km/h`)]]),
    ['총사업비', esc(formatWon(p.cost))],
    ['사업 기간', esc(`${p.startYear}년 ~ ${p.doneYear}년 (${p.years}년)`)],
    ['사업 방식', esc(p.fund === 'ppp' ? `민간투자사업 (정부 보조 ${Math.round((p.govShare || 0) * 100)}%)` : p.fund && p.fund !== 'gov' ? '운영사 자체 사업' : '재정사업')],
    ['사업 시행자', esc(rail ? (metro ? (first.place.split(' ')[0] || '해당 광역자치단체') : '국가철도공단')
      : motorwayWork ? '한국도로공사' : '지방국토관리청')],
  ];
  const offices = [...new Set(stations.map((s) => s.place.split(' ').slice(-1)[0]).filter(Boolean))].slice(0, 6).join('·');
  const deptRail = up || straightened ? '철도국 · 철도시설과' : '철도국 · 철도건설과';
  const deptRoad = up ? '도로국 · 도로관리과' : '도로국 · 도로건설과';
  return {
    org, orgSub: rail ? deptRail : deptRoad, docNo: `국토교통부 고시 제${p.startYear}-${seq}호`, title, lead, date,
    signer: '국토교통부장관', sealText: '국토교통부|장관인', lineName, color, stations, path: paths[0], paths, bbox: [[x0, y0], [x1, y1]],
    context: { boundaries, lines, labels }, overview, funding, stopWord,
    schedule: retire ? [
      ['폐지 고시', `${p.startYear}년`, '본 고시'],
      ['시설 철거', `${p.startYear}년 ~ ${p.doneYear}년`, `${rail ? '선로' : '도로'} 시설 철거와 부지 정리`],
      ['폐지', `${p.doneYear}년`, `운행 종료`],
    ] : [
      [up ? '사업 고시' : '기본계획 고시', `${p.startYear}년`, '본 고시'],
      ['기본·실시설계', `${p.startYear}년`, '설계·인허가 병행'],
      ['착공', `${p.startYear}년`, `${kindWord} ${up ? '개량' : straightened ? '선형개량' : ''} 공사 착수`.replace(/\s+/g, ' ')],
      [rail ? (up ? '준공 목표' : '개통 목표') : '준공 목표', `${p.doneYear}년`, `공사 기간 ${p.years}년`],
    ],
    effects,
    inspect: `관계 도서는 ${org} ${rail ? '철도국' : '도로국'}과 ${offices || '관할'} 등 관할 시·군·구청에 갖추어 두고 일반에게 보입니다.`,
  };
}

/** 고시문 창. fromBuild: 착공 직후 저절로 여는 경우 ('착공할 때마다 열기'를 끄면 안 연다) */
export function showGazette(p, { fromBuild = false } = {}) {
  if (fromBuild && !gazetteAuto()) return false;
  const doc = gazetteData(p);
  if (!doc) return false;
  openGazette(doc, { auto: gazetteAuto(), onAuto: (on) => { try { localStorage.setItem(GZ_AUTO, on ? '1' : '0'); } catch { /* 저장 못 해도 이번 창은 그대로 */ } } });
  return true;
}

/**
 * 새 역 이름 후보: 400m 안의 기존 역(일반철도·도시철도, 환승역은 같은 이름), 역이 놓인 읍면동, 1km 안 이웃 읍면동 차례
 * (동 이름의 번호는 뗀다: 북가좌1동 → 북가좌)
 */
export function stationNameHints(lon, lat) {
  const out = [];
  let best = null, bd = 0.4;
  for (const [nm, node] of [...base.stations, ...(base.metro_stations || [])]) {
    const c = base.nodes[node];
    if (!c || Math.abs(c[1] - lat) > 0.01) continue;
    const d = kmBetween(lon, lat, c[0], c[1]);
    if (d < bd) { bd = d; best = shownStation(nm, node); }
  }
  if (best) out.push({ name: best, sameStation: true });
  if (subsFC) {
    // 동 이름의 번호는 뗀다: 북가좌1동 → 북가좌동, 종로1·2·3·4가 → 종로
    const dong = (n) => String(n || '').replace(/\s.*$/, '').replace(/제?[\d·,]+(동|가)$/, (m, t) => (t === '동' ? '동' : ''));
    const inside = [], near = [];
    for (const f of subsFC.features) {
      const nm = f.properties?.name;
      if (!nm || !/(동|읍|면|가)$/.test(nm)) continue;
      const g = f.geometry;
      const rings = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
      let hit = false, dmin = Infinity;
      for (const poly of rings) {
        const r = poly[0];
        if (!r.length || Math.abs(r[0][1] - lat) > 0.05 || Math.abs(r[0][0] - lon) > 0.06) continue;
        let inPoly = false;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const [xi, yi] = r[i], [xj, yj] = r[j];
          if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inPoly = !inPoly;
          dmin = Math.min(dmin, kmBetween(lon, lat, xi, yi));
        }
        if (inPoly) hit = true;
      }
      if (hit) inside.push(kpFix(dong(nm), lon, lat)); else if (dmin < 1) near.push([dmin, kpFix(dong(nm), lon, lat)]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const n of [...inside, ...near.map((x) => x[1])]) if (!out.some((o) => o.name === n)) out.push({ name: n });
  }
  return out;
}

/** 반경 km 안의 인구 (1km 인구 격자) */
export function popWithin(lon, lat, km) {
  const grid = effectiveGrid();
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57, r2 = km * km;
  let s = 0;
  for (let c = 0; c < grid.length; c += 4) {
    const dx = (grid[c] - lon) * kx, dy = (grid[c + 1] - lat) * ky;
    if (dx * dx + dy * dy <= r2) s += grid[c + 2];
  }
  return s;
}

export function stationPanel(id, n) {
  const c = nodeCoord(id);
  const lines = linesAt(id);
  const k = result ? result.stations.node.indexOf(id) : -1;
  const riders = k >= 0 ? result.stations.riders[k] : null;
  // 운행 계통: 서는 계통과 그냥 지나가는 계통
  const stopping = [], passing = [];
  for (const s of state.services || []) {
    if (s.stops.includes(id)) { stopping.push(s); continue; }
    const passes = s.segs.some((seg) => seg.via.some((i) => { const l = linkAt(base, state, i); return l.a === id || l.b === id; }));
    if (passes) passing.push(s);
  }
  const svcTrains = stopping.filter((s) => s.built).reduce((a, s) => a + s.trains, 0);
  // 도보 환승: 400m 안의 다른 역 (같은 노드의 다른 노선은 위 노선 목록에 있다)
  const nn = nodeNames();
  const near = [];
  for (const [node, v] of nn) {
    if (v.kind !== 'station' || node === id || typeof node !== 'number') continue;
    const p = nodeCoord(node);
    if (!p) continue;
    const d = kmBetween(c[0], c[1], p[0], p[1]);
    if (d <= 0.4) near.push({ node, name: v.name, d, lines: linesAt(node).filter((x) => x.named).map((x) => x.name) });
  }
  near.sort((a, b) => a.d - b.d);
  // 이 역에 이미 있는 노선만 지나는 이웃(같은 노선의 다른 승강장 노드)과 겹치는 항목은 뺀다
  const here = new Set(lines.filter((l) => l.named).map((l) => l.name));
  const seen = new Set();
  for (let i = near.length - 1; i >= 0; i--) {
    const x = near[i];
    if (x.lines.length && x.lines.every((l) => here.has(l))) near.splice(i, 1);
  }
  for (let i = 0; i < near.length; i++) {
    const key = `${near[i].name}|${near[i].lines.join(',')}`;
    if (seen.has(key)) near.splice(i--, 1); else seen.add(key);
  }
  const modeLabel = (l) => (l.mode === 2 ? '도시철도' : l.cls === 'conv' && isCommuterLine(l.name) ? '광역철도' : CLASS_LABEL[l.cls]);
  const svcRow = (s, stop) => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(svcColor(s, state.services.indexOf(s)))}"></span>
    ${esc(s.name)} <span class="m">${SERVICE_KINDS[s.kind].label}${s.built ? '' : ' · 차량 제작 중'}</span> <button class="small" data-svc-edit="${s.id}">고치기</button></td>
    <td>${stop ? `하루 ${s.trains}회 · 약 ${Math.round(SERVICE_DAY_MIN / Math.max(1, s.trains / 2))}분 간격` : '통과'}</td></tr>`;
  return `
    <h4>노선</h4>
    <table class="kv">${lines.map((l) => `<tr><td>${opBadge(state, operatorOf(state, { mode: l.mode, kp: linkAt(base, state, l.link).kp }))} ${esc(l.name)} <span class="m">${modeLabel(l)}</span>
      ${l.named ? `<button class="small" data-st-diagram="${l.link}">노선도</button>` : ''}</td>
      <td>${Math.round(l.vol).toLocaleString()}명/일 통과</td></tr>`).join('') || '<tr><td colspan="2">운행 중인 노선이 없습니다.</td></tr>'}</table>
    <h4>승하차</h4>
    <table class="kv">
      ${riders != null ? `<tr><td>지역 간 승하차</td><td>${Math.round(riders).toLocaleString()}명/일</td></tr>` : ''}
      ${lines.some((l) => l.mode === 2) ? `<tr><td>도시철도 승하차 (추정, 구 안 이용 포함)</td><td>${Math.round(metroStationEst(id)).toLocaleString()}명/일</td></tr>` : ''}
      <tr><td>역세권 인구 (반경 1km · 3km)</td><td>${fmtPop(popWithin(c[0], c[1], 1))} · ${fmtPop(popWithin(c[0], c[1], 3))}</td></tr>
    </table>
    ${riders == null && !lines.some((l) => l.mode === 2) ? '<p class="hint">아직 운행하지 않는 역입니다.</p>' : ''}
    ${lines.some((l) => l.mode === 2) ? '<p class="hint">도시철도 승하차는 역 반경 800m 인구로 어림한 값입니다 (모형의 시군구 사이 통행에 빠진 구 안 이용 포함).</p>' : ''}
    <h4>운행 계통</h4>
    <table class="kv">${lines.filter((l) => l.named).map((l) => { const t = autoLocalTrains(l.name, l.mode === 2 ? 'metro' : l.cls);
      return `<tr><td>${esc(l.name)} ${l.cls === 'hsr' ? '고속' : '보통'} <span class="m">자동 · 24시간</span></td><td>하루 ${t}회 · 약 ${Math.max(1, Math.round(SERVICE_DAY_MIN / Math.max(1, t / 2)))}분 간격</td></tr>`; }).join('')}
      ${stopping.map((s) => svcRow(s, true)).join('')}${passing.map((s) => svcRow(s, false)).join('')}</table>
    ${svcTrains ? `<p class="hint">이 역에 서는 특급·급행 등 계통 열차 하루 ${svcTrains}회</p>` : '<p class="hint">보통 열차는 모든 노선에 저절로 다닙니다. 특급·급행은 계통을 짜야 다닙니다.</p>'}
    ${lines.some((l) => l.mode === 1) ? `<div class="actions"><button class="small primary" data-svc-from="${id}" title="이 역에서 시작해, 설 역을 지도에서 차례로 누릅니다">이 역에서 운행 계통 짜기</button></div>` : ''}
    <h4>환승</h4>
    ${lines.filter((l) => l.named).length > 1 ? `<p class="hint">같은 역 환승: ${lines.filter((l) => l.named).map((l) => esc(l.name)).join(', ')}</p>` : ''}
    ${near.length ? `<table class="kv">${near.map((x) => `<tr><td><a href="#" data-st-goto="${x.node}">${esc(x.name)}</a>
      <span class="m">${x.lines.map(esc).join(', ') || '노선 정보 없음'}</span></td><td>도보 ${Math.round(x.d * 1000)}m</td></tr>`).join('')}</table>`
      : lines.filter((l) => l.named).length > 1 ? '' : '<p class="hint">400m 안에 갈아탈 다른 역이 없습니다.</p>'}
    ${transferHTML(id, lines)}
    ${develHTML(id, n)}`;
}

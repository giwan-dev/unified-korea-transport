// 지방자치·선거·단체장 SOC 제안.
import { formatWon, resolve } from '../game/catalog.js';
import {
  bumpApproval, countyTitle, dueum, ELECTION, EVENT_COST, governorTitle, hasAutonomy, HISTORIC_CITIES, isMetroCity, KP_DIRECT_CITIES, leanP, metroName, PARTIES,
  partySupport, personName, PROMOTE_MIN_POP, promotedName, regionBase, regionOf, RETIRE_CHANCE, runElection, TERM_LIMIT, THIRD, unitId,
} from '../game/local.js';
import { canAfford, defaultFix, fundFor, KP_LINE_RENAME, LINE_RENAME_COST, linkAt, linksUnderWork, save, startUpgrade, upgradeCost, UPGRADES } from '../game/state.js';
import { t } from '../i18n.js';
import { toast } from '../ui/panel.js';
import { base, CLASS_LABEL, esc, map, requests, result, setRequests, state, zoneProps } from './core.js';
import { countyKey, officeName, zoneName } from './year.js';
import { nodeCoord, paintZones, refreshLinks, subInfo } from './mapdata.js';
import { admin, adminInvalidate, kpMyeon, kpUnitKind, krSi, splitUnits, unitMyeonList, unitOfficeKey, unitPop, unitRepZone } from './region.js';
import { fmtPop, renderAll } from './panels.js';
import { gotoLinks, renderRequests, spanText } from './budget.js';
import {
  annexRegion, annexTargets, bunguOf, bunguSelect, bunguUnitOf, bunguUnits, cityUpTargets, guNamesOfZone, isGeneralGu, isGeneralUnit, unitPrefix, unitZones,
} from './bungu.js';
import { adminSummaryHTML } from './firstyear.js';

// ------------------------------------------------------------ 지방자치·선거·SOC 제안

export let rng = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();

/** 광역 단체별 시군구 목록 (지방자치가 시행 중인 곳만) */
export function regions() {
  const out = new Map();
  zoneProps.forEach((z, i) => {
    if (z.ext || !hasAutonomy(state, z)) return;
    const r = regionOf(state, z);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(i);
  });
  return out;
}

export function zonePop(i) { return result ? result.zones.pop[i] : zoneProps[i].pop; }

/** 지방선거: 광역단체장과 시군구청장을 뽑는다. only: 'all' | 'kp' | 광역 단체 이름 목록 */
/**
 * 3당 바람: 8~12년에 한 번꼴로 전국 지방선거에서 3당 하나(개혁신당·정의당)가 크게 뜬다 (그 선거에서 그 당 지지 +8%p로 친다:
 * 3당 당선 확률이 2.5%에서 10%쯤으로). 첫 바람은 시작 뒤 4~9년 사이
 */
export var thirdWave = null;
export function waveSup(s) { return thirdWave ? { ...(s || {}), [thirdWave]: ((s || {})[thirdWave] || 0) + 8 } : s; }

/** 전국동시지방선거 회차: 2026년을 제9회로 보고 4년마다 하나씩 (2030년 제10회) */
export function localElectionName(year) {
  return `제${9 + Math.floor((year - 2026) / 4)}회 전국동시지방선거`;
}

export function holdElection(only = 'all', reason = '') {
  const L = state.local;
  const label = reason || localElectionName(state.year);
  const regs = regions();
  const gov = {}, may = {}, flips = [], govRows = [];
  let kept = 0, total = 0;
  // 전국 바람: 선거마다 한쪽으로 쏠린다 (±12%p: 2018·2022년처럼 한쪽이 휩쓰는 해가 있다). 행정구역 개편 같은 보궐 성격 선거에는 약하게
  const mood = (rng() - 0.5) * (only === 'all' ? 0.24 : 0.08);
  thirdWave = null;
  if (only === 'all' && !/게임 시작/.test(reason)) {
    L.nextThirdWave ??= state.year + 4 + Math.floor(rng() * 6);
    if (state.year >= L.nextThirdWave) { thirdWave = rng() < 0.5 ? 'R' : 'J'; L.nextThirdWave = state.year + 8 + Math.floor(rng() * 5); }
  }
  let limited = 0, retired = 0;
  for (const [r, zs] of regs) {
    if (Array.isArray(only) && !only.includes(r)) continue;
    if (only === 'kp' && !zs.some((i) => zoneProps[i].country === 'KP')) continue;
    let w = 0, s = 0;
    for (const i of zs) { const p = zonePop(i); w += p; s += p * leanP(zoneProps[i]); }
    const key = `g:${r}`;
    const { cur, why } = incumbent(L.offices[key]);
    if (why === 'limit') limited++; else if (why === 'retire') retired++;
    const res = runElection((w > 0 ? s / w : 0.5) + supportShift(r), cur, rng, mood, waveSup(L.support?.[r]));
    const before = L.offices[key];
    if (cur && cur.party === res.party) { cur.approval = 50 + (cur.approval - 50) / 2; cur.terms = (cur.terms || 1) + 1; kept++; }
    else L.offices[key] = { title: governorTitle(r), name: personName(rng, sideOfRegion(r)), region: r, party: res.party, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
    L.offices[key].share = res.share;
    gov[res.party] = (gov[res.party] || 0) + 1; total++;
    const now = L.offices[key];
    govRows.push({ title: now.title, name: now.name, party: now.party, share: res.share, terms: now.terms, was: before && !before.appointed ? { name: before.name, party: before.party } : null, why, appointed: !!before?.appointed });
    if (before && !before.appointed && before.party !== now.party) flips.push(now.title);
    if (only === 'all' || only === 'kp' || Array.isArray(only)) {
      for (const i of zs) {
        if (Array.isArray(only)) break;   // 광역 단체만 새로 뽑는 경우 (행정구역 개편·독립)
        if (only === 'kp' && zoneProps[i].country !== 'KP') continue;
        if (countyRep(i) !== i) continue;   // 한 시군에 단체장은 하나 (옛 군 땅을 떼어 낸 계산용 조각은 몸통 단체장이 맡는다)
        const was = L.offices[`m:${i}`];
        const wasParty = was && !was.appointed ? was.party : null;
        const won = electMayor(i, mood, may, (w) => { if (w === 'limit') limited++; else if (w === 'retire') retired++; });
        if (won) may[won] = (may[won] || 0) + 1;
        if (won && wasParty && wasParty !== won) flips.push(L.offices[`m:${i}`].title);
      }
      // 새로 세운 시군도 함께 뽑는다
      if (!Array.isArray(only)) for (const u of splitUnits()) {
        if (u.region !== r || (only === 'kp' && zoneProps[unitRepZone(u.id)].country !== 'KP')) continue;
        if (!hasAutonomy(state, zoneProps[unitRepZone(u.id)])) continue;
        const was = L.offices[unitOfficeKey(u.id)], wasParty = was && !was.appointed ? was.party : null;
        const won = electUnitMayor(u.id, mood, (w) => { if (w === 'limit') limited++; else if (w === 'retire') retired++; });
        if (won) may[won] = (may[won] || 0) + 1;
        if (won && wasParty && wasParty !== won) flips.push(L.offices[unitOfficeKey(u.id)].title);
      }
    }
  }
  if (!total) return;
  L.elections.push({ year: state.year, gov, may, reason });
  const tally = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${PARTIES[k]?.short || k} ${v}`).join(' ');
  const m = Object.keys(may).length ? ` · 기초 ${tally(may)}` : '';
  state.log.unshift(`${state.year}년 ${label}: 광역 ${tally(gov)}${m}${kept ? ` (광역 재선 ${kept})` : ''}${limited ? ` · 3선 연임 제한으로 물러난 단체장 ${limited}명` : ''}${retired ? ` · 불출마·공천 탈락 ${retired}명` : ''}`);
  syncAppointed();
  if (result && map) paintZones();   // 정당·득표율 지도를 새 당선인으로
  // 게임을 시작할 때 채우는 선거는 알리지 않는다
  const wave = thirdWave;
  thirdWave = null;
  if (wave) state.log.unshift(`${state.year}년 ${label}: ${PARTIES[wave].name} 바람`);
  if (!/게임 시작/.test(reason)) electionNotice({ year: state.year, reason: label, gov, may, govRows, flips, limited, retired, mood, wave });
}

/** 분구를 확정하면: 새로 생긴 구의 구청장 선거 결과를 선거 알림창으로 (가운데 구는 시군 단체장이 이어 맡는다). 일반구는 시장이 임명해 선거가 없다 */
export function bunguElectionNotice(unit) {
  const L = state.local, b = L.bungu?.[unit];
  if (!b || b.general) return;
  const reps = [...new Set(unitZones(unit).map((z) => countyRep(z)))];
  const rows = [], may = {};
  for (const r of reps) {
    if (!hasAutonomy(state, zoneProps[r])) continue;
    const gs = zoneGus(r) || [];
    gs.forEach((g, k) => {
      const o = L.offices[k === 0 ? `m:${r}` : `m:${r}#${g}`];
      if (!o || o.appointed) return;
      if (k > 0) may[o.party] = (may[o.party] || 0) + 1;
      rows.push({ title: o.title, name: o.name, party: o.party, share: o.share ?? 0.5, terms: o.terms, note: k === 0 ? '시군 단체장이 이어 맡음' : '신설 · 첫 구청장' });
    });
  }
  if (!Object.keys(may).length) return;
  const where = unit.includes('|') ? `${regionOf(state, zoneProps[reps[0]])} ${unit.split('|')[1]}` : regionOf(state, zoneProps[reps[0]]);
  state.log.unshift(`${state.year}년 ${where} 분구 구청장 선거: ${rows.filter((r) => r.note !== '시군 단체장이 이어 맡음').map((r) => `${r.title} ${PARTIES[r.party]?.short || r.party} ${r.name}`).join(', ')}`);
  if (result && map) paintZones();
  electionNotice({ year: state.year, reason: `${where} 분구 구청장 선거`, gov: {}, may, govRows: rows, flips: [], limited: 0, retired: 0, mood: null });
}

/** 선거 결과 알림창: 정당별 당선, 광역단체장 당선인, 바뀐 곳 */
export function electionNotice(e) {
  const bar = (o) => {
    const tot = Object.values(o).reduce((a, b) => a + b, 0) || 1;
    return `<div style="display:flex;height:14px;border-radius:3px;overflow:hidden;margin:4px 0">${Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span title="${esc(PARTIES[k]?.name || k)} ${v}" style="width:${(v / tot) * 100}%;background:${PARTIES[k]?.color || '#999'}"></span>`).join('')}</div>
      <div class="m">${Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${partyBadge(k)} ${v}`).join(' ')}</div>`;
  };
  const rows = e.govRows.map((r) => `<tr><td>${esc(r.title)}</td><td>${partyBadge(r.party)} <b>${esc(r.name || '')}</b></td><td>${Math.round(r.share * 100)}%</td>
    <td class="m">${r.note ? esc(r.note) : r.appointed ? '첫 민선' : r.was && r.was.name === r.name ? `재선 (${r.terms}선)` : r.was ? `${r.why === 'limit' ? '연임 제한 · ' : r.why === 'retire' ? '불출마 · ' : ''}${r.was.party !== r.party ? `${esc(PARTIES[r.was.party]?.short || '')} → ${esc(PARTIES[r.party]?.short || '')}` : '같은 정당 새 인물'}` : '신설'}</td></tr>`).join('');
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true"><h2>${e.year}년 ${esc(e.reason)} 결과</h2>
    <p class="setup-intro hint">${e.mood == null ? `새로 생긴 구마다 구청장을 뽑았습니다 (${Object.values(e.may).reduce((a, b) => a + b, 0)}곳)`
      : `전국 바람: ${e.mood > 0.02 ? '국민의힘 쪽' : e.mood < -0.02 ? '민주당 쪽' : '어느 쪽도 아님'} (${(Math.abs(e.mood) * 100).toFixed(1)}%p)`}
      ${e.wave ? ` · <b>${esc(PARTIES[e.wave].name)} 바람</b>` : ''}${e.flips.length ? ` · 정당이 바뀐 곳 ${e.flips.length}곳` : ''}${e.limited ? ` · 3선 연임 제한 ${e.limited}명` : ''}${e.retired ? ` · 불출마·공천 탈락 ${e.retired}명` : ''}</p>
    <div class="setup-body">
      ${Object.keys(e.gov).length ? `<h4>광역단체장 (${e.govRows.length}곳)</h4>${bar(e.gov)}` : ''}
      ${Object.keys(e.may).length ? `<h4>기초단체장·구청장</h4>${bar(e.may)}` : ''}
      <table class="cmp" style="margin-top:8px"><tr><th>직함</th><th>당선인</th><th>득표율</th><th></th></tr>${rows}</table>
      ${e.flips.length ? `<p class="hint">정당이 바뀐 곳: ${e.flips.slice(0, 30).map(esc).join(', ')}${e.flips.length > 30 ? ' …' : ''}</p>` : ''}
    </div>
    <div class="setup-btns"><span style="flex:1"></span><button class="small primary" data-el-close>확인</button></div></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('[data-el-close]').onclick = () => wrap.remove();
}

/** 해마다: 선거 연도면 선거, 단체장들이 SOC 사업을 제안한다 */
export function localYear(doneProjects) {
  const L = state.local;
  // 완공된 제안 사업은 제안한 단체장의 실적
  for (const p of doneProjects) {
    if (!p.proposal) continue;
    const pr = L.proposals.find((x) => x.id === p.proposal);
    const off = pr && L.offices[pr.office];
    if (off) { off.delivered++; bumpApproval(off, 6); }
    if (pr) { bumpSupport(proposalRegion(pr), proposalParty(pr), 2); pr.status = 'done'; }
  }
  // 정당 지지 변동은 해마다 10%씩 옅어진다
  for (const d of Object.values(L.support || {})) for (const k of Object.keys(d)) d[k] = Math.round(d[k] * 0.9 * 100) / 100;
  if (state.year >= ELECTION.firstYear && (state.year - ELECTION.firstYear) % ELECTION.every === 0
    && !L.elections.some((e) => e.year === state.year && !e.reason)) holdElection('all');
  // 오래 묵힌 제안은 거절한 것으로 본다
  for (const pr of L.proposals) {
    if (pr.status === 'open' && state.year - pr.year >= 2) {
      pr.status = 'expired';
      const off = L.offices[pr.office];
      if (off) bumpApproval(off, -4);
      bumpSupport(proposalRegion(pr), proposalParty(pr), -0.5);
    }
  }
  proposeProjects();
}

/** 구간이 속한 존 (구간 가운데에서 가장 가까운 존 중심) */
export function zoneOfLink(id) {
  const l = linkAt(base, state, id);
  const a = nodeCoord(l.a), b = nodeCoord(l.b);
  const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
  let best = -1, bd = Infinity;
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    const d = (z.cx - x) ** 2 + (z.cy - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

/** 시군 단체장 직함: 분구한 시군은 첫 구(가운데 구)의 구청장 */
export function mayorTitleOf(i) {
  const gs = zoneGus(i);
  return gs ? `${gs[0]}청장` : countyTitle(officeName(i), regionOf(state, zoneProps[i]));
}

/** 분구한 시군의 구 목록 (가운데 구 먼저). 아니면 null */
export function zoneGus(i) {
  const gs = guNamesOfZone(i);
  if (!gs || isGeneralGu(i)) return null;   // 일반구: 구청장은 시장이 임명한다
  const B = bunguOf(i);
  const pre = state.local?.bungu?.[unitId(state, zoneProps[i])] ? unitPrefix(unitId(state, zoneProps[i])) : '';
  const core = B?.core || (pre ? `${pre}구` : '중구');
  return [...gs].sort((a, b) => (b === core) - (a === core) || a.localeCompare(b, 'ko'));
}

/** 구청장 자리: 가운데 구는 시군 단체장 자리(m:존) 그대로, 나머지 구는 m:존#구 */
export function guKey(i, gu) {
  const r = countyRep(i), gs = zoneGus(r);
  return !gs || gu === gs[0] ? `m:${r}` : `m:${r}#${gu}`;
}

/** 시군 단체장 선거 (존 i가 그 시군의 대표 존). 분구한 시군은 구마다 구청장을 뽑는다. 이긴 정당을 돌려준다 (tally가 있으면 구청장까지 센다) */
/**
 * 이번 선거에 나오는 현직: 관선(임명직)은 현직이 아니고, 3선을 채웠으면 물러나며(연임 제한),
 * 그 전에도 선거마다 일부는 불출마·공천 탈락으로 같은 정당의 새 후보가 나온다 (예전에는 같은 정당이 이기면 같은 사람이 끝없이 이어 했다)
 */
export function incumbent(off) {
  if (!off || off.appointed) return { cur: null, why: null };
  if ((off.terms || 1) >= TERM_LIMIT) return { cur: null, why: 'limit' };
  if (rng() < RETIRE_CHANCE) return { cur: null, why: 'retire' };
  return { cur: off, why: null };
}

/** 광역 단체의 정당 지지 변동(%p)이 두 큰 정당 대결에 주는 몫 (국민의힘 쪽 +) */
export function supportShift(region) {
  const d = state.local.support?.[region];
  return d ? ((d.P || 0) - (d.D || 0)) / 100 : 0;
}

/** 정당 지지 변동 (%p, 광역 단체 단위, ±15까지). 해마다 10%씩 줄어든다 */
export function bumpSupport(region, party, d) {
  if (!region || !party) return;
  const L = state.local;
  const s = ((L.support ||= {})[region] ||= {});
  s[party] = Math.max(-15, Math.min(15, (s[party] || 0) + d));
}

/** 시군 창: 정당별 지지율 막대 */
export function supportHTML(i) {
  const z = zoneProps[i];
  if (z.ext || !hasAutonomy(state, z)) return '';
  const r = regionOf(state, z), sup = partySupport(z, state.local.support?.[r], state.local.offices[mayorKey(i)]?.party);
  const rows = Object.entries(sup).sort((a, b) => b[1] - a[1]);
  return `<div class="m" style="margin-top:6px">정당 지지율 (이 시군)</div>
    <div style="display:flex;height:12px;border-radius:3px;overflow:hidden;margin:3px 0">${rows.map(([k, v]) => `<span title="${esc(PARTIES[k].name)} ${(v * 100).toFixed(1)}%" style="width:${v * 100}%;background:${PARTIES[k].color}"></span>`).join('')}</div>
    <div class="m">${rows.map(([k, v]) => `${partyBadge(k)} ${(v * 100).toFixed(1)}%`).join(' ')}</div>
    <p class="hint">여당(단체장 정당)이든 야당이든 그 정당이 낸 사업 제안을 받아 주고 완공하면 그 정당 지지가 오르고, 거절하면 내립니다. 지지율은 다음 선거에 반영됩니다.</p>`;
}

/** 광역 단체가 북측 쪽인지 (이름 결을 고를 때) */
export function sideOfRegion(r) {
  const z = zoneProps.find((q) => !q.ext && regionOf(state, q) === r);
  return z ? regionBase(state, z).side : 'KR';
}

/**
 * 북측 지방자치를 시행하기 전에는 중앙정부가 도지사·시장·군수를 임명한다 (관선). 지방선거가 없어 정당이 없고 제안도 하지 않으며,
 * 4년마다 인사로 바뀐다. 지방자치를 시행하면 첫 지방선거에서 민선으로 바뀐다
 */
export function syncAppointed() {
  const L = state.local;
  if (!L?.offices) return;
  const regs = new Map();
  zoneProps.forEach((z, i) => {
    if (z.ext || hasAutonomy(state, z)) return;
    const r = regionOf(state, z);
    if (!regs.has(r)) regs.set(r, []);
    regs.get(r).push(i);
  });
  const stale = (o) => o?.appointed && state.year - o.since >= ELECTION.every;   // 4년마다 인사
  const want = new Set();
  for (const [r, zs] of regs) {
    const gk = `g:${r}`;
    want.add(gk);
    if (!L.offices[gk] || stale(L.offices[gk])) L.offices[gk] = { appointed: true, title: governorTitle(r), name: personName(rng, 'KP'), region: r, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
    else if (L.offices[gk].appointed) L.offices[gk].title = governorTitle(r);
    for (const i of zs) {
      if (countyRep(i) !== i) continue;
      const t = mayorTitleOf(i), mk = `m:${i}`;
      if (!t) continue;
      want.add(mk);
      if (!L.offices[mk] || stale(L.offices[mk])) L.offices[mk] = { appointed: true, title: t, name: personName(rng, 'KP'), zone: i, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
      else if (L.offices[mk].appointed) L.offices[mk].title = t;
    }
  }
  // 지방자치를 시행한 곳의 관선 단체장은 민선이 대신한다 (첫 선거에서 바뀐다)
  for (const [k, o] of Object.entries(L.offices)) if (o.appointed && !want.has(k)) delete L.offices[k];
  // 예전 저장: 이름 없는 단체장
  for (const o of Object.values(L.offices)) if (!o.name) o.name = personName(rng, o.zone != null ? zoneProps[o.zone]?.country : o.region ? sideOfRegion(o.region) : 'KR');
}

export function electMayor(i, mood = 0, tally = null, onOut = null) {
  const L = state.local, mk = `m:${i}`, mc = L.offices[mk];
  const title = mayorTitleOf(i);
  if (!title) { delete L.offices[mk]; return null; }   // 광역시 전체인 시: 기초단체장 없음
  const one = (key, office, t, extra = {}) => {
    const { cur, why } = incumbent(office);
    if (why) onOut?.(why);
    const rg = regionOf(state, zoneProps[i]);
    const rm = runElection(leanP(zoneProps[i]) + supportShift(rg), cur, rng, mood, waveSup(L.support?.[rg]));
    if (cur && cur.party === rm.party) { cur.approval = 50 + (cur.approval - 50) / 2; cur.terms = (cur.terms || 1) + 1; cur.title = t; }
    else L.offices[key] = { title: t, name: personName(rng, zoneProps[i].country), zone: i, ...extra, party: rm.party, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
    L.offices[key].share = rm.share;
    return rm.party;
  };
  const won = one(mk, mc, title);
  for (const gu of (zoneGus(i) || []).slice(1)) {
    const p = one(`m:${i}#${gu}`, L.offices[`m:${i}#${gu}`], `${gu}청장`, { gu });
    if (tally) tally[p] = (tally[p] || 0) + 1;
  }
  return won;
}

// 지도에서 한 시군으로 보이는 존들(countyKey가 같은 존)의 대표: 가장 넓은 존. 시군 단체장·제안은 대표 존 번호로 단다
export let countyRepCache = null, countyRepFresh = false;
export function setCountyRepFresh(v) { return (countyRepFresh = v); }
export function countyRep(i) {
  // 한 번의 처리 안에서는 행정 설정을 다시 견주지 않는다 (존마다 부르는 곳이 많아 부를 때마다 JSON으로 견주면 무거웠다).
  // 행정 설정을 바꾸는 곳은 adminInvalidate()를 부른다
  if (countyRepFresh && countyRepCache?.state === state) return countyRepCache.rep[i];
  countyRepFresh = true;
  queueMicrotask(() => { countyRepFresh = false; });
  const sig = JSON.stringify([state.local?.admin, state.local?.historic, state.local?.independent, state.local?.cityUp, state.local?.annex, state.local?.renamedRegions, state.local?.gunToGu, state.adminNames, state.placeNames]);
  if (countyRepCache?.sig !== sig) {
    const best = new Map();
    zoneProps.forEach((z, j) => { const k = countyKey(j), b = best.get(k); if (b == null || (z.area || 0) > (zoneProps[b].area || 0)) best.set(k, j); });
    countyRepCache = { sig, rep: zoneProps.map((_, j) => best.get(countyKey(j))) };
  }
  countyRepCache.state = state;
  return countyRepCache.rep[i];
}
export function mayorKey(i) { return `m:${countyRep(i)}`; }
/** 존 i와 한 시군으로 보이는 존들 (옛 군 땅을 떼어 낸 조각 포함) */
export function countyZones(i) { const r = countyRep(i); return zoneProps.map((_, j) => j).filter((j) => countyRep(j) === r); }

/** 행정구역을 바꾼 뒤 시군 단체장 정리: 대표가 아닌 존의 단체장은 없애고, 단체장이 없는 시군은 새로 뽑고, 직함은 지금 이름으로 */
export function syncMayors() {
  adminInvalidate();
  const L = state.local;
  // 광역시 아래에는 일반구가 없다: 일반구로 나눈 시가 광역시에 들면 그 구들이 자치구가 된다 (함주시 상중구 → 함흥광역시 상중구).
  // 예전에는 일반구가 남아 '함주구 상중구'처럼 구 밑에 구가 생겼다. 새 자치구의 구청장은 아래에서 뽑는다
  for (const [u, b] of Object.entries(L.bungu || {})) {
    if (b.general && u.includes('|') && isMetroCity(annexRegion(u))) delete b.general;
  }
  for (const k of Object.keys(L.offices)) {
    if (!k.startsWith('m:')) continue;
    // 새로 세운 시군의 단체장: 그 시군이 있으면 둔다 (직함은 지금 이름으로)
    if (k.startsWith('m:split:')) {
      const u = admin()?.unit(k.slice(2));
      if (!L.splitUnit?.[k.slice(2)] || (admin() && !u)) delete L.offices[k];
      else if (u) L.offices[k].title = countyTitle(u.name, u.region);
      continue;
    }
    const [id, gu] = k.slice(2).split('#'), i = +id;
    const title = gu ? (zoneGus(i)?.slice(1).includes(gu) ? `${gu}청장` : null) : mayorTitleOf(i);
    if (L.offices[k].appointed) continue;   // 관선은 syncAppointed가 맡는다
    if (countyRep(i) !== i || !hasAutonomy(state, zoneProps[i]) || !title) { delete L.offices[k]; continue; }
    L.offices[k].title = title;
  }
  for (const [, zs] of regions()) {
    for (const i of zs) {
      if (countyRep(i) !== i || !mayorTitleOf(i)) continue;
      // 단체장이 없는 시군, 또는 분구로 새로 생긴 구의 구청장
      if (!L.offices[`m:${i}`] || L.offices[`m:${i}`].appointed || (zoneGus(i) || []).slice(1).some((gu) => !L.offices[`m:${i}#${gu}`])) electMayor(i);
    }
  }
  // 새로 세운 시군: 단체장이 없으면 뽑는다 (북측은 지방자치를 시작한 뒤)
  for (const u of splitUnits()) if (!L.offices[unitOfficeKey(u.id)] && hasAutonomy(state, zoneProps[unitRepZone(u.id)])) electUnitMayor(u.id);
  syncAppointed();
  if (result && map) paintZones();
}

/** 새로 세운 시군의 단체장 선거: 그 읍면동이 든 존들의 지역 성향을 인구로 가중 */
export function electUnitMayor(id, mood = 0, onOut = null) {
  const L = state.local, u = admin()?.unit(id);
  if (!u) return null;
  const key = unitOfficeKey(id), cur0 = L.offices[key];
  let w = 0, s = 0;
  for (const i of u.subs) { const p = Math.max(1, result ? result.subs.pop[i] : 1); w += p; s += p * leanP(zoneProps[subInfo(i)[0]]); }
  const { cur, why } = incumbent(cur0);
  if (why) onOut?.(why);
  const rm = runElection(s / w + supportShift(u.region), cur, rng, mood, waveSup(L.support?.[u.region]));
  const title = countyTitle(u.name, u.region), rep = unitRepZone(id);
  if (cur && cur.party === rm.party) { cur.approval = 50 + (cur.approval - 50) / 2; cur.terms = (cur.terms || 1) + 1; cur.title = title; }
  else L.offices[key] = { title, name: personName(rng, zoneProps[rep].country), zone: rep, unit: id, party: rm.party, since: state.year, approval: 50, accepted: 0, delivered: 0, terms: 1 };
  L.offices[key].share = rm.share;
  return rm.party;
}

/** 단체장 제안: 자기 지역의 혼잡 민원 가운데 가장 급한 것 (광역단체장은 해마다 1건, 시군구청장은 전국에서 6건) */
export function proposeProjects() {
  const L = state.local;
  const open = new Set(L.proposals.filter((p) => p.status === 'open').flatMap((p) => p.links));
  const work = linksUnderWork(state);
  const cand = requests.filter((r) => !r.links.some((id) => open.has(id) || work.has(id))).map((r) => {
    const zi = zoneOfLink(r.links[0]);
    return { r, zi, region: zi >= 0 ? regionOf(state, zoneProps[zi]) : null };
  }).filter((c) => c.zi >= 0 && hasAutonomy(state, zoneProps[c.zi]));
  const used = new Set();
  const add = (officeKey, c) => {
    const fix = defaultFix(linkAt(base, state, c.r.links[0]));
    if (!fix) return false;
    const cost = c.r.links.reduce((s, id) => s + upgradeCost(fix, linkAt(base, state, id)), 0);
    const l0 = linkAt(base, state, c.r.links[0]);
    L.proposals.push({ id: crypto.randomUUID(), office: officeKey, year: state.year, status: 'open', links: c.r.links, fix: fix.id, cost,
      title: `${l0.name || CLASS_LABEL[l0.cls]} ${resolve(fix.label, l0)}` });
    used.add(c.r);
    return true;
  };
  for (const [key, off] of Object.entries(L.offices)) {
    if (!key.startsWith('g:')) continue;
    const c = cand.find((x) => !used.has(x.r) && x.region === off.region);
    if (c) add(key, c);
  }
  // 지역 야당도 광역 단체마다 해마다 1건: 단체장 정당이 아닌 정당(민주당·국민의힘·개혁신당·정의당) 가운데 그 지역 지지율에 비례해 고른다
  // (제1야당만이 아니다: 3당 제안을 받아 주면 3당 지지가 올라 다음 선거에서 이변을 낼 수 있다)
  for (const [key, off] of Object.entries(L.offices)) {
    if (!key.startsWith('g:') || off.appointed) continue;
    const r = off.region, z0 = zoneProps.find((q) => !q.ext && regionOf(state, q) === r);
    if (!z0) continue;
    const sup = partySupport(z0, L.support?.[r]);
    const ps = ['D', 'P', 'R', 'J'].filter((k) => k !== off.party && !L.proposals.some((p) => p.status === 'open' && p.party === k && p.region === r));
    const tot = ps.reduce((t, k) => t + sup[k], 0);
    if (!tot) continue;
    let x = rng() * tot, opp = ps[0];
    for (const k of ps) { if ((x -= sup[k]) < 0) { opp = k; break; } }
    const c = cand.find((x) => !used.has(x.r) && x.region === r);
    if (c && add(null, c)) Object.assign(L.proposals[L.proposals.length - 1], { party: opp, region: r });
  }
  // 제3당(개혁신당·정의당)·무소속 단체장은 해마다 한 건 넘게 낸다: 자기 시군(광역단체장은 자기 광역 단체) 민원 가운데 가장 급한 것,
  // 없으면 같은 광역 단체 안에서 (기초단체장 6건 몫과 따로)
  for (const [key, off] of Object.entries(L.offices)) {
    if (off.appointed || !THIRD.includes(off.party)) continue;
    if (L.proposals.some((q) => q.office === key && q.year === state.year)) continue;
    const gov = key.startsWith('g:');
    const zi = gov ? -1 : +key.slice(2).split('#')[0];
    const region = gov ? off.region : regionOf(state, zoneProps[zi]);
    const mine = gov ? null : new Set(countyZones(zi));
    const c = (mine && cand.find((x) => !used.has(x.r) && mine.has(x.zi))) || cand.find((x) => !used.has(x.r) && x.region === region);
    if (c) add(key, c);
  }
  let n = 0;
  for (const c of cand) {
    if (n >= 6) break;
    if (used.has(c.r) || !L.offices[mayorKey(c.zi)]) continue;
    if (add(mayorKey(c.zi), c)) n++;
  }
}

export function acceptProposal(id) {
  const L = state.local, pr = L.proposals.find((p) => p.id === id);
  const r = startUpgrade(base, state, proposalCheck(pr).targets, pr.fix);
  if (!r.ok) { alert(r.reason); renderRequests(); return; }
  const proj = state.projects[state.projects.length - 1];
  proj.proposal = pr.id;
  pr.status = 'accepted';
  pr.decided = state.year;
  const off = L.offices[pr.office];
  if (off) { off.accepted++; bumpApproval(off, 3); }
  bumpSupport(proposalRegion(pr), proposalParty(pr), pr.party ? 1.5 : 1);   // 야당 제안을 받아 주면 그 당이 더 득을 본다
  // 같은 구간의 확장 요구는 공사가 시작됐으므로 목록에서 뺀다
  const work = linksUnderWork(state);
  setRequests(requests.filter((q) => !q.links.every((lid) => work.has(lid))));
  toast(`<b>받아들임</b> ${esc(pr.title)} · ${formatWon(proj.cost)} · ${proj.doneYear}년 완공 예정 (사업 탭)`);
  save(state); refreshLinks(); renderAll();
}

export function rejectProposal(id) {
  const L = state.local, pr = L.proposals.find((p) => p.id === id);
  pr.status = 'rejected';
  pr.decided = state.year;
  const off = L.offices[pr.office];
  if (off) bumpApproval(off, -4);
  bumpSupport(proposalRegion(pr), proposalParty(pr), -0.7);
  toast(`<b>거절</b> ${esc(pr.title)}`, 'no');
  save(state); renderAll();
}

/** 제안한 정당·광역 단체: 단체장 제안은 그 단체장의 정당, 야당 제안은 pr.party */
export function proposalParty(pr) { return pr.party || state.local.offices[pr.office]?.party || null; }
export function proposalRegion(pr) {
  if (pr.region) return pr.region;
  const off = state.local.offices[pr.office];
  return off?.region || (off?.zone != null ? regionOf(state, zoneProps[off.zone]) : null);
}
/** 제안한 쪽 표시 */
export function proposerHTML(pr) {
  const off = state.local.offices[pr.office];
  if (off) return `${partyBadge(off.party)} ${esc(off.title)}`;
  if (pr.party) return `${partyBadge(pr.party)} ${esc(PARTIES[pr.party]?.short || '')} ${esc(pr.region || '')}당 (야당)`;
  return '';
}

export function partyBadge(p) {
  const x = PARTIES[p];
  return x ? `<span class="op-badge" style="background:${x.color}">${x.short}</span>` : '';
}

export function officeLine(off) {
  if (!off) return '<span class="m">지방자치 미시행</span>';
  if (off.appointed) return `<span class="op-badge" style="background:#6b7280">관선</span> ${esc(off.title)} <b>${esc(off.name || '')}</b> <span class="m">${off.since}년~ · 중앙정부 임명 (북측 지방자치를 시행하면 선거로 뽑습니다)</span>`;
  const t = off.terms || 1;
  return `${partyBadge(off.party)} ${esc(off.title)} <b>${esc(off.name || '')}</b> <span class="m">${off.since}년~ · 지지율 ${Math.round(off.approval)}% · 제안 수용 ${off.accepted} · 완공 ${off.delivered}${t > 1 ? ` · ${t}선${t >= TERM_LIMIT ? ' (연임 제한, 다음 선거에 못 나옴)' : ''}` : ''}</span>`;
}

/** 민원 탭에 붙는 지자체 SOC 제안 */
/** 제안을 지금 받아들일 수 있는지: 이미 공사 중이거나 개량된 구간은 빼고 남는 구간·사업비 */
export function proposalCheck(p) {
  const u = UPGRADES.find((x) => x.id === p.fix);
  const work = linksUnderWork(state);
  const targets = u ? p.links.filter((id) => !work.has(id) && u.applies(linkAt(base, state, id))) : [];
  const cost = targets.reduce((a, id) => a + upgradeCost(u, linkAt(base, state, id)), 0);
  return { targets, cost, years: u?.years || 1, afford: targets.length > 0 && canAfford(state, cost, u.years, fundFor(state, targets.map((id) => linkAt(base, state, id)))) };
}

export function proposalsHTML() {
  const L = state.local;
  // 다른 경로로 이미 공사·개량이 된 제안은 조용히 닫는다 (거절이 아니므로 지지율은 그대로)
  for (const p of L.proposals) {
    if (p.status === 'open' && !p.party && !L.offices[p.office]) {
      const zi = zoneOfLink(p.links[0]);
      const k = zi >= 0 ? (L.offices[mayorKey(zi)] ? mayorKey(zi) : `g:${regionOf(state, zoneProps[zi])}`) : null;
      if (k && L.offices[k]) p.office = k; else p.status = 'moot';
    }
    if (p.status === 'open' && !proposalCheck(p).targets.length) { p.status = 'moot'; state.log.unshift(`${state.year}년 지자체 제안 종결 (이미 공사·개량됨): ${p.title}`); }
  }
  const open = L.proposals.filter((p) => p.status === 'open');
  // 올해 답한 제안은 그 자리에 결과 카드로 남긴다 (누른 뒤 무엇이 바뀌었는지 바로 보이게, 다음 해에 빠진다)
  const decided = L.proposals.filter((p) => p.decided === state.year && (p.status === 'accepted' || p.status === 'rejected'));
  const shown = L.proposals.filter((p) => p.status === 'open' || decided.includes(p));
  if (!open.length && !decided.length) return '';
  const doneRow = (p) => {
    const off = L.offices[p.office], proj = p.status === 'accepted' && state.projects.find((x) => x.proposal === p.id);
    return `<div class="item decided ${p.status}"><div class="t">${p.status === 'accepted' ? '✓ ' : ''}${esc(p.title)}</div>
      <div class="m">${proposerHTML(p) ? `${proposerHTML(p)} · ` : ''}${p.status === 'accepted'
        ? `<span class="pos">받아들임 · 공사 시작${proj ? ` · ${proj.doneYear}년 완공 예정` : ''}</span>` : '<span class="neg">거절함</span>'}</div></div>`;
  };
  return `<h3>지자체 SOC 제안 (${open.length})</h3>
    <p class="hint">선거로 뽑힌 단체장과 그 지역 야당(시도당)이 사업을 중앙정부에 제안합니다. 받아들여 완공하면 제안한 단체장의 지지율과 그 정당 지지가 올라 다음 선거에 유리합니다(야당 제안이면 야당이 득을 봅니다). 2년 안에 답하지 않으면 거절한 것으로 봅니다.</p>
    ${decided.length ? `<p class="hint">올해 답한 제안 ${decided.length}건: 받아들인 사업은 사업 탭에서 공사 진행을 볼 수 있습니다.</p>` : ''}
    <div class="list">${shown.map((p) => {
      if (p.status !== 'open') return doneRow(p);
      const off = L.offices[p.office], ck = proposalCheck(p);
      const partial = ck.targets.length < p.links.length ? ` · 일부 구간(${ck.targets.length}/${p.links.length})은 이미 공사 중` : '';
      return `<div class="item"><div class="t">${esc(p.title)}</div>
        <div class="m">구간: ${esc(spanText(p.links))}</div>
        <div class="m">${proposerHTML(p)} · ${p.year}년 제안 · ${formatWon(ck.cost)}${partial}</div>
        <div class="actions"><button class="small primary" data-prop-ok="${p.id}" ${ck.afford ? '' : 'disabled title="예산과 차입 한도가 부족합니다"'}>${ck.afford ? '받아들이기' : '받아들이기 (예산 부족)'}</button>
        <button class="small" data-prop-no="${p.id}">거절</button><button class="small" data-prop-show="${p.id}">보기</button></div></div>`;
    }).join('')}</div>`;
}

export function bindProposals(el) {
  el.querySelectorAll('[data-prop-ok]').forEach((b) => { b.onclick = () => acceptProposal(b.dataset.propOk); });
  el.querySelectorAll('[data-prop-no]').forEach((b) => { b.onclick = () => rejectProposal(b.dataset.propNo); });
  el.querySelectorAll('[data-prop-show]').forEach((b) => { b.onclick = () => { const p = state.local.proposals.find((x) => x.id === b.dataset.propShow); if (p) gotoLinks(p.links); }; });
}

/** 광역시로 독립·승격할 수 있는 도시 이름 */
export function promotableCities() {
  const L = state.local;
  const pops = new Map();
  zoneProps.forEach((z, i) => { if (!z.ext) pops.set(promotedName(state, z), (pops.get(promotedName(state, z)) || 0) + zonePop(i)); });
  // 복원 뒤에는 북측 옛 직할시(평양·남포)를 다시 독립시킬 수 있고, 모든 도의 인구 50만 이상 시를 광역시로 승격할 수 있다
  // (북측 도시는 지방자치를 도입한 뒤: 시장을 선거로 뽑으므로)
  return [
    ...(L.historic ? HISTORIC_CITIES.filter((c) => !L.independent.includes(c) && zoneProps.some((z) => z.province === c)) : []),
    ...[...pops].filter(([n, p]) => p >= PROMOTE_MIN_POP && /시$/.test(n) && !isMetroCity(n) && !L.independent.includes(n)
      && zoneProps.some((z) => promotedName(state, z) === n && !z.ext && (z.country === 'KR' || L.autonomyKP) && !isMetroCity(z.province) && !L.annex?.[unitId(state, z)])).map(([n]) => n),
  ];
}
export const cityZoneMatch = (c, z) => z.province === c || promotedName(state, z) === c;

/** 설정 탭: 지방자치·행정구역 이벤트 */
export function localSettingsHTML() {
  const L = state.local;
  const next = state.year < ELECTION.firstYear ? ELECTION.firstYear
    : ELECTION.firstYear + Math.ceil((state.year - ELECTION.firstYear + 1) / ELECTION.every) * ELECTION.every;
  return `<h4>지방자치</h4>
    <p class="hint">남측은 지방자치가 시행 중이고, 4년마다(다음: ${next}년) 광역·기초단체장 선거가 열립니다.</p>
    ${L.autonomyKP ? '<p class="hint">북측 지방자치 시행 중.</p>' : `<div class="item"><div class="t">북측 지방자치 도입</div>
      <div class="m">북측에도 도지사·시장·군수를 선거로 뽑습니다. 남북 통합도 30% 이상 · ${formatWon(EVENT_COST.autonomy)}</div>
      <button class="small primary" id="ev-autonomy" ${state.integration >= 0.3 ? '' : 'disabled'}>도입</button></div>`}
    ${adminSummaryHTML()}
    ${state.linesRenamed ? '<p class="hint">북측 노선 이름을 남측 기준으로 바꿨습니다.</p>' : `<div class="item"><div class="t">북측 노선 이름을 남측 기준으로</div>
      <div class="m">${Object.entries(KP_LINE_RENAME).map(([a, b]) => `${esc(a)}→${esc(b)}`).join(', ')}. 남북을 잇는 노선이 한 이름이 되어 직통 계통·노선도·수익성이 한 노선으로 묶입니다 · ${formatWon(LINE_RENAME_COST)}</div>
      <button class="small primary" id="ev-rename">바꾸기</button></div>`}
    <p class="hint">광역시 승격·군→시 승격·분구·편입은 지도에서 그 시·군을 누르면 나오는 창에서 합니다. 읍면동(북측은 면) 하나만 옮기려면 읍면동 보기에서 그 읍면동을 누르세요.</p>
    <div class="actions"><button class="small primary" data-unit-new>시군구 신설 (지도에서 읍면동 고르기)</button></div>`;
}

/** 시군 창: 이 시군에서 할 수 있는 행정구역 조정만 (광역시 승격, 군→시 승격, 분구, 다른 광역 단체로 편입, 맞닿은 시군 편입) */
export function zoneAdminHTML(id) {
  const z = zoneProps[id];
  if (z.ext) return '';
  const L = state.local, mine = new Set(countyZones(id)), rows = [];
  const inMine = (zs) => zs.some((j) => mine.has(j));
  const item = (t, m, act) => `<div class="item"><div class="t">${t}</div><div class="m">${m}</div><div class="row" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:4px">${act}</div></div>`;
  // 군에서 시로 갓 승격한 해에는 광역시 승격을 띄우지 않는다: 같은 자리에 같은 '승격' 단추가 바로 나타나 한 번 더 누르면 광역시가 됐다
  const justUp = [...mine].some((j) => L.cityUpYear?.[unitId(state, zoneProps[j])] === state.year);
  const city = justUp ? null : promotableCities().find((c) => [...mine].some((j) => cityZoneMatch(c, zoneProps[j])));
  if (city) {
    const indep = L.historic && HISTORIC_CITIES.includes(city);
    rows.push(item(`광역시 ${indep ? '독립' : '승격'}: ${esc(city)} → ${esc(metroName(city))}`,
      `도에서 떼어 광역시로 만들고 시장·도지사를 다시 뽑습니다. 분구하면 구마다 구청장을 뽑습니다 · ${formatWon(EVENT_COST.independence)}`,
      `${bunguSelect('bungu-n')} <button class="small primary" data-ev-city="${esc(city)}">${indep ? '광역시로 독립' : '광역시로 승격'}</button>`));
  }
  const up = cityUpTargets().find((c) => inMine(c.zones));
  if (up) rows.push(item(`군 → 시 승격: ${esc(up.name)} → ${esc(up.name.replace(/군$/, '시'))}`,
    `군수 대신 시장을 뽑습니다. 일반구로 나누면 구청장은 시장이 임명하고, 지도에서 구마다 고를 수 있습니다. 인구 ${PROMOTE_MIN_POP / 1e4}만을 넘으면 광역시로 승격할 수 있습니다 · ${formatWon(EVENT_COST.cityUp)}`,
    `${bunguSelect('bungu-n3', '일반구 없이')} <button class="small primary" data-city-up="${esc(up.key)}">시로 승격</button>`));
  const bu = bunguUnits().find(([u]) => inMine(unitZones(u)));
  // 이미 나눈 구를 다시 여러 구로 (시 안의 구·광역시 자치구·광역시 군을 바꾼 구)
  const bk = bunguUnitOf(id);
  if (bk && (z.country === 'KR' || L.autonomyKP)) {
    const names = [...new Set(Object.values(L.bungu[bk].gu))].sort((a, b) => a.localeCompare(b, 'ko'));
    rows.push(item('구 나누기', `구 하나를 여러 구로 나눕니다${L.bungu[bk].general ? ' (일반구: 구청장은 시장이 임명)' : ' (새 구마다 구청장 선거)'} · ${formatWon(EVENT_COST.cityUp)}`,
      `<select id="gu-split-name" class="small">${names.map((g) => `<option>${esc(g)}</option>`).join('')}</select> ${bunguSelect('gu-split-n', null, 2)} <button class="small primary" data-gu-split="${esc(bk)}">나누기</button>
       <button class="small" data-gu-adjust="${esc(bk)}">구 이름·경계 고치기</button>`));
  }
  if (bu) rows.push(item(`분구: ${esc(bu[1])}`,
    `읍면동을 묶어 여러 구로 나눕니다${isGeneralUnit(bu[0]) ? ' (일반구: 구청장은 시장이 임명)' : ' (구마다 구청장 선거)'} · ${formatWon(EVENT_COST.cityUp)}`,
    `${bunguSelect('bungu-n2', null, 2)} <button class="small primary" data-bungu="${esc(bu[0])}">분구</button>`));
  const at = annexTargets();
  const out = (at || []).flatMap(([r, cs]) => cs.filter((c) => inMine(c.zones)).map((c) => ({ r, c })));
  const annexBtn = ({ r, c }, gu = '') => `<button class="small primary" data-annex="${esc(c.key)}" data-annex-to="${esc(r)}" data-annex-zone="${c.via}"${gu ? ` data-annex-gu="${gu}"` : ''}>${esc(r)}에 편입</button>`;
  const toMetro = out.filter((o) => isMetroCity(o.r)), toProv = out.filter((o) => !isMetroCity(o.r));
  if (toMetro.length) {
    const isCity = /시$/.test(toMetro[0].c.name), pre = toMetro[0].c.name.replace(/시$/, '');
    rows.push(item(`광역시로 편입 (지금 ${esc(toMetro[0].c.region)})`,
      isCity ? `${esc(toMetro[0].c.name)}는 광역시의 자치구가 됩니다(${esc(pre)}구). 여러 자치구로 나누면(${esc(pre)}구·${esc(pre)}동구…) 구마다 구청장을 뽑습니다. 두 광역 단체장을 다시 뽑습니다 · ${formatWon(EVENT_COST.annex)} (분구하면 + ${formatWon(EVENT_COST.cityUp)})`
        : /구$/.test(toMetro[0].c.name) ? `구는 그 광역시의 자치구로 통째로 옮겨 갑니다(구청장은 그대로). 두 광역 단체장을 다시 뽑습니다 · ${formatWon(EVENT_COST.annex)}`
        : `군은 광역시의 군 그대로 들어갑니다. 두 광역 단체장을 다시 뽑습니다 · ${formatWon(EVENT_COST.annex)}`,
      `${isCity ? bunguSelect('annex-gu', '한 자치구로') : ''} ${toMetro.map((o) => annexBtn(o, isCity ? 'annex-gu' : '')).join('')}`));
  }
  if (toProv.length) rows.push(item(`다른 도로 편입 (지금 ${esc(toProv[0].c.region)})`,
    `맞닿은 도의 군이 됩니다. 두 광역 단체장을 다시 뽑습니다 · ${formatWon(EVENT_COST.annex)}`,
    toProv.map((o) => annexBtn(o)).join('')));
  const r = regionOf(state, z), inn = (at || []).find(([g]) => g === r)?.[1] || [];
  if (inn.length) rows.push(`<details class="item"><summary class="t">맞닿은 시군을 ${esc(r)}에 편입 (${inn.length}곳)</summary>
    <div class="m">${isMetroCity(r) ? '광역시는 맞닿은 군·구를 (시는 광역시 밑에 둘 수 없다)' : '도는 맞닿은 군을'} 편입합니다 · 한 곳 ${formatWon(EVENT_COST.annex)}</div>
    ${isMetroCity(r) && inn.some((c) => /시$/.test(c.name)) ? `<div class="m" style="margin-top:4px">시를 편입할 때 ${bunguSelect('annex-gu-in', '한 자치구로')}</div>` : ''}
    <div class="row" style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${inn.map((c) => `<button class="small" data-annex="${esc(c.key)}" data-annex-to="${esc(r)}" data-annex-zone="${c.via}"${isMetroCity(r) && /시$/.test(c.name) ? ' data-annex-gu="annex-gu-in"' : ''} title="${esc(c.region)}에서 ${esc(r)}로">${esc(c.name)} <span class="m">${esc(c.region)} ${fmtPop(c.pop)}</span></button>`).join('')}</div></details>`);
  // 광역시 산하 군을 구로 (그 자리에서 분구도)
  if (isMetroCity(regionOf(state, z)) && /군$/.test(zoneName(id)) && hasAutonomy(state, z) && !L.gunToGu?.includes(unitId(state, z))) {
    const nm = zoneName(id);
    rows.push(item(`구로 전환: ${esc(nm)} → ${esc(nm.replace(/군$/, '구'))}`,
      `광역시의 군을 자치구로 바꿉니다(군수 → 구청장). 여러 구로 나누면 구마다 구청장을 뽑습니다 · ${formatWon(EVENT_COST.cityUp)}`,
      `${bunguSelect('gun-gu', '한 구로')} <button class="small primary" data-gun-gu="${esc(unitId(state, z))}">바꾸기</button>`));
  }
  // 시: 동으로 바꿀 읍면 (북측은 1945년 면, 남측은 지금 읍·면)
  if (((kpMyeon && kpUnitKind(id) === 'si') || krSi(id)) && unitMyeonList(unitId(state, z)).length) {
    const k = unitId(state, z), n = (L.dongMyeon?.[k] || []).length;
    rows.push(item('동으로 바꿀 읍면', `시가지 읍면의 리를 동으로 바꿔 하나씩 보입니다 (지금 ${n}곳)`, `<button class="small" data-myeon-dong="${esc(k)}">고르기</button>`));
  }
  // 시군 나누기 (읍면동 단위, 북측은 면 단위): 광역시의 구·군은 빼고
  if (z.country === 'KR' || L.autonomyKP) {
    const k = unitId(state, z);
    rows.push(item('시군구 신설', `지도에서 읍면동(북측은 면)을 눌러 골라 새 시·군·구를 세웁니다(시티즈: 스카이라인의 구역처럼). 군에는 읍면만, 시에는 읍면동 모두 · ${formatWon(EVENT_COST.cityUp)}`,
      `<button class="small" data-split-unit="${esc(k)}">지도에서 고르기</button>`));
    for (const u of splitUnits()) {
      if (u.home !== k) continue;
      rows.push(item(`이 시군에서 떼어 세운 시군: <a href="#" data-unit-go="${esc(u.id)}">${esc(u.name)}</a>`, `${u.year}년 신설 · 읍면동 ${new Set(u.subs.map((i) => admin().emdOf[i])).size}곳${result ? ` · ${fmtPop(unitPop(u.id).pop)}` : ''}`,
        `<button class="small" data-merge-split="${esc(u.id)}">다시 합치기</button>`));
    }
  }
  // 북측 구역 → 구 (행정구역 정리의 한 항목: 첫해가 지나도 여기서 바꿀 수 있다)
  if (z.country === 'KP' && /구역$/.test(zoneName(id)) && L.admin?.guyeok !== 'gu') {
    rows.push(item('북측 구역을 구로 (전체)', `평양·남포·개성 등 북측의 ○○구역을 모두 ○○구로 부릅니다(${esc(zoneName(id))} → ${esc(zoneName(id).replace(/구역$/, '구'))}). 구역장은 구청장이 되고 선거는 하지 않습니다 · ${formatWon(EVENT_COST.cityUp)}`,
      '<button class="small primary" data-guyeok>바꾸기</button>'));
  }
  // 북측 직할시(평양·남포·개성·라선): 도에 딸리지 않은 독립시를 남측처럼 ○○광역시로 부른다 (단체장·지지율은 그대로 이어 간다)
  const rg = regionOf(state, z);
  if (KP_DIRECT_CITIES.includes(rg) || KP_DIRECT_CITIES.map(dueum).includes(rg)) {
    rows.push(item(`광역시로 명칭 변경: ${esc(rg)} → ${esc(rg.replace(/시$/, '광역시'))}`,
      `직할시(독립시)를 남측처럼 광역시로 부릅니다. 단체장은 그대로 직함만 바뀌고 선거는 하지 않습니다 · ${formatWon(EVENT_COST.cityUp)}`,
      `<button class="small primary" data-metro-rename="${esc(rg)}">바꾸기</button>`));
  }
  if (!rows.length && at == null) return '<h4>행정구역 조정</h4><p class="hint">경계 자료를 읽는 중…</p>';
  if (!rows.length) return '';
  return `<h4>행정구역 조정</h4>${rows.join('')}`;
}

// 부채 상환·사업·민원·통계 패널.
import { DIFFICULTY, formatWon, resolve } from '../game/catalog.js';
import { HOUSING } from '../game/housing.js';
import { opBadge } from '../game/operators.js';
import {
  cancelBlocked, cancelProject, defaultFix, effectiveNetwork, linkAt, PACES, REPAY_SHARES, repayDebt, save, setProjectPace, START_YEAR, startUpgrade, upgradeCost,
} from '../game/state.js';
import { t } from '../i18n.js';
import { toast } from '../ui/panel.js';
import { $, base, CLASS_LABEL, esc, map, requests, result, selection, setRequests, state, zoneProps } from './core.js';
import { zoneName } from './year.js';
import { allLinks, linkTwins, nodeCoord, nodeNames, provincePops, refreshLinks, setHighlight, shownTraffic } from './mapdata.js';
import { setUnivPickAmt, setUnivRankAll, univEntries, univList, univMaxFund, univPickAmt, univPicked, univRankAll, univRankTable } from './univ.js';
import { select } from './interact.js';
import { fmtPeople } from './draw.js';
import { fmtPop, pct, renderAll, renderTop, switchTab } from './panels.js';
import { bindPolicy, chart, policyHTML } from './econ.js';
import { airRatio, fmtRatio } from './svc.js';
import { bindProposals, proposalsHTML } from './election.js';
import { housingPlace, urbanName } from './housing.js';
import { pppTableHTML } from './ppp.js';
import { header } from './svcmap.js';
import { refreshClosed } from './reopen.js';
import { airportName } from './selpanel.js';
import { showGazette } from './gazette.js';

// ---- 부채 상환: 남은 예산으로 언제든 갚고, 해마다 자동으로 갚을 몫을 고른다
export function debtHTML(annual) {
  const d = DIFFICULTY[state.difficulty];
  if (state.debt <= 0) return '';
  const can = Math.max(0, Math.min(state.debt, state.budget));
  const share = state.repayShare ?? 0.2;
  // 다음 해로 넘어갈 때 연 예산을 넘는 몫은 불용된다: 그 몫은 갚는 편이 낫다
  const lapse = Math.max(0, state.budget - annual - d.annualBudget);
  return `<h3>부채 상환</h3>
    <p class="hint">부채 ${formatWon(state.debt)} · 연 이자 ${formatWon(Math.round(state.debt * d.interest))} (${(d.interest * 100).toFixed(1)}%) · 차입 한도 ${formatWon(d.borrowLimit)} · 가용 예산 ${formatWon(Math.max(0, state.budget))}.
      부채가 많을수록 지지율이 깎입니다.${lapse > 0 ? ` <b>내년으로 넘어갈 때 약 ${formatWon(lapse)}이 불용될 예정이니 상환에 쓰는 편이 낫습니다.</b>` : ''}</p>
    <div class="actions" style="flex-wrap:wrap;gap:6px">
      <button class="small primary" data-repay="${can}" ${can ? '' : 'disabled'}>${can >= state.debt ? '전액' : '가용 예산 모두'} 상환 ${formatWon(can)}</button>
      ${can > 1 ? `<button class="small" data-repay="${Math.round(can / 2)}">절반 ${formatWon(Math.round(can / 2))}</button>` : ''}
      <input type="number" id="repay-amt" min="0" step="1000" placeholder="억원" style="width:7em"><button class="small" id="repay-go">상환</button></div>
    <div class="pace" style="margin-top:6px">해마다 남은 예산에서 자동 상환 ${REPAY_SHARES.map((x) => `<button class="small ${x === share ? 'on' : ''}" data-repay-share="${x}">${Math.round(x * 100)}%</button>`).join('')}</div>`;
}

export function bindDebt(el) {
  const go = (amt) => {
    const r = repayDebt(state, amt);
    if (!r) { toast('갚을 예산이 없습니다.'); return; }
    toast(`${formatWon(r)}을 갚았습니다. 남은 부채 ${formatWon(state.debt)}.`);
    save(state); renderProjects(); renderTop();
  };
  el.querySelectorAll('[data-repay]').forEach((b) => { b.onclick = () => go(+b.dataset.repay); });
  el.querySelector('#repay-go')?.addEventListener('click', () => go(+el.querySelector('#repay-amt').value || 0));
  el.querySelectorAll('[data-repay-share]').forEach((b) => {
    b.onclick = () => { state.repayShare = +b.dataset.repayShare; save(state); renderProjects(); };
  });
}

export function renderProjects() {
  const el = $('[data-panel=projects]');
  const building = state.projects.filter((p) => p.status === 'building').sort((x, y) => x.doneYear - y.doneYear);
  const done = state.projects.filter((p) => p.status === 'done').slice(-15).reverse();
  const annual = building.filter((p) => !p.fund || p.fund === 'gov').reduce((s, p) => s + Math.min(p.annual, p.cost - p.paid), 0);
  const row = (p) => {
    const prog = Math.min(1, p.paid / Math.max(1, p.cost));
    const pace = p.pace || 1;
    const by = p.fund === 'ppp' ? ` · 민자 (정부 보조 ${Math.round((p.govShare || 0) * 100)}%)`
      : p.fund && p.fund !== 'gov' ? ` · ${opBadge(state, state.rail.merged ? 'merged' : p.fund)} 자체 재원` : '';
    const name = projectBounds(p) ? `<button class="t link" data-locate="${p.id}" title="지도에서 보기">${esc(p.label)}</button>` : `<div class="t">${esc(p.label)}</div>`;
    return `<div class="item">${name}
      <div class="m">${formatWon(p.cost)} · 연 ${formatWon(Math.min(p.annual, p.cost - p.paid))} · ${p.doneYear}년 ${p.kind === 'osm' ? '개통' : '완공'} 예정${by}</div>
      <div class="progress"><div style="width:${Math.round(prog * 100)}%"></div></div>
      ${['service', 'vehicles', 'airRoute', 'rename'].includes(p.kind) ? '' : `<div class="pace">투입 속도 ${PACES.map((x) =>
        `<button class="small ${x === pace ? 'on' : ''}" data-pace="${p.id}" data-v="${x}">${Math.round(x * 100)}%</button>`).join('')}</div>`}
      <div class="actions">${p.kind === 'new' || p.kind === 'upgrade' ? `<button class="small" data-gazette="${p.id}" title="이 사업의 고시문 (노선도·정거장 계획·위치도)">고시문</button>` : ''}
        ${cancelBlocked(p) ? '' : `<button class="small danger" data-cancel-proj="${p.id}" title="이미 낸 돈은 돌려받지 못하고 남은 사업비만 아낍니다">사업 취소</button>`}</div></div>`;
  };
  const ongoing = building.filter((p) => p.kind === 'osm'), mine = building.filter((p) => p.kind !== 'osm');
  el.innerHTML = `${debtHTML(annual)}
    <p class="hint">내년 정부 예산 투입: ${formatWon(annual)} / 연 예산 ${formatWon(DIFFICULTY[state.difficulty].annualBudget)}.
      사업마다 투입 속도를 바꾸면 연 투입액과 완공 연도가 달라집니다 (빠르게 하면 남은 사업비에 할증이 붙습니다).</p>
    <h3>진행 중인 사업 (이어받은 공사 ${ongoing.length})</h3>
    <div class="list">${ongoing.map(row).join('') || '<p class="hint">없습니다.</p>'}</div>
    <h3 style="margin-top:16px">새로 벌인 사업 (${mine.length})</h3>
    <div class="list">${mine.map(row).join('') || '<p class="hint">진행 중인 사업이 없습니다.</p>'}</div>
    ${pppTableHTML()}
    ${housingStatusHTML()}
    <h3 style="margin-top:16px">완공 (${state.projects.filter((p) => p.status === 'done').length})</h3>
    <div class="list">${done.map((p) => `<div class="item">${projectBounds(p) ? `<button class="t link" data-locate="${p.id}" title="지도에서 보기">${esc(p.label)}</button>` : `<div class="t">${esc(p.label)}</div>`}<div class="m">${p.doneYear}년 완공 · ${formatWon(p.cost)}${p.kind === 'new' || p.kind === 'upgrade' ? ` · <button class="t link" data-gazette="${p.id}">고시문</button>` : ''}</div></div>`).join('') || '<p class="hint">아직 없습니다.</p>'}</div>`;
  bindDebt(el);
  el.querySelectorAll('[data-locate]').forEach((b) => { b.onclick = () => locateProject(state.projects.find((x) => x.id === b.dataset.locate)); });
  el.querySelectorAll('[data-gazette]').forEach((b) => { b.onclick = () => showGazette(state.projects.find((x) => x.id === b.dataset.gazette)); });
  el.querySelectorAll('[data-house-go]').forEach((b) => {
    b.onclick = () => { const h = (state.housing || []).find((x) => x.id === b.dataset.houseGo); if (h) map.easeTo({ center: [h.lon, h.lat], zoom: 12.5, duration: 800 }); };
  });
  bindHousingRename(el);
  el.querySelectorAll('[data-pace]').forEach((b) => {
    b.onclick = () => { setProjectPace(state, b.dataset.pace, +b.dataset.v); save(state); renderProjects(); renderTop(); };
  });
  el.querySelectorAll('[data-cancel-proj]').forEach((b) => {
    b.onclick = () => {
      const p = state.projects.find((x) => x.id === b.dataset.cancelProj);
      if (!p) return;
      const left = Math.max(0, p.cost - p.paid);
      const hit = p.cost >= 50000 ? 2 : p.cost >= 10000 ? 1 : 0;
      if (!confirm(`${p.label}

사업을 취소할까요? 지금까지 낸 ${formatWon(p.paid)}은 돌려받지 못하고, 남은 ${formatWon(left)}을 아낍니다.${hit ? ` 짓다 만 사업이라 지지율이 ${hit} 내려갑니다.` : ''}`)) return;
      const r = cancelProject(base, state, p.id);
      if (!r.ok) { alert(r.reason); return; }
      save(state); refreshLinks(); refreshClosed(); renderAll();
    };
  });
}

/** 택지지구 현황: 공사 중(완공 연도·진행)과 입주 완료(입주민·분양 수익), 이름을 누르면 지도에서 본다 */
/** 택지지구 이름 바꾸기 단추 (그 지구의 사업·단지 도로 이름도 함께: ○○지구 1단계, ○○지구 연결도로) */
export function bindHousingRename(el) {
  el.querySelectorAll('[data-house-rename]').forEach((b) => {
    b.onclick = () => {
      const h = (state.housing || []).find((x) => x.id === b.dataset.houseRename);
      const v = h && prompt('택지지구 이름', h.name)?.trim();
      if (!v || v === h.name) return;
      for (const p of state.projects) if (p.label?.includes(h.name)) p.label = p.label.split(h.name).join(v);
      for (const l of state.newLinks) if (l.name?.includes(h.name)) l.name = l.name.split(h.name).join(v);
      state.log.unshift(`${state.year}년 택지지구 이름 변경: ${h.name} → ${v}`);
      h.name = v;
      save(state); refreshLinks(); renderAll();
    };
  });
}

/** 택지지구 현황 한 줄: 크기·세대·입지·입주·분양 수익·민원·단계별 공정 (건설 탭 목록과 지도에서 고른 지구 창) */
export function housingRowHTML(h, { panel = false } = {}) {
  const projOf = new Map(state.projects.filter((p) => p.kind === 'housing').map((p) => [p.id, p]));
  const sizeLabel = (h) => (h.ring ? `${h.size ? '' : '구역 '}${((h.R || 1) ** 2 * Math.PI).toFixed(1)}km²` : HOUSING.sizes[h.size]?.label || h.size);
  const row = (h) => {
    const phases = h.phases || [{ id: h.id, households: h.households || 0, done: h.done }];
    const ph = phases.map((p, k) => {
      const pr = projOf.get(p.id);
      const prog = p.done ? 1 : pr ? Math.min(1, pr.paid / Math.max(1, pr.cost)) : 0;
      return `${phases.length > 1 ? `${k + 1}단계 ` : ''}${p.done ? '준공' : `${pr?.doneYear ?? ''}년 준공 예정`}<div class="progress"><div style="width:${Math.round(prog * 100)}%"></div></div>`;
    }).join('');
    const occ = h.done ? 1 : (h.occupied || 0) / Math.max(1, h.persons);
    return `<div class="item"><button class="t link" data-house-go="${h.id}" title="지도에서 보기">${esc(h.name)}</button> <button class="small" data-house-rename="${h.id}" title="지구 이름 바꾸기">이름 바꾸기</button>
      <div class="m">${esc(housingPlace(h, true))} · ${sizeLabel(h)} · ${(h.households || 0).toLocaleString()}세대${h.score != null ? ` · 입지 ${Math.round(h.score * 100)}점` : ''}${h.levy ? ' · 광역교통개선대책' : ''}</div>
      <div class="m">입주 ${fmtPeople(h.done ? h.persons : h.occupied || 0)} / ${fmtPeople(h.persons)} (${Math.round(occ * 100)}%) · 분양 수익 ${formatWon(h.revenue)}${h.complaint ? ` · <span class="neg">교통 대책 민원 (철도역 ${(h.railKm || 0).toFixed(1)}km)</span>` : ''}</div>
      ${h.done ? '' : ph}</div>`;
  };
  if (!panel) return row(h);
  // 지도에서 고른 지구: 같은 내용을 표로
  const phases = h.phases || [{ id: h.id, households: h.households || 0, done: h.done }];
  const occ = h.done ? 1 : (h.occupied || 0) / Math.max(1, h.persons);
  return `${header(h.name)}
    <table class="kv">
      <tr><td>상태</td><td>${h.done ? '입주 완료' : h.built ? '입주 중' : '공사 중'}</td></tr>
      <tr><td>자리</td><td>${esc(housingPlace(h))}</td></tr>
      <tr><td>크기</td><td>${sizeLabel(h)} · ${(h.households || 0).toLocaleString()}세대</td></tr>
      ${h.score != null ? `<tr><td>입지 점수</td><td>${Math.round(h.score * 100)}점</td></tr>` : ''}
      <tr><td>입주</td><td>${fmtPeople(h.done ? h.persons : h.occupied || 0)} / ${fmtPeople(h.persons)} (${Math.round(occ * 100)}%)</td></tr>
      <tr><td>분양 수익</td><td>${formatWon(h.revenue)}</td></tr>
      ${h.levy ? '<tr><td>광역교통</td><td>광역교통개선대책 부담금</td></tr>' : ''}
      <tr><td>민원</td><td>${h.complaint ? `<span class="neg">교통 대책 민원 (철도역 ${(h.railKm || 0).toFixed(1)}km)</span>` : '없음'}</td></tr>
    </table>
    ${h.done ? '' : `<h4>공정</h4>${phases.map((q, k) => {
      const pr = projOf.get(q.id);
      const prog = q.done ? 1 : pr ? Math.min(1, pr.paid / Math.max(1, pr.cost)) : 0;
      return `<div class="m">${phases.length > 1 ? `${k + 1}단계 ` : ''}${q.done ? '준공' : `${pr?.doneYear ?? ''}년 준공 예정`} · ${Math.round(prog * 100)}%</div><div class="progress"><div style="width:${Math.round(prog * 100)}%"></div></div>`;
    }).join('')}`}
    <div class="actions" style="margin-top:8px"><button class="small" data-house-rename="${h.id}">이름 바꾸기</button></div>`;
}

export function housingStatusHTML() {
  const list = state.housing || [];
  if (!list.length) return '';
  const done = list.filter((h) => h.done), going = list.filter((h) => !h.done);
  const people = list.reduce((s, h) => s + (h.done ? h.persons : h.occupied || 0), 0);
  const row = (h) => housingRowHTML(h);
  return `<h3 style="margin-top:16px">택지지구 (${list.length})</h3>
    <p class="hint">입주 완료 ${done.length}곳 · 입주민 ${fmtPeople(people)}${going.length ? ` · 공사·입주 중 ${going.length}곳` : ''} · 민원 ${list.filter((h) => h.complaint).length}곳</p>
    <div class="list">${[...going, ...done].map(row).join('')}</div>`;
}

/** 사업이 놓인 범위 [[서, 남], [동, 북]]: 구간·공항·항공 노선·옛 이름(시군구). 찾을 수 없으면 null */
export function projectBounds(p) {
  const pts = [];
  for (const id of p.links || []) {
    const g = allLinks()[id]?.geom;
    if (g) for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) pts.push([g[k], g[k + 1]]);
  }
  const aps = (p.airport || p.kind === 'airRoute') ? effectiveNetwork(base, state).airports : [];
  for (const id of [p.airport, p.a, p.b]) {
    const ap = id != null && aps.find((a) => a.id === id);
    if (ap) pts.push([ap.lon, ap.lat]);
  }
  if (p.kind === 'rename' && p.key?.startsWith('z:')) { const z = zoneProps[+p.key.slice(2)]; if (z) pts.push([z.cx, z.cy]); }
  if (!pts.length) return null;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

/** 사업 이름을 누르면 지도를 그곳으로 옮기고 구간을 잠깐 밝힌다 (오른쪽 패널은 그대로) */
export let locateFlash = null;
export function locateProject(p) {
  const b = p && projectBounds(p);
  if (!b) return;
  map.fitBounds(b, { padding: 80, maxZoom: p.links?.length ? 12 : 9.5, duration: 900 });
  if (locateFlash) { clearTimeout(locateFlash.t); locateFlash.ids.forEach((i) => map.setFeatureState({ source: 'links', id: i }, { sel: false })); }
  const keep = new Set(selection?.type === 'link' ? selection.section?.ids || [selection.id] : selection?.type === 'multi' ? selection.ids : []);
  const ids = (p.links || []).filter((i) => !keep.has(i));
  ids.forEach((i) => map.setFeatureState({ source: 'links', id: i }, { sel: true }));
  locateFlash = { ids, t: setTimeout(() => { ids.forEach((i) => map.setFeatureState({ source: 'links', id: i }, { sel: false })); locateFlash = null; }, 3000) };
}

export let reqSide = 'all';   // 확장 요구 목록: 전체·남·북

/** 패널을 다시 그려도 스크롤 자리를 지킨다 (확장 요구를 들어준 뒤 목록 맨 위로 튀지 않게) */
export function keepScroll(el, fn) {
  const boxes = [];
  for (let e = el; e; e = e.parentElement) if (e.scrollTop) boxes.push([e, e.scrollTop]);
  fn();
  for (const [e, t] of boxes) e.scrollTop = t;
}

export function renderRequests() {
  const el = $('[data-panel=requests]');
  const c = $('#req-count');
  c.hidden = requests.length === 0;
  c.textContent = requests.length;
  const nKR = requests.filter((r) => !r.kp).length, nKP = requests.length - nKR;
  const shown = requests.map((r, i) => [r, i]).filter(([r]) => reqSide === 'all' || (reqSide === 'KP') === !!r.kp);
  const sideBtn = (v, label) => `<button class="small ${reqSide === v ? 'on' : ''}" data-req-side="${v}">${label}</button>`;
  const nn = nodeNames();
  el.innerHTML = `${proposalsHTML()}<h3>확장 요구 (${requests.length})</h3>
    <p class="hint">혼잡도(V/C)가 1.0을 넘는 상태가 2년 이상 이어진 노선입니다(남은 고속도로·간선국도, 북은 모든 도로, 그리고 철도). 방치하면 지지율이 떨어집니다. 넓혀도 통행비용이 줄면 수요가 다시 늘 수 있습니다.</p>
    <div class="pace">${sideBtn('all', `전체 ${requests.length}`)}${sideBtn('KR', `남 ${nKR}`)}${sideBtn('KP', `북 ${nKP}`)}</div>
    <div class="list">${shown.map(([r, i]) => {
      const l = linkAt(base, state, r.links[0]);
      const fix = defaultFix(l);
      const cost = fix ? r.links.reduce((sum, id) => sum + upgradeCost(fix, linkAt(base, state, id)), 0) : 0;
      return `<div class="item"><div class="t">${esc(r.name || CLASS_LABEL[r.cls])} · ${r.km.toFixed(0)}km</div>
        <div class="m">${esc(spanText(r.links, nn))}</div>
        <div class="m">${CLASS_LABEL[r.cls]} · ${r.kp ? '북' : '남'} · 최대 V/C ${r.vc.toFixed(2)} · ${r.years}년째 · ${r.links.length}개 구간</div>
        <div class="row">
          ${fix ? `<button class="small primary" data-fix="${i}">${resolve(fix.label, l)} ${formatWon(cost)}</button>` : ''}
          <button class="small" data-goto="${i}">보기</button>
          <button class="small" data-dismiss="${i}">올해 보류</button>
        </div></div>`;
    }).join('') || '<p class="hint">요구가 없습니다.</p>'}</div>
    ${policyHTML()}`;
  bindPolicy(el);
  el.querySelectorAll('[data-req-side]').forEach((b) => { b.onclick = () => { reqSide = b.dataset.reqSide; keepScroll(el, renderRequests); }; });
  el.querySelectorAll('[data-fix]').forEach((b) => {
    b.onclick = () => {
      const r = requests[+b.dataset.fix];
      const fix = defaultFix(linkAt(base, state, r.links[0]));
      const res = startUpgrade(base, state, r.links, fix.id);
      if (!res.ok) return alert(res.reason);
      setRequests(requests.filter((q) => q !== r));
      // 목록을 닫거나 맨 위로 돌리지 않고 그 자리에서 다음 요구를 이어서 볼 수 있게
      save(state); refreshLinks();
      keepScroll(el, () => { renderTop(); renderProjects(); renderRequests(); });
    };
  });
  el.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => gotoLinks(requests[+b.dataset.goto].links); });
  bindProposals(el);
  el.querySelectorAll('[data-dismiss]').forEach((b) => {
    b.onclick = () => {
      const r = requests[+b.dataset.dismiss];
      state.dismissed[r.key] = state.year;
      setRequests(requests.filter((q) => q !== r));
      save(state); keepScroll(el, renderRequests);
    };
  });
}

/** 구간 묶음을 화면에 맞추고 모두 고른 뒤 굵게 강조한다 ('같은 이름 노선 전체'를 고를 때처럼) */
export function gotoLinks(ids) {
  const xs = [], ys = [];
  for (const id of ids) {
    const g = allLinks()[id].geom;
    for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) { xs.push(g[k]); ys.push(g[k + 1]); }
  }
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 12 });
  select(ids.length > 1 ? { type: 'multi', ids } : { type: 'link', id: ids[0] });
  setHighlight({ links: ids });
}

/** 구간 묶음의 양 끝 이름과 길이: "○○IC–△△JCT · 12km" (끝에 이름 붙은 점이 없으면 그 자리 시가지·읍내) */
export function spanText(ids, names = nodeNames()) {
  const all = allLinks(), deg = new Map();
  let km = 0;
  for (const id of ids) {
    const l = all[id];
    if (!l) continue;
    km += l.len || 0;
    for (const n of [l.a, l.b]) deg.set(n, (deg.get(n) || 0) + 1);
  }
  let ends = [...deg].filter(([, d]) => d === 1).map(([n]) => n);
  if (ends.length < 2) ends = [...deg.keys()];
  // 끝이 여럿(갈래)이면 가장 먼 두 끝
  let best = [ends[0], ends[ends.length - 1]], bd = -1;
  for (const a of ends) for (const b of ends) {
    const p = nodeCoord(a), q = nodeCoord(b);
    const d = p && q ? (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 : -1;
    if (d > bd) { bd = d; best = [a, b]; }
  }
  const nm = (n) => { const v = names.get(n); if (v) return v.name; const c = nodeCoord(n); return c ? urbanName(c[0], c[1]) : ''; };
  const [a, b] = best.map(nm);
  return `${a && b && a !== b ? `${a}–${b}` : a || b || ''}${km ? ` · ${km.toFixed(km < 10 ? 1 : 0)}km` : ''}`;
}

/** 통계 탭: 항공·철도·도로 순위와 연도별 추이 */
export function renderStats() {
  const el = $('[data-panel=stats]');
  if (!el) return;
  if (!result) { el.innerHTML = '<p class="hint">계산 중입니다…</p>'; return; }
  const air = result.air, seats = air.seats;
  const totalAir = air.routes.reduce((s, r) => s + r[2], 0);
  const aps = effectiveNetwork(base, state).airports;
  const country = (id) => aps.find((a) => a.id === id)?.country;
  const intlPax = air.routes.filter(([a, b]) => country(air.ids[a]) !== country(air.ids[b])).reduce((s, r) => s + r[2], 0);
  const routeRows = air.routes.slice(0, 15).map(([a, b, pax, f]) =>
    `<tr><td>${esc(airportName(air.ids[a]))}–${esc(airportName(air.ids[b]))}</td><td>${f}</td><td>${pax.toLocaleString()}</td><td>${Math.round(pax / (2 * f * seats) * 100)}%</td>
      <td class="${airRatio(aps, air.ids[a], air.ids[b], pax, f) > 100 ? 'neg' : ''}">${fmtRatio(airRatio(aps, air.ids[a], air.ids[b], pax, f))}</td></tr>`).join('');
  const apRows = air.ids.map((id, k) => [id, air.pax[k], air.cap[k]]).sort((x, y) => y[1] - x[1]).slice(0, 10)
    .map(([id, pax, cap]) => `<tr><td>${esc(airportName(id))}</td><td>${Math.round(pax).toLocaleString()}</td><td class="${pax > cap ? 'neg' : ''}">${(pax / cap).toFixed(2)}</td></tr>`).join('');
  const latentRows = air.latent.slice(0, 8).map(([a, b, pax]) =>
    `<tr><td>${esc(airportName(air.ids[a]))}–${esc(airportName(air.ids[b]))}</td><td>${pax.toLocaleString()}</td></tr>`).join('');
  // 철도역
  const nn = nodeNames();
  const stRows = [...result.stations.node].map((nd, k) => [nn.get(nd)?.name || '', result.stations.riders[k]])
    .sort((x, y) => y[1] - x[1]).slice(0, 10).map(([n, v]) => `<tr><td>${esc(n)}</td><td>${Math.round(v).toLocaleString()}</td></tr>`).join('');
  // 노선별 최대 이용객·혼잡 (같은 이름끼리)
  const byName = (mode) => {
    const m = new Map();
    allLinks().forEach((l, i) => {
      const e = linkAt(base, state, i);
      if (e.mode !== mode || !e.name || e.ext || i >= result.links.vc.length) return;
      const cur = m.get(e.name) || { vol: 0, vc: 0, cls: e.cls };
      cur.vol = Math.max(cur.vol, shownTraffic.vol[linkTwins[i]]); cur.vc = Math.max(cur.vc, shownTraffic.vc[linkTwins[i]]);
      m.set(e.name, cur);
    });
    return [...m.entries()];
  };
  const railRows = byName(1).sort((x, y) => y[1].vol - x[1].vol).slice(0, 10)
    .map(([n, v]) => `<tr><td>${esc(n)}</td><td>${Math.round(v.vol).toLocaleString()}</td><td class="${v.vc > 1 ? 'neg' : ''}">${v.vc.toFixed(2)}</td></tr>`).join('');
  const roadRows = byName(0).filter(([, v]) => v.cls === 'motorway' || v.cls === 'trunk').sort((x, y) => y[1].vc - x[1].vc).slice(0, 10)
    .map(([n, v]) => `<tr><td>${esc(n)}</td><td>${Math.round(v.vol).toLocaleString()}</td><td class="${v.vc > 1 ? 'neg' : ''}">${v.vc.toFixed(2)}</td></tr>`).join('');
  const h = state.history;
  const sidoRows = [...provincePops()].sort((x, y) => y[1].pop - x[1].pop).map(([n, p]) => {
    const c = p.pop / Math.max(p.pop0, 1) - 1;
    return `<tr><td>${esc(n)} <span class="m">${p.country === 'KP' ? '북' : '남'}</span></td><td>${fmtPop(p.pop)}</td><td class="${c >= 0 ? 'pos' : 'neg'}">${c >= 0 ? '+' : ''}${pct(c)}</td></tr>`;
  }).join('');
  el.innerHTML = `
    <h3>광역지자체 인구</h3>
    <table class="cmp"><tr><th>광역지자체</th><th>인구</th><th>${START_YEAR}년 대비</th></tr>${sidoRows}</table>
    <p class="hint">지도 범례에서 "광역지자체 인구 (합계)"를 고르면 지도에서도 볼 수 있습니다. 광역시 승격·북측 도 복원이 바로 반영됩니다.</p>
    ${univRankTable()}
    <h3 style="margin-top:16px">항공</h3>
    <table class="kv">
      <tr><td>운항 노선</td><td>${air.routes.length}개 (${state.air.auto ? '자동 운영' : '수동'})</td></tr>
      <tr><td>하루 항공 여객</td><td>${Math.round(totalAir).toLocaleString()}명 (국제선 ${pct(intlPax / Math.max(totalAir, 1), 0)})</td></tr>
    </table>
    <h4>노선 순위</h4><table class="cmp"><tr><th>노선</th><th>회/일</th><th>여객/일</th><th>탑승률</th><th>영업계수</th></tr>${routeRows}</table>
    <h4>공항 순위</h4><table class="cmp"><tr><th>공항</th><th>여객/일</th><th>V/C</th></tr>${apRows}</table>
    ${latentRows ? `<h4>미취항 잠재 수요</h4><table class="cmp"><tr><th>노선</th><th>여객/일</th></tr>${latentRows}</table>` : ''}
    ${result.totals.tourDest ? `<h3 style="margin-top:16px">관광</h3>
    <table class="cmp"><tr><th>목적지</th><th>관광 통행/일</th></tr>${Object.entries(result.totals.tourDest).sort((x, y) => y[1] - x[1]).slice(0, 10)
      .map(([z, v]) => `<tr><td>${esc(zoneName(+z))}${zoneProps[z].sites ? ` <span class="m">${esc(zoneProps[z].sites.join(', '))}</span>` : ''}</td><td>${Math.round(v).toLocaleString()}</td></tr>`).join('')}</table>` : ''}
    <h3 style="margin-top:16px">철도</h3>
    <h4>역 순위 (지역 간 승하차)</h4><table class="cmp"><tr><th>역</th><th>명/일</th></tr>${stRows}</table>
    <h4>노선 순위 (최대 구간 이용객)</h4><table class="cmp"><tr><th>노선</th><th>명/일</th><th>V/C</th></tr>${railRows}</table>
    <p class="hint">철도 회사 수지·노선별 영업계수·운행 계통은 <a href="#" data-goto-tab="ops">운영 탭</a>에 있습니다.</p>
    <h3 style="margin-top:16px">도로</h3>
    <h4>가장 막히는 고속도로·간선국도</h4><table class="cmp"><tr><th>노선</th><th>PCU/일</th><th>V/C</th></tr>${roadRows}</table>
    ${h.length > 1 ? `<h3 style="margin-top:16px">추이</h3>
      ${chart('북측 인구 (백만)', h.map((r) => [r.year, r.kpPop / 1e6]))}
      ${chart('북측 HDI', h.map((r) => [r.year, r.kpHdi]))}
      ${chart('소득 격차 (배)', h.map((r) => [r.year, r.krInc / r.kpInc]))}
      ${h.some((r) => r.happyKP) ? chart('북측 주민 행복도', h.filter((r) => r.happyKP).map((r) => [r.year, r.happyKP])) : ''}
      ${chart('철도 분담률 (%)', h.map((r) => [r.year, r.rail * 100]))}
      ${h.some((r) => r.air) ? chart('항공 분담률 (%)', h.filter((r) => r.air != null).map((r) => [r.year, r.air * 100])) : ''}
      ${chart('지지율 (%)', h.filter((r) => r.approval != null).map((r) => [r.year, r.approval]))}` : '<p class="hint">해를 넘기면 연도별 추이가 쌓입니다.</p>'}`;
  el.querySelectorAll('[data-goto-tab]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); switchTab(a.dataset.gotoTab); }; });
  el.querySelector('[data-univ-more]')?.addEventListener('click', () => { setUnivRankAll(!univRankAll); renderStats(); });
  // 대학 여러 곳에 한꺼번에 재정 투입
  const pickN = () => { const n = el.querySelector('[data-univ-pick-n]'); if (n) n.textContent = univPicked.size; };
  el.querySelectorAll('[data-univ-pick]').forEach((c) => { c.onchange = () => { if (c.checked) univPicked.add(c.dataset.univPick); else univPicked.delete(c.dataset.univPick); pickN(); }; });
  el.querySelector('[data-univ-pick-all]')?.addEventListener('change', (e) => {
    el.querySelectorAll('[data-univ-pick]').forEach((c) => { c.checked = e.target.checked; if (c.checked) univPicked.add(c.dataset.univPick); else univPicked.delete(c.dataset.univPick); });
    pickN();
  });
  el.querySelector('[data-univ-pick-amt]')?.addEventListener('change', (e) => { setUnivPickAmt(Math.max(0, Math.round(+e.target.value || 0))); });
  const applyPick = (amtOf, label) => {
    if (!univPicked.size) { toast('대학 순위 표에서 대학을 고르세요.'); return; }
    const es = univEntries().filter((e) => univPicked.has(e.key));
    const sum = es.reduce((t, e) => t + amtOf(e), 0);
    if (!confirm(`고른 대학 ${es.length}곳에 ${label} (합계 연 ${formatWon(sum)})`)) return;
    for (const e of es) {
      const v = amtOf(e);
      if (v) (state.univFund ||= {})[e.key] = v; else delete state.univFund?.[e.key];
      delete state.univFundUntil?.[e.key];
    }
    state.log.unshift(`${state.year}년 대학 ${es.length}곳 재정 투입 조정: 합계 연 ${formatWon(sum)}`);
    save(state); renderStats();
  };
  el.querySelector('[data-univ-pick-apply]')?.addEventListener('click', () => applyPick(() => univPickAmt, `연 ${formatWon(univPickAmt)}씩 넣을까요?`));
  el.querySelector('[data-univ-pick-max]')?.addEventListener('click', () => applyPick((e) => univMaxFund(e.seats), '대학마다 최대 금액(교육 효과 95%)을 넣을까요?'));
  el.querySelector('[data-univ-pick-clear]')?.addEventListener('click', () => applyPick(() => 0, '재정 투입을 끌까요?'));
  el.querySelectorAll('[data-univ-go]').forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      const u = univList().find((x) => x.key === a.dataset.univGo);
      if (!u) return;
      map.easeTo({ center: [u.lon, u.lat], zoom: Math.max(map.getZoom(), 11), duration: 700 });
      select({ type: 'univ', id: u.key });
    };
  });
}

// 일반철도–도시철도 환승 연결, 역세권 개발, 열차 지도 자료, 노드 이름 바꾸기.
import { formatWon } from '../game/catalog.js';
import { develPlan, startDevel } from '../game/devel.js';
import { operatorOf } from '../game/operators.js';
import { OPERATING } from '../game/services.js';
import { baseTransfers, canAfford, effectiveNetwork, linkAt, linkPending, OP_FACTORS, save, startProject } from '../game/state.js';
import { autoBrand } from '../game/trainnames.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { base, CLASS_LABEL, esc, map, namer, result, state, zoneProps } from './core.js';
import { zoneName } from './year.js';
import { allLinks, nodeCoord, nodeNames, refreshPoints, smoothParts } from './mapdata.js';
import { renderAll } from './panels.js';
import { renderSelection } from './econ.js';
import { foreignCountry, serviceBrand } from './operators.js';
import { pathCoords } from './straighten.js';
import { linesAt, popWithin } from './gazette.js';

// ------------------------------------------------------------ 일반철도–도시철도 환승 연결

export const TRANSFER = { base: 800, perKm: 1000, years: 2, maxKm: 1.5 };

/**
 * 역 패널: 일반철도역이면 가까운 도시철도역, 도시철도역이면 가까운 일반철도역과의 환승 연결.
 * 지으면 도시철도역 근처 사람이 도시철도를 타고 와서 이 철도역에서 갈아탈 수 있다 (모형: 철도 후보 역에 더해짐)
 */
export function transferHTML(id, lines) {
  const isRail = lines.some((l) => l.mode === 1), isMetro = lines.some((l) => l.mode === 2);
  if (!isRail && !isMetro) return '';
  const c = nodeCoord(id);
  const builtIn = baseTransfers(base).filter(([r, m]) => r === id || m === id).map(([rail, metro]) => ({ rail, metro, built: true, base: true }));
  const mine = [...builtIn, ...(state.transfers || []).filter((t) => t.rail === id || t.metro === id)];
  const linked = new Set(mine.map((t) => (t.rail === id ? t.metro : t.rail)));
  const cand = [];
  for (const [node, v] of nodeNames()) {
    if (v.kind !== 'station' || node === id || typeof node !== 'number' || linked.has(node)) continue;
    const p = nodeCoord(node);
    if (!p || Math.abs(p[0] - c[0]) > 0.03 || Math.abs(p[1] - c[1]) > 0.02) continue;
    const d = kmBetween(c[0], c[1], p[0], p[1]);
    if (d > TRANSFER.maxKm) continue;
    const ls = linesAt(node);
    // 일반철도역에는 도시철도역을, 도시철도역에는 일반철도역을 (둘 다 있는 역은 양쪽)
    const other = (isRail && ls.some((l) => l.mode === 2)) || (isMetro && ls.some((l) => l.mode === 1));
    if (other) cand.push({ node, name: v.name, d, ls });
  }
  cand.sort((a, b) => a.d - b.d);
  const cost = (d) => Math.round(TRANSFER.base + TRANSFER.perKm * d);
  const nm = (n) => esc(nodeNames().get(n)?.name || '역');
  const rows = mine.map((t) => `<tr><td>${nm(t.rail === id ? t.metro : t.rail)}</td><td>${t.base ? '연결됨 (기존 환승역)' : t.built ? '연결됨' : '공사 중'}</td></tr>`).join('');
  return `<h4>일반철도–도시철도 환승 연결</h4>
    <p class="hint">통로·연결선을 놓아 도시철도로 와서 이 역 열차로 갈아타게 합니다. 도시철도역 근처 주민이 이 역을 쓰게 되어 철도 수요가 늡니다.</p>
    ${rows ? `<table class="kv">${rows}</table>` : ''}
    <div class="list">${cand.slice(0, 5).map((x) => {
      const k = cost(x.d), ok = canAfford(state, k, TRANSFER.years);
      return `<div class="item opt"><div class="opt-row"><span>${esc(x.name)} <span class="m">${x.ls.filter((l) => l.named).map((l) => esc(l.name)).slice(0, 3).join(', ')} · ${Math.round(x.d * 1000)}m</span></span>
        <button class="small ${ok ? 'primary' : ''}" data-xfer="${x.node}" ${ok ? '' : 'disabled'}>${formatWon(k)} · ${TRANSFER.years}년</button></div></div>`;
    }).join('') || (rows ? '' : `<p class="hint">${TRANSFER.maxKm}km 안에 이을 ${isRail ? '도시철도' : '일반철도'}역이 없습니다.</p>`)}</div>`;
}

export function startTransfer(id, other) {
  const isRailHere = linesAt(id).some((l) => l.mode === 1) && linesAt(other).some((l) => l.mode === 2);
  const rail = isRailHere ? id : other, metro = isRailHere ? other : id;
  const [a, b] = [nodeCoord(id), nodeCoord(other)];
  const d = kmBetween(a[0], a[1], b[0], b[1]);
  const cost = Math.round(TRANSFER.base + TRANSFER.perKm * d);
  if (!canAfford(state, cost, TRANSFER.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
  const nn = nodeNames();
  const pid = crypto.randomUUID();
  (state.transfers ||= []).push({ id: pid, rail, metro, built: false });
  startProject(state, { id: pid, kind: 'transfer', links: [], stations: [], cost, years: TRANSFER.years,
    label: `환승 연결: ${nn.get(rail)?.name || '철도역'} ↔ ${nn.get(metro)?.name || '도시철도역'}` });
  save(state); renderAll();
}

/**
 * 지도 열차 위치 자료: 기본 열차는 철도·도시철도 구간마다 (이용객만큼, 최소 운행 이상), 운행 계통은 계통 경로를 따라
 */
export function trainsData() {
  if (!result) return null;
  const OP = OPERATING, vol = result.links.vol, nn = nodeNames();
  const links = [];
  allLinks().forEach((l0, i) => {
    const l = linkAt(base, state, i);
    if ((l.mode !== 1 && l.mode !== 2) || l.ext || state.replaced?.[i] || l.replaced || linkPending(base, state, i) || i >= vol.length) return;
    if (i >= base.links.length && !l.built) return;
    if (state.closedLines?.[l.name]) return;
    const cls = l.mode === 2 ? 'metro' : l.cls === 'hsr' ? 'hsr' : 'conv';
    const kp = l.kp && l.mode === 1 && !state.rail?.merged;
    const f = state.lineFreq?.[l.name] || 1;
    const trains = Math.min(300, Math.max(OP.minTrains[cls] * f * (kp ? OP_FACTORS.kpMinTrains : 1), vol[i] / (OP.paxPerTrain[cls] * OP.loadFactor)));
    if (vol[i] < 1 && l.mode === 1) return;   // 여객이 없는 선로 (화물선 등)
    const parts = smoothParts(l0, i);
    const coords = parts.reduce((a, p) => (p.length > a.length ? p : a), []);
    links.push({ coords, trains, speed: l.speed, cls, label: `${autoBrand(cls, operatorOf(state, l))} · ${l.name || CLASS_LABEL[l.cls]}` });
  });
  const net = effectiveNetwork(base, state);
  const services = (state.services || []).filter((s) => s.built).map((s) => {
    const coords = [];
    for (const seg of s.segs) {
      const c = pathCoords(net.links, seg.via, seg.a);
      coords.push(...(coords.length ? c.slice(1) : c));
    }
    const brand = serviceBrand(s), a = nn.get(s.stops[0])?.name || '', b = nn.get(s.stops[s.stops.length - 1])?.name || '';
    return { coords, runMin: s.runMin, trains: s.trains, kind: s.kind, down: `${a}발 ${b}행 ${brand} (${s.name})`, up: `${b}발 ${a}행 ${brand} (${s.name})` };
  });
  return { links, services };
}

/** 역이 놓인 존 (가장 가까운 읍면동 중심의 존) */
export function zoneAtPoint(lon, lat) {
  let best = -1, bd = Infinity;
  zoneProps.forEach((z, i) => {
    if (z.ext) return;
    for (const [x, y] of z.subs) { const d = (x - lon) ** 2 + (y - lat) ** 2; if (d < bd) { bd = d; best = i; } }
  });
  return best;
}

export function develPlanAt(id) {
  const c = nodeCoord(id);
  const zone = zoneAtPoint(c[0], c[1]);
  return { c, zone, plan: develPlan({ pop3km: popWithin(c[0], c[1], 3), zone: zoneProps[zone], lat: c[1], lon: c[0] }) };
}

/** 역 패널: 역세권 개발사업 */
export function develHTML(id, n) {
  if (foreignCountry(id) || !linesAt(id).length) return '';
  const d = (state.devels || []).find((x) => x.node === id);
  if (d) {
    const p = state.projects.find((x) => x.id === d.id);
    return `<h4>역세권 개발</h4><p class="hint">${d.done ? `완공 · 인구 ${d.persons.toLocaleString()}명 입주 · 분양 수익 ${formatWon(d.revenue)}` : `공사 중 · ${p?.doneYear ?? ''}년 완공 예정 (순유입 ${d.persons.toLocaleString()}명, 분양 수익 ${formatWon(d.revenue)} 예상)`}</p>`;
  }
  const { zone, plan } = develPlanAt(id);
  const label = { capital: '수도권', metro: '광역시', other: '지방', kp: '북측' }[plan.cls];
  return `<h4>역세권 개발</h4>
    <p class="hint">역 주변에 주거·업무 단지를 지어 인구를 끌어들입니다. 다 지으면 분양 수익이 예산으로 돌아오고, ${esc(zoneName(zone))} 주민 행복도가 오릅니다.</p>
    <table class="kv">
      <tr><td>사업비 · 공기</td><td>${formatWon(plan.cost)} · ${plan.years}년</td></tr>
      <tr><td>인구 순유입 (다른 지역에서)</td><td>${plan.persons.toLocaleString()}명</td></tr>
      <tr><td>분양 수익 (${label}, 완공 때)</td><td class="${plan.revenue >= plan.cost ? 'pos' : ''}">${formatWon(plan.revenue)}</td></tr>
    </table>
    <button class="small primary" id="devel-ok" data-node="${id}">역세권 개발 착공</button>`;
}

export function commitDevel(id) {
  const n = nodeNames().get(id);
  const { c, zone, plan } = develPlanAt(id);
  if (!confirm(`${n?.name || ''}역 역세권 개발을 착공할까요? ${formatWon(plan.cost)} · ${plan.years}년`)) return;
  const r = startDevel(state, { node: id, name: (n?.name || '').replace(/역$/, ''), zone, lon: c[0], lat: c[1], plan });
  if (!r.ok) { alert(r.reason); return; }
  save(state); renderAll();
}

export function flyToNode(node) {
  const c = nodeCoord(node);
  if (c) map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 11) });
}

export function renameNode(id, name) {
  const cur = nodeNames().get(id);
  if (!name || name === cur.name) return;
  if (namer.isUsed(name, cur.kind)) { alert(`'${name}'은(는) 이미 쓰이는 이름입니다.`); return; }
  namer.release(cur.name, cur.kind);
  namer.reserve(name, cur.kind);
  state.names[id] = { name, kind: cur.kind, auto: false };
  save(state); refreshPoints(); renderSelection();
}

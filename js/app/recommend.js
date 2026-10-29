// 문장으로 노선 추천.
import { cityCenter, metroPlan, parseRequest } from '../game/recommend.js';
import { NEW_BUILDS } from '../game/state.js';
import { kmBetween } from '../sim/model.js';
import { $, base, draft, map, state, zoneProps } from './core.js';
import { allLinks, nodeCoord } from './mapdata.js';
import { nearestNode, startDraft } from './draw.js';
import { drawDraft, nameDraftPoint } from './route.js';
import { renderBuild } from './panels.js';
import { foreignCountry } from './operators.js';
import { zonePop } from './election.js';
import { effectiveGrid } from './housing.js';

// ------------------------------------------------------------ 문장으로 노선 추천

export let recMsg = '문장으로 바라는 노선을 적으면(도시·수단), 인구가 많은데 역이 없는 곳을 잇는 안을 만들어 그리기로 엽니다.';

export function recommendRoute(text) {
  const req = parseRequest(text || '', zoneProps);
  const say = (m) => { recMsg = m; const el = $('#rec-msg'); if (el) el.textContent = m; };
  if (!req.cities.length) { say('문장에서 도시 이름을 찾지 못했습니다. 예: "대전에 도시철도 3호선", "청주와 전주를 잇는 고속도로".'); return; }
  const mode = req.mode || (req.cities.length === 1 ? 'metro' : 'rail');
  const city = req.cities[0];
  const pop = (i) => zonePop(i);
  const stationXY = [...new Set([...base.stations, ...(base.metro_stations || [])].map((s) => s[1]).concat(state.newStations))]
    .filter((n) => !foreignCountry(n)).map(nodeCoord).filter(Boolean);
  let points, title, why;
  if (mode === 'metro') {
    const subs = new Set(city.zones.flatMap((i) => zoneProps[i].subs.map((_, k) => zoneProps[i].sub0 + k)));
    const plan = metroPlan(effectiveGrid(), subs, stationXY);
    if (!plan) { say(`${city.name}에서 역이 없는 인구 밀집지를 충분히 찾지 못했습니다 (이미 역이 촘촘합니다).`); return; }
    const used = new Set(allLinks().filter((l) => l.mode === 2 && l.name?.startsWith(city.name)).map((l) => l.name));
    const no = req.number || (used.size + 1);
    title = `${city.name} 도시철도 ${no}호선`;
    points = plan.points.map(([lon, lat]) => ({ node: null, lon, lat, split: null }));
    why = `${title} 추천안: 역 ${points.length}곳, 약 ${plan.km.toFixed(0)}km. 지금 역(반경 800m)이 닿지 않는 인구 밀집지 약 ${Math.round(plan.served / 1000).toLocaleString()}천 명을 잇습니다. 지도에서 확인하고 고친 뒤 착공하세요.`;
  } else {
    const spec = NEW_BUILDS[mode];
    const a = cityCenter(zoneProps, city.zones, pop);
    let bCity = req.cities[1];
    if (!bCity) {
      // 가장 가까운 큰 도시 (인구 30만 이상, 같은 도시 제외)
      const big = new Map();
      zoneProps.forEach((z, i) => { if (!z.ext && !city.zones.includes(i)) { const k = z.province?.match(/(시|특별자치시)$/) ? z.province : z.name; if (!big.has(k)) big.set(k, []); big.get(k).push(i); } });
      let best = null, bd = Infinity;
      for (const [k, zs] of big) {
        if (zs.reduce((s0, i) => s0 + pop(i), 0) < 300000) continue;
        const c = cityCenter(zoneProps, zs, pop), d = c && kmBetween(a[0], a[1], c[0], c[1]);
        if (d > 15 && d < bd) { bd = d; best = { name: k.replace(/(특별자치시|특별시|광역시|시)$/, ''), zones: zs }; }
      }
      bCity = best;
    }
    if (!a || !bCity) { say('이을 상대 도시를 찾지 못했습니다.'); return; }
    const b = cityCenter(zoneProps, bCity.zones, pop);
    const snapTo = (c) => {
      const n = nearestNode({ lng: c[0], lat: c[1] }, spec.mode, null, spec.mode === 0 ? 8 : 6);
      return n != null ? { node: n, lon: nodeCoord(n)[0], lat: nodeCoord(n)[1], split: null } : { node: null, lon: c[0], lat: c[1], split: null };
    };
    points = [snapTo(a), snapTo(b)];
    title = `${city.name}–${bCity.name} ${spec.label.replace(/ 신설.*$/, '')}`;
    const d = kmBetween(a[0], a[1], b[0], b[1]);
    why = `${title} 추천안: 두 도시 중심(인구 가중)을 잇는 직선 약 ${d.toFixed(0)}km. 경유지를 눌러 더하거나 기존 ${spec.mode ? '역' : 'IC'}에 붙여 고친 뒤 착공하세요.`;
  }
  const type = mode;
  startDraft(type);
  for (const p of points) { draft.points.push(p); nameDraftPoint(p); }
  draft.lineName = title;
  draft.lineNameEdited = true;
  draft.recNote = why;
  drawDraft();
  renderBuild();
  say(why);
  const xs = draft.points.map((p) => p.lon), ys = draft.points.map((p) => p.lat);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 12 });
}

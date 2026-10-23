// 국가 대형 사업(건설 탭): 한일해저터널, 호남고속철 제주 연장, 시베리아 횡단철도 진입.
// 여느 사업처럼 해마다 예산을 들여 짓고, 완공되면 네트워크에 선로가 붙거나(applyMega) 해마다 효과가 난다.
// 비용은 억원. 사업비·선형은 공개된 구상안을 게임용으로 단순화한 값이다.

export const MEGA = [
  {
    id: 'kj-tunnel', name: '한일해저터널', label: '한일해저터널 (부산–쓰시마–이키–후쿠오카)', cost: 600000, years: 10,
    desc: '부산에서 쓰시마·이키를 거쳐 후쿠오카까지 약 230km(해저 약 130km)의 고속철도 터널. 총사업비의 절반을 한국이 낸다. 완공되면 부산역에서 후쿠오카까지 고속열차가 다닌다.',
    ready: () => true,
  },
  {
    id: 'jeju-hsr', name: '호남고속철 제주 연장', label: '호남고속철 제주 연장 (목포–해남–보길도–추자도–제주)', cost: 170000, years: 8,
    desc: '목포에서 해남·보길도·추자도를 거쳐 제주까지 약 167km(해저 약 73km). 완공되면 제주역이 생기고 호남고속선 열차가 제주까지 간다.',
    ready: () => true,
  },
  {
    id: 'tsr', name: '시베리아 횡단철도 진입', label: '시베리아 횡단철도 진입 (두만강–하산 현대화·환적 시설)', cost: 50000, years: 4,
    desc: '두만강–하산 국경 철도를 현대화하고 궤간이 다른 러시아 철도와의 환적 시설을 지어 시베리아 횡단철도와 잇는다. 완공되면 국경 철도가 빨라지고, 철도 운영사가 해마다 대륙 통과 화물 수입을 얻는다.',
    ready: (state) => state.integration >= 0.5, need: '남북 통합도 50% 이상',
  },
];

export const TSR_FREIGHT = 5000;   // 대륙 통과 화물 수입 (억원/년, 북측 철도 운영사)

/** 철도역 이름으로 그 역의 철도 노드를 찾는다 (lineRe에 맞는 노선이 지나는 노드를 먼저) */
function railStation(base, name, lineRe) {
  const touch = (n) => base.links.filter((l) => l.mode === 1 && (l.a === n || l.b === n));
  const cands = base.stations.filter((s) => s[0] === name).map((s) => s[1]);
  return cands.find((n) => touch(n).some((l) => lineRe.test(l.name))) ?? cands.find((n) => touch(n).length) ?? null;
}

function addLink(base, state, attrs, coords) {
  const id = base.links.length + state.newLinks.length;
  state.newLinks.push({ id, built: true, kp: 0, tracks: 2, power: 'AC', ...attrs, geom: coords.flat() });
  return id;
}

const JEJU = [126.4936, 33.4996];

/** 대형 사업의 선형 (지도 미리보기와 완공 때 쓴다). 없으면 null */
export function megaGeometry(base, id) {
  if (id === 'kj-tunnel') {
    const a = railStation(base, '부산', /경부/);
    const b = (base.foreignNodes || []).find((f) => f.name === '후쿠오카')?.node;
    if (a == null || b == null) return null;
    return { a, b, coords: [base.nodes[a], [129.32, 34.66], [129.68, 33.77], base.nodes[b]], stops: ['부산', '쓰시마', '이키', '후쿠오카'] };
  }
  if (id === 'jeju-hsr') {
    const a = railStation(base, '목포', /호남/);
    if (a == null) return null;
    return { a, coords: [base.nodes[a], [126.60, 34.57], [126.55, 34.16], [126.32, 33.96], JEJU], stops: ['목포', '해남', '보길도', '추자도', '제주'] };
  }
  if (id === 'tsr') {
    const i = base.links.findIndex((l) => l.mode === 1 && /두만강–하산/.test(l.name || ''));
    if (i < 0) return null;
    const g = base.links[i].geom, coords = [];
    for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) coords.push([g[k], g[k + 1]]);
    return { link: i, coords, stops: ['두만강', '하산'] };
  }
  return null;
}

/** 완공된 대형 사업을 네트워크에 붙인다. 붙이거나 바꾼 링크 id 목록을 돌려준다 */
export function applyMega(base, state, id) {
  (state.mega ||= {})[id] = state.year;
  const geo = megaGeometry(base, id);
  if (!geo) return [];
  if (id === 'kj-tunnel') {
    return [addLink(base, state, { a: geo.a, b: geo.b, mode: 1, cls: 'hsr', len: 230, speed: 250, name: '한일해저터널', ext: 1 }, geo.coords)];
  } else if (id === 'jeju-hsr') {
    const node = base.nodes.length + state.newNodes.length;
    state.newNodes.push(JEJU);
    state.newStations.push(node);
    state.names[node] = { name: '제주', kind: 'station', auto: false };
    return [addLink(base, state, { a: geo.a, b: node, mode: 1, cls: 'hsr', len: 167, speed: 250, name: '호남고속선' }, geo.coords)];
  } else if (id === 'tsr') {
    // 국경 철도를 표준궤·광궤 겸용 복선으로: 빨라지고 수송력이 는다
    state.overrides[geo.link] = { ...(state.overrides[geo.link] || {}), speed: 160, tracks: 2 };
    return [geo.link];
  }
  return [];
}

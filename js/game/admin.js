// 행정 소속표: 읍면동(계산용 소구역) 하나하나가 지금 어느 시군·광역 단체에 드는지.
// 시군은 원래 계산 단위(존)를 따르지만, 면 단위 편입(state.local.annexSubUnit)과 시군구 신설(state.local.splitUnit)로
// 읍면동이 다른 시군에 들 수 있다. 경계선·이름·색칠·시군 창·단체장·선거·통계는 모두 이 표를 본다.
//
// 시군 id: 존을 따르는 시군은 `z:대표 존 번호`, 새로 세운 시군은 `split:…` (state.local.splitUnit의 열쇠)
// 단체장 자리: 존 시군은 예전대로 `m:대표 존 번호`, 새 시군은 `m:split:…`

/**
 * @param {object} d 의존 함수·자료
 *   zoneProps, S(소구역 수), subInfo(i) → [존, 순번], subKey(i), countyRep(z), unitId(z) → 시군 열쇠(도|시군),
 *   regionOf(z), zoneName(z), subPop(i), subPop0(i)
 * @param {object} L state.local
 */
export function buildAdmin(d, L) {
  const { zoneProps, S } = d;
  const repOfUnitId = new Map();   // 시군 열쇠(도|시군) → 대표 존
  zoneProps.forEach((z, j) => { if (!z.ext) { const k = d.unitId(j); if (!repOfUnitId.has(k)) repOfUnitId.set(k, d.countyRep(j)); } });
  const A = L?.annexSubUnit || {}, R = L?.annexSub || {}, SP = L?.splitUnit || {};
  const unitOfSub = new Array(S), regionOfSub = new Array(S), moved = new Uint8Array(S);
  const units = new Map();
  const unit = (id, init) => { let u = units.get(id); if (!u) units.set(id, (u = { id, subs: [], zones: new Set(), ...init() })); return u; };
  for (let i = 0; i < S; i++) {
    const [z] = d.subInfo(i), zp = zoneProps[z];
    if (!zp || zp.ext) { unitOfSub[i] = null; regionOfSub[i] = null; continue; }
    const key = d.subKey(i), to = A[key];
    let id = `z:${d.countyRep(z)}`;
    if (to) {
      if (SP[to]) id = to;
      else if (repOfUnitId.has(to)) id = `z:${repOfUnitId.get(to)}`;
    }
    const home = `z:${d.countyRep(z)}`;
    if (id !== home) moved[i] = 1;
    unitOfSub[i] = id;
    regionOfSub[i] = R[key] || (SP[id]?.region) || d.regionOf(id.startsWith('z:') ? +id.slice(2) : z);
    const u = unit(id, () => (id.startsWith('z:')
      ? { split: false, rep: +id.slice(2), name: null, region: null }
      : { split: true, rep: -1, name: SP[id].name, home: SP[id].home, year: SP[id].year, region: SP[id].region }));
    u.subs.push(i); u.zones.add(z);
  }
  for (const u of units.values()) {
    if (!u.split) { u.name = d.zoneName(u.rep).split(' ')[0]; u.region = d.regionOf(u.rep); }
    u.kind = /구$/.test(u.name) ? 'gu' : /군$/.test(u.name) ? 'gun' : 'si';
  }
  // 소속이 바뀐 읍면동이 있는 존: 경계선·색칠을 읍면동 단위로 다시 그린다
  const mixed = new Set();
  for (let i = 0; i < S; i++) if (moved[i]) { mixed.add(d.subInfo(i)[0]); const u = units.get(unitOfSub[i]); if (!u.split) for (const z of u.zones) mixed.add(z); }
  for (const u of units.values()) if (u.split) for (const z of u.zones) mixed.add(z);
  const subsOfZone = (z) => { const zp = zoneProps[z], out = []; for (let k = 0; k < zp.subs.length; k++) out.push(zp.sub0 + k); return out; };
  return {
    unitOfSub, regionOfSub, units, mixed, moved,
    /** 존 j의 기본 시군 id */
    zoneUnit: (j) => `z:${d.countyRep(j)}`,
    unitOf: (i) => unitOfSub[i],
    unit: (id) => units.get(id),
    /** 시군 인구 (지금·시작) */
    pop(id) { const u = units.get(id); let p = 0, p0 = 0; for (const i of u?.subs || []) { p += d.subPop(i); p0 += d.subPop0(i); } return { pop: p, pop0: p0 }; },
    /** 광역 단체 인구 (지금·시작): 읍면동 단위로 */
    regionPops() {
      const out = new Map();
      for (let i = 0; i < S; i++) {
        const r = regionOfSub[i];
        if (!r) continue;
        const e = out.get(r) || { pop: 0, pop0: 0, zones: new Set() };
        e.pop += d.subPop(i); e.pop0 += d.subPop0(i); e.zones.add(d.subInfo(i)[0]);
        out.set(r, e);
      }
      return out;
    },
    subsOfZone,
    /** 새로 세운 시군 목록 */
    splits: () => [...units.values()].filter((u) => u.split),
  };
}

/** 소속표 지문: 이것이 같으면 표를 다시 만들지 않는다 */
export function adminSig(L, extra = '') {
  return JSON.stringify([L?.annexSubUnit || null, L?.annexSub || null, L?.splitUnit || null]) + extra;
}

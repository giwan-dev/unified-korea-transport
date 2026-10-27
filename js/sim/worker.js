// 시뮬레이션은 메인 스레드를 막지 않도록 워커에서 돈다.
import { roadSpeedSaving, ROAD_COST } from '../game/appraisal.js';
import { Model } from './model.js';
import { P } from './params.js';

let model = null;
let lastNet = null, lastTotals = null;   // 미리보기 뒤 되돌릴 지금 상태
let beforeCache = null;                  // 미리보기 대조군(지금 그대로)은 같은 해·같은 기간이면 다시 쓴다
let inputs = null;                       // 보조 워커를 만들 때 넘길 존·격자
let pool;                                // 보조 워커 묶음 (undefined: 아직 안 만듦, null: 쓸 수 없음)

/** 보조 워커 묶음: 페이지가 만들어 넘긴 포트(inputs.ports)로 잇는다. 없거나 응답이 없으면 null (한 워커에서 계산한다) */
async function makePool() {
  const ports = inputs?.ports || [];
  if (!ports.length) { post('warn', { message: '보조 워커 포트가 없어 한 워커로 계산합니다' }); return null; }
  const call = (p, msg, timeoutMs = 0) => new Promise((resolve, reject) => {
    const timer = timeoutMs && setTimeout(() => reject(new Error(`보조 워커 응답 없음 (${msg.type})`)), timeoutMs);
    p.onmessage = (e) => { clearTimeout(timer); e.data?.error ? reject(new Error(e.data.error)) : resolve(e.data); };
    p.postMessage(msg);
  });
  try {
    await Promise.all(ports.map((p) => call(p, { type: 'init', zones: inputs.zones, grid: inputs.grid }, 120000)));
    return {
      size: ports.length, netSent: null, gridSent: inputs.grid,
      // 망을 보낼 때는 주 워커가 그 망으로 구한 역세권 결과도 함께 보낸다 (보조 워커가 다시 계산하지 않게).
      // 그래서 sync·preNet은 늘 주 워커가 같은 망을 setNetwork한 뒤에 부른다
      async sync(net, snapshot, groups) {
        const send = this.netSent !== net;
        const access = send ? model.accessPack() : null;
        // 격자가 바뀌었으면(택지지구 입주 등) 보조 워커 모델도 같은 격자로
        const grid = this.gridSent !== inputs.grid ? inputs.grid : null;
        await Promise.all(ports.map((p) => call(p, { type: 'sync', net: send ? net : null, access, snapshot, groups, grid }, 60000)));
        this.netSent = net;
        this.gridSent = inputs.grid;
      },
      // 망만 먼저 보내 보조 워커가 망을 짜게 한다 (주 워커가 경제·인구를 갱신하는 동안 함께)
      async preNet(net) {
        if (this.netSent === net) return;
        const access = model.accessPack();
        await Promise.all(ports.map((p) => call(p, { type: 'sync', net, access, snapshot: null }, 60000)));
        this.netSent = net;
      },
      run: (mk) => Promise.all(ports.map((p, k) => call(p, mk(k), 120000))),
      close() { ports.forEach((p) => p.close()); },
    };
  } catch (err) {
    post('warn', { message: `보조 워커를 쓰지 못해 한 워커로 계산합니다: ${err.message}` });
    return null;
  }
}

/** 통행배정: 보조 워커가 있으면 나눠서, 없거나 실패하면 이 워커에서 */
async function assign(net, integration, prog, warm = false, offsetOverride = null) {
  if (pool === undefined) pool = await makePool();
  if (pool) {
    try {
      wmark('sync start');
      await pool.sync(net, model.snapshot(), model.originGroups());
      wmark('sync done');
      const r = await model.assignParallel(pool, integration, prog, warm, offsetOverride);
      wmark('assign done');
      return r;
    } catch (err) {
      post('warn', { message: `보조 워커 배정 실패, 한 워커로 계산합니다: ${err.message}` });
      pool.close();
      pool = null;
    }
  }
  return model.assign(integration, prog, warm, offsetOverride);
}

function post(type, payload, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

/** 준비 단계별 시간 (ms): 첫 결과에 실어 보낸다 */
const wperf = [];
const wmark = (name) => wperf.push([name, Math.round(performance.now())]);

function results(totals, { withState = true } = {}) {
  lastTotals = totals;
  wmark('results start');
  const links = model.linkResults();
  const zones = model.zoneResults();
  const stations = model.stationResults();
  const subs = model.subResults();
  const air = model.airResults();
  // 다시 열 때 바로 이어 시작할 수 있도록 계산 상태도 함께 넘긴다 (IndexedDB에 저장)
  const sim = withState ? model.exportBaseline(totals, null) : null;
  wmark('results built');
  post('result', {
    perf: [...wperf.splice(0), ...(model.assignTiming || []).map(([k, v]) => [`assign ${k} (ms)`, v])], links, zones, stations, subs, air, totals, summary: model.summary(), snapshot: model.snapshot(),
    sim: sim && { sizes: sim.json.sizes, bin: sim.bin },
  }, [links.vol.buffer, links.vc.buffer, links.speed.buffer, ...(sim ? [sim.bin] : [])]);
}

const progress = (label) => (v) => post('progress', { label, value: v });

/** 새 게임: 기준 연도 보정과 배정 (baseline이 없을 때만) */
function calibrateFresh(ctx) {
  model.provisionalIncome();
  model.calibrateK(ctx.integration, progress('기준 연도 보정 중'));
  model.assign(ctx.integration, progress('기준 연도 통행배정'));
  model.initEconomy();
  // 지역별 소득이 정해졌으니 한 번 더 배정해 기준 연도 결과를 맞춘다 (이어서 해를 넘겨도 튀지 않도록)
  return model.assign(ctx.integration, progress('기준 연도 마무리'), true);
}

// 메시지는 하나씩 차례로 처리한다 (배정 도중 다른 요청이 상태를 건드리지 않게)
let queue = Promise.resolve();
self.onmessage = (ev) => { queue = queue.then(() => handle(ev.data)); };

async function handle(msg) {
  try {
    if (msg.type === 'init') {
      wmark('init received');
      post('progress', { label: '시뮬레이션 준비 중', value: 0 });
      model = new Model(msg.zones, new Float32Array(msg.grid));
      wmark('model built');
      if (msg.baseline?.json.access) model.preloadAccess(msg.baseline.json, msg.baseline.bin);
      if (msg.gridEff) model.setGrid(new Float32Array(msg.gridEff));   // 택지지구 등 입주 인구를 더한 격자
      model.setNetwork(msg.net);
      wmark('network set');
      lastNet = msg.net;
      inputs = { zones: msg.zones, grid: msg.gridEff || msg.grid, ports: msg.ports };
      const bl = msg.baseline;
      if (!msg.snapshot) {
        // 새 게임: 미리 계산한 기준 연도가 있으면 그대로 쓴다
        if (bl && model.importBaseline(bl.json, bl.bin)) { wmark('baseline imported'); results(bl.json.totals); }
        else if (bl?.json.snapshot) {
          // 망이 바뀐 판(공유 링크로 연 판 등): 기준 연도의 보정 상수·인구는 그대로 쓰고 지금 망으로 한 번 배정한다 (수십 초)
          model.restore(bl.json.snapshot);
          const totals = await assign(lastNet, msg.ctx.integration, progress('받은 판의 통행배정'), false);
          model.computeAccess();
          results(totals);
        } else {
          // 미리 계산한 기준 연도가 없거나 망 크기가 다르면 처음부터 보정한다 (몇 분 걸린다)
          post('progress', { label: `기준 연도 처음부터 계산 중${bl ? ` (기준선 크기 다름: 링크 ${bl.json.sizes.L}/${model.volume.length}, 역 ${bl.json.sizes.NS}/${model.boardings.length}, 항공 ${bl.json.sizes.AA}/${model.airOD.length})` : ''}`, value: 0 });
          results(calibrateFresh(msg.ctx));
        }
      } else {
        // 저장된 게임: 그해 계산 상태가 저장돼 있으면 그대로 잇고, 없으면 기준 연도 교통량에서 이어 배정한다
        const sv = msg.saved;
        if (sv && model.importBaseline({ sizes: sv.sizes, snapshot: msg.snapshot }, sv.bin)) {
          results(sv.totals, { withState: false });
          return;
        }
        model.restore(msg.snapshot);
        const warm = !!(bl && model.importBaseline(bl.json, bl.bin, { volumesOnly: true }));
        const totals = await assign(lastNet, msg.ctx.integration, progress('저장된 해 통행배정'), warm);
        model.computeAccess();
        results(totals);
      }
    } else if (msg.type === 'step') {
      wmark('step received');
      // 택지지구·역세권 개발 입주로 바뀐 1km 격자 (망을 짜기 전에: 바뀐 소구역의 역세권을 다시 구한다)
      if (msg.ctx.grid) { model.setGrid(new Float32Array(msg.ctx.grid)); inputs.grid = msg.ctx.grid; }
      model.setNetwork(msg.net);
      wmark(model.netRebuilt ? 'network set (full rebuild)' : 'network set');
      const pre = pool ? pool.preNet(msg.net).catch(() => {}) : null;   // 보조 워커 망 짜기(역세권은 받아 씀)를 경제·인구 갱신과 함께
      lastNet = msg.net;
      // 지난 1년의 교통 조건으로 경제·인구를 갱신한 뒤 새 해의 통행을 배정한다 (완공된 역세권 개발 인구를 먼저 옮긴다)
      if (msg.ctx.dev?.length) model.applyDevelopments(msg.ctx.dev);
      if (msg.ctx.anchor?.length) model.anchorDevelopments(msg.ctx.anchor);   // 예전 저장의 입주 인구를 제자리로 (한 번)
      // 열린 북측 관광지만 관광 수요를 끈다 (해금)
      if (msg.ctx.tourKP?.length === model.tourKP.length) model.tourKP.set(msg.ctx.tourKP);
      model.advanceYear(msg.ctx.integration, msg.ctx.policy, msg.ctx.sez || []);
      wmark('advanced');
      if (pre) await pre;
      beforeCache = null;
      // 새 노선이 개통한 해에는 지난해 교통량과 반씩 섞어 이용이 빨리 자리 잡게 한다
      results(await assign(lastNet, msg.ctx.integration, progress('통행배정'), true, msg.opened ? 1 : null));
    } else if (msg.type === 'preview') {
      // 착공 전 효과 미리보기: 지금 교통량을 고정한 채 지금 망(대조)과 다 지은 망(처리)으로 수단분담·경로를 다시 구해 견준다.
      // 처리 쪽은 새로 놓거나 바꾼 구간(과 운행 계통)만 몇 번 섞어 새 노선 이용이 자리 잡게 한다.
      // 망 전체를 다시 배정해 두 결과를 빼면 배정 잡음이 사업 효과보다 커서, 고정한 상태에서 견준다.
      // years > 0이면 그만큼 읍면동 인구가 접근이 좋은 곳으로 옮겨 간 뒤를 견준다 (양쪽 모두)
      const years = msg.years || 0;
      // 미리보기 뒤에는 저장해 둔 상태로 되돌리는데, 저장할 때 교통량·대기시간·읍면동 비중이 반올림된다.
      // 처음부터 한 번 저장·되돌림을 거쳐, 그해 첫 미리보기와 다음 미리보기가 같은 상태에서 시작하게 한다
      const saved = model.exportBaseline(lastTotals, null);
      model.importBaseline(saved.json, saved.bin);
      const tm = [];   // 단계별 시간 (ms)
      const tick = (name, t0) => tm.push([name, Math.round(performance.now() - t0)]);
      if (pool === undefined) pool = await makePool();
      // 처리 쪽에서 교통량을 다시 정할 구간: 새 구간, 속성이 바뀐 구간, 운행 계통 가상 구간
      // 운행 계통 가상 구간은 실제 구간 뒤에 붙어, 새 구간이 생기면 번호가 밀린다: (계통, 구간)으로 짝지어 지금 교통량을 옮긴다
      const svcKey = (l) => `${l.service}|${l.seg}`;
      const oldSvc = new Map();
      lastNet.links.forEach((l, k) => { if (l.via) oldSvc.set(svcKey(l), k); });
      // 처리 쪽에서 교통량을 다시 정할 구간: 2 = 새 구간·새 계통(바로 섞음), 1 = 속성이 바뀐 구간·도로 사업 주변 도로(천천히 섞음)
      const changed = (net) => {
        const f = new Uint8Array(net.links.length);
        const L0 = lastNet.links, n0 = lastNet.physCount ?? L0.length, n1 = net.physCount ?? net.links.length;
        for (let k = 0; k < net.links.length; k++) {
          const b = net.links[k];
          if (k >= n1) { if (!oldSvc.has(svcKey(b))) f[k] = 2; continue; }   // 운행 계통: 새 계통만
          if (k >= n0) { f[k] = 2; continue; }                               // 새로 놓은 구간
          const a = L0[k];
          if (a.active !== b.active || a.speed !== b.speed || a.lanes !== b.lanes || a.tracks !== b.tracks || a.power !== b.power || a.cls !== b.cls || a.mode !== b.mode) f[k] = 1;
        }
        return f;
      };
      // 도로 사업이면 주변 도로(바뀐 도로에서 약 15km 안)도 다시 정한다: 나란한 도로가 덜 막히는 효과까지 보이게.
      // 대조 쪽도 같은 구간을 같은 횟수로 다시 정해, 섞는 과정에서 생기는 차이가 사업 효과에 끼지 않게 한다
      const roadArea = (net, f) => {
        const N = net.nodes, area = new Uint8Array(lastNet.physCount ?? lastNet.links.length);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        net.links.forEach((l, k) => {
          if (!f[k] || l.mode !== 0) return;
          for (const nd of [l.a, l.b]) { x0 = Math.min(x0, N[nd][0]); x1 = Math.max(x1, N[nd][0]); y0 = Math.min(y0, N[nd][1]); y1 = Math.max(y1, N[nd][1]); }
        });
        if (!(x0 <= x1)) return null;
        const dx = 0.17, dy = 0.135, M = lastNet.nodes;
        const inBox = (nd) => M[nd] && M[nd][0] >= x0 - dx && M[nd][0] <= x1 + dx && M[nd][1] >= y0 - dy && M[nd][1] <= y1 + dy;
        let any = false;
        for (let k = 0; k < area.length; k++) { const l = lastNet.links[k]; if (l.mode === 0 && l.active && inBox(l.a) && inBox(l.b)) { area[k] = 1; any = true; } }
        return any ? area : null;
      };
      const run = async (net, label, passes, free, localZones = null) => {
        let t0 = performance.now();
        const vol0 = Float64Array.from(model.volume);
        model.setNetwork(net);
        if (net !== lastNet) {
          // 실제 구간은 번호가 그대로, 계통 가상 구간은 짝을 찾아 지금 교통량을 옮긴다 (새 구간은 0에서)
          const n0 = lastNet.physCount ?? lastNet.links.length, n1 = net.physCount ?? net.links.length;
          for (let k = n0; k < model.volume.length; k++) model.volume[k] = 0;
          for (let k = n1; k < net.links.length; k++) { const o = oldSvc.get(svcKey(net.links[k])); if (o != null) model.volume[k] = vol0[o]; }
          model.updateCosts();
        }
        if (years) for (let y = 0; y < years; y++) model.relocateWithinZones();
        tick(`${label} 망`, t0); t0 = performance.now();
        let totals;
        try {
          if (pool) await pool.sync(net, model.snapshot(), model.originGroups());
          totals = await model.evaluate(pool, msg.ctx.integration, passes, free, (msg.warmOnly ? () => {} : progress(label)));
        } catch (err) {
          if (!pool) throw err;
          console.warn('보조 워커 평가 실패, 한 워커로 계산합니다', err);
          pool.close(); pool = null;
          totals = await model.evaluate(null, msg.ctx.integration, passes, free, (msg.warmOnly ? () => {} : progress(label)));
        }
        tick(`${label} 평가`, t0); t0 = performance.now();
        const r = model.linkResults();
        // 구간 교통량은 대조·처리 모두 마지막 번 전량 배정으로 (같은 방식이라 차이가 사업 효과)
        const ev = model.evalAux, n = r.vol.length;
        const vol = new Float32Array(n), vc = new Float32Array(n);
        for (let k = 0; k < n; k++) { vol[k] = ev[k] + (model.metroLocal?.[k] || 0); vc[k] = model.capacity[k] > 0 ? vol[k] / model.capacity[k] : 0; }
        const out = { totals, vol, volEq: r.vol, vc, speed: r.speed, svcVol: r.svcVol, odT: model.odT.slice(), odTime: model.odTime.slice(), airIds: model.airports.map((a) => a.id), airPax: Float64Array.from(model.airPax) };
        if (localZones?.length) out.local = model.localTransitCost(localZones);   // 존 안 짧은 통행 (이 망)
        model.setNetwork(lastNet);
        model.importBaseline(saved.json, saved.bin);
        tick(`${label} 되돌림`, t0);
        return out;
      };
      // 처리 쪽 반복: 도로는 막힘(BPR)이 교통량에 따라 바로 바뀌어 몇 번 섞고, 철도·도시철도만 바뀌면 한 번으로 충분하다
      // (철도는 정원을 넘을 때만 혼잡 비용이 붙는다: 조치원–청주 시험에서 1·2·3·5·8번 결과가 같았다)
      const freeAfter = changed(msg.net);
      const area = roadArea(msg.net, freeAfter);
      let before, passes = msg.passes ?? 1;
      if (area) {
        // 도로 사업: 주변 도로를 양쪽 모두 같은 방식으로 다시 정한다 (대조도 이 사업에 맞춰 새로 구한다)
        passes = msg.passes ?? 3;
        for (let k = 0; k < area.length; k++) if (area[k] && !freeAfter[k]) freeAfter[k] = 1;
        before = await run(lastNet, '효과 미리보기 (지금)', passes, area);
      } else {
        const cached = beforeCache && beforeCache.net === lastNet && beforeCache.years === years;
        before = cached ? beforeCache.out : await run(lastNet, '효과 미리보기 (지금)', 1, new Uint8Array(lastNet.links.length));
        beforeCache = { net: lastNet, years, out: before };
      }
      // 미리 데우기: 새 노선을 그리기 시작할 때 대조(지금 망) 평가만 해 둔다 (그해 철도 사업 미리보기가 그만큼 빨라진다)
      if (msg.warmOnly) { post('previewWarm', { id: msg.id, years }); return; }
      // 존 안 짧은 통행: 새로 놓거나 바뀐 도시철도 구간에서 역세권 반경(6km) 안에 동이 있는 존만, 처리 망과 대조 망에서 견준다
      const nPhys = msg.net.physCount ?? msg.net.links.length, mPts = [];
      msg.net.links.forEach((l, k) => { if (k < nPhys && freeAfter[k] && l.mode === 2) for (const nd of [l.a, l.b]) mPts.push(msg.net.nodes[nd]); });
      const localZones = mPts.length ? model.zonesNear(mPts, P.metroRadiusKm) : [];
      const after = await run(msg.net, '효과 미리보기 (완공 뒤)', passes, freeAfter, localZones);
      let localMin = 0;
      if (localZones.length && after.local) {
        const t0 = performance.now();
        const lb = model.localTransitCost(localZones);   // 되돌린 뒤라 지금 망(대조)
        for (let k = 0; k < lb.length; k++) localMin += lb[k] - after.local[k];
        tick('존 안 통행', t0);
      }
      // 이용자 편익 (소비자 잉여의 반분법): OD마다 (전 통행 + 후 통행) / 2 × 시간 비용 감소 (분/일)
      let timeMin = 0;
      for (let k = 0; k < before.odT.length; k++) {
        const tb = before.odTime[k], ta = after.odTime[k];
        if (!isFinite(tb) || !isFinite(ta) || !(before.odT[k] + after.odT[k] > 0)) continue;
        timeMin += 0.5 * (before.odT[k] + after.odT[k]) * (tb - ta);
      }
      // 차량운행비·사고 편익은 기존 통행 기준(고정 수요): 사업으로 새로 생긴 통행(유발 통행)이 달린 거리는 빼고 본다.
      // 유발 통행의 편익은 위 반분법 시간 편익에 이미 들어 있어, 그 주행거리를 비용으로 또 치면 도로 사업 B/C가 음수가 된다
      const vB = before.totals.vkt || 0, vA = after.totals.vkt || 0, tB = before.totals.trips || 0, tA = after.totals.trips || 0;
      const induced = tA - tB;
      const dVkt = (vA - vB) - (tA > 0 ? (induced * vA) / tA : 0);
      // 차량운행비·사고 (고정 수요, 예타식): ① 혼잡 완화 몫 = 사업 전 교통량 × 구간 속도가 바뀐 만큼의 운행비 차이,
      // ② 수단 전환 몫 = 철도 등으로 옮겨 가 도로에서 빠진 차량의 주행거리 × 운행비·사고비.
      // (교통량 차이로 재면 미리보기가 사업 주변만 다시 배정하는 탓에 새 도로 교통량만 더해져 운행비가 크게 늘어 보인다)
      const keep = tA > 0 ? 1 - induced / tA : 1;
      const decong = roadSpeedSaving(before.volEq, before.speed, after.speed, lastNet.links);
      const carsB = (before.totals.road || 0) / P.personsPerCar, carsA = (after.totals.road || 0) * keep / P.personsPerCar;
      const tripKm = carsB > 0 ? vB / (carsB * (1 + P.freightPCUShare)) : 0;
      const shiftVkm = (carsB - carsA) * tripKm;   // 도로에서 빠진 차량 주행거리 (대·km/일)
      const benefit = { timeMin, localMin, localZones: localZones.length, dVkt, dVktRaw: vA - vB, inducedTrips: induced,
        vocWon: decong.voc + shiftVkm * ROAD_COST.voc(50), accWon: shiftVkm * ROAD_COST.accident.trunk };
      const strip = ({ odT, odTime, volEq, local, ...rest }) => rest;
      post('preview', { id: msg.id, before: strip(before), after: strip(after), benefit, years, timing: tm });
    } else if (msg.type === 'probe') {
      // 개발용: 모형 상태 요약 (미리보기 뒤 상태가 그대로 돌아오는지 본다)
      const h = (arr) => { let x = 0; for (let k = 0; k < arr.length; k++) x += (arr[k] || 0) * ((k % 97) + 1); return Math.round(x * 1000) / 1000; };
      const m = model;
      post('probe', { id: msg.id, v: { volume: h(m.volume), wait: h(m.stationWait), subW: h(m.subW), airOD: h(m.airOD), pop: h(m.pop), ccomp: h(m.ccomp), cost: h(m.cost), boardings: h(m.boardings), subRoadAcc: h(m.subRoadAcc), subStAcc: h(m.subStAcc), subSt: h(m.subSt), latent: h(m.latentOD), airPen: h(m.airPenalty), routePen: h(m.routePenalty), grp: h(m.grpSub), metroLocal: h(m.metroLocal || []), freshCap: h(m.stationFreshCap || []), svc: h(m.svcTrains) } });
    } else if (msg.type === 'route') {
      post('route', { route: model.routeQuery(msg.from, msg.to) });
    } else if (msg.type === 'routes') {
      // 결산용: 여러 구간의 가장 빠른 수단과 시간
      const out = msg.pairs.map(([a, b]) => {
        const r = model.routeQuery(a, b);
        let best = null;
        let ground = null;   // 항공을 뺀 가장 빠른 수단 (목표 판정용)
        for (const key of ['railFast', 'rail', 'conv', 'car', 'transit', 'air']) {
          const k = key === 'railFast' ? 'rail' : key;
          if (!(r[key] && r[key].min > 0)) continue;
          if (!best || r[key].min < best.min) best = { k, min: r[key].min };
          if (k !== 'air' && (!ground || r[key].min < ground.min)) ground = { k, min: r[key].min };
        }
        return best && { ...best, ground };
      });
      post('routes', { id: msg.id, out });
    } else if (msg.type === 'baseline') {
      // 개발용: 기준 연도를 계산해 돌려준다 (tools/baseline.html)
      model = new Model(msg.zones, new Float32Array(msg.grid));
      model.setNetwork(msg.net);
      const totals = calibrateFresh(msg.ctx);
      // 보정 방식 판(calibVersion)을 함께 적어, 보정이 바뀌면 예전 기준 연도를 쓰지 않게 한다
      const out = model.exportBaseline(totals, { ...msg.meta, calib: P.calibVersion });
      post('baseline', out, [out.bin]);
    }
  } catch (err) {
    post('error', { message: String(err && err.stack || err) });
  }
}

// 시뮬레이션은 메인 스레드를 막지 않도록 워커에서 돈다.
import { Model } from './model.js';

let model = null;
let lastNet = null, lastTotals = null;   // 미리보기 뒤 되돌릴 지금 상태
let inputs = null;                       // 보조 워커를 만들 때 넘길 존·격자
let pool;                                // 보조 워커 묶음 (undefined: 아직 안 만듦, null: 쓸 수 없음)

/** 보조 워커 묶음: 페이지가 만들어 넘긴 포트(inputs.ports)로 잇는다. 없거나 응답이 없으면 null (한 워커에서 계산한다) */
async function makePool() {
  const ports = inputs?.ports || [];
  if (!ports.length) return null;
  const call = (p, msg, timeoutMs = 0) => new Promise((resolve, reject) => {
    const timer = timeoutMs && setTimeout(() => reject(new Error(`보조 워커 응답 없음 (${msg.type})`)), timeoutMs);
    p.onmessage = (e) => { clearTimeout(timer); e.data?.error ? reject(new Error(e.data.error)) : resolve(e.data); };
    p.postMessage(msg);
  });
  try {
    await Promise.all(ports.map((p) => call(p, { type: 'init', zones: inputs.zones, grid: inputs.grid }, 120000)));
    return {
      size: ports.length, netSent: null,
      async sync(net, snapshot, groups) {
        await Promise.all(ports.map((p) => call(p, { type: 'sync', net: this.netSent === net ? null : net, snapshot, groups }, 60000)));
        this.netSent = net;
      },
      run: (mk) => Promise.all(ports.map((p, k) => call(p, mk(k), 120000))),
      close() { ports.forEach((p) => p.close()); },
    };
  } catch (err) {
    console.warn('보조 워커를 쓰지 못해 한 워커로 계산합니다', err);
    return null;
  }
}

/** 통행배정: 보조 워커가 있으면 나눠서, 없거나 실패하면 이 워커에서 */
async function assign(net, integration, prog, warm = false, offsetOverride = null) {
  if (pool === undefined) pool = await makePool();
  if (pool) {
    try {
      await pool.sync(net, model.snapshot(), model.originGroups());
      return await model.assignParallel(pool, integration, prog, warm, offsetOverride);
    } catch (err) {
      console.warn('보조 워커 배정 실패, 한 워커로 계산합니다', err);
      pool.close();
      pool = null;
    }
  }
  return model.assign(integration, prog, warm, offsetOverride);
}

function post(type, payload, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

function results(totals, { withState = true } = {}) {
  lastTotals = totals;
  const links = model.linkResults();
  const zones = model.zoneResults();
  const stations = model.stationResults();
  const subs = model.subResults();
  const air = model.airResults();
  // 다시 열 때 바로 이어 시작할 수 있도록 계산 상태도 함께 넘긴다 (IndexedDB에 저장)
  const sim = withState ? model.exportBaseline(totals, null) : null;
  post('result', {
    links, zones, stations, subs, air, totals, summary: model.summary(), snapshot: model.snapshot(),
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
      post('progress', { label: '시뮬레이션 준비 중', value: 0 });
      model = new Model(msg.zones, new Float32Array(msg.grid));
      model.setNetwork(msg.net);
      lastNet = msg.net;
      inputs = { zones: msg.zones, grid: msg.grid, ports: msg.ports };
      const bl = msg.baseline;
      if (!msg.snapshot) {
        // 새 게임: 미리 계산한 기준 연도가 있으면 그대로 쓴다
        if (bl && model.importBaseline(bl.json, bl.bin)) results(bl.json.totals);
        else {
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
      model.setNetwork(msg.net);
      lastNet = msg.net;
      // 지난 1년의 교통 조건으로 경제·인구를 갱신한 뒤 새 해의 통행을 배정한다
      model.advanceYear(msg.ctx.integration, msg.ctx.policy);
      // 새 노선이 개통한 해에는 지난해 교통량과 반씩 섞어 이용이 빨리 자리 잡게 한다
      results(await assign(lastNet, msg.ctx.integration, progress('통행배정'), true, msg.opened ? 1 : null));
    } else if (msg.type === 'preview') {
      // 착공 전 효과 미리보기: 지금 상태를 저장해 두고, 지금 네트워크(대조)와 다 지은 네트워크로 같은 방식의 통행배정을 각각 해 본 뒤 되돌린다.
      // 새 노선이 제 몫을 받도록 지난해 교통량과 반씩 섞는다. 두 결과의 차이가 사업 효과다
      const saved = model.exportBaseline(lastTotals, null);
      const run = async (net, label) => {
        model.setNetwork(net);
        const totals = await assign(net, msg.ctx.integration, progress(label), true, 1);
        const r = model.linkResults();
        const out = { totals, vol: r.vol, vc: r.vc, speed: r.speed, svcVol: r.svcVol };
        model.setNetwork(lastNet);
        model.importBaseline(saved.json, saved.bin);
        return out;
      };
      const before = await run(lastNet, '효과 미리보기 (지금)');
      const after = await run(msg.net, '효과 미리보기 (완공 뒤)');
      post('preview', { id: msg.id, before, after });
    } else if (msg.type === 'route') {
      post('route', { route: model.routeQuery(msg.from, msg.to) });
    } else if (msg.type === 'baseline') {
      // 개발용: 기준 연도를 계산해 돌려준다 (tools/baseline.html)
      model = new Model(msg.zones, new Float32Array(msg.grid));
      model.setNetwork(msg.net);
      const totals = calibrateFresh(msg.ctx);
      const out = model.exportBaseline(totals, msg.meta);
      post('baseline', out, [out.bin]);
    }
  } catch (err) {
    post('error', { message: String(err && err.stack || err) });
  }
}

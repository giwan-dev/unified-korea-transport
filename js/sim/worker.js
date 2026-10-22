// 시뮬레이션은 메인 스레드를 막지 않도록 워커에서 돈다.
import { Model } from './model.js';

let model = null;

function post(type, payload, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

function results(totals, { withState = true } = {}) {
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
  model.calibrateK(ctx.integration, progress('기준 연도 보정 중'));
  const totals = model.assign(ctx.integration, progress('기준 연도 통행배정'));
  model.initEconomy();
  return totals;
}

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      post('progress', { label: '시뮬레이션 준비 중', value: 0 });
      model = new Model(msg.zones, new Float32Array(msg.grid));
      model.setNetwork(msg.net);
      const bl = msg.baseline;
      if (!msg.snapshot) {
        // 새 게임: 미리 계산한 기준 연도가 있으면 그대로 쓴다
        if (bl && model.importBaseline(bl.json, bl.bin)) results(bl.json.totals);
        else results(calibrateFresh(msg.ctx));
      } else {
        // 저장된 게임: 그해 계산 상태가 저장돼 있으면 그대로 잇고, 없으면 기준 연도 교통량에서 이어 배정한다
        const sv = msg.saved;
        if (sv && model.importBaseline({ sizes: sv.sizes, snapshot: msg.snapshot }, sv.bin)) {
          results(sv.totals, { withState: false });
          return;
        }
        model.restore(msg.snapshot);
        const warm = !!(bl && model.importBaseline(bl.json, bl.bin, { volumesOnly: true }));
        const totals = model.assign(msg.ctx.integration, progress('저장된 해 통행배정'), warm);
        model.computeAccess();
        results(totals);
      }
    } else if (msg.type === 'step') {
      model.setNetwork(msg.net);
      // 지난 1년의 교통 조건으로 경제·인구를 갱신한 뒤 새 해의 통행을 배정한다
      model.advanceYear(msg.ctx.integration, msg.ctx.policy);
      results(model.assign(msg.ctx.integration, progress('통행배정'), true));
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
};

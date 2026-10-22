// 시뮬레이션은 메인 스레드를 막지 않도록 워커에서 돈다.
import { Model } from './model.js';

let model = null;

function post(type, payload, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

function results(totals) {
  const links = model.linkResults();
  const zones = model.zoneResults();
  const stations = model.stationResults();
  const subs = model.subResults();
  post('result', {
    links, zones, stations, subs, totals, summary: model.summary(), snapshot: model.snapshot(),
  }, [links.vol.buffer, links.vc.buffer, links.speed.buffer]);
}

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      model = new Model(msg.zones, new Float32Array(msg.grid));
      model.setNetwork(msg.net);
      if (msg.snapshot) {
        model.restore(msg.snapshot);
        model.computeAccess();
      } else {
        post('progress', { label: '수요 보정 중', value: 0 });
        model.calibrateK(msg.ctx.integration, (v) => post('progress', { label: '기준 연도 보정 중', value: v }));
      }
      post('progress', { label: '기준 연도 통행배정', value: 0 });
      const totals = model.assign(msg.ctx.integration, (v) => post('progress', { label: '통행배정', value: v }));
      if (!msg.snapshot) model.initEconomy();
      results(totals);
    } else if (msg.type === 'step') {
      model.setNetwork(msg.net);
      // 지난 1년의 교통 조건으로 경제·인구를 갱신한 뒤 새 해의 통행을 배정한다
      model.advanceYear(msg.ctx.integration, msg.ctx.policy);
      const totals = model.assign(msg.ctx.integration, (v) => post('progress', { label: '통행배정', value: v }), true);
      results(totals);
    }
  } catch (err) {
    post('error', { message: String(err && err.stack || err) });
  }
};

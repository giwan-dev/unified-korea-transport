// 시뮬레이션은 메인 스레드를 막지 않도록 워커에서 돈다.
import { Model } from './model.js';
import { P } from './params.js';

let model = null;
let lastNet = null, lastTotals = null;   // 미리보기 뒤 되돌릴 지금 상태

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

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      post('progress', { label: '시뮬레이션 준비 중', value: 0 });
      model = new Model(msg.zones, new Float32Array(msg.grid));
      model.setNetwork(msg.net);
      lastNet = msg.net;
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
      lastNet = msg.net;
      // 지난 1년의 교통 조건으로 경제·인구를 갱신한 뒤 새 해의 통행을 배정한다
      model.advanceYear(msg.ctx.integration, msg.ctx.policy);
      // 새 노선이 개통한 해에는 지난해 교통량과 반씩 섞어 이용이 빨리 자리 잡게 한다
      results(model.assign(msg.ctx.integration, progress('통행배정'), true, msg.opened ? 1 : null));
    } else if (msg.type === 'preview') {
      // 착공 전 효과 미리보기: 지금 상태를 저장해 두고, 지금 네트워크(대조)와 다 지은 네트워크로 같은 방식의 통행배정을 각각 해 본 뒤 되돌린다.
      // 새 노선이 제 몫을 받도록 지난해 교통량과 반씩 섞는다. 두 결과의 차이가 사업 효과다
      const saved = model.exportBaseline(lastTotals, null);
      const run = (net, label) => {
        model.setNetwork(net);
        const totals = model.assign(msg.ctx.integration, progress(label), true, 1);
        const r = model.linkResults();
        const out = { totals, vol: r.vol, vc: r.vc, speed: r.speed, svcVol: r.svcVol, odT: model.odT.slice(), odTime: model.odTime.slice() };
        model.setNetwork(lastNet);
        model.importBaseline(saved.json, saved.bin);
        return out;
      };
      const before = run(lastNet, '효과 미리보기 (지금)');
      const after = run(msg.net, '효과 미리보기 (완공 뒤)');
      // 이용자 편익 (소비자 잉여의 반분법): OD마다 (전 통행 + 후 통행) / 2 × 시간 비용 감소 (분/일)
      let timeMin = 0;
      for (let k = 0; k < before.odT.length; k++) {
        const tb = before.odTime[k], ta = after.odTime[k];
        if (!isFinite(tb) || !isFinite(ta) || !(before.odT[k] + after.odT[k] > 0)) continue;
        timeMin += 0.5 * (before.odT[k] + after.odT[k]) * (tb - ta);
      }
      const benefit = { timeMin, dVkt: (after.totals.vkt || 0) - (before.totals.vkt || 0) };
      delete before.odT; delete before.odTime; delete after.odT; delete after.odTime;
      post('preview', { id: msg.id, before, after, benefit });
    } else if (msg.type === 'route') {
      post('route', { route: model.routeQuery(msg.from, msg.to) });
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
};

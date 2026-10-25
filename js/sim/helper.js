// 보조 워커: 주 워커(worker.js)가 통행배정의 출발 존 계산을 나눠 맡긴다.
// 같은 존·격자로 모델을 만들어 두고, 해마다 망·존 상태를, 반복마다 교통량을 맞춘 뒤 제 몫의 존만 계산한다.
import { Model } from './model.js';

let model = null;
let out = self;   // 답을 보낼 곳: 페이지가 넘긴 포트(계산 워커와 바로 이어짐)

self.onmessage = (ev) => {
  if (ev.data?.type === 'port') {
    out = ev.ports[0];
    out.onmessage = (e) => handle(e.data);
    return;
  }
  handle(ev.data);
};

function handle(m) {
  try {
    if (m.type === 'init') {
      model = new Model(m.zones, new Float32Array(m.grid));
      out.postMessage({ ok: true });
    } else if (m.type === 'sync') {
      if (m.net) model.setNetwork(m.net);
      if (m.snapshot) model.restore(m.snapshot);   // 망만 먼저 받는 경우(snapshot 없음)도 있다
      if (m.groups) model.setOriginGroups(m.groups);
      out.postMessage({ ok: true });
    } else if (m.type === 'origins') {
      const r = model.originsFor(m);
      out.postMessage(r, [r.aux.buffer, r.stOD.buffer, r.airOD.buffer, r.latentOD.buffer]);
    }
  } catch (err) {
    out.postMessage({ error: String((err && err.stack) || err) });
  }
}

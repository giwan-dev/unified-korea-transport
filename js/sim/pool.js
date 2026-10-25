// 통행배정 보조 워커를 페이지(메인 스레드)에서 만들고, 계산 워커와 바로 이어지는 포트를 돌려준다.
// 워커 안에서 워커를 만들 수 없는 환경이 있어 보조 워커는 여기서 만들고 MessageChannel로 잇는다.
const kept = [];
const HELPERS_MAX = 4;   // 보조 워커마다 모델 한 벌(약 70~90MB)을 들고 있다: 4개를 넘기면 메모리에 비해 빨라지는 몫이 작다

/** @returns {MessagePort[]} 계산 워커에 넘길 포트 (코어 수 − 1개, 최대 HELPERS_MAX개; 만들 수 없으면 빈 배열) */
export function helperPorts() {
  const q = Number(new URLSearchParams(location.search).get('helpers'));   // 시험용: ?helpers=N
  const n = Number.isFinite(q) && q >= 0 && location.search.includes('helpers=') ? q : Math.min(HELPERS_MAX, Math.max(0, (navigator.hardwareConcurrency || 2) - 1));
  const ports = [];
  for (let k = 0; k < n; k++) {
    try {
      const w = new Worker(new URL('./helper.js', import.meta.url), { type: 'module' });
      w.onerror = (e) => console.error('보조 워커 오류', e.message, e.filename, e.lineno);
      const ch = new MessageChannel();
      w.postMessage({ type: 'port' }, [ch.port1]);
      kept.push(w);
      ports.push(ch.port2);
    } catch {
      break;
    }
  }
  return ports;
}

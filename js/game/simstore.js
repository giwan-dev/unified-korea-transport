// 해마다의 시뮬레이션 결과(교통량·일반화비용 행렬 등, 약 1MB)를 IndexedDB에 둔다.
// localStorage에는 게임 상태만 두고, 다시 열 때 이 결과로 바로 이어 시작한다.

const DB = 'ukt-sim', STORE = 'years', KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @param {{year:number, sizes:object, totals:object, bin:ArrayBuffer}} rec */
export async function saveSim(rec) {
  try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* 저장소를 못 쓰면 다음에 다시 계산한다 */ }
}

export async function loadSim() {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function clearSim() {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
  } catch { /* 없음 */ }
}

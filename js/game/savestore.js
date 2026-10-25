// 게임 저장: IndexedDB에 둔다. localStorage는 한 사이트에 5MB 남짓(파이어폭스·사파리)이라
// 자동 저장(약 0.4~1MB)에 슬롯 세 개를 더하면 넘쳐서 저장이 조용히 실패했다.
// 'auto'는 자동 저장, 'slot-1'…은 저장 슬롯. 슬롯 목록(해·저장 시각)은 바로 그려야 하므로 localStorage에 작게 둔다.

const DB = 'ukt-save', STORE = 'saves';
const LEGACY_KEY = 'ukt-save-v1';
const SLOT_META = 'ukt-slot-meta';

let dbP = null;
function open() {
  dbP ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbP;
}

async function put(key, value) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function get(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function del(key) {
  const db = await open();
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

// 저장은 차례로: 앞선 쓰기가 끝나기 전에 새 상태가 오면 마지막 것만 쓴다
let pending = null, writing = Promise.resolve(), lastError = null;
/** 자동 저장 (문자열로 바로 굳혀 두고, 쓰기는 뒤에서) */
export function saveAuto(json) {
  pending = json;
  writing = writing.then(async () => {
    if (pending === null) return;
    const v = pending; pending = null;
    try {
      await put('auto', v);
      lastError = null;
      try { localStorage.removeItem(LEGACY_KEY); } catch { /* 없음 */ }
    } catch (e) {
      // IndexedDB를 못 쓰는 브라우저(일부 사생활 보호 모드): 예전처럼 localStorage에
      try { localStorage.setItem(LEGACY_KEY, v); lastError = null; } catch (e2) { lastError = e2 || e; }
    }
  });
  return writing;
}

/** 쓰는 중인 저장이 끝날 때까지 (새로 고치기 전에) */
export function flushSave() { return writing; }
export function saveError() { return lastError; }

export async function loadAuto() {
  await writing;
  try { const v = await get('auto'); if (v) return v; } catch { /* 아래로 */ }
  try { return localStorage.getItem(LEGACY_KEY); } catch { return null; }
}

export async function clearAuto() {
  pending = null;
  await writing;
  try { await del('auto'); } catch { /* 없음 */ }
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* 없음 */ }
}

// ------------------------------------------------------------ 슬롯

export function slotMeta() {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(SLOT_META) || '{}'); } catch { m = {}; }
  // 예전 슬롯(localStorage에 통째로 두던 것)도 목록에 보인다
  for (let n = 1; n <= 3; n++) {
    if (m[n]) continue;
    try {
      const v = localStorage.getItem(`ukt-slot-${n}`);
      if (v) { const o = JSON.parse(v); m[n] = { year: o.state.year, savedAt: o.savedAt, stamp: o.state.dataStamp, legacy: true }; }
    } catch { /* 없음 */ }
  }
  return m;
}

export async function saveSlot(n, state) {
  const json = JSON.stringify(state);
  await put(`slot-${n}`, json);
  const m = slotMeta();
  m[n] = { year: state.year, savedAt: Date.now(), stamp: state.dataStamp };
  delete m[n].legacy;
  try { localStorage.setItem(SLOT_META, JSON.stringify(Object.fromEntries(Object.entries(m).filter(([, v]) => !v.legacy)))); } catch { /* 목록만 못 남김 */ }
  try { localStorage.removeItem(`ukt-slot-${n}`); } catch { /* 없음 */ }
}

/** 슬롯의 게임 상태 (JSON 문자열) */
export async function loadSlot(n) {
  try { const v = await get(`slot-${n}`); if (v) return v; } catch { /* 아래로 */ }
  try { const v = localStorage.getItem(`ukt-slot-${n}`); return v ? JSON.stringify(JSON.parse(v).state) : null; } catch { return null; }
}

/** 지도 자료가 바뀌어 이어 할 수 없는 저장을 따로 남겨 둔다 (파일로 내려받을 수 있게) */
export async function keepBackup(json, stamp) {
  try { await put(`backup-${stamp}`, json); } catch { /* 못 남김 */ }
}
export async function loadBackup(stamp) {
  try { return await get(`backup-${stamp}`); } catch { return null; }
}

// ------------------------------------------------------------ 자료 판의 노드·링크·시군 좌표표 (저장 게임을 새 자료로 옮길 때 쓴다)

export async function putRef(stamp, ref) {
  try { if (!(await get(`ref-${stamp}`))) await put(`ref-${stamp}`, ref); } catch { /* 못 남김 */ }
}
export async function getRef(stamp) {
  try { return await get(`ref-${stamp}`); } catch { return null; }
}

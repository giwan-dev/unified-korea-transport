// 오류 제보·저장 파일·결산·저장 슬롯.
import { flushSave, loadBackup, loadSlot, saveError, saveSlot, slotMeta } from '../game/savestore.js';
import { clearSim } from '../game/simstore.js';
import { linkAt, save, START_YEAR } from '../game/state.js';
import { t } from '../i18n.js';
import { showNotice } from '../ui/notice.js';
import { toast } from '../ui/panel.js';
import { buildReport, downloadReportImage, GOALS, reportHTML, TIME_PAIRS } from '../ui/report.js';
import { APP_VERSION, base, BUG_MAIL, busy, dataStamp, errLog, map, result, selection, state, worker } from './core.js';
import { renderAll } from './panels.js';

// ------------------------------------------------------------ 오류 제보·저장 파일·결산

export function reportBug() {
  const c = map?.getCenter();
  const lines = ['무엇이 이상했는지 적어 주세요 (어디서, 무엇을 눌렀을 때):', '', '', '---- 아래는 자동으로 채운 정보입니다 ----',
    `버전: ${APP_VERSION} · 데이터 ${dataStamp || '-'}`,
    `게임: ${state?.year}년 · 난이도 ${state?.difficulty} · 사업 ${state?.projects?.length ?? 0}건`,
    `지도: ${c ? `${c.lng.toFixed(4)}, ${c.lat.toFixed(4)} · 확대 ${map.getZoom().toFixed(1)}` : '-'}`,
    `선택: ${selection ? `${selection.type} ${selection.id ?? ''}` : '-'}`,
    `화면: ${innerWidth}×${innerHeight} @${devicePixelRatio}`,
    `브라우저: ${navigator.userAgent}`,
    `최근 오류: ${errLog.slice(-3).join(' | ').slice(0, 600) || '없음'}`,
    `최근 기록: ${(state?.log || []).slice(0, 3).join(' / ').slice(0, 300)}`];
  location.href = `mailto:${BUG_MAIL}?subject=${encodeURIComponent(`[통일 한반도 교통망 ${APP_VERSION}] 오류 제보`)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

// 공유 링크: 저장(계산 상태는 빼고, 기록은 줄여서)을 압축해 주소의 #s= 뒤에 담는다. 받은 쪽은 그 판을 열고 계산을 다시 한다
export async function packState() {
  // 받은 쪽에서 다시 만드는 것(계산 상태·체감 기준·혼잡 목록)과 지난 기록(지난 선거·끝난 제안·다 지은 이어받은 공사)은 뺀다
  const { snapshot, subBase, zoneGainPrev, congestion, compare, approvalWhy, ...rest } = state;
  const local = { ...state.local, elections: (state.local?.elections || []).slice(-1), proposals: (state.local?.proposals || []).filter((p) => p.status === 'open') };
  const lite = { ...rest, local, congestion: {}, log: (state.log || []).slice(0, 20), projects: state.projects.filter((p) => !(p.kind === 'osm' && p.status === 'done')) };
  const bytes = new TextEncoder().encode(JSON.stringify({ app: 'unified-korea-transport', v: APP_VERSION, state: lite }));
  const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function unpackState(code) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(ds).text());
}
export async function copyShareLink() {
  try {
    const url = `${location.origin}${location.pathname}#s=${await packState()}`;
    await navigator.clipboard.writeText(url).catch(() => prompt('이 주소를 복사하세요', url));
    toast(url.length > 8000 ? `링크를 복사했습니다 (${Math.round(url.length / 1000)}천 자: 길어서 일부 SNS에서는 잘릴 수 있습니다. 그럴 땐 파일로 내보내 주세요)` : `공유 링크를 복사했습니다 (${url.length.toLocaleString()}자)`);
  } catch (e) { alert(`공유 링크를 만들지 못했습니다: ${e.message}`); }
}
/** 주소에 #s=가 있으면 그 판을 연다 (게임을 시작하기 전에 부른다). 열었으면 true */
export async function openSharedFromURL() {
  const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname);
  let v;
  try { v = await unpackState(m[1]); } catch { alert('공유 링크를 읽지 못했습니다.'); return false; }
  const st = v?.state;
  if (v?.app !== 'unified-korea-transport' || !st?.year) return false;
  if (!confirm(`공유받은 ${st.year}년 판을 열까요? 지금 진행은 슬롯이나 파일로 저장해 두지 않았다면 사라집니다.`)) return false;
  st.log = [`공유받은 판을 열었습니다 (${st.year}년). 계산 상태는 처음부터 다시 맞춥니다.`, ...(st.log || [])];
  save(st);
  clearSim();
  return true;
}

export function exportSave() {
  const blob = new Blob([JSON.stringify({ app: 'unified-korea-transport', version: APP_VERSION, savedAt: Date.now(), state })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `통일교통망_${state.year}년.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function importSave(file) {
  let v;
  try { v = JSON.parse(await file.text()); } catch { alert('저장 파일을 읽지 못했습니다.'); return; }
  const st = v?.state;
  if (v?.app !== 'unified-korea-transport' || !st?.year) { alert('이 게임의 저장 파일이 아닙니다.'); return; }
  if (dataStamp && st.dataStamp && st.dataStamp !== dataStamp) { alert(`지도 자료가 바뀌기 전에 만든 파일이라 불러올 수 없습니다 (파일 ${st.dataStamp} · 지금 ${dataStamp}).`); return; }
  if (!confirm(`${st.year}년 저장 파일을 불러올까요? 지금 진행은 슬롯이나 파일로 저장하지 않았다면 사라집니다.`)) return;
  save(st);
  await flushSave();
  if (saveError()) { alert(`불러온 게임을 저장하지 못했습니다: ${saveError().message || saveError()}`); return; }
  clearSim();
  location.reload();
}

/** 놓은 노선 길이(km)와 완공 사업 수 */
export function builtSummary() {
  const out = { hsr: 0, rail: 0, metro: 0, road: 0, done: 0, upgrades: 0 };
  const kind = { hsr: 'hsr', tunnelRail: 'hsr', gtx: 'rail', rail: 'rail', rail1: 'rail', metro: 'metro', motorway: 'road', trunk: 'road', tunnelRoad: 'road' };
  for (const p of state.projects) {
    // 처음부터 이어받은 공사(OSM 공사 중 노선)는 플레이어 사업이 아니므로 세지 않는다
    if (p.status !== 'done' || p.kind === 'osm') continue;
    out.done++;
    if (p.kind === 'upgrade') out.upgrades++;
    if (p.kind !== 'new' || !kind[p.type]) continue;
    out[kind[p.type]] += p.links.reduce((sum, id) => sum + (linkAt(base, state, id)?.len || 0), 0);
  }
  for (const k of ['hsr', 'rail', 'metro', 'road']) out[k] = Math.round(out[k]);
  return out;
}

/** 현황 탭 맨 위: 이번 판의 목표와 지금 상태 */
export let goalTimes = null;   // 서울–평양 목표용 최근 소요 시간 (해마다 잰다)
export function setGoalTimes(v) { return (goalTimes = v); }
export function goalHTML() {
  const G = GOALS[state.goal];
  if (!G?.check || !state.history.length) return '';
  const st = G.check({ h0: state.history[0], h1: state.history[state.history.length - 1], state, times1: goalTimes });
  if (!st) return `<p class="report-goal">${t('목표', 'Goal')} · ${G.label} <span class="m">(${t('재는 중', 'measuring')})</span></p>`;
  return `<p class="report-goal ${st.done ? 'good' : ''}">${t('목표', 'Goal')} · ${G.label}: ${t('지금', 'now')} <b>${st.now}</b> / ${t('목표', 'target')} ${st.target}${st.done ? t(' · 달성', ' · achieved') : ''}
    <span class="m">(${t(`${START_YEAR + 10}년 결산에서 판정`, `judged in the ${START_YEAR + 10} summary`)})</span></p>`;
}

/** 상징 구간(TIME_PAIRS)의 지금 소요 시간 (워커에 묻는다) */
export const routeWaits = new Map();
export let routeSeq = 0;
export function routeTimes() {
  const id = ++routeSeq;
  return new Promise((res) => {
    routeWaits.set(id, res);
    worker.postMessage({ type: 'routes', id, pairs: TIME_PAIRS.map(([, a, b]) => [a, b]) });
  });
}

/** 결산: 시작한 해와 지금을 견준 성적표 (이미지로 저장 단추) */
export async function showReport() {
  const h = state.history;
  if (!h.length || !result) { alert('아직 결산할 기록이 없습니다.'); return; }
  const h0 = h[0], h1 = h[h.length - 1];
  const years = [h0.year, state.year];
  const times1 = busy ? null : await routeTimes();
  const r = buildReport({ h0, h1, state, built: builtSummary(), times0: state.times0, times1 });
  showNotice(t(`${years[0]}–${years[1]}년 결산`, `Summary ${years[0]}–${years[1]}`), `${reportHTML(r, years)}
    <div class="actions" style="margin-top:10px"><button class="small primary" id="report-img">이미지로 저장 (SNS 공유용)</button></div>
    ${years[1] === years[0] ? `<p class="hint">${t('한 해 이상 넘겨야 변화가 보입니다.', 'Advance at least one year to see changes.')}</p>` : ''}`);
  lastReport = { r, years };
}
// 결산 알림은 앞선 알림(관광지 해금 등) 뒤에 줄을 서므로 단추는 문서에 걸어 둔다
export let lastReport = null;
document.addEventListener('click', async (e) => {
  const b = e.target.closest('#report-img');
  if (!b || !lastReport) return;
  const { r, years } = lastReport;
  b.disabled = true; b.textContent = '저장하는 중…';
  await downloadReportImage(map, r, years, `통일교통망_${years[0]}-${years[1]}_결산.png`);
  b.textContent = '저장했습니다';
});

// ------------------------------------------------------------ 저장 슬롯

export const SLOTS = 3;

export function slotsHTML() {
  const meta = slotMeta();
  const backup = state.backupStamp ? `<div class="item opt"><div class="opt-row"><span>지도 자료가 바뀌기 전 저장 <span class="m">이어 할 수 없음</span></span>
      <span><button class="small" id="backup-dl">파일로 받기</button></span></div></div>` : '';
  return `<div class="list">${Array.from({ length: SLOTS }, (_, k) => {
    const v = meta[k + 1];
    return `<div class="item opt"><div class="opt-row">
      <span>슬롯 ${k + 1} <span class="m">${v ? `${v.year}년 · ${new Date(v.savedAt).toLocaleString('ko-KR')}` : '비어 있음'}</span></span>
      <span><button class="small" data-slot-save="${k + 1}">저장</button> <button class="small" data-slot-load="${k + 1}" ${v ? '' : 'disabled'}>불러오기</button></span></div></div>`;
  }).join('')}${backup}</div>`;
}

export function bindSlots(el) {
  el.querySelectorAll('[data-slot-save]').forEach((b) => {
    b.onclick = async () => {
      const n = b.dataset.slotSave;
      if (slotMeta()[n] && !confirm(`슬롯 ${n}에 덮어쓸까요?`)) return;
      b.disabled = true;
      try {
        await saveSlot(n, state);
        state.log.unshift(`${state.year}년 슬롯 ${n}에 저장했습니다.`);
        save(state);
        renderAll();
        toast(`슬롯 ${n}에 저장했습니다.`);
      } catch (e) { alert(`저장하지 못했습니다: ${e?.message || e}. 설정 탭의 '파일로 내보내기'로 저장해 두세요.`); }
      b.disabled = false;
    };
  });
  el.querySelectorAll('[data-slot-load]').forEach((b) => {
    b.onclick = async () => {
      const n = b.dataset.slotLoad, v = slotMeta()[n];
      if (!v || !confirm(`슬롯 ${n}(${v.year}년)을 불러올까요? 지금 진행은 슬롯에 저장하지 않았다면 사라집니다.`)) return;
      const json = await loadSlot(n);
      if (!json) { alert('슬롯을 읽지 못했습니다.'); return; }
      save(JSON.parse(json));
      await flushSave();
      if (saveError()) { alert(`불러오지 못했습니다: ${saveError().message || saveError()}`); return; }
      clearSim();
      location.reload();
    };
  });
  el.querySelector('#backup-dl')?.addEventListener('click', async () => {
    const json = await loadBackup(state.backupStamp);
    if (!json) { alert('예전 저장을 찾지 못했습니다.'); return; }
    const st = JSON.parse(json);
    const blob = new Blob([JSON.stringify({ app: 'unified-korea-transport', version: APP_VERSION, savedAt: Date.now(), state: st })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `통일교통망_${st.year}년_자료${st.dataStamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  });
}

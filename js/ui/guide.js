// 처음 시작할 때의 짧은 안내: 화면의 주요 자리를 차례로 밝히고 한두 문장으로 설명한다.
// 저절로 뜨는 때는 설정 › 도움말에서 고른다: 처음 한 번만(기본) / 새 게임마다 / 보지 않기.
// 언제든 상단 바의 "?" 단추나 메뉴 찾기의 "처음 안내 다시 보기"로 연다.

const SEEN_KEY = 'ukt-guide-v1';
const MODE_KEY = 'ukt-guide-mode';
export const GUIDE_MODES = { once: '처음 한 번만', newgame: '새 게임을 시작할 때마다', off: '보지 않기' };

let box = null, idx = 0, steps = [], onEnd = null;

function rectOf(sel) {
  const t = typeof sel === 'function' ? sel() : document.querySelector(sel);
  if (!t) return null;
  const r = t.getBoundingClientRect();
  return r.width && r.height ? r : null;
}

function render() {
  const s = steps[idx];
  const r = rectOf(s.target);
  const hole = box.querySelector('.gd-hole'), card = box.querySelector('.gd-card');
  if (r) {
    const pad = 6;
    Object.assign(hole.style, { display: 'block', left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  } else hole.style.display = 'none';
  card.innerHTML = `<div class="gd-step">${idx + 1} / ${steps.length}</div>
    <h3>${s.title}</h3><p>${s.body}</p>
    <div class="gd-btns"><button class="small" data-gd="skip">건너뛰기</button><span style="flex:1"></span>
      ${idx ? '<button class="small" data-gd="prev">이전</button>' : ''}
      <button class="small primary" data-gd="next">${idx === steps.length - 1 ? '시작하기' : '다음'}</button></div>
    <button class="gd-never" data-gd="never">다시 보지 않기 (설정 › 도움말에서 바꿀 수 있습니다)</button>`;
  // 카드 자리: 좁은 화면은 아래쪽에 붙이고, 넓은 화면은 대상 옆(공간이 남는 쪽)에
  const W = innerWidth, H = innerHeight, cw = Math.min(340, W - 24);
  card.style.width = `${cw}px`;
  if (W < 640 || !r) {
    Object.assign(card.style, { left: `${(W - cw) / 2}px`, top: 'auto', bottom: '12px' });
  } else {
    const ch = card.offsetHeight || 180;
    let left = r.right + 16, top = r.top;
    if (left + cw > W - 12) left = r.left - cw - 16;
    if (left < 12) { left = Math.min(Math.max(12, r.left), W - cw - 12); top = r.bottom + 12; if (top + ch > H - 12) top = r.top - ch - 12; }
    top = Math.min(Math.max(12, top), H - ch - 12);
    Object.assign(card.style, { left: `${left}px`, top: `${top}px`, bottom: 'auto' });
  }
  card.querySelector('[data-gd="next"]').focus();
}

function close(done) {
  if (!box) return;
  box.remove();
  box = null;
  removeEventListener('resize', render);
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* 저장 못 해도 된다 */ }
  onEnd?.(done);
}

/**
 * @param {{target:string|(()=>Element), title:string, body:string, before?:()=>void}[]} list
 */
export function startGuide(list, end) {
  if (box) close(false);
  steps = list; idx = 0; onEnd = end;
  box = document.createElement('div');
  box.id = 'guide';
  box.innerHTML = '<div class="gd-hole"></div><div class="gd-card" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(box);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gd]');
    if (!b) return;
    if (b.dataset.gd === 'skip') return close(false);
    if (b.dataset.gd === 'never') { setGuideMode('off'); return close(false); }
    if (b.dataset.gd === 'prev') idx = Math.max(0, idx - 1);
    if (b.dataset.gd === 'next') { if (idx === steps.length - 1) return close(true); idx++; }
    steps[idx].before?.();
    requestAnimationFrame(render);
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close(false);
    if (e.key === 'ArrowRight') box.querySelector('[data-gd="next"]')?.click();
    if (e.key === 'ArrowLeft') box.querySelector('[data-gd="prev"]')?.click();
  });
  addEventListener('resize', render);
  steps[0].before?.();
  render();
}

export function getGuideMode() {
  try { return localStorage.getItem(MODE_KEY) || 'once'; } catch { return 'once'; }
}

export function setGuideMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* 저장 못 해도 된다 */ }
}

/** 게임을 열 때 안내를 저절로 띄울지 (보지 않기면 띄우지 않고, 아니면 아직 안 본 경우만) */
export function guideShouldAutoShow() {
  if (getGuideMode() === 'off') return false;
  try { return localStorage.getItem(SEEN_KEY) !== '1'; } catch { return false; }
}

/** 새 게임을 시작할 때: '새 게임마다'면 다음에 열 때 다시 뜨게 한다 */
export function guideOnNewGame() {
  if (getGuideMode() !== 'newgame') return;
  try { localStorage.removeItem(SEEN_KEY); } catch { /* 저장 못 해도 된다 */ }
}

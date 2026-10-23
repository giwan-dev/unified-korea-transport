// 메뉴 찾기(명령 팔레트): Ctrl+K 또는 / 로 열고, 이름 일부나 초성으로 탭·묶음·동작을 찾아 바로 실행한다.
// 명령은 두 가지에서 모은다.
//  - main.js가 넘겨주는 동작 (다음 해, 건설 도구, 계획 사업, 지역·노선으로 이동 등)
//  - 오른쪽 패널의 탭과 접는 묶음 제목 (화면에서 바로 읽으므로 새 묶음이 생겨도 저절로 찾힌다)

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
/** 한글 음절을 초성으로 (그 밖의 글자는 그대로) */
function chosung(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00;
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }
  return out;
}
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
const isCho = (s) => /^[ㄱ-ㅎ]+$/.test(s);

/** 점수: 0 이면 안 맞음. 앞부분 일치 > 포함 > 초성 포함 */
function score(cmd, q, words) {
  if (!q) return 1;
  const t = norm(cmd.title), k = norm(cmd.keywords || ''), g = norm(cmd.group || '');
  if (t.startsWith(q)) return 100 - t.length / 100;
  if (t.includes(q)) return 80 - t.indexOf(q);
  if (k.includes(q) || g.includes(q)) return 50;
  if (isCho(q)) {
    const ct = chosung(t);
    if (ct.startsWith(q)) return 45;
    if (ct.includes(q)) return 40;
    if (chosung(k).includes(q)) return 30;
  }
  // 띄어 쓴 여러 낱말(예: "철도 폐선")이 제목·분류에 모두 들어 있으면
  if (words.length > 1 && words.every((w) => `${g}${t}${k}`.includes(w))) return 20;
  return 0;
}

let el = null, input = null, list = null, items = [], active = 0, provider = () => [], lastFocus = null;

function panelCommands() {
  const out = [];
  document.querySelectorAll('#tabs button[data-tab]').forEach((b) => {
    const tab = b.dataset.tab, label = b.textContent.replace(/\d+/g, '').trim();
    out.push({ group: '탭', title: `${label} 탭`, keywords: label, run: () => b.click() });
    const panel = document.querySelector(`[data-panel="${tab}"]`);
    panel?.querySelectorAll('details.fold > summary, details.fold-sub > summary').forEach((s) => {
      const title = s.textContent.replace(/\s+/g, ' ').trim();
      if (!title) return;
      out.push({
        group: label, title, keywords: `${label} ${title}`,
        run: () => {
          b.click();
          // 탭을 바꾸면 패널을 다시 그릴 수 있으므로, 실행할 때 제목으로 다시 찾는다
          requestAnimationFrame(() => {
            const sum = [...document.querySelectorAll(`[data-panel="${tab}"] details > summary`)].find((x) => x.textContent.replace(/\s+/g, ' ').trim() === title);
            if (!sum) return;
            let d = sum.parentElement;
            while (d && d.tagName === 'DETAILS') { d.open = true; d = d.parentElement.closest('details'); }
            sum.scrollIntoView({ block: 'start', behavior: 'smooth' });
            sum.classList.add('flash');
            setTimeout(() => sum.classList.remove('flash'), 1400);
          });
        },
      });
    });
  });
  return out;
}

function build() {
  el = document.createElement('div');
  el.id = 'palette';
  el.hidden = true;
  el.innerHTML = `<div class="pal-box" role="dialog" aria-modal="true" aria-label="메뉴 찾기">
    <div class="pal-in"><span aria-hidden="true">⌕</span><input type="search" placeholder="메뉴·동작·지역 찾기 (예: 고속도로, 폐선, 광역시, ㄱㅅ)" aria-label="찾을 메뉴" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div>
    <ul class="pal-list" role="listbox"></ul>
    <div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 고르기</span><span><kbd>Enter</kbd> 실행</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> 또는 <kbd>/</kbd> 로 열기</span></div>
  </div>`;
  document.body.appendChild(el);
  input = el.querySelector('input');
  list = el.querySelector('.pal-list');
  el.addEventListener('mousedown', (e) => { if (e.target === el) closePalette(); });
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(active); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) runAt(+li.dataset.i); });
  list.addEventListener('mousemove', (e) => { const li = e.target.closest('li[data-i]'); if (li && +li.dataset.i !== active) { active = +li.dataset.i; paint(); } });
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function refresh() {
  const q = norm(input.value), words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let all = [];
  try { all = [...provider(), ...panelCommands()]; } catch (err) { console.error(err); all = panelCommands(); }
  const seen = new Set();
  items = all.map((c) => [c, score(c, q, words)]).filter(([c, s]) => {
    if (!(s > 0)) return false;
    const k = `${c.group}|${c.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => b[1] - a[1] || (a[0].order ?? 50) - (b[0].order ?? 50)).slice(0, q ? 40 : 14).map(([c]) => c);
  active = 0;
  paint();
}

function paint() {
  list.innerHTML = items.map((c, i) => `<li role="option" data-i="${i}" class="${i === active ? 'on' : ''}" aria-selected="${i === active}">
    <span class="pal-g">${esc(c.group || '')}</span><span class="pal-t">${esc(c.title)}</span>${c.hint ? `<span class="pal-h">${esc(c.hint)}</span>` : ''}</li>`).join('')
    || '<li class="pal-none">맞는 메뉴가 없습니다. 다른 낱말이나 초성(예: ㄱㅅㄷㄹ)으로 찾아보세요.</li>';
  list.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
}

function move(d) {
  if (!items.length) return;
  active = (active + d + items.length) % items.length;
  paint();
}

function runAt(i) {
  const c = items[i];
  if (!c) return;
  closePalette();
  try { c.run(); } catch (err) { console.error(err); }
}

export function openPalette(q = '') {
  if (!el) build();
  lastFocus = document.activeElement;
  el.hidden = false;
  input.value = q;
  refresh();
  input.focus();
}

export function closePalette() {
  if (!el || el.hidden) return;
  el.hidden = true;
  if (lastFocus?.focus) lastFocus.focus();
}

/**
 * @param {() => {title:string, group?:string, keywords?:string, hint?:string, order?:number, run:()=>void}[]} getCommands
 */
export function initPalette(getCommands) {
  provider = getCommands;
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); el && !el.hidden ? closePalette() : openPalette(); }
    else if (e.key === '/' && !typing && (!el || el.hidden)) { e.preventDefault(); openPalette(); }
  });
}

// 오른쪽 패널 공용 도구: 접는 소묶음, 표 머리글 정렬, 알림 띠

const FOLD_KEY = 'ukt-folds-v2';

function readFolds() {
  try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { return {}; }
}
function writeFold(id, open) {
  const f = readFolds();
  f[id] = open;
  try { localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch { /* 저장 못 해도 된다 */ }
}

/** 접는 소묶음 (계획 사업 분류 등). 펼침 상태는 이 브라우저에 남는다 */
export function subFold(id, summary, body, open = false) {
  const o = readFolds()[id] ?? open;
  return `<details class="fold-sub" data-fold="${id}" ${o ? 'open' : ''}><summary>${summary}</summary><div class="fold-body">${body}</div></details>`;
}

// ---- 표 정렬: 패널 안 table.cmp의 머리글을 누르면 그 열로 오름차순 → 내림차순 → 원래 순서
const sorts = new Map();   // 표 머리글 글자 → {col, dir}

const UNITS = { 조: 1e12, 억: 1e8, 백만: 1e6, 만: 1e4, 천: 1e3 };
function cellValue(td) {
  const t = (td?.textContent || '').trim();
  const m = t.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return { s: t };
  let v = parseFloat(m[0]);
  const after = t.replace(/,/g, '').slice(m.index + m[0].length);
  const u = Object.keys(UNITS).find((k) => after.startsWith(k));
  if (u) v *= UNITS[u];
  if (/^\s*▼/.test(t)) v = -v;
  return { n: v, s: t };
}

function tableKey(table) {
  const head = table.querySelector('tr');
  return head ? [...head.children].map((c) => c.textContent.replace(/[▲▼↕]/g, '').trim()).join('|') : '';
}

function headerRow(table) {
  const tr = table.querySelector('tr');
  return tr && tr.querySelector('th') ? tr : null;
}

function applySort(table) {
  const head = headerRow(table);
  if (!head) return;
  const key = tableKey(table);
  const s = sorts.get(key);
  const body = head.parentElement;
  const rows = [...body.children].filter((r) => r !== head && r.tagName === 'TR');
  rows.forEach((r, i) => { if (r.dataset.ord == null) r.dataset.ord = i; });
  [...head.children].forEach((th, i) => {
    if (!th.textContent.trim()) return;   // 빈 머리글(행 이름 열)은 정렬하지 않는다
    th.classList.add('sortable');
    th.classList.toggle('asc', !!s && s.col === i && s.dir === 1);
    th.classList.toggle('desc', !!s && s.col === i && s.dir === -1);
    th.setAttribute('aria-sort', s && s.col === i ? (s.dir === 1 ? 'ascending' : 'descending') : 'none');
    th.title = '눌러서 정렬';
  });
  const sorted = rows.slice().sort((a, b) => {
    if (!s) return a.dataset.ord - b.dataset.ord;
    const x = cellValue(a.children[s.col]), y = cellValue(b.children[s.col]);
    let d;
    if (x.n != null && y.n != null) d = x.n - y.n;
    else if (x.n != null) d = -1;
    else if (y.n != null) d = 1;
    else d = x.s.localeCompare(y.s, 'ko');
    return d * s.dir || a.dataset.ord - b.dataset.ord;
  });
  for (const r of sorted) body.appendChild(r);
}

function onHeaderClick(e) {
  const th = e.target.closest('table.cmp th');
  if (!th) return;
  const table = th.closest('table');
  const head = headerRow(table);
  if (!head || th.parentElement !== head || !th.classList.contains('sortable')) return;
  const col = [...head.children].indexOf(th);
  const key = tableKey(table);
  const cur = sorts.get(key);
  // 처음 누르면 숫자 열은 큰 것부터(내림차순), 글자 열은 가나다순
  const numeric = [...table.querySelectorAll('tr')].slice(1, 4).some((r) => cellValue(r.children[col]).n != null);
  const first = numeric ? -1 : 1;
  if (!cur || cur.col !== col) sorts.set(key, { col, dir: first });
  else if (cur.dir === first) sorts.set(key, { col, dir: -first });
  else sorts.delete(key);
  applySort(table);
}

/** 패널 공용 동작을 붙인다: 소묶음 펼침 기억, 표 정렬 (패널을 다시 그려도 정렬은 이어진다) */
export function initPanelUI(root) {
  root.addEventListener('click', onHeaderClick);
  root.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches?.('details[data-fold]')) writeFold(d.dataset.fold, d.open);
  }, true);
  const prep = () => root.querySelectorAll('table.cmp').forEach((t) => { if (!t.dataset.sortReady) { t.dataset.sortReady = 1; applySort(t); } });
  new MutationObserver(prep).observe(root, { childList: true, subtree: true });
  prep();
}

// ---- 알림 띠: 받아들이기·착공처럼 결과가 화면 밖에서 일어나는 동작을 알린다
let toastTimer = null;
export function toast(html, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.className = `show ${kind}`;
  el.innerHTML = html;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = kind; }, 4500);
}

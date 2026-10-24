// 통일 첫해(2026년)의 행정구역 정리 창: 게임을 시작하면 사용법 안내보다 먼저 뜬다.
// 남북 정리(개성·지명·옹진·고성 등), 북측 도 체계, 분단 전 군 되살리기를 한 번에 고른다. 2026년 안에만 다시 열 수 있다.

/**
 * @param {{groups:{title:string, hint?:string, options:{key:string,label:string,choices:[string,string][]}[]}[],
 *          current:Record<string,string>, defaults:Record<string,string>, title:string, intro:string, okLabel:string,
 *          onApply:(choice:Record<string,string>)=>void, onClose?:()=>void, esc:(s:string)=>string}} o
 */
export function openAdminSetup(o) {
  const wrap = document.createElement('div');
  wrap.className = 'setup-wrap';
  const select = (opt) => `<label class="setup-row"><span>${o.esc(opt.label)}</span>
    <select data-setup="${opt.key}">${opt.choices.map(([v, t]) => `<option value="${v}" ${o.current[opt.key] === v ? 'selected' : ''}>${o.esc(t)}</option>`).join('')}</select></label>`;
  wrap.innerHTML = `<div class="setup" role="dialog" aria-modal="true" aria-labelledby="setup-title">
    <h2 id="setup-title">${o.title}</h2>
    <p class="setup-intro">${o.intro}</p>
    <div class="setup-body">${o.groups.map((g) => `<section><h3>${g.title}</h3>${g.hint ? `<p class="hint">${g.hint}</p>` : ''}${g.options.map(select).join('')}</section>`).join('')}</div>
    <div class="setup-btns"><button class="small" data-setup-act="default">모두 기본값으로</button><span style="flex:1"></span>
      ${o.onClose ? '<button class="small" data-setup-act="cancel">닫기</button>' : ''}
      <button class="primary" data-setup-act="ok">${o.okLabel}</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const read = () => Object.fromEntries([...wrap.querySelectorAll('[data-setup]')].map((s) => [s.dataset.setup, s.value]));
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-setup-act]');
    if (!b) return;
    if (b.dataset.setupAct === 'default') wrap.querySelectorAll('[data-setup]').forEach((s) => { s.value = o.defaults[s.dataset.setup] ?? s.options[0].value; });
    if (b.dataset.setupAct === 'cancel') { close(); o.onClose?.(); }
    if (b.dataset.setupAct === 'ok') { const c = read(); close(); o.onApply(c); }
  });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape' && o.onClose) { close(); o.onClose(); } });
  wrap.querySelector('[data-setup-act="ok"]').focus();
}

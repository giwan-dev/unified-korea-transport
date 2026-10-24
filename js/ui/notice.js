// 화면 가운데 알림창 (관광지 해금 등). 여러 개가 오면 차례로 띄운다.

const queue = [];
let open = false;

export function showNotice(title, html) {
  queue.push({ title, html });
  if (!open) next();
}

function next() {
  const n = queue.shift();
  if (!n) { open = false; return; }
  open = true;
  const wrap = document.createElement('div');
  wrap.className = 'notice-wrap';
  Object.assign(wrap.style, { position: 'fixed', inset: '0', background: 'rgba(15,20,28,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 });
  wrap.innerHTML = `<div class="notice" role="dialog" aria-modal="true" style="background:var(--panel,#fff);color:var(--ink,#1d232b);max-width:420px;width:calc(100% - 32px);border-radius:10px;padding:18px 20px;box-shadow:0 10px 40px rgba(0,0,0,.25)">
    <div style="font-weight:800;font-size:16px;margin-bottom:8px">${n.title}</div>
    <div style="font-size:13px;line-height:1.55">${n.html}</div>
    <div style="text-align:right;margin-top:14px"><button class="primary" id="notice-ok">확인</button></div></div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); next(); };
  wrap.querySelector('#notice-ok').onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('#notice-ok').focus();
}

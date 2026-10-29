// 착공한 사업의 고시문: 정부 고시 형식의 계획안 공문서(사업 개요·노선도·정거장 계획·위치도·재원·일정)를 띄운다.
// main.js가 사업 자료를 모아 openGazette(doc)으로 넘긴다. 게임 속 가상의 문서다.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const css = `
  .gz-back { position: fixed; inset: 0; background: rgba(20, 24, 28, 0.55); z-index: 3000; overflow: auto; padding: 24px 12px; }
  .gz-bar { max-width: 794px; margin: 0 auto 8px; display: flex; gap: 8px; justify-content: flex-end; }
  .gz-bar label { margin-right: auto; color: #fff; font-size: 13px; display: flex; align-items: center; gap: 6px; }
  .gz-page { max-width: 794px; margin: 0 auto; background: #fff; color: #111; padding: 56px 64px 48px; box-shadow: 0 6px 30px rgba(0,0,0,.35);
    font-family: "Batang", "바탕", "Noto Serif KR", "Nanum Myeongjo", serif; line-height: 1.7; font-size: 14.5px; }
  .gz-page * { box-sizing: border-box; }
  .gz-org { text-align: center; font-size: 26px; font-weight: 700; letter-spacing: 6px; }
  .gz-orgsub { text-align: center; font-size: 12px; letter-spacing: 2px; color: #444; margin-bottom: 10px; }
  .gz-rule { border: 0; border-top: 3px double #111; margin: 10px 0 18px; }
  .gz-no { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
  .gz-title { font-size: 21px; font-weight: 700; text-align: center; margin: 18px 0 16px; word-break: keep-all; }
  .gz-lead { text-indent: 1em; word-break: keep-all; }
  .gz-sign { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin: 18px 0 26px; font-size: 17px; font-weight: 700; letter-spacing: 3px; }
  .gz-seal { width: 74px; height: 74px; border: 3px solid #c8281e; color: #c8281e; display: grid; place-items: center; font-size: 13px; line-height: 1.15;
    text-align: center; letter-spacing: 1px; transform: rotate(-4deg); opacity: .85; font-weight: 700; border-radius: 4px; }
  .gz-date { text-align: right; margin-top: 8px; }
  .gz-h { font-size: 16px; font-weight: 700; margin: 22px 0 8px; }
  .gz-t { width: 100%; border-collapse: collapse; font-size: 13.5px; margin: 4px 0 6px; }
  .gz-t th, .gz-t td { border: 1px solid #333; padding: 5px 8px; vertical-align: middle; word-break: keep-all; }
  .gz-t th { background: #f0eee8; font-weight: 700; text-align: center; white-space: nowrap; }
  .gz-t td.c { text-align: center; } .gz-t td.r { text-align: right; white-space: nowrap; }
  .gz-fig { border: 1px solid #333; padding: 10px; margin: 6px 0; }
  .gz-cap { text-align: center; font-size: 12.5px; color: #333; margin-top: 4px; }
  .gz-chip { display: inline-block; padding: 0 6px; border-radius: 9px; color: #fff; font-size: 11.5px; margin: 1px 2px; font-family: sans-serif; line-height: 18px; }
  .gz-end { text-align: right; margin-top: 18px; }
  .gz-note { font-size: 11.5px; color: #666; border-top: 1px solid #bbb; margin-top: 26px; padding-top: 6px; }
  @media print {
    body > *:not(.gz-back) { display: none !important; }
    .gz-back { position: static; background: none; padding: 0; overflow: visible; }
    .gz-bar { display: none; }
    .gz-page { box-shadow: none; max-width: none; padding: 0; }
  }`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

/** 노선도: 역을 한 줄에 늘어놓은 도식 (환승 노선은 역 밑에 색 띠로) */
function schematicSVG(doc) {
  const st = doc.stations;
  const n = st.length;
  const W = 680, padX = 34;
  const H = 150 + Math.max(0, ...st.map((s) => s.transfers.length)) * 16;
  const y = 70;
  const x = (i) => (n === 1 ? W / 2 : padX + ((W - 2 * padX) * i) / (n - 1));
  const parts = [`<line x1="${x(0)}" y1="${y}" x2="${x(n - 1)}" y2="${y}" stroke="${doc.color}" stroke-width="9" stroke-linecap="round"/>`];
  st.forEach((s, i) => {
    const xi = x(i);
    const transfer = s.transfers.length > 0;
    parts.push(transfer
      ? `<circle cx="${xi}" cy="${y}" r="9" fill="#fff" stroke="#111" stroke-width="3"/>`
      : `<circle cx="${xi}" cy="${y}" r="6.5" fill="#fff" stroke="${doc.color}" stroke-width="3"/>`);
    parts.push(`<text x="${xi}" y="${y - 18}" font-size="12.5" text-anchor="start" transform="rotate(-38 ${xi} ${y - 18})" font-family="sans-serif" fill="#111">${esc(s.name)}</text>`);
    if (s.code) parts.push(`<text x="${xi}" y="${y + 24}" font-size="10" text-anchor="middle" font-family="sans-serif" fill="#555">${esc(s.code)}</text>`);
    s.transfers.forEach((t, k) => {
      parts.push(`<rect x="${xi - 21}" y="${y + 32 + k * 16}" width="42" height="13" rx="6" fill="${t.color}"/>`
        + `<text x="${xi}" y="${y + 42 + k * 16}" font-size="8.5" text-anchor="middle" fill="#fff" font-family="sans-serif">${esc(t.short)}</text>`);
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="노선도">${parts.join('')}</svg>`;
}

/** 위치도: 사업 구간 둘레의 시군구 경계·기존 철도 위에 새 노선 */
function locationSVG(doc) {
  const [[x0, y0], [x1, y1]] = doc.bbox;
  const W = 680, kx = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
  const sx = (x1 - x0) * kx, sy = y1 - y0;
  const H = Math.round(Math.min(620, Math.max(300, (W * sy) / Math.max(sx, 1e-9))));
  const s = Math.min(W / sx, H / sy);
  const ox = (W - sx * s) / 2, oy = (H - sy * s) / 2;
  const P = ([lon, lat]) => `${(ox + (lon - x0) * kx * s).toFixed(1)},${(oy + (y1 - lat) * s).toFixed(1)}`;
  const path = (pts) => pts.map(P).join(' ');
  const out = [`<rect width="${W}" height="${H}" fill="#fbfaf6"/>`];
  for (const ring of doc.context.boundaries) out.push(`<polyline points="${path(ring)}" fill="none" stroke="#b9b4a8" stroke-width="0.8"/>`);
  for (const l of doc.context.lines) out.push(`<polyline points="${path(l.pts)}" fill="none" stroke="${l.color}" stroke-width="${l.w}" stroke-opacity="0.75"/>`);
  for (const lab of doc.context.labels) out.push(`<text x="${P(lab.at).split(',')[0]}" y="${P(lab.at).split(',')[1]}" font-size="11" fill="#8a857a" text-anchor="middle" font-family="sans-serif">${esc(lab.name)}</text>`);
  // 사업 구간 (개량 사업은 떨어진 구간이 여럿일 수 있다)
  for (const pts of doc.paths || [doc.path]) out.push(`<polyline points="${path(pts)}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const pts of doc.paths || [doc.path]) out.push(`<polyline points="${path(pts)}" fill="none" stroke="${doc.color}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const st of doc.stations) {
    const [px, py] = P([st.lon, st.lat]).split(',').map(Number);
    out.push(`<circle cx="${px}" cy="${py}" r="${st.transfers.length ? 6 : 4.5}" fill="#fff" stroke="${st.transfers.length ? '#111' : doc.color}" stroke-width="2.5"/>`);
    out.push(`<text x="${px + 8}" y="${py - 6}" font-size="11.5" font-family="sans-serif" fill="#111" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(st.name)}</text>`);
  }
  // 축척 막대와 방위
  const kmPx = s / 111;
  const bar = [1, 2, 5, 10, 20, 50, 100].find((k) => k * kmPx > 70) || 100;
  out.push(`<g font-family="sans-serif" font-size="10.5" fill="#333"><rect x="18" y="${H - 26}" width="${bar * kmPx}" height="5" fill="#333"/>`
    + `<text x="18" y="${H - 32}">0</text><text x="${18 + bar * kmPx}" y="${H - 32}" text-anchor="middle">${bar}km</text>`
    + `<text x="${W - 22}" y="28" text-anchor="middle" font-weight="700">N</text><path d="M${W - 22} 32 l-6 16 l6 -4 l6 4 z" fill="#333"/></g>`);
  out.push(`<rect width="${W}" height="${H}" fill="none" stroke="#333"/>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="위치도">${out.join('')}</svg>`;
}

/** 고시문 HTML */
export function gazetteHTML(doc) {
  const rows = (pairs) => pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('');
  const stationRows = doc.stations.map((s, i) => `<tr><td class="c">${esc(s.code || i + 1)}</td><td>${esc(s.name)}${s.isNew ? '' : ' <span style="color:#666">(기존)</span>'}</td>
    <td class="r">${s.km.toFixed(1)}</td><td>${s.transfers.map((t) => `<span class="gz-chip" style="background:${t.color}">${esc(t.short)}</span>`).join('') || '–'}</td><td>${esc(s.place)}</td></tr>`).join('');
  return `<div class="gz-page">
    <div class="gz-org">${esc(doc.org)}</div>
    <div class="gz-orgsub">${esc(doc.orgSub)}</div>
    <hr class="gz-rule">
    <div class="gz-no">${esc(doc.docNo)}</div>
    <div class="gz-title">${esc(doc.title)}</div>
    <p class="gz-lead">${esc(doc.lead)}</p>
    <div class="gz-date">${esc(doc.date)}</div>
    <div class="gz-sign">${esc(doc.signer)}<div class="gz-seal">${esc(doc.sealText).split('|').join('<br>')}</div></div>

    <div class="gz-h">1. 사업 개요</div>
    <table class="gz-t">${rows(doc.overview)}</table>

    <div class="gz-h">2. 노선도</div>
    <div class="gz-fig">${schematicSVG(doc)}<div class="gz-cap">〈그림 1〉 ${esc(doc.lineName)} 노선도 (●: 환승 정거장)</div></div>

    <div class="gz-h">3. ${doc.stopWord} 계획</div>
    <table class="gz-t"><tr><th>번호</th><th>${doc.stopWord}명(가칭)</th><th>거리(km)</th><th>환승·연결</th><th>소재지</th></tr>${stationRows}</table>

    <div class="gz-h">4. 위치도</div>
    <div class="gz-fig">${locationSVG(doc)}<div class="gz-cap">〈그림 2〉 사업 위치도</div></div>

    <div class="gz-h">5. 총사업비 및 재원 분담</div>
    <table class="gz-t"><tr><th>구분</th><th>금액</th><th>비율</th></tr>${doc.funding.map(([k, v, r]) => `<tr><td class="c">${esc(k)}</td><td class="r">${esc(v)}</td><td class="r">${esc(r)}</td></tr>`).join('')}</table>

    <div class="gz-h">6. 추진 일정</div>
    <table class="gz-t"><tr><th>단계</th><th>시기</th><th>비고</th></tr>${doc.schedule.map(([k, v, r]) => `<tr><td class="c">${esc(k)}</td><td class="c">${esc(v)}</td><td>${esc(r)}</td></tr>`).join('')}</table>

    <div class="gz-h">7. 기대 효과</div>
    <ul>${doc.effects.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>

    <div class="gz-h">8. 관계 도서 열람</div>
    <p class="gz-lead">${esc(doc.inspect)}</p>
    <div class="gz-end">붙임 노선 위치도 1부. 끝.</div>
    <div class="gz-note">이 문서는 게임 「통일 한반도 교통망」 속 가상의 고시문입니다. 실제 정부 문서가 아닙니다.</div>
  </div>`;
}

/** 고시문 창을 띄운다. onAuto: '착공할 때마다 열기' 체크 상태가 바뀌면 */
export function openGazette(doc, { auto = null, onAuto = null } = {}) {
  injectStyle();
  document.querySelector('.gz-back')?.remove();
  const back = document.createElement('div');
  back.className = 'gz-back';
  back.innerHTML = `<div class="gz-bar">
      ${auto == null ? '' : `<label><input type="checkbox" class="gz-auto" ${auto ? 'checked' : ''}> 착공할 때마다 열기</label>`}
      <button class="small" data-gz="print">인쇄·PDF 저장</button><button class="small primary" data-gz="close">닫기</button></div>
    ${gazetteHTML(doc)}`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.querySelector('[data-gz=close]').onclick = close;
  back.querySelector('[data-gz=print]').onclick = () => window.print();
  back.querySelector('.gz-auto')?.addEventListener('change', (e) => onAuto?.(e.target.checked));
}

// 노선 모식도: 노선을 직선으로 펴서 역, 운행 계통별 정차·통과, 구간 혼잡도, 시각별 열차 위치를 보여 준다.

const VC_COLORS = [[0, '#3f9e63'], [0.6, '#c5c23a'], [1, '#f0a030'], [2, '#e0582c'], [4, '#c21f2f'], [7, '#7e1048']];
const KIND_COLOR = { limited: '#c0392b', express: '#d68910', local: '#2471a3', base: '#566573' };
const DAY = 1440;   // 24시간 운행 (자정을 넘겨도 열차가 이어 다닌다)

function vcColor(v) {
  let c = VC_COLORS[0][1];
  for (const [t, col] of VC_COLORS) if (v >= t) c = col;
  return c;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let timer = null;

/**
 * @param {HTMLElement} el 그릴 곳
 * @param {object} d {title, stations:[{name, km}], segs:[{vc, vol}], rows:[{name, kind, label, first, last,
 *   stops:Set<역 번호>, trains, times:[역별 도착 분], segVC:[구간별 V/C|null]}]}
 */
export function showLineDiagram(el, d, onClose) {
  stopLineDiagram();
  const N = d.stations.length;
  const total = d.stations[N - 1].km || 1;
  // 역 간격: 거리 비례이되 너무 붙지 않게 (최소 26px)
  const minGap = 26, pxPerKm = Math.max(3, Math.min(14, 1400 / total));
  const xs = [];
  let x = 200;
  d.stations.forEach((s, i) => {
    if (i) x += Math.max(minGap, (s.km - d.stations[i - 1].km) * pxPerKm);
    xs.push(x);
  });
  const W = x + 60;
  const top = 92, rowH = 54;
  const H = top + 34 + d.rows.length * rowH + 10;
  const xAtKm = (km) => {
    for (let i = 1; i < N; i++) {
      if (km <= d.stations[i].km) {
        const a = d.stations[i - 1].km, b = d.stations[i].km;
        return xs[i - 1] + (b > a ? (km - a) / (b - a) : 0) * (xs[i] - xs[i - 1]);
      }
    }
    return xs[N - 1];
  };

  // 위: 역 이름과 구간 혼잡도 (실제 선로 V/C)
  let svg = '';
  d.stations.forEach((s, i) => {
    svg += `<text x="${xs[i]}" y="${top - 14}" transform="rotate(-50 ${xs[i]} ${top - 14})" class="ld-st" data-st="${i}"><title>${esc(s.name)} 역 정보</title>${esc(s.name)}</text>`;
  });
  d.segs.forEach((sg, i) => {
    svg += `<line x1="${xs[i]}" y1="${top}" x2="${xs[i + 1]}" y2="${top}" stroke="${vcColor(sg.vc)}" stroke-width="7" ${sg.gap ? 'stroke-dasharray="3 3"' : ''}>
      <title>${esc(d.stations[i].name)}–${esc(d.stations[i + 1].name)}: V/C ${sg.vc.toFixed(2)} · ${Math.round(sg.vol).toLocaleString()}명/일</title></line>`;
  });
  d.stations.forEach((s, i) => { svg += `<circle cx="${xs[i]}" cy="${top}" r="3.5" class="ld-dot"/>`; });
  svg += `<text x="12" y="${top + 4}" class="ld-row">선로 혼잡도</text>`;

  // 아래: 운행 계통별 정차(●)·통과(│)
  d.rows.forEach((r, k) => {
    const y = top + 40 + k * rowH;
    const col = KIND_COLOR[r.kind] || KIND_COLOR.base;
    svg += `<text x="12" y="${y - 8}" class="ld-row" fill="${col}">${esc(r.name)}</text>
      <text x="12" y="${y + 8}" class="ld-sub">${esc(r.label)}</text>`;
    for (let i = r.first; i < r.last; i++) {
      const v = r.segVC?.[i];
      svg += `<line x1="${xs[i]}" y1="${y}" x2="${xs[i + 1]}" y2="${y}" stroke="${v == null ? col : vcColor(v)}" stroke-width="${v == null ? 2 : 4}">
        ${v == null ? '' : `<title>열차 혼잡도 ${Math.round(v * 100)}%</title>`}</line>`;
    }
    for (let i = r.first; i <= r.last; i++) {
      svg += r.stops.has(i)
        ? `<circle cx="${xs[i]}" cy="${y}" r="4.5" fill="#fff" stroke="${col}" stroke-width="2.5"><title>${esc(d.stations[i].name)} 정차</title></circle>`
        : `<line x1="${xs[i]}" y1="${y - 3}" x2="${xs[i]}" y2="${y + 3}" stroke="${col}" stroke-width="1.5"><title>${esc(d.stations[i].name)} 통과</title></line>`;
    }
    svg += `<g class="ld-trains" data-row="${k}"></g>`;
  });

  el.innerHTML = `<div class="ld-head"><b>${esc(d.title)}</b>
      <span class="ld-clock" id="ld-clock">07:00</span>
      <button class="small" id="ld-play">⏸</button>
      <select id="ld-speed"><option value="1">1분/0.1초</option><option value="5" selected>5분/0.1초</option><option value="15">15분/0.1초</option></select>
      <span class="ld-legend">● 정차 │ 통과 · ▶ 하행 ◀ 상행 · 선 색 = 혼잡도</span>
      <button class="small close" id="ld-close">닫기</button></div>
    <div class="ld-scroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg></div>`;
  el.hidden = false;
  el.querySelector('#ld-close').onclick = () => { stopLineDiagram(); el.hidden = true; onClose?.(); };
  if (d.onStation) el.querySelectorAll('[data-st]').forEach((t) => { t.onclick = () => d.onStation(+t.dataset.st); });

  // 열차 위치: 계통마다 하루 운행을 24시간에 고르게 나누고, 역별 도착 시각을 따라 움직인다
  const groups = [...el.querySelectorAll('.ld-trains')];
  let clock = 7 * 60, playing = true;
  const kmAtTime = (r, t) => {
    // r.times[i]: 출발역에서 i역까지 걸리는 분 (정차역은 1분 머문다)
    for (let i = r.first + 1; i <= r.last; i++) {
      if (t <= r.times[i]) {
        const a = r.times[i - 1] + (r.stops.has(i - 1) && i - 1 !== r.first ? 1 : 0);
        if (t <= a) return d.stations[i - 1].km;
        const f = (t - a) / Math.max(0.01, r.times[i] - a);
        return d.stations[i - 1].km + f * (d.stations[i].km - d.stations[i - 1].km);
      }
    }
    return d.stations[r.last].km;
  };
  const draw = () => {
    const hh = String(Math.floor(clock / 60)).padStart(2, '0'), mm = String(Math.floor(clock % 60)).padStart(2, '0');
    el.querySelector('#ld-clock').textContent = `${hh}:${mm}`;
    d.rows.forEach((r, k) => {
      const y = top + 40 + k * rowH;
      const col = KIND_COLOR[r.kind] || KIND_COLOR.base;
      const run = r.times[r.last] - r.times[r.first];
      if (!r.trains) return;
      const perDir = Math.max(1, Math.round(r.trains / 2));
      const headway = DAY / perDir;
      // 출발 뒤 지난 분 (전날 늦게 떠난 열차도 자정을 넘겨 이어서 달린다)
      const since = (dep) => ((clock - dep) % DAY + DAY) % DAY;
      let html = '';
      for (let n = 0; n < perDir; n++) {
        const e = since(n * headway);
        if (e > run) continue;
        // 하행: 첫 역 → 끝 역 (선 위쪽), 상행: 반대 (선 아래쪽, 반 간격 어긋나게)
        const xd = xAtKm(kmAtTime(r, r.times[r.first] + e));
        html += `<path d="M${xd - 5},${y - 12} L${xd + 5},${y - 8} L${xd - 5},${y - 4} Z" fill="${col}"/>`;
      }
      for (let n = 0; n < perDir; n++) {
        const e = since((n + 0.5) * headway);
        if (e > run) continue;
        const km = d.stations[r.last].km - (kmAtTime(r, r.times[r.first] + e) - d.stations[r.first].km);
        const xu = xAtKm(km);
        html += `<path d="M${xu + 5},${y + 4} L${xu - 5},${y + 8} L${xu + 5},${y + 12} Z" fill="${col}"/>`;
      }
      groups[k].innerHTML = html;
    });
  };
  draw();
  timer = setInterval(() => {
    if (!playing) return;
    clock += +el.querySelector('#ld-speed').value;
    if (clock >= DAY) clock -= DAY;
    draw();
  }, 100);
  el.querySelector('#ld-play').onclick = (ev) => { playing = !playing; ev.target.textContent = playing ? '⏸' : '▶'; };
}

export function stopLineDiagram() {
  if (timer) clearInterval(timer);
  timer = null;
}

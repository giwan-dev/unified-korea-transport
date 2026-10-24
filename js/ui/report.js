// 결산: 시작한 해와 지금을 견준 성적표와, 지도 위에 성적을 얹은 공유용 이미지.
// 10년째(2036년)가 되면 저절로 한 번 뜨고, 현황 탭·메뉴 찾기에서 언제든 연다.

const URL_TEXT = 'radix24.github.io/unified-korea-transport';

/**
 * 성적 항목. h0·h1은 state.history의 첫 해와 지금 해 기록
 * @returns {{rows:{label:string, from:string, to:string, good:boolean|null}[], score:number, grade:string, built:object}}
 */
/** 결산의 상징 구간 (도심 좌표) */
export const TIME_PAIRS = [
  ['서울–평양', [126.978, 37.566], [125.754, 39.032]],
  ['서울–원산', [126.978, 37.566], [127.443, 39.153]],
  ['서울–부산', [126.978, 37.566], [129.040, 35.115]],
  ['부산–신의주', [129.040, 35.115], [124.400, 40.100]],
  ['광주–청진', [126.852, 35.160], [129.780, 41.790]],
];
const MODE_KO = { rail: '고속철', conv: '철도', car: '승용차', transit: '버스·도시철도', air: '항공' };
export function fmtMinutes(m) { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? `${h}시간 ${mm}분` : `${mm}분`; }

/** 이번 판의 목표 (통일 10년째에 판정). ctx: {h0, h1, state, times1} */
export const GOALS = {
  none: { label: '목표 없이 자유롭게' },
  sp90: { label: '서울–평양 90분 (철도·도로로)', check: (c) => { const t = c.times1?.[0]?.ground?.min; return t == null ? null : { now: fmtMinutes(t), target: '1시간 30분', done: t <= 90 }; } },
  gap10: { label: '남북 소득 격차 10배 이하, 빚 없이', check: (c) => { const g = c.h1.krInc / Math.max(1, c.h1.kpInc); return { now: `${g.toFixed(1)}배 · 부채 ${Math.round(c.state.debt).toLocaleString()}억`, target: '10배 이하 · 부채 0', done: g <= 10 && c.state.debt <= 0 }; } },
  jam50: { label: '정체 도로 절반으로', check: (c) => ({ now: `${Math.round(c.h1.congestedKm).toLocaleString()}km`, target: `${Math.round(c.h0.congestedKm / 2).toLocaleString()}km 이하`, done: c.h1.congestedKm <= c.h0.congestedKm / 2 }) },
  transit50: { label: '철도·대중교통 분담 50%', check: (c) => { const v = c.h1.rail + c.h1.transit; return { now: `${(v * 100).toFixed(1)}%`, target: '50% 이상', done: v >= 0.5 }; } },
  kphappy: { label: '북측 주민 행복도 70', check: (c) => ({ now: c.h1.happyKP.toFixed(1), target: '70 이상', done: c.h1.happyKP >= 70 }) },
};

export function buildReport({ h0, h1, state, built, times0 = null, times1 = null }) {
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const won = (v) => (v >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${Math.round(v).toLocaleString()}억`);
  const gap = (h) => h.krInc / Math.max(1, h.kpInc);
  const share = (h) => h.rail + h.transit;
  const rows = [
    { label: '철도·대중교통 분담', from: pct(share(h0)), to: pct(share(h1)), good: share(h1) > share(h0) + 0.002 ? true : share(h1) < share(h0) - 0.002 ? false : null },
    { label: '정체 도로', from: `${Math.round(h0.congestedKm).toLocaleString()}km`, to: `${Math.round(h1.congestedKm).toLocaleString()}km`, good: h1.congestedKm < h0.congestedKm },
    { label: '남북 소득 격차', from: `${gap(h0).toFixed(1)}배`, to: `${gap(h1).toFixed(1)}배`, good: gap(h1) < gap(h0) },
    { label: '북측 주민 행복도', from: h0.happyKP.toFixed(1), to: h1.happyKP.toFixed(1), good: h1.happyKP > h0.happyKP },
    { label: '남측 주민 행복도', from: h0.happyKR.toFixed(1), to: h1.happyKR.toFixed(1), good: h1.happyKR >= h0.happyKR },
    { label: '남북 통합도', from: `${Math.round((h0.integration ?? 0.15) * 100)}%`, to: `${Math.round(state.integration * 100)}%`, good: true },
    { label: '지지율', from: `${Math.round(h0.approval)}%`, to: `${Math.round(state.approval)}%`, good: state.approval >= h0.approval },
    { label: '부채', from: won(h0.debt || 0), to: won(state.debt), good: state.debt <= (h0.debt || 0) ? null : false },
  ];
  // 점수(100점): 혼잡 줄이기 25 · 대중교통 분담 15 · 소득 격차 20 · 북측 행복도 15 · 통합도 10 · 지지율 10 · 부채 5
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const score = Math.round(
    25 * clamp(0.5 + (h0.congestedKm - h1.congestedKm) / Math.max(1, h0.congestedKm))
    + 15 * clamp(0.5 + (share(h1) - share(h0)) * 10)
    + 20 * clamp((gap(h0) - gap(h1)) / Math.max(1, gap(h0) - 1) * 2)
    + 15 * clamp((h1.happyKP - h0.happyKP) / 15)
    + 10 * clamp(state.integration)
    + 10 * clamp(state.approval / 70)
    + 5 * clamp(1 - state.debt / 300000));
  const grade = score >= 85 ? '국토 대개조의 설계자' : score >= 70 ? '믿음직한 교통 장관' : score >= 55 ? '무난한 교통 행정'
    : score >= 40 ? '아직 갈 길이 먼 교통망' : '막힌 길 위의 통일';
  // 상징 구간 소요 시간 (시작한 해 → 지금, 가장 빠른 수단)
  const times = (times0 && times1) ? TIME_PAIRS.map(([name], k) => times0[k] && times1[k] && {
    name, from: fmtMinutes(times0[k].min), to: fmtMinutes(times1[k].min), mode: MODE_KO[times1[k].k] || '', good: times1[k].min < times0[k].min - 1 ? true : times1[k].min > times0[k].min + 1 ? false : null,
  }).filter(Boolean) : [];
  const G = GOALS[state.goal];
  const goal = G?.check ? { label: G.label, ...(G.check({ h0, h1, state, times1 }) || { now: '-', target: '-', done: false }) } : null;
  return { rows, score, grade, built, times, goal };
}

/** 성적표 HTML (알림창 안) */
export function reportHTML(r, years) {
  const cell = (row) => `<tr><td>${row.label}</td><td class="num">${row.from}</td><td class="num">→</td>
    <td class="num ${row.good === true ? 'good' : row.good === false ? 'bad' : ''}">${row.to}</td></tr>`;
  const b = r.built;
  return `<div class="report">
    <div class="report-score"><b>${r.score}</b><span>점 · ${r.grade}</span></div>
    ${r.goal ? `<p class="report-goal ${r.goal.done ? 'good' : ''}">목표 · ${r.goal.label}: <b>${r.goal.done ? '달성' : '아직'}</b> (지금 ${r.goal.now} · 목표 ${r.goal.target})</p>` : ''}
    <p class="hint">${years[0]}년 → ${years[1]}년, ${years[1] - years[0]}년 동안의 변화입니다.</p>
    <table class="report-t">${r.rows.map(cell).join('')}</table>
    ${r.times.length ? `<h4 style="margin:10px 0 2px">주요 구간 소요 시간 (가장 빠른 수단)</h4>
      <table class="report-t">${r.times.map((t) => `<tr><td>${t.name} <span class="m">${t.mode}</span></td><td class="num">${t.from}</td><td class="num">→</td>
        <td class="num ${t.good === true ? 'good' : t.good === false ? 'bad' : ''}">${t.to}</td></tr>`).join('')}</table>` : ''}
    <p class="report-built">놓은 노선: 고속철도 ${b.hsr}km · 일반·광역철도 ${b.rail}km · 도시철도 ${b.metro}km · 고속도로·국도 ${b.road}km<br>
      직접 벌여 완공한 사업 ${b.done}건 (개량 ${b.upgrades}건)</p>
  </div>`;
}

/**
 * 지금 지도 화면 위에 성적을 얹은 PNG를 내려받는다 (SNS 공유용, 1600×1000)
 * @param {maplibregl.Map} map
 */
export function downloadReportImage(map, r, years, fileName) {
  return new Promise((resolve) => {
    map.once('render', () => {
      const shot = new Image();
      shot.onload = () => {
        const W = 1600, H = 1000, cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const g = cv.getContext('2d');
        // 지도: 가득 채우게 잘라 그린다
        const s = Math.max(W / shot.width, H / shot.height);
        g.drawImage(shot, (W - shot.width * s) / 2, (H - shot.height * s) / 2, shot.width * s, shot.height * s);
        // 왼쪽 성적 카드
        const x = 40, y = 40, w = 560, h = H - 80;
        g.fillStyle = 'rgba(255,255,255,0.93)';
        roundRect(g, x, y, w, h, 18); g.fill();
        g.fillStyle = '#1d232b';
        g.font = '800 34px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText('통일 한반도 교통망', x + 32, y + 62);
        g.font = '600 20px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillStyle = '#5b6470';
        g.fillText(`${years[0]}년 → ${years[1]}년 결산`, x + 32, y + 98);
        g.fillStyle = '#1f5fbf';
        g.font = '800 88px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText(String(r.score), x + 32, y + 200);
        const sw = g.measureText(String(r.score)).width;
        g.font = '700 26px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText('점', x + 40 + sw, y + 200);
        g.fillStyle = '#1d232b';
        g.font = '700 26px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText(r.goal ? `${r.grade} · 목표 ${r.goal.done ? '달성' : '미달'}` : r.grade, x + 32, y + 246);
        let yy = y + 296;
        const line = (label, text, good, step) => {
          g.fillStyle = '#5b6470'; g.fillText(label, x + 32, yy);
          g.textAlign = 'right';
          g.fillStyle = good === true ? '#1b8a4b' : good === false ? '#c0392b' : '#1d232b';
          g.fillText(text, x + w - 32, yy);
          g.textAlign = 'left';
          yy += step;
        };
        g.font = '500 20px "Pretendard", "Malgun Gothic", sans-serif';
        for (const row of r.rows) line(row.label, `${row.from} → ${row.to}`, row.good, 34);
        if (r.times.length) {
          yy += 10;
          g.fillStyle = '#1d232b'; g.font = '700 20px "Pretendard", "Malgun Gothic", sans-serif';
          g.fillText('주요 구간 소요 시간', x + 32, yy); yy += 32;
          g.font = '500 20px "Pretendard", "Malgun Gothic", sans-serif';
          for (const t of r.times) line(t.name, `${t.from} → ${t.to}`, t.good, 32);
        }
        const b = r.built;
        g.fillStyle = '#1d232b';
        g.font = '600 20px "Pretendard", "Malgun Gothic", sans-serif';
        g.font = '600 18px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText(`고속철도 ${b.hsr}km · 철도 ${b.rail}km · 도시철도 ${b.metro}km · 도로 ${b.road}km`, x + 32, yy + 14);
        g.fillStyle = '#5b6470';
        g.font = '500 18px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText(URL_TEXT, x + 32, y + h - 28);
        cv.toBlob((blob) => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          resolve(true);
        }, 'image/png');
      };
      shot.src = map.getCanvas().toDataURL('image/png');
    });
    map.triggerRepaint();
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// 결산: 시작한 해와 지금을 견준 성적표와, 지도 위에 성적을 얹은 공유용 이미지.
// 10년째(2036년)가 되면 저절로 한 번 뜨고, 현황 탭·메뉴 찾기에서 언제든 연다.

import { t } from '../i18n.js';

const URL_TEXT = 'radix24.github.io/unified-korea-transport';

/**
 * 성적 항목. h0·h1은 state.history의 첫 해와 지금 해 기록
 * @returns {{rows:{label:string, from:string, to:string, good:boolean|null}[], score:number, grade:string, built:object}}
 */
/** 결산의 상징 구간 (도심 좌표) */
export const TIME_PAIRS = [
  [t('서울–평양', 'Seoul–Pyongyang'), [126.978, 37.566], [125.754, 39.032]],
  [t('서울–원산', 'Seoul–Wonsan'), [126.978, 37.566], [127.443, 39.153]],
  [t('서울–부산', 'Seoul–Busan'), [126.978, 37.566], [129.040, 35.115]],
  [t('부산–신의주', 'Busan–Sinuiju'), [129.040, 35.115], [124.400, 40.100]],
  [t('광주–청진', 'Gwangju–Chongjin'), [126.852, 35.160], [129.780, 41.790]],
];
const MODE_KO = t({ rail: '고속철', conv: '철도', car: '승용차', transit: '버스·도시철도', air: '항공' }, { rail: 'HSR', conv: 'rail', car: 'car', transit: 'bus/metro', air: 'air' });
export function fmtMinutes(m) { const h = Math.floor(m / 60), mm = Math.round(m % 60); return t(h ? `${h}시간 ${mm}분` : `${mm}분`, h ? `${h} h ${mm} min` : `${mm} min`); }

/** 이번 판의 목표 (통일 10년째에 판정). ctx: {h0, h1, state, times1} */
export const GOALS = {
  none: { label: t('목표 없이 자유롭게', 'No goal (sandbox)') },
  sp90: { label: t('서울–평양 90분 (철도·도로로)', 'Seoul–Pyongyang in 90 min (by rail or road)'), check: (c) => { const m = c.times1?.[0]?.ground?.min; return m == null ? null : { now: fmtMinutes(m), target: t('1시간 30분', '1 h 30 min'), done: m <= 90 }; } },
  gap10: { label: t('남북 소득 격차 10배 이하, 빚 없이', 'Income gap under 10× with no debt'), check: (c) => { const g = c.h1.krInc / Math.max(1, c.h1.kpInc); return { now: t(`${g.toFixed(1)}배 · 부채 ${Math.round(c.state.debt).toLocaleString()}억`, `${g.toFixed(1)}× · debt ₩${Math.round(c.state.debt / 10).toLocaleString('en')}B`), target: t('10배 이하 · 부채 0', '≤10× · no debt'), done: g <= 10 && c.state.debt <= 0 }; } },
  jam50: { label: t('정체 도로 절반으로', 'Halve congested roads'), check: (c) => ({ now: `${Math.round(c.h1.congestedKm).toLocaleString()}km`, target: t(`${Math.round(c.h0.congestedKm / 2).toLocaleString()}km 이하`, `≤ ${Math.round(c.h0.congestedKm / 2).toLocaleString('en')} km`), done: c.h1.congestedKm <= c.h0.congestedKm / 2 }) },
  transit50: { label: t('철도·대중교통 분담 50%', '50% rail & transit share'), check: (c) => { const v = c.h1.rail + c.h1.transit; return { now: `${(v * 100).toFixed(1)}%`, target: t('50% 이상', '≥ 50%'), done: v >= 0.5 }; } },
  kphappy: { label: t('북측 주민 행복도 70', 'Northern happiness 70'), check: (c) => ({ now: c.h1.happyKP.toFixed(1), target: t('70 이상', '≥ 70'), done: c.h1.happyKP >= 70 }) },
};

export function buildReport({ h0, h1, state, built, times0 = null, times1 = null }) {
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const won = (v) => t(v >= 10000 ? `${(v / 10000).toFixed(1)}조` : `${Math.round(v).toLocaleString()}억`, v >= 10000 ? `₩${(v / 10000).toFixed(1)}T` : `₩${(v / 10).toFixed(0)}B`);
  const gap = (h) => h.krInc / Math.max(1, h.kpInc);
  const share = (h) => h.rail + h.transit;
  // 좋아졌으면 true, 나빠졌으면 false, 그대로면 null
  const better = (now, before, higher = true, eps = 1e-9) => (Math.abs(now - before) <= eps ? null : (now > before) === higher);
  const rows = [
    { label: t('철도·대중교통 분담', 'Rail & transit share'), from: pct(share(h0)), to: pct(share(h1)), good: better(share(h1), share(h0), true, 0.002) },
    { label: t('정체 도로', 'Congested roads'), from: `${Math.round(h0.congestedKm).toLocaleString()}km`, to: `${Math.round(h1.congestedKm).toLocaleString()}km`, good: better(h1.congestedKm, h0.congestedKm, false, 0.5) },
    { label: t('남북 소득 격차', 'Income gap'), from: `${gap(h0).toFixed(1)}×`, to: `${gap(h1).toFixed(1)}×`, good: better(gap(h1), gap(h0), false, 0.05) },
    { label: t('북측 주민 행복도', 'Northern happiness'), from: h0.happyKP.toFixed(1), to: h1.happyKP.toFixed(1), good: better(h1.happyKP, h0.happyKP, true, 0.05) },
    { label: t('남측 주민 행복도', 'Southern happiness'), from: h0.happyKR.toFixed(1), to: h1.happyKR.toFixed(1), good: better(h1.happyKR, h0.happyKR, true, 0.05) },
    { label: t('남북 통합도', 'Integration'), from: `${Math.round((h0.integration ?? 0.15) * 100)}%`, to: `${Math.round(state.integration * 100)}%`, good: better(state.integration, h0.integration ?? 0.15, true, 0.005) },
    { label: t('지지율', 'Approval'), from: `${Math.round(h0.approval)}%`, to: `${Math.round(state.approval)}%`, good: better(state.approval, h0.approval, true, 0.5) },
    { label: t('부채', 'Debt'), from: won(h0.debt || 0), to: won(state.debt), good: better(state.debt, h0.debt || 0, false, 1) },
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
  const grade = score >= 85 ? t('국토 대개조의 설계자', 'Architect of a new Korea') : score >= 70 ? t('믿음직한 교통 장관', 'A trusted transport minister') : score >= 55 ? t('무난한 교통 행정', 'Steady administration')
    : score >= 40 ? t('아직 갈 길이 먼 교통망', 'A long way to go') : t('막힌 길 위의 통일', 'Reunified, but gridlocked');
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
    <div class="report-score"><b>${r.score}</b><span>${t('점', 'pts')} · ${r.grade}</span></div>
    ${r.goal ? `<p class="report-goal ${r.goal.done ? 'good' : ''}">${t('목표', 'Goal')} · ${r.goal.label}: <b>${r.goal.done ? t('달성', 'achieved') : t('아직', 'not yet')}</b> (${t('지금', 'now')} ${r.goal.now} · ${t('목표', 'target')} ${r.goal.target})</p>` : ''}
    <p class="hint">${t(`${years[0]}년 → ${years[1]}년, ${years[1] - years[0]}년 동안의 변화입니다.`, `Changes over ${years[1] - years[0]} years, ${years[0]} → ${years[1]}.`)}</p>
    <table class="report-t">${r.rows.map(cell).join('')}</table>
    ${r.times.length ? `<h4 style="margin:10px 0 2px">${t('주요 구간 소요 시간 (가장 빠른 수단)', 'Key journey times (fastest mode)')}</h4>
      <table class="report-t">${r.times.map((t) => `<tr><td>${t.name} <span class="m">${t.mode}</span></td><td class="num">${t.from}</td><td class="num">→</td>
        <td class="num ${t.good === true ? 'good' : t.good === false ? 'bad' : ''}">${t.to}</td></tr>`).join('')}</table>` : ''}
    <p class="report-built">${t(`놓은 노선: 고속철도 ${b.hsr}km · 일반·광역철도 ${b.rail}km · 도시철도 ${b.metro}km · 고속도로·국도 ${b.road}km<br>
      직접 벌여 완공한 사업 ${b.done}건 (개량 ${b.upgrades}건)`, `Built: HSR ${b.hsr} km · rail ${b.rail} km · metro ${b.metro} km · roads ${b.road} km<br>
      Projects you completed: ${b.done} (${b.upgrades} upgrades)`)}</p>
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
        g.fillText(t('통일 한반도 교통망', 'Unified Korea Transport'), x + 32, y + 62);
        g.font = '600 20px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillStyle = '#5b6470';
        g.fillText(t(`${years[0]}년 → ${years[1]}년 결산`, `Summary ${years[0]} → ${years[1]}`), x + 32, y + 98);
        g.fillStyle = '#1f5fbf';
        g.font = '800 88px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText(String(r.score), x + 32, y + 200);
        const sw = g.measureText(String(r.score)).width;
        g.font = '700 26px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText(t('점', 'pts'), x + 40 + sw, y + 200);
        g.fillStyle = '#1d232b';
        g.font = '700 26px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText(r.goal ? `${r.grade} · ${t('목표', 'goal')} ${r.goal.done ? t('달성', 'achieved') : t('미달', 'missed')}` : r.grade, x + 32, y + 246);
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
          g.fillText(t('주요 구간 소요 시간', 'Key journey times'), x + 32, yy); yy += 32;
          g.font = '500 20px "Pretendard", "Malgun Gothic", sans-serif';
          for (const t of r.times) line(t.name, `${t.from} → ${t.to}`, t.good, 32);
        }
        const b = r.built;
        g.fillStyle = '#1d232b';
        g.font = '600 20px "Pretendard", "Malgun Gothic", sans-serif';
        g.font = '600 18px "Pretendard", "Malgun Gothic", sans-serif';
        g.fillText(t(`고속철도 ${b.hsr}km · 철도 ${b.rail}km · 도시철도 ${b.metro}km · 도로 ${b.road}km`, `HSR ${b.hsr} km · rail ${b.rail} km · metro ${b.metro} km · roads ${b.road} km`), x + 32, yy + 14);
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

// 여러 화면 모듈이 함께 쓰는 게임 상태(state·result·지도·망 등)와 작은 도구.
// 다른 모듈은 이 값들을 import해 읽고(살아 있는 바인딩), 바꿀 때는 setX(v)를 부른다.
import { registerSentimentMetrics } from '../game/sentiment.js';
import { save } from '../game/state.js';
import { LANG, setLang, startI18n, t } from '../i18n.js';
import { metricForLevel, METRICS } from '../ui/map.js';
import { drawEmdLines, nodeCoord, nodeNames, paintZones, refreshPoints } from './mapdata.js';
import { renderLegend } from './panels.js';
import { renderSelection } from './econ.js';

startI18n();
{ const ll = document.querySelector('#ld-lang'); if (ll) { ll.textContent = LANG === 'en' ? '한국어' : 'English'; ll.addEventListener('click', (e) => { e.preventDefault(); setLang(LANG === 'en' ? 'ko' : 'en'); }); } }

export const APP_VERSION = 'Alpha 0.5.1';
export const BUG_MAIL = 'evrgrn0528@gmail.com';
// 오류 제보에 함께 보낼 최근 오류 (화면에 안 보이는 것도)
export const errLog = [];
addEventListener('error', (e) => errLog.push(`${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => errLog.push(String(e.reason?.message || e.reason)));

export const $ = (s) => document.querySelector(s);
registerSentimentMetrics(METRICS);   // 득표율·지자체장 지지율·읍면동 행복도·지지율 지도
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-maplevel]');
  if (!b) return;
  mapLevel = b.dataset.maplevel;
  metric = metricForLevel(metric, mapLevel);
  paintZones(); renderLegend(); drawEmdLines();
});
export const CLASS_LABEL = { motorway: '고속도로', trunk: '간선국도', primary: '주요 도로', secondary: '지방 도로', hsr: '고속철도', conv: '일반철도', metro: '도시철도' };
export const POLICY_LABEL = { free: '자유 이주', limited: '이주 제한 (허가제)', closed: '이주 통제' };

export let map, base, zonesFC, zoneProps, places, grid, subsFC, subPop0, namer, worker;
export function setMap(v) { return (map = v); }
export function setBase(v) { return (base = v); }
export function setZonesFC(v) { return (zonesFC = v); }
export function setZoneProps(v) { return (zoneProps = v); }
export function setPlaces(v) { return (places = v); }
export function setGrid(v) { return (grid = v); }
export function setSubsFC(v) { return (subsFC = v); }
export function setSubPop0(v) { return (subPop0 = v); }
export function setNamer(v) { return (namer = v); }
export function setWorker(v) { return (worker = v); }
export let gridSent = null;   // 시뮬레이션에 마지막으로 넘긴 격자
export function setGridSent(v) { return (gridSent = v); }
export let state, result = null, prevSummary = null, requests = [];
export function setState(v) { return (state = v); }
export function setResult(v) { return (result = v); }
export function setPrevSummary(v) { return (prevSummary = v); }
export function setRequests(v) { return (requests = v); }
export let metric = 'pop';
export function setMetric(v) { return (metric = v); }
export var mapLevel = 'sgg';   // 지도 층위 (광역 sido · 기초 sgg · 읍면동 emd · 리 ri): 지표가 어느 층위에나 쓰이는 것이면 이것을 따른다
export function setMapLevel(v) { return (mapLevel = v); }
export let selection = null;      // {type:'link'|'zone'|'node', id}
export function setSelection(v) { return (selection = v); }
export let draft = null;          // 그리기 중인 신설 사업
export function setDraft(v) { return (draft = v); }
export let busy = false;
export function setBusyValue(v) { return (busy = v); }
export let historic = [];         // 옛 이름 되찾기 대상 (data/historic_targets.json)
export function setHistoric(v) { return (historic = v); }
export let happiness = null;      // 존별 주민 행복도 (0~100)
export function setHappiness(v) { return (happiness = v); }
export let lastIncome = null;
export function setLastIncome(v) { return (lastIncome = v); }
export let dataStamp = null;
export function setDataStamp(v) { return (dataStamp = v); }
export let isForeign = () => false;   // 외국 땅 판정 (주변국 육지 자료를 받으면 바뀐다)
export function setIsForeign(v) { return (isForeign = v); }
export let multi = null;               // 드래그로 고른 구간들
export let measure = null;             // 소요 시간 측정: {from, to}
export function setMeasure(v) { return (measure = v); }
export const snap = { node: true, line: true };   // 그리기: 노드에 붙이기 / 선 위에 붙이기(중간 IC·역)
export const MID_COST = { road: 300, rail: 200 };  // 중간 IC·역 설치비 (억원)
export const REST = { spacingKm: 40, cost: 150 };  // 고속도로 휴게소: 약 40km마다, 한 곳 설치비 (억원)
export let wholeRoute = false;
export function setWholeRoute(v) { return (wholeRoute = v); }
export let lastDone = [];           // 지난번 해 넘김에 완공된 사업 (지자체 실적 계산용)    // 개량을 같은 이름 노선 전체에 적용
export function setLastDone(v) { return (lastDone = v); }


/** 로딩 단계별 시각 (ms, 페이지 시작부터). 콘솔에서 ukt.perf로 본다 */
export const perf = [];
export const mark = (name) => perf.push([name, Math.round(performance.now())]);
globalThis.__perf = perf;

/** 여러 파일을 받으며 전체 진행률을 알린다 */
export class Progress {
  constructor(onChange) { this.onChange = onChange; this.files = new Map(); }

  update() {
    let got = 0, total = 0;
    for (const f of this.files.values()) { got += f.got; total += f.total; }
    this.onChange(total ? got / total : 0);
  }

  async fetch(url, as) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    // 압축 전송이면 Content-Length가 실제 길이보다 작을 수 있어 받은 만큼 늘려 잡는다
    const rec = { got: 0, total: +r.headers.get('Content-Length') || 0 };
    this.files.set(url, rec);
    const reader = r.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      rec.got += value.length;
      if (rec.got > rec.total) rec.total = rec.got;
      this.update();
    }
    rec.total = rec.got;
    this.update();
    const buf = new Uint8Array(rec.got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    return as === 'json' ? JSON.parse(new TextDecoder().decode(buf)) : buf.buffer;
  }
}

/** 처음 불러오는 동안 보이는 화면. 단계: data → sim → map (sim과 map은 함께 진행) */
export const loading = {
  item(id) { return document.querySelector(`#loading [data-stage=${id}]`); },
  stage(id) { this.item(id)?.classList.add('now'); },
  progress(id, v) {
    this.stage(id);
    const bar = this.item(id)?.querySelector('.p');
    if (bar) bar.style.width = `${Math.round(v * 100)}%`;
  },
  label(id, text) {
    const t = this.item(id)?.querySelector('.s');
    if (t) t.textContent = text;
  },
  done(id) {
    const li = this.item(id);
    if (!li) return;
    li.classList.remove('now');
    li.classList.add('ok');
    const all = [...document.querySelectorAll('#loading [data-stage]')];
    if (all.every((x) => x.classList.contains('ok'))) {
      const el = document.querySelector('#loading');
      el.classList.add('gone');
      setTimeout(() => el.remove(), 400);
    }
  },
};

export function autoRenameNode(id) {
  const cur = nodeNames().get(id);
  const c = nodeCoord(id);
  namer.release(cur.name, cur.kind);
  const name = namer.suggest(c[0], c[1], cur.kind);
  state.names[id] = { name, kind: cur.kind, auto: true };
  save(state); refreshPoints(); renderSelection();
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] || 1;
}

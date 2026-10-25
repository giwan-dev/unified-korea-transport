// 수요 추정(중력모형 + 로짓 수단선택 + MSA 통행배정)과 인구·경제·HDI 갱신.
import { Graph } from './graph.js';
import { P } from './params.js';

const KM_PER_DEG = 111.32;

const DENS_DX = 0.0113, DENS_DY = 0.009;   // 약 1km
function densCell(x, y) { return [Math.floor(x / DENS_DX), Math.floor(y / DENS_DY)]; }
function densKey(x, y) { const [i, j] = densCell(x, y); return `${i}:${j}`; }

export class Model {
  /**
   * @param {object[]} zones data/zones.json의 존 속성 배열 (subs: 소구역 [경도, 위도, 인구비중, 면적])
   * @param {Float32Array} grid 인구 격자 [경도, 위도, 인구, 소구역] 반복
   */
  constructor(zones, grid) {
    const Z = this.Z = zones.length;
    this.zones = zones;
    this.isKP = Uint8Array.from(zones, (z) => (z.country === 'KP' ? 1 : 0));
    // 국외 거점(중국·러시아·일본): 인구·소득은 고정, 인구 이동·HDI 계산에서 뺀다
    this.isExt = Uint8Array.from(zones, (z) => (z.ext ? 1 : 0));
    // 국외 거점의 한민족 인구 (조선족·고려인·재일동포): 말과 생활권이 같아 국외 도시 축소(extMassFactor)를 덜 받는다
    this.korean = Float64Array.from(zones, (z) => (z.ext ? Math.min(z.korean || 0, z.pop) : 0));
    this.extCountry = zones.map((z) => (z.ext ? z.country : ''));
    this.extIncome = Float64Array.from(zones, (z) => z.income || 0);
    // 관광 목적지: 하루 방문객(명). 북측 관광지는 통합도만큼 열린다
    this.tour = Float64Array.from(zones, (z) => z.tour || 0);
    this.tourKP = Float64Array.from(zones, (z) => z.tourKP || 0);
    this.cx = Float64Array.from(zones, (z) => z.cx);
    this.cy = Float64Array.from(zones, (z) => z.cy);
    this.area = Float64Array.from(zones, (z) => Math.max(z.area, 1));
    this.pop = Float64Array.from(zones, (z) => z.pop);
    this.initSubzones(zones, grid);
    // 관광지가 있는 읍면동 (하루 방문객): 관광 통행은 시군구 전체가 아니라 관광지 읍면동으로 간다
    this.tourSub = new Float64Array(this.S); this.tourSubKP = new Float64Array(this.S);
    zones.forEach((z, i) => {
      for (const [k, v] of z.tourSubs || []) this.tourSub[this.zoneSub0[i] + k] += v;
      for (const [k, v] of z.tourSubsKP || []) this.tourSubKP[this.zoneSub0[i] + k] += v;
    });
    this.income = new Float64Array(Z);
    this.le = new Float64Array(Z);
    this.mys = new Float64Array(Z);
    this.eys = new Float64Array(Z);
    this.hdi = new Float64Array(Z);
    this.amenity = new Float64Array(Z);
    this.access = new Float64Array(Z);
    this.healthAccess = new Float64Array(Z);
    this.ccomp = new Float32Array(Z * Z);
    this.K = 0;
    this.railASC = P.railASC;
    this.hsrASC = P.hsrASC;
    this.transitASC = P.transitASC;
    this.accessRef = 1;
    this.frontier = P.incomeKR;
    this.lastMigration = { kpToKr: 0, krToKp: 0 };
  }

  /** 저장된 존 상태 복원 */
  restore(s) {
    for (const k of ['pop', 'income', 'le', 'mys', 'eys', 'hdi', 'amenity']) this[k].set(s[k]);
    if (s.subW && s.subW.length === this.S) {
      this.subW.set(s.subW); this.subAmenity.set(s.subAmenity); this.subAmenityReady = true;
    }
    this.K = s.K; this.accessRef = s.accessRef; this.frontier = s.frontier;
    this.railASC = s.railASC ?? P.railASC;
    this.hsrASC = s.hsrASC ?? P.hsrASC;
    // 열린 북측 관광지 (해마다 바뀐다: 보조 워커도 같은 값을 쓰게 상태에 싣는다)
    if (s.tourKP && s.tourKP.length === this.tourKP.length) this.tourKP.set(s.tourKP);
    this.transitASC = s.transitASC ?? P.transitASC;
    for (const [nd, w] of s.waits || []) {
      const k = this.stationOf?.get(nd);
      if (k != null) this.stationWait[k] = w;
    }
  }

  /**
   * 기준 연도 결과를 내보낸다. 처음 시작할 때 보정·배정을 다시 하지 않도록 data/baseline.*으로 저장한다.
   * @returns {{json: object, bin: ArrayBuffer}}
   */
  exportBaseline(totals, meta) {
    const L = this.volume.length, ZZ = this.ccomp.length, NS = this.boardings.length, AA = this.airOD.length;
    const bin = new Float32Array(L + ZZ + NS + AA);
    bin.set(this.volume, 0);
    bin.set(this.ccomp, L);
    bin.set(this.boardings, L + ZZ);
    bin.set(this.airOD, L + ZZ + NS);
    // 역세권 계산 결과도 함께 둔다: 게임을 열 때마다 하던 6초 남짓한 계산을 건너뛴다 (망 서명이 같을 때만 쓴다)
    const parts = ACCESS_ARRAYS.map(([k]) => this[k]);
    const extra = new Float32Array(parts.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of parts) { extra.set(a, o); o += a.length; }
    const all = new Float32Array(bin.length + extra.length);
    all.set(bin); all.set(extra, bin.length);
    const access = { sig: this.accessSig, S: this.S, R: P.roadConnectors, M: P.metroCandidates, K: P.stationCandidates, stations: Array.from(this.stationNode) };
    return { json: { meta, sizes: { L, ZZ, NS, AA }, totals, snapshot: this.snapshot(), access }, bin: all.buffer };
  }

  /** exportBaseline에 담긴 역세권 계산 결과를 다음 setNetwork 때 쓰도록 받아 둔다 (buildAccess가 서명을 맞춰 본다) */
  preloadAccess(json, buf) {
    const a = json.access;
    if (!a || a.S !== this.S || a.R !== P.roadConnectors || a.M !== P.metroCandidates || a.K !== P.stationCandidates) return;
    const { L, ZZ, NS, AA = 0 } = json.sizes;
    const bin = new Float32Array(buf);
    let o = L + ZZ + NS + AA;
    const arrays = {};
    for (const [k, T, per] of ACCESS_ARRAYS) {
      const n = per === 1 ? a.S : a.S * a[per];
      if (o + n > bin.length) return;
      arrays[k] = T.from(bin.subarray(o, o + n));
      o += n;
    }
    this.accessPreload = { sig: a.sig, arrays, stations: Int32Array.from(a.stations) };
  }

  /** exportBaseline 결과로 상태를 되살린다. 크기가 맞지 않으면 false */
  importBaseline(json, buf, { volumesOnly = false } = {}) {
    const { L, ZZ, NS, AA = 0 } = json.sizes;
    if (L !== this.volume.length || ZZ !== this.ccomp.length || NS !== this.boardings.length || AA !== this.airOD.length) return false;
    const bin = new Float32Array(buf);
    this.volume.set(bin.subarray(0, L));
    if (!volumesOnly) {
      this.restore(json.snapshot);
      this.ccomp.set(bin.subarray(L, L + ZZ));
      this.boardings.set(bin.subarray(L + ZZ, L + ZZ + NS));
      this.airOD.set(bin.subarray(L + ZZ + NS, L + ZZ + NS + AA));
      this.airPaxFromOD();
      this.computeAccess();
    }
    this.updateCosts();
    return true;
  }

  snapshot() {
    const o = { K: this.K, railASC: this.railASC, hsrASC: this.hsrASC, transitASC: this.transitASC, accessRef: this.accessRef, frontier: this.frontier };
    for (const k of ['pop', 'income', 'le', 'mys', 'eys', 'hdi', 'amenity']) o[k] = Array.from(this[k]);
    o.subW = Array.from(this.subW, (v) => Math.round(v * 1e6) / 1e6);
    o.subAmenity = Array.from(this.subAmenity, (v) => Math.round(v * 1e4) / 1e4);
    o.waits = Array.from(this.stationNode, (nd, i) => [nd, Math.round(this.stationWait[i] * 10) / 10]);
    o.tourKP = Array.from(this.tourKP);
    return o;
  }

  // ------------------------------------------------------------ 네트워크

  /**
   * @param {object} net {nodes:[[lon,lat]], links:[{a,b,mode,cls,len,lanes,speed,paved,tracks,power,kp,active}], stations:number[]}
   */
  setNetwork(net) {
    this.net = net;
    const L = net.links;
    const n = net.nodes.length;
    const A = Int32Array.from(L, (l) => l.a), B = Int32Array.from(L, (l) => l.b);
    this.road = new Graph(n, A, B, (i) => L[i].active && L[i].mode === 0);
    this.rail = new Graph(n, A, B, (i) => L[i].active && L[i].mode === 1);
    this.metroG = new Graph(n, A, B, (i) => L[i].active && L[i].mode === 2);   // 공항 철도 접근용 (도시철도만)
    this.freeTime = new Float64Array(L.length);
    this.capacity = new Float64Array(L.length);
    this.urbanCapCache ||= new Map();
    // 운행 계통의 가상 링크는 실제 링크 뒤에 붙어 온다 (net.physCount부터)
    this.nPhys = net.physCount ?? L.length;
    this.virtual = [];
    const stationSet = new Set(net.stations);
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (l.via) {
        // 정차역 사이: 밑 선로 주행시간에서 통과역 정차 시간을 빼고, 열차 등급만큼 빠르다
        // 열차 종류의 최고 속도가 선로 속도보다 낮으면 그만큼 느리다
        let t = 0;
        for (const v of l.via) t += this.freeTime[v] * Math.max(1, L[v].speed / (l.speedCap || 999));
        // 모든 역에 서는 계통(광역 전철 등)은 밑 선로의 기본 열차와 시간이 똑같아 배정이 기본 열차로만 가므로,
        // 시간표가 정해진 계통을 아주 조금 낫게 친다 (계통 이용객이 0으로 잡히지 않게)
        this.freeTime[i] = Math.max(1, t - l.skip * P.railDwellMin) * 0.995;
        this.capacity[i] = l.trains * (l.seatCap || P.railPaxPerTrain[l.cls]);
        this.virtual.push(i);
        continue;
      }
      if (l.mode === 0) {
        this.freeTime[i] = (l.len / l.speed) * 60;
        let cap = l.lanes * P.roadCapPerLaneHour[l.cls] * P.dailyFactor;
        if (!l.paved) cap *= P.unpavedCapFactor;
        // 도심 일반도로: 계산망에 없는 이면도로·병행 도로와 OSM에 빠진 차로 수를 밀도만큼 보탠다
        if (l.cls !== 'motorway' && l.cls !== 'ferry') {
          // 밀도는 링크 가운데 자리로만 정해진다: 해마다 3만 개를 다시 재지 않게 자리별로 기억해 둔다
          const [ax, ay] = net.nodes[l.a], [bx, by] = net.nodes[l.b];
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const key = Math.round(mx * 1e5) * 1e8 + Math.round(my * 1e5);
          let f = this.urbanCapCache.get(key);
          if (f === undefined) {
            const d = this.densityAt(mx, my);
            f = 1 + Math.min(P.urbanCapMax, Math.max(0, (d - P.urbanDensityFrom) / P.urbanDensityStep));
            this.urbanCapCache.set(key, f);
          }
          cap *= f;
        }
        this.capacity[i] = cap;
      } else if (l.mode === 2) {
        this.freeTime[i] = (l.len / l.speed) * 60 + (l.freqWait || 0);
        this.capacity[i] = P.metroTrainsPerDay * P.metroPaxPerTrain * (l.tracks >= 3 ? 1.5 : 1) * (l.freq || 1);
      } else {
        const pen = l.power === 'AC' ? 1 : P.railNonACPenalty;
        // 양 끝이 역이면 정차 시간을 반씩 얹는다 (모든 역에 서는 열차 기준)
        const dwell = P.railDwellMin * ((stationSet.has(l.a) ? 0.5 : 0) + (stationSet.has(l.b) ? 0.5 : 0));
        // 감편(freq < 1): 배차가 길어진 만큼의 기다림(freqWait)을 더하고 수송력을 줄인다
        this.freeTime[i] = (l.len / l.speed) * 60 * pen + dwell + (l.freqWait || 0);
        // 고속철도는 모두 복선이다 (OSM에서 방향별 선로를 따로 그린 구간이 단선으로 들어오는 것을 바로잡는다)
        const tracks = l.cls === 'hsr' ? Math.max(2, l.tracks) : l.tracks;
        this.capacity[i] = P.railTrainsPerDay[Math.min(tracks, 4)] * P.railPaxPerTrain[l.cls] * (l.freq || 1);
      }
    }
    // 운행 계통 열차(광역 통근 전동차 등)는 제 정원만큼 밑 선로 수송력을 늘린다.
    // 선로 기본 용량은 보통 열차 정원(450명)으로 잡혀 있어, 정원 1,600명 전동차가 다니는 구간의 혼잡을 부풀린다
    for (const v of this.virtual) {
      const lv = L[v];
      const extra = lv.trains * ((lv.seatCap || P.railPaxPerTrain[lv.cls]) - P.railPaxPerTrain[lv.cls]);
      if (extra > 0) for (const u of new Set(lv.via)) this.capacity[u] += extra;
    }
    if (!this.volume || this.volume.length !== L.length) {
      const old = this.volume;
      this.volume = new Float64Array(L.length);
      if (old) this.volume.set(old.subarray(0, Math.min(old.length, L.length)));
    }
    this.cost = new Float64Array(L.length);
    // 역세권·환승 계산(약 3초)은 노드·역 구성이 바뀐 해에만 다시 한다 (개량은 속도·용량만 바꾼다)
    let active = 0;
    for (const l of L) if (l.active) active++;
    const sig = `${L.length}:${active}:${net.nodes.length}:${net.stations.length}`;
    if (sig !== this.netSig || !this.transit) {
      this.buildAccess();
      this.buildTransit();
      this.metroLocal = this.metroLocalLoads();
      this.netSig = sig;
    } else {
      this.buildTransit();
    }
    this.airRail = null;   // 공항역 철도 시간은 망이 바뀌면 다시 구한다
    this.buildAir();
    // 역별 운행 계통 열차 수 (시간표가 정해진 역은 그만큼 자주 열차가 온다)
    this.svcTrains = new Float64Array(this.stationNode.length);
    for (const s of net.serviceStops || []) {
      for (const nd of s.stops) {
        const k = this.stationOf.get(nd);
        if (k != null) this.svcTrains[k] += s.trains;
      }
    }
  }

  /**
   * 대중교통 그래프: 도로(버스) + 도시철도 + 도시철도역과 가까운 도로 노드를 잇는 환승 링크.
   * 환승 링크는 net.links 뒤에 붙는 가상 링크다.
   */
  buildTransit() {
    const { net } = this;
    const L = net.links, n = net.nodes.length;
    // 환승 짝(도시철도역 → 가까운 도로 노드)은 도로 노드·도시철도역 구성이 그대로면 지난번 것을 쓴다
    let pairs = this.transferPairs;
    if (!pairs || pairs.road !== this.roadNodeSet || pairs.metro !== this.metroStationNodes) {
      const roadIdx = new SpatialIndex(net.nodes, this.roadNodeSet);
      pairs = { road: this.roadNodeSet, metro: this.metroStationNodes, ta: [], tb: [] };
      for (const st of this.metroStationNodes) {
        const nd = roadIdx.nearest(net.nodes[st][0], net.nodes[st][1]);
        if (nd >= 0) { pairs.ta.push(st); pairs.tb.push(nd); }
      }
      this.transferPairs = pairs;
    }
    const { ta, tb } = pairs;
    const A = new Int32Array(L.length + ta.length), B = new Int32Array(L.length + ta.length);
    L.forEach((l, i) => { A[i] = l.a; B[i] = l.b; });
    ta.forEach((a, k) => { A[L.length + k] = a; B[L.length + k] = tb[k]; });
    this.transitLinkCount = A.length;
    this.transit = new Graph(n, A, B, (i) => i >= L.length || (L[i].active && (L[i].mode === 0 || L[i].mode === 2)));
    this.costT = new Float64Array(A.length);
    for (let k = L.length; k < A.length; k++) this.costT[k] = P.transferMin;
    this.metroLinks = [];
    L.forEach((l, i) => { if (l.mode === 2 && l.active) this.metroLinks.push(i); });
  }

  // ------------------------------------------------------------ 소구역·역세권

  initSubzones(zones, grid) {
    const sx = [], sy = [], sw = [], sz = [], sa = [];
    this.zoneSub0 = new Int32Array(zones.length);
    this.zoneSubN = new Int32Array(zones.length);
    zones.forEach((z, i) => {
      const subs = z.subs || [[z.cx, z.cy, 1]];
      this.zoneSub0[i] = sx.length;
      this.zoneSubN[i] = subs.length;
      for (const [x, y, w, a] of subs) { sx.push(x); sy.push(y); sw.push(w); sz.push(i); sa.push(Math.max(a ?? 1, 0.05)); }
    });
    this.S = sx.length;
    this.subX = Float64Array.from(sx); this.subY = Float64Array.from(sy);
    this.subW = Float64Array.from(sw); this.subZone = Int32Array.from(sz);
    this.subArea = Float64Array.from(sa);
    this.subAmenity = new Float64Array(this.S);
    this.subAmenityReady = false;
    // 소구역별 격자 목록 (CSR)
    const n = grid ? grid.length / 4 : 0;
    const count = new Int32Array(this.S + 1);
    for (let c = 0; c < n; c++) count[grid[c * 4 + 3] + 1]++;
    for (let s = 0; s < this.S; s++) count[s + 1] += count[s];
    this.cellOff = count;
    this.cellX = new Float32Array(n); this.cellY = new Float32Array(n); this.cellPop = new Float32Array(n);
    const fill = count.slice(0, this.S);
    for (let c = 0; c < n; c++) {
      const s = grid[c * 4 + 3], k = fill[s]++;
      this.cellX[k] = grid[c * 4]; this.cellY[k] = grid[c * 4 + 1]; this.cellPop[k] = grid[c * 4 + 2];
    }
    // 약 1km 칸별 인구 (도심 도로 용량 보정용)
    this.densBins = new Map();
    for (let c = 0; c < n; c++) {
      const key = densKey(grid[c * 4], grid[c * 4 + 1]);
      this.densBins.set(key, (this.densBins.get(key) || 0) + grid[c * 4 + 2]);
    }
  }

  /**
   * 존(시군구) 안에서 도시철도를 타는 짧은 통행: 모형은 존 사이 통행만 배정하므로 같은 구 안 이용이 빠진다.
   * 역마다 역세권(반경 약 800m) 인구 × metroLocalRate명이 타고, 평균 metroLocalKm만큼 노선을 따라 간다고 보고 구간에 얹는다.
   * 갈림길에서는 갈래마다 나눈다. 보고하는 이용객과 혼잡도에만 더한다 (경로 선택에는 쓰지 않는다)
   */
  metroLocalLoads() {
    const L = this.net.links, out = new Float32Array(L.length);
    const adj = new Map();
    L.forEach((l, i) => {
      if (l.mode !== 2 || !l.active || l.via) return;
      for (const [u, v] of [[l.a, l.b], [l.b, l.a]]) { if (!adj.has(u)) adj.set(u, []); adj.get(u).push([v, i]); }
    });
    const stations = new Set(this.net.stations);
    const mean = P.metroLocalKm, maxKm = mean * 3;
    for (const s of adj.keys()) {
      if (!stations.has(s)) continue;
      const [x, y] = this.net.nodes[s];
      const riders = this.densityAt(x, y) * 2 * P.metroLocalRate;   // 밀도(명/km²) × 약 2km² (반경 800m)
      if (!(riders > 0)) continue;
      // 노선을 따라 퍼진다: [노드, 간 거리, 몫, 온 링크]
      const stack = [[s, 0, 1, -1]], seen = new Set([s]);
      while (stack.length) {
        const [u, d, share, from] = stack.pop();
        const next = adj.get(u).filter(([v, i]) => i !== from && !seen.has(v));
        for (const [v, i] of next) {
          const len = L[i].len, part = share / next.length;
          out[i] += riders * part * Math.exp(-(d + len / 2) / mean);
          seen.add(v);
          if (d + len < maxKm) stack.push([v, d + len, part, i]);
        }
      }
    }
    return out;
  }

  /** 지점 주변 3×3km 평균 인구 밀도 (명/km²) */
  densityAt(x, y) {
    if (!this.densBins) return 0;
    const [i, j] = densCell(x, y);
    let sum = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) sum += this.densBins.get(`${i + di}:${j + dj}`) || 0;
    return sum / 9;
  }

  /** 소구역의 격자들에 대해 f(경도, 위도)의 인구 가중 평균. 격자가 없으면 중심점 하나로 본다 */
  subMean(s, f) {
    const a = this.cellOff[s], b = this.cellOff[s + 1];
    if (a === b) return f(this.subX[s], this.subY[s]);
    let num = 0, den = 0;
    for (let k = a; k < b; k++) { num += this.cellPop[k] * f(this.cellX[k], this.cellY[k]); den += this.cellPop[k]; }
    return num / den;
  }

  /**
   * 후보 노드 가운데 소구역 격자 평균 접근시간(accessMinutes)이 가장 작은 k개 [[노드, 분], …] (작은 순).
   * 모든 후보를 다 재면 무거워서(도심 역 반경 25km 안에 수백 개), 소구역 중심 거리와 격자 반경으로 평균의 하한을 먼저 구해
   * 하한이 작은 순으로 재고, 하한이 이미 고른 k번째보다 크면 멈춘다. 고르는 결과는 다 잴 때와 같다.
   */
  bestByAccess(s, cands, k) {
    if (!cands.length) return [];
    const nodes = this.net.nodes, cx = this.subX[s], cy = this.subY[s];
    const a = this.cellOff[s], b = this.cellOff[s + 1];
    let rad = 0;
    for (let c = a; c < b; c++) rad = Math.max(rad, kmBetween(cx, cy, this.cellX[c], this.cellY[c]));
    // accessMinutes는 걷기·연계 두 갈래에서 각각 늘어난다: 구간 [lo, hi]에서의 최솟값
    const walk = (d) => d * P.accessDetour / P.walkSpeedKmh * 60;
    const feed = (d) => P.feederPenaltyMin + d * P.accessDetour / P.feederSpeedKmh * 60;
    const lower = (lo, hi) => (lo <= P.walkMaxKm ? Math.min(walk(lo), hi > P.walkMaxKm ? feed(Math.max(lo, P.walkMaxKm)) : Infinity) : feed(lo));
    const order = cands.map((nd) => {
      const dc = kmBetween(cx, cy, nodes[nd][0], nodes[nd][1]);
      const r = rad * 1.01 + 0.01;   // 경위도 거리 근사의 오차 여유
      return [nd, lower(Math.max(0, dc - r), dc + r)];
    }).sort((p, q) => p[1] - q[1]);
    const best = [];
    for (const [nd, lb] of order) {
      if (best.length >= k && lb > best[k - 1][1]) break;
      const [nx, ny] = nodes[nd];
      const acc = this.subMean(s, (x, y) => accessMinutes(kmBetween(x, y, nx, ny)));
      best.push([nd, acc]);
      best.sort((p, q) => p[1] - q[1]);
      if (best.length > k) best.length = k;
    }
    return best;
  }

  buildAccess() {
    const { net, S } = this;
    const nodes = net.nodes;
    const roadNodes = new Set(), railNodes = new Set(), hsrNodes = new Set();
    // 승용차·버스는 고속도로 중간으로 바로 들어가지 못한다: 고속도로만 닿는 노드는 접속 노드에서 뺀다 (IC는 다른 도로가 닿아 남는다)
    for (const l of net.links) {
      if (!l.active || l.mode === 2 || l.via) continue;
      if (l.mode === 0 && l.cls === 'motorway') continue;
      const set = l.mode === 0 ? roadNodes : railNodes;
      set.add(l.a); set.add(l.b);
      if (l.cls === 'hsr') { hsrNodes.add(l.a); hsrNodes.add(l.b); }
    }
    // 접속 노드·후보 역 고르기는 소구역 격자마다 거리를 재서 무겁다(수 초). 도로 접속 노드와 역 구성이 그대로면
    // (대부분의 해, 효과 미리보기의 대조 계산) 지난번 결과를 그대로 쓴다
    const metroNodes = new Set();
    for (const l of net.links) if (l.active && l.mode === 2) { metroNodes.add(l.a); metroNodes.add(l.b); }
    const sig = accessSignature(roadNodes, railNodes, hsrNodes, metroNodes, net.stations, nodes.length);
    if (this.accessSig === sig) {
      // 역 구성이 같으므로 역 배열·대기시간은 그대로, 해마다 새로 정하던 것만 다시 (승차 인원 0, 출발 묶음)
      this.boardings = new Float64Array(this.stationNode.length);
      this.stationFreshCap?.fill(0);   // 역 구성이 같으면 새로 문을 연 역이 없다
      this.buildOriginGroups();
      return;
    }
    this.accessSig = sig;
    const R = P.roadConnectors, M = P.metroCandidates, K = P.stationCandidates;
    const metroSt = [...new Set(net.stations)].filter((st) => metroNodes.has(st));
    const stationNodes = [...new Set(net.stations)].filter((st) => railNodes.has(st));
    // 기준선에 담겨 온 결과(preloadAccess)가 이 망 것이면, 바뀐 노드가 없는 셈으로 쳐서 소구역 계산을 모두 건너뛴다
    const pre = this.accessPreload;
    this.accessPreload = null;
    if (pre && pre.sig === sig) {
      Object.assign(this, pre.arrays);
      this.stationNodePrev = pre.stations;
      this.accessPrev = { n: nodes.length, road: roadNodes, metro: new Set(metroSt), st: new Set(stationNodes), hsr: hsrNodes };
    }
    // 해마다 공사 중이던 노선 몇 개가 개통하며 노드가 조금씩 바뀐다. 바뀐 노드가 닿을 수 있는 소구역만 다시 구한다
    // (전부 다시 하면 7초 남짓). 처음이거나 많이 바뀌었으면 전부
    const prev = this.accessPrev;
    const diff = (a, b) => { const out = []; for (const x of a) if (!b.has(x)) out.push(x); for (const x of b) if (!a.has(x)) out.push(x); return out; };
    let dRoad = null, dMetro = null, dSt = null;
    if (prev && nodes.length >= prev.n) {
      dRoad = diff(prev.road, roadNodes);
      dMetro = diff(prev.metro, new Set(metroSt));
      dSt = [...diff(prev.st, new Set(stationNodes)), ...diff(prev.hsr, hsrNodes)];
      if (dRoad.length + dMetro.length + dSt.length > 3000) dRoad = dMetro = dSt = null;
    }
    const near = (s, list, km) => {
      for (const nd of list) if (kmBetween(this.subX[s], this.subY[s], nodes[nd][0], nodes[nd][1]) <= km) return true;
      return false;
    };
    const full = !dRoad;
    // 도로: 소구역마다 가까운 도로 노드 R개에 나눠 싣는다 (한 노드에 몰리는 접속부 정체 방지)
    const roadIdx = new SpatialIndex(nodes, roadNodes);
    if (full) {
      this.subRoadNode = new Int32Array(S * R).fill(-1);
      this.subRoadAcc = new Float64Array(S * R);
      this.subRoadW = new Float64Array(S * R);
      this.subRoadFar = new Float64Array(S);
    }
    let redone = 0;
    for (let s = 0; s < S; s++) {
      // 바뀐 노드가 지금 고른 R개 가운데 가장 먼 것보다 가까우면 (새로 생겼거나 없어졌거나) 다시 고른다
      if (!full && !near(s, dRoad, this.subRoadFar[s] + 1e-6)) continue;
      redone++;
      const nearK = roadIdx.nearestK(this.subX[s], this.subY[s], R);
      let wsum = 0, far = 0;
      for (let k = 0; k < R; k++) { this.subRoadNode[s * R + k] = -1; this.subRoadAcc[s * R + k] = 0; this.subRoadW[s * R + k] = 0; }
      nearK.forEach((nd, k) => {
        const [nx, ny] = nodes[nd];
        far = Math.max(far, kmBetween(this.subX[s], this.subY[s], nx, ny));
        const acc = this.subMean(s, (x, y) => kmBetween(x, y, nx, ny)) * P.accessDetour / P.accessSpeedKmh * 60 + P.roadTerminalMin;
        this.subRoadNode[s * R + k] = nd;
        this.subRoadAcc[s * R + k] = acc;
        this.subRoadW[s * R + k] = 1 / (acc + 5);
        wsum += 1 / (acc + 5);
      });
      for (let k = 0; k < nearK.length; k++) this.subRoadW[s * R + k] /= wsum;
      this.subRoadFar[s] = nearK.length < R ? Infinity : far;
    }
    this.roadNodeSet = roadNodes;
    // 도시철도역과 소구역별 후보 (걸어가거나 버스로 갈 만한 곳)
    this.metroStationNodes = metroSt;
    const mIdx = new SpatialIndex(nodes, new Set(metroSt));
    if (full) {
      this.subMetro = new Int32Array(S * M).fill(-1);
      this.subMetroAcc = new Float64Array(S * M);
    }
    for (let s = 0; s < S; s++) {
      if (!full && !near(s, dMetro, P.metroRadiusKm)) continue;
      for (let k = 0; k < M; k++) { this.subMetro[s * M + k] = -1; this.subMetroAcc[s * M + k] = 0; }
      const scored = this.bestByAccess(s, mIdx.within(this.subX[s], this.subY[s], P.metroRadiusKm), M);
      scored.forEach(([nd, acc], k) => { this.subMetro[s * M + k] = nd; this.subMetroAcc[s * M + k] = acc; });
    }
    this.accessPrev = { n: nodes.length, road: roadNodes, metro: new Set(metroSt), st: new Set(stationNodes), hsr: hsrNodes };
    this.accessRedone = full ? S : redone;
    // 철도: 운행 중인 역
    this.stationNode = Int32Array.from(stationNodes);
    this.stationOf = new Map(stationNodes.map((nd, i) => [nd, i]));
    const NS = stationNodes.length;
    // 역 대기시간은 이용객에 따라 정해진다 (운행 횟수는 수요를 따라간다). 이전 결과가 있으면 이어 쓴다
    const prevWait = new Map();
    if (this.stationWait && this.stationNodeOld) this.stationNodeOld.forEach((nd, i) => prevWait.set(nd, this.stationWait[i]));
    this.stationWait = new Float64Array(NS);
    // 새로 문을 연 역: 첫해에는 아직 이용객이 적어도 개통에 맞춰 시간표를 짠다고 보고 기다림을 기본값 밑으로 둔다
    // (그러지 않으면 이용객이 적다 → 기다림이 90분으로 → 이용객이 더 준다는 고리 탓에 새 역 수요가 크게 낮게 잡힌다)
    this.stationFreshCap = new Float64Array(NS);
    stationNodes.forEach((nd, i) => {
      const kp = this.isKPPoint(nodes[nd][0], nodes[nd][1]);
      const base = hsrNodes.has(nd) ? P.railWaitMin.hsr : kp ? P.railWaitMin.kpConv : P.railWaitMin.conv;
      this.stationWait[i] = prevWait.get(nd) ?? base;
      if (prevWait.size && !prevWait.has(nd)) this.stationFreshCap[i] = base;
    });
    this.stationNodeOld = Int32Array.from(stationNodes);
    this.stationHsr = Uint8Array.from(stationNodes, (nd) => (hsrNodes.has(nd) ? 1 : 0));
    this.stationKP = Uint8Array.from(stationNodes, (nd) => this.isKPPoint(nodes[nd][0], nodes[nd][1]));
    // 소구역별 후보 역: 격자 단위 접근시간(도보 또는 연계교통)의 인구 가중 평균이 작은 역 최대 K개
    const stIdx = new SpatialIndex(nodes, new Set(stationNodes));
    if (full) {
      this.subSt = new Int32Array(S * K).fill(-1);
      this.subStAcc = new Float64Array(S * K);
    } else {
      // 남은 소구역의 후보 역 번호를 새 역 배열 번호로 옮긴다 (역이 생기고 없어지면 번호가 밀린다)
      const old = this.stationNodePrev;
      for (let i = 0; i < this.subSt.length; i++) {
        const k = this.subSt[i];
        if (k >= 0) this.subSt[i] = this.stationOf.get(old[k]) ?? -1;
      }
    }
    this.stationNodePrev = this.stationNode;
    for (let s = 0; s < S; s++) {
      if (!full && !near(s, dSt, P.stationRadiusKm)) continue;
      for (let k = 0; k < K; k++) { this.subSt[s * K + k] = -1; this.subStAcc[s * K + k] = 0; }
      const cands = stIdx.within(this.subX[s], this.subY[s], P.stationRadiusKm);
      const scored = this.bestByAccess(s, cands, K);
      // 가까운 역 K곳에 고속철도역이 없으면 가장 가까운 고속철도역을 마지막 후보로 넣는다
      // (청주 도심처럼 일반역이 여럿 가까워도 서울·부산 가는 사람은 오송역 KTX를 탄다)
      if (scored.length && !scored.some(([nd]) => hsrNodes.has(nd))) {
        const h = this.bestByAccess(s, cands.filter((nd) => hsrNodes.has(nd)), 1)[0];
        if (h) scored[Math.min(scored.length, K - 1)] = h;
      }
      scored.forEach(([nd, acc], k) => { this.subSt[s * K + k] = this.stationOf.get(nd); this.subStAcc[s * K + k] = acc; });
    }
    this.boardings = new Float64Array(NS);
    this.buildOriginGroups();
  }

  /**
   * 승용차 출발 묶음: 넓은 존의 소구역을 위치로 몇 묶음(가중 k-평균)으로 나눈다.
   * 묶음마다 최단경로 트리를 따로 만들어, 같은 시군구 안에서도 읍면동 위치에 따라 지나는 도로가 달라지게 한다.
   * 묶음 수 = √(면적 / originGroupKm2), 1~originGroupsMax개 (작은 도심 구는 하나)
   */
  buildOriginGroups() {
    const off = [0], subOff = [0], subs = [];
    for (let z = 0; z < this.Z; z++) {
      const s0 = this.zoneSub0[z], n = this.zoneSubN[z];
      const G = Math.max(1, Math.min(P.originGroupsMax, n, Math.round(Math.sqrt(this.area[z] / P.originGroupKm2))));
      const cos = Math.cos(this.cy[z] * Math.PI / 180);
      const wt = (s) => Math.max(this.subW[s], 1e-4);
      // 초기 중심: 가장 무거운 소구역에서 시작해 서로 먼 소구역을 차례로 (결정적)
      const cx = [], cy = [];
      let first = s0;
      for (let s = s0; s < s0 + n; s++) if (wt(s) > wt(first)) first = s;
      cx.push(this.subX[first] * cos); cy.push(this.subY[first]);
      while (cx.length < G) {
        let far = s0, fd = -1;
        for (let s = s0; s < s0 + n; s++) {
          let d = Infinity;
          for (let g = 0; g < cx.length; g++) d = Math.min(d, (this.subX[s] * cos - cx[g]) ** 2 + (this.subY[s] - cy[g]) ** 2);
          if (d * wt(s) > fd) { fd = d * wt(s); far = s; }
        }
        cx.push(this.subX[far] * cos); cy.push(this.subY[far]);
      }
      const lab = new Int32Array(n);
      for (let it = 0; it < 8; it++) {
        for (let k = 0; k < n; k++) {
          const s = s0 + k;
          let best = 0, bd = Infinity;
          for (let g = 0; g < G; g++) {
            const d = (this.subX[s] * cos - cx[g]) ** 2 + (this.subY[s] - cy[g]) ** 2;
            if (d < bd) { bd = d; best = g; }
          }
          lab[k] = best;
        }
        for (let g = 0; g < G; g++) {
          let sx = 0, sy = 0, sw = 0;
          for (let k = 0; k < n; k++) if (lab[k] === g) { const s = s0 + k; sx += wt(s) * this.subX[s] * cos; sy += wt(s) * this.subY[s]; sw += wt(s); }
          if (sw > 0) { cx[g] = sx / sw; cy[g] = sy / sw; }
        }
      }
      for (let g = 0; g < G; g++) {
        let any = false;
        for (let k = 0; k < n; k++) if (lab[k] === g) { subs.push(s0 + k); any = true; }
        if (any) subOff.push(subs.length);
      }
      off.push(subOff.length - 1);
    }
    this.grpOff = Int32Array.from(off);
    this.grpSubOff = Int32Array.from(subOff);
    this.grpSub = Int32Array.from(subs);
  }

  isKPPoint(lon, lat) {
    // 가장 가까운 존의 국가 (역 대기시간 판정용)
    let best = 0, bd = Infinity;
    for (let z = 0; z < this.Z; z++) {
      const d = (this.cx[z] - lon) ** 2 + (this.cy[z] - lat) ** 2;
      if (d < bd) { bd = d; best = z; }
    }
    return this.isKP[best];
  }

  updateCosts() {
    const L = this.net.links;
    for (let i = 0; i < L.length; i++) {
      const vc = this.capacity[i] > 0 ? this.volume[i] / this.capacity[i] : 0;
      if (L[i].mode === 0) {
        const r = Math.min(1 + P.bprAlpha * vc ** P.bprBeta, P.bprMaxRatio);
        // 지체는 짧은 구간(다리 진입부·교차로)에도 최소 bprMinBaseMin분 기준으로 붙인다.
        // 그냥 곱하면 50m 구간은 V/C가 10이어도 몇 초밖에 늦어지지 않아 교통이 한 곳에 몰린다
        const t0 = this.freeTime[i];
        const t = t0 + Math.max(t0, P.bprMinBaseMin) * (r - 1);
        // 운전자는 같은 시간이면 고속도로를 고른다 (신호·교차로·안전에 대한 체감 차이)
        this.cost[i] = t * (P.roadPerceived[L[i].cls] ?? 1);
      } else {
        this.cost[i] = this.freeTime[i] * (1 + 0.5 * Math.max(0, vc - 1));
        // 고속철도 구간은 비싼 운임(일반철도와의 차이)을 시간으로 바꿔 경로 비용에 넣는다:
        // 그러지 않으면 일반열차로 갈 통행까지 모두 고속선으로 배정된다
        if (L[i].mode === 1 && L[i].cls === 'hsr' && !L[i].via) this.cost[i] += (L[i].len * (P.railFarePerKm.hsr - P.railFarePerKm.conv)) / P.vot;
      }
      // 민자 구간의 통행료·추가 운임 (원/km): 시간 가치로 바꿔 더한다
      if (L[i].toll) this.cost[i] += (L[i].len * L[i].toll) / P.vot;
      // 버스는 같은 도로를 승용차보다 느리게 달리고, 일반 도로에서는 정류장마다 선다 (고속버스는 고속도로에서 서지 않음)
      if (this.costT) {
        const l = L[i];
        this.costT[i] = l.mode !== 0 ? this.cost[i]
          : this.cost[i] * P.busTimeFactor + (l.cls === 'motorway' ? 0 : l.len * P.busStopMinPerKm);
      }
    }
  }

  // ------------------------------------------------------------ 배정

  borderCost(i, j, integration) {
    if (this.isExt[i] || this.isExt[j]) {
      if (this.isExt[i] && this.isExt[j]) return Infinity;   // 국외끼리는 다루지 않는다
      return P.intlBorderMin[this.extCountry[i] || this.extCountry[j]] ?? 150;
    }
    return this.isKP[i] !== this.isKP[j] ? P.borderPenaltyMin * (1 - integration) : 0;
  }

  /** 운행 빈도는 이용객을 따라간다: 대기 ≈ c / √이용객 (분), 반복마다 MSA로 섞는다 */
  updateStationWaits(it) {
    for (let s = 0; s < this.stationWait.length; s++) {
      const cap = this.stationKP[s] ? P.kpWaitMaxMin : P.waitMaxMin;
      let target = Math.min(Math.max(P.waitScale / Math.sqrt(this.boardings[s] + 1), P.waitMinMin), cap);
      if (this.svcTrains?.[s] > 0) target = Math.min(target, Math.max(3, P.serviceDayMin / (2 * this.svcTrains[s])));
      if (this.stationFreshCap?.[s] > 0) target = Math.min(target, this.stationFreshCap[s]);
      this.stationWait[s] += (target - this.stationWait[s]) / (it + 1);
    }
  }

  /** 역 간 철도 소요시간 행렬 (분) */
  stationMatrix() {
    const NS = this.stationNode.length;
    if (!this.stD || this.stD.length !== NS * NS) this.stD = new Float32Array(NS * NS);
    const D = this.stD;
    for (let a = 0; a < NS; a++) {
      this.rail.shortestPaths(this.stationNode[a], this.cost);
      const d = this.rail.dist;
      for (let b = 0; b < NS; b++) D[a * NS + b] = d[this.stationNode[b]];
    }
    return D;
  }

  /**
   * 철도 묶음: 존마다 후보역 목록이 같은 소구역을 합친다 (읍면동 단위 소구역은 대부분 이웃과 같은 역을 쓴다).
   * 접근시간은 인구 가중 평균. 후보역이 없는 소구역(역 반경 밖)은 철도를 쓰지 않는 것으로 보고 뺀다.
   * 소구역 인구비중이 바뀌므로 배정할 때마다 다시 만든다.
   */
  /**
   * 일반철도역–도시철도역 환승 연결(플레이어가 지은 것, net.railMetro = [[철도역 노드, 도시철도역 노드]]):
   * 소구역에서 가까운 도시철도역까지 가서 도시철도로 연결역까지 간 뒤 갈아타는 길을 후보 역에 더한다.
   * 결과는 subSt·subStAcc를 고친 사본(subStX·subStAccX). 연결이 없으면 원본을 그대로 쓴다.
   */
  metroFeed() {
    const K = P.stationCandidates, M = P.metroCandidates;
    const pairs = (this.net.railMetro || []).map(([r, m]) => [this.stationOf.get(r), m]).filter(([k, m]) => k != null && m >= 0 && m < this.net.nodes.length);
    if (!pairs.length || !this.subMetro) { this.subStX = this.subStAccX = null; this._feedKey = null; return; }
    const key = `${this.accessSig}|${pairs.join(';')}`;
    if (key === this._feedKey) return;
    this._feedKey = key;
    const st = Int32Array.from(this.subSt), acc = Float64Array.from(this.subStAcc);
    // 연결역(도시철도 쪽)에서 도시철도망 시간: 짝마다 한 번
    const dists = pairs.map(([, m]) => { this.metroG.shortestPaths(m, this.freeTime); return Float32Array.from(this.metroG.dist); });
    for (let s = 0; s < this.S; s++) {
      for (let q = 0; q < pairs.length; q++) {
        let best = Infinity;
        for (let k = 0; k < M; k++) {
          const mn = this.subMetro[s * M + k];
          if (mn < 0) break;
          const t = this.subMetroAcc[s * M + k] + dists[q][mn] + P.metroRailTransferMin;
          if (t < best) best = t;
        }
        if (!(best <= P.metroFeedMaxMin)) continue;
        const r = pairs[q][0];
        // 같은 역이 이미 후보면 더 짧은 쪽, 아니면 빈 자리나 가장 먼 후보 자리에
        let slot = -1, empty = -1, worst = -1, wv = -Infinity;
        for (let k = 0; k < K; k++) {
          const x = st[s * K + k];
          if (x === r) { slot = k; break; }
          if (x < 0) { if (empty < 0) empty = k; continue; }
          if (acc[s * K + k] > wv) { wv = acc[s * K + k]; worst = k; }
        }
        const put = slot >= 0 ? (best < acc[s * K + slot] ? slot : -1) : empty >= 0 ? empty : best < wv ? worst : -1;
        if (put >= 0) { st[s * K + put] = r; acc[s * K + put] = best; }
      }
    }
    this.subStX = st; this.subStAccX = acc;
  }

  buildRailSets() {
    const K = P.stationCandidates;
    this.metroFeed();
    const subSt = this.subStX || this.subSt, subStAcc = this.subStAccX || this.subStAcc;
    const off = new Int32Array(this.Z + 1), st = [], acc = [], w = [], wd = [];
    const DW = this.destW || this.subW;   // 도착 쪽 비중: 인구에 관광지 읍면동을 섞은 것
    for (let z = 0; z < this.Z; z++) {
      const sets = new Map();
      let total = 0, totalD = 0;
      for (let o = this.zoneSub0[z]; o < this.zoneSub0[z] + this.zoneSubN[z]; o++) {
        const wo = this.subW[o], wdo = DW[o];
        if (!(wo > 0) && !(wdo > 0)) continue;
        total += wo; totalD += wdo;
        if (subSt[o * K] < 0) continue;
        let key = '';
        for (let a = 0; a < K; a++) key += `${subSt[o * K + a]},`;
        let e = sets.get(key);
        if (!e) { e = { w: 0, wd: 0, acc: new Float64Array(K), o }; sets.set(key, e); }
        e.w += wo; e.wd += wdo;
        const aw = wo + wdo;   // 접근시간은 출발·도착 비중을 함께 가중
        for (let a = 0; a < K; a++) e.acc[a] += aw * subStAcc[o * K + a];
      }
      for (const e of sets.values()) {
        for (let a = 0; a < K; a++) { st.push(subSt[e.o * K + a]); acc.push(e.acc[a] / Math.max(1e-12, e.w + e.wd)); }
        w.push(total > 0 ? e.w / total : 0);
        wd.push(totalD > 0 ? e.wd / totalD : 0);
      }
      off[z + 1] = w.length;
    }
    this.railSetOff = off;
    this.railSetSt = Int32Array.from(st);
    this.railSetAcc = Float64Array.from(acc);
    this.railSetW = Float64Array.from(w);
    this.railSetWD = Float64Array.from(wd);
  }

  /**
   * 존 i→j 철도 일반화 시간. 철도 묶음 쌍마다 가장 좋은 출발역·도착역 조합을 고르고 인구비중으로 평균한다.
   * pick 배열에는 묶음 쌍별 [출발역, 도착역, 비중]을 넣는다 (배정용, 비중의 합은 1).
   * 역이 닿는 소구역끼리만 따진다: 한 읍면동이 역 반경 밖이라고 존 전체가 철도를 못 쓰게 되지 않도록.
   */
  railCost(i, j, D, pick) {
    const K = P.stationCandidates, NS = this.stationNode.length;
    const { railSetOff: off, railSetSt: st, railSetAcc: acc, railSetW: w, railSetWD: wd } = this;
    // 출발 존 i의 역 묶음 o마다 "o에서 역 t까지 가장 싼 접근+대기+철도 시간"(H)을 한 번 구해 두면
    // 도착 묶음마다 후보 역 K개만 보면 된다 (K² → K, 한 해 계산의 3분의 1이던 부분)
    const H = this.railHead(i, D);
    const p0 = pick.length;
    let total = 0, wsum = 0;
    for (let o = off[i]; o < off[i + 1]; o++) {
      const h0 = (o - off[i]) * NS;
      for (let d = off[j]; d < off[j + 1]; d++) {
        let best = Infinity, bt = -1;
        for (let b = 0; b < K; b++) {
          const t = st[d * K + b];
          if (t < 0) break;
          const c = H.cost[h0 + t] + acc[d * K + b];
          if (c < best) { best = c; bt = t; }
        }
        if (!isFinite(best)) continue;
        const ww = w[o] * wd[d];
        total += ww * best;
        wsum += ww;
        pick.push(H.from[h0 + bt], bt, ww);
      }
    }
    if (!(wsum > 0)) { pick.length = p0; return Infinity; }
    for (let k = p0 + 2; k < pick.length; k += 3) pick[k] /= wsum;
    return total / wsum;
  }

  /** railCost용: 존 i의 역 묶음별, 도착역 t까지 가장 싼 (출발역 접근 + 역 대기 + 역 간 시간)과 그 출발역 */
  railHead(i, D) {
    const c = this._railH;
    if (c && c.i === i && c.D === D && c.off === this.railSetOff) return c;
    const K = P.stationCandidates, NS = this.stationNode.length;
    const { railSetOff: off, railSetSt: st, railSetAcc: acc } = this;
    const n = (off[i + 1] - off[i]) * NS;
    const cost = c && c.cost.length >= n ? c.cost : new Float64Array(Math.max(n, NS * 8));
    const from = c && c.from.length >= n ? c.from : new Int32Array(cost.length);
    for (let o = off[i]; o < off[i + 1]; o++) {
      const h0 = (o - off[i]) * NS;
      cost.fill(Infinity, h0, h0 + NS);
      for (let a = 0; a < K; a++) {
        const s = st[o * K + a];
        if (s < 0) break;
        const head = acc[o * K + a] + this.stationWait[s];
        const row = s * NS;
        for (let t = 0; t < NS; t++) {
          if (t === s) continue;
          const v = head + D[row + t];
          if (v < cost[h0 + t]) { cost[h0 + t] = v; from[h0 + t] = s; }
        }
      }
    }
    this._railH = { i, D, off, cost, from };
    return this._railH;
  }

  /**
   * MSA 통행배정. 수요는 매 반복의 비용으로 다시 계산한다.
   * 수단은 승용차·지역 간 철도·대중교통(버스+도시철도) 세 가지이며 로짓으로 나눈다.
   * - 승용차: 존의 소구역 도로 노드들을 함께 출발점으로 하는 최단경로 트리에 싣는다.
   * - 철도: 역 간 수요 행렬을 만든 뒤 출발역별 최단경로 트리에 싣는다.
   * - 대중교통: 버스(도로) + 도시철도 + 환승 링크 그래프의 트리에 싣고, 도시철도 구간 이용객만 기록한다.
   * @param {number} integration 남북 통합도 0~1
   * @param {(p:number)=>void} [progress]
   * @param {boolean} [warm] 지난해 교통량에서 이어 시작 (반복 수를 줄인다)
   */
  assign(integration, progress, warm = false, offsetOverride = null) {
    const run = this.startAssign(integration, warm, offsetOverride);
    for (let it = 1; it <= run.iters; it++) {
      this.beginIteration(run);
      const all = [];
      for (let i = 0; i < this.Z; i++) all.push(i);
      this.originPass(run, it, all, progress);
      this.endIteration(run, it);
    }
    this.updateCosts();
    this.odT = run.odT; this.odTime = run.odTime;
    return run.totals;
  }

  /**
   * assign과 같은 계산을 보조 워커(pool)에 나눠 한다. 출발 존별 최단경로·수단분담·트리 싣기가 시간의 대부분이고
   * 출발 존마다 서로 독립이라, 반복마다 같은 상태(교통량·역 대기·항공 수요)를 보조 워커에 맞춰 준 뒤 존을 나눠 맡긴다.
   * @param {{size:number, run:(msg:object)=>Promise<object[]>}} pool 보조 워커 묶음 (size개, run은 워커마다 결과 하나)
   */
  async assignParallel(pool, integration, progress, warm = false, offsetOverride = null) {
    const run = this.startAssign(integration, warm, offsetOverride);
    const parts = pool.size + 1;
    for (let it = 1; it <= run.iters; it++) {
      // 역 간 철도 시간표(D, 역 수² 칸)는 여기서 한 번 구해 보조 워커에 넘긴다 (워커마다 같은 계산을 되풀이하지 않게)
      this.beginIteration(run);
      // 보조 워커: 같은 교통량·역 간 시간으로 맞춘 뒤 제 몫의 존을 계산한다
      const pending = pool.run((k) => ({
        type: 'origins', it, iters: run.iters, integration, part: k + 1, parts,
        volume: this.volume, stationWait: this.stationWait, airOD: this.airOD, D: run.D,
      }));
      const mine = [];
      for (let i = 0; i < this.Z; i += parts) mine.push(i);
      this.originPass(run, it, mine, progress);
      for (const r of await pending) this.mergeOrigins(run, r, it);
      this.endIteration(run, it);
    }
    this.updateCosts();
    this.odT = run.odT; this.odTime = run.odTime;
    return run.totals;
  }

  /** 배정 한 번에 쓰는 작업 공간 */
  startAssign(integration, warm, offsetOverride) {
    const L = this.net.links;
    const A = this.airports.length;
    const iters = warm ? P.msaIterationsWarm : P.msaIterations;
    // 지난해 교통량을 앞선 반복 몇 번 분으로 친다 (한 번의 전량배정이 혼잡을 다시 한곳에 몰지 않도록 1/4씩 섞는다)
    // 새 노선이 열린 해(offsetOverride)에도 나머지 망은 평소대로 천천히 섞고, 지난해 이용이 없던 링크(새로 열린 구간)만
    // 빨리 섞어 첫해 이용이 바로 잡히게 한다. 망 전체를 빨리 섞으면 혼잡이 출렁여 총 통행이 몇 %씩 튄다.
    const offset = warm ? P.warmMsaOffset : 0;
    const fresh = warm && offsetOverride != null ? this.volume.map((v) => (v === 0 ? 1 : 0)) : null;
    return {
      integration, iters, offset, fresh, freshOffset: offsetOverride ?? offset,
      aux: new Float64Array(L.length),
      stOD: new Float32Array(this.stationNode.length ** 2),   // 역×역 통행 (32비트로 충분하다: 보조 워커마다 한 벌씩이라 메모리를 아낀다)
      airOD: new Float64Array(A * A), latentOD: new Float64Array(A * A),
      totals: null, D: null,
      odT: new Float32Array(this.Z * this.Z), odTime: new Float32Array(this.Z * this.Z),
    };
  }

  beginIteration(run, D = null) {
    this.updateCosts();
    this.buildDestW(run.integration);
    run.aux.fill(0);
    run.stOD.fill(0);
    run.airOD.fill(0);
    run.latentOD.fill(0);
    run.D = D || this.stationMatrix();
    run.totals = { trips: 0, rail: 0, road: 0, transit: 0, air: 0, intl: 0, vhm: 0, kpkr: 0, krTrips: 0, krTransit: 0 };
    this.buildRailSets();
  }

  /**
   * 도착 읍면동 비중: 인구 비중에 관광 몫만큼 관광지 읍면동을 섞는다 (관광지 옆에 역을 놓으면 관광 철도 수요가 생긴다)
   */
  buildDestW(integration) {
    const Z = this.Z, mass = this.tripMass();
    const destW = this.destW = Float64Array.from(this.subW);
    for (let j = 0; j < Z; j++) {
      const tm = ((this.tour[j] + this.tourKP[j] * integration) * P.tourismMass) / 1e4;
      if (!(tm > 0)) continue;
      const d0 = this.zoneSub0[j], dn = this.zoneSubN[j];
      const siteOf = (d) => this.tourSub[d] + (this.tourKP[j] > 0 ? this.tourSubKP[d] * integration : 0);
      let site = 0;
      for (let d = d0; d < d0 + dn; d++) site += siteOf(d);
      if (!(site > 0)) continue;
      const tau = tm / (mass[j] + tm);
      for (let d = d0; d < d0 + dn; d++) destW[d] = (1 - tau) * this.subW[d] + tau * siteOf(d) / site;
    }
  }

  /** 보조 워커 하나의 결과를 더한다 */
  mergeOrigins(run, r, it) {
    for (let k = 0; k < r.aux.length; k++) run.aux[k] += r.aux[k];
    for (let k = 0; k < r.stOD.length; k++) if (r.stOD[k]) run.stOD[k] += r.stOD[k];
    for (let k = 0; k < r.airOD.length; k++) { run.airOD[k] += r.airOD[k]; run.latentOD[k] += r.latentOD[k]; }
    const Z = this.Z;
    for (const i of r.zones) this.ccomp.set(r.ccomp.subarray(i * Z, i * Z + Z), i * Z);
    if (it === run.iters && r.odT) {
      for (const i of r.zones) { run.odT.set(r.odT.subarray(i * Z, i * Z + Z), i * Z); run.odTime.set(r.odTime.subarray(i * Z, i * Z + Z), i * Z); }
    }
    if (it === run.iters) {
      for (const [k, v] of Object.entries(r.totals)) {
        if (k === 'tourDest') { run.totals.tourDest ||= {}; for (const [j, x] of Object.entries(v)) run.totals.tourDest[j] = (run.totals.tourDest[j] || 0) + x; }
        else run.totals[k] = (run.totals[k] || 0) + v;
      }
    }
  }

  /** 승용차 출발 묶음 (보조 워커에 주 워커와 같은 묶음을 쓰게 넘긴다: 묶음은 망을 바꿀 때의 소구역 인구로 정해진다) */
  originGroups() { return { grpOff: this.grpOff, grpSubOff: this.grpSubOff, grpSub: this.grpSub }; }

  setOriginGroups(g) { this.grpOff = g.grpOff; this.grpSubOff = g.grpSubOff; this.grpSub = g.grpSub; }

  /** 보조 워커 쪽: 주 워커와 같은 교통량으로 맞춘 뒤 제 몫의 출발 존을 계산해 돌려준다 */
  originsFor(msg) {
    this.volume.set(msg.volume);
    this.stationWait.set(msg.stationWait);
    this.airOD.set(msg.airOD);
    this.airPaxFromOD();
    const run = this.startAssign(msg.integration, false, null);
    run.iters = msg.iters;
    this.beginIteration(run, msg.D);
    const zones = [];
    for (let i = msg.part; i < this.Z; i += msg.parts) zones.push(i);
    this.originPass(run, msg.it, zones, null);
    return { aux: run.aux, stOD: run.stOD, airOD: run.airOD, latentOD: run.latentOD, totals: run.totals, ccomp: this.ccomp, zones,
      odT: msg.it === msg.iters ? run.odT : null, odTime: msg.it === msg.iters ? run.odTime : null };
  }

  /** 출발 존들(zoneList)의 승용차·대중교통 최단경로, 수단분담, 트리 싣기 */
  originPass(run, it, zoneList, progress) {
    const { Z, net } = this;
    const L = net.links;
    const nNodes = net.nodes.length;
    const NS = this.stationNode.length;
    const R = P.roadConnectors, M = P.metroCandidates;
    const { aux, stOD, airOD, latentOD, totals, D, iters, integration, odT, odTime } = run;
    const destW = this.destW || this.subW;
    const auxT = this.auxT && this.auxT.length === this.transitLinkCount ? this.auxT : (this.auxT = new Float64Array(this.transitLinkCount));
    const nodeDemand = this.nodeDemandBuf && this.nodeDemandBuf.length === nNodes ? this.nodeDemandBuf : (this.nodeDemandBuf = new Float64Array(nNodes));
    const croad = new Float64Array(Z), ctr = new Float64Array(Z);
    const egress = new Int32Array(this.S);   // 대중교통 도착 소구역별 하차 노드
    const mass = this.tripMass();
    // 관광 통행: 목적지 쪽 질량에 관광 매력도를 더한다 (방문객 1명 ≈ 인구 tourismMass명)
    const tmass = new Float64Array(Z);
    for (let j = 0; j < Z; j++) tmass[j] = ((this.tour[j] + this.tourKP[j] * integration) * P.tourismMass) / 1e4;
    const pick = [];
    const pickOff = new Int32Array(Z + 1);
    const crail = new Float64Array(Z), airC = new Array(Z), compAcc = new Float64Array(Z), timeAcc = new Float64Array(Z), tAcc = new Float64Array(Z);
    const lam = P.logitLambda;
    const A = this.airports.length;
    let done = 0;

    for (const i of zoneList) {
      const o0 = this.zoneSub0[i], on = this.zoneSubN[i];
      // 대중교통 비용: 버스 정류장(도로 노드)이나 도시철도역에서 출발 (존 전체를 한 트리로)
      const tsrc = [], tinit = [];
      for (let o = o0; o < o0 + on; o++) {
        for (let k = o * R; k < o * R + R; k++) {
          if (this.subRoadNode[k] >= 0) { tsrc.push(this.subRoadNode[k]); tinit.push(this.subRoadAcc[k] * P.busAccessFactor + P.busWaitMin); }
        }
        for (let k = o * M; k < o * M + M; k++) {
          if (this.subMetro[k] >= 0) { tsrc.push(this.subMetro[k]); tinit.push(this.subMetroAcc[k] + P.metroWaitMin); }
        }
      }
      this.transit.shortestPaths(tsrc, this.costT, tinit);
      const td = this.transit.dist;
      for (let j = 0; j < Z; j++) {
        let c = 0, wsum = 0;
        for (let d = this.zoneSub0[j]; d < this.zoneSub0[j] + this.zoneSubN[j]; d++) {
          egress[d] = -1;
          if (!(destW[d] > 0)) continue;
          wsum += destW[d];
          let best = Infinity, node = -1;
          for (let k = d * R; k < d * R + R; k++) {
            if (this.subRoadNode[k] < 0) break;
            const v = td[this.subRoadNode[k]] + this.subRoadAcc[k] * P.busAccessFactor;
            if (v < best) { best = v; node = this.subRoadNode[k]; }
          }
          for (let k = d * M; k < d * M + M; k++) {
            if (this.subMetro[k] < 0) break;
            const v = td[this.subMetro[k]] + this.subMetroAcc[k];
            if (v < best) { best = v; node = this.subMetro[k]; }
          }
          egress[d] = node;
          c += destW[d] * best;
        }
        ctr[j] = wsum > 0 ? c / wsum : Infinity;
      }
      // 철도·항공 비용은 존 단위로 한 번만 (출발 묶음마다 같다)
      pick.length = 0;
      pickOff[0] = 0;
      for (let j = 0; j < Z; j++) {
        crail[j] = i === j ? Infinity : this.railCost(i, j, D, pick);
        pickOff[j + 1] = pick.length;
        airC[j] = i === j ? null : this.airCost(i, j);
      }

      const tDemand = this.transitDemand && this.transitDemand.length === nNodes ? this.transitDemand : (this.transitDemand = new Float64Array(nNodes));
      tDemand.fill(0);
      compAcc.fill(0); timeAcc.fill(0); tAcc.fill(0);
      const carPen = P.carlessPenaltyMin * Math.max(0, 1 - this.income[i] / P.carOwnershipIncome);
      // 승용차: 출발 소구역 묶음마다 따로 최단경로 트리를 만든다.
      // 존 전체를 한 트리로 하면 모든 통행이 가장 유리한 접속점 하나로 나가, 같은 시군구 안 다른 읍면동 쪽 도로는 비어 보인다
      let zw = 0;
      for (let o = o0; o < o0 + on; o++) zw += Math.max(this.subW[o], 0);
      for (let g = this.grpOff[i]; g < this.grpOff[i + 1]; g++) {
        let gw = 0;
        const src = [], init = [];
        for (let q = this.grpSubOff[g]; q < this.grpSubOff[g + 1]; q++) {
          const o = this.grpSub[q];
          gw += Math.max(this.subW[o], 0);
          for (let k = o * R; k < o * R + R; k++) {
            if (this.subRoadNode[k] >= 0) { src.push(this.subRoadNode[k]); init.push(this.subRoadAcc[k]); }
          }
        }
        // 인구가 없는 묶음은 건너뛴다 (존 전체 인구가 0이면 첫 묶음이 다 맡는다)
        const share = zw > 0 ? gw / zw : (g === this.grpOff[i] ? 1 : 0);
        if (!(share > 0) || !src.length) continue;
        this.road.shortestPaths(src, this.cost, init);
        const rd = this.road.dist;
        for (let j = 0; j < Z; j++) {
          let c = 0, wsum = 0;
          for (let d = this.zoneSub0[j]; d < this.zoneSub0[j] + this.zoneSubN[j]; d++) {
            if (!(destW[d] > 0)) continue;   // 인구 없는 소구역 (0 × 무한대 방지)
            wsum += destW[d];
            let best = Infinity;
            for (let k = d * R; k < d * R + R; k++) {
              if (this.subRoadNode[k] < 0) break;
              best = Math.min(best, rd[this.subRoadNode[k]] + this.subRoadAcc[k]);
            }
            c += destW[d] * best;
          }
          croad[j] = wsum > 0 ? c / wsum : Infinity;
        }

        nodeDemand.fill(0);
        for (let j = 0; j < Z; j++) {
          const km = kmBetween(this.cx[i], this.cy[i], this.cx[j], this.cy[j]) * 1.25;
          const bc = this.borderCost(i, j, integration);
          const gr = croad[j] + (km * P.carCostPerKm) / P.vot + bc + carPen;
          let hsrShare = 0;
          for (let k = pickOff[j]; k < pickOff[j + 1]; k += 3) {
            if (this.stationHsr[pick[k]] && this.stationHsr[pick[k + 1]]) hsrShare += pick[k + 2];
          }
          // 고속철 운임 차이는 경로 비용(updateCosts)에 들어 있으므로 여기서는 일반철도 운임만 더한다
          const fare = P.railFarePerKm.conv;
          const kpShare = (this.isKP[i] + this.isKP[j]) / 2;
          // 고속철도 몫(hsrShare)에는 따로 보정한 고속철 상수를 더한다 (일반철도와 고속철도 이용을 함께 맞추려고)
          const gt = crail[j] + (km * fare) / P.vot + this.railASC * (1 - kpShare * (1 - P.kpRailASCFactor)) + this.hsrASC * hsrShare + bc;
          const tfare = P.transitBaseFare + Math.max(0, km - 10) * P.transitFarePerKm;
          const gu = ctr[j] + tfare / P.vot + this.transitASC + bc;
          const air = airC[j];
          if (!air) { compAcc[j] += share * gr; continue; }
          const afare = (P.airBaseFare + km * P.airFarePerKm) * (air.intl ? P.airIntlFareFactor : 1);
          const ga = air.cost + afare / P.vot + P.airASC + bc;
          const eR = Math.exp(-lam * gr), eT = isFinite(gt) ? Math.exp(-lam * gt) : 0, eU = isFinite(gu) ? Math.exp(-lam * gu) : 0;
          const eA = isFinite(ga) ? Math.exp(-lam * ga) : 0;
          const sum = eR + eT + eU + eA;
          const comp = sum > 0 ? -Math.log(sum) / lam : gr;
          compAcc[j] += share * comp;
          if (!(sum > 0)) continue;
          // 북측 안 통행: 자동차·도로 사정으로 일반화비용이 크게 잡히지만 실제로는 철도로 다니므로 마찰을 덜 친다
          const imp = this.isKP[i] && this.isKP[j] && !this.isExt[i] && !this.isExt[j] ? comp * P.kpGravityImpedance : comp;
          const gravity = this.K * mass[i] * share / (imp + P.gravityOffsetMin) ** P.gravityPower;
          // 국외에서 오는 관광(입국)은 국외 존의 통행 발생 축소를 되돌려 따로 키운다
          const inbound = this.isExt[i] && !this.isExt[j] ? P.inboundTourism : 1;
          const T = gravity * (mass[j] + tmass[j] * inbound);
          const tRail = T * eT / sum, tTr = T * eU / sum, tAir = T * eA / sum, tRoad = T - tRail - tTr - tAir;
          if (it === iters) {
            // 사업 평가용 OD별 통행량과 시간 비용 (합성 일반화비용에서 운임·유류비 같은 돈 몫을 뺀 것, 분)
            const money = (eR * km * P.carCostPerKm + eT * km * fare + eU * tfare + eA * afare) / sum / P.vot;
            tAcc[j] += T; timeAcc[j] += share * (comp - money);
            totals.vkt = (totals.vkt || 0) + (tRoad / P.personsPerCar) * km * (1 + P.freightPCUShare);
          }
          if (tAir > 0) airOD[air.a * A + air.b] += tAir;
          // 운항하지 않는 노선이 열렸다면 생겼을 수요 (자동 취항 판단용)
          if (air.pa >= 0 && air.pot < air.cost - 5) {
            const pfare = (P.airBaseFare + km * P.airFarePerKm) * (air.pIntl ? P.airIntlFareFactor : 1);
            const eP = Math.exp(-lam * (air.pot + pfare / P.vot + P.airASC + bc));
            latentOD[air.pa * A + air.pb] += T * eP / (sum - eA + eP);
          }
          if (it === iters) {
            totals.trips += T; totals.rail += tRail; totals.road += tRoad; totals.transit += tTr; totals.air += tAir;
            totals.tour = (totals.tour || 0) + gravity * tmass[j] * inbound;
            if (inbound > 1) totals.tourIn = (totals.tourIn || 0) + gravity * tmass[j] * inbound;
            if (this.isExt[j] && !this.isExt[i]) totals.tourOut = (totals.tourOut || 0) + gravity * tmass[j];
            if (tmass[j] > 0) (totals.tourDest ||= {})[j] = (totals.tourDest[j] || 0) + gravity * tmass[j] * inbound;
            if (this.isExt[i] || this.isExt[j]) totals.intl += T;
            totals.vhm += tRoad * croad[j];
            if (this.isKP[i] !== this.isKP[j]) totals.kpkr += T;
            if (!this.isKP[i] && !this.isKP[j]) { totals.krTrips += T; totals.krTransit += tTr; }
          }
          const pcu = tRoad / P.personsPerCar * (1 + P.freightPCUShare);
          for (let d = this.zoneSub0[j] * R; d < (this.zoneSub0[j] + this.zoneSubN[j]) * R; d++) {
            if (this.subRoadNode[d] >= 0) nodeDemand[this.subRoadNode[d]] += pcu * destW[(d / R) | 0] * this.subRoadW[d];
          }
          if (tRail > 0) {
            for (let k = pickOff[j]; k < pickOff[j + 1]; k += 3) stOD[pick[k] * NS + pick[k + 1]] += tRail * pick[k + 2];
          }
          if (tTr > 0) {
            for (let d = this.zoneSub0[j]; d < this.zoneSub0[j] + this.zoneSubN[j]; d++) {
              if (egress[d] >= 0) tDemand[egress[d]] += tTr * destW[d];
            }
          }
        }
        this.road.loadTree(nodeDemand, aux);
      }
      for (let j = 0; j < Z; j++) this.ccomp[i * Z + j] = i === j ? 15 : compAcc[j];
      if (it === iters) for (let j = 0; j < Z; j++) { odT[i * Z + j] = tAcc[j]; odTime[i * Z + j] = i === j ? 0 : timeAcc[j]; }
      // 대중교통 그래프는 위에서 구한 최단경로 트리를 그대로 들고 있다
      auxT.fill(0);
      this.transit.loadTree(tDemand, auxT);
      for (const l of this.metroLinks) aux[l] += auxT[l];
      done++;
      if (progress && done % 25 === 0) progress(((it - 1) + 0.9 * done / zoneList.length) / iters);
    }
  }

  /**
   * 효과 미리보기용 평가: 지금 교통량을 그대로 둔 채 수단분담·경로를 다시 구한다 (passes번).
   * free에 표시한 구간(새로 놓거나 바꾼 구간·운행 계통)만 반복마다 교통량을 섞고, 나머지는 지금 값에 고정한다.
   * 망 전체를 다시 배정하면 사업 효과보다 큰 배정 잡음이 끼므로, 대조(지금)와 처리(완공 뒤)를 같은 고정 상태에서 견준다.
   * @param {{size:number, run:Function}|null} pool 보조 워커 묶음 (없으면 이 워커만)
   * @param {Uint8Array} free 교통량을 다시 정할 구간: 1 = 지금 교통량에서 천천히 섞는다(1/4, 1/5 …), 2 = 새 구간이라 바로 섞는다(1, 1/2 …)
   */
  async evaluate(pool, integration, passes, free, progress) {
    const run = this.startAssign(integration, false, null);
    run.iters = passes;
    const parts = pool ? pool.size + 1 : 1;
    for (let it = 1; it <= passes; it++) {
      const pending = pool ? pool.run((k) => ({
        type: 'origins', it, iters: passes, integration, part: k + 1, parts,
        volume: this.volume, stationWait: this.stationWait, airOD: this.airOD,
      })) : null;
      this.beginIteration(run);
      const mine = [];
      for (let i = 0; i < this.Z; i += parts) mine.push(i);
      this.originPass(run, it, mine, progress);
      if (pending) for (const r of await pending) this.mergeOrigins(run, r, it);
      this.loadRail(run);
      // 바뀐 구간만 섞는다: 새 구간은 바로, 주변 구간은 해마다 배정처럼 천천히 (한 번의 전량 배정으로 한곳에 몰리지 않게)
      for (let l = 0; l < run.aux.length; l++) if (free[l]) this.volume[l] += (run.aux[l] - this.volume[l]) / (free[l] === 2 ? it : it + P.warmMsaOffset);
    }
    this.updateCosts();
    this.odT = run.odT; this.odTime = run.odTime;
    this.evalAux = run.aux;   // 마지막 번 전량 배정 (대조·처리를 같은 방식으로 견주는 구간 교통량)
    return run.totals;
  }

  /** 역 간 수요를 출발역별 최단경로 트리로 철도망에 싣고, 운행 계통 이용을 밑 선로에도 더한다 */
  loadRail(run) {
    const L = this.net.links;
    const NS = this.stationNode.length;
    const { aux, stOD } = run;
    const nodeDemand = this.nodeDemandBuf;
    this.boardings.fill(0);
    for (let s = 0; s < NS; s++) {
      let row = 0;
      nodeDemand.fill(0);
      for (let t = 0; t < NS; t++) {
        const v = stOD[s * NS + t];
        if (v > 0) {
          nodeDemand[this.stationNode[t]] += v; row += v;
          this.boardings[t] += v;
        }
      }
      if (row === 0) continue;
      this.boardings[s] += row;
      this.rail.shortestPaths(this.stationNode[s], this.cost);
      this.rail.loadTree(nodeDemand, aux);
    }
    for (const v of this.virtual) for (const l of L[v].via) aux[l] += aux[v];
  }

  /** 반복 끝: 역 간 수요를 철도망에 싣고, 교통량·역 대기·항공 수요를 MSA로 섞는다 */
  endIteration(run, it) {
    const L = this.net.links;
    const NS = this.stationNode.length;
    const { aux, stOD, airOD, latentOD, offset, fresh, freshOffset } = run;
    const nodeDemand = this.nodeDemandBuf;
    // 철도: 출발역별 최단경로 트리에 역 간 수요를 싣는다
    this.boardings.fill(0);
    for (let s = 0; s < NS; s++) {
      let row = 0;
      nodeDemand.fill(0);
      for (let t = 0; t < NS; t++) {
        const v = stOD[s * NS + t];
        if (v > 0) {
          nodeDemand[this.stationNode[t]] += v; row += v;
          this.boardings[t] += v;
        }
      }
      if (row === 0) continue;
      this.boardings[s] += row;
      this.rail.shortestPaths(this.stationNode[s], this.cost);
      this.rail.loadTree(nodeDemand, aux);
    }
    // 운행 계통 이용객은 밑의 실제 선로도 함께 쓴다 (선로 용량 공유)
    for (const v of this.virtual) for (const l of L[v].via) aux[l] += aux[v];
    for (let l = 0; l < L.length; l++) this.volume[l] += (aux[l] - this.volume[l]) / (it + (fresh?.[l] ? freshOffset : offset));
    this.updateStationWaits(it + offset);
    for (let k = 0; k < airOD.length; k++) this.airOD[k] += (airOD[k] - this.airOD[k]) / (it + offset);
    this.latentOD.set(latentOD);
    this.airPaxFromOD();
  }

  tripMass() {
    const m = new Float64Array(this.Z);
    for (let i = 0; i < this.Z; i++) {
      const rel = this.income[i] > 0 ? this.income[i] / this.frontier : 1;
      const eff = this.isExt[i] ? (this.pop[i] - this.korean[i]) * P.extMassFactor + this.korean[i] * P.koreanDiasporaFactor : this.pop[i];
      m[i] = eff / 1e4 * rel ** P.propensityIncomeElasticity;
    }
    return m;
  }

  /**
   * 기준 연도 보정. OD 자료가 없으므로 남측 고속도로 평균 V/C, 남측 철도 상위 구간 V/C,
   * 남측 대중교통 분담률이 목표치에 맞도록 통행량 계수 K와 철도·대중교통 고유상수를 번갈아 맞춘다.
   */
  calibrateK(integration, progress) {
    this.K = 1;
    const saved = P.msaIterations;
    P.msaIterations = 1;
    for (let it = 0; it < P.calibrationRounds; it++) {
      this.volume.fill(0);
      const t = this.assign(integration);
      this.transitASC += P.transitASCStep * Math.log((t.krTransit / t.krTrips) / P.targetKrTransitShare);
      const road = this.meanVC((l) => l.mode === 0 && l.cls === 'motorway');
      // 철도는 일반철도와 고속철도를 따로 맞춘다: 한 상수로 맞추면 포화된 경부고속선에 끌려 일반철도 수요가 너무 낮아진다
      const conv = this.quantileVC((l) => l.mode === 1 && l.cls === 'conv' && !l.via && !l.ext, P.railCalibQuantile);
      const hsr = this.quantileVC((l) => l.mode === 1 && l.cls === 'hsr' && !l.via && !l.ext, P.railCalibQuantile);
      if (!isFinite(road) || !isFinite(conv) || !isFinite(hsr)) break;
      this.K *= P.targetKrMotorwayVC / road;
      const scale = P.targetKrMotorwayVC / road;
      const dConv = P.railASCStep * Math.log(conv * scale / P.targetKrConvVC);
      this.railASC += dConv;
      // 고속철 상수는 일반철도 상수가 바뀐 만큼을 되돌린 뒤 고속철 혼잡에 맞춘다
      this.hsrASC += -dConv + P.railASCStep * Math.log(hsr * scale / P.targetKrRailVC);
      if (progress) progress((it + 1) / P.calibrationRounds);
    }
    P.msaIterations = saved;
    this.volume.fill(0);
  }

  /** 남측 활성 링크의 연장 가중 V/C 분위수 */
  quantileVC(pred, q) {
    const L = this.net.links, rows = [];
    let total = 0;
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (l.kp || !l.active || !pred(l) || !this.capacity[i]) continue;
      rows.push([this.volume[i] / this.capacity[i], l.len]);
      total += l.len;
    }
    rows.sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [v, len] of rows) { acc += len; if (acc >= q * total) return v; }
    return rows.length ? rows[rows.length - 1][0] : 1;
  }

  /** 남측 활성 링크의 연장 가중 평균 V/C */
  meanVC(pred) {
    let num = 0, den = 0;
    const L = this.net.links;
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (l.kp || !l.active || !pred(l) || !this.capacity[i]) continue;
      num += (this.volume[i] / this.capacity[i]) * l.len;
      den += l.len;
    }
    return num / den;
  }

  // ------------------------------------------------------------ 접근성·경제

  computeAccess() {
    const { Z, ccomp, pop } = this;
    for (let i = 0; i < Z; i++) {
      let a = 0, best = Infinity;
      for (let j = 0; j < Z; j++) {
        const c = ccomp[i * Z + j];
        a += pop[j] * Math.exp(-c / P.accessDecayMin);
        if (pop[j] >= P.majorCenterPop && c < best) best = c;
      }
      this.access[i] = a;
      this.healthAccess[i] = Math.exp(-best / P.healthDecayMin);
    }
  }

  incomeTarget(i) {
    const rel = Math.min(Math.max((this.access[i] / this.accessRef) ** P.accessIncomeElasticity, 0.6), 1.6);
    return this.frontier * rel;
  }

  leTarget(i) {
    return 60 + 12 * incomeIndex(this.income[i]) + 12 * this.healthAccess[i];
  }

  /**
   * 보정 전에 쓸 임시 소득. 소득이 0이면 모든 지역에 '자동차 없는 지역' 불편이 붙어
   * 철도·대중교통 상수가 잘못 보정된다 (남측 승용차가 갑자기 늘어나는 원인이었다).
   */
  provisionalIncome() {
    for (let i = 0; i < this.Z; i++) {
      this.income[i] = this.isExt[i] ? this.extIncome[i] : this.isKP[i] ? P.incomeKP : P.incomeKR;
    }
  }

  /** 초기 상태: 접근성에 맞춰 소득·건강·교육을 정하고 인구이동 균형을 맞춘다 */
  initEconomy() {
    const { Z } = this;
    this.computeAccess();
    const kr = [], kp = [];
    for (let i = 0; i < Z; i++) if (!this.isExt[i]) (this.isKP[i] ? kp : kr).push(this.access[i]);
    this.accessRef = median(kr);
    const kpRef = median(kp);
    for (let i = 0; i < Z; i++) {
      if (this.isExt[i]) {
        this.income[i] = this.extIncome[i];
      } else if (this.isKP[i]) {
        const rel = Math.min(Math.max((this.access[i] / kpRef) ** P.accessIncomeElasticity, 0.6), 1.6);
        this.income[i] = P.incomeKP * rel;
      } else {
        this.income[i] = this.incomeTarget(i);
      }
      this.le[i] = this.leTarget(i);
      this.eys[i] = 6 + 10.5 * incomeIndex(this.income[i]);
      this.mys[i] = 7 + 6 * incomeIndex(this.income[i]);
      this.hdi[i] = hdiOf(this.le[i], this.mys[i], this.eys[i], this.income[i]);
    }
    this.calibrateAmenity(0, 'closed');
    this.calibrateSubAmenity();
  }

  utility(i) {
    const dens = this.pop[i] / this.area[i];
    return Math.log(this.income[i]) + P.migAccessWeight * Math.log(this.access[i] / this.accessRef + 1e-6)
      - P.migDensityElasticity * Math.log(dens + 1) + this.amenity[i];
  }

  /** 존별 인구이동 흐름. 반환: 존별 순유입 */
  migrationFlows(integration, policy) {
    const { Z, ccomp } = this;
    const U = new Float64Array(Z);
    let ubar = 0, ptot = 0;
    for (let i = 0; i < Z; i++) {
      U[i] = this.utility(i);
      if (!this.isExt[i]) { ubar += U[i] * this.pop[i]; ptot += this.pop[i]; }
    }
    ubar /= ptot;
    const attract = new Float64Array(Z);
    for (let j = 0; j < Z; j++) attract[j] = this.isExt[j] ? 0 : this.pop[j] * Math.exp(U[j] - ubar);
    const net = new Float64Array(Z);
    const inflow = new Float64Array(Z);
    let kpToKr = 0, krToKp = 0;
    const policyFactor = P.migPolicyKPtoKR[policy] ?? 1;
    const w = new Float64Array(Z);
    for (let i = 0; i < Z; i++) {
      if (this.isExt[i]) continue;
      const rate = Math.min(Math.max(P.baseOutMigration * Math.exp(-P.migUtilSensitivity * (U[i] - ubar)), 0.01), 0.15);
      const out = this.pop[i] * rate;
      let s = 0;
      for (let j = 0; j < Z; j++) {
        if (j === i) { w[j] = 0; continue; }
        let x = attract[j] * Math.exp(-ccomp[i * Z + j] / P.migDistanceMin);
        if (this.isKP[i] && !this.isKP[j]) x *= policyFactor;
        w[j] = x; s += x;
      }
      if (s <= 0) continue;
      for (let j = 0; j < Z; j++) {
        if (w[j] === 0) continue;
        const f = out * w[j] / s;
        net[i] -= f; net[j] += f; inflow[j] += f;
        if (this.isKP[i] && !this.isKP[j]) kpToKr += f;
        else if (!this.isKP[i] && this.isKP[j]) krToKp += f;
      }
    }
    return { net, inflow, kpToKr, krToKp };
  }

  /** 기준 연도에 순이동이 0에 가깝도록 존별 어메니티를 맞춘다 (관측되지 않은 지역 매력도) */
  calibrateAmenity(integration, policy) {
    for (let k = 0; k < 30; k++) {
      const { net } = this.migrationFlows(integration, policy);
      let maxRel = 0;
      for (let i = 0; i < this.Z; i++) {
        if (this.isExt[i]) continue;
        const rel = net[i] / this.pop[i];
        maxRel = Math.max(maxRel, Math.abs(rel));
        this.amenity[i] += -0.5 * rel / P.baseOutMigration;
      }
      if (maxRel < 1e-4) break;
    }
  }

  /** 1년 진행: 소득 수렴, 건강·교육, 인구이동, 자연증감 */
  advanceYear(integration, policy, sez = []) {
    const { Z } = this;
    this.computeAccess();
    this.frontier *= 1 + P.frontierGrowth;
    // 경제특구: 투자가 몰려 소득이 빨리 따라잡고(수렴 속도 ×1.8, 목표 +15%), 일자리를 찾아 사람이 모인다(편의 +)
    const special = new Set(sez);
    for (let i = 0; i < Z; i++) {
      if (this.isExt[i]) continue;
      const sz = special.has(i);
      const target = this.incomeTarget(i) * (sz ? 1.15 : 1);
      if (sz) this.amenity[i] += 0.02;
      const r = (this.isKP[i]
        ? P.convergenceKPBase + P.convergenceKPIntegrated * integration
        : P.convergenceKR) * (sz ? 1.8 : 1);
      this.income[i] = Math.exp(Math.log(this.income[i]) + r * (Math.log(target) - Math.log(this.income[i])));
      this.le[i] += 0.08 * (this.leTarget(i) - this.le[i]);
      const ii = incomeIndex(this.income[i]);
      this.eys[i] += 0.05 * (6 + 10.5 * ii - this.eys[i]);
      this.mys[i] += 0.02 * (7 + 6 * ii - this.mys[i]);
      this.hdi[i] = hdiOf(this.le[i], this.mys[i], this.eys[i], this.income[i]);
    }
    const mig = this.migrationFlows(integration, policy);
    // 한 해 순이동이 어느 존에서도 maxNetMigration을 넘지 않도록 전체 흐름을 줄인다 (이사 수요의 물리적 한계)
    let peak = 0;
    for (let i = 0; i < Z; i++) if (!this.isExt[i]) peak = Math.max(peak, Math.abs(mig.net[i]) / this.pop[i]);
    const scale = Math.min(1, P.maxNetMigration / (peak || 1));
    for (const k of ['net']) for (let i = 0; i < Z; i++) mig[k][i] *= scale;
    mig.kpToKr *= scale; mig.krToKp *= scale;
    for (let i = 0; i < Z; i++) {
      if (this.isExt[i]) continue;
      const g = this.isKP[i] ? P.naturalGrowth.KP : P.naturalGrowth.KR;
      this.pop[i] = Math.max(100, this.pop[i] * (1 + g) + mig.net[i]);
    }
    this.lastMigration = { kpToKr: mig.kpToKr, krToKp: mig.krToKp, net: mig.net };
    this.relocateWithinZones();
  }

  /**
   * 역세권 개발로 들어오는 인구: 같은 쪽(남·북)의 다른 존에서 인구 비례로 옮겨 오고, 존 안에서는 역에 가장 가까운 소구역에 산다
   * @param {{zone:number, lon:number, lat:number, persons:number}[]} list
   */
  applyDevelopments(list) {
    for (const d of list) {
      const z = d.zone;
      if (!(z >= 0) || this.isExt[z] || !(d.persons > 0)) continue;
      let tot = 0;
      for (let i = 0; i < this.Z; i++) if (i !== z && !this.isExt[i] && this.isKP[i] === this.isKP[z]) tot += this.pop[i];
      if (!(tot > 0)) continue;
      // net: 입주 인구 가운데 전국 인구가 새로 느는 몫 (택지지구). 나머지만 같은 쪽 다른 존에서 인구 비례로 옮겨 온다
      const moved = d.persons * (1 - Math.max(0, Math.min(1, d.net || 0)));
      for (let i = 0; i < this.Z; i++) if (i !== z && !this.isExt[i] && this.isKP[i] === this.isKP[z]) this.pop[i] -= (moved * this.pop[i]) / tot;
      const s0 = this.zoneSub0[z], n = this.zoneSubN[z];
      let best = s0, bd = Infinity;
      for (let s = s0; s < s0 + n; s++) {
        const dd = (this.subX[s] - d.lon) ** 2 + (this.subY[s] - d.lat) ** 2;
        if (dd < bd) { bd = dd; best = s; }
      }
      const old = this.pop[z], now = old + d.persons;
      for (let s = s0; s < s0 + n; s++) this.subW[s] *= old / now;
      this.subW[best] += d.persons / now;
      this.pop[z] = now;
    }
  }

  // ------------------------------------------------------------ 결과

  linkResults() {
    const n = this.nPhys ?? this.net.links.length;
    const vol = new Float32Array(n), vc = new Float32Array(n), speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      vol[i] = this.volume[i] + (this.metroLocal?.[i] || 0);
      vc[i] = this.capacity[i] > 0 ? vol[i] / this.capacity[i] : 0;
      speed[i] = this.cost[i] > 0 ? this.net.links[i].len / (this.cost[i] / 60) : 0;
    }
    // 운행 계통 구간별 이용객 (가상 링크 순서 그대로)
    const svcVol = Float32Array.from(this.virtual || [], (i) => this.volume[i]);
    return { vol, vc, speed, svcVol };
  }

  zoneResults() {
    return {
      pop: Float64Array.from(this.pop), income: Float64Array.from(this.income),
      hdi: Float64Array.from(this.hdi), le: Float64Array.from(this.le),
      access: Float64Array.from(this.access), station: this.primaryStations(),
      netMig: this.lastMigration.net ? Float64Array.from(this.lastMigration.net) : new Float64Array(this.Z),
    };
  }

  /** 소구역(읍면동) 인구와 대중교통·철도 접근시간 */
  subResults() {
    const S = this.S;
    const pop = new Float64Array(S), transit = new Float32Array(S), rail = new Float32Array(S);
    for (let s = 0; s < S; s++) {
      pop[s] = this.subW[s] * this.pop[this.subZone[s]];
      transit[s] = this.subTransitAccess(s);
      rail[s] = this.subRailAccess(s);
    }
    return { pop, transit, rail };
  }

  // ------------------------------------------------------------ 소구역 인구 이동

  /** 가장 가까운 대중교통(도시철도역 또는 버스) 접근 + 대기 (분) */
  subTransitAccess(s) {
    const R = P.roadConnectors, M = P.metroCandidates;
    let best = Infinity;
    for (let k = s * R; k < s * R + R; k++) {
      if (this.subRoadNode[k] >= 0) best = Math.min(best, this.subRoadAcc[k] * P.busAccessFactor + P.busWaitMin);
    }
    if (this.subMetro[s * M] >= 0) best = Math.min(best, this.subMetroAcc[s * M] + P.metroWaitMin);
    return best;
  }

  /** 지역 간 철도역 접근 + 대기 (분), 역이 없으면 120분으로 본다 */
  subRailAccess(s) {
    const K = P.stationCandidates;
    let best = 120;
    for (let k = s * K; k < s * K + K; k++) {
      const st = this.subSt[k];
      if (st < 0) break;
      best = Math.min(best, this.subStAcc[k] + this.stationWait[st]);
    }
    return best;
  }

  /** 어메니티를 뺀 소구역 효용: 교통 접근이 좋을수록, 밀도가 낮을수록 높다 */
  subUtility(s) {
    const dens = this.subW[s] * this.pop[this.subZone[s]] / this.subArea[s];
    // 접근이 아예 없는 곳도 유한한 값으로 둔다 (−∞ + ∞ = NaN 방지)
    return -P.subTransitWeight * Math.min(this.subTransitAccess(s), 120) - P.subRailWeight * this.subRailAccess(s)
      - P.subDensityElasticity * Math.log(dens + 1);
  }

  /** 기준 연도 인구 분포가 균형이 되도록 소구역 어메니티를 맞춘다 */
  calibrateSubAmenity() {
    for (let s = 0; s < this.S; s++) {
      this.subAmenity[s] = Math.log(Math.max(this.subW[s], 1e-6)) - Math.log(this.subArea[s]) - this.subUtility(s);
    }
    this.subAmenityReady = true;
  }

  /** 존 안에서 해마다 일부 주민이 더 나은 소구역으로 옮겨 간다 */
  relocateWithinZones() {
    if (!this.subAmenityReady) this.calibrateSubAmenity();
    const r = P.subRelocationRate;
    for (let z = 0; z < this.Z; z++) {
      const a = this.zoneSub0[z], n = this.zoneSubN[z];
      if (n < 2) continue;
      let sum = 0;
      const t = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const s = a + k;
        t[k] = this.subArea[s] * Math.exp(this.subUtility(s) + this.subAmenity[s]);
        sum += t[k];
      }
      if (!(sum > 0) || !isFinite(sum)) continue;
      for (let k = 0; k < n; k++) this.subW[a + k] += r * (t[k] / sum - this.subW[a + k]);
    }
  }

  // ------------------------------------------------------------ 항공

  /**
   * 운영 중인 공항·노선과 존별 이용 공항(가까운 2곳)을 정한다.
   * - net.airRoutes: 운항 중인 노선 [{a, b, freq}] (공항 id, 하루 왕복 운항 횟수)
   * - 운항하지 않는 노선 가운데 규칙상 가능한 쌍은 '잠재 노선'으로 두고, 열렸다면 생겼을 수요를 따로 센다.
   * 공항 접근은 직선거리 ×1.3을 시속 50km로 가고, 수속·보안검색 시간을 더한다.
   */
  buildAir() {
    const ap = (this.net.airports || []).filter((a) => a.active !== false);
    this.airports = ap;
    const A = ap.length;
    const idx = new Map(ap.map((a, k) => [a.id, k]));
    this.airCap = Float64Array.from(ap, (a) => (a.cap * 1e6) / 365);   // 하루 여객 (출발+도착)
    this.airPenalty = this.airPenalty?.length === A ? this.airPenalty : new Float64Array(A);
    if (!this.airOD || this.airOD.length !== A * A) this.airOD = new Float64Array(A * A);
    this.latentOD = new Float64Array(A * A);
    this.airPax = new Float64Array(A);
    this.flight = new Float64Array(A * A).fill(Infinity);      // 운항 노선
    this.potFlight = new Float64Array(A * A).fill(Infinity);   // 잠재 노선
    this.routeFreq = new Float64Array(A * A);
    if (!this.routePenalty || this.routePenalty.length !== A * A) this.routePenalty = new Float64Array(A * A);
    const time = (a, b) => P.airTaxiMin + (kmBetween(ap[a].lon, ap[a].lat, ap[b].lon, ap[b].lat) / P.airSpeedKmh) * 60;
    for (const r of this.net.airRoutes || []) {
      const a = idx.get(r.a), b = idx.get(r.b);
      if (a == null || b == null || !(r.freq > 0)) continue;
      for (const [x, y] of [[a, b], [b, a]]) {
        this.routeFreq[x * A + y] = r.freq;
        // 운항이 잦을수록 원하는 시각에 가까운 편이 있다 (스케줄 지체)
        this.flight[x * A + y] = time(x, y) + Math.min(P.airScheduleMaxMin, P.airScheduleBase / r.freq);
      }
    }
    const banned = new Set(this.net.airBanned || []);
    for (let a = 0; a < A; a++) {
      for (let b = 0; b < A; b++) {
        if (a === b || isFinite(this.flight[a * A + b])) continue;
        const km = kmBetween(ap[a].lon, ap[a].lat, ap[b].lon, ap[b].lat);
        const intl = ap[a].country !== ap[b].country && (ap[a].ext || ap[b].ext);
        if (km < P.airMinKm || (ap[a].ext && ap[b].ext)) continue;
        if (intl && !(ap[a].intl && ap[b].intl)) continue;
        if (banned.has(routeKey(ap[a].id, ap[b].id))) continue;
        // 새로 열린 노선은 하루 2회쯤에서 시작한다고 본다
        this.potFlight[a * A + b] = time(a, b) + Math.min(P.airScheduleMaxMin, P.airScheduleBase / 2);
      }
    }
    const Z = this.Z;
    this.zoneAir = new Int32Array(Z * 2).fill(-1);
    this.zoneAirAcc = new Float64Array(Z * 2);
    for (let z = 0; z < Z; z++) {
      const near = ap.map((a, k) => [k, kmBetween(this.cx[z], this.cy[z], a.lon, a.lat)])
        .filter(([k, d]) => d <= P.airAccessMaxKm && (!this.isExt[z] || ap[k].ext))
        .sort((x, y) => x[1] - y[1]).slice(0, 2);
      near.forEach(([k, d], n) => {
        this.zoneAir[z * 2 + n] = k;
        const road = (d * P.accessDetour / P.airAccessSpeedKmh) * 60;
        // 공항역이 있으면 철도로 가는 편이 빠른 존은 철도로 간다 (공항철도를 놓으면 공항 수요가 는다)
        const rail = this.airRailAccess(k, z);
        this.zoneAirAcc[z * 2 + n] = Math.min(road, rail) + P.airTerminalMin;
      });
    }
  }
  /**
   * 공항역(공항에서 airportRailKm 안의 철도·도시철도역)마다 모든 노드까지의 철도 시간을 구해 둔다.
   * 존에서는 소구역마다 가까운 역(일반·도시철도)까지 접근 + 기다림 + 공항역까지 + 걸어서 터미널
   */
  airRailAccess(k, z) {
    if (!this.airRail) this.prepareAirRail();
    const r = this.airRail[k];
    if (!r) return Infinity;
    const K = P.stationCandidates, M = P.metroCandidates;
    let sum = 0, wsum = 0;
    for (let s = this.zoneSub0[z]; s < this.zoneSub0[z] + this.zoneSubN[z]; s++) {
      if (!(this.subW[s] > 0)) continue;
      let best = Infinity;
      if (r.rail) for (let a = 0; a < K; a++) {
        const st = this.subSt[s * K + a];
        if (st < 0) break;
        // 기다림은 역 종류별 기본값: 망을 놓을 때의 역 대기(해마다·워커마다 다르다)에 따라 공항 접근이 달라지지 않게
        const wait = this.stationHsr[st] ? P.railWaitMin.hsr : this.stationKP[st] ? P.railWaitMin.kpConv : P.railWaitMin.conv;
        best = Math.min(best, this.subStAcc[s * K + a] + wait + r.rail[this.stationNode[st]]);
      }
      if (r.metro) for (let a = 0; a < M; a++) {
        const nd = this.subMetro[s * M + a];
        if (nd < 0) break;
        best = Math.min(best, this.subMetroAcc[s * M + a] + P.metroWaitMin + r.metro[nd]);
      }
      if (!isFinite(best)) return Infinity;   // 철도로 못 가는 소구역이 있으면 그 존은 도로로 간다
      sum += this.subW[s] * best; wsum += this.subW[s];
    }
    return wsum > 0 ? sum / wsum + P.airRailWalkMin : Infinity;
  }

  prepareAirRail() {
    const nodes = this.net.nodes, L = this.net.links;
    const railNodes = new Set(), metroNodes = new Set();
    for (const l of L) {
      if (!l.active || l.via) continue;
      if (l.mode === 1 && !l.ext) { railNodes.add(l.a); railNodes.add(l.b); }
      if (l.mode === 2) { metroNodes.add(l.a); metroNodes.add(l.b); }
    }
    const stations = new Set(this.net.stations);
    const nearest = (set, ap) => {
      let best = -1, bd = P.airportRailKm;
      for (const nd of set) {
        if (!stations.has(nd)) continue;
        const d = kmBetween(ap.lon, ap.lat, nodes[nd][0], nodes[nd][1]);
        if (d < bd) { bd = d; best = nd; }
      }
      return best;
    };
    this.airRail = this.airports.map((ap) => {
      if (ap.ext) return null;
      const rs = nearest(railNodes, ap), ms = nearest(metroNodes, ap);
      if (rs < 0 && ms < 0) return null;
      const out = { station: rs >= 0 ? rs : ms };
      if (rs >= 0) { this.rail.shortestPaths(rs, this.freeTime); out.rail = Float32Array.from(this.rail.dist); }
      if (ms >= 0) { this.metroG.shortestPaths(ms, this.freeTime); out.metro = Float32Array.from(this.metroG.dist); }
      return out;
    });
  }

  /** 공항마다 공항역 노드 (없으면 -1): 화면 표시용 */
  airportStations() {
    if (!this.airRail) this.prepareAirRail();
    return this.airRail.map((r) => (r ? r.station : -1));
  }


  /** 존 i→j 항공 일반화 시간 (분): 운항 노선 기준과, 잠재 노선까지 열렸을 때 기준 */
  airCost(i, j) {
    const A = this.airports.length;
    let best = Infinity, ba = -1, bb = -1, pot = Infinity, pa = -1, pb = -1;
    for (let p = 0; p < 2; p++) {
      const a = this.zoneAir[i * 2 + p];
      if (a < 0) break;
      for (let q = 0; q < 2; q++) {
        const b = this.zoneAir[j * 2 + q];
        if (b < 0) break;
        const ground = this.zoneAirAcc[i * 2 + p] + this.zoneAirAcc[j * 2 + q] + this.airPenalty[a] + this.airPenalty[b];
        const c = ground + this.flight[a * A + b] + this.routePenalty[a * A + b];
        if (c < best) { best = c; ba = a; bb = b; }
        const c2 = ground + this.potFlight[a * A + b];
        if (c2 < pot) { pot = c2; pa = a; pb = b; }
      }
    }
    const intl = ba >= 0 && this.airports[ba].country !== this.airports[bb].country;
    const pIntl = pa >= 0 && this.airports[pa].country !== this.airports[pb].country;
    return { cost: best, a: ba, b: bb, intl, pot, pa, pb, pIntl };
  }

  /** 공항·노선별 여객과 혼잡 지체 (공항 용량, 노선 좌석을 넘으면 지체가 늘어난다) */
  airPaxFromOD() {
    const A = this.airports.length;
    this.airPax.fill(0);
    for (let a = 0; a < A; a++) {
      for (let b = 0; b < A; b++) {
        const v = this.airOD[a * A + b];
        if (v > 0) { this.airPax[a] += v; this.airPax[b] += v; }
      }
    }
    for (let a = 0; a < A; a++) {
      const vc = this.airPax[a] / this.airCap[a];
      this.airPenalty[a] = P.airCongestionMin * Math.max(0, vc - 1);
    }
    for (let k = 0; k < A * A; k++) {
      const f = this.routeFreq[k];
      const load = f > 0 ? this.airOD[k] / (f * P.airSeats) : 0;
      this.routePenalty[k] = P.airCongestionMin * Math.max(0, load - 1);
    }
  }

  airResults() {
    const A = this.airports.length;
    const routes = [], latent = [];
    for (let a = 0; a < A; a++) {
      for (let b = a + 1; b < A; b++) {
        const v = this.airOD[a * A + b] + this.airOD[b * A + a];
        const f = this.routeFreq[a * A + b];
        if (f > 0) routes.push([a, b, Math.round(v), f]);
        const l = this.latentOD[a * A + b] + this.latentOD[b * A + a];
        if (!(f > 0) && l >= 100) latent.push([a, b, Math.round(l)]);
      }
    }
    routes.sort((x, y) => y[2] - x[2]);
    latent.sort((x, y) => y[2] - x[2]);
    return {
      ids: this.airports.map((a) => a.id), pax: Float64Array.from(this.airPax), cap: Float64Array.from(this.airCap),
      routes, latent: latent.slice(0, 60), seats: P.airSeats, railStation: this.airportStations(),
    };
  }

  /**
   * 두 지점 사이 수단별 소요 시간 (현재 혼잡 반영). 승용차·철도는 지나는 링크도 돌려준다.
   * @returns {{car?:object, rail?:object, transit?:object, air?:object}}
   */
  routeQuery(from, to) {
    const nodes = this.net.nodes;
    const out = {};
    const crowKm = kmBetween(from[0], from[1], to[0], to[1]);
    out.crowKm = crowKm;
    const walk = (km) => (km * P.accessDetour / P.accessSpeedKmh) * 60;
    const pathLinks = (g, target) => {
      const links = [];
      let v = target;
      for (let guard = 0; guard < 100000 && g.predEdge[v] >= 0; guard++) {
        const e = g.predEdge[v];
        links.push(g.edgeLink[e]);
        v = g.edgeFrom[e];
      }
      return links;
    };
    // 승용차: 경로는 체감 비용으로 고르고, 시간은 실제 주행시간으로 센다
    const roadIdx = new SpatialIndex(nodes, this.roadNodeSet);
    const ra = roadIdx.nearest(from[0], from[1]), rb = roadIdx.nearest(to[0], to[1]);
    if (ra >= 0 && rb >= 0) {
      this.road.shortestPaths(ra, this.cost);
      if (isFinite(this.road.dist[rb])) {
        const links = pathLinks(this.road, rb);
        let min = 0, km = 0;
        for (const l of links) {
          min += this.cost[l] / (P.roadPerceived[this.net.links[l].cls] ?? 1);
          km += this.net.links[l].len;
        }
        min += walk(kmBetween(from[0], from[1], ...nodes[ra])) + walk(kmBetween(to[0], to[1], ...nodes[rb]));
        out.car = { min, km, links, cost: Math.round(km * P.carCostPerKm) };
      }
    }
    // 철도: 가까운 역 몇 곳씩 비교 (접근 + 대기 + 승차 + 도착 접근)
    const stIdx = new SpatialIndex(nodes, new Set(this.stationNode));
    const near = (p) => stIdx.within(p[0], p[1], P.stationRadiusKm)
      .map((nd) => [this.stationOf.get(nd), accessMinutes(kmBetween(p[0], p[1], ...nodes[nd]))])
      .sort((x, y) => x[1] - y[1]).slice(0, 4);
    const sa = near(from), sb = near(to);
    // 미리 계산한 기준 연도를 불러온 직후에는 역 간 행렬이 없으니 한 번 만든다
    if (sa.length && sb.length && (!this.stD || this.stD.length !== this.stationNode.length ** 2)) this.stationMatrix();
    if (sa.length && sb.length) {
      const NS = this.stationNode.length;
      let best = null;
      for (const [s, a] of sa) {
        for (const [t, b] of sb) {
          if (s === t) continue;
          const c = a + this.stationWait[s] + this.stD[s * NS + t] + b;
          if (isFinite(c) && (!best || c < best.min)) best = { min: c, s, t };
        }
      }
      // 경로 비용에는 고속선 운임 차이(분)가 들어 있으므로, 보여 주는 시간은 그것을 뺀 실제 시간이다
      const L = this.net.links;
      const premium = (l) => (L[l].mode === 1 && L[l].cls === 'hsr' && !L[l].via ? (L[l].len * (P.railFarePerKm.hsr - P.railFarePerKm.conv)) / P.vot : 0);
      const railTrip = (cost, pair, g, timeOnly = false) => {
        g.shortestPaths(this.stationNode[pair.s], cost);
        const raw = pathLinks(g, this.stationNode[pair.t]);
        const ride = raw.reduce((acc, l) => acc + cost[l] - (timeOnly ? 0 : premium(l)), 0);
        const links = raw.flatMap((l) => L[l].via || [l]);
        const km = links.reduce((acc, l) => acc + L[l].len, 0);
        const hsrKm = links.reduce((acc, l) => acc + (L[l].cls === 'hsr' ? L[l].len : 0), 0);
        const free = raw.reduce((acc, l) => acc + this.freeTime[l], 0);   // 혼잡 없이 달리는 시간 (검수용)
        const worst = raw.map((l) => [l, cost[l] - premium(l) - this.freeTime[l]]).sort((x, y) => y[1] - x[1]).slice(0, 3)
          .map(([l, d]) => `${L[l].name || l}${L[l].via ? '(계통)' : ''}:+${d.toFixed(0)}분 v/c ${(this.volume[l] / Math.max(1, this.capacity[l])).toFixed(2)}`);
        return { ...pair, min: pair.access + this.stationWait[pair.s] + ride + pair.egress, km, hsrKm, links, wait: this.stationWait[pair.s], free, worst,
          cost: Math.round(km * P.railFarePerKm.conv + hsrKm * (P.railFarePerKm.hsr - P.railFarePerKm.conv)) };
      };
      const pairOf = (b0) => b0 && { s: b0.s, t: b0.t, access: b0.a, egress: b0.b };
      let bestPair = null;
      for (const [s, a] of sa) for (const [t, b] of sb) {
        if (s === t) continue;
        const c = a + this.stationWait[s] + this.stD[s * NS + t] + b;
        if (isFinite(c) && (!bestPair || c < bestPair.c)) bestPair = { c, s, t, a, b };
      }
      if (best && bestPair) {
        out.rail = railTrip(this.cost, pairOf(bestPair), this.rail);
        // 시간만 따진 가장 빠른 철도 (경로 비용의 고속선 운임 몫을 뺀다): 운임이 싼 느린 길(일반선 고속화·광역급행)로 돌지 않는 시간
        const timeCost = Float64Array.from(this.cost, (c, l) => c - premium(l));
        out.railFast = railTrip(timeCost, pairOf(bestPair), this.rail, true);
      }
      // 일반철도만 (고속선을 타지 않고): 고속선 구간과 고속 계통을 막은 비용으로 다시 찾는다
      if (sa.length && sb.length) {
        const conv = Float64Array.from(this.cost, (c, l) => (L[l].mode === 1 && L[l].cls === 'hsr' ? Infinity : c));
        let bc = null;
        for (const [s, a] of sa) {
          this.rail.shortestPaths(this.stationNode[s], conv);
          for (const [t, b] of sb) {
            if (s === t) continue;
            const c = a + this.stationWait[s] + this.rail.dist[this.stationNode[t]] + b;
            if (isFinite(c) && (!bc || c < bc.c)) bc = { c, s, t, a, b };
          }
        }
        if (bc) {
          const r = railTrip(conv, pairOf(bc), this.rail);
          if (!out.rail || r.links.join() !== out.rail.links.join()) out.conv = r;
        }
      }
    }
    // 대중교통 (버스 + 도시철도)
    if (ra >= 0 && rb >= 0 && this.transit) {
      this.transit.shortestPaths(ra, this.costT);
      const d = this.transit.dist[rb];
      if (isFinite(d)) {
        // 경로: 버스(도로)와 도시철도 구간 (환승 가상 링크는 뺀다)
        const links = pathLinks(this.transit, rb).filter((l) => l < this.net.links.length);
        const metroKm = links.reduce((acc, l) => acc + (this.net.links[l].mode === 2 ? this.net.links[l].len : 0), 0);
        const busKm = links.reduce((acc, l) => acc + (this.net.links[l].mode === 0 ? this.net.links[l].len : 0), 0);
        out.transit = { min: d + P.busWaitMin + walk(kmBetween(from[0], from[1], ...nodes[ra])) * P.busAccessFactor
          + walk(kmBetween(to[0], to[1], ...nodes[rb])) * P.busAccessFactor, links, metroKm, busKm,
        cost: Math.round(P.transitBaseFare + Math.max(0, crowKm * 1.25 - 10) * P.transitFarePerKm) };
      }
    }
    // 항공: 가까운 공항 사이 운항 노선
    const ap = this.airports, A = ap.length;
    const nearAp = (p) => ap.map((x, k) => [k, kmBetween(p[0], p[1], x.lon, x.lat)]).filter(([, km]) => km < P.airAccessMaxKm)
      .sort((x, y) => x[1] - y[1]).slice(0, 3);
    let bestAir = null;
    for (const [a, da] of nearAp(from)) {
      for (const [b, db] of nearAp(to)) {
        const f = this.flight[a * A + b];
        if (!isFinite(f)) continue;
        const c = walk(da) * (P.accessSpeedKmh / P.airAccessSpeedKmh) + walk(db) * (P.accessSpeedKmh / P.airAccessSpeedKmh)
          + 2 * P.airTerminalMin + f + this.airPenalty[a] + this.airPenalty[b];
        if (!bestAir || c < bestAir.min) bestAir = { min: c, a: ap[a].id, b: ap[b].id, freq: this.routeFreq[a * A + b] };
      }
    }
    if (bestAir) out.air = { ...bestAir, cost: Math.round(P.airBaseFare + crowKm * P.airFarePerKm) };
    return out;
  }


  /** 존의 가장 큰 소구역이 주로 쓰는 역 (노드 id, 없으면 -1) */
  primaryStations() {
    const out = new Int32Array(this.Z).fill(-1);
    const K = P.stationCandidates;
    for (let z = 0; z < this.Z; z++) {
      let best = this.zoneSub0[z];
      for (let s = best; s < this.zoneSub0[z] + this.zoneSubN[z]; s++) if (this.subW[s] > this.subW[best]) best = s;
      const st = this.subSt[best * K];
      if (st >= 0) out[z] = this.stationNode[st];
    }
    return out;
  }

  /** 역 노드별 일 승하차 인원 */
  stationResults() {
    return { node: Int32Array.from(this.stationNode), riders: Float64Array.from(this.boardings) };
  }

  summary() {
    const s = { KR: { pop: 0, hdi: 0, income: 0 }, KP: { pop: 0, hdi: 0, income: 0 } };
    for (let i = 0; i < this.Z; i++) {
      if (this.isExt[i]) continue;
      const c = this.isKP[i] ? s.KP : s.KR;
      c.pop += this.pop[i];
      c.hdi += this.hdi[i] * this.pop[i];
      c.income += this.income[i] * this.pop[i];
    }
    for (const c of [s.KR, s.KP]) { c.hdi /= c.pop; c.income /= c.pop; }
    s.kpToKr = this.lastMigration.kpToKr;
    s.krToKp = this.lastMigration.krToKp;
    return s;
  }
}

/** 항공 노선 키 (방향 없이) */
export function routeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** 도로 접속 노드·도시철도역·철도역·고속철도역 구성이 같은지 알아보는 지문 (순서와 무관한 집합은 섞어 더한다) */
// 기준선에 함께 담는 역세권 배열: [이름, 형, 소구역당 개수(1 또는 R·M·K)]
const ACCESS_ARRAYS = [
  ['subRoadNode', Int32Array, 'R'], ['subRoadAcc', Float64Array, 'R'], ['subRoadW', Float64Array, 'R'], ['subRoadFar', Float64Array, 1],
  ['subMetro', Int32Array, 'M'], ['subMetroAcc', Float64Array, 'M'], ['subSt', Int32Array, 'K'], ['subStAcc', Float64Array, 'K'],
];

function accessSignature(road, rail, hsr, metro, stations, nNodes) {
  const mix = (set) => {
    let a = 0, b = 0;
    for (const v of set) { const h = Math.imul(v + 0x9e3779b9, 0x85ebca6b) >>> 0; a = (a + h) >>> 0; b ^= Math.imul(h, 0xc2b2ae35) >>> 0; }
    return `${set.size}:${a}:${b >>> 0}`;
  };
  let st = 0;
  for (const v of stations) st = (Math.imul(st, 31) + v) >>> 0;
  return [nNodes, mix(road), mix(rail), mix(hsr), mix(metro), stations.length, st].join('|');
}

export function kmBetween(x1, y1, x2, y2) {
  const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * Math.PI / 180), dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy) * KM_PER_DEG;   // Math.hypot보다 몇 배 빠르다 (시작·해마다 수백만 번 부른다)
}

export function incomeIndex(gni) {
  const v = (Math.log(gni) - Math.log(100)) / (Math.log(75000) - Math.log(100));
  return Math.min(Math.max(v, 0), 1);
}

// UNDP HDI: 건강·교육·소득 지수의 기하평균
export function hdiOf(le, mys, eys, gni) {
  const h = Math.min(Math.max((le - 20) / 65, 0), 1);
  const e = (Math.min(mys / 15, 1) + Math.min(eys / 18, 1)) / 2;
  return Math.cbrt(h * e * incomeIndex(gni));
}

/** 격자에서 역까지 접근시간(분): 걸어갈 만한 거리는 도보, 그보다 멀면 버스·승용차 연계 */
export function accessMinutes(km) {
  if (km <= P.walkMaxKm) return km * P.accessDetour / P.walkSpeedKmh * 60;
  return P.feederPenaltyMin + km * P.accessDetour / P.feederSpeedKmh * 60;
}

/** 노드 공간 색인 (0.05도 버킷) */
class SpatialIndex {
  constructor(nodes, ids) {
    this.nodes = nodes;
    this.cell = 0.05;
    this.map = new Map();
    for (const id of ids) {
      const [x, y] = nodes[id];
      const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
      let a = this.map.get(k);
      if (!a) this.map.set(k, a = []);
      a.push(id);
    }
  }

  key(i, j) { return i * 100000 + j; }

  within(x, y, km) {
    const r = Math.ceil(km / (KM_PER_DEG * this.cell * 0.78)) + 1;
    const ci = Math.floor(x / this.cell), cj = Math.floor(y / this.cell);
    const out = [];
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const a = this.map.get(this.key(i, j));
        if (!a) continue;
        for (const id of a) if (kmBetween(x, y, this.nodes[id][0], this.nodes[id][1]) <= km) out.push(id);
      }
    }
    return out;
  }

  nearestK(x, y, k) {
    for (let km = 5; km <= 640; km *= 2) {
      const c = this.within(x, y, km);
      if (c.length < k && km < 640) continue;
      return c.map((id) => [id, kmBetween(x, y, this.nodes[id][0], this.nodes[id][1])])
        .sort((a, b) => a[1] - b[1]).slice(0, k).map((x) => x[0]);
    }
    return [];
  }

  nearest(x, y) {
    for (let km = 5; km <= 640; km *= 2) {
      const c = this.within(x, y, km);
      if (!c.length) continue;
      let best = c[0], bd = Infinity;
      for (const id of c) {
        const d = kmBetween(x, y, this.nodes[id][0], this.nodes[id][1]);
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    }
    return -1;
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] || 1;
}

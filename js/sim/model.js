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
    return { json: { meta, sizes: { L, ZZ, NS, AA }, totals, snapshot: this.snapshot() }, bin: bin.buffer };
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
    const o = { K: this.K, railASC: this.railASC, transitASC: this.transitASC, accessRef: this.accessRef, frontier: this.frontier };
    for (const k of ['pop', 'income', 'le', 'mys', 'eys', 'hdi', 'amenity']) o[k] = Array.from(this[k]);
    o.subW = Array.from(this.subW, (v) => Math.round(v * 1e6) / 1e6);
    o.subAmenity = Array.from(this.subAmenity, (v) => Math.round(v * 1e4) / 1e4);
    o.waits = Array.from(this.stationNode, (nd, i) => [nd, Math.round(this.stationWait[i] * 10) / 10]);
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
    this.freeTime = new Float64Array(L.length);
    this.capacity = new Float64Array(L.length);
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
        this.freeTime[i] = Math.max(1, t - l.skip * P.railDwellMin);
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
          const [ax, ay] = net.nodes[l.a], [bx, by] = net.nodes[l.b];
          const d = this.densityAt((ax + bx) / 2, (ay + by) / 2);
          cap *= 1 + Math.min(P.urbanCapMax, Math.max(0, (d - P.urbanDensityFrom) / P.urbanDensityStep));
        }
        this.capacity[i] = cap;
      } else if (l.mode === 2) {
        this.freeTime[i] = (l.len / l.speed) * 60;
        this.capacity[i] = P.metroTrainsPerDay * P.metroPaxPerTrain * (l.tracks >= 3 ? 1.5 : 1);
      } else {
        const pen = l.power === 'AC' ? 1 : P.railNonACPenalty;
        // 양 끝이 역이면 정차 시간을 반씩 얹는다 (모든 역에 서는 열차 기준)
        const dwell = P.railDwellMin * ((stationSet.has(l.a) ? 0.5 : 0) + (stationSet.has(l.b) ? 0.5 : 0));
        this.freeTime[i] = (l.len / l.speed) * 60 * pen + dwell;
        this.capacity[i] = P.railTrainsPerDay[Math.min(l.tracks, 4)] * P.railPaxPerTrain[l.cls];
      }
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
      this.netSig = sig;
    } else {
      this.buildTransit();
    }
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
    const roadIdx = new SpatialIndex(net.nodes, this.roadNodeSet);
    const ta = [], tb = [];
    for (const st of this.metroStationNodes) {
      const nd = roadIdx.nearest(net.nodes[st][0], net.nodes[st][1]);
      if (nd >= 0) { ta.push(st); tb.push(nd); }
    }
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

  buildAccess() {
    const { net, S } = this;
    const nodes = net.nodes;
    const roadNodes = new Set(), railNodes = new Set(), hsrNodes = new Set();
    for (const l of net.links) {
      if (!l.active || l.mode === 2) continue;
      const set = l.mode === 0 ? roadNodes : railNodes;
      set.add(l.a); set.add(l.b);
      if (l.cls === 'hsr') { hsrNodes.add(l.a); hsrNodes.add(l.b); }
    }
    // 도로: 소구역마다 가까운 도로 노드 R개에 나눠 싣는다 (한 노드에 몰리는 접속부 정체 방지)
    const roadIdx = new SpatialIndex(nodes, roadNodes);
    const R = P.roadConnectors;
    this.subRoadNode = new Int32Array(S * R).fill(-1);
    this.subRoadAcc = new Float64Array(S * R);
    this.subRoadW = new Float64Array(S * R);
    for (let s = 0; s < S; s++) {
      const near = roadIdx.nearestK(this.subX[s], this.subY[s], R);
      let wsum = 0;
      near.forEach((nd, k) => {
        const [nx, ny] = nodes[nd];
        const acc = this.subMean(s, (x, y) => kmBetween(x, y, nx, ny)) * P.accessDetour / P.accessSpeedKmh * 60 + P.roadTerminalMin;
        this.subRoadNode[s * R + k] = nd;
        this.subRoadAcc[s * R + k] = acc;
        this.subRoadW[s * R + k] = 1 / (acc + 5);
        wsum += 1 / (acc + 5);
      });
      for (let k = 0; k < near.length; k++) this.subRoadW[s * R + k] /= wsum;
    }
    this.roadNodeSet = roadNodes;
    // 도시철도역과 소구역별 후보 (걸어가거나 버스로 갈 만한 곳)
    const metroNodes = new Set();
    for (const l of net.links) if (l.active && l.mode === 2) { metroNodes.add(l.a); metroNodes.add(l.b); }
    this.metroStationNodes = [...new Set(net.stations)].filter((st) => metroNodes.has(st));
    const mIdx = new SpatialIndex(nodes, new Set(this.metroStationNodes));
    const M = P.metroCandidates;
    this.subMetro = new Int32Array(S * M).fill(-1);
    this.subMetroAcc = new Float64Array(S * M);
    for (let s = 0; s < S; s++) {
      const scored = mIdx.within(this.subX[s], this.subY[s], P.metroRadiusKm).map((nd) => {
        const [nx, ny] = nodes[nd];
        return [nd, this.subMean(s, (x, y) => accessMinutes(kmBetween(x, y, nx, ny)))];
      }).sort((a, b) => a[1] - b[1]).slice(0, M);
      scored.forEach(([nd, acc], k) => { this.subMetro[s * M + k] = nd; this.subMetroAcc[s * M + k] = acc; });
    }
    // 철도: 운행 중인 역
    const stationNodes = [...new Set(net.stations)].filter((st) => railNodes.has(st));
    this.stationNode = Int32Array.from(stationNodes);
    this.stationOf = new Map(stationNodes.map((nd, i) => [nd, i]));
    const NS = stationNodes.length;
    // 역 대기시간은 이용객에 따라 정해진다 (운행 횟수는 수요를 따라간다). 이전 결과가 있으면 이어 쓴다
    const prevWait = new Map();
    if (this.stationWait && this.stationNodeOld) this.stationNodeOld.forEach((nd, i) => prevWait.set(nd, this.stationWait[i]));
    this.stationWait = new Float64Array(NS);
    stationNodes.forEach((nd, i) => {
      const kp = this.isKPPoint(nodes[nd][0], nodes[nd][1]);
      const base = hsrNodes.has(nd) ? P.railWaitMin.hsr : kp ? P.railWaitMin.kpConv : P.railWaitMin.conv;
      this.stationWait[i] = prevWait.get(nd) ?? base;
    });
    this.stationNodeOld = Int32Array.from(stationNodes);
    this.stationHsr = Uint8Array.from(stationNodes, (nd) => (hsrNodes.has(nd) ? 1 : 0));
    this.stationKP = Uint8Array.from(stationNodes, (nd) => this.isKPPoint(nodes[nd][0], nodes[nd][1]));
    // 소구역별 후보 역: 격자 단위 접근시간(도보 또는 연계교통)의 인구 가중 평균이 작은 역 최대 K개
    const stIdx = new SpatialIndex(nodes, new Set(stationNodes));
    const K = P.stationCandidates;
    this.subSt = new Int32Array(S * K).fill(-1);
    this.subStAcc = new Float64Array(S * K);
    for (let s = 0; s < S; s++) {
      const cand = stIdx.within(this.subX[s], this.subY[s], P.stationRadiusKm);
      const scored = cand.map((nd) => {
        const [nx, ny] = nodes[nd];
        return [this.stationOf.get(nd), this.subMean(s, (x, y) => accessMinutes(kmBetween(x, y, nx, ny)))];
      }).sort((a, b) => a[1] - b[1]).slice(0, K);
      scored.forEach(([st, acc], k) => { this.subSt[s * K + k] = st; this.subStAcc[s * K + k] = acc; });
    }
    this.boardings = new Float64Array(NS);
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
      }
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
   * 존 i→j 철도 일반화 시간. 소구역 쌍마다 가장 좋은 출발역·도착역 조합을 고르고 인구비중으로 평균한다.
   * pick 배열에는 소구역 쌍별 [출발역, 도착역, 비중]을 넣는다 (배정용).
   */
  railCost(i, j, D, pick) {
    const K = P.stationCandidates, NS = this.stationNode.length;
    const o0 = this.zoneSub0[i], on = this.zoneSubN[i], d0 = this.zoneSub0[j], dn = this.zoneSubN[j];
    let total = 0;
    for (let o = o0; o < o0 + on; o++) {
      if (!(this.subW[o] > 0)) continue;
      for (let d = d0; d < d0 + dn; d++) {
        if (!(this.subW[d] > 0)) continue;
        let best = Infinity, bs = -1, bt = -1;
        for (let a = 0; a < K; a++) {
          const s = this.subSt[o * K + a];
          if (s < 0) break;
          const head = this.subStAcc[o * K + a] + this.stationWait[s];
          for (let b = 0; b < K; b++) {
            const t = this.subSt[d * K + b];
            if (t < 0) break;
            if (s === t) continue;
            const c = head + D[s * NS + t] + this.subStAcc[d * K + b];
            if (c < best) { best = c; bs = s; bt = t; }
          }
        }
        if (!isFinite(best)) return Infinity;
        const w = this.subW[o] * this.subW[d];
        total += w * best;
        pick.push(bs, bt, w);
      }
    }
    return total;
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
    const { Z, net } = this;
    const L = net.links;
    const nNodes = net.nodes.length;
    const NS = this.stationNode.length;
    const R = P.roadConnectors, M = P.metroCandidates;
    const aux = new Float64Array(L.length);
    const auxT = new Float64Array(this.transitLinkCount);
    const nodeDemand = new Float64Array(nNodes);
    const stOD = new Float64Array(NS * NS);
    const croad = new Float64Array(Z), ctr = new Float64Array(Z);
    const egress = new Int32Array(this.S);   // 대중교통 도착 소구역별 하차 노드
    const mass = this.tripMass();
    // 관광 통행: 목적지 쪽 질량에 관광 매력도를 더한다 (방문객 1명 ≈ 인구 tourismMass명)
    const tmass = new Float64Array(Z);
    for (let j = 0; j < Z; j++) tmass[j] = ((this.tour[j] + this.tourKP[j] * integration) * P.tourismMass) / 1e4;
    const iters = warm ? P.msaIterationsWarm : P.msaIterations;
    // 지난해 교통량을 앞선 반복 몇 번 분으로 친다 (한 번의 전량배정이 혼잡을 다시 한곳에 몰지 않도록 1/4씩 섞는다)
    const offset = warm ? (offsetOverride ?? P.warmMsaOffset) : 0;
    const pick = [];
    const lam = P.logitLambda;
    const A = this.airports.length;
    const airOD = new Float64Array(A * A), latentOD = new Float64Array(A * A);
    let totals = null;

    for (let it = 1; it <= iters; it++) {
      this.updateCosts();
      aux.fill(0);
      stOD.fill(0);
      const D = this.stationMatrix();
      totals = { trips: 0, rail: 0, road: 0, transit: 0, air: 0, intl: 0, vhm: 0, kpkr: 0, krTrips: 0, krTransit: 0 };
      airOD.fill(0);
      latentOD.fill(0);
      for (let i = 0; i < Z; i++) {
        const o0 = this.zoneSub0[i], on = this.zoneSubN[i];
        // 승용차 비용
        const src = [], init = [];
        for (let o = o0 * R; o < (o0 + on) * R; o++) {
          if (this.subRoadNode[o] >= 0) { src.push(this.subRoadNode[o]); init.push(this.subRoadAcc[o]); }
        }
        this.road.shortestPaths(src, this.cost, init);
        const rd = this.road.dist;
        for (let j = 0; j < Z; j++) {
          let c = 0, wsum = 0;
          for (let d = this.zoneSub0[j]; d < this.zoneSub0[j] + this.zoneSubN[j]; d++) {
            if (!(this.subW[d] > 0)) continue;   // 인구 없는 소구역 (0 × 무한대 방지)
            wsum += this.subW[d];
            let best = Infinity;
            for (let k = d * R; k < d * R + R; k++) {
              if (this.subRoadNode[k] < 0) break;
              best = Math.min(best, rd[this.subRoadNode[k]] + this.subRoadAcc[k]);
            }
            c += this.subW[d] * best;
          }
          croad[j] = wsum > 0 ? c / wsum : Infinity;
        }
        // 대중교통 비용: 버스 정류장(도로 노드)이나 도시철도역에서 출발
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
            if (!(this.subW[d] > 0)) continue;
            wsum += this.subW[d];
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
            c += this.subW[d] * best;
          }
          ctr[j] = wsum > 0 ? c / wsum : Infinity;
        }

        nodeDemand.fill(0);
        const tDemand = this.transitDemand || (this.transitDemand = new Float64Array(nNodes));
        tDemand.fill(0);
        const carPen = P.carlessPenaltyMin * Math.max(0, 1 - this.income[i] / P.carOwnershipIncome);
        for (let j = 0; j < Z; j++) {
          const km = kmBetween(this.cx[i], this.cy[i], this.cx[j], this.cy[j]) * 1.25;
          const bc = this.borderCost(i, j, integration);
          const gr = croad[j] + (km * P.carCostPerKm) / P.vot + bc + carPen;
          pick.length = 0;
          const crail = i === j ? Infinity : this.railCost(i, j, D, pick);
          let hsrShare = 0;
          for (let k = 0; k < pick.length; k += 3) {
            if (this.stationHsr[pick[k]] && this.stationHsr[pick[k + 1]]) hsrShare += pick[k + 2];
          }
          const fare = P.railFarePerKm.conv + (P.railFarePerKm.hsr - P.railFarePerKm.conv) * hsrShare;
          const kpShare = (this.isKP[i] + this.isKP[j]) / 2;
          const gt = crail + (km * fare) / P.vot + this.railASC * (1 - kpShare * (1 - P.kpRailASCFactor)) + bc;
          const tfare = P.transitBaseFare + Math.max(0, km - 10) * P.transitFarePerKm;
          const gu = ctr[j] + tfare / P.vot + this.transitASC + bc;
          const air = this.airCost(i, j);
          const afare = (P.airBaseFare + km * P.airFarePerKm) * (air.intl ? P.airIntlFareFactor : 1);
          const ga = air.cost + afare / P.vot + P.airASC + bc;
          const eR = Math.exp(-lam * gr), eT = isFinite(gt) ? Math.exp(-lam * gt) : 0, eU = isFinite(gu) ? Math.exp(-lam * gu) : 0;
          const eA = isFinite(ga) ? Math.exp(-lam * ga) : 0;
          const sum = eR + eT + eU + eA;
          const comp = sum > 0 ? -Math.log(sum) / lam : gr;
          this.ccomp[i * Z + j] = i === j ? 15 : comp;
          if (i === j || !(sum > 0)) continue;
          const gravity = this.K * mass[i] / (comp + P.gravityOffsetMin) ** P.gravityPower;
          // 국외에서 오는 관광(입국)은 국외 존의 통행 발생 축소를 되돌려 따로 키운다
          const inbound = this.isExt[i] && !this.isExt[j] ? P.inboundTourism : 1;
          const T = gravity * (mass[j] + tmass[j] * inbound);
          const tRail = T * eT / sum, tTr = T * eU / sum, tAir = T * eA / sum, tRoad = T - tRail - tTr - tAir;
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
            if (this.subRoadNode[d] >= 0) nodeDemand[this.subRoadNode[d]] += pcu * this.subW[(d / R) | 0] * this.subRoadW[d];
          }
          if (tRail > 0) {
            for (let k = 0; k < pick.length; k += 3) stOD[pick[k] * NS + pick[k + 1]] += tRail * pick[k + 2];
          }
          if (tTr > 0) {
            for (let d = this.zoneSub0[j]; d < this.zoneSub0[j] + this.zoneSubN[j]; d++) {
              if (egress[d] >= 0) tDemand[egress[d]] += tTr * this.subW[d];
            }
          }
        }
        this.road.loadTree(nodeDemand, aux);
        // 대중교통 그래프는 위에서 구한 최단경로 트리를 그대로 들고 있다
        auxT.fill(0);
        this.transit.loadTree(tDemand, auxT);
        for (const l of this.metroLinks) aux[l] += auxT[l];
        if (progress && i % 25 === 0) progress(((it - 1) + 0.9 * i / Z) / iters);
      }
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
      for (let l = 0; l < L.length; l++) this.volume[l] += (aux[l] - this.volume[l]) / (it + offset);
      this.updateStationWaits(it + offset);
      for (let k = 0; k < airOD.length; k++) this.airOD[k] += (airOD[k] - this.airOD[k]) / (it + offset);
      this.latentOD.set(latentOD);
      this.airPaxFromOD();
    }
    this.updateCosts();
    return totals;
  }

  tripMass() {
    const m = new Float64Array(this.Z);
    for (let i = 0; i < this.Z; i++) {
      const rel = this.income[i] > 0 ? this.income[i] / this.frontier : 1;
      m[i] = this.pop[i] / 1e4 * rel ** P.propensityIncomeElasticity * (this.isExt[i] ? P.extMassFactor : 1);
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
      const rail = this.quantileVC((l) => l.mode === 1, P.railCalibQuantile);
      if (!isFinite(road) || !isFinite(rail)) break;
      this.K *= P.targetKrMotorwayVC / road;
      this.railASC += P.railASCStep * Math.log(rail * (P.targetKrMotorwayVC / road) / P.targetKrRailVC);
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
  advanceYear(integration, policy) {
    const { Z } = this;
    this.computeAccess();
    this.frontier *= 1 + P.frontierGrowth;
    for (let i = 0; i < Z; i++) {
      if (this.isExt[i]) continue;
      const target = this.incomeTarget(i);
      const r = this.isKP[i]
        ? P.convergenceKPBase + P.convergenceKPIntegrated * integration
        : P.convergenceKR;
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

  // ------------------------------------------------------------ 결과

  linkResults() {
    const n = this.nPhys ?? this.net.links.length;
    const vol = new Float32Array(n), vc = new Float32Array(n), speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      vol[i] = this.volume[i];
      vc[i] = this.capacity[i] > 0 ? this.volume[i] / this.capacity[i] : 0;
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
        this.zoneAirAcc[z * 2 + n] = (d * P.accessDetour / P.airAccessSpeedKmh) * 60 + P.airTerminalMin;
      });
    }
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
      routes, latent: latent.slice(0, 60), seats: P.airSeats,
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
      if (best) {
        this.rail.shortestPaths(this.stationNode[best.s], this.cost);
        const links = pathLinks(this.rail, this.stationNode[best.t]).flatMap((l) => this.net.links[l].via || [l]);
        const km = links.reduce((acc, l) => acc + this.net.links[l].len, 0);
        out.rail = { ...best, km, links, wait: this.stationWait[best.s], cost: Math.round(km * P.railFarePerKm.conv) };
      }
    }
    // 대중교통 (버스 + 도시철도)
    if (ra >= 0 && rb >= 0 && this.transit) {
      this.transit.shortestPaths(ra, this.costT);
      const d = this.transit.dist[rb];
      if (isFinite(d)) {
        out.transit = { min: d + P.busWaitMin + walk(kmBetween(from[0], from[1], ...nodes[ra])) * P.busAccessFactor
          + walk(kmBetween(to[0], to[1], ...nodes[rb])) * P.busAccessFactor,
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

export function kmBetween(x1, y1, x2, y2) {
  const dx = (x2 - x1) * Math.cos(((y1 + y2) / 2) * Math.PI / 180);
  return Math.hypot(dx, y2 - y1) * KM_PER_DEG;
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

// 수요 추정(중력모형 + 로짓 수단선택 + MSA 통행배정)과 인구·경제·HDI 갱신.
import { Graph } from './graph.js';
import { P } from './params.js';

const KM_PER_DEG = 111.32;

export class Model {
  /**
   * @param {object[]} zones zones.geojson의 properties 배열
   */
  constructor(zones) {
    const Z = this.Z = zones.length;
    this.zones = zones;
    this.isKP = Uint8Array.from(zones, (z) => (z.country === 'KP' ? 1 : 0));
    this.cx = Float64Array.from(zones, (z) => z.cx);
    this.cy = Float64Array.from(zones, (z) => z.cy);
    this.area = Float64Array.from(zones, (z) => Math.max(z.area, 1));
    this.pop = Float64Array.from(zones, (z) => z.pop);
    this.roadNode = Int32Array.from(zones, (z) => z.road_node);
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
    this.accessRef = 1;
    this.frontier = P.incomeKR;
    this.lastMigration = { kpToKr: 0, krToKp: 0 };
  }

  /** 저장된 존 상태 복원 */
  restore(s) {
    for (const k of ['pop', 'income', 'le', 'mys', 'eys', 'hdi', 'amenity']) this[k].set(s[k]);
    this.K = s.K; this.accessRef = s.accessRef; this.frontier = s.frontier;
    this.railASC = s.railASC ?? P.railASC;
  }

  snapshot() {
    const o = { K: this.K, railASC: this.railASC, accessRef: this.accessRef, frontier: this.frontier };
    for (const k of ['pop', 'income', 'le', 'mys', 'eys', 'hdi', 'amenity']) o[k] = Array.from(this[k]);
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
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (l.mode === 0) {
        this.freeTime[i] = (l.len / l.speed) * 60;
        let cap = l.lanes * P.roadCapPerLaneHour[l.cls] * P.dailyFactor;
        if (!l.paved) cap *= P.unpavedCapFactor;
        this.capacity[i] = cap;
      } else {
        const pen = l.power === 'AC' ? 1 : P.railNonACPenalty;
        this.freeTime[i] = (l.len / l.speed) * 60 * pen;
        this.capacity[i] = P.railTrainsPerDay[Math.min(l.tracks, 4)] * P.railPaxPerTrain[l.cls];
      }
    }
    if (!this.volume || this.volume.length !== L.length) {
      const old = this.volume;
      this.volume = new Float64Array(L.length);
      if (old) this.volume.set(old.subarray(0, Math.min(old.length, L.length)));
    }
    this.cost = new Float64Array(L.length);
    this.assignStations();
  }

  assignStations() {
    const { net, Z } = this;
    const hasRail = new Uint8Array(net.nodes.length);
    const hasHsr = new Uint8Array(net.nodes.length);
    for (const l of net.links) {
      if (!l.active || l.mode !== 1) continue;
      hasRail[l.a] = hasRail[l.b] = 1;
      if (l.cls === 'hsr') hasHsr[l.a] = hasHsr[l.b] = 1;
    }
    this.zoneStation = new Int32Array(Z).fill(-1);
    this.stationAccess = new Float64Array(Z);
    this.stationWait = new Float64Array(Z);
    this.stationHsr = new Uint8Array(Z);
    for (let z = 0; z < Z; z++) {
      let best = -1, bd = P.stationRadiusKm;
      for (const s of net.stations) {
        if (!hasRail[s]) continue;
        const d = kmBetween(this.cx[z], this.cy[z], net.nodes[s][0], net.nodes[s][1]);
        // 고속철역은 접근거리를 조금 더 허용한다
        const eff = hasHsr[s] ? d * 0.8 : d;
        if (eff < bd) { bd = eff; best = s; }
      }
      if (best < 0) continue;
      this.zoneStation[z] = best;
      const d = kmBetween(this.cx[z], this.cy[z], net.nodes[best][0], net.nodes[best][1]);
      this.stationAccess[z] = (d * P.accessDetour / P.accessSpeedKmh) * 60;
      this.stationHsr[z] = hasHsr[best];
      this.stationWait[z] = hasHsr[best] ? P.railWaitMin.hsr
        : this.isKP[z] ? P.railWaitMin.kpConv : P.railWaitMin.conv;
    }
    this.roadAccess = new Float64Array(Z);
    for (let z = 0; z < Z; z++) {
      const nd = net.nodes[this.roadNode[z]];
      const d = kmBetween(this.cx[z], this.cy[z], nd[0], nd[1]);
      this.roadAccess[z] = (d * P.accessDetour / P.accessSpeedKmh) * 60 + 5;
    }
  }

  updateCosts() {
    const L = this.net.links;
    for (let i = 0; i < L.length; i++) {
      const vc = this.capacity[i] > 0 ? this.volume[i] / this.capacity[i] : 0;
      if (L[i].mode === 0) {
        const r = Math.min(1 + P.bprAlpha * vc ** P.bprBeta, P.bprMaxRatio);
        this.cost[i] = this.freeTime[i] * r;
      } else {
        this.cost[i] = this.freeTime[i] * (1 + 0.5 * Math.max(0, vc - 1));
      }
    }
  }

  // ------------------------------------------------------------ 배정

  borderCost(i, j, integration) {
    return this.isKP[i] !== this.isKP[j] ? P.borderPenaltyMin * (1 - integration) : 0;
  }

  /**
   * MSA 통행배정. 수요는 매 반복의 비용으로 다시 계산한다.
   * @param {number} integration 남북 통합도 0~1
   * @param {(p:number)=>void} [progress]
   */
  assign(integration, progress) {
    const { Z, net } = this;
    const L = net.links;
    const nNodes = net.nodes.length;
    const aux = new Float64Array(L.length);
    const nodeDemandRoad = new Float64Array(nNodes);
    const nodeDemandRail = new Float64Array(nNodes);
    const croad = new Float64Array(Z), crail = new Float64Array(Z);
    const mass = this.tripMass();
    const iters = P.msaIterations;
    let totals = null;

    for (let it = 1; it <= iters; it++) {
      this.updateCosts();
      aux.fill(0);
      totals = { trips: 0, rail: 0, road: 0, vhm: 0, kpkr: 0 };
      for (let i = 0; i < Z; i++) {
        this.road.shortestPaths(this.roadNode[i], this.cost);
        const rd = this.road.dist;
        for (let j = 0; j < Z; j++) {
          croad[j] = this.roadAccess[i] + rd[this.roadNode[j]] + this.roadAccess[j];
        }
        const si = this.zoneStation[i];
        if (si >= 0) {
          this.rail.shortestPaths(si, this.cost);
          const dd = this.rail.dist;
          const base = this.stationAccess[i] + this.stationWait[i];
          for (let j = 0; j < Z; j++) {
            const sj = this.zoneStation[j];
            crail[j] = sj >= 0 ? base + dd[sj] + this.stationAccess[j] : Infinity;
          }
        } else crail.fill(Infinity);

        nodeDemandRoad.fill(0);
        nodeDemandRail.fill(0);
        for (let j = 0; j < Z; j++) {
          const km = kmBetween(this.cx[i], this.cy[i], this.cx[j], this.cy[j]) * 1.25;
          const bc = this.borderCost(i, j, integration);
          const gr = croad[j] + (km * P.carCostPerKm) / P.vot + bc;
          const fare = this.stationHsr[i] && this.stationHsr[j] ? P.railFarePerKm.hsr : P.railFarePerKm.conv;
          const gt = crail[j] + (km * fare) / P.vot + this.railASC + bc;
          const comp = isFinite(gt)
            ? -Math.log(Math.exp(-P.logitLambda * gr) + Math.exp(-P.logitLambda * gt)) / P.logitLambda
            : gr;
          this.ccomp[i * Z + j] = i === j ? 15 : comp;
          if (i === j || !isFinite(gr)) continue;
          const T = this.K * mass[i] * mass[j] / (comp + P.gravityOffsetMin) ** P.gravityPower;
          const pRail = isFinite(gt) ? 1 / (1 + Math.exp(P.logitLambda * (gt - gr))) : 0;
          const tRail = T * pRail, tRoad = T - tRail;
          if (it === iters) {
            totals.trips += T; totals.rail += tRail; totals.road += tRoad;
            totals.vhm += tRoad * croad[j];
            if (this.isKP[i] !== this.isKP[j]) totals.kpkr += T;
          }
          nodeDemandRoad[this.roadNode[j]] += tRoad / P.personsPerPCU * (1 + P.freightPCUShare);
          if (tRail > 0) nodeDemandRail[this.zoneStation[j]] += tRail;
        }
        // 도로·철도 그래프는 각자 최단경로 트리를 들고 있으므로 다시 탐색하지 않는다
        this.road.loadTree(nodeDemandRoad, aux);
        if (si >= 0) this.rail.loadTree(nodeDemandRail, aux);
        if (progress && i % 25 === 0) progress(((it - 1) + i / Z) / iters);
      }
      for (let l = 0; l < L.length; l++) this.volume[l] += (aux[l] - this.volume[l]) / it;
    }
    this.updateCosts();
    return totals;
  }

  tripMass() {
    const m = new Float64Array(this.Z);
    for (let i = 0; i < this.Z; i++) {
      const rel = this.income[i] > 0 ? this.income[i] / this.frontier : 1;
      m[i] = this.pop[i] / 1e4 * rel ** P.propensityIncomeElasticity;
    }
    return m;
  }

  /**
   * 기준 연도 보정. OD 자료가 없으므로 남측 고속도로 평균 V/C와 남측 철도 평균 V/C가
   * 목표치에 맞도록 통행량 계수 K와 철도 고유상수(ASC)를 번갈아 맞춘다.
   */
  calibrateK(integration, progress) {
    this.K = 1;
    const saved = P.msaIterations;
    P.msaIterations = 1;
    for (let it = 0; it < P.calibrationRounds; it++) {
      this.volume.fill(0);
      this.assign(integration);
      const road = this.meanVC((l) => l.mode === 0 && l.cls === 'motorway');
      const rail = this.quantileVC((l) => l.mode === 1, P.railCalibQuantile);
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

  /** 초기 상태: 접근성에 맞춰 소득·건강·교육을 정하고 인구이동 균형을 맞춘다 */
  initEconomy() {
    const { Z } = this;
    this.computeAccess();
    const kr = [], kp = [];
    for (let i = 0; i < Z; i++) (this.isKP[i] ? kp : kr).push(this.access[i]);
    this.accessRef = median(kr);
    const kpRef = median(kp);
    for (let i = 0; i < Z; i++) {
      if (this.isKP[i]) {
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
    for (let i = 0; i < Z; i++) { U[i] = this.utility(i); ubar += U[i] * this.pop[i]; ptot += this.pop[i]; }
    ubar /= ptot;
    const attract = new Float64Array(Z);
    for (let j = 0; j < Z; j++) attract[j] = this.pop[j] * Math.exp(U[j] - ubar);
    const net = new Float64Array(Z);
    const inflow = new Float64Array(Z);
    let kpToKr = 0, krToKp = 0;
    const policyFactor = P.migPolicyKPtoKR[policy] ?? 1;
    const w = new Float64Array(Z);
    for (let i = 0; i < Z; i++) {
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
    for (let i = 0; i < Z; i++) {
      const g = this.isKP[i] ? P.naturalGrowth.KP : P.naturalGrowth.KR;
      this.pop[i] = Math.max(100, this.pop[i] * (1 + g) + mig.net[i]);
    }
    this.lastMigration = { kpToKr: mig.kpToKr, krToKp: mig.krToKp, net: mig.net };
  }

  // ------------------------------------------------------------ 결과

  linkResults() {
    const n = this.net.links.length;
    const vol = new Float32Array(n), vc = new Float32Array(n), speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      vol[i] = this.volume[i];
      vc[i] = this.capacity[i] > 0 ? this.volume[i] / this.capacity[i] : 0;
      speed[i] = this.cost[i] > 0 ? this.net.links[i].len / (this.cost[i] / 60) : 0;
    }
    return { vol, vc, speed };
  }

  zoneResults() {
    return {
      pop: Float64Array.from(this.pop), income: Float64Array.from(this.income),
      hdi: Float64Array.from(this.hdi), le: Float64Array.from(this.le),
      access: Float64Array.from(this.access), station: Int32Array.from(this.zoneStation),
      netMig: this.lastMigration.net ? Float64Array.from(this.lastMigration.net) : new Float64Array(this.Z),
    };
  }

  summary() {
    const s = { KR: { pop: 0, hdi: 0, income: 0 }, KP: { pop: 0, hdi: 0, income: 0 } };
    for (let i = 0; i < this.Z; i++) {
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

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] || 1;
}

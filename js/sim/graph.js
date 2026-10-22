// CSR 그래프 + 이진 힙 다익스트라.
// 링크는 양방향으로 취급하며, 각 방향 간선은 원래 링크 인덱스를 기억한다.

export class Graph {
  /**
   * @param {number} nodeCount
   * @param {Int32Array|number[]} linkA  링크 시작 노드
   * @param {Int32Array|number[]} linkB  링크 끝 노드
   * @param {(i:number)=>boolean} active 사용 가능한 링크인지
   */
  constructor(nodeCount, linkA, linkB, active) {
    this.n = nodeCount;
    const deg = new Int32Array(nodeCount + 1);
    const ids = [];
    for (let i = 0; i < linkA.length; i++) {
      if (!active(i)) continue;
      ids.push(i);
      deg[linkA[i] + 1]++;
      deg[linkB[i] + 1]++;
    }
    for (let i = 0; i < nodeCount; i++) deg[i + 1] += deg[i];
    this.offset = deg;
    const m = deg[nodeCount];
    this.target = new Int32Array(m);
    this.edgeLink = new Int32Array(m);
    this.edgeFrom = new Int32Array(m);
    const fill = deg.slice(0, nodeCount);
    for (const i of ids) {
      const a = linkA[i], b = linkB[i];
      this.target[fill[a]] = b; this.edgeFrom[fill[a]] = a; this.edgeLink[fill[a]++] = i;
      this.target[fill[b]] = a; this.edgeFrom[fill[b]] = b; this.edgeLink[fill[b]++] = i;
    }
    this.dist = new Float64Array(nodeCount).fill(Infinity);
    this.predEdge = new Int32Array(nodeCount).fill(-1);
    this.order = new Int32Array(nodeCount);
    this.settled = 0;
    this.heap = new MinHeap(nodeCount);
  }

  /**
   * 최단경로. 결과는 this.dist / this.predEdge / this.order(확정 순서)에 담긴다.
   * @param {number|number[]} source 출발 노드 (여러 개면 init으로 출발 비용을 준다)
   * @param {Float64Array} linkCost 링크별 비용(분)
   * @param {number[]} [init] 출발 노드별 초기 비용
   */
  shortestPaths(source, linkCost, init) {
    const { dist, predEdge, order, heap, offset, target, edgeLink } = this;
    // 직전 탐색에서 건드린 노드만 되돌린다 (철도처럼 작은 부분망을 여러 번 탐색할 때 빠르다)
    for (let k = 0; k < this.settled; k++) { dist[order[k]] = Infinity; predEdge[order[k]] = -1; }
    heap.clear();
    if (Array.isArray(source)) {
      source.forEach((s, k) => {
        const c = init ? init[k] : 0;
        if (c < dist[s]) { dist[s] = c; heap.pushOrDecrease(s, c); }
      });
    } else {
      dist[source] = 0;
      heap.push(source, 0);
    }
    let k = 0;
    while (heap.size > 0) {
      const u = heap.pop();
      const du = dist[u];
      order[k++] = u;
      for (let e = offset[u]; e < offset[u + 1]; e++) {
        const v = target[e];
        const nd = du + linkCost[edgeLink[e]];
        if (nd < dist[v]) {
          dist[v] = nd;
          predEdge[v] = e;
          heap.pushOrDecrease(v, nd);
        }
      }
    }
    this.settled = k;
  }

  /**
   * 직전 shortestPaths 결과의 최단경로 트리를 따라 노드별 수요를 링크에 싣는다.
   * @param {Float64Array} nodeDemand 도착 노드별 수요 (호출 후 값이 변한다)
   * @param {Float64Array} linkLoad   누적할 링크 교통량
   */
  loadTree(nodeDemand, linkLoad) {
    const { order, predEdge, edgeFrom, edgeLink } = this;
    for (let k = this.settled - 1; k > 0; k--) {
      const v = order[k];
      const d = nodeDemand[v];
      if (d === 0) continue;
      const e = predEdge[v];
      if (e < 0) continue;
      linkLoad[edgeLink[e]] += d;
      nodeDemand[edgeFrom[e]] += d;
    }
  }
}

class MinHeap {
  constructor(cap) {
    this.items = new Int32Array(cap);
    this.keys = new Float64Array(cap);
    this.pos = new Int32Array(cap).fill(-1);
    this.size = 0;
  }
  clear() {
    for (let i = 0; i < this.size; i++) this.pos[this.items[i]] = -1;
    this.size = 0;
  }
  push(v, key) {
    const i = this.size++;
    this.items[i] = v; this.keys[i] = key; this.pos[v] = i;
    this.up(i);
  }
  pushOrDecrease(v, key) {
    const i = this.pos[v];
    if (i < 0) { this.push(v, key); return; }
    this.keys[i] = key;
    this.up(i);
  }
  pop() {
    const top = this.items[0];
    this.pos[top] = -1;
    const last = --this.size;
    if (last > 0) {
      this.items[0] = this.items[last];
      this.keys[0] = this.keys[last];
      this.pos[this.items[0]] = 0;
      this.down(0);
    }
    return top;
  }
  up(i) {
    const { items, keys, pos } = this;
    const v = items[i], k = keys[i];
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      items[i] = items[p]; keys[i] = keys[p]; pos[items[i]] = i;
      i = p;
    }
    items[i] = v; keys[i] = k; pos[v] = i;
  }
  down(i) {
    const { items, keys, pos } = this;
    const n = this.size, v = items[i], k = keys[i];
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= k) break;
      items[i] = items[c]; keys[i] = keys[c]; pos[items[i]] = i;
      i = c;
    }
    items[i] = v; keys[i] = k; pos[v] = i;
  }
}

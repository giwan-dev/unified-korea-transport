// pipeline/netpack.py가 만든 network.bin + network.meta.json을 게임이 쓰는 객체 구조로 푼다.

export function decodeNetwork(meta, buf) {
  let off = 0;
  const take = (Type, n) => {
    const arr = new Type(buf, off, n);
    off += n * Type.BYTES_PER_ELEMENT;
    off += (4 - (off % 4)) % 4;
    return arr;
  };
  const N = meta.nodes, L = meta.links, s = meta.scale;
  const nodeXY = take(Int32Array, N * 2);
  const a = take(Int32Array, L), b = take(Int32Array, L);
  const len = take(Float32Array, L), speed = take(Uint16Array, L);
  const name = take(Uint16Array, L), colour = take(Uint16Array, L);
  const mode = take(Uint8Array, L), cls = take(Uint8Array, L);
  const lanes = take(Uint8Array, L), tracks = take(Uint8Array, L);
  const paved = take(Uint8Array, L), kp = take(Uint8Array, L), power = take(Uint8Array, L);
  const open = meta.hasOpen ? take(Uint16Array, L) : null;
  const counts = take(Uint32Array, L);
  const verts = meta.vertEncoding === 'delta' ? decodeVerts(take(Uint8Array, meta.vertBytes), meta.verts * 2) : take(Int32Array, meta.verts * 2);

  const nodes = new Array(N);
  for (let i = 0; i < N; i++) nodes[i] = [nodeXY[2 * i] / s, nodeXY[2 * i + 1] / s];
  const links = new Array(L);
  let v = 0;
  for (let i = 0; i < L; i++) {
    const n = counts[i];
    const geom = new Array(n * 2);
    for (let k = 0; k < n * 2; k++) {
      const q = verts[v * 2 + k];
      geom[k] = q === 2147483647 ? NaN : q / s;   // NaN: 여러 선 사이 구분자
    }
    v += n;
    const l = {
      a: a[i], b: b[i], mode: mode[i], cls: meta.classes[cls[i]], len: Math.round(len[i] * 100) / 100,
      speed: speed[i], name: meta.names[name[i]], kp: kp[i], geom,
    };
    if (mode[i] === 0) { l.lanes = lanes[i]; l.paved = paved[i]; } else { l.tracks = tracks[i]; l.power = meta.powers[power[i]]; }
    if (colour[i]) l.colour = meta.colours[colour[i]];
    if (open && open[i]) l.open = open[i];
    links[i] = l;
  }
  return { nodes, links, stations: meta.stations, metro_stations: meta.metro_stations, junctions: meta.junctions };
}

/** pipeline/netpack.py encode_verts의 반대: 차이 zigzag 가변 길이 정수 → Int32 (구분자는 INT32_MAX) */
function decodeVerts(bytes, n) {
  const out = new Int32Array(n);
  const prev = [0, 0];
  let p = 0;
  for (let k = 0; k < n; k++) {
    let z = 0, shift = 0, b;
    do { b = bytes[p++]; z += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    if (z === 1) { out[k] = 2147483647; continue; }
    z /= 2;
    const d = z % 2 ? -(z + 1) / 2 : z / 2;
    prev[k % 2] += d;
    out[k] = prev[k % 2];
  }
  return out;
}

/** 메타와 이진 파일을 받아 네트워크를 만든다 */
export async function loadNetwork(base = 'data/', fetchBuffer = (u) => fetch(u).then((r) => r.arrayBuffer())) {
  const [meta, buf] = await Promise.all([
    fetch(base + 'network.meta.json').then((r) => r.json()),
    fetchBuffer(base + 'network.bin'),
  ]);
  return decodeNetwork(meta, buf);
}

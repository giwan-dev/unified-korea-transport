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
  const counts = take(Uint32Array, L);
  const verts = take(Int32Array, meta.verts * 2);

  const nodes = new Array(N);
  for (let i = 0; i < N; i++) nodes[i] = [nodeXY[2 * i] / s, nodeXY[2 * i + 1] / s];
  const links = new Array(L);
  let v = 0;
  for (let i = 0; i < L; i++) {
    const n = counts[i];
    const geom = new Array(n * 2);
    for (let k = 0; k < n * 2; k++) geom[k] = verts[v * 2 + k] / s;
    v += n;
    const l = {
      a: a[i], b: b[i], mode: mode[i], cls: meta.classes[cls[i]], len: Math.round(len[i] * 100) / 100,
      speed: speed[i], name: meta.names[name[i]], kp: kp[i], geom,
    };
    if (mode[i] === 0) { l.lanes = lanes[i]; l.paved = paved[i]; } else { l.tracks = tracks[i]; l.power = meta.powers[power[i]]; }
    if (colour[i]) l.colour = meta.colours[colour[i]];
    links[i] = l;
  }
  return { nodes, links, stations: meta.stations, metro_stations: meta.metro_stations, junctions: meta.junctions };
}

/** 메타와 이진 파일을 받아 네트워크를 만든다 */
export async function loadNetwork(base = 'data/', fetchBuffer = (u) => fetch(u).then((r) => r.arrayBuffer())) {
  const [meta, buf] = await Promise.all([
    fetch(base + 'network.meta.json').then((r) => r.json()),
    fetchBuffer(base + 'network.bin'),
  ]);
  return decodeNetwork(meta, buf);
}

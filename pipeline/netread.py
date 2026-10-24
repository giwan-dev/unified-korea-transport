"""data/network.bin을 다시 읽는다 (검수·디버깅용, netpack.write의 반대).

python pipeline/netread.py 126.93 37.515 0.5    # 이 점 0.5km 안의 철도·도로 링크와 역을 보여 준다
"""
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent


def read(data=ROOT / "data"):
    meta = json.loads((data / "network.meta.json").read_text(encoding="utf-8"))
    buf = (data / "network.bin").read_bytes()
    off = 0

    def take(dtype, n):
        nonlocal off
        arr = np.frombuffer(buf, dtype=dtype, count=n, offset=off)
        off += arr.nbytes
        off += (-off) % 4
        return arr
    N, L, V = meta["nodes"], meta["links"], meta["verts"]
    nodes = take("<i4", N * 2).reshape(-1, 2) / meta["scale"]
    cols = {}
    for k, dt in (("a", "<i4"), ("b", "<i4"), ("len", "<f4"), ("speed", "<u2"), ("name", "<u2"), ("colour", "<u2"),
                  ("mode", "u1"), ("cls", "u1"), ("lanes", "u1"), ("tracks", "u1"), ("paved", "u1"), ("kp", "u1"),
                  ("power", "u1"), ("open", "<u2")):
        cols[k] = take(dt, L)
    counts = take("<u4", L)
    if meta.get("vertEncoding") == "delta":
        verts = decode_verts(take("u1", meta["vertBytes"]), V * 2).astype(np.float64)
    else:
        verts = take("<i4", V * 2).astype(np.float64)
    verts[verts == 2147483647] = np.nan
    verts = verts.reshape(-1, 2) / meta["scale"]
    links, k = [], 0
    for i in range(L):
        c = int(counts[i])
        links.append({"a": int(cols["a"][i]), "b": int(cols["b"][i]), "len": float(cols["len"][i]), "speed": int(cols["speed"][i]),
                      "name": meta["names"][cols["name"][i]], "mode": int(cols["mode"][i]), "cls": meta["classes"][cols["cls"][i]],
                      "open": int(cols["open"][i]), "kp": int(cols["kp"][i]), "tracks": int(cols["tracks"][i]), "geom": verts[k:k + c].tolist()})
        k += c
    return nodes, links, meta


def decode_verts(b, n):
    """netpack.encode_verts의 반대 (구분자는 INT32_MAX)"""
    out = np.empty(n, dtype=np.int64)
    prev = [0, 0]
    p = 0
    data = b.tobytes()
    for k in range(n):
        z = shift = 0
        while True:
            c = data[p]; p += 1
            z |= (c & 0x7F) << shift
            shift += 7
            if not c & 0x80:
                break
        if z == 1:
            out[k] = 2147483647
            continue
        z >>= 1
        d = -((z + 1) >> 1) if z & 1 else z >> 1
        prev[k % 2] += d
        out[k] = prev[k % 2]
    return out


def near(lon, lat, km):
    nodes, links, meta = read()
    st = {n: name for name, n in meta["stations"]}
    mst = {n: name for name, n in meta.get("metro_stations", [])}
    d = lambda p: math.hypot((p[0] - lon) * 88, (p[1] - lat) * 111)
    for i, l in enumerate(links):
        if any(d(nodes[n]) < km for n in (l["a"], l["b"])):
            nm = lambda n: st.get(n) or mst.get(n) or n
            print(i, l["mode"], l["name"] or "-", f"{l['len']:.2f}km", "open" if l["open"] else "", nm(l["a"]), "→", nm(l["b"]),
                  len(l["geom"]), "pts", [[round(x, 4), round(y, 4)] for x, y in l["geom"][:4]])


if __name__ == "__main__":
    near(float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 0.5)

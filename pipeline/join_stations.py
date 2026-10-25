"""역 바로 위를 지나가는데 이어지지 않은 노선을 그 역에서 잇는다 (안변역–강원선처럼).

OSM에서 지선(금강산청년선)만 역 노드에 닿고 본선(강원선)은 역을 마디로 갖지 않은 채 한 구간으로 지나가면,
본선 열차가 그 역에 설 수 없고 두 노선도 이어지지 않는다. 철도 DB가 그 역에 서는 노선으로 적은 노선의 구간이
역 노드에서 JOIN_M 안을 지나가고, 같은 이름의 다른 역 노드에도 그 노선이 닿아 있지 않으면 그 구간을 역에서
둘로 나눈다: 원래 구간은 앞쪽(a→역), 뒤쪽(역→b)은 속성을 그대로 가진 새 구간으로 링크 목록 끝에 붙인다.
링크 수가 바뀌므로 data/meta.json의 데이터 표지(stamp)를 새로 하고 기준 연도 계산(tools/baseline.html)을 다시 돌린다.

  .venv/Scripts/python -X utf8 pipeline/join_stations.py --check
  .venv/Scripts/python -X utf8 pipeline/join_stations.py
"""
from __future__ import annotations

import datetime
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from shapely.geometry import LineString, Point
from shapely.ops import substring
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).parent))
import netpack  # noqa: E402
import railref  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
JOIN_M = 30.0
KX = 0.8
NOT_PASSENGER = __import__("re").compile(r"(화물|유치선|기지|차량|조차장|신호장)")
CLS = netpack.CLASSES

COLS = [("a", "<i4"), ("b", "<i4"), ("len", "<f4"), ("speed", "<u2"), ("name", "<u2"), ("colour", "<u2"),
        ("mode", "u1"), ("cls", "u1"), ("lanes", "u1"), ("tracks", "u1"), ("paved", "u1"), ("kp", "u1"), ("power", "u1"), ("open", "<u2")]


def read_raw():
    meta = json.loads((DATA / "network.meta.json").read_text(encoding="utf-8"))
    buf = (DATA / "network.bin").read_bytes()
    off = 0

    def take(dt, n):
        nonlocal off
        a = np.frombuffer(buf, dtype=dt, count=n, offset=off).copy()
        off += a.nbytes
        off += (-off) % 4
        return a
    N, L = meta["nodes"], meta["links"]
    nodes = take("<i4", N * 2).reshape(-1, 2).astype(np.float64) / meta["scale"]
    cols = {k: take(dt, L) for k, dt in COLS}
    counts = take("<u4", L)
    import netread
    verts = netread.decode_verts(np.frombuffer(buf, dtype="u1", count=meta["vertBytes"], offset=off), meta["verts"] * 2).astype(np.float64)
    verts[verts == 2147483647] = np.nan
    verts = verts.reshape(-1, 2) / meta["scale"]
    geoms, k = [], 0
    for i in range(L):
        c = int(counts[i])
        geoms.append([tuple(v) for v in verts[k:k + c]])
        k += c
    return meta, nodes, cols, geoms


def write_raw(meta, nodes, cols, geoms):
    L = len(geoms)
    parts = [np.round(nodes * netpack.SCALE).astype("<i4")]
    parts += [np.asarray(cols[k], dtype=dt) for k, dt in COLS]
    parts.append(np.array([len(g) for g in geoms], "<u4"))
    raw = np.array([v for g in geoms for v in g], dtype=np.float64).ravel() * netpack.SCALE
    verts = netpack.encode_verts(raw)
    parts.append(verts)
    with open(DATA / "network.bin", "wb") as f:
        for p in parts:
            f.write(p.tobytes())
            f.write(b"\0" * ((-f.tell()) % 4))
    meta["links"], meta["verts"], meta["vertBytes"] = L, int(len(raw) // 2), int(len(verts))
    (DATA / "network.meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main():
    check = "--check" in sys.argv
    meta, nodes, cols, geoms = read_raw()
    names = meta["names"]
    L = len(geoms)
    ref = railref.load(DATA / "raw")
    db = defaultdict(set)
    for n, ls, _, _, _ in ref["stations"]:
        db[n] |= {railref.norm_line(x) for x in ls}
    lines_at = defaultdict(set)
    rail_deg = defaultdict(int)
    for i in range(L):
        if cols["mode"][i] in (1, 2):
            rail_deg[int(cols["a"][i])] += 1
            rail_deg[int(cols["b"][i])] += 1
    for i in range(L):
        ln = railref.norm_line(names[cols["name"][i]] or "")
        for n in (int(cols["a"][i]), int(cols["b"][i])):
            lines_at[n].add(ln)
    stations = meta["stations"] + meta.get("metro_stations", [])
    by_name = defaultdict(set)
    for nm, n in stations:
        by_name[railref.norm_station(nm)].add(n)
    rail = [i for i in range(L) if cols["mode"][i] in (1, 2) and len(geoms[i]) >= 2 and not any(v[0] != v[0] for v in geoms[i])]
    shapes = [LineString([(x * KX, y) for x, y in geoms[i]]) for i in rail]
    tree = STRtree(shapes)
    jobs = {}
    for nm, n in stations:
        key = railref.norm_station(nm)
        want = db.get(key, set())
        if NOT_PASSENGER.search(nm):
            continue
        dead_end = rail_deg[n] == 1   # 한 노선 끝에만 붙은 역: 그 위를 지나가는 다른 노선은 이름이 달라도(옛 이름 등) 잇는다
        if not want and not dead_end:
            continue
        P = Point(nodes[n][0] * KX, nodes[n][1])
        for k in tree.query(P.buffer(JOIN_M / 111000 * 2)):
            i = rail[k]
            if n in (int(cols["a"][i]), int(cols["b"][i])) or i in jobs.values():
                continue
            ln = railref.norm_line(names[cols["name"][i]] or "")
            if ln in lines_at[n] or (ln not in want and (not dead_end or CLS[cols["cls"][i]] == "hsr")):
                continue
            # 같은 이름의 다른 역 노드(1.5km 안)에 이미 그 노선이 닿아 있으면 그 역이 그 노선의 역이다
            if any(ln in lines_at[m] for m in by_name[key] if m != n and math.hypot((nodes[m][0] - nodes[n][0]) * 88, (nodes[m][1] - nodes[n][1]) * 111) < 1.5):
                continue
            g = shapes[k]
            if g.distance(P) * 111000 > JOIN_M:
                continue
            d = g.project(P)
            if d < 0.0005 or d > g.length - 0.0005:
                continue
            jobs[n] = i
            print("join", nm, n, "←", names[cols["name"][i]], i)
            break
    print(len(jobs), "stations joined")
    if check or not jobs:
        return
    for n, i in jobs.items():
        g = LineString([(x * KX, y) for x, y in geoms[i]])
        d = g.project(Point(nodes[n][0] * KX, nodes[n][1]))
        q = g.interpolate(d)
        at = (q.x / KX, q.y)
        g1 = [(x / KX, y) for x, y in substring(g, 0, d).coords]
        g2 = [(x / KX, y) for x, y in substring(g, d, g.length).coords]
        g1[-1] = at
        g2[0] = at
        frac = d / g.length
        total = float(cols["len"][i])
        # 역 노드를 선 위 그 자리로 (30m 안) 옮기고, 역에 닿은 다른 구간 끝도 따라 옮긴다
        nodes[n] = at
        for j in range(len(geoms)):
            if int(cols["a"][j]) == n and geoms[j]:
                geoms[j][0] = at
            if int(cols["b"][j]) == n and geoms[j]:
                geoms[j][-1] = at
        b = int(cols["b"][i])
        cols["b"][i] = n
        cols["len"][i] = total * frac
        geoms[i] = g1
        for k_, _ in COLS:
            cols[k_] = np.append(cols[k_], cols[k_][i])
        cols["a"][-1], cols["b"][-1], cols["len"][-1] = n, b, total * (1 - frac)
        geoms.append(g2)
    write_raw(meta, nodes, cols, geoms)
    m = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    m["links"] = len(geoms)
    m["stamp"] = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    (DATA / "meta.json").write_text(json.dumps(m), encoding="utf-8")
    print("links", len(geoms), "stamp", m["stamp"])


if __name__ == "__main__":
    main()

"""역 노드를 철도 DB(KMZ)의 역 위치로 옮긴다 (선로를 따라서).

OSM에서 잡은 역 노드가 승강장이 아니라 역 구내 끝이나 옆 선로에 놓여, 실제 역보다 수십~수백 m 비켜난 곳이 있다
(경의선·공항철도 디지털미디어시티처럼). 철도 DB의 같은 이름 역 점이
  - 이 노드 쪽 선로 위(SNAP_M 안)에 있고
  - MIN_M ~ MAX_M 떨어져 있고
  - 같은 이름의 다른 역 노드(환승역의 다른 노선 등)보다 이 노드에 더 가까우면
노드를 그 점으로 옮긴다. 노드가 옮겨 간 쪽 링크는 그만큼 잘라 내고, 나머지 링크는 잘라 낸 선로를 이어 받아
연결과 선형은 그대로다 (링크 길이도 그만큼 고친다).

  .venv/Scripts/python -X utf8 pipeline/fix_station_nodes.py          # data/network.bin을 고친다
  .venv/Scripts/python -X utf8 pipeline/fix_station_nodes.py --check  # 고치지 않고 목록만
"""
from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import netpack  # noqa: E402
import netread  # noqa: E402
import railref  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MIN_M, MAX_M, SNAP_M, NAME_KM = 60.0, 1000.0, 120.0, 1.5


def km(p, q):
    return math.hypot((p[0] - q[0]) * 111.32 * math.cos(math.radians(p[1])), (p[1] - q[1]) * 110.57)


def project(geom, t):
    """선(geom) 위에서 t에 가장 가까운 자리: (거리 km, 조각 번호 k, 조각 안 비율 u, 그 점)"""
    best = (math.inf, 0, 0.0, geom[0])
    for k in range(len(geom) - 1):
        a, b = geom[k], geom[k + 1]
        cx = math.cos(math.radians(a[1]))
        ax, ay, bx, by, tx, ty = a[0] * cx, a[1], b[0] * cx, b[1], t[0] * cx, t[1]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        u = 0.0 if L == 0 else max(0.0, min(1.0, ((tx - ax) * dx + (ty - ay) * dy) / L))
        p = (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)
        d = km(p, t)
        if d < best[0]:
            best = (d, k, u, p)
    return best


def plen(g):
    return sum(km(g[i], g[i + 1]) for i in range(len(g) - 1))


def main():
    check = "--check" in sys.argv
    data = ROOT / "data"
    nodes, links, meta = netread.read(data)
    nodes = nodes.copy()
    for l in links:
        l["geom"] = [None if x != x else (x, y) for x, y in l["geom"]]
    ref = railref.load(data / "raw")
    db = defaultdict(list)
    for n, ls, x, y, _ in ref["stations"]:
        db[n].append((x, y, ls))
    st_nodes = defaultdict(set)
    for nm, n in meta["stations"] + meta.get("metro_stations", []):
        st_nodes[railref.norm_station(nm)].add(n)
    adj = defaultdict(list)
    lines_at = defaultdict(set)
    for i, l in enumerate(links):
        adj[l["a"]].append(i)
        adj[l["b"]].append(i)
        if l["mode"] in (1, 2):
            for m in (l["a"], l["b"]):
                lines_at[m].add(railref.norm_line(l["name"] or ""))

    moved = []
    done = set()
    for nm, n in meta["stations"] + meta.get("metro_stations", []):
        if n in done:
            continue
        done.add(n)
        key = railref.norm_station(nm)
        here = tuple(nodes[n])
        cands = [p for p in db.get(key, []) if km(here, p) < NAME_KM]
        # 환승역은 DB에 노선마다 점이 따로 있다: 이 노드에 서는 노선의 점만 (없으면 전부)
        mine = [p for p in cands if p[2] & lines_at[n]]
        cands = [p[:2] for p in (mine or cands)]
        if not cands:
            continue
        ls0 = [i for i in adj[n] if links[i]["mode"] in (1, 2) and None not in links[i]["geom"]]
        if max(km(p, q) for p in cands for q in cands) > 0.3:
            # 큰 환승역은 DB에 승강장마다 점이 있다: 이 노드의 선로 바로 위(SNAP_M 안)에 있는 점 가운데 역 한가운데(점들의 평균)에 가장 가까운 것.
            # 그런 점이 없거나 1.5km 넘게 흩어져 있으면(같은 이름 다른 역) 건드리지 않는다
            on = [p for p in cands if ls0 and min(project(links[i]["geom"], p)[0] for i in ls0) * 1000 <= SNAP_M]
            if not on or max(km(p, q) for p in cands for q in cands) > NAME_KM:
                continue
            mid = (sum(p[0] for p in cands) / len(cands), sum(p[1] for p in cands) / len(cands))
            t = min(on, key=lambda p: km(mid, p))
        else:
            t = (sum(p[0] for p in cands) / len(cands), sum(p[1] for p in cands) / len(cands))
        d = km(here, t)
        if not (MIN_M / 1000 <= d <= MAX_M / 1000):
            continue
        # 환승역의 다른 노드가 그 점에 더 가까우면 그 노드의 자리다
        others = [m for m in st_nodes[key] if m != n and km(tuple(nodes[m]), here) < NAME_KM]
        if not mine and any(km(tuple(nodes[m]), t) < d for m in others):
            continue
        ls = adj[n]
        if not ls or any(links[i]["mode"] not in (1, 2) or None in links[i]["geom"] or links[i]["a"] == links[i]["b"] for i in ls):
            continue
        # 노드에서 나가는 쪽으로 돌려 둔 도형
        out = {i: (links[i]["geom"] if links[i]["a"] == n else links[i]["geom"][::-1]) for i in ls}
        hits = [(project(out[i], t), i) for i in ls]
        (pd, pk, pu, pp), host = min(hits, key=lambda h: h[0][0])
        if pd * 1000 > SNAP_M or (pk == 0 and pu == 0.0):
            continue
        t = pp                            # 역 건물 점이 선로 옆이면 선로 위로 내린 자리
        if km(here, t) < MIN_M / 1000:
            continue
        g = out[host]
        cut = g[:pk + 1] + [pp]          # 노드에서 새 자리까지 (다른 링크가 이어 받는다)
        rest = [t] + g[pk + 1:]
        if len(rest) < 2 or plen(rest) < 0.05:
            continue                      # 새 자리가 그 링크의 반대쪽 끝에 너무 가깝다
        if moved and False:
            pass
        cut_len = plen(cut)
        cut_rev = [t] + cut[::-1][1:]    # 새 자리 → 옛 노드 자리
        new = {host: rest}
        for i in ls:
            if i != host:
                new[i] = cut_rev + out[i][1:]
        for i, gg in new.items():
            l = links[i]
            l["geom"] = gg if l["a"] == n else gg[::-1]
            l["len"] = max(0.01, l["len"] + (-cut_len if i == host else cut_len))
        nodes[n] = t
        moved.append((round(km(here, t) * 1000), nm, n, len(ls)))
    moved.sort(reverse=True)
    print("moved", len(moved), "station nodes")
    show = next((a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--show=")), None)
    for r in (moved if show else moved[:30]):
        if not show or r[1] in show:
            print(*r)
    if check:
        return
    meta_path, bin_path = data / "network.meta.json", data / "network.bin"
    buf = bytearray(bin_path.read_bytes())
    N, L = meta["nodes"], meta["links"]
    buf[0:N * 8] = np.round(nodes * netpack.SCALE).astype("<i4").tobytes()
    off_len = N * 8 + L * 4 * 2       # 노드, a, b 다음이 len
    buf[off_len:off_len + L * 4] = np.array([l["len"] for l in links], "<f4").tobytes()
    off = 0
    for size in [N * 2 * 4, L * 4, L * 4, L * 4, L * 2, L * 2, L * 2] + [L] * 7 + ([L * 2] if meta.get("hasOpen") else []):
        off += size
        off += (-off) % 4
    counts = np.array([len(l["geom"]) for l in links], "<u4")
    raw = np.array([(math.nan, math.nan) if p is None else p for l in links for p in l["geom"]], dtype=np.float64).ravel() * netpack.SCALE
    verts = netpack.encode_verts(raw)
    outb = bytes(buf[:off]) + counts.tobytes()
    outb += b"\0" * ((-len(outb)) % 4)
    outb += verts.tobytes()
    outb += b"\0" * ((-len(outb)) % 4)
    bin_path.write_bytes(outb)
    meta["verts"], meta["vertBytes"] = int(len(raw) // 2), int(len(verts))
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("network.bin", round(len(outb) / 1e6, 2), "MB")


if __name__ == "__main__":
    main()

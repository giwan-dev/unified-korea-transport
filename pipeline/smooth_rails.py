"""철도·도시철도·간선도로 선형 다듬기: 지그재그·갈고리 꼭짓점과 본선에서 비켜난 노드를 바로잡는다.

OSM 선로는 복선·여러 선로가 나란히 있어, 구간마다 다른 선로를 고르거나 역 노드(승강장 자리)로 꺾여 들어가면
그림에서 수십~수백 m씩 좌우로 흔들린다 (경의선 수색–DMC–가좌처럼). 노드 위치·연결·길이는 그대로 두고
링크 도형의 중간 꼭짓점만 고친다:
  1) 갈고리: 거의 되돌아가는(≥ HOOK_DEG) 꼭짓점, 선에서 조금(≤ JIT_M)만 벗어나며 꺾이는 잔 떨림은 뺀다
  2) 지그재그: 짧은 간격(≤ ZIG_M)에 좌우로 번갈아 꺾이는 꼭짓점 쌍은 가운데 한 점으로 합친다
  3) 마지막으로 ZIG_TOL_M 허용치로 Douglas–Peucker

  .venv/Scripts/python -X utf8 pipeline/smooth_rails.py          # data/network.bin을 고친다
  .venv/Scripts/python -X utf8 pipeline/smooth_rails.py --check  # 고치지 않고 몇 곳인지만
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import netpack  # noqa: E402
import netread  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HOOK_M, HOOK_DEG = 250.0, 100.0     # 거의 되돌아가는 갈고리
JIT_M, JIT_DEG = 40.0, 45.0          # 선에서 조금 벗어난 잔 떨림
ZIG_M, ZIG_DEG, ZIG_DEV = 350.0, 25.0, 80.0
ZIG_TOL_M = 15.0
HOOK_END_M = 500.0                  # 노선 끝(역·분기 노드) 바로 옆에서 되돌아가는 갈고리 (동북선 미아사거리처럼 노드가 선로에서 비켜난 곳)


def _xy(p, lat0):
    return (p[0] * 111320 * math.cos(math.radians(lat0)), p[1] * 110570)


def _turn(a, b, c):
    """b에서 꺾이는 각(도, 부호: 왼쪽 +)과 b가 a–c 선에서 벗어난 거리(m)"""
    ux, uy = b[0] - a[0], b[1] - a[1]
    vx, vy = c[0] - b[0], c[1] - b[1]
    ang = math.degrees(math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
    wx, wy = c[0] - a[0], c[1] - a[1]
    wl = math.hypot(wx, wy)
    if wl < 1e-6:
        dev = math.hypot(ux, uy)
    else:
        t = max(0.0, min(1.0, ((b[0] - a[0]) * wx + (b[1] - a[1]) * wy) / (wl * wl)))
        dev = math.hypot(a[0] + t * wx - b[0], a[1] + t * wy - b[1])
    return ang, dev


def _dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, bd = -1, tol
        for k in range(i + 1, j):
            _, d = _turn(pts[i], pts[k], pts[j])
            if d > bd:
                best, bd = k, d
        if best > 0:
            keep[best] = True
            stack += [(i, best), (best, j)]
    return [p for p, k in zip(pts, keep) if k]


def smooth_part(part, zig=True):
    """한 줄(경위도 점 목록)을 다듬는다. 양 끝은 그대로. (새 점 목록, 고친 곳 수)"""
    if len(part) < 3:
        return part, 0
    lat0 = part[0][1]
    pts = [_xy(p, lat0) for p in part]
    fixed = 0
    changed = True
    while changed and len(pts) > 2:
        changed = False
        # 1) 갈고리
        for k in range(1, len(pts) - 1):
            ang, dev = _turn(pts[k - 1], pts[k], pts[k + 1])
            end_hook = zig and k in (1, len(pts) - 2) and abs(ang) >= HOOK_DEG and dev <= HOOK_END_M   # 철도만 (도로 IC 고리는 그대로)
            if (abs(ang) >= HOOK_DEG and dev <= HOOK_M) or (abs(ang) >= JIT_DEG and dev <= JIT_M) or end_hook:
                del pts[k]
                fixed += 1
                changed = True
                break
        if changed:
            continue
        # 2) 지그재그: k, k+1에서 반대로 꺾이고 둘 사이가 짧으면 가운데 한 점으로
        for k in (range(1, len(pts) - 2) if zig else ()):
            a1, d1 = _turn(pts[k - 1], pts[k], pts[k + 1])
            a2, d2 = _turn(pts[k], pts[k + 1], pts[k + 2])
            seg = math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1])
            if a1 * a2 < 0 and abs(a1) >= ZIG_DEG and abs(a2) >= ZIG_DEG and seg <= ZIG_M and max(d1, d2) <= ZIG_DEV:
                mid = ((pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2)
                pts[k:k + 2] = [mid]
                fixed += 1
                changed = True
                break
    pts = _dp(pts, ZIG_TOL_M)
    kx = 111320 * math.cos(math.radians(lat0))
    out = [(x / kx, y / 110570) for x, y in pts]
    out[0], out[-1] = part[0], part[-1]
    return out, fixed


def smooth_geom(geom, zig=True):
    """None 구분자가 있는 도형 전체"""
    parts, cur = [], []
    for p in geom:
        if p is None:
            parts.append(cur); cur = []
        else:
            cur.append(p)
    parts.append(cur)
    out, fixed = [], 0
    for i, part in enumerate(parts):
        sp, f = smooth_part(part, zig)
        fixed += f
        if i:
            out.append(None)
        out += sp
    return out, fixed


BUNDLE_M, BUNDLE_RUN_M, BUNDLE_TAPER_M, BUNDLE_STEP_M = 150.0, 800.0, 300.0, 50.0


def bundle(links):
    """같은 통로를 나란히 가는 철도(경의선–공항철도처럼 50~150m 떨어져 엇갈리는 두 선)를 한 선에 겹친다.

    같은 수단의 앞선 링크(선로가 많은 것부터)를 기준선으로 두고, 뒤 링크가 기준선 BUNDLE_M 안을
    BUNDLE_RUN_M 넘게 이어 가면 그 구간을 기준선 위로 옮긴다. 구간 양 끝 BUNDLE_TAPER_M은 서서히 옮긴다.
    여러 줄로 된 도형과 양 끝 노드는 건드리지 않는다. 고친 링크 수를 돌려준다.
    """
    from shapely.geometry import LineString, Point
    from shapely.strtree import STRtree

    lat0 = 37.0
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110570
    order = sorted((i for i, l in enumerate(links) if l["mode"] in (1, 2) and None not in l["geom"] and len(l["geom"]) >= 2),
                   key=lambda i: (-links[i]["tracks"], i))
    refs = {1: [], 2: []}
    trees = {}
    moved = 0
    for idx, i in enumerate(order):
        l = links[i]
        mode = l["mode"]
        ends = (l["geom"][0], l["geom"][-1])
        line = LineString([(x * kx, y * ky) for x, y in l["geom"]])
        cand = []
        if refs[mode] and line.length >= BUNDLE_RUN_M:
            if mode not in trees or trees[mode][1] != len(refs[mode]):
                trees[mode] = (STRtree([g for _, g in refs[mode]]), len(refs[mode]))
            tree = trees[mode][0]
            cand = [refs[mode][k][1] for k in tree.query(line.buffer(BUNDLE_M))]
        if cand:
            n = max(2, int(line.length / BUNDLE_STEP_M) + 1)
            samples = [line.interpolate(t * line.length / (n - 1)) for t in range(n)]
            proj = []
            for p in samples:
                best, bd = None, BUNDLE_M
                for g in cand:
                    d = g.distance(p)
                    if d < bd:
                        bd, best = d, g
                proj.append(best.interpolate(best.project(p)) if best is not None else None)
            # BUNDLE_RUN_M 넘게 이어지는 구간만
            near = [q is not None for q in proj]
            runs, k = [], 0
            while k < n:
                if near[k]:
                    j = k
                    while j + 1 < n and near[j + 1]:
                        j += 1
                    if (j - k) * BUNDLE_STEP_M >= BUNDLE_RUN_M:
                        runs.append((k, j))
                    k = j + 1
                else:
                    k += 1
            if runs:
                taper = BUNDLE_TAPER_M / BUNDLE_STEP_M
                w = [0.0] * n
                for a, b in runs:
                    for k in range(a, b + 1):
                        # 노선 양 끝(노드)에 닿은 쪽은 바로, 중간에서 갈라지는 쪽은 서서히
                        ea = 1.0 if a == 0 else min(1.0, (k - a) / taper)
                        eb = 1.0 if b == n - 1 else min(1.0, (b - k) / taper)
                        w[k] = max(w[k], min(ea, eb))
                pts = []
                for k, p in enumerate(samples):
                    q = proj[k]
                    if q is None or w[k] <= 0:
                        pts.append((p.x, p.y))
                    else:
                        pts.append((p.x + (q.x - p.x) * w[k], p.y + (q.y - p.y) * w[k]))
                pts[0], pts[-1] = line.coords[0], line.coords[-1]
                xy = [(x, y) for x, y in pts]
                xy = _dp(xy, 8.0)
                l["geom"] = [(x / kx, y / ky) for x, y in xy]
                l["geom"][0], l["geom"][-1] = ends
                line = LineString([(x * kx, y * ky) for x, y in l["geom"]])
                moved += 1
        refs[mode].append((i, line))
    return moved


NODE_DEV_M, NODE_DEG, NODE_SKIP_M = 200.0, 35.0, 25.0


def straighten_nodes(nodes, links):
    """같은 이름 노선이 지나가는 노드(IC·역·분기)가 본선에서 옆으로 비켜나 있어 선이 갈고리처럼 꺾이면 노드를 본선 위로 옮긴다.

    강변북로·내부순환로의 IC 노드가 램프 쪽에 놓여 본선이 IC마다 옆으로 갔다 돌아오던 것처럼, 노드에서 NODE_DEG 넘게 꺾이고
    노드가 앞뒤 점을 잇는 선에서 NODE_DEV_M 안에 있으면, 노드를 그 선 위로 내리고 노드에 닿은 링크 끝을 모두 새 자리로 옮긴다.
    노드 바로 옆(NODE_SKIP_M 안)의 꼭짓점은 갈고리의 일부로 보고 함께 뺀다. 링크 길이·연결은 그대로. 옮긴 노드 수를 돌려준다
    """
    from collections import defaultdict
    adj = defaultdict(list)
    for i, l in enumerate(links):
        if None in l["geom"] or len(l["geom"]) < 2 or l["a"] == l["b"]:
            continue
        adj[l["a"]].append(i)
        adj[l["b"]].append(i)
    moved = 0
    for n, ls in adj.items():
        # 같은 수단·같은 이름으로 이 노드를 지나는 두 링크 (정확히 둘일 때만: 갈림목은 건드리지 않는다)
        groups = defaultdict(list)
        for i in ls:
            if links[i]["name"]:
                groups[(links[i]["mode"], links[i]["name"])].append(i)
        pair = [g for g in groups.values() if len(g) == 2]
        if len(pair) != 1:
            continue
        i1, i2 = pair[0]
        c = (float(nodes[n][0]), float(nodes[n][1]))
        lat0 = c[1]
        out1 = links[i1]["geom"] if links[i1]["a"] == n else links[i1]["geom"][::-1]
        out2 = links[i2]["geom"] if links[i2]["a"] == n else links[i2]["geom"][::-1]
        P = lambda q: _xy(q, lat0)
        cx = P(c)

        def first_far(g):
            for k in range(1, len(g)):
                q = P(g[k])
                if math.hypot(q[0] - cx[0], q[1] - cx[1]) > NODE_SKIP_M:
                    return k
            return None
        k1, k2 = first_far(out1), first_far(out2)
        if k1 is None or k2 is None:
            continue
        a, b = P(out1[k1]), P(out2[k2])
        ang, dev = _turn(a, cx, b)
        if abs(ang) < NODE_DEG or dev > NODE_DEV_M:
            continue
        wx, wy = b[0] - a[0], b[1] - a[1]
        L = wx * wx + wy * wy
        if L == 0:
            continue
        t = max(0.05, min(0.95, ((cx[0] - a[0]) * wx + (cx[1] - a[1]) * wy) / L))
        kx = 111320 * math.cos(math.radians(lat0))
        new = ((a[0] + wx * t) / kx, (a[1] + wy * t) / 110570)
        nodes[n] = new
        for i in ls:
            l = links[i]
            g = l["geom"] if l["a"] == n else l["geom"][::-1]
            if i == i1:
                g = [new] + g[k1:]
            elif i == i2:
                g = [new] + g[k2:]
            else:
                g = [new] + g[1:]
            l["geom"] = g if l["a"] == n else g[::-1]
        moved += 1
    return moved


BRANCH_KM, BRANCH_DEG = 0.8, 25.0


def tangent_branches(nodes, links):
    """철도 분기점에서 지선이 본선과 수직으로 만나면(남포 인근 등), 지선 첫 BRANCH_KM을 본선 방향으로 나가다 휘어
    원래 선로에 합류하는 곡선으로 다시 그린다 (그림만: 길이·연결은 그대로). 고친 지선 수를 돌려준다"""
    from collections import defaultdict
    adj = defaultdict(list)
    for i, l in enumerate(links):
        if l["mode"] in (1, 2) and None not in l["geom"] and len(l["geom"]) >= 2 and l["a"] != l["b"]:
            adj[l["a"]].append(i)
            adj[l["b"]].append(i)
    fixed = 0
    for n, ls in adj.items():
        if len(ls) < 3:
            continue
        c = (float(nodes[n][0]), float(nodes[n][1]))
        lat0 = c[1]
        P = lambda q: _xy(q, lat0)
        cx = P(c)
        out = {i: (links[i]["geom"] if links[i]["a"] == n else links[i]["geom"][::-1]) for i in ls}

        def heading(g):
            for q in g[1:]:
                x, y = P(q)
                d = math.hypot(x - cx[0], y - cx[1])
                if d > 100:
                    return ((x - cx[0]) / d, (y - cx[1]) / d)
            return None
        hd = {i: heading(out[i]) for i in ls}
        ls2 = [i for i in ls if hd[i]]
        if len(ls2) < 3:
            continue
        # 곧게 이어지는 본선 쌍: 나가는 방향이 가장 반대인 두 구간 (같은 수단끼리)
        best, bc = None, 0.0
        for a in range(len(ls2)):
            for b in range(a + 1, len(ls2)):
                i, j = ls2[a], ls2[b]
                if links[i]["mode"] != links[j]["mode"]:
                    continue
                cos = hd[i][0] * hd[j][0] + hd[i][1] * hd[j][1]
                if cos < bc:
                    bc, best = cos, (i, j)
        if not best or bc > -0.85:
            continue
        for k in ls2:
            if k in best or links[k]["mode"] != links[best[0]]["mode"]:
                continue
            h = hd[k]
            m = max((hd[best[0]], hd[best[1]]), key=lambda v: v[0] * h[0] + v[1] * h[1])
            ang = math.degrees(math.acos(max(-1, min(1, m[0] * h[0] + m[1] * h[1]))))
            if ang < BRANCH_DEG or ang > 120:
                continue
            g = [P(q) for q in out[k]]
            total = sum(math.hypot(g[t + 1][0] - g[t][0], g[t + 1][1] - g[t][1]) for t in range(len(g) - 1))
            D = min(BRANCH_KM * 1000, total * 0.4)
            if D < 200:
                continue
            # 지선 위 D 지점(Q)과 그 자리 방향
            acc, Q, tq, cut = 0.0, None, None, None
            for t in range(len(g) - 1):
                seg = math.hypot(g[t + 1][0] - g[t][0], g[t + 1][1] - g[t][1])
                if acc + seg >= D and seg > 0:
                    u = (D - acc) / seg
                    Q = (g[t][0] + (g[t + 1][0] - g[t][0]) * u, g[t][1] + (g[t + 1][1] - g[t][1]) * u)
                    tq = ((g[t + 1][0] - g[t][0]) / seg, (g[t + 1][1] - g[t][1]) / seg)
                    cut = t + 1
                    break
                acc += seg
            if Q is None:
                continue
            L = D / 2.5
            p1 = (cx[0] + m[0] * L, cx[1] + m[1] * L)
            p2 = (Q[0] - tq[0] * L, Q[1] - tq[1] * L)
            curve = []
            for s_ in range(13):
                t_ = s_ / 12
                u_ = 1 - t_
                curve.append((u_ ** 3 * cx[0] + 3 * u_ * u_ * t_ * p1[0] + 3 * u_ * t_ * t_ * p2[0] + t_ ** 3 * Q[0],
                              u_ ** 3 * cx[1] + 3 * u_ * u_ * t_ * p1[1] + 3 * u_ * t_ * t_ * p2[1] + t_ ** 3 * Q[1]))
            kx = 111320 * math.cos(math.radians(lat0))
            newg = [out[k][0]] + [(x / kx, y / 110570) for x, y in curve[1:]] + out[k][cut:]
            links[k]["geom"] = newg if links[k]["a"] == n else newg[::-1]
            fixed += 1
    return fixed


def write_net(data, meta, nodes, links):
    """노드 좌표·링크 길이·도형을 network.bin에 다시 쓴다 (나머지 열은 그대로)"""
    meta_path, bin_path = data / "network.meta.json", data / "network.bin"
    buf = bytearray(bin_path.read_bytes())
    N, L = meta["nodes"], meta["links"]
    buf[0:N * 8] = np.round(np.asarray(nodes, dtype=np.float64) * netpack.SCALE).astype("<i4").tobytes()
    off_len = N * 8 + L * 4 * 2
    buf[off_len:off_len + L * 4] = np.array([l["len"] for l in links], "<f4").tobytes()
    off = 0
    for size in [N * 2 * 4, L * 4, L * 4, L * 4, L * 2, L * 2, L * 2] + [L] * 7 + ([L * 2] if meta.get("hasOpen") else []):
        off += size
        off += (-off) % 4
    counts = np.array([len(l["geom"]) for l in links], "<u4")
    raw = np.array([(math.nan, math.nan) if p is None else p for l in links for p in l["geom"]], dtype=np.float64).ravel() * netpack.SCALE
    verts = netpack.encode_verts(raw)
    out = bytes(buf[:off]) + counts.tobytes()
    out += b"\0" * ((-len(out)) % 4)
    out += verts.tobytes()
    out += b"\0" * ((-len(out)) % 4)
    bin_path.write_bytes(out)
    meta["verts"], meta["vertBytes"] = int(len(raw) // 2), int(len(verts))
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("network.bin", round(len(out) / 1e6, 2), "MB")


def main():
    check = "--check" in sys.argv
    data = ROOT / "data"
    nodes, links_, meta = netread.read(data)
    nodes = [tuple(map(float, q)) for q in nodes]
    net = {"links": links_}
    for l in links_:   # NaN 구분자 → None
        l["geom"] = [None if x != x else (x, y) for x, y in l["geom"]]
    total = links = 0
    for l in net["links"]:
        if l["mode"] not in (1, 2) and l["cls"] not in ("motorway", "trunk", "primary"):
            continue
        g, f = smooth_geom(l["geom"], zig=l["mode"] != 0)   # 도로는 산길 굽이를 펴지 않게 지그재그 규칙을 빼고
        if f:
            total += f
            links += 1
            l["geom"] = g
    print("fixed", total, "vertices on", links, "rail/metro/main-road links")
    if "--geom-only" not in sys.argv:   # 노드를 옮기지 않고 그림용 선형만 고칠 때 (기준선을 다시 계산하지 않아도 된다)
        print("straightened", straighten_nodes(nodes, net["links"]), "nodes onto their through line")
    print("bundled", bundle(net["links"]), "links onto parallel lines")
    print("tangent branches", tangent_branches(nodes, net["links"]), "branch links")
    if check:
        return
    write_net(data, meta, nodes, net["links"])


if __name__ == "__main__":
    main()

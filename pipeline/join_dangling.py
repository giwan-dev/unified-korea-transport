"""철도 선로의 막다른 끝이 다른 선로 위(50m 안)에 닿아 있는데 노드로 이어지지 않은 곳을 잇는다.

OSM 선로가 다른 선로 중간에 닿기만 하고 꼭짓점을 공유하지 않으면, 계산망에서는 그 선로가 끊긴 지선이 된다
(보통강 옆 경의선 연결선이 평남선에 닿지 않아 보통강–서평양 직선화·개량·신설 접속이 안 되던 것, 교외선–경원선, 오송선–경부선 등).
닿은 선로를 그 자리에서 둘로 나눠 새 노드를 만들고, 막다른 끝을 그 노드에 붙인다 (그 노드 20m 안이면 기존 끝 노드에).
막다른 끝과 닿은 선로가 이미 노드를 공유하는 경우(역을 본선 노드로 옮기고 남은 짜투리 등)는 건드리지 않는다.
노드·링크가 늘어나므로 data/meta.json의 데이터 표지(stamp)를 새로 하고 기준 연도 계산(tools/baseline.html)을 다시 돌린다.

  .venv/Scripts/python -X utf8 pipeline/join_dangling.py --check
  .venv/Scripts/python -X utf8 pipeline/join_dangling.py
"""
from __future__ import annotations

import datetime
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from join_stations import DATA, read_raw, write_raw  # noqa: E402
import netpack  # noqa: E402

HSR = netpack.CLASSES.index("hsr")

MAX_KM = 0.05      # 막다른 끝과 다른 선로 사이 거리
SNAP_KM = 0.02     # 닿는 자리가 그 선로 끝 노드에서 이만큼 안이면 그 노드에 붙인다


def km(a, b):
    c = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * c, a[1] - b[1]) * 111.32


def project(p, g):
    """점 p에서 꺾은선 g에 가장 가까운 자리: (거리 km, 구간 번호 k, 그 자리 점, 처음부터 거리 비율)"""
    best = None
    total = sum(km(g[k], g[k + 1]) for k in range(len(g) - 1)) or 1e-9
    acc = 0.0
    for k in range(len(g) - 1):
        a, b = g[k], g[k + 1]
        c = math.cos(math.radians(a[1]))
        ax, ay, bx, by, px, py = a[0] * c, a[1], b[0] * c, b[1], p[0] * c, p[1]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1e-18)))
        q = (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        d = km(p, q)
        seg = km(a, b)
        if best is None or d < best[0]:
            best = (d, k, q, (acc + t * seg) / total)
        acc += seg
    return best


def main():
    check = "--check" in sys.argv
    meta, nodes, cols, geoms = read_raw()
    names = meta["names"]
    stations = {n for _, n in meta["stations"]}
    rail = [i for i in range(len(geoms)) if cols["mode"][i] == 1]
    inc = defaultdict(list)
    for i in rail:
        for n in (int(cols["a"][i]), int(cols["b"][i])):
            inc[n].append(i)
    clean = lambda g: g and len(g) >= 2 and not any(v != v for xy in g for v in xy)   # NaN(조각 나눔) 없는 도형만
    new_nodes, joins = [], []
    used = set()   # 이번에 나눈 링크 (한 번에 하나만 나눈다)
    for n, own in inc.items():
        if len(own) != 1:
            continue
        o = own[0]
        p = (float(nodes[n][0]), float(nodes[n][1]))
        mine = {int(cols["a"][o]), int(cols["b"][o])}
        best = None
        for i in rail:
            if i == o or i in used or not clean(geoms[i]):
                continue
            a, b = int(cols["a"][i]), int(cols["b"][i])
            if a in mine or b in mine:
                continue
            # 일반 선로가 고속선 옆을 스치는 것은 잇지 않는다 (장성화물선–호남고속선): 고속선끼리나 이름에 '연결'이 든 연결선만
            if cols["cls"][i] == HSR and cols["cls"][o] != HSR and "연결" not in (names[cols["name"][o]] or ""):
                continue
            g = geoms[i]
            xs = [v[0] for v in g]; ys = [v[1] for v in g]
            if not (min(xs) - 0.002 <= p[0] <= max(xs) + 0.002 and min(ys) - 0.002 <= p[1] <= max(ys) + 0.002):
                continue
            pr = project(p, g)
            if pr[0] <= MAX_KM and (best is None or pr[0] < best[1][0]):
                best = (i, pr)
        if best:
            used.add(best[0])
            joins.append((n, o, best[0], best[1]))
    print("이을 막다른 끝", len(joins))
    for n, o, i, (d, k, q, f) in joins:
        print(f"  {names[cols['name'][o]]} 끝 {n} → {names[cols['name'][i]]} {d * 1000:.0f}m")
    if check or not joins:
        return
    N0 = len(nodes)
    for n, o, i, (d, k, q, f) in joins:
        a, b = int(cols["a"][i]), int(cols["b"][i])
        g = geoms[i]
        # 닿는 자리가 끝 노드 가까이면 그 노드에, 아니면 선로를 나눠 새 노드
        if km(q, g[0]) <= SNAP_KM:
            m = a
        elif km(q, g[-1]) <= SNAP_KM:
            m = b
        else:
            m = N0 + len(new_nodes)
            new_nodes.append(q)
            part1, part2 = list(g[:k + 1]) + [q], [q] + list(g[k + 1:])
            L0 = float(cols["len"][i])
            for key in cols:
                cols[key] = np.append(cols[key], cols[key][i])
            j = len(cols["a"]) - 1
            cols["b"][i], cols["len"][i] = m, round(max(0.01, L0 * f), 2)
            cols["a"][j], cols["b"][j], cols["len"][j] = m, b, round(max(0.01, L0 * (1 - f)), 2)
            geoms[i] = part1
            geoms.append(part2)
        # 막다른 끝 노드 n을 m으로 옮긴다 (역이 아니면), 역이면 짧은 연결 링크
        if n not in stations:
            for key in ("a", "b"):
                if int(cols[key][o]) == n:
                    cols[key][o] = m
            go = list(geoms[o])
            mp = q if m >= N0 else (float(nodes[m][0]), float(nodes[m][1]))
            if km(go[0], p := (float(nodes[n][0]), float(nodes[n][1]))) < km(go[-1], p):
                go[0] = mp
            else:
                go[-1] = mp
            geoms[o] = go
        else:
            for key in cols:
                cols[key] = np.append(cols[key], cols[key][o])
            j = len(cols["a"]) - 1
            cols["a"][j], cols["b"][j], cols["len"][j] = n, m, round(max(0.01, d), 2)
            geoms.append([(float(nodes[n][0]), float(nodes[n][1])), q])
    if new_nodes:
        nodes = np.vstack([nodes, np.array(new_nodes)])
    meta["nodes"] = len(nodes)
    write_raw(meta, nodes, cols, geoms)
    m = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    m["stamp"] = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    (DATA / "meta.json").write_text(json.dumps(m), encoding="utf-8")
    print("새 노드", len(new_nodes), "stamp", m["stamp"])


if __name__ == "__main__":
    main()

"""도시철도 열차가 직통하는 코레일 광역 노선을 그 도시철도 노선으로 바꾼다 (일산선 = 3호선, 과천선·안산선 = 4호선).

OSM·철도 DB는 이 선로를 코레일 일반철도로 적지만, 실제로는 서울 지하철 3·4호선 열차가 그대로 이어 달리고
요금·환승도 도시철도와 같다. 일반철도(mode 1)로 두면 도시철도 그래프와 끊겨 지축·남태령에서 갈아타야 하는
것처럼 계산되므로, 도시철도(mode 2)로 바꾸고 이름·표정 속도를 직통하는 도시철도 노선에 맞춘다.
바뀐 노선의 끝이 그 도시철도 노선과 따로 놓여 있으면 잇는다: 150m 안이면 같은 노드로 합치고(지축),
2km 안이면 도시철도 구간을 하나 붙인다(OSM의 4호선 도시철도 구간이 사당에서 끝나 사당–남태령이 빠져 있다).
선로가 바뀐 역은 도시철도역 목록에 넣는다 (다른 일반철도가 닿지 않는 역은 일반철도역 목록에서 뺀다: 금정은 둘 다).
수단이 바뀌고 링크가 늘 수 있으므로 data/meta.json의 데이터 표지(stamp)를 새로 하고 기준 연도 계산(tools/baseline.html)을 다시 돌린다.

  .venv/Scripts/python -X utf8 pipeline/through_metro.py --check
  .venv/Scripts/python -X utf8 pipeline/through_metro.py
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
import netpack  # noqa: E402
from join_stations import DATA, read_raw, write_raw  # noqa: E402

THROUGH = {"일산선": "수도권 전철 3호선", "과천선": "수도권 전철 4호선", "안산선": "수도권 전철 4호선"}
# 거꾸로: 코레일 광역전철이 직통하는 도시철도 구간은 일반철도로 (1호선 서울역–청량리 지하 구간 = 경부선·경원선 전철이 지나간다).
# 경부·경인·경원선은 KTX·화물도 다녀 도시철도로 바꿀 수 없으므로, 짧은 지하 구간 쪽을 일반철도로 바꿔 계통이 지나가게 한다
TO_RAIL = {"수도권 전철 1호선": ("서울 지하철 1호선", ["경부선", "경원선"])}
# 도시철도로 바꾼 선로를 코레일 광역전철이 함께 쓰는 구간: 같은 선로를 일반철도 링크로 한 벌 더 둔다
# (수인·분당선 열차가 안산선 오이도–한대앞을 4호선과 같이 다닌다. 빠지면 수인선이 끊겨 경인선으로 돌아간다).
# (도시철도 노선, 일반철도 노선, 이 노선의 끊긴 두 끝 노드를 찾을 이름)
SHARED = [("수도권 전철 4호선", "수인선")]
CLS = netpack.CLASSES


def main():
    check = "--check" in sys.argv
    meta, nodes, cols, geoms = read_raw()
    changed = to_metro(meta, nodes, cols, geoms)
    changed = to_rail(meta, nodes, cols, geoms) or changed
    changed = unstub_stations(meta, cols, geoms) or changed
    changed = share_rail(meta, nodes, cols, geoms) or changed
    if check or not changed:
        return
    write_raw(meta, nodes, cols, geoms)
    m = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    m["stamp"] = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    (DATA / "meta.json").write_text(json.dumps(m), encoding="utf-8")
    print("stamp", m["stamp"])


def append_link(cols, geoms, tmpl, a, b, length, nodes):
    for k in list(cols):
        cols[k] = np.append(cols[k], cols[k][tmpl])
    j = len(cols["a"]) - 1
    cols["a"][j], cols["b"][j], cols["len"][j] = a, b, round(length, 2)
    geoms.append([tuple(nodes[a]), tuple(nodes[b])])
    return j


def to_rail(meta, nodes, cols, geoms):
    names = meta["names"]
    L = len(geoms)
    conv_cls = CLS.index("conv")
    km = lambda a, b: math.hypot((nodes[a][0] - nodes[b][0]) * 88.5, (nodes[a][1] - nodes[b][1]) * 111)
    st_name = {n: nm for nm, n in meta["stations"] + meta.get("metro_stations", [])}
    done = False
    for src, (dst, joins) in TO_RAIL.items():
        if src not in names:
            continue
        si = names.index(src)
        conv = [i for i in range(L) if cols["mode"][i] == 2 and cols["name"][i] == si]
        if not conv:
            continue
        done = True
        if dst not in names:
            names.append(dst)
        di = names.index(dst)
        for i in conv:
            cols["mode"][i], cols["cls"][i], cols["name"][i], cols["speed"][i] = 1, conv_cls, di, 80
        deg = defaultdict(int)
        for i in conv:
            for n in (int(cols["a"][i]), int(cols["b"][i])):
                deg[n] += 1
        cand = {int(n) for i in range(L) if cols["mode"][i] == 1 and names[cols["name"][i]] in joins for n in (cols["a"][i], cols["b"][i])}
        added = []
        for e in [n for n in deg if deg[n] == 1]:
            # 같은 이름 역(1km 안)이 있으면 그 역에, 없으면 가장 가까운 노드에
            same = [m for m in cand if st_name.get(m) and st_name.get(m) == st_name.get(e) and km(e, m) < 1]
            b = min(same or cand, key=lambda m: km(e, m))
            d = km(e, b)
            if d < 0.01 or d > 2:
                continue
            added.append(append_link(cols, geoms, conv[0], e, b, d * 1.1, nodes))
            print(src, "end", st_name.get(e), e, "->", st_name.get(b), b, round(d, 2), "km")
        touched = {int(n) for i in conv + added for n in (cols["a"][i], cols["b"][i])}
        L = len(geoms)
        metro_at = defaultdict(int)
        for i in range(L):
            if cols["mode"][i] == 2:
                for n in (int(cols["a"][i]), int(cols["b"][i])):
                    metro_at[n] += 1
        have = {n for _, n in meta["stations"]}
        for nm, n in list(meta.get("metro_stations", [])):
            if n in touched and n not in have:
                meta["stations"].append([nm, n]); have.add(n)
        meta["metro_stations"] = [[nm, n] for nm, n in meta.get("metro_stations", []) if not (n in touched and metro_at[n] == 0)]
        print(len(conv), "links", src, "->", dst, "(일반철도),", len(added), "joins")
    return done


def unstub_stations(meta, cols, geoms):
    """선로 옆 300m 안 짜투리 끝에 붙은 역(정왕·부개·단대오거리 등)을 짜투리가 갈라지는 본선 노드로 옮긴다.
    역이 짜투리 끝에 있으면 본선을 지나는 열차가 그 역을 지나지 않아 서지 못한다"""
    inc = defaultdict(list)
    for i in range(len(geoms)):
        if cols["mode"][i] in (1, 2):
            for n in (int(cols["a"][i]), int(cols["b"][i])):
                inc[n].append(i)
    taken = {n for key in ("stations", "metro_stations") for _, n in meta.get(key, [])}
    move = {}
    for key in ("stations", "metro_stations"):
        for nm, n in meta.get(key, []):
            if len(inc[n]) != 1:
                continue
            i = inc[n][0]
            o = int(cols["b"][i]) if int(cols["a"][i]) == n else int(cols["a"][i])
            if float(cols["len"][i]) < 0.3 and len(inc[o]) >= 3 and o not in taken:
                move[n] = o
    for key in ("stations", "metro_stations"):
        meta[key] = [[nm, move.get(n, n)] for nm, n in meta.get(key, [])]
    if move:
        print("stations moved off stubs:", len(move))
    return bool(move)


def share_rail(meta, nodes, cols, geoms):
    """일반철도 노선의 끊긴 두 끝을 도시철도 노선 선로로 잇는다: 그 선로를 일반철도 링크로 복제한다"""
    import heapq
    names = meta["names"]
    conv_cls = CLS.index("conv")
    done = False
    for metro, rail in SHARED:
        if metro not in names or rail not in names:
            continue
        mi, ri = names.index(metro), names.index(rail)
        L = len(geoms)
        deg = defaultdict(int)
        for i in range(L):
            if cols["mode"][i] == 1 and cols["name"][i] == ri:
                for n in (int(cols["a"][i]), int(cols["b"][i])):
                    deg[n] += 1
        adj = defaultdict(list)
        for i in range(L):
            if cols["mode"][i] == 2 and cols["name"][i] == mi:
                a, b = int(cols["a"][i]), int(cols["b"][i])
                adj[a].append((b, i)); adj[b].append((a, i))
        # 이미 함께 쓰는 구간의 도시철도역은 일반철도역이기도 하다 (짜투리에서 옮겨 온 정왕 등)
        pairs = {frozenset((int(cols["a"][i]), int(cols["b"][i]))) for i in range(L) if cols["mode"][i] == 2 and cols["name"][i] == mi}
        on = {n for i in range(L) if cols["mode"][i] == 1 and cols["name"][i] == ri
              and frozenset((int(cols["a"][i]), int(cols["b"][i]))) in pairs for n in (int(cols["a"][i]), int(cols["b"][i]))}
        have = {n for _, n in meta["stations"]}
        back = [[nm, n] for nm, n in meta.get("metro_stations", []) if n in on and n not in have]
        if back:
            meta["stations"] += back
            done = True
            print(rail, "shared stations back to rail:", [nm for nm, _ in back])
        ends = [n for n, d in deg.items() if d == 1 and n in adj]
        if len(ends) < 2:
            continue
        # 도시철도 선로 위에 놓인 두 끝 사이 가장 짧은 길
        best = None
        for s in ends:
            dist, prev, h = {s: 0.0}, {}, [(0.0, s)]
            while h:
                x, u = heapq.heappop(h)
                if x > dist[u]:
                    continue
                for v, i in adj[u]:
                    nx = x + float(cols["len"][i])
                    if nx < dist.get(v, 1e18):
                        dist[v], prev[v] = nx, (u, i); heapq.heappush(h, (nx, v))
            for t in ends:
                if t != s and t in dist and (best is None or dist[t] < best[0]):
                    p, v = [], t
                    while v != s:
                        u, i = prev[v]; p.append((i, u, v)); v = u
                    best = (dist[t], p[::-1])
        if not best or best[0] > 30:
            continue
        done = True
        rail_tmpl = next(i for i in range(L) if cols["mode"][i] == 1 and cols["name"][i] == ri)
        touched = set()
        for i, u, v in best[1]:
            j = append_link(cols, geoms, rail_tmpl, u, v, float(cols["len"][i]), nodes)
            geoms[j] = list(geoms[i]) if int(cols["a"][i]) == u else list(reversed(geoms[i]))
            touched |= {u, v}
        have = {n for _, n in meta["stations"]}
        back = [[nm, n] for nm, n in meta.get("metro_stations", []) if n in touched and n not in have]
        meta["stations"] += back
        print(rail, "shares", metro, round(best[0], 2), "km,", len(best[1]), "links,", len(back), "stations back to rail")
    return done


def to_metro(meta, nodes, cols, geoms):
    names = meta["names"]
    L = len(geoms)
    metro_cls = CLS.index("metro")
    target = {names.index(m) for m in set(THROUGH.values())}
    speed = {}
    for t in target:
        sp = [int(cols["speed"][i]) for i in range(L) if cols["mode"][i] == 2 and cols["name"][i] == t]
        speed[t] = int(np.median(sp)) if sp else 35
    conv = [i for i in range(L) if cols["mode"][i] == 1 and (names[cols["name"][i]] or "") in THROUGH]
    if not conv:
        return False
    km = defaultdict(float)
    for i in conv:
        km[names[cols["name"][i]]] += float(cols["len"][i])
    print({k: round(v, 1) for k, v in km.items()})
    for i in conv:
        t = names.index(THROUGH[names[cols["name"][i]]])
        cols["mode"][i], cols["cls"][i], cols["name"][i], cols["speed"][i] = 2, metro_cls, t, speed[t]
    # 바뀐 노선 끝(바뀐 구간끼리 한쪽만 닿는 노드)을 같은 이름의 원래 도시철도 선로에 잇는다
    conv_set = set(conv)
    deg = defaultdict(int)
    for i in conv:
        for n in (int(cols["a"][i]), int(cols["b"][i])):
            deg[n] += 1
    km = lambda a, b: math.hypot((nodes[a][0] - nodes[b][0]) * 88.5, (nodes[a][1] - nodes[b][1]) * 111)
    merge, add = {}, []
    for t in target:
        orig = {int(n) for i in range(L) if i not in conv_set and cols["mode"][i] == 2 and cols["name"][i] == t for n in (cols["a"][i], cols["b"][i])}
        ends = [n for n in deg if deg[n] == 1 and any(cols["name"][i] == t and n in (int(cols["a"][i]), int(cols["b"][i])) for i in conv)]
        for e in ends:
            if e in orig or not orig:
                continue
            b = min(orig, key=lambda m: km(e, m))
            d = km(e, b)
            if d < 0.15:
                merge[e] = b
            elif d < 2.0:
                add.append((e, b, d, t))
    for i in range(L):
        for k in ("a", "b"):
            n = int(cols[k][i])
            if n in merge:
                cols[k][i] = merge[n]
                g = geoms[i]
                if g:
                    j = 0 if k == "a" else -1
                    g[j] = tuple(nodes[merge[n]])
    print("merged", merge)
    if add:
        tmpl = next(i for i in range(L) if i not in conv_set and cols["mode"][i] == 2 and cols["name"][i] == add[0][3])
        for e, b, d, t in add:
            j = append_link(cols, geoms, tmpl, e, b, d * 1.1, nodes)
            cols["name"][j], cols["speed"][j] = t, speed[t]
            print("added link", e, "->", b, round(d, 2), "km", names[t])
    L = len(geoms)
    touched = {int(n) for i in list(conv) + list(range(L - len(add), L)) for n in (cols["a"][i], cols["b"][i])}
    rail_at = defaultdict(int)
    for i in range(L):
        if cols["mode"][i] == 1:
            for n in (int(cols["a"][i]), int(cols["b"][i])):
                rail_at[n] += 1
    stations = meta["stations"]
    metro_st = [[nm, merge.get(n, n)] for nm, n in meta.get("metro_stations", [])]
    have_m = {n for _, n in metro_st}
    moved = kept = 0
    out_st = []
    for nm, n in stations:
        n = merge.get(n, n)
        if n in touched:
            if n not in have_m:
                metro_st.append([nm, n]); have_m.add(n)
            if rail_at[n] == 0:
                moved += 1
                continue
            kept += 1
        out_st.append([nm, n])
    print(len(conv), "links converted;", moved, "stations moved to metro,", kept, "kept as both")
    meta["stations"], meta["metro_stations"] = out_st, metro_st
    return True


if __name__ == "__main__":
    main()

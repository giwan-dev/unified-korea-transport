"""북측 선로·도로 자료 정리.

- OSM이 '경의선'으로 적은 북측 연결선(보통강–간리, 동평양–대동강, 물개)은 양 끝 역 이름의 연결선으로 바꾼다 (북측에는 경의선이 없다).
OSM에는 2029년 개통 예정으로 적힌 북측 고속도로 공사 구간이 둘 있다.
- 원산–함흥 고속도로(동경 127°대, 원산 북쪽~함흥 남쪽): 실제 공사 진척이 확인되지 않아 뺀다 (계획 사업으로만 둔다).
- 향산–희천: 평양희천고속도로의 남은 구간이라 이름을 붙여 기존 고속도로와 한 노선으로 잇는다
  (평양–강계 고속도로 계획이 이 노선의 연장이 된다).
링크가 빠지므로 data/meta.json의 데이터 표지(stamp)를 새로 하고 기준 연도 계산(tools/baseline.html)을 다시 돌린다.

  .venv/Scripts/python -X utf8 pipeline/kp_roads.py --check
  .venv/Scripts/python -X utf8 pipeline/kp_roads.py
"""
from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import netpack  # noqa: E402
from join_stations import DATA, read_raw, write_raw  # noqa: E402

MOTORWAY = netpack.CLASSES.index("motorway")
# (경도 범위, 위도 범위): 이 안의 개통 예정 고속도로 링크
DROP = ((127.0, 127.8), (39.1, 40.0))          # 원산–함흥
NAME = ((126.1, 126.3), (39.99, 40.2), "평양희천고속도로")   # 향산–희천


def inside(nodes, i, cols, box):
    (x0, x1), (y0, y1) = box[:2]
    return all(x0 <= nodes[int(cols[k][i])][0] <= x1 and y0 <= nodes[int(cols[k][i])][1] <= y1 for k in ("a", "b"))


def rename_kp_gyeongui(meta, nodes, cols, geoms, check):
    """북측 선로 가운데 OSM이 '경의선'으로 적은 연결선(보통강–서평양–산음–간리, 동평양–대동강 등)을
    양 끝 역 이름의 연결선으로 바꾼다. 북측에는 경의선이 없다(평부선·평의선): 게임의 노선 이름 합치기를 하기 전에는
    평양 시내에 경의선이 보이면 안 된다"""
    import math
    from collections import defaultdict
    names = meta["names"]
    if "경의선" not in names:
        return 0
    k = names.index("경의선")
    ids = [i for i in range(len(geoms)) if cols["mode"][i] == 1 and cols["name"][i] == k and int(cols["kp"][i]) == 1]
    if not ids:
        return 0
    km = lambda a, b: math.hypot((a[0] - b[0]) * 0.78, a[1] - b[1]) * 111.32
    st = meta["stations"]
    # 이어진 묶음
    adj = defaultdict(list)
    for i in ids:
        a, b = int(cols["a"][i]), int(cols["b"][i])
        adj[a].append((b, i)); adj[b].append((a, i))
    seen, groups = set(), []
    for i in ids:
        if i in seen:
            continue
        stack, g = [int(cols["a"][i])], set()
        visited = set()
        while stack:
            u = stack.pop()
            if u in visited:
                continue
            visited.add(u)
            for v, j in adj[u]:
                if j not in g:
                    g.add(j); stack.append(v)
        seen |= g
        groups.append((g, visited))
    n = 0
    for g, ns in groups:
        # 묶음에서 가장 먼 두 노드의 가까운 역
        ns = list(ns)
        a, b = max(((x, y) for x in ns for y in ns), key=lambda t: km(nodes[t[0]], nodes[t[1]]))
        sa = min(st, key=lambda s: km(nodes[s[1]], nodes[a]))[0]
        sb = min(st, key=lambda s: km(nodes[s[1]], nodes[b]))[0]
        new = f"{sa}–{sb} 연결선" if sa != sb else f"{sa} 연결선"
        print("북측 '경의선'", len(g), "링크", round(sum(float(cols["len"][j]) for j in g), 1), "km →", new)
        if check:
            continue
        if new not in names:
            names.append(new)
        for j in g:
            cols["name"][j] = names.index(new)
        n += 1
    return n


def main():
    check = "--check" in sys.argv
    meta, nodes, cols, geoms = read_raw()
    renamed = rename_kp_gyeongui(meta, nodes, cols, geoms, check)
    names = meta["names"]
    L = len(geoms)
    building = [i for i in range(L) if cols["mode"][i] == 0 and cols["cls"][i] == MOTORWAY and int(cols["open"][i]) > 0]
    drop = {i for i in building if inside(nodes, i, cols, DROP)}
    rename = [i for i in building if inside(nodes, i, cols, NAME) and names[cols["name"][i]] != NAME[2]]
    print("원산–함흥 공사 구간", len(drop), "링크", round(sum(float(cols["len"][i]) for i in drop), 1), "km 삭제")
    print("향산–희천", len(rename), "링크에", NAME[2], "이름")
    if check or not (drop or rename or renamed):
        return
    if NAME[2] not in names:
        names.append(NAME[2])
    for i in rename:
        cols["name"][i] = names.index(NAME[2])
    keep = np.array([i not in drop for i in range(L)])
    for k in cols:
        cols[k] = cols[k][keep]
    geoms[:] = [g for i, g in enumerate(geoms) if keep[i]]
    write_raw(meta, nodes, cols, geoms)
    m = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
    m["stamp"] = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    (DATA / "meta.json").write_text(json.dumps(m), encoding="utf-8")
    print("stamp", m["stamp"])


if __name__ == "__main__":
    main()

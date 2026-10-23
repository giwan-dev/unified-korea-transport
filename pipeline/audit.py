"""노선망 전국 검수: build_data.py가 만든 노드·링크를 살펴 문제 유형별 개수와 예시 위치를 data/audit.json에 남긴다.

검사 항목 (수단별: 도로 0, 철도 1, 도시철도 2)
- zigzag     선 중간에서 100°보다 날카롭게 꺾이는 곳이 두 번 이상인 링크 (지그재그)
- sharp      선 중간의 급꺾임(100° 이상) 개수
- nub        노드에서 선이 되돌아가는 끝 (쥐젖처럼 튀어나옴)
- parallel   같은 이름 노선이 250m 안에서 나란히 두 줄 (끝 노드를 함께 쓰지 않음)
- midbreak   역·IC·JCT·휴게소가 아닌 곳에서 같은 노선이 끊긴 노드 (구간이 역–역, IC–IC가 아님)
- deadend    역이 아닌 막다른 끝 (철도·도시철도)
- island     본선에서 떨어진 철도 덩어리 (역 2개 미만)
- nostation  역 없이 15km 넘게 이어지는 철도 구간 (남측, 개통 노선)
- straight   도형 없이 직선으로 그은 3km 넘는 링크 (인위적 직선)
- ramp       연결로만으로 된 짧은 도로 링크 (IC 연결로가 접속점으로 단순화되지 않은 곳)
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

MODES = {0: "road", 1: "rail", 2: "metro"}


def _pts(geom):
    return [(geom[i], geom[i + 1]) for i in range(0, len(geom) - 1, 2) if geom[i] == geom[i]]


def _turn(a, b, c):
    """b에서 꺾이는 각도(도): 0이면 곧게, 180이면 되돌아감"""
    v1 = ((b[0] - a[0]) * 0.8, b[1] - a[1]); v2 = ((c[0] - b[0]) * 0.8, c[1] - b[1])
    n = math.hypot(*v1) * math.hypot(*v2)
    if n == 0:
        return 0.0
    return math.degrees(math.acos(max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / n))))


def _km(a, b):
    return math.hypot((a[0] - b[0]) * 88.0, (a[1] - b[1]) * 111.0)


def audit(nodes, links, stations, metro_stations, junctions, out_path: Path, extra_stops=()):
    st = {n for _, n in stations}
    mst = {n for _, n in metro_stations}
    jn = {n for _, n in junctions} | set(extra_stops)
    stops = {0: jn, 1: st, 2: mst}
    res = {}
    for mode, label in MODES.items():
        ls = [(i, l) for i, l in enumerate(links) if l["mode"] == mode and not l.get("ext")]
        found = defaultdict(list)
        at = defaultdict(list)
        for i, l in ls:
            at[l["a"]].append(i); at[l["b"]].append(i)
        for i, l in ls:
            p = _pts(l["geom"])
            if len(p) >= 3:
                turns = [_turn(p[k - 1], p[k], p[k + 1]) for k in range(1, len(p) - 1)]
                sharp = [k for k, t in enumerate(turns, 1) if t > 100]
                for k in sharp:
                    found["sharp"].append(p[k])
                if len(sharp) >= 2:
                    found["zigzag"].append(p[sharp[0]])
                if turns and (turns[0] > 120 or turns[-1] > 120):
                    found["nub"].append(p[0] if turns[0] > 120 else p[-1])
            if len(p) <= 2 and l["len"] > 3:
                found["straight"].append(nodes[l["a"]])
            if mode == 0 and l.get("ramp") and l["len"] < 1.5:
                found["ramp"].append(nodes[l["a"]])
        # 구간 단위: 같은 이름 노선 두 링크만 만나는 노드인데 역·IC가 아님
        for n, ids in at.items():
            if len(ids) == 2 and n not in stops[mode]:
                x, y = links[ids[0]], links[ids[1]]
                if x["name"] == y["name"] and x.get("open", 0) == y.get("open", 0) and x["cls"] == y["cls"]:
                    found["midbreak"].append(nodes[n])
            if len(ids) == 1 and mode >= 1 and n not in stops[mode]:
                found["deadend"].append(nodes[n])
        # 나란한 같은 이름 두 줄
        grid = defaultdict(list)
        mids = {}
        for i, l in ls:
            if not l["name"] or l["len"] < 0.3:
                continue
            p = _pts(l["geom"])
            m = p[len(p) // 2]
            mids[i] = m
            grid[(round(m[0] * 200), round(m[1] * 200))].append(i)
        seen = set()
        for i, m in mids.items():
            l = links[i]
            gx, gy = round(m[0] * 200), round(m[1] * 200)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid.get((gx + dx, gy + dy), ()):
                        if j <= i or (i, j) in seen:
                            continue
                        o = links[j]
                        if o["name"] != l["name"] or {o["a"], o["b"]} & {l["a"], l["b"]}:
                            continue
                        if _km(mids[j], m) > 0.25:
                            continue
                        a1, b1 = nodes[l["a"]], nodes[l["b"]]; a2, b2 = nodes[o["a"]], nodes[o["b"]]
                        d1 = ((b1[0] - a1[0]) * 0.8, b1[1] - a1[1]); d2 = ((b2[0] - a2[0]) * 0.8, b2[1] - a2[1])
                        nn = math.hypot(*d1) * math.hypot(*d2)
                        if nn and abs(d1[0] * d2[0] + d1[1] * d2[1]) / nn > 0.9:
                            seen.add((i, j))
                            found["parallel"].append(m)
        if mode >= 1:
            # 덩어리: 본선(가장 큰 덩어리 등)에서 떨어진 작은 덩어리
            adj = defaultdict(set)
            for i, l in ls:
                if not l.get("open"):
                    adj[l["a"]].add(l["b"]); adj[l["b"]].add(l["a"])
            comp_seen = set()
            for s0 in list(adj):
                if s0 in comp_seen:
                    continue
                comp, stack = [], [s0]
                comp_seen.add(s0)
                while stack:
                    u = stack.pop(); comp.append(u)
                    for v in adj[u]:
                        if v not in comp_seen:
                            comp_seen.add(v); stack.append(v)
                if sum(1 for u in comp if u in stops[mode]) < 2:
                    found["island"].append(nodes[comp[0]])
        if mode == 1:
            # 역 없이 15km 넘는 철도 (남측 개통 노선): 역·갈림길 사이 길이로 센다
            for i, l in ls:
                if not l.get("open") and not l["kp"] and l["len"] > 15 and l["cls"] != "hsr":
                    found["nostation"].append(nodes[l["a"]])
        res[label] = {k: {"count": len(v), "examples": [[round(x, 4), round(y, 4)] for x, y in v[:12]]}
                      for k, v in sorted(found.items())}
        res[label]["_links"] = len(ls)
    out_path.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return {m: {k: v["count"] for k, v in d.items() if k != "_links"} for m, d in res.items()}

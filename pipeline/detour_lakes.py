"""폐선·복원 계획 선형이 댐 호수(임남호 등)를 가로지르면 호숫가를 따라 돌아가게 고친다.

옛 노선은 댐이 생기기 전에 놓여서, 금강산선 남창도–창도–기성–현리 구간처럼 지금은 호수 밑이다.
  - data/closed_lines.json: 큰 물(DETOUR_MIN_KM2 넘는 호수·저수지)과 OFFSET_M 안을 지나는 구간을 그 물을 둘러싼
    선(물 + OFFSET_M) 가운데 짧은 쪽으로 바꾼다. 물에 잠긴 옛 역은 새 선형 위 가장 가까운 자리로 옮긴다
  - data/plans.json: 폐선 재개통과 같은 사업인 복원 계획(closedLine이 적힌 것)은 그 폐선의 고친 선형을 따라
    역과 선형 점을 다시 놓는다 (복원 구간 앞의 점은 그대로)

  .venv/Scripts/python -X utf8 pipeline/detour_lakes.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import shapely
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import substring, unary_union

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DETOUR_MIN_KM2 = 1.0
OFFSET_M = 400.0
KX = 0.79   # 위도 38° 언저리: 경도 1도 ≈ 위도 0.79도


def to_xy(pts):
    return [(x * KX, y) for x, y in pts]


def from_xy(pts):
    return [(round(x / KX, 5), round(y, 5)) for x, y in pts]


def km(p, q):
    return math.hypot((p[0] - q[0]) * 88.4, (p[1] - q[1]) * 111)


SUBMERGED_KM = 1.5   # 물속을 이만큼 넘게 지나야 돌아간다 (강·짧은 만은 다리로 건넌다)
ARM_M = 500.0        # 이보다 좁은(폭 2배) 호수 팔은 다리로 건넌다


def lakes_near(line_xy, water):
    """선이 SUBMERGED_KM 넘게 잠기는 물(댐 호수)을 오목 껍질로 감싸 OFFSET_M 넓힌 것"""
    b = line_xy.buffer(0.05).bounds
    polys = [g for g in water if g.intersects(box(*b))]
    if not polys:
        return None
    u = unary_union(polys)
    hits = [g for g in getattr(u, "geoms", [u]) if g.area * 111 * 111 >= DETOUR_MIN_KM2 and line_xy.intersection(g).length * 111 > SUBMERGED_KM]
    if not hits:
        return None
    # 폭 1km 안 되는 호수 팔(지류)은 다리로 건너고 호수 본체만 피한다: 깎았다 다시 불린(열림) 도형
    r = ARM_M / 111000
    body = unary_union([g.buffer(-r).buffer(r) for g in hits])
    body = unary_union([b for b in getattr(body, "geoms", [body]) if line_xy.intersection(b).length * 111 > SUBMERGED_KM])
    if body.is_empty:
        return None
    return body.buffer(OFFSET_M / 111000, join_style=1).simplify(0.0008)


def detour(coords, water):
    """경위도 점 목록 → (고친 점 목록, 고쳤는지)"""
    line = LineString(to_xy(coords))
    obs = lakes_near(line, water)
    if obs is None or not line.intersects(obs):
        return coords, False
    out = []
    pos = 0.0
    L = line.length
    inside = line.intersection(obs)
    spans = sorted(((line.project(Point(g.coords[0])), line.project(Point(g.coords[-1]))) for g in getattr(inside, "geoms", [inside])
                    if g.geom_type == "LineString" and g.length > 0), key=lambda s: s[0])
    if not spans:
        return coords, False
    for a, b in spans:
        a, b = min(a, b), max(a, b)
        if a > pos:
            out += list(substring(line, pos, a).coords)
        ea, eb = line.interpolate(a), line.interpolate(b)
        # 들어간 자리와 나온 자리를 감싼 물 테두리의 짧은 쪽으로 돈다
        poly = min(getattr(obs, "geoms", [obs]), key=lambda g: g.exterior.distance(ea) + g.exterior.distance(eb))
        ring = LineString(poly.exterior.coords)
        da, db = ring.project(ea), ring.project(eb)
        R = ring.length
        if da <= db:
            arc1 = substring(ring, da, db)
            arc2 = LineString(list(substring(ring, db, R).coords) + list(substring(ring, 0, da).coords)[1:])
            arc2 = LineString(arc2.coords[::-1])
        else:
            arc1 = LineString(substring(ring, db, da).coords[::-1])
            arc2 = LineString(list(substring(ring, da, R).coords) + list(substring(ring, 0, db).coords)[1:])
        arc = arc1 if arc1.length <= arc2.length else arc2
        out += [ea.coords[0]] + list(arc.coords) + [eb.coords[0]]
        pos = b
    if pos < L:
        out += list(substring(line, pos, L).coords)
    # 붙은 점 정리와 단순화 (약 150m)
    new = LineString(out).simplify(0.0014)
    return from_xy(new.coords), True


def move_stations(stations, coords):
    """선형에서 300m 넘게 떨어진(물에 잠긴) 역을 새 선형 위로"""
    line = LineString(to_xy(coords))
    out = []
    for name, x, y in stations:
        p = Point(x * KX, y)
        if line.distance(p) * 111 > 0.3:
            q = line.interpolate(line.project(p))
            x, y = round(q.x / KX, 5), round(q.y, 5)
        out.append([name, x, y])
    return out


def main():
    # 물도 선형과 같은 좌표(경도에 KX를 곱한)로
    water = [shapely.transform(shapely.make_valid(shape(f["geometry"])), lambda a: a * [KX, 1.0])
             for f in json.loads((DATA / "base" / "waterarea.geojson").read_text(encoding="utf-8"))["features"]]
    cl = json.loads((DATA / "closed_lines.json").read_text(encoding="utf-8"))
    fixed = {}
    for c in cl["lines"]:
        g, changed = detour(c["geom"], water)
        if changed:
            before = sum(km(c["geom"][i], c["geom"][i + 1]) for i in range(len(c["geom"]) - 1))
            c["geom"] = [list(p) for p in g]
            c["stations"] = move_stations(c["stations"], g)
            after = sum(km(g[i], g[i + 1]) for i in range(len(g) - 1))
            c["km"] = round(c["km"] * after / max(before, 1e-6), 1)
            c["detour"] = True
            print("detour", c["label"], round(before, 1), "->", round(after, 1), "km")
        fixed[c["name"]] = c
    (DATA / "closed_lines.json").write_text(json.dumps(cl, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    plans = json.loads((DATA / "plans.json").read_text(encoding="utf-8"))
    for p in plans["plans"]:
        c = fixed.get(p.get("closedLine"))
        if not c:
            continue
        line = LineString(to_xy(c["geom"]))
        names = {s[0] for s in c["stations"]}
        # 복원 구간 앞(폐선에 없는 역)은 그대로, 폐선 구간은 고친 선형의 역 + 약 3km마다 선형 점
        head = []
        for pt in p["points"]:
            if pt[0] in names:
                break
            head.append(pt)
        sts = sorted(c["stations"], key=lambda s: line.project(Point(s[1] * KX, s[2])))
        pts = list(head)
        prev = None
        for s in sts:
            d = line.project(Point(s[1] * KX, s[2]))
            if prev is not None:
                steps = int((d - prev) * 111 / 3)
                for k in range(1, steps + 1):
                    q = line.interpolate(prev + (d - prev) * k / (steps + 1))
                    pts.append([None, round(q.x / KX, 4), round(q.y, 4)])
            pts.append([s[0], round(s[1], 4), round(s[2], 4)])
            prev = d
        p["points"] = pts
        print("plan", p["id"], "->", sum(1 for q in pts if q[0]), "stations,", len(pts), "points")
    (DATA / "plans.json").write_text(json.dumps(plans, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

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
STATION_DRY_M = 150.0   # 역은 물에서 이만큼 떨어진 땅에
CELL_M = 100.0       # 우회 경로를 찾는 격자 칸
WATER_COST = 12.0    # 물 칸 1칸 = 땅 12칸 (좁은 호수 팔은 짧은 다리로 건너고, 넓은 물은 돌아간다)
SHORE_COST = 2.0     # 물가 바로 옆(1칸) 땅: 호숫가에 너무 붙지 않게
LEAD_KM = 1.5        # 잠긴 구간 앞뒤로 이만큼 떨어진 옛 선형에서 갈라지고 합친다
PAD_KM = 8.0         # 경로를 찾는 창의 여유


def submerged_spans(line, wet):
    """선이 물속을 SUBMERGED_KM 넘게 지나는 구간들 [(시작, 끝)] (선 위 거리, 도)"""
    inside = line.intersection(wet)
    spans = sorted((line.project(Point(g.coords[0])), line.project(Point(g.coords[-1])))
                   for g in getattr(inside, "geoms", [inside]) if g.geom_type == "LineString" and g.length > 0)
    spans = [(min(a, b), max(a, b)) for a, b in spans]
    # 300m 안으로 끊긴 잠긴 조각은 한 구간으로
    merged = []
    for a, b in spans:
        if merged and a - merged[-1][1] < 0.003:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    return [(a, b) for a, b in merged if line.intersection(wet).intersection(
        substring(line, a, b).buffer(1e-6)).length * 111 > SUBMERGED_KM]


def raster_path(a, b, water):
    """a에서 b까지 물을 비싸게 치는 격자 최단 경로 (점 목록, 좌표는 경도×KX·위도)"""
    import heapq
    import numpy as np
    import rasterio.features
    from rasterio.transform import from_origin
    pad = PAD_KM / 111
    x0, x1 = min(a[0], b[0]) - pad, max(a[0], b[0]) + pad
    y0, y1 = min(a[1], b[1]) - pad, max(a[1], b[1]) + pad
    d = CELL_M / 111000
    W, H = int((x1 - x0) / d) + 1, int((y1 - y0) / d) + 1
    tr = from_origin(x0, y1, d, d)
    polys = [g for g in water if g.intersects(box(x0, y0, x1, y1))]
    wet = rasterio.features.rasterize(((g, 1) for g in polys), out_shape=(H, W), transform=tr, fill=0, dtype="uint8") if polys else np.zeros((H, W), "uint8")
    from scipy import ndimage
    shore = ndimage.binary_dilation(wet.astype(bool)) & ~wet.astype(bool)
    cost = np.where(wet == 1, WATER_COST, np.where(shore, SHORE_COST, 1.0))
    cell = lambda p: (min(H - 1, max(0, int((y1 - p[1]) / d))), min(W - 1, max(0, int((p[0] - x0) / d))))
    s, t = cell(a), cell(b)
    dist = np.full((H, W), np.inf)
    prev = np.full((H, W, 2), -1, dtype=np.int32)
    dist[s] = 0
    heap = [(0.0, s)]
    steps = [(-1, 0, 1), (1, 0, 1), (0, -1, 1), (0, 1, 1), (-1, -1, 1.414), (-1, 1, 1.414), (1, -1, 1.414), (1, 1, 1.414)]
    while heap:
        g, (r, c) = heapq.heappop(heap)
        if (r, c) == t:
            break
        if g > dist[r, c]:
            continue
        for dr, dc, w in steps:
            rr, cc = r + dr, c + dc
            if 0 <= rr < H and 0 <= cc < W:
                ng = g + w * (cost[r, c] + cost[rr, cc]) / 2
                if ng < dist[rr, cc]:
                    dist[rr, cc] = ng
                    prev[rr, cc] = (r, c)
                    heapq.heappush(heap, (ng, (rr, cc)))
    path, cur = [], t
    while cur[0] >= 0:
        path.append((x0 + (cur[1] + 0.5) * d, y1 - (cur[0] + 0.5) * d))
        if cur == s:
            break
        cur = tuple(prev[cur])
    path.reverse()
    return [a] + path[1:-1] + [b]


def detour(coords, water):
    """경위도 점 목록 → (고친 점 목록, 고쳤는지). 잠긴 구간마다 앞뒤 LEAD_KM 옛 선형에서 갈라져 격자 최단 경로로 돈다"""
    line = LineString(to_xy(coords))
    near = [g for g in water if g.intersects(line.buffer(0.02))]
    if not near:
        return coords, False
    wet = unary_union(near)
    spans = submerged_spans(line, wet)
    if not spans:
        return coords, False
    out, pos, L = [], 0.0, line.length
    lead = LEAD_KM / 111
    for a, b in spans:
        a, b = max(pos, a - lead), min(L, b + lead)
        if a > pos:
            out += list(substring(line, pos, a).coords)
        pa, pb = line.interpolate(a), line.interpolate(b)
        out += raster_path((pa.x, pa.y), (pb.x, pb.y), near)
        pos = b
    if pos < L:
        out += list(substring(line, pos, L).coords)
    new = LineString(out).simplify(0.0009)   # 약 100m
    return from_xy(new.coords), True


def move_stations(stations, coords, water):
    """옛 역을 새 선형 위로 올리되 물(호수·강, 둘레 STATION_DRY_M) 밖 자리로.

    선형에서 300m 넘게 떨어졌거나 물에 잠긴 역은 선형 위 가장 가까운 자리에서 앞뒤로 100m씩 옮겨 가며
    물 밖인 첫 자리에 둔다 (호수 팔을 다리로 건너는 자리에 역이 서지 않게)
    """
    line = LineString(to_xy(coords))
    lake = unary_union([g for g in water if g.intersects(line.buffer(0.03))])
    wet = lake.buffer(STATION_DRY_M / 111000) if not lake.is_empty else None
    out = []
    for name, x, y in stations:
        p = Point(x * KX, y)
        if line.distance(p) * 111 > 0.3 or (wet is not None and wet.contains(p)):
            d0 = line.project(p)
            best = None
            for k in range(0, 61):
                for d in ((d0 + k * 0.0009, d0 - k * 0.0009) if k else (d0,)):
                    if 0 <= d <= line.length:
                        q = line.interpolate(d)
                        if wet is None or not wet.contains(q):
                            best = q
                            break
                if best is not None:
                    break
            q = best or line.interpolate(d0)
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
            c["stations"] = move_stations(c["stations"], g, water)
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

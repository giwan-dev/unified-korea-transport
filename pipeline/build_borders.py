"""시군구 경계선 조각: 이웃한 두 시군구가 맞닿은 선마다 하나 (a, b = 두 존 id, 바다·국경 쪽은 b = -1, 비무장지대와 맞닿은 쪽은 b = -2).
군사분계선을 사이에 둔 남북 시군 경계는 남측 선 하나를 맞은편 북측 시군과의 경계(b = 그 존 id)로 둔다.
바다·강 위(해안에서 약 12km 안)에는 가장 가까운 시군을 따라 나눈 물 위 경계를 w = 1로 더한다 (도가 다르면 점선 도 경계로 그린다).

게임이 행정구역을 바꾸면(북측 1945년 이전 도 복원, 광역시 승격 등) 소속 광역 단체가 다른 두 존 사이의 선만
골라 도 경계로 그린다. 고정된 시도 경계(sido.geojson)를 쓰면 없어진 자강도·량강도 경계가 계속 남는다.

  - 읽음: data/admin/sgg.geojson (build_admin.py)
  - 씀:   data/admin/edges.geojson
"""
import json
import sys
from pathlib import Path

import shapely
from shapely.geometry import mapping, shape
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parent.parent
ADMIN = ROOT / "data" / "admin"


def lines_of(g):
    if g.is_empty:
        return None
    parts = [p for p in getattr(g, "geoms", [g]) if p.geom_type in ("LineString", "MultiLineString")]
    if not parts:
        return None
    u = unary_union(parts)
    m = linemerge(u) if u.geom_type == "MultiLineString" else u
    return m if not m.is_empty else None


def split_by_neighbor(ln, tree, cand, geoms, reach=0.05):
    """선을 꼭짓점마다 가장 가까운 맞은편 시군(reach° 안)으로 이름표를 달아, 같은 이웃이 이어지는 토막으로 나눈다"""
    out = []
    for line in getattr(ln, "geoms", [ln]):
        pts = list(shapely.segmentize(line, 0.005).coords)
        labs = []
        for x, y in pts:
            k = tree.nearest(shapely.Point(x, y))
            nb = cand[int(k)]
            labs.append(nb if geoms[nb].distance(shapely.Point(x, y)) < reach else None)
        run = [pts[0]]
        for t in range(1, len(pts)):
            run.append(pts[t])
            if t == len(pts) - 1 or labs[t + 1] != labs[t]:
                if len(run) > 1:
                    out.append((labs[t], shapely.LineString(run)))
                run = [pts[t]]
    return out


def water_edges(geoms, ids, reach=0.11, step=0.01):
    """바다·강 위 시군 경계: 시군 경계선 위 점들(약 1km 간격)로 보로노이 칸을 나눠 시군마다 '가장 가까운 물'을 정하고,
    이웃한 두 시군의 칸 사이 선을 해안에서 reach°(약 12km) 안의 물 위만 남긴다. 외국 땅(압록강·두만강 너머)은 뺀다"""
    import geopandas as gpd
    simp = [g.simplify(0.003) for g in geoms]
    ours = unary_union(simp).buffer(1e-4)
    near = ours.buffer(reach)
    land = unary_union(gpd.read_file(f"zip://{(ROOT / 'data' / 'raw' / 'ne_10m_land.zip').as_posix()}").clip(near.bounds).geometry)
    water = near.difference(ours).difference(land.difference(ours.buffer(0.02)))
    pts, lab, seen = [], [], set()
    for k, g in enumerate(simp):
        for ring in (getattr(g, "geoms", [g])):
            for c in shapely.segmentize(ring.exterior, step).coords:
                key = (round(c[0], 4), round(c[1], 4))   # 이웃 시군과 같이 쓰는 경계점은 한 번만 (보로노이는 겹친 점을 못 받는다)
                if key not in seen:
                    seen.add(key); pts.append(key); lab.append(k)
    mp = shapely.MultiPoint(pts)
    cells = shapely.voronoi_polygons(mp, extend_to=near.envelope, ordered=True)
    by = {}
    for c, k in zip(cells.geoms, lab):
        by.setdefault(k, []).append(c)
    region = {k: shapely.coverage_union_all(v).intersection(water) for k, v in by.items()}
    keys = [k for k in region if not region[k].is_empty]
    rt = shapely.STRtree([region[k] for k in keys])
    out = []
    for x, k in enumerate(keys):
        for y in rt.query(region[k]):
            j = keys[int(y)]
            if j <= k:
                continue
            ln = lines_of(region[k].boundary.intersection(region[j].boundary))
            if ln is not None and ln.length > 0.01:
                out.append((ids[k], ids[j], ln, 1))
    return out


def main():
    sgg = json.loads((ADMIN / "sgg.geojson").read_text(encoding="utf-8"))["features"]
    ids = [f["properties"]["id"] for f in sgg]
    geoms = [shapely.make_valid(shape(f["geometry"])) for f in sgg]
    bounds = [g.boundary for g in geoms]
    tree = shapely.STRtree(geoms)
    feats, shared = [], [[] for _ in sgg]
    for i, g in enumerate(geoms):
        for j in tree.query(g):
            j = int(j)
            if j <= i:
                continue
            ln = lines_of(bounds[i].intersection(bounds[j]))
            if ln is None:
                continue
            feats.append((ids[i], ids[j], ln))
            shared[i].append(ln); shared[j].append(ln)
    # 군사분계선 양쪽 2.5km 안의 '이웃 없는 경계'는 해안이 아니라 비무장지대(어느 시군에도 속하지 않던 땅)와의 경계다.
    # 남북 양쪽 선이 거의 겹쳐 따로 그리면 두세 줄로 보이므로, 남측 선만 남겨 마주 보는 북측 시군과의 경계로 나눠 둔다
    # (도 경계로 또렷하게 그려지고, 남북 철원 통합처럼 행정구역을 합치면 안쪽 경계로 바뀐다). 북측 쪽 선은 버린다
    mdl = [shape(f["geometry"]) for f in json.loads((ROOT / "data" / "base" / "lines.geojson").read_text(encoding="utf-8"))["features"]
           if f["properties"].get("kind") == "mdl"]
    dmz = unary_union(mdl).buffer(0.025) if mdl else None
    country = [f["properties"]["country"] for f in sgg]
    kp = [k for k in range(len(sgg)) if country[k] == "KP"]
    kp_tree = shapely.STRtree([geoms[k] for k in kp])
    # 북측 OSM 시군 경계는 이웃끼리 딱 맞지 않아 땅 한가운데에 '이웃 없는 경계'(가는 틈)가 생긴다 (토산–금천–장풍).
    # 해안선이 아닌 육지 안쪽(바다에서 500m 넘게 떨어진 곳)의 그런 경계는 1km 안의 이웃 시군과의 경계로 고친다
    import geopandas as gpd
    land_all = unary_union(gpd.read_file(f"zip://{(ROOT / 'data' / 'raw' / 'ne_10m_land.zip').as_posix()}").clip((124, 33, 132, 43.5)).geometry)
    inland = land_all.buffer(-0.005)
    all_tree = shapely.STRtree(geoms)
    fixed = 0
    for i, b in enumerate(bounds):
        rest = b.difference(unary_union(shared[i]).buffer(1e-6)) if shared[i] else b
        for part, code in ((rest.difference(dmz), -1), (rest.intersection(dmz), -2)) if dmz is not None else ((rest, -1),):
            ln = lines_of(part)
            if ln is None or ln.length <= 0.002:
                continue
            if code == -2 and country[i] == "KP":
                # 북측 쪽 선은 버리되, 비무장지대 안에서 북측 두 시군이 가는 틈을 두고 맞닿은 곳(판문구역과 옛 장단 땅 조각 사이 등)은
                # 두 시군 사이 경계로 남긴다. 버리면 장단군을 경기도에 되살릴 때 개성시와의 도 경계가 2km쯤 끊겼다
                others = [k for k in kp if k != i]
                for nb, piece in split_by_neighbor(ln, shapely.STRtree([geoms[k] for k in others]), others, geoms, reach=0.003):
                    if nb is not None and ids[i] < ids[nb] and piece.length > 0.001:
                        feats.append((ids[i], ids[nb], piece))
                continue
            if code == -2:
                for nb, piece in split_by_neighbor(ln, kp_tree, kp, geoms):
                    feats.append((ids[i], ids[nb] if nb is not None else -2, piece))
                continue
            if code == -1 and country[i] == "KP":
                others = [k for k in range(len(geoms)) if k != i]
                for nb, piece in split_by_neighbor(ln, shapely.STRtree([geoms[k] for k in others]), others, geoms, reach=0.01):
                    if nb is not None and inland.contains(piece.interpolate(0.5, normalized=True)):
                        fixed += 1
                        if ids[i] < ids[nb]:   # 틈 양쪽 선 가운데 하나만 그린다
                            feats.append((ids[i], ids[nb], piece))
                    else:
                        feats.append((ids[i], -1, piece))
                continue
            feats.append((ids[i], code, ln))
    print("inland gaps turned into borders", fixed, file=sys.stderr)
    water = water_edges(geoms, ids)
    # 좁은 수로(강화–김포 염하 등)는 두 시군이 육상 경계로 이미 맞닿아 있다: 그 곁(약 300m)의 해상 경계 조각은 겹쳐 그려지므로 뺀다
    land_lines = unary_union([f[2] for f in feats])
    near_land = land_lines.buffer(0.003)
    trimmed = []
    for f in water:
        g = f[2].difference(near_land)
        if not g.is_empty and g.length > 0.002:
            trimmed.append((f[0], f[1], g, *f[3:]))
    print("water edges", len(water), "->", len(trimmed), "after removing ones beside land borders", file=sys.stderr)
    water = trimmed
    feats += water
    out = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": k, "properties": {"i": k, "a": f[0], "b": f[1], **({"w": 1} if len(f) > 3 else {})},
         "geometry": mapping(shapely.set_precision(f[2], 0.00002))} for k, f in enumerate(feats)]}
    # 비무장지대 땅(시군구가 덮지 않는 육지) 면: 지도에서 육지 색으로 채운다 (안 채우면 물빛 띠로 보인다)
    if dmz is not None:
        import geopandas as gpd
        land = unary_union(gpd.read_file(f"zip://{(ROOT / 'data' / 'raw' / 'ne_10m_land.zip').as_posix()}").clip(dmz.bounds).geometry)
        gap = land.intersection(dmz).difference(unary_union(geoms).buffer(1e-6))
        gap = shapely.set_precision(gap.simplify(0.0005), 0.0005)
        (ADMIN / "dmz.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {}, "geometry": mapping(gap)}]}, separators=(",", ":")), encoding="utf-8")
        print("dmz land", round(gap.area * 111 * 88, 1), "km2", file=sys.stderr)
    path = ADMIN / "edges.geojson"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("edges", len(feats), round(path.stat().st_size / 1e3), "KB", file=sys.stderr)


if __name__ == "__main__":
    main()

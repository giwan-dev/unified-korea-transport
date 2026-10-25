"""data/subzones.geojson의 읍면동 사이 틈 메우기 (build_grid.py를 다시 돌리지 않고 경계만 고친다).

예전 build_grid.py는 읍면동을 하나씩 단순화해서, 이웃끼리 경계가 어긋나 사이에 하얀 틈이 벌어졌다.
시군(존) 원래 경계 안에서 소구역끼리 겹친 곳은 앞 소구역에 두고, 빈 곳은 가장 길게 맞닿은 소구역에 붙인 뒤
이웃 경계를 함께 단순화한다. 소구역 번호·이름·개수는 그대로라 기준 연도 계산(data/baseline.*)은 그대로 쓴다.

  .venv/Scripts/python -X utf8 pipeline/fix_subzone_gaps.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import shapely
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "subzones.geojson"


def polys(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon" and not p.is_empty]


def main():
    zones = {}
    for f in json.loads((RAW / "zones.geojson").read_text(encoding="utf-8"))["features"]:
        zones[int(f["properties"]["id"])] = shapely.make_valid(shape(f["geometry"]))
    fc = json.loads(OUT.read_text(encoding="utf-8"))
    feats = fc["features"]
    by_zone = defaultdict(list)
    for k, f in enumerate(feats):
        by_zone[int(f["properties"]["zone"])].append(k)
    geoms = [shapely.make_valid(shape(f["geometry"])) for f in feats]
    filled = 0.0
    claimed = None   # 앞 존이 가져간 땅 (원래 존 경계도 조금씩 겹친다)
    for zid, ks in by_zone.items():
        Z = zones.get(zid)
        if Z is None:
            continue
        if claimed is not None:
            Z = Z.difference(claimed)
        claimed = Z if claimed is None else claimed.union(Z)
        taken = None
        for k in ks:   # 존 안으로 자르고, 앞 소구역과 겹친 곳은 뺀다
            g = geoms[k].intersection(Z)
            if taken is not None:
                g = g.difference(taken)
            g = unary_union(polys(g)) if g.geom_type == "GeometryCollection" else g
            geoms[k] = g
            taken = g if taken is None else taken.union(g)
        gap = Z.difference(taken) if taken is not None else Z
        for piece in polys(gap):
            if piece.area < 1e-12:
                continue
            ring = piece.buffer(1e-5)
            best, bl = None, 0.0
            for k in ks:
                if geoms[k].is_empty:
                    continue
                shared = ring.intersection(geoms[k]).area
                if shared > bl:
                    best, bl = k, shared
            if best is None:   # 아무와도 안 닿으면 가장 가까운 소구역에
                best = min(ks, key=lambda k: geoms[k].distance(piece) if not geoms[k].is_empty else 1e9)
            geoms[best] = geoms[best].union(piece)
            filled += piece.area
    geoms = [unary_union(polys(g)) if g.geom_type not in ("Polygon", "MultiPolygon") else g for g in geoms]
    # 격자에 먼저 맞춘 뒤 이웃 경계를 함께 단순화한다 (단순화는 꼭짓점을 빼기만 해서 맞닿은 경계가 그대로 맞는다)
    geoms = [shapely.make_valid(shapely.set_precision(g, 0.00001)) for g in geoms]
    geoms = [unary_union(polys(g)) if g.geom_type not in ("Polygon", "MultiPolygon") else g for g in geoms]
    geoms = list(shapely.coverage_simplify(geoms, 0.0007))
    # 단순화 뒤 남은 실틈(폭 1m 안팎)은 가장 길게 맞닿은 소구역에 붙인다
    land = unary_union([z for z in zones.values()])
    tree = shapely.STRtree(geoms)
    slivers = polys(land.difference(unary_union(geoms)))
    for piece in slivers:
        if piece.area > 2e-6:   # 바다·호수처럼 큰 빈 곳(약 2만㎡ 넘게)은 그대로
            continue
        ring = piece.buffer(2e-5)
        cand = tree.query(ring)
        if not len(cand):
            continue
        best = max(cand, key=lambda k: ring.intersection(geoms[k]).area)
        geoms[best] = unary_union([geoms[best], piece.buffer(1e-6)])
    print("slivers", len(slivers))
    for f, g in zip(feats, geoms):
        f["geometry"] = mapping(g)
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("filled", round(filled * 88 * 111, 1), "km2,", len(feats), "subzones,", round(OUT.stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()

"""큰 강의 물 면(한강·낙동강·대동강·압록강 등)과 큰 저수지를 OSM에서 뽑는다.

Natural Earth에는 강의 중심선만 있어서 도시 안의 넓은 강폭이 그려지지 않는다.
출력: data/base/waterarea.geojson (속성 kind = water: 맞닿은 강·하천·호수 조각을 하나로 합친 면)
      data/base/waterline.geojson (물가 윤곽선: 육지와 맞닿은 둘레만. 조각 사이·하구(바다와 맞닿은 곳)에는 선이 없다)
실행: python pipeline/build_water.py   (build_basemap.py 다음)
"""

import json
import sys
from pathlib import Path

import osmium
import shapely
import shapely.geometry.polygon
from shapely import wkb
from shapely.geometry import mapping

sys.path.insert(0, str(Path(__file__).parent))
import build_data  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "base" / "waterarea.geojson"
OUT_LINE = ROOT / "data" / "base" / "waterline.geojson"
KM2 = 111.0 * 88.0          # 위도 37도 부근 1도² ≈ km²
MIN_RIVER_KM2 = 0.03        # 강 면은 작은 조각도 이어져 보이도록 낮게
MIN_LAKE_KM2 = 0.5          # 호수·저수지는 큰 것만


def kind_of(t):
    if t.get("waterway") == "riverbank" or t.get("water") in ("river", "canal", "stream_pool") or t.get("natural") == "water" and t.get("water") == "river":
        return "river"
    if t.get("natural") == "water" or t.get("landuse") == "reservoir":
        return "lake"
    return None


def main():
    fab = osmium.geom.WKBFactory()
    feats = []
    flt = osmium.filter.TagFilter(("natural", "water"), ("waterway", "riverbank"), ("landuse", "reservoir"))
    seen = set()
    for c in ("KR", "KP"):
        for obj in osmium.FileProcessor(str(build_data.PBF[c])).with_areas(flt).with_filter(flt):
            if not obj.is_area():
                continue
            key = (obj.from_way(), obj.orig_id())
            if key in seen:
                continue
            seen.add(key)
            k = kind_of(obj.tags)
            if not k:
                continue
            try:
                g = wkb.loads(fab.create_multipolygon(obj), hex=True)
            except Exception:
                continue
            a = g.area * KM2
            if a < (MIN_RIVER_KM2 if k == "river" else MIN_LAKE_KM2):
                continue
            g = shapely.set_precision(g.simplify(0.0002), 0.00001)
            if g.is_empty:
                continue
            feats.append(g)
    write_merged(feats)


def write_merged(geoms):
    """맞닿거나 아주 가까운(약 3m) 물 조각을 하나로 합치고, 육지와 맞닿은 둘레만 윤곽선으로 쓴다"""
    from shapely.geometry import box, shape
    from shapely.ops import unary_union
    eps = 0.00003
    # 모서리를 각지게(mitre) 부풀렸다 줄여야 둥근 모서리 점이 늘지 않는다. 합친 뒤 원래만큼(약 20m) 다시 단순화
    merged = unary_union([shapely.make_valid(g).buffer(eps, join_style="mitre") for g in geoms]).buffer(-eps, join_style="mitre")
    merged = shapely.make_valid(merged.simplify(0.0002))
    parts = [p for p in getattr(merged, "geoms", [merged]) if p.geom_type == "Polygon" and not p.is_empty]
    # 바다 = 지도 범위에서 육지(남북 시군구 + 주변국)를 뺀 곳. 물 둘레 가운데 바다에 닿는 부분(하구)은 선을 긋지 않는다
    root = ROOT / "data"
    land = unary_union([shapely.make_valid(shape(f["geometry"])) for f in json.loads((root / "admin" / "sgg.geojson").read_text(encoding="utf-8"))["features"]]
                       + [shapely.make_valid(shape(f["geometry"])) for f in json.loads((root / "base" / "world.geojson").read_text(encoding="utf-8"))["features"]])
    sea = box(116, 21.5, 148, 48).difference(land)
    edge = unary_union([p.boundary for p in parts]).difference(sea.buffer(0.0004))
    edge = shapely.set_precision(edge, 0.00001)
    # 큰 물 면(한강~안양천처럼 수백 개 조각이 이어진 것)은 0.1° 격자로 잘라 둔다: 지도 라이브러리가 아주 큰 다각형을
    # 삼각형으로 나누다 실패하면 육지에 쐐기 모양 물이 칠해진다. 물가선은 따로 그리므로 자른 경계에는 선이 생기지 않는다
    tiles = []
    for p in parts:
        x0, y0, x1, y1 = p.bounds
        if x1 - x0 <= 0.1 and y1 - y0 <= 0.1:
            tiles.append(p)
            continue
        for i in range(int(x0 // 0.1), int(x1 // 0.1) + 1):
            for j in range(int(y0 // 0.1), int(y1 // 0.1) + 1):
                cut = p.intersection(box(i * 0.1, j * 0.1, (i + 1) * 0.1, (j + 1) * 0.1))
                tiles += [g for g in getattr(cut, "geoms", [cut]) if g.geom_type == "Polygon" and g.area > 1e-9]
    area_feats = []
    for p in tiles:
        g = shapely.make_valid(shapely.set_precision(p, 0.00001))
        for q in getattr(g, "geoms", [g]):
            if q.geom_type == "Polygon" and not q.is_empty:
                area_feats.append({"type": "Feature", "properties": {"kind": "water"}, "geometry": mapping(shapely.geometry.polygon.orient(q))})
    line_feats = [{"type": "Feature", "properties": {}, "geometry": mapping(g)}
                  for g in getattr(edge, "geoms", [edge]) if not g.is_empty and g.geom_type in ("LineString", "MultiLineString")]
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": area_feats}, separators=(",", ":")), encoding="utf-8")
    OUT_LINE.write_text(json.dumps({"type": "FeatureCollection", "features": line_feats}, separators=(",", ":")), encoding="utf-8")
    print("water areas", len(geoms), "->", len(area_feats), round(OUT.stat().st_size / 1e6, 2), "MB; shore lines",
          len(line_feats), round(OUT_LINE.stat().st_size / 1e6, 2), "MB", file=sys.stderr)


if __name__ == "__main__":
    if "--merge-only" in sys.argv:   # 이미 뽑은 물 조각(인자로 준 geojson, 없으면 waterarea.geojson)을 다시 합치기만
        from shapely.geometry import shape
        src = Path(sys.argv[sys.argv.index("--merge-only") + 1]) if len(sys.argv) > sys.argv.index("--merge-only") + 1 else OUT
        write_merged([shape(f["geometry"]) for f in json.loads(src.read_text(encoding="utf-8"))["features"]])
    else:
        main()

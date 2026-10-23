"""큰 강의 물 면(한강·낙동강·대동강·압록강 등)과 큰 저수지를 OSM에서 뽑는다.

Natural Earth에는 강의 중심선만 있어서 도시 안의 넓은 강폭이 그려지지 않는다.
출력: data/base/waterarea.geojson (속성 kind = river / lake)
실행: python pipeline/build_water.py   (build_basemap.py 다음)
"""

import json
import sys
from pathlib import Path

import osmium
import shapely
from shapely import wkb
from shapely.geometry import mapping

sys.path.insert(0, str(Path(__file__).parent))
import build_data  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "base" / "waterarea.geojson"
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
            feats.append({"type": "Feature", "properties": {"kind": k}, "geometry": mapping(g)})
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
    print("water areas", len(feats), round(OUT.stat().st_size / 1e6, 2), "MB", file=sys.stderr)


if __name__ == "__main__":
    main()

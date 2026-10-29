"""자세한 읍면동(리) 경계의 머리카락 틈을 없앤다: 이웃한 리끼리 경계 꼭짓점을 똑같이 갖게 한다.

북측 리 경계는 지형으로 어림해 리마다 따로 그려(build_admin) 이웃 리와 꼭짓점이 어긋난 가는 틈이 군데군데 남았다
(신천군 80조각 0.006km² 등). 지도에서는 틈 양쪽이 서로 맞닿지 않은 변이 되어, 분구한 구를 고르면 구 안의 리 경계가
파랗게 그려지고 구와 구 사이 경계가 끊겼다.

시군마다: 리 경계선과 시군 경계선을 모두 한 번에 잘라(노딩) 면으로 나눈 뒤(polygonize), 면마다 그 면을 품은 리에 주고,
어느 리에도 들지 않은 틈 면은 가장 길게 맞닿은 리에 붙인다. 리는 자기 면들을 합쳐 다시 만든다. 같은 선 그물에서 나온 면이라
이웃한 리는 경계 꼭짓점을 똑같이 갖는다. 틈이 없는 시군(남측)은 건드리지 않는다.

  - 읽음·씀: data/admin/units/*.geojson (북측 파일), 읽음: data/admin/sgg.geojson
  python -X utf8 pipeline/fix_unit_gaps.py
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import shapely
from shapely.geometry import mapping, shape
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parent.parent
UNITS = ROOT / "data" / "admin" / "units"


def fix_zone(zone_geom, feats):
    geoms = [shapely.make_valid(shape(f["geometry"])) for f in feats]
    union = unary_union(geoms)
    gap = zone_geom.difference(union)
    if gap.area < 1e-12:
        return 0
    lines = unary_union([g.boundary for g in geoms] + [zone_geom.boundary])
    faces = list(polygonize(lines))
    prep = [shapely.prepared.prep(g) for g in geoms]
    own = defaultdict(list)
    orphans = []
    for f in faces:
        rp = f.representative_point()
        k = next((i for i, pg in enumerate(prep) if pg.contains(rp)), None)
        if k is not None:
            own[k].append(f)
        elif zone_geom.contains(rp):
            orphans.append(f)
    for f in orphans:   # 틈 면: 가장 길게 맞닿은 리로
        best, bl = None, 0.0
        for k, g in enumerate(geoms):
            if g.distance(f) > 1e-9:
                continue
            ln = f.boundary.intersection(g.buffer(1e-9)).length
            if ln > bl:
                bl, best = ln, k
        if best is not None:
            own[best].append(f)
    for k, fs in own.items():
        g = unary_union(fs)
        g = shapely.set_precision(g, 1e-5)
        if not g.is_empty:
            feats[k]["geometry"] = mapping(g)
    return len(orphans)


def main():
    sgg = {f["properties"]["id"]: shapely.make_valid(shape(f["geometry"]))
           for f in json.loads((ROOT / "data" / "admin" / "sgg.geojson").read_text(encoding="utf-8"))["features"]}
    index = json.loads((UNITS / "index.json").read_text(encoding="utf-8"))
    total = 0
    for e in index:
        if e.get("country") != "KP":
            continue
        path = UNITS / e["file"]
        fc = json.loads(path.read_text(encoding="utf-8"))
        by_zone = defaultdict(list)
        for f in fc["features"]:
            by_zone[f["properties"].get("zone")].append(f)
        n = 0
        for z, fs in by_zone.items():
            if z in sgg:
                n += fix_zone(sgg[z], fs)
        path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(e["file"], e.get("province"), "gaps filled", n, file=sys.stderr)
        total += n
    print("total", total, file=sys.stderr)


if __name__ == "__main__":
    main()

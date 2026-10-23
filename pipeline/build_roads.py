"""배경지도용 OSM 도로를 도별 파일로 만든다 (확대했을 때만 받아 그린다).

계산망에는 간선만 넣지만, 화면에는 도심의 2차 도로까지 실제 모양대로 보여 준다.

출력: data/base/roads/{n}.geojson (+ index.json), 속성 c = 0 고속도로, 1 간선국도, 2 주요 도로, 3 2차 도로
      3차 도로(c = 4)는 따로 t{n}.geojson에 두고 많이 확대했을 때만 받는다 (index의 minzoom)
실행: python pipeline/build_roads.py   (build_admin.py 다음)
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

import osmium
import shapely
from shapely.geometry import mapping, shape

sys.path.insert(0, str(Path(__file__).parent))
import build_data  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "base" / "roads"
# 연결로(*_link)는 그리지 않는다: IC·JCT는 접속점으로 단순화해 보여 준다
CLS = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}
DETAIL_MINZOOM = 12


def main():
    sido = json.loads((ROOT / "data" / "admin" / "sido.geojson").read_text(encoding="utf-8"))["features"]
    geoms = [shape(f["geometry"]) for f in sido]
    tree = shapely.STRtree(geoms)
    groups = defaultdict(list)
    seen = set()
    flt = osmium.filter.TagFilter(*[("highway", k) for k in CLS])
    for c in ("KR", "KP"):
        for w in osmium.FileProcessor(str(build_data.PBF[c]), osmium.osm.NODE | osmium.osm.WAY) \
                .with_locations().with_filter(flt):
            if not w.is_way() or w.id in seen:
                continue
            seen.add(w.id)
            try:
                pts = [(n.lon, n.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                continue
            if len(pts) < 2:
                continue
            line = shapely.LineString(pts)
            mid = line.interpolate(0.5, normalized=True)
            hit = tree.query(mid, predicate="intersects")
            if not len(hit):
                continue
            c = CLS[w.tags.get("highway")]
            g = shapely.set_precision(line.simplify(0.00008), 0.00001)
            groups[(int(hit[0]), c == 4)].append({"type": "Feature", "properties": {"c": c}, "geometry": mapping(g)})
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for n, ((k, detail), feats) in enumerate(sorted(groups.items())):
        b = geoms[k].bounds
        path = OUT / f"{'t' if detail else ''}{n}.geojson"
        path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")), encoding="utf-8")
        e = {"file": path.name, "name": sido[k]["properties"]["name"], "bbox": [round(v, 3) for v in b]}
        if detail:
            e["minzoom"] = DETAIL_MINZOOM
        index.append(e)
        print(sido[k]["properties"]["name"], len(feats), round(path.stat().st_size / 1e6, 2), "MB", file=sys.stderr)
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()

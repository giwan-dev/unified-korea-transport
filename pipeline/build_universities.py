"""대학 위치를 만든다 (지도 표시, 교육 수준 계산, 북측 지도자 이름 대학 개칭용).

- 남·북 OSM의 amenity=university / amenity=college 가운데 이름이 ○○대학교·○○대학·○○전문대학 등인 것.
  캠퍼스가 건물·대지로 여러 번 올라 있으면 이름마다 하나 (가장 넓은 대지 또는 첫 점). 사이버·방송통신·대학원대학교는 뺀다
  (캠퍼스가 아니거나 학부생이 없다).
- 정원은 OSM에 없어 종류로 어림한다: 4년제(대학교·종합대학) 1만 명, 전문대·단과대학 4천 명 (게임용 가정값).

출력: data/universities.json  [{n: 이름, x: 경도, y: 위도, z: 존 번호, k: 'univ'|'college', c: 'KR'|'KP'}]
실행: python pipeline/build_universities.py  (build_admin·build_grid 뒤)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import osmium
import shapely
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).parent))
import build_data  # noqa: E402
from build_admin import osm_file  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SKIP = re.compile(r"사이버|방송통신|원격|대학원대학교|평생교육|부설|병원|기숙사|도서관|체육관|학생회관|어학원|연구소|재단|협의회")
COLLEGE = re.compile(r"전문대학|폴리텍|보건대학|기능대학|과학대학$|간호대학$|예술대학$|산업대학$|전문학교$")


def main():
    zones = json.loads((DATA / "zones.json").read_text(encoding="utf-8"))
    sgg = json.loads((DATA / "admin" / "sgg.geojson").read_text(encoding="utf-8"))
    geoms = {f["properties"]["id"]: shape(f["geometry"]) for f in sgg["features"]}
    ids = list(geoms)
    tree = shapely.STRtree([geoms[i] for i in ids])

    def zone_at(x, y):
        pt = shapely.Point(x, y)
        for j in tree.query(pt):
            if geoms[ids[j]].contains(pt):
                return ids[j]
        return None

    best = {}
    flt = osmium.filter.TagFilter(("amenity", "university"), ("amenity", "college"))
    wkb = osmium.geom.WKBFactory()
    for country in ("KR", "KP"):
        fp = osmium.FileProcessor(str(osm_file(build_data.PBF[country]))).with_areas().with_locations().with_filter(flt)
        for o in fp:
            nm = (build_data.ko_name(o.tags) or "").strip()
            if not nm or not re.search(r"대학|전문학교", nm) or SKIP.search(nm):
                continue
            area = 0.0
            if o.is_node():
                x, y = o.location.lon, o.location.lat
            elif o.is_area():
                try:
                    g = shapely.from_wkb(bytes.fromhex(wkb.create_multipolygon(o)))
                except Exception:
                    continue
                c = g.representative_point()
                x, y, area = c.x, c.y, g.area
            else:
                continue
            z = zone_at(x, y)
            if z is None or zones[z].get("ext"):
                continue
            key = (country, nm)
            if key in best and best[key]["area"] >= area:
                continue
            best[key] = {"n": nm, "x": round(x, 5), "y": round(y, 5), "z": z, "c": country, "area": area,
                         "k": "college" if COLLEGE.search(nm) else "univ"}
    out = sorted(({k: v for k, v in u.items() if k != "area"} for u in best.values()), key=lambda u: (u["c"], u["z"], u["n"]))
    (DATA / "universities.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by = {}
    for u in out:
        by[(u["c"], u["k"])] = by.get((u["c"], u["k"]), 0) + 1
    print("universities", len(out), by)
    print("KP sample", [u["n"] for u in out if u["c"] == "KP"][:40])


if __name__ == "__main__":
    main()

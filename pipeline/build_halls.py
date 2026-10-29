"""시청·군청·구청(북측은 인민위원회) 소재지를 만든다 (지도 표시와 새 역 이름 '○○시청역'용).

- 남·북 OSM의 amenity=townhall / office=government 가운데 이름이 ○○시청·○○군청·○○구청·○○도청·○○광역시청,
  북측은 ○○시·군·구역·도 인민위원회인 것. 본관을 고르고 별관·제2청사·옛 청사(구경기도청)는 뺀다.
- 시군 존마다 청사가 하나도 없으면(북측 대부분) 소재지를 어림한다: 군은 '○○읍' 지명, 시·구역은 같은 이름의 지명,
  그것도 없으면 그 존에서 인구가 가장 많은 읍면동 가운데.
- 이름은 지금 행정구역 이름을 쓰도록 존 번호와 종류만 적는다 (게임에서 승격·편입·분구하면 이름이 따라 바뀐다).
  도청·광역시청은 그 광역 단체 이름을 따른다.

출력: data/halls.json  [{k: 'si'|'gun'|'gu'|'do', z: 존 번호, x: 경도, y: 위도, src: 'osm'|'guess'}]
실행: python pipeline/build_halls.py  (build_admin·build_grid 뒤)
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

KIND = [  # (이름 끝, 종류)
    (re.compile(r"(특별자치도|도)청$|도인민위원회$"), "do"),
    (re.compile(r"(특별시|광역시|특별자치시|직할시)청$"), "do"),
    (re.compile(r"구역인민위원회$|구청$"), "gu"),
    (re.compile(r"군청$|군인민위원회$"), "gun"),
    (re.compile(r"시청$|시인민위원회$"), "si"),
]
# 이북5도청(서울 구기동의 황해도청·평안남도청 등)은 그 도의 도청이 아니다: 그대로 두면 '서울특별시청'으로 평창동에 다섯 개 찍혔다
SKIP = re.compile(r"리시청$|별관|제\d청사|분관|^구.+도청$|임시|출장소|의회|^(황해|평안남|평안북|함경남|함경북)도청$")


def hall_kind(name: str):
    if SKIP.search(name):
        return None
    for rx, k in KIND:
        if rx.search(name):
            return k
    return None


def osm_halls():
    out = []
    flt = osmium.filter.TagFilter(("amenity", "townhall"), ("office", "government"))
    for country in ("KR", "KP"):
        fp = osmium.FileProcessor(str(osm_file(build_data.PBF[country]))).with_areas().with_locations().with_filter(flt)
        for o in fp:
            nm = (build_data.ko_name(o.tags) or "").replace(" ", "").replace("본관", "").replace("청사", "청")
            k = hall_kind(nm)
            if not k:
                continue
            if o.is_node():
                x, y = o.location.lon, o.location.lat
            elif o.is_area():
                try:
                    g = shapely.from_wkb(bytes.fromhex(osmium.geom.WKBFactory().create_multipolygon(o)))
                except Exception:
                    continue
                c = g.representative_point()
                x, y = c.x, c.y
            else:
                continue
            out.append({"name": nm, "k": k, "x": round(x, 5), "y": round(y, 5), "country": country})
    return out


def main():
    zones = json.loads((DATA / "zones.json").read_text(encoding="utf-8"))
    sgg = json.loads((DATA / "admin" / "sgg.geojson").read_text(encoding="utf-8"))
    geoms = {f["properties"]["id"]: shape(f["geometry"]) for f in sgg["features"]}
    tree_ids = list(geoms)
    tree = shapely.STRtree([geoms[i] for i in tree_ids])
    subs = json.loads((DATA / "subzones.geojson").read_text(encoding="utf-8"))["features"]
    places = json.loads((DATA / "places.json").read_text(encoding="utf-8"))

    def zone_at(x, y):
        pt = shapely.Point(x, y)
        for j in tree.query(pt):
            if geoms[tree_ids[j]].contains(pt):
                return tree_ids[j]
        return None

    raw = osm_halls()
    halls, seen = [], set()
    for h in raw:
        z = zone_at(h["x"], h["y"])
        if z is None or zones[z].get("ext"):
            continue
        key = (h["name"], z)
        if key in seen:   # 같은 청사의 건물·대지가 따로 올라 있다 (남구청은 여러 광역시에 있으니 존까지 본다)
            continue
        seen.add(key)
        k = h["k"]
        # 북측 직할시(평양·남포·라선·개성)의 시 인민위원회는 광역 단체 청사
        if k == "si" and h["name"].replace("인민위원회", "").replace("청", "") == zones[z]["province"]:
            k = "do"
        halls.append({"k": k, "z": z, "x": h["x"], "y": h["y"], "src": "osm", "osm": h["name"]})
    # 옛 군 땅 조각처럼 한 시군이 존 여럿이면 한 곳에만 둔다: (도, 이름)으로 본다
    cnty = lambda i: (zones[i]["province"], zones[i]["name"])
    have = {(cnty(h["z"]), h["k"]) for h in halls}
    # 시군 단위(존 하나가 한 시·군·구역): 청사가 없는 존은 소재지를 어림한다 (북측 대부분)
    guessed = 0
    for i, z in enumerate(zones):
        if z.get("ext"):
            continue
        kind = "gun" if z["name"].endswith("군") else "gu" if re.search(r"(구|구역)$", z["name"]) else "si"
        c = cnty(i)
        if (c, kind) in have or (kind == "gu" and (c, "si") in have) or (kind == "si" and (c, "gu") in have):
            continue
        # 조각 존들 가운데 가장 넓은 존에 둔다
        if any(cnty(j) == c and (zones[j].get("area") or 0) > (z.get("area") or 0) for j in range(len(zones))):
            continue
        stem = re.sub(r"(시|군|구역|구)$", "", z["name"])
        geom = geoms.get(i)
        want = [f"{stem}읍"] if kind == "gun" else [z["name"], stem]
        cand = [p for p in places if p[0] in want and geom is not None and geom.contains(shapely.Point(p[2], p[3]))]
        if cand:
            x, y = cand[0][2], cand[0][3]
        else:
            best = None
            for k in range(len(z.get("subs") or [])):
                sp = z["subs"][k]
                if best is None or sp[2] > best[2]:
                    best = sp
            if best is None:
                x, y = z["cx"], z["cy"]
            else:
                x, y = best[0], best[1]
        halls.append({"k": kind, "z": i, "x": round(x, 5), "y": round(y, 5), "src": "guess"})
        guessed += 1
        have.add((c, kind))
    halls.sort(key=lambda h: (h["z"], h["k"]))
    (DATA / "halls.json").write_text(json.dumps(halls, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by = {}
    for h in halls:
        by[(h["src"], h["k"])] = by.get((h["src"], h["k"]), 0) + 1
    print("halls", len(halls), "osm", len(halls) - guessed, "guessed", guessed, by)


if __name__ == "__main__":
    main()

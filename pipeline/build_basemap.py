"""자체 벡터 배경지도 자료를 만든다 (build_admin.py 다음에 실행). 외부 지도 타일을 쓰지 않는다.

입력
  - data/admin/*.geojson (build_admin.py): 한반도 시도·시군구·읍면동
  - Natural Earth 10m (공공 영역): 주변국 육지·국경, 하천, 호수, 도시

출력 (data/base/)
  - world.geojson     주변국 육지 (중국·러시아·일본 등, 한반도 제외)
  - water.geojson     하천(선)과 호수(면)
  - lines.geojson     군사분계선(남북 경계)
  - labels.geojson    시도·시군구·주변국 도시 라벨 점
  - data/admin/units/{n}.geojson + index.json  읍면동 경계를 시도별로 나눈 파일 (확대할 때만 받는다)

실행: python pipeline/build_basemap.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import shapely
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
ADMIN = ROOT / "data" / "admin"
OUT = ROOT / "data" / "base"
BBOX = box(116, 28, 148, 48)   # 한반도와 중국 동북·연해주·일본 서부
PREC = 0.0005


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def ne(name):
    return gpd.read_file(f"zip://{(RAW / name).as_posix()}.zip")


def fc(features, attribution=None):
    out = {"type": "FeatureCollection", "features": features}
    if attribution:
        out["attribution"] = attribution
    return out


def feat(geom, props, fid=None):
    g = shapely.set_precision(geom, PREC)
    # 판다스 결측값(NaN)은 JSON에 쓸 수 없으므로 빈 문자열로
    props = {k: ("" if isinstance(v, float) and v != v else v) for k, v in props.items()}
    f = {"type": "Feature", "properties": props, "geometry": mapping(g)}
    if fid is not None:
        f["id"] = fid
    return f


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(path.relative_to(ROOT), len(data.get("features", [])), round(path.stat().st_size / 1e3), "KB")


def main():
    sido = json.loads((ADMIN / "sido.geojson").read_text(encoding="utf-8"))["features"]
    sgg = json.loads((ADMIN / "sgg.geojson").read_text(encoding="utf-8"))["features"]
    korea = unary_union([shape(f["geometry"]) for f in sido])

    # 주변국 육지: 국가 경계에서 한반도(남북)를 빼고 단순화
    countries = ne("ne_10m_admin_0_countries")
    countries = countries[countries.intersects(BBOX)]
    world = []
    for _, r in countries.iterrows():
        if r["ADM0_A3"] in ("KOR", "PRK"):
            continue
        g = r.geometry.intersection(BBOX).simplify(0.01, preserve_topology=True)
        if g.is_empty:
            continue
        world.append(feat(g, {"name": r.get("NAME_KO") or r["NAME"], "iso": r["ADM0_A3"]}))
    write(OUT / "world.geojson", fc(world, "Natural Earth (public domain)"))

    # 하천·호수
    water = []
    rivers = ne("ne_10m_rivers_lake_centerlines")
    for _, r in rivers[rivers.intersects(BBOX)].iterrows():
        g = r.geometry.intersection(BBOX).simplify(0.003)
        if not g.is_empty:
            water.append(feat(g, {"kind": "river", "rank": int(r.get("scalerank", 9) or 9),
                                  "name": r.get("name_ko") or r.get("name") or ""}))
    lakes = ne("ne_10m_lakes")
    for _, r in lakes[lakes.intersects(BBOX)].iterrows():
        g = r.geometry.intersection(BBOX).simplify(0.003)
        if not g.is_empty:
            water.append(feat(g, {"kind": "lake", "rank": int(r.get("scalerank", 9) or 9), "name": r.get("name") or ""}))
    write(OUT / "water.geojson", fc(water, "Natural Earth (public domain)"))

    # 군사분계선: 남과 북 시도 경계가 맞닿는 선
    kr = unary_union([shape(f["geometry"]) for f in sido if f["properties"]["country"] == "KR"])
    kp = unary_union([shape(f["geometry"]) for f in sido if f["properties"]["country"] == "KP"])
    mdl = kr.boundary.intersection(kp.buffer(0.02))
    mdl = shapely.line_merge(mdl) if not mdl.is_empty else mdl
    write(OUT / "lines.geojson", fc([feat(mdl.simplify(0.002), {"kind": "mdl", "name": "군사분계선"})]))

    # 라벨: 시도(1), 시군구(2), 주변국 큰 도시(1~2)
    labels = []
    for f in sido:
        p = shape(f["geometry"]).representative_point()
        labels.append(feat(p, {"name": short_sido(f["properties"]["name"]), "rank": 1}))
    for f in sgg:
        p = shape(f["geometry"]).representative_point()
        labels.append(feat(p, {"name": f["properties"]["name"], "rank": 2, "zone": f["properties"]["id"]}))
    places = ne("ne_10m_populated_places_simple")
    places = places[places.intersects(BBOX) & ~places.intersects(korea.buffer(0.05))]
    for _, r in places.iterrows():
        if (r.get("pop_max") or 0) < 800_000:
            continue
        labels.append(feat(r.geometry, {"name": r.get("name") or "", "rank": 1 if r["pop_max"] > 5e6 else 2, "foreign": 1}))
    write(OUT / "labels.geojson", fc(labels))

    # 읍면동: 시도별 파일 + 범위 색인 (build_admin.py를 다시 돌려 units.geojson이 새로 생겼을 때만)
    if not (ADMIN / "units.geojson").exists():
        return
    units = json.loads((ADMIN / "units.geojson").read_text(encoding="utf-8"))["features"]
    zone_prov = {f["properties"]["id"]: (f["properties"]["country"], f["properties"]["province"]) for f in sgg}
    groups = defaultdict(list)
    for u in units:
        groups[zone_prov[u["properties"]["zone"]]].append(u)
    index = []
    for n, (key, feats) in enumerate(sorted(groups.items())):
        geoms = [shape(f["geometry"]) for f in feats]
        b = unary_union(geoms).bounds
        write(ADMIN / "units" / f"{n}.geojson", fc(feats))
        index.append({"file": f"{n}.geojson", "country": key[0], "province": key[1],
                      "bbox": [round(v, 3) for v in b]})
    (ADMIN / "units" / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    (ADMIN / "units.geojson").unlink()


def short_sido(name):
    for a, b in (("특별자치시", ""), ("특별자치도", ""), ("특별시", ""), ("광역시", ""), ("통합특별시", "")):
        if name.endswith(a) and len(name) > len(a) + 1:
            return name[: -len(a)] + b
    return name


if __name__ == "__main__":
    main()

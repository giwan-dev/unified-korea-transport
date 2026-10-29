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

실행: python pipeline/build_basemap.py          (읍면동 파일만: python pipeline/build_basemap.py units)
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
BBOX = box(116, 21.5, 148, 48)   # 한반도와 중국 동북·연해주·일본·대만
PREC = 0.0005
# 주변국 큰 도시 라벨의 한국어 이름 (Natural Earth simple에는 영문 이름만 있다)
FOREIGN_KO = {"Beijing": "베이징", "Shanghai": "상하이", "Tianjin": "톈진", "Shenyang": "선양", "Dalian": "다롄", "Qingdao": "칭다오",
              "Harbin": "하얼빈", "Changchun": "창춘", "Jilin": "지린", "Anshan": "안산", "Fushun": "푸순", "Benxi": "번시", "Dandong": "단둥",
              "Yanji": "옌지", "Yantai": "옌타이", "Weifang": "웨이팡", "Jinan": "지난", "Nanjing": "난징", "Hangzhou": "항저우", "Suzhou": "쑤저우",
              "Wuxi": "우시", "Ningbo": "닝보", "Hefei": "허페이", "Xuzhou": "쉬저우", "Tangshan": "탕산", "Qinhuangdao": "친황다오",
              "Vladivostok": "블라디보스토크", "Khabarovsk": "하바롭스크", "Tokyo": "도쿄", "Yokohama": "요코하마", "Kawasaki": "가와사키",
              "Osaka": "오사카", "Kōbe": "고베", "Kyoto": "교토", "Nagoya": "나고야", "Fukuoka": "후쿠오카", "Kitakyūshū": "기타큐슈",
              "Hiroshima": "히로시마", "Okayama": "오카야마", "Sendai": "센다이", "Sapporo": "삿포로", "Hamamatsu": "하마마쓰",
              "Niigata": "니가타", "Kumamoto": "구마모토", "Kagoshima": "가고시마", "Shizuoka": "시즈오카", "Naha": "나하",
              "Taipei": "타이베이", "Kaohsiung": "가오슝", "Taichung": "타이중", "Tainan": "타이난", "Taoyuan": "타오위안",
              "Fuzhou": "푸저우", "Xiamen": "샤먼", "Wenzhou": "원저우", "Daqing": "다칭", "Mudangiang": "무단장", "Jiamusi": "자무쓰"}


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
        name = {"TWN": "대만(중화민국)"}.get(r["ADM0_A3"]) or r.get("NAME_KO") or r["NAME"]
        world.append(feat(g, {"name": name, "iso": r["ADM0_A3"]}))
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
    # build_admin.py의 MERGE_ZONES로 합친 시군은 라벨도 하나만 (지금은 없음)
    merged = set()
    for f in sgg:
        nm = f["properties"]["name"]
        if nm in merged:
            parts = [g for g in sgg if g["properties"]["name"] == nm]
            if f is not max(parts, key=lambda g: shape(g["geometry"]).area):
                continue
            p = unary_union([shape(g["geometry"]) for g in parts]).representative_point()
        else:
            p = shape(f["geometry"]).representative_point()
        labels.append(feat(p, {"name": nm, "rank": 2, "zone": f["properties"]["id"]}))
    places = ne("ne_10m_populated_places_simple")
    places = places[places.intersects(BBOX) & ~places.intersects(korea.buffer(0.05))]
    for _, r in places.iterrows():
        if (r.get("pop_max") or 0) < 800_000:
            continue
        labels.append(feat(r.geometry, {"name": FOREIGN_KO.get(r.get("name"), r.get("name") or ""), "rank": 1 if r["pop_max"] > 5e6 else 2, "foreign": 1}))
    write(OUT / "labels.geojson", fc(labels))
    split_units()


def split_units():
    """읍면동: 시도별 파일 + 범위 색인 (build_admin.py를 다시 돌려 units.geojson이 새로 생겼을 때만).
    배경지도는 그대로 두고 이것만 다시 하려면: python pipeline/build_basemap.py units"""
    if not (ADMIN / "units.geojson").exists():
        return
    sgg = json.loads((ADMIN / "sgg.geojson").read_text(encoding="utf-8"))["features"]
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
    split_units() if sys.argv[1:] == ["units"] else main()

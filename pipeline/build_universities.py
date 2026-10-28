"""대학 위치를 만든다 (지도 표시, 교육 수준 계산, 북측 지도자 이름 대학 개칭용).

- 남·북 OSM의 amenity=university / amenity=college 가운데 이름이 ○○대학교·○○대학·○○전문대학 등인 것.
  캠퍼스가 건물·대지로 여러 번 올라 있으면 이름마다 하나 (가장 넓은 대지 또는 첫 점). 사이버·방송통신·대학원대학교는 뺀다
  (캠퍼스가 아니거나 학부생이 없다).
- 주요 대학만 남긴다: 남측은 주요 4년제(캠퍼스 포함)·국립대·교육대학교·과학기술원, 북측은 종합대학과 도 중심 도시의 의학·공업·사범 대학 등.
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
# 주요 대학만 남긴다 (전문대·단과대가 너무 많고, 남측 '○○대학교'에도 전문대가 섞여 이름만으로는 못 가른다)
MAJOR_KR = """서울대학교 연세대학교 고려대학교 성균관대학교 한양대학교 서강대학교 중앙대학교 경희대학교 한국외국어대학교 서울시립대학교
건국대학교 동국대학교 홍익대학교 숙명여자대학교 이화여자대학교 국민대학교 숭실대학교 세종대학교 단국대학교 광운대학교 명지대학교
상명대학교 가톨릭대학교 서울과학기술대학교 서울여자대학교 성신여자대학교 동덕여자대학교 덕성여자대학교 한성대학교 삼육대학교 서경대학교
인하대학교 아주대학교 경기대학교 가천대학교 한국항공대학교 인천대학교 한국공학대학교 수원대학교 한신대학교 대진대학교 차의과학대학교
강원대학교 강릉원주대학교 한림대학교 상지대학교 연세대학교 충북대학교 충남대학교 한국교원대학교 한국기술교육대학교 공주대학교 순천향대학교
한밭대학교 한남대학교 대전대학교 배재대학교 우송대학교 목원대학교 청주대학교 서원대학교 한국교통대학교 건양대학교 호서대학교 선문대학교
전북대학교 전남대학교 조선대학교 목포대학교 순천대학교 원광대학교 군산대학교 우석대학교 호남대학교 광주대학교 목포해양대학교
경북대학교 영남대학교 계명대학교 대구대학교 대구가톨릭대학교 포항공과대학교 한동대학교 안동대학교 금오공과대학교 경일대학교 동국대학교
부산대학교 부경대학교 동아대학교 동의대학교 경성대학교 신라대학교 한국해양대학교 부산외국어대학교 고신대학교 인제대학교
울산대학교 경상국립대학교 창원대학교 경남대학교 제주대학교""".split()
MAJOR_KR_RX = re.compile(r"^(국립|.*교육대학교|.*과학기술원|KAIST|UNIST|DGIST|GIST|카이스트|유니스트|디지스트|지스트)")
MAJOR_KP = set("""김일성종합대학 김책공업종합대학 김일성종합대학 평양의학대학 평양외국어대학 평양건축종합대학 평양철도종합대학 평양과학기술대학
김형직사범대학 인민경제대학 평양기계대학 리과대학 고려성균관대학 김원균음악종합대학 평양미술대학 흥남화학대학 청진의학대학 해주의학대학
해주공업대학 신의주의과대학 신의주경공업대학 원산수산대학 조군실원산공업대학 평성석탄공업대학 김정숙사범대학 강계교원대학 희천공업대학
사리원교원대학 남포사범대학""".replace("김일성종합대학 평양의학대학", "김일성종합대학_평양의학대학").split())
NOT_CAMPUS = re.compile(r"본관|[^캠]관$|수련원|연수원|병원|부속|평생|대학원$|정문|후문|쪽문|주차장|학술림|산학|사업단|센터|교육원|선수촌|팩토리|[A-Za-z0-9]동$|부지|치과대학|캨퍼스")


def is_major(name, country):
    if country == "KP":
        return name.replace(" ", "_") in MAJOR_KP or name in MAJOR_KP
    if NOT_CAMPUS.search(name):
        return False
    return bool(MAJOR_KR_RX.search(name)) or any(name == m or name.startswith(m + " ") for m in MAJOR_KR)


COLLEGE = re.compile(r"전문대학|폴리텍|보건대학|기능대학|과학대학$|간호대학$|예술대학$|산업대학$|전문학교$")


def dedupe(out):
    """같은 대학이 본교 이름과 캠퍼스 이름으로 2km 안에 겹쳐 올라 있으면 짧은 이름 하나만 (서울대학교 / 서울대학교 관악캠퍼스)"""
    keep = []
    for u in sorted(out, key=lambda u: len(u["n"])):
        base = u["n"].split()[0]
        if any(k["n"].split()[0] == base and abs(k["x"] - u["x"]) * 88 < 2 and abs(k["y"] - u["y"]) * 111 < 2 for k in keep):
            continue
        keep.append(u)
    return sorted(keep, key=lambda u: (u["c"], u["z"], u["n"]))


def refilter():
    """OSM을 다시 읽지 않고 지금 data/universities.json에 거르기만 다시 한다"""
    path = DATA / "universities.json"
    out = dedupe([u for u in json.loads(path.read_text(encoding="utf-8")) if is_major(u["n"], u["c"])])
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("universities", len(out), sum(u["c"] == "KR" for u in out), sum(u["c"] == "KP" for u in out))


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
            if not nm or not re.search(r"대학|전문학교|과학기술원|KAIST|UNIST|DGIST|GIST|카이스트|유니스트|디지스트|지스트", nm) or SKIP.search(nm):
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
    out = dedupe(sorted(({k: v for k, v in u.items() if k != "area"} for u in best.values() if is_major(u["n"], u["c"])), key=lambda u: (u["c"], u["z"], u["n"])))
    (DATA / "universities.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by = {}
    for u in out:
        by[(u["c"], u["k"])] = by.get((u["c"], u["k"]), 0) + 1
    print("universities", len(out), by)
    print("KP sample", [u["n"] for u in out if u["c"] == "KP"][:40])


if __name__ == "__main__":
    refilter() if "--refilter" in sys.argv else main()

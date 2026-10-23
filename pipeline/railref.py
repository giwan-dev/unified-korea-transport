"""한반도 철도 DB(Zermoth, KOREA RAILROAD DB, Google Earth KMZ)를 참고 자료로 읽는다.

OSM 선로 도형은 그대로 쓰고, 이 DB에서는 사실 정보만 가져온다.
- 역마다 어느 노선에 서는지 (OSM 역을 엉뚱한 노선, 예: 범일·석수를 경부고속선에 붙이지 않게)
- OSM에 없는 역 (특히 북측)
- OSM에 이름이 없는 선로 구간의 노선 이름

파일(data/raw/KoreaRailroad_*.kmz)이 없으면 아무것도 하지 않는다. 저장소에는 올리지 않는다.
"""
from __future__ import annotations

import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"k": "http://www.opengis.net/kml/2.2"}
OPEN = ("영업중", "개업예정")
# 영업시설 폴더에는 여객역 말고도 기계실·분기점·관측소 같은 시설이 섞여 있다
OPERATOR = re.compile(r"(철도성|공사$|주식회사|철도국|기업소|관리국|사업소|운수)")
NOT_STATION = re.compile(r"(기계실|분기|기상|관측|시험\d*$|신호장|신호소|조차장|기지|사업소|기관차|변전|연결선|차량|공장|기업소|창$|발전소)")


def find_kmz(raw: Path) -> Path | None:
    files = sorted(raw.glob("KoreaRailroad_*.kmz"))
    return files[-1] if files else None


LINE_ALIAS = {"대곡소사선": "서해선", "소사원시선": "서해선", "소사대곡선": "서해선"}


def norm_line(name: str) -> str:
    """노선 이름 비교용: 운영사 접두어와 띄어쓰기를 뗀다 ('서울교통공사 6호선' → '6호선', '서울 경전철 동북선' → '동북선')"""
    n = re.sub(r"\s+", "", name or "")
    for pre in ("서울교통공사", "서울경전철", "수도권전철", "서울지하철", "부산도시철도", "대구도시철도", "인천도시철도",
                "광주도시철도", "대전도시철도", "구", "북한"):
        if n.startswith(pre) and len(n) > len(pre) + 1:
            n = n[len(pre):]
    if len(n) > 3 and n.endswith("본선"):
        n = n[:-2] + "선"
    # DB의 옛 노선 이름 → 지금 이름 (서해선은 대곡소사선·소사원시선을 하나로 부른다)
    n = LINE_ALIAS.get(n, n)
    # GTX 표기 맞추기: 'A노선'(DB) ↔ '에이선'(OSM)
    for a, b in (("A노선", "에이선"), ("B노선", "비선"), ("C노선", "씨선"), ("D노선", "디선"), ("E노선", "이선")):
        if n.endswith(a):
            n = n[: -len(a)] + b
    return n


PREFIXES = ("SRT", "SR", "KTX", "ITX", "지티엑스", "GTX", "지하", "트램")


# 가칭으로 올라온 역 이름 → 실제 이름
NAME_ALIAS = {"USKR": "국제테마파크"}


def norm_station(name: str) -> str:
    """역 이름 비교용: 괄호·'역'·운영사 앞말을 뗀다 ('SR수서'·'KTX광명'·'지하서울' → '수서'·'광명'·'서울')"""
    n = (name or "").split("(")[0].strip()
    n = NAME_ALIAS.get(n, n)
    for p in PREFIXES:
        if n.startswith(p) and len(n) > len(p) + 1:
            n = n[len(p):].strip()
            break
    if n.endswith("역동편") or n.endswith("역서편"):
        n = n[:-3]
    return n[:-1] if len(n) > 2 and n.endswith("역") else n


def load(raw: Path):
    """→ {"stations": [(이름, {노선…}, 경도, 위도, 상태)], "paths": [(노선, 나라, [(경도, 위도)…], 구분)]}"""
    kmz = find_kmz(raw)
    if not kmz:
        return None
    with zipfile.ZipFile(kmz) as z:
        root = ET.fromstring(z.read("doc.kml"))
    stations, paths = {}, []

    def walk(el, path):
        for ch in el:
            tag = ch.tag.split("}")[1]
            if tag in ("Folder", "Document"):
                walk(ch, path + [ch.findtext("k:name", default="", namespaces=NS)])
            elif tag == "Placemark":
                coords = ch.find(".//k:coordinates", NS)
                if coords is None or not coords.text:
                    continue
                pts = [tuple(map(float, p.split(",")[:2])) for p in coords.text.split()]
                name = ch.findtext("k:name", default="", namespaces=NS)
                if len(path) > 5 and path[1] == "Path" and path[4] == "영업":
                    # Path/ASIA/<나라>/영업/<구분>/<운영사>/<노선>. 운영사 폴더 바로 밑의 선은 그 이름이 노선 이름이다 (북측 전용선)
                    line = path[-1]
                    if OPERATOR.search(line):
                        line = name if name.endswith("선") else ""
                    if line:
                        paths.append((line, path[3], pts, path[5]))   # path[5]: 국철·도시철도·전용선·궤도선 등 구분
                elif len(path) > 3 and path[1] == "Point" and path[2] == "영업시설" and path[3] in OPEN:
                    # Point/영업시설/<상태>/<노선>: 역은 노선마다 한 번씩 나온다
                    if NOT_STATION.search(name) or " " in name.strip():   # 공백이 든 이름은 호텔·버스 정류장
                        continue
                    desc = ch.findtext("k:description", default="", namespaces=NS) or ""
                    lines = set(re.findall(r"<center>([^<]+)</center>", desc)) | {path[-1]}
                    key = (norm_station(name), round(pts[0][0], 3), round(pts[0][1], 3))
                    cur = stations.get(key)
                    if cur:
                        cur[1].update(lines)
                    else:
                        stations[key] = [norm_station(name), lines, pts[0][0], pts[0][1], path[3]]
    walk(root, [])
    out = [(n, {norm_line(x) for x in ls}, lon, lat, st) for n, ls, lon, lat, st in stations.values()]
    return {"stations": out, "paths": [(norm_line(n), c, p, k) for n, c, p, k in paths], "file": kmz.name}


URBAN = ("도시철도", "궤도선")


def mainline_paths(ref):
    """철도 DB 선로 가운데 일반철도(국철·전용선 등)만: 도시철도 이름이 그 밑을 지나는 일반철도에 붙지 않게"""
    return [(n, c, p) for n, c, p, k in ref["paths"] if k not in URBAN]

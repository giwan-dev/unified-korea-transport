"""공개 데이터로 게임용 존·네트워크·지명 데이터를 만든다.

입력 (data/raw, download.sh 참고)
  - Geofabrik OSM 추출본: south-korea, north-korea (ODbL)
  - WorldPop 2025 (R2025A) 1km constrained UN-adjusted 인구 격자: KOR, PRK (CC BY 4.0)

출력 (data/)
  - raw/zones.geojson  존 경계와 인구 (파이프라인 내부용, build_grid가 zones.json으로 정리)
  - network.bin, network.meta.json  단순화한 도로·철도·도시철도망 (netpack.py 형식), 역, IC/JCT
  - places.json     신규 역·IC 이름 자동 생성용 지명

실행: python pipeline/build_data.py
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import osmium
import rasterio
import rasterio.features
import shapely
from shapely import wkb
from shapely.geometry import mapping
from shapely.ops import unary_union

import railref

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
PBF = {"KR": RAW / "south-korea.osm.pbf", "KP": RAW / "north-korea.osm.pbf"}
POP = {"KR": RAW / "kor_pop2025.tif", "KP": RAW / "prk_pop2025.tif"}
# OSM 도 경계가 깨진 곳(평안북도 등)에서 소속 도를 찾을 때만 쓴다. GADM 도형은 출력에 넣지 않는다.
GADM_PRK = RAW / "gadm41_PRK_2.json.zip"
GADM_PROVINCE_KO = {"개성공업지구": "개성시", "금강산관광지구": "강원도", "평양직할시": "평양시",
                    "라선직할시": "라선시", "신의주특별행정구": "평안북도"}

# 시도(남) / 도·직할시(북). OSM admin_level=4 이름 기준이며 중국·러시아 행정구역은 제외한다.
# 북의 '강원도'와 남의 '강원특별자치도'는 OSM에서 별개 구역이다.
PROVINCES = {
    "KR": {
        "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시",
        "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도",
        "전북특별자치도", "전라북도", "전라남도", "전남광주통합특별시", "경상북도", "경상남도",
        "제주특별자치도",
    },
    "KP": {
        "평양시", "평양직할시", "남포시", "라선시", "개성시", "평안남도", "평안북도", "자강도",
        "량강도", "양강도", "함경남도", "함경북도", "황해남도", "황해북도", "강원도",
    },
}

# 네트워크 단순화 격자 크기(도). 약 500m. 왕복 분리 차로·복선 선로를 한 링크로 합치되
# 교차로·분기점 위치는 500m 안쪽으로 맞춘다. 화면에는 실제 웨이 도형을 따로 그린다.
GRID = 0.005
# 인구 50만 이상 도시 안에서는 약 100m 격자로 교차로를 따로 살린다 (실제 OSM 교차점 노드 좌표를 쓴다).
# 칸 번호는 0.001도 단위의 정수로 통일한다: 바깥은 5칸(0.005도), 도시 안은 1칸(0.001도)씩.
# 왕복 분리 도로의 두 차도는 merge_dual_carriageways가 한 칸으로 합친다.
UNIT = 0.001
COARSE, FINE = 5, 1
CITY_MIN_POP = 500_000
CITY_CELLS = set()      # 도시 안인 바깥 격자 칸 (round(lon/GRID), round(lat/GRID))
# 도시 안에서만 넣는 낮은 등급 도로: 남측 2차 도로(secondary). 3차 도로는 넣지 않는다
CITY_ONLY_ROADS = {}   # 3차 도로(tertiary)까지 넣으면 계산망이 2.5배가 되어 해마다 계산이 너무 느려진다

ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary"]
ROAD_LINKS = {"motorway_link": "motorway", "trunk_link": "trunk", "primary_link": "primary", "secondary_link": "secondary"}
WGS84_KM = 111.32


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def ko_name(tags) -> str | None:
    return tags.get("name:ko") or tags.get("name")


# ---------------------------------------------------------------- 행정구역


def load_admin(country: str, levels=("4", "6")):
    """행정경계 면을 만든다. 경계 태그가 붙은 객체만 C++ 쪽에서 걸러 넘긴다.

    국경 하천 등에서 링이 끊겨 면 조립에 실패한 관계는 구성 웨이를 polygonize해서 복구한다.
    """
    fab = osmium.geom.WKBFactory()
    admin = osmium.filter.TagFilter(("boundary", "administrative"))
    fp = osmium.FileProcessor(str(PBF[country])).with_areas(admin).with_filter(admin)
    areas = []
    built = set()
    for obj in fp:
        if not obj.is_area() or obj.from_way():
            continue
        t = obj.tags
        lvl = t.get("admin_level")
        name = ko_name(t)
        if lvl not in levels or not name:
            continue
        try:
            geom = wkb.loads(fab.create_multipolygon(obj), hex=True)
        except Exception:
            continue
        areas.append({"level": int(lvl), "name": name, "geom": geom})
        built.add(obj.orig_id())

    # 실패한 관계 복구
    failed = {}
    for r in osmium.FileProcessor(str(PBF[country]), osmium.osm.RELATION).with_filter(admin):
        t = r.tags
        lv = t.get("admin_level")
        if lv == "4" and ko_name(t) not in PROVINCES[country]:
            continue
        if lv in levels and ko_name(t) and r.id not in built:
            failed[r.id] = (int(t["admin_level"]), ko_name(t),
                            [m.ref for m in r.members if m.type == "w" and m.role in ("outer", "")])
    if failed:
        need = {w for _, _, ws in failed.values() for w in ws}
        lines = {}
        for w in osmium.FileProcessor(str(PBF[country]), osmium.osm.NODE | osmium.osm.WAY)                 .with_locations().with_filter(osmium.filter.IdFilter(need)):
            if w.is_way():
                try:
                    lines[w.id] = shapely.LineString([(n.lon, n.lat) for n in w.nodes])
                except Exception:
                    pass
        for rid, (lvl, name, ws) in failed.items():
            ls = [lines[w] for w in ws if w in lines]
            if not ls:
                continue
            merged = shapely.line_merge(unary_union(ls))
            polys = list(shapely.ops.polygonize(shapely.node(merged)))
            if not polys:
                # 끊긴 링: 끝점끼리 이어 닫는다
                hull = unary_union(ls).buffer(0.002).buffer(-0.002)
                polys = [g for g in getattr(hull, "geoms", [hull]) if g.geom_type == "Polygon"]
            if not polys:
                continue
            polys = [shapely.make_valid(g) for g in polys]
            try:
                geom = unary_union(polys)
            except shapely.errors.GEOSException:
                geom = max(polys, key=lambda g: g.area)
            if geom.area < 1e-4:
                continue
            areas.append({"level": lvl, "name": name, "geom": geom, "repaired": True})
            log(country, "repaired", lvl, name, round(geom.area, 3))
    log(country, "admin areas", len(areas))
    return areas


def build_zones(countries=("KR", "KP")):
    """OSM 시군구 경계. admin_master.pkl이 없을 때와 북측 보로노이 구역을 만들 때 쓴다."""
    zones = []
    for c in countries:
        areas = load_admin(c)
        provinces = [a for a in areas if a["level"] == 4 and a["name"] in PROVINCES[c]]
        log(c, "provinces", sorted(p["name"] for p in provinces))

        fallback = _gadm_provinces() if c == "KP" else []

        def province_of(g):
            p = g.representative_point()
            for pr in provinces:
                if pr["geom"].contains(p):
                    return pr["name"]
            for name, geom in fallback:
                if geom.contains(p):
                    return name
            return None

        seen = set()
        covered = set()
        for a in sorted(areas, key=lambda x: x.get("repaired", False)):
            if a["level"] != 6:
                continue
            prov = province_of(a["geom"])
            if not prov or (a["name"], prov) in seen:
                continue
            seen.add((a["name"], prov))
            covered.add(prov)
            zones.append({**a, "province": prov, "country": c})
        # 6레벨 구역이 없는 도(예: 특별시)는 도 전체를 하나의 존으로 둔다
        for pr in provinces:
            if pr["name"] not in covered:
                log("no level-6 zones in", pr["name"], "- using province as one zone")
                zones.append({**pr, "province": pr["name"], "country": c})
                continue
            # 시·군 경계로 덮이지 않은 땅(예: 개성 시내처럼 도 바로 아래 있는 중심 구역)은 따로 존을 만든다
            mine = [z["geom"] for z in zones if z["province"] == pr["name"]]
            try:
                rest = shapely.make_valid(pr["geom"]).difference(shapely.make_valid(unary_union(mine)))
            except shapely.errors.GEOSException:
                continue
            parts = [g for g in getattr(rest, "geoms", [rest]) if g.geom_type == "Polygon" and g.area > 0.002]
            if parts:
                log("uncovered area in", pr["name"], round(sum(g.area for g in parts), 3), "-> extra zone")
                zones.append({"level": 6, "name": pr["name"], "geom": unary_union(parts), "province": pr["name"], "country": c})
    log("zones", len(zones), "KR", sum(z["country"] == "KR" for z in zones),
        "KP", sum(z["country"] == "KP" for z in zones))
    return zones


def _gadm_provinces():
    if not GADM_PRK.exists():
        log("GADM PRK not found; zones in provinces with broken OSM boundaries will be missing")
        return []
    import geopandas as gpd
    g = gpd.read_file(f"zip://{GADM_PRK.as_posix()}")
    out = []
    for name, part in g.groupby("NL_NAME_1"):
        out.append((GADM_PROVINCE_KO.get(name, name), unary_union(part.geometry.buffer(0.002))))
    return out


def add_population(zones):
    for c in ("KR", "KP"):
        with rasterio.open(POP[c]) as src:
            arr = src.read(1).astype("float64")
            arr[arr < 0] = 0
            if src.nodata is not None:
                arr[arr == src.nodata] = 0
            zs = [z for z in zones if z["country"] == c]
            ids = rasterio.features.rasterize(
                ((mapping(z["geom"]), i + 1) for i, z in enumerate(zs)),
                out_shape=arr.shape, transform=src.transform, fill=0, dtype="int32",
                all_touched=False)
            # 어느 존에도 안 든 인구 격자(경계 오차·해안)는 가장 가까운 존에 붙인다
            from scipy import ndimage
            miss = (ids == 0) & (arr > 0)
            if miss.any():
                _, (ri, ci) = ndimage.distance_transform_edt(ids == 0, return_indices=True)
                ids = np.where(miss, ids[ri, ci], ids)
            sums = np.bincount(ids.ravel(), weights=arr.ravel(), minlength=len(zs) + 1)
            rows, cols = np.indices(arr.shape)
            xs, ys = rasterio.transform.xy(src.transform, rows.ravel(), cols.ravel())
            xs = np.asarray(xs); ys = np.asarray(ys)
            wx = np.bincount(ids.ravel(), weights=arr.ravel() * xs, minlength=len(zs) + 1)
            wy = np.bincount(ids.ravel(), weights=arr.ravel() * ys, minlength=len(zs) + 1)
            log(c, "raster total", round(arr.sum()), "assigned", round(sums[1:].sum()))
            for i, z in enumerate(zs):
                s = sums[i + 1]
                z["pop"] = float(s)
                if s > 0:
                    z["cx"], z["cy"] = wx[i + 1] / s, wy[i + 1] / s
                else:
                    p = z["geom"].representative_point()
                    z["cx"], z["cy"] = p.x, p.y


# ---------------------------------------------------------------- 네트워크


def cell_of(lon, lat):
    if (round(lon / GRID), round(lat / GRID)) in CITY_CELLS:
        s = FINE * UNIT
        return (FINE * round(lon / s), FINE * round(lat / s))
    return (COARSE * round(lon / GRID), COARSE * round(lat / GRID))


def in_city(lon, lat):
    return (round(lon / GRID), round(lat / GRID)) in CITY_CELLS


def mark_cities(zones):
    """인구 50만 이상 도시(특별·광역시는 자치구를 합쳐서, 그 밖은 시 하나)의 바깥 격자 칸을 CITY_CELLS에 넣는다"""
    groups = defaultdict(list)
    for z in zones:
        prov = z.get("province") or ""
        metro = prov.endswith(("특별시", "광역시", "직할시")) or prov in ("평양시", "남포시")
        if metro:
            # 광역시의 군(기장군·달성군 등)은 시가지가 아니므로 뺀다
            if not z["name"].endswith(("구", "구역")):
                continue
            groups[prov].append(z)
        else:
            groups[z["name"]].append(z)
    cities = []
    for name, zs in groups.items():
        pop = sum(z.get("pop", 0) for z in zs)
        if pop < CITY_MIN_POP:
            continue
        cities.append((name, pop))
        geom = unary_union([z["geom"] for z in zs])
        x0, y0, x1, y1 = geom.bounds
        shapely.prepare(geom)
        for i in range(int(x0 / GRID) - 1, int(x1 / GRID) + 2):
            for j in range(int(y0 / GRID) - 1, int(y1 / GRID) + 2):
                if geom.intersects(shapely.box((i - 0.5) * GRID, (j - 0.5) * GRID, (i + 0.5) * GRID, (j + 0.5) * GRID)):
                    CITY_CELLS.add((i, j))
    log("big cities", len(cities), ", ".join(f"{n} {p // 10000}만" for n, p in sorted(cities, key=lambda x: -x[1])))
    log("city grid cells", len(CITY_CELLS))


class NetHandler:
    def __init__(self, country, seen_ways):
        self.country = country
        self.seen_ways = seen_ways  # 두 추출본에 겹치는 웨이는 한 번만 센다
        self.segs = []          # (mode, cls, cellA, cellB, attrs)
        self.cellpts = defaultdict(lambda: [0.0, 0.0, 0])
        # 실제 교차점: 여러 웨이가 함께 쓰는 OSM 노드. 격자 칸의 대표 좌표로 쓴다
        self.node_use = {}
        self.junction = {}      # (수단, 칸) → (사용 횟수, 경도, 위도)
        self.modepts = defaultdict(lambda: [0.0, 0.0, 0])   # (수단, 칸) → 그 수단 점들의 합 (노드 자리)
        self.modefirst = {}     # (수단, 칸) → 그 칸에서 처음 만난 실제 선 위의 점 (노드 자리 후보)
        self.station_ids = {}   # OSM 노드 id → 역 이름 (선로 위에 찍힌 역을 그 선로 칸에 바로 붙이려고)
        self.rail_ref = {}      # 철도 OSM 노드 id → (칸, {노선 이름}): 이름이 다른 선로가 실제로 만나는 곳을 찾으려고
        self.metro_ref = {}     # 도시철도도 같은 방식 (노선 = route 이름)
        self.on_track = {}      # 역 이름·좌표 → (칸, 노선 이름, 등급): 선로 웨이에 들어 있는 역
        self.stations = []      # (name, lon, lat)
        self.metro_stations = []  # 도시철도·경전철 역
        self.junctions = []     # (name, lon, lat)
        self.places = []        # (name, kind, lon, lat)
        self.metro_routes = {}  # 웨이 id → (노선 이름, 색)

    def run(self, pbf):
        # 도시철도 노선(route relation)을 먼저 읽어 웨이마다 노선 이름·색을 붙인다
        rf = osmium.filter.TagFilter(("route", "subway"), ("route", "light_rail"), ("route", "monorail"))
        for r in osmium.FileProcessor(str(pbf), osmium.osm.RELATION).with_filter(rf):
            name = r.tags.get("ref:ko") or r.tags.get("name:ko") or r.tags.get("name") or ""
            name = _route_name(name)
            colour = r.tags.get("colour") or ""
            for m in r.members:
                # 한 선로가 여러 운행 노선(일반·급행)에 들면 가장 짧은 이름(기본 노선)을 쓴다
                if m.type == "w" and (m.ref not in self.metro_routes or len(name) < len(self.metro_routes[m.ref][0])):
                    self.metro_routes[m.ref] = (name, colour)
        fp = osmium.FileProcessor(str(pbf), osmium.osm.NODE | osmium.osm.WAY)             .with_locations().with_filter(osmium.filter.KeyFilter("highway", "railway", "place", "construction:railway"))
        for obj in fp:
            if obj.is_node():
                self.node(obj)
            elif obj.is_way():
                self.way(obj)

    def node(self, n):
        t = n.tags
        if not t:
            return
        loc = n.location
        # 도시철도·경전철 전용역은 본선망에 없으므로 뺀다. 동대구·용산처럼 일반열차가 서는 역(train=yes)은 둔다
        urban_only = t.get("train") != "yes" and (
            t.get("station") in ("subway", "light_rail", "monorail") or t.get("subway") == "yes")
        # 공사 중 노선의 역(railway=construction + construction=station 등)도 읽는다: 개통하면 바로 쓰도록
        is_station = (t.get("railway") in ("station", "halt")
                      or (t.get("railway") == "construction" and t.get("construction") in ("station", "halt"))
                      or t.get("construction:railway") in ("station", "halt")) and ko_name(t)             and not ko_name(t).isdigit()   # 공사 중 역의 '108' 같은 가칭 번호는 뺀다
        if is_station:
            self.station_ids[n.id] = (ko_name(t), loc.lon, loc.lat)
        if is_station and (t.get("station") in ("subway", "light_rail", "monorail")
                           or t.get("subway") == "yes" or t.get("light_rail") == "yes" or t.get("monorail") == "yes"):
            self.metro_stations.append((ko_name(t), loc.lon, loc.lat))
        if is_station and not urban_only:
            self.stations.append((ko_name(t), loc.lon, loc.lat))
        elif t.get("highway") == "motorway_junction" and ko_name(t):
            self.junctions.append((ko_name(t), loc.lon, loc.lat))
        p = t.get("place")
        if p in ("city", "town", "village", "suburb") and ko_name(t):
            self.places.append((ko_name(t), p, round(loc.lon, 4), round(loc.lat, 4)))

    def way(self, w):
        t = w.tags
        hw = t.get("highway")
        rw = t.get("railway")
        # 공사 중 노선은 원래 등급으로 읽고 개통 연도를 붙인다 (게임에서 그해에 자동 개통)
        opening = 0
        if hw == "construction" and t.get("construction") in set(ROAD_CLASSES) | set(ROAD_LINKS):
            hw = t.get("construction")
            opening = _opening_year(t, 2029 if hw.startswith("motorway") else 2028)
        elif rw == "construction" and t.get("construction") in ("rail", "subway", "light_rail", "monorail"):
            rw = t.get("construction")
            opening = _opening_year(t, 2030)
        city_road = hw in CITY_ONLY_ROADS or (hw in ("secondary", "secondary_link") and self.country == "KR")
        if hw in ROAD_CLASSES or hw in ROAD_LINKS or hw in CITY_ONLY_ROADS:
            # 남측 2차 도로와 3차 도로는 대도시 안에서만 넣는다 (웨이 가운데 점 기준)
            if city_road:
                try:
                    mid = w.nodes[len(w.nodes) // 2]
                    if not in_city(mid.lon, mid.lat):
                        return
                except osmium.InvalidLocationError:
                    return
            mode, cls = "road", CITY_ONLY_ROADS.get(hw) or ROAD_LINKS.get(hw, hw)
            oneway = t.get("oneway") in ("yes", "1") or hw == "motorway"
            lanes = _int(t.get("lanes"))
            attrs = {
                "opening": opening,
                "oneway": oneway, "lanes": lanes,
                "paved": t.get("surface") not in ("unpaved", "dirt", "gravel", "ground", "compacted"),
                "name": ko_name(t), "ref": t.get("ref"), "ramp": hw in ROAD_LINKS or hw == "tertiary_link",
            }
        elif rw == "rail" and t.get("service") is None and t.get("usage") in (None, "main", "branch"):
            mode = "rail"
            # 고속 전용선만 고속선으로 본다. 중앙선·경강선 일부처럼 시속 250km로 개량했어도
            # 일반열차와 함께 쓰는 선로(highspeed=yes)는 일반선으로 두고 최고속도만 반영한다
            nm = ko_name(t) or ""
            hs = t.get("highspeed") == "yes" and "고속" in nm
            cls = "hsr" if hs else "conv"
            volt = _int(t.get("voltage"))
            elec = t.get("electrified") in ("contact_line", "yes")
            attrs = {
                "opening": opening,
                "tracks": _int(t.get("tracks")), "oneway": False,
                "power": ("AC" if volt and volt >= 15000 else "DC") if elec else "none",
                "name": _rail_name(ko_name(t) or "") or None, "maxspeed": _int(t.get("maxspeed")),
            }
        elif rw in ("subway", "light_rail", "monorail") and t.get("service") is None:
            mode, cls = "metro", "metro"
            route, colour = self.metro_routes.get(w.id, (ko_name(t) or "", ""))
            attrs = {"tracks": 2, "oneway": False, "power": "AC", "name": route or ko_name(t),
                     "maxspeed": None, "route": route, "colour": colour, "opening": opening}
        else:
            return
        if w.id in self.seen_ways:
            return
        self.seen_ways.add(w.id)
        try:
            pts = [(nd.lon, nd.lat) for nd in w.nodes]
            refs = [nd.ref for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        # 도로·철도·도시철도는 노드를 따로 둔다: 건널목처럼 서로 닿는 점도 그 수단 안에서만 교차점으로 센다
        g = MODE_KEY[mode]
        if mode == "metro":
            line_name = attrs.get("route") or attrs.get("name") or ""
            for ref, (lon, lat) in zip(refs, pts):
                rr = self.metro_ref.get(ref)
                if rr is None:
                    self.metro_ref[ref] = (cell_of(lon, lat), {line_name})
                else:
                    rr[1].add(line_name)
        if mode == "rail":
            line_name = _rail_name(attrs.get("name") or "")
            for ref, (lon, lat) in zip(refs, pts):
                rr = self.rail_ref.get(ref)
                if rr is None:
                    self.rail_ref[ref] = (cell_of(lon, lat), {line_name})
                else:
                    rr[1].add(line_name)
                st = self.station_ids.get(ref)
                if st:
                    self.on_track[st] = (cell_of(lon, lat), _rail_name(attrs.get("name") or ""), cls)
        for ref, (lon, lat) in zip(refs, pts):
            k = self.node_use.get((g, ref), 0) + 1
            self.node_use[(g, ref)] = k
            if k >= 2:
                c = (g, cell_of(lon, lat))
                cur = self.junction.get(c)
                if cur is None or k > cur[0]:
                    self.junction[c] = (k, lon, lat)
        prev = None
        buf = []
        for lon, lat in pts:
            c = cell_of(lon, lat)
            cp = self.cellpts[c]
            cp[0] += lon; cp[1] += lat; cp[2] += 1
            mp = self.modepts[(g, c)]
            mp[0] += lon; mp[1] += lat; mp[2] += 1
            self.modefirst.setdefault((g, c), (lon, lat))
            if prev is not None and c != prev:
                # 세그먼트 도형: 앞 셀의 마지막 점부터 이번 점까지
                self.segs.append((mode, cls, prev, c, attrs, buf + [(lon, lat)]))
                buf = []
            buf.append((lon, lat))
            prev = c


def _opening_year(t, default):
    """opening_date(예: 2027-12) 태그의 연도, 없으면 기본값"""
    for k in ("opening_date", "construction:end_date", "end_date"):
        v = t.get(k) or ""
        if len(v) >= 4 and v[:4].isdigit() and 2025 <= int(v[:4]) <= 2045:
            return max(int(v[:4]), 2027)
    return default


def _rail_name(name):
    """OSM에서 같은 노선을 다르게 적은 이름을 하나로: '경부본선' → '경부선' (본선은 지선과 구별하려 붙인 말)"""
    if len(name) > 3 and name.endswith("본선"):
        return name[:-2] + "선"
    return name


def _route_name(name):
    """'수도권 전철 2호선: 성수 → 신도림' 같은 방향 표기와 '급행'·'일반' 같은 운행 종별을 떼어 노선 이름만 남긴다
    (같은 선로를 쓰는 '9호선'과 '9호선 급행'이 다른 노선으로 갈리면 선로가 두 줄로 남는다)"""
    for sep in (":", "(", " - "):
        if sep in name:
            name = name.split(sep)[0]
    name = name.strip()
    for suf in (" 급행", " 일반", " 완행", " 직통", " 특급", "급행"):
        if name.endswith(suf) and len(name) > len(suf) + 2:
            name = name[: -len(suf)].strip()
    return name


def _int(v):
    try:
        return int(str(v).split(";")[0].split(".")[0])
    except (TypeError, ValueError):
        return None


ROAD_DEFAULTS = {
    # (기본 차로수, 남 속도, 북 속도) - 속도는 혼잡 없는 평균 주행속도(km/h)
    "motorway": (4, 95, 60),
    "trunk": (4, 70, 45),
    "primary": (2, 55, 40),
    "secondary": (2, 45, 30),
}
CLASS_RANK = {"motorway": 4, "trunk": 3, "primary": 2, "secondary": 1, "hsr": 5, "conv": 1, "metro": 0}


def build_network(zones):
    mark_cities(zones)
    handlers = {}
    seen_ways = set()
    for c in ("KR", "KP"):
        h = NetHandler(c, seen_ways)
        h.run(PBF[c])
        log(c, "segments", len(h.segs), "stations", len(h.stations), "places", len(h.places))
        handlers[c] = h

    # 셀 단위 엣지 병합. 국가는 셀 대표점이 속한 존으로 판정한다.
    cellpts = defaultdict(lambda: [0.0, 0.0, 0])
    modepts = defaultdict(lambda: [0.0, 0.0, 0])
    modefirst = {}
    junction = {}
    for h in handlers.values():
        for k, v in h.cellpts.items():
            cp = cellpts[k]; cp[0] += v[0]; cp[1] += v[1]; cp[2] += v[2]
        for k, v in h.modepts.items():
            cp = modepts[k]; cp[0] += v[0]; cp[1] += v[1]; cp[2] += v[2]
        for k, v in h.modefirst.items():
            modefirst.setdefault(k, v)
        for k, v in h.junction.items():
            if k not in junction or v[0] > junction[k][0]:
                junction[k] = v
        h.node_use = None
    edges = {}
    for c, h in handlers.items():
        for mode, cls, a, b, at, pts in h.segs:
            # 이름이 다른 철도(경부선·경부고속선)가 같은 칸을 지나도 한 엣지로 합치지 않는다 (합치면 이름이 다수결로 섞인다)
            route = at.get("route", "") if mode == "metro" else (at.get("name") or "") if mode == "rail" else ""
            if at.get("opening"):
                route = f"{route}@{at['opening']}"
            key = (mode, min(a, b), max(a, b), route)
            e = edges.get(key)
            if e is None:
                e = edges[key] = {"mode": mode, "cls": cls, "lanes2": 0, "lanes1": 0, "tracks": 0,
                                  "ways": 0, "paved": True, "power": "none", "names": defaultdict(int),
                                  "ramp_only": True, "maxspeed": 0, "src": c, "route": route,
                                  "colour": at.get("colour", ""), "opening": at.get("opening", 0),
                                  "pts": pts if a == key[1] else pts[::-1], "pieces": []}
            e["pieces"].append(pts)
            if CLASS_RANK[cls] > CLASS_RANK[e["cls"]]:
                e["cls"] = cls
            e["ways"] += 1
            if at.get("name"):
                e["names"][at["name"]] += 1
            if mode == "road":
                if not at["ramp"]:
                    e["ramp_only"] = False
                if at["oneway"]:
                    e["lanes1"] += at["lanes"] or 2
                else:
                    e["lanes2"] = max(e["lanes2"], at["lanes"] or 0)
                e["paved"] = e["paved"] and at["paved"]
            else:
                e["ramp_only"] = False
                e["tracks"] = max(e["tracks"], at["tracks"] or 0)
                if at["power"] != "none":
                    e["power"] = at["power"]
                e["maxspeed"] = max(e["maxspeed"], at["maxspeed"] or 0)
    log("cell edges", len(edges))

    zone_country = _cell_country_lookup(zones, cellpts)
    # 중국·러시아 쪽 도로·철도는 뺀다 (양 끝이 모두 외국 영토 안인 엣지).
    # 존 밖이라는 기준을 쓰면 어느 행정구역에도 속하지 않는 비무장지대 구간(경의선·동해선)까지 잘린다.
    inside = _korea_lookup(zones, cellpts)
    edges = {k: e for k, e in edges.items() if inside(k[1]) or inside(k[2])}
    log("cell edges inside zones", len(edges))
    edges = merge_dual_carriageways(edges, modepts, junction)
    edges = merge_parallel_rail(edges, modepts, junction)
    edges = merge_parallel_metro(edges, modepts, junction)

    # 역·IC는 단순화 시 보존해야 하므로 먼저 셀에 붙인다.
    rail_cells = {k[1] for k in edges if k[0] == "rail"} | {k[2] for k in edges if k[0] == "rail"}
    road_cells = {k[1] for k in edges if k[0] == "road"} | {k[2] for k in edges if k[0] == "road"}
    keep = set()
    metro_cells = {k[1] for k in edges if k[0] == "metro"} | {k[2] for k in edges if k[0] == "metro"}
    rail_cls = defaultdict(set)
    rail_names = defaultdict(set)    # 칸 → 지나는 철도 노선 이름 (비교용으로 다듬은 이름)
    for k, e in edges.items():
        if k[0] == "rail":
            rail_cls[k[1]].add(e["cls"]); rail_cls[k[2]].add(e["cls"])
            for nm in e["names"]:
                rail_names[k[1]].add(railref.norm_line(nm)); rail_names[k[2]].add(railref.norm_line(nm))
    ref = railref.load(RAW)
    ref_lines = _ref_station_lines(ref)
    canon = _ref_canon(ref)
    # 철도역: 선로 웨이에 찍힌 역은 그 칸에 바로 붙이고, 선로 옆에 따로 찍힌 역만 가까운 선로에 붙인다
    # (예전처럼 1km 안 아무 선로에 붙이면 범일·석수가 고속선 역이 된다)
    on_track = {}
    for h in handlers.values():
        on_track.update(h.on_track)
    # 칸마다 지나는 철도 노선(원래 이름). 나란히 달리는 다른 노선이 한 칸에 들어도 노드는 노선마다 따로 둔다
    lines_at = defaultdict(set)
    for k, e in edges.items():
        if k[0] == "rail":
            ln = k[3].split("@")[0]
            lines_at[k[1]].add(ln); lines_at[k[2]].add(ln)
    stations, station_pt, station_lines, station_allowed = [], {}, defaultdict(set), []
    for st in [s for h in handlers.values() for s in h.stations]:
        hit = on_track.get(st)
        # 역 이름은 철도 DB 이름으로 맞춘다 ('SR수서'→'수서', 'KTX광명'→'광명', '지하서울'→'서울'). '동탄인덕원102' 같은 가칭은 뺀다
        nm = canon(st[0], st[1], st[2])
        if nm is None:
            continue
        st = (nm, st[1], st[2])
        # 철도 DB가 이 역이 서는 노선을 알면 그 노선 선로에만 붙인다 (OSM 역이 다른 노선 선로 위에 찍혔어도)
        allowed = ref_lines(st[0], st[1], st[2])
        if hit and hit[0] in rail_cells and (not allowed or rail_names[hit[0]] & allowed):
            c = hit[0]
        else:
            # DB가 아는 역은 그 노선 선로에만 (없으면 도시철도역일 뿐이므로 철도역으로 두지 않는다: 경복궁·광화문 밑을 지나는 GTX)
            c = _snap_rail(st[1], st[2], rail_cls, rail_names=rail_names, allowed=allowed, strict=bool(allowed))
            if c is None and hit and hit[0] in rail_cells and not allowed:
                c = hit[0]
        if c is None:
            continue
        stations.append((st[0], c))
        if hit and hit[0] == c:
            station_pt[c] = (st[1], st[2])
        station_lines[c] |= _station_lines(lines_at[c], allowed, hit[1] if hit and hit[0] == c else None, rail_cls)
        station_allowed.append((st[0], c, allowed))
    added = _ref_missing_stations(ref, stations, cellpts, rail_cls, rail_names)
    for name, c, lines in added:
        station_lines[c] |= _station_lines(lines_at[c], lines, None, rail_cls)
        station_allowed.append((name, c, lines))
    stations += [(n, c) for n, c, _ in added]
    # 한 역의 다른 노선 승강장이 이웃 칸에 있으면(오송: 충북선·경부고속선) 그 노선에도 같은 이름의 역을 둔다 (약 500m 안)
    extra = []
    for name, c, allowed in station_allowed:
        if not allowed:
            continue
        have = {railref.norm_line(ln) for ln in station_lines[c]}
        for want in allowed - have:
            best, bd = None, 99
            for dx in range(-5, 6):
                for dy in range(-5, 6):
                    c2 = (c[0] + dx, c[1] + dy)
                    if c2 != c and any(railref.norm_line(ln) == want for ln in lines_at.get(c2, ())) and dx * dx + dy * dy < bd:
                        best, bd = c2, dx * dx + dy * dy
            if best is not None:
                station_lines[best] |= {ln for ln in lines_at[best] if railref.norm_line(ln) == want}
                extra.append((name, best, c))
    stations += [(n, c2) for n, c2, _ in extra]
    log("stations attached to other lines nearby", len(extra))
    stations = merge_station_names(stations, {s[0] for s in ref["stations"]} if ref else set())
    junctions = dedupe_junctions(_snap_points([j for h in handlers.values() for j in h.junctions], road_cells, 1), edges)
    metro_stations = _snap_points([s for h in handlers.values() for s in h.metro_stations], metro_cells, 1)
    rail_station_cells = {c for _, c in stations}
    # 도시철도로 태그됐지만 일반철도 선로 위에만 있는 역(서해선·경의중앙선·경강선 등)은 일반철도 역으로도 쓴다.
    # 도시철도 선로 위의 역(시청·경복궁 등)은 그 밑을 지나는 대심도 철도(GTX)의 역으로 잡히지 않게 뺀다.
    # 철도 DB가 그 칸을 지나는 일반철도 노선에 서는 역이라고 하면(서울역: 경부선) 도시철도 선로가 함께 지나도 철도역으로 둔다.
    shared = []
    for s0 in [s for h in handlers.values() for s in h.metro_stations]:
        nm = canon(s0[0], s0[1], s0[2])
        if nm is None:
            continue
        for _, c in _snap_points([(nm, s0[1], s0[2])], rail_cells, 0):
            if c in rail_station_cells:
                continue
            known = ref_lines(nm, s0[1], s0[2])
            on_rail = {ln for ln in lines_at[c] if railref.norm_line(ln) in known}
            if on_rail or (not known and c not in metro_cells):
                shared.append((nm, c))
                station_lines[c] |= on_rail or lines_at[c]
                rail_station_cells.add(c)
    stations += shared
    log("metro-tagged stations on main-line tracks", len(shared))
    # 단순화 때 남길 칸은 수단마다 따로: 도로 접근점·IC가 철도를 끊거나 역이 도로를 끊지 않게
    # 도시철도도 노선마다 노드를 따로: 같은 칸을 지나는 다른 노선끼리 서로 끊지 않게 (역에서만 환승으로 묶는다)
    mlines_at = defaultdict(set)
    for k in edges:
        if k[0] == "metro":
            ln = k[3].split("@")[0]
            mlines_at[k[1]].add(ln); mlines_at[k[2]].add(ln)
    keep |= {("rail", c, ln) for _, c in stations for ln in station_lines[c]} | {("road", c) for _, c in junctions}         | {("metro", c, ln) for _, c in metro_stations for ln in mlines_at[c]}

    # 철도 노드 묶음: (칸, 노선)마다 따로 두고, 실제로 이어진 곳만 하나로 묶는다
    # - 이름이 다른 선로 웨이가 같은 OSM 노드를 쓰는 곳 (분기·합류)
    # - 철도 DB에서 두 노선에 함께 서는 역 (환승)
    rail_group = {}

    def rfind(k):
        while rail_group.get(k, k) != k:
            rail_group[k] = rail_group.get(rail_group[k], rail_group[k])
            k = rail_group[k]
        return k

    def runion(c, names):
        names = [n for n in names if n in lines_at[c]]
        for n in names[1:]:
            a, b = rfind((c, names[0])), rfind((c, n))
            if a != b:
                rail_group[a] = b
    for h in handlers.values():
        for c, names in h.rail_ref.values():
            if len(names) > 1:
                runion(c, sorted(names))
        h.rail_ref = None
    for c, lines in station_lines.items():
        runion(c, sorted(lines))
    metro_group = {}

    def mfind(k):
        while metro_group.get(k, k) != k:
            metro_group[k] = metro_group.get(metro_group[k], metro_group[k])
            k = metro_group[k]
        return k

    def munion(c, names):
        names = sorted(n for n in names if n in mlines_at[c])
        for n in names[1:]:
            a, b = mfind((c, names[0])), mfind((c, n))
            if a != b:
                metro_group[a] = b
    for h in handlers.values():
        for c, names in h.metro_ref.values():
            if len(names) > 1:
                munion(c, names)
        h.metro_ref = None
    for _, c in metro_stations:
        munion(c, mlines_at[c])

    # 존 접근 셀: 인구중심에서 가장 가까운 도로 셀(간선 우선)과 철도 셀
    road_major = {k[1] for k, e in edges.items() if k[0] == "road" and e["cls"] != "secondary"} | \
                 {k[2] for k, e in edges.items() if k[0] == "road" and e["cls"] != "secondary"}
    for z in zones:
        z["road_cell"] = _nearest_cell((z["cx"], z["cy"]), road_major)
        keep.add(("road", z["road_cell"]))

    links = _contract(edges, keep)
    log("contracted links", len(links))

    # 노드 인덱스 부여
    node_index = {}
    nodes = []

    # 도로·철도·도시철도 노드는 같은 격자라도 따로 두고, 자리도 그 수단의 점들로만 정한다
    # (섞으면 철도가 도로 교차점 쪽으로 꺾여 그려지고, 역에서만 타고 내리는 규칙도 깨진다)
    def nid(cell, mode, line=""):
        g = MODE_KEY[mode]
        key = cell if g == "d" else ("r", cell, rfind((cell, line))) if g == "r" else ("m", cell, mfind((cell, line)))
        if key not in node_index:
            node_index[key] = len(nodes)
            # 자리: 실제 교차점 > 선로 위 역 > 그 칸에서 만난 실제 선 위의 점 (칸 평균점은 선 밖이라 노선이 쥐젖처럼 튀어나온다)
            j = junction.get((g, cell))
            pt = (j[1], j[2]) if j is not None else (station_pt.get(cell) if g == "r" else None) or modefirst.get((g, cell))
            if pt is None:
                cp = cellpts[cell]
                pt = (cp[0] / cp[2], cp[1] / cp[2])
            nodes.append([round(pt[0], 5), round(pt[1], 5)])
        return node_index[key]

    out_links = []
    for L in links:
        e = L["attrs"]
        country = zone_country(L["cells"][len(L["cells"]) // 2]) or zone_country(L["cells"][0])             or zone_country(L["cells"][-1]) or "KR"
        metro = e["mode"] == "metro"
        a, b = nid(L["cells"][0], e["mode"], L["line_key"]), nid(L["cells"][-1], e["mode"], L["line_key"])
        # 화면용 도형: 실제 웨이를 약 20m로 단순화하고 양 끝은 노드 좌표에 맞춘다
        raw = [c for xy in L["line"] for c in xy]
        length = _polyline_km(raw)
        geom = line_geom(L["line"], nodes[a], nodes[b])
        name = max(e["names"], key=e["names"].get) if e["names"] else ""
        if e["mode"] == "road":
            dl, skr, skp = ROAD_DEFAULTS[e["cls"]]
            lanes = max(e["lanes2"], e["lanes1"]) or dl
            lanes = max(2, min(lanes, 10))
            speed = skr if country == "KR" else skp
            if not e["paved"]:
                speed *= 0.6
            out_links.append({"mode": 0, "cls": e["cls"], "a": a, "b": b, "len": round(length, 2),
                              "lanes": lanes, "speed": round(speed), "paved": int(e["paved"]),
                              "name": name, "kp": int(country == "KP"), "geom": geom, "open": e.get("opening", 0)})
        elif metro:
            out_links.append({"mode": 2, "cls": "metro", "a": a, "b": b, "len": round(length, 2),
                              "tracks": 2, "speed": 35, "power": "AC",
                              "name": (e.get("route") or "").split("@")[0] or name, "colour": e.get("colour", ""),
                              "kp": int(country == "KP"), "geom": geom, "open": e.get("opening", 0)})
        else:
            if e["cls"] == "hsr":
                speed = 230
            elif country == "KR":
                # OSM 최고속도가 있으면 표정속도로 그 80%를 쓴다 (정차·감속 감안), 최대 시속 200km
                base_speed = 100 if e["power"] != "none" else 80
                speed = min(200, max(base_speed, round(e["maxspeed"] * 0.8))) if e["maxspeed"] else base_speed
            else:
                speed = 40
            tracks = e["tracks"] or (2 if country == "KR" else 1)
            if e["ways"] >= 2 and tracks < 2:
                tracks = 2
            out_links.append({"mode": 1, "cls": e["cls"], "a": a, "b": b, "len": round(length, 2),
                              "tracks": min(tracks, 4), "speed": speed, "power": e["power"],
                              "name": name, "kp": int(country == "KP"), "geom": geom, "open": e.get("opening", 0)})

    out_links = drop_parallel_duplicates(out_links)
    heal_gaps(nodes, out_links)
    # 이웃 칸에 둔 다른 노선 승강장과 본래 역 노드를 짧은 환승 선로로 잇는다 (오송: 충북선 ↔ 경부고속선)
    def station_node(c):
        for ln in sorted(station_lines[c]):
            k = ("r", c, rfind((c, ln)))
            if k in node_index:
                return node_index[k]
    xfer = 0
    for name, c2, c in extra:
        a, b = station_node(c), station_node(c2)
        if a is None or b is None or a == b:
            continue
        d = math.hypot((nodes[a][0] - nodes[b][0]) * 88.0, (nodes[a][1] - nodes[b][1]) * 111.0)
        out_links.append({"mode": 1, "cls": "conv", "a": a, "b": b, "len": round(max(d, 0.1), 2), "tracks": 2, "speed": 30,
                          "power": "AC", "name": f"{name} 환승", "kp": 0, "geom": nodes[a] + nodes[b], "open": 0})
        xfer += 1
    log("station transfer links", xfer)
    name_unnamed_rail(out_links, railref.load(RAW))

    out_stations = []
    for n, c in stations:
        for ln in sorted(station_lines[c]):
            k = ("r", c, rfind((c, ln)))
            if k in node_index:
                out_stations.append((n, node_index[k]))
    out_stations = _dedupe_named(out_stations)
    out_junctions = _dedupe_named([(n, node_index[c]) for n, c in junctions if c in node_index])
    out_metro = []
    for n, c in metro_stations:
        for ln in sorted(mlines_at[c]):
            k = ("m", c, mfind((c, ln)))
            if k in node_index:
                out_metro.append((n, node_index[k]))
    out_metro = _dedupe_named(out_metro)
    log("metro links", sum(1 for l in out_links if l["mode"] == 2), "metro stations", len(out_metro))

    for z in zones:
        z["road_node"] = node_index[z["road_cell"]]

    places = []
    seen = set()
    for h in handlers.values():
        for p in h.places:
            k = (p[0], round(p[2], 2), round(p[3], 2))
            if k not in seen:
                seen.add(k)
                places.append(p)
    return {"nodes": nodes, "links": out_links, "stations": out_stations,
            "metro_stations": out_metro, "junctions": out_junctions}, places


def line_geom(line, pa, pb, tol=0.00006):
    """화면용 도형: 링크가 지나는 OSM 웨이 점들을 링크 방향(노드 a → b)대로 이은 한 줄에 양 끝 노드를 붙인다.
    이웃 구간도 같은 노드에서 시작·끝나므로 선이 끊기지 않고, 왕복 분리 도로도 한 줄만 그린다."""
    pts = list(shapely.LineString(line).simplify(tol).coords) if len(line) >= 2 else []
    # 노드에서 너무 가까운 첫·끝 점은 빼서 노드 근처에서 되돌아 꺾이지 않게 한다 (약 30m)
    near = lambda p, q: abs(p[0] - q[0]) * 0.8 + abs(p[1] - q[1]) < 0.0003
    while pts and near(pts[0], pa):
        pts.pop(0)
    while pts and near(pts[-1], pb):
        pts.pop()
    # 노드가 선에서 조금 비켜 있으면(왕복 차도를 합친 칸 등) 선이 노드까지 갔다 되돌아오며 쥐젖처럼 튀어나온다.
    # 노드 → 첫 점 → 둘째 점이 120°보다 날카롭게 꺾이면 첫 점을 뺀다 (끝도 같은 방법)
    def sharp(a, b, c):
        v1 = (a[0] - b[0], a[1] - b[1]); v2 = (c[0] - b[0], c[1] - b[1])
        n = math.hypot(*v1) * math.hypot(*v2)
        return n > 0 and (v1[0] * v2[0] + v1[1] * v2[1]) / n > -0.5
    while len(pts) >= 2 and sharp(pa, pts[0], pts[1]):
        pts.pop(0)
    while len(pts) >= 2 and sharp(pb, pts[-1], pts[-2]):
        pts.pop()
    if len(pts) == 1 and sharp(pa, pts[0], pb):
        pts = []
    out = [tuple(pa)] + pts + [tuple(pb)]
    return [round(v, 5) for xy in out for v in xy]


def draw_geom(pieces, tol=0.00015):
    """화면용 도형: 링크를 이룬 OSM 웨이 조각을 이어 붙여 단순화한다 (꺾임·틈 없이 실제 모양 그대로).
    조각 사이에는 [nan, nan]을 넣어 여러 선으로 나눈다."""
    merged = shapely.line_merge(shapely.MultiLineString([pc for pc in pieces if len(pc) >= 2]))
    lines = getattr(merged, "geoms", [merged])
    out = []
    for ln in lines:
        if ln.is_empty:
            continue
        if out:
            out += [float("nan"), float("nan")]
        out += [round(v, 5) for xy in ln.simplify(tol).coords for v in xy]
    return out


def drop_parallel_duplicates(links):
    """같은 노선이 같은 두 노드 사이에 두 번 놓이면(상·하행 선로를 따로 그린 OSM) 하나만 남긴다.
    둘 다 두면 노선이 두 줄로 그려지고, 배정은 한쪽만 써서 다른 쪽은 늘 이용객 0이 된다."""
    best = {}
    for i, l in enumerate(links):
        if l["mode"] == 0 or l["a"] == l["b"]:
            continue
        k = (l["mode"], l["name"], min(l["a"], l["b"]), max(l["a"], l["b"]), l.get("open", 0))
        j = best.get(k)
        if j is None or l["len"] < links[j]["len"]:
            best[k] = i
    keep = set(best.values())
    out = [l for i, l in enumerate(links) if l["mode"] == 0 or l["a"] == l["b"] or i in keep]
    log("parallel duplicate links dropped", len(links) - len(out))
    return out


def name_unnamed_rail(links, ref=None):
    """이름 없는 철도 구간(북측 OSM에 흔하다)에 노선 이름을 붙인다.
    1) 철도 DB의 선로가 구간 가운데 점에서 300m 안을 지나면 그 노선 이름
    2) 아직 없으면 한쪽 끝에서 이어지는 노선이 하나뿐일 때 그 노선 이름 (두 노선 사이에 끼었으면 모르는 채로 둔다)"""
    if ref:
        from scipy.spatial import cKDTree
        pts, names = [], []
        for nm, _, line in ref["paths"]:
            for i, p in enumerate(line):
                pts.append([p[0] * 0.8, p[1]]); names.append(nm)
                if i:   # 꼭짓점 사이가 멀면 가운데 점도 넣는다
                    q = line[i - 1]
                    pts.append([(p[0] + q[0]) * 0.4, (p[1] + q[1]) / 2]); names.append(nm)
        tree = cKDTree(np.array(pts))
        got = 0
        for l in links:
            if l["mode"] != 1 or l["name"]:
                continue
            g = l["geom"]
            k = (len(g) // 4) * 2
            d, i = tree.query([g[k] * 0.8, g[k + 1]])
            if d < 0.003:
                l["name"] = names[i]
                got += 1
        log("named rail links from railway DB", got)
    at = defaultdict(list)
    for i, l in enumerate(links):
        if l["mode"] == 1:
            at[l["a"]].append(i); at[l["b"]].append(i)
    changed, total = True, 0
    while changed:
        changed = False
        for i, l in enumerate(links):
            if l["mode"] != 1 or l["name"]:
                continue
            near = {links[j]["name"] for n in (l["a"], l["b"]) for j in at[n] if j != i and links[j]["name"]}
            if len(near) == 1:
                l["name"] = near.pop()
                changed = True
                total += 1
    log("named unnamed rail links", total, "still unnamed", sum(1 for l in links if l["mode"] == 1 and not l["name"]))


def heal_gaps(nodes, links, max_km=0.6):
    """막다른 도로 끝이 600m 안의 다른 도로 노드와 이어지지 않았으면 짧은 연결 링크를 놓는다.
    (OSM에서 등급이 낮은 연결 도로를 뺐거나 격자 맞춤으로 생긴 틈)"""
    from scipy.spatial import cKDTree
    deg = defaultdict(int)
    nb = defaultdict(set)
    cls_at = {}
    for l in links:
        if l["mode"] != 0 or l.get("open"):
            continue
        for x, y in ((l["a"], l["b"]), (l["b"], l["a"])):
            deg[x] += 1
            nb[x].add(y)
            cls_at.setdefault(x, l)
    ids = sorted(deg)
    pts = np.array([nodes[i] for i in ids]) * [88.0, 111.0]
    tree = cKDTree(pts)
    added = 0
    for k, n in enumerate(ids):
        if deg[n] != 1:
            continue
        for d, j in zip(*tree.query(pts[k], k=4)):
            m = ids[j]
            if m == n or m in nb[n] or d > max_km:
                continue
            src = cls_at[n]
            x1, y1 = nodes[n]; x2, y2 = nodes[m]
            links.append({"mode": 0, "cls": src["cls"], "a": n, "b": m, "len": round(d * 1.2 + 0.05, 2),
                          "lanes": src["lanes"], "speed": min(src["speed"], 40), "paved": 1,
                          "name": src["name"], "kp": src["kp"], "geom": [x1, y1, x2, y2], "open": 0})
            nb[n].add(m); nb[m].add(n)
            added += 1
            break
    log("healed road gaps", added)


def _dedupe_named(items):
    seen = set()
    out = []
    for name, node in items:
        if (name, node) in seen:
            continue
        seen.add((name, node))
        out.append([name, node])
    return out


def _korea_lookup(zones, cellpts):
    """셀이 남북 영토(해안선으로 다듬은 존 경계) 안인지.
    Natural Earth 국경은 거칠어서 압록강·두만강 건너 중국 쪽 도로가 남는 문제가 있었다.
    압록강·두만강 쪽은 50m만 봐 준다 (단둥 강변 도로가 따라 들어오지 않도록).
    어느 행정구역에도 속하지 않는 비무장지대(경의선·동해선)만 500m까지 넉넉히 본다."""
    union = unary_union([z["geom"] for z in zones])
    tight = union.buffer(0.0005)
    loose = union.buffer(0.005)
    shapely.prepare(tight)
    shapely.prepare(loose)
    cache = {}

    def f(cell):
        if cell not in cache:
            cp = cellpts[cell]
            pt = shapely.Point(cp[0] / cp[2], cp[1] / cp[2])
            cache[cell] = tight.contains(pt) or (pt.y < 38.8 and loose.contains(pt))
        return cache[cell]
    return f


def _foreign_lookup(cellpts):
    """셀이 중국·러시아·일본 영토 안(국경에서 300m 이상 안쪽)인지"""
    import geopandas as gpd
    ne = gpd.read_file(f"zip://{(RAW / 'ne_10m_admin_0_countries.zip').as_posix()}")
    geom = unary_union(list(ne[ne["ADM0_A3"].isin(["CHN", "RUS", "JPN"])].geometry)).buffer(-0.003)
    shapely.prepare(geom)
    cache = {}

    def f(cell):
        if cell not in cache:
            cp = cellpts[cell]
            cache[cell] = geom.contains(shapely.Point(cp[0] / cp[2], cp[1] / cp[2]))
        return cache[cell]
    return f


def _cell_country_lookup(zones, cellpts):
    tree = shapely.STRtree([z["geom"] for z in zones])
    countries = [z["country"] for z in zones]
    cache = {}

    def f(cell):
        if cell in cache:
            return cache[cell]
        cp = cellpts[cell]
        pt = shapely.Point(cp[0] / cp[2], cp[1] / cp[2])
        hit = tree.query(pt, predicate="intersects")
        if len(hit):
            r = countries[hit[0]]
        else:
            # 해안선·비무장지대처럼 존 밖이지만 가까운 곳은 가장 가까운 존의 국가로 본다
            near = tree.query(pt, predicate="dwithin", distance=0.1)
            r = countries[tree.nearest(pt)] if len(near) else None
        cache[cell] = r
        return r
    return f


def _snap_points(points, cells, radius):
    """radius: 바깥 격자(500m) 칸 수. 칸 번호가 0.001도 단위라 그만큼 넓혀 찾는다"""
    out = []
    r = radius * COARSE
    for name, lon, lat in points:
        cx, cy = cell_of(lon, lat)
        best, bd = None, 1e9
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                c = (cx + dx, cy + dy)
                if c in cells:
                    d = dx * dx + dy * dy
                    if d < bd:
                        best, bd = c, d
        if best is not None:
            out.append((name, best))
    return out


def _snap_rail(lon, lat, rail_cls, radius=5, rail_names=None, allowed=None, strict=False):
    """선로 옆에 찍힌 역을 약 500m 안 가장 가까운 선로 칸에 붙인다. 고속선은 3배 멀게 쳐서 일반선이 있으면 일반선에 붙인다.
    allowed(철도 DB가 아는 이 역의 노선)가 있으면 그 노선 칸을 먼저 고르고(약 1km까지), strict면 그 노선 칸만 고른다."""
    if allowed:
        radius = max(radius, 10)
    cx, cy = cell_of(lon, lat)
    best, bd = None, 1e9
    for dx in range(-radius, radius + 1):
        for dy in range(-radius, radius + 1):
            c = (cx + dx, cy + dy)
            cls = rail_cls.get(c)
            if not cls:
                continue
            d = math.hypot((c[0] * UNIT - lon) * 0.8, c[1] * UNIT - lat)
            if allowed:
                if not (rail_names[c] & allowed):
                    if strict:
                        continue
                    d *= 5
            elif max(abs(dx), abs(dy)) > 5:
                continue
            if "conv" not in cls:
                d *= 3
            if d < bd:
                best, bd = c, d
    return best


def _ref_station_lines(ref):
    """철도 DB에서 이름이 같고 1.5km 안인 역의 노선 집합을 찾는 함수를 돌려준다 (DB가 없으면 늘 빈 집합)"""
    if not ref:
        return lambda name, lon, lat: set()
    from scipy.spatial import cKDTree
    st = ref["stations"]
    tree = cKDTree(np.array([[s[2] * 0.8, s[3]] for s in st]))

    def lines(name, lon, lat):
        n = railref.norm_station(name)
        out = set()
        for i in tree.query_ball_point([lon * 0.8, lat], 0.015):
            if st[i][0] == n:
                out |= st[i][1]
        return out
    return lines


PLACEHOLDER = re.compile(r"\d{2,}$")
PREFIXES = ("KTX", "SRT", "SR", "지하", "ITX", "지티엑스", "GTX")


def _ref_canon(ref):
    """OSM 역 이름 → 철도 DB 이름. 500m 안 DB 역 이름이 OSM 이름 안에 들어 있으면 그 이름 (가장 긴 것).
    없으면 KTX·SR·지하 같은 앞말만 떼고, 끝이 번호인 가칭(동탄인덕원102)은 None"""
    from scipy.spatial import cKDTree
    st = ref["stations"] if ref else []
    tree = cKDTree(np.array([[s[2] * 0.8, s[3]] for s in st])) if st else None

    def canon(name, lon, lat):
        n = railref.norm_station(name)
        if tree is not None:
            cands = [st[i][0] for i in tree.query_ball_point([lon * 0.8, lat], 0.005) if st[i][0] and st[i][0] in n]
            if cands:
                return max(cands, key=len)
        for p in PREFIXES:
            if n.startswith(p) and len(n) > len(p) + 1:
                n = n[len(p):]
                break
        if n.endswith("역동편") or n.endswith("역서편"):
            n = n[:-3]
        return None if PLACEHOLDER.search(n) else n
    return canon


def _ref_missing_stations(ref, stations, cellpts, rail_cls, rail_names):
    """철도 DB에 있는데 OSM에 없는 역(주로 북측)을 그 노선 선로 칸에 더한다. 같은 이름 역이 1.5km 안에 있으면 건너뛴다."""
    if not ref:
        return []
    have = defaultdict(list)
    for n, c in stations:
        have[railref.norm_station(n)].append(c)
    out = []
    for name, lines, lon, lat, status in ref["stations"]:
        if not name or name.isdigit():
            continue
        c0 = cell_of(lon, lat)
        if any(abs(c[0] - c0[0]) <= 15 and abs(c[1] - c0[1]) <= 15 for c in have.get(name, [])):
            continue
        c = _snap_rail(lon, lat, rail_cls, rail_names=rail_names, allowed=lines, strict=True)
        if c is None:
            continue
        out.append((name, c, lines))
        have[name].append(c)
    log("stations added from railway DB", len(out), f"({ref['file']})")
    return out


def _station_lines(present, allowed, on_track_line, rail_cls):
    """역이 서는 노선 (그 칸을 지나는 노선 가운데): 철도 DB가 아는 노선 > 역이 찍힌 선로의 노선 > 고속선을 뺀 노선"""
    if allowed:
        got = {ln for ln in present if railref.norm_line(ln) in allowed}
        if got:
            return got
    if on_track_line is not None and on_track_line in present:
        return {on_track_line}
    conv = {ln for ln in present if "고속" not in ln}
    return conv or set(present)


def _norm_station(name):
    n = name.split("(")[0].strip()
    return n[:-1] if len(n) > 2 and n.endswith("역") else n


def merge_station_names(stations, db_names=frozenset(), max_cells=4):
    """한 역을 노선마다 다르게 적은 이름을 하나로: '대구'·'대구역', '아산'·'천안아산'(약 400m 안).
    짧은 이름이 긴 이름의 끝과 같고 긴 이름이 철도 DB에 있는 역 이름이면 긴 이름을 쓴다 ('서울'이 '지하서울'이 되지 않게).
    같은 칸에 같은 이름이 둘이면 하나만 남긴다."""
    out = []
    names = [(_norm_station(n), c) for n, c in stations]
    for i, (n, c) in enumerate(names):
        best = n
        for m, d in names:
            if m == best or abs(d[0] - c[0]) > max_cells or abs(d[1] - c[1]) > max_cells:
                continue
            if len(m) > len(best) and m.endswith(best) and m in db_names:
                best = m
        out.append((best, c))
    return list(dict.fromkeys(out))


def dedupe_junctions(junctions, edges, max_cells=30):
    """OSM은 IC·분기점의 램프 갈림점마다 같은 이름을 붙인다: 같은 이름이 약 3km 안에 여럿이면 도로가 가장 많이 모이는 칸 하나만 남긴다"""
    deg = defaultdict(int)
    for k in edges:
        if k[0] == "road":
            deg[k[1]] += 1; deg[k[2]] += 1
    groups = defaultdict(list)
    for name, c in junctions:
        for g in groups[name]:
            if abs(g[0][0] - c[0]) <= max_cells and abs(g[0][1] - c[1]) <= max_cells:
                g.append(c)
                break
        else:
            groups[name].append([c])
    out = []
    for name, gs in groups.items():
        for g in gs:
            out.append((name, max(g, key=lambda c: deg[c])))
    log("junctions", len(junctions), "→", len(out), "after merging same-name ramps")
    return out


def _nearest_cell(pt, cells):
    cells = list(cells)
    from scipy.spatial import cKDTree
    tree = cKDTree(np.array(cells, dtype=float))
    _, i = tree.query(np.array(cell_of(*pt), dtype=float))
    return cells[i]


def _same_kind(e1, e2):
    return e1["mode"] == e2["mode"] and e1["cls"] == e2["cls"] and e1.get("route", "") == e2.get("route", "")


DUAL_MERGE_DEG = 0.0009   # 약 80~100m: 왕복 분리 도로의 두 차도 사이
RAIL_MERGE_DEG = 0.0008   # 약 80m: 같은 이름 철도의 나란한 선로(쌍굴·따로 그린 복선)


MODE_KEY = {"road": "d", "rail": "r", "metro": "m"}


def merge_dual_carriageways(edges, modepts, junction):
    """대도시 안에서 한 도로의 두 방향 차도가 따로 그려져 다른 칸에 놓인 것을 합친다.
    같은 이름(이름 없으면 같은 등급)의 일방통행 도로가 지나는 칸끼리 약 90m 안이면 한 칸으로 묶고,
    겹치는 엣지는 하나로 합쳐 차로 수를 더한다. 그러지 않으면 배정이 한쪽 차도에만 몰려 색이 들쭉날쭉해진다."""
    def label(e):
        if e["lanes1"] <= 0:
            return None
        return max(e["names"], key=e["names"].get) if e["names"] else f"#{e['cls']}"
    return _merge_parallel(edges, modepts, junction, "road", label, DUAL_MERGE_DEG, city_only=True)


def merge_parallel_rail(edges, modepts, junction):
    """같은 이름의 철도가 상·하행 선로(GTX 같은 대심도 쌍굴, 따로 그린 복선)로 나뉘어 이웃 칸에 놓이면 한 줄로 합친다.
    합치지 않으면 노선이 두 줄로 그려지고 이용객도 두 선로에 나뉜다."""
    def label(e):
        return max(e["names"], key=e["names"].get) if e["names"] else None
    return _merge_parallel(edges, modepts, junction, "rail", label, RAIL_MERGE_DEG, city_only=False)


def merge_parallel_metro(edges, modepts, junction):
    """도시철도도 상·하행 선로가 따로 그려져 이웃 칸에 놓이면 한 줄로 (같은 노선끼리만)"""
    def label(e):
        return e.get("route", "").split("@")[0] or None
    return _merge_parallel(edges, modepts, junction, "metro", label, RAIL_MERGE_DEG, city_only=False)


def _merge_parallel(edges, modepts, junction, mode_name, label_of, max_deg, city_only):
    from scipy.spatial import cKDTree
    g = MODE_KEY[mode_name]
    tags = defaultdict(set)      # 칸 → 지나는 (이름 또는 등급)
    for (mode, a, b, _), e in edges.items():
        if mode != mode_name:
            continue
        lb = label_of(e)
        if lb is None:
            continue
        for c in (a, b):
            cp = modepts[(g, c)]
            if not city_only or in_city(cp[0] / cp[2], cp[1] / cp[2]):
                tags[c].add(lb)
    cells = list(tags)
    if not cells:
        return edges
    pts = np.array([[modepts[(g, c)][0] / modepts[(g, c)][2] * 0.8, modepts[(g, c)][1] / modepts[(g, c)][2]] for c in cells])
    parent = list(range(len(cells)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, j in cKDTree(pts).query_pairs(max_deg):
        if tags[cells[i]] & tags[cells[j]]:
            parent[find(i)] = find(j)
    rep = {}
    for i, c in enumerate(cells):
        r = cells[find(i)]
        if r != c:
            rep[c] = r
    if not rep:
        return edges
    # 칸 대표점·교차점을 대표 칸으로 모은다 (이 수단의 점만)
    for c, r in rep.items():
        cp, rp = modepts[(g, c)], modepts[(g, r)]
        rp[0] += cp[0]; rp[1] += cp[1]; rp[2] += cp[2]
        jc, jr = junction.get((g, c)), junction.get((g, r))
        if jc is not None and (jr is None or jc[0] > jr[0]):
            junction[(g, r)] = jc
    out = {}
    merged = 0
    for (mode, a, b, route), e in edges.items():
        if mode == mode_name:
            a, b = rep.get(a, a), rep.get(b, b)
            if a == b:
                continue
        key = (mode, min(a, b), max(a, b), route)
        cur = out.get(key)
        if cur is None:
            out[key] = e
            continue
        # 나란한 차도·선로: 차로를 더하고 도형·이름을 합친다
        merged += 1
        cur["lanes1"] += e["lanes1"]
        cur["lanes2"] = max(cur["lanes2"], e["lanes2"])
        cur["tracks"] = max(cur["tracks"], e["tracks"])
        cur["pieces"].extend(e["pieces"])
        for n, v in e["names"].items():
            cur["names"][n] += v
        if CLASS_RANK[e["cls"]] > CLASS_RANK[cur["cls"]]:
            cur["cls"] = e["cls"]
        cur["ramp_only"] = cur["ramp_only"] and e["ramp_only"]
    log(mode_name, "parallel ways merged", len(rep), "cells,", merged, "edges")
    return out


def _contract(edges, keep):
    """차수 2인 셀을 없애 같은 종류(같은 노선)의 연속 엣지를 하나의 링크로 합친다.
    링크마다 지나는 셀(chain)과 엣지 순서(seq: (key, 정방향 여부))를 함께 돌려준다."""
    # 철도는 노선마다 따로 이웃을 센다: 나란한 다른 노선이 같은 칸을 지나도 그 칸에서 끊지 않는다
    def lk(key):
        return key[3].split("@")[0] if key[0] in ("rail", "metro") else ""
    adj = defaultdict(list)
    for key, e in edges.items():
        mode, a, b = key[0], key[1], key[2]
        adj[(mode, a, lk(key))].append((b, key))
        adj[(mode, b, lk(key))].append((a, key))

    def is_through(mode, cell, line):
        if (mode, cell) in keep or (mode, cell, line) in keep:
            return False
        nb = adj[(mode, cell, line)]
        return len(nb) == 2 and _same_kind(edges[nb[0][1]], edges[nb[1][1]])

    used = set()
    links = []
    for key in edges:
        if key in used or not any(k == key for _, k in adj.get((key[0], key[1], lk(key)), [])):
            continue
        mode, line = key[0], lk(key)
        used.add(key)
        chain = [key[1], key[2]]
        seq = [(key, True)]
        for direction in (0, 1):
            while True:
                end = chain[-1] if direction == 0 else chain[0]
                if not is_through(mode, end, line):
                    break
                nxt = [(c, k) for c, k in adj[(mode, end, line)] if k not in used]
                if not nxt:
                    break
                c, k = nxt[0]
                used.add(k)
                if direction == 0:
                    chain.append(c)
                    seq.append((k, k[1] == end))
                else:
                    chain.insert(0, c)
                    seq.insert(0, (k, k[2] == end))
                if c == chain[0 if direction == 0 else -1]:
                    break
        if chain[0] == chain[-1]:
            continue
        keys = [k for k, _ in seq]
        merged = dict(edges[keys[0]])
        names = defaultdict(int)
        for k in keys:
            for n, v in edges[k]["names"].items():
                names[n] += v
        merged["names"] = names
        merged["lanes1"] = int(np.median([edges[k]["lanes1"] for k in keys]))
        merged["lanes2"] = int(np.median([edges[k]["lanes2"] for k in keys]))
        merged["tracks"] = max(edges[k]["tracks"] for k in keys)
        merged["ways"] = int(np.median([edges[k]["ways"] for k in keys]))
        merged["paved"] = sum(edges[k]["paved"] for k in keys) * 2 >= len(keys)
        powers = [edges[k]["power"] for k in keys if edges[k]["power"] != "none"]
        merged["power"] = max(set(powers), key=powers.count) if powers else "none"
        # 실제 도형 이어 붙이기
        geo = []
        for k, fwd in seq:
            pts = edges[k]["pts"] if fwd else edges[k]["pts"][::-1]
            geo.extend(pts if not geo else pts[1:])
        pieces = [pc for k in keys for pc in edges[k]["pieces"]]
        links.append({"cells": chain, "attrs": merged, "line": geo, "pieces": pieces, "line_key": line})
    return links


def _polyline_km(flat):
    d = 0.0
    for i in range(0, len(flat) - 2, 2):
        x1, y1, x2, y2 = flat[i], flat[i + 1], flat[i + 2], flat[i + 3]
        dx = (x2 - x1) * math.cos(math.radians((y1 + y2) / 2))
        d += math.hypot(dx, y2 - y1) * WGS84_KM
    return d


# ---------------------------------------------------------------- 출력


def write_outputs(zones, net, places):
    feats = []
    for i, z in enumerate(zones):
        g = z.get("geom_simple") or z["geom"].simplify(0.003, preserve_topology=True)
        g = shapely.set_precision(g, 0.0005)
        feats.append({
            "type": "Feature", "id": i,
            "properties": {
                "id": i, "name": z["name"], "province": z["province"], "country": z["country"],
                "pop": round(z["pop"]), "area": round(_area_km2(z["geom"]), 1),
                "cx": round(z["cx"], 4), "cy": round(z["cy"], 4), "road_node": z["road_node"],
            },
            "geometry": mapping(g),
        })
    # 존 도형은 파이프라인 안에서만 쓴다 (화면은 data/admin/sgg.geojson을 쓴다)
    (RAW / "zones.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False,
                   separators=(",", ":")), encoding="utf-8")
    sys.path.insert(0, str(Path(__file__).parent))
    import netpack
    netpack.write(net, OUT / "network.bin", OUT / "network.meta.json")
    (OUT / "network.json").unlink(missing_ok=True)
    (OUT / "places.json").write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")),
                                     encoding="utf-8")
    for f in ("network.bin", "network.meta.json", "places.json"):
        log(f, round((OUT / f).stat().st_size / 1e6, 2), "MB")


def _area_km2(g):
    lat = g.centroid.y
    return g.area * WGS84_KM * WGS84_KM * math.cos(math.radians(lat))


def master_zones():
    """build_admin.py가 만든 기준 도형의 존 (남: SGIS 시군구, 북: OSM 시군)"""
    path = RAW / "admin_master.pkl"
    if not path.exists():
        return None
    import pickle
    m = pickle.load(path.open("rb"))
    zones = [{"name": z["name"], "province": z["province"], "country": z["country"],
              "geom": wkb.loads(z["geom"]), "geom_simple": wkb.loads(z["geom_simple"])} for z in m["zones"]]
    log("zones from admin_master", len(zones))
    return zones


def main():
    zones = master_zones() or build_zones()
    add_population(zones)
    log("population done")
    net, places = build_network(zones)
    write_outputs(zones, net, places)


if __name__ == "__main__":
    main()

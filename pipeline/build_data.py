"""공개 데이터로 게임용 존·네트워크·지명 데이터를 만든다.

입력 (data/raw, download.sh 참고)
  - Geofabrik OSM 추출본: south-korea, north-korea (ODbL)
  - WorldPop 2025 (R2025A) 1km constrained UN-adjusted 인구 격자: KOR, PRK (CC BY 4.0)

출력 (data/)
  - zones.geojson   시군구(남) / 시군·구역(북) 존 경계와 인구
  - network.json    단순화한 도로·철도망, 역, IC/JCT, 존 접근 노드
  - places.json     신규 역·IC 이름 자동 생성용 지명

실행: python pipeline/build_data.py
"""

from __future__ import annotations

import json
import math
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

# 네트워크 단순화 격자 크기(도). 약 1km. 왕복 분리 차로·복선 선로를 한 링크로 합친다.
GRID = 0.01

ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary"]
ROAD_LINKS = {"motorway_link": "motorway", "trunk_link": "trunk"}
WGS84_KM = 111.32


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def ko_name(tags) -> str | None:
    return tags.get("name:ko") or tags.get("name")


# ---------------------------------------------------------------- 행정구역


def load_admin(country: str):
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
        if lvl not in ("4", "6") or not name:
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
        if lv in ("4", "6") and ko_name(t) and r.id not in built:
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


def build_zones():
    zones = []
    for c in ("KR", "KP"):
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
    return (round(lon / GRID), round(lat / GRID))


class NetHandler:
    def __init__(self, country, seen_ways):
        self.country = country
        self.seen_ways = seen_ways  # 두 추출본에 겹치는 웨이는 한 번만 센다
        self.segs = []          # (mode, cls, cellA, cellB, attrs)
        self.cellpts = defaultdict(lambda: [0.0, 0.0, 0])
        self.stations = []      # (name, lon, lat)
        self.metro_stations = []  # 도시철도·경전철 역
        self.junctions = []     # (name, lon, lat)
        self.places = []        # (name, kind, lon, lat)

    def run(self, pbf):
        fp = osmium.FileProcessor(str(pbf), osmium.osm.NODE | osmium.osm.WAY)             .with_locations().with_filter(osmium.filter.KeyFilter("highway", "railway", "place"))
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
        is_station = t.get("railway") in ("station", "halt") and ko_name(t)
        if is_station and (t.get("station") in ("subway", "light_rail", "monorail")
                           or t.get("subway") == "yes" or t.get("light_rail") == "yes"):
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
        if hw in ROAD_CLASSES or hw in ROAD_LINKS:
            if hw == "secondary" and self.country == "KR":
                return
            mode, cls = "road", ROAD_LINKS.get(hw, hw)
            oneway = t.get("oneway") in ("yes", "1") or hw == "motorway"
            lanes = _int(t.get("lanes"))
            attrs = {
                "oneway": oneway, "lanes": lanes,
                "paved": t.get("surface") not in ("unpaved", "dirt", "gravel", "ground", "compacted"),
                "name": ko_name(t), "ref": t.get("ref"), "ramp": hw in ROAD_LINKS,
            }
        elif rw == "rail" and t.get("service") is None and t.get("usage") in (None, "main", "branch"):
            mode = "rail"
            hs = t.get("highspeed") == "yes"
            cls = "hsr" if hs else "conv"
            volt = _int(t.get("voltage"))
            elec = t.get("electrified") in ("contact_line", "yes")
            attrs = {
                "tracks": _int(t.get("tracks")), "oneway": False,
                "power": ("AC" if volt and volt >= 15000 else "DC") if elec else "none",
                "name": ko_name(t), "maxspeed": _int(t.get("maxspeed")),
            }
        elif rw in ("subway", "light_rail") and t.get("service") is None:
            mode, cls = "metro", "metro"
            attrs = {"tracks": 2, "oneway": False, "power": "AC", "name": ko_name(t), "maxspeed": None}
        else:
            return
        if w.id in self.seen_ways:
            return
        self.seen_ways.add(w.id)
        try:
            pts = [(nd.lon, nd.lat) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        prev = None
        for lon, lat in pts:
            c = cell_of(lon, lat)
            cp = self.cellpts[c]
            cp[0] += lon; cp[1] += lat; cp[2] += 1
            if prev is not None and c != prev:
                self.segs.append((mode, cls, prev, c, attrs))
            prev = c


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
    handlers = {}
    seen_ways = set()
    for c in ("KR", "KP"):
        h = NetHandler(c, seen_ways)
        h.run(PBF[c])
        log(c, "segments", len(h.segs), "stations", len(h.stations), "places", len(h.places))
        handlers[c] = h

    # 셀 단위 엣지 병합. 국가는 셀 대표점이 속한 존으로 판정한다.
    cellpts = defaultdict(lambda: [0.0, 0.0, 0])
    for h in handlers.values():
        for k, v in h.cellpts.items():
            cp = cellpts[k]; cp[0] += v[0]; cp[1] += v[1]; cp[2] += v[2]
    edges = {}
    for c, h in handlers.items():
        for mode, cls, a, b, at in h.segs:
            key = (mode, min(a, b), max(a, b))
            e = edges.get(key)
            if e is None:
                e = edges[key] = {"mode": mode, "cls": cls, "lanes2": 0, "lanes1": 0, "tracks": 0,
                                  "ways": 0, "paved": True, "power": "none", "names": defaultdict(int),
                                  "ramp_only": True, "maxspeed": 0, "src": c}
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
    # 중국·러시아 쪽 도로·철도는 뺀다 (양 끝이 모두 존 밖인 엣지)
    edges = {k: e for k, e in edges.items() if zone_country(k[1]) or zone_country(k[2])}
    log("cell edges inside zones", len(edges))

    # 역·IC는 단순화 시 보존해야 하므로 먼저 셀에 붙인다.
    rail_cells = {k[1] for k in edges if k[0] == "rail"} | {k[2] for k in edges if k[0] == "rail"}
    road_cells = {k[1] for k in edges if k[0] == "road"} | {k[2] for k in edges if k[0] == "road"}
    keep = set()
    metro_cells = {k[1] for k in edges if k[0] == "metro"} | {k[2] for k in edges if k[0] == "metro"}
    stations = _snap_points([s for h in handlers.values() for s in h.stations], rail_cells, 2)
    junctions = _snap_points([j for h in handlers.values() for j in h.junctions], road_cells, 1)
    metro_stations = _snap_points([s for h in handlers.values() for s in h.metro_stations], metro_cells, 1)
    keep |= {c for _, c in stations} | {c for _, c in junctions} | {c for _, c in metro_stations}

    # 존 접근 셀: 인구중심에서 가장 가까운 도로 셀(간선 우선)과 철도 셀
    road_major = {k[1] for k, e in edges.items() if k[0] == "road" and e["cls"] != "secondary"} | \
                 {k[2] for k, e in edges.items() if k[0] == "road" and e["cls"] != "secondary"}
    for z in zones:
        z["road_cell"] = _nearest_cell((z["cx"], z["cy"]), road_major)
        keep.add(z["road_cell"])

    links = _contract(edges, keep)
    log("contracted links", len(links))

    # 노드 인덱스 부여
    node_index = {}
    nodes = []

    # 도시철도 노드는 같은 격자의 도로·철도 노드와 따로 둔다 (역에서만 타고 내리도록)
    def nid(cell, metro=False):
        key = ("m", cell) if metro else cell
        if key not in node_index:
            cp = cellpts[cell]
            node_index[key] = len(nodes)
            nodes.append([round(cp[0] / cp[2], 4), round(cp[1] / cp[2], 4)])
        return node_index[key]

    out_links = []
    for L in links:
        e = L["attrs"]
        country = zone_country(L["cells"][len(L["cells"]) // 2]) or zone_country(L["cells"][0])             or zone_country(L["cells"][-1]) or "KR"
        metro = e["mode"] == "metro"
        a, b = nid(L["cells"][0], metro), nid(L["cells"][-1], metro)
        geom = []
        for c in L["cells"]:
            cp = cellpts[c]
            geom += [round(cp[0] / cp[2], 4), round(cp[1] / cp[2], 4)]
        length = _polyline_km(geom) * 1.05
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
                              "name": name, "kp": int(country == "KP"), "geom": geom})
        elif metro:
            out_links.append({"mode": 2, "cls": "metro", "a": a, "b": b, "len": round(length, 2),
                              "tracks": 2, "speed": 35, "power": "AC",
                              "name": name, "kp": int(country == "KP"), "geom": geom})
        else:
            if e["cls"] == "hsr":
                speed = 230
            elif country == "KR":
                speed = 100 if e["power"] != "none" else 80
            else:
                speed = 40
            tracks = e["tracks"] or (2 if country == "KR" else 1)
            if e["ways"] >= 2 and tracks < 2:
                tracks = 2
            out_links.append({"mode": 1, "cls": e["cls"], "a": a, "b": b, "len": round(length, 2),
                              "tracks": min(tracks, 4), "speed": speed, "power": e["power"],
                              "name": name, "kp": int(country == "KP"), "geom": geom})

    out_stations = _dedupe_named([(n, node_index[c]) for n, c in stations if c in node_index])
    out_junctions = _dedupe_named([(n, node_index[c]) for n, c in junctions if c in node_index])
    out_metro = _dedupe_named([(n, node_index[("m", c)]) for n, c in metro_stations if ("m", c) in node_index])
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


def _dedupe_named(items):
    seen = set()
    out = []
    for name, node in items:
        if (name, node) in seen:
            continue
        seen.add((name, node))
        out.append([name, node])
    return out


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
            # 해안선 부근 오차는 허용하되 국경 밖은 None
            near = tree.query(pt, predicate="dwithin", distance=0.02)
            r = countries[near[0]] if len(near) else None
        cache[cell] = r
        return r
    return f


def _snap_points(points, cells, radius):
    out = []
    for name, lon, lat in points:
        cx, cy = cell_of(lon, lat)
        best, bd = None, 1e9
        for dx in range(-radius, radius + 1):
            for dy in range(-radius, radius + 1):
                c = (cx + dx, cy + dy)
                if c in cells:
                    d = dx * dx + dy * dy
                    if d < bd:
                        best, bd = c, d
        if best is not None:
            out.append((name, best))
    return out


def _nearest_cell(pt, cells):
    cells = list(cells)
    from scipy.spatial import cKDTree
    tree = cKDTree(np.array(cells, dtype=float))
    _, i = tree.query(np.array(cell_of(*pt), dtype=float))
    return cells[i]


def _same_kind(e1, e2):
    return e1["mode"] == e2["mode"] and e1["cls"] == e2["cls"]


def _contract(edges, keep):
    """차수 2인 셀을 없애 같은 종류의 연속 엣지를 하나의 링크로 합친다."""
    adj = defaultdict(list)
    for key, e in edges.items():
        if e["mode"] == "road" and e["ramp_only"] and e["cls"] not in ("motorway", "trunk"):
            continue
        mode, a, b = key
        adj[(mode, a)].append((b, key))
        adj[(mode, b)].append((a, key))

    def is_through(mode, cell):
        if cell in keep:
            return False
        nb = adj[(mode, cell)]
        return len(nb) == 2 and _same_kind(edges[nb[0][1]], edges[nb[1][1]])

    used = set()
    links = []
    for key, e in edges.items():
        if key in used or (key[0], key[1]) not in adj:
            continue
        if not any(k == key for _, k in adj[(key[0], key[1])]):
            continue
        mode = key[0]
        used.add(key)
        chain = [key[1], key[2]]
        keys = [key]
        for direction in (0, 1):
            while True:
                end = chain[-1] if direction == 0 else chain[0]
                if not is_through(mode, end):
                    break
                nxt = [(c, k) for c, k in adj[(mode, end)] if k not in used]
                if not nxt:
                    break
                c, k = nxt[0]
                used.add(k)
                keys.append(k)
                if direction == 0:
                    chain.append(c)
                else:
                    chain.insert(0, c)
                if c == chain[0 if direction == 0 else -1]:
                    break
        if chain[0] == chain[-1]:
            continue
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
        links.append({"cells": chain, "attrs": merged})
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
        g = z["geom"].simplify(0.003, preserve_topology=True)
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
    (OUT / "zones.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False,
                   separators=(",", ":")), encoding="utf-8")
    (OUT / "network.json").write_text(json.dumps(net, ensure_ascii=False, separators=(",", ":")),
                                      encoding="utf-8")
    (OUT / "places.json").write_text(json.dumps(places, ensure_ascii=False, separators=(",", ":")),
                                     encoding="utf-8")
    for f in ("zones.geojson", "network.json", "places.json"):
        log(f, round((OUT / f).stat().st_size / 1e6, 2), "MB")


def _area_km2(g):
    lat = g.centroid.y
    return g.area * WGS84_KM * WGS84_KM * math.cos(math.radians(lat))


def main():
    zones = build_zones()
    add_population(zones)
    log("population done")
    net, places = build_network(zones)
    write_outputs(zones, net, places)


if __name__ == "__main__":
    main()

"""행정구역 기준 도형을 만든다 (build_data.py보다 먼저 실행).

- 남: 통계청 SGIS 행정동 경계 (vuski/admdongkor 가공본, CC BY 4.0 / 공공누리 제1유형)를 읍면동 단위로 쓰고,
      시군구(일반구는 시로 합침)와 시도는 읍면동을 합쳐 만든다.
- 북: OSM 시·군·구역 경계 안을 인구 격자 묶음 중심의 보로노이로 나눠 읍면동 대신 쓴다.
      이름은 가까운 OSM 동·리 지명을 붙인다.
- 경계는 커버리지 단순화(이웃과 공유하는 경계를 같이 줄임)로 틈 없이 가볍게 만든다.

출력
  - data/raw/admin_master.pkl     원래 정밀도의 단위·존 도형 (build_data, build_grid가 읽는다)
  - data/admin/units.geojson      읍면동(북은 보로노이 구역) 경계, 지도용
  - data/admin/sgg.geojson        시군구 경계, 지도용
  - data/admin/sido.geojson       시도 경계, 지도용

실행: python pipeline/build_admin.py
"""

from __future__ import annotations

import json
import math
import pickle
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import osmium
import rasterio
import rasterio.features
import shapely
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
import build_data  # noqa: E402
from build_grid import weighted_kmeans  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "admin"
ADMDONG = RAW / "HangJeongDong_ver20261001.geojson"
KP_POP = RAW / "prk_pop2025.tif"
KM_PER_DEG = 111.32

KP_POP_PER_UNIT = 20_000   # 북 보로노이 구역 하나가 맡는 대략적인 인구
KP_AREA_PER_UNIT = 250     # 인구가 적은 산간도 이 면적(km²)마다 하나씩
KP_MAX_UNITS = 60
TOL_UNIT = 0.0008          # 단순화 허용오차(도). 약 80m (줌 12 정도까지 충분)
TOL_SGG = 0.002
TOL_SIDO = 0.004

ATTRIBUTION = ("행정동 경계: 통계청 SGIS(공공누리 제1유형) 가공 vuski/admdongkor (CC BY 4.0). "
               "북측 경계·지명: © OpenStreetMap 기여자 (ODbL).")


# 남북으로 갈린 같은 군을 한 존으로 합칠 때 쓴다: {(나라, 도, 군): (나라, 도, 군)}. 지금은 옹진군도 남북을 따로 둔다
MERGE_ZONES = {}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def area_km2(g):
    return g.area * KM_PER_DEG ** 2 * math.cos(math.radians(g.centroid.y))


def zone_name_kr(sggnm):
    """'수원시장안구' → '수원시' (일반구는 시로 합친다)"""
    m = re.match(r"^(.+?시)(.+구)$", sggnm)
    return m.group(1) if m else sggnm


def kr_units():
    fc = json.loads(ADMDONG.read_text(encoding="utf-8"))
    units = []
    for f in fc["features"]:
        p = f["properties"]
        g = shapely.make_valid(shape(f["geometry"]))
        units.append({
            "name": p["adm_nm"].split()[-1], "code": p["adm_cd2"], "country": "KR",
            "province": p["sidonm"], "zone": zone_name_kr(p["sggnm"]), "geom": g,
        })
    log("KR units", len(units))
    return units


def kp_places():
    out = []
    flt = osmium.filter.KeyFilter("place")
    for n in osmium.FileProcessor(str(build_data.PBF["KP"]), osmium.osm.NODE).with_filter(flt):
        t = n.tags
        if t.get("place") in ("town", "village", "suburb", "neighbourhood", "hamlet") and build_data.ko_name(t):
            out.append((build_data.ko_name(t), n.location.lon, n.location.lat))
    return out


def polygonal(g):
    """교차 연산 뒤 섞여 나오는 선·점을 버리고 면만 남긴다"""
    g = shapely.make_valid(g)
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    parts = [x for x in getattr(g, "geoms", []) if x.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(parts) if parts else shapely.Polygon()


def kp_land(zones, places):
    """북측 육지 면. OSM 시·군 경계는 영해까지 포함하므로 해안선(natural=coastline)으로 잘라 낸다.

    시·군 경계와 해안선을 합쳐 면을 나누고, 동·리·마을 지명 점이 들어 있는 면만 육지로 본다
    (해안선은 열린 선이라 바로 면을 만들 수 없다). 무인도는 빠진다.
    """
    area = shapely.make_valid(unary_union([z["geom"] for z in zones]))
    lines = []
    flt = osmium.filter.TagFilter(("natural", "coastline"))
    for w in osmium.FileProcessor(str(build_data.PBF["KP"]), osmium.osm.NODE | osmium.osm.WAY)             .with_locations().with_filter(flt):
        if w.is_way():
            try:
                lines.append(shapely.LineString([(n.lon, n.lat) for n in w.nodes]))
            except Exception:
                pass
    coast = unary_union(lines).intersection(area.buffer(0.02))
    faces = list(shapely.ops.polygonize(shapely.node(unary_union([coast, area.boundary]))))
    marks = shapely.STRtree([shapely.Point(x, y) for _, x, y in places])
    # 지명이 드문 산간·강 하구 쪽 육지 면도 살리도록, Natural Earth 육지(조금 안쪽으로 줄임) 안에 있으면 육지로 본다
    import geopandas as gpd
    ne_land = unary_union(list(gpd.read_file(f"zip://{(RAW / 'ne_10m_land.zip').as_posix()}").geometry)).buffer(-0.01)
    shapely.prepare(ne_land)

    def is_land(f):
        if not area.contains(f.representative_point()):
            return False
        return len(marks.query(f, predicate="contains")) > 0 or ne_land.contains(f.representative_point())
    land = [f for f in faces if is_land(f)]
    land = shapely.make_valid(unary_union(land))
    log("KP coastline ways", len(lines), "faces", len(faces), "land/area", round(land.area / area.area, 3))
    if land.area < 0.5 * area.area:
        log("coastline clipping looks wrong; keeping OSM boundaries")
        return None
    return land


def fill_kp_holes(zones):
    """해안선으로 자르면서 빠진 내륙 땅(의주·룡천 등 강어귀)을 닿아 있는 시·군에 붙인다."""
    import geopandas as gpd
    c = gpd.read_file(f"zip://{(RAW / 'ne_10m_admin_0_countries.zip').as_posix()}")
    prk = unary_union(list(c[c.ADM0_A3 == "PRK"].geometry)).buffer(-0.005)
    hole = prk.difference(unary_union([z["geom"] for z in zones]))
    n = 0
    for part in getattr(hole, "geoms", [hole]):
        if part.geom_type != "Polygon" or area_km2(part) < 3:
            continue
        ring = part.buffer(0.01)
        best = max(zones, key=lambda z: z["geom"].intersection(ring).area)
        if best["geom"].intersection(ring).area <= 0:
            continue
        best["geom"] = polygonal(shapely.make_valid(unary_union([best["geom"], part.buffer(0.0005)])))
        n += 1
    log("KP holes filled", n)


def merge_slivers(zones, min_km2=1.5):
    """해안선으로 잘리고 거의 바다만 남은 작은 존(1.5km² 미만)은 맞닿은 시·군에 합친다."""
    small = [z for z in zones if area_km2(z["geom"]) < min_km2]
    rest = [z for z in zones if area_km2(z["geom"]) >= min_km2]
    for z in small:
        ring = z["geom"].buffer(0.01)
        best = max(rest, key=lambda r: r["geom"].intersection(ring).area)
        if best["geom"].intersection(ring).area > 0:
            best["geom"] = polygonal(shapely.make_valid(unary_union([best["geom"], z["geom"]])))
        log("sliver zone merged", z["name"], round(area_km2(z["geom"]), 2), "km2 ->", best["name"])
    return rest


def kp_units():
    """북: OSM 시·군·구역 경계를 해안선으로 자른 뒤, 그 안을 인구 격자 묶음 중심의 보로노이로 나눈다."""
    zones = build_data.build_zones(countries=("KP",))
    places = kp_places()
    land = kp_land(zones, places)
    if land is not None:
        for z in zones:
            z["geom"] = polygonal(z["geom"].intersection(land))
        zones = [z for z in zones if not z["geom"].is_empty]
        fill_kp_holes(zones)
        zones = merge_slivers(zones)
    pl_xy = np.array([(x, y) for _, x, y in places]) if places else np.zeros((0, 2))
    with rasterio.open(KP_POP) as src:
        arr = src.read(1).astype("float64")
        arr[~np.isfinite(arr) | (arr < 0)] = 0
        ids = rasterio.features.rasterize(((z["geom"], i + 1) for i, z in enumerate(zones)),
                                          out_shape=arr.shape, transform=src.transform, fill=0, dtype="int32")
        rows, cols = np.nonzero(ids > 0)
        xs, ys = rasterio.transform.xy(src.transform, rows, cols)
        xs = np.asarray(xs); ys = np.asarray(ys)
        pops = arr[rows, cols] + 1.0   # 빈 땅도 조금은 가중해 산간에도 구역이 생기게 한다
        zid = ids[rows, cols]
    units = []
    for i, z in enumerate(zones):
        g = shapely.make_valid(z["geom"])
        m = zid == i + 1
        a = area_km2(g)
        if m.sum() < 2:
            units.append(unit_kp(z, g, z["name"]))
            continue
        w = pops[m]
        k = int(np.clip(round(w.sum() / KP_POP_PER_UNIT + a / KP_AREA_PER_UNIT), 1, KP_MAX_UNITS))
        k = min(k, int(m.sum()))
        if k == 1:
            units.append(unit_kp(z, g, z["name"]))
            continue
        scale = np.array([math.cos(math.radians(g.centroid.y)), 1.0])
        xy = np.column_stack([xs[m], ys[m]])
        centers, _ = weighted_kmeans(xy * scale, w, k)
        centers = centers / scale
        seeds = shapely.MultiPoint([tuple(c) for c in centers])
        cells = shapely.voronoi_polygons(seeds, extend_to=g.buffer(0.05))
        used = set()
        for cell in getattr(cells, "geoms", [cells]):
            part = cell.intersection(g)
            if part.is_empty or part.area <= 0:
                continue
            part = polygonal(part)
            if part.is_empty:
                continue
            c = part.representative_point()
            units.append(unit_kp(z, part, nearest_name(places, pl_xy, c.x, c.y, part, used) or z["name"]))
    log("KP zones", len(zones), "units", len(units))
    return units


def unit_kp(z, g, name):
    return {"name": name, "code": "", "country": "KP", "province": z["province"], "zone": z["name"], "geom": g}


def nearest_name(places, pl_xy, x, y, part, used):
    """구역 안(없으면 가장 가까운)의 지명. 같은 시군에서 이미 쓴 이름은 피한다."""
    if not len(pl_xy):
        return None
    d = np.hypot((pl_xy[:, 0] - x) * math.cos(math.radians(y)), pl_xy[:, 1] - y)
    for k in np.argsort(d)[:12]:
        name = places[k][0]
        if name in used:
            continue
        inside = part.contains(shapely.Point(pl_xy[k]))
        if inside or d[k] * KM_PER_DEG < 3:
            used.add(name)
            return name
    return None


def simplify_coverage(geoms, tol):
    geoms = [polygonal(g) for g in geoms]
    arr = np.array(geoms, dtype=object)
    try:
        return list(shapely.coverage_simplify(arr, tol))
    except shapely.errors.GEOSException as e:
        log("coverage_simplify failed, falling back:", e)
        return [g.simplify(tol, preserve_topology=True) for g in geoms]


def to_fc(rows, props):
    feats = []
    for i, (r, g) in enumerate(rows):
        g = shapely.set_precision(g, 0.0001)
        if g.is_empty:
            continue
        feats.append({"type": "Feature", "id": i, "properties": props(i, r), "geometry": mapping(g)})
    return {"type": "FeatureCollection", "attribution": ATTRIBUTION, "features": feats}


# 분단으로 갈라지거나 없어진 군 가운데 게임에서 되살릴 수 있는 군 (pipeline/historic_counties.json: 읍면동·북측 권역별 1945년 소속 조사)
RESTORABLE = {"장단군", "김화군", "철원군", "연천군", "연백군", "인제군"}   # 양구군: 옛 수입면 땅(금강군)이 양구와 닿지 않아(월경지) 뺐다


def tag_historic(units):
    """읍면동마다 1945년 소속 군(hist)을 달고, 지금 시군 안에 되살릴 수 있는 다른 옛 군 땅이 섞여 있으면 그 땅을 따로 떼어
    (piece) 계산 존으로 나눈다. 평소에는 원래 시군 이름으로 보이고, 행정구역 정리에서 옛 군을 되살리면 그 군으로 묶인다.
      예) 남측 철원군 = 옛 철원군(철원·갈말·동송) + 옛 김화군(김화·근남·근북·서면) → 김화 쪽을 piece '김화군'으로
    확신이 낮은 조사 결과(low)는 쓰지 않는다"""
    path = Path(__file__).parent / "historic_counties.json"
    if not path.exists():
        return
    rows = json.loads(path.read_text(encoding="utf-8"))["units"]
    side = {"KR": "남", "KP": "북"}
    look = defaultdict(list)
    for r in rows:
        x, y = map(float, r["point"].split(","))
        look[(r["zone"], r["unit"])].append((x, y, r))
    by_zone = defaultdict(list)
    for u in units:
        cands = look.get((f"{u['zone']}({side[u['country']]})", u["name"]))
        if not cands:
            continue
        c = u["geom"].representative_point()
        x, y, r = min(cands, key=lambda t: (t[0] - c.x) ** 2 + (t[1] - c.y) ** 2)
        if r["confidence"] != "low":
            u["hist"] = r["historic_county"]
        by_zone[(u["country"], u["province"], u["zone"])].append(u)
    n = 0
    for key, us in by_zone.items():
        area = defaultdict(float)
        for u in us:
            area[u.get("hist")] += u["geom"].area
        # 지금 시군과 같은 이름의 옛 군, 없으면 가장 넓은 옛 군이 이 존의 몸통 (나머지 되살릴 수 없는 옛 군 땅도 몸통에 둔다)
        main = key[2] if key[2] in area else max(area, key=area.get)
        for u in us:
            h = u.get("hist")
            if h and h != main and h in RESTORABLE:
                u["piece"] = h
                n += 1
        for u in us:
            if not u.get("piece"):
                u["hist_main"] = main if main in RESTORABLE else None
    # 떼어 낸 조각이 같은 옛 군의 다른 땅과 닿지 않으면(되살렸을 때 월경지가 된다) 떼지 않는다
    by_hist = defaultdict(list)
    for u in units:
        h = u.get("piece") or u.get("hist_main")
        if h:
            by_hist[h].append(u)
    for key, us in by_hist.items():
        for zkey in {(u["country"], u["province"], u["zone"]) for u in us if u.get("piece")}:
            part = [u for u in us if u.get("piece") and (u["country"], u["province"], u["zone"]) == zkey]
            rest = unary_union([u["geom"] for u in us if u not in part])
            if rest.is_empty or not unary_union([u["geom"] for u in part]).buffer(0.004).intersects(rest):
                for u in part:
                    del u["piece"]
                n -= len(part)
                log("historic piece dropped (exclave)", key, zkey[2])
    log("historic pieces (units split off)", n)


def resolve_overlaps(units):
    """겹치는 읍면동을 정리한다. 남측 경계(통계청)는 군사분계선까지인데 북측 경계(OSM)는 분계선 너머 남쪽까지 그려져 있어
    남북 시군이 비무장지대에서 140km² 남짓 겹친다 (화천×김화 36, 철원×김화 34, 파주×판문 15). 지도에서는 두 색이 포개진
    딴 행정구역처럼 보이고, 눌러도 한쪽만 골라진다. 남북이 겹친 곳은 군사분계선에서 잘라 남쪽은 남측, 북쪽은 북측에 두고,
    같은 쪽끼리 조금씩 겹친 곳(OSM 경계 오차)은 먼저 온 읍면동에 둔다"""
    from shapely.ops import linemerge
    mdl = [shape(f["geometry"]) for f in json.loads((ROOT / "data" / "base" / "lines.geojson").read_text(encoding="utf-8"))["features"]
           if f["properties"].get("kind") == "mdl"]
    if mdl:
        parts = sorted((g for g in getattr(linemerge(unary_union(mdl)), "geoms", []) if g.length > 0.001), key=lambda g: g.coords[0][0])
        pts = [c for g in parts for c in g.coords]
        # 분계선 서쪽 끝(한강 하구)·동쪽 끝(동해안)에서 같은 위도로 바다까지 늘여 남쪽 반을 닫는다
        south = shapely.make_valid(shapely.Polygon([(124.0, pts[0][1]), *pts, (132.0, pts[-1][1]), (132.0, 33.0), (124.0, 33.0)]))
        north = shapely.box(124.0, 33.0, 132.0, 43.5).difference(south)
        kr = unary_union([u["geom"] for u in units if u["country"] == "KR"])
        kp = unary_union([u["geom"] for u in units if u["country"] == "KP"])
        both = kr.intersection(kp)
        cut = 0.0
        for u in units:
            other = both.intersection(north if u["country"] == "KR" else south)
            if u["geom"].intersects(other):
                before = u["geom"].area
                u["geom"] = polygonal(shapely.make_valid(u["geom"].difference(other)))
                cut += before - u["geom"].area
        log("north-south overlap cut at MDL", round(both.area * 111 * 88, 1), "km2")
    tree = shapely.STRtree([u["geom"] for u in units])
    n = 0
    for i, u in enumerate(units):
        for j in tree.query(u["geom"]):
            j = int(j)
            if j <= i or units[j]["geom"].is_empty:
                continue
            ov = u["geom"].intersection(units[j]["geom"])
            if ov.area > 1e-8:
                units[j]["geom"] = polygonal(shapely.make_valid(units[j]["geom"].difference(ov)))
                n += 1
    log("overlapping unit pairs trimmed", n)


def absorb_dmz(units, reach=0.03, claim=0.006):
    """비무장지대처럼 어느 시군에도 속하지 않는 남북 사이 땅을 맞닿은 읍면동(따라서 그 시군)에 붙인다.
    남측과 북측 영역 모두에서 reach(약 3km) 안인 육지 가운데 비어 있는 곳을, 가까운 읍면동부터 claim(약 600m) 반경씩 나눠 갖는다.
    남은 조각은 가장 가까운 읍면동에. 이렇게 하면 지도에는 군사분계선 하나만 남는다 (따로 그리던 남북 시군 경계가 겹치지 않는다)"""
    import geopandas as gpd
    kr = unary_union([u["geom"] for u in units if u["country"] == "KR"])
    kp = unary_union([u["geom"] for u in units if u["country"] == "KP"])
    band = kr.buffer(reach).intersection(kp.buffer(reach))
    land = unary_union(gpd.read_file(f"zip://{(RAW / 'ne_10m_land.zip').as_posix()}").clip(band.bounds).geometry)
    gap = shapely.make_valid(land.intersection(band)).difference(kr.union(kp))
    pieces = [g for g in getattr(gap, "geoms", [gap]) if g.geom_type == "Polygon" and g.area > 1e-8]
    if not pieces:
        return
    gap = unary_union(pieces)
    tree = shapely.STRtree([u["geom"] for u in units])
    near = tree.query(gap.buffer(claim))
    left = gap
    for i in sorted(near, key=lambda i: gap.distance(units[i]["geom"])):
        part = left.intersection(units[i]["geom"].buffer(claim))
        if part.is_empty or part.area < 1e-9:
            continue
        units[i]["geom"] = shapely.make_valid(units[i]["geom"].union(part))
        left = left.difference(part)
    for g in getattr(left, "geoms", [left]):
        if g.is_empty or g.area < 1e-9:
            continue
        i = int(tree.nearest(g))
        units[i]["geom"] = shapely.make_valid(units[i]["geom"].union(g))
    log("dmz land absorbed into adjacent units", round(gap.area * 111 * 88, 1), "km2")


def main():
    units = kr_units() + kp_units()
    # MERGE_ZONES에 적힌 군은 한 존으로 묶고, 존에 다른 쪽 인구 격자도 함께 세도록 also를 단다
    for u in units:
        key = (u["country"], u["province"], u["zone"])
        if key in MERGE_ZONES:
            u["country"], u["province"], u["zone"] = MERGE_ZONES[key]
            u["from_country"] = key[0]
    resolve_overlaps(units)
    absorb_dmz(units)
    tag_historic(units)
    # 존(시군구) 묶기: 순서는 남 → 북, 이름순. 옛 군 땅을 떼어 낸 조각(piece)은 몸통 바로 뒤에
    groups = defaultdict(list)
    for u in units:
        groups[(u["country"], u["province"], u["zone"], u.get("piece") or "")].append(u)
    keys = sorted(groups, key=lambda k: (k[0] != "KR", k[1], k[2], k[3]))
    zones = []
    for zi, key in enumerate(keys):
        for u in groups[key]:
            u["zone_id"] = zi
        also = sorted({u["from_country"] for u in groups[key] if u.get("from_country")} - {key[0]})
        hist = key[3] or next((u["hist_main"] for u in groups[key] if u.get("hist_main")), None)
        zones.append({"country": key[0], "province": key[1], "name": key[2], "also": also,
                      **({"hist": hist} if hist else {}), **({"piece": 1} if key[3] else {}),
                      "geom": polygonal(unary_union([u["geom"] for u in groups[key]]))})
    units.sort(key=lambda u: (u["zone_id"], u["name"]))
    for i, u in enumerate(units):
        u["id"] = i

    # 커버리지 단순화: 남은 한 번에, 북은 시군마다 (OSM 시군 경계끼리 조금 겹칠 수 있어서)
    simple = [None] * len(units)
    kr = [u for u in units if u["country"] == "KR"]
    for u, g in zip(kr, simplify_coverage([u["geom"] for u in kr], TOL_UNIT)):
        simple[u["id"]] = g
    for zi, z in enumerate(zones):
        if z["country"] != "KP":
            continue
        us = [u for u in units if u["zone_id"] == zi]
        for u, g in zip(us, simplify_coverage([u["geom"] for u in us], TOL_UNIT)):
            simple[u["id"]] = g
    by_zone = defaultdict(list)
    for u in units:
        by_zone[u["zone_id"]].append(simple[u["id"]])
    sgg_simple = [polygonal(unary_union(by_zone[zi])) for zi in range(len(zones))]
    sgg_simple = simplify_coverage(sgg_simple, TOL_SGG)
    for z, g in zip(zones, sgg_simple):
        z["geom_simple"] = g
    sido = defaultdict(list)
    for z, g in zip(zones, sgg_simple):
        sido[(z["country"], z["province"])].append(g)
    sido_rows = [(k, polygonal(unary_union(v))) for k, v in sido.items()]
    sido_geoms = simplify_coverage([g for _, g in sido_rows], TOL_SIDO)

    OUT.mkdir(parents=True, exist_ok=True)
    pickle.dump({
        "units": [{k: (v.wkb if k == "geom" else v) for k, v in u.items()} for u in units],
        "zones": [{k: (v.wkb if k in ("geom", "geom_simple") else v) for k, v in z.items()} for z in zones],
    }, (RAW / "admin_master.pkl").open("wb"))
    write(OUT / "units.geojson", to_fc([(u, simple[u["id"]]) for u in units],
          lambda i, u: {"id": u["id"], "name": u["name"], "zone": u["zone_id"], "country": u["country"]}))
    write(OUT / "sgg.geojson", to_fc(list(zip(zones, sgg_simple)),
          lambda i, z: {"id": i, "name": z["name"], "province": z["province"], "country": z["country"],
                        **{k: z[k] for k in ("hist", "piece") if k in z}}))
    write(OUT / "sido.geojson", to_fc([(k, g) for (k, _), g in zip(sido_rows, sido_geoms)],
          lambda i, k: {"name": k[1], "country": k[0]}))
    log("zones", len(zones), "KR", sum(z["country"] == "KR" for z in zones), "KP", sum(z["country"] == "KP" for z in zones))


def write(path, fc):
    path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(path.name, len(fc["features"]), round(path.stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()

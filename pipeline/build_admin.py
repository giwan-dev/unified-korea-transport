"""행정구역 기준 도형을 만든다 (build_data.py보다 먼저 실행).

- 남: 통계청 SGIS 행정동 경계 (vuski/admdongkor 가공본, CC BY 4.0 / 공공누리 제1유형)를 읍면동 단위로 쓰고,
      시군구(일반구는 시로 합침)와 시도는 읍면동을 합쳐 만든다.
- 북: OSM 시·군·구역 경계(해안선으로 자름) 안을 실제 리·동·읍·노동자구로 나눈다. OSM 지명 점
      (place=village '…리', quarter·village 등 '…동', town '…읍', '…로동자구')이 단위 하나씩의 씨앗이고
      (같은 시군의 같은 이름은 하나로, 군에는 동이 없으므로 군 안 '…동' 점은 뺀다),
      경계는 Copernicus DEM(약 90m) 위 최소 비용 거리로 정한다: 오르막·내리막과 강(OSM waterway=river)
      건너기에 비용을 매겨 씨앗마다 퍼뜨리면 이웃 단위가 능선과 강에서 만난다 (kp_split).
      씨앗이 하나도 없는 시군은 시군 전체가 한 단위.
      OSM PBF는 libosmium이 ASCII 경로만 열 수 있어 필요하면 임시 폴더에 복사해 읽는다 (osm_file, 환경 변수 KP_PBF).
- 경계는 커버리지 단순화(이웃과 공유하는 경계를 같이 줄임)로 틈 없이 가볍게 만든다.

출력
  - data/raw/admin_master.pkl     원래 정밀도의 단위·존 도형 (build_data, build_grid가 읽는다)
  - data/admin/units.geojson      읍면동(북은 리·동·읍·노동자구) 경계, 지도용 (build_basemap.py units가 시도별로 나눈다)
  - data/admin/sgg.geojson        시군구 경계, 지도용
  - data/admin/sido.geojson       시도 경계, 지도용

실행: python pipeline/build_admin.py            (전부 새로: 뒤에 build_data.py부터 다시)
      python pipeline/build_admin.py --kp-only  (북측 리·동만 새로: 존·남측 읍면동·시군구 경계는 그대로, main_kp_only)
--kp-only 뒤에 돌릴 것: build_grid.py → build_basemap.py units → build_coverage.py --kp-only → build_names.py
"""

from __future__ import annotations

import json
import math
import os
import pickle
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import osmium
import rasterio
import rasterio.features
import rasterio.transform
import rasterio.windows
import shapely
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
import build_data  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "admin"
MASTER = RAW / "admin_master.pkl"
ADMDONG = RAW / "HangJeongDong_ver20261001.geojson"
DEM_DIR = RAW / "dem"
KM_PER_DEG = 111.32

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


def osm_file(path):
    """libosmium은 한글 등 ASCII가 아닌 경로의 파일을 열지 못한다. 그런 경로면 임시 폴더(ASCII 경로)에 복사해 그 경로를 쓴다.
    환경 변수 KP_PBF(북측 PBF 경로)로 직접 지정할 수도 있다"""
    path = Path(path)
    if str(path).isascii():
        return path
    if path.name == "north-korea.osm.pbf" and os.environ.get("KP_PBF"):
        return Path(os.environ["KP_PBF"])
    import shutil
    import tempfile
    tmp = Path(tempfile.gettempdir()) / "ukt_osm"
    if not str(tmp).isascii():
        sys.exit(f"{path}: ASCII가 아닌 경로라 libosmium이 열 수 없다. 환경 변수 KP_PBF에 ASCII 경로의 복사본을 지정할 것")
    tmp.mkdir(exist_ok=True)
    dst = tmp / path.name
    st = path.stat()
    if not dst.exists() or dst.stat().st_size != st.st_size or dst.stat().st_mtime < st.st_mtime:
        log("copying", path.name, "to", dst)
        shutil.copy2(path, dst)
    return dst


def kp_places():
    """북측 지명 점: (이름, 경도, 위도, place 종류)"""
    out = []
    flt = osmium.filter.KeyFilter("place")
    for n in osmium.FileProcessor(str(osm_file(build_data.PBF["KP"])), osmium.osm.NODE).with_filter(flt):
        t = n.tags
        if t.get("place") in ("town", "village", "suburb", "quarter", "neighbourhood", "hamlet") and build_data.ko_name(t):
            out.append((build_data.ko_name(t), n.location.lon, n.location.lat, t.get("place")))
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
    for w in osmium.FileProcessor(str(osm_file(build_data.PBF["KP"])), osmium.osm.NODE | osmium.osm.WAY)             .with_locations().with_filter(flt):
        if w.is_way():
            try:
                lines.append(shapely.LineString([(n.lon, n.lat) for n in w.nodes]))
            except Exception:
                pass
    coast = unary_union(lines).intersection(area.buffer(0.02))
    faces = list(shapely.ops.polygonize(shapely.node(unary_union([coast, area.boundary]))))
    marks = shapely.STRtree([shapely.Point(x, y) for _, x, y, kind in places if kind != "quarter"])
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


def kp_counties(places):
    """북측 시·군·구역 경계(OSM)를 해안선으로 자르고 빈 땅·자투리를 정리한다"""
    build_data.PBF["KP"] = osm_file(build_data.PBF["KP"])   # build_zones도 libosmium으로 읽는다
    zones = build_data.build_zones(countries=("KP",))
    land = kp_land(zones, places)
    if land is not None:
        for z in zones:
            z["geom"] = polygonal(z["geom"].intersection(land))
        zones = [z for z in zones if not z["geom"].is_empty]
        fill_kp_holes(zones)
        zones = merge_slivers(zones)
    return zones


def kp_units():
    """북: OSM 시·군·구역 경계를 해안선으로 자른 뒤, 그 안을 실제 리·동·읍·노동자구로 나눈다.
    OSM 지명 점 하나가 단위 하나의 씨앗이고, 경계는 지형 비용(DEM) 위에서 씨앗마다 퍼져 만나는 곳이다 (kp_split)."""
    places = kp_places()
    zones = kp_counties(places)
    seeds = kp_seeds(zones, places)
    dem = Dem(DEM_DIR)
    rivers = kp_rivers()
    units, single = [], []
    for i, z in enumerate(zones):
        g = shapely.make_valid(z["geom"])
        ss = seeds[i]
        if len(ss) < 2:
            # 씨앗이 없거나 하나뿐인 시군은 시군 전체가 한 단위 (이름은 시군 이름)
            units.append(unit_kp(z, g, z["name"]))
            single.append((z["name"], len(ss)))
            continue
        for name, part in kp_split(g, ss, dem, rivers):
            units.append(unit_kp(z, part, name))
    log("KP zones", len(zones), "units", len(units), "one-unit zones", len(single), single)
    return units


def unit_kp(z, g, name):
    return {"name": name, "code": "", "country": "KP", "province": z["province"], "zone": z["name"], "geom": g}


# 북측 단위의 씨앗이 되는 OSM 지명: 이름 끝 글자와 place 종류. 우선순위는 같은 이름이 둘 이상일 때 대표를 고르는 순서
KP_SEED_RANK = {"town": 0, "village": 1, "quarter": 2, "suburb": 3, "neighbourhood": 4, "hamlet": 5}
KP_SAME_NAME_KM = 3.0   # 같은 시군에서 같은 이름 점이 이 거리 안이면 한 단위의 씨앗 여럿으로 본다 (멀면 대표 하나만)


def seed_kind(name, place, zone_name):
    """리·동·읍·노동자구 이름이면 그 종류, 아니면 None.
    군에는 동이 없다(읍·리·노동자구만): 군 안의 '…동' 점은 자연 마을 이름이라 씨앗으로 쓰지 않는다"""
    if name.endswith(("노동자구", "로동자구")):
        return "구"
    if name.endswith("읍") and place in ("town", "village", "hamlet"):
        return "읍"
    if name.endswith("리") and place in ("village", "hamlet", "town", "neighbourhood"):
        return "리"
    if name.endswith("동") and len(name) >= 2 and not zone_name.endswith("군"):
        return "동"
    return None


def kp_seeds(zones, places):
    """시군마다 씨앗 [(이름, [(경도, 위도), ...]), ...]. 지명 점은 그 점을 품은 시군에 넣고, 같은 이름은 하나로 합친다"""
    tree = shapely.STRtree([z["geom"] for z in zones])
    found = defaultdict(lambda: defaultdict(list))
    for name, x, y, place in places:
        hit = tree.query(shapely.Point(x, y), predicate="within")
        if not len(hit):
            continue
        zi = int(min(hit))   # 시군 경계가 조금 겹치면 앞 시군 (resolve_overlaps와 같은 순서)
        if seed_kind(name, place, zones[zi]["name"]):
            found[zi][name].append((KP_SEED_RANK[place], x, y))
    out = {}
    for zi in range(len(zones)):
        seeds = []
        for name, pts in sorted(found[zi].items()):
            pts.sort()
            _, x0, y0 = pts[0]
            near = [(x, y) for _, x, y in pts
                    if math.hypot((x - x0) * math.cos(math.radians(y0)), y - y0) * KM_PER_DEG < KP_SAME_NAME_KM]
            seeds.append((name, near))
        out[zi] = seeds
    log("KP seeds", sum(len(s) for s in out.values()),
        {k: sum(1 for s in out.values() for n, _ in s if n.endswith(k)) for k in ("리", "동", "읍", "구")})
    return out


class Dem:
    """Copernicus DEM GLO-90(3초, 약 90m) 타일들을 한 격자처럼 읽는다. 타일이 없는 곳(바다)은 0m"""

    RES = 1 / 1200

    def __init__(self, folder):
        self.tiles = {}
        for p in Path(folder).glob("Copernicus_DSM_COG_30_*.tif"):
            m = re.search(r"_([NS])(\d+)_00_([EW])(\d+)_00_", p.name)
            if m:
                self.tiles[(int(m.group(2)), int(m.group(4)))] = p

    def window(self, x0, y0, x1, y1):
        """경위도 범위를 덮는 표고 배열과 변환(왼쪽 위 기준). 화소 경계가 1/1200도 격자에 맞는다"""
        c0, c1 = math.floor(x0 / self.RES), math.ceil(x1 / self.RES)
        r0, r1 = math.floor(-y1 / self.RES), math.ceil(-y0 / self.RES)   # 행은 북→남 (r = -위도/해상도)
        z = np.zeros((r1 - r0, c1 - c0), dtype="float32")
        for lat in range(math.floor(y0), math.floor(y1) + 1):
            for lon in range(math.floor(x0), math.floor(x1) + 1):
                p = self.tiles.get((lat, lon))
                if p is None:
                    continue
                # 타일 (lat, lon)은 행 -(lat+1)*1200 ~ -lat*1200, 열 lon*1200 ~ (lon+1)*1200
                tr0, tc0 = -(lat + 1) * 1200, lon * 1200
                a0, a1 = max(r0, tr0), min(r1, tr0 + 1200)
                b0, b1 = max(c0, tc0), min(c1, tc0 + 1200)
                if a0 >= a1 or b0 >= b1:
                    continue
                with rasterio.open(p) as src:
                    w = rasterio.windows.Window(b0 - tc0, a0 - tr0, b1 - b0, a1 - a0)
                    v = src.read(1, window=w).astype("float32")
                    if src.nodata is not None:
                        v[v == src.nodata] = 0
                z[a0 - r0:a1 - r0, b0 - c0:b1 - c0] = np.where(np.isfinite(v), v, 0)
        transform = rasterio.transform.from_origin(c0 * self.RES, -r0 * self.RES, self.RES, self.RES)
        return z, transform


def kp_rivers():
    """북측 강(OSM waterway=river 선). 단위 경계가 강을 따라가게 강을 건너는 비용을 더하는 데 쓴다"""
    lines = []
    flt = osmium.filter.TagFilter(("waterway", "river"))
    for w in osmium.FileProcessor(str(osm_file(build_data.PBF["KP"])), osmium.osm.NODE | osmium.osm.WAY) \
            .with_locations().with_filter(flt):
        if w.is_way():
            try:
                lines.append(shapely.LineString([(n.lon, n.lat) for n in w.nodes]))
            except Exception:
                pass
    log("KP river ways", len(lines))
    return shapely.STRtree(lines), lines


# 지형 비용 (km 환산): 수평 거리 1km = 1, 오르막 1m마다 KP_COST_UP, 내리막 1m마다 KP_COST_DOWN, 강 건너기 KP_COST_RIVER
KP_COST_UP = 0.02       # 100m 오르면 2km 걸은 셈: 능선을 넘기 어렵게 해 경계가 능선에 놓인다
KP_COST_DOWN = 0.005
KP_COST_RIVER = 1.5     # 강을 건너면 1.5km 더: 평지에서는 경계가 강을 따라간다
KP_SIMPLIFY = 0.0018    # 화소 계단(약 90m)을 펴는 단순화 허용오차(도)


def kp_split(g, seeds, dem, rivers):
    """시군 g를 씨앗마다 나눈다: 표고 격자(약 90m) 위에서 모든 씨앗을 함께 출발점으로 한 최소 비용 거리(다익스트라)를 구해
    화소마다 가장 싸게 닿는 씨앗에 준다. 오르막·내리막과 강 건너기에 비용을 매겨, 이웃 단위가 만나는 곳(경계)이
    능선과 강을 따라간다. 화소 덩어리를 면으로 바꿔(rasterio.features.shapes) 계단을 편 뒤 시군 경계로 자른다.
    결과 [(이름, 도형), ...]는 시군을 빈틈·겹침 없이 덮는다"""
    from scipy import ndimage
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra

    x0, y0, x1, y1 = g.bounds
    pad = 3 * Dem.RES
    z, tr = dem.window(x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    h, w = z.shape
    z = ndimage.uniform_filter(z, 3)   # 건물·숲 높이 잡음을 누그러뜨린다
    inside = rasterio.features.rasterize([(g, 1)], out_shape=(h, w), transform=tr, fill=0, all_touched=True,
                                         dtype="uint8").astype(bool)
    rtree, rlines = rivers
    near = [rlines[k] for k in rtree.query(g)]
    river = rasterio.features.rasterize([(l, 1) for l in near], out_shape=(h, w), transform=tr, fill=0,
                                        all_touched=True, dtype="uint8").astype(bool) if near else np.zeros((h, w), bool)
    lat = (y0 + y1) / 2
    dx = Dem.RES * KM_PER_DEG * math.cos(math.radians(lat))
    dy = Dem.RES * KM_PER_DEG
    idx = -np.ones((h, w), dtype=np.int64)
    rr, cc = np.nonzero(inside)
    idx[rr, cc] = np.arange(len(rr))
    src, dst, cost = [], [], []
    for di, dj in ((0, 1), (1, 0), (1, 1), (1, -1)):
        a = idx[0:h - di, max(0, -dj):w - max(0, dj)]
        b = idx[di:h, max(0, dj):w - max(0, -dj)]
        za = z[0:h - di, max(0, -dj):w - max(0, dj)]
        zb = z[di:h, max(0, dj):w - max(0, -dj)]
        ra = river[0:h - di, max(0, -dj):w - max(0, dj)]
        rb = river[di:h, max(0, dj):w - max(0, -dj)]
        ok = (a >= 0) & (b >= 0)
        a, b, za, zb, ra, rb = a[ok], b[ok], za[ok], zb[ok], ra[ok], rb[ok]
        step = math.hypot(dx * abs(dj), dy * abs(di))
        dz = (zb - za).astype("float64")
        # a→b, b→a 두 방향 (오르막 비용이 달라 방향 그래프)
        fwd = step + KP_COST_UP * np.maximum(dz, 0) + KP_COST_DOWN * np.maximum(-dz, 0) + KP_COST_RIVER * (rb & ~ra)
        bwd = step + KP_COST_UP * np.maximum(-dz, 0) + KP_COST_DOWN * np.maximum(dz, 0) + KP_COST_RIVER * (ra & ~rb)
        src += [a, b]; dst += [b, a]; cost += [fwd, bwd]
    n = len(rr)
    graph = csr_matrix((np.concatenate(cost), (np.concatenate(src), np.concatenate(dst))), shape=(n, n))
    # 씨앗 화소: 시군 안 가장 가까운 화소로 옮긴다
    _, (ni, nj) = ndimage.distance_transform_edt(~inside, return_indices=True)
    starts, owner = [], []
    inv = ~tr
    for k, (name, pts) in enumerate(seeds):
        for x, y in pts:
            c, r = inv * (x, y)
            r = min(max(int(r), 0), h - 1); c = min(max(int(c), 0), w - 1)
            node = idx[ni[r, c], nj[r, c]]
            if node >= 0 and node not in starts:
                starts.append(int(node)); owner.append(k)
    lab = np.full(n, -1)
    if starts:
        _, _, srcs = dijkstra(graph, directed=True, indices=starts, min_only=True, return_predecessors=True)
        own = np.full(n, -1)
        own[starts] = owner
        ok = srcs >= 0
        lab[ok] = own[srcs[ok]]
    grid = np.full((h, w), -1, dtype=np.int32)
    grid[rr, cc] = lab
    # 닿지 않은 화소(떨어진 섬 등)와 시군 밖 화소는 가장 가까운 단위로 채워 격자 전체를 덮는다
    known = grid >= 0
    if not known.any():
        return [(seeds[0][0], g)]
    _, (ki, kj) = ndimage.distance_transform_edt(~known, return_indices=True)
    grid = grid[ki, kj]
    names = [s[0] for s in seeds]
    polys = defaultdict(list)
    for geom, v in rasterio.features.shapes(grid, transform=tr, connectivity=4):
        polys[int(v)].append(shape(geom))
    keys = sorted(polys)
    cover = [unary_union(polys[k]) for k in keys]
    try:
        cover = list(shapely.coverage_simplify(cover, KP_SIMPLIFY))
    except shapely.errors.GEOSException:
        pass
    out = []
    for k, c in zip(keys, cover):
        part = polygonal(c.intersection(g))
        if not part.is_empty and part.area > 0:
            out.append((names[k], part))
    return absorb_fragments(out)


def absorb_fragments(parts, min_km2=0.5):
    """본체에서 떨어진 작은 조각(min_km2 미만, 화소 경계·시군 경계에 걸려 생긴 것)은 가장 길게 맞닿은 이웃 단위에 붙인다.
    아무와도 맞닿지 않은 조각(섬)은 그대로 둔다"""
    geoms = [g for _, g in parts]
    tree = shapely.STRtree(geoms)
    for i in range(len(geoms)):
        ps = sorted(getattr(geoms[i], "geoms", [geoms[i]]), key=lambda p: -p.area)
        keep = ps[:1]
        for p in ps[1:]:
            if area_km2(p) >= min_km2:
                keep.append(p)
                continue
            ring = p.buffer(1e-5)
            best, bl = None, 0.0
            for j in tree.query(ring):
                j = int(j)
                if j == i:
                    continue
                shared = ring.intersection(geoms[j]).area
                if shared > bl:
                    best, bl = j, shared
            if best is None:
                keep.append(p)
            else:
                geoms[best] = polygonal(unary_union([geoms[best], p]))
        geoms[i] = unary_union(keep) if len(keep) > 1 else keep[0]
    return [(n, g) for (n, _), g in zip(parts, geoms)]


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
    by_zone_rows = defaultdict(list)
    for (zone, _), cs in look.items():
        by_zone_rows[zone] += cs
    by_zone = defaultdict(list)
    for u in units:
        zkey = f"{u['zone']}({side[u['country']]})"
        cands = look.get((zkey, u["name"]))
        if not cands and u["country"] == "KP":
            # 조사표의 북측 행은 예전 보로노이 구역 이름·대표점으로 적혀 있다: 이름이 안 맞는 리·동은 같은 시군에서 가장 가까운 행을 따른다
            cands = by_zone_rows.get(zkey)
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
    }, MASTER.open("wb"))
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


def partition(pieces, domain):
    """조각들을 domain 안으로 자르고 서로 겹치지 않게(앞이 먼저) 한 뒤, 빈 곳을 가장 길게 맞닿은 조각에 붙인다"""
    out, taken = [], None
    for g in pieces:
        g = polygonal(g.intersection(domain))
        if taken is not None and not g.is_empty:
            g = polygonal(g.difference(taken))
        out.append(g)
        if not g.is_empty:
            taken = g if taken is None else taken.union(g)
    if taken is None:
        return out
    gap = polygonal(domain.difference(taken))
    for piece in getattr(gap, "geoms", [gap]):
        if piece.is_empty or piece.area < 1e-12:
            continue
        ring = piece.buffer(2e-5)
        best = max(range(len(out)), key=lambda k: ring.intersection(out[k]).area if not out[k].is_empty else -1)
        if out[best].is_empty or ring.intersection(out[best]).area <= 0:
            best = min(range(len(out)), key=lambda k: out[k].distance(piece) if not out[k].is_empty else 1e9)
        out[best] = polygonal(out[best].union(piece))
    return out


def main_kp_only():
    """북측 단위만 다시 만든다 (python pipeline/build_admin.py --kp-only).
    저장 게임과 기준 연도 계산이 존(시군구) 번호에 묶여 있어, 이미 있는 admin_master.pkl의 존(순서·도형·옛 군 조각)과
    남측 읍면동은 그대로 두고 북측 리·동만 바꾼다. 새 단위는 겹침이 가장 큰 존(시군 몸통 또는 옛 군 조각)에 통째로 넣고
    그 존의 원래 도형 안으로 맞춰(넘친 곳은 자르고 빈 곳은 이웃 단위에) 존 도형이 바뀌지 않게 한다.
    sgg·sido.geojson은 쓰지 않는다 (시군구 경계 그대로). 남측 단위의 지도용 도형은 data/admin/units/의 것을 그대로 옮긴다.
    뒤따라: build_grid.py → build_basemap.py units → build_coverage.py --kp-only → build_names.py"""
    from shapely import wkb
    master = pickle.load(MASTER.open("rb"))
    zones = master["zones"]
    zgeom = [wkb.loads(z["geom"]) for z in zones]
    kr = [u for u in master["units"] if u["country"] == "KR"]
    new = kp_units()
    by_county = defaultdict(list)
    for u in new:
        by_county[(u["province"], u["zone"])].append(u)
    zone_of = defaultdict(list)   # (도, 시군) → 그 시군의 존 번호들 (몸통 + 옛 군 조각)
    for zi, z in enumerate(zones):
        if z["country"] == "KP":
            zone_of[(z["province"], z["name"])].append(zi)
    assigned = defaultdict(list)
    for key, zis in zone_of.items():
        us = by_county.get(key, [])
        if not us:
            log("no new units for zone", key)
        for u in us:
            zi = max(zis, key=lambda k: u["geom"].intersection(zgeom[k]).area) if len(zis) > 1 else zis[0]
            assigned[zi].append(u)
    kp = []
    for zi, z in enumerate(zones):
        if z["country"] != "KP":
            continue
        us = sorted(assigned.get(zi, []), key=lambda u: u["name"])
        if not us:
            us = [unit_kp({"province": z["province"], "name": z["name"]}, zgeom[zi], z["name"])]
        for u, g in zip(us, partition([u["geom"] for u in us], zgeom[zi])):
            if g.is_empty:
                continue
            kp.append({**u, "geom": g, "zone_id": zi, **({"hist": z["hist"]} if z.get("hist") else {}),
                       **({"piece": z["hist"]} if z.get("piece") else {})})
    kp.sort(key=lambda u: (u["zone_id"], u["name"]))
    n0 = len(kr)
    for i, u in enumerate(kp):
        u["id"] = n0 + i
    # 북측 지도용 도형: 존마다 커버리지 단순화 (build_coverage.py --kp-only가 시군구 경계에 맞춰 다시 다듬는다)
    simple = {}
    for zi in sorted({u["zone_id"] for u in kp}):
        us = [u for u in kp if u["zone_id"] == zi]
        for u, g in zip(us, simplify_coverage([u["geom"] for u in us], TOL_UNIT)):
            simple[u["id"]] = g
    old = {}
    for e in json.loads((OUT / "units" / "index.json").read_text(encoding="utf-8")):
        for f in json.loads((OUT / "units" / e["file"]).read_text(encoding="utf-8"))["features"]:
            old[f["properties"]["id"]] = f
    feats = [old[u["id"]] for u in kr]   # 남측은 지금 지도 파일 그대로
    for u in kp:
        g = shapely.set_precision(simple[u["id"]], 0.0001)
        if not g.is_empty:
            feats.append({"type": "Feature", "id": u["id"], "properties": {"id": u["id"], "name": u["name"], "zone": u["zone_id"],
                          "country": "KP"}, "geometry": mapping(g)})
    pickle.dump({"units": kr + [{k: (v.wkb if k == "geom" else v) for k, v in u.items()} for u in kp], "zones": zones},
                MASTER.open("wb"))
    write(OUT / "units.geojson", {"type": "FeatureCollection", "attribution": ATTRIBUTION, "features": feats})
    log("KR units kept", len(kr), "KP units", len(kp), "zones kept", len(zones))


if __name__ == "__main__":
    main_kp_only() if "--kp-only" in sys.argv[1:] else main()

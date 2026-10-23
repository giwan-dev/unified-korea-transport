"""1km 인구 격자와 존 내부 소구역을 만든다 (build_data.py 다음에 실행).

- 모든 존(시군구)은 build_admin.py의 읍면동(남: 행정동, 북: 보로노이 구역)을 소구역으로 쓴다.
  1km 격자 인구는 읍면동과 겹치는 면적 비율로 나눈다. 같은 시군구 안에서도 읍면동마다 인구가 달라
  역·도로 접속 지점과 통과 교통량이 위치에 따라 달라진다.
- 북측 구역은 남측 행정동보다 훨씬 넓어서(중앙값 약 47km² 대 8km²), 넓거나 인구가 많은 구역은
  인구 격자를 가중 k-평균으로 다시 나눈다 (KP_SPLIT_*).
- 읍면동 경계가 존을 충분히 덮지 못하면 인구 격자를 가중 k-평균으로 묶어 소구역을 만든다.

게임은 소구역마다 역·정류장 접근시간을 따지고, 해마다 소구역 사이 인구 이동을 계산한다.

출력
  - data/zones.json        존 속성 (subs: [[경도, 위도, 인구비중, 면적km²], ...], sub0 포함)
  - data/subzones.geojson  소구역 경계 (읍면동 또는 격자 묶음), 이름
  - data/grid.bin          Float32 [경도, 위도, 인구, 소구역 번호] 반복 (little endian)

실행: python pipeline/build_grid.py
"""

from __future__ import annotations

import json
import math
import pickle
import sys
from pathlib import Path

import numpy as np
import rasterio
import rasterio.features
import shapely
from scipy import ndimage
from shapely import wkb
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
POP = {"KR": RAW / "kor_pop2025.tif", "KP": RAW / "prk_pop2025.tif"}

MIN_CELL_POP = 5          # 이보다 적은 격자는 버린다 (산간 빈 땅)
POP_PER_SUB = 120_000     # k-평균 소구역 하나가 맡는 대략적인 인구
MAX_SUBS = 8
METRO_POP_PER_SUB = 25_000  # 읍면동 경계가 없는 대도시(평양 등)는 동 규모로 잘게 묶는다
METRO_MAX_SUBS = 40
METRO_PROVINCES = {"서울특별시", "부산광역시", "대구광역시", "인천광역시", "대전광역시", "울산광역시",
                   "세종특별자치시", "평양시"}
METRO_MIN_POP = 300_000
METRO_MIN_DENSITY = 2000
MIN_COVERAGE = 0.6        # 읍면동 경계가 존 면적의 이만큼은 덮어야 쓴다
KP_SPLIT_AREA = 40        # 북측 구역을 나누는 기준 면적 (km²): 이 넓이마다 한 조각
KP_SPLIT_POP = 25_000     # 북측 구역을 나누는 기준 인구: 이 인구마다 한 조각
KP_SPLIT_MAX = 6          # 한 구역을 나누는 최대 조각 수
KM_PER_DEG = 111.32


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load_master_units():
    """build_admin.py의 읍면동(남: 행정동, 북: 보로노이 구역)을 존 번호별로 묶는다"""
    m = pickle.load((RAW / "admin_master.pkl").open("rb"))
    out = {}
    for u in m["units"]:
        # zone_id는 문자열로 저장돼 있다 (존 속성의 id는 정수): 정수로 맞춘다
        out.setdefault(int(u["zone_id"]), []).append((u["name"], wkb.loads(u["geom"])))
    return out


def load_admin8(country):
    """읍면동 경계. OSM 추출이 오래 걸리므로 data/raw에 캐시한다."""
    cache = RAW / f"admin8_{country}.pkl"
    if not cache.exists():
        sys.path.insert(0, str(Path(__file__).parent))
        import build_data
        areas = build_data.load_admin(country, levels=("8",))
        pickle.dump([(a["name"], a["geom"].wkb) for a in areas], cache.open("wb"))
    return [(name, wkb.loads(g)) for name, g in pickle.load(cache.open("rb"))]


def weighted_kmeans(xy, w, k, iters=25, seed=0):
    """가중 k-평균. 초기 중심은 인구가 큰 격자에서 서로 떨어지게 고른다."""
    rng = np.random.default_rng(seed)
    order = np.argsort(-w)
    centers = [xy[order[0]]]
    for _ in range(1, k):
        d = np.min(((xy[:, None, :] - np.array(centers)[None]) ** 2).sum(-1), axis=1)
        p = d * w
        if p.sum() <= 0:
            break
        centers.append(xy[rng.choice(len(xy), p=p / p.sum())])
    c = np.array(centers)
    for _ in range(iters):
        lab = np.argmin(((xy[:, None, :] - c[None]) ** 2).sum(-1), axis=1)
        for j in range(len(c)):
            m = lab == j
            if m.any():
                c[j] = (xy[m] * w[m, None]).sum(0) / w[m].sum()
    lab = np.argmin(((xy[:, None, :] - c[None]) ** 2).sum(-1), axis=1)
    return c, lab


def area_km2(g):
    return g.area * KM_PER_DEG ** 2 * math.cos(math.radians(g.centroid.y))


def is_metro(p):
    return (p["province"] in METRO_PROVINCES or p["pop"] >= METRO_MIN_POP
            or p["pop"] / max(p["area"], 1) >= METRO_MIN_DENSITY)


def main():
    fc = json.loads((RAW / "zones.geojson").read_text(encoding="utf-8"))
    places = json.loads((OUT / "places.json").read_text(encoding="utf-8"))
    feats = fc["features"]
    records = []          # (lon, lat, pop, sub)
    sub_feats = []
    sub_count = 0
    n_metro = 0
    units_by_zone = load_master_units()
    for c in ("KR", "KP"):
        zs = [f for f in feats if f["properties"]["country"] == c]
        with rasterio.open(POP[c]) as src:
            arr = src.read(1).astype("float64")
            arr[~np.isfinite(arr) | (arr < 0)] = 0
            if src.nodata is not None:
                arr[arr == src.nodata] = 0
            ids = rasterio.features.rasterize(
                ((shape(f["geometry"]), i + 1) for i, f in enumerate(zs)),
                out_shape=arr.shape, transform=src.transform, fill=0, dtype="int32")
            miss = (ids == 0) & (arr > 0)
            if miss.any():
                _, (ri, ci) = ndimage.distance_transform_edt(ids == 0, return_indices=True)
                ids = np.where(miss, ids[ri, ci], ids)
            rows, cols = np.nonzero(arr >= MIN_CELL_POP)
            xs, ys = rasterio.transform.xy(src.transform, rows, cols)
            xs = np.asarray(xs); ys = np.asarray(ys)
            pops = arr[rows, cols]
            zid = ids[rows, cols]
            res = abs(src.transform.a)
        for i, f in enumerate(zs):
            p = f["properties"]
            m = zid == i + 1
            p["sub0"] = sub_count
            zgeom = shape(f["geometry"])
            if not m.any():
                p["subs"] = [[p["cx"], p["cy"], 1.0, round(p["area"], 2)]]
                sub_feats.append(sub_feature(sub_count, p["id"], p["name"], zgeom))
                sub_count += 1
                continue
            cx, cy, w = xs[m], ys[m], pops[m]
            dongs = units_by_zone.get(int(p["id"]), [])
            cover = sum(area_km2(g) for _, g in dongs) / max(p["area"], 1e-6)
            if not dongs or cover < MIN_COVERAGE:
                dongs = []
            elif c == "KP":
                dongs = split_large_units(dongs, cx, cy, w, places)
            if len(dongs) == 1:
                dongs = [(p["name"], dongs[0][1])]
            if dongs:
                n_metro += 1
                subs, recs = split_by_dongs(dongs, cx, cy, w, res, sub_count)
                for j, (name, g) in enumerate(dongs):
                    sub_feats.append(sub_feature(sub_count + j, p["id"], name, g))
            else:
                metro = is_metro(p)
                subs, recs, shapes = split_kmeans(p, cx, cy, w, res, sub_count, metro)
                used = set()
                for j, g in enumerate(shapes):
                    name = p["name"] if len(shapes) == 1 else place_name(places, subs[j][0], subs[j][1], used)                         or f"{p['name']} {j + 1}권역"
                    sub_feats.append(sub_feature(sub_count + j, p["id"], name, g))
            p["subs"] = subs
            records.extend(recs)
            sub_count += len(subs)
        log(c, "cells", int((zid > 0).sum()), "pop", round(pops.sum()))

    rec = np.array(records, dtype=np.float32)
    (OUT / "grid.bin").write_bytes(rec.astype("<f4").tobytes())
    # 게임은 존 속성만 받는다 (도형은 data/admin/sgg.geojson과 같은 순서)
    (OUT / "zones.json").write_text(
        json.dumps([f["properties"] for f in fc["features"]], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "subzones.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": sub_feats}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    log("zones split by 읍면동", n_metro, "subzones", sub_count, "records", len(rec))
    # 데이터 버전: 기준 연도 사전 계산(data/baseline.*)이 이 값과 맞아야 쓰인다
    net = json.loads((OUT / "network.meta.json").read_text(encoding="utf-8"))
    import datetime
    meta = {"stamp": datetime.datetime.now().strftime("%Y%m%d%H%M%S"), "zones": len(feats),
            "subzones": sub_count, "links": net["links"], "nodes": net["nodes"]}
    (OUT / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    for f in ("grid.bin", "zones.json", "subzones.geojson"):
        log(f, round((OUT / f).stat().st_size / 1e6, 2), "MB")


def split_by_dongs(dongs, cx, cy, w, res, sub0):
    """격자 인구를 읍면동과 겹치는 면적 비율로 나눈다. 조각마다 겹친 부분의 중심을 좌표로 쓴다."""
    geoms = [g for _, g in dongs]
    tree = shapely.STRtree(geoms)
    pop = np.zeros(len(dongs))
    recs = []
    for x, y, pw in zip(cx, cy, w):
        cell = box(x - res / 2, y - res / 2, x + res / 2, y + res / 2)
        hits = tree.query(cell, predicate="intersects")
        pieces = []
        for k in hits:
            inter = cell.intersection(geoms[k])
            if inter.area > 0:
                pieces.append((k, inter.area, inter.centroid))
        if not pieces:
            pt = shapely.Point(x, y)
            k = int(tree.nearest(pt))
            pieces = [(k, 1.0, pt)]
        tot = sum(a for _, a, _ in pieces)
        for k, a, ctr in pieces:
            share = pw * a / tot
            pop[k] += share
            recs.append((ctr.x, ctr.y, share, sub0 + k))
    total = pop.sum()
    subs = []
    for k, (_, g) in enumerate(dongs):
        rp = g.representative_point()
        # 인구 중심 대신 대표점: 동 단위는 작아서 차이가 작다
        subs.append([round(rp.x, 4), round(rp.y, 4), round(float(pop[k] / total), 5), round(area_km2(g), 2)])
    return subs, recs


def split_large_units(dongs, cx, cy, w, places):
    """북측 구역 가운데 넓거나 인구가 많은 것을 인구 격자의 가중 k-평균으로 나눈다.
    조각 경계는 k-평균 중심의 보로노이 칸을 구역 도형으로 자른 것이고, 이름은 조각 안이나 가까운 마을 이름(없으면 '구역 이름 n')."""
    out = []
    pts = shapely.points(cx, cy)
    for name, g in dongs:
        inside = shapely.contains_xy(g, cx, cy)
        a, pop = area_km2(g), float(w[inside].sum())
        k = int(min(KP_SPLIT_MAX, max(math.ceil(a / KP_SPLIT_AREA), math.ceil(pop / KP_SPLIT_POP))))
        k = min(k, int(inside.sum()))
        if k < 2:
            out.append((name, g))
            continue
        lat = g.centroid.y
        scale = np.array([math.cos(math.radians(lat)), 1.0])
        xy = np.column_stack([cx[inside], cy[inside]])
        centers, _ = weighted_kmeans(xy * scale, np.maximum(w[inside], 1e-3), k)
        centers = centers / scale
        cells = shapely.voronoi_polygons(shapely.MultiPoint([tuple(c) for c in centers]), extend_to=g.envelope.buffer(0.05))
        used = set()
        pieces = []
        for cell in cells.geoms:
            piece = g.intersection(cell)
            if piece.is_empty or piece.area <= 0:
                continue
            piece = piece if piece.geom_type in ("Polygon", "MultiPolygon") else shapely.unary_union(
                [x for x in getattr(piece, "geoms", [piece]) if x.geom_type in ("Polygon", "MultiPolygon")])
            if piece.is_empty:
                continue
            rp = piece.representative_point()
            nm = place_name(places, rp.x, rp.y, used, max_km=3)
            pieces.append((nm if nm and nm != name else None, piece))
        for j, (nm, piece) in enumerate(pieces):
            out.append((nm or f"{name} {j + 1}", piece))
    return out


def place_name(places, x, y, used, max_km=4):
    """소구역 중심에서 가까운 동·마을 이름 (이미 쓴 이름은 피한다)"""
    best, bd = None, max_km
    for name, kind, px, py in places:
        if kind not in ("suburb", "village", "town") or name in used:
            continue
        d = math.hypot((px - x) * math.cos(math.radians(y)), py - y) * KM_PER_DEG
        if d < bd:
            best, bd = name, d
    if best:
        used.add(best)
    return best


def split_kmeans(p, cx, cy, w, res, sub0, metro=False):
    xy = np.column_stack([cx, cy])
    scale = np.array([np.cos(np.radians(p["cy"])), 1.0])
    if metro:
        k = int(np.clip(round(w.sum() / METRO_POP_PER_SUB), 1, METRO_MAX_SUBS))
    else:
        k = int(np.clip(round(w.sum() / POP_PER_SUB), 1, MAX_SUBS))
    k = min(k, len(w))
    if k > 1:
        centers, lab = weighted_kmeans(xy * scale, w, k)
    else:
        centers, lab = np.array([(xy * scale * w[:, None]).sum(0) / w.sum()]), np.zeros(len(w), dtype=int)
    centers = centers / scale
    cell_km2 = (res * KM_PER_DEG) ** 2 * math.cos(math.radians(p["cy"]))
    subs, shapes = [], []
    for j in range(len(centers)):
        mj = lab == j
        share = float(w[mj].sum() / w.sum())
        subs.append([round(float(centers[j][0]), 4), round(float(centers[j][1]), 4), round(share, 5),
                     round(float(mj.sum() * cell_km2), 2)])
        sq = [box(x - res / 2, y - res / 2, x + res / 2, y + res / 2) for x, y in zip(cx[mj], cy[mj])]
        shapes.append(unary_union(sq) if sq else shapely.Point(centers[j]).buffer(0.01))
    recs = [(x, y, pw, sub0 + j) for x, y, pw, j in zip(cx, cy, w, lab)]
    return subs, recs, shapes


def sub_feature(sid, zone, name, geom):
    g = shapely.set_precision(geom.simplify(0.001, preserve_topology=True), 0.0005)
    return {"type": "Feature", "id": sid, "properties": {"id": sid, "zone": zone, "name": name},
            "geometry": mapping(g)}


if __name__ == "__main__":
    main()

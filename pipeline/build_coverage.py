"""행정 경계를 한 장의 도형(커버리지)에서 만든다: 읍면동 경계선·시군구 면·시도 면·게임 소구역이 서로 정확히 맞물린다.

예전에는 읍면동(약 80m), 시군구(약 200m), 시도(약 400m), 게임 소구역(약 70m)을 따로 단순화해서
지도에서 시군구 색칠 경계와 읍면동 선, 소구역 면이 수십~수백 m씩 어긋났다. 여기서는
  1) 읍면동(admin_master.pkl)을 시군구(존) 원래 경계 안으로 자르고 빈 곳을 메워 빈틈없는 한 장으로 만든 뒤
     한꺼번에 단순화한다 (맞닿은 변을 함께 고쳐 틈이 생기지 않는다)
  2) 시군구 = 그 존 읍면동의 합, 시도 = 그 도 시군구의 합 (변이 그대로 같다)
  3) 게임 소구역(subzones.geojson): 읍면동 이름이 같으면 그 읍면동 도형, 아니면(격자 묶음 등) 존 안을 나눠 갖되
     존 바깥 경계는 건드리지 않고 단순화한다
소구역 번호·이름·속성과 시군구 속성은 그대로라 기준 연도 계산(data/baseline.*)은 그대로 쓴다.
끝나면 build_borders.py를 다시 돌려 data/admin/edges.geojson을 새로 만든다.

  .venv/Scripts/python -X utf8 pipeline/build_coverage.py
  (build_admin.py --kp-only 뒤에는 build_coverage.py --kp-only: 시군구·시도 경계와 남측 읍면동은 그대로 두고 북측만 맞춘다)
  .venv/Scripts/python -X utf8 pipeline/build_borders.py
"""
from __future__ import annotations

import json
import pickle
from collections import defaultdict
from pathlib import Path

import shapely
from shapely import wkb
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
ADMIN = ROOT / "data" / "admin"
SUBS = ROOT / "data" / "subzones.geojson"
TOL = 0.0008          # 약 80m (예전 읍면동 경계와 같다)
GRID = 0.00001        # 좌표 격자 (약 1m)


def polys(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) for p in polys(p)] if g.geom_type in ("MultiPolygon", "GeometryCollection") else []


def clean(g):
    g = shapely.make_valid(g)
    ps = polys(g)
    return unary_union(ps) if ps else shapely.Polygon()


def partition(pieces, domain):
    """조각들을 domain 안으로 자르고 서로 겹치지 않게(앞이 먼저) 한 뒤, 빈 곳을 가장 길게 맞닿은 조각에 붙인다"""
    out, taken = [], None
    for g in pieces:
        g = clean(g.intersection(domain))
        if taken is not None and not g.is_empty:
            g = clean(g.difference(taken))
        out.append(g)
        if not g.is_empty:
            taken = g if taken is None else taken.union(g)
    if taken is None:
        return out
    for piece in polys(domain.difference(taken)):
        if piece.area < 1e-12:
            continue
        ring = piece.buffer(2e-5)
        best = max(range(len(out)), key=lambda k: ring.intersection(out[k]).area if not out[k].is_empty else -1)
        if out[best].is_empty or ring.intersection(out[best]).area <= 0:
            best = min(range(len(out)), key=lambda k: out[k].distance(piece) if not out[k].is_empty else 1e9)
        out[best] = clean(out[best].union(piece))
    return out


def merge(gs):
    """맞물린 조각의 합 (커버리지 합이 안 되면 일반 합)"""
    try:
        return clean(shapely.coverage_union_all(gs))
    except shapely.errors.GEOSException:
        return clean(unary_union(gs))


def snap(gs):
    return [clean(shapely.set_precision(g, GRID)) if not g.is_empty else g for g in gs]


def kp_only_units(master, sgg):
    """--kp-only: 시군구 경계(sgg.geojson)와 남측 읍면동 도형은 그대로 두고, 북측 읍면동만 각 시군구 경계 안에 맞춰 단순화한다.
    존 바깥 경계는 단순화하지 않아(simplify_boundary=False) 남측·이웃 시군과 맞물린 선이 그대로다"""
    zone_simple = {int(f["properties"]["id"]): clean(shape(f["geometry"])) for f in sgg["features"]}
    unit_geom = {}
    index = json.loads((ADMIN / "units" / "index.json").read_text(encoding="utf-8"))
    for e in index:
        if e["country"] == "KR":
            for f in json.loads((ADMIN / "units" / e["file"]).read_text(encoding="utf-8"))["features"]:
                unit_geom[f["properties"]["id"]] = shape(f["geometry"])
    by_zone = defaultdict(list)
    for u in master["units"]:
        if u["country"] == "KP":
            by_zone[int(u["zone_id"])].append(u)
    for zid, us in by_zone.items():
        Z = zone_simple[zid]
        parts = partition([wkb.loads(u["geom"]) for u in us], Z)
        keep = [k for k, g in enumerate(parts) if not g.is_empty]
        simp = list(shapely.coverage_simplify(snap([parts[k] for k in keep]), TOL, simplify_boundary=False))
        for k, g in zip(keep, simp):
            unit_geom[us[k]["id"]] = clean(g)
    print("kp-only: KP units", sum(len(v) for v in by_zone.values()), "in", len(by_zone), "zones")
    return zone_simple, unit_geom


def main(kp_only=False):
    master = pickle.load((RAW / "admin_master.pkl").open("rb"))
    sgg = json.loads((ADMIN / "sgg.geojson").read_text(encoding="utf-8"))
    sido = json.loads((ADMIN / "sido.geojson").read_text(encoding="utf-8"))
    units = master["units"]
    if kp_only:
        zone_simple, unit_geom = kp_only_units(master, sgg)
    else:
        zone_simple, unit_geom = rebuild_all(master, sgg, sido)
    write_units_and_subs(units, zone_simple, unit_geom)


def rebuild_all(master, sgg, sido):
    zones_raw = {int(f["properties"]["id"]): clean(shape(f["geometry"]))
                 for f in json.loads((RAW / "zones.geojson").read_text(encoding="utf-8"))["features"]}
    units = master["units"]
    by_zone = defaultdict(list)
    for u in units:
        by_zone[int(u["zone_id"])].append(u)

    # 1) 존(시군구) 원래 경계를 서로 겹치지 않게
    zone_ids = [f["properties"]["id"] for f in sgg["features"]]
    claimed, zgeom = None, {}
    for zid in zone_ids:
        Z = zones_raw.get(zid)
        if Z is None:
            Z = clean(shape(next(f for f in sgg["features"] if f["properties"]["id"] == zid)["geometry"]))
        if claimed is not None:
            Z = clean(Z.difference(claimed))
        zgeom[zid] = Z
        claimed = Z if claimed is None else claimed.union(Z)

    # 1-2) 시군구 사이에 낀 작은 빈 구멍(1km² 미만: 군사분계선을 따라 남북 시군 경계가 덜 맞물린 곳 등)은 가장 길게 맞닿은 시군구에 붙인다
    allz = unary_union(list(zgeom.values()))
    holes = [shapely.Polygon(r) for g in polys(allz) for r in g.interiors]
    filled = 0
    for h in holes:
        if h.area * 111 * 88 > 1.0:
            continue
        ring = h.buffer(2e-5)
        best = max(zgeom, key=lambda z: ring.intersection(zgeom[z]).area if zgeom[z].intersects(ring) else 0)
        zgeom[best] = clean(zgeom[best].union(h.buffer(1e-6)))
        filled += 1
    print("filled", filled, "small holes between zones")

    # 2) 읍면동 커버리지: 존마다 읍면동을 존 안에 맞추고, 읍면동이 없는 존은 존 하나를 한 조각으로
    pieces, owner = [], []          # owner: ("unit", unit id) 또는 ("zone", zid)
    for zid in zone_ids:
        us = by_zone.get(zid, [])
        if us:
            parts = partition([wkb.loads(u["geom"]) for u in us], zgeom[zid])
            for u, g in zip(us, parts):
                pieces.append(g); owner.append(("unit", u["id"], zid))
        else:
            pieces.append(zgeom[zid]); owner.append(("zone", None, zid))
    keep = [k for k, g in enumerate(pieces) if not g.is_empty]
    simp = list(shapely.coverage_simplify(snap([pieces[k] for k in keep]), TOL))
    simple = [shapely.Polygon()] * len(pieces)
    for k, g in zip(keep, simp):
        simple[k] = clean(g)
    print("units coverage", len(keep), "pieces")

    # 3) 시군구 = 읍면동의 합, 시도 = 시군구의 합
    zone_parts = defaultdict(list)
    unit_geom = {}
    for (kind, uid, zid), g in zip(owner, simple):
        if g.is_empty:
            continue
        zone_parts[zid].append(g)
        if kind == "unit":
            unit_geom[uid] = g
    zone_simple = {zid: merge(gs) for zid, gs in zone_parts.items()}
    for f in sgg["features"]:
        g = zone_simple.get(f["properties"]["id"])
        if g is not None and not g.is_empty:
            f["geometry"] = mapping(g)
    prov = defaultdict(list)
    for f in sgg["features"]:
        g = zone_simple.get(f["properties"]["id"])
        if g is not None:
            prov[(f["properties"]["country"], f["properties"]["province"])].append(g)
    for f in sido["features"]:
        gs = prov.get((f["properties"]["country"], f["properties"]["name"]))
        if gs:
            f["geometry"] = mapping(merge(gs))
    (ADMIN / "sgg.geojson").write_text(json.dumps(sgg, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (ADMIN / "sido.geojson").write_text(json.dumps(sido, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("sgg", round((ADMIN / "sgg.geojson").stat().st_size / 1e6, 2), "MB, sido", round((ADMIN / "sido.geojson").stat().st_size / 1e6, 2), "MB")
    return zone_simple, unit_geom


def write_units_and_subs(units, zone_simple, unit_geom):
    # 4) 읍면동 경계 파일(시도별)
    index = json.loads((ADMIN / "units" / "index.json").read_text(encoding="utf-8"))
    for e in index:
        p = ADMIN / "units" / e["file"]
        fc = json.loads(p.read_text(encoding="utf-8"))
        for f in fc["features"]:
            g = unit_geom.get(f["properties"]["id"])
            if g is not None:
                f["geometry"] = mapping(g)
        p.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # 5) 게임 소구역: 읍면동 이름이 하나로 맞으면 그 도형, 아니면 존 안 나머지를 나눠 갖는다 (존 바깥 경계는 그대로)
    subs = json.loads(SUBS.read_text(encoding="utf-8"))
    sub_by_zone = defaultdict(list)
    for k, f in enumerate(subs["features"]):
        sub_by_zone[int(f["properties"]["zone"])].append(k)
    unit_by_name = defaultdict(list)
    for u in units:
        if u["id"] in unit_geom:
            unit_by_name[(int(u["zone_id"]), u["name"])].append(u["id"])
    exact = 0
    for zid, ks in sub_by_zone.items():
        Z = zone_simple.get(zid)
        if Z is None or Z.is_empty:
            continue
        names = defaultdict(int)
        for k in ks:
            names[subs["features"][k]["properties"]["name"]] += 1
        fixed, rest = {}, []
        for k in ks:
            nm = subs["features"][k]["properties"]["name"]
            ids = unit_by_name.get((zid, nm), [])
            if len(ids) == 1 and names[nm] == 1:
                fixed[k] = unit_geom[ids[0]]
            else:
                rest.append(k)
        if len(ks) == 1:
            fixed, rest = {ks[0]: Z}, []
        if rest:
            used = unary_union(list(fixed.values())) if fixed else None
            room = clean(Z.difference(used)) if used is not None else Z
            parts = partition([clean(shape(subs["features"][k]["geometry"])) for k in rest], room) if not room.is_empty else []
            # 나머지 조각은 이미 단순화된 읍면동·존 경계를 그대로 따라 잘렸으므로 다시 단순화하지 않는다
            for k, g in zip(rest, parts):
                if not g.is_empty:
                    subs["features"][k]["geometry"] = mapping(g)
        for k, g in fixed.items():
            subs["features"][k]["geometry"] = mapping(g)
            exact += 1
    SUBS.write_text(json.dumps(subs, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("subzones", len(subs["features"]), "exact units", exact, round(SUBS.stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    import sys
    main(kp_only="--kp-only" in sys.argv[1:])

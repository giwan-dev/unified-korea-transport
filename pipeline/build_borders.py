"""시군구 경계선 조각: 이웃한 두 시군구가 맞닿은 선마다 하나 (a, b = 두 존 id, 바다·국경 쪽은 b = -1).

게임이 행정구역을 바꾸면(북측 1945년 이전 도 복원, 광역시 승격 등) 소속 광역 단체가 다른 두 존 사이의 선만
골라 도 경계로 그린다. 고정된 시도 경계(sido.geojson)를 쓰면 없어진 자강도·량강도 경계가 계속 남는다.

  - 읽음: data/admin/sgg.geojson (build_admin.py)
  - 씀:   data/admin/edges.geojson
"""
import json
import sys
from pathlib import Path

import shapely
from shapely.geometry import mapping, shape
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parent.parent
ADMIN = ROOT / "data" / "admin"


def lines_of(g):
    if g.is_empty:
        return None
    parts = [p for p in getattr(g, "geoms", [g]) if p.geom_type in ("LineString", "MultiLineString")]
    if not parts:
        return None
    u = unary_union(parts)
    m = linemerge(u) if u.geom_type == "MultiLineString" else u
    return m if not m.is_empty else None


def main():
    sgg = json.loads((ADMIN / "sgg.geojson").read_text(encoding="utf-8"))["features"]
    ids = [f["properties"]["id"] for f in sgg]
    geoms = [shapely.make_valid(shape(f["geometry"])) for f in sgg]
    bounds = [g.boundary for g in geoms]
    tree = shapely.STRtree(geoms)
    feats, shared = [], [[] for _ in sgg]
    for i, g in enumerate(geoms):
        for j in tree.query(g):
            j = int(j)
            if j <= i:
                continue
            ln = lines_of(bounds[i].intersection(bounds[j]))
            if ln is None:
                continue
            feats.append((ids[i], ids[j], ln))
            shared[i].append(ln); shared[j].append(ln)
    for i, b in enumerate(bounds):
        rest = b.difference(unary_union(shared[i]).buffer(1e-6)) if shared[i] else b
        ln = lines_of(rest)
        if ln is not None and ln.length > 0.002:
            feats.append((ids[i], -1, ln))
    out = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": k, "properties": {"i": k, "a": a, "b": b},
         "geometry": mapping(shapely.set_precision(ln, 0.0005))} for k, (a, b, ln) in enumerate(feats)]}
    path = ADMIN / "edges.geojson"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("edges", len(feats), round(path.stat().st_size / 1e3), "KB", file=sys.stderr)


if __name__ == "__main__":
    main()

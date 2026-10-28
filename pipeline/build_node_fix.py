"""본선이 엉뚱한 노드를 지나며 꺾이는 곳(dogleg)을 고칠 노드 자리: 고속도로 본선이 지나는 노드 가운데 실제 그 고속도로(OSM)에서
150m 넘게 떨어진 것은 그 고속도로 위 가장 가까운 자리로 옮긴다.

예: 경부고속도로가 금토분기점에서 용인서울고속도로 쪽 분기점 노드(OSM에 금토분기점이 둘)를 지나 850m쯤 서쪽으로 꺾였다.
네트워크를 처음부터 다시 만들지 않고, 게임이 불러올 때 이 자리로 노드를 옮기고 그 노드에 닿는 구간 끝을 맞춘다(js/data/netfix.js).

  - 읽음: data/network.*, data/raw/south-korea.osm.pbf, data/raw/north-korea.osm.pbf
  - 씀:   data/node_fix.json  {"노드 번호": [경도, 위도], ...}
"""
import collections
import json
import math
import sys
from pathlib import Path

import osmium
import shapely
from shapely.geometry import LineString, Point
import shapely.ops
from shapely.ops import nearest_points

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))
import netread  # noqa: E402

km = lambda a, b: math.hypot((a[0] - b[0]) * 88.6, (a[1] - b[1]) * 111)


class Ways(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.by = collections.defaultdict(list)

    def way(self, w):
        if w.tags.get("highway") not in ("motorway", "trunk"):
            return
        nm = w.tags.get("name:ko") or w.tags.get("name")
        if not nm:
            return
        try:
            pts = [(n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(pts) >= 2:
            self.by[nm].append(LineString(pts))


def main():
    nodes, links, meta = netread.read()
    h = Ways()
    for f in ("south-korea.osm.pbf", "north-korea.osm.pbf"):
        h.apply_file(f"data/raw/{f}", locations=True)   # 한글이 든 절대 경로는 osmium이 못 연다: 저장소 폴더에서 상대 경로로
    trees = {nm: (shapely.STRtree(ls), ls) for nm, ls in h.by.items()}
    inc = collections.defaultdict(list)
    for i, l in enumerate(links):
        if l["open"]:
            continue
        inc[l["a"]].append(i)
        inc[l["b"]].append(i)
    fix = {}
    for n, ids in inc.items():
        names = collections.defaultdict(set)
        for i in ids:
            l = links[i]
            if l["mode"] == 0 and l["cls"] == "motorway" and l["name"]:
                names[l["name"]].add(l["b"] if l["a"] == n else l["a"])
        # 본선 셋 이상이 지나는 노드(조남: 서해안·수도권제1순환·수원문산)는 한 본선 위로 옮기면 다른 본선이 꺾인다:
        # 지나는 본선 둘이 실제로 엇갈리는 자리 가운데 노드에서 가장 가까운 곳(1km 안)으로
        p = Point(nodes[n][0], nodes[n][1])
        thru = [nm for nm, far in names.items() if len(far) == 2 and nm in trees]
        if len(thru) >= 3:
            best = None
            for x in range(len(thru)):
                for y in range(x + 1, len(thru)):
                    ga = shapely.union_all(trees[thru[x]][1]).intersection(shapely.union_all(trees[thru[y]][1]))
                    for q in getattr(ga, "geoms", [ga]):
                        if q.is_empty or q.geom_type != "Point":
                            continue
                        d = km((p.x, p.y), (q.x, q.y))
                        if best is None or d < best[0]:
                            best = (d, q, f"{thru[x]}×{thru[y]}")
            if best and best[0] < 1.0:
                if best[0] > 0.03:
                    fix[str(n)] = [round(best[1].x, 6), round(best[1].y, 6)]
                    print(best[2], n, round(best[0], 2), file=sys.stderr)
                continue
        # 본선 둘이 만나는 분기점에서는 노드가 한 본선 위에만 있을 수 있다(금토: 용인서울 위, 경부에서 700m): 가장 멀리 벗어난 본선 위로 옮긴다
        worst = None
        for nm, far in names.items():
            if len(far) != 2 or nm not in trees:   # 본선이 지나가는 노드만 (끝점·갈래는 빼고)
                continue
            tree, ls = trees[nm]
            p = Point(nodes[n][0], nodes[n][1])
            k = tree.nearest(p)
            q = nearest_points(ls[int(k)], p)[0]
            d = km((p.x, p.y), (q.x, q.y))
            if worst is None or d > worst[0]:
                worst = (d, nm, q)
        if worst and 0.15 < worst[0] < 2.0:
            d, nm, q = worst
            fix[str(n)] = [round(q.x, 6), round(q.y, 6)]
            print(nm, n, round(d, 2), file=sys.stderr)
    # 두 고속도로가 엇갈리는 분기점인데 계산망이 한 고속도로를 다른 고속도로 위로 2km 넘게 끌고 간 곳 (안산분기점: 서해안이 영동 위를 따라감):
    # 노드를 실제 교차점으로 옮기고 구간 끝을 바꿔 잇는다. 새 노드는 만들지 않는다 (저장 게임의 새 노드 번호가 밀리지 않게)
    REWIRE = [
        {"node": 3860, "cross": ("서해안고속도로", "영동고속도로"), "keep": [1018],
         # 구간: (원래 끝 둘, 새 끝 둘, 따라 그릴 고속도로, 새 이름)
         "links": {3086: ((3860, 1018), (3860, 1053), "영동고속도로", None),
                   834: ((1018, 1053), (1018, 1053), None, "안산분기점 연결로")}},
    ]
    rewire = {}
    merged = lambda nm: shapely.line_merge(shapely.union_all(trees[nm][1]))
    for r in REWIRE:
        p = Point(*nodes[r["node"]])
        x = merged(r["cross"][0]).intersection(merged(r["cross"][1]))
        q = min(getattr(x, "geoms", [x]), key=lambda g: g.distance(p))
        fix[str(r["node"])] = [round(q.x, 6), round(q.y, 6)]
        for k in r["keep"]:
            fix.pop(str(k), None)
        for lid, (old, new, road, name) in r["links"].items():
            pa, pb = fix.get(str(new[0])) or list(nodes[new[0]]), fix.get(str(new[1])) or list(nodes[new[1]])
            pts = [tuple(pa), tuple(pb)]
            if road:
                ln = merged(road)
                seg = min(getattr(ln, "geoms", [ln]), key=lambda g: g.distance(Point(*pa)) + g.distance(Point(*pb)))
                sa, sb = seg.project(Point(*pa)), seg.project(Point(*pb))
                sub = list(shapely.ops.substring(seg, min(sa, sb), max(sa, sb)).coords)
                pts = [tuple(pa)] + (sub[::-1] if sa > sb else sub) + [tuple(pb)]
            rewire[str(lid)] = {"from": list(old), "a": new[0], "b": new[1], "geom": [round(float(v), 6) for xy in pts for v in xy], **({"name": name} if name else {})}
            print("rewire", lid, new, name or road, file=sys.stderr)
    (ROOT / "data" / "node_fix.json").write_text(json.dumps(fix, separators=(",", ":")), encoding="utf-8")
    print("fixed nodes", len(fix), file=sys.stderr)

    # 서로 다른 고속도로가 같은 두 노드 사이 구간을 함께 쓰는 곳(안산분기점 둘레 영동·서해안, 조남 북쪽 서해안·수원문산):
    # 계산망은 그대로 두고, 구간마다 제 이름 고속도로(OSM) 선형을 따라 그린다 (두 길이 한 줄로 합쳐져 보이던 것)
    pos = lambda n: fix.get(str(n)) or [float(nodes[n][0]), float(nodes[n][1])]
    pair = collections.defaultdict(list)
    for i, l in enumerate(links):
        if l["mode"] == 0 and l["cls"] == "motorway" and l["name"] and not l["open"]:
            pair[tuple(sorted((l["a"], l["b"])))].append(i)
    geom = {}
    for (a, b), ids in pair.items():
        if len({links[i]["name"] for i in ids}) < 2:
            continue
        for i in ids:
            l = links[i]
            if l["name"] not in trees or not l["name"].endswith("고속도로"):
                continue
            line = shapely.line_merge(shapely.union_all(trees[l["name"]][1]))
            pa, pb = Point(*pos(l["a"])), Point(*pos(l["b"]))
            parts = list(getattr(line, "geoms", [line]))
            seg = min(parts, key=lambda g: g.distance(pa) + g.distance(pb))
            # 실제로 함께 달리는 구간(중부·제2중부 등)은 그대로: 지금 그린 선 가운데가 제 고속도로에서 150m 넘게 벗어난 곳만,
            # 양 끝은 그 고속도로에서 400m 안이어야 한다
            g = [tuple(q) for q in l["geom"] if q[0] == q[0]]
            if len(g) < 2:
                continue
            mid = LineString(g).interpolate(0.5, normalized=True)
            mq = nearest_points(seg, mid)[0]
            if km((mid.x, mid.y), (mq.x, mq.y)) < 0.15:
                continue
            ea, eb = nearest_points(seg, pa)[0], nearest_points(seg, pb)[0]
            if km((pa.x, pa.y), (ea.x, ea.y)) > 0.4 or km((pb.x, pb.y), (eb.x, eb.y)) > 0.4:
                continue
            sa, sb = seg.project(pa), seg.project(pb)
            if abs(sa - sb) < 1e-6:
                continue
            sub = shapely.ops.substring(seg, min(sa, sb), max(sa, sb))
            if sub.length * 100 > 1.8 * max(l["len"], 0.3):   # 엉뚱한 갈래로 돌아가는 선형은 쓰지 않는다
                continue
            pts = list(sub.coords)
            if sa > sb:
                pts.reverse()
            pts = [tuple(pos(l["a"]))] + pts + [tuple(pos(l["b"]))]
            geom[str(i)] = [round(v, 6) for xy in pts for v in xy]
            print("geom", l["name"], i, len(pts), file=sys.stderr)
    (ROOT / "data" / "road_geom_fix.json").write_text(json.dumps({"geom": geom, "rewire": rewire}, separators=(",", ":")), encoding="utf-8")
    print("shared segments redrawn", len(geom), file=sys.stderr)


if __name__ == "__main__":
    main()

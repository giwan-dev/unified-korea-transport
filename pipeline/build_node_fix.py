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
    (ROOT / "data" / "node_fix.json").write_text(json.dumps(fix, separators=(",", ":")), encoding="utf-8")
    print("fixed nodes", len(fix), file=sys.stderr)


if __name__ == "__main__":
    main()

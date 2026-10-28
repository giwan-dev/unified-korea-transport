"""북측 면 묶음(data/kp_myeon.json)의 월경지 일괄 조정: 한 면에 든 리 가운데 그 면의 가장 큰 덩어리와 떨어진 조각은
같은 시군 안에서 가장 길게 맞닿은 이웃 면으로 옮긴다 (1945년 이름 맞추기·다수결로 묶다 보니 떨어진 리가 남았다).
섬처럼 같은 시군의 어느 면과도 맞닿지 않은 조각은 그대로 둔다.

  - 읽음: data/kp_myeon.json, data/zones.json, data/subzones.geojson
  - 씀:   data/kp_myeon.json (subs 고침, stats.exclaves_moved)
"""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    M = json.loads((ROOT / "data/kp_myeon.json").read_text(encoding="utf-8"))
    zones = json.loads((ROOT / "data/zones.json").read_text(encoding="utf-8"))
    feats = json.loads((ROOT / "data/subzones.geojson").read_text(encoding="utf-8"))["features"]
    subs = {int(k): v for k, v in M["subs"].items()}
    county = {}
    for z in zones:
        key = (z["province"], z["name"].split(" ")[0])
        for k in range(len(z["subs"])):
            county[z["sub0"] + k] = key
    # 맞닿음: 경계 꼭짓점을 둘 넘게 같이 쓰면 이웃, 같이 쓰는 꼭짓점 수를 맞닿은 길이로 본다
    own = collections.defaultdict(set)
    for i in subs:
        g = feats[i]["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
        for poly in polys:
            for ring in poly:
                for q in ring:
                    own[(round(q[0], 5), round(q[1], 5))].add(i)
    share = collections.Counter()
    for s in own.values():
        if len(s) < 2:
            continue
        a = sorted(s)
        for x in range(len(a)):
            for y in range(x + 1, len(a)):
                share[(a[x], a[y])] += 1
    adj = collections.defaultdict(dict)
    for (a, b), c in share.items():
        if c >= 2:
            adj[a][b] = c
            adj[b][a] = c
    moved = 0
    for _ in range(10):
        groups = collections.defaultdict(set)
        for i, m in subs.items():
            groups[(county[i], m)].add(i)
        any_moved = False
        for (ck, m), members in groups.items():
            seen, comps = set(), []
            for i in members:
                if i in seen:
                    continue
                comp, stack = [], [i]
                seen.add(i)
                while stack:
                    u = stack.pop()
                    comp.append(u)
                    for v in adj[u]:
                        if v in members and v not in seen:
                            seen.add(v)
                            stack.append(v)
                comps.append(comp)
            if len(comps) < 2:
                continue
            comps.sort(key=len, reverse=True)
            for comp in comps[1:]:
                votes = collections.Counter()
                for u in comp:
                    for v, c in adj[u].items():
                        if v in subs and county.get(v) == ck and subs[v] != m:
                            votes[subs[v]] += c
                if not votes:
                    continue
                to = votes.most_common(1)[0][0]
                for u in comp:
                    subs[u] = to
                moved += len(comp)
                any_moved = True
        if not any_moved:
            break
    M["subs"] = {str(k): v for k, v in sorted(subs.items())}
    M["stats"]["exclaves_moved"] = moved
    (ROOT / "data/kp_myeon.json").write_text(json.dumps(M, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("moved", moved)


if __name__ == "__main__":
    main()

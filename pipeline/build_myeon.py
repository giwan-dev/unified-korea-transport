"""북측 리·동을 1945년(분단 직전) 면에 묶는다: 군에서는 읍·면 단위로, 시에서는 고른 읍·면만 동으로 보이게 하는 데 쓴다.

북측은 1952년 군면리 대폐합으로 면을 없앴지만, 지금 리 이름의 상당수가 옛 리 이름을 잇는다. 국사편찬위원회 역사지리정보DB의
'행정구역 데이터 (1910~1945년)'(공공누리 제1유형, 출처표시)에서 1945년 8월 14일 기준 도-부군-읍면-동리를 읽고,
지금 리 이름을 그 시군·이웃 시군 이름의 옛 부군 안 동리 이름과 맞춘다(두음법칙 차이는 무시: 룡천리 = 용천리).
맞지 않는 리(새 이름, 시내 동)는 맞닿은 리 가운데 가장 많이 맞닿은 리의 면을 따른다(같은 시군 안).

  - 읽음: data/raw/hgis_1945/19100510-19450814역사적행정구역.txt, data/zones.json, data/subzones.geojson, data/admin/edges.geojson
  - 씀:   data/kp_myeon.json  {"source": ..., "subs": {"읍면동 번호": "○○면"}, "stats": {...}}
"""
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SRC = DATA / "raw" / "hgis_1945" / "19100510-19450814역사적행정구역.txt"
SOUTH_ONLY = {"강화", "김포", "파주", "고양"}
NORTH = ("황해도", "평안남도", "평안북도", "함경남도", "함경북도", "강원도", "경기도")


def dueum(name):
    """local.js dueum과 같은 규칙: 첫 음절의 ㄹ·ㄴ을 남측 표기로"""
    if not name:
        return name
    c = ord(name[0]) - 0xAC00
    if c < 0 or c >= 11172:
        return name
    L, V, T = c // 588, (c % 588) // 28, c % 28
    iy = V in (2, 6, 7, 12, 17, 20)
    nl = L
    if L == 5:
        nl = 11 if iy else 2
    elif L == 2 and iy and V != 2:
        nl = 11
    return chr(0xAC00 + nl * 588 + V * 28 + T) + name[1:] if nl != L else name


def norm(n):
    return dueum(n.strip())


def ri_stem(n):
    """리·동 이름 줄기: 1945년 평안북도는 마을을 ○○동으로 불러(도령동) 지금 ○○리와 끝이 다르다"""
    return re.sub(r"(로동자구|노동자구|동|리|읍|면)$", "", norm(n)) or norm(n)


def stem(n):
    for suf in ("특별시", "광역시", "직할시", "구역", "군", "부", "시", "구"):
        if n.endswith(suf) and len(n) > len(suf):
            return n[: -len(suf)]
    return n


def load_1945():
    """1945-08-14에 있던 읍면·동리: {옛 부군 줄기: {동리 이름(두음 정규화): [(도, 읍면)]}}, 부군 줄기 → 도"""
    rows, hdr = [], None
    with SRC.open(encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if p[0] == "id":
                hdr = p
                continue
            if hdr and len(p) >= 12 and p[0].isdigit():
                r = dict(zip(hdr, p))
                if r["end"] == "19450814" and r["lv"] == "4":
                    rows.append(r)
    by_gun = collections.defaultdict(lambda: collections.defaultdict(list))
    for r in rows:
        parts = r["fullname"].split("/")
        if len(parts) < 4 or parts[0] not in NORTH:
            continue
        do, gun, myeon, ri = parts[:4]
        by_gun[stem(dueum(gun))][ri_stem(ri)].append((do, myeon))
    return by_gun


def sub_adjacency(feats, idxs):
    own = collections.defaultdict(set)
    for i in idxs:
        g = feats[i]["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
        for poly in polys:
            for ring in poly:
                for q in ring:
                    own[(round(q[0], 5), round(q[1], 5))].add(i)
    cnt = collections.Counter()
    for s in own.values():
        s = sorted(s)
        for a in range(len(s)):
            for b in range(a + 1, len(s)):
                cnt[(s[a], s[b])] += 1
    adj = collections.defaultdict(collections.Counter)
    for (a, b), c in cnt.items():
        if c >= 2:
            adj[a][b] += c
            adj[b][a] += c
    return adj


def main():
    zones = json.loads((DATA / "zones.json").read_text(encoding="utf-8"))
    feats = json.loads((DATA / "subzones.geojson").read_text(encoding="utf-8"))["features"]
    edges = json.loads((DATA / "admin" / "edges.geojson").read_text(encoding="utf-8"))["features"]
    nb = collections.defaultdict(set)
    for f in edges:
        a, b = f["properties"]["a"], f["properties"]["b"]
        if b >= 0 and not f["properties"].get("w"):
            nb[a].add(b)
            nb[b].add(a)
    old = load_1945()
    out, single, gun, stats = {}, {}, {}, collections.Counter()
    for zi, z in enumerate(zones):
        if z.get("ext") or z["country"] != "KP":
            continue
        idxs = [z["sub0"] + k for k in range(len(z["subs"]))]
        # 이 시군·옛 군(hist)·이웃 시군 이름의 옛 부군 (가까운 쪽부터)
        # 1952년에 새로 생긴 군(피현군 등)은 옛 군이 이웃의 이웃일 수 있어 두 겹까지 (두음법칙도: 룡천 = 용천)
        # 이웃의 이웃은 북측 존을 거친 것만 (남측 파주를 거쳐 강화까지 닿아, 판문구역 리가 강화군 송해면으로 묶였다)
        ring2 = sorted({k for j in nb[zi] if zones[j]["country"] == "KP" for k in nb[j] if zones[k]["country"] == "KP"} - nb[zi] - {zi})
        cands = [stem(dueum(z["name"]))] + ([stem(dueum(z["hist"]))] if z.get("hist") else [])             + [stem(dueum(zones[j]["name"])) for j in sorted(nb[zi])] + [stem(dueum(zones[j]["name"])) for j in ring2]
        # 1945년에도 모두 남측 땅이던 군(강화·김포·파주·고양)은 북측 리의 옛 군이 될 수 없다 (한강 하구 건너 이웃이라 강화 송해면·김포 월곶면으로 잘못 묶였다)
        cands = [c for c in dict.fromkeys(cands) if c in old and c not in SOUTH_ONLY]
        got, hits = {}, {}
        for i in idxs:
            raw = feats[i]["properties"].get("name", "")
            if not re.search(r"(리|동|읍|로동자구|노동자구)$", raw):
                continue
            nm = ri_stem(raw)
            opts = [(k, c, m) for k, c in enumerate(cands) for _, m in old[c].get(nm, [])]
            if opts:
                hits[i] = opts
        # 같은 이름 리가 여러 옛 군·면에 있으면, 이 시군의 다른 리도 많이 맞는 면으로 (우연히 이름만 같은 먼 면을 고르지 않게).
        # 비기면 이 시군 이름의 옛 군 → 이웃 → 이웃의 이웃 순
        votes = collections.Counter((c, m) for opts in hits.values() for (c, m) in {(c, m) for _, c, m in opts})
        for i, opts in hits.items():
            k, c, m = max(opts, key=lambda o: (votes[(o[1], o[2])], -o[0]))
            got[i] = (c, m)
            stats["matched"] += 1
        if not got:
            stats["zones_without_match"] += 1
            continue
        # 맞지 않은 리·동: 맞닿은 리의 면을 따른다 (가장 많이 맞닿은 쪽, 같은 시군 안), 바뀌지 않을 때까지
        adj = sub_adjacency(feats, idxs)
        for _ in range(50):
            changed = False
            for i in idxs:
                if i in got:
                    continue
                votes = collections.Counter()
                for j, c in adj[i].items():
                    if j in got:
                        votes[got[j]] += c
                if votes:
                    got[i] = votes.most_common(1)[0][0]
                    stats["spread"] += 1
                    changed = True
            if not changed:
                break
        # 리 하나뿐인 면(1952년에 이웃 군에서 넘어온 옛 리 등): 지금 행정구역을 따르면 가장 길게 맞닿은 이웃 면으로 묶는다
        # (옛 면 이름은 single에 남겨 두어, 1945년 행정구역을 되살릴 때 옛 군으로 보낼 수 있게)
        for _ in range(3):
            cnt = collections.Counter(got[i] for i in idxs if i in got)
            singles = [i for i in idxs if i in got and cnt[got[i]] == 1]
            if not singles or len(cnt) <= 1:
                break
            for i in singles:
                votes = collections.Counter()
                for j, c in adj[i].items():
                    if j in got and got[j] != got[i] and cnt[got[j]] > 1:
                        votes[got[j]] += c
                if votes:
                    single[str(i)] = got[i][1]
                    got[i] = votes.most_common(1)[0][0]
                    stats["single_merged"] += 1
        for i in idxs:
            if i in got:
                out[str(i)] = got[i][1]
                gun[str(i)] = got[i][0]
            else:
                stats["left"] += 1
        stats["zones"] += 1
    res = {"source": "국사편찬위원회 역사지리정보DB 행정구역 데이터(1910~1945년), 1945-08-14 기준 (공공누리 제1유형)",
           "subs": out, "gun": gun, "single": single, "stats": dict(stats)}
    (DATA / "kp_myeon.json").write_text(json.dumps(res, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(dict(stats), ensure_ascii=False), len(out), file=sys.stderr)


if __name__ == "__main__":
    main()

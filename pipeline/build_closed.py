"""폐선 목록: 철도 DB(KMZ)의 '폐지' 선로 가운데 지금 다니는 선로와 겹치지 않는 노선(수려선·수인선 옛 협궤 등)을
노선 이름별로 묶어 data/closed_lines.json으로 낸다. 게임에서 회색 점선으로 그리고 눌러서 재개통할 수 있다.

- 옛 선형(중앙선·경부선의 이설 전 구간처럼 지금 노선 이름과 같은 폐선)은 뺀다: 재개통할 '노선'이 아니라 옮겨 간 선로다
- 궤도선(노면전차)·삭도·열차페리·도시철도·버스 폴더는 뺀다
- 직선화·이설로 버려진 옛 선형(양 끝이 지금 선로에 붙고 거의 전부 1.5km 안을 나란히 가는 것)은 뺀다
- 40% 넘게 지금 선로와 겹치는 것, 3km 안 되는 것, 노선 이름 없이 운영사 이름만 있는 것은 뺀다
- 폐지된 역(Point/영업시설/폐지)을 노선 이름으로 붙인다

  .venv/Scripts/python -X utf8 pipeline/build_closed.py
"""
from __future__ import annotations

import json
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

import railref

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "closed_lines.json"
NS = railref.NS
SKIP = re.compile(r"(궤도선|삭도|열차페리|도시철도|버스|공영교통)")
MIN_KM = 3.0
# 이름만 바뀌어 지금도 다니는 노선: 이 이름의 폐선은 직선화·이설로 버린 옛 선형이다 (동해남부선·동해중부선 → 동해선)
RENAMED = {"동해남부선", "동해중부선", "경북선구간", "진해선"}
NEAR_OPEN = 0.004     # 지금 선로에서 이만큼(도, 약 400m) 안이면 겹친 것으로 친다
PARALLEL = 0.015      # 약 1.5km: 옛 선형(직선화로 버린 구간)을 가려낼 때
KX = 0.8              # 위도 37° 언저리: 경도 1도 ≈ 위도 0.8도


def km(p, q):
    return math.hypot((p[0] - q[0]) * 88.4, (p[1] - q[1]) * 111.0)


def chain(segs, tol=0.003):
    """선 조각들을 끝점끼리 이어 긴 줄로 (욕심껏: 가장 긴 조각에서 시작해 양 끝으로 붙여 나간다)"""
    segs = [list(s) for s in segs if len(s) >= 2]
    out = []
    while segs:
        segs.sort(key=lambda s: -len(s))
        cur = segs.pop(0)
        grown = True
        while grown:
            grown = False
            for i, s in enumerate(segs):
                for a, b, rev, front in ((cur[-1], s[0], False, False), (cur[-1], s[-1], True, False),
                                         (cur[0], s[-1], False, True), (cur[0], s[0], True, True)):
                    if abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol:
                        t = s[::-1] if rev else s
                        cur = t[:-1] + cur if front else cur + t[1:]
                        segs.pop(i)
                        grown = True
                        break
                if grown:
                    break
        out.append(cur)
    return out


def simplify(pts, tol=0.0004):
    """Douglas–Peucker (도 단위, 경도는 KX배)"""
    if len(pts) < 3:
        return pts
    a, b = np.array(pts[0]), np.array(pts[-1])
    arr = np.array(pts)
    d = b - a
    d[0] *= KX
    rel = arr - a
    rel[:, 0] *= KX
    n = math.hypot(*d) or 1e-12
    dist = np.abs(rel[:, 0] * d[1] - rel[:, 1] * d[0]) / n
    k = int(np.argmax(dist))
    if dist[k] <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: k + 1], tol)[:-1] + simplify(pts[k:], tol)


def main():
    kmz = railref.find_kmz(RAW)
    root = ET.fromstring(zipfile.ZipFile(kmz).read("doc.kml"))
    groups = defaultdict(list)          # (나라, 노선) → [선 조각]
    stations = defaultdict(list)        # 노선(norm) → [(역 이름, 경도, 위도)]
    open_names = set()

    def walk(el, path):
        for ch in el:
            tag = ch.tag.split("}")[1]
            if tag in ("Folder", "Document"):
                walk(ch, path + [ch.findtext("k:name", default="", namespaces=NS)])
                continue
            if tag != "Placemark":
                continue
            c = ch.find(".//k:coordinates", NS)
            if c is None or not c.text:
                continue
            pts = [tuple(map(float, p.split(",")[:2])) for p in c.text.split()]
            name = ch.findtext("k:name", default="", namespaces=NS) or ""
            if len(path) > 4 and path[1] == "Path" and path[4] in ("영업", "미래"):
                open_names.add(railref.norm_line(path[-1]))
                if name.endswith("선"):
                    open_names.add(railref.norm_line(name))
            if len(path) > 5 and path[1] == "Path" and path[4] == "폐지":
                if any(SKIP.search(x) for x in path[5:]):
                    continue
                line = path[-1]
                if railref.OPERATOR.search(line) or line in ("간선", "지선", "국철", "사철", "전용선"):
                    line = name if name.endswith("선") else ""
                if not line or "-" in line:
                    continue
                groups[(path[3], line)].append(pts)
            elif len(path) > 3 and path[1] == "Point" and path[2] == "영업시설" and path[3] == "폐지":
                if railref.NOT_STATION.search(name) or " " in name.strip():
                    continue
                desc = ch.findtext("k:description", default="", namespaces=NS) or ""
                lines = set(re.findall(r"<center>([^<]+)</center>", desc)) | {path[-1]}
                for ln in lines:
                    stations[railref.norm_line(ln)].append((railref.norm_station(name), pts[0][0], pts[0][1]))

    walk(root, [])
    ref = railref.load(RAW)
    op_pts = []
    for _, _, p in railref.mainline_paths(ref):
        for i, q in enumerate(p):
            op_pts.append((q[0] * KX, q[1]))
            if i:
                op_pts.append(((q[0] + p[i - 1][0]) / 2 * KX, (q[1] + p[i - 1][1]) / 2))
    op = cKDTree(np.array(op_pts))

    out = []
    for (country, line), segs in groups.items():
        nl = railref.norm_line(line)
        if nl in open_names or nl in RENAMED:      # 지금도 다니는 노선(옛 이름 포함)의 옛 선형
            continue
        if not line.endswith("선"):   # 운영사 이름만 남은 묶음(철도청·조선총독부 교통국 등)은 노선이 아니다
            continue
        # 끝점끼리 붙는 조각을 잇고, 다시 3km 안의 틈(지금 노선이 쓰는 구간 등)을 곧은 선으로 이어 한 노선으로
        for ch_ in chain(chain(segs), tol=0.03):
            dense = [ch_[0]]
            for q in ch_[1:]:
                p = dense[-1]
                n = max(1, int(km(p, q) / 0.2))
                for k in range(1, n + 1):
                    dense.append((p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n))
            L = sum(km(dense[i - 1], dense[i]) for i in range(1, len(dense)))
            if L < MIN_KM:
                continue
            d = op.query(np.array([(x * KX, y) for x, y in dense]))[0]
            overlap = float(np.mean(d < NEAR_OPEN))
            parallel = float(np.mean(d < PARALLEL))
            ends_on = d[0] < NEAR_OPEN * 2 and d[-1] < NEAR_OPEN * 2
            # 직선화·이설로 버려진 옛 선형: 거의 전부 지금 선로 1.5km 안을 나란히 가고 양 끝이 지금 선로에 붙는다
            if ends_on and parallel > 0.85:
                continue
            # 대부분 지금 선로와 겹치면(이미 다른 노선이 쓰는 길) 재개통할 것이 없다
            if overlap > 0.4:
                continue
            geom = simplify(dense)
            sts = []
            tree = cKDTree(np.array([(x * KX, y) for x, y in dense]))
            for nm, x, y in stations.get(nl, []):
                dd, _ = tree.query((x * KX, y))
                if dd < 0.006 and not any(s_[0] == nm for s_ in sts):
                    sts.append((nm, round(x, 5), round(y, 5)))
            # 역은 선을 따라 차례로
            proj = lambda s_: int(tree.query((s_[1] * KX, s_[2]))[1])
            sts.sort(key=proj)
            out.append({"name": line, "country": "KP" if country == "DPRK" else "KR", "km": round(L, 1),
                        "geom": [[round(x, 5), round(y, 5)] for x, y in geom], "stations": sts,
                        "overlap": round(overlap, 2)})
    # 같은 이름이 여러 조각이면 '수려선 (1)'처럼 번호를 붙인다
    out.sort(key=lambda r: (r["name"], -r["km"]))
    cnt = defaultdict(int)
    for r in out:
        cnt[r["name"]] += 1
    seen = defaultdict(int)
    for k, r in enumerate(out):
        r["id"] = k
        if cnt[r["name"]] > 1:
            seen[r["name"]] += 1
            r["label"] = f"{r['name']} ({seen[r['name']]})"
        else:
            r["label"] = r["name"]
    OUT.write_text(json.dumps({"lines": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(len(out), "closed lines,", round(sum(r["km"] for r in out)), "km")
    for r in sorted(out, key=lambda r: -r["km"])[:40]:
        print(r["label"], r["country"], r["km"], "km, 역", len(r["stations"]))


if __name__ == "__main__":
    main()

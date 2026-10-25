"""철도·도시철도 선형 다듬기: 지그재그·갈고리 꼭짓점을 없앤다.

OSM 선로는 복선·여러 선로가 나란히 있어, 구간마다 다른 선로를 고르거나 역 노드(승강장 자리)로 꺾여 들어가면
그림에서 수십~수백 m씩 좌우로 흔들린다 (경의선 수색–DMC–가좌처럼). 노드 위치·연결·길이는 그대로 두고
링크 도형의 중간 꼭짓점만 고친다:
  1) 갈고리: 거의 되돌아가는(≥ HOOK_DEG) 꼭짓점, 선에서 조금(≤ JIT_M)만 벗어나며 꺾이는 잔 떨림은 뺀다
  2) 지그재그: 짧은 간격(≤ ZIG_M)에 좌우로 번갈아 꺾이는 꼭짓점 쌍은 가운데 한 점으로 합친다
  3) 마지막으로 ZIG_TOL_M 허용치로 Douglas–Peucker

  .venv/Scripts/python -X utf8 pipeline/smooth_rails.py          # data/network.bin을 고친다
  .venv/Scripts/python -X utf8 pipeline/smooth_rails.py --check  # 고치지 않고 몇 곳인지만
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import netpack  # noqa: E402
import netread  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
HOOK_M, HOOK_DEG = 250.0, 100.0     # 거의 되돌아가는 갈고리
JIT_M, JIT_DEG = 40.0, 45.0          # 선에서 조금 벗어난 잔 떨림
ZIG_M, ZIG_DEG, ZIG_DEV = 350.0, 25.0, 80.0
ZIG_TOL_M = 15.0


def _xy(p, lat0):
    return (p[0] * 111320 * math.cos(math.radians(lat0)), p[1] * 110570)


def _turn(a, b, c):
    """b에서 꺾이는 각(도, 부호: 왼쪽 +)과 b가 a–c 선에서 벗어난 거리(m)"""
    ux, uy = b[0] - a[0], b[1] - a[1]
    vx, vy = c[0] - b[0], c[1] - b[1]
    ang = math.degrees(math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
    wx, wy = c[0] - a[0], c[1] - a[1]
    wl = math.hypot(wx, wy)
    if wl < 1e-6:
        dev = math.hypot(ux, uy)
    else:
        t = max(0.0, min(1.0, ((b[0] - a[0]) * wx + (b[1] - a[1]) * wy) / (wl * wl)))
        dev = math.hypot(a[0] + t * wx - b[0], a[1] + t * wy - b[1])
    return ang, dev


def _dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, bd = -1, tol
        for k in range(i + 1, j):
            _, d = _turn(pts[i], pts[k], pts[j])
            if d > bd:
                best, bd = k, d
        if best > 0:
            keep[best] = True
            stack += [(i, best), (best, j)]
    return [p for p, k in zip(pts, keep) if k]


def smooth_part(part):
    """한 줄(경위도 점 목록)을 다듬는다. 양 끝은 그대로. (새 점 목록, 고친 곳 수)"""
    if len(part) < 3:
        return part, 0
    lat0 = part[0][1]
    pts = [_xy(p, lat0) for p in part]
    fixed = 0
    changed = True
    while changed and len(pts) > 2:
        changed = False
        # 1) 갈고리
        for k in range(1, len(pts) - 1):
            ang, dev = _turn(pts[k - 1], pts[k], pts[k + 1])
            if (abs(ang) >= HOOK_DEG and dev <= HOOK_M) or (abs(ang) >= JIT_DEG and dev <= JIT_M):
                del pts[k]
                fixed += 1
                changed = True
                break
        if changed:
            continue
        # 2) 지그재그: k, k+1에서 반대로 꺾이고 둘 사이가 짧으면 가운데 한 점으로
        for k in range(1, len(pts) - 2):
            a1, d1 = _turn(pts[k - 1], pts[k], pts[k + 1])
            a2, d2 = _turn(pts[k], pts[k + 1], pts[k + 2])
            seg = math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1])
            if a1 * a2 < 0 and abs(a1) >= ZIG_DEG and abs(a2) >= ZIG_DEG and seg <= ZIG_M and max(d1, d2) <= ZIG_DEV:
                mid = ((pts[k][0] + pts[k + 1][0]) / 2, (pts[k][1] + pts[k + 1][1]) / 2)
                pts[k:k + 2] = [mid]
                fixed += 1
                changed = True
                break
    pts = _dp(pts, ZIG_TOL_M)
    kx = 111320 * math.cos(math.radians(lat0))
    out = [(x / kx, y / 110570) for x, y in pts]
    out[0], out[-1] = part[0], part[-1]
    return out, fixed


def smooth_geom(geom):
    """None 구분자가 있는 도형 전체"""
    parts, cur = [], []
    for p in geom:
        if p is None:
            parts.append(cur); cur = []
        else:
            cur.append(p)
    parts.append(cur)
    out, fixed = [], 0
    for i, part in enumerate(parts):
        sp, f = smooth_part(part)
        fixed += f
        if i:
            out.append(None)
        out += sp
    return out, fixed


def main():
    check = "--check" in sys.argv
    data = ROOT / "data"
    _, links_, meta = netread.read(data)
    net = {"links": links_}
    for l in links_:   # NaN 구분자 → None
        l["geom"] = [None if x != x else (x, y) for x, y in l["geom"]]
    total = links = 0
    for l in net["links"]:
        if l["mode"] not in (1, 2):
            continue
        g, f = smooth_geom(l["geom"])
        if f:
            total += f
            links += 1
            l["geom"] = g
    print("fixed", total, "vertices on", links, "rail/metro links")
    if check:
        return
    # 노드·링크 속성은 그대로 두고 꼭짓점 수·꼭짓점 바이트열만 다시 쓴다
    meta_path, bin_path = data / "network.meta.json", data / "network.bin"
    buf = bin_path.read_bytes()
    N, L = meta["nodes"], meta["links"]
    off = 0
    for size in [N * 2 * 4, L * 4, L * 4, L * 4, L * 2, L * 2, L * 2] + [L] * 7 + ([L * 2] if meta.get("hasOpen") else []):
        off += size
        off += (-off) % 4
    counts = np.array([len(l["geom"]) for l in net["links"]], "<u4")
    raw = np.array([(math.nan, math.nan) if p is None else p for l in net["links"] for p in l["geom"]], dtype=np.float64).ravel() * netpack.SCALE
    verts = netpack.encode_verts(raw)
    out = bytearray(buf[:off]) + counts.tobytes()
    out += b"\0" * ((-len(out)) % 4)
    out += verts.tobytes()
    out += b"\0" * ((-len(out)) % 4)
    bin_path.write_bytes(bytes(out))
    meta["verts"], meta["vertBytes"] = int(len(raw) // 2), int(len(verts))
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("network.bin", round(len(out) / 1e6, 2), "MB")


if __name__ == "__main__":
    main()

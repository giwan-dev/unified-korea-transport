"""1km 인구 격자와 존 내부 소구역을 만든다 (build_data.py 다음에 실행).

존 안의 인구 격자를 가중 k-평균으로 묶어 소구역(최대 8개)을 만들고,
격자 하나하나를 data/grid.bin에 저장한다. 게임은 이 격자로 역세권 접근시간을 계산하므로
같은 시군구 안에서도 역을 어디에 두느냐에 따라 이용객이 달라진다.

출력
  - data/zones.geojson  각 존에 subs: [[경도, 위도, 인구비중], ...] 추가
  - data/grid.bin       Float32 [경도, 위도, 인구, 소구역 번호] × 격자 수 (little endian)

실행: python pipeline/build_grid.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import rasterio
import rasterio.features
from scipy import ndimage
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
POP = {"KR": RAW / "kor_pop2025.tif", "KP": RAW / "prk_pop2025.tif"}

MIN_CELL_POP = 5          # 이보다 적은 격자는 버린다 (산간 빈 땅)
POP_PER_SUB = 120_000     # 소구역 하나가 맡는 대략적인 인구
MAX_SUBS = 8


def log(*a):
    print(*a, file=sys.stderr, flush=True)


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


def main():
    fc = json.loads((OUT / "zones.geojson").read_text(encoding="utf-8"))
    feats = fc["features"]
    records = []          # (lon, lat, pop, sub)
    sub_count = 0
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
        for i, f in enumerate(zs):
            m = zid == i + 1
            p = f["properties"]
            if not m.any():
                p["subs"] = [[p["cx"], p["cy"], 1.0]]
                p["sub0"] = sub_count
                sub_count += 1
                continue
            xy = np.column_stack([xs[m], ys[m]])
            w = pops[m]
            # 경위도 비율 보정 (위도 38도 부근)
            scale = np.array([np.cos(np.radians(p["cy"])), 1.0])
            k = int(np.clip(round(w.sum() / POP_PER_SUB), 1, MAX_SUBS))
            k = min(k, len(w))
            centers, lab = weighted_kmeans(xy * scale, w, k) if k > 1 else (
                np.array([(xy * scale * w[:, None]).sum(0) / w.sum()]), np.zeros(len(w), dtype=int))
            centers = centers / scale
            subs = []
            for j in range(len(centers)):
                mj = lab == j
                share = float(w[mj].sum() / w.sum())
                subs.append([round(float(centers[j][0]), 4), round(float(centers[j][1]), 4), round(share, 4)])
            p["subs"] = subs
            p["sub0"] = sub_count
            for (x, y), pop, j in zip(xy, w, lab):
                records.append((x, y, pop, sub_count + j))
            sub_count += len(subs)
        log(c, "cells", int((zid > 0).sum()), "pop", round(pops.sum()))

    rec = np.array(records, dtype=np.float32)
    (OUT / "grid.bin").write_bytes(rec.astype("<f4").tobytes())
    (OUT / "zones.geojson").write_text(
        json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log("subzones", sub_count, "cells", len(rec), "grid.bin", round((OUT / "grid.bin").stat().st_size / 1e6, 2), "MB")


if __name__ == "__main__":
    main()

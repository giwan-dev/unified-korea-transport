"""지형 격자: 새 노선을 그을 때 경사·물을 피하는 경로와 터널·교량 비율을 구하는 데 쓴다 (js/game/terrain.js).

  - 읽음: data/raw/dem/Copernicus_DSM_COG_30_*.tif (Copernicus DEM GLO-90, 약 90m, pipeline/download.sh)
          data/admin/sgg.geojson, data/base/world.geojson (육지), data/base/waterarea.geojson (호수·큰 강)
  - 씀:   data/terrain.bin, data/terrain.json

격자는 경도 TERRAIN_DX × 위도 TERRAIN_DY (약 1.1km) 칸. terrain.bin은
  표고 Int16 × (행×열)  칸 안 90m 표고의 평균 (m). 물 칸은 WATER(-32768), 바다는 SEA(-32767)
  거칠기 Uint8 × (행×열) 칸 안 표고의 표준편차 ÷ 2 (m, 255까지): 산지·골짜기 (경사로 못 잡는 기복)
행은 남→북, 열은 서→동.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
import rasterio.features
from rasterio.windows import from_bounds
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
X0, X1, Y0, Y1 = 124.0, 131.0, 33.0, 43.0
TERRAIN_DX, TERRAIN_DY = 0.0125, 0.01
WATER, SEA = -32768, -32767


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def main():
    cols = round((X1 - X0) / TERRAIN_DX)
    rows = round((Y1 - Y0) / TERRAIN_DY)
    s1 = np.zeros((rows, cols)); s2 = np.zeros((rows, cols)); cnt = np.zeros((rows, cols))
    tiles = sorted((RAW / "dem").glob("Copernicus_DSM_COG_30_*.tif"))
    log("dem tiles", len(tiles))
    for t in tiles:
        with rasterio.open(t) as src:
            z = src.read(1).astype(np.float64)
            nod = src.nodata
            h, w = z.shape
            tr = src.transform
            # 90m 화소 중심 → 격자 칸
            xs = tr.c + (np.arange(w) + 0.5) * tr.a
            ys = tr.f + (np.arange(h) + 0.5) * tr.e
            ci = np.floor((xs - X0) / TERRAIN_DX).astype(int)
            ri = np.floor((ys - Y0) / TERRAIN_DY).astype(int)
            ok_c = (ci >= 0) & (ci < cols)
            ok_r = (ri >= 0) & (ri < rows)
            if not ok_c.any() or not ok_r.any():
                continue
            R = np.broadcast_to(ri[:, None], z.shape)
            C = np.broadcast_to(ci[None, :], z.shape)
            m = ok_r[:, None] & ok_c[None, :]
            if nod is not None:
                m &= z != nod
            np.add.at(s1, (R[m], C[m]), z[m])
            np.add.at(s2, (R[m], C[m]), z[m] ** 2)
            np.add.at(cnt, (R[m], C[m]), 1)
        log(t.name)
    mean = np.where(cnt > 0, s1 / np.maximum(cnt, 1), 0)
    std = np.sqrt(np.maximum(0, np.where(cnt > 0, s2 / np.maximum(cnt, 1) - mean ** 2, 0)))

    # 육지(남북 시군구 + 주변국)와 물(호수·큰 강) 칸
    transform = rasterio.transform.from_origin(X0, Y1, TERRAIN_DX, TERRAIN_DY)   # 북→남 행 순서
    land_geoms = [shape(f["geometry"]) for f in json.loads((OUT / "admin" / "sgg.geojson").read_text(encoding="utf-8"))["features"]]
    land_geoms += [shape(f["geometry"]) for f in json.loads((OUT / "base" / "world.geojson").read_text(encoding="utf-8"))["features"]]
    land = rasterio.features.rasterize(((g, 1) for g in land_geoms), out_shape=(rows, cols), transform=transform, fill=0, all_touched=False)[::-1]
    water_fc = json.loads((OUT / "base" / "waterarea.geojson").read_text(encoding="utf-8"))["features"]
    water = rasterio.features.rasterize(((shape(f["geometry"]), 1) for f in water_fc), out_shape=(rows, cols), transform=transform, fill=0, all_touched=False)[::-1]

    elev = np.clip(np.round(mean), -500, 9000).astype("<i2")
    elev[(land == 0) | (cnt == 0)] = SEA
    elev[(water == 1) & (land == 1)] = WATER
    rough = np.clip(np.round(std / 2), 0, 255).astype("u1")
    path = OUT / "terrain.bin"
    path.write_bytes(elev.tobytes() + rough.tobytes())
    (OUT / "terrain.json").write_text(json.dumps({
        "x0": X0, "y0": Y0, "dx": TERRAIN_DX, "dy": TERRAIN_DY, "cols": cols, "rows": rows,
        "water": WATER, "sea": SEA, "source": "Copernicus DEM GLO-90 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, ESA)",
    }), encoding="utf-8")
    log("terrain", rows, "x", cols, round(path.stat().st_size / 1e6, 2), "MB",
        "land", int((elev > SEA).sum()), "water", int((elev == WATER).sum()))


if __name__ == "__main__":
    main()

"""남측 법정리 경계(행정안전부·국토교통부 법정구역정보 '리', LSMD_ADM_SECT_RI 등)를 게임용으로 만든다.

남측 계산 단위는 읍면동(행정동)이라 리가 없었다. 법정리 경계를 읍면동마다 나눠 붙이고, 읍면동 인구를
1km 인구 격자(WorldPop)로 리마다 나눈 몫을 둔다 (리 인구 = 읍면동 인구 × 몫). 행정리는 너무 잘게 갈라 쓰지 않는다.

  - 읽음: data/raw/ri/ 안의 .shp(또는 .zip 안의 .shp, .geojson) 하나 이상 — 좌표계는 .prj를 따르고, 없으면 EPSG:5186
          data/subzones.geojson (읍면동 경계), data/zones.json, data/grid.bin (인구 격자)
  - 씀:   data/admin/ri/index.json, data/admin/ri/{n}.geojson (시도별, 간략화한 경계)
          data/kr_ri.json  {"subs": {"읍면동 번호": [[리 이름, 몫, 법정리 코드, 파일 번호], ...]}, "stats": {...}}

  python pipeline/build_kr_ri.py [자료 폴더]
"""
import collections
import json
import struct
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import Point, mapping, shape

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "raw" / "ri"
SIMPLIFY = 0.0002   # 도 (약 20m)

SIDO = {"11": "서울특별시", "26": "부산광역시", "27": "대구광역시", "28": "인천광역시", "29": "광주광역시", "30": "대전광역시", "31": "울산광역시",
        "36": "세종특별자치시", "41": "경기도", "42": "강원특별자치도", "51": "강원특별자치도", "43": "충청북도", "44": "충청남도", "45": "전북특별자치도",
        "52": "전북특별자치도", "46": "전라남도", "12": "전라남도", "47": "경상북도", "48": "경상남도", "50": "제주특별자치도"}


def read_sources():
    frames = []
    files = list(SRC.rglob("*.shp")) + list(SRC.rglob("*.geojson"))
    for z in SRC.rglob("*.zip"):
        out = SRC / "_unzip" / z.stem
        if not out.exists():
            with zipfile.ZipFile(z) as f:
                f.extractall(out)
        files += list(out.rglob("*.shp"))
    # 같은 시도를 두 번 받은 경우 새 자료만 (전북 45 → 전북특별자치도 52, 전남 46·광주 29 → 전남광주통합특별시 12). 화면 미리보기로 받은 100건짜리 파일은 뺀다
    names = " ".join(f.name for f in files)
    skip = []
    if "_52_" in names: skip.append("_45_")
    if "_12_" in names: skip += ["_46_", "_29_"]
    files = sorted(f for f in set(files) if not any(k in f.name for k in skip) and f.name != "리법정경계.shp")
    if not files:
        sys.exit(f"{SRC} 안에 .shp·.zip·.geojson이 없습니다. V-World·국가공간정보포털의 '법정구역정보(리)'를 받아 넣어 주세요.")
    for f in files:
        try:
            g = gpd.read_file(f, encoding="cp949") if f.suffix == ".shp" else gpd.read_file(f)
        except Exception:
            g = gpd.read_file(f)
        if g.crs is None:
            g = g.set_crs(5186)
        cols = {c.lower(): c for c in g.columns}
        code = cols.get("ri_cd") or cols.get("li_cd") or next((cols[c] for c in cols if c.endswith("_cd")), None)
        name = cols.get("ri_nm") or cols.get("li_kor_nm") or cols.get("ri_kor_nm") or next((cols[c] for c in cols if "kor_nm" in c or c.endswith("_nm")), None)
        if not code or not name:
            print("열을 못 찾음:", f, list(g.columns), file=sys.stderr)
            continue
        g = g.to_crs(4326)[[code, name, "geometry"]].rename(columns={code: "code", name: "name"})
        frames.append(g)
        print(f"{f.name}: {len(g)}", file=sys.stderr)
    g = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=4326)
    g["code"] = g["code"].astype(str).str.strip()
    g = g[g.geometry.notna()].drop_duplicates("code")
    # 다른 파일에 같은 리가 또 있으면 (이름과 자리로) 하나만
    c = g.geometry.representative_point()
    g = g.assign(_k=g["name"].astype(str) + "|" + c.x.round(3).astype(str) + "|" + c.y.round(3).astype(str)).drop_duplicates("_k").drop(columns="_k")
    return g


def main():
    ri = read_sources()
    subs = json.loads((ROOT / "data/subzones.geojson").read_text(encoding="utf-8"))["features"]
    zones = json.loads((ROOT / "data/zones.json").read_text(encoding="utf-8"))
    sub_zone = {}
    for zi, z in enumerate(zones):
        for k in range(len(z["subs"])):
            sub_zone[z["sub0"] + k] = zi
    kr = [i for i, f in enumerate(subs) if zones[sub_zone[i]]["country"] == "KR" and not zones[sub_zone[i]].get("ext")]
    geoms = [shape(subs[i]["geometry"]) for i in kr]
    tree = shapely.STRtree(geoms)

    # 리마다 든 읍면동: 리의 안쪽 점이 든 읍면동 (경계가 어긋나면 가장 많이 겹치는 읍면동)
    rp = ri.geometry.representative_point().values
    own = {}
    for k, (c, p, g) in enumerate(zip(ri["code"], rp, ri.geometry.values)):
        hit = [j for j in tree.query(p) if geoms[j].contains(p)]
        if not hit:
            cand = list(tree.query(g))
            if not cand:
                continue
            hit = [max(cand, key=lambda j: geoms[j].intersection(g).area)]
        own[k] = kr[hit[0]]

    # 인구 격자로 몫: 격자 칸 중심이 든 리
    buf = (ROOT / "data/grid.bin").read_bytes()
    cells = np.frombuffer(buf, dtype="<f4").reshape(-1, 4)
    rtree = shapely.STRtree(ri.geometry.values)
    ri_pop = collections.Counter()
    sub_pop = collections.Counter()
    krset = np.array(sorted(set(kr)))
    sel = (cells[:, 2] > 0) & np.isin(cells[:, 3].astype(int), krset)
    cx, cy, cp, cs = cells[sel, 0].astype(float), cells[sel, 1].astype(float), cells[sel, 2].astype(float), cells[sel, 3].astype(int)
    for s_, p_ in zip(cs, cp):
        sub_pop[int(s_)] += float(p_)
    # 격자 칸 중심이 든 리 (한꺼번에): 그 리가 같은 읍면동에 든 것만
    pi, ki = rtree.query(shapely.points(cx, cy), predicate="within")
    seen = set()
    for a, k in zip(pi, ki):
        if a in seen or own.get(int(k)) != int(cs[a]):
            continue
        seen.add(a)
        ri_pop[int(k)] += float(cp[a])

    by_sub = collections.defaultdict(list)
    for k, s in own.items():
        by_sub[s].append(k)
    # 몫: 읍면동 안 리들의 격자 인구 비율 (격자 칸이 하나도 안 든 작은 리는 넓이로 조금)
    out_subs = {}
    files = collections.defaultdict(list)
    for s, ks in by_sub.items():
        area = {k: ri.geometry.values[k].area for k in ks}
        w = {k: ri_pop[k] + 1e-6 * area[k] / max(sum(area.values()), 1e-12) * max(sub_pop[s], 1) * 0.01 for k in ks}
        tot = sum(w.values()) or 1
        sido = SIDO.get(ri["code"].values[ks[0]][:2], "기타")
        rows = []
        for k in ks:
            rows.append([str(ri["name"].values[k]), round(float(w[k] / tot), 4), str(ri["code"].values[k]), sido])
            files[sido].append((k, s))
        out_subs[str(s)] = rows

    # 시도별 경계 파일 (간략화)
    od = ROOT / "data/admin/ri"
    od.mkdir(parents=True, exist_ok=True)
    index = []
    fid = {}
    for n, (sido, items) in enumerate(sorted(files.items())):
        fid[sido] = n
        feats = []
        xs, ys = [], []
        for k, s in items:
            g = ri.geometry.values[k].simplify(SIMPLIFY, preserve_topology=True)
            if g.is_empty:
                continue
            gj = mapping(g)
            gj = json.loads(json.dumps(gj), parse_float=lambda v: round(float(v), 5))
            b = g.bounds
            xs += [b[0], b[2]]; ys += [b[1], b[3]]
            feats.append({"type": "Feature", "properties": {"code": str(ri["code"].values[k]), "name": str(ri["name"].values[k]), "sub": int(s)}, "geometry": gj})
        (od / f"{n}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append({"file": f"{n}.geojson", "province": sido, "bbox": [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)], "n": len(feats)})
    (od / "index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    for rows in out_subs.values():
        for r in rows:
            r[3] = fid.get(r[3], -1)
    stats = {"ri": len(ri), "assigned": len(own), "subs_with_ri": len(out_subs), "files": len(index)}
    (ROOT / "data/kr_ri.json").write_text(json.dumps({"source": "법정구역정보(리) — 국토교통부·행정안전부 (공공누리)", "subs": out_subs, "stats": stats},
                                                      ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(stats, file=sys.stderr)


if __name__ == "__main__":
    main()

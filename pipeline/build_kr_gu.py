"""남측 시의 일반구(수원시 장안구·화성시 만세구 등): 게임에서는 시 하나(한 존)라 구를 고를 수 없었다.
행정동 경계 자료(vuski/admdongkor, 2026-10-01)의 시군구 이름(○○시○○구)에서 읍면동마다 일반구를 읽어
게임 읍면동(같은 이름)에 붙인다. 이름이 맞지 않는 읍면동은 같은 시 안의 가장 가까운 읍면동의 구를 따른다.

  - 읽음: data/raw/HangJeongDong_ver20261001.geojson, data/zones.json, data/subzones.geojson
  - 씀:   data/kr_gu.json  {"경기도|수원시": {"파장동": "장안구", ...}, ...}
"""
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def main():
    adm = json.loads((DATA / "raw" / "HangJeongDong_ver20261001.geojson").read_text(encoding="utf-8"))["features"]
    zones = json.loads((DATA / "zones.json").read_text(encoding="utf-8"))
    feats = json.loads((DATA / "subzones.geojson").read_text(encoding="utf-8"))["features"]
    gu_of = collections.defaultdict(dict)   # (도, 시) → {동: 구}
    for f in adm:
        p = f["properties"]
        m = re.match(r"^(.+?시)(.+구)$", p["sggnm"])
        if not m:
            continue
        gu_of[(p["sidonm"], m.group(1))][p["adm_nm"].split()[-1]] = m.group(2)
    out, stats = {}, collections.Counter()
    for z in zones:
        if z.get("ext") or z["country"] != "KR":
            continue
        table = gu_of.get((z["province"], z["name"]))
        if not table:
            continue
        subs = [(feats[z["sub0"] + k]["properties"].get("name", ""), s[0], s[1]) for k, s in enumerate(z["subs"])]
        got = {n: table[n] for n, _, _ in subs if n in table}
        stats["matched"] += len(got)
        for n, x, y in subs:
            if n in got:
                continue
            near = min(((x - x2) ** 2 + (y - y2) ** 2, n2) for n2, x2, y2 in subs if n2 in got)
            got[n] = got[near[1]]
            stats["nearest"] += 1
        out[f"{z['province']}|{z['name']}"] = got
        stats["cities"] += 1
    (DATA / "kr_gu.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(dict(stats), {k: sorted(set(v.values())) for k, v in out.items()}, file=sys.stderr)


if __name__ == "__main__":
    main()

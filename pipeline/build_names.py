"""옛 이름 되찾기 대상 목록을 만든다 (build_basemap.py 다음에 실행).

data/historic_names.json의 대조표를 현재 존(시군구)·읍면동 데이터와 맞춰
data/historic_targets.json에 [{level, id, zone, current, historic, year, reason}]으로 쓴다.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def main():
    table = json.loads((DATA / "historic_names.json").read_text(encoding="utf-8"))["entries"]
    zones = json.loads((DATA / "zones.json").read_text(encoding="utf-8"))
    index = json.loads((DATA / "admin" / "units" / "index.json").read_text(encoding="utf-8"))
    units = []
    for e in index:
        if e["country"] != "KP":
            continue
        units += json.loads((DATA / "admin" / "units" / e["file"]).read_text(encoding="utf-8"))["features"]
    out = []
    for t in table:
        if t["level"] == "zone":
            for z in zones:
                if z["name"] == t["current"] and z["country"] == "KP" and t.get("province", z["province"]) == z["province"]:
                    out.append({"level": "zone", "id": z["id"], "zone": z["id"], **pick(t)})
        else:
            seen = set()
            for u in units:
                p = u["properties"]
                if p["name"] == t["current"] and p["zone"] not in seen:
                    seen.add(p["zone"])
                    out.append({"level": "unit", "id": p["id"], "zone": p["zone"], **pick(t)})
    (DATA / "historic_targets.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(out), "targets:", ", ".join(f"{o['current']}→{o['historic']}" for o in out))


def pick(t):
    return {k: t[k] for k in ("current", "historic", "year", "reason")}


if __name__ == "__main__":
    main()

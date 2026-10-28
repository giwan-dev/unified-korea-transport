"""가상 도시철도 계획(지방·북측 도시철도)을 단계로 나눠, 시내에만 머물지 않고 맞닿은 시군의 시청·군청 소재지까지 잇는 연장 계획을 붙인다.

  - 1단계: 원래 계획 (시내)
  - 2단계: 한쪽 끝에서 가장 알맞은 인근 시군청까지 (노선이 뻗던 방향으로 5~25km)
  - 3단계: 다른 쪽 끝에서 또 다른 인근 시군청까지 (있으면)
중간 역은 경전철 1.6km·도시철도 2km 간격으로 두고, 가장 가까운 읍면동(리) 이름을 붙인다. 시군청 하나는 한 도시에서 한 번만 잇는다.

  - 읽음: data/plans.json, data/halls.json, data/zones.json, data/subzones.geojson
  - 씀:   data/plans.json (단계 연장 계획을 원래 계획 바로 뒤에, 다시 돌리면 예전 연장은 지우고 새로 만든다)
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GROUPS = ("지방 도시철도", "북측 도시철도")
km = lambda a, b: math.hypot((a[0] - b[0]) * 88.6, (a[1] - b[1]) * 111)


def main():
    P = json.loads((ROOT / "data/plans.json").read_text(encoding="utf-8"))
    halls = json.loads((ROOT / "data/halls.json").read_text(encoding="utf-8"))
    zones = json.loads((ROOT / "data/zones.json").read_text(encoding="utf-8"))
    subs = json.loads((ROOT / "data/subzones.geojson").read_text(encoding="utf-8"))["features"]
    subpts = []
    for z in zones:
        for k, s in enumerate(z["subs"]):
            subpts.append((s[0], s[1], z["sub0"] + k, z))
    county = lambda z: (z["province"], z["name"].split(" ")[0])

    def zone_at(x, y):
        return min(subpts, key=lambda s: (s[0] - x) ** 2 + (s[1] - y) ** 2)[3]

    def sub_name(x, y):
        s = min(subpts, key=lambda s: (s[0] - x) ** 2 + (s[1] - y) ** 2)
        nm = subs[s[2]]["properties"].get("name") or ""
        for suf in ("노동자구", "리", "동", "읍", "면", "가"):
            if nm.endswith(suf) and len(nm) > len(suf) + 1:
                return nm[: -len(suf)]
        return nm

    plans = [p for p in P["plans"] if not p.get("ext")]   # 예전에 만든 연장 계획은 지우고 새로
    out, used = [], {}
    for p in plans:
        out.append(p)
        if p.get("group") not in GROUPS or p["type"] not in ("metro", "lrt", "lrtug"):
            continue
        p["phase"] = "1단계"
        pts = [(q[1], q[2]) for q in p["points"]]
        own = {county(zone_at(*q)) for q in pts}
        country = zone_at(*pts[0])["country"]
        city = p["name"].split(" ")[0]
        taken = used.setdefault(city, set())
        step = 2.0 if p["type"] == "metro" else 1.6
        phase = 2
        for end, prev, label in ((pts[-1], pts[-2], p["points"][-1][0]), (pts[0], pts[1], p["points"][0][0])):
            dx, dy = (end[0] - prev[0]) * 88.6, (end[1] - prev[1]) * 111
            dl = math.hypot(dx, dy) or 1
            best = None
            for h in halls:
                z = zones[h["z"]]
                if z.get("ext") or z["country"] != country or county(z) in own or h["k"] not in ("si", "gun"):
                    continue
                key = county(z)
                if key in taken:
                    continue
                d = km(end, (h["x"], h["y"]))
                if not 5 <= d <= 25:
                    continue
                hx, hy = (h["x"] - end[0]) * 88.6, (h["y"] - end[1]) * 111
                dot = (dx * hx + dy * hy) / (dl * d)
                if dot < 0.2:   # 노선이 뻗던 쪽으로 (되돌아 시내를 지나가지 않게)
                    continue
                score = d / (0.4 + dot)
                if best is None or score < best[0]:
                    best = (score, h, z, d)
            if not best:
                continue
            _, h, z, d = best
            taken.add(county(z))
            hall_name = z["name"].split(" ")[0] + ("청" if not z["name"].endswith("구") else "청")
            n = max(1, round(d / step))
            stops, names = [[label, round(end[0], 4), round(end[1], 4)]], {label}
            for k in range(1, n):
                t = k / n
                x, y = end[0] + (h["x"] - end[0]) * t, end[1] + (h["y"] - end[1]) * t
                nm = sub_name(x, y) or f"{label}{k}"
                if nm in names:
                    continue
                names.add(nm)
                stops.append([nm, round(x, 4), round(y, 4)])
            stops.append([hall_name, round(h["x"], 4), round(h["y"], 4)])
            out.append({
                "id": f"{p['id']}-{phase}", "name": f"{p['name']} {phase}단계 ({label}–{hall_name})", "type": p["type"], "group": p["group"],
                "source": f"가상 연장: {p['name']} {phase}단계, 시내를 넘어 인근 {z['name'].split(' ')[0]} 시청·군청 소재지까지 (게임용 구상)",
                "points": stops, "phase": f"{phase}단계", "after": p["id"], "ext": True,
                "note": f"{p['name']}의 {label} 끝에서 {z['name'].split(' ')[0]} 청사까지 약 {d:.0f}km. 1단계(시내)를 먼저 지은 뒤 같은 노선으로 잇는다.",
            })
            print(p["name"], f"{phase}단계 →", hall_name, f"{d:.1f}km", len(stops), "역")
            phase += 1
    P["plans"] = out
    (ROOT / "data/plans.json").write_text(json.dumps(P, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()

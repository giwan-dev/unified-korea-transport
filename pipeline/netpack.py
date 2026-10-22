"""네트워크를 가벼운 이진 형식으로 저장한다 (js/data/netpack.js가 읽는다).

network.bin (little endian), 열 단위 배열을 차례로 이어 붙인다:
  노드      Int32 [경도×1e5, 위도×1e5] × N
  링크      a Int32, b Int32, len Float32, speed Uint16, name Uint16, colour Uint16,
            mode Uint8, cls Uint8, lanes Uint8, tracks Uint8, paved Uint8, kp Uint8, power Uint8,
            open Uint16 (공사 중 노선의 개통 연도, 0 = 운영 중)
  도형      링크별 꼭짓점 수 Uint32 × L, 꼭짓점 Int32 [경도×1e5, 위도×1e5] × V
network.meta.json: 개수, 이름·색 표, 등급·전력 표, 역·IC 목록
"""

import json

import numpy as np

CLASSES = ["motorway", "trunk", "primary", "secondary", "hsr", "conv", "metro"]
POWERS = ["none", "AC", "DC"]
SCALE = 1e5


def write(net, bin_path, meta_path):
    nodes = np.round(np.array(net["nodes"], dtype=np.float64) * SCALE).astype("<i4")
    links = net["links"]
    names, colours = {"": 0}, {"": 0}

    def idx(table, v):
        v = v or ""
        if v not in table:
            table[v] = len(table)
        return table[v]

    L = len(links)
    a = np.array([l["a"] for l in links], "<i4")
    b = np.array([l["b"] for l in links], "<i4")
    length = np.array([l["len"] for l in links], "<f4")
    speed = np.array([l["speed"] for l in links], "<u2")
    name = np.array([idx(names, l.get("name")) for l in links], "<u2")
    colour = np.array([idx(colours, l.get("colour")) for l in links], "<u2")
    mode = np.array([l["mode"] for l in links], "u1")
    cls = np.array([CLASSES.index(l["cls"]) for l in links], "u1")
    lanes = np.array([l.get("lanes", 0) for l in links], "u1")
    tracks = np.array([l.get("tracks", 0) for l in links], "u1")
    paved = np.array([l.get("paved", 1) for l in links], "u1")
    kp = np.array([l["kp"] for l in links], "u1")
    power = np.array([POWERS.index(l.get("power", "none")) for l in links], "u1")
    opening = np.array([l.get("open", 0) for l in links], "<u2")   # 공사 중 노선의 개통 연도 (0 = 운영 중)
    counts = np.array([len(l["geom"]) // 2 for l in links], "<u4")
    # 여러 선으로 이뤄진 도형은 NaN 구분자를 INT32_MAX로 저장한다
    raw = np.concatenate([np.array(l["geom"], dtype=np.float64) for l in links]) * SCALE
    verts = np.where(np.isnan(raw), 2147483647, np.round(raw)).astype("<i4")

    parts = [nodes, a, b, length, speed, name, colour, mode, cls, lanes, tracks, paved, kp, power, opening, counts, verts]
    with open(bin_path, "wb") as f:
        for p in parts:
            f.write(p.tobytes())
            pad = (-f.tell()) % 4   # 다음 배열이 4바이트 경계에서 시작하도록
            f.write(b"\0" * pad)
    meta = {
        "nodes": len(net["nodes"]), "links": L, "verts": int(len(verts) // 2), "scale": SCALE, "hasOpen": True,
        "names": list(names), "colours": list(colours), "classes": CLASSES, "powers": POWERS,
        "stations": net["stations"], "metro_stations": net.get("metro_stations", []), "junctions": net["junctions"],
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))

#!/usr/bin/env bash
# 원본 공개 데이터 내려받기 (data/raw, 저장소에는 올리지 않음)
set -euo pipefail
cd "$(dirname "$0")/../data"
mkdir -p raw
cd raw
curl -fSL -o south-korea.osm.pbf https://download.geofabrik.de/asia/south-korea-latest.osm.pbf
curl -fSL -o north-korea.osm.pbf https://download.geofabrik.de/asia/north-korea-latest.osm.pbf
WP=https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2025
curl -fSL -o kor_pop2025.tif $WP/KOR/v1/1km_ua/constrained/kor_pop_2025_CN_1km_R2025A_UA_v1.tif
curl -fSL -o prk_pop2025.tif $WP/PRK/v1/1km_ua/constrained/prk_pop_2025_CN_1km_R2025A_UA_v1.tif
# (선택) 북 도 경계 보정용. 재배포 불가 라이선스이므로 소속 도 판정에만 쓰고 출력에는 넣지 않는다.
curl -fSL -o HangJeongDong_ver20261001.geojson https://raw.githubusercontent.com/vuski/admdongkor/master/ver20261001/HangJeongDong_ver20261001.geojson
NE=https://naciscdn.org/naturalearth/10m
for f in cultural/ne_10m_admin_0_countries physical/ne_10m_rivers_lake_centerlines physical/ne_10m_lakes cultural/ne_10m_populated_places_simple; do curl -fSL -o $(basename $f).zip $NE/$f.zip; done
curl -fSL -o gadm41_PRK_2.json.zip https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_PRK_2.json.zip

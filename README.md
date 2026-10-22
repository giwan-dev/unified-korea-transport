# 통일 한반도 교통망

**플레이: https://radix24.github.io/unified-korea-transport/**

남북이 오늘 통일되었다고 가정하고, 한정된 SOC 예산으로 고속도로·고속철도·도시철도·공항·해저터널을 놓거나 기존 재래선·국도를 개량하는 웹 게임입니다.

- 교통수요는 중력모형과 로짓 수단선택(승용차·지역 간 철도·대중교통·항공)으로 추정하고, 혼잡을 반영해 배정합니다.
- 교통망이 바뀌면 접근성과 소득이 달라집니다. 이에 따라 시군구 사이와 읍면동 사이로 인구가 이동하고, 지역별 인간개발지수(HDI)와 주민 행복도가 변합니다.
- 중국 동북·러시아 연해주·일본의 주요 도시와 국경 통과점, 여객선 항로, 국제선 항공으로 이어집니다.
- 북측에서 지도자 이름이나 선전 구호로 바뀐 지명을 예산을 들여 옛 이름으로 되찾을 수 있습니다.

## 실행

빌드 과정이 없는 정적 웹페이지입니다. 저장소 루트에서 정적 서버를 띄우면 됩니다(`python -m http.server`도 되지만, 개발 중에는 캐시를 끄는 `tools/serve.py`가 편합니다).

```bash
python tools/serve.py 8000
```

브라우저에서 `http://localhost:8000`을 엽니다. GitHub Pages에 그대로 올려도 동작합니다.

## 플레이

- **개량**: 지도에서 도로·철도 구간을 누르면 개량할 수 있습니다. 같은 이름 노선 전체를 한 번에 고를 수도 있습니다.
  - 도로: 차로 확장, 고속도로 격상
  - 철도: 복선화, 전철화(북의 직류 3kV → 교류 25kV), 고속화
- **신설**: 건설 탭에서 종류를 고르고 지도를 차례로 누릅니다.
  - 종류: 고속도로·국도·고속철도·일반철도·도시철도·해저터널
  - 노선은 찍은 점을 지나는 부드러운 곡선으로 놓입니다.
  - 기존 노선 근처를 누르면 연결됩니다.
  - 새 역·IC·JCT의 이름은 자동으로 정해지며, 직접 바꿀 수 있습니다.
- **공항**: 공항을 누르면 확장할 수 있고, 건설 탭에서 새 공항을 놓을 수 있습니다.
- **지명**: 지역을 누르면 이름을 바꿀 수 있습니다(무료, 표시만 바뀜). 건설 탭의 "옛 이름 되찾기"는 예산이 들고, 완공되면 주민 행복도가 오릅니다.
- **다음 해**: 공사가 진행되고 통행·인구·HDI·행복도가 갱신됩니다.
- **민원**: 혼잡도(V/C)가 1을 넘은 노선이 V/C 높은 순으로 확장 요구에 올라옵니다.
- **정책**: 설정 탭에서 북→남 이주 정책(자유·제한·통제)을 정합니다.

## 데이터 다시 만들기

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r pipeline/requirements.txt
bash pipeline/download.sh
.venv/Scripts/python -X utf8 pipeline/build_admin.py     # 행정구역 기준 도형 (남 행정동, 북 보로노이)
.venv/Scripts/python -X utf8 pipeline/build_basemap.py   # 자체 배경지도
.venv/Scripts/python -X utf8 pipeline/build_data.py      # 존·도로·철도·도시철도망
.venv/Scripts/python -X utf8 pipeline/build_grid.py      # 인구 격자·소구역·데이터 버전
.venv/Scripts/python -X utf8 pipeline/build_names.py     # 옛 이름 되찾기 대상
```

(macOS·Linux에서는 `.venv/bin/python`)

데이터를 다시 만들면 기준 연도 결과도 다시 계산해야 시작이 빠릅니다. `python tools/serve.py 8000`으로 띄운 뒤 `http://localhost:8000/tools/baseline.html`을 열면 `data/baseline.*`이 저장됩니다. 데이터 버전(`data/meta.json`)이 맞지 않으면 게임이 시작할 때 직접 계산합니다(수 분).

## 구조

```
index.html, css/        화면 (처음 불러오기 화면 포함)
js/main.js              게임 진행·패널
js/ui/map.js            지도 (자체 벡터 배경지도, MapLibre GL)
js/data/netpack.js      이진 네트워크 읽기
js/sim/                 시뮬레이션 (웹 워커에서 실행)
  graph.js              최단경로
  model.js              수요·배정·항공·경제·HDI·인구이동
  params.js             모델 파라미터
js/game/                예산·사업·민원·이름 짓기·곡선·국외 연결
pipeline/               공개 데이터 → data/
tools/                  개발 서버, 기준 연도 사전 계산
docs/model.md           모델과 가정값 설명
```

## 데이터 출처와 라이선스

- 남측 행정동 경계: 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 공공누리 제1유형으로 개방한 행정동 경계를 가공한 것입니다.
  - 가공: [vuski/admdongkor](https://github.com/vuski/admdongkor), CC BY 4.0
  - `data/admin/`의 남측 경계도 같은 조건을 따릅니다.
- 도로·철도·도시철도·북측 행정구역·지명: © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자, ODbL 1.0.
  - `data/`의 파생 데이터도 ODbL을 따릅니다.
- 인구 격자: [WorldPop](https://www.worldpop.org/) 2025 (R2025A) 1km constrained UN-adjusted, CC BY 4.0
- 배경지도의 주변국 육지·하천·호수·도시: [Natural Earth](https://www.naturalearthdata.com/) (공공 영역)
- 라벨 글꼴의 숫자·영문 글리프: [OpenFreeMap](https://openfreemap.org/) 글꼴 서버 (한글은 브라우저 글꼴)
- 공항·항구·국외 도시 좌표와 용량, 옛 지명 대조표(`data/air_sea.json`, `data/historic_names.json`)는 공개 자료를 바탕으로 직접 정리한 값이며 확인이 필요합니다.

소득·HDI 초기값과 공사비 단가는 게임용 가정값입니다. 근거와 한계는 [docs/model.md](docs/model.md)에 정리했습니다.

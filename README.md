# 통일 한반도 교통망

**플레이: https://radix24.github.io/unified-korea-transport/**

남북이 오늘 통일되었다고 가정하고, 한정된 SOC 예산으로 고속도로·고속철도를 놓거나 기존 재래선·국도를 개량하는 웹 게임입니다.

- 교통수요는 중력모형과 로짓 수단선택으로 추정하고, 혼잡을 반영해 배정합니다.
- 교통망이 바뀌면 접근성과 소득이 달라지고, 이에 따라 인구가 이동하고 지역별 인간개발지수(HDI)가 변합니다.

> 프로토타입 단계입니다.
> - 수요는 시·군·구(남)와 시·군·구역(북) 단위로 계산합니다.
> - 역·버스 접근과 소구역 인구 이동은 대도시 읍면동(그 밖은 인구 격자 묶음) 단위로 따집니다.
> - 수단은 승용차·지역 간 철도·대중교통(버스+도시철도) 세 가지입니다.
> - 중국·러시아 연결과 읍면동 단위 인구 이동은 다음 단계입니다.

## 실행

빌드 과정이 없는 정적 웹페이지입니다. 저장소 루트에서 정적 서버를 띄우면 됩니다(`python -m http.server`도 되지만, 개발 중에는 캐시를 끄는 `tools/serve.py`가 편합니다).

```bash
python tools/serve.py 8000
```

브라우저에서 `http://localhost:8000`을 엽니다. GitHub Pages에 그대로 올려도 동작합니다.

## 플레이

- **개량**: 지도에서 도로·철도 구간을 누르면 차로 확장, 고속도로 격상, 복선화, 전철화(북의 직류 3kV → 교류 25kV), 고속화 등을 착공할 수 있습니다.
- **신설**: 건설 탭에서 종류를 고르고 지도를 차례로 누릅니다.
  - 기존 노선 근처를 누르면 연결됩니다.
  - 새 역·IC·JCT의 이름은 자동으로 정해지며, 직접 바꿀 수 있습니다.
- **다음 해**: 공사가 진행되고 통행·인구·HDI가 갱신됩니다.
- **민원**: 혼잡이 2년 이상 이어진 구간은 확장 요구로 올라옵니다.
- **정책**: 설정 탭에서 북→남 이주 정책(자유·제한·통제)을 정합니다.

## 데이터 다시 만들기

`data/` 아래의 게임 데이터는 `pipeline/build_data.py`로 만듭니다.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r pipeline/requirements.txt
bash pipeline/download.sh
.venv/Scripts/python -X utf8 pipeline/build_data.py
.venv/Scripts/python -X utf8 pipeline/build_grid.py
```

(macOS·Linux에서는 `.venv/bin/python`)

## 구조

```
index.html, css/        화면
js/main.js              게임 진행·패널
js/ui/map.js            지도 레이어 (MapLibre GL)
js/sim/                 시뮬레이션 (웹 워커에서 실행)
  graph.js              최단경로
  model.js              수요·배정·경제·HDI·인구이동
  params.js             모델 파라미터
js/game/                예산·사업·민원·이름 짓기
pipeline/               공개 데이터 → data/*.json
docs/model.md           모델과 가정값 설명
```

## 데이터 출처와 라이선스

- 도로·철도·행정구역·지명: © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자, ODbL 1.0.
  - `data/`의 파생 데이터도 ODbL을 따릅니다.
- 인구 격자: [WorldPop](https://www.worldpop.org/) 2020 1km UN-adjusted, CC BY 4.0
- 배경 지도: [OpenFreeMap](https://openfreemap.org/) (OpenMapTiles, OpenStreetMap)

소득·HDI 초기값과 공사비 단가는 게임용 가정값입니다. 근거와 한계는 [docs/model.md](docs/model.md)에 정리했습니다.

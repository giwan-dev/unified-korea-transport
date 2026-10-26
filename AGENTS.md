# Codex 저장소 지침

## 프로젝트 구조와 모듈 구성

이 저장소는 통일 한반도 교통망 시뮬레이터의 포크이며, 빌드 과정이 없는 정적 웹 앱입니다. 기존 게임 규칙을 유지하면서 지도·역 선택·노선 중복 방지 등의 사용성을 개선합니다.

- `index.html`, `css/`: 진입 화면과 스타일.
- `js/main.js`, `js/ui/`: 게임 진행, 패널, MapLibre GL 지도 UI.
- `js/game/`: 예산·사업·노선·저장 등 게임 규칙.
- `js/sim/`: 웹 워커에서 실행하는 수요·통행 배정 시뮬레이션.
- `js/data/`, `data/`: 이진 네트워크 로더와 가공 데이터.
- `pipeline/`: 공개 원본 데이터를 가공하는 Python 스크립트.
- `tools/`: 개발 서버, 기준 연도 계산, 점검 도구.
- `tests/reuse.test.js`, `tests/browser/`: Node.js 단위 테스트와 Playwright 브라우저 테스트.
- `assets/brand/`, `docs/`: 로고·배지, 모델 가정과 포크 개선 설명.

## 설치·개발·검증 명령

저장소 루트에서 실행하세요. Node.js와 Python 3가 필요합니다.

```bash
npm ci
npm run dev              # http://127.0.0.1:5173, Python 개발 서버
npm test                 # node --test tests/*.test.js
npm run test:e2e         # Playwright 브라우저 테스트
```

브라우저 테스트는 `playwright.config.js`에 따라 Chrome을 사용하고 개발 서버를 자동으로 시작합니다. Chrome이 없으면 `npx playwright install chrome`으로 설치할 수 있습니다. 별도 빌드·린트·포맷 스크립트는 없습니다.

## 코딩 스타일과 이름 규칙

JavaScript는 기존 ES 모듈과 주변 코드의 들여쓰기·따옴표·이름 규칙을 따르세요. Python도 주변 코드 스타일을 유지하세요. 노선, 정류장, 연결처럼 도메인 개념이 드러나는 이름을 쓰고 의미가 불분명한 약어는 피하세요. 설정 변경과 무관한 대규모 포맷 수정은 피하세요.

## 테스트와 문서

게임 로직 변경은 `npm test`로 검증하고, 지도·패널·계획 기능 변경은 관련 Playwright 테스트로 검증하세요. 동작을 바꾸면 정상 경로와 경계 조건을 검증하는 테스트를 추가하세요. 실행하지 못한 검증은 이유를 명시하세요. UI 변경은 화면을 확인하고, 게임 모델·가정값 변경은 `docs/model.md`, 포크 사용성 변경은 `docs/fork-improvements.md` 등 관련 문서에 반영하세요.

## 데이터와 설정 관리

데이터 재생성 절차와 라이선스는 `README.md`를 따르세요. macOS·Linux의 가상 환경 Python 경로는 `.venv/bin/python`입니다. 대용량 원본은 `data/raw/`에 두며 커밋하지 않습니다. 네트워크 데이터를 다시 만들면 데이터 버전과 `data/baseline.*`의 일치 여부를 확인하세요. 데이터 출처와 기존 저작자 표기를 보존하세요.

Codex의 공통 프로젝트 지침은 이 `AGENTS.md`에서 관리합니다. 공유할 프로젝트 설정이 필요하면 `.codex/config.toml`을 사용하고, 개인 인증 정보와 API 키는 커밋하지 마세요. 모델·개인 환경 설정은 사용자 설정에서 관리하세요.

## 커밋과 풀 리퀘스트

변경 목적이 드러나는 짧은 제목을 사용하세요(예: `feat: add route graph loader`, `fix: handle missing stops`). 풀 리퀘스트에는 변경 이유, 검증한 명령과 결과, 관련 이슈를 적으세요. 지도나 UI가 달라졌다면 전후 화면을 첨부하고, 데이터 형식이 바뀌었다면 마이그레이션 방법을 설명하세요. 작업 전에 존재하던 사용자 변경을 보존하세요.

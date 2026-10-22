// 모델 파라미터. 근거와 한계는 docs/model.md 참고.
// 공개 자료만으로 보정한 게임용 값이며 예타 수준의 정밀도를 목표로 하지 않는다.

export const P = {
  // --- 교통망
  roadCapPerLaneHour: { motorway: 2000, trunk: 1600, primary: 1100, secondary: 800, ferry: 300 },
  dailyFactor: 10,            // 일교통량 / 첨두시 용량 환산 (K계수 약 10%)
  bprAlpha: 0.15,
  bprBeta: 4,
  bprMaxRatio: 6,
  bprMinBaseMin: 1,           // 혼잡 지체의 최소 기준 시간 (분): 짧은 병목 구간도 막히면 실제로 늦어진다
  unpavedCapFactor: 0.6,
  // 도심 일반도로 용량 보정: 주변 인구 밀도가 urbanDensityFrom을 넘으면 urbanDensityStep마다 용량 +100% (최대 +urbanCapMax배)
  urbanDensityFrom: 1000,
  urbanDensityStep: 4000,
  urbanCapMax: 2,
  accessSpeedKmh: 30,         // 존 중심 → 접근 노드
  accessDetour: 1.3,

  railTrainsPerDay: [0, 60, 300, 420, 500],  // 선로 수별 일 운행 가능 열차(양방향). 경부고속선 평택–오송 약 380회
  railPaxPerTrain: { hsr: 750, conv: 450 },
  railWaitMin: { hsr: 20, conv: 35, kpConv: 60 },
  railNonACPenalty: 1.15,     // 비전철·직류 구간: 기관차 교체·디젤 운행 지체
  stationRadiusKm: 25,
  stationCandidates: 4,       // 소구역마다 고려하는 역 수
  walkMaxKm: 1.5,             // 이보다 가까운 격자는 역까지 걸어간다
  walkSpeedKmh: 4.5,
  feederSpeedKmh: 22,         // 버스·승용차 연계
  feederPenaltyMin: 10,       // 연계교통 대기·환승
  roadTerminalMin: 3,
  roadConnectors: 6,          // 소구역당 도로 접속 노드 수
  waitScale: 3160,            // 역 대기시간 = waitScale / √(일 이용객): 10만 명이면 10분
  waitMinMin: 8,
  waitMaxMin: 90,

  // --- 수요
  vot: 250,                   // 원/분 (약 15,000원/시)
  carCostPerKm: 160,
  railFarePerKm: { hsr: 150, conv: 90 },
  railDwellMin: 1,            // 역마다 서는 시간 (분). 운행 계통의 통과역은 이만큼 빨라진다
  serviceDayMin: 1080,
  serviceTimeFactor: { limited: 0.92, express: 0.96, local: 1 },  // 특급은 우등 차량·선로 우선권으로 조금 더 빠르다        // 운행 계통의 하루 운행 시간 (분): 대기 ≈ 운행 간격의 절반
  logitLambda: 0.03,          // 수단선택 민감도 (1/분)
  railASC: 10,                // 철도 고유 불편 (분)
  kpRailASCFactor: 0.35,      // 북측 내부 통행은 철도가 주 수단이라 고유 불편을 덜 적용 (자동차·시외버스 부족)
  kpWaitMaxMin: 45,           // 북측 역 대기시간 상한 (적어도 하루 몇 회는 다닌다)
  roadPerceived: { motorway: 0.85, trunk: 1.0, primary: 1.15, secondary: 1.3, ferry: 1.0 }, // 경로 선택 체감 비용 (고속도로 선호)
  gravityPower: 2.0,
  gravityOffsetMin: 30,
  propensityIncomeElasticity: 0.3,
  personsPerCar: 1.4,
  freightPCUShare: 0.3,       // 여객 PCU 대비 화물차 PCU
  targetKrMotorwayVC: 0.65,   // 기준 연도 보정 목표: 남측 고속도로 평균 V/C
  targetKrRailVC: 1.0,        // 기준 연도 보정 목표: 남측 철도 V/C 상위 5% 구간 (경부고속선 등 포화 구간)
  railCalibQuantile: 0.95,
  calibrationRounds: 5,
  railASCStep: 25,            // 보정 반복마다 철도 상수 조정 폭(분)
  msaIterations: 5,
  msaIterationsWarm: 1,       // 해마다 지난해 결과에서 이어 배정할 때
  warmMsaOffset: 3,           // 그때 새 배정을 1/(1+3)만 섞는다

  // --- 대중교통 (버스 + 도시철도)
  busTimeFactor: 1.15,        // 같은 도로에서 승용차 대비 버스 주행시간
  busStopMinPerKm: 1.0,       // 고속도로 밖 정류장 정차 지체 (분/km)
  busAccessFactor: 1.5,       // 정류장까지 접근 (간선 도로망이 성기므로 승용차 접근보다 길게)
  busWaitMin: 8,
  metroWaitMin: 4,
  metroCandidates: 3,
  metroRadiusKm: 6,
  metroTrainsPerDay: 500,     // 양방향
  metroPaxPerTrain: 1000,
  transferMin: 6,             // 도시철도역 ↔ 버스 환승
  transitBaseFare: 1500,      // 원
  transitFarePerKm: 100,      // 10km 초과분
  transitASC: 10,
  transitASCStep: 25,
  targetKrTransitShare: 0.3,  // 기준 연도 보정 목표: 남측 지역 간 통행의 대중교통 분담률 (가정값)
  carlessPenaltyMin: 60,      // 자동차 보유가 적은 지역의 승용차 이용 불편 (소득에 따라 줄어듦)
  carOwnershipIncome: 20000,

  // --- 항공
  airMinKm: 120,              // 이보다 가까운 공항 사이에는 노선을 두지 않는다
  airSpeedKmh: 700,
  airTaxiMin: 25,             // 이착륙·지상 이동
  airTerminalMin: 50,         // 수속·보안검색
  airAccessSpeedKmh: 50,
  airAccessMaxKm: 150,
  airBaseFare: 45000,         // 원
  airFarePerKm: 90,
  airIntlFareFactor: 1.6,
  airASC: 60,                 // 예약·탑승 절차 등 항공 고유 불편 (국내선은 제주처럼 다른 수단이 없을 때 주로 쓰인다)
  airCongestionMin: 60,       // 공항 V/C·노선 탑승률이 1을 넘을 때 1당 추가 지체 (분)
  airSeats: 180,              // 편당 좌석
  airScheduleBase: 360,       // 스케줄 지체 = 360 / 하루 운항 횟수 (분)
  airScheduleMaxMin: 180,

  // --- 국외 연결: 국경·출입국 비용 (분)
  intlBorderMin: { CN: 300, RU: 300, JP: 240 },
  extMassFactor: 0.25,        // 국외 도시의 통행 발생 비중 (언어·비자·생활권 차이로 국내 도시보다 적다)

  // --- 관광
  tourismMass: 15,            // 관광지 하루 방문객 1명을 인구 몇 명분의 목적지 매력으로 볼지
  inboundTourism: 4,          // 국외 출발 관광(입국) 배율: 국외 존 통행 발생 축소(0.25)를 관광에서는 되돌린다

  // --- 남북 통합
  borderPenaltyMin: 300,      // 통합도 0일 때 남북 간 추가 일반화비용(분)
  integrationStart: 0.15,
  integrationPerYear: 0.08,

  // --- 경제·HDI (UNDP 방식)
  incomeKR: 50000,            // 1인당 GNI (PPP $) 가정값
  incomeKP: 2500,             // 가정값 (UNDP 미발표, 한국은행 명목 추정치 기반 추정)
  frontierGrowth: 0.015,
  accessIncomeElasticity: 0.25,
  convergenceKR: 0.10,
  convergenceKPBase: 0.02,
  convergenceKPIntegrated: 0.04,
  accessDecayMin: 90,
  majorCenterPop: 500000,
  healthDecayMin: 120,

  // --- 소구역(읍면동) 인구 이동: 존 안에서 교통 접근이 좋은 곳으로 옮겨 간다
  subRelocationRate: 0.08,    // 해마다 목표 분포 쪽으로 움직이는 비율
  subTransitWeight: 0.03,     // 대중교통 접근 1분당 효용
  subRailWeight: 0.012,       // 지역 간 철도역 접근 1분당 효용
  subDensityElasticity: 0.3,

  // --- 인구
  naturalGrowth: { KR: -0.0015, KP: 0.004 },
  baseOutMigration: 0.03,
  maxNetMigration: 0.05,      // 존별 한 해 순이동 상한 (인구 대비)
  migUtilSensitivity: 0.8,
  migDistanceMin: 180,
  migDensityElasticity: 0.15,
  migAccessWeight: 0.3,
  migPolicyKPtoKR: { free: 1.0, limited: 0.3, closed: 0.05 },
};

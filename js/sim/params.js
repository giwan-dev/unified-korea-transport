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
  signalCapFactor: 1.3,       // 신호 고도화(KTCS-2·CBTC): 열차 간격이 줄어 하루 운행 가능 횟수가 늘어난다
  longTrainFactor: 1.5,       // 장편성(승강장 연장): 열차 한 편성 정원이 늘어난다 (8량 → 12량쯤)
  railWaitMin: { hsr: 20, conv: 35, kpConv: 60 },
  railNonACPenalty: 1.15,     // 비전철·직류 구간: 기관차 교체·디젤 운행 지체
  stationRadiusKm: 25,
  stationCandidates: 4,       // 소구역마다 고려하는 역 수
  walkMaxKm: 1.5,             // 이보다 가까운 격자는 역까지 걸어간다
  walkSpeedKmh: 4.5,
  walkDetour: 1.2,            // 걷는 길의 우회 (골목·횡단보도로 질러 가 연계 교통보다 덜 돈다)
  feederSpeedKmh: 22,         // 버스·승용차 연계
  feederPenaltyMin: 10,       // 연계교통 대기·환승
  roadTerminalMin: 3,
  roadConnectors: 6,          // 소구역당 도로 접속 노드 수
  originGroupKm2: 300,        // 승용차 출발 묶음: 존 면적이 이만큼(km²)의 n²배면 n묶음으로 나눠 경로를 따로 찾는다
  originGroupsMax: 3,
  waitScale: 3160,            // 역 대기시간 = waitScale / √(일 이용객): 10만 명이면 10분
  waitMinMin: 8,
  waitMaxMin: 90,

  // --- 수요
  vot: 250,                   // 원/분 (약 15,000원/시)
  carCostPerKm: 160,
  railFarePerKm: { hsr: 150, conv: 90 },
  railDwellMin: 1,            // 역마다 서는 시간 (분). 운행 계통의 통과역은 이만큼 빨라진다
  serviceDayMin: 1440,        // 24시간 운행
  logitLambda: 0.03,          // 수단선택 민감도 (1/분)
  railASC: 10,                // 철도 고유 불편 (분)
  hsrASC: 0,                  // 고속철도 몫에 더하는 상수 (분, 기준 연도 보정으로 정함)
  kpRailASCFactor: 0,         // 북측 내부 통행은 철도가 주 수단이라 고유 불편을 두지 않는다 (자동차·시외버스 부족)
  kpWaitMaxMin: 30,           // 북측 역 대기시간 상한 (적어도 하루 몇 회는 다닌다)
  kpGravityImpedance: 0.4,    // 북측 안 통행의 중력모형 마찰: 일반화비용의 이만큼만 친다 (도로 사정 탓에 비용이 과대하게 잡힘)
  roadPerceived: { motorway: 0.85, trunk: 1.0, primary: 1.15, secondary: 1.3, ferry: 1.0 }, // 경로 선택 체감 비용 (고속도로 선호)
  gravityPower: 2.0,
  gravityOffsetMin: 30,
  propensityIncomeElasticity: 0.3,
  personsPerCar: 1.4,
  freightPCUShare: 0.3,       // 여객 PCU 대비 화물차 PCU
  targetKrMotorwayVC: 0.65,   // 기준 연도 보정 목표: 남측 고속도로 평균 V/C
  targetKrRailVC: 1.2,        // 기준 연도 보정 목표: 남측 고속철도 V/C 상위 5% 구간 (경부고속선 평택–오송 등 포화 구간, 입석 포함)
  targetKrConvVC: 0.65,       // 기준 연도 보정 목표: 남측 일반철도 V/C 상위 5% 구간 (경부선·경인선 수도권 구간)
  railCalibQuantile: 0.95,
  calibrationRounds: 7,
  calibVersion: 6,            // 보정 방식이 바뀌면 올린다: 예전 기준 연도(data/baseline.json)는 쓰지 않고 새로 보정한다
  railASCStep: 25,            // 보정 반복마다 철도 상수 조정 폭(분)
  msaIterations: 5,
  msaIterationsWarm: 1,       // 해마다 지난해 결과에서 이어 배정할 때. 새 배정은 warmMsaOffset만큼 묽게(1/4) 섞어 경로가 튀지 않는다 (2번이면 연도 넘기기가 두 배)
  warmMsaOffset: 3,           // 그때 새 배정을 1/4, 1/5씩 섞는다

  // --- 대중교통 (버스 + 도시철도)
  busTimeFactor: 1.15,        // 같은 도로에서 승용차 대비 버스 주행시간
  busStopMinPerKm: 1.0,       // 고속도로 밖 정류장 정차 지체 (분/km)
  busAccessFactor: 1.5,       // 정류장까지 접근 (간선 도로망이 성기므로 승용차 접근보다 길게)
  busWaitMin: 10,             // 도심 버스 배차 (도시철도보다 성기다)
  metroWaitMin: 3,
  carParkDensLo: 3000,        // 도착지 주차 부담: 밀도(명/km²)가 이보다 낮으면 없음
  carParkDensHi: 20000,       // 이 밀도 이상이면 최대 (서울 도심)
  carParkMaxMin: 10,          // 주차장 찾기·걷기 (분)
  carParkMaxFee: 3000,        // 주차 요금 (원)
  metroCandidates: 3,
  metroRadiusKm: 6,
  metroLocalRate: 0.2,        // 역세권(반경 800m) 주민 1명당 하루 구 안 도시철도 승차 (존 사이 통행은 따로 배정)
  metroLocalKm: 5,            // 구 안 도시철도 통행 평균 거리 (km)
  metroCrowdAlpha: 0.3,       // 도시철도 혼잡 체감: 시간 × (1 + α·(V/C)^β), 혼잡도 1이면 1.3배, 1.5면 약 2배
  metroCrowdBeta: 3,
  metroCrowdMax: 3,
  // --- 존(시군구) 안 짧은 통행 (도시철도 사업 편익: 효과 미리보기에서만 쓴다, model.localTransitCost)
  localTripRate: 1.0,         // 존 인구 1명당 하루 존 안 동(읍면동) 사이 통행 (걷기만 하는 같은 동 안 통행은 뺀다)
  localTripKm: 3,             // 존 안 통행의 거리 감쇠 (중력식 exp(−거리/이 값))
  localDetour: 1.3,           // 동 중심 사이 직선거리 → 실제 길
  localCarKmh: 22,            // 도심 승용차 평균 속도
  localCarExtraMin: 8,        // 승용차: 주차·걷기
  localBusKmh: 15,            // 시내버스 평균 속도 (정차 포함)
  localBusExtraMin: 12,       // 버스: 정류장까지 걷기 + 기다림
  localTheta: 0.1,            // 수단 선택 로짓 계수 (1/분)
  localMaxMin: 75,            // 이보다 긴 철도 경로는 보지 않는다
  localRailKmh: 45,           // 존 안 통행에서 일반철도(광역전철) 구간 속도
  localRailWaitMax: 20,       // 존 안 통행에서 일반철도역 기다림 상한 (분)
  metroTrainsPerDay: 500,     // 양방향
  metroPaxPerTrain: 1000,
  transferMin: 6,             // 도시철도역 ↔ 버스 환승
  metroRailTransferMin: 12,   // 환승 연결을 지은 도시철도역 ↔ 일반철도역 갈아타기 (도시철도 기다림 + 걷기)
  metroFeedMaxMin: 45,        // 도시철도로 연결역까지 가는 길은 이보다 길면 후보로 치지 않는다
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
  airHubAccessKm: 300,        // 허브 공항(인천)은 국제선을 타러 이만큼 멀리서도 간다
  airportRailKm: 2,           // 공항에서 이만큼 안의 역은 공항역 (철도로 공항에 갈 수 있다)
  airRailWalkMin: 8,          // 공항역 → 터미널
  airBaseFare: 45000,         // 원
  airFarePerKm: 90,
  airFareTaperKm: 1500,       // 이보다 먼 거리는 km당 운임이 줄어든다 (장거리 대형기)
  airFarePerKmLong: 25,
  airHubIntlMin: 45,          // 허브 공항(인천) 국제선 이점: 잦은 운항·연결편·대형기 (분)
  airIntlFareFactor: 1.6,
  airASC: 60,                 // 예약·탑승 절차 등 항공 고유 불편 (국내선은 제주처럼 다른 수단이 없을 때 주로 쓰인다)
  airCongestionMin: 120,      // 공항 V/C·노선 탑승률이 1을 넘을 때 1당 추가 지체 (분)
  airSeats: 180,              // 편당 좌석
  airScheduleBase: 360,       // 스케줄 지체 = 360 / 하루 운항 횟수 (분)
  airScheduleMaxMin: 180,

  // --- 국외 연결: 국경·출입국 비용 (분)
  intlBorderMin: { CN: 300, RU: 300, JP: 240, HK: 120, TH: 120, VN: 120, PH: 150, SG: 120, AU: 180, US: 180, CA: 180, DE: 150, FR: 150, GB: 150 },
  extMassFactor: 0.25,        // 국외 도시의 통행 발생 비중 (언어·비자·생활권 차이로 국내 도시보다 적다)
  koreanDiasporaFactor: 0.8,  // 국외 거점의 한민족(조선족 등) 인구는 국내 인구의 이만큼으로 친다 (친척 방문·일·장사, 국경 수속은 그대로)

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

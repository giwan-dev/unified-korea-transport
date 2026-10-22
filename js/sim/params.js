// 모델 파라미터. 근거와 한계는 docs/model.md 참고.
// 공개 자료만으로 보정한 게임용 값이며 예타 수준의 정밀도를 목표로 하지 않는다.

export const P = {
  // --- 교통망
  roadCapPerLaneHour: { motorway: 2000, trunk: 1600, primary: 1100, secondary: 800 },
  dailyFactor: 10,            // 일교통량 / 첨두시 용량 환산 (K계수 약 10%)
  bprAlpha: 0.15,
  bprBeta: 4,
  bprMaxRatio: 6,
  unpavedCapFactor: 0.6,
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
  roadConnectors: 3,          // 소구역당 도로 접속 노드 수
  waitScale: 3160,            // 역 대기시간 = waitScale / √(일 이용객): 10만 명이면 10분
  waitMinMin: 8,
  waitMaxMin: 90,

  // --- 수요
  vot: 250,                   // 원/분 (약 15,000원/시)
  carCostPerKm: 160,
  railFarePerKm: { hsr: 150, conv: 90 },
  logitLambda: 0.03,          // 수단선택 민감도 (1/분)
  railASC: 10,                // 철도 고유 불편 (분)
  gravityPower: 2.0,
  gravityOffsetMin: 30,
  propensityIncomeElasticity: 0.3,
  personsPerPCU: 2.0,
  freightPCUShare: 0.3,       // 여객 PCU 대비 화물차 PCU
  targetKrMotorwayVC: 0.65,   // 기준 연도 보정 목표: 남측 고속도로 평균 V/C
  targetKrRailVC: 1.0,        // 기준 연도 보정 목표: 남측 철도 V/C 상위 5% 구간 (경부고속선 등 포화 구간)
  railCalibQuantile: 0.95,
  calibrationRounds: 5,
  railASCStep: 25,            // 보정 반복마다 철도 상수 조정 폭(분)
  msaIterations: 3,

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

  // --- 인구
  naturalGrowth: { KR: -0.0015, KP: 0.004 },
  baseOutMigration: 0.03,
  migUtilSensitivity: 0.8,
  migDistanceMin: 180,
  migDensityElasticity: 0.15,
  migAccessWeight: 0.3,
  migPolicyKPtoKR: { free: 1.0, limited: 0.3, closed: 0.05 },
};

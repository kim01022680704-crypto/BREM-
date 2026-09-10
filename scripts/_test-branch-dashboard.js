const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const regionDashboard = require(path.join(root, 'server', 'rider-region-dashboard.js'));
const T = regionDashboard.__test;

const files = {
  server: fs.readFileSync(path.join(root, 'server', 'rider-region-dashboard.js'), 'utf8'),
  index: fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8'),
  admin: fs.readFileSync(path.join(root, 'js', 'driver-management-admin.js'), 'utf8'),
  storage: fs.readFileSync(path.join(root, 'js', 'storage.js'), 'utf8'),
  rider: fs.readFileSync(path.join(root, 'js', 'driver-branch-dashboard.js'), 'utf8'),
  nav: fs.readFileSync(path.join(root, 'js', 'driver-app-nav.js'), 'utf8'),
  html: fs.readFileSync(path.join(root, 'driver.html'), 'utf8')
};

let failed = 0;
function check(label, value) {
  const ok = Boolean(value);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}`);
}

const REGION = {
  key: 'DP100000',
  partnerId: 'DP100000',
  label: '테스트지사',
  platform: 'baemin'
};
const exposure = {
  baemin: {
    DP100000: {
      label: '테스트지사',
      partnerId: 'DP100000',
      branchManagers: {
        managerA: { enabled: true }
      }
    }
  },
  coupang: {}
};

console.log('\n[1] 플랫폼·지역별 지사장 권한');
check('등록 기사 권한 허용', T.isBranchManagerForRegion(exposure, REGION, 'managerA'));
check('미등록 기사 권한 거부', !T.isBranchManagerForRegion(exposure, REGION, 'riderB'));
check('다른 플랫폼 권한 격리', !T.isBranchManagerForRegion(exposure, { ...REGION, platform: 'coupang' }, 'managerA'));
const regions = T.listBranchManagerRegions(exposure, 'baemin', 'managerA');
check('허용 지역만 목록 반환', regions.length === 1 && regions[0].key === 'DP100000');

console.log('\n[2] 서버 API와 저장');
check('기사 API 라우트 존재', files.index.includes("app.get('/api/rider/branch-dashboard'"));
check('기사 세션 인증 사용', /getRiderBranchDashboard[\s\S]*?getRiderMe\(accessToken\)/.test(files.server));
check('요청 지역 권한 재검증', files.server.includes('isBranchManagerForRegion(exposure, selected'));
check('관리자 권한 저장 분기', /body\.branchManager != null[\s\S]*?branchManagers\[driverId\]/.test(files.server));
check('스토리지 기사 API 래퍼', files.storage.includes('fetchRiderBranchDashboardFromServer'));
check('메뉴 노출은 probe로 권한만 확인', files.index.includes('req.query.probe') && files.rider.includes('probe: true'));
check('집계 실패해도 지사장 권한은 유지', /isBranchManager: true[\s\S]*?지사관리 현황을 불러오지 못했습니다/.test(files.server));

console.log('\n[3] 관리자와 기사앱 연결');
check('기사지역관리 등록 버튼', files.admin.includes('data-region-rider-branch='));
const adminClickBlock = files.admin.match(/document\.addEventListener\('click'[\s\S]*?document\.addEventListener\('change'/)?.[0] || '';
check('지사장 버튼은 click 이벤트에서 처리', adminClickBlock.includes("closest('[data-region-rider-branch]')"));
check('기사앱 지사관리 패널', files.html.includes('id="driverBranchDashboardPanel"'));
check('기사앱 지사관리 게이트 메뉴', files.html.includes('data-driver-tab="branch"'));
check('내비게이션 branch 게이트', files.nav.includes("branch: nav.querySelector('[data-driver-tab=\"branch\"]')"));
check('배민 운행 기사 상세', files.rider.includes('operatingRiders'));
check('쿠팡 온라인 이름 제한 안내', files.rider.includes('온라인 기사 이름 대신'));
check('주간 할당 달성 렌더', files.rider.includes('weeklyProgress'));
check('오늘 칸은 실시간 크롤', files.server.includes('mergeLiveDaySlots') && files.server.includes("source_menu', 'peak_realtime'"));
check('배민 오늘 배달현황 합산', files.server.includes('sumBaeminDeliverySlotTotals'));
check('오늘 실시간 표기', files.rider.includes('오늘은 실시간'));

console.log('\n[4] 오늘 실시간 슬롯 덮어쓰기');
const merged = T.mergeLiveDaySlots(
  [{
    date: '2026-09-09',
    goal: 100,
    completed: 0,
    slots: [
      { key: 'morning', label: '아침점심', goal: 25, completed: 0, rate: 0 },
      { key: 'evening', label: '저녁', goal: 30, completed: 0, rate: 0 }
    ]
  }],
  '2026-09-09',
  { morning: { completed: 18 }, evening: { completed: 22 } },
  ['morning', 'evening'],
  { morning: '아침점심', evening: '저녁' }
);
check('오늘 칸 live 표시', merged[0].live === true);
check('오늘 아침 완료 반영', merged[0].slots[0].completed === 18 && merged[0].slots[0].goal === 25);
check('오늘 합계 갱신', merged[0].completed === 40);

const coupangMerged = T.mergeLiveDaySlots(
  [{
    date: '2026-09-09',
    goal: 60,
    completed: 0,
    slots: [{ key: 'DINNER', label: '저녁피크', goal: 27, completed: 0, rate: 0 }]
  }],
  '2026-09-09',
  { DINNER: { goal: 27, completed: 24.2 } },
  ['DINNER'],
  { DINNER: '저녁피크' }
);
check('쿠팡 저녁피크 실시간 반영', coupangMerged[0].slots[0].completed === 24.2);

console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
process.exit(failed ? 1 : 0);

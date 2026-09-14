const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'driver.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/gi, '');
const source = fs.readFileSync(path.join(root, 'js', 'driver-branch-dashboard.js'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'http://localhost/driver.html'
});
const { window } = dom;
window.HTMLElement.prototype.scrollIntoView = () => {};
window.BremDatePicker = {
  weekStartKey: () => '2026-09-02'
};
window.BremStorage = {
  async fetchRiderBranchDashboardFromServer({ platform }) {
    if (platform === 'coupang') {
      return { ok: true, isBranchManager: false, platform, regions: [] };
    }
    return {
      ok: true,
      isBranchManager: true,
      platform,
      today: '2026-09-07',
      weekStart: '2026-09-02',
      weekEnd: '2026-09-08',
      regions: [{ key: 'DP1', label: '남구지사', platform: 'baemin' }],
      selectedRegionKey: 'DP1',
      region: { key: 'DP1', label: '남구지사', platform: 'baemin' },
      registeredCount: 17,
      metrics: { assigned: 150, slotComplete: 114, operating: 5, progressLabel: '114/150' },
      operatingRiders: [{ driverId: 'r1', name: '테스트기사', status: '운행중', callCount: 8, acceptRate: 96.5 }],
      weeklyProgress: {
        goal: 700,
        completed: 560,
        rate: 80,
        days: [{
          date: '2026-09-07',
          live: true,
          goal: 100,
          completed: 80,
          slots: [
            { key: 'morning', label: '아침점심', goal: 25, completed: 20, rate: 80 },
            { key: 'afternoon', label: '오후', goal: 25, completed: 20, rate: 80 },
            { key: 'evening', label: '저녁', goal: 30, completed: 24, rate: 80 },
            { key: 'midnight', label: '심야', goal: 20, completed: 16, rate: 80 }
          ]
        }]
      },
      weeklyRanking: []
    };
  }
};

let failed = 0;
function check(label, value) {
  const ok = Boolean(value);
  if (!ok) failed += 1;
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}`);
}

(async () => {
  window.eval(source);
  await new Promise(resolve => setTimeout(resolve, 20));
  check('권한 확인 후 지사관리 진입 버튼 노출', !window.document.getElementById('driverBranchDashboardBtn').hidden);

  window.BremDriverBranchDashboard.open();
  await new Promise(resolve => setTimeout(resolve, 20));
  check('지사관리 패널 열림', !window.document.getElementById('driverBranchDashboardPanel').hidden);
  check('현재 완료/할당 표시', window.document.getElementById('driverBranchAssigned').textContent === '114/150');
  check('운행중 인원 표시', window.document.getElementById('driverBranchOperating').textContent === '5명');
  check('주간 ERP 요약 표시', window.document.getElementById('driverBranchWeeklySummary').textContent.includes('80%'));
  check('운행 기사명 표시', window.document.getElementById('driverBranchRiderList').textContent.includes('테스트기사'));
  check('배민 수락률 표시', window.document.getElementById('driverBranchRiderList').textContent.includes('수락 96.5%'));
  check('기사 목록 인원수 표시', window.document.getElementById('driverBranchRiderListCount').textContent === '1명');
  window.document.getElementById('driverBranchRiderSearch').value = '없는기사';
  window.document.getElementById('driverBranchRiderSearch').dispatchEvent(new window.Event('input'));
  check('기사 이름 검색', window.document.getElementById('driverBranchRiderList').textContent.includes('검색된 기사가 없습니다.'));
  window.document.getElementById('driverBranchRiderSearch').value = '';
  window.document.getElementById('driverBranchRiderSearch').dispatchEvent(new window.Event('input'));

  window.document.getElementById('driverBranchErpDashboardBtn').click();
  check('ERP 타임별 팝업 열림', !window.document.getElementById('driverBranchDetailPopup').hidden);
  check('ERP 시간대별 현황 표시', window.document.getElementById('driverBranchDetailRows').textContent.includes('아침점심'));
  check('ERP 완료·할당·운행중 요약 표시', window.document.querySelector('.driver-branch-erp-kpis').textContent.includes('현재 완료'));
  check('날짜 옆 요일 표시', window.document.getElementById('driverBranchDetailRows').textContent.includes('09.07(월)'));
  check('오늘 실시간 표시', window.document.getElementById('driverBranchDetailRows').textContent.includes('오늘'));
  check('오늘은 실시간 안내', window.document.getElementById('driverBranchDetailSummary').textContent.includes('오늘은 실시간'));
  check('달성·미달성 태그 표시', window.document.getElementById('driverBranchDetailRows').textContent.includes('미달성'));
  window.document.querySelector('[data-branch-detail-close]').click();

  window.document.getElementById('driverBranchOperatingDetailBtn').click();
  check('운행 상세 팝업 열림', !window.document.getElementById('driverBranchDetailPopup').hidden);
  check('운행 상세 기사명 표시', window.document.getElementById('driverBranchDetailRows').textContent.includes('테스트기사'));
  window.document.querySelector('[data-branch-detail-close]').click();

  window.BremStorage.fetchRiderBranchDashboardFromServer = async ({ platform }) => ({
    ok: true,
    isBranchManager: true,
    platform,
    weekStart: '2026-09-02',
    weekEnd: '2026-09-08',
    regions: [{ key: 'CP1', label: '쿠팡지사', platform }],
    selectedRegionKey: 'CP1',
    region: { key: 'CP1', label: '쿠팡지사', platform },
    metrics: { assigned: 100, slotComplete: 50, operating: 3, progressLabel: '50/100' },
    weeklyProgress: { goal: 100, completed: 50, rate: 50, days: [] },
    performanceRiders: []
  });
  window.document.querySelector('[data-branch-platform="coupang"]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  check('플랫폼 한 번 클릭으로 전환', window.document.querySelector('[data-branch-platform="coupang"]').getAttribute('aria-selected') === 'true');

  window.BremDriverBranchDashboard.close();
  dom.window.close();
  console.log(`\n${failed ? `실패 ${failed}건` : '전부 통과'}`);
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.error(error);
  dom.window.close();
  process.exit(1);
});

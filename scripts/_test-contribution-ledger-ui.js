const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8')
  .replace(/<script[\s\S]*?<\/script>/gi, '');
const source = fs.readFileSync(path.join(root, 'js', 'contribution-admin.js'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://brem.kr/admin.html' });
const { window } = dom;

window.BremStorage = { resolveAdminAccessToken: async () => 'test-token' };
window.confirm = () => true;
window.showToast = () => {};

const calls = [];
window.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  const pathName = String(url);
  let payload;
  if (pathName.includes('/config') && String(options.method || 'GET') === 'GET') {
    payload = {
      ok: true,
      config: {
        active: true,
        activatedAt: '2026-09-07T12:00:00.000Z',
        version: 2,
        baeminPointsPerCall: 10,
        coupangPoints08: 8,
        coupangPoints10: 10
      }
    };
  } else if (pathName.includes('/daily')) {
    payload = {
      ok: true,
      totals: { count: 1, pointsSum: 30, creditedCalls: 3, frozen: 1, live: 0 },
      regions: [{
        platform: 'baemin',
        region: '양산A',
        vendor_or_partner: 'DP1',
        slot_key: 'evening',
        completed: 105,
        target: 100,
        rate: 100,
        weighted_calls: 3,
        credited_calls: 3,
        points: 30,
        frozen: true,
        captured_at: '2026-09-07T12:10:00.000Z'
      }, {
        platform: 'baemin',
        region: '양산B',
        vendor_or_partner: 'DP2',
        slot_key: 'morning',
        completed: 40,
        target: 100,
        rate: 40,
        weighted_calls: 1,
        credited_calls: 1,
        points: 10,
        frozen: false,
        captured_at: '2026-09-07T03:10:00.000Z'
      }],
      items: [{
        date: '2026-09-07',
        platform: 'baemin',
        region: '양산A',
        rider_id: 'r1',
        rider_name: '테스트기사',
        erp_id: '테스트기사1234',
        baemin_id: 'BAEMIN-001',
        slot_key: 'evening',
        credited_calls: 3,
        points: 30,
        frozen: true,
        matched: true,
        assigned_region: '양산A',
        region_matched: true,
        raw_json: {
          states: [{ region_complete: 105, assigned_target: 100, frozen: true }],
          events: [{
            date: '2026-09-07',
            region: '양산A',
            slot_key: 'evening',
            captured_at: '2026-09-07T12:10:00.000Z',
            weighted_delta: 3,
            credited_calls: 3,
            count_08: 0,
            count_10: 0,
            points: 30,
            rule_version: 2
          }]
        }
      }, {
        date: '2026-09-07',
        platform: 'baemin',
        region: '양산A',
        rider_id: 'r1',
        rider_name: '테스트기사',
        erp_id: '테스트기사1234',
        baemin_id: 'BAEMIN-001',
        slot_key: 'afternoon',
        credited_calls: 1,
        points: 10,
        frozen: true,
        matched: true,
        assigned_region: '양산A',
        region_matched: true,
        raw_json: {
          states: [{ region_complete: 80, assigned_target: 100, frozen: true }],
          events: [{
            date: '2026-09-07',
            region: '양산A',
            slot_key: 'afternoon',
            captured_at: '2026-09-07T08:10:00.000Z',
            points: 10,
            rule_version: 2
          }]
        }
      }, {
        date: '2026-09-07',
        platform: 'baemin',
        region: '양산B',
        rider_id: 'r2',
        rider_name: '아침기사',
        erp_id: '아침기사5678',
        baemin_id: 'BAEMIN-002',
        slot_key: 'morning',
        credited_calls: 1,
        points: 10,
        frozen: false,
        matched: true,
        assigned_region: '양산B',
        region_matched: true,
        raw_json: {
          states: [{ region_complete: 40, assigned_target: 100, frozen: false }],
          events: []
        }
      }]
    };
  } else {
    payload = { ok: true };
  }
  if (pathName.includes('/daily') && pathName.includes('period=week')) {
    payload.period = 'week';
    payload.fromDate = '2026-09-07';
    payload.toDate = '2026-09-13';
    payload.items = payload.items.map(item => ({ ...item, slot_key: 'weekly', frozen: false }));
  }
  return { ok: true, status: 200, json: async () => payload };
};

(async () => {
  window.eval(source);
  await window.BremContributionAdmin.refresh();

  assert.strictEqual(window.document.getElementById('contributionLedgerBadge').textContent, '집계 중');
  assert(window.document.getElementById('contributionLedgerStatus').textContent.includes('규칙 v2'));
  assert(window.document.getElementById('contributionLedgerStatus').textContent.includes('24시간 자동 집계'));
  assert(source.includes('dateLocked'));
  assert(source.includes('applyLiveDate()'));
  assert(source.includes('영업일 ${state.date} 기여도로 이동합니다.'));
  assert(window.document.getElementById('contributionTable').textContent.includes('테스트기사'));
  assert(window.document.getElementById('contributionTable').textContent.includes('테스트기사1234'));
  assert(window.document.getElementById('contributionTable').textContent.includes('BAEMIN-001'));
  assert(window.document.getElementById('contributionTable').textContent.includes('40점'));
  assert(window.document.getElementById('contributionTable').textContent.includes('전체 포인트'));
  assert(window.document.getElementById('contributionTable').textContent.includes('매칭'));
  assert(window.document.getElementById('contributionTable').textContent.includes('지역일치'));
  assert(window.document.getElementById('contributionSummary').textContent.includes('전체 포인트'));
  assert(window.document.getElementById('contributionSummary').textContent.includes('지역매칭 2/2'));
  assert(window.document.getElementById('contributionSummary').textContent.includes('정확도 100%'));
  assert(window.document.getElementById('contributionTable').textContent.includes('마감'));
  assert(!window.document.getElementById('contributionTable').textContent.includes('할당진행'));
  assert(window.document.getElementById('contributionRegionProgress').textContent.includes('105 / 100'));
  assert(window.document.getElementById('contributionRegionProgress').textContent.includes('달성'));
  assert(window.document.getElementById('contributionRegionProgress').textContent.includes('30점'));
  assert(window.document.getElementById('contributionRegionMenu').textContent.includes('양산A'));
  assert(window.document.getElementById('contributionRegionMenu').textContent.includes('양산B'));

  window.document.querySelector('[data-contribution-region="양산A"]').click();
  assert(window.document.getElementById('contributionSlotMenu').textContent.includes('저녁'));
  assert(!window.document.getElementById('contributionTable').textContent.includes('아침기사'));
  window.document.querySelector('[data-contribution-slot="evening"]').click();
  assert(window.document.getElementById('contributionSummary').textContent.includes('양산A'));
  assert(window.document.getElementById('contributionSummary').textContent.includes('저녁'));
  assert(window.document.getElementById('contributionTable').textContent.includes('30점'));
  assert(!window.document.getElementById('contributionTable').textContent.includes('40점'));

  window.document.querySelector('[data-contribution-slot=""]').click();
  assert(window.document.getElementById('contributionSummary').textContent.includes('전체 타임'));
  assert(window.document.getElementById('contributionTable').textContent.includes('40점'));

  const search = window.document.getElementById('contributionSearch');
  search.value = '테스트기사1234';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 180));
  assert(window.document.getElementById('contributionTable').textContent.includes('테스트기사'));

  window.document.querySelector('[data-contribution-detail]').click();
  assert.strictEqual(window.document.getElementById('contributionEventPopup').hidden, false);
  assert(window.document.getElementById('contributionEventTable').textContent.includes('30'));
  assert(window.document.getElementById('contributionEventTable').textContent.includes('9월 7일 · 배민 · 저녁'));
  assert(window.document.getElementById('contributionEventTable').textContent.includes('+30점'));
  assert(window.document.getElementById('contributionEventSummary').textContent.includes('40점'));
  assert(!window.document.getElementById('contributionEventTable').textContent.includes('인정 3콜'));
  window.document.querySelector('[data-contribution-event-close]').click();

  window.document.querySelector('[data-contribution-period="week"]').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert(calls.some(call => call.url.includes('period=week')));
  assert(window.document.getElementById('contributionSummary').textContent.includes('주간 기여도'));
  assert(window.document.getElementById('contributionSummary').textContent.includes('2026-09-07 ~ 2026-09-13'));
  assert(window.document.getElementById('contributionTable').textContent.includes('주간합계'));
  assert.strictEqual(window.document.getElementById('contributionSlotSubmenu').hidden, true);
  assert.strictEqual(window.document.getElementById('contributionEventPopup').hidden, true);

  window.document.querySelector('[data-contribution-platform="coupang"]').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(
    window.document.querySelector('[data-contribution-platform="coupang"]').getAttribute('aria-selected'),
    'true'
  );
  assert(calls.some(call => call.url.includes('platform=coupang')));

  dom.window.close();
  console.log('contribution ledger UI tests: OK');
})().catch(error => {
  console.error(error);
  dom.window.close();
  process.exit(1);
});

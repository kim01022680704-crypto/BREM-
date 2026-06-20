/**
 * 배민Biz delivery-status API 수집 가능 여부 점검 (쿠키 기반)
 * Run: node scripts/test-baemin-delivery-feasibility.js
 *
 * 환경변수:
 *   BAEMIN_BIZ_SESSION_COOKIE — 배민Biz 로그인 후 복사한 Cookie 헤더 값
 */
require('dotenv').config();

const {
  fetchAllDeliveryStatus,
  resolveSessionCookie,
  isPlaywrightFeasibleOnVercel
} = require('../server/baemin-delivery-collect');

async function main() {
  console.log('=== Playwright on Vercel ===');
  console.log(JSON.stringify(isPlaywrightFeasibleOnVercel(), null, 2));

  const cookie = resolveSessionCookie({});
  if (!cookie) {
    console.error('\nFAIL: BAEMIN_BIZ_SESSION_COOKIE 가 설정되지 않았습니다.');
    console.error('배민Biz(deliverycenter.baemin.com)에 로그인 → DevTools → Network → delivery-status 요청의 Cookie 값을 복사하세요.');
    process.exit(1);
  }

  console.log('\n=== Cookie fetch test (page=0) ===');
  const result = await fetchAllDeliveryStatus(cookie);
  if (!result.ok) {
    console.error('FAIL:', result.message || result.error);
    process.exit(1);
  }

  console.log('OK');
  console.log('  totalPage:', result.meta?.totalPage);
  console.log('  raw riders:', result.meta?.rawCount);
  console.log('  unique riders:', result.items.length);
  console.log('  duplicates skipped:', result.meta?.duplicateCount);
  if (result.items[0]) {
    console.log('  sample:', {
      name: result.items[0].name,
      userId: result.items[0].userId,
      totalComplete: result.items[0].deliveryAcceptanceCount?.totalComplete
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

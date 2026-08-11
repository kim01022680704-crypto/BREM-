/**
 * 수요일 전주 수~화 크롤 범위 회귀
 * Run: node scripts/test-crawl-week-range.js
 */
const assert = require('assert');
const { settlementWeekStart, latestQueryableDate } = require('../server/baemin-settlement-week');
const { computeCrawlWeekRangeFromLatest } = require('../server/crawl-session-auth');

function fakeNow(isoUtc) {
  return new Date(isoUtc);
}

function testWednesdayKeepsPrevWeekTuesday() {
  // 2026-08-12 수요일 10:00 KST = 2026-08-12T01:00:00Z
  const now = fakeNow('2026-08-12T01:00:00.000Z');
  const today = '2026-08-12';
  const latest = latestQueryableDate(today, now);
  // 수요일 낮 → 조회 가능 최신일은 보통 화요일
  assert.strictEqual(latest, '2026-08-11');
  const range = computeCrawlWeekRangeFromLatest(latest, settlementWeekStart);
  assert.strictEqual(range.fromDate, '2026-08-05'); // 전주 수
  assert.strictEqual(range.toDate, '2026-08-11'); // 전주 화
  console.log('✓ Wednesday keeps previous Wed~Tue', range.label);
}

function testThursdayUsesCurrentWeek() {
  // 2026-08-13 목요일 10:00 KST
  const now = fakeNow('2026-08-13T01:00:00.000Z');
  const today = '2026-08-13';
  const latest = latestQueryableDate(today, now);
  assert.strictEqual(latest, '2026-08-12');
  const range = computeCrawlWeekRangeFromLatest(latest, settlementWeekStart);
  assert.strictEqual(range.fromDate, '2026-08-12');
  assert.strictEqual(range.toDate, '2026-08-12');
  console.log('✓ Thursday uses new week start', range.label);
}

function testAuthLabels() {
  const auth = require('../server/crawl-session-auth');
  assert.strictEqual(auth.resolveBaeminAuthState({ sessionLoggedIn: true }), 'ok');
  assert.strictEqual(auth.resolveBaeminAuthState({
    currentUrl: 'https://bizmember.baemin.com/login'
  }), 'authRequired');
  assert.strictEqual(auth.resolveBaeminAuthState({ recovering: true }), 'recovering');
  // 배달현황 URL의 phoneNumber= 쿼리를 휴대폰 인증으로 오판하면 안 됨
  const historyUrl = 'https://deliverycenter.baemin.com/delivery/history?page=0&phoneNumber=&riderStatus=';
  assert.strictEqual(auth.isBaeminPhoneAuthLikeUrl(historyUrl), false);
  assert.strictEqual(auth.isBaeminLoginLikeUrl(historyUrl), false);
  assert.strictEqual(auth.resolveBaeminAuthState({
    sessionLoggedIn: true,
    currentUrl: historyUrl,
    sessionPaused: true
  }), 'ok');
  assert.strictEqual(auth.resolveCoupangAuthState({ hasToken: true }), 'ok');
  assert.strictEqual(auth.resolveCoupangAuthState({ hasToken: false }), 'authRequired');
  console.log('✓ authState labels');
}

function testOtpExtract() {
  const { extractOtpFromText } = require('../server/coupang-naver-otp');
  assert.strictEqual(extractOtpFromText('쿠팡 인증번호: 123456 입니다'), '123456');
  assert.strictEqual(extractOtpFromText('OTP 987654'), '987654');
  console.log('✓ naver otp extract');
}

testWednesdayKeepsPrevWeekTuesday();
testThursdayUsesCurrentWeek();
testAuthLabels();
testOtpExtract();
console.log('\nAll crawl week/auth tests passed.');

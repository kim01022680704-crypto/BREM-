/** 배민 BIZ 수집 기간 계산 진단 (읽기 전용, 네트워크 접속 없음) */
const W = require('../server/baemin-settlement-week');

const today = W.todayKST();
const weekday = W.weekdayKST(today);
const names = ['일', '월', '화', '수', '목', '금', '토'];

console.log(`오늘(KST): ${today} (${names[weekday]}요일) · KST ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
console.log(`정산주 시작(수): ${W.settlementWeekStart(today)}`);
console.log(`정산주 끝(화):   ${W.settlementWeekEnd(today)}`);
console.log(`조회가능 최신일: ${W.latestQueryableDate(today)}`);
console.log('');

const hist = W.computeHistoryCollectRange(today);
console.log('--- computeHistoryCollectRange (전날 포함 8일) ---');
console.log(`  mode=${hist.mode} skipped=${hist.skipped} label=${hist.label}`);
console.log(`  fromDate=${hist.fromDate} toDate=${hist.toDate} dayCount=${hist.dayCount}`);
if (hist.skipReason) console.log(`  skipReason=${hist.skipReason}`);
console.log('');

const loop = W.computeHistoryLookbackRange();
console.log('--- computeThisWeekRangeForLoop (자동현황 1회차 = 전날 포함 8일) ---');
console.log(`  latestQueryable(어제)=${loop.latestQueryableDate}`);
console.log(`  label=${loop.label}`);
console.log('');

const plan = W.buildBizMenuDateRanges(today, new Date(), null);
console.log('--- buildBizMenuDateRanges (저장된 기간 없을 때 기본값) ---');
Object.entries(plan).forEach(([id, range]) => {
  if (!range || typeof range !== 'object') return;
  console.log(`  ${id}: ${range.label || '-'} (${range.fromDate || '-'} ~ ${range.toDate || '-'}, ${range.dayCount ?? '-'}일)`);
});
console.log('');

console.log('--- 요일별 시뮬레이션 (전날 포함 8일) ---');
for (let i = 0; i < 8; i += 1) {
  const day = W.addDays('2026-07-29', i);
  const noon = new Date(`${day}T12:00:00+09:00`);
  const range = W.computeHistoryLookbackRange(day, noon);
  const note = W.weekdayKST(day) === 3 ? '  ← 수요일: 어제(화) 포함' : '';
  console.log(`  ${day}(${names[W.weekdayKST(day)]}) 어제=${range.latestQueryableDate} → ${range.fromDate} ~ ${range.toDate} (${range.dayCount}일)${note}`);
}
console.log('');

const yesterday = loop.latestQueryableDate;
console.log('--- 어제(=' + yesterday + ') 가 포함되는가 ---');
const dailyDates = plan.daily_history?.dates || [];
const riderDates = plan.rider_history?.dates || [];
console.log(`  기본 일별 범위에 포함: ${dailyDates.includes(yesterday) ? '예' : '아니오'}`);
console.log(`  기본 라이더 범위에 포함: ${riderDates.includes(yesterday) ? '예' : '아니오'}`);
console.log(`  자동현황 1회차 범위에 포함: ${(loop.dates || []).includes(yesterday) ? '예' : '아니오'}  (범위 ${(loop.dates || []).join(', ')})`);

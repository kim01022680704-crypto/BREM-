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
console.log('--- computeHistoryCollectRange (정산주 수~어제) ---');
console.log(`  mode=${hist.mode} skipped=${hist.skipped} label=${hist.label}`);
console.log(`  fromDate=${hist.fromDate} toDate=${hist.toDate} dayCount=${hist.dayCount}`);
if (hist.skipReason) console.log(`  skipReason=${hist.skipReason}`);
console.log('');

// scripts/baemin-session-local-server.js 의 computeThisWeekRangeForLoop 와 같은 계산.
// (해당 함수는 export 되지 않아 여기서 그대로 복제한다. 로직을 바꾸면 여기도 같이 바꿀 것.)
const toDateRaw = W.latestQueryableDate(today);
const fromDate = toDateRaw ? W.settlementWeekStart(toDateRaw) : W.settlementWeekStart(today);
const toDate = toDateRaw || fromDate;
console.log('--- computeThisWeekRangeForLoop (자동현황 1회차 부트스트랩) ---');
console.log(`  latestQueryable(어제)=${toDateRaw}`);
console.log(`  어제가 속한 정산주 시작=${fromDate}`);
console.log(`  label=${fromDate} ~ ${toDate}`);
console.log('');

const plan = W.buildBizMenuDateRanges(today, new Date(), null);
console.log('--- buildBizMenuDateRanges (저장된 기간 없을 때 기본값) ---');
Object.entries(plan).forEach(([id, range]) => {
  if (!range || typeof range !== 'object') return;
  console.log(`  ${id}: ${range.label || '-'} (${range.fromDate || '-'} ~ ${range.toDate || '-'}, ${range.dayCount ?? '-'}일)`);
});
console.log('');

// 요일별로 범위가 어떻게 잡히는지 확인한다.
// computeHistoryCollectRange 는 내부에서 todayKST() (인수 없음) 를 쓰므로
// 다른 날짜로 시뮬레이션할 수 없다. 여기서는 같은 규칙을 직접 계산해 본다.
console.log('--- 요일별 시뮬레이션 (어제가 속한 정산주 수 ~ 어제) ---');
for (let i = 0; i < 8; i += 1) {
  const day = W.addDays('2026-07-29', i);
  // KST 정오 기준으로 고정해 06:00 이전 분기를 타지 않게 한다.
  const latest = W.latestQueryableDate(day, new Date(`${day}T12:00:00+09:00`));
  const start = latest ? W.settlementWeekStart(latest) : W.settlementWeekStart(day);
  const end = latest || start;
  const count = W.buildDateList(start, end).length;
  const note = W.weekdayKST(day) === 3 ? '  ← 수요일: 지난 정산주 마감' : '';
  console.log(`  ${day}(${names[W.weekdayKST(day)]}) 어제=${latest} → ${start} ~ ${end} (${count}일)${note}`);
}
console.log('');

console.log('--- 어제(=' + toDateRaw + ') 가 포함되는가 ---');
const dailyDates = plan.daily_history?.dates || [];
const riderDates = plan.rider_history?.dates || [];
console.log(`  기본 일별 범위에 포함: ${dailyDates.includes(toDateRaw) ? '예' : '아니오'}`);
console.log(`  기본 라이더 범위에 포함: ${riderDates.includes(toDateRaw) ? '예' : '아니오'}`);
const loopDates = [];
let cur = fromDate;
while (cur <= toDate) { loopDates.push(cur); cur = W.addDays(cur, 1); }
console.log(`  자동현황 1회차 범위에 포함: ${loopDates.includes(toDateRaw) ? '예' : '아니오'}  (범위 ${loopDates.join(', ')})`);

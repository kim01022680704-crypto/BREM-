/**
 * 일정산: 같은 날 같은 기사가 여러 파일(지역·센터)에 있을 때 금액이 합쳐지는지 (로컬 메모리, 실제 DB 안 건드림)
 *   node scripts/_test-daily-multi-file-merge.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', runScripts: 'outside-only' });
const window = dom.window;
window.BREM_SUPABASE_CONFIG = { mode: 'development', backend: 'local' };
window.BremPerf = { time() {}, timeEnd() {} };
const ctx = vm.createContext(window);
const load = rel => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
try { load('js/platforms.js'); } catch (_) { /* optional */ }
load('js/data-cache.js');
load('js/storage.js');

const S = window.BremStorage;
const DAY = '2026-09-17';
const P = 'coupang';
let failed = 0;
const check = (label, cond, detail = '') => {
  if (!cond) failed += 1;
  console.log(`${cond ? '  OK  ' : ' FAIL '} ${label}${detail ? `  ${detail}` : ''}`);
};
const rec = (driverId, amount, orders, extra = {}) => ({
  driverId, driverName: driverId, orderCount: orders, settlementAmount: amount, deliveryAmount: amount, deductionBase: amount, hourlyInsurance: 0, ...extra
});
const savedAmount = id => {
  const row = S.settlements.getAll().find(item => item.id === `${id}-${DAY}-${P}`);
  return row ? row.settlementAmount : null;
};
const savedOrders = id => S.settlements.getAll().find(item => item.id === `${id}-${DAY}-${P}`)?.orderCount;

// admin.js applyDailySettlementFromLogData 의 저장 순서 그대로
async function applyFile(fileName, records, at) {
  const log = S.settlementUploadLogs.add({ kind: 'daily', platform: P, period: DAY, fileName, status: 'uploaded', matchedRecords: records });
  const merged = await S.settlements.mergeDailyFileShares({ period: DAY, platform: P, records, excludeFileName: fileName, excludeLogId: log.id });
  await S.settlements.upsertBatch({ period: DAY, platform: P, callFeeUnit: 100, records: merged.records });
  await new Promise(resolve => setTimeout(resolve, 5));
  // 실제 반영처럼 정산 저장 뒤 시각으로 찍는다 (at 은 읽기용 표시)
  void at;
  S.settlementUploadLogs.update(log.id, { status: 'applied', appliedAt: new Date().toISOString(), matchedRecords: records, appliedRecords: records });
  await new Promise(resolve => setTimeout(resolve, 5));
  return { log, merged };
}

(async () => {
  await S.initStorage({ backend: 'local' });

  console.log('\n[1] 북구남부 → 북구남부(Z) 순서로 반영 (오태건·하종군 양쪽에 있음)');
  await applyFile('배달연합_울산_북구남부_20260917.xlsx', [rec('오태건', 48470, 12), rec('하종군', 27507, 7), rec('김일반', 10000, 3)], '2026-09-18T10:10:00Z');
  const z = await applyFile('배달연합_울산_북구남부(Z)_20260917.xlsx', [rec('오태건', 102241, 23), rec('하종군', 50408, 11), rec('박지정', 20000, 5)], '2026-09-18T10:11:00Z');
  check('오태건 = 두 파일 합', savedAmount('오태건') === 150711, `${savedAmount('오태건')}`);
  check('하종군 = 두 파일 합', savedAmount('하종군') === 77915, `${savedAmount('하종군')}`);
  check('오태건 건수 합', savedOrders('오태건') === 35, `${savedOrders('오태건')}`);
  check('한 파일에만 있는 기사는 그대로', savedAmount('김일반') === 10000 && savedAmount('박지정') === 20000);
  check('합산 대상 기사 알려줌', z.merged.mergedDrivers.length === 2, z.merged.mergedDrivers.map(d => d.driverName).join(','));

  console.log('\n[2] 북구남부 파일을 금액 고쳐서 같은 이름으로 다시 반영 (쌓이면 안 됨)');
  await applyFile('배달연합_울산_북구남부_20260917.xlsx', [rec('오태건', 50000, 13), rec('하종군', 27507, 7), rec('김일반', 10000, 3)], '2026-09-18T12:00:00Z');
  check('오태건 = 새 북구남부 + (Z)', savedAmount('오태건') === 152241, `${savedAmount('오태건')}`);
  check('하종군 변동 없음', savedAmount('하종군') === 77915, `${savedAmount('하종군')}`);

  console.log('\n[3] 한 파일 안에 같은 기사 두 줄 (계정 2개)');
  await applyFile('배달연합_경북_포항중앙_20260917.xlsx', [rec('이중계정', 30000, 8, { riderId: 'A' }), rec('이중계정', 12000, 3, { riderId: 'B' })], '2026-09-18T12:05:00Z');
  check('두 줄 합', savedAmount('이중계정') === 42000, `${savedAmount('이중계정')}`);

  console.log('\n[4] 미매칭에서 나중에 매칭 (그 기사가 이미 다른 파일에 반영돼 있음)');
  S.settlementUnmatched.saveBatch({
    period: DAY, platform: P, sourceFileName: '배달연합_울산_남구중앙_20260917.xlsx',
    records: [{ rawName: '김일반', name: '김일반', riderId: 'U1', orderCount: 4, deliveryAmount: 15000, settlementAmount: 15000, deductionBase: 15000 }]
  });
  const pending = S.settlementUnmatched.getAll?.() || [];
  if (pending.length && typeof S.settlementUnmatched.retryDailyMatching === 'function') {
    window.BremSettlementParser = {
      matchDrivers: (rows) => ({ matched: rows.map(r => ({ ...r, driverId: '김일반' })), unmatched: [] })
    };
    const before = savedAmount('김일반');
    await S.settlementUnmatched.retryDailyMatching({ platform: P, weekStart: '2026-09-16' });
    check('기존 10,000 + 미매칭 15,000', savedAmount('김일반') === before + 15000, `${before} → ${savedAmount('김일반')}`);
  } else {
    console.log('  (미매칭 저장 API 형식이 달라 이 단계는 건너뜀)');
  }

  console.log('\n[5] (Z) 파일 업로드 기록 삭제 → 오태건은 북구남부 몫만 남음');
  const zLog = S.settlementUploadLogs.getById(z.log.id);
  await S.settlementUploadLogs.rollbackAppliedDailyLogAsync(zLog);
  S.settlementUploadLogs.update(z.log.id, { status: 'deleted' });
  check('오태건 = 북구남부 50,000', savedAmount('오태건') === 50000, `${savedAmount('오태건')}`);
  check('하종군 = 북구남부 27,507', savedAmount('하종군') === 27507, `${savedAmount('하종군')}`);
  check('(Z)에만 있던 박지정은 삭제', savedAmount('박지정') === null, `${savedAmount('박지정')}`);

  console.log('\n[6] 같은 파일을 「(1)」 이름으로 한 번 더 반영 (두 배 되면 안 됨)');
  const ulsanB = [rec('박훈범', 112680, 30), rec('이준철', 156780, 43)];
  await applyFile('배달처리비_표준울산북B팀브로1_20260917_20260917.xlsx', ulsanB);
  await applyFile('배달처리비_표준울산북B팀브로1_20260917_20260917 (1).xlsx', ulsanB);
  check('박훈범 그대로', savedAmount('박훈범') === 112680, `${savedAmount('박훈범')}`);
  check('이준철 그대로', savedAmount('이준철') === 156780, `${savedAmount('이준철')}`);

  console.log('\n[7] 이름이 완전히 다른데 내용이 똑같은 파일 (두 배 되면 안 됨)');
  await applyFile('복사해둔_울산북B_0917.xlsx', ulsanB);
  check('박훈범 그대로', savedAmount('박훈범') === 112680, `${savedAmount('박훈범')}`);

  console.log('\n[8] 「(1)」 복사본 기록만 삭제 → 원본 금액은 남아야 함');
  const copyLog = S.settlementUploadLogs.getAll().find(l => l.fileName === '배달처리비_표준울산북B팀브로1_20260917_20260917 (1).xlsx');
  await S.settlementUploadLogs.rollbackAppliedDailyLogAsync(copyLog);
  S.settlementUploadLogs.update(copyLog.id, { status: 'deleted' });
  check('박훈범 원본 금액 유지', savedAmount('박훈범') === 112680, `${savedAmount('박훈범')}`);

  console.log('\n[9] 「(Z)」 센터 파일은 복사본으로 보지 않음 (다른 금액이면 합산)');
  await applyFile('배달연합_울산_북구남부(Z)_20260917.xlsx', [rec('오태건', 102241, 23)]);
  check('오태건 = 북구남부 50,000 + (Z) 102,241', savedAmount('오태건') === 152241, `${savedAmount('오태건')}`);

  console.log(failed ? `\n실패 ${failed}건` : '\n전부 통과');
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });

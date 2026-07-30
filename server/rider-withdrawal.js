const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');
const { verifyAdminCaller } = require('./admin-users');
const {
  normalizeSettlementWeekStart,
  settlementWeekEnd
} = require('./rider-weekly-payslip');

const ROSTER_KEY = 'brem_payroll_daily_settlement_roster_v1';
const FEES_KEY = 'brem_payroll_daily_settlement_fees_v1';
const REQUESTS_KEY = 'brem_payroll_withdrawal_requests_v1';
const EXCLUDED_SETTLEMENTS_KEY = 'brem_payroll_daily_excluded_settlements_v1';
const FINALIZED_WEEKS_KEY = 'brem_payroll_week_finalized_v1';
const WITHDRAWAL_PAUSE_KEY = 'brem_payroll_withdrawal_paused_v1';

const ACTIVE_LEASE_STATUSES = ['active', 'operating', 'rented'];
const COMPLETED_ARREAR_STATUSES = new Set(['completed', 'recovered', 'done', 'paid', 'closed']);

// 출금신청 목록은 settings 에 JSON 배열 하나로 저장된다.
// 여러 요청(기사 신청 / 관리자 처리)이 동시에 read-modify-write 하면
// 마지막 write 가 앞선 write 를 덮어써 신청 건이 유실될 수 있다.
// 같은 프로세스 안에서는 프라미스 체인으로 직렬화해 이 경합을 막는다.
let requestsWriteChain = Promise.resolve();
function withRequestsLock(fn) {
  const run = requestsWriteChain.then(() => fn());
  // 결과/에러와 무관하게 체인이 끊기지 않도록 유지한다.
  requestsWriteChain = run.then(() => {}, () => {});
  return run;
}

function leaseNormalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function leaseNormalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function leaseFormatDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function leaseAddDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setDate(date.getDate() + days);
  return leaseFormatDateKey(date);
}

function normalizeDeductionPlatform(value) {
  return String(value || '').trim().toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
}

/**
 * 동일 인물의 driver_id 후보를 모두 수집한다.
 * 기사 중복 등록 등으로 정산행의 driver_id 가 로그인 기사 id 와 다른 경우에도
 * (이름+전화가 같은) 같은 사람의 정산을 놓치지 않도록 한다.
 */
async function resolveDriverIdCandidates(supabase, rider) {
  const ids = new Set();
  const primary = String(rider.id || '').trim();
  if (primary) ids.add(primary);

  const phone = leaseNormalizePhone(rider.phone);
  const name = leaseNormalizeName(rider.name);
  if (!phone && !name) return [...ids];

  try {
    const { data } = await supabase
      .from('riders')
      .select('id,name,phone')
      .limit(5000);
    (data || []).forEach(row => {
      const rowPhone = leaseNormalizePhone(row.phone);
      const rowName = leaseNormalizeName(row.name);
      const samePhone = phone && rowPhone === phone;
      // 이름이 같고, 전화가 (양쪽 중 하나라도 비었거나 · 완전히 같거나 · 뒷4자리가 같으면)
      // 동일 인물(중복 등록)로 간주한다. → 정산행 driver_id 가 로그인 id 와 갈려도 합산.
      const sameName = name && rowName === name;
      const phoneCompatible = !phone || !rowPhone
        || rowPhone === phone
        || rowPhone.slice(-4) === phone.slice(-4);
      const linkByName = sameName && phoneCompatible;
      if ((samePhone || linkByName) && row.id) {
        ids.add(String(row.id));
      }
    });
  } catch (_error) {
    // 조회 실패 시 기본 id 만 사용
  }
  return [...ids].filter(Boolean);
}

function leaseContractMatchesRider(row, rider) {
  const raw = row?.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  if (raw.driverId && String(raw.driverId) === String(rider.id)) return true;
  const nameMatch = leaseNormalizeName(raw.driverName)
    && leaseNormalizeName(raw.driverName) === leaseNormalizeName(rider.name);
  const phoneMatch = leaseNormalizePhone(raw.driverPhone)
    && leaseNormalizePhone(raw.driverPhone) === leaseNormalizePhone(rider.phone);
  return Boolean(nameMatch && phoneMatch);
}

function countActiveLeaseDays(weekStart, weekEnd, todayKey, contractStart, contractEnd) {
  if (!weekStart || !weekEnd) return 0;
  const upper = todayKey && todayKey < weekEnd ? todayKey : weekEnd;
  if (upper < weekStart) return 0;
  let count = 0;
  let cursor = weekStart;
  let guard = 0;
  while (cursor <= upper && guard < 60) {
    const afterStart = !contractStart || cursor >= contractStart;
    const beforeEnd = !contractEnd || cursor <= contractEnd;
    if (afterStart && beforeEnd) count += 1;
    cursor = leaseAddDays(cursor, 1);
    guard += 1;
  }
  return count;
}

function emptyLeaseInfo() {
  return {
    hasLease: false,
    dailyRent: 0,
    deductionPlatform: 'coupang',
    activeDays: 0,
    leaseCharge: 0,
    outstandingArrears: 0,
    leaseDeductionTotal: 0,
    arrearReason: '',
    contractId: ''
  };
}

/**
 * lease_contracts(활성) + lease_arrears 를 한 번씩만 조회해 메모리에 올린다.
 * 여러 기사 출금가능금액을 한 번에 계산할 때 기사마다 DB 를 다시 치지 않도록 한다.
 */
async function loadLeaseTables(supabase) {
  try {
    const [contractsRes, arrearsRes] = await Promise.all([
      supabase
        .from('lease_contracts')
        .select('id,contract_type,status,daily_charge,raw_data,start_date,end_date')
        .in('status', ACTIVE_LEASE_STATUSES)
        .order('updated_at', { ascending: false })
        .limit(3000),
      supabase
        .from('lease_arrears')
        .select('unpaid_amount,recovered_amount,raw_data,collection_status,contract_id')
        .order('updated_at', { ascending: false })
        .limit(6000)
    ]);
    return {
      contracts: contractsRes.data || [],
      arrears: arrearsRes.data || []
    };
  } catch (_error) {
    return { contracts: [], arrears: [] };
  }
}

/**
 * 미리 로드한 lease 테이블을 기준으로 특정 기사의 이번주 리스 차감액을 계산한다.
 * (일 렌탈료 매일 누적 + 미회수 미납 잔액)
 */
function computeLeaseForRider(tables, rider, weekStart, weekEnd) {
  const contracts = Array.isArray(tables?.contracts) ? tables.contracts : [];
  const arrears = Array.isArray(tables?.arrears) ? tables.arrears : [];

  const contract = contracts.find(row => leaseContractMatchesRider(row, rider)) || null;
  let dailyRent = 0;
  let deductionPlatform = 'coupang';
  let contractStart = '';
  let contractEnd = '';
  if (contract) {
    const raw = contract.raw_data || {};
    dailyRent = Math.max(0, Math.round(Number(raw.dailyRent || contract.daily_charge || 0)));
    deductionPlatform = normalizeDeductionPlatform(raw.deductionPlatform);
    contractStart = String(contract.start_date || raw.startDate || '').slice(0, 10);
    contractEnd = String(raw.returnDate || contract.end_date || raw.endDate || '').slice(0, 10);
  }

  const todayKey = leaseFormatDateKey(new Date());
  const activeDays = contract
    ? countActiveLeaseDays(weekStart, weekEnd, todayKey, contractStart, contractEnd)
    : 0;
  const leaseCharge = dailyRent * activeDays;

  const contractId = contract?.id ? String(contract.id) : '';
  let outstandingArrears = 0;
  const arrearReasons = [];
  arrears.forEach(row => {
    const rowRaw = row.raw_data || {};
    const sameDriver = (rowRaw.driverId && String(rowRaw.driverId) === String(rider.id))
      || (
        leaseNormalizeName(rowRaw.driverName) === leaseNormalizeName(rider.name)
        && leaseNormalizePhone(rowRaw.driverPhone) === leaseNormalizePhone(rider.phone)
        && leaseNormalizeName(rowRaw.driverName)
      );
    const sameContract = contractId && String(row.contract_id || '') === contractId;
    if (!sameDriver && !sameContract) return;
    const status = String(row.collection_status || rowRaw.collectionStatus || '').toLowerCase();
    if (COMPLETED_ARREAR_STATUSES.has(status)) return;
    const remaining = Math.max(0, Math.round(Number(row.unpaid_amount ?? rowRaw.unpaidAmount ?? 0)));
    if (remaining <= 0) return;
    outstandingArrears += remaining;
    const reason = String(rowRaw.arrearReason || rowRaw.reason || '').trim()
      || (rowRaw.source === 'weekly-auto' ? '주정산 리스비 미납' : '리스비 미납');
    arrearReasons.push(reason);
  });
  const arrearReason = [...new Set(arrearReasons)].join(', ');

  const leaseDeductionTotal = leaseCharge + outstandingArrears;
  return {
    hasLease: Boolean(contract) && (dailyRent > 0 || outstandingArrears > 0),
    dailyRent,
    deductionPlatform,
    activeDays,
    leaseCharge,
    outstandingArrears,
    leaseDeductionTotal,
    arrearReason,
    contractId
  };
}

/**
 * 리스 계약 기사의 이번주 일 렌탈료(매일 누적) + 미회수 미납금 합산.
 * 미납회수(계좌이체)로 처리되면 lease_arrears 잔액이 줄어들어 자동으로 차감액이 감소한다.
 */
async function loadLeaseWithdrawalInfo(supabase, rider, weekStart, weekEnd) {
  try {
    const tables = await loadLeaseTables(supabase);
    return computeLeaseForRider(tables, rider, weekStart, weekEnd);
  } catch (_error) {
    return emptyLeaseInfo();
  }
}

const EMP_RATE = 0.008;
const INDUSTRIAL_RATE = 0.0088;
const WITHHOLDING_RATE = 0.033;

async function readSettingValue(supabase, key, fallback) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  if (data?.value !== undefined && data?.value !== null) return data.value;
  return fallback;
}

async function writeSettingValue(supabase, key, value) {
  const { error } = await supabase.from('settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw error;
}

function normalizeFees(raw = {}) {
  const makeSide = side => {
    const mode = String(side?.dailySettlementFeeMode || 'fixed').toLowerCase() === 'percent'
      ? 'percent'
      : 'fixed';
    const feeRaw = Number(side?.dailySettlementFee || 0);
    return {
      callFee: Math.max(0, Math.round(Number(side?.callFee || 0))),
      dailySettlementFeeMode: mode,
      dailySettlementFee: mode === 'percent'
        ? Math.max(0, Math.round(feeRaw * 1000) / 1000)
        : Math.max(0, Math.round(feeRaw))
    };
  };
  return {
    showCallFee: raw.showCallFee !== false,
    coupang: makeSide(raw.coupang || raw),
    baemin: makeSide(raw.baemin || raw)
  };
}

function resolveDailySettlementFee(settlementAmount, fees = {}) {
  const amount = Math.max(0, Math.round(Number(settlementAmount) || 0));
  const mode = String(fees.dailySettlementFeeMode || 'fixed').toLowerCase() === 'percent'
    ? 'percent'
    : 'fixed';
  const value = Math.max(0, Number(fees.dailySettlementFee || 0));
  if (mode === 'percent') return Math.floor(amount * (value / 100));
  return Math.max(0, Math.round(value));
}

/** 출금신청 금액 기준 일정산수수료 (출금시적용) */
function resolveWithdrawalFee(amount, fees = {}) {
  return resolveDailySettlementFee(amount, fees);
}

function requestConsumedAmount(item = {}, feesByPlatform = {}) {
  const amount = Math.max(0, Math.round(Number(item.amount || 0)));
  if (item.feeAmount != null) {
    return amount + Math.max(0, Math.round(Number(item.feeAmount) || 0));
  }
  const platform = normalizePlatform(item.platform);
  const fees = feesByPlatform[platform] || feesByPlatform.coupang || {};
  return amount + resolveWithdrawalFee(amount, fees);
}

function normalizePlatform(value) {
  return String(value || '').toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
}

function calcPayoutFromSettlement(row, feesByPlatform) {
  const platform = normalizePlatform(row.platform);
  const fees = feesByPlatform[platform] || feesByPlatform.coupang;
  const settlementAmount = Math.max(
    0,
    Math.round(Number(row.settlement_amount ?? row.delivery_amount ?? 0))
  );
  const orderCount = Math.max(0, Math.round(Number(row.order_count || 0)));
  const hourlyInsurance = Math.abs(Math.round(Number(row.hourly_insurance || 0)));
  // 고용·산재·원천세 기준은 쿠팡 정산서 AC열(deduction_base).
  // 정산금액(AL)은 콜수수료가 이미 빠진 값이라 공제 기준으로 쓰면 금액이 맞지 않는다.
  // AC가 없는 기존 행은 지금까지처럼 정산금액 기준을 유지한다. 기준을 통째로 바꾸면
  // 이미 출금이 끝난 주가 소급 재계산되어 초과출금이 된다.
  const deductionBase = Math.max(0, Math.round(Number(row.deduction_base || 0))) || settlementAmount;
  const employmentInsurance = Math.floor(deductionBase * EMP_RATE);
  const industrialAccidentInsurance = Math.floor(deductionBase * INDUSTRIAL_RATE);
  const withholdingTax = Math.floor(deductionBase * WITHHOLDING_RATE);
  const callFeeUnit = Math.max(0, Math.round(Number(fees.callFee || 0)));
  const callFee = orderCount * callFeeUnit;
  // 일정산수수료(2%)는 "출금 시" 한 번만 부과되는 회사 수익이다.
  // 실지급액(netPay) 계산에서는 절대 빼지 않는다. (여기서 빼면 출금 때 또 빠져 2% 이중 차감됨)
  // 이 값은 기사 앱 일정산 표에서 "출금 시 적용될 예상 수수료" 미리보기용으로만 노출한다.
  const dailySettlementFee = resolveDailySettlementFee(settlementAmount, fees);
  const netPay = settlementAmount
    - employmentInsurance
    - industrialAccidentInsurance
    - withholdingTax
    - callFee
    - hourlyInsurance;

  return {
    period: String(row.period || '').slice(0, 10),
    platform,
    settlementAmount,
    deductionBase,
    orderCount,
    hourlyInsurance,
    employmentInsurance,
    industrialAccidentInsurance,
    withholdingTax,
    callFee,
    dailySettlementFee,
    netPay
  };
}

function normalizeRequestPlatform(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'baemin' || raw === '배민') return 'baemin';
  if (raw === 'coupang' || raw === '쿠팡') return 'coupang';
  return '';
}

function emptyRequestBuckets() {
  return {
    coupang: { requestedAmount: 0, requestedConsume: 0, withdrawnAmount: 0, withdrawnConsume: 0 },
    baemin: { requestedAmount: 0, requestedConsume: 0, withdrawnAmount: 0, withdrawnConsume: 0 },
    unknown: { requestedAmount: 0, requestedConsume: 0, withdrawnAmount: 0, withdrawnConsume: 0 }
  };
}

// 출금신청을 플랫폼별로 나눠 합산. platform 없는 예전 건은 unknown.
function accumulateRequestBuckets(requests, feesByPlatform) {
  const buckets = emptyRequestBuckets();
  (Array.isArray(requests) ? requests : []).forEach(item => {
    const key = normalizeRequestPlatform(item.platform) || 'unknown';
    const consume = requestConsumedAmount(item, feesByPlatform);
    if (item.status === 'pending') {
      buckets[key].requestedAmount += item.amount;
      buckets[key].requestedConsume += consume;
    } else if (item.status === 'completed') {
      buckets[key].withdrawnAmount += item.amount;
      buckets[key].withdrawnConsume += consume;
    }
  });
  return buckets;
}

/**
 * 플랫폼별 출금가능금액.
 * 쿠팡 실지급은 쿠팡 출금만, 배민 실지급은 배민 출금만 차감한다.
 * (합산 주머니로 쓰면 배민 출금이 쿠팡 정산에 섞이는 사고가 난다.)
 */
function computeAvailableByPlatform(netPayByPlatform, buckets, weekFinalized) {
  const result = { coupang: 0, baemin: 0 };
  ['coupang', 'baemin'].forEach(platform => {
    const raw = Number(netPayByPlatform?.[platform] || 0)
      - Number(buckets?.[platform]?.requestedConsume || 0)
      - Number(buckets?.[platform]?.withdrawnConsume || 0);
    result[platform] = weekFinalized ? 0 : raw;
  });

  // platform 없는 예전 출금건은 남은 잔액이 있는 플랫폼에서만 순서대로 깎는다.
  let unknownConsume = Number(buckets?.unknown?.requestedConsume || 0)
    + Number(buckets?.unknown?.withdrawnConsume || 0);
  if (!weekFinalized && unknownConsume > 0) {
    ['coupang', 'baemin'].forEach(platform => {
      if (unknownConsume <= 0 || result[platform] <= 0) return;
      const cut = Math.min(result[platform], unknownConsume);
      result[platform] -= cut;
      unknownConsume -= cut;
    });
  }
  return result;
}

function totalAvailableFromPlatforms(availableByPlatform) {
  return Number(availableByPlatform?.coupang || 0) + Number(availableByPlatform?.baemin || 0);
}

function normalizeRequest(item = {}) {
  const amount = Math.max(0, Math.round(Number(item.amount || 0)));
  const weekStart = normalizeSettlementWeekStart(item.weekStart || item.settlementWeekStart);
  const statusRaw = String(item.status || 'pending');
  const status = ['pending', 'cancelled', 'completed'].includes(statusRaw) ? statusRaw : 'pending';
  if (!item.driverId || !weekStart || amount <= 0) return null;
  const createdAt = item.createdAt || new Date().toISOString();
  const requestDate = String(item.requestDate || createdAt).slice(0, 10);
  const platform = normalizeRequestPlatform(item.platform);
  const hasFeeAmount = Object.prototype.hasOwnProperty.call(item, 'feeAmount')
    && item.feeAmount !== null
    && item.feeAmount !== undefined
    && item.feeAmount !== '';
  return {
    id: String(item.id || `wd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    driverId: String(item.driverId),
    driverName: String(item.driverName || '').trim(),
    platform,
    amount,
    feeAmount: hasFeeAmount ? Math.max(0, Math.round(Number(item.feeAmount) || 0)) : null,
    weekStart,
    weekEnd: settlementWeekEnd(weekStart),
    requestDate,
    availableAtRequest: Math.max(0, Math.round(Number(item.availableAtRequest || 0))),
    status,
    createdBy: String(item.createdBy || 'rider').trim() || 'rider',
    createdAt,
    updatedAt: item.updatedAt || createdAt,
    cancelledAt: item.cancelledAt || null,
    completedAt: item.completedAt || null
  };
}

function normalizeRequestList(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeRequest)
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function findRosterEntry(roster, driverId) {
  const id = String(driverId || '');
  return (Array.isArray(roster) ? roster : []).find(item => String(item.driverId || '') === id) || null;
}

function isPlatformEnrolled(rosterItem, platform) {
  if (!rosterItem) return false;
  const p = normalizePlatform(platform);
  if (p === 'baemin') return rosterItem.platformBaemin !== false;
  return rosterItem.platformCoupang !== false;
}

function normalizeFinalizedWeeks(list) {
  if (!Array.isArray(list)) return [];
  const byWeek = new Map();
  list.forEach(item => {
    const weekStart = typeof item === 'string'
      ? String(item || '').slice(0, 10)
      : String(item?.weekStart || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return;
    byWeek.set(weekStart, {
      weekStart,
      weekEnd: String(item?.weekEnd || '').slice(0, 10),
      finalizedAt: String(item?.finalizedAt || '').trim(),
      note: String(item?.note || '').trim()
    });
  });
  return Array.from(byWeek.values());
}

function findFinalizedWeekEntry(list, weekStart) {
  const key = String(weekStart || '').slice(0, 10);
  if (!key) return null;
  return normalizeFinalizedWeeks(list).find(item => item.weekStart === key) || null;
}

function normalizeWithdrawalPauseState(raw) {
  if (raw === true) return { paused: true, updatedAt: '', note: '' };
  if (!raw || typeof raw !== 'object') return { paused: false, updatedAt: '', note: '' };
  return {
    paused: raw.paused === true,
    updatedAt: String(raw.updatedAt || '').trim(),
    note: String(raw.note || '').trim()
  };
}

async function buildDriverWeekSummary(supabase, rider, weekStartInput) {
  const weekStart = normalizeSettlementWeekStart(weekStartInput || new Date());
  const weekEnd = settlementWeekEnd(weekStart);
  const driverId = String(rider.id || '');
  const driverName = String(rider.name || '').trim();

  const [rosterRaw, feesRaw, requestsRaw, excludedRaw, finalizedRaw, pauseRaw] = await Promise.all([
    readSettingValue(supabase, ROSTER_KEY, []),
    readSettingValue(supabase, FEES_KEY, {}),
    readSettingValue(supabase, REQUESTS_KEY, []),
    readSettingValue(supabase, EXCLUDED_SETTLEMENTS_KEY, []),
    readSettingValue(supabase, FINALIZED_WEEKS_KEY, []),
    readSettingValue(supabase, WITHDRAWAL_PAUSE_KEY, {})
  ]);
  const rosterItem = findRosterEntry(rosterRaw, driverId);
  const feesByPlatform = normalizeFees(feesRaw);
  const excludedSettlementIds = new Set(
    (Array.isArray(excludedRaw) ? excludedRaw : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
  );
  const finalizedEntry = findFinalizedWeekEntry(finalizedRaw, weekStart);
  const weekFinalized = Boolean(finalizedEntry);
  const pauseState = normalizeWithdrawalPauseState(pauseRaw);
  const withdrawalPaused = pauseState.paused === true;
  const allRequests = normalizeRequestList(requestsRaw);
  const myWeekRequests = allRequests.filter(item => (
    item.driverId === driverId && item.weekStart === weekStart
  ));
  const pendingRequests = myWeekRequests.filter(item => item.status === 'pending');
  const completedRequests = myWeekRequests.filter(item => item.status === 'completed');
  const requestBuckets = accumulateRequestBuckets(myWeekRequests, feesByPlatform);
  const requestedAmountTotal = pendingRequests.reduce((sum, item) => sum + item.amount, 0);
  const requestedFeeTotal = pendingRequests.reduce((sum, item) => {
    const consumed = requestConsumedAmount(item, feesByPlatform);
    return sum + Math.max(0, consumed - item.amount);
  }, 0);
  const requestedTotal = pendingRequests.reduce(
    (sum, item) => sum + requestConsumedAmount(item, feesByPlatform),
    0
  );
  // 처리완료(출금완료)된 금액은 이미 지급된 돈이므로 출금가능금액에서 반드시 차감한다.
  // (이 차감이 없으면 처리완료 후 그 금액이 다시 출금가능금액으로 살아나 실지급액보다 많이 출금 가능해진다.)
  const withdrawnAmountTotal = completedRequests.reduce((sum, item) => sum + item.amount, 0);
  const withdrawnTotal = completedRequests.reduce(
    (sum, item) => sum + requestConsumedAmount(item, feesByPlatform),
    0
  );

  // 일정산 명단(roster)은 이제 "확인용"일 뿐, 출금가능금액 계산을 좌우하지 않는다.
  // 정산서가 매칭돼 daily_settlements 에 저장된 모든 기사에 대해 계산한다.
  // 기사 중복 등록 등으로 driver_id 가 갈린 경우까지 잡기 위해 동일 인물 id 후보를 모두 조회한다.
  const driverIdCandidates = await resolveDriverIdCandidates(supabase, rider);
  const { data: settlementRows, error } = await supabase
    .from('daily_settlements')
    .select('driver_id,period,platform,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount')
    .in('driver_id', driverIdCandidates.length ? driverIdCandidates : [driverId])
    .gte('period', weekStart)
    .lte('period', weekEnd)
    .order('period', { ascending: true });

  if (error) {
    return { ok: false, status: 500, error: error.message || '일정산 데이터를 불러오지 못했습니다.' };
  }

  const days = (settlementRows || [])
    .filter(row => {
      const rowDriverId = String(row.driver_id || driverId);
      const id = `${rowDriverId}-${String(row.period || '').slice(0, 10)}-${normalizePlatform(row.platform)}`;
      return !excludedSettlementIds.has(id);
    })
    .map(row => calcPayoutFromSettlement(row, feesByPlatform))
    .filter(row => row.period);

  const totalNetPay = days.reduce((sum, row) => sum + Math.max(0, row.netPay), 0);
  const netPayByPlatform = days.reduce((acc, row) => {
    const key = normalizePlatform(row.platform);
    acc[key] = (acc[key] || 0) + Math.max(0, row.netPay);
    return acc;
  }, { coupang: 0, baemin: 0 });

  // 출금 선택 가능한 플랫폼: 정산서가 실제로 존재하는 플랫폼(명단 등록과 무관)
  const enrolledPlatforms = {
    coupang: days.some(row => normalizePlatform(row.platform) === 'coupang'),
    baemin: days.some(row => normalizePlatform(row.platform) === 'baemin')
  };

  const lease = await loadLeaseWithdrawalInfo(supabase, rider, weekStart, weekEnd);
  const leaseDeduction = Math.max(0, Math.round(Number(lease?.leaseDeductionTotal || 0)));
  const deductionPlatform = normalizeDeductionPlatform(lease?.deductionPlatform);
  if (leaseDeduction > 0) {
    netPayByPlatform[deductionPlatform] = (netPayByPlatform[deductionPlatform] || 0) - leaseDeduction;
  }
  // 리스비/미납은 최우선 차감이며 마이너스(이월)를 허용한다. (정산 주 단위로 리셋)
  // 출금가능은 플랫폼별로 분리한다. 쿠팡 잔액으로 배민 출금을 막는다.
  const availableByPlatform = computeAvailableByPlatform(netPayByPlatform, requestBuckets, weekFinalized);
  const availableAmount = weekFinalized ? 0 : totalAvailableFromPlatforms(availableByPlatform);

  return {
    ok: true,
    enrolled: true,
    weekStart,
    weekEnd,
    driverId,
    driverName,
    days,
    totalNetPay,
    netPayByPlatform,
    availableByPlatform,
    requestedByPlatform: {
      coupang: requestBuckets.coupang.requestedAmount,
      baemin: requestBuckets.baemin.requestedAmount
    },
    withdrawnByPlatform: {
      coupang: requestBuckets.coupang.withdrawnAmount,
      baemin: requestBuckets.baemin.withdrawnAmount
    },
    requestedTotal,
    requestedAmountTotal,
    requestedFeeTotal,
    withdrawnTotal,
    withdrawnAmountTotal,
    availableAmount,
    weekFinalized,
    weekFinalizedAt: finalizedEntry?.finalizedAt || '',
    withdrawalPaused,
    withdrawalPausedAt: pauseState.updatedAt || '',
    lease: {
      hasLease: Boolean(lease?.hasLease),
      dailyRent: Math.max(0, Math.round(Number(lease?.dailyRent || 0))),
      deductionPlatform,
      activeDays: Math.max(0, Math.round(Number(lease?.activeDays || 0))),
      leaseCharge: Math.max(0, Math.round(Number(lease?.leaseCharge || 0))),
      outstandingArrears: Math.max(0, Math.round(Number(lease?.outstandingArrears || 0))),
      leaseDeductionTotal: leaseDeduction,
      arrearReason: lease?.arrearReason || ''
    },
    enrolledPlatforms,
    showCallFee: feesByPlatform.showCallFee !== false,
    feesByPlatform: {
      coupang: feesByPlatform.coupang,
      baemin: feesByPlatform.baemin
    },
    myRequests: myWeekRequests
  };
}

async function getWithdrawalSummary(accessToken, weekStartInput) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  return buildDriverWeekSummary(supabase, me.rider, weekStartInput);
}

async function createWithdrawalRequest(accessToken, body = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const amount = Math.max(0, Math.round(Number(body.amount || 0)));
  if (!amount) {
    return { ok: false, status: 400, error: '신청금액을 입력하세요.' };
  }

  const platform = normalizeRequestPlatform(body.platform);
  if (!platform) {
    return { ok: false, status: 400, error: '출금 플랫폼(쿠팡/배민)을 선택하세요.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const pauseState = normalizeWithdrawalPauseState(
    await readSettingValue(supabase, WITHDRAWAL_PAUSE_KEY, {})
  );
  if (pauseState.paused) {
    return {
      ok: false,
      status: 400,
      error: '정산중엔 출금신청정지 · 정산 처리가 끝난 뒤 다시 신청해 주세요.'
    };
  }

  const summary = await buildDriverWeekSummary(supabase, me.rider, body.weekStart);
  if (!summary.ok) return summary;

  if (summary.weekFinalized) {
    return {
      ok: false,
      status: 400,
      error: `해당 정산주(${summary.weekStart} ~ ${summary.weekEnd})는 주정산 마무리가 완료되어 출금할 수 없습니다.`
    };
  }

  if (!summary.enrolledPlatforms?.[platform]) {
    return {
      ok: false,
      status: 400,
      error: `${platform === 'baemin' ? '배민' : '쿠팡'} 정산 내역이 없어 출금할 수 없습니다.`
    };
  }

  const feesByPlatform = normalizeFees(
    await readSettingValue(supabase, FEES_KEY, {})
  );
  const platformFees = feesByPlatform[platform] || feesByPlatform.coupang || {};
  const feeAmount = resolveWithdrawalFee(amount, platformFees);
  const consumeAmount = amount + feeAmount;
  const platformAvailable = Number(summary.availableByPlatform?.[platform] ?? summary.availableAmount ?? 0);
  const platformLabel = platform === 'baemin' ? '배민' : '쿠팡';

  if (consumeAmount > platformAvailable) {
    return {
      ok: false,
      status: 400,
      error: feeAmount > 0
        ? `출금 ${amount.toLocaleString('ko-KR')}원 + 일정산수수료 ${feeAmount.toLocaleString('ko-KR')}원 = ${consumeAmount.toLocaleString('ko-KR')}원이 ${platformLabel} 출금가능금액(${platformAvailable.toLocaleString('ko-KR')}원)을 초과합니다.`
        : `${platformLabel} 출금가능금액(${platformAvailable.toLocaleString('ko-KR')}원)을 초과할 수 없습니다.`
    };
  }

  const request = normalizeRequest({
    driverId: summary.driverId,
    driverName: summary.driverName,
    platform,
    amount,
    feeAmount,
    weekStart: summary.weekStart,
    requestDate: new Date().toISOString().slice(0, 10),
    availableAtRequest: platformAvailable,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await withRequestsLock(async () => {
    const existing = normalizeRequestList(await readSettingValue(supabase, REQUESTS_KEY, []));
    existing.unshift(request);
    await writeSettingValue(supabase, REQUESTS_KEY, existing);
  });

  const nextPlatformAvailable = Math.max(0, platformAvailable - consumeAmount);
  const nextAvailable = Math.max(0, Number(summary.availableAmount || 0) - consumeAmount);
  return {
    ok: true,
    request,
    availableAmount: nextAvailable,
    availableByPlatform: {
      ...(summary.availableByPlatform || { coupang: 0, baemin: 0 }),
      [platform]: nextPlatformAvailable
    },
    totalNetPay: summary.totalNetPay,
    requestedTotal: summary.requestedTotal + consumeAmount,
    requestedAmountTotal: (summary.requestedAmountTotal || 0) + amount,
    requestedFeeTotal: (summary.requestedFeeTotal || 0) + feeAmount,
    feeAmount,
    weekStart: summary.weekStart,
    weekEnd: summary.weekEnd
  };
}

function sumDayTotals(days = []) {
  return (Array.isArray(days) ? days : []).reduce((acc, row) => {
    acc.settlementAmount += Math.max(0, Math.round(Number(row.settlementAmount) || 0));
    acc.orderCount += Math.max(0, Math.round(Number(row.orderCount) || 0));
    acc.employmentInsurance += Math.max(0, Math.round(Number(row.employmentInsurance) || 0));
    acc.industrialAccidentInsurance += Math.max(0, Math.round(Number(row.industrialAccidentInsurance) || 0));
    acc.withholdingTax += Math.max(0, Math.round(Number(row.withholdingTax) || 0));
    acc.callFee += Math.max(0, Math.round(Number(row.callFee) || 0));
    acc.dailySettlementFee += Math.max(0, Math.round(Number(row.dailySettlementFee) || 0));
    acc.hourlyInsurance += Math.max(0, Math.round(Number(row.hourlyInsurance) || 0));
    acc.netPay += Math.round(Number(row.netPay) || 0);
    return acc;
  }, {
    settlementAmount: 0,
    orderCount: 0,
    employmentInsurance: 0,
    industrialAccidentInsurance: 0,
    withholdingTax: 0,
    callFee: 0,
    dailySettlementFee: 0,
    hourlyInsurance: 0,
    netPay: 0
  });
}

/**
 * 여러 기사의 한 주(week) 일정산을 한 번의 쿼리로 배치 조회한다.
 * 출금신청자 목록(listWithdrawalRequests)에서 신청 건마다 개별 쿼리(N+1)를 하던 것을
 * 주차별 1회 쿼리로 합쳐 서버 부하와 응답시간을 줄인다.
 * 반환: Map<driverId, days[]>
 */
async function loadWeekDaysForDrivers(supabase, driverIds, weekStart, feesByPlatform, excludedSettlementIds = null) {
  const ids = [...new Set((Array.isArray(driverIds) ? driverIds : []).map(id => String(id || '')).filter(Boolean))];
  const result = new Map();
  ids.forEach(id => result.set(id, []));
  if (!ids.length) return result;

  const weekEnd = settlementWeekEnd(weekStart);
  const excluded = excludedSettlementIds instanceof Set
    ? excludedSettlementIds
    : new Set(Array.isArray(excludedSettlementIds) ? excludedSettlementIds : []);

  // Supabase 기본 1000행 제한을 넘어 잘리지 않도록 페이지네이션으로 전부 읽는다.
  const PAGE_SIZE = 1000;
  const settlementRows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('daily_settlements')
      .select('driver_id,period,platform,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount')
      .in('driver_id', ids)
      .gte('period', weekStart)
      .lte('period', weekEnd)
      .order('period', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    settlementRows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  settlementRows.forEach(row => {
    const driverId = String(row.driver_id || '');
    if (!result.has(driverId)) return;
    const id = `${driverId}-${String(row.period || '').slice(0, 10)}-${normalizePlatform(row.platform)}`;
    if (excluded.has(id)) return;
    const day = calcPayoutFromSettlement(row, feesByPlatform);
    if (day.period) result.get(driverId).push(day);
  });
  return result;
}

/**
 * 한 주(week)의 daily_settlements 전체를 driver_id 필터 없이 읽어
 * 정산서가 올라온 모든 기사의 일정산을 driver_id 별로 묶어 돌려준다.
 * (일정산 명단 등록 여부와 무관하게 업로드 반영된 전원을 노출하기 위함)
 * 반환: Map<driverId, days[]>
 */
async function loadAllWeekDays(supabase, weekStart, feesByPlatform, excludedSettlementIds = null) {
  const result = new Map();
  const weekEnd = settlementWeekEnd(weekStart);
  const excluded = excludedSettlementIds instanceof Set
    ? excludedSettlementIds
    : new Set(Array.isArray(excludedSettlementIds) ? excludedSettlementIds : []);

  const PAGE_SIZE = 1000;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('daily_settlements')
      .select('driver_id,period,platform,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount')
      .gte('period', weekStart)
      .lte('period', weekEnd)
      .order('period', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    page.forEach(row => {
      const driverId = String(row.driver_id || '');
      if (!driverId) return;
      const id = `${driverId}-${String(row.period || '').slice(0, 10)}-${normalizePlatform(row.platform)}`;
      if (excluded.has(id)) return;
      const day = calcPayoutFromSettlement(row, feesByPlatform);
      if (!day.period) return;
      if (!result.has(driverId)) result.set(driverId, []);
      result.get(driverId).push(day);
    });
    if (page.length < PAGE_SIZE) break;
  }
  return result;
}

async function listWithdrawalRequests(accessToken, query = {}) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const [listRaw, feesRaw, excludedRaw] = await Promise.all([
    readSettingValue(supabase, REQUESTS_KEY, []),
    readSettingValue(supabase, FEES_KEY, {}),
    readSettingValue(supabase, EXCLUDED_SETTLEMENTS_KEY, [])
  ]);
  const list = normalizeRequestList(listRaw);
  const feesByPlatform = normalizeFees(feesRaw);
  const excludedSettlementIds = new Set(
    (Array.isArray(excludedRaw) ? excludedRaw : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
  );
  const weekStart = query.weekStart ? normalizeSettlementWeekStart(query.weekStart) : '';
  const date = String(query.date || '').slice(0, 10);
  const status = String(query.status || '').trim();
  const view = String(query.view || '').trim();
  const completedDate = String(query.completedDate || '').slice(0, 10);

  const filtered = list.filter(item => {
    // 처리완료 내역 뷰: 처리일(completedAt) 기준으로만 조회한다.
    if (view === 'completed') {
      if (item.status !== 'completed') return false;
      if (completedDate
        && String(item.completedAt || item.updatedAt || '').slice(0, 10) !== completedDate) return false;
      return true;
    }
    if (date && String(item.requestDate || item.createdAt || '').slice(0, 10) !== date) return false;
    if (weekStart && item.weekStart !== weekStart) return false;
    if (status && item.status !== status) return false;
    return true;
  });

  // 신청 건별 개별 쿼리(N+1) 대신, 주차(weekStart)별로 기사들을 모아 한 번에 배치 조회한다.
  const driversByWeek = new Map();
  filtered.forEach(item => {
    const week = String(item.weekStart || '');
    if (!driversByWeek.has(week)) driversByWeek.set(week, new Set());
    driversByWeek.get(week).add(String(item.driverId || ''));
  });

  const detailCache = new Map();
  await Promise.all([...driversByWeek.entries()].map(async ([week, driverIdSet]) => {
    const driverIds = [...driverIdSet];
    try {
      const daysByDriver = await loadWeekDaysForDrivers(
        supabase,
        driverIds,
        week,
        feesByPlatform,
        excludedSettlementIds
      );
      driverIds.forEach(driverId => {
        detailCache.set(`${driverId}|${week}`, sumDayTotals(daysByDriver.get(driverId) || []));
      });
    } catch (_error) {
      driverIds.forEach(driverId => {
        detailCache.set(`${driverId}|${week}`, sumDayTotals([]));
      });
    }
  }));

  const requests = filtered.map(item => ({
    ...item,
    ...(detailCache.get(`${item.driverId}|${item.weekStart}`) || sumDayTotals([])),
    showCallFee: feesByPlatform.showCallFee !== false
  }));

  return {
    ok: true,
    date: date || null,
    weekStart: weekStart || null,
    showCallFee: feesByPlatform.showCallFee !== false,
    requests,
    total: requests.length
  };
}

async function cancelWithdrawalRequest(accessToken, requestId) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const id = String(requestId || '').trim();
  if (!id) return { ok: false, status: 400, error: '신청 ID가 없습니다.' };

  const supabase = getServiceClient();
  return withRequestsLock(async () => {
    const list = normalizeRequestList(await readSettingValue(supabase, REQUESTS_KEY, []));
    const index = list.findIndex(item => item.id === id);
    if (index < 0) return { ok: false, status: 404, error: '출금신청을 찾을 수 없습니다.' };

    const current = list[index];
    if (current.status === 'cancelled') {
      return { ok: true, request: current, alreadyCancelled: true };
    }
    if (current.status === 'completed') {
      return { ok: false, status: 400, error: '처리완료된 신청은 취소할 수 없습니다.' };
    }

    const updated = {
      ...current,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    list[index] = updated;
    await writeSettingValue(supabase, REQUESTS_KEY, list);

    return {
      ok: true,
      request: updated,
      restoredAmount: updated.amount,
      message: `취소 완료 · ${updated.amount.toLocaleString('ko-KR')}원 출금가능금액 복구`
    };
  });
}

async function completeWithdrawalRequest(accessToken, requestId) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const id = String(requestId || '').trim();
  if (!id) return { ok: false, status: 400, error: '신청 ID가 없습니다.' };

  const supabase = getServiceClient();
  return withRequestsLock(async () => {
    const list = normalizeRequestList(await readSettingValue(supabase, REQUESTS_KEY, []));
    const index = list.findIndex(item => item.id === id);
    if (index < 0) return { ok: false, status: 404, error: '출금신청을 찾을 수 없습니다.' };

    const current = list[index];
    if (current.status === 'completed') {
      return { ok: true, request: current, alreadyCompleted: true };
    }
    if (current.status === 'cancelled') {
      return { ok: false, status: 400, error: '취소된 신청은 출금완료 처리할 수 없습니다.' };
    }

    const updated = {
      ...current,
      status: 'completed',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    list[index] = updated;
    await writeSettingValue(supabase, REQUESTS_KEY, list);

    return {
      ok: true,
      request: updated,
      message: `출금완료 처리 · ${updated.driverName || ''} ${updated.amount.toLocaleString('ko-KR')}원`
    };
  });
}

async function deleteWithdrawalRequest(accessToken, requestId) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const id = String(requestId || '').trim();
  if (!id) return { ok: false, status: 400, error: '신청 ID가 없습니다.' };

  const supabase = getServiceClient();
  return withRequestsLock(async () => {
    const list = normalizeRequestList(await readSettingValue(supabase, REQUESTS_KEY, []));
    const target = list.find(item => item.id === id);
    if (!target) return { ok: false, status: 404, error: '출금신청을 찾을 수 없습니다.' };

    const next = list.filter(item => item.id !== id);
    await writeSettingValue(supabase, REQUESTS_KEY, next);

    const restored = target.status === 'pending' ? target.amount : 0;
    return {
      ok: true,
      deleted: target,
      restoredAmount: restored,
      message: restored
        ? `삭제 완료 · ${restored.toLocaleString('ko-KR')}원 출금가능금액 복구`
        : '삭제 완료'
    };
  });
}

/**
 * 관리자용: 한 정산주(week)의 모든 일정산 등록 기사별 출금가능금액을 한 번에 계산한다.
 * 기사앱과 동일한 로직(실지급 − 신청중 − 처리완료 − 리스차감, 주마무리 시 0)을 쓰되
 * 설정/정산/리스 데이터를 각각 1회씩만 조회해 배치 계산한다.
 */
async function listWithdrawableDrivers(accessToken, weekStartInput) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const weekStart = normalizeSettlementWeekStart(weekStartInput || new Date());
  const weekEnd = settlementWeekEnd(weekStart);

  const [rosterRaw, feesRaw, requestsRaw, excludedRaw, finalizedRaw, pauseRaw] = await Promise.all([
    readSettingValue(supabase, ROSTER_KEY, []),
    readSettingValue(supabase, FEES_KEY, {}),
    readSettingValue(supabase, REQUESTS_KEY, []),
    readSettingValue(supabase, EXCLUDED_SETTLEMENTS_KEY, []),
    readSettingValue(supabase, FINALIZED_WEEKS_KEY, []),
    readSettingValue(supabase, WITHDRAWAL_PAUSE_KEY, {})
  ]);

  const rosterList = Array.isArray(rosterRaw) ? rosterRaw : [];
  const feesByPlatform = normalizeFees(feesRaw);
  const excludedSettlementIds = new Set(
    (Array.isArray(excludedRaw) ? excludedRaw : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
  );
  const finalizedEntry = findFinalizedWeekEntry(finalizedRaw, weekStart);
  const weekFinalized = Boolean(finalizedEntry);
  const pauseState = normalizeWithdrawalPauseState(pauseRaw);
  const allRequests = normalizeRequestList(requestsRaw);

  // 기사 기본정보(이름/전화/계좌) 1회 조회
  const ridersById = new Map();
  try {
    const { data: ridersData } = await supabase
      .from('riders')
      .select('id,name,phone,bank_name,account_number')
      .limit(10000);
    (ridersData || []).forEach(row => {
      ridersById.set(String(row.id), row);
    });
  } catch (_error) {
    // 조회 실패 시 roster 정보로 대체
  }

  // 일정산 명단(roster) 조회용 맵 (배민/쿠팡ID·지역 표시에 사용)
  const rosterByDriver = new Map();
  rosterList.forEach(item => {
    const id = String(item.driverId || '');
    if (id) rosterByDriver.set(id, item);
  });

  // 정산서가 올라온 전체 기사를 driver_id 필터 없이 1회 배치 조회한다.
  // (명단 등록 여부와 무관하게 업로드 반영된 전원을 노출)
  let daysByDriver = new Map();
  try {
    daysByDriver = await loadAllWeekDays(
      supabase,
      weekStart,
      feesByPlatform,
      excludedSettlementIds
    );
  } catch (_error) {
    daysByDriver = new Map();
  }

  // 리스 테이블 1회 로드
  const leaseTables = await loadLeaseTables(supabase);

  // 이번주 출금신청을 기사별로 그룹핑
  const requestsByDriver = new Map();
  allRequests
    .filter(item => item.weekStart === weekStart)
    .forEach(item => {
      const id = String(item.driverId || '');
      if (!requestsByDriver.has(id)) requestsByDriver.set(id, []);
      requestsByDriver.get(id).push(item);
    });

  // 대상 기사 = 정산서가 있는 전체 기사 ∪ 명단 등록 기사 ∪ 이번주 출금신청 기사
  const driverIdSet = new Set();
  daysByDriver.forEach((_days, id) => driverIdSet.add(id));
  rosterByDriver.forEach((_item, id) => driverIdSet.add(id));
  requestsByDriver.forEach((_req, id) => driverIdSet.add(id));

  const rows = [...driverIdSet].map(driverId => {
    const rosterItem = rosterByDriver.get(driverId) || {};
    const riderRow = ridersById.get(driverId) || {};
    const rider = {
      id: driverId,
      name: riderRow.name || rosterItem.driverName || '',
      phone: riderRow.phone || rosterItem.phone || ''
    };

    const days = daysByDriver.get(driverId) || [];
    const totalNetPay = days.reduce((sum, row) => sum + Math.max(0, row.netPay), 0);
    const netPayByPlatform = days.reduce((acc, row) => {
      const key = normalizePlatform(row.platform);
      acc[key] = (acc[key] || 0) + Math.max(0, row.netPay);
      return acc;
    }, { coupang: 0, baemin: 0 });
    const enrolledPlatforms = {
      coupang: days.some(row => normalizePlatform(row.platform) === 'coupang'),
      baemin: days.some(row => normalizePlatform(row.platform) === 'baemin')
    };

    const myReq = requestsByDriver.get(driverId) || [];
    const pending = myReq.filter(item => item.status === 'pending');
    const completed = myReq.filter(item => item.status === 'completed');
    const requestBuckets = accumulateRequestBuckets(myReq, feesByPlatform);
    const requestedAmountTotal = pending.reduce((sum, item) => sum + item.amount, 0);
    const requestedTotal = pending.reduce(
      (sum, item) => sum + requestConsumedAmount(item, feesByPlatform),
      0
    );
    const withdrawnAmountTotal = completed.reduce((sum, item) => sum + item.amount, 0);
    const withdrawnTotal = completed.reduce(
      (sum, item) => sum + requestConsumedAmount(item, feesByPlatform),
      0
    );

    const lease = computeLeaseForRider(leaseTables, rider, weekStart, weekEnd);
    const leaseDeduction = Math.max(0, Math.round(Number(lease.leaseDeductionTotal || 0)));
    const deductionPlatform = normalizeDeductionPlatform(lease.deductionPlatform);
    if (leaseDeduction > 0) {
      netPayByPlatform[deductionPlatform] = (netPayByPlatform[deductionPlatform] || 0) - leaseDeduction;
    }
    const availableByPlatform = computeAvailableByPlatform(netPayByPlatform, requestBuckets, weekFinalized);
    const availableAmount = weekFinalized ? 0 : totalAvailableFromPlatforms(availableByPlatform);

    return {
      driverId,
      driverName: rider.name || '-',
      phone: rider.phone || '',
      baeminId: rosterItem.baeminId || '',
      coupangId: rosterItem.coupangId || '',
      region: rosterItem.region || '',
      bankName: riderRow.bank_name || '',
      accountNumber: riderRow.account_number || '',
      totalNetPay,
      netPayByPlatform,
      availableByPlatform,
      enrolledPlatforms,
      requestedAmountTotal,
      requestedTotal,
      withdrawnAmountTotal,
      withdrawnTotal,
      leaseDeduction,
      leaseArrearReason: lease.arrearReason || '',
      availableAmount,
      hasSettlement: days.length > 0
    };
  });

  rows.sort((a, b) => {
    const nameCmp = String(a.driverName || '').localeCompare(String(b.driverName || ''), 'ko');
    if (nameCmp) return nameCmp;
    return String(a.driverId).localeCompare(String(b.driverId));
  });

  const totalAvailable = rows.reduce((sum, row) => sum + Math.max(0, row.availableAmount), 0);

  return {
    ok: true,
    weekStart,
    weekEnd,
    weekFinalized,
    weekFinalizedAt: finalizedEntry?.finalizedAt || '',
    withdrawalPaused: pauseState.paused === true,
    showCallFee: feesByPlatform.showCallFee !== false,
    feesByPlatform: {
      coupang: feesByPlatform.coupang,
      baemin: feesByPlatform.baemin
    },
    rows,
    total: rows.length,
    totalAvailable
  };
}

/**
 * 관리자용: 기사를 대신해 출금신청(대행) 하거나 강제출금(즉시 처리완료) 한다.
 *  - mode='request'  → status: pending (기사가 신청한 것처럼 목록에 추가)
 *  - mode='complete' → status: completed (강제출금, 처리완료 내역으로 바로 이동)
 *  - allowExceed=true → 출금가능금액 초과 검사를 건너뛴다(관리자 강제 조정용)
 */
async function adminCreateWithdrawalForDriver(accessToken, body = {}) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const driverId = String(body.driverId || '').trim();
  if (!driverId) {
    return { ok: false, status: 400, error: '기사 ID가 없습니다.' };
  }
  const amount = Math.max(0, Math.round(Number(body.amount || 0)));
  if (!amount) {
    return { ok: false, status: 400, error: '신청금액을 입력하세요.' };
  }
  const platform = normalizeRequestPlatform(body.platform);
  if (!platform) {
    return { ok: false, status: 400, error: '출금 플랫폼(쿠팡/배민)을 선택하세요.' };
  }
  const mode = String(body.mode || '').trim() === 'complete' ? 'complete' : 'request';
  const allowExceed = body.allowExceed === true;

  let rider = { id: driverId, name: String(body.driverName || '').trim(), phone: '' };
  try {
    const { data: riderRow } = await supabase
      .from('riders')
      .select('id,name,phone')
      .eq('id', driverId)
      .maybeSingle();
    if (riderRow) {
      rider = { id: String(riderRow.id), name: riderRow.name || rider.name, phone: riderRow.phone || '' };
    }
  } catch (_error) {
    // riders 조회 실패 시 body 정보로 진행
  }

  const summary = await buildDriverWeekSummary(supabase, rider, body.weekStart);
  if (!summary.ok) return summary;

  if (!summary.enrolledPlatforms?.[platform]) {
    return {
      ok: false,
      status: 400,
      error: `${platform === 'baemin' ? '배민' : '쿠팡'} 정산 내역이 없어 출금할 수 없습니다.`
    };
  }

  const platformFees = summary.feesByPlatform[platform] || summary.feesByPlatform.coupang || {};
  const feeAmount = resolveWithdrawalFee(amount, platformFees);
  const consumeAmount = amount + feeAmount;
  const platformAvailable = Number(summary.availableByPlatform?.[platform] ?? summary.availableAmount ?? 0);
  const platformLabel = platform === 'baemin' ? '배민' : '쿠팡';

  if (!allowExceed && consumeAmount > platformAvailable) {
    return {
      ok: false,
      status: 400,
      error: feeAmount > 0
        ? `출금 ${amount.toLocaleString('ko-KR')}원 + 일정산수수료 ${feeAmount.toLocaleString('ko-KR')}원 = ${consumeAmount.toLocaleString('ko-KR')}원이 ${platformLabel} 출금가능금액(${platformAvailable.toLocaleString('ko-KR')}원)을 초과합니다. 강제 조정하려면 초과 허용을 선택하세요.`
        : `${platformLabel} 출금가능금액(${platformAvailable.toLocaleString('ko-KR')}원)을 초과할 수 없습니다.`
    };
  }

  const now = new Date().toISOString();
  const request = normalizeRequest({
    driverId: summary.driverId,
    driverName: summary.driverName || rider.name,
    platform,
    amount,
    feeAmount,
    weekStart: summary.weekStart,
    requestDate: now.slice(0, 10),
    availableAtRequest: platformAvailable,
    status: mode === 'complete' ? 'completed' : 'pending',
    createdBy: 'admin',
    createdAt: now,
    updatedAt: now,
    completedAt: mode === 'complete' ? now : null
  });

  await withRequestsLock(async () => {
    const existing = normalizeRequestList(await readSettingValue(supabase, REQUESTS_KEY, []));
    existing.unshift(request);
    await writeSettingValue(supabase, REQUESTS_KEY, existing);
  });

  const nextAvailable = Math.max(0, Number(summary.availableAmount || 0) - consumeAmount);
  return {
    ok: true,
    request,
    mode,
    feeAmount,
    consumeAmount,
    availableAmount: nextAvailable,
    availableByPlatform: {
      ...(summary.availableByPlatform || { coupang: 0, baemin: 0 }),
      [platform]: Math.max(0, platformAvailable - consumeAmount)
    },
    message: mode === 'complete'
      ? `강제출금 완료 · ${request.driverName} · ${platformLabel} ${amount.toLocaleString('ko-KR')}원`
      : `대행 신청 완료 · ${request.driverName} · ${platformLabel} ${amount.toLocaleString('ko-KR')}원`
  };
}

module.exports = {
  getWithdrawalSummary,
  createWithdrawalRequest,
  listWithdrawalRequests,
  listWithdrawableDrivers,
  adminCreateWithdrawalForDriver,
  cancelWithdrawalRequest,
  completeWithdrawalRequest,
  deleteWithdrawalRequest,
  REQUESTS_KEY,
  // 정산 검수 스크립트 전용 노출. 검수가 계산식을 따로 구현하면 서버와 갈라져서
  // 검수 결과 자체를 믿을 수 없게 되므로, 실제로 쓰는 순수 함수만 그대로 내보낸다.
  // (상태를 바꾸는 함수는 절대 넣지 않는다.)
  __audit: {
    ROSTER_KEY,
    FEES_KEY,
    EXCLUDED_SETTLEMENTS_KEY,
    FINALIZED_WEEKS_KEY,
    EMP_RATE,
    INDUSTRIAL_RATE,
    WITHHOLDING_RATE,
    normalizeFees,
    normalizePlatform,
    normalizeRequestList,
    normalizeFinalizedWeeks,
    calcPayoutFromSettlement,
    resolveWithdrawalFee,
    resolveDailySettlementFee,
    requestConsumedAmount
  }
};

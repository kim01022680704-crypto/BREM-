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

/** 출금신청 금액 기준 일출금수수료 (출금시적용) */
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
  const employmentInsurance = Math.floor(settlementAmount * EMP_RATE);
  const industrialAccidentInsurance = Math.floor(settlementAmount * INDUSTRIAL_RATE);
  const withholdingTax = Math.floor(settlementAmount * WITHHOLDING_RATE);
  const callFeeUnit = Math.max(0, Math.round(Number(fees.callFee || 0)));
  const callFee = orderCount * callFeeUnit;
  const dailySettlementFee = resolveDailySettlementFee(settlementAmount, fees);
  const netPay = settlementAmount
    - employmentInsurance
    - industrialAccidentInsurance
    - withholdingTax
    - callFee
    - dailySettlementFee
    - hourlyInsurance;

  return {
    period: String(row.period || '').slice(0, 10),
    platform,
    settlementAmount,
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

async function buildDriverWeekSummary(supabase, rider, weekStartInput) {
  const weekStart = normalizeSettlementWeekStart(weekStartInput || new Date());
  const weekEnd = settlementWeekEnd(weekStart);
  const driverId = String(rider.id || '');
  const driverName = String(rider.name || '').trim();

  const [rosterRaw, feesRaw, requestsRaw, excludedRaw] = await Promise.all([
    readSettingValue(supabase, ROSTER_KEY, []),
    readSettingValue(supabase, FEES_KEY, {}),
    readSettingValue(supabase, REQUESTS_KEY, []),
    readSettingValue(supabase, EXCLUDED_SETTLEMENTS_KEY, [])
  ]);
  const rosterItem = findRosterEntry(rosterRaw, driverId);
  const feesByPlatform = normalizeFees(feesRaw);
  const excludedSettlementIds = new Set(
    (Array.isArray(excludedRaw) ? excludedRaw : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
  );
  const allRequests = normalizeRequestList(requestsRaw);
  const myWeekRequests = allRequests.filter(item => (
    item.driverId === driverId && item.weekStart === weekStart
  ));
  const pendingRequests = myWeekRequests.filter(item => item.status === 'pending');
  const requestedAmountTotal = pendingRequests.reduce((sum, item) => sum + item.amount, 0);
  const requestedFeeTotal = pendingRequests.reduce((sum, item) => {
    const consumed = requestConsumedAmount(item, feesByPlatform);
    return sum + Math.max(0, consumed - item.amount);
  }, 0);
  const requestedTotal = pendingRequests.reduce(
    (sum, item) => sum + requestConsumedAmount(item, feesByPlatform),
    0
  );

  const enrolledPlatforms = {
    coupang: isPlatformEnrolled(rosterItem, 'coupang'),
    baemin: isPlatformEnrolled(rosterItem, 'baemin')
  };

  if (!rosterItem) {
    return {
      ok: true,
      enrolled: false,
      weekStart,
      weekEnd,
      driverId,
      driverName,
      days: [],
      totalNetPay: 0,
      netPayByPlatform: { coupang: 0, baemin: 0 },
      requestedTotal,
      requestedAmountTotal,
      requestedFeeTotal,
      availableAmount: 0,
      enrolledPlatforms: { coupang: false, baemin: false },
      showCallFee: feesByPlatform.showCallFee !== false,
      feesByPlatform: {
        coupang: feesByPlatform.coupang,
        baemin: feesByPlatform.baemin
      },
      myRequests: myWeekRequests
    };
  }

  const { data: settlementRows, error } = await supabase
    .from('daily_settlements')
    .select('period,platform,order_count,hourly_insurance,delivery_amount,settlement_amount')
    .eq('driver_id', driverId)
    .gte('period', weekStart)
    .lte('period', weekEnd)
    .order('period', { ascending: true });

  if (error) {
    return { ok: false, status: 500, error: error.message || '일정산 데이터를 불러오지 못했습니다.' };
  }

  const days = (settlementRows || [])
    .filter(row => isPlatformEnrolled(rosterItem, row.platform))
    .filter(row => {
      const id = `${driverId}-${String(row.period || '').slice(0, 10)}-${normalizePlatform(row.platform)}`;
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
  const availableAmount = Math.max(0, totalNetPay - requestedTotal);

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
    requestedTotal,
    requestedAmountTotal,
    requestedFeeTotal,
    availableAmount,
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
  const summary = await buildDriverWeekSummary(supabase, me.rider, body.weekStart);
  if (!summary.ok) return summary;

  if (!summary.enrolled) {
    return { ok: false, status: 400, error: '일정산 등록 기사가 아닙니다. 관리자에게 문의하세요.' };
  }
  if (!summary.enrolledPlatforms?.[platform]) {
    return {
      ok: false,
      status: 400,
      error: `${platform === 'baemin' ? '배민' : '쿠팡'} 일정산 등록이 되어 있지 않습니다.`
    };
  }

  const feesByPlatform = normalizeFees(
    await readSettingValue(supabase, FEES_KEY, {})
  );
  const platformFees = feesByPlatform[platform] || feesByPlatform.coupang || {};
  const feeAmount = resolveWithdrawalFee(amount, platformFees);
  const consumeAmount = amount + feeAmount;

  if (consumeAmount > summary.availableAmount) {
    return {
      ok: false,
      status: 400,
      error: feeAmount > 0
        ? `출금 ${amount.toLocaleString('ko-KR')}원 + 일출금수수료 ${feeAmount.toLocaleString('ko-KR')}원 = ${consumeAmount.toLocaleString('ko-KR')}원이 출금가능금액(${summary.availableAmount.toLocaleString('ko-KR')}원)을 초과합니다.`
        : `출금가능금액(${summary.availableAmount.toLocaleString('ko-KR')}원)을 초과할 수 없습니다.`
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
    availableAtRequest: summary.availableAmount,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const existing = normalizeRequestList(await readSettingValue(supabase, REQUESTS_KEY, []));
  existing.unshift(request);
  await writeSettingValue(supabase, REQUESTS_KEY, existing);

  const nextAvailable = Math.max(0, summary.availableAmount - consumeAmount);
  return {
    ok: true,
    request,
    availableAmount: nextAvailable,
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

async function loadDriverWeekDays(supabase, driverId, weekStart, rosterItem, feesByPlatform, excludedSettlementIds = null) {
  const weekEnd = settlementWeekEnd(weekStart);
  const excluded = excludedSettlementIds instanceof Set
    ? excludedSettlementIds
    : new Set(Array.isArray(excludedSettlementIds) ? excludedSettlementIds : []);
  const { data: settlementRows, error } = await supabase
    .from('daily_settlements')
    .select('period,platform,order_count,hourly_insurance,delivery_amount,settlement_amount')
    .eq('driver_id', driverId)
    .gte('period', weekStart)
    .lte('period', weekEnd)
    .order('period', { ascending: true });
  if (error) throw error;
  return (settlementRows || [])
    .filter(row => isPlatformEnrolled(rosterItem, row.platform))
    .filter(row => {
      const id = `${driverId}-${String(row.period || '').slice(0, 10)}-${normalizePlatform(row.platform)}`;
      return !excluded.has(id);
    })
    .map(row => calcPayoutFromSettlement(row, feesByPlatform))
    .filter(row => row.period);
}

async function listWithdrawalRequests(accessToken, query = {}) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  const [listRaw, rosterRaw, feesRaw, excludedRaw] = await Promise.all([
    readSettingValue(supabase, REQUESTS_KEY, []),
    readSettingValue(supabase, ROSTER_KEY, []),
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

  const filtered = list.filter(item => {
    if (date && String(item.requestDate || item.createdAt || '').slice(0, 10) !== date) return false;
    if (weekStart && item.weekStart !== weekStart) return false;
    if (status && item.status !== status) return false;
    return true;
  });

  const detailCache = new Map();
  const requests = [];
  for (const item of filtered) {
    const cacheKey = `${item.driverId}|${item.weekStart}`;
    let detail = detailCache.get(cacheKey);
    if (!detail) {
      const rosterItem = findRosterEntry(rosterRaw, item.driverId);
      try {
        const days = rosterItem
          ? await loadDriverWeekDays(
            supabase,
            item.driverId,
            item.weekStart,
            rosterItem,
            feesByPlatform,
            excludedSettlementIds
          )
          : [];
        detail = sumDayTotals(days);
      } catch (_error) {
        detail = sumDayTotals([]);
      }
      detailCache.set(cacheKey, detail);
    }
    requests.push({
      ...item,
      ...detail,
      showCallFee: feesByPlatform.showCallFee !== false
    });
  }

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
}

async function completeWithdrawalRequest(accessToken, requestId) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const id = String(requestId || '').trim();
  if (!id) return { ok: false, status: 400, error: '신청 ID가 없습니다.' };

  const supabase = getServiceClient();
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
}

async function deleteWithdrawalRequest(accessToken, requestId) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const id = String(requestId || '').trim();
  if (!id) return { ok: false, status: 400, error: '신청 ID가 없습니다.' };

  const supabase = getServiceClient();
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
}

module.exports = {
  getWithdrawalSummary,
  createWithdrawalRequest,
  listWithdrawalRequests,
  cancelWithdrawalRequest,
  completeWithdrawalRequest,
  deleteWithdrawalRequest,
  REQUESTS_KEY
};

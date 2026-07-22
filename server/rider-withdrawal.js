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

function normalizeRequest(item = {}) {
  const amount = Math.max(0, Math.round(Number(item.amount || 0)));
  const weekStart = normalizeSettlementWeekStart(item.weekStart || item.settlementWeekStart);
  const status = ['pending', 'cancelled'].includes(String(item.status || ''))
    ? String(item.status)
    : 'pending';
  if (!item.driverId || !weekStart || amount <= 0) return null;
  const createdAt = item.createdAt || new Date().toISOString();
  const requestDate = String(item.requestDate || createdAt).slice(0, 10);
  return {
    id: String(item.id || `wd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    driverId: String(item.driverId),
    driverName: String(item.driverName || '').trim(),
    amount,
    weekStart,
    weekEnd: settlementWeekEnd(weekStart),
    requestDate,
    availableAtRequest: Math.max(0, Math.round(Number(item.availableAtRequest || 0))),
    status,
    createdAt,
    updatedAt: item.updatedAt || createdAt,
    cancelledAt: item.cancelledAt || null
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

  const [rosterRaw, feesRaw, requestsRaw] = await Promise.all([
    readSettingValue(supabase, ROSTER_KEY, []),
    readSettingValue(supabase, FEES_KEY, {}),
    readSettingValue(supabase, REQUESTS_KEY, [])
  ]);
  const rosterItem = findRosterEntry(rosterRaw, driverId);
  const feesByPlatform = normalizeFees(feesRaw);
  const allRequests = normalizeRequestList(requestsRaw);
  const myWeekRequests = allRequests.filter(item => (
    item.driverId === driverId && item.weekStart === weekStart
  ));
  const requestedTotal = myWeekRequests
    .filter(item => item.status === 'pending')
    .reduce((sum, item) => sum + item.amount, 0);

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
      requestedTotal,
      availableAmount: 0,
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
    .map(row => calcPayoutFromSettlement(row, feesByPlatform))
    .filter(row => row.period);

  const totalNetPay = days.reduce((sum, row) => sum + Math.max(0, row.netPay), 0);
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
    requestedTotal,
    availableAmount,
    myRequests: myWeekRequests
  };
}

async function getWithdrawalSummary(accessToken, weekStartInput) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;
  const supabase = getServiceClient();
  return buildDriverWeekSummary(supabase, me.rider, weekStartInput);
}

async function createWithdrawalRequest(accessToken, body = {}) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const amount = Math.max(0, Math.round(Number(body.amount || 0)));
  if (!amount) {
    return { ok: false, status: 400, error: '신청금액을 입력하세요.' };
  }

  const supabase = getServiceClient();
  const summary = await buildDriverWeekSummary(supabase, me.rider, body.weekStart);
  if (!summary.ok) return summary;

  if (!summary.enrolled) {
    return { ok: false, status: 400, error: '일정산 등록 기사가 아닙니다. 관리자에게 문의하세요.' };
  }
  if (amount > summary.availableAmount) {
    return {
      ok: false,
      status: 400,
      error: `출금가능금액(${summary.availableAmount.toLocaleString('ko-KR')}원)을 초과할 수 없습니다.`
    };
  }

  const request = normalizeRequest({
    driverId: summary.driverId,
    driverName: summary.driverName,
    amount,
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

  const nextAvailable = Math.max(0, summary.availableAmount - amount);
  return {
    ok: true,
    request,
    availableAmount: nextAvailable,
    totalNetPay: summary.totalNetPay,
    requestedTotal: summary.requestedTotal + amount,
    weekStart: summary.weekStart,
    weekEnd: summary.weekEnd
  };
}

async function listWithdrawalRequests(accessToken, query = {}) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;

  const supabase = getServiceClient();
  const list = normalizeRequestList(await readSettingValue(supabase, REQUESTS_KEY, []));
  const weekStart = query.weekStart ? normalizeSettlementWeekStart(query.weekStart) : '';
  const date = String(query.date || '').slice(0, 10);
  const status = String(query.status || '').trim();

  const filtered = list.filter(item => {
    if (date && String(item.requestDate || item.createdAt || '').slice(0, 10) !== date) return false;
    if (weekStart && item.weekStart !== weekStart) return false;
    if (status && item.status !== status) return false;
    return true;
  });

  return {
    ok: true,
    date: date || null,
    weekStart: weekStart || null,
    requests: filtered,
    total: filtered.length
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
  deleteWithdrawalRequest,
  REQUESTS_KEY
};

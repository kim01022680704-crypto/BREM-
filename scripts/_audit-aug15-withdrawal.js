const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function readEnvValue(filePath, key) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(new RegExp(`^${key}="?([^"\\r\\n]+)"?`, 'm'));
  return match ? String(match[1] || '').trim() : '';
}

const envFile = fs.existsSync(path.join(__dirname, '..', '.env'))
  ? path.join(__dirname, '..', '.env')
  : path.join(__dirname, '..', '.env.vercel.audit');

const EMP_RATE = 0.008;
const INDUSTRIAL_RATE = 0.0088;
const WITHHOLDING_RATE = 0.033;
const DAY = '2026-08-15';
const WEEK_START = '2026-08-12';
const WEEK_END = '2026-08-18';

function normalizePlatform(value) {
  return String(value || '').toLowerCase() === 'baemin' ? 'baemin' : 'coupang';
}

function calcPayout(row, feesByPlatform) {
  const platform = normalizePlatform(row.platform);
  const fees = feesByPlatform[platform] || feesByPlatform.coupang || {};
  const settlementAmount = Math.max(0, Math.round(Number(row.settlement_amount ?? row.delivery_amount ?? 0)));
  const orderCount = Math.max(0, Math.round(Number(row.order_count || 0)));
  const hourlyInsurance = Math.abs(Math.round(Number(row.hourly_insurance || 0)));
  const deductionBase = Math.max(0, Math.round(Number(row.deduction_base || 0))) || settlementAmount;
  const employmentInsurance = Math.floor(deductionBase * EMP_RATE);
  const industrialAccidentInsurance = Math.floor(deductionBase * INDUSTRIAL_RATE);
  const withholdingTax = Math.floor(deductionBase * WITHHOLDING_RATE);
  const callFee = orderCount * Math.max(0, Math.round(Number(fees.callFee || 0)));
  const netPay = settlementAmount
    - employmentInsurance
    - industrialAccidentInsurance
    - withholdingTax
    - callFee
    - hourlyInsurance;
  return { platform, settlementAmount, orderCount, hourlyInsurance, callFee, netPay };
}

async function readSetting(supabase, key, fallback) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value == null ? fallback : data.value;
}

async function main() {
  const url = readEnvValue(envFile, 'SUPABASE_URL');
  const key = readEnvValue(envFile, 'SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    console.error('NO_SUPABASE_ENV', Boolean(url), Boolean(key));
    process.exit(1);
  }
  if (!/^https:\/\//.test(url)) {
    console.error('BAD_SUPABASE_URL_SHAPE');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [feesRaw, excludedRaw, finalizedRaw, pauseRaw, requestsRaw] = await Promise.all([
    readSetting(supabase, 'brem_payroll_daily_settlement_fees_v1', {}),
    readSetting(supabase, 'brem_payroll_daily_excluded_settlements_v1', []),
    readSetting(supabase, 'brem_payroll_week_finalized_v1', []),
    readSetting(supabase, 'brem_payroll_withdrawal_paused_v1', {}),
    readSetting(supabase, 'brem_payroll_withdrawal_requests_v1', [])
  ]);
  const excluded = new Set((Array.isArray(excludedRaw) ? excludedRaw : []).map(item => String(item || '').trim()).filter(Boolean));
  const finalized = Array.isArray(finalizedRaw) ? finalizedRaw : [];
  const weekFinalized = finalized.some(item => String(item?.weekStart || item || '').slice(0, 10) === WEEK_START);
  const paused = pauseRaw === true || pauseRaw?.paused === true;
  const fees = feesRaw && typeof feesRaw === 'object' ? feesRaw : {};

  const { data: dayRows, error: dayError } = await supabase
    .from('daily_settlements')
    .select('driver_id,period,platform,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount')
    .eq('period', DAY);
  if (dayError) throw dayError;

  const { data: weekRows, error: weekError } = await supabase
    .from('daily_settlements')
    .select('driver_id,period,platform,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount')
    .gte('period', WEEK_START)
    .lte('period', WEEK_END);
  if (weekError) throw weekError;

  const riderIds = [...new Set((dayRows || []).map(row => String(row.driver_id || '')).filter(Boolean))];
  const { data: riders } = await supabase
    .from('riders')
    .select('id,name,phone')
    .in('id', riderIds.length ? riderIds : ['__none__']);
  const riderMap = new Map((riders || []).map(item => [String(item.id), item]));

  const dayStats = { total: 0, byPlatform: { coupang: 0, baemin: 0 }, amountZero: 0, netZeroOrMinus: 0, excluded: 0, noDriver: 0 };
  const dayZero = [];
  (dayRows || []).forEach((row) => {
    const driverId = String(row.driver_id || '');
    const sid = `${driverId}-${String(row.period || '').slice(0, 10)}-${normalizePlatform(row.platform)}`;
    const payout = calcPayout(row, fees);
    dayStats.total += 1;
    dayStats.byPlatform[payout.platform] += 1;
    if (!driverId) dayStats.noDriver += 1;
    if (excluded.has(sid)) dayStats.excluded += 1;
    if (payout.settlementAmount <= 0) dayStats.amountZero += 1;
    if (payout.netPay <= 0) {
      dayStats.netZeroOrMinus += 1;
      const rider = riderMap.get(driverId);
      dayZero.push({
        name: rider?.name || '(이름없음)',
        platform: payout.platform,
        settlementAmount: payout.settlementAmount,
        netPay: payout.netPay,
        hourlyInsurance: payout.hourlyInsurance,
        callFee: payout.callFee,
        excluded: excluded.has(sid),
        noDriver: !driverId
      });
    }
  });

  const weekByDriver = new Map();
  (weekRows || []).forEach((row) => {
    const driverId = String(row.driver_id || '');
    if (!driverId) return;
    const sid = `${driverId}-${String(row.period || '').slice(0, 10)}-${normalizePlatform(row.platform)}`;
    if (excluded.has(sid)) return;
    const payout = calcPayout(row, fees);
    const cur = weekByDriver.get(driverId) || { coupang: 0, baemin: 0, days: 0, hasAug15: false };
    cur[payout.platform] += Math.max(0, payout.netPay);
    cur.days += 1;
    if (String(row.period).slice(0, 10) === DAY) cur.hasAug15 = true;
    weekByDriver.set(driverId, cur);
  });

  const weekRequests = (Array.isArray(requestsRaw) ? requestsRaw : []).filter(item => String(item.weekStart || '').slice(0, 10) === WEEK_START);
  const consumeByDriver = new Map();
  weekRequests.forEach((item) => {
    if (item.status !== 'pending' && item.status !== 'completed') return;
    const driverId = String(item.driverId || '');
    const platform = normalizePlatform(item.platform);
    const amount = Math.max(0, Math.round(Number(item.amount || 0)));
    const fee = Math.max(0, Math.round(Number(item.feeAmount || 0)));
    const cur = consumeByDriver.get(driverId) || { coupang: 0, baemin: 0, pending: 0, completed: 0 };
    cur[platform] += amount + fee;
    if (item.status === 'pending') cur.pending += amount + fee;
    if (item.status === 'completed') cur.completed += amount + fee;
    consumeByDriver.set(driverId, cur);
  });

  const aug15Drivers = [...new Set((dayRows || []).map(row => String(row.driver_id || '')).filter(Boolean))];
  const availableZero = [];
  let availablePlus = 0;
  aug15Drivers.forEach((driverId) => {
    const nets = weekByDriver.get(driverId) || { coupang: 0, baemin: 0 };
    const used = consumeByDriver.get(driverId) || { coupang: 0, baemin: 0 };
    const coupang = weekFinalized ? 0 : (nets.coupang - used.coupang);
    const baemin = weekFinalized ? 0 : (nets.baemin - used.baemin);
    const available = coupang + baemin;
    const rider = riderMap.get(driverId);
    if (available <= 0) {
      availableZero.push({
        name: rider?.name || '(이름없음)',
        weekCoupang: nets.coupang,
        weekBaemin: nets.baemin,
        usedCoupang: used.coupang,
        usedBaemin: used.baemin,
        pending: used.pending || 0,
        completed: used.completed || 0,
        reason: (nets.coupang + nets.baemin) <= 0
          ? '이번주 실지급 0'
          : ((used.completed || 0) > 0 && (used.pending || 0) <= 0)
            ? '이미 출금완료'
            : ((used.pending || 0) > 0 && (used.completed || 0) <= 0)
              ? '출금신청 대기중'
              : '출금신청+완료로 소진'
      });
    } else {
      availablePlus += 1;
    }
  });

  const report = {
    day: DAY,
    week: `${WEEK_START} ~ ${WEEK_END}`,
    weekFinalized,
    withdrawalPaused: paused,
    fees: {
      coupangCallFee: fees.coupang?.callFee ?? fees.callFee ?? null,
      baeminCallFee: fees.baemin?.callFee ?? null
    },
    dayRows: dayStats,
    dayNetZeroSample: dayZero.slice(0, 40),
    aug15Drivers: aug15Drivers.length,
    availablePlus,
    availableZeroCount: availableZero.length,
    availableZeroSample: availableZero.slice(0, 50),
    weekRequestCount: weekRequests.length,
    excludedCount: excluded.size
  };
  const reasonCount = {};
  availableZero.forEach((item) => {
    reasonCount[item.reason] = (reasonCount[item.reason] || 0) + 1;
  });
  report.availableZeroReasons = reasonCount;
  const out = path.join(__dirname, '..', 'logs', 'audit-aug15-withdrawal.json');
  fs.writeFileSync(out, Buffer.from(JSON.stringify(report, null, 2), 'utf8'));
  const lines = [
    '이름\t쿠팡실지급\t배민실지급\t신청대기\t출금완료\t사유'
  ].concat(availableZero.map(item => [
    item.name,
    item.weekCoupang,
    item.weekBaemin,
    item.pending,
    item.completed,
    item.reason
  ].join('\t')));
  fs.writeFileSync(path.join(__dirname, '..', 'logs', 'audit-aug15-zero.tsv'), `\uFEFF${lines.join('\n')}`, 'utf8');
  console.log(JSON.stringify({
    dayRows: report.dayRows,
    weekFinalized: report.weekFinalized,
    withdrawalPaused: report.withdrawalPaused,
    aug15Drivers: report.aug15Drivers,
    availablePlus: report.availablePlus,
    availableZeroCount: report.availableZeroCount,
    availableZeroReasons: reasonCount,
    dayNetZeroNames: (report.dayNetZeroSample || []).map(item => `${item.name}/${item.platform}/${item.settlementAmount}`)
  }, null, 2));
}


main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');

const PUBLISH_META_KEY = 'brem_payroll_rider_publish';

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function formatLocalDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function normalizeSettlementWeekStart(dateValue) {
  const seed = String(dateValue || '').trim().slice(0, 10);
  const base = seed || formatLocalDateKey(new Date());
  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const diff = (date.getDay() - 3 + 7) % 7;
  date.setDate(date.getDate() - diff);
  return formatLocalDateKey(date);
}

function settlementWeekEnd(weekStart) {
  const start = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + 6);
  return formatLocalDateKey(start);
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatLocalDateKey(date);
}

function defaultPaymentDateForWeekEnd(weekEnd) {
  return weekEnd ? addDays(weekEnd, 3) : '';
}

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

async function resolvePaymentDate(supabase, settlementWeekStart, settlementWeekEndDate) {
  try {
    const meta = await readSettingValue(supabase, PUBLISH_META_KEY, {});
    const fromMeta = meta?.weeks?.[settlementWeekStart]?.paymentDate;
    if (fromMeta) return String(fromMeta).slice(0, 10);
  } catch (_error) {
    /* ignore */
  }
  return defaultPaymentDateForWeekEnd(settlementWeekEndDate);
}

function parseMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function normalizePlatform(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'coupang' || raw === '쿠팡') return 'coupang';
  if (raw === 'baemin' || raw === '배민') return 'baemin';
  if (raw === 'both' || raw === '쿠팡·배민' || raw === '쿠팡/배민') return 'both';
  return '';
}

/** 정산결과(직계약)과 같은 지급·공제 키 */
function emptyDirectBucket() {
  return {
    callCount: 0,
    deliveryFee: 0,
    missionPay: 0,
    other: 0,
    promo: 0,
    grossPay: 0,
    deductionDetail: 0,
    employmentInsurance: 0,
    accidentInsurance: 0,
    hourlyInsurance: 0,
    withholdingTax: 0,
    promotionWithholdingTax: 0,
    callFee: 0,
    dailySettlementFee: 0,
    prepaid: 0,
    deductTotal: 0,
    netPay: 0
  };
}

function addBuckets(target, source) {
  Object.keys(target).forEach(key => {
    target[key] += parseMoney(source?.[key]);
  });
  return target;
}

function finalizeBucket(bucket) {
  const next = { ...emptyDirectBucket(), ...(bucket || {}) };
  next.callCount = Math.max(0, Math.round(Number(next.callCount || 0)));
  next.grossPay = next.deliveryFee + next.missionPay + next.other + next.promo;
  next.deductTotal = next.deductionDetail
    + next.employmentInsurance
    + next.accidentInsurance
    + next.hourlyInsurance
    + next.withholdingTax
    + next.promotionWithholdingTax
    + next.callFee
    + next.dailySettlementFee
    + next.prepaid;
  next.netPay = next.grossPay - next.deductTotal;
  return next;
}

function readRawPayslip(line) {
  const raw = line?.raw_data && typeof line.raw_data === 'object' ? line.raw_data : {};
  const payslip = raw.payslip && typeof raw.payslip === 'object' ? raw.payslip : raw;
  return { raw, payslip };
}

function lineToDirectBucket(line) {
  const { raw, payslip } = readRawPayslip(line);
  const get = (key, ...aliases) => {
    for (const name of [key, ...aliases]) {
      if (payslip[name] != null && payslip[name] !== '') return parseMoney(payslip[name]);
      if (raw[name] != null && raw[name] !== '') return parseMoney(raw[name]);
    }
    return 0;
  };

  const bucket = emptyDirectBucket();
  bucket.callCount = Math.max(0, Math.round(Number(
    payslip.callCount ?? raw.callCount ?? line?.call_count ?? 0
  )));
  bucket.deliveryFee = get('deliveryFee', 'totalDeliveryFee', 'basePay');
  bucket.missionPay = get('missionPay', 'baeminMission');
  bucket.other = get('other', 'otherPayment');
  bucket.promo = get('promo', 'bremPromotion');
  bucket.deductionDetail = get('deductionDetail');
  bucket.employmentInsurance = get('employmentInsurance');
  bucket.accidentInsurance = get('accidentInsurance', 'industrialAccidentInsurance');
  bucket.hourlyInsurance = get('hourlyInsurance');
  bucket.withholdingTax = get('withholdingTax', 'incomeTax');
  bucket.promotionWithholdingTax = get('promotionWithholdingTax');
  bucket.callFee = get('callFee');
  bucket.dailySettlementFee = get('dailySettlementFee');
  bucket.prepaid = get('prepaid');
  return finalizeBucket(bucket);
}

function resolveLinePlatform(line) {
  const { raw, payslip } = readRawPayslip(line);
  return normalizePlatform(
    payslip.platform
    || raw.platform
    || raw.matchPlatform
    || payslip.matchPlatform
    || raw.branchPlatform
  );
}

/**
 * 브로 한 줄에 쿠팡·배민이 섞인 경우:
 * - 추가지급(미션)=배민미션 → 배민
 * - 나머지 지급·공제 → 쿠팡
 * (대리점명이 플랫폼을 가리키면 그 플랫폼에 전액)
 */
function splitLineIntoPlatforms(line) {
  const platform = resolveLinePlatform(line);
  const full = lineToDirectBucket(line);
  const coupang = emptyDirectBucket();
  const baemin = emptyDirectBucket();

  if (platform === 'coupang') {
    addBuckets(coupang, full);
  } else if (platform === 'baemin') {
    addBuckets(baemin, full);
  } else {
    // both / 미지정: 배민미션만 배민, 나머지는 쿠팡
    baemin.missionPay = full.missionPay;
    coupang.callCount = full.callCount;
    coupang.deliveryFee = full.deliveryFee;
    coupang.other = full.other;
    coupang.promo = full.promo;
    coupang.deductionDetail = full.deductionDetail;
    coupang.employmentInsurance = full.employmentInsurance;
    coupang.accidentInsurance = full.accidentInsurance;
    coupang.hourlyInsurance = full.hourlyInsurance;
    coupang.withholdingTax = full.withholdingTax;
    coupang.promotionWithholdingTax = full.promotionWithholdingTax;
    coupang.callFee = full.callFee;
    coupang.dailySettlementFee = full.dailySettlementFee;
    coupang.prepaid = full.prepaid;
  }

  return {
    coupang: finalizeBucket(coupang),
    baemin: finalizeBucket(baemin)
  };
}

function bucketToLegacyPayslip(bucket, meta = {}) {
  const row = finalizeBucket(bucket);
  return {
    riderName: meta.riderName || '',
    coupangId: meta.coupangId || '',
    baeminId: meta.baeminId || '',
    callCount: row.callCount,
    // 레거시 키 (기존 클라이언트·브로 호환)
    totalDeliveryFee: row.deliveryFee,
    baeminMission: row.missionPay,
    otherPayment: row.other,
    bremPromotion: row.promo,
    grossPaymentTotal: row.grossPay,
    employmentInsurance: row.employmentInsurance,
    industrialAccidentInsurance: row.accidentInsurance,
    hourlyInsurance: row.hourlyInsurance,
    withholdingTax: row.withholdingTax,
    promotionWithholdingTax: row.promotionWithholdingTax,
    callFee: row.callFee,
    dailySettlementFee: row.dailySettlementFee,
    deductionTotal: row.deductTotal,
    finalNetPay: row.netPay,
    // 직계약 정렬 키
    deliveryFee: row.deliveryFee,
    missionPay: row.missionPay,
    other: row.other,
    promo: row.promo,
    grossPay: row.grossPay,
    deductionDetail: row.deductionDetail,
    accidentInsurance: row.accidentInsurance,
    prepaid: row.prepaid,
    deductTotal: row.deductTotal,
    netPay: row.netPay,
    settlementWeekStart: meta.settlementWeekStart || '',
    settlementWeekEnd: meta.settlementWeekEnd || '',
    settlementWeekLabel: meta.settlementWeekLabel || ''
  };
}

function buildPayslipFromLines(weekLines, meta = {}) {
  const platforms = {
    coupang: emptyDirectBucket(),
    baemin: emptyDirectBucket()
  };

  weekLines.forEach(line => {
    const split = splitLineIntoPlatforms(line);
    addBuckets(platforms.coupang, split.coupang);
    addBuckets(platforms.baemin, split.baemin);
  });

  platforms.coupang = finalizeBucket(platforms.coupang);
  platforms.baemin = finalizeBucket(platforms.baemin);

  const totals = emptyDirectBucket();
  addBuckets(totals, platforms.coupang);
  addBuckets(totals, platforms.baemin);
  const finalized = finalizeBucket(totals);

  const first = weekLines[0] || null;
  const { raw, payslip } = first ? readRawPayslip(first) : { raw: {}, payslip: {} };

  return {
    ...bucketToLegacyPayslip(finalized, {
      riderName: String(payslip.riderName || first?.rider_name || meta.riderName || '').trim(),
      coupangId: String(payslip.coupangId || raw.matchedCoupangId || meta.coupangId || '').trim(),
      baeminId: String(payslip.baeminId || raw.matchedBaeminId || meta.baeminId || '').trim(),
      settlementWeekStart: meta.settlementWeekStart || '',
      settlementWeekEnd: meta.settlementWeekEnd || '',
      settlementWeekLabel: meta.settlementWeekLabel
        || String(raw.settlementWeekLabel || '').trim()
    }),
    platforms: {
      coupang: platforms.coupang,
      baemin: platforms.baemin
    },
    source: 'bro'
  };
}

function contractMatchesRider(contractRow, rider) {
  const raw = contractRow?.raw_data && typeof contractRow.raw_data === 'object'
    ? contractRow.raw_data
    : {};
  if (raw.driverId && String(raw.driverId) === String(rider.id)) return true;
  const nameMatch = normalizeName(raw.driverName) && normalizeName(raw.driverName) === normalizeName(rider.name);
  const phoneMatch = normalizePhone(raw.driverPhone) && normalizePhone(raw.driverPhone) === normalizePhone(rider.phone);
  return nameMatch && phoneMatch;
}

async function findRiderLeaseInfo(supabase, rider) {
  const { data: contracts, error } = await supabase
    .from('lease_contracts')
    .select('id,contract_type,status,daily_charge,raw_data,start_date,end_date')
    .in('status', ['active', 'operating', 'rented'])
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) {
    return { ok: false, error: error.message || '리스 계약을 불러오지 못했습니다.' };
  }

  const contract = (contracts || []).find(row => contractMatchesRider(row, rider));
  if (!contract) {
    return {
      ok: true,
      hasLease: false,
      contractType: '',
      leaseFee: 0,
      weeklyRent: 0,
      unpaidAmount: 0,
      vehicleNumber: ''
    };
  }

  const raw = contract.raw_data || {};
  const dailyRent = Number(raw.dailyRent || contract.daily_charge || 0);
  const weeklyRent = Number(raw.weeklyRent || dailyRent * 7 || 0);
  const leaseCost = Number(raw.leaseCost || weeklyRent || 0);
  const contractId = contract.id ? String(contract.id) : '';
  let unpaidAmount = 0;
  const unpaidReasons = [];

  const COMPLETED = new Set(['completed', 'recovered', 'done', 'paid', 'closed']);
  const { data: arrears } = await supabase
    .from('lease_arrears')
    .select('unpaid_amount,raw_data,collection_status,contract_id')
    .order('updated_at', { ascending: false })
    .limit(200);

  (arrears || []).forEach(row => {
    const rowRaw = row.raw_data || {};
    const sameDriver = String(rowRaw.driverId || '') === String(rider.id)
      || (
        normalizeName(rowRaw.driverName) === normalizeName(rider.name)
        && normalizePhone(rowRaw.driverPhone) === normalizePhone(rider.phone)
        && normalizeName(rowRaw.driverName)
      );
    const sameContract = contractId && String(row.contract_id || '') === contractId;
    if (!sameDriver && !sameContract) return;
    const status = String(row.collection_status || rowRaw.collectionStatus || '').toLowerCase();
    if (COMPLETED.has(status)) return;
    const remaining = Math.max(0, Number(row.unpaid_amount ?? rowRaw.unpaidAmount ?? 0));
    if (remaining <= 0) return;
    unpaidAmount += remaining;
    const reason = String(rowRaw.arrearReason || rowRaw.reason || '').trim()
      || (rowRaw.source === 'weekly-auto' ? '주정산 리스비 미납' : '리스비 미납');
    unpaidReasons.push(reason);
  });

  const contractType = String(contract.contract_type || raw.contractType || 'lease');
  return {
    ok: true,
    hasLease: contractType === 'lease',
    isRental: contractType === 'rental',
    contractType,
    leaseFee: leaseCost,
    weeklyRent,
    unpaidAmount,
    unpaidReason: [...new Set(unpaidReasons)].join(', '),
    vehicleNumber: String(raw.vehicleNumber || '').trim(),
    contractId: contract.id
  };
}

async function getRiderWeeklyPayslip(accessToken, weekStartInput) {
  const me = await getRiderMe(accessToken);
  if (!me.ok) return me;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const requestedRaw = String(weekStartInput || '').trim();
  const hasRequestedWeek = /\d{4}-\d{2}-\d{2}/.test(requestedRaw);

  const [linesResult, noticesResult, leaseInfo] = await Promise.all([
    supabase
      .from('payroll_slip_lines')
      .select('*')
      .eq('driver_id', me.riderId)
      .not('rider_published_at', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(80),
    supabase
      .from('payroll_notices')
      .select('id,title,body,label,settlement_week_start,sort_order,rider_published_at,updated_at')
      .not('rider_published_at', 'is', null)
      .order('sort_order', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(30),
    findRiderLeaseInfo(supabase, me.rider)
  ]);

  const { data: lines, error } = linesResult;

  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message || '')) {
      return { ok: false, status: 400, error: '급여명세서 테이블이 준비되지 않았습니다.' };
    }
    return { ok: false, status: 500, error: error.message || '주급명세서를 불러오지 못했습니다.' };
  }

  let settlementWeekStart;
  if (hasRequestedWeek) {
    settlementWeekStart = normalizeSettlementWeekStart(requestedRaw);
  } else {
    let latestWeek = '';
    for (const row of (lines || [])) {
      const raw = row.raw_data || {};
      const wk = String(raw.settlementWeekStart || raw.settlementWeekPayKey || '').slice(0, 10);
      if (wk) {
        latestWeek = normalizeSettlementWeekStart(wk);
        break;
      }
    }
    settlementWeekStart = latestWeek || normalizeSettlementWeekStart('');
  }
  const settlementWeekEndDate = settlementWeekEnd(settlementWeekStart);
  const paymentDate = await resolvePaymentDate(supabase, settlementWeekStart, settlementWeekEndDate);

  // 같은 주에 쿠팡·배민 줄이 각각 있으면 모두 합친다. (예전엔 첫 줄만 써서 한쪽이 빠졌다)
  const weekLines = (lines || []).filter(row => {
    const raw = row.raw_data || {};
    const week = String(raw.settlementWeekStart || raw.settlementWeekPayKey || '').slice(0, 10);
    return week === settlementWeekStart;
  });

  let notices = [];
  if (!noticesResult.error) {
    notices = (noticesResult.data || [])
      .filter(row => {
        const scoped = String(row.settlement_week_start || '').slice(0, 10);
        return !scoped || scoped === settlementWeekStart;
      })
      .map(row => ({
        id: row.id,
        title: String(row.title || '').trim(),
        body: String(row.body || '').trim(),
        label: String(row.label || 'notice').trim(),
        settlementWeekStart: String(row.settlement_week_start || '').slice(0, 10),
        publishedAt: row.rider_published_at || row.updated_at || null
      }));
  }

  if (!leaseInfo.ok) {
    return { ok: false, status: 500, error: leaseInfo.error };
  }

  const loginId = `${String(me.rider?.name || '').replace(/\s/g, '')}${normalizePhone(me.rider?.phone).slice(-4)}`;
  const riderMeta = {
    id: me.riderId,
    name: me.rider?.name || '',
    phone: me.rider?.phone || '',
    coupangId: loginId,
    baeminId: String(me.rider?.baemin_id || me.rider?.baeminId || '').trim()
  };

  const payslip = weekLines.length
    ? buildPayslipFromLines(weekLines, {
      riderName: riderMeta.name,
      coupangId: riderMeta.coupangId,
      baeminId: riderMeta.baeminId,
      settlementWeekStart,
      settlementWeekEnd: settlementWeekEndDate,
      settlementWeekLabel: `${settlementWeekStart}(수) ~ ${settlementWeekEndDate}(화)`
    })
    : null;

  return {
    ok: true,
    riderId: me.riderId,
    settlementWeekStart,
    settlementWeekEnd: settlementWeekEndDate,
    paymentDate,
    settlementWeekLabel: payslip?.settlementWeekLabel
      || `${settlementWeekStart}(수) ~ ${settlementWeekEndDate}(화)`,
    hasPayslip: Boolean(payslip),
    payslip,
    rider: riderMeta,
    lease: {
      hasLease: leaseInfo.hasLease || leaseInfo.isRental,
      contractType: leaseInfo.contractType,
      leaseLabel: leaseInfo.hasLease ? '리스' : (leaseInfo.isRental ? '렌탈' : '없음'),
      leaseFee: leaseInfo.leaseFee,
      weeklyRent: leaseInfo.weeklyRent,
      unpaidAmount: leaseInfo.unpaidAmount,
      unpaidReason: leaseInfo.unpaidReason || '',
      vehicleNumber: leaseInfo.vehicleNumber || ''
    },
    notices
  };
}

module.exports = {
  getRiderWeeklyPayslip,
  normalizeSettlementWeekStart,
  settlementWeekEnd,
  defaultPaymentDateForWeekEnd,
  buildPayslipFromLines,
  lineToDirectBucket,
  splitLineIntoPlatforms
};

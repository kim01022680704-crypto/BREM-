const { getServiceClient } = require('./admin-bootstrap');
const { getRiderMe } = require('./rider-auth');

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

function parseMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function readPayslipFields(line) {
  const raw = line?.raw_data && typeof line.raw_data === 'object' ? line.raw_data : {};
  const payslip = raw.payslip && typeof raw.payslip === 'object' ? raw.payslip : raw;
  const get = (key, fallbackKey) => parseMoney(payslip[key] ?? raw[key] ?? (fallbackKey ? line?.[fallbackKey] : 0));

  const totalDeliveryFee = get('totalDeliveryFee', 'basePay');
  const baeminMission = get('baeminMission');
  const otherPayment = get('otherPayment');
  const bremPromotion = get('bremPromotion');
  const grossPaymentTotal = get('grossPaymentTotal', 'grossPay') || (
    totalDeliveryFee + baeminMission + otherPayment + bremPromotion
  );
  const employmentInsurance = get('employmentInsurance');
  const industrialAccidentInsurance = get('industrialAccidentInsurance');
  const hourlyInsurance = get('hourlyInsurance');
  const withholdingTax = get('withholdingTax', 'incomeTax');
  const promotionWithholdingTax = get('promotionWithholdingTax');
  const callFee = get('callFee');
  const dailySettlementFee = get('dailySettlementFee');
  const deductionTotal = get('deductionTotal', 'totalDeduction') || (
    employmentInsurance + industrialAccidentInsurance + hourlyInsurance
    + withholdingTax + promotionWithholdingTax + callFee + dailySettlementFee
  );
  const finalNetPay = get('calculatedNetPay', 'netPay') || get('finalNetPay') || Math.max(0, grossPaymentTotal - deductionTotal);

  return {
    riderName: String(payslip.riderName || line?.rider_name || '').trim(),
    coupangId: String(payslip.coupangId || raw.matchedCoupangId || '').trim(),
    baeminId: String(payslip.baeminId || raw.matchedBaeminId || '').trim(),
    callCount: Number(raw.callCount || 0),
    totalDeliveryFee,
    baeminMission,
    otherPayment,
    bremPromotion,
    grossPaymentTotal,
    employmentInsurance,
    industrialAccidentInsurance,
    hourlyInsurance,
    withholdingTax,
    promotionWithholdingTax,
    callFee,
    dailySettlementFee,
    deductionTotal,
    finalNetPay,
    settlementWeekStart: String(raw.settlementWeekStart || '').slice(0, 10),
    settlementWeekEnd: String(raw.settlementWeekEnd || '').slice(0, 10),
    settlementWeekLabel: String(raw.settlementWeekLabel || '').trim()
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
  let unpaidAmount = Number(raw.unpaidAmount || 0);

  const { data: arrears } = await supabase
    .from('lease_arrears')
    .select('amount,raw_data')
    .order('updated_at', { ascending: false })
    .limit(100);

  (arrears || []).forEach(row => {
    const rowRaw = row.raw_data || {};
    const sameDriver = String(rowRaw.driverId || '') === String(rider.id)
      || (
        normalizeName(rowRaw.driverName) === normalizeName(rider.name)
        && normalizePhone(rowRaw.driverPhone) === normalizePhone(rider.phone)
      );
    if (sameDriver) unpaidAmount += Number(row.amount || rowRaw.unpaidAmount || 0);
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

  const settlementWeekStart = normalizeSettlementWeekStart(weekStartInput);
  const settlementWeekEndDate = settlementWeekEnd(settlementWeekStart);
  const paymentDate = addDays(settlementWeekEndDate, 1);

  const { data: lines, error } = await supabase
    .from('payroll_slip_lines')
    .select('*')
    .eq('driver_id', me.riderId)
    .order('updated_at', { ascending: false })
    .limit(300);

  if (error) {
    if (/does not exist|relation|schema cache/i.test(error.message || '')) {
      return { ok: false, status: 400, error: '급여명세서 테이블이 준비되지 않았습니다.' };
    }
    return { ok: false, status: 500, error: error.message || '주급명세서를 불러오지 못했습니다.' };
  }

  const matchedLine = (lines || []).find(row => {
    const raw = row.raw_data || {};
    const week = String(raw.settlementWeekStart || raw.settlementWeekPayKey || '').slice(0, 10);
    return week === settlementWeekStart && row.rider_published_at != null;
  }) || null;

  let notices = [];
  try {
    const { data: noticeRows } = await supabase
      .from('payroll_notices')
      .select('id,title,body,label,settlement_week_start,sort_order,rider_published_at,updated_at')
      .not('rider_published_at', 'is', null)
      .order('sort_order', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(50);
    notices = (noticeRows || [])
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
  } catch (_noticeError) {
    notices = [];
  }

  const leaseInfo = await findRiderLeaseInfo(supabase, me.rider);
  if (!leaseInfo.ok) {
    return { ok: false, status: 500, error: leaseInfo.error };
  }

  const loginId = `${String(me.rider?.name || '').replace(/\s/g, '')}${normalizePhone(me.rider?.phone).slice(-4)}`;

  return {
    ok: true,
    riderId: me.riderId,
    settlementWeekStart,
    settlementWeekEnd: settlementWeekEndDate,
    paymentDate,
    settlementWeekLabel: matchedLine?.raw_data?.settlementWeekLabel
      || `${settlementWeekStart}(수) ~ ${settlementWeekEndDate}(화)`,
    hasPayslip: Boolean(matchedLine),
    payslip: matchedLine ? readPayslipFields(matchedLine) : null,
    rider: {
      id: me.riderId,
      name: me.rider?.name || '',
      phone: me.rider?.phone || '',
      coupangId: loginId,
      baeminId: String(me.rider?.baemin_id || me.rider?.baeminId || '').trim()
    },
    lease: {
      hasLease: leaseInfo.hasLease || leaseInfo.isRental,
      contractType: leaseInfo.contractType,
      leaseLabel: leaseInfo.hasLease ? '리스' : (leaseInfo.isRental ? '렌탈' : '없음'),
      leaseFee: leaseInfo.leaseFee,
      weeklyRent: leaseInfo.weeklyRent,
      unpaidAmount: leaseInfo.unpaidAmount,
      vehicleNumber: leaseInfo.vehicleNumber || ''
    },
    notices
  };
}

module.exports = {
  getRiderWeeklyPayslip,
  normalizeSettlementWeekStart,
  settlementWeekEnd
};

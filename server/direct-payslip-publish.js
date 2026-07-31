const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');

function num(value) {
  return Math.round(Number(value || 0));
}

function normalizePlatform(value) {
  return String(value || '').toLowerCase() === 'coupang' ? 'coupang' : 'baemin';
}

function formatLocalDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function normalizeWeekStart(dateValue) {
  const base = String(dateValue || '').slice(0, 10);
  const date = new Date(`${base || formatLocalDateKey(new Date())}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getDay();
  // 시작일이 화요일로 하루 밀린 경우(off-by-one) 다음날 수요일로 교정한다.
  if (day === 2) {
    date.setDate(date.getDate() + 1);
    return formatLocalDateKey(date);
  }
  const diff = (day - 3 + 7) % 7; // 그 외에는 포함 주의 수요일로 스냅
  date.setDate(date.getDate() - diff);
  return formatLocalDateKey(date);
}

function weekEndOf(weekStart) {
  const start = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  start.setDate(start.getDate() + 6);
  return formatLocalDateKey(start);
}

/**
 * 정산결과(직계약) 최종결산 행들을 기사앱 주급명세서(payroll_slip_lines)로 반영한다.
 * - 행 단위(정산서×기사×플랫폼)로 저장하며, 같은 사람이 쿠팡/배민 둘 다면 두 줄이 저장된다.
 * - id = direct-{settlementId}-{driverId} 로 재반영 시 덮어쓴다(중복 방지).
 * - rider_published_at 을 찍어 즉시 기사앱에 노출된다.
 */
async function publishDirectSettlementPayslips(accessToken, body = {}) {
  const admin = await verifyAdminCaller(accessToken);
  if (!admin.ok) return admin;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const weekStart = normalizeWeekStart(body.weekStart);
  if (!weekStart) return { ok: false, status: 400, error: '정산주(weekStart)가 올바르지 않습니다.' };
  const weekEnd = weekEndOf(weekStart);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return { ok: false, status: 400, error: '반영할 정산 행이 없습니다.' };

  const now = new Date().toISOString();
  const records = [];
  rows.forEach(row => {
    const driverId = String(row.driverId || '').trim();
    if (!driverId) return; // 매칭 안 된 행은 건너뜀
    const platform = normalizePlatform(row.platform);
    const settlementId = String(row.settlementId || '').trim();
    const grossPay = num(row.grossPay);
    const deductTotal = num(row.deductTotal);
    const netPay = num(row.netPay);
    const baeminId = platform === 'baemin' ? String(row.idLabel || '').trim() : String(row.baeminId || '').trim();
    const coupangId = platform === 'coupang' ? String(row.idLabel || '').trim() : String(row.coupangId || '').trim();

    const payslip = {
      platform,
      callCount: num(row.callCount),
      deliveryFee: num(row.deliveryFee),
      missionPay: num(row.missionPay),
      other: num(row.other),
      promo: num(row.promo),
      grossPay,
      deductionDetail: num(row.deductionDetail),
      employmentInsurance: num(row.employmentInsurance),
      accidentInsurance: num(row.accidentInsurance),
      hourlyInsurance: num(row.hourlyInsurance),
      withholdingTax: num(row.withholdingTax),
      promotionWithholdingTax: num(row.promotionWithholdingTax),
      callFee: num(row.callFee),
      dailySettlementFee: num(row.dailySettlementFee),
      prepaid: num(row.prepaid),
      deductTotal,
      netPay,
      baeminId,
      coupangId,
      settlementWeekStart: weekStart,
      settlementWeekEnd: weekEnd
    };

    records.push({
      id: `direct-${settlementId}-${driverId}`,
      upload_id: `direct-${weekStart}`,
      pay_month: weekStart.slice(0, 7),
      driver_id: driverId,
      rider_name: String(row.name || row.driverName || '').trim(),
      employee_no: '',
      department: platform === 'coupang' ? '쿠팡(직계약)' : '배민(직계약)',
      base_pay: 0,
      allowance: 0,
      gross_pay: grossPay,
      income_tax: num(row.withholdingTax) + num(row.promotionWithholdingTax),
      local_tax: 0,
      insurance: num(row.employmentInsurance) + num(row.accidentInsurance) + num(row.hourlyInsurance),
      other_deduction: 0,
      total_deduction: deductTotal,
      net_pay: netPay,
      memo: '직계약 정산결과 반영',
      raw_data: {
        source: 'direct',
        platform,
        settlementId,
        settlementWeekStart: weekStart,
        settlementWeekEnd: weekEnd,
        baeminId,
        coupangId,
        callCount: num(row.callCount),
        payslip
      },
      rider_published_at: now,
      updated_at: now,
      created_at: now
    });
  });

  if (!records.length) {
    return { ok: false, status: 400, error: '매칭된 기사가 없어 반영할 수 없습니다.' };
  }

  // 청크 업서트
  const chunkSize = 200;
  let published = 0;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const { error } = await supabase.from('payroll_slip_lines').upsert(chunk, { onConflict: 'id' });
    if (error) {
      return { ok: false, status: 500, error: error.message || '급여명세서 반영에 실패했습니다.' };
    }
    published += chunk.length;
  }

  return {
    ok: true,
    weekStart,
    weekEnd,
    published,
    message: `급여명세서 반영 완료 · ${published}건 (기사앱 주급명세서에 노출)`
  };
}

module.exports = { publishDirectSettlementPayslips };

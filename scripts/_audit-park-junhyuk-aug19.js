#!/usr/bin/env node
/**
 * 박준혁 2026-08-19 주 정산 vs 선정산 검수 (읽기 전용)
 */
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try { require('dotenv').config({ path: envPath }); return; } catch (_) {}
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const WEEK = '2026-08-19';
const WEEK_END = '2026-08-25';
const NAME = '박준혁';
const money = n => `${Math.round(Number(n || 0)).toLocaleString('ko-KR')}원`;
const digits = s => String(s || '').replace(/[^0-9]/g, '');
const norm = s => String(s || '').replace(/\s+/g, '');

function weekStart(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchAll(table, columns, build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns).range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function fetchSetting(key) {
  const { data, error } = await supabase.from('settings').select('value,updated_at').eq('key', key).maybeSingle();
  if (error) throw new Error(`settings ${key}: ${error.message}`);
  let value = data?.value ?? null;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) {}
  }
  return { value, updatedAt: data?.updated_at || null };
}

function coupangOf(r) {
  const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
  const custom = String(raw.coupangId || raw.coupangLoginKey || '').replace(/\s/g, '');
  if (custom) return custom;
  const name = String(r.name || '').replace(/\s/g, '');
  const phone4 = digits(r.phone).slice(-4);
  return name && phone4.length === 4 ? `${name}${phone4}` : '';
}

(async () => {
  const report = {};
  console.log('='.repeat(88));
  console.log(` 박준혁 정산주 ${WEEK}(수) ~ ${WEEK_END}(화) 선정산 대조 (읽기 전용)`);
  console.log('='.repeat(88));

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,platform_coupang,platform_baemin,join_date,created_at,updated_at,raw_data',
    q => q.ilike('name', `%${NAME}%`));
  const living = (riders || []).filter(r => norm(r.name) === NAME);
  report.riders = living.map(r => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    status: r.status,
    baeminId: r.baemin_id || '',
    coupangKey: coupangOf(r),
    joinDate: r.join_date,
    createdAt: r.created_at,
    raw: r.raw_data
  }));
  console.log(`\n[1] 등록 기사 ${living.length}명`);
  living.forEach((r, i) => {
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    console.log(`  (${i + 1}) ${r.name} ${r.phone} ${r.status}`);
    console.log(`      id=${r.id}`);
    console.log(`      쿠팡키=${coupangOf(r)} 배민=${r.baemin_id || '-'} 입사=${r.join_date || '-'} 등록=${String(r.created_at || '').slice(0, 19)}`);
    console.log(`      계좌=${raw.bankName || '-'} ${raw.accountNumber || '-'} 예금주=${raw.accountHolder || '-'}`);
    console.log(`      쿠팡여부=${r.platform_coupang} 배민여부=${r.platform_baemin}`);
  });
  const ids = living.map(r => r.id);
  const idSet = new Set(ids);

  const mapRow = await fetchSetting('brem_admin_manual_name_mappings');
  const mappings = (Array.isArray(mapRow.value) ? mapRow.value : [])
    .filter(m => {
      const src = norm(m.originalName || m.sourceName || m.key || '');
      const dst = norm(m.riderName || m.targetName || m.name || '');
      return src.includes(NAME) || dst.includes(NAME) || src.includes('4453') || src.includes('8013');
    });
  console.log(`\n[2] 수동 매핑 ${mappings.length}건`);
  mappings.forEach(m => console.log('  ', JSON.stringify(m)));
  report.mappings = mappings;

  const feesRow = await fetchSetting('brem_payroll_daily_settlement_fees_v1');
  const fees = feesRow.value || {};
  const callFeeCoupang = Math.round(Number(fees.coupang?.callFee || fees.callFee || 0));
  const callFeeBaemin = Math.round(Number(fees.baemin?.callFee || 0));
  console.log(`\n[3] 콜수수료 쿠팡=${money(callFeeCoupang)} 배민=${money(callFeeBaemin)}`);
  report.fees = { callFeeCoupang, callFeeBaemin, fees };

  const daily = await fetchAll(
    'daily_settlements',
    'driver_id,period,platform,order_count,delivery_amount,settlement_amount,applied_at',
    q => q.in('driver_id', ids).gte('period', WEEK).lte('period', WEEK_END)
  );
  console.log(`\n[4] 일정산 ${daily.length}건 (기사별)`);
  living.forEach(r => {
    const rows = daily.filter(d => d.driver_id === r.id).sort((a, b) => String(a.period).localeCompare(String(b.period)));
    const totCall = rows.reduce((s, x) => s + Number(x.order_count || 0), 0);
    const totAmt = rows.reduce((s, x) => s + Number(x.settlement_amount || 0), 0);
    console.log(`  ${r.phone} ${rows.length}건 콜=${totCall} 금액=${money(totAmt)}`);
    rows.forEach(d => {
      console.log(`    ${String(d.period).slice(0, 10)} ${(d.platform || '-').padEnd(8)} 콜=${String(d.order_count).padStart(4)} 정산=${money(d.settlement_amount)} 배달비=${money(d.delivery_amount)}`);
    });
  });
  report.daily = daily;

  const calls = await fetchAll(
    'admin_calls',
    'driver_id,date,platform,count,created_at,updated_at',
    q => q.in('driver_id', ids).gte('date', WEEK).lte('date', WEEK_END)
  );
  console.log(`\n[5] 콜수기록 ${calls.length}건`);
  living.forEach(r => {
    const rows = calls.filter(c => c.driver_id === r.id);
    const byP = { coupang: 0, baemin: 0 };
    rows.forEach(c => { byP[c.platform] = (byP[c.platform] || 0) + Number(c.count || 0); });
    console.log(`  ${r.phone} 쿠팡=${byP.coupang} 배민=${byP.baemin}`);
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.platform).localeCompare(String(b.platform)))
      .forEach(c => console.log(`    ${String(c.date).slice(0, 10)} ${(c.platform || '-').padEnd(8)} ${c.count}`));
  });
  report.calls = calls;

  const wdRow = await fetchSetting('brem_payroll_withdrawal_requests_v1');
  const allWd = Array.isArray(wdRow.value) ? wdRow.value : (Array.isArray(wdRow.value?.requests) ? wdRow.value.requests : []);
  const wd = allWd.filter(x => {
    const name = norm(x.driverName || x.riderName || '');
    const key = norm(x.coupangId || x.coupangLoginKey || '');
    return idSet.has(String(x.driverId || '')) || name === NAME || key.includes(NAME) || key.includes('4453') || key.includes('8013');
  });
  console.log(`\n[6] 출금(이름/ID/쿠팡키 매칭) ${wd.length}건 전체기간`);
  wd.sort((a, b) => String(a.weekStart || '').localeCompare(String(b.weekStart || '')) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  wd.forEach(x => {
    const mine = living.find(r => r.id === String(x.driverId || ''));
    console.log(`  ${String(x.weekStart || '').slice(0, 10)} ${(x.platform || '-').padEnd(8)} ${String(x.status || '-').padEnd(12)} ${money(x.amount)} fee=${money(x.feeAmount || x.fee)}`);
    console.log(`    신청 ${String(x.createdAt || '').slice(0, 19)} driver=${String(x.driverId || '').slice(0, 8)} 이름=${x.driverName || '-'} 전화=${x.phone || x.driverPhone || '-'} 쿠팡=${x.coupangId || x.coupangLoginKey || '-'}`);
    console.log(`    한도=${x.availableAtRequest == null ? '-' : money(x.availableAtRequest)} 매칭기사=${mine ? mine.phone : 'ID불일치'}`);
  });
  const weekWd = wd.filter(x => String(x.weekStart || '').slice(0, 10) === WEEK);
  report.withdrawals = wd;
  report.weekWithdrawals = weekWd;

  const adjRow = await fetchSetting('brem_admin_direct_settlement_adjustments_v1');
  const adj = adjRow.value || {};

  const directRow = await fetchSetting('brem_admin_weekly_settlements_direct');
  const directList = Array.isArray(directRow.value) ? directRow.value : [];
  const weekDirect = directList.filter(w => weekStart(w.startDate || w.start_date) === WEEK);
  console.log(`\n[7] 직계약 주정산서 ${WEEK} 주차 ${weekDirect.length}건`);
  const directHits = [];
  weekDirect.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    const hits = list.filter(item => {
      const id = String(item.matchedRiderId || item.driverId || '');
      const erp = norm(item.coupangLoginKey || item.originalName || item.baeminUserId || '');
      const name = norm(item.driverName || item.riderName || item.originalName || '');
      return idSet.has(id) || name === NAME || erp.includes(NAME) || erp.includes('4453') || erp.includes('8013') || erp.toLowerCase().includes('qkrwnsgurok');
    });
    console.log(`  ${row.platform} ${row.region || '-'} ${row.fileName || row.file_name || '-'} riders=${list.length} 박준혁히트=${hits.length} start=${row.startDate}`);
    hits.forEach(item => {
      const a = item.amounts || {};
      const rec = {
        start: String(row.startDate || '').slice(0, 10),
        platform: row.platform,
        file: row.fileName || row.file_name,
        region: row.region,
        settlementId: row.id,
        matched: String(item.matchedRiderId || ''),
        originalName: item.originalName,
        coupangLoginKey: item.coupangLoginKey,
        baeminUserId: item.baeminUserId,
        weeklyOrderCount: Number(item.weeklyOrderCount || 0),
        systemCallCount: Number(item.systemCallCount || 0),
        amounts: a
      };
      directHits.push(rec);
      const callFee = rec.weeklyOrderCount * (rec.platform === 'baemin' ? callFeeBaemin : callFeeCoupang);
      const other = Number(adj.other?.[row.id]?.[rec.matched]?.amount || 0);
      const promo = Number(adj.promotion?.[row.id]?.[rec.matched]?.amount || 0);
      const promoTax = Math.floor((promo + other) * 0.033);
      const deliveryFee = Number(a.deliveryFee || 0);
      const missionPay = Number(a.missionPay || 0);
      const deductionDetail = Number(a.deductionDetail || 0);
      const emp = Number(a.employmentInsurance || 0);
      const acc = Number(a.accidentInsurance || 0);
      const hourly = Number(a.hourlyInsurance || 0);
      const tax = Number(a.withholdingTax || 0);
      const gross = deliveryFee + missionPay + other + promo;
      const baseDeduct = deductionDetail + emp + acc + hourly + tax + promoTax + callFee;
      const capacity = Math.max(0, gross - baseDeduct);
      console.log(`    원본=${item.originalName || '-'} 쿠팡키=${item.coupangLoginKey || '-'} 배민=${item.baeminUserId || '-'} 매칭=${rec.matched || '-'}`);
      console.log(`    주간콜=${rec.weeklyOrderCount} 시스템콜=${rec.systemCallCount} 일치=${item.callCountMatched}`);
      console.log(`    배달비 ${money(deliveryFee)} 추가지급 ${money(missionPay)} 시트지급 ${money(a.sheetPayout)} useZ=${a.useSheetPayout === true}`);
      console.log(`    차감 ${money(deductionDetail)} 고용 ${money(emp)} 산재 ${money(acc)} 시간제 ${money(hourly)} 원천세 ${money(tax)}`);
      console.log(`    콜수수료 ${rec.weeklyOrderCount}×${money(rec.platform === 'baemin' ? callFeeBaemin : callFeeCoupang)}=${money(callFee)}`);
      console.log(`    기타 ${money(other)} 프로모션 ${money(promo)} 프로모션원천 ${money(promoTax)}`);
      console.log(`    지급합계 ${money(gross)} 기본공제 ${money(baseDeduct)} 잔액(선정산 전) ${money(capacity)}`);
      rec.computed = { deliveryFee, missionPay, other, promo, promoTax, callFee, gross, baseDeduct, capacity, deductionDetail, emp, acc, hourly, tax };
    });
  });
  report.directHits = directHits;

  const weeklyBro = await fetchAll('weekly_settlements', 'id,platform,region,start_date,end_date,file_name,riders');
  const weekBro = weeklyBro.filter(w => weekStart(w.start_date) === WEEK);
  console.log(`\n[8] 브로커 주정산서 ${WEEK} 주차 ${weekBro.length}건`);
  const broHits = [];
  weekBro.forEach(row => {
    const list = Array.isArray(row.riders) ? row.riders : [];
    const hits = list.filter(item => {
      const id = String(item.matchedRiderId || item.driverId || '');
      const erp = norm(item.coupangLoginKey || item.originalName || item.baeminUserId || '');
      const name = norm(item.driverName || item.riderName || item.originalName || '');
      return idSet.has(id) || name === NAME || erp.includes(NAME) || erp.includes('4453') || erp.includes('8013') || erp.toLowerCase().includes('qkrwnsgurok');
    });
    if (!hits.length) return;
    console.log(`  ${row.platform} ${row.region || '-'} ${row.file_name || '-'} start=${row.start_date}`);
    hits.forEach(item => {
      const a = item.amounts || item;
      broHits.push({
        platform: row.platform,
        region: row.region,
        file: row.file_name,
        start: row.start_date,
        matched: item.matchedRiderId,
        originalName: item.originalName,
        baeminUserId: item.baeminUserId,
        coupangLoginKey: item.coupangLoginKey,
        weeklyOrderCount: item.weeklyOrderCount,
        systemCallCount: item.systemCallCount,
        amounts: item.amounts || null
      });
      console.log(`    원본=${item.originalName || '-'} 배민=${item.baeminUserId || '-'} 쿠팡=${item.coupangLoginKey || '-'} 매칭=${item.matchedRiderId || '-'}`);
      console.log(`    주간콜=${item.weeklyOrderCount} 시스템콜=${item.systemCallCount}`);
      if (item.amounts) console.log(`    amounts ${JSON.stringify(item.amounts)}`);
    });
  });
  report.broHits = broHits;

  const slips = await fetchAll(
    'payroll_slip_lines',
    'id,driver_id,rider_name,pay_month,gross_pay,net_pay,total_deduction,raw_data,created_at,updated_at',
    q => q.in('driver_id', ids)
  );
  const weekSlips = slips.filter(l => weekStart(String(l.raw_data?.settlementWeekStart || l.raw_data?.payslip?.settlementWeekStart || '').slice(0, 10)) === WEEK);
  console.log(`\n[9] 급여명세서 ${WEEK} ${weekSlips.length}건`);
  weekSlips.forEach(l => {
    const raw = l.raw_data || {};
    const ps = raw.payslip || raw;
    console.log(`  driver=${l.driver_id} 이름=${l.rider_name || raw.riderName || '-'} 플랫폼=${raw.platform || ps.platform || '-'}`);
    console.log(`    지급 ${money(l.gross_pay)} 공제 ${money(l.total_deduction)} 실지급 ${money(l.net_pay)} 생성=${String(l.created_at).slice(0, 19)}`);
    console.log(`    prepaid=${money(ps.prepaid || raw.prepaid)} dailyFee=${money(ps.dailySettlementFee || raw.dailySettlementFee)} callFee=${money(ps.callFee || raw.callFee)}`);
    console.log(`    lease=${money(ps.leaseFee || raw.leaseFee)} loan=${money(ps.loanFee || raw.loanFee)}`);
    console.log(`    원천=${money(ps.withholdingTax || raw.withholdingTax)} 고용=${money(ps.employmentInsurance || raw.employmentInsurance)} 산재=${money(ps.accidentInsurance || raw.accidentInsurance)}`);
    const keys = Object.keys(raw);
    console.log(`    raw keys: ${keys.join(', ')}`);
    console.log(`    raw dump: ${JSON.stringify(raw).slice(0, 1800)}`);
  });
  report.weekSlips = weekSlips;

  const unmatchedRow = await fetchSetting('brem_settlement_unmatched');
  let unmatched = unmatchedRow.value;
  if (unmatched && !Array.isArray(unmatched) && Array.isArray(unmatched.rows)) unmatched = unmatched.rows;
  const um = (Array.isArray(unmatched) ? unmatched : []).filter(r => {
    const name = norm(r.name || r.raw_name || r.originalName || '');
    const key = norm(r.coupang_login_key || r.coupangLoginKey || r.baemin_user_id || r.baeminUserId || '');
    const wk = weekStart(r.period || r.week_start || r.weekStart);
    return (name === NAME || key.includes(NAME) || key.includes('4453') || key.includes('8013') || key.toLowerCase().includes('qkrwnsgurok'))
      && (!wk || wk === WEEK);
  });
  console.log(`\n[10] 미매칭 ${WEEK} ${um.length}건`);
  um.forEach(r => console.log('  ', JSON.stringify(r).slice(0, 400)));
  report.unmatched = um;

  const finalizedRow = await fetchSetting('brem_admin_finalized_weeks');
  const finalized = Array.isArray(finalizedRow.value) ? finalizedRow.value : [];
  const weekFinal = finalized.some(item => String(item?.weekStart || item || '').slice(0, 10) === WEEK);
  console.log(`\n[11] 주차 마감 ${WEEK} = ${weekFinal ? '마감됨' : '미마감'}`);
  report.finalized = weekFinal;

  // 선정산 vs 정산 잔액
  console.log('\n[12] 8/19주 선정산 vs 정산 잔액');
  const done = weekWd.filter(r => String(r.status) === 'completed');
  const prepaid = done.reduce((s, r) => s + Math.round(Number(r.amount || 0)), 0);
  const fee = done.reduce((s, r) => s + Math.round(Number(r.feeAmount || r.fee || 0)), 0);
  let cap = 0;
  directHits.forEach(rec => {
    cap += rec.computed?.capacity || 0;
  });
  const net = cap - prepaid - fee;
  console.log(`  직계약 잔액(선정산 전) ${money(cap)}`);
  console.log(`  처리완료 출금 ${done.length}건 원금 ${money(prepaid)} + 수수료 ${money(fee)} = ${money(prepaid + fee)}`);
  console.log(`  총지급 대략(잔액-선정산-수수료) ${money(net)}`);
  weekSlips.forEach(l => {
    console.log(`  급여줄 실지급 ${money(l.net_pay)}  vs  계산 ${money(net)}  차이 ${money(Number(l.net_pay) - net)}`);
  });
  report.reconcile = { capacity: cap, prepaid, fee, prepaidWithFee: prepaid + fee, computedNet: net };

  const out = path.join(__dirname, '..', 'logs', 'audit-park-junhyuk-aug19.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n상세: ${out}`);
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

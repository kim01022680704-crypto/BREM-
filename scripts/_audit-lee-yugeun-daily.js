#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
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
const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const ID = 'b467aa1f-d46d-4e3e-a698-0d8f6e75b455';

function hit(rec) {
  const j = JSON.stringify(rec || '');
  return j.includes(ID) || j.includes('이유근');
}

(async () => {
  const { data: rider } = await sb.from('riders').select('id,name,phone,baemin_id,status,raw_data').eq('id', ID).maybeSingle();
  console.log('RIDER', JSON.stringify({
    name: rider?.name, phone: rider?.phone, status: rider?.status, baemin: rider?.baemin_id,
    raw: rider?.raw_data
  }));

  const { data: daily } = await sb.from('daily_settlements')
    .select('*')
    .eq('driver_id', ID)
    .gte('period', '2026-09-01')
    .order('period');
  console.log('\n=== DAILY ===');
  (daily || []).forEach(r => console.log(JSON.stringify({
    period: r.period, platform: r.platform, calls: r.order_count,
    settle: r.settlement_amount, delivery: r.delivery_amount,
    ac: r.deduction_base, fee: r.call_fee, unit: r.call_fee_unit, hourly: r.hourly_insurance
  })));

  console.log('\n=== LOGS 9/1-9/8 동구/이유근 ===');
  const { data: logs } = await sb.from('settlement_upload_logs')
    .select('id,kind,platform,file_name,period,region,status,call_fee_unit,matched_count,unmatched_count,applied_records,matched_records,unmatched_records,total_order_count,total_delivery_amount')
    .eq('kind', 'daily')
    .gte('period', '2026-09-01')
    .lte('period', '2026-09-08')
    .order('period');
  (logs || []).forEach(log => {
    const file = String(log.file_name || '');
    const recs = [...(log.applied_records || []), ...(log.matched_records || []), ...(log.unmatched_records || [])];
    const mine = recs.filter(hit);
    if (!mine.length && !/동구/.test(file)) return;
    if (!mine.length && /동구/.test(file)) {
      console.log(log.period, log.platform, log.status, file, 'callFeeUnit', log.call_fee_unit, 'matched', log.matched_count, 'unmatched', log.unmatched_count, '이유근없음');
      return;
    }
    mine.forEach(r => console.log(JSON.stringify({
      period: log.period, file, status: log.status, bucket: log.applied_records?.some(x => hit(x)) ? 'applied' : (log.unmatched_records?.some(x => hit(x)) ? 'unmatched' : 'matched'),
      name: r.driverName || r.name || r.rawName,
      driverId: r.driverId,
      calls: r.orderCount,
      settle: r.settlementAmount ?? r.deliveryAmount,
      hourly: r.hourlyInsurance,
      deductionBase: r.deductionBase,
      unit: r.callFeeUnit ?? log.call_fee_unit
    })));
  });

  console.log('\n=== CRAWL 9/2, 9/7 ===');
  for (const day of ['2026-09-02', '2026-09-07', '2026-09-08']) {
    const { data: cg } = await sb.from('coupang_collect_items')
      .select('collect_date,rider_name,phone_number,source_menu,parsed_json')
      .eq('collect_date', day)
      .or('rider_name.ilike.%이유근%,phone_number.eq.01056859662,match_key.ilike.%이유근%');
    console.log(day, 'rows', (cg || []).length);
    (cg || []).forEach(r => {
      const p = r.parsed_json || {};
      console.log(' ', r.source_menu, r.rider_name, p.completeCount, p.lunchPeak, p.dinnerPeak, p.nonPeak, p.vendorName || p.vendor_name);
    });
  }

  console.log('\n=== BAEMIN daily any ===');
  const { data: b } = await sb.from('daily_settlements').select('period,order_count,settlement_amount').eq('driver_id', ID).eq('platform', 'baemin');
  console.log('baemin rows', (b || []).length);

  const { data: row } = await sb.from('daily_settlements').select('*').eq('id', ID + '-2026-09-07-coupang').maybeSingle();
  console.log('\n=== 9/7 ROW KEYS ===');
  console.log(JSON.stringify({
    id: row?.id,
    settlement: row?.settlement_amount,
    delivery: row?.delivery_amount,
    ac: row?.deduction_base,
    calls: row?.order_count,
    applied: row?.applied_at,
    source: row?.source_file || row?.file_name || row?.raw_data,
  }));

  const { data: logs2 } = await sb.from('settlement_upload_logs')
    .select('id,kind,platform,file_name,period,region,status,call_fee_unit,matched_count,unmatched_count,total_order_count,applied_at')
    .eq('kind', 'daily')
    .eq('period', '2026-09-07')
    .order('applied_at');
  (logs2 || []).forEach(l => console.log('LOG 9/7', JSON.stringify(l)));

  const { data: allDaily } = await sb.from('daily_settlements')
    .select('period,order_count,settlement_amount,deduction_base,call_fee,call_fee_unit')
    .eq('driver_id', ID)
    .eq('platform', 'coupang')
    .gte('period', '2026-08-19')
    .lte('period', '2026-09-08')
    .order('period');
  console.log('\n=== ALL DAYS ===');
  (allDaily || []).forEach(r => console.log(r.period, r.order_count, r.settlement_amount, r.deduction_base, r.call_fee, r.call_fee_unit));
})().catch(e => { console.error(e); process.exit(1); });

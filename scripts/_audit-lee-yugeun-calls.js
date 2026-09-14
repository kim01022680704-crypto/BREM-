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

function pick(p) {
  if (!p || typeof p !== 'object') return p;
  const keys = [
    'completeCount', 'totalComplete', 'complete', 'cancelCount', 'cancel',
    'lunchPeak', 'dinnerPeak', 'nonPeak', 'orderCount', 'deliveryCount',
    'vendorName', 'vendor_name', 'collectedAt', 'workDate',
    'deliveryAmount', 'settlementAmount', 'payAmount'
  ];
  const out = {};
  for (const k of keys) if (p[k] != null && p[k] !== '') out[k] = p[k];
  return out;
}

(async () => {
  const { data: daily } = await sb.from('daily_settlements')
    .select('period,order_count,settlement_amount,delivery_amount,deduction_base,applied_at,raw_data,source')
    .eq('driver_id', ID)
    .eq('platform', 'coupang')
    .gte('period', '2026-09-01')
    .lte('period', '2026-09-09')
    .order('period');
  console.log('=== DAILY SETTLEMENT ===');
  (daily || []).forEach(r => console.log(JSON.stringify({
    period: r.period, calls: r.order_count, settle: r.settlement_amount,
    delivery: r.delivery_amount, ac: r.deduction_base, applied: r.applied_at,
    source: r.source, rawKeys: r.raw_data ? Object.keys(r.raw_data) : []
  })));

  console.log('\n=== CRAWL ITEMS ===');
  const { data: items, error } = await sb.from('coupang_collect_items')
    .select('collect_date,rider_name,phone_number,source_menu,collected_at,match_key,parsed_json,created_at,updated_at')
    .gte('collect_date', '2026-09-01')
    .lte('collect_date', '2026-09-09')
    .or('rider_name.ilike.%이유근%,phone_number.eq.01056859662,phone_number.eq.010-5685-9662,match_key.ilike.%이유근%')
    .order('collect_date');
  if (error) console.log('crawl err', error);
  (items || []).forEach(r => {
    console.log(JSON.stringify({
      date: r.collect_date,
      menu: r.source_menu,
      name: r.rider_name,
      phone: r.phone_number,
      collected_at: r.collected_at,
      created: r.created_at,
      parsed: pick(r.parsed_json)
    }));
  });

  console.log('\n=== CRAWL COLUMNS SAMPLE ===');
  if (items && items[0]) {
    const { data: one } = await sb.from('coupang_collect_items').select('*').eq('collect_date', items[0].collect_date).eq('rider_name', items[0].rider_name).limit(1).maybeSingle();
    console.log('keys', Object.keys(one || {}));
  }

  console.log('\n=== 9/7-9/8 FULL PARSED ===');
  for (const day of ['2026-09-07', '2026-09-08']) {
    const rows = (items || []).filter(r => r.collect_date === day);
    rows.forEach(r => console.log(day, JSON.stringify(r.parsed_json, null, 0).slice(0, 2500)));
  }

  console.log('\n=== UPLOAD LOG HITS ===');
  const { data: logs, error: le } = await sb.from('settlement_upload_logs')
    .select('id,kind,platform,file_name,period,region,status,call_fee_unit,matched_count,unmatched_count,total_order_count,applied_at,created_at')
    .eq('kind', 'daily')
    .in('period', ['2026-09-07', '2026-09-08']);
  if (le) console.log('log err', le);
  console.log('logs', (logs || []).length);
  (logs || []).forEach(l => console.log(JSON.stringify(l)));
})().catch(e => { console.error(e); process.exit(1); });

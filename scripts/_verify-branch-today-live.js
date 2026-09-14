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
const { __test } = require('../server/rider-region-dashboard');
const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

(async () => {
  const { data: pr } = await sb.from('coupang_collect_items')
    .select('vendor_id,vendor_name,parsed_json')
    .eq('source_menu', 'peak_realtime')
    .eq('collect_date', '2026-09-09')
    .eq('parsed_json->>peakType', 'DINNER')
    .gt('parsed_json->>completedCount', '0')
    .limit(1);
  const vendor = pr?.[0];
  console.log('coupang vendor', vendor?.vendor_name, vendor?.vendor_id, 'dinner live', vendor?.parsed_json?.completedCount);
  if (vendor) {
    const weekly = await __test.buildBranchWeeklyProgress(sb, {
      platform: 'coupang',
      vendorId: vendor.vendor_id,
      label: vendor.vendor_name,
      vendorName: vendor.vendor_name,
      key: vendor.vendor_id
    }, '2026-09-09', '2026-09-15');
    const today = (weekly.days || []).find(d => d.date === '2026-09-09');
    console.log('coupang today live?', today?.live, 'dinner', today?.slots?.find(s => s.key === 'DINNER'), 'day completed', today?.completed);
  }

  const { data: ds } = await sb.from('baemin_biz_collect_items')
    .select('dedupe_key,parsed_json')
    .eq('source_menu', 'delivery_status')
    .eq('collect_date', '2026-09-09')
    .limit(1);
  const dp = String(ds?.[0]?.dedupe_key || '').split(':')[0];
  console.log('baemin dp', dp, 'evening sample', ds?.[0]?.parsed_json?.eveningCount);
  if (/^DP\d+/.test(dp)) {
    const weekly = await __test.buildBranchWeeklyProgress(sb, {
      platform: 'baemin',
      partnerId: dp,
      key: dp,
      label: dp
    }, '2026-09-09', '2026-09-15');
    const today = (weekly.days || []).find(d => d.date === '2026-09-09');
    console.log('baemin today live?', today?.live, today?.slots?.map(s => `${s.label}:${s.completed}/${s.goal}`).join(' · '));
  }
})().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/** 최찬희0561 콜수 불일치 조사 */
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
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const NEEDLE = process.argv[2] || '최찬희0561';
const WEEK = process.argv[3] || '2026-08-19';

async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}

function matchNeedle(obj) {
  const j = JSON.stringify(obj || '');
  return j.includes(NEEDLE) || j.includes('최찬희') && j.includes('0561');
}

(async () => {
  console.log('=== ERP riders (최찬희 / 0561) ===');
  const { data: riders } = await sb.from('riders')
    .select('id,name,baemin_id,coupang_id,phone,status,raw_data')
    .or('name.ilike.%최찬희%,baemin_id.ilike.%0561%,baemin_id.ilike.%chanhee%');
  for (const r of riders || []) {
    console.log(JSON.stringify({
      id: r.id, name: r.name, baemin_id: r.baemin_id,
      coupang_id: r.coupang_id, phone: r.phone, status: r.status
    }));
  }

  console.log('\n=== direct settlements week', WEEK, '===');
  const direct = await readSetting('brem_admin_weekly_settlements_direct');
  const list = Array.isArray(direct) ? direct : [];
  const weekList = list.filter(s => String(s.startDate || '').slice(0, 10) === WEEK);
  const hits = [];
  for (const s of weekList) {
    for (const r of s.riders || []) {
      if (!matchNeedle(r)) continue;
      hits.push({
        settlementId: s.id,
        startDate: s.startDate,
        platform: s.platform,
        region: s.region,
        fileName: s.fileName || s.sourceFileName,
        riderName: r.riderName,
        driverName: r.driverName,
        originalName: r.originalName,
        baeminUserId: r.baeminUserId,
        coupangLoginKey: r.coupangLoginKey,
        matchedRiderId: r.matchedRiderId,
        weeklyOrderCount: r.weeklyOrderCount,
        systemCallCount: r.systemCallCount,
        excelCallCount: r.excelCallCount,
        callCount: r.callCount,
        amounts: r.amounts
      });
    }
  }
  console.log('hits:', hits.length);
  hits.forEach(h => console.log(JSON.stringify(h, null, 2)));

  console.log('\n=== bro settlements week', WEEK, '===');
  const bro = await readSetting('brem_admin_weekly_settlements');
  const broList = Array.isArray(bro) ? bro : [];
  const broWeek = broList.filter(s => String(s.startDate || '').slice(0, 10) === WEEK);
  for (const s of broWeek) {
    for (const r of s.riders || []) {
      if (!matchNeedle(r)) continue;
      console.log(JSON.stringify({
        platform: s.platform, region: s.region,
        riderName: r.riderName, baeminUserId: r.baeminUserId,
        weeklyOrderCount: r.weeklyOrderCount, systemCallCount: r.systemCallCount,
        matchedRiderId: r.matchedRiderId
      }, null, 2));
    }
  }

  console.log('\n=== manual mappings ===');
  const mappings = await readSetting('brem_admin_manual_name_mappings');
  for (const m of Array.isArray(mappings) ? mappings : []) {
    if (matchNeedle(m)) console.log(JSON.stringify(m));
  }

  console.log('\n=== calls table (week around', WEEK, ') ===');
  const riderIds = (riders || []).map(r => r.id);
  if (riderIds.length) {
    const weekEnd = '2026-08-25';
    const { data: calls } = await sb.from('calls')
      .select('driver_id,platform,date,order_count')
      .in('driver_id', riderIds)
      .gte('date', WEEK)
      .lte('date', weekEnd);
    const byDriver = {};
    (calls || []).forEach(c => {
      const k = `${c.driver_id}:${c.platform}`;
      byDriver[k] = (byDriver[k] || 0) + Number(c.order_count || 0);
    });
    console.log('system calls sum:', byDriver);
    console.log('call rows:', (calls || []).length);
  }

  console.log('\n=== promotion apply results ===');
  const promo = await readSetting('brem_admin_promotion_apply_results');
  const promoList = Array.isArray(promo) ? promo : (promo?.records || []);
  for (const batch of promoList) {
    if (String(batch.weekStart || batch.week || '').slice(0, 10) !== WEEK) continue;
    for (const row of batch.results || batch.rows || []) {
      if (matchNeedle(row)) {
        console.log(JSON.stringify({
          channel: batch.channel,
          platform: row.platform,
          name: row.name || row.driverName,
          callCount: row.callCount,
          baeminId: row.baeminId || row.idLabel
        }));
      }
    }
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });

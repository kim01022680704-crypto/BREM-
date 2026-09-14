#!/usr/bin/env node
/** Fix wlslxlqlalzl manual mapping + wrong payslip lines */
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
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const BAEMIN_ID = 'wlslxlqlalzl';
const WRONG_DRIVER = '4806c5aa-c9ed-4228-8e1a-40f679a6a76f';
const RIGHT_DRIVER = 'b98e9f5b-92f8-4be2-ba21-63e6053c3ad8';

async function readSetting(key) {
  const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) {} }
  return v;
}

async function writeSetting(key, value) {
  const { error } = await sb.from('settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) throw error;
}

(async () => {
  const now = new Date().toISOString();
  const mappings = await readSetting('brem_admin_manual_name_mappings');
  const list = Array.isArray(mappings) ? [...mappings] : [];
  const before = list.length;
  const filtered = list.filter(m => !(
    String(m.platform || '').toLowerCase() === 'baemin'
    && String(m.originalName || '').trim().toLowerCase() === BAEMIN_ID.toLowerCase()
    && String(m.driverId || '') === WRONG_DRIVER
  ));
  filtered.unshift({
    id: 'fix-park-hyungjin-baemin-id',
    platform: 'baemin',
    originalName: BAEMIN_ID,
    driverId: RIGHT_DRIVER,
    driverName: '박형진',
    updatedAt: now
  });
  await writeSetting('brem_admin_manual_name_mappings', filtered);
  console.log(`manual mappings: ${before} → ${filtered.length} (wlslxlqlalzl → 박형진)`);

  const { data: wrongLines } = await sb.from('payroll_slip_lines')
    .select('id,driver_id,rider_name,raw_data')
    .eq('driver_id', WRONG_DRIVER);
  const toFix = (wrongLines || []).filter(row => {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    const payslip = raw.payslip && typeof raw.payslip === 'object' ? raw.payslip : {};
    const baeminId = String(payslip.baeminId || raw.baeminId || '').trim().toLowerCase();
    return baeminId === BAEMIN_ID.toLowerCase();
  });
  console.log('wrong payslip lines to remove/replace:', toFix.length);
  for (const row of toFix) {
    const settlementId = String(row.raw_data?.settlementId || '').trim();
    const newId = settlementId ? `direct-${settlementId}-${RIGHT_DRIVER}` : '';
    console.log('  delete', row.id, row.rider_name);
    await sb.from('payroll_slip_lines').delete().eq('id', row.id);
    if (newId && newId !== row.id) {
      const orphan = await sb.from('payroll_slip_lines').select('id').eq('id', newId).maybeSingle();
      if (orphan.data) console.log('  (correct line already exists:', newId, ')');
    }
  }

  const direct = await readSetting('brem_admin_weekly_settlements_direct');
  const hit = (Array.isArray(direct) ? direct : []).flatMap(s => (s.riders || []).filter(r => (
    String(r.baeminUserId || '').toLowerCase() === BAEMIN_ID.toLowerCase()
  )).map(r => ({ start: s.startDate, driverName: r.driverName, matched: r.matchedRiderId })));
  console.log('verify settlement rows:', JSON.stringify(hit, null, 2));
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});

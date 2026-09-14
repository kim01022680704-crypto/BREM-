#!/usr/bin/env node
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
const Q = process.argv[2] || 'wblxlqld';
(async () => {
  const { data: riders, error } = await sb.from('riders').select('id,name,baemin_id,phone,status,raw_data').or(`baemin_id.eq.${Q},name.ilike.%김영광%,name.ilike.%박형진%`);
  if (error) throw error;
  console.log('=== riders ===');
  for (const r of riders || []) {
    console.log(JSON.stringify({ id: r.id, name: r.name, baemin_id: r.baemin_id, phone: r.phone, status: r.status }, null, 0));
  }
  const { data: pays } = await sb.from('payroll_slip_lines').select('id,driver_id,rider_name,raw_data,updated_at').or(`raw_data->>baeminId.eq.${Q},raw_data->>matchedBaeminId.eq.${Q}`).limit(5);
  console.log('\n=== payroll lines (baemin id) ===');
  for (const p of pays || []) console.log(JSON.stringify({ id: p.id, driver_id: p.driver_id, rider_name: p.rider_name, baeminId: p.raw_data?.payslip?.baeminId || p.raw_data?.baeminId }, null, 0));
})().catch(e => { console.error(e.message || e); process.exit(1); });

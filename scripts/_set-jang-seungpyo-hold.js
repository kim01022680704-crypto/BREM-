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

const KEY = 'brem_payroll_daily_settlement_holds_v1';
const ID = 'fb4d9e09-7b6f-443f-a957-54fff938b2e4';
const WEEK = '2026-08-26';
const NEXT = 358336;

(async () => {
  const { data, error } = await sb.from('settings').select('value').eq('key', KEY).maybeSingle();
  if (error) throw error;
  let list = data?.value;
  if (typeof list === 'string') list = JSON.parse(list);
  if (!Array.isArray(list)) throw new Error('holds not array');
  const hit = list.find(item => String(item.driverId) === ID && String(item.weekStart || '').slice(0, 10) === WEEK);
  if (!hit) throw new Error('장승표 이번주 홀딩을 찾지 못했습니다.');
  const before = Number(hit.amount || 0);
  hit.amount = NEXT;
  hit.updatedAt = new Date().toISOString();
  const { error: writeError } = await sb.from('settings').upsert({
    key: KEY,
    value: list,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (writeError) throw writeError;
  const { data: after } = await sb.from('settings').select('value').eq('key', KEY).maybeSingle();
  let check = after?.value;
  if (typeof check === 'string') check = JSON.parse(check);
  const again = (check || []).find(item => String(item.driverId) === ID && String(item.weekStart || '').slice(0, 10) === WEEK);
  console.log(JSON.stringify({
    name: hit.driverName,
    weekStart: WEEK,
    before,
    after: Number(again?.amount || 0)
  }, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});

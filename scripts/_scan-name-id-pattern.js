#!/usr/bin/env node
/** 이름 끝에 4자리 숫자가 붙은 기사(윤다훈4558 형태) 스캔 — 읽기 전용 */
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

const dg = v => String(v || '').replace(/[^0-9]/g, '');

async function fetchAll(table, columns) {
  const size = 1000;
  const out = [];
  for (let f = 0; ; f += size) {
    const { data, error } = await supabase.from(table).select(columns).range(f, f + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

(async () => {
  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,created_at,raw_data');

  const matches = [];
  for (const r of riders) {
    const name = String(r.name || '').trim();
    const m = name.match(/^(.+?)(\d{4})$/);
    if (!m) continue;
    const tail = m[2];
    const phoneTail = dg(r.phone).slice(-4);
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    matches.push({
      id: r.id,
      name,
      baseName: m[1],
      tail,
      phone: r.phone || '',
      phoneTail,
      tailMatchesPhone: tail === phoneTail && phoneTail.length === 4,
      baeminId: String(r.baemin_id || raw.baeminId || raw.baemin_id || '').trim(),
      coupangId: String(raw.coupangId || raw.coupang_id || raw.riderId || '').trim(),
      status: r.status || '',
      created_at: String(r.created_at || '').slice(0, 10)
    });
  }

  matches.sort((a, b) => (b.tailMatchesPhone - a.tailMatchesPhone) || a.name.localeCompare(b.name, 'ko'));

  console.log(`=== 이름 끝 4자리 패턴 (${matches.length}명) ===\n`);
  for (const r of matches) {
    const flag = r.tailMatchesPhone ? 'O 전화뒤4일치' : 'X 전화뒤4불일치';
    console.log(`${r.name}\t${r.phone || '-'}\t뒤4=${r.phoneTail || '-'}\t${flag}\t배민=${r.baeminId || '-'}\t쿠팡=${r.coupangId || '-'}\t${r.status}\t${r.created_at}`);
  }

  const exact = matches.filter(r => r.tailMatchesPhone);
  console.log(`\n=== 윤다훈4558 형태 — 이름뒤4 = 전화뒤4 (${exact.length}명) ===`);
  for (const r of exact) {
    console.log(`  ${r.name}  ${r.phone}  ${r.status}  등록=${r.created_at}`);
  }

  const doubled = [];
  for (const r of riders) {
    const name = String(r.name || '').trim();
    const tail = dg(r.phone).slice(-4);
    if (tail.length !== 4) continue;
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    const baeminId = String(r.baemin_id || raw.baeminId || raw.baemin_id || '').trim();
    const coupangId = String(raw.coupangId || raw.coupang_id || raw.riderId || '').trim();
    if (baeminId.endsWith(tail + tail)) {
      doubled.push({ name, phone: r.phone, field: 'baemin_id', value: baeminId, status: r.status });
    }
    if (coupangId.endsWith(tail + tail)) {
      doubled.push({ name, phone: r.phone, field: 'coupang', value: coupangId, status: r.status });
    }
  }
  if (doubled.length) {
    console.log(`\n=== 배민/쿠팡 ID에 뒤4 두 번 붙은 패턴 (${doubled.length}건) ===`);
    for (const d of doubled) {
      console.log(`  ${d.name}  ${d.phone}  ${d.field}=${d.value}  ${d.status}`);
    }
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});

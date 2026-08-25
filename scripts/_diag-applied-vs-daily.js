#!/usr/bin/env node
/**
 * 반영됐다고 기록됐는데 일정산 행이 없는 건 전수 조사 (읽기 전용)
 *
 * settlement_upload_logs.applied_records 는 "이 사람 이 금액으로 반영했다"는 기록이다.
 * 그 기록과 daily_settlements 실제 행을 1:1로 맞춰서, 기록만 있고 행이 없는 건을 찾는다.
 *
 * 쓰기 없음.
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
    const eq = t.indexOf('='); if (eq < 0) continue;
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
async function fetchAll(table, columns, build) {
  const size = 300; const out = [];
  for (let f = 0; ; f += size) {
    let q = supabase.from(table).select(columns).range(f, f + size - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}
const FROM = process.argv[2] || '2026-08-12';
const TO = process.argv[3] || '2026-08-25';
const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

(async () => {
  console.log('='.repeat(92));
  console.log(` 반영 기록은 있는데 일정산 행이 없는 건 (${FROM} ~ ${TO}) — 읽기 전용`);
  console.log('='.repeat(92));

  const riders = await fetchAll('riders', 'id,name,status');
  const riderById = new Map(riders.map(r => [r.id, r]));

  const logs = await fetchAll('settlement_upload_logs',
    'id,kind,platform,file_name,period,status,matched_count,applied_records',
    q => q.eq('kind', 'daily').gte('period', FROM).lte('period', TO));

  const daily = await fetchAll('daily_settlements',
    'driver_id,period,platform,order_count,delivery_amount,settlement_amount',
    q => q.gte('period', FROM).lte('period', TO));
  const dailyKey = new Map();
  daily.forEach(d => {
    dailyKey.set(`${d.driver_id}|${String(d.period).slice(0, 10)}|${String(d.platform || '').toLowerCase()}`, d);
  });

  console.log(`\n일정산 업로드 로그 ${logs.length}건 · 일정산 행 ${daily.length}건\n`);

  const missing = [];
  const amountMismatch = [];
  let checked = 0;

  logs.forEach(l => {
    const period = String(l.period || '').slice(0, 10);
    const platform = String(l.platform || '').toLowerCase();
    const applied = Array.isArray(l.applied_records) ? l.applied_records : [];
    applied.forEach(rec => {
      const driverId = String(rec?.driverId || '').trim();
      const amount = Number(rec?.settlementAmount ?? rec?.deliveryAmount ?? 0);
      const orderCount = Number(rec?.orderCount || 0);
      if (!driverId || !period) return;
      checked += 1;
      const row = dailyKey.get(`${driverId}|${period}|${platform}`);
      if (!row) {
        missing.push({
          driverId, period, platform, amount, orderCount,
          name: rec?.driverName || rec?.name || '',
          file: l.file_name || '', status: l.status
        });
      } else if (Math.abs(Number(row.settlement_amount || 0) - amount) > 1) {
        amountMismatch.push({
          driverId, period, platform,
          expected: amount, actual: Number(row.settlement_amount || 0),
          name: rec?.driverName || rec?.name || '', file: l.file_name || ''
        });
      }
    });
  });

  console.log(`대조한 반영 기록 ${checked}건`);
  console.log(`  ★ 반영 기록은 있는데 일정산 행이 없음 : ${missing.length}건`);
  console.log(`  ★ 행은 있는데 금액이 다름             : ${amountMismatch.length}건`);

  if (missing.length) {
    const total = missing.reduce((a, m) => a + m.amount, 0);
    const calls = missing.reduce((a, m) => a + m.orderCount, 0);
    console.log(`\n  누락 합계: ${won(total)}원 · ${calls}콜 · ${new Set(missing.map(m => m.driverId)).size}명\n`);

    const byDriver = new Map();
    missing.forEach(m => {
      const cur = byDriver.get(m.driverId) || { name: m.name, days: [], amount: 0, calls: 0 };
      cur.days.push(m.period);
      cur.amount += m.amount;
      cur.calls += m.orderCount;
      byDriver.set(m.driverId, cur);
    });
    console.log('  [기사별]');
    [...byDriver.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .forEach(([id, v]) => {
        const r = riderById.get(id);
        console.log(`    "${v.name || r?.name || id}" ${r ? r.status : '← 기사 레코드 없음'}`
          + ` · ${v.days.length}일 · ${v.calls}콜 · ${won(v.amount)}원`);
        console.log(`        ${v.days.sort().join(', ')}`);
      });

    console.log('\n  [날짜별]');
    const byDate = new Map();
    missing.forEach(m => {
      const cur = byDate.get(m.period) || { n: 0, amount: 0 };
      cur.n += 1; cur.amount += m.amount;
      byDate.set(m.period, cur);
    });
    [...byDate.entries()].sort().forEach(([d, v]) =>
      console.log(`    ${d} · ${String(v.n).padStart(3)}건 · ${won(v.amount).padStart(10)}원`));

    console.log('\n  [파일별]');
    const byFile = new Map();
    missing.forEach(m => {
      const key = m.file.replace(/_\d{8}_\d{8}\.xlsx$/, '');
      const cur = byFile.get(key) || { n: 0, amount: 0 };
      cur.n += 1; cur.amount += m.amount;
      byFile.set(key, cur);
    });
    [...byFile.entries()].sort((a, b) => b[1].amount - a[1].amount).forEach(([f, v]) =>
      console.log(`    ${String(v.n).padStart(3)}건 ${won(v.amount).padStart(10)}원  ${f}`));
  }

  if (amountMismatch.length) {
    console.log('\n  [금액 불일치 — 최대 30건]');
    amountMismatch.slice(0, 30).forEach(m => console.log(
      `    ${m.period} ${m.platform.padEnd(7)} "${m.name}" 기록 ${won(m.expected)} / 실제 ${won(m.actual)}`));
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });

#!/usr/bin/env node
/** 누락된 반영 기록이 배열에서 몇 번째였나 (읽기 전용) */
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
const FROM = '2026-08-12';
const TO = '2026-08-25';
(async () => {
  const riders = await fetchAll('riders', 'id,name,created_at,status');
  const riderById = new Map(riders.map(r => [r.id, r]));

  const logs = await fetchAll('settlement_upload_logs',
    'id,platform,file_name,period,status,uploaded_at,applied_at,applied_records,matched_records',
    q => q.eq('kind', 'daily').gte('period', FROM).lte('period', TO));
  const daily = await fetchAll('daily_settlements', 'driver_id,period,platform',
    q => q.gte('period', FROM).lte('period', TO));
  const dailyKey = new Set(daily.map(d => `${d.driver_id}|${String(d.period).slice(0, 10)}|${String(d.platform || '').toLowerCase()}`));

  const TARGETS = new Set();
  logs.forEach(l => {
    const period = String(l.period || '').slice(0, 10);
    const platform = String(l.platform || '').toLowerCase();
    (Array.isArray(l.applied_records) ? l.applied_records : []).forEach(rec => {
      const id = String(rec?.driverId || '').trim();
      if (id && !dailyKey.has(`${id}|${period}|${platform}`)) TARGETS.add(id);
    });
  });

  console.log('[누락 기사 등록일]');
  [...TARGETS].forEach(id => {
    const r = riderById.get(id);
    console.log(`  "${r?.name || id}" 등록=${String(r?.created_at || '').slice(0, 10)} ${r?.status || ''} · id=${id}`);
  });

  console.log('\n[누락 건이 applied_records 배열에서 몇 번째였나]');
  logs
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .forEach(l => {
      const period = String(l.period || '').slice(0, 10);
      const platform = String(l.platform || '').toLowerCase();
      const applied = Array.isArray(l.applied_records) ? l.applied_records : [];
      const hits = [];
      applied.forEach((rec, idx) => {
        const id = String(rec?.driverId || '').trim();
        if (id && !dailyKey.has(`${id}|${period}|${platform}`)) {
          hits.push({ idx, name: rec?.driverName || rec?.name || id });
        }
      });
      if (!hits.length) return;
      console.log(`\n  ${period} ${l.file_name} [${l.status}]  총 ${applied.length}건`);
      console.log(`    업로드 ${String(l.uploaded_at || '').slice(0, 19)} · 반영 ${String(l.applied_at || '').slice(0, 19)}`);
      hits.forEach(h => console.log(`    → ${h.name}: ${h.idx + 1}번째 / ${applied.length}`
        + `${h.idx === applied.length - 1 ? '  ← 마지막' : ''}${h.idx === 0 ? '  ← 첫번째' : ''}`));
      console.log(`    이 파일 전체 순서: ${applied.map((r, i) =>
        `${i + 1}.${r?.driverName || r?.name || '?'}`).join(' ')}`);
    });

  console.log('\n[같은 날짜·같은 권역 파일이 여러 번 올라왔나 (중복/재업로드)]');
  const byKey = new Map();
  logs.forEach(l => {
    const region = (l.file_name || '').replace(/_\d{8}_\d{8}.*$/, '');
    const k = `${String(l.period).slice(0, 10)}|${region}`;
    byKey.set(k, [...(byKey.get(k) || []), l]);
  });
  [...byKey.entries()].filter(([, v]) => v.length > 1).sort().forEach(([k, v]) => {
    console.log(`  ${k} — ${v.length}회`);
    v.forEach(l => console.log(`      [${l.status}] 업로드 ${String(l.uploaded_at || '').slice(0, 19)}`
      + ` · 반영기록 ${(Array.isArray(l.applied_records) ? l.applied_records : []).length}건 · id=${l.id}`));
  });
})().catch(e => { console.error(e.message || e); process.exit(1); });

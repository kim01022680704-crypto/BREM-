#!/usr/bin/env node
/** 배민 콜수-일정산 누락이 고정 집단인지 확인 (읽기 전용) */
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
  const size = 1000; const out = [];
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
  const riders = await fetchAll('riders', 'id,name,status,raw_data');
  const riderById = new Map(riders.map(r => [r.id, r]));
  const calls = (await fetchAll('admin_calls', 'driver_id,date,platform,count',
    q => q.eq('platform', 'baemin').gte('date', FROM).lte('date', TO)))
    .filter(c => Number(c.count) > 0);
  const daily = await fetchAll('daily_settlements', 'driver_id,period,platform',
    q => q.eq('platform', 'baemin').gte('period', FROM).lte('period', TO));
  const dailyKey = new Set(daily.map(d => `${d.driver_id}|${String(d.period).slice(0, 10)}`));

  const per = new Map();
  calls.forEach(c => {
    const d = String(c.date).slice(0, 10);
    const cur = per.get(c.driver_id) || { days: 0, missing: 0 };
    cur.days += 1;
    if (!dailyKey.has(`${c.driver_id}|${d}`)) cur.missing += 1;
    per.set(c.driver_id, cur);
  });

  const always = [], never = [], mixed = [];
  per.forEach((v, id) => {
    if (v.missing === v.days) always.push({ id, ...v });
    else if (v.missing === 0) never.push({ id, ...v });
    else mixed.push({ id, ...v });
  });

  console.log(`배민 콜수 있는 기사 ${per.size}명 (${FROM} ~ ${TO})`);
  console.log(`  항상 일정산 없음   : ${always.length}명  ← 고정 집단이면 계약/소속 구분일 가능성`);
  console.log(`  항상 일정산 있음   : ${never.length}명`);
  console.log(`  섞여 있음(일부 날) : ${mixed.length}명  ←★ 이게 진짜 누락 후보`);

  const contractOf = r => {
    const raw = r?.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    return String(raw.contractType || raw.contract || raw.employmentType || raw.affiliation || raw.company || '').trim();
  };

  const tally = list => list.reduce((m, e) => {
    const r = riderById.get(e.id);
    const k = `${contractOf(r) || '(표기없음)'} / ${r?.status || '?'}`;
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  console.log('\n항상 없음 집단의 계약/상태 분포:', tally(always));
  console.log('항상 있음 집단의 계약/상태 분포:', tally(never));

  if (mixed.length) {
    console.log('\n★ 섞여 있는 기사 (일부 날만 일정산이 없음 = 실제 누락 의심)');
    mixed.sort((a, b) => b.missing - a.missing).slice(0, 40).forEach(e => {
      const r = riderById.get(e.id);
      console.log(`  "${r?.name || e.id}" ${r?.status || ''} · 콜있는날 ${e.days}일 중 ${e.missing}일 일정산 없음`);
    });
    if (mixed.length > 40) console.log(`  … 외 ${mixed.length - 40}명`);
  }

  console.log('\n항상 일정산 없는 기사 예시 (최대 15명)');
  always.slice(0, 15).forEach(e => {
    const r = riderById.get(e.id);
    console.log(`  "${r?.name || e.id}" ${r?.status || ''} · ${e.days}일 전부 없음 · 계약="${contractOf(r) || '(표기없음)'}"`);
  });
})().catch(e => { console.error(e.message || e); process.exit(1); });

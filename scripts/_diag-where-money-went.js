#!/usr/bin/env node
/** 누락된 금액이 다른 driver_id 로 들어갔는지 추적 (읽기 전용) */
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

const CASES = [
  { name: '박현우', date: '2026-08-12', amount: 94960, calls: 28 },
  { name: '박현우', date: '2026-08-14', amount: 83580, calls: 25 },
  { name: '박현우', date: '2026-08-15', amount: 80240, calls: 19 },
  { name: '박현우', date: '2026-08-18', amount: 6080, calls: 2 },
  { name: '남현민', date: '2026-08-13', amount: 63860, calls: 0 },
  { name: '남현민', date: '2026-08-14', amount: 0, calls: 0 },
  { name: '남현준', date: '2026-08-14', amount: 0, calls: 0 },
  { name: '남현준', date: '2026-08-15', amount: 0, calls: 0 }
];
const IDS = {
  '박현우': '7c29533a-ab30-46d6-a6d4-92e5d79f20fa',
  '남현민': '6765e7c9-de24-4cdb-8240-026d0f539791',
  '남현준': '33298d37-4c9a-4a51-9ddd-6b8d86a6d0c2'
};
const ORPHANS = [
  '13fc7047-e893-46be-b2c8-b7ecb81236db',
  '137097e9-9b29-4abf-9cdd-c4e0238dbb94',
  '5eb6ea26-1ce7-46fc-9a87-c90c25b8d653',
  '64f52b2b-e0c3-4857-a5a3-d2dd2fa02537'
];
const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

(async () => {
  console.log('[1] 세 기사의 모든 일정산 행 (플랫폼·날짜 제한 없음)');
  for (const [name, id] of Object.entries(IDS)) {
    const { data } = await supabase.from('daily_settlements')
      .select('id,period,platform,order_count,settlement_amount')
      .eq('driver_id', id).order('period');
    console.log(`\n  ${name} (${id.slice(0, 8)}…) — ${(data || []).length}건`);
    (data || []).forEach(d => console.log(`      ${String(d.period).slice(0, 10)} ${d.platform.padEnd(8)}`
      + ` 콜 ${String(d.order_count).padStart(3)} · ${won(d.settlement_amount).padStart(9)}원`));
  }

  console.log('\n[2] 누락 금액이 그날 다른 기사 행에 들어갔나 (금액 동일 검색)');
  for (const c of CASES.filter(x => x.amount > 0)) {
    const { data } = await supabase.from('daily_settlements')
      .select('driver_id,period,platform,order_count,settlement_amount')
      .eq('period', c.date).eq('settlement_amount', c.amount);
    console.log(`\n  ${c.name} ${c.date} ${won(c.amount)}원 → 같은 금액 행 ${(data || []).length}건`);
    for (const d of (data || [])) {
      const { data: r } = await supabase.from('riders').select('name,status').eq('id', d.driver_id).maybeSingle();
      console.log(`      driver_id=${d.driver_id.slice(0, 8)}… "${r?.name || '(기사없음)'}"`
        + ` 콜 ${d.order_count} ${d.platform}`);
    }
  }

  console.log('\n[3] 고아 driver_id 에 일정산 행이 있나');
  for (const id of ORPHANS) {
    const { data: ds } = await supabase.from('daily_settlements')
      .select('period,platform,order_count,settlement_amount').eq('driver_id', id).order('period');
    const { data: ac } = await supabase.from('admin_calls')
      .select('date,platform,count').eq('driver_id', id).order('date');
    console.log(`\n  ${id}`);
    console.log(`    일정산 ${(ds || []).length}건${(ds || []).map(d =>
      ` ${String(d.period).slice(0, 10)}/${won(d.settlement_amount)}원`).join('')}`);
    console.log(`    콜수  ${(ac || []).length}건${(ac || []).map(a =>
      ` ${String(a.date).slice(0, 10)}/${a.count}콜`).join('')}`);
  }

  console.log('\n[4] 세 기사의 콜수 행 (일정산 없는 날에도 콜수는 있나)');
  for (const [name, id] of Object.entries(IDS)) {
    const { data } = await supabase.from('admin_calls')
      .select('date,platform,count,created_at,updated_at').eq('driver_id', id).order('date');
    console.log(`\n  ${name} — 콜수 ${(data || []).length}건`);
    (data || []).forEach(a => console.log(`      ${String(a.date).slice(0, 10)} ${a.platform.padEnd(8)}`
      + ` ${String(a.count).padStart(3)}콜 · 생성 ${String(a.created_at).slice(0, 19)}`));
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });

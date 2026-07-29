/** 콜수수료·일정산수수료 설정값 확인 (읽기 전용) */
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

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase
    .from('settings').select('value').eq('key', 'brem_payroll_daily_settlement_fees_v1').maybeSingle();
  if (error) throw new Error(`설정 조회 실패: ${error.message}`);
  console.log('brem_payroll_daily_settlement_fees_v1 =');
  console.log(JSON.stringify(data?.value ?? null, null, 2));

  // 콜수수료가 실제로 일정산 실지급에 반영되고 있는지 규모 확인
  const { data: rows, error: e2 } = await supabase
    .from('daily_settlements')
    .select('platform, order_count, settlement_amount, period')
    .order('period', { ascending: false })
    .limit(2000);
  if (e2) throw new Error(`일정산 조회 실패: ${e2.message}`);

  const byPlatform = new Map();
  (rows || []).forEach(r => {
    const p = String(r.platform || '');
    const cur = byPlatform.get(p) || { rows: 0, orders: 0, amount: 0 };
    cur.rows += 1;
    cur.orders += Number(r.order_count || 0);
    cur.amount += Number(r.settlement_amount || 0);
    byPlatform.set(p, cur);
  });
  console.log('\n최근 일정산 데이터 (최대 2000행):');
  byPlatform.forEach((v, p) => {
    console.log(`  ${p}: ${v.rows}행 · 오더 ${v.orders.toLocaleString('ko-KR')} · 정산금액 ${v.amount.toLocaleString('ko-KR')}원`);
  });
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

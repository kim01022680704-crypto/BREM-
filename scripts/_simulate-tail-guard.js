#!/usr/bin/env node
/**
 * 새 매칭 규칙(뒤4 검증 + 키 충돌 방어)을 과거 반영기록 전체에 적용해 본다 (읽기 전용)
 *
 *   node scripts/_simulate-tail-guard.js
 *
 * 실제 matchDrivers 를 그대로 불러 쓴다. 식을 새로 구현하지 않는다.
 * 현재 등록 기사 명단을 기준으로 돌리므로 "지금 다시 올린다면" 어떻게 되는지를 본다.
 *
 * 확인 목적
 *   1) 원래 키로 정확히 붙던 건이 하나도 안 깨지는지 (회귀 없음)
 *   2) 새로 미매칭이 되는 건이 정확히 누구인지
 *
 * 쓰기 없음.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const root = path.resolve(__dirname, '..');
const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const readJs = f => fs.readFileSync(path.join(root, 'js', f), 'utf8');
vm.runInContext(
  [
    readJs('settlement-formats.js'),
    readJs('settlement-client.js'),
    'var __exports = { SettlementFormats, BremSettlementParser };'
  ].join('\n'),
  sandbox,
  { filename: 'settlement-bundle.js' }
);
const { SettlementFormats, BremSettlementParser } = sandbox.__exports;

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

async function fetchAll(table, columns, build) {
  const size = 300;
  const out = [];
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

(async () => {
  const riderRows = await fetchAll('riders', 'id,name,phone,baemin_id,raw_data');
  const drivers = riderRows.map(r => {
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      baeminId: r.baemin_id,
      coupangId: raw.coupangId || raw.coupangLoginKey || raw.coupangLoginId || ''
    };
  });
  const byId = new Map(drivers.map(d => [d.id, d]));

  const mapRow = await supabase.from('settings').select('value')
    .eq('key', 'brem_admin_manual_name_mappings').maybeSingle();
  let mv = mapRow.data?.value;
  if (typeof mv === 'string') { try { mv = JSON.parse(mv); } catch (_) { mv = []; } }
  const manualMappings = Array.isArray(mv) ? mv : [];

  const logs = await fetchAll('settlement_upload_logs',
    'period,platform,kind,applied_records', q => q.eq('kind', 'daily'));

  console.log('='.repeat(96));
  console.log(' 새 매칭 규칙을 과거 반영기록에 적용 (읽기 전용)');
  console.log('='.repeat(96));
  console.log(`\n기사 ${drivers.length}명 · 수동매핑 ${manualMappings.length}건 · 일정산 로그 ${logs.length}건`);

  const stat = { same: 0, nowUnmatched: 0, changedTarget: 0, skipped: 0 };
  const nowUnmatched = new Map();
  const changed = [];

  for (const log of logs) {
    const platform = String(log.platform || '').toLowerCase();
    const format = SettlementFormats.getFormatForPlatform(platform);
    const recs = Array.isArray(log.applied_records) ? log.applied_records : [];
    if (!recs.length) continue;

    const rows = recs.map(r => ({
      rawName: r.rawName || r.name || '',
      name: r.name || r.rawName || '',
      riderId: r.riderId || '',
      orderCount: Number(r.orderCount || 0),
      hourlyInsurance: Number(r.hourlyInsurance || 0),
      deductionBase: Number(r.deductionBase || 0),
      deliveryAmount: Number(r.deliveryAmount || 0),
      settlementAmount: Number(r.settlementAmount || r.deliveryAmount || 0)
    }));
    const out = BremSettlementParser.matchDrivers(rows, drivers, format, { manualMappings });

    // 원래 배정과 새 결과를 행 단위로 대조
    const newByKey = new Map();
    out.matched.forEach(m => newByKey.set(`${m.rawName}|${m.riderId}`, m.driverId));
    const unmatchedByKey = new Map();
    out.unmatched.forEach(u => unmatchedByKey.set(`${u.rawName}|${u.riderId}`, u.reason || ''));

    recs.forEach(r => {
      const key = `${r.rawName || r.name || ''}|${r.riderId || ''}`;
      const before = String(r.driverId || '');
      if (!before || !byId.has(before)) { stat.skipped += 1; return; }
      const after = newByKey.get(key);
      if (after === before) { stat.same += 1; return; }
      if (after && after !== before) {
        stat.changedTarget += 1;
        const tail = d => String(d?.phone || '').replace(/[^0-9]/g, '').slice(-4);
        changed.push({
          period: String(log.period).slice(0, 10), platform,
          sheet: r.rawName || r.name,
          before: `${byId.get(before)?.name}/${tail(byId.get(before))}`,
          after: `${byId.get(after)?.name}/${tail(byId.get(after))}`,
          amount: Number(r.settlementAmount || r.deliveryAmount || 0)
        });
        return;
      }
      stat.nowUnmatched += 1;
      const label = `${r.rawName || r.name} -> ${byId.get(before)?.name}`;
      const cur = nowUnmatched.get(label) || { n: 0, amt: 0, reason: unmatchedByKey.get(key) || '' };
      cur.n += 1;
      cur.amt += Number(r.settlementAmount || r.deliveryAmount || 0);
      nowUnmatched.set(label, cur);
    });
  }

  console.log('\n[결과]');
  console.log(`  그대로 같은 기사에 붙음 (회귀 없음) : ${stat.same}행`);
  console.log(`  새로 미매칭이 됨                    : ${stat.nowUnmatched}행`);
  console.log(`  배정 대상이 바뀜                    : ${stat.changedTarget}행`);
  console.log(`  기사 레코드가 없어 비교 불가        : ${stat.skipped}행`);

  if (changed.length) {
    // 정산서 키의 뒤4와 새 대상의 뒤4가 같으면 오배정이 교정된 것이다.
    const tailOf = s => (String(s || '').match(/(\d{4})\s*$/) || [])[1] || '';
    const fixed = changed.filter(c => tailOf(c.sheet) && tailOf(c.after) === tailOf(c.sheet));
    const review = changed.filter(c => !(tailOf(c.sheet) && tailOf(c.after) === tailOf(c.sheet)));
    console.log(`\n  ├ 정산서 키의 주인에게 제대로 붙음 (오배정 교정) : ${fixed.length}행`
      + ` · ${won(fixed.reduce((a, c) => a + c.amount, 0))}원`);
    console.log(`  └ 그 외 (검토 필요)                              : ${review.length}행`);
    const byPerson = new Map();
    fixed.forEach(c => {
      const k = `${c.sheet} : ${c.before} → ${c.after}`;
      const cur = byPerson.get(k) || { n: 0, amt: 0 };
      cur.n += 1; cur.amt += c.amount;
      byPerson.set(k, cur);
    });
    console.log('\n  [오배정 교정 내역]');
    [...byPerson.entries()].sort((a, b) => b[1].amt - a[1].amt).forEach(([k, v]) =>
      console.log(`    ${k.padEnd(46)} ${String(v.n).padStart(3)}행 ${won(v.amt).padStart(11)}원`));
    if (review.length) {
      console.log('\n  ★ 검토 필요');
      review.slice(0, 20).forEach(c => console.log(`    ${c.period} ${c.platform} "${c.sheet}" ${c.before} → ${c.after} · ${won(c.amount)}원`));
    }
  }

  console.log('\n[새로 미매칭이 되는 대상]');
  [...nowUnmatched.entries()]
    .sort((a, b) => b[1].amt - a[1].amt)
    .forEach(([label, v]) => {
      console.log(`  ${label.padEnd(34)} ${String(v.n).padStart(3)}행 ${won(v.amt).padStart(11)}원`);
      if (v.reason) console.log(`      사유: ${v.reason}`);
    });
  const totalAmt = [...nowUnmatched.values()].reduce((a, v) => a + v.amt, 0);
  console.log(`\n  합계 ${nowUnmatched.size}명 · ${stat.nowUnmatched}행 · ${won(totalAmt)}원`);
  console.log('  ※ 이 건들은 앞으로 「미매칭」으로 떠서 사람이 확인·연결하게 된다.');
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

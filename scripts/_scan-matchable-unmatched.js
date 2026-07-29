#!/usr/bin/env node
/**
 * 지금 매칭 가능한 미매칭 일정산 전수 조사 (읽기 전용)
 *
 * 기사 등록이 늦어 미매칭으로 쌓였다가, 이제 등록이 끝나 매칭 가능해진 건을
 * 한 번에 찾아낸다. (기사별로 하나씩 확인하는 대신 전체를 훑는다)
 *
 * 원칙: insert/update/delete/upsert 를 절대 호출하지 않는다.
 *      조회가 실패하면 0으로 넘기지 않고 즉시 중단한다.
 */
const path = require('path');
const fs = require('fs');

function die(msg, detail) {
  console.error(`\n[중단] ${msg}`);
  if (detail) console.error(`       ${detail}`);
  process.exit(2);
}

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try {
    require('dotenv').config({ path: envPath });
    return;
  } catch (_) { /* 수동 파싱 */ }
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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL) die('SUPABASE_URL 이 없습니다.');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');

let createClient;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (error) {
  die('@supabase/supabase-js 로드 실패', error.message);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const norm = s => String(s || '').replace(/\s+/g, '').trim();
const lower = s => norm(s).toLowerCase();

// Supabase 는 한 번에 1000행만 준다. 그냥 select 하면 일정산 5000여 건이
// 1000건으로 잘려서, 이미 반영된 건이 "미반영" 으로 잘못 잡힌다.
// 반드시 끝까지 페이지를 넘겨 읽는다.
async function fetchAll(table, columns, tweak) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select(columns).range(from, from + size - 1);
    if (tweak) q = tweak(q);
    const { data, error } = await q;
    if (error) die(`${table} 조회 실패`, error.message);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

(async () => {
  console.log('='.repeat(76));
  console.log(' 지금 매칭 가능한 미매칭 일정산 전수 조사 (읽기 전용)');
  console.log('='.repeat(76));

  const riders = await fetchAll('riders', 'id,name,baemin_id,phone,status');
  const unmatched = await fetchAll('settlement_unmatched', '*', q => q.eq('kind', 'daily'));
  const settled = await fetchAll('daily_settlements', 'id,driver_id,period,platform,order_count,settlement_amount');

  console.log(`\n기사 ${riders.length}명 · 미매칭(일정산) ${unmatched.length}건 · 반영된 일정산 ${settled.length}건`);

  // 배민ID → 기사. 중복 배민ID는 자동 매칭 대상에서 제외한다. (사람이 봐야 한다)
  const byBaemin = new Map();
  const dupeBaemin = new Set();
  riders.forEach(d => {
    const key = lower(d.baemin_id);
    if (!key) return;
    if (byBaemin.has(key)) dupeBaemin.add(key);
    byBaemin.set(key, d);
  });

  const settledIds = new Set(settled.map(r => String(r.id)));

  const matchable = [];
  const stillNoDriver = [];
  const ambiguous = [];

  unmatched.forEach(u => {
    const platform = String(u.platform || '');
    const period = String(u.period || '').slice(0, 10);
    if (platform !== 'baemin') {
      // 쿠팡은 배민ID로 매칭하지 않으므로 이 조사 대상이 아니다.
      stillNoDriver.push({ u, reason: '쿠팡(별도 확인)' });
      return;
    }
    const key = lower(u.baemin_user_id);
    if (!key) {
      stillNoDriver.push({ u, reason: '배민ID 없음' });
      return;
    }
    if (dupeBaemin.has(key)) {
      ambiguous.push({ u, reason: '배민ID 중복 등록' });
      return;
    }
    const driver = byBaemin.get(key);
    if (!driver) {
      stillNoDriver.push({ u, reason: '해당 배민ID 기사 미등록' });
      return;
    }
    const alreadyId = `${driver.id}-${period}-baemin`;
    matchable.push({
      u,
      driver,
      period,
      already: settledIds.has(alreadyId),
      amount: Number(u.settlement_amount ?? u.delivery_amount ?? 0),
      orderCount: Number(u.order_count || 0)
    });
  });

  // ── 매칭 가능 ──
  console.log('\n' + '-'.repeat(76));
  console.log(` [1] 지금 매칭 가능 — ${matchable.length}건`);
  console.log('-'.repeat(76));
  if (!matchable.length) {
    console.log('  없습니다. (등록 완료된 기사의 미매칭 잔여 없음)');
  } else {
    const byDriver = new Map();
    matchable.forEach(m => {
      const k = m.driver.id;
      if (!byDriver.has(k)) byDriver.set(k, []);
      byDriver.get(k).push(m);
    });
    [...byDriver.values()]
      .sort((a, b) => b.reduce((s, m) => s + m.amount, 0) - a.reduce((s, m) => s + m.amount, 0))
      .forEach(list => {
        const d = list[0].driver;
        const total = list.reduce((s, m) => s + m.amount, 0);
        const newOnes = list.filter(m => !m.already);
        console.log(`\n  ${d.name} (배민ID ${d.baemin_id} · ${d.phone || '-'} · ${d.status || '-'})`);
        console.log(`    미매칭 ${list.length}일 · 합계 ${money(total)} · 신규 반영 대상 ${newOnes.length}일`);
        list.sort((a, b) => a.period.localeCompare(b.period)).forEach(m => {
          console.log(`      ${m.period}  콜 ${String(m.orderCount).padStart(3)} · ${money(m.amount).padStart(11)}${m.already ? '  (이미 반영됨 → 미매칭 행만 잔존)' : ''}`);
        });
      });
    const grandTotal = matchable.filter(m => !m.already).reduce((s, m) => s + m.amount, 0);
    console.log(`\n  ▶ 신규 반영하면 늘어나는 정산액 합계: ${money(grandTotal)}`);
    console.log('  ▶ 반영 방법: node scripts/_apply-jang-match.js "기사이름"  (미리보기) → --apply');
  }

  // ── 사람이 봐야 하는 건 ──
  if (ambiguous.length) {
    console.log('\n' + '-'.repeat(76));
    console.log(` [2] 사람이 확인해야 하는 건 — ${ambiguous.length}건 (배민ID 중복 등록)`);
    console.log('-'.repeat(76));
    ambiguous.forEach(({ u, reason }) => {
      console.log(`  ${String(u.period).slice(0, 10)} ${u.name || u.raw_name} 배민ID=${u.baemin_user_id} · ${reason}`);
    });
  }

  // ── 아직 매칭 불가 ──
  console.log('\n' + '-'.repeat(76));
  console.log(` [3] 아직 매칭 불가 — ${stillNoDriver.length}건`);
  console.log('-'.repeat(76));
  const reasonCount = new Map();
  stillNoDriver.forEach(({ reason }) => reasonCount.set(reason, (reasonCount.get(reason) || 0) + 1));
  [...reasonCount.entries()].sort((a, b) => b[1] - a[1]).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count}건`);
  });
  const noDriverTotal = stillNoDriver.reduce((s, { u }) => s + Number(u.settlement_amount ?? u.delivery_amount ?? 0), 0);
  console.log(`  합계 ${money(noDriverTotal)} — 기사 등록 후에 매칭 가능해집니다.`);
  const sample = stillNoDriver.filter(x => x.reason === '해당 배민ID 기사 미등록').slice(0, 15);
  if (sample.length) {
    console.log('\n  미등록 기사 예시 (최대 15건):');
    sample.forEach(({ u }) => {
      console.log(`    ${String(u.period).slice(0, 10)} ${(u.name || u.raw_name || '-').padEnd(8)} 배민ID=${u.baemin_user_id || '-'} · ${money(u.settlement_amount ?? u.delivery_amount)}`);
    });
  }

  console.log('\n' + '='.repeat(76));
  console.log('※ 이 스크립트는 아무것도 쓰지 않았습니다.');
})().catch(error => die('예상치 못한 오류', error.stack || error.message));

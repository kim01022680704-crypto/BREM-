#!/usr/bin/env node
/**
 * 정산주 단위 미매칭 일정산 반영 (기본: 미리보기 / --apply 시에만 실제 반영)
 *
 *   node scripts/_apply-matchable-week.js 2026-07-22            ← 미리보기
 *   node scripts/_apply-matchable-week.js 2026-07-22 --apply    ← 실제 반영
 *
 * 기사 등록이 늦어 미매칭으로 쌓인 일정산을, 관리자 화면의 "매칭 재시도" 와
 * 같은 결과가 되도록 해당 정산주 전체에 대해 반영한다.
 *
 * 안전 장치
 *  1) 기본은 미리보기. --apply 없이는 절대 쓰지 않는다.
 *  2) 배민ID가 기사 등록 배민ID와 정확히 일치할 때만 반영한다.
 *  3) 배민ID가 여러 기사에 중복 등록된 건은 건너뛴다. (사람이 봐야 한다)
 *  4) 마감된 정산주는 반영을 거부한다. (마감 = 출금가능금액 0 처리된 주)
 *  5) 이미 반영된 날짜는 금액이 같은지 확인하고, 다르면 중단한다.
 *  6) 배민 콜수(admin_calls)는 BIZ 크롤링 소유이므로 건드리지 않는다. (앱과 동일)
 *  7) 출금 신청·제외목록은 읽기만 하고 쓰지 않는다.
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

const APPLY = process.argv.includes('--apply');
const WEEK = (process.argv.slice(2).find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '').trim();
const PLATFORM = 'baemin';
if (!WEEK) die('정산주 시작일(수요일)을 넣어주세요.', '예: node scripts/_apply-matchable-week.js 2026-07-22');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) die('SUPABASE 환경변수가 없습니다.');

let createClient;
try { ({ createClient } = require('@supabase/supabase-js')); }
catch (error) { die('@supabase/supabase-js 로드 실패', error.message); }
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const norm = s => String(s || '').replace(/\s+/g, '').trim();
const lower = s => norm(s).toLowerCase();

function dateKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function weekStartOf(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
  return dateKey(d);
}

(async () => {
  if (weekStartOf(WEEK) !== WEEK) die(`${WEEK} 는 정산주 시작일(수요일)이 아닙니다.`, `해당 주 시작일: ${weekStartOf(WEEK)}`);

  console.log('='.repeat(76));
  console.log(` ${WEEK} 정산주 미매칭 반영 — ${APPLY ? '### 실제 반영 ###' : '미리보기 (쓰기 없음)'}`);
  console.log('='.repeat(76));

  // 마감 여부 — 마감된 주는 반영 거부
  const { data: finRow, error: finErr } = await supabase
    .from('settings').select('value').eq('key', 'brem_payroll_week_finalized_v1').maybeSingle();
  if (finErr) die('마감 정산주 조회 실패', finErr.message);
  let finList = finRow?.value ?? [];
  if (typeof finList === 'string') { try { finList = JSON.parse(finList); } catch (_) { finList = []; } }
  const finalizedSet = new Set((Array.isArray(finList) ? finList : [])
    .map(w => String(typeof w === 'string' ? w : (w?.weekStart || '')).slice(0, 10)).filter(Boolean));
  if (finalizedSet.has(WEEK)) die(`${WEEK} 정산주는 마감 처리된 주입니다.`, '마감된 주에 일정산을 넣으면 정산이 어긋납니다.');
  console.log(`\n마감된 정산주: ${finalizedSet.size ? [...finalizedSet].sort().join(', ') : '없음'} → ${WEEK} 은 마감 아님. 진행합니다.`);

  const { data: riders, error: rErr } = await supabase.from('riders').select('id,name,baemin_id,phone,status');
  if (rErr) die('riders 조회 실패', rErr.message);
  const { data: unmatched, error: uErr } = await supabase
    .from('settlement_unmatched').select('*').eq('kind', 'daily').eq('platform', PLATFORM);
  if (uErr) die('settlement_unmatched 조회 실패', uErr.message);
  const { data: settled, error: sErr } = await supabase
    .from('daily_settlements').select('id,driver_id,period,platform,order_count,settlement_amount').eq('platform', PLATFORM);
  if (sErr) die('daily_settlements 조회 실패', sErr.message);

  const byBaemin = new Map(); const dupe = new Set();
  riders.forEach(d => {
    const k = lower(d.baemin_id); if (!k) return;
    if (byBaemin.has(k)) dupe.add(k);
    byBaemin.set(k, d);
  });
  const settledById = new Map(settled.map(r => [String(r.id), r]));

  const appliedAt = new Date().toISOString();
  const rows = []; const cleanupIds = []; const skipped = [];

  unmatched.forEach(u => {
    const period = String(u.period || '').slice(0, 10);
    if (weekStartOf(period) !== WEEK) return;
    const key = lower(u.baemin_user_id);
    const label = `${period} ${u.name || u.raw_name || '-'}`;
    if (!key) { skipped.push(`${label} · 배민ID 없음`); return; }
    if (dupe.has(key)) { skipped.push(`${label} · 배민ID(${u.baemin_user_id}) 중복 등록 → 사람이 확인 필요`); return; }
    const driver = byBaemin.get(key);
    if (!driver) { skipped.push(`${label} · 배민ID(${u.baemin_user_id}) 기사 미등록`); return; }

    const id = `${driver.id}-${period}-${PLATFORM}`;
    const orderCount = Number(u.order_count || 0);
    const settlementAmount = Number(u.settlement_amount ?? u.delivery_amount ?? 0);
    const deliveryAmount = Number(u.delivery_amount ?? u.settlement_amount ?? 0);
    const prev = settledById.get(id);

    if (prev) {
      if (Number(prev.settlement_amount || 0) !== settlementAmount || Number(prev.order_count || 0) !== orderCount) {
        die(`${label} 은 이미 반영돼 있는데 금액/콜수가 다릅니다.`,
          `기존 콜 ${prev.order_count} · ${money(prev.settlement_amount)} / 미매칭 콜 ${orderCount} · ${money(settlementAmount)}`);
      }
      cleanupIds.push(u.id);
      skipped.push(`${label} · 이미 반영됨(동일) → 미매칭 행만 정리`);
      return;
    }

    rows.push({
      _name: driver.name, _period: period, _orderCount: orderCount,
      row: {
        id, driver_id: driver.id, period, platform: PLATFORM,
        rider_id: String(u.rider_id || ''),
        order_count: orderCount,
        hourly_insurance: Math.abs(Number(u.hourly_insurance || 0)),
        delivery_amount: deliveryAmount,
        settlement_amount: settlementAmount,
        applied_at: appliedAt, updated_at: appliedAt
      }
    });
    cleanupIds.push(u.id);
  });

  console.log('\n' + '-'.repeat(76));
  console.log(' 반영 계획');
  console.log('-'.repeat(76));
  if (!rows.length) console.log('  신규 반영할 건이 없습니다.');
  rows.sort((a, b) => b.row.settlement_amount - a.row.settlement_amount).forEach(r => {
    console.log(`  ${r._period}  ${r._name.padEnd(8)} 콜 ${String(r._orderCount).padStart(3)} · ${money(r.row.settlement_amount).padStart(11)}`);
  });
  const total = rows.reduce((s, r) => s + r.row.settlement_amount, 0);
  console.log('-'.repeat(76));
  console.log(`  신규 반영 ${rows.length}건 · 합계 ${money(total)} · 정리할 미매칭 행 ${cleanupIds.length}건`);
  if (skipped.length) {
    console.log('\n  건너뜀:');
    skipped.forEach(s => console.log(`    ${s}`));
  }
  console.log('\n  ※ 배민 콜수(admin_calls)는 BIZ 크롤링 소유라 건드리지 않습니다.');
  console.log('  ※ 출금 신청·제외목록은 읽기만 했습니다.');

  if (!APPLY) {
    console.log('\n미리보기입니다. 실제 반영하려면 --apply 를 붙여 다시 실행하세요.');
    return;
  }

  console.log('\n' + '='.repeat(76));
  if (rows.length) {
    const { error } = await supabase.from('daily_settlements').upsert(rows.map(r => r.row), { onConflict: 'id' });
    if (error) die('daily_settlements 반영 실패', error.message);
    console.log(` 일정산 ${rows.length}건 반영 완료`);
  }
  if (cleanupIds.length) {
    const { error } = await supabase.from('settlement_unmatched').delete().in('id', cleanupIds);
    if (error) die('미매칭 행 정리 실패 (일정산은 이미 반영됨)', error.message);
    console.log(` 미매칭 행 ${cleanupIds.length}건 정리 완료`);
  }

  const { data: left, error: lErr } = await supabase
    .from('settlement_unmatched').select('id,period,name,baemin_user_id').eq('kind', 'daily').eq('platform', PLATFORM);
  if (lErr) die('반영 후 확인 실패', lErr.message);
  const leftThisWeek = (left || []).filter(u => weekStartOf(String(u.period).slice(0, 10)) === WEEK);
  console.log(`\n ${WEEK} 정산주 남은 미매칭: ${leftThisWeek.length}건`);
  leftThisWeek.forEach(u => console.log(`   ${String(u.period).slice(0, 10)} ${u.name || '-'} 배민ID=${u.baemin_user_id || '-'} (기사 미등록)`));
})().catch(error => die('예상치 못한 오류', error.stack || error.message));

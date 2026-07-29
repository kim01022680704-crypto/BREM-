#!/usr/bin/env node
/**
 * 장정민 기사 미매칭 일정산 반영 (기본: 미리보기 / --apply 시에만 실제 반영)
 *
 *   node scripts/_apply-jang-match.js            ← 미리보기만 (쓰기 없음)
 *   node scripts/_apply-jang-match.js --apply    ← 실제 반영
 *
 * 안전 장치
 *  1) 기본은 미리보기. --apply 없이는 절대 쓰지 않는다.
 *  2) 기사 이름이 정확히 1명 매칭될 때만 진행한다.
 *  3) 미매칭 행의 배민ID가 기사 등록 배민ID와 정확히 일치할 때만 반영한다.
 *  4) 앱이 만든 기존 행을 템플릿으로 컬럼 형식을 대조한다.
 *  5) 이미 반영된 날짜는 금액이 같은지 확인하고, 다르면 중단한다.
 *  6) 배민 콜수(admin_calls)는 BIZ 크롤링 소유이므로 건드리지 않는다. (앱과 동일)
 *  7) 출금 관련 테이블·제외목록은 읽지도 쓰지도 않는다.
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
const NAME = '장정민';
const PLATFORM = 'baemin';

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

(async () => {
  console.log('='.repeat(72));
  console.log(` ${NAME} 미매칭 일정산 반영 — ${APPLY ? '### 실제 반영 ###' : '미리보기 (쓰기 없음)'}`);
  console.log('='.repeat(72));

  // 1. 기사 확인 — 정확히 1명이어야 한다
  const { data: riders, error: rErr } = await supabase.from('riders').select('id,name,baemin_id,phone,status');
  if (rErr) die('riders 조회 실패', rErr.message);
  const hits = (riders || []).filter(d => norm(d.name) === norm(NAME));
  if (hits.length !== 1) die(`"${NAME}" 기사가 ${hits.length}명 매칭됐습니다. 1명일 때만 진행합니다.`);
  const driver = hits[0];
  const driverBaeminId = norm(driver.baemin_id);
  if (!driverBaeminId) die('기사에게 배민ID가 등록되어 있지 않습니다.');
  console.log(`\n기사: ${driver.name} · id=${driver.id} · 배민ID=${driver.baemin_id} · ${driver.phone || '-'} · 상태=${driver.status || '-'}`);

  // 2. 이 기사의 미매칭 행 — 배민ID 정확 일치만
  const { data: unmatched, error: uErr } = await supabase
    .from('settlement_unmatched').select('*').eq('kind', 'daily').eq('platform', PLATFORM);
  if (uErr) die('settlement_unmatched 조회 실패', uErr.message);
  const mine = (unmatched || []).filter(u => norm(u.baemin_user_id) === driverBaeminId);
  if (!mine.length) {
    console.log('\n반영할 미매칭 행이 없습니다. (이미 모두 처리됨)');
    return;
  }
  mine.sort((a, b) => String(a.period).localeCompare(String(b.period)));

  // 3. 기존 반영 행 (템플릿 + 중복 확인)
  const { data: existing, error: eErr } = await supabase
    .from('daily_settlements').select('*').eq('driver_id', driver.id).eq('platform', PLATFORM);
  if (eErr) die('daily_settlements 조회 실패', eErr.message);
  const existingByPeriod = new Map((existing || []).map(r => [String(r.period).slice(0, 10), r]));
  const template = (existing || [])[0];
  if (template) {
    console.log(`\n템플릿(앱이 만든 기존 행) 컬럼: ${Object.keys(template).sort().join(', ')}`);
  }

  // 4. 반영 계획
  const appliedAt = new Date().toISOString();
  const plan = [];
  console.log('\n' + '-'.repeat(72));
  console.log(' 반영 계획');
  console.log('-'.repeat(72));
  for (const u of mine) {
    const period = String(u.period).slice(0, 10);
    const id = `${driver.id}-${period}-${PLATFORM}`;
    const orderCount = Number(u.order_count || 0);
    const settlementAmount = Number(u.settlement_amount ?? u.delivery_amount ?? 0);
    const deliveryAmount = Number(u.delivery_amount ?? u.settlement_amount ?? 0);
    const prev = existingByPeriod.get(period);

    if (prev) {
      // 이미 반영된 날짜: 금액이 다르면 손대지 않고 중단한다.
      const samePay = Number(prev.settlement_amount || 0) === settlementAmount;
      const sameCall = Number(prev.order_count || 0) === orderCount;
      if (!samePay || !sameCall) {
        die(`${period} 은 이미 반영돼 있는데 금액/콜수가 다릅니다. 수동 확인이 필요합니다.`,
          `기존 콜 ${prev.order_count} · ${money(prev.settlement_amount)} / 미매칭 콜 ${orderCount} · ${money(settlementAmount)}`);
      }
      console.log(`  ${period}  이미 반영됨 (동일) → 일정산은 건드리지 않고 미매칭 행만 정리`);
      plan.push({ period, unmatchedId: u.id, row: null });
      continue;
    }

    console.log(`  ${period}  신규 반영: 콜 ${String(orderCount).padStart(3)} · ${money(settlementAmount).padStart(11)}`);
    plan.push({
      period,
      unmatchedId: u.id,
      row: {
        id,
        driver_id: driver.id,
        period,
        platform: PLATFORM,
        rider_id: String(u.rider_id || ''),
        order_count: orderCount,
        hourly_insurance: Math.abs(Number(u.hourly_insurance || 0)),
        delivery_amount: deliveryAmount,
        settlement_amount: settlementAmount,
        applied_at: appliedAt,
        updated_at: appliedAt
      }
    });
  }

  const newRows = plan.filter(p => p.row).map(p => p.row);
  const totalNew = newRows.reduce((s, r) => s + r.settlement_amount, 0);
  console.log('-'.repeat(72));
  console.log(`  신규 반영 ${newRows.length}일 · 합계 ${money(totalNew)}`);
  console.log(`  정리할 미매칭 행 ${plan.length}건`);
  console.log('\n  ※ 배민 콜수(admin_calls)는 BIZ 크롤링 소유라 건드리지 않습니다.');
  console.log('  ※ 출금 신청·처리완료·제외목록은 읽지도 쓰지도 않습니다.');

  if (!APPLY) {
    console.log('\n미리보기입니다. 실제 반영하려면 --apply 를 붙여 다시 실행하세요.');
    return;
  }

  // 5. 실제 반영
  console.log('\n' + '='.repeat(72));
  if (newRows.length) {
    const { error } = await supabase.from('daily_settlements').upsert(newRows, { onConflict: 'id' });
    if (error) die('daily_settlements 반영 실패', error.message);
    console.log(` 일정산 ${newRows.length}건 반영 완료`);
  } else {
    console.log(' 신규 반영할 일정산 없음');
  }

  const removeIds = plan.map(p => p.unmatchedId);
  const { error: dErr } = await supabase.from('settlement_unmatched').delete().in('id', removeIds);
  if (dErr) die('미매칭 행 정리 실패 (일정산은 이미 반영됨)', dErr.message);
  console.log(` 미매칭 행 ${removeIds.length}건 정리 완료`);

  // 6. 반영 후 재확인
  const { data: after, error: aErr } = await supabase
    .from('daily_settlements').select('period,order_count,settlement_amount')
    .eq('driver_id', driver.id).eq('platform', PLATFORM).order('period');
  if (aErr) die('반영 후 확인 조회 실패', aErr.message);
  const { data: leftover, error: lErr } = await supabase
    .from('settlement_unmatched').select('id,period')
    .eq('kind', 'daily').eq('platform', PLATFORM).eq('baemin_user_id', driver.baemin_id);
  if (lErr) die('반영 후 미매칭 확인 실패', lErr.message);

  console.log('\n' + '-'.repeat(72));
  console.log(' 반영 후 상태');
  console.log('-'.repeat(72));
  (after || []).forEach(r => console.log(`  ${String(r.period).slice(0, 10)}  콜 ${String(r.order_count).padStart(3)} · ${money(r.settlement_amount).padStart(11)}`));
  console.log(`  합계 ${money((after || []).reduce((s, r) => s + Number(r.settlement_amount || 0), 0))}`);
  console.log(`  남은 미매칭: ${(leftover || []).length}건 ${(leftover || []).map(r => String(r.period).slice(0, 10)).join(', ')}`);
})().catch(error => die('예상치 못한 오류', error.stack || error.message));

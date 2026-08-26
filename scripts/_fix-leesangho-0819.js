#!/usr/bin/env node
/**
 * 8/19 쿠팡 일정산 오배정 보정 — 이상호8127 → 이상호5518
 *
 *   node scripts/_fix-leesangho-0819.js            ← 미리보기 (쓰기 없음)
 *   node scripts/_fix-leesangho-0819.js --apply     ← 실제 반영
 *
 * 근거
 *   8/19 쿠팡 정산서 반영기록의 rawName 은 "이상호5518" 인데 driverId 는 8127 이다.
 *   반영 시점(8/20)에 5518 이 아직 등록되지 않아(8/21 등록) 쿠팡ID 키 매칭이 실패하고
 *   이름 백업 매칭으로 동명이인 8127 에게 붙었다. 8127 은 쿠팡 크롤 실적이 0행이고
 *   일정산도 이 한 건뿐이다. 5518 은 8/19 크롤 실적이 있고 8/20 이후는 정상 매칭됐다.
 *
 * 안전 장치
 *   1) 기본은 미리보기. --apply 없이는 아무것도 쓰지 않는다.
 *   2) 원본 행이 기대한 값(81콜 / 282,355원)과 다르면 중단한다.
 *   3) 대상(5518)에 같은 날 행이 이미 있으면 중단한다.
 *   4) 두 기사 모두 그 주 출금이 있으면 중단한다. (한도 소급 재계산 방지)
 *   5) 이동만 한다. 금액·콜수·공제기준을 새로 계산하지 않는다.
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

const withdrawal = require('../server/rider-withdrawal');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--apply');
const FROM_ID = '1ea00d48-bcb0-4c6c-9762-289a7f2aae23'; // 이상호 010-8973-8127
const TO_ID = 'b837aced-8a64-45c8-999f-4a992d94fc49';   // 이상호 010-3355-5518
const DATE = '2026-08-19';
const PLATFORM = 'coupang';
const WEEK = '2026-08-19';
const EXPECT_ORDER = 81;
const EXPECT_AMOUNT = 282355;

const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');

(async () => {
  console.log('='.repeat(88));
  console.log(` 8/19 쿠팡 일정산 오배정 보정 — ${APPLY ? '### 실제 반영 ###' : '미리보기 (쓰기 없음)'}`);
  console.log('='.repeat(88));

  // 0) 기사 확인
  const { data: riders, error: rErr } = await supabase
    .from('riders').select('id,name,phone').in('id', [FROM_ID, TO_ID]);
  if (rErr) die('riders 조회 실패', rErr.message);
  const from = (riders || []).find(r => r.id === FROM_ID);
  const to = (riders || []).find(r => r.id === TO_ID);
  if (!from || !to) die('대상 기사를 찾지 못했습니다.');
  console.log(`\n  보내는 쪽: "${from.name}" ${from.phone}`);
  console.log(`  받는 쪽  : "${to.name}" ${to.phone}`);

  // 1) 원본 일정산 행
  const srcId = `${FROM_ID}-${DATE}-${PLATFORM}`;
  const dstId = `${TO_ID}-${DATE}-${PLATFORM}`;
  const { data: src, error: sErr } = await supabase
    .from('daily_settlements').select('*').eq('id', srcId).maybeSingle();
  if (sErr) die('daily_settlements 조회 실패', sErr.message);
  if (!src) die(`원본 일정산 행이 없습니다: ${srcId}`, '이미 보정됐을 수 있습니다.');
  if (Number(src.order_count) !== EXPECT_ORDER || Math.round(Number(src.settlement_amount)) !== EXPECT_AMOUNT) {
    die('원본 행의 값이 기대와 다릅니다.',
      `콜 ${src.order_count}(기대 ${EXPECT_ORDER}) · 금액 ${src.settlement_amount}(기대 ${EXPECT_AMOUNT})`);
  }
  const { data: dst } = await supabase.from('daily_settlements').select('id').eq('id', dstId).maybeSingle();
  if (dst) die(`받는 쪽에 이미 같은 날 행이 있습니다: ${dstId}`, '수동 확인이 필요합니다.');

  console.log(`\n  [일정산] ${srcId}`);
  console.log(`     → ${dstId}`);
  console.log(`     콜 ${src.order_count} · 배달료 ${won(src.delivery_amount)} · 정산 ${won(src.settlement_amount)}`
    + ` · 공제기준 ${won(src.deduction_base)} · 시간제보험 ${won(src.hourly_insurance)}`);

  // 2) 콜수 행
  const callSrcId = `${FROM_ID}-${DATE}-${PLATFORM}`;
  const callDstId = `${TO_ID}-${DATE}-${PLATFORM}`;
  const { data: callSrc } = await supabase.from('admin_calls').select('*').eq('id', callSrcId).maybeSingle();
  const { data: callDst } = await supabase.from('admin_calls').select('id').eq('id', callDstId).maybeSingle();
  if (callDst) die(`받는 쪽에 이미 같은 날 콜수 행이 있습니다: ${callDstId}`);
  if (callSrc) {
    console.log(`\n  [콜수] ${callSrcId} (${callSrc.count}콜)`);
    console.log(`     → ${callDstId}`);
  } else {
    console.log('\n  [콜수] 원본 콜수 행이 없습니다. 일정산만 옮깁니다.');
  }

  // 3) 출금 확인 — 둘 중 누구라도 그 주 출금이 있으면 중단
  const { data: setRow, error: wErr } = await supabase
    .from('settings').select('value').eq('key', withdrawal.REQUESTS_KEY).maybeSingle();
  if (wErr) die('출금신청 조회 실패', wErr.message);
  let wv = setRow?.value;
  if (typeof wv === 'string') { try { wv = JSON.parse(wv); } catch (_) { wv = []; } }
  const live = withdrawal.__audit.normalizeRequestList(wv)
    .filter(x => (x.status === 'pending' || x.status === 'completed')
      && [FROM_ID, TO_ID].includes(String(x.driverId))
      && String(x.weekStart).slice(0, 10) === WEEK);
  if (live.length) {
    console.log('\n  그 주 출금 내역:');
    live.forEach(x => console.log(`    ${x.driverId === FROM_ID ? from.name + '(보내는쪽)' : to.name + '(받는쪽)'}`
      + ` ${String(x.createdAt).slice(0, 19)} ${won(x.amount)}원 · ${x.status}`));
    die('그 주에 출금이 이미 나갔습니다.', '한도가 소급 재계산되므로 사람이 판단해야 합니다.');
  }
  console.log('\n  출금 확인: 두 기사 모두 8/19 주 출금 없음 → 한도 소급 문제 없음');

  // 4) 업로드 로그 반영기록의 driverId
  const { data: logs, error: lErr } = await supabase
    .from('settlement_upload_logs')
    .select('id,file_name,applied_records,matched_records')
    .eq('platform', PLATFORM).eq('kind', 'daily').eq('period', DATE);
  if (lErr) die('업로드 로그 조회 실패', lErr.message);
  const logPatches = [];
  (logs || []).forEach(l => {
    const fix = arr => {
      if (!Array.isArray(arr)) return { changed: 0, next: arr };
      let changed = 0;
      const next = arr.map(rec => {
        if (String(rec?.driverId || '') === FROM_ID && String(rec?.rawName || '').includes('5518')) {
          changed += 1;
          return { ...rec, driverId: TO_ID };
        }
        return rec;
      });
      return { changed, next };
    };
    const a = fix(l.applied_records);
    const m = fix(l.matched_records);
    if (a.changed || m.changed) {
      logPatches.push({ id: l.id, fileName: l.file_name, applied: a.next, matched: m.next, count: a.changed + m.changed });
    }
  });
  if (logPatches.length) {
    logPatches.forEach(p => console.log(`\n  [업로드로그] ${p.fileName} · 반영기록 ${p.count}곳 driverId 교체`));
  } else {
    console.log('\n  [업로드로그] 교체할 반영기록이 없습니다.');
  }

  if (!APPLY) {
    console.log('\n' + '='.repeat(88));
    console.log(' 미리보기입니다. 실제로 옮기려면 --apply 를 붙여 다시 실행하세요.');
    console.log('='.repeat(88));
    return;
  }

  console.log('\n' + '='.repeat(88));
  console.log(' 반영 시작');

  // 일정산: 새 id 로 insert → 원본 delete
  const nextRow = { ...src, id: dstId, driver_id: TO_ID, updated_at: new Date().toISOString() };
  const ins = await supabase.from('daily_settlements').insert(nextRow);
  if (ins.error) die('일정산 이동(insert) 실패', ins.error.message);
  const del = await supabase.from('daily_settlements').delete().eq('id', srcId);
  if (del.error) die('일정산 원본 삭제 실패 — 같은 금액이 두 명에게 있습니다. 즉시 확인 필요.', del.error.message);
  console.log(`  일정산 이동 완료: ${srcId} → ${dstId}`);

  // 콜수
  if (callSrc) {
    const nextCall = { ...callSrc, id: callDstId, driver_id: TO_ID, updated_at: new Date().toISOString() };
    const ci = await supabase.from('admin_calls').insert(nextCall);
    if (ci.error) die('콜수 이동(insert) 실패 — 일정산은 이미 옮겨졌습니다.', ci.error.message);
    const cd = await supabase.from('admin_calls').delete().eq('id', callSrcId);
    if (cd.error) die('콜수 원본 삭제 실패 — 콜수가 두 명에게 있습니다. 즉시 확인 필요.', cd.error.message);
    console.log(`  콜수 이동 완료: ${callSrcId} → ${callDstId}`);
  }

  // 업로드 로그
  for (const p of logPatches) {
    const up = await supabase.from('settlement_upload_logs')
      .update({ applied_records: p.applied, matched_records: p.matched, updated_at: new Date().toISOString() })
      .eq('id', p.id);
    if (up.error) die('업로드 로그 갱신 실패 (일정산·콜수는 이미 이동됨)', up.error.message);
    console.log(`  업로드로그 갱신 완료: ${p.fileName}`);
  }

  // 확인
  const { data: after } = await supabase.from('daily_settlements')
    .select('id,driver_id,period,order_count,settlement_amount')
    .in('driver_id', [FROM_ID, TO_ID]).eq('period', DATE);
  console.log('\n  반영 후 8/19 행:');
  (after || []).forEach(r => console.log(`    ${r.driver_id === TO_ID ? to.name + '(5518)' : from.name + '(8127)'}`
    + ` · ${r.order_count}콜 · ${won(r.settlement_amount)}원`));
  console.log('\n 완료. 관리자 화면은 새로고침해야 반영됩니다.');
})().catch(err => die('예상치 못한 오류', err.stack || err.message));

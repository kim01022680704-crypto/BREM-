#!/usr/bin/env node
/**
 * 장정민 기사 일정산 매칭·출금 진단 (읽기 전용)
 *
 * 목적
 *  1) 7/28 매칭재시도 후 다른 날짜 데이터가 실제로 사라졌는지 확인
 *  2) 매칭재시도가 기존 출금·출금가능금액에 영향을 줬는지 확인
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

const NAME = process.argv[2] || '장정민';
const WEEK_FROM = process.argv[3] || '2026-07-22';
const WEEK_TO = process.argv[4] || '2026-07-28';

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const norm = s => String(s || '').replace(/\s+/g, '').trim();

async function q(label, builder) {
  const { data, error } = await builder;
  if (error) die(`${label} 조회 실패`, error.message);
  return data || [];
}

async function readSetting(key) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) die(`설정 "${key}" 조회 실패`, error.message);
  return data?.value;
}

(async () => {
  console.log('='.repeat(74));
  console.log(` ${NAME} 일정산 매칭·출금 진단 (읽기 전용) · 정산주 ${WEEK_FROM} ~ ${WEEK_TO}`);
  console.log('='.repeat(74));

  // ── 1. 기사 레코드 ────────────────────────────────────────
  const drivers = await q('riders', supabase.from('riders').select('*'));
  const hits = drivers.filter(d => norm(d.name).includes(norm(NAME)));
  console.log(`\n[1] 기사 등록 (riders 전체 ${drivers.length}명 중 이름 일치 ${hits.length}건)`);
  if (!hits.length) die(`"${NAME}" 이름의 기사를 찾지 못했습니다.`);
  hits.forEach(d => {
    console.log(`  id=${d.id}`);
    console.log(`    이름=${d.name} 배민ID=${d.baemin_id || '-'} 쿠팡ID=${d.coupang_id || '-'} 전화=${d.phone || '-'}`);
    console.log(`    지사=${d.branch || '-'} 등록=${d.created_at || '-'} 수정=${d.updated_at || '-'}`);
  });
  const driverIds = hits.map(d => d.id);

  // ── 2. 일정산 반영 내역 ───────────────────────────────────
  const settled = await q('daily_settlements',
    supabase.from('daily_settlements').select('*').in('driver_id', driverIds).order('period'));
  console.log(`\n[2] daily_settlements — 이 기사에게 반영된 일정산 (전체 기간, ${settled.length}건)`);
  if (!settled.length) {
    console.log('  없음.');
  } else {
    settled.forEach(r => {
      console.log(`  ${r.period} ${r.platform.padEnd(7)} 콜 ${String(r.order_count).padStart(4)} · 정산 ${money(r.settlement_amount).padStart(12)} · 보험 ${money(r.hourly_insurance)} · 반영 ${r.applied_at || '-'}`);
    });
  }

  // ── 3. 해당 정산주에 이 기사 것으로 남아있는 미매칭 ────────
  const unmatchedAll = await q('settlement_unmatched',
    supabase.from('settlement_unmatched').select('*').gte('period', WEEK_FROM).lte('period', WEEK_TO));
  const baeminIds = hits.map(d => norm(d.baemin_id)).filter(Boolean);
  const mine = unmatchedAll.filter(u =>
    norm(u.raw_name).includes(norm(NAME))
    || norm(u.name).includes(norm(NAME))
    || (baeminIds.length && baeminIds.includes(norm(u.baemin_user_id)))
  );
  console.log(`\n[3] settlement_unmatched — 정산주 내 미매칭 (전체 ${unmatchedAll.length}건 중 이 기사 ${mine.length}건)`);
  if (!mine.length) {
    console.log('  이 기사 이름/배민ID로 남아있는 미매칭 없음.');
  } else {
    mine.forEach(u => {
      console.log(`  ${u.period} ${u.platform.padEnd(7)} 이름=${u.raw_name || u.name} 배민ID=${u.baemin_user_id || '-'} 콜 ${u.order_count} · 정산 ${money(u.settlement_amount)}`);
      console.log(`      id=${u.id} 저장=${u.saved_at || '-'}`);
    });
  }

  // ── 4. 업로드 로그로 원본 대조 ────────────────────────────
  const logs = await q('settlement_upload_logs',
    supabase.from('settlement_upload_logs').select('*').gte('period', WEEK_FROM).lte('period', WEEK_TO).order('period'));
  console.log(`\n[4] settlement_upload_logs — 정산주 업로드 기록 (${logs.length}건)`);
  console.log('    각 날짜 원본에 이 기사가 있었는지 = 진짜 소실 판정 기준');
  logs.forEach(log => {
    const matched = Array.isArray(log.matched_records) ? log.matched_records : [];
    const applied = Array.isArray(log.applied_records) ? log.applied_records : [];
    const unm = Array.isArray(log.unmatched_records) ? log.unmatched_records : [];
    const findIn = arr => arr.filter(r => {
      const n = norm(r.name) + norm(r.rawName) + norm(r.driverName);
      const bid = norm(r.baeminUserId || r.baeminId || '');
      return n.includes(norm(NAME)) || (baeminIds.length && baeminIds.includes(bid));
    });
    const inM = findIn(matched);
    const inA = findIn(applied);
    const inU = findIn(unm);
    const mark = (inM.length || inA.length || inU.length) ? '★' : ' ';
    console.log(`  ${mark} ${log.period} ${String(log.platform).padEnd(7)} status=${String(log.status).padEnd(18)} 매칭 ${matched.length} / 반영 ${applied.length} / 미매칭 ${unm.length}`);
    if (inM.length) console.log(`        → matched_records 에 있음: 콜 ${inM.map(r => r.orderCount).join(',')} 정산 ${inM.map(r => money(r.settlementAmount)).join(',')}`);
    if (inA.length) console.log(`        → applied_records 에 있음: 콜 ${inA.map(r => r.orderCount).join(',')} 정산 ${inA.map(r => money(r.settlementAmount)).join(',')}`);
    if (inU.length) console.log(`        → unmatched_records 에 있음: 콜 ${inU.map(r => r.orderCount).join(',')} 정산 ${inU.map(r => money(r.settlementAmount)).join(',')}`);
  });

  // ── 5. 출금 신청 내역 ─────────────────────────────────────
  const reqBlob = await readSetting('brem_payroll_withdrawal_requests_v1');
  const requests = Array.isArray(reqBlob) ? reqBlob : (Array.isArray(reqBlob?.requests) ? reqBlob.requests : []);
  const myReq = requests.filter(r => driverIds.includes(String(r.driverId)) || norm(r.driverName).includes(norm(NAME)));
  console.log(`\n[5] 출금 신청 내역 (전체 ${requests.length}건 중 이 기사 ${myReq.length}건)`);
  if (!myReq.length) {
    console.log('  이 기사의 출금 신청 없음 → 재매칭이 기존 출금에 영향 줄 대상 자체가 없음.');
  } else {
    myReq.forEach(r => {
      console.log(`  ${r.weekStart || '-'} ${String(r.platform || '').padEnd(7)} ${String(r.status).padEnd(10)} 신청 ${money(r.amount)} 수수료 ${money(r.fee)} 신청시한도 ${r.availableAtRequest != null ? money(r.availableAtRequest) : '기록없음'}`);
      console.log(`      요청=${r.createdAt || '-'} 처리=${r.completedAt || r.updatedAt || '-'}`);
    });
  }

  // ── 6. 급여 일정산 제외 목록에 걸려있는지 ─────────────────
  const excluded = await readSetting('brem_payroll_daily_excluded_settlements_v1');
  const exList = Array.isArray(excluded) ? excluded : (Array.isArray(excluded?.ids) ? excluded.ids : []);
  const myEx = exList.filter(id => driverIds.some(d => String(id).startsWith(`${d}-`)));
  console.log(`\n[6] 일정산 제외 목록 (전체 ${exList.length}건 중 이 기사 ${myEx.length}건)`);
  myEx.forEach(id => console.log(`  제외됨: ${id}`));
  if (!myEx.length) console.log('  이 기사의 제외 건 없음 → 반영된 일정산은 전부 출금 대상에 포함.');

  // ── 7. 요약 ───────────────────────────────────────────────
  console.log('\n' + '='.repeat(74));
  console.log(' 요약');
  console.log('='.repeat(74));
  const weekSettled = settled.filter(r => r.period >= WEEK_FROM && r.period <= WEEK_TO);
  const dates = [...new Set(weekSettled.map(r => r.period))].sort();
  console.log(`  정산주 내 반영된 날짜 (${dates.length}일): ${dates.join(', ') || '없음'}`);
  console.log(`  정산주 내 남은 미매칭 날짜: ${[...new Set(mine.map(u => u.period))].sort().join(', ') || '없음'}`);
  console.log(`  정산주 반영 정산액 합계: ${money(weekSettled.reduce((s, r) => s + Number(r.settlement_amount || 0), 0))}`);
  console.log(`  이 기사 출금 신청: ${myReq.length}건`);
  console.log('\n※ 이 스크립트는 아무것도 쓰지 않았습니다.');
})().catch(error => die('예상치 못한 오류', error.stack || error.message));

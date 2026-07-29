#!/usr/bin/env node
/**
 * "재반영" 위험도 진단 (읽기 전용)
 *
 * 배경
 *   재반영은 급여 일정산 포함/제외 플래그를 이렇게 다시 쓴다.
 *     eligible = (그 업로드 로그의 모든 기사가 현재 "포함" 상태인가?)
 *     → setPayrollDailyEligibleForRecords(로그의 모든 기사, eligible)
 *
 *   그래서 한 로그 안에 제외된 기사가 단 1명이라도 있으면
 *   eligible=false 가 되어 그 로그의 기사 전원이 제외로 바뀐다.
 *   (섞인 로그 = 위험. 전원 포함 또는 전원 제외 로그는 변화 없음.)
 *
 * 이 스크립트는 어떤 로그가 그 상태인지, 금액이 얼마인지만 보고한다.
 * 쓰기는 하지 않는다.
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
const normPlatform = p => (String(p || '').toLowerCase() === 'baemin' ? 'baemin' : 'coupang');

async function fetchAll(table, select) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + size - 1);
    if (error) die(`${table} 조회 실패 (offset ${from})`, error.message);
    rows.push(...(data || []));
    if (!data || data.length < size) break;
  }
  const { count, error: cErr } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (cErr) die(`${table} 건수 조회 실패`, cErr.message);
  if (count != null && rows.length !== count) {
    die(`${table} 일부만 읽혔습니다. (읽음 ${rows.length} / 실제 ${count})`);
  }
  return rows;
}

(async () => {
  const { data: exRow, error: exErr } = await supabase
    .from('settings').select('value').eq('key', 'brem_payroll_daily_excluded_settlements_v1').maybeSingle();
  if (exErr) die('제외 목록 조회 실패', exErr.message);
  const raw = exRow?.value;
  const exIds = new Set(Array.isArray(raw) ? raw : (Array.isArray(raw?.ids) ? raw.ids : []));

  const logs = await fetchAll('settlement_upload_logs', '*');
  const settlements = await fetchAll('daily_settlements', 'id,driver_id,period,platform,settlement_amount');
  const amountById = new Map(settlements.map(r => [r.id, Number(r.settlement_amount || 0)]));

  console.log('='.repeat(78));
  console.log(' "재반영" 위험도 진단 (읽기 전용)');
  console.log('='.repeat(78));
  console.log(`  제외 목록 등록 건수 : ${exIds.size}건`);
  console.log(`  업로드 로그         : ${logs.length}건`);
  console.log(`  일정산 반영 행      : ${settlements.length}건`);

  const risky = [];
  logs.forEach(log => {
    const period = String(log.period || '').slice(0, 10);
    const platform = normPlatform(log.platform);
    const recs = (Array.isArray(log.applied_records) && log.applied_records.length)
      ? log.applied_records
      : (Array.isArray(log.matched_records) ? log.matched_records : []);
    if (!recs.length) return;

    const ids = recs.map(r => `${r.driverId}-${period}-${platform}`);
    const excluded = ids.filter(id => exIds.has(id));
    const included = ids.filter(id => !exIds.has(id));
    // 섞인 로그만 위험: every() 가 false → 전원 제외로 뒤집힌다
    if (excluded.length > 0 && included.length > 0) {
      const lossAmount = included.reduce((s, id) => s + (amountById.get(id) || 0), 0);
      risky.push({
        logId: log.id, period, platform,
        fileName: log.file_name || '',
        status: log.status,
        total: ids.length,
        excluded: excluded.length,
        included: included.length,
        lossAmount
      });
    }
  });

  console.log('\n' + '-'.repeat(78));
  if (!risky.length) {
    console.log(' [안전] 제외 기사와 포함 기사가 섞인 업로드 로그가 없습니다.');
    console.log('        지금은 어떤 로그를 재반영해도 포함/제외 상태가 뒤집히지 않습니다.');
  } else {
    console.log(` [위험] 섞인 로그 ${risky.length}건 — 재반영하면 포함 기사까지 전원 제외로 바뀝니다.`);
    console.log('-'.repeat(78));
    risky.sort((a, b) => b.lossAmount - a.lossAmount);
    risky.forEach(r => {
      console.log(`  ${r.period} ${r.platform.padEnd(7)} status=${r.status}`);
      console.log(`     전체 ${r.total}명 = 이미제외 ${r.excluded}명 + 현재포함 ${r.included}명`);
      console.log(`     재반영 시 새로 제외될 금액: ${money(r.lossAmount)}  (기사 ${r.included}명)`);
      console.log(`     logId=${r.logId} ${r.fileName ? '· ' + r.fileName : ''}`);
    });
    const total = risky.reduce((s, r) => s + r.lossAmount, 0);
    console.log('-'.repeat(78));
    console.log(`  섞인 로그 전체 재반영 시 제외될 금액 합계: ${money(total)}`);
  }

  console.log('\n※ 이 스크립트는 아무것도 쓰지 않았습니다.');
})().catch(error => die('예상치 못한 오류', error.stack || error.message));

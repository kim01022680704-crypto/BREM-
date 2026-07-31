#!/usr/bin/env node
/**
 * 직계약(정산결과) 급여명세서 전부 '미반영(숨김)'으로 되돌린다.
 *
 *   node scripts/_unpublish-direct-payslips.js           ← 미리보기(쓰기 없음)
 *   node scripts/_unpublish-direct-payslips.js --apply    ← 실제 미반영 처리
 *
 * 배경
 *  - 정산주(수~화) off-by-one 교정 배포 후, 예전에 잘못된 주차로 이미 라이더앱에
 *    노출된 직계약 급여명세서를 감춘다. (rider_published_at = null)
 *  - 이후 관리자가 각 주차에서 「급여명세서 반영」(대기 저장) → 「급여명세서 반영하기」
 *    (라이더앱 공개) 를 다시 눌러 올바른 주차로 재공개한다.
 *
 * 안전장치
 *  1) 기본은 미리보기. --apply 없이는 절대 쓰지 않는다.
 *  2) 직계약 행(upload_id 가 'direct-' 로 시작하거나 raw_data.source==='direct')만 대상.
 *  3) 이미 미반영(rider_published_at=null)인 행은 건드리지 않는다.
 *  4) 금액/주차 등 다른 값은 절대 바꾸지 않는다. rider_published_at 만 null 로.
 */
const path = require('path');
const fs = require('fs');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try { require('dotenv').config({ path: envPath }); return; } catch (_) { /* 수동 파싱 */ }
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

function die(msg, detail) {
  console.error(`\n[중단] ${msg}`);
  if (detail) console.error(`       ${detail}`);
  process.exit(2);
}

const APPLY = process.argv.includes('--apply');
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL) die('SUPABASE_URL 이 없습니다. (.env 확인)');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY 가 없습니다. (.env 확인)');

let createClient;
try { ({ createClient } = require('@supabase/supabase-js')); }
catch (_) { die('@supabase/supabase-js 를 불러오지 못했습니다. npm install 후 다시 시도하세요.'); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function isDirectLine(row) {
  const uploadId = String(row.upload_id || '');
  if (uploadId.startsWith('direct-')) return true;
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return String(raw.source || '') === 'direct';
}

function weekOf(row) {
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return String(raw.settlementWeekStart || raw.settlementWeekPayKey || '').slice(0, 10) || '(주차없음)';
}

(async () => {
  console.log(`\n=== 직계약 급여명세서 미반영 처리 (${APPLY ? '실제 적용' : '미리보기'}) ===`);

  let all = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('payroll_slip_lines')
      .select('id,upload_id,driver_id,rider_name,rider_published_at,raw_data')
      .order('updated_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) die('payroll_slip_lines 조회 실패', error.message);
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
  }

  const directRows = all.filter(isDirectLine);
  const target = directRows.filter(row => row.rider_published_at != null);

  const byWeek = {};
  target.forEach(row => { const w = weekOf(row); byWeek[w] = (byWeek[w] || 0) + 1; });

  console.log(`\n전체 급여명세서 행: ${all.length}`);
  console.log(`직계약 행: ${directRows.length} (이미 미반영 ${directRows.length - target.length} / 공개중 ${target.length})`);
  console.log('\n[미반영 처리 대상 주차별 건수]');
  Object.keys(byWeek).sort().forEach(w => console.log(`  ${w}(수) : ${byWeek[w]}건`));

  if (!target.length) {
    console.log('\n미반영으로 되돌릴 공개중 직계약 명세서가 없습니다.');
    return;
  }

  if (!APPLY) {
    console.log(`\n미리보기입니다. 실제로 숨기려면 --apply 를 붙여 다시 실행하세요.`);
    return;
  }

  const now = new Date().toISOString();
  const ids = target.map(r => r.id);
  let done = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error } = await supabase
      .from('payroll_slip_lines')
      .update({ rider_published_at: null, updated_at: now })
      .in('id', chunk);
    if (error) die('미반영 처리(update) 실패', error.message);
    done += chunk.length;
    console.log(`  ...${done}/${ids.length} 처리`);
  }

  console.log(`\n완료: ${done}건을 미반영(숨김)으로 되돌렸습니다.`);
  console.log('이제 라이더앱에서는 직계약 명세서가 보이지 않습니다.');
  console.log('각 주차에서 「급여명세서 반영」(대기) → 「급여명세서 반영하기」(공개) 를 다시 눌러 올바른 주차로 공개하세요.');
})();

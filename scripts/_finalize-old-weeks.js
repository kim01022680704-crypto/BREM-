#!/usr/bin/env node
/**
 * 선정산 시작 이전 정산주 마감처리 (기본: 미리보기 / --apply 시에만 실제 반영)
 *
 *   node scripts/_finalize-old-weeks.js 2026-07-22            ← 미리보기
 *   node scripts/_finalize-old-weeks.js 2026-07-22 --apply    ← 실제 반영
 *
 * 인자로 준 정산주(선정산 시작 주) '이전' 주차를 모두 마감 처리한다.
 * 마감된 주는 서버가 출금가능금액을 0 으로 강제한다.
 *   server/rider-withdrawal.js: availableAmount = weekFinalized ? 0 : rawAvailable
 * 즉 그 주의 일정산이 남아 있어도 출금이 생기지 않는다.
 *
 * 안전 장치
 *  1) 기본은 미리보기. --apply 없이는 절대 쓰지 않는다.
 *  2) 기준 주 자신과 그 이후 주차는 절대 마감하지 않는다.
 *  3) 기존 마감 기록은 그대로 보존한다. (덮어쓰지 않고 없는 주만 추가)
 *  4) 일정산이 실제로 존재하는 주차만 대상으로 한다.
 *  5) 되돌리기: 관리자 화면에서 마감 해제하거나, 아래 백업 JSON 을 되돌린다.
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

const FINALIZED_WEEKS_KEY = 'brem_payroll_week_finalized_v1';
const APPLY = process.argv.includes('--apply');
const CUTOFF = (process.argv.slice(2).find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '').trim();
if (!CUTOFF) die('선정산 시작 정산주(수요일)를 넣어주세요.', '예: node scripts/_finalize-old-weeks.js 2026-07-22');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) die('SUPABASE 환경변수가 없습니다.');

let createClient;
try { ({ createClient } = require('@supabase/supabase-js')); }
catch (error) { die('@supabase/supabase-js 로드 실패', error.message); }
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;

function dateKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function weekStartOf(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
  return dateKey(d);
}
function weekEndOf(weekStart) {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + 6);
  return dateKey(d);
}

// Supabase 는 한 번에 1000행만 준다. 끝까지 넘겨 읽어야 주차 목록이 안 빠진다.
async function fetchAll(table, columns) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1);
    if (error) die(`${table} 조회 실패`, error.message);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

(async () => {
  if (weekStartOf(CUTOFF) !== CUTOFF) die(`${CUTOFF} 는 정산주 시작일(수요일)이 아닙니다.`, `해당 주 시작일: ${weekStartOf(CUTOFF)}`);

  console.log('='.repeat(76));
  console.log(` ${CUTOFF} 이전 정산주 마감처리 — ${APPLY ? '### 실제 반영 ###' : '미리보기 (쓰기 없음)'}`);
  console.log('='.repeat(76));

  const settled = await fetchAll('daily_settlements', 'period,settlement_amount');
  console.log(`\n일정산 ${settled.length}건 읽음`);

  const byWeek = new Map();
  settled.forEach(r => {
    const wk = weekStartOf(String(r.period).slice(0, 10));
    if (!byWeek.has(wk)) byWeek.set(wk, { count: 0, amount: 0 });
    const acc = byWeek.get(wk);
    acc.count += 1;
    acc.amount += Number(r.settlement_amount || 0);
  });

  const { data: finRow, error: finErr } = await supabase
    .from('settings').select('value').eq('key', FINALIZED_WEEKS_KEY).maybeSingle();
  if (finErr) die('마감 정산주 조회 실패', finErr.message);
  let existing = finRow?.value ?? [];
  if (typeof existing === 'string') { try { existing = JSON.parse(existing); } catch (_) { existing = []; } }
  if (!Array.isArray(existing)) die('마감 목록 형식이 배열이 아닙니다.', `실제: ${typeof existing}`);

  const existingSet = new Set(existing
    .map(w => String(typeof w === 'string' ? w : (w?.weekStart || '')).slice(0, 10)).filter(Boolean));

  console.log(`기존 마감 주차 ${existingSet.size}개: ${existingSet.size ? [...existingSet].sort().join(', ') : '없음'}`);

  const finalizedAt = new Date().toISOString();
  const toAdd = [];
  console.log('\n' + '-'.repeat(76));
  console.log(' 정산주 현황');
  console.log('-'.repeat(76));
  [...byWeek.keys()].sort().forEach(wk => {
    const info = byWeek.get(wk);
    const already = existingSet.has(wk);
    let mark;
    if (wk >= CUTOFF) mark = wk === CUTOFF ? '건드리지 않음 (선정산 시작 주)' : '건드리지 않음 (이후 주)';
    else if (already) mark = '이미 마감됨';
    else { mark = '→ 마감 추가'; toAdd.push(wk); }
    console.log(`  ${wk} ~ ${weekEndOf(wk)}  ${String(info.count).padStart(5)}건 · ${money(info.amount).padStart(15)}   ${mark}`);
  });

  console.log('-'.repeat(76));
  console.log(`  마감 추가할 주차 ${toAdd.length}개: ${toAdd.join(', ') || '없음'}`);
  console.log('\n  마감하면 그 주 출금가능금액이 0 으로 강제됩니다.');
  console.log('  (일정산 데이터는 그대로 남습니다. 통계·급여명세서에는 계속 보입니다)');

  if (!toAdd.length) {
    console.log('\n추가할 주차가 없습니다.');
    return;
  }

  if (!APPLY) {
    console.log('\n미리보기입니다. 실제 반영하려면 --apply 를 붙여 다시 실행하세요.');
    return;
  }

  // 되돌릴 수 있게 기존 값을 파일로 백업한다.
  const backupPath = path.join(__dirname, `_backup-finalized-weeks-${finalizedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(existing, null, 2), 'utf8');
  console.log(`\n기존 마감 목록 백업: ${path.basename(backupPath)}`);

  const next = existing.concat(toAdd.map(wk => ({
    weekStart: wk,
    weekEnd: weekEndOf(wk),
    finalizedAt,
    note: `선정산 시작(${CUTOFF}) 이전 주차 일괄 마감`
  })));

  const { error: wErr } = await supabase
    .from('settings')
    .upsert({ key: FINALIZED_WEEKS_KEY, value: next }, { onConflict: 'key' });
  if (wErr) die('마감 목록 저장 실패', wErr.message);

  // 저장 후 재확인
  const { data: check, error: cErr } = await supabase
    .from('settings').select('value').eq('key', FINALIZED_WEEKS_KEY).maybeSingle();
  if (cErr) die('저장 후 확인 실패', cErr.message);
  let saved = check?.value ?? [];
  if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch (_) { saved = []; } }
  const savedSet = new Set((Array.isArray(saved) ? saved : [])
    .map(w => String(typeof w === 'string' ? w : (w?.weekStart || '')).slice(0, 10)).filter(Boolean));

  console.log('\n' + '='.repeat(76));
  console.log(` 마감 완료 — 총 ${savedSet.size}개 주차`);
  [...savedSet].sort().forEach(wk => console.log(`   ${wk} ~ ${weekEndOf(wk)}`));
  const missing = toAdd.filter(wk => !savedSet.has(wk));
  if (missing.length) die('일부 주차가 저장되지 않았습니다.', missing.join(', '));
  if (savedSet.has(CUTOFF)) die(`선정산 시작 주(${CUTOFF})가 마감 목록에 들어갔습니다.`, '즉시 확인이 필요합니다.');
  console.log(`\n ${CUTOFF} 은 마감되지 않았습니다. (정상)`);
})().catch(error => die('예상치 못한 오류', error.stack || error.message));

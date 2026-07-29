#!/usr/bin/env node
/**
 * 매칭 가능한 미매칭 건을 지금 반영해도 되는지 위험 점검 (읽기 전용)
 *
 * 과거 정산주에 일정산을 새로 넣으면 그 주의 출금가능금액이 늘어난다.
 * 이미 마감·지급이 끝난 주라면 이중지급 위험이 있으므로, 반영 전에
 *   1) 해당 정산주가 마감(finalized) 됐는지
 *   2) 그 기사가 그 주에 이미 출금을 했는지 (했다면 정산이 끝난 주)
 * 를 확인한다.
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
if (!SUPABASE_URL || !SERVICE_KEY) die('SUPABASE 환경변수가 없습니다.');

let createClient;
try { ({ createClient } = require('@supabase/supabase-js')); }
catch (error) { die('@supabase/supabase-js 로드 실패', error.message); }
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const norm = s => String(s || '').replace(/\s+/g, '').trim();
const lower = s => norm(s).toLowerCase();

// 수요일 시작 정산주
function weekStart(dateKey) {
  const d = new Date(`${String(dateKey).slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7));
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 키가 없거나 형식이 다르면 빈 값으로 넘기지 않고 즉시 중단한다.
// 조용히 0건으로 읽히면 "위험 없음" 이라는 잘못된 결론이 나온다.
async function readSettingArray(key, { required = true } = {}) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) die(`settings(${key}) 조회 실패`, error.message);
  if (!data) {
    if (required) die(`settings 에 ${key} 가 없습니다.`, '키 이름이 바뀌었는지 확인이 필요합니다. 위험 판정을 신뢰할 수 없어 중단합니다.');
    return [];
  }
  let v = data.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* 그대로 */ } }
  if (!Array.isArray(v)) die(`settings(${key}) 형식이 배열이 아닙니다.`, `실제 형식: ${typeof v}`);
  return v;
}

(async () => {
  console.log('='.repeat(76));
  console.log(' 미매칭 반영 위험 점검 (읽기 전용)');
  console.log('='.repeat(76));

  const { data: riders, error: rErr } = await supabase.from('riders').select('id,name,baemin_id,phone');
  if (rErr) die('riders 조회 실패', rErr.message);
  const { data: unmatched, error: uErr } = await supabase.from('settlement_unmatched').select('*').eq('kind', 'daily').eq('platform', 'baemin');
  if (uErr) die('settlement_unmatched 조회 실패', uErr.message);

  // 서버(server/rider-withdrawal.js)가 실제로 쓰는 키를 그대로 사용한다.
  const finalized = await readSettingArray('brem_payroll_week_finalized_v1', { required: false });
  const requests = await readSettingArray('brem_payroll_withdrawal_requests_v1');
  const excluded = await readSettingArray('brem_payroll_daily_excluded_settlements_v1', { required: false });

  const finalizedSet = new Set(
    finalized.map(w => String(typeof w === 'string' ? w : (w?.weekStart || '')).slice(0, 10)).filter(Boolean)
  );
  const excludedSet = new Set(
    excluded.map(e => String(typeof e === 'string' ? e : (e?.id || '')).trim()).filter(Boolean)
  );

  console.log(`\n마감된 정산주: ${finalizedSet.size ? [...finalizedSet].join(', ') : '없음'}`);
  console.log(`출금 신청 총 ${requests.length}건 · 제외 처리된 정산 ${excludedSet.size}건`);
  // 검수 스크립트가 본 규모와 크게 다르면 키·형식이 어긋난 것이다.
  if (!requests.length) die('출금 신청이 0건으로 읽혔습니다.', '실제로는 존재하므로 키·형식 확인이 필요합니다. 위험 판정을 신뢰할 수 없어 중단합니다.');

  // 배민ID → 기사 (중복 제외)
  const byBaemin = new Map(); const dupe = new Set();
  riders.forEach(d => {
    const k = lower(d.baemin_id); if (!k) return;
    if (byBaemin.has(k)) dupe.add(k);
    byBaemin.set(k, d);
  });

  // 기사+주차 → 출금 신청
  const reqByDriverWeek = new Map();
  requests.forEach(r => {
    const k = `${String(r.driverId || '')}|${String(r.weekStart || '').slice(0, 10)}`;
    if (!reqByDriverWeek.has(k)) reqByDriverWeek.set(k, []);
    reqByDriverWeek.get(k).push(r);
  });

  const rows = [];
  unmatched.forEach(u => {
    const k = lower(u.baemin_user_id);
    if (!k || dupe.has(k)) return;
    const driver = byBaemin.get(k);
    if (!driver) return;
    const period = String(u.period).slice(0, 10);
    const wk = weekStart(period);
    const reqs = reqByDriverWeek.get(`${driver.id}|${wk}`) || [];
    const settledId = `${driver.id}-${period}-baemin`;
    rows.push({
      driver, period, wk,
      amount: Number(u.settlement_amount ?? u.delivery_amount ?? 0),
      finalized: finalizedSet.has(wk),
      excluded: excludedSet.has(settledId),
      reqCount: reqs.length,
      reqDone: reqs.filter(r => r.status === 'completed').length,
      reqAmount: reqs.reduce((s, r) => s + Number(r.amount || 0), 0)
    });
  });

  // 주차별 묶음
  const byWeek = new Map();
  rows.forEach(r => {
    if (!byWeek.has(r.wk)) byWeek.set(r.wk, []);
    byWeek.get(r.wk).push(r);
  });

  console.log('\n' + '-'.repeat(76));
  console.log(' 정산주별 위험도');
  console.log('-'.repeat(76));

  const safe = []; const needsDecision = [];

  [...byWeek.keys()].sort().forEach(wk => {
    const list = byWeek.get(wk);
    const total = list.reduce((s, r) => s + r.amount, 0);
    const isFinal = list[0].finalized;
    const withPayout = list.filter(r => r.reqDone > 0);
    console.log(`\n  ${wk} 정산주 — ${list.length}건 · ${money(total)}${isFinal ? '  [마감됨]' : ''}`);
    list.sort((a, b) => b.amount - a.amount).forEach(r => {
      const flags = [];
      if (r.finalized) flags.push('주마감');
      if (r.excluded) flags.push('제외처리됨');
      if (r.reqDone > 0) flags.push(`이미출금 ${r.reqDone}건 ${money(r.reqAmount)}`);
      else if (r.reqCount > 0) flags.push(`출금신청중 ${r.reqCount}건`);
      console.log(`    ${r.period} ${r.driver.name.padEnd(8)} ${money(r.amount).padStart(11)}${flags.length ? '   ⚠ ' + flags.join(' · ') : '   출금이력 없음'}`);
      if (flags.length) needsDecision.push(r); else safe.push(r);
    });
    if (withPayout.length) {
      console.log(`    → 이 주에 이미 출금한 기사 ${withPayout.length}명. 반영하면 그만큼 추가 출금이 가능해집니다.`);
    }
  });

  console.log('\n' + '='.repeat(76));
  console.log(' 판정');
  console.log('='.repeat(76));
  console.log(`  바로 반영해도 안전 (출금이력·마감·제외 전부 없음): ${safe.length}건 · ${money(safe.reduce((s, r) => s + r.amount, 0))}`);
  console.log(`  판단 필요 (출금이력 있거나 마감/제외됨):          ${needsDecision.length}건 · ${money(needsDecision.reduce((s, r) => s + r.amount, 0))}`);
  if (needsDecision.length) {
    console.log('\n  판단 필요 목록:');
    needsDecision.forEach(r => console.log(`    ${r.period} ${r.driver.name} ${money(r.amount)}`));
  }
  console.log('\n※ 이 스크립트는 아무것도 쓰지 않았습니다.');
})().catch(error => die('예상치 못한 오류', error.stack || error.message));

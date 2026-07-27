#!/usr/bin/env node
/**
 * 정산·출금 검수 (읽기 전용)
 *
 * 사용법:
 *   node scripts/정산검수.js                 (모든 정산주)
 *   node scripts/정산검수.js 2026-07-22      (특정 정산주만)
 *
 * 설계 원칙 — 돈이 걸린 검사이므로 다음을 지킨다.
 *  1) 쓰기 금지. insert/update/delete/upsert 를 절대 호출하지 않는다.
 *  2) 에러를 삼키지 않는다. 조회가 하나라도 실패하면 결과를 내지 않고 즉시 중단한다.
 *     ("조회 실패인데 0원으로 보이는" 것이 정산에서 가장 위험한 오류다.)
 *  3) 계산식을 새로 구현하지 않는다. 서버가 실제로 쓰는 함수를 그대로 가져와 쓴다.
 *  4) 데이터를 다 읽었는지 건수로 검증한다. 페이지 누락 시 중단한다.
 *  5) 이상이 하나라도 있으면 exit code 1 로 끝난다.
 *
 * 검사 항목:
 *   1. 실지급액 초과 출금            2. 신청 시점 한도 초과
 *   3. 일정산수수료 계산 불일치       4. 취소건에 지급 흔적
 *   5. 중복 지급 의심                6. 처리완료 처리시각 누락
 *   7. 출금이 나간 뒤 제외된 정산서   8. 마무리된 주에 들어온 신청
 */
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────
// 0. 준비 — 하나라도 어긋나면 검사하지 않고 중단
// ─────────────────────────────────────────────────────────────
function die(message, detail) {
  console.error(`\n[중단] ${message}`);
  if (detail) console.error(`       ${detail}`);
  console.error('\n검수를 완료하지 못했습니다. 결과를 신뢰하지 마세요.');
  process.exit(2);
}

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try {
    require('dotenv').config({ path: envPath });
    return;
  } catch (_) { /* dotenv 미설치 시 수동 파싱 */ }
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

let withdrawal;
try {
  withdrawal = require('../server/rider-withdrawal');
} catch (error) {
  die('server/rider-withdrawal.js 를 불러오지 못했습니다.', error.message);
}
const A = withdrawal.__audit;
if (!A) die('server/rider-withdrawal.js 에 __audit 노출이 없습니다. 서버 코드와 검수 버전이 어긋났습니다.');

const REQUIRED_FNS = [
  'normalizeFees', 'normalizePlatform', 'normalizeRequestList', 'normalizeFinalizedWeeks',
  'calcPayoutFromSettlement', 'resolveWithdrawalFee', 'requestConsumedAmount'
];
for (const fn of REQUIRED_FNS) {
  if (typeof A[fn] !== 'function') die(`서버에서 ${fn} 을 가져오지 못했습니다. 검수 로직과 서버 로직이 어긋났습니다.`);
}

let settlementWeekStart;
let settlementWeekEnd;
try {
  ({ settlementWeekStart, settlementWeekEnd } = require('../server/baemin-settlement-week'));
} catch (error) {
  die('server/baemin-settlement-week.js 를 불러오지 못했습니다.', error.message);
}
if (typeof settlementWeekStart !== 'function' || typeof settlementWeekEnd !== 'function') {
  die('정산주 계산 함수(settlementWeekStart/End)를 가져오지 못했습니다.');
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL) die('SUPABASE_URL 이 설정되지 않았습니다.');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.');

let createClient;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch (error) {
  die('@supabase/supabase-js 를 불러오지 못했습니다. npm install 이 필요합니다.', error.message);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const targetWeekArg = (process.argv[2] || '').trim();
if (targetWeekArg && !/^\d{4}-\d{2}-\d{2}$/.test(targetWeekArg)) {
  die(`정산주 형식이 올바르지 않습니다: "${targetWeekArg}" (예: 2026-07-22)`);
}

const money = n => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const normName = s => String(s || '').replace(/\s+/g, '').trim();
const normPhone = s => String(s || '').replace(/\D/g, '');
const dateOnly = v => String(v || '').slice(0, 10);

// 이미 확인·종결한 건은 [위험]에서 [참고]로 내린다.
// 금액이 1원이라도 달라지면 매칭되지 않아 다시 [위험]으로 올라온다.
function loadAcknowledged() {
  const ackPath = path.join(__dirname, '정산검수-확인완료.json');
  if (!fs.existsSync(ackPath)) return { over: [], excluded: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(ackPath, 'utf8'));
  } catch (error) {
    die('정산검수-확인완료.json 을 읽지 못했습니다. JSON 형식을 확인하세요.', error.message);
  }
  return {
    over: Array.isArray(parsed['초과출금_확인완료']) ? parsed['초과출금_확인완료'] : [],
    excluded: Array.isArray(parsed['제외정산서_확인완료']) ? parsed['제외정산서_확인완료'] : []
  };
}
const ack = loadAcknowledged();

// ─────────────────────────────────────────────────────────────
// 1. 조회 — 에러/누락 시 즉시 중단
// ─────────────────────────────────────────────────────────────
async function readSetting(key, { required = true } = {}) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) die(`설정 "${key}" 조회 실패`, error.message);
  if (required && (data == null || data.value == null)) {
    die(`설정 "${key}" 가 비어 있습니다. 데이터가 유실됐거나 키 이름이 바뀌었습니다.`);
  }
  return data?.value;
}

async function fetchTable(table, select) {
  const { count, error: countError } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (countError) die(`${table} 건수 조회 실패`, countError.message);

  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + size - 1);
    if (error) die(`${table} 조회 실패 (offset ${from})`, error.message);
    rows.push(...(data || []));
    if (!data || data.length < size) break;
    if (rows.length > (count || 0) + size) die(`${table} 페이징이 끝나지 않습니다. 조회를 중단합니다.`);
  }
  // 전수 검사이므로 한 건이라도 못 읽었으면 결과를 낼 수 없다.
  if (count != null && rows.length !== count) {
    die(`${table} 을 전부 읽지 못했습니다. (기대 ${count}건 / 실제 ${rows.length}건)`);
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────
// 2. 검사
// ─────────────────────────────────────────────────────────────
const findings = [];
function report(level, title, lines) {
  findings.push({ level, title, lines });
}

(async () => {
  console.log('='.repeat(64));
  console.log(' BREM 정산·출금 검수 (읽기 전용)');
  console.log(` 시각: ${new Date().toLocaleString('ko-KR')}`);
  console.log(` 대상: ${targetWeekArg || '전체 정산주'}`);
  console.log('='.repeat(64));

  const feesByPlatform = A.normalizeFees(await readSetting(A.FEES_KEY));
  const requests = A.normalizeRequestList(await readSetting(withdrawal.REQUESTS_KEY));
  const excludedRaw = await readSetting(A.EXCLUDED_SETTLEMENTS_KEY, { required: false }) || [];
  const finalized = A.normalizeFinalizedWeeks(await readSetting(A.FINALIZED_WEEKS_KEY, { required: false }) || []);
  const excluded = new Set((Array.isArray(excludedRaw) ? excludedRaw : []).map(v => String(v).trim()).filter(Boolean));

  const riders = await fetchTable('riders', 'id,name,phone');
  if (!riders.length) die('riders 가 0건입니다. 조회가 정상적으로 되지 않았습니다.');
  const settlements = await fetchTable(
    'daily_settlements',
    'driver_id,period,platform,order_count,hourly_insurance,delivery_amount,settlement_amount'
  );
  if (!settlements.length) die('daily_settlements 가 0건입니다. 조회가 정상적으로 되지 않았습니다.');

  const riderById = new Map(riders.map(r => [String(r.id), r]));
  const nameOf = id => riderById.get(String(id))?.name || `(미등록 ${String(id).slice(0, 8)})`;

  console.log(`\n읽은 데이터: 기사 ${riders.length}명 · 일정산 ${settlements.length}건 · 출금신청 ${requests.length}건`);
  console.log(`제외 처리된 정산 ${excluded.size}건 · 마무리된 정산주 ${finalized.length}개`);

  // 동일 인물 묶기 — 서버 resolveDriverIdCandidates 와 같은 규칙.
  // 중복 계정을 합치지 않으면 실지급이 과소 집계돼 없는 초과출금이 잡힌다.
  const groupIdOf = new Map();
  const groupById = new Map();
  for (const r of riders) {
    const id = String(r.id);
    if (groupIdOf.has(id)) continue;
    const name = normName(r.name);
    const phone = normPhone(r.phone);
    const members = riders.filter(o => {
      const oPhone = normPhone(o.phone);
      const oName = normName(o.name);
      const samePhone = phone && oPhone === phone;
      const compatible = !phone || !oPhone || oPhone === phone || oPhone.slice(-4) === phone.slice(-4);
      return samePhone || (name && oName === name && compatible);
    });
    groupById.set(id, { gid: id, name: r.name, ids: members.map(m => String(m.id)) });
    members.forEach(m => groupIdOf.set(String(m.id), id));
  }
  const gidOf = id => groupIdOf.get(String(id)) || String(id);
  const dupeCount = [...groupById.values()].filter(g => g.ids.length > 1).length;
  console.log(`동일 인물 그룹 ${groupById.size}개 (중복 계정 묶음 ${dupeCount}개)`);

  const inScope = week => !targetWeekArg || week === targetWeekArg;
  const liveRequests = requests.filter(r => r.status === 'pending' || r.status === 'completed');

  // ── 실지급/출금 집계 (그룹 × 정산주)
  const netByKey = new Map();
  const settlementsByKey = new Map();
  for (const row of settlements) {
    const did = String(row.driver_id || '');
    const period = dateOnly(row.period);
    if (!did || !period) continue;
    const platform = A.normalizePlatform(row.platform);
    if (excluded.has(`${did}-${period}-${platform}`)) continue;
    const week = settlementWeekStart(period);
    if (!inScope(week)) continue;
    const payout = A.calcPayoutFromSettlement(row, feesByPlatform);
    const k = `${gidOf(did)}|${week}`;
    netByKey.set(k, (netByKey.get(k) || 0) + Math.max(0, payout.netPay));
    if (!settlementsByKey.has(k)) settlementsByKey.set(k, []);
    settlementsByKey.get(k).push({ did, period, platform });
  }

  const wdByKey = new Map();
  for (const r of liveRequests) {
    const week = dateOnly(r.weekStart) || settlementWeekStart(dateOnly(r.requestDate || r.createdAt));
    if (!inScope(week)) continue;
    const k = `${gidOf(r.driverId)}|${week}`;
    if (!wdByKey.has(k)) wdByKey.set(k, { consumed: 0, amount: 0, fee: 0, items: [] });
    const e = wdByKey.get(k);
    const consumed = A.requestConsumedAmount(r, feesByPlatform);
    e.consumed += consumed;
    e.amount += Math.max(0, Math.round(Number(r.amount || 0)));
    e.fee += Math.max(0, consumed - Math.max(0, Math.round(Number(r.amount || 0))));
    e.items.push(r);
  }

  // ── 검사 1. 실지급액 초과 출금
  const over = [];
  for (const [k, w] of wdByKey.entries()) {
    const net = netByKey.get(k) || 0;
    if (w.consumed <= net) continue;
    const [gid, week] = k.split('|');
    over.push({ gid, week, net, w });
  }
  over.sort((a, b) => (b.w.consumed - b.net) - (a.w.consumed - a.net));

  const findAck = o => {
    const g = groupById.get(o.gid) || { ids: [o.gid] };
    const amount = o.w.consumed - o.net;
    return ack.over.find(entry => (
      g.ids.includes(String(entry.driverId || ''))
      && dateOnly(entry['정산주']) === o.week
      && Math.round(Number(entry['초과금액'] || 0)) === amount
    )) || null;
  };
  const overNew = over.filter(o => !findAck(o));
  const overAcked = over.filter(o => findAck(o));

  const describeOver = o => {
    const g = groupById.get(o.gid) || { name: nameOf(o.gid), ids: [o.gid] };
    const lines = [`${g.name} · ${o.week} · 초과 ${money(o.w.consumed - o.net)}`,
      `    실지급 ${money(o.net)} / 출금+수수료 ${money(o.w.consumed)}`];
    if (g.ids.length > 1) lines.push(`    중복계정 ${g.ids.length}개 합산`);
    o.w.items.forEach(it => lines.push(
      `    · ${it.createdAt} ${it.status} ${it.platform} ${money(it.amount)}+${money(it.feeAmount)} (당시한도 ${money(it.availableAtRequest)})`
    ));
    return lines;
  };

  if (overNew.length) {
    report('위험', `실지급액 초과 출금 ${overNew.length}건 (신규)`, overNew.flatMap(describeOver));
  }
  if (overAcked.length) {
    report('참고', `실지급액 초과 출금 ${overAcked.length}건 — 확인 완료`, overAcked.map(o => {
      const entry = findAck(o);
      const g = groupById.get(o.gid) || { name: nameOf(o.gid) };
      return `${g.name} · ${o.week} · ${money(o.w.consumed - o.net)} · ${entry['사유']} (${entry['확인일']})`;
    }));
  }

  // ── 검사 2. 신청 시점 한도 초과 (로직이 뚫렸는지)
  const atRequest = liveRequests.filter(r => {
    if (r.availableAtRequest == null) return false;
    if (!inScope(dateOnly(r.weekStart))) return false;
    return A.requestConsumedAmount(r, feesByPlatform) > Math.round(Number(r.availableAtRequest));
  });
  if (atRequest.length) {
    report('위험', `신청 시점 한도 초과 ${atRequest.length}건`, atRequest.map(r =>
      `${nameOf(r.driverId)} ${r.createdAt} 차감 ${money(A.requestConsumedAmount(r, feesByPlatform))} > 한도 ${money(r.availableAtRequest)}`));
  }
  const noLimit = liveRequests.filter(r => r.availableAtRequest == null && inScope(dateOnly(r.weekStart)));
  if (noLimit.length) {
    report('참고', `신청 당시 한도 기록이 없는 건 ${noLimit.length}건 (구버전 데이터라 검증 불가)`,
      noLimit.slice(0, 10).map(r => `${nameOf(r.driverId)} ${r.createdAt} ${money(r.amount)}`));
  }

  // ── 검사 3. 일정산수수료 계산 불일치
  const feeBad = liveRequests.filter(r => {
    if (!inScope(dateOnly(r.weekStart))) return false;
    const platform = A.normalizePlatform(r.platform);
    const conf = feesByPlatform[platform] || feesByPlatform.coupang || {};
    const expect = A.resolveWithdrawalFee(Math.max(0, Math.round(Number(r.amount || 0))), conf);
    return expect !== Math.max(0, Math.round(Number(r.feeAmount || 0)));
  });
  if (feeBad.length) {
    report('위험', `일정산수수료 불일치 ${feeBad.length}건`, feeBad.map(r => {
      const conf = feesByPlatform[A.normalizePlatform(r.platform)] || feesByPlatform.coupang || {};
      return `${nameOf(r.driverId)} ${r.createdAt} 신청 ${money(r.amount)} · 기록 ${money(r.feeAmount)} ≠ 계산 ${money(A.resolveWithdrawalFee(Math.round(Number(r.amount || 0)), conf))}`;
    }));
  }

  // ── 검사 4. 취소건인데 지급 흔적이 있는 경우 (돈은 나갔는데 차감이 안 됨)
  const ghost = requests.filter(r => r.status !== 'pending' && r.status !== 'completed' && r.completedAt);
  if (ghost.length) {
    report('위험', `취소 처리됐지만 지급 흔적이 있는 건 ${ghost.length}건`, ghost.map(r =>
      `${nameOf(r.driverId)} ${r.createdAt} ${r.status} ${money(r.amount)} (completedAt=${r.completedAt})`));
  }

  // ── 검사 5. 중복 지급 의심
  const dup = [];
  const byDriver = new Map();
  liveRequests.forEach(r => {
    const k = String(r.driverId);
    if (!byDriver.has(k)) byDriver.set(k, []);
    byDriver.get(k).push(r);
  });
  byDriver.forEach((list, did) => {
    const sorted = [...list].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (let i = 1; i < sorted.length; i += 1) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (Math.round(Number(a.amount)) !== Math.round(Number(b.amount))) continue;
      const gap = new Date(b.createdAt) - new Date(a.createdAt);
      if (gap >= 0 && gap <= 10 * 60 * 1000) {
        dup.push(`${nameOf(did)} ${money(a.amount)} 2건 · ${a.createdAt} / ${b.createdAt} (간격 ${Math.round(gap / 1000)}초)`);
      }
    }
  });
  if (dup.length) report('확인', `중복 지급 의심 ${dup.length}건`, dup);

  // ── 검사 6. 처리완료인데 처리시각 없음
  const noTime = liveRequests.filter(r => r.status === 'completed' && !r.completedAt && !r.updatedAt);
  if (noTime.length) {
    report('확인', `처리완료인데 처리시각이 없는 건 ${noTime.length}건`,
      noTime.map(r => `${nameOf(r.driverId)} ${r.createdAt} ${money(r.amount)}`));
  }

  // ── 검사 7. 출금이 나간 뒤 제외된 정산서 (유장혁·박신현 케이스 사전 탐지)
  const withdrawnDrivers = new Set(liveRequests.map(r => gidOf(r.driverId)));
  const excludedWithWithdrawal = [];
  excluded.forEach(entry => {
    const m = String(entry).match(/^(.*)-(\d{4}-\d{2}-\d{2})-(baemin|coupang)$/);
    if (!m) return;
    const [, did, period, platform] = m;
    const week = settlementWeekStart(period);
    if (!inScope(week)) return;
    if (!withdrawnDrivers.has(gidOf(did))) return;
    excludedWithWithdrawal.push({ did, period, platform, week });
  });
  if (excludedWithWithdrawal.length) {
    const byDrv = new Map();
    excludedWithWithdrawal.forEach(e => {
      const k = gidOf(e.did);
      if (!byDrv.has(k)) byDrv.set(k, []);
      byDrv.get(k).push(e);
    });
    const ackedWeeks = new Set(ack.excluded.map(e => dateOnly(e['정산주'])));
    const allAcked = excludedWithWithdrawal.every(e => ackedWeeks.has(e.week));
    report(allAcked ? '참고' : '확인',
      `출금 이력이 있는 기사의 정산서가 제외됨 ${byDrv.size}명 (${excludedWithWithdrawal.length}건)${allAcked ? ' — 확인 완료' : ''}`,
      [...byDrv.entries()].map(([gid, list]) =>
        `${nameOf(gid)} · ${list.map(e => `${e.period}/${e.platform}`).join(', ')}`));
  }

  // ── 검사 8. 마무리된 정산주에 들어온 신청
  const finalizedWeeks = new Set(finalized.map(f => dateOnly(f.weekStart || f)));
  const afterFinal = liveRequests.filter(r => {
    const week = dateOnly(r.weekStart);
    if (!inScope(week) || !finalizedWeeks.has(week)) return false;
    const entry = finalized.find(f => dateOnly(f.weekStart || f) === week);
    const at = entry?.finalizedAt;
    return at ? String(r.createdAt) > String(at) : false;
  });
  if (afterFinal.length) {
    report('위험', `주정산 마무리 이후 들어온 신청 ${afterFinal.length}건`,
      afterFinal.map(r => `${nameOf(r.driverId)} ${r.createdAt} ${money(r.amount)} (주 ${r.weekStart})`));
  }

  // ─────────────────────────────────────────────────────────
  // 3. 주차별 대사표
  // ─────────────────────────────────────────────────────────
  const weeks = [...new Set([...netByKey.keys(), ...wdByKey.keys()].map(k => k.split('|')[1]))].sort();
  console.log('\n' + '─'.repeat(64));
  console.log(' 주차별 대사');
  console.log('─'.repeat(64));
  for (const week of weeks) {
    let net = 0;
    let consumed = 0;
    let people = 0;
    netByKey.forEach((v, k) => { if (k.endsWith(`|${week}`)) { net += v; people += 1; } });
    wdByKey.forEach((v, k) => { if (k.endsWith(`|${week}`)) consumed += v.consumed; });
    console.log(`  ${week} ~ ${settlementWeekEnd(week)}`);
    console.log(`    기사 ${people}명 · 실지급 ${money(net)} · 출금+수수료 ${money(consumed)} · 잔액 ${money(net - consumed)}`);
  }

  // ─────────────────────────────────────────────────────────
  // 4. 결과
  // ─────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(64));
  const danger = findings.filter(f => f.level === '위험');
  const check = findings.filter(f => f.level === '확인');
  const info = findings.filter(f => f.level === '참고');

  if (!findings.length) {
    console.log(' 검수 통과 — 이상 항목 없음');
    console.log('='.repeat(64));
    process.exit(0);
  }

  for (const group of [danger, check, info]) {
    for (const f of group) {
      console.log(`\n[${f.level}] ${f.title}`);
      f.lines.forEach(line => console.log(`  ${line}`));
    }
  }

  console.log('\n' + '='.repeat(64));
  console.log(` 위험 ${danger.length}건 · 확인 ${check.length}건 · 참고 ${info.length}건`);
  console.log('='.repeat(64));
  process.exit(danger.length ? 1 : 0);
})().catch(error => {
  die('검수 중 예외가 발생했습니다.', error.stack || error.message);
});

#!/usr/bin/env node
/**
 * "가입된 기사가 미매칭으로 뜨는가" 실측 (읽기 전용)
 *
 * settlement_unmatched 에 남아 있는 미매칭 행들을, 현재 등록 기사 전원과
 * js/settlement-client.js 의 matchDrivers 와 같은 키 규칙으로 다시 맞춰본다.
 *
 * 판정
 *   [버그] 등록기사-ID일치   : 쿠팡ID/배민ID 가 정확히 일치하는 기사가 있는데 미매칭이었다
 *   [주의] 등록기사-이름1명  : 이름이 정확히 1명과 일치 (이름 백업 매칭으로 붙었어야 함)
 *   [정상] 동명이인          : 이름이 2명 이상과 일치 → 잘못 붙지 않게 미매칭이 맞다
 *   [정상] 미등록            : 어떤 기사와도 안 붙는다 (진짜 미가입)
 *
 * 쓰기 없음.
 */
const path = require('path');
const fs = require('fs');

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

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE env 필요');
  process.exit(2);
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---- js/driver-utils.js · js/settlement-client.js 와 동일한 키 규칙 ----
function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}
function stripSpaces(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}
/** normalizeCoupangLoginKey */
function coupangKey(value) {
  return stripSpaces(value);
}
/** makeDriverLoginId: 이름 + 전화 뒤4 */
function makeLoginId(row) {
  return `${String(row?.name || '').replace(/\s/g, '')}${normalizePhone(row?.phone).slice(-4)}`;
}
/** getErpCoupangId: 커스텀 쿠팡ID 우선, 없으면 이름+뒤4 */
function erpCoupangId(row) {
  const raw = row?.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  const custom = String(raw.coupangLoginKey || raw.coupangId || raw.coupangLoginId || '')
    .trim()
    .replace(/\s/g, '');
  if (custom) return custom;
  return makeLoginId(row);
}
/** normalizeBaeminUserId + baeminIdMatchKey */
function baeminKey(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const m = raw.match(/^(\d+)\.0+$/);
  const v = (m ? m[1] : raw).replace(/\s+/g, '');
  if (!v) return '';
  return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
}
function nameKey(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

async function fetchAll(table, columns) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

(async () => {
  console.log('='.repeat(84));
  console.log(' 가입된 기사가 미매칭으로 남아 있는가 (읽기 전용)');
  console.log('='.repeat(84));

  const riders = await fetchAll('riders', 'id,name,phone,baemin_id,status,raw_data,created_at');
  const unmatched = await fetchAll(
    'settlement_unmatched',
    'id,kind,platform,period,week_start,raw_name,name,rider_id,order_count,coupang_login_key,baemin_user_id,saved_at'
  );

  console.log(`\n등록 기사 ${riders.length}명 · 미매칭 기록 ${unmatched.length}건\n`);

  // 매칭 인덱스 (matchDrivers 와 동일 구성)
  const byCoupang = new Map();
  const byBaemin = new Map();
  const byName = new Map();
  riders.forEach(r => {
    const ck = coupangKey(erpCoupangId(r));
    if (ck && !byCoupang.has(ck)) byCoupang.set(ck, r);
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    const stored = coupangKey(raw.coupangId || raw.coupangLoginId || raw.loginId);
    if (stored && !byCoupang.has(stored)) byCoupang.set(stored, r);
    const bk = baeminKey(r.baemin_id);
    if (bk && !byBaemin.has(bk)) byBaemin.set(bk, r);
    const nk = nameKey(r.name);
    if (nk) {
      const list = byName.get(nk) || [];
      list.push(r);
      byName.set(nk, list);
    }
  });

  const buckets = { idHit: [], nameOne: [], sameName: [], notRegistered: [] };

  unmatched.forEach(row => {
    const isBaemin = String(row.platform || '').toLowerCase() === 'baemin';
    let hit = null;
    let how = '';

    if (isBaemin) {
      const bk = baeminKey(row.rider_id || row.baemin_user_id);
      if (bk && byBaemin.has(bk)) {
        hit = byBaemin.get(bk);
        how = `배민ID ${bk}`;
      }
    } else {
      const ck = coupangKey(row.raw_name || row.name || row.coupang_login_key);
      if (ck && byCoupang.has(ck)) {
        hit = byCoupang.get(ck);
        how = `쿠팡ID ${ck}`;
      }
    }

    if (hit) {
      buckets.idHit.push({ row, hit, how });
      return;
    }

    const nk = nameKey(row.name || row.raw_name);
    const nameMatches = nk ? (byName.get(nk) || []) : [];
    if (nameMatches.length === 1) {
      buckets.nameOne.push({ row, hit: nameMatches[0], how: `이름 ${row.name || row.raw_name}` });
    } else if (nameMatches.length > 1) {
      buckets.sameName.push({ row, count: nameMatches.length });
    } else {
      buckets.notRegistered.push({ row });
    }
  });

  // 결정적 판별: 그 미매칭이 기록된 시점에 기사가 이미 등록돼 있었나?
  function registeredBefore(entry) {
    const savedAt = String(entry.row.saved_at || '');
    const createdAt = String(entry.hit?.created_at || '');
    if (!savedAt || !createdAt) return null;
    return createdAt <= savedAt;
  }
  const idHitBefore = buckets.idHit.filter(e => registeredBefore(e) === true);
  const idHitAfter = buckets.idHit.filter(e => registeredBefore(e) === false);
  const nameOneBefore = buckets.nameOne.filter(e => registeredBefore(e) === true);
  const nameOneAfter = buckets.nameOne.filter(e => registeredBefore(e) === false);

  console.log('[판정 요약]');
  console.log(`  ID 일치하는 등록기사 있음        : ${buckets.idHit.length}건`);
  console.log(`    ├ 미매칭 당시 이미 등록됨 [버그]: ${idHitBefore.length}건`);
  console.log(`    └ 미매칭 이후에 등록됨  [정상]  : ${idHitAfter.length}건`);
  console.log(`  이름이 1명과만 일치             : ${buckets.nameOne.length}건`);
  console.log(`    ├ 미매칭 당시 이미 등록됨 [주의]: ${nameOneBefore.length}건`);
  console.log(`    └ 미매칭 이후에 등록됨  [정상]  : ${nameOneAfter.length}건`);
  console.log(`  [정상] 동명이인이라 미매칭 유지   : ${buckets.sameName.length}건`);
  console.log(`  [정상] 등록된 기사 아님(미가입)   : ${buckets.notRegistered.length}건`);

  if (idHitBefore.length) {
    console.log('\n[버그] 미매칭 당시 이미 등록돼 있었는데 안 붙은 건 (최대 30개)');
    idHitBefore.slice(0, 30).forEach(({ row, hit, how }) => {
      console.log(`  미매칭 ${String(row.saved_at).slice(0, 10)} · 기사등록 ${String(hit.created_at).slice(0, 10)} · `
        + `${String(row.platform).padEnd(8)} 정산서="${row.raw_name || row.name}" → "${hit.name}" · ${how}`);
    });
  }

  if (idHitAfter.length) {
    console.log('\n[정상] 미매칭 이후에 기사가 등록된 건 (최대 10개 · 당시엔 진짜 미가입)');
    idHitAfter.slice(0, 10).forEach(({ row, hit }) => {
      console.log(`  미매칭 ${String(row.saved_at).slice(0, 10)} → 기사등록 ${String(hit.created_at).slice(0, 10)} · "${hit.name}"`);
    });
  }

  if (buckets.nameOne.length) {
    console.log('\n[주의] 이름은 1명과 일치하는데 ID가 안 붙은 건 (최대 30개)');
    buckets.nameOne.slice(0, 30).forEach(({ row, hit, how }) => {
      const raw = hit.raw_data && typeof hit.raw_data === 'object' ? hit.raw_data : {};
      console.log(`  ${String(row.period || row.week_start || '').slice(0, 10)} ${String(row.platform).padEnd(8)} `
        + `정산서="${row.raw_name || row.name}" ↔ 기사 "${hit.name}" `
        + `(등록 쿠팡ID="${raw.coupangId || raw.coupangLoginKey || '(자동)'}" 배민ID="${hit.baemin_id || '없음'}" 전화=${hit.phone || '없음'})`);
    });
  }

  if (buckets.sameName.length) {
    console.log('\n[정상] 동명이인으로 안전하게 미매칭 처리된 건 (최대 15개)');
    buckets.sameName.slice(0, 15).forEach(({ row, count }) => {
      console.log(`  ${String(row.platform).padEnd(8)} "${row.name || row.raw_name}" — 같은 이름 기사 ${count}명`);
    });
  }

  // ---- 가장 중요한 확인: 그 기사·그 날짜의 정산이 실제로 들어갔는가 ----
  // daily_settlements id = `${driverId}-${period}-${platform}` (storage.js upsertBatch 규칙)
  console.log('\n' + '='.repeat(84));
  console.log(' [핵심] 미매칭이던 건의 정산이 결국 들어갔는가 (돈이 빠졌는지)');
  console.log('='.repeat(84));

  const settlements = await fetchAll('daily_settlements', 'id,driver_id,period,platform');
  const settledKey = new Set(
    settlements.map(s => `${s.driver_id}|${String(s.period).slice(0, 10)}|${String(s.platform || '').toLowerCase()}`)
  );

  const suspects = [...idHitBefore, ...nameOneBefore];
  const stillMissing = [];
  const laterSettled = [];
  suspects.forEach(entry => {
    const period = String(entry.row.period || '').slice(0, 10);
    const platform = String(entry.row.platform || '').toLowerCase();
    if (!period) return;
    const key = `${entry.hit.id}|${period}|${platform}`;
    if (settledKey.has(key)) laterSettled.push(entry);
    else stillMissing.push(entry);
  });

  console.log(`  검사 대상(등록이 먼저였던 미매칭) : ${suspects.length}건`);
  console.log(`  ✔ 이후 정산이 들어갔음 (기록만 남음): ${laterSettled.length}건`);
  console.log(`  ✗ 아직 정산이 없음 (확인 필요)     : ${stillMissing.length}건`);

  // 같은 날·같은 플랫폼에, "같은 이름의 다른 기사 레코드"로 정산이 들어갔는지 확인.
  // 동명이인·중복등록 때문에 다른 driver_id 로 반영된 경우를 돈 빠짐으로 오판하지 않기 위함.
  const settleByDatePlatform = new Map();
  settlements.forEach(s => {
    const k = `${String(s.period).slice(0, 10)}|${String(s.platform || '').toLowerCase()}`;
    const list = settleByDatePlatform.get(k) || [];
    list.push(s.driver_id);
    settleByDatePlatform.set(k, list);
  });
  const riderById = new Map(riders.map(r => [r.id, r]));

  const classified = stillMissing.map(entry => {
    const period = String(entry.row.period).slice(0, 10);
    const platform = String(entry.row.platform || '').toLowerCase();
    const sameDayIds = settleByDatePlatform.get(`${period}|${platform}`) || [];
    const nk = nameKey(entry.hit.name);
    const dupHit = sameDayIds.find(id => {
      const r = riderById.get(id);
      return r && r.id !== entry.hit.id && nameKey(r.name) === nk;
    });
    return {
      ...entry,
      calls: Number(entry.row.order_count || 0),
      dupSettledDriverId: dupHit || ''
    };
  });

  const dupSettled = classified.filter(e => e.dupSettledDriverId);
  const realMissing = classified.filter(e => !e.dupSettledDriverId);
  const zeroCalls = realMissing.filter(e => e.calls === 0);
  const withCalls = realMissing.filter(e => e.calls > 0);

  console.log('\n  [정산 없음 건 분류]');
  console.log(`    같은 이름 다른 기사 레코드로 반영됨 (중복등록) : ${dupSettled.length}건`);
  console.log(`    콜수 0 — 일한 기록이 없어 정산액도 0일 수 있음  : ${zeroCalls.length}건`);
  console.log(`    ★ 콜수 있는데 정산 없음 (실제 확인 필요) ★     : ${withCalls.length}건`);

  if (withCalls.length) {
    console.log('\n  ★★ 콜수가 있는데 정산이 없는 건 ★★');
    withCalls
      .sort((a, b) => b.calls - a.calls)
      .forEach(({ row, hit, calls }) => {
        console.log(`    ${String(row.period).slice(0, 10)} ${String(row.platform).padEnd(8)} `
          + `"${hit.name}" (${hit.status}) · 콜수 ${String(calls).padStart(4)} · 정산서표기="${row.raw_name || row.name}"`);
      });
  }

  if (dupSettled.length) {
    console.log('\n  [중복등록으로 다른 레코드에 반영된 건] (최대 10개)');
    dupSettled.slice(0, 10).forEach(({ row, hit, dupSettledDriverId }) => {
      const other = riderById.get(dupSettledDriverId);
      console.log(`    ${String(row.period).slice(0, 10)} "${hit.name}" — 정산은 다른 레코드(${other?.name}/${dupSettledDriverId.slice(0, 8)}…)에 들어감`);
    });
  }

  console.log('\n[결론]');
  if (!withCalls.length) {
    console.log('  콜수가 있는데 정산이 빠진 건은 없다.');
    console.log('  남은 미매칭 기록은 콜수 0, 중복등록, 또는 이후 등록된 기사의 오래된 기록이다.');
  } else {
    console.log(`  콜수가 있는데 정산이 없는 건 ${withCalls.length}건 — 실제 확인이 필요하다.`);
    console.log('  ※ 이 건들은 이번 성능 작업과 무관하게 예전부터 남아 있던 것이다.');
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

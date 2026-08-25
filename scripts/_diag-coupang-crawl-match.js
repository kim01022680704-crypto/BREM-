#!/usr/bin/env node
/**
 * 쿠팡 크롤링 → 기사 매칭 검사 (읽기 전용) · 동명이인 오배정 여부 확인
 *
 * server/coupang-erp-sync.js 의 buildCoupangLookup / resolveDriver 를 그대로 복제해
 * 실제 coupang_collect_items(rider_daily) 가 어느 기사에 붙는지 재현한다.
 *
 * 중점 확인
 *   1) match_key 로 붙은 건 vs 전화 폴백으로 붙은 건 vs 미매칭
 *   2) 전화 폴백인데 크롤링 이름 ≠ 기사 이름  → 오배정 위험
 *   3) 동명이인 이름의 크롤링 행이 서로 다른 기사로 갈라지는지
 *   4) 두 기사가 같은 쿠팡 키를 만들어 한쪽이 가려지는지
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE env 필요');
  process.exit(2);
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---- server/coupang-erp-sync.js 와 동일한 규칙 ----
function normalizePhone(v) { return String(v || '').replace(/[^0-9]/g, ''); }
function normalizeCoupangKey(v) {
  return String(v || '')
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}
function makeDriverLoginId(d) {
  const name = String(d?.name || '').replace(/\s+/g, '');
  const tail = normalizePhone(d?.phone).slice(-4);
  return name && tail ? `${name}${tail}` : '';
}
function getErpCoupangId(d) {
  const raw = d.raw && typeof d.raw === 'object' ? d.raw : {};
  const custom = String(d.coupangId || d.coupangLoginKey || raw.coupangId || raw.coupangLoginKey || '')
    .replace(/\s+/g, '');
  return custom || makeDriverLoginId(d);
}
function nameKey(v) { return String(v || '').replace(/\s+/g, '').toLowerCase(); }

async function fetchAll(table, columns, build) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    let q = supabase.from(table).select(columns).range(from, from + size - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

(async () => {
  console.log('='.repeat(88));
  console.log(' 쿠팡 크롤링 → 기사 매칭 검사 (읽기 전용)');
  console.log('='.repeat(88));

  const riderRows = await fetchAll('riders', 'id,name,phone,status,raw_data');
  const drivers = riderRows.map(row => {
    const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
    return {
      id: String(row.id || ''),
      name: String(row.name || ''),
      phone: String(row.phone || ''),
      status: String(row.status || ''),
      coupangId: String(raw.coupangId || raw.coupangLoginKey || ''),
      coupangLoginKey: String(raw.coupangLoginKey || ''),
      raw
    };
  });

  // ---- lookup 구성 (원본과 동일) + 키 충돌 감시 ----
  const byKey = new Map();
  const byPhone = new Map();
  const keyCollisions = [];
  drivers.forEach(d => {
    const loginId = normalizeCoupangKey(makeDriverLoginId(d));
    const erpId = normalizeCoupangKey(getErpCoupangId(d));
    [loginId, erpId].forEach(k => {
      if (!k) return;
      if (byKey.has(k)) {
        const prev = byKey.get(k);
        if (prev.id !== d.id) keyCollisions.push({ key: k, kept: prev, shadowed: d });
        return;
      }
      byKey.set(k, d);
    });
    const phone = normalizePhone(d.phone);
    if (phone) {
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone).push(d);
    }
  });

  const from = daysAgo(21);
  const rows = await fetchAll(
    'coupang_collect_items',
    'collect_date,match_key,rider_name,phone_number,courier_id,parsed_json',
    q => q.eq('source_menu', 'rider_daily').gte('collect_date', from)
  );
  console.log(`\n기사 ${drivers.length}명 · 최근 21일 rider_daily ${rows.length}행 (${from} 이후)\n`);

  // ---- identity 단위 집계 (원본과 동일) ----
  const byIdentity = new Map();
  rows.forEach(row => {
    const matchKey = normalizeCoupangKey(row.match_key || '');
    const phone = normalizePhone(row.phone_number || row.parsed_json?.phone || '');
    const identity = matchKey || (phone ? `phone:${phone}` : '') || normalizeCoupangKey(row.courier_id || '');
    if (!identity) return;
    const prev = byIdentity.get(identity) || { matchKey: matchKey || identity, name: '', phone, rows: 0 };
    if (row.rider_name) prev.name = row.rider_name;
    if (phone) prev.phone = phone;
    if (matchKey) prev.matchKey = matchKey;
    prev.rows += 1;
    byIdentity.set(identity, prev);
  });

  const viaKey = [];
  const viaPhone = [];
  const unmatched = [];
  byIdentity.forEach(entry => {
    const mk = normalizeCoupangKey(entry.matchKey);
    if (mk && byKey.has(mk)) {
      viaKey.push({ entry, driver: byKey.get(mk) });
      return;
    }
    const cands = byPhone.get(normalizePhone(entry.phone)) || [];
    if (cands.length === 1) {
      viaPhone.push({ entry, driver: cands[0] });
      return;
    }
    unmatched.push({ entry, candidates: cands.length });
  });

  console.log('[1] 매칭 경로');
  console.log(`  크롤링 기사(identity) 총 ${byIdentity.size}명`);
  console.log(`  ├ 쿠팡ID(match_key)로 매칭 : ${viaKey.length}명`);
  console.log(`  ├ 전화번호 폴백으로 매칭    : ${viaPhone.length}명`);
  console.log(`  └ 미매칭                   : ${unmatched.length}명`);

  console.log('\n[2] 이름 일치 검사 — 붙은 기사와 크롤링 이름이 같은가');
  const mismatch = [...viaKey, ...viaPhone].filter(({ entry, driver }) => {
    if (!entry.name) return false;
    return nameKey(entry.name) !== nameKey(driver.name);
  });
  console.log(`  이름 불일치: ${mismatch.length}건 ${mismatch.length ? '★ 오배정 의심 ★' : '(없음)'}`);
  mismatch.slice(0, 20).forEach(({ entry, driver }) => {
    console.log(`    크롤링 "${entry.name}" (key=${entry.matchKey}) → 기사 "${driver.name}" 전화 ${driver.phone}`);
  });

  console.log('\n[3] 쿠팡 키 충돌 — 두 기사가 같은 키를 만들면 한쪽이 가려진다');
  console.log(`  충돌 ${keyCollisions.length}건 ${keyCollisions.length ? '★ 확인 필요 ★' : '(없음)'}`);
  keyCollisions.slice(0, 20).forEach(c => {
    console.log(`    키 "${c.key}" → 사용됨 "${c.kept.name}"(${c.kept.phone}) / 가려짐 "${c.shadowed.name}"(${c.shadowed.phone})`);
  });

  console.log('\n[4] 동명이인이 크롤링에서 제대로 갈라지는가');
  const nameGroups = new Map();
  drivers.forEach(d => {
    const k = nameKey(d.name);
    if (!k) return;
    const list = nameGroups.get(k) || [];
    list.push(d);
    nameGroups.set(k, list);
  });
  const dupNames = [...nameGroups.entries()].filter(([, l]) => l.length > 1);

  let dupChecked = 0;
  let dupOk = 0;
  const dupProblems = [];
  dupNames.forEach(([nk, list]) => {
    // 이 이름으로 크롤링된 identity 들
    const crawled = [...byIdentity.values()].filter(e => nameKey(e.name) === nk);
    if (!crawled.length) return;
    dupChecked += 1;
    const assigned = new Map();
    let problem = '';
    crawled.forEach(e => {
      const mk = normalizeCoupangKey(e.matchKey);
      const hit = (mk && byKey.get(mk))
        || (() => {
          const c = byPhone.get(normalizePhone(e.phone)) || [];
          return c.length === 1 ? c[0] : null;
        })();
      if (!hit) {
        problem = '미매칭 발생';
        return;
      }
      if (assigned.has(hit.id)) {
        problem = '두 크롤링 행이 같은 기사로 합쳐짐';
      }
      assigned.set(hit.id, (assigned.get(hit.id) || 0) + 1);
    });
    if (problem) {
      dupProblems.push({ name: list[0].name, registered: list.length, crawled: crawled.length, assigned: assigned.size, problem, crawledList: crawled });
    } else {
      dupOk += 1;
    }
  });

  console.log(`  동명이인 그룹 ${dupNames.length}개 중 크롤링에 등장한 그룹 ${dupChecked}개`);
  console.log(`  ├ 정상 분리   : ${dupOk}개`);
  console.log(`  └ 확인 필요   : ${dupProblems.length}개`);
  dupProblems.forEach(p => {
    console.log(`\n    "${p.name}" — 등록 ${p.registered}명 · 크롤링 ${p.crawled}건 · 배정된 기사 ${p.assigned}명 → ${p.problem}`);
    p.crawledList.forEach(e => {
      console.log(`      크롤링 key="${e.matchKey}" 이름="${e.name}" 전화=${e.phone || '없음'} (${e.rows}행)`);
    });
    (nameGroups.get(nameKey(p.name)) || []).forEach(d => {
      console.log(`      등록   키="${normalizeCoupangKey(getErpCoupangId(d))}" 전화=${d.phone} 상태=${d.status}`);
    });
  });

  if (unmatched.length) {
    console.log('\n[5] 미매칭 크롤링 기사 (최대 25명)');
    unmatched.slice(0, 25).forEach(({ entry, candidates }) => {
      console.log(`    "${entry.name || '(이름없음)'}" key="${entry.matchKey}" 전화=${entry.phone || '없음'} 전화후보=${candidates}명 (${entry.rows}행)`);
    });
  }

  console.log('\n[결론]');
  const bad = mismatch.length + keyCollisions.length + dupProblems.length;
  if (!bad) {
    console.log('  쿠팡 크롤링은 쿠팡ID 기준으로 붙고, 동명이인도 전화 뒤4자리로 정확히 갈라진다.');
    console.log('  이름만으로 붙는 경로가 없어 동명이인 오배정 위험이 없다.');
  } else {
    console.log(`  확인이 필요한 건 ${bad}건 (이름불일치 ${mismatch.length} · 키충돌 ${keyCollisions.length} · 동명이인 ${dupProblems.length})`);
  }
  if (unmatched.length) {
    console.log(`  미매칭 ${unmatched.length}명은 등록 안 된 기사이거나 쿠팡ID가 등록값과 다른 경우다.`);
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * 쿠팡 매칭 이상 건 정밀 확인 (읽기 전용)
 *  - 커스텀 쿠팡ID 가 본인 이름과 다른 기사 (다른 사람 실적이 붙을 수 있다)
 *  - 미매칭 크롤링 기사가 실제로 등록돼 있는지 (키만 안 맞는 건지)
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

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

function normalizePhone(v) { return String(v || '').replace(/[^0-9]/g, ''); }
function stripSpaces(v) { return String(v || '').replace(/\s+/g, ''); }
function nameKey(v) { return stripSpaces(v).toLowerCase(); }
function autoId(r) {
  const n = stripSpaces(r.name);
  const t = normalizePhone(r.phone).slice(-4);
  return n && t ? `${n}${t}` : '';
}
function customId(r) {
  const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
  return stripSpaces(raw.coupangId || raw.coupangLoginKey || raw.coupangLoginId || '');
}

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
  console.log(' 쿠팡 매칭 이상 건 정밀 확인 (읽기 전용)');
  console.log('='.repeat(88));

  const riders = await fetchAll('riders', 'id,name,phone,status,created_at,raw_data');

  console.log('\n[1] 커스텀 쿠팡ID 가 본인 이름과 다른 기사');
  console.log('    → 그 ID 로 크롤링되는 "다른 사람" 실적이 이 기사에 붙는다');
  const weird = riders.filter(r => {
    const c = customId(r);
    if (!c) return false;
    // 커스텀 ID 앞부분이 본인 이름으로 시작하지 않으면 의심
    return !nameKey(c).startsWith(nameKey(r.name));
  });
  if (!weird.length) {
    console.log('    (없음)');
  } else {
    weird.forEach(r => {
      console.log(`    기사 "${r.name}" (전화 ${r.phone} · ${r.status})`);
      console.log(`      커스텀 쿠팡ID = "${customId(r)}"   ← 이름과 불일치`);
      console.log(`      자동 생성값이라면 "${autoId(r)}" 이어야 함`);
      console.log(`      등록일 ${String(r.created_at).slice(0, 10)} · id=${String(r.id).slice(0, 8)}…`);
    });
  }

  console.log('\n[2] 미매칭 크롤링 기사가 실제로 등록돼 있는가');
  const rows = await fetchAll(
    'coupang_collect_items',
    'match_key,rider_name,phone_number,parsed_json',
    q => q.eq('source_menu', 'rider_daily').gte('collect_date', daysAgo(21))
  );

  const byKey = new Map();
  const byPhone = new Map();
  riders.forEach(r => {
    [autoId(r), customId(r)].forEach(k => {
      const key = nameKey(k);
      if (key && !byKey.has(key)) byKey.set(key, r);
    });
    const p = normalizePhone(r.phone);
    if (p) {
      if (!byPhone.has(p)) byPhone.set(p, []);
      byPhone.get(p).push(r);
    }
  });
  const byName = new Map();
  riders.forEach(r => {
    const k = nameKey(r.name);
    if (!k) return;
    const l = byName.get(k) || [];
    l.push(r);
    byName.set(k, l);
  });

  const identities = new Map();
  rows.forEach(row => {
    const mk = nameKey(row.match_key || '');
    const phone = normalizePhone(row.phone_number || row.parsed_json?.phone || '');
    const id = mk || (phone ? `phone:${phone}` : '');
    if (!id) return;
    const prev = identities.get(id) || { matchKey: mk, name: row.rider_name || '', phone, rows: 0 };
    if (row.rider_name) prev.name = row.rider_name;
    if (phone) prev.phone = phone;
    prev.rows += 1;
    identities.set(id, prev);
  });

  const unmatched = [...identities.values()].filter(e => {
    if (e.matchKey && byKey.has(e.matchKey)) return false;
    const c = byPhone.get(normalizePhone(e.phone)) || [];
    return c.length !== 1;
  });

  const registeredButKeyMismatch = [];
  const trulyUnregistered = [];
  unmatched.forEach(e => {
    const sameName = byName.get(nameKey(e.name)) || [];
    if (sameName.length) {
      registeredButKeyMismatch.push({ e, sameName });
    } else {
      trulyUnregistered.push(e);
    }
  });

  console.log(`  미매칭 ${unmatched.length}명`);
  console.log(`  ├ 같은 이름의 기사가 등록돼 있음 (키만 안 맞음) : ${registeredButKeyMismatch.length}명 ★`);
  console.log(`  └ 이름도 없음 = 진짜 미등록                    : ${trulyUnregistered.length}명`);

  if (registeredButKeyMismatch.length) {
    console.log('\n  ★ 등록돼 있는데 쿠팡ID 가 안 맞아서 실적이 안 붙는 기사 ★');
    registeredButKeyMismatch.forEach(({ e, sameName }) => {
      console.log(`\n    크롤링: "${e.name}" key="${e.matchKey}" 전화=${e.phone || '없음'} (${e.rows}행)`);
      sameName.forEach(r => {
        console.log(`      등록  : "${r.name}" 전화=${r.phone} · 자동키="${nameKey(autoId(r))}" · 커스텀="${customId(r) || '없음'}" · ${r.status}`);
        const crawlTail = String(e.phone).slice(-4);
        const regTail = normalizePhone(r.phone).slice(-4);
        console.log(`              크롤링 전화뒤4=${crawlTail} / 등록 전화뒤4=${regTail} ${crawlTail === regTail ? '(같음)' : '← 다름'}`);
      });
    });
  }

  if (trulyUnregistered.length) {
    console.log('\n  진짜 미등록 (기사 등록이 필요)');
    trulyUnregistered.forEach(e => {
      console.log(`    "${e.name}" key="${e.matchKey}" 전화=${e.phone || '없음'} (${e.rows}행)`);
    });
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

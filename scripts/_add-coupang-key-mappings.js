#!/usr/bin/env node
/**
 * 쿠팡 계정 전화번호가 등록 번호와 다른 기사의 수동 매핑을 넣는다
 *
 *   node scripts/_add-coupang-key-mappings.js          ← 미리보기 (쓰기 없음)
 *   node scripts/_add-coupang-key-mappings.js --apply   ← 실제 저장
 *
 * 왜 필요한가
 *   쿠팡 매칭 키는 "이름+전화뒤4" 다. 등록 번호가 쿠팡 계정 번호와 다르면 키가
 *   안 맞고, 이름 백업 매칭도 뒤4 검증 때문에 더는 붙지 않는다(오배정 방지).
 *   같은 이름 기사가 1명뿐이라 다른 사람에게 갈 여지가 없는 건만 매핑해 둔다.
 *   매핑이 있으면 다음 업로드부터 자동으로 붙어 미매칭이 뜨지 않는다.
 *
 * 안전 장치
 *   1) 기본은 미리보기. --apply 없이는 아무것도 쓰지 않는다.
 *   2) 같은 이름 등록 기사가 2명 이상이면 건너뛴다. (사람이 봐야 한다)
 *   3) 크롤 데이터의 이름·전화 뒤4가 정산서 키와 맞는지 확인하고, 다르면 건너뛴다.
 *   4) 이미 있는 매핑은 건드리지 않는다.
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

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--apply');
const KEY = 'brem_admin_manual_name_mappings';
const dg = v => String(v || '').replace(/[^0-9]/g, '');

// 정산서에 나오는 쿠팡 키 → 붙어야 하는 기사 이름
const TARGETS = ['정의현8833', '박준혁4453', '김현수1385', '김주영1411'];

(async () => {
  console.log('='.repeat(88));
  console.log(` 쿠팡 키 수동 매핑 추가 — ${APPLY ? '### 실제 저장 ###' : '미리보기 (쓰기 없음)'}`);
  console.log('='.repeat(88));

  const { data: setRow, error: sErr } = await supabase
    .from('settings').select('value').eq('key', KEY).maybeSingle();
  if (sErr) die('수동 매핑 조회 실패', sErr.message);
  let cur = setRow?.value;
  if (typeof cur === 'string') { try { cur = JSON.parse(cur); } catch (_) { cur = null; } }
  if (!Array.isArray(cur)) die('수동 매핑 값이 배열이 아닙니다. 손대지 않습니다.');
  console.log(`\n기존 매핑 ${cur.length}건`);

  const existing = new Set(cur
    .filter(m => String(m.platform) === 'coupang')
    .map(m => String(m.originalName || '').replace(/\s+/g, '')));

  const additions = [];
  for (const key of TARGETS) {
    const name = key.replace(/\d{4}$/, '');
    const tail = key.slice(-4);
    console.log(`\n── ${key} ──`);

    if (existing.has(key)) {
      console.log('   이미 매핑이 있습니다. 건너뜁니다.');
      continue;
    }

    const { data: riders, error } = await supabase
      .from('riders').select('id,name,phone,status').eq('name', name);
    if (error) die(`riders 조회 실패 (${name})`, error.message);
    if (!riders?.length) { console.log('   등록된 기사가 없습니다. 건너뜁니다.'); continue; }
    if (riders.length > 1) {
      console.log(`   같은 이름 기사가 ${riders.length}명입니다. 사람이 확인해야 합니다. 건너뜁니다.`);
      riders.forEach(r => console.log(`      뒤4=${dg(r.phone).slice(-4)} ${r.status}`));
      continue;
    }
    const rider = riders[0];

    // 크롤 데이터로 그 키가 실제로 이 이름의 쿠팡 계정인지 확인
    const { data: crawl } = await supabase
      .from('coupang_collect_items')
      .select('rider_name,phone_number,collect_date')
      .eq('source_menu', 'rider_daily').eq('match_key', key)
      .order('collect_date', { ascending: false }).limit(1);
    const c = (crawl || [])[0];
    if (!c) { console.log('   크롤 데이터가 없어 확인 불가. 건너뜁니다.'); continue; }
    if (String(c.rider_name || '').replace(/\s+/g, '') !== name) {
      console.log(`   크롤 이름이 다릅니다 (크롤 "${c.rider_name}" / 키 "${name}"). 건너뜁니다.`);
      continue;
    }
    if (dg(c.phone_number).slice(-4) !== tail) {
      console.log(`   크롤 전화 뒤4가 키와 다릅니다 (${dg(c.phone_number).slice(-4)} / ${tail}). 건너뜁니다.`);
      continue;
    }

    console.log(`   등록  : "${rider.name}" 전화 ${rider.phone} (뒤4=${dg(rider.phone).slice(-4)}) · ${rider.status}`);
    console.log(`   쿠팡  : "${c.rider_name}" 전화 ${c.phone_number} (뒤4=${tail}) · 최근 ${String(c.collect_date).slice(0, 10)}`);
    console.log(`   동명이인 1명뿐 → 다른 사람에게 갈 여지 없음. 매핑 대상.`);
    additions.push({
      id: `map-${Date.now()}-${additions.length}`,
      platform: 'coupang',
      originalName: key,
      driverId: rider.id,
      driverName: rider.name,
      updatedAt: new Date().toISOString()
    });
  }

  console.log('\n' + '='.repeat(88));
  console.log(` 추가할 매핑 ${additions.length}건`);
  additions.forEach(a => console.log(`   ${a.originalName} → ${a.driverName} (${a.driverId.slice(0, 8)}…)`));

  if (!additions.length) {
    console.log('\n추가할 것이 없습니다.');
    return;
  }
  if (!APPLY) {
    console.log('\n미리보기입니다. 실제로 저장하려면 --apply 를 붙여 다시 실행하세요.');
    return;
  }

  const next = [...additions, ...cur];
  const { error: uErr } = await supabase
    .from('settings')
    .update({ value: next, updated_at: new Date().toISOString() })
    .eq('key', KEY);
  if (uErr) die('수동 매핑 저장 실패', uErr.message);

  const { data: after } = await supabase.from('settings').select('value').eq('key', KEY).maybeSingle();
  let av = after?.value;
  if (typeof av === 'string') { try { av = JSON.parse(av); } catch (_) { av = []; } }
  console.log(`\n저장 완료. 매핑 ${cur.length}건 → ${Array.isArray(av) ? av.length : '?'}건`);
  console.log('관리자 화면은 새로고침해야 반영됩니다.');
})().catch(err => die('예상치 못한 오류', err.stack || err.message));

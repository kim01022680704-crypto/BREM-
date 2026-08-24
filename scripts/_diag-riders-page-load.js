#!/usr/bin/env node
/**
 * /api/admin/riders 페이지 로딩 비용 진단 (읽기 전용)
 * - SELECT 변형(variant)이 첫 시도에 성공하는지 (실패하면 매 페이지가 2~3배)
 * - 100명 페이지 1건 비용, 8페이지 순차 총 비용
 * - 페이지당 전송 바이트 (raw_data 포함)
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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE env missing');
  process.exit(2);
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const {
  RIDER_SELECT,
  RIDER_SELECT_WITH_PLATFORM,
  RIDER_SELECT_BASE,
  RIDER_LIST_SELECT
} = require(path.join(__dirname, '..', 'server', 'rider-select-columns.js'));

const VARIANTS = [
  ['RIDER_SELECT (변형1 · 실제 첫 시도)', RIDER_SELECT],
  ['RIDER_SELECT_WITH_PLATFORM (변형2)', RIDER_SELECT_WITH_PLATFORM],
  ['RIDER_SELECT_BASE (변형3)', RIDER_SELECT_BASE],
  ['RIDER_LIST_SELECT (매칭에 충분한 최소)', RIDER_LIST_SELECT]
];

const MATCH_ONLY_SELECT = 'id,name,phone,baemin_id,raw_data';

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function fetchPage(select, offset, limit) {
  const started = Date.now();
  const { data, error, count } = await supabase
    .from('riders')
    .select(select, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  const elapsedMs = Date.now() - started;
  if (error) return { error: error.message, elapsedMs };
  return {
    rows: (data || []).length,
    count: count || 0,
    bytes: Buffer.byteLength(JSON.stringify(data || []), 'utf8'),
    elapsedMs
  };
}

(async () => {
  console.log('='.repeat(78));
  console.log(' /api/admin/riders 페이지 로딩 비용 (읽기 전용)');
  console.log('='.repeat(78));

  console.log('\n[1] SELECT 변형별 첫 페이지(100명) 결과');
  for (const [label, select] of VARIANTS) {
    const r = await fetchPage(select, 0, 100);
    if (r.error) {
      console.log(`  ${label}`);
      console.log(`    실패 → 다음 변형으로 폴백: ${r.error} (${r.elapsedMs}ms)`);
    } else {
      console.log(`  ${label}`);
      console.log(`    ${r.rows}행 · ${kb(r.bytes)} · ${r.elapsedMs}ms (총 ${r.count}명)`);
    }
  }

  const rMatch = await fetchPage(MATCH_ONLY_SELECT, 0, 100);
  console.log('  매칭 전용 최소 SELECT (id,name,phone,baemin_id,raw_data)');
  console.log(rMatch.error
    ? `    실패: ${rMatch.error}`
    : `    ${rMatch.rows}행 · ${kb(rMatch.bytes)} · ${rMatch.elapsedMs}ms`);

  console.log('\n[2] 현재 방식: 100명 × 순차 페이지 (실제 업로드 시 동작)');
  const total = rMatch.count || 777;
  const pages = Math.ceil(total / 100);
  let seqMs = 0;
  let seqBytes = 0;
  for (let i = 0; i < pages; i += 1) {
    const r = await fetchPage(RIDER_SELECT, i * 100, 100);
    if (r.error) {
      console.log(`  page ${i + 1}: 실패 ${r.error}`);
      continue;
    }
    seqMs += r.elapsedMs;
    seqBytes += r.bytes;
    console.log(`  page ${i + 1}/${pages}: ${r.rows}행 · ${kb(r.bytes)} · ${r.elapsedMs}ms`);
  }
  console.log(`  → DB 시간 합계 ${(seqMs / 1000).toFixed(1)}초 · 전송 ${(seqBytes / 1024 / 1024).toFixed(2)} MB · 요청 ${pages}건`);
  console.log('  ※ 실제로는 여기에 요청당 Vercel 함수 기동 + verifyAdminCaller(인증 조회)가 더 붙는다.');

  console.log('\n[3] 한 번에 받기 비교 (같은 데이터, 페이지 크기만 다름)');
  for (const limit of [200, 500, 1000]) {
    const started = Date.now();
    let offset = 0;
    let rows = 0;
    let bytes = 0;
    let reqs = 0;
    let failed = null;
    for (;;) {
      const { data, error } = await supabase
        .from('riders')
        .select(RIDER_SELECT)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) { failed = error.message; break; }
      const batch = data || [];
      rows += batch.length;
      bytes += Buffer.byteLength(JSON.stringify(batch), 'utf8');
      reqs += 1;
      if (batch.length < limit) break;
      offset += limit;
    }
    const ms = Date.now() - started;
    console.log(failed
      ? `  limit ${limit}: 실패 ${failed}`
      : `  limit ${limit}: ${rows}행 · ${reqs}요청 · ${(bytes / 1024 / 1024).toFixed(2)} MB · ${(ms / 1000).toFixed(1)}초`);
  }

  console.log('\n[4] raw_data 가 차지하는 비중');
  const withRaw = await fetchPage('id,name,phone,baemin_id,raw_data', 0, 100);
  const withoutRaw = await fetchPage('id,name,phone,baemin_id', 0, 100);
  if (!withRaw.error && !withoutRaw.error) {
    console.log(`  raw_data 포함 ${kb(withRaw.bytes)} · 제외 ${kb(withoutRaw.bytes)}`);
    console.log(`  → raw_data 가 ${(100 - (withoutRaw.bytes / withRaw.bytes) * 100).toFixed(0)}% 차지`);
    console.log('  ※ 쿠팡ID(erpCoupangId)가 raw_data 안에 있어 매칭에 raw_data 가 필요하다.');
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});

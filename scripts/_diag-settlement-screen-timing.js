#!/usr/bin/env node
/**
 * 일정산서 업로드 화면 "체감 시간" 재현 (읽기 전용)
 *
 * 브라우저가 실제로 하는 순서를 그대로 흉내낸다.
 *   1) ensureSectionLoaded('settlements')
 *      → daily_settlements / settlement_upload_logs / settlement_unmatched /
 *        admin_calls / settings 를 Promise.all 로 "동시" 로드 (authenticated, RLS 적용)
 *   2) 기사 전체 로드
 *      → /api/admin/riders?limit=100 을 hasMore 가 false 될 때까지 "순차" 로
 *        + /api/admin/riders/count 1회 (awaitDriversFullyLoaded)
 *   1) 과 2) 는 서로 병렬이므로 체감 시간 = max(둘)
 *
 * 쓰기 없음. select/GET 만. (관리자 로그인 1회)
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
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const BASE = process.env.BREM_VERIFY_BASE || 'https://brem.kr';

function credsFromRegressionFile() {
  const p = path.join(__dirname, 'test-production-password.js');
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/const\s+ADMIN\s*=\s*\{[^}]*login:\s*'([^']+)'[^}]*password:\s*'([^']+)'/);
  return m ? { login: m[1], password: m[2] } : null;
}
const fileAdmin = credsFromRegressionFile();
const ADMIN = {
  login: process.env.BREM_VERIFY_ADMIN_LOGIN || fileAdmin?.login || '',
  password: process.env.BREM_VERIFY_ADMIN_PASSWORD || fileAdmin?.password || ''
};

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** ADMIN_SECTION_KEYS.settlements 에 해당하는 테이블들 (브라우저 어댑터와 동일 SELECT·정렬) */
const SECTION_TABLES = [
  {
    label: 'daily_settlements',
    table: 'daily_settlements',
    select: 'id,driver_id,period,platform,rider_id,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount,applied_at',
    order: 'period.desc',
    filter: ''
  },
  {
    label: 'settlement_upload_logs',
    table: 'settlement_upload_logs',
    select: 'id,kind,platform,file_name,period,week_start,week_end,region,start_date,end_date,status,matched_count,unmatched_count,total_delivery_amount,total_order_count,content_hash,matched_records,unmatched_records,applied_records,duplicate_of_log_id,skip_reason,linked_record_id,uploaded_at,applied_at',
    order: 'uploaded_at.desc',
    filter: ''
  },
  {
    label: 'settlement_unmatched',
    table: 'settlement_unmatched',
    select: 'id,kind,platform,week_start,period,end_date,region,raw_name,name,rider_id,order_count,delivery_amount,settlement_amount,coupang_login_key,baemin_user_id,match_payload,source_file_name,saved_at',
    order: 'saved_at.desc',
    filter: ''
  },
  {
    label: 'admin_calls',
    table: 'admin_calls',
    select: '*',
    order: 'date.asc',
    filter: `&date=gte.${daysAgo(730)}`
  },
  {
    label: 'settings(일정산 제외목록)',
    table: 'settings',
    select: 'key,value',
    order: 'key.asc',
    filter: '&key=eq.brem_payroll_daily_excluded_settlements'
  }
];

async function adminLogin() {
  if (!ADMIN.login || !ADMIN.password) throw new Error('관리자 자격증명 없음');
  const res = await fetch(`${BASE}/api/admin/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(ADMIN)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.session?.access_token) throw new Error(`로그인 실패 ${res.status}`);
  return json.session.access_token;
}

async function loadTable(spec, token) {
  const started = Date.now();
  let offset = 0;
  let rows = 0;
  let bytes = 0;
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/${spec.table}?select=${encodeURIComponent(spec.select)}&order=${spec.order}${spec.filter}`;
    const res = await fetch(url, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        Range: `${offset}-${offset + 999}`,
        'Range-Unit': 'items'
      }
    });
    const text = await res.text();
    if (!res.ok) return { ...spec, error: `${res.status} ${text.slice(0, 120)}`, elapsedMs: Date.now() - started };
    let batch = [];
    try { batch = JSON.parse(text) || []; } catch (_) {}
    rows += batch.length;
    bytes += Buffer.byteLength(text, 'utf8');
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return { ...spec, rows, bytes, elapsedMs: Date.now() - started };
}

async function loadAllRiders(token, pageSize = Number(process.env.RIDER_PAGE_SIZE) || 100) {
  const started = Date.now();
  let offset = 0;
  let requests = 0;
  let loaded = 0;
  let total = null;
  const pages = [];
  for (;;) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/admin/riders?limit=${pageSize}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const text = await res.text();
    requests += 1;
    if (!res.ok) {
      pages.push({ offset, ms: Date.now() - t0, error: `${res.status}` });
      break;
    }
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    const count = (json?.riders || []).length;
    total = json?.total ?? total;
    loaded += count;
    pages.push({ offset, ms: Date.now() - t0, count });
    if (!json?.hasMore || !count) break;
    offset += count;
    if (requests > 30) break;
  }

  // awaitDriversFullyLoaded 가 추가로 호출하는 count 확인
  const t1 = Date.now();
  const countRes = await fetch(`${BASE}/api/admin/riders/count`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const countText = await countRes.text();
  let dbCount = null;
  try { dbCount = JSON.parse(countText)?.count ?? null; } catch (_) {}
  const countMs = Date.now() - t1;

  return { pages, requests, loaded, total, dbCount, countMs, pageSize, elapsedMs: Date.now() - started };
}

/** 페이지 크기별 비교 — 서버가 지금 허용하는 한도(200)까지 안전하게 확인 */
async function compareRiderPageSizes(token, sizes) {
  const out = [];
  for (const size of sizes) {
    const r = await loadAllRiders(token, size);
    out.push({
      size,
      requests: r.requests,
      loaded: r.loaded,
      total: r.total,
      elapsedMs: r.elapsedMs,
      complete: r.loaded === r.total
    });
  }
  return out;
}

(async () => {
  console.log('='.repeat(80));
  console.log(' 일정산서 업로드 화면 체감 시간 재현 (읽기 전용)');
  console.log(` ${new Date().toLocaleString('ko-KR')}`);
  console.log('='.repeat(80));

  const token = await adminLogin();
  console.log('\n관리자 로그인 OK');

  const overallStart = Date.now();

  // 브라우저와 동일: 섹션 테이블은 병렬, 기사 페이지는 순차, 둘은 서로 병렬
  const [tableResults, riderResult] = await Promise.all([
    Promise.all(SECTION_TABLES.map(spec => loadTable(spec, token))),
    loadAllRiders(token)
  ]);

  const overallMs = Date.now() - overallStart;

  console.log('\n[1] 섹션 테이블 (동시 로드)');
  let tableMax = 0;
  let tableBytes = 0;
  tableResults.forEach(r => {
    if (r.error) {
      console.log(`  ${r.label.padEnd(30)} 실패: ${r.error}`);
      return;
    }
    tableMax = Math.max(tableMax, r.elapsedMs);
    tableBytes += r.bytes;
    console.log(`  ${r.label.padEnd(30)} ${String(r.rows).padStart(6)}행 · ${(r.bytes / 1024 / 1024).toFixed(2)} MB · ${(r.elapsedMs / 1000).toFixed(1)}초`);
  });
  console.log(`  → 가장 느린 것 ${(tableMax / 1000).toFixed(1)}초 · 총 전송 ${(tableBytes / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n[2] 기사 전체 로드 (순차 페이지)');
  riderResult.pages.forEach((p, i) => {
    console.log(p.error
      ? `  page ${i + 1}: 실패 ${p.error} (${p.ms}ms)`
      : `  page ${i + 1}: ${String(p.count).padStart(3)}명 · ${p.ms}ms`);
  });
  console.log(`  count API: ${riderResult.countMs}ms`);
  console.log(`  → ${riderResult.requests}요청 + count 1회 · ${(riderResult.elapsedMs / 1000).toFixed(1)}초`);

  console.log('\n[3] 기사 매칭 정확성 (전원 로드됐는지)');
  const complete = riderResult.loaded === riderResult.total && riderResult.loaded === riderResult.dbCount;
  console.log(`  로드 ${riderResult.loaded}명 / API total ${riderResult.total} / count API ${riderResult.dbCount}`);
  console.log(`  → ${complete ? 'OK — 전원 로드. 일부만 매칭될 위험 없음' : '★ 불일치 — 확인 필요 ★'}`);

  console.log('\n[4] 기사 페이지 크기별 비교 (전원 로드 유지 확인 포함)');
  const sizes = (process.env.RIDER_PAGE_SIZES || '100,200,500')
    .split(',')
    .map(s => Number(s.trim()))
    .filter(Boolean);
  const comparison = await compareRiderPageSizes(token, sizes);
  console.log('  요청limit  실제요청수  로드/전체      소요      전원로드');
  comparison.forEach(c => {
    console.log(
      `  ${String(c.size).padStart(7)}  ${String(c.requests).padStart(9)}  ${String(c.loaded).padStart(4)}/${String(c.total).padEnd(5)}  ${((c.elapsedMs) / 1000).toFixed(1).padStart(6)}초  ${c.complete ? 'OK' : '★불일치★'}`
    );
  });
  console.log('  ※ 서버가 limit 을 상한으로 깎으면 실제요청수가 줄지 않는다 (현재 상한 200).');

  console.log('\n' + '='.repeat(80));
  console.log(` 화면 진입 체감 시간 ≈ ${(overallMs / 1000).toFixed(1)}초`);
  console.log(`   (섹션 테이블 ${(tableMax / 1000).toFixed(1)}초 · 기사 로드 ${(riderResult.elapsedMs / 1000).toFixed(1)}초 — 병렬)`);
  console.log('='.repeat(80));
  console.log(`\n 남은 병목: ${riderResult.elapsedMs > tableMax ? '기사 로드 (순차 왕복)' : '섹션 테이블'}`);
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

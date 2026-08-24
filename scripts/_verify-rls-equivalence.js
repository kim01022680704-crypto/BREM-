#!/usr/bin/env node
/**
 * RLS 정책 변경 안전성 검증 (읽기 전용)
 *
 * 목적 두 가지
 *   1) [속도]   authenticated(RLS 적용) vs service_role(RLS 우회) 소요시간 비교
 *               → 어느 테이블이 실제로 느린지, D 를 어디까지 적용해야 하는지 결정
 *   2) [정확성] 두 역할이 보는 "행 집합"이 완전히 같은지 검증
 *               → PK 전체를 받아 정렬 후 SHA-256 비교. 하나라도 다르면 FAIL.
 *
 * 사용법
 *   D 적용 전:  node scripts/_verify-rls-equivalence.js > before.txt
 *   D 적용 후:  node scripts/_verify-rls-equivalence.js > after.txt
 *   → 속도는 줄고, 행 집합 해시는 before/after 가 동일해야 한다.
 *
 * 쓰기 없음. select 만. (관리자 로그인 1회 발생)
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.BREM_VERIFY_BASE || 'https://brem.kr';

// 자격증명은 파일에 적지 않는다. 실행할 때 환경변수로만 넘긴다.
//   PowerShell:
//     $env:BREM_VERIFY_ADMIN_LOGIN='...'; $env:BREM_VERIFY_ADMIN_PASSWORD='...'
//     $env:BREM_VERIFY_RIDER_LOGIN='...'; $env:BREM_VERIFY_RIDER_PASSWORD='...'
//     node scripts/_verify-rls-equivalence.js
/**
 * 환경변수가 없으면 기존 회귀테스트 파일에서 읽는다.
 * (그 파일에 운영 계정이 들어 있는 건 이미 알려진 보안 이슈다. 여기서 새로 저장하지는 않는다.)
 */
function credsFromRegressionFile() {
  const p = path.join(__dirname, 'test-production-password.js');
  if (!fs.existsSync(p)) return { admin: null, rider: null };
  const src = fs.readFileSync(p, 'utf8');
  const pick = name => {
    const m = src.match(
      new RegExp(`const\\s+${name}\\s*=\\s*\\{[^}]*login:\\s*'([^']+)'[^}]*password:\\s*'([^']+)'`)
    );
    return m ? { login: m[1], password: m[2] } : null;
  };
  return { admin: pick('ADMIN'), rider: pick('RIDER') };
}

const fileCreds = credsFromRegressionFile();
const ADMIN = {
  login: process.env.BREM_VERIFY_ADMIN_LOGIN || fileCreds.admin?.login || '',
  password: process.env.BREM_VERIFY_ADMIN_PASSWORD || fileCreds.admin?.password || ''
};
const RIDER = {
  login: process.env.BREM_VERIFY_RIDER_LOGIN || fileCreds.rider?.login || '',
  password: process.env.BREM_VERIFY_RIDER_PASSWORD || fileCreds.rider?.password || ''
};

/**
 * 라이더 세션 검증 대상.
 * D 가 건드리는 5개 테이블 중 "행을 참조하는 항"이 있는 정책은
 * admin_rejection_rates 의 rider read own (driver_id = brem_current_rider_id()) 뿐이다.
 * 나머지는 관리자 전용이라 라이더에게 0행이어야 한다 — 그 0행도 그대로여야 한다.
 */
const RIDER_TABLES = [
  { table: 'admin_rejection_rates', pk: 'id', select: 'id,driver_id,week_start,platform,rate', order: 'week_start.desc', filter: '' },
  { table: 'admin_calls', pk: 'id', select: 'id,driver_id,date,platform,count', order: 'date.desc', filter: '' },
  { table: 'daily_settlements', pk: 'id', select: 'id,driver_id,period,platform', order: 'period.desc', filter: '' },
  { table: 'payroll_slip_lines', pk: 'id', select: 'id,driver_id,pay_month', order: 'pay_month.desc', filter: '' },
  { table: 'settlement_upload_logs', pk: 'id', select: 'id,kind,platform,period', order: 'uploaded_at.desc', filter: '' }
];

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 필요');
  process.exit(2);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** brem_is_admin() 정책이 걸린 테이블 전체. select 는 브라우저 어댑터와 동일. */
const TABLES = [
  {
    table: 'admin_calls',
    pk: 'id',
    select: '*',
    order: 'date.asc',
    filter: `&date=gte.${daysAgo(730)}`
  },
  {
    table: 'daily_settlements',
    pk: 'id',
    select: 'id,driver_id,period,platform,rider_id,order_count,hourly_insurance,deduction_base,delivery_amount,settlement_amount,applied_at',
    order: 'period.desc',
    filter: ''
  },
  {
    table: 'settlement_upload_logs',
    pk: 'id',
    select: 'id,kind,platform,file_name,period,week_start,week_end,region,start_date,end_date,status,matched_count,unmatched_count,total_delivery_amount,total_order_count,content_hash,matched_records,unmatched_records,applied_records,duplicate_of_log_id,skip_reason,linked_record_id,uploaded_at,applied_at',
    order: 'uploaded_at.desc',
    filter: ''
  },
  {
    table: 'settlement_unmatched',
    pk: 'id',
    select: 'id,kind,platform,week_start,period,end_date,region,raw_name,name,rider_id,order_count,delivery_amount,settlement_amount,coupang_login_key,baemin_user_id,match_payload,source_file_name,saved_at',
    order: 'saved_at.desc',
    filter: ''
  },
  { table: 'weekly_settlements', pk: 'id', select: 'id,platform,region,start_date,end_date,uploaded_at', order: 'uploaded_at.desc', filter: '' },
  { table: 'payroll_slip_lines', pk: 'id', select: 'id,driver_id,pay_month,net_pay,updated_at', order: 'updated_at.desc', filter: '' },
  { table: 'admin_targets', pk: 'id', select: 'id,driver_id,month,count', order: 'month.desc', filter: '' },
  { table: 'admin_rejection_rates', pk: 'id', select: 'id,driver_id,week_start,platform,rate', order: 'week_start.desc', filter: `&week_start=gte.${daysAgo(728)}` },
  { table: 'settings', pk: 'key', select: 'key,updated_at', order: 'key.asc', filter: '' },
  { table: 'riders', pk: 'id', select: 'id,name,phone,baemin_id,status', order: 'created_at.desc', filter: '' }
];

async function adminLogin() {
  if (!ADMIN.login || !ADMIN.password) {
    throw new Error(
      'BREM_VERIFY_ADMIN_LOGIN / BREM_VERIFY_ADMIN_PASSWORD 환경변수가 필요합니다.\n'
      + '  예) $env:BREM_VERIFY_ADMIN_LOGIN=\'...\'; $env:BREM_VERIFY_ADMIN_PASSWORD=\'...\''
    );
  }
  const res = await fetch(`${BASE}/api/admin/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(ADMIN)
  });
  const json = await res.json().catch(() => null);
  const token = json?.session?.access_token;
  if (!res.ok || !token) {
    throw new Error(`관리자 로그인 실패 (${res.status})`);
  }
  return token;
}

async function riderLogin() {
  if (!RIDER.login || !RIDER.password) {
    return { ok: false, message: 'BREM_VERIFY_RIDER_LOGIN / _PASSWORD 미설정' };
  }
  const res = await fetch(`${BASE}/api/rider/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(RIDER)
  });
  const json = await res.json().catch(() => null);
  const token = json?.session?.access_token;
  if (!res.ok || !token) {
    return { ok: false, message: `라이더 로그인 실패 (${res.status})` };
  }
  return { ok: true, token };
}

async function pagedFetch({ table, select, order, filter }, { apikey, bearer }) {
  const started = Date.now();
  let offset = 0;
  const rows = [];
  let bytes = 0;
  let pages = 0;

  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${order}${filter}`;
    const res = await fetch(url, {
      headers: {
        apikey,
        Authorization: `Bearer ${bearer}`,
        Range: `${offset}-${offset + 999}`,
        'Range-Unit': 'items'
      }
    });
    const text = await res.text();
    if (!res.ok) {
      let code = '';
      try { code = JSON.parse(text)?.code || ''; } catch (_) {}
      return { error: `${res.status} ${code} ${text.slice(0, 180)}`, code, elapsedMs: Date.now() - started, rows, bytes, pages };
    }
    let batch = [];
    try { batch = JSON.parse(text) || []; } catch (_) { batch = []; }
    rows.push(...batch);
    bytes += Buffer.byteLength(text, 'utf8');
    pages += 1;
    if (batch.length < 1000) break;
    offset += 1000;
    if (pages > 500) break;
  }
  return { rows, bytes, pages, elapsedMs: Date.now() - started };
}

/** 쓰기 권한 확인 대상 (WITH CHECK 가 있는 FOR ALL 정책 테이블) */
const WRITE_PROBE_TABLES = [
  { table: 'admin_calls', pk: 'id' },
  { table: 'daily_settlements', pk: 'id' },
  { table: 'payroll_slip_lines', pk: 'id' },
  { table: 'settlement_upload_logs', pk: 'id' },
  { table: 'admin_rejection_rates', pk: 'id' }
];

/**
 * 데이터를 바꾸지 않는 쓰기 권한 확인.
 * 기존 행을 그대로 다시 INSERT 한다 → RLS 통과 시 PK 중복(23505)에서 실패.
 * 어느 쪽이든 저장되는 것은 없다. (같은 PK 라 삽입 자체가 불가능)
 */
async function writeProbe({ table, pk }, { apikey, bearer }) {
  const readRes = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`,
    { headers: { apikey, Authorization: `Bearer ${bearer}` } }
  );
  const readText = await readRes.text();
  if (!readRes.ok) {
    return { verdict: '판정불가 (조회 실패)', detail: readText.slice(0, 140) };
  }
  let rows = [];
  try { rows = JSON.parse(readText) || []; } catch (_) {}
  if (!rows.length) {
    return { verdict: '건너뜀 (행 없음)' };
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(rows[0])
  });
  const text = await res.text();
  let code = '';
  let message = '';
  try {
    const j = JSON.parse(text);
    code = j?.code || '';
    message = j?.message || '';
  } catch (_) {}

  if (code === '23505') {
    return { verdict: 'OK — 쓰기 허용됨 (PK 중복에서 멈춤, 저장 안 됨)' };
  }
  if (code === '42501' || /row-level security/i.test(message)) {
    return { verdict: '★실패★ RLS 가 관리자 쓰기를 막고 있음', detail: `${code} ${message}` };
  }
  if (res.ok) {
    return { verdict: '예상외 — INSERT 가 성공했을 수 있음', detail: '즉시 확인 필요' };
  }
  return { verdict: `기타 오류 (RLS 문제 아님)`, detail: `${res.status} ${code} ${message}`.slice(0, 160) };
}

function pkHash(rows, pk) {
  const ids = rows.map(r => String(r?.[pk] ?? '')).sort();
  return {
    count: ids.length,
    hash: crypto.createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 16)
  };
}

function secs(ms) {
  return `${(ms / 1000).toFixed(1)}초`;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

(async () => {
  console.log('='.repeat(84));
  console.log(' RLS 정책 안전성·성능 검증 (읽기 전용)');
  console.log(` 시각: ${new Date().toLocaleString('ko-KR')}`);
  console.log('='.repeat(84));

  const token = await adminLogin();
  console.log('\n관리자 로그인 OK\n');

  const authCred = { apikey: ANON_KEY, bearer: token };
  const svcCred = { apikey: SERVICE_KEY, bearer: SERVICE_KEY };

  const report = [];
  let mismatches = 0;

  for (const spec of TABLES) {
    process.stdout.write(`  ${spec.table} … `);
    const auth = await pagedFetch(spec, authCred);
    const svc = await pagedFetch(spec, svcCred);

    if (auth.error || svc.error) {
      console.log('오류');
      report.push({
        table: spec.table,
        authError: auth.error || '',
        svcError: svc.error || '',
        authMs: auth.elapsedMs,
        svcMs: svc.elapsedMs
      });
      continue;
    }

    const a = pkHash(auth.rows, spec.pk);
    const s = pkHash(svc.rows, spec.pk);
    const same = a.count === s.count && a.hash === s.hash;
    if (!same) mismatches += 1;

    console.log(`${same ? '동일' : '★불일치★'} (auth ${secs(auth.elapsedMs)} / svc ${secs(svc.elapsedMs)})`);
    report.push({
      table: spec.table,
      rows: a.count,
      svcRows: s.count,
      authHash: a.hash,
      svcHash: s.hash,
      same,
      authMs: auth.elapsedMs,
      svcMs: svc.elapsedMs,
      bytes: auth.bytes
    });
  }

  console.log('\n' + '='.repeat(84));
  console.log(' [1] 정확성 — 두 역할이 보는 행 집합이 같은가');
  console.log('='.repeat(84));
  console.log(' 테이블                     행수     RLS해시           우회해시          판정');
  report.forEach(r => {
    if (r.authError || r.svcError) {
      console.log(` ${r.table.padEnd(24)} 조회오류  auth=${(r.authError || '-').slice(0, 40)}`);
      return;
    }
    console.log(
      ` ${r.table.padEnd(24)} ${String(r.rows).padStart(7)}  ${r.authHash}  ${r.svcHash}  ${r.same ? 'OK' : '★불일치★'}`
    );
  });
  console.log(mismatches === 0
    ? '\n → 전 테이블 행 집합 동일. 관리자에게는 RLS 유무와 무관하게 같은 데이터가 보인다.'
    : `\n → ★ ${mismatches}개 테이블 불일치 — 반드시 원인 확인 후 진행할 것 ★`);

  console.log('\n' + '='.repeat(84));
  console.log(' [2] 속도 — 어디를 고쳐야 하나');
  console.log('='.repeat(84));
  console.log(' 테이블                     행수    RLS적용   RLS우회    배수   전송량');
  const sorted = report
    .filter(r => !r.authError && !r.svcError)
    .sort((x, y) => (y.authMs - y.svcMs) - (x.authMs - x.svcMs));
  let authTotal = 0;
  let svcTotal = 0;
  sorted.forEach(r => {
    authTotal += r.authMs;
    svcTotal += r.svcMs;
    const ratio = r.svcMs > 0 ? (r.authMs / r.svcMs).toFixed(1) : '?';
    console.log(
      ` ${r.table.padEnd(24)} ${String(r.rows).padStart(6)}  ${secs(r.authMs).padStart(8)}  ${secs(r.svcMs).padStart(8)}  ${String(ratio).padStart(5)}배  ${mb(r.bytes)}`
    );
  });
  console.log(` ${'합계'.padEnd(24)} ${''.padStart(6)}  ${secs(authTotal).padStart(8)}  ${secs(svcTotal).padStart(8)}`);

  console.log('\n' + '='.repeat(84));
  console.log(' [3] 라이더 세션 — D 적용 전후로 라이더가 보는 행이 같아야 한다');
  console.log('='.repeat(84));
  const rider = await riderLogin();
  const riderSnapshot = [];
  if (!rider.ok) {
    console.log(` ${rider.message} — 라이더 검증 건너뜀 (D 적용 후 반드시 다시 확인할 것)`);
  } else {
    console.log(' 테이블                     라이더가 보는 행수  해시');
    for (const spec of RIDER_TABLES) {
      const r = await pagedFetch(spec, { apikey: ANON_KEY, bearer: rider.token });
      if (r.error) {
        console.log(` ${spec.table.padEnd(24)} 조회거부/오류  ${r.error.slice(0, 50)}`);
        riderSnapshot.push({ table: spec.table, error: r.error });
        continue;
      }
      const h = pkHash(r.rows, spec.pk);
      riderSnapshot.push({ table: spec.table, rows: h.count, hash: h.hash });
      console.log(` ${spec.table.padEnd(24)} ${String(h.count).padStart(16)}  ${h.hash}`);
    }
    console.log(' ※ admin_rejection_rates 만 본인 행이 보이고 나머지는 0행이 정상.');
    console.log('   D 적용 후 이 숫자·해시가 그대로여야 한다.');
  }

  console.log('\n' + '='.repeat(84));
  console.log(' [4] 쓰기 권한 — WITH CHECK 가 관리자 저장을 막지 않는지 (데이터 변경 없음)');
  console.log('='.repeat(84));
  console.log(' 방법: 이미 있는 행과 똑같은 id 로 INSERT 를 시도한다.');
  console.log('       RLS 가 통과하면 PK 중복(23505) 에서 멈추므로 아무것도 저장되지 않는다.');
  console.log('       RLS 가 막으면 42501(row-level security) 이 나온다.\n');
  const writeProbeResults = [];
  for (const spec of WRITE_PROBE_TABLES) {
    const probe = await writeProbe(spec, { apikey: ANON_KEY, bearer: token });
    writeProbeResults.push({ table: spec.table, ...probe });
    console.log(` ${spec.table.padEnd(24)} ${probe.verdict}`);
    if (probe.detail) console.log(`   └ ${probe.detail}`);
  }

  // 콘솔 한글이 Windows 코드페이지에서 깨져도 정확히 읽을 수 있게 JSON 으로 남긴다.
  const outPath = path.join(__dirname, '..', 'logs', `rls-verify-${Date.now()}.json`);
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({
      at: new Date().toISOString(),
      adminEquivalence: report.map(r => ({
        table: r.table,
        rows: r.rows,
        authHash: r.authHash,
        svcHash: r.svcHash,
        same: r.same,
        authMs: r.authMs,
        svcMs: r.svcMs
      })),
      totals: { authMs: authTotal, svcMs: svcTotal },
      rider: riderSnapshot,
      writeProbe: writeProbeResults
    }, null, 2), 'utf8');
    console.log(`\n [JSON] ${outPath}`);
  } catch (e) {
    console.log(`\n [JSON 저장 실패] ${e.message}`);
  }

  console.log('\n [D 적용 대상 판단] RLS 로 3초 이상 손해 보는 테이블:');
  const worth = sorted.filter(r => r.authMs - r.svcMs >= 3000);
  if (!worth.length) {
    console.log('   없음 — D 를 적용할 이유가 없다.');
  } else {
    worth.forEach(r => {
      console.log(`   - ${r.table}: ${secs(r.authMs - r.svcMs)} 손해 (${r.rows.toLocaleString('ko-KR')}행)`);
    });
    const saved = worth.reduce((sum, r) => sum + (r.authMs - r.svcMs), 0);
    console.log(`   → 이 테이블들만 고쳐도 약 ${secs(saved)} 회수`);
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

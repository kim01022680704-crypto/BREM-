#!/usr/bin/env node
/**
 * 기사 한 명을 정산주(수~화) 단위로 전부 펼쳐본다 (읽기 전용)
 *
 *   node scripts/_audit-rider.js 이상호
 *   node scripts/_audit-rider.js 이상호5518
 *
 * 일정산·콜수·출금·주정산서·급여명세서·콜수편집이력을 한 화면에 모아
 * 어디서 어긋났는지 눈으로 짚을 수 있게 한다. 쓰기 없음.
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

const QUERY = (process.argv[2] || '').trim();
if (!QUERY) {
  console.error('사용법: node scripts/_audit-rider.js <기사이름 또는 쿠팡ID>');
  process.exit(2);
}
// "이상호5518" 처럼 이름+전화뒤4 로 들어오면 이름만 떼어 검색한다.
const NAME_PART = QUERY.replace(/[0-9]+$/, '') || QUERY;
const TAIL_PART = (QUERY.match(/([0-9]{4})$/) || [])[1] || '';

const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const digits = v => String(v || '').replace(/[^0-9]/g, '');

/** 정산주(수요일 시작) */
function weekStartOf(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 3 + 7) % 7));
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function fetchAll(table, columns, build) {
  const size = 1000;
  const out = [];
  for (let f = 0; ; f += size) {
    let q = supabase.from(table).select(columns).range(f, f + size - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

async function readSetting(key) {
  const { data, error } = await supabase.from('settings').select('value,updated_at').eq('key', key).maybeSingle();
  if (error) throw new Error(`settings ${key}: ${error.message}`);
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  return { value: v, updatedAt: data?.updated_at || null };
}

(async () => {
  console.log('='.repeat(96));
  console.log(` 기사 정밀 점검: "${QUERY}"  (읽기 전용)`);
  console.log('='.repeat(96));

  const { data: found, error } = await supabase
    .from('riders')
    .select('id,name,phone,baemin_id,status,join_date,created_at,raw_data')
    .ilike('name', `%${NAME_PART}%`);
  if (error) throw new Error(`riders: ${error.message}`);

  let riders = found || [];
  if (TAIL_PART && riders.length > 1) {
    const narrowed = riders.filter(r => digits(r.phone).slice(-4) === TAIL_PART);
    if (narrowed.length) riders = narrowed;
  }
  if (!riders.length) {
    console.log(`\n"${NAME_PART}" 로 등록된 기사가 없습니다.`);
    return;
  }

  console.log(`\n[기사 레코드] ${riders.length}건`);
  riders.forEach(r => {
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    const custom = String(raw.coupangId || raw.coupangLoginKey || raw.coupangLoginId || '').trim();
    const auto = `${String(r.name || '').replace(/\s/g, '')}${digits(r.phone).slice(-4)}`;
    console.log(`  "${r.name}" · ${r.status} · 전화 ${r.phone}`);
    console.log(`     id=${r.id}`);
    console.log(`     쿠팡키(자동)=${auto} · 커스텀=${custom || '없음'} · 배민ID=${r.baemin_id || '없음'}`);
    console.log(`     등록 ${String(r.created_at).slice(0, 10)} · 입사 ${r.join_date || '-'}`);
  });

  const ids = riders.map(r => r.id);
  const nameOf = id => (riders.find(r => r.id === id)?.name) || String(id).slice(0, 8);

  // ---- 원천 데이터 ----
  const daily = await fetchAll('daily_settlements',
    'driver_id,period,platform,order_count,delivery_amount,settlement_amount,applied_at',
    q => q.in('driver_id', ids));
  const calls = await fetchAll('admin_calls',
    'driver_id,date,platform,count,created_at,updated_at',
    q => q.in('driver_id', ids));
  const slips = await fetchAll('payroll_slip_lines',
    'driver_id,pay_month,gross_pay,net_pay,total_deduction,raw_data,created_at',
    q => q.in('driver_id', ids));

  const wdRaw = await readSetting('brem_payroll_withdrawal_requests_v1');
  const allWd = Array.isArray(wdRaw.value) ? wdRaw.value : [];
  const wd = allWd.filter(x => ids.includes(String(x.driverId || '')));

  const editRaw = await readSetting('brem_admin_call_edit_logs');
  const edits = (Array.isArray(editRaw.value) ? editRaw.value : [])
    .filter(x => ids.includes(String(x.driverId || '')));

  const weeklyBro = await fetchAll('weekly_settlements', 'id,platform,region,start_date,end_date,riders');
  const weeklyDirect = await readSetting('brem_admin_weekly_settlements_direct');
  const directList = Array.isArray(weeklyDirect.value) ? weeklyDirect.value : [];

  // ---- 주차 목록 ----
  const weeks = new Set();
  daily.forEach(d => weeks.add(weekStartOf(d.period)));
  calls.forEach(c => weeks.add(weekStartOf(c.date)));
  wd.forEach(x => { if (x.weekStart) weeks.add(weekStartOf(x.weekStart)); });
  slips.forEach(l => {
    const ws = String(l.raw_data?.settlementWeekStart || '').slice(0, 10);
    if (ws) weeks.add(weekStartOf(ws));
  });
  const weekList = [...weeks].sort();

  console.log(`\n일정산 ${daily.length} · 콜수 ${calls.length} · 출금 ${wd.length} · 급여줄 ${slips.length} · 콜수편집 ${edits.length}`);

  for (const wk of weekList) {
    const end = addDays(wk, 6);
    console.log('\n' + '─'.repeat(96));
    console.log(` 정산주 ${wk}(수) ~ ${end}(화)`);
    console.log('─'.repeat(96));

    const dW = daily.filter(d => weekStartOf(d.period) === wk)
      .sort((a, b) => String(a.period).localeCompare(String(b.period)));
    const cW = calls.filter(c => weekStartOf(c.date) === wk)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // 날짜별로 일정산 vs 콜수 나란히
    const days = [...new Set([...dW.map(d => String(d.period).slice(0, 10)), ...cW.map(c => String(c.date).slice(0, 10))])].sort();
    if (days.length) {
      console.log('  날짜        플랫폼   일정산콜  정산금액      콜수기록  차이');
      days.forEach(day => {
        ['coupang', 'baemin'].forEach(p => {
          const ds = dW.filter(d => String(d.period).slice(0, 10) === day && d.platform === p);
          const cs = cW.filter(c => String(c.date).slice(0, 10) === day && c.platform === p);
          if (!ds.length && !cs.length) return;
          const dCall = ds.reduce((a, x) => a + Number(x.order_count || 0), 0);
          const dAmt = ds.reduce((a, x) => a + Number(x.settlement_amount || 0), 0);
          const cCall = cs.reduce((a, x) => a + Number(x.count || 0), 0);
          const mark = ds.length === 0 ? '  ← 일정산 없음(콜수만)'
            : (cs.length === 0 ? '  ← 콜수 없음' : (dCall !== cCall ? `  ← 불일치 ${cCall - dCall}` : ''));
          console.log(`  ${day}  ${p.padEnd(8)} ${String(dCall).padStart(6)}  ${won(dAmt).padStart(11)}  ${String(cCall).padStart(8)}${mark}`);
          if (ds.length > 1) console.log(`              ★ 같은 날 일정산 행 ${ds.length}개 (중복)`);
        });
      });
      const totCall = dW.reduce((a, x) => a + Number(x.order_count || 0), 0);
      const totAmt = dW.reduce((a, x) => a + Number(x.settlement_amount || 0), 0);
      const totCalls = cW.reduce((a, x) => a + Number(x.count || 0), 0);
      console.log(`  합계: 일정산 ${totCall}콜 / ${won(totAmt)}원 · 콜수기록 ${totCalls}콜`);
    } else {
      console.log('  일정산·콜수 없음');
    }

    // 주정산서에 들어있나
    const inBro = weeklyBro.filter(w => weekStartOf(w.start_date) === wk
      && (Array.isArray(w.riders) ? w.riders : []).some(r => ids.includes(String(r?.matchedRiderId || ''))));
    const inDirect = directList.filter(w => weekStartOf(w.startDate) === wk
      && (Array.isArray(w.riders) ? w.riders : []).some(r => ids.includes(String(r?.matchedRiderId || ''))));
    const showWeekly = (label, list, riderKey) => {
      list.forEach(w => {
        const row = (Array.isArray(w.riders) ? w.riders : []).find(r => ids.includes(String(r?.matchedRiderId || '')));
        console.log(`  ${label} ${String(w.platform).padEnd(8)} ${String(w.region || '-').slice(0, 28).padEnd(28)}`
          + ` 주간콜 ${String(row?.weeklyOrderCount ?? '-').padStart(5)}`
          + ` · 시스템콜 ${String(row?.systemCallCount ?? '-').padStart(5)}`
          + ` · 일치 ${row?.callCountMatched === false ? 'X' : 'O'}${row?.callCountIgnored ? '(무시승인)' : ''}`);
      });
    };
    if (inBro.length || inDirect.length) {
      showWeekly('주정산서(브로) ', inBro);
      showWeekly('주정산서(직계약)', inDirect);
    } else {
      console.log('  주정산서에 이 기사가 없음');
    }

    // 출금
    const wW = wd.filter(x => x.weekStart && weekStartOf(x.weekStart) === wk)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    if (wW.length) {
      let sum = 0;
      wW.forEach(x => {
        const amt = Math.round(Number(x.amount || 0));
        const fee = Math.round(Number(x.feeAmount || 0));
        if (x.status === 'pending' || x.status === 'completed') sum += amt + fee;
        console.log(`  출금 ${String(x.createdAt).slice(0, 19)} ${String(x.platform || '-').padEnd(8)}`
          + ` ${won(amt).padStart(10)}원 +수수료 ${won(fee).padStart(6)}`
          + ` · ${String(x.status).padEnd(9)} · 신청시한도 ${x.availableAtRequest == null ? '기록없음' : won(x.availableAtRequest)}`);
      });
      console.log(`  출금 합계(대기+완료, 수수료 포함): ${won(sum)}원`);
    } else {
      console.log('  출금 없음');
    }

    // 급여명세서
    const sW = slips.filter(l => weekStartOf(String(l.raw_data?.settlementWeekStart || '').slice(0, 10) || '1970-01-01') === wk);
    if (sW.length) {
      sW.forEach(l => console.log(`  급여줄 ${String(l.raw_data?.platform || '-').padEnd(8)}`
        + ` 지급 ${won(l.gross_pay).padStart(10)} · 공제 ${won(l.total_deduction).padStart(9)} · 실지급 ${won(l.net_pay).padStart(10)}`
        + ` · 생성 ${String(l.created_at).slice(0, 19)}`));
    } else {
      console.log('  급여명세서 줄 없음');
    }

    // 콜수 편집 이력
    const eW = edits.filter(e => weekStartOf(e.date) === wk);
    eW.forEach(e => console.log(`  ★ 콜수편집 ${String(e.editedAt).slice(0, 19)} ${e.action} ${e.date} ${e.platform}`
      + ` ${e.previousCount == null ? '(없음)' : e.previousCount} → ${e.nextCount} · by ${e.editedBy || '-'}`
      + `  ← 「주간서 기준 입력」이면 그 주 일정산이 지워졌다`));
  }

  console.log('\n' + '='.repeat(96));
  console.log(' 참고: 취소된 출금');
  const cancelled = wd.filter(x => x.status !== 'pending' && x.status !== 'completed');
  if (!cancelled.length) console.log('  없음');
  cancelled.forEach(x => console.log(`  ${String(x.createdAt).slice(0, 19)} ${won(x.amount)}원 · ${x.status}`));
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * 기사 콜수·출금가능금액을 쿠팡 크롤 원본과 대조한다 (읽기 전용)
 *
 *   node scripts/_audit-rider-vs-crawl.js 이상호 2026-08-19
 *
 * 동명이인이 있으면 전부 나란히 보여준다. 출금가능금액은 서버가 실제로 쓰는
 * calcPayoutFromSettlement 을 그대로 불러 계산한다(식을 새로 구현하지 않는다).
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

const withdrawal = require('../server/rider-withdrawal');
const A = withdrawal.__audit;
if (!A?.calcPayoutFromSettlement) {
  console.error('server/rider-withdrawal.js 의 __audit 노출이 바뀌었습니다.');
  process.exit(2);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const NAME = (process.argv[2] || '').replace(/[0-9]+$/, '').trim();
const WEEK = (process.argv[3] || '').trim();
if (!NAME) {
  console.error('사용법: node scripts/_audit-rider-vs-crawl.js <이름> [정산주시작일(수)]');
  process.exit(2);
}

const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const digits = v => String(v || '').replace(/[^0-9]/g, '');
const nameKey = v => String(v || '').replace(/\s+/g, '').toLowerCase();

function weekStartOf(d) {
  const x = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() - 3 + 7) % 7));
  return x.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function daysOf(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

async function readSetting(key, fallback) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(`settings ${key}: ${error.message}`);
  let v = data?.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = fallback; } }
  return v === undefined || v === null ? fallback : v;
}

/** 크롤 parsed_json 에서 완료 건수를 뽑는다 (server/coupang-erp-sync.js metricsFromParsed 와 동일 키) */
function completeOf(parsed = {}) {
  return Math.max(0, Number(
    parsed.completeCount ?? parsed.complete ?? parsed.totalComplete ?? parsed.completedCount ?? 0
  ) || 0);
}

(async () => {
  const { data: riders, error } = await supabase
    .from('riders')
    .select('id,name,phone,baemin_id,status,created_at,raw_data')
    .ilike('name', `%${NAME}%`);
  if (error) throw new Error(`riders: ${error.message}`);
  if (!riders?.length) {
    console.log(`"${NAME}" 로 등록된 기사가 없습니다.`);
    return;
  }

  const feesByPlatform = A.normalizeFees(await readSetting(A.FEES_KEY, {}));
  const excludedRaw = await readSetting(A.EXCLUDED_SETTLEMENTS_KEY, []);
  const excluded = new Set((Array.isArray(excludedRaw) ? excludedRaw : [])
    .map(x => String(typeof x === 'string' ? x : (x?.id || '')).trim()).filter(Boolean));
  const requests = A.normalizeRequestList(await readSetting(withdrawal.REQUESTS_KEY, []));

  console.log('='.repeat(100));
  console.log(` "${NAME}" 콜수·출금가능금액 대조 (읽기 전용)`);
  console.log('='.repeat(100));
  console.log(`\n동명이인 ${riders.length}명 · 수수료설정 ${JSON.stringify(feesByPlatform)}`);
  console.log(`제외 처리된 정산 ${excluded.size}건`);

  for (const r of riders) {
    const raw = r.raw_data && typeof r.raw_data === 'object' ? r.raw_data : {};
    const custom = String(raw.coupangId || raw.coupangLoginKey || raw.coupangLoginId || '').trim();
    const autoKey = `${String(r.name || '').replace(/\s/g, '')}${digits(r.phone).slice(-4)}`;

    console.log('\n' + '='.repeat(100));
    console.log(` "${r.name}" · ${r.status} · 전화 ${r.phone} · 등록 ${String(r.created_at).slice(0, 10)}`);
    console.log(` id=${r.id}`);
    console.log(` 쿠팡키(자동)=${autoKey} · 커스텀=${custom || '없음'} · 배민ID=${r.baemin_id || '없음'}`);
    console.log('='.repeat(100));

    const { data: dailyAll } = await supabase
      .from('daily_settlements')
      .select('id,driver_id,period,platform,order_count,delivery_amount,settlement_amount,deduction_base,hourly_insurance')
      .eq('driver_id', r.id)
      .order('period');
    const daily = dailyAll || [];

    const weeks = WEEK ? [WEEK] : [...new Set(daily.map(d => weekStartOf(d.period)))].sort();
    if (!weeks.length) {
      console.log('  일정산 기록이 없습니다.');
      continue;
    }

    // 크롤 원본 (쿠팡 앱 실적) — 자동키·커스텀키 양쪽으로 찾는다
    const keys = [nameKey(autoKey), nameKey(custom)].filter(Boolean);
    const { data: crawlAll } = await supabase
      .from('coupang_collect_items')
      .select('collect_date,match_key,rider_name,phone_number,parsed_json')
      .eq('source_menu', 'rider_daily')
      .in('match_key', [...new Set([autoKey, custom].filter(Boolean))]);
    const crawl = crawlAll || [];

    // 이름으로만 잡히는 크롤(키가 안 맞는 경우) 도 같이 본다
    const { data: crawlByName } = await supabase
      .from('coupang_collect_items')
      .select('collect_date,match_key,rider_name,phone_number,parsed_json')
      .eq('source_menu', 'rider_daily')
      .ilike('rider_name', `%${NAME}%`);
    const otherKeys = [...new Set((crawlByName || [])
      .map(x => String(x.match_key || ''))
      .filter(k => k && !keys.includes(nameKey(k))))];
    if (otherKeys.length) {
      console.log(`  ※ 이름은 같은데 키가 다른 크롤 데이터: ${otherKeys.join(', ')}`);
    }

    for (const wk of weeks) {
      const days = daysOf(wk);
      console.log(`\n  ── 정산주 ${wk}(수) ~ ${addDays(wk, 6)}(화) ──`);
      // 크롤 completeCount 는 가중치가 들어간 소수점 실적 지표라 정산서 콜수와 단위가 다르다.
      // 숫자를 맞대보는 용도가 아니라 "그날 일했는가"만 보는 참고 열이다.
      console.log('  날짜        크롤실적*  일정산콜  일정산금액    실지급(서버계산)  제외');

      let sumNet = 0;
      let sumCrawl = 0;
      let sumOrder = 0;
      let gaps = 0;

      for (const day of days) {
        const cRows = crawl.filter(x => String(x.collect_date).slice(0, 10) === day);
        const crawlCalls = cRows.reduce((a, x) => a + completeOf(x.parsed_json || {}), 0);
        const dRows = daily.filter(x => String(x.period).slice(0, 10) === day && x.platform === 'coupang');
        const orderCalls = dRows.reduce((a, x) => a + Number(x.order_count || 0), 0);
        const amount = dRows.reduce((a, x) => a + Number(x.settlement_amount || 0), 0);
        const isExcluded = dRows.some(x => excluded.has(String(x.id)));
        const net = dRows
          .filter(x => !excluded.has(String(x.id)))
          .map(x => A.calcPayoutFromSettlement(x, feesByPlatform))
          .reduce((a, x) => a + Number(x.netPay || 0), 0);

        if (!cRows.length && !dRows.length) continue;
        sumCrawl += crawlCalls;
        sumOrder += orderCalls;
        sumNet += net;
        // 크롤 실적은 있는데 일정산이 없는 날 = 일한 기록은 있는데 돈이 안 들어온 날
        if (crawlCalls > 0 && !dRows.length) gaps += 1;
        console.log(`  ${day}  ${crawlCalls.toFixed(1).padStart(9)}  ${String(orderCalls).padStart(8)}`
          + `  ${won(amount).padStart(11)}  ${won(net).padStart(15)}  ${isExcluded ? '제외됨' : ''}`
          + `${crawlCalls > 0 && !dRows.length ? '   ★ 일했는데 일정산 없음' : ''}`
          + `${!dRows.length && !crawlCalls ? '   (실적 없음)' : ''}`);
      }

      // 배민도 합산 (실지급은 플랫폼 합계)
      const baemin = daily.filter(x => days.includes(String(x.period).slice(0, 10)) && x.platform === 'baemin');
      const baeminNet = baemin
        .filter(x => !excluded.has(String(x.id)))
        .map(x => A.calcPayoutFromSettlement(x, feesByPlatform))
        .reduce((a, x) => a + Number(x.netPay || 0), 0);
      if (baemin.length) {
        console.log(`  (배민 ${baemin.length}건 · 콜 ${baemin.reduce((a, x) => a + Number(x.order_count || 0), 0)}`
          + ` · 실지급 ${won(baeminNet)})`);
      }

      console.log(`  합계: 일정산 ${sumOrder}콜 (크롤 실적지표 ${sumCrawl.toFixed(1)} — 단위가 달라 직접 비교 대상 아님)`);
      if (gaps) console.log(`  ★ 크롤 실적은 있는데 일정산이 없는 날 ${gaps}일 — 돈이 안 들어왔거나 다른 기사에게 붙었다`);
      console.log(`  실지급 합계(서버계산): 쿠팡 ${won(sumNet)} + 배민 ${won(baeminNet)} = ${won(sumNet + baeminNet)}원`);

      const mine = requests.filter(x => String(x.driverId) === r.id
        && String(x.weekStart).slice(0, 10) === wk
        && (x.status === 'pending' || x.status === 'completed'));
      const used = mine.reduce((a, x) => a + Math.round(Number(x.amount || 0)) + Math.round(Number(x.feeAmount || 0)), 0);
      mine.forEach(x => console.log(`  출금 ${String(x.createdAt).slice(0, 19)} ${String(x.platform || '-').padEnd(8)}`
        + ` ${won(x.amount)}원 +수수료 ${won(x.feeAmount)} · ${x.status}`));
      console.log(`  출금 사용 ${won(used)}원 → 남은 출금가능금액 ${won(sumNet + baeminNet - used)}원`);
    }
  }
})().catch(err => {
  console.error('\n예외:', err.message || err);
  process.exit(1);
});

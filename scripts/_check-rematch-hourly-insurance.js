/**
 * 재매칭으로 들어온 일정산 행에서 시간제보험이 빠졌는지 확인 (읽기 전용).
 *
 * 배경: settlementUnmatched.retryDailyMatching 이 매칭된 건을 daily_settlements 로
 * 올릴 때 hourlyInsurance 를 넘기지 않는다. 그래서 재매칭된 건만 시간제보험이
 * 0이 되어 실지급액이 부풀 수 있다.
 *
 * 재매칭 행 판별: 같은 날짜(period)의 대량 업로드는 applied_at 이 거의 동일하다.
 * 재매칭은 며칠 뒤에 이뤄지므로 그 날짜의 최다 applied_at 시각에서 크게 벗어난다.
 *
 * 주의: 시간제보험은 가입한 기사만 발생하므로 "0이면 누락" 이 아니다.
 * 재매칭 행인지 여부와 함께 봐야 의미가 있다.
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
    const eq = t.indexOf('='); if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

// Supabase 기본 1000행 제한 때문에 반드시 페이지로 나눠 전부 가져온다.
async function fetchAll(table, select) {
  const size = 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + size - 1);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

const HOUR = 60 * 60 * 1000;

(async () => {
  const rows = await fetchAll(
    'daily_settlements',
    'id,driver_id,period,platform,order_count,hourly_insurance,settlement_amount,applied_at'
  );
  const riders = await fetchAll('riders', 'id,name');
  const nameById = new Map(riders.map(r => [r.id, r.name || '']));

  const coupang = rows.filter(r => String(r.platform) === 'coupang');
  console.log(`일정산 전체 ${rows.length.toLocaleString('ko-KR')}행 (쿠팡 ${coupang.length.toLocaleString('ko-KR')}행)\n`);

  const byPeriod = new Map();
  coupang.forEach(r => {
    const key = String(r.period || '').slice(0, 10);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key).push(r);
  });

  const lateRows = [];
  [...byPeriod.entries()].sort().forEach(([period, list]) => {
    // 그 날짜의 대표 업로드 시각 = applied_at 을 시간 단위로 뭉쳐 가장 많은 구간
    const buckets = new Map();
    list.forEach(r => {
      const t = Date.parse(r.applied_at || '');
      if (!Number.isFinite(t)) return;
      const bucket = Math.floor(t / HOUR);
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
    });
    if (!buckets.size) return;
    const mainBucket = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const mainTime = mainBucket * HOUR;

    list.forEach(r => {
      const t = Date.parse(r.applied_at || '');
      if (!Number.isFinite(t)) return;
      // 대표 업로드보다 6시간 이상 늦게 들어온 건 = 나중에 재매칭/재반영된 건
      if (t - mainTime >= 6 * HOUR) {
        lateRows.push({ period, mainTime, ...r });
      }
    });
  });

  if (!lateRows.length) {
    console.log('대표 업로드보다 한참 늦게 들어온 행이 없습니다. 재매칭으로 추가된 건이 없다는 뜻입니다.');
    return;
  }

  console.log(`재매칭/재반영으로 나중에 들어온 것으로 보이는 행 — ${lateRows.length}건\n`);
  const byDriver = new Map();
  lateRows.forEach(r => {
    if (!byDriver.has(r.driver_id)) byDriver.set(r.driver_id, []);
    byDriver.get(r.driver_id).push(r);
  });

  let zeroCount = 0;
  [...byDriver.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([driverId, list]) => {
      const name = nameById.get(driverId) || '(이름없음)';
      const zero = list.filter(r => Number(r.hourly_insurance || 0) === 0);
      zeroCount += zero.length;
      const amount = list.reduce((sum, r) => sum + Number(r.settlement_amount || 0), 0);
      console.log(`  ${name} (${driverId}) — ${list.length}일 · 정산금액 합 ${amount.toLocaleString('ko-KR')}원 · 시간제보험 0인 날 ${zero.length}일`);
      list.sort((a, b) => a.period.localeCompare(b.period)).forEach(r => {
        const delay = Math.round((Date.parse(r.applied_at) - r.mainTime) / HOUR);
        console.log(`      ${r.period} · 시간제보험 ${Number(r.hourly_insurance || 0).toLocaleString('ko-KR')} · 정산 ${Number(r.settlement_amount || 0).toLocaleString('ko-KR')} · 대표업로드+${delay}시간`);
      });
    });

  console.log(`\n요약: 늦게 들어온 ${lateRows.length}건 중 시간제보험 0인 건 ${zeroCount}건`);
  console.log('시간제보험은 가입 기사만 발생하므로 0이라고 곧 누락은 아닙니다.');
  console.log('해당 기사가 다른 날에는 시간제보험이 있는지 함께 봐야 판단됩니다.\n');

  // 늦게 들어온 행이 0인데, 같은 기사가 다른 날에는 값이 있다면 누락 의심
  const suspect = [];
  byDriver.forEach((list, driverId) => {
    const otherDays = coupang.filter(r => r.driver_id === driverId
      && !list.some(l => l.id === r.id)
      && Number(r.hourly_insurance || 0) > 0);
    if (!otherDays.length) return;
    const avg = otherDays.reduce((s, r) => s + Number(r.hourly_insurance || 0), 0) / otherDays.length;
    list.filter(r => Number(r.hourly_insurance || 0) === 0).forEach(r => {
      suspect.push({ name: nameById.get(driverId) || driverId, period: r.period, avg: Math.round(avg) });
    });
  });

  if (!suspect.length) {
    console.log('누락 의심 건 없음 — 늦게 들어온 행의 기사들은 다른 날에도 시간제보험이 없습니다.');
    return;
  }
  console.log(`누락 의심 ${suspect.length}건 (그 기사는 다른 날엔 시간제보험이 있음):`);
  suspect.forEach(s => {
    console.log(`  ${s.name} · ${s.period} · 다른 날 평균 ${s.avg.toLocaleString('ko-KR')}원`);
  });
})().catch(e => { console.error('실패:', e.message); process.exit(1); });

/**
 * 일정산 업로드 기록 ↔ 저장된 일정산(daily_settlements) 대조 (읽기 전용)
 *   node scripts/_diag-daily-upload-gaps.js 2026-09-16 [2026-10-06]
 *
 * 정산일·플랫폼마다 "마지막 업로드 기록"의 매칭 행을 기사 단위로 합쳐
 * 저장된 금액·건수와 비교한다.
 *  - 저장 없음 / 금액 다름 / 같은 기사 여러 줄(합쳐지지 않고 한 줄만 남는 경우)
 *  - 급여일정산 제외 목록에 들어간 행
 *  - 중복스킵·저장누락 상태 기록
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getServiceClient } = require('../server/admin-bootstrap');
const { fetchAllPages } = require('../server/supabase-paginate');

const from = process.argv[2] || '2026-09-16';
const to = process.argv[3] || '2099-12-31';
const n = v => Math.round(Number(v || 0)) || 0;
const fmt = v => n(v).toLocaleString('ko-KR');
const amountOf = r => n(r.settlementAmount ?? r.deliveryAmount);

(async () => {
  const sb = getServiceClient();
  const logs = await fetchAllPages((o, s) => sb.from('settlement_upload_logs')
    .select('id,kind,platform,file_name,period,status,matched_count,unmatched_count,matched_records,applied_records,skip_reason,updated_at')
    .eq('kind', 'daily').gte('period', from).lte('period', to)
    .order('period', { ascending: true }).range(o, o + s - 1));
  const saved = await fetchAllPages((o, s) => sb.from('daily_settlements')
    .select('id,driver_id,period,platform,settlement_amount,order_count')
    .gte('period', from).lte('period', to).range(o, o + s - 1));
  const { data: exRow } = await sb.from('settings').select('value').eq('key', 'brem_payroll_daily_excluded_settlements_v1').maybeSingle();
  const excluded = new Set(Array.isArray(exRow?.value) ? exRow.value.map(String) : []);
  const { data: drv } = await sb.from('riders').select('id,name');
  const nameOf = new Map((drv || []).map(d => [String(d.id), d.name]));

  const savedBy = new Map(saved.map(r => [`${r.driver_id}|${String(r.period).slice(0, 10)}|${r.platform}`, r]));

  // 정산일·플랫폼별 업로드 기록들 (시간순)
  const groups = new Map();
  logs.forEach(log => {
    const key = `${String(log.period).slice(0, 10)}|${log.platform}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(log);
  });

  console.log(`업로드 기록 ${logs.length}건 · 저장된 일정산 ${saved.length}줄 · 급여일정산 제외 ${excluded.size}건\n`);
  let problemDays = 0;
  for (const [key, list] of [...groups].sort()) {
    const [period, platform] = key.split('|');
    list.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
    const statuses = list.map(l => l.status).join(',');
    const applied = list.filter(l => l.status === 'applied' || l.status === 'applied_gap');
    const last = applied[applied.length - 1] || list[list.length - 1];
    // 하루에 지역별 파일이 여러 개다. 파일마다 마지막 반영 기록을 쓰고, 기사별로 모든 파일을 합친다.
    const latestByFile = new Map();
    applied.forEach(log => latestByFile.set(String(log.file_name || log.id), log));

    const byDriver = new Map();
    latestByFile.forEach((log, fileName) => {
      const records = (log.applied_records?.length ? log.applied_records : log.matched_records) || [];
      records.forEach(r => {
        const id = String(r.driverId || '').trim();
        if (!id) return;
        const cur = byDriver.get(id) || { rows: [], amount: 0, orders: 0 };
        cur.rows.push({ ...r, _file: fileName });
        cur.amount += amountOf(r);
        cur.orders += n(r.orderCount);
        byDriver.set(id, cur);
      });
    });

    const issues = [];
    byDriver.forEach((cur, id) => {
      const s = savedBy.get(`${id}|${period}|${platform}`);
      const label = nameOf.get(id) || cur.rows[0].driverName || cur.rows[0].rawName || id;
      if (cur.rows.length > 1) {
        issues.push(`같은 기사 ${cur.rows.length}줄: ${label} 파일합 ${fmt(cur.amount)}/${cur.orders}건 → 저장 ${s ? `${fmt(s.settlement_amount)}/${n(s.order_count)}건` : '없음'}`
          + ` [${cur.rows.map(r => `${r.rawName || r.name || ''}#${r.riderId || ''} ${fmt(amountOf(r))} @${String(r._file).slice(0, 40)}`).join(' | ')}]`);
        return;
      }
      if (!s) {
        if (cur.amount || cur.orders) issues.push(`저장 없음: ${label} ${fmt(cur.amount)}/${cur.orders}건`);
        return;
      }
      if (n(s.settlement_amount) !== cur.amount) {
        issues.push(`금액 다름: ${label} 파일 ${fmt(cur.amount)} → 저장 ${fmt(s.settlement_amount)}`);
      }
      if (excluded.has(`${id}-${period}-${platform}`)) {
        issues.push(`급여일정산 제외됨: ${label} ${fmt(cur.amount)}`);
      }
    });
    const head = `${period} ${platform === 'coupang' ? '쿠팡' : '배민'}  파일 ${latestByFile.size}개 · 기록 ${list.length}건  매칭 ${byDriver.size}명`
      + (statuses.split(',').some(s => s !== 'applied') ? ` (${statuses})` : '');
    if (issues.length || last.status !== 'applied') {
      problemDays += 1;
      console.log(`■ ${head}  마지막=${last.status}${last.skip_reason ? ` (${String(last.skip_reason).slice(0, 80)})` : ''}`);
      issues.slice(0, 40).forEach(line => console.log(`   - ${line}`));
      if (issues.length > 40) console.log(`   … 외 ${issues.length - 40}건`);
    } else {
      console.log(`  ${head}  OK`);
    }
  }

  // 업로드 기록 없이 저장만 있는 날 / 저장 없이 기록만 있는 날
  const savedDays = new Set(saved.map(r => `${String(r.period).slice(0, 10)}|${r.platform}`));
  [...savedDays].filter(k => !groups.has(k)).sort().forEach(k => console.log(`  (기록 없음, 저장만 있음) ${k}`));
  console.log(`\n문제 있는 정산일 ${problemDays}건`);
})().catch(err => { console.error(err); process.exit(1); });


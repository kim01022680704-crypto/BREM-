#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const FROM = String(process.argv[2] || '2026-09-02').slice(0, 10);
const TO = String(process.argv[3] || '2026-09-08').slice(0, 10);
const digits = value => String(value || '').replace(/\D/g, '');
const nameKey = value => String(value || '').replace(/\s/g, '').toLowerCase();
const phone4 = value => digits(value).slice(-4);
const number = value => Number(value || 0);

async function fetchAll(table, select, configure) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase.from(table).select(select).range(offset, offset + 999);
    query = configure ? configure(query) : query;
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

function add(map, key, amount) {
  map.set(key, number(map.get(key)) + number(amount));
}

(async () => {
  const [riders, crawlRows, dailyRows, callRows] = await Promise.all([
    fetchAll('riders', 'id,name,phone,raw_data,status', query => query.neq('status', 'deleted')),
    fetchAll(
      'coupang_collect_items',
      'collect_date,collected_at,vendor_id,vendor_name,courier_id,rider_name,phone_number,match_key,parsed_json',
      query => query.eq('source_menu', 'rider_daily').gte('collect_date', FROM).lte('collect_date', TO)
    ),
    fetchAll(
      'daily_settlements',
      'id,driver_id,period,platform,order_count,settlement_amount,updated_at',
      query => query.eq('platform', 'coupang').gte('period', FROM).lte('period', TO)
    ),
    fetchAll(
      'admin_calls',
      'id,driver_id,date,platform,count,updated_at',
      query => query.eq('platform', 'coupang').gte('date', FROM).lte('date', TO)
    )
  ]);

  const riderById = new Map(riders.map(rider => [String(rider.id), rider]));
  const exact = new Map();
  const byName = new Map();
  riders.forEach(rider => {
    const n = nameKey(rider.name);
    const p4 = phone4(rider.phone || rider.raw_data?.phone);
    if (n && p4) {
      const key = `${n}|${p4}`;
      if (!exact.has(key)) exact.set(key, []);
      exact.get(key).push(rider);
    }
    if (n) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(rider);
    }
  });

  const crawl = new Map();
  const crawlMeta = new Map();
  const unmatched = [];
  crawlRows.forEach(row => {
    const parsed = row.parsed_json || {};
    const n = nameKey(row.rider_name || parsed.name);
    const p4 = phone4(row.phone_number || parsed.phone);
    const exactMatches = exact.get(`${n}|${p4}`) || [];
    const nameMatches = byName.get(n) || [];
    const rider = exactMatches.length === 1
      ? exactMatches[0]
      : (nameMatches.length === 1 ? nameMatches[0] : null);
    const count = number(parsed.completeCount);
    if (!rider) {
      if (count > 0) {
        unmatched.push({
          date: row.collect_date,
          name: row.rider_name || parsed.name || '-',
          phone4: p4,
          vendor: row.vendor_name || row.vendor_id,
          courierId: row.courier_id || parsed.courierId,
          crawlCalls: count,
          reason: exactMatches.length > 1 || nameMatches.length > 1 ? '중복 후보' : 'ERP 기사 없음'
        });
      }
      return;
    }
    const key = `${row.collect_date}|${rider.id}`;
    add(crawl, key, count);
    const meta = crawlMeta.get(key) || {
      date: row.collect_date,
      driverId: rider.id,
      name: rider.name,
      phone4: phone4(rider.phone),
      vendors: new Set(),
      matchMethods: new Set(),
      latestAt: ''
    };
    meta.vendors.add(row.vendor_name || row.vendor_id);
    meta.matchMethods.add(exactMatches.length === 1 ? '이름+전화4자리' : '고유이름');
    if (String(row.collected_at || '') > meta.latestAt) meta.latestAt = row.collected_at;
    crawlMeta.set(key, meta);
  });

  const daily = new Map();
  dailyRows.forEach(row => add(daily, `${String(row.period).slice(0, 10)}|${row.driver_id}`, row.order_count));
  const calls = new Map();
  callRows.forEach(row => add(calls, `${String(row.date).slice(0, 10)}|${row.driver_id}`, row.count));

  const keys = new Set([...crawl.keys(), ...daily.keys(), ...calls.keys()]);
  const comparisons = [...keys].map(key => {
    const [date, driverId] = key.split('|');
    const rider = riderById.get(driverId) || {};
    const crawlCalls = number(crawl.get(key));
    const dailyCalls = number(daily.get(key));
    const adminCalls = number(calls.get(key));
    const meta = crawlMeta.get(key);
    const estimated08 = Math.round(5 * (dailyCalls - crawlCalls));
    const estimated10 = Math.round(dailyCalls - estimated08);
    const reconstructedWeight = estimated08 * 0.8 + estimated10;
    const weightedConsistent = crawl.has(key)
      && daily.has(key)
      && estimated08 >= 0
      && estimated10 >= 0
      && Math.abs(reconstructedWeight - crawlCalls) <= 0.11;
    const erpInputExact = dailyCalls === adminCalls;
    return {
      date,
      driverId,
      name: rider.name || meta?.name || '-',
      phone4: phone4(rider.phone) || meta?.phone4 || '',
      vendor: meta ? [...meta.vendors].join(', ') : '',
      matchMethod: meta ? [...meta.matchMethods].join(', ') : '',
      crawlWeighted: crawlCalls,
      dailyCalls,
      adminCalls,
      estimated08: weightedConsistent ? estimated08 : null,
      estimated10: weightedConsistent ? estimated10 : null,
      weightedConsistent,
      erpInputExact,
      crawlVsDaily: crawlCalls - dailyCalls,
      dailyVsAdmin: dailyCalls - adminCalls,
      status: weightedConsistent && erpInputExact
        ? '가중값 일치'
        : (!crawl.has(key)
          ? '크롤 없음'
          : (!daily.has(key)
            ? '정산서 없음'
            : (!erpInputExact ? 'ERP 입력 차이' : '크롤 가중값 불일치')))
    };
  }).filter(row => row.crawlWeighted > 0 || row.dailyCalls > 0 || row.adminCalls > 0)
    .sort((a, b) => a.date.localeCompare(b.date)
    || Math.abs(b.crawlVsDaily) - Math.abs(a.crawlVsDaily)
    || a.name.localeCompare(b.name, 'ko'));

  const dates = [];
  for (let cursor = new Date(`${FROM}T12:00:00+09:00`); cursor <= new Date(`${TO}T12:00:00+09:00`); cursor = new Date(cursor.getTime() + 86400000)) {
    dates.push(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(cursor));
  }
  const perDate = dates.map(date => {
    const rows = comparisons.filter(row => row.date === date);
    const unmatchedRows = unmatched.filter(row => row.date === date);
    return {
      date,
      crawlTotal: rows.reduce((sum, row) => sum + row.crawlWeighted, 0) + unmatchedRows.reduce((sum, row) => sum + row.crawlCalls, 0),
      matchedCrawlTotal: rows.reduce((sum, row) => sum + row.crawlWeighted, 0),
      dailyTotal: rows.reduce((sum, row) => sum + row.dailyCalls, 0),
      adminTotal: rows.reduce((sum, row) => sum + row.adminCalls, 0),
      exact: rows.filter(row => row.status === '가중값 일치').length,
      mismatch: rows.filter(row => row.status !== '가중값 일치').length,
      unmatchedCrawlRiders: unmatchedRows.length,
      settlementRows: dailyRows.filter(row => String(row.period).slice(0, 10) === date).length,
      crawlRows: crawlRows.filter(row => row.collect_date === date).length
    };
  });

  const completedDates = perDate.filter(row => row.settlementRows > 0);
  const completedKeys = new Set(completedDates.map(row => row.date));
  const completedComparisons = comparisons.filter(row => completedKeys.has(row.date));
  const result = {
    generatedAt: new Date().toISOString(),
    range: { from: FROM, to: TO },
    summary: {
      riders: riders.length,
      crawlRows: crawlRows.length,
      dailyRows: dailyRows.length,
      adminCallRows: callRows.length,
      completedDates: [...completedKeys],
      completedExactRows: completedComparisons.filter(row => row.status === '가중값 일치').length,
      completedMismatchRows: completedComparisons.filter(row => row.status !== '가중값 일치').length,
      unmatchedPositiveCrawlRows: unmatched.length,
      crawlTotalCompleted: completedDates.reduce((sum, row) => sum + row.crawlTotal, 0),
      dailyTotalCompleted: completedDates.reduce((sum, row) => sum + row.dailyTotal, 0),
      adminTotalCompleted: completedDates.reduce((sum, row) => sum + row.adminTotal, 0)
    },
    perDate,
    mismatches: completedComparisons.filter(row => row.status !== '가중값 일치'),
    unmatched,
    exactSample: completedComparisons.filter(row => row.status === '가중값 일치').slice(0, 20)
  };
  console.log(JSON.stringify(result, null, 2));
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

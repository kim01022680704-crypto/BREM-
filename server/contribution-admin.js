/**
 * 관리자 기여도 API
 * - 일별 스냅샷을 contribution_daily 에 upsert
 * - 배민: baemin_biz_collect_items delivery_status.totalComplete
 * - 쿠팡: coupang_collect_items rider_daily.completeCount
 */
const { verifyAdminCaller } = require('./admin-users');
const { getServiceClient } = require('./admin-bootstrap');
const coupangPipeline = require('./coupang-collect-pipeline');

function todayKst() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function baeminIdKey(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapRider(row) {
  const raw = row.raw_data && typeof row.raw_data === 'object' ? row.raw_data : {};
  return {
    id: String(row.id || ''),
    name: String(row.name || '').trim(),
    phone: String(row.phone || raw.phone || '').trim(),
    baeminId: String(row.baemin_id || raw.baeminId || '').trim(),
    regionBaemin: String(raw.regionBaemin || '').trim(),
    regionCoupang: String(raw.regionCoupang || '').trim()
  };
}

function buildRiderIndexes(riders) {
  const byId = new Map();
  const byBaeminId = new Map();
  const byNamePhone = new Map();
  const byName = new Map();
  riders.forEach(rider => {
    if (rider.id) byId.set(rider.id, rider);
    const bid = baeminIdKey(rider.baeminId);
    if (bid) byBaeminId.set(bid, rider);
    const name = normalizeName(rider.name);
    const phone4 = normalizePhone(rider.phone).slice(-4);
    if (name && phone4) byNamePhone.set(`${name}|${phone4}`, rider);
    if (name && !byName.has(name)) byName.set(name, rider);
  });
  return { byId, byBaeminId, byNamePhone, byName };
}

async function loadRiders(supabase) {
  const { data, error } = await supabase
    .from('riders')
    .select('id,name,phone,baemin_id,raw_data,status')
    .limit(20000);
  if (error) throw error;
  return (data || [])
    .map(mapRider)
    .filter(r => r.id && String(r.status || '').toLowerCase() !== 'deleted');
}

async function loadBaeminDeliveryRows(supabase, date) {
  const day = String(date || '').slice(0, 10);
  const pageSize = 1000;
  const items = [];
  let offset = 0;
  while (offset < 50000) {
    const { data, error } = await supabase
      .from('baemin_biz_collect_items')
      .select('collect_date,dedupe_key,rider_user_id,rider_name,parsed_json,match_key')
      .eq('source_menu', 'delivery_status')
      .eq('collect_date', day)
      .range(offset, offset + pageSize - 1);
    if (error) {
      if (String(error.message || '').includes('does not exist')) {
        return { ok: false, tableMissing: true, items: [], error: error.message };
      }
      throw error;
    }
    const chunk = data || [];
    items.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return { ok: true, items };
}

function partnerFromDedupe(dedupeKey) {
  const key = String(dedupeKey || '');
  const m = key.match(/^(DP\d+)/i);
  return m ? m[1] : '';
}

function buildBaeminRows(items, indexes, date) {
  const byRider = new Map();
  (items || []).forEach(item => {
    const parsed = item.parsed_json || {};
    const score = Math.max(0, num(parsed.totalComplete ?? parsed.total_complete ?? 0));
    const crawlUserId = baeminIdKey(
      item.rider_user_id || parsed.userId || parsed.riderId || parsed.rider_user_id || ''
    );
    const riderName = String(item.rider_name || parsed.riderName || parsed.name || '').trim();
    const matched = (crawlUserId && indexes.byBaeminId.get(crawlUserId))
      || indexes.byName.get(normalizeName(riderName))
      || null;
    const riderId = matched?.id || (crawlUserId ? `crawl:baemin:${crawlUserId}` : `crawl:baemin:${normalizeName(riderName) || 'unknown'}`);
    const region = matched?.regionBaemin || partnerFromDedupe(item.dedupe_key) || '';
    const prev = byRider.get(riderId);
    // 같은 기사 중복 행이면 더 큰 콜수 채택 (오차 허용)
    if (prev && num(prev.score) >= score) return;
    byRider.set(riderId, {
      date,
      platform: 'baemin',
      region,
      rider_id: riderId,
      rider_name: matched?.name || riderName || '-',
      score,
      source: 'delivery_status',
      match_key: String(item.match_key || crawlUserId || ''),
      vendor_or_partner: partnerFromDedupe(item.dedupe_key),
      raw_json: {
        totalComplete: score,
        morningCount: num(parsed.morningCount ?? parsed.completeMorning),
        afternoonCount: num(parsed.afternoonCount ?? parsed.completeAfternoon),
        eveningCount: num(parsed.eveningCount ?? parsed.completeEvening),
        midnightCount: num(parsed.midnightCount ?? parsed.completeMidnight),
        matched: Boolean(matched)
      },
      updated_at: new Date().toISOString()
    });
  });
  return [...byRider.values()];
}

function buildCoupangRows(items, indexes, date) {
  const byRider = new Map();
  (items || []).forEach(item => {
    const parsed = item.parsed_json || {};
    const score = Math.max(0, num(parsed.completeCount));
    const courierId = String(item.courier_id || parsed.courierId || '').trim();
    const riderName = String(item.rider_name || parsed.riderName || '').trim();
    const phone = String(item.phone_number || parsed.phoneNumber || '').trim();
    const matchKey = String(item.match_key || '').trim()
      || `${normalizeName(riderName)}${normalizePhone(phone).slice(-4)}`;
    const name = normalizeName(riderName);
    const phone4 = normalizePhone(phone).slice(-4);
    const matched = (name && phone4 && indexes.byNamePhone.get(`${name}|${phone4}`))
      || indexes.byName.get(name)
      || null;
    const riderId = matched?.id || (courierId ? `crawl:coupang:${courierId}` : `crawl:coupang:${matchKey || 'unknown'}`);
    const region = matched?.regionCoupang
      || String(item.vendor_name || parsed.vendorName || '').trim()
      || String(item.vendor_id || '').trim();
    const prev = byRider.get(riderId);
    if (prev && num(prev.score) >= score) return;
    byRider.set(riderId, {
      date,
      platform: 'coupang',
      region,
      rider_id: riderId,
      rider_name: matched?.name || riderName || '-',
      score,
      source: 'rider_daily',
      match_key: matchKey,
      vendor_or_partner: String(item.vendor_id || parsed.vendorId || ''),
      raw_json: {
        completeCount: score,
        rejectCount: num(parsed.rejectCount),
        cancelCount: num(parsed.cancelCount),
        matched: Boolean(matched),
        courierId
      },
      updated_at: new Date().toISOString()
    });
  });
  return [...byRider.values()];
}

async function upsertRows(supabase, rows) {
  if (!rows.length) return { saved: 0 };
  const CHUNK = 200;
  let saved = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('contribution_daily')
      .upsert(chunk, { onConflict: 'date,platform,rider_id' });
    if (error) {
      if (String(error.message || '').includes('does not exist') || error.code === '42P01') {
        return {
          ok: false,
          tableMissing: true,
          saved,
          error: 'contribution_daily 테이블이 없습니다. supabase/contribution_daily_migration.sql 을 실행하세요.'
        };
      }
      return { ok: false, saved, error: error.message || '기여도 저장 실패' };
    }
    saved += chunk.length;
  }
  return { ok: true, saved };
}

async function refreshSnapshot(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const date = String(options.date || todayKst()).slice(0, 10);
  const platform = String(options.platform || 'all').trim().toLowerCase();
  const riders = await loadRiders(supabase);
  const indexes = buildRiderIndexes(riders);

  const rows = [];
  const summary = { baemin: 0, coupang: 0, errors: [] };

  if (platform === 'all' || platform === 'baemin') {
    try {
      const bae = await loadBaeminDeliveryRows(supabase, date);
      if (bae.tableMissing) {
        summary.errors.push('배민 수집 테이블 없음');
      } else {
        const built = buildBaeminRows(bae.items || [], indexes, date);
        rows.push(...built);
        summary.baemin = built.length;
      }
    } catch (error) {
      summary.errors.push(`배민: ${error.message || error}`);
    }
  }

  if (platform === 'all' || platform === 'coupang') {
    try {
      const coupang = await coupangPipeline.readCollectItems('rider_daily', date, { limit: 30000 });
      if (!coupang.ok) {
        summary.errors.push(coupang.message || coupang.error || '쿠팡 라이더 조회 실패');
      } else {
        const built = buildCoupangRows(coupang.items || [], indexes, date);
        rows.push(...built);
        summary.coupang = built.length;
      }
    } catch (error) {
      summary.errors.push(`쿠팡: ${error.message || error}`);
    }
  }

  const saved = await upsertRows(supabase, rows);
  if (saved.ok === false) {
    return {
      ok: false,
      status: saved.tableMissing ? 503 : 500,
      error: saved.error,
      tableMissing: Boolean(saved.tableMissing),
      summary
    };
  }

  return {
    ok: true,
    date,
    saved: saved.saved,
    summary,
    message: `${date} 기여도 ${saved.saved}건 저장 · 배민 ${summary.baemin} · 쿠팡 ${summary.coupang}`
  };
}

async function listDaily(accessToken, options = {}) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const date = String(options.date || todayKst()).slice(0, 10);
  const platform = String(options.platform || 'all').trim().toLowerCase();
  const region = String(options.region || '').trim();
  const keyword = String(options.keyword || '').trim().toLowerCase();

  let q = supabase
    .from('contribution_daily')
    .select('date,platform,region,rider_id,rider_name,score,source,match_key,vendor_or_partner,raw_json,updated_at')
    .eq('date', date)
    .order('score', { ascending: false })
    .limit(5000);

  if (platform === 'baemin' || platform === 'coupang') {
    q = q.eq('platform', platform);
  }
  if (region) {
    q = q.ilike('region', `%${region}%`);
  }

  const { data, error } = await q;
  if (error) {
    if (String(error.message || '').includes('does not exist') || error.code === '42P01') {
      return {
        ok: false,
        status: 503,
        tableMissing: true,
        error: 'contribution_daily 테이블이 없습니다. supabase/contribution_daily_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, status: 500, error: error.message || '기여도 조회 실패' };
  }

  let items = data || [];
  if (keyword) {
    items = items.filter(row => [
      row.rider_name,
      row.region,
      row.match_key,
      row.rider_id
    ].join(' ').toLowerCase().includes(keyword));
  }

  const totals = items.reduce((acc, row) => {
    acc.count += 1;
    acc.scoreSum += num(row.score);
    if (row.platform === 'baemin') acc.baemin += 1;
    if (row.platform === 'coupang') acc.coupang += 1;
    return acc;
  }, { count: 0, scoreSum: 0, baemin: 0, coupang: 0 });

  return {
    ok: true,
    date,
    items,
    totals,
    tableReady: true
  };
}

module.exports = {
  refreshSnapshot,
  listDaily,
  todayKst
};

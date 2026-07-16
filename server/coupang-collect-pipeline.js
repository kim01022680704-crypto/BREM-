/**
 * 쿠팡이츠 수집 데이터 저장/조회 파이프라인 (Supabase)
 * coupang_collect_items / coupang_collect_runs 사용. 서버 service role 전용.
 */
const { getServiceClient } = require('./admin-bootstrap');

const CHUNK = 300;

function isMissingTableError(error) {
  const t = String(error?.message || '').toLowerCase();
  return t.includes('does not exist') || t.includes('schema cache') || (t.includes('relation') && t.includes('does not exist'));
}

function collapseByDedupeKey(rows = []) {
  const map = new Map();
  rows.forEach(row => {
    const key = `${row.collect_date}|${row.source_menu}|${row.dedupe_key}`;
    map.set(key, row);
  });
  return [...map.values()];
}

/** 배민과 동일: 같은 메뉴·날짜 재수집 시 기존분 삭제 후 최신으로 교체 */
async function deleteCollectItemsForDates(sourceMenu, dates = []) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const menu = String(sourceMenu || '').trim();
  const uniqueDates = [...new Set((dates || []).map(d => String(d || '').slice(0, 10)).filter(Boolean))];
  if (!menu || !uniqueDates.length) return { ok: true, deleted: 0 };

  let deleted = 0;
  for (const date of uniqueDates) {
    // PostgREST delete는 한 번에 많을 수 있어 반복 삭제
    let guard = 0;
    while (guard < 50) {
      guard += 1;
      const { data, error } = await supabase
        .from('coupang_collect_items')
        .delete()
        .eq('source_menu', menu)
        .eq('collect_date', date)
        .select('dedupe_key')
        .limit(1000);
      if (error) {
        if (isMissingTableError(error)) {
          return { ok: false, tableMissing: true, message: 'coupang_collect_items 테이블이 없습니다.' };
        }
        return { ok: false, error: error.message || '삭제 실패', deleted };
      }
      const n = (data || []).length;
      deleted += n;
      if (n < 1000) break;
    }
  }
  return { ok: true, deleted };
}

/**
 * 수집 아이템 저장.
 * 기본: 배민처럼 (source_menu + collect_date) 기존분 삭제 후 upsert → 재수집 시 날짜 단위 교체
 * options.replaceByDate=false 이면 기존 upsert만 수행
 */
async function upsertCollectItems(items = [], options = {}) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const replaceByDate = options.replaceByDate !== false;
  const rows = collapseByDedupeKey((items || []).filter(Boolean).map(it => ({
    collect_date: it.collect_date,
    collected_at: it.collected_at || new Date().toISOString(),
    source_menu: it.source_menu,
    vendor_id: String(it.vendor_id || ''),
    vendor_name: String(it.vendor_name || ''),
    courier_id: String(it.courier_id || ''),
    rider_name: String(it.rider_name || ''),
    phone_number: String(it.phone_number || ''),
    match_key: String(it.match_key || ''),
    dedupe_key: String(it.dedupe_key || ''),
    parsed_json: it.parsed_json || {},
    raw_json: it.raw_json || {},
    updated_at: new Date().toISOString()
  })).filter(r => r.collect_date && r.source_menu && r.dedupe_key));

  if (!rows.length) return { ok: true, saved: 0, deleted: 0 };

  let deleted = 0;
  // 배민 rider/daily와 같이 전체 스냅샷 메뉴만 날짜 단위 교체.
  // peak/weekly 는 매장별 저장이라 날짜 전체 삭제하면 다른 매장이 사라짐 → upsert만.
  const FULL_REPLACE_MENUS = new Set(['rider_daily', 'vendor_info']);
  if (replaceByDate) {
    const byMenu = new Map();
    rows.forEach(r => {
      if (!FULL_REPLACE_MENUS.has(r.source_menu)) return;
      if (!byMenu.has(r.source_menu)) byMenu.set(r.source_menu, new Set());
      byMenu.get(r.source_menu).add(r.collect_date);
    });
    for (const [menu, dateSet] of byMenu.entries()) {
      const wiped = await deleteCollectItemsForDates(menu, [...dateSet]);
      if (!wiped.ok) return { ...wiped, saved: 0 };
      deleted += wiped.deleted || 0;
    }
  }

  let saved = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('coupang_collect_items')
      .upsert(chunk, { onConflict: 'collect_date,source_menu,dedupe_key' });
    if (error) {
      if (isMissingTableError(error)) {
        return { ok: false, tableMissing: true, message: 'coupang_collect_items 테이블이 없습니다. supabase/coupang_collect_migration.sql 을 실행하세요.' };
      }
      return { ok: false, error: error.message || '저장 실패', saved, deleted };
    }
    saved += chunk.length;
  }
  return { ok: true, saved, deleted };
}

async function saveRun(collectDate, sourceMenu, status, count, message) {
  const supabase = getServiceClient();
  if (!supabase) return;
  try {
    await supabase.from('coupang_collect_runs').insert({
      collect_date: collectDate,
      source_menu: sourceMenu,
      status: status || 'ok',
      item_count: Number(count || 0),
      message: String(message || '')
    });
  } catch { /* ignore */ }
}

/** 관리자 조회용: 특정 메뉴/일자 아이템 (Supabase 1000행 제한을 페이지네이션으로 넘김) */
async function readCollectItems(sourceMenu, collectDate, options = {}) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const fromDate = options.fromDate ? String(options.fromDate).slice(0, 10) : '';
  const toDate = options.toDate ? String(options.toDate).slice(0, 10) : '';
  const vendorId = options.vendorId ? String(options.vendorId) : '';
  const pageSize = Math.min(1000, Math.max(100, Number(options.pageSize) || 1000));
  const maxRows = Math.min(50000, Math.max(pageSize, Number(options.limit) || 20000));
  const selectCols = 'collect_date, collected_at, source_menu, vendor_id, vendor_name, courier_id, rider_name, phone_number, match_key, dedupe_key, parsed_json';

  const items = [];
  let offset = 0;
  while (offset < maxRows) {
    let q = supabase
      .from('coupang_collect_items')
      .select(selectCols)
      .eq('source_menu', sourceMenu)
      .order('collect_date', { ascending: true })
      .order('dedupe_key', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (fromDate && toDate) {
      q = q.gte('collect_date', fromDate).lte('collect_date', toDate);
    } else if (collectDate) {
      q = q.eq('collect_date', collectDate);
    }
    if (vendorId) q = q.eq('vendor_id', vendorId);

    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) return { ok: false, tableMissing: true, message: 'coupang_collect_items 테이블이 없습니다.' };
      return { ok: false, error: error.message || '조회 실패', items, count: items.length };
    }
    const chunk = data || [];
    items.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return { ok: true, items, count: items.length };
}

/** 특정 메뉴의 최신 collect_date */
async function getLatestCollectDate(sourceMenu) {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('coupang_collect_items')
    .select('collect_date')
    .eq('source_menu', sourceMenu)
    .order('collect_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data?.collect_date || null;
}

/** 계정 배정·스코프용: 최근 수집에서 매장(vendor) 목록 추출 */
async function listKnownVendors() {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.', items: [] };

  const map = new Map();
  const menus = ['vendor_info', 'weekly_performance', 'peak_realtime'];
  for (const menu of menus) {
    const latest = await getLatestCollectDate(menu);
    if (!latest) continue;
    const { data, error } = await supabase
      .from('coupang_collect_items')
      .select('vendor_id, vendor_name')
      .eq('source_menu', menu)
      .eq('collect_date', latest)
      .limit(5000);
    if (error) {
      if (isMissingTableError(error)) {
        return { ok: false, tableMissing: true, message: 'coupang_collect_items 테이블이 없습니다.', items: [] };
      }
      continue;
    }
    (data || []).forEach(row => {
      const vendorId = String(row.vendor_id || '').trim();
      if (!vendorId) return;
      const vendorName = String(row.vendor_name || '').trim() || vendorId;
      const prev = map.get(vendorId);
      if (!prev || (vendorName && vendorName !== vendorId && (!prev.vendorName || prev.vendorName === vendorId))) {
        map.set(vendorId, { vendorId, vendorName });
      }
    });
  }

  const items = [...map.values()].sort((a, b) =>
    String(a.vendorName).localeCompare(String(b.vendorName), 'ko')
  );
  return { ok: true, items };
}

module.exports = {
  upsertCollectItems,
  deleteCollectItemsForDates,
  saveRun,
  readCollectItems,
  getLatestCollectDate,
  listKnownVendors
};

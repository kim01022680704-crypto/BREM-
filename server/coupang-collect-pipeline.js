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

/** 수집 아이템 upsert (dedupe_key 기준) */
async function upsertCollectItems(items = []) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const rows = (items || []).filter(Boolean).map(it => ({
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
  })).filter(r => r.collect_date && r.source_menu && r.dedupe_key);

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
      return { ok: false, error: error.message || '저장 실패', saved };
    }
    saved += chunk.length;
  }
  return { ok: true, saved };
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

module.exports = {
  upsertCollectItems,
  saveRun,
  readCollectItems,
  getLatestCollectDate
};

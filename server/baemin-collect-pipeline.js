const { getServiceClient } = require('./admin-bootstrap');
const {
  listCollectSources,
  getCollectSource,
  mapItemToCollectRow,
  extractBusinessDate,
  buildDefaultQuery,
  resolveApiEndpoint,
  API_REGISTRY_KEY,
  BAEMIN_API_ORIGIN,
  BAEMIN_ORIGIN,
  sanitizeApiRegistry,
  isDistinctRiderHistoryEndpoint,
  mergeEndpointWithDefault
} = require('./baemin-collect-sources');
const { fetchPaginatedApi } = require('./baemin-api-fetch');
const { createCollectRunId } = require('./baemin-raw-api-logs');
const { computeCollectDateRange, computeHistoryCollectRange, computeBizHistoryCollectRange, buildMenuDateRanges, buildBizMenuDateRanges, resolveHistoryMenuQueryDates, buildDateList, toSingleDayRange, addDays, todayKST } = require('./baemin-settlement-week');
const { saveStatsForSource } = require('./baemin-stats-save');
const { sumStats, extractStatsFromItem, pickAcceptance, serviceBreakdownFromStats, computeItemsMetricTotals } = require('./baemin-stats-extract');
const { discoverApiUrlViaPage } = require('./baemin-page-capture');
const { buildCenterQueryParams, buildCenterFetchHeaders } = require('./baemin-center-context');
const collectProgress = require('./baemin-collect-progress');

const BAEMIN_APPLIED_SETTINGS_KEY = 'brem_baemin_delivery_applied';
const settingsCache = new Map();
const SETTINGS_CACHE_MS = 30000;
let appliedBatchCache = { batchId: '', at: 0 };

function getBaeminSession() {
  return require('./baemin-delivery-session');
}

function invalidateSettingsCache(key = '') {
  if (key) settingsCache.delete(key);
  else settingsCache.clear();
  appliedBatchCache = { batchId: '', at: 0 };
}

async function readSettingsValue(key) {
  const cacheHit = settingsCache.get(key);
  if (cacheHit && Date.now() - cacheHit.at < SETTINGS_CACHE_MS) {
    return cacheHit.value;
  }

  const supabase = getServiceClient();
  if (!supabase) return null;

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    if (!error) {
      const value = data?.value ?? null;
      settingsCache.set(key, { value, at: Date.now() });
      return value;
    }
    lastError = error;
    const message = String(error.message || '');
    if (attempt < 2 && /timeout|timed out|upstream/i.test(message)) {
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      continue;
    }
    break;
  }
  throw new Error(lastError?.message || '설정을 불러오지 못했습니다.');
}

async function writeSettingsValue(key, value, description) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const { error } = await supabase.from('settings').upsert({
    key,
    value,
    description: description || key,
    updated_at: new Date().toISOString()
  }, { onConflict: 'key' });
  if (error) return { ok: false, status: 500, error: error.message || '설정 저장에 실패했습니다.' };
  invalidateSettingsCache(key);
  if (key === BAEMIN_APPLIED_SETTINGS_KEY) invalidateSettingsCache();
  return { ok: true };
}

function isMissingBizCollectTableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('baemin_biz_collect')
    || (message.includes('relation') && message.includes('does not exist'));
}

async function getBizCollectTableStatus() {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, tableExists: false };
  const { error } = await supabase.from('baemin_biz_collect_items').select('id', { head: true, count: 'exact' });
  if (error) {
    if (isMissingBizCollectTableError(error)) return { ok: true, tableExists: false };
    return { ok: false, tableExists: false, error: error.message };
  }
  return { ok: true, tableExists: true };
}

async function getApiRegistry() {
  const raw = await readSettingsValue(API_REGISTRY_KEY);
  return raw && typeof raw === 'object' ? raw : { endpoints: {}, discoveredAt: null };
}

async function saveApiRegistry(registry) {
  return writeSettingsValue(API_REGISTRY_KEY, registry, 'Baemin Biz discovered API endpoints');
}

function resolveApiPath(sourceId, registry) {
  return resolveApiEndpoint(sourceId, registry)?.apiPath || null;
}

function aggregateRiderHistoryFromDaily(items, collectDate, collectedAt, sourceUrl, options = {}) {
  const map = new Map();
  items.forEach((item, index) => {
    const userId = String(item?.userId || item?.riderId || '').trim();
    const businessDate = extractBusinessDate(item, {
      ...options,
      index,
      collectDate,
      historyMenu: true,
      dayDate: item?.__bremDayDate
    });
    const riderKey = userId || String(item?.phoneNumber || item?.phone || item?.name || index);
    const key = `${riderKey}:${businessDate || 'unknown'}`;
    if (!map.has(key)) {
      map.set(key, {
        userId,
        name: item?.name || item?.riderName || '',
        phoneNumber: item?.phoneNumber || item?.phone || '',
        deliveryAcceptanceCount: {},
        deliveryPeakTimeCount: { morning: 0, afternoon: 0, evening: 0, midnight: 0 },
        deliveryCount: 0,
        sourceUrl,
        businessDate
      });
    }
    const row = map.get(key);
    row.deliveryCount += 1;
    const acceptance = pickAcceptance(item);
    const peak = item?.deliveryPeakTimeCount || {};
    row.deliveryAcceptanceCount.totalComplete = num(row.deliveryAcceptanceCount.totalComplete) + acceptance.completeTotal;
    row.deliveryAcceptanceCount.foodComplete = num(row.deliveryAcceptanceCount.foodComplete) + acceptance.foodComplete;
    row.deliveryAcceptanceCount.bmartComplete = num(row.deliveryAcceptanceCount.bmartComplete) + acceptance.bmartComplete;
    row.deliveryAcceptanceCount.storeComplete = num(row.deliveryAcceptanceCount.storeComplete) + acceptance.storeComplete;
    row.deliveryAcceptanceCount.totalReject = num(row.deliveryAcceptanceCount.totalReject) + acceptance.rejectTotal;
    row.deliveryAcceptanceCount.foodReject = num(row.deliveryAcceptanceCount.foodReject) + acceptance.foodReject;
    row.deliveryAcceptanceCount.bmartReject = num(row.deliveryAcceptanceCount.bmartReject) + acceptance.bmartReject;
    row.deliveryAcceptanceCount.storeReject = num(row.deliveryAcceptanceCount.storeReject) + acceptance.storeReject;
    row.deliveryAcceptanceCount.totalCancel = num(row.deliveryAcceptanceCount.totalCancel) + acceptance.cancelTotal;
    row.deliveryAcceptanceCount.foodCancel = num(row.deliveryAcceptanceCount.foodCancel) + acceptance.foodCancel;
    row.deliveryAcceptanceCount.bmartCancel = num(row.deliveryAcceptanceCount.bmartCancel) + acceptance.bmartCancel;
    row.deliveryAcceptanceCount.storeCancel = num(row.deliveryAcceptanceCount.storeCancel) + acceptance.storeCancel;
    row.deliveryAcceptanceCount.totalRiderFault = num(row.deliveryAcceptanceCount.totalRiderFault) + acceptance.riderFault;
    row.deliveryAcceptanceCount.foodRiderFault = num(row.deliveryAcceptanceCount.foodRiderFault) + acceptance.foodRiderFault;
    row.deliveryAcceptanceCount.bmartRiderFault = num(row.deliveryAcceptanceCount.bmartRiderFault) + acceptance.bmartRiderFault;
    row.deliveryAcceptanceCount.storeRiderFault = num(row.deliveryAcceptanceCount.storeRiderFault) + acceptance.storeRiderFault;
    row.deliveryPeakTimeCount.morning += num(peak.morning);
    row.deliveryPeakTimeCount.afternoon += num(peak.afternoon);
    row.deliveryPeakTimeCount.evening += num(peak.evening);
    row.deliveryPeakTimeCount.midnight += num(peak.midnight);
    if (!row.businessDate && businessDate) row.businessDate = businessDate;
  });
  return Array.from(map.values()).map((item, index) => {
    const day = item.businessDate || '';
    const dayRange = day
      ? { fromDate: day, toDate: day, dates: [day], dayCount: 1 }
      : (options.dateRange || null);
    return mapItemToCollectRow(
      'rider_history',
      item,
      collectDate,
      sourceUrl,
      collectedAt,
      {
        partnerId: options?.partnerId,
        partnerName: options?.partnerName,
        regionName: options?.regionName,
        index,
        collectDate,
        historyMenu: true,
        dayDate: day,
        dateRange: dayRange,
        historyQueryDates: dayRange
      }
    );
  });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dedupeCollectRows(rows) {
  const map = new Map();
  let collapsed = 0;
  (rows || []).forEach(row => {
    const key = `${row.collect_date}|${row.source_menu}|${row.dedupe_key}`;
    if (map.has(key)) {
      collapsed += 1;
      const prev = map.get(key);
      map.set(key, String(row.collected_at || '') >= String(prev.collected_at || '') ? row : prev);
      return;
    }
    map.set(key, row);
  });
  if (collapsed > 0) {
    console.warn(`[BREM][save] collapsed ${collapsed} duplicate row(s) before upsert`);
  }
  return Array.from(map.values());
}

async function deleteBizDeliveryStatusForPartner(partnerId) {
  const supabase = getServiceClient();
  const pid = String(partnerId || '').trim().toUpperCase();
  if (!supabase || !/^DP\d{6,}$/.test(pid)) return { ok: true, deleted: 0 };

  let deleted = 0;
  const pageSize = 1000;
  const chunkSize = 80;
  while (true) {
    const { data, error } = await supabase
      .from('baemin_biz_collect_items')
      .select('id')
      .eq('source_menu', 'delivery_status')
      .like('dedupe_key', `${pid}:%`)
      .limit(pageSize);
    if (error) {
      return { ok: false, error: error.message || '기존 배달현황 삭제 실패' };
    }
    const ids = (data || []).map(row => row.id).filter(Boolean);
    if (!ids.length) break;
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      const { error: deleteError } = await supabase
        .from('baemin_biz_collect_items')
        .delete()
        .in('id', chunk);
      if (deleteError) {
        return { ok: false, error: deleteError.message || '기존 배달현황 삭제 실패' };
      }
      deleted += chunk.length;
    }
    if (ids.length < pageSize) break;
  }
  return { ok: true, deleted };
}

/** 일별/라이더: 특정 DP·날짜 구간을 통째로 지운 뒤 이번 수집분으로 교체 */
async function deleteBizHistoryForPartnerDates(partnerId, sourceMenu, dates = []) {
  const supabase = getServiceClient();
  const pid = String(partnerId || '').trim().toUpperCase();
  const menu = String(sourceMenu || '').trim();
  const dayList = [...new Set((dates || []).map(d => String(d || '').slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))];
  if (!supabase || !/^DP\d{6,}$/.test(pid) || !['daily_history', 'rider_history'].includes(menu) || !dayList.length) {
    return { ok: true, deleted: 0 };
  }

  let deleted = 0;
  const pageSize = 1000;
  const chunkSize = 80;
  for (const day of dayList) {
    while (true) {
      const { data, error } = await supabase
        .from('baemin_biz_collect_items')
        .select('id')
        .eq('source_menu', menu)
        .eq('collect_date', day)
        .like('dedupe_key', `${pid}:%`)
        .limit(pageSize);
      if (error) {
        return { ok: false, error: error.message || `${menu} 중복일 삭제 실패` };
      }
      const ids = (data || []).map(row => row.id).filter(Boolean);
      if (!ids.length) break;
      for (let offset = 0; offset < ids.length; offset += chunkSize) {
        const chunk = ids.slice(offset, offset + chunkSize);
        const { error: deleteError } = await supabase
          .from('baemin_biz_collect_items')
          .delete()
          .in('id', chunk);
        if (deleteError) {
          return { ok: false, error: deleteError.message || `${menu} 중복일 삭제 실패` };
        }
        deleted += chunk.length;
      }
      if (ids.length < pageSize) break;
    }
  }
  return { ok: true, deleted };
}

/** 일별/라이더: 1달(30일)보다 오래된 BIZ 수집분 정리 */
async function pruneBizHistoryOlderThan(partnerId, sourceMenu, keepFromDate) {
  const supabase = getServiceClient();
  const pid = String(partnerId || '').trim().toUpperCase();
  const menu = String(sourceMenu || '').trim();
  const fromDate = String(keepFromDate || '').slice(0, 10);
  if (!supabase || !/^DP\d{6,}$/.test(pid) || !['daily_history', 'rider_history'].includes(menu) || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    return { ok: true, deleted: 0 };
  }

  let deleted = 0;
  const pageSize = 1000;
  const chunkSize = 80;
  while (true) {
    const { data, error } = await supabase
      .from('baemin_biz_collect_items')
      .select('id')
      .eq('source_menu', menu)
      .lt('collect_date', fromDate)
      .like('dedupe_key', `${pid}:%`)
      .limit(pageSize);
    if (error) {
      return { ok: false, error: error.message || `${menu} 오래된 데이터 정리 실패` };
    }
    const ids = (data || []).map(row => row.id).filter(Boolean);
    if (!ids.length) break;
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      const { error: deleteError } = await supabase
        .from('baemin_biz_collect_items')
        .delete()
        .in('id', chunk);
      if (deleteError) {
        return { ok: false, error: deleteError.message || `${menu} 오래된 데이터 정리 실패` };
      }
      deleted += chunk.length;
    }
    if (ids.length < pageSize) break;
  }
  return { ok: true, deleted };
}

async function saveCollectItems(rows) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  if (!rows.length) return { ok: false, status: 400, error: 'NO_ROWS', message: '저장할 데이터가 없습니다.' };

  const deduped = dedupeCollectRows(normalizeCollectRowsPartnerIdentity(rows));
  const byMenu = new Map();
  deduped.forEach(row => {
    const menuType = row.source_menu || row.record_type || 'unknown';
    if (!byMenu.has(menuType)) byMenu.set(menuType, []);
    byMenu.get(menuType).push(row);
  });

  let savedCount = 0;
  const chunkSize = 100;

  for (const [menuType, menuRows] of byMenu.entries()) {
    const partnerId = String(
      partnerIdFromDedupeKey(menuRows[0]?.dedupe_key)
      || menuRows[0]?.partner_id
      || menuRows[0]?.parsed_json?.partnerId
      || ''
    ).trim().toUpperCase() || 'unknown';
    const partnerName = menuRows[0]?.parsed_json?.partnerName
      || menuRows[0]?.partner_name
      || '';
    const sampleKeys = menuRows.slice(0, 3).map(row => row.dedupe_key).join(', ');
    console.log(`[BREM][save] menu_type=${menuType} partner_id=${partnerId} partner_name=${partnerName || '-'} rows=${menuRows.length} dedupe_sample=${sampleKeys}`);

    // 배달현황(배민현황 소스): DP별 최신 수집분만 유지 — 이전분 전부 삭제 후 저장
    if (menuType === 'delivery_status' && /^DP\d{6,}$/.test(partnerId)) {
      const wiped = await deleteBizDeliveryStatusForPartner(partnerId);
      if (!wiped.ok) {
        return {
          ok: false,
          status: 500,
          error: 'SUPABASE_SAVE_FAILED',
          message: `${menuType}: 기존 데이터 삭제 실패 — ${wiped.error}`
        };
      }
      if (wiped.deleted) {
        console.log(`[BREM][save] replaced ${wiped.deleted} old delivery_status row(s) for ${partnerId}`);
      }
    }

    // 일별/라이더: 같은 DP·같은 날짜가 다시 수집되면 그 날짜분 교체
    if (['daily_history', 'rider_history'].includes(menuType) && /^DP\d{6,}$/.test(partnerId)) {
      const days = [...new Set(menuRows.map(row => String(row.collect_date || '').slice(0, 10)).filter(Boolean))];
      const wipedDays = await deleteBizHistoryForPartnerDates(partnerId, menuType, days);
      if (!wipedDays.ok) {
        return {
          ok: false,
          status: 500,
          error: 'SUPABASE_SAVE_FAILED',
          message: `${menuType}: 날짜 중복 교체 실패 — ${wipedDays.error}`
        };
      }
      if (wipedDays.deleted) {
        console.log(`[BREM][save] replaced ${wipedDays.deleted} ${menuType} row(s) for ${partnerId} days=${days.join(',')}`);
      }
    }

    const payload = menuRows.map(row => {
      const { record_type, partner_id, ...rest } = row;
      return {
        ...rest,
        parsed_json: {
          ...(rest.parsed_json || {}),
          recordType: menuType,
          menuType,
          partnerId: partner_id || rest.parsed_json?.partnerId || partnerId,
          partnerName: rest.parsed_json?.partnerName || partnerName || ''
        }
      };
    });

    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('baemin_biz_collect_items')
        .upsert(chunk, { onConflict: 'collect_date,source_menu,dedupe_key' });
      if (error) {
        return {
          ok: false,
          status: 500,
          error: 'SUPABASE_SAVE_FAILED',
          message: `${menuType}: ${error.message || String(error)}`
        };
      }
      savedCount += chunk.length;
    }

    // 일별/라이더: 30일보다 오래된 분 정리 (한달치만 유지)
    if (['daily_history', 'rider_history'].includes(menuType) && /^DP\d{6,}$/.test(partnerId)) {
      const keepFrom = addDays(todayKST(), -30);
      const pruned = await pruneBizHistoryOlderThan(partnerId, menuType, keepFrom);
      if (pruned.ok && pruned.deleted) {
        console.log(`[BREM][save] pruned ${pruned.deleted} old ${menuType} row(s) for ${partnerId} before ${keepFrom}`);
      }
    }
  }

  return { ok: true, savedCount };
}

function riderIdentityKey(row) {
  const id = String(row?.rider_user_id || '').trim();
  if (id) return `id:${id}`;
  const phone = String(row?.phone_number || '').trim();
  if (phone) return `phone:${phone}`;
  return '';
}

async function pruneStaleRiderDuplicates(menuType, savedRows) {
  if (!['delivery_status', 'rider_history'].includes(menuType)) return;
  const supabase = getServiceClient();
  if (!supabase || !savedRows?.length) return;

  const collectDate = String(savedRows[0]?.collect_date || '').slice(0, 10);
  if (!collectDate) return;

  const keepKeys = new Set(savedRows.map(row => row.dedupe_key).filter(Boolean));
  const partnerPrefix = String(
    savedRows[0]?.parsed_json?.partnerId
    || String(savedRows[0]?.dedupe_key || '').split(':')[0]
    || ''
  ).trim();
  const riderIds = [...new Set(savedRows.map(row => String(row.rider_user_id || '').trim()).filter(Boolean))];
  if (!riderIds.length) return;

  const { data: existing, error } = await supabase
    .from('baemin_biz_collect_items')
    .select('id, dedupe_key, rider_user_id')
    .eq('collect_date', collectDate)
    .eq('source_menu', menuType)
    .in('rider_user_id', riderIds);

  if (error || !existing?.length) return;

  const staleIds = existing
    .filter(row => {
      if (!row.rider_user_id || keepKeys.has(row.dedupe_key)) return false;
      if (partnerPrefix && !String(row.dedupe_key || '').startsWith(`${partnerPrefix}:`)) return false;
      return true;
    })
    .map(row => row.id)
    .filter(Boolean);

  if (!staleIds.length) return;

  const { error: deleteError } = await supabase
    .from('baemin_biz_collect_items')
    .delete()
    .in('id', staleIds);

  if (deleteError) {
    console.warn(`[BREM][save] prune stale ${menuType} rows failed:`, deleteError.message);
    return;
  }
  console.log(`[BREM][save] pruned ${staleIds.length} stale ${menuType} row(s) for ${collectDate}`);
}

async function saveCollectRun(runRow) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const { error } = await supabase.from('baemin_biz_collect_runs').insert(runRow);
  if (error) return { ok: false, status: 500, error: error.message || String(error) };
  return { ok: true };
}

function mergeCenterQuery(baseQuery, registry = {}, options = {}) {
  if (options.skipCenterQuery) {
    // 브라우저 CENTER_SESSION 쿠키가 협력사를 식별합니다.
    // URL에 partnerId를 넣으면 delivery-status API가 400(협력사 아이디는 필수)을 반환합니다.
    return { ...baseQuery };
  }
  const centerQuery = buildCenterQueryParams(registry.centerContext || {});
  return { ...baseQuery, ...centerQuery };
}

function shouldUseBrowserSessionForCollect(context = {}) {
  if (context.playwrightPage && !context.playwrightPage.isClosed?.()) return true;
  return Boolean(context.playwrightContext?.request);
}

function shrinkDateRangeEnd(dateRange) {
  if (!dateRange?.fromDate || !dateRange?.toDate) return null;
  if (dateRange.toDate <= dateRange.fromDate) return null;
  const toDate = addDays(dateRange.toDate, -1);
  const dates = [];
  let cursor = dateRange.fromDate;
  while (cursor <= toDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return {
    ...dateRange,
    toDate,
    dates,
    dayCount: dates.length
  };
}

async function discoverAndApplyEndpoint(sourceId, registry, playwrightPage, dateRange, playwrightContext = null, collectDate = null, existingCapture = null) {
  if (existingCapture?.sampleUrl || existingCapture?.spaPayload) {
    const fromCache = applyCaptureToEndpointRegistry(sourceId, registry, existingCapture);
    if (fromCache) return fromCache;
  }

  const discovered = await discoverApiUrlViaPage(playwrightPage, sourceId, dateRange, playwrightContext, collectDate);
  if (!discovered.ok) return null;
  registry.endpoints = registry.endpoints || {};
  registry.endpoints[sourceId] = {
    ...(registry.endpoints[sourceId] || {}),
    sampleUrl: discovered.sampleUrl,
    apiPath: discovered.apiPath,
    apiOrigin: discovered.apiOrigin,
    sampleHeaders: discovered.requestHeaders || registry.endpoints[sourceId]?.sampleHeaders || null,
    spaPayload: discovered.spaPayload || null,
    spaItems: discovered.spaItems || null,
    spaTotalPage: discovered.spaTotalPage || null,
    discoveredAt: new Date().toISOString()
  };
  console.log(`[BREM][collect] ${sourceId} page-capture api=${discovered.sampleUrl}`);
  return resolveApiEndpoint(sourceId, registry);
}

function buildFetchedFromSpaCapture(capture, endpointInfo = {}, options = {}) {
  if (!capture?.spaPayload || typeof capture.spaPayload !== 'object') return null;
  const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');
  const items = capture.spaItems || extractDataArray(capture.spaPayload) || [];
  const totalPage = Number(capture.spaTotalPage || readTotalPages(capture.spaPayload) || 1);
  const sourceUrl = capture.sampleUrl || endpointInfo.sampleUrl || '';
  const minDayCount = Number(options.minDayCount || 0);

  if (!items.length) {
    console.log(`[BREM][collect] spa-capture skip (0 rows) — API pagination fallback url=${sourceUrl}`);
    return null;
  }
  if (totalPage > 1) {
    console.log(`[BREM][collect] spa-capture skip (totalPage=${totalPage}) — full pagination via API url=${sourceUrl}`);
    return null;
  }
  if (minDayCount > 1) {
    const { extractBusinessDate } = require('./baemin-collect-sources');
    const uniqueDates = new Set(
      items.map(item => String(extractBusinessDate(item, options) || '').slice(0, 10)).filter(Boolean)
    );
    if (uniqueDates.size < Math.min(minDayCount, 3)) {
      console.log(`[BREM][collect] spa-capture skip (uniqueDays=${uniqueDates.size} < need ${minDayCount}) url=${sourceUrl}`);
      return null;
    }
  }

  console.log(`[BREM][collect] spa-capture 사용 rows=${items.length} url=${sourceUrl}`);
  return {
    ok: true,
    items,
    meta: {
      totalPage: Math.max(totalPage, 1),
      rawCount: items.length,
      sourceUrl,
      apiPath: endpointInfo.apiPath,
      via: 'spa-capture'
    }
  };
}

function applyCaptureToEndpointRegistry(sourceId, registry, capture) {
  if (!capture || (!capture.sampleUrl && !capture.spaPayload)) return null;
  let apiPath = capture.apiPath || registry.endpoints?.[sourceId]?.apiPath || '';
  let apiOrigin = capture.apiOrigin || registry.endpoints?.[sourceId]?.apiOrigin || '';
  if (capture.sampleUrl) {
    try {
      const parsed = new URL(capture.sampleUrl);
      apiPath = apiPath || parsed.pathname;
      apiOrigin = apiOrigin || parsed.origin;
    } catch {
      // ignore
    }
  }
  registry.endpoints = registry.endpoints || {};
  registry.endpoints[sourceId] = {
    ...(registry.endpoints[sourceId] || {}),
    sampleUrl: capture.sampleUrl || registry.endpoints[sourceId]?.sampleUrl || null,
    apiPath: apiPath || registry.endpoints[sourceId]?.apiPath || null,
    apiOrigin: apiOrigin || registry.endpoints[sourceId]?.apiOrigin || null,
    sampleHeaders: capture.requestHeaders || capture.headers || registry.endpoints[sourceId]?.sampleHeaders || null,
    spaPayload: capture.spaPayload || null,
    spaItems: capture.spaItems || null,
    spaTotalPage: capture.spaTotalPage || null,
    discoveredAt: registry.endpoints[sourceId]?.discoveredAt || new Date().toISOString()
  };
  if (capture.sampleUrl) {
    console.log(`[BREM][collect] ${sourceId} cached capture api=${capture.sampleUrl}`);
  }
  return resolveApiEndpoint(sourceId, registry);
}

function endpointOriginForPath(apiPath, preferredOrigin) {
  if (preferredOrigin) return preferredOrigin;
  return String(apiPath || '').startsWith('/v4/') ? BAEMIN_API_ORIGIN : BAEMIN_ORIGIN;
}

function isApiOnlyPath(apiPath) {
  const path = String(apiPath || '');
  return path.startsWith('/v2/') || path.startsWith('/v4/') || path === '/delivery-status';
}

function buildEndpointCandidates(sourceId, source, endpoint) {
  const paths = [
    endpoint?.apiPath,
    ...(source?.fallbackApiPaths || [])
  ].filter(Boolean).filter(isApiOnlyPath);
  const uniquePaths = [...new Set(paths)];
  const origins = [...new Set(
    (sourceId === 'delivery_status'
      ? [endpoint?.apiOrigin, BAEMIN_API_ORIGIN, BAEMIN_ORIGIN]
      : [endpoint?.apiOrigin, BAEMIN_API_ORIGIN]
    ).filter(Boolean)
  )];

  const candidates = [];
  uniquePaths.forEach(apiPath => {
    origins.forEach(apiOrigin => {
      candidates.push({
        apiOrigin: endpointOriginForPath(apiPath, apiOrigin),
        apiPath,
        sampleUrl: null,
        sampleHeaders: endpoint?.sampleHeaders || null
      });
    });
  });
  return candidates;
}

async function fetchOneHistoryDay({
  sourceId,
  source,
  endpoint,
  activeDateRange,
  collectDate,
  tryFetch,
  day,
  context
}) {
  const dayRange = toSingleDayRange(day, activeDateRange);

  if ((sourceId === 'rider_history' || sourceId === 'daily_history')
    && context?.playwrightPage
    && !context.playwrightPage.isClosed?.()) {
    const { buildSpaPageUrl } = require('./baemin-page-capture');
    const spaUrl = buildSpaPageUrl(sourceId, dayRange, collectDate);
    if (spaUrl) {
      const page = context.playwrightPage;
      const partnerId = String(context.registry?.centerContext?.partnerId || '').trim();
      console.log(`[BREM][collect] ${sourceId} ▶ ${day} (${partnerId || 'partner'}) browser ${spaUrl}`);
      try {
        if (page.url() !== spaUrl) {
          await page.goto(spaUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        } else {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        }
        await new Promise(resolve => setTimeout(resolve, 700));
      } catch (error) {
        console.warn(`[BREM][collect] ${sourceId} day=${day} browser navigate failed: ${error.message || error}`);
      }
    }
  }

  let dayResult = await tryFetch({ ...endpoint, sampleUrl: null }, dayRange);
  if (!dayResult.ok && (dayResult.status === 404 || dayResult.status === 400)) {
    const candidates = buildEndpointCandidates(sourceId, source, endpoint);
    for (const candidate of candidates) {
      dayResult = await tryFetch(candidate, dayRange);
      if (dayResult.ok) break;
    }
  }
  if (!dayResult.ok) {
    console.warn(`[BREM][collect] ${sourceId} day=${day} failed status=${dayResult.status} msg=${dayResult.message}`);
    return null;
  }
  const items = (dayResult.items || []).map(item => {
    if (!item || typeof item !== 'object') return item;
    return { ...item, __bremDayDate: day };
  });
  console.log(`[BREM][collect] ${sourceId} day=${day} rows=${items.length}`);
  return {
    items,
    sourceUrl: dayResult.meta?.sourceUrl || ''
  };
}

async function fetchHistoryByDays({
  sourceId,
  source,
  endpoint,
  sessionCookie,
  registry,
  context,
  activeDateRange,
  collectDate,
  tryFetch
}) {
  const dates = activeDateRange?.dates?.length
    ? activeDateRange.dates
    : (activeDateRange?.fromDate && activeDateRange?.toDate
      ? buildDateList(activeDateRange.fromDate, activeDateRange.toDate)
      : [activeDateRange?.toDate || collectDate]);
  const merged = [];
  let lastUrl = '';
  const dayConcurrency = (sourceId === 'rider_history' || sourceId === 'daily_history') ? 1 : 4;

  for (let offset = 0; offset < dates.length; offset += dayConcurrency) {
    const batch = dates.slice(offset, offset + dayConcurrency);
    const batchResults = await Promise.all(batch.map(day => fetchOneHistoryDay({
      sourceId,
      source,
      endpoint,
      activeDateRange,
      collectDate,
      tryFetch,
      day,
      context
    })));
    batchResults.forEach(row => {
      if (!row) return;
      merged.push(...row.items);
      if (row.sourceUrl) lastUrl = row.sourceUrl;
    });
  }

  if (!merged.length) return null;
  return {
    ok: true,
    items: merged,
    meta: {
      totalPage: 1,
      rawCount: merged.length,
      sourceUrl: lastUrl,
      apiPath: endpoint.apiPath,
      perDay: true
    }
  };
}

async function fetchAndSaveHistoryByDays({
  sourceId,
  source,
  endpoint,
  registry,
  context,
  activeDateRange,
  collectDate,
  tryFetch
}) {
  const dates = activeDateRange?.dates?.length
    ? activeDateRange.dates
    : buildDateList(activeDateRange.fromDate, activeDateRange.toDate);
  const partnerId = String(registry.centerContext?.partnerId || registry.centerContext?.centerId || '').trim();
  const partnerName = String(registry.centerContext?.partnerName || context.partnerName || '').trim();
  const regionName = String(registry.centerContext?.regionName || context.regionName || '').trim();
  const collectedAt = new Date().toISOString();
  let totalSaved = 0;
  let lastUrl = '';
  let failedDays = 0;
  let emptyDays = 0;
  const dayResults = [];

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
    const day = dates[dayIndex];
    collectProgress.updateDay({
      dayIndex: dayIndex + 1,
      dayTotal: dates.length,
      dayDate: day
    });
    let dayRow = await fetchOneHistoryDay({
      sourceId,
      source,
      endpoint,
      activeDateRange,
      collectDate,
      tryFetch,
      day,
      context: { ...context, registry }
    });
    // 자동수집 첫날(수요일)이 세션/전환 직후 실패하는 경우가 많아 1회 재시도
    if (!dayRow && dayIndex === 0) {
      console.warn(`[BREM][collect] ${sourceId} first-day retry ${day}`);
      await new Promise(resolve => setTimeout(resolve, 1200));
      dayRow = await fetchOneHistoryDay({
        sourceId,
        source,
        endpoint,
        activeDateRange,
        collectDate,
        tryFetch,
        day,
        context: { ...context, registry }
      });
    }
    if (!dayRow) {
      failedDays += 1;
      dayResults.push({ date: day, status: 'failed', savedCount: 0, message: '수집 실패' });
      continue;
    }
    if (dayRow.sourceUrl) lastUrl = dayRow.sourceUrl;
    if (!dayRow.items.length) {
      emptyDays += 1;
      dayResults.push({ date: day, status: 'empty', savedCount: 0, message: '데이터 0건' });
      continue;
    }

    const rows = dayRow.items.map((item, index) => mapItemToCollectRow(
      sourceId,
      item,
      collectDate,
      dayRow.sourceUrl,
      collectedAt,
      {
        partnerId,
        partnerName,
        regionName,
        index,
        collectDate,
        dateRange: { ...activeDateRange, fromDate: day, toDate: day, dates: [day], dayCount: 1 },
        historyQueryDates: { fromDate: day, toDate: day, dates: [day], dayCount: 1 },
        dayDate: day,
        historyMenu: true
      }
    ));
    const saveResult = await saveCollectItems(rows);
    if (!saveResult.ok) {
      dayResults.push({
        date: day,
        status: 'failed',
        savedCount: 0,
        message: saveResult.message || saveResult.error || '저장 실패'
      });
      return {
        ok: false,
        message: saveResult.message || saveResult.error || `${day} 저장 실패`,
        savedCount: totalSaved,
        meta: {
          perDay: true,
          sourceUrl: lastUrl,
          failedDays: failedDays + 1,
          emptyDays,
          dayCount: dates.length,
          dayResults
        }
      };
    }
    const savedCount = Number(saveResult.savedCount || rows.length);
    totalSaved += savedCount;
    collectProgress.addSaved(savedCount);
    dayResults.push({ date: day, status: 'ok', savedCount, message: '수집완료' });
    console.log(`[BREM][collect] ${sourceId} partner=${partnerId || '-'} day=${day} saved=${savedCount}`);
  }

  return {
    ok: failedDays < dates.length,
    savedCount: totalSaved,
    items: [],
    meta: {
      totalPage: 1,
      rawCount: totalSaved,
      sourceUrl: lastUrl,
      apiPath: endpoint.apiPath,
      perDay: true,
      incrementalSave: true,
      failedDays,
      emptyDays,
      dayCount: dates.length,
      dayResults
    },
    incrementalSave: true
  };
}

function shouldAggregateRiderFromDaily(sourceId, registry, dateRange = null) {
  if (sourceId !== 'rider_history') return false;
  if (dateRange?.mode === 'rider_per_day') return false;
  if (Number(dateRange?.dayCount || 0) > 1 || (dateRange?.dates?.length || 0) > 1) return false;
  const riderEndpoint = mergeEndpointWithDefault('rider_history', registry?.endpoints?.rider_history || {});
  const dailyEndpoint = mergeEndpointWithDefault('daily_history', registry?.endpoints?.daily_history || {});
  if (riderEndpoint?.fallbackFromDaily) return true;
  if (isDistinctRiderHistoryEndpoint(riderEndpoint, dailyEndpoint)) {
    return false;
  }
  const dailyPath = dailyEndpoint.apiPath || '/delivery/history';
  const riderPath = riderEndpoint.apiPath || '/delivery/history';
  return riderPath === dailyPath && !riderEndpoint?.sampleUrl?.includes('userId=');
}

function isSessionAuthFailure(result) {
  return result?.status === 401
    || result?.status === 403
    || result?.message === '배민 로그인 만료'
    || /재로그인|로그인 만료|세션 만료/i.test(String(result?.message || ''));
}

function extractCollectItemsFingerprint(sourceId, items = [], partnerId = '') {
  const rows = Array.isArray(items) ? items : [];
  // partnerId 접두사는 비교에 쓰지 않음(세션 미전환 감지용). 접두사 포함 시 DP만 달라져 항상 통과함.
  const bare = (() => {
    if (sourceId === 'delivery_status') {
      return rows.slice(0, 8).map(row => {
        const acceptance = row?.deliveryAcceptanceCount || {};
        const complete = acceptance.totalComplete ?? row.totalComplete ?? row.completeCount ?? 0;
        return `${row.userId || row.riderId || row.name || row.phoneNumber || ''}:${complete}`;
      }).join('|');
    }
    if (sourceId === 'daily_history') {
      return rows.slice(0, 5).map(row =>
        `${row.businessDay || row.deliveryDate || row.date}:${row.totalComplete ?? row.completeCount ?? row.deliveryCount ?? 0}`
      ).join('|');
    }
    if (sourceId === 'rider_history') {
      return rows.slice(0, 8).map(row => {
        const acceptance = row?.deliveryAcceptanceCount || {};
        const complete = acceptance.totalComplete ?? row.totalComplete ?? row.completeCount ?? 0;
        return `${row.userId || row.riderId || row.name || row.phoneNumber || ''}:${complete}`;
      }).join('|');
    }
    return '';
  })();
  void partnerId;
  return bare;
}

function fingerprintBody(fp) {
  const text = String(fp || '').trim();
  if (!text) return '';
  // 구버전 prefix(DP…:)가 남아 있으면 제거해 비교
  return text.replace(/^DP\d{6,}:/i, '');
}

function isPartnerSessionMismatchResult(result) {
  const message = String(result?.message || result?.error || '');
  return /세션 미반영|동일 fingerprint|협력사 전환 후 동일|협력사 전환 실패/i.test(message);
}

function shouldBlockCrossPartnerFingerprint(sourceId, itemFingerprint, context = {}) {
  if (sourceId !== 'delivery_status') return false;
  if (!itemFingerprint || Number(context.partnerCollectIndex || 0) <= 0) return false;
  const referenceFp = String(context.lastPartnerMenuFingerprints?.[sourceId] || '').trim();
  if (!referenceFp) return false;
  const left = fingerprintBody(referenceFp);
  const right = fingerprintBody(itemFingerprint);
  return Boolean(left && right && left === right);
}

async function collectSource(sourceId, sessionCookie, collectDate, registry = {}, context = {}) {
  const source = getCollectSource(sourceId);
  const collectedAt = new Date().toISOString();
  if (!source) {
    return { ok: false, sourceMenu: sourceId, message: '알 수 없는 수집 소스' };
  }

  const menuDateRanges = context.menuDateRanges || {};
  const sourceRange = menuDateRanges[sourceId] || context.historyDateRange || null;
  const dateRangeLabel = menuDateRanges[sourceId]?.label
    || (source.dateQueryKeys?.length && sourceRange
      ? `${sourceRange.fromDate} ~ ${sourceRange.toDate}`
      : '오늘 기준');
  console.log(`[BREM][collect] ${source.label}(${sourceId}): ${dateRangeLabel}`);

  let activeDateRange = source.dateQueryKeys?.length
    ? resolveHistoryMenuQueryDates(collectDate, context.shrunkHistoryToDate
      ? { ...(sourceRange || {}), toDate: context.shrunkHistoryToDate }
      : sourceRange)
    : null;

  if (source.dateQueryKeys?.length && activeDateRange?.skipped) {
    console.log(`[BREM][collect] ${sourceId} 생략 — ${activeDateRange.skipReason || activeDateRange.label || '기간 없음'}`);
    return {
      ok: true,
      skipped: true,
      sourceMenu: sourceId,
      label: source.label,
      message: activeDateRange.skipReason || '수집 생략',
      savedCount: 0
    };
  }

  if (sourceId === 'rider_history' && activeDateRange?.mode === 'rider_per_day' && registry?.endpoints?.rider_history?.fallbackFromDaily) {
    delete registry.endpoints.rider_history.fallbackFromDaily;
  }

  if (shouldAggregateRiderFromDaily(sourceId, registry, activeDateRange)) {
    let dailyItems = context.dailyItems;
    let sourceUrl = context.dailySourceUrl || '';
    if (!dailyItems) {
      const daily = await collectSource('daily_history', sessionCookie, collectDate, registry, context);
      if (!daily.ok) return { ...daily, sourceMenu: sourceId, label: source.label };
      dailyItems = daily.rawItems || [];
      sourceUrl = daily.sourceUrl || '';
    }
    const partnerId = String(registry.centerContext?.partnerId || registry.centerContext?.centerId || '').trim();
    const partnerName = String(registry.centerContext?.partnerName || context.partnerName || '').trim();
    const regionName = String(registry.centerContext?.regionName || context.regionName || '').trim();
    const rows = aggregateRiderHistoryFromDaily(dailyItems, collectDate, collectedAt, sourceUrl, {
      partnerId,
      partnerName,
      regionName,
      collectDate,
      dateRange: activeDateRange || context.dateRange || null,
      historyQueryDates: activeDateRange || null
    });
    const saveResult = await saveCollectItems(rows);
    if (!saveResult.ok) return { ...saveResult, sourceMenu: sourceId, label: source.label };
    const menuFingerprint = extractCollectItemsFingerprint('rider_history', dailyItems, partnerId);
    return {
      ok: true,
      sourceMenu: sourceId,
      label: source.label,
      savedCount: saveResult.savedCount,
      sourceUrl,
      collectedAt,
      fallback: 'daily_aggregate',
      rawItems: dailyItems,
      menuFingerprint
    };
  }

  let endpoint = resolveApiEndpoint(sourceId, registry);

  if (context.playwrightPage) {
    const { preparePageForCollect } = require('./baemin-page-capture');
    let prepRange = source.dateQueryKeys?.length ? activeDateRange : null;
    if (sourceId === 'rider_history' && activeDateRange?.mode === 'rider_per_day' && activeDateRange?.dates?.length) {
      prepRange = toSingleDayRange(activeDateRange.dates[0], activeDateRange);
    }
    const existingCapture = context.spaCapture?.[sourceId];
    const { historyDateRangeMatchesRequest } = require('./baemin-settlement-week');
    const captureMatchesRange = !prepRange?.mode
      || (prepRange.mode !== 'biz_month' && prepRange.mode !== 'biz_range')
      || historyDateRangeMatchesRequest(existingCapture, prepRange);
    const hasUsableCapture = Boolean(
      captureMatchesRange
      && existingCapture?.spaPayload
      && (existingCapture.spaItems?.length || existingCapture.spaTotalPage)
    );
    if (!hasUsableCapture) {
      const prepCapture = await preparePageForCollect(
        context.playwrightPage,
        sourceId,
        prepRange || {},
        collectDate
      ).catch(error => {
        console.warn(`[BREM][collect] ${sourceId} page prep failed:`, error.message);
        return null;
      });
      if (prepCapture?.spaPayload || prepCapture?.sampleUrl) {
        context.spaCapture = context.spaCapture || {};
        context.spaCapture[sourceId] = prepCapture;
      }
    }
  }

  const cachedCapture = context.spaCapture?.[sourceId] || null;
  const discoveryRange = (sourceId === 'rider_history' && activeDateRange?.mode === 'rider_per_day' && activeDateRange?.dates?.length)
    ? toSingleDayRange(activeDateRange.dates[0], activeDateRange)
    : activeDateRange;
  if (context.playwrightPage && discoveryRange && source.dateQueryKeys?.length) {
    endpoint = applyCaptureToEndpointRegistry(sourceId, registry, cachedCapture)
      || await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, discoveryRange, context.playwrightContext, collectDate, cachedCapture)
      || endpoint;
  } else if (!endpoint?.apiPath && context.playwrightPage && discoveryRange) {
    endpoint = applyCaptureToEndpointRegistry(sourceId, registry, cachedCapture)
      || await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, discoveryRange, context.playwrightContext, collectDate, cachedCapture)
      || endpoint;
  }

  if (!endpoint?.apiPath) {
    return { ok: false, sourceMenu: sourceId, label: source.label, message: `${source.label} API 경로 없음` };
  }

  console.log(`[BREM][collect] ${sourceId} start collectDate=${collectDate} range=${activeDateRange?.fromDate || collectDate}~${activeDateRange?.toDate || collectDate} api=${endpoint.apiOrigin}${endpoint.apiPath}${endpoint.sampleUrl ? ' (sampleUrl)' : ''}`);

  async function tryFetch(endpointInfo, dateRange = activeDateRange) {
    const useBrowserSession = shouldUseBrowserSessionForCollect(context);
    const builtQuery = buildDefaultQuery(sourceId, collectDate, dateRange);
    if (Number(dateRange?.dayCount || 0) > 7) {
      builtQuery.size = Math.max(Number(builtQuery.size || 0), 100);
    }
    const baseQuery = mergeCenterQuery(
      builtQuery,
      registry,
      { skipCenterQuery: useBrowserSession }
    );
    const partnerId = String(registry.centerContext?.partnerId || registry.centerContext?.centerId || '').trim();
    if (!partnerId) {
      return {
        ok: false,
        status: 400,
        error: 'PARTNER_ID_REQUIRED',
        message: '협력사 아이디는 필수입니다. 배민 브라우저 상단에서 협력사(예: OO센터(DP123456))를 선택한 뒤 다시 시도하세요. betabaemin.com 이 아닌 deliverycenter.baemin.com 에 로그인되어 있는지 확인하세요.'
      };
    }
    const centerHeaders = endpointInfo.sampleHeaders && typeof endpointInfo.sampleHeaders === 'object'
      ? endpointInfo.sampleHeaders
      : null;
    if (useBrowserSession && source.dateQueryKeys?.length) {
      console.log(`[BREM][collect:${sourceId}] browser-tab range fetch partnerId=${partnerId} ${dateRange?.fromDate}~${dateRange?.toDate}`);
    } else if (useBrowserSession) {
      console.log(`[BREM][collect:${sourceId}] browser-tab fetch partnerId=${partnerId}`);
    }
    return fetchPaginatedApi({
      apiOrigin: endpointInfo.apiOrigin,
      apiPath: endpointInfo.apiPath,
      sampleUrl: endpointInfo.sampleUrl,
      sampleHeaders: centerHeaders,
      exactSampleUrl: false,
      sessionCookie,
      baseQuery,
      pagination: source.pagination,
      logPrefix: `[BREM][collect:${sourceId}]`,
      logContext: context.runId ? {
        collectDate,
        sourceMenu: sourceId,
        runId: context.runId
      } : null,
      playwrightContext: context.playwrightContext || null,
      playwrightPage: context.playwrightPage || null
    });
  }

  let fetched = null;
  const isHistoryPerDay = (sourceId === 'rider_history' || sourceId === 'daily_history')
    && source.dateQueryKeys?.length
    && activeDateRange
    && !activeDateRange.skipped
    && (
      activeDateRange.mode === 'rider_per_day'
      || activeDateRange.mode === 'daily_per_day'
      || (activeDateRange.fromDate && activeDateRange.toDate)
    );

  if (isHistoryPerDay && !activeDateRange.dates?.length && activeDateRange.fromDate && activeDateRange.toDate) {
    const historyDates = buildDateList(activeDateRange.fromDate, activeDateRange.toDate);
    activeDateRange = {
      ...activeDateRange,
      dates: historyDates,
      dayCount: historyDates.length,
      mode: sourceId === 'daily_history' ? 'daily_per_day' : 'rider_per_day'
    };
  }

  if (isHistoryPerDay) {
    console.log(`[BREM][collect] ${sourceId} per-day mode ${activeDateRange.fromDate}~${activeDateRange.toDate} (${activeDateRange.dayCount}일, fromDate=toDate 하루씩)`);
    fetched = await fetchAndSaveHistoryByDays({
      sourceId,
      source,
      endpoint: { ...endpoint, sampleUrl: null },
      registry,
      context,
      activeDateRange,
      collectDate,
      tryFetch
    });
    if (!fetched?.ok && context.playwrightPage && activeDateRange) {
      endpoint = await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, {
        ...activeDateRange,
        fromDate: activeDateRange.dates?.[0] || activeDateRange.fromDate,
        toDate: activeDateRange.dates?.[0] || activeDateRange.fromDate,
        dates: [activeDateRange.dates?.[0] || activeDateRange.fromDate],
        dayCount: 1
      }, context.playwrightContext, collectDate)
        || endpoint;
      fetched = await fetchAndSaveHistoryByDays({
        sourceId,
        source,
        endpoint: { ...endpoint, sampleUrl: null },
        registry,
        context,
        activeDateRange,
        collectDate,
        tryFetch
      });
    }
    if (!fetched) {
      fetched = { ok: false, status: 502, message: '라이더 일별 수집 데이터 없음', items: [], savedCount: 0 };
    }
    if (fetched.incrementalSave) {
      if (!fetched.ok) {
        const message = fetched.message || '라이더 일별 수집 실패';
        return {
          ok: false,
          sourceMenu: sourceId,
          label: source.label,
          status: fetched.status,
          message,
          savedCount: Number(fetched.savedCount || 0),
          sourceUrl: fetched.meta?.sourceUrl || '',
          meta: fetched.meta || null,
          dayResults: Array.isArray(fetched.meta?.dayResults) ? fetched.meta.dayResults : []
        };
      }
      const savedCount = Number(fetched.savedCount || 0);
      return {
        ok: true,
        sourceMenu: sourceId,
        label: source.label,
        dateRangeLabel,
        savedCount,
        statsSavedCount: 0,
        sourceUrl: fetched.meta?.sourceUrl || '',
        collectedAt: new Date().toISOString(),
        rawItems: [],
        menuFingerprint: '',
        meta: fetched.meta,
        dayResults: Array.isArray(fetched.meta?.dayResults) ? fetched.meta.dayResults : [],
        message: savedCount > 0
          ? `${activeDateRange.dayCount}일 순차 수집 · ${savedCount}건 Supabase 저장`
          : '수집 데이터 0건'
      };
    }
  } else if (source.dateQueryKeys?.length && activeDateRange?.dayCount > 1) {
    console.log(`[BREM][collect] ${sourceId} range mode ${activeDateRange.fromDate}~${activeDateRange.toDate} (${activeDateRange.dayCount}일, fromDate/toDate 일괄 조회)`);
    fetched = await tryFetch(endpoint);
    if (!fetched?.ok || !(fetched.items || []).length) {
      const spaFetched = buildFetchedFromSpaCapture(context.spaCapture?.[sourceId], endpoint, { collectDate })
        || buildFetchedFromSpaCapture(registry.endpoints?.[sourceId], endpoint, { collectDate });
      if (spaFetched?.ok && (spaFetched.items || []).length) {
        fetched = spaFetched;
      }
    }
    if (!fetched?.ok) {
      fetched = await tryFetch(endpoint);
    }
  } else {
    fetched = await tryFetch(endpoint);
    if (!fetched?.ok || !(fetched.items || []).length) {
      const spaFetched = buildFetchedFromSpaCapture(context.spaCapture?.[sourceId], endpoint, { collectDate })
        || buildFetchedFromSpaCapture(registry.endpoints?.[sourceId], endpoint, { collectDate });
      if (spaFetched?.ok && (spaFetched.items || []).length) {
        fetched = spaFetched;
      }
    }
  }

  if (!isHistoryPerDay && !fetched?.ok) {
    fetched = fetched || await tryFetch(endpoint);
  }
  if (!fetched.ok && (fetched.status === 404 || fetched.status === 400) && endpoint.sampleUrl) {
    console.warn(`[BREM][collect] ${sourceId} stored sampleUrl failed — rediscover`);
    endpoint = { ...endpoint, sampleUrl: null };
    if (registry.endpoints?.[sourceId]) {
      registry.endpoints[sourceId].sampleUrl = null;
    }
  }
  if (!fetched.ok && (fetched.status === 404 || fetched.status === 400) && context.playwrightPage && activeDateRange) {
    endpoint = await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, activeDateRange, context.playwrightContext, collectDate)
      || endpoint;
    fetched = await tryFetch(endpoint);
  }
  if (!fetched.ok && (fetched.status === 404 || fetched.status === 400) && activeDateRange) {
    let shrunk = shrinkDateRangeEnd(activeDateRange);
    while (!fetched.ok && fetched.status === 400 && shrunk) {
      const partnerRequired = /협력사 아이디는 필수/i.test(String(fetched.message || fetched.bodyText || ''));
      if (partnerRequired) break;
      console.warn(`[BREM][collect] ${sourceId} 400 — 영업일 미마감 가능, toDate=${shrunk.toDate} 로 재시도`);
      activeDateRange = shrunk;
      context.shrunkHistoryToDate = shrunk.toDate;
      if (context.playwrightPage) {
        endpoint = await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, activeDateRange, context.playwrightContext, collectDate)
          || endpoint;
      }
      fetched = await tryFetch(endpoint, activeDateRange);
      shrunk = fetched.ok ? null : shrinkDateRangeEnd(activeDateRange);
    }
  }
  if (!isHistoryPerDay && !fetched.ok && (fetched.status === 404 || fetched.status === 400) && source.dateQueryKeys?.length) {
    console.warn(`[BREM][collect] ${sourceId} range fetch failed — per-day fallback (최후 수단)`);
    const byDay = await fetchHistoryByDays({
      sourceId,
      source,
      endpoint,
      sessionCookie,
      registry,
      context,
      activeDateRange,
      collectDate,
      tryFetch
    });
    if (byDay) fetched = byDay;
  }
  if (
    !isHistoryPerDay
    && source.dateQueryKeys?.length
    && fetched.ok
    && !(fetched.items || []).length
  ) {
    console.warn(`[BREM][collect] ${sourceId} range empty — per-day fallback (최후 수단) ${activeDateRange?.fromDate}~${activeDateRange?.toDate}`);
    const byDay = await fetchHistoryByDays({
      sourceId,
      source,
      endpoint: { ...endpoint, sampleUrl: null },
      sessionCookie,
      registry,
      context,
      activeDateRange,
      collectDate,
      tryFetch
    });
    if (byDay?.items?.length) fetched = byDay;
  }
  if (
    sourceId === 'delivery_status'
    && context.playwrightPage
    && (!fetched.ok || !(fetched.items || []).length)
  ) {
    console.warn(`[BREM][collect] delivery_status retry via SPA navigation`);
    endpoint = { ...endpoint, sampleUrl: null };
    if (registry.endpoints?.delivery_status) {
      registry.endpoints.delivery_status.sampleUrl = null;
    }
    const pageCapture = require('./baemin-page-capture');
    const prep = await pageCapture.preparePageForCollect(
      context.playwrightPage,
      'delivery_status',
      {},
      collectDate
    ).catch(() => null);
    if (prep?.sampleUrl || prep?.spaPayload) {
      context.spaCapture = context.spaCapture || {};
      context.spaCapture.delivery_status = prep;
      endpoint = applyCaptureToEndpointRegistry('delivery_status', registry, prep) || endpoint;
      const retry = buildFetchedFromSpaCapture(prep, endpoint) || await tryFetch(endpoint);
      if (retry.ok && (retry.items || []).length) fetched = retry;
    }
    if (!fetched?.ok || !(fetched.items || []).length) {
      const probed = await pageCapture.probeApiFromBrowserTab(
        context.playwrightPage,
        'delivery_status',
        null,
        context.playwrightContext,
        collectDate
      );
      if (probed.ok && probed.sampleUrl) {
        endpoint = { ...endpoint, ...probed, sampleUrl: probed.sampleUrl };
        const retry = await tryFetch(endpoint);
        if (retry.ok && (retry.items || []).length) fetched = retry;
      }
    }
  }
  if (!fetched.ok && fetched.status === 404 && source.fallbackApiPaths?.length) {
    const candidates = buildEndpointCandidates(sourceId, source, endpoint);
    for (const candidate of candidates) {
      if (candidate.apiPath === endpoint.apiPath && candidate.apiOrigin === endpoint.apiOrigin) continue;
      console.log(`[BREM][collect] ${sourceId} retry api=${candidate.apiOrigin}${candidate.apiPath}`);
      fetched = await tryFetch(candidate);
      if (fetched.ok) {
        endpoint = candidate;
        break;
      }
    }
  }

  if (!fetched.ok) {
    const message = isSessionAuthFailure(fetched)
      ? '배민 재로그인 필요'
      : (fetched.message || fetched.error || 'API 호출 실패');
    return {
      ok: false,
      sourceMenu: sourceId,
      label: source.label,
      status: fetched.status,
      message,
      sessionExpired: isSessionAuthFailure(fetched),
      sourceUrl: fetched.meta?.sourceUrl || ''
    };
  }

  const partnerId = String(registry.centerContext?.partnerId || registry.centerContext?.centerId || '').trim();
  const partnerName = String(registry.centerContext?.partnerName || context.partnerName || '').trim();
  const regionName = String(registry.centerContext?.regionName || context.regionName || '').trim();

  const items = fetched.items || [];
  if (!items.length) {
    console.log(`[BREM][collect] ${sourceId} 수집 데이터 0건 (partner=${partnerId || '-'})`);
    return {
      ok: true,
      sourceMenu: sourceId,
      label: source.label,
      dateRangeLabel,
      savedCount: 0,
      sourceUrl: fetched.meta?.sourceUrl || '',
      collectedAt,
      rawItems: [],
      menuFingerprint: extractCollectItemsFingerprint(sourceId, [], partnerId),
      message: '수집 데이터 0건'
    };
  }

  const itemFingerprint = extractCollectItemsFingerprint(sourceId, items, partnerId);
  if (shouldBlockCrossPartnerFingerprint(sourceId, itemFingerprint, { ...context, registry })) {
    if (context.playwrightPage && !context.playwrightPage.isClosed?.() && partnerId) {
      context._fingerprintRetry = context._fingerprintRetry || {};
      if (!context._fingerprintRetry[sourceId]) {
        context._fingerprintRetry[sourceId] = true;
        console.warn(`[BREM][collect] ${sourceId} 동일 fingerprint — 협력사 재전환 후 재수집 (partner=${partnerId})`);
        const { selectPartnerCenter } = require('./baemin-center-context');
        if (context.spaCapture?.[sourceId]) delete context.spaCapture[sourceId];
        const stored = context.playwrightPage.context()?.__bremCapturedApiRequests;
        if (stored?.[sourceId]) delete stored[sourceId];
        await selectPartnerCenter(context.playwrightPage, {
          partnerId,
          partnerName,
          requireSessionChange: false
        }).catch(error => {
          console.warn(`[BREM][collect] ${sourceId} 재전환 실패:`, error.message);
        });
        return collectSource(sourceId, sessionCookie, collectDate, registry, context);
      }
    }
    console.warn(`[BREM][collect] ${sourceId} 동일 fingerprint — 협력사 세션 미반영 (partner=${partnerId || '-'})`);
    return {
      ok: false,
      sourceMenu: sourceId,
      label: source.label,
      message: '협력사 전환 후 동일 데이터(세션 미반영)',
      sessionMismatch: true,
      sourceUrl: fetched.meta?.sourceUrl || ''
    };
  }

  const rows = items.map((item, index) => mapItemToCollectRow(
    sourceId,
    item,
    collectDate,
    fetched.meta?.sourceUrl || '',
    collectedAt,
    {
      partnerId,
      partnerName,
      regionName,
      index,
      collectDate,
      historyMenu: sourceId === 'daily_history' || sourceId === 'rider_history',
      dateRange: activeDateRange || context.dateRange || null,
      historyQueryDates: activeDateRange || null,
      dayDate: item?.__bremDayDate || undefined
    }
  ));

  const saveResult = await saveCollectItems(rows);
  if (!saveResult.ok) {
    return { ...saveResult, sourceMenu: sourceId, label: source.label, rawItems: items };
  }

  const weekStart = context.weekStart || context.dateRange?.weekStart || collectDate;
  const statsSave = await saveStatsForSource(
    sourceId,
    items,
    weekStart,
    collectedAt,
    fetched.meta?.sourceUrl || '',
    {
      partnerId,
      dateRange: activeDateRange || context.dateRange || null
    }
  );
  if (!statsSave.ok) {
    console.warn(`[BREM][collect] stats save failed (${sourceId}):`, statsSave.message || statsSave.error);
  }

  const statsRows = items.map(item => extractStatsFromItem(item, collectDate));
  const totals = sumStats(statsRows);

  return {
    ok: true,
    sourceMenu: sourceId,
    label: source.label,
    dateRangeLabel,
    savedCount: saveResult.savedCount,
    statsSavedCount: statsSave.savedCount || 0,
    sourceUrl: fetched.meta?.sourceUrl || '',
    collectedAt,
    rawItems: items,
    menuFingerprint: itemFingerprint,
    meta: fetched.meta,
    totals
  };
}

function readPartnerContext(registry, context = {}) {
  return {
    partnerId: String(registry.centerContext?.partnerId || registry.centerContext?.centerId || '').trim(),
    partnerName: String(registry.centerContext?.partnerName || context.partnerName || '').trim(),
    regionName: String(registry.centerContext?.regionName || context.regionName || '').trim()
  };
}

function resetPartnerSpaCapture(context, registry, playwrightPage = null) {
  if (context) {
    context.spaCapture = {};
    context.dailyItems = null;
    context.dailySourceUrl = '';
    context.shrunkHistoryToDate = null;
    context.partnerDataFingerprint = '';
  }
  if (playwrightPage?.context()) {
    playwrightPage.context().__bremCapturedApiRequests = {};
  }
  if (!registry?.endpoints) return;
  Object.keys(registry.endpoints).forEach(key => {
    const row = registry.endpoints[key];
    if (!row || typeof row !== 'object') return;
    row.sampleUrl = null;
    row.spaPayload = null;
    row.spaItems = null;
    row.spaTotalPage = null;
  });
}

function attachCollectCenterRoute(playwrightPage, registry, detachRef = { current: null }) {
  if (typeof detachRef.current === 'function') {
    detachRef.current();
  }
  // 브라우저 탭 fetch(credentials:include)는 CENTER_SESSION 쿠키를 따릅니다.
  // partner-id 헤더 주입은 세션과 충돌해 동일 데이터가 반복 저장될 수 있어 비활성화합니다.
  detachRef.current = () => {};
}

async function runPartnerSourceCollectLoop({
  cookie,
  collectDate,
  registry,
  pipelineContext,
  menuDateRanges,
  historyDateRange,
  source,
  collectedAt,
  sourceDefs,
  playwrightContext,
  playwrightPage
}) {
  const results = {};
  let anySuccess = false;
  let sessionExpired = false;
  let authFailureCount = 0;
  const partner = readPartnerContext(registry, pipelineContext);
  const partnerTimer = Date.now();

  function isAuthFailure(result) {
    return result.status === 401
      || result.status === 403
      || result.message === '배민 로그인 만료';
  }

  for (const sourceDef of sourceDefs) {
    const menuTimer = Date.now();
    collectProgress.updateMenu({ menuId: sourceDef.id, menuLabel: sourceDef.label });
    if (sourceDef.dateQueryKeys?.length && menuDateRanges[sourceDef.id]?.skipped) {
      results[sourceDef.id] = {
        ok: true,
        skipped: true,
        sourceMenu: sourceDef.id,
        label: sourceDef.label,
        message: menuDateRanges[sourceDef.id].skipReason || '수집 생략',
        savedCount: 0
      };
      console.log(`[BREM][collect][timing] ${partner.partnerId} ${sourceDef.id} skip ${Date.now() - menuTimer}ms`);
      continue;
    }

    if (pipelineContext.playwrightPage && !pipelineContext.playwrightPage.isClosed?.()) {
      // 배달현황도 이전 협력사 캡처 재사용 금지 — 메뉴마다 파트너 API 재검증
      const { ensureMenuPartnerReady } = require('./baemin-center-context');
      let menuRange = sourceDef.dateQueryKeys?.length
        ? (menuDateRanges[sourceDef.id] || historyDateRange)
        : null;
      if (sourceDef.id === 'rider_history' && menuRange?.dates?.length) {
        menuRange = toSingleDayRange(menuRange.dates[0], menuRange);
      }
      if (pipelineContext.spaCapture?.[sourceDef.id]) {
        delete pipelineContext.spaCapture[sourceDef.id];
      }
      const storedCapture = pipelineContext.playwrightPage.context()?.__bremCapturedApiRequests;
      if (storedCapture?.[sourceDef.id]) {
        delete storedCapture[sourceDef.id];
      }
      const menuVerified = await ensureMenuPartnerReady(
        pipelineContext.playwrightPage,
        partner.partnerId,
        sourceDef.id,
        {
          dateRange: menuRange,
          historyDateRange: menuRange,
          baselineFingerprint: pipelineContext.lastPartnerMenuFingerprints?.[sourceDef.id] || '',
          partnerName: partner.partnerName,
          switchCaptured: pipelineContext.playwrightPage.context()?.__bremLastSwitchCaptured || []
        }
      );
      if (!menuVerified.ok) {
        results[sourceDef.id] = {
          ok: false,
          sourceMenu: sourceDef.id,
          label: sourceDef.label,
          message: `${sourceDef.label} API 검증 실패 (${menuVerified.reason || 'unknown'})`,
          sessionMismatch: true
        };
        console.log(`[BREM][collect][timing] ${partner.partnerId} ${sourceDef.id} fail ${Date.now() - menuTimer}ms rows=0`);
        continue;
      }
      if (menuVerified.captured) {
        applyCaptureToEndpointRegistry(sourceDef.id, registry, menuVerified.captured);
        pipelineContext.spaCapture = pipelineContext.spaCapture || {};
        pipelineContext.spaCapture[sourceDef.id] = menuVerified.captured;
      }
      console.log(`[BREM][collect] ${partner.partnerId} — ${sourceDef.label} API 세션 확인 완료`);
    } else if (pipelineContext.spaCapture?.[sourceDef.id]) {
      applyCaptureToEndpointRegistry(sourceDef.id, registry, pipelineContext.spaCapture[sourceDef.id]);
    }

    const result = await collectSource(sourceDef.id, cookie, collectDate, registry, {
      ...pipelineContext,
      menuDateRanges,
      historyDateRange
    });
    results[sourceDef.id] = {
      ...result,
      dateRangeLabel: menuDateRanges[sourceDef.id]?.label
        || (sourceDef.dateQueryKeys?.length ? menuDateRanges.daily_history.label : '오늘 기준')
    };

    if (sourceDef.id === 'delivery_status' && result.ok && result.rawItems?.length) {
      pipelineContext.partnerDataFingerprint = result.menuFingerprint
        || extractCollectItemsFingerprint('delivery_status', result.rawItems, partner.partnerId);
    }

    if (result.ok && result.menuFingerprint) {
      pipelineContext.currentPartnerMenuFingerprints = pipelineContext.currentPartnerMenuFingerprints || {};
      pipelineContext.currentPartnerMenuFingerprints[sourceDef.id] = result.menuFingerprint;
    }

    if (isPartnerSessionMismatchResult(result) && sourceDef.id === 'delivery_status') {
      console.warn(`[BREM][collect] ${partner.partnerId} — ${sourceDef.id} 세션 미반영, 일별/라이더는 개별 검증 후 수집`);
    }

    console.log(`[BREM][collect][timing] ${partner.partnerId} ${sourceDef.id} ${result.ok ? 'ok' : 'fail'} ${Date.now() - menuTimer}ms rows=${result.savedCount || 0}`);

    if (sourceDef.id === 'daily_history' && result.ok) {
      pipelineContext.dailyItems = result.rawItems || [];
      pipelineContext.dailySourceUrl = result.sourceUrl || '';
      const riderEp = mergeEndpointWithDefault('rider_history', registry.endpoints?.rider_history || {});
      const dailyEp = mergeEndpointWithDefault('daily_history', registry.endpoints?.daily_history || {});
      const riderHasOwnApi = isDistinctRiderHistoryEndpoint(riderEp, dailyEp);
      if (riderHasOwnApi && registry.endpoints?.rider_history?.fallbackFromDaily) {
        delete registry.endpoints.rider_history.fallbackFromDaily;
      }
      if (!riderHasOwnApi) {
        registry.endpoints.rider_history = {
          ...(registry.endpoints?.rider_history || {}),
          ...riderEp,
          fallbackFromDaily: true
        };
        console.log('[BREM][collect] rider_history → daily_history 집계 fallback 활성');
      } else {
        console.log(`[BREM][collect] rider_history 전용 API 사용: ${riderEp.apiPath}`);
      }
    }

    await saveCollectRun({
      collect_date: collectDate,
      collected_at: collectedAt,
      source_menu: sourceDef.id,
      source_url: result.sourceUrl || '',
      status: result.ok ? 'success' : 'failed',
      error_message: result.ok ? '' : String(result.message || result.error || '수집 실패'),
      row_count: Number(result.savedCount || 0),
      meta_json: {
        source,
        fallback: result.fallback || null,
        partnerId: partner.partnerId,
        partnerName: partner.partnerName
      }
    });

    if (result.ok) anySuccess = true;

    if (isAuthFailure(result)) {
      authFailureCount += 1;
      if (!playwrightContext) {
        sessionExpired = true;
        await getBaeminSession().markSessionError(result.message || '배민 로그인 만료');
        break;
      }
      console.warn(`[BREM][collect] ${sourceDef.id} auth failure — continue (playwright browser active)`);
      continue;
    }
  }

  if (playwrightContext && authFailureCount === sourceDefs.length && !anySuccess) {
    if (!playwrightPage) {
      sessionExpired = true;
      await getBaeminSession().markSessionError('배민 로그인 만료');
    } else {
      console.warn('[BREM][collect] all API calls failed but browser tab is active — session not marked expired');
    }
  }

  console.log(`[BREM][collect][timing] ${partner.partnerId} total ${Date.now() - partnerTimer}ms`);

  return { results, anySuccess, sessionExpired, authFailureCount, currentPartnerMenuFingerprints: pipelineContext.currentPartnerMenuFingerprints || {} };
}

async function runFullCollectPipeline(options = {}) {
  const collectDate = String(options.collectDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const { readRiderCollectRange } = require('./baemin-rider-collect-range');
  const { readDailyCollectRange } = require('./baemin-daily-collect-range');
  const riderCollectRange = options.riderCollectRange
    || await readRiderCollectRange(collectDate).catch(() => null);
  const dailyCollectRange = options.dailyCollectRange
    || await readDailyCollectRange(collectDate).catch(() => null);
  const menuDateRanges = options.menuDateRanges || buildBizMenuDateRanges(collectDate, new Date(), {
    dailyCollectRange,
    riderCollectRange
  });
  const historyDateRange = options.dateRange || menuDateRanges.daily_history || computeBizHistoryCollectRange(collectDate);
  const dateRange = historyDateRange;
  const source = String(options.source || 'local_scheduler').trim();
  const runId = options.runId || createCollectRunId();
  const playwrightContext = options.playwrightContext || null;
  const playwrightPage = options.playwrightPage || null;
  const results = {};
  const partnerSummaries = [];
  const collectedAt = new Date().toISOString();
  const allowedMenus = Array.isArray(options.sourceMenus) && options.sourceMenus.length
    ? new Set(options.sourceMenus.map(id => String(id).trim()).filter(Boolean))
    : null;
  const sourceDefs = allowedMenus
    ? listCollectSources().filter(def => allowedMenus.has(def.id))
    : listCollectSources();
  if (!sourceDefs.length) {
    return { ok: false, message: '수집할 메뉴가 없습니다.', results, sessionExpired: false };
  }
  const detachRef = { current: null };
  let detachCenterRoute = () => {
    if (typeof detachRef.current === 'function') detachRef.current();
  };

  const tableStatus = await getBizCollectTableStatus();
  if (!tableStatus.tableExists) {
    const message = 'public.baemin_biz_collect_items 테이블이 없습니다. supabase/baemin_all_migrations.sql 을 SQL Editor에서 실행하세요.';
    return { ok: false, message, results, sessionExpired: false };
  }

  const cookie = String(options.sessionCookie || '').trim()
    || await getBaeminSession().resolveStoredSessionCookie({});
  if (!cookie && !playwrightContext && !playwrightPage) {
    return {
      ok: false,
      message: '배민 세션 쿠키가 없습니다. [배민 세션 갱신]으로 로그인하세요.',
      results,
      sessionExpired: false
    };
  }

  if (playwrightPage && !playwrightPage.isClosed?.()) {
    const { readCenterSessionCookie } = require('./baemin-center-context');
    const centerSession = await readCenterSessionCookie(playwrightPage);
    if (!centerSession) {
      return {
        ok: false,
        message: 'CENTER_SESSION 쿠키가 없습니다. 배민 브라우저에서 협력사를 선택·로그인한 뒤 다시 시도하세요.',
        results,
        sessionExpired: false
      };
    }
  }

  const registry = sanitizeApiRegistry(await getApiRegistry());
  if (!registry.endpoints?.rider_history?.sampleUrl && registry.endpoints?.rider_history?.fallbackFromDaily) {
    delete registry.endpoints.rider_history.fallbackFromDaily;
  }

  const pipelineContext = {
    runId,
    playwrightContext,
    playwrightPage,
    collectDate,
    dateRange: historyDateRange,
    historyDateRange,
    menuDateRanges,
    deliveryStatusContext: menuDateRanges.delivery_status,
    weekStart: historyDateRange.weekStart,
    shrunkHistoryToDate: null,
    lastPartnerMenuFingerprints: {},
    currentPartnerMenuFingerprints: {}
  };
  let partnersToCollect = [];

  console.log(`[BREM][collect] 배달현황: 오늘 기준 (${collectDate})`);
  console.log(`[BREM][collect] 일별 배달내역: ${menuDateRanges.daily_history.label}`);
  console.log(`[BREM][collect] 라이더별 배달내역: ${menuDateRanges.rider_history.label}`);
  if (allowedMenus) {
    console.log(`[BREM][collect] 수집 메뉴: ${sourceDefs.map(def => def.id).join(', ')}`);
  }

  if (playwrightContext) {
    playwrightContext.__bremCollecting = true;
  }

  if (playwrightPage) {
    try {
      const { ensureSafeBrowserTab, preparePageForCollect, ensureProductionDeliveryPage } = require('./baemin-page-capture');
      const {
        resolveCenterContextViaPage,
        listPartnerCentersViaPage,
        selectPartnerCenter
      } = require('./baemin-center-context');
      await ensureSafeBrowserTab(playwrightPage);
      await ensureProductionDeliveryPage(playwrightPage).catch(error => {
        console.warn('[BREM][collect] 운영 도메인 전환 실패:', error.message);
      });
      partnersToCollect = await listPartnerCentersViaPage(playwrightPage).catch(error => {
        console.warn('[BREM][collect] 협력사 목록 조회 실패:', error.message);
        return [];
      });
      if (!partnersToCollect.length) {
        const center = await resolveCenterContextViaPage(playwrightPage);
        if (center?.partnerId || center?.centerId) {
          partnersToCollect = [{
            centerId: center.centerId,
            managementId: center.managementId,
            partnerId: center.partnerId || center.centerId,
            partnerName: center.partnerName || center.partnerId || center.centerId
          }];
        }
      }
    } catch (error) {
      console.warn('[BREM][collect] center context resolve failed:', error.message);
    }
  }

  try {
    let anySuccess = false;
    let sessionExpired = false;
    const partnerTotalEstimate = Math.max(partnersToCollect.length, 1);
    collectProgress.startCollect({
      collectDate,
      partnerTotal: partnerTotalEstimate,
      menuLabel: sourceDefs.map(def => def.label).join(', ')
    });

    async function runForPartner(partnerContext, partnerIndex = 0, partnerTotal = 0) {
      registry.centerContext = {
        centerId: partnerContext.centerId,
        managementId: partnerContext.managementId,
        partnerId: partnerContext.partnerId,
        partnerName: partnerContext.partnerName || partnerContext.partnerId,
        regionName: partnerContext.regionName || '',
        resolvedAt: new Date().toISOString()
      };
      pipelineContext.partnerName = registry.centerContext.partnerName;
      pipelineContext.regionName = registry.centerContext.regionName;
      pipelineContext.partnerCollectIndex = partnerIndex;
      pipelineContext.dailyItems = null;
      pipelineContext.dailySourceUrl = '';
      pipelineContext.currentPartnerMenuFingerprints = {};
      pipelineContext._fingerprintRetry = {};
      resetPartnerSpaCapture(pipelineContext, registry, playwrightPage);

      const label = partnerTotal > 0
        ? `[${partnerIndex + 1}/${partnerTotal}] ${registry.centerContext.partnerName}`
        : registry.centerContext.partnerName;
      if (partnerTotal > 0) {
        collectProgress.updatePartner({
          index: partnerIndex + 1,
          total: partnerTotal,
          partnerId: registry.centerContext.partnerId,
          partnerName: registry.centerContext.partnerName
        });
      }
      console.log(`[BREM][collect] ${label} (${registry.centerContext.partnerId}) — 현재 협력사 확인 완료`);

      if (playwrightPage && !playwrightPage.isClosed?.() && registry.centerContext.partnerId) {
        const { ensurePartnerSessionReady } = require('./baemin-center-context');
        const verified = await ensurePartnerSessionReady(
          playwrightPage,
          registry.centerContext.partnerId,
          {
            baselineFingerprint: pipelineContext.lastPartnerMenuFingerprints?.delivery_status || '',
            dateRange: historyDateRange,
            switchCaptured: playwrightPage.context()?.__bremLastSwitchCaptured || [],
            requireSessionChange: partnerIndex > 0
          }
        );
        if (!verified.ok) {
          const failMsg = `배달현황 API 검증 실패 (${verified.reason || 'unknown'})`;
          console.warn(`[BREM][collect] ${label} — ${failMsg}`);
          if (!allowedMenus || allowedMenus.has('delivery_status')) {
            return {
              results: {
                delivery_status: {
                  ok: false,
                  sourceMenu: 'delivery_status',
                  label: '배달현황',
                  message: failMsg,
                  sessionMismatch: true
                },
                daily_history: {
                  ok: false,
                  sourceMenu: 'daily_history',
                  label: '일별 배달내역',
                  message: '배달현황 검증 실패로 생략',
                  skipped: true
                },
                rider_history: {
                  ok: false,
                  sourceMenu: 'rider_history',
                  label: '라이더별 배달내역',
                  message: '배달현황 검증 실패로 생략',
                  skipped: true
                }
              },
              anySuccess: false,
              sessionExpired: false,
              authFailureCount: 0,
              currentPartnerMenuFingerprints: {}
            };
          }
          console.warn(`[BREM][collect] ${label} — history-only 수집 계속`);
        } else {
          if (verified.captured) {
            applyCaptureToEndpointRegistry('delivery_status', registry, verified.captured);
            pipelineContext.spaCapture = pipelineContext.spaCapture || {};
            pipelineContext.spaCapture.delivery_status = verified.captured;
          }
          const capturedStore = playwrightPage.context()?.__bremCapturedApiRequests || {};
          Object.keys(capturedStore).forEach(menuId => {
            applyCaptureToEndpointRegistry(menuId, registry, capturedStore[menuId]);
          });
          console.log(`[BREM][collect] ${label} — 배달현황 API 세션 확인 완료`);
        }
      }

      const collectLabel = sourceDefs.map(def => def.label).join(' · ') || '수집';
      console.log(`[BREM][collect] ${label} — ${collectLabel} 시작`);

      if (playwrightPage) {
        attachCollectCenterRoute(playwrightPage, registry, detachRef);
      }

      const loopResult = await runPartnerSourceCollectLoop({
        cookie,
        collectDate,
        registry,
        pipelineContext,
        menuDateRanges,
        historyDateRange,
        source,
        collectedAt,
        sourceDefs,
        playwrightContext,
        playwrightPage
      });

      Object.entries(loopResult.results).forEach(([menuId, row]) => {
        results[`${registry.centerContext.partnerId}:${menuId}`] = {
          ...row,
          partnerId: registry.centerContext.partnerId,
          partnerName: registry.centerContext.partnerName
        };
      });

      partnerSummaries.push({
        partnerId: registry.centerContext.partnerId,
        partnerName: registry.centerContext.partnerName,
        regionName: registry.centerContext.regionName,
        ok: loopResult.anySuccess,
        savedCount: Object.values(loopResult.results).reduce((sum, row) => sum + Number(row.savedCount || 0), 0),
        results: loopResult.results
      });

      console.log(`[BREM][collect] ${label} — ${loopResult.anySuccess ? '저장 완료' : '수집 실패'} (partner_id=${registry.centerContext.partnerId}, rows=${partnerSummaries[partnerSummaries.length - 1].savedCount})`);

      return loopResult;
    }

    if (playwrightPage && partnersToCollect.length > 0) {
      const {
        selectPartnerCenter,
        readActivePartnerDisplayFromPage,
        isValidPartnerId
      } = require('./baemin-center-context');
      partnersToCollect = partnersToCollect.filter(partner => isValidPartnerId(partner?.partnerId));

      const { readPartnerRegionMap, filterPartnersForCollect } = require('./baemin-partner-region');
      const regionMap = await readPartnerRegionMap().catch(() => ({}));
      const filtered = filterPartnersForCollect(partnersToCollect, regionMap);
      if (filtered.skipped.length) {
        const skippedNames = filtered.skipped.map(row => row.partnerName || row.partnerId).join(', ');
        console.log(`[BREM][collect] 지역 미등록 협력사 ${filtered.skipped.length}곳 수집 생략: ${skippedNames}`);
      }
      partnersToCollect = filtered.partners;

      const orderedPartners = partnersToCollect.slice();
      if (orderedPartners.length) {
        collectProgress.setPartnerTotal(orderedPartners.length);
      }
      const lastPartnerMenuFingerprints = {
        delivery_status: '',
        daily_history: '',
        rider_history: ''
      };

      console.log(`[BREM][collect] 협력사 ${orderedPartners.length}곳 순차 수집 (목록 순서): ${orderedPartners.map(p => p.partnerName || p.partnerId).join(' → ')}`);

      for (let index = 0; index < orderedPartners.length; index += 1) {
        const partner = orderedPartners[index];
        const progressLabel = `[${index + 1}/${orderedPartners.length}] ${partner.partnerName || partner.partnerId}`;
        try {
          if (typeof detachRef.current === 'function') {
            detachRef.current();
            detachRef.current = () => {};
          }

          console.log(`[BREM][collect] ${progressLabel} — 협력사 전환 시작 (${partner.partnerId})`);
          const active = await selectPartnerCenter(playwrightPage, {
            ...partner,
            requireSessionChange: index > 0
          });
          registry.centerContext = {
            centerId: active.centerId || partner.partnerId,
            managementId: active.managementId || partner.partnerId,
            partnerId: partner.partnerId,
            partnerName: partner.partnerName || active.partnerName || partner.partnerId,
            regionName: partner.regionName || active.regionName || '',
            resolvedAt: new Date().toISOString()
          };

          const uiNow = await readActivePartnerDisplayFromPage(playwrightPage);
          if (uiNow.partnerId && uiNow.partnerId !== partner.partnerId) {
            throw new Error(`협력사 UI 확인 실패 (요청 ${partner.partnerId}, 화면 ${uiNow.partnerId})`);
          }
          console.log(`[BREM][collect] ${progressLabel} — 협력사 전환 완료 · ${uiNow.partnerName || partner.partnerName} (${partner.partnerId})`);

          pipelineContext.partnerCollectIndex = index;
          pipelineContext.lastPartnerMenuFingerprints = { ...lastPartnerMenuFingerprints };

          const loopResult = await runForPartner({
            ...partner,
            ...active,
            partnerName: partner.partnerName || active.partnerName,
            regionName: partner.regionName || active.regionName
          }, index, orderedPartners.length);

          ['delivery_status', 'daily_history', 'rider_history'].forEach(menuId => {
            const row = loopResult.results[menuId];
            const fp = row?.menuFingerprint
              || (row?.ok
                ? extractCollectItemsFingerprint(menuId, row.rawItems || [], partner.partnerId)
                : '');
            if (row?.ok && fp) {
              lastPartnerMenuFingerprints[menuId] = fp;
            }
          });

          anySuccess = anySuccess || loopResult.anySuccess;
          sessionExpired = sessionExpired || loopResult.sessionExpired;
        } catch (error) {
          console.warn(`[BREM][collect] 협력사 수집 실패 (${partner.partnerName || partner.partnerId}):`, error.message);
          collectProgress.skipPartner({
            index: index + 1,
            total: orderedPartners.length,
            partnerId: partner.partnerId,
            partnerName: partner.partnerName || partner.partnerId,
            message: `협력사 ${index + 1}/${orderedPartners.length} · ${partner.partnerName || partner.partnerId} 실패`
          });
          partnerSummaries.push({
            partnerId: partner.partnerId,
            partnerName: partner.partnerName || partner.partnerId,
            ok: false,
            message: error.message,
            savedCount: 0
          });
        }
      }
    } else {
      const partner = partnersToCollect[0] || registry.centerContext || {};
      if (partner.partnerId || partner.centerId) {
        registry.centerContext = {
          centerId: partner.centerId,
          managementId: partner.managementId,
          partnerId: partner.partnerId || partner.centerId,
          partnerName: partner.partnerName || partner.partnerId || partner.centerId,
          resolvedAt: new Date().toISOString()
        };
      } else if (playwrightPage) {
        const { resolveCenterContextViaPage } = require('./baemin-center-context');
        const center = await resolveCenterContextViaPage(playwrightPage);
        if (center?.partnerId || center?.centerId) {
          registry.centerContext = {
            centerId: center.centerId,
            managementId: center.managementId,
            partnerId: center.partnerId || center.centerId,
            partnerName: center.partnerName || center.partnerId || center.centerId,
            resolvedAt: new Date().toISOString()
          };
        }
      }
      if (playwrightPage) attachCollectCenterRoute(playwrightPage, registry, detachRef);
      const loopResult = await runForPartner(registry.centerContext || {});
      anySuccess = loopResult.anySuccess;
      sessionExpired = loopResult.sessionExpired;
    }

    if (anySuccess && !sessionExpired) {
      await getBaeminSession().markSessionValidated();
    }

    let scrubResult = null;
    if (anySuccess && !sessionExpired && partnerSummaries.length > 1) {
      scrubResult = await scrubCrossPartnerDuplicates(collectDate).catch(error => {
        console.warn('[BREM][collect] 협력사 중복 정리 실패:', error.message);
        return null;
      });
      if (scrubResult?.deletedCount > 0) {
        console.log(`[BREM][collect] 협력사 중복 정리 완료 — ${scrubResult.deletedCount}건 삭제`);
      }
    }

    await saveApiRegistry(registry).catch(error => {
      console.warn('[BREM][collect] registry 저장 실패:', error.message);
    });

    const savedTotal = partnerSummaries.reduce((sum, row) => sum + Number(row.savedCount || 0), 0)
      || Object.values(results).reduce((sum, row) => sum + Number(row.savedCount || 0), 0);
    const summaryTotals = {
      dayCount: historyDateRange.dayCount,
      riderCount: 0,
      completeTotal: 0,
      rejectTotal: 0,
      cancelTotal: 0
    };
    Object.values(results).forEach(row => {
      if (!row.ok || !row.totals) return;
      summaryTotals.completeTotal += Number(row.totals.completeTotal || 0);
      summaryTotals.rejectTotal += Number(row.totals.rejectTotal || 0);
      summaryTotals.cancelTotal += Number(row.totals.cancelTotal || 0);
      summaryTotals.riderCount = Math.max(summaryTotals.riderCount, Number(row.totals.riderCount || 0));
    });

    const dailyLabel = menuDateRanges.daily_history?.label || `${historyDateRange.fromDate}~${historyDateRange.toDate}`;
    const riderLabel = menuDateRanges.rider_history?.label || dailyLabel;
    const rangeSummary = allowedMenus?.has('delivery_status') && sourceDefs.length === 1
      ? '배달현황: 오늘'
      : (allowedMenus
        ? sourceDefs.map(def => {
          if (def.id === 'delivery_status') return '배달현황: 오늘';
          if (def.id === 'daily_history') return `일별: ${dailyLabel}`;
          if (def.id === 'rider_history') return `라이더: ${riderLabel}`;
          return def.label;
        }).join(' · ')
        : `일별: ${dailyLabel} · 라이더: ${riderLabel}`);
    const finishMessage = sessionExpired
      ? '배민 재로그인 필요'
      : (anySuccess
        ? `수집 완료 — 협력사 ${partnerSummaries.length || 1}곳 · ${rangeSummary} · 저장 ${savedTotal}건${scrubResult?.deletedCount ? ` · 중복 정리 ${scrubResult.deletedCount}건` : ''}`
        : (playwrightPage ? 'API 수집 실패 (브라우저 로그인은 유지 중)' : '수집 실패'));
    collectProgress.finishCollect({
      ok: anySuccess && !sessionExpired,
      savedTotal,
      message: finishMessage
    });
    return {
      ok: anySuccess && !sessionExpired,
      collectDate,
      dateRange: historyDateRange,
      menuDateRanges,
      runId,
      savedTotal,
      summaryTotals,
      results,
      partnerSummaries,
      partnerCount: partnerSummaries.length || (registry.centerContext?.partnerId ? 1 : 0),
      sessionExpired,
      scrubResult,
      sourceMenus: allowedMenus ? [...allowedMenus] : null,
      message: finishMessage
    };
  } finally {
    detachCenterRoute();
    if (collectProgress.getCollectProgress().active) {
      collectProgress.clearProgress();
    }
    if (playwrightContext) {
      playwrightContext.__bremCollecting = false;
    }
    if (playwrightPage && !playwrightPage.isClosed()) {
      const { SAFE_LANDING_URL } = require('./baemin-page-capture');
      await playwrightPage.goto(SAFE_LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    }
  }
}

async function getLatestMenuCollectStatus(collectDate) {
  const supabase = getServiceClient();
  const menuDateRanges = buildBizMenuDateRanges(collectDate || new Date().toISOString().slice(0, 10));
  const menus = listCollectSources().map(source => ({
    id: source.id,
    label: source.label,
    dateRangeLabel: menuDateRanges[source.id]?.label || '-',
    lastCollectedAt: null,
    lastStatus: null,
    lastError: '',
    rowCount: 0,
    sourceUrl: '',
    collectDate: collectDate || null
  }));

  if (!supabase) return menus;

  let query = supabase
    .from('baemin_biz_collect_runs')
    .select('collect_date, collected_at, source_menu, source_url, status, error_message, row_count')
    .order('collected_at', { ascending: false })
    .limit(100);

  if (collectDate) {
    query = query.eq('collect_date', collectDate);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingBizCollectTableError(error)) return menus;
    return menus;
  }

  const latestByMenu = new Map();
  (data || []).forEach(row => {
    const key = row.source_menu;
    if (!latestByMenu.has(key)) latestByMenu.set(key, row);
  });

  return menus.map(menu => {
    const row = latestByMenu.get(menu.id);
    if (!row) return menu;
    return {
      ...menu,
      lastCollectedAt: row.collected_at,
      lastStatus: row.status,
      lastError: row.error_message || '',
      rowCount: Number(row.row_count || 0),
      sourceUrl: row.source_url || '',
      collectDate: row.collect_date
    };
  });
}

function isMissingAppliedTableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('baemin_delivery_applied')
    || (message.includes('relation') && message.includes('does not exist'));
}

async function readAppliedBaeminDelivery() {
  const raw = await readSettingsValue(BAEMIN_APPLIED_SETTINGS_KEY);
  if (!raw || typeof raw !== 'object') return null;
  const collectDate = String(raw.collectDate || '').slice(0, 10);
  const batchId = String(raw.batchId || '').trim();
  if (!batchId && !collectDate) return null;
  return {
    batchId,
    collectDate,
    appliedAt: raw.appliedAt || null,
    collectedAt: raw.collectedAt || null,
    savedCount: Number(raw.savedCount || 0),
    appliedBy: raw.appliedBy || ''
  };
}

const BIZ_COLLECT_PAGE_SIZE = 1000;
const BIZ_COLLECT_MENUS = ['delivery_status', 'daily_history', 'rider_history'];
const APPLIED_INSERT_CHUNK_SIZE = 300;

async function fetchBizCollectMenuRows(supabase, menu, selectFields) {
  const rows = [];
  let offset = 0;
  while (true) {
    // collected_at만 정렬하면 동일 시각 다건이 range에서 누락됨 → id 2차 정렬 필수
    const { data, error } = await supabase
      .from('baemin_biz_collect_items')
      .select(selectFields)
      .eq('source_menu', menu)
      .order('collected_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + BIZ_COLLECT_PAGE_SIZE - 1);

    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < BIZ_COLLECT_PAGE_SIZE) break;
    offset += BIZ_COLLECT_PAGE_SIZE;
  }
  return rows;
}

async function fetchAllBaeminBizCollectItems(selectFields) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const deduped = new Map();
  let totalFetched = 0;

  try {
    const menuRows = await Promise.all(
      BIZ_COLLECT_MENUS.map(menu => fetchBizCollectMenuRows(supabase, menu, selectFields))
    );
    menuRows.forEach((data, menuIndex) => {
      const menu = BIZ_COLLECT_MENUS[menuIndex];
      totalFetched += data.length;
      data.forEach(row => {
        const dedupeKey = String(row.dedupe_key || '').trim();
        if (!dedupeKey) return;
        const key = `${menu}|${dedupeKey}`;
        const prev = deduped.get(key);
        if (!prev || String(row.collected_at || '') >= String(prev.collected_at || '')) {
          deduped.set(key, row);
        }
      });
    });
  } catch (error) {
    if (isMissingBizCollectTableError(error)) {
      return { ok: false, tableMissing: true, message: 'baemin_biz_collect_items 테이블이 없습니다.' };
    }
    return { ok: false, error: error.message || '조회 실패' };
  }

  return { ok: true, rows: Array.from(deduped.values()), totalFetched };
}

async function fetchAppliedItemsPaged(tableName, filters = {}, selectFields) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  let offset = 0;
  const rows = [];
  while (true) {
    let query = supabase.from(tableName).select(selectFields);
    Object.entries(filters).forEach(([key, value]) => {
      if (key === 'like') {
        query = query.like(value.column, value.pattern);
      } else {
        query = query.eq(key, value);
      }
    });
    const { data, error } = await query.range(offset, offset + BIZ_COLLECT_PAGE_SIZE - 1);
    if (error) {
      return { ok: false, error: error.message || '조회 실패' };
    }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < BIZ_COLLECT_PAGE_SIZE) break;
    offset += BIZ_COLLECT_PAGE_SIZE;
  }

  return { ok: true, rows, totalFetched: rows.length };
}

/**
 * 콜수 동기화용: 적용 배치 전체를 읽지 않고 선택 배달일 하루키만 조회한다.
 * 기간합 키는 날짜별 콜수로 사용할 수 없으므로 compact 조회에서 제외한다.
 */
async function fetchAppliedRiderItemsByDays(batchId, fromDate, toDate, partnerId, selectFields) {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const dates = buildDateList(fromDate, toDate);
  const rows = [];
  let nextIndex = 0;
  const workerCount = Math.min(4, dates.length);

  async function loadDay(day) {
    let offset = 0;
    while (true) {
      const pattern = partnerId
        ? `${partnerId}:${day}:%`
        : `%:${day}:%`;
      const { data, error } = await supabase
        .from('baemin_delivery_applied_items')
        .select(selectFields)
        .eq('batch_id', batchId)
        .eq('source_menu', 'rider_history')
        .like('dedupe_key', pattern)
        .range(offset, offset + BIZ_COLLECT_PAGE_SIZE - 1);
      if (error) {
        throw new Error(error.message || `${day} 라이더 내역 조회 실패`);
      }
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < BIZ_COLLECT_PAGE_SIZE) break;
      offset += BIZ_COLLECT_PAGE_SIZE;
    }
  }

  async function worker() {
    while (nextIndex < dates.length) {
      const day = dates[nextIndex];
      nextIndex += 1;
      await loadDay(day);
    }
  }

  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } catch (error) {
    return { ok: false, error: error.message || '선택 기간 라이더 내역 조회 실패' };
  }

  const deduped = new Map();
  rows.forEach(row => {
    const key = String(row.id || row.dedupe_key || '');
    if (key) deduped.set(key, row);
  });
  return { ok: true, rows: [...deduped.values()], totalFetched: rows.length };
}

const APPLIED_DELETE_CHUNK_SIZE = 80;

async function deleteAppliedBatchItemsPaged(batchId) {
  const supabase = getServiceClient();
  if (!supabase || !batchId) return { ok: true, deleted: 0 };

  let deleted = 0;
  while (true) {
    const { data, error } = await supabase
      .from('baemin_delivery_applied_items')
      .select('id')
      .eq('batch_id', batchId)
      .limit(BIZ_COLLECT_PAGE_SIZE);
    if (error) return { ok: false, error: error.message || '이전 스냅샷 삭제 실패' };
    const ids = (data || []).map(row => row.id).filter(Boolean);
    if (!ids.length) break;
    for (let offset = 0; offset < ids.length; offset += APPLIED_DELETE_CHUNK_SIZE) {
      const chunk = ids.slice(offset, offset + APPLIED_DELETE_CHUNK_SIZE);
      const { error: deleteError } = await supabase
        .from('baemin_delivery_applied_items')
        .delete()
        .in('id', chunk);
      if (deleteError) return { ok: false, error: deleteError.message || '이전 스냅샷 삭제 실패' };
      deleted += chunk.length;
    }
    if (ids.length < BIZ_COLLECT_PAGE_SIZE) break;
  }
  return { ok: true, deleted };
}

function slimParsedJsonForApply(parsed = {}) {
  if (!parsed || typeof parsed !== 'object') return {};
  const next = { ...parsed };
  delete next.hourlyCompleted;
  return next;
}

async function countBizCollectByMenuMerged() {
  const fetched = await fetchAllBaeminBizCollectItems('collected_at, source_menu, dedupe_key');
  if (!fetched.ok) return fetched;

  const byMenu = {};
  (fetched.rows || []).forEach(row => {
    const menu = String(row.source_menu || 'unknown');
    byMenu[menu] = (byMenu[menu] || 0) + 1;
  });

  return {
    ok: true,
    byMenu,
    totalMerged: (fetched.rows || []).length,
    totalFetched: fetched.totalFetched || 0
  };
}

async function loadBizCollectRowsForApply(preferredDate = '') {
  const preferred = String(preferredDate || '').slice(0, 10);
  const selectFields = 'collect_date, collected_at, source_menu, source_url, dedupe_key, rider_name, rider_user_id, phone_number, parsed_json';
  const fetched = await fetchAllBaeminBizCollectItems(selectFields);
  if (!fetched.ok) return fetched;

  const allRows = normalizeCollectRowsPartnerIdentity(fetched.rows || []);

  // 배달현황: DP별 최신 collected_at 스냅샷만 (기사당 1행). 일별/라이더는 기간 데이터 유지.
  const latestDeliveryAtByPartner = new Map();
  allRows.forEach(row => {
    if (String(row.source_menu || '') !== 'delivery_status') return;
    const pid = partnerIdFromDedupeKey(row.dedupe_key);
    if (!pid) return;
    const at = String(row.collected_at || '');
    const prev = latestDeliveryAtByPartner.get(pid) || '';
    if (at && at > prev) latestDeliveryAtByPartner.set(pid, at);
  });

  const deliveryByPartnerRider = new Map();
  const historyRows = [];
  allRows.forEach(row => {
    const menu = String(row.source_menu || '');
    if (menu === 'delivery_status') {
      const pid = partnerIdFromDedupeKey(row.dedupe_key);
      if (!pid) return;
      const latestAt = latestDeliveryAtByPartner.get(pid) || '';
      const at = String(row.collected_at || '');
      // 최신 수집 웨이브만 (±2초) — 같은 지역에 찍힌 과거 날짜분 제외
      if (latestAt && at && Math.abs(new Date(at).getTime() - new Date(latestAt).getTime()) > 2000) {
        return;
      }
      const riderKey = String(row.rider_user_id || '').trim()
        || String(row.phone_number || '').trim()
        || String(row.dedupe_key || '');
      const mapKey = `${pid}|${riderKey}`;
      const prev = deliveryByPartnerRider.get(mapKey);
      if (!prev || at >= String(prev.collected_at || '')) {
        deliveryByPartnerRider.set(mapKey, row);
      }
      return;
    }
    historyRows.push(row);
  });

  const rows = [...deliveryByPartnerRider.values(), ...historyRows];
  const preferredCount = preferred
    ? rows.filter(row => String(row.collect_date || '').slice(0, 10) === preferred).length
    : 0;
  const byMenu = {};
  rows.forEach(row => {
    const menu = String(row.source_menu || 'unknown');
    byMenu[menu] = (byMenu[menu] || 0) + 1;
  });

  const effectiveCollectDate = preferred
    || rows.reduce((latest, row) => {
      const value = String(row.collect_date || '').slice(0, 10);
      return value > latest ? value : latest;
    }, '')
    || todayKST();

  return {
    ok: true,
    rows,
    effectiveCollectDate,
    mergedAllDates: false,
    preferredDate: preferred,
    preferredDateCount: preferredCount,
    byMenu,
    totalFetched: fetched.totalFetched || 0,
    deliveryPartners: latestDeliveryAtByPartner.size,
    deliveryLatestOnly: true
  };
}

async function countAppliedItemsByMenu(batchId) {
  const supabase = getServiceClient();
  const byMenu = { delivery_status: 0, daily_history: 0, rider_history: 0 };
  if (!supabase || !batchId) return byMenu;

  await Promise.all(Object.keys(byMenu).map(async menu => {
    const { count, error } = await supabase
      .from('baemin_delivery_applied_items')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .eq('source_menu', menu);
    byMenu[menu] = error ? -1 : Number(count || 0);
  }));
  return byMenu;
}

async function summarizeBizCollectDates(supabase) {
  const summary = {};
  if (!supabase) return summary;

  for (const menu of BIZ_COLLECT_MENUS) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('baemin_biz_collect_items')
        .select('collect_date')
        .eq('source_menu', menu)
        .range(offset, offset + BIZ_COLLECT_PAGE_SIZE - 1);
      if (error) return summary;
      if (!data?.length) break;

      data.forEach(row => {
        const date = String(row.collect_date || '').slice(0, 10);
        if (!date) return;
        if (!summary[date]) summary[date] = { total: 0, byMenu: {} };
        summary[date].total += 1;
        summary[date].byMenu[menu] = (summary[date].byMenu[menu] || 0) + 1;
      });

      if (data.length < BIZ_COLLECT_PAGE_SIZE) break;
      offset += BIZ_COLLECT_PAGE_SIZE;
    }
  }

  return summary;
}

async function getAppliedRiderBusinessRange(batchId) {
  const days = await summarizeRiderHistoryDaysFromApplied(batchId);
  if (!days.length) return { count: 0, from: null, to: null, days: [] };
  return {
    count: days.length,
    from: days[0].date,
    to: days[days.length - 1].date,
    days
  };
}

/** 라이더 하루키 기준 배달일별 건수 집계 */
function accumulateRiderDayCounts(rows, byDate) {
  (rows || []).forEach(row => {
    let date = '';
    if (isPerDayRiderDedupeKey(row.dedupe_key)) {
      date = businessDateFromDedupeKey(row.dedupe_key);
    } else {
      date = resolveRiderBusinessDate(row);
    }
    if (!date) return;
    const prev = byDate.get(date) || { date, rowCount: 0, status: 'ok' };
    prev.rowCount += 1;
    byDate.set(date, prev);
  });
}

async function summarizeRiderHistoryDaysFromBiz(supabase) {
  const byDate = new Map();
  if (!supabase) return [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('baemin_biz_collect_items')
      .select('dedupe_key, parsed_json')
      .eq('source_menu', 'rider_history')
      .range(offset, offset + BIZ_COLLECT_PAGE_SIZE - 1);
    if (error || !data?.length) break;
    accumulateRiderDayCounts(data, byDate);
    if (data.length < BIZ_COLLECT_PAGE_SIZE) break;
    offset += BIZ_COLLECT_PAGE_SIZE;
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function summarizeRiderHistoryDaysFromApplied(batchId) {
  const supabase = getServiceClient();
  const byDate = new Map();
  if (!supabase || !batchId) return [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('baemin_delivery_applied_items')
      .select('dedupe_key, parsed_json')
      .eq('batch_id', batchId)
      .eq('source_menu', 'rider_history')
      .range(offset, offset + BIZ_COLLECT_PAGE_SIZE - 1);
    if (error || !data?.length) break;
    accumulateRiderDayCounts(data, byDate);
    if (data.length < BIZ_COLLECT_PAGE_SIZE) break;
    offset += BIZ_COLLECT_PAGE_SIZE;
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

async function getBaeminStorageDiagnosticsForAdmin() {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const bizTableStatus = await getBizCollectTableStatus();
  const applied = await readAppliedBaeminDelivery();
  const [bizByCollectDate, bizCounts, appliedByMenu, riderRange, bizRiderDays] = await Promise.all([
    summarizeBizCollectDates(supabase),
    countBizCollectByMenuMerged(),
    countAppliedItemsByMenu(applied?.batchId || ''),
    getAppliedRiderBusinessRange(applied?.batchId || ''),
    summarizeRiderHistoryDaysFromBiz(supabase)
  ]);

  const bizByMenu = bizCounts.ok ? (bizCounts.byMenu || {}) : {};
  const bizTotal = Object.values(bizByMenu).reduce((sum, count) => sum + (Number(count) > 0 ? Number(count) : 0), 0);
  const appliedTotal = Object.values(appliedByMenu).reduce((sum, count) => sum + (Number(count) > 0 ? Number(count) : 0), 0);
  const appliedRiderDays = Array.isArray(riderRange?.days) ? riderRange.days : [];

  const issues = [];
  if (!bizTableStatus.tableExists) {
    issues.push({
      code: 'BIZ_TABLE_MISSING',
      message: 'baemin_biz_collect_items 테이블이 없습니다. supabase/baemin_all_migrations.sql 을 실행하세요.'
    });
  }
  if (!applied?.batchId) {
    issues.push({
      code: 'NOT_APPLIED',
      message: '배민 BIZ에서 [배민현황 저장]을 실행하지 않았습니다. 수집만으로는 배민현황에 표시되지 않습니다.'
    });
  } else if ((bizByMenu.rider_history || 0) > 0 && (appliedByMenu.rider_history || 0) === 0) {
    issues.push({
      code: 'RIDER_NOT_APPLIED',
      message: `BIZ 수집 라이더 ${bizByMenu.rider_history}건이 있으나 배민현황 저장에는 0건입니다. [배민현황 저장]을 다시 실행하세요.`
    });
  } else if ((bizByMenu.rider_history || 0) > (appliedByMenu.rider_history || 0)) {
    const bizRider = Number(bizByMenu.rider_history || 0);
    const appliedRider = Number(appliedByMenu.rider_history || 0);
    const ratio = bizRider > 0 ? Math.round((appliedRider / bizRider) * 100) : 0;
    issues.push({
      code: 'RIDER_APPLY_STALE',
      message: `BIZ 라이더 ${bizRider.toLocaleString('ko-KR')}건 · 저장 ${appliedRider.toLocaleString('ko-KR')}건 (${ratio}%) — [배민현황 저장]을 다시 실행하세요. 저장 건수가 수집보다 적으면 기간 합계가 BIZ와 맞지 않습니다.`
    });
  }

  return {
    ok: true,
    bizTableExists: bizTableStatus.tableExists === true,
    applied: applied || null,
    biz: {
      total: bizTotal,
      byMenu: bizByMenu,
      byCollectDate: bizByCollectDate,
      mergedTotal: bizCounts.totalMerged || 0,
      riderHistoryDays: bizRiderDays
    },
    appliedSnapshot: {
      total: appliedTotal,
      byMenu: appliedByMenu,
      riderBusinessRange: riderRange
        ? { count: riderRange.count, from: riderRange.from, to: riderRange.to }
        : null,
      riderHistoryDays: appliedRiderDays
    },
    riderHistoryDays: {
      biz: bizRiderDays,
      applied: appliedRiderDays
    },
    issues
  };
}

async function applyBaeminDelivery(collectDate, options = {}) {
  const preferredDate = String(collectDate || '').slice(0, 10);

  const loaded = await loadBizCollectRowsForApply(preferredDate);
  if (!loaded.ok) return loaded;

  const rows = loaded.rows || [];
  if (!rows.length) {
    const hintDate = preferredDate || todayKST();
    return {
      ok: false,
      status: 400,
      error: 'NO_COLLECT_DATA',
      message: `${hintDate} 포함 Supabase 수집 데이터가 없습니다. BIZ에서 라이더 수집 후 [배민현황 저장]을 실행하세요.`
    };
  }

  const date = loaded.effectiveCollectDate;
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const appliedAt = new Date().toISOString();
  const appliedBy = String(options.appliedBy || '').trim();
  const collectedAt = rows.reduce((latest, row) => {
    const value = String(row.collected_at || '').trim();
    if (!value) return latest;
    if (!latest || value > latest) return value;
    return latest;
  }, '');

  const { data: batchRow, error: batchError } = await supabase
    .from('baemin_delivery_applied_batches')
    .insert({
      collect_date: date,
      applied_at: appliedAt,
      applied_by: appliedBy,
      item_count: rows.length
    })
    .select('id')
    .single();

  if (batchError) {
    if (isMissingAppliedTableError(batchError)) {
      return {
        ok: false,
        tableMissing: true,
        message: 'baemin_delivery_applied_* 테이블이 없습니다. supabase/baemin_delivery_applied_migration.sql 을 실행하세요.'
      };
    }
    return { ok: false, error: batchError.message || '적용 배치 생성 실패' };
  }

  const batchId = batchRow.id;
  const mapped = rows.map(row => ({
    batch_id: batchId,
    collect_date: row.collect_date,
    collected_at: row.collected_at,
    source_menu: row.source_menu,
    source_url: row.source_url || '',
    dedupe_key: row.dedupe_key || '',
    rider_name: row.rider_name || '',
    rider_user_id: row.rider_user_id || '',
    phone_number: row.phone_number || '',
    parsed_json: slimParsedJsonForApply(row.parsed_json || {}),
    raw_json: {}
  }));

  const chunkSize = APPLIED_INSERT_CHUNK_SIZE;
  for (let i = 0; i < mapped.length; i += chunkSize) {
    const chunk = mapped.slice(i, i + chunkSize);
    const { error: insertError } = await supabase
      .from('baemin_delivery_applied_items')
      .insert(chunk);
    if (insertError) {
      await deleteAppliedBatchItemsPaged(batchId);
      await supabase.from('baemin_delivery_applied_batches').delete().eq('id', batchId);
      if (isMissingAppliedTableError(insertError)) {
        return {
          ok: false,
          tableMissing: true,
          message: 'baemin_delivery_applied_items 테이블이 없습니다. supabase/baemin_delivery_applied_migration.sql 을 실행하세요.'
        };
      }
      return { ok: false, error: insertError.message || '스냅샷 저장 실패' };
    }
  }

  const previous = await readAppliedBaeminDelivery();
  if (previous?.batchId && previous.batchId !== batchId) {
    const removed = await deleteAppliedBatchItemsPaged(previous.batchId);
    if (!removed.ok) {
      console.warn('[BREM][apply] previous batch item delete warn:', removed.error);
    }
    await supabase.from('baemin_delivery_applied_batches').delete().eq('id', previous.batchId);
  }

  const payload = {
    batchId,
    collectDate: date,
    appliedAt,
    collectedAt: collectedAt || null,
    savedCount: rows.length,
    appliedBy,
    byMenu: loaded.byMenu || {},
    mergedAllDates: loaded.mergedAllDates === true,
    preferredDate: loaded.preferredDate || '',
    preferredDateCount: loaded.preferredDateCount || 0
  };
  const saved = await writeSettingsValue(
    BAEMIN_APPLIED_SETTINGS_KEY,
    payload,
    '배민현황 Supabase 저장 스냅샷'
  );
  if (!saved.ok) return saved;

  return { ok: true, ...payload, itemCount: rows.length };
}

async function resolveAppliedBatchId(appliedOnly = false) {
  if (!appliedOnly) return '';
  if (appliedBatchCache.batchId && Date.now() - appliedBatchCache.at < SETTINGS_CACHE_MS) {
    return appliedBatchCache.batchId;
  }
  const applied = await readAppliedBaeminDelivery();
  const batchId = applied?.batchId || '';
  appliedBatchCache = { batchId, at: Date.now() };
  return batchId;
}

async function resolveBizCollectDateForAdmin(collectDate) {
  const requested = String(collectDate || '').slice(0, 10);
  const supabase = getServiceClient();
  if (!supabase) return requested || todayKST();

  if (requested) {
    const { count, error } = await supabase
      .from('baemin_biz_collect_items')
      .select('id', { count: 'exact', head: true })
      .eq('collect_date', requested);
    if (!error && Number(count || 0) > 0) return requested;
  }

  const { data, error } = await supabase
    .from('baemin_biz_collect_items')
    .select('collect_date')
    .order('collected_at', { ascending: false })
    .limit(1);
  if (!error && data?.[0]?.collect_date) {
    return String(data[0].collect_date).slice(0, 10);
  }

  return requested || todayKST();
}

async function resolveCollectDateForAdmin(collectDate, appliedOnly = false) {
  if (!appliedOnly) {
    return resolveBizCollectDateForAdmin(collectDate);
  }
  const applied = await readAppliedBaeminDelivery();
  return applied?.collectDate || '';
}

function partnerIdFromCollectRow(row) {
  const parsed = String(row?.parsed_json?.partnerId || row?.partner_id || '').trim();
  if (/^DP\d{6,}$/i.test(parsed)) return parsed;
  const prefix = String(row?.dedupe_key || '').split(':')[0];
  if (/^DP\d{6,}$/i.test(prefix)) return prefix;
  return '';
}

function riderSetFingerprint(rows = []) {
  const ids = rows
    .map(row => String(row?.rider_user_id || '').trim())
    .filter(Boolean)
    .sort();
  return ids.join(',');
}

function dailySetFingerprint(rows = []) {
  return rows
    .map(row => {
      const date = String(row?.parsed_json?.deliveryDate || row?.parsed_json?.businessDay || row?.collect_date || '').slice(0, 10);
      const complete = Number(row?.parsed_json?.totalComplete ?? row?.parsed_json?.completeCount ?? 0);
      return `${date}:${complete}`;
    })
    .filter(token => !token.startsWith(':'))
    .sort()
    .join('|');
}

function buildDuplicateGroupsFromPartnerFingerprints(partnerStats, fingerprintKey) {
  const fpToPartners = new Map();
  partnerStats.forEach(stat => {
    const fp = String(stat[fingerprintKey] || '').trim();
    const rowCount = fingerprintKey === 'dailyFingerprint'
      ? Number(stat.menuCounts?.daily_history || 0)
      : fingerprintKey === 'riderHistoryFingerprint'
        ? Number(stat.menuCounts?.rider_history || 0)
        : Number(stat.riderCount || 0);
    if (!fp || rowCount < 2) return;
    if (!fpToPartners.has(fp)) fpToPartners.set(fp, []);
    fpToPartners.get(fp).push({ ...stat, rowCount });
  });

  const duplicateGroups = [];
  fpToPartners.forEach((group) => {
    if (group.length < 2) return;
    const sorted = group.slice().sort((a, b) => {
      const ta = String(a.earliestCollectedAt || '');
      const tb = String(b.earliestCollectedAt || '');
      if (ta && tb) return ta.localeCompare(tb);
      return String(a.partnerId).localeCompare(String(b.partnerId));
    });
    duplicateGroups.push({
      riderCount: Number(sorted[0].riderCount || sorted[0].rowCount || 0),
      rowCount: Number(sorted[0].rowCount || 0),
      keepPartnerId: sorted[0].partnerId,
      keepPartnerName: sorted[0].partnerName,
      removePartnerIds: sorted.slice(1).map(row => row.partnerId),
      removePartnerNames: sorted.slice(1).map(row => row.partnerName)
    });
  });
  return duplicateGroups;
}

function mergeDuplicateGroups(groups = []) {
  const merged = new Map();
  groups.forEach(group => {
    const removeIds = [...(group.removePartnerIds || [])].sort().join(',');
    const key = `${group.keepPartnerId}|${removeIds}`;
    if (!merged.has(key)) {
      merged.set(key, { ...group, menus: group.menus || [] });
      return;
    }
    const prev = merged.get(key);
    prev.menus = Array.from(new Set([...(prev.menus || []), ...(group.menus || [])]));
    prev.riderCount = Math.max(Number(prev.riderCount || 0), Number(group.riderCount || 0));
    prev.rowCount = Math.max(Number(prev.rowCount || 0), Number(group.rowCount || 0));
  });
  return Array.from(merged.values());
}

async function analyzePartnerContamination(collectDate, options = {}) {
  const supabase = getServiceClient();
  const appliedOnly = Boolean(options.appliedOnly);
  const date = await resolveCollectDateForAdmin(collectDate, appliedOnly);

  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  if (!date) {
    return { ok: true, collectDate: '', duplicateGroups: [], needsScrub: false, partnerStats: [] };
  }

  const tableName = appliedOnly ? 'baemin_delivery_applied_items' : 'baemin_biz_collect_items';
  let query = supabase
    .from(tableName)
    .select('id, partner_id, parsed_json, dedupe_key, rider_user_id, collected_at, source_menu, collect_date')
    .in('source_menu', ['delivery_status', 'daily_history', 'rider_history'])
    .limit(5000);

  if (appliedOnly) {
    const batchId = await resolveAppliedBatchId(true);
    if (!batchId) {
      return { ok: true, collectDate: '', duplicateGroups: [], needsScrub: false, partnerStats: [] };
    }
    query = query.eq('batch_id', batchId);
  } else {
    query = query.eq('collect_date', date);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingBizCollectTableError(error) || isMissingAppliedTableError(error)) {
      return { ok: false, tableMissing: true, message: `${tableName} 테이블이 없습니다.` };
    }
    return { ok: false, error: error.message || '중복 분석 실패' };
  }

  const byPartnerMenu = new Map();
  (data || []).forEach(row => {
    const partnerId = partnerIdFromCollectRow(row);
    const menu = String(row.source_menu || '').trim();
    if (!partnerId || !menu) return;
    const key = `${partnerId}|${menu}`;
    if (!byPartnerMenu.has(key)) byPartnerMenu.set(key, []);
    byPartnerMenu.get(key).push(row);
  });

  const partnerMeta = new Map();
  byPartnerMenu.forEach((rows, key) => {
    const [partnerId, menu] = key.split('|');
    if (!partnerMeta.has(partnerId)) {
      partnerMeta.set(partnerId, {
        partnerId,
        partnerName: String(rows[0]?.parsed_json?.partnerName || '').trim() || partnerId,
        earliestCollectedAt: '',
        menuCounts: { delivery_status: 0, daily_history: 0, rider_history: 0 },
        riderCount: 0,
        rowCount: 0,
        riderFingerprint: '',
        dailyFingerprint: '',
        riderHistoryFingerprint: ''
      });
    }
    const meta = partnerMeta.get(partnerId);
    meta.menuCounts[menu] = rows.length;
    meta.rowCount += rows.length;
    const earliest = rows.reduce((min, row) => {
      const at = String(row.collected_at || '');
      return !min || (at && at < min) ? at : min;
    }, meta.earliestCollectedAt || '');
    meta.earliestCollectedAt = earliest;
    if (menu === 'delivery_status') {
      meta.riderCount = rows.length;
      meta.riderFingerprint = riderSetFingerprint(rows);
    } else if (menu === 'daily_history') {
      meta.dailyFingerprint = dailySetFingerprint(rows);
    } else if (menu === 'rider_history') {
      meta.riderHistoryFingerprint = riderSetFingerprint(rows);
    }
  });

  const partnerStats = Array.from(partnerMeta.values()).map(stat => {
    const hasDelivery = Number(stat.menuCounts.delivery_status || 0) > 0;
    const hasDaily = Number(stat.menuCounts.daily_history || 0) > 0;
    const hasRider = Number(stat.menuCounts.rider_history || 0) > 0;
    const partialMenus = [hasDelivery, hasDaily, hasRider].filter(Boolean).length;
    return {
      ...stat,
      inconsistent: partialMenus > 0 && partialMenus < 3
    };
  });

  const duplicateGroups = mergeDuplicateGroups([
    ...buildDuplicateGroupsFromPartnerFingerprints(
      partnerStats.filter(stat => stat.riderFingerprint),
      'riderFingerprint'
    ).map(group => ({ ...group, menus: ['delivery_status'] })),
    ...buildDuplicateGroupsFromPartnerFingerprints(
      partnerStats.filter(stat => stat.dailyFingerprint),
      'dailyFingerprint'
    ).map(group => ({ ...group, menus: ['daily_history'] })),
    ...buildDuplicateGroupsFromPartnerFingerprints(
      partnerStats.filter(stat => stat.riderHistoryFingerprint),
      'riderHistoryFingerprint'
    ).map(group => ({ ...group, menus: ['rider_history'] }))
  ]);

  const needsScrub = duplicateGroups.length > 0
    || partnerStats.some(stat => stat.inconsistent);

  return {
    ok: true,
    collectDate: date,
    duplicateGroups,
    needsScrub,
    partnerStats,
    appliedOnly
  };
}

async function deleteCollectRowsByPartner(collectDate, partnerId, options = {}) {
  const supabase = getServiceClient();
  const appliedOnly = Boolean(options.appliedOnly);
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const tableName = appliedOnly ? 'baemin_delivery_applied_items' : 'baemin_biz_collect_items';
  let query = supabase
    .from(tableName)
    .select('id, dedupe_key')
    .like('dedupe_key', `${partnerId}:%`)
    .limit(5000);

  if (appliedOnly) {
    const batchId = await resolveAppliedBatchId(true);
    if (!batchId) return { ok: true, deletedCount: 0 };
    query = query.eq('batch_id', batchId);
  } else {
    query = query.eq('collect_date', collectDate);
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: error.message || '삭제 대상 조회 실패' };
  }

  const ids = (data || []).map(row => row.id).filter(Boolean);
  if (!ids.length) return { ok: true, deletedCount: 0 };

  let deletedCount = 0;
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error: deleteError } = await supabase.from(tableName).delete().in('id', chunk);
    if (deleteError) {
      return { ok: false, error: deleteError.message || '삭제 실패', deletedCount };
    }
    deletedCount += chunk.length;
  }

  return { ok: true, deletedCount };
}

async function scrubCrossPartnerDuplicates(collectDate, options = {}) {
  const analysis = await analyzePartnerContamination(collectDate, options);
  if (!analysis.ok) return analysis;
  if (!analysis.needsScrub) {
    return {
      ...analysis,
      deletedCount: 0,
      removedPartners: [],
      message: '협력사 간 중복 데이터가 없습니다.'
    };
  }

  const removePartnerIds = new Set();
  analysis.duplicateGroups.forEach(group => {
    group.removePartnerIds.forEach(partnerId => removePartnerIds.add(partnerId));
  });

  let deletedCount = 0;
  const removedPartners = [];
  for (const partnerId of removePartnerIds) {
    const result = await deleteCollectRowsByPartner(analysis.collectDate, partnerId, options);
    if (!result.ok) return result;
    deletedCount += Number(result.deletedCount || 0);
    removedPartners.push(partnerId);
  }

  console.log(`[BREM][scrub] collect_date=${analysis.collectDate} removed_partners=${removedPartners.join(',')} deleted=${deletedCount}`);

  return {
    ok: true,
    collectDate: analysis.collectDate,
    duplicateGroups: analysis.duplicateGroups,
    deletedCount,
    removedPartners,
    message: `협력사 중복 ${removedPartners.length}곳 정리 — ${deletedCount}건 삭제`
  };
}

async function purgeBizCollectDate(collectDate, options = {}) {
  const supabase = getServiceClient();
  const date = String(collectDate || '').slice(0, 10);
  const partnerId = String(options.partnerId || '').trim();
  const appliedOnly = Boolean(options.appliedOnly);

  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  if (!date) {
    return { ok: false, status: 400, error: 'collectDate 가 필요합니다.' };
  }

  const tableName = appliedOnly ? 'baemin_delivery_applied_items' : 'baemin_biz_collect_items';
  let query = supabase.from(tableName).select('id, dedupe_key').limit(5000);

  if (appliedOnly) {
    const batchId = await resolveAppliedBatchId(true);
    if (!batchId) return { ok: true, deletedCount: 0, collectDate: date };
    query = query.eq('batch_id', batchId);
  } else {
    query = query.eq('collect_date', date);
  }

  if (partnerId) {
    query = query.like('dedupe_key', `${partnerId}:%`);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingBizCollectTableError(error) || isMissingAppliedTableError(error)) {
      return { ok: false, tableMissing: true, message: `${tableName} 테이블이 없습니다.` };
    }
    return { ok: false, error: error.message || '삭제 대상 조회 실패' };
  }

  const ids = (data || []).map(row => row.id).filter(Boolean);
  if (!ids.length) {
    return {
      ok: true,
      collectDate: date,
      partnerId: partnerId || null,
      deletedCount: 0,
      message: '삭제할 데이터가 없습니다.'
    };
  }

  let deletedCount = 0;
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { error: deleteError } = await supabase.from(tableName).delete().in('id', chunk);
    if (deleteError) {
      return { ok: false, error: deleteError.message || '삭제 실패', deletedCount };
    }
    deletedCount += chunk.length;
  }

  console.log(`[BREM][purge] collect_date=${date} partner=${partnerId || 'all'} deleted=${deletedCount}`);

  return {
    ok: true,
    collectDate: date,
    partnerId: partnerId || null,
    deletedCount,
    message: partnerId
      ? `${date} · ${partnerId} 데이터 ${deletedCount}건 삭제`
      : `${date} 수집 데이터 ${deletedCount}건 전체 삭제`
  };
}

function partnerIdFromDedupeKey(dedupeKey = '') {
  const prefix = String(dedupeKey || '').split(':')[0].trim();
  return /^DP\d{6,}$/i.test(prefix) ? prefix.toUpperCase() : '';
}

/** 지역 소유권은 dedupe_key 만 사용. parsed_json.partnerId 폴백 금지(섞임 원인). */
function rowBelongsToPartner(row, partnerId) {
  const want = String(partnerId || '').trim().toUpperCase();
  if (!want || !/^DP\d{6,}$/.test(want)) return false;
  const fromKey = partnerIdFromDedupeKey(row?.dedupe_key);
  return Boolean(fromKey) && fromKey === want;
}

function businessDateFromDedupeKey(dedupeKey = '') {
  const parts = String(dedupeKey || '').split(':');
  const candidate = String(parts[1] || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : '';
}

function isPerDayRiderDedupeKey(dedupeKey = '') {
  const parts = String(dedupeKey || '').split(':');
  return parts.length >= 4
    && parts[parts.length - 1] === 'rider'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(parts[1] || '').slice(0, 10));
}

function riderPeriodFromDedupeKey(dedupeKey = '') {
  const parts = String(dedupeKey || '').split(':');
  const fromDate = String(parts[1] || '').slice(0, 10);
  const toDate = String(parts[2] || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return null;
  }
  return { fromDate, toDate };
}

function riderRowOverlapsRange(row = {}, fromDate = '', toDate = '') {
  if (!fromDate || !toDate || toDate < fromDate) return false;
  // 하루키(DP:배달일:riderId:rider)만 배달일로 판정 — collect_date 폴백 금지(중복 합산 원인)
  if (isPerDayRiderDedupeKey(row.dedupe_key)) {
    const day = businessDateFromDedupeKey(row.dedupe_key);
    return Boolean(day && day >= fromDate && day <= toDate);
  }
  // 기간합산 키(DP:from:to:riderId) — 하루키가 없을 때만 쓰도록 상위에서 필터
  const period = riderPeriodFromDedupeKey(row.dedupe_key);
  if (period) return period.toDate >= fromDate && period.fromDate <= toDate;
  const businessDate = resolveRiderBusinessDate(row);
  return Boolean(businessDate && businessDate >= fromDate && businessDate <= toDate);
}

function resolveRiderBusinessDate(row = {}) {
  const parsed = row.parsed_json || {};
  const fromDedupe = businessDateFromDedupeKey(row.dedupe_key);
  if (isPerDayRiderDedupeKey(row.dedupe_key) && fromDedupe) {
    return fromDedupe;
  }
  // 기간합산 키는 단일 배달일이 없음 — fromParsed(수집일 오염) 사용 금지
  if (riderPeriodFromDedupeKey(row.dedupe_key)) {
    return '';
  }
  const fromParsed = String(parsed.businessDate || parsed.deliveryDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromParsed)) return fromParsed;
  return fromDedupe || '';
}

/**
 * 하루키와 기간키가 섞일 때 — 라이더별로 판정.
 * 콜수는 날짜별 입력이므로, 하루키가 있으면 무조건 하루키만 사용한다.
 * (기간합으로 바꾸면 시작일에 몰아넣고 일별 콜수가 깨짐)
 * 전역 필터 금지: 다른 라이더의 기간합까지 통째로 버리는 원인이었음.
 */
function preferPerDayRiderHistoryRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const groups = new Map();
  list.forEach(row => {
    const id = riderIdentityKey(row)
      || [row.rider_user_id, row.rider_name, row.phone_number].filter(Boolean).join('|')
      || String(row.dedupe_key || '');
    if (!id) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  });

  const out = [];
  groups.forEach(riderRows => {
    const perDay = riderRows.filter(row => isPerDayRiderDedupeKey(row?.dedupe_key));
    const period = riderRows.filter(row => riderPeriodFromDedupeKey(row?.dedupe_key));
    const other = riderRows.filter(row => (
      !isPerDayRiderDedupeKey(row?.dedupe_key) && !riderPeriodFromDedupeKey(row?.dedupe_key)
    ));

    if (perDay.length) {
      out.push(...perDay, ...other);
      return;
    }
    out.push(...period, ...other);
  });

  return out;
}

/** 하루키 행의 businessDate를 dedupe 배달일로 맞춰 클라이언트 날짜 오염 방지 */
function normalizePerDayRiderBusinessDates(rows = []) {
  return (rows || []).map(row => {
    if (!isPerDayRiderDedupeKey(row?.dedupe_key)) return row;
    const day = businessDateFromDedupeKey(row.dedupe_key);
    if (!day) return row;
    const parsed = { ...(row.parsed_json || {}) };
    if (parsed.businessDate === day && parsed.deliveryDate === day) return row;
    parsed.businessDate = day;
    parsed.deliveryDate = day;
    return { ...row, parsed_json: parsed };
  });
}

function normalizeDpPartnerId(value, dedupeKey = '') {
  const raw = String(value || '').trim().toUpperCase();
  if (/^DP\d{6,}$/.test(raw)) return raw;
  const fromKey = partnerIdFromDedupeKey(dedupeKey);
  if (fromKey) return fromKey;
  const match = raw.match(/(DP\d{6,})/);
  return match ? match[1].toUpperCase() : '';
}

function normalizeCollectRowPartnerIdentity(row) {
  if (!row || typeof row !== 'object') return row;
  const dedupeKey = String(row.dedupe_key || '');
  const parsed = { ...(row.parsed_json || {}) };
  // 소유권은 dedupe_key 우선. parsed.partnerId 로 키를 덮어쓰지 않음(지역 섞임 원인).
  const pid = partnerIdFromDedupeKey(dedupeKey)
    || normalizeDpPartnerId(parsed.partnerId || row.partner_id, dedupeKey);
  if (!pid) return row;

  parsed.partnerId = pid;
  row.partner_id = pid;
  row.parsed_json = parsed;
  return row;
}

function normalizeCollectRowsPartnerIdentity(rows = []) {
  return (rows || []).map(normalizeCollectRowPartnerIdentity);
}

async function loadPartnerDisplayCatalog() {
  const supabase = getServiceClient();
  if (!supabase) return new Map();

  const { inferRegionFromPartnerName } = require('./baemin-partner-region');
  const catalog = new Map();

  function ingest(row) {
    const parsed = row.parsed_json || {};
    const pid = String(parsed.partnerId || '').trim() || partnerIdFromDedupeKey(row.dedupe_key);
    if (!/^DP\d{6,}$/i.test(pid)) return;
    const partnerName = String(parsed.partnerName || '').trim();
    const regionName = String(parsed.regionName || '').trim() || inferRegionFromPartnerName(partnerName);
    const displayName = regionName || pid;
    const prev = catalog.get(pid);
    if (!prev || String(row.collected_at || '') >= String(prev.collectedAt || '')) {
      catalog.set(pid, {
        partnerId: pid,
        partnerName,
        regionName,
        displayName,
        collectedAt: row.collected_at
      });
    }
  }

  const batchId = await resolveAppliedBatchId(true);
  if (batchId) {
    const { data } = await supabase
      .from('baemin_delivery_applied_items')
      .select('dedupe_key, parsed_json, collected_at')
      .eq('batch_id', batchId)
      .limit(5000);
    (data || []).forEach(ingest);
  }

  const { data: bizRows } = await supabase
    .from('baemin_biz_collect_items')
    .select('dedupe_key, parsed_json, collected_at')
    .order('collected_at', { ascending: false })
    .limit(5000);
  (bizRows || []).forEach(row => {
    const pid = String(row.parsed_json?.partnerId || '').trim() || partnerIdFromDedupeKey(row.dedupe_key);
    if (pid && !catalog.has(pid)) ingest(row);
  });

  return catalog;
}

function enrichPartnerEntry(catalog, partnerId, fallbackName = '', regionMap = null) {
  const pid = String(partnerId || '').trim();
  const hit = catalog?.get?.(pid);
  const { resolvePartnerDisplay } = require('./baemin-partner-region');
  if (hit) {
    const resolved = resolvePartnerDisplay(pid, hit.partnerName || fallbackName, hit.regionName, regionMap);
    return {
      ...hit,
      partnerId: pid,
      regionName: resolved.regionName,
      displayName: resolved.displayName
    };
  }
  return resolvePartnerDisplay(pid, fallbackName, '', regionMap);
}

function dedupeStatsRowsByLatest(rows, menu) {
  const byKey = new Map();
  (rows || []).forEach(row => {
    const pid = partnerIdFromDedupeKey(row.dedupe_key);
    let key = '';
    if (menu === 'daily_history') {
      key = `${pid}:${row.delivery_date}`;
    } else {
      key = `${pid}:${row.rider_user_id || row.rider_name || row.dedupe_key}`;
    }
    const prev = byKey.get(key);
    if (!prev || String(row.collected_at || '') >= String(prev.collected_at || '')) {
      byKey.set(key, row);
    }
  });
  return Array.from(byKey.values());
}

function mapDailyStatsRowToAdminItem(row, partnerId = '', catalog = null, regionMap = null) {
  const pid = partnerId || partnerIdFromDedupeKey(row.dedupe_key);
  const raw = row.raw_json || {};
  const partnerInfo = enrichPartnerEntry(catalog, pid, '', regionMap);
  const breakdown = serviceBreakdownFromStats(raw);
  return {
    collect_date: row.delivery_date,
    collected_at: row.collected_at,
    rider_name: '',
    rider_user_id: '',
    phone_number: '',
    parsed_json: {
      partnerId: pid,
      partnerName: partnerInfo.partnerName,
      regionName: partnerInfo.regionName,
      displayName: partnerInfo.displayName,
      deliveryDate: row.delivery_date,
      totalComplete: row.complete_total,
      morningCount: row.complete_morning,
      afternoonCount: row.complete_afternoon,
      eveningCount: row.complete_evening,
      midnightCount: row.complete_midnight,
      ...breakdown
    },
    dedupe_key: row.dedupe_key
  };
}

function mapRiderStatsRowToAdminItem(row, partnerId = '', catalog = null, regionMap = null) {
  const pid = partnerId || partnerIdFromDedupeKey(row.dedupe_key);
  const raw = row.raw_json || {};
  const partnerInfo = enrichPartnerEntry(catalog, pid, '', regionMap);
  const breakdown = serviceBreakdownFromStats(raw);
  return {
    collect_date: row.week_start,
    collected_at: row.collected_at,
    rider_name: row.rider_name,
    rider_user_id: row.rider_user_id,
    phone_number: row.phone_number,
    parsed_json: {
      partnerId: pid,
      partnerName: partnerInfo.partnerName,
      regionName: partnerInfo.regionName,
      displayName: partnerInfo.displayName,
      totalComplete: row.complete_total,
      morningCount: row.complete_morning,
      afternoonCount: row.complete_afternoon,
      eveningCount: row.complete_evening,
      midnightCount: row.complete_midnight,
      ...breakdown
    },
    raw_json: { deliveryCount: row.complete_total },
    dedupe_key: row.dedupe_key
  };
}

async function getHistoryStatsItemsForAdmin(weekStart, sourceMenu, partnerId = '') {
  const supabase = getServiceClient();
  const menu = String(sourceMenu || '').trim();
  const week = String(weekStart || '').slice(0, 10);
  const pid = String(partnerId || '').trim();

  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return { ok: false, status: 400, error: 'weekStart 가 필요합니다.' };
  }
  if (menu !== 'daily_history' && menu !== 'rider_history') {
    return { ok: false, status: 400, error: '지원하지 않는 메뉴입니다.' };
  }

  const { settlementWeekEnd } = require('./baemin-settlement-week');
  const tableName = menu === 'daily_history' ? 'baemin_daily_delivery_stats' : 'baemin_rider_delivery_stats';
  let query = supabase
    .from(tableName)
    .select('*')
    .eq('week_start', week)
    .order(menu === 'daily_history' ? 'delivery_date' : 'rider_name', { ascending: true })
    .limit(pid ? 2000 : 5000);
  if (pid) {
    query = query.like('dedupe_key', `${pid.toUpperCase()}:%`);
  }

  const { data, error } = await query;
  if (error) {
    return { ok: false, error: error.message || '조회 실패' };
  }

  let rows = data || [];
  rows = dedupeStatsRowsByLatest(rows, menu);
  rows.sort((a, b) => {
    if (menu === 'daily_history') {
      return String(a.delivery_date || '').localeCompare(String(b.delivery_date || ''));
    }
    return String(a.rider_name || '').localeCompare(String(b.rider_name || ''), 'ko');
  });

  const catalog = await loadPartnerDisplayCatalog();
  const { readPartnerRegionMap } = require('./baemin-partner-region');
  const regionMap = await readPartnerRegionMap();
  const mapper = menu === 'daily_history' ? mapDailyStatsRowToAdminItem : mapRiderStatsRowToAdminItem;
  const items = rows.map(row => mapper(row, pid, catalog, regionMap));

  return {
    ok: true,
    collectDate: week,
    weekStart: week,
    weekEnd: settlementWeekEnd(week),
    sourceMenu: menu,
    partnerId: pid || null,
    items,
    count: items.length,
    appliedOnly: true,
    dataSource: 'stats',
    totals: computeItemsMetricTotals(items)
  };
}

async function getPartnerListFromStatsTable(weekStart, sourceMenu) {
  const supabase = getServiceClient();
  const week = String(weekStart || '').slice(0, 10);
  const menu = String(sourceMenu || '').trim();
  const tableName = menu === 'daily_history' ? 'baemin_daily_delivery_stats' : 'baemin_rider_delivery_stats';

  if (!supabase || !week) {
    return { ok: false, partners: [] };
  }

  const { data, error } = await supabase
    .from(tableName)
    .select('dedupe_key')
    .eq('week_start', week)
    .limit(5000);

  if (error) {
    return { ok: false, partners: [], error: error.message };
  }

  const { sortPartnersForAdmin } = require('./baemin-partner-match');
  const catalog = await loadPartnerDisplayCatalog();
  const { readPartnerRegionMap } = require('./baemin-partner-region');
  const regionMap = await readPartnerRegionMap();
  const partners = new Map();
  const counts = new Map();

  (data || []).forEach(row => {
    const partnerId = partnerIdFromDedupeKey(row.dedupe_key);
    if (!partnerId) return;
    const info = enrichPartnerEntry(catalog, partnerId, '', regionMap);
    partners.set(partnerId, info.displayName);
    counts.set(partnerId, (counts.get(partnerId) || 0) + 1);
  });

  const items = sortPartnersForAdmin(
    Array.from(partners.entries()).map(([partnerId]) => {
      const info = enrichPartnerEntry(catalog, partnerId, '', regionMap);
      return {
        partnerId,
        partnerName: info.partnerName,
        regionName: info.regionName,
        displayName: info.displayName,
        riderCount: counts.get(partnerId) || 0,
        menuCounts: {
          delivery_status: 0,
          daily_history: menu === 'daily_history' ? (counts.get(partnerId) || 0) : 0,
          rider_history: menu === 'rider_history' ? (counts.get(partnerId) || 0) : 0
        }
      };
    }),
    { byDisplayName: true }
  );

  return { ok: true, partners: items };
}

async function getPartnerListForAdmin(collectDate, options = {}) {
  const supabase = getServiceClient();
  const appliedOnly = Boolean(options.appliedOnly);
  const date = await resolveCollectDateForAdmin(collectDate, appliedOnly);
  const weekStart = String(options.weekStart || '').slice(0, 10);
  const sourceMenu = String(options.sourceMenu || '').trim();

  if (appliedOnly) {
    const batchId = await resolveAppliedBatchId(true);
    const applied = await readAppliedBaeminDelivery();
    if (!batchId && !applied?.batchId) {
      return { ok: true, collectDate: '', partners: [], count: 0, appliedOnly: true, notApplied: true };
    }

    const { readPartnerRegionMap } = require('./baemin-partner-region');
    const { filterPartnersByScope } = require('./baemin-admin-access');
    const regionMap = await readPartnerRegionMap();
    const scope = options.actorScope || { allowedPartnerIds: Object.keys(regionMap) };
    const catalog = await loadPartnerDisplayCatalog();
    const { sortPartnersForAdmin } = require('./baemin-partner-match');

    const registeredIds = scope.allowedPartnerIds.length
      ? scope.allowedPartnerIds
      : Object.keys(regionMap);

    const partners = sortPartnersForAdmin(
      registeredIds.map(partnerId => {
        const info = enrichPartnerEntry(catalog, partnerId, '', regionMap);
        return {
          partnerId,
          partnerName: info.partnerName,
          regionName: info.regionName,
          displayName: info.displayName || regionMap[partnerId] || partnerId,
          riderCount: 0,
          menuCounts: {
            delivery_status: 0,
            daily_history: 0,
            rider_history: 0
          }
        };
      }),
      { byDisplayName: true }
    );

    return {
      ok: true,
      collectDate: applied?.collectDate || date || '',
      weekStart: weekStart || undefined,
      sourceMenu: sourceMenu || undefined,
      partners,
      count: partners.length,
      appliedOnly: true,
      dataSource: 'region_map'
    };
  }

  if (!appliedOnly && !date) {
    return { ok: true, collectDate: '', partners: [], count: 0 };
  }

  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const tableName = 'baemin_biz_collect_items';
  let query = supabase
    .from(tableName)
    .select('parsed_json, dedupe_key')
    .eq('collect_date', date)
    .limit(5000);

  const { data, error } = await query;

  if (error) {
    if (isMissingBizCollectTableError(error) || isMissingAppliedTableError(error)) {
      return { ok: false, tableMissing: true, message: `${tableName} 테이블이 없습니다.` };
    }
    return { ok: false, error: error.message || '조회 실패' };
  }

  const { pickBestPartnerName, sortPartnersForAdmin } = require('./baemin-partner-match');
  const catalog = appliedOnly ? await loadPartnerDisplayCatalog() : null;
  const { readPartnerRegionMap } = require('./baemin-partner-region');
  const regionMap = appliedOnly ? await readPartnerRegionMap() : null;
  const partners = new Map();
  (data || []).forEach(row => {
    const parsed = row.parsed_json || {};
    let partnerId = String(parsed.partnerId || '').trim();
    const partnerName = String(parsed.partnerName || '').trim();
    if (!partnerId) {
      const prefix = String(row.dedupe_key || '').split(':')[0];
      if (prefix && prefix !== 'unknown') partnerId = prefix;
    }
    if (!/^DP\d{6,}$/i.test(partnerId)) return;
    const label = partnerName && partnerName !== partnerId ? partnerName : partnerId;
    partners.set(partnerId, pickBestPartnerName(partners.get(partnerId), label));
  });

  const contamination = appliedOnly
    ? { duplicateGroups: [], needsScrub: false, partnerStats: [] }
    : await analyzePartnerContamination(date, { appliedOnly: false });
  const statsByPartner = new Map((contamination.partnerStats || []).map(row => [row.partnerId, row]));

  const items = sortPartnersForAdmin(
    Array.from(partners.entries()).map(([partnerId, partnerName]) => {
      const stat = statsByPartner.get(partnerId);
      const duplicateGroup = (contamination.duplicateGroups || []).find(group =>
        group.removePartnerIds.includes(partnerId) || group.keepPartnerId === partnerId
      );
      const info = appliedOnly ? enrichPartnerEntry(catalog, partnerId, partnerName, regionMap) : null;
      return {
        partnerId,
        partnerName,
        regionName: info?.regionName || '',
        displayName: info?.displayName || partnerName,
        riderCount: Number(stat?.riderCount || 0),
        menuCounts: stat?.menuCounts || {
          delivery_status: 0,
          daily_history: 0,
          rider_history: 0
        },
        inconsistent: Boolean(stat?.inconsistent),
        contaminated: duplicateGroup ? duplicateGroup.removePartnerIds.includes(partnerId) : false,
        duplicateOf: duplicateGroup && duplicateGroup.removePartnerIds.includes(partnerId)
          ? duplicateGroup.keepPartnerName || duplicateGroup.keepPartnerId
          : null
      };
    }),
    appliedOnly ? { byDisplayName: true } : undefined
  );

  return {
    ok: true,
    collectDate: date,
    partners: items,
    count: items.length,
    appliedOnly,
    contamination: {
      needsScrub: Boolean(contamination.needsScrub),
      duplicateGroups: contamination.duplicateGroups || [],
      inconsistentPartners: (contamination.partnerStats || [])
        .filter(stat => stat.inconsistent)
        .map(stat => ({
          partnerId: stat.partnerId,
          partnerName: stat.partnerName,
          menuCounts: stat.menuCounts
        }))
    }
  };
}

async function getCollectItemsForAdmin(collectDate, sourceMenu, options = {}) {
  const supabase = getServiceClient();
  const appliedOnly = Boolean(options.appliedOnly);
  const batchId = await resolveAppliedBatchId(appliedOnly);
  const date = await resolveCollectDateForAdmin(collectDate, appliedOnly);
  const menu = String(sourceMenu || '').trim();
  const partnerId = String(options.partnerId || '').trim().toUpperCase();
  const weekStart = String(options.weekStart || '').slice(0, 10);
  const scope = options.actorScope;
  const allowed = new Set((scope?.allowedPartnerIds || []).map(id => String(id).toUpperCase()));

  if (partnerId && allowed.size && !options.skipScopeCheck && !allowed.has(partnerId)) {
    return { ok: false, status: 403, error: '해당 지역에 접근 권한이 없습니다.' };
  }

  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  if (appliedOnly && weekStart && (menu === 'daily_history' || menu === 'rider_history')) {
    return getHistoryStatsItemsForAdmin(weekStart, menu, partnerId);
  }

  if (appliedOnly && !batchId) {
    return {
      ok: true,
      collectDate: '',
      sourceMenu: menu,
      partnerId: partnerId || null,
      items: [],
      count: 0,
      appliedOnly: true,
      notApplied: true
    };
  }

  const tableName = appliedOnly ? 'baemin_delivery_applied_items' : 'baemin_biz_collect_items';
  const wantPartnerId = String(partnerId || '').trim().toUpperCase();
  // 단건 지역 조회는 raw_json 제외해 페이로드·DB 부하 축소 (필터는 반드시 유지)
  const selectCols = appliedOnly && wantPartnerId
    ? 'id, collect_date, collected_at, source_menu, rider_name, rider_user_id, phone_number, parsed_json, dedupe_key'
    : 'id, collect_date, collected_at, source_menu, rider_name, rider_user_id, phone_number, parsed_json, raw_json, dedupe_key';
  let query = supabase
    .from(tableName)
    .select(selectCols)
    .order('collected_at', { ascending: false })
    .limit(5000);

  if (appliedOnly) {
    query = query.eq('batch_id', batchId);
  } else {
    query = query.eq('collect_date', date);
  }

  if (menu) query = query.eq('source_menu', menu);
  if (wantPartnerId) {
    query = query.like('dedupe_key', `${wantPartnerId}:%`);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingBizCollectTableError(error) || isMissingAppliedTableError(error)) {
      return { ok: false, tableMissing: true, message: `${tableName} 테이블이 없습니다.` };
    }
    return { ok: false, error: error.message || '조회 실패' };
  }

  let items = normalizeCollectItemsForAdmin(data || [], menu, wantPartnerId);
  // DB like 누락/오염 대비: dedupe_key 소유권으로 한 번 더 고정
  if (wantPartnerId) {
    items = items.filter(row => rowBelongsToPartner(row, wantPartnerId));
  }

  if (appliedOnly) {
    const { readPartnerRegionMap } = require('./baemin-partner-region');
    // 단일 지역 조회는 전체 카탈로그(수천건) 로드 생략 — 지연의 주원인
    if (wantPartnerId) {
      const regionMap = await readPartnerRegionMap();
      const regionName = String(regionMap?.[wantPartnerId] || '').trim();
      items = items.map(row => {
        const parsed = row.parsed_json || {};
        // 표시용 라벨만 지역맵으로 채움 — 소유권은 항상 dedupe_key
        const pid = partnerIdFromDedupeKey(row.dedupe_key) || wantPartnerId;
        return {
          ...row,
          parsed_json: {
            ...parsed,
            partnerId: pid,
            partnerName: String(parsed.partnerName || '').trim(),
            regionName: regionName || String(parsed.regionName || '').trim(),
            displayName: regionName || pid
          }
        };
      });
    } else {
      const catalog = await loadPartnerDisplayCatalog();
      const regionMap = await readPartnerRegionMap();
      items = items.map(row => {
        const parsed = row.parsed_json || {};
        const pid = partnerIdFromDedupeKey(row.dedupe_key) || String(parsed.partnerId || '').trim();
        const info = enrichPartnerEntry(catalog, pid, parsed.partnerName, regionMap);
        return {
          ...row,
          parsed_json: {
            ...parsed,
            partnerId: pid,
            partnerName: info.partnerName,
            regionName: info.regionName,
            displayName: info.displayName
          }
        };
      });
    }
  }

  return {
    ok: true,
    collectDate: date,
    sourceMenu: menu,
    partnerId: wantPartnerId || partnerId || null,
    items,
    count: items.length,
    appliedOnly,
    totals: computeItemsMetricTotals(items),
    filterMode: 'dedupe_key_strict',
    filterBuild: '20260708v'
  };
}

function normalizeCollectItemsForAdmin(rows, sourceMenu, partnerId = '') {
  const byKey = new Map();
  (rows || []).forEach(row => {
    const key = `${row.source_menu || ''}|${row.dedupe_key || row.id}`;
    const prev = byKey.get(key);
    if (!prev || String(row.collected_at || '') >= String(prev.collected_at || '')) {
      byKey.set(key, row);
    }
  });

  let items = Array.from(byKey.values());

  if (partnerId) {
    items = items.filter(row => rowBelongsToPartner(row, partnerId));
  }

  if (sourceMenu === 'delivery_status') {
    const byRider = new Map();
    items.forEach(row => {
      const identity = riderIdentityKey(row);
      if (!identity) return;
      const prev = byRider.get(identity);
      if (!prev || String(row.collected_at || '') >= String(prev.collected_at || '')) {
        byRider.set(identity, row);
      }
    });
    items = Array.from(byRider.values());
  }

  if (sourceMenu === 'rider_history') {
    items = items.filter(row => {
      const riderId = String(row.rider_user_id || '').trim();
      const riderName = String(row.rider_name || '').trim();
      const dedupe = String(row.dedupe_key || '');
      if (/:(rider-\d+)$/.test(dedupe) && !riderId && !riderName) return false;
      return Boolean(riderId || riderName);
    });
    items.sort((a, b) => String(a.rider_name || '').localeCompare(String(b.rider_name || ''), 'ko'));
  } else if (sourceMenu === 'daily_history') {
    items.sort((a, b) => {
      const da = String(a.parsed_json?.deliveryDate || a.collect_date || '');
      const db = String(b.parsed_json?.deliveryDate || b.collect_date || '');
      return da.localeCompare(db);
    });
  } else if (sourceMenu === 'delivery_status') {
    items.sort((a, b) => String(a.rider_name || '').localeCompare(String(b.rider_name || ''), 'ko'));
  }

  return items;
}

async function getScopedMenuTotals(collectDate, sourceMenu, options = {}) {
  const menu = String(sourceMenu || '').trim();
  const allowed = [...new Set((options.actorScope?.allowedPartnerIds || [])
    .map(id => String(id || '').trim().toUpperCase())
    .filter(id => /^DP\d{6,}$/i.test(id)))];
  if (!allowed.length) return computeItemsMetricTotals([]);

  const weekStart = String(options.weekStart || '').slice(0, 10);
  const results = await Promise.all(allowed.map(partnerId => getCollectItemsForAdmin(collectDate, menu, {
    appliedOnly: true,
    partnerId,
    weekStart,
    skipScopeCheck: true
  })));
  const allItems = results.flatMap(result => (result.ok ? (result.items || []) : []));
  return computeItemsMetricTotals(allItems);
}

async function getViewBundleForAdmin(options = {}) {
  const sourceMenu = String(options.sourceMenu || 'delivery_status').trim();
  const partnerId = String(options.partnerId || '').trim().toUpperCase();
  const weekStart = String(options.weekStart || '').slice(0, 10);
  const scope = options.actorScope || { allowedPartnerIds: [] };
  const allowed = new Set((scope.allowedPartnerIds || []).map(id => String(id).toUpperCase()));

  if (partnerId && allowed.size && !allowed.has(partnerId)) {
    return { ok: false, status: 403, error: '해당 지역에 접근 권한이 없습니다.' };
  }

  const [partnersResult, applied] = await Promise.all([
    getPartnerListForAdmin(options.collectDate, {
      appliedOnly: true,
      actorScope: scope,
      weekStart,
      sourceMenu
    }),
    readAppliedBaeminDelivery()
  ]);

  if (!partnersResult.ok) return partnersResult;

  const bundle = {
    ok: true,
    collectDate: partnersResult.collectDate || applied?.collectDate || '',
    sourceMenu,
    partnerId: partnerId || null,
    weekStart: weekStart || undefined,
    partners: partnersResult.partners || [],
    count: partnersResult.count || 0,
    applied: applied || null,
    notApplied: Boolean(partnersResult.notApplied),
    items: [],
    totals: null,
    grandTotals: null
  };

  const tasks = [];
  if (partnerId) {
    tasks.push(getCollectItemsForAdmin(bundle.collectDate, sourceMenu, {
      appliedOnly: true,
      partnerId,
      weekStart,
      actorScope: scope
    }).then(result => ({ type: 'items', result })));
  }
  if (sourceMenu === 'delivery_status' || sourceMenu === 'rider_history') {
    tasks.push(getScopedMenuTotals(bundle.collectDate, sourceMenu, {
      weekStart,
      actorScope: scope
    }).then(totals => ({ type: 'grandTotals', totals })));
  }

  const taskResults = await Promise.all(tasks);
  taskResults.forEach(entry => {
    if (entry.type === 'items' && entry.result?.ok) {
      bundle.items = entry.result.items || [];
      bundle.totals = entry.result.totals || null;
      if (entry.result.weekStart) {
        bundle.weekStart = entry.result.weekStart;
        bundle.weekEnd = entry.result.weekEnd;
      }
      if (entry.result.notApplied) bundle.notApplied = true;
    }
    if (entry.type === 'grandTotals') {
      bundle.grandTotals = entry.totals;
    }
  });

  return bundle;
}

async function getViewFullBundleForAdmin(options = {}) {
  const weekStart = String(options.weekStart || '').slice(0, 10);
  const scope = options.actorScope || { allowedPartnerIds: [] };

  const [partnersResult, applied, setCountResult] = await Promise.all([
    getPartnerListForAdmin(options.collectDate, {
      appliedOnly: true,
      actorScope: scope,
      weekStart
    }),
    readAppliedBaeminDelivery(),
    require('./baemin-partner-set-count').readPartnerSetCountMap().catch(() => ({}))
  ]);

  if (!partnersResult.ok) return partnersResult;

  const collectDate = partnersResult.collectDate || applied?.collectDate || '';
  const partnerIds = (partnersResult.partners || [])
    .map(partner => String(partner.partnerId || '').trim().toUpperCase())
    .filter(id => /^DP\d{6,}$/i.test(id));

  const byPartner = {};
  let weekEnd;
  let notApplied = Boolean(partnersResult.notApplied);
  const allowed = new Set(partnerIds);
  const batchId = await resolveAppliedBatchId(true);
  const supabase = getServiceClient();
  const catalog = await loadPartnerDisplayCatalog();
  const { readPartnerRegionMap } = require('./baemin-partner-region');
  const regionMap = await readPartnerRegionMap();

  if (!batchId && notApplied) {
    partnerIds.forEach(partnerId => {
      byPartner[partnerId] = emptyPartnerBundle(collectDate, weekStart);
    });
  } else if (supabase && batchId) {
    const [deliveryRows, dailyRows] = await Promise.all([
      supabase
        .from('baemin_delivery_applied_items')
        // 번들 delivery_status는 parsed_json 기반 집계·표시만 사용 — raw_json 제외
        .select('id, collect_date, collected_at, source_menu, rider_name, rider_user_id, phone_number, parsed_json, dedupe_key')
        .eq('batch_id', batchId)
        .eq('source_menu', 'delivery_status')
        .limit(10000),
      weekStart
        ? supabase.from('baemin_daily_delivery_stats').select('*').eq('week_start', weekStart).limit(10000)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (deliveryRows.error) {
      return { ok: false, error: deliveryRows.error.message || '배달현황 조회 실패' };
    }
    if (dailyRows.error) {
      return { ok: false, error: dailyRows.error.message || '일별 내역 조회 실패' };
    }

    const deliveryGrouped = groupAppliedRowsByPartner(
      normalizeCollectItemsForAdmin(deliveryRows.data || [], 'delivery_status', ''),
      allowed
    );
    const dailyGrouped = groupStatsRowsByPartner(
      dedupeStatsRowsByLatest(dailyRows.data || [], 'daily_history'),
      'daily_history',
      allowed,
      catalog,
      regionMap
    );

    const { settlementWeekEnd } = require('./baemin-settlement-week');
    weekEnd = weekStart ? settlementWeekEnd(weekStart) : undefined;

    partnerIds.forEach(partnerId => {
      const deliveryItems = (deliveryGrouped.get(partnerId) || []).map(row => {
        const parsed = row.parsed_json || {};
        const info = enrichPartnerEntry(catalog, partnerId, parsed.partnerName, regionMap);
        return {
          ...row,
          parsed_json: {
            ...parsed,
            partnerId,
            partnerName: info.partnerName,
            regionName: info.regionName,
            displayName: info.displayName
          }
        };
      });
      const dailyItems = dailyGrouped.get(partnerId) || [];
      const riderItems = [];
      byPartner[partnerId] = {
        delivery_status: deliveryItems,
        daily_history: dailyItems,
        rider_history: riderItems,
        totals: {
          delivery_status: computeItemsMetricTotals(deliveryItems),
          daily_history: computeItemsMetricTotals(dailyItems),
          rider_history: computeItemsMetricTotals(riderItems)
        },
        meta: {
          captureDate: collectDate,
          weekStart: weekStart || undefined,
          weekEnd,
          notApplied: false
        }
      };
    });
  } else {
    partnerIds.forEach(partnerId => {
      byPartner[partnerId] = emptyPartnerBundle(collectDate, weekStart);
      notApplied = true;
    });
  }

  return {
    ok: true,
    collectDate,
    weekStart: weekStart || undefined,
    weekEnd,
    partners: partnersResult.partners || [],
    count: partnerIds.length,
    applied: applied || null,
    notApplied,
    byPartner,
    setCountMap: setCountResult || {}
  };
}

function emptyPartnerBundle(collectDate, weekStart) {
  return {
    delivery_status: [],
    daily_history: [],
    rider_history: [],
    totals: {
      delivery_status: computeItemsMetricTotals([]),
      daily_history: computeItemsMetricTotals([]),
      rider_history: computeItemsMetricTotals([])
    },
    meta: {
      captureDate: collectDate,
      weekStart: weekStart || undefined,
      notApplied: true
    }
  };
}

function groupAppliedRowsByPartner(items, allowed) {
  const map = new Map();
  (items || []).forEach(row => {
    const pid = String(partnerIdFromDedupeKey(row.dedupe_key) || '').toUpperCase()
      || String(row.parsed_json?.partnerId || '').toUpperCase();
    if (!pid || !allowed.has(pid)) return;
    // dedupe_key 와 parsed partnerId가 다르면 키를 우선 (섞임 방지)
    if (!rowBelongsToPartner(row, pid)) return;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push(row);
  });
  return map;
}

function groupStatsRowsByPartner(rows, menu, allowed, catalog, regionMap) {
  const map = new Map();
  const mapper = menu === 'daily_history' ? mapDailyStatsRowToAdminItem : mapRiderStatsRowToAdminItem;
  (rows || []).forEach(row => {
    const pid = String(partnerIdFromDedupeKey(row.dedupe_key) || '').toUpperCase();
    if (!pid || !allowed.has(pid)) return;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid).push(mapper(row, pid, catalog, regionMap));
  });
  Array.from(map.entries()).forEach(([pid, items]) => {
    if (menu === 'rider_history') {
      items.sort((a, b) => String(a.rider_name || '').localeCompare(String(b.rider_name || ''), 'ko'));
    } else if (menu === 'daily_history') {
      items.sort((a, b) => String(a.parsed_json?.deliveryDate || a.collect_date || '').localeCompare(String(b.parsed_json?.deliveryDate || b.collect_date || '')));
    }
  });
  return map;
}

function mergeRiderParsedMetrics(target, source = {}) {
  const breakdown = serviceBreakdownFromStats({
    ...source,
    rejectTotal: source.totalReject,
    cancelTotal: source.cancelCount,
    totalRiderFault: source.riderFault
  });
  target.totalComplete = num(target.totalComplete) + num(source.totalComplete);
  target.totalReject = num(target.totalReject) + num(breakdown.totalReject);
  target.cancelCount = num(target.cancelCount) + num(breakdown.cancelCount);
  target.riderFault = num(target.riderFault) + num(breakdown.riderFault);
  target.foodReject = num(target.foodReject) + num(breakdown.foodReject);
  target.bmartReject = num(target.bmartReject) + num(breakdown.bmartReject);
  target.storeReject = num(target.storeReject) + num(breakdown.storeReject);
  target.foodCancel = num(target.foodCancel) + num(breakdown.foodCancel);
  target.bmartCancel = num(target.bmartCancel) + num(breakdown.bmartCancel);
  target.storeCancel = num(target.storeCancel) + num(breakdown.storeCancel);
  target.foodRiderFault = num(target.foodRiderFault) + num(breakdown.foodRiderFault);
  target.bmartRiderFault = num(target.bmartRiderFault) + num(breakdown.bmartRiderFault);
  target.storeRiderFault = num(target.storeRiderFault) + num(breakdown.storeRiderFault);
  target.morningCount = num(target.morningCount) + num(source.morningCount);
  target.afternoonCount = num(target.afternoonCount) + num(source.afternoonCount);
  target.eveningCount = num(target.eveningCount) + num(source.eveningCount);
  target.midnightCount = num(target.midnightCount) + num(source.midnightCount);
}

function aggregateRiderHistoryByRider(items) {
  const byRider = new Map();
  (items || []).forEach(row => {
    const identity = riderIdentityKey(row)
      || [row.rider_user_id, row.rider_name, row.phone_number].filter(Boolean).join('|');
    if (!identity) return;
    if (!byRider.has(identity)) {
      const partnerId = String(
        row.parsed_json?.partnerId
        || partnerIdFromDedupeKey(row.dedupe_key)
        || ''
      ).trim().toUpperCase();
      byRider.set(identity, {
        // 화면 filterRowsByPartnerId 가 dedupe_key 접두를 보므로 유지
        dedupe_key: row.dedupe_key || (partnerId ? `${partnerId}:agg:${identity}` : ''),
        rider_name: row.rider_name || '',
        rider_user_id: row.rider_user_id || '',
        phone_number: row.phone_number || '',
        parsed_json: {
          partnerId,
          partnerName: row.parsed_json?.partnerName || '',
          regionName: row.parsed_json?.regionName || '',
          displayName: row.parsed_json?.displayName || '',
          totalComplete: 0,
          totalReject: 0,
          cancelCount: 0,
          riderFault: 0,
          foodReject: 0,
          bmartReject: 0,
          storeReject: 0,
          foodCancel: 0,
          bmartCancel: 0,
          storeCancel: 0,
          foodRiderFault: 0,
          bmartRiderFault: 0,
          storeRiderFault: 0,
          morningCount: 0,
          afternoonCount: 0,
          eveningCount: 0,
          midnightCount: 0
        },
        activeDays: 0
      });
    }
    const agg = byRider.get(identity);
    if (row.rider_name) agg.rider_name = row.rider_name;
    if (row.rider_user_id) agg.rider_user_id = row.rider_user_id;
    if (row.phone_number) agg.phone_number = row.phone_number;
    if (!agg.dedupe_key && row.dedupe_key) agg.dedupe_key = row.dedupe_key;
    if (!agg.parsed_json.partnerId) {
      agg.parsed_json.partnerId = String(
        row.parsed_json?.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || ''
      ).trim().toUpperCase();
    }
    mergeRiderParsedMetrics(agg.parsed_json, row.parsed_json || {});
    agg.activeDays += 1;
  });
  return Array.from(byRider.values())
    .sort((a, b) => {
      const completeDiff = Number(b.parsed_json?.totalComplete || 0) - Number(a.parsed_json?.totalComplete || 0);
      if (completeDiff !== 0) return completeDiff;
      return String(a.rider_name || '').localeCompare(String(b.rider_name || ''), 'ko');
    });
}

function buildRiderHistoryDaySeries(items, fromDate, toDate) {
  const { addDays } = require('./baemin-settlement-week');
  const byDate = new Map();
  (items || []).forEach(row => {
    const date = resolveRiderBusinessDate(row);
    if (!date) return;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  });

  const days = [];
  if (!fromDate || !toDate || toDate < fromDate) return days;
  let cursor = fromDate;
  while (cursor <= toDate) {
    const dayItems = byDate.get(cursor) || [];
    if (!dayItems.length) {
      days.push({ date: cursor, empty: true, riderCount: 0, totals: null, items: [] });
    } else {
      days.push({
        date: cursor,
        empty: false,
        riderCount: dayItems.length,
        totals: computeItemsMetricTotals(dayItems),
        items: dayItems
      });
    }
    cursor = addDays(cursor, 1);
  }
  return days;
}

async function getRiderHistoryRangeForAdmin(options = {}) {
  const fromDate = String(options.fromDate || '').slice(0, 10);
  const toDate = String(options.toDate || '').slice(0, 10);
  const partnerId = String(options.partnerId || '').trim().toUpperCase();
  const compact = options.compact === true;
  const scope = options.actorScope;
  const allowed = new Set((scope?.allowedPartnerIds || []).map(id => String(id).toUpperCase()));

  if (!fromDate || !toDate || toDate < fromDate) {
    return { ok: false, status: 400, error: 'INVALID_RANGE', message: '조회 시작일과 종료일을 확인하세요.' };
  }
  if (partnerId && allowed.size && !options.skipScopeCheck && !allowed.has(partnerId)) {
    return { ok: false, status: 403, error: '해당 지역에 접근 권한이 없습니다.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const batchId = await resolveAppliedBatchId(true);
  if (!batchId) {
    return {
      ok: true,
      fromDate,
      toDate,
      partnerId: partnerId || null,
      items: [],
      riders: [],
      riderCount: 0,
      days: buildRiderHistoryDaySeries([], fromDate, toDate),
      count: 0,
      notApplied: true,
      message: '배민 BIZ 현황에서 [배민현황 저장]을 먼저 실행하세요. 수집만 하면 배민현황에 표시되지 않습니다.'
    };
  }

  // 라이더 집계(riders/days)는 parsed_json/dedupe_key만 사용 — raw_json 제외
  const appliedSelect = compact
    ? 'id, source_menu, rider_name, rider_user_id, phone_number, parsed_json, dedupe_key'
    : 'id, collect_date, collected_at, source_menu, rider_name, rider_user_id, phone_number, parsed_json, dedupe_key';
  const appliedFilters = {
    batch_id: batchId,
    source_menu: 'rider_history'
  };
  if (partnerId) {
    appliedFilters.like = { column: 'dedupe_key', pattern: `${partnerId}:%` };
  }
  const appliedFetched = compact
    ? await fetchAppliedRiderItemsByDays(
      batchId,
      fromDate,
      toDate,
      partnerId,
      appliedSelect
    )
    : await fetchAppliedItemsPaged(
      'baemin_delivery_applied_items',
      appliedFilters,
      appliedSelect
    );
  if (!appliedFetched.ok) {
    if (isMissingAppliedTableError({ message: appliedFetched.error })) {
      return { ok: false, tableMissing: true, message: 'baemin_delivery_applied_items 테이블이 없습니다.' };
    }
    return { ok: false, error: appliedFetched.error || '라이더 내역 조회 실패' };
  }
  const data = normalizePerDayRiderBusinessDates(
    preferPerDayRiderHistoryRows(
      (appliedFetched.rows || []).filter(row => riderRowOverlapsRange(row, fromDate, toDate))
    )
  );

  let items = normalizeCollectItemsForAdmin(data || [], 'rider_history', partnerId);
  const scopedItems = items.filter(row => {
    const pid = String(row.parsed_json?.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || '').toUpperCase();
    if (partnerId && pid !== partnerId) return false;
    if (allowed.size && pid && !allowed.has(pid)) return false;
    return true;
  });
  items = scopedItems;

  let hint = '';
  let savedRange = null; // 선택 기간에 데이터가 없을 때 최근 저장 기간(클라이언트 자동 재조회용)
  if (!items.length) {
    const allPartnerRows = normalizeCollectItemsForAdmin(appliedFetched.rows || [], 'rider_history', partnerId)
      .filter(row => {
        const pid = String(row.parsed_json?.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || '').toUpperCase();
        if (partnerId && pid !== partnerId) return false;
        if (allowed.size && pid && !allowed.has(pid)) return false;
        return true;
      });
    if (allPartnerRows.length) {
      const savedDates = allPartnerRows.map(row => resolveRiderBusinessDate(row)).filter(Boolean).sort();
      const savedFrom = savedDates[0] || '';
      const savedTo = savedDates[savedDates.length - 1] || '';
      if (savedFrom && savedTo) {
        savedRange = { fromDate: savedFrom, toDate: savedTo };
      }
      hint = savedFrom && savedTo
        ? `저장된 라이더 ${allPartnerRows.length}건은 있으나, 선택 기간(${fromDate}~${toDate})과 겹치지 않습니다. 저장된 배달일: ${savedFrom}~${savedTo}`
        : `저장된 라이더 ${allPartnerRows.length}건은 있으나, 선택 기간(${fromDate}~${toDate}) 배달일 데이터가 없습니다.`;
    } else {
      hint = `선택 지역·기간(${fromDate}~${toDate})에 라이더 데이터가 없습니다. BIZ에서 라이더 수집 후 [배민현황 저장]을 실행했는지 확인하세요.`;
    }
  }

  const { readPartnerRegionMap, resolvePartnerDisplay } = require('./baemin-partner-region');
  const regionMap = await readPartnerRegionMap().catch(() => ({}));
  items = items.map(row => {
    const parsed = row.parsed_json || {};
    const pid = String(parsed.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || partnerId || '').toUpperCase();
    const info = resolvePartnerDisplay(pid, parsed.partnerName, parsed.regionName, regionMap);
    return {
      ...row,
      parsed_json: {
        ...parsed,
        partnerId: pid,
        partnerName: info.partnerName,
        regionName: info.regionName,
        displayName: info.displayName
      }
    };
  });

  if (compact) {
    return {
      ok: true,
      fromDate,
      toDate,
      partnerId: partnerId || null,
      items: items.map(row => ({
        dedupe_key: row.dedupe_key || '',
        rider_name: row.rider_name || '',
        rider_user_id: row.rider_user_id || '',
        phone_number: row.phone_number || '',
        parsed_json: row.parsed_json || {}
      })),
      count: items.length,
      totalSaved: scopedItems.length,
      hint,
      appliedOnly: true,
      compact: true
    };
  }

  const days = buildRiderHistoryDaySeries(items, fromDate, toDate);
  const riders = aggregateRiderHistoryByRider(items);
  return {
    ok: true,
    fromDate,
    toDate,
    partnerId: partnerId || null,
    items,
    riders,
    days,
    count: items.length,
    riderCount: riders.length,
    totalSaved: scopedItems.length,
    hint,
    savedRange,
    appliedOnly: true,
    totals: computeItemsMetricTotals(items)
  };
}

/**
 * 실시간 수락율 스냅샷 교체: 해당 정산주(+지역) 삭제 후 upsert
 * 로그인/기존 운영 테이블 스키마는 변경하지 않음
 */
async function replaceLiveAcceptRatesForAdmin(options = {}) {
  const weekStart = String(options.weekStart || '').slice(0, 10);
  const partnerId = String(options.partnerId || '').trim().toUpperCase();
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const scope = options.actorScope;
  const allowed = new Set((scope?.allowedPartnerIds || []).map(id => String(id).toUpperCase()));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return { ok: false, status: 400, message: 'weekStart(수요일)가 필요합니다.' };
  }
  if (partnerId && allowed.size && !options.skipScopeCheck && !allowed.has(partnerId)) {
    return { ok: false, status: 403, message: '해당 지역에 접근 권한이 없습니다.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, message: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  // 테이블 없으면 조용히 스킵 (마이그레이션 전 환경)
  let delQuery = supabase
    .from('baemin_live_accept_rates')
    .delete()
    .eq('week_start', weekStart);
  if (partnerId) delQuery = delQuery.eq('partner_id', partnerId);
  const { error: delError } = await delQuery;
  if (delError) {
    if (/does not exist|Could not find the table/i.test(String(delError.message || ''))) {
      return {
        ok: true,
        skipped: true,
        message: 'baemin_live_accept_rates 테이블이 없어 스냅샷 저장을 건너뜁니다.'
      };
    }
    return { ok: false, message: delError.message || '기존 수락율 스냅샷 삭제 실패' };
  }

  if (!rows.length) {
    return { ok: true, deleted: true, upserted: 0, weekStart, partnerId: partnerId || null };
  }

  const { data, error } = await supabase.rpc('brem_upsert_baemin_live_accept_rates', {
    p_rows: rows
  });
  if (error) {
    if (/Could not find the function|does not exist/i.test(String(error.message || ''))) {
      return {
        ok: true,
        skipped: true,
        message: 'upsert 함수가 없어 스냅샷 저장을 건너뜁니다.'
      };
    }
    return { ok: false, message: error.message || '수락율 스냅샷 저장 실패' };
  }

  return {
    ok: true,
    weekStart,
    partnerId: partnerId || null,
    deleted: true,
    upserted: Array.isArray(rows) ? rows.length : 0,
    result: data || null
  };
}

function normalizeBaeminUserIdForOps(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '-') return '';
  if (/^\d+(\.0+)?$/.test(raw)) return String(Math.round(Number(raw)));
  return raw;
}

function extractAcceptRateMetricsFromParsed(parsed = {}) {
  return {
    complete: Math.max(0, Number(parsed.totalComplete || parsed.completeCount || 0) || 0),
    foodReject: Math.max(0, Number(parsed.foodReject || 0) || 0),
    foodCancel: Math.max(0, Number(parsed.foodCancel || 0) || 0),
    foodRiderFault: Math.max(0, Number(parsed.foodRiderFault || 0) || 0)
  };
}

function mergeAcceptRateMetricsBags(a = {}, b = {}) {
  return {
    complete: Number(a.complete || 0) + Number(b.complete || 0),
    foodReject: Number(a.foodReject || 0) + Number(b.foodReject || 0),
    foodCancel: Number(a.foodCancel || 0) + Number(b.foodCancel || 0),
    foodRiderFault: Number(a.foodRiderFault || 0) + Number(b.foodRiderFault || 0)
  };
}

function calcFoodAcceptRatePercent(metrics = {}) {
  const complete = Number(metrics.complete || 0);
  const deny = Number(metrics.foodReject || 0)
    + Number(metrics.foodCancel || 0)
    + Number(metrics.foodRiderFault || 0);
  const denom = complete + deny;
  if (denom <= 0) return null;
  return Math.round((100 - (deny / denom) * 100) * 10) / 10;
}

/**
 * 배민현황(applied) 배달현황 + 이번주 라이더내역으로
 * baemin_live_accept_rates 를 전지역 재생성 (기사앱 실시간 운행현황용)
 */
async function rebuildLiveAcceptRatesForAppliedWeek(options = {}) {
  const { settlementWeekStart } = require('./baemin-settlement-week');
  const today = todayKST();
  const weekStartRaw = String(options.weekStart || '').slice(0, 10);
  const weekStart = settlementWeekStart(
    /^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw) ? weekStartRaw : today
  );
  const yesterday = addDays(today, -1);
  const hasPast = /^\d{4}-\d{2}-\d{2}$/.test(yesterday) && yesterday >= weekStart;
  const pastFromDate = hasPast ? weekStart : '';
  const pastToDate = hasPast ? yesterday : '';

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, message: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const applied = await readAppliedBaeminDelivery();
  const batchId = await resolveAppliedBatchId(true);
  if (!batchId) {
    return {
      ok: false,
      status: 400,
      notApplied: true,
      message: '배민현황 저장(applied) 데이터가 없습니다. 먼저 [배민현황 저장]을 실행하세요.'
    };
  }

  const captureDate = String(applied?.collectDate || today).slice(0, 10);

  const [deliveryResult, ridersResult] = await Promise.all([
    supabase
      .from('baemin_delivery_applied_items')
      .select('rider_name, rider_user_id, phone_number, parsed_json, dedupe_key, collected_at')
      .eq('batch_id', batchId)
      .eq('source_menu', 'delivery_status')
      .limit(15000),
    supabase
      .from('riders')
      .select('id, baemin_id')
      .not('baemin_id', 'is', null)
      .limit(10000)
  ]);

  if (deliveryResult.error) {
    return { ok: false, message: deliveryResult.error.message || '배달현황 조회 실패' };
  }

  let pastItems = [];
  if (hasPast) {
    const pastFetched = await getRiderHistoryRangeForAdmin({
      fromDate: pastFromDate,
      toDate: pastToDate,
      compact: true,
      skipScopeCheck: true
    });
    if (pastFetched?.ok) {
      pastItems = pastFetched.items || pastFetched.riders || [];
    }
  }

  const driverByBaemin = new Map();
  (ridersResult.data || []).forEach(row => {
    const baeminId = normalizeBaeminUserIdForOps(row.baemin_id);
    const driverId = String(row.id || '').trim();
    if (baeminId && driverId && !driverByBaemin.has(baeminId)) {
      driverByBaemin.set(baeminId, driverId);
    }
  });

  const byKey = new Map();
  const upsert = (row, bucket) => {
    const baeminId = normalizeBaeminUserIdForOps(row.rider_user_id || row.parsed_json?.riderUserId);
    const name = String(row.rider_name || '').trim();
    const key = baeminId || (name ? `name:${name}` : '');
    if (!key || key === 'name:') return;
    const partnerId = String(
      row.parsed_json?.partnerId
      || partnerIdFromDedupeKey(row.dedupe_key)
      || ''
    ).trim().toUpperCase();
    const metrics = extractAcceptRateMetricsFromParsed(row.parsed_json || {});
    const prev = byKey.get(key) || {
      riderName: name,
      riderUserId: baeminId,
      phoneNumber: String(row.phone_number || '').trim(),
      partnerId: /^DP\d{6,}$/.test(partnerId) ? partnerId : '',
      past: { complete: 0, foodReject: 0, foodCancel: 0, foodRiderFault: 0 },
      live: { complete: 0, foodReject: 0, foodCancel: 0, foodRiderFault: 0 }
    };
    if (name) prev.riderName = name;
    if (baeminId) prev.riderUserId = baeminId;
    if (row.phone_number) prev.phoneNumber = String(row.phone_number).trim();
    if (/^DP\d{6,}$/.test(partnerId)) prev.partnerId = partnerId;
    prev[bucket] = mergeAcceptRateMetricsBags(prev[bucket], metrics);
    byKey.set(key, prev);
  };

  pastItems.forEach(row => upsert(row, 'past'));
  (deliveryResult.data || []).forEach(row => upsert(row, 'live'));

  const rows = [...byKey.values()]
    .filter(entry => entry.riderUserId)
    .map(entry => {
      const current = mergeAcceptRateMetricsBags(entry.past, entry.live);
      const pastRate = calcFoodAcceptRatePercent(entry.past);
      const currentRate = calcFoodAcceptRatePercent(current);
      return {
        weekStart,
        partnerId: entry.partnerId || '',
        riderUserId: entry.riderUserId,
        riderName: entry.riderName || '',
        phoneNumber: entry.phoneNumber || '',
        driverId: driverByBaemin.get(entry.riderUserId) || '',
        pastFrom: pastFromDate || null,
        pastTo: pastToDate || null,
        pastComplete: entry.past.complete,
        pastFoodReject: entry.past.foodReject,
        pastFoodCancel: entry.past.foodCancel,
        pastFoodRiderFault: entry.past.foodRiderFault,
        pastAcceptRate: pastRate,
        liveComplete: entry.live.complete,
        liveFoodReject: entry.live.foodReject,
        liveFoodCancel: entry.live.foodCancel,
        liveFoodRiderFault: entry.live.foodRiderFault,
        currentComplete: current.complete,
        currentFoodReject: current.foodReject,
        currentFoodCancel: current.foodCancel,
        currentFoodRiderFault: current.foodRiderFault,
        currentAcceptRate: currentRate,
        sourceCaptureDate: captureDate || null
      };
    });

  const saved = await replaceLiveAcceptRatesForAdmin({
    weekStart,
    partnerId: '',
    rows,
    skipScopeCheck: true
  });

  if (!saved.ok) return saved;

  const matched = rows.filter(row => row.driverId).length;
  return {
    ok: true,
    weekStart,
    pastFromDate: pastFromDate || null,
    pastToDate: pastToDate || null,
    captureDate,
    riderCount: rows.length,
    matchedDriverCount: matched,
    deliveryCount: (deliveryResult.data || []).length,
    pastCount: pastItems.length,
    upserted: rows.length,
    skipped: Boolean(saved.skipped),
    message: saved.skipped
      ? saved.message
      : `수락율 스냅샷 ${rows.length}명 반영 (기사매칭 ${matched})`
  };
}

function resolveDailyBusinessDate(row = {}) {
  const parsed = row.parsed_json || {};
  const fromParsed = String(parsed.deliveryDate || parsed.businessDate || parsed.businessDay || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromParsed)) return fromParsed;
  const parts = String(row.dedupe_key || '').split(':');
  const fromKey = String(parts[1] || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromKey)) return fromKey;
  return String(row.collect_date || '').slice(0, 10);
}

function dailyRowOverlapsRange(row = {}, fromDate = '', toDate = '') {
  if (!fromDate || !toDate || toDate < fromDate) return false;
  const day = resolveDailyBusinessDate(row);
  return Boolean(day && day >= fromDate && day <= toDate);
}

function aggregateDailyHistoryByDate(items = []) {
  const byDate = new Map();
  (items || []).forEach(row => {
    const date = resolveDailyBusinessDate(row);
    if (!date) return;
    if (!byDate.has(date)) {
      byDate.set(date, {
        collect_date: date,
        dedupe_key: row.dedupe_key || '',
        rider_name: '',
        rider_user_id: '',
        phone_number: '',
        parsed_json: {
          deliveryDate: date,
          businessDate: date,
          partnerId: row.parsed_json?.partnerId || '',
          partnerName: row.parsed_json?.partnerName || '',
          regionName: row.parsed_json?.regionName || '',
          displayName: row.parsed_json?.displayName || '',
          totalComplete: 0,
          totalReject: 0,
          cancelCount: 0,
          riderFault: 0,
          foodReject: 0,
          bmartReject: 0,
          storeReject: 0,
          foodCancel: 0,
          bmartCancel: 0,
          storeCancel: 0,
          foodRiderFault: 0,
          bmartRiderFault: 0,
          storeRiderFault: 0,
          morningCount: 0,
          afternoonCount: 0,
          eveningCount: 0,
          midnightCount: 0
        }
      });
    }
    mergeRiderParsedMetrics(byDate.get(date).parsed_json, row.parsed_json || {});
  });
  return Array.from(byDate.values()).sort((a, b) =>
    String(a.parsed_json?.deliveryDate || '').localeCompare(String(b.parsed_json?.deliveryDate || ''))
  );
}

async function getDailyHistoryRangeForAdmin(options = {}) {
  const fromDate = String(options.fromDate || '').slice(0, 10);
  const toDate = String(options.toDate || '').slice(0, 10);
  const partnerId = String(options.partnerId || '').trim().toUpperCase();
  const scope = options.actorScope;
  const allowed = new Set((scope?.allowedPartnerIds || []).map(id => String(id).toUpperCase()));

  if (!fromDate || !toDate || toDate < fromDate) {
    return { ok: false, status: 400, error: 'INVALID_RANGE', message: '조회 시작일과 종료일을 확인하세요.' };
  }
  if (partnerId && allowed.size && !options.skipScopeCheck && !allowed.has(partnerId)) {
    return { ok: false, status: 403, error: '해당 지역에 접근 권한이 없습니다.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const batchId = await resolveAppliedBatchId(true);
  if (!batchId) {
    return {
      ok: true,
      fromDate,
      toDate,
      partnerId: partnerId || null,
      items: [],
      count: 0,
      notApplied: true,
      message: '배민 BIZ 현황에서 [배민현황 저장]을 먼저 실행하세요. 수집만 하면 배민현황에 표시되지 않습니다.'
    };
  }

  // 일별 집계는 parsed_json/dedupe_key만 사용 — raw_json 제외로 페이로드·DB 부하 축소
  const appliedSelect = 'id, collect_date, collected_at, source_menu, rider_name, rider_user_id, phone_number, parsed_json, dedupe_key';
  const appliedFilters = {
    batch_id: batchId,
    source_menu: 'daily_history'
  };
  if (partnerId) {
    appliedFilters.like = { column: 'dedupe_key', pattern: `${partnerId}:%` };
  }
  const appliedFetched = await fetchAppliedItemsPaged(
    'baemin_delivery_applied_items',
    appliedFilters,
    appliedSelect
  );
  if (!appliedFetched.ok) {
    if (isMissingAppliedTableError({ message: appliedFetched.error })) {
      return { ok: false, tableMissing: true, message: 'baemin_delivery_applied_items 테이블이 없습니다.' };
    }
    return { ok: false, error: appliedFetched.error || '일별 내역 조회 실패' };
  }

  const overlapping = (appliedFetched.rows || []).filter(row => dailyRowOverlapsRange(row, fromDate, toDate));
  let items = normalizeCollectItemsForAdmin(overlapping, 'daily_history', partnerId)
    .filter(row => {
      const pid = String(row.parsed_json?.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || '').toUpperCase();
      if (partnerId && pid !== partnerId) return false;
      if (allowed.size && pid && !allowed.has(pid)) return false;
      return true;
    });

  let hint = '';
  let savedRange = null; // 선택 기간에 데이터가 없을 때 최근 저장 기간(클라이언트 자동 재조회용)
  if (!items.length) {
    const allPartnerRows = normalizeCollectItemsForAdmin(appliedFetched.rows || [], 'daily_history', partnerId)
      .filter(row => {
        const pid = String(row.parsed_json?.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || '').toUpperCase();
        if (partnerId && pid !== partnerId) return false;
        if (allowed.size && pid && !allowed.has(pid)) return false;
        return true;
      });
    if (allPartnerRows.length) {
      const savedDates = allPartnerRows.map(row => resolveDailyBusinessDate(row)).filter(Boolean).sort();
      const savedFrom = savedDates[0] || '';
      const savedTo = savedDates[savedDates.length - 1] || '';
      if (savedFrom && savedTo) {
        savedRange = { fromDate: savedFrom, toDate: savedTo };
      }
      hint = savedFrom && savedTo
        ? `저장된 일별 ${allPartnerRows.length}건은 있으나, 선택 기간(${fromDate}~${toDate})과 겹치지 않습니다. 저장된 배달일: ${savedFrom}~${savedTo}`
        : `저장된 일별 ${allPartnerRows.length}건은 있으나, 선택 기간(${fromDate}~${toDate}) 배달일 데이터가 없습니다.`;
    } else {
      hint = `선택 지역·기간(${fromDate}~${toDate})에 일별 데이터가 없습니다. BIZ에서 일별 수집 후 [배민현황 저장]을 실행했는지 확인하세요.`;
    }
  }

  const { readPartnerRegionMap, resolvePartnerDisplay } = require('./baemin-partner-region');
  const regionMap = await readPartnerRegionMap().catch(() => ({}));
  items = items.map(row => {
    const parsed = row.parsed_json || {};
    const pid = String(parsed.partnerId || partnerIdFromDedupeKey(row.dedupe_key) || partnerId || '').toUpperCase();
    const info = resolvePartnerDisplay(pid, parsed.partnerName, parsed.regionName, regionMap);
    return {
      ...row,
      parsed_json: {
        ...parsed,
        partnerId: pid,
        partnerName: info.partnerName,
        regionName: info.regionName,
        displayName: info.displayName
      }
    };
  });

  items = aggregateDailyHistoryByDate(items);
  return {
    ok: true,
    fromDate,
    toDate,
    partnerId: partnerId || null,
    items,
    count: items.length,
    hint,
    savedRange,
    appliedOnly: true,
    totals: computeItemsMetricTotals(items)
  };
}

/**
 * 정산주(수~화) 기준 날짜×지역 수집 커버리지
 * menu: rider_history | daily_history
 */
async function getHistoryCollectCoverageForAdmin(options = {}) {
  const menu = String(options.menu || 'rider_history').trim();
  if (!['rider_history', 'daily_history'].includes(menu)) {
    return { ok: false, status: 400, error: 'INVALID_MENU', message: 'rider_history 또는 daily_history 만 지원합니다.' };
  }

  const weekStartRaw = String(options.weekStart || '').slice(0, 10);
  const { settlementWeekStart, addDays: addDay } = require('./baemin-settlement-week');
  const weekStart = settlementWeekStart(
    /^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw) ? weekStartRaw : todayKST()
  );
  // 수~화 고정
  const fromDate = weekStart;
  const toDate = addDay(weekStart, 6);
  const dates = buildDateList(fromDate, toDate);

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { readPartnerRegionMap, resolvePartnerDisplay } = require('./baemin-partner-region');
  const regionMap = await readPartnerRegionMap().catch(() => ({}));
  let partners = Object.keys(regionMap || {})
    .filter(id => /^DP\d{6,}$/i.test(id))
    .map(id => {
      const info = resolvePartnerDisplay(id, '', regionMap[id] || '', regionMap);
      return {
        partnerId: String(id).toUpperCase(),
        partnerName: info.partnerName || id,
        regionName: info.regionName || regionMap[id] || '',
        displayName: info.displayName || info.regionName || id
      };
    })
    .sort((a, b) => String(a.displayName || a.partnerId).localeCompare(String(b.displayName || b.partnerId), 'ko'));

  const scope = options.actorScope;
  const allowed = new Set((scope?.allowedPartnerIds || []).map(id => String(id).toUpperCase()));
  if (allowed.size && !options.skipScopeCheck) {
    partners = partners.filter(p => allowed.has(p.partnerId));
  }

  function businessDateForCoverage(row) {
    const key = String(row.dedupe_key || '');
    if (menu === 'daily_history') {
      // DP:YYYY-MM-DD:daily
      const parts = key.split(':');
      const day = String(parts[1] || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && String(parts[2] || '') === 'daily') return day;
      const fromParsed = String(row.parsed_json?.businessDate || row.parsed_json?.deliveryDate || '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(fromParsed) ? fromParsed : '';
    }
    if (isPerDayRiderDedupeKey(key)) return businessDateFromDedupeKey(key);
    return resolveRiderBusinessDate(row) || '';
  }

  async function countByPartnerDate(table, extraFilter = {}) {
    const map = new Map(); // `${pid}|${date}` -> count
    let offset = 0;
    while (true) {
      let query = supabase
        .from(table)
        .select('dedupe_key, parsed_json')
        .eq('source_menu', menu)
        .range(offset, offset + BIZ_COLLECT_PAGE_SIZE - 1);
      if (extraFilter.batch_id) query = query.eq('batch_id', extraFilter.batch_id);
      const { data, error } = await query;
      if (error || !data?.length) break;
      data.forEach(row => {
        const pid = partnerIdFromDedupeKey(row.dedupe_key)
          || String(row.parsed_json?.partnerId || '').trim().toUpperCase();
        const day = businessDateForCoverage(row);
        if (!/^DP\d{6,}$/.test(pid) || !day || day < fromDate || day > toDate) return;
        if (allowed.size && !options.skipScopeCheck && !allowed.has(pid)) return;
        const k = `${pid}|${day}`;
        map.set(k, (map.get(k) || 0) + 1);
      });
      if (data.length < BIZ_COLLECT_PAGE_SIZE) break;
      offset += BIZ_COLLECT_PAGE_SIZE;
    }
    return map;
  }

  const applied = await readAppliedBaeminDelivery();
  const [bizMap, appliedMap] = await Promise.all([
    countByPartnerDate('baemin_biz_collect_items'),
    applied?.batchId
      ? countByPartnerDate('baemin_delivery_applied_items', { batch_id: applied.batchId })
      : Promise.resolve(new Map())
  ]);

  // 조회에 등장한 partner도 포함 (등록 누락 대비)
  const partnerIds = new Set(partners.map(p => p.partnerId));
  [...bizMap.keys(), ...appliedMap.keys()].forEach(key => {
    const pid = String(key.split('|')[0] || '').toUpperCase();
    if (/^DP\d{6,}$/.test(pid)) partnerIds.add(pid);
  });
  partners = [...partnerIds].map(pid => {
    const existing = partners.find(p => p.partnerId === pid);
    if (existing) return existing;
    const info = resolvePartnerDisplay(pid, '', '', regionMap);
    return {
      partnerId: pid,
      partnerName: info.partnerName || pid,
      regionName: info.regionName || '',
      displayName: info.displayName || info.partnerName || pid
    };
  }).sort((a, b) => String(a.displayName || a.partnerId).localeCompare(String(b.displayName || b.partnerId), 'ko'));

  const today = todayKST();
  const rows = [];
  let okCount = 0;
  let missingCount = 0;
  dates.forEach(date => {
    partners.forEach(partner => {
      const k = `${partner.partnerId}|${date}`;
      const bizCount = Number(bizMap.get(k) || 0);
      const appliedCount = Number(appliedMap.get(k) || 0);
      const rowCount = appliedCount || bizCount;
      let status = 'missing';
      let statusLabel = '미수집';
      if (rowCount > 0) {
        status = 'ok';
        statusLabel = appliedCount > 0 ? '반영완료' : '수집완료(미저장)';
        okCount += 1;
      } else if (date > today) {
        status = 'pending';
        statusLabel = '예정';
      } else {
        missingCount += 1;
      }
      rows.push({
        date,
        partnerId: partner.partnerId,
        partnerName: partner.partnerName,
        regionName: partner.regionName,
        displayName: partner.displayName || partner.partnerName || partner.partnerId,
        bizCount,
        appliedCount,
        rowCount,
        status,
        statusLabel
      });
    });
  });

  return {
    ok: true,
    menu,
    weekStart: fromDate,
    weekEnd: toDate,
    fromDate,
    toDate,
    partnerCount: partners.length,
    dateCount: dates.length,
    okCount,
    missingCount,
    partners,
    dates,
    rows
  };
}

module.exports = {
  getBizCollectTableStatus,
  getApiRegistry,
  saveApiRegistry,
  collectSource,
  runFullCollectPipeline,
  saveCollectRun,
  getLatestMenuCollectStatus,
  getCollectItemsForAdmin,
  getPartnerListForAdmin,
  getViewBundleForAdmin,
  getViewFullBundleForAdmin,
  getRiderHistoryRangeForAdmin,
  getDailyHistoryRangeForAdmin,
  getHistoryCollectCoverageForAdmin,
  analyzePartnerContamination,
  scrubCrossPartnerDuplicates,
  purgeBizCollectDate,
  readAppliedBaeminDelivery,
  applyBaeminDelivery,
  getBaeminStorageDiagnosticsForAdmin,
  replaceLiveAcceptRatesForAdmin,
  rebuildLiveAcceptRatesForAppliedWeek,
  BAEMIN_APPLIED_SETTINGS_KEY
};

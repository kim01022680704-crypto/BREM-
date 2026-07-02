const { getServiceClient } = require('./admin-bootstrap');
const {
  listCollectSources,
  getCollectSource,
  mapItemToCollectRow,
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
const { computeCollectDateRange, computeHistoryCollectRange, buildMenuDateRanges, resolveHistoryMenuQueryDates, addDays, todayKST } = require('./baemin-settlement-week');
const { saveStatsForSource } = require('./baemin-stats-save');
const { sumStats, extractStatsFromItem, pickAcceptance, serviceBreakdownFromStats, computeItemsMetricTotals } = require('./baemin-stats-extract');
const { discoverApiUrlViaPage } = require('./baemin-page-capture');
const { buildCenterQueryParams, buildCenterFetchHeaders } = require('./baemin-center-context');

function getBaeminSession() {
  return require('./baemin-delivery-session');
}

async function readSettingsValue(key) {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message || '설정을 불러오지 못했습니다.');
  return data?.value ?? null;
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
    const key = userId || String(item?.phoneNumber || item?.phone || item?.name || index);
    if (!map.has(key)) {
      map.set(key, {
        userId,
        name: item?.name || item?.riderName || '',
        phoneNumber: item?.phoneNumber || item?.phone || '',
        deliveryAcceptanceCount: {},
        deliveryPeakTimeCount: { morning: 0, afternoon: 0, evening: 0, midnight: 0 },
        deliveryCount: 0,
        sourceUrl
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
  });
  return Array.from(map.values()).map((item, index) => mapItemToCollectRow(
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
      dateRange: options?.dateRange || null,
      historyQueryDates: options?.historyQueryDates || options?.dateRange || null
    }
  ));
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
    const partnerId = menuRows[0]?.partner_id
      || menuRows[0]?.parsed_json?.partnerId
      || 'unknown';
    const partnerName = menuRows[0]?.parsed_json?.partnerName
      || menuRows[0]?.partner_name
      || '';
    const sampleKeys = menuRows.slice(0, 3).map(row => row.dedupe_key).join(', ');
    console.log(`[BREM][save] menu_type=${menuType} partner_id=${partnerId} partner_name=${partnerName || '-'} rows=${menuRows.length} dedupe_sample=${sampleKeys}`);

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

    await pruneStaleRiderDuplicates(menuType, payload);
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

function buildFetchedFromSpaCapture(capture, endpointInfo = {}) {
  if (!capture?.spaPayload || typeof capture.spaPayload !== 'object') return null;
  const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');
  const items = capture.spaItems || extractDataArray(capture.spaPayload) || [];
  const totalPage = Number(capture.spaTotalPage || readTotalPages(capture.spaPayload) || 1);
  const sourceUrl = capture.sampleUrl || endpointInfo.sampleUrl || '';

  if (!items.length) {
    console.log(`[BREM][collect] spa-capture skip (0 rows) — API pagination fallback url=${sourceUrl}`);
    return null;
  }
  if (totalPage > 1) {
    console.log(`[BREM][collect] spa-capture skip (totalPage=${totalPage}) — full pagination via API url=${sourceUrl}`);
    return null;
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
    : [activeDateRange?.toDate || collectDate];
  const merged = [];
  let lastUrl = '';
  const dayConcurrency = 4;

  async function fetchOneDay(day) {
    const dayRange = {
      ...(activeDateRange || {}),
      fromDate: day,
      toDate: day,
      dates: [day],
      dayCount: 1
    };
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
    console.log(`[BREM][collect] ${sourceId} day=${day} rows=${(dayResult.items || []).length}`);
    return {
      items: dayResult.items || [],
      sourceUrl: dayResult.meta?.sourceUrl || ''
    };
  }

  for (let offset = 0; offset < dates.length; offset += dayConcurrency) {
    const batch = dates.slice(offset, offset + dayConcurrency);
    const batchResults = await Promise.all(batch.map(day => fetchOneDay(day)));
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

function shouldAggregateRiderFromDaily(sourceId, registry) {
  if (sourceId !== 'rider_history') return false;
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
  const prefix = String(partnerId || '').trim() ? `${String(partnerId).trim()}:` : '';
  if (sourceId === 'delivery_status') {
    return prefix + rows.slice(0, 8).map(row => {
      const acceptance = row?.deliveryAcceptanceCount || {};
      const complete = acceptance.totalComplete ?? row.totalComplete ?? row.completeCount ?? 0;
      return `${row.userId || row.riderId || row.name || row.phoneNumber || ''}:${complete}`;
    }).join('|');
  }
  if (sourceId === 'daily_history') {
    return prefix + rows.slice(0, 5).map(row =>
      `${row.businessDay || row.deliveryDate || row.date}:${row.totalComplete ?? row.completeCount ?? row.deliveryCount ?? 0}`
    ).join('|');
  }
  if (sourceId === 'rider_history') {
    return prefix + rows.slice(0, 8).map(row => {
      const acceptance = row?.deliveryAcceptanceCount || {};
      const complete = acceptance.totalComplete ?? row.totalComplete ?? row.completeCount ?? 0;
      return `${row.userId || row.riderId || row.name || row.phoneNumber || ''}:${complete}`;
    }).join('|');
  }
  return prefix;
}

function isPartnerSessionMismatchResult(result) {
  const message = String(result?.message || result?.error || '');
  return /세션 미반영|동일 fingerprint|협력사 전환 후 동일|협력사 전환 실패/i.test(message);
}

function shouldBlockCrossPartnerFingerprint(sourceId, itemFingerprint, context = {}) {
  if (sourceId !== 'delivery_status') return false;
  if (!itemFingerprint || Number(context.partnerCollectIndex || 0) <= 0) return false;
  const referenceFp = String(context.lastPartnerMenuFingerprints?.[sourceId] || '').trim();
  return Boolean(referenceFp && referenceFp === itemFingerprint);
}

async function collectSource(sourceId, sessionCookie, collectDate, registry = {}, context = {}) {
  const source = getCollectSource(sourceId);
  const collectedAt = new Date().toISOString();
  if (!source) {
    return { ok: false, sourceMenu: sourceId, message: '알 수 없는 수집 소스' };
  }

  const menuDateRanges = context.menuDateRanges || {};
  const dateRangeLabel = menuDateRanges[sourceId]?.label
    || (source.dateQueryKeys?.length && context.historyDateRange
      ? `${context.historyDateRange.fromDate} ~ ${context.historyDateRange.toDate}`
      : '오늘 기준');
  console.log(`[BREM][collect] ${source.label}(${sourceId}): ${dateRangeLabel}`);

  let activeDateRange = source.dateQueryKeys?.length
    ? resolveHistoryMenuQueryDates(collectDate, context.shrunkHistoryToDate
      ? { toDate: context.shrunkHistoryToDate }
      : context.historyDateRange || null)
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

  if (shouldAggregateRiderFromDaily(sourceId, registry)) {
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
    const prepRange = source.dateQueryKeys?.length ? activeDateRange : null;
    const existingCapture = context.spaCapture?.[sourceId];
    const hasUsableCapture = Boolean(
      existingCapture?.spaPayload
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
  if (context.playwrightPage && activeDateRange && source.dateQueryKeys?.length) {
    endpoint = applyCaptureToEndpointRegistry(sourceId, registry, cachedCapture)
      || await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, activeDateRange, context.playwrightContext, collectDate, cachedCapture)
      || endpoint;
  } else if (!endpoint?.apiPath && context.playwrightPage && activeDateRange) {
    endpoint = applyCaptureToEndpointRegistry(sourceId, registry, cachedCapture)
      || await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, activeDateRange, context.playwrightContext, collectDate, cachedCapture)
      || endpoint;
  }

  if (!endpoint?.apiPath) {
    return { ok: false, sourceMenu: sourceId, label: source.label, message: `${source.label} API 경로 없음` };
  }

  console.log(`[BREM][collect] ${sourceId} start collectDate=${collectDate} range=${activeDateRange?.fromDate || collectDate}~${activeDateRange?.toDate || collectDate} api=${endpoint.apiOrigin}${endpoint.apiPath}${endpoint.sampleUrl ? ' (sampleUrl)' : ''}`);

  async function tryFetch(endpointInfo, dateRange = activeDateRange) {
    const useBrowserSession = shouldUseBrowserSessionForCollect(context);
    const baseQuery = mergeCenterQuery(
      buildDefaultQuery(sourceId, collectDate, dateRange),
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
    if (useBrowserSession) {
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
  if (source.dateQueryKeys?.length && activeDateRange?.dayCount > 1) {
    console.log(`[BREM][collect] ${sourceId} per-day mode ${activeDateRange.fromDate}~${activeDateRange.toDate} (${activeDateRange.dayCount}일)`);
    const byDayFirst = await fetchHistoryByDays({
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
    if (byDayFirst?.items?.length) fetched = byDayFirst;
  }

  if (!fetched?.ok) {
    fetched = buildFetchedFromSpaCapture(context.spaCapture?.[sourceId], endpoint)
      || buildFetchedFromSpaCapture(registry.endpoints?.[sourceId], endpoint);
  }
  if (!fetched?.ok) {
    fetched = await tryFetch(endpoint);
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
  if (!fetched.ok && (fetched.status === 404 || fetched.status === 400) && source.dateQueryKeys?.length) {
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
    source.dateQueryKeys?.length
    && fetched.ok
    && !(fetched.items || []).length
  ) {
    console.warn(`[BREM][collect] ${sourceId} range empty — per-day fallback ${activeDateRange?.fromDate}~${activeDateRange?.toDate}`);
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
      dateRange: activeDateRange || context.dateRange || null,
      historyQueryDates: activeDateRange || null,
      dayDate: activeDateRange?.dates?.[index]
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

    if (pipelineContext.playwrightPage && !pipelineContext.playwrightPage.isClosed?.() && sourceDef.id === 'delivery_status') {
      const cached = pipelineContext.spaCapture?.delivery_status
        || pipelineContext.playwrightPage.context()?.__bremCapturedApiRequests?.delivery_status;
      if (cached) {
        applyCaptureToEndpointRegistry(sourceDef.id, registry, cached);
        pipelineContext.spaCapture = pipelineContext.spaCapture || {};
        pipelineContext.spaCapture.delivery_status = cached;
      }
    } else if (pipelineContext.playwrightPage && !pipelineContext.playwrightPage.isClosed?.() && sourceDef.id !== 'delivery_status') {
      const { ensureMenuPartnerReady } = require('./baemin-center-context');
      const menuRange = sourceDef.dateQueryKeys?.length ? historyDateRange : null;
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
  const historyDateRange = options.dateRange || computeHistoryCollectRange(collectDate);
  const menuDateRanges = options.menuDateRanges || buildMenuDateRanges(collectDate);
  const dateRange = historyDateRange;
  const source = String(options.source || 'local_scheduler').trim();
  const runId = options.runId || createCollectRunId();
  const playwrightContext = options.playwrightContext || null;
  const playwrightPage = options.playwrightPage || null;
  const results = {};
  const partnerSummaries = [];
  const collectedAt = new Date().toISOString();
  const sourceDefs = listCollectSources();
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
  console.log(`[BREM][collect] 일별 배달내역: ${menuDateRanges.daily_history.label} (정산주 수요일~어제)`);
  console.log(`[BREM][collect] 라이더별 배달내역: ${menuDateRanges.rider_history.label} (정산주 수요일~어제)`);

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

      console.log(`[BREM][collect] ${label} — 배달현황 수집 시작`);

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

      const orderedPartners = partnersToCollect.slice();
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
      message: sessionExpired
        ? '배민 재로그인 필요'
        : (anySuccess
          ? `수집 완료 — 협력사 ${partnerSummaries.length || 1}곳 · 배달현황: 오늘 · 일별/라이더: ${historyDateRange.fromDate}~${historyDateRange.toDate} · 저장 ${savedTotal}건${scrubResult?.deletedCount ? ` · 중복 정리 ${scrubResult.deletedCount}건` : ''}`
          : (playwrightPage ? 'API 수집 실패 (브라우저 로그인은 유지 중)' : '수집 실패'))
    };
  } finally {
    detachCenterRoute();
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
  const menuDateRanges = buildMenuDateRanges(collectDate || new Date().toISOString().slice(0, 10));
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

const BAEMIN_APPLIED_SETTINGS_KEY = 'brem_baemin_delivery_applied';

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

async function applyBaeminDelivery(collectDate, options = {}) {
  const date = String(collectDate || '').slice(0, 10);
  if (!date) {
    return { ok: false, status: 400, error: 'INVALID_DATE', message: '적용할 수집 날짜가 없습니다.' };
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { data: sourceRows, error: sourceError } = await supabase
    .from('baemin_biz_collect_items')
    .select('collect_date, collected_at, source_menu, source_url, dedupe_key, rider_name, rider_user_id, phone_number, parsed_json, raw_json')
    .eq('collect_date', date);

  if (sourceError) {
    if (isMissingBizCollectTableError(sourceError)) {
      return { ok: false, tableMissing: true, message: 'baemin_biz_collect_items 테이블이 없습니다.' };
    }
    return { ok: false, error: sourceError.message || '조회 실패' };
  }

  const rows = normalizeCollectRowsPartnerIdentity(sourceRows || []);
  if (!rows.length) {
    return {
      ok: false,
      status: 400,
      error: 'NO_COLLECT_DATA',
      message: `${date} 수집 데이터가 없습니다. [배민 전체 데이터 수집] 후 미리보기를 확인하고 다시 적용하세요.`
    };
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
    parsed_json: row.parsed_json || {},
    raw_json: row.raw_json || {}
  }));

  const chunkSize = 100;
  for (let i = 0; i < mapped.length; i += chunkSize) {
    const chunk = mapped.slice(i, i + chunkSize);
    const { error: insertError } = await supabase
      .from('baemin_delivery_applied_items')
      .insert(chunk);
    if (insertError) {
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
    await supabase.from('baemin_delivery_applied_batches').delete().eq('id', previous.batchId);
  }

  const payload = {
    batchId,
    collectDate: date,
    appliedAt,
    collectedAt: collectedAt || null,
    savedCount: rows.length,
    appliedBy
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
  const applied = await readAppliedBaeminDelivery();
  return applied?.batchId || '';
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
  const pid = normalizeDpPartnerId(parsed.partnerId || row.partner_id, dedupeKey);
  if (!pid) return row;

  parsed.partnerId = pid;
  row.partner_id = pid;
  row.parsed_json = parsed;

  if (dedupeKey && !dedupeKey.toUpperCase().startsWith(`${pid}:`)) {
    const parts = dedupeKey.split(':');
    const suffix = parts.length > 1 ? parts.slice(1).join(':') : dedupeKey;
    row.dedupe_key = `${pid}:${suffix}`;
  }
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
  let query = supabase
    .from(tableName)
    .select('id, collect_date, collected_at, source_menu, rider_name, rider_user_id, phone_number, parsed_json, raw_json, dedupe_key')
    .order('collected_at', { ascending: false })
    .limit(5000);

  if (appliedOnly) {
    query = query.eq('batch_id', batchId);
  } else {
    query = query.eq('collect_date', date);
  }

  if (menu) query = query.eq('source_menu', menu);
  if (partnerId) {
    query = query.like('dedupe_key', `${String(partnerId).trim().toUpperCase()}:%`);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingBizCollectTableError(error) || isMissingAppliedTableError(error)) {
      return { ok: false, tableMissing: true, message: `${tableName} 테이블이 없습니다.` };
    }
    return { ok: false, error: error.message || '조회 실패' };
  }

  let items = normalizeCollectItemsForAdmin(data || [], menu, partnerId);

  if (appliedOnly) {
    const catalog = await loadPartnerDisplayCatalog();
    const { readPartnerRegionMap } = require('./baemin-partner-region');
    const regionMap = await readPartnerRegionMap();
    items = items.map(row => {
      const parsed = row.parsed_json || {};
      const pid = String(parsed.partnerId || '').trim() || partnerIdFromDedupeKey(row.dedupe_key);
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

  return {
    ok: true,
    collectDate: date,
    sourceMenu: menu,
    partnerId: partnerId || null,
    items,
    count: items.length,
    appliedOnly,
    totals: computeItemsMetricTotals(items)
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
    items = items.filter(row => {
      const parsedId = String(row.parsed_json?.partnerId || '').trim();
      if (parsedId === partnerId) return true;
      return String(row.dedupe_key || '').startsWith(`${partnerId}:`);
    });
  }

  if (sourceMenu === 'rider_history' || sourceMenu === 'delivery_status') {
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

  const [partnersResult, applied] = await Promise.all([
    getPartnerListForAdmin(options.collectDate, {
      appliedOnly: true,
      actorScope: scope,
      weekStart
    }),
    readAppliedBaeminDelivery()
  ]);

  if (!partnersResult.ok) return partnersResult;

  const collectDate = partnersResult.collectDate || applied?.collectDate || '';
  const partnerIds = (partnersResult.partners || [])
    .map(partner => String(partner.partnerId || '').trim().toUpperCase())
    .filter(id => /^DP\d{6,}$/i.test(id));

  const byPartner = {};
  let weekEnd;
  let notApplied = Boolean(partnersResult.notApplied);

  await Promise.all(partnerIds.map(async partnerId => {
    const [deliveryResult, dailyResult, riderResult] = await Promise.all([
      getCollectItemsForAdmin(collectDate, 'delivery_status', {
        appliedOnly: true,
        partnerId,
        skipScopeCheck: true
      }),
      getCollectItemsForAdmin(collectDate, 'daily_history', {
        appliedOnly: true,
        partnerId,
        weekStart,
        skipScopeCheck: true
      }),
      getCollectItemsForAdmin(collectDate, 'rider_history', {
        appliedOnly: true,
        partnerId,
        weekStart,
        skipScopeCheck: true
      })
    ]);

    if (deliveryResult.notApplied) notApplied = true;
    weekEnd = dailyResult.weekEnd || riderResult.weekEnd || weekEnd;

    byPartner[partnerId] = {
      delivery_status: deliveryResult.items || [],
      daily_history: dailyResult.items || [],
      rider_history: riderResult.items || [],
      totals: {
        delivery_status: deliveryResult.totals || computeItemsMetricTotals(deliveryResult.items || []),
        daily_history: dailyResult.totals || computeItemsMetricTotals(dailyResult.items || []),
        rider_history: riderResult.totals || computeItemsMetricTotals(riderResult.items || [])
      },
      meta: {
        captureDate: collectDate,
        weekStart: dailyResult.weekStart || riderResult.weekStart || weekStart || undefined,
        weekEnd: dailyResult.weekEnd || riderResult.weekEnd || undefined,
        notApplied: Boolean(deliveryResult.notApplied)
      }
    };
  }));

  return {
    ok: true,
    collectDate,
    weekStart: weekStart || undefined,
    weekEnd,
    partners: partnersResult.partners || [],
    count: partnerIds.length,
    applied: applied || null,
    notApplied,
    byPartner
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
  analyzePartnerContamination,
  scrubCrossPartnerDuplicates,
  purgeBizCollectDate,
  readAppliedBaeminDelivery,
  applyBaeminDelivery,
  BAEMIN_APPLIED_SETTINGS_KEY
};

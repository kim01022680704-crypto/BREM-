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
  isDistinctRiderHistoryEndpoint
} = require('./baemin-collect-sources');
const { fetchPaginatedApi } = require('./baemin-api-fetch');
const { createCollectRunId } = require('./baemin-raw-api-logs');
const { computeCollectDateRange, computeHistoryCollectRange, buildMenuDateRanges, resolveHistoryMenuQueryDates, addDays } = require('./baemin-settlement-week');
const { saveStatsForSource } = require('./baemin-stats-save');
const { sumStats, extractStatsFromItem, pickAcceptance } = require('./baemin-stats-extract');
const { discoverApiUrlViaPage } = require('./baemin-page-capture');
const { buildCenterQueryParams } = require('./baemin-center-context');

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
    row.deliveryAcceptanceCount.totalCancel = num(row.deliveryAcceptanceCount.totalCancel) + acceptance.cancelTotal;
    row.deliveryAcceptanceCount.totalRiderFault = num(row.deliveryAcceptanceCount.totalRiderFault) + acceptance.riderFault;
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

  const deduped = dedupeCollectRows(rows);
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
    const sampleKeys = menuRows.slice(0, 3).map(row => row.dedupe_key).join(', ');
    console.log(`[BREM][save] menu_type=${menuType} partner_id=${partnerId} rows=${menuRows.length} dedupe_sample=${sampleKeys}`);

    const payload = menuRows.map(row => {
      const { record_type, partner_id, ...rest } = row;
      return {
        ...rest,
        parsed_json: {
          ...(rest.parsed_json || {}),
          recordType: menuType,
          menuType,
          partnerId: partner_id || rest.parsed_json?.partnerId || partnerId
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
  }

  return { ok: true, savedCount };
}

async function saveCollectRun(runRow) {
  const supabase = getServiceClient();
  if (!supabase) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  const { error } = await supabase.from('baemin_biz_collect_runs').insert(runRow);
  if (error) return { ok: false, status: 500, error: error.message || String(error) };
  return { ok: true };
}

function mergeCenterQuery(baseQuery, registry = {}) {
  const centerQuery = buildCenterQueryParams(registry.centerContext || {});
  return { ...baseQuery, ...centerQuery };
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

async function discoverAndApplyEndpoint(sourceId, registry, playwrightPage, dateRange, playwrightContext = null, collectDate = null) {
  const discovered = await discoverApiUrlViaPage(playwrightPage, sourceId, dateRange, playwrightContext, collectDate);
  if (!discovered.ok) return null;
  registry.endpoints = registry.endpoints || {};
  registry.endpoints[sourceId] = {
    ...(registry.endpoints[sourceId] || {}),
    sampleUrl: discovered.sampleUrl,
    apiPath: discovered.apiPath,
    apiOrigin: discovered.apiOrigin,
    discoveredAt: new Date().toISOString()
  };
  console.log(`[BREM][collect] ${sourceId} page-capture api=${discovered.sampleUrl}`);
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

  for (const day of dates) {
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
        if (dayResult.ok) {
          endpoint = candidate;
          break;
        }
      }
    }
    if (!dayResult.ok) {
      console.warn(`[BREM][collect] ${sourceId} day=${day} failed status=${dayResult.status} msg=${dayResult.message}`);
      continue;
    }
    merged.push(...(dayResult.items || []));
    lastUrl = dayResult.meta?.sourceUrl || lastUrl;
    console.log(`[BREM][collect] ${sourceId} day=${day} rows=${(dayResult.items || []).length}`);
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
  const riderEndpoint = registry?.endpoints?.rider_history;
  if (riderEndpoint?.fallbackFromDaily) return true;
  if (isDistinctRiderHistoryEndpoint(riderEndpoint, registry?.endpoints?.daily_history)) {
    return false;
  }
  const dailyPath = registry?.endpoints?.daily_history?.apiPath || '/delivery/history';
  const riderPath = riderEndpoint?.apiPath || '/delivery/history';
  return riderPath === dailyPath && !riderEndpoint?.sampleUrl?.includes('userId=');
}

function isSessionAuthFailure(result) {
  return result?.status === 401
    || result?.status === 403
    || result?.message === '배민 로그인 만료'
    || /재로그인|로그인 만료|세션 만료/i.test(String(result?.message || ''));
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
      : null)
    : null;

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
    const rows = aggregateRiderHistoryFromDaily(dailyItems, collectDate, collectedAt, sourceUrl, {
      partnerId,
      collectDate,
      dateRange: activeDateRange || context.dateRange || null,
      historyQueryDates: activeDateRange || null
    });
    const saveResult = await saveCollectItems(rows);
    if (!saveResult.ok) return { ...saveResult, sourceMenu: sourceId, label: source.label };
    return {
      ok: true,
      sourceMenu: sourceId,
      label: source.label,
      savedCount: saveResult.savedCount,
      sourceUrl,
      collectedAt,
      fallback: 'daily_aggregate'
    };
  }

  let endpoint = resolveApiEndpoint(sourceId, registry);

  if (context.playwrightPage) {
    const { preparePageForCollect } = require('./baemin-page-capture');
    const prepRange = source.dateQueryKeys?.length ? activeDateRange : null;
    await preparePageForCollect(
      context.playwrightPage,
      sourceId,
      prepRange || {},
      collectDate
    ).catch(error => {
      console.warn(`[BREM][collect] ${sourceId} page prep failed:`, error.message);
    });
  }

  if (context.playwrightPage && activeDateRange && source.dateQueryKeys?.length) {
    endpoint = await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, activeDateRange, context.playwrightContext, collectDate)
      || endpoint;
  } else if (!endpoint?.apiPath && context.playwrightPage && activeDateRange) {
    endpoint = await discoverAndApplyEndpoint(sourceId, registry, context.playwrightPage, activeDateRange, context.playwrightContext, collectDate)
      || endpoint;
  }

  if (!endpoint?.apiPath) {
    return { ok: false, sourceMenu: sourceId, label: source.label, message: `${source.label} API 경로 없음` };
  }

  console.log(`[BREM][collect] ${sourceId} start collectDate=${collectDate} range=${activeDateRange?.fromDate || collectDate}~${activeDateRange?.toDate || collectDate} api=${endpoint.apiOrigin}${endpoint.apiPath}${endpoint.sampleUrl ? ' (sampleUrl)' : ''}`);

  async function tryFetch(endpointInfo, dateRange = activeDateRange) {
    const { buildCenterFetchHeaders } = require('./baemin-center-context');
    const baseQuery = mergeCenterQuery(
      buildDefaultQuery(sourceId, collectDate, dateRange),
      registry
    );
    return fetchPaginatedApi({
      apiOrigin: endpointInfo.apiOrigin,
      apiPath: endpointInfo.apiPath,
      sampleUrl: endpointInfo.sampleUrl,
      sampleHeaders: buildCenterFetchHeaders(registry.centerContext || {}),
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

  let fetched = await tryFetch(endpoint);
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

  const items = fetched.items || [];
  if (!items.length) {
    return {
      ok: false,
      sourceMenu: sourceId,
      label: source.label,
      message: '수집 데이터 0건',
      sourceUrl: fetched.meta?.sourceUrl || ''
    };
  }

  const partnerId = String(registry.centerContext?.partnerId || registry.centerContext?.centerId || '').trim();
  const rows = items.map((item, index) => mapItemToCollectRow(
    sourceId,
    item,
    collectDate,
    fetched.meta?.sourceUrl || '',
    collectedAt,
    {
      partnerId,
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
    meta: fetched.meta,
    totals
  };
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
  const collectedAt = new Date().toISOString();

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
    shrunkHistoryToDate: null
  };
  let detachCenterRoute = () => {};

  console.log(`[BREM][collect] 배달현황: 오늘 기준 (${collectDate})`);
  console.log(`[BREM][collect] 일별 배달내역: ${menuDateRanges.daily_history.label}`);
  console.log(`[BREM][collect] 라이더별 배달내역: ${menuDateRanges.rider_history.label}`);

  if (playwrightContext) {
    playwrightContext.__bremCollecting = true;
  }

  if (playwrightPage) {
    try {
      const { ensureSafeBrowserTab, preparePageForCollect } = require('./baemin-page-capture');
      const { resolveCenterContextViaPage, buildCenterFetchHeaders } = require('./baemin-center-context');
      const { attachCenterApiRoute } = require('./baemin-playwright-route');
      await ensureSafeBrowserTab(playwrightPage);
      await preparePageForCollect(playwrightPage, 'delivery_status', {});
      if (!registry.centerContext?.partnerId) {
        const center = await resolveCenterContextViaPage(playwrightPage);
        if (center?.centerId || center?.managementId || center?.partnerId) {
          registry.centerContext = {
            centerId: center.centerId,
            managementId: center.managementId,
            partnerId: center.partnerId,
            resolvedAt: new Date().toISOString()
          };
        }
      }
      const center = registry.centerContext || {};
      if (center?.centerId || center?.managementId || center?.partnerId) {
        console.log(`[BREM][collect] center context centerId=${center.centerId} managementId=${center.managementId} partnerId=${center.partnerId}`);

        const discoveredHeaders = {
          ...buildCenterFetchHeaders(center),
          ...(registry.endpoints?.delivery_status?.sampleHeaders || {}),
          ...(registry.endpoints?.daily_history?.sampleHeaders || {})
        };
        detachCenterRoute = attachCenterApiRoute(playwrightPage.context(), {
          centerContext: center,
          discoveredHeaders
        });
      } else {
        console.warn('[BREM][collect] center context empty — /v2/center 응답 확인 필요');
      }
    } catch (error) {
      console.warn('[BREM][collect] center context resolve failed:', error.message);
    }
  }

  try {
    let anySuccess = false;
    let sessionExpired = false;
    let authFailureCount = 0;
    const sourceDefs = listCollectSources();

    function isAuthFailure(result) {
      return result.status === 401
        || result.status === 403
        || result.message === '배민 로그인 만료';
    }

    for (const sourceDef of sourceDefs) {
      const result = await collectSource(sourceDef.id, cookie, collectDate, registry, pipelineContext);
      results[sourceDef.id] = {
        ...result,
        dateRangeLabel: menuDateRanges[sourceDef.id]?.label
          || (sourceDef.dateQueryKeys?.length ? menuDateRanges.daily_history.label : '오늘 기준')
      };

      if (sourceDef.id === 'daily_history' && result.ok) {
        pipelineContext.dailyItems = result.rawItems || [];
        pipelineContext.dailySourceUrl = result.sourceUrl || '';
        const riderEp = registry.endpoints?.rider_history;
        const dailyEp = registry.endpoints?.daily_history;
        const riderHasOwnApi = isDistinctRiderHistoryEndpoint(riderEp, dailyEp);
        if (!riderHasOwnApi) {
          registry.endpoints.rider_history = {
            ...(riderEp || {}),
            fallbackFromDaily: true
          };
          console.log('[BREM][collect] rider_history → daily_history 집계 fallback 활성');
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
        meta_json: { source, fallback: result.fallback || null }
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

    if (anySuccess && !sessionExpired) {
      await getBaeminSession().markSessionValidated();
    }

    await saveApiRegistry(registry).catch(error => {
      console.warn('[BREM][collect] registry 저장 실패:', error.message);
    });

    const savedTotal = Object.values(results).reduce((sum, row) => sum + Number(row.savedCount || 0), 0);
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
      sessionExpired,
      message: sessionExpired
        ? '배민 재로그인 필요'
        : (anySuccess
          ? `수집 완료 — 배달현황: 오늘 기준 · 일별/라이더: ${historyDateRange.fromDate}~${historyDateRange.toDate} · 저장 ${savedTotal}건`
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

async function getCollectItemsForAdmin(collectDate, sourceMenu) {
  const supabase = getServiceClient();
  const date = String(collectDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const menu = String(sourceMenu || '').trim();

  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  let query = supabase
    .from('baemin_biz_collect_items')
    .select('id, collect_date, collected_at, source_menu, rider_name, rider_user_id, phone_number, parsed_json, raw_json')
    .eq('collect_date', date)
    .order('rider_name', { ascending: true })
    .limit(5000);

  if (menu) query = query.eq('source_menu', menu);

  const { data, error } = await query;
  if (error) {
    if (isMissingBizCollectTableError(error)) {
      return { ok: false, tableMissing: true, message: 'baemin_biz_collect_items 테이블이 없습니다.' };
    }
    return { ok: false, error: error.message || '조회 실패' };
  }

  return {
    ok: true,
    collectDate: date,
    sourceMenu: menu,
    items: data || [],
    count: (data || []).length
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
  getCollectItemsForAdmin
};

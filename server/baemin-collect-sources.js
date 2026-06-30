const { pickAcceptance } = require('./baemin-stats-extract');
const BAEMIN_ORIGIN = 'https://deliverycenter.baemin.com';
const BAEMIN_API_ORIGIN = 'https://api-deliverycenter.baemin.com';
const API_REGISTRY_KEY = 'brem_baemin_api_registry';

/** URL/API 패턴 기준 — 메뉴명 문자열 의존 없음 */
const COLLECT_SOURCES = {
  delivery_status: {
    id: 'delivery_status',
    label: '배달현황',
    apiOrigin: BAEMIN_API_ORIGIN,
    apiPath: '/v4/management/delivery-status',
    defaultQuery: {
      orderName: 'name',
      orderBy: 'asc',
      name: '',
      userId: '',
      phoneNumber: '',
      riderStatus: ''
    },
    pagePathPatterns: [
      /\/delivery-status/i
    ],
    apiUrlPatterns: [
      /\/delivery-status(?:\?|$)/i
    ],
    pagination: { style: 'totalPage', dataKey: 'data', defaultSize: 100 },
    dedupeFields: ['userId', 'phoneNumber']
  },
  daily_history: {
    id: 'daily_history',
    label: '일별 배달내역',
    apiOrigin: BAEMIN_API_ORIGIN,
    apiPath: '/v4/management/daily-delivery-status',
    fallbackApiPaths: [
      '/v4/management/delivery/history',
      '/v4/management/delivery-history',
      '/v4/management/delivery/delivery-history',
      '/v2/delivery/history'
    ],
    pagePathPatterns: [
      /\/delivery\/delivery-history/i
    ],
    apiUrlPatterns: [
      /\/daily-delivery-status(?:\?|$)/i,
      /\/delivery-history(?:\?|$)/i,
      /\/delivery\/delivery-history(?:\?|$)/i
    ],
    pagination: { style: 'totalPage', dataKey: 'data', defaultSize: 100, pageStart: 0 },
    dateQueryKeys: ['fromDate', 'toDate'],
    dedupeFields: ['deliveryDate', 'date', 'deliveryId', 'orderId', 'id']
  },
  rider_history: {
    id: 'rider_history',
    label: '라이더별 배달내역',
    apiOrigin: BAEMIN_API_ORIGIN,
    apiPath: '/v4/management/rider-delivery-status',
    fallbackApiPaths: [
      '/v4/management/delivery/rider-history',
      '/v4/management/rider-history',
      '/v2/delivery/rider-history'
    ],
    pagePathPatterns: [
      /\/delivery\/rider-history/i
    ],
    apiUrlPatterns: [
      /\/rider-delivery-status(?:\?|$)/i,
      /\/rider-history(?:\?|$)/i,
      /\/delivery\/rider-history(?:\?|$)/i
    ],
    pagination: { style: 'totalPage', dataKey: 'data', defaultSize: 100, pageStart: 0 },
    dateQueryKeys: ['fromDate', 'toDate'],
    riderQueryKeys: ['userId', 'riderId'],
    dedupeFields: ['userId', 'riderId', 'deliveryId', 'orderId', 'id']
  }
};

function listCollectSources() {
  return Object.values(COLLECT_SOURCES);
}

function getCollectSource(id) {
  return COLLECT_SOURCES[String(id || '').trim()] || null;
}

function classifyApiUrl(url) {
  const text = String(url || '');
  if (!text.includes('baemin.com')) return null;
  if (/\/daily-delivery-status/i.test(text)) return 'daily_history';
  if (/\/rider-delivery-status/i.test(text)) return 'rider_history';
  if (/\/rider-history/i.test(text)) return 'rider_history';
  if (/\/delivery-history/i.test(text) || /\/delivery\/delivery-history/i.test(text)) return 'daily_history';
  if (text.includes('api-deliverycenter') && /fromDate=/i.test(text) && !/delivery-status/i.test(text)) {
    if (/rider/i.test(text)) return 'rider_history';
    return 'daily_history';
  }
  for (const source of listCollectSources()) {
    if (source.apiUrlPatterns.some(pattern => pattern.test(text))) {
      return source.id;
    }
  }
  if (/\/v4\/management\/delivery-status/i.test(text)) return 'delivery_status';
  if (/\/v4\/management\/delivery-history/i.test(text)) return 'daily_history';
  if (/\/v4\/management\/delivery\/delivery-history/i.test(text)) return 'daily_history';
  if (/\/delivery-status/i.test(text)) return 'delivery_status';
  if (/\/delivery\/history/i.test(text)) return 'daily_history';
  return null;
}

function classifyPageUrl(url) {
  const text = String(url || '');
  if (!text.includes('deliverycenter.baemin.com')) return null;
  if (/\/delivery\/rider-history/i.test(text)) return 'rider_history';
  if (/\/delivery\/delivery-history/i.test(text)) return 'daily_history';
  if (/\/delivery\/history/i.test(text) && /orderName=/i.test(text)) return 'delivery_status';
  if (/\/delivery\/history(?:\?|$)/i.test(text) && !/fromDate=/i.test(text)) return 'delivery_status';
  for (const source of listCollectSources()) {
    if (source.pagePathPatterns.some(pattern => pattern.test(text))) {
      return source.id;
    }
  }
  return null;
}

function buildApiUrl(sourceId, query = {}) {
  const source = getCollectSource(sourceId);
  if (!source) return null;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value == null || value === '') return;
    params.set(key, String(value));
  });
  const qs = params.toString();
  return `${BAEMIN_ORIGIN}${source.apiPath}${qs ? `?${qs}` : ''}`;
}

function buildDefaultQuery(sourceId, collectDate, dateRange = null) {
  const source = getCollectSource(sourceId);
  if (!source) return {};
  const query = { ...(source.defaultQuery || {}) };
  if (source.dateQueryKeys?.length) {
    const { resolveHistoryMenuQueryDates } = require('./baemin-settlement-week');
    const history = resolveHistoryMenuQueryDates(collectDate, dateRange);
    query.fromDate = history.fromDate;
    query.toDate = history.toDate;
  }
  return query;
}

function isValidApiSampleUrl(url) {
  const text = String(url || '');
  if (!text.includes('baemin.com')) return false;
  if (/\/delivery\/(?:delivery-history|rider-history)/i.test(text)) return false;
  if (text.includes('api-deliverycenter.baemin.com')) return true;
  try {
    const path = new URL(text).pathname;
    return path === '/delivery-status' || path.startsWith('/v2/') || path.startsWith('/v4/');
  } catch {
    return false;
  }
}

function mergeEndpointWithDefault(sourceId, endpoint = {}) {
  const source = getCollectSource(sourceId);
  if (!source) return { ...endpoint };
  return {
    ...endpoint,
    apiPath: endpoint.apiPath || source.apiPath || '',
    apiOrigin: endpoint.apiOrigin || source.apiOrigin || ''
  };
}

function isDistinctRiderHistoryEndpoint(riderEndpoint = {}, dailyEndpoint = {}) {
  const riderMerged = mergeEndpointWithDefault('rider_history', riderEndpoint);
  const dailyMerged = mergeEndpointWithDefault('daily_history', dailyEndpoint);
  const riderKey = `${riderMerged.sampleUrl || ''}${riderMerged.apiPath || ''}`;
  const dailyKey = `${dailyMerged.sampleUrl || ''}${dailyMerged.apiPath || ''}`;
  if (!riderKey) return false;
  if (riderKey === dailyKey) return false;
  return /rider-delivery-status|rider-history|rider_delivery/i.test(riderKey);
}

function sanitizeApiRegistry(registry = {}) {
  const endpoints = registry.endpoints || {};
  Object.keys(endpoints).forEach(sourceId => {
    const ep = endpoints[sourceId];
    if (!ep) return;
    if (ep.sampleUrl && !isValidApiSampleUrl(ep.sampleUrl)) {
      console.warn(`[BREM][registry] drop invalid sampleUrl (${sourceId}): ${ep.sampleUrl}`);
      ep.sampleUrl = null;
    }
    if (ep.apiPath && String(ep.apiPath).includes('/delivery/') && !String(ep.apiPath).startsWith('/v4/')) {
      const source = getCollectSource(sourceId);
      ep.apiPath = source?.apiPath || ep.apiPath;
      ep.apiOrigin = BAEMIN_API_ORIGIN;
    }
  });
  const riderEp = endpoints.rider_history;
  const dailyEp = endpoints.daily_history;
  if (riderEp && isDistinctRiderHistoryEndpoint(riderEp, dailyEp)) {
    delete riderEp.fallbackFromDaily;
  }
  return registry;
}

function resolveApiEndpoint(sourceId, registry = {}) {
  const source = getCollectSource(sourceId);
  const discovered = registry?.endpoints?.[sourceId];

  if (discovered?.sampleUrl && isValidApiSampleUrl(discovered.sampleUrl)) {
    try {
      const parsed = new URL(discovered.sampleUrl);
      return {
        apiOrigin: parsed.origin,
        apiPath: parsed.pathname,
        sampleUrl: discovered.sampleUrl,
        sampleHeaders: discovered.sampleHeaders || null
      };
    } catch {
      // fall through
    }
  }

  const apiPath = discovered?.apiPath || source?.apiPath || null;
  if (!apiPath) return null;

  const safePath = String(apiPath).includes('/delivery/') && !String(apiPath).startsWith('/v4/')
    ? (source?.apiPath || apiPath)
    : apiPath;

  const apiOrigin = discovered?.apiOrigin
    || source?.apiOrigin
    || (String(safePath).startsWith('/v4/') ? BAEMIN_API_ORIGIN : BAEMIN_ORIGIN);

  return {
    apiOrigin: String(safePath).startsWith('/v4/') ? BAEMIN_API_ORIGIN : apiOrigin,
    apiPath: safePath,
    sampleUrl: null,
    sampleHeaders: discovered?.sampleHeaders || null
  };
}

function extractBusinessDate(item, options = {}) {
  const fields = ['deliveryDate', 'date', 'targetDate', 'businessDate', 'statisticsDate', 'workDate', 'deliveryDay'];
  for (const field of fields) {
    const value = String(item?.[field] ?? '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  if (options.dayDate && /^\d{4}-\d{2}-\d{2}$/.test(String(options.dayDate).slice(0, 10))) {
    return String(options.dayDate).slice(0, 10);
  }
  const dates = options.dateRange?.dates;
  if (Array.isArray(dates) && Number.isFinite(options.index) && dates[options.index]) {
    return dates[options.index];
  }
  return String(options.collectDate || '').slice(0, 10);
}

function buildDedupeKey(sourceId, item, index = 0, options = {}) {
  const partnerId = String(options.partnerId || options.partner_id || 'unknown').trim() || 'unknown';
  const collectDate = String(options.collectDate || '').slice(0, 10);

  if (sourceId === 'delivery_status') {
    const riderId = String(item?.userId || item?.riderId || '').trim();
    const statusCode = String(item?.status?.code ?? item?.statusCode ?? '').trim();
    if (riderId) return `${partnerId}:${collectDate}:${riderId}`;
    const phone = String(item?.phoneNumber || item?.phone || '').trim();
    if (phone) return `${partnerId}:${collectDate}:${phone}`;
    return `${partnerId}:${collectDate}:row-${index}`;
  }

  if (sourceId === 'daily_history') {
    const businessDate = extractBusinessDate(item, options);
    return `${partnerId}:${businessDate}:daily`;
  }

  if (sourceId === 'rider_history') {
    const riderId = String(item?.userId || item?.riderId || '').trim();
    const rangeFrom = options.historyQueryDates?.fromDate || options.dateRange?.fromDate || '';
    const rangeTo = options.historyQueryDates?.toDate || options.dateRange?.toDate || '';
    if (riderId && rangeFrom && rangeTo) {
      return `${partnerId}:${rangeFrom}:${rangeTo}:${riderId}`;
    }
    const businessDate = extractBusinessDate(item, options);
    if (riderId) return `${partnerId}:${businessDate}:${riderId}:rider`;
    const phone = String(item?.phoneNumber || item?.phone || '').trim();
    if (phone) return `${partnerId}:${businessDate}:${phone}:rider`;
    return `${partnerId}:${businessDate}:rider-${index}`;
  }

  const source = getCollectSource(sourceId);
  const fields = source?.dedupeFields || ['id'];
  for (const field of fields) {
    const value = String(item?.[field] ?? '').trim();
    if (value) return `${partnerId}:${sourceId}:${value}`;
  }
  return `${partnerId}:${sourceId}:row-${index}`;
}

function mapItemToCollectRow(sourceId, item, collectDate, sourceUrl, collectedAt, options = {}) {
  const acceptance = pickAcceptance(item);
  const peak = item?.deliveryPeakTimeCount || {};
  const partnerId = String(options.partnerId || options.partner_id || '').trim();
  const partnerName = String(options.partnerName || options.partner_name || '').trim();
  const regionName = String(options.regionName || options.region_name || '').trim();
  const index = Number.isFinite(options.index) ? options.index : 0;
  const businessDate = extractBusinessDate(item, { ...options, collectDate });
  const recordType = sourceId;

  return {
    collect_date: collectDate,
    collected_at: collectedAt,
    source_menu: sourceId,
    record_type: recordType,
    partner_id: partnerId,
    source_url: sourceUrl,
    dedupe_key: buildDedupeKey(sourceId, item, index, { ...options, collectDate, partnerId }),
    rider_name: String(item?.name || item?.riderName || '').trim(),
    rider_user_id: String(item?.userId || item?.riderId || '').trim(),
    phone_number: String(item?.phoneNumber || item?.phone || '').trim(),
    parsed_json: {
      recordType,
      menuType: recordType,
      partnerId,
      partnerName,
      regionName,
      businessDate,
      statusCode: String(item?.status?.code ?? item?.statusCode ?? '').trim(),
      statusDesc: String(item?.status?.desc ?? item?.statusDesc ?? '').trim(),
      foodComplete: acceptance.foodComplete,
      bmartComplete: acceptance.bmartComplete,
      storeComplete: acceptance.storeComplete,
      totalComplete: acceptance.completeTotal,
      foodReject: acceptance.foodReject,
      bmartReject: acceptance.bmartReject,
      storeReject: acceptance.storeReject,
      totalReject: acceptance.rejectTotal,
      foodCancel: acceptance.foodCancel,
      bmartCancel: acceptance.bmartCancel,
      storeCancel: acceptance.storeCancel,
      cancelCount: acceptance.cancelTotal,
      foodRiderFault: acceptance.foodRiderFault,
      bmartRiderFault: acceptance.bmartRiderFault,
      storeRiderFault: acceptance.storeRiderFault,
      riderFault: acceptance.riderFault,
      morningCount: Number(peak.morning || 0),
      afternoonCount: Number(peak.afternoon || 0),
      eveningCount: Number(peak.evening || 0),
      midnightCount: Number(peak.midnight || 0),
      hourlyCompleted: Array.isArray(item?.hourlyCompleted) ? item.hourlyCompleted : [],
      deliveryDate: businessDate
    },
    raw_json: item || {}
  };
}

module.exports = {
  BAEMIN_ORIGIN,
  BAEMIN_API_ORIGIN,
  API_REGISTRY_KEY,
  COLLECT_SOURCES,
  listCollectSources,
  getCollectSource,
  classifyApiUrl,
  classifyPageUrl,
  buildApiUrl,
  buildDefaultQuery,
  resolveApiEndpoint,
  isValidApiSampleUrl,
  sanitizeApiRegistry,
  isDistinctRiderHistoryEndpoint,
  mergeEndpointWithDefault,
  extractBusinessDate,
  buildDedupeKey,
  mapItemToCollectRow
};

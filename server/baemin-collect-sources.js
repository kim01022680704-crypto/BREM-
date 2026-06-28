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
      /\/delivery-status/i,
      /\/delivery\/delivery-history/i,
      /\/delivery\/history/i
    ],
    apiUrlPatterns: [
      /\/delivery-status(?:\?|$)/i
    ],
    pagination: { style: 'totalPage', dataKey: 'data', defaultSize: 20 },
    dedupeFields: ['userId', 'phoneNumber']
  },
  daily_history: {
    id: 'daily_history',
    label: '일별 배달내역',
    apiOrigin: BAEMIN_API_ORIGIN,
    apiPath: '/v4/management/delivery-history',
    pagePathPatterns: [
      /\/delivery\/delivery-history/i,
      /\/delivery\/history/i
    ],
    apiUrlPatterns: [
      /\/delivery-history(?:\?|$)/i,
      /\/delivery\/history(?:\?|$)/i,
      /\/delivery\/delivery-history(?:\?|$)/i
    ],
    pagination: { style: 'totalPage', dataKey: 'data', defaultSize: 20 },
    dateQueryKeys: ['fromDate', 'toDate'],
    dedupeFields: ['deliveryId', 'orderId', 'id', 'userId']
  },
  rider_history: {
    id: 'rider_history',
    label: '라이더별 배달내역',
    apiOrigin: BAEMIN_API_ORIGIN,
    apiPath: '/v4/management/delivery-history',
    pagePathPatterns: [
      /\/delivery\/rider/i,
      /\/rider\//i,
      /\/delivery\/delivery-history/i
    ],
    apiUrlPatterns: [
      /\/delivery\/rider/i,
      /\/rider\/.*\/history/i,
      /\/delivery\/history.*userId=/i
    ],
    pagination: { style: 'totalPage', dataKey: 'data', defaultSize: 20 },
    dateQueryKeys: ['fromDate', 'toDate'],
    riderQueryKeys: ['userId', 'riderId'],
    dedupeFields: ['deliveryId', 'orderId', 'id', 'userId']
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

function buildDefaultQuery(sourceId, collectDate) {
  const source = getCollectSource(sourceId);
  if (!source) return {};
  const query = { ...(source.defaultQuery || {}) };
  if (source.dateQueryKeys?.length) {
    query.fromDate = collectDate;
    query.toDate = collectDate;
  }
  return query;
}

function resolveApiEndpoint(sourceId, registry = {}) {
  const source = getCollectSource(sourceId);
  const discovered = registry?.endpoints?.[sourceId];

  if (discovered?.sampleUrl) {
    try {
      const parsed = new URL(discovered.sampleUrl);
      return {
        apiOrigin: parsed.origin,
        apiPath: parsed.pathname
      };
    } catch {
      // fall through
    }
  }

  const apiPath = discovered?.apiPath || source?.apiPath || null;
  if (!apiPath) return null;

  const apiOrigin = discovered?.apiOrigin
    || source?.apiOrigin
    || (String(apiPath).startsWith('/v4/') ? BAEMIN_API_ORIGIN : BAEMIN_ORIGIN);

  return { apiOrigin, apiPath };
}

function buildDedupeKey(sourceId, item, index = 0) {
  const source = getCollectSource(sourceId);
  const fields = source?.dedupeFields || ['id'];
  for (const field of fields) {
    const value = String(item?.[field] ?? '').trim();
    if (value) return `${sourceId}:${value}`;
  }
  const userId = String(item?.userId || '').trim();
  const phone = String(item?.phoneNumber || item?.phone || '').trim();
  const name = String(item?.name || item?.riderName || '').trim();
  const composite = [userId, phone, name].filter(Boolean).join('|');
  if (composite) return `${sourceId}:${composite}`;
  return `${sourceId}:row-${index}`;
}

function mapItemToCollectRow(sourceId, item, collectDate, sourceUrl, collectedAt) {
  const acceptance = item?.deliveryAcceptanceCount || {};
  const peak = item?.deliveryPeakTimeCount || {};
  return {
    collect_date: collectDate,
    collected_at: collectedAt,
    source_menu: sourceId,
    source_url: sourceUrl,
    dedupe_key: buildDedupeKey(sourceId, item),
    rider_name: String(item?.name || item?.riderName || '').trim(),
    rider_user_id: String(item?.userId || item?.riderId || '').trim(),
    phone_number: String(item?.phoneNumber || item?.phone || '').trim(),
    parsed_json: {
      statusCode: String(item?.status?.code ?? item?.statusCode ?? '').trim(),
      statusDesc: String(item?.status?.desc ?? item?.statusDesc ?? '').trim(),
      foodComplete: Number(acceptance.foodComplete || 0),
      bmartComplete: Number(acceptance.bmartComplete || 0),
      storeComplete: Number(acceptance.storeComplete || 0),
      totalComplete: Number(acceptance.totalComplete || 0),
      foodReject: Number(acceptance.foodReject || 0),
      cancelCount: Number(acceptance.cancel || 0),
      riderFault: Number(acceptance.riderFault || 0),
      morningCount: Number(peak.morning || 0),
      afternoonCount: Number(peak.afternoon || 0),
      eveningCount: Number(peak.evening || 0),
      midnightCount: Number(peak.midnight || 0),
      hourlyCompleted: Array.isArray(item?.hourlyCompleted) ? item.hourlyCompleted : [],
      deliveryDate: String(item?.deliveryDate || item?.date || collectDate).slice(0, 10)
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
  buildDedupeKey,
  mapItemToCollectRow
};

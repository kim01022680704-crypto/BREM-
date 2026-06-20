const { getServiceClient } = require('./admin-bootstrap');
const { verifyAdminCaller } = require('./admin-users');

const API_BASE = 'https://deliverycenter.baemin.com/delivery-status';
const DEFAULT_PAGE_SIZE = 20;

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function resolveSessionCookie(options = {}) {
  const fromBody = String(options.sessionCookie || '').trim();
  if (fromBody) return fromBody;
  return String(process.env.BAEMIN_BIZ_SESSION_COOKIE || '').trim();
}

function isPlaywrightFeasibleOnVercel() {
  return {
    supported: false,
    platform: process.env.VERCEL ? 'vercel' : 'node',
    message: 'Vercel Serverless에서는 Playwright 브라우저 바이너리를 실행할 수 없습니다. '
      + 'BAEMIN_BIZ_SESSION_COOKIE 환경변수 또는 로컬 수집 스크립트를 사용하세요.'
  };
}

function isMissingTableError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('could not find the table')
    || (message.includes('relation') && message.includes('baemin_delivery_status') && message.includes('does not exist'));
}

function extractDataArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && payload.payload && Array.isArray(payload.payload.data)) return payload.payload.data;
  return null;
}

function dedupeKeyForItem(item) {
  const userId = String(item?.userId || '').trim();
  if (userId) return userId;
  return String(item?.phoneNumber || '').trim();
}

function mergeDataArrays(items) {
  const map = new Map();
  let skippedNoKey = 0;

  (items || []).forEach(item => {
    const key = dedupeKeyForItem(item);
    if (!key) {
      skippedNoKey += 1;
      return;
    }
    if (!map.has(key)) {
      map.set(key, item);
    }
  });

  return {
    items: Array.from(map.values()),
    duplicateCount: Math.max(0, (items || []).length - map.size - skippedNoKey),
    skippedNoKey
  };
}

function mapItemToRow(item, captureDate) {
  const acceptance = item?.deliveryAcceptanceCount || {};
  const peak = item?.deliveryPeakTimeCount || {};
  const userId = String(item?.userId || '').trim();
  const phoneNumber = String(item?.phoneNumber || '').trim();

  return {
    capture_date: captureDate,
    dedupe_key: dedupeKeyForItem(item),
    rider_name: String(item?.name || '').trim(),
    phone_number: phoneNumber,
    user_id: userId,
    status_code: String(item?.status?.code ?? item?.statusCode ?? '').trim(),
    status_desc: String(item?.status?.desc ?? item?.statusDesc ?? '').trim(),
    food_complete: Number(acceptance.foodComplete || 0),
    bmart_complete: Number(acceptance.bmartComplete || 0),
    store_complete: Number(acceptance.storeComplete || 0),
    total_complete: Number(acceptance.totalComplete || 0),
    food_reject: Number(acceptance.foodReject || 0),
    cancel_count: Number(acceptance.cancel || 0),
    rider_fault: Number(acceptance.riderFault || 0),
    morning_count: Number(peak.morning || 0),
    afternoon_count: Number(peak.afternoon || 0),
    evening_count: Number(peak.evening || 0),
    midnight_count: Number(peak.midnight || 0),
    hourly_completed: Array.isArray(item?.hourlyCompleted) ? item.hourlyCompleted : [],
    raw_json: item || {}
  };
}

function classifyFetchError(status, bodyText) {
  const text = String(bodyText || '').toLowerCase();
  if (status === 401 || status === 403) {
    return '배민 로그인 만료';
  }
  if (status >= 500) {
    return '배민 API 서버 오류';
  }
  if (text.includes('login') || text.includes('signin') || text.includes('<!doctype html')) {
    return '배민 로그인 만료';
  }
  return 'API 호출 실패';
}

async function fetchDeliveryStatusPage(page, size, sessionCookie) {
  const url = `${API_BASE}?page=${page}&size=${size}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Cookie: sessionCookie,
      'User-Agent': 'BREM-Baemin-Collector/1.0'
    },
    redirect: 'manual'
  });

  const bodyText = await response.text();
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload) {
    return {
      ok: false,
      status: response.status,
      error: classifyFetchError(response.status, bodyText),
      message: classifyFetchError(response.status, bodyText)
    };
  }

  if (response.status >= 300 && response.status < 400) {
    return {
      ok: false,
      status: response.status,
      error: '배민 로그인 만료',
      message: '배민 로그인 만료'
    };
  }

  return { ok: true, payload };
}

async function fetchAllDeliveryStatus(sessionCookie, options = {}) {
  const size = Math.min(Math.max(Number(options.size) || DEFAULT_PAGE_SIZE, 1), 100);
  const cookie = String(sessionCookie || '').trim();
  if (!cookie) {
    return {
      ok: false,
      status: 400,
      error: 'SESSION_COOKIE_MISSING',
      message: '배민 세션 쿠키가 없습니다. Vercel 환경변수 BAEMIN_BIZ_SESSION_COOKIE를 설정하거나 수집 시 쿠키를 입력하세요.'
    };
  }

  const first = await fetchDeliveryStatusPage(0, size, cookie);
  if (!first.ok) return first;

  const firstPayload = first.payload;
  const totalPage = Number(firstPayload.totalPage);
  if (!Number.isFinite(totalPage) || totalPage < 1) {
    return {
      ok: false,
      status: 502,
      error: 'TOTAL_PAGE_FAILED',
      message: 'totalPage 확인 실패'
    };
  }

  const merged = [...(firstPayload.data || [])];
  for (let page = 1; page < totalPage; page += 1) {
    const next = await fetchDeliveryStatusPage(page, size, cookie);
    if (!next.ok) {
      return {
        ok: false,
        status: next.status || 502,
        error: next.error || 'API_CALL_FAILED',
        message: next.message || `API 호출 실패 (page=${page})`
      };
    }
    merged.push(...(next.payload?.data || []));
  }

  const deduped = mergeDataArrays(merged);
  return {
    ok: true,
    items: deduped.items,
    meta: {
      page: firstPayload.page,
      size: firstPayload.size,
      total: firstPayload.total,
      totalPage,
      deliveryStatusTotalResponse: firstPayload.deliveryStatusTotalResponse || null,
      rawCount: merged.length,
      duplicateCount: deduped.duplicateCount,
      skippedNoKey: deduped.skippedNoKey
    }
  };
}

async function getTableStatus() {
  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const { count, error } = await supabase
    .from('baemin_delivery_status')
    .select('id', { count: 'exact', head: true });

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: true, tableExists: false, count: 0 };
    }
    return { ok: false, status: 500, error: error.message || '테이블 상태 확인 실패' };
  }

  return { ok: true, tableExists: true, count: count ?? 0 };
}

async function saveRows(accessToken, rows, captureDate) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const tableStatus = await getTableStatus();
  if (!tableStatus.tableExists) {
    return {
      ok: false,
      status: 503,
      error: 'TABLE_MISSING',
      message: 'public.baemin_delivery_status 테이블이 없습니다. supabase/baemin_delivery_status_migration.sql 을 실행하세요.'
    };
  }

  const mapped = (rows || [])
    .map(item => mapItemToRow(item, captureDate))
    .filter(row => row.dedupe_key);

  if (!mapped.length) {
    return {
      ok: false,
      status: 400,
      error: 'NO_ROWS',
      message: '저장할 라이더 데이터가 없습니다.'
    };
  }

  const chunkSize = 100;
  let savedCount = 0;
  for (let i = 0; i < mapped.length; i += chunkSize) {
    const chunk = mapped.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('baemin_delivery_status')
      .upsert(chunk, { onConflict: 'capture_date,dedupe_key' });
    if (error) {
      return {
        ok: false,
        status: 500,
        error: 'SUPABASE_SAVE_FAILED',
        message: `Supabase 저장 실패: ${error.message || error}`
      };
    }
    savedCount += chunk.length;
  }

  const totalCompleteSum = mapped.reduce((sum, row) => sum + Number(row.total_complete || 0), 0);

  return {
    ok: true,
    captureDate,
    totalRiders: mapped.length,
    totalCompleteSum,
    savedCount,
    duplicateExcluded: 0,
    skippedNoKey: 0
  };
}

function buildCollectSummary(fetchResult, saveResult) {
  return {
    ok: true,
    captureDate: saveResult.captureDate,
    totalRiders: fetchResult.meta?.rawCount ?? saveResult.totalRiders,
    uniqueRiders: saveResult.totalRiders,
    totalCompleteSum: saveResult.totalCompleteSum,
    savedCount: saveResult.savedCount,
    duplicateExcluded: fetchResult.meta?.duplicateCount ?? 0,
    skippedNoKey: fetchResult.meta?.skippedNoKey ?? 0,
    totalPage: fetchResult.meta?.totalPage ?? null,
    deliveryStatusTotalResponse: fetchResult.meta?.deliveryStatusTotalResponse ?? null
  };
}

async function collectFromApi(accessToken, options = {}) {
  const cookie = resolveSessionCookie(options);
  const captureDate = String(options.captureDate || todayDateString()).slice(0, 10);

  const fetched = await fetchAllDeliveryStatus(cookie, options);
  if (!fetched.ok) return fetched;

  const saveResult = await saveRows(accessToken, fetched.items, captureDate);
  if (!saveResult.ok) return saveResult;

  return buildCollectSummary(fetched, saveResult);
}

async function importFromJson(accessToken, payload, options = {}) {
  const captureDate = String(options.captureDate || todayDateString()).slice(0, 10);
  const data = extractDataArray(payload);
  if (!data) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_JSON',
      message: 'JSON에서 data 배열을 찾을 수 없습니다. API 응답 전체 또는 data[] 배열을 붙여넣으세요.'
    };
  }

  const deduped = mergeDataArrays(data);
  const saveResult = await saveRows(accessToken, deduped.items, captureDate);
  if (!saveResult.ok) return saveResult;

  return {
    ok: true,
    captureDate: saveResult.captureDate,
    totalRiders: data.length,
    uniqueRiders: saveResult.totalRiders,
    totalCompleteSum: saveResult.totalCompleteSum,
    savedCount: saveResult.savedCount,
    duplicateExcluded: deduped.duplicateCount,
    skippedNoKey: deduped.skippedNoKey,
    source: 'json_import'
  };
}

async function getLatestSummary(accessToken, captureDate) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const supabase = getServiceClient();
  if (!supabase) {
    return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' };
  }

  const date = String(captureDate || todayDateString()).slice(0, 10);
  const { data, error } = await supabase
    .from('baemin_delivery_status')
    .select('total_complete')
    .eq('capture_date', date);

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: true, tableExists: false, captureDate: date, savedCount: 0, totalCompleteSum: 0 };
    }
    return { ok: false, status: 500, error: error.message || '조회 실패' };
  }

  const rows = data || [];
  const totalCompleteSum = rows.reduce((sum, row) => sum + Number(row.total_complete || 0), 0);
  return {
    ok: true,
    tableExists: true,
    captureDate: date,
    savedCount: rows.length,
    totalCompleteSum
  };
}

async function getConfig(accessToken) {
  const caller = await verifyAdminCaller(accessToken);
  if (!caller.ok) return caller;

  const tableStatus = await getTableStatus();
  const cookieConfigured = Boolean(String(process.env.BAEMIN_BIZ_SESSION_COOKIE || '').trim());
  const loginConfigured = Boolean(
    String(process.env.BAEMIN_BIZ_LOGIN_ID || '').trim()
    && String(process.env.BAEMIN_BIZ_LOGIN_PASSWORD || '').trim()
  );

  return {
    ok: true,
    tableExists: tableStatus.tableExists === true,
    cookieConfigured,
    loginConfigured,
    playwright: isPlaywrightFeasibleOnVercel(),
    collectMode: cookieConfigured ? 'env_cookie' : 'manual_cookie_or_json'
  };
}

module.exports = {
  fetchAllDeliveryStatus,
  collectFromApi,
  importFromJson,
  getConfig,
  getTableStatus,
  getLatestSummary,
  mergeDataArrays,
  extractDataArray,
  mapItemToRow,
  resolveSessionCookie,
  isPlaywrightFeasibleOnVercel
};

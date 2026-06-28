const { BAEMIN_ORIGIN } = require('./baemin-collect-sources');
const { extractJsonFromHtml, extractTableRowsFromHtml } = require('./baemin-html-fallback');
const { saveRawApiLog } = require('./baemin-raw-api-logs');

function classifyFetchError(status, bodyText) {
  const text = String(bodyText || '').toLowerCase();
  if (status === 401 || status === 403) return '배민 로그인 만료';
  if (status >= 500) return '배민 API 서버 오류';
  if (text.includes('login') || text.includes('signin') || text.includes('<!doctype html')) return '배민 로그인 만료';
  return 'API 호출 실패';
}

function extractDataArray(payload, dataKey = 'data') {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[dataKey])) return payload[dataKey];
  if (payload?.payload && Array.isArray(payload.payload[dataKey])) return payload.payload[dataKey];
  if (payload?.payload && Array.isArray(payload.payload)) return payload.payload;
  return null;
}

function readTotalPages(payload) {
  const totalPage = Number(payload?.totalPage);
  if (Number.isFinite(totalPage) && totalPage >= 1) return totalPage;
  const totalPages = Number(payload?.totalPages);
  if (Number.isFinite(totalPages) && totalPages >= 1) return totalPages;
  const last = Boolean(payload?.last);
  const number = Number(payload?.number ?? payload?.page ?? 0);
  if (last) return number + 1;
  return null;
}

async function fetchBaeminJson(url, sessionCookie, logContext = null) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Cookie: sessionCookie,
      'User-Agent': 'BREM-Baemin-Collector/2.0',
      Referer: `${BAEMIN_ORIGIN}/`
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

  if (response.status >= 300 && response.status < 400) {
    return {
      ok: false,
      status: response.status,
      bodyText,
      error: '배민 로그인 만료',
      message: '배민 로그인 만료'
    };
  }

  if (!response.ok || !payload) {
    const htmlPayload = extractJsonFromHtml(bodyText);
    if (htmlPayload) {
      return { ok: true, status: response.status, bodyText, payload: htmlPayload, fallback: 'html_json' };
    }

    const tableRows = extractTableRowsFromHtml(bodyText);
    if (tableRows?.length) {
      return {
        ok: true,
        status: response.status,
        bodyText,
        payload: { data: tableRows, totalPage: 1, last: true, number: 0 },
        fallback: 'html_table'
      };
    }

    const message = classifyFetchError(response.status, bodyText);
    return {
      ok: false,
      status: response.status,
      bodyText,
      error: message,
      message
    };
  }

  const baseResult = {
    ok: true,
    status: response.status,
    bodyText,
    payload
  };

  if (logContext) {
    await saveRawApiLog({
      collectDate: logContext.collectDate,
      sourceMenu: logContext.sourceMenu,
      sourceUrl: url,
      httpStatus: response.status,
      runId: logContext.runId,
      pageIndex: logContext.pageIndex,
      rawJson: payload || { bodyPreview: String(bodyText || '').slice(0, 50000) }
    }).catch(() => {});
  }

  return baseResult;
}

async function fetchPaginatedApi({
  apiPath,
  sessionCookie,
  baseQuery = {},
  pagination = {},
  logPrefix = '[BREM][api-fetch]',
  logContext = null
}) {
  const cookie = String(sessionCookie || '').trim();
  if (!cookie) {
    return {
      ok: false,
      status: 400,
      error: 'SESSION_COOKIE_MISSING',
      message: '배민 세션 쿠키가 없습니다.'
    };
  }

  const size = Math.min(Math.max(Number(baseQuery.size || pagination.defaultSize || 20), 1), 100);
  const dataKey = pagination.dataKey || 'data';
  const merged = [];
  let firstPayload = null;
  let lastUrl = '';
  let totalPage = 1;

  for (let page = 0; page < totalPage; page += 1) {
    const params = new URLSearchParams();
    Object.entries(baseQuery).forEach(([key, value]) => {
      if (value == null || value === '') return;
      params.set(key, String(value));
    });
    params.set('page', String(page));
    params.set('size', String(size));
    lastUrl = `${BAEMIN_ORIGIN}${apiPath}?${params.toString()}`;

    console.log(`${logPrefix} GET ${lastUrl}`);
    const result = await fetchBaeminJson(lastUrl, cookie, logContext ? { ...logContext, pageIndex: page } : null);
    if (!result.ok) {
      console.error(`${logPrefix} FAIL status=${result.status} message=${result.message}`);
      console.error(`${logPrefix} response.text():`, String(result.bodyText || '').slice(0, 800));
      return result;
    }

    if (page === 0) {
      firstPayload = result.payload;
      const detected = readTotalPages(result.payload);
      if (!detected) {
        console.error(`${logPrefix} totalPage missing payload keys=${Object.keys(result.payload || {}).join(',')}`);
        return {
          ok: false,
          status: 502,
          error: 'TOTAL_PAGE_FAILED',
          message: 'totalPage 확인 실패',
          bodyText: result.bodyText
        };
      }
      totalPage = detected;
      console.log(`${logPrefix} totalPage=${totalPage}`);
    }

    const rows = extractDataArray(result.payload, dataKey) || [];
    console.log(`${logPrefix} page=${page} rows=${rows.length}`);
    merged.push(...rows);
  }

  return {
    ok: true,
    items: merged,
    meta: {
      totalPage,
      rawCount: merged.length,
      sourceUrl: lastUrl,
      apiPath,
      firstPayloadSummary: {
        total: firstPayload?.total ?? null,
        totalElements: firstPayload?.totalElements ?? null
      }
    }
  };
}

module.exports = {
  fetchBaeminJson,
  fetchPaginatedApi,
  extractDataArray,
  readTotalPages
};

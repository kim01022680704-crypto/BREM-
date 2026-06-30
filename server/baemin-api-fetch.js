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
  const total = Number(payload?.total ?? payload?.totalElements);
  if (Number.isFinite(total) && total === 0) return 1;
  if (Number.isFinite(totalPage) && totalPage === 0) return 1;
  const last = Boolean(payload?.last);
  const number = Number(payload?.number ?? payload?.page ?? 0);
  if (last) return number + 1;
  return null;
}

async function parseBaeminFetchResponse({ url, status, bodyText, logContext = null, via = 'fetch' }) {
  let payload = null;
  try {
    payload = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    payload = null;
  }

  if (status >= 300 && status < 400) {
    return {
      ok: false,
      status,
      bodyText,
      error: '배민 로그인 만료',
      message: '배민 로그인 만료',
      via
    };
  }

  if (status < 200 || status >= 300 || !payload) {
    const htmlPayload = extractJsonFromHtml(bodyText);
    if (htmlPayload) {
      return { ok: true, status, bodyText, payload: htmlPayload, fallback: 'html_json', via };
    }

    const tableRows = extractTableRowsFromHtml(bodyText);
    if (tableRows?.length) {
      return {
        ok: true,
        status,
        bodyText,
        payload: { data: tableRows, totalPage: 1, last: true, number: 0 },
        fallback: 'html_table',
        via
      };
    }

    let apiMessage = '';
    if (payload && typeof payload === 'object') {
      apiMessage = String(payload.message || payload.error || '').trim();
    }
    const message = apiMessage || classifyFetchError(status, bodyText);
    return {
      ok: false,
      status,
      bodyText,
      error: message,
      message,
      via
    };
  }

  const baseResult = {
    ok: true,
    status,
    bodyText,
    payload,
    via
  };

  if (logContext) {
    await saveRawApiLog({
      collectDate: logContext.collectDate,
      sourceMenu: logContext.sourceMenu,
      sourceUrl: url,
      httpStatus: status,
      runId: logContext.runId,
      pageIndex: logContext.pageIndex,
      rawJson: payload || { bodyPreview: String(bodyText || '').slice(0, 50000) }
    }).catch(() => {});
  }

  return baseResult;
}

async function fetchBaeminJson(url, sessionCookie, logContext = null) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Cookie: sessionCookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: `${BAEMIN_ORIGIN}/delivery/history`
    },
    redirect: 'manual'
  });

  const bodyText = await response.text();
  return parseBaeminFetchResponse({
    url,
    status: response.status,
    bodyText,
    logContext,
    via: 'fetch'
  });
}

async function fetchPaginatedApi({
  apiOrigin,
  apiPath,
  sessionCookie,
  baseQuery = {},
  pagination = {},
  logPrefix = '[BREM][api-fetch]',
  logContext = null,
  playwrightPage = null,
  playwrightContext = null,
  sampleUrl = null,
  sampleHeaders = null
}) {
  const { BAEMIN_API_ORIGIN, BAEMIN_ORIGIN } = require('./baemin-collect-sources');
  const { fetchBaeminJsonViaPage, fetchBaeminJsonViaPlaywright } = require('./baemin-playwright-fetch');
  const origin = String(apiOrigin || BAEMIN_API_ORIGIN || BAEMIN_ORIGIN).replace(/\/$/, '');
  const cookie = String(sessionCookie || '').trim();
  if (!cookie && !playwrightContext && !playwrightPage) {
    return {
      ok: false,
      status: 400,
      error: 'SESSION_COOKIE_MISSING',
      message: '배민 세션 쿠키가 없습니다.'
    };
  }

  const size = Math.min(Math.max(Number(baseQuery.size || pagination.defaultSize || 20), 1), 100);
  const pageStart = Number.isFinite(pagination.pageStart) ? pagination.pageStart : 0;
  const dataKey = pagination.dataKey || 'data';
  const parallelBatchSize = Math.min(Math.max(Number(pagination.parallelBatchSize || 4), 1), 6);
  const merged = [];
  let firstPayload = null;
  let lastUrl = '';
  let totalPage = 1;

  function resolveActivePage() {
    if (playwrightPage && !playwrightPage.isClosed()) return playwrightPage;
    if (playwrightContext) {
      try {
        const pages = playwrightContext.pages().filter(page => !page.isClosed());
        return pages[0] || null;
      } catch {
        return null;
      }
    }
    return null;
  }

  function buildPageUrl(page) {
    if (sampleUrl) {
      try {
        const parsed = new URL(sampleUrl);
        parsed.searchParams.set('page', String(page));
        parsed.searchParams.set('size', String(size));
        Object.entries(baseQuery).forEach(([key, value]) => {
          if (value == null) return;
          parsed.searchParams.set(key, String(value));
        });
        return parsed.toString();
      } catch {
        return sampleUrl;
      }
    }
    const params = new URLSearchParams();
    Object.entries(baseQuery).forEach(([key, value]) => {
      if (value == null) return;
      params.set(key, String(value));
    });
    params.set('page', String(page));
    params.set('size', String(size));
    return `${origin}${apiPath}?${params.toString()}`;
  }

  async function fetchPage(pageIndex) {
    const page = pageStart + pageIndex;
    const url = buildPageUrl(page);
    const activePage = resolveActivePage();
    const centerHeaders = sampleHeaders && typeof sampleHeaders === 'object' ? sampleHeaders : null;
    const pageLogContext = logContext ? { ...logContext, pageIndex: page } : null;
    let result = null;
    const via = activePage ? 'browser-tab' : (playwrightContext?.request ? 'playwright-request' : 'fetch');

    console.log(`${logPrefix} GET ${url} (${via})`);

    if (activePage) {
      result = await fetchBaeminJsonViaPage(activePage, url, pageLogContext, centerHeaders);
      if (!result.ok && playwrightContext?.request) {
        result = await fetchBaeminJsonViaPlaywright(playwrightContext, url, pageLogContext, centerHeaders);
      }
    } else if (playwrightContext?.request) {
      result = await fetchBaeminJsonViaPlaywright(playwrightContext, url, pageLogContext, centerHeaders);
    } else {
      result = await fetchBaeminJson(url, cookie, pageLogContext);
    }

    return { page, url, result };
  }

  const first = await fetchPage(0);
  lastUrl = first.url;
  if (!first.result.ok) {
    console.error(`${logPrefix} FAIL status=${first.result.status} message=${first.result.message}`);
    console.error(`${logPrefix} response.text():`, String(first.result.bodyText || '').slice(0, 800));
    return first.result;
  }

  firstPayload = first.result.payload;
  const detected = readTotalPages(first.result.payload);
  const firstRows = extractDataArray(first.result.payload, dataKey) || [];
  if (!detected) {
    if (firstRows.length > 0) {
      totalPage = 1;
      console.log(`${logPrefix} totalPage inferred=1 (data without totalPage)`);
    } else if (Array.isArray(first.result.payload?.data)) {
      totalPage = 1;
      console.log(`${logPrefix} totalPage inferred=1 (empty data array)`);
    } else {
      console.error(`${logPrefix} totalPage missing payload keys=${Object.keys(first.result.payload || {}).join(',')}`);
      return {
        ok: false,
        status: 502,
        error: 'TOTAL_PAGE_FAILED',
        message: 'totalPage 확인 실패',
        bodyText: first.result.bodyText
      };
    }
  } else {
    totalPage = detected;
    console.log(`${logPrefix} totalPage=${totalPage}`);
  }

  console.log(`${logPrefix} page=${first.page} rows=${firstRows.length}`);
  merged.push(...firstRows);

  if (totalPage > 1) {
    const remaining = [];
    for (let pageIndex = 1; pageIndex < totalPage; pageIndex += 1) {
      remaining.push(pageIndex);
    }
    for (let offset = 0; offset < remaining.length; offset += parallelBatchSize) {
      const batch = remaining.slice(offset, offset + parallelBatchSize);
      const batchResults = await Promise.all(batch.map(pageIndex => fetchPage(pageIndex)));
      for (const entry of batchResults) {
        lastUrl = entry.url || lastUrl;
        if (!entry.result.ok) {
          console.error(`${logPrefix} FAIL status=${entry.result.status} message=${entry.result.message}`);
          return entry.result;
        }
        const rows = extractDataArray(entry.result.payload, dataKey) || [];
        console.log(`${logPrefix} page=${entry.page} rows=${rows.length}`);
        merged.push(...rows);
      }
    }
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
  parseBaeminFetchResponse,
  extractDataArray,
  readTotalPages
};

const { BAEMIN_ORIGIN } = require('./baemin-collect-sources');

const FORBIDDEN_REPLAY_HEADERS = new Set(['host', 'content-length', 'connection']);

function sanitizeReplayHeaders(headers = {}) {
  const out = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    if (!key || value == null) return;
    if (FORBIDDEN_REPLAY_HEADERS.has(String(key).toLowerCase())) return;
    out[key] = String(value);
  });
  return out;
}

function extractIdsFromCapturedRequest(captured = {}) {
  const headers = captured.headers || captured.requestHeaders || {};
  let partnerId = '';
  let centerId = '';
  try {
    const parsed = new URL(String(captured.url || ''));
    partnerId = String(
      parsed.searchParams.get('partnerId')
      || parsed.searchParams.get('centerId')
      || parsed.searchParams.get('managementId')
      || ''
    ).trim();
    centerId = String(parsed.searchParams.get('centerId') || partnerId || '').trim();
  } catch {
    // ignore
  }
  const headerId = String(
    headers['partner-id']
    || headers['x-partner-id']
    || headers['center-id']
    || headers['x-center-id']
    || headers['management-id']
    || headers['x-management-id']
    || ''
  ).trim();
  if (!partnerId && headerId) partnerId = headerId;
  if (!centerId && headerId) centerId = headerId;
  return { partnerId, centerId };
}

function logReplayRequest(phase, captured, ids, cookieHeader = '') {
  const method = String(captured.method || 'GET').toUpperCase();
  const url = String(captured.url || '');
  let query = '';
  try {
    query = new URL(url).search || '';
  } catch {
    // ignore
  }
  const headers = sanitizeReplayHeaders(captured.headers || captured.requestHeaders || {});
  console.log(`[BREM][api-replay] ${phase || 'replay'}`);
  console.log(`[BREM][api-replay] partnerId=${ids.partnerId || '-'} centerId=${ids.centerId || '-'}`);
  console.log(`[BREM][api-replay] method=${method}`);
  console.log(`[BREM][api-replay] url=${url}`);
  console.log(`[BREM][api-replay] query=${query || '-'}`);
  console.log(`[BREM][api-replay] headers=${JSON.stringify(headers)}`);
  console.log(`[BREM][api-replay] cookie=${cookieHeader ? `${cookieHeader.slice(0, 240)}${cookieHeader.length > 240 ? '...' : ''}` : '(browser-jar)'}`);
  console.log(`[BREM][api-replay] body=${captured.postData || ''}`);
}

async function replayCapturedBrowserRequest(page, captured, phase = 'replay') {
  if (!page || page.isClosed()) {
    return {
      ok: false,
      status: 503,
      error: 'PLAYWRIGHT_PAGE_MISSING',
      message: 'Playwright 브라우저 탭이 없습니다.'
    };
  }
  if (!captured?.url) {
    return { ok: false, status: 400, message: '캡처된 API 요청 없음' };
  }

  const context = page.context();
  const method = String(captured.method || 'GET').toUpperCase();
  const url = String(captured.url);
  const headers = sanitizeReplayHeaders(captured.headers || captured.requestHeaders || {});
  const postData = captured.postData || '';
  const ids = extractIdsFromCapturedRequest(captured);
  const cookies = await context.cookies(url).catch(() => []);
  const cookieHeader = cookies.map(row => `${row.name}=${row.value}`).join('; ');
  logReplayRequest(phase, captured, ids, cookieHeader);

  const fetchOptions = { method, headers };
  if (postData && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.data = postData;
  }

  try {
    const response = await context.request.fetch(url, fetchOptions);
    const bodyText = await response.text();
    const { parseBaeminFetchResponse } = require('./baemin-api-fetch');
    return parseBaeminFetchResponse({
      url,
      status: response.status(),
      bodyText,
      logContext: ids,
      via: 'browser-replay'
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message || 'BROWSER_REPLAY_FAILED',
      message: error.message || '브라우저 캡처 요청 재실행 실패'
    };
  }
}

async function fetchBaeminJsonViaPage(page, url, logContext = null, extraHeaders = null) {
  if (!page || page.isClosed()) {
    return {
      ok: false,
      status: 503,
      error: 'PLAYWRIGHT_PAGE_MISSING',
      message: 'Playwright 브라우저 탭이 없습니다.'
    };
  }

  const headers = {
    Accept: 'application/json, text/plain, */*',
    ...(extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {})
  };

  const ctx = logContext && typeof logContext === 'object' ? logContext : {};
  console.log(`[BREM][page-fetch] partnerId=${ctx.partnerId || '-'} centerId=${ctx.centerId || '-'}`);
  console.log(`[BREM][page-fetch] method=GET url=${url}`);
  console.log(`[BREM][page-fetch] headers=${JSON.stringify(headers)}`);
  console.log('[BREM][page-fetch] body=');

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await page.evaluate(async ({ fetchUrl, headers: fetchHeaders }) => {
        try {
          const response = await fetch(fetchUrl, {
            method: 'GET',
            credentials: 'include',
            headers: fetchHeaders
          });
          return {
            status: response.status,
            bodyText: await response.text()
          };
        } catch (error) {
          return {
            status: 0,
            bodyText: '',
            error: error.message || 'page fetch failed'
          };
        }
      }, { fetchUrl: url, headers });

      if (result.error) {
        const corsBlocked = /failed to fetch/i.test(String(result.error));
        return {
          ok: false,
          status: 0,
          error: result.error,
          message: corsBlocked
            ? '배민 API 네트워크 호출 실패 (CORS/네트워크). 브라우저를 새로고침 후 다시 시도하세요.'
            : result.error
        };
      }

      const { parseBaeminFetchResponse } = require('./baemin-api-fetch');
      return parseBaeminFetchResponse({
        url,
        status: result.status,
        bodyText: result.bodyText,
        logContext,
        via: 'page-fetch'
      });
    } catch (error) {
      lastError = error;
      const navigated = /execution context was destroyed|navigation/i.test(String(error?.message || error || ''));
      if (navigated && attempt < maxAttempts) {
        console.warn(`[BREM][page-fetch] retry ${attempt}/${maxAttempts} after navigation`);
        await new Promise(resolve => setTimeout(resolve, 1200));
        continue;
      }
      break;
    }
  }

  const error = lastError || new Error('PLAYWRIGHT_PAGE_FETCH_FAILED');
  const closed = /has been closed|target page, context or browser/i.test(String(error?.message || error || ''));
  return {
    ok: false,
    status: 0,
    error: error.message || 'PLAYWRIGHT_PAGE_FETCH_FAILED',
    message: closed
      ? 'Playwright 브라우저가 닫혔습니다. [브라우저 열기/세션 유지] 후 다시 시도하세요.'
      : (error.message || '브라우저 탭 API 호출 실패')
  };
}

async function fetchBaeminJsonViaPlaywright(context, url, logContext = null, extraHeaders = null) {
  if (!context?.request) {
    return {
      ok: false,
      status: 503,
      error: 'PLAYWRIGHT_CONTEXT_MISSING',
      message: 'Playwright 브라우저 컨텍스트가 없습니다.'
    };
  }

  try {
    const response = await context.request.get(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: `${BAEMIN_ORIGIN}/delivery/history`,
        ...(extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : {})
      }
    });
    const { parseBaeminFetchResponse } = require('./baemin-api-fetch');
    return parseBaeminFetchResponse({
      url,
      status: response.status(),
      bodyText: await response.text(),
      logContext,
      via: 'playwright'
    });
  } catch (error) {
    const closed = /has been closed|target page, context or browser/i.test(String(error?.message || error || ''));
    return {
      ok: false,
      status: 0,
      error: error.message || 'PLAYWRIGHT_FETCH_FAILED',
      message: closed
        ? 'Playwright 브라우저가 닫혔습니다. [브라우저 열기/세션 유지] 후 다시 시도하세요.'
        : (error.message || 'Playwright API 호출 실패')
    };
  }
}

module.exports = {
  replayCapturedBrowserRequest,
  extractIdsFromCapturedRequest,
  fetchBaeminJsonViaPage,
  fetchBaeminJsonViaPlaywright
};

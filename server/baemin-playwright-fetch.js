const { BAEMIN_ORIGIN } = require('./baemin-collect-sources');

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
  fetchBaeminJsonViaPage,
  fetchBaeminJsonViaPlaywright
};

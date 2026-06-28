const { BAEMIN_ORIGIN } = require('./baemin-collect-sources');

async function fetchBaeminJsonViaPage(page, url, logContext = null) {
  if (!page || page.isClosed()) {
    return {
      ok: false,
      status: 503,
      error: 'PLAYWRIGHT_PAGE_MISSING',
      message: 'Playwright 브라우저 탭이 없습니다.'
    };
  }

  try {
    const result = await page.evaluate(async (fetchUrl) => {
      try {
        const response = await fetch(fetchUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*'
          }
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
    }, url);

    if (result.error) {
      return {
        ok: false,
        status: 0,
        error: result.error,
        message: result.error
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
    return {
      ok: false,
      status: 0,
      error: error.message || 'PLAYWRIGHT_PAGE_FETCH_FAILED',
      message: error.message || '브라우저 탭 API 호출 실패'
    };
  }
}

async function fetchBaeminJsonViaPlaywright(context, url, logContext = null) {
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
        Referer: `${BAEMIN_ORIGIN}/delivery/history`
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
    return {
      ok: false,
      status: 0,
      error: error.message || 'PLAYWRIGHT_FETCH_FAILED',
      message: error.message || 'Playwright API 호출 실패'
    };
  }
}

module.exports = {
  fetchBaeminJsonViaPage,
  fetchBaeminJsonViaPlaywright
};

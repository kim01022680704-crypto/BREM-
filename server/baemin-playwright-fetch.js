const { BAEMIN_ORIGIN } = require('./baemin-collect-sources');

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
  fetchBaeminJsonViaPlaywright
};

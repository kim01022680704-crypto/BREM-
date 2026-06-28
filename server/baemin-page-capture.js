const { BAEMIN_ORIGIN } = require('./baemin-collect-sources');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildPageUrl(sourceId, dateRange) {
  const qs = `page=0&size=20&fromDate=${dateRange.fromDate}&toDate=${dateRange.toDate}`;
  if (sourceId === 'daily_history') {
    return `${BAEMIN_ORIGIN}/delivery/delivery-history?${qs}`;
  }
  if (sourceId === 'rider_history') {
    return `${BAEMIN_ORIGIN}/delivery/rider-history?${qs}`;
  }
  if (sourceId === 'delivery_status') {
    return `${BAEMIN_ORIGIN}/delivery-status`;
  }
  return `${BAEMIN_ORIGIN}/delivery/history`;
}

function urlMatchesSource(sourceId, url) {
  const text = String(url || '');
  if (!text.includes('api-deliverycenter.baemin.com')) return false;
  if (sourceId === 'delivery_status') return /\/delivery-status/i.test(text);
  if (sourceId === 'rider_history') return /\/rider-history/i.test(text);
  if (sourceId === 'daily_history') {
    return /fromDate=/i.test(text) && !/delivery-status/i.test(text) && !/rider-history/i.test(text);
  }
  return false;
}

async function discoverApiUrlViaPage(page, sourceId, dateRange, timeoutMs = 45000) {
  if (!page || page.isClosed()) {
    return { ok: false, message: 'Playwright page 없음' };
  }

  const pageUrl = buildPageUrl(sourceId, dateRange);
  const waitResponse = page.waitForResponse(resp => {
    const ct = String(resp.headers()['content-type'] || '').toLowerCase();
    return urlMatchesSource(sourceId, resp.url())
      && resp.status() >= 200
      && resp.status() < 300
      && ct.includes('json');
  }, { timeout: timeoutMs }).catch(() => null);

  console.log(`[BREM][page-capture] navigate ${pageUrl}`);
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
    if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
  });
  await delay(3000);

  let response = await waitResponse;
  if (!response) {
    response = await page.waitForResponse(resp => {
      const ct = String(resp.headers()['content-type'] || '').toLowerCase();
      return resp.url().includes('api-deliverycenter.baemin.com')
        && /fromDate=/i.test(resp.url())
        && resp.status() >= 200
        && resp.status() < 300
        && ct.includes('json');
    }, { timeout: 10000 }).catch(() => null);
  }

  if (!response) {
    return { ok: false, message: `${sourceId} API 응답을 찾지 못했습니다.` };
  }

  const sampleUrl = response.url();
  let pathname = sampleUrl;
  try { pathname = new URL(sampleUrl).pathname; } catch { /* ignore */ }

  return {
    ok: true,
    sampleUrl,
    apiPath: pathname,
    apiOrigin: new URL(sampleUrl).origin,
    status: response.status()
  };
}

module.exports = {
  buildPageUrl,
  discoverApiUrlViaPage,
  urlMatchesSource
};

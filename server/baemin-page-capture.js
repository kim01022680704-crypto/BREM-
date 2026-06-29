const { BAEMIN_ORIGIN } = require('./baemin-collect-sources');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildPagePath(sourceId) {
  if (sourceId === 'daily_history') return `${BAEMIN_ORIGIN}/delivery/delivery-history`;
  if (sourceId === 'rider_history') return `${BAEMIN_ORIGIN}/delivery/rider-history`;
  if (sourceId === 'delivery_status') return `${BAEMIN_ORIGIN}/delivery-status`;
  return `${BAEMIN_ORIGIN}/delivery/history`;
}

function buildSpaDateQuery(dateRange) {
  if (!dateRange?.fromDate || !dateRange?.toDate) return '';
  const day = dateRange.toDate || dateRange.fromDate;
  return `fromDate=${day}&toDate=${day}`;
}

function buildPageUrl(sourceId, dateRange) {
  const base = buildPagePath(sourceId);
  if (!dateRange?.fromDate || !dateRange?.toDate) return base;
  if (sourceId === 'delivery_status') return base;
  const qs = buildSpaDateQuery(dateRange);
  return qs ? `${base}?${qs}` : base;
}

function responseMatchesSource(sourceId, url, status, contentType) {
  const text = String(url || '');
  if (!text.includes('baemin.com')) return false;
  if (status < 200 || status >= 300) return false;
  if (!String(contentType || '').toLowerCase().includes('json')) return false;

  if (sourceId === 'delivery_status') {
    return /\/delivery-status/i.test(text);
  }
  if (sourceId === 'rider_history') {
    return /\/rider-history/i.test(text);
  }
  if (sourceId === 'daily_history') {
    return (/fromDate=/i.test(text) || /\/delivery-history/i.test(text) || /\/delivery\/history/i.test(text))
      && !/delivery-status/i.test(text)
      && !/rider-history/i.test(text);
  }
  return false;
}

function pickBestCapturedResponse(sourceId, captured) {
  if (!captured.length) return null;
  const scored = captured.map(entry => {
    let score = 0;
    const url = entry.url;
    if (url.includes('api-deliverycenter.baemin.com')) score += 20;
    if (/fromDate=/i.test(url)) score += 10;
    if (sourceId === 'daily_history' && /delivery-history|delivery\/history/i.test(url)) score += 15;
    if (sourceId === 'rider_history' && /rider-history/i.test(url)) score += 15;
    return { entry, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].entry.response;
}

async function discoverApiUrlViaPage(page, sourceId, dateRange, timeoutMs = 45000) {
  if (!page || page.isClosed()) {
    return { ok: false, message: 'Playwright page 없음' };
  }

  const captured = [];
  const handler = response => {
    try {
      const url = response.url();
      const status = response.status();
      const contentType = String(response.headers()['content-type'] || '');
      if (!responseMatchesSource(sourceId, url, status, contentType)) return;
      captured.push({ url, response, at: Date.now() });
      console.log(`[BREM][page-capture] hit ${sourceId} ← ${url}`);
    } catch {
      // ignore
    }
  };

  page.on('response', handler);
  const navigations = [
    buildPagePath(sourceId),
    buildPageUrl(sourceId, dateRange)
  ].filter((url, index, list) => list.indexOf(url) === index);

  try {
    for (const pageUrl of navigations) {
      console.log(`[BREM][page-capture] navigate ${pageUrl}`);
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
        if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
      });
      await delay(4000);
      if (captured.length) break;
    }

    if (!captured.length) {
      await delay(Math.min(timeoutMs, 8000));
    }
  } finally {
    page.off('response', handler);
  }

  const response = pickBestCapturedResponse(sourceId, captured);
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
  buildPagePath,
  buildPageUrl,
  buildSpaDateQuery,
  discoverApiUrlViaPage,
  responseMatchesSource
};

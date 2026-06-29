const {
  BAEMIN_ORIGIN,
  BAEMIN_API_ORIGIN,
  getCollectSource
} = require('./baemin-collect-sources');

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

function isUnsafeHistorySpaUrl(url) {
  const text = String(url || '');
  return /\/delivery\/(?:delivery-history|rider-history)/i.test(text);
}

function buildProbeUrls(sourceId, dateRange) {
  const source = getCollectSource(sourceId);
  if (!source) return [];

  const day = dateRange?.toDate || dateRange?.fromDate;
  const paths = [...new Set([
    source.apiPath,
    ...(source.fallbackApiPaths || [])
  ].filter(Boolean))];
  const origins = [...new Set([BAEMIN_API_ORIGIN, BAEMIN_ORIGIN])];
  const pageNumbers = sourceId === 'delivery_status' ? [0] : [1, 0];
  const urls = [];

  paths.forEach(apiPath => {
    origins.forEach(origin => {
      pageNumbers.forEach(pageNum => {
        const params = new URLSearchParams();
        if (day && source.dateQueryKeys?.length) {
          params.set('fromDate', day);
          params.set('toDate', day);
        }
        if (sourceId === 'delivery_status' && source.defaultQuery) {
          Object.entries(source.defaultQuery).forEach(([key, value]) => {
            if (value == null || value === '') return;
            params.set(key, String(value));
          });
        }
        params.set('page', String(pageNum));
        params.set('size', String(source.pagination?.defaultSize || 20));
        urls.push(`${origin}${apiPath}?${params.toString()}`);
      });
    });
  });

  return urls;
}

async function ensureSafeBrowserTab(page) {
  if (!page || page.isClosed()) return;
  const currentUrl = page.url();
  if (!isUnsafeHistorySpaUrl(currentUrl)) return;
  console.log(`[BREM][page-capture] unsafe SPA url — return to delivery-status | was=${currentUrl}`);
  await page.goto(`${BAEMIN_ORIGIN}/delivery-status`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  }).catch(() => {});
  await delay(1200);
}

async function probeApiFromBrowserTab(page, sourceId, dateRange) {
  const urls = buildProbeUrls(sourceId, dateRange);
  const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');

  for (const url of urls) {
    console.log(`[BREM][api-probe] GET ${url} (no SPA navigate)`);
    const result = await page.evaluate(async (fetchUrl) => {
      try {
        const response = await fetch(fetchUrl, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json, text/plain, */*' }
        });
        return {
          status: response.status,
          bodyText: await response.text()
        };
      } catch (error) {
        return {
          status: 0,
          bodyText: '',
          error: error.message || 'fetch failed'
        };
      }
    }, url);

    if (result.status < 200 || result.status >= 300) continue;

    let payload = null;
    try {
      payload = result.bodyText ? JSON.parse(result.bodyText) : null;
    } catch {
      continue;
    }

    const rows = extractDataArray(payload) || [];
    const totalPage = readTotalPages(payload);
    if (!rows.length && !totalPage) continue;

    let pathname = url;
    try { pathname = new URL(url).pathname; } catch { /* ignore */ }

    console.log(`[BREM][api-probe] hit ${sourceId} ← ${url} rows=${rows.length}`);
    return {
      ok: true,
      sampleUrl: url,
      apiPath: pathname,
      apiOrigin: new URL(url).origin,
      status: result.status
    };
  }

  return { ok: false, message: `${sourceId} API probe 실패` };
}

async function discoverApiUrlViaPage(page, sourceId, dateRange) {
  if (!page || page.isClosed()) {
    return { ok: false, message: 'Playwright page 없음' };
  }

  await ensureSafeBrowserTab(page);

  // 일별/라이더 SPA 라우트로 goto 하면 page=0 400 오류 — API만 조용히 탐색
  return probeApiFromBrowserTab(page, sourceId, dateRange);
}

module.exports = {
  buildPagePath,
  buildPageUrl,
  buildSpaDateQuery,
  buildProbeUrls,
  isUnsafeHistorySpaUrl,
  ensureSafeBrowserTab,
  probeApiFromBrowserTab,
  discoverApiUrlViaPage
};

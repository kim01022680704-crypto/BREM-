const {
  BAEMIN_ORIGIN,
  BAEMIN_API_ORIGIN,
  getCollectSource
} = require('./baemin-collect-sources');

const SAFE_LANDING_URL = `${BAEMIN_ORIGIN}/delivery-status`;

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
  if (!text.includes('deliverycenter.baemin.com')) return false;
  if (/\/delivery\/(?:delivery-history|rider-history)/i.test(text)) return true;
  if ((/delivery-history|rider-history/i.test(text)) && /[?&]page=0\b/i.test(text)) return true;
  return false;
}

function isApiProbePath(apiPath) {
  const path = String(apiPath || '');
  if (path.startsWith('/v2/') || path.startsWith('/v4/')) return true;
  if (path === '/delivery-status' || path.startsWith('/delivery-status?')) return true;
  return false;
}

function attachSafeSpaGuard(context) {
  if (!context || context.__bremSpaGuardAttached) return () => {};
  context.__bremSpaGuardAttached = true;

  const routePattern = '**/deliverycenter.baemin.com/**';
  const routeHandler = async route => {
    try {
      const request = route.request();
      const url = request.url();
      const resourceType = request.resourceType();
      if (resourceType === 'document' && isUnsafeHistorySpaUrl(url)) {
        console.log(`[BREM][spa-guard] route block document | ${url}`);
        const page = request.frame()?.page();
        await route.abort('blockedbyclient');
        if (page && !page.isClosed()) {
          void page.goto(SAFE_LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        }
        return;
      }
    } catch {
      // ignore
    }
    await route.continue();
  };

  context.route(routePattern, routeHandler).catch(error => {
    console.warn('[BREM][spa-guard] route 등록 실패:', error.message || error);
  });

  const onFrameNavigated = page => async frame => {
    try {
      if (frame !== page.mainFrame() || page.isClosed()) return;
      const url = frame.url();
      if (!isUnsafeHistorySpaUrl(url)) return;
      console.log(`[BREM][spa-guard] framenavigated block | ${url}`);
      await recoverBrowserTab(page);
    } catch {
      // ignore
    }
  };

  const bindPage = page => {
    if (!page || page.isClosed() || page.__bremSpaGuardBound) return;
    page.__bremSpaGuardBound = true;
    page.on('framenavigated', onFrameNavigated(page));
  };

  context.pages().filter(page => !page.isClosed()).forEach(bindPage);
  context.on('page', bindPage);

  return () => {
    context.unroute(routePattern, routeHandler).catch(() => {});
  };
}

async function recoverBrowserTab(page) {
  if (!page || page.isClosed()) return;
  try {
    await page.goto(SAFE_LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch {
    try {
      await page.evaluate(target => { window.location.replace(target); }, SAFE_LANDING_URL);
      await delay(800);
    } catch {
      // ignore
    }
  }
}

async function recoverAllBrowserTabs(context) {
  if (!context) return;
  const pages = context.pages().filter(page => !page.isClosed());
  for (const page of pages) {
    if (isUnsafeHistorySpaUrl(page.url())) {
      await recoverBrowserTab(page).catch(() => {});
    }
  }
}

function buildProbeUrls(sourceId, dateRange) {
  const source = getCollectSource(sourceId);
  if (!source) return [];

  const day = dateRange?.toDate || dateRange?.fromDate;
  const paths = [...new Set([
    source.apiPath,
    ...(source.fallbackApiPaths || [])
  ].filter(Boolean))].filter(isApiProbePath);

  const origins = sourceId === 'delivery_status'
    ? [...new Set([BAEMIN_API_ORIGIN, BAEMIN_ORIGIN])]
    : [BAEMIN_API_ORIGIN];
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
  if (!isUnsafeHistorySpaUrl(page.url())) return;
  console.log(`[BREM][page-capture] unsafe SPA url — recover | was=${page.url()}`);
  await recoverBrowserTab(page);
  await delay(500);
}

async function probeApiFromBrowserTab(page, sourceId, dateRange) {
  await ensureSafeBrowserTab(page);

  const urls = buildProbeUrls(sourceId, dateRange);
  const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');

  for (const url of urls) {
    if (!url.includes('api-deliverycenter.baemin.com') && sourceId !== 'delivery_status') continue;
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
  return probeApiFromBrowserTab(page, sourceId, dateRange);
}

module.exports = {
  SAFE_LANDING_URL,
  buildPagePath,
  buildPageUrl,
  buildSpaDateQuery,
  buildProbeUrls,
  isUnsafeHistorySpaUrl,
  attachSafeSpaGuard,
  recoverBrowserTab,
  recoverAllBrowserTabs,
  ensureSafeBrowserTab,
  probeApiFromBrowserTab,
  discoverApiUrlViaPage
};

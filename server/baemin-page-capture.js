const {
  BAEMIN_ORIGIN,
  BAEMIN_API_ORIGIN,
  getCollectSource
} = require('./baemin-collect-sources');

const SAFE_LANDING_URL = `${BAEMIN_ORIGIN}/delivery-status`;

const INIT_SCRIPT = () => {
  try {
    const path = window.location.pathname || '';
    if (/\/delivery\/(delivery-history|rider-history)/i.test(path)) {
      window.location.replace('/delivery-status');
    }
  } catch {
    // ignore
  }
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  return path.startsWith('/v2/') || path.startsWith('/v4/') || path === '/delivery-status';
}

async function attachSafeSpaGuard(context) {
  if (!context || context.__bremSpaGuardAttached) return () => {};
  context.__bremSpaGuardAttached = true;

  await context.addInitScript(INIT_SCRIPT);

  const routePattern = '**/deliverycenter.baemin.com/**';
  const routeHandler = async route => {
    try {
      const request = route.request();
      const url = request.url();
      if (request.resourceType() === 'document' && isUnsafeHistorySpaUrl(url)) {
        console.log(`[BREM][spa-guard] block document | ${url}`);
        const page = request.frame()?.page();
        await route.abort('blockedbyclient');
        if (page && !page.isClosed()) {
          void recoverBrowserTab(page);
        }
        return;
      }
    } catch {
      // ignore
    }
    await route.continue();
  };

  await context.route(routePattern, routeHandler);

  const onFrameNavigated = page => async frame => {
    try {
      if (frame !== page.mainFrame() || page.isClosed()) return;
      if (!isUnsafeHistorySpaUrl(frame.url())) return;
      console.log(`[BREM][spa-guard] framenavigated recover | ${frame.url()}`);
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
    await page.goto(SAFE_LANDING_URL, { waitUntil: 'commit', timeout: 30000 });
  } catch {
    try {
      await page.evaluate(target => { window.location.replace(target); }, SAFE_LANDING_URL);
      await delay(500);
    } catch {
      // ignore
    }
  }
}

async function recoverAllBrowserTabs(context) {
  if (!context) return;
  for (const page of context.pages().filter(p => !p.isClosed())) {
    if (isUnsafeHistorySpaUrl(page.url())) {
      await recoverBrowserTab(page);
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
  console.log(`[BREM][spa-guard] recover unsafe tab | was=${page.url()}`);
  await recoverBrowserTab(page);
}

async function probeApiFromBrowserTab(page, sourceId, dateRange, playwrightContext = null) {
  await ensureSafeBrowserTab(page);

  const urls = buildProbeUrls(sourceId, dateRange);
  const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');
  const { fetchBaeminJsonViaPlaywright } = require('./baemin-playwright-fetch');

  for (const url of urls) {
    if (!url.includes('api-deliverycenter.baemin.com') && sourceId !== 'delivery_status') continue;
    console.log(`[BREM][api-probe] GET ${url} (${playwrightContext ? 'playwright-request' : 'isolated-fetch'})`);

    let result;
    if (playwrightContext?.request) {
      const fetched = await fetchBaeminJsonViaPlaywright(playwrightContext, url);
      if (!fetched.ok) continue;
      const payload = fetched.payload;
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
        status: fetched.status || 200
      };
    }

    if (page && !page.isClosed()) {
      result = await page.evaluate(async (fetchUrl) => {
        try {
          const response = await fetch(fetchUrl, {
            method: 'GET',
            credentials: 'include',
            headers: { Accept: 'application/json, text/plain, */*' }
          });
          return { status: response.status, bodyText: await response.text() };
        } catch (error) {
          return { status: 0, bodyText: '', error: error.message || 'fetch failed' };
        }
      }, url);
      if (result.status < 200 || result.status >= 300) continue;
    } else {
      continue;
    }

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
      status: result.status || 200
    };
  }

  return { ok: false, message: `${sourceId} API probe 실패` };
}

async function discoverApiUrlViaPage(page, sourceId, dateRange, playwrightContext = null) {
  if ((!page || page.isClosed()) && !playwrightContext) {
    return { ok: false, message: 'Playwright page/context 없음' };
  }

  if (page && !page.isClosed()) {
    await ensureSafeBrowserTab(page);
  }

  return probeApiFromBrowserTab(page, sourceId, dateRange, playwrightContext);
}

module.exports = {
  SAFE_LANDING_URL,
  buildProbeUrls,
  isUnsafeHistorySpaUrl,
  attachSafeSpaGuard,
  recoverBrowserTab,
  recoverAllBrowserTabs,
  ensureSafeBrowserTab,
  probeApiFromBrowserTab,
  discoverApiUrlViaPage
};

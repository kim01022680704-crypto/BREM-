const {
  BAEMIN_ORIGIN,
  BAEMIN_API_ORIGIN,
  getCollectSource
} = require('./baemin-collect-sources');
const {
  isDeliveryCenterHost,
  isBetaDeliveryCenterHost,
  normalizeToProductionDeliveryUrl
} = require('./baemin-delivery-hosts');

const SAFE_LANDING_URL = `${BAEMIN_ORIGIN}/delivery/history?page=0&size=20&orderName=name&orderBy=asc&name=&userId=&phoneNumber=&riderStatus=`;

const INIT_SCRIPT = () => {
  // 배달현황 /delivery/history?page=0 는 정상 화면 — 리다이렉트하지 않음
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isDeliveryStatusSpaUrl(url) {
  const text = String(url || '');
  if (!isDeliveryCenterHost(text)) return false;
  if (/\/delivery-status(?:\?|$|\/)/i.test(text)) return true;
  if (/\/delivery\/history/i.test(text) && /orderName=/i.test(text)) return true;
  if (/\/delivery\/history/i.test(text) && /riderStatus=/i.test(text)) return true;
  return false;
}

function isUnsafeHistorySpaUrl(url) {
  const text = String(url || '');
  if (!isDeliveryCenterHost(text)) return false;
  if (isDeliveryStatusSpaUrl(text)) return false;
  if (/[?&]page=0\b/i.test(text) && /\/delivery\/(?:delivery-history|rider-history)/i.test(text)) return true;
  return false;
}

function buildSpaPageUrl(sourceId, dateRange, collectDate = null) {
  if (sourceId !== 'daily_history' && sourceId !== 'rider_history') return null;

  const { resolveHistoryMenuQueryDates } = require('./baemin-settlement-week');
  const history = resolveHistoryMenuQueryDates(
    collectDate || dateRange?.referenceDate,
    dateRange
  );
  const fromDate = history.fromDate;
  const toDate = history.toDate;
  if (!fromDate || !toDate) return null;

  const params = new URLSearchParams({
    page: '1',
    size: '20',
    fromDate,
    toDate
  });
  if (sourceId === 'daily_history') {
    return `${BAEMIN_ORIGIN}/delivery/delivery-history?${params.toString()}`;
  }
  return `${BAEMIN_ORIGIN}/delivery/rider-history?${params.toString()}`;
}

function isApiProbePath(apiPath) {
  const path = String(apiPath || '');
  return path.startsWith('/v2/') || path.startsWith('/v4/') || path === '/delivery-status';
}

async function ensureProductionDeliveryPage(page) {
  if (!page || page.isClosed()) return { ok: false, message: '브라우저가 닫혀 있습니다.' };
  const currentUrl = page.url();
  if (!isBetaDeliveryCenterHost(currentUrl)) {
    return { ok: true, url: currentUrl, redirected: false };
  }
  console.warn(`[BREM][page] betabaemin 감지 — 운영 도메인으로 이동: ${currentUrl}`);
  await page.goto(SAFE_LANDING_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await delay(2500);
  return { ok: true, url: page.url(), redirected: true, from: currentUrl };
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
      if (context.__bremCollecting) return;
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

function buildProbeUrls(sourceId, dateRange, collectDate = null) {
  const source = getCollectSource(sourceId);
  if (!source) return [];

  const { resolveHistoryMenuQueryDates } = require('./baemin-settlement-week');
  const history = source.dateQueryKeys?.length
    ? resolveHistoryMenuQueryDates(collectDate || dateRange?.referenceDate, dateRange)
    : null;
  const day = history?.toDate || dateRange?.toDate || dateRange?.fromDate;
  const paths = [...new Set([
    source.apiPath,
    ...(source.fallbackApiPaths || [])
  ].filter(Boolean))].filter(isApiProbePath);

  const origins = sourceId === 'delivery_status'
    ? [...new Set([BAEMIN_API_ORIGIN, BAEMIN_ORIGIN])]
    : [BAEMIN_API_ORIGIN];
  const pageNumbers = sourceId === 'delivery_status' ? [0] : [0, 1];
  const urls = [];

  paths.forEach(apiPath => {
    origins.forEach(origin => {
      pageNumbers.forEach(pageNum => {
        const params = new URLSearchParams();
        if (source.dateQueryKeys?.length && history?.fromDate && history?.toDate) {
          params.set('fromDate', history.fromDate);
          params.set('toDate', history.toDate);
        } else if (day && source.dateQueryKeys?.length) {
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
  if (isDeliveryStatusSpaUrl(page.url())) return;
  if (!isUnsafeHistorySpaUrl(page.url())) return;
  console.log(`[BREM][spa-guard] recover unsafe tab | was=${page.url()}`);
  await recoverBrowserTab(page);
}

async function probeApiFromBrowserTab(page, sourceId, dateRange, playwrightContext = null, collectDate = null) {
  await ensureSafeBrowserTab(page);

  const urls = buildProbeUrls(sourceId, dateRange, collectDate);
  const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');
  const { fetchBaeminJsonViaPage, fetchBaeminJsonViaPlaywright } = require('./baemin-playwright-fetch');

  for (const url of urls) {
    if (!url.includes('api-deliverycenter.baemin.com') && sourceId !== 'delivery_status') continue;

    let result;
    if (page && !page.isClosed()) {
      console.log(`[BREM][api-probe] GET ${url} (browser-tab)`);
      const fetched = await fetchBaeminJsonViaPage(page, url);
      if (fetched.ok) {
        const payload = fetched.payload;
        const rows = extractDataArray(payload) || [];
        const totalPage = readTotalPages(payload);
        if (rows.length || totalPage) {
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
      }
    }

    if (playwrightContext?.request) {
      console.log(`[BREM][api-probe] GET ${url} (playwright-request)`);
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
      console.log(`[BREM][api-probe] GET ${url} (page-evaluate)`);
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

async function preparePageForCollect(page, sourceId, dateRange, collectDate = null) {
  if (!page || page.isClosed()) return null;

  if (sourceId === 'delivery_status') {
    if (isDeliveryStatusSpaUrl(page.url())) {
      await delay(800);
      return null;
    }
    const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');
    let capture = null;
    const handler = async response => {
      try {
        const url = response.url();
        if (!url.includes('/management/delivery-status') && !url.includes('/delivery-status')) return;
        if (response.status() < 200 || response.status() >= 300) return;
        const bodyText = await response.text().catch(() => '');
        const payload = bodyText ? JSON.parse(bodyText) : null;
        const rows = extractDataArray(payload) || [];
        if (!rows.length && !readTotalPages(payload)) return;
        capture = {
          sampleUrl: url,
          spaPayload: payload,
          spaItems: rows,
          spaTotalPage: readTotalPages(payload),
          requestHeaders: response.request().headers()
        };
      } catch {
        // ignore
      }
    };
    page.on('response', handler);
    console.log(`[BREM][collect-prep] delivery_status goto ${SAFE_LANDING_URL}`);
    try {
      await page.goto(SAFE_LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
        if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
      });
      await delay(600);
    } finally {
      page.off('response', handler);
    }
    if (capture) {
      console.log(`[BREM][collect-prep] delivery_status spa-capture rows=${capture.spaItems?.length || 0}`);
    }
    return capture;
  }

  const spaUrl = buildSpaPageUrl(sourceId, dateRange, collectDate);
  if (!spaUrl) return null;
  if (page.url() === spaUrl || page.url().split('?')[0] === spaUrl.split('?')[0]) {
    console.log(`[BREM][collect-prep] ${sourceId} already on SPA url — skip goto`);
    return null;
  }
  console.log(`[BREM][collect-prep] ${sourceId} goto ${spaUrl}`);
  const captured = await navigateAndCaptureApi(page, spaUrl, sourceId);
  if (captured.ok) return captured;
  return null;
}

async function navigateAndCaptureApi(page, spaUrl, sourceId) {
  if (!page || page.isClosed()) {
    return { ok: false, message: 'Playwright page 없음' };
  }

  const { classifyApiUrl } = require('./baemin-collect-sources');
  const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');
  const captured = [];

  const handler = async response => {
    try {
      const url = response.url();
      if (!url.includes('api-deliverycenter.baemin.com')) return;
      const contentType = String(response.headers()['content-type'] || '').toLowerCase();
      if (!contentType.includes('json')) return;
      if (response.status() < 200 || response.status() >= 300) return;
      const bodyText = await response.text().catch(() => '');
      let payload = null;
      try {
        payload = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        payload = null;
      }
      captured.push({
        url,
        status: response.status(),
        bodyText,
        payload,
        requestHeaders: response.request().headers()
      });
    } catch {
      // ignore
    }
  };

  page.on('response', handler);
  try {
    const currentUrl = page.url();
    const samePage = currentUrl === spaUrl || currentUrl.split('?')[0] === spaUrl.split('?')[0];
    if (!samePage) {
      console.log(`[BREM][spa-probe] goto ${spaUrl}`);
      await page.goto(spaUrl, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
        if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
      });
      await delay(1200);
    } else {
      console.log(`[BREM][spa-probe] reuse current page ${currentUrl}`);
      await delay(400);
    }
  } catch (error) {
    console.warn(`[BREM][spa-probe] goto failed: ${error.message || error}`);
  } finally {
    page.off('response', handler);
  }

  const hitEntry = captured.find(entry => classifyApiUrl(entry.url) === sourceId)
    || captured.find(entry => {
      if (sourceId === 'daily_history' || sourceId === 'rider_history') {
        return /fromDate=/i.test(entry.url) && classifyApiUrl(entry.url) === sourceId;
      }
      return false;
    })
    || captured.find(entry => /fromDate=/i.test(entry.url))
    || captured.find(entry => /delivery-status/i.test(entry.url));

  if (!hitEntry) {
    return { ok: false, message: `${sourceId} SPA API 미감지`, captured: captured.map(row => row.url) };
  }

  const hit = hitEntry.url;
  let pathname = hit;
  try { pathname = new URL(hit).pathname; } catch { /* ignore */ }
  const rows = extractDataArray(hitEntry.payload) || [];
  const totalPage = readTotalPages(hitEntry.payload);
  console.log(`[BREM][spa-probe] hit ${sourceId} ← ${hit} rows=${rows.length}`);
  return {
    ok: true,
    sampleUrl: hit,
    apiPath: pathname,
    apiOrigin: new URL(hit).origin,
    status: hitEntry.status || 200,
    spaPayload: hitEntry.payload,
    spaItems: rows,
    spaTotalPage: totalPage,
    requestHeaders: hitEntry.requestHeaders || null
  };
}

async function discoverApiUrlViaPage(page, sourceId, dateRange, playwrightContext = null, collectDate = null) {
  if ((!page || page.isClosed()) && !playwrightContext) {
    return { ok: false, message: 'Playwright page/context 없음' };
  }

  const spaUrl = buildSpaPageUrl(sourceId, dateRange, collectDate);
  if (spaUrl && page && !page.isClosed()) {
    const onSpaPage = page.url() === spaUrl || page.url().split('?')[0] === spaUrl.split('?')[0];
    if (!onSpaPage) {
      const fromSpa = await navigateAndCaptureApi(page, spaUrl, sourceId);
      if (fromSpa.ok) return fromSpa;
      console.warn(`[BREM][spa-probe] ${sourceId} SPA 탐색 실패 — quiet probe 재시도`);
      await recoverBrowserTab(page).catch(() => {});
    }
  } else if (page && !page.isClosed()) {
    await ensureSafeBrowserTab(page);
  }

  return probeApiFromBrowserTab(page, sourceId, dateRange, playwrightContext, collectDate);
}

module.exports = {
  SAFE_LANDING_URL,
  buildProbeUrls,
  buildSpaPageUrl,
  isDeliveryStatusSpaUrl,
  isUnsafeHistorySpaUrl,
  ensureProductionDeliveryPage,
  attachSafeSpaGuard,
  recoverBrowserTab,
  recoverAllBrowserTabs,
  ensureSafeBrowserTab,
  preparePageForCollect,
  navigateAndCaptureApi,
  probeApiFromBrowserTab,
  discoverApiUrlViaPage
};

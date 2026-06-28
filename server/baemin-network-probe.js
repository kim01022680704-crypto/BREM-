const { BAEMIN_ORIGIN } = require('./baemin-collect-sources');
const { computeCollectDateRange } = require('./baemin-settlement-week');
const { classifyApiUrl } = require('./baemin-collect-sources');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildProbePages(range) {
  const qs = `page=0&size=20&fromDate=${range.fromDate}&toDate=${range.toDate}`;
  return [
    { id: 'delivery_status', label: '배달현황', url: `${BAEMIN_ORIGIN}/delivery-status` },
    { id: 'delivery_status_alt', label: '배달현황(히스토리)', url: `${BAEMIN_ORIGIN}/delivery/history?page=0&size=20&orderName=name&orderBy=asc&name=&userId=&phoneNumber=&riderStatus=` },
    { id: 'daily_history', label: '일별 배달내역', url: `${BAEMIN_ORIGIN}/delivery/delivery-history?${qs}` },
    { id: 'rider_history', label: '라이더별 배달내역', url: `${BAEMIN_ORIGIN}/delivery/rider-history?${qs}` }
  ];
}

async function probeBaeminNetwork(context, options = {}) {
  if (!context) return { ok: false, message: 'Playwright context 없음' };

  const range = options.range || computeCollectDateRange(options.referenceDate);
  const captured = [];
  const samples = new Map();

  const handler = async response => {
    try {
      const url = response.url();
      if (!url.includes('baemin.com')) return;
      const contentType = String(response.headers()['content-type'] || '').toLowerCase();
      const entry = {
        url,
        status: response.status(),
        contentType,
        sourceId: classifyApiUrl(url),
        method: response.request().method()
      };
      captured.push(entry);

      if (
        url.includes('api-deliverycenter')
        && contentType.includes('json')
        && response.status() >= 200
        && response.status() < 300
      ) {
        let pathname = url;
        try { pathname = new URL(url).pathname; } catch { /* ignore */ }
        if (!samples.has(pathname)) {
          const bodyText = await response.text().catch(() => '');
          let payload = null;
          try { payload = bodyText ? JSON.parse(bodyText) : null; } catch { payload = null; }
          const data = payload?.data;
          samples.set(pathname, {
            url,
            keys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
            dataLength: Array.isArray(data) ? data.length : null,
            sampleItem: Array.isArray(data) && data[0] ? data[0] : null
          });
        }
      }
    } catch {
      // ignore
    }
  };

  context.on('response', handler);
  const pages = context.pages().filter(p => !p.isClosed());
  const page = pages[0] || await context.newPage();
  const probePages = buildProbePages(range);
  const navigations = [];

  for (const probe of probePages) {
    const before = captured.length;
    try {
      console.log(`[BREM][network-probe] goto ${probe.url}`);
      await page.goto(probe.url, { waitUntil: 'networkidle', timeout: 90000 }).catch(error => {
        if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
      });
      await delay(4000);
      navigations.push({
        ...probe,
        ok: true,
        newResponses: captured.length - before
      });
    } catch (error) {
      navigations.push({
        ...probe,
        ok: false,
        error: error.message || String(error),
        newResponses: captured.length - before
      });
    }
  }

  try { context.off('response', handler); } catch { /* ignore */ }

  const apiResponses = captured.filter(row =>
    row.url.includes('api-deliverycenter')
    && row.contentType.includes('json')
    && row.status >= 200
    && row.status < 300
  );

  const bySource = {};
  apiResponses.forEach(row => {
    const key = row.sourceId || 'unknown';
    bySource[key] = bySource[key] || [];
    if (!bySource[key].some(item => item.url.split('?')[0] === row.url.split('?')[0])) {
      bySource[key].push(row);
    }
  });

  return {
    ok: true,
    range,
    navigations,
    totalCaptured: captured.length,
    apiJsonSuccess: apiResponses,
    bySource,
    allApiHosts: [...new Set(captured.filter(r => r.url.includes('api')).map(r => {
      try { return new URL(r.url).origin; } catch { return r.url; }
    }))],
    uniqueApiPaths: [...new Set(apiResponses.map(r => {
      try { return new URL(r.url).pathname; } catch { return r.url; }
    }))],
    responseSamples: Object.fromEntries(samples)
  };
}

module.exports = {
  probeBaeminNetwork,
  buildProbePages
};

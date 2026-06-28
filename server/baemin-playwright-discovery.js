const {
  classifyApiUrl,
  classifyPageUrl,
  API_REGISTRY_KEY
} = require('./baemin-collect-sources');

function createApiDiscoveryState() {
  return {
    requests: [],
    responses: [],
    endpoints: {},
    startedAt: Date.now()
  };
}

function attachApiDiscovery(context, state) {
  if (!context || !state) return () => {};

  const onRequest = request => {
    try {
      const url = request.url();
      if (!url.includes('baemin.com')) return;
      state.requests.push({
        method: request.method(),
        url,
        resourceType: request.resourceType(),
        at: Date.now()
      });
    } catch {
      // ignore
    }
  };

  const onResponse = async response => {
    try {
      const url = response.url();
      if (!url.includes('baemin.com')) return;
      const contentType = String(response.headers()['content-type'] || '').toLowerCase();
      const sourceId = classifyApiUrl(url);
      const entry = {
        url,
        status: response.status(),
        contentType,
        sourceId,
        at: Date.now()
      };
      state.responses.push(entry);
      if (!sourceId) return;
      if (!contentType.includes('json')) return;
      if (response.status() < 200 || response.status() >= 300) return;

      let pathname = url;
      try {
        pathname = new URL(url).pathname;
      } catch {
        // keep full url
      }

      state.endpoints[sourceId] = {
        apiPath: pathname,
        apiOrigin: (() => {
          try { return new URL(url).origin; } catch { return ''; }
        })(),
        sampleUrl: url,
        discoveredAt: new Date().toISOString(),
        status: response.status()
      };
      console.log(`[BREM][api-discovery] ${sourceId} ← ${url}`);
    } catch {
      // ignore
    }
  };

  context.on('request', onRequest);
  context.on('response', onResponse);

  return () => {
    try {
      context.off('request', onRequest);
      context.off('response', onResponse);
    } catch {
      // ignore
    }
  };
}

function attachPageDiscovery(page, state) {
  if (!page || !state) return;
  page.on('framenavigated', frame => {
    try {
      if (frame !== page.mainFrame()) return;
      const url = frame.url();
      const sourceId = classifyPageUrl(url);
      if (!sourceId) return;
      state.endpoints[sourceId] = state.endpoints[sourceId] || {};
      state.endpoints[sourceId].pageUrl = url;
      state.endpoints[sourceId].pageDiscoveredAt = new Date().toISOString();
      console.log(`[BREM][page-discovery] ${sourceId} page=${url}`);
    } catch {
      // ignore
    }
  });
}

function buildRegistryFromDiscovery(state) {
  return {
    discoveredAt: new Date().toISOString(),
    requestCount: state.requests.length,
    responseCount: state.responses.length,
    endpoints: state.endpoints,
    recentResponses: state.responses.slice(-30).map(row => ({
      url: row.url,
      status: row.status,
      sourceId: row.sourceId
    }))
  };
}

module.exports = {
  API_REGISTRY_KEY,
  createApiDiscoveryState,
  attachApiDiscovery,
  attachPageDiscovery,
  buildRegistryFromDiscovery
};

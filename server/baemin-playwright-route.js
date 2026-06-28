const { buildCenterFetchHeaders } = require('./baemin-center-context');

function pickCenterRouteHeaders(discoveredHeaders = {}, centerContext = {}) {
  const headers = {
    ...buildCenterFetchHeaders(centerContext)
  };
  if (discoveredHeaders && typeof discoveredHeaders === 'object') {
    Object.entries(discoveredHeaders).forEach(([key, value]) => {
      const text = String(value || '').trim();
      if (text) headers[key] = text;
    });
  }

  const centerId = String(
    centerContext?.centerId
    || centerContext?.partnerId
    || centerContext?.managementId
    || ''
  ).trim();

  if (centerId && !Object.keys(headers).some(key => /center|partner|management/i.test(key))) {
    headers['center-id'] = centerId;
  }

  return headers;
}

function attachCenterApiRoute(context, options = {}) {
  if (!context?.route) return () => {};

  const injectHeaders = pickCenterRouteHeaders(
    options.discoveredHeaders,
    options.centerContext
  );
  if (!Object.keys(injectHeaders).length) return () => {};

  const pattern = '**/*api-deliverycenter.baemin.com/**';
  const handler = async route => {
    try {
      const url = route.request().url();
      if (!url.includes('api-deliverycenter.baemin.com')) {
        await route.continue();
        return;
      }
      await route.continue({
        headers: {
          ...route.request().headers(),
          ...injectHeaders
        }
      });
    } catch {
      try { await route.continue(); } catch { /* ignore */ }
    }
  };

  context.route(pattern, handler);
  console.log(`[BREM][collect] API route inject headers=${Object.keys(injectHeaders).join(',')}`);

  return () => {
    context.unroute(pattern, handler).catch(() => {});
  };
}

module.exports = {
  attachCenterApiRoute,
  pickCenterRouteHeaders
};

const BAEMIN_CENTER_API = 'https://api-deliverycenter.baemin.com/v2/center';

function extractCenterContext(payload) {
  if (!payload || typeof payload !== 'object') {
    return { centerId: '', managementId: '', partnerId: '' };
  }

  const data = payload.data ?? payload;
  const rows = Array.isArray(data) ? data : [data];
  const root = rows.find(row => row && typeof row === 'object') || {};

  const pick = (...values) => {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
    return '';
  };

  const centerId = pick(
    root.centerId,
    root.id,
    payload.centerId,
    payload.id
  );
  const managementId = pick(
    root.managementId,
    root.management_id,
    root.centerManagementId,
    centerId
  );
  const partnerId = pick(
    root.partnerId,
    root.partner_id,
    root.cooperationId,
    root.cooperation_id,
    root.companyId,
    root.company_id,
    managementId,
    centerId
  );

  return { centerId, managementId, partnerId, payload: root };
}

async function resolveCenterContextViaPage(page) {
  if (!page || page.isClosed()) return null;

  const storageHints = await page.evaluate(() => {
    const hints = {};
    const readStore = store => {
      try {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          const lower = String(key || '').toLowerCase();
          if (!/(center|partner|management|cooperation|company)/i.test(lower)) continue;
          hints[key] = store.getItem(key);
        }
      } catch {
        // ignore
      }
    };
    readStore(localStorage);
    readStore(sessionStorage);
    return hints;
  }).catch(() => ({}));

  const result = await page.evaluate(async (centerApi) => {
    try {
      const response = await fetch(centerApi, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' }
      });
      return {
        status: response.status,
        bodyText: await response.text()
      };
    } catch (error) {
      return { status: 0, bodyText: '', error: error.message || 'center fetch failed' };
    }
  }, BAEMIN_CENTER_API);

  if (!result?.bodyText) return null;

  let payload = null;
  try {
    payload = JSON.parse(result.bodyText);
  } catch {
    return null;
  }

  const center = extractCenterContext(payload);
  Object.values(storageHints || {}).forEach(raw => {
    const text = String(raw || '').trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      const nested = extractCenterContext(parsed);
      if (!center.centerId && nested.centerId) center.centerId = nested.centerId;
      if (!center.managementId && nested.managementId) center.managementId = nested.managementId;
      if (!center.partnerId && nested.partnerId) center.partnerId = nested.partnerId;
    } catch {
      if (!center.partnerId && /^\d+$/.test(text)) center.partnerId = text;
    }
  });

  return {
    ...center,
    status: result.status,
    storageHints
  };
}

function buildCenterFetchHeaders(centerContext = {}) {
  const headers = {};
  const { centerId, managementId, partnerId } = centerContext;
  if (managementId) {
    headers['management-id'] = managementId;
    headers['x-management-id'] = managementId;
  }
  if (centerId) {
    headers['center-id'] = centerId;
    headers['x-center-id'] = centerId;
  }
  if (partnerId) {
    headers['partner-id'] = partnerId;
    headers['x-partner-id'] = partnerId;
  }
  return headers;
}

function buildCenterQueryParams(centerContext = {}) {
  const query = {};
  const { centerId, managementId, partnerId } = centerContext;
  if (partnerId) {
    query.partnerId = partnerId;
    query.cooperationId = partnerId;
  }
  if (managementId) {
    query.managementId = managementId;
  }
  if (centerId) {
    query.centerId = centerId;
  }
  return query;
}

module.exports = {
  resolveCenterContextViaPage,
  extractCenterContext,
  buildCenterFetchHeaders,
  buildCenterQueryParams
};

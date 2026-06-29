const BAEMIN_CENTER_API = 'https://api-deliverycenter.baemin.com/v2/center';
const BAEMIN_CENTER_CHANGE_URL = 'https://deliverycenter.baemin.com/center/change';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pickField(row, ...keys) {
  for (const key of keys) {
    const value = String(row?.[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function extractCenterContext(payload) {
  if (!payload || typeof payload !== 'object') {
    return { centerId: '', managementId: '', partnerId: '', partnerName: '' };
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
  const partnerName = pickField(
    root,
    'name',
    'centerName',
    'partnerName',
    'cooperationName',
    'companyName',
    'title',
    'displayName',
    'managementName'
  );

  return { centerId, managementId, partnerId, partnerName, payload: root };
}

function mapCenterRow(row) {
  if (!row || typeof row !== 'object') return null;
  const ctx = extractCenterContext({ data: row });
  const partnerName = pickField(
    row,
    'name',
    'centerName',
    'partnerName',
    'cooperationName',
    'companyName',
    'title',
    'displayName',
    'managementName'
  ) || ctx.partnerName;
  const key = ctx.partnerId || ctx.centerId;
  if (!key) return null;
  return {
    centerId: ctx.centerId || key,
    managementId: ctx.managementId || key,
    partnerId: ctx.partnerId || key,
    partnerName: partnerName || key
  };
}

function extractCenterListFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload.data ?? payload;
  const rows = Array.isArray(data)
    ? data
    : (Array.isArray(data?.centers) ? data.centers : (data && typeof data === 'object' ? [data] : []));
  return rows.map(mapCenterRow).filter(Boolean);
}

async function fetchCenterPayloadViaPage(page) {
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
  try {
    return JSON.parse(result.bodyText);
  } catch {
    return null;
  }
}

async function scrapePartnersFromChangeDom(page) {
  return page.evaluate(() => {
    const partners = [];
    const seen = new Set();

    const push = (partnerId, centerId, partnerName) => {
      const key = String(partnerId || centerId || '').trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      partners.push({
        partnerId: partnerId || centerId || key,
        centerId: centerId || partnerId || key,
        managementId: centerId || partnerId || key,
        partnerName: String(partnerName || key).replace(/\s+/g, ' ').trim().slice(0, 120)
      });
    };

    document.querySelectorAll('[data-partner-id], [data-center-id], [data-management-id]').forEach(el => {
      push(
        el.getAttribute('data-partner-id'),
        el.getAttribute('data-center-id') || el.getAttribute('data-management-id'),
        el.textContent
      );
    });

    document.querySelectorAll('button, a, li, div, span, p').forEach(el => {
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120) return;
      const idMatch = text.match(/\b([A-Z]{2}\d{6,})\b/) || el.outerHTML.match(/([A-Z]{2}\d{6,})/);
      if (idMatch) push(idMatch[1], idMatch[1], text);
    });

    return partners;
  }).catch(() => []);
}

async function listPartnerCentersViaPage(page) {
  if (!page || page.isClosed()) return [];

  let capturedPayload = null;
  const handler = async response => {
    try {
      const url = response.url();
      if (!url.includes('/v2/center') || response.status() !== 200) return;
      capturedPayload = await response.json();
    } catch {
      // ignore
    }
  };

  page.on('response', handler);
  try {
    await page.goto(BAEMIN_CENTER_CHANGE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
      if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
    });
    await delay(2500);
  } finally {
    page.off('response', handler);
  }

  let partners = extractCenterListFromPayload(capturedPayload);
  if (partners.length <= 1) {
    const fetched = await fetchCenterPayloadViaPage(page);
    partners = extractCenterListFromPayload(fetched);
  }
  if (partners.length <= 1) {
    const domPartners = await scrapePartnersFromChangeDom(page);
    if (domPartners.length) partners = domPartners;
  }

  const seen = new Map();
  partners.forEach(partner => {
    const key = partner.partnerId || partner.centerId;
    if (!key) return;
    if (!seen.has(key)) seen.set(key, partner);
  });

  const list = Array.from(seen.values());
  console.log(`[BREM][center] 협력사 ${list.length}곳: ${list.map(p => `${p.partnerName || p.partnerId}`).join(', ')}`);
  return list;
}

async function selectPartnerCenter(page, target = {}) {
  if (!page || page.isClosed()) {
    throw new Error('Playwright 페이지가 없습니다.');
  }

  const targetId = String(target.partnerId || target.centerId || target.managementId || '').trim();
  const targetName = String(target.partnerName || '').trim();
  if (!targetId) throw new Error('협력사 ID가 없습니다.');

  await page.goto(BAEMIN_CENTER_CHANGE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
    if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
  });
  await delay(1500);

  const clicked = await page.evaluate(({ id, name }) => {
    const candidates = [
      ...document.querySelectorAll('[data-partner-id], [data-center-id], [data-management-id], button, a, li, div, span')
    ];
    for (const el of candidates) {
      const attrs = [
        el.getAttribute('data-partner-id'),
        el.getAttribute('data-center-id'),
        el.getAttribute('data-management-id')
      ].filter(Boolean);
      if (attrs.some(value => value === id)) {
        el.click();
        return 'attr';
      }
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.includes(id)) {
        el.click();
        return 'id-text';
      }
      if (name && text.includes(name)) {
        el.click();
        return 'name-text';
      }
    }
    return '';
  }, { id: targetId, name: targetName });

  if (!clicked) {
    const switched = await page.evaluate(async ({ id, centerApi }) => {
      const urls = [
        `${centerApi}/select`,
        `${centerApi}/change`,
        'https://api-deliverycenter.baemin.com/v2/center/select'
      ];
      for (const url of urls) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              centerId: id,
              partnerId: id,
              managementId: id,
              cooperationId: id
            })
          });
          if (response.ok) return url;
        } catch {
          // try next
        }
      }
      return '';
    }, { id: targetId, centerApi: BAEMIN_CENTER_API });
    if (!switched) {
      throw new Error(`협력사 UI/API 전환 실패: ${targetName || targetId}`);
    }
  }

  await delay(2500);
  const active = await resolveCenterContextViaPage(page);
  const activeId = String(active?.partnerId || active?.centerId || '').trim();
  if (activeId && activeId !== targetId) {
    throw new Error(`협력사 전환 확인 실패 (요청 ${targetId}, 현재 ${activeId})`);
  }

  return {
    centerId: active?.centerId || target.centerId || targetId,
    managementId: active?.managementId || target.managementId || targetId,
    partnerId: active?.partnerId || targetId,
    partnerName: targetName || active?.partnerName || targetId
  };
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

  const payload = await fetchCenterPayloadViaPage(page);
  if (!payload) return null;

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
      if (!center.partnerName && nested.partnerName) center.partnerName = nested.partnerName;
    } catch {
      if (!center.partnerId && /^\d+$/.test(text)) center.partnerId = text;
    }
  });

  return {
    ...center,
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
  BAEMIN_CENTER_CHANGE_URL,
  resolveCenterContextViaPage,
  extractCenterContext,
  extractCenterListFromPayload,
  listPartnerCentersViaPage,
  selectPartnerCenter,
  buildCenterFetchHeaders,
  buildCenterQueryParams
};

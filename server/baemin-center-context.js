const BAEMIN_CENTER_API = 'https://api-deliverycenter.baemin.com/v2/center';
const BAEMIN_CENTER_CHANGE_URL = 'https://deliverycenter.baemin.com/center/change';
const PARTNER_ID_PATTERN = /\(([A-Z]{2}\d+)\)/;
const PARTNER_LINE_PATTERN = /^(.+?)\s*\(([A-Z]{2}\d+)\)\s*$/;

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

function parsePartnerLine(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(PARTNER_LINE_PATTERN);
  if (!match) return null;
  return {
    partnerName: match[1].trim(),
    partnerId: match[2]
  };
}

function normalizePartnerEntry(partnerId, partnerName) {
  const id = String(partnerId || '').trim();
  if (!id) return null;
  const name = String(partnerName || id).trim();
  return {
    partnerId: id,
    centerId: id,
    managementId: id,
    partnerName: name
  };
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

  const centerId = pick(root.centerId, root.id, payload.centerId, payload.id);
  const managementId = pick(root.managementId, root.management_id, root.centerManagementId, centerId);
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
  return normalizePartnerEntry(ctx.partnerId || ctx.centerId, partnerName);
}

function extractCenterListFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload.data ?? payload;
  const rows = Array.isArray(data)
    ? data
    : (Array.isArray(data?.centers) ? data.centers : (data && typeof data === 'object' ? [data] : []));
  return rows.map(mapCenterRow).filter(Boolean);
}

function dedupePartners(partners) {
  const seen = new Map();
  (partners || []).forEach(partner => {
    const key = partner?.partnerId || partner?.centerId;
    if (!key) return;
    if (!seen.has(key)) seen.set(key, partner);
  });
  return Array.from(seen.values());
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

async function openPartnerDropdown(page) {
  const combo = page.locator('[role="combobox"]').first();
  if (await combo.count()) {
    await combo.click({ timeout: 5000 });
    await delay(600);
    return true;
  }

  const listboxTrigger = page.locator('[aria-haspopup="listbox"]').first();
  if (await listboxTrigger.count()) {
    await listboxTrigger.click({ timeout: 5000 });
    await delay(600);
    return true;
  }

  const currentPartner = page.locator('text=/\\([A-Z]{2}\\d+\\)/').first();
  if (await currentPartner.count()) {
    await currentPartner.click({ timeout: 5000 });
    await delay(600);
    return true;
  }

  const selectEl = page.locator('select').first();
  if (await selectEl.count()) {
    await selectEl.click({ timeout: 5000 });
    await delay(400);
    return true;
  }

  return false;
}

async function scrapePartnersFromChangePage(page) {
  await openPartnerDropdown(page);
  await delay(800);

  const partners = await page.evaluate(() => {
    const linePattern = /^(.+?)\s*\(([A-Z]{2}\d+)\)\s*$/;
    const seen = new Set();
    const results = [];

    const push = (name, id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      results.push({
        partnerId: id,
        centerId: id,
        managementId: id,
        partnerName: String(name || id).trim()
      });
    };

    document.querySelectorAll('[role="option"], option, li, button, div, span, p').forEach(el => {
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120) return;
      const match = text.match(linePattern);
      if (match) push(match[1], match[2]);
    });

    return results;
  });

  return dedupePartners(partners);
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

  let partners = dedupePartners([
    ...extractCenterListFromPayload(capturedPayload),
    ...await scrapePartnersFromChangePage(page)
  ]);

  if (partners.length <= 1) {
    const fetched = await fetchCenterPayloadViaPage(page);
    partners = dedupePartners([
      ...partners,
      ...extractCenterListFromPayload(fetched)
    ]);
  }

  if (!partners.length) {
    const active = await resolveCenterContextViaPage(page);
    if (active?.partnerId || active?.centerId) {
      partners = [normalizePartnerEntry(
        active.partnerId || active.centerId,
        active.partnerName || active.partnerId || active.centerId
      )];
    }
  }

  console.log(`[BREM][center] 협력사 ${partners.length}곳: ${partners.map(p => `${p.partnerName}(${p.partnerId})`).join(', ')}`);
  return partners.filter(Boolean);
}

async function clickPartnerConfirmButton(page) {
  const confirm = page.getByRole('button', { name: /선택\s*완료/ });
  if (await confirm.count()) {
    await confirm.click({ timeout: 8000 });
    return true;
  }
  const fallback = page.locator('button:has-text("선택 완료"), button:has-text("선택완료")').first();
  if (await fallback.count()) {
    await fallback.click({ timeout: 8000 });
    return true;
  }
  return false;
}

async function selectPartnerCenter(page, target = {}) {
  if (!page || page.isClosed()) {
    throw new Error('Playwright 페이지가 없습니다.');
  }

  const targetId = String(target.partnerId || target.centerId || target.managementId || '').trim();
  const targetName = String(target.partnerName || '').trim();
  if (!targetId) throw new Error('협력사 ID가 없습니다.');

  const current = await resolveCenterContextViaPage(page);
  const currentId = String(current?.partnerId || current?.centerId || '').trim();
  if (currentId === targetId) {
    return {
      centerId: current.centerId || targetId,
      managementId: current.managementId || targetId,
      partnerId: targetId,
      partnerName: targetName || current.partnerName || targetId
    };
  }

  await page.goto(BAEMIN_CENTER_CHANGE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
    if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
  });
  await delay(2000);

  const selectEl = page.locator('select').first();
  if (await selectEl.count()) {
    await selectEl.selectOption({ label: new RegExp(targetId) }).catch(async () => {
      await selectEl.selectOption(targetId).catch(() => {});
    });
  } else {
    await openPartnerDropdown(page);
    await delay(600);

    const optionById = page.locator(`text=${targetId}`).first();
    if (await optionById.count()) {
      await optionById.click({ timeout: 8000 });
    } else if (targetName) {
      const optionByName = page.getByText(targetName, { exact: false }).first();
      if (await optionByName.count()) {
        await optionByName.click({ timeout: 8000 });
      } else {
        throw new Error(`협력사 옵션을 찾지 못했습니다: ${targetName} (${targetId})`);
      }
    } else {
      throw new Error(`협력사 옵션을 찾지 못했습니다: ${targetId}`);
    }
  }

  await delay(500);
  const confirmed = await clickPartnerConfirmButton(page);
  if (!confirmed) {
    throw new Error('협력사 [선택 완료] 버튼을 찾지 못했습니다.');
  }

  await Promise.race([
    page.waitForURL(url => !String(url).includes('/center/change'), { timeout: 20000 }).catch(() => null),
    delay(3500)
  ]);
  await delay(1500);

  const active = await resolveCenterContextViaPage(page);
  const activeId = String(active?.partnerId || active?.centerId || '').trim();
  if (activeId && activeId !== targetId) {
    throw new Error(`협력사 전환 확인 실패 (요청 ${targetId}, 현재 ${activeId})`);
  }

  console.log(`[BREM][center] 협력사 전환 완료: ${targetName || targetId} (${targetId})`);
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
      if (!center.partnerId && PARTNER_ID_PATTERN.test(text)) {
        const match = text.match(PARTNER_ID_PATTERN);
        if (match) center.partnerId = match[1];
      }
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

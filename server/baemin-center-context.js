const BAEMIN_CENTER_API = 'https://api-deliverycenter.baemin.com/v2/center';
const BAEMIN_CENTER_CHANGE_URL = 'https://deliverycenter.baemin.com/center/change';
const PARTNER_ID_PATTERN = /\(([A-Z]{2}\d+)\)/;
const PARTNER_LINE_PATTERN = /^(.+?)\s*\(([A-Z]{2}\d+)\)\s*$/;
const VALID_PARTNER_ID = /^[A-Z]{2}\d{6,}$/i;

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

function isValidPartnerId(value) {
  return VALID_PARTNER_ID.test(String(value || '').trim());
}

function normalizePartnerEntry(partnerId, partnerName, extra = {}) {
  const id = String(partnerId || '').trim();
  if (!isValidPartnerId(id)) return null;
  const name = String(partnerName || id).trim();
  const headquarterName = String(extra.headquarterName || extra.regionName || '').trim();
  const regionName = String(extra.regionName || headquarterName || inferRegionFromPartnerName(name) || '').trim();
  return {
    partnerId: id,
    centerId: id,
    managementId: id,
    partnerName: name,
    headquarterName,
    regionName
  };
}

function inferRegionFromPartnerName(partnerName) {
  const text = String(partnerName || '').trim();
  const match = text.match(/표준(.+?)[A-Z]\s*팀/i) || text.match(/표준(.+?)[A-Z]/i);
  return match ? String(match[1] || '').trim() : '';
}

function extractCenterContext(payload) {
  if (!payload || typeof payload !== 'object') {
    return { centerId: '', managementId: '', partnerId: '', partnerName: '' };
  }

  const data = payload.data ?? payload;
  if (Array.isArray(data)) {
    return { centerId: '', managementId: '', partnerId: '', partnerName: '' };
  }

  const rows = [data];
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
  return normalizePartnerEntry(ctx.partnerId || ctx.centerId, partnerName, {
    headquarterName: pickField(row, 'headquarterName', 'regionName', 'areaName')
  });
}

function extractCenterListFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const data = payload.data ?? payload;
  const candidates = [];
  if (Array.isArray(data)) candidates.push(...data);
  if (Array.isArray(data?.centers)) candidates.push(...data.centers);
  if (Array.isArray(data?.centerList)) candidates.push(...data.centerList);
  if (Array.isArray(data?.list)) candidates.push(...data.list);
  if (!candidates.length && data && typeof data === 'object') candidates.push(data);
  return candidates.map(mapCenterRow).filter(Boolean);
}

function filterValidPartners(partners) {
  return dedupePartners(partners).filter(partner => isValidPartnerId(partner?.partnerId));
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

async function fetchAllCentersViaPage(page) {
  const results = await page.evaluate(async (centerApi) => {
    const urls = [
      `${centerApi}/list`,
      `${centerApi}/centers`,
      `${centerApi}/available`,
      centerApi
    ];
    const payloads = [];
    for (const url of urls) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json, text/plain, */*' }
        });
        if (!response.ok) continue;
        const bodyText = await response.text();
        if (!bodyText) continue;
        payloads.push({ url, body: JSON.parse(bodyText) });
      } catch {
        // try next
      }
    }
    return payloads;
  }, BAEMIN_CENTER_API).catch(() => []);

  const partners = [];
  (results || []).forEach(row => {
    partners.push(...extractCenterListFromPayload(row.body));
  });
  return filterValidPartners(partners);
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
  const partnerButtons = page.locator('main button, [role="main"] button, form button').filter({ hasText: /\([A-Z]{2}\d{6,}\)/ });
  const scopedCount = await partnerButtons.count();
  if (scopedCount) {
    await partnerButtons.first().click({ timeout: 8000 });
    await delay(800);
    return true;
  }

  const partnerButtonsFallback = page.locator('button').filter({ hasText: /\([A-Z]{2}\d{6,}\)/ });
  const buttonCount = await partnerButtonsFallback.count();
  for (let index = 0; index < buttonCount; index += 1) {
    const button = partnerButtonsFallback.nth(index);
    const label = String(await button.textContent() || '').trim();
    if (!label || /선택\s*완료/.test(label)) continue;
    await button.click({ timeout: 8000 });
    await delay(800);
    return true;
  }

  const combobox = page.locator('[role="combobox"]').first();
  if (await combobox.count()) {
    await combobox.click({ timeout: 5000 });
    await delay(600);
    return true;
  }

  const listboxTrigger = page.locator('[aria-haspopup="listbox"]').first();
  if (await listboxTrigger.count()) {
    await listboxTrigger.click({ timeout: 5000 });
    await delay(600);
    return true;
  }

  const changeBox = page.locator('text=협력사를 선택해주세요').first();
  if (await changeBox.count()) {
    const container = changeBox.locator('xpath=ancestor::*[self::div or self::section][1]');
    const trigger = container.locator('button, [role="button"], [class*="select"], [class*="Select"]').first();
    if (await trigger.count()) {
      await trigger.click({ timeout: 5000 });
      await delay(600);
      return true;
    }
    await changeBox.click({ timeout: 5000 }).catch(() => {});
    await delay(400);
  }

  const currentPartner = page.getByText(/DP\d{6,}/).first();
  if (await currentPartner.count()) {
    await currentPartner.click({ timeout: 5000 });
    await delay(600);
    return true;
  }

  return false;
}

async function clickPartnerOption(page, targetId, targetName) {
  const fullLabel = targetName ? `${targetName} (${targetId})` : targetId;
  const optionButtons = page.locator('main button, [role="main"] button, form button, [role="listbox"] button, [role="option"]').filter({ hasText: targetId });
  const buttonCount = await optionButtons.count();
  for (let index = 0; index < buttonCount; index += 1) {
    const button = optionButtons.nth(index);
    const label = String(await button.textContent() || '').trim();
    if (!label || /선택\s*완료/.test(label)) continue;
    if (!label.includes(targetId)) continue;
    await button.click({ timeout: 8000 });
    await delay(500);
    return true;
  }

  const fallbackButtons = page.locator('button').filter({ hasText: targetId });
  const fallbackCount = await fallbackButtons.count();
  for (let index = 0; index < fallbackCount; index += 1) {
    const button = fallbackButtons.nth(index);
    const label = String(await button.textContent() || '').trim();
    if (!label || /선택\s*완료/.test(label)) continue;
    if (!label.includes(targetId)) continue;
    await button.click({ timeout: 8000 });
    await delay(500);
    return true;
  }

  const scopes = [
    page.locator('[role="listbox"]'),
    page.locator('[role="presentation"]'),
    page.locator('[class*="Menu"]'),
    page.locator('[class*="menu"]'),
    page.locator('ul')
  ];

  for (const scope of scopes) {
    if (!(await scope.count())) continue;
    const optionByRole = scope.getByRole('option', { name: new RegExp(targetId, 'i') });
    if (await optionByRole.count()) {
      await optionByRole.first().click({ timeout: 8000 });
      await delay(400);
      return true;
    }
    const optionLocator = scope.locator('[role="option"], li, button, div').filter({ hasText: targetId });
    if (await optionLocator.count()) {
      await optionLocator.first().click({ timeout: 8000 });
      await delay(400);
      return true;
    }
  }

  const byLabel = page.getByText(fullLabel, { exact: false });
  if (await byLabel.count()) {
    await byLabel.first().click({ timeout: 8000 });
    await delay(400);
    return true;
  }

  return false;
}

async function readActivePartnerIdFromUi(page) {
  if (!page || page.isClosed()) return '';
  return page.evaluate(() => {
    const parenPattern = /\(([A-Z]{2}\d{6,})\)/;
    const scanTexts = roots => {
      for (const root of roots) {
        const text = String(root?.innerText || root?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 400) continue;
        const match = text.match(parenPattern);
        if (match) return match[1];
      }
      return '';
    };

    const headerRoots = [
      document.querySelector('header'),
      document.querySelector('nav'),
      document.querySelector('[class*="Header"]'),
      document.querySelector('[class*="header"]'),
      document.querySelector('[class*="gnb"]'),
      document.querySelector('main')
    ].filter(Boolean);
    const fromHeader = scanTexts(headerRoots);
    if (fromHeader) return fromHeader;

    const buttons = [...document.querySelectorAll('button, [role="button"]')];
    for (const button of buttons) {
      const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || /선택\s*완료/.test(text)) continue;
      const match = text.match(parenPattern);
      if (match) return match[1];
    }

    const shortBlocks = [...document.querySelectorAll('span, div, p, a, li')];
    for (const el of shortBlocks) {
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 5 || text.length > 120) continue;
      const match = text.match(parenPattern);
      if (match) return match[1];
    }
    return '';
  }).catch(() => '');
}

async function readActivePartnerDisplayFromPage(page) {
  if (!page || page.isClosed()) return { partnerId: '', partnerName: '' };
  const uiId = await readActivePartnerIdFromUi(page);
  if (!uiId) return { partnerId: '', partnerName: '' };
  const partnerName = await page.evaluate(id => {
    const parenPattern = new RegExp(`(.+?)\\(${id}\\)`);
    const texts = [...document.querySelectorAll('button, header, nav, span, div, p')]
      .map(el => String(el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(text => text.includes(id) && text.length < 160);
    for (const text of texts) {
      const match = text.match(parenPattern);
      if (match) return match[1].trim();
    }
    return '';
  }, uiId).catch(() => '');
  return { partnerId: uiId, partnerName: partnerName || uiId };
}

async function readCenterSessionCookie(page) {
  if (!page || page.isClosed()) return '';
  try {
    const cookies = await page.context().cookies('https://deliverycenter.baemin.com');
    return cookies.find(cookie => cookie.name === 'CENTER_SESSION')?.value || '';
  } catch {
    return '';
  }
}

async function readActivePartnerIdFromPage(page) {
  if (!page || page.isClosed()) return '';

  const fromUi = await readActivePartnerIdFromUi(page);
  if (fromUi) return fromUi;

  const url = page.url();
  if (!url.includes('/center/change')) {
    const payload = await fetchCenterPayloadViaPage(page);
    if (payload) {
      const data = payload.data ?? payload;
      if (!Array.isArray(data)) {
        const ctx = extractCenterContext(payload);
        const apiId = String(ctx.partnerId || ctx.centerId || '').trim();
        if (apiId) return apiId;
      }
    }
  }

  const fromApi = await resolveCenterContextViaPage(page);
  return String(fromApi?.partnerId || fromApi?.centerId || '').trim();
}

async function waitForActivePartnerId(page, targetId, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const uiId = await readActivePartnerIdFromUi(page);
    if (uiId === targetId) {
      const display = await readActivePartnerDisplayFromPage(page);
      return {
        centerId: targetId,
        managementId: targetId,
        partnerId: targetId,
        partnerName: display.partnerName || targetId
      };
    }
    const activeId = await readActivePartnerIdFromPage(page);
    if (activeId === targetId) {
      return await resolveCenterContextViaPage(page) || {
        centerId: targetId,
        managementId: targetId,
        partnerId: targetId
      };
    }
    await delay(800);
  }
  return null;
}

async function capturePartnerSwitchRequests(page, fn) {
  const captured = [];
  const pending = new Map();
  const onRequest = request => {
    const url = request.url();
    if (!url.includes('api-deliverycenter')) return;
    const method = request.method();
    const key = `${method} ${url}`;
    pending.set(key, {
      method,
      url,
      postData: request.postData() || '',
      headers: request.headers()
    });
  };
  const onResponse = async response => {
    const url = response.url();
    if (!url.includes('api-deliverycenter')) return;
    const req = response.request();
    const method = req.method();
    const key = `${method} ${url}`;
    const base = pending.get(key) || {
      method,
      url,
      postData: req.postData() || ''
    };
    let bodyText = '';
    let payload = null;
    try { bodyText = await response.text(); } catch { /* ignore */ }
    try { payload = bodyText ? JSON.parse(bodyText) : null; } catch { payload = null; }
    const { classifyApiUrl } = require('./baemin-collect-sources');
    captured.push({
      method: base.method,
      url: base.url,
      postData: base.postData,
      headers: base.headers || req.headers(),
      status: response.status(),
      bodyText: bodyText.slice(0, 8000),
      payload,
      sourceMenu: classifyApiUrl(url)
    });
    pending.delete(key);
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    const result = await fn();
    pending.forEach(row => captured.push({ ...row, status: 0 }));
    return { result, captured };
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
  }
}

async function waitForCenterSessionChange(page, beforeValue = '', timeoutMs = 15000) {
  const before = String(beforeValue || '').trim();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = await readCenterSessionCookie(page);
    if (current && current !== before) return current;
    await delay(500);
  }
  return readCenterSessionCookie(page);
}

function pickSwitchReplayRequest(captured = [], targetId = '') {
  const rows = (captured || []).filter(row => {
    const method = String(row.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return false;
    const url = String(row.url || '');
    if (!/api-deliverycenter\.baemin\.com/i.test(url)) return false;
    if (Number(row.status) && (Number(row.status) < 200 || Number(row.status) >= 300)) return false;
    return /center|management|cooperation|partner|switch|select|current/i.test(url)
      || String(row.postData || '').includes(targetId);
  });
  if (!rows.length) return null;
  const preferred = rows.filter(row =>
    String(row.url || '').includes(targetId) || String(row.postData || '').includes(targetId)
  );
  const list = preferred.length ? preferred : rows;
  return list[list.length - 1] || null;
}

async function replayCapturedCenterSwitch(page, captured = [], targetId = '') {
  const row = pickSwitchReplayRequest(captured, targetId);
  if (!row?.url) return false;
  const replay = await page.evaluate(async ({ url, method, postData, headers }) => {
    try {
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          ...(headers && typeof headers === 'object' ? headers : {})
        },
        body: postData || undefined
      });
      return { ok: response.ok, status: response.status };
    } catch (error) {
      return { ok: false, status: 0, error: error.message || 'replay failed' };
    }
  }, {
    url: row.url,
    method: row.method,
    postData: row.postData || '',
    headers: row.headers || {}
  }).catch(() => ({ ok: false }));
  if (replay.ok) {
    console.log(`[BREM][center] 캡처 API 재실행: ${row.method} ${row.url}`);
    await delay(1500);
    return true;
  }
  return false;
}

async function trySwitchCenterViaApi(page, targetId) {
  const result = await page.evaluate(async ({ centerId, centerApi }) => {
    const body = {
      id: centerId,
      centerId,
      partnerId: centerId,
      cooperationId: centerId,
      managementId: centerId
    };
    const attempts = [
      { url: `${centerApi}/current`, method: 'PUT' },
      { url: `${centerApi}/current`, method: 'POST' },
      { url: `${centerApi}/select`, method: 'POST' },
      { url: `${centerApi}/change`, method: 'POST' },
      { url: `${centerApi}/switch`, method: 'POST' },
      { url: `${centerApi}/${centerId}`, method: 'PUT' },
      { url: `${centerApi}/${centerId}/select`, method: 'POST' },
      { url: `${centerApi}`, method: 'PUT' },
      { url: `${centerApi}`, method: 'PATCH' }
    ];
    for (const attempt of attempts) {
      try {
        const response = await fetch(attempt.url, {
          method: attempt.method,
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        if (response.ok) {
          return { ok: true, url: attempt.url, method: attempt.method, status: response.status };
        }
      } catch {
        // try next
      }
    }
    return { ok: false };
  }, { centerId: targetId, centerApi: BAEMIN_CENTER_API });

  if (result?.ok) {
    console.log(`[BREM][center] API 전환 성공: ${targetId} via ${result.method} ${result.url}`);
    await delay(2000);
    return true;
  }
  return false;
}

async function scrapePartnersFromChangePage(page) {
  await openPartnerDropdown(page);
  await delay(800);

  const partners = await page.evaluate(() => {
    const linePattern = /^(.+?)\s*\(([A-Z]{2}\d+)\)\s*$/;
    const inferRegion = name => {
      const text = String(name || '').trim();
      const match = text.match(/표준(.+?)[A-Z]\s*팀/i) || text.match(/표준(.+?)[A-Z]/i);
      return match ? String(match[1] || '').trim() : '';
    };
    const seen = new Set();
    const results = [];

    const push = (name, id, headquarterName = '') => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      results.push({
        partnerId: id,
        centerId: id,
        managementId: id,
        partnerName: String(name || id).trim(),
        headquarterName: String(headquarterName || '').trim(),
        regionName: inferRegion(name) || String(headquarterName || '').trim()
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

  return filterValidPartners(partners);
}

async function listPartnerCentersViaPage(page) {
  if (!page || page.isClosed()) return [];

  let capturedPayloads = [];
  const handler = async response => {
    try {
      const url = response.url();
      if (!url.includes('api-deliverycenter') || response.status() !== 200) return;
      if (!/\/center/i.test(url)) return;
      capturedPayloads.push(await response.json());
    } catch {
      // ignore
    }
  };

  page.on('response', handler);
  try {
    await page.goto(BAEMIN_CENTER_CHANGE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
      if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
    });
    await delay(1500);
  } finally {
    page.off('response', handler);
  }

  let partners = filterValidPartners([
    ...capturedPayloads.flatMap(payload => extractCenterListFromPayload(payload)),
    ...await fetchAllCentersViaPage(page)
  ]);

  try {
    partners = filterValidPartners([...partners, ...await scrapePartnersFromChangePage(page)]);
  } catch (error) {
    console.warn('[BREM][center] 협력사 UI 스크랩 실패:', error.message);
  }

  if (partners.length <= 1) {
    const fetched = await fetchCenterPayloadViaPage(page);
    partners = filterValidPartners([
      ...partners,
      ...extractCenterListFromPayload(fetched)
    ]);
  }

  if (!partners.length) {
    const active = await resolveCenterContextViaPage(page);
    const single = normalizePartnerEntry(active?.partnerId || active?.centerId, active?.partnerName);
    if (single) partners = [single];
  }

  console.log(`[BREM][center] 협력사 ${partners.length}곳: ${partners.map(p => `${p.partnerName}(${p.partnerId})`).join(', ')}`);
  return partners;
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

function findSuccessfulMenuCapture(capturedList, menu) {
  const { classifyApiUrl } = require('./baemin-collect-sources');
  const menuId = String(menu || 'delivery_status').trim();
  const rows = (capturedList || []).filter(row => {
    const status = Number(row.status || 0);
    if (status < 200 || status >= 300) return false;
    const sourceMenu = row.sourceMenu || classifyApiUrl(row.url || '');
    if (sourceMenu === menuId) return true;
    if (menuId === 'delivery_status' && /\/management\/delivery-status/i.test(String(row.url || ''))) return true;
    if (menuId === 'daily_history' && /\/daily-delivery-status/i.test(String(row.url || ''))) return true;
    if (menuId === 'rider_history' && /\/rider-delivery-status/i.test(String(row.url || ''))) return true;
    return false;
  });
  return rows[rows.length - 1] || null;
}

function normalizeNetworkRowToCaptured(row, sourceMenu = '') {
  const { classifyApiUrl } = require('./baemin-collect-sources');
  const { extractDataArray, readTotalPages } = require('./baemin-api-fetch');
  let payload = row?.payload || null;
  if (!payload && row?.bodyText) {
    try { payload = JSON.parse(row.bodyText); } catch { payload = null; }
  }
  const menu = String(sourceMenu || row?.sourceMenu || classifyApiUrl(row?.url || '') || '').trim();
  const items = payload ? (extractDataArray(payload) || []) : [];
  let apiPath = '';
  let apiOrigin = '';
  try {
    const parsed = new URL(String(row.url || ''));
    apiPath = parsed.pathname;
    apiOrigin = parsed.origin;
  } catch {
    // ignore
  }
  return {
    ok: true,
    sourceMenu: menu,
    method: row?.method || 'GET',
    url: row?.url,
    sampleUrl: row?.url,
    headers: row?.headers || {},
    requestHeaders: row?.headers || {},
    postData: row?.postData || '',
    status: Number(row?.status || 0),
    spaPayload: payload,
    spaItems: items,
    spaTotalPage: payload ? readTotalPages(payload) : 1,
    apiPath,
    apiOrigin,
    fromNetworkCapture: true
  };
}

async function assertCenterSessionExists(page) {
  const session = String(await readCenterSessionCookie(page) || '').trim();
  if (!session) {
    return { ok: false, reason: 'CENTER_SESSION 없음' };
  }
  return { ok: true, session };
}

async function readPartnerIdsForApi(page) {
  const ui = await readActivePartnerDisplayFromPage(page);
  const center = await resolveCenterContextViaPage(page).catch(() => null);
  const partnerId = String(ui.partnerId || center?.partnerId || center?.centerId || '').trim();
  const centerId = String(center?.centerId || partnerId || '').trim();
  const managementId = String(center?.managementId || centerId || '').trim();
  return {
    partnerId,
    centerId,
    managementId,
    partnerName: ui.partnerName || center?.partnerName || partnerId
  };
}

function logBaeminApiRequest(phase, details = {}) {
  console.log(`[BREM][api-request] ${phase}`);
  console.log(`[BREM][api-request] partnerId=${details.partnerId || '-'} centerId=${details.centerId || '-'} managementId=${details.managementId || '-'}`);
  console.log(`[BREM][api-request] method=${details.method || 'GET'}`);
  console.log(`[BREM][api-request] url=${details.url || '-'}`);
  console.log(`[BREM][api-request] headers=${JSON.stringify(details.headers || {})}`);
  console.log(`[BREM][api-request] body=${details.body || details.postData || ''}`);
}

function storeCapturedApiRequest(page, sourceMenu, captured) {
  if (!page || page.isClosed() || !captured?.url) return;
  const ctx = page.context();
  ctx.__bremCapturedApiRequests = ctx.__bremCapturedApiRequests || {};
  ctx.__bremCapturedApiRequests[sourceMenu] = captured;
}

function getStoredCapturedApiRequest(page, sourceMenu) {
  return page?.context()?.__bremCapturedApiRequests?.[sourceMenu] || null;
}

async function waitForPartnerSwitchComplete(page, targetId, options = {}) {
  const partnerId = String(targetId || '').trim();
  const requireSessionChange = Boolean(options.requireSessionChange);
  const sessionBefore = String(options.sessionBefore || '').trim();
  const switchCaptured = options.switchCaptured || page.context()?.__bremLastSwitchCaptured || [];
  const maxAttempts = Number(options.maxAttempts || 3);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const sessionNow = String(await readCenterSessionCookie(page) || '').trim();
    if (!sessionNow) {
      console.warn(`[BREM][center] 전환확인 ${attempt}/${maxAttempts} — CENTER_SESSION 없음`);
      if (attempt < maxAttempts) {
        await delay(1500);
        continue;
      }
      return { ok: false, reason: 'CENTER_SESSION 없음' };
    }

    const ui = await readActivePartnerDisplayFromPage(page);
    const center = await resolveCenterContextViaPage(page).catch(() => null);
    const apiPartnerId = String(center?.partnerId || center?.centerId || '').trim();
    const sessionChanged = Boolean(sessionBefore && sessionNow && sessionNow !== sessionBefore);
    const uiOk = ui.partnerId === partnerId;
    const apiOk = apiPartnerId === partnerId;
    const deliveryCapture = findSuccessfulMenuCapture(switchCaptured, 'delivery_status');
    const deliveryRows = deliveryCapture?.payload
      ? (require('./baemin-api-fetch').extractDataArray(deliveryCapture.payload) || [])
      : [];
    const deliveryOk = Boolean(deliveryCapture && Number(deliveryCapture.status) === 200 && deliveryRows.length > 0);
    const sessionGateOk = !requireSessionChange || sessionChanged || (uiOk && apiOk && deliveryOk);

    console.log(`[BREM][center] 전환확인 ${attempt}/${maxAttempts} target=${partnerId} ui=${ui.partnerId || '-'} api=${apiPartnerId || '-'} session=${sessionChanged ? 'changed' : (sessionBefore ? 'same' : 'ready')} deliveryCapture=${deliveryOk ? 'ok' : 'no'}`);

    if (uiOk && apiOk && sessionGateOk && sessionNow) {
      return {
        ok: true,
        ui,
        center,
        session: sessionNow,
        sessionChanged,
        deliveryCapture
      };
    }

    if (attempt < maxAttempts) {
      console.warn(`[BREM][center] 전환 미완료 — 캡처/전환 API 재실행 (${partnerId})`);
      await replayCapturedCenterSwitch(page, switchCaptured, partnerId);
      await trySwitchCenterViaApi(page, partnerId);
      await waitForCenterSessionChange(page, sessionBefore, 6000);
      await delay(1200);
    }
  }

  const ui = await readActivePartnerDisplayFromPage(page);
  const sessionNow = await readCenterSessionCookie(page);
  const center = await resolveCenterContextViaPage(page).catch(() => null);
  const reason = !sessionNow
    ? 'CENTER_SESSION 없음'
    : (requireSessionChange && sessionBefore && sessionNow === sessionBefore
      ? 'CENTER_SESSION 미변경'
      : 'partner_id_mismatch');
  return {
    ok: false,
    reason,
    ui,
    center,
    session: sessionNow
  };
}

async function fetchViaCapturedBrowserRequest(page, captured, phase = 'replay') {
  if (!captured?.url) {
    return { ok: false, status: 400, message: '캡처된 API 요청 없음' };
  }
  const { fetchBaeminJsonViaPage, extractIdsFromCapturedRequest } = require('./baemin-playwright-fetch');
  const ids = extractIdsFromCapturedRequest(captured);
  const headers = captured.headers || captured.requestHeaders || null;
  return fetchBaeminJsonViaPage(
    page,
    captured.url,
    ids,
    headers,
    String(captured.method || 'GET').toUpperCase(),
    captured.postData || ''
  );
}

async function ensureCapturedMenuApiRequest(page, sourceMenu, dateRange = null, options = {}) {
  const menu = String(sourceMenu || 'delivery_status').trim();
  const partnerId = String(options.partnerId || '').trim();
  const switchCaptured = options.switchCaptured || page.context()?.__bremLastSwitchCaptured || [];

  const sessionReady = await assertCenterSessionExists(page);
  if (!sessionReady.ok) {
    return { ok: false, reason: sessionReady.reason || 'CENTER_SESSION 없음' };
  }

  const switchReady = await waitForPartnerSwitchComplete(page, partnerId, {
    ...options,
    switchCaptured
  });
  if (!switchReady.ok) {
    return { ok: false, reason: switchReady.reason || 'partner_switch_incomplete', switchReady };
  }

  const fromSwitch = findSuccessfulMenuCapture(switchCaptured, menu);
  if (fromSwitch) {
    const normalized = normalizeNetworkRowToCaptured(fromSwitch, menu);
    const rows = normalized.spaItems || [];
    console.log(`[BREM][api-capture] ${menu} ← switch-network ${normalized.method} ${normalized.url} status=${normalized.status} rows=${rows.length}`);
    storeCapturedApiRequest(page, menu, normalized);
    return { ok: true, captured: normalized, switchReady, fromSwitchNetwork: true };
  }

  const stored = getStoredCapturedApiRequest(page, menu);
  if (stored?.url && stored?.fromNetworkCapture && (stored.spaItems?.length || stored.spaPayload)) {
    return { ok: true, captured: stored, switchReady, fromCache: true };
  }

  const { captureBrowserMenuApiRequest } = require('./baemin-page-capture');
  const captured = await captureBrowserMenuApiRequest(page, menu, dateRange);
  if (!captured.ok) {
    return { ok: false, reason: 'api_capture_failed', message: captured.message, tried: captured.tried || [] };
  }

  storeCapturedApiRequest(page, menu, captured);
  return { ok: true, captured, switchReady };
}

async function verifyPartnerMenuApiContext(page, targetId, sourceMenu = 'delivery_status', baselineSample = '', dateRange = null, options = {}) {
  const partnerId = String(targetId || '').trim();
  const menu = String(sourceMenu || 'delivery_status').trim();

  const ensured = await ensureCapturedMenuApiRequest(page, menu, dateRange, {
    ...options,
    partnerId
  });
  if (!ensured.ok) {
    return {
      ok: false,
      reason: ensured.reason || 'api_capture_failed',
      ui: ensured.switchReady?.ui || null,
      sample: { message: ensured.message || '', tried: ensured.tried || [] },
      sourceMenu: menu
    };
  }

  const captured = ensured.captured;
  const { extractDataArray } = require('./baemin-api-fetch');
  const capturedRows = captured.spaItems || extractDataArray(captured.spaPayload) || [];
  const hasValidCapture = Boolean(
    captured.spaPayload
    && Number(captured.status || 200) === 200
    && capturedRows.length > 0
  );

  let result = null;
  if (hasValidCapture) {
    console.log(`[BREM][center] ${menu} verify — 캡처 응답 재사용 rows=${capturedRows.length} (replay 생략)`);
    result = {
      ok: true,
      status: 200,
      payload: captured.spaPayload,
      message: ''
    };
  } else {
    result = await fetchViaCapturedBrowserRequest(page, captured, `${menu}-verify`);
    if (!result.ok && (result.status === 401 || result.status === 403)) {
      console.warn(`[BREM][center] ${menu} verify ${result.status} — replay 중단, page-fetch만 사용`);
    }
  }

  const verifyRows = result.ok ? (extractDataArray(result.payload) || capturedRows) : [];
  const extractStatusFingerprint = payload => {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows
      .map(row => {
        const acceptance = row?.deliveryAcceptanceCount || {};
        const complete = acceptance.totalComplete ?? row.totalComplete ?? row.completeCount ?? 0;
        return `${row.userId || row.riderId || row.name || row.phoneNumber || ''}:${complete}`;
      })
      .join('|');
  };
  const extractDailyFingerprint = payload => {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows
      .map(row => `${row.businessDay || row.deliveryDate || row.date}:${row.totalComplete ?? row.completeCount ?? row.deliveryCount ?? 0}`)
      .join('|');
  };
  const extract = menu === 'daily_history' ? extractDailyFingerprint : extractStatusFingerprint;
  const sample = {
    status: result.status || 0,
    fingerprint: result.ok ? extract(result.payload || {}) : '',
    message: result.message || result.error || '',
    probeUrl: captured.url
  };

  if (!result.ok) {
    console.warn(`[BREM][center] ${menu} API verify failed partner=${partnerId} status=${sample.status} message=${sample.message || '-'}`);
    return { ok: false, reason: 'api_probe_failed', ui: ensured.switchReady.ui, sample, sourceMenu: menu, captured };
  }

  if (menu === 'delivery_status' && !verifyRows.length) {
    console.warn(`[BREM][center] ${menu} API verify empty rows partner=${partnerId}`);
    return { ok: false, reason: 'empty_data', ui: ensured.switchReady.ui, sample, sourceMenu: menu, captured };
  }

  const baseline = String(baselineSample || '').trim();
  if (baseline && sample.fingerprint && sample.fingerprint === baseline) {
    return { ok: false, reason: 'same_as_baseline', ui: ensured.switchReady.ui, sample, sourceMenu: menu, captured };
  }

  return { ok: true, ui: ensured.switchReady.ui, sample, sourceMenu: menu, captured };
}

async function verifyPartnerApiContext(page, targetId, baselineSample = '', dateRange = null) {
  return verifyPartnerMenuApiContext(page, targetId, 'delivery_status', baselineSample, dateRange);
}

async function waitForPartnerMenuApiReady(page, targetId, sourceMenu, baselineFingerprint = '', dateRange = null, options = {}) {
  const menu = String(sourceMenu || 'delivery_status').trim();
  const partnerId = String(targetId || '').trim();
  const switchCaptured = options.switchCaptured || page.context()?.__bremLastSwitchCaptured || [];

  const verified = await verifyPartnerMenuApiContext(
    page,
    partnerId,
    menu,
    baselineFingerprint,
    dateRange,
    {
      ...options,
      switchCaptured,
      partnerId,
      maxAttempts: 2
    }
  );
  if (verified.ok) return verified;

  if (verified.reason === 'ui_mismatch' || verified.reason === 'partner_switch_incomplete') {
    return verified;
  }

  const authBlocked = verified.sample?.status === 401 || verified.sample?.status === 403;
  if (authBlocked) {
    console.warn(`[BREM][center] ${menu} API ${verified.sample?.status} — 재시도 생략 partner=${partnerId}`);
    return verified;
  }

  if (verified.reason === 'same_as_baseline') {
    await replayCapturedCenterSwitch(page, switchCaptured, partnerId);
    await trySwitchCenterViaApi(page, partnerId);
    await delay(800);
    return verifyPartnerMenuApiContext(page, partnerId, menu, baselineFingerprint, dateRange, {
      ...options,
      switchCaptured,
      partnerId
    });
  }

  return verified;
}

async function ensurePartnerSessionReady(page, targetId, options = {}) {
  const baseline = String(options.baselineFingerprint || '');
  const dateRange = options.dateRange || null;
  const switchCaptured = options.switchCaptured || page.context()?.__bremLastSwitchCaptured || [];

  const sessionReady = await assertCenterSessionExists(page);
  if (!sessionReady.ok) {
    return { ok: false, reason: sessionReady.reason || 'CENTER_SESSION 없음', ui: null, sample: null };
  }

  const switchReady = await waitForPartnerSwitchComplete(page, targetId, {
    sessionBefore: options.sessionBefore || '',
    requireSessionChange: Boolean(options.requireSessionChange),
    switchCaptured,
    maxAttempts: 3
  });
  if (!switchReady.ok) {
    return { ok: false, reason: switchReady.reason || 'partner_switch_incomplete', ui: switchReady.ui, sample: null };
  }

  return verifyPartnerMenuApiContext(page, targetId, 'delivery_status', baseline, dateRange, {
    ...options,
    switchCaptured,
    partnerId: targetId,
    requireSessionChange: false
  });
}

async function selectPartnerCenter(page, target = {}) {
  if (!page || page.isClosed()) {
    throw new Error('Playwright 페이지가 없습니다.');
  }

  const context = page.context();
  const wasCollecting = Boolean(context.__bremCollecting);
  context.__bremCollecting = false;

  try {
    return await selectPartnerCenterInner(page, target);
  } finally {
    context.__bremCollecting = wasCollecting;
  }
}

async function selectPartnerCenterInner(page, target = {}) {
  if (!page || page.isClosed()) {
    throw new Error('Playwright 페이지가 없습니다.');
  }

  const targetId = String(target.partnerId || target.centerId || target.managementId || '').trim();
  const targetName = String(target.partnerName || '').trim();
  const requireSessionChange = Boolean(target.requireSessionChange);
  if (!isValidPartnerId(targetId)) {
    throw new Error(`협력사 ID가 올바르지 않습니다: ${targetId || '(empty)'}`);
  }

  const sessionBefore = await readCenterSessionCookie(page);
  const currentId = String(
    (await readActivePartnerIdFromUi(page))
    || (await readActivePartnerIdFromPage(page))
    || (await resolveCenterContextViaPage(page))?.partnerId
    || (await resolveCenterContextViaPage(page))?.centerId
    || ''
  ).trim();

  if (currentId === targetId) {
    console.log(`[BREM][center] 이미 선택된 협력사 — API 세션 재동기화 (${targetId})`);
    await trySwitchCenterViaApi(page, targetId);
    await delay(1200);
    const switchReady = await waitForPartnerSwitchComplete(page, targetId, {
      sessionBefore,
      requireSessionChange,
      switchCaptured: page.context()?.__bremLastSwitchCaptured || [],
      maxAttempts: 3
    });
    if (!switchReady.ok) {
      throw new Error(`협력사 세션 확인 실패 (${targetId}) — ${switchReady.reason || 'unknown'}`);
    }
    const display = switchReady.ui || await readActivePartnerDisplayFromPage(page);
    console.log(`[BREM][center] 협력사 전환 완료: ${display.partnerName || targetName || targetId} (${targetId})`);
    return {
      centerId: switchReady.center?.centerId || targetId,
      managementId: switchReady.center?.managementId || targetId,
      partnerId: targetId,
      partnerName: targetName || display.partnerName || targetId,
      regionName: target.regionName || inferRegionFromPartnerName(targetName)
    };
  }

  const sessionBeforeSwitch = sessionBefore;

  await page.goto(BAEMIN_CENTER_CHANGE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => {
    if (!String(error.message || '').includes('ERR_ABORTED')) throw error;
  });
  await delay(2500);

  const performUiSwitch = async () => {
    console.log(`[BREM][center] UI 전환 시작: ${targetName || targetId} (${targetId})`);

    const trigger = page.getByRole('button', { name: /\([A-Z]{2}\d{6,}\)/ }).filter({ hasNotText: /선택\s*완료/ }).first();
    await trigger.click({ timeout: 10000 });
    await delay(1000);

    const optionLabel = targetName ? `${targetName} (${targetId})` : targetId;
    const { textMatchesPartner } = require('./baemin-partner-match');
    const textOption = page.getByText(optionLabel, { exact: true });
    if (await textOption.count()) {
      await textOption.first().click({ timeout: 8000 });
    } else {
      const optionLocators = [
        page.getByRole('button', { name: optionLabel, exact: true }),
        page.getByRole('option', { name: new RegExp(targetId) }),
        page.locator('li, [role="option"]').filter({ hasText: targetId }),
        page.getByRole('button', { name: new RegExp(targetId) }).last()
      ];
      let picked = false;
      for (const locator of optionLocators) {
        if (!(await locator.count())) continue;
        await locator.first().click({ timeout: 8000 });
        picked = true;
        break;
      }
      if (!picked) {
        const fuzzyCandidates = page.locator('li, [role="option"], button, a').filter({ hasText: targetId });
        if (await fuzzyCandidates.count()) {
          await fuzzyCandidates.first().click({ timeout: 8000 });
          picked = true;
        }
      }
      if (!picked && targetName) {
        const allOptions = page.locator('li, [role="option"], button, a');
        const count = await allOptions.count();
        for (let index = 0; index < count; index += 1) {
          const option = allOptions.nth(index);
          const label = String(await option.textContent().catch(() => '') || '').trim();
          if (!textMatchesPartner(label, targetId, targetName)) continue;
          await option.click({ timeout: 8000 });
          picked = true;
          break;
        }
      }
      if (!picked) {
        throw new Error(`협력사 옵션을 찾지 못했습니다: ${optionLabel}`);
      }
    }
    await delay(800);

    const confirmBtn = page.getByRole('button', { name: /선택\s*완료/ });
    if (await confirmBtn.isDisabled()) {
      throw new Error('협력사 [선택 완료] 버튼이 비활성 상태입니다.');
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null),
      confirmBtn.click({ timeout: 10000 })
    ]);

    await page.evaluate(centerId => {
      try {
        localStorage.setItem('centerId', centerId);
        sessionStorage.setItem('centerId', centerId);
      } catch {
        // ignore
      }
    }, targetId).catch(() => {});

    await delay(1500);
    return waitForActivePartnerId(page, targetId, 20000);
  };

  const { result: active, captured: switchCaptured } = await capturePartnerSwitchRequests(page, performUiSwitch);
  page.context().__bremLastSwitchCaptured = switchCaptured;

  const deliveryHit = findSuccessfulMenuCapture(switchCaptured, 'delivery_status');
  if (deliveryHit) {
    storeCapturedApiRequest(page, 'delivery_status', normalizeNetworkRowToCaptured(deliveryHit, 'delivery_status'));
  }

  let sessionAfter = await readCenterSessionCookie(page);
  if (!sessionAfter || sessionAfter === sessionBeforeSwitch) {
    console.warn(`[BREM][center] CENTER_SESSION 미변경 → 캡처/API 재전환 (${targetId})`);
    console.warn('[BREM][center] 전환 네트워크:', JSON.stringify(switchCaptured.slice(-6).map(row => ({
      method: row.method,
      url: row.url,
      status: row.status || 0
    }))));
    await replayCapturedCenterSwitch(page, switchCaptured, targetId);
    await trySwitchCenterViaApi(page, targetId);
    sessionAfter = await waitForCenterSessionChange(page, sessionBeforeSwitch, 12000);
    if (sessionAfter && sessionAfter !== sessionBeforeSwitch) {
      console.log(`[BREM][center] CENTER_SESSION 변경됨 (${targetId})`);
    } else {
      console.warn(`[BREM][center] CENTER_SESSION 여전히 동일 (${targetId})`);
    }
  } else {
    console.log(`[BREM][center] CENTER_SESSION 변경 감지 (${targetId})`);
  }

  if (!page.url().includes('/delivery/history')) {
    await page.goto('https://deliverycenter.baemin.com/delivery/history', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }).catch(() => {});
    await delay(1500);
  }

  const switchReady = await waitForPartnerSwitchComplete(page, targetId, {
    sessionBefore: sessionBeforeSwitch,
    requireSessionChange,
    switchCaptured,
    maxAttempts: 3
  });
  if (!switchReady.ok) {
    console.warn('[BREM][center] 전환 네트워크:', JSON.stringify(switchCaptured.slice(-8)));
    throw new Error(`협력사 전환 미완료 (${targetId}) — ${switchReady.reason || 'CENTER_SESSION 미변경'}`);
  }

  const uiDisplay = switchReady.ui || await readActivePartnerDisplayFromPage(page);
  console.log(`[BREM][center] 협력사 전환 완료: ${uiDisplay.partnerName || targetName || targetId} (${targetId})`);
  return {
    centerId: switchReady.center?.centerId || active?.centerId || target.centerId || targetId,
    managementId: switchReady.center?.managementId || active?.managementId || target.managementId || targetId,
    partnerId: targetId,
    partnerName: targetName || uiDisplay.partnerName || active?.partnerName || targetId,
    regionName: target.regionName || inferRegionFromPartnerName(targetName)
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

  const rawData = payload.data ?? payload;
  if (Array.isArray(rawData)) {
    const uiId = await readActivePartnerIdFromUi(page);
    if (uiId) {
      const match = rawData.find(row => String(row?.id || row?.centerId || row?.partnerId || '') === uiId);
      return {
        centerId: uiId,
        managementId: uiId,
        partnerId: uiId,
        partnerName: pickField(match || {}, 'name', 'centerName', 'partnerName') || uiId,
        payload: match || {}
      };
    }
    return {
      centerId: '',
      managementId: '',
      partnerId: '',
      partnerName: '',
      payload: {}
    };
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
  buildCenterQueryParams,
  isValidPartnerId,
  filterValidPartners,
  readActivePartnerDisplayFromPage,
  readCenterSessionCookie,
  inferRegionFromPartnerName,
  verifyPartnerApiContext,
  verifyPartnerMenuApiContext,
  waitForPartnerMenuApiReady,
  ensurePartnerSessionReady,
  trySwitchCenterViaApi
};

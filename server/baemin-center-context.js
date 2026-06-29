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

function normalizePartnerEntry(partnerId, partnerName) {
  const id = String(partnerId || '').trim();
  if (!isValidPartnerId(id)) return null;
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
  return normalizePartnerEntry(ctx.partnerId || ctx.centerId, partnerName);
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
    const linePattern = /\(([A-Z]{2}\d{6,})\)/;
    const buttons = [...document.querySelectorAll('button')];
    for (const button of buttons) {
      const text = String(button.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || /선택\s*완료/.test(text)) continue;
      const match = text.match(linePattern);
      if (match) return match[1];
    }
    return '';
  }).catch(() => '');
}

async function readActivePartnerIdFromPage(page) {
  if (!page || page.isClosed()) return '';

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

  const fromUi = await readActivePartnerIdFromUi(page);
  if (fromUi) return fromUi;

  const fromApi = await resolveCenterContextViaPage(page);
  return String(fromApi?.partnerId || fromApi?.centerId || '').trim();
}

async function waitForActivePartnerId(page, targetId, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const activeId = await readActivePartnerIdFromPage(page);
    if (activeId === targetId) {
      return await resolveCenterContextViaPage(page) || {
        centerId: targetId,
        managementId: targetId,
        partnerId: targetId
      };
    }
    await delay(1000);
  }
  return null;
}

async function capturePartnerSwitchRequests(page, fn) {
  const captured = [];
  const onRequest = request => {
    const url = request.url();
    if (!url.includes('api-deliverycenter')) return;
    captured.push({
      method: request.method(),
      url,
      postData: request.postData() || ''
    });
  };
  const onResponse = async response => {
    const url = response.url();
    if (!url.includes('api-deliverycenter')) return;
    let bodyText = '';
    try { bodyText = await response.text(); } catch { /* ignore */ }
    captured.push({
      method: response.request().method(),
      url,
      status: response.status(),
      bodyText: bodyText.slice(0, 500)
    });
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    const result = await fn();
    return { result, captured };
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
  }
}

async function trySwitchCenterViaApi(page, targetId) {
  const result = await page.evaluate(async ({ centerId, centerApi }) => {
    const body = {
      centerId,
      partnerId: centerId,
      cooperationId: centerId,
      managementId: centerId
    };
    const attempts = [
      { url: `${centerApi}/select`, method: 'POST' },
      { url: `${centerApi}/change`, method: 'POST' },
      { url: `${centerApi}/switch`, method: 'POST' },
      { url: centerApi, method: 'PUT' }
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
          return { ok: true, url: attempt.url, status: response.status };
        }
      } catch {
        // try next
      }
    }
    return { ok: false };
  }, { centerId: targetId, centerApi: BAEMIN_CENTER_API });

  if (result?.ok) {
    console.log(`[BREM][center] API 전환 성공: ${targetId} via ${result.url}`);
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
    await delay(2500);
  } finally {
    page.off('response', handler);
  }

  let partners = filterValidPartners([
    ...capturedPayloads.flatMap(payload => extractCenterListFromPayload(payload)),
    ...await fetchAllCentersViaPage(page),
    ...await scrapePartnersFromChangePage(page)
  ]);

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

async function verifyPartnerApiContext(page, targetId, baselineSample = '', dateRange = null) {
  const { resolveHistoryMenuQueryDates } = require('./baemin-settlement-week');
  const historyDates = resolveHistoryMenuQueryDates(undefined, dateRange);
  const fromDate = historyDates.fromDate;
  const toDate = historyDates.toDate;

  const sample = await page.evaluate(async ({ fromDate, toDate }) => {
    const qs = new URLSearchParams({
      page: '0',
      size: '3',
      fromDate,
      toDate
    });
    const url = `https://api-deliverycenter.baemin.com/v4/management/daily-delivery-status?${qs}`;
    const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    const json = await res.json().catch(() => ({}));
    const rows = Array.isArray(json?.data) ? json.data : [];
    return {
      status: res.status,
      fingerprint: rows.map(row => `${row.deliveryDate || row.date}:${row.totalComplete ?? row.completeCount}`).join('|')
    };
  }, { fromDate, toDate }).catch(() => ({ status: 0, fingerprint: '' }));

  if (sample.status < 200 || sample.status >= 300 || !sample.fingerprint) {
    return { ok: false, reason: 'api_probe_failed', sample };
  }
  if (baselineSample && sample.fingerprint === baselineSample) {
    return { ok: false, reason: 'same_as_baseline', sample };
  }
  return { ok: true, sample };
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
  if (!isValidPartnerId(targetId)) {
    throw new Error(`협력사 ID가 올바르지 않습니다: ${targetId || '(empty)'}`);
  }

  const currentId = String(
    (await readActivePartnerIdFromPage(page))
    || (await resolveCenterContextViaPage(page))?.partnerId
    || (await resolveCenterContextViaPage(page))?.centerId
    || ''
  ).trim();
  const current = await resolveCenterContextViaPage(page);
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
  await delay(2500);

  const performUiSwitch = async () => {
    console.log(`[BREM][center] UI 전환 시작: ${targetName || targetId} (${targetId})`);

    const trigger = page.getByRole('button', { name: /\([A-Z]{2}\d{6,}\)/ }).filter({ hasNotText: /선택\s*완료/ }).first();
    await trigger.click({ timeout: 10000 });
    await delay(1000);

    const optionLabel = targetName ? `${targetName} (${targetId})` : targetId;
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
    await page.goto('https://deliverycenter.baemin.com/delivery/history', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }).catch(() => {});
    await delay(3000);

    return waitForActivePartnerId(page, targetId, 15000);
  };

  const { result: active, captured: switchCaptured } = await capturePartnerSwitchRequests(page, performUiSwitch);

  const activeId = String(active?.partnerId || active?.centerId || '').trim();
  if (activeId !== targetId) {
    await page.goto('https://deliverycenter.baemin.com/delivery/history', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    }).catch(() => {});
    await delay(2500);
    const retryActive = await waitForActivePartnerId(page, targetId, 10000);
    if (retryActive) {
      console.log(`[BREM][center] 협력사 전환 완료(재확인): ${targetName || targetId} (${targetId})`);
      return {
        centerId: retryActive.centerId || target.centerId || targetId,
        managementId: retryActive.managementId || target.managementId || targetId,
        partnerId: retryActive.partnerId || targetId,
        partnerName: targetName || retryActive.partnerName || targetId
      };
    }
    console.warn('[BREM][center] 전환 네트워크:', JSON.stringify(switchCaptured.slice(-8)));
    throw new Error(`협력사 전환 확인 실패 (요청 ${targetId}, 현재 ${activeId || 'unknown'})`);
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
  verifyPartnerApiContext
};

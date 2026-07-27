const BremDirectAdjustmentAdmin = (function () {
  const $ = selector => document.querySelector(selector);

  const KINDS = {
    other: {
      key: 'other',
      label: '기타지급',
      file: '#directOtherBulkFile',
      apply: '#directOtherBulkApplyBtn',
      clearPending: '#directOtherBulkClearPendingBtn',
      retry: '#directOtherBulkRetryBtn',
      summary: '#directOtherBulkSummary',
      preview: '#directOtherBulkPreview',
      body: '#directOtherBulkBody',
      applied: '#directOtherAppliedBody'
    },
    promotion: {
      key: 'promotion',
      label: 'BREM프로모션',
      file: '#directPromotionBulkFile',
      apply: '#directPromotionBulkApplyBtn',
      clearPending: '#directPromotionBulkClearPendingBtn',
      retry: '#directPromotionBulkRetryBtn',
      summary: '#directPromotionBulkSummary',
      preview: '#directPromotionBulkPreview',
      body: '#directPromotionBulkBody',
      applied: '#directPromotionAppliedBody'
    }
  };

  const PROMO_TAX_RATE = 0.033;

  const state = {
    platform: 'baemin',
    settlementId: '',
    pending: { other: null, promotion: null },
    erpSelected: new Set(),
    erpPlatform: ''
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function weekStartKey(dateValue = new Date().toISOString().slice(0, 10)) {
    if (window.BremDatePicker?.weekStartKey) return window.BremDatePicker.weekStartKey(dateValue);
    const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return date.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
  }

  function platformLabel(platform) {
    if (platform === 'coupang') return '쿠팡';
    if (platform === 'baemin') return '배민';
    if (platform === 'combined') return '합산';
    return platform || '-';
  }

  function driversList() {
    return window.BremStorage?.drivers?.getAll?.() || [];
  }

  function driverName(driverId, fallback) {
    const driver = window.BremStorage?.drivers?.getById?.(driverId);
    return driver?.name || fallback || '(이름 없음)';
  }

  function promoTax(sum) {
    return Math.floor(Number(sum || 0) * PROMO_TAX_RATE);
  }

  function idField() {
    return state.platform === 'coupang' ? 'coupangId' : 'baeminId';
  }

  function idLabel() {
    return state.platform === 'coupang' ? '쿠팡ID' : '배민ID';
  }

  function driverPlatformId(driverId) {
    const driver = window.BremStorage?.drivers?.getById?.(driverId);
    return String(driver?.[idField()] || '').trim();
  }

  // --- 정산서(직계약) 목록 -------------------------------------------------

  function settlementList() {
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => String(record.platform || '') === state.platform)
      .slice()
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }

  function currentSettlement() {
    const list = settlementList();
    if (!list.length) return null;
    return list.find(item => item.id === state.settlementId) || list[0];
  }

  function settlementOptionLabel(record) {
    const riders = Array.isArray(record.riders) ? record.riders.length : 0;
    const region = record.region ? ` · ${record.region}` : '';
    return `${formatDate(record.startDate)} ~ ${formatDate(record.endDate)}${region} · ${riders}명`;
  }

  function settlementWeek(record) {
    if (!record) return weekStartKey();
    return weekStartKey(String(record.startDate || '').slice(0, 10) || weekStartKey());
  }

  function renderSettlementPicker() {
    const select = $('#directAdjustSettlementSelect');
    const info = $('#directAdjustSettlementInfo');
    const platformEl = $('#directAdjustPlatformLabel');
    if (platformEl) platformEl.textContent = `· ${platformLabel(state.platform)}`;
    if (!select) return;

    const list = settlementList();
    const active = currentSettlement();
    state.settlementId = active?.id || '';

    if (!list.length) {
      select.innerHTML = '<option value="">저장된 정산서 없음</option>';
      select.disabled = true;
      if (info) {
        info.textContent = `${platformLabel(state.platform)} 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」에서 먼저 정산서를 저장하세요.`;
      }
      return;
    }

    select.disabled = false;
    select.innerHTML = list
      .map(item => `<option value="${escapeHtml(item.id)}"${item.id === state.settlementId ? ' selected' : ''}>${escapeHtml(settlementOptionLabel(item))}</option>`)
      .join('');

    const weekInput = $('#directAdjustWeek');
    if (weekInput) weekInput.value = settlementWeek(active);

    if (info && active) {
      const riders = Array.isArray(active.riders) ? active.riders.length : 0;
      const file = active.fileName ? ` · 파일 ${active.fileName}` : '';
      info.textContent = `기간 ${formatDate(active.startDate)} ~ ${formatDate(active.endDate)} · 적용주 ${formatDate(settlementWeek(active))}(수) · 대상 ${riders}명${file}`;
    }
  }

  // --- 엑셀 일괄등록 -------------------------------------------------------

  async function handleFileChange(kind, file) {
    if (!file) return;
    const cfg = KINDS[kind];
    if (!currentSettlement()) {
      showToast('먼저 정산서를 선택하세요.');
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const { rows } = window.BremDirectAdjustmentBulk.sheetRowsFromWorkbook(workbook);
      await window.BremStorage?.ensureSectionLoaded?.('promotion-settlement');
      const parsed = window.BremDirectAdjustmentBulk.parseSheetRows(rows, driversList(), state.platform);
      state.pending[kind] = parsed;
      renderPreview(kind);
      const summary = window.BremDirectAdjustmentBulk.summarizeRows(parsed.rows);
      showToast(`${cfg.label}: ${summary.total}행 · 매칭 ${summary.matched}명 · 합계 ${formatNumber(summary.amountTotal)}원`);
    } catch (error) {
      console.error('[BREM] direct adjustment parse failed:', error);
      showToast(`${cfg.label} 파일을 읽지 못했습니다. (${error.message || '오류'})`);
    }
  }

  let driverOptionsCache = '';
  function driverOptionsHtml() {
    if (driverOptionsCache) return driverOptionsCache;
    const field = idField();
    const opts = driversList()
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR'))
      .map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || '(이름 없음)')}${d[field] ? ` · ${escapeHtml(d[field])}` : ''}</option>`)
      .join('');
    driverOptionsCache = `<option value="">기사 직접 선택</option>${opts}`;
    return driverOptionsCache;
  }

  function renderPreview(kind) {
    const cfg = KINDS[kind];
    const wrap = $(cfg.preview);
    const body = $(cfg.body);
    const summaryEl = $(cfg.summary);
    const parsed = state.pending[kind];
    if (!wrap || !body) return;

    if (!parsed || !parsed.rows.length) {
      wrap.hidden = true;
      body.innerHTML = '';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    wrap.hidden = false;
    const summary = window.BremDirectAdjustmentBulk.summarizeRows(parsed.rows);
    if (summaryEl) {
      summaryEl.innerHTML = `추출 <strong>${summary.total}</strong>행 · 매칭 <strong>${summary.matched}</strong>명 · 미매칭 <strong>${summary.unmatched}</strong>명 · 합계 <strong>${formatNumber(summary.amountTotal)}</strong>원`;
    }

    body.innerHTML = parsed.rows.map((row, index) => {
      const matched = row.matchStatus === 'matched' || row.matchStatus === 'manual';
      const statusClass = matched ? 'promotion-status-ok' : 'promotion-status-no';
      const matchedId = matched ? driverPlatformId(row.driverId) : '';
      const matchedIdText = matchedId ? ` <span class="muted-inline">(${escapeHtml(matchedId)})</span>` : '';
      const driverCell = matched
        ? `${escapeHtml(row.driverName || driverName(row.driverId))}${matchedIdText}`
        : `<select class="small-select" data-direct-adj-driver="${kind}" data-row-index="${index}">${driverOptionsHtml()}</select>`;
      return `
      <tr class="${matched ? '' : 'promotion-row-unpaid'}">
        <td>${row.rowNumber}</td>
        <td>${escapeHtml(row.baeminId || '-')}</td>
        <td>${driverCell}</td>
        <td class="weekly-amount-cell">${formatNumber(row.amount)}</td>
        <td class="${statusClass}">${escapeHtml(row.matchStatusLabel)}${row.error ? ` · ${escapeHtml(row.error)}` : ''}</td>
      </tr>`;
    }).join('');
  }

  function applyPending(kind) {
    const cfg = KINDS[kind];
    const settlement = currentSettlement();
    if (!settlement) {
      showToast('먼저 정산서를 선택하세요.');
      return;
    }
    const parsed = state.pending[kind];
    if (!parsed || !parsed.rows.length) {
      showToast('먼저 파일을 선택해 미리보기를 만드세요.');
      return;
    }
    const { toApply, skippedDuplicateInSheet, skippedNoAmount } = window.BremDirectAdjustmentBulk.filterRowsForApply(parsed.rows);
    if (!toApply.length) {
      showToast('적용할 매칭 행이 없습니다. (매칭·금액 확인)');
      return;
    }
    const coupang = state.platform === 'coupang';
    const entries = toApply.map(row => {
      const platformId = row.matchedBaeminId || row.baeminId || '';
      return {
        driverId: row.driverId,
        amount: row.amount,
        baeminId: coupang ? '' : platformId,
        coupangId: coupang ? platformId : '',
        driverName: row.driverName || driverName(row.driverId),
        source: 'excel'
      };
    });
    window.BremStorage.directSettlementAdjustments.applyEntries(kind, settlement.id, entries);
    void window.BremStorage.flushStorage?.();
    state.pending[kind] = null;
    const fileInput = $(cfg.file);
    if (fileInput) fileInput.value = '';
    renderPreview(kind);
    renderApplied(kind);
    renderPromoTax();
    renderAppliedSummary();
    let message = `${cfg.label} ${toApply.length}명 적용 완료`;
    if (skippedDuplicateInSheet) message += ` · 시트 내 중복 ${skippedDuplicateInSheet} 제외`;
    if (skippedNoAmount) message += ` · 금액 없음 ${skippedNoAmount} 제외`;
    showToast(message);
  }

  function clearPending(kind) {
    state.pending[kind] = null;
    const fileInput = $(KINDS[kind].file);
    if (fileInput) fileInput.value = '';
    renderPreview(kind);
  }

  function retryMatch(kind) {
    const parsed = state.pending[kind];
    if (!parsed || !parsed.rows.length) {
      showToast('미리보기가 없습니다. 파일을 먼저 선택하세요.');
      return;
    }
    parsed.rows = window.BremDirectAdjustmentBulk.rematchRows(parsed.rows, driversList(), state.platform);
    renderPreview(kind);
    showToast('매칭을 다시 시도했습니다.');
  }

  // --- 적용 현황 -----------------------------------------------------------

  function appliedMap(kind) {
    const settlement = currentSettlement();
    if (!settlement) return {};
    return window.BremStorage?.directSettlementAdjustments?.getSettlement?.(kind, settlement.id) || {};
  }

  function renderApplied(kind) {
    const cfg = KINDS[kind];
    const body = $(cfg.applied);
    if (!body) return;
    const settlement = currentSettlement();
    if (!settlement) {
      body.innerHTML = `<tr><td colspan="5" class="empty">정산서를 선택하세요.</td></tr>`;
      return;
    }
    const entries = Object.entries(appliedMap(kind));
    if (!entries.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">이 정산서에 적용된 ${escapeHtml(cfg.label)}이 없습니다.</td></tr>`;
      return;
    }
    body.innerHTML = entries
      .sort((a, b) => Number(b[1]?.amount || 0) - Number(a[1]?.amount || 0))
      .map(([driverId, entry]) => `
      <tr>
        <td><strong>${escapeHtml(driverName(driverId, entry?.driverName))}</strong></td>
        <td>${escapeHtml((state.platform === 'coupang' ? entry?.coupangId : entry?.baeminId) || driverPlatformId(driverId) || '-')}</td>
        <td class="weekly-amount-cell">${formatNumber(entry?.amount)}</td>
        <td>${entry?.source === 'erp' ? 'ERP' : '엑셀'}</td>
        <td><button type="button" class="small-btn danger-btn" data-direct-adj-remove="${kind}" data-driver-id="${escapeHtml(driverId)}">삭제</button></td>
      </tr>`).join('');
  }

  function renderAppliedSummary() {
    const el = $('#directAdjustAppliedSummary');
    if (!el) return;
    const settlement = currentSettlement();
    if (!settlement) {
      el.textContent = '';
      return;
    }
    const summary = window.BremStorage?.directSettlementAdjustments?.summary?.(settlement.id)
      || { promotionCount: 0, promotionTotal: 0, otherCount: 0, otherTotal: 0 };
    if (!summary.promotionCount && !summary.otherCount) {
      el.innerHTML = '이 정산서에 등록된 금액이 없습니다.';
      return;
    }
    const tax = promoTax(summary.promotionTotal + summary.otherTotal);
    el.innerHTML = `저장됨 · BREM프로모션 <strong>${formatNumber(summary.promotionCount)}</strong>명 <strong>${formatNumber(summary.promotionTotal)}</strong>원 · 기타지급 <strong>${formatNumber(summary.otherCount)}</strong>명 <strong>${formatNumber(summary.otherTotal)}</strong>원 · 프로모션원천세 <strong>${formatNumber(tax)}</strong>원`;
  }

  function renderPromoTax() {
    const body = $('#directPromoTaxBody');
    const summaryEl = $('#directPromoTaxSummary');
    if (!body) return;
    const settlement = currentSettlement();
    if (!settlement) {
      body.innerHTML = '<tr><td colspan="5" class="empty">정산서를 선택하세요.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }
    const promoMap = appliedMap('promotion');
    const otherMap = appliedMap('other');
    const driverIds = new Set([...Object.keys(promoMap), ...Object.keys(otherMap)]);

    if (!driverIds.size) {
      body.innerHTML = '<tr><td colspan="5" class="empty">이 정산서에 적용된 BREM프로모션·기타지급이 없습니다.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    let promoTotal = 0;
    let otherTotal = 0;
    let taxTotal = 0;
    const rows = [...driverIds].map(driverId => {
      const promo = Number(promoMap[driverId]?.amount || 0);
      const other = Number(otherMap[driverId]?.amount || 0);
      const sum = promo + other;
      const tax = promoTax(sum);
      promoTotal += promo;
      otherTotal += other;
      taxTotal += tax;
      const name = driverName(driverId, promoMap[driverId]?.driverName || otherMap[driverId]?.driverName);
      return { name, promo, other, sum, tax };
    }).sort((a, b) => b.sum - a.sum);

    body.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td class="weekly-amount-cell">${formatNumber(row.promo)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.other)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.sum)}</td>
        <td class="weekly-amount-cell"><strong>${formatNumber(row.tax)}</strong></td>
      </tr>`).join('');

    if (summaryEl) {
      summaryEl.innerHTML = `대상 <strong>${rows.length}</strong>명 · BREM프로모션 <strong>${formatNumber(promoTotal)}</strong> · 기타지급 <strong>${formatNumber(otherTotal)}</strong> · 프로모션원천세 합계 <strong>${formatNumber(taxTotal)}</strong>원`;
    }
  }

  function removeApplied(kind, driverId) {
    const settlement = currentSettlement();
    if (!settlement) return;
    window.BremStorage.directSettlementAdjustments.removeDriver(kind, settlement.id, driverId);
    void window.BremStorage.flushStorage?.();
    renderApplied(kind);
    renderPromoTax();
    renderAppliedSummary();
  }

  // --- 정산서 미지정(구 데이터) --------------------------------------------

  function legacyBuckets() {
    const out = [];
    ['promotion', 'other'].forEach(kind => {
      const blob = window.BremStorage?.directPayAdjustments?.getBlob?.(kind) || {};
      Object.entries(blob).forEach(([week, map]) => {
        const drivers = Object.keys(map || {});
        if (!drivers.length) return;
        const total = drivers.reduce((sum, id) => sum + Number(map[id]?.amount || 0), 0);
        out.push({ kind, week, count: drivers.length, total });
      });
    });
    return out.sort((a, b) => String(b.week).localeCompare(String(a.week)));
  }

  function renderLegacy() {
    const card = $('#directLegacyCard');
    const body = $('#directLegacyBody');
    if (!card || !body) return;
    const buckets = legacyBuckets();
    if (!buckets.length) {
      card.hidden = true;
      body.innerHTML = '';
      return;
    }
    card.hidden = false;
    body.innerHTML = buckets.map(item => `
      <tr>
        <td>${escapeHtml(KINDS[item.kind].label)}</td>
        <td>${formatDate(item.week)}(수)</td>
        <td class="weekly-amount-cell">${formatNumber(item.count)}</td>
        <td class="weekly-amount-cell">${formatNumber(item.total)}</td>
        <td><button type="button" class="small-btn" data-direct-legacy-move="${escapeHtml(item.kind)}" data-week="${escapeHtml(item.week)}">이 정산서로 옮기기</button></td>
      </tr>`).join('');
  }

  function moveLegacy(kind, week) {
    const settlement = currentSettlement();
    if (!settlement) {
      showToast('먼저 정산서를 선택하세요.');
      return;
    }
    const map = window.BremStorage?.directPayAdjustments?.getWeek?.(kind, week) || {};
    const entries = Object.entries(map).map(([driverId, entry]) => ({
      driverId,
      amount: entry?.amount,
      baeminId: entry?.baeminId,
      driverName: entry?.driverName,
      source: entry?.source
    }));
    if (!entries.length) {
      showToast('옮길 금액이 없습니다.');
      return;
    }
    const label = `${KINDS[kind].label} ${formatDate(week)} 주 ${entries.length}명`;
    if (!window.confirm(`${label}을(를) 선택한 정산서(${settlementOptionLabel(settlement)})로 옮길까요?\n\n같은 기사에 이미 등록된 금액이 있으면 덮어씁니다.`)) return;
    window.BremStorage.directSettlementAdjustments.applyEntries(kind, settlement.id, entries);
    window.BremStorage.directPayAdjustments.clearWeek(kind, week);
    void window.BremStorage.flushStorage?.();
    renderApplied(kind);
    renderPromoTax();
    renderAppliedSummary();
    renderLegacy();
    showToast(`${label} 이동 완료`);
  }

  // --- ERP 프로모션 불러오기 -----------------------------------------------

  function erpSavedResults() {
    const all = window.BremStorage?.promotionApplyResults?.getAll?.() || [];
    const settlement = currentSettlement();
    if (!settlement) return [];
    const week = settlementWeek(settlement);
    const platform = state.erpPlatform;
    return all.filter(item => {
      const itemWeek = weekStartKey(String(item.startDate || '').slice(0, 10) || week);
      if (itemWeek !== week) return false;
      if (platform && String(item.platform || '') !== platform) return false;
      return true;
    });
  }

  function renderErpList() {
    const body = $('#directErpSavedRows');
    const summaryEl = $('#directErpSummary');
    if (!body) return;
    const settlement = currentSettlement();
    if (!settlement) {
      body.innerHTML = '<tr><td colspan="8" class="empty">정산서를 선택하세요.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }
    const results = erpSavedResults();
    const validIds = new Set(results.map(r => r.id));
    [...state.erpSelected].forEach(id => { if (!validIds.has(id)) state.erpSelected.delete(id); });

    if (!results.length) {
      body.innerHTML = `<tr><td colspan="8" class="empty">${formatDate(settlementWeek(settlement))} 주에 저장된 프로모션 적용 결과가 없습니다.</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      const allChk = $('#directErpSelectAllChk');
      if (allChk) allChk.checked = false;
      return;
    }

    body.innerHTML = results.map(item => {
      const checked = state.erpSelected.has(item.id) ? 'checked' : '';
      const conditions = Array.isArray(item.selectedPromotionRuleNames) ? item.selectedPromotionRuleNames.join(', ') : '';
      const riderCount = item.summary?.riderCount ?? (Array.isArray(item.results) ? item.results.length : 0);
      const total = item.summary?.totalPromotionAmount ?? 0;
      return `
      <tr>
        <td><input type="checkbox" data-erp-select="${escapeHtml(item.id)}" ${checked}></td>
        <td>${platformLabel(item.platform)}</td>
        <td>${escapeHtml(item.settlementLabel || formatDate(item.startDate))}</td>
        <td>${escapeHtml(item.region || '-')}</td>
        <td class="weekly-amount-cell">${formatNumber(riderCount)}</td>
        <td class="weekly-amount-cell">${formatNumber(total)}</td>
        <td>${escapeHtml(conditions || '-')}</td>
        <td>${escapeHtml(String(item.savedAt || '').slice(0, 10))}</td>
      </tr>`;
    }).join('');

    if (summaryEl) {
      summaryEl.innerHTML = `저장 결과 <strong>${results.length}</strong>건 · 선택 <strong>${state.erpSelected.size}</strong>건`;
    }
    const allChk = $('#directErpSelectAllChk');
    if (allChk) allChk.checked = results.length > 0 && results.every(r => state.erpSelected.has(r.id));
  }

  function toggleErpSelectAll(checked) {
    const results = erpSavedResults();
    if (checked) results.forEach(r => state.erpSelected.add(r.id));
    else results.forEach(r => state.erpSelected.delete(r.id));
    renderErpList();
  }

  function applyErp() {
    const settlement = currentSettlement();
    if (!settlement) {
      showToast('먼저 정산서를 선택하세요.');
      return;
    }
    if (!state.erpSelected.size) {
      showToast('적용할 저장 결과를 선택하세요.');
      return;
    }
    const all = window.BremStorage?.promotionApplyResults?.getAll?.() || [];
    const byId = new Map(all.map(item => [item.id, item]));
    const perDriver = new Map();
    let skippedUnmatched = 0;
    state.erpSelected.forEach(id => {
      const result = byId.get(id);
      if (!result) return;
      (Array.isArray(result.results) ? result.results : []).forEach(row => {
        const driverId = String(row.matchedRiderId || '').trim();
        const amount = Number(row.totalPromotionAmount || 0);
        if (!driverId) { skippedUnmatched += 1; return; }
        if (!amount) return;
        const prev = perDriver.get(driverId) || { amount: 0, name: row.driverName || row.displayName || '' };
        prev.amount += amount;
        perDriver.set(driverId, prev);
      });
    });

    if (!perDriver.size) {
      showToast('선택한 결과에 매칭된 기사·금액이 없습니다.');
      return;
    }

    const entries = [...perDriver.entries()].map(([driverId, info]) => {
      const driver = window.BremStorage?.drivers?.getById?.(driverId);
      return {
        driverId,
        amount: info.amount,
        baeminId: driver?.baeminId || '',
        coupangId: driver?.coupangId || '',
        driverName: info.name || driverName(driverId),
        source: 'erp'
      };
    });
    window.BremStorage.directSettlementAdjustments.applyEntries('promotion', settlement.id, entries, { source: 'erp' });
    void window.BremStorage.flushStorage?.();
    renderApplied('promotion');
    renderPromoTax();
    renderAppliedSummary();
    let message = `ERP 프로모션 ${perDriver.size}명 → 이 정산서 BREM프로모션 적용 완료`;
    if (skippedUnmatched) message += ` · 미매칭 ${skippedUnmatched}행 제외`;
    showToast(message);
  }

  // --- 이벤트 --------------------------------------------------------------

  function renderAll() {
    document.querySelectorAll('#promotion-settlement [data-direct-id-label]')
      .forEach(el => { el.textContent = idLabel(); });
    renderSettlementPicker();
    renderPreview('other');
    renderPreview('promotion');
    renderApplied('other');
    renderApplied('promotion');
    renderPromoTax();
    renderAppliedSummary();
    renderLegacy();
    renderErpList();
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    Object.values(KINDS).forEach(cfg => {
      $(cfg.file)?.addEventListener('change', event => handleFileChange(cfg.key, event.target.files?.[0] || null));
      $(cfg.apply)?.addEventListener('click', () => applyPending(cfg.key));
      $(cfg.clearPending)?.addEventListener('click', () => clearPending(cfg.key));
      $(cfg.retry)?.addEventListener('click', () => retryMatch(cfg.key));
    });

    $('#directAdjustSettlementSelect')?.addEventListener('change', event => {
      state.settlementId = event.target.value || '';
      state.erpSelected.clear();
      state.pending.other = null;
      state.pending.promotion = null;
      renderAll();
    });

    $('#directErpPlatformFilter')?.addEventListener('change', event => {
      state.erpPlatform = event.target.value || '';
      renderErpList();
    });
    $('#directErpSelectAllBtn')?.addEventListener('click', () => toggleErpSelectAll(true));
    $('#directErpSelectAllChk')?.addEventListener('change', event => toggleErpSelectAll(event.target.checked));
    $('#directErpApplyBtn')?.addEventListener('click', applyErp);

    const section = document.getElementById('promotion-settlement');
    section?.addEventListener('change', event => {
      const erpChk = event.target.closest('[data-erp-select]');
      if (erpChk) {
        const id = erpChk.dataset.erpSelect;
        if (erpChk.checked) state.erpSelected.add(id);
        else state.erpSelected.delete(id);
        renderErpList();
        return;
      }
      const select = event.target.closest('[data-direct-adj-driver]');
      if (!select) return;
      const kind = select.dataset.directAdjDriver;
      const index = Number(select.dataset.rowIndex);
      const parsed = state.pending[kind];
      if (!parsed || !parsed.rows[index]) return;
      parsed.rows[index] = window.BremDirectAdjustmentBulk.applyManualDriverToRow(parsed.rows[index], select.value, driversList(), state.platform);
      renderPreview(kind);
    });

    section?.addEventListener('click', event => {
      const moveBtn = event.target.closest('[data-direct-legacy-move]');
      if (moveBtn) {
        moveLegacy(moveBtn.dataset.directLegacyMove, moveBtn.dataset.week);
        return;
      }
      const removeBtn = event.target.closest('[data-direct-adj-remove]');
      if (!removeBtn) return;
      const kind = removeBtn.dataset.directAdjRemove;
      const driverId = removeBtn.dataset.driverId;
      if (!window.confirm('이 기사의 적용 금액을 삭제할까요?')) return;
      removeApplied(kind, driverId);
    });
  }

  async function refresh(platform) {
    if (!$('#directAdjustCard')) return;
    const next = platform === 'coupang' ? 'coupang' : 'baemin';
    if (next !== state.platform) {
      state.platform = next;
      state.settlementId = '';
      state.erpSelected.clear();
      state.pending.other = null;
      state.pending.promotion = null;
    }
    driverOptionsCache = '';
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('promotion-settlement');
    // ERP 목록 기본 필터를 현재 플랫폼에 맞춘다.
    const erpFilter = $('#directErpPlatformFilter');
    if (erpFilter && !erpFilter.dataset.userTouched) {
      erpFilter.value = state.platform;
      state.erpPlatform = state.platform;
    }
    renderAll();
  }

  function init() {
    if (!$('#directAdjustCard')) return;
    bindEvents();
    $('#directErpPlatformFilter')?.addEventListener('change', event => {
      event.target.dataset.userTouched = '1';
    });
  }

  return { init, refresh, state };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremDirectAdjustmentAdmin.init();
});

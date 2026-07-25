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
    week: '',
    pending: { other: null, promotion: null }
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
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return date.toISOString().slice(0, 10);
  }

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return end.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${value}T00:00:00`));
  }

  function currentWeek() {
    if (!state.week) state.week = weekStartKey();
    return state.week;
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

  let driverOptionsCache = '';
  function driverOptionsHtml() {
    if (driverOptionsCache) return driverOptionsCache;
    const opts = driversList()
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR'))
      .map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || '(이름 없음)')}${d.baeminId ? ` · ${escapeHtml(d.baeminId)}` : ''}</option>`)
      .join('');
    driverOptionsCache = `<option value="">기사 직접 선택</option>${opts}`;
    return driverOptionsCache;
  }

  function ensureWeekInput() {
    const input = $('#directAdjustWeek');
    if (input && !input.value) input.value = currentWeek();
    const label = $('#directAdjustWeekRange');
    if (label) {
      const wk = currentWeek();
      label.textContent = `표시 범위: ${formatDate(wk)}(수) ~ ${formatDate(weekEndKey(wk))}(화)`;
    }
  }

  async function handleFileChange(kind, file) {
    if (!file) return;
    const cfg = KINDS[kind];
    try {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const { rows } = window.BremDirectAdjustmentBulk.sheetRowsFromWorkbook(workbook);
      await window.BremStorage?.ensureSectionLoaded?.('weekly-settlement-direct');
      const parsed = window.BremDirectAdjustmentBulk.parseSheetRows(rows, driversList());
      state.pending[kind] = parsed;
      renderPreview(kind);
      const summary = window.BremDirectAdjustmentBulk.summarizeRows(parsed.rows);
      showToast(`${cfg.label}: ${summary.total}행 · 매칭 ${summary.matched}명 · 합계 ${formatNumber(summary.amountTotal)}원`);
    } catch (error) {
      console.error('[BREM] direct adjustment parse failed:', error);
      showToast(`${cfg.label} 파일을 읽지 못했습니다. (${error.message || '오류'})`);
    }
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
      const driverCell = matched
        ? escapeHtml(row.driverName || driverName(row.driverId))
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
    const week = currentWeek();
    const entries = toApply.map(row => ({
      driverId: row.driverId,
      amount: row.amount,
      baeminId: row.baeminId || row.matchedBaeminId || '',
      driverName: row.driverName || driverName(row.driverId),
      source: 'excel'
    }));
    window.BremStorage.directPayAdjustments.applyEntries(kind, week, entries);
    void window.BremStorage.flushStorage?.();
    state.pending[kind] = null;
    renderPreview(kind);
    renderApplied(kind);
    renderPromoTax();
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
    parsed.rows = window.BremDirectAdjustmentBulk.rematchRows(parsed.rows, driversList());
    renderPreview(kind);
    showToast('매칭을 다시 시도했습니다.');
  }

  function renderApplied(kind) {
    const cfg = KINDS[kind];
    const body = $(cfg.applied);
    if (!body) return;
    const week = currentWeek();
    const map = window.BremStorage?.directPayAdjustments?.getWeek?.(kind, week) || {};
    const entries = Object.entries(map);
    if (!entries.length) {
      body.innerHTML = `<tr><td colspan="5" class="empty">${formatDate(week)} 주에 적용된 ${escapeHtml(cfg.label)}이 없습니다.</td></tr>`;
      return;
    }
    body.innerHTML = entries
      .sort((a, b) => Number(b[1]?.amount || 0) - Number(a[1]?.amount || 0))
      .map(([driverId, entry]) => `
      <tr>
        <td><strong>${escapeHtml(driverName(driverId, entry?.driverName))}</strong></td>
        <td>${escapeHtml(entry?.baeminId || '-')}</td>
        <td class="weekly-amount-cell">${formatNumber(entry?.amount)}</td>
        <td>${entry?.source === 'erp' ? 'ERP' : '엑셀'}</td>
        <td><button type="button" class="small-btn danger-btn" data-direct-adj-remove="${kind}" data-driver-id="${escapeHtml(driverId)}">삭제</button></td>
      </tr>`).join('');
  }

  function renderPromoTax() {
    const body = $('#directPromoTaxBody');
    const summaryEl = $('#directPromoTaxSummary');
    if (!body) return;
    const week = currentWeek();
    const promoMap = window.BremStorage?.directPayAdjustments?.getWeek?.('promotion', week) || {};
    const otherMap = window.BremStorage?.directPayAdjustments?.getWeek?.('other', week) || {};
    const driverIds = new Set([...Object.keys(promoMap), ...Object.keys(otherMap)]);

    if (!driverIds.size) {
      body.innerHTML = '<tr><td colspan="5" class="empty">이 주에 적용된 BREM프로모션·기타지급이 없습니다.</td></tr>';
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
    const week = currentWeek();
    window.BremStorage.directPayAdjustments.removeDriver(kind, week, driverId);
    void window.BremStorage.flushStorage?.();
    renderApplied(kind);
    renderPromoTax();
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

    $('#directAdjustWeek')?.addEventListener('change', event => {
      state.week = weekStartKey(event.target.value || weekStartKey());
      event.target.value = state.week;
      ensureWeekInput();
      renderApplied('other');
      renderApplied('promotion');
      renderPromoTax();
    });

    const card = $('#directAdjustCard');
    card?.addEventListener('change', event => {
      const select = event.target.closest('[data-direct-adj-driver]');
      if (!select) return;
      const kind = select.dataset.directAdjDriver;
      const index = Number(select.dataset.rowIndex);
      const parsed = state.pending[kind];
      if (!parsed || !parsed.rows[index]) return;
      parsed.rows[index] = window.BremDirectAdjustmentBulk.applyManualDriverToRow(parsed.rows[index], select.value, driversList());
      renderPreview(kind);
    });

    card?.addEventListener('click', event => {
      const removeBtn = event.target.closest('[data-direct-adj-remove]');
      if (!removeBtn) return;
      const kind = removeBtn.dataset.directAdjRemove;
      const driverId = removeBtn.dataset.driverId;
      if (!window.confirm('이 기사의 적용 금액을 삭제할까요?')) return;
      removeApplied(kind, driverId);
    });
  }

  async function refresh() {
    if (!$('#directAdjustCard')) return;
    driverOptionsCache = '';
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('weekly-settlement-direct');
    ensureWeekInput();
    renderPreview('other');
    renderPreview('promotion');
    renderApplied('other');
    renderApplied('promotion');
    renderPromoTax();
  }

  function init() {
    if (!$('#directAdjustCard')) return;
    bindEvents();
    ensureWeekInput();
  }

  return { init, refresh };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremDirectAdjustmentAdmin.init();
});

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
    // 빈 문자열이면 주 필터 없음(전체 주). 정산주는 항상 수요일 시작.
    week: '',
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

  // 날짜를 로컬 기준으로 찍는다. toISOString 을 쓰면 UTC+9 에서 하루씩 밀린다.
  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function weekStartKey(dateValue = dateKey(new Date())) {
    if (window.BremDatePicker?.weekStartKey) return window.BremDatePicker.weekStartKey(dateValue);
    const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
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
    if (!driver) return '';
    // 쿠팡ID는 기사 레코드에 저장되지 않고 이름+연락처 뒤 4자리로 계산된다.
    // 일괄등록 매칭과 같은 함수를 써야 화면에 표시되는 ID가 실제 매칭 값과 일치한다.
    return window.BremDirectAdjustmentBulk?.driverIdForMatch?.(driver, state.platform)
      ?? String(driver?.[idField()] || '').trim();
  }

  // --- 정산서(직계약) 목록 -------------------------------------------------

  function platformSettlements() {
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => String(record.platform || '') === state.platform)
      .slice()
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }

  // 정산주를 고르면 그 주의 정산서만 남긴다. 주를 안 골랐으면 전체를 보여준다.
  function settlementList() {
    const all = platformSettlements();
    if (!state.week) return all;
    return all.filter(record => settlementWeek(record) === state.week);
  }

  function currentSettlement() {
    const list = settlementList();
    if (!list.length) return null;
    return list.find(item => item.id === state.settlementId) || list[0];
  }

  // 최초 진입 시 기본 정산주 = 가장 최근 정산서의 주.
  function ensureWeek() {
    if (state.week) return state.week;
    const latest = platformSettlements()[0];
    state.week = latest ? settlementWeek(latest) : weekStartKey();
    return state.week;
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

  function renderWeekButton() {
    const btn = $('#directAdjustWeekBtn');
    if (!btn) return;
    btn.textContent = state.week
      ? `${formatDate(state.week)}(수) 주`
      : '전체 주';
    const hidden = $('#directAdjustWeek');
    if (hidden) hidden.value = state.week;
  }

  function setWeek(value) {
    state.week = value ? weekStartKey(value) : '';
    state.settlementId = '';
    state.erpSelected.clear();
    state.pending.other = null;
    state.pending.promotion = null;
    renderAll();
  }

  function shiftWeek(deltaWeeks) {
    const base = ensureWeek();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + deltaWeeks * 7);
    setWeek(dateKey(date));
  }

  function renderSettlementPicker() {
    const select = $('#directAdjustSettlementSelect');
    const info = $('#directAdjustSettlementInfo');
    const platformEl = $('#directAdjustPlatformLabel');
    if (platformEl) platformEl.textContent = `· ${platformLabel(state.platform)}`;
    if (!select) return;

    renderWeekButton();

    const list = settlementList();
    const active = currentSettlement();
    state.settlementId = active?.id || '';

    if (!list.length) {
      select.innerHTML = '<option value="">저장된 정산서 없음</option>';
      select.disabled = true;
      if (info) {
        const total = platformSettlements().length;
        info.textContent = state.week && total
          ? `${formatDate(state.week)}(수) 주에 저장된 ${platformLabel(state.platform)} 직계약 정산서가 없습니다. 다른 주를 고르거나 「전체 주」를 누르세요. (전체 ${total}건)`
          : `${platformLabel(state.platform)} 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」에서 먼저 정산서를 저장하세요.`;
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
    const opts = driversList()
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko-KR'))
      .map(d => {
        const platformId = window.BremDirectAdjustmentBulk?.driverIdForMatch?.(d, state.platform) || '';
        return `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || '(이름 없음)')}${platformId ? ` · ${escapeHtml(platformId)}` : ''}</option>`;
      })
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

  // 한 주에 정산서를 여러 장 올리는 경우가 있어서, 어느 정산서에 얼마가 등록됐는지
  // 한눈에 보여준다. 이게 없으면 지금 고른 정산서 하나만 보이고 나머지는 안 보인다.
  function settlementRegistry() {
    const store = window.BremStorage?.directSettlementAdjustments;
    return settlementList().map(record => {
      const summary = store?.summary?.(record.id)
        || { promotionCount: 0, promotionTotal: 0, otherCount: 0, otherTotal: 0 };
      const promotionTotal = Number(summary.promotionTotal || 0);
      const otherTotal = Number(summary.otherTotal || 0);
      return {
        record,
        promotionCount: Number(summary.promotionCount || 0),
        promotionTotal,
        otherCount: Number(summary.otherCount || 0),
        otherTotal,
        tax: promoTax(promotionTotal + otherTotal)
      };
    });
  }

  function renderRegistry() {
    const card = $('#directRegistryCard');
    const body = $('#directRegistryBody');
    const head = $('#directRegistryHead');
    if (!card || !body) return;

    const rows = settlementRegistry();
    if (!rows.length) {
      card.hidden = true;
      body.innerHTML = '';
      return;
    }
    card.hidden = false;

    if (head) {
      const registered = rows.filter(row => row.promotionCount || row.otherCount).length;
      head.textContent = state.week
        ? `${formatDate(state.week)}(수) 주 정산서 ${rows.length}장 · 등록된 정산서 ${registered}장`
        : `전체 정산서 ${rows.length}장 · 등록된 정산서 ${registered}장`;
    }

    const activeId = currentSettlement()?.id || '';
    body.innerHTML = rows.map(row => {
      const isActive = row.record.id === activeId;
      const has = row.promotionCount || row.otherCount;
      return `
      <tr class="${isActive ? 'direct-registry-active' : ''}">
        <td>${isActive ? '<strong>선택됨</strong>' : ''}</td>
        <td>${escapeHtml(formatDate(row.record.startDate))} ~ ${escapeHtml(formatDate(row.record.endDate))}${row.record.region ? ` · ${escapeHtml(row.record.region)}` : ''}</td>
        <td>${escapeHtml(row.record.fileName || '-')}</td>
        <td class="weekly-amount-cell">${has || row.promotionCount ? `${formatNumber(row.promotionCount)}명 · ${formatNumber(row.promotionTotal)}` : '-'}</td>
        <td class="weekly-amount-cell">${has || row.otherCount ? `${formatNumber(row.otherCount)}명 · ${formatNumber(row.otherTotal)}` : '-'}</td>
        <td class="weekly-amount-cell">${has ? formatNumber(row.tax) : '-'}</td>
        <td>${isActive
        ? (has ? '' : '<span class="direct-registry-empty">미등록</span>')
        : `<button type="button" class="small-btn" data-direct-registry-pick="${escapeHtml(row.record.id)}">이 정산서 보기</button>`}</td>
      </tr>`;
    }).join('');
  }

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
    const note = $('#directLegacyNote');
    const target = $('#directLegacyTarget');
    if (!card || !body) return;

    const all = legacyBuckets();
    if (!all.length) {
      card.hidden = true;
      body.innerHTML = '';
      if (note) { note.textContent = ''; note.hidden = true; }
      if (target) { target.textContent = ''; target.hidden = true; }
      return;
    }
    card.hidden = false;

    // 고른 주만 보여준다. 여러 주가 섞여 나오면 어느 주 금액인지 헷갈린다.
    const shown = state.week ? all.filter(item => item.week === state.week) : all;
    const others = state.week ? all.filter(item => item.week !== state.week) : [];

    if (shown.length) {
      body.innerHTML = shown.map(item => `
      <tr>
        <td>${escapeHtml(KINDS[item.kind].label)}</td>
        <td>${formatDate(item.week)}(수)</td>
        <td class="weekly-amount-cell">${formatNumber(item.count)}</td>
        <td class="weekly-amount-cell">${formatNumber(item.total)}</td>
        <td><button type="button" class="small-btn" data-direct-legacy-move="${escapeHtml(item.kind)}" data-week="${escapeHtml(item.week)}">이 정산서로 옮기기</button></td>
      </tr>`).join('');
    } else {
      body.innerHTML = `<tr><td colspan="5" class="empty">${escapeHtml(formatDate(state.week))}(수) 주에는 미지정 데이터가 없습니다.</td></tr>`;
    }

    // 다른 주 데이터를 그냥 감추면 있는 줄도 모르고 넘어간다. 남은 규모를 알려준다.
    if (note) {
      if (others.length) {
        const total = others.reduce((sum, item) => sum + item.total, 0);
        const weeks = [...new Set(others.map(item => item.week))]
          .sort().reverse().map(week => `${formatDate(week)}(수)`).join(', ');
        note.innerHTML = `다른 주에 미지정 데이터가 <strong>${formatNumber(others.length)}건</strong> 더 있습니다. 합계 <strong>${formatNumber(total)}</strong>원 · ${escapeHtml(weeks)} — 「전체 주」를 누르면 모두 보입니다.`;
        note.hidden = false;
      } else {
        note.textContent = '';
        note.hidden = true;
      }
    }

    // 「이 정산서로 옮기기」가 어디로 가는지 버튼 누르기 전에 보이게 한다.
    if (target) {
      const settlement = currentSettlement();
      if (settlement) {
        target.innerHTML = `옮길 대상 정산서: <strong>${escapeHtml(settlementOptionLabel(settlement))}</strong>${settlement.fileName ? ` · ${escapeHtml(settlement.fileName)}` : ''}`;
        target.hidden = false;
      } else {
        target.textContent = '옮길 대상 정산서가 없습니다. 먼저 정산서를 고르세요.';
        target.hidden = false;
      }
    }
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
    renderRegistry();
    renderLegacy();
    showToast(`${label} → ${formatDate(settlement.startDate)} 정산서로 이동 완료`);
  }

  // --- ERP 프로모션 불러오기 -----------------------------------------------

  // 같은 정산서를 여러 번 저장한 경우가 실제로 있다(조건을 고쳐 다시 저장).
  // 둘 다 고르면 같은 기사 금액이 두 번 들어가므로, 최신 저장본만 기본으로 쓰고
  // 이전 저장본은 stale로 표시해 고를 때 경고한다.
  function erpChannelOf(item) {
    return item?.channel === 'direct' ? 'direct' : 'bro';
  }

  function erpChannelLabel(item) {
    return erpChannelOf(item) === 'direct' ? '직계약' : '브로';
  }

  function erpSavedResults() {
    const all = window.BremStorage?.promotionApplyResults?.getAll?.() || [];
    const settlement = currentSettlement();
    if (!settlement) return [];
    const week = settlementWeek(settlement);
    const platform = state.erpPlatform;
    const matched = all.filter(item => {
      const itemWeek = weekStartKey(String(item.startDate || '').slice(0, 10) || week);
      if (itemWeek !== week) return false;
      if (platform && String(item.platform || '') !== platform) return false;
      return true;
    });

    const groups = new Map();
    matched.forEach(item => {
      // 채널을 키에 넣는다. 안 넣으면 지역명으로 대체될 때 브로/직계약 결과가
      // 같은 정산서로 묶여 한쪽이 "이전 계산본"으로 잘못 표시된다.
      const key = `${erpChannelOf(item)}|${item.platform}|${item.settlementId || item.region || item.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const annotated = [];
    groups.forEach(group => {
      group.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
      group.forEach((item, index) => {
        annotated.push({ ...item, isStale: index > 0, siblingCount: group.length });
      });
    });
    return annotated.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  }

  // 선택한 결과들을 기사별로 합산하고, 적용 전에 알려야 할 위험을 함께 계산한다.
  function buildErpPlan() {
    const settlement = currentSettlement();
    const empty = {
      settlement: null, perDriver: new Map(), applicable: new Map(), selected: [],
      staleSelected: [], sameSettlementGroups: [], overlapDrivers: [],
      notInSettlement: [], notInSettlementAmount: 0,
      overwriteExcel: [], droppedErp: [], droppedErpAmount: 0,
      skippedUnmatched: 0, total: 0
    };
    if (!settlement) return empty;

    const selected = erpSavedResults().filter(item => state.erpSelected.has(item.id));
    if (!selected.length) return { ...empty, settlement };

    const staleSelected = selected.filter(item => item.isStale);

    // 같은 정산서에서 2건 이상 골랐는지
    const bySettlement = new Map();
    selected.forEach(item => {
      const key = `${erpChannelOf(item)}|${item.platform}|${item.settlementId || item.region || item.id}`;
      if (!bySettlement.has(key)) bySettlement.set(key, []);
      bySettlement.get(key).push(item);
    });
    const sameSettlementGroups = [...bySettlement.values()].filter(g => g.length > 1);

    // 기사별 합산 + 몇 개 결과에 걸쳐 있는지
    const perDriver = new Map();
    let skippedUnmatched = 0;
    selected.forEach(item => {
      (Array.isArray(item.results) ? item.results : []).forEach(row => {
        const driverId = String(row.matchedRiderId || '').trim();
        const amount = Number(row.totalPromotionAmount || 0);
        if (!driverId) { skippedUnmatched += 1; return; }
        if (!amount) return;
        const prev = perDriver.get(driverId)
          || { amount: 0, name: row.driverName || row.displayName || '', sources: [] };
        prev.amount += amount;
        prev.sources.push({ region: item.region || '', amount, resultId: item.id });
        perDriver.set(driverId, prev);
      });
    });

    const overlapDrivers = [...perDriver.entries()]
      .filter(([, info]) => info.sources.length > 1)
      .map(([driverId, info]) => ({ driverId, ...info }));

    // 직계약 정산서에 없는 기사는 적용해도 정산결과에 나오지 않는다.
    const settlementDriverIds = new Set(
      (Array.isArray(settlement.riders) ? settlement.riders : [])
        .map(rider => String(rider.matchedRiderId || '').trim())
        .filter(Boolean)
    );
    const notInSettlement = [...perDriver.entries()]
      .filter(([driverId]) => !settlementDriverIds.has(driverId))
      .map(([driverId, info]) => ({ driverId, ...info }));
    const notInSettlementAmount = notInSettlement.reduce((sum, item) => sum + item.amount, 0);

    // 정산서에 없는 기사는 저장하지 않는다. 저장해봐야 정산결과에는 안 나오면서
    // 프로모션원천세 합계만 부풀리기 때문이다.
    const applicable = new Map(
      [...perDriver.entries()].filter(([driverId]) => settlementDriverIds.has(driverId))
    );

    // 엑셀로 직접 넣은 금액을 ERP가 덮어쓰게 되는 기사
    const applied = window.BremStorage?.directSettlementAdjustments?.getSettlement?.('promotion', settlement.id) || {};
    const overwriteExcel = [...applicable.keys()]
      .filter(driverId => applied[driverId] && applied[driverId].source !== 'erp')
      .map(driverId => ({
        driverId,
        name: applicable.get(driverId).name || driverName(driverId),
        prevAmount: Number(applied[driverId].amount || 0),
        nextAmount: applicable.get(driverId).amount
      }));

    // ERP 몫은 선택한 결과로 다시 쓰므로, 이번 선택에 없는 기존 ERP 적용분은 빠진다.
    // 조용히 사라지면 안 되니 미리 알린다.
    const droppedErp = Object.entries(applied)
      .filter(([driverId, item]) => item?.source === 'erp' && !applicable.has(driverId))
      .map(([driverId, item]) => ({
        driverId,
        name: item.driverName || driverName(driverId),
        amount: Number(item.amount || 0)
      }));
    const droppedErpAmount = droppedErp.reduce((sum, item) => sum + item.amount, 0);

    const total = [...applicable.values()].reduce((sum, info) => sum + info.amount, 0);

    return {
      settlement, perDriver, applicable, selected, staleSelected, sameSettlementGroups,
      overlapDrivers, notInSettlement, notInSettlementAmount,
      overwriteExcel, droppedErp, droppedErpAmount, skippedUnmatched, total
    };
  }

  function renderErpPreview() {
    const box = $('#directErpPreview');
    if (!box) return;
    const plan = buildErpPlan();
    if (!plan.settlement || !plan.selected.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    const warnings = [];
    if (plan.sameSettlementGroups.length) {
      const names = plan.sameSettlementGroups
        .map(group => escapeHtml(group[0].region || group[0].settlementId || '-'))
        .join(', ');
      warnings.push(`같은 정산서에서 저장본을 2건 이상 선택했습니다 (${names}). 같은 기사 금액이 두 번 더해집니다.`);
    }
    if (plan.staleSelected.length) {
      warnings.push(`이전 저장본 ${plan.staleSelected.length}건이 선택돼 있습니다. 보통은 최신 저장본만 씁니다.`);
    }
    if (plan.overlapDrivers.length) {
      warnings.push(`기사 ${plan.overlapDrivers.length}명이 선택한 결과 여러 곳에 들어 있어 금액이 합산됩니다.`);
    }
    if (plan.notInSettlement.length) {
      warnings.push(`기사 ${plan.notInSettlement.length}명(${formatNumber(plan.notInSettlementAmount)}원)은 이 정산서에 없어 제외됩니다.`);
    }
    if (plan.overwriteExcel.length) {
      warnings.push(`엑셀로 넣은 금액 ${plan.overwriteExcel.length}건을 ERP 금액이 덮어씁니다.`);
    }
    if (plan.droppedErp.length) {
      warnings.push(`전에 적용한 ERP 프로모션 ${plan.droppedErp.length}명(${formatNumber(plan.droppedErpAmount)}원)이 이번 선택에 없어 빠집니다. 같이 두려면 그 결과도 함께 선택하세요.`);
    }
    if (plan.skippedUnmatched) {
      warnings.push(`기사 매칭이 안 된 ${plan.skippedUnmatched}행은 제외됩니다.`);
    }

    box.hidden = false;
    box.innerHTML = `
      <p class="direct-erp-preview-head">적용 미리보기 · 기사 <strong>${formatNumber(plan.applicable.size)}</strong>명 · 합계 <strong>${formatNumber(plan.total)}</strong>원</p>
      ${warnings.length
        ? `<ul class="direct-erp-preview-warn">${warnings.map(text => `<li>${text}</li>`).join('')}</ul>`
        : '<p class="direct-erp-preview-ok">겹치거나 빠지는 기사 없이 깔끔하게 적용됩니다.</p>'}
    `;
  }

  function renderErpList() {
    const body = $('#directErpSavedRows');
    const summaryEl = $('#directErpSummary');
    if (!body) return;
    const settlement = currentSettlement();
    if (!settlement) {
      body.innerHTML = '<tr><td colspan="9" class="empty">정산서를 선택하세요.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      renderErpPreview();
      return;
    }
    const results = erpSavedResults();
    const validIds = new Set(results.map(r => r.id));
    [...state.erpSelected].forEach(id => { if (!validIds.has(id)) state.erpSelected.delete(id); });

    if (!results.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty">${formatDate(settlementWeek(settlement))} 주에 저장된 프로모션 적용 결과가 없습니다.</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      const allChk = $('#directErpSelectAllChk');
      if (allChk) allChk.checked = false;
      renderErpPreview();
      return;
    }

    body.innerHTML = results.map(item => {
      const checked = state.erpSelected.has(item.id) ? 'checked' : '';
      const conditions = Array.isArray(item.selectedPromotionRuleNames) ? item.selectedPromotionRuleNames.join(', ') : '';
      const riderCount = item.summary?.riderCount ?? (Array.isArray(item.results) ? item.results.length : 0);
      const total = item.summary?.totalPromotionAmount ?? 0;
      const badge = item.isStale
        ? '<span class="direct-erp-badge stale">이전 저장본</span>'
        : (item.siblingCount > 1 ? '<span class="direct-erp-badge latest">최신</span>' : '-');
      return `
      <tr class="${item.isStale ? 'direct-erp-stale-row' : ''}">
        <td><input type="checkbox" data-erp-select="${escapeHtml(item.id)}" ${checked}></td>
        <td>${badge}</td>
        <td>${platformLabel(item.platform)}<span class="promotion-channel-badge ${erpChannelOf(item) === 'direct' ? 'is-direct' : 'is-bro'}">${escapeHtml(erpChannelLabel(item))}</span></td>
        <td>${escapeHtml(item.settlementLabel || formatDate(item.startDate))}</td>
        <td>${escapeHtml(item.region || '-')}</td>
        <td class="weekly-amount-cell">${formatNumber(riderCount)}</td>
        <td class="weekly-amount-cell">${formatNumber(total)}</td>
        <td>${escapeHtml(conditions || '-')}</td>
        <td>${escapeHtml(String(item.savedAt || '').slice(0, 10))}</td>
      </tr>`;
    }).join('');

    if (summaryEl) {
      const staleCount = results.filter(item => item.isStale).length;
      summaryEl.innerHTML = `저장 결과 <strong>${results.length}</strong>건 · 선택 <strong>${state.erpSelected.size}</strong>건`
        + (staleCount ? ` · 이전 저장본 ${staleCount}건은 전체선택에서 제외됩니다` : '');
    }
    const allChk = $('#directErpSelectAllChk');
    const fresh = results.filter(item => !item.isStale);
    if (allChk) allChk.checked = fresh.length > 0 && fresh.every(r => state.erpSelected.has(r.id));
    renderErpPreview();
  }

  // 전체선택은 최신 저장본만 고른다. 이전 저장본까지 한 번에 켜지면 이중 합산이 된다.
  function toggleErpSelectAll(checked) {
    const results = erpSavedResults().filter(item => !item.isStale);
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
    const plan = buildErpPlan();
    if (!plan.applicable.size && !plan.droppedErp.length) {
      showToast(plan.perDriver.size
        ? '선택한 결과의 기사가 이 정산서에 없습니다.'
        : '선택한 결과에 매칭된 기사·금액이 없습니다.');
      return;
    }

    const confirmLines = [];
    if (plan.sameSettlementGroups.length) {
      confirmLines.push(`· 같은 정산서 저장본을 ${plan.sameSettlementGroups.length}곳에서 2건 이상 선택했습니다. 금액이 두 번 더해집니다.`);
    }
    if (plan.staleSelected.length) {
      confirmLines.push(`· 이전 저장본 ${plan.staleSelected.length}건이 포함돼 있습니다.`);
    }
    if (plan.overlapDrivers.length) {
      confirmLines.push(`· 기사 ${plan.overlapDrivers.length}명은 여러 결과에 있어 합산됩니다.`);
    }
    if (plan.notInSettlement.length) {
      confirmLines.push(`· 기사 ${plan.notInSettlement.length}명(${formatNumber(plan.notInSettlementAmount)}원)은 이 정산서에 없어 제외됩니다.`);
    }
    if (plan.overwriteExcel.length) {
      confirmLines.push(`· 엑셀로 넣은 금액 ${plan.overwriteExcel.length}건을 덮어씁니다.`);
    }
    if (plan.droppedErp.length) {
      confirmLines.push(`· 전에 적용한 ERP 프로모션 ${plan.droppedErp.length}명(${formatNumber(plan.droppedErpAmount)}원)이 빠집니다.`);
    }

    const summaryLine = `기사 ${formatNumber(plan.applicable.size)}명 · 합계 ${formatNumber(plan.total)}원을 적용합니다.`;
    if (confirmLines.length) {
      const proceed = window.confirm(`${summaryLine}\n\n확인이 필요한 내용:\n${confirmLines.join('\n')}\n\n그대로 적용할까요?`);
      if (!proceed) return;
    }

    // ERP 몫은 선택한 결과로 매번 다시 쓴다. 그래야 여러 번 눌러도 금액이 쌓이지 않는다.
    // 엑셀로 넣은 금액은 이번 ERP 대상이 아닌 한 그대로 둔다.
    const store = window.BremStorage.directSettlementAdjustments;
    const existing = store.getSettlement('promotion', settlement.id) || {};
    const keepExcel = Object.entries(existing)
      .filter(([driverId, item]) => item?.source !== 'erp' && !plan.applicable.has(driverId))
      .map(([driverId, item]) => ({
        driverId,
        amount: Number(item.amount || 0),
        baeminId: item.baeminId || '',
        coupangId: item.coupangId || '',
        driverName: item.driverName || '',
        source: 'excel'
      }));

    const erpEntries = [...plan.applicable.entries()].map(([driverId, info]) => {
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

    store.applyEntries('promotion', settlement.id, [...keepExcel, ...erpEntries], { replace: true });
    void window.BremStorage.flushStorage?.();
    renderApplied('promotion');
    renderPromoTax();
    renderAppliedSummary();
    renderErpPreview();
    let message = `ERP 프로모션 ${plan.applicable.size}명 · ${formatNumber(plan.total)}원 적용 완료`;
    if (plan.notInSettlement.length) message += ` · 정산서에 없는 ${plan.notInSettlement.length}명 제외`;
    if (plan.skippedUnmatched) message += ` · 미매칭 ${plan.skippedUnmatched}행 제외`;
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
    renderRegistry();
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

    $('#directAdjustWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#directAdjustWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    $('#directAdjustWeekAllBtn')?.addEventListener('click', () => setWeek(''));

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
      const pickBtn = event.target.closest('[data-direct-registry-pick]');
      if (pickBtn) {
        state.settlementId = pickBtn.dataset.directRegistryPick || '';
        state.erpSelected.clear();
        state.pending.other = null;
        state.pending.promotion = null;
        renderAll();
        return;
      }
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
      state.week = '';
      state.erpSelected.clear();
      state.pending.other = null;
      state.pending.promotion = null;
    }
    ensureWeek();
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

  return { init, refresh, state, renderErpList, onWeekPicked: setWeek };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremDirectAdjustmentAdmin.init();
});

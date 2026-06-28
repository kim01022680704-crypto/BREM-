(function () {
  const uploads = BremStorage.payrollSlipUploads;
  const lines = BremStorage.payrollSlipLines;
  const utils = window.BremPayrollSlipUtils;
  if (!uploads || !lines || !utils) return;

  const PREVIEW_LIMIT = 0;

  const state = {
    payMonth: '',
    settlementWeekStart: '',
    parsedLines: [],
    parsedIssues: [],
    fileName: '',
    searchSettlementWeekStart: '',
    searchKeyword: '',
    selectedUploadId: '',
    isApplying: false,
    isSyncingRiders: false,
    drivers: [],
    calls: [],
    settlementWeekCalls: [],
    productionRidersActive: false,
    productionRidersMeta: null,
    localBaseActive: false,
    localBaseMeta: null,
    storageStatus: null,
    isImportingBaseData: false,
    promotionPendingRows: [],
    promotionPendingFileName: '',
    promotionAppliedBatches: [],
    hourlyInsurancePendingRows: [],
    hourlyInsurancePendingFileName: '',
    hourlyInsuranceAppliedBatches: [],
    showPayrollDetailColumns: false,
    defaultDailySettlementApply: true,
    publishWeekStart: '',
    publishPaymentDateTouched: false,
    driverPickerSearch: {}
  };

  function getPromotionAggregatedRows() {
    const bulkUtils = window.BremPayrollPromotionBulk;
    if (bulkUtils?.aggregateAppliedBatches) {
      return bulkUtils.aggregateAppliedBatches(state.promotionAppliedBatches);
    }
    return state.promotionAppliedBatches.flatMap(batch => batch.rows || []);
  }

  function getPromotionBulkMap() {
    return utils.buildPromotionBulkMap(getPromotionAggregatedRows());
  }

  function getHourlyInsuranceAggregatedRows() {
    const bulkUtils = window.BremPayrollHourlyInsuranceBulk;
    if (bulkUtils?.aggregateAppliedBatches) {
      return bulkUtils.aggregateAppliedBatches(state.hourlyInsuranceAppliedBatches);
    }
    return state.hourlyInsuranceAppliedBatches.flatMap(batch => batch.rows || []);
  }

  function getHourlyInsuranceBulkMap() {
    return utils.buildHourlyInsuranceBulkMap(getHourlyInsuranceAggregatedRows());
  }

  function getDailySettlementSet() {
    return window.BremAdminPayrollDailySettlement?.getEnrolledDriverIdSet?.()
      || window.BremPayrollDailySettlementAdmin?.getEnrolledDriverIdSet?.()
      || new Set();
  }

  function getDailySettlementRegionFn() {
    const fn = window.BremAdminPayrollDailySettlement?.getRegionByDriverId
      || window.BremPayrollDailySettlementAdmin?.getRegionByDriverId;
    return typeof fn === 'function' ? fn : () => '';
  }

  function getEnrichmentOptions() {
    return {
      promotionBulkMap: getPromotionBulkMap(),
      hourlyInsuranceBulkMap: getHourlyInsuranceBulkMap(),
      dailySettlementSet: getDailySettlementSet(),
      dailySettlementRegionFn: getDailySettlementRegionFn()
    };
  }

  function normalizePayrollDriver(rider) {
    return {
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
      employeeNo: rider.employeeNo || '',
      baeminId: rider.baeminId || '',
      coupangId: rider.coupangId || '',
      coupangLoginKey: rider.coupangLoginKey || rider.coupangId || ''
    };
  }

  function getPayrollCalls() {
    const weekStart = activeSettlementWeekStart();
    const weekEnd = utils.settlementWeekEnd(weekStart);
    if (state.settlementWeekCalls.length) {
      return state.settlementWeekCalls;
    }
    const base = window.BremPayrollLocalBaseData;
    const source = base?.isActive?.()
      ? base.getCalls()
      : (state.calls.length ? state.calls : BremStorage.calls?.getAll?.() || []);
    if (!weekStart) return source;
    return source.filter(call => {
      const day = String(call.date || '').slice(0, 10);
      return day >= weekStart && day <= weekEnd;
    });
  }

  function getMatchingDrivers() {
    const base = window.BremPayrollLocalBaseData;
    if (base?.isActive?.()) {
      return base.getDrivers().map(normalizePayrollDriver);
    }
    const prod = window.BremPayrollProductionRiders;
    if (prod?.isActive?.()) {
      return prod.getRiders().map(normalizePayrollDriver);
    }
    return state.drivers;
  }

  function refreshLocalBaseState() {
    const base = window.BremPayrollLocalBaseData;
    state.localBaseActive = Boolean(base?.isActive?.());
    state.localBaseMeta = base?.getMeta?.() || null;
    renderLocalBaseBadge();
  }

  function refreshProductionRidersState() {
    const prod = window.BremPayrollProductionRiders;
    state.productionRidersActive = Boolean(prod?.isActive?.());
    state.productionRidersMeta = prod?.getMeta?.() || null;
    renderProductionBadge();
  }

  function $(id) {
    return document.getElementById(id);
  }

  function currentAdmin() {
    return BremStorage.auth.getAdminSessionAccount();
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function filterDriversByKeyword(list, keyword) {
    const q = String(keyword || '').trim().toLowerCase();
    if (!q) return list;
    const digits = q.replace(/\D/g, '');
    return list.filter(driver => {
      const haystack = [
        driver.name,
        driver.phone,
        driver.baeminId,
        driver.coupangId,
        driver.coupangLoginKey,
        driver.employeeNo,
        driver.id
      ].join(' ').toLowerCase();
      if (haystack.includes(q)) return true;
      if (digits.length >= 4) {
        const phoneDigits = String(driver.phone || '').replace(/\D/g, '');
        return phoneDigits.includes(digits);
      }
      return false;
    });
  }

  function buildDriverOptionLabel(driver) {
    const phone = driver.phone ? ` · ${driver.phone}` : '';
    const employeeNo = driver.employeeNo ? ` · ${driver.employeeNo}` : '';
    const baeminId = driver.baeminId ? ` · 배민:${driver.baeminId}` : '';
    const coupangId = driver.coupangId ? ` · 쿠팡:${driver.coupangId}` : '';
    return `${driver.name || '-'}${phone}${employeeNo}${baeminId}${coupangId}`;
  }

  function buildDriverSelectOptionsHtml(drivers, selectedId, selectedName) {
    const options = ['<option value="">기사 선택</option>']
      .concat(drivers.map(driver => {
        const selected = selectedId === driver.id ? ' selected' : '';
        return `<option value="${escapeHtml(driver.id)}"${selected}>${escapeHtml(buildDriverOptionLabel(driver))}</option>`;
      }));
    if (selectedId && !drivers.some(driver => driver.id === selectedId)) {
      options.push(`<option value="${escapeHtml(selectedId)}" selected>${escapeHtml(selectedName || selectedId)}</option>`);
    }
    return options.join('');
  }

  function resolveDriverSelectCandidates(row) {
    let candidates = Array.isArray(row.matchCandidates) ? [...row.matchCandidates] : [];
    const needsFullList = !candidates.length
      || row.matchStatus === 'unmatched'
      || row.matchStatus === 'short_name'
      || row.matchStatus === 'empty_id';
    if (needsFullList) {
      candidates = getMatchingDrivers();
    }
    return candidates;
  }

  function getDriverSelectDisplayList(candidates, keyword) {
    const filtered = filterDriversByKeyword(candidates, keyword);
    if (String(keyword || '').trim()) {
      return filtered.slice(0, 200);
    }
    return filtered.slice(0, 300);
  }

  function findPayrollRowByKey(rowKey) {
    const key = String(rowKey || '').trim();
    if (!key) return null;
    return state.parsedLines.find(line => line.rowKey === key)
      || state.promotionPendingRows.find(row => row.rowKey === key)
      || state.hourlyInsurancePendingRows.find(row => row.rowKey === key)
      || null;
  }

  function getRowSelectedDriverId(row) {
    return row?.selectedDriverId || row?.driverId || '';
  }

  function getRowSelectedDriverName(row) {
    return row?.selectedDriverName || row?.driverName || '';
  }

  function refreshDriverPickerSelect(picker, rowKey) {
    const row = findPayrollRowByKey(rowKey);
    if (!row || !picker) return;
    const select = picker.querySelector('select');
    if (!select) return;
    const selectedId = select.value || getRowSelectedDriverId(row);
    const keyword = state.driverPickerSearch[rowKey] || '';
    const displayList = getDriverSelectDisplayList(resolveDriverSelectCandidates(row), keyword);
    select.innerHTML = buildDriverSelectOptionsHtml(
      displayList,
      selectedId,
      getRowSelectedDriverName(row)
    );
  }

  function handleDriverPickerSearchInput(event) {
    const input = event.target.closest('.payroll-driver-picker-search');
    if (!input) return;
    const rowKey = input.dataset.payrollDriverSearch;
    if (!rowKey) return;
    state.driverPickerSearch[rowKey] = input.value;
    refreshDriverPickerSelect(input.closest('.payroll-driver-picker'), rowKey);
  }

  function renderSearchableDriverSelect(row, dataAttr) {
    const attr = dataAttr || 'payroll-driver-select';
    const rowKey = row.rowKey;
    const keyword = state.driverPickerSearch[rowKey] || '';
    const selectedId = getRowSelectedDriverId(row);
    const selectedName = getRowSelectedDriverName(row);
    const displayList = getDriverSelectDisplayList(resolveDriverSelectCandidates(row), keyword);
    const selectHtml = buildDriverSelectOptionsHtml(displayList, selectedId, selectedName);
    return `
      <div class="payroll-driver-picker" data-payroll-driver-picker="${escapeHtml(rowKey)}">
        <input
          type="search"
          class="payroll-driver-picker-search"
          data-payroll-driver-search="${escapeHtml(rowKey)}"
          value="${escapeHtml(keyword)}"
          placeholder="이름·전화·ID 검색"
          autocomplete="off"
          spellcheck="false"
        >
        <select class="payroll-driver-select" data-${attr}="${escapeHtml(rowKey)}">${selectHtml}</select>
      </div>
    `;
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
  }

  function currentSettlementWeekStart() {
    const picker = window.BremDatePicker;
    if (picker?.weekStartKey) {
      return picker.weekStartKey(picker.today?.() || undefined);
    }
    return utils.normalizeSettlementWeekStart(new Date().toISOString().slice(0, 10));
  }

  function formatPeriodLabel(periodKey) {
    const key = String(periodKey || '').trim();
    if (!key) return '전체';
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      return utils.formatSettlementWeekLabel(key);
    }
    if (/^\d{4}-\d{2}$/.test(key)) {
      const [year, month] = key.split('-');
      return `${year}년 ${month}월`;
    }
    return key;
  }

  function activeSettlementWeekStart() {
    const hidden = $('payrollSettlementWeekStart');
    const value = String(hidden?.value || state.settlementWeekStart || '').trim();
    if (!value) return '';
    return utils.normalizeSettlementWeekStart(value);
  }

  function updateSettlementWeekRangeLabel(weekStart, callCount) {
    const rangeEl = $('payrollSettlementWeekRange');
    if (!rangeEl) return;
    const normalized = weekStart ? utils.normalizeSettlementWeekStart(weekStart) : '';
    if (!normalized) {
      rangeEl.textContent = '「정산주 선택 (수요일)」을 눌러 수요일만 고르세요. 선택한 주는 수요일~화요일(7일) 기준입니다.';
      return;
    }
    const countText = Number.isFinite(callCount)
      ? ` · 등록 콜수 ${Number(callCount).toLocaleString('ko-KR')}건`
      : '';
    rangeEl.textContent = `정산 기간: ${utils.formatSettlementWeekLabel(normalized)}${countText}`;
  }

  async function ensureSettlementWeekCalls(options = {}) {
    const weekStart = activeSettlementWeekStart();
    const weekEnd = utils.settlementWeekEnd(weekStart);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { calls: [], total: 0 };

    try {
      const fetcher = window.BremPayrollLocalBaseData?.fetchCallsForSettlementWeek;
      const status = await window.BremPayrollLocalBaseData?.fetchStatus?.().catch(() => ({}));
      if (status?.configured && typeof fetcher === 'function') {
        const result = await fetcher(weekStart, weekEnd, options);
        state.settlementWeekCalls = result.calls || [];
        updateSettlementWeekRangeLabel(weekStart, result.total ?? state.settlementWeekCalls.length);
        return result;
      }
    } catch (error) {
      console.warn('[payroll settlement week calls]', error);
      if (options.silent !== true) {
        showToast(error?.message || '정산주 콜수를 불러오지 못했습니다.');
      }
    }

    state.settlementWeekCalls = getPayrollCalls();
    updateSettlementWeekRangeLabel(weekStart, state.settlementWeekCalls.length);
    return { calls: state.settlementWeekCalls, total: state.settlementWeekCalls.length, source: 'local-filter' };
  }

  async function handleSettlementWeekChange(weekStart) {
    const normalized = syncSettlementWeekUI(weekStart);
    if (!normalized) return;

    state.settlementWeekCalls = [];
    await ensureSettlementWeekCalls({ force: true, silent: false });
    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }
    showToast(`정산주: ${utils.formatSettlementWeekLabel(normalized)}`);
  }

  function syncSettlementWeekUI(weekStart) {
    const normalized = weekStart
      ? utils.normalizeSettlementWeekStart(weekStart)
      : '';
    if (!normalized) {
      state.settlementWeekStart = '';
      const hidden = $('payrollSettlementWeekStart');
      if (hidden) hidden.value = '';
      const labelEl = $('payrollSettlementWeekLabel');
      if (labelEl) labelEl.textContent = '정산주 미선택';
      updateSettlementWeekRangeLabel('');
      return '';
    }

    state.settlementWeekStart = normalized;
    const hidden = $('payrollSettlementWeekStart');
    if (hidden) hidden.value = normalized;
    const picker = window.BremDatePicker;
    const labelEl = $('payrollSettlementWeekLabel');
    if (labelEl && picker?.formatDate) {
      labelEl.textContent = `${picker.formatDate(normalized)}(${picker.formatWeekdayKo?.(normalized) || '수'})`;
    } else if (labelEl) {
      labelEl.textContent = normalized;
    }
    updateSettlementWeekRangeLabel(normalized);
    return normalized;
  }

  function ensureSettlementWeekInitialized() {
    const hidden = $('payrollSettlementWeekStart');
    const fromInput = String(hidden?.value || state.settlementWeekStart || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromInput)) {
      return syncSettlementWeekUI(fromInput);
    }

    syncSettlementWeekUI('');
    return '';
  }

  async function ensurePayrollDataLoaded() {
    refreshLocalBaseState();
    refreshProductionRidersState();

    if (state.localBaseActive) {
      state.drivers = getMatchingDrivers();
      await BremStorage.ensureSectionLoaded?.('payroll-slips');
      return;
    }

    if (state.productionRidersActive) {
      state.drivers = getMatchingDrivers();
      await BremStorage.ensureSectionLoaded?.('payroll-slips');
      state.calls = BremStorage.calls.getAll();
      return;
    }
    await BremStorage.ensureSectionLoaded?.('payroll-slips');
    const status = BremStorage.getCacheStatus?.() || {};
    if (!status.driversComplete || !BremStorage.drivers.getAll().length) {
      await BremStorage.fetchAllDriversFromServer?.({ force: false });
    }
    state.drivers = BremStorage.drivers.getAll();
    state.calls = BremStorage.calls.getAll();
  }

  function renderLocalBaseBadge() {
    const badge = $('payrollLocalBaseBadge');
    if (!badge) return;
    if (!state.localBaseActive) {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }

    const meta = state.localBaseMeta || {};
    const counts = meta.counts || {};
    const syncedAt = meta.syncedAt
      ? new Date(meta.syncedAt).toLocaleString('ko-KR')
      : '';
    const driverCount = counts.drivers ?? getMatchingDrivers().length;
    const referenceCount = counts.reference
      ?? ((counts.calls || 0) + (counts.manualNameMappings || 0));

    badge.hidden = false;
    badge.textContent = syncedAt
      ? `로컬 테스트 기본데이터 사용 중 · 기사 ${driverCount}명 · 참조 ${referenceCount}건 · ${syncedAt}`
      : `로컬 테스트 기본데이터 사용 중 · 기사 ${driverCount}명 · 참조 ${referenceCount}건`;
  }

  function renderProductionBadge() {
    const badge = $('payrollProductionBadge');
    if (!badge) return;
    if (state.localBaseActive || !state.productionRidersActive) {
      badge.hidden = true;
      badge.textContent = '';
      return;
    }
    const meta = state.productionRidersMeta || {};
    const total = meta.total || getMatchingDrivers().length;
    const syncedAt = meta.syncedAt
      ? new Date(meta.syncedAt).toLocaleString('ko-KR')
      : '';
    badge.hidden = false;
    badge.textContent = syncedAt
      ? `운영 기사목록 사용 중 (읽기 전용) · ${total}명 · ${syncedAt}`
      : `운영 기사목록 사용 중 (읽기 전용) · ${total}명`;
  }

  async function refreshStorageStatus() {
    try {
      state.storageStatus = await BremStorage.getPayrollStorageStatus?.() || null;
    } catch (error) {
      console.warn('[payroll storage status]', error);
      state.storageStatus = null;
    }
    renderStorageBadge();
    renderSaveControls();
  }

  function renderStorageBadge() {
    const badge = $('payrollStorageBadge');
    if (!badge) return;
    const status = state.storageStatus;
    if (!status) {
      badge.hidden = true;
      return;
    }

    badge.hidden = false;
    badge.classList.remove('is-local', 'is-supabase', 'is-warning');
    if (status.mode === 'local') {
      badge.classList.add('is-local');
    } else if (status.tablesAvailable) {
      badge.classList.add('is-supabase');
    } else {
      badge.classList.add('is-warning');
    }

    const hint = status.hint ? ` · ${status.hint}` : '';
    badge.textContent = `${status.message || ''}${hint}`;
  }

  function canSavePayroll() {
    const status = state.storageStatus;
    if (!status) return false;
    return Boolean(status.canSave);
  }

  function canDeletePayroll() {
    const status = state.storageStatus;
    if (!status) return false;
    return Boolean(status.canDelete);
  }

  function renderSaveControls() {
    const applyBtn = $('payrollApplyBtn');
    const syncBtn = $('payrollSyncProductionRidersBtn');
    const importBtn = $('payrollImportBaseDataBtn');
    const prodEnabled = window.BREM_SUPABASE_CONFIG?.payrollProductionRiders?.enabled === true;
    const localPayroll = state.storageStatus?.mode === 'local';

    if (syncBtn) {
      syncBtn.hidden = true;
    }
    if (importBtn) {
      importBtn.hidden = !(prodEnabled && localPayroll);
    }

    if (applyBtn && state.parsedLines.length && !state.isApplying) {
      applyBtn.disabled = !canSavePayroll();
      if (!canSavePayroll() && state.storageStatus?.hint) {
        applyBtn.title = state.storageStatus.hint;
      } else {
        applyBtn.removeAttribute('title');
      }
    }
  }

  async function importProductionBaseData() {
    if (state.isImportingBaseData) return;
    const base = window.BremPayrollLocalBaseData;
    if (!base?.importFromProduction) {
      showToast('로컬 기본데이터 모듈을 불러오지 못했습니다.');
      return;
    }

    if (!window.confirm('운영 데이터를 로컬 테스트용으로 복사합니다. 운영 DB는 수정되지 않습니다.\n\n계속할까요?')) {
      return;
    }

    if (base.hasExistingData?.()) {
      const overwrite = window.confirm(
        '이미 로컬에 저장된 테스트 기본데이터가 있습니다.\n덮어쓰시겠습니까?'
      );
      if (!overwrite) return;
    }

    state.isImportingBaseData = true;
    const btn = $('payrollImportBaseDataBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '가져오는 중…';
    }

    try {
      const status = await base.fetchStatus();
      if (!status.configured) {
        showToast('운영 Supabase URL / ANON KEY 설정이 없습니다. .env 를 확인하세요.');
        return;
      }

      const result = await base.importFromProduction();
      refreshLocalBaseState();
      state.drivers = getMatchingDrivers();
      state.settlementWeekCalls = [];
      await ensureSettlementWeekCalls({ force: true, silent: true });
      if (state.parsedLines.length) {
        refreshParsedLineMatches();
        renderPreview();
      }
      renderProductionBadge();

      const meta = result.meta || {};
      const counts = meta.counts || {};
      const driverCount = counts.drivers ?? result.drivers.length;
      const referenceCount = counts.reference
        ?? ((counts.calls || 0) + (counts.manualNameMappings || 0));
      showToast(`운영 데이터 복사 완료 · 기사 ${driverCount}명 · 참조 ${referenceCount}건`);

      if (result.warnings?.length) {
        console.warn('[payroll local base import warnings]', result.warnings);
      }
    } catch (error) {
      console.error('[payroll import base data]', error);
      showToast(error?.message || '운영 데이터 가져오기에 실패했습니다.');
    } finally {
      state.isImportingBaseData = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '운영 데이터 로컬로 가져오기';
      }
      renderLocalBaseBadge();
      renderSaveControls();
    }
  }

  async function syncProductionRiders() {
    if (state.isSyncingRiders) return;
    const prod = window.BremPayrollProductionRiders;
    if (!prod?.syncFromProduction) {
      showToast('운영 기사목록 모듈을 불러오지 못했습니다.');
      return;
    }

    state.isSyncingRiders = true;
    const btn = $('payrollSyncProductionRidersBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '동기화 중…';
    }

    try {
      const status = await prod.fetchStatus();
      if (!status.configured) {
        showToast('운영 Supabase URL / ANON KEY 설정이 없습니다. .env 에 BREM_PRODUCTION_SUPABASE_URL / ANON_KEY 를 입력하세요.');
        return;
      }
      const result = await prod.syncFromProduction();
      refreshProductionRidersState();
      if (state.parsedLines.length) {
        refreshParsedLineMatches();
        renderPreview();
      }
      showToast(`운영 기사 ${result.meta.total || result.riders.length}명 동기화 완료 (읽기 전용)`);
    } catch (error) {
      console.error('[payroll production riders sync]', error);
      showToast(error?.message || '운영 기사목록 동기화에 실패했습니다.');
    } finally {
      state.isSyncingRiders = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = '운영 기사목록 동기화';
      }
      renderProductionBadge();
    }
  }

  function refreshParsedLineMatches() {
    const settlementWeekStart = activeSettlementWeekStart();
    state.parsedLines = utils.enrichLinesWithDrivers(
      state.parsedLines,
      getMatchingDrivers(),
      getPayrollCalls(),
      settlementWeekStart,
      getEnrichmentOptions()
    );
    state.parsedIssues = collectParseIssues(state.parsedLines);
  }

  function collectParseIssues(parsedLines) {
    const issues = [];
    parsedLines.forEach(line => {
      if (line.issues?.length) {
        issues.push(`${line.rowNumber}행: ${line.issues.join(', ')}`);
      }
    });
    return issues;
  }

  function updateParsedLine(rowKey, patch) {
    const index = state.parsedLines.findIndex(line => line.rowKey === rowKey);
    if (index < 0) return;
    const current = state.parsedLines[index];
    const merged = computeLineWithMatch({
      ...current,
      ...patch
    });
    state.parsedLines[index] = merged;
    state.parsedIssues = collectParseIssues(state.parsedLines);
  }

  function computeLineWithMatch(line) {
    const settlementWeekStart = activeSettlementWeekStart();
    const matched = utils.applyDriverMatch(line, getMatchingDrivers(), {
      selectedDriverId: line.selectedDriverId
    });
    const withBulk = utils.applyPromotionBulkToLine(matched, getPromotionBulkMap());
    const withHourlyInsurance = utils.applyHourlyInsuranceBulkToLine(withBulk, getHourlyInsuranceBulkMap());
    const dailySettlementSet = getDailySettlementSet();
    const dailySettlementEnrolled = Boolean(
      withHourlyInsurance.selectedDriverId && dailySettlementSet.has(withHourlyInsurance.selectedDriverId)
    );
    const dailySettlementApply = dailySettlementEnrolled && (
      line.dailySettlementApply !== undefined
        ? line.dailySettlementApply !== false
        : state.defaultDailySettlementApply !== false
    );
    const recomputed = utils.computeLine({
      ...withHourlyInsurance,
      dailySettlementEnrolled,
      dailySettlementApply,
      dailySettlementRegion: dailySettlementEnrolled
        ? getDailySettlementRegionFn()(withHourlyInsurance.selectedDriverId)
        : ''
    });
    const registeredCallCount = recomputed.selectedDriverId
      ? utils.sumCallsForDriverInSettlementWeek(recomputed.selectedDriverId, settlementWeekStart, getPayrollCalls())
      : null;
    const next = {
      ...recomputed,
      registeredCallCount: registeredCallCount ?? recomputed.registeredCallCount
    };
    next.issues = utils.validateLine(next);
    return next;
  }

  function downloadTemplate() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const rows = utils.templateRows();
    const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, '급여명세서');
    window.XLSX.writeFile(workbook, 'BREM_급여명세서_양식.xlsx');
  }

  function resolveUploadWeekKey(item) {
    const payMonth = String(item?.payMonth || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(payMonth)) {
      return utils.normalizeSettlementWeekStart(payMonth);
    }
    const fromSummary = String(item?.rawSummary?.settlementWeekStart || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromSummary)) {
      return utils.normalizeSettlementWeekStart(fromSummary);
    }
    return payMonth;
  }

  function resolveLineWeekKey(item) {
    const payMonth = String(item?.payMonth || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(payMonth)) {
      return utils.normalizeSettlementWeekStart(payMonth);
    }
    const raw = item?.rawData && typeof item.rawData === 'object' ? item.rawData : {};
    const fromRaw = String(raw.settlementWeekStart || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)) {
      return utils.normalizeSettlementWeekStart(fromRaw);
    }
    return payMonth;
  }

  function itemMatchesSearchWeek(item, searchWeek, kind = 'line') {
    if (!searchWeek) return true;
    const normalizedSearch = utils.normalizeSettlementWeekStart(searchWeek);
    if (!normalizedSearch) return true;
    const itemWeek = kind === 'upload' ? resolveUploadWeekKey(item) : resolveLineWeekKey(item);
    if (/^\d{4}-\d{2}-\d{2}$/.test(itemWeek)) {
      return itemWeek === normalizedSearch;
    }
    return utils.matchesPayPeriodFilter(itemWeek, normalizedSearch);
  }

  function isWednesdayDateKey(dateKey) {
    const normalized = utils.normalizeSettlementWeekStart(dateKey);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
    const date = new Date(`${normalized}T12:00:00`);
    return !Number.isNaN(date.getTime()) && date.getDay() === 3;
  }

  function resolveActiveSettlementWeekStart() {
    const normalized = utils.normalizeSettlementWeekStart(activeSettlementWeekStart());
    if (!normalized) return '';
    if (!isWednesdayDateKey(normalized)) return '';
    return normalized;
  }

  function syncPayrollListSearchWeekUI(weekStart) {
    const normalized = weekStart
      ? utils.normalizeSettlementWeekStart(weekStart)
      : '';
    state.searchSettlementWeekStart = normalized;
    const hidden = $('payrollSearchSettlementWeekStart');
    if (hidden) hidden.value = normalized;
    const labelEl = $('payrollSearchSettlementWeekLabel');
    const rangeEl = $('payrollSearchSettlementWeekRange');
    const picker = window.BremDatePicker;

    if (!normalized) {
      if (labelEl) labelEl.textContent = '정산주 전체';
      if (rangeEl) rangeEl.textContent = '정산주를 선택하면 해당 주 급여명세서만 표시됩니다';
      return '';
    }

    if (labelEl && picker?.formatDate) {
      labelEl.textContent = `${picker.formatDate(normalized)}(${picker.formatWeekdayKo?.(normalized) || '수'})`;
    } else if (labelEl) {
      labelEl.textContent = normalized;
    }
    if (rangeEl) {
      rangeEl.textContent = `조회 범위: ${utils.formatSettlementWeekLabel(normalized)}`;
    }
    return normalized;
  }

  function handlePayrollListWeekChange(weekStart) {
    const normalized = syncPayrollListSearchWeekUI(weekStart);
    state.selectedUploadId = '';
    renderUploadHistory();
    renderLineList();
    if (normalized) {
      showToast(`조회 정산주: ${utils.formatSettlementWeekLabel(normalized)}`);
    }
  }

  function syncPublishPaymentDate(weekStart, savedPaymentDate) {
    const input = $('payrollPublishPaymentDate');
    if (!input || !weekStart) return;
    if (state.publishPaymentDateTouched && input.value) return;
    input.value = savedPaymentDate || utils.defaultPaymentDateForWeek?.(weekStart) || '';
  }

  function syncPublishWeekUI(weekStart) {
    const normalized = weekStart
      ? utils.normalizeSettlementWeekStart(weekStart)
      : '';
    state.publishWeekStart = normalized;
    const hidden = $('payrollPublishWeekStart');
    if (hidden) hidden.value = normalized;
    const labelEl = $('payrollPublishWeekLabel');
    const picker = window.BremDatePicker;
    if (!normalized) {
      if (labelEl) labelEl.textContent = '정산주 미선택';
      if ($('payrollPublishPaymentDate')) $('payrollPublishPaymentDate').value = '';
      return '';
    }
    if (labelEl && picker?.formatDate) {
      labelEl.textContent = `${picker.formatDate(normalized)}(${picker.formatWeekdayKo?.(normalized) || '수'})`;
    } else if (labelEl) {
      labelEl.textContent = normalized;
    }
    syncPublishPaymentDate(normalized);
    return normalized;
  }

  async function refreshPublishStatus() {
    const statusEl = $('payrollPublishStatus');
    const publishBtn = $('payrollPublishToRidersBtn');
    const weekStart = syncPublishWeekUI(state.publishWeekStart || activeSettlementWeekStart() || activeListSearchWeekStart());
    if (!weekStart) {
      if (statusEl) statusEl.textContent = '반영할 정산주를 선택하세요.';
      if (publishBtn) publishBtn.disabled = true;
      return;
    }

    let status = BremStorage.payrollPublish?.countPendingForWeek?.(weekStart) || {
      pendingLines: 0,
      pendingNotices: 0,
      pendingTotal: 0,
      totalLines: 0,
      totalNotices: 0
    };

    if (!BremStorage.isPayrollLocalStorageMode?.()) {
      const remote = await BremStorage.payrollPublish.fetchStatusFromServer(weekStart);
      if (remote.ok) {
        status = remote;
        syncPublishPaymentDate(weekStart, remote.paymentDate);
      }
    } else {
      syncPublishPaymentDate(weekStart);
    }

    if (statusEl) {
      if (status.columnMissing) {
        statusEl.textContent = 'DB 마이그레이션 필요: supabase/payroll_rider_publish_migration.sql';
      } else if (!status.totalLines && !status.totalNotices) {
        statusEl.textContent = `${utils.formatSettlementWeekLabel(weekStart)} · 저장된 급여명세서·공지가 없습니다.`;
      } else if (status.pendingTotal > 0) {
        statusEl.textContent = `${utils.formatSettlementWeekLabel(weekStart)} · 미반영 ${status.pendingTotal}건 (명세 ${status.pendingLines} · 공지 ${status.pendingNotices})`;
      } else if (status.lastPublishedAt) {
        statusEl.textContent = `${utils.formatSettlementWeekLabel(weekStart)} · 반영 완료 (${new Date(status.lastPublishedAt).toLocaleString('ko-KR')})`;
      } else {
        statusEl.textContent = `${utils.formatSettlementWeekLabel(weekStart)} · 반영 완료`;
      }
    }
    if (publishBtn) {
      publishBtn.disabled = !weekStart || (!status.totalLines && !status.totalNotices);
    }
  }

  function handlePublishWeekChange(weekStart) {
    state.publishPaymentDateTouched = false;
    syncPublishWeekUI(weekStart);
    void refreshPublishStatus();
  }

  async function publishToRiders() {
    const weekStart = syncPublishWeekUI(state.publishWeekStart);
    if (!weekStart) {
      showToast('반영할 정산주를 선택하세요.');
      return;
    }
    const paymentDate = String($('payrollPublishPaymentDate')?.value || '').slice(0, 10)
      || utils.defaultPaymentDateForWeek?.(weekStart)
      || '';
    if (!paymentDate) {
      showToast('지급일을 선택하세요.');
      return;
    }
    const status = BremStorage.payrollPublish?.countPendingForWeek?.(weekStart);
    if (!status?.totalLines && !status?.totalNotices) {
      showToast('해당 정산주에 저장된 급여명세서·공지가 없습니다.');
      return;
    }
    const ok = window.confirm(
      `${utils.formatSettlementWeekLabel(weekStart)} · 지급일 ${paymentDate}\n급여명세서·급여관련공지를 라이더 주급명세서에 반영할까요?`
    );
    if (!ok) return;

    const publishBtn = $('payrollPublishToRidersBtn');
    if (publishBtn) {
      publishBtn.disabled = true;
      publishBtn.textContent = '반영 중…';
    }
    try {
      const result = await BremStorage.payrollPublish.publishWeekToRiders(weekStart, { paymentDate });
      if (!result.ok) {
        throw new Error(result.message || result.error || '급여명세서 반영에 실패했습니다.');
      }
      showToast(`반영 완료 · 명세 ${result.linesPublished || 0}건 · 공지 ${result.noticesPublished || 0}건`);
      window.BremAdminPayrollNotices?.refresh?.();
      await refresh({ loadRemote: true });
      await refreshPublishStatus();
    } catch (error) {
      console.error('[payroll publish]', error);
      showToast(error?.message || '급여명세서 반영에 실패했습니다.');
    } finally {
      if (publishBtn) publishBtn.textContent = '급여명세서 반영하기';
      void refreshPublishStatus();
    }
  }

  function activeListSearchWeekStart() {
    return utils.normalizeSettlementWeekStart(state.searchSettlementWeekStart || '');
  }

  function filterPayrollLineList() {
    let list = lines.search({ keyword: state.searchKeyword });
    const searchWeek = activeListSearchWeekStart();
    if (searchWeek) {
      list = list.filter(item => itemMatchesSearchWeek(item, searchWeek, 'line'));
    }
    if (state.selectedUploadId) {
      list = list.filter(item => item.uploadId === state.selectedUploadId);
    }
    return list;
  }

  function downloadLineListExcel() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }

    let list = filterPayrollLineList();
    if (!list.length) {
      showToast('다운로드할 급여명세서가 없습니다.');
      return;
    }

    const header = [
      '정산주',
      ...utils.PAYSLIP_RECORD_FIELDS.map(field => field.label)
    ];
    const rows = list.map(item => {
      const raw = item.rawData && typeof item.rawData === 'object' ? item.rawData : {};
      const payslip = raw.payslip && typeof raw.payslip === 'object'
        ? raw.payslip
        : utils.buildPayslipRecord(raw);
      return [
        formatPeriodLabel(item.payMonth),
        ...utils.PAYSLIP_RECORD_FIELDS.map(field => {
          if (field.money) return payslip[field.key] ?? '';
          return payslip[field.key] ?? item.riderName ?? '';
        })
      ];
    });

    const worksheet = window.XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, '급여명세서');
    const weekPart = activeListSearchWeekStart() || list[0]?.payMonth || '전체';
    window.XLSX.writeFile(workbook, `BREM_급여명세서_${weekPart}.xlsx`);
  }

  function resetPreview() {
    state.parsedLines = [];
    state.parsedIssues = [];
    state.fileName = '';
    const fileInput = $('payrollFileInput');
    if (fileInput) fileInput.value = '';
    renderPreview();
  }

  function renderPreviewSummary() {
    const summary = utils.summarizeLines(state.parsedLines);
    const countEl = $('payrollPreviewCount');
    const grossEl = $('payrollPreviewGross');
    const deductionEl = $('payrollPreviewDeduction');
    const netEl = $('payrollPreviewNet');
    const issueEl = $('payrollPreviewIssues');
    const applyBtn = $('payrollApplyBtn');

    if (countEl) countEl.textContent = `${summary.count}건`;
    if (grossEl) grossEl.textContent = formatMoney(summary.grossPaymentTotal);
    if (deductionEl) deductionEl.textContent = formatMoney(summary.deductionTotal);
    if (netEl) netEl.textContent = formatMoney(summary.calculatedNetPay);

    const diffCount = state.parsedLines.filter(line => Math.abs(line.netPayDiff || 0) > 1).length;
    const duplicateCount = utils.getDuplicateLines(state.parsedLines).length;
    const unmatched = utils.getUnmatchedLines(state.parsedLines);

    if (issueEl) {
      if (!state.parsedLines.length) {
        issueEl.textContent = '엑셀 파일을 업로드하면 미리보기가 표시됩니다. (B열부터 데이터)';
      } else {
        const parts = [];
        if (unmatched.length) parts.push(`미매칭 ${unmatched.length}명`);
        if (duplicateCount) parts.push(`동명이인 선택 필요 ${duplicateCount}명`);
        if (diffCount) parts.push(`실지급액 차액 ${diffCount}건`);
        issueEl.textContent = parts.length
          ? `확인 필요: ${parts.join(' · ')}`
          : '모든 행 계산이 완료되었습니다.';
      }
    }

    if (applyBtn) {
      applyBtn.disabled = !state.parsedLines.length || state.isApplying || !canSavePayroll();
      if (!canSavePayroll() && state.storageStatus?.hint) {
        applyBtn.title = state.storageStatus.hint;
      } else {
        applyBtn.removeAttribute('title');
      }
    }

    renderMatchIssuePanels(unmatched, duplicateCount);
  }

  function renderMatchIssuePanels(unmatched, duplicateCount) {
    const issuesBox = $('payrollMatchIssuesBox');
    const unmatchedBox = $('payrollUnmatchedBox');
    const duplicateBox = $('payrollDuplicateBox');
    const duplicates = utils.getDuplicateLines(state.parsedLines);
    const duplicateTotal = duplicateCount ?? duplicates.length;
    const hasIssues = unmatched.length > 0 || duplicateTotal > 0;

    if (issuesBox) issuesBox.hidden = !hasIssues;
    if (unmatchedBox) unmatchedBox.hidden = !unmatched.length;
    if (duplicateBox) duplicateBox.hidden = !duplicateTotal;

    const unmatchedCountEl = $('payrollUnmatchedCount');
    const duplicateCountEl = $('payrollDuplicateCount');
    if (unmatchedCountEl) unmatchedCountEl.textContent = `${unmatched.length}명`;
    if (duplicateCountEl) duplicateCountEl.textContent = `${duplicateTotal}명`;

    renderUnmatchedList(unmatched);
    renderDuplicateList(duplicates);
  }

  function renderCandidateLabels(line) {
    const candidates = Array.isArray(line.matchCandidates) ? line.matchCandidates : [];
    if (!candidates.length) return '-';
    return candidates.map(driver => {
      const phone = driver.phone ? ` · ${driver.phone}` : '';
      return `${driver.name || '-'}${phone}`;
    }).join(' / ');
  }

  function renderUnmatchedList(unmatched) {
    const body = $('payrollUnmatchedBody');
    if (!body) return;
    if (!unmatched.length) {
      body.innerHTML = '';
      return;
    }
    body.innerHTML = unmatched.map(line => `
      <tr>
        <td>${line.rowNumber}</td>
        <td>${escapeHtml(line.branchName || '-')}</td>
        <td>${escapeHtml(line.riderName || '-')}</td>
        <td class="text-danger">${escapeHtml(line.matchStatusLabel || '미매칭')}</td>
        <td>${escapeHtml(line.namePrefix || '-')}</td>
        <td>${renderDriverSelect(line)}</td>
      </tr>
    `).join('');
  }

  function renderDuplicateList(duplicates) {
    const body = $('payrollDuplicateBody');
    if (!body) return;
    if (!duplicates.length) {
      body.innerHTML = '';
      return;
    }
    body.innerHTML = duplicates.map(line => `
      <tr>
        <td>${line.rowNumber}</td>
        <td>${escapeHtml(line.branchName || '-')}</td>
        <td>${escapeHtml(line.riderName || '-')}</td>
        <td class="text-warning">${escapeHtml(line.namePrefix || '-')}</td>
        <td class="text-warning">${escapeHtml(renderCandidateLabels(line))}</td>
        <td>${renderDriverSelect(line)}</td>
      </tr>
    `).join('');
  }

  function retryDriverMatching() {
    if (!state.parsedLines.length) {
      showToast('급여 엑셀을 먼저 업로드하세요.');
      return;
    }

    const beforeUnmatched = utils.getUnmatchedLines(state.parsedLines).length;
    const beforeDuplicate = utils.getDuplicateLines(state.parsedLines).length;

    state.parsedLines = state.parsedLines.map(line => {
      if (line.matchStatus === 'manual' && line.selectedDriverId) {
        return line;
      }
      if (line.matchStatus === 'unmatched'
        || line.matchStatus === 'short_name'
        || line.matchStatus === 'duplicate') {
        return { ...line, selectedDriverId: '' };
      }
      return line;
    });

    refreshParsedLineMatches();

    const afterUnmatched = utils.getUnmatchedLines(state.parsedLines).length;
    const afterDuplicate = utils.getDuplicateLines(state.parsedLines).length;
    const resolved = (beforeUnmatched + beforeDuplicate) - (afterUnmatched + afterDuplicate);

    renderPreview();

    if (resolved > 0) {
      showToast(`매칭 재시도 · ${resolved}건 해결 (미매칭 ${afterUnmatched} · 동명이인 ${afterDuplicate})`);
    } else {
      showToast(`매칭 재시도 완료 · 미매칭 ${afterUnmatched} · 동명이인 ${afterDuplicate}`);
    }
  }

  function renderDriverSelect(line) {
    return renderSearchableDriverSelect(line, 'payroll-driver-select');
  }

  function renderPreviewCell(line, field) {
    if (field.key === 'matchStatusLabel') {
      const cls = line.matchStatus === 'matched' || line.matchStatus === 'manual'
        ? 'text-success'
        : (line.matchStatus === 'duplicate' ? 'text-warning' : 'text-danger');
      return `<td class="${cls}">${escapeHtml(line.matchStatusLabel || '-')}</td>`;
    }

    if (field.key === 'matchPlatformLabel') {
      const cls = line.matchPlatformLabel && line.matchPlatformLabel !== '-'
        ? 'text-success'
        : 'text-muted';
      return `<td class="${cls}">${escapeHtml(line.matchPlatformLabel || '-')}</td>`;
    }

    if (field.key === 'matchedPlatformId') {
      const value = line.matchedPlatformId || '-';
      const cls = value !== '-' ? 'text-success' : 'text-muted';
      return `<td class="${cls}">${escapeHtml(value)}</td>`;
    }

    if (field.key === 'selectedDriverName') {
      if (line.matchStatus === 'duplicate' || (line.matchCandidates?.length > 1)) {
        return `<td>${renderDriverSelect(line)}</td>`;
      }
      if (line.matchStatus === 'unmatched' || line.matchStatus === 'short_name') {
        return `<td>${renderDriverSelect(line)}</td>`;
      }
      return `<td>${escapeHtml(line.selectedDriverName || line.riderName || '-')}</td>`;
    }

    if (field.applyToggle) {
      if (!line.dailySettlementEnrolled) {
        return '<td class="text-muted">-</td>';
      }
      const checked = line.dailySettlementApply !== false ? ' checked' : '';
      return `<td class="payroll-daily-apply-cell"><label class="payroll-daily-apply-label"><input type="checkbox" data-payroll-daily-settle-apply="${escapeHtml(line.rowKey)}"${checked} title="일정산 수수료(배달료 2%) 적용"></label></td>`;
    }

    if (field.idField) {
      const value = line[field.key];
      const text = value && String(value).trim() && String(value).trim() !== '-' ? String(value).trim() : '-';
      return `<td>${escapeHtml(text)}</td>`;
    }

    if (field.editable && field.key === 'otherPayment') {
      return `<td>${formatMoney(line.otherPayment)}</td>`;
    }

    const groupCls = field.emphasis ? ' payroll-payslip-emphasis' : '';
    const adminCls = field.adminOnly ? ' payroll-admin-only-col' : '';

    if (field.money) {
      const value = field.key === 'withholdingTax'
        ? Number(line.withholdingTax ?? utils.resolveWithholdingTax?.(line) ?? 0)
        : line[field.key];
      const diffHighlight = (field.diff || field.key === 'netPayDiff') && Math.abs(value || 0) > 1
        ? ' payroll-payslip-diff'
        : '';
      const bulkCls = field.bulkOnly && (
        (field.key === 'bremPromotion' && line.bremPromotionFromBulk)
        || (field.key === 'promotionWithholdingTax' && Number(line.promotionWithholdingTax || 0) > 0)
      ) ? ' payroll-payslip-bulk' : '';
      const dailyCls = field.dailyOnly && Number(line.dailySettlementFee || 0) > 0
        ? ' payroll-payslip-daily'
        : '';
      return `<td class="${groupCls}${adminCls}${diffHighlight}${bulkCls}${dailyCls}">${formatMoney(value)}</td>`;
    }

    if (field.number) {
      const value = line[field.key];
      const mismatch = field.key === 'callCount' && line.selectedDriverId
        && line.registeredCallCount != null && value !== line.registeredCallCount;
      return `<td class="${adminCls}${mismatch ? 'text-warning' : ''}">${value == null ? '-' : Number(value).toLocaleString('ko-KR')}</td>`;
    }

    return `<td class="${adminCls}">${escapeHtml(line[field.key] ?? '-')}</td>`;
  }

  function renderPreviewTable() {
    const section = $('payrollPreviewSection');
    const toolbar = $('payrollPreviewToolbar');
    const head = $('payrollPreviewHead');
    const body = $('payrollPreviewBody');
    if (!section || !head || !body) return;

    const hasLines = state.parsedLines.length > 0;
    const wasHidden = section.hidden;
    section.hidden = !hasLines;
    if (toolbar) {
      toolbar.hidden = !hasLines;
      const applyAllEl = $('payrollDailySettlementApplyAll');
      const enrolledCount = state.parsedLines.filter(line => line.dailySettlementEnrolled).length;
      const applyWrap = $('payrollDailySettlementApplyWrap');
      if (applyWrap) applyWrap.hidden = !enrolledCount;
      if (applyAllEl) {
        applyAllEl.checked = state.defaultDailySettlementApply !== false;
        applyAllEl.disabled = !enrolledCount;
      }
      const applyHint = $('payrollDailySettlementApplyHint');
      if (applyHint) {
        applyHint.textContent = enrolledCount
          ? `일정산 등록 ${enrolledCount}명 · 배달료 2% → 일정산수수료, 콜수수료에서 차감`
          : '';
      }
    }
    if (!state.parsedLines.length) {
      head.innerHTML = '';
      body.innerHTML = '';
      return;
    }

    const groups = utils.PAYSLIP_PREVIEW_GROUPS || [];
    const detailFields = state.showPayrollDetailColumns
      ? (utils.PAYSLIP_DETAIL_FIELDS || [])
      : [];
    const totalCols = 1 + groups.reduce((sum, g) => sum + g.fields.length, 0) + detailFields.length;

    const groupHead = groups.map(group =>
      `<th colspan="${group.fields.length}" class="payroll-payslip-group payroll-payslip-group--${group.id}">${escapeHtml(group.label)}</th>`
    ).join('');

    const colHead = groups.flatMap(group => group.fields.map(field =>
      `<th class="payroll-payslip-col payroll-payslip-col--${group.id}${field.emphasis ? ' payroll-payslip-emphasis' : ''}">${escapeHtml(field.label)}</th>`
    )).join('');

    const detailHead = detailFields.map(field =>
      `<th class="payroll-payslip-col payroll-payslip-col--detail">${escapeHtml(field.label)}</th>`
    ).join('');

    head.innerHTML = `
      <tr class="payroll-payslip-head-group">
        <th rowspan="2" class="payroll-payslip-rownum">행</th>
        ${groupHead}
        ${detailFields.length ? `<th colspan="${detailFields.length}" class="payroll-payslip-group payroll-payslip-group--detail">상세</th>` : ''}
      </tr>
      <tr class="payroll-payslip-head-cols">
        ${colHead}
        ${detailHead}
      </tr>
    `;

    const allFields = groups.flatMap(g => g.fields).concat(detailFields);

    const previewLines = PREVIEW_LIMIT > 0
      ? state.parsedLines.slice(0, PREVIEW_LIMIT)
      : state.parsedLines;

    body.innerHTML = previewLines.map(line => {
      const hasDiff = Math.abs(line.netPayDiff || 0) > 1;
      const hasIssue = (line.issues?.length || 0) > 0;
      const rowCls = [
        hasDiff ? 'payroll-payslip-row--diff' : '',
        hasIssue ? 'payroll-payslip-row--issue' : ''
      ].filter(Boolean).join(' ');
      const cells = allFields.map(field => renderPreviewCell(line, field)).join('');
      return `<tr data-payroll-row="${escapeHtml(line.rowKey)}" class="${rowCls}"><td class="payroll-payslip-rownum">${line.rowNumber}</td>${cells}</tr>`;
    }).join('');

    if (PREVIEW_LIMIT > 0 && state.parsedLines.length > PREVIEW_LIMIT) {
      body.innerHTML += `<tr><td colspan="${totalCols}" class="payroll-preview-more">미리보기 ${PREVIEW_LIMIT}건까지만 표시 · 총 ${state.parsedLines.length}건</td></tr>`;
    }

    if (hasLines && wasHidden) {
      requestAnimationFrame(() => {
        (toolbar || section)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  function renderPreview() {
    renderPreviewSummary();
    renderPreviewTable();
  }

  function renderBulkCandidateLabels(row) {
    const candidates = Array.isArray(row.matchCandidates) ? row.matchCandidates : [];
    if (!candidates.length) return '-';
    return candidates.map(driver => {
      const phone = driver.phone ? ` · ${driver.phone}` : '';
      return `${driver.name || '-'}${phone}`;
    }).join(' / ');
  }

  function renderBulkDriverSelect(row, dataAttr) {
    return renderSearchableDriverSelect(row, dataAttr || 'payroll-bulk-driver-select');
  }

  function renderBulkMatchIssuePanels(config) {
    const {
      rows,
      bulkUtils,
      issuesBoxId,
      unmatchedBoxId,
      duplicateBoxId,
      unmatchedBodyId,
      duplicateBodyId,
      unmatchedCountId,
      duplicateCountId,
      driverSelectAttr,
      rowLabelFn
    } = config;

    const issuesBox = $(issuesBoxId);
    const unmatchedBox = $(unmatchedBoxId);
    const duplicateBox = $(duplicateBoxId);
    const unmatchedBody = $(unmatchedBodyId);
    const duplicateBody = $(duplicateBodyId);
    if (!bulkUtils || !issuesBox) return;

    const unmatched = bulkUtils.getUnmatchedLines(rows);
    const duplicates = bulkUtils.getDuplicateLines(rows);
    const hasIssues = unmatched.length > 0 || duplicates.length > 0;

    issuesBox.hidden = !hasIssues || !rows.length;
    if (unmatchedBox) unmatchedBox.hidden = !unmatched.length;
    if (duplicateBox) duplicateBox.hidden = !duplicates.length;
    if ($(unmatchedCountId)) $(unmatchedCountId).textContent = `${unmatched.length}명`;
    if ($(duplicateCountId)) $(duplicateCountId).textContent = `${duplicates.length}명`;

    if (unmatchedBody) {
      unmatchedBody.innerHTML = unmatched.length
        ? unmatched.map(row => `
          <tr>
            <td>${row.rowNumber}</td>
            <td>${escapeHtml(rowLabelFn(row))}</td>
            <td class="text-danger">${escapeHtml(row.matchStatusLabel || '미매칭')}</td>
            <td>${renderBulkDriverSelect(row, driverSelectAttr)}</td>
          </tr>
        `).join('')
        : '';
    }

    if (duplicateBody) {
      duplicateBody.innerHTML = duplicates.length
        ? duplicates.map(row => `
          <tr>
            <td>${row.rowNumber}</td>
            <td>${escapeHtml(rowLabelFn(row))}</td>
            <td class="text-warning">${escapeHtml(renderBulkCandidateLabels(row))}</td>
            <td>${renderBulkDriverSelect(row, driverSelectAttr)}</td>
          </tr>
        `).join('')
        : '';
    }
  }

  function resetPromotionPending() {
    state.promotionPendingRows = [];
    state.promotionPendingFileName = '';
    const fileInput = $('payrollPromotionBulkFile');
    if (fileInput) fileInput.value = '';
    renderPromotionBulkPreview();
  }

  function resetPromotionBulk() {
    state.promotionPendingRows = [];
    state.promotionPendingFileName = '';
    state.promotionAppliedBatches = [];
    const fileInput = $('payrollPromotionBulkFile');
    if (fileInput) fileInput.value = '';
    renderPromotionBulkPreview();
    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }
  }

  function applyPromotionPending() {
    const bulkUtils = window.BremPayrollPromotionBulk;
    if (!bulkUtils) return;

    const appliedDriverIds = bulkUtils.collectAppliedDriverIds(state.promotionAppliedBatches);
    const filtered = bulkUtils.filterRowsForApply(state.promotionPendingRows, appliedDriverIds);
    const toApply = filtered.toApply;

    if (!toApply.length) {
      const parts = [];
      if (filtered.skippedAlreadyApplied) parts.push(`이미 적용 ${filtered.skippedAlreadyApplied}명`);
      if (filtered.skippedDuplicateInSheet) parts.push(`시트 중복 ${filtered.skippedDuplicateInSheet}명`);
      if (filtered.skippedNoAmount) parts.push(`금액 없음 ${filtered.skippedNoAmount}건`);
      showToast(parts.length
        ? `새로 적용할 기사가 없습니다. (${parts.join(' · ')})`
        : '적용할 매칭된 BREM프로모션 데이터가 없습니다.');
      return;
    }

    const summary = bulkUtils.summarizeRows(toApply);
    const batch = {
      id: `promo-batch-${Date.now()}`,
      fileName: state.promotionPendingFileName || 'BREM프로모션.xlsx',
      appliedAt: new Date().toISOString(),
      rows: toApply.map(row => ({ ...row })),
      matchedCount: summary.matched,
      totalAmount: summary.bremPromotionTotal,
      skippedAlreadyApplied: filtered.skippedAlreadyApplied,
      skippedDuplicateInSheet: filtered.skippedDuplicateInSheet
    };

    state.promotionAppliedBatches.push(batch);
    resetPromotionPending();

    const applied = bulkUtils.summarizeAppliedBatches(state.promotionAppliedBatches);
    renderPromotionBulkPreview();

    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }

    const skipParts = [];
    if (filtered.skippedAlreadyApplied) skipParts.push(`이미적용 제외 ${filtered.skippedAlreadyApplied}명`);
    if (filtered.skippedDuplicateInSheet) skipParts.push(`중복 제외 ${filtered.skippedDuplicateInSheet}명`);
    const skipText = skipParts.length ? ` · ${skipParts.join(' · ')}` : '';
    showToast(
      `BREM프로모션 적용 ${summary.matched}명 ${summary.bremPromotionTotal.toLocaleString('ko-KR')}원${skipText} (전체 ${applied.matchedDrivers}명)`
    );
  }

  function removePromotionBatch(batchId) {
    const id = String(batchId || '').trim();
    if (!id) return;
    state.promotionAppliedBatches = state.promotionAppliedBatches.filter(batch => batch.id !== id);
    renderPromotionBulkPreview();
    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }
    showToast('BREM프로모션 적용 건을 삭제했습니다.');
  }

  function retryPromotionBulkMatching() {
    const bulkUtils = window.BremPayrollPromotionBulk;
    if (!bulkUtils || !state.promotionPendingRows.length) {
      showToast('프로모션 미리보기가 없습니다.');
      return;
    }
    const before = bulkUtils.getUnmatchedLines(state.promotionPendingRows).length
      + bulkUtils.getDuplicateLines(state.promotionPendingRows).length;
    state.promotionPendingRows = bulkUtils.rematchRows(state.promotionPendingRows, getMatchingDrivers());
    const after = bulkUtils.getUnmatchedLines(state.promotionPendingRows).length
      + bulkUtils.getDuplicateLines(state.promotionPendingRows).length;
    renderPromotionBulkPreview();
    showToast(after < before
      ? `프로모션 매칭 재시도 · ${before - after}건 해결 (미해결 ${after}건)`
      : `프로모션 매칭 재시도 · 미해결 ${after}건`);
  }

  function retryHourlyInsuranceBulkMatching() {
    const bulkUtils = window.BremPayrollHourlyInsuranceBulk;
    if (!bulkUtils || !state.hourlyInsurancePendingRows.length) {
      showToast('시간제보험 미리보기가 없습니다.');
      return;
    }
    const before = bulkUtils.getUnmatchedLines(state.hourlyInsurancePendingRows).length
      + bulkUtils.getDuplicateLines(state.hourlyInsurancePendingRows).length;
    state.hourlyInsurancePendingRows = bulkUtils.rematchRows(state.hourlyInsurancePendingRows, getMatchingDrivers());
    const after = bulkUtils.getUnmatchedLines(state.hourlyInsurancePendingRows).length
      + bulkUtils.getDuplicateLines(state.hourlyInsurancePendingRows).length;
    renderHourlyInsuranceBulkPreview();
    showToast(after < before
      ? `시간제보험 매칭 재시도 · ${before - after}건 해결 (미해결 ${after}건)`
      : `시간제보험 매칭 재시도 · 미해결 ${after}건`);
  }

  function updatePromotionPendingDriver(rowKey, driverId) {
    const bulkUtils = window.BremPayrollPromotionBulk;
    if (!bulkUtils) return;
    const index = state.promotionPendingRows.findIndex(row => row.rowKey === rowKey);
    if (index < 0) return;
    state.promotionPendingRows[index] = bulkUtils.applyManualDriverToRow(
      state.promotionPendingRows[index],
      driverId,
      getMatchingDrivers()
    );
    renderPromotionBulkPreview();
    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }
  }

  function updateHourlyInsurancePendingDriver(rowKey, driverId) {
    const bulkUtils = window.BremPayrollHourlyInsuranceBulk;
    if (!bulkUtils) return;
    const index = state.hourlyInsurancePendingRows.findIndex(row => row.rowKey === rowKey);
    if (index < 0) return;
    state.hourlyInsurancePendingRows[index] = bulkUtils.applyManualDriverToRow(
      state.hourlyInsurancePendingRows[index],
      driverId,
      getMatchingDrivers()
    );
    renderHourlyInsuranceBulkPreview();
    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }
  }

  function downloadPromotionBulkTemplate() {
    const bulkUtils = window.BremPayrollPromotionBulk;
    if (!window.XLSX || !bulkUtils) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const rows = bulkUtils.templateRows();
    const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, 'BREM프로모션');
    window.XLSX.writeFile(workbook, 'BREM_BREM프로모션_일괄등록_양식.xlsx');
  }

  async function parsePromotionBulkBuffer(buffer) {
    const bulkUtils = window.BremPayrollPromotionBulk;
    if (!bulkUtils || !window.XLSX) {
      showToast('프로모션 일괄등록 모듈을 불러오지 못했습니다.');
      return;
    }
    await ensurePayrollDataLoaded();
    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const parsed = bulkUtils.parseSheetRows(rows, getMatchingDrivers());
    state.promotionPendingRows = parsed.rows;
    renderPromotionBulkPreview();
    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }
    if (!parsed.rows.length) {
      showToast('프로모션 일괄등록 데이터를 찾지 못했습니다.');
      return;
    }
    const summary = bulkUtils.summarizeRows(parsed.rows);
    showToast(`미리보기 · 매칭 ${summary.matched}/${summary.total}건 · ${summary.bremPromotionTotal.toLocaleString('ko-KR')}원 · 「적용하기」를 누르세요`);
  }

  async function handlePromotionBulkFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    state.promotionPendingFileName = file.name;
    try {
      const buffer = await readFileAsArrayBuffer(file);
      await parsePromotionBulkBuffer(buffer);
    } catch (error) {
      console.error('[payroll promotion bulk]', error);
      showToast('프로모션 일괄등록 파일을 읽지 못했습니다.');
      resetPromotionPending();
    } finally {
      event.target.value = '';
    }
  }

  function renderPromotionBulkPreview() {
    const pendingSection = $('payrollPromotionBulkPreview');
    const pendingBody = $('payrollPromotionBulkBody');
    const summaryEl = $('payrollPromotionBulkSummary');
    const applyBtn = $('payrollPromotionBulkApplyBtn');
    const appliedSection = $('payrollPromotionAppliedSection');
    const appliedBody = $('payrollPromotionAppliedBody');
    const appliedSummaryEl = $('payrollPromotionAppliedSummary');
    const bulkUtils = window.BremPayrollPromotionBulk;
    if (!pendingBody || !bulkUtils) return;

    const appliedDriverIds = bulkUtils.collectAppliedDriverIds(state.promotionAppliedBatches);
    const pendingFiltered = bulkUtils.filterRowsForApply(state.promotionPendingRows, appliedDriverIds);
    const pendingSeen = new Set();

    if (pendingSection) {
      pendingSection.hidden = !state.promotionPendingRows.length;
    }
    if (applyBtn) {
      applyBtn.disabled = !pendingFiltered.toApply.length;
    }

    if (!state.promotionPendingRows.length) {
      pendingBody.innerHTML = '';
    } else {
      if (summaryEl) {
        const applyCount = pendingFiltered.toApply.length;
        summaryEl.textContent = `${state.promotionPendingFileName || '미리보기'} · 신규 적용 ${applyCount}명 · ${pendingFiltered.toApply.reduce((s, r) => s + Number(r.bremPromotion || 0), 0).toLocaleString('ko-KR')}원`;
      }
      pendingBody.innerHTML = state.promotionPendingRows.map(row => {
        let applyLabel = row.matchStatusLabel || '-';
        let statusCls = row.matchStatus === 'matched' || row.matchStatus === 'manual'
          ? 'text-success'
          : (row.matchStatus === 'duplicate' ? 'text-warning' : 'text-danger');
        const driverId = String(row.driverId || '').trim();
        if ((row.matchStatus === 'matched' || row.matchStatus === 'manual') && driverId) {
          if (appliedDriverIds.has(driverId)) {
            applyLabel = '이미 적용';
            statusCls = 'text-warning';
          } else if (pendingSeen.has(driverId)) {
            applyLabel = '시트 중복';
            statusCls = 'text-warning';
          } else {
            pendingSeen.add(driverId);
          }
        }
        return `
          <tr>
            <td>${row.rowNumber}</td>
            <td>${escapeHtml(row.baeminId || '-')}</td>
            <td>${escapeHtml(row.coupangId || '-')}</td>
            <td>${formatMoney(row.bremPromotion)}</td>
            <td>${escapeHtml(row.driverName || '-')}</td>
            <td class="${statusCls}">${escapeHtml(row.matchPlatformLabel || '-')}</td>
            <td class="${statusCls}">${escapeHtml(row.matchedPlatformId || '-')}</td>
            <td class="${statusCls}">${escapeHtml(applyLabel)}</td>
          </tr>
        `;
      }).join('');
    }

    renderBulkMatchIssuePanels({
      rows: state.promotionPendingRows,
      bulkUtils,
      issuesBoxId: 'payrollPromotionMatchIssuesBox',
      unmatchedBoxId: 'payrollPromotionUnmatchedBox',
      duplicateBoxId: 'payrollPromotionDuplicateBox',
      unmatchedBodyId: 'payrollPromotionUnmatchedBody',
      duplicateBodyId: 'payrollPromotionDuplicateBody',
      unmatchedCountId: 'payrollPromotionUnmatchedCount',
      duplicateCountId: 'payrollPromotionDuplicateCount',
      driverSelectAttr: 'promotion-bulk-driver-select',
      rowLabelFn: row => `${row.baeminId || '-'} / ${row.coupangId || '-'} · ${formatMoney(row.bremPromotion)}`
    });

    const applied = bulkUtils.summarizeAppliedBatches(state.promotionAppliedBatches);
    if (appliedSection) {
      appliedSection.hidden = !state.promotionAppliedBatches.length;
    }
    if (appliedSummaryEl) {
      appliedSummaryEl.textContent = state.promotionAppliedBatches.length
        ? `적용 ${applied.batchCount}회 · 기사 ${applied.matchedDrivers}명 (기사당 1회) · 합계 ${applied.bremPromotionTotal.toLocaleString('ko-KR')}원`
        : '아직 적용된 프로모션 정산서가 없습니다';
    }
    if (appliedBody) {
      appliedBody.innerHTML = state.promotionAppliedBatches.map((batch, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(batch.fileName || '-')}</td>
          <td>${new Date(batch.appliedAt).toLocaleString('ko-KR')}</td>
          <td>${Number(batch.matchedCount || 0).toLocaleString('ko-KR')}건</td>
          <td>${formatMoney(batch.totalAmount)}</td>
          <td>
            <button type="button" class="small-btn danger-btn" data-promotion-remove-batch="${escapeHtml(batch.id)}">삭제</button>
          </td>
        </tr>
      `).join('');
    }

    if (!state.promotionPendingRows.length && !state.promotionAppliedBatches.length && summaryEl) {
      summaryEl.textContent = '프로모션 엑셀 업로드 → 미리보기 → 적용하기 (기사당 1회)';
    }
  }

  function resetHourlyInsurancePending() {
    state.hourlyInsurancePendingRows = [];
    state.hourlyInsurancePendingFileName = '';
    const fileInput = $('payrollHourlyInsuranceBulkFile');
    if (fileInput) fileInput.value = '';
    renderHourlyInsuranceBulkPreview();
  }

  function resetHourlyInsuranceBulk() {
    state.hourlyInsurancePendingRows = [];
    state.hourlyInsurancePendingFileName = '';
    state.hourlyInsuranceAppliedBatches = [];
    const fileInput = $('payrollHourlyInsuranceBulkFile');
    if (fileInput) fileInput.value = '';
    renderHourlyInsuranceBulkPreview();
    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }
  }

  function applyHourlyInsurancePending() {
    const bulkUtils = window.BremPayrollHourlyInsuranceBulk;
    if (!bulkUtils) return;

    const appliedDriverIds = bulkUtils.collectAppliedDriverIds(state.hourlyInsuranceAppliedBatches);
    const filtered = bulkUtils.filterRowsForApply(state.hourlyInsurancePendingRows, appliedDriverIds);
    const toApply = filtered.toApply;

    if (!toApply.length) {
      const parts = [];
      if (filtered.skippedAlreadyApplied) parts.push(`이미 적용 ${filtered.skippedAlreadyApplied}명`);
      if (filtered.skippedDuplicateInSheet) parts.push(`시트 중복 ${filtered.skippedDuplicateInSheet}명`);
      showToast(parts.length
        ? `새로 적용할 기사가 없습니다. (${parts.join(' · ')})`
        : '적용할 매칭된 시간제보험 데이터가 없습니다.');
      return;
    }

    const summary = bulkUtils.summarizeRows(toApply);
    const batch = {
      id: `hourly-ins-batch-${Date.now()}`,
      fileName: state.hourlyInsurancePendingFileName || '주정산서.xlsx',
      appliedAt: new Date().toISOString(),
      rows: toApply.map(row => ({ ...row })),
      matchedCount: summary.matched,
      totalAmount: summary.hourlyInsuranceTotal,
      skippedAlreadyApplied: filtered.skippedAlreadyApplied,
      skippedDuplicateInSheet: filtered.skippedDuplicateInSheet
    };

    state.hourlyInsuranceAppliedBatches.push(batch);
    resetHourlyInsurancePending();

    const applied = bulkUtils.summarizeAppliedBatches(state.hourlyInsuranceAppliedBatches);
    renderHourlyInsuranceBulkPreview();

    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }

    const skipParts = [];
    if (filtered.skippedAlreadyApplied) skipParts.push(`이미적용 제외 ${filtered.skippedAlreadyApplied}명`);
    if (filtered.skippedDuplicateInSheet) skipParts.push(`중복 제외 ${filtered.skippedDuplicateInSheet}명`);
    const skipText = skipParts.length ? ` · ${skipParts.join(' · ')}` : '';
    showToast(
      `시간제보험 적용 ${summary.matched}명 ${summary.hourlyInsuranceTotal.toLocaleString('ko-KR')}원${skipText} (전체 ${applied.matchedDrivers}명)`
    );
  }

  function removeHourlyInsuranceBatch(batchId) {
    const id = String(batchId || '').trim();
    if (!id) return;
    state.hourlyInsuranceAppliedBatches = state.hourlyInsuranceAppliedBatches.filter(batch => batch.id !== id);
    renderHourlyInsuranceBulkPreview();
    if (state.parsedLines.length) {
      refreshParsedLineMatches();
      renderPreview();
    }
    showToast('시간제보험 적용 건을 삭제했습니다.');
  }

  async function parseHourlyInsuranceBulkBuffer(buffer) {
    const bulkUtils = window.BremPayrollHourlyInsuranceBulk;
    if (!bulkUtils || !window.XLSX) {
      showToast('시간제보험 일괄등록 모듈을 불러오지 못했습니다.');
      return;
    }
    await ensurePayrollDataLoaded();
    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const { rows, sheetName } = bulkUtils.sheetRowsFromWorkbook(workbook);
    const parsed = bulkUtils.parseSheetRows(rows, getMatchingDrivers());
    state.hourlyInsurancePendingRows = parsed.rows;
    renderHourlyInsuranceBulkPreview();
    if (!parsed.rows.length) {
      showToast(`시간제보험 데이터를 찾지 못했습니다. (${sheetName || bulkUtils.SHEET_NAME})`);
      return;
    }
    const summary = bulkUtils.summarizeRows(parsed.rows);
    showToast(`미리보기 · 매칭 ${summary.matched}/${summary.total}건 · ${summary.hourlyInsuranceTotal.toLocaleString('ko-KR')}원 · 「적용하기」를 누르세요`);
  }

  async function handleHourlyInsuranceBulkFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    state.hourlyInsurancePendingFileName = file.name;
    try {
      const buffer = await readFileAsArrayBuffer(file);
      await parseHourlyInsuranceBulkBuffer(buffer);
    } catch (error) {
      console.error('[payroll hourly insurance bulk]', error);
      showToast('시간제보험 일괄등록 파일을 읽지 못했습니다.');
      resetHourlyInsurancePending();
    } finally {
      event.target.value = '';
    }
  }

  function renderHourlyInsuranceBulkPreview() {
    const pendingSection = $('payrollHourlyInsuranceBulkPreview');
    const pendingBody = $('payrollHourlyInsuranceBulkBody');
    const summaryEl = $('payrollHourlyInsuranceBulkSummary');
    const applyBtn = $('payrollHourlyInsuranceBulkApplyBtn');
    const appliedSection = $('payrollHourlyInsuranceAppliedSection');
    const appliedBody = $('payrollHourlyInsuranceAppliedBody');
    const appliedSummaryEl = $('payrollHourlyInsuranceAppliedSummary');
    const bulkUtils = window.BremPayrollHourlyInsuranceBulk;
    if (!pendingBody || !bulkUtils) return;

    const appliedDriverIds = bulkUtils.collectAppliedDriverIds(state.hourlyInsuranceAppliedBatches);
    const pendingFiltered = bulkUtils.filterRowsForApply(state.hourlyInsurancePendingRows, appliedDriverIds);
    const pendingSeen = new Set();

    if (pendingSection) {
      pendingSection.hidden = !state.hourlyInsurancePendingRows.length;
    }
    if (applyBtn) {
      applyBtn.disabled = !pendingFiltered.toApply.length;
    }

    if (!state.hourlyInsurancePendingRows.length) {
      pendingBody.innerHTML = '';
    } else {
      if (summaryEl) {
        const applyCount = pendingFiltered.toApply.length;
        summaryEl.textContent = `${state.hourlyInsurancePendingFileName || '미리보기'} · 신규 적용 ${applyCount}명 · ${pendingFiltered.toApply.reduce((s, r) => s + Number(r.hourlyInsurance || 0), 0).toLocaleString('ko-KR')}원`;
      }
      pendingBody.innerHTML = state.hourlyInsurancePendingRows.map(row => {
        let applyLabel = row.matchStatusLabel || '-';
        let statusCls = row.matchStatus === 'matched' ? 'text-success' : 'text-danger';
        const driverId = String(row.driverId || '').trim();
        if (row.matchStatus === 'matched' && driverId) {
          if (appliedDriverIds.has(driverId)) {
            applyLabel = '이미 적용';
            statusCls = 'text-warning';
          } else if (pendingSeen.has(driverId)) {
            applyLabel = '시트 중복';
            statusCls = 'text-warning';
          } else {
            pendingSeen.add(driverId);
          }
        }
        return `
          <tr>
            <td>${row.rowNumber}</td>
            <td>${escapeHtml(row.platformId || '-')}</td>
            <td>${formatMoney(row.hourlyInsurance)}</td>
            <td>${escapeHtml(row.driverName || '-')}</td>
            <td class="${statusCls}">${escapeHtml(row.matchPlatformLabel || '-')}</td>
            <td class="${statusCls}">${escapeHtml(row.matchedPlatformId || '-')}</td>
            <td class="${statusCls}">${escapeHtml(applyLabel)}</td>
          </tr>
        `;
      }).join('');
    }

    const applied = bulkUtils.summarizeAppliedBatches(state.hourlyInsuranceAppliedBatches);
    if (appliedSection) {
      appliedSection.hidden = !state.hourlyInsuranceAppliedBatches.length;
    }
    if (appliedSummaryEl) {
      appliedSummaryEl.textContent = state.hourlyInsuranceAppliedBatches.length
        ? `적용 ${applied.batchCount}회 · 기사 ${applied.matchedDrivers}명 (기사당 1회) · 합계 ${applied.hourlyInsuranceTotal.toLocaleString('ko-KR')}원`
        : '아직 적용된 정산서가 없습니다';
    }
    if (appliedBody) {
      appliedBody.innerHTML = state.hourlyInsuranceAppliedBatches.map((batch, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(batch.fileName || '-')}</td>
          <td>${new Date(batch.appliedAt).toLocaleString('ko-KR')}</td>
          <td>${Number(batch.matchedCount || 0).toLocaleString('ko-KR')}명</td>
          <td>${formatMoney(batch.totalAmount)}</td>
          <td>
            <button type="button" class="small-btn danger-btn" data-hourly-insurance-remove-batch="${escapeHtml(batch.id)}">삭제</button>
          </td>
        </tr>
      `).join('');
    }

    if (!state.hourlyInsurancePendingRows.length && !state.hourlyInsuranceAppliedBatches.length && summaryEl) {
      summaryEl.textContent = '주정산서 업로드 → 미리보기 → 적용하기 (기사당 1회만, 정산서 여러 장 가능)';
    }

    renderBulkMatchIssuePanels({
      rows: state.hourlyInsurancePendingRows,
      bulkUtils,
      issuesBoxId: 'payrollHourlyInsuranceMatchIssuesBox',
      unmatchedBoxId: 'payrollHourlyInsuranceUnmatchedBox',
      duplicateBoxId: 'payrollHourlyInsuranceDuplicateBox',
      unmatchedBodyId: 'payrollHourlyInsuranceUnmatchedBody',
      duplicateBodyId: 'payrollHourlyInsuranceDuplicateBody',
      unmatchedCountId: 'payrollHourlyInsuranceUnmatchedCount',
      duplicateCountId: 'payrollHourlyInsuranceDuplicateCount',
      driverSelectAttr: 'hourly-insurance-bulk-driver-select',
      rowLabelFn: row => `${row.platformId || '-'} · ${formatMoney(row.hourlyInsurance)}`
    });
  }

  function setPayrollUploadLoading(isLoading, message) {
    const issueEl = $('payrollPreviewIssues');
    if (!issueEl || !isLoading) return;
    issueEl.textContent = message || '엑셀 파일 분석 중…';
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function parseWorkbookBuffer(buffer) {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const settlementWeekStart = resolveActiveSettlementWeekStart();
    if (!settlementWeekStart) {
      showToast('먼저 「정산주 선택 (수요일)」으로 정산주를 고르세요. 수요일~화요일 기준입니다.');
      return;
    }

    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const parsed = utils.parseSheetRows(rows);
    state.parsedLines = utils.enrichLinesWithDrivers(
      parsed.lines,
      getMatchingDrivers(),
      getPayrollCalls(),
      settlementWeekStart,
      getEnrichmentOptions()
    );
    state.parsedIssues = collectParseIssues(state.parsedLines);
    renderPreview();

    if (!parsed.lines.length) {
      showToast('업로드할 급여 데이터를 찾지 못했습니다. (2행부터 · C열 기사명 확인)');
      return;
    }
    showToast(`${parsed.lines.length}건 미리보기 · ${utils.formatSettlementWeekLabel(settlementWeekStart)}`);

    void ensurePayrollDataLoaded()
      .then(() => {
        refreshParsedLineMatches();
        renderPreview();
      })
      .catch(error => {
        console.warn('[payroll drivers refresh]', error);
      });
  }

  async function handleFileChange(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    const settlementWeekStart = resolveActiveSettlementWeekStart();
    if (!settlementWeekStart) {
      showToast('먼저 「정산주 선택 (수요일)」으로 정산주를 고르세요. 수요일~화요일 기준입니다.');
      input.value = '';
      return;
    }

    state.fileName = file.name;
    setPayrollUploadLoading(true, `"${file.name}" 분석 중…`);
    showToast('엑셀 파일 분석 중…');

    try {
      const buffer = await readFileAsArrayBuffer(file);
      await parseWorkbookBuffer(buffer);
    } catch (error) {
      console.error('[payroll upload]', error);
      showToast(error?.message || '엑셀 파일을 읽지 못했습니다.');
      resetPreview();
    } finally {
      input.value = '';
    }
  }

  function canProceedSave() {
    const unmatched = utils.getUnmatchedLines(state.parsedLines);
    if (unmatched.length) {
      showToast(`미매칭 ${unmatched.length}건 — 저장 전 기사를 선택하거나 매칭 재시도하세요.`);
      return false;
    }

    const duplicateUnresolved = utils.getDuplicateLines(state.parsedLines);
    if (duplicateUnresolved.length) {
      showToast(`동명이인 ${duplicateUnresolved.length}건 — 저장 전 기사를 선택하세요.`);
      return false;
    }

    const diffLines = state.parsedLines.filter(line => Math.abs(line.netPayDiff || 0) > 1);
    if (diffLines.length) {
      const ok = window.confirm(
        `엑셀 실지급액과 계산 실지급액이 다른 행이 ${diffLines.length}건 있습니다.\n그래도 저장할까요?`
      );
      if (!ok) return false;
    }

    return true;
  }

  async function applyUpload() {
    if (!state.parsedLines.length || state.isApplying) return;
    if (!canSavePayroll()) {
      showToast(state.storageStatus?.hint || '현재 환경에서는 급여명세서를 저장할 수 없습니다.');
      return;
    }
    if (!canProceedSave()) return;

    const settlementWeekStart = resolveActiveSettlementWeekStart();
    if (!settlementWeekStart) {
      showToast('정산주(수요일 시작)를 선택하세요.');
      return;
    }
    syncSettlementWeekUI(settlementWeekStart);
    const payMonth = utils.settlementWeekPayKey(settlementWeekStart);
    const settlementWeekEnd = utils.settlementWeekEnd(settlementWeekStart);

    state.isApplying = true;
    renderPreviewSummary();
    const applyBtn = $('payrollApplyBtn');
    if (applyBtn) applyBtn.textContent = '저장 중…';

    try {
      await ensurePayrollDataLoaded();
      refreshParsedLineMatches();
      const summary = utils.summarizeLines(state.parsedLines);
      const admin = currentAdmin();

      const upload = await uploads.create({
        payMonth,
        fileName: state.fileName || 'manual-upload.xlsx',
        uploadedBy: admin?.name || '',
        uploadedById: admin?.id || '',
        status: 'applied',
        rowCount: summary.count,
        totalGross: summary.paymentTotal,
        totalDeduction: summary.deductionTotal,
        totalNet: summary.calculatedNetPay,
        rawSummary: {
          settlementWeekStart,
          settlementWeekEnd,
          settlementWeekLabel: utils.formatSettlementWeekLabel(settlementWeekStart),
          excelNetPayTotal: summary.excelNetPay,
          diffCount: state.parsedLines.filter(line => Math.abs(line.netPayDiff || 0) > 1).length,
          unmatchedCount: utils.getUnmatchedLines(state.parsedLines).length,
          duplicateCount: utils.getDuplicateLines(state.parsedLines).length
        }
      });

      const payload = state.parsedLines.map(line => {
        const payslip = utils.buildPayslipRecord(line);
        return {
        uploadId: upload.id,
        payMonth,
        driverId: line.selectedDriverId || '',
        riderName: payslip.riderName || line.riderName,
        employeeNo: (getMatchingDrivers().find(d => d.id === line.selectedDriverId)?.employeeNo) || '',
        department: line.branchName || '',
        basePay: line.totalDeliveryFee,
        allowance: line.baeminMission + line.otherPayment + line.bremPromotion,
        grossPay: line.paymentTotal,
        incomeTax: line.withholdingTax,
        localTax: 0,
        insurance: line.employmentInsurance + line.industrialAccidentInsurance,
        otherDeduction: line.callFee + line.hourlyInsurance + line.promotionWithholdingTax + line.dailySettlementFee,
        totalDeduction: line.deductionTotal,
        netPay: payslip.finalNetPay,
        memo: [line.matchStatusLabel, line.matchPlatformLabel !== '-' ? line.matchPlatformLabel : '', line.matchedPlatformId !== '-' ? line.matchedPlatformId : ''].filter(Boolean).join(' · ') || '',
        rawData: {
          payslip,
          rowNumber: line.rowNumber,
          branchName: line.branchName,
          callCount: line.callCount,
          registeredCallCount: line.registeredCallCount,
          totalDeliveryFee: line.totalDeliveryFee,
          baeminMission: line.baeminMission,
          otherPayment: line.otherPayment,
          bremPromotion: line.bremPromotion,
          bremPromotionFromBulk: Boolean(line.bremPromotionFromBulk),
          grossPaymentTotal: line.grossPaymentTotal,
          employmentInsurance: line.employmentInsurance,
          industrialAccidentInsurance: line.industrialAccidentInsurance,
          hourlyInsurance: line.hourlyInsurance,
          hourlyInsuranceFromBulk: Boolean(line.hourlyInsuranceFromBulk),
          excelWithholdingTax: line.excelWithholdingTax,
          jColumnAmount: line.jColumnAmount,
          jWithholdingDeduction: line.jWithholdingDeduction,
          otherPaymentWithholdingDeduction: line.jWithholdingDeduction,
          withholdingTax: line.withholdingTax,
          promotionWithholdingTax: line.promotionWithholdingTax,
          callFeeO: line.callFeeO,
          callFeeP: line.callFeeP,
          callFee: line.callFee,
          rawCallFee: line.rawCallFee,
          dailySettlementEnrolled: line.dailySettlementEnrolled,
          dailySettlementApply: line.dailySettlementApply !== false,
          dailySettlementFee: line.dailySettlementFee,
          adminAdjustedCallFee: line.adminAdjustedCallFee,
          dailySettlementRegion: line.dailySettlementRegion,
          paymentTotal: line.paymentTotal,
          deductionTotal: line.deductionTotal,
          calculatedNetPay: line.calculatedNetPay,
          excelNetPay: line.excelNetPay,
          netPayDiff: line.netPayDiff,
          matchStatus: line.matchStatus,
          matchPlatform: line.matchPlatform,
          matchPlatformLabel: line.matchPlatformLabel,
          matchedPlatformId: line.matchedPlatformId,
          matchedBaeminId: line.matchedBaeminId,
          matchedCoupangId: line.matchedCoupangId,
          selectedDriverId: line.selectedDriverId,
          selectedDriverName: line.selectedDriverName,
          productionRidersReadOnly: state.productionRidersActive,
          settlementWeekStart,
          settlementWeekEnd,
          issues: line.issues || []
        }
      };
      });

      await lines.createMany(payload);
      resetPreview();
      state.selectedUploadId = upload.id;
      syncPayrollListSearchWeekUI(settlementWeekStart);
      await refresh({ loadRemote: true });
      void refreshPublishStatus();
      showToast(`${summary.count}건 저장 · ${utils.formatSettlementWeekLabel(settlementWeekStart)}`);
    } catch (error) {
      console.error('[payroll apply]', error);
      showToast(error?.message || '저장에 실패했습니다.');
    } finally {
      state.isApplying = false;
      if (applyBtn) applyBtn.textContent = '저장하기';
      renderPreviewSummary();
    }
  }

  function renderUploadHistory() {
    const body = $('payrollUploadBody');
    const countEl = $('payrollUploadCount');
    if (!body) return;

    const searchWeek = activeListSearchWeekStart();
    const list = (searchWeek
      ? uploads.getAll().filter(item => itemMatchesSearchWeek(item, searchWeek, 'upload'))
      : uploads.getAll())
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));

    if (countEl) countEl.textContent = `${list.length}건`;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">업로드 기록이 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = list.map(item => `
      <tr data-payroll-upload-id="${escapeHtml(item.id)}" class="${state.selectedUploadId === item.id ? 'is-selected' : ''}">
        <td>${escapeHtml(formatPeriodLabel(item.payMonth))}</td>
        <td>${escapeHtml(item.fileName || '-')}</td>
        <td>${Number(item.rowCount || 0).toLocaleString('ko-KR')}명</td>
        <td>${formatMoney(item.totalGross)}</td>
        <td>${formatMoney(item.totalDeduction)}</td>
        <td>${formatMoney(item.totalNet)}</td>
        <td>${escapeHtml(item.uploadedBy || '-')}</td>
        <td>
          <button type="button" class="small-btn" data-payroll-view-upload="${escapeHtml(item.id)}">보기</button>
          ${canDeletePayroll()
            ? `<button type="button" class="small-btn danger-btn" data-payroll-delete-upload="${escapeHtml(item.id)}">삭제</button>`
            : ''}
        </td>
      </tr>
    `).join('');
  }

  function lineDisplay(item) {
    const raw = item.rawData && typeof item.rawData === 'object' ? item.rawData : {};
    const merged = {
      ...(raw.payslip && typeof raw.payslip === 'object' ? raw.payslip : {}),
      ...raw,
      riderName: raw.payslip?.riderName || raw.riderName || item.riderName
    };
    const payslip = utils.buildPayslipRecord(merged);
    return {
      ...payslip,
      riderName: payslip.riderName || item.riderName || '-',
      coupangId: payslip.coupangId || '-',
      baeminId: payslip.baeminId || '-'
    };
  }

  function payslipListGroups() {
    return utils.PAYSLIP_LIST_GROUPS || [];
  }

  function payslipListColumnCount() {
    const groups = payslipListGroups();
    return 2 + groups.reduce((sum, group) => sum + group.fields.length, 0);
  }

  function renderLineListCell(payslip, field, groupId) {
    if (field.idField) {
      const value = payslip[field.key];
      const text = value && String(value).trim() && String(value).trim() !== '-' ? String(value).trim() : '-';
      return `<td class="payroll-payslip-col payroll-payslip-col--${groupId}">${escapeHtml(text)}</td>`;
    }

    const emphasisCls = field.emphasis ? ' payroll-payslip-emphasis' : '';
    if (field.money) {
      const value = field.key === 'withholdingTax'
        ? Number(payslip.withholdingTax ?? utils.resolveWithholdingTax?.(payslip) ?? 0)
        : Number(payslip[field.key] || 0);
      const bulkCls = field.bulkOnly && value > 0 ? ' payroll-payslip-bulk' : '';
      const dailyCls = field.dailyOnly && value > 0 ? ' payroll-payslip-daily' : '';
      return `<td class="payroll-payslip-col payroll-payslip-col--${groupId}${emphasisCls}${bulkCls}${dailyCls}">${formatMoney(value)}</td>`;
    }

    return `<td class="payroll-payslip-col payroll-payslip-col--${groupId}${emphasisCls}">${escapeHtml(payslip[field.key] ?? '-')}</td>`;
  }

  function renderLineListHead() {
    const head = $('payrollLineHead');
    if (!head) return;

    const groups = payslipListGroups();
    const groupHead = `
      <th rowspan="2" class="payroll-payslip-rownum">정산주</th>
      ${groups.map(group =>
        `<th colspan="${group.fields.length}" class="payroll-payslip-group payroll-payslip-group--${group.id}">${escapeHtml(group.label)}</th>`
      ).join('')}
      <th rowspan="2" class="payroll-payslip-col">관리</th>
    `;

    const colHead = groups.flatMap(group => group.fields.map(field =>
      `<th class="payroll-payslip-col payroll-payslip-col--${group.id}${field.emphasis ? ' payroll-payslip-emphasis' : ''}">${escapeHtml(field.label)}</th>`
    )).join('');

    head.innerHTML = `
      <tr class="payroll-payslip-head-group">${groupHead}</tr>
      <tr class="payroll-payslip-head-cols">${colHead}</tr>
    `;
  }

  function renderLineList() {
    const body = $('payrollLineBody');
    const countEl = $('payrollLineCount');
    const grossEl = $('payrollListGross');
    const deductionEl = $('payrollListDeduction');
    const netEl = $('payrollListNet');
    if (!body) return;

    renderLineListHead();

    let list = filterPayrollLineList();
    const groups = payslipListGroups();
    const allFields = groups.flatMap(group => group.fields.map(field => ({ ...field, groupId: group.id })));
    const colCount = payslipListColumnCount();

    const summary = utils.summarizeLines(list.map(item => {
      const view = lineDisplay(item);
      return {
        grossPaymentTotal: view.grossPaymentTotal,
        paymentTotal: view.grossPaymentTotal,
        deductionTotal: view.deductionTotal,
        calculatedNetPay: view.finalNetPay
      };
    }));

    if (countEl) countEl.textContent = `${summary.count}건`;
    if (grossEl) grossEl.textContent = formatMoney(summary.grossPaymentTotal || summary.paymentTotal);
    if (deductionEl) deductionEl.textContent = formatMoney(summary.deductionTotal);
    if (netEl) netEl.textContent = formatMoney(summary.calculatedNetPay);

    if (!list.length) {
      body.innerHTML = `<tr><td colspan="${colCount}" class="empty">조회된 급여명세서가 없습니다.</td></tr>`;
      return;
    }

    body.innerHTML = list.map(item => {
      const view = lineDisplay(item);
      const cells = allFields.map(field => renderLineListCell(view, field, field.groupId)).join('');
      return `
      <tr>
        <td class="payroll-payslip-rownum">${escapeHtml(formatPeriodLabel(item.payMonth))}</td>
        ${cells}
        <td>${canDeletePayroll()
          ? `<button type="button" class="small-btn danger-btn" data-payroll-delete-line="${escapeHtml(item.id)}">삭제</button>`
          : '-'}</td>
      </tr>`;
    }).join('');
  }

  function renderFilters() {
    syncPayrollListSearchWeekUI(state.searchSettlementWeekStart);
    const keywordInput = $('payrollSearchKeyword');
    if (keywordInput && keywordInput.value !== state.searchKeyword) keywordInput.value = state.searchKeyword;
  }

  async function deleteUpload(uploadId) {
    const id = String(uploadId || '').trim();
    if (!id) return;
    if (!canDeletePayroll()) {
      showToast(state.storageStatus?.hint || '현재 환경에서는 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm('이 업로드 배치와 연결된 급여명세서를 모두 삭제할까요?')) return;
    try {
      await lines.removeByUploadId(id);
      await uploads.removeById(id);
      if (state.selectedUploadId === id) state.selectedUploadId = '';
      await refresh({ loadRemote: true });
      showToast('업로드 기록을 삭제했습니다.');
    } catch (error) {
      console.error('[payroll delete upload]', error);
      showToast(error?.message || '삭제에 실패했습니다.');
    }
  }

  async function deleteLine(lineId) {
    const id = String(lineId || '').trim();
    if (!id) return;
    if (!canDeletePayroll()) {
      showToast(state.storageStatus?.hint || '현재 환경에서는 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm('이 급여명세서 항목을 삭제할까요?')) return;
    try {
      await lines.removeByIds([id]);
      await refresh({ loadRemote: true });
      showToast('항목을 삭제했습니다.');
    } catch (error) {
      console.error('[payroll delete line]', error);
      showToast(error?.message || '삭제에 실패했습니다.');
    }
  }

  function bindEvents() {
    $('payrollTemplateBtn')?.addEventListener('click', downloadTemplate);
    $('payrollExportBtn')?.addEventListener('click', downloadLineListExcel);
    $('payrollImportBaseDataBtn')?.addEventListener('click', () => { void importProductionBaseData(); });
    $('payrollSyncProductionRidersBtn')?.addEventListener('click', () => { void syncProductionRiders(); });
    $('payrollFileInput')?.addEventListener('change', event => { void handleFileChange(event); });
    $('payrollClearBtn')?.addEventListener('click', resetPreview);
    $('payrollApplyBtn')?.addEventListener('click', () => { void applyUpload(); });
    $('payrollPublishToRidersBtn')?.addEventListener('click', () => { void publishToRiders(); });
    $('payrollPublishPaymentDate')?.addEventListener('change', () => {
      state.publishPaymentDateTouched = true;
    });
    $('payrollPromotionBulkTemplateBtn')?.addEventListener('click', downloadPromotionBulkTemplate);
    $('payrollPromotionBulkFile')?.addEventListener('change', event => { void handlePromotionBulkFileChange(event); });
    $('payrollPromotionBulkApplyBtn')?.addEventListener('click', applyPromotionPending);
    $('payrollPromotionBulkClearPendingBtn')?.addEventListener('click', resetPromotionPending);
    $('payrollPromotionBulkClearBtn')?.addEventListener('click', resetPromotionBulk);
    $('payrollPromotionRetryMatchBtn')?.addEventListener('click', retryPromotionBulkMatching);
    $('payrollPromotionAppliedBody')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-promotion-remove-batch]');
      if (btn) removePromotionBatch(btn.dataset.promotionRemoveBatch);
    });
    $('payrollHourlyInsuranceRetryMatchBtn')?.addEventListener('click', retryHourlyInsuranceBulkMatching);
    $('payrollHourlyInsuranceBulkFile')?.addEventListener('change', event => { void handleHourlyInsuranceBulkFileChange(event); });
    $('payrollHourlyInsuranceBulkApplyBtn')?.addEventListener('click', applyHourlyInsurancePending);
    $('payrollHourlyInsuranceBulkClearPendingBtn')?.addEventListener('click', resetHourlyInsurancePending);
    $('payrollHourlyInsuranceBulkClearBtn')?.addEventListener('click', resetHourlyInsuranceBulk);
    $('payrollHourlyInsuranceAppliedBody')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-hourly-insurance-remove-batch]');
      if (btn) removeHourlyInsuranceBatch(btn.dataset.hourlyInsuranceRemoveBatch);
    });
    $('payrollRetryMatchBtn')?.addEventListener('click', retryDriverMatching);
    $('payrollMatchIssuesBox')?.addEventListener('input', event => {
      handleDriverPickerSearchInput(event);
    });
    $('payrollMatchIssuesBox')?.addEventListener('change', event => {
      const driverSelect = event.target.closest('[data-payroll-driver-select]');
      if (driverSelect) {
        updateParsedLine(driverSelect.dataset.payrollDriverSelect, {
          selectedDriverId: driverSelect.value
        });
        renderPreview();
      }
    });

    $('payrollBulkPanel')?.addEventListener('input', event => {
      handleDriverPickerSearchInput(event);
    });
    $('payrollBulkPanel')?.addEventListener('change', event => {
      const promoSelect = event.target.closest('[data-promotion-bulk-driver-select]');
      if (promoSelect) {
        updatePromotionPendingDriver(promoSelect.dataset.promotionBulkDriverSelect, promoSelect.value);
        return;
      }
      const hourlySelect = event.target.closest('[data-hourly-insurance-bulk-driver-select]');
      if (hourlySelect) {
        updateHourlyInsurancePendingDriver(hourlySelect.dataset.hourlyInsuranceBulkDriverSelect, hourlySelect.value);
      }
    });
    $('payrollDailySettlementApplyAll')?.addEventListener('change', event => {
      state.defaultDailySettlementApply = event.target.checked;
      state.parsedLines = state.parsedLines.map(line => {
        if (!line.dailySettlementEnrolled) return line;
        return computeLineWithMatch({
          ...line,
          dailySettlementApply: state.defaultDailySettlementApply
        });
      });
      renderPreview();
    });

    $('payrollPreviewDetailBtn')?.addEventListener('click', () => {
      state.showPayrollDetailColumns = !state.showPayrollDetailColumns;
      const btn = $('payrollPreviewDetailBtn');
      if (btn) {
        btn.textContent = state.showPayrollDetailColumns ? '상세 숨기기' : '상세 보기';
        btn.classList.toggle('is-active', state.showPayrollDetailColumns);
      }
      renderPreviewTable();
    });

    $('payrollSearchKeyword')?.addEventListener('input', event => {
      state.searchKeyword = String(event.target.value || '').trim();
      renderLineList();
    });
    $('payrollSearchResetBtn')?.addEventListener('click', () => {
      state.searchSettlementWeekStart = '';
      state.searchKeyword = '';
      state.selectedUploadId = '';
      renderFilters();
      renderUploadHistory();
      renderLineList();
    });

    $('payrollPreviewBody')?.addEventListener('change', event => {
      const dailyApply = event.target.closest('[data-payroll-daily-settle-apply]');
      if (dailyApply) {
        updateParsedLine(dailyApply.dataset.payrollDailySettleApply, {
          dailySettlementApply: dailyApply.checked
        });
        renderPreview();
        return;
      }
      const driverSelect = event.target.closest('[data-payroll-driver-select]');
      if (driverSelect) {
        updateParsedLine(driverSelect.dataset.payrollDriverSelect, {
          selectedDriverId: driverSelect.value
        });
        renderPreview();
        return;
      }
      const feeInput = event.target.closest('[data-payroll-fee-input]');
      if (feeInput) {
        return;
      }
      const otherInput = event.target.closest('[data-payroll-other-input]');
      if (otherInput) return;
    });

    $('payrollUploadBody')?.addEventListener('click', event => {
      const viewBtn = event.target.closest('[data-payroll-view-upload]');
      if (viewBtn) {
        state.selectedUploadId = viewBtn.dataset.payrollViewUpload || '';
        renderUploadHistory();
        renderLineList();
        return;
      }
      const deleteBtn = event.target.closest('[data-payroll-delete-upload]');
      if (deleteBtn) {
        void deleteUpload(deleteBtn.dataset.payrollDeleteUpload);
      }
    });

    $('payrollLineBody')?.addEventListener('click', event => {
      const deleteBtn = event.target.closest('[data-payroll-delete-line]');
      if (deleteBtn) {
        void deleteLine(deleteBtn.dataset.payrollDeleteLine);
      }
    });
  }

  async function refresh(options = {}) {
    if (options.loadRemote !== false) {
      await BremStorage.ensureSectionLoaded?.('payroll-slips', { force: options.force === true });
    }
    ensureSettlementWeekInitialized();
    await ensurePayrollDataLoaded();
    await refreshStorageStatus();
    refreshLocalBaseState();
    refreshProductionRidersState();
    if (options.reloadCalls !== false && state.settlementWeekCalls.length === 0) {
      await ensureSettlementWeekCalls({ silent: true });
    } else {
      updateSettlementWeekRangeLabel(activeSettlementWeekStart(), state.settlementWeekCalls.length);
    }
    renderFilters();
    renderPreview();
    renderUploadHistory();
    renderLineList();
    renderPromotionBulkPreview();
    renderHourlyInsuranceBulkPreview();
    void refreshPublishStatus();
  }

  bindEvents();
  void refresh();

  window.BremAdminPayrollSlips = {
    refresh,
    refreshParsedMatches: refreshParsedLineMatches,
    handleSettlementWeekChange,
    handlePayrollListWeekChange,
    handlePublishWeekChange,
    refreshPublishStatus
  };
})();

if (!window.BremAdminPayrollSlips) {
  console.error('[payroll-slips] 초기화 실패 — storage 또는 payroll-slip-utils 로드를 확인하세요.');
}

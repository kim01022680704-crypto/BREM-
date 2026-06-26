(function () {
  const erp = window.BremLeaseErp;
  const leases = erp ? erp.vehicles() : BremStorage.leases;
  if (!leases) return;

  const LEASE_RENTAL_EXPORT_HEADERS = [
    '종류', '리스회사', '리스비(하루)', '주간리스비', '번호판', '리스시작일', '리스종료일', '렌탈/리스자',
    '리스나간금액(하루)', '주간청구금액', '차액수익금(일)', '주간수익금', '미납일', '미납금', '완납/미납체크', '미납금액회수방법', '실제수익', '공차일', '공차손실', '상태'
  ];

  const COMPANY_OWNED_EXPORT_HEADERS = [
    '종류', '리스/렌탈', '차량가액', '취득세%', '취득세금액', '기타비용', '합계', '하루원가', '주간원가', '번호판',
    '리스시작일', '리스종료일', '렌탈/리스자', '리스나간금액(일)', '차액수익금(일)', '주간수익금', '미납일', '미납금',
    '완납/미납체크', '미납금액회수방법', '실제수익', '공차일', '공차손실', '상태'
  ];

  const BULK_COLUMNS = [
    { key: 'contractType', label: '구분', aliases: ['구분', '유형', '타입'] },
    { key: 'model', label: '리스 기종', aliases: ['리스 기종', '리스기종', '기종'] },
    { key: 'chassisNumber', label: '차대번호' },
    { key: 'vehicleNumber', label: '차량번호' },
    { key: 'insuranceCompany', label: '보험사' },
    { key: 'insuranceAge', label: '보험연령' },
    { key: 'insuranceType', label: '보험종류' },
    { key: 'contractStartDate', label: '계약시작일', aliases: ['계약시작일', '시작일'] },
    { key: 'contractEndDate', label: '최종만료일', aliases: ['최종만료일', '만료일'] },
    { key: 'dailyRent', label: '일렌트료' },
    { key: 'weeklyRent', label: '주렌트료', aliases: ['주렌트료', '월렌트료'] },
    { key: 'memo', label: '메모' },
    { key: 'renter', label: '렌탈자' },
    { key: 'lessor', label: '리스자' },
    { key: 'returnDate', label: '반납일', aliases: ['반납일', '오토바이 반납일', '반납날짜'] }
  ];

  const EXCEL_HEADERS = BULK_COLUMNS.map(column => column.label);
  const LEASE_EXPORT_HEADERS = [
    ...EXCEL_HEADERS,
    '렌탈배정자',
    '렌탈시작일',
    '렌탈일료',
    '렌탈주료',
    '렌탈반납일',
    '렌탈메모',
    '공차여부'
  ];

  const HEADER_MARKERS = ['구분', '리스 기종', '리스기종', '차대번호'];

  const state = {
    erpMode: 'all',
    filterType: 'all',
    searchQuery: '',
    editingId: '',
    parsedRows: [],
    selectedIds: new Set()
  };

  const formEl = document.getElementById('leaseForm');
  const editIdEl = document.getElementById('leaseEditId');
  const returnDateWrapEl = document.getElementById('leaseReturnDateWrap');
  const rowsEl = document.getElementById('leaseRows');
  const bulkPreviewBodyEl = document.getElementById('leaseBulkPreviewBody');
  const bulkApplyBtn = document.getElementById('leaseBulkApplyBtn');
  const bulkTotalEl = document.getElementById('leaseBulkTotal');
  const bulkValidEl = document.getElementById('leaseBulkValid');
  const bulkErrorEl = document.getElementById('leaseBulkError');

  function $(id) {
    return document.getElementById(id);
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

  async function persistLeasesOrWarn() {
    try {
      if (erp) {
        await erp.persistAll();
      } else {
        await leases.persist();
      }
      return true;
    } catch (error) {
      console.error('[BREM] lease persist failed:', error);
      showToast(error?.message || '저장에 실패했습니다. 새로고침 후 다시 시도하세요.');
      return false;
    }
  }

  function number(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatDate(value) {
    if (!value) return '-';
    return BremDatePicker.formatDate(value);
  }

  function formatMoney(value) {
    const num = Number(value || 0);
    if (!num) return '-';
    return `${number(num)}원`;
  }

  function readErpMode() {
    const checked = document.querySelector('input[name="leaseErpMode"]:checked');
    return checked?.value === 'company_owned' ? 'company_owned' : 'company_lease_rental';
  }

  function setErpModeForm(mode) {
    const erpMode = mode === 'company_owned' ? 'company_owned' : 'company_lease_rental';
    document.querySelectorAll('input[name="leaseErpMode"]').forEach(input => {
      input.checked = input.value === erpMode;
    });
    if ($('leaseErpModeInput')) $('leaseErpModeInput').value = erpMode;
    updateFormFieldVisibility(erpMode);
    syncFormCalculations();
  }

  function updateFormFieldVisibility(erpMode) {
    const owned = erpMode === 'company_owned';
    document.querySelectorAll('[data-erp-only="company_lease_rental"]').forEach(el => {
      el.hidden = owned;
    });
    document.querySelectorAll('[data-erp-only="company_owned"]').forEach(el => {
      el.hidden = !owned;
    });
    document.querySelectorAll('[data-lease-field="lease-company"], [data-lease-field="daily-lease-cost"], [data-lease-field="weekly-lease-cost"]').forEach(el => {
      el.hidden = owned;
    });
    document.querySelectorAll('[data-lease-field="vehicle-price"], [data-lease-field="acquisition-tax-rate"], [data-lease-field="acquisition-tax-amount"], [data-lease-field="other-acquisition-cost"], [data-lease-field="annual-insurance"], [data-lease-field="total-acquisition-cost"], [data-lease-field="daily-owned-cost"], [data-lease-field="weekly-owned-cost"]').forEach(el => {
      el.hidden = !owned;
    });
    updateEmptyFieldVisibility();
  }

  function updateEmptyFieldVisibility() {
    const isEmpty = $('leaseVehicleStatus')?.value === 'empty';
    document.querySelectorAll('[data-lease-field="empty"]').forEach(el => {
      el.hidden = !isEmpty;
    });
  }

  function buildDraftFromForm() {
    const erpMode = readErpMode();
    const contractType = readFormContractType();
    const vehicleCategory = erpMode === 'company_owned' ? 'company_owned' : 'external_lease';
    return leases.normalizeRecord({
      vehicleCategory,
      contractType,
      operationType: contractType,
      model: $('leaseModel')?.value || '',
      chassisNumber: $('leaseChassisNumber')?.value || '',
      vehicleNumber: $('leaseVehicleNumber')?.value || '',
      leaseCompany: $('leaseCompany')?.value || '',
      dailyLeaseCost: $('leaseDailyLeaseCost')?.value || '',
      contractStartDate: $('leaseContractStartDate')?.value || '',
      contractEndDate: $('leaseContractEndDate')?.value || '',
      dailyChargeAmount: '',
      purchasePrice: $('leasePurchasePrice')?.value || '',
      acquisitionTaxRate: $('leaseAcquisitionTaxRate')?.value || '',
      otherAcquisitionCost: $('leaseOtherAcquisitionCost')?.value || '',
      annualInsuranceCost: $('leaseAnnualInsurance')?.value || '',
      vehicleStatus: $('leaseVehicleStatus')?.value || '',
      emptyStartDate: $('leaseEmptyStartDate')?.value || '',
      emptyDailyLoss: $('leaseEmptyDailyLoss')?.value || '',
      memo: $('leaseMemo')?.value || ''
    });
  }

  function syncFormCalculations() {
    const profitApi = window.BremLeaseProfit;
    const draft = buildDraftFromForm();
    const metrics = profitApi?.computeErpMetrics?.(draft) || {};
    const hintDraft = leases.normalizeRecord({ ...draft, emptyDailyLoss: 0 });
    const hintMetrics = draft.vehicleStatus === 'empty'
      ? (profitApi?.computeErpMetrics?.(hintDraft) || {})
      : {};
    const setVal = (id, value) => {
      const el = $(id);
      if (el) el.value = value || value === 0 ? number(value) : '';
    };
    setVal('leaseWeeklyLeaseCost', metrics.weeklyLeaseCost);
    setVal('leaseAcquisitionTaxAmount', metrics.acquisitionTaxAmount);
    setVal('leaseTotalAcquisitionCost', metrics.totalAcquisitionCost);
    setVal('leaseDailyOwnedCost', metrics.dailyCost);
    setVal('leaseWeeklyOwnedCost', metrics.weeklyCost);
    setVal('leaseEmptyLossPreview', metrics.emptyLoss);

    const emptyDailyEl = $('leaseEmptyDailyLoss');
    if (emptyDailyEl && !emptyDailyEl.value && hintMetrics.emptyDailyLoss) {
      emptyDailyEl.placeholder = `자동: ${number(hintMetrics.emptyDailyLoss)}원/일`;
    } else if (emptyDailyEl && !emptyDailyEl.value) {
      emptyDailyEl.placeholder = '자동(원가/보험)';
    }

    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = formatMoney(value);
    };
    setText('leaseWeeklyLeaseCostPreview', metrics.weeklyLeaseCost);
    setText('leaseWeeklyOwnedCostPreview', metrics.weeklyCost);
    updateEmptyFieldVisibility();
  }

  function getLatestContractForVehicle(vehicleId) {
    return window.BremAdminLeaseMenus?.getLatestContractForVehicle?.(vehicleId) || null;
  }

  function displayVehicleStatus(item) {
    const contract = getLatestContractForVehicle(item.id);
    const status = window.BremAdminLeaseMenus?.resolveContractStatus?.(contract, item.id)
      || {
        label: window.BremLeaseProfit?.vehicleStatusLabel?.(item.vehicleStatus) || '-',
        code: item.vehicleStatus || 'empty'
      };
    return `<span class="lease-status-badge lease-status-badge--${escapeHtml(status.code || 'empty')}">${escapeHtml(status.label)}</span>`;
  }

  function displayCurrentDriver(item) {
    const contract = getLatestContractForVehicle(item.id);
    if (contract?.driverName) return escapeHtml(contract.driverName);
    return escapeHtml(item.renter || '-');
  }

  function contractTypeLabel(type) {
    return type === leases.CONTRACT_TYPES.RENTAL ? '렌탈' : '리스';
  }

  function refreshLeaseDateLabel(targetId) {
    const input = $(targetId);
    const label = $(`${targetId}Label`);
    if (input && label) {
      label.textContent = input.value ? formatDate(input.value) : '날짜 선택';
    }
  }

  function refreshLeaseDateLabels() {
    [
      'leaseContractStartDate',
      'leaseContractEndDate',
      'leaseEmptyStartDate',
      'leaseRentalStartDate',
      'leaseRentalReturnDate'
    ].forEach(refreshLeaseDateLabel);
  }

  function contractTypeBadge(type, item) {
    const isRental = type === leases.CONTRACT_TYPES.RENTAL;
    const cls = isRental ? 'lease-list-badge lease-list-badge--rental' : 'lease-list-badge lease-list-badge--lease';
    const emptyBadge = item && leases.isEmptyVehicle(item)
      ? ' <span class="lease-list-badge lease-list-badge--empty">공차</span>'
      : '';
    return `<span class="${cls}"><span class="lease-list-badge__mark">✓</span>${contractTypeLabel(type)}</span>${emptyBadge}`;
  }

  function rentalAssignmentSummary(item) {
    const assignment = item?.rentalAssignment;
    if (!assignment || !String(assignment.renter || '').trim()) return null;
    return assignment;
  }

  function displayRenter(item) {
    const assignment = rentalAssignmentSummary(item);
    if (assignment) {
      return `<span class="lease-sub-rental">${escapeHtml(assignment.renter)}</span>`;
    }
    return escapeHtml(item.renter || '-');
  }

  function effectiveWeeklyRent(item) {
    if (!item) return 0;
    const daily = Number(item.dailyRent || 0);
    if (daily > 0) return daily * 7;
    return Number(item.weeklyRent || item.monthlyRent || 0);
  }

  function formatWeeklyRentValue(dailyValue, weeklyValue) {
    const daily = Number(dailyValue || 0);
    if (daily > 0) return daily * 7;
    return Number(weeklyValue || 0);
  }

  function syncWeeklyRentPreview(dailyInputId, weeklyInputId) {
    const daily = Number($(dailyInputId)?.value || 0);
    const weeklyEl = $(weeklyInputId);
    if (!weeklyEl) return;
    weeklyEl.value = daily > 0 ? number(daily * 7) : '';
  }

  function displayWeeklyRent(item) {
    const assignment = rentalAssignmentSummary(item);
    const leaseWeekly = effectiveWeeklyRent(item);
    if (item.contractType === leases.CONTRACT_TYPES.LEASE && assignment) {
      const rentalWeekly = effectiveWeeklyRent(assignment);
      return `<span class="lease-rent-split">리스 ${formatMoney(leaseWeekly)}<br>렌탈 ${formatMoney(rentalWeekly)}</span>`;
    }
    return formatMoney(effectiveWeeklyRent(item));
  }

  function updateFilterTabUi() {
    document.querySelectorAll('[data-lease-erp-mode]').forEach(button => {
      const active = button.dataset.leaseErpMode === state.erpMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-lease-filter]').forEach(button => {
      const active = button.dataset.leaseFilter === state.filterType;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const statusEl = $('leaseFilterStatus');
    const listStatusEl = $('leaseFilterStatusList');
    let statusText = '전체 목록 표시 중';
    let statusClass = 'lease-filter-status';

    if (state.filterType === 'empty') {
      statusText = '공차만 표시 중';
      statusClass = 'lease-filter-status lease-filter-status--empty';
    } else if (state.erpMode === 'company_owned') {
      statusText = '회사소유리스만 표시 중';
      statusClass = 'lease-filter-status lease-filter-status--rental';
    } else if (state.erpMode === 'company_lease_rental') {
      statusText = '회사리스만 표시 중';
      statusClass = 'lease-filter-status lease-filter-status--lease';
    }

    if (statusEl) {
      statusEl.textContent = statusText;
      statusEl.className = statusClass;
    }
    if (listStatusEl) {
      const query = state.searchQuery.trim();
      listStatusEl.textContent = query
        ? `${statusText} · 검색 "${query}"`
        : `${statusText} · 엑셀 기준 컬럼 표시`;
    }
  }

  function renderErpSummary(items) {
    let charge = 0;
    let cost = 0;
    let profit = 0;
    let unpaid = 0;
    let emptyLoss = 0;
    let actual = 0;
    let leaseRentalProfit = 0;
    let ownedProfit = 0;

    items.forEach(item => {
      const metrics = window.BremLeaseProfit?.computeErpMetrics?.(item) || {};
      charge += metrics.weeklyCharge || 0;
      cost += metrics.weeklyCost || 0;
      profit += metrics.weeklyProfit || 0;
      unpaid += metrics.unpaidAmount || 0;
      emptyLoss += metrics.emptyLoss || 0;
      actual += metrics.actualProfit || 0;
      if (metrics.mode === 'company_owned') ownedProfit += metrics.actualProfit || 0;
      else leaseRentalProfit += metrics.actualProfit || 0;
    });

    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };

    setText('leaseSummaryCount', `${items.length}대`);
    setText('leaseSummaryCharge', formatMoney(charge));
    setText('leaseSummaryCost', formatMoney(cost));
    setText('leaseSummaryProfit', formatMoney(profit));
    setText('leaseSummaryUnpaid', formatMoney(unpaid));
    setText('leaseSummaryEmpty', formatMoney(emptyLoss));
    setText('leaseSummaryActual', formatMoney(actual));
    setText('leaseHeroWeekProfit', formatMoney(actual));
    setText('leaseHeroWeekCharge', formatMoney(charge));
    setText('leaseHeroUnpaid', formatMoney(unpaid));
    setText('leaseHeroEmptyLoss', formatMoney(emptyLoss));
    setText('leaseModeProfitLeaseRental', formatMoney(leaseRentalProfit));
    setText('leaseModeProfitOwned', formatMoney(ownedProfit));
  }

  function cellValue(row, index) {
    return row?.[index] ?? '';
  }

  function normalizeHeaderCell(value) {
    return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
  }

  function columnAliases(column) {
    return [...new Set([column.label, ...(column.aliases || [])])]
      .map(normalizeHeaderCell)
      .filter(Boolean);
  }

  function isHeaderRow(row) {
    if (!row || !row.some(cell => String(cell || '').trim())) return false;
    const cells = row.map(normalizeHeaderCell);
    const hasType = cells.includes('구분') || cells.includes('유형');
    const hasModel = cells.includes('리스기종') || cells.includes('기종');
    return hasType && hasModel;
  }

  function findHeaderRowIndex(rows) {
    for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
      if (isHeaderRow(rows[index])) return index;
    }
    return -1;
  }

  function buildColumnIndexMap(headerRow) {
    const map = {};
    const normalizedHeaders = headerRow.map(normalizeHeaderCell);

    BULK_COLUMNS.forEach(column => {
      const aliases = columnAliases(column);
      const index = normalizedHeaders.findIndex(header => aliases.includes(header));
      if (index >= 0) map[column.key] = index;
    });

    if (Object.keys(map).length < 4) {
      BULK_COLUMNS.forEach((column, index) => {
        if (map[column.key] == null) map[column.key] = index;
      });
    }

    return map;
  }

  function rowToRaw(row, columnMap) {
    const raw = {};
    BULK_COLUMNS.forEach(column => {
      const index = columnMap[column.key];
      raw[column.key] = index != null ? cellValue(row, index) : '';
    });
    return raw;
  }

  function hasFilledValue(...values) {
    return values.some(value => String(value ?? '').trim() !== '');
  }

  function hasRecordContent(raw) {
    return hasFilledValue(
      raw.model,
      raw.chassisNumber,
      raw.vehicleNumber,
      raw.insuranceCompany,
      raw.insuranceAge,
      raw.insuranceType,
      raw.contractStartDate,
      raw.contractEndDate,
      raw.dailyRent,
      raw.weeklyRent,
      raw.monthlyRent,
      raw.memo,
      raw.renter,
      raw.lessor,
      raw.returnDate
    );
  }

  function validateLeaseForm(data) {
    if (!String(data.vehicleNumber || '').trim() && !String(data.chassisNumber || '').trim()) {
      return '번호판 또는 차대번호를 입력하세요.';
    }
    return '';
  }

  function renderBulkGuideTable() {
    const headEl = document.getElementById('leaseBulkGuideHead');
    const bodyEl = document.getElementById('leaseBulkGuideBody');
    if (!headEl || !bodyEl) return;

    headEl.innerHTML = BULK_COLUMNS.map(column => `<th>${escapeHtml(column.label)}</th>`).join('');
    bodyEl.innerHTML = `
      <tr>
        ${BULK_COLUMNS.map(column => {
          if (column.key === 'contractType') return '<td>리스 / 렌탈</td>';
          if (column.key === 'renter') return '<td>렌탈 시 필수</td>';
          if (column.key === 'returnDate') return '<td>렌탈 반납 시 입력</td>';
          return '<td>리스: 빈칸 가능</td>';
        }).join('')}
      </tr>
    `;
  }

  function renderBulkPreviewHead() {
    const headEl = document.getElementById('leaseBulkPreviewHead');
    if (!headEl) return;
    headEl.innerHTML = `
      <th>행</th>
      ${BULK_COLUMNS.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}
      <th>결과</th>
    `;
  }

  function previewCellValue(key, data) {
    if (key === 'contractType') return contractTypeBadge(data.contractType, data);
    if (key === 'contractStartDate' || key === 'contractEndDate' || key === 'returnDate') {
      return escapeHtml(data[key] ? formatDate(data[key]) : '-');
    }
    if (key === 'dailyRent' || key === 'weeklyRent') {
      const weekly = key === 'weeklyRent'
        ? effectiveWeeklyRent(data)
        : formatWeeklyRentValue(data.dailyRent, data.weeklyRent);
      return escapeHtml(weekly ? number(weekly) : '-');
    }
    return escapeHtml(data[key] || '-');
  }

  function readFormContractType() {
    const checked = document.querySelector('input[name="leaseContractType"]:checked');
    return checked?.value === leases.CONTRACT_TYPES.RENTAL
      ? leases.CONTRACT_TYPES.RENTAL
      : leases.CONTRACT_TYPES.LEASE;
  }

  function setFormContractType(type) {
    const value = type === leases.CONTRACT_TYPES.RENTAL
      ? leases.CONTRACT_TYPES.RENTAL
      : leases.CONTRACT_TYPES.LEASE;
    document.querySelectorAll('input[name="leaseContractType"]').forEach(input => {
      input.checked = input.value === value;
    });
    updateReturnDateVisibility(value);
  }

  function updateReturnDateVisibility(type) {
    if (!returnDateWrapEl) return;
    returnDateWrapEl.hidden = type !== leases.CONTRACT_TYPES.RENTAL;
  }

  function readFormData() {
    const erpMode = readErpMode();
    const contractType = readFormContractType();
    const vehicleCategory = erpMode === 'company_owned' ? 'company_owned' : 'external_lease';
    return {
      contractType,
      vehicleCategory,
      operationType: contractType,
      model: $('leaseModel')?.value || '',
      chassisNumber: $('leaseChassisNumber')?.value || '',
      vehicleNumber: $('leaseVehicleNumber')?.value || '',
      leaseCompany: $('leaseCompany')?.value || '',
      dailyLeaseCost: $('leaseDailyLeaseCost')?.value || '',
      contractStartDate: $('leaseContractStartDate')?.value || '',
      contractEndDate: $('leaseContractEndDate')?.value || '',
      dailyRent: '',
      dailyChargeAmount: '',
      purchasePrice: $('leasePurchasePrice')?.value || '',
      acquisitionTaxRate: $('leaseAcquisitionTaxRate')?.value || '',
      otherAcquisitionCost: $('leaseOtherAcquisitionCost')?.value || '',
      annualInsuranceCost: $('leaseAnnualInsurance')?.value || '',
      vehicleStatus: $('leaseVehicleStatus')?.value || '',
      emptyStartDate: $('leaseEmptyStartDate')?.value || '',
      emptyDailyLoss: $('leaseEmptyDailyLoss')?.value || '',
      memo: $('leaseMemo')?.value || ''
    };
  }

  function resetForm() {
    state.editingId = '';
    if (editIdEl) editIdEl.value = '';
    formEl?.reset();
    setFormContractType(leases.CONTRACT_TYPES.LEASE);
    setErpModeForm(state.erpMode === 'company_owned' ? 'company_owned' : 'company_lease_rental');
    refreshLeaseDateLabels();
    $('leaseFormSubmit').textContent = '등록';
    $('leaseFormCancel')?.setAttribute('hidden', '');
    syncFormCalculations();
  }

  function fillForm(item) {
    state.editingId = item.id;
    if (editIdEl) editIdEl.value = item.id;
    const erpMode = window.BremLeaseProfit?.getErpMode?.(item) === 'company_owned'
      ? 'company_owned'
      : 'company_lease_rental';
    setErpModeForm(erpMode);
    setFormContractType(item.contractType);
    $('leaseModel').value = item.model || '';
    $('leaseChassisNumber').value = item.chassisNumber || '';
    $('leaseVehicleNumber').value = item.vehicleNumber || '';
    if ($('leaseCompany')) $('leaseCompany').value = item.leaseCompany || item.lessor || '';
    if ($('leaseDailyLeaseCost')) $('leaseDailyLeaseCost').value = item.dailyLeaseCost || '';
    $('leaseContractStartDate').value = item.contractStartDate || '';
    $('leaseContractEndDate').value = item.contractEndDate || '';
    const charge = item.dailyChargeAmount || item.dailyRent || '';
    if ($('leaseDailyCharge')) $('leaseDailyCharge').value = charge;
    if ($('leasePurchasePrice')) $('leasePurchasePrice').value = item.purchasePrice || '';
    if ($('leaseAcquisitionTaxRate')) $('leaseAcquisitionTaxRate').value = item.acquisitionTaxRate || '';
    if ($('leaseOtherAcquisitionCost')) $('leaseOtherAcquisitionCost').value = item.otherAcquisitionCost || '';
    if ($('leaseAnnualInsurance')) $('leaseAnnualInsurance').value = item.annualInsuranceCost || '';
    if ($('leaseVehicleStatus')) $('leaseVehicleStatus').value = item.vehicleStatus || 'operating';
    if ($('leaseEmptyStartDate')) $('leaseEmptyStartDate').value = item.emptyStartDate || '';
    if ($('leaseEmptyDailyLoss')) $('leaseEmptyDailyLoss').value = item.emptyDailyLoss || '';
    $('leaseMemo').value = item.memo || '';
    refreshLeaseDateLabels();
    syncFormCalculations();
    $('leaseFormSubmit').textContent = '수정 저장';
    $('leaseFormCancel')?.removeAttribute('hidden');
    formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function filteredItems() {
    const query = state.searchQuery.trim().toLowerCase();
    let items = leases.getAll();
    if (state.filterType === 'empty') {
      items = items.filter(item => leases.isEmptyVehicle(item));
    } else if (state.erpMode === 'company_owned') {
      items = items.filter(item => window.BremLeaseProfit?.getErpMode?.(item) === 'company_owned');
    } else if (state.erpMode === 'company_lease_rental') {
      items = items.filter(item => window.BremLeaseProfit?.getErpMode?.(item) !== 'company_owned');
    }
    if (!query) {
      return items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }
    return items
      .filter(item => {
        const haystack = [
          item.model,
          item.chassisNumber,
          item.vehicleNumber,
          item.leaseCompany,
          item.renter,
          item.lesseePhone,
          item.lessor,
          item.memo
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function renderKpis() {
    renderStats();
    if (!erp || !window.BremLeaseProfit) return;
    const kpis = erp.buildDashboardKpis({
      search: state.searchQuery,
      erpMode: state.filterType === 'empty' ? '' : state.erpMode,
      vehicleStatus: state.filterType === 'empty' ? 'empty' : ''
    });
    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };
    setText('leaseKpiOperating', `${kpis.counts.operating}`);
    setText('leaseKpiMaintenance', `${kpis.counts.maintenance}`);
    setText('leaseKpiAccident', `${kpis.counts.accident}`);
    setText('leaseKpiWeekRevenue', formatMoney(kpis.weekly.rentalRevenue));
    setText('leaseKpiWeekCost', formatMoney(kpis.weekly.leaseCost + kpis.weekly.insuranceCost + kpis.weekly.otherCost));
    setText('leaseKpiWeekProfit', formatMoney(kpis.weekly.actualProfit ?? kpis.weekly.netProfit));
    setText('leaseKpiMonthRevenue', formatMoney(kpis.monthly.rentalRevenue));
    setText('leaseKpiMonthCost', formatMoney(kpis.monthly.leaseCost + kpis.monthly.insuranceCost + kpis.monthly.otherCost));
    setText('leaseKpiMonthProfit', formatMoney(kpis.monthly.actualProfit ?? kpis.monthly.netProfit));
    setText('leaseKpiWeekEmptyLoss', formatMoney(kpis.weekly.emptyLossTotal));
    setText('leaseKpiMonthEmptyLoss', formatMoney(kpis.monthly.emptyLossTotal));
    setText('leaseKpiUnpaid', formatMoney(kpis.totalUnpaid));
  }

  function renderStats() {
    const all = leases.getAll();
    const leaseCount = all.filter(item => item.contractType === leases.CONTRACT_TYPES.LEASE).length;
    const rentalCount = all.filter(item => item.contractType === leases.CONTRACT_TYPES.RENTAL).length;
    const activeRental = all.filter(item => {
      if (item.contractType === leases.CONTRACT_TYPES.RENTAL) return !item.returnDate;
      return leases.hasActiveRentalAssignment(item);
    }).length;
    const emptyCount = leases.getEmptyVehicles().length;

    $('leaseStatTotal').textContent = `${all.length}`;
    $('leaseStatLease').textContent = `${leaseCount}`;
    $('leaseStatRental').textContent = `${rentalCount}`;
    $('leaseStatActiveRental').textContent = `${activeRental}`;
    if ($('leaseStatEmpty')) $('leaseStatEmpty').textContent = `${emptyCount}`;
    if ($('statEmptyLease')) $('statEmptyLease').textContent = `${emptyCount}대`;
  }

  function renderList() {
    const items = filteredItems();
    if (!rowsEl) return;

    renderErpSummary(items);

    if (!items.length) {
      const emptyText = state.searchQuery.trim()
        ? '검색 결과가 없습니다.'
        : state.filterType === 'empty'
          ? '공차 차량이 없습니다.'
          : state.erpMode === 'company_owned'
            ? '등록된 회사소유리스가 없습니다.'
            : state.erpMode === 'company_lease_rental'
              ? '등록된 회사리스가 없습니다.'
              : '등록된 차량이 없습니다.';
      rowsEl.innerHTML = `<tr><td colspan="16" class="empty">${emptyText}</td></tr>`;
      renderKpis();
      updateBulkSelectionUi();
      updateFilterTabUi();
      return;
    }

    rowsEl.innerHTML = items.map(item => {
      const metrics = window.BremLeaseProfit?.computeErpMetrics?.(item) || {};
      const erpLabel = window.BremLeaseProfit?.erpModeLabel?.(metrics.mode) || '-';
      return `
        <tr>
          <td><input type="checkbox" class="lease-row-check" data-lease-select="${item.id}" ${state.selectedIds.has(item.id) ? 'checked' : ''}></td>
          <td>${escapeHtml(erpLabel)}</td>
          <td>${contractTypeBadge(item.contractType, item)}</td>
          <td><strong>${escapeHtml(item.vehicleNumber || '-')}</strong></td>
          <td>${escapeHtml(item.model || '-')}</td>
          <td>${escapeHtml(item.leaseCompany || item.lessor || '-')}</td>
          <td>${formatMoney(metrics.dailyLeaseCost)}</td>
          <td>${formatMoney(metrics.weeklyLeaseCost)}</td>
          <td>${formatMoney(metrics.vehiclePrice || item.purchasePrice)}</td>
          <td>${formatMoney(metrics.dailyCost)}</td>
          <td>${formatMoney(metrics.weeklyCost)}</td>
          <td>${displayVehicleStatus(item)}</td>
          <td>${formatDate(item.contractStartDate)}</td>
          <td>${formatDate(item.contractEndDate)}</td>
          <td>${displayCurrentDriver(item)}</td>
          <td class="lease-actions">
            <button type="button" class="small-btn" data-edit-lease="${item.id}">수정</button>
            <button type="button" class="small-btn" data-contract-lease="${item.id}">계약</button>
            <button type="button" class="small-btn danger-btn" data-delete-lease="${item.id}">삭제</button>
          </td>
        </tr>
      `;
    }).join('');

    renderKpis();
    updateBulkSelectionUi();
    updateFilterTabUi();
  }

  function updateBulkSelectionUi() {
    const visibleIds = filteredItems().map(item => item.id);
    const selectedVisible = visibleIds.filter(id => state.selectedIds.has(id));
    const selectAllEl = $('leaseSelectAll');
    const bulkDeleteEl = $('leaseBulkDelete');

    if (bulkDeleteEl) {
      bulkDeleteEl.disabled = selectedVisible.length === 0;
      bulkDeleteEl.textContent = selectedVisible.length
        ? `선택 삭제 (${selectedVisible.length})`
        : '선택 삭제';
    }

    if (selectAllEl) {
      selectAllEl.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAllEl.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
  }

  function validateRecord(raw, rowNumber) {
    const errors = [];
    const contractType = leases.normalizeContractType(raw.contractType);
    const model = String(raw.model || '').trim();
    const chassisNumber = String(raw.chassisNumber || '').trim();
    const vehicleNumber = String(raw.vehicleNumber || '').trim();

    const data = leases.normalizeRecord({
      contractType,
      model,
      chassisNumber,
      vehicleNumber,
      insuranceCompany: raw.insuranceCompany,
      insuranceAge: raw.insuranceAge,
      insuranceType: raw.insuranceType,
      contractStartDate: raw.contractStartDate,
      contractEndDate: raw.contractEndDate,
      dailyRent: raw.dailyRent,
      weeklyRent: raw.weeklyRent ?? raw.monthlyRent,
      memo: raw.memo,
      renter: raw.renter,
      lessor: raw.lessor,
      returnDate: raw.returnDate
    });

    if (contractType === leases.CONTRACT_TYPES.RENTAL) {
      if (!model) errors.push('리스 기종 누락');
      if (!chassisNumber && !vehicleNumber) errors.push('차대번호 또는 차량번호 필요');
      if (!data.renter) errors.push('렌탈은 렌탈자 필요');
    } else if (!hasRecordContent(raw)) {
      errors.push('입력된 값 없음');
    }

    return { rowNumber, valid: errors.length === 0, errors, data };
  }

  function parseWorkbookRows(workbook) {
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const headerRowIndex = findHeaderRowIndex(rows);
    if (headerRowIndex < 0) return [];

    const columnMap = buildColumnIndexMap(rows[headerRowIndex]);
    const dataRows = [];

    rows.forEach((row, index) => {
      const rowNumber = index + 1;
      if (index <= headerRowIndex) return;
      if (!row || !row.some(cell => String(cell || '').trim())) return;
      if (isHeaderRow(row)) return;

      dataRows.push({
        rowNumber,
        raw: rowToRaw(row, columnMap)
      });
    });

    return dataRows;
  }

  function renderBulkPreview() {
    const validRows = state.parsedRows.filter(row => row.valid);
    const errorRows = state.parsedRows.filter(row => !row.valid);

    if (bulkTotalEl) bulkTotalEl.textContent = String(state.parsedRows.length);
    if (bulkValidEl) bulkValidEl.textContent = String(validRows.length);
    if (bulkErrorEl) bulkErrorEl.textContent = String(errorRows.length);
    if (bulkApplyBtn) bulkApplyBtn.disabled = validRows.length === 0;

    if (!bulkPreviewBodyEl) return;

    bulkPreviewBodyEl.innerHTML = state.parsedRows.map(row => {
      const cls = row.valid ? 'row-ok' : 'row-error';
      const result = row.valid
        ? '<span class="bulk-result-ok">등록 가능</span>'
        : `<span class="bulk-result-err">${escapeHtml(row.errors.join(', '))}</span>`;
      return `
        <tr class="${cls}">
          <td>${row.rowNumber}</td>
          ${BULK_COLUMNS.map(column => `<td>${previewCellValue(column.key, row.data)}</td>`).join('')}
          <td>${result}</td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="${BULK_COLUMNS.length + 2}" class="empty">업로드할 데이터가 없습니다.</td></tr>`;
  }

  function downloadTemplate() {
    const emptyRow = BULK_COLUMNS.map(() => '');
    const sheet = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS, emptyRow]);
    sheet['!cols'] = BULK_COLUMNS.map(column => ({
      wch: Math.max(12, column.label.length + 4)
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '리스관리');
    XLSX.writeFile(workbook, 'BREM_리스관리_양식.xlsx');
  }

  function buildExportRow(item) {
    const metrics = window.BremLeaseProfit?.computeErpMetrics?.(item) || {};
    const paymentLabel = window.BremLeaseProfit?.paymentCheckLabel?.(item.paymentCheck) || '-';
    const statusLabel = window.BremLeaseProfit?.vehicleStatusLabel?.(item.vehicleStatus) || '-';
    if (metrics.mode === 'company_owned') {
      return [
        contractTypeLabel(item.contractType),
        contractTypeLabel(item.contractType),
        metrics.vehiclePrice || item.purchasePrice || '',
        metrics.acquisitionTaxRate || item.acquisitionTaxRate || '',
        metrics.acquisitionTaxAmount || '',
        metrics.otherAcquisitionCost || item.otherAcquisitionCost || '',
        metrics.totalAcquisitionCost || '',
        metrics.dailyCost || '',
        metrics.weeklyCost || '',
        item.vehicleNumber || '',
        item.contractStartDate || '',
        item.contractEndDate || '',
        item.renter || '',
        metrics.dailyCharge || '',
        metrics.marginDaily || '',
        metrics.weeklyProfit || '',
        metrics.unpaidDays || '',
        metrics.unpaidAmount || '',
        paymentLabel,
        item.unpaidCollectionMethod || '',
        metrics.actualProfit || '',
        metrics.emptyDays || '',
        metrics.emptyLoss || '',
        statusLabel
      ];
    }
    return [
      contractTypeLabel(item.contractType),
      item.leaseCompany || item.lessor || '',
      metrics.dailyLeaseCost || '',
      metrics.weeklyLeaseCost || '',
      item.vehicleNumber || '',
      item.contractStartDate || '',
      item.contractEndDate || '',
      item.renter || '',
      metrics.dailyCharge || '',
      metrics.weeklyCharge || '',
      metrics.marginDaily || '',
      metrics.weeklyProfit || '',
      metrics.unpaidDays || '',
      metrics.unpaidAmount || '',
      paymentLabel,
      item.unpaidCollectionMethod || '',
      metrics.actualProfit || '',
      metrics.emptyDays || '',
      metrics.emptyLoss || '',
      statusLabel
    ];
  }

  function exportList() {
    const items = filteredItems();
    const owned = items.filter(item => window.BremLeaseProfit?.getErpMode?.(item) === 'company_owned');
    const leaseRental = items.filter(item => window.BremLeaseProfit?.getErpMode?.(item) !== 'company_owned');
    const workbook = XLSX.utils.book_new();
    if (leaseRental.length) {
      const sheet = XLSX.utils.aoa_to_sheet([
        LEASE_RENTAL_EXPORT_HEADERS,
        ...leaseRental.map(buildExportRow)
      ]);
      XLSX.utils.book_append_sheet(workbook, sheet, '회사리스');
    }
    if (owned.length) {
      const sheet = XLSX.utils.aoa_to_sheet([
        COMPANY_OWNED_EXPORT_HEADERS,
        ...owned.map(buildExportRow)
      ]);
      XLSX.utils.book_append_sheet(workbook, sheet, '회사소유리스');
    }
    if (!leaseRental.length && !owned.length) {
      showToast('다운로드할 차량이 없습니다.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `BREM_리스ERP_${stamp}.xlsx`);
  }

  function exportLeaseVehicles() {
    exportList();
  }

  function openRentalModal(item) {
    const modal = $('leaseRentalModal');
    if (!modal || !item) return;
    $('leaseRentalParentId').value = item.id;
    $('leaseRentalModalVehicle').textContent = [
      item.model || '차종 미입력',
      item.vehicleNumber || item.chassisNumber || '번호 미입력',
      effectiveWeeklyRent(item) ? `리스 ${number(effectiveWeeklyRent(item))}원/주` : ''
    ].filter(Boolean).join(' · ');
    const assignment = item.rentalAssignment || {};
    $('leaseRentalRenter').value = assignment.renter || '';
    $('leaseRentalDailyRent').value = assignment.dailyRent || '';
    syncWeeklyRentPreview('leaseRentalDailyRent', 'leaseRentalWeeklyRent');
    $('leaseRentalMemo').value = assignment.memo || '';
    $('leaseRentalStartDate').value = assignment.startDate || '';
    $('leaseRentalReturnDate').value = assignment.returnDate || '';
    refreshLeaseDateLabels();
    const clearBtn = $('leaseRentalClearBtn');
    if (clearBtn) {
      if (assignment.renter) clearBtn.removeAttribute('hidden');
      else clearBtn.setAttribute('hidden', '');
    }
    modal.removeAttribute('hidden');
  }

  function closeRentalModal() {
    $('leaseRentalModal')?.setAttribute('hidden', '');
    $('leaseRentalForm')?.reset();
    $('leaseRentalParentId').value = '';
    refreshLeaseDateLabels();
    syncWeeklyRentPreview('leaseRentalDailyRent', 'leaseRentalWeeklyRent');
  }

  function readRentalFormData() {
    return {
      renter: $('leaseRentalRenter')?.value || '',
      startDate: $('leaseRentalStartDate')?.value || '',
      dailyRent: $('leaseRentalDailyRent')?.value || '',
      returnDate: $('leaseRentalReturnDate')?.value || '',
      memo: $('leaseRentalMemo')?.value || ''
    };
  }

  async function refresh(options = {}) {
    if (options.loadRemote !== false && erp) await erp.ensureLoaded();
    if (options.filter) state.filterType = options.filter;
    if (window.BremLeaseErpPanels?.refresh) window.BremLeaseErpPanels.refresh();
    if (window.BremAdminLeaseMenus?.refresh) window.BremAdminLeaseMenus.refresh();
    renderList();
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    document.querySelectorAll('[data-lease-erp-mode]').forEach(button => {
      button.addEventListener('click', () => {
        state.erpMode = button.dataset.leaseErpMode;
        state.filterType = 'all';
        state.selectedIds.clear();
        setErpModeForm(state.erpMode === 'company_owned' ? 'company_owned' : 'company_lease_rental');
        renderList();
      });
    });

    document.querySelectorAll('[data-lease-filter]').forEach(button => {
      button.addEventListener('click', () => {
        state.filterType = button.dataset.leaseFilter;
        state.selectedIds.clear();
        renderList();
      });
    });

    $('leaseSearch')?.addEventListener('input', event => {
      state.searchQuery = event.target.value;
      renderList();
    });

    $('leaseSearchClear')?.addEventListener('click', () => {
      state.searchQuery = '';
      if ($('leaseSearch')) $('leaseSearch').value = '';
      renderList();
    });

    document.querySelectorAll('input[name="leaseContractType"], input[name="leaseErpMode"]').forEach(input => {
      input.addEventListener('change', () => {
        if (input.name === 'leaseErpMode') setErpModeForm(readErpMode());
        syncFormCalculations();
      });
    });

    [
      'leaseDailyLeaseCost', 'leasePurchasePrice', 'leaseAcquisitionTaxRate',
      'leaseOtherAcquisitionCost', 'leaseAnnualInsurance', 'leaseVehicleStatus',
      'leaseEmptyStartDate', 'leaseEmptyDailyLoss'
    ].forEach(id => {
      $(id)?.addEventListener('input', syncFormCalculations);
      $(id)?.addEventListener('change', () => {
        syncFormCalculations();
        if (id === 'leaseVehicleStatus') updateEmptyFieldVisibility();
      });
    });

    formEl?.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        if (erp) await erp.ensureLoaded();
        const data = leases.normalizeRecord(readFormData());
        const formError = validateLeaseForm(data);
        if (formError) {
          showToast(formError);
          return;
        }

        if (state.editingId) {
          leases.update(state.editingId, data);
          if (!(await persistLeasesOrWarn())) return;
          showToast('차량 정보가 수정되었습니다.');
        } else {
          leases.create(data);
          if (!(await persistLeasesOrWarn())) return;
          showToast('차량이 등록되었습니다.');
        }

        resetForm();
        renderList();
        renderStats();
        window.BremAdminLeaseMenus?.renderDashboard?.();
        void refresh({ loadRemote: false });
      } catch (error) {
        console.error('[BREM] lease vehicle save failed:', error);
        showToast('저장 중 오류가 발생했습니다. 새로고침 후 다시 시도하세요.');
      }
    });

    $('leaseFormCancel')?.addEventListener('click', resetForm);

    $('leaseTemplateBtn')?.addEventListener('click', downloadTemplate);
    $('leaseExportBtn')?.addEventListener('click', exportList);
    $('leaseLeaseExportBtn')?.addEventListener('click', exportLeaseVehicles);

    $('leaseRentalForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const leaseId = $('leaseRentalParentId')?.value || '';
      const item = leases.getById(leaseId);
      if (!item) {
        showToast('리스차를 찾을 수 없습니다.');
        return;
      }
      const data = readRentalFormData();
      if (!String(data.renter || '').trim()) {
        showToast('렌탈자를 입력하세요.');
        return;
      }
      leases.assignRental(leaseId, data);
      if (!(await persistLeasesOrWarn())) return;
      closeRentalModal();
      showToast('리스차 렌탈 정보가 저장되었습니다.');
      refresh();
    });

    $('leaseRentalClearBtn')?.addEventListener('click', async () => {
      const leaseId = $('leaseRentalParentId')?.value || '';
      if (!leaseId) return;
      if (!window.confirm('이 리스차의 렌탈 배정을 해제할까요?')) return;
      leases.clearRentalAssignment(leaseId);
      if (!(await persistLeasesOrWarn())) return;
      closeRentalModal();
      showToast('렌탈 배정이 해제되었습니다.');
      refresh();
    });

    document.querySelectorAll('[data-close-lease-rental]').forEach(el => {
      el.addEventListener('click', closeRentalModal);
    });

    $('leaseBulkFile')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
        const rows = parseWorkbookRows(workbook);
        if (!rows.length) {
          showToast('엑셀 양식 헤더를 찾을 수 없습니다. 양식을 그대로 사용해 주세요.');
          state.parsedRows = [];
          renderBulkPreview();
          return;
        }
        state.parsedRows = rows.map(({ rowNumber, raw }) => validateRecord(raw, rowNumber));
        renderBulkPreview();
      } catch (error) {
        showToast('엑셀 파일을 읽을 수 없습니다.');
      } finally {
        event.target.value = '';
      }
    });

    bulkApplyBtn?.addEventListener('click', async () => {
      const validRows = state.parsedRows.filter(row => row.valid);
      if (!validRows.length) return;
      leases.upsertMany(validRows.map(row => row.data));
      if (!(await persistLeasesOrWarn())) return;
      state.parsedRows = [];
      renderBulkPreview();
      showToast(`${validRows.length}건 일괄 등록되었습니다.`);
      refresh();
    });

    $('leaseSelectAll')?.addEventListener('change', event => {
      const visibleIds = filteredItems().map(item => item.id);
      if (event.target.checked) {
        visibleIds.forEach(id => state.selectedIds.add(id));
      } else {
        visibleIds.forEach(id => state.selectedIds.delete(id));
      }
      renderList();
    });

    $('leaseBulkDelete')?.addEventListener('click', async () => {
      const ids = filteredItems().map(item => item.id).filter(id => state.selectedIds.has(id));
      if (!ids.length) return;
      if (!window.confirm(`선택한 ${ids.length}건을 삭제할까요?`)) return;
      leases.removeByIds(ids);
      if (!(await persistLeasesOrWarn())) return;
      ids.forEach(id => state.selectedIds.delete(id));
      showToast('선택 항목이 삭제되었습니다.');
      refresh();
    });

    document.addEventListener('click', event => {
      const rentalBtn = event.target.closest('[data-lease-rental]');
      if (rentalBtn) {
        const item = leases.getById(rentalBtn.dataset.leaseRental);
        if (item) openRentalModal(item);
        return;
      }

      const contractBtn = event.target.closest('[data-contract-lease]');
      if (contractBtn) {
        const item = leases.getById(contractBtn.dataset.contractLease);
        if (item && window.BremAdminLeaseMenus?.openContractForVehicle) {
          window.BremAdminLeaseMenus.openContractForVehicle(item.id);
        }
        return;
      }

      const editBtn = event.target.closest('[data-edit-lease]');
      if (editBtn) {
        const item = leases.getById(editBtn.dataset.editLease);
        if (item) fillForm(item);
        return;
      }

      const deleteBtn = event.target.closest('[data-delete-lease]');
      if (deleteBtn) {
        if (!window.confirm('이 항목을 삭제할까요?')) return;
        void (async () => {
          leases.removeById(deleteBtn.dataset.deleteLease);
          if (!(await persistLeasesOrWarn())) {
            refresh();
            return;
          }
          state.selectedIds.delete(deleteBtn.dataset.deleteLease);
          if (state.editingId === deleteBtn.dataset.deleteLease) resetForm();
          showToast('삭제되었습니다.');
          refresh();
        })();
        return;
      }

      const selectBox = event.target.closest('[data-lease-select]');
      if (selectBox) {
        const id = selectBox.dataset.leaseSelect;
        if (selectBox.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateBulkSelectionUi();
      }
    });
  }

  bindEvents();
  renderBulkGuideTable();
  renderBulkPreviewHead();
  renderBulkPreview();
  setErpModeForm('company_lease_rental');
  refreshLeaseDateLabels();
  syncFormCalculations();
  window.BremAdminLease = { refresh, fillForm };
})();

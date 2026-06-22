(function () {
  const leases = BremStorage.leases;
  if (!leases) return;

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
      await leases.persist();
      return true;
    } catch (error) {
      console.error('[BREM] lease persist failed:', error);
      showToast('저장에 실패했습니다. 새로고침 후 다시 시도하세요.');
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
      'leaseReturnDate',
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
    document.querySelectorAll('[data-lease-filter]').forEach(button => {
      const active = button.dataset.leaseFilter === state.filterType;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const statusEl = $('leaseFilterStatus');
    if (!statusEl) return;

    if (state.filterType === 'lease') {
      statusEl.textContent = '리스만 표시 중';
      statusEl.className = 'lease-filter-status lease-filter-status--lease';
    } else if (state.filterType === 'rental') {
      statusEl.textContent = '렌탈만 표시 중';
      statusEl.className = 'lease-filter-status lease-filter-status--rental';
    } else if (state.filterType === 'empty') {
      statusEl.textContent = '공차(계약기간 남음·미배정)만 표시 중';
      statusEl.className = 'lease-filter-status lease-filter-status--empty';
    } else {
      statusEl.textContent = '전체 목록 표시 중';
      statusEl.className = 'lease-filter-status';
    }
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
    if (data.contractType === leases.CONTRACT_TYPES.RENTAL) {
      if (!String(data.model || '').trim()) return '리스 기종을 입력하세요.';
      if (!String(data.chassisNumber || '').trim() && !String(data.vehicleNumber || '').trim()) {
        return '차대번호 또는 차량번호를 입력하세요.';
      }
      if (!String(data.renter || '').trim()) return '렌탈은 렌탈자를 입력하세요.';
      return '';
    }

    if (!hasRecordContent(data)) return '리스는 한 칸 이상 입력해 주세요.';
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
    return {
      contractType: readFormContractType(),
      model: $('leaseModel')?.value || '',
      chassisNumber: $('leaseChassisNumber')?.value || '',
      vehicleNumber: $('leaseVehicleNumber')?.value || '',
      insuranceCompany: $('leaseInsuranceCompany')?.value || '',
      insuranceAge: $('leaseInsuranceAge')?.value || '',
      insuranceType: $('leaseInsuranceType')?.value || '',
      contractStartDate: $('leaseContractStartDate')?.value || '',
      contractEndDate: $('leaseContractEndDate')?.value || '',
      dailyRent: $('leaseDailyRent')?.value || '',
      memo: $('leaseMemo')?.value || '',
      renter: $('leaseRenter')?.value || '',
      lessor: $('leaseLessor')?.value || '',
      returnDate: $('leaseReturnDate')?.value || ''
    };
  }

  function resetForm() {
    state.editingId = '';
    if (editIdEl) editIdEl.value = '';
    formEl?.reset();
    setFormContractType(leases.CONTRACT_TYPES.LEASE);
    refreshLeaseDateLabels();
    syncWeeklyRentPreview('leaseDailyRent', 'leaseWeeklyRent');
    $('leaseFormSubmit').textContent = '등록';
    $('leaseFormCancel')?.setAttribute('hidden', '');
  }

  function fillForm(item) {
    state.editingId = item.id;
    if (editIdEl) editIdEl.value = item.id;
    setFormContractType(item.contractType);
    $('leaseModel').value = item.model || '';
    $('leaseChassisNumber').value = item.chassisNumber || '';
    $('leaseVehicleNumber').value = item.vehicleNumber || '';
    $('leaseInsuranceCompany').value = item.insuranceCompany || '';
    $('leaseInsuranceAge').value = item.insuranceAge || '';
    $('leaseInsuranceType').value = item.insuranceType || '';
    $('leaseContractStartDate').value = item.contractStartDate || '';
    $('leaseContractEndDate').value = item.contractEndDate || '';
    $('leaseDailyRent').value = item.dailyRent || '';
    syncWeeklyRentPreview('leaseDailyRent', 'leaseWeeklyRent');
    $('leaseMemo').value = item.memo || '';
    $('leaseRenter').value = item.renter || '';
    $('leaseLessor').value = item.lessor || '';
    $('leaseReturnDate').value = item.returnDate || '';
    refreshLeaseDateLabels();
    $('leaseFormSubmit').textContent = '수정 저장';
    $('leaseFormCancel')?.removeAttribute('hidden');
    formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function filteredItems() {
    const query = state.searchQuery.trim().toLowerCase();
    return leases.getAll()
      .filter(item => {
        if (state.filterType === 'empty') {
          if (!leases.isEmptyVehicle(item)) return false;
        } else if (state.filterType !== 'all' && item.contractType !== state.filterType) {
          return false;
        }
        if (!query) return true;
        const haystack = [
          item.model,
          item.chassisNumber,
          item.vehicleNumber,
          item.insuranceCompany,
          item.renter,
          item.lessor,
          item.memo
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        const totalA = effectiveWeeklyRent(a) + Number(a.dailyRent || 0);
        const totalB = effectiveWeeklyRent(b) + Number(b.dailyRent || 0);
        if (totalB !== totalA) return totalB - totalA;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
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

    $('leaseStatTotal').textContent = `${all.length}건`;
    $('leaseStatLease').textContent = `${leaseCount}건`;
    $('leaseStatRental').textContent = `${rentalCount}건`;
    $('leaseStatActiveRental').textContent = `${activeRental}건`;
    if ($('leaseStatEmpty')) $('leaseStatEmpty').textContent = `${emptyCount}대`;
    if ($('statEmptyLease')) $('statEmptyLease').textContent = `${emptyCount}대`;
  }

  function renderList() {
    const items = filteredItems();
    const showReturnCol = state.filterType !== 'lease';

    document.querySelectorAll('[data-lease-return-col]').forEach(el => {
      el.hidden = state.filterType === 'lease';
    });

    if (!rowsEl) return;

    if (!items.length) {
      const emptyText = state.searchQuery.trim()
        ? '검색 결과가 없습니다.'
        : state.filterType === 'lease'
          ? '등록된 리스가 없습니다.'
          : state.filterType === 'rental'
            ? '등록된 렌탈이 없습니다.'
            : state.filterType === 'empty'
              ? '공차(계약기간 남음·리스자·렌탈자 미배정) 차량이 없습니다.'
              : '등록된 리스·렌탈이 없습니다.';
      rowsEl.innerHTML = `<tr><td colspan="17" class="empty">${emptyText}</td></tr>`;
      renderStats();
      updateBulkSelectionUi();
      updateFilterTabUi();
      return;
    }

    rowsEl.innerHTML = items.map(item => {
      const isRental = item.contractType === leases.CONTRACT_TYPES.RENTAL;
      const isLease = item.contractType === leases.CONTRACT_TYPES.LEASE;
      const returnCell = isRental
        ? (item.returnDate
          ? `<span class="lease-return-date">${formatDate(item.returnDate)}</span>`
          : '<span class="lease-return-pending">미반납</span>')
        : (rentalAssignmentSummary(item)
          ? (item.rentalAssignment.returnDate
            ? `<span class="lease-return-date">${formatDate(item.rentalAssignment.returnDate)}</span>`
            : '<span class="lease-sub-rental-pending">렌탈 중</span>')
          : '-');
      const rentalBtn = isLease
        ? `<button type="button" class="small-btn lease-rental-btn" data-lease-rental="${item.id}">${rentalAssignmentSummary(item) ? '렌탈 수정' : '렌탈 등록'}</button>`
        : '';
      return `
        <tr>
          <td><input type="checkbox" class="lease-row-check" data-lease-select="${item.id}" ${state.selectedIds.has(item.id) ? 'checked' : ''}></td>
          <td>${contractTypeBadge(item.contractType, item)}</td>
          <td>${escapeHtml(item.model || '-')}</td>
          <td>${escapeHtml(item.chassisNumber || '-')}</td>
          <td><strong>${escapeHtml(item.vehicleNumber || '-')}</strong></td>
          <td>${escapeHtml(item.insuranceCompany || '-')}</td>
          <td>${escapeHtml(item.insuranceAge || '-')}</td>
          <td>${escapeHtml(item.insuranceType || '-')}</td>
          <td>${formatDate(item.contractStartDate)}</td>
          <td>${formatDate(item.contractEndDate)}</td>
          <td>${formatMoney(item.dailyRent)}</td>
          <td>${displayWeeklyRent(item)}</td>
          <td class="lease-memo-cell">${escapeHtml(item.memo || '-')}</td>
          <td>${displayRenter(item)}</td>
          <td>${escapeHtml(item.lessor || '-')}</td>
          <td data-lease-return-col ${showReturnCol ? '' : 'hidden'}>${returnCell}</td>
          <td class="lease-actions">
            ${rentalBtn}
            <button type="button" class="small-btn" data-edit-lease="${item.id}">수정</button>
            <button type="button" class="small-btn danger-btn" data-delete-lease="${item.id}">삭제</button>
          </td>
        </tr>
      `;
    }).join('');

    renderStats();
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

  function exportList() {
    const items = filteredItems();
    const rows = items.map(item => [
      contractTypeLabel(item.contractType),
      item.model,
      item.chassisNumber,
      item.vehicleNumber,
      item.insuranceCompany,
      item.insuranceAge,
      item.insuranceType,
      item.contractStartDate,
      item.contractEndDate,
      item.dailyRent || '',
      effectiveWeeklyRent(item) || '',
      item.memo,
      item.renter,
      item.lessor,
      item.returnDate
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([EXCEL_HEADERS, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '리스관리');
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = state.filterType === 'empty' ? '_공차' : '';
    XLSX.writeFile(workbook, `BREM_리스관리${suffix}_${stamp}.xlsx`);
  }

  function buildExportRow(item) {
    const assignment = item.rentalAssignment || {};
    return [
      contractTypeLabel(item.contractType),
      item.model,
      item.chassisNumber,
      item.vehicleNumber,
      item.insuranceCompany,
      item.insuranceAge,
      item.insuranceType,
      item.contractStartDate,
      item.contractEndDate,
      item.dailyRent || '',
      effectiveWeeklyRent(item) || '',
      item.memo,
      item.renter,
      item.lessor,
      item.returnDate,
      assignment.renter || '',
      assignment.startDate || '',
      assignment.dailyRent || '',
      effectiveWeeklyRent(assignment) || '',
      assignment.returnDate || '',
      assignment.memo || '',
      leases.isEmptyVehicle(item) ? '공차' : ''
    ];
  }

  function exportLeaseVehicles() {
    const items = leases.getAll()
      .filter(item => item.contractType === leases.CONTRACT_TYPES.LEASE)
      .sort((a, b) => String(a.vehicleNumber || '').localeCompare(String(b.vehicleNumber || ''), 'ko'));
    if (!items.length) {
      showToast('다운로드할 리스차가 없습니다.');
      return;
    }
    const rows = items.map(item => buildExportRow(item));
    const sheet = XLSX.utils.aoa_to_sheet([LEASE_EXPORT_HEADERS, ...rows]);
    sheet['!cols'] = LEASE_EXPORT_HEADERS.map(label => ({ wch: Math.max(12, label.length + 2) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '리스차');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `BREM_리스차_${stamp}.xlsx`);
    showToast(`리스차 ${items.length}대 엑셀 다운로드`);
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

  function refresh(options = {}) {
    if (options.filter) state.filterType = options.filter;
    renderList();
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

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

    document.querySelectorAll('input[name="leaseContractType"]').forEach(input => {
      input.addEventListener('change', () => updateReturnDateVisibility(readFormContractType()));
    });

    $('leaseDailyRent')?.addEventListener('input', () => {
      syncWeeklyRentPreview('leaseDailyRent', 'leaseWeeklyRent');
    });

    $('leaseRentalDailyRent')?.addEventListener('input', () => {
      syncWeeklyRentPreview('leaseRentalDailyRent', 'leaseRentalWeeklyRent');
    });

    formEl?.addEventListener('submit', async event => {
      event.preventDefault();
      const data = readFormData();
      const formError = validateLeaseForm(data);
      if (formError) {
        showToast(formError);
        return;
      }

      if (state.editingId) {
        leases.update(state.editingId, data);
        if (!(await persistLeasesOrWarn())) return;
        showToast('리스·렌탈 정보가 수정되었습니다.');
      } else {
        leases.create(data);
        if (!(await persistLeasesOrWarn())) return;
        showToast('리스·렌탈 정보가 등록되었습니다.');
      }
      resetForm();
      refresh();
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
  refreshLeaseDateLabels();
  syncWeeklyRentPreview('leaseDailyRent', 'leaseWeeklyRent');
  window.BremAdminLease = { refresh };
})();

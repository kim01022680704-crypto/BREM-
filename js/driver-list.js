(async function () {
  const {
    makeDriverLoginId,
    formatDate,
    formatResidentNumber,
    escapeHtml,
    statusClass,
    renderPlatformBadges,
    updateDriverTotal,
    showToast,
    DRIVER_SENSITIVE_FIELDS,
    isDriverFieldHidden
  } = window.BremDriverUtils;

  const searchInput = document.getElementById('searchInput');
  const statusFilter = document.getElementById('statusFilter');
  const exportExcelBtn = document.getElementById('exportExcelBtn');
  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  const bulkDeleteBtnBar = document.getElementById('bulkDeleteBtnBar');
  const selectAllInput = document.getElementById('selectAllDrivers');
  const selectionBar = document.getElementById('listSelectionBar');
  const selectedCountLabel = document.getElementById('selectedCountLabel');
  const tableBody = document.getElementById('driverTableBody');
  const mobileList = document.getElementById('mobileDriverList');
  const emptyState = document.getElementById('emptyState');
  const driverTotal = document.getElementById('driverTotal');
  const toast = document.getElementById('toast');

  if (!tableBody) return;

  async function ensureAdminAccess() {
    const result = await BremStorage.auth.ensureAppAccess?.({ requireHydrated: true });
    if (!result?.ok) {
      window.location.replace('admin.html');
      return false;
    }
    const status = BremStorage.getStorageStatus?.() || {};
    if (status.mode === 'production' && !status.supabaseHydrated) {
      window.location.replace('admin.html');
      return false;
    }
    return true;
  }

  if (!(await ensureAdminAccess())) return;

  await BremStorage.waitForSupabaseReady?.();
  await BremStorage.resumeSupabaseAfterAuth?.();
  await BremStorage.reloadDrivers?.(true);

  const selectedIds = new Set();

  function getFilteredDrivers() {
    const keyword = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;

    return BremStorage.drivers.getAll().filter(driver => {
      const matchesName = driver.name.toLowerCase().includes(keyword);
      const matchesStatus = status === '전체' || driver.status === status;
      return matchesName && matchesStatus;
    });
  }

  function updateSelectionUi() {
    const count = selectedIds.size;
    const disabled = count === 0;

    if (bulkDeleteBtn) bulkDeleteBtn.disabled = disabled;
    if (bulkDeleteBtnBar) bulkDeleteBtnBar.disabled = disabled;
    if (selectionBar) selectionBar.hidden = disabled;
    if (selectedCountLabel) selectedCountLabel.textContent = `${count}명 선택`;

    if (!selectAllInput) return;

    const visibleIds = getFilteredDrivers().map(driver => driver.id);
    if (!visibleIds.length) {
      selectAllInput.checked = false;
      selectAllInput.indeterminate = false;
      return;
    }

    const selectedVisible = visibleIds.filter(id => selectedIds.has(id)).length;
    selectAllInput.checked = selectedVisible === visibleIds.length;
    selectAllInput.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
  }

  function renderCheckbox(id) {
    const checked = selectedIds.has(id) ? 'checked' : '';
    return `<input type="checkbox" class="driver-select-check" data-select-id="${escapeHtml(id)}" aria-label="기사 선택" ${checked}>`;
  }

  function renderPrivacyControls(driver, compact) {
    return `<div class="privacy-controls">${DRIVER_SENSITIVE_FIELDS.map(field => {
      const hidden = isDriverFieldHidden(driver, field.key);
      const label = compact
        ? (hidden ? field.listUnhideLabel : field.listHideLabel)
        : (hidden ? field.unhideLabel : field.hideLabel);
      return `<button type="button" class="btn small ghost privacy-toggle ${hidden ? 'field-hide-btn--active' : ''}" data-action="toggle-field-hidden" data-field="${escapeHtml(field.key)}" data-id="${escapeHtml(driver.id)}">${escapeHtml(label)}</button>`;
    }).join('')}</div>`;
  }

  function renderPrivacySummary(driver) {
    const hiddenLabels = DRIVER_SENSITIVE_FIELDS
      .filter(field => isDriverFieldHidden(driver, field.key))
      .map(field => field.listHideLabel.replace(' 가리기', ''));
    if (!hiddenLabels.length) return '<span class="privacy-summary privacy-summary--none">-</span>';
    return `<span class="privacy-summary">${hiddenLabels.map(label => `<span class="privacy-badge">${escapeHtml(label)} 가림</span>`).join('')}</span>`;
  }

  function render() {
    const drivers = getFilteredDrivers();
    const allIds = new Set(BremStorage.drivers.getAll().map(driver => driver.id));
    selectedIds.forEach(id => {
      if (!allIds.has(id)) selectedIds.delete(id);
    });

    updateDriverTotal(driverTotal);
    emptyState.classList.toggle('show', drivers.length === 0);

    tableBody.innerHTML = drivers.map(driver => `
      <tr class="${selectedIds.has(driver.id) ? 'row-selected' : ''}">
        <td class="col-select">${renderCheckbox(driver.id)}</td>
        <td class="col-name"><strong>${escapeHtml(driver.name)}</strong></td>
        <td class="col-phone">${escapeHtml(driver.phone)}</td>
        <td class="col-login"><strong>${escapeHtml(makeDriverLoginId(driver))}</strong></td>
        <td class="col-baemin">${escapeHtml(driver.baeminId) || '-'}</td>
        <td class="col-platform"><div class="platform-tags">${renderPlatformBadges(driver)}</div></td>
        <td class="col-event">${escapeHtml(driver.longEventItem) || '-'}</td>
        <td class="col-date">${formatDate(driver.longEventStartDate)}</td>
        <td class="col-date">${formatDate(driver.joinDate)}</td>
        <td class="col-status"><span class="badge ${statusClass(driver.status)}">${driver.status}</span></td>
        <td class="memo-cell" title="${escapeHtml(driver.memo)}">${escapeHtml(driver.memo) || '-'}</td>
        <td class="col-privacy">
          ${renderPrivacySummary(driver)}
          ${renderPrivacyControls(driver, true)}
        </td>
        <td class="col-actions">
          <div class="actions">
            <button type="button" class="btn small edit" data-action="edit" data-id="${driver.id}">수정</button>
            <button type="button" class="btn small ghost" data-action="reset-password" data-id="${driver.id}">비밀번호 초기화</button>
            <button type="button" class="btn small delete" data-action="delete" data-id="${driver.id}">삭제</button>
          </div>
        </td>
      </tr>
    `).join('');

    mobileList.innerHTML = drivers.map(driver => `
      <article class="driver-card ${selectedIds.has(driver.id) ? 'driver-card--selected' : ''}">
        <div class="driver-card-select">
          <label>
            <span class="sr-only">${escapeHtml(driver.name)} 선택</span>
            ${renderCheckbox(driver.id)}
          </label>
        </div>
        <div class="driver-card-header">
          <h3>${escapeHtml(driver.name)}</h3>
          <span class="badge ${statusClass(driver.status)}">${driver.status}</span>
        </div>
        <dl>
          <dt>연락처</dt>
          <dd>${escapeHtml(driver.phone)}</dd>
          <dt>로그인 아이디</dt>
          <dd><strong>${escapeHtml(makeDriverLoginId(driver))}</strong></dd>
          <dt>배민 아이디</dt>
          <dd>${escapeHtml(driver.baeminId) || '-'}</dd>
          <dt>플랫폼</dt>
          <dd><div class="platform-tags">${renderPlatformBadges(driver)}</div></dd>
          <dt>이벤트 아이템</dt>
          <dd>${escapeHtml(driver.longEventItem) || '-'}</dd>
          <dt>이벤트 시작일</dt>
          <dd>${formatDate(driver.longEventStartDate)}</dd>
          <dt>가입일</dt>
          <dd>${formatDate(driver.joinDate)}</dd>
          <dt>메모</dt>
          <dd>${escapeHtml(driver.memo) || '-'}</dd>
          <dt>민감정보</dt>
          <dd>${renderPrivacySummary(driver)}${renderPrivacyControls(driver, true)}</dd>
        </dl>
        <div class="actions">
          <button type="button" class="btn small edit" data-action="edit" data-id="${driver.id}">수정</button>
          <button type="button" class="btn small ghost" data-action="reset-password" data-id="${driver.id}">비밀번호 초기화</button>
          <button type="button" class="btn small delete" data-action="delete" data-id="${driver.id}">삭제</button>
        </div>
      </article>
    `).join('');

    updateSelectionUi();
  }

  function exportDriversToExcel() {
    if (!window.XLSX) {
      showToast(toast, '엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }

    const drivers = BremStorage.drivers.getAll();
    if (!drivers.length) {
      showToast(toast, '백업할 기사가 없습니다.');
      return;
    }

    const header = ['이름', '전화번호', '주민번호', '은행명', '예금주', '계좌번호', '배민아이디'];
    const rows = drivers.map(driver => {
      const hidden = driver.hiddenFields || {};
      return [
        driver.name || '',
        driver.phone || '',
        hidden.residentNumber ? '가려짐' : formatResidentNumber(driver.residentNumber || ''),
        driver.bankName || '',
        driver.accountHolder || '',
        hidden.accountNumber ? '가려짐' : (driver.accountNumber || ''),
        driver.baeminId || ''
      ];
    });

    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    sheet['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 14 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기사목록');

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `BREM_기사목록_백업_${stamp}.xlsx`);
    showToast(toast, `${drivers.length}명 엑셀 백업 완료`);
  }

  function deleteDriver(id) {
    const driver = BremStorage.drivers.getById(id);
    if (!driver) return;
    if (!window.confirm(`${driver.name} 기사를 삭제하시겠습니까?`)) return;
    BremStorage.drivers.remove(id).then(() => {
      selectedIds.delete(id);
      render();
      showToast(toast, '기사가 삭제되었습니다.');
    }).catch(error => {
      showToast(toast, error.message || '기사 삭제에 실패했습니다.');
    });
  }

  function deleteSelected() {
    if (!selectedIds.size) {
      showToast(toast, '삭제할 기사를 선택해주세요.');
      return;
    }

    const count = selectedIds.size;
    if (!window.confirm(`선택한 ${count}명의 기사를 삭제하시겠습니까?`)) return;

    Promise.all([...selectedIds].map(id => BremStorage.drivers.remove(id))).then(() => {
      selectedIds.clear();
      render();
      showToast(toast, `${count}명 삭제되었습니다.`);
    }).catch(error => {
      showToast(toast, error.message || '기사 삭제에 실패했습니다.');
    });
  }

  function toggleDriverSelection(id, checked) {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateSelectionUi();

    const row = tableBody.querySelector(`tr:has([data-select-id="${id}"])`);
    if (row) row.classList.toggle('row-selected', checked);

    const card = mobileList.querySelector(`.driver-card:has([data-select-id="${id}"])`);
    if (card) card.classList.toggle('driver-card--selected', checked);
  }

  function handleSelectAll(event) {
    const checked = event.target.checked;
    getFilteredDrivers().forEach(driver => {
      if (checked) selectedIds.add(driver.id);
      else selectedIds.delete(driver.id);
    });
    render();
  }

  function handleSelectionChange(event) {
    const checkbox = event.target.closest('input[data-select-id]');
    if (!checkbox) return;
    toggleDriverSelection(checkbox.dataset.selectId, checkbox.checked);
  }

  function toggleFieldHidden(id, fieldKey) {
    const driver = BremStorage.drivers.getById(id);
    if (!driver) return;

    const field = DRIVER_SENSITIVE_FIELDS.find(item => item.key === fieldKey);
    if (!field) return;

    const currentlyHidden = isDriverFieldHidden(driver, fieldKey);
    if (!currentlyHidden) {
      if (!window.confirm(`${driver.name} · ${field.label}을(를) 가리시겠습니까?`)) return;
      BremStorage.drivers.setFieldHidden(id, fieldKey, true);
      showToast(toast, `${driver.name} · ${field.label}을(를) 가렸습니다.`);
    } else {
      if (!window.confirm(`${driver.name} · ${field.label} 가리기를 해제하시겠습니까?`)) return;
      BremStorage.drivers.setFieldHidden(id, fieldKey, false);
      showToast(toast, `${driver.name} · ${field.label} 가리기를 해제했습니다.`);
    }
    render();
  }

  function resetDriverPassword(id) {
    const driver = BremStorage.drivers.getById(id);
    if (!driver) return;
    if (!window.confirm(`${driver.name} 기사의 로그인 비밀번호를 1234로 초기화할까요?`)) return;
    BremStorage.drivers.resetPassword(id);
    showToast(toast, `${driver.name} 비밀번호를 1234로 초기화했습니다.`);
  }

  function handleListClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const { action, id } = button.dataset;
    if (action === 'edit') {
      window.location.href = `rider-manage.html?edit=${encodeURIComponent(id)}`;
    }
    if (action === 'reset-password') resetDriverPassword(id);
    if (action === 'toggle-field-hidden') toggleFieldHidden(id, button.dataset.field);
    if (action === 'delete') deleteDriver(id);
  }

  function init() {
    searchInput.addEventListener('input', render);
    statusFilter.addEventListener('change', render);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportDriversToExcel);
    if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', deleteSelected);
    if (bulkDeleteBtnBar) bulkDeleteBtnBar.addEventListener('click', deleteSelected);
    if (selectAllInput) selectAllInput.addEventListener('change', handleSelectAll);
    tableBody.addEventListener('change', handleSelectionChange);
    mobileList.addEventListener('change', handleSelectionChange);
    tableBody.addEventListener('click', handleListClick);
    mobileList.addEventListener('click', handleListClick);
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

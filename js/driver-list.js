(async function () {
  const {
    makeDriverLoginId,
    makeDriverMatchKey,
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
  const mergeSelectedBtn = document.getElementById('mergeSelectedBtn');
  const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
  const bulkDeleteBtnBar = document.getElementById('bulkDeleteBtnBar');
  const selectAllInput = document.getElementById('selectAllDrivers');
  const selectionBar = document.getElementById('listSelectionBar');
  const selectedCountLabel = document.getElementById('selectedCountLabel');
  const tableBody = document.getElementById('driverTableBody');
  const mobileList = document.getElementById('mobileDriverList');
  const listScroll = document.getElementById('driverListScroll');
  const listCountEl = document.getElementById('driverListCount');
  const emptyState = document.getElementById('emptyState');
  const driverTotal = document.getElementById('driverTotal');
  const toast = document.getElementById('toast');

  if (!tableBody) return;

  const selectedIds = new Set();
  let renderedSnapshot = '';
  let renderedIsMobile = null;
  let syncRenderTimer = null;

  function buildDriverSearchText(driver) {
    const phone = String(driver.phone || '').replace(/[^0-9]/g, '');
    const coupangId = makeDriverLoginId(driver);
    return [
      driver.name,
      phone,
      phone.slice(-4),
      coupangId,
      driver.baeminId,
      driver.memo
    ].map(value => String(value || '').toLowerCase()).join(' ');
  }

  function getDriverSnapshot() {
    return BremStorage.drivers.getAll().map(driver => (
      `${driver.id}|${driver.name}|${driver.phone}|${driver.status}|${driver.baeminId || ''}|${driver.memo || ''}`
    )).join('\n');
  }

  function isMobileView() {
    return window.matchMedia('(max-width: 900px)').matches;
  }

  function canUseFastFilter() {
    const listRoot = isMobileView() ? mobileList : tableBody;
    if (!listRoot?.querySelector('[data-driver-id]')) return false;
    return renderedSnapshot === getDriverSnapshot() && renderedIsMobile === isMobileView();
  }

  function rowMatchesFilter(element, keyword, status) {
    const matchKeyword = !keyword || String(element.dataset.search || '').includes(keyword);
    const matchStatus = status === '전체' || element.dataset.status === status;
    return matchKeyword && matchStatus;
  }

  function applyListFilter() {
    const keyword = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;
    const listRoot = isMobileView() ? mobileList : tableBody;
    let visibleCount = 0;

    listRoot.querySelectorAll('[data-driver-id]').forEach(element => {
      const visible = rowMatchesFilter(element, keyword, status);
      element.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const allDrivers = BremStorage.drivers.getAll();
    emptyState.classList.toggle('show', visibleCount === 0);
    renderListCount(visibleCount, allDrivers.length);
    updateSelectionUi();
  }
  function driverMatchesKeyword(driver, keyword) {
    if (!keyword) return true;
    return buildDriverSearchText(driver).includes(keyword);
  }

  function getFilteredDrivers() {
    const keyword = searchInput.value.trim().toLowerCase();
    const status = statusFilter.value;

    return BremStorage.drivers.getAll().filter(driver => {
      const matchesKeyword = driverMatchesKeyword(driver, keyword);
      const matchesStatus = status === '전체' || driver.status === status;
      return matchesKeyword && matchesStatus;
    });
  }

  function scrollListToTop() {
    if (listScroll) listScroll.scrollTop = 0;
  }

  function renderListCount(filteredCount, totalCount) {
    if (!listCountEl) return;
    if (!totalCount) {
      listCountEl.hidden = true;
      listCountEl.textContent = '';
      return;
    }

    listCountEl.hidden = false;
    if (filteredCount === totalCount) {
      listCountEl.textContent = `등록 기사 ${totalCount}명 전체 표시 · 스크롤하여 확인`;
    } else {
      listCountEl.textContent = `등록 기사 ${totalCount}명 중 ${filteredCount}명 표시 · 스크롤하여 확인`;
    }
  }

  function updateSelectionUi() {
    const count = selectedIds.size;
    const disabled = count === 0;

    if (bulkDeleteBtn) bulkDeleteBtn.disabled = disabled;
    if (bulkDeleteBtnBar) bulkDeleteBtnBar.disabled = disabled;
    if (mergeSelectedBtn) mergeSelectedBtn.disabled = count < 2;
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
    try {
      window.BremPerf?.time?.('drivers.render');
      tableBody.closest('.table-wrap')?.classList.remove('is-loading');
      mobileList?.classList.remove('is-loading');

      const allDrivers = BremStorage.drivers.getAll();

      const allIds = new Set(allDrivers.map(driver => driver.id));
      selectedIds.forEach(id => {
        if (!allIds.has(id)) selectedIds.delete(id);
      });

      updateDriverTotal(driverTotal, allDrivers.length);

      const mobileView = isMobileView();

      if (!mobileView) {
        tableBody.innerHTML = allDrivers.map(driver => {
          const coupangId = escapeHtml(makeDriverLoginId(driver));
          const eventName = escapeHtml(driver.longEventItem) || '-';
          const eventStart = formatDate(driver.longEventStartDate);
          const eventCell = driver.longEventItem
            ? `<span class="cell-main">${eventName}</span><span class="cell-sub">${eventStart}</span>`
            : `<span class="cell-main">-</span>`;
          return `
      <tr class="${selectedIds.has(driver.id) ? 'row-selected' : ''}" data-driver-id="${escapeHtml(driver.id)}" data-search="${escapeHtml(buildDriverSearchText(driver))}" data-status="${escapeHtml(driver.status)}">
        <td class="col-select">${renderCheckbox(driver.id)}</td>
        <td class="col-name">
          <strong class="cell-main">${escapeHtml(driver.name)}</strong>
        </td>
        <td class="col-phone">${escapeHtml(driver.phone)}</td>
        <td class="col-baemin">${escapeHtml(driver.baeminId) || '-'}</td>
        <td class="col-coupang">${coupangId || '-'}</td>
        <td class="col-platform"><div class="platform-tags platform-tags--compact">${renderPlatformBadges(driver)}</div></td>
        <td class="col-event">${eventCell}</td>
        <td class="col-date">${formatDate(driver.joinDate)}</td>
        <td class="col-status"><span class="badge badge--compact ${statusClass(driver.status)}">${driver.status}</span></td>
        <td class="col-memo memo-cell" title="${escapeHtml(driver.memo)}">${escapeHtml(driver.memo) || '-'}</td>
        <td class="col-privacy">
          ${renderPrivacySummary(driver)}
          ${renderPrivacyControls(driver, true)}
        </td>
        <td class="col-actions">
          <div class="actions actions--compact">
            <button type="button" class="btn small edit" data-action="edit" data-id="${driver.id}">수정</button>
            <button type="button" class="btn small ghost" data-action="reset-password" data-id="${driver.id}">PW초기화</button>
            <button type="button" class="btn small delete" data-action="delete" data-id="${driver.id}">삭제</button>
          </div>
        </td>
      </tr>
    `;
        }).join('');
        mobileList.innerHTML = '';
      } else {
        tableBody.innerHTML = '';
        mobileList.innerHTML = allDrivers.map(driver => `
      <article class="driver-card ${selectedIds.has(driver.id) ? 'driver-card--selected' : ''}" data-driver-id="${escapeHtml(driver.id)}" data-search="${escapeHtml(buildDriverSearchText(driver))}" data-status="${escapeHtml(driver.status)}">
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
          <dt>배민 아이디</dt>
          <dd>${escapeHtml(driver.baeminId) || '-'}</dd>
          <dt>쿠팡 ID</dt>
          <dd><strong>${escapeHtml(makeDriverLoginId(driver))}</strong></dd>
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
      }

      renderedSnapshot = getDriverSnapshot();
      renderedIsMobile = mobileView;
      applyListFilter();
      window.BremPerf?.timeEnd?.('drivers.render');
    } catch (error) {
      console.error('[BREM] Driver list render failed:', error);
      showToast(toast, '기사 목록을 표시하지 못했습니다. 새로고침 후 다시 시도하세요.');
    }
  }

  async function exportDriversToExcel() {
    if (!window.XLSX) {
      showToast(toast, '엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }

    showToast(toast, '엑셀 백업 준비 중…');
    await syncAllDriversForList();

    const drivers = BremStorage.drivers.getAll();
    if (!drivers.length) {
      showToast(toast, '백업할 기사가 없습니다.');
      return;
    }

    const header = ['이름', '전화번호', '주민번호', '은행명', '예금주', '계좌번호', '배민아이디', '쿠팡ID'];
    const rows = drivers.map(driver => {
      const hidden = driver.hiddenFields || {};
      return [
        driver.name || '',
        driver.phone || '',
        hidden.residentNumber ? '가려짐' : formatResidentNumber(driver.residentNumber || ''),
        driver.bankName || '',
        driver.accountHolder || '',
        hidden.accountNumber ? '가려짐' : (driver.accountNumber || ''),
        driver.baeminId || '',
        makeDriverLoginId(driver)
      ];
    });

    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    sheet['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 14 }, { wch: 14 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기사목록');

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `BREM_기사목록_백업_${stamp}.xlsx`);
    showToast(toast, `${drivers.length}명 엑셀 백업 완료`);
  }

  function showLoadingSkeleton() {
    tableBody.closest('.table-wrap')?.classList.add('is-loading');
    mobileList.classList.add('is-loading');
    const skeletonRow = '<tr class="skeleton-row"><td colspan="12"><span class="skeleton-bar"></span></td></tr>';
    tableBody.innerHTML = skeletonRow.repeat(5);
    mobileList.innerHTML = '<article class="driver-card skeleton-card"><span class="skeleton-bar"></span></article>'.repeat(3);
    if (listCountEl) listCountEl.hidden = true;
  }

  function deleteDriver(id) {
    const driver = BremStorage.drivers.getById(id);
    if (!driver) return;
    if (!window.confirm(`${driver.name} 기사를 삭제하시겠습니까?`)) return;

    selectedIds.delete(id);
    const removePromise = BremStorage.drivers.remove(id);
    render();
    showToast(toast, '기사를 삭제하는 중…');

    removePromise.then(() => {
      showToast(toast, '기사가 삭제되었습니다.');
    }).catch(error => {
      render();
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

  async function mergeSelectedDrivers() {
    const selectedDrivers = [...selectedIds]
      .map(id => BremStorage.drivers.getById(id))
      .filter(Boolean);

    if (selectedDrivers.length < 2) {
      showToast(toast, '병합할 기사를 2명 이상 선택해주세요.');
      return;
    }

    const matchKeys = new Set(selectedDrivers.map(driver => makeDriverMatchKey(driver.name, driver.phone)));
    if (matchKeys.size !== 1 || ![...matchKeys][0]) {
      showToast(toast, '이름과 연락처가 같은 기사만 병합할 수 있습니다.');
      return;
    }

    const names = selectedDrivers.map(driver => `${driver.name} (${driver.phone})`).join('\n');
    if (!window.confirm(`선택한 ${selectedDrivers.length}명의 중복 기사를 1명으로 병합할까요?\n\n${names}`)) return;

    if (mergeSelectedBtn) mergeSelectedBtn.disabled = true;
    showToast(toast, '선택 기사 병합 중…');

    try {
      const result = await BremStorage.drivers.mergeSelected(selectedDrivers.map(driver => driver.id));
      selectedIds.clear();
      renderedSnapshot = '';
      await refreshDriverList(true);
      showToast(toast, `병합 완료 · ${result.keptName || '기사'} 1명으로 정리되었습니다.`);
    } catch (error) {
      console.error(error);
      showToast(toast, error.message || '선택 기사 병합에 실패했습니다.');
      updateSelectionUi();
    }
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

  const debouncedFullRender = window.BremPerf?.debounce
    ? window.BremPerf.debounce(render, 180)
    : render;

  function handleSearchInput() {
    if (canUseFastFilter()) {
      applyListFilter();
      return;
    }
    debouncedFullRender();
  }

  function handleStatusFilterChange() {
    scrollListToTop();
    if (canUseFastFilter()) {
      applyListFilter();
      return;
    }
    render();
  }

  function scheduleSyncRender() {
    clearTimeout(syncRenderTimer);
    syncRenderTimer = setTimeout(() => {
      renderedSnapshot = '';
      render();
    }, 300);
  }

  async function syncAllDriversForList() {
    await BremStorage.syncAllDriversPagesInBackground?.().catch(() => ({}));

    let pages = 0;
    while (pages < 100) {
      const before = BremStorage.drivers.getAll().length;
      const result = await BremStorage.reloadDrivers?.(false, {
        limit: 200,
        offset: before,
        append: true
      }).catch(() => null);
      if (!result?.ok || !result?.hasMore) break;
      if (BremStorage.drivers.getAll().length <= before) break;
      pages += 1;
    }
  }

  async function refreshDriverList(force = false) {
    const listPanel = document.querySelector('.list-panel');
    const hasCachedDrivers = BremStorage.drivers.getAll().length > 0;
    const showLoading = force || !hasCachedDrivers;

    if (showLoading) {
      tableBody.closest('.table-wrap')?.classList.add('is-loading');
      mobileList.classList.add('is-loading');
      window.BremLoadingUI?.show(listPanel, '데이터 불러오는 중...');
    }

    const syncResult = await BremStorage.reloadDrivers?.(force);

    if (showLoading) {
      tableBody.closest('.table-wrap')?.classList.remove('is-loading');
      mobileList.classList.remove('is-loading');
      window.BremLoadingUI?.hide(listPanel);
    }

    if (syncResult?.ok === false) {
      showToast(toast, syncResult.message || '기사 목록을 불러오지 못했습니다.');
    }
    render();
    void syncAllDriversForList().then(() => {
      renderedSnapshot = '';
      render();
    });
  }

  function init() {
    searchInput.addEventListener('input', handleSearchInput);
    statusFilter.addEventListener('change', handleStatusFilterChange);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', () => { void exportDriversToExcel(); });
    if (mergeSelectedBtn) mergeSelectedBtn.addEventListener('click', () => { void mergeSelectedDrivers(); });
    if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', deleteSelected);
    if (bulkDeleteBtnBar) bulkDeleteBtnBar.addEventListener('click', deleteSelected);
    if (selectAllInput) selectAllInput.addEventListener('change', handleSelectAll);
    tableBody.addEventListener('change', handleSelectionChange);
    mobileList.addEventListener('change', handleSelectionChange);
    tableBody.addEventListener('click', handleListClick);
    mobileList.addEventListener('click', handleListClick);
    document.addEventListener('brem-storage-ready', () => {
      render();
    });
    document.addEventListener('brem-drivers-sync-ready', () => {
      tableBody.closest('.table-wrap')?.classList.remove('is-loading');
      mobileList.classList.remove('is-loading');
      scheduleSyncRender();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (!(await window.BremDriverProgramAccess?.ensure?.())) return;

  if (BremStorage.drivers.getAll().length) {
    render();
  } else {
    showLoadingSkeleton();
  }

  void refreshDriverList(true);
})();

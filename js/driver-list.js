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
  const mergeAutoBtn = document.getElementById('mergeAutoBtn');
  const mergeSelectedBtn = document.getElementById('mergeSelectedBtn');
  const refreshListBtn = document.getElementById('refreshDriverListBtn');
  const deleteAllBtn = document.getElementById('deleteAllDriversBtn');
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
  let listLoadPromise = null;
  let lastSupabaseTotal = 0;
  const listSort = { key: 'name', dir: 'asc' };
  const VIRTUAL_ROW_HEIGHT = 46;
  const VIRTUAL_THRESHOLD = 150;
  const VIRTUAL_OVERSCAN = 12;
  let virtualRenderRaf = 0;
  let virtualBound = false;
  let lastRenderedDrivers = [];
  const driverListSortSchema = {
    name: driver => driver.name,
    phone: driver => driver.phone,
    baeminId: driver => driver.baeminId,
    coupangId: driver => makeDriverLoginId(driver),
    platform: driver => `${driver.platformCoupang !== false ? 1 : 0}${driver.platformBaemin ? 1 : 0}`,
    event: driver => driver.longEventItem || '',
    joinDate: { get: driver => driver.joinDate, type: 'date' },
    status: driver => driver.status,
    memo: driver => driver.memo
  };

  function getSortedDrivers(list) {
    return window.BremTableSort?.sortItems(list, listSort, driverListSortSchema) || list;
  }

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
    if (useVirtualDesktop()) return false;
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
    if (useVirtualDesktop() || !canUseFastFilter()) {
      scrollListToTop();
      render();
      return;
    }

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
    const supabaseTotal = BremStorage.drivers.getSupabaseTotal?.() || totalCount;
    lastSupabaseTotal = supabaseTotal;

    if (!totalCount && !supabaseTotal) {
      listCountEl.hidden = true;
      listCountEl.textContent = '';
      return;
    }

    listCountEl.hidden = false;
    const countNote = supabaseTotal === totalCount
      ? `Supabase ${supabaseTotal}명`
      : `화면 ${totalCount}명 · Supabase ${supabaseTotal}명`;

    if (filteredCount === totalCount) {
      listCountEl.textContent = `등록 기사 ${totalCount}명 전체 표시 (${countNote}) · 스크롤하여 확인`;
    } else {
      listCountEl.textContent = `등록 기사 ${totalCount}명 중 ${filteredCount}명 표시 (${countNote}) · 스크롤하여 확인`;
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

  function useVirtualDesktop() {
    return !isMobileView() && getFilteredDrivers().length >= VIRTUAL_THRESHOLD;
  }

  function renderDesktopRow(driver) {
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
  }

  function getVirtualRange(total, scrollTop, viewportHeight) {
    const start = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + (VIRTUAL_OVERSCAN * 2);
    const end = Math.min(total, start + visibleCount);
    return { start, end };
  }

  function renderDesktopVirtual(filteredDrivers) {
    if (!listScroll) {
      tableBody.innerHTML = filteredDrivers.map(renderDesktopRow).join('');
      return;
    }

    const viewportHeight = listScroll.clientHeight || 640;
    const scrollTop = listScroll.scrollTop || 0;
    const { start, end } = getVirtualRange(filteredDrivers.length, scrollTop, viewportHeight);
    const slice = filteredDrivers.slice(start, end);
    const topPad = start * VIRTUAL_ROW_HEIGHT;
    const bottomPad = Math.max(0, (filteredDrivers.length - end) * VIRTUAL_ROW_HEIGHT);
    const colSpan = tableBody.closest('table')?.querySelectorAll('thead th').length || 12;

    tableBody.innerHTML = [
      `<tr class="virtual-spacer" aria-hidden="true"><td colspan="${colSpan}" style="height:${topPad}px;padding:0;border:0;line-height:0"></td></tr>`,
      ...slice.map(renderDesktopRow),
      `<tr class="virtual-spacer" aria-hidden="true"><td colspan="${colSpan}" style="height:${bottomPad}px;padding:0;border:0;line-height:0"></td></tr>`
    ].join('');
    tableBody.dataset.virtual = '1';
  }

  function scheduleVirtualRender() {
    if (!useVirtualDesktop()) return;
    if (virtualRenderRaf) cancelAnimationFrame(virtualRenderRaf);
    virtualRenderRaf = requestAnimationFrame(() => {
      virtualRenderRaf = 0;
      renderDesktopVirtual(lastRenderedDrivers);
    });
  }

  function bindVirtualScroll() {
    if (virtualBound || !listScroll) return;
    virtualBound = true;
    listScroll.addEventListener('scroll', scheduleVirtualRender, { passive: true });
    window.addEventListener('resize', scheduleVirtualRender, { passive: true });
  }

  function render() {
    try {
      window.BremPerf?.time?.('drivers.render');
      tableBody.closest('.table-wrap')?.classList.remove('is-loading');
      mobileList?.classList.remove('is-loading');

      const allDrivers = getSortedDrivers(BremStorage.drivers.getAll());
      const filteredDrivers = allDrivers.filter(driver => {
        const keyword = searchInput.value.trim().toLowerCase();
        const status = statusFilter.value;
        const matchesKeyword = driverMatchesKeyword(driver, keyword);
        const matchesStatus = status === '전체' || driver.status === status;
        return matchesKeyword && matchesStatus;
      });
      lastRenderedDrivers = filteredDrivers;

      const allIds = new Set(allDrivers.map(driver => driver.id));
      selectedIds.forEach(id => {
        if (!allIds.has(id)) selectedIds.delete(id);
      });

      updateDriverTotal(driverTotal, allDrivers.length);

      const mobileView = isMobileView();

      if (!mobileView) {
        if (useVirtualDesktop()) {
          bindVirtualScroll();
          renderDesktopVirtual(filteredDrivers);
        } else {
          delete tableBody.dataset.virtual;
          tableBody.innerHTML = filteredDrivers.map(renderDesktopRow).join('');
        }
        mobileList.innerHTML = '';
      } else {
        delete tableBody.dataset.virtual;
        tableBody.innerHTML = '';
        mobileList.innerHTML = filteredDrivers.map(driver => `
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
      emptyState.classList.toggle('show', filteredDrivers.length === 0 && allDrivers.length > 0);
      renderListCount(filteredDrivers.length, allDrivers.length);
      updateSelectionUi();
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
    await loadAllDriversForList(true);

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

  function formatAutoMergeReason(reason) {
    if (String(reason || '').startsWith('baemin:')) return '배민 ID 동일';
    if (String(reason || '').startsWith('coupang:')) return '이름+쿠팡 ID 동일';
    return '중복 기준 일치';
  }

  function showAutoMergeResult(result) {
    const groupCount = Number(result.groupsMerged || 0);
    const removedCount = Number(result.ridersRemoved || 0);
    const details = Array.isArray(result.details) ? result.details : [];

    if (!groupCount) {
      window.alert('자동병합 결과\n\n병합할 중복 기사가 없습니다.');
      showToast(toast, '자동병합 대상이 없습니다.');
      return;
    }

    const sampleLines = details.slice(0, 10).map(item => {
      const reasons = [...new Set((item.reasons || []).map(formatAutoMergeReason))].join(', ');
      return `- ${item.keptName || '기사'} (${item.keptPhone || '-'}) · ${item.mergedCount}건 → 1건 · ${reasons}`;
    });
    const moreLine = details.length > 10 ? `\n외 ${details.length - 10}개 그룹` : '';

    window.alert([
      '자동병합 결과',
      '',
      `병합 그룹: ${groupCount}개`,
      `삭제된 중복 기사: ${removedCount}건`,
      '',
      ...sampleLines,
      moreLine
    ].filter(Boolean).join('\n'));
    showToast(toast, `자동병합 완료 · ${groupCount}개 그룹 · ${removedCount}건 정리`);
  }

  async function mergeAutoDrivers() {
    if (!window.confirm('전체 기사를 자동으로 검사해 병합합니다.\n\n조건:\n- 이름+쿠팡 ID가 같은 경우\n- 배민 ID가 같은 경우\n\n진행할까요?')) return;

    if (mergeAutoBtn) mergeAutoBtn.disabled = true;
    showToast(toast, '전체 기사 자동병합 중…');

    try {
      const result = await BremStorage.drivers.mergeAuto();
      selectedIds.clear();
      renderedSnapshot = '';
      await refreshDriverList(true);
      showAutoMergeResult(result);
    } catch (error) {
      console.error(error);
      showToast(toast, error.message || '전체 자동병합에 실패했습니다.');
    } finally {
      if (mergeAutoBtn) mergeAutoBtn.disabled = false;
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

  function clearListDom() {
    tableBody.innerHTML = '';
    mobileList.innerHTML = '';
    renderedSnapshot = '';
  }

  function showListLoadError(message) {
    clearListDom();
    selectedIds.clear();
    updateDriverTotal(driverTotal, 0);
    emptyState.classList.add('show');
    if (listCountEl) {
      listCountEl.hidden = false;
      listCountEl.textContent = message || '기사 목록을 불러오지 못했습니다.';
    }
  }

  async function loadAllDriversForList(force = false) {
    if (listLoadPromise && !force) return listLoadPromise;

    const cacheStatus = BremStorage.getCacheStatus?.() || {};
    const hasCompleteCache = cacheStatus.driversComplete && BremStorage.drivers.getAll().length > 0;

    if (!force && hasCompleteCache) {
      renderedSnapshot = '';
      render();
      return {
        ok: true,
        cached: true,
        count: BremStorage.drivers.getAll().length,
        supabaseTotal: cacheStatus.driversSupabaseTotal || BremStorage.drivers.getAll().length
      };
    }

    const task = async () => {
      if (force && !hasCompleteCache) {
        clearListDom();
        selectedIds.clear();
      }

      const result = await BremStorage.fetchAllDriversFromServer?.({ force })
        || await BremStorage.reloadDrivers?.(force);

      if (result?.ok === false && !BremStorage.drivers.getAll().length) {
        showListLoadError(result.message || 'Supabase에서 기사 목록을 불러오지 못했습니다.');
        showToast(toast, result.message || '기사 목록을 불러오지 못했습니다.');
        return result;
      }

      renderedSnapshot = '';
      render();
      return result;
    };

    if (!force) {
      listLoadPromise = task.finally(() => {
        listLoadPromise = null;
      });
      return listLoadPromise;
    }

    return task;
  }

  function isDriverListCacheReady() {
    const cacheStatus = BremStorage.getCacheStatus?.() || {};
    return Boolean(cacheStatus.driversComplete && BremStorage.drivers.getAll().length);
  }

  async function refreshDriverList(force = false) {
    const listPanel = document.querySelector('.list-panel');
    const cacheReady = isDriverListCacheReady();
    const needsNetwork = force || !cacheReady;

    if (needsNetwork) {
      if (!cacheReady) {
        tableBody.closest('.table-wrap')?.classList.add('is-loading');
        mobileList.classList.add('is-loading');
      }
      window.BremLoadingUI?.show(
        listPanel,
        cacheReady ? '기사 목록 새로고침 중...' : 'Supabase에서 기사 목록 불러오는 중...'
      );
    }

    const syncResult = await loadAllDriversForList(force);

    tableBody.closest('.table-wrap')?.classList.remove('is-loading');
    mobileList.classList.remove('is-loading');
    window.BremLoadingUI?.hide(listPanel);

    const count = syncResult?.count
      || BremStorage.drivers.getSupabaseTotal?.()
      || BremStorage.drivers.getAll().length;

    if (syncResult?.ok === false) {
      window.BremLoadingUI?.showStatus(listPanel, {
        type: 'error',
        message: syncResult.message || '불러오기 실패 · 다시 시도 필요'
      });
      return syncResult;
    }

    if (needsNetwork) {
      window.BremLoadingUI?.showStatus(listPanel, {
        type: 'success',
        message: `기사 목록 불러오기 완료 · ${count}명 표시 중`,
        autoHideMs: 2500
      });
    }

    return syncResult;
  }

  async function deleteAllDrivers() {
    const supabaseTotal = BremStorage.drivers.getSupabaseTotal?.() || BremStorage.drivers.getAll().length;
    if (!supabaseTotal) {
      showToast(toast, '삭제할 기사가 없습니다.');
      return;
    }

    if (!window.confirm(`등록된 기사 ${supabaseTotal}명을 Supabase에서 모두 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다.`)) return;

    if (deleteAllBtn) deleteAllBtn.disabled = true;
    showToast(toast, 'Supabase에서 기사 전체 삭제 중…');

    try {
      const result = await BremStorage.drivers.deleteAll();
      selectedIds.clear();
      clearListDom();
      render();

      const verify = await BremStorage.drivers.verifySupabaseCount(0);
      if (!verify.matches) {
        throw new Error(`삭제 후 Supabase에 ${verify.count}명이 남아 있습니다.`);
      }

      showToast(toast, `전체 삭제 완료 · Supabase ${result.remainingCount ?? 0}명`);
    } catch (error) {
      console.error(error);
      await refreshDriverList(true);
      showToast(toast, error.message || '기사 전체 삭제에 실패했습니다.');
    } finally {
      if (deleteAllBtn) deleteAllBtn.disabled = false;
    }
  }

  function init() {
    const driverTable = tableBody.closest('[data-sort-table="driver-list"]');
    window.BremTableSort?.bind(driverTable, listSort, () => {
      renderedSnapshot = '';
      render();
    });
    window.BremTableSort?.markScope(driverTable, listSort);

    searchInput.addEventListener('input', handleSearchInput);
    statusFilter.addEventListener('change', handleStatusFilterChange);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', () => { void exportDriversToExcel(); });
    if (refreshListBtn) refreshListBtn.addEventListener('click', () => { void refreshDriverList(true); });
    if (deleteAllBtn) deleteAllBtn.addEventListener('click', () => { void deleteAllDrivers(); });
    if (mergeAutoBtn) mergeAutoBtn.addEventListener('click', () => { void mergeAutoDrivers(); });
    if (mergeSelectedBtn) mergeSelectedBtn.addEventListener('click', () => { void mergeSelectedDrivers(); });
    if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', deleteSelected);
    if (bulkDeleteBtnBar) bulkDeleteBtnBar.addEventListener('click', deleteSelected);
    if (selectAllInput) selectAllInput.addEventListener('change', handleSelectAll);
    tableBody.addEventListener('change', handleSelectionChange);
    mobileList.addEventListener('change', handleSelectionChange);
    tableBody.addEventListener('click', handleListClick);
    mobileList.addEventListener('click', handleListClick);
    document.addEventListener('brem-storage-ready', () => {
      if (BremStorage.drivers.getAll().length) {
        renderedSnapshot = '';
        render();
      }
    });
    document.addEventListener('brem-drivers-sync-ready', event => {
      if (!event?.detail?.complete) return;
      tableBody.closest('.table-wrap')?.classList.remove('is-loading');
      mobileList.classList.remove('is-loading');
      renderedSnapshot = '';
      render();
    });
    document.addEventListener('brem-cache-status-changed', () => {
      if (BremStorage.drivers.getAll().length && !renderedSnapshot) {
        render();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (!(await window.BremDriverProgramAccess?.ensure?.())) return;

  if (isDriverListCacheReady()) {
    render();
  } else {
    showLoadingSkeleton();
  }

  void refreshDriverList(false);
})();

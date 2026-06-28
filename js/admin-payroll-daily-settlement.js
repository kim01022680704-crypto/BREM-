(function () {
  const roster = window.BremPayrollDailySettlementAdmin;
  if (!roster) return;

  const state = {
    selectedIds: new Set(),
    bulkPreview: [],
    driverSearchKeyword: ''
  };

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

  function getDrivers() {
    if (window.BremPayrollLocalBaseData?.isActive?.()) {
      return window.BremPayrollLocalBaseData.getDrivers();
    }
    if (window.BremPayrollProductionRiders?.isActive?.()) {
      return window.BremPayrollProductionRiders.getRiders();
    }
    return BremStorage?.drivers?.getAll?.() || [];
  }

  function resolveBaeminId(driver) {
    return roster.resolveDriverPlatformId?.(driver, 'baemin') || driver.baeminId || '';
  }

  function resolveCoupangId(driver) {
    return roster.resolveDriverPlatformId?.(driver, 'coupang') || driver.coupangId || '';
  }

  function filterDrivers(list) {
    const keyword = String(state.driverSearchKeyword || '').trim().toLowerCase();
    if (!keyword) return list;
    return list.filter(driver => {
      const haystack = [
        driver.name,
        driver.baeminId,
        driver.coupangId,
        driver.coupangLoginKey,
        driver.phone,
        driver.employeeNo
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  function renderDriverPicker() {
    const body = $('payrollDailySettlementDriverBody');
    if (!body) return;

    const enrolled = roster.getEnrolledDriverIdSet();
    const drivers = filterDrivers(getDrivers()).slice(0, 500);

    if (!drivers.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">검색된 기사가 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = drivers.map(driver => {
      const isEnrolled = enrolled.has(driver.id);
      const baeminId = resolveBaeminId(driver);
      const coupangId = resolveCoupangId(driver);
      return `
        <tr class="${isEnrolled ? 'is-enrolled' : ''}">
          <td>${escapeHtml(driver.name || '-')}</td>
          <td>${escapeHtml(baeminId || '-')}</td>
          <td>${escapeHtml(coupangId || '-')}</td>
          <td>${escapeHtml(driver.phone || '-')}</td>
          <td class="${isEnrolled ? 'text-success' : 'text-muted'}">${isEnrolled ? '등록됨' : '미등록'}</td>
          <td>
            ${isEnrolled
              ? `<button type="button" class="small-btn" data-pds-unenroll-driver="${escapeHtml(driver.id)}">해제</button>`
              : `<button type="button" class="primary-btn small-btn" data-pds-enroll-driver="${escapeHtml(driver.id)}">등록</button>`}
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderRoster() {
    const body = $('payrollDailySettlementBody');
    const countEl = $('payrollDailySettlementCount');
    if (!body) return;

    const list = roster.readAll();
    if (countEl) countEl.textContent = `${list.length}명 등록`;

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">일정산 등록 기사가 없습니다. 기사 목록에서 등록하거나 일괄등록을 사용하세요.</td></tr>';
      renderDriverPicker();
      return;
    }

    body.innerHTML = list.map(item => `
      <tr>
        <td><input type="checkbox" data-pds-select="${escapeHtml(item.id)}" ${state.selectedIds.has(item.id) ? 'checked' : ''}></td>
        <td>${escapeHtml(item.driverName || '-')}</td>
        <td>${escapeHtml(item.baeminId || '-')}</td>
        <td>${escapeHtml(item.coupangId || '-')}</td>
        <td>${escapeHtml(item.phone || '-')}</td>
        <td><input type="text" class="payroll-region-input" data-pds-region="${escapeHtml(item.id)}" value="${escapeHtml(item.region || '')}" placeholder="지역(참고)"></td>
        <td>${escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleString('ko-KR') : '-')}</td>
        <td>
          <button type="button" class="small-btn" data-pds-unenroll-roster="${escapeHtml(item.driverId)}" title="일정산 해제">해제</button>
          <button type="button" class="small-btn danger-btn" data-pds-delete="${escapeHtml(item.id)}">삭제</button>
        </td>
      </tr>
    `).join('');
    renderDriverPicker();
  }

  function renderBulkPreview(rows) {
    const wrap = $('payrollDailySettlementBulkPreview');
    const body = $('payrollDailySettlementBulkBody');
    if (!wrap || !body) return;
    wrap.hidden = !rows.length;
    if (!rows.length) {
      body.innerHTML = '';
      return;
    }
    body.innerHTML = rows.map(row => `
      <tr>
        <td>${row.rowNumber}</td>
        <td>${escapeHtml(row.baeminId || '-')}</td>
        <td>${escapeHtml(row.coupangId || '-')}</td>
        <td>${escapeHtml(row.phone || '-')}</td>
        <td>${escapeHtml(row.region || '-')}</td>
        <td>${escapeHtml(row.driverName || '-')}</td>
        <td class="${row.matchStatus === 'matched' ? 'text-success' : 'text-danger'}">${escapeHtml(row.matchStatus === 'matched' ? '매칭' : row.error || '미매칭')}</td>
      </tr>
    `).join('');
  }

  function refreshPayrollMatches() {
    window.BremAdminPayrollSlips?.refreshParsedMatches?.();
  }

  async function handleBulkFile(event) {
    const file = event.target.files?.[0];
    if (!file || !window.XLSX) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = window.XLSX.read(reader.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const parsed = roster.parseBulkRows(rows, getDrivers());
        state.bulkPreview = parsed.rows;
        renderBulkPreview(parsed.rows);
        const matched = parsed.rows.filter(row => row.matchStatus === 'matched').length;
        showToast(`일정산 일괄등록 미리보기 ${matched}/${parsed.rows.length}건 매칭`);
      } catch (error) {
        console.error('[daily settlement bulk]', error);
        showToast('일정산 일괄등록 파일을 읽지 못했습니다.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function applyBulkPreview() {
    if (!state.bulkPreview.length) {
      showToast('적용할 일괄등록 데이터가 없습니다.');
      return;
    }
    void (async () => {
      try {
        const result = roster.upsertFromBulk(state.bulkPreview);
        await roster.applyBulkPersist(result);
        state.bulkPreview = [];
        renderBulkPreview([]);
        renderRoster();
        refreshPayrollMatches();
        showToast(`일정산 ${result.added}명 추가 · Supabase 저장 · 총 ${readAll().length}명`);
      } catch (error) {
        console.error('[daily settlement bulk apply]', error);
        showToast(error.message || '일정산 일괄등록 저장에 실패했습니다.');
      }
    })();
  }

  function readAll() {
    return roster.readAll();
  }

  function saveRegion(id, value) {
    void (async () => {
      try {
        const list = roster.readAll();
        const item = list.find(row => row.id === id);
        if (!item) return;
        item.region = String(value || '').trim();
        item.updatedAt = new Date().toISOString();
        await roster.commitSaveAll(list);
      } catch (error) {
        console.error('[daily settlement region save]', error);
        showToast(error.message || '지역 저장에 실패했습니다.');
      }
    })();
  }

  function enrollDriverById(driverId) {
    const driver = getDrivers().find(item => item.id === driverId);
    if (!driver) {
      showToast('기사를 찾을 수 없습니다.');
      return;
    }
    void (async () => {
      try {
        await roster.commitEnrollDriver(driver);
        renderRoster();
        refreshPayrollMatches();
        showToast(`${driver.name || '기사'} 일정산 등록 · Supabase 저장`);
      } catch (error) {
        console.error('[daily settlement enroll]', error);
        showToast(error.message || '일정산 등록 저장에 실패했습니다.');
      }
    })();
  }

  function unenrollDriverById(driverId) {
    const id = String(driverId || '').trim();
    if (!id) return;
    void (async () => {
      try {
        await roster.commitUnenrollByDriverId(id);
        renderRoster();
        refreshPayrollMatches();
        showToast('일정산 등록 해제 · Supabase 저장');
      } catch (error) {
        console.error('[daily settlement unenroll]', error);
        showToast(error.message || '일정산 해제 저장에 실패했습니다.');
      }
    })();
  }

  function deleteSelected() {
    if (!state.selectedIds.size) {
      showToast('삭제할 항목을 선택하세요.');
      return;
    }
    if (!window.confirm(`선택한 ${state.selectedIds.size}명을 일정산 목록에서 삭제할까요?`)) return;
    void (async () => {
      try {
        await roster.commitRemoveByIds([...state.selectedIds]);
        state.selectedIds.clear();
        renderRoster();
        refreshPayrollMatches();
        showToast('선택 항목 삭제 · Supabase 저장');
      } catch (error) {
        console.error('[daily settlement delete selected]', error);
        showToast(error.message || '삭제 저장에 실패했습니다.');
      }
    })();
  }

  function downloadTemplate() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const rows = roster.templateRows();
    const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, '일정산일괄등록');
    window.XLSX.writeFile(workbook, 'BREM_급여일정산_일괄등록_양식.xlsx');
  }

  function bindEvents() {
    $('payrollDailySettlementBulkFile')?.addEventListener('change', handleBulkFile);
    $('payrollDailySettlementBulkApplyBtn')?.addEventListener('click', applyBulkPreview);
    $('payrollDailySettlementBulkTemplateBtn')?.addEventListener('click', downloadTemplate);
    $('payrollDailySettlementDeleteSelectedBtn')?.addEventListener('click', deleteSelected);
    $('payrollDailySettlementDriverSearch')?.addEventListener('input', event => {
      state.driverSearchKeyword = String(event.target.value || '').trim();
      renderDriverPicker();
    });

    $('payrollDailySettlementSelectAll')?.addEventListener('change', event => {
      const checked = event.target.checked;
      roster.readAll().forEach(item => {
        if (checked) state.selectedIds.add(item.id);
        else state.selectedIds.delete(item.id);
      });
      renderRoster();
    });

    $('payrollDailySettlementDriverBody')?.addEventListener('click', event => {
      const enrollBtn = event.target.closest('[data-pds-enroll-driver]');
      if (enrollBtn) {
        enrollDriverById(enrollBtn.dataset.pdsEnrollDriver);
        return;
      }
      const unenrollBtn = event.target.closest('[data-pds-unenroll-driver]');
      if (unenrollBtn) {
        unenrollDriverById(unenrollBtn.dataset.pdsUnenrollDriver);
      }
    });

    $('payrollDailySettlementBody')?.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-pds-select]');
      if (checkbox) {
        const id = checkbox.dataset.pdsSelect;
        if (checkbox.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        return;
      }
      const regionInput = event.target.closest('[data-pds-region]');
      if (regionInput) {
        saveRegion(regionInput.dataset.pdsRegion, regionInput.value);
      }
    });

    $('payrollDailySettlementBody')?.addEventListener('click', event => {
      const unenrollBtn = event.target.closest('[data-pds-unenroll-roster]');
      if (unenrollBtn) {
        unenrollDriverById(unenrollBtn.dataset.pdsUnenrollRoster);
        return;
      }
      const deleteBtn = event.target.closest('[data-pds-delete]');
      if (!deleteBtn) return;
      const id = deleteBtn.dataset.pdsDelete;
      void (async () => {
        try {
          await roster.commitRemoveByIds([id]);
          state.selectedIds.delete(id);
          renderRoster();
          refreshPayrollMatches();
          showToast('삭제 · Supabase 저장');
        } catch (error) {
          console.error('[daily settlement delete]', error);
          showToast(error.message || '삭제 저장에 실패했습니다.');
        }
      })();
    });
  }

  function refresh() {
    renderRoster();
  }

  async function refreshAfterLoad() {
    try {
      await BremStorage?.ensureSectionLoaded?.('payroll-daily-settlement');
      await BremStorage?.payrollDailySettlement?.reloadFromServer?.();
    } catch (error) {
      console.warn('[payroll daily settlement]', error);
    }
    refresh();
  }

  bindEvents();
  void refreshAfterLoad();

  window.BremAdminPayrollDailySettlement = {
    refresh: refreshAfterLoad,
    getEnrolledDriverIdSet: () => roster.getEnrolledDriverIdSet(),
    getRegionByDriverId: driverId => roster.getRegionByDriverId(driverId)
  };
})();

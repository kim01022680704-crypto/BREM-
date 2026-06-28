(function () {
  const roster = window.BremPayrollDailySettlementAdmin;
  if (!roster) return;

  const state = {
    selectedIds: new Set(),
    bulkPreview: [],
    driverSearchKeyword: '',
    rosterSearchKeyword: '',
    settleRegion: '',
    regionDetailOpen: false
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

  function getRegions() {
    return roster.readRegions?.() || [];
  }

  function getRegionOptions() {
    return roster.readRegionOptions?.() || getRegions();
  }

  function regionSelectOptions(currentValue, { includeUnset = true, includeEmptyOption = false } = {}) {
    const current = String(currentValue || '').trim();
    const options = getRegionOptions();
    const parts = [];
    if (includeEmptyOption) {
      parts.push('<option value="">미지정</option>');
    }
    options.forEach(region => {
      const selected = region === current ? ' selected' : '';
      parts.push(`<option value="${escapeHtml(region)}"${selected}>${escapeHtml(region)}</option>`);
    });
    if (current && !options.includes(current)) {
      parts.push(`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (기존)</option>`);
    }
    if (includeUnset && !includeEmptyOption) {
      /* roster filter uses separate picker */
    }
    return parts.join('');
  }

  function syncRegionSelects() {
    const regions = getRegionOptions();
    const enrollSelect = $('payrollDailySettlementEnrollRegion');
    const bulkSelect = $('payrollDailySettlementBulkRegion');
    const picker = $('payrollDailySettlementRegionPicker');

    if (enrollSelect) {
      const prev = enrollSelect.value;
      enrollSelect.innerHTML = `<option value="">미지정</option>${regions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}`;
      if (prev && [...enrollSelect.options].some(opt => opt.value === prev)) enrollSelect.value = prev;
    }

    if (bulkSelect) {
      const prev = bulkSelect.value;
      bulkSelect.innerHTML = `<option value="">지역 선택</option>${regions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}`;
      if (prev && [...bulkSelect.options].some(opt => opt.value === prev)) bulkSelect.value = prev;
    }

    if (picker) {
      const prev = picker.value || state.settleRegion;
      const counts = countRidersByRegion();
      const regionRows = getRegions().map(region => {
        const count = counts.get(region) || 0;
        return `<option value="${escapeHtml(region)}">${escapeHtml(region)} (${count}명)</option>`;
      }).join('');
      const unsetCount = counts.get('__unset__') || 0;
      const allCount = roster.readAll().length;
      picker.innerHTML = [
        '<option value="">지역 선택</option>',
        `<option value="__all__">전체 (${allCount}명)</option>`,
        `<option value="__unset__">미지정 (${unsetCount}명)</option>`,
        regionRows
      ].join('');
      if (prev && [...picker.options].some(opt => opt.value === prev)) picker.value = prev;
    }
  }

  function countRidersByRegion() {
    const counts = new Map();
    roster.readAll().forEach(item => {
      const key = String(item.region || '').trim() || '__unset__';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
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

  function filterRoster(list) {
    const keyword = String(state.rosterSearchKeyword || '').trim().toLowerCase();
    if (!keyword) return list;
    return list.filter(item => {
      const haystack = [
        item.driverName,
        item.baeminId,
        item.coupangId,
        item.phone,
        item.region
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  function updateSelectedHint() {
    const hint = $('payrollDailySettlementSelectedHint');
    const count = state.selectedIds.size;
    if (hint) hint.textContent = `선택 ${count}명`;
    const selectAll = $('payrollDailySettlementSelectAll');
    const visible = filterRoster(roster.readAll());
    if (selectAll && visible.length) {
      selectAll.checked = visible.every(item => state.selectedIds.has(item.id));
      selectAll.indeterminate = !selectAll.checked && visible.some(item => state.selectedIds.has(item.id));
    } else if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }
  }

  function renderRegionTags() {
    const wrap = $('payrollDailySettlementRegionTags');
    if (!wrap) return;
    const regions = getRegions();
    if (!regions.length) {
      wrap.innerHTML = '<p class="form-help">등록된 지역이 없습니다. 위에서 지역을 추가하세요.</p>';
      return;
    }
    wrap.innerHTML = regions.map(region => {
      const count = (roster.getByRegion?.(region) || []).length;
      return `
        <span class="payroll-daily-region-tag">
          <span>${escapeHtml(region)} <em>(${count}명)</em></span>
          <button type="button" class="payroll-daily-region-tag-remove" data-pds-remove-region="${escapeHtml(region)}" title="지역 삭제">×</button>
        </span>
      `;
    }).join('');
  }

  function renderRegionQuickPick() {
    const wrap = $('payrollDailySettlementRegionQuickPick');
    if (!wrap) return;
    const counts = countRidersByRegion();
    const chips = getRegions().map(region => {
      const active = state.settleRegion === region ? ' is-active' : '';
      const count = counts.get(region) || 0;
      return `<button type="button" class="payroll-daily-region-chip${active}" data-pds-pick-region="${escapeHtml(region)}">${escapeHtml(region)} <span>${count}</span></button>`;
    }).join('');
    const unsetCount = counts.get('__unset__') || 0;
    const allActive = state.settleRegion === '__all__' ? ' is-active' : '';
    const unsetActive = state.settleRegion === '__unset__' ? ' is-active' : '';
    wrap.innerHTML = [
      `<button type="button" class="payroll-daily-region-chip${allActive}" data-pds-pick-region="__all__">전체 <span>${roster.readAll().length}</span></button>`,
      `<button type="button" class="payroll-daily-region-chip${unsetActive}" data-pds-pick-region="__unset__">미지정 <span>${unsetCount}</span></button>`,
      chips
    ].join('');
  }

  function regionLabel(value) {
    if (value === '__all__') return '전체';
    if (value === '__unset__') return '미지정';
    return String(value || '').trim() || '미지정';
  }

  function renderRegionSettleView() {
    syncRegionSelects();
    renderRegionQuickPick();
    renderRegionTags();

    const region = state.settleRegion;
    const summary = $('payrollDailySettlementRegionSummary');
    const detailBtn = $('payrollDailySettlementRegionDetailBtn');
    const detailWrap = $('payrollDailySettlementRegionDetail');
    const detailTitle = $('payrollDailySettlementRegionDetailTitle');
    const detailCount = $('payrollDailySettlementRegionDetailCount');
    const detailBody = $('payrollDailySettlementRegionDetailBody');

    if (!region) {
      if (summary) summary.textContent = '지역을 선택하면 해당 기사 목록을 확인할 수 있습니다.';
      if (detailBtn) detailBtn.hidden = true;
      if (detailWrap) detailWrap.hidden = true;
      return;
    }

    const riders = roster.getByRegion?.(region) || [];
    const label = regionLabel(region);
    if (summary) summary.textContent = `${label} · ${riders.length}명 · 상세보기에서 전체 명단 확인`;
    if (detailBtn) {
      detailBtn.hidden = false;
      detailBtn.textContent = state.regionDetailOpen ? '상세 접기' : '상세보기';
    }

    if (detailTitle) detailTitle.textContent = `${label} 일정산 기사`;
    if (detailCount) detailCount.textContent = `총 ${riders.length}명`;

    if (detailBody) {
      if (!riders.length) {
        detailBody.innerHTML = '<tr><td colspan="6" class="empty">해당 지역에 등록된 기사가 없습니다.</td></tr>';
      } else {
        detailBody.innerHTML = riders.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td><strong>${escapeHtml(item.driverName || '-')}</strong></td>
            <td>${escapeHtml(item.baeminId || '-')}</td>
            <td>${escapeHtml(item.coupangId || '-')}</td>
            <td>${escapeHtml(item.phone || '-')}</td>
            <td>${escapeHtml(item.region || '미지정')}</td>
          </tr>
        `).join('');
      }
    }

    if (detailWrap) detailWrap.hidden = !state.regionDetailOpen;
  }

  function renderDriverPicker() {
    const body = $('payrollDailySettlementDriverBody');
    if (!body) return;

    const enrolled = roster.getEnrolledDriverIdSet();
    const drivers = filterDrivers(getDrivers()).slice(0, 500);

    if (!drivers.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">검색된 라이더가 없습니다.</td></tr>';
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

    const all = roster.readAll();
    const list = filterRoster(all);
    if (countEl) countEl.textContent = `${all.length}명 등록 · 표시 ${list.length}명`;

    if (!list.length) {
      body.innerHTML = `<tr><td colspan="8" class="empty">${all.length ? '검색 결과가 없습니다.' : '일정산 등록 기사가 없습니다. 라이더 검색에서 등록하거나 일괄등록을 사용하세요.'}</td></tr>`;
      updateSelectedHint();
      renderDriverPicker();
      renderRegionSettleView();
      return;
    }

    body.innerHTML = list.map(item => `
      <tr class="${state.selectedIds.has(item.id) ? 'is-selected' : ''}">
        <td><input type="checkbox" data-pds-select="${escapeHtml(item.id)}" ${state.selectedIds.has(item.id) ? 'checked' : ''}></td>
        <td>${escapeHtml(item.driverName || '-')}</td>
        <td>${escapeHtml(item.baeminId || '-')}</td>
        <td>${escapeHtml(item.coupangId || '-')}</td>
        <td>${escapeHtml(item.phone || '-')}</td>
        <td>
          <select class="payroll-region-select" data-pds-region-select="${escapeHtml(item.id)}">
            ${regionSelectOptions(item.region, { includeEmptyOption: true })}
          </select>
        </td>
        <td>${escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleString('ko-KR') : '-')}</td>
        <td>
          <button type="button" class="small-btn" data-pds-unenroll-roster="${escapeHtml(item.driverId)}" title="일정산 해제">해제</button>
          <button type="button" class="small-btn danger-btn" data-pds-delete="${escapeHtml(item.id)}">삭제</button>
        </td>
      </tr>
    `).join('');

    updateSelectedHint();
    renderDriverPicker();
    renderRegionSettleView();
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

  function refreshAll() {
    syncRegionSelects();
    renderRegionTags();
    renderRoster();
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
        showToast(`일괄등록 미리보기 ${matched}/${parsed.rows.length}건 매칭`);
      } catch (error) {
        console.error('[daily settlement bulk]', error);
        showToast('일괄등록 파일을 읽지 못했습니다.');
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
        refreshAll();
        refreshPayrollMatches();
        showToast(`일정산 ${result.added}명 추가 · Supabase 저장 · 총 ${roster.readAll().length}명`);
      } catch (error) {
        console.error('[daily settlement bulk apply]', error);
        showToast(error.message || '일괄등록 저장에 실패했습니다.');
      }
    })();
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
        refreshAll();
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
    const region = String($('payrollDailySettlementEnrollRegion')?.value || '').trim();
    void (async () => {
      try {
        await roster.commitEnrollDriver(driver, { region });
        refreshAll();
        refreshPayrollMatches();
        showToast(`${driver.name || '기사'} 일정산 등록${region ? ` · ${region}` : ''}`);
      } catch (error) {
        console.error('[daily settlement enroll]', error);
        showToast(error.message || '등록 저장에 실패했습니다.');
      }
    })();
  }

  function unenrollDriverById(driverId) {
    const id = String(driverId || '').trim();
    if (!id) return;
    void (async () => {
      try {
        await roster.commitUnenrollByDriverId(id);
        state.selectedIds.forEach(selId => {
          const row = roster.readAll().find(item => item.id === selId);
          if (!row) state.selectedIds.delete(selId);
        });
        refreshAll();
        refreshPayrollMatches();
        showToast('일정산 등록 해제 · Supabase 저장');
      } catch (error) {
        console.error('[daily settlement unenroll]', error);
        showToast(error.message || '해제 저장에 실패했습니다.');
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
        refreshAll();
        refreshPayrollMatches();
        showToast('선택 항목 삭제 · Supabase 저장');
      } catch (error) {
        console.error('[daily settlement delete selected]', error);
        showToast(error.message || '삭제 저장에 실패했습니다.');
      }
    })();
  }

  function applyBulkRegionChange() {
    const region = String($('payrollDailySettlementBulkRegion')?.value || '').trim();
    if (!state.selectedIds.size) {
      showToast('지역을 변경할 기사를 선택하세요.');
      return;
    }
    if (!region) {
      showToast('적용할 지역을 선택하세요.');
      return;
    }
    void (async () => {
      try {
        const selected = new Set(state.selectedIds);
        const list = roster.readAll().map(item => {
          if (!selected.has(item.id)) return item;
          return {
            ...item,
            region,
            updatedAt: new Date().toISOString()
          };
        });
        await roster.commitSaveAll(list);
        refreshAll();
        showToast(`선택 ${selected.size}명 → ${region} 지역 적용`);
      } catch (error) {
        console.error('[daily settlement bulk region]', error);
        showToast(error.message || '지역 일괄 변경에 실패했습니다.');
      }
    })();
  }

  function addRegionFromInput() {
    const input = $('payrollDailySettlementRegionNew');
    const name = String(input?.value || '').trim();
    if (!name) {
      showToast('지역 이름을 입력하세요.');
      return;
    }
    void (async () => {
      try {
        await roster.addRegion(name);
        if (input) input.value = '';
        refreshAll();
        showToast(`지역 "${name}" 추가 · Supabase 저장`);
      } catch (error) {
        console.error('[daily settlement add region]', error);
        showToast(error.message || '지역 추가에 실패했습니다.');
      }
    })();
  }

  function removeRegion(name) {
    const text = String(name || '').trim();
    if (!text) return;
    if (!window.confirm(`"${text}" 지역을 삭제할까요?\n해당 지역 기사는 미지정으로 바뀝니다.`)) return;
    void (async () => {
      try {
        await roster.removeRegion(text);
        if (state.settleRegion === text) {
          state.settleRegion = '';
          state.regionDetailOpen = false;
        }
        refreshAll();
        showToast(`지역 "${text}" 삭제 · Supabase 저장`);
      } catch (error) {
        console.error('[daily settlement remove region]', error);
        showToast(error.message || '지역 삭제에 실패했습니다.');
      }
    })();
  }

  function pickSettleRegion(region) {
    state.settleRegion = String(region || '').trim();
    state.regionDetailOpen = Boolean(state.settleRegion);
    const picker = $('payrollDailySettlementRegionPicker');
    if (picker && state.settleRegion) picker.value = state.settleRegion;
    renderRegionSettleView();
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
    $('payrollDailySettlementApplyBulkRegionBtn')?.addEventListener('click', applyBulkRegionChange);
    $('payrollDailySettlementRegionAddBtn')?.addEventListener('click', addRegionFromInput);
    $('payrollDailySettlementRegionNew')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addRegionFromInput();
      }
    });

    $('payrollDailySettlementDriverSearch')?.addEventListener('input', event => {
      state.driverSearchKeyword = String(event.target.value || '').trim();
      renderDriverPicker();
    });

    $('payrollDailySettlementRosterSearch')?.addEventListener('input', event => {
      state.rosterSearchKeyword = String(event.target.value || '').trim();
      renderRoster();
    });

    $('payrollDailySettlementSelectAll')?.addEventListener('change', event => {
      const checked = event.target.checked;
      filterRoster(roster.readAll()).forEach(item => {
        if (checked) state.selectedIds.add(item.id);
        else state.selectedIds.delete(item.id);
      });
      renderRoster();
    });

    $('payrollDailySettlementRegionPicker')?.addEventListener('change', event => {
      pickSettleRegion(event.target.value);
    });

    $('payrollDailySettlementRegionDetailBtn')?.addEventListener('click', () => {
      if (!state.settleRegion) return;
      state.regionDetailOpen = !state.regionDetailOpen;
      renderRegionSettleView();
    });

    $('payrollDailySettlementRegionTags')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-pds-remove-region]');
      if (!btn) return;
      removeRegion(btn.dataset.pdsRemoveRegion);
    });

    $('payrollDailySettlementRegionQuickPick')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-pds-pick-region]');
      if (!btn) return;
      pickSettleRegion(btn.dataset.pdsPickRegion);
    });

    $('payrollDailySettlementDriverBody')?.addEventListener('click', event => {
      const enrollBtn = event.target.closest('[data-pds-enroll-driver]');
      if (enrollBtn) {
        enrollDriverById(enrollBtn.dataset.pdsEnrollDriver);
        return;
      }
      const unenrollBtn = event.target.closest('[data-pds-unenroll-driver]');
      if (unenrollBtn) unenrollDriverById(unenrollBtn.dataset.pdsUnenrollDriver);
    });

    $('payrollDailySettlementBody')?.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-pds-select]');
      if (checkbox) {
        const id = checkbox.dataset.pdsSelect;
        if (checkbox.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateSelectedHint();
        checkbox.closest('tr')?.classList.toggle('is-selected', checkbox.checked);
        return;
      }
      const regionSelect = event.target.closest('[data-pds-region-select]');
      if (regionSelect) {
        saveRegion(regionSelect.dataset.pdsRegionSelect, regionSelect.value);
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
          refreshAll();
          refreshPayrollMatches();
          showToast('삭제 · Supabase 저장');
        } catch (error) {
          console.error('[daily settlement delete]', error);
          showToast(error.message || '삭제 저장에 실패했습니다.');
        }
      })();
    });
  }

  async function refreshAfterLoad() {
    try {
      await BremStorage?.ensureSectionLoaded?.('payroll-daily-settlement');
      await BremStorage?.payrollDailySettlement?.reloadFromServer?.();
    } catch (error) {
      console.warn('[payroll daily settlement]', error);
    }
    refreshAll();
  }

  bindEvents();
  void refreshAfterLoad();

  window.BremAdminPayrollDailySettlement = {
    refresh: refreshAfterLoad,
    getEnrolledDriverIdSet: () => roster.getEnrolledDriverIdSet(),
    getRegionByDriverId: driverId => roster.getRegionByDriverId(driverId)
  };
})();

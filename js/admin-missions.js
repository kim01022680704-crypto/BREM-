(function () {
  const catalog = () => window.BremMissionPromotionCatalog;
  if (!catalog()) return;

  const state = {
    assignmentSearch: '',
    assignmentPlatform: 'all',
    assignmentMissionFilter: 'all',
    drafts: new Map(),
    dirty: new Set()
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

  function formatDriverPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    return String(phone || '').trim() || '-';
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function platformLabel(platform) {
    return BremPlatforms.label(platform);
  }

  function getCoupangLoginId(driver) {
    if (window.BremDriverUtils?.makeDriverLoginId) {
      const id = window.BremDriverUtils.makeDriverLoginId(driver);
      return id || '-';
    }
    const name = String(driver?.name || '').replace(/\s/g, '');
    const phone = String(driver?.phone || '').replace(/\D/g, '').slice(-4);
    return name && phone ? `${name}${phone}` : '-';
  }

  function missionTitle(missionId) {
    const item = catalog().getById(missionId);
    return item?.title || '미선택';
  }

  function getSavedAssignment(driver) {
    return catalog().getDriverAssignment(driver);
  }

  function getDriverDraft(driver) {
    return state.drafts.get(driver.id) || getSavedAssignment(driver);
  }

  function isDriverAssignmentDirty(driverId) {
    const driver = BremStorage.drivers.getById(driverId);
    if (!driver) return false;
    const draft = getDriverDraft(driver);
    const saved = getSavedAssignment(driver);
    return draft.baemin !== saved.baemin || draft.coupang !== saved.coupang;
  }

  function syncDirtyState(driverId) {
    if (isDriverAssignmentDirty(driverId)) state.dirty.add(driverId);
    else state.dirty.delete(driverId);
  }

  let missionOptionsCache = { baemin: '', coupang: '', key: '' };

  function getMissionOptionsForPlatform(platform) {
    const items = catalog().getForPlatform(platform);
    const key = items.map(item => item.id).join('|');
    const cacheKey = `${platform}:${key}`;
    if (missionOptionsCache.key === cacheKey) {
      return platform === 'baemin' ? missionOptionsCache.baemin : missionOptionsCache.coupang;
    }
    const html = items.map(item => {
      const inactive = item.isActive === false ? ' (중지)' : '';
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}${inactive}</option>`;
    }).join('');
    if (platform === 'baemin') missionOptionsCache.baemin = html;
    else missionOptionsCache.coupang = html;
    missionOptionsCache.key = cacheKey;
    return html;
  }

  function invalidateMissionOptionsCache() {
    missionOptionsCache = { baemin: '', coupang: '', key: '' };
  }

  function missionOptions(platform, selectedId = '') {
    const template = getMissionOptionsForPlatform(platform);
    if (!selectedId) return template;
    const safeId = escapeHtml(selectedId);
    return template.replace(`value="${safeId}"`, `value="${safeId}" selected`);
  }

  function populateMissionFilterSelect() {
    const select = $('missionAssignmentMissionFilter');
    if (!select) return;
    const current = select.value || 'all';
    const items = catalog().getAll();
    select.innerHTML = [
      '<option value="all">전체</option>',
      '<option value="unset">미배정</option>',
      ...items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`)
    ].join('');
    if ([...select.options].some(option => option.value === current)) {
      select.value = current;
    } else {
      select.value = 'all';
      state.assignmentMissionFilter = 'all';
    }
  }

  function matchesAssignmentFilter(driver) {
    const query = state.assignmentSearch.trim().toLowerCase();
    if (query) {
      const name = String(driver.name || '').toLowerCase();
      const phone = String(driver.phone || '').replace(/\D/g, '');
      const baeminId = String(driver.baeminId || '').toLowerCase();
      const coupangId = getCoupangLoginId(driver).toLowerCase();
      const phoneQuery = query.replace(/\D/g, '');
      const matched = name.includes(query)
        || (phoneQuery && phone.includes(phoneQuery))
        || baeminId.includes(query)
        || coupangId.includes(query);
      if (!matched) return false;
    }

    if (state.assignmentPlatform === 'baemin') {
      if (!driver.platformBaemin) return false;
    } else if (state.assignmentPlatform === 'coupang') {
      if (driver.platformCoupang === false) return false;
    } else if (state.assignmentPlatform === 'both') {
      if (!driver.platformBaemin || driver.platformCoupang === false) return false;
    }

    const assignment = getSavedAssignment(driver);
    const draft = getDriverDraft(driver);
    const missionFilter = state.assignmentMissionFilter || 'all';
    if (missionFilter === 'unset') {
      const hasBaemin = driver.platformBaemin && (draft.baemin || assignment.baemin);
      const hasCoupang = driver.platformCoupang !== false && (draft.coupang || assignment.coupang);
      if (hasBaemin || hasCoupang) return false;
    } else if (missionFilter !== 'all') {
      const matchBaemin = draft.baemin === missionFilter || assignment.baemin === missionFilter;
      const matchCoupang = draft.coupang === missionFilter || assignment.coupang === missionFilter;
      if (!matchBaemin && !matchCoupang) return false;
    }

    return true;
  }

  function filteredAssignmentDrivers() {
    return BremStorage.drivers.getAll()
      .filter(matchesAssignmentFilter)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
  }

  function updateAssignmentSearchStatus() {
    const resultEl = $('missionAssignmentSearchResult');
    const clearBtn = $('missionAssignmentSearchClear');
    const drivers = filteredAssignmentDrivers();

    if (clearBtn) {
      clearBtn.hidden = !state.assignmentSearch
        && state.assignmentPlatform === 'all'
        && state.assignmentMissionFilter === 'all';
    }
    if (resultEl) {
      resultEl.textContent = `표시 ${drivers.length}명 · 아래 목록 스크롤`;
    }

    const saveAllBtn = $('missionAssignmentSaveAllBtn');
    if (saveAllBtn) {
      const dirtyCount = state.dirty.size;
      saveAllBtn.hidden = dirtyCount === 0;
      saveAllBtn.textContent = dirtyCount > 0 ? `변경사항 일괄 저장 (${dirtyCount}명)` : '변경사항 일괄 저장';
    }
  }

  async function saveDriverAssignment(driverId) {
    const driver = BremStorage.drivers.getById(driverId);
    if (!driver) throw new Error('기사를 찾을 수 없습니다.');

    const draft = getDriverDraft(driver);
    const saved = getSavedAssignment(driver);
    const changes = catalog().buildAssignmentPatch({
      baemin: draft.baemin !== saved.baemin ? draft.baemin : undefined,
      coupang: draft.coupang !== saved.coupang ? draft.coupang : undefined
    });

    if (!Object.keys(changes).length) {
      state.dirty.delete(driverId);
      state.drafts.delete(driverId);
      updateAssignmentSearchStatus();
      return;
    }

    await BremStorage.drivers.update(driverId, changes);
    state.drafts.delete(driverId);
    state.dirty.delete(driverId);
  }

  async function saveAllDirtyAssignments() {
    const ids = Array.from(state.dirty);
    if (!ids.length) return;

    const saveAllBtn = $('missionAssignmentSaveAllBtn');
    if (saveAllBtn) {
      saveAllBtn.disabled = true;
      saveAllBtn.textContent = '저장 중…';
    }

    try {
      const patches = ids.map(driverId => {
        const driver = BremStorage.drivers.getById(driverId);
        if (!driver) return null;
        const draft = getDriverDraft(driver);
        const saved = getSavedAssignment(driver);
        const changes = catalog().buildAssignmentPatch({
          baemin: draft.baemin !== saved.baemin ? draft.baemin : undefined,
          coupang: draft.coupang !== saved.coupang ? draft.coupang : undefined
        });
        if (!Object.keys(changes).length) return null;
        return { id: driverId, changes };
      }).filter(Boolean);

      if (patches.length) {
        await BremStorage.drivers.batchPatch(patches);
      }

      ids.forEach(id => {
        state.drafts.delete(id);
        state.dirty.delete(id);
      });

      showToast(`${patches.length || ids.length}명 미션 배정을 저장했습니다.`);
      renderDriverMissionAssignments();
    } catch (error) {
      showToast(error.message || '미션 배정 저장에 실패했습니다.');
      renderDriverMissionAssignments();
    } finally {
      if (saveAllBtn) saveAllBtn.disabled = false;
      updateAssignmentSearchStatus();
    }
  }

  function renderMissionCards() {
    const listEl = $('missionCatalogList');
    const countEl = $('missionCatalogCount');
    if (!listEl) return;

    const items = catalog().getAll();
    if (countEl) countEl.textContent = `${items.length}개`;

    listEl.innerHTML = items.map(item => `
      <div class="mission-catalog-item" data-mission-id="${escapeHtml(item.id)}">
        <div class="mission-catalog-item-head">
          <strong>${escapeHtml(item.title)}</strong>
          <span class="badge ${item.isActive ? 'badge--success' : 'badge--muted'}">
            ${platformLabel(item.platform)} · ${item.isActive ? '사용' : '중지'}
          </span>
        </div>
        <p class="mission-catalog-item-meta">${escapeHtml(item.conditions || item.description || '-')}</p>
      </div>
    `).join('') || '<p class="empty-state mission-catalog-empty">등록된 프로모션이 없습니다.</p>';
  }

  function missionHintHtml(missionId) {
    const id = String(missionId || '').trim();
    if (!id) return '';
    return `<span class="hint mission-selected-hint">${escapeHtml(missionTitle(id))}</span>`;
  }

  function platformBadgesHtml(driver) {
    const badges = [];
    if (driver.platformBaemin) badges.push('<span class="mission-platform-badge mission-platform-badge--baemin">배민</span>');
    if (driver.platformCoupang !== false) badges.push('<span class="mission-platform-badge mission-platform-badge--coupang">쿠팡</span>');
    return badges.length ? badges.join(' ') : '<span class="hint">-</span>';
  }

  function renderDriverMissionAssignments() {
    const rowsEl = $('missionDriverRows');
    if (!rowsEl) return;

    populateMissionFilterSelect();
    invalidateMissionOptionsCache();

    if (!BremStorage.drivers.getAll().length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">등록된 기사가 없습니다.</td></tr>';
      updateAssignmentSearchStatus();
      return;
    }

    const drivers = filteredAssignmentDrivers();
    updateAssignmentSearchStatus();

    if (!drivers.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">조건에 맞는 기사가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = drivers.map(driver => {
      const draft = getDriverDraft(driver);
      const isDirty = isDriverAssignmentDirty(driver.id);
      const baeminDisabled = !driver.platformBaemin ? ' disabled' : '';
      const coupangDisabled = driver.platformCoupang === false ? ' disabled' : '';

      return `
        <tr class="${isDirty ? 'mission-row-dirty' : ''}" data-driver-id="${escapeHtml(driver.id)}">
          <td class="mission-driver-cell">
            <div class="mission-driver-line">
              <strong class="mission-driver-name">${escapeHtml(driver.name)}</strong>
              <span class="mission-driver-phone">${escapeHtml(formatDriverPhone(driver.phone))}</span>
            </div>
          </td>
          <td class="mission-platform-cell">${platformBadgesHtml(driver)}</td>
          <td><code class="mission-id-code">${escapeHtml(driver.platformBaemin ? (driver.baeminId || '-') : '-')}</code></td>
          <td><code class="mission-id-code">${escapeHtml(driver.platformCoupang !== false ? getCoupangLoginId(driver) : '-')}</code></td>
          <td class="mission-select-cell">
            <select data-driver-mission-baemin="${escapeHtml(driver.id)}" class="inline-select"${baeminDisabled}>
              <option value="">배민 미션 미선택</option>
              ${missionOptions('baemin', draft.baemin)}
            </select>
            ${missionHintHtml(draft.baemin)}
          </td>
          <td class="mission-select-cell">
            <select data-driver-mission-coupang="${escapeHtml(driver.id)}" class="inline-select"${coupangDisabled}>
              <option value="">쿠팡 미션 미선택</option>
              ${missionOptions('coupang', draft.coupang)}
            </select>
            ${missionHintHtml(draft.coupang)}
          </td>
          <td>
            <button type="button" class="small-btn primary-btn" data-save-driver-mission="${escapeHtml(driver.id)}"${isDirty ? '' : ' disabled'}>저장</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function exportMissionAssignmentsToExcel() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }

    const rows = BremStorage.drivers.getAll().map(driver => {
      const assignment = getSavedAssignment(driver);
      return [
        driver.name || '',
        driver.phone || '',
        driver.baeminId || '',
        getCoupangLoginId(driver),
        missionTitle(assignment.baemin),
        missionTitle(assignment.coupang),
        assignment.baemin,
        assignment.coupang
      ];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ko'));

    const header = ['이름', '전화번호', '배민ID', '쿠팡ID', '배민 미션', '쿠팡 미션', '배민 미션 ID', '쿠팡 미션 ID'];
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기사별미션배정');
    XLSX.writeFile(workbook, `BREM_미션배정_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast(`${rows.length}명 미션 배정 엑셀 다운로드 완료`);
  }

  function renderMissionSection() {
    renderMissionCards();
    renderDriverMissionAssignments();
  }

  async function refresh(options = {}) {
    const force = options.force === true;
    state.drafts.clear();
    state.dirty.clear();

    try {
      await BremStorage.ensureSectionLoaded?.('mission-management', { force });
    } catch (error) {
      showToast(error.message || '데이터를 불러오지 못했습니다.');
    }

    renderMissionSection();
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('missionAssignmentExportBtn')?.addEventListener('click', () => {
      void exportMissionAssignmentsToExcel();
    });

    $('missionAssignmentSaveAllBtn')?.addEventListener('click', () => {
      void saveAllDirtyAssignments();
    });

    $('missionAssignmentSearch')?.addEventListener('input', event => {
      state.assignmentSearch = event.target.value;
      renderDriverMissionAssignments();
    });

    $('missionAssignmentPlatformFilter')?.addEventListener('change', event => {
      state.assignmentPlatform = event.target.value || 'all';
      renderDriverMissionAssignments();
    });

    $('missionAssignmentMissionFilter')?.addEventListener('change', event => {
      state.assignmentMissionFilter = event.target.value || 'all';
      renderDriverMissionAssignments();
    });

    $('missionAssignmentSearchClear')?.addEventListener('click', () => {
      state.assignmentSearch = '';
      state.assignmentPlatform = 'all';
      state.assignmentMissionFilter = 'all';
      const searchInput = $('missionAssignmentSearch');
      const platformSelect = $('missionAssignmentPlatformFilter');
      const missionSelect = $('missionAssignmentMissionFilter');
      if (searchInput) searchInput.value = '';
      if (platformSelect) platformSelect.value = 'all';
      if (missionSelect) missionSelect.value = 'all';
      renderDriverMissionAssignments();
    });

    $('missionDriverRows')?.addEventListener('change', event => {
      const baeminSelect = event.target.closest('[data-driver-mission-baemin]');
      const coupangSelect = event.target.closest('[data-driver-mission-coupang]');
      if (!baeminSelect && !coupangSelect) return;

      const driverId = baeminSelect?.dataset.driverMissionBaemin || coupangSelect?.dataset.driverMissionCoupang;
      const driver = BremStorage.drivers.getById(driverId);
      if (!driver) return;

      const current = getDriverDraft(driver);
      state.drafts.set(driverId, {
        baemin: baeminSelect ? baeminSelect.value : current.baemin,
        coupang: coupangSelect ? coupangSelect.value : current.coupang
      });
      syncDirtyState(driverId);
      updateAssignmentSearchStatus();
      const row = event.target.closest('tr[data-driver-id]');
      const saveBtn = row?.querySelector('[data-save-driver-mission]');
      if (saveBtn) saveBtn.disabled = !state.dirty.has(driverId);
      row?.classList.toggle('mission-row-dirty', state.dirty.has(driverId));
    });

    $('missionDriverRows')?.addEventListener('click', event => {
      const saveBtn = event.target.closest('[data-save-driver-mission]');
      if (!saveBtn) return;

      const driverId = saveBtn.dataset.saveDriverMission;
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중…';

      void saveDriverAssignment(driverId)
        .then(() => {
          showToast('미션 배정이 저장되었습니다.');
          renderDriverMissionAssignments();
        })
        .catch(error => {
          showToast(error.message || '미션 배정 저장에 실패했습니다.');
          renderDriverMissionAssignments();
        });
    });

    document.addEventListener('brem-cache-status-changed', () => {
      if (document.getElementById('mission-management')?.classList.contains('active')) {
        invalidateMissionOptionsCache();
        renderMissionSection();
      }
    });
  }

  bindEvents();
  window.BremAdminMissions = { refresh, render: renderMissionSection };
})();

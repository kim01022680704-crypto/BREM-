(function () {
  const catalog = () => window.BremMissionPromotionCatalog;
  if (!catalog()) return;

  const PAGE_SIZE = 80;

  const state = {
    assignmentSearch: '',
    assignmentPlatform: 'all',
    assignmentMissionFilter: 'all',
    assignmentLockFilter: 'all',
    drafts: new Map(),
    dirty: new Set(),
    renderLimit: PAGE_SIZE,
    lastRenderedCount: 0
  };

  const MISSION_PLACEHOLDER = {
    baemin: '배민 미션 미선택',
    coupang: '쿠팡 미션 미선택',
    combined: '합산 미션 미선택'
  };

  let driverSearchIndex = null;
  let missionTitleCache = new Map();
  let missionSectionRenderTimer = null;
  let missionSaveCooldownUntil = 0;

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
    const id = String(missionId || '').trim();
    if (!id) return '미선택';
    if (missionTitleCache.has(id)) return missionTitleCache.get(id);
    const title = catalog().getById(id)?.title || '미선택';
    missionTitleCache.set(id, title);
    return title;
  }

  function invalidateMissionTitleCache() {
    missionTitleCache = new Map();
  }

  function invalidateDriverSearchIndex() {
    driverSearchIndex = null;
  }

  /** 검색 인덱스는 기사 스냅샷을 들고 있어 미션 저장 후 stale 될 수 있다. */
  function resolveDriver(driverOrId) {
    if (!driverOrId) return null;
    const id = typeof driverOrId === 'object' ? driverOrId.id : driverOrId;
    if (!id) return typeof driverOrId === 'object' ? driverOrId : null;
    return BremStorage.drivers.getById(id) || (typeof driverOrId === 'object' ? driverOrId : null);
  }

  function buildDriverSearchIndex() {
    driverSearchIndex = BremStorage.drivers.getAll().map(driver => {
      const coupangId = getCoupangLoginId(driver);
      return {
        driver,
        nameLower: String(driver.name || '').toLowerCase(),
        phoneDigits: String(driver.phone || '').replace(/\D/g, ''),
        baeminIdLower: String(driver.baeminId || '').toLowerCase(),
        coupangIdLower: String(coupangId || '').toLowerCase()
      };
    });
  }

  function getSavedAssignment(driver) {
    return catalog().getDriverAssignment(resolveDriver(driver));
  }

  function getDriverDraft(driver) {
    const fresh = resolveDriver(driver);
    if (!fresh) return catalog().normalizeAssignmentDraft({});
    const raw = state.drafts.get(fresh.id) || getSavedAssignment(fresh);
    return catalog().normalizeAssignmentDraft(raw);
  }

  function isDriverAssignmentDirty(driverId) {
    const driver = BremStorage.drivers.getById(driverId);
    if (!driver) return false;
    const draft = getDriverDraft(driver);
    const saved = getSavedAssignment(driver);
    return draft.baemin !== saved.baemin
      || draft.coupang !== saved.coupang
      || draft.combined !== saved.combined;
  }

  function syncDirtyState(driverId) {
    if (isDriverAssignmentDirty(driverId)) state.dirty.add(driverId);
    else state.dirty.delete(driverId);
  }

  function applyDraftToRow(row, draft) {
    if (!row) return;
    const pairs = [
      ['baemin', draft.baemin],
      ['coupang', draft.coupang],
      ['combined', draft.combined]
    ];
    pairs.forEach(([platform, missionId]) => {
      const select = row.querySelector(`[data-driver-mission-${platform}]`);
      if (!select) return;
      setMissionSelectValue(select, platform, missionId || '');
    });
  }

  function commitDriverAssignmentDraft(driverId, partialDraft) {
    const driver = BremStorage.drivers.getById(driverId);
    if (!driver) return null;

    const current = getDriverDraft(driver);
    const next = catalog().normalizeAssignmentDraft({
      baemin: partialDraft.baemin !== undefined ? partialDraft.baemin : current.baemin,
      coupang: partialDraft.coupang !== undefined ? partialDraft.coupang : current.coupang,
      combined: partialDraft.combined !== undefined ? partialDraft.combined : current.combined
    });
    state.drafts.set(driverId, next);
    syncDirtyState(driverId);
    return next;
  }

  let missionOptionsCache = { baemin: '', coupang: '', combined: '', key: '' };

  function getMissionOptionsForPlatform(platform) {
    const items = catalog().getForPlatform(platform);
    const key = items.map(item => item.id).join('|');
    const cacheKey = `${platform}:${key}`;
    if (missionOptionsCache.key === cacheKey) {
      if (platform === 'baemin') return missionOptionsCache.baemin;
      if (platform === 'coupang') return missionOptionsCache.coupang;
      return missionOptionsCache.combined;
    }
    const html = items.map(item => {
      const inactive = item.isActive === false ? ' (중지)' : '';
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}${inactive}</option>`;
    }).join('');
    if (platform === 'baemin') missionOptionsCache.baemin = html;
    else if (platform === 'coupang') missionOptionsCache.coupang = html;
    else missionOptionsCache.combined = html;
    missionOptionsCache.key = cacheKey;
    return html;
  }

  function invalidateMissionOptionsCache() {
    missionOptionsCache = { baemin: '', coupang: '', combined: '', key: '' };
    invalidateMissionTitleCache();
  }

  function missionOptionsFromTemplate(template, selectedId = '') {
    if (!selectedId) return template;
    const safeId = escapeHtml(selectedId);
    return template.replace(`value="${safeId}"`, `value="${safeId}" selected`);
  }

  function missionSelectInitialHtml(platform, selectedId = '') {
    const placeholder = MISSION_PLACEHOLDER[platform] || '미션 미선택';
    const id = String(selectedId || '').trim();
    if (!id) {
      return `<option value="">${placeholder}</option>`;
    }
    return `<option value="">${placeholder}</option><option value="${escapeHtml(id)}" selected>${escapeHtml(missionTitle(id))}</option>`;
  }

  function populateMissionSelectOptions(select, platform, selectedId = '') {
    const placeholder = MISSION_PLACEHOLDER[platform] || '미션 미선택';
    const template = getMissionOptionsForPlatform(platform);
    select.innerHTML = `<option value="">${placeholder}</option>${missionOptionsFromTemplate(template, selectedId)}`;
    select.dataset.optionsLoaded = '1';
  }

  function setMissionSelectValue(select, platform, selectedId = '') {
    const id = String(selectedId || '').trim();
    if (select.dataset.optionsLoaded === '1') {
      select.value = id;
      if (select.value !== id && id) {
        select.insertAdjacentHTML(
          'beforeend',
          `<option value="${escapeHtml(id)}" selected>${escapeHtml(missionTitle(id))}</option>`
        );
      }
      return;
    }
    select.innerHTML = missionSelectInitialHtml(platform, id);
    select.dataset.optionsLoaded = '0';
  }

  function ensureMissionSelectOptions(select) {
    if (!select || select.dataset.optionsLoaded === '1') return;
    const platform = select.dataset.missionPlatform || '';
    if (!platform) return;
    populateMissionSelectOptions(select, platform, select.value || '');
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

  function matchesAssignmentFilter(entry) {
    const driver = resolveDriver(entry.driver);
    if (!driver) return false;
    const query = state.assignmentSearch.trim().toLowerCase();
    if (query) {
      const phoneQuery = query.replace(/\D/g, '');
      const matched = entry.nameLower.includes(query)
        || (phoneQuery && entry.phoneDigits.includes(phoneQuery))
        || entry.baeminIdLower.includes(query)
        || entry.coupangIdLower.includes(query);
      if (!matched) return false;
    }

    if (state.assignmentPlatform === 'baemin') {
      if (!driver.platformBaemin) return false;
    } else if (state.assignmentPlatform === 'coupang') {
      if (driver.platformCoupang === false) return false;
    } else if (state.assignmentPlatform === 'both' || state.assignmentPlatform === 'combined') {
      if (!driver.platformBaemin || driver.platformCoupang === false) return false;
    }

    const assignment = getSavedAssignment(driver);
    const draft = getDriverDraft(driver);
    const missionFilter = state.assignmentMissionFilter || 'all';
    if (missionFilter === 'unset') {
      const hasBaemin = driver.platformBaemin && (draft.baemin || assignment.baemin);
      const hasCoupang = driver.platformCoupang !== false && (draft.coupang || assignment.coupang);
      const hasCombined = (draft.combined || assignment.combined);
      if (hasBaemin || hasCoupang || hasCombined) return false;
    } else if (missionFilter !== 'all') {
      const matchBaemin = draft.baemin === missionFilter || assignment.baemin === missionFilter;
      const matchCoupang = draft.coupang === missionFilter || assignment.coupang === missionFilter;
      const matchCombined = draft.combined === missionFilter || assignment.combined === missionFilter;
      if (!matchBaemin && !matchCoupang && !matchCombined) return false;
    }

    const locked = catalog().isAssignmentLocked?.(driver) || Boolean(driver.missionAssignmentLocked);
    if (state.assignmentLockFilter === 'locked' && !locked) return false;
    if (state.assignmentLockFilter === 'unlocked' && locked) return false;

    return true;
  }

  function countFilteredDrivers() {
    if (!driverSearchIndex) buildDriverSearchIndex();
    return driverSearchIndex.filter(matchesAssignmentFilter).length;
  }

  function updateAssignmentSearchStatus(visibleCount, filteredCount) {
    const resultEl = $('missionAssignmentSearchResult');
    const clearBtn = $('missionAssignmentSearchClear');
    const total = Number.isFinite(filteredCount) ? filteredCount : countFilteredDrivers();
    const count = Number.isFinite(visibleCount) ? visibleCount : Math.min(state.renderLimit, total);

    if (clearBtn) {
      clearBtn.hidden = !state.assignmentSearch
        && state.assignmentPlatform === 'all'
        && state.assignmentMissionFilter === 'all'
        && state.assignmentLockFilter === 'all';
    }
    if (resultEl) {
      resultEl.textContent = total > count
        ? `표시 ${count} / ${total}명 · 스크롤하면 더 불러옵니다`
        : `표시 ${total}명 · 아래 목록 스크롤`;
    }

    const saveAllBtn = $('missionAssignmentSaveAllBtn');
    if (saveAllBtn) {
      const dirtyCount = state.dirty.size;
      saveAllBtn.hidden = dirtyCount === 0;
      saveAllBtn.textContent = dirtyCount > 0 ? `변경사항 일괄 저장 (${dirtyCount}명)` : '변경사항 일괄 저장';
    }
  }

  function applyAssignmentRowVisibility() {
    state.renderLimit = PAGE_SIZE;
    renderDriverMissionAssignmentRows();
  }

  function updateLoadMore(filteredCount) {
    const bar = $('missionAssignmentLoadMore');
    if (!bar) return;
    const remaining = Math.max(0, Number(filteredCount || 0) - state.renderLimit);
    if (remaining <= 0) {
      bar.hidden = true;
      bar.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.textContent = `더 보기 ${Math.min(PAGE_SIZE, remaining)}명 · ${state.renderLimit} / ${filteredCount}명`;
  }

  function loadMoreAssignments() {
    const filteredCount = countFilteredDrivers();
    if (state.renderLimit >= filteredCount) return;
    const wrap = document.querySelector('#mission-management .mission-assignment-table-wrap');
    const scrollTop = wrap?.scrollTop || 0;
    state.renderLimit += PAGE_SIZE;
    renderDriverMissionAssignmentRows();
    if (wrap) wrap.scrollTop = scrollTop;
  }

  async function saveDriverAssignment(driverId) {
    return persistDriverAssignment(driverId);
  }

  function refreshSavedAssignmentRow(driverId) {
    const driver = resolveDriver(driverId);
    const row = document.querySelector(`tr[data-driver-id="${driverId}"]`);
    if (!driver || !row) {
      renderDriverMissionAssignments();
      return;
    }
    applyDraftToRow(row, catalog().normalizeAssignmentDraft(catalog().getDriverAssignment(driver)));
    const saveBtn = row.querySelector('[data-save-driver-mission]');
    if (saveBtn) saveBtn.disabled = true;
    row.classList.remove('mission-row-dirty');
    updateAssignmentSearchStatus();
  }

  async function persistDriverAssignment(driverId) {
    const driver = BremStorage.drivers.getById(driverId);
    if (!driver) throw new Error('기사를 찾을 수 없습니다.');

    const draft = catalog().normalizeAssignmentDraft(getDriverDraft(driver));
    const saved = getSavedAssignment(driver);
    if (draft.baemin === saved.baemin
      && draft.coupang === saved.coupang
      && draft.combined === saved.combined) {
      state.dirty.delete(driverId);
      state.drafts.delete(driverId);
      updateAssignmentSearchStatus();
      return { saved: false };
    }

    const changes = catalog().buildAssignmentPatch(draft);
    if (draft.coupang && !changes.selectedMissionIdCoupang) {
      throw new Error('쿠팡 미션이 저장되지 않았습니다. 쿠팡 탭 프로모션인지 확인한 뒤 다시 선택하세요.');
    }
    if (draft.baemin && !changes.selectedMissionIdBaemin) {
      throw new Error('배민 미션이 저장되지 않았습니다. 배민 탭 프로모션인지 확인한 뒤 다시 선택하세요.');
    }
    const result = await BremStorage.drivers.batchPatch([{ id: driverId, changes }]);
    state.drafts.delete(driverId);
    state.dirty.delete(driverId);
    invalidateDriverSearchIndex();
    missionSaveCooldownUntil = Date.now() + 2500;
    return { saved: true, warning: result?.warning || '' };
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
        const draft = catalog().normalizeAssignmentDraft(getDriverDraft(driver));
        const saved = getSavedAssignment(driver);
        if (draft.baemin === saved.baemin
          && draft.coupang === saved.coupang
          && draft.combined === saved.combined) {
          return null;
        }
        return { id: driverId, changes: catalog().buildAssignmentPatch(draft) };
      }).filter(Boolean);

      if (patches.length) {
        const result = await window.BremPerf.runSave('missions.assignments.bulk', {
          write: () => BremStorage.drivers.batchPatch(patches),
          render: () => {
            ids.forEach(id => {
              state.drafts.delete(id);
              state.dirty.delete(id);
            });
            invalidateDriverSearchIndex();
            renderDriverMissionAssignmentRows();
          }
        });
        if (result?.warning) {
          showToast(result.warning);
        } else {
          showToast(`${patches.length || ids.length}명 미션 배정을 저장했습니다.`);
        }
      } else {
        ids.forEach(id => {
          state.drafts.delete(id);
          state.dirty.delete(id);
        });
        renderDriverMissionAssignmentRows();
      }
    } catch (error) {
      showToast(error.message || '미션 배정 저장에 실패했습니다.');
      renderDriverMissionAssignmentRows();
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

  function platformBadgesHtml(driver) {
    const badges = [];
    if (driver.platformBaemin) badges.push('<span class="mission-platform-badge mission-platform-badge--baemin">배민</span>');
    if (driver.platformCoupang !== false) badges.push('<span class="mission-platform-badge mission-platform-badge--coupang">쿠팡</span>');
    return badges.length ? badges.join(' ') : '<span class="hint">-</span>';
  }

  function renderDriverMissionAssignmentRows() {
    const rowsEl = $('missionDriverRows');
    if (!rowsEl) return;

    const allCount = BremStorage.drivers.getAll().length;
    state.lastRenderedCount = allCount;
    if (!allCount) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="empty">등록된 기사가 없습니다.</td></tr>';
      updateAssignmentSearchStatus(0, 0);
      updateLoadMore(0);
      return;
    }

    if (!driverSearchIndex) buildDriverSearchIndex();
    const drivers = driverSearchIndex
      .filter(matchesAssignmentFilter)
      .map(entry => resolveDriver(entry.driver))
      .filter(Boolean)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
    const visible = drivers.slice(0, state.renderLimit);

    if (!visible.length) {
      rowsEl.innerHTML = '<tr class="mission-assignment-empty"><td colspan="9" class="empty">조건에 맞는 기사가 없습니다.</td></tr>';
      updateAssignmentSearchStatus(0, drivers.length);
      updateLoadMore(drivers.length);
      return;
    }

    rowsEl.innerHTML = visible.map(driver => {
      const draft = getDriverDraft(driver);
      const isDirty = isDriverAssignmentDirty(driver.id);
      const baeminDisabled = !driver.platformBaemin ? ' disabled' : '';
      const coupangDisabled = driver.platformCoupang === false ? ' disabled' : '';
      const combinedDisabled = (!driver.platformBaemin || driver.platformCoupang === false) ? ' disabled' : '';
      const coupangLoginId = getCoupangLoginId(driver);
      const locked = catalog().isAssignmentLocked?.(driver) || Boolean(driver.missionAssignmentLocked);

      return `
        <tr class="${isDirty ? 'mission-row-dirty' : ''}${locked ? ' is-mission-locked' : ''}" data-driver-id="${escapeHtml(driver.id)}">
          <td class="mission-driver-cell">
            <div class="mission-driver-line">
              <strong class="mission-driver-name">${escapeHtml(driver.name)}</strong>
              <span class="mission-driver-phone">${escapeHtml(formatDriverPhone(driver.phone))}</span>
            </div>
          </td>
          <td class="mission-platform-cell">${platformBadgesHtml(driver)}</td>
          <td><code class="mission-id-code">${escapeHtml(driver.platformBaemin ? (driver.baeminId || '-') : '-')}</code></td>
          <td><code class="mission-id-code">${escapeHtml(driver.platformCoupang !== false ? coupangLoginId : '-')}</code></td>
          <td class="mission-select-cell">
            <select data-driver-mission-baemin="${escapeHtml(driver.id)}" data-mission-platform="baemin" data-options-loaded="0" class="inline-select"${baeminDisabled}>
              ${missionSelectInitialHtml('baemin', draft.baemin)}
            </select>
          </td>
          <td class="mission-select-cell">
            <select data-driver-mission-coupang="${escapeHtml(driver.id)}" data-mission-platform="coupang" data-options-loaded="0" class="inline-select"${coupangDisabled}>
              ${missionSelectInitialHtml('coupang', draft.coupang)}
            </select>
          </td>
          <td class="mission-select-cell">
            <select data-driver-mission-combined="${escapeHtml(driver.id)}" data-mission-platform="combined" data-options-loaded="0" class="inline-select"${combinedDisabled}>
              ${missionSelectInitialHtml('combined', draft.combined)}
            </select>
          </td>
          <td>
            <button type="button" class="small-btn ${locked ? 'primary-btn' : ''}" data-lock-driver-mission="${escapeHtml(driver.id)}">${locked ? '잠금 해제' : '잠금'}</button>
          </td>
          <td>
            <button type="button" class="small-btn primary-btn" data-save-driver-mission="${escapeHtml(driver.id)}"${isDirty ? '' : ' disabled'}>저장</button>
          </td>
        </tr>
      `;
    }).join('');

    updateAssignmentSearchStatus(visible.length, drivers.length);
    updateLoadMore(drivers.length);
  }

  function renderDriverMissionAssignments() {
    renderDriverMissionAssignmentRows();
  }

  async function exportMissionAssignmentsToExcel() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }

    try {
      await BremStorage.awaitDriversFullyLoaded?.();
    } catch (error) {
      console.warn('[BREM] Mission assignment export waited for riders:', error?.message || error);
    }

    const rows = BremStorage.drivers.getAll().map(driver => {
      const assignment = catalog().normalizeAssignmentDraft(getSavedAssignment(driver));
      return [
        driver.name || '',
        driver.phone || '',
        driver.baeminId || '',
        getCoupangLoginId(driver),
        missionTitle(assignment.baemin),
        missionTitle(assignment.coupang),
        missionTitle(assignment.combined),
        assignment.baemin,
        assignment.coupang,
        assignment.combined
      ];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ko'));

    const header = ['이름', '전화번호', '배민ID', '쿠팡ID', '배민 미션', '쿠팡 미션', '합산 미션', '배민 미션 ID', '쿠팡 미션 ID', '합산 미션 ID'];
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기사별미션배정');
    XLSX.writeFile(workbook, `BREM_미션배정_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast(`${rows.length}명 미션 배정 엑셀 다운로드 완료`);
  }

  function renderMissionSection() {
    populateMissionFilterSelect();
    invalidateMissionOptionsCache();
    invalidateDriverSearchIndex();
    renderMissionCards();
    renderDriverMissionAssignmentRows();
  }

  async function refresh(options = {}) {
    const force = options.force === true;
    if (force) {
      state.drafts.clear();
      state.dirty.clear();
    }
    state.renderLimit = PAGE_SIZE;
    invalidateDriverSearchIndex();

    try {
      await BremStorage.ensureSectionLoaded?.('mission-management', { force: false, forceDrivers: force });
    } catch (error) {
      showToast(error.message || '데이터를 불러오지 못했습니다.');
    }

    renderMissionSection();
  }

  const debouncedAssignmentSearchFilter = window.BremPerf?.debounce
    ? window.BremPerf.debounce(() => applyAssignmentRowVisibility(), 100)
    : () => applyAssignmentRowVisibility();

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
      debouncedAssignmentSearchFilter();
    });

    $('missionAssignmentPlatformFilter')?.addEventListener('change', event => {
      state.assignmentPlatform = event.target.value || 'all';
      applyAssignmentRowVisibility();
    });

    $('missionAssignmentMissionFilter')?.addEventListener('change', event => {
      state.assignmentMissionFilter = event.target.value || 'all';
      applyAssignmentRowVisibility();
    });

    $('missionAssignmentLockFilter')?.addEventListener('change', event => {
      state.assignmentLockFilter = event.target.value || 'all';
      applyAssignmentRowVisibility();
    });

    $('missionAssignmentSearchClear')?.addEventListener('click', () => {
      state.assignmentSearch = '';
      state.assignmentPlatform = 'all';
      state.assignmentMissionFilter = 'all';
      state.assignmentLockFilter = 'all';
      const searchInput = $('missionAssignmentSearch');
      const platformSelect = $('missionAssignmentPlatformFilter');
      const missionSelect = $('missionAssignmentMissionFilter');
      const lockSelect = $('missionAssignmentLockFilter');
      if (searchInput) searchInput.value = '';
      if (platformSelect) platformSelect.value = 'all';
      if (missionSelect) missionSelect.value = 'all';
      if (lockSelect) lockSelect.value = 'all';
      applyAssignmentRowVisibility();
    });

    $('missionDriverRows')?.addEventListener('focusin', event => {
      const select = event.target.closest('[data-driver-mission-baemin], [data-driver-mission-coupang], [data-driver-mission-combined]');
      if (!select) return;
      ensureMissionSelectOptions(select);
    });

    $('missionDriverRows')?.addEventListener('change', event => {
      const baeminSelect = event.target.closest('[data-driver-mission-baemin]');
      const coupangSelect = event.target.closest('[data-driver-mission-coupang]');
      const combinedSelect = event.target.closest('[data-driver-mission-combined]');
      if (!baeminSelect && !coupangSelect && !combinedSelect) return;

      const driverId = baeminSelect?.dataset.driverMissionBaemin
        || coupangSelect?.dataset.driverMissionCoupang
        || combinedSelect?.dataset.driverMissionCombined;

      const next = commitDriverAssignmentDraft(driverId, {
        baemin: baeminSelect ? baeminSelect.value : undefined,
        coupang: coupangSelect ? coupangSelect.value : undefined,
        combined: combinedSelect ? combinedSelect.value : undefined
      });
      if (!next) return;

      const row = event.target.closest('tr[data-driver-id]');
      applyDraftToRow(row, next);
      const saveBtn = row?.querySelector('[data-save-driver-mission]');
      if (saveBtn) saveBtn.disabled = !state.dirty.has(driverId);
      row?.classList.toggle('mission-row-dirty', state.dirty.has(driverId));
    });

    $('missionDriverRows')?.addEventListener('click', event => {
      const lockBtn = event.target.closest('[data-lock-driver-mission]');
      if (lockBtn) {
        const driverId = lockBtn.dataset.lockDriverMission;
        const driver = BremStorage.drivers.getById(driverId);
        if (!driver) return;
        const next = !(catalog().isAssignmentLocked?.(driver) || Boolean(driver.missionAssignmentLocked));
        lockBtn.disabled = true;
        void BremStorage.drivers.batchPatch([{ id: driverId, changes: { missionAssignmentLocked: next } }])
          .then(() => {
            invalidateDriverSearchIndex();
            renderDriverMissionAssignmentRows();
            showToast(next ? `${driver.name} 미션을 잠갔습니다.` : `${driver.name} 잠금을 해제했습니다.`);
          })
          .catch(error => {
            showToast(error.message || '잠금 저장에 실패했습니다.');
          });
        return;
      }

      const saveBtn = event.target.closest('[data-save-driver-mission]');
      if (!saveBtn) return;

      const driverId = saveBtn.dataset.saveDriverMission;
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중…';

      void saveDriverAssignment(driverId)
        .then((result) => {
          invalidateDriverSearchIndex();
          refreshSavedAssignmentRow(driverId);
          if (result?.warning) {
            showToast(result.warning);
          } else if (result?.saved !== false) {
            showToast('미션 배정이 저장되었습니다.');
          }
        })
        .catch(error => {
          showToast(error.message || '미션 배정 저장에 실패했습니다.');
          refreshSavedAssignmentRow(driverId);
        })
        .finally(() => {
          const row = document.querySelector(`tr[data-driver-id="${driverId}"]`);
          const btn = row?.querySelector('[data-save-driver-mission]') || saveBtn;
          btn.disabled = !state.dirty.has(driverId);
          btn.textContent = '저장';
        });
    });

    document.addEventListener('brem-cache-status-changed', () => {
      const section = document.getElementById('mission-management');
      if (!section?.classList.contains('active') && !section?.classList.contains('is-active')) return;
      if (state.dirty.size) return;
      if (Date.now() < missionSaveCooldownUntil) return;
      const count = BremStorage.drivers.getAll().length;
      if (count === state.lastRenderedCount && $('missionDriverRows')?.querySelector('tr[data-driver-id]')) {
        return;
      }
      clearTimeout(missionSectionRenderTimer);
      missionSectionRenderTimer = setTimeout(() => {
        if (state.dirty.size) return;
        if (Date.now() < missionSaveCooldownUntil) return;
        invalidateDriverSearchIndex();
        renderMissionSection();
      }, 800);
    });

    const tableWrap = document.querySelector('#mission-management .mission-assignment-table-wrap');
    if (tableWrap && !tableWrap.dataset.missionScrollBound) {
      tableWrap.dataset.missionScrollBound = '1';
      tableWrap.addEventListener('scroll', () => {
        if (tableWrap.scrollTop + tableWrap.clientHeight < tableWrap.scrollHeight - 120) return;
        loadMoreAssignments();
      }, { passive: true });
    }

    $('missionAssignmentLoadMore')?.addEventListener('click', () => {
      loadMoreAssignments();
    });

    window.addEventListener('beforeunload', event => {
      if (!state.dirty.size) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  bindEvents();
  window.BremAdminMissions = { refresh, render: renderMissionSection };
})();

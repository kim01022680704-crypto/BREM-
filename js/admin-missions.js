(function () {
  const missionsApi = BremStorage.missions;
  if (!missionsApi) return;

  const MISSION_MAX = missionsApi.maxCount || 4;
  const state = {
    editingId: '',
    tableReady: null,
    assignmentSearch: '',
    assignmentPlatform: 'all',
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

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function formatMissionError(error) {
    const message = String(error?.message || error || '');
    if (/could not find the table.*missions|relation.*missions.*does not exist|TABLE_MISSING/i.test(message)) {
      return 'public.missions 테이블이 없습니다. Supabase SQL Editor에서 supabase/missions_migration.sql 전체를 실행하세요.';
    }
    return message || '미션 데이터를 불러오지 못했습니다.';
  }

  async function updateSetupBanner() {
    const banner = $('missionSetupBanner');
    if (!banner || !BremStorage.getMissionsTableStatus) return;

    try {
      const status = await BremStorage.getMissionsTableStatus();
      if (status.ok && status.tableExists === false) {
        state.tableReady = false;
        banner.hidden = false;
        return;
      }
      if (status.ok && status.tableExists === true) {
        state.tableReady = true;
        banner.hidden = true;
        return;
      }
      state.tableReady = null;
      banner.hidden = true;
    } catch {
      state.tableReady = null;
      banner.hidden = true;
    }
  }

  function missionOptions(selectedId = '') {
    return missionsApi.getAll().map(mission => {
      const selected = mission.id === selectedId ? ' selected' : '';
      const label = mission.isActive === false ? `${mission.title} (기사앱 미노출)` : mission.title;
      return `<option value="${escapeHtml(mission.id)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  function missionTitle(missionId) {
    const mission = missionsApi.getById(missionId);
    return mission?.title || '미선택';
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

  function getSavedAssignment(driver) {
    return {
      baemin: String(driver.selectedMissionIdBaemin || driver.selectedMissionId || '').trim(),
      coupang: String(driver.selectedMissionIdCoupang || driver.selectedMissionId || '').trim()
    };
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

  function missionHintHtml(missionId) {
    const id = String(missionId || '').trim();
    if (!id) return '';
    return `<span class="hint mission-selected-hint">${escapeHtml(missionTitle(id))} · ${missionExposure(id)}</span>`;
  }

  function platformBadgesHtml(driver) {
    const badges = [];
    if (driver.platformBaemin) {
      badges.push('<span class="mission-platform-badge mission-platform-badge--baemin">배민</span>');
    }
    if (driver.platformCoupang !== false) {
      badges.push('<span class="mission-platform-badge mission-platform-badge--coupang">쿠팡</span>');
    }
    return badges.length ? badges.join(' ') : '<span class="hint">-</span>';
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

    if (state.assignmentPlatform === 'baemin') return Boolean(driver.platformBaemin);
    if (state.assignmentPlatform === 'coupang') return driver.platformCoupang !== false;
    if (state.assignmentPlatform === 'both') {
      return Boolean(driver.platformBaemin) && driver.platformCoupang !== false;
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
    const query = state.assignmentSearch.trim();

    if (clearBtn) clearBtn.hidden = !query && state.assignmentPlatform === 'all';
    if (resultEl) {
      if (!query && state.assignmentPlatform === 'all') {
        resultEl.textContent = `전체 기사 ${drivers.length}명 · 아래 목록 스크롤`;
      } else {
        resultEl.textContent = `검색 결과 ${drivers.length}명 · 아래 목록 스크롤`;
      }
    }

    const saveAllBtn = $('missionAssignmentSaveAllBtn');
    if (saveAllBtn) {
      const dirtyCount = state.dirty.size;
      saveAllBtn.hidden = dirtyCount === 0;
      saveAllBtn.textContent = dirtyCount > 0 ? `변경사항 일괄 저장 (${dirtyCount}명)` : '변경사항 일괄 저장';
    }
  }

  function resetAssignmentDrafts() {
    state.drafts.clear();
    state.dirty.clear();
  }

  async function saveDriverAssignment(driverId) {
    const driver = BremStorage.drivers.getById(driverId);
    if (!driver) throw new Error('기사를 찾을 수 없습니다.');

    const draft = getDriverDraft(driver);
    const saved = getSavedAssignment(driver);
    const changes = {};
    if (draft.baemin !== saved.baemin) changes.selectedMissionIdBaemin = draft.baemin;
    if (draft.coupang !== saved.coupang) changes.selectedMissionIdCoupang = draft.coupang;

    if (!Object.keys(changes).length) {
      state.dirty.delete(driverId);
      state.drafts.delete(driverId);
      updateAssignmentSearchStatus();
      return;
    }

    await BremStorage.drivers.update(driverId, changes);
    await BremStorage.flushStorage?.();
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
      for (const driverId of ids) {
        await saveDriverAssignment(driverId);
      }
      showToast(`${ids.length}명 미션 배정을 저장했습니다.`);
      renderDriverMissionAssignments();
    } catch (error) {
      showToast(error.message || '미션 배정 저장에 실패했습니다.');
      renderDriverMissionAssignments();
    } finally {
      if (saveAllBtn) saveAllBtn.disabled = false;
      updateAssignmentSearchStatus();
    }
  }

  function missionLabel(missionId) {
    const id = String(missionId || '').trim();
    if (!id) return '미선택';
    return missionTitle(id);
  }

  function buildMissionAssignmentRows() {
    return BremStorage.drivers.getAll().map(driver => {
      const baeminMissionId = driver.selectedMissionIdBaemin || driver.selectedMissionId || '';
      const coupangMissionId = driver.selectedMissionIdCoupang || driver.selectedMissionId || '';
      const platforms = [
        driver.platformBaemin ? '배민' : '',
        driver.platformCoupang !== false ? '쿠팡' : ''
      ].filter(Boolean).join(' / ') || '-';

      return [
        driver.name || '',
        driver.phone || '',
        platforms,
        driver.baeminId || '-',
        getCoupangLoginId(driver),
        missionLabel(baeminMissionId),
        missionExposure(baeminMissionId),
        missionLabel(coupangMissionId),
        missionExposure(coupangMissionId),
        baeminMissionId || '',
        coupangMissionId || ''
      ];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ko'));
  }

  async function exportMissionAssignmentsToExcel() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }

    showToast('미션 배정 엑셀 준비 중…');

    try {
      await BremStorage.syncAllDriversPagesInBackground?.().catch(() => ({}));
      await Promise.all([
        BremStorage.reloadDrivers?.(true, { search: '', status: '전체' }),
        BremStorage.reloadMissions?.(true)
      ]);
    } catch (error) {
      showToast(formatMissionError(error) || '데이터를 불러오지 못했습니다.');
      return;
    }

    const rows = buildMissionAssignmentRows();
    if (!rows.length) {
      showToast('다운로드할 기사가 없습니다.');
      return;
    }

    const header = [
      '기사명',
      '전화번호',
      '수행 플랫폼',
      '배민 아이디',
      '쿠팡 아이디',
      '배민 미션',
      '배민 노출',
      '쿠팡 미션',
      '쿠팡 노출',
      '배민 미션 ID',
      '쿠팡 미션 ID'
    ];

    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
    sheet['!cols'] = [
      { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 },
      { wch: 28 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 24 }, { wch: 24 }
    ];

    const missionSummaryHeader = ['미션명', '유형', '배민 배정 기사 수', '쿠팡 배정 기사 수', '합계'];
    const missionCounts = new Map();
    BremStorage.drivers.getAll().forEach(driver => {
      const baeminId = String(driver.selectedMissionIdBaemin || driver.selectedMissionId || '').trim();
      const coupangId = String(driver.selectedMissionIdCoupang || driver.selectedMissionId || '').trim();
      if (baeminId) {
        const entry = missionCounts.get(baeminId) || { baemin: 0, coupang: 0 };
        entry.baemin += 1;
        missionCounts.set(baeminId, entry);
      }
      if (coupangId) {
        const entry = missionCounts.get(coupangId) || { baemin: 0, coupang: 0 };
        entry.coupang += 1;
        missionCounts.set(coupangId, entry);
      }
    });

    const summaryRows = missionsApi.getAll().map(mission => {
      const counts = missionCounts.get(mission.id) || { baemin: 0, coupang: 0 };
      return [
        mission.title || '',
        mission.type || '',
        counts.baemin,
        counts.coupang,
        counts.baemin + counts.coupang
      ];
    });

    const summarySheet = XLSX.utils.aoa_to_sheet([missionSummaryHeader, ...summaryRows]);
    summarySheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 10 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '기사별미션배정');
    XLSX.utils.book_append_sheet(workbook, summarySheet, '미션별집계');

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `BREM_미션배정_${stamp}.xlsx`);
    showToast(`${rows.length}명 미션 배정 엑셀 다운로드 완료`);
  }

  function missionExposure(missionId) {
    const mission = missionsApi.getById(missionId);
    if (!missionId) return '-';
    return mission?.isActive === false ? '숨김' : '노출';
  }

  function updateMissionFormUi() {
    const count = missionsApi.getAll().length;
    const atLimit = count >= MISSION_MAX;
    const isEditing = Boolean(state.editingId || $('missionEditId')?.value.trim());

    const countEl = $('missionCatalogCount');
    if (countEl) countEl.textContent = `${count} / ${MISSION_MAX}`;

    const limitNote = $('missionLimitNote');
    if (limitNote) {
      limitNote.hidden = !atLimit || isEditing;
      limitNote.textContent = `미션은 최대 ${MISSION_MAX}개까지 등록할 수 있습니다. 기존 미션을 수정하거나 삭제 후 추가하세요.`;
    }

    const addBtn = $('missionAddBtn');
    if (addBtn) addBtn.hidden = atLimit;

    const formCard = $('missionFormCard');
    if (formCard) formCard.hidden = atLimit && !isEditing;

    const submitBtn = $('missionFormSubmit');
    if (submitBtn && !isEditing) {
      submitBtn.disabled = atLimit;
    } else if (submitBtn) {
      submitBtn.disabled = false;
    }

    const deleteBtn = $('missionFormDelete');
    if (deleteBtn) deleteBtn.hidden = !isEditing;
  }

  async function deleteMission(missionId) {
    const mission = missionsApi.getById(missionId);
    if (!mission) {
      showToast('삭제할 미션을 찾을 수 없습니다.');
      return;
    }

    const confirmed = window.confirm(
      `「${mission.title}」 미션을 삭제할까요?\n배정된 기사의 미션 선택도 해제됩니다.`
    );
    if (!confirmed) return;

    try {
      await missionsApi.remove(missionId);
      if (state.editingId === missionId) {
        state.editingId = '';
        fillMissionForm(null);
      }
      await BremStorage.reloadDrivers?.(true);
      showToast('미션이 삭제되었습니다.');
      renderMissionCards();
      renderDriverMissionAssignments();
    } catch (error) {
      showToast(formatMissionError(error) || '미션 삭제에 실패했습니다.');
    }
  }

  function renderMissionCards() {
    const listEl = $('missionCatalogList');
    if (!listEl) return;

    const items = missionsApi.getAll();
    listEl.innerHTML = items.map(mission => `
      <article class="card mission-catalog-card" data-mission-id="${escapeHtml(mission.id)}">
        <div class="card-header">
          <h3>${escapeHtml(mission.title)}</h3>
          <span class="badge ${mission.isActive ? 'badge--success' : 'badge--muted'}">
            ${mission.isActive ? '기사앱 노출' : '기사앱 숨김'}
          </span>
        </div>
        <p class="mission-catalog-desc">${escapeHtml(mission.description || '-')}</p>
        <p class="hint"><strong>적용 조건:</strong> ${escapeHtml(mission.conditions || '-')}</p>
        <p class="hint"><strong>유형:</strong> ${escapeHtml(mission.type || '-')}</p>
        <div class="notice-actions">
          <button type="button" class="small-btn" data-edit-mission="${escapeHtml(mission.id)}">수정</button>
          <button type="button" class="small-btn danger-btn" data-delete-mission="${escapeHtml(mission.id)}">삭제</button>
        </div>
      </article>
    `).join('') || '<p class="empty-state">등록된 미션이 없습니다. 아래에서 새 미션을 등록하세요.</p>';
    updateMissionFormUi();
  }

  function fillMissionForm(mission) {
    $('missionEditId').value = mission?.id || '';
    $('missionTitle').value = mission?.title || '';
    $('missionDescription').value = mission?.description || '';
    $('missionConditions').value = mission?.conditions || '';
    $('missionType').value = mission?.type || '';
    $('missionIsActive').checked = mission?.isActive !== false;
    $('missionFormTitle').textContent = mission ? '미션 수정' : '미션 등록';
    $('missionFormSubmit').textContent = mission ? '미션 저장' : '미션 등록';
    state.editingId = mission?.id || '';
    updateMissionFormUi();
  }

  function renderDriverMissionAssignments() {
    const rowsEl = $('missionDriverRows');
    if (!rowsEl) return;

    const scrollWrap = document.querySelector('.mission-assignment-table-wrap');
    const scrollTop = scrollWrap?.scrollTop || 0;

    if (!BremStorage.drivers.getAll().length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">등록된 기사가 없습니다. 기사 목록을 새로고침하거나 기사를 등록하세요.</td></tr>';
      updateAssignmentSearchStatus();
      return;
    }

    const drivers = filteredAssignmentDrivers();
    updateAssignmentSearchStatus();

    if (!drivers.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty">조건에 맞는 기사가 없습니다. 검색·필터를 확인하세요.</td></tr>';
      return;
    }

    rowsEl.innerHTML = drivers.map(driver => {
      const draft = getDriverDraft(driver);
      const baeminMissionId = draft.baemin;
      const coupangMissionId = draft.coupang;
      const baeminDisabled = !driver.platformBaemin ? ' disabled' : '';
      const coupangDisabled = driver.platformCoupang === false ? ' disabled' : '';
      const isDirty = isDriverAssignmentDirty(driver.id);
      const baeminIdText = driver.platformBaemin ? (driver.baeminId || '-') : '-';
      const coupangIdText = driver.platformCoupang !== false ? getCoupangLoginId(driver) : '-';

      return `
        <tr class="${isDirty ? 'mission-row-dirty' : ''}" data-driver-id="${escapeHtml(driver.id)}">
          <td class="mission-driver-cell">
            <strong>${escapeHtml(driver.name)}</strong>
            <span class="hint">${escapeHtml(driver.phone)}</span>
          </td>
          <td class="mission-platform-cell">${platformBadgesHtml(driver)}</td>
          <td><code class="mission-id-code">${escapeHtml(baeminIdText)}</code></td>
          <td><code class="mission-id-code">${escapeHtml(coupangIdText)}</code></td>
          <td class="mission-select-cell">
            <select data-driver-mission-baemin="${escapeHtml(driver.id)}" class="inline-select"${baeminDisabled}>
              <option value="">배민 미션 미선택</option>
              ${missionOptions(baeminMissionId)}
            </select>
            ${missionHintHtml(baeminMissionId)}
          </td>
          <td class="mission-select-cell">
            <select data-driver-mission-coupang="${escapeHtml(driver.id)}" class="inline-select"${coupangDisabled}>
              <option value="">쿠팡 미션 미선택</option>
              ${missionOptions(coupangMissionId)}
            </select>
            ${missionHintHtml(coupangMissionId)}
          </td>
          <td>
            <button type="button" class="small-btn primary-btn" data-save-driver-mission="${escapeHtml(driver.id)}"${isDirty ? '' : ' disabled'}>저장</button>
          </td>
        </tr>
      `;
    }).join('');

    if (scrollWrap) scrollWrap.scrollTop = scrollTop;
  }

  async function refresh() {
    await updateSetupBanner();
    resetAssignmentDrafts();

    try {
      await BremStorage.reloadDrivers?.(true);
      const loadResult = await BremStorage.reloadMissions?.(true);
      if (missionsApi.getAll().length > 0) {
        state.tableReady = true;
        const banner = $('missionSetupBanner');
        if (banner) banner.hidden = true;
      } else if (loadResult?.ok === false) {
        showToast(formatMissionError(loadResult.message || loadResult.error));
      }
    } catch (error) {
      showToast(formatMissionError(error));
    }

    renderMissionCards();
    renderDriverMissionAssignments();
    if (!state.editingId) fillMissionForm(null);
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('missionSetupRecheckBtn')?.addEventListener('click', () => {
      void refresh();
    });

    $('missionCatalogList')?.addEventListener('click', event => {
      const editButton = event.target.closest('[data-edit-mission]');
      if (editButton) {
        const mission = missionsApi.getById(editButton.dataset.editMission);
        if (mission) fillMissionForm(mission);
        return;
      }

      const deleteButton = event.target.closest('[data-delete-mission]');
      if (deleteButton) {
        void deleteMission(deleteButton.dataset.deleteMission);
      }
    });

    $('missionFormReset')?.addEventListener('click', () => {
      if (state.editingId) {
        fillMissionForm(missionsApi.getById(state.editingId));
        return;
      }
      if (missionsApi.getAll().length >= MISSION_MAX) {
        showToast(`미션은 최대 ${MISSION_MAX}개까지 등록할 수 있습니다.`);
        return;
      }
      fillMissionForm(null);
    });

    $('missionAddBtn')?.addEventListener('click', () => {
      if (missionsApi.getAll().length >= MISSION_MAX) {
        showToast(`미션은 최대 ${MISSION_MAX}개까지 등록할 수 있습니다.`);
        return;
      }
      fillMissionForm(null);
      $('missionTitle')?.focus();
    });

    $('missionFormDelete')?.addEventListener('click', () => {
      const editId = $('missionEditId')?.value.trim();
      if (!editId) return;
      void deleteMission(editId);
    });

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

    $('missionAssignmentSearchClear')?.addEventListener('click', () => {
      state.assignmentSearch = '';
      state.assignmentPlatform = 'all';
      const searchInput = $('missionAssignmentSearch');
      const platformSelect = $('missionAssignmentPlatformFilter');
      if (searchInput) searchInput.value = '';
      if (platformSelect) platformSelect.value = 'all';
      renderDriverMissionAssignments();
    });

    $('riderMissionMgmtForm')?.addEventListener('submit', event => {
      event.preventDefault();
      if (state.tableReady === false) {
        showToast('먼저 Supabase SQL Editor에서 missions_migration.sql 을 실행하세요.');
        return;
      }

      const editId = $('missionEditId').value.trim();
      if (!editId && missionsApi.getAll().length >= MISSION_MAX) {
        showToast(`미션은 최대 ${MISSION_MAX}개까지 등록할 수 있습니다.`);
        return;
      }

      const payload = {
        title: $('missionTitle').value.trim(),
        description: $('missionDescription').value.trim(),
        conditions: $('missionConditions').value.trim(),
        type: $('missionType').value.trim(),
        isActive: $('missionIsActive').checked
      };

      if (!payload.title) {
        showToast('미션 제목을 입력하세요.');
        return;
      }

      const submitBtn = $('missionFormSubmit');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '저장 중…';
      }

      const savePromise = editId
        ? missionsApi.update(editId, payload)
        : missionsApi.create(payload);

      void Promise.resolve(savePromise)
        .then(() => {
          showToast(editId
            ? '미션이 Supabase에 저장되었습니다. 기사앱에도 반영됩니다.'
            : '미션이 등록되었습니다.');
          fillMissionForm(null);
          renderMissionCards();
          renderDriverMissionAssignments();
        })
        .catch(error => {
          showToast(formatMissionError(error) || '미션 저장에 실패했습니다.');
        })
        .finally(() => {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = editId ? '미션 저장' : '미션 등록';
          }
        });
    });

    $('missionDriverRows')?.addEventListener('change', event => {
      const baeminSelect = event.target.closest('[data-driver-mission-baemin]');
      const coupangSelect = event.target.closest('[data-driver-mission-coupang]');
      if (!baeminSelect && !coupangSelect) return;

      const driverId = baeminSelect?.dataset.driverMissionBaemin || coupangSelect?.dataset.driverMissionCoupang;
      const driver = BremStorage.drivers.getById(driverId);
      if (!driver) return;

      const current = getDriverDraft(driver);
      const next = {
        baemin: baeminSelect ? baeminSelect.value : current.baemin,
        coupang: coupangSelect ? coupangSelect.value : current.coupang
      };
      state.drafts.set(driverId, next);
      syncDirtyState(driverId);
      renderDriverMissionAssignments();
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
  }

  bindEvents();
  window.BremAdminMissions = { refresh };
})();

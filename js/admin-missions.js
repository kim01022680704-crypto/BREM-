(function () {
  const missionsApi = BremStorage.missions;
  if (!missionsApi) return;

  const state = { editingId: '', tableReady: null };

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

  function missionExposure(missionId) {
    const mission = missionsApi.getById(missionId);
    if (!missionId) return '-';
    return mission?.isActive === false ? '숨김' : '노출';
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
        </div>
      </article>
    `).join('') || '<p class="empty-state">등록된 미션이 없습니다. SQL 마이그레이션 후 기본 미션이 표시됩니다.</p>';
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
  }

  function renderDriverMissionAssignments() {
    const rowsEl = $('missionDriverRows');
    if (!rowsEl) return;

    const drivers = BremStorage.drivers.getAll();
    if (!drivers.length) {
      rowsEl.innerHTML = '<tr><td colspan="5" class="empty">등록된 기사가 없습니다. 기사 목록을 새로고침하거나 기사를 등록하세요.</td></tr>';
      return;
    }

    rowsEl.innerHTML = drivers.map(driver => {
      const baeminMissionId = driver.selectedMissionIdBaemin || driver.selectedMissionId || '';
      const coupangMissionId = driver.selectedMissionIdCoupang || driver.selectedMissionId || '';
      const baeminDisabled = !driver.platformBaemin ? ' disabled' : '';
      const coupangDisabled = driver.platformCoupang === false ? ' disabled' : '';

      return `
        <tr>
          <td><strong>${escapeHtml(driver.name)}</strong><br><span class="hint">${escapeHtml(driver.phone)}</span></td>
          <td>
            <select data-driver-mission-baemin="${escapeHtml(driver.id)}" class="inline-select"${baeminDisabled}>
              <option value="">배민 미션 미선택</option>
              ${missionOptions(baeminMissionId)}
            </select>
            <span class="hint">${escapeHtml(missionTitle(baeminMissionId))} · ${missionExposure(baeminMissionId)}</span>
          </td>
          <td>
            <select data-driver-mission-coupang="${escapeHtml(driver.id)}" class="inline-select"${coupangDisabled}>
              <option value="">쿠팡 미션 미선택</option>
              ${missionOptions(coupangMissionId)}
            </select>
            <span class="hint">${escapeHtml(missionTitle(coupangMissionId))} · ${missionExposure(coupangMissionId)}</span>
          </td>
          <td>${driver.platformBaemin ? '배민' : '-'}${driver.platformCoupang !== false ? ' / 쿠팡' : ''}</td>
        </tr>
      `;
    }).join('');
  }

  async function refresh() {
    await updateSetupBanner();

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
      const button = event.target.closest('[data-edit-mission]');
      if (!button) return;
      const mission = missionsApi.getById(button.dataset.editMission);
      if (mission) fillMissionForm(mission);
    });

    $('missionFormReset')?.addEventListener('click', () => {
      fillMissionForm(null);
    });

    $('riderMissionMgmtForm')?.addEventListener('submit', event => {
      event.preventDefault();
      if (state.tableReady === false) {
        showToast('먼저 Supabase SQL Editor에서 missions_migration.sql 을 실행하세요.');
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

      const editId = $('missionEditId').value.trim();
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
      const select = baeminSelect || coupangSelect;
      if (!select) return;

      const driverId = baeminSelect
        ? baeminSelect.dataset.driverMissionBaemin
        : coupangSelect.dataset.driverMissionCoupang;
      const changes = baeminSelect
        ? { selectedMissionIdBaemin: select.value }
        : { selectedMissionIdCoupang: select.value };

      void BremStorage.drivers.update(driverId, changes)
        .then(async () => {
          await BremStorage.flushStorage?.();
          showToast(baeminSelect ? '배민 미션이 저장되었습니다.' : '쿠팡 미션이 저장되었습니다.');
          renderDriverMissionAssignments();
        })
        .catch(error => {
          showToast(error.message || '기사 미션 저장에 실패했습니다.');
        });
    });
  }

  bindEvents();
  window.BremAdminMissions = { refresh };
})();

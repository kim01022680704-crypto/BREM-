(function () {
  const missionsApi = BremStorage.missions;
  if (!missionsApi) return;

  const state = { editingId: '' };

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

  function missionOptions(selectedId = '') {
    return missionsApi.getAll().map(mission => {
      const selected = mission.id === selectedId ? ' selected' : '';
      const label = mission.isActive === false ? `${mission.title} (기사앱 미노출)` : mission.title;
      return `<option value="${escapeHtml(mission.id)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');
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
    `).join('') || '<p class="empty-state">등록된 미션이 없습니다.</p>';
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
      rowsEl.innerHTML = '<tr><td colspan="4" class="empty">등록된 기사가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = drivers.map(driver => {
      const mission = missionsApi.getById(driver.selectedMissionId);
      return `
        <tr>
          <td><strong>${escapeHtml(driver.name)}</strong><br><span class="hint">${escapeHtml(driver.phone)}</span></td>
          <td>
            <select data-driver-mission="${escapeHtml(driver.id)}" class="inline-select">
              <option value="">미션 미선택</option>
              ${missionOptions(driver.selectedMissionId || '')}
            </select>
          </td>
          <td>${escapeHtml(mission?.title || '미선택')}</td>
          <td>${mission?.isActive === false ? '숨김' : '노출'}</td>
        </tr>
      `;
    }).join('');
  }

  function refresh() {
    renderMissionCards();
    renderDriverMissionAssignments();
    if (!state.editingId) fillMissionForm(null);
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

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

      try {
        const editId = $('missionEditId').value.trim();
        if (editId) {
          missionsApi.update(editId, payload);
          showToast('미션이 저장되었습니다. 선택한 기사앱에 제목이 반영됩니다.');
        } else {
          missionsApi.create(payload);
          showToast('미션이 등록되었습니다.');
        }
        fillMissionForm(null);
        refresh();
      } catch (error) {
        showToast(error.message || '미션 저장에 실패했습니다.');
      }
    });

    $('missionDriverRows')?.addEventListener('change', event => {
      const select = event.target.closest('[data-driver-mission]');
      if (!select) return;
      const driverId = select.dataset.driverMission;
      const missionId = select.value;
      try {
        BremStorage.drivers.update(driverId, { selectedMissionId: missionId });
        showToast('기사 미션이 저장되었습니다.');
        renderDriverMissionAssignments();
      } catch (error) {
        showToast(error.message || '기사 미션 저장에 실패했습니다.');
      }
    });
  }

  bindEvents();
  window.BremAdminMissions = { refresh };
})();

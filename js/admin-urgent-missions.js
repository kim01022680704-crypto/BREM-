(function () {
  const section = document.getElementById('urgent-missions');
  if (!section) return;

  const form = document.getElementById('urgentMissionForm');
  const contentEl = document.getElementById('urgentMissionContent');
  const amountEl = document.getElementById('urgentMissionAmount');
  const timeEl = document.getElementById('urgentMissionTime');
  const listEl = document.getElementById('urgentMissionList');
  const emptyEl = document.getElementById('urgentMissionEmpty');
  const publishBtn = document.getElementById('urgentMissionPublishBtn');

  const state = {
    missions: [],
    loading: false
  };

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function platformTags(platforms) {
    return (platforms || []).map((platform) => (
      platform === 'baemin'
        ? '<span class="urgent-mission-tag urgent-mission-tag--baemin">배민</span>'
        : '<span class="urgent-mission-tag urgent-mission-tag--coupang">쿠팡</span>'
    )).join('');
  }

  function selectedPlatforms() {
    return Array.from(section.querySelectorAll('input[name="urgentMissionPlatform"]:checked'))
      .map(input => input.value);
  }

  function selectedAcceptIds(missionId) {
    return Array.from(section.querySelectorAll(`[data-accept-mission="${missionId}"]:checked`))
      .map(input => input.value);
  }

  function renderTargets(mission) {
    const targets = mission.targets || [];
    if (!targets.length) {
      return '<p class="form-help">아직 대상 기사가 없습니다. 기사관리 → 기사지역관리에서 미션을 고른 뒤 기사를 넣으세요.</p>';
    }
    return `
      <ul class="urgent-mission-target-list">
        ${targets.map((item) => `
          <li>
            <span>${escapeHtml(item.riderName || '-')}${item.regionLabel ? ` · ${escapeHtml(item.regionLabel)}` : ''}${item.platform === 'baemin' ? ' · 배민' : item.platform === 'coupang' ? ' · 쿠팡' : ''}</span>
            <button type="button" class="small-btn" data-remove-target="${escapeHtml(mission.id)}" data-remove-rider="${escapeHtml(item.riderId)}">제외</button>
          </li>
        `).join('')}
      </ul>
    `;
  }

  function renderAccepts(mission) {
    const accepts = mission.accepts || [];
    if (!accepts.length) {
      return '<p class="form-help">아직 수락한 기사가 없습니다.</p>';
    }
    const rows = accepts.map((item) => `
      <tr>
        <td>
          <input type="checkbox" data-accept-mission="${escapeHtml(mission.id)}" value="${escapeHtml(item.id)}">
        </td>
        <td>${escapeHtml(item.riderName || '-')}</td>
        <td>${escapeHtml(item.riderPhone || '-')}</td>
        <td>${escapeHtml(formatDateTime(item.acceptedAt))}</td>
        <td>${item.setupDone ? '<span class="urgent-mission-status is-done">설정완료</span>' : '<span class="urgent-mission-status">수락</span>'}</td>
      </tr>
    `).join('');
    return `
      <div class="urgent-mission-accept-toolbar">
        <label class="check-label">
          <input type="checkbox" data-accept-all="${escapeHtml(mission.id)}">
          전체선택
        </label>
        <button type="button" class="primary-btn" data-setup-done="${escapeHtml(mission.id)}">미션설정완료</button>
      </div>
      <div class="table-wrap">
        <table class="data-table urgent-mission-accept-table">
          <thead>
            <tr>
              <th></th>
              <th>기사</th>
              <th>연락처</th>
              <th>수락시각</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function render() {
    if (!listEl) return;
    if (!state.missions.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = state.missions.map((mission) => {
      const closed = mission.status === 'closed';
      return `
        <article class="urgent-mission-card ${closed ? 'is-closed' : ''}" data-mission-id="${escapeHtml(mission.id)}">
          <div class="urgent-mission-card__head">
            <div class="urgent-mission-card__tags">
              ${platformTags(mission.platforms)}
              <span class="urgent-mission-status ${closed ? 'is-closed' : 'is-open'}">${closed ? '마감' : '모집중'}</span>
            </div>
            <div class="urgent-mission-card__meta">
              <strong>${escapeHtml(formatMoney(mission.amount))}</strong>
              <span>${escapeHtml(mission.missionTime || '-')}</span>
              <span>배포 ${escapeHtml(formatDateTime(mission.publishedAt))}</span>
            </div>
          </div>
          <p class="urgent-mission-card__content">${escapeHtml(mission.content)}</p>
          <div class="urgent-mission-card__actions">
            <button type="button" class="small-btn" data-close-mission="${escapeHtml(mission.id)}" ${closed ? 'disabled' : ''}>미션 마감</button>
            <button type="button" class="small-btn danger-btn" data-delete-mission="${escapeHtml(mission.id)}">정리</button>
          </div>
          <h3 class="urgent-mission-accept-title">대상 기사 <span>${(mission.targets || []).length}명</span></h3>
          ${renderTargets(mission)}
          <h3 class="urgent-mission-accept-title">수락 리스트 <span>${(mission.accepts || []).length}명</span></h3>
          ${renderAccepts(mission)}
        </article>
      `;
    }).join('');
  }

  async function load() {
    if (!window.BremStorage?.fetchAdminUrgentMissionsFromServer) return;
    state.loading = true;
    const result = await window.BremStorage.fetchAdminUrgentMissionsFromServer();
    state.loading = false;
    if (!result.ok) {
      showToast(result.message || result.error || '긴급미션을 불러오지 못했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
  }

  async function publish(event) {
    event.preventDefault();
    if (!window.BremStorage?.publishAdminUrgentMission) return;
    const content = String(contentEl?.value || '').trim();
    const amount = Number(amountEl?.value || 0);
    const missionTime = String(timeEl?.value || '').trim();
    const platforms = selectedPlatforms();
    if (!content || !amount || !missionTime || !platforms.length) {
      showToast('내용, 금액, 시간, 쿠팡/배민 태그를 모두 입력하세요.');
      return;
    }
    if (publishBtn) publishBtn.disabled = true;
    const result = await window.BremStorage.publishAdminUrgentMission({
      content,
      amount,
      missionTime,
      platforms
    });
    if (publishBtn) publishBtn.disabled = false;
    if (!result.ok) {
      showToast(result.message || result.error || '배포에 실패했습니다.');
      return;
    }
    form?.reset();
    state.missions = result.missions || [];
    render();
    showToast('긴급미션을 배포했습니다.');
  }

  async function closeMission(missionId) {
    if (!window.confirm('이 미션을 마감할까요? 이후 수락은 할 수 없습니다.')) return;
    const result = await window.BremStorage.closeAdminUrgentMission(missionId);
    if (!result.ok) {
      showToast(result.message || result.error || '마감에 실패했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    showToast('미션을 마감했습니다.');
  }

  async function setupDone(missionId) {
    const acceptIds = selectedAcceptIds(missionId);
    if (!acceptIds.length) {
      showToast('설정완료할 기사를 선택하세요.');
      return;
    }
    const result = await window.BremStorage.setupDoneAdminUrgentMission(missionId, acceptIds);
    if (!result.ok) {
      showToast(result.message || result.error || '설정완료 처리에 실패했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    showToast('선택한 기사를 미션설정완료 했습니다.');
  }

  async function removeTarget(missionId, riderId) {
    const result = await window.BremStorage.removeAdminUrgentMissionTargets(missionId, [riderId]);
    if (!result.ok) {
      showToast(result.message || result.error || '대상 제외에 실패했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    showToast('대상 기사에서 제외했습니다.');
  }

  async function deleteMission(missionId) {
    if (!window.confirm('이 미션 기록을 정리할까요? 기사앱에서도 바로 사라집니다.')) return;
    const result = await window.BremStorage.deleteAdminUrgentMission(missionId);
    if (!result.ok) {
      showToast(result.message || result.error || '정리에 실패했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
    showToast('미션 기록을 정리했습니다.');
  }

  document.getElementById('urgentMissionRefreshBtn')?.addEventListener('click', () => {
    void load();
  });

  form?.addEventListener('submit', publish);

  section.addEventListener('click', (event) => {
    const closeBtn = event.target.closest('[data-close-mission]');
    if (closeBtn) {
      void closeMission(closeBtn.dataset.closeMission);
      return;
    }
    const deleteBtn = event.target.closest('[data-delete-mission]');
    if (deleteBtn) {
      void deleteMission(deleteBtn.dataset.deleteMission);
      return;
    }
    const setupBtn = event.target.closest('[data-setup-done]');
    if (setupBtn) {
      void setupDone(setupBtn.dataset.setupDone);
      return;
    }
    const removeBtn = event.target.closest('[data-remove-target]');
    if (removeBtn) {
      void removeTarget(removeBtn.dataset.removeTarget, removeBtn.dataset.removeRider);
    }
  });

  section.addEventListener('change', (event) => {
    const all = event.target.closest('[data-accept-all]');
    if (!all) return;
    const missionId = all.dataset.acceptAll;
    section.querySelectorAll(`[data-accept-mission="${missionId}"]`).forEach((input) => {
      input.checked = all.checked;
    });
  });

  window.BremAdminUrgentMissions = {
    refresh: load
  };
})();

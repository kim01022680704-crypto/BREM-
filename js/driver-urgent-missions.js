(function () {
  const panel = document.getElementById('driverUrgentMissionPanel');
  const listEl = document.getElementById('driverUrgentMissionList');
  const badgeEl = document.getElementById('driverMissionNavBadge');
  const openBtn = document.getElementById('driverUrgentMissionBtn');
  const popup = document.getElementById('driverUrgentMissionPopup');
  const popupBody = document.getElementById('driverUrgentMissionPopupBody');
  if (!panel || !listEl) return;

  const state = {
    missions: [],
    loading: false,
    visible: false,
    popupOpen: false
  };

  function isNativeAppNav() {
    return Boolean(window.BremDriverAppNav?.setTab);
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2400);
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

  function platformTags(platforms) {
    return (platforms || []).map((platform) => (
      platform === 'baemin'
        ? '<span class="urgent-mission-tag urgent-mission-tag--baemin">배민</span>'
        : '<span class="urgent-mission-tag urgent-mission-tag--coupang">쿠팡</span>'
    )).join('');
  }

  function pendingMissions() {
    return (state.missions || []).filter(item => item.status === 'open' && !item.accepted);
  }

  function updateBadge() {
    const count = pendingMissions().length;
    if (!badgeEl) return;
    if (!count) {
      badgeEl.hidden = true;
      badgeEl.textContent = '0';
      return;
    }
    badgeEl.hidden = false;
    badgeEl.textContent = String(count);
  }

  function renderPanel() {
    const missions = state.missions || [];
    if (!missions.length) {
      listEl.innerHTML = '<div class="empty-text">진행 중인 긴급미션이 없습니다.</div>';
      updateBadge();
      return;
    }
    listEl.innerHTML = missions.map((mission) => {
      const closed = mission.status === 'closed';
      let action = '';
      if (closed) {
        action = `<span class="urgent-mission-status is-closed">${mission.setupDone ? '설정완료 · 마감' : '마감'}</span>`;
      } else if (mission.accepted) {
        action = `<span class="urgent-mission-status is-done">${mission.setupDone ? '설정완료' : '수락완료'}</span>`;
      } else {
        action = `<button type="button" class="primary-btn urgent-mission-accept-btn" data-accept-mission="${escapeHtml(mission.id)}">수락</button>`;
      }
      return `
        <article class="urgent-mission-card ${closed ? 'is-closed' : ''}">
          <div class="urgent-mission-card__tags">
            ${platformTags(mission.platforms)}
            <span class="urgent-mission-status ${closed ? 'is-closed' : 'is-open'}">${closed ? '마감' : '모집중'}</span>
          </div>
          <p class="urgent-mission-card__content">${escapeHtml(mission.content)}</p>
          <div class="urgent-mission-card__meta">
            <strong>${escapeHtml(formatMoney(mission.amount))}</strong>
            <span>${escapeHtml(mission.missionTime || '-')}</span>
          </div>
          <div class="urgent-mission-card__actions">${action}</div>
        </article>
      `;
    }).join('');
    updateBadge();
  }

  function renderPopup() {
    if (!popup || !popupBody) return;
    const pending = pendingMissions();
    if (!pending.length) {
      popupBody.innerHTML = `
        <p class="urgent-mission-popup__empty">진행 중인 긴급미션이 없습니다.</p>
        <div class="urgent-mission-popup__actions">
          <button type="button" class="urgent-mission-popup__reject" data-urgent-mission-dismiss>닫기</button>
        </div>
      `;
      return;
    }
    popupBody.innerHTML = pending.map((mission) => `
      <article class="urgent-mission-popup__card">
        <div class="urgent-mission-card__tags">
          ${platformTags(mission.platforms)}
          <span class="urgent-mission-status is-open">모집중</span>
        </div>
        <p class="urgent-mission-card__content">${escapeHtml(mission.content)}</p>
        <div class="urgent-mission-card__meta">
          <strong>${escapeHtml(formatMoney(mission.amount))}</strong>
          <span>${escapeHtml(mission.missionTime || '-')}</span>
        </div>
        <div class="urgent-mission-popup__actions">
          <button type="button" class="urgent-mission-popup__reject" data-urgent-mission-dismiss>거절</button>
          <button type="button" class="urgent-mission-popup__accept" data-accept-mission="${escapeHtml(mission.id)}">수락</button>
        </div>
      </article>
    `).join('');
  }

  function render() {
    renderPanel();
    if (state.popupOpen) renderPopup();
  }

  async function load() {
    if (!window.BremStorage?.fetchRiderUrgentMissionsFromServer) return;
    state.loading = true;
    const result = await window.BremStorage.fetchRiderUrgentMissionsFromServer();
    state.loading = false;
    if (!result.ok) {
      if (state.visible || state.popupOpen) showToast(result.message || '긴급미션을 불러오지 못했습니다.');
      return;
    }
    state.missions = result.missions || [];
    render();
  }

  async function accept(missionId) {
    const result = await window.BremStorage.acceptRiderUrgentMissionOnServer(missionId);
    if (!result.ok) {
      showToast(result.message || result.error || '수락에 실패했습니다.');
      await load();
      return;
    }
    showToast('미션을 수락했습니다.');
    await load();
    if (state.popupOpen && !pendingMissions().length) closePopup();
  }

  function openPanel() {
    state.visible = true;
    panel.hidden = false;
    void load();
  }

  function closePanel() {
    state.visible = false;
    panel.hidden = true;
  }

  function openPopup() {
    if (!popup) {
      openPanel();
      return;
    }
    closePanel();
    state.popupOpen = true;
    popup.hidden = false;
    openBtn?.setAttribute('aria-expanded', 'true');
    renderPopup();
    void load();
  }

  function closePopup() {
    state.popupOpen = false;
    if (popup) popup.hidden = true;
    openBtn?.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    if (isNativeAppNav()) {
      window.BremDriverAppNav.setTab('mission');
      return;
    }
    openPopup();
  }

  listEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-accept-mission]');
    if (!btn) return;
    btn.disabled = true;
    void accept(btn.dataset.acceptMission).finally(() => {
      btn.disabled = false;
    });
  });

  popup?.addEventListener('click', (event) => {
    if (event.target.closest('[data-urgent-mission-dismiss]')) {
      closePopup();
      return;
    }
    const btn = event.target.closest('[data-accept-mission]');
    if (!btn) return;
    btn.disabled = true;
    void accept(btn.dataset.acceptMission).finally(() => {
      btn.disabled = false;
    });
  });

  document.getElementById('driverUrgentMissionCloseBtn')?.addEventListener('click', () => {
    if (window.BremDriverAppNav?.getTab?.() === 'mission') {
      window.BremDriverAppNav.setTab('home');
      return;
    }
    closePanel();
  });

  openBtn?.addEventListener('click', openMenu);

  window.BremDriverUrgentMissions = {
    open: openPanel,
    close() {
      closePopup();
      closePanel();
    },
    refresh: load,
    reset() {
      state.missions = [];
      render();
      closePopup();
      closePanel();
    }
  };

  void load();
})();

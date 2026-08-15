(function () {
  const panel = document.getElementById('driverUrgentMissionPanel');
  const listEl = document.getElementById('driverUrgentMissionList');
  const badgeEl = document.getElementById('driverMissionNavBadge');
  const openBtn = document.getElementById('driverUrgentMissionBtn');
  if (!panel || !listEl) return;

  const state = {
    missions: [],
    loading: false,
    visible: false
  };

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

  function updateBadge() {
    const count = (state.missions || []).filter(item => item.status === 'open' && !item.accepted).length;
    if (!badgeEl) return;
    if (!count) {
      badgeEl.hidden = true;
      badgeEl.textContent = '0';
      return;
    }
    badgeEl.hidden = false;
    badgeEl.textContent = String(count);
  }

  function render() {
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

  async function load() {
    if (!window.BremStorage?.fetchRiderUrgentMissionsFromServer) return;
    state.loading = true;
    const result = await window.BremStorage.fetchRiderUrgentMissionsFromServer();
    state.loading = false;
    if (!result.ok) {
      if (state.visible) showToast(result.message || '긴급미션을 불러오지 못했습니다.');
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

  listEl.addEventListener('click', (event) => {
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

  openBtn?.addEventListener('click', () => {
    if (window.BremDriverAppNav?.setTab) {
      window.BremDriverAppNav.setTab('mission');
      return;
    }
    openPanel();
  });

  window.BremDriverUrgentMissions = {
    open: openPanel,
    close: closePanel,
    refresh: load,
    reset() {
      state.missions = [];
      render();
      closePanel();
    }
  };

  void load();
})();

(function () {
  const panel = document.getElementById('driverCrewLeaderPanel');
  const openBtn = document.getElementById('driverCrewLeaderBtn');
  const closeBtn = document.getElementById('driverCrewLeaderCloseBtn');
  const refreshBtn = document.getElementById('driverCrewLeaderRefreshBtn');
  const prevWeekBtn = document.getElementById('driverCrewLeaderPrevWeekBtn');
  const nextWeekBtn = document.getElementById('driverCrewLeaderNextWeekBtn');
  const periodEl = document.getElementById('driverCrewLeaderPeriod');
  const boxLabelEl = document.getElementById('driverCrewLeaderBoxLabel');
  const summaryEl = document.getElementById('driverCrewLeaderSummary');
  const emptyEl = document.getElementById('driverCrewLeaderEmpty');
  const contentEl = document.getElementById('driverCrewLeaderContent');
  const rowsEl = document.getElementById('driverCrewLeaderRows');

  if (!panel || !openBtn) return;

  const POLL_MS = 60 * 1000;

  const state = {
    visible: false,
    loading: false,
    weekStart: '',
    lastResult: null,
    pollTimer: null,
    requestSeq: 0
  };

  function showToast(message) {
    const el = document.getElementById('toast');
    if (!el || !message) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function localDateKey(date = new Date()) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function settlementWeekStart(dateValue) {
    if (window.BremDatePicker?.weekStartKey) {
      return window.BremDatePicker.weekStartKey(dateValue || localDateKey());
    }
    const seed = String(dateValue || localDateKey()).slice(0, 10);
    const date = new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(seed) ? seed : localDateKey()}T00:00:00`);
    if (Number.isNaN(date.getTime())) return localDateKey();
    date.setDate(date.getDate() - ((date.getDay() - 3 + 7) % 7));
    return localDateKey(date);
  }

  function settlementWeekEnd(weekStart) {
    if (window.BremDatePicker?.weekEndKey) {
      return window.BremDatePicker.weekEndKey(weekStart);
    }
    const date = new Date(`${weekStart}T00:00:00`);
    date.setDate(date.getDate() + 6);
    return localDateKey(date);
  }

  function ensureWeekStart() {
    state.weekStart = settlementWeekStart(state.weekStart || localDateKey());
    return state.weekStart;
  }

  function formatWeekLabel(weekStart, weekEnd) {
    if (!weekStart || !weekEnd) return '-';
    const fmt = (key, dow) => {
      const [, m, d] = String(key).split('-');
      return `${Number(m)}.${Number(d)}(${dow})`;
    };
    return `${fmt(weekStart, '수')}~${fmt(weekEnd, '화')}`;
  }

  function operatingTagHtml(operating) {
    if (operating === true) {
      return '<span class="driver-crew-tag driver-crew-tag--on">운행중</span>';
    }
    if (operating === false) {
      return '<span class="driver-crew-tag driver-crew-tag--off">미운행</span>';
    }
    return '<span class="driver-crew-tag driver-crew-tag--unk">미확인</span>';
  }

  function renderResult(result) {
    state.lastResult = result;
    if (!result?.ok || !result.isCrewLeader) {
      if (boxLabelEl) boxLabelEl.textContent = '-';
      if (summaryEl) summaryEl.textContent = '';
      if (contentEl) contentEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      if (rowsEl) rowsEl.innerHTML = '';
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (contentEl) contentEl.hidden = false;
    if (boxLabelEl) {
      boxLabelEl.textContent = result.box?.label
        ? `${result.box.label}${result.box.isTopRep ? ' (대표)' : ''}`
        : '-';
    }
    const weekStart = result.weekStart || ensureWeekStart();
    const weekEnd = result.weekEnd || settlementWeekEnd(weekStart);
    if (periodEl) periodEl.textContent = formatWeekLabel(weekStart, weekEnd);

    const summary = result.summary || {};
    if (summaryEl) {
      summaryEl.textContent = `인원 ${formatNumber(summary.memberCount)} · 운행중 ${formatNumber(summary.operatingCount)}`
        + ` · 현재콜 ${formatNumber(summary.todayCalls)} · 주간콜 ${formatNumber(summary.weekCalls)}`;
    }

    const members = Array.isArray(result.members) ? result.members : [];
    if (rowsEl) {
      rowsEl.innerHTML = members.length
        ? members.map(member => `
          <tr class="${member.isSelf ? 'is-self' : ''}">
            <td>
              <strong>${escapeHtml(member.name)}</strong>
              ${member.isSelf ? ' <span class="driver-crew-tag driver-crew-tag--self">나</span>' : ''}
            </td>
            <td>${operatingTagHtml(member.operating)}</td>
            <td class="driver-crew-num">${formatNumber(member.todayCalls)}</td>
            <td class="driver-crew-num">${formatNumber(member.weekCalls)}</td>
            <td class="driver-crew-num">${formatNumber(member.totalCalls)}</td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="empty">소속 기사가 없습니다.</td></tr>';
    }
  }

  async function loadDashboard(options = {}) {
    const seq = ++state.requestSeq;
    const weekStart = ensureWeekStart();
    if (periodEl) periodEl.textContent = formatWeekLabel(weekStart, settlementWeekEnd(weekStart));
    state.loading = true;
    panel.classList.toggle('is-loading', true);
    try {
      const result = await window.BremStorage?.fetchRiderCrewLeaderFromServer?.({ weekStart });
      if (seq !== state.requestSeq) return null;
      if (!result?.ok) {
        showToast(result?.message || result?.error || '크루 현황을 불러오지 못했습니다.');
        return null;
      }
      if (!result.isCrewLeader) {
        openBtn.hidden = true;
        renderResult(result);
        if (state.visible) closePanel();
        return result;
      }
      openBtn.hidden = false;
      renderResult(result);
      return result;
    } catch (error) {
      if (seq === state.requestSeq) {
        showToast(error?.message || '크루 현황을 불러오지 못했습니다.');
      }
      return null;
    } finally {
      if (seq === state.requestSeq) {
        state.loading = false;
        panel.classList.toggle('is-loading', false);
      }
    }
  }

  async function refreshEntryVisibility() {
    try {
      const weekStart = ensureWeekStart();
      const result = await window.BremStorage?.fetchRiderCrewLeaderFromServer?.({ weekStart });
      if (!result?.ok || !result.isCrewLeader) {
        openBtn.hidden = true;
        if (state.visible) closePanel();
        return false;
      }
      openBtn.hidden = false;
      return true;
    } catch (_) {
      openBtn.hidden = true;
      return false;
    }
  }

  function startAutoPoll() {
    stopAutoPoll();
    state.pollTimer = setInterval(() => {
      if (!state.visible || document.visibilityState === 'hidden') return;
      void loadDashboard();
    }, POLL_MS);
  }

  function stopAutoPoll() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function openPanel() {
    window.BremDriverWithdrawal?.close?.();
    window.BremDriverWeeklyPayslip?.close?.();
    window.BremDriverRegionDashboard?.close?.();
    state.visible = true;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    ensureWeekStart();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void loadDashboard();
    startAutoPoll();
  }

  function closePanel() {
    state.visible = false;
    stopAutoPoll();
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
  }

  function resetPanel() {
    state.requestSeq += 1;
    state.weekStart = settlementWeekStart(localDateKey());
    state.lastResult = null;
    state.loading = false;
    stopAutoPoll();
    closePanel();
    openBtn.hidden = true;
    if (boxLabelEl) boxLabelEl.textContent = '-';
    if (periodEl) periodEl.textContent = '-';
    if (summaryEl) summaryEl.textContent = '';
    if (rowsEl) rowsEl.innerHTML = '';
    if (contentEl) contentEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
  }

  function shiftWeek(delta) {
    const base = ensureWeekStart();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + delta * 7);
    state.weekStart = settlementWeekStart(localDateKey(date));
    void loadDashboard({ force: true });
  }

  openBtn.addEventListener('click', () => {
    if (state.visible) closePanel();
    else openPanel();
  });
  closeBtn?.addEventListener('click', closePanel);
  refreshBtn?.addEventListener('click', () => void loadDashboard({ force: true }));
  prevWeekBtn?.addEventListener('click', () => shiftWeek(-1));
  nextWeekBtn?.addEventListener('click', () => shiftWeek(1));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.visible) {
      void loadDashboard();
    }
  });

  // 로그인 후 크루장이면 버튼 노출
  void refreshEntryVisibility();
  document.addEventListener('brem-rider-session-ready', () => {
    void refreshEntryVisibility();
  });

  window.BremDriverCrewLeader = {
    open: openPanel,
    close: closePanel,
    reset: resetPanel,
    refresh: () => loadDashboard({ force: true }),
    refreshEntryVisibility
  };
})();

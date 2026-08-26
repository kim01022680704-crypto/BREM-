(function () {
  const panel = document.getElementById('driverCrewLeaderPanel');
  const openBtn = document.getElementById('driverCrewLeaderBtn');
  const closeBtn = document.getElementById('driverCrewLeaderCloseBtn');
  const refreshBtn = document.getElementById('driverCrewLeaderRefreshBtn');
  const prevWeekBtn = document.getElementById('driverCrewLeaderPrevWeekBtn');
  const nextWeekBtn = document.getElementById('driverCrewLeaderNextWeekBtn');
  const periodEl = document.getElementById('driverCrewLeaderPeriod');
  const titleEl = document.getElementById('driverCrewLeaderTitle');
  const boxLabelEl = document.getElementById('driverCrewLeaderBoxLabel');
  const summaryEl = document.getElementById('driverCrewLeaderSummary');
  const emptyEl = document.getElementById('driverCrewLeaderEmpty');
  const contentEl = document.getElementById('driverCrewLeaderContent');
  const rowsEl = document.getElementById('driverCrewLeaderRows');
  const renameBtn = document.getElementById('driverCrewLeaderRenameBtn');
  const renameForm = document.getElementById('driverCrewLeaderRenameForm');
  const renameInput = document.getElementById('driverCrewLeaderRenameInput');
  const renameCancelBtn = document.getElementById('driverCrewLeaderRenameCancelBtn');
  const viewTabsEl = document.getElementById('driverCrewLeaderViewTabs');
  const detailContentEl = document.getElementById('driverCrewLeaderDetailContent');
  const detailSummaryEl = document.getElementById('driverCrewLeaderDetailSummary');
  const detailRowsEl = document.getElementById('driverCrewLeaderDetailRows');
  const detailFootEl = document.getElementById('driverCrewLeaderDetailFoot');

  if (!panel || !openBtn) return;

  const DEFAULT_TITLE = '크루장 관리';
  const POLL_MS = 60 * 1000;

  const state = {
    visible: false,
    loading: false,
    renaming: false,
    weekStart: '',
    lastResult: null,
    lastDetailResult: null,
    viewMode: 'ops',
    pollTimer: null,
    requestSeq: 0,
    visibilitySeq: 0
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
      return '<span class="driver-crew-tag driver-crew-tag--on"><span class="driver-crew-tag__dot" aria-hidden="true"></span>운행중</span>';
    }
    if (operating === false) {
      return '<span class="driver-crew-tag driver-crew-tag--off"><span class="driver-crew-tag__dot" aria-hidden="true"></span>미운행</span>';
    }
    return '<span class="driver-crew-tag driver-crew-tag--unk"><span class="driver-crew-tag__dot" aria-hidden="true"></span>미확인</span>';
  }

  function formatRatePct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10) / 10;
  }

  function rateCellHtml(value, platform) {
    const rate = formatRatePct(value);
    const cls = platform === 'baemin' ? 'driver-crew-rate--baemin' : 'driver-crew-rate--coupang';
    if (rate == null) return '<td class="driver-crew-rate is-empty">-</td>';
    return `<td class="driver-crew-rate ${cls}">${rate}%</td>`;
  }

  function notifyFeatureVisibility(visible) {
    document.dispatchEvent(new CustomEvent('brem-driver-feature-visibility', {
      detail: { kind: 'crew', visible: Boolean(visible) }
    }));
  }

  function applyCrewTitle(label) {
    const name = String(label || '').trim();
    if (titleEl) titleEl.textContent = name || DEFAULT_TITLE;
    if (boxLabelEl) {
      const isTop = Boolean(state.lastResult?.box?.isTopRep);
      boxLabelEl.textContent = name ? `${name}${isTop ? ' (대표)' : ''}` : '-';
    }
    // 라이더앱 진입 버튼도 크루 이름으로 보이게
    if (openBtn) {
      openBtn.textContent = name || DEFAULT_TITLE;
      openBtn.title = name ? `${name} · 크루장 관리` : DEFAULT_TITLE;
    }
  }

  function closeRenameForm() {
    if (renameForm) renameForm.hidden = true;
    if (renameInput) renameInput.value = '';
  }

  function openRenameForm() {
    const current = String(state.lastResult?.box?.label || '').trim();
    if (renameInput) {
      renameInput.value = current;
      renameInput.focus();
      renameInput.select();
    }
    if (renameForm) renameForm.hidden = false;
  }

  function setViewMode(mode) {
    const next = mode === 'detail' ? 'detail' : 'ops';
    state.viewMode = next;
    viewTabsEl?.querySelectorAll('[data-crew-view]').forEach(btn => {
      const active = btn.dataset.crewView === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (contentEl) contentEl.hidden = next !== 'ops';
    if (detailContentEl) detailContentEl.hidden = next !== 'detail';
    if (summaryEl) summaryEl.hidden = next !== 'ops';
  }

  function renderDetailResult(result) {
    state.lastDetailResult = result;
    if (!result?.ok || !result.isCrewLeader) {
      if (detailSummaryEl) detailSummaryEl.textContent = '';
      if (detailRowsEl) detailRowsEl.innerHTML = '';
      if (detailFootEl) detailFootEl.innerHTML = '';
      return;
    }

    const summary = result.summary || {};
    if (detailSummaryEl) {
      detailSummaryEl.textContent = `기사 ${formatNumber(summary.memberCount)}명 · 쿠팡콜 ${formatNumber(summary.coupangCalls)} · 배민콜 ${formatNumber(summary.baeminCalls)} · 쿠팡배달료 ${formatNumber(summary.coupangFee)}원 · 배민배달료 ${formatNumber(summary.baeminFee)}원 · 배달료합계 ${formatNumber(summary.totalFee)}원`;
    }

    const members = Array.isArray(result.members) ? result.members : [];
    if (detailRowsEl) {
      detailRowsEl.innerHTML = members.length
        ? members.map(member => `
          <tr class="${member.isSelf ? 'is-self' : ''}">
            <td>
              <div class="driver-crew-name">
                <strong class="driver-crew-name__text">${escapeHtml(member.name)}</strong>
                ${(member.isSelf || member.isCrew) ? `<span class="driver-crew-name__badges">${member.isSelf ? '<span class="driver-crew-tag driver-crew-tag--self">나</span>' : ''}${member.isCrew ? '<span class="driver-crew-tag driver-crew-tag--crew">장</span>' : ''}</span>` : ''}
              </div>
            </td>
            <td class="driver-crew-box">${escapeHtml(member.boxLabel || '-')}</td>
            ${rateCellHtml(member.baeminAcceptRate, 'baemin')}
            ${rateCellHtml(member.coupangRejectRate, 'coupang')}
            <td class="driver-crew-num">${formatNumber(member.coupangCalls)}</td>
            <td class="driver-crew-num">${formatNumber(member.baeminCalls)}</td>
            <td class="driver-crew-num">${formatNumber(member.coupangFee)}</td>
            <td class="driver-crew-num">${formatNumber(member.baeminFee)}</td>
            <td class="driver-crew-num driver-crew-num--total">${formatNumber(member.totalFee)}</td>
          </tr>`).join('')
        : '<tr><td colspan="9" class="empty">소속 기사가 없습니다.</td></tr>';
    }
    if (detailFootEl) {
      detailFootEl.innerHTML = members.length
        ? `<tr class="driver-crew-total-row">
            <td colspan="4">합계 (${formatNumber(members.length)}명)</td>
            <td class="driver-crew-num">${formatNumber(summary.coupangCalls)}</td>
            <td class="driver-crew-num">${formatNumber(summary.baeminCalls)}</td>
            <td class="driver-crew-num">${formatNumber(summary.coupangFee)}</td>
            <td class="driver-crew-num">${formatNumber(summary.baeminFee)}</td>
            <td class="driver-crew-num driver-crew-num--total">${formatNumber(summary.totalFee)}</td>
          </tr>`
        : '';
    }
  }

  function renderResult(result) {
    state.lastResult = result;
    if (!result?.ok || !result.isCrewLeader) {
      applyCrewTitle('');
      if (summaryEl) summaryEl.textContent = '';
      if (contentEl) contentEl.hidden = true;
      if (detailContentEl) detailContentEl.hidden = true;
      if (viewTabsEl) viewTabsEl.hidden = true;
      if (emptyEl) emptyEl.hidden = false;
      if (rowsEl) rowsEl.innerHTML = '';
      if (detailRowsEl) detailRowsEl.innerHTML = '';
      if (detailFootEl) detailFootEl.innerHTML = '';
      if (renameBtn) renameBtn.hidden = true;
      closeRenameForm();
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (viewTabsEl) viewTabsEl.hidden = false;
    if (renameBtn) renameBtn.hidden = false;
    setViewMode(state.viewMode);
    applyCrewTitle(result.box?.label || '');
    const weekStart = result.weekStart || ensureWeekStart();
    const weekEnd = result.weekEnd || settlementWeekEnd(weekStart);
    if (periodEl) periodEl.textContent = formatWeekLabel(weekStart, weekEnd);

    const summary = result.summary || {};
    if (summaryEl) {
      summaryEl.textContent = `인원 ${formatNumber(summary.memberCount)} · 운행중 ${formatNumber(summary.operatingCount)}`
        + ` · 오늘배민 ${formatNumber(summary.todayBaemin ?? summary.todayCalls)}`
        + ` · 주간 배민 ${formatNumber(summary.weekBaemin)} · 쿠팡 ${formatNumber(summary.weekCoupang)}`
        + ` · 합계 ${formatNumber(summary.weekCalls)}`;
    }

    const members = Array.isArray(result.members) ? result.members : [];
    if (rowsEl) {
      rowsEl.innerHTML = members.length
        ? members.map(member => `
          <tr class="${member.isSelf ? 'is-self' : ''}">
            <td>
              <div class="driver-crew-name">
                <strong class="driver-crew-name__text">${escapeHtml(member.name)}</strong>
                ${member.isSelf ? '<span class="driver-crew-name__badges"><span class="driver-crew-tag driver-crew-tag--self">나</span></span>' : ''}
              </div>
            </td>
            <td class="driver-crew-ops">${operatingTagHtml(member.operating)}</td>
            ${rateCellHtml(member.baeminAcceptRate, 'baemin')}
            ${rateCellHtml(member.coupangRejectRate, 'coupang')}
            <td class="driver-crew-num">${formatNumber(member.todayBaemin ?? member.todayCalls)}</td>
            <td class="driver-crew-num">${formatNumber(member.weekBaemin)}</td>
            <td class="driver-crew-num">${formatNumber(member.weekCoupang)}</td>
            <td class="driver-crew-num">${formatNumber(member.weekCalls)}</td>
          </tr>`).join('')
        : '<tr><td colspan="8" class="empty">소속 기사가 없습니다.</td></tr>';
    }
  }

  async function submitRename(event) {
    event?.preventDefault?.();
    if (state.renaming) return;
    const label = String(renameInput?.value || '').replace(/\s+/g, ' ').trim();
    if (!label) {
      showToast('크루 이름을 입력하세요.');
      renameInput?.focus();
      return;
    }
    if (label.length < 2) {
      showToast('크루 이름은 2자 이상이어야 합니다.');
      renameInput?.focus();
      return;
    }
    state.renaming = true;
    if (renameForm) renameForm.classList.add('is-saving');
    try {
      const result = await window.BremStorage?.renameRiderCrewFromServer?.({ label });
      if (!result?.ok) {
        showToast(result?.message || result?.error || '크루 이름 변경에 실패했습니다.');
        return;
      }
      const nextLabel = result.box?.label || label;
      if (state.lastResult?.box) {
        state.lastResult.box = { ...state.lastResult.box, label: nextLabel };
      } else {
        state.lastResult = { ...(state.lastResult || {}), ok: true, isCrewLeader: true, box: result.box };
      }
      applyCrewTitle(nextLabel);
      closeRenameForm();
      showToast(`크루 이름이 '${nextLabel}'(으)로 변경되었습니다.`);
    } catch (error) {
      showToast(error?.message || '크루 이름 변경에 실패했습니다.');
    } finally {
      state.renaming = false;
      if (renameForm) renameForm.classList.remove('is-saving');
    }
  }

  async function loadDetail(options = {}) {
    const seq = ++state.requestSeq;
    const weekStart = ensureWeekStart();
    state.loading = true;
    panel.classList.toggle('is-loading', true);
    try {
      const result = await window.BremStorage?.fetchRiderCrewLeaderDetailFromServer?.({ weekStart });
      if (seq !== state.requestSeq) return null;
      if (!result?.ok) {
        showToast(result?.message || result?.error || '크루 상세 실적을 불러오지 못했습니다.');
        return null;
      }
      if (!result.isCrewLeader) {
        openBtn.hidden = true;
        notifyFeatureVisibility(false);
        renderDetailResult(result);
        if (state.visible) closePanel();
        return result;
      }
      openBtn.hidden = false;
      notifyFeatureVisibility(true);
      if (emptyEl) emptyEl.hidden = true;
      if (viewTabsEl) viewTabsEl.hidden = false;
      if (renameBtn) renameBtn.hidden = false;
      applyCrewTitle(result.box?.label || state.lastResult?.box?.label || '');
      setViewMode('detail');
      renderDetailResult(result);
      return result;
    } catch (error) {
      if (seq === state.requestSeq) {
        showToast(error?.message || '크루 상세 실적을 불러오지 못했습니다.');
      }
      return null;
    } finally {
      if (seq === state.requestSeq) {
        state.loading = false;
        panel.classList.toggle('is-loading', false);
      }
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
        notifyFeatureVisibility(false);
        renderResult(result);
        if (state.visible) closePanel();
        showToast('조직도 크루장 계정이 아닙니다.');
        return result;
      }
      openBtn.hidden = false;
      notifyFeatureVisibility(true);
      renderResult(result);
      if (state.viewMode === 'detail') {
        void loadDetail();
      }
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
    const seq = ++state.visibilitySeq;
    // 검사 전에는 버튼을 보여 둔다. (숨김 기본값 때문에 크루장도 못 보는 문제 방지)
    openBtn.hidden = false;
    try {
      const result = await window.BremStorage?.fetchRiderCrewLeaderFromServer?.({
        weekStart: ensureWeekStart(),
        probe: true
      });
      if (seq !== state.visibilitySeq) return false;
      // 네트워크/세션 실패 시에는 숨기지 않음 — 눌러서 다시 시도 가능
      if (!result?.ok) return true;
      if (!result.isCrewLeader) {
        openBtn.hidden = true;
        notifyFeatureVisibility(false);
        if (state.visible) closePanel();
        return false;
      }
      openBtn.hidden = false;
      notifyFeatureVisibility(true);
      applyCrewTitle(result.box?.label || '');
      return true;
    } catch (_) {
      return true;
    }
  }

  function startAutoPoll() {
    stopAutoPoll();
    state.pollTimer = setInterval(() => {
      if (!state.visible || document.visibilityState === 'hidden') return;
      if (state.viewMode === 'detail') void loadDetail();
      else void loadDashboard();
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
    if (state.viewMode === 'detail') {
      void loadDetail();
    } else {
      void loadDashboard();
    }
    startAutoPoll();
  }

  function closePanel() {
    state.visible = false;
    stopAutoPoll();
    closeRenameForm();
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
  }

  function resetPanel() {
    state.requestSeq += 1;
    state.visibilitySeq += 1;
    state.weekStart = settlementWeekStart(localDateKey());
    state.lastResult = null;
    state.lastDetailResult = null;
    state.viewMode = 'ops';
    state.loading = false;
    state.renaming = false;
    stopAutoPoll();
    closePanel();
    // 로그인 화면에서는 main 자체가 숨겨지므로, 여기서 버튼을 숨기지 않는다.
    openBtn.hidden = false;
    notifyFeatureVisibility(false);
    applyCrewTitle('');
    if (periodEl) periodEl.textContent = '-';
    if (summaryEl) summaryEl.textContent = '';
    if (rowsEl) rowsEl.innerHTML = '';
    if (detailRowsEl) detailRowsEl.innerHTML = '';
    if (detailFootEl) detailFootEl.innerHTML = '';
    if (detailSummaryEl) detailSummaryEl.textContent = '';
    if (contentEl) contentEl.hidden = true;
    if (detailContentEl) detailContentEl.hidden = true;
    if (viewTabsEl) viewTabsEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    if (renameBtn) renameBtn.hidden = true;
  }

  function shiftWeek(delta) {
    const base = ensureWeekStart();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + delta * 7);
    state.weekStart = settlementWeekStart(localDateKey(date));
    state.lastDetailResult = null;
    if (state.viewMode === 'detail') void loadDetail({ force: true });
    else void loadDashboard({ force: true });
  }

  viewTabsEl?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-crew-view]');
    if (!btn || state.loading) return;
    const next = btn.dataset.crewView === 'detail' ? 'detail' : 'ops';
    if (next === state.viewMode) return;
    setViewMode(next);
    if (next === 'detail') {
      if (state.lastDetailResult?.weekStart === ensureWeekStart()) {
        renderDetailResult(state.lastDetailResult);
      } else {
        void loadDetail();
      }
    } else if (state.lastResult?.ok) {
      renderResult(state.lastResult);
    } else {
      void loadDashboard();
    }
  });

  openBtn.addEventListener('click', () => {
    if (state.visible) closePanel();
    else openPanel();
  });
  closeBtn?.addEventListener('click', closePanel);
  refreshBtn?.addEventListener('click', () => {
    state.lastDetailResult = null;
    if (state.viewMode === 'detail') void loadDetail({ force: true });
    else void loadDashboard({ force: true });
  });
  prevWeekBtn?.addEventListener('click', () => shiftWeek(-1));
  nextWeekBtn?.addEventListener('click', () => shiftWeek(1));
  renameBtn?.addEventListener('click', openRenameForm);
  renameCancelBtn?.addEventListener('click', closeRenameForm);
  renameForm?.addEventListener('submit', (event) => {
    void submitRename(event);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.visible) {
      if (state.viewMode === 'detail') void loadDetail();
      else void loadDashboard();
    }
  });

  document.addEventListener('brem-rider-session-ready', () => {
    void refreshEntryVisibility();
  });
  document.addEventListener('brem-driver-data-ready', () => {
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

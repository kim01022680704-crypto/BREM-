(function () {
  const panel = document.getElementById('driverBranchDashboardPanel');
  const openBtn = document.getElementById('driverBranchDashboardBtn');
  if (!panel || !openBtn) return;

  const closeBtn = document.getElementById('driverBranchDashboardCloseBtn');
  const refreshBtn = document.getElementById('driverBranchDashboardRefreshBtn');
  const regionSelect = document.getElementById('driverBranchDashboardRegion');
  const periodEl = document.getElementById('driverBranchDashboardPeriod');
  const regionLabelEl = document.getElementById('driverBranchDashboardRegionLabel');
  const emptyEl = document.getElementById('driverBranchDashboardEmpty');
  const contentEl = document.getElementById('driverBranchDashboardContent');
  const assignedEl = document.getElementById('driverBranchAssigned');
  const operatingEl = document.getElementById('driverBranchOperating');
  const registeredEl = document.getElementById('driverBranchRegistered');
  const weeklyRateEl = document.getElementById('driverBranchWeeklyRate');
  const weeklyBarEl = document.getElementById('driverBranchWeeklyBar');
  const weeklySummaryEl = document.getElementById('driverBranchWeeklySummary');
  const weeklyDaysEl = document.getElementById('driverBranchWeeklyDays');
  const riderListTitleEl = document.getElementById('driverBranchRiderListTitle');
  const riderListCountEl = document.getElementById('driverBranchRiderListCount');
  const riderSearchEl = document.getElementById('driverBranchRiderSearch');
  const riderListEl = document.getElementById('driverBranchRiderList');
  const noteEl = document.getElementById('driverBranchDashboardNote');
  const detailPopup = document.getElementById('driverBranchDetailPopup');
  const detailTitle = document.getElementById('driverBranchDetailTitle');
  const detailSummary = document.getElementById('driverBranchDetailSummary');
  const detailRows = document.getElementById('driverBranchDetailRows');
  const POLL_MS = 60 * 1000;

  const state = {
    visible: false,
    loading: false,
    platform: 'baemin',
    regionKey: '',
    weekStart: '',
    result: null,
    pollTimer: null,
    requestSeq: 0,
    authorized: { baemin: false, coupang: false }
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function settlementWeekStart(value) {
    if (window.BremDatePicker?.weekStartKey) {
      return window.BremDatePicker.weekStartKey(value || localDateKey());
    }
    const date = new Date(`${String(value || localDateKey()).slice(0, 10)}T00:00:00`);
    date.setDate(date.getDate() - ((date.getDay() - 3 + 7) % 7));
    return localDateKey(date);
  }

  function formatPeriod(start, end) {
    if (!start || !end) return '-';
    return `${start.slice(5).replace('-', '.')} ~ ${end.slice(5).replace('-', '.')}`;
  }

  function formatDayWithWeekday(value, options = {}) {
    const key = String(value || '').slice(0, 10);
    const date = new Date(`${key}T12:00:00`);
    const weekday = Number.isNaN(date.getTime()) ? '' : ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
    const liveMark = options.live ? ' 오늘' : '';
    return `${key.slice(5).replace('-', '.')}${weekday ? `(${weekday})` : ''}${liveMark}`;
  }

  function achievementTag(completed, goal) {
    const target = Number(goal || 0);
    const done = Number(completed || 0);
    if (target <= 0) return '<em class="driver-branch-achievement-tag is-empty">미설정</em>';
    const achieved = done >= target;
    return `<em class="driver-branch-achievement-tag ${achieved ? 'is-achieved' : 'is-missed'}">${achieved ? '달성' : '미달성'}</em>`;
  }

  function showToast(message) {
    const el = document.getElementById('toast');
    if (!el || !message) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function notifyVisibility(visible) {
    document.dispatchEvent(new CustomEvent('brem-driver-feature-visibility', {
      detail: { kind: 'branch', visible: Boolean(visible) }
    }));
  }

  function setEntryVisible(visible) {
    openBtn.hidden = !visible;
    notifyVisibility(visible);
    if (!visible) close();
  }

  function syncPlatformTabs() {
    panel.querySelectorAll('[data-branch-platform]').forEach(btn => {
      const active = btn.dataset.branchPlatform === state.platform;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.classList.toggle('is-unavailable', !state.authorized[btn.dataset.branchPlatform]);
    });
  }

  function renderRegions(regions, selectedKey) {
    if (!regionSelect) return;
    regionSelect.innerHTML = regions.length
      ? regions.map(region => `<option value="${escapeHtml(region.key)}"${region.key === selectedKey ? ' selected' : ''}>${escapeHtml(region.label || region.key)}</option>`).join('')
      : '<option value="">담당 지역 없음</option>';
    regionSelect.disabled = !regions.length;
  }

  function renderRiderList(result) {
    const baemin = result.platform === 'baemin';
    const rows = baemin ? (result.operatingRiders || []) : (result.performanceRiders || []);
    const query = String(riderSearchEl?.value || '').trim().toLocaleLowerCase('ko-KR');
    const visibleRows = query
      ? rows.filter(row => String(row.name || '').toLocaleLowerCase('ko-KR').includes(query))
      : rows;
    if (riderListTitleEl) riderListTitleEl.textContent = baemin ? '현재 운행 기사' : '오늘 실적 기사';
    if (riderListCountEl) {
      riderListCountEl.textContent = query
        ? `${formatNumber(visibleRows.length)} / ${formatNumber(rows.length)}명`
        : `${formatNumber(rows.length)}명`;
    }
    if (!riderListEl) return;
    riderListEl.innerHTML = visibleRows.length
      ? visibleRows.map(row => {
        const rate = baemin ? row.acceptRate : row.rejectionRate;
        const rateText = rate == null ? '-' : `${formatNumber(rate)}%`;
        return `<button type="button" class="driver-branch-rider" data-branch-rider-detail>
          <span class="driver-branch-rider__info"><strong>${escapeHtml(row.name || '-')}</strong><small>${escapeHtml(baemin ? (row.status || '운행중') : `거절 ${formatNumber(row.rejectCount)} · 취소 ${formatNumber(row.cancelCount)}`)}</small></span>
          <span class="driver-branch-rider__metrics"><em>${baemin ? '수락' : '거절'} ${rateText}</em><b>${formatNumber(row.callCount)}콜</b></span>
        </button>`;
      }).join('')
      : `<p class="driver-branch-empty-list">${query ? '검색된 기사가 없습니다.' : (baemin ? '현재 운행 중으로 매칭된 기사가 없습니다.' : '오늘 실적이 있는 기사가 없습니다.')}</p>`;
  }

  function renderWeekly(progress) {
    const goal = Number(progress?.goal || 0);
    const completed = Number(progress?.completed || 0);
    const rate = Number(progress?.rate || 0);
    if (weeklyRateEl) weeklyRateEl.textContent = `${formatNumber(rate)}%`;
    if (weeklySummaryEl) weeklySummaryEl.textContent = `주간 합계 ${formatNumber(completed)} / ${formatNumber(goal)}콜 · ${formatNumber(rate)}%`;
    if (weeklyBarEl) weeklyBarEl.style.width = `${Math.max(0, Math.min(100, rate))}%`;
    const days = Array.isArray(progress?.days) ? progress.days : [];
    if (weeklyDaysEl) {
      weeklyDaysEl.innerHTML = days.map(day => {
        const dayRate = Number(day.goal) > 0 ? Math.round((Number(day.completed || 0) / Number(day.goal)) * 100) : 0;
        return `<div><span>${escapeHtml(String(day.date || '').slice(5).replace('-', '.'))}</span><strong>${formatNumber(day.completed)}/${formatNumber(day.goal)}</strong><small>${formatNumber(dayRate)}%</small></div>`;
      }).join('');
    }
  }

  function render(result) {
    state.result = result;
    const regions = Array.isArray(result?.regions) ? result.regions : [];
    state.regionKey = result?.selectedRegionKey || '';
    state.weekStart = result?.weekStart || state.weekStart;
    renderRegions(regions, state.regionKey);
    syncPlatformTabs();
    if (periodEl) periodEl.textContent = formatPeriod(result?.weekStart, result?.weekEnd);
    if (regionLabelEl) regionLabelEl.textContent = result?.region?.label || '-';
    const empty = !result?.isBranchManager || !regions.length;
    if (emptyEl) {
      emptyEl.hidden = !empty;
      const p = emptyEl.querySelector('p');
      if (p) p.textContent = result?.message || '이 플랫폼에서 등록된 지사장 권한이 없습니다.';
    }
    if (contentEl) contentEl.hidden = empty;
    if (empty) return;

    const metrics = result.metrics || {};
    if (assignedEl) assignedEl.textContent = metrics.progressLabel || `${formatNumber(metrics.slotComplete)}/${formatNumber(metrics.assigned)}`;
    if (operatingEl) operatingEl.textContent = `${formatNumber(metrics.operating)}명`;
    if (registeredEl) registeredEl.textContent = `${formatNumber(result.registeredCount)}명`;
    renderWeekly(result.weeklyProgress || {});
    renderRiderList(result);
    if (noteEl) {
      noteEl.textContent = result.platform === 'coupang'
        ? '쿠팡은 크롤 원본 제한으로 온라인 기사 이름 대신 지역 온라인 인원수와 오늘 실적 기사 목록을 표시합니다.'
        : '배민 운행 기사명은 배달현황 크롤과 ERP 지역 배정을 매칭한 결과입니다.';
    }
  }

  async function load({ silent = false } = {}) {
    if (!window.BremStorage?.fetchRiderBranchDashboardFromServer) return;
    const seq = ++state.requestSeq;
    state.loading = true;
    if (!silent) panel.classList.add('is-loading');
    try {
      state.weekStart = settlementWeekStart(state.weekStart || localDateKey());
      const result = await window.BremStorage.fetchRiderBranchDashboardFromServer({
        platform: state.platform,
        regionKey: state.regionKey,
        weekStart: state.weekStart
      });
      if (seq !== state.requestSeq) return;
      render(result);
    } catch (error) {
      if (!silent) showToast(error.message || '지사관리 현황을 불러오지 못했습니다.');
    } finally {
      if (seq === state.requestSeq) {
        state.loading = false;
        panel.classList.remove('is-loading');
      }
    }
  }

  async function refreshEntryVisibility() {
    if (!window.BremStorage?.fetchRiderBranchDashboardFromServer) return;
    try {
      const weekStart = settlementWeekStart(localDateKey());
      const [baemin, coupang] = await Promise.all([
        window.BremStorage.fetchRiderBranchDashboardFromServer({ platform: 'baemin', weekStart }),
        window.BremStorage.fetchRiderBranchDashboardFromServer({ platform: 'coupang', weekStart })
      ]);
      state.authorized.baemin = Boolean(baemin?.isBranchManager && baemin.regions?.length);
      state.authorized.coupang = Boolean(coupang?.isBranchManager && coupang.regions?.length);
      const visible = state.authorized.baemin || state.authorized.coupang;
      if (!state.authorized[state.platform]) {
        state.platform = state.authorized.coupang ? 'coupang' : 'baemin';
        state.regionKey = '';
      }
      setEntryVisible(visible);
      syncPlatformTabs();
    } catch (_) {
      // 네트워크 실패 때 기존 노출 상태를 유지한다.
    }
  }

  function openOperatingDetail() {
    const result = state.result;
    if (!result || !detailPopup) return;
    detailPopup.querySelector('.driver-branch-detail-popup__dialog')?.classList.remove('is-erp');
    const baemin = result.platform === 'baemin';
    const rows = baemin ? (result.operatingRiders || []) : (result.performanceRiders || []);
    if (detailTitle) detailTitle.textContent = baemin ? '현재 운행 기사' : '쿠팡 오늘 실적 기사';
    if (detailSummary) {
      detailSummary.textContent = baemin
        ? `운행중 ${formatNumber(result.metrics?.operating)}명 · ERP 매칭 ${formatNumber(rows.length)}명`
        : `지역 온라인 ${formatNumber(result.metrics?.operating)}명 · 오늘 실적 확인 ${formatNumber(rows.length)}명`;
    }
    if (detailRows) {
      detailRows.innerHTML = rows.length
        ? rows.map(row => {
          const rate = baemin ? row.acceptRate : row.rejectionRate;
          const rateLabel = `${baemin ? '수락' : '거절'} ${rate == null ? '-' : `${formatNumber(rate)}%`}`;
          return `<div class="driver-branch-detail-row"><strong>${escapeHtml(row.name || '-')}</strong><span>${baemin ? `${escapeHtml(row.status || '운행중')} · ${rateLabel}` : `완료 ${formatNumber(row.callCount)} · ${rateLabel}`}</span></div>`;
        }).join('')
        : '<p class="driver-branch-empty-list">표시할 기사 상세가 없습니다.</p>';
    }
    detailPopup.hidden = false;
  }

  function openWeeklyDetail() {
    const result = state.result;
    if (!result || !detailPopup) return;
    detailPopup.querySelector('.driver-branch-detail-popup__dialog')?.classList.add('is-erp');
    const progress = result.weeklyProgress || {};
    const days = Array.isArray(progress.days) ? progress.days : [];
    const slotLabels = days.find(day => Array.isArray(day.slots) && day.slots.length)?.slots || [];
    if (detailTitle) {
      detailTitle.textContent = `${result.region?.label || ''} ERP 타임별 할당 대시보드`;
    }
    if (detailSummary) {
      detailSummary.textContent = `${formatPeriod(result.weekStart, result.weekEnd)} · ${formatNumber(progress.completed)} / ${formatNumber(progress.goal)}콜 · 달성 ${formatNumber(progress.rate)}% · 오늘은 실시간`;
    }
    if (detailRows) {
      detailRows.innerHTML = days.length && slotLabels.length
        ? `<div class="driver-branch-erp-kpis">
            <div><span>현재 완료</span><strong>${formatNumber(result.metrics?.slotComplete)}콜</strong></div>
            <div><span>현재 할당</span><strong>${formatNumber(result.metrics?.assigned)}콜</strong></div>
            <div><span>운행중</span><strong>${formatNumber(result.metrics?.operating)}명</strong></div>
          </div>
          <div class="driver-branch-erp-table-wrap">
            <table class="driver-branch-erp-table">
              <thead><tr><th>날짜</th>${slotLabels.map(slot => `<th>${escapeHtml(slot.label)}</th>`).join('')}<th>합계</th></tr></thead>
              <tbody>${days.map(day => {
                const slots = Array.isArray(day.slots) ? day.slots : [];
                return `<tr>
                  <th>${escapeHtml(formatDayWithWeekday(day.date, { live: day.live || day.date === result.today }))}</th>
                  ${slotLabels.map(header => {
                    const slot = slots.find(item => item.key === header.key) || {};
                    return `<td class="${Number(slot.rate) >= 100 ? 'is-achieved' : ''}"><strong>${formatNumber(slot.completed)}/${formatNumber(slot.goal)}</strong><small>${formatNumber(slot.rate)}%</small>${achievementTag(slot.completed, slot.goal)}</td>`;
                  }).join('')}
                  <td class="is-total"><strong>${formatNumber(day.completed)}/${formatNumber(day.goal)}</strong><small>${Number(day.goal) > 0 ? formatNumber(Math.round((Number(day.completed || 0) / Number(day.goal)) * 100)) : 0}%</small>${achievementTag(day.completed, day.goal)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>`
        : '<p class="driver-branch-empty-list">수집된 주간 타임별 할당 데이터가 없습니다.</p>';
    }
    detailPopup.hidden = false;
  }

  function closeDetail() {
    if (detailPopup) {
      detailPopup.hidden = true;
      detailPopup.querySelector('.driver-branch-detail-popup__dialog')?.classList.remove('is-erp');
    }
  }

  function open() {
    window.BremDriverWithdrawal?.close?.();
    window.BremDriverWeeklyPayslip?.close?.();
    window.BremDriverRegionDashboard?.close?.();
    window.BremDriverCrewLeader?.close?.();
    state.visible = true;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void load();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (state.visible && document.visibilityState !== 'hidden') void load({ silent: true });
    }, POLL_MS);
  }

  function close() {
    state.visible = false;
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    closeDetail();
  }

  function reset() {
    state.requestSeq += 1;
    state.platform = 'baemin';
    state.regionKey = '';
    state.weekStart = '';
    state.result = null;
    state.authorized = { baemin: false, coupang: false };
    close();
    setEntryVisible(false);
  }

  openBtn.addEventListener('click', () => state.visible ? close() : open());
  closeBtn?.addEventListener('click', close);
  refreshBtn?.addEventListener('click', () => void load());
  regionSelect?.addEventListener('change', () => {
    state.regionKey = regionSelect.value || '';
    void load();
  });
  riderSearchEl?.addEventListener('input', () => {
    if (state.result) renderRiderList(state.result);
  });
  panel.addEventListener('click', event => {
    const tab = event.target.closest('[data-branch-platform]');
    if (!tab) return;
    const platform = tab.dataset.branchPlatform;
    if (!['baemin', 'coupang'].includes(platform) || platform === state.platform) return;
    state.platform = platform;
    state.regionKey = '';
    if (riderSearchEl) riderSearchEl.value = '';
    syncPlatformTabs();
    void load();
  });
  document.getElementById('driverBranchOperatingDetailBtn')?.addEventListener('click', openOperatingDetail);
  document.getElementById('driverBranchErpDashboardBtn')?.addEventListener('click', openWeeklyDetail);
  detailPopup?.addEventListener('click', event => {
    if (event.target.closest('[data-branch-detail-close]')) closeDetail();
  });

  window.BremDriverBranchDashboard = {
    open,
    close,
    reset,
    reload: load,
    refreshEntryVisibility
  };

  void refreshEntryVisibility();
})();

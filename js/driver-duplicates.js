(async function () {
  const {
    makeDriverLoginId,
    formatDate,
    escapeHtml,
    statusClass,
    buildDriverDuplicateSections,
    updateDriverTotal,
    showToast
  } = window.BremDriverUtils;

  const duplicateTabs = document.getElementById('duplicateTabs');
  const duplicateGroups = document.getElementById('duplicateGroups');
  const duplicateSummary = document.getElementById('duplicateSummary');
  const duplicateEmptyState = document.getElementById('duplicateEmptyState');
  const refreshBtn = document.getElementById('refreshDuplicatesBtn');
  const listLoadingBanner = document.getElementById('bremDataLoading');
  const driverTotal = document.getElementById('driverTotal');
  const toast = document.getElementById('toast');

  if (!duplicateTabs || !duplicateGroups) return;

  let activeSectionId = 'phone';
  let sections = [];
  let listLoadPromise = null;

  function finishListLoading(options = {}) {
    window.BremLoadingUI?.forceHide?.(listLoadingBanner);
    if (!listLoadingBanner) return;

    if (options.error) {
      window.BremLoadingUI?.showStatus(listLoadingBanner, {
        type: 'error',
        message: options.error
      });
      return;
    }

    if (options.success) {
      window.BremLoadingUI?.showStatus(listLoadingBanner, {
        type: 'success',
        message: options.success,
        autoHideMs: 2500
      });
    }
  }

  function isDriverListCacheReady() {
    const cacheStatus = BremStorage.getCacheStatus?.() || {};
    return Boolean(cacheStatus.driversComplete && BremStorage.drivers.getAll().length > 0);
  }

  async function loadAllDrivers(force = false) {
    if (listLoadPromise && !force) return listLoadPromise;

    await BremStorage.waitForDriversFetch?.();

    const cacheStatus = BremStorage.getCacheStatus?.() || {};
    const hasCompleteCache = cacheStatus.driversComplete && BremStorage.drivers.getAll().length > 0;

    if (!force && hasCompleteCache) {
      renderAll();
      return {
        ok: true,
        cached: true,
        count: BremStorage.drivers.getAll().length
      };
    }

    const runLoad = async () => {
      const result = await BremStorage.fetchAllDriversFromServer?.({ force, view: 'list' })
        || await BremStorage.reloadDrivers?.(force);

      if (result?.ok === false && !BremStorage.drivers.getAll().length) {
        finishListLoading({
          error: result.message || 'Supabase에서 기사 목록을 불러오지 못했습니다.'
        });
        showToast(toast, result.message || '기사 목록을 불러오지 못했습니다.');
        return result;
      }

      renderAll();
      return result;
    };

    listLoadPromise = runLoad().finally(() => {
      listLoadPromise = null;
    });

    return listLoadPromise;
  }

  async function refreshDriverList(force = false) {
    const cacheReady = isDriverListCacheReady();
    const needsNetwork = force || !cacheReady;

    try {
      if (needsNetwork) {
        window.BremLoadingUI?.show(
          listLoadingBanner,
          cacheReady ? '동일 리스트 새로고침 중...' : 'Supabase에서 기사 목록 불러오는 중...'
        );
      }

      const syncResult = await loadAllDrivers(force);
      const count = syncResult?.count
        || BremStorage.drivers.getSupabaseTotal?.()
        || BremStorage.drivers.getAll().length;

      if (syncResult?.ok === false) {
        finishListLoading({
          error: syncResult.message || '불러오기 실패 · 다시 시도 필요'
        });
        return syncResult;
      }

      if (needsNetwork || syncResult?.cached) {
        finishListLoading({
          success: `기사 목록 불러오기 완료 · ${count}명`
        });
      } else {
        finishListLoading();
      }

      return syncResult;
    } catch (error) {
      finishListLoading({
        error: error.message || '불러오기 실패 · 다시 시도 필요'
      });
      throw error;
    }
  }

  function renderMemberRow(driver) {
    const coupangId = escapeHtml(makeDriverLoginId(driver) || '-');
    const baeminId = escapeHtml(driver.baeminId || '-');
    return `
      <tr>
        <td class="col-name"><strong>${escapeHtml(driver.name)}</strong></td>
        <td class="col-phone">${escapeHtml(driver.phone || '-')}</td>
        <td class="col-coupang">${coupangId}</td>
        <td class="col-baemin">${baeminId}</td>
        <td class="col-status"><span class="badge badge--compact ${statusClass(driver.status)}">${escapeHtml(driver.status || '-')}</span></td>
        <td class="col-date">${formatDate(driver.joinDate)}</td>
        <td class="col-actions">
          <a class="btn small edit" href="rider-manage.html?edit=${encodeURIComponent(driver.id)}">수정</a>
        </td>
      </tr>
    `;
  }

  function renderMemberCard(driver) {
    const coupangId = escapeHtml(makeDriverLoginId(driver) || '-');
    const baeminId = escapeHtml(driver.baeminId || '-');
    return `
      <article class="duplicate-member-card">
        <div class="duplicate-member-card__main">
          <strong>${escapeHtml(driver.name)}</strong>
          <span class="badge badge--compact ${statusClass(driver.status)}">${escapeHtml(driver.status || '-')}</span>
        </div>
        <dl class="duplicate-member-card__meta">
          <div><dt>연락처</dt><dd>${escapeHtml(driver.phone || '-')}</dd></div>
          <div><dt>쿠팡 ID</dt><dd>${coupangId}</dd></div>
          <div><dt>배민 ID</dt><dd>${baeminId}</dd></div>
          <div><dt>가입일</dt><dd>${formatDate(driver.joinDate)}</dd></div>
        </dl>
        <a class="btn small edit" href="rider-manage.html?edit=${encodeURIComponent(driver.id)}">수정</a>
      </article>
    `;
  }

  function renderGroupCard(group) {
    const memberCount = group.members.length;
    return `
      <article class="duplicate-group-card" aria-label="${escapeHtml(group.label)}">
        <header class="duplicate-group-card__head">
          <div>
            <h3 class="duplicate-group-card__title">${escapeHtml(group.label)}</h3>
            <p class="duplicate-group-card__meta">${memberCount}명 중복</p>
          </div>
          <span class="duplicate-group-card__count">${memberCount}명</span>
        </header>
        <div class="duplicate-member-cards" aria-label="${escapeHtml(group.label)} 기사 목록">
          ${group.members.map(renderMemberCard).join('')}
        </div>
        <div class="table-wrap duplicate-group-card__table">
          <table class="driver-table driver-table--compact">
            <thead>
              <tr>
                <th class="col-name">이름</th>
                <th class="col-phone">연락처</th>
                <th class="col-coupang">쿠팡 ID</th>
                <th class="col-baemin">배민 ID</th>
                <th class="col-status">상태</th>
                <th class="col-date">가입일</th>
                <th class="col-actions">관리</th>
              </tr>
            </thead>
            <tbody>${group.members.map(renderMemberRow).join('')}</tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderTabs() {
    duplicateTabs.innerHTML = sections.map(section => {
      const active = section.id === activeSectionId;
      const countLabel = section.groupCount ? `${section.groupCount}그룹` : '없음';
      return `
        <button
          type="button"
          class="duplicate-tab${active ? ' active' : ''}"
          role="tab"
          aria-selected="${active ? 'true' : 'false'}"
          data-section-id="${escapeHtml(section.id)}"
        >
          <span class="duplicate-tab__label">${escapeHtml(section.title)}</span>
          <span class="duplicate-tab__count">${countLabel}</span>
        </button>
      `;
    }).join('');
  }

  function renderGroups() {
    const section = sections.find(item => item.id === activeSectionId) || sections[0];
    updateDriverTotal(driverTotal);

    if (!section) {
      duplicateSummary.textContent = '';
      duplicateGroups.innerHTML = '';
      duplicateEmptyState.hidden = false;
      return;
    }

    duplicateSummary.textContent = section.groupCount
      ? `${section.title} 기준 ${section.groupCount}개 그룹 · ${section.riderCount}명`
      : `${section.title} 기준 중복 없음`;

    if (!section.groups.length) {
      duplicateGroups.innerHTML = '';
      duplicateEmptyState.hidden = false;
      duplicateEmptyState.textContent = `${section.title} 기준으로 표시할 중복 그룹이 없습니다.`;
      return;
    }

    duplicateEmptyState.hidden = true;
    duplicateGroups.innerHTML = section.groups.map(group => renderGroupCard(group)).join('');
  }

  function renderAll() {
    sections = buildDriverDuplicateSections(BremStorage.drivers.getAll());
    if (!sections.some(item => item.id === activeSectionId)) {
      activeSectionId = sections[0]?.id || 'phone';
    }
    renderTabs();
    renderGroups();
  }

  function handleTabClick(event) {
    const button = event.target.closest('[data-section-id]');
    if (!button) return;
    activeSectionId = button.dataset.sectionId;
    renderTabs();
    renderGroups();
  }

  function init() {
    duplicateTabs.addEventListener('click', handleTabClick);
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => { void refreshDriverList(true); });
    }

    document.addEventListener('brem-drivers-sync-ready', event => {
      if (!event?.detail?.complete) return;
      renderAll();
      const count = event.detail.count || BremStorage.drivers.getAll().length;
      if (listLoadingBanner?.classList.contains('is-visible')
        && !listLoadingBanner.classList.contains('brem-data-loading--success')) {
        finishListLoading({
          success: `기사 목록 불러오기 완료 · ${count}명`
        });
      }
    });

    document.addEventListener('brem-cache-status-changed', () => {
      if (BremStorage.drivers.getAll().length) renderAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  if (!(await window.BremDriverProgramAccess?.ensure?.())) return;

  await new Promise(resolve => {
    if (document.readyState !== 'loading') {
      resolve();
      return;
    }
    document.addEventListener('DOMContentLoaded', resolve, { once: true });
  });

  await new Promise(resolve => {
    const finish = () => resolve();
    if (BremStorage.getStorageStatus?.()?.supabaseHydrated) {
      finish();
      return;
    }
    document.addEventListener('brem-storage-ready', finish, { once: true });
    setTimeout(finish, 12000);
  });

  if (isDriverListCacheReady()) {
    renderAll();
  }

  void refreshDriverList(false);
})();

(function () {
  const selectedCallIds = new Set();
  const selectedRejectionIds = new Set();
  let targetMonthPicker = null;
  const CALL_RECORDS_VISIBLE_LIMIT = 30;

  const state = {
    currentSection: 'dashboard',
    editingNoticeId: '',
    editingAdminAccountId: '',
    adminAccountFormMode: '',
    rejectionWeekByPlatform: { coupang: null, baemin: null },
    driverSearchQuery: '',
    dashboardSearchQuery: '',
    dashboardWeekStart: '',
    eventSettingsSearchQuery: '',
    missionResultsSearchQuery: '',
    dashboardSort: { key: 'totalWeekCalls', dir: 'desc' },
    missionResultsSort: { key: 'rate', dir: 'desc' },
    eventSettingsSort: { key: 'name', dir: 'asc' },
    settlementPreviewByPlatform: { coupang: null, baemin: null },
    settlementLogWeekByPlatform: { coupang: null, baemin: null },
    settlementUnmatchedWeekByPlatform: { coupang: null, baemin: null },
    settlementHistoryDayByPlatform: { coupang: null, baemin: null },
    settlementUploadLogDetailId: '',
    settlementHistorySearchByPlatform: { coupang: '', baemin: '' },
    callRecordsSearchByPlatform: { coupang: '', baemin: '' },
    unifiedPlatform: { calls: 'coupang', rejections: 'coupang', settlements: 'coupang', 'weekly-settlement': 'coupang' }
  };

  const eventSettingsDrafts = new Map();
  const eventSettingsDirty = new Set();

  async function persistAndRender(label, writeFn, renderFn) {
    if (window.BremPerf?.runSave) {
      return window.BremPerf.runSave(label, {
        write: async () => {
          const result = writeFn();
          await (BremStorage.awaitPersist?.(result) || BremStorage.flushStorage?.() || Promise.resolve());
        },
        render: () => {
          if (typeof renderFn === 'function') renderFn();
        }
      });
    }
    const result = writeFn();
    await (BremStorage.awaitPersist?.(result) || BremStorage.flushStorage?.() || Promise.resolve());
    if (typeof renderFn === 'function') renderFn();
  }

  let callStatsIndex = null;
  let callStatsIndexKey = '';
  const driverSelectOptionsCache = new Map();
  const sectionRenderFingerprints = new Map();
  let pendingSectionNavRaf = 0;

  const UNIFIED_SECTIONS = {
    calls: { title: '콜수 입력', defaultPlatform: 'coupang' },
    rejections: { title: '거절율 입력', defaultPlatform: 'coupang' },
    settlements: { title: '일정산서 업로드', defaultPlatform: 'coupang' },
    'weekly-settlement': { title: '주정산서 업로드', defaultPlatform: 'coupang' }
  };

  const DRIVER_FILTERED_SECTIONS = new Set([
    'calls',
    'rejections',
    'targets',
    'settlements'
  ]);

  const DRIVER_SEARCH_SECTIONS = new Set([
    'calls',
    'rejections',
    'targets',
    'settlements'
  ]);

  const LEGACY_SECTION_MAP = {
    'calls-coupang': { section: 'calls', platform: 'coupang' },
    'calls-baemin': { section: 'calls', platform: 'baemin' },
    'rejections-coupang': { section: 'rejections', platform: 'coupang' },
    'rejections-baemin': { section: 'rejections', platform: 'baemin' },
    'settlements-coupang': { section: 'settlements', platform: 'coupang' },
    'settlements-baemin': { section: 'settlements', platform: 'baemin' },
    'weekly-settlement-coupang': { section: 'weekly-settlement', platform: 'coupang' },
    'weekly-settlement-baemin': { section: 'weekly-settlement', platform: 'baemin' }
  };

  const PLATFORMS = BremPlatforms.all().map(item => item.id);
  const Sort = window.BremTableSort;

  const dashboardSortSchema = {
    name: entry => entry.driver.name,
    phone: entry => entry.driver.phone,
    platform: entry => `${entry.driver.platformCoupang !== false ? 1 : 0}${entry.driver.platformBaemin ? 1 : 0}`,
    coupangWeekCalls: { get: entry => entry.coupangWeekCalls, type: 'number' },
    baeminWeekCalls: { get: entry => entry.baeminWeekCalls, type: 'number' },
    totalWeekCalls: { get: entry => entry.totalWeekCalls, type: 'number' },
    coupangRejectionRate: { get: entry => entry.coupangRejectionSort, type: 'number' },
    baeminRejectionRate: { get: entry => entry.baeminRejectionSort, type: 'number' },
    monthlyCallCount: { get: entry => entry.monthlyCallCount, type: 'number' },
    eventRate: { get: entry => eventDriverStats(entry.driver).rate, type: 'number' }
  };

  const missionResultsSortSchema = {
    name: entry => entry.driver.name,
    phone: entry => entry.driver.phone,
    item: entry => entry.stats.item?.name || '',
    platform: entry => longEventPlatformLabel(entry.stats.platform),
    startDate: { get: entry => entry.stats.startDate, type: 'date' },
    total: { get: entry => entry.stats.total, type: 'number' },
    target: { get: entry => entry.stats.target, type: 'number' },
    rate: { get: entry => entry.stats.rate, type: 'number' },
    status: {
      get: entry => ({ achieved: 0, 'in-progress': 1, 'no-start': 2, unset: 3 }[entry.stats.status] ?? 9),
      type: 'number'
    }
  };

  const eventSettingsSortSchema = {
    name: driver => driver.name,
    item: driver => (eventItemFor(driver)?.name || driver.longEventItem || ''),
    platform: driver => BremStorage.events.getDriverEventPlatform(driver),
    startDate: { get: driver => driver.longEventStartDate || '', type: 'date' }
  };

  function initTableSorting() {
    if (!Sort) return;

    Sort.bind(document.querySelector('[data-sort-table="dashboard"]'), state.dashboardSort, () => {
      renderDashboard();
    });
    Sort.bind(document.querySelector('[data-sort-table="mission-results"]'), state.missionResultsSort, () => {
      renderMissionResults();
    });
    Sort.bind(document.querySelector('[data-sort-table="event-settings"]'), state.eventSettingsSort, () => {
      renderMissions();
    });

    Sort.markScope(document.querySelector('[data-sort-table="dashboard"]'), state.dashboardSort);
    Sort.markScope(document.querySelector('[data-sort-table="mission-results"]'), state.missionResultsSort);
    Sort.markScope(document.querySelector('[data-sort-table="event-settings"]'), state.eventSettingsSort);
  }

  function platformLabel(platform) {
    return BremPlatforms.label(platform);
  }

  function platformRateLabel(platform) {
    return BremPlatforms.rateLabel(platform);
  }

  function normalizePlatform(platform) {
    return BremPlatforms.normalize(platform);
  }

  const ADMIN_MENU_OPTIONS = [
    { id: 'notices', label: '공지사항' },
    { id: 'rider-inquiries', label: '라이더 문의' },
    { id: 'dashboard', label: '대시보드' },
    { id: 'admin-schedule', label: '관리자 스케줄표' },
    { id: 'mission-results', label: '장기근속이벤트 결과' },
    { id: 'missions', label: '장기근속이벤트' },
    { id: 'mission-management', label: '미션 관리' },
    { id: 'lease-management', label: '리스 관리' },
    { id: 'calls', label: '콜수 입력' },
    { id: 'baemin-delivery-status', label: '배민Biz 배달현황' },
    { id: 'rejections', label: '거절율 입력' },
    { id: 'targets', label: '목표 콜수' },
    { id: 'promotions', label: '프로모션 관리' },
    { id: 'promotion-apply', label: '프로모션 적용' },
    { id: 'settlements', label: '일정산서 업로드' },
    { id: 'weekly-settlement', label: '주정산서 업로드' },
    { id: 'admin-account', label: '관리자 계정' },
    { id: 'revenue-management', label: '수익 관리' },
    { id: 'payroll-slips', label: '급여명세서' },
    { id: 'payroll-daily-settlement', label: '급여 일정산' },
    { id: 'data-backup', label: '데이터 백업' }
  ];

  const ADMIN_ROLES = BremStorage.auth.ADMIN_ROLES;

  const adminRoleLabelMap = BremStorage.auth.ADMIN_ROLE_LABELS;

  function getSessionAdminAccount() {
    return BremStorage.auth.getAdminSessionAccount();
  }

  function getSessionAdminRole() {
    return getSessionAdminAccount()?.role || ADMIN_ROLES.MANAGER;
  }

  function canCreateAdminAccount() {
    return getSessionAdminRole() === ADMIN_ROLES.CEO;
  }

  function canDeleteAdminAccount() {
    return getSessionAdminRole() === ADMIN_ROLES.CEO;
  }

  function canEditAdminAccountMenus(account) {
    const role = getSessionAdminRole();
    if (role === ADMIN_ROLES.CEO) return true;
    if (role === ADMIN_ROLES.DIRECTOR) return account.role === ADMIN_ROLES.MANAGER;
    return false;
  }

  function canFullyEditAdminAccount() {
    return getSessionAdminRole() === ADMIN_ROLES.CEO;
  }

  function adminRoleBadgeClass(role) {
    if (role === ADMIN_ROLES.CEO) return 'admin-role-badge admin-role-badge--ceo';
    if (role === ADMIN_ROLES.DIRECTOR) return 'admin-role-badge admin-role-badge--director';
    return 'admin-role-badge admin-role-badge--manager';
  }

  function applyAdminAccountFormMode(mode) {
    const isCreate = mode === 'create';
    const isMenuOnly = mode === 'menu-only';
    const isFullEdit = mode === 'full-edit';

    $('#adminAccountRoleWrap').hidden = !isCreate && !isFullEdit;
    $('#adminAccountRoleHelp').hidden = isMenuOnly;
    $('#adminAccountPasswordWrap').hidden = isMenuOnly;
    $('#adminAccountPasswordConfirmWrap').hidden = isMenuOnly;
    $('#adminAccountActiveWrap').hidden = !isCreate && !isFullEdit;
    $('#adminAccountName').readOnly = isMenuOnly;
  }

  function updateAdminAccountSectionAccess() {
    const role = getSessionAdminRole();
    const createBtn = $('#adminAccountCreateBtn');
    const intro = $('#adminAccountIntro');

    if (createBtn) createBtn.hidden = !canCreateAdminAccount();

    if (intro) {
      if (role === ADMIN_ROLES.CEO) {
        intro.textContent = '대표: 관리자 계정 생성·직책 지정·접근 메뉴 설정이 모두 가능합니다.';
      } else if (role === ADMIN_ROLES.DIRECTOR) {
        intro.textContent = '총괄: 팀장 계정의 접근 메뉴만 수정할 수 있습니다.';
      } else {
        intro.textContent = '팀장: 관리자 계정과 접근 메뉴를 조회만 할 수 있습니다.';
      }
    }
  }

  const adminMenuLabelMap = Object.fromEntries(
    ADMIN_MENU_OPTIONS.map(option => [option.id, option.label])
  );

  function getCurrentAdminMenus() {
    return BremStorage.auth.getAdminSessionMenus();
  }

  function canAccessAdminSection(sectionId) {
    return getCurrentAdminMenus().includes(sectionId);
  }

  function applyAdminMenuPermissions() {
    const allowed = new Set(getCurrentAdminMenus());
    $$('.nav-btn[data-section]').forEach(button => {
      button.hidden = !allowed.has(button.dataset.section);
    });
  }

  function getCurrentAdminEditableMenus() {
    return BremStorage.auth.getAdminSessionEditableMenus();
  }

  function canEditCurrentAdminSection(sectionId = state.currentSection) {
    return getCurrentAdminEditableMenus().includes(sectionId);
  }

  function isViewOnlyAllowedControl(element) {
    if (!element) return false;
    if (element.dataset.readonlyAllow === 'true') return true;
    if (element.matches('input[type="search"]')) return true;
    const id = String(element.id || '');
    if (id && /SearchClear$/i.test(id)) return true;
    if (element.dataset.readonlyAllowFilter === 'true') return true;
    return false;
  }

  function applySectionEditPermissions() {
    $$('.section').forEach(section => {
      const isActive = section.classList.contains('active');
      const sectionCanEdit = isActive ? canEditCurrentAdminSection(section.id) : true;

      section.querySelectorAll('input, select, textarea, button').forEach(element => {
        if (element.closest('#adminAccountFormCard')) return;
        if (section.id === 'admin-account' && canFullyEditAdminAccount()) {
          element.disabled = false;
          element.classList.remove('admin-view-only-field');
          return;
        }
        if (element.id === 'menuBtn' || element.id === 'adminLogoutBtn') return;
        if (element.classList.contains('nav-btn')) return;
        if (isViewOnlyAllowedControl(element)) {
          element.disabled = false;
          element.classList.remove('admin-view-only-field');
          return;
        }

        if (!isActive) {
          element.disabled = false;
          element.classList.remove('admin-view-only-field');
          return;
        }

        const isField = element.matches('input, select, textarea');
        const isSaveAction = element.type === 'submit'
          || element.classList.contains('primary-btn')
          || element.classList.contains('danger-btn');

        if (!sectionCanEdit && (isField || isSaveAction)) {
          element.disabled = true;
          element.classList.add('admin-view-only-field');
        } else if (isField || element.tagName === 'BUTTON') {
          element.disabled = false;
          element.classList.remove('admin-view-only-field');
        }
      });

      let banner = section.querySelector('.admin-view-only-banner');
      if (isActive && !sectionCanEdit) {
        if (!banner) {
          banner = document.createElement('p');
          banner.className = 'admin-view-only-banner';
          banner.textContent = '이 메뉴는 조회 전용입니다. 기사 검색은 가능하며, 입력·저장하려면 수정 권한이 필요합니다.';
          section.prepend(banner);
        }
      } else if (banner) {
        banner.remove();
      }
    });
  }

  function getSelectedAdminAccountMenus() {
    return getMenuPermissionsFromGrid().menus;
  }

  function getSelectedAdminAccountEditableMenus() {
    return getMenuPermissionsFromGrid().editableMenus;
  }

  function syncAdminAccountMenuRow(row) {
    if (!row) return;
    const accessInput = row.querySelector('.menu-access-cb');
    const editInput = row.querySelector('.menu-edit-cb');
    const hasAccess = !!accessInput?.checked;
    const hasEdit = hasAccess && !!editInput?.checked;

    if (editInput) {
      editInput.disabled = !hasAccess;
      if (!hasAccess) editInput.checked = false;
    }

    row.classList.toggle('is-active', hasAccess);
    row.classList.toggle('is-edit', hasEdit);
    row.classList.toggle('is-view-only', hasAccess && !hasEdit);
  }

  function getMenuPermissionsFromGrid() {
    const menus = [];
    const editableMenus = [];

    $$('.admin-account-menu-item').forEach(row => {
      const menuId = row.dataset.menuId;
      if (!menuId) return;

      const hasAccess = row.querySelector('.menu-access-cb')?.checked;
      const hasEdit = row.querySelector('.menu-edit-cb')?.checked;

      if (hasAccess) menus.push(menuId);
      if (hasAccess && hasEdit) editableMenus.push(menuId);
    });

    return { menus, editableMenus };
  }

  function setAdminAccountMenuPermissions(menus = [], editableMenus = []) {
    const menuSet = new Set(menus);
    const editableSet = new Set(editableMenus);

    $$('.admin-account-menu-item').forEach(row => {
      const menuId = row.dataset.menuId;
      const accessInput = row.querySelector('.menu-access-cb');
      const editInput = row.querySelector('.menu-edit-cb');
      const hasAccess = menuSet.has(menuId);

      if (accessInput) accessInput.checked = hasAccess;
      if (editInput) editInput.checked = hasAccess && editableSet.has(menuId);
      syncAdminAccountMenuRow(row);
    });
  }

  function setSelectedAdminAccountMenus(menuIds) {
    setAdminAccountMenuPermissions(menuIds, menuIds);
  }

  function bindAdminAccountMenuRowEvents(row) {
    const accessInput = row.querySelector('.menu-access-cb');
    const editInput = row.querySelector('.menu-edit-cb');

    accessInput?.addEventListener('change', () => {
      syncAdminAccountMenuRow(row);
    });

    editInput?.addEventListener('change', () => {
      if (editInput.checked && accessInput) {
        accessInput.checked = true;
      }
      syncAdminAccountMenuRow(row);
    });
  }

  function renderAdminAccountMenuGrid(menus = [], editableMenus = []) {
    const grid = $('#adminAccountMenuGrid');
    if (!grid) return;

    const menuSet = new Set(menus.length ? menus : []);
    const editableSet = new Set(editableMenus.length ? editableMenus : menus);

    grid.innerHTML = ADMIN_MENU_OPTIONS.map(option => {
      const hasAccess = menuSet.has(option.id);
      const hasEdit = hasAccess && editableSet.has(option.id);
      return `
        <div class="admin-account-menu-item ${hasAccess ? 'is-active' : ''} ${hasEdit ? 'is-edit' : hasAccess ? 'is-view-only' : ''}" data-menu-id="${option.id}">
          <span class="admin-account-menu-name">${escapeHtml(option.label)}</span>
          <div class="admin-account-menu-checks">
            <label class="admin-account-menu-check">
              <input type="checkbox" class="menu-access-cb" ${hasAccess ? 'checked' : ''}>
              <span>노출</span>
            </label>
            <label class="admin-account-menu-check">
              <input type="checkbox" class="menu-edit-cb" ${hasEdit ? 'checked' : ''} ${hasAccess ? '' : 'disabled'}>
              <span>수정</span>
            </label>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.admin-account-menu-item').forEach(bindAdminAccountMenuRowEvents);
  }

  function formatAccountMenuSummary(account) {
    return account.menus.map(menuId => {
      const label = adminMenuLabelMap[menuId] || menuId;
      const canEdit = (account.editableMenus || []).includes(menuId);
      return `${label}(${canEdit ? '수정' : '노출'})`;
    }).join(', ');
  }

  function applyAdminAccountEmailField() {
    const isProduction = BremStorage.getSupabaseConfig?.().mode === 'production';
    const isCreate = state.adminAccountFormMode === 'create';
    const show = isProduction && isCreate;
    if ($('#adminAccountEmailWrap')) $('#adminAccountEmailWrap').hidden = !show;
    if ($('#adminAccountEmailHelp')) $('#adminAccountEmailHelp').hidden = !show;
  }

  function resetAdminAccountForm() {
    state.adminAccountFormMode = 'create';
    state.editingAdminAccountId = '';
    $('#adminAccountId').value = '';
    $('#adminAccountName').value = '';
    $('#adminAccountName').readOnly = false;
    if ($('#adminAccountEmail')) $('#adminAccountEmail').value = '';
    $('#adminAccountRole').value = ADMIN_ROLES.MANAGER;
    $('#adminAccountPassword').value = '';
    $('#adminAccountPasswordConfirm').value = '';
    $('#adminAccountActive').checked = true;
    $('#adminAccountStatus').textContent = '';
    $('#adminAccountFormTitle').textContent = '관리자 계정 만들기';
    $('#adminAccountPasswordLabel').textContent = '비밀번호';
    $('#adminAccountPasswordConfirmLabel').textContent = '비밀번호 확인';
    $('#adminAccountPassword').required = true;
    $('#adminAccountPasswordConfirm').required = true;
    $('#adminAccountSubmit').textContent = '계정 저장';
    renderAdminAccountMenuGrid(ADMIN_MENU_OPTIONS.map(option => option.id), ADMIN_MENU_OPTIONS.map(option => option.id));
    applyAdminAccountFormMode('create');
    applyAdminAccountEmailField();
  }

  function openAdminAccountCreateForm() {
    if (!canCreateAdminAccount()) {
      showToast('대표만 관리자 계정을 생성할 수 있습니다.');
      return;
    }

    resetAdminAccountForm();
    $('#adminAccountFormCard').hidden = false;
    $('#adminAccountName').focus();
  }

  function openAdminAccountEditForm(accountId) {
    const account = BremStorage.auth.getAdminAccountById(accountId);
    if (!account) {
      showToast('관리자 계정을 찾을 수 없습니다.');
      return;
    }

    if (!canEditAdminAccountMenus(account)) {
      showToast('이 계정을 수정할 권한이 없습니다.');
      return;
    }

    state.editingAdminAccountId = account.id;
    const menuOnly = !canFullyEditAdminAccount();
    state.adminAccountFormMode = menuOnly ? 'menu-only' : 'full-edit';

    $('#adminAccountId').value = account.id;
    $('#adminAccountName').value = account.name;
    $('#adminAccountRole').value = account.role || ADMIN_ROLES.MANAGER;
    $('#adminAccountPassword').value = '';
    $('#adminAccountPasswordConfirm').value = '';
    $('#adminAccountActive').checked = account.active;
    $('#adminAccountStatus').textContent = '';
    $('#adminAccountFormTitle').textContent = menuOnly
      ? `접근 메뉴 수정 · ${account.name}`
      : '관리자 계정 수정';
    $('#adminAccountPasswordLabel').textContent = '새 비밀번호 (변경 시만 입력)';
    $('#adminAccountPasswordConfirmLabel').textContent = '새 비밀번호 확인';
    $('#adminAccountPassword').required = false;
    $('#adminAccountPasswordConfirm').required = false;
    $('#adminAccountSubmit').textContent = menuOnly ? '메뉴 저장' : '계정 저장';
    renderAdminAccountMenuGrid(account.menus, account.editableMenus || account.menus);
    applyAdminAccountFormMode(state.adminAccountFormMode);
    applyAdminAccountEmailField();
    $('#adminAccountFormCard').hidden = false;
    if (menuOnly) {
      $('#adminAccountMenuPanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      $('#adminAccountName').focus();
    }
  }

  function renderAdminAccountRows() {
    const tbody = $('#adminAccountRows');
    if (!tbody) return;

    const sessionAccount = getSessionAdminAccount();
    const accounts = BremStorage.auth.getAdminAccounts();
    const ceoCount = accounts.filter(account => account.role === ADMIN_ROLES.CEO).length;

    if (!accounts.length) {
      tbody.innerHTML = '<tr><td colspan="5">등록된 관리자 계정이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = accounts.map(account => {
      const menuLabels = formatAccountMenuSummary(account);
      const isSelf = sessionAccount?.id === account.id;
      const canEditMenus = canEditAdminAccountMenus(account);
      const canDelete = canDeleteAdminAccount()
        && !(account.role === ADMIN_ROLES.CEO && ceoCount <= 1);
      const editLabel = canFullyEditAdminAccount() ? '수정' : '메뉴 수정';

      return `
        <tr>
          <td>
            <strong>${escapeHtml(account.name)}</strong>
            ${isSelf ? '<span class="admin-account-self-badge">현재 로그인</span>' : ''}
          </td>
          <td><span class="${adminRoleBadgeClass(account.role)}">${escapeHtml(adminRoleLabelMap[account.role] || '팀장')}</span></td>
          <td class="admin-account-menu-cell">${escapeHtml(menuLabels || '-')}</td>
          <td><span class="badge ${account.active ? 'work' : 'left'}">${account.active ? '사용' : '중지'}</span></td>
          <td class="admin-account-actions">
            ${canEditMenus ? `<button class="small-btn" type="button" data-edit-admin-account="${account.id}">${editLabel}</button>` : ''}
            ${canDelete ? `<button class="small-btn danger-btn" type="button" data-delete-admin-account="${account.id}">삭제</button>` : ''}
            ${!canEditMenus && !canDelete ? '<span class="admin-account-readonly-label">조회만</span>' : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  async function renderAdminAccountSection() {
    if (BremStorage.getSupabaseConfig?.().mode === 'production') {
      await BremStorage.auth.refreshProductionAdminSession?.().catch(() => ({}));
      const syncResult = await BremStorage.auth.syncProductionAdminAccounts?.();
      if (!syncResult?.ok) {
        const message = syncResult?.message || '관리자 계정 목록을 Supabase에서 불러오지 못했습니다.';
        showToast(message);
        const status = $('#adminAccountStatus');
        if (status) status.textContent = message;
      }
    }
    updateAdminAccountSectionAccess();
    applyAdminMenuPermissions();
    renderAdminAccountRows();
    if (!state.editingAdminAccountId && $('#adminAccountFormCard')?.hidden !== false) {
      resetAdminAccountForm();
    }
  }

  function bindAdminAccountForm() {
    $('#adminAccountCreateBtn')?.addEventListener('click', openAdminAccountCreateForm);

    $('#adminAccountFormCancelBtn')?.addEventListener('click', () => {
      state.editingAdminAccountId = '';
      state.adminAccountFormMode = '';
      $('#adminAccountFormCard').hidden = true;
      $('#adminAccountStatus').textContent = '';
    });

    $('#adminAccountSelectAllMenus')?.addEventListener('click', () => {
      setAdminAccountMenuPermissions(
        ADMIN_MENU_OPTIONS.map(option => option.id),
        ADMIN_MENU_OPTIONS.map(option => option.id)
      );
    });

    $('#adminAccountSelectViewMenus')?.addEventListener('click', () => {
      setAdminAccountMenuPermissions(
        ADMIN_MENU_OPTIONS.map(option => option.id),
        []
      );
    });

    $('#adminAccountClearMenus')?.addEventListener('click', () => {
      setAdminAccountMenuPermissions([], []);
    });

    $('#adminAccountForm')?.addEventListener('submit', async event => {
      event.preventDefault();

      const actor = getSessionAdminAccount();
      const accountId = $('#adminAccountId').value.trim();
      const name = $('#adminAccountName').value.trim();
      const role = $('#adminAccountRole').value;
      const password = $('#adminAccountPassword').value;
      const confirmPassword = $('#adminAccountPasswordConfirm').value;
      const active = $('#adminAccountActive').checked;
      const menus = getSelectedAdminAccountMenus();
      const editableMenus = getSelectedAdminAccountEditableMenus();
      const status = $('#adminAccountStatus');
      const menuOnly = state.adminAccountFormMode === 'menu-only';
      const isProduction = BremStorage.getSupabaseConfig?.().mode === 'production';
      const minPasswordLength = isProduction ? 6 : 4;

      if (!menus.length) {
        const message = '노출 메뉴를 1개 이상 선택하세요.';
        if (status) status.textContent = message;
        showToast(message);
        return;
      }

      if (!menuOnly && (password || confirmPassword)) {
        if (password !== confirmPassword) {
          const message = '비밀번호 확인이 일치하지 않습니다.';
          if (status) status.textContent = message;
          showToast(message);
          return;
        }
      }

      let result;
      if (accountId) {
        if (menuOnly) {
          result = await BremStorage.auth.updateAdminAccount(accountId, { menus, editableMenus }, { actor });
        } else {
          if (password && password.length < minPasswordLength) {
            const message = isProduction ? '비밀번호는 6자 이상 입력하세요.' : '비밀번호는 4자 이상 입력하세요.';
            if (status) status.textContent = message;
            showToast(message);
            return;
          }
          result = await BremStorage.auth.updateAdminAccount(accountId, {
            name,
            role,
            password: password || undefined,
            menus,
            editableMenus,
            active
          }, { actor });
        }
      } else {
        if (!password) {
          const message = '비밀번호를 입력하세요.';
          if (status) status.textContent = message;
          showToast(message);
          return;
        }
        if (password.length < minPasswordLength) {
          const message = isProduction ? '비밀번호는 6자 이상 입력하세요.' : '비밀번호는 4자 이상 입력하세요.';
          if (status) status.textContent = message;
          showToast(message);
          return;
        }
        result = await BremStorage.auth.createAdminAccount({
          name,
          email: $('#adminAccountEmail')?.value?.trim() || undefined,
          role,
          password,
          menus,
          editableMenus,
          active
        }, { actor });
      }

      if (status) status.textContent = result.message;
      showToast(result.message);

      if (!result.ok) return;

      $('#adminAccountFormCard').hidden = true;
      state.editingAdminAccountId = '';
      state.adminAccountFormMode = '';
      renderAdminAccountSection();
      applyAdminMenuPermissions();

      const allowedMenus = getCurrentAdminMenus();
      if (!allowedMenus.includes(state.currentSection)) {
        showSection(allowedMenus[0] || 'dashboard');
      }

      updateAdminLoginHelp();
    });

    document.addEventListener('click', async event => {
      const editButton = event.target.closest('[data-edit-admin-account]');
      if (editButton) {
        openAdminAccountEditForm(editButton.dataset.editAdminAccount);
        return;
      }

      const deleteButton = event.target.closest('[data-delete-admin-account]');
      if (!deleteButton || deleteButton.disabled) return;

      const accountId = deleteButton.dataset.deleteAdminAccount;
      const account = BremStorage.auth.getAdminAccountById(accountId);
      if (!account) return;

      if (!window.confirm(`"${account.name}" 관리자 계정을 삭제할까요?`)) return;

      const result = await BremStorage.auth.deleteAdminAccount(accountId, { actor: getSessionAdminAccount() });
      showToast(result.message);
      if (!result.ok) return;

      if (!BremStorage.auth.isAdminLoggedIn()) {
        location.reload();
        return;
      }

      renderAdminAccountSection();
      applyAdminMenuPermissions();
      updateAdminLoginHelp();
    });
  }

  function isProductionAdminLogin(config = {}) {
    const host = String(window.location?.hostname || '').toLowerCase();
    return config.mode === 'production'
      || window.BremEnv?.isProductionHost?.(host) === true;
  }

  function updateAdminLoginHelp() {
    const help = $('#adminLoginHelp');
    if (!help) return;

    try {
      const config = BremStorage.getSupabaseConfig?.() || {};
      const host = String(window.location?.hostname || '').toLowerCase();
      const isProduction = config.mode === 'production'
        || window.BremEnv?.isProductionHost?.(host) === true;

      if (!config.isConfigured) {
        help.textContent = isProduction
          ? 'Supabase 연결 설정을 불러오는 중… (운영 환경)'
          : '로컬 개발 로그인 — 아이디: 관리자 / 비밀번호: 1234 (Supabase 미연결 시)';
        return;
      }

      if (isProduction) {
        help.textContent = '운영 로그인: 계정 생성 시 입력한 관리자 이름(아이디) + 비밀번호 (이메일로도 로그인 가능)';
        return;
      }

      if (config.backend === 'local') {
        help.textContent = '로컬 개발 — Supabase 미사용 · 관리자/1234 · 저장은 브라우저(localStorage)만';
        return;
      }

      if (config.isConfigured) {
        help.textContent = '개발 모드: Supabase Auth 로그인 (관리자 이름/이메일 + 비밀번호)';
        return;
      }

      help.textContent = '개발 모드: Supabase 미설정 — settings 테이블 연결 후 관리자 계정 사용';
    } catch (error) {
      console.warn('[BREM] updateAdminLoginHelp skipped:', error.message);
      help.textContent = 'Supabase 연결 후 로그인하세요.';
    }
  }

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));

  function drivers() {
    return BremStorage.drivers.getAll();
  }

  function normalizeSearchText(value) {
    return String(value || '').replace(/\s/g, '').toLowerCase();
  }

  function normalizePhoneSearch(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function matchesDriverSearch(driver, query) {
    const keyword = String(query || '').trim();
    if (!keyword) return true;

    const nameQuery = normalizeSearchText(keyword);
    const phoneQuery = normalizePhoneSearch(keyword);
    const driverNameText = normalizeSearchText(driver.name);
    const driverPhoneText = normalizePhoneSearch(driver.phone);

    if (nameQuery && driverNameText.includes(nameQuery)) return true;
    if (phoneQuery && driverPhoneText.includes(phoneQuery)) return true;

    const lowered = keyword.toLowerCase();
    const baeminId = String(driver.baeminId || '').toLowerCase();
    const coupangId = String(
      driver.coupangId || driver.coupangLoginId || driver.loginId || ''
    ).toLowerCase();

    if (baeminId && baeminId.includes(lowered)) return true;
    if (coupangId && coupangId.includes(lowered)) return true;
    return false;
  }

  function matchesDashboardDriverSearch(driver, query) {
    const keyword = String(query || '').trim();
    if (!keyword) return true;

    if (matchesDriverSearch(driver, keyword)) return true;

    const lowered = keyword.toLowerCase();
    const baeminId = String(driver.baeminId || '').toLowerCase();
    const coupangId = String(
      driver.coupangId || driver.coupangLoginId || driver.loginId || ''
    ).toLowerCase();

    if (baeminId && baeminId.includes(lowered)) return true;
    if (coupangId && coupangId.includes(lowered)) return true;
    return false;
  }

  function filteredDrivers() {
    const query = state.driverSearchQuery.trim();
    if (!query) return drivers();
    return drivers().filter(driver => matchesDriverSearch(driver, query));
  }

  function filteredDashboardDrivers() {
    const query = state.dashboardSearchQuery.trim();
    if (!query) return drivers();
    return drivers().filter(driver => matchesDashboardDriverSearch(driver, query));
  }

  function driverMatchesSearch(driverId) {
    if (!state.driverSearchQuery.trim()) return true;
    const driver = drivers().find(item => item.id === driverId);
    if (!driver) return false;
    return matchesDriverSearch(driver, state.driverSearchQuery);
  }

  function settlementHistorySearch(platform) {
    return String(state.settlementHistorySearchByPlatform[normalizePlatform(platform)] || '').trim();
  }

  function driverMatchesSettlementHistorySearch(driverId, platform) {
    const query = settlementHistorySearch(platform);
    if (!query) return true;
    const driver = drivers().find(item => item.id === driverId);
    if (!driver) return false;
    return matchesDriverSearch(driver, query);
  }

  function callRecordsSearch(platform) {
    const p = normalizePlatform(platform);
    return String(state.callRecordsSearchByPlatform[p] || '').trim();
  }

  function driverMatchesCallRecordsSearch(driverId, platform) {
    const query = callRecordsSearch(platform);
    if (!query) return true;
    const driver = drivers().find(item => item.id === driverId);
    if (!driver) return false;
    return matchesDriverSearch(driver, query);
  }

  function updateDriverSearchStatus() {
    const result = $('#adminDriverSearchResult');
    const clearBtn = $('#adminDriverSearchClear');
    const query = state.driverSearchQuery.trim();
    const matched = filteredDrivers();

    if (clearBtn) clearBtn.hidden = !query;
    if (!result) return;

    if (!query) {
      result.textContent = `전체 기사 ${drivers().length}명 표시 중`;
      return;
    }

    result.textContent = matched.length
      ? `"${query}" 검색 결과 ${matched.length}명`
      : `"${query}" 검색 결과 없음`;
  }

  function updateDashboardSearchStatus(totalCount, visibleCount) {
    const result = $('#dashboardDriverSearchResult');
    if (!result) return;

    const query = state.dashboardSearchQuery.trim();
    const total = Number.isFinite(totalCount) ? totalCount : drivers().length;
    const visible = Number.isFinite(visibleCount) ? visibleCount : total;

    if (!query) {
      result.textContent = `전체 ${total}명 표시`;
      return;
    }

    result.textContent = visible
      ? `전체 ${total}명 중 ${visible}명 표시`
      : `전체 ${total}명 중 검색 결과 없음`;
  }

  function dashboardWeekStart() {
    return state.dashboardWeekStart || weekStartKey();
  }

  function dashboardMonth() {
    return dashboardWeekStart().slice(0, 7);
  }

  function updateDashboardWeekLabel() {
    const weekStart = dashboardWeekStart();
    const label = `주간 ${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))} · 월간 ${dashboardMonth()}`;
    const labelEl = $('#dashboardWeekLabel');
    if (labelEl) labelEl.textContent = label;
    const hidden = $('#dashboardWeekBasisDate');
    if (hidden) hidden.value = weekStart;
  }

  function loadDashboardWeekBasis() {
    state.dashboardWeekStart = BremStorage.adminPreferences?.getDashboardWeekBasis?.() || weekStartKey();
    updateDashboardWeekLabel();
  }

  async function saveDashboardWeekBasis(dateValue) {
    const weekStart = weekStartKey(dateValue);
    state.dashboardWeekStart = weekStart;
    updateDashboardWeekLabel();
    if (BremStorage.adminPreferences?.setDashboardWeekBasis) {
      await Promise.resolve(BremStorage.adminPreferences.setDashboardWeekBasis(dateValue));
    }
    renderDashboard();
  }

  function calls() {
    return BremStorage.calls.getAll();
  }

  function rejections() {
    return BremStorage.rejections.getAll();
  }

  function targets() {
    return BremStorage.targets.getAll();
  }

  function weeklyTargets() {
    return BremStorage.weeklyTargets.getAll();
  }

  function notices() {
    return BremStorage.notices.getAll();
  }

  function riderInquiries() {
    return BremStorage.riderInquiries.getAll();
  }

  async function loadRiderInquiries() {
    if (window.BremRiderInquiryApi?.ready) {
      await window.BremRiderInquiryApi.ready;
    }
    if (window.BremRiderInquiryApi?.list) {
      try {
        return await window.BremRiderInquiryApi.list();
      } catch (error) {
        if (BremStorage.getSupabaseConfig?.().mode === 'production') {
          throw error;
        }
      }
    }
    return BremStorage.riderInquiries.getAll();
  }

  function renderDbConnectionStatus() {
    window.BremDbConnectionStatus?.render('adminDbStatus');
  }

  function settlements() {
    return BremStorage.settlements.getAll();
  }

  function settlementUnmatchedList() {
    return BremStorage.settlementUnmatched.getAll();
  }

  function saveSettlementUnmatched({ period, records, sourceFileName, platform }) {
    if (!records?.length) return;
    BremStorage.settlementUnmatched.saveBatch({ period, records, sourceFileName, platform });
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
  }

  function eventCatalog() {
    return BremStorage.events.getCatalog();
  }

  function eventItemFor(driver) {
    return BremStorage.events.getItemForDriver(driver);
  }

  function eventOptions(selectedValue) {
    const options = ['<option value="">미선택</option>'];
    eventCatalog().forEach(item => {
      const selected = selectedValue && (selectedValue === item.id || selectedValue === item.name) ? 'selected' : '';
      options.push(`<option value="${item.id}" ${selected}>${escapeHtml(item.name)} (목표 ${number(item.targetCount)}개)</option>`);
    });
    return options.join('');
  }

  function longEventPlatformLabel(platform) {
    return BremStorage.events.getDriverEventPlatform({ longEventPlatform: platform }) === 'baemin' ? '배민' : '쿠팡';
  }

  function eventPlatformOptions(selectedValue) {
    const value = BremStorage.events.getDriverEventPlatform({ longEventPlatform: selectedValue });
    return `
      <option value="coupang" ${value === 'coupang' ? 'selected' : ''}>쿠팡</option>
      <option value="baemin" ${value === 'baemin' ? 'selected' : ''}>배민</option>
    `;
  }

  function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function today() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
  }

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekStartKey(dateValue = today()) {
    const date = new Date(`${dateValue}T00:00:00`);
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
  }

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return dateKey(end);
  }

  function weekDateKeys(weekStart) {
    const keys = [];
    const cursor = new Date(`${weekStartKey(weekStart)}T00:00:00`);
    for (let i = 0; i < 7; i += 1) {
      keys.push(dateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(`${value}T00:00:00`));
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function formatMonthLabel(value) {
    if (!value || !/^\d{4}-\d{2}$/.test(value)) return '월을 선택하세요';
    const [year, month] = value.split('-');
    return `${year}년 ${month}월`;
  }

  function updateTargetMonthLabel() {
    const input = $('#targetMonth');
    const label = $('#targetMonthLabel');
    if (label && input) label.textContent = formatMonthLabel(input.value);
  }

  function isWednesday(dateValue) {
    return new Date(`${dateValue}T00:00:00`).getDay() === 3;
  }

  function updateInlineWeekRange(targetId, weekStart) {
    const rangeEl = document.querySelector(`[data-week-range-for="${targetId}"]`);
    const labelEl = document.querySelector(`[data-week-picker-label="${targetId}"]`);
    if (labelEl) labelEl.textContent = formatDate(weekStart);
    if (rangeEl) {
      rangeEl.textContent = `${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))}`;
    }
  }

  function updateAdminWeekTargetPreview(weekStart) {
    const normalizedWeekStart = weekStartKey(weekStart || today());
    const weekInput = $('#weeklyTargetWeekDate');
    const preview = $('#adminTargetWeekRange');
    const label = $('#weeklyTargetWeekLabel');
    if (weekInput) weekInput.value = normalizedWeekStart;
    if (label) label.textContent = formatDate(normalizedWeekStart);
    if (preview) preview.textContent = `${formatDate(normalizedWeekStart)} ~ ${formatDate(weekEndKey(normalizedWeekStart))}`;
  }

  function updateRejectionWeekPreview(weekStart, platform) {
    const p = normalizePlatform(platform);
    const normalizedWeekStart = weekStartKey(weekStart || today());
    state.rejectionWeekByPlatform[p] = normalizedWeekStart;
    const weekInput = $(`#rejectionWeekDate-${p}`);
    const preview = $(`#rejectionWeekPreview-${p}`);
    if (weekInput) weekInput.value = normalizedWeekStart;
    const label = `${formatDate(normalizedWeekStart)} ~ ${formatDate(weekEndKey(normalizedWeekStart))}`;
    if (preview) preview.textContent = label;
  }

  function fillRejectionRateInput(platform) {
    const p = normalizePlatform(platform);
    const driverId = $(`#rejectionDriver-${p}`)?.value;
    const weekStart = state.rejectionWeekByPlatform[p] || weekStartKey();
    const rateInput = $(`#rejectionRate-${p}`);
    if (!rateInput) return;
    const savedRate = driverId ? BremStorage.rejections.getRateForWeek(driverId, weekStart, p) : null;
    rateInput.value = savedRate === null ? '' : savedRate;
  }

  function shiftRejectionWeek(days, platform) {
    const p = normalizePlatform(platform);
    const base = new Date(`${state.rejectionWeekByPlatform[p] || weekStartKey()}T00:00:00`);
    base.setDate(base.getDate() + days);
    updateRejectionWeekPreview(weekStartKey(dateKey(base)), p);
    fillRejectionRateInput(p);
  }

  function eventStartButtonLabel(dateValue) {
    return dateValue ? formatDate(dateValue) : '시작일 선택';
  }

  function getSavedEventSettings(driver) {
    const item = eventItemFor(driver);
    return {
      itemId: item?.id || driver.longEventItemId || '',
      platform: BremStorage.events.getDriverEventPlatform(driver),
      startDate: driver.longEventStartDate || ''
    };
  }

  function getDriverEventDraft(driver) {
    return eventSettingsDrafts.get(driver.id) || getSavedEventSettings(driver);
  }

  function readEventDraftFromDom(driverId) {
    const itemSelect = document.querySelector(`[data-event-driver="${driverId}"]`);
    const platformSelect = document.querySelector(`[data-event-platform="${driverId}"]`);
    const startInput = document.querySelector(`[data-event-start="${driverId}"]`);
    const itemId = String(itemSelect?.value || '').trim();
    const selectedItem = eventCatalog().find(item => item.id === itemId);
    return {
      itemId,
      itemName: selectedItem?.name || '',
      platform: platformSelect?.value || 'coupang',
      startDate: String(startInput?.value || '').slice(0, 10)
    };
  }

  function isEventSettingsDirty(driverId) {
    const driver = drivers().find(item => item.id === driverId);
    if (!driver) return false;
    const draft = getDriverEventDraft(driver);
    const saved = getSavedEventSettings(driver);
    return draft.itemId !== saved.itemId
      || draft.platform !== saved.platform
      || draft.startDate !== saved.startDate;
  }

  function syncEventDirtyState(driverId) {
    if (isEventSettingsDirty(driverId)) eventSettingsDirty.add(driverId);
    else eventSettingsDirty.delete(driverId);
  }

  function updateEventSettingsSaveAllUi() {
    const saveAllBtn = $('#eventSettingsSaveAllBtn');
    if (!saveAllBtn) return;
    const dirtyCount = eventSettingsDirty.size;
    saveAllBtn.hidden = dirtyCount === 0;
    saveAllBtn.textContent = dirtyCount > 0
      ? `변경사항 일괄 저장 (${dirtyCount}명)`
      : '변경사항 일괄 저장';
  }

  function updateEventDriverRowUi(driverId) {
    const row = document.querySelector(`.event-driver-row[data-driver-id="${CSS.escape(String(driverId))}"]`);
    if (!row) {
      renderMissions();
      return;
    }

    const isDirty = isEventSettingsDirty(driverId);
    row.classList.toggle('event-driver-row-dirty', isDirty);
    const saveBtn = row.querySelector('[data-save-event-settings]');
    if (saveBtn) saveBtn.disabled = !isDirty;
    updateEventSettingsSaveAllUi();
  }

  function resetEventSettingsDrafts() {
    eventSettingsDrafts.clear();
    eventSettingsDirty.clear();
    updateEventSettingsSaveAllUi();
  }

  async function saveDriverEventSettings(driverId) {
    const driver = drivers().find(item => item.id === driverId);
    if (!driver) throw new Error('기사를 찾을 수 없습니다.');

    const draft = readEventDraftFromDom(driverId);
    await BremStorage.events.saveDriverSettings(driverId, draft);
    eventSettingsDrafts.delete(driverId);
    eventSettingsDirty.delete(driverId);
  }

  async function saveAllDirtyEventSettings() {
    const ids = [...eventSettingsDirty];
    if (!ids.length) return;

    const failed = [];
    for (const driverId of ids) {
      try {
        await saveDriverEventSettings(driverId);
      } catch (error) {
        failed.push({ id: driverId, error: error.message || '저장 실패' });
      }
    }

    if (failed.length && failed.length === ids.length) {
      throw new Error(failed[0].error || '장기근속이벤트 저장에 실패했습니다.');
    }

    if (failed.length) {
      throw new Error(`${ids.length - failed.length}명 저장 · ${failed.length}명 실패`);
    }
  }

  function callDateLabelId(targetId) {
    const dash = targetId.lastIndexOf('-');
    if (dash === -1) return `${targetId}Label`;
    return `${targetId.slice(0, dash)}Label${targetId.slice(dash)}`;
  }

  function refreshCallDateLabel(targetId) {
    const input = document.getElementById(targetId);
    const label = document.getElementById(callDateLabelId(targetId));
    if (input && label) {
      label.textContent = input.value ? formatDate(input.value) : '날짜 선택';
    }
  }

  function enhanceAdminPeriodDateInputs() {
    const root = document.getElementById('adminApp');
    if (!root) return;
    root.querySelectorAll('input[type="date"]:not([data-admin-date-enhanced]):not([data-settlement-week-only])').forEach(input => {
      input.dataset.adminDateEnhanced = 'true';
      const parentLabel = input.closest('label');
      const currentValue = input.value;
      const inputId = input.id || `adminDate_${Math.random().toString(36).slice(2, 9)}`;
      if (!input.id) input.id = inputId;

      input.type = 'hidden';
      input.classList.remove('admin-period-input');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'call-date-picker-btn';
      button.dataset.callDateTrigger = '';
      button.dataset.callDateTarget = inputId;

      const labelSpan = document.createElement('span');
      labelSpan.id = callDateLabelId(inputId);
      labelSpan.textContent = currentValue ? formatDate(currentValue) : '날짜 선택';
      button.appendChild(labelSpan);

      if (parentLabel) {
        parentLabel.classList.add('call-date-field');
        const existingSpan = parentLabel.querySelector(':scope > span');
        if (!existingSpan) {
          const inlineText = Array.from(parentLabel.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent.trim())
            .join('')
            .trim();
          Array.from(parentLabel.childNodes).forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) node.remove();
          });
          if (inlineText) {
            const span = document.createElement('span');
            span.textContent = inlineText;
            parentLabel.insertBefore(span, input);
          }
        }
        parentLabel.insertBefore(button, input);
      } else {
        const wrap = document.createElement('label');
        wrap.className = 'call-date-field';
        input.parentNode?.insertBefore(wrap, input);
        wrap.appendChild(button);
        wrap.appendChild(input);
      }

      refreshCallDateLabel(inputId);
    });
  }

  function initCallDateFields() {
    PLATFORMS.forEach(platform => {
      const date = today();
      const callDate = $(`#callDate-${platform}`);
      const filterDate = $(`#callFilterDate-${platform}`);
      if (callDate) callDate.value = date;
      if (filterDate) filterDate.value = date;
      refreshCallDateLabel(`callDate-${platform}`);
    });
  }

  function callFilterDate(platform) {
    return String($(`#callFilterDate-${platform}`)?.value || today()).slice(0, 10);
  }

  function shiftCallFilterDate(platform, deltaDays) {
    const input = $(`#callFilterDate-${platform}`);
    if (!input) return;
    const base = new Date(`${callFilterDate(platform)}T00:00:00`);
    base.setDate(base.getDate() + Number(deltaDays || 0));
    input.value = dateKey(base);
    selectedCallIds.clear();
    renderCalls();
  }

  function setCallFilterDate(platform, dateValue) {
    const input = $(`#callFilterDate-${platform}`);
    if (!input) return;
    input.value = String(dateValue || today()).slice(0, 10);
    selectedCallIds.clear();
    renderCalls();
  }

  function formatCallEditChange(entry) {
    if (entry.action === 'create') {
      return `신규 ${number(entry.nextCount)}콜`;
    }
    return `${number(entry.previousCount)} → ${number(entry.nextCount)}콜`;
  }

  function callEditLogsForPlatform(platform) {
    const date = callFilterDate(platform);
    let list = BremStorage.callEditLogs?.getForPlatformDate?.(platform, date) || [];
    const query = callRecordsSearch(platform);
    if (query) {
      list = list.filter(entry => {
        const driver = drivers().find(item => item.id === entry.driverId);
        return driver ? matchesDriverSearch(driver, query) : false;
      });
    }
    return list;
  }

  function setupCallDatePicker() {
    if (setupCallDatePicker.bound) return;
    setupCallDatePicker.bound = true;

    BremDatePicker.setupDelegated({
      popup: $('#adminCallDateCalendar'),
      daysContainer: $('#adminCallDateCalendarDays'),
      titleEl: $('#adminCallDateCalendarTitle'),
      prevBtn: $('#adminCallDateCalendarPrev'),
      nextBtn: $('#adminCallDateCalendarNext'),
      openSelector: '[data-call-date-trigger]',
      dayAttr: 'data-call-date-pick',
      getContext(button) {
        const targetId = button.dataset.callDateTarget;
        const hiddenInput = document.getElementById(targetId);
        if (!hiddenInput) return null;
        return {
          hiddenInput,
          refreshButtonLabel() {
            refreshCallDateLabel(targetId);
          },
          onSelect() {
            /* call input date only */
          }
        };
      }
    });
  }

  function setupTargetMonthPicker() {
    if (setupTargetMonthPicker.bound) return;
    setupTargetMonthPicker.bound = true;

    targetMonthPicker = BremDatePicker.setupMonthSingle({
      popup: $('#adminTargetMonthCalendar'),
      monthsContainer: $('#adminTargetMonthGrid'),
      titleEl: $('#adminTargetMonthTitle'),
      prevBtn: $('#adminTargetMonthPrev'),
      nextBtn: $('#adminTargetMonthNext'),
      todayBtn: $('#adminTargetMonthThisMonth'),
      hiddenInput: $('#targetMonth'),
      openButton: $('#targetMonthButton'),
      labelEl: $('#targetMonthLabel'),
      emptyLabel: '월을 선택하세요',
      onSelect: updateTargetMonthLabel
    });
  }

  function setupAdminWeekPicker() {
    if (setupAdminWeekPicker.bound) return;
    setupAdminWeekPicker.bound = true;

    BremDatePicker.setupWednesdayWeekDelegated({
      popup: $('#adminWeekPickerCalendar'),
      daysContainer: $('#adminWeekPickerDays'),
      titleEl: $('#adminWeekPickerTitle'),
      prevBtn: $('#adminWeekPickerPrev'),
      nextBtn: $('#adminWeekPickerNext'),
      todayBtn: $('#adminWeekPickerThisWeek'),
      openSelector: '[data-week-picker-trigger]',
      getContext(button) {
        const triggerId = button.dataset.weekPickerTrigger;
        if (triggerId === 'form') {
          return {
            hiddenInput: $('#weeklyTargetWeekDate'),
            labelEl: $('#weeklyTargetWeekLabel'),
            onSelect(value) {
              updateAdminWeekTargetPreview(value);
            }
          };
        }

        if (triggerId === 'revenue') {
          return {
            hiddenInput: $('#revenueWeekDate'),
            labelEl: $('#revenueWeekLabel'),
            onSelect(value) {
              const preview = $('#revenueWeekRangePreview');
              if (preview) {
                preview.textContent = `${formatDate(value)} ~ ${formatDate(weekEndKey(value))}`;
              }
              if (window.BremAdminRevenue?.setWeekStart) {
                window.BremAdminRevenue.setWeekStart(value);
              }
            }
          };
        }

        if (triggerId === 'dashboard') {
          return {
            hiddenInput: $('#dashboardWeekBasisDate'),
            labelEl: $('#dashboardWeekLabel'),
            onSelect(value) {
              void saveDashboardWeekBasis(value);
            }
          };
        }

        if (triggerId === 'promotion-apply-saved') {
          return {
            hiddenInput: $('#promotionApplySavedWeekFilter'),
            labelEl: $('#promotionApplySavedWeekFilterLabel'),
            onSelect(value) {
              window.BremPromotionApplyAdmin?.handleSavedWeekSelect?.(value);
            }
          };
        }

        const promotionApplyMatch = triggerId?.match(/^promotion-apply-(.+)$/);
        if (promotionApplyMatch) {
          const selectKey = promotionApplyMatch[1];
          const hiddenInput = $(`#promotionApplySettlementWeek-${selectKey}`);
          const labelEl = $(`#promotionApplySettlementWeekLabel-${selectKey}`)
            || $(`[data-promotion-apply-week-label="${selectKey}"]`);
          if (!hiddenInput) return null;
          return {
            hiddenInput,
            labelEl,
            onSelect(value) {
              window.BremPromotionApplyAdmin?.handleWeekSelect?.(selectKey, value);
            }
          };
        }

        if (triggerId === 'payroll-list') {
          return {
            hiddenInput: $('#payrollSearchSettlementWeekStart'),
            labelEl: $('#payrollSearchSettlementWeekLabel'),
            onSelect(value) {
              window.BremAdminPayrollSlips?.handlePayrollListWeekChange?.(value);
            }
          };
        }

        if (triggerId === 'payroll-upload') {
          return {
            hiddenInput: $('#payrollSettlementWeekStart'),
            labelEl: $('#payrollSettlementWeekLabel'),
            onSelect(value) {
              void window.BremAdminPayrollSlips?.handleSettlementWeekChange?.(value);
            }
          };
        }

        if (triggerId === 'payroll-publish') {
          return {
            hiddenInput: $('#payrollPublishWeekStart'),
            labelEl: $('#payrollPublishWeekLabel'),
            onSelect(value) {
              window.BremAdminPayrollSlips?.handlePublishWeekChange?.(value);
            }
          };
        }

        if (triggerId === 'payroll-notice') {
          return {
            hiddenInput: $('#payrollNoticeWeekStart'),
            labelEl: $('#payrollNoticeWeekLabel'),
            onSelect(value) {
              window.BremAdminPayrollNotices?.handleNoticeWeekChange?.(value);
            }
          };
        }

        if (triggerId === 'menu-payroll-notice') {
          return {
            hiddenInput: $('#menuPayrollNoticeWeekStart'),
            labelEl: $('#menuPayrollNoticeWeekLabel'),
            onSelect(value) {
              window.BremAdminPayrollNotices?.handleMenuNoticeWeekChange?.(value);
            }
          };
        }

        if (triggerId === 'lease-week') {
          return {
            hiddenInput: $('#leaseWeekStart'),
            labelEl: $('#leaseWeekStartLabel'),
            onSelect(value) {
              window.BremAdminLeaseMenus?.handleWeeklyWeekChange?.(value);
            }
          };
        }

        const hiddenInput = document.querySelector(`[data-edit-weekly-week="${triggerId}"]`);
        const labelEl = document.querySelector(`[data-week-picker-label="${triggerId}"]`);
        if (!hiddenInput) return null;
        return {
          hiddenInput,
          labelEl,
          onSelect(value) {
            updateInlineWeekRange(triggerId, value);
          }
        };
      }
    });
  }

  function setupEventStartDatePicker() {
    if (setupEventStartDatePicker.bound) return;
    setupEventStartDatePicker.bound = true;

    BremDatePicker.setupDelegated({
      popup: $('#eventStartCalendar'),
      daysContainer: $('#eventStartCalendarDays'),
      titleEl: $('#eventStartCalendarTitle'),
      prevBtn: $('#eventStartCalendarPrev'),
      nextBtn: $('#eventStartCalendarNext'),
      openSelector: '[data-event-start-button]',
      dayAttr: 'data-event-start-date',
      getContext(button) {
        const driverId = button.dataset.eventStartButton;
        const hiddenInput = document.querySelector(`[data-event-start="${driverId}"]`);
        if (!hiddenInput) return null;
        return {
          hiddenInput,
          refreshButtonLabel() {
            button.textContent = eventStartButtonLabel(hiddenInput.value);
          },
          onSelect(value) {
            const driverId = button.dataset.eventStartButton;
            const current = eventSettingsDrafts.get(driverId) || getSavedEventSettings(
              drivers().find(item => item.id === driverId) || {}
            );
            eventSettingsDrafts.set(driverId, { ...current, startDate: value || '' });
            syncEventDirtyState(driverId);
            button.textContent = eventStartButtonLabel(value);
            updateEventDriverRowUi(driverId);
          }
        };
      }
    });
  }

  function eventProgressSummary(driver) {
    const item = eventItemFor(driver);
    if (!item) return '미설정';
    const startDate = driver.longEventStartDate || '';
    if (!startDate) return `${item.name} · 시작일 필요`;
    const platform = BremStorage.events.getDriverEventPlatform(driver);
    const total = BremStorage.events.eventCallsForDriver(driver);
    const target = Number(item.targetCount || 0);
    const rate = target ? Math.round((total / target) * 100) : 0;
    return `${longEventPlatformLabel(platform)} ${number(total)} / ${number(target)}콜 · ${rate}%`;
  }

  function eventProgressDetail(driver) {
    const item = eventItemFor(driver);
    if (!item) return '이벤트 아이템 미설정';
    const startDate = driver.longEventStartDate || '';
    if (!startDate) return '시작일을 설정하면 집계됩니다.';
    const platform = BremStorage.events.getDriverEventPlatform(driver);
    const total = BremStorage.events.eventCallsForDriver(driver);
    const target = Number(item.targetCount || 0);
    const rate = target ? Math.round((total / target) * 100) : 0;
    return `
      <p>집계: ${longEventPlatformLabel(platform)} (합산 제외)</p>
      <p>시작일: ${formatDate(startDate)}</p>
      <p>${number(total)} / ${number(target)}콜</p>
      ${progress(rate)}
    `;
  }

  function eventDriverStats(driver) {
    const item = eventItemFor(driver);
    const platform = BremStorage.events.getDriverEventPlatform(driver);
    if (!item) {
      return {
        status: 'unset',
        item: null,
        platform,
        total: 0,
        target: 0,
        rate: 0,
        startDate: ''
      };
    }

    const startDate = driver.longEventStartDate || '';
    const target = Number(item.targetCount || 0);
    if (!startDate) {
      return {
        status: 'no-start',
        item,
        platform,
        total: 0,
        target,
        rate: 0,
        startDate: ''
      };
    }

    const total = BremStorage.events.eventCallsForDriver(driver);
    const rate = target ? Math.round((total / target) * 100) : 0;
    return {
      status: rate >= 100 ? 'achieved' : 'in-progress',
      item,
      platform,
      total,
      target,
      rate,
      startDate
    };
  }

  function missionStatusBadge(status) {
    if (status === 'achieved') return '<span class="badge success">달성 완료</span>';
    if (status === 'in-progress') return '<span class="badge warning">진행 중</span>';
    if (status === 'no-start') return '<span class="badge left">시작일 필요</span>';
    return '<span class="badge left">미설정</span>';
  }

  function missionResultsFilterState() {
    return {
      itemId: $('#missionResultItemFilter')?.value || '',
      status: $('#missionResultStatusFilter')?.value || ''
    };
  }

  function missionResultsDrivers(options = {}) {
    const filters = missionResultsFilterState();
    const query = options.includeSearch === false ? '' : state.missionResultsSearchQuery.trim();
    return drivers().filter(driver => {
      if (query && !matchesDriverSearch(driver, query)) return false;
      const stats = eventDriverStats(driver);
      if (filters.itemId && stats.item?.id !== filters.itemId) return false;
      if (filters.status && stats.status !== filters.status) return false;
      return true;
    });
  }

  function updateMissionResultsSearchStatus(visibleCount, totalCount) {
    const result = $('#missionResultsSearchResult');
    const clearBtn = $('#missionResultsSearchClear');
    const query = state.missionResultsSearchQuery.trim();

    if (clearBtn) clearBtn.hidden = !query;
    if (!result) return;

    if (!query) {
      result.textContent = totalCount
        ? `전체 기사 ${totalCount}명 · 아래 표 스크롤`
        : '등록된 기사가 없습니다.';
      return;
    }

    result.textContent = visibleCount
      ? `"${query}" 검색 결과 ${visibleCount}명`
      : `"${query}" 검색 결과 없음`;
  }

  function renderMissionResultsChartRow(label, achieved, total, tone = '') {
    const percent = total ? Math.round((achieved / total) * 100) : 0;
    return `
      <div class="mission-chart-row">
        <span class="mission-chart-label">${escapeHtml(label)}</span>
        <div class="mission-chart-track ${tone}">
          <span style="width:${percent}%"></span>
        </div>
        <span class="mission-chart-value">${number(achieved)} / ${number(total)}명</span>
      </div>
    `;
  }

  function renderMissionResults() {
    const visibleDrivers = filteredDrivers();
    const statsList = visibleDrivers.map(driver => ({
      driver,
      stats: eventDriverStats(driver)
    }));

    const activeCount = statsList.filter(entry => entry.stats.item && entry.stats.startDate).length;
    const achievedCount = statsList.filter(entry => entry.stats.status === 'achieved').length;
    const progressCount = statsList.filter(entry => entry.stats.status === 'in-progress').length;
    const unsetCount = statsList.filter(entry => entry.stats.status === 'unset' || entry.stats.status === 'no-start').length;

    $('#missionResultStatActive').textContent = `${activeCount}명`;
    $('#missionResultStatAchieved').textContent = `${achievedCount}명`;
    $('#missionResultStatProgress').textContent = `${progressCount}명`;
    $('#missionResultStatUnset').textContent = `${unsetCount}명`;

    const catalog = eventCatalog();
    const itemFilter = $('#missionResultItemFilter');
    if (itemFilter) {
      const current = itemFilter.value;
      itemFilter.innerHTML = [
        '<option value="">전체</option>',
        ...catalog.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
      ].join('');
      if (current && catalog.some(item => item.id === current)) {
        itemFilter.value = current;
      }
    }

    const itemChart = $('#missionResultsItemChart');
    if (itemChart) {
      if (!catalog.length) {
        itemChart.innerHTML = '<div class="empty">등록된 장기근속이벤트 아이템이 없습니다.</div>';
      } else {
        itemChart.innerHTML = catalog.map(item => {
          const assigned = statsList.filter(entry => entry.stats.item?.id === item.id);
          const achieved = assigned.filter(entry => entry.stats.status === 'achieved').length;
          return renderMissionResultsChartRow(item.name, achieved, assigned.length, 'mission-chart-track--gold');
        }).join('');
      }
    }

    const rateBuckets = [
      { label: '100% 달성', min: 100, max: Infinity, tone: 'mission-chart-track--success' },
      { label: '80% 이상', min: 80, max: 99, tone: 'mission-chart-track--gold' },
      { label: '50% 이상', min: 50, max: 79, tone: 'mission-chart-track--warning' },
      { label: '50% 미만', min: 1, max: 49, tone: 'mission-chart-track--muted' },
      { label: '미집계', min: -1, max: 0, tone: 'mission-chart-track--muted' }
    ];

    const activeStats = statsList.filter(entry => entry.stats.status === 'achieved' || entry.stats.status === 'in-progress');
    const rateChart = $('#missionResultsRateChart');
    if (rateChart) {
      if (!activeStats.length) {
        rateChart.innerHTML = '<div class="empty">집계 중인 기사가 없습니다. 이벤트 아이템과 시작일을 설정하세요.</div>';
      } else {
        rateChart.innerHTML = rateBuckets.map(bucket => {
          const count = bucket.min === -1
            ? statsList.filter(entry => entry.stats.status === 'no-start' || entry.stats.status === 'unset').length
            : activeStats.filter(entry => entry.stats.rate >= bucket.min && entry.stats.rate <= bucket.max).length;
          return renderMissionResultsChartRow(bucket.label, count, visibleDrivers.length, bucket.tone);
        }).join('');
      }
    }

    const emptyMessage = state.missionResultsSearchQuery.trim()
      ? '검색 결과에 해당하는 기사가 없습니다.'
      : '기사등록 프로그램에서 기사를 먼저 등록하세요.';

    const missionResultEntries = Sort
      ? Sort.sortItems(
        missionResultsDrivers().map(driver => ({ driver, stats: eventDriverStats(driver) })),
        state.missionResultsSort,
        missionResultsSortSchema
      )
      : missionResultsDrivers().map(driver => ({ driver, stats: eventDriverStats(driver) }));

    $('#missionResultRows').innerHTML = missionResultEntries.map(({ driver, stats }) => `
        <tr>
          <td>${escapeHtml(driver.name)}</td>
          <td>${escapeHtml(driver.phone)}</td>
          <td>${escapeHtml(stats.item ? stats.item.name : '미설정')}</td>
          <td>${longEventPlatformLabel(stats.platform)}</td>
          <td>${stats.startDate ? formatDate(stats.startDate) : '-'}</td>
          <td><strong>${number(stats.total)}</strong></td>
          <td>${stats.target ? number(stats.target) : '-'}</td>
          <td>${stats.target ? progress(stats.rate) : '-'}</td>
          <td>${missionStatusBadge(stats.status)}</td>
        </tr>
      `).join('') || emptyRow(9, emptyMessage);
    updateMissionResultsSearchStatus(
      missionResultEntries.length,
      missionResultsDrivers({ includeSearch: false }).length
    );
    Sort?.markScope(document.querySelector('[data-sort-table="mission-results"]'), state.missionResultsSort);
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
  }

  function number(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function isAdminLoggedIn() {
    return BremStorage.auth.isAdminLoggedIn();
  }

  function showAdminDataLoading(loading) {
    const app = $('#adminApp');
    app?.classList.toggle('is-data-loading', loading);
    if (loading) {
      window.BremLoadingUI?.show(app, '데이터 불러오는 중...');
    } else {
      window.BremLoadingUI?.hide(app);
    }
  }

  function showSectionLoadingSkeleton(sectionId) {
    if (BremStorage.isSectionCacheReady?.(sectionId)) return;
    if (sectionId === 'dashboard') {
      $('#statDrivers').textContent = '…';
      $('#statWeekCallsCoupang').textContent = '…';
      $('#statWeekCallsBaemin').textContent = '…';
      $('#statWeekCallsTotal').textContent = '…';
      $('#statMonthCalls').textContent = '…';
      if ($('#statEmptyLease')) $('#statEmptyLease').textContent = '…';
      $('#dashboardRows').innerHTML = emptyRow(8, '데이터 불러오는 중…');
      $('#dashboardNotices').innerHTML = '<p class="empty-state">공지 불러오는 중…</p>';
    }
  }

  function showAdminLoginPageOnly() {
    $('#adminLoginPage').classList.remove('app-hidden');
    $('#adminApp').classList.add('app-hidden');
  }

  function consumeLogoutNotice() {
    const notice = window.BremSessionSecurity?.consumeLogoutNotice?.() || '';
    if (notice) showToast(notice);
  }

  async function logoutAdmin(options = {}) {
    const { idle = false, reload = !idle, message = '' } = options;
    window.BremSessionSecurity?.stop();

    if (BremStorage.getSupabaseConfig?.().mode === 'production') {
      await BremStorage.auth.signOutSupabase('admin');
    } else {
      BremStorage.auth.clearAdminSession();
      BremStorage.auth.clearSessionAuth?.('admin');
    }

    if (reload) {
      location.reload();
      return;
    }

    showAdminLoginPageOnly();
    window.BremLoginPrefs?.restoreIdAfterLogout?.('admin', {
      idInput: $('#adminName'),
      rememberCheckbox: $('#adminRememberId'),
      passwordInput: $('#adminPassword')
    });
    if (idle) {
      showToast(message || window.BremSessionSecurity?.IDLE_MESSAGE || '로그아웃되었습니다.');
    }
  }

  function startAdminSessionSecurity() {
    if (!BremStorage.auth.isAdminLoggedIn()) return;
    if (!window.BremSessionSecurity?.start) return;
    window.BremSessionSecurity.start({
      idleMs: window.BremSessionSecurity.ADMIN_IDLE_MS,
      isLoggedIn: () => {
        try {
          return Boolean(BremStorage.auth.isAdminLoggedIn());
        } catch {
          return false;
        }
      },
      onIdleLogout: async (message) => {
        await logoutAdmin({ idle: true, reload: false, message });
      }
    });
  }

  function enforceAdminRouteAccess() {
    if (BremStorage.auth.isAdminLoggedIn()) return true;
    showAdminLoginPageOnly();
    return false;
  }

  function showAdminAppShell() {
    $('#adminLoginPage').classList.add('app-hidden');
    $('#adminApp').classList.remove('app-hidden');
    showSection('dashboard', { skipRender: true });
    showSectionLoadingSkeleton('dashboard');
    showAdminDataLoading(true);
    renderRiderPublishStatus();
  }

  function applyLocalReadOnlyBanner() {
    const banner = $('#adminLocalReadOnlyBanner');
    if (!banner) return;
    const config = BremStorage.getSupabaseConfig?.() || {};
    const show = config.mode === 'development'
      && (config.devSupabase === true || config.writeBlocked === true || config.backend === 'local');
    banner.classList.toggle('app-hidden', !show);
  }

  function showAdminApp(options = {}) {
    if (!options.shellReady && !enforceAdminRouteAccess()) return;
    if (options.shellReady && !enforceAdminRouteAccess()) {
      showAdminLoginPageOnly();
      return;
    }

    if (!options.shellReady) {
      $('#adminLoginPage').classList.add('app-hidden');
      $('#adminApp').classList.remove('app-hidden');
    }

    if (options.endLoginTimer) {
      console.timeEnd('adminLogin');
    }

    renderDbConnectionStatus();
    applyLocalReadOnlyBanner();
    initDefaults();
    bindEvents();
    applyAdminMenuPermissions();
    const allowedMenus = getCurrentAdminMenus();
    const initialSection = allowedMenus.includes(state.currentSection)
      ? state.currentSection
      : (allowedMenus[0] || 'dashboard');

    showSection(initialSection, { skipRender: true });
    const initialCacheReady = BremStorage.isSectionCacheReady?.(initialSection);
    if (!options.shellReady && !initialCacheReady) {
      showSectionLoadingSkeleton(initialSection);
      showAdminDataLoading(true);
    }
    applySectionEditPermissions();

    startAdminSessionSecurity();
    window.BremSessionSecurity?.touchActivity?.();

    const loadPromise = (async () => {
      const core = await (BremStorage.hydrateAdminDataInBackground?.() || Promise.resolve({ ok: true }));
      if (core?.ok === false) return core;
      return BremStorage.ensureSectionLoaded?.(initialSection) || { ok: true };
    })();

    Promise.resolve(loadPromise).then(result => {
      showAdminDataLoading(false);
      if (result && result.ok === false) {
        showToast(result.message || '데이터 연결에 실패했습니다.');
        renderDbConnectionStatus();
        return;
      }
      renderDbConnectionStatus();
      renderActiveSection(initialSection);
      renderRiderPublishStatus();
      applySectionEditPermissions();
    }).catch(error => {
      showAdminDataLoading(false);
      console.error('[BREM] Admin data hydrate failed:', error);
      showToast(error.message || '데이터 연결에 실패했습니다.');
      renderDbConnectionStatus();
    });
  }

  function ensureAdminStorage() {
    const status = BremStorage.getStorageStatus?.() || {};
    if (status.backend === 'supabase' && status.supabaseHydrated) {
      return Promise.resolve({ ok: true });
    }
    return BremStorage.hydrateAdminDataInBackground?.() || BremStorage.ensureSupabaseHydrated?.();
  }

  function bindAuthEvents() {
    window.BremLoginPrefs?.applyLoginForm?.('admin', {
      idInput: $('#adminName'),
      rememberCheckbox: $('#adminRememberId'),
      keepCheckbox: $('#adminKeepLoggedIn')
    });

    const pwToggle = $('#adminPasswordToggle');
    const pwInput = $('#adminPassword');
    if (pwToggle && pwInput) {
      pwToggle.addEventListener('click', () => {
        const visible = pwInput.type === 'password';
        pwInput.type = visible ? 'text' : 'password';
        pwToggle.classList.toggle('is-visible', visible);
        pwToggle.setAttribute('aria-label', visible ? '비밀번호 숨기기' : '비밀번호 표시');
      });
    }

    $('#adminLoginForm').addEventListener('submit', async event => {
      event.preventDefault();
      const submitBtn = event.target.querySelector('.login-submit');
      const name = $('#adminName').value.trim();
      const password = $('#adminPassword').value;

      if (!name || !password) {
        showToast('아이디와 비밀번호를 입력하세요.');
        return;
      }

      const originalLabel = submitBtn?.textContent || '로그인';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '로그인 중…';
      }

      let adminLoginTimerActive = false;

      try {
        console.time('adminLogin');
        adminLoginTimerActive = true;

        if (window.BremSupabaseConfig?.load) {
          await Promise.all([
            window.BremSupabaseConfig.load(),
            BremStorage.waitForStorageBootstrap?.() || Promise.resolve()
          ]);
        } else {
          await BremStorage.waitForStorageBootstrap?.();
        }

        window.BremPerf?.time?.('admin.signInApi');
        const config = BremStorage.getSupabaseConfig?.() || {};
        const useLocalAdminLogin = !isProductionAdminLogin(config)
          && (config.backend === 'local' || !config.isConfigured);
        const result = useLocalAdminLogin
          ? BremStorage.auth.verifyAdminLogin(name, password)
          : await BremStorage.auth.signInAdmin(name, password);
        window.BremPerf?.timeEnd?.('admin.signInApi');

        if (!result?.ok) {
          showToast(result?.message || '이름 또는 비밀번호가 올바르지 않습니다.');
          return;
        }

        if (useLocalAdminLogin) {
          BremStorage.auth.setAdminSession(result.account.id);
        } else {
          void BremStorage.initStorage?.({ backend: 'supabase', deferHydrate: true });
        }

        window.BremLoginPrefs?.captureLoginPrefs?.('admin', {
          idInput: $('#adminName'),
          rememberCheckbox: $('#adminRememberId'),
          keepCheckbox: $('#adminKeepLoggedIn')
        });

        showAdminAppShell();
        showAdminApp({ shellReady: true });
        console.timeEnd('adminLogin');
        adminLoginTimerActive = false;
        showToast('관리자 로그인 성공');
        window.BremSessionSecurity?.touchActivity?.();

        const returnPath = new URLSearchParams(window.location.search).get('return');
        if (returnPath && returnPath.startsWith('/') && !returnPath.startsWith('//')) {
          window.location.replace(returnPath);
        }
      } catch (error) {
        console.error('[BREM] Admin login failed:', error);
        BremStorage.auth.clearAdminSession?.();
        showToast(error.message || '로그인 중 오류가 발생했습니다.');
        renderDbConnectionStatus();
      } finally {
        if (adminLoginTimerActive) {
          console.timeEnd('adminLogin');
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      }
    });
  }

  function driverName(id) {
    const driver = drivers().find(item => item.id === id);
    return driver ? driver.name : '삭제된 기사';
  }

  function statusBadge(status) {
    const cls = status === '근무중' ? 'work' : status === '휴무' ? 'off' : 'left';
    return `<span class="badge ${cls}">${status}</span>`;
  }

  function platformBadges(driver) {
    const tags = [];
    if (driver?.platformCoupang !== false) {
      tags.push('<span class="platform-tag platform-tag--coupang">쿠팡</span>');
    }
    if (driver?.platformBaemin) {
      tags.push('<span class="platform-tag platform-tag--baemin">배민</span>');
    }
    return tags.length
      ? `<span class="platform-tags">${tags.join('')}</span>`
      : '<span class="platform-tag platform-tag--empty">-</span>';
  }

  function invalidateCallStatsIndex() {
    callStatsIndex = null;
    callStatsIndexKey = '';
  }

  function getCallStatsIndex() {
    const list = calls();
    const key = `${list.length}:${list[0]?.id || ''}:${list[list.length - 1]?.id || ''}`;
    if (callStatsIndex && callStatsIndexKey === key) return callStatsIndex;

    const driverWeekPlatform = new Map();
    const driverMonth = new Map();
    const weekPlatformTotal = new Map();

    for (const call of list) {
      const driverId = call.driverId;
      const date = call.date;
      if (!driverId || !date) continue;
      const count = Number(call.count || 0);
      const platform = normalizePlatform(call.platform);
      const month = date.slice(0, 7);

      const monthKey = `${driverId}|${month}`;
      driverMonth.set(monthKey, (driverMonth.get(monthKey) || 0) + count);

      const weekStart = weekStartKey(date);
      const weekDriverKey = `${driverId}|${weekStart}|${platform}`;
      driverWeekPlatform.set(weekDriverKey, (driverWeekPlatform.get(weekDriverKey) || 0) + count);

      const weekTotalKey = `${weekStart}|${platform}`;
      weekPlatformTotal.set(weekTotalKey, (weekPlatformTotal.get(weekTotalKey) || 0) + count);
    }

    callStatsIndex = { driverWeekPlatform, driverMonth, weekPlatformTotal };
    callStatsIndexKey = key;
    return callStatsIndex;
  }

  function monthCalls(driverId, month) {
    return getCallStatsIndex().driverMonth.get(`${driverId}|${month}`) || 0;
  }

  function currentWeekCalls(driverId) {
    return weekCalls(driverId, weekStartKey());
  }

  function targetFor(driverId, month) {
    return BremStorage.targets.getMonthlyCount(driverId, month);
  }

  function rateFor(driverId, month) {
    const target = targetFor(driverId, month);
    if (!target) return 0;
    return Math.round((monthCalls(driverId, month) / target) * 100);
  }

  function weeklyTargetFor(driverId, weekStart) {
    return BremStorage.weeklyTargets.getCount(driverId, weekStart);
  }

  function weekCalls(driverId, weekStart) {
    return weekCallsForDriverByPlatform(driverId, weekStart, 'coupang')
      + weekCallsForDriverByPlatform(driverId, weekStart, 'baemin');
  }

  function weeklyRateFor(driverId, weekStart) {
    const target = weeklyTargetFor(driverId, weekStart);
    if (!target) return 0;
    return Math.round((weekCalls(driverId, weekStart) / target) * 100);
  }

  function progress(rate) {
    const width = Math.min(rate, 100);
    return `<div class="progress"><div class="bar"><span style="width:${width}%"></span></div><strong>${rate}%</strong></div>`;
  }

  function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}" class="empty">${text}</td></tr>`;
  }

  function driverEligibleForPlatform(driver, platform) {
    const p = normalizePlatform(platform);
    if (p === 'baemin') {
      return Boolean(driver?.platformBaemin) || Boolean(String(driver?.baeminId || '').trim());
    }
    if (driver?.platformCoupang === false) return false;
    return Boolean(String(driver?.name || '').trim()) && Boolean(normalizePhoneSearch(driver?.phone));
  }

  function getSelectPlatform(select) {
    if (!select?.id) return null;
    const match = select.id.match(/-(coupang|baemin)$/i);
    return match ? normalizePlatform(match[1]) : null;
  }

  function driversForSelect(select) {
    const platform = getSelectPlatform(select);
    let list = filteredDrivers();
    if (platform) {
      list = list.filter(driver => driverEligibleForPlatform(driver, platform));
    }
    return list;
  }

  function invalidateDriverSelectCache() {
    driverSelectOptionsCache.clear();
    $$('.call-driver, .rejection-driver, #targetDriver, #weeklyTargetDriver').forEach(select => {
      if (select) delete select.dataset.selectOptionsKey;
    });
  }

  function getDriverSelectOptionsCacheKey(platform) {
    return `${platform || 'all'}:${state.driverSearchQuery.trim()}:${drivers().length}`;
  }

  function fillDriverSelect(select) {
    if (!select) return;
    const current = select.value;
    const platform = getSelectPlatform(select);
    const cacheKey = getDriverSelectOptionsCacheKey(platform);

    let cached = driverSelectOptionsCache.get(cacheKey);
    if (!cached) {
      const list = driversForSelect(select);
      cached = {
        html: '<option value="">기사 선택</option>' + list
          .map(driver => `<option value="${driver.id}">${escapeHtml(driver.name)} · ${escapeHtml(driver.phone)}</option>`)
          .join(''),
        ids: new Set(list.map(driver => driver.id))
      };
      driverSelectOptionsCache.set(cacheKey, cached);
    }

    if (select.dataset.selectOptionsKey !== cacheKey) {
      select.innerHTML = cached.html;
      select.dataset.selectOptionsKey = cacheKey;
    }

    if (current && cached.ids.has(current)) {
      select.value = current;
    } else {
      select.value = '';
    }
  }

  function resetDriverFormSelects() {
    $$('.call-driver, .rejection-driver, #targetDriver, #weeklyTargetDriver').forEach(select => {
      if (select) select.value = '';
    });
  }

  function refreshSelects() {
    $$('.call-driver, .rejection-driver').forEach(fillDriverSelect);
    ['#targetDriver', '#weeklyTargetDriver'].forEach(selector => fillDriverSelect($(selector)));
  }

  function refreshSelectsForSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) {
      refreshSelects();
      return;
    }
    section.querySelectorAll('.call-driver, .rejection-driver').forEach(fillDriverSelect);
    if (sectionId === 'targets') {
      fillDriverSelect($('#targetDriver'));
      fillDriverSelect($('#weeklyTargetDriver'));
    }
  }

  function updateDriverSearchBarVisibility(sectionId) {
    const bar = $('#adminDriverSearchBar');
    if (!bar) return;
    const visible = DRIVER_SEARCH_SECTIONS.has(sectionId);
    bar.hidden = !visible;
    if (visible) updateDriverSearchStatus();
  }

  function weekCallsForDriverByPlatform(driverId, weekStart, platform) {
    const p = normalizePlatform(platform);
    return getCallStatsIndex().driverWeekPlatform.get(`${driverId}|${weekStart}|${p}`) || 0;
  }

  function weekCallsByPlatform(platform, weekStart) {
    const p = normalizePlatform(platform);
    return getCallStatsIndex().weekPlatformTotal.get(`${weekStart}|${p}`) || 0;
  }

  function rejectionSortValue(entry) {
    if (!entry) return -1;
    if (entry.stats?.unmeasured) return -0.5;
    const rate = Number(entry.rate);
    return Number.isNaN(rate) ? -1 : rate;
  }

  function dashboardRejectionCell(driver, weekStart, platform) {
    const p = normalizePlatform(platform);
    if (p === 'coupang' && driver.platformCoupang === false) return '-';
    if (p === 'baemin' && !driver.platformBaemin) return '-';
    const entry = BremStorage.rejections.getEntryForWeek(driver.id, weekStart, p);
    if (!entry) return '-';
    return formatPercent(entry.rate, entry);
  }

  function renderDashboard() {
    window.BremPerf?.time?.('admin.renderDashboard');
    const month = dashboardMonth();
    const weekStart = dashboardWeekStart();
    const totalDrivers = drivers().length;
    const allDrivers = filteredDashboardDrivers();
    const driverStats = allDrivers.map(driver => {
      const coupangWeekCalls = weekCallsForDriverByPlatform(driver.id, weekStart, 'coupang');
      const baeminWeekCalls = weekCallsForDriverByPlatform(driver.id, weekStart, 'baemin');
      const totalWeekCalls = coupangWeekCalls + baeminWeekCalls;
      const monthlyCallCount = monthCalls(driver.id, month);
      const coupangRejectionEntry = BremStorage.rejections.getEntryForWeek(driver.id, weekStart, 'coupang');
      const baeminRejectionEntry = BremStorage.rejections.getEntryForWeek(driver.id, weekStart, 'baemin');
      return {
        driver,
        coupangWeekCalls,
        baeminWeekCalls,
        totalWeekCalls,
        monthlyCallCount,
        coupangRejectionEntry,
        baeminRejectionEntry,
        coupangRejectionSort: rejectionSortValue(coupangRejectionEntry),
        baeminRejectionSort: rejectionSortValue(baeminRejectionEntry)
      };
    });

    const sortedDriverStats = Sort
      ? Sort.sortItems(driverStats, state.dashboardSort, dashboardSortSchema)
      : driverStats;

    const rows = sortedDriverStats.map(({
      driver,
      coupangWeekCalls,
      baeminWeekCalls,
      totalWeekCalls,
      monthlyCallCount
    }) => {
      const eventSummary = eventProgressSummary(driver);
      return `
        <tr>
          <td class="dashboard-cell-name" title="${escapeHtml(driver.name)}">${escapeHtml(driver.name)}</td>
          <td class="dashboard-cell-phone">${escapeHtml(driver.phone)}</td>
          <td class="dashboard-cell-platform">${platformBadges(driver)}</td>
          <td class="dashboard-cell-num"><strong>${number(coupangWeekCalls)}</strong></td>
          <td class="dashboard-cell-num"><strong>${number(baeminWeekCalls)}</strong></td>
          <td class="dashboard-cell-num"><strong>${number(totalWeekCalls)}</strong></td>
          <td class="dashboard-cell-rate">${dashboardRejectionCell(driver, weekStart, 'coupang')}</td>
          <td class="dashboard-cell-rate">${dashboardRejectionCell(driver, weekStart, 'baemin')}</td>
          <td class="dashboard-cell-num"><strong>${number(monthlyCallCount)}</strong></td>
          <td class="dashboard-cell-event" title="${escapeHtml(eventSummary)}">${escapeHtml(eventSummary)}</td>
        </tr>
      `;
    }).join('');

    const totalWeekCallsCoupang = weekCallsByPlatform('coupang', weekStart);
    const totalWeekCallsBaemin = weekCallsByPlatform('baemin', weekStart);
    const totalWeekCalls = totalWeekCallsCoupang + totalWeekCallsBaemin;
    const totalMonthCalls = allDrivers.reduce((sum, driver) => sum + monthCalls(driver.id, month), 0);
    $('#statDrivers').textContent = `${allDrivers.length}명`;
    $('#statWeekCallsCoupang').textContent = `${number(totalWeekCallsCoupang)}콜`;
    $('#statWeekCallsBaemin').textContent = `${number(totalWeekCallsBaemin)}콜`;
    $('#statWeekCallsTotal').textContent = `${number(totalWeekCalls)}콜`;
    $('#statMonthCalls').textContent = `${number(totalMonthCalls)}콜`;
    if ($('#statEmptyLease') && BremStorage.leases?.getEmptyVehicles) {
      $('#statEmptyLease').textContent = `${BremStorage.leases.getEmptyVehicles().length}대`;
    }
    $('#dashboardWeekLabel').textContent = `주간 ${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))} · 월간 ${month}`;
    const emptyMessage = state.dashboardSearchQuery.trim()
      ? '검색 결과에 해당하는 기사가 없습니다.'
      : '기사등록 프로그램에서 기사를 먼저 등록하세요.';
    $('#dashboardRows').innerHTML = rows || emptyRow(10, emptyMessage);
    updateDashboardSearchStatus(totalDrivers, allDrivers.length);
    const dashboardCountEl = $('#dashboardDriverCount');
    if (dashboardCountEl) {
      if (!allDrivers.length) {
        dashboardCountEl.hidden = true;
        dashboardCountEl.textContent = '';
      } else {
        dashboardCountEl.hidden = false;
        if (state.dashboardSearchQuery.trim()) {
          dashboardCountEl.textContent = `전체 ${totalDrivers}명 중 ${allDrivers.length}명 표시 · 스크롤하여 확인`;
        } else if (allDrivers.length === totalDrivers) {
          dashboardCountEl.textContent = `등록 기사 ${totalDrivers}명 전체 표시 · 스크롤하여 확인`;
        } else {
          dashboardCountEl.textContent = `등록 기사 ${totalDrivers}명 중 ${allDrivers.length}명 표시 · 스크롤하여 확인`;
        }
      }
    }
    $('#dashboardNotices').innerHTML = renderNoticeItems(notices().slice(0, 4), false);
    Sort?.markScope(document.querySelector('[data-sort-table="dashboard"]'), state.dashboardSort);
    window.BremPerf?.timeEnd?.('admin.renderDashboard');
  }

  function platformCalls(platform) {
    const date = callFilterDate(platform);
    return calls()
      .filter(call => normalizePlatform(call.platform) === platform
        && String(call.date).slice(0, 10) === date
        && driverMatchesCallRecordsSearch(call.driverId, platform))
      .sort((a, b) => driverName(a.driverId).localeCompare(driverName(b.driverId), 'ko'));
  }

  function pruneSelectedCallIds() {
    const validIds = new Set(calls().map(call => call.id));
    selectedCallIds.forEach(id => {
      if (!validIds.has(id)) selectedCallIds.delete(id);
    });
  }

  function updateCallSelectionUi(platform) {
    const visibleCalls = platformCalls(platform);
    const visibleIds = visibleCalls.map(call => call.id);
    const selectedVisible = visibleIds.filter(id => selectedCallIds.has(id));
    const count = selectedVisible.length;
    const bulkBtn = $(`#bulkDeleteCalls-${platform}`);
    const selectAll = $(`#selectAllCalls-${platform}`);

    if (bulkBtn) {
      bulkBtn.disabled = count === 0;
      bulkBtn.textContent = count > 0 ? `선택 삭제 (${count})` : '선택 삭제';
    }

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
  }

  function deleteSelectedCalls(platform) {
    const ids = platformCalls(platform).filter(call => selectedCallIds.has(call.id)).map(call => call.id);
    if (!ids.length) {
      showToast('삭제할 콜수 기록을 선택해주세요.');
      return;
    }
    if (!window.confirm(`선택한 ${ids.length}건을 삭제하시겠습니까?`)) return;

    void (async () => {
      try {
        await BremStorage.ensureSectionLoaded('calls');
        await BremStorage.calls.removeByIdsAsync(ids);
        ids.forEach(id => selectedCallIds.delete(id));
        showToast(`${ids.length}건 삭제되었습니다.`);
        renderAll();
      } catch (error) {
        console.error('[BREM] call bulk delete failed:', error);
        showToast(error.message || '콜수 삭제 저장에 실패했습니다.');
        renderAll();
      }
    })();
  }

  function renderCallEditLogs() {
    PLATFORMS.forEach(platform => {
      const date = callFilterDate(platform);
      const dateLabel = formatDate(date);
      const rowsEl = $(`#callEditLogRows-${platform}`);
      const summaryEl = $(`#callEditLogSummary-${platform}`);
      if (!rowsEl) return;

      const logs = callEditLogsForPlatform(platform);
      const displayLogs = logs.slice(0, CALL_RECORDS_VISIBLE_LIMIT);
      const hiddenCount = Math.max(0, logs.length - displayLogs.length);
      const emptyMessage = callRecordsSearch(platform)
        ? '검색 결과에 해당하는 수정 기록이 없습니다.'
        : `${dateLabel} 수정 기록이 없습니다.`;

      rowsEl.innerHTML = displayLogs.map(entry => `
        <tr class="call-edit-log-row">
          <td>${escapeHtml(formatDateTime(entry.editedAt))}</td>
          <td>${formatDate(entry.date)}</td>
          <td>${escapeHtml(driverName(entry.driverId))}</td>
          <td>${escapeHtml(formatCallEditChange(entry))}</td>
          <td>${escapeHtml(entry.editedBy || '-')}</td>
        </tr>
      `).join('') || emptyRow(5, emptyMessage);

      if (summaryEl) {
        if (!logs.length) {
          summaryEl.textContent = '';
        } else {
          summaryEl.textContent = hiddenCount > 0
            ? `${dateLabel} · 총 ${number(logs.length)}건 · 표시 ${number(displayLogs.length)}건 (스크롤)`
            : `${dateLabel} · 총 ${number(logs.length)}건`;
        }
      }
    });
  }

  function summarizeCallRecords(platformCallList, dateLabel) {
    if (!platformCallList.length) return '';
    const totalCalls = platformCallList.reduce((sum, call) => sum + Number(call.count || 0), 0);
    const driverCount = new Set(platformCallList.map(call => call.driverId)).size;
    return `${dateLabel} · ${number(driverCount)}명 · 총 ${number(totalCalls)}콜 · ${number(platformCallList.length)}건`;
  }

  function renderCalls() {
    pruneSelectedCallIds();
    PLATFORMS.forEach(platform => {
      const date = callFilterDate(platform);
      const p = normalizePlatform(platform);
      const dateLabel = formatDate(date);
      const emptyMessage = callRecordsSearch(p)
        ? '검색 결과에 해당하는 콜수 기록이 없습니다.'
        : `${dateLabel} ${platformLabel(platform)} 콜수 기록이 없습니다.`;
      const rowsEl = $(`#callRows-${platform}`);
      const summaryEl = $(`#callRowsSummary-${platform}`);
      if (!rowsEl) return;

      const platformCallList = platformCalls(platform);
      const displayLimit = CALL_RECORDS_VISIBLE_LIMIT;
      const displayCalls = platformCallList.slice(0, displayLimit);
      const hiddenCount = Math.max(0, platformCallList.length - displayCalls.length);

      rowsEl.innerHTML = displayCalls.map(call => `
        <tr${selectedCallIds.has(call.id) ? ' class="row-selected"' : ''}>
          <td class="col-select">
            <input type="checkbox" class="call-select-check" data-select-call="${call.id}" aria-label="선택"${selectedCallIds.has(call.id) ? ' checked' : ''}>
          </td>
          <td>${formatDate(call.date)}</td>
          <td>${escapeHtml(driverName(call.driverId))}</td>
          <td>${number(call.count)}</td>
          <td><button type="button" class="small-btn danger-btn" data-delete-call="${call.id}">삭제</button></td>
        </tr>
      `).join('') || emptyRow(5, emptyMessage);

      if (summaryEl) {
        if (!platformCallList.length) {
          summaryEl.textContent = `${dateLabel} · 기록 없음`;
        } else {
          const baseSummary = summarizeCallRecords(platformCallList, dateLabel);
          summaryEl.textContent = hiddenCount > 0
            ? `${baseSummary} · 표시 ${number(displayCalls.length)}건 (스크롤)`
            : baseSummary;
        }
      }

      updateCallSelectionUi(platform);
    });
    renderCallEditLogs();
  }

  function platformRejections(platform) {
    return rejections()
      .filter(entry => normalizePlatform(entry.platform) === platform && driverMatchesSearch(entry.driverId))
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  }

  function pruneSelectedRejectionIds() {
    const validIds = new Set(rejections().map(entry => entry.id));
    selectedRejectionIds.forEach(id => {
      if (!validIds.has(id)) selectedRejectionIds.delete(id);
    });
  }

  function updateRejectionSelectionUi(platform) {
    const visibleEntries = platformRejections(platform);
    const visibleIds = visibleEntries.map(entry => entry.id);
    const selectedVisible = visibleIds.filter(id => selectedRejectionIds.has(id));
    const count = selectedVisible.length;
    const bulkBtn = $(`#bulkDeleteRejections-${platform}`);
    const selectAll = $(`#selectAllRejections-${platform}`);
    const deleteAllBtn = $(`#deleteAllRejections-${platform}`);

    if (bulkBtn) {
      bulkBtn.disabled = count === 0;
      bulkBtn.textContent = count > 0 ? `선택 삭제 (${count})` : '선택 삭제';
    }

    if (deleteAllBtn) {
      deleteAllBtn.disabled = visibleEntries.length === 0;
    }

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
  }

  function deleteSelectedRejections(platform) {
    const ids = platformRejections(platform)
      .filter(entry => selectedRejectionIds.has(entry.id))
      .map(entry => entry.id);
    if (!ids.length) {
      showToast('삭제할 기록을 선택해주세요.');
      return;
    }
    if (!window.confirm(`선택한 ${ids.length}건의 ${platformRateLabel(platform)} 기록을 삭제하시겠습니까?`)) return;

    ids.forEach(id => selectedRejectionIds.delete(id));
    void BremStorage.rejections.removeByIdsAsync(ids).then(() => {
      showToast(`${ids.length}건 삭제되었습니다.`);
      renderAll();
    }).catch(error => {
      console.error('[BREM] rejection bulk delete failed:', error);
      showToast(error.message || '삭제 저장에 실패했습니다.');
      renderAll();
    });
  }

  function deleteAllRejections(platform) {
    const entries = platformRejections(platform);
    if (!entries.length) {
      showToast('삭제할 기록이 없습니다.');
      return;
    }
    const label = `${platformLabel(platform)} ${platformRateLabel(platform)}`;
    if (!window.confirm(`표시된 ${label} 기록 ${entries.length}건을 전체 삭제하시겠습니까?\n\n되돌릴 수 없습니다.`)) return;

    entries.forEach(entry => selectedRejectionIds.delete(entry.id));
    void BremStorage.rejections.removeByIdsAsync(entries.map(entry => entry.id)).then(() => {
      showToast(`${entries.length}건 전체 삭제되었습니다.`);
      renderAll();
    }).catch(error => {
      console.error('[BREM] rejection delete all failed:', error);
      showToast(error.message || '삭제 저장에 실패했습니다.');
      renderAll();
    });
  }

  let riderPublishStatusRequest = 0;

  function renderRiderPublishStatus() {
    const statusEl = $('#riderAppPublishStatus');
    const publishBtns = document.querySelectorAll('[data-rider-app-publish]');
    const requestId = ++riderPublishStatusRequest;

    void (async () => {
      const serverStatus = await BremStorage.riderViewPublish?.fetchStatusFromServer?.().catch(() => null);
      if (requestId !== riderPublishStatusRequest) return;

      const pending = serverStatus?.ok
        ? {
          pendingCalls: serverStatus.pendingCalls || 0,
          pendingRejections: serverStatus.pendingRejections || 0,
          pendingTotal: serverStatus.pendingTotal || 0
        }
        : BremStorage.riderViewPublish?.countPending?.() || {};
      const meta = BremStorage.riderViewPublish?.getMeta?.() || {};
      const publishedAt = (serverStatus?.ok && serverStatus.publishedAt)
        ? serverStatus.publishedAt
        : meta.publishedAt;
      const publishedLabel = window.BremDriverUtils?.formatRiderPublishDateTime?.(publishedAt)
        || (publishedAt ? formatDateTime(publishedAt) : '');

      publishBtns.forEach(btn => {
        btn.title = pending.pendingTotal > 0
          ? `미반영 ${pending.pendingTotal}건 · 콜수 ${pending.pendingCalls} · 거절율 ${pending.pendingRejections}`
          : '장기근속 설정 포함 전체 스냅샷 반영 (월·주간 목표는 실시간 연동)';
      });

      if (!statusEl) return;

      const parts = [];
      if (pending.pendingCalls) parts.push(`콜수 ${number(pending.pendingCalls)}`);
      if (pending.pendingRejections) parts.push(`거절율 ${number(pending.pendingRejections)}`);
      const pendingLabel = parts.length ? parts.join(' · ') : '';

      if (publishedLabel && pendingLabel) {
        statusEl.textContent = `마지막 반영 ${publishedLabel} · 미반영 ${pendingLabel}`;
      } else if (publishedLabel) {
        statusEl.textContent = `마지막 반영 ${publishedLabel}`;
      } else if (pendingLabel) {
        statusEl.textContent = `미반영 ${pendingLabel} · 「라이더 앱 반영」 클릭`;
      } else {
        statusEl.textContent = '검수 후 「라이더 앱 반영」으로 기사앱에 공개';
      }
    })();
  }

  function handleRiderAppPublish() {
    const pending = BremStorage.riderViewPublish?.countPending?.() || {};
    const pendingNote = pending.pendingTotal
      ? `\n\n미반영 ${pending.pendingTotal}건 (콜수 ${pending.pendingCalls} · 거절율 ${pending.pendingRejections})`
      : '\n\n월·주간 목표는 실시간 연동됩니다. 장기근속 설정도 함께 최신 스냅샷으로 반영됩니다.';
    if (!window.confirm(`콜수·거절율·장기근속 등 연동 데이터를 기사 전용 앱에 반영하시겠습니까? (월·주간 목표는 실시간 연동)${pendingNote}`)) return;

    void (async () => {
      const publishBtns = document.querySelectorAll('[data-rider-app-publish]');
      publishBtns.forEach(btn => { btn.disabled = true; });
      try {
        await BremStorage.ensureSectionLoaded?.('rejections');
        await BremStorage.ensureSectionLoaded?.('calls');
        await BremStorage.ensureSectionLoaded?.('targets');
        await BremStorage.flushStorage?.();
        const result = await BremStorage.riderViewPublish.publishAllToRiderView();
        const label = window.BremDriverUtils?.formatRiderPublishDateTime?.(result.publishedAt) || formatDateTime(result.publishedAt);
        const detail = [
          result.callsPublished ? `콜수 ${result.callsPublished}` : '',
          result.rejectionsPublished ? `거절율 ${result.rejectionsPublished}` : '',
          result.targetsPublished ? `목표 ${result.targetsPublished}` : ''
        ].filter(Boolean).join(' · ');
        showToast(detail
          ? `기사앱 반영 완료 · ${detail} · ${label}`
          : `기사앱 반영 완료 · ${label}`);
        renderAll();
      } catch (error) {
        console.error('[BREM] rider app publish failed:', error);
        showToast(error.message || '기사앱 반영에 실패했습니다.');
      } finally {
        publishBtns.forEach(btn => { btn.disabled = false; });
        renderRiderPublishStatus();
      }
    })();
  }

  function renderRejections() {
    renderRiderPublishStatus();
    pruneSelectedRejectionIds();
    PLATFORMS.forEach(platform => {
      updateRejectionWeekPreview(state.rejectionWeekByPlatform[platform] || weekStartKey(), platform);
      fillRejectionRateInput(platform);

      const emptyMessage = state.driverSearchQuery.trim()
        ? `검색 결과에 해당하는 ${platformRateLabel(platform)} 기록이 없습니다.`
        : `${platformLabel(platform)} 주간 ${platformRateLabel(platform)} 기록이 없습니다.`;
      const rowsEl = $(`#rejectionRows-${platform}`);
      if (!rowsEl) return;
      const platformList = platformRejections(platform);
      rowsEl.innerHTML = platformList.map(entry => `
          <tr${selectedRejectionIds.has(entry.id) ? ' class="row-selected"' : ''}>
            <td class="col-select">
              <input type="checkbox" class="rejection-select-check" data-select-rejection="${entry.id}" aria-label="선택"${selectedRejectionIds.has(entry.id) ? ' checked' : ''}>
            </td>
            <td>${formatDate(entry.weekStart)} ~ ${formatDate(weekEndKey(entry.weekStart))}</td>
            <td>${escapeHtml(driverName(entry.driverId))}</td>
            <td>${formatPercent(entry.rate, entry)}</td>
            <td><button type="button" class="small-btn danger-btn" data-delete-rejection="${entry.id}">삭제</button></td>
          </tr>
        `).join('') || emptyRow(5, emptyMessage);

      updateRejectionSelectionUi(platform);
    });
  }

  function formatPercent(value, entry) {
    const unmeasured = entry?.stats?.unmeasured === true;
    if (unmeasured || value == null) return '미집계';
    const rate = Number(value);
    if (Number.isNaN(rate)) return '-';
    return `${rate % 1 === 0 ? rate : rate.toFixed(1)}%`;
  }

  function renderTargets() {
    updateAdminWeekTargetPreview(weekStartKey());
    updateTargetMonthLabel();
    const monthlyEmptyMessage = state.driverSearchQuery.trim()
      ? '검색 결과에 해당하는 월간 목표가 없습니다.'
      : '월간 목표 콜수를 입력하세요.';
    const weeklyEmptyMessage = state.driverSearchQuery.trim()
      ? '검색 결과에 해당하는 주간 목표가 없습니다.'
      : '주간 목표 콜수를 입력하세요.';

    $('#targetRows').innerHTML = targets()
      .filter(target => driverMatchesSearch(target.driverId))
      .sort((a, b) => b.month.localeCompare(a.month))
      .map(target => {
        const rate = rateFor(target.driverId, target.month);
        return `
          <tr>
            <td>${escapeHtml(driverName(target.driverId))}</td>
            <td>${formatMonthLabel(target.month)}</td>
            <td>${number(monthCalls(target.driverId, target.month))}</td>
            <td class="target-count-cell">
              <input
                type="number"
                class="inline-target-input"
                min="1"
                value="${target.count}"
                data-edit-monthly-target="${target.id}"
              >
            </td>
            <td>${progress(rate)}</td>
            <td class="target-action-cell">
              <button class="small-btn" type="button" data-save-monthly-target="${target.id}">저장</button>
              <button class="small-btn danger-btn" type="button" data-delete-target="${target.id}">삭제</button>
            </td>
          </tr>
        `;
      }).join('') || emptyRow(6, monthlyEmptyMessage);

    $('#weeklyTargetRows').innerHTML = weeklyTargets()
      .filter(target => driverMatchesSearch(target.driverId))
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
      .map(target => {
        const rate = weeklyRateFor(target.driverId, target.weekStart);
        return `
          <tr>
            <td>${escapeHtml(driverName(target.driverId))}</td>
            <td class="target-week-cell">
              <button type="button" class="week-picker-trigger inline-week-picker-trigger" data-week-picker-trigger="${target.id}">
                <span data-week-picker-label="${target.id}">${formatDate(target.weekStart)}</span>
              </button>
              <input type="hidden" value="${target.weekStart}" data-edit-weekly-week="${target.id}">
              <span class="inline-week-range" data-week-range-for="${target.id}">
                ${formatDate(target.weekStart)} ~ ${formatDate(weekEndKey(target.weekStart))}
              </span>
            </td>
            <td>${number(weekCalls(target.driverId, target.weekStart))}</td>
            <td class="target-count-cell">
              <input
                type="number"
                class="inline-target-input"
                min="1"
                value="${target.count}"
                data-edit-weekly-target="${target.id}"
              >
            </td>
            <td>${progress(rate)}</td>
            <td class="target-action-cell">
              <button class="small-btn" type="button" data-save-weekly-target="${target.id}">저장</button>
              <button class="small-btn danger-btn" type="button" data-delete-weekly-target="${target.id}">삭제</button>
            </td>
          </tr>
        `;
      }).join('') || emptyRow(6, weeklyEmptyMessage);
  }

  function updateEventSettingsSearchStatus(visibleCount, totalCount) {
    const result = $('#eventSettingsSearchResult');
    const clearBtn = $('#eventSettingsSearchClear');
    const query = state.eventSettingsSearchQuery.trim();

    if (clearBtn) clearBtn.hidden = !query;
    if (!result) return;

    if (!query) {
      result.textContent = totalCount
        ? `전체 기사 ${totalCount}명 · 아래 목록 스크롤`
        : '등록된 기사가 없습니다.';
      return;
    }

    result.textContent = visibleCount
      ? `"${query}" 검색 결과 ${visibleCount}명`
      : `"${query}" 검색 결과 없음`;
  }

  function applyEventSettingsFilter() {
    const container = $('#eventSettings');
    if (!container) return;

    const query = state.eventSettingsSearchQuery.trim();
    const allDrivers = drivers();
    const driverMap = new Map(allDrivers.map(driver => [driver.id, driver]));
    let visibleCount = 0;

    container.querySelectorAll('.event-driver-row[data-driver-id]').forEach(row => {
      const driver = driverMap.get(row.dataset.driverId);
      const visible = Boolean(driver && matchesDriverSearch(driver, query));
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const emptyEl = container.querySelector('.event-settings-empty');
    if (emptyEl) emptyEl.hidden = visibleCount > 0 || Boolean(query);

    let noResultEl = container.querySelector('.event-settings-no-results');
    if (query && allDrivers.length && visibleCount === 0) {
      if (!noResultEl) {
        noResultEl = document.createElement('div');
        noResultEl.className = 'empty event-settings-no-results';
        noResultEl.textContent = '검색 결과에 해당하는 기사가 없습니다.';
        container.appendChild(noResultEl);
      }
      noResultEl.hidden = false;
    } else if (noResultEl) {
      noResultEl.hidden = true;
    }

    updateEventSettingsSearchStatus(visibleCount, allDrivers.length);
  }

  function handleEventSettingsSearchChange() {
    if ($('#eventSettings')?.querySelector('.event-driver-row[data-driver-id]')) {
      applyEventSettingsFilter();
      return;
    }
    renderMissions();
  }

  const debouncedEventSettingsSearchChange = window.BremPerf?.debounce
    ? window.BremPerf.debounce(handleEventSettingsSearchChange, 120)
    : handleEventSettingsSearchChange;

  function renderMissions() {
    const catalog = eventCatalog();
    const allDrivers = drivers();
    const emptyMessage = '기사등록 프로그램에서 기사를 먼저 등록하세요.';

    $('#eventItemList').innerHTML = catalog.map(item => `
      <div class="mission-item">
        <h3>${escapeHtml(item.name)}</h3>
        <p>목표 갯수: ${number(item.targetCount)}개</p>
        <div class="notice-actions">
          <button class="small-btn danger-btn" data-delete-event-item="${item.id}">삭제</button>
        </div>
      </div>
    `).join('') || '<div class="empty">등록된 장기근속이벤트 아이템이 없습니다.</div>';

    const sortedDrivers = Sort
      ? Sort.sortItems(allDrivers, state.eventSettingsSort, eventSettingsSortSchema)
      : allDrivers;

    const sortHeader = Sort ? `
      <div class="event-settings-sort-header">
        ${Sort.header('기사', 'name', state.eventSettingsSort)}
        ${Sort.header('이벤트 아이템', 'item', state.eventSettingsSort)}
        ${Sort.header('집계 플랫폼', 'platform', state.eventSettingsSort)}
        ${Sort.header('시작일', 'startDate', state.eventSettingsSort)}
        <span class="event-settings-actions-col">저장</span>
      </div>
    ` : '';

    $('#eventSettings').innerHTML = allDrivers.length ? [
      sortHeader,
      ...sortedDrivers.map(driver => {
        const draft = getDriverEventDraft(driver);
        const isDirty = isEventSettingsDirty(driver.id);
        const itemId = draft.itemId || (eventItemFor(driver) || {}).id || driver.longEventItemId || driver.longEventItem || '';
        const platform = draft.platform || BremStorage.events.getDriverEventPlatform(driver);
        const startDate = draft.startDate || driver.longEventStartDate || '';
        return `
      <div class="event-driver-row${isDirty ? ' event-driver-row-dirty' : ''}" data-driver-id="${escapeHtml(driver.id)}">
        <strong>${escapeHtml(driver.name)} · ${escapeHtml(driver.phone)}</strong>
        <label>
          이벤트 아이템
          <select data-event-driver="${driver.id}">
            ${eventOptions(itemId)}
          </select>
        </label>
        <label>
          집계 플랫폼
          <select data-event-platform="${driver.id}" title="쿠팡 또는 배민 중 하나만 집계됩니다. 합산은 사용하지 않습니다.">
            ${eventPlatformOptions(platform)}
          </select>
        </label>
        <label class="event-start-date-field">
          <span>시작일</span>
          <button type="button" class="date-range-button" data-event-start-button="${driver.id}">
            ${eventStartButtonLabel(startDate)}
          </button>
          <input type="hidden" data-event-start="${driver.id}" value="${startDate || ''}">
        </label>
        <div class="event-driver-row-actions">
          <button type="button" class="small-btn primary-btn" data-save-event-settings="${escapeHtml(driver.id)}"${isDirty ? '' : ' disabled'}>저장</button>
        </div>
      </div>
    `;
      })
    ].join('') : `<div class="empty event-settings-empty">${emptyMessage}</div>`;

    applyEventSettingsFilter();
    Sort?.markScope(document.querySelector('[data-sort-table="event-settings"]'), state.eventSettingsSort);
    updateEventSettingsSaveAllUi();
  }

  function renderNoticeItems(items, withActions) {
    if (!items.length) return '<div class="empty">공지사항이 없습니다.</div>';
    return items
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
      .map(notice => `
        <article class="notice-item">
          <h3>${notice.pinned ? '📌 ' : ''}${escapeHtml(notice.title)}</h3>
          <p>${escapeHtml(notice.content)}</p>
          ${withActions ? `
            <div class="notice-actions">
              <button class="small-btn" data-edit-notice="${notice.id}">수정</button>
              <button class="small-btn danger-btn" data-delete-notice="${notice.id}">삭제</button>
            </div>
          ` : ''}
        </article>
      `).join('');
  }

  function renderNotices() {
    $('#noticeRows').innerHTML = renderNoticeItems(notices(), true);
  }

  function inquiryStatusLabel(status) {
    if (status === 'done') return '처리완료';
    if (status === 'read') return '확인';
    return '신규';
  }

  function inquiryStatusClass(status) {
    if (status === 'done') return 'inquiry-badge inquiry-badge--done';
    if (status === 'read') return 'inquiry-badge inquiry-badge--read';
    return 'inquiry-badge inquiry-badge--new';
  }

  async function renderRiderInquiries() {
    const rowsEl = $('#riderInquiryRows');
    const summaryEl = $('#riderInquirySummary');
    if (!rowsEl) return;

    const list = await loadRiderInquiries();
    const newCount = list.filter(item => item.status === 'new').length;

    if (summaryEl) {
      summaryEl.textContent = newCount
        ? `미확인 문의 ${newCount}건 · 홈페이지에서 접수된 문의를 확인합니다.`
        : '홈페이지에서 접수된 문의를 확인합니다.';
    }

    if (!list.length) {
      rowsEl.innerHTML = '<p class="empty-state">접수된 라이더 문의가 없습니다.</p>';
      return;
    }

    rowsEl.innerHTML = list.map(inquiry => `
      <article class="notice-item inquiry-item">
        <div class="notice-item-head">
          <div>
            <span class="${inquiryStatusClass(inquiry.status)}">${escapeHtml(inquiryStatusLabel(inquiry.status))}</span>
            <strong>${escapeHtml(inquiry.name || '-')} · ${escapeHtml(inquiry.phone || '-')}</strong>
          </div>
          <span class="notice-date">${formatDateTime(inquiry.createdAt)}</span>
        </div>
        <p class="inquiry-meta">
          <span>지역: ${escapeHtml(inquiry.area || '-')}</span>
          <span>구분: ${escapeHtml(inquiry.inquiryType || '-')}</span>
        </p>
        <p class="notice-content">${escapeHtml(inquiry.message || '')}</p>
        <div class="notice-actions">
          ${inquiry.status === 'new' ? `<button class="small-btn" data-mark-inquiry="${inquiry.id}" data-status="read">확인</button>` : ''}
          ${inquiry.status !== 'done' ? `<button class="small-btn" data-mark-inquiry="${inquiry.id}" data-status="done">처리완료</button>` : ''}
          <button class="small-btn danger-btn" data-delete-inquiry="${inquiry.id}">삭제</button>
        </div>
      </article>
    `).join('');
  }

  function isBaeminSettlementPlatform(platform) {
    return normalizePlatform(platform) === 'baemin';
  }

  function settlementAmountValue(record) {
    return Number(record.deliveryAmount ?? record.settlementAmount ?? 0);
  }

  function getSettlementPeriodFilter(platform) {
    const value = $(`#settlementPeriod-${normalizePlatform(platform)}`)?.value?.trim() || '';
    return value.slice(0, 10);
  }

  function latestSettlementActivityForPlatform(platform) {
    const p = normalizePlatform(platform);
    const latestLog = BremStorage.settlementUploadLogs.getFiltered({ kind: 'daily', platform: p })[0];
    const latestLogPeriod = String(latestLog?.period || '').slice(0, 10);
    if (latestLogPeriod) {
      return {
        period: latestLogPeriod,
        weekStart: String(latestLog.weekStart || weekStartKey(latestLogPeriod)).slice(0, 10)
      };
    }

    const latestSettlement = settlements()
      .filter(record => normalizePlatform(record.platform) === p)
      .map(record => String(record.period || '').slice(0, 10))
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))[0] || '';

    return {
      period: latestSettlement,
      weekStart: latestSettlement ? weekStartKey(latestSettlement) : ''
    };
  }

  function ensureSettlementHistoryDay(platform) {
    const p = normalizePlatform(platform);
    if (!state.settlementHistoryDayByPlatform[p]) {
      const uploadPeriod = getSettlementPeriodFilter(p);
      const latest = latestSettlementActivityForPlatform(p);
      state.settlementHistoryDayByPlatform[p] = uploadPeriod || latest.period || today();
    }
    const input = $(`#settlementHistoryDay-${p}`);
    if (input && !input.value) {
      input.value = state.settlementHistoryDayByPlatform[p];
    }
    return state.settlementHistoryDayByPlatform[p];
  }

  function getSettlementHistoryDayFilter(platform) {
    return ensureSettlementHistoryDay(normalizePlatform(platform));
  }

  function setSettlementHistoryDay(platform, dayValue) {
    const p = normalizePlatform(platform);
    const dayKey = String(dayValue || '').slice(0, 10);
    state.settlementHistoryDayByPlatform[p] = dayKey;
    const input = $(`#settlementHistoryDay-${p}`);
    if (input) input.value = dayKey;
    return dayKey;
  }

  function setSettlementWeekFilters(platform, weekStart) {
    const p = normalizePlatform(platform);
    const picked = weekStartKey(weekStart || weekStartKey());
    state.settlementLogWeekByPlatform[p] = picked;
    state.settlementUnmatchedWeekByPlatform[p] = picked;
    const logInput = $(`#settlementLogWeek-${p}`);
    const unmatchedInput = $(`#settlementUnmatchedWeek-${p}`);
    if (logInput) logInput.value = picked;
    if (unmatchedInput) unmatchedInput.value = picked;
    return picked;
  }

  function ensureSettlementLogWeek(platform) {
    const p = normalizePlatform(platform);
    if (!state.settlementLogWeekByPlatform[p]) {
      const latest = latestSettlementActivityForPlatform(p);
      state.settlementLogWeekByPlatform[p] = latest.weekStart || weekStartKey();
    }
    const input = $(`#settlementLogWeek-${p}`);
    if (input && !input.value) {
      input.value = state.settlementLogWeekByPlatform[p];
    }
    return state.settlementLogWeekByPlatform[p];
  }

  function updateSettlementLogWeekRangeLabel(platform) {
    const p = normalizePlatform(platform);
    const weekStart = ensureSettlementLogWeek(p);
    const label = $(`#settlementLogWeekRange-${p}`);
    if (label) {
      label.textContent = weekStart
        ? `표시 범위: ${formatDate(weekStart)}(수) ~ ${formatDate(weekEndKey(weekStart))}(화)`
        : '';
    }
  }

  function settlementUploadLogStatusLabel(status) {
    switch (String(status || '')) {
      case 'applied':
        return '반영완료';
      case 'duplicate_skipped':
        return '중복스킵';
      case 'saved':
        return '저장완료';
      default:
        return '업로드';
    }
  }

  function serializeSettlementLogRecords(records = []) {
    return (Array.isArray(records) ? records : []).map(record => ({
      driverId: record.driverId || '',
      driverName: record.driverName || '',
      riderId: record.riderId || '',
      rawName: record.rawName || '',
      name: record.name || '',
      orderCount: Number(record.orderCount ?? record.callCount ?? 0),
      deliveryAmount: settlementAmountValue(record),
      settlementAmount: settlementAmountValue(record)
    }));
  }

  function recordDailySettlementUploadLog(platform, payload = {}) {
    const p = normalizePlatform(platform);
    const period = String(payload.period || '').slice(0, 10);
    const weekStart = period ? weekStartKey(period) : weekStartKey();
    const matchedRecords = serializeSettlementLogRecords(payload.matchedRecords || []);
    const unmatchedRecords = serializeSettlementLogRecords(payload.unmatchedRecords || []);
    const contentHash = payload.contentHash
      || (matchedRecords.length
        ? BremStorage.settlementUploadLogs.buildContentHash(p, period, matchedRecords)
        : '');
    const totalOrderCount = matchedRecords.reduce((sum, row) => sum + Number(row.orderCount || 0), 0);
    return BremStorage.settlementUploadLogs.add({
      kind: 'daily',
      platform: p,
      fileName: payload.fileName || '',
      period,
      weekStart,
      status: payload.status || 'uploaded',
      matchedCount: Number(payload.matchedCount ?? matchedRecords.length ?? 0),
      unmatchedCount: Number(payload.unmatchedCount ?? unmatchedRecords.length ?? 0),
      totalDeliveryAmount: Number(payload.totalDeliveryAmount || 0),
      totalOrderCount,
      contentHash,
      matchedRecords,
      unmatchedRecords,
      appliedRecords: serializeSettlementLogRecords(payload.appliedRecords || []),
      duplicateOfLogId: payload.duplicateOfLogId || '',
      skipReason: payload.skipReason || '',
      uploadedAt: payload.uploadedAt || new Date().toISOString(),
      appliedAt: payload.appliedAt || ''
    });
  }

  function hideSettlementUploadLogDetail() {
    state.settlementUploadLogDetailId = '';
    const card = $('#settlementUploadLogDetailCard');
    if (card) card.hidden = true;
  }

  function renderSettlementUploadLogDetail(logId) {
    const log = BremStorage.settlementUploadLogs.getById(logId);
    const card = $('#settlementUploadLogDetailCard');
    if (!card || !log || log.kind !== 'daily') return;

    state.settlementUploadLogDetailId = log.id;
    card.hidden = false;

    const p = normalizePlatform(log.platform);
    const appliedRecords = log.appliedRecords?.length ? log.appliedRecords : log.matchedRecords;
    const unmatchedRecords = log.unmatchedRecords || [];
    const duplicateNote = log.status === 'duplicate_skipped'
      ? `<p class="weekly-call-mismatch-banner">⚠ ${escapeHtml(log.skipReason || '동일 데이터 — 중복 반영을 건너뛰었습니다.')}</p>`
      : '';
    const duplicateRef = log.duplicateOfLogId
      ? `<p>중복 기준 기록 ID: <code>${escapeHtml(log.duplicateOfLogId)}</code></p>`
      : '';

    $('#settlementUploadLogDetailTitle').textContent = `${platformLabel(p)} 일정산 업로드 상세`;
    $('#settlementUploadLogDetailMeta').innerHTML = `
      <p>정산일: <strong>${escapeHtml(formatDate(log.period))}</strong></p>
      <p>파일명: <strong>${escapeHtml(log.fileName || '-')}</strong></p>
      <p>상태: <strong>${escapeHtml(settlementUploadLogStatusLabel(log.status))}</strong></p>
      <p>매칭 ${number(log.matchedCount)}명 · 미매칭 ${number(log.unmatchedCount || 0)}명 · 총 오더수 ${number(log.totalOrderCount || 0)} · 총 정산금액 ${formatMoney(log.totalDeliveryAmount || 0)}</p>
      <p>업로드: ${escapeHtml(formatDateTime(log.uploadedAt))}${log.appliedAt ? ` · 반영: ${escapeHtml(formatDateTime(log.appliedAt))}` : ''}</p>
      ${duplicateNote}
      ${duplicateRef}
    `;

    const headEl = $('#settlementUploadLogDetailHead');
    if (headEl) {
      headEl.innerHTML = isBaeminSettlementPlatform(p)
        ? `<tr>
            <th>배민 ID</th>
            <th>기사명</th>
            <th>콜수</th>
            <th>배달수행금액</th>
          </tr>`
        : `<tr>
            <th>기사명</th>
            <th>엑셀 성함</th>
            <th>콜수</th>
            <th>정산금액</th>
          </tr>`;
    }

    const appliedRows = (appliedRecords || []).map(record => {
      if (isBaeminSettlementPlatform(p)) {
        return `
          <tr>
            <td>${escapeHtml(record.riderId || '-')}</td>
            <td><strong>${escapeHtml(record.driverName || record.name || '-')}</strong></td>
            <td>${number(record.orderCount)}</td>
            <td>${formatMoney(settlementAmountValue(record))}</td>
          </tr>
        `;
      }
      return `
        <tr>
          <td><strong>${escapeHtml(record.driverName || record.name || '-')}</strong></td>
          <td>${escapeHtml(record.rawName || record.name || '-')}</td>
          <td>${number(record.orderCount)}</td>
          <td>${formatMoney(settlementAmountValue(record))}</td>
        </tr>
      `;
    }).join('');

    $('#settlementUploadLogDetailAppliedRows').innerHTML = appliedRows
      || '<tr><td colspan="4" class="empty">적용/매칭 내역이 없습니다.</td></tr>';

    const unmatchedBlock = $('#settlementUploadLogDetailUnmatchedBlock');
    const unmatchedRowsEl = $('#settlementUploadLogDetailUnmatchedRows');
    if (unmatchedBlock && unmatchedRowsEl) {
      if (!unmatchedRecords.length) {
        unmatchedBlock.hidden = true;
        unmatchedRowsEl.innerHTML = '';
      } else {
        unmatchedBlock.hidden = false;
        unmatchedRowsEl.innerHTML = unmatchedRecords.map(record => `
          <tr>
            <td>${escapeHtml(record.rawName || record.name || '-')}</td>
            <td>${escapeHtml(record.name || '-')}</td>
            <td>${number(record.orderCount)}</td>
            <td>${formatMoney(settlementAmountValue(record))}</td>
          </tr>
        `).join('');
      }
    }

    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const reapplyBtn = $('#settlementUploadLogDetailReapply');
    if (reapplyBtn) {
      const canReapply = canReapplySettlementUploadLog(log);
      reapplyBtn.hidden = !canReapply;
      reapplyBtn.disabled = !canReapply;
      reapplyBtn.dataset.reapplySettlementUploadLog = log.id;
    }
  }

  function renderSettlementUploadLogs(platform) {
    const p = normalizePlatform(platform);
    const weekStart = ensureSettlementLogWeek(p);
    updateSettlementLogWeekRangeLabel(p);
    const rowsEl = $(`#settlementUploadLogRows-${p}`);
    const summaryEl = $(`#settlementUploadLogSummary-${p}`);
    if (!rowsEl) return;

    const rows = BremStorage.settlementUploadLogs.getFiltered({
      kind: 'daily',
      platform: p,
      weekStart
    });

    const emptyMessage = `${formatDate(weekStart)} 주에 업로드한 ${platformLabel(p)} 일정산 기록이 없습니다. 다른 주 기록은 상단 적용주(수요일)를 변경하세요.`;

    rowsEl.innerHTML = rows.map(item => `
      <tr>
        <td>${formatDate(item.weekStart)} ~ ${formatDate(item.weekEnd)}</td>
        <td>${formatDate(item.period)}</td>
        <td>${escapeHtml(item.fileName || '-')}</td>
        <td>${escapeHtml(settlementUploadLogStatusLabel(item.status))}</td>
        <td>${Number(item.matchedCount || 0).toLocaleString('ko-KR')}명</td>
        <td>${formatDate(String(item.uploadedAt || '').slice(0, 10))}</td>
        <td class="settlement-upload-log-actions">
          <button type="button" class="small-btn" data-settlement-upload-log-detail="${escapeHtml(item.id)}">상세</button>
          ${canReapplySettlementUploadLog(item)
            ? `<button type="button" class="small-btn primary-btn" data-reapply-settlement-upload-log="${escapeHtml(item.id)}">재반영</button>`
            : ''}
          <button type="button" class="small-btn danger-btn" data-delete-settlement-upload-log="${escapeHtml(item.id)}">기록 삭제</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="7" class="empty">${emptyMessage}</td></tr>`;

    if (summaryEl) {
      summaryEl.textContent = rows.length ? `총 ${number(rows.length)}건` : '';
    }

    const clearWeekBtn = $(`#settlementUploadLogClearWeek-${p}`);
    if (clearWeekBtn) clearWeekBtn.disabled = !rows.length;

    const reapplyWeekBtn = $(`#settlementUploadLogReapplyWeek-${p}`);
    if (reapplyWeekBtn) {
      reapplyWeekBtn.disabled = !rows.some(canReapplySettlementUploadLog);
    }
  }

  function matchesSettlementPeriod(record, periodKey) {
    if (!periodKey) return true;
    return String(record.period || '').slice(0, 10) === periodKey;
  }

  function updateSettlementPeriodLabels(platform) {
    updateSettlementUnmatchedWeekLabel(normalizePlatform(platform));
  }

  function updateSettlementHistoryDayLabels(platform, dayKey) {
    const p = normalizePlatform(platform);
    const labelText = dayKey ? `· ${formatDate(dayKey)}` : '';
    const historyLabel = $(`#settlementHistoryPeriodLabel-${p}`);
    if (historyLabel) historyLabel.textContent = labelText;

    const historyClearBtn = $(`#settlementHistoryClearBtn-${p}`);
    if (historyClearBtn) historyClearBtn.disabled = !dayKey;
  }

  function ensureSettlementUnmatchedWeek(platform) {
    const p = normalizePlatform(platform);
    if (!state.settlementUnmatchedWeekByPlatform[p]) {
      state.settlementUnmatchedWeekByPlatform[p] = weekStartKey();
    }
    const input = $(`#settlementUnmatchedWeek-${p}`);
    if (input && !input.value) {
      input.value = state.settlementUnmatchedWeekByPlatform[p];
    }
    return state.settlementUnmatchedWeekByPlatform[p];
  }

  function updateSettlementUnmatchedWeekLabel(platform) {
    const p = normalizePlatform(platform);
    const weekStart = ensureSettlementUnmatchedWeek(p);
    const label = $(`#settlementUnmatchedWeekRange-${p}`);
    const periodLabel = $(`#settlementUnmatchedPeriodLabel-${p}`);
    if (label) {
      label.textContent = weekStart
        ? `표시 범위: ${formatDate(weekStart)}(수) ~ ${formatDate(weekEndKey(weekStart))}(화)`
        : '';
    }
    if (periodLabel) {
      periodLabel.textContent = weekStart ? `· ${formatDate(weekStart)} 주` : '';
    }
    const clearBtn = $(`#settlementUnmatchedClearBtn-${p}`);
    const retryBtn = $(`#settlementUnmatchedRetryBtn-${p}`);
    if (clearBtn) clearBtn.disabled = !weekStart;
    if (retryBtn) retryBtn.disabled = !weekStart;
  }

  function getSettlementUnmatchedWeekFilter(platform) {
    return ensureSettlementUnmatchedWeek(normalizePlatform(platform));
  }

  function settlementRowCells(record, platform) {
    const orderCount = Number(record.orderCount ?? record.callCount ?? 0);
    const amount = settlementAmountValue(record);

    if (isBaeminSettlementPlatform(platform)) {
      return `
        <td>${escapeHtml(record.riderId || '-')}</td>
        <td>${orderCount.toLocaleString('ko-KR')}</td>
        <td>${formatMoney(amount)}</td>
      `;
    }

    return `
      <td>${orderCount.toLocaleString('ko-KR')}</td>
      <td>${formatMoney(amount)}</td>
    `;
  }

  function renderBaeminMatchedRow(record) {
    return `
      <tr>
        <td>${escapeHtml(record.riderId || '-')}</td>
        <td><strong>${escapeHtml(record.driverName)}</strong></td>
        <td>${Number(record.orderCount || 0).toLocaleString('ko-KR')}</td>
        <td>${formatMoney(settlementAmountValue(record))}</td>
      </tr>
    `;
  }

  function renderBaeminUnmatchedRow(record) {
    return `
      <tr>
        <td>${escapeHtml(record.riderId || '-')}</td>
        <td>${escapeHtml(record.rawName || record.name)}</td>
        <td>${Number(record.orderCount || 0).toLocaleString('ko-KR')}</td>
        <td>${formatMoney(settlementAmountValue(record))}</td>
      </tr>
    `;
  }

  function renderSettlementPreview(platform) {
    const p = normalizePlatform(platform);
    const previewCard = $(`#settlementPreviewCard-${p}`);
    const preview = state.settlementPreviewByPlatform[p];
    const isBaemin = isBaeminSettlementPlatform(p);

    if (!previewCard) return;

    if (!preview) {
      previewCard.hidden = true;
      return;
    }

    previewCard.hidden = false;
    $(`#settlementPreviewPeriod-${p}`).textContent = preview.period
      ? formatDate(preview.period.length >= 10 ? preview.period.slice(0, 10) : preview.period)
      : '-';

    if (isBaemin) {
      $(`#settlementTotalDeliveries-${p}`).textContent = String(preview.totalDeliveries || 0);
      $(`#settlementTotalRiders-${p}`).textContent = String(preview.totalRiders || preview.totalRows || 0);
      $(`#settlementSuccessCount-${p}`).textContent = String(preview.matched.length);
      $(`#settlementFailedCount-${p}`).textContent = String(preview.unmatched.length);
      $(`#settlementTotalDeliveryAmount-${p}`).textContent = formatMoney(preview.totalDeliveryAmount || 0);

      $(`#settlementMatchedRows-${p}`).innerHTML = preview.matched.map(renderBaeminMatchedRow).join('')
        || '<tr><td colspan="4" class="empty">매칭된 기사가 없습니다.</td></tr>';
    } else {
      $(`#settlementTotalCount-${p}`).textContent = String(preview.totalRows);
      $(`#settlementSuccessCount-${p}`).textContent = String(preview.matched.length);
      $(`#settlementFailedCount-${p}`).textContent = String(preview.unmatched.length);

      $(`#settlementMatchedRows-${p}`).innerHTML = preview.matched.map(record => `
        <tr>
          <td><strong>${escapeHtml(record.driverName)}</strong></td>
          <td>${Number(record.orderCount || 0).toLocaleString('ko-KR')}</td>
          <td>${formatMoney(settlementAmountValue(record))}</td>
        </tr>
      `).join('') || '<tr><td colspan="3" class="empty">매칭된 기사가 없습니다.</td></tr>';
    }

    const failedBlock = $(`#settlementFailedBlock-${p}`);
    if (preview.unmatched.length) {
      failedBlock.hidden = false;
      $(`#settlementFailedRows-${p}`).innerHTML = preview.unmatched.map(record => (
        isBaemin ? renderBaeminUnmatchedRow(record) : `
          <tr>
            <td>${escapeHtml(record.rawName)}</td>
            <td>${escapeHtml(record.name)}</td>
            <td>${Number(record.orderCount || 0).toLocaleString('ko-KR')}</td>
            <td>${formatMoney(settlementAmountValue(record))}</td>
          </tr>
        `
      )).join('');
    } else {
      failedBlock.hidden = true;
      $(`#settlementFailedRows-${p}`).innerHTML = '';
    }
  }

  function renderSettlements() {
    PLATFORMS.forEach(platform => {
      const p = normalizePlatform(platform);
      const historyDay = getSettlementHistoryDayFilter(p);
      updateSettlementPeriodLabels(p);
      updateSettlementHistoryDayLabels(p, historyDay);

      const periodInput = $(`#settlementPeriod-${p}`);
      if (periodInput && !periodInput.value) {
        const latest = latestSettlementActivityForPlatform(p);
        if (latest.period) periodInput.value = latest.period;
      }

      const rows = settlements()
        .filter(record => normalizePlatform(record.platform) === p)
        .filter(record => matchesSettlementPeriod(record, historyDay))
        .filter(record => driverMatchesSettlementHistorySearch(record.driverId, p))
        .sort((a, b) => b.period.localeCompare(a.period) || b.appliedAt.localeCompare(a.appliedAt));

      const historyEl = $(`#settlementHistoryRows-${p}`);
      const summaryEl = $(`#settlementHistorySummary-${p}`);
      if (!historyEl) return;

      const emptyMessage = settlementHistorySearch(p)
        ? '검색 결과에 해당하는 정산 반영 내역이 없습니다.'
        : historyDay
          ? settlements().some(record => normalizePlatform(record.platform) === p)
            ? `${formatDate(historyDay)} ${platformLabel(p)} 반영 내역이 없습니다. 정산일을 변경해 보세요.`
            : `${formatDate(historyDay)} ${platformLabel(p)} 반영된 정산 내역이 없습니다.`
          : '정산일을 선택하세요.';

      historyEl.innerHTML = rows.map(record => `
        <tr>
          <td>${formatDate(record.period.length >= 10 ? record.period.slice(0, 10) : record.period)}</td>
          <td>${escapeHtml(driverName(record.driverId))}</td>
          ${settlementRowCells(record, p)}
          <td>${formatDate(record.appliedAt.slice(0, 10))}</td>
          <td>
            <button class="small-btn danger-btn" type="button" data-delete-settlement="${record.id}">삭제</button>
          </td>
        </tr>
      `).join('') || `<tr><td colspan="${isBaeminSettlementPlatform(p) ? 7 : 6}" class="empty">${emptyMessage}</td></tr>`;

      if (summaryEl) {
        summaryEl.textContent = rows.length
          ? `총 ${number(rows.length)}명 · ${formatDate(historyDay)}${settlementHistorySearch(p) ? ' · 이름 검색 적용' : ''}`
          : historyDay ? `${formatDate(historyDay)} 반영 내역 없음` : '';
      }

      renderSettlementPreview(p);
      renderSettlementUnmatched(p);
      renderSettlementUploadLogs(p);
    });
  }

  function renderPromotions() {
    if (typeof BremPromotionAdmin !== 'undefined') BremPromotionAdmin.refresh();
  }

  function renderSettlementUnmatched(platform) {
    const p = normalizePlatform(platform);
    const weekStart = getSettlementUnmatchedWeekFilter(p);
    const periodKey = getSettlementPeriodFilter(p);
    updateSettlementUnmatchedWeekLabel(p);
    const rows = settlementUnmatchedList()
      .filter(record => normalizePlatform(record.platform) === p)
      .filter(record => record.kind !== 'weekly')
      .filter(record => record.weekStart === weekStart)
      .filter(record => matchesSettlementPeriod(record, periodKey))
      .sort((a, b) => b.period.localeCompare(a.period) || b.savedAt.localeCompare(a.savedAt));

    const rowsEl = $(`#settlementUnmatchedHistoryRows-${p}`);
    if (!rowsEl) return;

    const emptyMessage = periodKey
      ? `${formatDate(periodKey)} ${platformLabel(p)} 미반영 기사 내역이 없습니다.`
      : weekStart
        ? `${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))} ${platformLabel(p)} 미반영 기사 내역이 없습니다.`
        : `${platformLabel(p)} 미반영 기사 내역이 없습니다.`;

    rowsEl.innerHTML = rows.map(record => {
      if (isBaeminSettlementPlatform(p)) {
        return `
          <tr>
            <td>${formatDate(record.period)}</td>
            <td>${escapeHtml(record.riderId || '-')}</td>
            <td>${escapeHtml(record.rawName || record.name)}</td>
            <td>${Number(record.orderCount || 0).toLocaleString('ko-KR')}</td>
            <td>${formatMoney(settlementAmountValue(record))}</td>
            <td>${formatDate(record.savedAt.slice(0, 10))}</td>
            <td>
              <button class="small-btn" type="button" data-retry-settlement-unmatched="${record.id}">재시도</button>
              <button class="small-btn danger-btn" type="button" data-delete-settlement-unmatched="${record.id}">삭제</button>
            </td>
          </tr>
        `;
      }

      return `
        <tr>
          <td>${formatDate(record.period)}</td>
          <td>${escapeHtml(record.rawName)}</td>
          <td>${escapeHtml(record.name)}</td>
          <td>${Number(record.orderCount || 0).toLocaleString('ko-KR')}</td>
          <td>${formatMoney(settlementAmountValue(record))}</td>
          <td>${formatDate(record.savedAt.slice(0, 10))}</td>
          <td>
            <button class="small-btn" type="button" data-retry-settlement-unmatched="${record.id}">재시도</button>
            <button class="small-btn danger-btn" type="button" data-delete-settlement-unmatched="${record.id}">삭제</button>
          </td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="7" class="empty">${emptyMessage}</td></tr>`;
  }

  function handleSettlementPeriodChange(platform) {
    const p = normalizePlatform(platform);
    const periodKey = getSettlementPeriodFilter(p);
    const preview = state.settlementPreviewByPlatform[p];
    if (preview && periodKey) {
      preview.period = periodKey;
    }
    if (periodKey) {
      setSettlementHistoryDay(p, periodKey);
      setSettlementWeekFilters(p, periodKey);
    }
    renderSettlements();
  }

  function clearSettlementHistoryForSelectedPeriod(platform) {
    const p = normalizePlatform(platform);
    const period = getSettlementHistoryDayFilter(p);
    if (!period) {
      showToast('정산일을 먼저 선택하세요.');
      return;
    }
    const count = settlements()
      .filter(record => normalizePlatform(record.platform) === p)
      .filter(record => matchesSettlementPeriod(record, period))
      .length;
    if (!count) {
      showToast('선택한 정산일 반영 내역이 없습니다.');
      return;
    }
    if (!window.confirm(`${formatDate(period)} ${platformLabel(p)} 정산 반영 ${count}건을 전체 삭제하시겠습니까?\n연결된 콜수·업로드 기록도 함께 삭제됩니다.`)) return;

    void (async () => {
      try {
        await BremStorage.ensureSectionLoaded('calls');
        await BremStorage.settlements.clearByPeriod(period, p);
        showToast(`${formatDate(period)} 정산 반영 ${count}건과 연결 콜수가 삭제되었습니다.`);
        renderAll();
      } catch (error) {
        console.error('[BREM] settlement clear failed:', error);
        showToast(error.message || '삭제 저장에 실패했습니다.');
        renderAll();
      }
    })();
  }

  function clearSettlementUploadLogsForSelectedWeek(platform) {
    const p = normalizePlatform(platform);
    const weekStart = ensureSettlementLogWeek(p);
    if (!weekStart) {
      showToast('적용주를 먼저 선택하세요.');
      return;
    }
    const rows = BremStorage.settlementUploadLogs.getFiltered({
      kind: 'daily',
      platform: p,
      weekStart
    });
    if (!rows.length) {
      showToast('선택한 주 업로드 기록이 없습니다.');
      return;
    }
    const appliedCount = rows.filter(item => item.status === 'applied').length;
    const rangeLabel = `${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))}`;
    const confirmMessage = appliedCount > 0
      ? `${rangeLabel} ${platformLabel(p)} 업로드 기록 ${rows.length}건을 전체 삭제하시겠습니까?\n반영된 기록 ${appliedCount}건은 연결된 일정산·콜수입력도 함께 제거됩니다.`
      : `${rangeLabel} ${platformLabel(p)} 업로드 기록 ${rows.length}건을 전체 삭제하시겠습니까?`;
    if (!window.confirm(confirmMessage)) return;

    void (async () => {
      try {
        await BremStorage.ensureSectionLoaded('settlements');
        await BremStorage.ensureSectionLoaded('calls');
        const result = await BremStorage.settlementUploadLogs.removeDailyByWeekAsync(weekStart, p);
        if (state.settlementUploadLogDetailId && rows.some(item => item.id === state.settlementUploadLogDetailId)) {
          hideSettlementUploadLogDetail();
        }
        invalidateCallStatsIndex();
        showToast(
          result.appliedCount > 0
            ? `업로드 기록 ${result.removed}건 삭제 · 반영 ${result.appliedCount}건 연동 정산·콜수 제거`
            : `업로드 기록 ${result.removed}건 삭제`
        );
        renderSettlements();
        renderCalls();
        renderDashboard();
      } catch (error) {
        console.error('[BREM] settlement upload log week clear failed:', error);
        showToast(error.message || '삭제 저장에 실패했습니다.');
        invalidateCallStatsIndex();
        renderSettlements();
        renderCalls();
        renderDashboard();
      }
    })();
  }

  function reapplySettlementUploadLogsForSelectedWeek(platform) {
    const p = normalizePlatform(platform);
    const weekStart = ensureSettlementLogWeek(p);
    if (!weekStart) {
      showToast('적용주를 먼저 선택하세요.');
      return;
    }
    const rows = BremStorage.settlementUploadLogs.getFiltered({
      kind: 'daily',
      platform: p,
      weekStart
    });
    const logs = rows.filter(canReapplySettlementUploadLog);
    if (!logs.length) {
      showToast('선택한 주에 재반영할 저장 데이터가 없습니다.');
      return;
    }

    const rangeLabel = `${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))}`;
    const riderTotal = logs.reduce(
      (sum, log) => sum + settlementUploadLogApplicableRecords(log).length,
      0
    );
    const confirmMessage = `${rangeLabel} ${platformLabel(p)} 업로드 기록 ${logs.length}건을 저장 데이터로 전체 재반영하시겠습니까?\n총 ${riderTotal}명 · 기존 콜수·일정산이 덮어씌워집니다.\n(엑셀 파일 없이 저장된 매칭 데이터만 사용합니다.)`;
    if (!window.confirm(confirmMessage)) return;

    const reapplyWeekBtn = $(`#settlementUploadLogReapplyWeek-${p}`);
    if (reapplyWeekBtn) {
      reapplyWeekBtn.disabled = true;
      reapplyWeekBtn.textContent = '재반영 중…';
    }

    void (async () => {
      try {
        await BremStorage.ensureSectionLoaded('settlements');
        await BremStorage.ensureSectionLoaded('calls');

        const sorted = [...logs].sort((a, b) => {
          const periodCmp = String(a.period).localeCompare(String(b.period));
          if (periodCmp !== 0) return periodCmp;
          return String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || ''));
        });

        let successCount = 0;
        let appliedRiders = 0;
        for (const log of sorted) {
          const applicable = settlementUploadLogApplicableRecords(log);
          const result = await applyDailySettlementFromLogData(p, {
            period: String(log.period || '').slice(0, 10),
            matched: applicable,
            unmatched: log.unmatchedRecords || [],
            sourceFileName: log.fileName || '',
            uploadLogId: log.id,
            forceReapply: true,
            totalDeliveryAmount: Number(log.totalDeliveryAmount || 0),
            skipRender: true,
            silent: true
          });
          if (result.ok) {
            successCount += 1;
            appliedRiders += applicable.length;
          }
        }

        await BremStorage.awaitPersist?.(BremStorage.flushStorage?.());
        await BremStorage.refetchDataKey?.(BremStorage.STORAGE_KEYS.calls);
        await BremStorage.refetchDataKey?.(BremStorage.STORAGE_KEYS.settlements);
        invalidateCallStatsIndex();
        setSettlementWeekFilters(p, weekStart);
        renderSettlements();
        renderCalls();
        renderDashboard();
        if (state.settlementUploadLogDetailId) {
          renderSettlementUploadLogDetail(state.settlementUploadLogDetailId);
        }
        showToast(
          successCount > 0
            ? `${platformLabel(p)} ${rangeLabel} 업로드 ${successCount}건 · ${appliedRiders}명 재반영 완료`
            : '재반영에 성공한 기록이 없습니다.'
        );
      } catch (error) {
        console.error('[BREM] settlement upload log week reapply failed:', error);
        showToast(error.message || '전체 재반영 저장에 실패했습니다.');
        invalidateCallStatsIndex();
        renderSettlements();
        renderCalls();
        renderDashboard();
      } finally {
        if (reapplyWeekBtn) {
          reapplyWeekBtn.textContent = '해당주 전체 재반영';
          reapplyWeekBtn.disabled = !rows.some(canReapplySettlementUploadLog);
        }
      }
    })();
  }

  function clearSettlementUnmatchedForSelectedWeek(platform) {
    const p = normalizePlatform(platform);
    const weekStart = getSettlementUnmatchedWeekFilter(p);
    if (!weekStart) {
      showToast('적용주를 먼저 선택하세요.');
      return;
    }
    const count = settlementUnmatchedList()
      .filter(record => normalizePlatform(record.platform) === p)
      .filter(record => record.kind !== 'weekly')
      .filter(record => record.weekStart === weekStart)
      .length;
    if (!count) {
      showToast('선택한 주 미반영 내역이 없습니다.');
      return;
    }
    if (!window.confirm(`${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))} ${platformLabel(p)} 미반영 ${count}건을 전체 삭제하시겠습니까?`)) return;

    BremStorage.settlementUnmatched.clearByWeek({ weekStart, platform: p, kind: 'daily' });
    void BremStorage.flushStorage?.().then(() => {
      showToast(`${formatDate(weekStart)} 주 미반영 ${count}건 삭제되었습니다.`);
      renderSettlements();
    }).catch(error => {
      console.error('[BREM] settlement unmatched clear failed:', error);
      showToast(error.message || '삭제 저장에 실패했습니다.');
      renderSettlements();
    });
  }

  function retryDailySettlementUnmatched(platform, options = {}) {
    const p = normalizePlatform(platform);
    const weekStart = getSettlementUnmatchedWeekFilter(p);
    const periodKey = getSettlementPeriodFilter(p);
    const recordIds = Array.isArray(options.recordIds) ? options.recordIds : [];
    if (!weekStart) {
      showToast('적용주를 먼저 선택하세요.');
      return;
    }
    const pendingCount = settlementUnmatchedList()
      .filter(record => normalizePlatform(record.platform) === p)
      .filter(record => record.kind !== 'weekly')
      .filter(record => record.weekStart === weekStart)
      .filter(record => matchesSettlementPeriod(record, periodKey))
      .filter(record => !recordIds.length || recordIds.includes(record.id))
      .length;
    if (!pendingCount) {
      showToast(recordIds.length ? '재시도할 미반영 기사가 없습니다.' : '선택한 주에 미반영 기사가 없습니다.');
      return;
    }

    void (async () => {
      try {
        await BremStorage.refreshDriversForSettlementMatch?.();
        await BremStorage.ensureSectionLoaded('settlements');
        await BremStorage.ensureSectionLoaded('calls');
        const result = BremStorage.settlementUnmatched.retryDailyMatching({
          platform: p,
          weekStart,
          period: periodKey,
          recordIds
        });
        await BremStorage.flushStorage?.();
        let message = `매칭 재시도: ${result.matchedCount}명 반영`;
        if (result.stillUnmatchedCount) {
          message += ` · 미매칭 ${result.stillUnmatchedCount}명 유지`;
        }
        if (!result.matchedCount) {
          message = '새로 등록한 기사와 매칭되지 않았습니다. 배민 ID·쿠팡 ID를 확인하세요.';
        } else if (periodKey) {
          setSettlementHistoryDay(p, periodKey);
        }
        showToast(message);
        renderSettlements();
      } catch (error) {
        console.error('[BREM] daily unmatched retry failed:', error);
        showToast(error.message || '매칭 재시도에 실패했습니다.');
      }
    })();
  }

  function clearSettlementPreview(platform) {
    const p = normalizePlatform(platform);
    state.settlementPreviewByPlatform[p] = null;
    renderSettlementPreview(p);
  }

  function applySettlementDateFromFilename(filename, platform) {
    const p = normalizePlatform(platform);
    const date = BremSettlementParser.parseSettlementDateFromFilename(filename);
    const periodInput = $(`#settlementPeriod-${p}`);
    const hint = $(`#settlementFileHint-${p}`);

    if (date && periodInput) {
      periodInput.value = date;
      if (hint) {
        hint.hidden = false;
        hint.textContent = `파일명에서 정산일 ${formatDate(date)} 자동 인식`;
      }
    } else if (hint) {
      hint.hidden = true;
      hint.textContent = '';
    }

    return date;
  }

  async function uploadSettlement(event, platform) {
    event.preventDefault();

    const p = normalizePlatform(platform);
    const fileInput = $(`#settlementFile-${p}`);
    const passwordInput = $(`#settlementPassword-${p}`);
    const periodInput = $(`#settlementPeriod-${p}`);
    const uploadBtn = $(`#settlementUploadBtn-${p}`);
    const file = fileInput?.files?.[0];

    if (!file) {
      showToast('정산표 파일을 선택해주세요.');
      return;
    }

    applySettlementDateFromFilename(file.name, p);

    uploadBtn.disabled = true;
    uploadBtn.textContent = '처리 중...';

    try {
      await BremStorage.ensureSectionLoaded?.('settlements');

      if (BremStorage.fetchAllDriversFromServer) {
        const driverLoad = await BremStorage.fetchAllDriversFromServer({ force: false });
        if (!driverLoad?.ok) {
          showToast(driverLoad?.message || '기사 목록을 불러오지 못했습니다.');
          return;
        }
      }

      const driverList = drivers();
      const supabaseTotal = BremStorage.drivers.getSupabaseTotal?.() || driverList.length;
      if (supabaseTotal > driverList.length) {
        showToast(`기사 ${driverList.length}/${supabaseTotal}명만 로드됨 — 매칭 누락 가능. 잠시 후 다시 시도하세요.`);
      }

      const result = await BremSettlementParser.parseSettlementFile({
        file,
        password: String(passwordInput?.value || '').trim(),
        period: periodInput?.value || BremSettlementParser.parseSettlementDateFromFilename(file.name) || '',
        formatId: BremPlatforms.settlementFormatId(p),
        drivers: driverList.map(driver => ({
          id: driver.id,
          name: driver.name,
          baeminId: driver.baeminId || ''
        }))
      });

      const period = result.period || periodInput?.value || '';
      if (!period) {
        showToast('정산일을 찾지 못했습니다. 파일명 끝에 YYYYMMDD 형식(예: _20260610)을 사용해주세요.');
        return;
      }

      if (periodInput) periodInput.value = period;
      setSettlementWeekFilters(p, period);
      setSettlementHistoryDay(p, period);

      state.settlementPreviewByPlatform[p] = {
        period,
        platform: p,
        sourceFileName: file.name,
        totalRows: result.totalRows,
        totalDeliveries: result.totalDeliveries || 0,
        totalRiders: result.totalRiders || result.totalRows,
        totalDeliveryAmount: result.totalDeliveryAmount || 0,
        matched: result.matched,
        unmatched: result.unmatched
      };

      const uploadLog = recordDailySettlementUploadLog(p, {
        fileName: file.name,
        period,
        status: 'uploaded',
        matchedCount: result.matched.length,
        unmatchedCount: result.unmatched.length,
        totalDeliveryAmount: result.totalDeliveryAmount || 0,
        matchedRecords: result.matched,
        unmatchedRecords: result.unmatched
      });
      state.settlementPreviewByPlatform[p].uploadLogId = uploadLog.id;
      await BremStorage.awaitPersist?.(BremStorage.flushStorage?.());

      if (result.unmatched.length) {
        saveSettlementUnmatched({
          period,
          records: result.unmatched,
          sourceFileName: file.name,
          platform: p
        });
      } else {
        BremStorage.settlementUnmatched.clearByPeriod(period, p);
      }

      renderSettlements();
      if (isBaeminSettlementPlatform(p)) {
        const skip = result.skippedBaeminRows;
        const excluded = skip
          ? Number(skip.emptyStoreArrival || 0)
            + Number(skip.emptyColumnV || 0)
            + Number(skip.invalidAmount || 0)
            + Number(skip.otherInvalid || 0)
          : 0;
        const fieldSkip = skip
          ? Number(skip.emptyStoreArrival || 0) + Number(skip.emptyColumnV || 0)
          : 0;
        const skipLabel = excluded > 0
          ? ` · 무효행 제외 ${excluded}건${fieldSkip > 0 ? `(U·V 빈칸 등 ${fieldSkip}건)` : ''}`
          : '';
        showToast(`${platformLabel(p)} 미리보기 · 유효 배달 ${result.totalDeliveries || 0}건 · 라이더 ${result.totalRiders || result.totalRows}명 · 매칭 ${result.matched.length}명${skipLabel}`);
      } else {
        showToast(`${platformLabel(p)} 미리보기 준비 · 매칭 ${result.matched.length}명 / 실패 ${result.unmatched.length}명`);
      }
    } catch (error) {
      showToast(error.message || '정산표를 처리하지 못했습니다.');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = '업로드 및 미리보기';
    }
  }

  function settlementUploadLogApplicableRecords(log) {
    const source = (log?.matchedRecords?.length ? log.matchedRecords : log?.appliedRecords) || [];
    return source.filter(record => String(record.driverId || '').trim());
  }

  function canReapplySettlementUploadLog(log) {
    if (!log || log.kind !== 'daily') return false;
    return settlementUploadLogApplicableRecords(log).length > 0;
  }

  async function applyDailySettlementFromLogData(platform, options = {}) {
    const p = normalizePlatform(platform);
    const period = String(options.period || '').slice(0, 10);
    const matched = Array.isArray(options.matched) ? options.matched : [];
    const unmatched = Array.isArray(options.unmatched) ? options.unmatched : [];
    const sourceFileName = options.sourceFileName || '';
    const uploadLogId = options.uploadLogId || '';
    const forceReapply = options.forceReapply === true;
    const clearPreview = options.clearPreview === true;
    const skipRender = options.skipRender === true;
    const silent = options.silent === true;
    const totalDeliveryAmount = Number(
      options.totalDeliveryAmount
      ?? matched.reduce((sum, row) => sum + settlementAmountValue(row), 0)
    );

    if (!matched.length) {
      if (!silent) showToast('반영할 매칭 데이터가 없습니다.');
      return { ok: false };
    }
    if (!period) {
      if (!silent) showToast('정산일이 없어 반영할 수 없습니다.');
      return { ok: false };
    }

    const appliedRecords = serializeSettlementLogRecords(matched);
    const contentHash = BremStorage.settlementUploadLogs.buildContentHash(p, period, appliedRecords);

    if (!forceReapply) {
      const duplicateCheck = BremStorage.settlementUploadLogs.isDuplicateApply({
        platform: p,
        period,
        contentHash,
        records: appliedRecords,
        excludeLogId: uploadLogId
      });

      if (duplicateCheck.duplicate) {
        const duplicatePatch = {
          status: 'duplicate_skipped',
          contentHash,
          matchedRecords: appliedRecords,
          appliedRecords,
          unmatchedRecords: serializeSettlementLogRecords(unmatched),
          unmatchedCount: unmatched.length,
          totalDeliveryAmount,
          totalOrderCount: appliedRecords.reduce((sum, row) => sum + Number(row.orderCount || 0), 0),
          matchedCount: appliedRecords.length,
          fileName: sourceFileName,
          appliedAt: new Date().toISOString(),
          duplicateOfLogId: duplicateCheck.existingLog?.id || '',
          skipReason: '동일 파일이 이미 반영된 업로드 기록이 있습니다.'
        };

        if (uploadLogId) {
          BremStorage.settlementUploadLogs.update(uploadLogId, duplicatePatch);
        } else {
          recordDailySettlementUploadLog(p, {
            fileName: sourceFileName,
            period,
            ...duplicatePatch
          });
        }

        try {
          await BremStorage.awaitPersist?.(BremStorage.flushStorage?.());
          setSettlementWeekFilters(p, period);
          if (clearPreview) clearSettlementPreview(p);
          renderSettlements();
          renderSettlementUploadLogs(p);
          renderCalls();
          showToast('동일한 파일이 이미 반영되어 있어 중복 적용을 건너뛰었습니다.');
        } catch (error) {
          console.error('[BREM] settlement duplicate skip save failed:', error);
          showToast(error.message || '중복 기록 저장에 실패했습니다.');
        }
        return { ok: false, duplicate: true };
      }
    }

    try {
      await BremStorage.ensureSectionLoaded?.('settlements');

      await window.BremPerf?.runSave?.(`settlements.apply.${p}`, {
        write: async () => {
          const writeResult = BremStorage.settlements.upsertBatch({
            period,
            platform: p,
            records: matched.map(record => ({
              driverId: record.driverId,
              riderId: record.riderId || '',
              orderCount: record.orderCount,
              deliveryAmount: settlementAmountValue(record),
              settlementAmount: settlementAmountValue(record)
            }))
          });
          await BremStorage.awaitPersist?.(writeResult);

          const applyPatch = {
            status: 'applied',
            appliedAt: new Date().toISOString(),
            matchedCount: matched.length,
            unmatchedCount: unmatched.length,
            fileName: sourceFileName,
            contentHash,
            matchedRecords: appliedRecords,
            appliedRecords,
            unmatchedRecords: serializeSettlementLogRecords(unmatched),
            totalDeliveryAmount,
            totalOrderCount: appliedRecords.reduce((sum, row) => sum + Number(row.orderCount || 0), 0),
            duplicateOfLogId: '',
            skipReason: ''
          };

          if (uploadLogId) {
            BremStorage.settlementUploadLogs.update(uploadLogId, applyPatch);
          } else {
            recordDailySettlementUploadLog(p, {
              fileName: sourceFileName,
              period,
              ...applyPatch
            });
          }

          if (unmatched.length) {
            saveSettlementUnmatched({
              period,
              records: unmatched,
              sourceFileName,
              platform: p
            });
          } else {
            BremStorage.settlementUnmatched.clearByPeriod(period, p);
          }

          await BremStorage.awaitPersist?.(BremStorage.flushStorage?.());
          await BremStorage.refetchDataKey?.(BremStorage.STORAGE_KEYS.calls);
          await BremStorage.refetchDataKey?.(BremStorage.STORAGE_KEYS.settlements);
        },
        render: () => {
          if (skipRender) return;
          setSettlementWeekFilters(p, period);
          setSettlementHistoryDay(p, period);
          if (clearPreview) clearSettlementPreview(p);
          renderSettlements();
          renderSettlementUploadLogs(p);
          renderCalls();
          if (state.currentSection === 'dashboard') renderDashboard();
          if (uploadLogId && state.settlementUploadLogDetailId === uploadLogId) {
            renderSettlementUploadLogDetail(uploadLogId);
          }
        }
      });

      return { ok: true, count: matched.length };
    } catch (error) {
      console.error('[BREM] settlement apply failed:', error);
      showToast(error.message || '일정산 반영 저장에 실패했습니다. 다시 시도하세요.');
      return { ok: false, error };
    }
  }

  async function reapplySettlementUploadLog(logId) {
    const log = BremStorage.settlementUploadLogs.getById(logId);
    if (!log || log.kind !== 'daily') {
      showToast('업로드 기록을 찾지 못했습니다.');
      return;
    }

    const applicable = settlementUploadLogApplicableRecords(log);
    if (!applicable.length) {
      showToast('저장된 매칭 데이터가 없어 재반영할 수 없습니다.');
      return;
    }

    const p = normalizePlatform(log.platform);
    const period = String(log.period || '').slice(0, 10);
    const rangeLabel = formatDate(period);
    const confirmMessage = log.status === 'applied'
      ? `${rangeLabel} ${platformLabel(p)} 저장 데이터 ${applicable.length}명을 다시 반영하시겠습니까?\n기존 콜수·일정산이 덮어씌워집니다.\n(엑셀 파일 없이 저장된 매칭 데이터만 사용합니다.)`
      : `${rangeLabel} ${platformLabel(p)} 저장 데이터 ${applicable.length}명을 반영하시겠습니까?\n(엑셀 파일 없이 저장된 매칭 데이터만 사용합니다.)`;
    if (!window.confirm(confirmMessage)) return;

    try {
      await BremStorage.ensureSectionLoaded?.('settlements');
      await BremStorage.ensureSectionLoaded?.('calls');
      const result = await applyDailySettlementFromLogData(p, {
        period,
        matched: applicable,
        unmatched: log.unmatchedRecords || [],
        sourceFileName: log.fileName || '',
        uploadLogId: log.id,
        forceReapply: true,
        totalDeliveryAmount: Number(log.totalDeliveryAmount || 0)
      });
      if (result.ok) {
        invalidateCallStatsIndex();
        showToast(`${platformLabel(p)} 일정산 ${result.count}건을 저장 데이터로 재반영했습니다.`);
      }
    } catch (error) {
      console.error('[BREM] settlement reapply failed:', error);
      showToast(error.message || '재반영 저장에 실패했습니다.');
    }
  }

  async function applySettlementPreview(platform) {
    const p = normalizePlatform(platform);
    const preview = state.settlementPreviewByPlatform[p];
    if (!preview?.matched?.length) {
      showToast('반영할 매칭 데이터가 없습니다.');
      return;
    }

    if (!preview.period) {
      showToast('정산일이 없어 반영할 수 없습니다.');
      return;
    }

    const applyBtn = $(`#settlementApplyBtn-${p}`);
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = '반영 중…';
    }

    try {
      const result = await applyDailySettlementFromLogData(p, {
        period: preview.period,
        matched: preview.matched,
        unmatched: preview.unmatched || [],
        sourceFileName: preview.sourceFileName || '',
        uploadLogId: preview.uploadLogId || '',
        forceReapply: false,
        clearPreview: true,
        totalDeliveryAmount: Number(preview.totalDeliveryAmount || 0)
      });
      if (result.ok) {
        showToast(`${platformLabel(p)} 일정산 ${preview.matched.length}건이 Supabase에 반영되었습니다.`);
      }
    } finally {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = '반영하기';
      }
    }
  }

  function invalidateSectionRenders(sectionId) {
    if (sectionId) {
      sectionRenderFingerprints.delete(sectionId);
      return;
    }
    sectionRenderFingerprints.clear();
  }

  function getSectionRenderFingerprint(sectionId) {
    const driverQuery = state.driverSearchQuery.trim();
    const dashQuery = state.dashboardSearchQuery.trim();
    switch (sectionId) {
      case 'dashboard':
        return [
          'dashboard',
          dashboardMonth(),
          dashboardWeekStart(),
          dashQuery,
          drivers().length,
          calls().length,
          rejections().length,
          state.dashboardSort.key,
          state.dashboardSort.dir
        ].join('\0');
      case 'calls':
        return [
          'calls',
          driverQuery,
          calls().length,
          state.unifiedPlatform.calls,
          ...PLATFORMS.map(platform => callFilterDate(platform)),
          ...PLATFORMS.map(platform => callRecordsSearch(platform)),
          BremStorage.callEditLogs?.getAll?.().length || 0
        ].join('\0');
      case 'rejections':
        return [
          'rejections',
          driverQuery,
          rejections().length,
          state.unifiedPlatform.rejections,
          state.rejectionWeekByPlatform.coupang,
          state.rejectionWeekByPlatform.baemin
        ].join('\0');
      case 'targets':
        return [
          'targets',
          driverQuery,
          targets().length,
          weeklyTargets().length,
          $('#targetMonth')?.value || ''
        ].join('\0');
      case 'notices':
        return ['notices', notices().length, state.editingNoticeId].join('\0');
      case 'mission-results':
        return [
          'mission-results',
          drivers().length,
          state.missionResultsSearchQuery.trim(),
          state.missionResultsSort.key,
          state.missionResultsSort.dir
        ].join('\0');
      case 'missions':
        return [
          'missions',
          drivers().length,
          state.eventSettingsSearchQuery.trim(),
          state.eventSettingsSort.key,
          state.eventSettingsSort.dir
        ].join('\0');
      case 'promotion-apply':
        return [
          'promotion-apply',
          BremStorage.weeklySettlements?.getAll?.().length || 0,
          BremStorage.promotionApplyResults?.getAll?.().length || 0,
          BremStorage.promotionRules?.getAll?.().length || 0,
          BremStorage.drivers?.getAll?.().length || 0
        ].join('\0');
      default:
        return '';
    }
  }

  function renderActiveSection(sectionId = state.currentSection, options = {}) {
    window.BremPerf?.time?.(`admin.renderSection:${sectionId}`);

    const force = options.force === true;
    if (!force) {
      const fingerprint = getSectionRenderFingerprint(sectionId);
      if (fingerprint && sectionRenderFingerprints.get(sectionId) === fingerprint) {
        updateDriverSearchStatus();
        applySectionEditPermissions();
        window.BremPerf?.timeEnd?.(`admin.renderSection:${sectionId}:skipped`);
        return;
      }
      if (fingerprint) {
        sectionRenderFingerprints.set(sectionId, fingerprint);
      }
    } else {
      sectionRenderFingerprints.delete(sectionId);
    }

    switch (sectionId) {
      case 'dashboard':
        renderDashboard();
        break;
      case 'mission-results':
        renderMissionResults();
        break;
      case 'calls':
        renderCalls();
        break;
      case 'baemin-delivery-status':
        window.BremBaeminDeliveryStatusAdmin?.refresh?.();
        break;
      case 'rejections':
        renderRejections();
        break;
      case 'targets':
        renderTargets();
        break;
      case 'missions':
        renderMissions();
        break;
      case 'mission-management':
        window.BremAdminMissions?.render?.();
        break;
      case 'settlements':
        renderSettlements();
        break;
      case 'promotions':
        renderPromotions();
        break;
      case 'weekly-settlement':
        if (typeof BremWeeklySettlementAdmin !== 'undefined') BremWeeklySettlementAdmin.refresh();
        break;
      case 'promotion-apply':
        if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh();
        break;
      case 'notices':
        renderNotices();
        window.BremAdminPayrollNotices?.refresh?.();
        break;
      case 'rider-inquiries':
        renderRiderInquiries();
        break;
      case 'admin-account':
        renderAdminAccountSection();
        break;
      default:
        break;
    }

    updateDriverSearchStatus();
    applySectionEditPermissions();
    window.BremPerf?.timeEnd?.(`admin.renderSection:${sectionId}`);
  }

  function renderAll() {
    window.BremPerf?.time?.('admin.renderAll');
    invalidateCallStatsIndex();
    invalidateSectionRenders(state.currentSection);
    renderActiveSection(state.currentSection, { force: true });
    renderRiderPublishStatus();
    window.BremPerf?.timeEnd?.('admin.renderAll');
  }

  function handleDriverSearchChange() {
    updateDriverSearchStatus();
    invalidateDriverSelectCache();
    if (!state.driverSearchQuery.trim()) {
      resetDriverFormSelects();
    }
    if (DRIVER_SEARCH_SECTIONS.has(state.currentSection)) {
      refreshSelectsForSection(state.currentSection);
    }
    if (DRIVER_FILTERED_SECTIONS.has(state.currentSection)) {
      invalidateSectionRenders(state.currentSection);
      renderActiveSection(state.currentSection, { force: true });
    }
  }

  function handleDashboardSearchChange() {
    if (state.currentSection === 'dashboard') {
      invalidateSectionRenders('dashboard');
      renderActiveSection('dashboard', { force: true });
    }
  }

  const debouncedDriverSearchChange = window.BremPerf?.debounce
    ? window.BremPerf.debounce(handleDriverSearchChange, 180)
    : handleDriverSearchChange;

  const debouncedDashboardSearchChange = window.BremPerf?.debounce
    ? window.BremPerf.debounce(handleDashboardSearchChange, 180)
    : handleDashboardSearchChange;

  function resolveSectionNavigation(id) {
    const legacy = LEGACY_SECTION_MAP[id];
    if (legacy) {
      return { sectionId: legacy.section, platform: legacy.platform };
    }
    if (UNIFIED_SECTIONS[id]) {
      return {
        sectionId: id,
        platform: state.unifiedPlatform[id] || UNIFIED_SECTIONS[id].defaultPlatform
      };
    }
    return { sectionId: id, platform: null };
  }

  function setUnifiedPlatform(sectionId, platform) {
    const config = UNIFIED_SECTIONS[sectionId];
    if (!config) return;
    const normalized = normalizePlatform(platform);
    state.unifiedPlatform[sectionId] = normalized;
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.querySelectorAll('.admin-platform-panel[data-platform]').forEach(panel => {
      panel.hidden = panel.dataset.platform !== normalized;
    });
    section.querySelectorAll(`[data-admin-platform-tab="${sectionId}"]`).forEach(button => {
      button.classList.toggle('active', button.dataset.platform === normalized);
    });
  }

  function runSectionModuleRefresh(sectionId) {
    if (sectionId === 'data-backup' && window.BremDataBackupAdmin?.refresh) {
      window.BremDataBackupAdmin.refresh();
    }
    if (sectionId === 'admin-schedule' && window.BremAdminSchedule?.refresh) {
      window.BremAdminSchedule.refresh();
    }
    if (sectionId === 'lease-management' && window.BremAdminLeaseMenus?.init) {
      void window.BremAdminLeaseMenus.init();
    }
    if (sectionId === 'lease-management' && window.BremAdminLease?.refresh) {
      const filter = window.__leaseFilterOnOpen;
      window.__leaseFilterOnOpen = null;
      void window.BremAdminLease.refresh(filter ? { filter } : {});
    }
    if (sectionId === 'revenue-management' && window.BremAdminRevenue?.refresh) {
      window.BremAdminRevenue.refresh();
    }
    if (sectionId === 'payroll-slips' && window.BremAdminPayrollSlips?.refresh) {
      void window.BremAdminPayrollSlips.refresh();
    }
    if (sectionId === 'payroll-daily-settlement' && window.BremAdminPayrollDailySettlement?.refresh) {
      window.BremAdminPayrollDailySettlement.refresh();
    }
    if (sectionId === 'mission-management' && window.BremAdminMissions?.refresh) {
      void window.BremAdminMissions.refresh({ renderOnly: true });
    }
    if (sectionId === 'baemin-delivery-status' && window.BremBaeminDeliveryStatusAdmin?.refresh) {
      void window.BremBaeminDeliveryStatusAdmin.refresh();
    }
  }

  function finishSectionNavigation(sectionId) {
    runSectionModuleRefresh(sectionId);
    if (DRIVER_SEARCH_SECTIONS.has(sectionId)) {
      refreshSelectsForSection(sectionId);
    }
    renderActiveSection(sectionId);
  }

  function scheduleSectionNavigationFinish(sectionId) {
    if (pendingSectionNavRaf) {
      cancelAnimationFrame(pendingSectionNavRaf);
    }
    pendingSectionNavRaf = requestAnimationFrame(() => {
      pendingSectionNavRaf = 0;
      finishSectionNavigation(sectionId);
    });
  }

  async function showSection(id, options = {}) {
    const nav = resolveSectionNavigation(id);
    const sectionId = nav.sectionId;

    if (!canAccessAdminSection(sectionId)) {
      showToast('접근 권한이 없는 메뉴입니다.');
      return;
    }

    state.currentSection = sectionId;
    updateDriverSearchBarVisibility(sectionId);
    $$('.section').forEach(section => section.classList.toggle('active', section.id === sectionId));
    $$('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.section === sectionId));
    const titleEl = $('#pageTitle');
    if (UNIFIED_SECTIONS[sectionId]) {
      titleEl.textContent = UNIFIED_SECTIONS[sectionId].title;
      setUnifiedPlatform(sectionId, nav.platform);
    } else {
      const navBtn = $(`.nav-btn[data-section="${sectionId}"]`);
      titleEl.textContent = navBtn ? navBtn.textContent : sectionId;
    }
    $('#sidebar').classList.remove('open');
    $('#overlay').classList.remove('active');
    if (sectionId !== 'weekly-settlement' && sectionId !== 'promotion-apply') {
      const detailCard = $('#weeklySettlementDetailCard');
      if (detailCard) detailCard.hidden = true;
    }
    if (options.skipRender) {
      return;
    }

    const cacheReady = BremStorage.isSectionCacheReady?.(sectionId);
    if (cacheReady) {
      scheduleSectionNavigationFinish(sectionId);
      return;
    }

    showSectionLoadingSkeleton(sectionId);
    showAdminDataLoading(true);

    try {
      const result = await (BremStorage.ensureSectionLoaded?.(sectionId) || Promise.resolve({ ok: true }));
      if (result?.ok === false && !BremStorage.drivers?.getAll?.().length && sectionId !== 'admin-account') {
        showToast(result.message || '데이터를 불러오지 못했습니다.');
      } else if (result?.ok === false && result?.stale) {
        console.warn('[BREM] Section load used stale cache:', sectionId, result.message);
      }
    } catch (error) {
      console.error('[BREM] Section load failed:', error);
      if (!BremStorage.drivers?.getAll?.().length) {
        showToast(error.message || '데이터를 불러오지 못했습니다.');
      }
    } finally {
      showAdminDataLoading(false);
    }

    finishSectionNavigation(sectionId);
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    bindAdminAccountForm();

    document.addEventListener('brem-admin-data-ready', () => {
      if (state.currentSection === 'rider-inquiries') {
        renderRiderInquiries();
      }
    });

    document.addEventListener('brem-cache-status-changed', () => {
      invalidateCallStatsIndex();
      invalidateDriverSelectCache();
      invalidateSectionRenders();
    });

    document.addEventListener('brem-heavy-data-ready', () => {
      invalidateCallStatsIndex();
      invalidateSectionRenders();
      renderActiveSection(state.currentSection, { force: true });
      renderRiderPublishStatus();
    });

    $$('.nav-btn').forEach(button => {
      button.addEventListener('click', () => {
        void showSection(button.dataset.section);
      });
    });

    document.addEventListener('click', event => {
      const platformTab = event.target.closest('[data-admin-platform-tab]');
      if (platformTab) {
        const sectionId = platformTab.dataset.adminPlatformTab;
        const platform = platformTab.dataset.platform;
        if (state.currentSection === sectionId) {
          setUnifiedPlatform(sectionId, platform);
          renderAll();
        }
        return;
      }

      const sectionLink = event.target.closest('[data-section-link]');
      if (sectionLink) {
        event.preventDefault();
        showSection(sectionLink.dataset.sectionLink);
      }
    });

    setupEventStartDatePicker();
    setupTargetMonthPicker();
    setupAdminWeekPicker();
    setupCallDatePicker();
    enhanceAdminPeriodDateInputs();
    initTableSorting();

    document.addEventListener('brem-admin-toast', event => {
      showToast(event.detail?.message || '');
    });

    document.addEventListener('brem-rejection-bulk-applied', () => {
      renderAll();
    });

    document.addEventListener('brem-rejection-erp-applied', () => {
      renderAll();
    });

    document.addEventListener('click', event => {
      if (event.target.closest('[data-rider-app-publish]')) {
        handleRiderAppPublish();
      }
    });

    initCallDateFields();

    $('#adminDriverSearch').addEventListener('input', event => {
      state.driverSearchQuery = event.target.value;
      debouncedDriverSearchChange();
    });

    $('#adminDriverSearchClear').addEventListener('click', () => {
      state.driverSearchQuery = '';
      $('#adminDriverSearch').value = '';
      resetDriverFormSelects();
      handleDriverSearchChange();
    });

    $('#dashboardDriverSearch')?.addEventListener('input', event => {
      state.dashboardSearchQuery = event.target.value;
      debouncedDashboardSearchChange();
    });

    $('#eventSettingsSearch')?.addEventListener('input', event => {
      state.eventSettingsSearchQuery = event.target.value;
      debouncedEventSettingsSearchChange();
    });

    $('#eventSettingsSearchClear')?.addEventListener('click', () => {
      state.eventSettingsSearchQuery = '';
      if ($('#eventSettingsSearch')) $('#eventSettingsSearch').value = '';
      handleEventSettingsSearchChange();
    });

    $('#dashboardEmptyLeaseBtn')?.addEventListener('click', () => {
      window.__leaseFilterOnOpen = 'empty';
      showSection('lease-management');
    });

    $('#missionResultItemFilter')?.addEventListener('change', renderMissionResults);
    $('#missionResultStatusFilter')?.addEventListener('change', renderMissionResults);

    const debouncedMissionResultsSearchChange = window.BremPerf?.debounce
      ? window.BremPerf.debounce(() => renderMissionResults(), 120)
      : () => renderMissionResults();

    $('#missionResultsSearch')?.addEventListener('input', event => {
      state.missionResultsSearchQuery = event.target.value;
      debouncedMissionResultsSearchChange();
    });

    $('#missionResultsSearchClear')?.addEventListener('click', () => {
      state.missionResultsSearchQuery = '';
      if ($('#missionResultsSearch')) $('#missionResultsSearch').value = '';
      renderMissionResults();
    });

    $('#adminLogoutBtn').addEventListener('click', () => {
      logoutAdmin({ reload: true });
    });

    $('#menuBtn').addEventListener('click', () => {
      $('#sidebar').classList.add('open');
      $('#overlay').classList.add('active');
    });

    $('#overlay').addEventListener('click', () => {
      $('#sidebar').classList.remove('open');
      $('#overlay').classList.remove('active');
    });

    PLATFORMS.forEach(platform => {
      $(`#callFilterDate-${platform}`)?.addEventListener('change', () => {
        selectedCallIds.clear();
        renderCalls();
      });

      document.querySelectorAll(`[data-call-filter-shift][data-platform="${platform}"]`).forEach(button => {
        button.addEventListener('click', () => {
          shiftCallFilterDate(platform, Number(button.dataset.callFilterShift || 0));
        });
      });

      document.querySelectorAll(`[data-call-filter-today][data-platform="${platform}"]`).forEach(button => {
        button.addEventListener('click', () => {
          setCallFilterDate(platform, today());
        });
      });

      $(`#callRecordsSearch-${platform}`)?.addEventListener('input', event => {
        state.callRecordsSearchByPlatform[platform] = event.target.value || '';
        renderCalls();
      });

      $(`#callForm-${platform}`)?.addEventListener('submit', event => {
        event.preventDefault();
        const driverId = $(`#callDriver-${platform}`).value;
        const date = $(`#callDate-${platform}`).value;
        if (!date) {
          showToast('날짜를 선택하세요.');
          return;
        }

        void BremPerf.runSave(`calls.save.${platform}`, {
          write: async () => {
            const writeResult = BremStorage.calls.upsertDaily({
              driverId,
              date,
              count: Number($(`#callCount-${platform}`).value),
              platform
            });
            await BremStorage.awaitPersist?.(writeResult);
            $(`#callCount-${platform}`).value = '';
            setCallFilterDate(platform, date);
          },
          render: () => {
            renderSettlements();
            renderCalls();
          }
        }).then(() => {
          showToast(`${platformLabel(platform)} 콜수가 저장되었습니다. 수정 기록이 남습니다.`);
        }).catch(error => {
          console.error('[BREM] call persist failed:', error);
          showToast(error.message || '콜수 Supabase 저장에 실패했습니다.');
          renderSettlements();
          renderCalls();
        });
      });

      $(`#rejectionForm-${platform}`)?.addEventListener('submit', event => {
        event.preventDefault();
        const driverId = $(`#rejectionDriver-${platform}`).value;
        const weekStart = weekStartKey($(`#rejectionWeekDate-${platform}`).value);
        const rate = Number($(`#rejectionRate-${platform}`).value);
        if (!driverId) {
          showToast('기사를 선택하세요.');
          return;
        }
        if (rate < 0 || rate > 100) {
          showToast(`${platformRateLabel(platform)}은 0~100 사이로 입력하세요.`);
          return;
        }

        void BremPerf.runSave(`rejections.save.${platform}`, {
          write: async () => {
            const writeResult = BremStorage.rejections.upsertWeekly({ driverId, weekStart, rate, platform });
            await BremStorage.awaitPersist?.(writeResult);
          },
          render: () => {
            renderRejections();
            if (state.currentSection === 'dashboard') renderDashboard();
          }
        }).then(() => {
          showToast(`${platformLabel(platform)} 주간 ${platformRateLabel(platform)} Supabase 저장 완료`);
        }).catch(error => {
          console.error('[BREM] rejection persist failed:', error);
          showToast(error.message || 'Supabase 저장에 실패했습니다.');
        });
      });

      $(`#rejectionWeekDate-${platform}`)?.addEventListener('change', event => {
        const pickedDate = event.target.value;
        const weekStart = weekStartKey(pickedDate);
        if (pickedDate && !isWednesday(pickedDate)) {
          showToast('적용주는 수요일만 선택됩니다. 해당 주 수요일로 변경했습니다.');
        }
        updateRejectionWeekPreview(weekStart, platform);
        fillRejectionRateInput(platform);
      });

      $(`#rejectionDriver-${platform}`)?.addEventListener('change', () => {
        fillRejectionRateInput(platform);
      });

      $(`#rejectionPrevWeekBtn-${platform}`)?.addEventListener('click', () => shiftRejectionWeek(-7, platform));
      $(`#rejectionNextWeekBtn-${platform}`)?.addEventListener('click', () => shiftRejectionWeek(7, platform));
    });

    $('#targetForm').addEventListener('submit', event => {
      event.preventDefault();
      const driverId = $('#targetDriver').value;
      const month = $('#targetMonth').value;
      if (!month) {
        showToast('적용 월을 선택하세요.');
        return;
      }
      void BremPerf.runSave('targets.monthly', {
        write: async () => {
          const writeResult = BremStorage.targets.upsertMonthly({
            driverId,
            month,
            count: Number($('#targetCount').value)
          });
          await BremStorage.awaitPersist?.(writeResult);
          $('#targetCount').value = '';
        },
        render: () => {
          renderTargets();
          if (state.currentSection === 'dashboard') renderDashboard();
        }
      }).then(() => {
        showToast('월간 목표 콜수가 저장되었습니다.');
      });
    });

    $('#weeklyTargetForm').addEventListener('submit', event => {
      event.preventDefault();
      const driverId = $('#weeklyTargetDriver').value;
      const weekStart = weekStartKey($('#weeklyTargetWeekDate').value);
      if (!$('#weeklyTargetWeekDate').value) {
        showToast('적용주 수요일을 선택하세요.');
        return;
      }
      void BremPerf.runSave('targets.weekly', {
        write: async () => {
          const writeResult = BremStorage.weeklyTargets.upsert({
            driverId,
            weekStart,
            count: Number($('#weeklyTargetCount').value)
          });
          await BremStorage.awaitPersist?.(writeResult);
          $('#weeklyTargetCount').value = '';
          updateAdminWeekTargetPreview(weekStart);
        },
        render: () => {
          renderTargets();
          if (state.currentSection === 'dashboard') renderDashboard();
        }
      }).then(() => {
        showToast('주간 목표 콜수가 저장되었습니다.');
      });
    });

    $('#settlementUploadLogDetailClose')?.addEventListener('click', hideSettlementUploadLogDetail);
    $('#settlementUploadLogDetailReapply')?.addEventListener('click', event => {
      const logId = event.currentTarget?.dataset?.reapplySettlementUploadLog || state.settlementUploadLogDetailId;
      if (!logId) return;
      void reapplySettlementUploadLog(logId);
    });

    PLATFORMS.forEach(platform => {
      const p = normalizePlatform(platform);
      const formatLabel = $(`#settlementFormatLabel-${p}`);
      if (formatLabel) formatLabel.textContent = platformLabel(p);

      $(`#settlementUploadForm-${p}`)?.addEventListener('submit', event => uploadSettlement(event, p));
      $(`#settlementApplyBtn-${p}`)?.addEventListener('click', () => applySettlementPreview(p));
      $(`#settlementCancelBtn-${p}`)?.addEventListener('click', () => {
        clearSettlementPreview(p);
        showToast(`${platformLabel(p)} 미리보기를 취소했습니다. 미반영 내역은 아래 목록에 유지됩니다.`);
      });
      $(`#settlementUnmatchedClearBtn-${p}`)?.addEventListener('click', () => {
        clearSettlementUnmatchedForSelectedWeek(p);
      });
      $(`#settlementUnmatchedRetryBtn-${p}`)?.addEventListener('click', () => {
        retryDailySettlementUnmatched(p);
      });
      $(`#settlementUnmatchedWeek-${p}`)?.addEventListener('change', event => {
        const picked = setSettlementWeekFilters(p, event.target.value);
        event.target.value = picked;
        renderSettlementUploadLogs(p);
        renderSettlementUnmatched(p);
      });
      $(`#settlementHistoryClearBtn-${p}`)?.addEventListener('click', () => {
        clearSettlementHistoryForSelectedPeriod(p);
      });
      $(`#settlementHistoryDay-${p}`)?.addEventListener('change', event => {
        const dayKey = String(event.target.value || '').slice(0, 10);
        if (!dayKey) {
          showToast('정산일을 선택하세요.');
          ensureSettlementHistoryDay(p);
          return;
        }
        setSettlementHistoryDay(p, dayKey);
        renderSettlements();
      });
      $(`#settlementPeriod-${p}`)?.addEventListener('change', () => {
        handleSettlementPeriodChange(p);
      });
      $(`#settlementLogWeek-${p}`)?.addEventListener('change', event => {
        const picked = setSettlementWeekFilters(p, event.target.value);
        event.target.value = picked;
        renderSettlementUploadLogs(p);
        renderSettlementUnmatched(p);
      });
      $(`#settlementUploadLogReapplyWeek-${p}`)?.addEventListener('click', () => {
        reapplySettlementUploadLogsForSelectedWeek(p);
      });
      $(`#settlementUploadLogClearWeek-${p}`)?.addEventListener('click', () => {
        clearSettlementUploadLogsForSelectedWeek(p);
      });
      $(`#settlementHistorySearch-${p}`)?.addEventListener('input', event => {
        state.settlementHistorySearchByPlatform[p] = event.target.value || '';
        renderSettlements();
      });
      $(`#settlementFile-${p}`)?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const date = applySettlementDateFromFilename(file.name, p);
        if (date) {
          showToast(`${platformLabel(p)} 정산일 ${formatDate(date)} 자동 설정`);
          handleSettlementPeriodChange(p);
        }
      });
    });

    $('#missionForm').addEventListener('submit', event => {
      event.preventDefault();
      const name = $('#eventTargetItem').value.trim();
      const targetCount = Number($('#eventTargetCount').value);
      if (!name || !targetCount) {
        showToast('아이템 이름과 목표 갯수를 입력하세요.');
        return;
      }

      BremStorage.events.upsertCatalogItem({ name, targetCount });
      $('#eventTargetItem').value = '';
      $('#eventTargetCount').value = '500';
      showToast('장기근속이벤트 아이템이 등록되었습니다.');
      renderAll();
    });

    document.addEventListener('change', event => {
      const input = event.target.closest('[data-event-driver]');
      if (!input) return;
      const driverId = input.dataset.eventDriver;
      const selectedItem = eventCatalog().find(item => item.id === input.value);
      const isClear = !input.value;
      const current = eventSettingsDrafts.get(driverId) || getSavedEventSettings(
        drivers().find(item => item.id === driverId) || {}
      );
      eventSettingsDrafts.set(driverId, {
        ...current,
        itemId: selectedItem ? selectedItem.id : '',
        itemName: selectedItem ? selectedItem.name : '',
        startDate: isClear ? '' : current.startDate
      });
      if (isClear) {
        const startInput = document.querySelector(`[data-event-start="${driverId}"]`);
        const startButton = document.querySelector(`[data-event-start-button="${driverId}"]`);
        if (startInput) startInput.value = '';
        if (startButton) startButton.textContent = eventStartButtonLabel('');
      }
      syncEventDirtyState(driverId);
      updateEventDriverRowUi(driverId);
    });

    document.addEventListener('change', event => {
      const input = event.target.closest('[data-event-platform]');
      if (!input) return;
      const driverId = input.dataset.eventPlatform;
      const current = eventSettingsDrafts.get(driverId) || getSavedEventSettings(
        drivers().find(item => item.id === driverId) || {}
      );
      eventSettingsDrafts.set(driverId, {
        ...current,
        platform: input.value
      });
      syncEventDirtyState(driverId);
      updateEventDriverRowUi(driverId);
    });

    $('#eventSettings')?.addEventListener('click', event => {
      const saveBtn = event.target.closest('[data-save-event-settings]');
      if (!saveBtn) return;

      const driverId = saveBtn.dataset.saveEventSettings;
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중…';

      void BremPerf.runSave('events.driverSettings', {
        write: () => saveDriverEventSettings(driverId),
        render: () => {
          renderMissions();
          if (state.currentSection === 'dashboard') renderDashboard();
        }
      })
        .then(() => {
          showToast('장기근속이벤트 설정이 저장되었습니다. 기사앱에 반영됩니다.');
        })
        .catch(error => {
          showToast(error.message || '장기근속이벤트 저장에 실패했습니다.');
          renderMissions();
        })
        .finally(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
        });
    });

    $('#eventSettingsSaveAllBtn')?.addEventListener('click', () => {
      const btn = $('#eventSettingsSaveAllBtn');
      if (!btn || eventSettingsDirty.size === 0) return;
      const count = eventSettingsDirty.size;
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = '저장 중…';

      void BremPerf.runSave('events.driverSettings.bulk', {
        write: () => saveAllDirtyEventSettings(),
        render: () => {
          resetEventSettingsDrafts();
          renderMissions();
          if (state.currentSection === 'dashboard') renderDashboard();
        }
      })
        .then(() => {
          showToast(`${count}명 장기근속이벤트 설정을 저장했습니다. 기사앱에 반영됩니다.`);
        })
        .catch(error => {
          showToast(error.message || '장기근속이벤트 일괄 저장에 실패했습니다.');
          renderMissions();
        })
        .finally(() => {
          btn.disabled = false;
          btn.textContent = prevText;
        });
    });

    $('#noticeForm').addEventListener('submit', event => {
      event.preventDefault();
      const data = {
        title: $('#noticeTitle').value.trim(),
        content: $('#noticeContent').value.trim(),
        pinned: $('#noticePinned').checked
      };
      const submitBtn = $('#noticeSubmit');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '저장 중…';
      }

      void (async () => {
        try {
          if (state.editingNoticeId) {
            await BremStorage.notices.update(state.editingNoticeId, data);
            state.editingNoticeId = '';
            if (submitBtn) submitBtn.textContent = '공지 등록';
            showToast('공지사항이 수정되었습니다. 기사앱에 반영됩니다.');
          } else {
            await BremStorage.notices.create(data);
            showToast('공지사항이 등록되었습니다. 기사앱에 반영됩니다.');
          }
          await BremStorage.flushStorage?.().catch(() => ({}));
          $('#noticeForm').reset();
          renderAll();
        } catch (error) {
          showToast(error.message || '공지사항 저장에 실패했습니다.');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            if (!state.editingNoticeId) submitBtn.textContent = '공지 등록';
            else submitBtn.textContent = '수정 저장';
          }
        }
      })();
    });

    document.addEventListener('change', event => {
      const callCheck = event.target.closest('[data-select-call]');
      if (callCheck) {
        if (callCheck.checked) selectedCallIds.add(callCheck.dataset.selectCall);
        else selectedCallIds.delete(callCheck.dataset.selectCall);
        const platform = PLATFORMS.find(p => callCheck.closest(`#callRows-${p}`));
        if (platform) updateCallSelectionUi(platform);
        callCheck.closest('tr')?.classList.toggle('row-selected', callCheck.checked);
        return;
      }

      const selectAll = event.target.closest('.call-select-all');
      if (selectAll) {
        const platform = selectAll.id.replace('selectAllCalls-', '');
        platformCalls(platform).forEach(call => {
          if (selectAll.checked) selectedCallIds.add(call.id);
          else selectedCallIds.delete(call.id);
        });
        renderCalls();
        return;
      }

      const rejectionCheck = event.target.closest('[data-select-rejection]');
      if (rejectionCheck) {
        if (rejectionCheck.checked) selectedRejectionIds.add(rejectionCheck.dataset.selectRejection);
        else selectedRejectionIds.delete(rejectionCheck.dataset.selectRejection);
        const platform = PLATFORMS.find(p => rejectionCheck.closest(`#rejectionRows-${p}`));
        if (platform) updateRejectionSelectionUi(platform);
        rejectionCheck.closest('tr')?.classList.toggle('row-selected', rejectionCheck.checked);
        return;
      }

      const selectAllRejections = event.target.closest('.rejection-select-all');
      if (selectAllRejections) {
        const platform = selectAllRejections.id.replace('selectAllRejections-', '');
        platformRejections(platform).forEach(entry => {
          if (selectAllRejections.checked) selectedRejectionIds.add(entry.id);
          else selectedRejectionIds.delete(entry.id);
        });
        renderRejections();
      }
    });

    document.addEventListener('click', event => {
      const bulkDeleteCallsBtn = event.target.closest('[id^="bulkDeleteCalls-"]');
      if (bulkDeleteCallsBtn && !bulkDeleteCallsBtn.disabled) {
        deleteSelectedCalls(bulkDeleteCallsBtn.id.replace('bulkDeleteCalls-', ''));
        return;
      }

      const bulkDeleteRejectionsBtn = event.target.closest('[id^="bulkDeleteRejections-"]');
      if (bulkDeleteRejectionsBtn && !bulkDeleteRejectionsBtn.disabled) {
        deleteSelectedRejections(bulkDeleteRejectionsBtn.id.replace('bulkDeleteRejections-', ''));
        return;
      }

      const deleteAllRejectionsBtn = event.target.closest('[id^="deleteAllRejections-"]');
      if (deleteAllRejectionsBtn && !deleteAllRejectionsBtn.disabled) {
        deleteAllRejections(deleteAllRejectionsBtn.id.replace('deleteAllRejections-', ''));
        return;
      }

      const callButton = event.target.closest('[data-delete-call]');
      if (callButton) {
        void (async () => {
          try {
            await BremStorage.ensureSectionLoaded('calls');
            await BremStorage.calls.removeByIdAsync(callButton.dataset.deleteCall);
            selectedCallIds.delete(callButton.dataset.deleteCall);
            showToast('콜수 기록이 삭제되었습니다.');
            renderSettlements();
            renderCalls();
          } catch (error) {
            console.error('[BREM] call delete failed:', error);
            showToast(error.message || '콜수 삭제 저장에 실패했습니다.');
            renderSettlements();
            renderCalls();
          }
        })();
        return;
      }

      const rejectionButton = event.target.closest('[data-delete-rejection]');
      if (rejectionButton) {
        const rejectionId = rejectionButton.dataset.deleteRejection;
        selectedRejectionIds.delete(rejectionId);
        void BremStorage.rejections.removeByIdAsync(rejectionId).then(() => {
          showToast('주간 기록이 삭제되었습니다.');
          renderRejections();
        }).catch(error => {
          console.error('[BREM] rejection delete failed:', error);
          showToast(error.message || '삭제 저장에 실패했습니다.');
          renderRejections();
        });
        return;
      }

      const targetButton = event.target.closest('[data-delete-target]');
      if (targetButton) {
        BremStorage.targets.removeById(targetButton.dataset.deleteTarget);
        showToast('월간 목표가 삭제되었습니다.');
        renderAll();
        void BremStorage.targets.removeByIdAsync(targetButton.dataset.deleteTarget).catch(error => {
          console.error('[BREM] monthly target delete failed:', error);
          showToast(error.message || '월간 목표 삭제 저장에 실패했습니다.');
          renderAll();
        });
        return;
      }

      const saveMonthlyTargetButton = event.target.closest('[data-save-monthly-target]');
      if (saveMonthlyTargetButton) {
        const targetId = saveMonthlyTargetButton.dataset.saveMonthlyTarget;
        const target = targets().find(item => item.id === targetId);
        const input = document.querySelector(`[data-edit-monthly-target="${targetId}"]`);
        const count = Number(input?.value || 0);
        if (!target || !count) {
          showToast('목표 콜수를 입력하세요.');
          return;
        }
        void persistAndRender('targets.monthly.inline', () => BremStorage.targets.upsertMonthly({
          driverId: target.driverId,
          month: target.month,
          count
        }), () => {
          renderTargets();
          if (state.currentSection === 'dashboard') renderDashboard();
        }).then(() => {
          showToast('월간 목표 콜수가 수정되었습니다.');
        });
        return;
      }

      const saveWeeklyTargetButton = event.target.closest('[data-save-weekly-target]');
      if (saveWeeklyTargetButton) {
        const targetId = saveWeeklyTargetButton.dataset.saveWeeklyTarget;
        const target = weeklyTargets().find(item => item.id === targetId);
        const countInput = document.querySelector(`[data-edit-weekly-target="${targetId}"]`);
        const weekInput = document.querySelector(`[data-edit-weekly-week="${targetId}"]`);
        const count = Number(countInput?.value || 0);
        const newWeekStart = weekStartKey(weekInput?.value || target?.weekStart || today());
        if (!target || !count) {
          showToast('목표 콜수를 입력하세요.');
          return;
        }
        if (weekInput) weekInput.value = newWeekStart;
        updateInlineWeekRange(targetId, newWeekStart);

        const duplicate = weeklyTargets().find(
          item => item.driverId === target.driverId && item.weekStart === newWeekStart && item.id !== target.id
        );
        if (duplicate) {
          showToast('해당 주에 이미 목표가 등록되어 있습니다.');
          return;
        }

        void persistAndRender('targets.weekly.inline', async () => {
          if (newWeekStart !== target.weekStart) {
            if (BremStorage.weeklyTargets.removeByIdAsync) {
              await BremStorage.weeklyTargets.removeByIdAsync(target.id);
            } else {
              BremStorage.weeklyTargets.removeById(target.id);
            }
          }
          return BremStorage.weeklyTargets.upsert({
            driverId: target.driverId,
            weekStart: newWeekStart,
            count
          });
        }, () => {
          renderTargets();
          if (state.currentSection === 'dashboard') renderDashboard();
        }).then(() => {
          showToast('주간 목표가 수정되었습니다.');
        }).catch(error => {
          console.error('[BREM] weekly target save failed:', error);
          showToast(error.message || '주간 목표 저장에 실패했습니다.');
        });
        return;
      }

      const weeklyTargetButton = event.target.closest('[data-delete-weekly-target]');
      if (weeklyTargetButton) {
        BremStorage.weeklyTargets.removeById(weeklyTargetButton.dataset.deleteWeeklyTarget);
        showToast('주간 목표가 삭제되었습니다.');
        renderAll();
        void BremStorage.weeklyTargets.removeByIdAsync(weeklyTargetButton.dataset.deleteWeeklyTarget).catch(error => {
          console.error('[BREM] weekly target delete failed:', error);
          showToast(error.message || '주간 목표 삭제 저장에 실패했습니다.');
          renderAll();
        });
        return;
      }

      const eventItemButton = event.target.closest('[data-delete-event-item]');
      if (eventItemButton) {
        BremStorage.events.removeCatalogItemReferences(eventItemButton.dataset.deleteEventItem);
        showToast('장기근속이벤트 아이템이 삭제되었습니다.');
        renderAll();
      }

      const settlementButton = event.target.closest('[data-delete-settlement]');
      if (settlementButton) {
        void (async () => {
          try {
            await BremStorage.settlements.removeByIdAsync(settlementButton.dataset.deleteSettlement);
            showToast('정산 내역이 삭제되었습니다.');
            renderSettlements();
            renderCalls();
          } catch (error) {
            console.error('[BREM] settlement delete failed:', error);
            showToast(error.message || '삭제 저장에 실패했습니다.');
            renderSettlements();
            renderCalls();
          }
        })();
        return;
      }

      const settlementUploadLogButton = event.target.closest('[data-delete-settlement-upload-log]');
      if (settlementUploadLogButton) {
        const logId = settlementUploadLogButton.dataset.deleteSettlementUploadLog;
        const log = BremStorage.settlementUploadLogs.getById(logId);
        if (log?.kind === 'daily' && log.status === 'applied') {
          const ok = window.confirm(
            '이 업로드 기록을 삭제하면 이 파일로 반영된\n'
            + '· 일정산 정산 데이터\n'
            + '· 콜수입력(기사별 일별 콜수)\n'
            + '도 함께 제거됩니다.\n'
            + '(같은 날 더 최근 반영 기록이 있으면 그 데이터는 유지됩니다.)\n계속할까요?'
          );
          if (!ok) return;
        }
        if (state.settlementUploadLogDetailId === logId) hideSettlementUploadLogDetail();
        void (async () => {
          try {
            const removed = await BremStorage.settlementUploadLogs.removeAsync(logId);
            const rolledBack = removed?.rollbackResult?.rolledBackCalls || 0;
            const rolledBackLabel = rolledBack < 0
              ? '해당 일자 전체'
              : `${rolledBack}명`;
            showToast(
              removed?.kind === 'daily' && removed?.status === 'applied'
                ? `업로드 기록 삭제 · 정산·콜수입력 ${rolledBackLabel} 연동 제거`
                : '업로드 기록이 삭제되었습니다.'
            );
            invalidateCallStatsIndex();
            renderSettlements();
            renderCalls();
            renderDashboard();
          } catch (error) {
            console.error('[BREM] settlement upload log delete failed:', error);
            showToast(error.message || '기록 삭제 저장에 실패했습니다.');
            invalidateCallStatsIndex();
            renderSettlements();
            renderCalls();
            renderDashboard();
          }
        })();
        return;
      }

      const settlementUploadLogDetailButton = event.target.closest('[data-settlement-upload-log-detail]');
      if (settlementUploadLogDetailButton) {
        renderSettlementUploadLogDetail(settlementUploadLogDetailButton.dataset.settlementUploadLogDetail);
        return;
      }

      const settlementUploadLogReapplyButton = event.target.closest('[data-reapply-settlement-upload-log]');
      if (settlementUploadLogReapplyButton) {
        void reapplySettlementUploadLog(settlementUploadLogReapplyButton.dataset.reapplySettlementUploadLog);
        return;
      }

      const unmatchedRetryButton = event.target.closest('[data-retry-settlement-unmatched]');
      if (unmatchedRetryButton) {
        const row = unmatchedRetryButton.closest('tr');
        const panel = unmatchedRetryButton.closest('.admin-platform-panel[data-platform]');
        const p = panel?.dataset?.platform || 'coupang';
        retryDailySettlementUnmatched(p, { recordIds: [unmatchedRetryButton.dataset.retrySettlementUnmatched] });
        return;
      }

      const unmatchedButton = event.target.closest('[data-delete-settlement-unmatched]');
      if (unmatchedButton) {
        BremStorage.settlementUnmatched.removeById(unmatchedButton.dataset.deleteSettlementUnmatched);
        void BremStorage.flushStorage?.().then(() => {
          showToast('미반영 기사 내역이 삭제되었습니다.');
          renderSettlements();
        }).catch(error => {
          console.error('[BREM] settlement unmatched delete failed:', error);
          showToast(error.message || '삭제 저장에 실패했습니다.');
          renderSettlements();
        });
        return;
      }

      const editNoticeButton = event.target.closest('[data-edit-notice]');
      if (editNoticeButton) {
        const notice = notices().find(item => item.id === editNoticeButton.dataset.editNotice);
        if (!notice) return;
        state.editingNoticeId = notice.id;
        $('#noticeTitle').value = notice.title;
        $('#noticeContent').value = notice.content;
        $('#noticePinned').checked = notice.pinned;
        $('#noticeSubmit').textContent = '수정 저장';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      const deleteNoticeButton = event.target.closest('[data-delete-notice]');
      if (deleteNoticeButton) {
        void (async () => {
          try {
            await BremStorage.notices.removeById(deleteNoticeButton.dataset.deleteNotice);
            await BremStorage.flushStorage?.().catch(() => ({}));
            showToast('공지사항이 삭제되었습니다. 기사앱에 반영됩니다.');
            renderAll();
          } catch (error) {
            showToast(error.message || '공지사항 삭제에 실패했습니다.');
          }
        })();
      }

      const markInquiryButton = event.target.closest('[data-mark-inquiry]');
      if (markInquiryButton) {
        const update = window.BremRiderInquiryApi?.updateStatus
          ? window.BremRiderInquiryApi.updateStatus(
            markInquiryButton.dataset.markInquiry,
            markInquiryButton.dataset.status
          )
          : Promise.resolve(BremStorage.riderInquiries.updateStatus(
            markInquiryButton.dataset.markInquiry,
            markInquiryButton.dataset.status
          ));
        update.then(() => {
          showToast('문의 상태가 변경되었습니다.');
          renderRiderInquiries();
        });
        return;
      }

      const deleteInquiryButton = event.target.closest('[data-delete-inquiry]');
      if (deleteInquiryButton) {
        const remove = window.BremRiderInquiryApi?.remove
          ? window.BremRiderInquiryApi.remove(deleteInquiryButton.dataset.deleteInquiry)
          : Promise.resolve(BremStorage.riderInquiries.removeById(deleteInquiryButton.dataset.deleteInquiry));
        remove.then(() => {
          showToast('문의가 삭제되었습니다.');
          renderRiderInquiries();
        });
        return;
      }

      const refreshInquiryButton = event.target.closest('#riderInquiryRefreshBtn');
      if (refreshInquiryButton) {
        renderRiderInquiries().then(() => {
          showToast('라이더 문의 목록을 새로고침했습니다.');
        });
      }
    });
  }

  function initDefaults() {
    initCallDateFields();
    PLATFORMS.forEach(platform => {
      state.rejectionWeekByPlatform[platform] = weekStartKey();
    });
    state.driverSearchQuery = '';
    state.dashboardSearchQuery = '';
    if ($('#adminDriverSearch')) $('#adminDriverSearch').value = '';
    if ($('#dashboardDriverSearch')) $('#dashboardDriverSearch').value = '';
    loadDashboardWeekBasis();
    $('#targetMonth').value = currentMonth();
    targetMonthPicker?.setMonth(currentMonth());
    updateTargetMonthLabel();
    updateAdminWeekTargetPreview(weekStartKey());
    refreshSelects();
  }

  async function bootstrapAdminPage() {
    document.addEventListener('brem-config-ready', updateAdminLoginHelp);

    if (window.BremSupabaseConfig?.load) {
      await window.BremSupabaseConfig.load();
    }

    bindAuthEvents();
    updateAdminLoginHelp();
    consumeLogoutNotice();

    renderDbConnectionStatus();
    document.addEventListener('brem-storage-ready', renderDbConnectionStatus);
    document.addEventListener('brem-storage-error', renderDbConnectionStatus);
    document.addEventListener('brem-storage-persist-error', event => {
      const message = event.detail?.message || '데이터 저장에 실패했습니다.';
      showToast(message);
      renderDbConnectionStatus();
    });
    document.addEventListener('brem-storage-persist-blocked', event => {
      const message = event.detail?.message || '로컬 개발환경에서는 운영 DB 저장이 차단됩니다';
      showToast(message);
    });
    document.addEventListener('brem-admin-session-ready', () => {
      if (!$('#adminApp').classList.contains('app-hidden')) {
        applyAdminMenuPermissions();
        applySectionEditPermissions();
      }
    });
    document.addEventListener('brem-admin-data-ready', () => {
      if ($('#adminApp').classList.contains('app-hidden')) return;
      showAdminDataLoading(false);
      renderDbConnectionStatus();
      renderActiveSection(state.currentSection);
      renderRiderPublishStatus();
      applySectionEditPermissions();
    });

    const config = BremStorage.getSupabaseConfig?.() || {};

    await BremStorage.waitForStorageBootstrap?.();

    if (config.mode === 'production') {
      const profile = await BremStorage.loadSupabaseProfile?.();
      if (profile?.active && profile.role === 'admin') {
        if (!BremStorage.auth.isAdminLoggedIn()) {
          BremStorage.auth.setAdminSession(profile.user_id);
        }
        if (window.BremSessionSecurity?.isIdleExpired?.()) {
          await logoutAdmin({ idle: true, reload: false });
          return;
        }
        const returnPath = new URLSearchParams(window.location.search).get('return');
        if (returnPath && returnPath.startsWith('/') && !returnPath.startsWith('//')) {
          window.location.replace(returnPath);
          return;
        }
        showAdminApp();
        return;
      }
    }

    if (isAdminLoggedIn()) {
      if (window.BremSessionSecurity?.isIdleExpired?.()) {
        await logoutAdmin({ idle: true, reload: false });
        return;
      }
      showAdminApp();
    } else {
      showAdminLoginPageOnly();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bootstrapAdminPage().catch(error => {
      console.error('[BREM] Admin bootstrap failed:', error);
    });
  });
})();

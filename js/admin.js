(function () {
  const selectedCallIds = new Set();
  let targetMonthPicker = null;

  const state = {
    currentSection: 'dashboard',
    editingNoticeId: '',
    editingAdminAccountId: '',
    adminAccountFormMode: '',
    rejectionWeekByPlatform: { coupang: null, baemin: null },
    driverSearchQuery: '',
    settlementPreviewByPlatform: { coupang: null, baemin: null },
    unifiedPlatform: { calls: 'coupang', rejections: 'coupang', settlements: 'coupang', 'weekly-settlement': 'coupang' }
  };

  const UNIFIED_SECTIONS = {
    calls: { title: '콜수 입력', defaultPlatform: 'coupang' },
    rejections: { title: '거절율 입력', defaultPlatform: 'coupang' },
    settlements: { title: '일정산서 업로드', defaultPlatform: 'coupang' },
    'weekly-settlement': { title: '주정산서 업로드', defaultPlatform: 'coupang' }
  };

  const DRIVER_FILTERED_SECTIONS = new Set([
    'dashboard',
    'calls',
    'rejections',
    'targets',
    'missions',
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
        if (element.dataset.readonlyAllow === 'true') return;

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
          banner.textContent = '이 메뉴는 노출만 가능합니다. 입력·저장하려면 수정 권한이 필요합니다.';
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
          : 'Supabase 설정을 불러오는 중…';
        return;
      }

      if (isProduction) {
        help.textContent = '운영 로그인: 계정 생성 시 입력한 관리자 이름(아이디) + 비밀번호 (이메일로도 로그인 가능)';
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
    return false;
  }

  function filteredDrivers() {
    const query = state.driverSearchQuery.trim();
    if (!query) return drivers();
    return drivers().filter(driver => matchesDriverSearch(driver, query));
  }

  function driverMatchesSearch(driverId) {
    if (!state.driverSearchQuery.trim()) return true;
    const driver = drivers().find(item => item.id === driverId);
    if (!driver) return false;
    return matchesDriverSearch(driver, state.driverSearchQuery);
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
    const options = ['<option value="">이벤트 아이템 선택</option>'];
    eventCatalog().forEach(item => {
      const selected = selectedValue && (selectedValue === item.id || selectedValue === item.name) ? 'selected' : '';
      options.push(`<option value="${item.id}" ${selected}>${escapeHtml(item.name)} (목표 ${number(item.targetCount)}개)</option>`);
    });
    return options.join('');
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

  function initCallDateFields() {
    PLATFORMS.forEach(platform => {
      const date = today();
      const callDate = $(`#callDate-${platform}`);
      const filterDate = $(`#callFilterDate-${platform}`);
      if (callDate) callDate.value = date;
      if (filterDate) filterDate.value = date;
      refreshCallDateLabel(`callDate-${platform}`);
      refreshCallDateLabel(`callFilterDate-${platform}`);
    });
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
            if (targetId.startsWith('callFilterDate-')) {
              selectedCallIds.clear();
              renderCalls();
            }
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
            BremStorage.events.setDriverStartDate(driverId, value);
            showToast('장기근속이벤트 시작일이 저장되었습니다.');
            renderAll();
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
    const total = BremStorage.events.eventCallsForDriver(driver);
    const target = Number(item.targetCount || 0);
    const rate = target ? Math.round((total / target) * 100) : 0;
    return `${number(total)} / ${number(target)}콜 · ${rate}%`;
  }

  function eventProgressDetail(driver) {
    const item = eventItemFor(driver);
    if (!item) return '이벤트 아이템 미설정';
    const startDate = driver.longEventStartDate || '';
    if (!startDate) return '시작일을 설정하면 집계됩니다.';
    const total = BremStorage.events.eventCallsForDriver(driver);
    const target = Number(item.targetCount || 0);
    const rate = target ? Math.round((total / target) * 100) : 0;
    return `
      <p>시작일: ${formatDate(startDate)}</p>
      <p>${number(total)} / ${number(target)}콜</p>
      ${progress(rate)}
    `;
  }

  function eventDriverStats(driver) {
    const item = eventItemFor(driver);
    if (!item) {
      return {
        status: 'unset',
        item: null,
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

  function missionResultsDrivers() {
    const filters = missionResultsFilterState();
    return filteredDrivers().filter(driver => {
      const stats = eventDriverStats(driver);
      if (filters.itemId && stats.item?.id !== filters.itemId) return false;
      if (filters.status && stats.status !== filters.status) return false;
      return true;
    });
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

    const emptyMessage = state.driverSearchQuery.trim()
      ? '검색 결과에 해당하는 기사가 없습니다.'
      : '기사등록 프로그램에서 기사를 먼저 등록하세요.';

    $('#missionResultRows').innerHTML = missionResultsDrivers()
      .map(driver => ({ driver, stats: eventDriverStats(driver) }))
      .sort((a, b) => {
        const order = { achieved: 0, 'in-progress': 1, 'no-start': 2, unset: 3 };
        const diff = order[a.stats.status] - order[b.stats.status];
        if (diff !== 0) return diff;
        return b.stats.rate - a.stats.rate;
      })
      .map(({ driver, stats }) => `
        <tr>
          <td>${escapeHtml(driver.name)}</td>
          <td>${escapeHtml(driver.phone)}</td>
          <td>${escapeHtml(stats.item ? stats.item.name : '미설정')}</td>
          <td>${stats.startDate ? formatDate(stats.startDate) : '-'}</td>
          <td><strong>${number(stats.total)}</strong></td>
          <td>${stats.target ? number(stats.target) : '-'}</td>
          <td>${stats.target ? progress(stats.rate) : '-'}</td>
          <td>${missionStatusBadge(stats.status)}</td>
        </tr>
      `).join('') || emptyRow(8, emptyMessage);
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
      await BremStorage.auth.signOutSupabase();
    } else {
      BremStorage.auth.clearAdminSession();
      BremStorage.auth.clearSessionAuth?.();
    }

    if (reload) {
      location.reload();
      return;
    }

    showAdminLoginPageOnly();
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

    const loadPromise = BremStorage.ensureSectionLoaded?.(initialSection)
      || BremStorage.hydrateAdminDataInBackground?.();

    Promise.resolve(loadPromise).then(result => {
      showAdminDataLoading(false);
      if (result && result.ok === false) {
        showToast(result.message || '데이터 연결에 실패했습니다.');
        renderDbConnectionStatus();
        return;
      }
      renderDbConnectionStatus();
      renderActiveSection(initialSection);
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
          await window.BremSupabaseConfig.load();
        }

        await BremStorage.waitForStorageBootstrap?.();

        window.BremPerf?.time?.('admin.signInApi');
        const config = BremStorage.getSupabaseConfig?.() || {};
        const result = config.isConfigured
          ? await BremStorage.auth.signInAdmin(name, password)
          : BremStorage.auth.verifyAdminLogin(name, password);
        window.BremPerf?.timeEnd?.('admin.signInApi');

        if (!result?.ok) {
          showToast(result?.message || '이름 또는 비밀번호가 올바르지 않습니다.');
          return;
        }

        if (!config.isConfigured) {
          BremStorage.auth.setAdminSession(result.account.id);
        } else {
          void BremStorage.initStorage?.({ backend: 'supabase', deferHydrate: true });
        }

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

  function monthCalls(driverId, month) {
    return calls()
      .filter(call => call.driverId === driverId && call.date.startsWith(month))
      .reduce((sum, call) => sum + Number(call.count || 0), 0);
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
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(`${weekEndKey(weekStart)}T00:00:00`);
    end.setHours(23, 59, 59, 999);

    return calls()
      .filter(call => {
        if (call.driverId !== driverId) return false;
        const callDate = new Date(`${call.date}T00:00:00`);
        return callDate >= start && callDate <= end;
      })
      .reduce((sum, call) => sum + Number(call.count || 0), 0);
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

  function fillDriverSelect(select) {
    const current = select.value;
    const list = filteredDrivers();
    select.innerHTML = '<option value="">기사 선택</option>' + list
      .map(driver => `<option value="${driver.id}">${escapeHtml(driver.name)} · ${escapeHtml(driver.phone)}</option>`)
      .join('');
    if (current && list.some(driver => driver.id === current)) {
      select.value = current;
    } else {
      select.value = '';
    }
  }

  function refreshSelects() {
    $$('.call-driver, .rejection-driver').forEach(fillDriverSelect);
    ['#targetDriver', '#weeklyTargetDriver'].forEach(selector => fillDriverSelect($(selector)));
  }

  function weekCallsForDriverByPlatform(driverId, weekStart, platform) {
    const p = normalizePlatform(platform);
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(`${weekEndKey(weekStart)}T00:00:00`);
    end.setHours(23, 59, 59, 999);

    return calls()
      .filter(call => {
        if (call.driverId !== driverId) return false;
        if (normalizePlatform(call.platform) !== p) return false;
        const callDate = new Date(`${call.date}T00:00:00`);
        return callDate >= start && callDate <= end;
      })
      .reduce((sum, call) => sum + Number(call.count || 0), 0);
  }

  function weekCallsByPlatform(platform, weekStart) {
    const p = normalizePlatform(platform);
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(`${weekEndKey(weekStart)}T00:00:00`);
    end.setHours(23, 59, 59, 999);

    return calls()
      .filter(call => {
        if (normalizePlatform(call.platform) !== p) return false;
        const callDate = new Date(`${call.date}T00:00:00`);
        return callDate >= start && callDate <= end;
      })
      .reduce((sum, call) => sum + Number(call.count || 0), 0);
  }

  function renderDashboard() {
    window.BremPerf?.time?.('admin.renderDashboard');
    const month = currentMonth();
    const weekStart = weekStartKey();
    const allDrivers = filteredDrivers();
    const driverStats = allDrivers.map(driver => {
      const coupangWeekCalls = weekCallsForDriverByPlatform(driver.id, weekStart, 'coupang');
      const baeminWeekCalls = weekCallsForDriverByPlatform(driver.id, weekStart, 'baemin');
      const totalWeekCalls = coupangWeekCalls + baeminWeekCalls;
      const monthlyCallCount = monthCalls(driver.id, month);
      return { driver, coupangWeekCalls, baeminWeekCalls, totalWeekCalls, monthlyCallCount };
    });

    driverStats.sort((a, b) => {
      if (b.totalWeekCalls !== a.totalWeekCalls) return b.totalWeekCalls - a.totalWeekCalls;
      if (b.baeminWeekCalls !== a.baeminWeekCalls) return b.baeminWeekCalls - a.baeminWeekCalls;
      if (b.coupangWeekCalls !== a.coupangWeekCalls) return b.coupangWeekCalls - a.coupangWeekCalls;
      return a.driver.name.localeCompare(b.driver.name, 'ko');
    });

    const rows = driverStats.map(({ driver, coupangWeekCalls, baeminWeekCalls, totalWeekCalls, monthlyCallCount }) => `
        <tr>
          <td>${escapeHtml(driver.name)}</td>
          <td>${escapeHtml(driver.phone)}</td>
          <td>${platformBadges(driver)}</td>
          <td><strong>${number(coupangWeekCalls)}</strong></td>
          <td><strong>${number(baeminWeekCalls)}</strong></td>
          <td><strong>${number(totalWeekCalls)}</strong></td>
          <td><strong>${number(monthlyCallCount)}</strong></td>
          <td>${eventProgressSummary(driver)}</td>
        </tr>
      `).join('');

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
    const emptyMessage = state.driverSearchQuery.trim()
      ? '검색 결과에 해당하는 기사가 없습니다.'
      : '기사등록 프로그램에서 기사를 먼저 등록하세요.';
    $('#dashboardRows').innerHTML = rows || emptyRow(8, emptyMessage);
    const dashboardCountEl = $('#dashboardDriverCount');
    if (dashboardCountEl) {
      const totalDrivers = drivers().length;
      if (!allDrivers.length) {
        dashboardCountEl.hidden = true;
        dashboardCountEl.textContent = '';
      } else {
        dashboardCountEl.hidden = false;
        if (state.driverSearchQuery.trim()) {
          dashboardCountEl.textContent = `검색 결과 ${allDrivers.length}명 표시 · 스크롤하여 확인`;
        } else if (allDrivers.length === totalDrivers) {
          dashboardCountEl.textContent = `등록 기사 ${totalDrivers}명 전체 표시 · 스크롤하여 확인`;
        } else {
          dashboardCountEl.textContent = `등록 기사 ${totalDrivers}명 중 ${allDrivers.length}명 표시 · 스크롤하여 확인`;
        }
      }
    }
    $('#dashboardNotices').innerHTML = renderNoticeItems(notices().slice(0, 4), false);
    window.BremPerf?.timeEnd?.('admin.renderDashboard');
  }

  function callFilterDate(platform) {
    return $(`#callFilterDate-${platform}`)?.value || today();
  }

  function platformCalls(platform) {
    const filterDate = callFilterDate(platform);
    return calls()
      .filter(call => normalizePlatform(call.platform) === platform
        && call.date === filterDate
        && driverMatchesSearch(call.driverId))
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

    ids.forEach(id => {
      BremStorage.calls.removeById(id);
      selectedCallIds.delete(id);
    });
    showToast(`${ids.length}건 삭제되었습니다.`);
    renderAll();
  }

  function renderCalls() {
    refreshSelects();
    pruneSelectedCallIds();
    PLATFORMS.forEach(platform => {
      const filterDate = callFilterDate(platform);
      const emptyMessage = state.driverSearchQuery.trim()
        ? '검색 결과에 해당하는 콜수 기록이 없습니다.'
        : `${formatDate(filterDate)} ${platformLabel(platform)} 콜수 기록이 없습니다.`;
      const rowsEl = $(`#callRows-${platform}`);
      if (!rowsEl) return;

      const platformCallList = platformCalls(platform);
      rowsEl.innerHTML = platformCallList.map(call => `
        <tr${selectedCallIds.has(call.id) ? ' class="row-selected"' : ''}>
          <td class="col-select">
            <input type="checkbox" class="call-select-check" data-select-call="${call.id}" aria-label="선택"${selectedCallIds.has(call.id) ? ' checked' : ''}>
          </td>
          <td>${escapeHtml(driverName(call.driverId))}</td>
          <td>${number(call.count)}</td>
          <td><button type="button" class="small-btn danger-btn" data-delete-call="${call.id}">삭제</button></td>
        </tr>
      `).join('') || emptyRow(4, emptyMessage);

      updateCallSelectionUi(platform);
    });
  }

  function renderRejections() {
    refreshSelects();
    PLATFORMS.forEach(platform => {
      updateRejectionWeekPreview(state.rejectionWeekByPlatform[platform] || weekStartKey(), platform);
      fillRejectionRateInput(platform);

      const emptyMessage = state.driverSearchQuery.trim()
        ? `검색 결과에 해당하는 ${platformRateLabel(platform)} 기록이 없습니다.`
        : `${platformLabel(platform)} 주간 ${platformRateLabel(platform)} 기록이 없습니다.`;
      const rowsEl = $(`#rejectionRows-${platform}`);
      if (!rowsEl) return;
      rowsEl.innerHTML = rejections()
        .filter(entry => normalizePlatform(entry.platform) === platform && driverMatchesSearch(entry.driverId))
        .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
        .map(entry => `
          <tr>
            <td>${formatDate(entry.weekStart)} ~ ${formatDate(weekEndKey(entry.weekStart))}</td>
            <td>${escapeHtml(driverName(entry.driverId))}</td>
            <td>${formatPercent(entry.rate)}</td>
            <td><button class="small-btn danger-btn" data-delete-rejection="${entry.id}">삭제</button></td>
          </tr>
        `).join('') || emptyRow(4, emptyMessage);
    });
  }

  function formatPercent(value) {
    const rate = Number(value);
    if (Number.isNaN(rate)) return '-';
    return `${rate % 1 === 0 ? rate : rate.toFixed(1)}%`;
  }

  function renderTargets() {
    refreshSelects();
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

  function renderMissions() {
    const catalog = eventCatalog();
    const visibleDrivers = filteredDrivers();
    const emptyMessage = state.driverSearchQuery.trim()
      ? '검색 결과에 해당하는 기사가 없습니다.'
      : '기사등록 프로그램에서 기사를 먼저 등록하세요.';

    $('#eventItemList').innerHTML = catalog.map(item => `
      <div class="mission-item">
        <h3>${escapeHtml(item.name)}</h3>
        <p>목표 갯수: ${number(item.targetCount)}개</p>
        <div class="notice-actions">
          <button class="small-btn danger-btn" data-delete-event-item="${item.id}">삭제</button>
        </div>
      </div>
    `).join('') || '<div class="empty">등록된 장기근속이벤트 아이템이 없습니다.</div>';

    $('#eventSettings').innerHTML = visibleDrivers.map(driver => `
      <div class="event-driver-row">
        <strong>${escapeHtml(driver.name)} · ${escapeHtml(driver.phone)}</strong>
        <label>
          이벤트 아이템
          <select data-event-driver="${driver.id}">
            ${eventOptions((eventItemFor(driver) || {}).id || driver.longEventItemId || driver.longEventItem || '')}
          </select>
        </label>
        <label class="event-start-date-field">
          <span>시작일</span>
          <button type="button" class="date-range-button" data-event-start-button="${driver.id}">
            ${eventStartButtonLabel(driver.longEventStartDate)}
          </button>
          <input type="hidden" data-event-start="${driver.id}" value="${driver.longEventStartDate || ''}">
        </label>
      </div>
    `).join('') || `<div class="empty">${emptyMessage}</div>`;
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
    const visibleDriverIds = new Set(filteredDrivers().map(driver => driver.id));
    const query = state.driverSearchQuery.trim();

    PLATFORMS.forEach(platform => {
      const p = normalizePlatform(platform);
      const rows = settlements()
        .filter(record => normalizePlatform(record.platform) === p)
        .filter(record => !query || visibleDriverIds.has(record.driverId))
        .sort((a, b) => b.period.localeCompare(a.period) || b.appliedAt.localeCompare(a.appliedAt));

      const historyEl = $(`#settlementHistoryRows-${p}`);
      if (!historyEl) return;

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
      `).join('') || `<tr><td colspan="${isBaeminSettlementPlatform(p) ? 7 : 6}" class="empty">${platformLabel(p)} 반영된 정산 내역이 없습니다.</td></tr>`;

      renderSettlementPreview(p);
      renderSettlementUnmatched(p);
    });
  }

  function renderPromotions() {
    if (typeof BremPromotionAdmin !== 'undefined') BremPromotionAdmin.refresh();
  }

  function renderSettlementUnmatched(platform) {
    const p = normalizePlatform(platform);
    const rows = settlementUnmatchedList()
      .filter(record => normalizePlatform(record.platform) === p)
      .sort((a, b) => b.period.localeCompare(a.period) || b.savedAt.localeCompare(a.savedAt));

    const rowsEl = $(`#settlementUnmatchedHistoryRows-${p}`);
    if (!rowsEl) return;

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
            <button class="small-btn danger-btn" type="button" data-delete-settlement-unmatched="${record.id}">삭제</button>
          </td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="7" class="empty">${platformLabel(p)} 미반영 기사 내역이 없습니다.</td></tr>`;
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
      const result = await BremSettlementParser.parseSettlementFile({
        file,
        password: String(passwordInput?.value || '').trim(),
        period: periodInput?.value || BremSettlementParser.parseSettlementDateFromFilename(file.name) || '',
        formatId: BremPlatforms.settlementFormatId(p),
        drivers: drivers().map(driver => ({
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
        showToast(`${platformLabel(p)} 미리보기 · 배달 ${result.totalDeliveries || 0}건 · 라이더 ${result.totalRiders || result.totalRows}명 · 매칭 ${result.matched.length}명`);
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

  function applySettlementPreview(platform) {
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

    BremStorage.settlements.upsertBatch({
      period: preview.period,
      platform: p,
      records: preview.matched.map(record => ({
        driverId: record.driverId,
        riderId: record.riderId || '',
        orderCount: record.orderCount,
        deliveryAmount: settlementAmountValue(record),
        settlementAmount: settlementAmountValue(record)
      }))
    });

    if (preview.unmatched.length) {
      saveSettlementUnmatched({
        period: preview.period,
        records: preview.unmatched,
        sourceFileName: preview.sourceFileName || '',
        platform: p
      });
    } else {
      BremStorage.settlementUnmatched.clearByPeriod(preview.period, p);
    }

    clearSettlementPreview(p);
    renderAll();
    showToast(`${platformLabel(p)} ${preview.matched.length}명 반영 완료${preview.unmatched.length ? ` · 미반영 ${preview.unmatched.length}명은 아래 목록에 저장됨` : ''}`);
  }

  function renderActiveSection(sectionId = state.currentSection) {
    window.BremPerf?.time?.(`admin.renderSection:${sectionId}`);

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
    renderActiveSection(state.currentSection);
    window.BremPerf?.timeEnd?.('admin.renderAll');
  }

  function handleDriverSearchChange() {
    updateDriverSearchStatus();
    if (DRIVER_FILTERED_SECTIONS.has(state.currentSection)) {
      renderActiveSection(state.currentSection);
    }
  }

  const debouncedDriverSearchChange = window.BremPerf?.debounce
    ? window.BremPerf.debounce(handleDriverSearchChange, 180)
    : handleDriverSearchChange;

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

  async function showSection(id, options = {}) {
    const nav = resolveSectionNavigation(id);
    const sectionId = nav.sectionId;

    if (!canAccessAdminSection(sectionId)) {
      showToast('접근 권한이 없는 메뉴입니다.');
      return;
    }

    state.currentSection = sectionId;
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
    if (!cacheReady) {
      showSectionLoadingSkeleton(sectionId);
      showAdminDataLoading(true);
    }

    try {
      const result = await (BremStorage.ensureSectionLoaded?.(sectionId) || Promise.resolve({ ok: true }));
      if (result?.ok === false) {
        showToast(result.message || '데이터를 불러오지 못했습니다.');
      }
    } catch (error) {
      console.error('[BREM] Section load failed:', error);
      showToast(error.message || '데이터를 불러오지 못했습니다.');
    } finally {
      if (!cacheReady) {
        showAdminDataLoading(false);
      }
    }

    if (sectionId === 'data-backup' && window.BremDataBackupAdmin?.refresh) {
      window.BremDataBackupAdmin.refresh();
    }
    if (sectionId === 'admin-schedule' && window.BremAdminSchedule?.refresh) {
      window.BremAdminSchedule.refresh();
    }
    if (sectionId === 'lease-management' && window.BremAdminLease?.refresh) {
      const filter = window.__leaseFilterOnOpen;
      window.__leaseFilterOnOpen = null;
      window.BremAdminLease.refresh(filter ? { filter } : {});
    }
    if (sectionId === 'revenue-management' && window.BremAdminRevenue?.refresh) {
      window.BremAdminRevenue.refresh();
    }
    if (sectionId === 'mission-management' && window.BremAdminMissions?.refresh) {
      void window.BremAdminMissions.refresh({ renderOnly: true });
    }
    if (sectionId === 'baemin-delivery-status' && window.BremBaeminDeliveryStatusAdmin?.refresh) {
      void window.BremBaeminDeliveryStatusAdmin.refresh();
    }
    renderActiveSection(sectionId);
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

    document.addEventListener('brem-admin-toast', event => {
      showToast(event.detail?.message || '');
    });

    document.addEventListener('brem-rejection-bulk-applied', () => {
      renderAll();
    });

    initCallDateFields();

    $('#adminDriverSearch').addEventListener('input', event => {
      state.driverSearchQuery = event.target.value;
      debouncedDriverSearchChange();
    });

    $('#adminDriverSearchClear').addEventListener('click', () => {
      state.driverSearchQuery = '';
      $('#adminDriverSearch').value = '';
      handleDriverSearchChange();
    });

    $('#dashboardEmptyLeaseBtn')?.addEventListener('click', () => {
      window.__leaseFilterOnOpen = 'empty';
      showSection('lease-management');
    });

    $('#missionResultItemFilter')?.addEventListener('change', renderMissionResults);
    $('#missionResultStatusFilter')?.addEventListener('change', renderMissionResults);

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
      $(`#callForm-${platform}`)?.addEventListener('submit', event => {
        event.preventDefault();
        const driverId = $(`#callDriver-${platform}`).value;
        const date = $(`#callDate-${platform}`).value;
        if (!date) {
          showToast('날짜를 선택하세요.');
          return;
        }

        BremStorage.calls.upsertDaily({
          driverId,
          date,
          count: Number($(`#callCount-${platform}`).value),
          platform
        });
        $(`#callCount-${platform}`).value = '';
        const filterDate = $(`#callFilterDate-${platform}`);
        if (filterDate) {
          filterDate.value = date;
          refreshCallDateLabel(`callFilterDate-${platform}`);
        }
        showToast(`${platformLabel(platform)} 콜수가 저장되었습니다.`);
        renderAll();
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

        BremStorage.rejections.upsertWeekly({ driverId, weekStart, rate, platform });
        void BremStorage.flushStorage?.().then(() => {
          showToast(`${platformLabel(platform)} 주간 ${platformRateLabel(platform)} Supabase 저장 완료`);
          renderAll();
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
      BremStorage.targets.upsertMonthly({
        driverId,
        month,
        count: Number($('#targetCount').value)
      });
      $('#targetCount').value = '';
      showToast('월간 목표 콜수가 저장되었습니다.');
      renderAll();
    });

    $('#weeklyTargetForm').addEventListener('submit', event => {
      event.preventDefault();
      const driverId = $('#weeklyTargetDriver').value;
      const weekStart = weekStartKey($('#weeklyTargetWeekDate').value);
      if (!$('#weeklyTargetWeekDate').value) {
        showToast('적용주 수요일을 선택하세요.');
        return;
      }
      BremStorage.weeklyTargets.upsert({
        driverId,
        weekStart,
        count: Number($('#weeklyTargetCount').value)
      });
      $('#weeklyTargetCount').value = '';
      updateAdminWeekTargetPreview(weekStart);
      showToast('주간 목표 콜수가 저장되었습니다.');
      renderAll();
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
        const count = settlementUnmatchedList().filter(record => normalizePlatform(record.platform) === p).length;
        if (!count) return;
        if (!window.confirm(`${platformLabel(p)} 미반영 기사 내역을 모두 삭제하시겠습니까?`)) return;
        BremStorage.settlementUnmatched.clearByPlatform(p);
        renderSettlements();
        showToast(`${platformLabel(p)} 미반영 기사 내역이 삭제되었습니다.`);
      });
      $(`#settlementFile-${p}`)?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const date = applySettlementDateFromFilename(file.name, p);
        if (date) showToast(`${platformLabel(p)} 정산일 ${formatDate(date)} 자동 설정`);
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
      const selectedItem = eventCatalog().find(item => item.id === input.value);
      BremStorage.events.setDriverItem(
        input.dataset.eventDriver,
        selectedItem ? { id: selectedItem.id, name: selectedItem.name } : null
      );
      renderAll();
    });

    $('#noticeForm').addEventListener('submit', event => {
      event.preventDefault();
      const data = {
        title: $('#noticeTitle').value.trim(),
        content: $('#noticeContent').value.trim(),
        pinned: $('#noticePinned').checked
      };
      if (state.editingNoticeId) {
        BremStorage.notices.update(state.editingNoticeId, data);
        state.editingNoticeId = '';
        $('#noticeSubmit').textContent = '공지 등록';
        showToast('공지사항이 수정되었습니다.');
      } else {
        BremStorage.notices.create(data);
        showToast('공지사항이 등록되었습니다.');
      }
      $('#noticeForm').reset();
      renderAll();
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
      }
    });

    document.addEventListener('click', event => {
      const bulkDeleteCallsBtn = event.target.closest('[id^="bulkDeleteCalls-"]');
      if (bulkDeleteCallsBtn && !bulkDeleteCallsBtn.disabled) {
        deleteSelectedCalls(bulkDeleteCallsBtn.id.replace('bulkDeleteCalls-', ''));
        return;
      }

      const callButton = event.target.closest('[data-delete-call]');
      if (callButton) {
        BremStorage.calls.removeById(callButton.dataset.deleteCall);
        selectedCallIds.delete(callButton.dataset.deleteCall);
        showToast('콜수 기록이 삭제되었습니다.');
        renderAll();
        return;
      }

      const rejectionButton = event.target.closest('[data-delete-rejection]');
      if (rejectionButton) {
        BremStorage.rejections.removeById(rejectionButton.dataset.deleteRejection);
        showToast('주간 기록이 삭제되었습니다.');
        renderAll();
      }

      const targetButton = event.target.closest('[data-delete-target]');
      if (targetButton) {
        BremStorage.targets.removeById(targetButton.dataset.deleteTarget);
        showToast('월간 목표가 삭제되었습니다.');
        renderAll();
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
        BremStorage.targets.upsertMonthly({
          driverId: target.driverId,
          month: target.month,
          count
        });
        showToast('월간 목표 콜수가 수정되었습니다.');
        renderAll();
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

        if (newWeekStart !== target.weekStart) {
          BremStorage.weeklyTargets.removeById(target.id);
        }
        BremStorage.weeklyTargets.upsert({
          driverId: target.driverId,
          weekStart: newWeekStart,
          count
        });
        showToast('주간 목표가 수정되었습니다.');
        renderAll();
        return;
      }

      const weeklyTargetButton = event.target.closest('[data-delete-weekly-target]');
      if (weeklyTargetButton) {
        BremStorage.weeklyTargets.removeById(weeklyTargetButton.dataset.deleteWeeklyTarget);
        showToast('주간 목표가 삭제되었습니다.');
        renderAll();
      }

      const eventItemButton = event.target.closest('[data-delete-event-item]');
      if (eventItemButton) {
        BremStorage.events.removeCatalogItemReferences(eventItemButton.dataset.deleteEventItem);
        showToast('장기근속이벤트 아이템이 삭제되었습니다.');
        renderAll();
      }

      const settlementButton = event.target.closest('[data-delete-settlement]');
      if (settlementButton) {
        BremStorage.settlements.removeById(settlementButton.dataset.deleteSettlement);
        showToast('정산 내역이 삭제되었습니다.');
        renderAll();
      }

      const unmatchedButton = event.target.closest('[data-delete-settlement-unmatched]');
      if (unmatchedButton) {
        BremStorage.settlementUnmatched.removeById(unmatchedButton.dataset.deleteSettlementUnmatched);
        showToast('미반영 기사 내역이 삭제되었습니다.');
        renderSettlements();
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
        BremStorage.notices.removeById(deleteNoticeButton.dataset.deleteNotice);
        showToast('공지사항이 삭제되었습니다.');
        renderAll();
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
    if ($('#adminDriverSearch')) $('#adminDriverSearch').value = '';
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

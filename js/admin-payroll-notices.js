(function () {
  const notices = BremStorage?.payrollNotices;
  const publish = BremStorage?.payrollPublish;
  const utils = window.BremPayrollSlipUtils;
  if (!notices || !publish) return;

  const $ = id => document.getElementById(id);

  const FORM_CONFIG = {
    default: {
      prefix: 'payrollNotice',
      scopeName: 'payrollNoticeScope',
      weekFieldId: 'payrollNoticeWeekField',
      listBodyId: 'payrollNoticeListBody'
    },
    menu: {
      prefix: 'menuPayrollNotice',
      scopeName: 'menuPayrollNoticeScope',
      weekFieldId: 'menuPayrollNoticeWeekField',
      listBodyId: 'menuPayrollNoticeListBody'
    }
  };

  const state = {
    subnav: 'upload',
    forms: {
      default: { editingNoticeId: '', noticeWeekStart: '' },
      menu: { editingNoticeId: '', noticeWeekStart: '' }
    }
  };

  const LABEL_TEXT = {
    urgent: '긴급',
    notice: '안내',
    announcement: '공지'
  };

  function showToast(message) {
    const toast = $('toast');
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

  function formatWeekLabel(weekStart) {
    if (!weekStart) return '상시 (쭉 노출)';
    if (utils?.formatSettlementWeekLabel) return utils.formatSettlementWeekLabel(weekStart);
    return weekStart;
  }

  function scopeLabel(notice) {
    return notice?.settlementWeekStart ? formatWeekLabel(notice.settlementWeekStart) : '상시 (쭉 노출)';
  }

  function getScope(formKey) {
    const config = FORM_CONFIG[formKey];
    const checked = document.querySelector(`input[name="${config.scopeName}"]:checked`);
    return checked?.value === 'weekly' ? 'weekly' : 'always';
  }

  function syncScopeUi(formKey) {
    const config = FORM_CONFIG[formKey];
    const weekField = $(config.weekFieldId);
    const isWeekly = getScope(formKey) === 'weekly';
    if (weekField) weekField.hidden = !isWeekly;
    if (!isWeekly) {
      handleNoticeWeekChange('', formKey);
    }
  }

  function setSubnav(tab) {
    state.subnav = tab === 'notices' ? 'notices' : 'upload';
    document.querySelectorAll('[data-payroll-subnav]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.payrollSubnav === state.subnav);
    });
    const uploadPanels = $('payrollUploadPanels');
    const noticesPanel = $('payrollNoticesPanel');
    if (uploadPanels) uploadPanels.hidden = state.subnav !== 'upload';
    if (noticesPanel) noticesPanel.hidden = state.subnav !== 'notices';
  }

  function resetNoticeForm(formKey = 'default') {
    const config = FORM_CONFIG[formKey];
    const prefix = config.prefix;
    state.forms[formKey].editingNoticeId = '';
    state.forms[formKey].noticeWeekStart = '';
    if ($(prefix + 'EditId')) $(prefix + 'EditId').value = '';
    $(prefix + 'Form')?.reset();
    const alwaysRadio = document.querySelector(`input[name="${config.scopeName}"][value="always"]`);
    if (alwaysRadio) alwaysRadio.checked = true;
    if ($(prefix + 'WeekStart')) $(prefix + 'WeekStart').value = '';
    if ($(prefix + 'WeekLabel')) $(prefix + 'WeekLabel').textContent = '정산주 미선택';
    if ($(prefix + 'WeekBtn')) $(prefix + 'WeekBtn').textContent = '정산주 선택';
    if ($(prefix + 'SaveBtn')) $(prefix + 'SaveBtn').textContent = '공지 저장';
    syncScopeUi(formKey);
  }

  function fillNoticeForm(notice, formKey = 'default') {
    if (!notice) return;
    const config = FORM_CONFIG[formKey];
    const prefix = config.prefix;
    state.forms[formKey].editingNoticeId = notice.id;
    state.forms[formKey].noticeWeekStart = notice.settlementWeekStart || '';
    if ($(prefix + 'EditId')) $(prefix + 'EditId').value = notice.id;
    if ($(prefix + 'Label')) $(prefix + 'Label').value = notice.label || 'notice';
    if ($(prefix + 'Title')) $(prefix + 'Title').value = notice.title || '';
    if ($(prefix + 'Body')) $(prefix + 'Body').value = notice.body || '';
    if ($(prefix + 'WeekStart')) $(prefix + 'WeekStart').value = notice.settlementWeekStart || '';
    const scopeValue = notice.settlementWeekStart ? 'weekly' : 'always';
    const scopeRadio = document.querySelector(`input[name="${config.scopeName}"][value="${scopeValue}"]`);
    if (scopeRadio) scopeRadio.checked = true;
    syncScopeUi(formKey);
    if ($(prefix + 'WeekLabel')) {
      $(prefix + 'WeekLabel').textContent = notice.settlementWeekStart
        ? formatWeekLabel(notice.settlementWeekStart)
        : '정산주 미선택';
    }
    if ($(prefix + 'WeekBtn')) {
      $(prefix + 'WeekBtn').textContent = notice.settlementWeekStart
        ? formatWeekLabel(notice.settlementWeekStart)
        : '정산주 선택';
    }
    if ($(prefix + 'SaveBtn')) $(prefix + 'SaveBtn').textContent = '공지 수정';
    if (formKey === 'default') setSubnav('notices');
    if (formKey === 'menu') setNoticeMenuTab('payroll');
  }

  function renderNoticeListFor(formKey = 'default') {
    const config = FORM_CONFIG[formKey];
    const body = $(config.listBodyId);
    if (!body) return;
    const list = notices.getAll().slice().sort((a, b) => {
      const sortDiff = Number(b.sortOrder || 0) - Number(a.sortOrder || 0);
      if (sortDiff) return sortDiff;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">등록된 정산 공지가 없습니다.</td></tr>';
      return;
    }
    body.innerHTML = list.map(notice => `
      <tr data-payroll-notice-id="${escapeHtml(notice.id)}" data-payroll-notice-form="${formKey}">
        <td><span class="payroll-notice-badge payroll-notice-badge--${escapeHtml(notice.label || 'notice')}">${escapeHtml(LABEL_TEXT[notice.label] || '안내')}</span></td>
        <td>${escapeHtml(notice.title || '-')}</td>
        <td>${escapeHtml(scopeLabel(notice))}</td>
        <td>${notice.riderPublishedAt ? '<span class="payroll-notice-published">반영됨</span>' : '<span class="payroll-notice-pending">미반영</span>'}</td>
        <td>${escapeHtml(formatDateTime(notice.updatedAt))}</td>
        <td class="table-actions">
          <button type="button" class="small-btn" data-payroll-notice-edit="${escapeHtml(notice.id)}" data-payroll-notice-form="${formKey}">수정</button>
          <button type="button" class="small-btn danger-btn" data-payroll-notice-delete="${escapeHtml(notice.id)}" data-payroll-notice-form="${formKey}">삭제</button>
        </td>
      </tr>
    `).join('');
  }

  function renderNoticeList() {
    renderNoticeListFor('default');
    renderNoticeListFor('menu');
  }

  async function saveNotice(event, formKey = 'default') {
    event?.preventDefault?.();
    const config = FORM_CONFIG[formKey];
    const prefix = config.prefix;
    const title = String($(prefix + 'Title')?.value || '').trim();
    const bodyText = String($(prefix + 'Body')?.value || '').trim();
    if (!title || !bodyText) {
      showToast('제목과 내용을 입력하세요.');
      return;
    }
    const scope = getScope(formKey);
    const weekStart = scope === 'weekly'
      ? (state.forms[formKey].noticeWeekStart || String($(prefix + 'WeekStart')?.value || '').slice(0, 10))
      : '';
    if (scope === 'weekly' && !weekStart) {
      showToast('주간 공지는 정산주를 선택하세요.');
      return;
    }
    const payload = {
      title,
      body: bodyText,
      label: String($(prefix + 'Label')?.value || 'notice').trim() || 'notice',
      settlementWeekStart: weekStart
    };
    try {
      if (state.forms[formKey].editingNoticeId) {
        await notices.update(state.forms[formKey].editingNoticeId, payload);
        showToast('정산 공지를 수정했습니다. 반영하기를 눌러 라이더에 공개하세요.');
      } else {
        await notices.create(payload);
        showToast('정산 공지를 저장했습니다. 반영하기를 눌러 라이더에 공개하세요.');
      }
      resetNoticeForm(formKey);
      renderNoticeList();
      window.BremAdminPayrollSlips?.refreshPublishStatus?.();
    } catch (error) {
      console.error('[payroll notice save]', error);
      showToast(error?.message || '공지 저장에 실패했습니다.');
    }
  }

  async function deleteNotice(id, formKey = 'default') {
    if (!id) return;
    if (!window.confirm('이 정산 공지를 삭제할까요?')) return;
    try {
      await notices.removeById(id);
      if (state.forms[formKey].editingNoticeId === id) resetNoticeForm(formKey);
      renderNoticeList();
      window.BremAdminPayrollSlips?.refreshPublishStatus?.();
      showToast('공지를 삭제했습니다.');
    } catch (error) {
      console.error('[payroll notice delete]', error);
      showToast(error?.message || '삭제에 실패했습니다.');
    }
  }

  function handleNoticeWeekChange(weekStart, formKey = 'default') {
    const config = FORM_CONFIG[formKey];
    const prefix = config.prefix;
    state.forms[formKey].noticeWeekStart = String(weekStart || '').slice(0, 10);
    if ($(prefix + 'WeekStart')) $(prefix + 'WeekStart').value = state.forms[formKey].noticeWeekStart;
    if ($(prefix + 'WeekLabel')) {
      $(prefix + 'WeekLabel').textContent = state.forms[formKey].noticeWeekStart
        ? formatWeekLabel(state.forms[formKey].noticeWeekStart)
        : '정산주 미선택';
    }
    if ($(prefix + 'WeekBtn')) {
      $(prefix + 'WeekBtn').textContent = state.forms[formKey].noticeWeekStart
        ? formatWeekLabel(state.forms[formKey].noticeWeekStart)
        : '정산주 선택';
    }
    if (state.forms[formKey].noticeWeekStart) {
      const weeklyRadio = document.querySelector(`input[name="${config.scopeName}"][value="weekly"]`);
      if (weeklyRadio) weeklyRadio.checked = true;
      syncScopeUi(formKey);
    }
  }

  function setNoticeMenuTab(tab) {
    const isPayroll = tab === 'payroll';
    document.querySelectorAll('[data-notice-menu-tab]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.noticeMenuTab === tab);
    });
    const generalPanel = $('noticeGeneralPanel');
    const payrollPanel = $('noticePayrollPanel');
    if (generalPanel) generalPanel.hidden = isPayroll;
    if (payrollPanel) payrollPanel.hidden = !isPayroll;
    if (isPayroll) renderNoticeListFor('menu');
  }

  function bindEvents() {
    document.querySelectorAll('[data-payroll-subnav]').forEach(btn => {
      btn.addEventListener('click', () => setSubnav(btn.dataset.payrollSubnav));
    });

    $('payrollNoticeForm')?.addEventListener('submit', event => { void saveNotice(event, 'default'); });
    $('payrollNoticeResetBtn')?.addEventListener('click', () => resetNoticeForm('default'));
    $('menuPayrollNoticeForm')?.addEventListener('submit', event => { void saveNotice(event, 'menu'); });
    $('menuPayrollNoticeResetBtn')?.addEventListener('click', () => resetNoticeForm('menu'));

    document.querySelectorAll('input[name="payrollNoticeScope"]').forEach(input => {
      input.addEventListener('change', () => syncScopeUi('default'));
    });
    document.querySelectorAll('input[name="menuPayrollNoticeScope"]').forEach(input => {
      input.addEventListener('change', () => syncScopeUi('menu'));
    });

    document.querySelectorAll('[data-notice-menu-tab]').forEach(btn => {
      btn.addEventListener('click', () => setNoticeMenuTab(btn.dataset.noticeMenuTab || 'general'));
    });

    document.addEventListener('click', event => {
      const editBtn = event.target.closest('[data-payroll-notice-edit]');
      if (editBtn) {
        const notice = notices.getAll().find(item => item.id === editBtn.dataset.payrollNoticeEdit);
        fillNoticeForm(notice, editBtn.dataset.payrollNoticeForm || 'default');
        return;
      }
      const deleteBtn = event.target.closest('[data-payroll-notice-delete]');
      if (deleteBtn) {
        void deleteNotice(deleteBtn.dataset.payrollNoticeDelete, deleteBtn.dataset.payrollNoticeForm || 'default');
      }
    });
  }

  async function refresh() {
    renderNoticeList();
    syncScopeUi('default');
    syncScopeUi('menu');
  }

  bindEvents();
  void refresh();

  window.BremAdminPayrollNotices = {
    refresh,
    setNoticeMenuTab,
    handleNoticeWeekChange,
    resetNoticeWeek() {
      handleNoticeWeekChange('', 'default');
    },
    handleMenuNoticeWeekChange(weekStart) {
      handleNoticeWeekChange(weekStart, 'menu');
    }
  };
})();

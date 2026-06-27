(function () {
  const notices = BremStorage?.payrollNotices;
  const publish = BremStorage?.payrollPublish;
  const utils = window.BremPayrollSlipUtils;
  if (!notices || !publish) return;

  const $ = id => document.getElementById(id);

  const state = {
    subnav: 'upload',
    editingNoticeId: '',
    noticeWeekStart: ''
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
    if (!weekStart) return '전체 정산주';
    if (utils?.formatSettlementWeekLabel) return utils.formatSettlementWeekLabel(weekStart);
    return weekStart;
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

  function resetNoticeForm() {
    state.editingNoticeId = '';
    state.noticeWeekStart = '';
    if ($('payrollNoticeEditId')) $('payrollNoticeEditId').value = '';
    $('payrollNoticeForm')?.reset();
    if ($('payrollNoticeWeekStart')) $('payrollNoticeWeekStart').value = '';
    if ($('payrollNoticeWeekLabel')) $('payrollNoticeWeekLabel').textContent = '전체 정산주';
    if ($('payrollNoticeWeekBtn')) $('payrollNoticeWeekBtn').textContent = '전체 (정산주 미지정)';
    if ($('payrollNoticeSaveBtn')) $('payrollNoticeSaveBtn').textContent = '공지 저장';
  }

  function fillNoticeForm(notice) {
    if (!notice) return;
    state.editingNoticeId = notice.id;
    state.noticeWeekStart = notice.settlementWeekStart || '';
    if ($('payrollNoticeEditId')) $('payrollNoticeEditId').value = notice.id;
    if ($('payrollNoticeLabel')) $('payrollNoticeLabel').value = notice.label || 'notice';
    if ($('payrollNoticeTitle')) $('payrollNoticeTitle').value = notice.title || '';
    if ($('payrollNoticeBody')) $('payrollNoticeBody').value = notice.body || '';
    if ($('payrollNoticeWeekStart')) $('payrollNoticeWeekStart').value = notice.settlementWeekStart || '';
    if ($('payrollNoticeWeekLabel')) {
      $('payrollNoticeWeekLabel').textContent = formatWeekLabel(notice.settlementWeekStart);
    }
    if ($('payrollNoticeWeekBtn')) {
      $('payrollNoticeWeekBtn').textContent = notice.settlementWeekStart
        ? formatWeekLabel(notice.settlementWeekStart)
        : '전체 (정산주 미지정)';
    }
    if ($('payrollNoticeSaveBtn')) $('payrollNoticeSaveBtn').textContent = '공지 수정';
    setSubnav('notices');
  }

  function renderNoticeList() {
    const body = $('payrollNoticeListBody');
    if (!body) return;
    const list = notices.getAll().slice().sort((a, b) => {
      const sortDiff = Number(b.sortOrder || 0) - Number(a.sortOrder || 0);
      if (sortDiff) return sortDiff;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">등록된 급여관련공지가 없습니다.</td></tr>';
      return;
    }
    body.innerHTML = list.map(notice => `
      <tr data-payroll-notice-id="${escapeHtml(notice.id)}">
        <td><span class="payroll-notice-badge payroll-notice-badge--${escapeHtml(notice.label || 'notice')}">${escapeHtml(LABEL_TEXT[notice.label] || '안내')}</span></td>
        <td>${escapeHtml(notice.title || '-')}</td>
        <td>${escapeHtml(formatWeekLabel(notice.settlementWeekStart))}</td>
        <td>${notice.riderPublishedAt ? '<span class="payroll-notice-published">반영됨</span>' : '<span class="payroll-notice-pending">미반영</span>'}</td>
        <td>${escapeHtml(formatDateTime(notice.updatedAt))}</td>
        <td class="table-actions">
          <button type="button" class="small-btn" data-payroll-notice-edit="${escapeHtml(notice.id)}">수정</button>
          <button type="button" class="small-btn danger-btn" data-payroll-notice-delete="${escapeHtml(notice.id)}">삭제</button>
        </td>
      </tr>
    `).join('');
  }

  async function saveNotice(event) {
    event?.preventDefault?.();
    const title = String($('payrollNoticeTitle')?.value || '').trim();
    const bodyText = String($('payrollNoticeBody')?.value || '').trim();
    if (!title || !bodyText) {
      showToast('제목과 내용을 입력하세요.');
      return;
    }
    const payload = {
      title,
      body: bodyText,
      label: String($('payrollNoticeLabel')?.value || 'notice').trim() || 'notice',
      settlementWeekStart: state.noticeWeekStart || String($('payrollNoticeWeekStart')?.value || '').slice(0, 10)
    };
    try {
      if (state.editingNoticeId) {
        await notices.update(state.editingNoticeId, payload);
        showToast('급여관련공지를 수정했습니다. 반영하기를 눌러 라이더에 공개하세요.');
      } else {
        await notices.create(payload);
        showToast('급여관련공지를 저장했습니다. 반영하기를 눌러 라이더에 공개하세요.');
      }
      resetNoticeForm();
      renderNoticeList();
      window.BremAdminPayrollSlips?.refreshPublishStatus?.();
    } catch (error) {
      console.error('[payroll notice save]', error);
      showToast(error?.message || '공지 저장에 실패했습니다.');
    }
  }

  async function deleteNotice(id) {
    if (!id) return;
    if (!window.confirm('이 급여관련공지를 삭제할까요?')) return;
    try {
      await notices.removeById(id);
      if (state.editingNoticeId === id) resetNoticeForm();
      renderNoticeList();
      window.BremAdminPayrollSlips?.refreshPublishStatus?.();
      showToast('공지를 삭제했습니다.');
    } catch (error) {
      console.error('[payroll notice delete]', error);
      showToast(error?.message || '삭제에 실패했습니다.');
    }
  }

  function handleNoticeWeekChange(weekStart) {
    state.noticeWeekStart = String(weekStart || '').slice(0, 10);
    if ($('payrollNoticeWeekStart')) $('payrollNoticeWeekStart').value = state.noticeWeekStart;
    if ($('payrollNoticeWeekLabel')) {
      $('payrollNoticeWeekLabel').textContent = state.noticeWeekStart
        ? formatWeekLabel(state.noticeWeekStart)
        : '전체 정산주';
    }
    if ($('payrollNoticeWeekBtn')) {
      $('payrollNoticeWeekBtn').textContent = state.noticeWeekStart
        ? formatWeekLabel(state.noticeWeekStart)
        : '전체 (정산주 미지정)';
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-payroll-subnav]').forEach(btn => {
      btn.addEventListener('click', () => setSubnav(btn.dataset.payrollSubnav));
    });
    $('payrollNoticeForm')?.addEventListener('submit', event => { void saveNotice(event); });
    $('payrollNoticeResetBtn')?.addEventListener('click', resetNoticeForm);
    $('payrollNoticeListBody')?.addEventListener('click', event => {
      const editBtn = event.target.closest('[data-payroll-notice-edit]');
      if (editBtn) {
        const notice = notices.getAll().find(item => item.id === editBtn.dataset.payrollNoticeEdit);
        fillNoticeForm(notice);
        return;
      }
      const deleteBtn = event.target.closest('[data-payroll-notice-delete]');
      if (deleteBtn) void deleteNotice(deleteBtn.dataset.payrollNoticeDelete);
    });
  }

  async function refresh() {
    renderNoticeList();
  }

  bindEvents();
  void refresh();

  window.BremAdminPayrollNotices = {
    refresh,
    handleNoticeWeekChange,
    resetNoticeWeek() {
      handleNoticeWeekChange('');
    }
  };
})();

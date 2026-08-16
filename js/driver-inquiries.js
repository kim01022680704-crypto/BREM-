(function () {
  const popup = document.getElementById('driverInquiryPopup');
  const openBtn = document.getElementById('driverAdminInquiryBtn');
  const titleEl = document.getElementById('driverInquiryPopupTitle');
  const hintEl = document.getElementById('driverInquiryPopupHint');
  const formEl = document.getElementById('driverInquiryForm');
  const messageEl = document.getElementById('driverInquiryMessage');
  const submitBtn = document.getElementById('driverInquirySubmitBtn');
  const listEl = document.getElementById('driverInquiryHistory');
  if (!popup) return;

  const state = {
    open: false,
    source: 'app',
    inquiries: []
  };

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast || !message) return;
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

  function statusLabel(status) {
    if (status === 'done') return '처리완료';
    if (status === 'read') return '확인중';
    return '미확인';
  }

  function statusClass(status) {
    if (status === 'done') return 'is-done';
    if (status === 'read') return 'is-read';
    return 'is-new';
  }

  function formatWhen(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.getMonth() + 1}.${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function renderHistory() {
    if (!listEl) return;
    const rows = state.inquiries || [];
    if (!rows.length) {
      listEl.innerHTML = '<p class="driver-inquiry-empty">최근 2주 문의 내역이 없습니다.</p>';
      return;
    }
    listEl.innerHTML = rows.map(item => `
      <article class="driver-inquiry-item">
        <div class="driver-inquiry-item__head">
          <span class="driver-inquiry-status ${statusClass(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
          <strong>${escapeHtml(item.inquiryType || '문의')}</strong>
          <time>${escapeHtml(formatWhen(item.createdAt))}</time>
        </div>
        <p>${escapeHtml(item.message || '')}</p>
      </article>
    `).join('');
  }

  function applyMode(source) {
    state.source = source === 'payslip' ? 'payslip' : 'app';
    if (titleEl) titleEl.textContent = state.source === 'payslip' ? '주급명세서 문의' : '관리자 문의하기';
    if (hintEl) {
      hintEl.textContent = state.source === 'payslip'
        ? '사유를 적으면 쿠팡·배민 주급명세서가 관리자에게 함께 전달됩니다. 문의는 2주 후 삭제됩니다.'
        : '문의 내용을 남기면 관리자 「라이더 문의」에서 확인합니다. 문의는 2주 후 삭제됩니다.';
    }
    if (messageEl) {
      messageEl.placeholder = state.source === 'payslip'
        ? '문의 사유를 입력하세요'
        : '문의 내용을 입력하세요';
    }
    if (formEl) formEl.reset();
  }

  async function loadHistory() {
    if (!window.BremStorage?.fetchRiderInquiriesFromServer) return;
    const result = await window.BremStorage.fetchRiderInquiriesFromServer();
    if (!result?.ok) {
      if (state.open) showToast(result?.message || '문의 내역을 불러오지 못했습니다.');
      return;
    }
    state.inquiries = result.inquiries || [];
    renderHistory();
  }

  async function submit(event) {
    event?.preventDefault?.();
    const message = String(messageEl?.value || '').trim();
    if (!message) {
      showToast(state.source === 'payslip' ? '문의 사유를 입력하세요.' : '문의 내용을 입력하세요.');
      return;
    }
    const payload = {
      source: state.source,
      message
    };
    if (state.source === 'payslip') {
      const snapshot = window.BremDriverWeeklyPayslip?.getInquirySnapshot?.();
      if (!snapshot) {
        showToast('주급명세서가 없어 문의할 수 없습니다.');
        return;
      }
      payload.payslipSnapshot = snapshot;
      payload.weekStart = snapshot.weekStart || '';
    }
    if (submitBtn) submitBtn.disabled = true;
    try {
      const result = await window.BremStorage.submitRiderInquiryToServer(payload);
      if (!result?.ok) {
        showToast(result?.message || result?.error || '문의 접수에 실패했습니다.');
        return;
      }
      showToast('문의가 접수되었습니다.');
      if (formEl) formEl.reset();
      await loadHistory();
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function open(source = 'app') {
    applyMode(source);
    state.open = true;
    popup.hidden = false;
    openBtn?.setAttribute('aria-expanded', 'true');
    renderHistory();
    void loadHistory();
  }

  function close() {
    state.open = false;
    popup.hidden = true;
    openBtn?.setAttribute('aria-expanded', 'false');
  }

  openBtn?.addEventListener('click', () => {
    if (state.open && state.source === 'app') {
      close();
      return;
    }
    open('app');
  });

  popup.addEventListener('click', (event) => {
    if (event.target.closest('[data-inquiry-dismiss]')) close();
  });

  formEl?.addEventListener('submit', submit);

  window.BremDriverInquiries = {
    open,
    close,
    reset() {
      state.inquiries = [];
      renderHistory();
      close();
    }
  };
})();

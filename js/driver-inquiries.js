(function () {
  const popup = document.getElementById('driverInquiryPopup');
  const openBtn = document.getElementById('driverAdminInquiryBtn');
  const titleEl = document.getElementById('driverInquiryPopupTitle');
  const hintEl = document.getElementById('driverInquiryPopupHint');
  const formEl = document.getElementById('driverInquiryForm');
  const messageEl = document.getElementById('driverInquiryMessage');
  const submitBtn = document.getElementById('driverInquirySubmitBtn');
  const listEl = document.getElementById('driverInquiryHistory');
  const alertPopup = document.getElementById('driverInquiryAlertPopup');
  const alertTitle = document.getElementById('driverInquiryAlertTitle');
  if (!popup) return;

  const HINT_APP = '문의내용 남기면 확인후 차례대로 답변이나 전화드리겠습니다.\n확인할경우 확인중이라고 테그가 바뀝니다.';
  const ALERT_KEY = 'brem_rider_inquiry_alerts';

  const state = {
    open: false,
    source: 'app',
    inquiries: [],
    pollTimer: null,
    watchTimer: null,
    watchSeeded: false,
    alertQueue: []
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

  function statusLabel(item) {
    if (item.status === 'done') return '처리완료';
    if (item.riderAckAt) return '확인완료';
    if (item.adminReply) return '답장도착';
    if (item.status === 'read') return '확인중';
    return '미확인';
  }

  function statusClass(item) {
    if (item.status === 'done') return 'is-done';
    if (item.riderAckAt) return 'is-ack';
    if (item.adminReply) return 'is-reply';
    if (item.status === 'read') return 'is-read';
    return 'is-new';
  }

  function formatWhen(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.getMonth() + 1}.${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function readAlertSeen() {
    try {
      const parsed = JSON.parse(localStorage.getItem(ALERT_KEY) || '{}');
      return {
        read: new Set(Array.isArray(parsed.read) ? parsed.read.map(String) : []),
        reply: new Set(Array.isArray(parsed.reply) ? parsed.reply.map(String) : [])
      };
    } catch {
      return { read: new Set(), reply: new Set() };
    }
  }

  function writeAlertSeen(seen) {
    try {
      localStorage.setItem(ALERT_KEY, JSON.stringify({
        read: [...seen.read],
        reply: [...seen.reply]
      }));
    } catch {
      /* ignore */
    }
  }

  function replyKey(item) {
    return `${item.id}:${String(item.adminReply || '')}:${String(item.adminRepliedAt || '')}`;
  }

  function collectAlerts(list, announce) {
    const seen = readAlertSeen();
    const alerts = [];
    (list || []).forEach(item => {
      const id = String(item.id || '');
      if (!id) return;
      const hasReply = Boolean(item.adminReply);
      if (hasReply) {
        const key = replyKey(item);
        if (!seen.reply.has(key)) {
          if (announce) alerts.push({ kind: 'reply', id });
          seen.reply.add(key);
        }
      }
      if (item.status === 'read' || item.status === 'done' || hasReply) {
        if (!seen.read.has(id)) {
          if (announce && !hasReply && item.status === 'read') {
            alerts.push({ kind: 'read', id });
          }
          seen.read.add(id);
        }
      }
    });
    writeAlertSeen(seen);
    return alerts;
  }

  function closeInquiryAlert() {
    if (alertPopup) alertPopup.hidden = true;
  }

  function showNextInquiryAlert() {
    if (!alertPopup || !alertTitle) return;
    if (!alertPopup.hidden) return;
    const next = state.alertQueue.shift();
    if (!next) return;
    alertTitle.textContent = next.kind === 'reply' ? '답변이왓습니다.' : '문의 확인중입니다.';
    alertPopup.hidden = false;
  }

  function queueInquiryAlerts(alerts) {
    if (!alerts.length) return;
    state.alertQueue.push(...alerts);
    showNextInquiryAlert();
  }

  function renderHistory() {
    if (!listEl) return;
    const rows = state.inquiries || [];
    if (!rows.length) {
      listEl.innerHTML = '<p class="driver-inquiry-empty">최근 2주 문의 내역이 없습니다.</p>';
      return;
    }
    listEl.innerHTML = rows.map(item => {
      const canAck = !item.riderAckAt && item.status !== 'done';
      return `
      <article class="driver-inquiry-item">
        <div class="driver-inquiry-item__head">
          <span class="driver-inquiry-status ${statusClass(item)}">${escapeHtml(statusLabel(item))}</span>
          <strong>${escapeHtml(item.inquiryType || '문의')}</strong>
          <time>${escapeHtml(formatWhen(item.createdAt))}</time>
        </div>
        <p>${escapeHtml(item.message || '')}</p>
        ${item.adminReply ? `
          <div class="driver-inquiry-reply">
            <strong>관리자 답장</strong>
            <p>${escapeHtml(item.adminReply)}</p>
          </div>
        ` : ''}
        ${item.riderAckAt
          ? `<p class="driver-inquiry-ack-done">확인완료 · ${escapeHtml(formatWhen(item.riderAckAt))}</p>`
          : ''}
        ${canAck
          ? `<button type="button" class="driver-inquiry-ack-btn" data-ack-inquiry="${escapeHtml(item.id)}">확인완료</button>`
          : ''}
      </article>
    `;
    }).join('');
  }

  function applyMode(source) {
    state.source = source === 'payslip' ? 'payslip' : 'app';
    if (titleEl) titleEl.textContent = state.source === 'payslip' ? '주급명세서 문의' : '관리자 문의하기';
    if (hintEl) {
      hintEl.textContent = state.source === 'payslip'
        ? '사유를 적으면 쿠팡·배민 주급명세서가 관리자에게 함께 전달됩니다. 문의는 2주 후 삭제됩니다.'
        : HINT_APP;
    }
    if (messageEl) {
      messageEl.placeholder = state.source === 'payslip'
        ? '문의 사유를 입력하세요'
        : '문의 내용을 입력하세요';
    }
    if (formEl) formEl.reset();
  }

  async function syncInquiries({ announce = false, toastOnError = false } = {}) {
    if (!window.BremStorage?.fetchRiderInquiriesFromServer) return;
    const result = await window.BremStorage.fetchRiderInquiriesFromServer();
    if (!result?.ok) {
      if (toastOnError) showToast(result?.message || '문의 내역을 불러오지 못했습니다.');
      return;
    }
    state.inquiries = result.inquiries || [];
    if (state.open) renderHistory();
    const shouldAnnounce = announce && state.watchSeeded;
    const alerts = collectAlerts(state.inquiries, shouldAnnounce);
    if (!state.watchSeeded) state.watchSeeded = true;
    if (shouldAnnounce) queueInquiryAlerts(alerts);
  }

  async function loadHistory() {
    await syncInquiries({ announce: true, toastOnError: state.open });
  }

  async function ackInquiry(inquiryId) {
    if (!inquiryId || !window.BremStorage?.ackRiderInquiryOnServer) return;
    const result = await window.BremStorage.ackRiderInquiryOnServer(inquiryId);
    if (!result?.ok) {
      showToast(result?.message || result?.error || '확인 처리에 실패했습니다.');
      return;
    }
    state.inquiries = result.inquiries || state.inquiries;
    renderHistory();
    showToast('확인완료 했습니다.');
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

  function stopPoll() {
    if (state.pollTimer) {
      window.clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function startPoll() {
    stopPoll();
    state.pollTimer = window.setInterval(() => {
      if (state.open) void loadHistory();
    }, 20000);
  }

  function stopWatch() {
    if (state.watchTimer) {
      window.clearInterval(state.watchTimer);
      state.watchTimer = null;
    }
  }

  function startWatch() {
    if (state.watchTimer) return;
    void syncInquiries({ announce: false }).then(() => {
      state.watchTimer = window.setInterval(() => {
        void syncInquiries({ announce: true });
      }, 15000);
    });
  }

  function open(source = 'app') {
    applyMode(source);
    state.open = true;
    popup.hidden = false;
    openBtn?.setAttribute('aria-expanded', 'true');
    renderHistory();
    void loadHistory();
    startPoll();
  }

  function close() {
    state.open = false;
    popup.hidden = true;
    openBtn?.setAttribute('aria-expanded', 'false');
    stopPoll();
  }

  openBtn?.addEventListener('click', () => {
    if (state.open && state.source === 'app') {
      close();
      return;
    }
    open('app');
  });

  popup.addEventListener('click', (event) => {
    if (event.target.closest('[data-inquiry-dismiss]')) {
      close();
      return;
    }
    const ackBtn = event.target.closest('[data-ack-inquiry]');
    if (ackBtn) {
      ackBtn.disabled = true;
      void ackInquiry(ackBtn.dataset.ackInquiry).finally(() => {
        ackBtn.disabled = false;
      });
    }
  });

  alertPopup?.addEventListener('click', (event) => {
    if (event.target.closest('#driverInquiryAlertOpenBtn')) {
      closeInquiryAlert();
      open('app');
      showNextInquiryAlert();
      return;
    }
    if (event.target.closest('[data-inquiry-alert-close]')) {
      closeInquiryAlert();
      showNextInquiryAlert();
    }
  });

  formEl?.addEventListener('submit', submit);

  window.BremDriverInquiries = {
    open,
    close,
    startWatch,
    reset() {
      stopWatch();
      stopPoll();
      state.inquiries = [];
      state.watchSeeded = false;
      state.alertQueue = [];
      closeInquiryAlert();
      renderHistory();
      close();
    }
  };
})();

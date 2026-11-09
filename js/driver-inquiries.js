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
  const ALERT_AT_KEY = 'brem_rider_inquiry_alert_at';
  const ALERT_WINDOW_MS = 15 * 60 * 1000;
  const ALERT_KEEP = 300;

  const state = {
    open: false,
    source: 'app',
    inquiries: [],
    pollTimer: null,
    watchTimer: null,
    watchSeeded: false,
    alertQueue: [],
    viewAckIds: new Set(),
    viewAckRunning: false
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

  function replySeen(item) {
    if (!item?.adminReply || !item?.riderAckAt) return false;
    const ack = Date.parse(item.riderAckAt);
    if (!Number.isFinite(ack)) return false;
    const replied = Date.parse(item.adminRepliedAt || '');
    if (!Number.isFinite(replied)) return true;
    return ack >= replied - 2000;
  }

  function statusLabel(item) {
    if (item.status === 'done') return '처리완료';
    if (replySeen(item)) return '답장확인';
    if (item.adminReply) return '답장도착';
    if (item.status === 'read') return '확인중';
    return '미확인';
  }

  function statusClass(item) {
    if (item.status === 'done') return 'is-done';
    if (replySeen(item)) return 'is-ack';
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
        read: [...seen.read].slice(-ALERT_KEEP),
        reply: [...seen.reply].slice(-ALERT_KEEP)
      }));
    } catch {
      /* ignore */
    }
  }

  function replyToken(item) {
    return `${item.id}|${item.adminRepliedAt || 'reply'}`;
  }

  function readAlertSince() {
    try {
      return Number(localStorage.getItem(ALERT_AT_KEY) || 0) || 0;
    } catch {
      return 0;
    }
  }

  function writeAlertSince(now) {
    try {
      localStorage.setItem(ALERT_AT_KEY, String(now));
    } catch {
      /* ignore */
    }
  }

  function isRecentAlert(timestamp, since, now) {
    if (!timestamp) return false;
    if (now - timestamp <= ALERT_WINDOW_MS) return true;
    return Boolean(since && timestamp + 2000 >= since);
  }

  function collectAlerts(list, announce) {
    const seen = readAlertSeen();
    const now = Date.now();
    const since = readAlertSince();
    const alerts = [];
    (list || []).forEach(item => {
      const id = String(item.id || '');
      if (!id) return;
      const reply = String(item.adminReply || '').trim();
      const handled = item.status === 'done' || replySeen(item);
      if (handled) {
        seen.read.add(id);
        if (reply) seen.reply.add(replyToken(item));
        return;
      }
      if (reply) {
        const token = replyToken(item);
        if (seen.reply.has(token)) {
          seen.read.add(id);
          return;
        }
        const repliedAt = Date.parse(item.adminRepliedAt || item.updatedAt || '') || 0;
        const recent = isRecentAlert(repliedAt, since, now);
        if (announce && recent) alerts.push({ kind: 'reply', id, at: repliedAt });
        if (!recent || announce) seen.reply.add(token);
        seen.read.add(id);
        return;
      }
      if (item.status === 'read' && !seen.read.has(id)) {
        const updated = Date.parse(item.updatedAt || '') || 0;
        const recent = isRecentAlert(updated, since, now);
        if (announce && recent) alerts.push({ kind: 'read', id, at: updated });
        if (!recent || announce) seen.read.add(id);
      }
    });
    writeAlertSeen(seen);
    if (announce) writeAlertSince(now);
    alerts.sort((a, b) => b.at - a.at);
    return alerts.slice(0, 3);
  }

  function showMotion(popupEl) {
    if (!popupEl) return;
    popupEl.classList.add('is-motion');
    const token = String(Date.now());
    popupEl.dataset.motionToken = token;
    popupEl.hidden = false;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (popupEl.dataset.motionToken === token) popupEl.classList.add('is-open');
      });
    });
  }

  function hideMotion(popupEl) {
    if (!popupEl) return;
    const token = String(Date.now());
    popupEl.dataset.motionToken = token;
    popupEl.classList.remove('is-open');
    window.setTimeout(() => {
      if (popupEl.dataset.motionToken === token) popupEl.hidden = true;
    }, 180);
  }

  function closeInquiryAlert() {
    hideMotion(alertPopup);
  }

  function showNextInquiryAlert() {
    if (!alertPopup || !alertTitle) return;
    if (!alertPopup.hidden) return;
    const next = state.alertQueue.shift();
    if (!next) return;
    alertTitle.textContent = next.kind === 'reply' ? '답변이왓습니다.' : '문의 확인중입니다.';
    showMotion(alertPopup);
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
    listEl.innerHTML = rows.map(item => `
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
        ${replySeen(item)
          ? `<p class="driver-inquiry-ack-done">답장확인 · ${escapeHtml(formatWhen(item.riderAckAt))}</p>`
          : ''}
      </article>
    `).join('');
    if (state.open) markViewedReplies();
  }

  function markViewedReplies() {
    if (!state.open || state.viewAckRunning || !window.BremStorage?.ackRiderInquiryOnServer) return;
    const pending = (state.inquiries || []).filter(item => (
      item?.id && item.adminReply && !replySeen(item) && !state.viewAckIds.has(String(item.id))
    ));
    if (!pending.length) return;
    state.viewAckRunning = true;
    pending.forEach(item => state.viewAckIds.add(String(item.id)));
    void (async () => {
      let changed = false;
      try {
        for (const item of pending) {
          if (!state.open) return;
          const result = await window.BremStorage.ackRiderInquiryOnServer(item.id);
          if (result?.ok && Array.isArray(result.inquiries)) {
            state.inquiries = result.inquiries;
            changed = true;
          }
        }
      } finally {
        pending.forEach(item => state.viewAckIds.delete(String(item.id)));
        state.viewAckRunning = false;
        if (changed && state.open) renderHistory();
      }
    })();
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
    if (state.syncing) return;
    state.syncing = true;
    let result;
    let unchanged = false;
    try {
      const rev = await window.BremStorage.fetchRiderInquiryRevision?.();
      const revision = String(rev?.revision || '');
      if (rev?.ok && revision && state.revision && revision === state.revision) {
        unchanged = true;
      } else {
        result = await window.BremStorage.fetchRiderInquiriesFromServer();
        if (result?.ok && revision) state.revision = revision;
      }
    } finally {
      state.syncing = false;
    }
    if (unchanged) {
      const shouldAnnounce = announce && state.watchSeeded;
      const alerts = collectAlerts(state.inquiries, shouldAnnounce);
      if (!state.watchSeeded) state.watchSeeded = true;
      if (shouldAnnounce) queueInquiryAlerts(alerts);
      return;
    }
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
    showToast('답장확인 했습니다.');
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
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '보내는 중…';
    }
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
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '문의하기';
      }
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
    if (state.watchTimer || state.watchStarting) return;
    state.pollTimer = window.setInterval(() => {
      if (state.open) void syncInquiries({ announce: false, toastOnError: false });
    }, 15000);
  }

  function stopWatch() {
    state.watchGeneration = (state.watchGeneration || 0) + 1;
    state.watchStarting = false;
    if (state.watchTimer) {
      window.clearInterval(state.watchTimer);
      state.watchTimer = null;
    }
  }

  function startWatch() {
    if (state.watchTimer || state.watchStarting) return;
    if (!state.watchVisibilityBound) {
      state.watchVisibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void syncInquiries({ announce: false });
      });
    }
    state.watchStarting = true;
    const generation = (state.watchGeneration || 0) + 1;
    state.watchGeneration = generation;
    void syncInquiries({ announce: false }).then(() => {
      if (state.watchGeneration !== generation) return null;
      return syncInquiries({ announce: true });
    }).then(() => {
      if (state.watchGeneration !== generation || state.watchTimer) return;
      state.watchTimer = window.setInterval(() => {
        void syncInquiries({ announce: true });
      }, 15000);
    }).finally(() => {
      if (state.watchGeneration === generation) state.watchStarting = false;
    });
  }

  function open(source = 'app') {
    applyMode(source);
    state.open = true;
    showMotion(popup);
    openBtn?.setAttribute('aria-expanded', 'true');
    renderHistory();
    void loadHistory();
    startPoll();
  }

  function close() {
    state.open = false;
    hideMotion(popup);
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
      if (ackBtn.disabled) return;
      ackBtn.disabled = true;
      ackBtn.textContent = '확인 중…';
      void ackInquiry(ackBtn.dataset.ackInquiry).finally(() => {
        if (ackBtn.isConnected) {
          ackBtn.disabled = false;
          ackBtn.textContent = '답장확인';
        }
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

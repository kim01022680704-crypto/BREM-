(function () {
  const TAB_META = {
    home: { title: '대시보드', desc: '오늘 일정과 미확인 문의를 봅니다.' },
    schedule: { title: '스케줄', desc: '관리자 스케줄표를 등록·수정합니다.' },
    payslip: { title: '명세서', desc: '등록된 주급명세서를 검색합니다.' },
    inquiry: { title: '문의', desc: '라이더 문의를 확인하고 답장합니다.' },
    request: { title: '업무', desc: '업무 요청을 등록하고 승인 상태를 봅니다.' }
  };
  const TAB_MENUS = {
    home: 'dashboard',
    schedule: 'admin-schedule',
    request: 'work-requests',
    payslip: 'payroll-slip-search',
    inquiry: 'rider-inquiries'
  };

  const loginPage = document.getElementById('adminLoginPage');
  const appEl = document.getElementById('adminApp');
  const toastEl = document.getElementById('toast');
  const nav = document.getElementById('adminAppNav');
  let currentTab = 'home';
  let inquiryWatchTimer = 0;
  let lastAlertInquiryId = '';

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message) {
    if (!toastEl || !message) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function allowedMenus() {
    return window.BremStorage?.auth?.getAdminSessionMenus?.() || [];
  }

  function canOpenTab(tab) {
    const menu = TAB_MENUS[tab];
    const menus = allowedMenus();
    if (!menus.length) return true;
    return menus.includes(menu);
  }

  function applyTabPermissions() {
    if (!nav) return;
    nav.querySelectorAll('[data-admin-app-tab]').forEach(button => {
      const tab = button.dataset.adminAppTab;
      button.hidden = !canOpenTab(tab);
    });
  }

  function setTab(tab) {
    const next = canOpenTab(tab) ? tab : (['home', 'schedule', 'request', 'payslip', 'inquiry'].find(canOpenTab) || 'home');
    currentTab = next;
    document.documentElement.dataset.adminAppTab = next;
    document.querySelectorAll('[data-admin-app-panel]').forEach(panel => {
      const on = panel.dataset.adminAppPanel === next;
      panel.classList.toggle('is-active', on);
      panel.hidden = !on;
      if (panel.id === 'dashboard') panel.classList.toggle('active', on);
    });
    nav?.querySelectorAll('[data-admin-app-tab]').forEach(button => {
      const on = button.dataset.adminAppTab === next;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-current', on ? 'page' : 'false');
    });
    const meta = TAB_META[next] || TAB_META.home;
    if ($('adminAppTitle')) $('adminAppTitle').textContent = meta.title;
    if ($('adminAppHeroDesc')) $('adminAppHeroDesc').textContent = meta.desc;
    if (next === 'home') {
      void refreshHome();
      window.BremBaeminDeliveryStatusAdmin?.refreshDashboardBaeminLive?.();
      window.BremCoupangStatusAdmin?.refreshDashboardCard?.();
    }
    if (next === 'schedule') window.BremAdminSchedule?.refresh?.();
    if (next === 'request') void window.BremAdminWorkRequests?.reload?.();
    if (next === 'payslip') window.BremAdminPayrollSlipSearch?.refresh?.();
    if (next === 'inquiry') void renderInquiries();
  }

  function hideBootSplash() {
    const splash = $('adminAppBootSplash');
    if (splash) splash.hidden = true;
  }

  function showApp() {
    loginPage?.classList.add('app-hidden');
    if (loginPage) loginPage.hidden = true;
    if (appEl) appEl.hidden = false;
    applyTabPermissions();
    setTab(currentTab);
    startInquiryWatch();
    void window.BremAdminWorkRequests?.refreshBadge?.();
  }

  function showLogin() {
    if (appEl) appEl.hidden = true;
    if (loginPage) {
      loginPage.hidden = false;
      loginPage.classList.remove('app-hidden');
    }
  }

  function todayKey() {
    const date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekLabel() {
    const utils = window.BremPayrollSlipUtils;
    const week = utils?.normalizeSettlementWeekStart?.('') || todayKey();
    return utils?.formatSettlementWeekLabel?.(week) || week;
  }

  async function loadInquiries() {
    if (window.BremRiderInquiryApi?.ready) await window.BremRiderInquiryApi.ready;
    if (window.BremRiderInquiryApi?.list) {
      try {
        return await window.BremRiderInquiryApi.list();
      } catch {
        /* fall through */
      }
    }
    return window.BremStorage?.riderInquiries?.getAll?.() || [];
  }

  function inquiryStatusLabel(inquiry) {
    return window.BremRiderInquiryApi?.statusLabel?.(inquiry) || '미확인';
  }

  function inquiryStatusClass(inquiry) {
    return window.BremRiderInquiryApi?.statusClass?.(inquiry) || 'inquiry-badge inquiry-badge--new';
  }

  function formatDateTime(value) {
    const text = String(value || '');
    if (!text) return '-';
    return text.replace('T', ' ').slice(0, 16);
  }

  function updateInquiryBadge(count) {
    const badge = $('adminAppInquiryBadge');
    if (!badge) return;
    badge.hidden = count <= 0;
    badge.textContent = count > 99 ? '99+' : String(count);
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
  }

  function payslipCard(title, bucket = {}) {
    const row = (label, amount, kind) => (
      `<p class="${kind || ''}"><span>${escapeHtml(label)}</span><strong>${money(amount)}</strong></p>`
    );
    return `
      <article class="inquiry-payslip-card">
        <h3>${escapeHtml(title)}</h3>
        ${row('배달비', bucket.deliveryFee)}
        ${row('추가지급(미션)', bucket.missionPay)}
        ${row('기타지급', bucket.other)}
        ${row('BREM프로모션', bucket.promo)}
        ${row('지급합계', bucket.grossPay, 'is-total')}
        ${row('공제합계', bucket.deductTotal, 'is-total')}
        <p class="is-net"><span>총지급액</span><strong>${money(bucket.netPay)}</strong></p>
      </article>
    `;
  }

  async function refreshHome() {
    const list = await loadInquiries();
    const newCount = list.filter(item => item.status === 'new').length;
    updateInquiryBadge(newCount);
    if ($('adminAppStatInquiry')) $('adminAppStatInquiry').textContent = String(newCount);
    if ($('adminAppWeekLabel')) $('adminAppWeekLabel').textContent = weekLabel();

    const today = todayKey();
    const schedules = (window.BremStorage?.adminSchedules?.getAll?.() || [])
      .filter(item => String(item.date || item.scheduleDate || '').slice(0, 10) === today);
    if ($('adminAppStatSchedule')) $('adminAppStatSchedule').textContent = String(schedules.length);
    const box = $('adminAppTodaySchedule');
    if (!box) return;
    if (!schedules.length) {
      box.innerHTML = '<p class="empty">오늘 등록된 일정이 없습니다.</p>';
      return;
    }
    box.innerHTML = schedules.map(item => `
      <div class="admin-phone-today-item">
        <strong>${escapeHtml(item.title || '일정')}</strong>
        <span>${escapeHtml(item.memo || item.createdBy || '')}</span>
      </div>
    `).join('');
  }

  async function renderInquiries() {
    const rowsEl = $('riderInquiryRows');
    const summaryEl = $('riderInquirySummary');
    if (!rowsEl) return;
    const list = await loadInquiries();
    const newCount = list.filter(item => item.status === 'new').length;
    updateInquiryBadge(newCount);
    if (summaryEl) {
      summaryEl.textContent = newCount
        ? `미확인 ${newCount}건 · 클릭하면 상세를 봅니다.`
        : '클릭하면 상세를 봅니다.';
    }
    if (!list.length) {
      rowsEl.innerHTML = '<p class="empty-state">접수된 라이더 문의가 없습니다.</p>';
      return;
    }
    rowsEl.innerHTML = list.map(inquiry => `
      <article class="notice-item inquiry-item" data-open-inquiry="${escapeHtml(inquiry.id)}" role="button" tabindex="0">
        <div class="notice-item-head">
          <div>
            <span class="${inquiryStatusClass(inquiry)}">${escapeHtml(inquiryStatusLabel(inquiry))}</span>
            <strong>${escapeHtml(inquiry.name || '-')} · ${escapeHtml(inquiry.phone || '-')}</strong>
          </div>
          <span class="notice-date">${formatDateTime(inquiry.createdAt)}</span>
        </div>
        <p class="inquiry-meta">
          <span>지역: ${escapeHtml(inquiry.area || '-')}</span>
          <span>구분: ${escapeHtml(inquiry.inquiryType || '-')}</span>
        </p>
        <p class="notice-content">${escapeHtml(inquiry.message || '')}</p>
        ${window.BremRiderInquiryApi?.listExtraHtml?.(inquiry) || ''}
      </article>
    `).join('');
  }

  async function openInquiry(id) {
    const popup = $('adminInquiryPopup');
    if (!popup) return;
    const list = await loadInquiries();
    const inquiry = list.find(item => String(item.id) === String(id));
    if (!inquiry) {
      showToast('문의를 찾지 못했습니다.');
      return;
    }
    const statusEl = $('adminInquiryPopupStatus');
    if (statusEl) {
      statusEl.className = inquiryStatusClass(inquiry);
      statusEl.textContent = inquiryStatusLabel(inquiry);
    }
    if ($('adminInquiryPopupMeta')) {
      $('adminInquiryPopupMeta').textContent = [
        `${inquiry.name || '-'} · ${inquiry.phone || '-'}`,
        `지역 ${inquiry.area || '-'}`,
        `구분 ${inquiry.inquiryType || '-'}`,
        formatDateTime(inquiry.createdAt)
      ].join(' · ');
    }
    if ($('adminInquiryPopupMessage')) $('adminInquiryPopupMessage').textContent = inquiry.message || '';
    const payslipEl = $('adminInquiryPopupPayslip');
    const snap = inquiry.payslipSnapshot;
    if (payslipEl) {
      if (snap) {
        payslipEl.hidden = false;
        payslipEl.innerHTML = `
          <p class="inquiry-popup__payslip-head">${escapeHtml(snap.weekLabel || '')}</p>
          <div class="inquiry-payslip-grid">
            ${payslipCard('쿠팡 주급명세서', snap.coupang)}
            ${payslipCard('배민 주급명세서', snap.baemin)}
          </div>
        `;
      } else {
        payslipEl.hidden = true;
        payslipEl.innerHTML = '';
      }
    }
    const replyBox = $('adminInquiryPopupReplyBox');
    if (replyBox) {
      replyBox.hidden = false;
      if ($('adminInquiryReplyInput')) $('adminInquiryReplyInput').value = inquiry.adminReply || '';
      if ($('adminInquiryReplyNote')) {
        $('adminInquiryReplyNote').textContent = window.BremRiderInquiryApi?.replyNote?.(inquiry) || '';
      }
    }
    popup.dataset.inquiryId = String(inquiry.id || '');
    if ($('adminInquiryPopupActions')) {
      $('adminInquiryPopupActions').innerHTML = `
        ${inquiry.status !== 'read' ? `<button class="small-btn" data-mark-inquiry="${escapeHtml(inquiry.id)}" data-status="read">확인중</button>` : ''}
        ${inquiry.status !== 'done' ? `<button class="small-btn" data-reply-inquiry="${escapeHtml(inquiry.id)}">답장보내기</button>` : ''}
        ${inquiry.status !== 'done' ? `<button class="small-btn" data-mark-inquiry="${escapeHtml(inquiry.id)}" data-status="done">처리완료</button>` : ''}
        <button class="small-btn danger-btn" data-delete-inquiry="${escapeHtml(inquiry.id)}">삭제</button>
        <button class="small-btn" type="button" data-inquiry-popup-close>닫기</button>
      `;
    }
    bindInquiryReplyPresence();
    popup.hidden = false;
  }

  let inquiryPresenceTimer = null;

  function bindInquiryReplyPresence() {
    const input = $('adminInquiryReplyInput');
    const popup = $('adminInquiryPopup');
    if (!input || !popup || input.dataset.presenceBound === '1') return;
    input.dataset.presenceBound = '1';
    const beat = () => {
      const inquiryId = popup.dataset.inquiryId || '';
      if (!inquiryId || document.activeElement !== input) return;
      const me = window.BremRiderInquiryApi?.currentAdmin?.() || { id: '', name: '관리자' };
      window.BremRiderInquiryApi?.updateInquiry(inquiryId, {
        replyingBy: me.name,
        replyingById: me.id
      }).catch(() => {});
    };
    input.addEventListener('focus', () => {
      beat();
      if (inquiryPresenceTimer) window.clearInterval(inquiryPresenceTimer);
      inquiryPresenceTimer = window.setInterval(beat, 12000);
    });
    input.addEventListener('blur', () => {
      if (inquiryPresenceTimer) {
        window.clearInterval(inquiryPresenceTimer);
        inquiryPresenceTimer = null;
      }
      const inquiryId = popup.dataset.inquiryId || '';
      window.setTimeout(() => {
        if (document.activeElement === input || !inquiryId) return;
        window.BremRiderInquiryApi?.updateInquiry(inquiryId, { replyingClear: true }).catch(() => {});
      }, 700);
    });
  }

  function setupWeekPicker() {
    if (!window.BremDatePicker?.setupWednesdayWeekDelegated) return;
    window.BremAdminWednesdayWeekPicker = window.BremDatePicker.setupWednesdayWeekDelegated({
      popup: $('adminWeekPickerCalendar'),
      daysContainer: $('adminWeekPickerDays'),
      titleEl: $('adminWeekPickerTitle'),
      prevBtn: $('adminWeekPickerPrev'),
      nextBtn: $('adminWeekPickerNext'),
      todayBtn: $('adminWeekPickerThisWeek'),
      openSelector: '[data-week-picker-trigger]',
      getContext(button) {
        const triggerId = button.dataset.weekPickerTrigger;
        if (triggerId === 'payroll-slip-search' || triggerId === 'payroll-slip-search-popup') {
          return {
            hiddenInput: $('payrollSlipSearchWeekStart'),
            labelEl: triggerId === 'payroll-slip-search' ? $('payrollSlipSearchWeekLabel') : null,
            onSelect(value) {
              window.BremAdminPayrollSlipSearch?.handleWeekChange?.(value);
            }
          };
        }
        return null;
      }
    });
  }

  const SEEN_KEY = 'brem_seen_rider_inquiry_ids';

  function readSeen() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function writeSeen(ids) {
    try {
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
    } catch {
      /* ignore */
    }
  }

  async function watchInquiries() {
    try {
      const list = await loadInquiries();
      const fresh = list.filter(item => item.status === 'new');
      updateInquiryBadge(fresh.length);
      if ($('adminAppStatInquiry')) $('adminAppStatInquiry').textContent = String(fresh.length);
      const seen = readSeen();
      const unseen = fresh.filter(item => !seen.has(String(item.id)));
      fresh.forEach(item => seen.add(String(item.id)));
      writeSeen(seen);
      const inquiryPanel = document.querySelector('[data-admin-app-panel="inquiry"]');
      const popup = $('adminInquiryPopup');
      if ((inquiryPanel && !inquiryPanel.hidden) || (popup && !popup.hidden)) {
        await renderInquiries();
        const openId = popup && !popup.hidden ? popup.dataset.inquiryId : '';
        const input = $('adminInquiryReplyInput');
        if (openId && document.activeElement !== input) {
          const current = list.find(item => String(item.id) === String(openId));
          const note = $('adminInquiryReplyNote');
          const statusEl = $('adminInquiryPopupStatus');
          if (current && note) note.textContent = window.BremRiderInquiryApi?.replyNote?.(current) || '';
          if (current && statusEl) {
            statusEl.className = inquiryStatusClass(current);
            statusEl.textContent = inquiryStatusLabel(current);
          }
        }
      }
      if (!unseen.length) return;
      lastAlertInquiryId = String(unseen[0].id || '');
      const body = $('adminInquiryAlertBody');
      const alertPopup = $('adminInquiryAlertPopup');
      if (body && alertPopup) {
        body.innerHTML = unseen.slice(0, 5).map(item => (
          `<p><strong>${escapeHtml(item.name || '-')}</strong> · ${escapeHtml(item.inquiryType || '문의')}<br><span>${escapeHtml(String(item.message || '').slice(0, 80))}</span></p>`
        )).join('');
        alertPopup.hidden = false;
      }
    } catch {
      /* ignore */
    }
  }

  function startInquiryWatch() {
    if (inquiryWatchTimer) return;
    void watchInquiries();
    inquiryWatchTimer = window.setInterval(() => void watchInquiries(), 8000);
  }

  async function login(event) {
    event.preventDefault();
    const name = $('adminName')?.value.trim();
    const password = $('adminPassword')?.value;
    const submitBtn = event.target.querySelector('.login-submit');
    if (!name || !password) {
      showToast('아이디와 비밀번호를 입력하세요.');
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '로그인 중…';
    }
    try {
      if (window.BremSupabaseConfig?.load) {
        await Promise.race([
          window.BremSupabaseConfig.load(),
          new Promise(resolve => setTimeout(resolve, 1500))
        ]);
      }
      window.BremLoginPrefs?.setKeepLoggedIn?.('admin', true);
      const result = await window.BremStorage.auth.signInAdmin(name, password);
      if (!result?.ok) {
        showToast(result?.message || '이름 또는 비밀번호가 올바르지 않습니다.');
        return;
      }
      void window.BremStorage.initStorage?.({ backend: 'supabase', deferHydrate: true });
      window.BremLoginPrefs?.captureLoginPrefs?.('admin', {
        idInput: $('adminName'),
        rememberCheckbox: $('adminRememberId'),
        keepCheckbox: $('adminKeepLoggedIn')
      });
      showApp();
      void window.BremStorage.ensureSectionLoaded?.('admin-schedule');
      void refreshHome();
    } catch (error) {
      showToast(error.message || '로그인에 실패했습니다.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '로그인';
      }
    }
  }

  async function logout() {
    await window.BremStorage?.auth?.signOutSupabase?.('admin');
    location.reload();
  }

  function bindEvents() {
    $('adminLoginForm')?.addEventListener('submit', login);
    $('adminLogoutBtn')?.addEventListener('click', () => void logout());
    nav?.addEventListener('click', event => {
      const button = event.target.closest('[data-admin-app-tab]');
      if (button) setTab(button.dataset.adminAppTab);
    });
    document.addEventListener('click', async event => {
      const jump = event.target.closest('[data-admin-app-jump]');
      if (jump) {
        setTab(jump.dataset.adminAppJump);
        return;
      }
      const openInquiryBtn = event.target.closest('[data-open-inquiry]');
      if (openInquiryBtn) {
        void openInquiry(openInquiryBtn.dataset.openInquiry);
        return;
      }
      if (event.target.closest('[data-inquiry-popup-close]')) {
        const popup = $('adminInquiryPopup');
        const inquiryId = popup?.dataset.inquiryId || '';
        if (inquiryPresenceTimer) {
          window.clearInterval(inquiryPresenceTimer);
          inquiryPresenceTimer = null;
        }
        if (inquiryId) window.BremRiderInquiryApi?.updateInquiry(inquiryId, { replyingClear: true }).catch(() => {});
        if (popup) popup.hidden = true;
        return;
      }
      if (event.target.closest('[data-inquiry-alert-close]')) {
        const popup = $('adminInquiryAlertPopup');
        if (popup) popup.hidden = true;
        return;
      }
      if (event.target.closest('#adminInquiryAlertOpenBtn')) {
        const popup = $('adminInquiryAlertPopup');
        if (popup) popup.hidden = true;
        setTab('inquiry');
        if (lastAlertInquiryId) void openInquiry(lastAlertInquiryId);
        return;
      }
      if (event.target.closest('#riderInquiryRefreshBtn')) {
        void renderInquiries();
        return;
      }
      const replyBtn = event.target.closest('[data-reply-inquiry]');
      if (replyBtn) {
        const reply = $('adminInquiryReplyInput')?.value.trim() || '';
        if (!reply) {
          showToast('답장을 입력하세요.');
          return;
        }
        const inquiryId = replyBtn.dataset.replyInquiry;
        const me = window.BremRiderInquiryApi?.currentAdmin?.() || { id: '', name: '관리자' };
        const latest = (await loadInquiries()).find(item => String(item.id) === String(inquiryId));
        const typing = window.BremRiderInquiryApi?.typingName?.(latest);
        if (typing && !window.confirm(`${typing}님이 지금 답장을 쓰고 있습니다. 그래도 보낼까요?`)) return;
        if (
          latest?.adminReply
          && latest.adminReply !== reply
          && latest.adminReplyById
          && latest.adminReplyById !== me.id
          && !window.confirm(`${latest.adminReplyBy || '다른 관리자'}님이 이미 답장했습니다. 보내면 그 답장이 바뀝니다. 보낼까요?`)
        ) return;
        await window.BremRiderInquiryApi.updateInquiry(inquiryId, {
          status: latest?.status === 'done' ? 'done' : 'read',
          adminReply: reply,
          adminReplyBy: me.name,
          adminReplyById: me.id,
          replyingClear: true
        });
        showToast('답장을 보냈습니다.');
        $('adminInquiryPopup').hidden = true;
        void renderInquiries();
        return;
      }
      const markBtn = event.target.closest('[data-mark-inquiry]');
      if (markBtn) {
        await window.BremRiderInquiryApi.updateInquiry(markBtn.dataset.markInquiry, {
          status: markBtn.dataset.status
        });
        showToast(markBtn.dataset.status === 'read' ? '확인중으로 표시했습니다.' : '처리완료로 변경했습니다.');
        $('adminInquiryPopup').hidden = true;
        void renderInquiries();
        return;
      }
      const deleteBtn = event.target.closest('[data-delete-inquiry]');
      if (deleteBtn) {
        if (!window.confirm('이 문의를 삭제할까요?')) return;
        await window.BremRiderInquiryApi.remove(deleteBtn.dataset.deleteInquiry);
        showToast('삭제했습니다.');
        $('adminInquiryPopup').hidden = true;
        void renderInquiries();
      }
    });
  }

  async function boot() {
    bindEvents();
    setupWeekPicker();
    window.BremLoginPrefs?.restoreIdAfterLogout?.('admin', {
      idInput: $('adminName'),
      rememberCheckbox: $('adminRememberId'),
      passwordInput: $('adminPassword')
    });
    if (window.BremSupabaseConfig?.load) {
      await window.BremSupabaseConfig.load().catch(() => {});
    }
    if (window.BremStorage?.auth?.isAdminLoggedIn?.()) {
      void window.BremStorage.initStorage?.({ backend: 'supabase', deferHydrate: true });
      showApp();
      hideBootSplash();
      void window.BremStorage.ensureSectionLoaded?.('admin-schedule');
      void refreshHome();
      return;
    }
    showLogin();
    hideBootSplash();
  }

  window.BremAdminAppNav = {
    setTab,
    openInquiry
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void boot());
  } else {
    void boot();
  }
})();

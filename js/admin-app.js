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

  let inquiryListCache = [];
  let inquiryListMenu = 'open';
  const inquirySelectedIds = new Set();

  function rememberInquiries(list) {
    inquiryListCache = Array.isArray(list) ? list : [];
    return inquiryListCache;
  }

  function inquiryListKey(list) {
    return (list || []).map(item => [
      item.id,
      item.status,
      item.adminReply || '',
      item.adminRepliedAt || '',
      item.adminReplyBy || '',
      item.replyingBy || '',
      item.replyingAt || '',
      item.riderAckAt || ''
    ].join('\u001f')).join('\n');
  }

  function syncInquirySelection(event) {
    const rows = document.getElementById('riderInquiryRows');
    if (!rows || !rows.contains(event.target)) return;
    const rowCheck = event.target.closest('[data-inquiry-check]');
    const selectAll = event.target.closest('[data-inquiry-select-all]');
    if (!rowCheck && !selectAll) return;
    if (selectAll) {
      rows.querySelectorAll('[data-inquiry-check]').forEach(input => {
        input.checked = selectAll.checked;
        const id = String(input.dataset.inquiryCheck || '');
        if (selectAll.checked) inquirySelectedIds.add(id);
        else inquirySelectedIds.delete(id);
      });
    } else {
      const id = String(rowCheck.dataset.inquiryCheck || '');
      if (rowCheck.checked) inquirySelectedIds.add(id);
      else inquirySelectedIds.delete(id);
    }
    const checks = [...rows.querySelectorAll('[data-inquiry-check]')];
    const selected = checks.filter(input => input.checked).length;
    const all = rows.querySelector('[data-inquiry-select-all]');
    if (all) {
      all.checked = checks.length > 0 && selected === checks.length;
      all.indeterminate = selected > 0 && selected < checks.length;
    }
    const btn = rows.querySelector('[data-inquiry-bulk-done]');
    if (btn && btn.dataset.busy !== '1') {
      btn.disabled = selected === 0;
      btn.textContent = selected ? `선택 처리완료 ${selected}` : '선택 처리완료';
    }
  }

  function markSelectedInquiriesDone(button) {
    const rows = document.getElementById('riderInquiryRows');
    const ids = [...(rows?.querySelectorAll('[data-inquiry-check]:checked') || [])]
      .map(input => input.dataset.inquiryCheck)
      .filter(Boolean);
    if (!ids.length) {
      showToast('처리할 문의를 선택하세요.');
      return;
    }
    if (!window.confirm(`선택한 ${ids.length}건을 처리완료 할까요?`)) return;
    if (button) {
      button.disabled = true;
      button.dataset.busy = '1';
      button.textContent = '처리 중…';
    }
    void window.BremRiderInquiryApi.bulkComplete(ids).then(result => {
      (result?.doneIds || ids).forEach(id => inquirySelectedIds.delete(String(id)));
      if (Array.isArray(result?.list)) rememberInquiries(result.list);
      const doneCount = Math.max(0, (result?.total || ids.length) - (result?.failed || 0));
      showToast(result?.failed
        ? `${doneCount}건 처리완료, ${result.failed}건은 실패했습니다.`
        : `${doneCount}건을 처리완료했습니다.`);
      if (rows) delete rows.dataset.inquiryKey;
      void renderInquiries(inquiryListCache.length ? inquiryListCache : undefined);
    }).catch(error => {
      showToast(error.message || '처리완료에 실패했습니다.');
      if (button?.isConnected) {
        button.disabled = false;
        delete button.dataset.busy;
        button.textContent = '선택 처리완료';
      }
    });
  }

  async function loadInquiries() {
    if (window.BremRiderInquiryApi?.ready) await window.BremRiderInquiryApi.ready;
    if (window.BremRiderInquiryApi?.list) {
      try {
        return rememberInquiries(await window.BremRiderInquiryApi.list());
      } catch {
        /* fall through */
      }
    }
    return rememberInquiries(window.BremStorage?.riderInquiries?.getAll?.() || []);
  }

  function showMotionPopup(popup) {
    if (!popup) return;
    const token = String(Date.now());
    popup.dataset.motionToken = token;
    popup.dataset.motionOpen = '1';
    popup.hidden = false;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (popup.dataset.motionToken === token) popup.classList.add('is-open');
      });
    });
  }

  function hideMotionPopup(popup) {
    if (!popup) return;
    const token = String(Date.now());
    popup.dataset.motionToken = token;
    popup.dataset.motionOpen = '0';
    popup.classList.remove('is-open');
    window.setTimeout(() => {
      if (popup.dataset.motionToken === token) popup.hidden = true;
    }, 180);
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

  async function renderInquiries(preset) {
    const rowsEl = $('riderInquiryRows');
    const summaryEl = $('riderInquirySummary');
    if (!rowsEl) return;
    const list = rememberInquiries(preset || await loadInquiries());
    const menu = inquiryListMenu || 'open';
    const visible = list.filter(item => (window.BremRiderInquiryApi?.inquiryMenu?.(item) || 'open') === menu);
    const key = `${menu}\n${inquiryListKey(list)}`;
    const newCount = list.filter(item => item.status === 'new').length;
    updateInquiryBadge(newCount);
    const counts = window.BremRiderInquiryApi?.menuCounts?.(list) || { open: 0, ack: 0, done: 0 };
    document.querySelectorAll('[data-inquiry-menu]').forEach(button => {
      const id = button.dataset.inquiryMenu;
      const label = id === 'ack' ? '답장확인' : id === 'done' ? '처리완료' : '미확인';
      button.textContent = `${label} ${counts[id] || 0}`;
      button.classList.toggle('active', id === menu);
    });
    const canBulk = menu === 'open' || menu === 'ack';
    if (summaryEl) {
      summaryEl.textContent = canBulk
        ? '고른 뒤 처리완료할 수 있습니다.'
        : '클릭하면 상세를 봅니다.';
    }
    if (rowsEl.dataset.inquiryKey === key && rowsEl.childElementCount) return;
    rowsEl.dataset.inquiryKey = key;
    if (!visible.length) {
      rowsEl.innerHTML = '<p class="empty-state">이 메뉴에 문의가 없습니다.</p>';
      return;
    }
    if (canBulk) {
      const visibleIds = new Set(visible.map(item => String(item.id)));
      inquirySelectedIds.forEach(id => {
        if (!visibleIds.has(id)) inquirySelectedIds.delete(id);
      });
    }
    const selectedCount = canBulk
      ? visible.filter(item => inquirySelectedIds.has(String(item.id))).length
      : 0;
    rowsEl.innerHTML = `
      ${canBulk ? `
        <div class="inquiry-bulk-bar">
          <label class="inquiry-bulk-check">
            <input type="checkbox" data-inquiry-select-all ${visible.length && selectedCount === visible.length ? 'checked' : ''}>
            <span>전체 선택</span>
          </label>
          <button type="button" class="small-btn" data-inquiry-bulk-done ${selectedCount ? '' : 'disabled'}>선택 처리완료${selectedCount ? ` ${selectedCount}` : ''}</button>
        </div>
      ` : ''}
      ${visible.map(inquiry => `
      <article class="notice-item inquiry-item" data-open-inquiry="${escapeHtml(inquiry.id)}" role="button" tabindex="0">
        <div class="inquiry-item-row">
          ${canBulk ? `<label class="inquiry-select" data-inquiry-select><input type="checkbox" data-inquiry-check="${escapeHtml(inquiry.id)}" ${inquirySelectedIds.has(String(inquiry.id)) ? 'checked' : ''} aria-label="선택"></label>` : ''}
          <div class="inquiry-item-body">
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
          </div>
        </div>
      </article>
    `).join('')}`;
    const allBox = rowsEl.querySelector('[data-inquiry-select-all]');
    if (allBox) allBox.indeterminate = selectedCount > 0 && selectedCount < visible.length;
  }

  function paintInquiryPopup(inquiry, { keepDraft = false } = {}) {
    const popup = $('adminInquiryPopup');
    if (!popup || !inquiry) return;
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
      const payslipKey = snap ? `${inquiry.id}:${snap.weekStart || ''}:${snap.weekEnd || ''}` : '';
      if (payslipEl.dataset.payslipKey !== payslipKey) {
        payslipEl.dataset.payslipKey = payslipKey;
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
    }
    const replyBox = $('adminInquiryPopupReplyBox');
    if (replyBox) {
      replyBox.hidden = false;
      const replyInput = $('adminInquiryReplyInput');
      if (replyInput && !keepDraft) {
        const draft = String(replyInput.value || '').trim();
        const serverReply = String(inquiry.adminReply || '').trim();
        const ownDraft = document.activeElement === replyInput && draft && draft !== serverReply;
        if (!ownDraft && replyInput.value !== (inquiry.adminReply || '')) {
          replyInput.value = inquiry.adminReply || '';
        }
      }
      if ($('adminInquiryReplyNote')) {
        $('adminInquiryReplyNote').textContent = window.BremRiderInquiryApi?.replyNote?.(inquiry) || '';
      }
    }
    popup.dataset.inquiryId = String(inquiry.id || '');
    const actionsEl = $('adminInquiryPopupActions');
    if (actionsEl) {
      const actionKey = `${inquiry.id}:${inquiry.status}`;
      if (actionsEl.dataset.actionKey !== actionKey) {
        actionsEl.dataset.actionKey = actionKey;
        actionsEl.innerHTML = `
          ${inquiry.status !== 'read' ? `<button class="small-btn" data-mark-inquiry="${escapeHtml(inquiry.id)}" data-status="read">확인중</button>` : ''}
          ${inquiry.status !== 'done' ? `<button class="small-btn" data-reply-inquiry="${escapeHtml(inquiry.id)}">답장보내기</button>` : ''}
          ${inquiry.status !== 'done' ? `<button class="small-btn" data-mark-inquiry="${escapeHtml(inquiry.id)}" data-status="done">처리완료</button>` : ''}
          <button class="small-btn danger-btn" data-delete-inquiry="${escapeHtml(inquiry.id)}">삭제</button>
          <button class="small-btn" type="button" data-inquiry-popup-close>닫기</button>
        `;
      }
    }
    bindInquiryReplyPresence();
  }

  function openInquiry(id) {
    const popup = $('adminInquiryPopup');
    if (!popup) return;
    const cached = inquiryListCache.find(item => String(item.id) === String(id));
    popup.dataset.inquiryId = String(id || '');
    if (cached) paintInquiryPopup(cached);
    else if ($('adminInquiryPopupMessage')) $('adminInquiryPopupMessage').textContent = '불러오는 중…';
    showMotionPopup(popup);
    void loadInquiries().then(list => {
      if (popup.dataset.motionOpen !== '1' || popup.dataset.inquiryId !== String(id)) return;
      const inquiry = list.find(item => String(item.id) === String(id));
      if (!inquiry) {
        if (!cached) {
          showToast('문의를 찾지 못했습니다.');
          hideMotionPopup(popup);
        }
        return;
      }
      const input = $('adminInquiryReplyInput');
      paintInquiryPopup(inquiry, { keepDraft: document.activeElement === input });
    }).catch(() => {
      if (!cached && popup.dataset.inquiryId === String(id)) {
        showToast('문의를 불러오지 못했습니다.');
        hideMotionPopup(popup);
      }
    });
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
      const before = inquiryListCache.slice();
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
      if ((inquiryPanel && !inquiryPanel.hidden) || (popup && popup.dataset.motionOpen === '1')) {
        await renderInquiries(list);
        const openId = popup && !popup.hidden ? popup.dataset.inquiryId : '';
        if (openId) {
          const current = list.find(item => String(item.id) === String(openId));
          if (current) paintInquiryPopup(current, { keepDraft: false });
        }
        if (before.length) {
          const known = new Map(before.map(item => [String(item.id), item]));
          const me = window.BremRiderInquiryApi?.currentAdmin?.() || {};
          const arrived = list.filter(item => {
            if (!item.adminReply || known.get(String(item.id))?.adminReply) return false;
            if (me.id && item.adminReplyById && String(item.adminReplyById) === String(me.id)) return false;
            return true;
          });
          if (arrived.length) {
            showToast(arrived.length === 1
              ? '다른 관리자 답장이 반영됐습니다.'
              : `다른 관리자 답장 ${arrived.length}건이 반영됐습니다.`);
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
        showMotionPopup(alertPopup);
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
    document.addEventListener('change', event => {
      if (event.target.closest('#riderInquiryRows [data-inquiry-check], #riderInquiryRows [data-inquiry-select-all]')) {
        syncInquirySelection(event);
      }
    });
    document.addEventListener('click', async event => {
      const jump = event.target.closest('[data-admin-app-jump]');
      if (jump) {
        setTab(jump.dataset.adminAppJump);
        return;
      }
      const bulkDoneBtn = event.target.closest('[data-inquiry-bulk-done]');
      if (bulkDoneBtn) {
        if (!bulkDoneBtn.disabled) markSelectedInquiriesDone(bulkDoneBtn);
        return;
      }
      if (event.target.closest('[data-inquiry-select], [data-inquiry-select-all], .inquiry-bulk-bar')) return;
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
        hideMotionPopup(popup);
        return;
      }
      if (event.target.closest('[data-inquiry-alert-close]')) {
        hideMotionPopup($('adminInquiryAlertPopup'));
        return;
      }
      if (event.target.closest('#adminInquiryAlertOpenBtn')) {
        hideMotionPopup($('adminInquiryAlertPopup'));
        setTab('inquiry');
        if (lastAlertInquiryId) openInquiry(lastAlertInquiryId);
        return;
      }
      const inquiryMenuBtn = event.target.closest('[data-inquiry-menu]');
      if (inquiryMenuBtn) {
        inquiryListMenu = inquiryMenuBtn.dataset.inquiryMenu || 'open';
        inquirySelectedIds.clear();
        const rowsEl = $('riderInquiryRows');
        if (rowsEl) delete rowsEl.dataset.inquiryKey;
        void renderInquiries(inquiryListCache.length ? inquiryListCache : undefined);
        return;
      }
      if (event.target.closest('#riderInquiryRefreshBtn')) {
        void renderInquiries();
        return;
      }
      const replyBtn = event.target.closest('[data-reply-inquiry]');
      if (replyBtn) {
        if (replyBtn.disabled) return;
        const reply = $('adminInquiryReplyInput')?.value.trim() || '';
        if (!reply) {
          showToast('답장을 입력하세요.');
          return;
        }
        const inquiryId = replyBtn.dataset.replyInquiry;
        const me = window.BremRiderInquiryApi?.currentAdmin?.() || { id: '', name: '관리자' };
        replyBtn.disabled = true;
        replyBtn.textContent = '보내는 중…';
        try {
          let latest = inquiryListCache.find(item => String(item.id) === String(inquiryId));
          if (!latest) latest = (await loadInquiries()).find(item => String(item.id) === String(inquiryId));
          const typing = window.BremRiderInquiryApi?.typingName?.(latest);
          if (typing && !window.confirm(`아이디 ${typing} 답장 쓰는 중입니다. 그래도 보낼까요?`)) return;
          if (
            latest?.adminReply
            && latest.adminReply !== reply
            && latest.adminReplyById
            && latest.adminReplyById !== me.id
            && !window.confirm(`아이디 ${latest.adminReplyBy || '다른 관리자'} 답장입니다. 보내면 그 답장이 바뀝니다. 보낼까요?`)
          ) return;
          const saved = await window.BremRiderInquiryApi.updateInquiry(inquiryId, {
            status: latest?.status === 'done' ? 'done' : 'read',
            adminReply: reply,
            adminReplyBy: me.name,
            adminReplyById: me.id,
            replyingClear: true
          });
          if (Array.isArray(saved)) rememberInquiries(saved);
          const updated = inquiryListCache.find(item => String(item.id) === String(inquiryId)) || {
            ...(latest || {}),
            adminReply: reply,
            status: latest?.status === 'done' ? 'done' : 'read'
          };
          paintInquiryPopup(updated, { keepDraft: true });
          showToast('답장을 보냈습니다.');
          void renderInquiries(inquiryListCache);
        } catch (error) {
          showToast(error.message || '답장 전송에 실패했습니다.');
        } finally {
          if (replyBtn.isConnected) {
            replyBtn.disabled = false;
            replyBtn.textContent = '답장보내기';
          }
        }
        return;
      }
      const markBtn = event.target.closest('[data-mark-inquiry]');
      if (markBtn) {
        if (markBtn.disabled) return;
        const previousLabel = markBtn.textContent;
        const inquiryId = markBtn.dataset.markInquiry;
        const draft = String($('adminInquiryReplyInput')?.value || '').trim();
        const current = inquiryListCache.find(item => String(item.id) === String(inquiryId));
        const me = window.BremRiderInquiryApi?.currentAdmin?.() || { id: '', name: '관리자' };
        const patch = { status: markBtn.dataset.status };
        const savingReply = Boolean(draft && draft !== String(current?.adminReply || '').trim());
        if (savingReply) {
          patch.adminReply = draft;
          patch.adminReplyBy = me.name;
          patch.adminReplyById = me.id;
          patch.replyingClear = true;
        }
        markBtn.disabled = true;
        markBtn.textContent = '처리 중…';
        try {
          const saved = await window.BremRiderInquiryApi.updateInquiry(inquiryId, patch);
          if (Array.isArray(saved)) rememberInquiries(saved);
          const updated = inquiryListCache.find(item => String(item.id) === String(markBtn.dataset.markInquiry));
          if (updated && $('adminInquiryPopup')?.dataset.motionOpen === '1') {
            paintInquiryPopup(updated, { keepDraft: true });
          }
          showToast(savingReply
            ? '적은 답장도 함께 저장했습니다.'
            : (markBtn.dataset.status === 'read' ? '확인중으로 표시했습니다.' : '처리완료로 변경했습니다.'));
          void renderInquiries(inquiryListCache);
        } catch (error) {
          showToast(error.message || '문의 상태 변경에 실패했습니다.');
        } finally {
          if (markBtn.isConnected) {
            markBtn.disabled = false;
            markBtn.textContent = previousLabel;
          }
        }
        return;
      }
      const deleteBtn = event.target.closest('[data-delete-inquiry]');
      if (deleteBtn) {
        if (deleteBtn.disabled) return;
        if (!window.confirm('이 문의를 삭제할까요?')) return;
        deleteBtn.disabled = true;
        deleteBtn.textContent = '삭제 중…';
        try {
          const saved = await window.BremRiderInquiryApi.remove(deleteBtn.dataset.deleteInquiry);
          if (Array.isArray(saved)) rememberInquiries(saved);
          showToast('삭제했습니다.');
          hideMotionPopup($('adminInquiryPopup'));
          void renderInquiries(Array.isArray(saved) ? saved : undefined);
        } catch (error) {
          showToast(error.message || '문의 삭제에 실패했습니다.');
          if (deleteBtn.isConnected) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = '삭제';
          }
        }
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

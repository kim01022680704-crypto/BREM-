(function () {
  const panel = document.getElementById('driverWithdrawalPanel');
  const openBtn = document.getElementById('driverWithdrawalBtn');
  const closeBtn = document.getElementById('driverWithdrawalCloseBtn');
  const prevBtn = document.getElementById('driverWithdrawalPrevWeekBtn');
  const nextBtn = document.getElementById('driverWithdrawalNextWeekBtn');
  const periodEl = document.getElementById('driverWithdrawalPeriod');
  const availableEl = document.getElementById('driverWithdrawalAvailable');
  const hintEl = document.getElementById('driverWithdrawalAvailableHint');
  const emptyEl = document.getElementById('driverWithdrawalEmpty');
  const emptyTextEl = document.getElementById('driverWithdrawalEmptyText');
  const contentEl = document.getElementById('driverWithdrawalContent');
  const daysBody = document.getElementById('driverWithdrawalDaysBody');
  const requestList = document.getElementById('driverWithdrawalRequestList');
  const form = document.getElementById('driverWithdrawalForm');
  const amountInput = document.getElementById('driverWithdrawalAmount');
  const submitBtn = document.getElementById('driverWithdrawalSubmitBtn');
  const toast = document.getElementById('toast');

  if (!panel || !openBtn) return;

  const state = {
    weekStart: null,
    loading: false,
    visible: false,
    availableAmount: 0,
    requestSeq: 0
  };

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
  }

  function formatLocalDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekStartKey(dateValue) {
    const utils = window.BremPayrollSlipUtils || window.BremDatePicker;
    if (utils?.normalizeSettlementWeekStart) return utils.normalizeSettlementWeekStart(dateValue);
    if (utils?.weekStartKey) return utils.weekStartKey(dateValue);
    const date = new Date(`${String(dateValue || '').slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return formatLocalDateKey(date);
  }

  function weekEndKey(weekStart) {
    const utils = window.BremPayrollSlipUtils || window.BremDatePicker;
    if (utils?.settlementWeekEnd) return utils.settlementWeekEnd(weekStart);
    if (utils?.weekEndKey) return utils.weekEndKey(weekStart);
    const date = new Date(`${weekStart}T00:00:00`);
    date.setDate(date.getDate() + 6);
    return formatLocalDateKey(date);
  }

  function shiftWeek(weekStart, deltaWeeks) {
    const date = new Date(`${weekStart}T00:00:00`);
    date.setDate(date.getDate() + (deltaWeeks * 7));
    return weekStartKey(formatLocalDateKey(date));
  }

  function formatPeriodLabel(weekStart) {
    const end = weekEndKey(weekStart);
    const fmt = value => {
      const date = new Date(`${value}T00:00:00`);
      if (Number.isNaN(date.getTime())) return value;
      return new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        weekday: 'short'
      }).format(date);
    };
    return `${weekStart}(${fmt(weekStart).slice(-2)}) ~ ${end}(${fmt(end).slice(-2)})`.replace(/\(/g, '(');
  }

  function formatPeriodSimple(weekStart) {
    const end = weekEndKey(weekStart);
    const utils = window.BremPayrollSlipUtils || window.BremDatePicker;
    if (utils?.formatWednesdayWeekRange) return utils.formatWednesdayWeekRange(weekStart);
    return `${weekStart} ~ ${end}`;
  }

  function platformLabel(platform) {
    return platform === 'baemin' ? '배민' : '쿠팡';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setOpenState(open) {
    state.visible = open;
    panel.hidden = !open;
    openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    openBtn.classList.toggle('is-active', open);
  }

  function renderSummary(payload) {
    state.availableAmount = Math.max(0, Number(payload.availableAmount || 0));
    if (availableEl) availableEl.textContent = formatMoney(state.availableAmount);
    if (hintEl) {
      hintEl.textContent = payload.enrolled === false
        ? '일정산 등록 기사가 아닙니다. 관리자에게 문의하세요.'
        : `실지급 합계 ${formatMoney(payload.totalNetPay)} − 신청 ${formatMoney(payload.requestedTotal)}`;
    }
    if (amountInput) {
      amountInput.max = String(state.availableAmount || 0);
      if (Number(amountInput.value || 0) > state.availableAmount) {
        amountInput.value = state.availableAmount > 0 ? String(state.availableAmount) : '';
      }
    }
  }

  function renderDays(days) {
    if (!daysBody) return;
    const list = Array.isArray(days) ? days : [];
    if (!list.length) {
      daysBody.innerHTML = '<tr><td colspan="9" class="empty">표시할 일정산 내역이 없습니다.</td></tr>';
      return;
    }
    daysBody.innerHTML = list.map(row => `
      <tr>
        <td>${escapeHtml(row.period || '-')}</td>
        <td>${escapeHtml(platformLabel(row.platform))}</td>
        <td>${formatMoney(row.settlementAmount)}</td>
        <td>${formatMoney(row.employmentInsurance)}</td>
        <td>${formatMoney(row.industrialAccidentInsurance)}</td>
        <td>${formatMoney(row.withholdingTax)}</td>
        <td>${formatMoney(row.callFee)}</td>
        <td>${formatMoney(row.dailySettlementFee)}</td>
        <td><strong>${formatMoney(row.netPay)}</strong></td>
      </tr>
    `).join('');
  }

  function renderRequests(requests) {
    if (!requestList) return;
    const list = Array.isArray(requests) ? requests : [];
    if (!list.length) {
      requestList.innerHTML = '<li class="driver-payslip-empty-line">아직 신청 내역이 없습니다.</li>';
      return;
    }
    requestList.innerHTML = list.map(item => {
      const cancelled = item.status === 'cancelled';
      return `
      <li class="driver-withdrawal-request${cancelled ? ' is-cancelled' : ''}">
        <span class="driver-withdrawal-request__meta">
          ${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString('ko-KR') : '-')}
          ${cancelled ? '<em class="driver-withdrawal-request__badge">취소됨</em>' : '<em class="driver-withdrawal-request__badge is-pending">신청</em>'}
        </span>
        <strong>${formatMoney(item.amount)}</strong>
      </li>`;
    }).join('');
  }

  async function loadWithdrawal() {
    if (!state.weekStart) state.weekStart = weekStartKey(formatLocalDateKey(new Date()));
    if (periodEl) periodEl.textContent = formatPeriodSimple(state.weekStart);

    const seq = ++state.requestSeq;
    state.loading = true;
    if (submitBtn) submitBtn.disabled = true;

    const result = await window.BremStorage?.fetchRiderWithdrawalFromServer?.(state.weekStart);
    if (seq !== state.requestSeq) return;
    state.loading = false;
    if (submitBtn) submitBtn.disabled = false;

    if (!result?.ok) {
      if (emptyEl) emptyEl.hidden = false;
      if (contentEl) contentEl.hidden = true;
      if (emptyTextEl) emptyTextEl.textContent = result?.message || '출금신청 정보를 불러오지 못했습니다.';
      renderSummary({ availableAmount: 0, totalNetPay: 0, requestedTotal: 0, enrolled: false });
      return;
    }

    renderSummary(result);
    renderDays(result.days);
    renderRequests(result.myRequests);

    const noDays = !Array.isArray(result.days) || !result.days.length;
    if (emptyEl) {
      emptyEl.hidden = result.enrolled !== false && !noDays;
      if (result.enrolled === false && emptyTextEl) {
        emptyTextEl.textContent = '일정산 등록 기사가 아닙니다. 관리자에게 문의하세요.';
      } else if (noDays && emptyTextEl) {
        emptyTextEl.textContent = '해당 주차에 매칭된 일정산 내역이 없습니다.';
      }
    }
    if (contentEl) contentEl.hidden = result.enrolled === false;
  }

  function openPanel() {
    document.getElementById('driverWeeklyPayslipPanel')?.setAttribute('hidden', '');
    document.getElementById('driverWeeklyPayslipBtn')?.setAttribute('aria-expanded', 'false');
    setOpenState(true);
    if (!state.weekStart) state.weekStart = weekStartKey(formatLocalDateKey(new Date()));
    void loadWithdrawal();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closePanel() {
    setOpenState(false);
  }

  openBtn.addEventListener('click', () => {
    if (state.visible) closePanel();
    else openPanel();
  });
  closeBtn?.addEventListener('click', closePanel);
  prevBtn?.addEventListener('click', () => {
    state.weekStart = shiftWeek(state.weekStart || weekStartKey(formatLocalDateKey(new Date())), -1);
    void loadWithdrawal();
  });
  nextBtn?.addEventListener('click', () => {
    state.weekStart = shiftWeek(state.weekStart || weekStartKey(formatLocalDateKey(new Date())), 1);
    void loadWithdrawal();
  });

  form?.addEventListener('submit', event => {
    event.preventDefault();
    const amount = Math.max(0, Math.round(Number(amountInput?.value || 0)));
    if (!amount) {
      showToast('신청금액을 입력하세요.');
      return;
    }
    if (amount > state.availableAmount) {
      showToast(`출금가능금액(${formatMoney(state.availableAmount)})을 초과할 수 없습니다.`);
      return;
    }
    void (async () => {
      if (submitBtn) submitBtn.disabled = true;
      const result = await window.BremStorage?.submitRiderWithdrawalToServer?.({
        weekStart: state.weekStart,
        amount
      });
      if (submitBtn) submitBtn.disabled = false;
      if (!result?.ok) {
        showToast(result?.message || '출금신청에 실패했습니다.');
        return;
      }
      showToast(`출금신청 완료 · ${formatMoney(amount)}`);
      if (amountInput) amountInput.value = '';
      await loadWithdrawal();
    })();
  });

  window.BremDriverWithdrawal = {
    open: openPanel,
    close: closePanel,
    refresh: loadWithdrawal
  };
})();

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
  const platformCoupang = document.getElementById('driverWithdrawalPlatformCoupang');
  const platformBaemin = document.getElementById('driverWithdrawalPlatformBaemin');
  const toast = document.getElementById('toast');

  if (!panel || !openBtn) return;

  const state = {
    weekStart: null,
    loading: false,
    visible: false,
    availableAmount: 0,
    enrolledPlatforms: { coupang: false, baemin: false },
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

  function formatPeriodSimple(weekStart) {
    const end = weekEndKey(weekStart);
    const utils = window.BremPayrollSlipUtils || window.BremDatePicker;
    if (utils?.formatWednesdayWeekRange) return utils.formatWednesdayWeekRange(weekStart);
    return `${weekStart} ~ ${end}`;
  }

  function platformLabel(platform) {
    if (platform === 'baemin') return '배민';
    if (platform === 'coupang') return '쿠팡';
    return '미지정';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function selectedPlatform() {
    const checked = form?.querySelector('input[name="driverWithdrawalPlatform"]:checked');
    return checked ? String(checked.value || '') : '';
  }

  function syncPlatformOptions(enrolled = {}) {
    const hasFlags = enrolled.coupang !== undefined || enrolled.baemin !== undefined;
    state.enrolledPlatforms = hasFlags
      ? { coupang: !!enrolled.coupang, baemin: !!enrolled.baemin }
      : { coupang: true, baemin: true };

    const coupangOk = state.enrolledPlatforms.coupang;
    const baeminOk = state.enrolledPlatforms.baemin;
    if (platformCoupang) {
      platformCoupang.disabled = !coupangOk;
      platformCoupang.closest('label')?.classList.toggle('is-disabled', !coupangOk);
    }
    if (platformBaemin) {
      platformBaemin.disabled = !baeminOk;
      platformBaemin.closest('label')?.classList.toggle('is-disabled', !baeminOk);
    }

    const current = selectedPlatform();
    if (current === 'coupang' && coupangOk) return;
    if (current === 'baemin' && baeminOk) return;
    if (platformCoupang) platformCoupang.checked = false;
    if (platformBaemin) platformBaemin.checked = false;
    if (coupangOk && platformCoupang) platformCoupang.checked = true;
    else if (baeminOk && platformBaemin) platformBaemin.checked = true;
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
    const by = payload.netPayByPlatform || {};
    const coupangNet = Math.max(0, Number(by.coupang || 0));
    const baeminNet = Math.max(0, Number(by.baemin || 0));
    if (hintEl) {
      if (payload.enrolled === false) {
        hintEl.textContent = '일정산 등록 기사가 아닙니다. 관리자에게 문의하세요.';
      } else {
        hintEl.textContent = `전체 ${formatMoney(payload.totalNetPay)} − 신청 ${formatMoney(payload.requestedTotal)} · 쿠팡실지급 ${formatMoney(coupangNet)} / 배민실지급 ${formatMoney(baeminNet)}`;
      }
    }
    if (amountInput) {
      amountInput.max = String(state.availableAmount || 0);
      if (Number(amountInput.value || 0) > state.availableAmount) {
        amountInput.value = state.availableAmount > 0 ? String(state.availableAmount) : '';
      }
    }
    syncPlatformOptions(payload.enrolledPlatforms || {});
  }

  function renderDays(days, showCallFee = true) {
    if (!daysBody) return;
    const list = Array.isArray(days) ? days : [];
    const colSpan = showCallFee ? 9 : 8;
    if (!list.length) {
      daysBody.innerHTML = `<tr><td colspan="${colSpan}" class="empty">표시할 일정산 내역이 없습니다.</td></tr>`;
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
        ${showCallFee ? `<td class="driver-withdrawal-call-fee">${formatMoney(row.callFee)}</td>` : ''}
        <td>${formatMoney(row.dailySettlementFee)}</td>
        <td class="driver-withdrawal-net"><strong>${formatMoney(row.netPay)}</strong></td>
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
      const completed = item.status === 'completed';
      const statusClass = cancelled ? ' is-cancelled' : (completed ? ' is-completed' : '');
      const badge = cancelled
        ? '<em class="driver-withdrawal-request__badge">취소됨</em>'
        : (completed
          ? '<em class="driver-withdrawal-request__badge is-completed">처리완료</em>'
          : '<em class="driver-withdrawal-request__badge is-pending">신청</em>');
      return `
      <li class="driver-withdrawal-request${statusClass}">
        <span class="driver-withdrawal-request__meta">
          ${escapeHtml(item.createdAt ? new Date(item.createdAt).toLocaleString('ko-KR') : '-')}
          · ${escapeHtml(platformLabel(item.platform))}
          ${badge}
        </span>
        <strong>${formatMoney(item.amount)}</strong>
      </li>`;
    }).join('');
  }

  function syncCallFeeHeader(showCallFee) {
    const table = panel.querySelector('.driver-withdrawal-table');
    if (!table) return;
    table.classList.toggle('hide-call-fee', !showCallFee);
    table.querySelectorAll('.driver-withdrawal-call-fee-head, .driver-withdrawal-call-fee').forEach(el => {
      el.hidden = !showCallFee;
    });
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
    const showCallFee = result.showCallFee !== false;
    syncCallFeeHeader(showCallFee);
    renderDays(result.days, showCallFee);
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
    const platform = selectedPlatform();
    if (!platform) {
      showToast('출금 플랫폼(쿠팡/배민)을 선택하세요.');
      return;
    }
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
        amount,
        platform
      });
      if (submitBtn) submitBtn.disabled = false;
      if (!result?.ok) {
        showToast(result?.message || '출금신청에 실패했습니다.');
        return;
      }
      showToast(`출금신청 완료 · ${platformLabel(platform)} · ${formatMoney(amount)}`);
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

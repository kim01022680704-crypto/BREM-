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
    feesByPlatform: { coupang: null, baemin: null },
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

  function resolveWithdrawalFee(amount, fees = {}) {
    const value = Math.max(0, Number(amount || 0));
    const mode = String(fees?.dailySettlementFeeMode || 'fixed').toLowerCase() === 'percent'
      ? 'percent'
      : 'fixed';
    const fee = Math.max(0, Number(fees?.dailySettlementFee || 0));
    if (mode === 'percent') return Math.floor(value * (fee / 100));
    return Math.max(0, Math.round(fee));
  }

  function estimateFeeForAmount(amount) {
    const platform = selectedPlatform() || 'coupang';
    const fees = state.feesByPlatform?.[platform] || state.feesByPlatform?.coupang || {};
    return resolveWithdrawalFee(amount, fees);
  }

  function maxWithdrawableAmount() {
    const available = Math.max(0, Number(state.availableAmount || 0));
    const platform = selectedPlatform() || 'coupang';
    const fees = state.feesByPlatform?.[platform] || state.feesByPlatform?.coupang || {};
    const mode = String(fees?.dailySettlementFeeMode || 'fixed').toLowerCase() === 'percent'
      ? 'percent'
      : 'fixed';
    const fee = Math.max(0, Number(fees?.dailySettlementFee || 0));
    if (mode === 'percent') {
      if (fee <= 0) return available;
      // amount + floor(amount * fee/100) <= available
      let lo = 0;
      let hi = available;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi + 1) / 2);
        if (mid + resolveWithdrawalFee(mid, fees) <= available) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }
    return Math.max(0, available - Math.round(fee));
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
    state.availableAmount = Number(payload.availableAmount || 0);
    state.feesByPlatform = payload.feesByPlatform || state.feesByPlatform || {};
    if (availableEl) {
      availableEl.textContent = formatMoney(state.availableAmount);
      availableEl.classList.toggle('is-negative', state.availableAmount < 0);
    }
    const by = payload.netPayByPlatform || {};
    const coupangNet = Number(by.coupang || 0);
    const baeminNet = Number(by.baemin || 0);
    const requestedAmount = Math.max(0, Number(payload.requestedAmountTotal || 0));
    const requestedFee = Math.max(0, Number(payload.requestedFeeTotal || 0));
    const lease = payload.lease || {};
    const leaseDeduction = Math.max(0, Number(lease.leaseDeductionTotal || 0));
    const outstandingArrears = Math.max(0, Number(lease.outstandingArrears || 0));
    const arrearReason = String(lease.arrearReason || '리스비 미납').trim() || '리스비 미납';
    const leaseText = leaseDeduction > 0
      ? ` − 리스비 ${formatMoney(leaseDeduction)}(${lease.deductionPlatform === 'baemin' ? '배민' : '쿠팡'})`
      : '';
    const unpaidEl = document.getElementById('driverWithdrawalUnpaid');
    if (unpaidEl) {
      if (outstandingArrears > 0) {
        unpaidEl.hidden = false;
        unpaidEl.textContent = `미납금 ${formatMoney(outstandingArrears)} (${arrearReason})`;
      } else {
        unpaidEl.hidden = true;
        unpaidEl.textContent = '';
      }
    }
    if (hintEl) {
      if (payload.enrolled === false) {
        hintEl.textContent = '일정산 등록 기사가 아닙니다. 관리자에게 문의하세요.';
      } else if (requestedFee > 0) {
        hintEl.textContent = `실지급 ${formatMoney(payload.totalNetPay)} − 신청 ${formatMoney(requestedAmount)} − 일출금수수료 ${formatMoney(requestedFee)}${leaseText} · 쿠팡 ${formatMoney(coupangNet)} / 배민 ${formatMoney(baeminNet)}`;
      } else {
        hintEl.textContent = `실지급 ${formatMoney(payload.totalNetPay)} − 신청(출금+일출금수수료) ${formatMoney(payload.requestedTotal)}${leaseText} · 쿠팡 ${formatMoney(coupangNet)} / 배민 ${formatMoney(baeminNet)}`;
      }
    }
    const maxAmount = maxWithdrawableAmount();
    if (amountInput) {
      amountInput.max = String(maxAmount || 0);
      if (Number(amountInput.value || 0) > maxAmount) {
        amountInput.value = maxAmount > 0 ? String(maxAmount) : '';
      }
    }
    syncPlatformOptions(payload.enrolledPlatforms || {});
    updateFeePreview();
  }

  function updateFeePreview() {
    const preview = document.getElementById('driverWithdrawalFeePreview');
    if (!preview) return;
    const amount = Math.max(0, Math.round(Number(amountInput?.value || 0)));
    if (!amount) {
      preview.textContent = '일출금수수료(출금시적용)는 신청금액 기준으로 차감됩니다.';
      return;
    }
    const fee = estimateFeeForAmount(amount);
    const consume = amount + fee;
    preview.textContent = fee > 0
      ? `예상 차감: 출금 ${formatMoney(amount)} + 일출금수수료 ${formatMoney(fee)} = ${formatMoney(consume)} (가능 ${formatMoney(state.availableAmount)})`
      : `예상 차감: ${formatMoney(amount)} (일출금수수료 없음)`;
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
        ${Number(item.feeAmount || 0) > 0
          ? `<em class="driver-withdrawal-request__fee">일출금수수료 ${formatMoney(item.feeAmount)}</em>`
          : ''}
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
    if (state.availableAmount < 0) {
      showToast(`리스비·미납 차감으로 출금가능금액이 ${formatMoney(state.availableAmount)} 입니다. 정산/미납회수 후 신청하세요.`);
      return;
    }
    const feeAmount = estimateFeeForAmount(amount);
    const consume = amount + feeAmount;
    if (consume > state.availableAmount) {
      showToast(feeAmount > 0
        ? `출금 ${formatMoney(amount)} + 일출금수수료 ${formatMoney(feeAmount)}가 출금가능금액(${formatMoney(state.availableAmount)})을 초과합니다.`
        : `출금가능금액(${formatMoney(state.availableAmount)})을 초과할 수 없습니다.`);
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
      const appliedFee = Math.max(0, Number(result.feeAmount ?? feeAmount));
      showToast(appliedFee > 0
        ? `출금신청 완료 · ${platformLabel(platform)} · ${formatMoney(amount)} (일출금수수료 ${formatMoney(appliedFee)})`
        : `출금신청 완료 · ${platformLabel(platform)} · ${formatMoney(amount)}`);
      if (amountInput) amountInput.value = '';
      await loadWithdrawal();
    })();
  });

  amountInput?.addEventListener('input', updateFeePreview);
  platformCoupang?.addEventListener('change', updateFeePreview);
  platformBaemin?.addEventListener('change', updateFeePreview);

  window.BremDriverWithdrawal = {
    open: openPanel,
    close: closePanel,
    refresh: loadWithdrawal
  };
})();

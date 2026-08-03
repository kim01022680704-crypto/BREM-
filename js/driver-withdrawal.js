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
  const maxBtn = document.getElementById('driverWithdrawalMaxBtn');
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
    availableByPlatform: { coupang: 0, baemin: 0 },
    netPayByPlatform: { coupang: 0, baemin: 0 },
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

  function platformAvailableAmount(platform = selectedPlatform()) {
    const key = platform === 'baemin' ? 'baemin' : (platform === 'coupang' ? 'coupang' : '');
    if (!key) return Math.max(0, Number(state.availableAmount || 0));
    if (state.availableByPlatform && state.availableByPlatform[key] != null) {
      return Number(state.availableByPlatform[key] || 0);
    }
    return Math.max(0, Number(state.availableAmount || 0));
  }

  function maxWithdrawableAmount() {
    const platform = selectedPlatform() || 'coupang';
    const available = Math.max(0, platformAvailableAmount(platform));
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
    state.availableByPlatform = {
      coupang: Number(payload.availableByPlatform?.coupang || 0),
      baemin: Number(payload.availableByPlatform?.baemin || 0)
    };
    state.netPayByPlatform = {
      coupang: Number(payload.netPayByPlatform?.coupang || 0),
      baemin: Number(payload.netPayByPlatform?.baemin || 0)
    };
    state.weekFinalized = payload.weekFinalized === true;
    state.withdrawalPaused = payload.withdrawalPaused === true;
    state.feesByPlatform = payload.feesByPlatform || state.feesByPlatform || {};
    // 출금가능금액(헤드라인) = 선택한 플랫폼의 최대 신청 가능액 (수수료 감안)
    const maxRequestable = Math.max(0, maxWithdrawableAmount());
    const by = state.netPayByPlatform;
    const avail = state.availableByPlatform;
    const lease = payload.lease || {};
    const leaseDeduction = Math.max(0, Number(lease.leaseDeductionTotal || 0));
    const outstandingArrears = Math.max(0, Number(lease.outstandingArrears || 0));
    const ledgerCharge = Math.max(0, Number(lease.ledgerCharge || 0));
    const leaseChargeOnly = Math.max(0, Number(lease.leaseCharge || 0));
    const arrearReason = String(lease.arrearReason || '리스비 미납').trim() || '리스비 미납';
    const deductParts = [];
    if (leaseChargeOnly > 0) deductParts.push(`리스차감 ${formatMoney(leaseChargeOnly)}`);
    if (ledgerCharge > 0) deductParts.push(`대여·차감관리 ${formatMoney(ledgerCharge)}`);
    if (outstandingArrears > 0 && leaseDeduction > leaseChargeOnly + ledgerCharge) {
      // 미납은 별도 배너로도 표시
    }
    const leaseText = deductParts.length
      ? ` · ${deductParts.join(' · ')}(실지급 큰 쪽부터 홀드 · 마이너스 가능)`
      : (leaseDeduction > 0
        ? ` · 리스·대여차감 ${formatMoney(leaseDeduction)}(실지급 큰 쪽부터 홀드 · 마이너스 가능)`
        : '');
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
    const pausedBanner = document.getElementById('driverWithdrawalPausedBanner');
    if (pausedBanner) {
      if (payload.withdrawalPaused) {
        pausedBanner.hidden = false;
        pausedBanner.textContent = '정산중엔 출금신청정지';
      } else {
        pausedBanner.hidden = true;
        pausedBanner.textContent = '';
      }
    }
    if (hintEl) {
      if (payload.withdrawalPaused) {
        hintEl.textContent = '정산 처리 중입니다. 출금신청이 일시 정지되어 있습니다.';
      } else if (payload.weekFinalized) {
        hintEl.textContent = `주정산 마무리됨 · 출금가능금액 0원 (${payload.weekStart || '-'} ~ ${payload.weekEnd || '-'})`;
      } else if (payload.enrolled === false) {
        hintEl.textContent = '일정산 등록 기사가 아닙니다. 관리자에게 문의하세요.';
      } else {
        const platform = selectedPlatform();
        const platformPart = platform
          ? `선택 ${platformLabel(platform)} 출금가능 ${formatMoney(platformAvailableAmount(platform))}`
          : '플랫폼을 선택하세요';
        hintEl.textContent = `쿠팡 실지급 ${formatMoney(by.coupang)} / 출금가능 ${formatMoney(avail.coupang)} · 배민 실지급 ${formatMoney(by.baemin)} / 출금가능 ${formatMoney(avail.baemin)}${leaseText} · ${platformPart}`;
      }
    }
    syncPlatformOptions(payload.enrolledPlatforms || {});
    syncMaxUi();
    if (submitBtn) {
      const blocked = payload.withdrawalPaused === true || payload.weekFinalized === true;
      submitBtn.disabled = blocked;
      submitBtn.textContent = payload.withdrawalPaused
        ? '정산중엔 출금신청정지'
        : (payload.weekFinalized ? '주정산 마무리됨' : '출금 신청하기');
    }
  }

  // 헤드라인 = 실제 출금가능(마이너스 표시) / 입력 max = 신청 가능액(0 이상)
  // 플랫폼별 수수료가 다를 수 있어 플랫폼 변경 시에도 호출한다.
  function syncMaxUi() {
    const maxRequestable = Math.max(0, maxWithdrawableAmount());
    const displayAvailable = selectedPlatform()
      ? Number(platformAvailableAmount(selectedPlatform()) || 0)
      : Number(state.availableAmount || 0);
    if (availableEl) {
      availableEl.textContent = formatMoney(displayAvailable);
      availableEl.classList.toggle('is-negative', displayAvailable < 0);
    }
    if (amountInput) {
      amountInput.max = String(maxRequestable || 0);
      if (Number(amountInput.value || 0) > maxRequestable) {
        amountInput.value = maxRequestable > 0 ? String(maxRequestable) : '';
      }
    }
    updateFeePreview();
  }

  function updateFeePreview() {
    const preview = document.getElementById('driverWithdrawalFeePreview');
    if (!preview) return;
    const amount = Math.max(0, Math.round(Number(amountInput?.value || 0)));
    if (!amount) {
      preview.textContent = '일정산수수료(2%)는 신청금액 기준으로 출금 시 차감됩니다.';
      return;
    }
    const fee = estimateFeeForAmount(amount);
    const consume = amount + fee;
    preview.textContent = fee > 0
      ? `예상: 신청 ${formatMoney(amount)} 수령 · 일정산수수료 ${formatMoney(fee)} · 실지급에서 ${formatMoney(consume)} 차감`
      : `예상: ${formatMoney(amount)} 수령 (일정산수수료 없음)`;
  }

  function renderDays(days, showCallFee = true) {
    if (!daysBody) return;
    const list = Array.isArray(days) ? days : [];
    // 날짜·플랫폼·정산금액·고용·산재·시간제·원천세·(콜)·일정산수수료·실지급
    const colSpan = showCallFee ? 10 : 9;
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
        <td>${formatMoney(row.hourlyInsurance)}</td>
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
          ? `<em class="driver-withdrawal-request__fee">일정산수수료 ${formatMoney(item.feeAmount)}</em>`
          : ''}
      </li>`;
    }).join('');
  }

  // 실지급 합계 ↔ 출금수령+수수료 가 맞아 떨어지는지 한눈에 보여준다.
  // (일별 실지급 ≠ 각 출금액 — 출금은 주 단위 주머니에서 빠지기 때문)
  function renderReconcile(payload) {
    const el = document.getElementById('driverWithdrawalReconcile');
    if (!el) return;
    const list = (Array.isArray(payload?.myRequests) ? payload.myRequests : [])
      .filter(item => item.status === 'pending' || item.status === 'completed');
    if (!list.length) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    const totalNet = Math.max(0, Math.round(Number(payload.totalNetPay || 0)));
    const recv = list.reduce((sum, item) => sum + Math.max(0, Math.round(Number(item.amount || 0))), 0);
    const fee = list.reduce((sum, item) => sum + Math.max(0, Math.round(Number(item.feeAmount || 0))), 0);
    const consumed = recv + fee;
    const leaseDeduction = Math.max(0, Math.round(Number(payload.lease?.leaseDeductionTotal || 0)));
    const remain = Math.max(0, Math.round(Number(payload.availableAmount || 0)));
    const accounted = consumed + remain + leaseDeduction;
    const match = totalNet === accounted;
    el.hidden = false;
    const leaseText = leaseDeduction > 0 ? ` + 리스차감 <strong>${formatMoney(leaseDeduction)}</strong>` : '';
    const remainText = remain > 0 ? ` + 잔액 <strong>${formatMoney(remain)}</strong>` : '';
    el.innerHTML = match
      ? `대조: 실지급 합계 <strong>${formatMoney(totalNet)}</strong> = 출금수령 <strong>${formatMoney(recv)}</strong> + 일정산수수료 <strong>${formatMoney(fee)}</strong>${leaseText}${remainText} · 맞음`
      : `대조: 실지급 <strong>${formatMoney(totalNet)}</strong> · 출금수령 <strong>${formatMoney(recv)}</strong> + 수수료 <strong>${formatMoney(fee)}</strong> = <strong>${formatMoney(consumed)}</strong>${leaseText}${remainText}`;
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
    renderReconcile(result);

    const noDays = !Array.isArray(result.days) || !result.days.length;
    if (emptyEl) {
      emptyEl.hidden = result.enrolled !== false && !noDays;
      if (result.enrolled === false && emptyTextEl) {
        emptyTextEl.textContent = '일정산 등록 기사가 아닙니다. 관리자에게 문의하세요.';
      } else if (noDays && emptyTextEl) {
        emptyTextEl.textContent = result.withdrawalPaused
          ? '정산중엔 출금신청정지'
          : (result.weekFinalized
            ? `주정산 마무리됨 · 출금가능금액 0원 (${result.weekStart || '-'} ~ ${result.weekEnd || '-'})`
            : '해당 주차에 매칭된 일정산 내역이 없습니다.');
      }
    }
    if (contentEl) contentEl.hidden = result.enrolled === false;
  }

  function openPanel() {
    document.getElementById('driverWeeklyPayslipPanel')?.setAttribute('hidden', '');
    document.getElementById('driverWeeklyPayslipBtn')?.setAttribute('aria-expanded', 'false');
    window.BremDriverRegionDashboard?.close?.();
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
    if (state.withdrawalPaused) {
      showToast('정산중엔 출금신청정지 · 정산 처리가 끝난 뒤 다시 신청해 주세요.');
      return;
    }
    if (state.weekFinalized) {
      showToast('주정산 마무리가 완료된 주입니다. 출금신청할 수 없습니다.');
      return;
    }
    const platformPool = platformAvailableAmount(platform);
    if (platformPool < 0) {
      showToast(`리스차감·대여차감·미납으로 ${platformLabel(platform)} 출금가능금액이 ${formatMoney(platformPool)} 입니다. 정산/미납회수 후 신청하세요.`);
      return;
    }
    const feeAmount = estimateFeeForAmount(amount);
    const consume = amount + feeAmount;
    if (consume > platformPool) {
      showToast(feeAmount > 0
        ? `출금 ${formatMoney(amount)} + 일정산수수료 ${formatMoney(feeAmount)}가 ${platformLabel(platform)} 출금가능금액(${formatMoney(platformPool)})을 초과합니다.`
        : `${platformLabel(platform)} 출금가능금액(${formatMoney(platformPool)})을 초과할 수 없습니다.`);
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
        ? `출금신청 완료 · ${platformLabel(platform)} · ${formatMoney(amount)} (일정산수수료 ${formatMoney(appliedFee)})`
        : `출금신청 완료 · ${platformLabel(platform)} · ${formatMoney(amount)}`);
      if (amountInput) amountInput.value = '';
      await loadWithdrawal();
    })();
  });

  amountInput?.addEventListener('input', updateFeePreview);
  platformCoupang?.addEventListener('change', () => {
    if (hintEl && !state.withdrawalPaused && !state.weekFinalized) {
      const by = state.netPayByPlatform || {};
      const avail = state.availableByPlatform || {};
      const platform = selectedPlatform();
      const platformPart = platform
        ? `선택 ${platformLabel(platform)} 출금가능 ${formatMoney(platformAvailableAmount(platform))}`
        : '플랫폼을 선택하세요';
      hintEl.textContent = `쿠팡 실지급 ${formatMoney(by.coupang)} / 출금가능 ${formatMoney(avail.coupang)} · 배민 실지급 ${formatMoney(by.baemin)} / 출금가능 ${formatMoney(avail.baemin)} · ${platformPart}`;
    }
    syncMaxUi();
  });
  platformBaemin?.addEventListener('change', () => {
    platformCoupang?.dispatchEvent(new Event('change'));
  });
  maxBtn?.addEventListener('click', () => {
    const max = Math.max(0, maxWithdrawableAmount());
    if (amountInput) {
      amountInput.value = max > 0 ? String(max) : '';
      updateFeePreview();
      amountInput.focus();
    }
  });

  // 계정 전환(로그아웃 → 다른 기사 로그인) 시 이전 기사의 금액이 화면에 남지 않도록 전부 비운다.
  // requestSeq 를 올려 아직 응답이 안 온 이전 계정의 조회 결과도 무효화한다.
  function resetPanel() {
    state.requestSeq += 1;
    state.weekStart = null;
    state.loading = false;
    state.availableAmount = 0;
    state.availableByPlatform = { coupang: 0, baemin: 0 };
    state.netPayByPlatform = { coupang: 0, baemin: 0 };
    state.weekFinalized = false;
    state.withdrawalPaused = false;
    state.enrolledPlatforms = { coupang: false, baemin: false };
    state.feesByPlatform = { coupang: null, baemin: null };
    setOpenState(false);
    if (daysBody) daysBody.innerHTML = '';
    if (requestList) requestList.innerHTML = '';
    if (periodEl) periodEl.textContent = '';
    if (availableEl) {
      availableEl.textContent = formatMoney(0);
      availableEl.classList.remove('is-negative');
    }
    if (hintEl) hintEl.textContent = '';
    if (amountInput) {
      amountInput.value = '';
      amountInput.removeAttribute('max');
    }
    const reconcileEl = document.getElementById('driverWithdrawalReconcile');
    if (reconcileEl) {
      reconcileEl.hidden = true;
      reconcileEl.textContent = '';
    }
    if (contentEl) contentEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
    if (emptyTextEl) emptyTextEl.textContent = '';
  }

  window.BremDriverWithdrawal = {
    open: openPanel,
    close: closePanel,
    refresh: loadWithdrawal,
    reset: resetPanel
  };
})();

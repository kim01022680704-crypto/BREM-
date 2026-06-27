(function () {
  const panel = document.getElementById('driverWeeklyPayslipPanel');
  const openBtn = document.getElementById('driverWeeklyPayslipBtn');
  const closeBtn = document.getElementById('driverWeeklyPayslipCloseBtn');
  const prevBtn = document.getElementById('driverPayslipPrevWeekBtn');
  const nextBtn = document.getElementById('driverPayslipNextWeekBtn');
  const periodEl = document.getElementById('driverPayslipPeriod');
  const paymentDateEl = document.getElementById('driverPayslipPaymentDate');
  const emptyEl = document.getElementById('driverPayslipEmpty');
  const contentEl = document.getElementById('driverPayslipContent');
  const toast = document.getElementById('toast');
  const utils = window.BremPayrollSlipUtils;

  if (!panel || !openBtn) return;

  const CACHE_TTL_MS = 90 * 1000;
  const cache = new Map();
  let prefetchToken = 0;

  const state = {
    weekStart: null,
    loading: false,
    visible: false,
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

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    }).format(date);
  }

  function formatDateCompact(value) {
    if (!value) return '-';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function weekStartKey(dateValue) {
    const date = new Date(`${String(dateValue || '').slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return formatLocalDateKey(date);
  }

  function weekEndKey(weekStart) {
    if (utils?.settlementWeekEnd) return utils.settlementWeekEnd(weekStart);
    const date = new Date(`${weekStart}T00:00:00`);
    date.setDate(date.getDate() + 6);
    return formatLocalDateKey(date);
  }

  function addDaysKey(dateKey, days) {
    const date = new Date(`${dateKey}T00:00:00`);
    date.setDate(date.getDate() + days);
    return formatLocalDateKey(date);
  }

  function currentWeekStart() {
    return weekStartKey(formatLocalDateKey(new Date()));
  }

  function defaultPaymentDate(weekStart) {
    if (utils?.defaultPaymentDateForWeek) return utils.defaultPaymentDateForWeek(weekStart);
    const end = weekEndKey(weekStart);
    return end ? addDaysKey(end, 3) : '';
  }

  function formatPeriodLabel(weekStart, weekEnd, fallbackLabel) {
    if (fallbackLabel) return fallbackLabel;
    const compact = window.matchMedia('(max-width: 720px)').matches;
    if (compact) {
      return `${formatDateCompact(weekStart)} ~ ${formatDateCompact(weekEnd)}`;
    }
    return `${formatDate(weekStart)} ~ ${formatDate(weekEnd)}`;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderPayRow(label, amount, description = '') {
    return `
      <tr>
        <th scope="row">${label}</th>
        <td>${description || '-'}</td>
        <td class="payslip-money">${formatMoney(amount)}</td>
      </tr>
    `;
  }

  const NOTICE_LABELS = {
    urgent: '긴급',
    notice: '안내',
    announcement: '공지'
  };

  function renderNotices(notices) {
    const section = document.getElementById('driverPayslipNoticesSection');
    const listEl = document.getElementById('driverPayslipNoticeList');
    const items = Array.isArray(notices) ? notices : [];
    if (!section || !listEl) return;
    if (!items.length) {
      section.hidden = true;
      listEl.innerHTML = '';
      return;
    }
    section.hidden = false;
    listEl.innerHTML = items.map(item => {
      const label = NOTICE_LABELS[item.label] || '안내';
      const dateText = item.publishedAt
        ? formatDateCompact(String(item.publishedAt).slice(0, 10))
        : '';
      return `
        <li class="driver-payslip-notice-item">
          <span class="driver-payslip-notice-badge driver-payslip-notice-badge--${escapeHtml(item.label || 'notice')}">${escapeHtml(label)}</span>
          <div class="driver-payslip-notice-copy">
            <strong>${escapeHtml(item.title || '-')}</strong>
            <p>${escapeHtml(item.body || '')}</p>
            ${dateText ? `<time>${escapeHtml(dateText)}</time>` : ''}
          </div>
        </li>
      `;
    }).join('');
  }

  function renderWeekShell(weekStart, options = {}) {
    const weekEnd = options.settlementWeekEnd || weekEndKey(weekStart);
    const paymentDate = options.paymentDate || defaultPaymentDate(weekStart);
    if (periodEl) {
      periodEl.textContent = formatPeriodLabel(
        weekStart,
        weekEnd,
        options.settlementWeekLabel
      );
    }
    if (paymentDateEl) paymentDateEl.textContent = formatDateCompact(paymentDate);
    updateWeekNavButtons(weekStart);
  }

  function applyPayslipResult(result) {
    if (!result) return;
    state.weekStart = result.settlementWeekStart || state.weekStart;
    renderWeekShell(state.weekStart, {
      settlementWeekEnd: result.settlementWeekEnd,
      settlementWeekLabel: result.settlementWeekLabel,
      paymentDate: result.paymentDate
    });

    if (!result.hasPayslip) {
      if (emptyEl) emptyEl.hidden = false;
      if (contentEl) contentEl.hidden = true;
      setText('driverPayslipRiderName', result.rider?.name || '-');
      setText('driverPayslipCoupangId', result.rider?.coupangId || '-');
      setText('driverPayslipBaeminId', result.rider?.baeminId || '-');
      setText('driverPayslipLeaseStatus', result.lease?.leaseLabel || '없음');
      setText('driverPayslipLeaseFee', result.lease?.leaseFee ? formatMoney(result.lease.leaseFee) : '-');
      setText('driverPayslipLeaseUnpaid', result.lease?.unpaidAmount ? formatMoney(result.lease.unpaidAmount) : '-');
      renderNotices(result.notices);
      return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (contentEl) contentEl.hidden = false;
    renderPayslip(result);
  }

  function renderPayslip(data) {
    const payslip = data.payslip || {};
    const lease = data.lease || {};
    const rider = data.rider || {};

    setText('driverPayslipRiderName', rider.name || payslip.riderName || '-');
    setText('driverPayslipCoupangId', rider.coupangId || payslip.coupangId || '-');
    setText('driverPayslipBaeminId', rider.baeminId || payslip.baeminId || '-');
    setText('driverPayslipLeaseStatus', lease.leaseLabel || '없음');
    setText('driverPayslipLeaseFee', lease.leaseFee ? formatMoney(lease.leaseFee) : '-');
    setText('driverPayslipLeaseUnpaid', lease.unpaidAmount ? formatMoney(lease.unpaidAmount) : '-');

    const gross = payslip.grossPaymentTotal || 0;
    const deduct = payslip.deductionTotal || 0;
    const leaseDeduct = Number(lease.leaseFee || 0) + Number(lease.unpaidAmount || 0);
    const totalDeduct = deduct + leaseDeduct;
    const net = Math.max(0, gross - totalDeduct);

    setText('driverPayslipGrossTotal', formatMoney(gross));
    setText('driverPayslipDeductTotal', formatMoney(totalDeduct));
    setText('driverPayslipNetTotal', formatMoney(payslip.finalNetPay || net));

    const payBody = document.getElementById('driverPayslipPayRows');
    const deductBody = document.getElementById('driverPayslipDeductRows');
    if (payBody) {
      payBody.innerHTML = [
        renderPayRow('배달비', payslip.totalDeliveryFee, '배달료'),
        renderPayRow('배민미션', payslip.baeminMission),
        renderPayRow('기타지급', payslip.otherPayment),
        renderPayRow('BREM프로모션', payslip.bremPromotion),
        renderPayRow('지급합계', gross, '합계')
      ].join('');
    }
    if (deductBody) {
      const rows = [
        renderPayRow('고용보험', payslip.employmentInsurance),
        renderPayRow('산재보험', payslip.industrialAccidentInsurance),
        renderPayRow('시간제보험', payslip.hourlyInsurance),
        renderPayRow('원천세', payslip.withholdingTax),
        renderPayRow('프로모션원천세', payslip.promotionWithholdingTax),
        renderPayRow('콜수수료', payslip.callFee),
        renderPayRow('일정산수수료', payslip.dailySettlementFee)
      ];
      if (lease.hasLease) {
        rows.push(renderPayRow('리스비', lease.leaseFee, lease.vehicleNumber || '리스/렌탈'));
      }
      if (lease.unpaidAmount) {
        rows.push(renderPayRow('미납', lease.unpaidAmount, '리스관리'));
      }
      rows.push(renderPayRow('공제합계', totalDeduct, '합계'));
      deductBody.innerHTML = rows.join('');
    }

    setText('driverPayslipFormulaGross', formatMoney(gross));
    setText('driverPayslipFormulaDeduct', formatMoney(totalDeduct));
    setText('driverPayslipFormulaWithholding', formatMoney(payslip.withholdingTax || 0));
    setText('driverPayslipFormulaNet', formatMoney(payslip.finalNetPay || net));
    renderNotices(data.notices);
  }

  async function fetchPayslip(weekStart) {
    const cached = cache.get(weekStart);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.data;
    }
    const result = await BremStorage.fetchRiderWeeklyPayslipFromServer(weekStart);
    if (result?.ok) {
      cache.set(weekStart, { at: Date.now(), data: result });
    }
    return result;
  }

  function prefetchAdjacentWeeks(weekStart) {
    const token = ++prefetchToken;
    [addDaysKey(weekStart, -7), addDaysKey(weekStart, 7)].forEach(key => {
      const normalized = weekStartKey(key);
      if (!normalized || cache.has(normalized)) return;
      void fetchPayslip(normalized).then(result => {
        if (token !== prefetchToken) return;
        return result;
      }).catch(() => {});
    });
  }

  async function loadPayslip(options = {}) {
    const weekStart = state.weekStart || currentWeekStart();
    state.weekStart = weekStartKey(weekStart);

    if (!options.silent) {
      renderWeekShell(state.weekStart);
    }

    const cached = cache.get(state.weekStart);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      applyPayslipResult(cached.data);
      if (!state.loading) prefetchAdjacentWeeks(state.weekStart);
      return;
    }

    if (state.loading) return;
    state.loading = true;
    const requestSeq = ++state.requestSeq;
    panel.classList.add('is-loading');

    try {
      const result = await fetchPayslip(state.weekStart);
      if (requestSeq !== state.requestSeq) return;
      if (!result.ok) {
        throw new Error(result.message || result.error || '주급명세서를 불러오지 못했습니다.');
      }
      applyPayslipResult(result);
      prefetchAdjacentWeeks(state.weekStart);
    } catch (error) {
      if (requestSeq !== state.requestSeq) return;
      console.error('[driver weekly payslip]', error);
      showToast(error.message || '주급명세서를 불러오지 못했습니다.');
    } finally {
      if (requestSeq === state.requestSeq) {
        state.loading = false;
        panel.classList.remove('is-loading');
        updateWeekNavButtons(state.weekStart);
      }
    }
  }

  function updateWeekNavButtons(weekStart = state.weekStart) {
    const latestWeek = currentWeekStart();
    const normalized = weekStartKey(weekStart || latestWeek);
    if (nextBtn) nextBtn.disabled = normalized >= latestWeek;
    if (prevBtn) prevBtn.disabled = false;
  }

  function shiftWeek(delta) {
    const base = state.weekStart || currentWeekStart();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + (delta * 7));
    const nextWeek = weekStartKey(formatLocalDateKey(date));
    if (delta > 0 && nextWeek > currentWeekStart()) {
      state.weekStart = currentWeekStart();
    } else {
      state.weekStart = nextWeek;
    }
    renderWeekShell(state.weekStart);
    void loadPayslip({ silent: true });
  }

  function openPanel() {
    state.visible = true;
    panel.hidden = false;
    if (!state.weekStart) state.weekStart = currentWeekStart();
    openBtn.setAttribute('aria-expanded', 'true');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    void loadPayslip();
  }

  function closePanel() {
    state.visible = false;
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
  }

  openBtn.addEventListener('click', () => {
    if (state.visible) {
      closePanel();
      return;
    }
    openPanel();
  });
  closeBtn?.addEventListener('click', closePanel);
  prevBtn?.addEventListener('click', () => shiftWeek(-1));
  nextBtn?.addEventListener('click', () => shiftWeek(1));

  window.BremDriverWeeklyPayslip = {
    open: openPanel,
    reload: loadPayslip,
    invalidateCache() {
      cache.clear();
    }
  };
})();

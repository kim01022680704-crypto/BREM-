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

  if (!panel || !openBtn) return;

  const state = {
    weekStart: null,
    loading: false,
    visible: false
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
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekEndKey(weekStart) {
    const date = new Date(`${weekStart}T00:00:00`);
    date.setDate(date.getDate() + 6);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function currentWeekStart() {
    return weekStartKey(new Date().toISOString().slice(0, 10));
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
        ? formatDate(String(item.publishedAt).slice(0, 10))
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

  function renderPayslip(data) {
    const payslip = data.payslip || {};
    const lease = data.lease || {};
    const rider = data.rider || {};

    if (periodEl) {
      periodEl.textContent = data.settlementWeekLabel
        || `${formatDate(data.settlementWeekStart)} ~ ${formatDate(data.settlementWeekEnd)}`;
    }
    if (paymentDateEl) paymentDateEl.textContent = formatDate(data.paymentDate);

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
        renderPayRow('배달비', payslip.totalDeliveryFee, '배달료 합계'),
        renderPayRow('배민미션', payslip.baeminMission),
        renderPayRow('기타지급', payslip.otherPayment),
        renderPayRow('BREM프로모션', payslip.bremPromotion),
        renderPayRow('지급합계', gross, '지급 총액')
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
        rows.push(renderPayRow('미납', lease.unpaidAmount, '리스관리 미납'));
      }
      rows.push(renderPayRow('공제합계', totalDeduct, '공제 총액'));
      deductBody.innerHTML = rows.join('');
    }

    setText('driverPayslipFormulaGross', formatMoney(gross));
    setText('driverPayslipFormulaDeduct', formatMoney(totalDeduct));
    setText('driverPayslipFormulaWithholding', formatMoney(payslip.withholdingTax || 0));
    setText('driverPayslipFormulaNet', formatMoney(payslip.finalNetPay || net));
    renderNotices(data.notices);
  }

  async function loadPayslip() {
    if (state.loading) return;
    state.loading = true;
    panel.classList.add('is-loading');

    try {
      const result = await BremStorage.fetchRiderWeeklyPayslipFromServer(state.weekStart);
      if (!result.ok) {
        throw new Error(result.message || result.error || '주급명세서를 불러오지 못했습니다.');
      }

      state.weekStart = result.settlementWeekStart || state.weekStart;

      if (!result.hasPayslip) {
        if (emptyEl) emptyEl.hidden = false;
        if (contentEl) contentEl.hidden = true;
        renderNotices(result.notices);
        if (periodEl) {
          periodEl.textContent = result.settlementWeekLabel
            || `${formatDate(result.settlementWeekStart)} ~ ${formatDate(result.settlementWeekEnd)}`;
        }
        if (paymentDateEl) paymentDateEl.textContent = formatDate(result.paymentDate);
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
    } catch (error) {
      console.error('[driver weekly payslip]', error);
      showToast(error.message || '주급명세서를 불러오지 못했습니다.');
    } finally {
      state.loading = false;
      panel.classList.remove('is-loading');
      updateWeekNavButtons();
    }
  }

  function updateWeekNavButtons() {
    const latestWeek = currentWeekStart();
    if (nextBtn) nextBtn.disabled = state.weekStart >= latestWeek;
  }

  function shiftWeek(delta) {
    const date = new Date(`${state.weekStart || currentWeekStart()}T00:00:00`);
    date.setDate(date.getDate() + (delta * 7));
    state.weekStart = weekStartKey(date.toISOString().slice(0, 10));
    void loadPayslip();
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
    reload: loadPayslip
  };
})();

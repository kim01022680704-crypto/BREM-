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
    requestSeq: 0,
    platform: 'total', // total | coupang | baemin
    lastResult: null
  };

  // 정산결과(직계약)과 동일한 지급·공제 틀
  const PAY_ROWS = Object.freeze([
    { key: 'deliveryFee', label: '배달비' },
    { key: 'missionPay', label: '추가지급(미션)' },
    { key: 'other', label: '기타지급' },
    { key: 'promo', label: 'BREM프로모션' },
    { key: 'grossPay', label: '지급합계', total: true }
  ]);

  const DEDUCT_ROWS = Object.freeze([
    { key: 'deductionDetail', label: '차감내역' },
    { key: 'employmentInsurance', label: '고용보험' },
    { key: 'accidentInsurance', label: '산재보험' },
    { key: 'hourlyInsurance', label: '시간제보험' },
    { key: 'withholdingTax', label: '원천세' },
    { key: 'promotionWithholdingTax', label: '프로모션원천세' },
    { key: 'callFee', label: '콜수수료' },
    { key: 'dailySettlementFee', label: '일정산수수료' },
    { key: 'prepaid', label: '선정산(처리완료)' },
    { key: 'leaseFee', label: '리스차감' },
    { key: 'loanFee', label: '대여차감' },
    { key: 'deductTotal', label: '공제합계', total: true }
  ]);

  function emptyBucket() {
    return {
      callCount: 0,
      deliveryFee: 0,
      missionPay: 0,
      other: 0,
      promo: 0,
      grossPay: 0,
      deductionDetail: 0,
      employmentInsurance: 0,
      accidentInsurance: 0,
      hourlyInsurance: 0,
      withholdingTax: 0,
      promotionWithholdingTax: 0,
      callFee: 0,
      dailySettlementFee: 0,
      prepaid: 0,
      leaseFee: 0,
      loanFee: 0,
      deductTotal: 0,
      netPay: 0
    };
  }

  function normalizeBucket(source = {}) {
    const bucket = emptyBucket();
    bucket.callCount = Number(source.callCount || 0);
    bucket.deliveryFee = Number(source.deliveryFee ?? source.totalDeliveryFee ?? 0);
    bucket.missionPay = Number(source.missionPay ?? source.baeminMission ?? 0);
    bucket.other = Number(source.other ?? source.otherPayment ?? 0);
    bucket.promo = Number(source.promo ?? source.bremPromotion ?? 0);
    bucket.deductionDetail = Number(source.deductionDetail || 0);
    bucket.employmentInsurance = Number(source.employmentInsurance || 0);
    bucket.accidentInsurance = Number(
      source.accidentInsurance ?? source.industrialAccidentInsurance ?? 0
    );
    bucket.hourlyInsurance = Number(source.hourlyInsurance || 0);
    bucket.withholdingTax = Number(source.withholdingTax || 0);
    bucket.promotionWithholdingTax = Number(source.promotionWithholdingTax || 0);
    bucket.callFee = Number(source.callFee || 0);
    bucket.dailySettlementFee = Number(source.dailySettlementFee || 0);
    bucket.prepaid = Number(source.prepaid || 0);
    bucket.leaseFee = Number(source.leaseFee || 0);
    bucket.loanFee = Number(source.loanFee || 0);
    bucket.grossPay = Number(source.grossPay ?? source.grossPaymentTotal ?? 0)
      || (bucket.deliveryFee + bucket.missionPay + bucket.other + bucket.promo);
    bucket.deductTotal = Number(source.deductTotal ?? source.deductionTotal ?? 0)
      || (
        bucket.deductionDetail
        + bucket.employmentInsurance
        + bucket.accidentInsurance
        + bucket.hourlyInsurance
        + bucket.withholdingTax
        + bucket.promotionWithholdingTax
        + bucket.callFee
        + bucket.dailySettlementFee
        + bucket.prepaid
        + bucket.leaseFee
        + bucket.loanFee
      );
    bucket.netPay = Number(source.netPay ?? source.finalNetPay ?? 0)
      || (bucket.grossPay - bucket.deductTotal);
    return bucket;
  }

  function resolvePlatformBucket(payslip, platform) {
    const platforms = payslip?.platforms || {};
    if (platform === 'coupang') return normalizeBucket(platforms.coupang || {});
    if (platform === 'baemin') return normalizeBucket(platforms.baemin || {});
    if (platforms.coupang || platforms.baemin) {
      const total = emptyBucket();
      const keys = Object.keys(total);
      [platforms.coupang, platforms.baemin].forEach(side => {
        const row = normalizeBucket(side || {});
        keys.forEach(key => { total[key] += Number(row[key] || 0); });
      });
      return normalizeBucket(total);
    }
    return normalizeBucket(payslip || {});
  }

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
    const totalCls = String(label).includes('합계') ? ' driver-payslip-line--total' : '';
    const descHtml = description
      ? `<span class="driver-payslip-line__desc">${escapeHtml(description)}</span>`
      : '';
    return `
      <li class="driver-payslip-line${totalCls}">
        <div class="driver-payslip-line__label">
          <strong>${escapeHtml(label)}</strong>
          ${descHtml}
        </div>
        <span class="driver-payslip-line__amount">${formatMoney(amount)}</span>
      </li>
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

  function syncPlatformTabs() {
    document.querySelectorAll('[data-payslip-platform]').forEach(btn => {
      const active = btn.dataset.payslipPlatform === state.platform;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function applyPayslipResult(result) {
    if (!result) return;
    state.lastResult = result;
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
      setText('driverPayslipLoanFee', '-');
      setText('driverPayslipLeaseUnpaid', result.lease?.unpaidAmount
        ? `${formatMoney(result.lease.unpaidAmount)} (${result.lease.unpaidReason || '리스비 미납'})`
        : '-');
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
    const platform = state.platform || 'total';
    const bucket = resolvePlatformBucket(payslip, platform);
    const includeLease = platform === 'total';

    setText('driverPayslipRiderName', rider.name || payslip.riderName || '-');
    setText('driverPayslipCoupangId', rider.coupangId || payslip.coupangId || '-');
    setText('driverPayslipBaeminId', rider.baeminId || payslip.baeminId || '-');
    setText('driverPayslipLeaseStatus', lease.leaseLabel || '없음');
    // 헤더 리스·대여차감은 정산결과(직계약) 공제열과 동일 값(버킷)을 우선 표시
    const headerLease = Number(bucket.leaseFee || 0) || Number(lease.leaseFee || 0);
    const headerLoan = Number(bucket.loanFee || 0);
    setText('driverPayslipLeaseFee', headerLease ? formatMoney(headerLease) : '-');
    setText('driverPayslipLoanFee', headerLoan ? formatMoney(headerLoan) : '-');
    setText('driverPayslipLeaseUnpaid', lease.unpaidAmount
      ? `${formatMoney(lease.unpaidAmount)} (${lease.unpaidReason || '리스비 미납'})`
      : '-');

    // 직계약 공제에 리스비가 이미 있으면 오버레이로 또 빼지 않는다(이중 공제 방지).
    // 미납 잔액만 별도 오버레이로 표시·합산한다.
    const bucketLease = Number(bucket.leaseFee || 0);
    const leaseDeduct = includeLease
      ? (bucketLease > 0
        ? Number(lease.unpaidAmount || 0)
        : Number(lease.leaseFee || 0) + Number(lease.unpaidAmount || 0))
      : 0;
    const gross = bucket.grossPay;
    const deduct = bucket.deductTotal + leaseDeduct;
    const net = bucket.netPay - leaseDeduct;

    setText('driverPayslipGrossTotal', formatMoney(gross));
    setText('driverPayslipDeductTotal', formatMoney(deduct));
    setText('driverPayslipNetTotal', formatMoney(net));

    const platformHint = platform === 'coupang'
      ? '쿠팡'
      : (platform === 'baemin' ? '배민' : '합계');
    setText('driverPayslipPayHint', `${platformHint} · 지급 내역`);
    setText('driverPayslipDeductHint', `${platformHint} · 공제 내역`);

    const payBody = document.getElementById('driverPayslipPayRows');
    const deductBody = document.getElementById('driverPayslipDeductRows');
    if (payBody) {
      payBody.innerHTML = PAY_ROWS.map(row => {
        const amount = row.key === 'grossPay' ? gross : bucket[row.key];
        return renderPayRow(row.label, amount, row.total ? '합계' : '');
      }).join('');
    }
    if (deductBody) {
      const rows = DEDUCT_ROWS.filter(row => row.key !== 'deductTotal').map(row => (
        renderPayRow(row.label, bucket[row.key])
      ));
      if (includeLease && lease.hasLease && bucketLease <= 0) {
        rows.push(renderPayRow('리스차감', lease.leaseFee, lease.vehicleNumber || '리스/렌탈'));
      }
      if (includeLease && lease.unpaidAmount) {
        rows.push(renderPayRow('미납', lease.unpaidAmount, lease.unpaidReason || '리스비 미납'));
      }
      rows.push(renderPayRow('공제합계', deduct, '합계'));
      deductBody.innerHTML = rows.join('');
    }

    setText('driverPayslipFormulaGross', formatMoney(gross));
    setText('driverPayslipFormulaDeduct', formatMoney(deduct));
    setText('driverPayslipFormulaNet', formatMoney(net));
    syncPlatformTabs();
    renderNotices(data.notices);
  }

  async function fetchPayslip(weekStart) {
    // weekStart 가 비면 서버가 "가장 최근 발행 주"를 골라준다. 캐시는 '__latest__' 키로 관리.
    const cacheKey = weekStart || '__latest__';
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.data;
    }
    const result = await BremStorage.fetchRiderWeeklyPayslipFromServer(weekStart || '');
    if (result?.ok) {
      cache.set(cacheKey, { at: Date.now(), data: result });
      // 실제 반환된 주 키로도 캐시해 네비게이션 시 재사용.
      if (result.settlementWeekStart) {
        cache.set(result.settlementWeekStart, { at: Date.now(), data: result });
      }
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
    // state.weekStart 가 없으면(메뉴 첫 진입) 서버가 최신 발행 주를 골라 돌려준다.
    const useLatest = !state.weekStart;
    if (!useLatest) {
      state.weekStart = weekStartKey(state.weekStart);
      if (!options.silent) {
        renderWeekShell(state.weekStart);
      }
    }

    const cacheKey = useLatest ? '__latest__' : state.weekStart;
    const cached = cache.get(cacheKey);
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
      const result = await fetchPayslip(useLatest ? '' : state.weekStart);
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
    window.BremDriverWithdrawal?.close?.();
    window.BremDriverRegionDashboard?.close?.();
    state.visible = true;
    panel.hidden = false;
    // 메뉴를 열 때마다 가장 최근 발행된 주급명세서부터 보여준다.
    // 관리자 반영 직후 옛 캐시(직계약만/빈값)가 남지 않도록 비운다.
    cache.clear();
    state.weekStart = null;
    state.platform = 'total';
    state.lastResult = null;
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
  panel.addEventListener('click', event => {
    const tab = event.target.closest('[data-payslip-platform]');
    if (!tab) return;
    const next = tab.dataset.payslipPlatform;
    if (!['total', 'coupang', 'baemin'].includes(next) || next === state.platform) return;
    state.platform = next;
    if (state.lastResult?.hasPayslip) renderPayslip(state.lastResult);
    else syncPlatformTabs();
  });

  // 계정 전환 시 이전 기사의 명세서가 캐시/화면에 남지 않도록 전부 비운다.
  function resetPanel() {
    state.requestSeq += 1;
    state.weekStart = null;
    state.platform = 'total';
    state.lastResult = null;
    state.loading = false;
    prefetchToken += 1;
    cache.clear();
    closePanel();
    if (periodEl) periodEl.textContent = '';
    if (paymentDateEl) paymentDateEl.textContent = '';
    if (contentEl) contentEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
  }

  window.BremDriverWeeklyPayslip = {
    open: openPanel,
    close: closePanel,
    reload: loadPayslip,
    reset: resetPanel,
    invalidateCache() {
      cache.clear();
    }
  };
})();

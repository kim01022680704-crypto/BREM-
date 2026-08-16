(function () {
  const utils = window.BremPayrollSlipUtils;
  const input = document.getElementById('payrollSlipSearchInput');
  const clearBtn = document.getElementById('payrollSlipSearchClear');
  const statusEl = document.getElementById('payrollSlipSearchStatus');
  const resultsEl = document.getElementById('payrollSlipSearchResults');
  const detailEl = document.getElementById('payrollSlipSearchDetail');
  const contentEl = document.getElementById('payrollSlipSearchContent');
  const emptyEl = document.getElementById('payrollSlipSearchEmpty');
  if (!form || !resultsEl || !detailEl) return;

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

  const state = {
    keyword: '',
    results: [],
    selectedKey: '',
    weekStart: '',
    platform: 'total'
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString('ko-KR')}원`;
  }

  function dashMoney(value) {
    const n = Number(value || 0);
    return n ? money(n) : '-';
  }

  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
  }

  function lineRaw(line) {
    const raw = line?.rawData && typeof line.rawData === 'object' ? line.rawData : {};
    const payslip = raw.payslip && typeof raw.payslip === 'object' ? raw.payslip : raw;
    return { raw, payslip };
  }

  function lineName(line) {
    const { raw, payslip } = lineRaw(line);
    return String(
      payslip.riderName || raw.riderName || raw.selectedDriverName || line.riderName || ''
    ).trim();
  }

  function lineWeek(line) {
    const { raw, payslip } = lineRaw(line);
    const week = raw.settlementWeekStart
      || raw.settlementWeekPayKey
      || payslip.settlementWeekStart
      || line.settlementWeekStart
      || line.payMonth
      || '';
    return utils?.normalizeSettlementWeekStart?.(week) || String(week).slice(0, 10);
  }

  function lineIds(line) {
    const { raw, payslip } = lineRaw(line);
    return {
      coupangId: String(payslip.coupangId || raw.matchedCoupangId || raw.coupangId || '').trim(),
      baeminId: String(payslip.baeminId || raw.matchedBaeminId || raw.baeminId || '').trim()
    };
  }

  function riderKey(line) {
    const driverId = String(line.driverId || lineRaw(line).raw.selectedDriverId || '').trim();
    if (driverId) return `id:${driverId}`;
    return `name:${normalizeName(lineName(line))}`;
  }

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

  function addBuckets(target, source) {
    Object.keys(target).forEach(key => {
      target[key] += Number(source?.[key] || 0);
    });
    return target;
  }

  function finalizeBucket(bucket) {
    const next = { ...emptyBucket(), ...(bucket || {}) };
    next.grossPay = next.deliveryFee + next.missionPay + next.other + next.promo;
    next.deductTotal = next.deductionDetail
      + next.employmentInsurance
      + next.accidentInsurance
      + next.hourlyInsurance
      + next.withholdingTax
      + next.promotionWithholdingTax
      + next.callFee
      + next.dailySettlementFee
      + next.prepaid
      + next.leaseFee
      + next.loanFee;
    next.netPay = next.grossPay - next.deductTotal;
    return next;
  }

  function lineToBucket(line) {
    const { raw, payslip } = lineRaw(line);
    const record = utils?.buildPayslipRecord
      ? utils.buildPayslipRecord({
        ...payslip,
        ...raw,
        riderName: lineName(line)
      })
      : {};
    const bucket = emptyBucket();
    bucket.deliveryFee = Number(record.totalDeliveryFee || payslip.deliveryFee || raw.totalDeliveryFee || 0);
    bucket.missionPay = Number(record.baeminMission || payslip.missionPay || raw.baeminMission || 0);
    bucket.other = Number(record.otherPayment || payslip.other || raw.otherPayment || 0);
    bucket.promo = Number(record.bremPromotion || payslip.promo || raw.bremPromotion || 0);
    bucket.deductionDetail = Number(payslip.deductionDetail || raw.deductionDetail || 0);
    bucket.employmentInsurance = Number(record.employmentInsurance || 0);
    bucket.accidentInsurance = Number(record.industrialAccidentInsurance || payslip.accidentInsurance || 0);
    bucket.hourlyInsurance = Number(record.hourlyInsurance || 0);
    bucket.withholdingTax = Number(record.withholdingTax || 0);
    bucket.promotionWithholdingTax = Number(record.promotionWithholdingTax || 0);
    bucket.callFee = Number(record.callFee || 0);
    bucket.dailySettlementFee = Number(record.dailySettlementFee || 0);
    bucket.prepaid = Number(payslip.prepaid || raw.prepaid || 0);
    bucket.leaseFee = Number(payslip.leaseFee || raw.leaseFee || 0);
    bucket.loanFee = Number(payslip.loanFee || raw.loanFee || 0);
    return finalizeBucket(bucket);
  }

  function detectPlatform(line) {
    const { raw, payslip } = lineRaw(line);
    const text = [
      payslip.platform,
      raw.platform,
      raw.branchPlatform,
      payslip.branchName,
      raw.branchName,
      line.department,
      raw.fileName,
      raw.uploadFileName
    ].join(' ').toLowerCase();
    if (/쿠팡|coupang/.test(text) && !/배민|baemin/.test(text)) return 'coupang';
    if (/배민|baemin|우아한|팀브로/.test(text) && !/쿠팡|coupang/.test(text)) return 'baemin';
    const ids = lineIds(line);
    if (ids.coupangId && !ids.baeminId) return 'coupang';
    if (ids.baeminId && !ids.coupangId) return 'baemin';
    return 'baemin';
  }

  function allLines() {
    return window.BremStorage?.payrollSlipLines?.getAll?.() || [];
  }

  function groupRiders(keyword) {
    const needle = normalizeName(keyword);
    const groups = new Map();
    allLines().forEach(line => {
      const name = lineName(line);
      if (!name) return;
      if (needle && !normalizeName(name).includes(needle)) return;
      const key = riderKey(line);
      const week = lineWeek(line);
      const ids = lineIds(line);
      const current = groups.get(key) || {
        key,
        name,
        driverId: String(line.driverId || '').trim(),
        coupangId: ids.coupangId,
        baeminId: ids.baeminId,
        weeks: new Set(),
        lines: []
      };
      if (week) current.weeks.add(week);
      if (ids.coupangId) current.coupangId = ids.coupangId;
      if (ids.baeminId) current.baeminId = ids.baeminId;
      if (!current.name && name) current.name = name;
      current.lines.push(line);
      groups.set(key, current);
    });
    return [...groups.values()]
      .map(item => ({
        ...item,
        weeks: [...item.weeks].sort().reverse()
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  function selectedRider() {
    return state.results.find(item => item.key === state.selectedKey) || null;
  }

  function buildPlatforms(rider, weekStart) {
    const coupang = emptyBucket();
    const baemin = emptyBucket();
    (rider?.lines || []).forEach(line => {
      if (lineWeek(line) !== weekStart) return;
      const bucket = lineToBucket(line);
      const platform = detectPlatform(line);
      addBuckets(platform === 'coupang' ? coupang : baemin, bucket);
    });
    return {
      coupang: finalizeBucket(coupang),
      baemin: finalizeBucket(baemin),
      total: finalizeBucket(addBuckets(addBuckets(emptyBucket(), coupang), baemin))
    };
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderRow(label, amount, total) {
    return `
      <li class="driver-payslip-line${total ? ' driver-payslip-line--total' : ''}">
        <div class="driver-payslip-line__label"><strong>${escapeHtml(label)}</strong></div>
        <span class="driver-payslip-line__amount">${money(amount)}</span>
      </li>
    `;
  }

  function latestNet(item) {
    if (!item.weeks[0]) return 0;
    return buildPlatforms(item, item.weeks[0]).total.netPay;
  }

  function renderResults() {
    if (!resultsEl) return;
    if (!state.results.length) {
      resultsEl.innerHTML = `<tr><td colspan="5" class="empty">${state.keyword ? '검색된 기사가 없습니다.' : '저장된 급여명세서가 없습니다.'}</td></tr>`;
      return;
    }
    resultsEl.innerHTML = state.results.map(item => `
      <tr class="payroll-search-row${item.key === state.selectedKey ? ' is-active' : ''}" data-payroll-search-rider="${escapeHtml(item.key)}" role="button" tabindex="0">
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${escapeHtml(item.coupangId || '-')}</td>
        <td>${escapeHtml(item.baeminId || '-')}</td>
        <td>${item.weeks[0] ? escapeHtml(utils?.formatSettlementWeekLabel?.(item.weeks[0]) || item.weeks[0]) : '-'}</td>
        <td>${money(latestNet(item))}</td>
      </tr>
    `).join('');
  }

  function renderDetail() {
    const rider = selectedRider();
    if (!rider) {
      detailEl.hidden = true;
      return;
    }
    detailEl.hidden = false;
    const weeks = rider.weeks;
    if (!state.weekStart || !weeks.includes(state.weekStart)) {
      state.weekStart = weeks[0] || '';
    }
    const weekIndex = weeks.indexOf(state.weekStart);
    const prevBtn = document.getElementById('payrollSlipSearchPrevWeekBtn');
    const nextBtn = document.getElementById('payrollSlipSearchNextWeekBtn');
    if (prevBtn) prevBtn.disabled = weekIndex < 0 || weekIndex >= weeks.length - 1;
    if (nextBtn) nextBtn.disabled = weekIndex <= 0;
    setText('payrollSlipSearchPeriod', state.weekStart
      ? (utils?.formatSettlementWeekLabel?.(state.weekStart) || state.weekStart)
      : '-');
    const payment = utils?.defaultPaymentDateForWeek?.(state.weekStart) || '';
    setText('payrollSlipSearchPaymentDate', payment
      ? payment.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2. $3.')
      : '-');
    setText('payrollSlipSearchRiderName', rider.name || '-');
    setText('payrollSlipSearchCoupangId', rider.coupangId || '-');
    setText('payrollSlipSearchBaeminId', rider.baeminId || '-');

    const platforms = buildPlatforms(rider, state.weekStart);
    const bucket = platforms[state.platform] || platforms.total;
    const hasData = Boolean(bucket.grossPay || bucket.deductTotal || bucket.netPay);
    if (emptyEl) emptyEl.hidden = hasData;
    if (contentEl) contentEl.hidden = !hasData;
    setText('payrollSlipSearchLeaseStatus', '없음');
    setText('payrollSlipSearchLeaseFee', dashMoney(platforms.total.leaseFee));
    setText('payrollSlipSearchLoanFee', dashMoney(platforms.total.loanFee));
    setText('payrollSlipSearchLeaseUnpaid', '-');
    if (!hasData) return;

    const hint = state.platform === 'coupang' ? '쿠팡' : (state.platform === 'baemin' ? '배민' : '합계');
    setText('payrollSlipSearchPayHint', `${hint} · 지급 내역`);
    setText('payrollSlipSearchDeductHint', `${hint} · 공제 내역`);
    setText('payrollSlipSearchGrossTotal', money(bucket.grossPay));
    setText('payrollSlipSearchDeductTotal', money(bucket.deductTotal));
    setText('payrollSlipSearchNetTotal', money(bucket.netPay));
    const payBody = document.getElementById('payrollSlipSearchPayRows');
    const deductBody = document.getElementById('payrollSlipSearchDeductRows');
    if (payBody) {
      payBody.innerHTML = PAY_ROWS.map(row => renderRow(row.label, bucket[row.key], row.total)).join('');
    }
    if (deductBody) {
      deductBody.innerHTML = DEDUCT_ROWS.map(row => renderRow(row.label, bucket[row.key], row.total)).join('');
    }
    detailEl.querySelectorAll('[data-payroll-search-platform]').forEach(btn => {
      const active = btn.dataset.payrollSearchPlatform === state.platform;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function search() {
    const keyword = String(input?.value || '').trim();
    state.keyword = keyword;
    state.results = groupRiders(keyword);
    if (state.selectedKey && !state.results.some(item => item.key === state.selectedKey)) {
      state.selectedKey = '';
    }
    if (statusEl) {
      const total = groupRiders('').length;
      statusEl.textContent = keyword
        ? `${state.results.length}명 / 전체 ${total}명 · 이름을 누르면 명세서가 열립니다.`
        : `전체 ${state.results.length}명 · 이름을 누르면 명세서가 열립니다.`;
    }
    renderResults();
    renderDetail();
  }

  function openRider(key) {
    const rider = state.results.find(item => item.key === key);
    if (!rider) return;
    state.selectedKey = key;
    state.weekStart = rider.weeks[0] || '';
    state.platform = 'total';
    renderResults();
    renderDetail();
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function shiftWeek(step) {
    const rider = selectedRider();
    if (!rider) return;
    const weeks = rider.weeks;
    const index = weeks.indexOf(state.weekStart);
    const next = weeks[index - step];
    if (!next) return;
    state.weekStart = next;
    renderDetail();
  }

  let searchTimer = 0;
  input?.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(search, 120);
  });
  clearBtn?.addEventListener('click', () => {
    if (input) input.value = '';
    state.selectedKey = '';
    search();
  });
  resultsEl?.addEventListener('click', event => {
    const row = event.target.closest('[data-payroll-search-rider]');
    if (row) openRider(row.dataset.payrollSearchRider);
  });
  document.getElementById('payrollSlipSearchDetailClose')?.addEventListener('click', () => {
    state.selectedKey = '';
    renderResults();
    renderDetail();
  });
  document.getElementById('payrollSlipSearchPrevWeekBtn')?.addEventListener('click', () => shiftWeek(-1));
  document.getElementById('payrollSlipSearchNextWeekBtn')?.addEventListener('click', () => shiftWeek(1));
  detailEl.addEventListener('click', event => {
    const tab = event.target.closest('[data-payroll-search-platform]');
    if (!tab) return;
    state.platform = tab.dataset.payrollSearchPlatform || 'total';
    renderDetail();
  });

  window.BremAdminPayrollSlipSearch = {
    async refresh() {
      await window.BremStorage?.ensureSectionLoaded?.('payroll-slip-search');
      search();
    }
  };
})();

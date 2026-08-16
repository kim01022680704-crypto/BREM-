(function () {
  const utils = window.BremPayrollSlipUtils;
  const input = document.getElementById('payrollSlipSearchInput');
  const clearBtn = document.getElementById('payrollSlipSearchClear');
  const statusEl = document.getElementById('payrollSlipSearchStatus');
  const resultsEl = document.getElementById('payrollSlipSearchResults');
  const detailEl = document.getElementById('payrollSlipSearchDetail');
  const popupBody = document.getElementById('payrollSlipSearchPopupBody');
  const popupMeta = document.getElementById('payrollSlipSearchPopupMeta');
  if (!resultsEl || !detailEl) return;

  const state = {
    keyword: '',
    results: [],
    selectedKey: '',
    weekStart: ''
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

  function allDrivers() {
    return window.BremStorage?.drivers?.getAll?.() || [];
  }

  function driverIds(driver) {
    const phone = String(driver.phone || '').replace(/[^0-9]/g, '');
    const name = String(driver.name || '').replace(/\s/g, '');
    return {
      coupangId: String(driver.coupangId || '').trim() || (name && phone ? `${name}${phone.slice(-4)}` : ''),
      baeminId: String(driver.baeminId || '').trim()
    };
  }

  function lineMatchesDriver(line, driver) {
    const driverId = String(driver.id || '').trim();
    if (driverId && String(line.driverId || lineRaw(line).raw.selectedDriverId || '') === driverId) {
      return true;
    }
    const name = normalizeName(driver.name);
    if (name && normalizeName(lineName(line)) === name) return true;
    const ids = lineIds(line);
    const driverSide = driverIds(driver);
    if (ids.baeminId && driverSide.baeminId && ids.baeminId === driverSide.baeminId) return true;
    if (ids.coupangId && driverSide.coupangId && ids.coupangId === driverSide.coupangId) return true;
    return false;
  }

  function matchesKeyword(item, keyword) {
    const needle = normalizeName(keyword);
    if (!needle) return true;
    const haystack = normalizeName([
      item.name,
      item.phone,
      item.coupangId,
      item.baeminId
    ].join(' '));
    return haystack.includes(needle);
  }

  function groupRiders(keyword) {
    const lines = allLines();
    const used = new Set();
    const groups = [];

    allDrivers().forEach(driver => {
      const name = String(driver.name || '').trim();
      if (!name) return;
      const ids = driverIds(driver);
      const matched = lines.filter(line => lineMatchesDriver(line, driver));
      matched.forEach(line => used.add(line));
      const weeks = new Set();
      matched.forEach(line => {
        const week = lineWeek(line);
        if (week) weeks.add(week);
      });
      const item = {
        key: `id:${driver.id}`,
        name,
        phone: String(driver.phone || '').trim(),
        driverId: String(driver.id || '').trim(),
        coupangId: ids.coupangId,
        baeminId: ids.baeminId,
        weeks,
        lines: matched
      };
      if (matchesKeyword(item, keyword)) groups.push(item);
    });

    lines.forEach(line => {
      if (used.has(line)) return;
      const name = lineName(line);
      if (!name) return;
      const ids = lineIds(line);
      const key = riderKey(line);
      let current = groups.find(item => item.key === key);
      if (!current) {
        current = {
          key,
          name,
          phone: '',
          driverId: String(line.driverId || '').trim(),
          coupangId: ids.coupangId,
          baeminId: ids.baeminId,
          weeks: new Set(),
          lines: []
        };
        groups.push(current);
      }
      const week = lineWeek(line);
      if (week) current.weeks.add(week);
      current.lines.push(line);
    });

    return groups
      .filter(item => matchesKeyword(item, keyword))
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

  function renderPayslipCard(title, bucket = {}) {
    const payRows = [
      ['배달비', bucket.deliveryFee],
      ['추가지급(미션)', bucket.missionPay],
      ['기타지급', bucket.other],
      ['BREM프로모션', bucket.promo],
      ['지급합계', bucket.grossPay, 'total']
    ];
    const deductRows = [
      ['차감내역', bucket.deductionDetail],
      ['고용보험', bucket.employmentInsurance],
      ['산재보험', bucket.accidentInsurance],
      ['시간제보험', bucket.hourlyInsurance],
      ['원천세', bucket.withholdingTax],
      ['프로모션원천세', bucket.promotionWithholdingTax],
      ['콜수수료', bucket.callFee],
      ['일정산수수료', bucket.dailySettlementFee],
      ['선정산(처리완료)', bucket.prepaid],
      ['리스차감', bucket.leaseFee],
      ['대여차감', bucket.loanFee],
      ['공제합계', bucket.deductTotal, 'total']
    ];
    const line = ([label, amount, kind]) => (
      `<p class="${kind === 'total' ? 'is-total' : ''}"><span>${escapeHtml(label)}</span><strong>${money(amount)}</strong></p>`
    );
    return `
      <article class="inquiry-payslip-card">
        <h3>${escapeHtml(title)}</h3>
        <p class="inquiry-payslip-card__hint">지급 내역</p>
        ${payRows.map(line).join('')}
        <p class="inquiry-payslip-card__hint">공제 내역</p>
        ${deductRows.map(line).join('')}
        <p class="is-net"><span>총지급액</span><strong>${money(bucket.netPay)}</strong></p>
      </article>
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

  function closeDetail() {
    detailEl.hidden = true;
  }

  function renderDetail() {
    const rider = selectedRider();
    if (!rider) {
      closeDetail();
      return;
    }
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
    if (popupMeta) {
      popupMeta.textContent = [
        rider.name || '-',
        rider.coupangId ? `쿠팡 ${rider.coupangId}` : '',
        rider.baeminId ? `배민 ${rider.baeminId}` : '',
        payment ? `지급일 ${payment.replace(/(\d{4})-(\d{2})-(\d{2})/, '$2. $3.')}` : ''
      ].filter(Boolean).join(' · ');
    }
    const platforms = buildPlatforms(rider, state.weekStart);
    const hasData = Boolean(
      platforms.total.grossPay || platforms.total.deductTotal || platforms.total.netPay
    );
    if (popupBody) {
      popupBody.innerHTML = hasData
        ? `<div class="inquiry-payslip-grid">
            ${renderPayslipCard('쿠팡 주급명세서', platforms.coupang)}
            ${renderPayslipCard('배민 주급명세서', platforms.baemin)}
          </div>`
        : '<p class="inquiry-popup__message">선택한 정산주의 급여명세서가 없습니다.</p>';
    }
    detailEl.hidden = false;
  }

  function search() {
    const keyword = String(input?.value || '').trim();
    state.keyword = keyword;
    state.results = groupRiders(keyword);
    if (state.selectedKey && !state.results.some(item => item.key === state.selectedKey)) {
      state.selectedKey = '';
      closeDetail();
    }
    if (statusEl) {
      const total = groupRiders('').length;
      statusEl.textContent = keyword
        ? `${state.results.length}명 / 전체 ${total}명 · 이름을 누르면 명세서가 열립니다.`
        : `전체 ${state.results.length}명 · 이름을 누르면 명세서가 열립니다.`;
    }
    renderResults();
    if (state.selectedKey && !detailEl.hidden) renderDetail();
  }

  function openRider(key) {
    const rider = state.results.find(item => item.key === key);
    if (!rider) return;
    state.selectedKey = key;
    state.weekStart = rider.weeks[0] || '';
    renderResults();
    renderDetail();
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
  detailEl.addEventListener('click', event => {
    if (event.target.closest('[data-payroll-search-close]')) {
      state.selectedKey = '';
      renderResults();
      closeDetail();
    }
  });
  document.getElementById('payrollSlipSearchPrevWeekBtn')?.addEventListener('click', () => shiftWeek(-1));
  document.getElementById('payrollSlipSearchNextWeekBtn')?.addEventListener('click', () => shiftWeek(1));

  window.BremAdminPayrollSlipSearch = {
    async refresh() {
      await window.BremStorage?.ensureSectionLoaded?.('payroll-slip-search');
      search();
    }
  };
})();

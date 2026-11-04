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
    const callValue = [payslip.callCount, raw.callCount, raw.registeredCallCount]
      .find(value => value !== undefined && value !== null && value !== '');
    bucket.callCount = Number(callValue || 0);
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

  function driverLookup() {
    const byId = new Map();
    const byName = new Map();
    allDrivers().forEach(driver => {
      const id = String(driver.id || '').trim();
      if (id) byId.set(id, driver);
      const name = normalizeName(driver.name);
      if (name && !byName.has(name)) byName.set(name, driver);
    });
    return { byId, byName };
  }

  function groupRiders(keyword, options = {}) {
    const week = options.allWeeks ? '' : state.weekStart;
    const lines = allLines().filter(line => !week || lineWeek(line) === week);
    const { byId, byName } = driverLookup();
    const groups = new Map();

    lines.forEach(line => {
      const driverId = String(line.driverId || lineRaw(line).raw.selectedDriverId || '').trim();
      const driver = (driverId && byId.get(driverId)) || byName.get(normalizeName(lineName(line))) || null;
      const key = driver?.id ? `id:${driver.id}` : riderKey(line);
      let current = groups.get(key);
      if (!current) {
        const ids = lineIds(line);
        const driverSide = driver ? driverIds(driver) : { coupangId: '', baeminId: '' };
        current = {
          key,
          name: String(driver?.name || lineName(line) || '').trim(),
          phone: String(driver?.phone || '').trim(),
          driverId: String(driver?.id || driverId || '').trim(),
          coupangId: driverSide.coupangId || ids.coupangId,
          baeminId: driverSide.baeminId || ids.baeminId,
          weeks: new Set(),
          lines: []
        };
        groups.set(key, current);
      }
      const lineWeekStart = lineWeek(line);
      if (lineWeekStart) current.weeks.add(lineWeekStart);
      current.lines.push(line);
    });

    return [...groups.values()]
      .map(item => ({
        ...item,
        weeks: [...item.weeks].sort().reverse(),
        weekNet: week ? buildPlatforms(item, week).total.netPay : 0
      }))
      .filter(item => matchesKeyword(item, keyword))
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

  function addWeek(weekStart, weeks) {
    const base = utils?.normalizeSettlementWeekStart?.(weekStart) || String(weekStart || '').slice(0, 10);
    if (!base) return '';
    const date = new Date(`${base}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + (Number(weeks) * 7));
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function latestSlipWeek() {
    const weeks = allLines().map(lineWeek).filter(Boolean).sort();
    return weeks[weeks.length - 1] || utils?.normalizeSettlementWeekStart?.('') || '';
  }

  function syncWeekUI(weekStart) {
    const normalized = utils?.normalizeSettlementWeekStart?.(weekStart) || String(weekStart || '').slice(0, 10);
    state.weekStart = normalized;
    const hidden = document.getElementById('payrollSlipSearchWeekStart');
    if (hidden) hidden.value = normalized;
    const label = normalized
      ? (utils?.formatSettlementWeekLabel?.(normalized) || normalized)
      : '정산주 선택';
    const labelEl = document.getElementById('payrollSlipSearchWeekLabel');
    if (labelEl) labelEl.textContent = label;
    setText('payrollSlipSearchPeriod', label);
    return normalized;
  }

  function weekNet(item) {
    if (!state.weekStart) return 0;
    return buildPlatforms(item, state.weekStart).total.netPay;
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
        <td>${state.weekStart ? escapeHtml(utils?.formatSettlementWeekLabel?.(state.weekStart) || state.weekStart) : '-'}</td>
        <td>${money(item.weekNet ?? weekNet(item))}</td>
      </tr>
    `).join('');
  }

  function closeMonthPrint() {
    const dialog = document.getElementById('payrollMonthPrint');
    if (dialog) dialog.hidden = true;
  }

  function closeDetail() {
    detailEl.hidden = true;
    closeMonthPrint();
  }

  function renderDetail() {
    const rider = selectedRider();
    if (!rider) {
      closeDetail();
      return;
    }
    if (!state.weekStart) syncWeekUI(latestSlipWeek());
    const prevBtn = document.getElementById('payrollSlipSearchPrevWeekBtn');
    const nextBtn = document.getElementById('payrollSlipSearchNextWeekBtn');
    if (prevBtn) prevBtn.disabled = !state.weekStart;
    if (nextBtn) nextBtn.disabled = !state.weekStart;
    setText('payrollSlipSearchPeriod', state.weekStart
      ? (utils?.formatSettlementWeekLabel?.(state.weekStart) || state.weekStart)
      : '정산주 선택');
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
    const allForWeek = groupRiders('');
    state.results = keyword ? allForWeek.filter(item => matchesKeyword(item, keyword)) : allForWeek;
    if (state.selectedKey && !state.results.some(item => item.key === state.selectedKey)) {
      state.selectedKey = '';
      closeDetail();
    }
    if (statusEl) {
      const weekLabel = state.weekStart
        ? (utils?.formatSettlementWeekLabel?.(state.weekStart) || state.weekStart)
        : '정산주 미선택';
      statusEl.textContent = keyword
        ? `${weekLabel} · ${state.results.length}명 / 전체 ${allForWeek.length}명 · 이름을 누르면 명세서가 열립니다.`
        : `${weekLabel} · 전체 ${state.results.length}명 · 급여명세서(브로) 등록분`;
    }
    renderResults();
    if (state.selectedKey && !detailEl.hidden) renderDetail();
  }

  function openRider(key) {
    const rider = state.results.find(item => item.key === key);
    if (!rider) return;
    closeMonthPrint();
    state.selectedKey = key;
    if (!state.weekStart) syncWeekUI(rider.weeks[0] || latestSlipWeek());
    renderResults();
    renderDetail();
  }

  function handleWeekChange(weekStart) {
    syncWeekUI(weekStart);
    search();
    if (state.selectedKey && !detailEl.hidden) renderDetail();
  }

  function shiftWeek(step) {
    const next = addWeek(state.weekStart || latestSlipWeek(), step);
    if (!next) return;
    handleWeekChange(next);
  }

  const monthPrint = {
    pack: null,
    selected: new Set()
  };

  const MONTH_PRINT_CSS = `
    #payrollMonthPrint { z-index: 220; }
    .payroll-month-print-dialog {
      width: min(1040px, calc(100vw - 24px));
      max-height: min(92vh, 960px);
    }
    .payroll-month-print-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin: 0 0 12px;
    }
    .payroll-month-print-months {
      display: flex;
      flex: 1 1 280px;
      flex-wrap: wrap;
      gap: 6px;
    }
    .payroll-month-check {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 700;
    }
    .payroll-month-check em {
      color: #6b7280;
      font-style: normal;
      font-weight: 600;
    }
    .payroll-month-print-preview {
      background: #e7e5e4;
      border-radius: 14px;
      padding: 14px;
      overflow-x: hidden;
    }
    .payroll-month-print-empty {
      margin: 0;
      padding: 28px 8px;
      color: #444;
      font-weight: 700;
      text-align: center;
    }
    .payslip-sheet {
      box-sizing: border-box;
      width: 100%;
      max-width: 190mm;
      min-width: 0;
      margin: 0 auto 16px;
      padding: 16px 16px 14px;
      overflow: hidden;
      border: 1px solid #d6d3d1;
      background: #fff;
      color: #111;
      font-family: "Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif;
      font-size: 12px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .payslip-sheet:last-child { margin-bottom: 0; }
    .payslip-sheet__banner {
      margin: 0 0 8px;
      color: #92400e;
      font-size: 11px;
      font-weight: 800;
    }
    .payslip-sheet__head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 8px;
      border-bottom: 3px solid #111;
    }
    .payslip-sheet__brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .payslip-sheet__brand img { width: 56px; height: auto; }
    .payslip-sheet__brand p {
      margin: 0;
      color: #78716c;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
    }
    .payslip-sheet__brand h1 {
      margin: 1px 0 0;
      font-size: 20px;
      line-height: 1.15;
    }
    .payslip-sheet__month { text-align: right; }
    .payslip-sheet__month span {
      display: block;
      color: #78716c;
      font-size: 11px;
      font-weight: 700;
    }
    .payslip-sheet__month strong {
      font-size: 22px;
      letter-spacing: -0.03em;
    }
    .payslip-sheet__meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px 14px;
      margin: 10px 0;
    }
    .payslip-sheet__meta div { min-width: 0; }
    .payslip-sheet__meta span {
      display: block;
      color: #78716c;
      font-size: 10px;
      font-weight: 700;
    }
    .payslip-sheet__meta strong { font-size: 13px; word-break: break-all; }
    .payslip-sheet__summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin: 0 0 12px;
    }
    .payslip-sheet__summary article {
      padding: 8px 10px;
      border: 1px solid #e7e5e4;
      border-radius: 8px;
      background: #fafaf9;
    }
    .payslip-sheet__summary span {
      display: block;
      color: #57534e;
      font-size: 11px;
      font-weight: 700;
    }
    .payslip-sheet__summary strong {
      font-size: 16px;
      font-variant-numeric: tabular-nums;
    }
    .payslip-sheet__summary .is-net {
      border-color: #111;
      background: #ffd400;
    }
    .payslip-sheet h2 {
      margin: 0 0 6px;
      font-size: 13px;
    }
    .payslip-sheet table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      margin: 0 0 12px;
    }
    .payslip-sheet th,
    .payslip-sheet td {
      box-sizing: border-box;
      padding: 4px 4px;
      border-bottom: 1px solid #e7e5e4;
      background: #fff;
      color: #111;
      font-size: 11px;
      font-weight: 600;
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .payslip-sheet thead th {
      background: #f5f5f4;
      color: #44403c;
      font-size: 10px;
      font-weight: 800;
    }
    .payslip-sheet td.is-label,
    .payslip-sheet th.is-label {
      text-align: left;
      white-space: normal;
    }
    .payslip-sheet tfoot td {
      border-top: 2px solid #111;
      border-bottom: 0;
      background: #fafaf9;
      color: #111;
      font-weight: 800;
    }
    .payslip-sheet__cols {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 14px;
      align-items: start;
      min-width: 0;
    }
    .payslip-sheet__cols section { min-width: 0; }
    .payslip-sheet__cols table { margin: 0; }
    .payslip-sheet__cols th.is-label {
      width: 62%;
      background: #fff;
      color: #111;
      font-size: 11px;
      font-weight: 600;
    }
    .payslip-sheet__cols td { width: 38%; }
    .payslip-sheet tr.is-total th,
    .payslip-sheet tr.is-total td {
      background: #fafaf9;
      font-weight: 800;
    }
    .payslip-sheet .is-zero { color: #78716c; }
    .payslip-sheet .is-neg { color: #b91c1c; }
    .payslip-sheet__formula {
      display: flex;
      align-items: baseline;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 12px;
      padding: 8px 10px;
      border-radius: 8px;
      background: #111;
      color: #fff;
      font-variant-numeric: tabular-nums;
    }
    .payslip-sheet__formula strong { color: #ffd400; font-size: 16px; }
    .payslip-sheet__sign {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      margin-top: 10px;
    }
    .payslip-sheet__foot {
      margin: 0;
      color: #78716c;
      font-size: 10px;
    }
    .payslip-sheet__stamps {
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
    }
    .payslip-sheet__stamp {
      width: 58px;
      text-align: center;
    }
    .payslip-sheet__stamp span {
      display: block;
      margin-bottom: 3px;
      color: #44403c;
      font-size: 10px;
      font-weight: 800;
    }
    .payslip-sheet__stamp b {
      display: block;
      box-sizing: border-box;
      height: 62px;
      border: 1.5px solid #111;
      background: #fff;
    }
  `;

  function ensureMonthPrintStyle() {
    if (document.getElementById('payrollMonthPrintStyle')) return;
    const style = document.createElement('style');
    style.id = 'payrollMonthPrintStyle';
    style.textContent = MONTH_PRINT_CSS;
    document.head.appendChild(style);
  }

  function won(value) {
    return Math.round(Number(value) || 0).toLocaleString('ko-KR');
  }

  function amountClass(value) {
    const amount = Math.round(Number(value) || 0);
    if (amount < 0) return 'is-neg';
    if (amount === 0) return 'is-zero';
    return '';
  }

  function monthLabel(month) {
    const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return String(month || '-');
    return `${match[1]}년 ${Number(match[2])}월`;
  }

  function shortDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return '-';
    return `${match[1]}.${match[2]}.${match[3]}`;
  }

  function compactWeek(weekStart) {
    const start = utils?.normalizeSettlementWeekStart?.(weekStart) || String(weekStart || '').slice(0, 10);
    const end = utils?.settlementWeekEnd?.(start) || '';
    const fmt = (value) => {
      const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      return match ? `${Number(match[2])}/${Number(match[3])}` : '-';
    };
    if (!start) return '-';
    return end ? `${fmt(start)}~${fmt(end)}` : fmt(start);
  }

  function aggregateLines(lines) {
    const coupang = emptyBucket();
    const baemin = emptyBucket();
    (lines || []).forEach(line => {
      const bucket = lineToBucket(line);
      addBuckets(detectPlatform(line) === 'coupang' ? coupang : baemin, bucket);
    });
    return {
      coupang: finalizeBucket(coupang),
      baemin: finalizeBucket(baemin),
      total: finalizeBucket(addBuckets(addBuckets(emptyBucket(), coupang), baemin))
    };
  }

  function sumBuckets(buckets) {
    return finalizeBucket((buckets || []).reduce((sum, bucket) => addBuckets(sum, bucket), emptyBucket()));
  }

  function riderHistory(rider) {
    const groups = groupRiders('', { allWeeks: true });
    return groups.find(item => item.key === rider?.key)
      || groups.find(item => rider?.driverId && item.driverId === rider.driverId)
      || rider;
  }

  function buildMonthSheets(rider) {
    const full = riderHistory(rider);
    const driver = allDrivers().find(item => String(item.id || '') === String(full?.driverId || '')) || null;
    const byMonth = new Map();
    (full?.lines || []).forEach(line => {
      const week = lineWeek(line);
      if (!week) return;
      const payDate = utils?.defaultPaymentDateForWeek?.(week) || '';
      const month = String(payDate || week).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) return;
      if (!byMonth.has(month)) byMonth.set(month, new Map());
      const weeks = byMonth.get(month);
      if (!weeks.has(week)) weeks.set(week, []);
      weeks.get(week).push(line);
    });
    const months = [...byMonth.entries()].map(([month, weekMap]) => {
      const weeks = [...weekMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([week, lines]) => ({
          week,
          label: compactWeek(week),
          payDate: utils?.defaultPaymentDateForWeek?.(week) || '',
          ...aggregateLines(lines)
        }));
      return {
        month,
        weeks,
        coupang: sumBuckets(weeks.map(week => week.coupang)),
        baemin: sumBuckets(weeks.map(week => week.baemin)),
        total: sumBuckets(weeks.map(week => week.total))
      };
    }).sort((a, b) => b.month.localeCompare(a.month));
    return { rider: full, driver, months };
  }

  function bankText(driver) {
    if (!driver) return '';
    const bank = String(driver.bankName || '').trim();
    const number = String(driver.accountNumber || '').trim();
    const holder = String(driver.accountHolder || '').trim();
    return [bank, number, holder ? `(${holder})` : ''].filter(Boolean).join(' ');
  }

  function metaCell(label, value) {
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`;
  }

  function moneyCell(value) {
    return `<td class="${amountClass(value)}">${won(value)}</td>`;
  }

  function detailRows(rows, bucket) {
    return rows.map(([label, key, kind]) => {
      const amount = bucket?.[key];
      return `<tr class="${kind === 'total' ? 'is-total' : ''}"><th class="is-label">${escapeHtml(label)}</th>${moneyCell(amount)}</tr>`;
    }).join('');
  }

  function renderSheet(sheet) {
    const rider = sheet.rider || {};
    const driver = sheet.driver || null;
    const total = sheet.total || emptyBucket();
    const weeks = sheet.weeks || [];
    const payDates = weeks.map(week => week.payDate).filter(Boolean).sort();
    const payRange = payDates.length
      ? (payDates.length === 1 ? shortDate(payDates[0]) : `${shortDate(payDates[0])} ~ ${shortDate(payDates[payDates.length - 1])}`)
      : '-';
    const logo = new URL('assets/brand/brem-logo-mark.png', window.location.href).href;
    const payRows = [
      ['배달비', 'deliveryFee'],
      ['추가지급(미션)', 'missionPay'],
      ['기타지급', 'other'],
      ['BREM프로모션', 'promo'],
      ['지급합계', 'grossPay', 'total']
    ];
    const deductRows = [
      ['차감내역', 'deductionDetail'],
      ['고용보험', 'employmentInsurance'],
      ['산재보험', 'accidentInsurance'],
      ['시간제보험', 'hourlyInsurance'],
      ['원천세', 'withholdingTax'],
      ['프로모션원천세', 'promotionWithholdingTax'],
      ['콜수수료', 'callFee'],
      ['일정산수수료', 'dailySettlementFee'],
      ['선정산(처리완료)', 'prepaid'],
      ['리스차감', 'leaseFee'],
      ['대여차감', 'loanFee'],
      ['공제합계', 'deductTotal', 'total']
    ];
    const weekRows = weeks.map(week => `
      <tr>
        <td class="is-label">${escapeHtml(week.label || '-')}</td>
        <td>${escapeHtml(shortDate(week.payDate))}</td>
        <td class="${amountClass(week.total.callCount)}">${won(week.total.callCount)}</td>
        ${moneyCell(week.total.grossPay)}
        ${moneyCell(week.total.deductTotal)}
        ${moneyCell(week.coupang.netPay)}
        ${moneyCell(week.baemin.netPay)}
        ${moneyCell(week.total.netPay)}
      </tr>
    `).join('');
    const printedAt = (() => {
      const now = new Date();
      return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
      ].join('.');
    })();
    return `
      <article class="payslip-sheet">
        ${sheet.specimen ? '<p class="payslip-sheet__banner">저장된 급여명세서가 없습니다. 빈 양식입니다.</p>' : ''}
        <header class="payslip-sheet__head">
          <div class="payslip-sheet__brand">
            <img src="${escapeHtml(logo)}" alt="BREM">
            <div>
              <p>BREM RIDER</p>
              <h1>월별 급여명세서</h1>
            </div>
          </div>
          <div class="payslip-sheet__month">
            <span>지급월</span>
            <strong>${escapeHtml(monthLabel(sheet.month))}</strong>
          </div>
        </header>
        <div class="payslip-sheet__meta">
          ${metaCell('성명', rider.name)}
          ${metaCell('쿠팡ID', rider.coupangId)}
          ${metaCell('배민ID', rider.baeminId)}
          ${metaCell('연락처', rider.phone)}
          ${metaCell('계좌', bankText(driver))}
          ${metaCell('지급일', `${payRange} · ${weeks.length}주`)}
        </div>
        <div class="payslip-sheet__summary">
          <article><span>지급합계</span><strong class="${amountClass(total.grossPay)}">${won(total.grossPay)}원</strong></article>
          <article><span>공제합계</span><strong class="${amountClass(total.deductTotal)}">${won(total.deductTotal)}원</strong></article>
          <article class="is-net"><span>총지급액</span><strong class="${amountClass(total.netPay)}">${won(total.netPay)}원</strong></article>
        </div>
        <h2>주별 내역</h2>
        <table>
          <colgroup>
            <col style="width:16%">
            <col style="width:15%">
            <col style="width:8%">
            <col style="width:13%">
            <col style="width:13%">
            <col style="width:11%">
            <col style="width:11%">
            <col style="width:13%">
          </colgroup>
          <thead>
            <tr>
              <th class="is-label">정산주</th>
              <th>지급일</th>
              <th>콜수</th>
              <th>지급합계</th>
              <th>공제합계</th>
              <th>쿠팡</th>
              <th>배민</th>
              <th>총지급액</th>
            </tr>
          </thead>
          <tbody>${weekRows}</tbody>
          <tfoot>
            <tr>
              <td class="is-label">합계</td>
              <td></td>
              <td>${won(total.callCount)}</td>
              ${moneyCell(total.grossPay)}
              ${moneyCell(total.deductTotal)}
              ${moneyCell(sheet.coupang?.netPay)}
              ${moneyCell(sheet.baemin?.netPay)}
              ${moneyCell(total.netPay)}
            </tr>
          </tfoot>
        </table>
        <div class="payslip-sheet__cols">
          <section>
            <h2>지급 내역</h2>
            <table>
              <colgroup><col style="width:62%"><col style="width:38%"></colgroup>
              <tbody>${detailRows(payRows, total)}</tbody>
            </table>
          </section>
          <section>
            <h2>공제 내역</h2>
            <table>
              <colgroup><col style="width:62%"><col style="width:38%"></colgroup>
              <tbody>${detailRows(deductRows, total)}</tbody>
            </table>
          </section>
        </div>
        <div class="payslip-sheet__formula">
          <span>${won(total.grossPay)}</span>
          <span>-</span>
          <span>${won(total.deductTotal)}</span>
          <span>=</span>
          <strong>${won(total.netPay)}원</strong>
        </div>
        <div class="payslip-sheet__sign">
          <p class="payslip-sheet__foot">쿠팡·배민은 각 플랫폼 총지급액입니다. 주급명세서를 지급일 기준으로 합산했습니다. 출력 ${printedAt}</p>
          <div class="payslip-sheet__stamps" aria-label="도장">
            <div class="payslip-sheet__stamp"><span>담당</span><b></b></div>
            <div class="payslip-sheet__stamp"><span>팀장</span><b></b></div>
            <div class="payslip-sheet__stamp"><span>대표</span><b></b></div>
          </div>
        </div>
      </article>
    `;
  }

  function selectedMonthSheets() {
    const pack = monthPrint.pack;
    if (!pack?.months?.length) return [];
    return pack.months
      .filter(item => monthPrint.selected.has(item.month))
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  function previewSheetsHtml() {
    const pack = monthPrint.pack;
    if (!pack) return '';
    if (!pack.months.length) {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      return renderSheet({
        specimen: true,
        rider: pack.rider,
        driver: pack.driver,
        month,
        weeks: [{ label: '-', payDate: '', total: emptyBucket(), coupang: emptyBucket(), baemin: emptyBucket() }],
        total: emptyBucket(),
        coupang: emptyBucket(),
        baemin: emptyBucket()
      });
    }
    const sheets = selectedMonthSheets();
    if (!sheets.length) return '';
    return sheets.map(item => renderSheet({ ...item, rider: pack.rider, driver: pack.driver })).join('');
  }

  function renderMonthChecks() {
    const box = document.getElementById('payrollMonthPrintMonths');
    const pack = monthPrint.pack;
    if (!box) return;
    if (!pack?.months?.length) {
      box.innerHTML = '<span class="payroll-month-check">저장된 달이 없습니다</span>';
      return;
    }
    box.innerHTML = pack.months.map(item => `
      <label class="payroll-month-check">
        <input type="checkbox" data-payroll-month="${escapeHtml(item.month)}"${monthPrint.selected.has(item.month) ? ' checked' : ''}>
        <span>${escapeHtml(monthLabel(item.month))}</span>
        <em>${item.weeks.length}주 · ${won(item.total.netPay)}원</em>
      </label>
    `).join('');
  }

  function renderMonthPreview() {
    const preview = document.getElementById('payrollMonthPrintPreview');
    const button = document.getElementById('payrollMonthPrintBtn');
    const html = previewSheetsHtml();
    if (preview) {
      preview.innerHTML = html || '<p class="payroll-month-print-empty">인쇄할 달을 선택하세요.</p>';
    }
    if (button) button.disabled = !html;
  }

  function openMonthPrint() {
    const rider = selectedRider();
    if (!rider) return;
    ensureMonthPrintStyle();
    monthPrint.pack = buildMonthSheets(rider);
    monthPrint.selected = new Set(monthPrint.pack.months.map(item => item.month));
    const dialog = document.getElementById('payrollMonthPrint');
    const meta = document.getElementById('payrollMonthPrintMeta');
    if (meta) {
      meta.textContent = `${monthPrint.pack.rider?.name || rider.name || '-'} · 지급일이 같은 달인 주급을 한 장으로 모읍니다. 달을 고른 뒤 인쇄하세요.`;
    }
    renderMonthChecks();
    renderMonthPreview();
    if (dialog) dialog.hidden = false;
  }

  function printSheets(html) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;left:0;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(frame);
    const doc = frame.contentWindow?.document;
    if (!doc) {
      frame.remove();
      return;
    }
    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>월별 급여명세서</title>
  <style>
    ${MONTH_PRINT_CSS}
    @page { size: A4; margin: 12mm; }
    html, body { margin: 0; background: #fff; }
    .payslip-sheet {
      width: 100%;
      max-width: none;
      margin: 0;
      overflow: visible;
      border: 0;
      page-break-after: always;
      break-after: page;
    }
    .payslip-sheet:last-child { page-break-after: auto; break-after: auto; }
  </style>
</head>
<body>${html}</body>
</html>`);
    doc.close();
    const cleanup = () => {
      if (frame.isConnected) frame.remove();
    };
    frame.contentWindow?.addEventListener('afterprint', cleanup);
    window.setTimeout(cleanup, 60000);
    const run = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    };
    const fonts = frame.contentDocument?.fonts;
    if (fonts?.ready) fonts.ready.then(() => window.setTimeout(run, 60)).catch(run);
    else window.setTimeout(run, 400);
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
  document.getElementById('payrollSlipSearchMonthPrintBtn')?.addEventListener('click', openMonthPrint);
  document.getElementById('payrollMonthPrint')?.addEventListener('click', event => {
    if (event.target.closest('[data-payroll-month-print-close]')) {
      closeMonthPrint();
      return;
    }
    if (event.target.closest('#payrollMonthPrintAll')) {
      monthPrint.pack?.months.forEach(item => monthPrint.selected.add(item.month));
      renderMonthChecks();
      renderMonthPreview();
      return;
    }
    if (event.target.closest('#payrollMonthPrintNone')) {
      monthPrint.selected.clear();
      renderMonthChecks();
      renderMonthPreview();
      return;
    }
    if (event.target.closest('#payrollMonthPrintBtn')) {
      const html = previewSheetsHtml();
      if (html) printSheets(html);
    }
  });
  document.getElementById('payrollMonthPrintMonths')?.addEventListener('change', event => {
    const input = event.target.closest('[data-payroll-month]');
    if (!input) return;
    if (input.checked) monthPrint.selected.add(input.dataset.payrollMonth);
    else monthPrint.selected.delete(input.dataset.payrollMonth);
    renderMonthPreview();
  });

  async function openForDriver(driver, weekStart) {
    await window.BremStorage?.ensureSectionLoaded?.('payroll-slip-search');
    const id = String(driver?.id || '').trim();
    syncWeekUI(weekStart || state.weekStart || latestSlipWeek());
    const riders = groupRiders('');
    let rider = riders.find(item => item.driverId === id || item.key === `id:${id}`) || null;
    if (!rider) {
      rider = {
        key: id ? `id:${id}` : `name:${normalizeName(driver?.name)}`,
        name: String(driver?.name || '').trim(),
        phone: String(driver?.phone || '').trim(),
        driverId: id,
        coupangId: String(driver?.coupangId || '').trim(),
        baeminId: String(driver?.baeminId || '').trim(),
        weeks: [],
        lines: [],
        weekNet: 0
      };
    }
    state.results = riders.some(item => item.key === rider.key) ? riders : [rider, ...riders];
    state.selectedKey = rider.key;
    renderDetail();
  }

  window.BremAdminPayrollSlipSearch = {
    openForDriver,
    handleWeekChange,
    async refresh() {
      await window.BremStorage?.ensureSectionLoaded?.('payroll-slip-search');
      if (!state.weekStart) syncWeekUI(latestSlipWeek());
      search();
    }
  };
})();

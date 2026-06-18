(function () {
  const revenue = BremStorage.revenue;
  if (!revenue) return;

  const INCOME_TABLE_COLUMNS = [
    { key: 'region', label: '지역' },
    { key: 'supplyPrice', label: '공급가', money: true },
    { key: 'riderPayment', label: '라이더결제금', money: true },
    { key: 'paymentFeePercent', label: '수수료%', percent: true },
    { key: 'paymentFeeAmount', label: '수수료금액', money: true },
    { key: 'mgmtFee', label: '관리비', money: true },
    { key: 'promotion', label: '프로모션', money: true },
    { key: 'callCount', label: '콜수' },
    { key: 'callFeeTotal', label: '콜수수료', money: true },
    { key: 'totalRevenue', label: '총수익', money: true },
    { key: 'totalExpense', label: '총지출', money: true },
    { key: 'netProfit', label: '순익', money: true },
    { key: 'deficitCompensation', label: '결손보전(참고)', money: true, coupangOnly: true },
    { key: 'memo', label: '비고' }
  ];

  const BROPAY_COLUMNS = [
    { key: 'withdrawalDate', label: '출금 날짜' },
    { key: 'name', label: '이름' },
    { key: 'branch', label: '출금지사' },
    { key: 'amount', label: '출금금액', money: true },
    { key: 'reason', label: '사유' }
  ];

  const OFFICE_COLUMNS = [
    { key: 'writtenDate', label: '작성날짜' },
    { key: 'spender', label: '지출자' },
    { key: 'name', label: '지출이름' },
    { key: 'plannedAmount', label: '지출예정금액', money: true },
    { key: 'paidAmount', label: '지출금액', money: true },
    { key: 'paidDate', label: '지출날짜' },
    { key: 'location', label: '지출위치' },
    { key: 'finalAmount', label: '최종금액', money: true }
  ];

  const state = {
    periodTab: 'weekly',
    weeklyPanel: 'income-coupang',
    monthlyPanel: 'office-expense',
    weekStart: '',
    monthKey: ''
  };

  function $(id) {
    return document.getElementById(id);
  }

  function platformPrefix(platform) {
    return platform === 'baemin' ? 'Baemin' : 'Coupang';
  }

  function fieldId(platform, name) {
    return `revenue${platformPrefix(platform)}${name}`;
  }

  function today() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
  }

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekStartKey(dateValue = today()) {
    const date = new Date(`${dateValue}T00:00:00`);
    const day = date.getDay();
    const diff = (day - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
  }

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return dateKey(end);
  }

  function formatWeekRange(weekStart) {
    if (!weekStart) return '주차를 선택하세요';
    return `${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))}`;
  }

  function formatMonthLabel(monthKey) {
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return '월을 선택하세요';
    const [year, month] = monthKey.split('-');
    return `${year}년 ${month}월`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function number(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatDate(value) {
    if (!value) return '-';
    return BremDatePicker.formatDate(value);
  }

  function formatMoney(value) {
    const num = Number(value || 0);
    if (!num && num !== 0) return '-';
    return `${number(num)}원`;
  }

  function refreshOfficeDateLabel(fieldId) {
    const input = $(fieldId);
    const label = $(`${fieldId}Label`);
    if (!input || !label) return;
    label.textContent = input.value ? formatDate(input.value) : '날짜 선택';
  }

  function refreshOfficeDateLabels() {
    refreshOfficeDateLabel('revenueBropayWithdrawalDate');
    refreshOfficeDateLabel('revenueOfficeWrittenDate');
    refreshOfficeDateLabel('revenueOfficePaidDate');
  }

  function normalizeHeaderCell(value) {
    return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
  }

  function downloadWorkbook(filename, rows, sheetName = 'Sheet1') {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    window.XLSX.writeFile(workbook, filename);
  }

  function readIncomeFormValues(platform) {
    return {
      id: $(fieldId(platform, 'EditId'))?.value || '',
      weekStart: state.weekStart,
      region: $(fieldId(platform, 'Region'))?.value || '',
      supplyPrice: $(fieldId(platform, 'SupplyPrice'))?.value || 0,
      riderPayment: $(fieldId(platform, 'RiderPayment'))?.value || 0,
      paymentFeePercent: $(fieldId(platform, 'PaymentFeePercent'))?.value || 3,
      mgmtFee: $(fieldId(platform, 'MgmtFee'))?.value || 0,
      promotion: $(fieldId(platform, 'Promotion'))?.value || 0,
      callCount: $(fieldId(platform, 'CallCount'))?.value || 0,
      callFeePerCall: $(fieldId(platform, 'CallFeePerCall'))?.value || 0,
      expenseEmployment: $(fieldId(platform, 'ExpenseEmployment'))?.value || 0,
      expenseIndustrial: $(fieldId(platform, 'ExpenseIndustrial'))?.value || 0,
      vatReserve: $(fieldId(platform, 'VatReserve'))?.value || 0,
      expensePromotion: $(fieldId(platform, 'ExpensePromotion'))?.value || 0,
      deficitCompensation: platform === 'coupang'
        ? ($(fieldId(platform, 'DeficitCompensation'))?.value || 0)
        : 0,
      memo: $(fieldId(platform, 'Memo'))?.value || ''
    };
  }

  function updateIncomePreview(platform) {
    const computed = revenue.computeIncomeRecord(platform, readIncomeFormValues(platform));
    const feeOut = $(fieldId(platform, 'PaymentFeeAmount'));
    const callOut = $(fieldId(platform, 'CallFeeTotal'));
    const totalRev = $(fieldId(platform, 'TotalRevenue'));
    const totalExp = $(fieldId(platform, 'TotalExpense'));
    const net = $(fieldId(platform, 'NetProfit'));

    if (feeOut) feeOut.textContent = formatMoney(computed.paymentFeeAmount);
    if (callOut) callOut.textContent = formatMoney(computed.callFeeTotal);
    if (totalRev) totalRev.textContent = formatMoney(computed.totalRevenue);
    if (totalExp) totalExp.textContent = formatMoney(computed.totalExpense);
    if (net) {
      net.textContent = formatMoney(computed.netProfit);
      net.classList.toggle('revenue-net-negative', computed.netProfit < 0);
      net.classList.toggle('revenue-net-positive', computed.netProfit > 0);
    }
    return computed;
  }

  function fillIncomeForm(platform, record = {}) {
    $(fieldId(platform, 'EditId')).value = record.id || '';
    $(fieldId(platform, 'Region')).value = record.region || '';
    $(fieldId(platform, 'SupplyPrice')).value = record.supplyPrice || '';
    $(fieldId(platform, 'RiderPayment')).value = record.riderPayment || '';
    $(fieldId(platform, 'PaymentFeePercent')).value = record.paymentFeePercent ?? 3;
    $(fieldId(platform, 'MgmtFee')).value = record.mgmtFee || '';
    $(fieldId(platform, 'Promotion')).value = record.promotion || '';
    $(fieldId(platform, 'CallCount')).value = record.callCount || '';
    $(fieldId(platform, 'CallFeePerCall')).value = record.callFeePerCall ?? record.callFee ?? '';
    $(fieldId(platform, 'ExpenseEmployment')).value = record.expenseEmployment || '';
    $(fieldId(platform, 'ExpenseIndustrial')).value = record.expenseIndustrial || '';
    $(fieldId(platform, 'VatReserve')).value = record.vatReserve || '';
    $(fieldId(platform, 'ExpensePromotion')).value = record.expensePromotion || '';
    if (platform === 'coupang') {
      $(fieldId(platform, 'DeficitCompensation')).value = record.deficitCompensation || '';
    }
    $(fieldId(platform, 'Memo')).value = record.memo || '';
    updateIncomePreview(platform);
  }

  function resetIncomeForm(platform) {
    fillIncomeForm(platform, {});
    $(fieldId(platform, 'Region'))?.focus();
  }

  function incomeTableColumns(platform) {
    return INCOME_TABLE_COLUMNS.filter(col => !col.coupangOnly || platform === 'coupang');
  }

  function renderIncomeTable(platform) {
    const list = platform === 'baemin'
      ? revenue.listIncomeBaemin(state.weekStart)
      : revenue.listIncomeCoupang(state.weekStart);
    const columns = incomeTableColumns(platform);
    const headEl = $(fieldId(platform, 'Head'));
    const bodyEl = $(fieldId(platform, 'Body'));
    const totalEl = $(fieldId(platform, 'Total'));

    if (headEl) {
      headEl.innerHTML = `<tr>${columns.map(col => `<th>${escapeHtml(col.label)}</th>`).join('')}<th></th></tr>`;
    }
    if (!bodyEl) return;

    if (!list.length) {
      bodyEl.innerHTML = `<tr><td colspan="${columns.length + 1}" class="empty-cell">등록된 ${platform === 'baemin' ? '배민' : '쿠팡'} 지역 수입이 없습니다.</td></tr>`;
      if (totalEl) totalEl.textContent = '0건 · 순익 0원';
      return;
    }

    const netSum = list.reduce((sum, item) => sum + Number(item.netProfit || 0), 0);
    bodyEl.innerHTML = list.map(item => `
      <tr class="${Number(item.netProfit || 0) < 0 ? 'revenue-row-negative' : ''}">
        ${columns.map(col => {
          const value = item[col.key];
          if (col.money) return `<td class="num">${formatMoney(value)}</td>`;
          if (col.percent) return `<td class="num">${Number(value || 0)}%</td>`;
          return `<td>${escapeHtml(value || '-')}</td>`;
        }).join('')}
        <td class="row-actions">
          <button type="button" class="small-btn" data-income-edit="${platform}" data-id="${item.id}">수정</button>
          <button type="button" class="small-btn danger" data-income-delete="${platform}" data-id="${item.id}">삭제</button>
        </td>
      </tr>`).join('');

    if (totalEl) {
      totalEl.textContent = `${list.length}건 · 순익 ${formatMoney(netSum)}`;
    }
  }

  function saveIncomeForm(platform) {
    const raw = readIncomeFormValues(platform);
    if (!String(raw.region || '').trim()) {
      showToast('지역을 입력하세요.');
      return;
    }
    const saved = platform === 'baemin'
      ? revenue.saveIncomeBaemin(raw)
      : revenue.saveIncomeCoupang(raw);
    showToast(`${platform === 'baemin' ? '배민' : '쿠팡'} ${saved.region} 저장 완료 (순익 ${formatMoney(saved.netProfit)})`);
    resetIncomeForm(platform);
    renderIncomeTable(platform);
    renderFinalSettlement();
    renderMonthlySummary();
    exportIncome(platform);
  }

  function exportIncome(platform) {
    const columns = incomeTableColumns(platform);
    const list = platform === 'baemin'
      ? revenue.listIncomeBaemin(state.weekStart)
      : revenue.listIncomeCoupang(state.weekStart);
    const rows = [columns.map(col => col.label)];
    list.forEach(item => {
      rows.push(columns.map(col => item[col.key] ?? ''));
    });
    downloadWorkbook(
      `${platform === 'baemin' ? '배민' : '쿠팡'}_수입_${state.weekStart}.xlsx`,
      rows,
      platform === 'baemin' ? '통합' : '총합'
    );
  }

  function renderFinalSettlement() {
    const data = revenue.aggregateWeekSettlement(state.weekStart);
    const saved = revenue.getFinalSettlementByWeek(state.weekStart);

    $('revenueFinalCoupangRevenue').textContent = formatMoney(data.coupang.totalRevenue);
    $('revenueFinalCoupangExpense').textContent = formatMoney(data.coupang.totalExpense);
    $('revenueFinalCoupangNet').textContent = formatMoney(data.coupang.netProfit);
    $('revenueFinalCoupangCount').textContent = `${data.coupang.count}개 지역`;

    $('revenueFinalBaeminRevenue').textContent = formatMoney(data.baemin.totalRevenue);
    $('revenueFinalBaeminExpense').textContent = formatMoney(data.baemin.totalExpense);
    $('revenueFinalBaeminNet').textContent = formatMoney(data.baemin.netProfit);
    $('revenueFinalBaeminCount').textContent = `${data.baemin.count}개 지역`;

    $('revenueFinalBropay').textContent = formatMoney(data.bropayTotal);
    $('revenueFinalCombinedRevenue').textContent = formatMoney(data.combined.totalRevenue);
    $('revenueFinalCombinedExpense').textContent = formatMoney(data.combined.totalExpense);
    $('revenueFinalCombinedNet').textContent = formatMoney(data.combined.netProfit);

    const netEl = $('revenueFinalCombinedNet');
    if (netEl) {
      netEl.classList.toggle('revenue-net-negative', data.combined.netProfit < 0);
      netEl.classList.toggle('revenue-net-positive', data.combined.netProfit > 0);
    }

    const statusEl = $('revenueFinalSavedStatus');
    if (statusEl) {
      statusEl.textContent = saved
        ? `마지막 저장: ${new Date(saved.savedAt).toLocaleString('ko-KR')}`
        : '아직 저장되지 않았습니다.';
    }

    const memoEl = $('revenueFinalMemo');
    if (memoEl) memoEl.value = saved?.memo || '';

    const detailBody = $('revenueFinalDetailBody');
    if (!detailBody) return;

    const rows = [];
    data.coupang.items.forEach(item => {
      rows.push({ platform: '쿠팡', ...item });
    });
    data.baemin.items.forEach(item => {
      rows.push({ platform: '배민', ...item });
    });

    if (!rows.length) {
      detailBody.innerHTML = '<tr><td colspan="7" class="empty-cell">저장된 지역별 수입 내역이 없습니다. 쿠팡·배민 수입을 먼저 등록하세요.</td></tr>';
      return;
    }

    detailBody.innerHTML = rows.map(item => `
      <tr class="${Number(item.netProfit || 0) < 0 ? 'revenue-row-negative' : ''}">
        <td>${escapeHtml(item.platform)}</td>
        <td>${escapeHtml(item.region || '-')}</td>
        <td class="num">${formatMoney(item.totalRevenue)}</td>
        <td class="num">${formatMoney(item.totalExpense)}</td>
        <td class="num">${formatMoney(item.netProfit)}</td>
        <td class="num">${number(item.callCount || 0)}</td>
        <td>${escapeHtml(item.memo || '-')}</td>
      </tr>`).join('');
  }

  function saveFinalSettlement() {
    if (!state.weekStart) {
      showToast('주차를 선택하세요.');
      return;
    }
    const memo = $('revenueFinalMemo')?.value || '';
    revenue.saveFinalSettlement(state.weekStart, memo);
    showToast('손익 최종 정산이 저장되었습니다.');
    renderFinalSettlement();
    renderMonthlySummary();
  }

  function exportFinalSettlement() {
    const data = revenue.aggregateWeekSettlement(state.weekStart);
    const rows = [
      ['손익 최종 정산', formatWeekRange(state.weekStart)],
      [],
      ['플랫폼', '지역', '총수익', '총지출', '순익', '콜수', '비고']
    ];

    data.coupang.items.forEach(item => {
      rows.push(['쿠팡', item.region, item.totalRevenue, item.totalExpense, item.netProfit, item.callCount, item.memo || '']);
    });
    data.baemin.items.forEach(item => {
      rows.push(['배민', item.region, item.totalRevenue, item.totalExpense, item.netProfit, item.callCount, item.memo || '']);
    });

    rows.push([]);
    rows.push(['구분', '총수익', '총지출', '순익', '건수/참고']);
    rows.push(['쿠팡', data.coupang.totalRevenue, data.coupang.totalExpense, data.coupang.netProfit, data.coupang.count]);
    rows.push(['배민', data.baemin.totalRevenue, data.baemin.totalExpense, data.baemin.netProfit, data.baemin.count]);
    rows.push(['브로페이 출금(참고)', '', '', '손익 계산 제외', `${data.bropayTotal} / ${data.bropayCount}건`]);
    rows.push(['합계', data.combined.totalRevenue, data.combined.totalExpense, data.combined.netProfit, data.combined.regionCount]);

    downloadWorkbook(`손익최종정산_${state.weekStart}.xlsx`, rows, '주간손익');
  }

  function exportBropay() {
    const list = revenue.listBropay(state.weekStart);
    const rows = [BROPAY_COLUMNS.map(col => col.label)];
    list.forEach(item => {
      rows.push(BROPAY_COLUMNS.map(col => item[col.key] ?? ''));
    });
    downloadWorkbook(`브로페이_입출금_${state.weekStart}.xlsx`, rows, '브로페이');
  }

  function renderBropayTable() {
    const list = revenue.listBropay(state.weekStart);
    const bodyEl = $('revenueBropayBody');
    const totalEl = $('revenueBropayTotal');
    if (!bodyEl) return;

    if (!list.length) {
      bodyEl.innerHTML = `<tr><td colspan="${BROPAY_COLUMNS.length + 1}" class="empty-cell">등록된 브로페이 입출금 내역이 없습니다.</td></tr>`;
      if (totalEl) totalEl.textContent = '0건';
      return;
    }

    bodyEl.innerHTML = list.map(item => `
      <tr>
        <td>${formatDate(item.withdrawalDate)}</td>
        <td>${escapeHtml(item.name || '-')}</td>
        <td>${escapeHtml(item.branch || '-')}</td>
        <td class="num">${formatMoney(item.amount)}</td>
        <td>${escapeHtml(item.reason || '-')}</td>
        <td class="row-actions">
          <button type="button" class="small-btn" data-bropay-edit="${item.id}">수정</button>
          <button type="button" class="small-btn danger" data-bropay-delete="${item.id}">삭제</button>
        </td>
      </tr>`).join('');

    if (totalEl) {
      totalEl.textContent = `${list.length}건 · ${formatMoney(list.reduce((sum, item) => sum + Number(item.amount || 0), 0))}`;
    }
  }

  function fillBropayForm(record = {}) {
    $('revenueBropayEditId').value = record.id || '';
    $('revenueBropayWithdrawalDate').value = record.withdrawalDate || '';
    $('revenueBropayName').value = record.name || '';
    $('revenueBropayBranch').value = record.branch || '';
    $('revenueBropayAmount').value = record.amount || '';
    $('revenueBropayReason').value = record.reason || '';
    refreshOfficeDateLabel('revenueBropayWithdrawalDate');
  }

  function renderOfficeTable() {
    const list = revenue.listOfficeExpenses(state.monthKey);
    const variable = list.filter(item => item.category !== 'fixed');
    const fixed = list.filter(item => item.category === 'fixed');
    const bodyEl = $('revenueOfficeBody');
    const totalEl = $('revenueOfficeTotal');
    if (!bodyEl) return;

    const renderRows = items => items.map(item => `
      <tr>
        ${OFFICE_COLUMNS.map(col => {
          const value = item[col.key];
          if (col.money) return `<td class="num">${formatMoney(value)}</td>`;
          if (col.key.includes('Date')) return `<td>${formatDate(value)}</td>`;
          return `<td>${escapeHtml(value || '-')}</td>`;
        }).join('')}
        <td>${item.category === 'fixed' ? '고정' : '변동'}</td>
        <td class="row-actions">
          <button type="button" class="small-btn" data-office-edit="${item.id}">수정</button>
          <button type="button" class="small-btn danger" data-office-delete="${item.id}">삭제</button>
        </td>
      </tr>`).join('');

    if (!list.length) {
      bodyEl.innerHTML = `<tr><td colspan="${OFFICE_COLUMNS.length + 2}" class="empty-cell">등록된 사무실 지출 내역이 없습니다.</td></tr>`;
    } else {
      bodyEl.innerHTML = `
        ${variable.length ? `<tr class="revenue-office-section"><td colspan="${OFFICE_COLUMNS.length + 2}">변동 지출</td></tr>${renderRows(variable)}` : ''}
        ${fixed.length ? `<tr class="revenue-office-section"><td colspan="${OFFICE_COLUMNS.length + 2}">고정 지출</td></tr>${renderRows(fixed)}` : ''}`;
    }

    const sum = list.reduce((acc, item) => acc + Number(item.finalAmount || item.paidAmount || 0), 0);
    if (totalEl) totalEl.textContent = `${list.length}건 · ${formatMoney(sum)}`;
  }

  function fillOfficeForm(record = {}) {
    $('revenueOfficeEditId').value = record.id || '';
    $('revenueOfficeCategory').value = record.category === 'fixed' ? 'fixed' : 'variable';
    $('revenueOfficeFixedItemWrap').hidden = record.category !== 'fixed';
    $('revenueOfficeFixedItem').value = record.fixedItemName || '';
    $('revenueOfficeWrittenDate').value = record.writtenDate || '';
    $('revenueOfficeSpender').value = record.spender || '';
    $('revenueOfficeName').value = record.name || '';
    $('revenueOfficePlannedAmount').value = record.plannedAmount || '';
    $('revenueOfficePaidAmount').value = record.paidAmount || '';
    $('revenueOfficePaidDate').value = record.paidDate || '';
    $('revenueOfficeLocation').value = record.location || '';
    $('revenueOfficeFinalAmount').value = record.finalAmount || '';
    refreshOfficeDateLabels();
  }

  function renderMonthlySummary() {
    const data = revenue.aggregateMonthSettlement(state.monthKey);
    const saved = revenue.listMonthlySettlements(state.monthKey)[0];

    $('revenueSummaryWeeklyCount').textContent = `${data.weeks.length}주`;
    $('revenueSummaryWeeklyNet').textContent = formatMoney(
      data.weeks.reduce((sum, week) => sum + week.combined.netProfit, 0)
    );
    $('revenueSummaryBaemin').textContent = formatMoney(
      data.weeks.reduce((sum, week) => sum + week.baemin.netProfit, 0)
    );
    $('revenueSummaryCoupang').textContent = formatMoney(
      data.weeks.reduce((sum, week) => sum + week.coupang.netProfit, 0)
    );
    $('revenueSummaryOffice').textContent = formatMoney(data.officeTotal);
    $('revenueSummaryBropay').textContent = formatMoney(
      data.weeks.reduce((sum, week) => sum + week.bropayTotal, 0)
    );
    $('revenueSummaryMonthNet').textContent = formatMoney(data.combined.netProfit);

    const statusEl = $('revenueMonthlySavedStatus');
    if (statusEl) {
      statusEl.textContent = saved
        ? `마지막 저장: ${new Date(saved.savedAt).toLocaleString('ko-KR')}`
        : '아직 저장되지 않았습니다.';
    }

    const monthlyMemo = $('revenueMonthlyMemo');
    if (monthlyMemo) monthlyMemo.value = saved?.memo || '';

    const listEl = $('revenueSummaryWeekList');
    if (!listEl) return;

    if (!data.weeks.length) {
      listEl.innerHTML = '<p class="form-help">선택한 월에 저장된 주간 수입/정산 데이터가 없습니다.</p>';
      return;
    }

    listEl.innerHTML = data.weeks.map(week => `
      <div class="revenue-summary-week-row">
        <span>${formatWeekRange(week.weekStart)} · ${week.combined.regionCount}개 지역</span>
        <strong>${formatMoney(week.combined.netProfit)}</strong>
      </div>`).join('');
  }

  function saveMonthlySettlement() {
    if (!state.monthKey) {
      showToast('월을 선택하세요.');
      return;
    }
    const memo = $('revenueMonthlyMemo')?.value || '';
    revenue.saveMonthlySettlement(state.monthKey, memo);
    showToast(`${formatMonthLabel(state.monthKey)} 월간 정산이 저장되었습니다.`);
    renderMonthlySummary();
  }

  function exportMonthlySettlement() {
    const data = revenue.aggregateMonthSettlement(state.monthKey);
    const rows = [
      ['월간 정산', formatMonthLabel(state.monthKey)],
      [],
      ['주차', '총수익', '총지출', '순익', '지역수']
    ];
    data.weeks.forEach(week => {
      rows.push([
        formatWeekRange(week.weekStart),
        week.combined.totalRevenue,
        week.combined.totalExpense,
        week.combined.netProfit,
        week.combined.regionCount
      ]);
    });
    rows.push([]);
    rows.push(['사무실 지출', data.officeTotal, `${data.officeCount}건`]);
    rows.push(['월간 순익', data.combined.netProfit]);
    downloadWorkbook(`월간정산_${state.monthKey}.xlsx`, rows, '월간정산');
  }

  function updatePeriodTabUi() {
    document.querySelectorAll('[data-revenue-period]').forEach(button => {
      const active = button.dataset.revenuePeriod === state.periodTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('revenueWeeklyPanels').hidden = state.periodTab !== 'weekly';
    $('revenueMonthlyPanels').hidden = state.periodTab !== 'monthly';
  }

  function updateWeeklyPanelUi() {
    document.querySelectorAll('[data-revenue-weekly-panel]').forEach(button => {
      button.classList.toggle('active', button.dataset.revenueWeeklyPanel === state.weeklyPanel);
    });
    document.querySelectorAll('[data-revenue-panel="weekly"]').forEach(panel => {
      panel.hidden = panel.dataset.revenueWeeklyTarget !== state.weeklyPanel;
    });
  }

  function updateMonthlyPanelUi() {
    document.querySelectorAll('[data-revenue-monthly-panel]').forEach(button => {
      button.classList.toggle('active', button.dataset.revenueMonthlyPanel === state.monthlyPanel);
    });
    document.querySelectorAll('[data-revenue-panel="monthly"]').forEach(panel => {
      panel.hidden = panel.dataset.revenueMonthlyTarget !== state.monthlyPanel;
    });
  }

  function updateWeekUi() {
    const hidden = $('revenueWeekDate');
    if (hidden) hidden.value = state.weekStart;
    const preview = $('revenueWeekRangePreview');
    if (preview) preview.textContent = formatWeekRange(state.weekStart);
    const label = $('revenueWeekLabel');
    if (label && state.weekStart) {
      label.textContent = BremDatePicker.formatDate(state.weekStart);
    }
  }

  function setWeekStart(value) {
    state.weekStart = weekStartKey(value || today());
    updateWeekUi();
    refresh();
  }

  function setWeekStart(value) {
    state.weekStart = weekStartKey(value || today());
    updateWeekUi();
    refresh();
  }

  function incomeFormHtml(platform) {
    const p = platformPrefix(platform);
    const deficitField = platform === 'coupang' ? `
      <label class="revenue-deficit-field">
        결손보전금액 (참고)
        <input type="number" id="revenue${p}DeficitCompensation" min="0" step="1" data-income-calc placeholder="0">
      </label>` : '';

    return `
      <form class="revenue-income-form" id="revenue${p}Form">
        <input type="hidden" id="revenue${p}EditId">
        <label class="revenue-region-label">
          지역
          <input type="text" id="revenue${p}Region" required placeholder="예: 울산남배">
        </label>
        <div class="revenue-income-layout">
          <fieldset class="revenue-income-fieldset revenue-income-fieldset--revenue">
            <legend>수익</legend>
            <label>공급가 <input type="number" id="revenue${p}SupplyPrice" min="0" step="1" data-income-calc placeholder="0"></label>
            <label>라이더결제금 <input type="number" id="revenue${p}RiderPayment" min="0" step="1" data-income-calc placeholder="0"></label>
            <label class="revenue-calc-field">
              결제 수수료 (%)
              <div class="revenue-calc-row">
                <input type="number" id="revenue${p}PaymentFeePercent" min="0" max="100" step="0.01" value="3" data-income-calc>
                <span class="revenue-calc-eq">라이더결제금 × % =</span>
                <output id="revenue${p}PaymentFeeAmount" class="revenue-calc-output">0원</output>
              </div>
            </label>
            <label>관리비 <input type="number" id="revenue${p}MgmtFee" min="0" step="1" data-income-calc placeholder="0"></label>
            <label>프로모션 <input type="number" id="revenue${p}Promotion" min="0" step="1" data-income-calc placeholder="0"></label>
            <label>콜수 <input type="number" id="revenue${p}CallCount" min="0" step="1" data-income-calc required placeholder="0"></label>
            <label class="revenue-calc-field">
              콜당 수수료
              <div class="revenue-calc-row">
                <input type="number" id="revenue${p}CallFeePerCall" min="0" step="1" data-income-calc placeholder="0">
                <span class="revenue-calc-eq">× 콜수 =</span>
                <output id="revenue${p}CallFeeTotal" class="revenue-calc-output">0원</output>
              </div>
            </label>
          </fieldset>
          <fieldset class="revenue-income-fieldset revenue-income-fieldset--expense">
            <legend>지출</legend>
            <label>고용보험 <input type="number" id="revenue${p}ExpenseEmployment" min="0" step="1" data-income-calc placeholder="0"></label>
            <label>산재보험 <input type="number" id="revenue${p}ExpenseIndustrial" min="0" step="1" data-income-calc placeholder="0"></label>
            <label>부가세(적립) <input type="number" id="revenue${p}VatReserve" min="0" step="1" data-income-calc placeholder="0"></label>
            <label>프로모션 <input type="number" id="revenue${p}ExpensePromotion" min="0" step="1" data-income-calc placeholder="0"></label>
          </fieldset>
          <fieldset class="revenue-income-fieldset revenue-income-fieldset--result">
            <legend>순익</legend>
            <div class="revenue-result-row"><span>총 수익</span><strong id="revenue${p}TotalRevenue" class="revenue-calc-output">0원</strong></div>
            <div class="revenue-result-row"><span>총 지출</span><strong id="revenue${p}TotalExpense" class="revenue-calc-output">0원</strong></div>
            ${deficitField}
            <div class="revenue-result-row revenue-result-row--net"><span>순익 (수익−지출)</span><strong id="revenue${p}NetProfit" class="revenue-calc-output revenue-net-value">0원</strong></div>
            <label>비고 <input type="text" id="revenue${p}Memo" placeholder="선택"></label>
          </fieldset>
        </div>
        <div class="revenue-form-actions">
          <button type="button" class="small-btn" id="revenue${p}ResetBtn">초기화</button>
          <button type="submit" class="primary-btn">지역별 저장</button>
        </div>
      </form>`;
  }

  function mountIncomeForms() {
    const coupangMount = $('revenueCoupangFormMount');
    const baeminMount = $('revenueBaeminFormMount');
    if (coupangMount && !coupangMount.innerHTML.trim()) {
      coupangMount.innerHTML = incomeFormHtml('coupang');
    }
    if (baeminMount && !baeminMount.innerHTML.trim()) {
      baeminMount.innerHTML = incomeFormHtml('baemin');
    }
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    mountIncomeForms();

    document.getElementById('revenue-management')?.addEventListener('submit', event => {
      const baeminForm = event.target.closest('#revenueBaeminForm');
      const coupangForm = event.target.closest('#revenueCoupangForm');
      if (baeminForm) {
        event.preventDefault();
        saveIncomeForm('baemin');
      } else if (coupangForm) {
        event.preventDefault();
        saveIncomeForm('coupang');
      }
    });

    document.getElementById('revenue-management')?.addEventListener('input', event => {
      if (!event.target.matches('[data-income-calc]')) return;
      const form = event.target.closest('.revenue-income-form');
      if (!form) return;
      const platform = form.id === 'revenueBaeminForm' ? 'baemin' : 'coupang';
      updateIncomePreview(platform);
    });

    document.querySelectorAll('[data-revenue-period]').forEach(button => {
      button.addEventListener('click', () => {
        state.periodTab = button.dataset.revenuePeriod;
        updatePeriodTabUi();
      });
    });

    document.querySelectorAll('[data-revenue-weekly-panel]').forEach(button => {
      button.addEventListener('click', () => {
        state.weeklyPanel = button.dataset.revenueWeeklyPanel;
        updateWeeklyPanelUi();
      });
    });

    document.querySelectorAll('[data-revenue-monthly-panel]').forEach(button => {
      button.addEventListener('click', () => {
        state.monthlyPanel = button.dataset.revenueMonthlyPanel;
        updateMonthlyPanelUi();
      });
    });

    $('revenueMonthInput')?.addEventListener('change', event => {
      state.monthKey = event.target.value || today().slice(0, 7);
      $('revenueMonthLabel').textContent = formatMonthLabel(state.monthKey);
      refresh();
    });

    $('revenueFinalSaveBtn')?.addEventListener('click', saveFinalSettlement);
    $('revenueFinalExportBtn')?.addEventListener('click', exportFinalSettlement);

    $('revenueBropayForm')?.addEventListener('submit', event => {
      event.preventDefault();
      revenue.saveBropay({
        id: $('revenueBropayEditId').value,
        weekStart: state.weekStart,
        withdrawalDate: $('revenueBropayWithdrawalDate').value,
        name: $('revenueBropayName').value,
        branch: $('revenueBropayBranch').value,
        amount: $('revenueBropayAmount').value,
        reason: $('revenueBropayReason').value
      });
      showToast('브로페이 내역이 저장되었습니다.');
      fillBropayForm({});
      renderBropayTable();
      renderFinalSettlement();
      renderMonthlySummary();
      exportBropay();
    });

    $('revenueBropayResetBtn')?.addEventListener('click', () => fillBropayForm({}));

    $('revenueOfficeForm')?.addEventListener('submit', event => {
      event.preventDefault();
      revenue.saveOfficeExpense({
        id: $('revenueOfficeEditId').value,
        monthKey: state.monthKey,
        category: $('revenueOfficeCategory').value,
        fixedItemName: $('revenueOfficeFixedItem').value,
        writtenDate: $('revenueOfficeWrittenDate').value,
        spender: $('revenueOfficeSpender').value,
        name: $('revenueOfficeName').value,
        plannedAmount: $('revenueOfficePlannedAmount').value,
        paidAmount: $('revenueOfficePaidAmount').value,
        paidDate: $('revenueOfficePaidDate').value,
        location: $('revenueOfficeLocation').value,
        finalAmount: $('revenueOfficeFinalAmount').value
      });
      showToast('사무실 지출 내역이 저장되었습니다.');
      fillOfficeForm({});
      renderOfficeTable();
      renderMonthlySummary();
    });

    $('revenueOfficeCategory')?.addEventListener('change', event => {
      $('revenueOfficeFixedItemWrap').hidden = event.target.value !== 'fixed';
    });

    $('revenueOfficeResetBtn')?.addEventListener('click', () => fillOfficeForm({}));
    $('revenueMonthlySaveBtn')?.addEventListener('click', saveMonthlySettlement);
    $('revenueMonthlyExportBtn')?.addEventListener('click', exportMonthlySettlement);

    document.getElementById('revenue-management')?.addEventListener('click', event => {
      if (event.target.id === 'revenueBaeminResetBtn') resetIncomeForm('baemin');
      if (event.target.id === 'revenueCoupangResetBtn') resetIncomeForm('coupang');

      const incomeEdit = event.target.closest('[data-income-edit]');
      if (incomeEdit) {
        const platform = incomeEdit.dataset.incomeEdit;
        const list = platform === 'baemin'
          ? revenue.listIncomeBaemin(state.weekStart)
          : revenue.listIncomeCoupang(state.weekStart);
        const record = list.find(item => item.id === incomeEdit.dataset.id);
        if (record) fillIncomeForm(platform, record);
        return;
      }

      const incomeDelete = event.target.closest('[data-income-delete]');
      if (incomeDelete) {
        const platform = incomeDelete.dataset.incomeDelete;
        if (platform === 'baemin') revenue.removeIncomeBaemin(incomeDelete.dataset.id);
        else revenue.removeIncomeCoupang(incomeDelete.dataset.id);
        renderIncomeTable(platform);
        renderFinalSettlement();
        renderMonthlySummary();
        return;
      }

      const bropayEdit = event.target.closest('[data-bropay-edit]');
      if (bropayEdit) {
        const record = revenue.listBropay(state.weekStart).find(item => item.id === bropayEdit.dataset.bropayEdit);
        if (record) fillBropayForm(record);
        return;
      }

      const bropayDelete = event.target.closest('[data-bropay-delete]');
      if (bropayDelete) {
        revenue.removeBropay(bropayDelete.dataset.bropayDelete);
        renderBropayTable();
        renderFinalSettlement();
        renderMonthlySummary();
        return;
      }

      const officeEdit = event.target.closest('[data-office-edit]');
      if (officeEdit) {
        const record = revenue.listOfficeExpenses(state.monthKey).find(item => item.id === officeEdit.dataset.officeEdit);
        if (record) fillOfficeForm(record);
        return;
      }

      const officeDelete = event.target.closest('[data-office-delete]');
      if (officeDelete) {
        revenue.removeOfficeExpense(officeDelete.dataset.officeDelete);
        renderOfficeTable();
        renderMonthlySummary();
      }
    });
  }

  function refresh() {
    if (!state.weekStart) state.weekStart = weekStartKey();
    if (!state.monthKey) state.monthKey = today().slice(0, 7);

    mountIncomeForms();

    const fixedSelect = $('revenueOfficeFixedItem');
    if (fixedSelect && fixedSelect.options.length <= 1) {
      revenue.FIXED_EXPENSE_NAMES.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        fixedSelect.appendChild(option);
      });
    }

    const monthInput = $('revenueMonthInput');
    if (monthInput) monthInput.value = state.monthKey;

    updatePeriodTabUi();
    updateWeeklyPanelUi();
    updateMonthlyPanelUi();
    updateWeekUi();
    $('revenueMonthLabel').textContent = formatMonthLabel(state.monthKey);

    ['baemin', 'coupang'].forEach(platform => {
      updateIncomePreview(platform);
      renderIncomeTable(platform);
    });
    renderFinalSettlement();
    renderBropayTable();
    renderOfficeTable();
    renderMonthlySummary();
    refreshOfficeDateLabels();
  }

  bindEvents();
  window.BremAdminRevenue = { refresh, setWeekStart };
})();

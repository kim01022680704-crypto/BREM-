(function () {
  const roster = window.BremPayrollDailySettlementAdmin;
  if (!roster) return;

  const state = {
    selectedIds: new Set(),
    bulkPreview: [],
    driverSearchKeyword: '',
    rosterSearchKeyword: '',
    rosterRegionFilter: '',
    settleRegion: '',
    regionDetailOpen: false,
    platform: 'coupang',
    subTab: 'payout',
    payoutDate: '',
    withdrawalRows: [],
    weekWithdrawalRows: []
  };

  function $(id) {
    return document.getElementById(id);
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

  function getDrivers() {
    if (window.BremPayrollLocalBaseData?.isActive?.()) {
      return window.BremPayrollLocalBaseData.getDrivers();
    }
    if (window.BremPayrollProductionRiders?.isActive?.()) {
      return window.BremPayrollProductionRiders.getRiders();
    }
    return BremStorage?.drivers?.getAll?.() || [];
  }

  function resolveBaeminId(driver) {
    return roster.resolveDriverPlatformId?.(driver, 'baemin') || driver.baeminId || '';
  }

  function resolveCoupangId(driver) {
    return roster.resolveDriverPlatformId?.(driver, 'coupang') || driver.coupangId || '';
  }

  function formatWon(value) {
    return `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
  }

  function platformLabelKo(platform = state.platform) {
    return platform === 'baemin' ? '배민' : '쿠팡';
  }

  function readRosterForPlatform(list) {
    const source = Array.isArray(list) ? list : roster.readAll();
    return roster.filterRosterByPlatform?.(source, state.platform) || source.filter(item => {
      const platforms = normalizePlatforms(item);
      return state.platform === 'baemin'
        ? platforms.platformBaemin !== false
        : platforms.platformCoupang !== false;
    });
  }

  function syncPlatformTabs() {
    document.querySelectorAll('[data-pds-platform-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.pdsPlatformTab === state.platform);
    });
  }

  function syncSubTabs() {
    document.querySelectorAll('[data-pds-sub-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.pdsSubTab === state.subTab);
    });
    document.querySelectorAll('[data-pds-panel]').forEach(panel => {
      panel.hidden = panel.dataset.pdsPanel !== state.subTab;
    });
  }

  function syncDailyFeeModeUi(mode) {
    const normalized = mode === 'percent' ? 'percent' : 'fixed';
    const modeSelect = $('payrollDailySettlementDailyFeeMode');
    const dailyInput = $('payrollDailySettlementDailyFee');
    const label = $('payrollDailySettlementDailyFeeLabel');
    if (modeSelect && modeSelect.value !== normalized) modeSelect.value = normalized;
    if (label) label.textContent = normalized === 'percent' ? '일정산수수료 (%)' : '일정산수수료 (원)';
    if (dailyInput) {
      dailyInput.step = normalized === 'percent' ? '0.01' : '1';
      dailyInput.min = '0';
    }
  }

  function syncCallFeeVisibleBtn() {
    const btn = $('payrollDailySettlementCallFeeVisibleBtn');
    const show = isCallFeeVisible();
    if (btn) {
      btn.textContent = show ? 'ON' : 'OFF';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.classList.toggle('is-off', !show);
    }
    document.querySelectorAll('.pds-call-fee-col').forEach(el => {
      el.hidden = !show;
    });
  }

  function isCallFeeVisible() {
    if (BremStorage?.payrollDailySettlement?.isCallFeeVisible) {
      return BremStorage.payrollDailySettlement.isCallFeeVisible();
    }
    return roster.readAllFees?.()?.showCallFee !== false;
  }

  function syncFeeInputs() {
    const allFees = roster.readAllFees?.() || {
      showCallFee: true,
      coupang: { callFee: 0, dailySettlementFee: 0, dailySettlementFeeMode: 'fixed' },
      baemin: { callFee: 0, dailySettlementFee: 0, dailySettlementFeeMode: 'fixed' }
    };
    const fees = allFees[state.platform] || allFees.coupang || {
      callFee: 0,
      dailySettlementFee: 0,
      dailySettlementFeeMode: 'fixed'
    };
    const callInput = $('payrollDailySettlementCallFee');
    const dailyInput = $('payrollDailySettlementDailyFee');
    const mode = fees.dailySettlementFeeMode === 'percent' ? 'percent' : 'fixed';
    syncDailyFeeModeUi(mode);
    if (callInput) callInput.value = String(fees.callFee || 0);
    if (dailyInput) dailyInput.value = String(fees.dailySettlementFee || 0);
    syncCallFeeVisibleBtn();
  }

  function ensurePayoutDateDefault() {
    const input = $('payrollDailySettlementPayoutDate');
    if (!input) return;
    if (state.payoutDate) {
      input.value = state.payoutDate;
      return;
    }
    if (!input.value) {
      input.value = new Date().toISOString().slice(0, 10);
    }
    state.payoutDate = input.value;
  }

  function renderPayoutTable() {
    ensurePayoutDateDefault();
    syncFeeInputs();
    const body = $('payrollDailySettlementPayoutBody');
    const summary = $('payrollDailySettlementPayoutSummary');
    if (!body) return;

    const period = state.payoutDate || $('payrollDailySettlementPayoutDate')?.value || '';
    const rows = roster.buildPayoutRows?.({ platform: state.platform, period }) || [];
    const withAmount = rows.filter(row => row.hasSettlement && row.settlementAmount > 0);
    const totalNet = rows.reduce((sum, row) => sum + (Number(row.netPay) || 0), 0);
    const showCallFee = isCallFeeVisible();
    const colSpan = showCallFee ? 12 : 11;

    if (summary) {
      summary.textContent = `${platformLabelKo()} · 정산일 ${period || '-'} · 등록 ${rows.length}명 · 업로드매칭 ${withAmount.length}명 · 실지급 합계 ${formatWon(totalNet)}`;
    }

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colSpan}" class="empty">일정산 등록 기사가 없습니다. 「일정산 기사등록」에서 등록하세요.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map(row => `
      <tr class="${row.hasSettlement ? '' : 'is-muted'}">
        <td><strong>${escapeHtml(row.driverName || '-')}</strong></td>
        <td>${escapeHtml(row.baeminId || '-')}</td>
        <td>${escapeHtml(row.coupangId || '-')}</td>
        <td>${formatWon(row.settlementAmount)}</td>
        <td>${Number(row.orderCount || 0).toLocaleString('ko-KR')}</td>
        <td>${formatWon(row.employmentInsurance)}</td>
        <td>${formatWon(row.industrialAccidentInsurance)}</td>
        <td>${formatWon(row.withholdingTax)}</td>
        ${showCallFee ? `<td class="pds-call-fee-col">${formatWon(row.callFee)}</td>` : ''}
        <td>${formatWon(row.dailySettlementFee)}</td>
        <td>${formatWon(row.hourlyInsurance)}</td>
        <td class="pds-net-col"><strong>${formatWon(row.netPay)}</strong></td>
      </tr>
    `).join('');
  }

  async function saveFeesFromInputs() {
    const callFee = Math.max(0, Math.round(Number($('payrollDailySettlementCallFee')?.value || 0)));
    const dailySettlementFeeMode = $('payrollDailySettlementDailyFeeMode')?.value === 'percent'
      ? 'percent'
      : 'fixed';
    const feeRaw = Number($('payrollDailySettlementDailyFee')?.value || 0);
    const dailySettlementFee = dailySettlementFeeMode === 'percent'
      ? Math.max(0, Math.round(feeRaw * 1000) / 1000)
      : Math.max(0, Math.round(feeRaw));
    try {
      const all = roster.readAllFees?.() || {
        showCallFee: true,
        coupang: { callFee: 0, dailySettlementFee: 0, dailySettlementFeeMode: 'fixed' },
        baemin: { callFee: 0, dailySettlementFee: 0, dailySettlementFeeMode: 'fixed' }
      };
      all[state.platform] = { callFee, dailySettlementFee, dailySettlementFeeMode };
      all.showCallFee = all.showCallFee !== false;
      await roster.persistFees(all);
      syncFeeInputs();
      renderPayoutTable();
      const modeLabel = dailySettlementFeeMode === 'percent' ? `${dailySettlementFee}%` : `${dailySettlementFee.toLocaleString('ko-KR')}원`;
      showToast(`${platformLabelKo()} 수수료 저장 · 일정산 ${modeLabel}`);
    } catch (error) {
      console.error('[daily settlement fees]', error);
      showToast(error.message || '수수료 저장에 실패했습니다.');
    }
  }

  async function toggleCallFeeVisibility() {
    try {
      const all = roster.readAllFees?.() || {
        showCallFee: true,
        coupang: { callFee: 0, dailySettlementFee: 0, dailySettlementFeeMode: 'fixed' },
        baemin: { callFee: 0, dailySettlementFee: 0, dailySettlementFeeMode: 'fixed' }
      };
      all.showCallFee = !(all.showCallFee !== false);
      await roster.persistFees(all);
      syncFeeInputs();
      renderPayoutTable();
      showToast(all.showCallFee ? '콜수수료 표시 ON' : '콜수수료 표시 OFF');
    } catch (error) {
      console.error('[call fee visibility]', error);
      showToast(error.message || '콜수수료 표시 설정 저장에 실패했습니다.');
    }
  }

  function exportPayoutExcel() {
    const period = state.payoutDate || $('payrollDailySettlementPayoutDate')?.value || '';
    if (!period) {
      showToast('정산일을 선택하세요.');
      return;
    }
    const rows = roster.buildPayoutRows?.({ platform: state.platform, period }) || [];
    if (!rows.length) {
      showToast('내보낼 등록 기사가 없습니다.');
      return;
    }
    try {
      const stamp = period.replace(/-/g, '');
      const filename = `BREM_급여일정산_지급_${platformLabelKo()}_${stamp}.xlsx`;
      roster.exportPayoutRowsToExcel(rows, filename, '일정산지급');
      showToast(`엑셀 저장: ${filename}`);
    } catch (error) {
      console.error('[daily settlement payout export]', error);
      showToast(error.message || '엑셀 내보내기에 실패했습니다.');
    }
  }

  function setPlatform(platform) {
    state.platform = platform === 'baemin' ? 'baemin' : 'coupang';
    const enrollBaemin = $('payrollDailySettlementEnrollBaemin');
    const enrollCoupang = $('payrollDailySettlementEnrollCoupang');
    if (enrollBaemin) enrollBaemin.checked = state.platform === 'baemin';
    if (enrollCoupang) enrollCoupang.checked = state.platform === 'coupang';
    syncPlatformTabs();
    syncFeeInputs();
    refreshAll();
  }

  function setSubTab(tab) {
    if (tab === 'enroll') state.subTab = 'enroll';
    else if (tab === 'withdrawals') state.subTab = 'withdrawals';
    else if (tab === 'week-withdrawals') state.subTab = 'week-withdrawals';
    else state.subTab = 'payout';
    syncSubTabs();
    refreshAll();
  }

  function weekStartKey(dateValue) {
    const utils = window.BremPayrollSlipUtils || window.BremDatePicker;
    if (utils?.normalizeSettlementWeekStart) {
      return utils.normalizeSettlementWeekStart(dateValue);
    }
    if (utils?.weekStartKey) return utils.weekStartKey(dateValue);
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

  function ensureWithdrawalDateDefault() {
    const input = $('payrollDailyWithdrawalDate');
    if (!input) return '';
    if (!input.value) {
      input.value = new Date().toISOString().slice(0, 10);
    }
    return String(input.value || '').slice(0, 10);
  }

  function statusLabel(status) {
    if (status === 'cancelled') return '취소';
    if (status === 'completed') return '처리완료';
    return '신청';
  }

  function withdrawalPlatformLabel(platform) {
    if (platform === 'baemin') return '배민';
    if (platform === 'coupang') return '쿠팡';
    return '미지정';
  }

  function weekEndKey(weekStart) {
    const utils = window.BremPayrollSlipUtils || window.BremDatePicker;
    if (utils?.settlementWeekEnd) return utils.settlementWeekEnd(weekStart);
    if (utils?.weekEndKey) return utils.weekEndKey(weekStart);
    const date = new Date(`${weekStart}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + 6);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function formatWeekPeriodLabel(weekStart) {
    const end = weekEndKey(weekStart);
    const utils = window.BremPayrollSlipUtils || window.BremDatePicker;
    if (utils?.formatWednesdayWeekRange) return utils.formatWednesdayWeekRange(weekStart);
    if (utils?.formatSettlementWeekLabel) return utils.formatSettlementWeekLabel(weekStart);
    return `${weekStart || '-'}(수) ~ ${end || '-'}(화)`;
  }

  function ensureWeekWithdrawalDefault() {
    const input = $('payrollDailyWeekWithdrawalWeekStart');
    if (!input) return '';
    if (!input.value) {
      input.value = weekStartKey(new Date().toISOString().slice(0, 10));
    } else {
      const normalized = weekStartKey(input.value);
      if (normalized && input.value !== normalized) input.value = normalized;
    }
    return String(input.value || '').slice(0, 10);
  }

  function shiftWeekWithdrawal(deltaWeeks) {
    const current = ensureWeekWithdrawalDefault();
    if (!current) return;
    const date = new Date(`${current}T00:00:00`);
    date.setDate(date.getDate() + (deltaWeeks * 7));
    const next = weekStartKey([
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-'));
    const input = $('payrollDailyWeekWithdrawalWeekStart');
    if (input) input.value = next;
    void renderWeekWithdrawals();
  }

  async function renderWithdrawalRequests() {
    const body = $('payrollDailyWithdrawalBody');
    const summary = $('payrollDailyWithdrawalSummary');
    if (!body) return;

    const date = ensureWithdrawalDateDefault();
    const status = String($('payrollDailyWithdrawalStatusFilter')?.value || '').trim();
    let rows = [];
    try {
      if (BremStorage?.payrollWithdrawal?.fetchFromAdminApi) {
        rows = await BremStorage.payrollWithdrawal.fetchFromAdminApi({ date, status });
      } else {
        rows = (BremStorage?.payrollWithdrawal?.getAll?.() || []).filter(item => {
          const requestDate = String(item.requestDate || item.createdAt || '').slice(0, 10);
          if (date && requestDate !== date) return false;
          if (status && item.status !== status) return false;
          return true;
        });
      }
    } catch (error) {
      console.warn('[withdrawal list]', error);
      rows = (BremStorage?.payrollWithdrawal?.getAll?.() || []).filter(item => {
        const requestDate = String(item.requestDate || item.createdAt || '').slice(0, 10);
        if (date && requestDate !== date) return false;
        if (status && item.status !== status) return false;
        return true;
      });
      showToast(error.message || '출금신청 목록을 불러오지 못했습니다.');
    }

    const pendingRows = rows.filter(row => row.status === 'pending');
    const totalAmount = pendingRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const showCallFee = rows.some(row => row.showCallFee !== false) && isCallFeeVisible();
    const colSpan = showCallFee ? 18 : 17;
    const driverMap = new Map(getDrivers().map(driver => [String(driver.id || ''), driver]));
    rows = rows.map(row => {
      const driver = driverMap.get(String(row.driverId || '')) || null;
      return {
        ...row,
        bankName: row.bankName || driver?.bankName || '',
        accountNumber: row.accountNumber || driver?.accountNumber || ''
      };
    });
    state.withdrawalRows = rows;
    document.querySelectorAll('#payrollDailyWithdrawalTable .pds-call-fee-col').forEach(el => {
      el.hidden = !showCallFee;
    });

    if (summary) {
      summary.textContent = `신청일 ${date || '-'} · ${rows.length}건 · 신청중 ${pendingRows.length}건 · 신청중 합계 ${formatWon(totalAmount)}`;
    }

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colSpan}" class="empty">해당 날짜 출금신청이 없습니다.</td></tr>`;
      return;
    }

    body.innerHTML = rows.map(row => {
      const canCancel = row.status === 'pending';
      const canComplete = row.status === 'pending';
      const rowShowCall = showCallFee && row.showCallFee !== false;
      return `
      <tr>
        <td>${escapeHtml(row.createdAt ? new Date(row.createdAt).toLocaleString('ko-KR') : '-')}</td>
        <td><strong>${escapeHtml(row.driverName || '-')}</strong></td>
        <td>${escapeHtml(withdrawalPlatformLabel(row.platform))}</td>
        <td>${escapeHtml(row.requestDate || String(row.createdAt || '').slice(0, 10) || '-')}</td>
        <td>${escapeHtml(`${row.weekStart || '-'} ~ ${row.weekEnd || '-'}`)}</td>
        <td>${formatWon(row.settlementAmount)}</td>
        <td>${Number(row.orderCount || 0).toLocaleString('ko-KR')}</td>
        <td>${formatWon(row.employmentInsurance)}</td>
        <td>${formatWon(row.industrialAccidentInsurance)}</td>
        <td>${formatWon(row.withholdingTax)}</td>
        ${rowShowCall ? `<td class="pds-call-fee-col">${formatWon(row.callFee)}</td>` : ''}
        <td>${formatWon(row.dailySettlementFee)}</td>
        <td>${formatWon(row.hourlyInsurance)}</td>
        <td class="pds-net-col"><strong>${formatWon(row.netPay)}</strong></td>
        <td>${formatWon(row.availableAtRequest)}</td>
        <td><strong>${formatWon(row.amount)}</strong></td>
        <td>${escapeHtml(statusLabel(row.status))}</td>
        <td>
          ${canComplete ? `<button type="button" class="small-btn primary-btn" data-pds-wd-complete="${escapeHtml(row.id)}">출금완료</button>` : ''}
          ${canCancel ? `<button type="button" class="small-btn" data-pds-wd-cancel="${escapeHtml(row.id)}">취소</button>` : ''}
          <button type="button" class="small-btn danger-btn" data-pds-wd-delete="${escapeHtml(row.id)}">삭제</button>
        </td>
      </tr>`;
    }).join('');
  }

  async function renderWeekWithdrawals() {
    const body = $('payrollDailyWeekWithdrawalBody');
    const summary = $('payrollDailyWeekWithdrawalSummary');
    const periodLabel = $('payrollDailyWeekWithdrawalPeriodLabel');
    if (!body) return;

    const weekStart = ensureWeekWithdrawalDefault();
    const weekEnd = weekEndKey(weekStart);
    if (periodLabel) periodLabel.textContent = formatWeekPeriodLabel(weekStart);

    let rows = [];
    try {
      if (BremStorage?.payrollWithdrawal?.fetchFromAdminApi) {
        rows = await BremStorage.payrollWithdrawal.fetchFromAdminApi({ weekStart });
      } else {
        rows = (BremStorage?.payrollWithdrawal?.getAll?.() || []).filter(item => item.weekStart === weekStart);
      }
    } catch (error) {
      console.warn('[week withdrawal list]', error);
      rows = (BremStorage?.payrollWithdrawal?.getAll?.() || []).filter(item => item.weekStart === weekStart);
      showToast(error.message || '주정산 출금내역을 불러오지 못했습니다.');
    }

    const activeRows = rows.filter(row => row.status !== 'cancelled');
    const driverMap = new Map(getDrivers().map(driver => [String(driver.id || ''), driver]));
    const byDriver = new Map();

    activeRows.forEach(row => {
      const driverId = String(row.driverId || '');
      if (!driverId) return;
      if (!byDriver.has(driverId)) {
        const driver = driverMap.get(driverId) || null;
        byDriver.set(driverId, {
          driverId,
          driverName: row.driverName || driver?.name || '-',
          baeminId: driver ? (resolveBaeminId(driver) || '') : '',
          coupangId: driver ? (resolveCoupangId(driver) || '') : '',
          coupangAmount: 0,
          baeminAmount: 0,
          unknownAmount: 0,
          totalAmount: 0,
          count: 0,
          pendingAmount: 0,
          completedAmount: 0
        });
      }
      const entry = byDriver.get(driverId);
      const amount = Math.max(0, Math.round(Number(row.amount) || 0));
      entry.totalAmount += amount;
      entry.count += 1;
      if (row.platform === 'baemin') entry.baeminAmount += amount;
      else if (row.platform === 'coupang') entry.coupangAmount += amount;
      else entry.unknownAmount += amount;
      if (row.status === 'completed') entry.completedAmount += amount;
      else entry.pendingAmount += amount;
    });

    const list = Array.from(byDriver.values()).sort((a, b) => {
      const nameCmp = String(a.driverName || '').localeCompare(String(b.driverName || ''), 'ko');
      if (nameCmp) return nameCmp;
      return String(a.driverId).localeCompare(String(b.driverId));
    });
    state.weekWithdrawalRows = list;

    const totalAmount = list.reduce((sum, row) => sum + row.totalAmount, 0);
    const coupangTotal = list.reduce((sum, row) => sum + row.coupangAmount, 0);
    const baeminTotal = list.reduce((sum, row) => sum + row.baeminAmount, 0);
    if (summary) {
      summary.textContent = `정산주 ${weekStart} ~ ${weekEnd} · ${list.length}명 · 합계 ${formatWon(totalAmount)} · 쿠팡 ${formatWon(coupangTotal)} · 배민 ${formatWon(baeminTotal)} (신청+처리완료, 취소 제외)`;
    }

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="10" class="empty">해당 정산주 출금내역이 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = list.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.driverName || '-')}</strong></td>
        <td>${escapeHtml(row.baeminId || '-')}</td>
        <td>${escapeHtml(row.coupangId || '-')}</td>
        <td>${formatWon(row.coupangAmount)}</td>
        <td>${formatWon(row.baeminAmount)}</td>
        <td>${formatWon(row.unknownAmount)}</td>
        <td><strong>${formatWon(row.totalAmount)}</strong></td>
        <td>${Number(row.count || 0).toLocaleString('ko-KR')}</td>
        <td>${formatWon(row.pendingAmount)}</td>
        <td>${formatWon(row.completedAmount)}</td>
      </tr>
    `).join('');
  }

  function exportWeekWithdrawalExcel() {
    const rows = Array.isArray(state.weekWithdrawalRows) ? state.weekWithdrawalRows : [];
    if (!rows.length) {
      showToast('내보낼 주정산 출금내역이 없습니다.');
      return;
    }
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    try {
      const weekStart = ensureWeekWithdrawalDefault() || new Date().toISOString().slice(0, 10);
      const stamp = weekStart.replace(/-/g, '');
      const filename = `BREM_주정산출금내역_${stamp}.xlsx`;
      const data = [
        ['이름', '배민ID', '쿠팡ID', '쿠팡 출금', '배민 출금', '미지정', '합계', '건수', '신청중', '처리완료'],
        ...rows.map(row => [
          row.driverName || '',
          row.baeminId || '',
          row.coupangId || '',
          Number(row.coupangAmount) || 0,
          Number(row.baeminAmount) || 0,
          Number(row.unknownAmount) || 0,
          Number(row.totalAmount) || 0,
          Number(row.count) || 0,
          Number(row.pendingAmount) || 0,
          Number(row.completedAmount) || 0
        ])
      ];
      const worksheet = window.XLSX.utils.aoa_to_sheet(data);
      const workbook = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(workbook, worksheet, '주정산출금');
      window.XLSX.writeFile(workbook, filename);
      showToast(`엑셀 저장: ${filename}`);
    } catch (error) {
      console.error('[week withdrawal excel]', error);
      showToast(error.message || '엑셀 내보내기에 실패했습니다.');
    }
  }

  function exportWithdrawalExcel() {
    const rows = Array.isArray(state.withdrawalRows) ? state.withdrawalRows : [];
    if (!rows.length) {
      showToast('내보낼 출금신청이 없습니다.');
      return;
    }
    try {
      const date = ensureWithdrawalDateDefault() || new Date().toISOString().slice(0, 10);
      const stamp = date.replace(/-/g, '');
      const filename = `BREM_출금신청자_${stamp}.xlsx`;
      roster.exportWithdrawalRowsToExcel(rows, filename, '출금신청자');
      showToast(`엑셀 저장: ${filename}`);
    } catch (error) {
      console.error('[withdrawal excel]', error);
      showToast(error.message || '엑셀 내보내기에 실패했습니다.');
    }
  }

  async function cancelWithdrawalRequest(id) {
    if (!id) return;
    if (!window.confirm('이 출금신청을 취소할까요? 기사 출금가능금액이 복구됩니다.')) return;
    try {
      const result = await BremStorage.payrollWithdrawal.cancelRequest(id);
      showToast(result.message || '출금신청을 취소했습니다.');
      await renderWithdrawalRequests();
    } catch (error) {
      console.error('[withdrawal cancel]', error);
      showToast(error.message || '취소에 실패했습니다.');
    }
  }

  async function completeWithdrawalRequest(id) {
    if (!id) return;
    if (!window.confirm('출금완료 처리할까요? 기사 앱에 처리완료로 표시됩니다.')) return;
    try {
      const result = await BremStorage.payrollWithdrawal.completeRequest(id);
      showToast(result.message || '출금완료 처리했습니다.');
      await renderWithdrawalRequests();
    } catch (error) {
      console.error('[withdrawal complete]', error);
      showToast(error.message || '출금완료 처리에 실패했습니다.');
    }
  }

  async function deleteWithdrawalRequest(id) {
    if (!id) return;
    if (!window.confirm('이 출금신청을 삭제할까요? 신청 중이면 출금가능금액이 복구됩니다.')) return;
    try {
      const result = await BremStorage.payrollWithdrawal.deleteRequest(id);
      showToast(result.message || '출금신청을 삭제했습니다.');
      await renderWithdrawalRequests();
    } catch (error) {
      console.error('[withdrawal delete]', error);
      showToast(error.message || '삭제에 실패했습니다.');
    }
  }

  function getRegions() {
    return roster.readRegions?.() || [];
  }

  function getRegionOptions() {
    return roster.readRegionOptions?.() || getRegions();
  }

  function regionSelectOptions(currentValue, { includeUnset = true, includeEmptyOption = false } = {}) {
    const current = String(currentValue || '').trim();
    const options = getRegionOptions();
    const parts = [];
    if (includeEmptyOption) {
      parts.push('<option value="">미지정</option>');
    }
    options.forEach(region => {
      const selected = region === current ? ' selected' : '';
      parts.push(`<option value="${escapeHtml(region)}"${selected}>${escapeHtml(region)}</option>`);
    });
    if (current && !options.includes(current)) {
      parts.push(`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (기존)</option>`);
    }
    if (includeUnset && !includeEmptyOption) {
      /* roster filter uses separate picker */
    }
    return parts.join('');
  }

  function syncRegionSelects() {
    const regions = getRegionOptions();
    const enrollSelect = $('payrollDailySettlementEnrollRegion');
    const bulkSelect = $('payrollDailySettlementBulkRegion');
    const picker = $('payrollDailySettlementRegionPicker');
    const platformRoster = readRosterForPlatform();

    if (enrollSelect) {
      const prev = enrollSelect.value;
      enrollSelect.innerHTML = `<option value="">미지정</option>${regions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}`;
      if (prev && [...enrollSelect.options].some(opt => opt.value === prev)) enrollSelect.value = prev;
    }

    if (bulkSelect) {
      const prev = bulkSelect.value || state.rosterRegionFilter;
      const counts = countRidersByRegion();
      const allCount = platformRoster.length;
      const regionRows = getRegions().map(region => {
        const count = counts.get(region) || 0;
        return `<option value="${escapeHtml(region)}">${escapeHtml(region)} (${count}명)</option>`;
      }).join('');
      const unsetCount = counts.get('__unset__') || 0;
      bulkSelect.innerHTML = [
        `<option value="">전체 (${allCount}명)</option>`,
        `<option value="__unset__">미지정 (${unsetCount}명)</option>`,
        regionRows
      ].join('');
      if (prev !== undefined && [...bulkSelect.options].some(opt => opt.value === prev)) {
        bulkSelect.value = prev;
      } else {
        bulkSelect.value = state.rosterRegionFilter || '';
      }
    }

    if (picker) {
      const prev = picker.value || state.settleRegion;
      const counts = countRidersByRegion();
      const regionRows = getRegions().map(region => {
        const count = counts.get(region) || 0;
        return `<option value="${escapeHtml(region)}">${escapeHtml(region)} (${count}명)</option>`;
      }).join('');
      const unsetCount = counts.get('__unset__') || 0;
      const allCount = platformRoster.length;
      picker.innerHTML = [
        '<option value="">지역 선택</option>',
        `<option value="__all__">전체 (${allCount}명)</option>`,
        `<option value="__unset__">미지정 (${unsetCount}명)</option>`,
        regionRows
      ].join('');
      if (prev && [...picker.options].some(opt => opt.value === prev)) picker.value = prev;
    }
  }

  function countRidersByRegion() {
    const counts = new Map();
    readRosterForPlatform().forEach(item => {
      const key = String(item.region || '').trim() || '__unset__';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function filterDrivers(list) {
    const keyword = String(state.driverSearchKeyword || '').trim().toLowerCase();
    if (!keyword) return list;
    return list.filter(driver => {
      const haystack = [
        driver.name,
        driver.baeminId,
        driver.coupangId,
        driver.coupangLoginKey,
        driver.phone,
        driver.employeeNo
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  function filterRoster(list) {
    let filtered = readRosterForPlatform(list);
    const regionFilter = String(state.rosterRegionFilter || '').trim();
    if (regionFilter === '__unset__') {
      filtered = filtered.filter(item => !String(item.region || '').trim());
    } else if (regionFilter) {
      filtered = filtered.filter(item => String(item.region || '').trim() === regionFilter);
    }

    const keyword = String(state.rosterSearchKeyword || '').trim().toLowerCase();
    if (!keyword) return filtered;
    return filtered.filter(item => {
      const haystack = [
        item.driverName,
        item.baeminId,
        item.coupangId,
        item.phone,
        item.region
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  function updateSelectedHint() {
    const hint = $('payrollDailySettlementSelectedHint');
    const count = state.selectedIds.size;
    if (hint) hint.textContent = `선택 ${count}명`;
    const selectAll = $('payrollDailySettlementSelectAll');
    const visible = filterRoster(roster.readAll());
    if (selectAll && visible.length) {
      selectAll.checked = visible.every(item => state.selectedIds.has(item.id));
      selectAll.indeterminate = !selectAll.checked && visible.some(item => state.selectedIds.has(item.id));
    } else if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }
  }

  function renderRegionTags() {
    const wrap = $('payrollDailySettlementRegionTags');
    if (!wrap) return;
    const regions = getRegions();
    if (!regions.length) {
      wrap.innerHTML = '<p class="form-help">등록된 지역이 없습니다. 위에서 지역을 추가하세요.</p>';
      return;
    }
    wrap.innerHTML = regions.map(region => {
      const count = readRosterForPlatform().filter(item => String(item.region || '').trim() === region).length;
      return `
        <span class="payroll-daily-region-tag">
          <span>${escapeHtml(region)} <em>(${count}명)</em></span>
          <button type="button" class="payroll-daily-region-tag-remove" data-pds-remove-region="${escapeHtml(region)}" title="지역 삭제">×</button>
        </span>
      `;
    }).join('');
  }

  function renderRegionQuickPick() {
    const wrap = $('payrollDailySettlementRegionQuickPick');
    if (!wrap) return;
    const counts = countRidersByRegion();
    const chips = getRegions().map(region => {
      const active = state.settleRegion === region ? ' is-active' : '';
      const count = counts.get(region) || 0;
      return `<button type="button" class="payroll-daily-region-chip${active}" data-pds-pick-region="${escapeHtml(region)}">${escapeHtml(region)} <span>${count}</span></button>`;
    }).join('');
    const unsetCount = counts.get('__unset__') || 0;
    const allActive = state.settleRegion === '__all__' ? ' is-active' : '';
    const unsetActive = state.settleRegion === '__unset__' ? ' is-active' : '';
    wrap.innerHTML = [
      `<button type="button" class="payroll-daily-region-chip${allActive}" data-pds-pick-region="__all__">전체 <span>${readRosterForPlatform().length}</span></button>`,
      `<button type="button" class="payroll-daily-region-chip${unsetActive}" data-pds-pick-region="__unset__">미지정 <span>${unsetCount}</span></button>`,
      chips
    ].join('');
  }

  function regionLabel(value) {
    if (value === '__all__') return '전체';
    if (value === '__unset__') return '미지정';
    return String(value || '').trim() || '미지정';
  }

  function normalizePlatforms(item) {
    return roster.normalizePlatforms?.(item) || { platformBaemin: true, platformCoupang: true };
  }

  function platformLabel(item) {
    return roster.platformLabel?.(item) || '-';
  }

  function renderPlatformChecks(item, idAttr) {
    const platforms = normalizePlatforms(item);
    const id = escapeHtml(idAttr);
    return `
      <div class="payroll-daily-platform-cell">
        <label class="payroll-daily-platform-pill">
          <input type="checkbox" data-pds-platform-baemin="${id}" ${platforms.platformBaemin ? 'checked' : ''}>
          <span>배민</span>
        </label>
        <label class="payroll-daily-platform-pill">
          <input type="checkbox" data-pds-platform-coupang="${id}" ${platforms.platformCoupang ? 'checked' : ''}>
          <span>쿠팡</span>
        </label>
      </div>
    `;
  }

  function readEnrollPlatforms() {
    const baemin = $('payrollDailySettlementEnrollBaemin')?.checked !== false;
    const coupang = $('payrollDailySettlementEnrollCoupang')?.checked !== false;
    if (!baemin && !coupang) {
      return { ok: false, error: '배민 또는 쿠팡 중 하나는 선택해야 합니다.' };
    }
    return { ok: true, platformBaemin: baemin, platformCoupang: coupang };
  }


  function stampExportFilename(prefix) {
    const date = new Date().toISOString().slice(0, 10);
    return `BREM_급여일정산_${prefix}_${date}.xlsx`;
  }

  function exportRows(rows, filename, sheetName) {
    try {
      roster.exportRowsToExcel(rows, filename, sheetName);
      showToast(`엑셀 저장: ${filename}`);
    } catch (error) {
      console.error('[daily settlement export]', error);
      showToast(error.message || '엑셀 내보내기에 실패했습니다.');
    }
  }

  function renderRegionSettleView() {
    syncRegionSelects();
    renderRegionQuickPick();
    renderRegionTags();

    const region = state.settleRegion;
    const summary = $('payrollDailySettlementRegionSummary');
    const detailBtn = $('payrollDailySettlementRegionDetailBtn');
    const exportBtn = $('payrollDailySettlementExportRegionBtn');
    const detailWrap = $('payrollDailySettlementRegionDetail');
    const detailTitle = $('payrollDailySettlementRegionDetailTitle');
    const detailCount = $('payrollDailySettlementRegionDetailCount');
    const detailBody = $('payrollDailySettlementRegionDetailBody');

    if (!region) {
      if (summary) summary.textContent = '지역을 선택하면 해당 기사 목록을 확인할 수 있습니다.';
      if (detailBtn) detailBtn.hidden = true;
      if (exportBtn) exportBtn.hidden = true;
      if (detailWrap) detailWrap.hidden = true;
      return;
    }

    const riders = readRosterForPlatform(roster.getByRegion?.(region) || []);
    const label = regionLabel(region);
    if (summary) summary.textContent = `${label} · ${riders.length}명 · 상세보기에서 전체 명단 확인`;
    if (detailBtn) {
      detailBtn.hidden = false;
      detailBtn.textContent = state.regionDetailOpen ? '상세 접기' : '상세보기';
    }
    if (exportBtn) exportBtn.hidden = false;

    if (detailTitle) detailTitle.textContent = `${label} 일정산 기사`;
    if (detailCount) detailCount.textContent = `총 ${riders.length}명`;

    if (detailBody) {
      if (!riders.length) {
        detailBody.innerHTML = '<tr><td colspan="7" class="empty">해당 지역에 등록된 기사가 없습니다.</td></tr>';
      } else {
        detailBody.innerHTML = riders.map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td><strong>${escapeHtml(item.driverName || '-')}</strong></td>
            <td>${escapeHtml(item.baeminId || '-')}</td>
            <td>${escapeHtml(item.coupangId || '-')}</td>
            <td>${escapeHtml(item.phone || '-')}</td>
            <td>${escapeHtml(platformLabel(item))}</td>
            <td>${escapeHtml(item.region || '미지정')}</td>
          </tr>
        `).join('');
      }
    }

    if (detailWrap) detailWrap.hidden = !state.regionDetailOpen;
  }

  function renderDriverPicker() {
    const body = $('payrollDailySettlementDriverBody');
    if (!body) return;

    const enrolled = roster.getEnrolledDriverIdSet();
    const drivers = filterDrivers(getDrivers()).slice(0, 500);

    if (!drivers.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">검색된 라이더가 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = drivers.map(driver => {
      const isEnrolled = enrolled.has(driver.id);
      const baeminId = resolveBaeminId(driver);
      const coupangId = resolveCoupangId(driver);
      return `
        <tr class="${isEnrolled ? 'is-enrolled' : ''}">
          <td>${escapeHtml(driver.name || '-')}</td>
          <td>${escapeHtml(baeminId || '-')}</td>
          <td>${escapeHtml(coupangId || '-')}</td>
          <td>${escapeHtml(driver.phone || '-')}</td>
          <td class="${isEnrolled ? 'text-success' : 'text-muted'}">${isEnrolled ? '등록됨' : '미등록'}</td>
          <td>
            ${isEnrolled
              ? `<button type="button" class="small-btn" data-pds-unenroll-driver="${escapeHtml(driver.id)}">해제</button>`
              : `<button type="button" class="primary-btn small-btn" data-pds-enroll-driver="${escapeHtml(driver.id)}">등록</button>`}
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderRoster() {
    const body = $('payrollDailySettlementBody');
    const countEl = $('payrollDailySettlementCount');
    if (!body) return;

    const all = readRosterForPlatform();
    const list = filterRoster(roster.readAll());
    if (countEl) countEl.textContent = `${platformLabelKo()} ${all.length}명 등록 · 표시 ${list.length}명`;

    if (!list.length) {
      let emptyMessage = '일정산 등록 기사가 없습니다. 라이더 검색에서 등록하거나 일괄등록을 사용하세요.';
      if (all.length) {
        const regionFilter = String(state.rosterRegionFilter || '').trim();
        if (regionFilter) {
          emptyMessage = `${regionLabel(regionFilter)} 지역에 등록된 기사가 없습니다.`;
        } else if (state.rosterSearchKeyword) {
          emptyMessage = '검색 결과가 없습니다.';
        } else {
          emptyMessage = '표시할 기사가 없습니다.';
        }
      } else if (roster.readAll().length) {
        emptyMessage = `${platformLabelKo()} 플랫폼으로 등록된 기사가 없습니다.`;
      }
      body.innerHTML = `<tr><td colspan="9" class="empty">${emptyMessage}</td></tr>`;
      updateSelectedHint();
      renderDriverPicker();
      renderRegionSettleView();
      return;
    }

    body.innerHTML = list.map(item => `
      <tr class="${state.selectedIds.has(item.id) ? 'is-selected' : ''}">
        <td><input type="checkbox" data-pds-select="${escapeHtml(item.id)}" ${state.selectedIds.has(item.id) ? 'checked' : ''}></td>
        <td>${escapeHtml(item.driverName || '-')}</td>
        <td>${escapeHtml(item.baeminId || '-')}</td>
        <td>${escapeHtml(item.coupangId || '-')}</td>
        <td>${escapeHtml(item.phone || '-')}</td>
        <td>${renderPlatformChecks(item, item.id)}</td>
        <td>
          <select class="payroll-region-select" data-pds-region-select="${escapeHtml(item.id)}">
            ${regionSelectOptions(item.region, { includeEmptyOption: true })}
          </select>
        </td>
        <td>${escapeHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleString('ko-KR') : '-')}</td>
        <td>
          <button type="button" class="small-btn" data-pds-unenroll-roster="${escapeHtml(item.driverId)}" title="일정산 해제">해제</button>
          <button type="button" class="small-btn danger-btn" data-pds-delete="${escapeHtml(item.id)}">삭제</button>
        </td>
      </tr>
    `).join('');

    updateSelectedHint();
    renderDriverPicker();
    renderRegionSettleView();
  }

  function renderBulkPreview(rows) {
    const wrap = $('payrollDailySettlementBulkPreview');
    const body = $('payrollDailySettlementBulkBody');
    if (!wrap || !body) return;
    wrap.hidden = !rows.length;
    if (!rows.length) {
      body.innerHTML = '';
      return;
    }
    body.innerHTML = rows.map(row => `
      <tr>
        <td>${row.rowNumber}</td>
        <td>${escapeHtml(row.baeminId || '-')}</td>
        <td>${escapeHtml(row.coupangId || '-')}</td>
        <td>${escapeHtml(row.phone || '-')}</td>
        <td>${escapeHtml(row.region || '-')}</td>
        <td>${escapeHtml(row.driverName || '-')}</td>
        <td class="${row.matchStatus === 'matched' ? 'text-success' : 'text-danger'}">${escapeHtml(row.matchStatus === 'matched' ? '매칭' : row.error || '미매칭')}</td>
      </tr>
    `).join('');
  }

  function refreshPayrollMatches() {
    window.BremAdminPayrollSlips?.refreshParsedMatches?.();
  }

  function refreshAll() {
    syncPlatformTabs();
    syncSubTabs();
    syncRegionSelects();
    renderRegionTags();
    renderPayoutTable();
    renderRoster();
    if (state.subTab === 'withdrawals') {
      void renderWithdrawalRequests();
    }
    if (state.subTab === 'week-withdrawals') {
      void renderWeekWithdrawals();
    }
  }

  async function handleBulkFile(event) {
    const file = event.target.files?.[0];
    if (!file || !window.XLSX) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = window.XLSX.read(reader.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const parsed = roster.parseBulkRows(rows, getDrivers());
        state.bulkPreview = parsed.rows;
        renderBulkPreview(parsed.rows);
        const matched = parsed.rows.filter(row => row.matchStatus === 'matched').length;
        showToast(`일괄등록 미리보기 ${matched}/${parsed.rows.length}건 매칭`);
      } catch (error) {
        console.error('[daily settlement bulk]', error);
        showToast('일괄등록 파일을 읽지 못했습니다.');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function applyBulkPreview() {
    if (!state.bulkPreview.length) {
      showToast('적용할 일괄등록 데이터가 없습니다.');
      return;
    }
    void (async () => {
      try {
        const result = roster.upsertFromBulk(state.bulkPreview);
        await roster.applyBulkPersist(result);
        state.bulkPreview = [];
        renderBulkPreview([]);
        refreshAll();
        refreshPayrollMatches();
        showToast(`일정산 ${result.added}명 추가 · Supabase 저장 · 총 ${roster.readAll().length}명`);
      } catch (error) {
        console.error('[daily settlement bulk apply]', error);
        showToast(error.message || '일괄등록 저장에 실패했습니다.');
      }
    })();
  }

  function enrollDriverById(driverId) {
    const driver = getDrivers().find(item => item.id === driverId);
    if (!driver) {
      showToast('기사를 찾을 수 없습니다.');
      return;
    }
    const region = String($('payrollDailySettlementEnrollRegion')?.value || '').trim();
    const platforms = readEnrollPlatforms();
    if (!platforms.ok) {
      showToast(platforms.error);
      return;
    }
    void (async () => {
      try {
        await roster.commitEnrollDriver(driver, {
          region,
          platformBaemin: platforms.platformBaemin,
          platformCoupang: platforms.platformCoupang
        });
        refreshAll();
        refreshPayrollMatches();
        showToast(`${driver.name || '기사'} 일정산 등록 · ${platformLabel(platforms)}${region ? ` · ${region}` : ''}`);
      } catch (error) {
        console.error('[daily settlement enroll]', error);
        showToast(error.message || '등록 저장에 실패했습니다.');
      }
    })();
  }

  function unenrollDriverById(driverId) {
    const id = String(driverId || '').trim();
    if (!id) return;
    void (async () => {
      try {
        await roster.commitUnenrollByDriverId(id);
        state.selectedIds.forEach(selId => {
          const row = roster.readAll().find(item => item.id === selId);
          if (!row) state.selectedIds.delete(selId);
        });
        refreshAll();
        refreshPayrollMatches();
        showToast('일정산 등록 해제 · Supabase 저장');
      } catch (error) {
        console.error('[daily settlement unenroll]', error);
        showToast(error.message || '해제 저장에 실패했습니다.');
      }
    })();
  }

  function deleteSelected() {
    if (!state.selectedIds.size) {
      showToast('삭제할 항목을 선택하세요.');
      return;
    }
    if (!window.confirm(`선택한 ${state.selectedIds.size}명을 일정산 목록에서 삭제할까요?`)) return;
    void (async () => {
      try {
        await roster.commitRemoveByIds([...state.selectedIds]);
        state.selectedIds.clear();
        refreshAll();
        refreshPayrollMatches();
        showToast('선택 항목 삭제 · Supabase 저장');
      } catch (error) {
        console.error('[daily settlement delete selected]', error);
        showToast(error.message || '삭제 저장에 실패했습니다.');
      }
    })();
  }

  function readRosterRowEdits() {
    const body = $('payrollDailySettlementBody');
    if (!body) return [];
    const edits = [];
    body.querySelectorAll('tr').forEach(row => {
      const id = row.querySelector('[data-pds-platform-baemin]')?.dataset.pdsPlatformBaemin
        || row.querySelector('[data-pds-region-select]')?.dataset.pdsRegionSelect
        || row.querySelector('[data-pds-select]')?.dataset.pdsSelect;
      if (!id) return;
      edits.push({
        id,
        platformBaemin: row.querySelector('[data-pds-platform-baemin]')?.checked === true,
        platformCoupang: row.querySelector('[data-pds-platform-coupang]')?.checked === true,
        region: String(row.querySelector('[data-pds-region-select]')?.value || '').trim()
      });
    });
    return edits;
  }

  function applyRosterChanges() {
    const rawRegion = String($('payrollDailySettlementBulkRegion')?.value || '').trim();
    const rowEdits = readRosterRowEdits();
    const selected = new Set(state.selectedIds);
    const wantsBulkRegion = selected.size > 0 && Boolean(rawRegion);

    if (!rowEdits.length && !wantsBulkRegion) {
      showToast('변경할 내용이 없습니다.');
      return;
    }

    for (const edit of rowEdits) {
      if (!edit.platformBaemin && !edit.platformCoupang) {
        showToast('배민 또는 쿠팡 중 하나는 선택해야 합니다.');
        return;
      }
    }

    const bulkRegion = rawRegion === '__unset__' ? '' : rawRegion;

    void (async () => {
      try {
        const editMap = new Map(rowEdits.map(edit => [edit.id, edit]));
        let platformCount = 0;
        let rowRegionCount = 0;
        let bulkRegionCount = 0;

        const list = roster.readAll().map(item => {
          let next = item;
          const edit = editMap.get(item.id);
          const currentRegion = String(item.region || '').trim();
          const currentPlatforms = normalizePlatforms(item);

          if (edit) {
            const platformChanged = edit.platformBaemin !== currentPlatforms.platformBaemin
              || edit.platformCoupang !== currentPlatforms.platformCoupang;
            const regionChanged = edit.region !== currentRegion;
            if (platformChanged || regionChanged) {
              next = {
                ...next,
                platformBaemin: edit.platformBaemin,
                platformCoupang: edit.platformCoupang,
                region: edit.region,
                updatedAt: new Date().toISOString()
              };
              if (platformChanged) platformCount += 1;
              if (regionChanged) rowRegionCount += 1;
            }
          }

          if (wantsBulkRegion && selected.has(item.id) && String(next.region || '').trim() !== bulkRegion) {
            next = {
              ...next,
              region: bulkRegion,
              updatedAt: new Date().toISOString()
            };
            bulkRegionCount += 1;
          }

          return next;
        });

        await roster.commitSaveAll(list);
        refreshAll();

        const parts = [];
        if (platformCount) parts.push(`플랫폼 ${platformCount}명`);
        if (bulkRegionCount) parts.push(`선택 ${bulkRegionCount}명 → ${regionLabel(rawRegion)}`);
        else if (rowRegionCount) parts.push(`지역 ${rowRegionCount}명`);
        showToast(parts.length ? `${parts.join(' · ')} 저장 · Supabase` : '변경된 내용이 없습니다.');
      } catch (error) {
        console.error('[daily settlement apply roster]', error);
        showToast(error.message || '저장에 실패했습니다.');
      }
    })();
  }

  function addRegionFromInput() {
    const input = $('payrollDailySettlementRegionNew');
    const name = String(input?.value || '').trim();
    if (!name) {
      showToast('지역 이름을 입력하세요.');
      return;
    }
    void (async () => {
      try {
        await roster.addRegion(name);
        if (input) input.value = '';
        refreshAll();
        showToast(`지역 "${name}" 추가 · Supabase 저장`);
      } catch (error) {
        console.error('[daily settlement add region]', error);
        showToast(error.message || '지역 추가에 실패했습니다.');
      }
    })();
  }

  function removeRegion(name) {
    const text = String(name || '').trim();
    if (!text) return;
    if (!window.confirm(`"${text}" 지역을 삭제할까요?\n해당 지역 기사는 미지정으로 바뀝니다.`)) return;
    void (async () => {
      try {
        await roster.removeRegion(text);
        if (state.settleRegion === text) {
          state.settleRegion = '';
          state.regionDetailOpen = false;
        }
        refreshAll();
        showToast(`지역 "${text}" 삭제 · Supabase 저장`);
      } catch (error) {
        console.error('[daily settlement remove region]', error);
        showToast(error.message || '지역 삭제에 실패했습니다.');
      }
    })();
  }

  function pickSettleRegion(region) {
    state.settleRegion = String(region || '').trim();
    state.regionDetailOpen = Boolean(state.settleRegion);
    const picker = $('payrollDailySettlementRegionPicker');
    if (picker && state.settleRegion) picker.value = state.settleRegion;
    renderRegionSettleView();
  }

  function exportAllRoster() {
    exportRows(readRosterForPlatform(), stampExportFilename(`전체_${platformLabelKo()}`), '전체');
  }

  function exportSelectedRoster() {
    if (!state.selectedIds.size) {
      showToast('내보낼 기사를 선택하세요.');
      return;
    }
    const selected = new Set(state.selectedIds);
    const rows = readRosterForPlatform().filter(item => selected.has(item.id));
    exportRows(rows, stampExportFilename(`선택${rows.length}명_${platformLabelKo()}`), '선택');
  }

  function exportCurrentRegion() {
    if (!state.settleRegion) {
      showToast('지역을 먼저 선택하세요.');
      return;
    }
    const rows = readRosterForPlatform(roster.getByRegion?.(state.settleRegion) || []);
    if (!rows.length) {
      showToast('내보낼 기사가 없습니다.');
      return;
    }
    const label = regionLabel(state.settleRegion).replace(/[\\/:*?"<>|]/g, '_');
    exportRows(rows, stampExportFilename(`${label}_${platformLabelKo()}`), label);
  }

  function downloadTemplate() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const rows = roster.templateRows();
    const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, '일정산일괄등록');
    window.XLSX.writeFile(workbook, 'BREM_급여일정산_일괄등록_양식.xlsx');
  }

  function bindEvents() {
    $('payrollDailySettlementBulkFile')?.addEventListener('change', handleBulkFile);
    $('payrollDailySettlementBulkApplyBtn')?.addEventListener('click', applyBulkPreview);
    $('payrollDailySettlementBulkTemplateBtn')?.addEventListener('click', downloadTemplate);
    $('payrollDailySettlementDeleteSelectedBtn')?.addEventListener('click', deleteSelected);
    $('payrollDailySettlementApplyBulkRegionBtn')?.addEventListener('click', applyRosterChanges);
    $('payrollDailySettlementExportAllBtn')?.addEventListener('click', exportAllRoster);
    $('payrollDailySettlementExportSelectedBtn')?.addEventListener('click', exportSelectedRoster);
    $('payrollDailySettlementExportRegionBtn')?.addEventListener('click', exportCurrentRegion);
    $('payrollDailySettlementRegionAddBtn')?.addEventListener('click', addRegionFromInput);
    $('payrollDailySettlementFeeSaveBtn')?.addEventListener('click', () => { void saveFeesFromInputs(); });
    $('payrollDailySettlementCallFeeVisibleBtn')?.addEventListener('click', () => {
      void toggleCallFeeVisibility();
    });
    $('payrollDailySettlementDailyFeeMode')?.addEventListener('change', event => {
      syncDailyFeeModeUi(event.target.value);
    });
    $('payrollDailySettlementPayoutExcelBtn')?.addEventListener('click', exportPayoutExcel);
    $('payrollDailySettlementPayoutRefreshBtn')?.addEventListener('click', () => {
      ensurePayoutDateDefault();
      renderPayoutTable();
    });
    $('payrollDailySettlementPayoutDate')?.addEventListener('change', event => {
      state.payoutDate = String(event.target.value || '').slice(0, 10);
      renderPayoutTable();
    });
    $('payrollDailyWithdrawalRefreshBtn')?.addEventListener('click', () => {
      void renderWithdrawalRequests();
    });
    $('payrollDailyWithdrawalExcelBtn')?.addEventListener('click', exportWithdrawalExcel);
    $('payrollDailyWithdrawalDate')?.addEventListener('change', () => {
      void renderWithdrawalRequests();
    });
    $('payrollDailyWithdrawalStatusFilter')?.addEventListener('change', () => {
      void renderWithdrawalRequests();
    });
    $('payrollDailyWeekWithdrawalRefreshBtn')?.addEventListener('click', () => {
      void renderWeekWithdrawals();
    });
    $('payrollDailyWeekWithdrawalExcelBtn')?.addEventListener('click', exportWeekWithdrawalExcel);
    $('payrollDailyWeekWithdrawalWeekStart')?.addEventListener('change', () => {
      ensureWeekWithdrawalDefault();
      void renderWeekWithdrawals();
    });
    $('payrollDailyWeekWithdrawalPrevBtn')?.addEventListener('click', () => shiftWeekWithdrawal(-1));
    $('payrollDailyWeekWithdrawalNextBtn')?.addEventListener('click', () => shiftWeekWithdrawal(1));
    $('payrollDailyWithdrawalBody')?.addEventListener('click', event => {
      const completeBtn = event.target.closest('[data-pds-wd-complete]');
      if (completeBtn) {
        void completeWithdrawalRequest(completeBtn.dataset.pdsWdComplete);
        return;
      }
      const cancelBtn = event.target.closest('[data-pds-wd-cancel]');
      if (cancelBtn) {
        void cancelWithdrawalRequest(cancelBtn.dataset.pdsWdCancel);
        return;
      }
      const deleteBtn = event.target.closest('[data-pds-wd-delete]');
      if (deleteBtn) void deleteWithdrawalRequest(deleteBtn.dataset.pdsWdDelete);
    });
    $('payrollDailySettlementRegionNew')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addRegionFromInput();
      }
    });

    document.querySelectorAll('[data-pds-platform-tab]').forEach(button => {
      button.addEventListener('click', () => setPlatform(button.dataset.pdsPlatformTab));
    });
    document.querySelectorAll('[data-pds-sub-tab]').forEach(button => {
      button.addEventListener('click', () => setSubTab(button.dataset.pdsSubTab));
    });

    $('payrollDailySettlementDriverSearch')?.addEventListener('input', event => {
      state.driverSearchKeyword = String(event.target.value || '').trim();
      renderDriverPicker();
    });

    $('payrollDailySettlementRosterSearch')?.addEventListener('input', event => {
      state.rosterSearchKeyword = String(event.target.value || '').trim();
      renderRoster();
    });

    $('payrollDailySettlementBulkRegion')?.addEventListener('change', event => {
      state.rosterRegionFilter = String(event.target.value || '').trim();
      renderRoster();
    });

    $('payrollDailySettlementSelectAll')?.addEventListener('change', event => {
      const checked = event.target.checked;
      filterRoster(roster.readAll()).forEach(item => {
        if (checked) state.selectedIds.add(item.id);
        else state.selectedIds.delete(item.id);
      });
      renderRoster();
    });

    $('payrollDailySettlementRegionPicker')?.addEventListener('change', event => {
      pickSettleRegion(event.target.value);
    });

    $('payrollDailySettlementRegionDetailBtn')?.addEventListener('click', () => {
      if (!state.settleRegion) return;
      state.regionDetailOpen = !state.regionDetailOpen;
      renderRegionSettleView();
    });

    $('payrollDailySettlementRegionTags')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-pds-remove-region]');
      if (!btn) return;
      removeRegion(btn.dataset.pdsRemoveRegion);
    });

    $('payrollDailySettlementRegionQuickPick')?.addEventListener('click', event => {
      const btn = event.target.closest('[data-pds-pick-region]');
      if (!btn) return;
      pickSettleRegion(btn.dataset.pdsPickRegion);
    });

    $('payrollDailySettlementDriverBody')?.addEventListener('click', event => {
      const enrollBtn = event.target.closest('[data-pds-enroll-driver]');
      if (enrollBtn) {
        enrollDriverById(enrollBtn.dataset.pdsEnrollDriver);
        return;
      }
      const unenrollBtn = event.target.closest('[data-pds-unenroll-driver]');
      if (unenrollBtn) unenrollDriverById(unenrollBtn.dataset.pdsUnenrollDriver);
    });

    $('payrollDailySettlementBody')?.addEventListener('change', event => {
      const checkbox = event.target.closest('[data-pds-select]');
      if (checkbox) {
        const id = checkbox.dataset.pdsSelect;
        if (checkbox.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateSelectedHint();
        checkbox.closest('tr')?.classList.toggle('is-selected', checkbox.checked);
        return;
      }
      const regionSelect = event.target.closest('[data-pds-region-select]');
      if (regionSelect) return;
      if (event.target.matches('[data-pds-platform-baemin], [data-pds-platform-coupang]')) return;
    });

    $('payrollDailySettlementBody')?.addEventListener('click', event => {
      const unenrollBtn = event.target.closest('[data-pds-unenroll-roster]');
      if (unenrollBtn) {
        unenrollDriverById(unenrollBtn.dataset.pdsUnenrollRoster);
        return;
      }
      const deleteBtn = event.target.closest('[data-pds-delete]');
      if (!deleteBtn) return;
      const id = deleteBtn.dataset.pdsDelete;
      void (async () => {
        try {
          await roster.commitRemoveByIds([id]);
          state.selectedIds.delete(id);
          refreshAll();
          refreshPayrollMatches();
          showToast('삭제 · Supabase 저장');
        } catch (error) {
          console.error('[daily settlement delete]', error);
          showToast(error.message || '삭제 저장에 실패했습니다.');
        }
      })();
    });
  }

  async function refreshAfterLoad() {
    try {
      await BremStorage?.ensureSectionLoaded?.('payroll-daily-settlement');
      await BremStorage?.payrollDailySettlement?.reloadFromServer?.();
    } catch (error) {
      console.warn('[payroll daily settlement]', error);
    }
    ensurePayoutDateDefault();
    refreshAll();
  }

  bindEvents();
  void refreshAfterLoad();

  window.BremAdminPayrollDailySettlement = {
    refresh: refreshAfterLoad,
    setPlatform,
    setSubTab,
    getEnrolledDriverIdSet: () => roster.getEnrolledDriverIdSet(),
    getRegionByDriverId: driverId => roster.getRegionByDriverId(driverId)
  };
})();

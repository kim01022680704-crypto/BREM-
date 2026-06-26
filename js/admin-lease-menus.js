/**
 * 리스 ERP — 9개 서브메뉴 (대시보드 · 차량 · 계약 · 자동계산 · 미납 · 공차 · 주간/월간 · 일괄)
 */
const BremAdminLeaseMenus = (function () {
  const erp = () => window.BremLeaseErp;
  const calc = () => window.BremLeaseRentalCalc;
  const profit = () => window.BremLeaseProfit;
  const $ = id => document.getElementById(id);

  const BULK_V3_COLUMNS = [
    { key: 'vehicleNumber', label: '차량번호', col: 'A' },
    { key: 'vehicleName', label: '차량명', col: 'B' },
    { key: 'modelType', label: '기종', col: 'C' },
    { key: 'driverName', label: '기사명', col: 'D' },
    { key: 'driverPhone', label: '연락처', col: 'E' },
    { key: 'startDate', label: '계약시작일', col: 'F' },
    { key: 'endDate', label: '계약종료일', col: 'G' },
    { key: 'weeklyRent', label: '라이더부담 리스렌탈료', col: 'H' },
    { key: 'paidAmount', label: '입금액', col: 'I' },
    { key: 'unpaidDays', label: '미납일수', col: 'J' },
    { key: 'emptyDays', label: '공차일수', col: 'K' },
    { key: 'insuranceCost', label: '보험료', col: 'L' },
    { key: 'leaseCost', label: '리스비', col: 'M' },
    { key: 'maintenanceCost', label: '정비비', col: 'N' },
    { key: 'accidentCost', label: '사고비', col: 'O' },
    { key: 'otherCost', label: '기타비용', col: 'P' },
    { key: 'penaltyFee', label: '위약금', col: 'Q' },
    { key: 'collectionMethod', label: '회수방법', col: 'R' },
    { key: 'collectionStatus', label: '처리상태', col: 'S' },
    { key: 'memo', label: '메모', col: 'T' }
  ];

  const state = {
    menu: 'dashboard',
    weekStart: '',
    monthKey: '',
    bulkRows: []
  };

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

  function formatMoney(value) {
    const num = Math.round(Number(value || 0));
    if (!num && num !== 0) return '-';
    return `${num.toLocaleString('ko-KR')}원`;
  }

  function moneyClass(value) {
    const num = Number(value || 0);
    if (num < 0) return 'lease-money--deficit';
    if (num > 0) return 'lease-money--profit';
    return '';
  }

  function formatDate(value) {
    if (!value) return '-';
    return BremDatePicker?.formatDate?.(value) || String(value).slice(0, 10);
  }

  function currentWeekStart() {
    return BremStorage?.adminPreferences?.getLeaseDashboardWeekBasis?.()
      || BremLeaseProfit?.weekStartKey?.()
      || calc()?.weekRange?.('')?.start
      || '';
  }

  function formatLeaseWeekRangeLabel(weekStart) {
    const start = String(weekStart || '').slice(0, 10);
    if (!start) return '수요일~화요일 기준';
    if (BremDatePicker?.formatWednesdayWeekRange) {
      return `${BremDatePicker.formatWednesdayWeekRange(start)} (수~화)`;
    }
    const week = calc()?.weekRange(start) || {};
    return week.start && week.end
      ? `${formatDate(week.start)} ~ ${formatDate(week.end)} (수~화)`
      : '수요일~화요일 기준';
  }

  function updateLeaseDashWeekUi() {
    const weekStart = currentWeekStart();
    if ($('leaseDashWeekBasis')) $('leaseDashWeekBasis').value = weekStart;
    if ($('leaseDashWeekLabel')) {
      $('leaseDashWeekLabel').textContent = `주간 순이익 · ${formatLeaseWeekRangeLabel(weekStart)}`;
    }
    if ($('leaseWeekStart') && !$('leaseWeekStart').value) $('leaseWeekStart').value = weekStart;
  }

  function sumProfitLogsForWeek(weekStart) {
    if (!erp() || !calc()) return null;
    const week = calc().weekRange(weekStart);
    if (!week.start) return null;
    const logs = erp().profitLogs().getAll().filter(item =>
      item.periodType === 'weekly' && item.periodStart === week.start
    );
    if (!logs.length) return null;
    return logs.reduce((sum, log) => sum + Number(log.netProfit || 0), 0);
  }

  function sumProfitLogsForMonth(monthKey) {
    if (!erp()) return null;
    const key = String(monthKey || '').slice(0, 7);
    if (!key) return null;
    const logs = erp().profitLogs().getAll().filter(item =>
      item.periodType === 'monthly' && String(item.periodStart || '').startsWith(key)
    );
    if (!logs.length) return null;
    return logs.reduce((sum, log) => sum + Number(log.netProfit || 0), 0);
  }

  function currentMonthKey() {
    return BremLeaseProfit?.monthKey?.() || new Date().toISOString().slice(0, 7);
  }

  function setMenu(menu) {
    state.menu = menu;
    document.querySelectorAll('[data-lease-menu]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.leaseMenu === menu);
    });
    document.querySelectorAll('[data-lease-menu-panel]').forEach(panel => {
      panel.hidden = panel.dataset.leaseMenuPanel !== menu;
    });
    if (menu === 'dashboard') renderDashboard();
    if (menu === 'weekly') renderWeekly();
    if (menu === 'monthly') renderMonthly();
    if (menu === 'arrears') renderArrears();
    if (menu === 'empty') renderEmpty();
    if (menu === 'bulk') renderBulkGuide();
    if (menu === 'contract') {
      fillVehicleSelect($('leaseContractVehicleId'));
      syncContractCalc();
      renderContractList();
    }
    if (menu === 'calc') {
      fillVehicleSelect($('leaseCalcVehicleId'));
      syncStandaloneCalc();
    }
  }

  function renderDashboard() {
    renderDashboardKpis();
    renderDashboardVehicleOverview();
  }

  function renderDashboardKpis() {
    if (!erp() || !profit()) return;
    erp().syncAllVehicleStatusesFromContracts?.();
    updateLeaseDashWeekUi();
    const weekStart = currentWeekStart();
    const monthKey = currentMonthKey();
    const vehicles = erp().vehicles().getAll();
    const kpis = erp.buildDashboardKpis({});
    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };
    let deficitCount = 0;
    const weekProfitFromLogs = sumProfitLogsForWeek(weekStart);
    const monthProfitFromLogs = sumProfitLogsForMonth(monthKey);
    let weekProfitFallback = 0;
    let monthProfitFallback = 0;
    let unpaidTotal = 0;
    let emptyLossTotal = 0;
    vehicles.forEach(item => {
      const m = profit().computeErpMetrics(item);
      if (m.actualProfit < 0) deficitCount += 1;
      const weeklyNet = m.weeklyProfit - m.unpaidAmount - m.emptyLoss;
      weekProfitFallback += weeklyNet;
      monthProfitFallback += weeklyNet * (30 / 7);
      unpaidTotal += m.unpaidAmount;
      emptyLossTotal += m.emptyLoss;
    });
    const statusCounts = countDashboardVehicleStatuses(vehicles);
    setText('leaseStatTotal', String(vehicles.length));
    setText('leaseKpiOperating', String(statusCounts.operating || kpis.counts.operating || 0));
    setText('leaseStatEmpty', String(statusCounts.empty));
    setText('leaseHeroUnpaid', formatMoney(unpaidTotal || kpis.totalUnpaid));
    setText('leaseHeroWeekProfit', formatMoney(weekProfitFromLogs ?? weekProfitFallback ?? kpis.weekly?.actualProfit ?? 0));
    setText('leaseKpiMonthProfit', formatMoney(monthProfitFromLogs ?? monthProfitFallback ?? kpis.monthly?.actualProfit ?? 0));
    setText('leaseHeroEmptyLoss', formatMoney(kpis.weekly?.emptyLossTotal ?? emptyLossTotal));
    setText('leaseDashDeficitCount', String(deficitCount));
  }

  function resolveVehicleUnpaidAmount(vehicleId, metrics) {
    let amount = Number(metrics?.unpaidAmount || 0);
    if (!erp() || !vehicleId) return amount;
    const completed = calc()?.ARREAR_STATUS?.COMPLETED || 'completed';
    const fromArrears = erp().arrears().getAll()
      .filter(item => item.vehicleId === vehicleId && String(item.collectionStatus) !== completed)
      .reduce((sum, item) => sum + Number(item.unpaidAmount || 0), 0);
    return Math.max(amount, fromArrears);
  }

  function resolveDashboardVehicleStatus(vehicle, contract) {
    if (!vehicle) return { code: 'empty', label: '공차' };
    if (hasOpenArrear(vehicle.id)) {
      return { code: 'unpaid', label: '미납' };
    }
    const unpaidDays = Math.max(0, Number(vehicle.unpaidDays || 0));
    const unpaidAmount = Number(vehicle.unpaidAmount || 0);
    if (unpaidDays > 0 || unpaidAmount > 0) {
      return { code: 'unpaid', label: '미납' };
    }
    const driver = String(contract?.driverName || vehicle.renter || '').trim();
    const ended = String(contract?.status || '') === (erp()?.CONTRACT_STATUS?.ENDED || 'ended');
    if (driver && !ended) {
      return { code: 'operating', label: '운행' };
    }
    return { code: 'empty', label: '공차' };
  }

  function countDashboardVehicleStatuses(vehicles = []) {
    return vehicles.reduce((counts, item) => {
      const contract = getLatestContractForVehicle(item.id);
      const code = resolveDashboardVehicleStatus(item, contract).code;
      if (code === 'operating') counts.operating += 1;
      else if (code === 'unpaid') counts.unpaid += 1;
      else counts.empty += 1;
      return counts;
    }, { operating: 0, empty: 0, unpaid: 0 });
  }

  function dashVehicleSourceLabel(vehicle) {
    const owned = profit()?.VEHICLE_CATEGORIES?.COMPANY_OWNED || 'company_owned';
    return String(vehicle?.vehicleCategory || '') === owned ? '브램리스' : '회사리스';
  }

  function dashStatusFromVehicle(vehicle) {
    if (!vehicle) return { code: 'empty', text: '공차' };
    if (hasOpenArrear(vehicle.id)) {
      const amount = Number(vehicle.unpaidAmount || 0);
      return { code: 'unpaid', text: amount > 0 ? `미납 ${formatMoney(amount)}` : '미납' };
    }
    const unpaidDays = Math.max(0, Number(vehicle.unpaidDays || 0));
    const unpaidAmount = Number(vehicle.unpaidAmount || 0);
    if (unpaidDays > 0 || unpaidAmount > 0) {
      return { code: 'unpaid', text: unpaidAmount > 0 ? `미납 ${formatMoney(unpaidAmount)}` : '미납' };
    }
    if (String(vehicle.vehicleStatus) === 'operating') {
      return { code: 'operating', text: '운행' };
    }
    return { code: 'empty', text: '공차' };
  }

  function paintDashboardVehicleOverview() {
    const rowsEl = $('leaseDashVehicleRows');
    if (!rowsEl || !erp()) return;
    const vehicles = erp().vehicles().getAll().slice().sort((a, b) =>
      String(a.vehicleNumber || '').localeCompare(String(b.vehicleNumber || ''), 'ko')
    );

    if (!vehicles.length) {
      rowsEl.innerHTML = '<tr><td colspan="5" class="empty">등록된 차량이 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = vehicles.map(item => {
      const status = dashStatusFromVehicle(item);
      const driver = String(item.renter || '').trim() || '-';
      const source = dashVehicleSourceLabel(item);
      return `
        <tr class="lease-dash-vehicle-row lease-dash-vehicle-row--${escapeHtml(status.code)}">
          <td><strong>${escapeHtml(item.vehicleNumber || '-')}</strong></td>
          <td>${escapeHtml(item.model || '-')}</td>
          <td>${escapeHtml(source)}</td>
          <td>${escapeHtml(driver)}</td>
          <td class="lease-dash-vehicle-table__status">
            <span class="lease-status-badge lease-status-badge--${escapeHtml(status.code)}">${escapeHtml(status.text)}</span>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderDashboardVehicleOverview() {
    const rowsEl = $('leaseDashVehicleRows');
    if (!rowsEl || !erp()) return;
    const run = () => {
      try {
        paintDashboardVehicleOverview();
      } catch (error) {
        console.error('[BremAdminLeaseMenus] renderDashboardVehicleOverview failed', error);
        rowsEl.innerHTML = '<tr><td colspan="5" class="empty">차량 현황을 불러오지 못했습니다.</td></tr>';
      }
    };
    const loadPromise = erp().ensureLoaded?.();
    if (loadPromise && typeof loadPromise.then === 'function') {
      void loadPromise.then(run).catch(error => {
        console.error('[BremAdminLeaseMenus] ensureLoaded failed', error);
        run();
      });
      return;
    }
    run();
  }

  function readCalcDraft() {
    const engine = calc();
    if (!engine) return {};
    const weeklyRent = engine.money($('leaseCalcWeeklyRent')?.value);
    const vehicle = erp()?.vehicles().getById($('leaseCalcVehicleId')?.value || '');
    let emptyDailyLoss = 0;
    if (vehicle) {
      const m = profit()?.computeErpMetrics?.(vehicle) || {};
      emptyDailyLoss = m.emptyDailyLoss || m.dailyCost || m.dailyLeaseCost || 0;
    }
    return {
      vehicleId: $('leaseCalcVehicleId')?.value || '',
      weeklyRent,
      dailyRent: engine.dailyFromWeekly(weeklyRent),
      rentalDays: $('leaseCalcRentalDays')?.value || 0,
      emptyDays: $('leaseCalcEmptyDays')?.value || 0,
      unpaidDays: $('leaseCalcUnpaidDays')?.value || 0,
      paidAmount: $('leaseCalcPaidAmount')?.value || 0,
      insuranceCost: $('leaseCalcInsurance')?.value || 0,
      leaseCost: $('leaseCalcLeaseCost')?.value || 0,
      maintenanceCost: $('leaseCalcMaintenance')?.value || 0,
      accidentCost: $('leaseCalcAccident')?.value || 0,
      otherCost: $('leaseCalcOtherCost')?.value || 0,
      penaltyFee: $('leaseCalcPenalty')?.value || 0,
      emptyDailyLoss
    };
  }

  function syncStandaloneCalc() {
    const engine = calc();
    if (!engine) return;
    const metrics = engine.compute(readCalcDraft());
    const setText = (id, value) => {
      const el = $(id);
      if (!el) return;
      el.textContent = formatMoney(value);
      el.className = `lease-calc-value ${moneyClass(value)}`;
    };
    setText('leaseCalcDailyRent', metrics.dailyRent);
    setText('leaseCalcWeeklyRentOut', metrics.weeklyRent);
    setText('leaseCalcRentalRevenue', metrics.rentalRevenue);
    setText('leaseCalcUnpaid', metrics.unpaidAmount);
    setText('leaseCalcEmptyLoss', metrics.emptyLoss);
    setText('leaseCalcTotalCost', metrics.totalCost);
    setText('leaseCalcExpected', metrics.expectedProfit);
    setText('leaseCalcActual', metrics.actualProfit);
    setText('leaseCalcNet', metrics.netProfit);
    const statusEl = $('leaseCalcStatus');
    if (statusEl) {
      statusEl.textContent = metrics.statusLabel;
      statusEl.className = `lease-calc-status ${metrics.isDeficit ? 'lease-calc-status--deficit' : 'lease-calc-status--profit'}`;
    }
  }

  function onCalcVehicleChange() {
    const vehicle = erp()?.vehicles().getById($('leaseCalcVehicleId')?.value || '');
    if (!vehicle) {
      syncStandaloneCalc();
      return;
    }
    const metrics = profit()?.computeErpMetrics?.(vehicle) || {};
    if ($('leaseCalcWeeklyRent')) {
      $('leaseCalcWeeklyRent').value = vehicle.dailyChargeAmount
        ? vehicle.dailyChargeAmount * 7
        : (vehicle.weeklyRent || '');
    }
    if ($('leaseCalcUnpaidDays')) $('leaseCalcUnpaidDays').value = vehicle.unpaidDays || '';
    if ($('leaseCalcLeaseCost')) $('leaseCalcLeaseCost').value = vehicle.dailyLeaseCost ? vehicle.dailyLeaseCost * 30 : '';
    const annualInsurance = Number(vehicle.annualInsuranceCost || 0)
      || (Number(vehicle.dailyInsuranceCost || 0) * 365);
    if ($('leaseCalcInsurance')) {
      $('leaseCalcInsurance').value = annualInsurance ? Math.round(annualInsurance / 12) : '';
    }
    if (vehicle.vehicleStatus === 'empty' && vehicle.emptyStartDate) {
      if ($('leaseCalcEmptyDays')) $('leaseCalcEmptyDays').value = profit()?.daysBetween?.(vehicle.emptyStartDate) || '';
    }
    syncStandaloneCalc();
  }

  async function saveCalc() {
    const engine = calc();
    if (!erp() || !engine) return;
    const draft = readCalcDraft();
    if (!draft.vehicleId) {
      showToast('차량을 선택하세요.');
      return;
    }
    const vehicle = erp().vehicles().getById(draft.vehicleId);
    if (!vehicle) return;
    const metrics = engine.compute(draft);
    const contract = erp().contracts().create({
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber,
      vehicleName: vehicle.model,
      driverName: vehicle.renter,
      weeklyRent: draft.weeklyRent,
      rentalDays: draft.rentalDays,
      emptyDays: draft.emptyDays,
      unpaidDays: draft.unpaidDays,
      paidAmount: draft.paidAmount,
      insuranceCost: draft.insuranceCost,
      leaseCost: draft.leaseCost,
      maintenanceCost: draft.maintenanceCost,
      accidentCost: draft.accidentCost,
      otherCost: draft.otherCost,
      penaltyFee: draft.penaltyFee,
      memo: '자동계산 저장'
    });
    const week = calc().weekRange(currentWeekStart());
    erp().saveProfitSnapshot({
      vehicleId: vehicle.id,
      contractId: contract.id,
      periodType: 'snapshot',
      periodStart: week.start,
      periodEnd: week.end,
      metrics,
      vehicle,
      contract
    });
    await erp().persistAll();
    showToast('손익 계산 결과가 저장되었습니다.');
    renderDashboard();
    window.BremAdminLease?.refresh?.();
  }

  function renderEmpty() {
    const rowsEl = $('leaseEmptyRows');
    if (!rowsEl || !erp()) return;
    erp().syncAllVehicleStatusesFromContracts?.();
    const vehicles = erp().vehicles().getAll().filter(item =>
      String(item.vehicleStatus) === 'empty' || erp().isEmptyVehicle(item)
    );
    if (!vehicles.length) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="empty">공차 차량이 없습니다.</td></tr>';
      return;
    }
    rowsEl.innerHTML = vehicles.map(item => {
      const m = profit()?.computeErpMetrics?.(item) || {};
      const dailyBase = m.emptyDailyLoss || m.dailyLeaseCost || m.dailyCost || 0;
      const emptyStart = item.emptyStartDate || item.returnDate || '';
      const emptyEnd = item.returnDate && item.vehicleStatus !== 'empty' ? item.returnDate : '-';
      const statusLabel = profit()?.vehicleStatusLabel?.(item.vehicleStatus) || '-';
      return `
        <tr>
          <td><strong>${escapeHtml(item.vehicleNumber || '-')}</strong></td>
          <td>${escapeHtml(item.model || '-')}</td>
          <td>${formatDate(emptyStart)}</td>
          <td>${emptyEnd === '-' ? '-' : formatDate(emptyEnd)}</td>
          <td class="lease-money--warning">${m.emptyDays || 0}일</td>
          <td>${formatMoney(dailyBase)}</td>
          <td class="lease-money--warning">${formatMoney(m.emptyLoss)}</td>
          <td>${escapeHtml(statusLabel)}</td>
          <td><button type="button" class="small-btn" data-edit-empty-vehicle="${escapeHtml(item.id)}">수정</button></td>
        </tr>
      `;
    }).join('');
  }

  function exportWeeklyExcel() {
    if (!window.XLSX) return;
    const rows = [];
    $('leaseWeeklyRows')?.querySelectorAll('tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      if (cells.length > 1) rows.push(cells);
    });
    const sheet = XLSX.utils.aoa_to_sheet([
      ['차량번호', '차량명', '기사명', '렌탈일수', '공차일수', '미납일수', '렌탈매출', '공차손실', '미납금', '비용합계', '순이익', '상태'],
      ...rows
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, '주간수익');
    XLSX.writeFile(wb, `BREM_주간수익_${state.weekStart || currentWeekStart()}.xlsx`);
  }

  function contractTodayKey() {
    return profit()?.todayKey?.() || new Date().toISOString().slice(0, 10);
  }

  function getLatestContractForVehicle(vehicleId) {
    return erp()?.getLatestContractForVehicle?.(vehicleId) || null;
  }

  function hasOpenArrear(vehicleId) {
    return erp()?.hasOpenArrearForVehicle?.(vehicleId) || false;
  }

  function isContractActive(contract) {
    return erp()?.isContractOperating?.(contract) || false;
  }

  function resolveContractStatus(contract, vehicleId) {
    const vehicle = erp()?.vehicles().getById(vehicleId || contract?.vehicleId);
    return erp()?.resolveRuntimeStatus?.(vehicle, contract)
      || { label: '공차(로스)', code: 'empty' };
  }

  function applyVehicleStatusFromContract(vehicle, contract) {
    erp()?.syncVehicleFromContract?.(vehicle, contract);
  }

  function readContractDealType() {
    const checked = document.querySelector('input[name="leaseContractDealType"]:checked');
    return checked?.value || 'lease';
  }

  function readContractDraft() {
    const engine = calc();
    if (!engine) return {};
    const weeklyRent = engine.money($('leaseContractWeeklyRent')?.value);
    const depositAmount = engine.money($('leaseContractDeposit')?.value);
    const vehicle = erp()?.vehicles().getById($('leaseContractVehicleId')?.value || '');
    const leaseCostWeekly = vehicle?.dailyLeaseCost ? Math.round(vehicle.dailyLeaseCost * 7) : 0;
    const insuranceMonthly = vehicle?.dailyInsuranceCost ? Math.round(vehicle.dailyInsuranceCost * 30) : 0;
    return {
      id: $('leaseContractEditId')?.value || '',
      vehicleId: $('leaseContractVehicleId')?.value || '',
      contractType: readContractDealType(),
      vehicleNumber: $('leaseContractVehicleNumber')?.value || vehicle?.vehicleNumber || '',
      vehicleName: $('leaseContractVehicleName')?.value || vehicle?.model || '',
      modelType: $('leaseContractModelType')?.value || vehicle?.model || '',
      driverName: $('leaseContractDriverName')?.value || '',
      driverPhone: $('leaseContractDriverPhone')?.value || '',
      startDate: $('leaseRentalDealStartDate')?.value || '',
      endDate: $('leaseRentalDealEndDate')?.value || '',
      weeklyRent,
      dailyRent: engine.dailyFromWeekly(weeklyRent),
      rentalDays: 7,
      emptyDays: 0,
      unpaidDays: 0,
      paidAmount: 0,
      vehicleCost: 0,
      insuranceCost: insuranceMonthly,
      leaseCost: leaseCostWeekly,
      maintenanceCost: 0,
      accidentCost: 0,
      otherCost: 0,
      depositAmount,
      penaltyFee: depositAmount,
      collectionMethods: [],
      collectionStatus: engine.ARREAR_STATUS.COMPLETED,
      memo: $('leaseContractMemo')?.value || ''
    };
  }

  function syncContractCalc() {
    const engine = calc();
    if (!engine) return;
    const draft = readContractDraft();
    const setVal = (id, value, readonly = true) => {
      const el = $(id);
      if (!el) return;
      if (readonly) el.value = value || value === 0 ? Number(value).toLocaleString('ko-KR') : '';
      else el.value = value || '';
    };
    setVal('leaseContractDailyRent', Math.round(engine.dailyFromWeekly(draft.weeklyRent)));
    if ($('leaseContractInsurance')) {
      $('leaseContractInsurance').value = draft.insuranceCost
        ? Number(draft.insuranceCost).toLocaleString('ko-KR')
        : '';
    }
    if ($('leaseContractLeaseCost')) {
      $('leaseContractLeaseCost').value = draft.leaseCost
        ? Number(draft.leaseCost).toLocaleString('ko-KR')
        : '';
    }
    const status = resolveContractStatus(draft, draft.vehicleId);
    if ($('leaseContractStatusPreview')) $('leaseContractStatusPreview').value = status.label;
  }

  function formatVehicleSelectLabel(item) {
    const model = item.model || '-';
    const plate = item.vehicleNumber || '-';
    const source = profit()?.vehicleSourceLabel?.(item) || '회사리스';
    return `${model} · ${plate} · ${source}`;
  }

  function fillVehicleSelect(selectEl, includeBlank = true) {
    if (!selectEl || !erp()) return;
    const prev = selectEl.value;
    const options = (includeBlank ? ['<option value="">차량 선택</option>'] : []).concat(
      erp().vehicles().getAll().map(item =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(formatVehicleSelectLabel(item))}</option>`
      )
    );
    selectEl.innerHTML = options.join('');
    if (prev) selectEl.value = prev;
  }

  function onContractVehicleChange() {
    const vehicle = erp()?.vehicles().getById($('leaseContractVehicleId')?.value || '');
    if (!vehicle) return;
    if ($('leaseContractVehicleNumber')) $('leaseContractVehicleNumber').value = vehicle.vehicleNumber || '';
    if ($('leaseContractVehicleName')) $('leaseContractVehicleName').value = vehicle.model || '';
    if ($('leaseContractModelType')) $('leaseContractModelType').value = vehicle.model || '';
    const editingId = $('leaseContractEditId')?.value || '';
    const editing = editingId ? erp().contracts().getById(editingId) : null;
    if (!editing || editing.vehicleId !== vehicle.id) {
      if ($('leaseContractDriverName')) $('leaseContractDriverName').value = '';
      if ($('leaseContractDriverPhone')) $('leaseContractDriverPhone').value = '';
      if ($('leaseContractWeeklyRent')) $('leaseContractWeeklyRent').value = '';
      if ($('leaseContractDeposit')) $('leaseContractDeposit').value = '';
      if ($('leaseRentalDealStartDate')) $('leaseRentalDealStartDate').value = '';
      if ($('leaseRentalDealEndDate')) $('leaseRentalDealEndDate').value = '';
    }
    if ($('leaseContractLeaseCost')) {
      $('leaseContractLeaseCost').value = vehicle.dailyLeaseCost
        ? Math.round(vehicle.dailyLeaseCost * 7).toLocaleString('ko-KR')
        : '';
    }
    if ($('leaseContractInsurance')) {
      const annual = Number(vehicle.annualInsuranceCost || 0)
        || (Number(vehicle.dailyInsuranceCost || 0) * 365);
      $('leaseContractInsurance').value = annual
        ? Math.round(annual / 12).toLocaleString('ko-KR')
        : '';
    }
    syncContractCalc();
  }

  function fillContractForm(contract) {
    if (!contract) return;
    $('leaseContractEditId').value = contract.id || '';
    if ($('leaseContractVehicleId')) $('leaseContractVehicleId').value = contract.vehicleId || '';
    if ($('leaseContractVehicleNumber')) $('leaseContractVehicleNumber').value = contract.vehicleNumber || '';
    if ($('leaseContractVehicleName')) $('leaseContractVehicleName').value = contract.vehicleName || '';
    if ($('leaseContractModelType')) {
      const vehicle = erp()?.vehicles().getById(contract.vehicleId);
      $('leaseContractModelType').value = contract.modelType || vehicle?.model || '';
    }
    document.querySelectorAll('input[name="leaseContractDealType"]').forEach(input => {
      input.checked = input.value === (contract.contractType || 'lease');
    });
    if ($('leaseContractDriverName')) $('leaseContractDriverName').value = contract.driverName || '';
    if ($('leaseContractDriverPhone')) $('leaseContractDriverPhone').value = contract.driverPhone || '';
    if ($('leaseRentalDealStartDate')) $('leaseRentalDealStartDate').value = contract.startDate || '';
    if ($('leaseRentalDealEndDate')) $('leaseRentalDealEndDate').value = contract.endDate || '';
    if ($('leaseContractWeeklyRent')) $('leaseContractWeeklyRent').value = contract.weeklyRent || '';
    if ($('leaseContractDeposit')) {
      $('leaseContractDeposit').value = contract.depositAmount ?? contract.penaltyFee ?? '';
    }
    if ($('leaseContractMemo')) $('leaseContractMemo').value = contract.memo || '';
    syncContractCalc();
    $('leaseContractForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openContractForVehicle(vehicleId) {
    setMenu('contract');
    resetContractForm();
    fillVehicleSelect($('leaseContractVehicleId'));
    if ($('leaseContractVehicleId')) $('leaseContractVehicleId').value = vehicleId || '';
    onContractVehicleChange();
  }

  function renderContractList() {
    const rowsEl = $('leaseContractRows');
    if (!rowsEl || !erp()) return;
    const contracts = erp().contracts().getAll()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (!contracts.length) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="empty">등록된 계약이 없습니다. 차량을 선택해 렌탈/리스자를 등록하세요.</td></tr>';
      return;
    }
    rowsEl.innerHTML = contracts.map(contract => {
      const vehicle = erp().vehicles().getById(contract.vehicleId);
      const typeLabel = profit()?.vehicleSourceLabel?.(vehicle)
        || (contract.contractType === 'rental' ? '렌탈' : '리스');
      const period = [formatDate(contract.startDate), formatDate(contract.endDate)].filter(v => v !== '-').join(' ~ ') || '-';
      const status = resolveContractStatus(contract, contract.vehicleId);
      const deposit = contract.depositAmount ?? contract.penaltyFee ?? 0;
      return `
        <tr>
          <td><strong>${escapeHtml(contract.vehicleNumber || vehicle?.vehicleNumber || '-')}</strong></td>
          <td>${escapeHtml(typeLabel)}</td>
          <td>${escapeHtml(contract.driverName || '-')}</td>
          <td>${escapeHtml(contract.driverPhone || '-')}</td>
          <td>${escapeHtml(period)}</td>
          <td>${formatMoney(contract.weeklyRent)}</td>
          <td>${formatMoney(deposit)}</td>
          <td><span class="lease-status-badge lease-status-badge--${status.code}">${escapeHtml(status.label)}</span></td>
          <td><button type="button" class="small-btn" data-edit-contract="${escapeHtml(contract.id)}">수정</button></td>
        </tr>
      `;
    }).join('');
  }

  async function saveContract(event) {
    event?.preventDefault?.();
    if (!erp()) return;
    const draft = readContractDraft();
    if (!draft.vehicleId) {
      showToast('차량관리에 등록된 차량을 선택하세요.');
      return;
    }
    if (!String(draft.driverName || '').trim()) {
      showToast('렌탈/리스자 이름을 입력하세요.');
      return;
    }

    const vehicle = erp().vehicles().getById(draft.vehicleId);
    if (!vehicle) {
      showToast('선택한 차량을 찾을 수 없습니다.');
      return;
    }

    erp().vehicles().update(vehicle.id, {
      renter: draft.driverName,
      lesseePhone: draft.driverPhone,
      dailyChargeAmount: draft.dailyRent,
      unpaidDays: 0,
      unpaidAmount: 0
    });

    const contract = draft.id
      ? erp().contracts().update(draft.id, { ...draft, vehicleId: vehicle.id })
      : erp().contracts().create({ ...draft, vehicleId: vehicle.id });

    applyVehicleStatusFromContract(vehicle, contract);
    erp().syncAllVehicleStatusesFromContracts?.();

    const metrics = calc().compute({
      ...contract,
      rentalDays: 7,
      unpaidDays: 0,
      emptyDays: isContractActive(contract) ? 0 : 7,
      paidAmount: 0
    });
    const week = calc().weekRange(currentWeekStart());
    const month = currentMonthKey();

    erp().saveProfitSnapshot({
      vehicleId: vehicle.id,
      contractId: contract.id,
      periodType: 'snapshot',
      periodStart: draft.startDate || week.start,
      periodEnd: draft.endDate || week.end,
      metrics,
      vehicle,
      contract
    });
    erp().saveProfitSnapshot({
      vehicleId: vehicle.id,
      contractId: contract.id,
      periodType: 'weekly',
      periodStart: week.start,
      periodEnd: week.end,
      metrics,
      vehicle,
      contract
    });
    erp().saveProfitSnapshot({
      vehicleId: vehicle.id,
      contractId: contract.id,
      periodType: 'monthly',
      periodStart: `${month}-01`,
      periodEnd: `${month}-${String(calc().daysInMonth(month)).padStart(2, '0')}`,
      metrics,
      vehicle,
      contract
    });

    await erp().persistAll();
    $('leaseContractEditId').value = contract.id;
    showToast('계약이 저장되었습니다.');
    window.BremAdminLease?.refresh?.();
    renderContractList();
    renderWeekly();
    renderMonthly();
    renderArrears();
  }

  function endContractAsEmpty() {
    const draft = readContractDraft();
    if (!draft.vehicleId) {
      showToast('차량을 선택하세요.');
      return;
    }
    const today = contractTodayKey();
    if ($('leaseRentalDealEndDate')) $('leaseRentalDealEndDate').value = today;
    syncContractCalc();
    showToast('반납일을 오늘로 설정했습니다. 저장하면 공차로 전환됩니다.');
  }

  function resetContractForm() {
    $('leaseContractForm')?.reset();
    $('leaseContractEditId').value = '';
    document.querySelectorAll('input[name="leaseContractDealType"]').forEach(input => {
      input.checked = input.value === 'lease';
    });
    if ($('leaseContractDeposit')) $('leaseContractDeposit').value = '';
    syncContractCalc();
  }

  function buildPeriodRow(contract, vehicle, periodDays) {
    const metrics = calc().computeFromContract({
      ...contract,
      rentalDays: periodDays || contract.rentalDays
    }, vehicle);
    return {
      vehicleNumber: contract.vehicleNumber || vehicle?.vehicleNumber || '-',
      vehicleName: contract.vehicleName || vehicle?.model || '-',
      driverName: contract.driverName || vehicle?.renter || '-',
      rentalDays: contract.rentalDays,
      emptyDays: contract.emptyDays,
      unpaidDays: contract.unpaidDays,
      rentalRevenue: metrics.rentalRevenue,
      emptyLoss: metrics.emptyLoss,
      unpaidAmount: metrics.unpaidAmount,
      insuranceCost: contract.insuranceCost,
      leaseCost: contract.leaseCost,
      maintenanceCost: contract.maintenanceCost,
      accidentCost: contract.accidentCost,
      otherCost: contract.otherCost,
      totalCost: metrics.totalCost,
      netProfit: metrics.netProfit,
      isDeficit: metrics.isDeficit,
      statusLabel: calc().arrearsStatusLabel(contract.collectionStatus),
      contractId: contract.id
    };
  }

  function renderWeekly() {
    const rowsEl = $('leaseWeeklyRows');
    if (!rowsEl || !erp()) return;
    const weekStart = $('leaseWeekStart')?.value || state.weekStart || currentWeekStart();
    state.weekStart = weekStart;
    const week = calc().weekRange(weekStart);
    if ($('leaseWeekRangeLabel')) {
      $('leaseWeekRangeLabel').textContent = formatLeaseWeekRangeLabel(weekStart);
    }

    const logs = erp().profitLogs().getAll().filter(item =>
      item.periodType === 'weekly' && item.periodStart === week.start
    );
    const contracts = erp().contracts().getAll();
    const vehicles = new Map(erp().vehicles().getAll().map(item => [item.id, item]));

    const rows = logs.length
      ? logs.map(log => {
          const vehicle = vehicles.get(log.vehicleId);
          const raw = log.rawData || {};
          return {
            vehicleNumber: raw.vehicleNumber || vehicle?.vehicleNumber || '-',
            vehicleName: raw.vehicleName || vehicle?.model || '-',
            driverName: raw.driverName || vehicle?.renter || '-',
            rentalDays: raw.rentalDays || 0,
            emptyDays: raw.emptyDays || 0,
            unpaidDays: raw.unpaidDays || 0,
            rentalRevenue: log.rentalRevenue,
            emptyLoss: log.emptyLoss,
            unpaidAmount: log.unpaidAmount,
            insuranceCost: log.insuranceCost,
            leaseCost: log.leaseCost,
            maintenanceCost: log.maintenanceCost,
            accidentCost: log.accidentLoss,
            otherCost: log.otherCost,
            totalCost: (log.leaseCost || 0) + (log.insuranceCost || 0) + (log.maintenanceCost || 0) + (log.accidentLoss || 0) + (log.otherCost || 0) + (log.emptyLoss || 0),
            netProfit: log.netProfit,
            isDeficit: log.netProfit < 0,
            statusLabel: raw.statusLabel || '-',
            contractId: raw.contractId || ''
          };
        })
      : contracts.map(contract => buildPeriodRow(contract, vehicles.get(contract.vehicleId), 7));

    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="14" class="empty">해당 주간 데이터가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHtml(row.vehicleNumber)}</td>
        <td>${escapeHtml(row.vehicleName)}</td>
        <td>${escapeHtml(row.driverName)}</td>
        <td>${row.rentalDays || 0}일</td>
        <td class="lease-money--warning">${row.emptyDays || 0}일</td>
        <td class="lease-money--warning">${row.unpaidDays || 0}일</td>
        <td>${formatMoney(row.rentalRevenue)}</td>
        <td class="lease-money--warning">${formatMoney(row.emptyLoss)}</td>
        <td class="lease-money--warning">${formatMoney(row.unpaidAmount)}</td>
        <td>${formatMoney((row.insuranceCost || 0) + (row.leaseCost || 0) + (row.maintenanceCost || 0) + (row.accidentCost || 0) + (row.otherCost || 0))}</td>
        <td class="${moneyClass(row.netProfit)}"><strong>${formatMoney(row.netProfit)}</strong></td>
        <td>${escapeHtml(row.statusLabel)}</td>
      </tr>
    `).join('');
  }

  function renderMonthly() {
    const rowsEl = $('leaseMonthlyRows');
    if (!rowsEl || !erp()) return;
    const monthKey = $('leaseMonthKey')?.value || state.monthKey || currentMonthKey();
    state.monthKey = monthKey;
    const days = calc().daysInMonth(monthKey);

    const logs = erp().profitLogs().getAll().filter(item =>
      item.periodType === 'monthly' && String(item.periodStart || '').startsWith(monthKey)
    );
    const contracts = erp().contracts().getAll();
    const vehicles = new Map(erp().vehicles().getAll().map(item => [item.id, item]));

    const rows = logs.length
      ? logs.map(log => {
          const vehicle = vehicles.get(log.vehicleId);
          const raw = log.rawData || {};
          return {
            vehicleNumber: raw.vehicleNumber || vehicle?.vehicleNumber || '-',
            vehicleName: raw.vehicleName || vehicle?.model || '-',
            driverName: raw.driverName || vehicle?.renter || '-',
            rentalDays: raw.rentalDays || days,
            emptyDays: raw.emptyDays || 0,
            unpaidDays: raw.unpaidDays || 0,
            rentalRevenue: log.rentalRevenue,
            unpaidAmount: log.unpaidAmount,
            recoveredAmount: raw.recoveredAmount || 0,
            emptyLoss: log.emptyLoss,
            totalCost: (log.leaseCost || 0) + (log.insuranceCost || 0) + (log.maintenanceCost || 0) + (log.accidentLoss || 0) + (log.otherCost || 0) + (log.emptyLoss || 0),
            netProfit: log.netProfit,
            isDeficit: log.netProfit < 0,
            memo: raw.memo || ''
          };
        })
      : contracts.map(contract => {
          const row = buildPeriodRow(contract, vehicles.get(contract.vehicleId), days);
          return { ...row, recoveredAmount: contract.recoveredAmount || 0, memo: contract.memo || '' };
        });

    const totals = calc().aggregateRows(rows);
    const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    setText('leaseMonthTotalVehicles', `${totals.count}대`);
    setText('leaseMonthOperating', `${totals.operatingCount}대`);
    setText('leaseMonthEmpty', `${totals.emptyCount}대`);
    setText('leaseMonthRevenue', formatMoney(totals.rentalRevenue));
    setText('leaseMonthUnpaid', formatMoney(totals.unpaidAmount));
    setText('leaseMonthRecovered', formatMoney(totals.recoveredAmount));
    setText('leaseMonthEmptyLoss', formatMoney(totals.emptyLoss));
    setText('leaseMonthCost', formatMoney(totals.totalCost));
    setText('leaseMonthNet', formatMoney(totals.netProfit));
    setText('leaseMonthDeficit', `${totals.deficitCount}대`);

    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="14" class="empty">해당 월 데이터가 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHtml(row.vehicleNumber)}</td>
        <td>${escapeHtml(row.vehicleName)}</td>
        <td>${escapeHtml(row.driverName)}</td>
        <td>${row.rentalDays || 0}일</td>
        <td class="lease-money--warning">${row.emptyDays || 0}일</td>
        <td class="lease-money--warning">${row.unpaidDays || 0}일</td>
        <td>${formatMoney(row.rentalRevenue)}</td>
        <td class="lease-money--warning">${formatMoney(row.unpaidAmount)}</td>
        <td>${formatMoney(row.recoveredAmount)}</td>
        <td class="lease-money--warning">${formatMoney(row.emptyLoss)}</td>
        <td>${formatMoney(row.totalCost)}</td>
        <td class="${moneyClass(row.netProfit)}"><strong>${formatMoney(row.netProfit)}</strong></td>
        <td>${escapeHtml(row.memo || '-')}</td>
      </tr>
    `).join('');
  }

  function renderArrears() {
    const rowsEl = $('leaseArrearRows');
    if (!rowsEl || !erp()) return;
    const list = erp().arrears().getAll();
    const vehicles = new Map(erp().vehicles().getAll().map(item => [item.id, item]));
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="9" class="empty">미납 기록이 없습니다.</td></tr>';
      return;
    }
    rowsEl.innerHTML = list.map(item => {
      const vehicle = vehicles.get(item.vehicleId);
      const methods = (item.collectionMethods || []).map(calc().collectionMethodLabel).join(', ') || '-';
      const status = calc().arrearsStatusLabel(item.collectionStatus);
      const statusCls = item.collectionStatus === calc().ARREAR_STATUS.COMPLETED
        ? 'lease-status--done'
        : (item.collectionStatus === calc().ARREAR_STATUS.COLLECTING ? 'lease-status--collecting' : 'lease-status--unpaid');
      return `
        <tr>
          <td>${escapeHtml(vehicle?.vehicleNumber || '-')}</td>
          <td>${escapeHtml(vehicle?.model || '-')}</td>
          <td>${item.unpaidDays}일</td>
          <td class="lease-money--warning">${formatMoney(item.unpaidAmount)}</td>
          <td>${formatMoney(item.paidAmount)}</td>
          <td>${escapeHtml(methods)}</td>
          <td><span class="${statusCls}">${escapeHtml(status)}</span></td>
          <td>${formatDate(item.processedDate)}</td>
          <td>
            ${item.collectionStatus !== calc().ARREAR_STATUS.COMPLETED
              ? `<button type="button" class="small-btn primary-btn" data-complete-arrear="${escapeHtml(item.id)}">처리완료</button>`
              : '-'}
            <button type="button" class="small-btn danger-btn" data-delete-arrear="${escapeHtml(item.id)}">삭제</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function completeArrear(id) {
    if (!erp()) return;
    const item = erp().arrears().getById(id);
    if (!item) return;
    const recovered = Number(prompt('회수금액을 입력하세요.', String(item.unpaidAmount || 0)) || 0);
    erp().arrears().update(id, {
      collectionStatus: calc().ARREAR_STATUS.COMPLETED,
      processedDate: BremLeaseProfit.todayKey(),
      recoveredAmount: recovered,
      unpaidAmount: Math.max(0, item.unpaidAmount - recovered),
      paidAmount: item.paidAmount + recovered
    });
    if (item.contractId) {
      erp().contracts().update(item.contractId, {
        collectionStatus: calc().ARREAR_STATUS.COMPLETED,
        recoveredAmount: recovered,
        unpaidDays: 0,
        unpaidAmount: 0,
        processedDate: BremLeaseProfit.todayKey()
      });
    }
    await erp().persistAll();
    showToast('미납 처리가 완료되었습니다.');
    renderArrears();
    renderMonthly();
    window.BremAdminLease?.refresh?.();
  }

  function normalizeBulkStatus(value) {
    const text = String(value || '').trim();
    if (['회수중', 'collecting'].includes(text)) return calc().ARREAR_STATUS.COLLECTING;
    if (['처리완료', 'completed', '완료'].includes(text)) return calc().ARREAR_STATUS.COMPLETED;
    return calc().ARREAR_STATUS.UNPAID;
  }

  function normalizeBulkMethod(value) {
    const text = String(value || '').trim();
    const methods = [];
    if (text.includes('급여')) methods.push(calc().COLLECTION_METHODS.SALARY);
    if (text.includes('별도') || text.includes('입금')) methods.push(calc().COLLECTION_METHODS.DEPOSIT);
    return methods;
  }

  function parseBulkV3Workbook(workbook) {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    if (!rows.length) return [];
    const header = rows[0].map(cell => String(cell || '').trim());
    const map = {};
    BULK_V3_COLUMNS.forEach(col => {
      const idx = header.findIndex(h => h === col.label || h.replace(/\s/g, '') === col.label.replace(/\s/g, ''));
      map[col.key] = idx >= 0 ? idx : BULK_V3_COLUMNS.indexOf(col);
    });
    return rows.slice(1).filter(row => row?.some(cell => String(cell || '').trim())).map((row, index) => {
      const raw = {};
      BULK_V3_COLUMNS.forEach(col => {
        const val = row[map[col.key]];
        if (['weeklyRent', 'paidAmount', 'unpaidDays', 'emptyDays', 'insuranceCost', 'leaseCost', 'maintenanceCost', 'accidentCost', 'otherCost', 'penaltyFee'].includes(col.key)) {
          raw[col.key] = erp().vehicles().normalizeMoney(val);
        } else if (col.key === 'startDate' || col.key === 'endDate') {
          raw[col.key] = erp().vehicles().normalizeDate(val);
        } else {
          raw[col.key] = String(val || '').trim();
        }
      });
      raw.collectionMethods = normalizeBulkMethod(raw.collectionMethod);
      raw.collectionStatus = normalizeBulkStatus(raw.collectionStatus);
      const metrics = calc().compute({
        weeklyRent: raw.weeklyRent,
        rentalDays: calc().daysInMonth(currentMonthKey()),
        emptyDays: raw.emptyDays,
        unpaidDays: raw.unpaidDays,
        insuranceCost: raw.insuranceCost,
        leaseCost: raw.leaseCost,
        maintenanceCost: raw.maintenanceCost,
        accidentCost: raw.accidentCost,
        otherCost: raw.otherCost,
        penaltyFee: raw.penaltyFee,
        paidAmount: raw.paidAmount
      });
      const errors = [];
      if (!raw.vehicleNumber) errors.push('차량번호 필요');
      return { rowNumber: index + 2, raw, metrics, valid: !errors.length, errors };
    });
  }

  function renderBulkGuide() {
    const head = $('leaseBulkV3GuideHead');
    const body = $('leaseBulkV3GuideBody');
    if (!head || !body) return;
    head.innerHTML = BULK_V3_COLUMNS.map(col => `<th>${escapeHtml(col.col)} ${escapeHtml(col.label)}</th>`).join('');
    body.innerHTML = `<tr>${BULK_V3_COLUMNS.map(col => `<td>${col.key === 'modelType' ? 'PCX/NMAX/FORZA/기타' : ''}</td>`).join('')}</tr>`;
  }

  function renderBulkPreview() {
    const body = $('leaseBulkV3PreviewBody');
    if (!body) return;
    const valid = state.bulkRows.filter(row => row.valid).length;
    const errors = state.bulkRows.length - valid;
    if ($('leaseBulkV3Total')) $('leaseBulkV3Total').textContent = String(state.bulkRows.length);
    if ($('leaseBulkV3Valid')) $('leaseBulkV3Valid').textContent = String(valid);
    if ($('leaseBulkV3Error')) $('leaseBulkV3Error').textContent = String(errors);
    if ($('leaseBulkV3ApplyBtn')) $('leaseBulkV3ApplyBtn').disabled = valid === 0;
    body.innerHTML = state.bulkRows.map(row => `
      <tr class="${row.valid ? 'row-ok' : 'row-error'}">
        <td>${row.rowNumber}</td>
        <td>${escapeHtml(row.raw.vehicleNumber)}</td>
        <td>${escapeHtml(row.raw.driverName)}</td>
        <td>${formatMoney(row.raw.weeklyRent)}</td>
        <td class="${moneyClass(row.metrics.netProfit)}">${formatMoney(row.metrics.netProfit)}</td>
        <td>${row.valid ? '등록 가능' : escapeHtml(row.errors.join(', '))}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="empty">업로드할 데이터가 없습니다.</td></tr>';
  }

  async function applyBulkV3() {
    if (!erp()) return;
    const validRows = state.bulkRows.filter(row => row.valid);
    for (const row of validRows) {
      const raw = row.raw;
      let vehicle = erp().vehicles().findByVehicleKey({ vehicleNumber: raw.vehicleNumber });
      if (!vehicle) {
        vehicle = erp().vehicles().create({
          vehicleNumber: raw.vehicleNumber,
          model: raw.vehicleName || raw.modelType,
          renter: raw.driverName,
          contractType: 'rental',
          dailyChargeAmount: calc().dailyFromWeekly(raw.weeklyRent)
        });
      }
      const contract = erp().contracts().create({
        vehicleId: vehicle.id,
        vehicleNumber: raw.vehicleNumber,
        vehicleName: raw.vehicleName,
        modelType: raw.modelType,
        driverName: raw.driverName,
        driverPhone: raw.driverPhone,
        startDate: raw.startDate,
        endDate: raw.endDate,
        weeklyRent: raw.weeklyRent,
        paidAmount: raw.paidAmount,
        unpaidDays: raw.unpaidDays,
        emptyDays: raw.emptyDays,
        insuranceCost: raw.insuranceCost,
        leaseCost: raw.leaseCost,
        maintenanceCost: raw.maintenanceCost,
        accidentCost: raw.accidentCost,
        otherCost: raw.otherCost,
        penaltyFee: raw.penaltyFee,
        collectionMethods: raw.collectionMethods,
        collectionStatus: raw.collectionStatus,
        memo: raw.memo
      });
      const metrics = calc().compute(contract);
      const month = currentMonthKey();
      erp().saveProfitSnapshot({
        vehicleId: vehicle.id,
        contractId: contract.id,
        periodType: 'monthly',
        periodStart: `${month}-01`,
        periodEnd: `${month}-${String(calc().daysInMonth(month)).padStart(2, '0')}`,
        metrics,
        vehicle,
        contract
      });
    }
    await erp().persistAll();
    showToast(`${validRows.length}건 일괄 등록 완료`);
    state.bulkRows = [];
    renderBulkPreview();
    window.BremAdminLease?.refresh?.();
    renderMonthly();
  }

  function downloadBulkTemplate() {
    if (!window.XLSX) return;
    const headers = BULK_V3_COLUMNS.map(col => col.label);
    const sheet = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, '일괄등록');
    XLSX.writeFile(wb, 'BREM_리스ERP_일괄등록양식.xlsx');
  }

  function exportMonthlyExcel() {
    if (!window.XLSX) return;
    const rows = [];
    $('leaseMonthlyRows')?.querySelectorAll('tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
      if (cells.length > 1) rows.push(cells);
    });
    const sheet = XLSX.utils.aoa_to_sheet([
      ['차량번호', '차량명', '기사명', '월 렌탈일수', '월 공차일수', '월 미납일수', '월 렌탈매출', '월 미납금', '월 회수금액', '월 공차손실', '월 비용', '월 순이익', '비고'],
      ...rows
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, '월간수익');
    XLSX.writeFile(wb, `BREM_월간수익_${state.monthKey || currentMonthKey()}.xlsx`);
  }

  function bindCalcInputs() {
    if (bindCalcInputs.bound) return;
    bindCalcInputs.bound = true;

    const contractIds = [
      'leaseContractWeeklyRent', 'leaseContractDeposit'
    ];
    contractIds.forEach(id => {
      $(id)?.addEventListener('input', syncContractCalc);
      $(id)?.addEventListener('change', syncContractCalc);
    });
    $('leaseContractVehicleId')?.addEventListener('change', onContractVehicleChange);
    document.querySelectorAll('input[name="leaseContractDealType"]').forEach(input => {
      input.addEventListener('change', syncContractCalc);
    });

    const calcIds = [
      'leaseCalcWeeklyRent', 'leaseCalcRentalDays', 'leaseCalcEmptyDays', 'leaseCalcUnpaidDays',
      'leaseCalcPaidAmount', 'leaseCalcInsurance', 'leaseCalcLeaseCost', 'leaseCalcMaintenance',
      'leaseCalcAccident', 'leaseCalcOtherCost', 'leaseCalcPenalty'
    ];
    calcIds.forEach(id => {
      $(id)?.addEventListener('input', syncStandaloneCalc);
      $(id)?.addEventListener('change', syncStandaloneCalc);
    });
    $('leaseCalcVehicleId')?.addEventListener('change', onCalcVehicleChange);
    $('leaseCalcSaveBtn')?.addEventListener('click', () => { void saveCalc(); });
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    const nav = document.querySelector('.lease-erp-nav');
    nav?.addEventListener('click', event => {
      const btn = event.target.closest('[data-lease-menu]');
      if (!btn) return;
      event.preventDefault();
      setMenu(btn.dataset.leaseMenu);
    });

    document.querySelectorAll('[data-lease-menu]').forEach(btn => {
      btn.addEventListener('click', () => setMenu(btn.dataset.leaseMenu));
    });

    $('leaseContractForm')?.addEventListener('submit', saveContract);
    $('leaseContractResetBtn')?.addEventListener('click', resetContractForm);
    $('leaseContractEndBtn')?.addEventListener('click', endContractAsEmpty);
    ['leaseRentalDealStartDate', 'leaseRentalDealEndDate', 'leaseContractDriverName'].forEach(id => {
      $(id)?.addEventListener('change', syncContractCalc);
      $(id)?.addEventListener('input', syncContractCalc);
    });
    $('leaseWeekStart')?.addEventListener('change', renderWeekly);
    $('leaseDashSettingsBtn')?.addEventListener('click', () => {
      const panel = $('leaseDashSettings');
      if (!panel) return;
      const hidden = panel.hasAttribute('hidden');
      if (hidden) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    });
    $('leaseDashWeekBasis')?.addEventListener('change', event => {
      const picked = String(event.target.value || '').slice(0, 10);
      if (!picked) return;
      const weekStart = BremStorage?.adminPreferences?.setLeaseDashboardWeekBasis?.(picked)
        || BremDatePicker?.weekStartKey?.(picked)
        || picked;
      if ($('leaseDashWeekBasis')) $('leaseDashWeekBasis').value = weekStart;
      if ($('leaseWeekStart')) $('leaseWeekStart').value = weekStart;
      state.weekStart = weekStart;
      updateLeaseDashWeekUi();
      renderDashboardKpis();
      renderWeekly();
      showToast('주간 기준이 저장되었습니다. (수요일~화요일)');
    });
    $('leaseWeekRefreshBtn')?.addEventListener('click', renderWeekly);
    $('leaseWeekExportBtn')?.addEventListener('click', exportWeeklyExcel);
    $('leaseMonthKey')?.addEventListener('change', renderMonthly);
    $('leaseMonthExportBtn')?.addEventListener('click', exportMonthlyExcel);
    $('leaseBulkV3TemplateBtn')?.addEventListener('click', downloadBulkTemplate);
    $('leaseBulkV3ApplyBtn')?.addEventListener('click', () => { void applyBulkV3(); });
    $('leaseBulkV3File')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file || !window.XLSX) return;
      const reader = new FileReader();
      reader.onload = () => {
        const wb = XLSX.read(reader.result, { type: 'array' });
        state.bulkRows = parseBulkV3Workbook(wb);
        renderBulkPreview();
      };
      reader.readAsArrayBuffer(file);
    });

    document.addEventListener('click', event => {
      const editContract = event.target.closest('[data-edit-contract]');
      if (editContract && erp()) {
        const contract = erp().contracts().getById(editContract.dataset.editContract);
        if (contract) fillContractForm(contract);
        return;
      }
      const editEmpty = event.target.closest('[data-edit-empty-vehicle]');
      if (editEmpty) {
        setMenu('vehicle');
        const item = erp()?.vehicles().getById(editEmpty.dataset.editEmptyVehicle);
        if (item) window.BremAdminLease?.fillForm?.(item) || document.querySelector(`[data-edit-lease="${item.id}"]`)?.click();
        return;
      }
      const dashMenuBtn = event.target.closest('[data-dash-go-menu]');
      if (dashMenuBtn) {
        setMenu(dashMenuBtn.dataset.dashGoMenu || 'dashboard');
        return;
      }
      const dashEditBtn = event.target.closest('[data-dash-edit-vehicle]');
      if (dashEditBtn) {
        setMenu('vehicle');
        const item = erp()?.vehicles().getById(dashEditBtn.dataset.dashEditVehicle);
        if (item) window.BremAdminLease?.fillForm?.(item);
        return;
      }
      const completeBtn = event.target.closest('[data-complete-arrear]');
      if (completeBtn) {
        void completeArrear(completeBtn.dataset.completeArrear);
        return;
      }
      const deleteBtn = event.target.closest('[data-delete-arrear]');
      if (deleteBtn && erp()) {
        erp().arrears().removeById(deleteBtn.dataset.deleteArrear);
        void erp().persistAll().then(renderArrears);
      }
    });

    bindCalcInputs();
  }

  async function init() {
    if (!$('lease-management')) return;
    bindEvents();
    syncStandaloneCalc();
    syncContractCalc();
    if (!erp()) {
      setMenu(state.menu || 'dashboard');
      return;
    }
    try {
      await erp().ensureLoaded?.();
    } catch (error) {
      console.error('[BremAdminLeaseMenus] ensureLoaded failed', error);
    }
    fillVehicleSelect($('leaseContractVehicleId'));
    fillVehicleSelect($('leaseCalcVehicleId'));
    if ($('leaseWeekStart') && !$('leaseWeekStart').value) $('leaseWeekStart').value = currentWeekStart();
    if ($('leaseMonthKey') && !$('leaseMonthKey').value) $('leaseMonthKey').value = currentMonthKey();
    updateLeaseDashWeekUi();
    setMenu(state.menu || 'dashboard');
  }

  function refresh() {
    fillVehicleSelect($('leaseContractVehicleId'));
    fillVehicleSelect($('leaseCalcVehicleId'));
    renderDashboard();
    if (state.menu === 'weekly') renderWeekly();
    if (state.menu === 'monthly') renderMonthly();
    if (state.menu === 'arrears') renderArrears();
    if (state.menu === 'empty') renderEmpty();
    if (state.menu === 'contract') renderContractList();
    if (state.menu === 'calc') syncStandaloneCalc();
  }

  return {
    formatVehicleSelectLabel,
    init,
    refresh,
    setMenu,
    openContractForVehicle,
    getLatestContractForVehicle,
    resolveContractStatus,
    hasOpenArrear,
    syncContractCalc,
    syncStandaloneCalc,
    renderWeekly,
    renderMonthly,
    renderArrears,
    renderEmpty,
    renderDashboard,
    renderDashboardKpis,
    renderDashboardVehicleOverview,
    updateLeaseDashWeekUi,
    currentWeekStart,
    renderContractList
  };
})();

window.BremAdminLeaseMenus = BremAdminLeaseMenus;

function bootLeaseMenus() {
  void BremAdminLeaseMenus.init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLeaseMenus, { once: true });
} else {
  bootLeaseMenus();
}

/**
 * 리스 ERP — 9개 서브메뉴 (대시보드 · 차량 · 계약 · 자동계산 · 미납 · 공차 · 주간/월간 · 일괄)
 */
const BremAdminLeaseMenus = (function () {
  const erp = () => window.BremLeaseErp;
  const calc = () => window.BremLeaseRentalCalc;
  const profit = () => window.BremLeaseProfit;
  const $ = id => document.getElementById(id);

  const BULK_VEHICLE_COLUMNS = [
    { key: 'erpMode', label: '회사구분', col: 'A', aliases: ['회사구분', 'ERP구분', 'erp구분'] },
    { key: 'contractType', label: '종류', col: 'B', aliases: ['종류', '리스/렌탈', '리스렌탈'] },
    { key: 'model', label: '기종', col: 'C', aliases: ['기종', '리스기종', '차량명', '리스 기종'] },
    { key: 'chassisNumber', label: '차대번호', col: 'D', aliases: ['차대번호', '차대'] },
    { key: 'vehicleNumber', label: '차량번호', col: 'E', aliases: ['차량번호', '번호판'] },
    { key: 'leaseCompany', label: '리스회사', col: 'F', aliases: ['리스회사', '리스사', '리스회사명'] },
    { key: 'dailyLeaseCost', label: '리스비(일)', col: 'G', aliases: ['리스비(일)', '리스비', '일리스비', '리스비하루'] },
    { key: 'contractStartDate', label: '리스시작일', col: 'H', aliases: ['리스시작일', '계약시작일', '시작일'] },
    { key: 'contractEndDate', label: '리스종료일', col: 'I', aliases: ['리스종료일', '최종만료일', '만료일', '계약종료일'] },
    { key: 'insuranceAge', label: '보험연령', col: 'J', aliases: ['보험연령', '만N세'] },
    { key: 'insuranceCompany', label: '처리보험회사', col: 'K', aliases: ['처리보험회사', '보험사'] },
    { key: 'insuranceType', label: '보험상품', col: 'L', aliases: ['보험상품', '보험종류'] },
    { key: 'annualInsuranceCost', label: '보험료(연)', col: 'M', aliases: ['보험료(연)', '연간보험료', '보험료'] },
    { key: 'purchasePrice', label: '차량가액', col: 'N', aliases: ['차량가액', '취득가'] },
    { key: 'acquisitionTaxRate', label: '취득세%', col: 'O', aliases: ['취득세%', '취득세'] },
    { key: 'otherAcquisitionCost', label: '기타비용', col: 'P', aliases: ['기타비용', '기타'] },
    { key: 'memo', label: '메모', col: 'Q' },
    { key: 'driverName', label: '렌탈/리스자', col: 'R', aliases: ['렌탈/리스자', '기사명', '렌탈자', '리스자'] },
    { key: 'driverPhone', label: '연락처', col: 'S', aliases: ['연락처', '전화번호', '휴대폰'] },
    { key: 'dealStartDate', label: '계약시작일', col: 'T', aliases: ['계약시작일', '렌탈시작일', '운행시작일'] },
    { key: 'dealEndDate', label: '계약종료일', col: 'U', aliases: ['계약종료일', '렌탈종료일', '운행종료일'] },
    { key: 'dailyRent', label: '일렌탈료', col: 'V', aliases: ['일렌탈료', '일 렌탈료', '라이더부담리스렌탈료'] }
  ];

  const state = {
    menu: 'dashboard',
    weekStart: '',
    monthKey: '',
    bulkRows: [],
    contractDeleting: '',
    contractDriverSearch: '',
    contractListSearch: '',
    weeklySelectedLogIds: new Set(),
    weeklyVisibleLogIds: [],
    monthlySelectedLogIds: new Set(),
    monthlyVisibleLogIds: [],
    arrearContractOptionsDirty: true,
    contractSaving: false,
    arrearWeekStart: '',
    arrearDriverSearch: ''
  };

  function getContractDrivers() {
    return BremStorage?.drivers?.getAll?.() || [];
  }

  function makeDriverLoginId(driver) {
    if (window.BremDriverUtils?.makeDriverLoginId) {
      return window.BremDriverUtils.makeDriverLoginId(driver);
    }
    const phone = String(driver?.phone || '').replace(/[^0-9]/g, '');
    return `${String(driver?.name || '').replace(/\s/g, '')}${phone.slice(-4)}`;
  }

  function filterContractDrivers(list) {
    const keyword = String(state.contractDriverSearch || '').trim().toLowerCase();
    if (!keyword) return list;
    return list.filter(driver => {
      const haystack = [
        driver.name,
        driver.phone,
        driver.baeminId,
        driver.coupangId,
        driver.coupangLoginKey,
        makeDriverLoginId(driver)
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  function updateLeaseContractDriverSelectedLabel(driver) {
    const label = $('leaseContractDriverSelected');
    if (!label) return;
    if (!driver) {
      label.textContent = '선택된 기사: 없음';
      return;
    }
    label.textContent = `선택된 기사: ${driver.name || '-'} · ${driver.phone || '-'} · 쿠팡 ${makeDriverLoginId(driver) || '-'}`;
  }

  function selectLeaseContractDriver(driver) {
    if (!driver) return;
    if ($('leaseContractDriverId')) $('leaseContractDriverId').value = driver.id || '';
    if ($('leaseContractDriverName')) $('leaseContractDriverName').value = driver.name || '';
    if ($('leaseContractDriverPhone')) $('leaseContractDriverPhone').value = driver.phone || '';
    updateLeaseContractDriverSelectedLabel(driver);
    if ($('leaseContractDriverResults')) $('leaseContractDriverResults').hidden = true;
    if ($('leaseContractDriverSearch')) $('leaseContractDriverSearch').value = driver.name || '';
    syncContractCalc();
  }

  function clearLeaseContractDriverSelection() {
    if ($('leaseContractDriverId')) $('leaseContractDriverId').value = '';
    if ($('leaseContractDriverName')) $('leaseContractDriverName').value = '';
    if ($('leaseContractDriverPhone')) $('leaseContractDriverPhone').value = '';
    updateLeaseContractDriverSelectedLabel(null);
  }

  function renderLeaseContractDriverResults() {
    const box = $('leaseContractDriverResults');
    if (!box) return;
    const keyword = String(state.contractDriverSearch || '').trim();
    if (!keyword) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const drivers = filterContractDrivers(getContractDrivers()).slice(0, 30);
    if (!drivers.length) {
      box.hidden = false;
      box.innerHTML = '<p class="lease-driver-picker__empty">검색된 등록 기사가 없습니다.</p>';
      return;
    }
    box.hidden = false;
    box.innerHTML = drivers.map(driver => `
      <button type="button" class="lease-driver-picker__item" data-lease-pick-driver="${escapeHtml(driver.id)}">
        <strong>${escapeHtml(driver.name || '-')}</strong>
        <span>${escapeHtml(driver.phone || '-')}</span>
        <span>쿠팡 ${escapeHtml(makeDriverLoginId(driver) || '-')}</span>
        <span>배민 ${escapeHtml(driver.baeminId || '-')}</span>
      </button>
    `).join('');
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

  function buildFleetPeriodContext() {
    if (!erp()) {
      return { arrears: [], accidents: [], maintenance: [] };
    }
    return {
      arrears: erp().arrears().getAll(),
      accidents: erp().accidents().getAll(),
      maintenance: erp().maintenance().getAll()
    };
  }

  function computeVehiclePeriodMetrics(vehicle, periodStart, periodEnd) {
    const contract = erp()?.getLatestContractForVehicle?.(vehicle?.id) || null;
    return calc().computeVehiclePeriodMetrics({
      vehicle,
      contract,
      periodStart,
      periodEnd,
      ...buildFleetPeriodContext()
    });
  }

  function computeFleetPeriodAggregate(periodStart, periodEnd) {
    const vehicles = erp()?.vehicles().getAll() || [];
    const rows = vehicles.map(vehicle => computeVehiclePeriodMetrics(vehicle, periodStart, periodEnd));
    return calc().aggregateFleetPeriodMetrics(rows);
  }

  function renderStatusTagsHtml(vehicle, contract) {
    const tags = erp()?.resolveVehicleStatusTags?.(vehicle, contract) || [];
    return tags.map(tag =>
      `<span class="lease-status-badge lease-status-badge--${escapeHtml(tag.code)}">${escapeHtml(tag.label)}</span>`
    ).join(' ');
  }

  function contractDealTypeBadge(contract) {
    const isRental = String(contract?.contractType || '') === 'rental';
    const cls = isRental ? 'lease-list-badge--rental' : 'lease-list-badge--lease';
    const label = isRental ? '렌탈' : '리스';
    return `<span class="lease-list-badge ${cls}"><span class="lease-list-badge__mark">✓</span>${label}</span>`;
  }

  function formatLeaseVehiclePeriod(vehicle) {
    const start = formatDate(vehicle?.contractStartDate);
    const end = formatDate(vehicle?.contractEndDate);
    if (start === '-' && end === '-') return '-';
    return `${start} ~ ${end}`;
  }

  function formatRentalContractPeriod(contract) {
    if (!contract) return '-';
    const start = formatDate(contract.startDate);
    const end = formatDate(contract.endDate);
    if (start === '-' && end === '-') return '-';
    return `${start} ~ ${end}`;
  }

  function updateLeaseErpUnsavedBanner() {
    const banner = $('leaseErpUnsavedBanner');
    const commitBtn = $('leaseErpCommitBtn');
    const dirty = erp()?.hasDeferredChanges?.() || false;
    if (banner) banner.hidden = !dirty;
    if (commitBtn) {
      commitBtn.disabled = !dirty;
      commitBtn.textContent = dirty ? 'Supabase 저장 (미저장)' : 'Supabase 저장';
    }
    document.querySelectorAll('[data-lease-commit-btn]').forEach(btn => {
      btn.classList.toggle('lease-erp-commit-btn--pulse', dirty);
      btn.disabled = !dirty;
    });
  }

  async function commitLeaseErpSave() {
    if (!erp()?.hasDeferredChanges?.()) {
      showToast('저장할 변경사항이 없습니다.');
      return;
    }
    const btn = $('leaseErpCommitBtn');
    const commitBtns = document.querySelectorAll('[data-lease-commit-btn]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '저장 중…';
    }
    commitBtns.forEach(el => { el.disabled = true; });
    try {
      await erp().commitDeferredWrites({ skipFlushStorage: true });
      showToast('Supabase에 저장했습니다.');
      updateLeaseErpUnsavedBanner();
      renderContractList();
      renderDashboardKpis();
      paintDashboardVehicleOverview();
      window.BremAdminLease?.renderList?.();
    } catch (error) {
      console.error('[commitLeaseErpSave]', error);
      showToast(error?.message || '저장에 실패했습니다.');
      updateLeaseErpUnsavedBanner();
    } finally {
      if (btn) btn.textContent = 'Supabase 저장';
      updateLeaseErpUnsavedBanner();
    }
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
      return `${BremDatePicker.formatWednesdayWeekRange(start)} · 수~화 7일`;
    }
    const week = calc()?.weekRange(start) || {};
    return week.start && week.end
      ? `${formatDate(week.start)} ~ ${formatDate(week.end)} · 수~화 7일`
      : '수요일~화요일 기준';
  }

  function syncLeaseWeeklyWeekUi(weekStart) {
    const normalized = String(
      BremDatePicker?.applyWeekWednesday?.(weekStart)
      || weekStart
      || currentWeekStart()
      || ''
    ).slice(0, 10);
    if ($('leaseWeekStart')) $('leaseWeekStart').value = normalized;
    state.weekStart = normalized;
    const rangeLabel = formatLeaseWeekRangeLabel(normalized);
    if ($('leaseWeekRangePreview')) $('leaseWeekRangePreview').textContent = rangeLabel;
    if ($('leaseWeekStartLabel')) {
      if (!normalized) {
        $('leaseWeekStartLabel').textContent = '수요일 선택';
      } else if (BremDatePicker?.formatDate && BremDatePicker?.formatWeekdayKo) {
        const wednesday = BremDatePicker.applyWeekWednesday(normalized);
        const weekday = BremDatePicker.formatWeekdayKo(wednesday);
        $('leaseWeekStartLabel').textContent = weekday
          ? `${BremDatePicker.formatDate(wednesday)}(${weekday})`
          : BremDatePicker.formatDate(wednesday);
      } else {
        $('leaseWeekStartLabel').textContent = normalized;
      }
    }
    return normalized;
  }

  function handleWeeklyWeekChange(weekStart) {
    syncLeaseWeeklyWeekUi(weekStart);
    renderWeekly();
  }

  function syncLeaseDashWeekUi(weekStart) {
    const normalized = String(
      BremDatePicker?.applyWeekWednesday?.(weekStart)
      || weekStart
      || currentWeekStart()
      || ''
    ).slice(0, 10);
    if ($('leaseDashWeekStart')) $('leaseDashWeekStart').value = normalized;
    const rangeLabel = formatLeaseWeekRangeLabel(normalized);
    if ($('leaseDashWeekRangePreview')) $('leaseDashWeekRangePreview').textContent = rangeLabel;
    if ($('leaseDashWeekLabel')) {
      if (!normalized) {
        $('leaseDashWeekLabel').textContent = '수요일 선택';
      } else if (BremDatePicker?.formatDate && BremDatePicker?.formatWeekdayKo) {
        const wednesday = BremDatePicker.applyWeekWednesday(normalized);
        const weekday = BremDatePicker.formatWeekdayKo(wednesday);
        $('leaseDashWeekLabel').textContent = weekday
          ? `${BremDatePicker.formatDate(wednesday)}(${weekday})`
          : BremDatePicker.formatDate(wednesday);
      } else {
        $('leaseDashWeekLabel').textContent = normalized;
      }
    }
    return normalized;
  }

  function updateLeaseDashWeekUi() {
    const weekStart = currentWeekStart();
    syncLeaseDashWeekUi(weekStart);
    if ($('leaseWeekStart') && !$('leaseWeekStart').value) syncLeaseWeeklyWeekUi(weekStart);
    else syncLeaseWeeklyWeekUi($('leaseWeekStart')?.value || weekStart);
  }

  function handleDashboardWeekChange(weekStart) {
    const normalized = syncLeaseDashWeekUi(weekStart);
    if (normalized) {
      BremStorage?.adminPreferences?.setLeaseDashboardWeekBasis?.(normalized);
    }
    syncLeaseWeeklyWeekUi(normalized);
    renderDashboardKpis();
    void renderDashboardVehicleOverview();
    if (state.menu === 'weekly') renderWeekly();
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

  function arrearWeekStartValue(item) {
    return String(item?.unpaidWeekStart || item?.rawData?.unpaidWeekStart || '').slice(0, 10);
  }

  function formatArrearWeekLabel(weekStart) {
    const start = String(weekStart || '').slice(0, 10);
    if (!start) return '-';
    if (BremDatePicker?.formatWednesdayWeekRange) {
      return BremDatePicker.formatWednesdayWeekRange(start);
    }
    return formatLeaseWeekRangeLabel(start);
  }

  function syncArrearWeekUi(weekStart) {
    const normalized = String(
      BremDatePicker?.applyWeekWednesday?.(weekStart)
      || weekStart
      || currentWeekStart()
      || ''
    ).slice(0, 10);
    state.arrearWeekStart = normalized;
    if ($('leaseArrearWeekStart')) $('leaseArrearWeekStart').value = normalized;
    const rangeLabel = formatLeaseWeekRangeLabel(normalized);
    if ($('leaseArrearWeekRangePreview')) $('leaseArrearWeekRangePreview').textContent = rangeLabel;
    if ($('leaseArrearWeekLabel')) {
      if (!normalized) {
        $('leaseArrearWeekLabel').textContent = '미납주 선택';
      } else if (BremDatePicker?.formatDate && BremDatePicker?.formatWeekdayKo) {
        const wednesday = BremDatePicker.applyWeekWednesday(normalized);
        const weekday = BremDatePicker.formatWeekdayKo(wednesday);
        $('leaseArrearWeekLabel').textContent = weekday
          ? `${BremDatePicker.formatDate(wednesday)}(${weekday})`
          : BremDatePicker.formatDate(wednesday);
      } else {
        $('leaseArrearWeekLabel').textContent = normalized;
      }
    }
    return normalized;
  }

  function formatArrearWeeksSummary(item) {
    const entries = Array.isArray(item?.rawData?.weekEntries) ? item.rawData.weekEntries : [];
    if (entries.length) {
      return entries.map(entry => formatArrearWeekLabel(entry.weekStart)).join(', ');
    }
    return formatArrearWeekLabel(arrearWeekStartValue(item));
  }

  function handleArrearWeekChange(weekStart) {
    syncArrearWeekUi(weekStart);
    renderArrears();
  }

  async function persistLeaseFast() {
    if (!erp()) return;
    await erp().persistPending({ skipFlushStorage: true });
  }

  function markArrearContractOptionsDirty() {
    state.arrearContractOptionsDirty = true;
  }

  function refreshAfterLeaseMutation(options = {}) {
    erp()?.syncAllVehicleStatusesFromContracts?.();
    const refreshContract = options.contract !== false;
    const refreshDashboard = options.dashboard !== false;
    const refreshVehicleList = options.vehicleList !== false;
    if (refreshContract) renderContractList();
    if (refreshDashboard) {
      paintDashboardVehicleOverview();
      renderDashboardKpis();
    }
    if (refreshVehicleList) window.BremAdminLease?.renderList?.();
    if (state.menu === 'weekly') renderWeekly();
    if (state.menu === 'monthly') renderMonthly();
    if (state.menu === 'arrears') renderArrears();
    if (state.menu === 'empty') renderEmpty();
  }

  function setMenu(menu) {
    state.menu = menu;
    document.querySelectorAll('[data-lease-menu]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.leaseMenu === menu);
    });
    document.querySelectorAll('[data-lease-menu-panel]').forEach(panel => {
      panel.hidden = panel.dataset.leaseMenuPanel !== menu;
    });
    if (menu === 'arrears') {
      markArrearContractOptionsDirty();
      syncArrearWeekUi(state.arrearWeekStart || currentWeekStart());
      renderArrears();
      return;
    }
    if (menu === 'dashboard') {
      syncLeaseDashWeekUi(currentWeekStart());
      renderDashboard();
    }
    if (menu === 'weekly') renderWeekly();
    if (menu === 'monthly') renderMonthly();
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
    paintDashboardVehicleOverview();
    void renderDashboardVehicleOverview();
  }

  function renderDashboardKpis() {
    if (!erp() || !profit()) return;
    updateLeaseDashWeekUi();
    const weekStart = currentWeekStart();
    const monthKey = currentMonthKey();
    const week = calc().weekRange(weekStart);
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(calc().daysInMonth(monthKey)).padStart(2, '0')}`;

    const weekAgg = computeFleetPeriodAggregate(week.start, week.end);
    const monthAgg = computeFleetPeriodAggregate(monthStart, monthEnd);

    const vehicles = getAllDashboardVehicles();
    const setText = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };

    setText('leaseStatTotal', String(weekAgg.count || vehicles.length));
    setText('leaseKpiOperating', String(weekAgg.operatingCount));
    setText('leaseStatEmpty', String(weekAgg.emptyCount));
    setText('leaseHeroWeekExpected', formatMoney(weekAgg.expectedProfit));
    setText('leaseHeroWeekActual', formatMoney(weekAgg.actualProfit));
    setText('leaseKpiMonthExpected', formatMoney(monthAgg.expectedProfit));
    setText('leaseKpiMonthProfit', formatMoney(monthAgg.actualProfit));
    setText('leaseHeroUnpaid', formatMoney(weekAgg.unpaidAmount));
    setText('leaseHeroRecovered', formatMoney(weekAgg.recoveredAmount));
    setText('leaseHeroEmptyLoss', formatMoney(weekAgg.emptyLoss));
    setText('leaseHeroWeekProfit', formatMoney(weekAgg.netProfit));
    setText('leaseDashDeficitCount', String(weekAgg.deficitCount));
    setText('leaseKpiUnpaidCount', String(weekAgg.unpaidCount));
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
      const contract = erp()?.getLatestContractForVehicle?.(item.id) || null;
      const runtime = erp()?.resolveRuntimeStatus?.(item, contract)
        || { code: 'empty', label: '공차' };
      const code = runtime.code === 'unpaid' ? 'unpaid'
        : runtime.code === 'operating' ? 'operating' : 'empty';
      if (code === 'operating') counts.operating += 1;
      else if (code === 'unpaid') counts.unpaid += 1;
      else counts.empty += 1;
      return counts;
    }, { operating: 0, empty: 0, unpaid: 0 });
  }

  function getAllDashboardVehicles() {
    const list = erp()?.vehicles?.().getAll?.()
      || window.BremStorage?.readTableKey?.('brem_lease_vehicles')
      || window.BremStorage?.leases?.getAll?.()
      || [];
    return (Array.isArray(list) ? list : []).slice().sort((a, b) =>
      String(a.vehicleNumber || '').localeCompare(String(b.vehicleNumber || ''), 'ko')
    );
  }

  function formatInsuranceAge(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    if (/^만/.test(text) || /세$/.test(text)) return text;
    const num = text.replace(/[^\d]/g, '');
    return num ? `만${num}세` : text;
  }

  function dashVehicleSourceLabel(vehicle) {
    const owned = profit()?.VEHICLE_CATEGORIES?.COMPANY_OWNED || 'company_owned';
    return String(vehicle?.vehicleCategory || '') === owned ? '브램리스' : '회사리스';
  }

  function paintDashboardVehicleOverview() {
    const rowsEl = document.querySelector('#lease-management #leaseDashVehicleRows');
    if (!rowsEl) return;
    try {
      const vehicles = getAllDashboardVehicles();
      if (!vehicles.length) {
        rowsEl.innerHTML = '<tr><td colspan="10" class="empty">등록된 차량이 없습니다.</td></tr>';
        return;
      }

      rowsEl.innerHTML = vehicles.map((item) => {
        const contract = erp()?.getLatestContractForVehicle?.(item.id) || null;
        const driver = String(contract?.driverName || item.renter || '').trim() || '-';
        const source = dashVehicleSourceLabel(item);
        const statusHtml = renderStatusTagsHtml(item, contract);
        return `
        <tr class="lease-dash-vehicle-row">
          <td><strong>${escapeHtml(item.vehicleNumber || '-')}</strong></td>
          <td>${escapeHtml(item.model || '-')}</td>
          <td>${escapeHtml(formatInsuranceAge(item.insuranceAge))}</td>
          <td>${escapeHtml(source)}</td>
          <td>${contractDealTypeBadge(contract)}</td>
          <td>${escapeHtml(driver)}</td>
          <td>${escapeHtml(formatLeaseVehiclePeriod(item))}</td>
          <td>${escapeHtml(formatRentalContractPeriod(contract))}</td>
          <td class="lease-dash-vehicle-table__status lease-status-tags">${statusHtml}</td>
        </tr>
      `;
      }).join('');
    } catch (error) {
      console.error('[BremAdminLeaseMenus] paintDashboardVehicleOverview failed', error);
      rowsEl.innerHTML = '<tr><td colspan="10" class="empty">차량 목록을 불러오지 못했습니다.</td></tr>';
    }
  }

  async function renderDashboardVehicleOverview(options = {}) {
    if (!$('leaseDashVehicleRows')) return;
    if (options.loadRemote !== false && erp()?.ensureLoaded) {
      try {
        await erp().ensureLoaded({ syncStatuses: false });
      } catch (error) {
        console.error('[BremAdminLeaseMenus] renderDashboardVehicleOverview failed', error);
      }
    }
    erp()?.syncAllVehicleStatusesFromContracts?.();
    paintDashboardVehicleOverview();
  }

  function readCalcDraft() {
    const engine = calc();
    if (!engine) return {};
    const dailyRent = engine.money($('leaseCalcWeeklyRent')?.value);
    const vehicle = erp()?.vehicles().getById($('leaseCalcVehicleId')?.value || '');
    let emptyDailyLoss = 0;
    if (vehicle) {
      const m = profit()?.computeErpMetrics?.(vehicle) || {};
      emptyDailyLoss = m.emptyDailyLoss || m.dailyCost || m.dailyLeaseCost || 0;
    }
    return {
      vehicleId: $('leaseCalcVehicleId')?.value || '',
      dailyRent,
      weeklyRent: engine.weeklyFromDaily(dailyRent),
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
        || contractRiderDailyRent(erp()?.contracts().getByVehicleId(vehicle.id)?.[0])
        || '';
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
    await persistLeaseFast();
    showToast('손익 계산 결과가 저장되었습니다.');
    refreshAfterLeaseMutation({ contract: false, vehicleList: true });
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
          <td class="lease-actions">
            <button type="button" class="small-btn primary-btn" data-contract-empty-vehicle="${escapeHtml(item.id)}">계약 등록</button>
            <button type="button" class="small-btn" data-edit-empty-vehicle="${escapeHtml(item.id)}">수정</button>
          </td>
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

  function contractRiderDailyRent(contract) {
    if (!contract) return 0;
    const daily = Number(contract.dailyRent || 0);
    const weekly = Number(contract.weeklyRent || 0);
    if (!weekly && daily) return daily;
    if (!daily && weekly) return weekly;
    if (weekly && daily && Math.abs(weekly - daily * 7) > 1) return weekly;
    return daily || weekly;
  }

  function readContractDraft() {
    const engine = calc();
    if (!engine) return {};
    const dailyRent = engine.money($('leaseContractWeeklyRent')?.value);
    const weeklyRent = engine.weeklyFromDaily(dailyRent);
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
      driverId: $('leaseContractDriverId')?.value || '',
      startDate: $('leaseRentalDealStartDate')?.value || '',
      endDate: $('leaseRentalDealEndDate')?.value || '',
      returnDate: $('leaseContractReturnDate')?.value || '',
      dailyRent,
      weeklyRent,
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

  function syncContractReturnDateWithEndDate() {
    const returnEl = $('leaseContractReturnDate');
    const endEl = $('leaseRentalDealEndDate');
    if (!returnEl || !endEl) return;
    const snap = state.contractFormSnapshot || {};
    const newEnd = endEl.value || '';
    if (!newEnd) return;
    if (!returnEl.value || returnEl.value === snap.endDate || returnEl.value === snap.returnDate) {
      if (snap.returnDate || snap.ended) returnEl.value = newEnd;
    }
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
    setVal('leaseContractDailyRent', Math.round(draft.weeklyRent));
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
      clearLeaseContractDriverSelection();
      if ($('leaseContractDriverSearch')) $('leaseContractDriverSearch').value = '';
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
    if ($('leaseContractDriverId')) $('leaseContractDriverId').value = contract.driverId || contract.rawData?.driverId || '';
    if ($('leaseContractDriverName')) $('leaseContractDriverName').value = contract.driverName || '';
    if ($('leaseContractDriverPhone')) $('leaseContractDriverPhone').value = contract.driverPhone || '';
    const linkedDriver = contract.driverId
      ? getContractDrivers().find(item => item.id === contract.driverId)
      : null;
    updateLeaseContractDriverSelectedLabel(linkedDriver || (contract.driverName ? {
      id: contract.driverId || '',
      name: contract.driverName,
      phone: contract.driverPhone
    } : null));
    if ($('leaseRentalDealStartDate')) $('leaseRentalDealStartDate').value = contract.startDate || '';
    if ($('leaseRentalDealEndDate')) $('leaseRentalDealEndDate').value = contract.endDate || '';
    if ($('leaseContractReturnDate')) {
      $('leaseContractReturnDate').value = contract.returnDate || '';
    }
    if ($('leaseContractWeeklyRent')) {
      $('leaseContractWeeklyRent').value = contractRiderDailyRent(contract) || '';
    }
    if ($('leaseContractDeposit')) {
      $('leaseContractDeposit').value = contract.depositAmount ?? contract.penaltyFee ?? '';
    }
    if ($('leaseContractMemo')) $('leaseContractMemo').value = contract.memo || '';
    state.contractFormSnapshot = {
      endDate: contract.endDate || '',
      returnDate: contract.returnDate || '',
      ended: String(contract.status || '') === (erp()?.CONTRACT_STATUS?.ENDED || 'ended')
    };
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

  function filterContractList(contracts) {
    const keyword = String(state.contractListSearch || '').trim().toLowerCase();
    if (!keyword) return contracts;
    return contracts.filter(contract => {
      const haystack = [
        contract.driverName,
        contract.driverPhone,
        contract.vehicleNumber,
        contract.vehicleName
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    });
  }

  function renderContractList() {
    const rowsEl = $('leaseContractRows');
    if (!rowsEl || !erp()) return;
    const allContracts = erp().contracts().getAll()
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    const contracts = filterContractList(allContracts);
    const countEl = $('leaseContractListCount');
    if (countEl) {
      const filtered = contracts.length !== allContracts.length;
      countEl.textContent = filtered
        ? `전체 ${allContracts.length}건 · 검색 ${contracts.length}건`
        : `전체 ${allContracts.length}건`;
    }
    const deleting = state.contractDeleting;
    if (!contracts.length) {
      rowsEl.innerHTML = `<tr><td colspan="9" class="empty">${allContracts.length ? '검색 결과가 없습니다.' : '등록된 계약이 없습니다. 차량을 선택해 렌탈/리스자를 등록하세요.'}</td></tr>`;
      const deleteAllBtn = $('leaseContractDeleteAllBtn');
      if (deleteAllBtn) {
        deleteAllBtn.disabled = Boolean(deleting);
        deleteAllBtn.textContent = deleting === 'all' ? '삭제 중…' : '전체 삭제';
      }
      return;
    }
    rowsEl.innerHTML = contracts.map(contract => {
      const vehicle = erp().vehicles().getById(contract.vehicleId);
      const typeLabel = profit()?.vehicleSourceLabel?.(vehicle)
        || (contract.contractType === 'rental' ? '렌탈' : '리스');
      const period = [formatDate(contract.startDate), formatDate(contract.endDate)].filter(v => v !== '-').join(' ~ ') || '-';
      const returnDate = formatDate(contract.returnDate || (String(contract.status || '') === 'ended' ? contract.endDate : ''));
      const statusHtml = renderStatusTagsHtml(vehicle, contract);
      const ended = String(contract.status || '') === (erp()?.CONTRACT_STATUS?.ENDED || 'ended');
      const isDeleting = deleting && (deleting === contract.id || deleting === 'all');
      return `
        <tr class="${ended ? 'lease-contract-row--ended' : ''}">
          <td><strong>${escapeHtml(contract.vehicleNumber || vehicle?.vehicleNumber || '-')}</strong></td>
          <td>${contractDealTypeBadge(contract)} ${escapeHtml(typeLabel)}</td>
          <td>${escapeHtml(contract.driverName || '-')}</td>
          <td>${escapeHtml(contract.driverPhone || '-')}</td>
          <td>${escapeHtml(period)}</td>
          <td>${returnDate !== '-' ? escapeHtml(returnDate) : '-'}</td>
          <td>${formatMoney(contractRiderDailyRent(contract))}</td>
          <td class="lease-status-tags lease-status-tags--table">${statusHtml}${ended ? ' <span class="lease-status-badge lease-status-badge--ended">종료</span>' : ''}</td>
          <td class="lease-actions">
            <button type="button" class="small-btn" data-edit-contract="${escapeHtml(contract.id)}" ${isDeleting ? 'disabled' : ''}>수정</button>
            <button type="button" class="small-btn danger-btn" data-delete-contract="${escapeHtml(contract.id)}" ${isDeleting ? 'disabled' : ''}>${isDeleting && deleting === contract.id ? '삭제 중…' : '삭제'}</button>
          </td>
        </tr>
      `;
    }).join('');
    const deleteAllBtn = $('leaseContractDeleteAllBtn');
    if (deleteAllBtn) {
      deleteAllBtn.disabled = Boolean(deleting);
      deleteAllBtn.textContent = deleting === 'all' ? '삭제 중…' : '전체 삭제';
    }
  }

  function refreshContractViews() {
    renderContractList();
    paintDashboardVehicleOverview();
    renderDashboardKpis();
    window.BremAdminLease?.renderList?.();
  }

  function syncVehiclesAfterContractRemoval(vehicleIds = []) {
    const ids = [...new Set((vehicleIds || []).map(id => String(id || '').trim()).filter(Boolean))];
    ids.forEach(vehicleId => {
      const vehicle = erp()?.vehicles().getById(vehicleId);
      if (vehicle) erp()?.syncVehicleFromContract?.(vehicle);
    });
  }

  async function removeContracts(contractIds = []) {
    if (!erp()) return false;
    const ids = [...new Set(contractIds.map(id => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) return false;

    const vehicleIds = ids
      .map(id => erp().contracts().getById(id))
      .filter(Boolean)
      .map(contract => contract.vehicleId);

    const deletingKey = ids.length === 1 ? ids[0] : 'all';
    state.contractDeleting = deletingKey;
    renderContractList();

    try {
      if (ids.length === 1) {
        erp().contracts().removeById(ids[0]);
      } else {
        erp().contracts().removeByIds(ids);
      }

      syncVehiclesAfterContractRemoval(vehicleIds);
      markArrearContractOptionsDirty();
      if ($('leaseContractEditId')?.value && ids.includes($('leaseContractEditId').value)) {
        resetContractForm();
      }

      refreshContractViews();
      await erp().flushImmediateWrites();

      showToast(ids.length === 1 ? 'Supabase에서 계약을 삭제했습니다.' : `Supabase에서 계약 ${ids.length}건을 삭제했습니다.`);
      return true;
    } catch (error) {
      console.error('[removeContracts]', error);
      showToast(error?.message || '계약 삭제에 실패했습니다. 잠시 후 다시 시도하세요.');
      try {
        await erp().ensureLoaded?.();
        refreshContractViews();
      } catch (reloadError) {
        console.error('[removeContracts] reload failed', reloadError);
      }
      return false;
    } finally {
      state.contractDeleting = '';
      renderContractList();
    }
  }

  async function deleteContract(contractId) {
    if (!erp() || !contractId) return;
    const contract = erp().contracts().getById(contractId);
    if (!contract) return;
    const vehicle = erp().vehicles().getById(contract.vehicleId);
    const plate = contract.vehicleNumber || vehicle?.vehicleNumber || '-';
    const name = contract.driverName || '-';
    if (!window.confirm(`계약을 삭제하시겠습니까?\n${plate} · ${name}`)) return;
    await removeContracts([contractId]);
  }

  async function deleteAllContracts() {
    if (!erp()) return;
    const contracts = erp().contracts().getAll();
    if (!contracts.length) {
      showToast('삭제할 계약이 없습니다.');
      return;
    }
    if (!window.confirm(`등록된 계약 ${contracts.length}건을 모두 삭제하시겠습니까?\n되돌릴 수 없습니다.`)) return;
    await removeContracts(contracts.map(contract => contract.id));
  }

  async function saveContract(event) {
    event?.preventDefault?.();
    if (!erp()) return;
    const draft = readContractDraft();
    if (!draft.vehicleId) {
      showToast('차량관리에 등록된 차량을 선택하세요.');
      return;
    }
    if (!String(draft.driverId || '').trim() && !String(draft.driverName || '').trim()) {
      showToast('등록 기사를 검색해서 선택하세요.');
      return;
    }

    const vehicle = erp().vehicles().getById(draft.vehicleId);
    if (!vehicle) {
      showToast('선택한 차량을 찾을 수 없습니다.');
      return;
    }

    const saveBtn = $('leaseContractSaveBtn');
    if (state.contractSaving) return;
    state.contractSaving = true;
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '저장 중…';
    }

    try {
      const statusPatch = erp().resolveContractStatusOnSave?.(draft, vehicle) || {};
      const contractPayload = {
        ...draft,
        ...statusPatch,
        vehicleId: vehicle.id
      };

      erp().vehicles().update(vehicle.id, {
        renter: draft.driverName,
        lesseePhone: draft.driverPhone,
        dailyChargeAmount: draft.dailyRent,
        unpaidDays: 0,
        unpaidAmount: 0
      });

      const contract = draft.id
        ? erp().contracts().update(draft.id, contractPayload)
        : erp().contracts().create(contractPayload);

      const freshVehicle = erp().vehicles().getById(vehicle.id);
      erp().syncVehicleFromContract?.(freshVehicle, contract);

      if ($('leaseContractReturnDate')) {
        $('leaseContractReturnDate').value = contract.returnDate || '';
      }
      if ($('leaseRentalDealEndDate') && contract.endDate) {
        $('leaseRentalDealEndDate').value = contract.endDate;
      }

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

      markArrearContractOptionsDirty();

      $('leaseContractEditId').value = contract.id;
      fillContractForm(contract);
      showToast('계약이 목록에 반영되었습니다. Supabase 저장 버튼을 눌러 주세요.');
      updateLeaseErpUnsavedBanner();
      renderContractList();
      refreshAfterLeaseMutation({ contract: false });
      document.querySelector('.lease-contract-list-wrap')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      console.error('[saveContract]', error);
      showToast(error?.message || '계약 저장에 실패했습니다. 잠시 후 다시 시도하세요.');
    } finally {
      state.contractSaving = false;
      const saveBtn = $('leaseContractSaveBtn');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '목록에 반영';
      }
    }
  }

  async function processEarlyReturn() {
    if (!erp()) return;
    const draft = readContractDraft();
    if (!draft.vehicleId) {
      showToast('차량을 선택하세요.');
      return;
    }
    if (!String(draft.driverName || '').trim()) {
      showToast('렌탈/리스자를 선택하세요.');
      return;
    }
    const returnDate = normalizeContractDate($('leaseContractReturnDate')?.value || contractTodayKey());
    if (!returnDate) {
      showToast('반납일을 입력하세요.');
      return;
    }
    const vehicle = erp().vehicles().getById(draft.vehicleId);
    if (!vehicle) {
      showToast('선택한 차량을 찾을 수 없습니다.');
      return;
    }
    const plate = draft.vehicleNumber || vehicle.vehicleNumber || '-';
    const name = draft.driverName || '-';
    if (!window.confirm(`중도반납 · 계약종료 처리하시겠습니까?\n${plate} · ${name}\n반납일: ${returnDate}`)) return;

    const endedStatus = erp().CONTRACT_STATUS?.ENDED || 'ended';
    const activeStatus = erp().CONTRACT_STATUS?.ACTIVE || 'active';
    const today = contractTodayKey();
    const statusPatch = erp().resolveContractStatusOnSave?.({
      ...draft,
      returnDate,
      endDate: returnDate
    }, vehicle) || {
      endDate: returnDate,
      returnDate,
      status: returnDate <= today ? endedStatus : activeStatus
    };
    const payload = {
      ...draft,
      ...statusPatch,
      endDate: statusPatch.endDate || returnDate,
      returnDate: statusPatch.returnDate || returnDate
    };

    try {
      const contract = draft.id
        ? erp().contracts().update(draft.id, { ...payload, vehicleId: vehicle.id })
        : erp().contracts().create({ ...payload, vehicleId: vehicle.id });

      const freshVehicle = erp().vehicles().getById(vehicle.id);
      erp().syncVehicleFromContract?.(freshVehicle, contract);

      $('leaseContractEditId').value = contract.id;
      if ($('leaseRentalDealEndDate')) $('leaseRentalDealEndDate').value = returnDate;
      if ($('leaseContractReturnDate')) $('leaseContractReturnDate').value = returnDate;

      markArrearContractOptionsDirty();
      updateLeaseErpUnsavedBanner();
      renderContractList();
      refreshAfterLeaseMutation({ contract: false });
      showToast(returnDate <= today
        ? `중도반납 처리 · 반납일 ${returnDate} · 계약 종료 (Supabase 저장 필요)`
        : `반납 예약 · ${returnDate}까지 운행 중 (Supabase 저장 필요)`);
      syncContractCalc();
    } catch (error) {
      console.error('[processEarlyReturn]', error);
      showToast(error?.message || '중도반납 처리에 실패했습니다.');
    }
  }

  function normalizeContractDate(value) {
    return erp()?.vehicles()?.normalizeDate?.(value) || String(value || '').trim().slice(0, 10);
  }

  function endContractAsEmpty() {
    void processEarlyReturn();
  }

  function resetContractForm() {
    $('leaseContractForm')?.reset();
    $('leaseContractEditId').value = '';
    state.contractDriverSearch = '';
    clearLeaseContractDriverSelection();
    if ($('leaseContractDriverSearch')) $('leaseContractDriverSearch').value = '';
    if ($('leaseContractDriverResults')) {
      $('leaseContractDriverResults').hidden = true;
      $('leaseContractDriverResults').innerHTML = '';
    }
    document.querySelectorAll('input[name="leaseContractDealType"]').forEach(input => {
      input.checked = input.value === 'lease';
    });
    if ($('leaseContractDeposit')) $('leaseContractDeposit').value = '';
    if ($('leaseContractReturnDate')) $('leaseContractReturnDate').value = '';
    syncContractCalc();
  }

  function buildPeriodRow(vehicle, periodStart, periodEnd, periodDays) {
    const contract = erp()?.getLatestContractForVehicle?.(vehicle?.id) || null;
    const metrics = computeVehiclePeriodMetrics(vehicle, periodStart, periodEnd);
    const runtimeTags = erp()?.resolveVehicleStatusTags?.(vehicle, contract) || [];
    const statusLabel = runtimeTags.map(tag => tag.label).join(' · ') || '-';
    return {
      vehicleId: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber || '-',
      vehicleName: vehicle.model || '-',
      driverName: contract?.driverName || vehicle.renter || '-',
      rentalDays: metrics.rentalDays,
      emptyDays: metrics.emptyDays,
      unpaidDays: metrics.unpaidDays,
      rentalRevenue: metrics.rentalRevenue,
      recoveredAmount: metrics.recoveredAmount,
      emptyLoss: metrics.emptyLoss,
      unpaidAmount: metrics.unpaidAmount,
      insuranceCost: metrics.insuranceCost,
      leaseCost: metrics.leaseCost,
      maintenanceCost: metrics.maintenanceCost,
      accidentCost: metrics.accidentCost,
      totalCost: metrics.totalCost,
      expectedProfit: metrics.expectedProfit,
      netProfit: metrics.netProfit,
      isDeficit: metrics.isDeficit,
      statusLabel,
      contractId: contract?.id || ''
    };
  }

  function getWeeklyDeletableLogIds() {
    return (state.weeklyVisibleLogIds || []).filter(Boolean);
  }

  function updateWeeklySelectionUi() {
    const visible = getWeeklyDeletableLogIds();
    const selectedVisible = visible.filter(id => state.weeklySelectedLogIds.has(id));
    const selectAll = $('leaseWeeklySelectAll');
    const bulkDelete = $('leaseWeeklyBulkDelete');
    if (selectAll) {
      selectAll.checked = visible.length > 0 && selectedVisible.length === visible.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
      selectAll.disabled = visible.length === 0;
    }
    if (bulkDelete) {
      bulkDelete.disabled = selectedVisible.length === 0;
      bulkDelete.textContent = selectedVisible.length
        ? `선택 삭제 (${selectedVisible.length})`
        : '선택 삭제';
    }
  }

  function getMonthlyDeletableLogIds() {
    return (state.monthlyVisibleLogIds || []).filter(Boolean);
  }

  function updateMonthlySelectionUi() {
    const visible = getMonthlyDeletableLogIds();
    const selectedVisible = visible.filter(id => state.monthlySelectedLogIds.has(id));
    const selectAll = $('leaseMonthlySelectAll');
    const bulkDelete = $('leaseMonthlyBulkDelete');
    const deleteAllBtn = $('leaseMonthlyDeleteAllBtn');
    if (selectAll) {
      selectAll.checked = visible.length > 0 && selectedVisible.length === visible.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
      selectAll.disabled = visible.length === 0;
    }
    if (bulkDelete) {
      bulkDelete.disabled = selectedVisible.length === 0;
      bulkDelete.textContent = selectedVisible.length
        ? `선택 삭제 (${selectedVisible.length})`
        : '선택 삭제';
    }
    if (deleteAllBtn) {
      deleteAllBtn.disabled = visible.length === 0;
      deleteAllBtn.textContent = visible.length
        ? `해당 월 전체 삭제 (${visible.length})`
        : '해당 월 전체 삭제';
    }
  }

  function renderWeekly() {
    const rowsEl = $('leaseWeeklyRows');
    if (!rowsEl || !erp()) return;
    const weekStart = $('leaseWeekStart')?.value || state.weekStart || currentWeekStart();
    state.weekStart = weekStart;
    const week = calc().weekRange(weekStart);
    syncLeaseWeeklyWeekUi(weekStart);

    const vehicles = erp().vehicles().getAll()
      .slice()
      .sort((a, b) => String(a.vehicleNumber || '').localeCompare(String(b.vehicleNumber || ''), 'ko'));
    const rows = vehicles.map(vehicle => ({
      ...buildPeriodRow(vehicle, week.start, week.end, 7),
      logId: ''
    }));

    const totals = calc().aggregateFleetPeriodMetrics(rows);
    const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    setText('leaseWeekTotalVehicles', `${totals.count}대`);
    setText('leaseWeekOperating', `${totals.operatingCount}대`);
    setText('leaseWeekEmpty', `${totals.emptyCount}대`);
    setText('leaseWeekRevenue', formatMoney(totals.rentalRevenue));
    setText('leaseWeekEmptyLoss', formatMoney(totals.emptyLoss));
    setText('leaseWeekUnpaid', formatMoney(totals.unpaidAmount));
    setText('leaseWeekCost', formatMoney(totals.totalCost));
    setText('leaseWeekNet', formatMoney(totals.netProfit));
    setText('leaseWeekDeficit', `${totals.deficitCount}대`);

    state.weeklyVisibleLogIds = rows.map(row => row.logId).filter(Boolean);
    state.weeklySelectedLogIds = new Set(
      [...state.weeklySelectedLogIds].filter(id => state.weeklyVisibleLogIds.includes(id))
    );

    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="14" class="empty">해당 주간 데이터가 없습니다.</td></tr>';
      updateWeeklySelectionUi();
      return;
    }

    rowsEl.innerHTML = rows.map(row => {
      const vehicle = erp().vehicles().getById(row.vehicleId);
      const contract = erp()?.getLatestContractForVehicle?.(row.vehicleId) || null;
      const statusHtml = renderStatusTagsHtml(vehicle, contract);
      return `
      <tr${row.logId && state.weeklySelectedLogIds.has(row.logId) ? ' class="row-selected"' : ''}>
        <td>${row.logId
          ? `<input type="checkbox" data-select-weekly-profit-log="${escapeHtml(row.logId)}" ${state.weeklySelectedLogIds.has(row.logId) ? 'checked' : ''}>`
          : ''}</td>
        <td><strong>${escapeHtml(row.vehicleNumber)}</strong></td>
        <td>${escapeHtml(row.vehicleName)}</td>
        <td>${escapeHtml(row.driverName)}</td>
        <td class="lease-weekly-days lease-weekly-days--rental">${row.rentalDays || 0}일</td>
        <td class="lease-weekly-days lease-weekly-days--empty">${row.emptyDays || 0}일</td>
        <td class="lease-weekly-days lease-weekly-days--unpaid">${row.unpaidDays || 0}일</td>
        <td>${formatMoney(row.rentalRevenue)}</td>
        <td class="lease-money--warning">${formatMoney(row.emptyLoss)}</td>
        <td class="lease-money--warning">${formatMoney(row.unpaidAmount)}</td>
        <td>${formatMoney((row.insuranceCost || 0) + (row.leaseCost || 0) + (row.maintenanceCost || 0) + (row.accidentCost || 0))}</td>
        <td class="${moneyClass(row.netProfit)}"><strong>${formatMoney(row.netProfit)}</strong></td>
        <td class="lease-status-tags lease-status-tags--table">${statusHtml}</td>
        <td>${row.logId ? `<button type="button" class="small-btn danger-btn" data-delete-profit-log="${escapeHtml(row.logId)}">삭제</button>` : '-'}</td>
      </tr>
    `;
    }).join('');
    updateWeeklySelectionUi();
  }

  function renderMonthly() {
    const rowsEl = $('leaseMonthlyRows');
    if (!rowsEl || !erp()) return;
    const monthKey = $('leaseMonthKey')?.value || state.monthKey || currentMonthKey();
    state.monthKey = monthKey;
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(calc().daysInMonth(monthKey)).padStart(2, '0')}`;

    const vehicles = erp().vehicles().getAll()
      .slice()
      .sort((a, b) => String(a.vehicleNumber || '').localeCompare(String(b.vehicleNumber || ''), 'ko'));
    const rows = vehicles.map(vehicle => {
      const row = buildPeriodRow(vehicle, monthStart, monthEnd);
      return {
        ...row,
        recoveredAmount: row.recoveredAmount || 0,
        memo: '',
        logId: ''
      };
    });

    state.monthlyVisibleLogIds = rows.map(row => row.logId).filter(Boolean);
    state.monthlySelectedLogIds = new Set(
      [...state.monthlySelectedLogIds].filter(id => state.monthlyVisibleLogIds.includes(id))
    );

    const totals = calc().aggregateFleetPeriodMetrics(rows.map(row => ({
      rentalRevenue: row.rentalRevenue,
      recoveredAmount: row.recoveredAmount,
      unpaidAmount: row.unpaidAmount,
      emptyLoss: row.emptyLoss,
      totalCost: row.totalCost,
      expectedProfit: row.expectedProfit,
      actualProfit: row.netProfit,
      netProfit: row.netProfit,
      isDeficit: row.isDeficit,
      isOperating: row.rentalDays > 0,
      isEmpty: row.emptyDays > 0 && !row.rentalDays,
      hasUnpaid: row.unpaidDays > 0 || row.unpaidAmount > 0
    })));
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
      rowsEl.innerHTML = '<tr><td colspan="15" class="empty">해당 월 데이터가 없습니다.</td></tr>';
      updateMonthlySelectionUi();
      return;
    }

    rowsEl.innerHTML = rows.map(row => `
      <tr${row.logId && state.monthlySelectedLogIds.has(row.logId) ? ' class="row-selected"' : ''}>
        <td>${row.logId
          ? `<input type="checkbox" data-select-monthly-profit-log="${escapeHtml(row.logId)}" ${state.monthlySelectedLogIds.has(row.logId) ? 'checked' : ''}>`
          : ''}</td>
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
        <td>${row.logId ? `<button type="button" class="small-btn danger-btn" data-delete-profit-log="${escapeHtml(row.logId)}">삭제</button>` : '-'}</td>
      </tr>
    `).join('');
    updateMonthlySelectionUi();
  }

  function fillArrearContractSelect(force = false) {
    const select = $('leaseArrearContractId');
    if (!select || !erp()) return;
    if (!force && !state.arrearContractOptionsDirty && select.options.length > 1 && !state.arrearDriverSearch) return;
    const vehicles = new Map(erp().vehicles().getAll().map(item => [item.id, item]));
    const keyword = String(state.arrearDriverSearch || '').trim().toLowerCase();
    let contracts = erp().contracts().getAll()
      .filter(item => item.vehicleId && vehicles.has(item.vehicleId))
      .sort((a, b) => String(a.driverName || '').localeCompare(String(b.driverName || ''), 'ko'));
    if (keyword) {
      contracts = contracts.filter(contract => {
        const vehicle = vehicles.get(contract.vehicleId);
        const haystack = [
          contract.driverName,
          contract.driverPhone,
          vehicle?.vehicleNumber,
          vehicle?.model,
          vehicle?.renter
        ].join(' ').toLowerCase();
        return haystack.includes(keyword);
      });
    }
    const current = select.value;
    select.innerHTML = '<option value="">기사 선택</option>' + contracts.map(contract => {
      const vehicle = vehicles.get(contract.vehicleId);
      const label = [
        contract.driverName || vehicle?.renter || '기사',
        vehicle?.vehicleNumber || '',
        vehicle?.model || ''
      ].filter(Boolean).join(' · ');
      return `<option value="${escapeHtml(contract.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    if (current && contracts.some(item => item.id === current)) select.value = current;
    state.arrearContractOptionsDirty = false;
  }

  function readArrearCollectionMethods() {
    return [...document.querySelectorAll('input[name="leaseArrearMethod"]:checked')]
      .map(input => input.value)
      .filter(Boolean);
  }

  function hideArrearCompletePanel() {
    const card = $('leaseArrearCompleteCard');
    if (card) card.hidden = true;
    if ($('leaseArrearCompleteId')) $('leaseArrearCompleteId').value = '';
    if ($('leaseArrearRecoveredAmount')) $('leaseArrearRecoveredAmount').value = '';
    if ($('leaseArrearCompleteMemo')) $('leaseArrearCompleteMemo').value = '';
  }

  function showArrearCompletePanel(item) {
    if (!item) return;
    const card = $('leaseArrearCompleteCard');
    if (card) card.hidden = false;
    if ($('leaseArrearCompleteId')) $('leaseArrearCompleteId').value = item.id;
    if ($('leaseArrearRecoveredAmount')) {
      $('leaseArrearRecoveredAmount').value = String(item.unpaidAmount || 0);
    }
    if ($('leaseArrearCompleteMemo')) $('leaseArrearCompleteMemo').value = '';
    card?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  async function registerArrear(event) {
    event?.preventDefault?.();
    if (!erp()) return;
    const contractId = String($('leaseArrearContractId')?.value || '').trim();
    const unpaidDays = Math.max(0, Math.round(Number($('leaseArrearUnpaidDays')?.value || 0)));
    const unpaidAmount = Math.max(0, Math.round(Number($('leaseArrearUnpaidAmount')?.value || 0)));
    const collectionMethods = readArrearCollectionMethods();
    if (!contractId) {
      showToast('계약 기사를 선택하세요.');
      return;
    }
    if (!unpaidDays && !unpaidAmount) {
      showToast('미납일 또는 미납금을 입력하세요.');
      return;
    }
    if (!collectionMethods.length) {
      showToast('회수방법을 선택하세요.');
      return;
    }
    const unpaidWeekStart = syncArrearWeekUi($('leaseArrearWeekStart')?.value || state.arrearWeekStart);
    if (!unpaidWeekStart) {
      showToast('미납주를 선택하세요.');
      return;
    }
    const contract = erp().contracts().getById(contractId);
    if (!contract) {
      showToast('계약 정보를 찾을 수 없습니다.');
      return;
    }
    const completed = calc().ARREAR_STATUS.COMPLETED;
    const openForContract = erp().arrears().getAll().find(item =>
      item.contractId === contractId && String(item.collectionStatus || '') !== completed
    );
    const weekEntry = {
      weekStart: unpaidWeekStart,
      unpaidDays,
      unpaidAmount,
      at: new Date().toISOString()
    };
    if (openForContract) {
      const weekEntries = Array.isArray(openForContract.rawData?.weekEntries)
        ? [...openForContract.rawData.weekEntries]
        : [];
      weekEntries.push(weekEntry);
      erp().arrears().update(openForContract.id, {
        unpaidDays: Number(openForContract.unpaidDays || 0) + unpaidDays,
        unpaidAmount: Number(openForContract.unpaidAmount || 0) + unpaidAmount,
        collectionMethods: [...new Set([...(openForContract.collectionMethods || []), ...collectionMethods])],
        collectionStatus: calc().ARREAR_STATUS.COLLECTING,
        rawData: {
          ...(openForContract.rawData || {}),
          unpaidWeekStart: openForContract.rawData?.unpaidWeekStart || unpaidWeekStart,
          weekEntries
        }
      });
    } else {
      erp().arrears().create({
        vehicleId: contract.vehicleId,
        contractId: contract.id,
        unpaidDays,
        unpaidAmount,
        unpaidWeekStart,
        collectionMethods,
        collectionStatus: calc().ARREAR_STATUS.COLLECTING,
        rawData: {
          unpaidWeekStart,
          weekEntries: [weekEntry]
        }
      });
    }
    const registerBtn = $('leaseArrearRegisterBtn');
    if (registerBtn) {
      registerBtn.disabled = true;
      registerBtn.textContent = '등록 중…';
    }
    try {
      const savedWeek = state.arrearWeekStart;
      $('leaseArrearRegisterForm')?.reset();
      syncArrearWeekUi(savedWeek);
      updateLeaseErpUnsavedBanner();
      showToast(openForContract ? '미납이 누적 등록되었습니다.' : '미납을 등록했습니다.');
      renderArrears();
      refreshAfterLeaseMutation({ contract: false });
    } finally {
      if (registerBtn) {
        registerBtn.disabled = false;
        registerBtn.textContent = '미납 등록';
      }
    }
  }

  function renderArrearHistory(list, vehicles) {
    const rowsEl = $('leaseArrearHistoryRows');
    if (!rowsEl) return;
    const completed = list
      .filter(item => item.collectionStatus === calc().ARREAR_STATUS.COMPLETED)
      .sort((a, b) => String(b.processedDate || b.updatedAt || '').localeCompare(String(a.processedDate || a.updatedAt || '')));
    if (!completed.length) {
      rowsEl.innerHTML = '<tr><td colspan="10" class="empty">처리 이력이 없습니다.</td></tr>';
      return;
    }
    rowsEl.innerHTML = completed.map(item => {
      const vehicle = vehicles.get(item.vehicleId);
      const contract = item.contractId ? erp().contracts().getById(item.contractId) : null;
      const methods = (item.collectionMethods || []).map(calc().collectionMethodLabel).join(', ') || '-';
      const history = Array.isArray(item.rawData?.processingHistory) ? item.rawData.processingHistory : [];
      const latest = history[0] || {};
      const memo = latest.memo || item.memo || '-';
      const driver = contract?.driverName || vehicle?.renter || '-';
      const plate = vehicle?.vehicleNumber || '-';
      return `
        <tr>
          <td>${escapeHtml(plate)}</td>
          <td>${escapeHtml(driver)}</td>
          <td>${escapeHtml(formatArrearWeeksSummary(item))}</td>
          <td>${item.unpaidDays}일</td>
          <td class="lease-money--warning">${formatMoney(item.unpaidAmount + (item.recoveredAmount || item.paidAmount || 0))}</td>
          <td>${formatMoney(item.recoveredAmount || item.paidAmount || 0)}</td>
          <td>${escapeHtml(methods)}</td>
          <td>${formatDate(item.processedDate)}</td>
          <td>${escapeHtml(memo)}</td>
          <td>
            <button type="button" class="small-btn danger-btn" data-delete-arrear-history="${escapeHtml(item.id)}" data-arrear-plate="${escapeHtml(plate)}" data-arrear-driver="${escapeHtml(driver)}">삭제</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function deleteArrearRecord(id, options = {}) {
    if (!erp() || !id) return;
    const item = erp().arrears().getById(id);
    if (!item) return;
    const vehicle = erp().vehicles().getById(item.vehicleId);
    const contract = item.contractId ? erp().contracts().getById(item.contractId) : null;
    const plate = vehicle?.vehicleNumber || options.plate || '-';
    const driver = contract?.driverName || vehicle?.renter || options.driver || '-';
    const isHistory = String(item.collectionStatus || '') === calc().ARREAR_STATUS.COMPLETED;
    const label = isHistory ? '처리 이력' : '미납 기록';
    if (!window.confirm(`${label}을 삭제할까요?\n${plate} · ${driver}`)) return;
    void (async () => {
      try {
        erp().arrears().removeById(id);
        await erp().flushImmediateWrites();
        updateLeaseErpUnsavedBanner();
        renderArrears();
        renderDashboardKpis();
        paintDashboardVehicleOverview();
        showToast(`Supabase에서 ${label}을 삭제했습니다.`);
      } catch (error) {
        console.error('[deleteArrearRecord]', error);
        showToast(error?.message || '삭제에 실패했습니다.');
      }
    })();
  }

  function renderArrears() {
    const rowsEl = $('leaseArrearRows');
    if (!rowsEl || !erp()) return;
    fillArrearContractSelect(state.arrearContractOptionsDirty);
    syncArrearWeekUi(state.arrearWeekStart || $('leaseArrearWeekStart')?.value || currentWeekStart());
    const list = erp().arrears().getAll();
    const vehicles = new Map(erp().vehicles().getAll().map(item => [item.id, item]));
    const active = list.filter(item => item.collectionStatus !== calc().ARREAR_STATUS.COMPLETED);
    renderArrearHistory(list, vehicles);
    if (!active.length) {
      rowsEl.innerHTML = '<tr><td colspan="11" class="empty">진행 중인 미납 기록이 없습니다.</td></tr>';
      return;
    }
    rowsEl.innerHTML = active.map(item => {
      const vehicle = vehicles.get(item.vehicleId);
      const contract = item.contractId ? erp().contracts().getById(item.contractId) : null;
      const methods = (item.collectionMethods || []).map(calc().collectionMethodLabel).join(', ') || '-';
      const status = calc().arrearsStatusLabel(item.collectionStatus);
      const statusCls = item.collectionStatus === calc().ARREAR_STATUS.COLLECTING
        ? 'lease-status--collecting'
        : 'lease-status--unpaid';
      const weekCount = Array.isArray(item.rawData?.weekEntries) ? item.rawData.weekEntries.length : 1;
      const remaining = Math.max(0, Number(item.unpaidAmount || 0));
      return `
        <tr>
          <td>${escapeHtml(vehicle?.vehicleNumber || '-')}</td>
          <td>${escapeHtml(vehicle?.model || '-')}</td>
          <td>${escapeHtml(contract?.driverName || vehicle?.renter || '-')}</td>
          <td>${escapeHtml(formatArrearWeeksSummary(item))}${weekCount > 1 ? ` <em class="lease-arrear-week-count">(${weekCount}주)</em>` : ''}</td>
          <td>${item.unpaidDays}일</td>
          <td class="lease-money--warning">${formatMoney(remaining)}</td>
          <td>${formatMoney(item.paidAmount)}</td>
          <td class="lease-arrear-partial-cell">
            <input type="number" class="lease-arrear-partial-input" data-arrear-partial-input="${escapeHtml(item.id)}" min="0" step="1" placeholder="금액" value="">
            <button type="button" class="small-btn" data-partial-arrear="${escapeHtml(item.id)}">회수</button>
          </td>
          <td>${escapeHtml(methods)}</td>
          <td><span class="${statusCls}">${escapeHtml(status)}</span></td>
          <td>
            <button type="button" class="small-btn primary-btn" data-complete-arrear="${escapeHtml(item.id)}">전액완료</button>
            <button type="button" class="small-btn danger-btn" data-delete-arrear="${escapeHtml(item.id)}">삭제</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function recordPartialArrearRecovery(id) {
    if (!erp() || !id) return;
    const item = erp().arrears().getById(id);
    if (!item) return;
    const input = document.querySelector(`[data-arrear-partial-input="${CSS.escape(id)}"]`);
    const amount = Math.max(0, Math.round(Number(input?.value || 0)));
    if (!amount) {
      showToast('회수 금액을 입력하세요.');
      input?.focus();
      return;
    }
    const remainingBefore = Math.max(0, Number(item.unpaidAmount || 0));
    if (amount > remainingBefore) {
      showToast(`회수 금액이 미납 잔액(${formatMoney(remainingBefore)})을 초과합니다.`);
      return;
    }
    const remaining = remainingBefore - amount;
    const history = Array.isArray(item.rawData?.processingHistory) ? [...item.rawData.processingHistory] : [];
    history.unshift({
      at: new Date().toISOString(),
      type: 'partial',
      recoveredAmount: amount,
      remainingAmount: remaining,
      processedDate: BremLeaseProfit.todayKey()
    });
    const completed = calc().ARREAR_STATUS.COMPLETED;
    const collecting = calc().ARREAR_STATUS.COLLECTING;
    erp().arrears().update(id, {
      paidAmount: Number(item.paidAmount || 0) + amount,
      recoveredAmount: Number(item.recoveredAmount || 0) + amount,
      unpaidAmount: remaining,
      collectionStatus: remaining > 0 ? collecting : completed,
      processedDate: remaining > 0 ? item.processedDate : BremLeaseProfit.todayKey(),
      rawData: { ...(item.rawData || {}), processingHistory: history }
    });
    if (item.contractId && remaining === 0) {
      erp().contracts().update(item.contractId, {
        collectionStatus: completed,
        recoveredAmount: Number(item.recoveredAmount || 0) + amount,
        unpaidDays: 0,
        unpaidAmount: 0,
        processedDate: BremLeaseProfit.todayKey()
      });
    }
    updateLeaseErpUnsavedBanner();
    showToast(remaining > 0
      ? `일부 회수 ${formatMoney(amount)} · 잔액 ${formatMoney(remaining)}`
      : `전액 회수 완료 (${formatMoney(amount)})`);
    renderArrears();
    refreshAfterLeaseMutation({ contract: false });
  }

  async function deleteProfitLogs(ids = []) {
    if (!erp()) return;
    const idList = [...new Set((ids || []).map(value => String(value || '').trim()).filter(Boolean))];
    if (!idList.length) return;
    const message = idList.length === 1
      ? '이 수익 기록을 삭제할까요?'
      : `선택한 ${idList.length}건의 수익 기록을 삭제할까요?`;
    if (!window.confirm(message)) return;
    if (idList.length === 1) erp().profitLogs().removeById(idList[0]);
    else erp().profitLogs().removeByIds(idList);
    await persistLeaseFast();
    idList.forEach(id => {
      state.weeklySelectedLogIds.delete(id);
      state.monthlySelectedLogIds.delete(id);
    });
    showToast(idList.length === 1 ? '수익 기록을 삭제했습니다.' : `${idList.length}건의 수익 기록을 삭제했습니다.`);
    if (state.menu === 'weekly') renderWeekly();
    if (state.menu === 'monthly') renderMonthly();
    renderDashboardKpis();
  }

  async function deleteAllMonthlyProfitLogs() {
    const ids = getMonthlyDeletableLogIds();
    if (!ids.length) {
      showToast('삭제할 월간 수익 기록이 없습니다.');
      return;
    }
    const monthKey = $('leaseMonthKey')?.value || state.monthKey || currentMonthKey();
    if (!window.confirm(`${monthKey} 월간 수익 기록 ${ids.length}건을 모두 삭제할까요?`)) return;
    await deleteProfitLogs(ids);
  }

  async function deleteProfitLog(id) {
    await deleteProfitLogs([id]);
  }

  async function completeArrear(id) {
    if (!erp()) return;
    const item = erp().arrears().getById(id);
    if (!item) return;
    showArrearCompletePanel(item);
  }

  async function confirmCompleteArrear() {
    if (!erp()) return;
    const id = String($('leaseArrearCompleteId')?.value || '').trim();
    const item = erp().arrears().getById(id);
    if (!item) return;
    const recovered = Math.max(0, Math.round(Number($('leaseArrearRecoveredAmount')?.value || 0)));
    const memo = String($('leaseArrearCompleteMemo')?.value || '').trim();
    const history = Array.isArray(item.rawData?.processingHistory) ? [...item.rawData.processingHistory] : [];
    history.unshift({
      at: new Date().toISOString(),
      recoveredAmount: recovered,
      collectionMethods: [...(item.collectionMethods || [])],
      memo,
      processedDate: BremLeaseProfit.todayKey()
    });
    erp().arrears().update(id, {
      collectionStatus: calc().ARREAR_STATUS.COMPLETED,
      processedDate: BremLeaseProfit.todayKey(),
      recoveredAmount: recovered,
      unpaidAmount: Math.max(0, item.unpaidAmount - recovered),
      paidAmount: item.paidAmount + recovered,
      memo,
      rawData: { ...(item.rawData || {}), processingHistory: history }
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
    hideArrearCompletePanel();
    updateLeaseErpUnsavedBanner();
    showToast('미납 처리가 완료되었습니다.');
    renderArrears();
    refreshAfterLeaseMutation({ contract: false });
  }

  function normalizeBulkHeaderCell(value) {
    return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
  }

  function normalizeBulkErpMode(value) {
    const text = normalizeBulkHeaderCell(value);
    if (!text) return 'company_lease_rental';
    if (/회사소유|브램|companyowned|owned/.test(text)) return 'company_owned';
    return 'company_lease_rental';
  }

  function normalizeBulkContractType(value) {
    const text = String(value || '').trim();
    if (/렌탈|rental/i.test(text)) return 'rental';
    return 'lease';
  }

  function erpModeLabel(value) {
    return value === 'company_owned' ? '회사소유리스' : '회사리스';
  }

  function findBulkVehicleHeaderRow(rows) {
    for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
      const headers = (rows[index] || []).map(normalizeBulkHeaderCell);
      const hasCompany = headers.some(h => h.includes('회사구분') || h.includes('erp구분'));
      const hasVehicleKey = headers.some(h =>
        h.includes('차량번호') || h.includes('번호판') || h.includes('차대번호') || h.includes('기종')
      );
      if (hasCompany && hasVehicleKey) return index;
    }
    return rows.some(row => row?.some(cell => String(cell || '').trim())) ? 0 : -1;
  }

  function buildBulkVehicleColumnMap(headerRow) {
    const map = {};
    const normalizedHeaders = (headerRow || []).map(normalizeBulkHeaderCell);
    BULK_VEHICLE_COLUMNS.forEach(column => {
      const aliases = [column.label, ...(column.aliases || [])].map(normalizeBulkHeaderCell);
      const index = normalizedHeaders.findIndex(header => aliases.includes(header));
      if (index >= 0) map[column.key] = index;
    });
    if (Object.keys(map).length < 4) {
      BULK_VEHICLE_COLUMNS.forEach((column, index) => {
        if (map[column.key] == null) map[column.key] = index;
      });
    }
    return map;
  }

  function readBulkVehicleCell(row, columnMap, key) {
    const index = columnMap[key];
    return index != null ? row[index] : '';
  }

  function parseBulkVehicleRow(row, columnMap, rowNumber) {
    const store = erp()?.vehicles?.();
    const readMoney = (value) => {
      if (store?.normalizeMoney) return store.normalizeMoney(value);
      const num = Number(String(value || '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(num) ? Math.round(num) : 0;
    };
    const readDate = value => store?.normalizeDate?.(value) || String(value || '').trim().slice(0, 10);
    const readText = value => String(value ?? '').trim();

    const erpMode = normalizeBulkErpMode(readBulkVehicleCell(row, columnMap, 'erpMode'));
    const contractType = normalizeBulkContractType(readBulkVehicleCell(row, columnMap, 'contractType'));
    const vehicleCategory = erpMode === 'company_owned' ? 'company_owned' : 'external_lease';
    const data = {
      vehicleCategory,
      contractType,
      operationType: contractType,
      model: readText(readBulkVehicleCell(row, columnMap, 'model')),
      chassisNumber: readText(readBulkVehicleCell(row, columnMap, 'chassisNumber')),
      vehicleNumber: readText(readBulkVehicleCell(row, columnMap, 'vehicleNumber')),
      leaseCompany: readText(readBulkVehicleCell(row, columnMap, 'leaseCompany')),
      dailyLeaseCost: readMoney(readBulkVehicleCell(row, columnMap, 'dailyLeaseCost')),
      contractStartDate: readDate(readBulkVehicleCell(row, columnMap, 'contractStartDate')),
      contractEndDate: readDate(readBulkVehicleCell(row, columnMap, 'contractEndDate')),
      insuranceAge: readText(readBulkVehicleCell(row, columnMap, 'insuranceAge')),
      insuranceCompany: readText(readBulkVehicleCell(row, columnMap, 'insuranceCompany')),
      insuranceType: readText(readBulkVehicleCell(row, columnMap, 'insuranceType')),
      annualInsuranceCost: readMoney(readBulkVehicleCell(row, columnMap, 'annualInsuranceCost')),
      purchasePrice: readMoney(readBulkVehicleCell(row, columnMap, 'purchasePrice')),
      acquisitionTaxRate: readMoney(readBulkVehicleCell(row, columnMap, 'acquisitionTaxRate')),
      otherAcquisitionCost: readMoney(readBulkVehicleCell(row, columnMap, 'otherAcquisitionCost')),
      memo: readText(readBulkVehicleCell(row, columnMap, 'memo'))
    };

    const driverName = readText(readBulkVehicleCell(row, columnMap, 'driverName'));
    const driverPhone = readText(readBulkVehicleCell(row, columnMap, 'driverPhone'));
    const dealStartDate = readDate(readBulkVehicleCell(row, columnMap, 'dealStartDate'));
    const dealEndDate = readDate(readBulkVehicleCell(row, columnMap, 'dealEndDate'));
    const dailyRent = readMoney(readBulkVehicleCell(row, columnMap, 'dailyRent'));
    const contractDraft = driverName ? {
      driverName,
      driverPhone,
      startDate: dealStartDate || data.contractStartDate,
      endDate: dealEndDate || data.contractEndDate,
      dailyRent,
      weeklyRent: dailyRent > 0 ? dailyRent * 7 : 0,
      contractType
    } : null;

    const errors = [];
    if (!data.model) errors.push('기종 필요');
    if (!data.vehicleNumber && !data.chassisNumber) errors.push('차량번호 또는 차대번호 필요');
    if (erpMode === 'company_lease_rental' && !data.leaseCompany && !data.dailyLeaseCost) {
      errors.push('회사리스: 리스회사 또는 리스비(일) 입력');
    }
    if (driverName && !dealStartDate && !data.contractStartDate) {
      errors.push('렌탈/리스자 입력 시 계약시작일 필요');
    }

    const existingVehicle = (data.vehicleNumber || data.chassisNumber)
      ? erp()?.vehicles()?.findByVehicleKey?.({
        vehicleNumber: data.vehicleNumber,
        chassisNumber: data.chassisNumber
      })
      : null;

    return {
      rowNumber,
      data,
      contractDraft,
      erpMode,
      existingVehicle,
      action: existingVehicle ? 'update' : 'create',
      valid: errors.length === 0,
      errors
    };
  }

  function parseBulkVehicleWorkbook(workbook) {
    const sheetName = workbook.SheetNames.find(name => /일괄|차량|리스/i.test(name)) || workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const headerRowIndex = findBulkVehicleHeaderRow(rows);
    if (headerRowIndex < 0) return [];

    const columnMap = buildBulkVehicleColumnMap(rows[headerRowIndex]);
    const parsed = [];
    rows.forEach((row, index) => {
      if (index <= headerRowIndex) return;
      if (!row || !row.some(cell => String(cell || '').trim())) return;
      const rowNumber = index + 1;
      parsed.push(parseBulkVehicleRow(row, columnMap, rowNumber));
    });
    return parsed;
  }

  function renderBulkGuide() {
    const head = $('leaseBulkV3GuideHead');
    const body = $('leaseBulkV3GuideBody');
    if (!head || !body) return;
    head.innerHTML = BULK_VEHICLE_COLUMNS.map(col =>
      `<th title="${escapeHtml(col.col)}">${escapeHtml(col.label)}</th>`
    ).join('');
    body.innerHTML = `<tr>${BULK_VEHICLE_COLUMNS.map(col => {
      if (col.key === 'erpMode') return '<td>회사리스 / 회사소유리스</td>';
      if (col.key === 'contractType') return '<td>리스 / 렌탈</td>';
      if (col.key === 'model') return '<td>PCX · NMAX · FORZA · 기타</td>';
      if (col.key === 'vehicleNumber' || col.key === 'chassisNumber') return '<td>둘 중 하나 필수</td>';
      return '<td></td>';
    }).join('')}</tr>`;
  }

  function renderBulkPreview() {
    const body = $('leaseBulkV3PreviewBody');
    if (!body) return;
    const valid = state.bulkRows.filter(row => row.valid).length;
    const creates = state.bulkRows.filter(row => row.valid && row.action === 'create').length;
    const updates = state.bulkRows.filter(row => row.valid && row.action === 'update').length;
    const errors = state.bulkRows.length - valid;
    if ($('leaseBulkV3Total')) $('leaseBulkV3Total').textContent = String(state.bulkRows.length);
    if ($('leaseBulkV3Valid')) $('leaseBulkV3Valid').textContent = String(valid);
    if ($('leaseBulkV3Error')) $('leaseBulkV3Error').textContent = String(errors);
    if ($('leaseBulkV3Matched')) {
      $('leaseBulkV3Matched').textContent = valid ? `신규 ${creates} · 갱신 ${updates}` : '0';
    }
    if ($('leaseBulkV3ApplyBtn')) $('leaseBulkV3ApplyBtn').disabled = valid === 0;
    body.innerHTML = state.bulkRows.map(row => {
      const actionLabel = row.action === 'update'
        ? '<span class="bulk-match-ok">갱신</span>'
        : '<span class="bulk-match-ok bulk-match-ok--new">신규</span>';
      return `
      <tr class="${row.valid ? 'row-ok' : 'row-error'}">
        <td>${row.rowNumber}</td>
        <td>${escapeHtml(erpModeLabel(row.erpMode))}</td>
        <td><strong>${escapeHtml(row.data.vehicleNumber || row.data.chassisNumber || '-')}</strong></td>
        <td>${escapeHtml(row.data.model || '-')}</td>
        <td>${escapeHtml(row.data.leaseCompany || '-')}</td>
        <td>${row.valid ? actionLabel : '-'}</td>
        <td>${escapeHtml(row.contractDraft?.driverName || '-')}</td>
        <td>${row.valid ? '등록 가능' : escapeHtml(row.errors.join(', '))}</td>
      </tr>
    `;
    }).join('') || '<tr><td colspan="8" class="empty">업로드할 데이터가 없습니다.</td></tr>';
  }

  async function applyBulkVehicle() {
    if (!erp()) return;
    const validRows = state.bulkRows.filter(row => row.valid);
    if (!validRows.length) return;

    let created = 0;
    let updated = 0;
    let contracts = 0;

    for (const row of validRows) {
      const vehicle = erp().vehicles().upsert(row.data);
      if (row.action === 'update') updated += 1;
      else created += 1;

      if (row.contractDraft?.driverName && vehicle) {
        const draft = row.contractDraft;
        const existingContract = erp().contracts().getAll().find(item =>
          item.vehicleId === vehicle.id && erp().isContractOperating?.(item, vehicle)
        );
        const contractPayload = {
          vehicleId: vehicle.id,
          vehicleNumber: vehicle.vehicleNumber || row.data.vehicleNumber,
          vehicleName: vehicle.model || row.data.model,
          modelType: vehicle.model || row.data.model,
          driverName: draft.driverName,
          driverPhone: draft.driverPhone,
          startDate: draft.startDate,
          endDate: draft.endDate,
          dailyRent: draft.dailyRent,
          weeklyRent: draft.weeklyRent,
          contractType: draft.contractType || vehicle.contractType || 'lease',
          status: erp().CONTRACT_STATUS?.ACTIVE || 'active'
        };
        const contract = existingContract
          ? erp().contracts().update(existingContract.id, contractPayload)
          : erp().contracts().create(contractPayload);
        applyVehicleStatusFromContract(vehicle, contract);
        contracts += 1;
      } else if (vehicle) {
        erp()?.syncVehicleFromContract?.(vehicle);
      }
    }

    await erp().persistAll();
    updateLeaseErpUnsavedBanner();
    showToast(`차량 ${validRows.length}건 등록 (신규 ${created} · 갱신 ${updated}${contracts ? ` · 계약 ${contracts}` : ''})`);
    state.bulkRows = [];
    renderBulkPreview();
    window.BremAdminLease?.refresh?.({ loadRemote: false });
    renderContractList();
    renderDashboardKpis();
    paintDashboardVehicleOverview();
  }

  function downloadBulkTemplate() {
    if (!window.XLSX) return;
    const headers = BULK_VEHICLE_COLUMNS.map(col => col.label);
    const exampleRow = BULK_VEHICLE_COLUMNS.map(col => {
      if (col.key === 'erpMode') return '회사리스';
      if (col.key === 'contractType') return '리스';
      if (col.key === 'model') return '존테스125';
      if (col.key === 'vehicleNumber') return '12가3456';
      if (col.key === 'leaseCompany') return '스윙';
      if (col.key === 'dailyLeaseCost') return '27000';
      return '';
    });
    const sheet = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
    sheet['!cols'] = BULK_VEHICLE_COLUMNS.map(col => ({
      wch: Math.max(12, col.label.length + 2)
    }));
    const vehicles = erp()?.vehicles()?.getAll?.() || [];
    const vehicleSheet = XLSX.utils.aoa_to_sheet([
      ['차량번호', '차대번호', '기종', '회사구분', '종류', '리스회사', '리스비(일)', '리스시작일', '리스종료일'],
      ...vehicles.map(item => [
        item.vehicleNumber || '',
        item.chassisNumber || '',
        item.model || '',
        item.vehicleCategory === 'company_owned' ? '회사소유리스' : '회사리스',
        item.contractType === 'rental' ? '렌탈' : '리스',
        item.leaseCompany || '',
        item.dailyLeaseCost || '',
        item.contractStartDate || '',
        item.contractEndDate || ''
      ])
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, '차량일괄등록');
    XLSX.utils.book_append_sheet(wb, vehicleSheet, '차량관리목록');
    XLSX.writeFile(wb, 'BREM_리스ERP_차량일괄등록양식.xlsx');
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
    $('leaseContractDeleteAllBtn')?.addEventListener('click', () => { void deleteAllContracts(); });
    $('leaseContractEndBtn')?.addEventListener('click', endContractAsEmpty);
    $('leaseContractListSearch')?.addEventListener('input', event => {
      state.contractListSearch = String(event.target.value || '');
      renderContractList();
    });
    $('leaseContractDriverSearch')?.addEventListener('input', event => {
      state.contractDriverSearch = String(event.target.value || '');
      renderLeaseContractDriverResults();
    });
    $('leaseContractDriverSearch')?.addEventListener('focus', () => {
      renderLeaseContractDriverResults();
    });
    $('leaseContractDriverResults')?.addEventListener('click', event => {
      const button = event.target.closest('[data-lease-pick-driver]');
      if (!button) return;
      const driver = getContractDrivers().find(item => item.id === button.dataset.leasePickDriver);
      if (driver) selectLeaseContractDriver(driver);
    });
    document.addEventListener('click', event => {
      const box = $('leaseContractDriverResults');
      const input = $('leaseContractDriverSearch');
      if (!box || !input) return;
      if (box.contains(event.target) || input.contains(event.target)) return;
      box.hidden = true;
    });
    ['leaseRentalDealStartDate', 'leaseRentalDealEndDate'].forEach(id => {
      $(id)?.addEventListener('change', () => {
        if (id === 'leaseRentalDealEndDate') syncContractReturnDateWithEndDate();
        syncContractCalc();
      });
      $(id)?.addEventListener('input', syncContractCalc);
    });
    $('leaseContractReturnDate')?.addEventListener('change', syncContractCalc);
    $('leaseContractReturnDate')?.addEventListener('input', syncContractCalc);
    $('leaseWeekStart')?.addEventListener('change', () => {
      syncLeaseWeeklyWeekUi($('leaseWeekStart')?.value);
      renderWeekly();
    });
    $('leaseWeekRefreshBtn')?.addEventListener('click', () => {
      syncLeaseWeeklyWeekUi($('leaseWeekStart')?.value || state.weekStart || currentWeekStart());
      renderWeekly();
    });
    $('leaseWeekExportBtn')?.addEventListener('click', exportWeeklyExcel);
    $('leaseWeeklySelectAll')?.addEventListener('change', event => {
      const visible = getWeeklyDeletableLogIds();
      if (event.target.checked) visible.forEach(id => state.weeklySelectedLogIds.add(id));
      else visible.forEach(id => state.weeklySelectedLogIds.delete(id));
      renderWeekly();
    });
    $('leaseWeeklyBulkDelete')?.addEventListener('click', () => {
      const ids = getWeeklyDeletableLogIds().filter(id => state.weeklySelectedLogIds.has(id));
      void deleteProfitLogs(ids);
    });
    $('leaseMonthKey')?.addEventListener('change', renderMonthly);
    $('leaseMonthExportBtn')?.addEventListener('click', exportMonthlyExcel);
    $('leaseMonthlySelectAll')?.addEventListener('change', event => {
      const visible = getMonthlyDeletableLogIds();
      if (event.target.checked) visible.forEach(id => state.monthlySelectedLogIds.add(id));
      else visible.forEach(id => state.monthlySelectedLogIds.delete(id));
      renderMonthly();
    });
    $('leaseMonthlyBulkDelete')?.addEventListener('click', () => {
      const ids = getMonthlyDeletableLogIds().filter(id => state.monthlySelectedLogIds.has(id));
      void deleteProfitLogs(ids);
    });
    $('leaseMonthlyDeleteAllBtn')?.addEventListener('click', () => { void deleteAllMonthlyProfitLogs(); });
    $('leaseBulkV3TemplateBtn')?.addEventListener('click', downloadBulkTemplate);
    $('leaseBulkV3ApplyBtn')?.addEventListener('click', () => { void applyBulkVehicle(); });
    $('leaseBulkV3File')?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file || !window.XLSX) return;
      const reader = new FileReader();
      reader.onload = () => {
        const wb = XLSX.read(reader.result, { type: 'array' });
        state.bulkRows = parseBulkVehicleWorkbook(wb);
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
      const deleteContractBtn = event.target.closest('[data-delete-contract]');
      if (deleteContractBtn) {
        void deleteContract(deleteContractBtn.dataset.deleteContract);
        return;
      }
      const editEmpty = event.target.closest('[data-edit-empty-vehicle]');
      if (editEmpty) {
        setMenu('vehicle');
        const item = erp()?.vehicles().getById(editEmpty.dataset.editEmptyVehicle);
        if (item) window.BremAdminLease?.fillForm?.(item) || document.querySelector(`[data-edit-lease="${item.id}"]`)?.click();
        return;
      }
      const contractEmptyBtn = event.target.closest('[data-contract-empty-vehicle]');
      if (contractEmptyBtn) {
        openContractForVehicle(contractEmptyBtn.dataset.contractEmptyVehicle);
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
      const partialBtn = event.target.closest('[data-partial-arrear]');
      if (partialBtn) {
        void recordPartialArrearRecovery(partialBtn.dataset.partialArrear);
        return;
      }
      const deleteProfitBtn = event.target.closest('[data-delete-profit-log]');
      if (deleteProfitBtn) {
        void deleteProfitLog(deleteProfitBtn.dataset.deleteProfitLog);
        return;
      }
      const deleteHistoryBtn = event.target.closest('[data-delete-arrear-history]');
      if (deleteHistoryBtn) {
        deleteArrearRecord(deleteHistoryBtn.dataset.deleteArrearHistory, {
          plate: deleteHistoryBtn.dataset.arrearPlate,
          driver: deleteHistoryBtn.dataset.arrearDriver
        });
        return;
      }
      const deleteBtn = event.target.closest('[data-delete-arrear]');
      if (deleteBtn) {
        deleteArrearRecord(deleteBtn.dataset.deleteArrear);
      }
    });

    $('leaseArrearDriverSearch')?.addEventListener('input', event => {
      state.arrearDriverSearch = String(event.target.value || '');
      state.arrearContractOptionsDirty = true;
      fillArrearContractSelect(true);
    });
    $('leaseErpCommitBtn')?.addEventListener('click', () => { void commitLeaseErpSave(); });
    document.querySelectorAll('[data-lease-commit-btn]').forEach(btn => {
      btn.addEventListener('click', () => { void commitLeaseErpSave(); });
    });
    document.addEventListener('brem-lease-erp-dirty', updateLeaseErpUnsavedBanner);

    bindCalcInputs();
    $('leaseArrearRegisterForm')?.addEventListener('submit', event => { void registerArrear(event); });
    $('leaseArrearCompleteConfirmBtn')?.addEventListener('click', () => { void confirmCompleteArrear(); });
    $('leaseArrearCompleteCancelBtn')?.addEventListener('click', hideArrearCompletePanel);

    document.addEventListener('change', event => {
      const weeklyCheck = event.target.closest('[data-select-weekly-profit-log]');
      if (weeklyCheck) {
        const id = weeklyCheck.dataset.selectWeeklyProfitLog;
        if (!id) return;
        if (weeklyCheck.checked) state.weeklySelectedLogIds.add(id);
        else state.weeklySelectedLogIds.delete(id);
        updateWeeklySelectionUi();
        weeklyCheck.closest('tr')?.classList.toggle('row-selected', weeklyCheck.checked);
        return;
      }
      const monthlyCheck = event.target.closest('[data-select-monthly-profit-log]');
      if (!monthlyCheck) return;
      const monthlyId = monthlyCheck.dataset.selectMonthlyProfitLog;
      if (!monthlyId) return;
      if (monthlyCheck.checked) state.monthlySelectedLogIds.add(monthlyId);
      else state.monthlySelectedLogIds.delete(monthlyId);
      updateMonthlySelectionUi();
      monthlyCheck.closest('tr')?.classList.toggle('row-selected', monthlyCheck.checked);
    });
  }

  async function init() {
    if (!$('lease-management')) return;
    erp()?.setDeferRemotePersist?.(true);
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
    if (!init.bootstrapped) {
      init.bootstrapped = true;
      fillVehicleSelect($('leaseContractVehicleId'));
      fillVehicleSelect($('leaseCalcVehicleId'));
      if ($('leaseWeekStart')) syncLeaseWeeklyWeekUi(currentWeekStart());
      syncArrearWeekUi(currentWeekStart());
      if ($('leaseMonthKey') && !$('leaseMonthKey').value) $('leaseMonthKey').value = currentMonthKey();
      updateLeaseDashWeekUi();
    }
    updateLeaseErpUnsavedBanner();
    await refresh();
    setMenu(state.menu || 'dashboard');
  }

  async function refresh(options = {}) {
    if (options.loadRemote !== false && erp()?.ensureLoaded) {
      try {
        await erp().ensureLoaded();
      } catch (error) {
        console.error('[BremAdminLeaseMenus] ensureLoaded failed', error);
      }
    }
    fillVehicleSelect($('leaseContractVehicleId'));
    fillVehicleSelect($('leaseCalcVehicleId'));
    renderDashboardKpis();
    paintDashboardVehicleOverview();
    if (options.loadRemote !== false) {
      await renderDashboardVehicleOverview();
    }
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
    bindEvents,
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
    paintDashboardVehicleOverview,
    renderDashboardVehicleOverview,
    updateLeaseDashWeekUi,
    syncLeaseDashWeekUi,
    handleDashboardWeekChange,
    handleWeeklyWeekChange,
    handleArrearWeekChange,
    syncLeaseWeeklyWeekUi,
    syncArrearWeekUi,
    commitLeaseErpSave,
    updateLeaseErpUnsavedBanner,
    renderStatusTagsHtml,
    currentWeekStart,
    renderContractList
  };
})();

window.BremAdminLeaseMenus = BremAdminLeaseMenus;

function bootLeaseMenus() {
  if (!document.getElementById('lease-management')) return;
  BremAdminLeaseMenus.bindEvents?.();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLeaseMenus, { once: true });
} else {
  bootLeaseMenus();
}

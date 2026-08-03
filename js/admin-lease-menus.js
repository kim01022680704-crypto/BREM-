/**
 * 리스 ERP — 서브메뉴 (대시보드 · 차량 · 계약 · 대여/차감 · 납부확인 · 완납확인 · 자동계산 · 미납 · 공차 · 주간/월간 · 일괄)
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
    contractVehicleSearch: '',
    contractListSearch: '',
    dashVehicleSearch: '',
    dashVehicleFilter: 'all',
    dashVehicleSort: { key: 'vehicleNumber', dir: 'asc' },
    contractSort: { key: 'updatedAt', dir: 'desc' },
    weeklySelectedLogIds: new Set(),
    weeklyVisibleLogIds: [],
    monthlySelectedLogIds: new Set(),
    monthlyVisibleLogIds: [],
    arrearContractOptionsDirty: true,
    contractSaving: false,
    arrearWeekStart: '',
    arrearDriverSearch: '',
    paymentWeekStart: '',
    paymentConfirmSearch: '',
    paymentPaidSearch: '',
    paymentConfirmSelectedIds: new Set(),
    deductionTab: 'lease',
    deductionLeaseSearch: '',
    deductionLeaseSelectedIds: new Set(),
    deductionLoanSearch: '',
    deductionManageSearch: '',
    deductionManageKind: 'all',
    deductionManageSelectedKeys: new Set(),
    loanDriverSearch: '',
    paymentSource: 'lease',
    paymentStatusFilter: 'open',
    paymentPaidSource: 'lease',
    leaseSaving: false
  };

  const PAYMENT_CONFIRM_MEMO_PREFIX = '납부확인:';

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
    const drivers = filterContractDrivers(getContractDrivers()).slice(0, 100);
    box.hidden = false;
    if (!drivers.length) {
      box.innerHTML = '<p class="lease-driver-picker__empty">검색된 등록 기사가 없습니다.</p>';
      return;
    }
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
    if (state.leaseSaving) return;
    const banner = $('leaseErpUnsavedBanner');
    const commitBtn = $('leaseErpCommitBtn');
    const dirty = erp()?.hasDeferredChanges?.() || false;
    if (banner) {
      banner.hidden = !dirty;
      banner.classList.remove('lease-erp-unsaved-banner--saving', 'lease-erp-unsaved-banner--done', 'lease-erp-unsaved-banner--error');
    }
    document.querySelectorAll('.lease-erp-commit-btn, #leaseErpCommitBtn, [data-lease-commit-btn]').forEach(btn => {
      btn.classList.remove('is-loading', 'lease-erp-commit-btn--done', 'lease-erp-commit-btn--pulse');
      if (dirty) btn.classList.add('lease-erp-commit-btn--pulse');
      btn.disabled = false;
      if (!btn.dataset.leaseCommitIdleLabel) {
        btn.dataset.leaseCommitIdleLabel = 'Supabase 저장';
      }
      btn.textContent = dirty ? 'Supabase 저장 (미저장)' : (btn.dataset.leaseCommitIdleLabel || 'Supabase 저장');
    });
    if (commitBtn) {
      commitBtn.disabled = false;
    }
    setLeaseSaveStatus(dirty ? '변경사항 있음 · Supabase 저장을 눌러주세요' : '', dirty ? 'warn' : '');
  }

  function setLeaseSaveStatus(message, tone = '') {
    document.querySelectorAll('[data-lease-save-status]').forEach(el => {
      el.textContent = message || '';
      el.hidden = !message;
      el.classList.remove('lease-save-status--warn', 'lease-save-status--busy', 'lease-save-status--done', 'lease-save-status--error');
      if (message && tone) el.classList.add(`lease-save-status--${tone}`);
    });
  }

  function setLeaseCommitButtonsBusy(busy, label) {
    document.querySelectorAll('.lease-erp-commit-btn, #leaseErpCommitBtn, [data-lease-commit-btn]').forEach(btn => {
      btn.classList.toggle('is-loading', busy);
      btn.classList.remove('lease-erp-commit-btn--done', 'lease-erp-commit-btn--pulse');
      btn.disabled = busy;
      if (label) btn.textContent = label;
    });
  }

  function setLeaseCommitButtonsDone() {
    document.querySelectorAll('.lease-erp-commit-btn, #leaseErpCommitBtn, [data-lease-commit-btn]').forEach(btn => {
      btn.classList.remove('is-loading', 'lease-erp-commit-btn--pulse');
      btn.classList.add('lease-erp-commit-btn--done');
      btn.disabled = false;
      btn.textContent = '저장 완료 ✓';
    });
  }

  async function commitLeaseErpSave() {
    if (state.leaseSaving) return;
    state.leaseSaving = true;
    const banner = $('leaseErpUnsavedBanner');
    const hadDeferred = Boolean(erp()?.hasDeferredChanges?.());
    if (banner) {
      banner.hidden = false;
      banner.classList.add('lease-erp-unsaved-banner--saving');
      banner.classList.remove('lease-erp-unsaved-banner--done', 'lease-erp-unsaved-banner--error');
      const text = banner.querySelector('.lease-erp-unsaved-banner__text');
      if (text) {
        text.innerHTML = '<strong>저장 중…</strong><span>Supabase에 반영하고 있습니다. 잠시만 기다려 주세요.</span>';
      }
    }
    setLeaseCommitButtonsBusy(true, '저장 중…');
    setLeaseSaveStatus('Supabase에 저장 중…', 'busy');
    showToast('Supabase에 저장 중…');
    try {
      // 미저장(defer) + 진행 중 write 모두 확정
      await erp().persistAll({ skipFlushStorage: true });
      if (BremStorage?.flushStorage) {
        try { await BremStorage.flushStorage(); } catch (_e) { /* ignore */ }
      }
      setLeaseCommitButtonsDone();
      if (banner) {
        banner.classList.remove('lease-erp-unsaved-banner--saving');
        banner.classList.add('lease-erp-unsaved-banner--done');
        const text = banner.querySelector('.lease-erp-unsaved-banner__text');
        if (text) {
          text.innerHTML = hadDeferred
            ? '<strong>저장 완료!</strong><span>Supabase에 반영되었습니다.</span>'
            : '<strong>동기화 완료</strong><span>이미 최신 상태입니다. Supabase와 맞춰 두었습니다.</span>';
        }
        banner.hidden = false;
      }
      setLeaseSaveStatus(hadDeferred ? '저장 완료 · Supabase 반영됨' : '동기화 완료 · 최신 상태', 'done');
      showToast(hadDeferred ? 'Supabase 저장 완료' : '동기화 완료 · 이미 최신 상태입니다');
      renderContractList();
      renderDashboardKpis();
      paintDashboardVehicleOverview();
      if (state.menu === 'payment-confirm') renderPaymentConfirm();
      window.BremAdminLease?.renderList?.();
      window.setTimeout(() => {
        state.leaseSaving = false;
        if (banner) {
          const text = banner.querySelector('.lease-erp-unsaved-banner__text');
          if (text) {
            text.innerHTML = '<strong>저장되지 않은 변경사항이 있습니다!</strong><span>목록·폼에 반영만 된 상태입니다. <em>Supabase 저장</em> 버튼을 누르지 않으면 새로고침 시 데이터가 사라집니다.</span>';
          }
          banner.classList.remove('lease-erp-unsaved-banner--done', 'lease-erp-unsaved-banner--saving', 'lease-erp-unsaved-banner--error');
        }
        updateLeaseErpUnsavedBanner();
      }, 1800);
    } catch (error) {
      console.error('[commitLeaseErpSave]', error);
      state.leaseSaving = false;
      if (banner) {
        banner.hidden = false;
        banner.classList.remove('lease-erp-unsaved-banner--saving', 'lease-erp-unsaved-banner--done');
        banner.classList.add('lease-erp-unsaved-banner--error');
        const text = banner.querySelector('.lease-erp-unsaved-banner__text');
        if (text) {
          text.innerHTML = `<strong>저장 실패</strong><span>${escapeHtml(error?.message || '다시 시도해 주세요.')}</span>`;
        }
      }
      setLeaseSaveStatus(error?.message || '저장 실패', 'error');
      showToast(error?.message || '저장에 실패했습니다.');
      updateLeaseErpUnsavedBanner();
    }
  }

  function currentWeekStart() {
    // 대시보드는 날짜 선택 없이 항상 현재 주(수~화) 기준으로 표시한다.
    return BremLeaseProfit?.weekStartKey?.()
      || calc()?.weekRange?.('')?.start
      || BremStorage?.adminPreferences?.getLeaseDashboardWeekBasis?.()
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

  function syncPaymentWeekUi(weekStart) {
    const normalized = String(
      BremDatePicker?.applyWeekWednesday?.(weekStart)
      || weekStart
      || currentWeekStart()
      || ''
    ).slice(0, 10);
    state.paymentWeekStart = normalized;
    return normalized;
  }

  function handlePaymentWeekChange(weekStart) {
    syncPaymentWeekUi(weekStart);
    renderPaymentConfirm();
  }

  function formatPaymentWeekColumn(weekStart) {
    const start = syncPaymentWeekUi(weekStart || currentWeekStart());
    if (!start) return '-';
    if (BremDatePicker?.formatWednesdayWeekRange) {
      return BremDatePicker.formatWednesdayWeekRange(start);
    }
    return formatLeaseWeekRangeLabel(start) || start;
  }

  async function persistLeaseFast() {
    if (!erp()) return;
    await erp().persistAll({ skipFlushStorage: true });
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
    if (state.menu === 'payment-confirm') renderPaymentConfirm();
    if (state.menu === 'payment-paid') renderPaymentPaid();
    if (refreshDashboard) {
      paintDashboardVehicleOverview();
      renderDashboardKpis();
    }
    if (refreshVehicleList) window.BremAdminLease?.renderList?.();
    if (state.menu === 'weekly') renderWeekly();
    if (state.menu === 'monthly') renderMonthly();
    if (state.menu === 'weekly-loan') renderWeeklyLoan();
    if (state.menu === 'monthly-loan') renderMonthlyLoan();
    if (state.menu === 'arrears') renderArrears();
    if (state.menu === 'empty') renderEmpty();
  }

  const CONTRACT_DATE_FIELD_IDS = [
    'leaseRentalDealStartDate',
    'leaseRentalDealEndDate',
    'leaseContractReturnDate'
  ];

  function contractDateLabelId(targetId) {
    const dash = targetId.lastIndexOf('-');
    if (dash === -1) return `${targetId}Label`;
    return `${targetId.slice(0, dash)}Label${targetId.slice(dash)}`;
  }

  function refreshContractDateLabel(targetId) {
    const input = $(targetId);
    const label = $(contractDateLabelId(targetId));
    if (input && label) {
      label.textContent = input.value ? formatDate(input.value) : '날짜 선택';
    }
  }

  function refreshContractDateLabels() {
    CONTRACT_DATE_FIELD_IDS.forEach(refreshContractDateLabel);
  }

  function contractFieldDate(contract, key) {
    if (!contract) return '';
    const direct = contract[key];
    const fallback = contract.rawData?.[key];
    return normalizeContractDate(direct != null && direct !== '' ? direct : fallback);
  }

  function setMenu(menu, options = {}) {
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
    if (menu === 'payment-confirm') {
      syncPaymentWeekUi(currentWeekStart());
      renderPaymentConfirm();
      return;
    }
    if (menu === 'payment-paid') {
      renderPaymentPaid();
      return;
    }
    if (menu === 'deduction') {
      syncDeductionTabUi();
      renderDeductionActivePane();
      return;
    }
    if (menu === 'dashboard') {
      syncLeaseDashWeekUi(currentWeekStart());
      renderDashboard();
    }
    if (menu === 'weekly') renderWeekly();
    if (menu === 'monthly') renderMonthly();
    if (menu === 'weekly-loan') {
      syncLeaseLoanWeeklyWeekUi($('leaseLoanWeekStart')?.value || state.weekStart || currentWeekStart());
      renderWeeklyLoan();
    }
    if (menu === 'monthly-loan') {
      if ($('leaseLoanMonthKey') && !$('leaseLoanMonthKey').value) {
        $('leaseLoanMonthKey').value = state.monthKey || currentMonthKey();
      }
      renderMonthlyLoan();
    }
    if (menu === 'empty') renderEmpty();
    if (menu === 'bulk') renderBulkGuide();
    if (menu === 'vehicle' && !options.keepVehicleForm) {
      window.BremAdminLease?.resetForm?.();
    }
    if (menu === 'contract') {
      if (!options.keepContractForm) {
        resetContractForm();
      }
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

  function dashVehicleMeta(item) {
    const contract = erp()?.getLatestContractForVehicle?.(item.id) || null;
    const driver = String(contract?.driverName || item.renter || '').trim();
    const source = dashVehicleSourceLabel(item);
    const isRental = String(contract?.contractType || '') === 'rental';
    const operating = isContractActive(contract);
    const unpaidAmount = resolveVehicleUnpaidAmount(item.id, { unpaidAmount: item.unpaidAmount });
    const isUnpaid = hasOpenArrear(item.id) || unpaidAmount > 0 || Number(item.unpaidDays || 0) > 0;
    return { contract, driver, source, isRental, operating, isUnpaid };
  }

  function filterDashVehicles(list) {
    const filter = state.dashVehicleFilter || 'all';
    if (filter === 'all') return list;
    return list.filter(item => {
      const meta = dashVehicleMeta(item);
      switch (filter) {
        case 'operating': return meta.operating;
        case 'empty': return !meta.operating;
        case 'unpaid': return meta.isUnpaid;
        case 'lease': return Boolean(meta.contract) && !meta.isRental;
        case 'rental': return Boolean(meta.contract) && meta.isRental;
        default: return true;
      }
    });
  }

  function sortDashVehicles(list) {
    const sort = state.dashVehicleSort || { key: 'vehicleNumber', dir: 'asc' };
    const factor = sort.dir === 'asc' ? 1 : -1;
    const valueOf = (item) => {
      switch (sort.key) {
        case 'model': return String(item.model || '');
        case 'insuranceAge': return Number(String(item.insuranceAge || '').replace(/[^\d]/g, '')) || 0;
        case 'source': return dashVehicleSourceLabel(item);
        case 'driver': return dashVehicleMeta(item).driver || '';
        default: return String(item.vehicleNumber || '');
      }
    };
    return list.slice().sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), 'ko') * factor;
    });
  }

  function updateDashVehicleSortIndicators() {
    const sort = state.dashVehicleSort || { key: 'vehicleNumber', dir: 'asc' };
    document.querySelectorAll('#lease-management [data-dash-sort]').forEach(th => {
      const active = th.dataset.dashSort === sort.key;
      th.classList.toggle('is-active', active);
      th.setAttribute('data-dir', active ? sort.dir : '');
    });
  }

  function paintDashboardVehicleOverview() {
    const rowsEl = document.querySelector('#lease-management #leaseDashVehicleRows');
    if (!rowsEl) return;
    try {
      const allVehicles = getAllDashboardVehicles();
      if (!allVehicles.length) {
        rowsEl.innerHTML = '<tr><td colspan="10" class="empty">등록된 차량이 없습니다.</td></tr>';
        return;
      }

      const keyword = String(state.dashVehicleSearch || '').trim().toLowerCase();
      let vehicles = keyword
        ? allVehicles.filter(item => {
            const contract = erp()?.getLatestContractForVehicle?.(item.id) || null;
            const driver = String(contract?.driverName || item.renter || '');
            return [item.vehicleNumber, item.model, driver, item.leaseCompany]
              .join(' ').toLowerCase().includes(keyword);
          })
        : allVehicles;

      vehicles = sortDashVehicles(filterDashVehicles(vehicles));
      updateDashVehicleSortIndicators();

      if (!vehicles.length) {
        rowsEl.innerHTML = '<tr><td colspan="10" class="empty">검색/필터 결과가 없습니다.</td></tr>';
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

  function readContractDeductionPlatform() {
    return 'coupang';
  }

  function setContractDeductionPlatform(_platform) {
    // 플랫폼 라디오 제거 — 정산 시 실지급 큰 쪽 스필오버
  }

  function contractRiderDailyRent(contract) {
    if (!contract) return 0;
    const daily = Math.max(0, Number(contract.dailyRent || 0));
    const weekly = Math.max(0, Number(contract.weeklyRent || 0));
    // 일 렌탈료가 있으면 그걸 우선. (예전 로직은 weekly≠daily×7 이면 weekly를 일당처럼 써서 27000 등이 튀었다)
    if (daily > 0) return Math.round(daily);
    if (weekly > 0) return Math.round(weekly / 7);
    return 0;
  }

  /** 계약 시 정한 주간 청구액(라이더 부담) = 일렌탈료 × 7 · 참고용 */
  function contractRiderWeeklyCharge(contract) {
    if (!contract) return 0;
    const daily = contractRiderDailyRent(contract);
    if (daily > 0) return Math.round(daily * 7);
    return Math.max(0, Math.round(Number(contract.weeklyRent || 0)));
  }

  /**
   * 납부확인·회수에 쓰는 이번주 청구액 = 일렌탈료 × (이번주 경과·운행가능 일수).
   * 주가 끝나기 전에 7일 전액을 미납으로 넘기면 급여차감과 이중·과다 청구된다.
   */
  function contractPaymentConfirmCharge(contract, weekStart) {
    if (!contract) return 0;
    const daily = contractRiderDailyRent(contract);
    if (daily <= 0) return 0;
    const days = contractActiveDaysInWeek(contract, weekStart || currentWeekStart());
    return Math.max(0, Math.round(daily * Math.max(0, days)));
  }

  /**
   * 수기 완납용 청구액. 경과일이 0이어도(차감시작 전 등) 주간청구(일×7)로 기록할 수 있게 한다.
   */
  function resolvePaymentConfirmCharge(contract, weekStart) {
    const progressive = contractPaymentConfirmCharge(contract, weekStart);
    if (progressive > 0) return progressive;
    return contractRiderWeeklyCharge(contract);
  }

  /** 차량관리에 등록된 주간 리스비(원가) = 일리스비 × 7 */
  function vehicleWeeklyLeaseCost(vehicle) {
    return Math.max(0, Math.round(Number(vehicle?.dailyLeaseCost || 0) * 7));
  }

  /** 차액(주) = 주간청구액 − 주간리스비 */
  function contractWeeklyMargin(contract, vehicle) {
    return contractRiderWeeklyCharge(contract) - vehicleWeeklyLeaseCost(vehicle);
  }

  function getActiveContractForVehicle(vehicleId) {
    if (!erp() || !vehicleId) return null;
    const ended = erp().CONTRACT_STATUS?.ENDED || 'ended';
    const list = erp().contracts().getAll().filter(item =>
      String(item.vehicleId || '') === String(vehicleId)
      && String(item.status || '') !== ended
      && String(item.driverName || item.renter || '').trim()
    );
    if (!list.length) return null;
    return list.slice().sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    )[0];
  }

  function formatContractPeriodLabel(contract) {
    if (!contract) return '-';
    const start = formatDate(contract.startDate);
    const end = formatDate(contract.endDate);
    if (start === '-' && end === '-') return '-';
    return `${start} ~ ${end}`;
  }

  function formatDriverContractLabel(name, { contracted = true } = {}) {
    const base = String(name || '').trim() || '-';
    if (!contracted || base === '-') return base;
    if (/\(계약됨\)$/.test(base)) return base;
    return `${base}(계약됨)`;
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
      deductionPlatform: readContractDeductionPlatform(),
      deductStartDate: $('leaseContractDeductStartDate')?.value || '',
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
    const newEnd = endEl.value || '';
    if (!newEnd) return;
    const today = contractTodayKey();
    const returnVal = returnEl.value || '';
    if (returnVal && returnVal <= today && newEnd > returnVal) {
      returnEl.value = '';
      refreshContractDateLabel('leaseContractReturnDate');
    }
  }

  function buildContractPreviewFromDraft(draft) {
    const vehicle = erp()?.vehicles().getById(draft.vehicleId);
    const statusPatch = erp()?.resolveContractStatusOnSave?.(draft, vehicle) || {};
    return { ...draft, ...statusPatch };
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
    if ($('leaseContractMargin')) {
      const margin = Math.round(Number(draft.weeklyRent || 0) - Number(draft.leaseCost || 0));
      $('leaseContractMargin').value = (draft.weeklyRent || draft.leaseCost)
        ? margin.toLocaleString('ko-KR')
        : '';
    }
    const previewContract = buildContractPreviewFromDraft(draft);
    const vehicle = erp()?.vehicles().getById(draft.vehicleId);
    const tags = erp()?.resolveVehicleStatusTags?.(vehicle, previewContract) || [];
    const statusLabel = tags.length
      ? tags.map(tag => tag.label).join(' · ')
      : (resolveContractStatus(previewContract, draft.vehicleId).label || '공차(로스)');
    if ($('leaseContractStatusPreview')) $('leaseContractStatusPreview').value = statusLabel;
  }

  function formatVehicleSelectLabel(item) {
    const model = item.model || '-';
    const plate = item.vehicleNumber || '-';
    const source = profit()?.vehicleSourceLabel?.(item) || '회사리스';
    return `${model} · ${plate} · ${source}`;
  }

  function fillVehicleSelect(selectEl, includeBlank = true, preserveSelection = true) {
    // 계약/렌탈 차량 선택은 콤보박스(검색형)로 대체됐으므로 <select> 요소에만 동작한다.
    if (!selectEl || !erp() || selectEl.tagName !== 'SELECT') return;
    const prev = preserveSelection ? selectEl.value : '';
    const options = (includeBlank ? ['<option value="">차량 선택</option>'] : []).concat(
      erp().vehicles().getAll().map(item =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(formatVehicleSelectLabel(item))}</option>`
      )
    );
    selectEl.innerHTML = options.join('');
    if (prev) selectEl.value = prev;
  }

  // ===== 계약/렌탈 차량 검색형 콤보박스 (렌탈/리스자 검색과 동일한 방식) =====
  function updateLeaseContractVehicleSelectedLabel(vehicle) {
    const label = $('leaseContractVehicleSelected');
    if (!label) return;
    if (!vehicle) {
      label.textContent = '선택된 차량: 없음';
      return;
    }
    const plate = vehicle.vehicleNumber || '-';
    const model = vehicle.model || '-';
    const source = profit()?.vehicleSourceLabel?.(vehicle) || '';
    const weeklyLease = vehicleWeeklyLeaseCost(vehicle);
    const active = getActiveContractForVehicle(vehicle.id);
    const parts = [`선택된 차량: ${plate} · ${model}${source ? ` · ${source}` : ''}`];
    if (weeklyLease > 0) parts.push(`주간리스비 ${formatMoney(weeklyLease)}`);
    if (active) {
      const charge = contractRiderWeeklyCharge(active);
      const driver = formatDriverContractLabel(active.driverName || active.renter || '');
      parts.push(`${driver}`);
      parts.push(`계약기간 ${formatContractPeriodLabel(active)}`);
      if (charge > 0) parts.push(`주간청구 ${formatMoney(charge)}`);
      if (weeklyLease > 0 || charge > 0) {
        parts.push(`차액 ${formatMoney(charge - weeklyLease)}`);
      }
    }
    label.textContent = parts.join(' · ');
  }

  function clearLeaseContractVehicleSelection() {
    if ($('leaseContractVehicleId')) $('leaseContractVehicleId').value = '';
    updateLeaseContractVehicleSelectedLabel(null);
  }

  function selectLeaseContractVehicle(vehicle) {
    if (!vehicle) return;
    if ($('leaseContractVehicleId')) $('leaseContractVehicleId').value = vehicle.id || '';
    if ($('leaseContractVehicleSearch')) $('leaseContractVehicleSearch').value = formatVehicleSelectLabel(vehicle);
    state.contractVehicleSearch = '';
    updateLeaseContractVehicleSelectedLabel(vehicle);
    if ($('leaseContractVehicleResults')) $('leaseContractVehicleResults').hidden = true;
    onContractVehicleChange();
  }

  function renderLeaseContractVehicleResults() {
    const box = $('leaseContractVehicleResults');
    if (!box || !erp()) return;
    const keyword = String(state.contractVehicleSearch || '').trim().toLowerCase();
    let list = erp().vehicles().getAll();
    if (keyword) {
      list = list.filter(item => {
        const source = profit()?.vehicleSourceLabel?.(item) || '';
        const active = getActiveContractForVehicle(item.id);
        const haystack = [
          item.vehicleNumber,
          item.model,
          source,
          active?.driverName,
          active?.driverPhone
        ].join(' ').toLowerCase();
        return haystack.includes(keyword);
      });
    }
    list = list.slice(0, 40);
    box.hidden = false;
    if (!list.length) {
      box.innerHTML = '<p class="lease-driver-picker__empty">검색된 등록 차량이 없습니다. 차량관리에서 먼저 등록하세요.</p>';
      return;
    }
    box.innerHTML = list.map(item => {
      const active = getActiveContractForVehicle(item.id);
      const weeklyLease = vehicleWeeklyLeaseCost(item);
      const meta = active
        ? `${formatDriverContractLabel(active.driverName || '-')} · ${formatContractPeriodLabel(active)} · 주간청구 ${formatMoney(contractRiderWeeklyCharge(active))}`
        : (weeklyLease > 0 ? `주간리스비 ${formatMoney(weeklyLease)} · 미계약` : '미계약');
      return `
      <button type="button" class="lease-driver-picker__item" data-lease-pick-vehicle="${escapeHtml(item.id)}">
        <strong>${escapeHtml(item.vehicleNumber || '-')}${active ? ' (계약됨)' : ''}</strong>
        <span>${escapeHtml(item.model || '-')} · ${escapeHtml(profit()?.vehicleSourceLabel?.(item) || '회사리스')}</span>
        <span>${escapeHtml(meta)}</span>
      </button>
    `;
    }).join('');
  }

  function onContractVehicleChange() {
    const vehicleId = $('leaseContractVehicleId')?.value || '';
    const vehicle = vehicleId ? erp()?.vehicles().getById(vehicleId) : null;
    if (!vehicle) {
      if ($('leaseContractVehicleNumber')) $('leaseContractVehicleNumber').value = '';
      if ($('leaseContractVehicleName')) $('leaseContractVehicleName').value = '';
      if ($('leaseContractModelType')) $('leaseContractModelType').value = '';
      if ($('leaseContractLeaseCost')) $('leaseContractLeaseCost').value = '';
      if ($('leaseContractInsurance')) $('leaseContractInsurance').value = '';
      syncContractCalc();
      return;
    }
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
      if ($('leaseContractReturnDate')) $('leaseContractReturnDate').value = '';
      refreshContractDateLabels();
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
    const selectedVehicle = erp()?.vehicles().getById(contract.vehicleId) || null;
    if ($('leaseContractVehicleSearch')) {
      $('leaseContractVehicleSearch').value = selectedVehicle
        ? formatVehicleSelectLabel(selectedVehicle)
        : (contract.vehicleNumber || '');
    }
    state.contractVehicleSearch = '';
    updateLeaseContractVehicleSelectedLabel(selectedVehicle || (contract.vehicleNumber
      ? { vehicleNumber: contract.vehicleNumber, model: contract.vehicleName || contract.modelType || '' }
      : null));
    if ($('leaseContractVehicleResults')) $('leaseContractVehicleResults').hidden = true;
    if ($('leaseContractVehicleNumber')) $('leaseContractVehicleNumber').value = contract.vehicleNumber || '';
    if ($('leaseContractVehicleName')) $('leaseContractVehicleName').value = contract.vehicleName || '';
    if ($('leaseContractModelType')) {
      const vehicle = erp()?.vehicles().getById(contract.vehicleId);
      $('leaseContractModelType').value = contract.modelType || vehicle?.model || '';
    }
    document.querySelectorAll('input[name="leaseContractDealType"]').forEach(input => {
      input.checked = input.value === (contract.contractType || 'lease');
    });
    setContractDeductionPlatform(contract.deductionPlatform || contract.rawData?.deductionPlatform || 'coupang');
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
    const startDate = contractFieldDate(contract, 'startDate');
    const endDate = contractFieldDate(contract, 'endDate');
    const returnDate = contractFieldDate(contract, 'returnDate');
    if ($('leaseRentalDealStartDate')) $('leaseRentalDealStartDate').value = startDate;
    if ($('leaseRentalDealEndDate')) $('leaseRentalDealEndDate').value = endDate;
    if ($('leaseContractReturnDate')) {
      const today = contractTodayKey();
      const shouldClearStaleReturn = endDate && returnDate
        && returnDate <= today
        && endDate > returnDate
        && endDate >= today;
      $('leaseContractReturnDate').value = shouldClearStaleReturn ? '' : returnDate;
    }
    if ($('leaseContractDeductStartDate')) {
      $('leaseContractDeductStartDate').value = String(
        contract.rawData?.deductStartDate || contract.deductStartDate || ''
      ).slice(0, 10);
    }
    refreshContractDateLabels();
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
    const vehicle = erp()?.vehicles().getById(vehicleId);
    if (vehicle) {
      selectLeaseContractVehicle(vehicle);
    } else if ($('leaseContractVehicleId')) {
      $('leaseContractVehicleId').value = vehicleId || '';
      onContractVehicleChange();
    }
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

  function contractUnpaidInfo(contract) {
    if (isContractFinalApplyEnabled(contract)) {
      const hold = erp()?.resolveContractSalaryHold?.(contract)
        || {
          days: contractActiveDaysInWeek(contract, currentWeekStart()),
          amount: contractPaymentConfirmCharge(contract, currentWeekStart())
        };
      return {
        isUnpaid: false,
        isHolding: Number(hold.days || 0) > 0 || Number(hold.amount || 0) > 0,
        amount: Math.max(0, Number(hold.amount || 0)),
        days: Math.max(0, Number(hold.days || 0)),
        mode: 'salary'
      };
    }
    const vehicleId = contract?.vehicleId;
    const vehicle = vehicleId ? erp()?.vehicles().getById(vehicleId) : null;
    const open = hasOpenArrear(vehicleId);
    const amount = resolveVehicleUnpaidAmount(vehicleId, { unpaidAmount: vehicle?.unpaidAmount });
    const daily = contractRiderDailyRent(contract);
    const daysFromAmount = daily > 0 && amount > 0 ? Math.max(1, Math.round(amount / daily)) : 0;
    const days = daysFromAmount || Math.max(0, Number(vehicle?.unpaidDays || 0));
    return { isUnpaid: open || amount > 0 || days > 0, isHolding: false, amount, days, mode: 'arrear' };
  }

  function sortContracts(list) {
    const sort = state.contractSort || { key: 'updatedAt', dir: 'desc' };
    const factor = sort.dir === 'asc' ? 1 : -1;
    const valueOf = (contract) => {
      switch (sort.key) {
        case 'vehicleNumber':
          return String(contract.vehicleNumber || erp()?.vehicles().getById(contract.vehicleId)?.vehicleNumber || '');
        case 'driverName':
          return String(contract.driverName || '');
        case 'dailyRent':
          return Number(contractRiderWeeklyCharge(contract) || 0);
        case 'unpaid':
          return Number(contractUnpaidInfo(contract).amount || 0);
        default:
          return String(contract.updatedAt || '');
      }
    };
    return list.slice().sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
      return String(va).localeCompare(String(vb), 'ko') * factor;
    });
  }

  function updateContractSortIndicators() {
    const sort = state.contractSort || { key: 'updatedAt', dir: 'desc' };
    document.querySelectorAll('[data-contract-sort]').forEach(th => {
      const active = th.dataset.contractSort === sort.key;
      th.classList.toggle('is-active', active);
      th.setAttribute('data-dir', active ? sort.dir : '');
    });
  }

  function renderContractList() {
    const rowsEl = $('leaseContractRows');
    if (!rowsEl || !erp()) return;
    const allContracts = sortContracts(erp().contracts().getAll());
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
      rowsEl.innerHTML = `<tr><td colspan="11" class="empty">${allContracts.length ? '검색 결과가 없습니다.' : '등록된 계약이 없습니다. 차량을 선택해 렌탈/리스자를 등록하세요.'}</td></tr>`;
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
      const period = formatContractPeriodLabel(contract);
      const returnDate = formatDate(contract.returnDate || (String(contract.status || '') === 'ended' ? contract.endDate : ''));
      const statusHtml = renderStatusTagsHtml(vehicle, contract);
      const ended = String(contract.status || '') === (erp()?.CONTRACT_STATUS?.ENDED || 'ended');
      const isDeleting = deleting && (deleting === contract.id || deleting === 'all');
      const unpaid = contractUnpaidInfo(contract);
      const unpaidTag = unpaid.isHolding
        ? ` <span class="lease-status-badge lease-status-badge--collecting lease-unpaid-tag">급여차감 ${unpaid.days}일 ${formatMoney(unpaid.amount)}</span>`
        : (unpaid.isUnpaid
          ? ` <span class="lease-status-badge lease-status-badge--unpaid lease-unpaid-tag">미납${unpaid.amount > 0 ? ' ' + formatMoney(unpaid.amount) : ''}${unpaid.days > 0 ? ` · ${unpaid.days}일` : ''}</span>`
          : '');
      const rowUnpaidClass = (unpaid.isUnpaid || unpaid.isHolding) ? ' lease-contract-row--unpaid' : '';
      const weeklyLease = vehicleWeeklyLeaseCost(vehicle);
      const weeklyCharge = contractRiderWeeklyCharge(contract);
      const margin = weeklyCharge - weeklyLease;
      const marginCls = margin < 0 ? 'lease-money--deficit' : (margin > 0 ? 'lease-money--profit' : '');
      const driverLabel = ended
        ? escapeHtml(contract.driverName || '-')
        : escapeHtml(formatDriverContractLabel(contract.driverName || '-'));
      return `
        <tr class="${ended ? 'lease-contract-row--ended' : ''}${rowUnpaidClass}">
          <td><strong>${escapeHtml(contract.vehicleNumber || vehicle?.vehicleNumber || '-')}</strong></td>
          <td>${contractDealTypeBadge(contract)} ${escapeHtml(typeLabel)}</td>
          <td>${driverLabel}${unpaidTag}</td>
          <td>${escapeHtml(contract.driverPhone || '-')}</td>
          <td>${escapeHtml(period)}</td>
          <td>${returnDate !== '-' ? escapeHtml(returnDate) : '-'}</td>
          <td>${formatMoney(weeklyLease)}</td>
          <td>${formatMoney(weeklyCharge)}</td>
          <td class="${marginCls}">${formatMoney(margin)}</td>
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
      const existingContract = draft.id ? erp().contracts().getById(draft.id) : null;
      // 신규 등록 기본 = 미반영(수기납부). BREM ERP 차감은 「ERP차감 ON」에서만.
      const finalApplyEnabled = existingContract
        ? isContractFinalApplyEnabled(existingContract)
        : false;
      const contractPayload = {
        ...draft,
        ...statusPatch,
        vehicleId: vehicle.id,
        finalApplyEnabled,
        rawData: {
          ...(existingContract?.rawData || {}),
          ...(draft.rawData || {}),
          deductStartDate: draft.deductStartDate || existingContract?.rawData?.deductStartDate || draft.startDate || '',
          finalApplyEnabled
        }
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
      if ($('leaseRentalDealStartDate') && contract.startDate) {
        $('leaseRentalDealStartDate').value = contract.startDate;
      }
      refreshContractDateLabels();

      // 1) 즉시 페인트: 계약 목록과 폼만 먼저 그려 바로 리스트에 내려가게 한다.
      const wasEdit = Boolean(draft.id);
      $('leaseContractEditId').value = contract.id;
      fillContractForm(contract);
      renderContractList();
      document.querySelector('.lease-contract-list-wrap')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      state.contractSaving = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
      }
      showToast(wasEdit
        ? '계약을 수정했습니다. Supabase 저장을 눌러주세요.'
        : '계약을 추가했습니다(기본 수기납부). 납부확인에 표시됩니다. Supabase 저장을 눌러주세요.');

      // 2) 손익 스냅샷·대시보드·차량목록은 다음 틱으로 미룬다. (원격 저장은 Supabase 저장 버튼)
      setTimeout(() => {
        try {
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
          updateLeaseErpUnsavedBanner();
          // 계약 목록은 이미 그렸으므로 대시보드·차량목록만 갱신한다.
          refreshAfterLeaseMutation({ contract: false });
        } catch (deferredError) {
          console.error('[saveContract deferred]', deferredError);
        }
      }, 0);
    } catch (error) {
      console.error('[saveContract]', error);
      showToast(error?.message || '계약 저장에 실패했습니다. 잠시 후 다시 시도하세요.');
      state.contractSaving = false;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
      }
    }
  }

  // 계약 백그라운드 저장: 연속 등록 시 UI를 막지 않는다.
  let contractPersistInFlight = false;
  let contractPersistQueued = false;
  async function persistContractInBackground() {
    if (contractPersistInFlight) {
      contractPersistQueued = true;
      return;
    }
    contractPersistInFlight = true;
    try {
      await erp().persistAll({ skipFlushStorage: true });
    } catch (error) {
      console.error('[persistContractInBackground]', error);
      showToast(error?.message || '계약 저장에 실패했습니다. 새로고침 후 다시 시도하세요.');
    } finally {
      contractPersistInFlight = false;
      if (contractPersistQueued) {
        contractPersistQueued = false;
        void persistContractInBackground();
      } else {
        updateLeaseErpUnsavedBanner();
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
      refreshContractDateLabels();

      markArrearContractOptionsDirty();
      await erp().persistAll({ skipFlushStorage: true });
      updateLeaseErpUnsavedBanner();
      refreshAfterLeaseMutation({ contract: true });
      showToast(returnDate <= today
        ? `중도반납 처리 · 반납일 ${returnDate} · 계약 종료`
        : `반납 예약 · ${returnDate}까지 운행 중`);
      syncContractCalc();
    } catch (error) {
      console.error('[processEarlyReturn]', error);
      showToast(error?.message || '중도반납 처리에 실패했습니다.');
    }
  }

  function normalizeContractDate(value) {
    return erp()?.normalizeDate?.(value) || String(value || '').trim().slice(0, 10);
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
    state.contractVehicleSearch = '';
    clearLeaseContractVehicleSelection();
    if ($('leaseContractVehicleSearch')) $('leaseContractVehicleSearch').value = '';
    if ($('leaseContractVehicleResults')) {
      $('leaseContractVehicleResults').hidden = true;
      $('leaseContractVehicleResults').innerHTML = '';
    }
    document.querySelectorAll('input[name="leaseContractDealType"]').forEach(input => {
      input.checked = input.value === 'lease';
    });
    setContractDeductionPlatform('coupang');
    if ($('leaseContractDeposit')) $('leaseContractDeposit').value = '';
    if ($('leaseContractReturnDate')) $('leaseContractReturnDate').value = '';
    state.contractFormSnapshot = null;
    refreshContractDateLabels();
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

  function loanPaidDateKey(loan) {
    const paidAt = String(loan?.paidAt || loan?.rawData?.paidAt || '').slice(0, 10);
    if (paidAt) return paidAt;
    if (loanPaymentStatus(loan).code !== 'paid') return '';
    return String(loan?.updatedAt || '').slice(0, 10);
  }

  function loanProfitMetrics(loan) {
    const principal = Math.max(0, Math.round(Number(loan?.principal || 0)));
    const interest = Math.max(0, Math.round(Number(loan?.interest || 0)));
    const total = Math.max(0, Math.round(Number(
      loan?.totalAmount != null ? loan.totalAmount : principal + interest
    )));
    const collected = Math.max(0, Math.round(Number(loan?.externalPaid || 0))) || total;
    return {
      principal,
      interest,
      total,
      collected,
      profit: interest
    };
  }

  function listPaidLoansInPeriod(periodStart, periodEnd) {
    const start = String(periodStart || '').slice(0, 10);
    const end = String(periodEnd || '').slice(0, 10);
    if (!start || !end) return [];
    return (window.BremStorage?.leaseLoans?.getAll?.() || [])
      .filter(loan => loanPaymentStatus(loan).code === 'paid')
      .map(loan => ({
        loan,
        paidDate: loanPaidDateKey(loan),
        ...loanProfitMetrics(loan)
      }))
      .filter(row => row.paidDate && row.paidDate >= start && row.paidDate <= end)
      .sort((a, b) => String(b.paidDate).localeCompare(String(a.paidDate)));
  }

  function syncLeaseLoanWeeklyWeekUi(weekStart) {
    const normalized = String(
      BremDatePicker?.applyWeekWednesday?.(weekStart)
      || weekStart
      || currentWeekStart()
      || ''
    ).slice(0, 10);
    if ($('leaseLoanWeekStart')) $('leaseLoanWeekStart').value = normalized;
    state.weekStart = normalized;
    const rangeLabel = formatLeaseWeekRangeLabel(normalized);
    if ($('leaseLoanWeekRangePreview')) $('leaseLoanWeekRangePreview').textContent = rangeLabel;
    if ($('leaseLoanWeekStartLabel')) {
      if (!normalized) {
        $('leaseLoanWeekStartLabel').textContent = '수요일 선택';
      } else if (BremDatePicker?.formatDate && BremDatePicker?.formatWeekdayKo) {
        const wednesday = BremDatePicker.applyWeekWednesday(normalized);
        const weekday = BremDatePicker.formatWeekdayKo(wednesday);
        $('leaseLoanWeekStartLabel').textContent = weekday
          ? `${BremDatePicker.formatDate(wednesday)}(${weekday})`
          : BremDatePicker.formatDate(wednesday);
      } else {
        $('leaseLoanWeekStartLabel').textContent = normalized;
      }
    }
    return normalized;
  }

  function handleLoanWeeklyWeekChange(weekStart) {
    syncLeaseLoanWeeklyWeekUi(weekStart);
    renderWeeklyLoan();
  }

  function renderLoanProfitSummary(prefix, rows) {
    const totals = rows.reduce((acc, row) => {
      acc.count += 1;
      acc.principal += row.principal;
      acc.collected += row.collected;
      acc.profit += row.profit;
      return acc;
    }, { count: 0, principal: 0, collected: 0, profit: 0 });
    const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
    setText(`${prefix}Count`, `${totals.count}건`);
    setText(`${prefix}Principal`, formatMoney(totals.principal));
    setText(`${prefix}Collected`, formatMoney(totals.collected));
    setText(`${prefix}Profit`, formatMoney(totals.profit));
    return totals;
  }

  function renderLoanProfitTableRows(rowsEl, rows, emptyMessage) {
    if (!rowsEl) return;
    if (!rows.length) {
      rowsEl.innerHTML = `<tr><td colspan="10" class="empty">${escapeHtml(emptyMessage)}</td></tr>`;
      return;
    }
    rowsEl.innerHTML = rows.map(row => {
      const loan = row.loan || {};
      return `<tr>
        <td>${formatDate(row.paidDate)}</td>
        <td><strong>${escapeHtml(loan.driverName || '-')}</strong></td>
        <td>${escapeHtml(loan.driverPhone || '-')}</td>
        <td>${formatMoney(row.principal)}</td>
        <td>${formatMoney(row.interest)}</td>
        <td>${formatMoney(row.total)}</td>
        <td>${formatMoney(row.collected)}</td>
        <td class="${moneyClass(row.profit)}"><strong>${formatMoney(row.profit)}</strong></td>
        <td>${escapeHtml(loan.reason || '-')}</td>
        <td><span class="lease-status--done">완납</span></td>
      </tr>`;
    }).join('');
  }

  function renderWeeklyLoan() {
    const rowsEl = $('leaseLoanWeeklyRows');
    if (!rowsEl) return;
    const weekStart = syncLeaseLoanWeeklyWeekUi(
      $('leaseLoanWeekStart')?.value || state.weekStart || currentWeekStart()
    );
    const week = calc()?.weekRange?.(weekStart) || { start: weekStart, end: weekStart };
    const rows = listPaidLoansInPeriod(week.start, week.end);
    renderLoanProfitSummary('leaseLoanWeek', rows);
    renderLoanProfitTableRows(
      rowsEl,
      rows,
      '이 주에 완납 처리된 대여 건이 없습니다. 납부 확인 → 대여 탭에서 완납 처리하세요.'
    );
  }

  function renderMonthlyLoan() {
    const rowsEl = $('leaseLoanMonthlyRows');
    if (!rowsEl) return;
    const monthKey = $('leaseLoanMonthKey')?.value || state.monthKey || currentMonthKey();
    state.monthKey = monthKey;
    if ($('leaseLoanMonthKey') && !$('leaseLoanMonthKey').value) $('leaseLoanMonthKey').value = monthKey;
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(calc().daysInMonth(monthKey)).padStart(2, '0')}`;
    const rows = listPaidLoansInPeriod(monthStart, monthEnd);
    renderLoanProfitSummary('leaseLoanMonth', rows);
    renderLoanProfitTableRows(
      rowsEl,
      rows,
      '이 달에 완납 처리된 대여 건이 없습니다. 납부 확인 → 대여 탭에서 완납 처리하세요.'
    );
  }

  function exportWeeklyLoanExcel() {
    if (!window.XLSX) return;
    const weekStart = $('leaseLoanWeekStart')?.value || state.weekStart || currentWeekStart();
    const week = calc()?.weekRange?.(weekStart) || { start: weekStart, end: weekStart };
    const rows = listPaidLoansInPeriod(week.start, week.end).map(row => [
      row.paidDate,
      row.loan?.driverName || '',
      row.loan?.driverPhone || '',
      row.principal,
      row.interest,
      row.total,
      row.collected,
      row.profit,
      row.loan?.reason || '',
      '완납'
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([
      ['완납일', '기사', '연락처', '원금', '이자', '합계', '수납', '이익(이자)', '사유', '상태'],
      ...rows
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, '주간수익(대여)');
    XLSX.writeFile(wb, `BREM_주간수익_대여_${weekStart}.xlsx`);
  }

  function exportMonthlyLoanExcel() {
    if (!window.XLSX) return;
    const monthKey = $('leaseLoanMonthKey')?.value || state.monthKey || currentMonthKey();
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(calc().daysInMonth(monthKey)).padStart(2, '0')}`;
    const rows = listPaidLoansInPeriod(monthStart, monthEnd).map(row => [
      row.paidDate,
      row.loan?.driverName || '',
      row.loan?.driverPhone || '',
      row.principal,
      row.interest,
      row.total,
      row.collected,
      row.profit,
      row.loan?.reason || '',
      '완납'
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([
      ['완납일', '기사', '연락처', '원금', '이자', '합계', '수납', '이익(이자)', '사유', '상태'],
      ...rows
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, '월간수익(대여)');
    XLSX.writeFile(wb, `BREM_월간수익_대여_${monthKey}.xlsx`);
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
    const identity = contractDriverIdentity(contract);
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
          ...identity,
          arrearReason: openForContract.rawData?.arrearReason || '리스비 미납',
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
          ...identity,
          arrearReason: '리스비 미납',
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
      await erp().persistAll({ skipFlushStorage: true });
      $('leaseArrearRegisterForm')?.reset();
      syncArrearWeekUi(savedWeek);
      updateLeaseErpUnsavedBanner();
      showToast(openForContract ? '미납이 누적 등록되었습니다.' : '미납을 등록했습니다.');
      renderArrears();
      refreshAfterLeaseMutation({ contract: false });
    } catch (error) {
      console.error('[registerArrear]', error);
      showToast(error?.message || '미납 저장에 실패했습니다.');
    } finally {
      if (registerBtn) {
        registerBtn.disabled = false;
        registerBtn.textContent = '미납 등록';
      }
    }
  }

  // 미납이 기사앱 출금/주급명세서에 매칭되도록 계약의 기사 식별자를 rawData에 심는다.
  function contractDriverIdentity(contract) {
    return {
      driverId: String(contract?.driverId || contract?.rawData?.driverId || '').trim(),
      driverName: String(contract?.driverName || contract?.rawData?.driverName || '').trim(),
      driverPhone: String(contract?.driverPhone || contract?.rawData?.driverPhone || '').trim()
    };
  }

  // 선택 주(수~화) 안에서 계약이 활성인 일수(오늘까지만 카운트). 차감시작일 반영.
  function contractActiveDaysInWeek(contract, weekStart) {
    const range = calc()?.weekRange?.(weekStart);
    if (!range?.start || !range?.end) return 0;
    const contractStart = String(contract.startDate || contract.rawData?.startDate || '').slice(0, 10);
    const deductStart = String(contract.rawData?.deductStartDate || contract.deductStartDate || '').slice(0, 10);
    const cStart = [contractStart, deductStart].filter(Boolean).sort().pop() || '';
    const cEnd = String(contract.returnDate || contract.endDate || '').slice(0, 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cur = new Date(`${range.start}T00:00:00`);
    const end = new Date(`${range.end}T00:00:00`);
    let days = 0;
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
      const afterStart = !cStart || key >= cStart;
      const beforeEnd = !cEnd || key <= cEnd;
      const notFuture = cur.getTime() <= today.getTime();
      if (afterStart && beforeEnd && notFuture) days += 1;
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

    // 주정산(수~화) 반영 시 리스비 미차감분을 미납/회수에 일괄 등록
    // 「대여 및 차감관리」에서 반영된 계약은 직계약 정산결과 리스비 공제로 처리하므로 여기 자동등록에서 제외(이중 공제 방지)
    async function bulkRegisterWeeklyLeaseArrears() {
    if (!erp()) return;
    const weekStart = syncArrearWeekUi($('leaseArrearWeekStart')?.value || state.arrearWeekStart);
    if (!weekStart) {
      showToast('미납주(수~화)를 먼저 선택하세요.');
      return;
    }
    const completed = calc().ARREAR_STATUS.COMPLETED;
    const allArrears = erp().arrears().getAll();
    const candidates = [];
    let skippedApplied = 0;
    erp().contracts().getAll().forEach(contract => {
      if (isContractFinalApplyEnabled(contract)) {
        skippedApplied += 1;
        return;
      }
      const days = contractActiveDaysInWeek(contract, weekStart);
      if (days <= 0) return;
      const charge = Math.round(Number(contractRiderDailyRent(contract) || 0) * days);
      if (charge <= 0) return;
      // 같은 주에 이미 자동 등록된 계약은 건너뛴다(중복 방지)
      const already = allArrears.some(item =>
        item.contractId === contract.id && item.rawData?.weeklyAutoWeek === weekStart
      );
      if (already) return;
      candidates.push({ contract, days, charge });
    });
    if (!candidates.length) {
      showToast(skippedApplied
        ? `이번 주 신규 미납 없음 · 반영 계약 ${skippedApplied}건은 직계약 리스비 공제 대상이라 제외`
        : '이번 주에 신규 등록할 리스 미납이 없습니다.');
      return;
    }
    const total = candidates.reduce((sum, item) => sum + item.charge, 0);
    const skipNote = skippedApplied
      ? `\n(차감 반영 ${skippedApplied}건은 이중 공제 방지를 위해 제외)`
      : '';
    if (!window.confirm(
      `주정산(${weekStart}~) 리스비 미납 ${candidates.length}건 · 합계 ${formatMoney(total)} 을 미납/회수에 등록할까요?${skipNote}\n`
      + '※ 급여차감「반영」계약은 제외됩니다. 반영분은 주정산 리스차감 → 마이너스 시 소급분에서 선택 차감하세요.'
    )) return;

    candidates.forEach(({ contract, days, charge }) => {
      const identity = contractDriverIdentity(contract);
      const weekEntry = { weekStart, unpaidDays: days, unpaidAmount: charge, at: new Date().toISOString(), source: 'weekly-auto' };
      const openForContract = allArrears.find(item =>
        item.contractId === contract.id && String(item.collectionStatus || '') !== completed
      );
      if (openForContract) {
        const weekEntries = Array.isArray(openForContract.rawData?.weekEntries)
          ? [...openForContract.rawData.weekEntries]
          : [];
        weekEntries.push(weekEntry);
        erp().arrears().update(openForContract.id, {
          unpaidDays: Number(openForContract.unpaidDays || 0) + days,
          unpaidAmount: Number(openForContract.unpaidAmount || 0) + charge,
          collectionMethods: [...new Set([...(openForContract.collectionMethods || []), 'separate_deposit'])],
          collectionStatus: calc().ARREAR_STATUS.COLLECTING,
          rawData: {
            ...(openForContract.rawData || {}),
            ...identity,
            arrearReason: '주정산 리스비 미납',
            unpaidWeekStart: openForContract.rawData?.unpaidWeekStart || weekStart,
            weeklyAutoWeek: weekStart,
            source: openForContract.rawData?.source || 'weekly-auto',
            weekEntries
          }
        });
      } else {
        erp().arrears().create({
          vehicleId: contract.vehicleId,
          contractId: contract.id,
          unpaidDays: days,
          unpaidAmount: charge,
          unpaidWeekStart: weekStart,
          collectionMethods: ['separate_deposit'],
          collectionStatus: calc().ARREAR_STATUS.COLLECTING,
          rawData: { ...identity, arrearReason: '주정산 리스비 미납', unpaidWeekStart: weekStart, weeklyAutoWeek: weekStart, source: 'weekly-auto', weekEntries: [weekEntry] }
        });
      }
    });

    const bulkBtn = $('leaseArrearBulkWeeklyBtn');
    if (bulkBtn) {
      bulkBtn.disabled = true;
      bulkBtn.textContent = '등록 중…';
    }
    try {
      await erp().persistAll({ skipFlushStorage: true });
      updateLeaseErpUnsavedBanner();
      renderArrears();
      refreshAfterLeaseMutation({ contract: false });
      showToast(`리스비 미납 ${candidates.length}건 등록 완료 · 합계 ${formatMoney(total)}`);
    } catch (error) {
      console.error('[bulkRegisterWeeklyLeaseArrears]', error);
      showToast(error?.message || '리스비 미납 일괄 등록에 실패했습니다.');
    } finally {
      if (bulkBtn) {
        bulkBtn.disabled = false;
        bulkBtn.textContent = '이번주 리스비 미납 일괄 등록';
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

  function paymentConfirmMemo(weekStart) {
    return `${PAYMENT_CONFIRM_MEMO_PREFIX}${String(weekStart || '').slice(0, 10)}`;
  }

  function findWeekPaymentConfirm(vehicleId, weekStart) {
    if (!erp() || !vehicleId || !weekStart) return null;
    const memo = paymentConfirmMemo(weekStart);
    const week = String(weekStart).slice(0, 10);
    return erp().payments().getAll().find(item => {
      if (String(item.vehicleId || '') !== String(vehicleId)) return false;
      if (String(item.memo || '').startsWith(memo)) return true;
      return String(item.dueDate || '').slice(0, 10) === week
        && String(item.memo || '').includes('납부확인');
    }) || null;
  }

  function contractDeductStartDate(contract) {
    const raw = contract?.rawData || {};
    const explicit = String(raw.deductStartDate || contract?.deductStartDate || '').slice(0, 10);
    if (explicit) return explicit;
    return String(contract?.startDate || raw.startDate || '').slice(0, 10);
  }

  function isContractFinalApplyEnabled(contract) {
    if (!contract) return false;
    if (contract.finalApplyEnabled != null) return Boolean(contract.finalApplyEnabled);
    return Boolean(contract.rawData?.finalApplyEnabled);
  }

  function syncDeductionTabUi() {
    const tab = ['lease', 'loan', 'manage'].includes(state.deductionTab) ? state.deductionTab : 'lease';
    state.deductionTab = tab;
    document.querySelectorAll('[data-deduction-tab]').forEach(btn => {
      const active = btn.dataset.deductionTab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-deduction-pane]').forEach(pane => {
      pane.hidden = pane.dataset.deductionPane !== tab;
    });
  }

  function renderDeductionActivePane() {
    if (state.deductionTab === 'loan') {
      renderDeductionLoan();
      return;
    }
    if (state.deductionTab === 'manage') {
      renderDeductionManage();
      return;
    }
    renderDeductionLease();
  }

  function updateDeductionLeaseBulkUi() {
    const applyBtn = $('leaseDeductionLeaseBulkApplyBtn');
    const clearBtn = $('leaseDeductionLeaseBulkClearBtn');
    const selectAll = $('leaseDeductionLeaseSelectAll');
    const count = state.deductionLeaseSelectedIds.size;
    if (applyBtn) {
      applyBtn.disabled = count <= 0;
      applyBtn.textContent = count > 0 ? `선택 ERP차감 ON (${count})` : '선택 ERP차감 ON';
    }
    if (clearBtn) {
      clearBtn.disabled = count <= 0;
      clearBtn.textContent = count > 0 ? `선택 수기납부 (${count})` : '선택 수기납부';
    }
    if (selectAll) {
      const boxes = document.querySelectorAll('[data-deduction-lease-select]');
      const enabled = [...boxes].filter(el => !el.disabled);
      selectAll.checked = enabled.length > 0 && enabled.every(el => el.checked);
      selectAll.indeterminate = count > 0 && !selectAll.checked;
    }
  }

  async function setContractFinalApply(contractId, enabled, options = {}) {
    if (!erp() || !contractId) return false;
    const contract = erp().contracts().getById(contractId);
    if (!contract) {
      if (!options.silent) showToast('계약을 찾을 수 없습니다.');
      return false;
    }
    const nextEnabled = Boolean(enabled);
    const rawData = {
      ...(contract.rawData || {}),
      finalApplyEnabled: nextEnabled,
      finalAppliedAt: nextEnabled ? new Date().toISOString() : (contract.rawData?.finalAppliedAt || ''),
      finalAppliedBy: nextEnabled ? 'admin' : (contract.rawData?.finalAppliedBy || ''),
      finalClearedAt: nextEnabled ? '' : new Date().toISOString()
    };
    if (options.deductStartDate != null) {
      rawData.deductStartDate = String(options.deductStartDate || '').slice(0, 10);
    }
    erp().contracts().update(contractId, {
      finalApplyEnabled: nextEnabled,
      rawData
    });
    if (!options.skipPersist) {
      try {
        await erp().persistAll({ skipFlushStorage: true });
      } catch (error) {
        console.error('[setContractFinalApply]', error);
        if (!options.silent) showToast(error?.message || '반영 상태 저장에 실패했습니다.');
        return false;
      }
      updateLeaseErpUnsavedBanner();
    }
    if (!options.silent) {
      showToast(nextEnabled
        ? `${formatDriverContractLabel(contract.driverName || '기사')} · ERP차감 ON (정산·출금 차감)`
        : `${formatDriverContractLabel(contract.driverName || '기사')} · 수기납부 (ERP 차감 안 함)`);
      renderDeductionLease();
      renderDeductionManage();
      refreshAfterLeaseMutation({ contract: false });
    }
    return true;
  }

  async function bulkSetContractFinalApply(enabled) {
    const ids = [...state.deductionLeaseSelectedIds].map(String).filter(Boolean);
    if (!ids.length) {
      showToast('계약을 선택하세요.');
      return;
    }
    const label = enabled ? 'ERP차감 ON' : '수기납부';
    if (!window.confirm(`선택한 ${ids.length}건을 ${label}로 바꿀까요?\n${enabled ? '정산·출금에서 리스 차감됩니다.' : 'ERP 차감 안 함 · 납부확인에서 수기 처리합니다.'}`)) return;
    let ok = 0;
    for (const id of ids) {
      const done = await setContractFinalApply(id, enabled, { skipPersist: true, silent: true });
      if (done) ok += 1;
    }
    try {
      await erp().persistAll({ skipFlushStorage: true });
    } catch (error) {
      console.error('[bulkSetContractFinalApply]', error);
      showToast(error?.message || `일괄 ${label} 저장에 실패했습니다.`);
      return;
    }
    state.deductionLeaseSelectedIds.clear();
    updateLeaseErpUnsavedBanner();
    showToast(`${label} ${ok}건`);
    renderDeductionLease();
    refreshAfterLeaseMutation({ contract: false });
  }

  function renderDeductionLease() {
    const rowsEl = $('leaseDeductionLeaseRows');
    const summaryEl = $('leaseDeductionLeaseSummary');
    if (!rowsEl || !erp()) return;
    const weekStart = currentWeekStart();
    const vehicles = new Map(erp().vehicles().getAll().map(item => [item.id, item]));
    let contracts = getActivePaymentContracts();
    const keyword = String(state.deductionLeaseSearch || $('leaseDeductionLeaseSearch')?.value || '').trim().toLowerCase();
    if (keyword) {
      contracts = contracts.filter(contract => {
        const vehicle = vehicles.get(contract.vehicleId);
        const hay = [
          contract.driverName,
          contract.driverPhone,
          contract.vehicleNumber,
          vehicle?.vehicleNumber,
          vehicle?.model,
          contract.modelType
        ].join(' ').toLowerCase();
        return hay.includes(keyword);
      });
    }
    const appliedCount = contracts.filter(isContractFinalApplyEnabled).length;
    if (summaryEl) {
      summaryEl.textContent = `계약 ${contracts.length}건 · ERP차감 ${appliedCount}건 · 수기납부 ${contracts.length - appliedCount}건 · ${formatPaymentWeekColumn(weekStart)}`;
    }
    const visibleIds = new Set(contracts.map(c => String(c.id)));
    [...state.deductionLeaseSelectedIds].forEach(id => {
      if (!visibleIds.has(String(id))) state.deductionLeaseSelectedIds.delete(String(id));
    });
    if (!contracts.length) {
      rowsEl.innerHTML = '<tr><td colspan="11" class="empty">활성 계약이 없습니다. 계약/렌탈에서 먼저 배정하세요.</td></tr>';
      updateDeductionLeaseBulkUi();
      return;
    }
    rowsEl.innerHTML = contracts.map(contract => {
      const vehicle = vehicles.get(contract.vehicleId);
      const daily = contractRiderDailyRent(contract);
      const days = contractActiveDaysInWeek(contract, weekStart);
      const charge = Math.round(daily * days);
      const applied = isContractFinalApplyEnabled(contract);
      const startDate = contractDeductStartDate(contract);
      const checked = state.deductionLeaseSelectedIds.has(String(contract.id)) ? ' checked' : '';
      const rowSelected = checked ? ' class="row-selected"' : '';
      return `<tr${rowSelected}>
        <td class="lease-check-col">
          <input type="checkbox" data-deduction-lease-select="${escapeHtml(contract.id)}"${checked}>
        </td>
        <td>${escapeHtml(vehicle?.vehicleNumber || contract.vehicleNumber || '-')}</td>
        <td>${escapeHtml(vehicle?.model || contract.modelType || '-')}</td>
        <td>${escapeHtml(formatDriverContractLabel(contract.driverName || '-'))}</td>
        <td>${escapeHtml(contract.driverPhone || '-')}</td>
        <td>${formatMoney(daily)}</td>
        <td><input type="date" class="admin-period-input" data-lease-deduct-start="${escapeHtml(contract.id)}" value="${escapeHtml(startDate)}" title="일차감 시작일"></td>
        <td>${days}일</td>
        <td>${formatMoney(charge)}</td>
        <td><span class="${applied ? 'lease-status--done' : 'lease-status--collecting'}">${applied ? 'ERP차감' : '수기납부'}</span></td>
        <td class="lease-payment-confirm-actions">
          ${applied
    ? `<button type="button" class="small-btn" data-deduction-lease-clear="${escapeHtml(contract.id)}" title="ERP 차감 끄고 납부확인 수기 처리">수기납부</button>`
    : `<button type="button" class="small-btn primary-btn" data-deduction-lease-apply="${escapeHtml(contract.id)}" title="정산·출금에서 리스 차감">ERP차감 ON</button>`}
        </td>
      </tr>`;
    }).join('');
    updateDeductionLeaseBulkUi();
  }

  function todayDateInputValue() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function resetLoanForm() {
    if ($('leaseLoanEditId')) $('leaseLoanEditId').value = '';
    if ($('leaseLoanDriverId')) $('leaseLoanDriverId').value = '';
    if ($('leaseLoanDriverSearch')) $('leaseLoanDriverSearch').value = '';
    if ($('leaseLoanDriverName')) $('leaseLoanDriverName').value = '';
    if ($('leaseLoanDriverPhone')) $('leaseLoanDriverPhone').value = '';
    if ($('leaseLoanPrincipal')) $('leaseLoanPrincipal').value = '';
    if ($('leaseLoanInterest')) $('leaseLoanInterest').value = '0';
    if ($('leaseLoanTotalAmount')) $('leaseLoanTotalAmount').value = '';
    if ($('leaseLoanDailyDeduct')) $('leaseLoanDailyDeduct').value = '';
    if ($('leaseLoanBalance')) $('leaseLoanBalance').value = '';
    if ($('leaseLoanReason')) $('leaseLoanReason').value = '';
    if ($('leaseLoanDeductStartDate')) $('leaseLoanDeductStartDate').value = todayDateInputValue();
    if ($('leaseLoanDeductEndDate')) $('leaseLoanDeductEndDate').value = '';
    if ($('leaseLoanLastDayAmount')) $('leaseLoanLastDayAmount').value = '';
    const hint = $('leaseLoanScheduleHint');
    if (hint) {
      hint.textContent = '원금·이자·일 차감·시작일을 넣으면 합계 기준으로 종료일과 마지막날 차감액이 자동 계산됩니다. 예: (100만+이자)÷3만 → 일수×3만 + 마지막날 나머지.';
    }
    const selected = $('leaseLoanDriverSelected');
    if (selected) selected.textContent = '선택: 없음';
    const results = $('leaseLoanDriverResults');
    if (results) { results.hidden = true; results.innerHTML = ''; }
    const submit = $('leaseLoanForm')?.querySelector('button[type="submit"]');
    if (submit) submit.textContent = '대여 등록';
  }

  function loanFormTotalAmount() {
    const principal = Math.max(0, Math.round(Number($('leaseLoanPrincipal')?.value || 0)));
    const interest = Math.max(0, Math.round(Number($('leaseLoanInterest')?.value || 0)));
    return principal + interest;
  }

  function syncLoanTotalPreview() {
    const total = loanFormTotalAmount();
    const totalEl = $('leaseLoanTotalAmount');
    if (totalEl) totalEl.value = total > 0 ? formatMoney(total) : '';
    return total;
  }

  function syncLoanSchedulePreview() {
    const principal = Math.max(0, Math.round(Number($('leaseLoanPrincipal')?.value || 0)));
    const interest = Math.max(0, Math.round(Number($('leaseLoanInterest')?.value || 0)));
    const totalAmount = syncLoanTotalPreview();
    const dailyDeduct = Math.max(0, Math.round(Number($('leaseLoanDailyDeduct')?.value || 0)));
    let deductStartDate = String($('leaseLoanDeductStartDate')?.value || '').trim();
    // type=date 외 로케일 표기(2026. 08. 05.)가 들어오면 ISO로 정규화
    const loose = deductStartDate.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (loose && !/^\d{4}-\d{2}-\d{2}$/.test(deductStartDate.slice(0, 10))) {
      deductStartDate = `${loose[1]}-${String(loose[2]).padStart(2, '0')}-${String(loose[3]).padStart(2, '0')}`;
    } else {
      deductStartDate = deductStartDate.slice(0, 10);
    }
    const compute = window.BremStorage?.computeLoanDeductSchedule;
    const schedule = typeof compute === 'function'
      ? compute({ amount: totalAmount, principal: totalAmount, dailyDeduct, deductStartDate })
      : { ok: false };
    const endEl = $('leaseLoanDeductEndDate');
    const lastEl = $('leaseLoanLastDayAmount');
    const hint = $('leaseLoanScheduleHint');
    if (!schedule?.ok) {
      if (endEl) endEl.value = '';
      if (lastEl) lastEl.value = '';
      const endLabel = $('leaseLoanDeductEndDateLabel');
      if (endLabel) endLabel.textContent = '자동 계산';
      if (hint && totalAmount > 0 && dailyDeduct > 0) {
        hint.textContent = deductStartDate
          ? '종료일 계산 실패 · 원금·이자·일 차감·시작일을 다시 확인하세요.'
          : '시작일을 입력하면 종료일·마지막날 차감이 계산됩니다.';
      } else if (hint && principal > 0 && !dailyDeduct) {
        hint.textContent = `합계 ${formatMoney(totalAmount)} (원금 ${formatMoney(principal)} + 이자 ${formatMoney(interest)}) · 일 차감액을 입력하세요.`;
      }
      return null;
    }
    if (endEl) {
      endEl.value = schedule.deductEndDate;
      const endLabel = $('leaseLoanDeductEndDateLabel');
      if (endLabel) endLabel.textContent = formatDate(schedule.deductEndDate);
      endEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (lastEl) lastEl.value = formatMoney(schedule.lastDayAmount);
    if (hint) {
      const remNote = schedule.lastDayAmount !== schedule.dailyDeduct
        ? ` · 마지막날 ${formatMoney(schedule.lastDayAmount)}(=일 ${formatMoney(schedule.dailyDeduct)}+나머지)`
        : ` · 매일 ${formatMoney(schedule.dailyDeduct)}`;
      hint.textContent = `합계 ${formatMoney(totalAmount)} (원금 ${formatMoney(principal)} + 이자 ${formatMoney(interest)}) · 총 ${schedule.days}일 (${schedule.deductStartDate} ~ ${schedule.deductEndDate})${remNote} · 스케줄합 ${formatMoney(schedule.total)} (${schedule.ok ? '✓' : '✗'})`;
    }
    return schedule;
  }

  function pickLoanDriver(driver) {
    if (!driver) return;
    if ($('leaseLoanDriverId')) $('leaseLoanDriverId').value = driver.id || '';
    if ($('leaseLoanDriverName')) $('leaseLoanDriverName').value = driver.name || '';
    if ($('leaseLoanDriverPhone')) $('leaseLoanDriverPhone').value = driver.phone || '';
    const selected = $('leaseLoanDriverSelected');
    if (selected) {
      selected.textContent = `선택: ${driver.name || '-'} · ${driver.phone || '-'} · 쿠팡 ${makeDriverLoginId(driver) || '-'} · 배민 ${driver.baeminId || '-'}`;
    }
    const results = $('leaseLoanDriverResults');
    if (results) { results.hidden = true; results.innerHTML = ''; }
  }

  async function ensureLeaseDriversLoaded() {
    try {
      await window.BremStorage?.ensureSectionLoaded?.('lease-management');
      await window.BremStorage?.awaitDriversFullyLoaded?.();
    } catch (_error) {
      /* ignore */
    }
  }

  function renderLoanDriverResults() {
    const box = $('leaseLoanDriverResults');
    if (!box) return;
    const keyword = String(state.loanDriverSearch || $('leaseLoanDriverSearch')?.value || '').trim().toLowerCase();
    if (!keyword) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const drivers = getContractDrivers();
    if (!drivers.length) {
      box.hidden = false;
      box.innerHTML = '<button type="button" class="lease-driver-picker__item" disabled>기사 목록 로딩 중… 잠시 후 다시 검색하세요</button>';
      void ensureLeaseDriversLoaded().then(() => {
        if (getContractDrivers().length) renderLoanDriverResults();
      });
      return;
    }
    const list = drivers.filter(driver => {
      const hay = [driver.name, driver.phone, driver.baeminId, driver.coupangId, driver.coupangLoginKey, makeDriverLoginId(driver), driver.id]
        .join(' ').toLowerCase();
      return hay.includes(keyword);
    }).slice(0, 20);
    if (!list.length) {
      box.hidden = false;
      box.innerHTML = '<button type="button" class="lease-driver-picker__item" disabled>검색 결과 없음</button>';
      return;
    }
    box.hidden = false;
    box.innerHTML = list.map(driver => `
      <button type="button" class="lease-driver-picker__item" data-loan-pick-driver="${escapeHtml(driver.id)}">
        <strong>${escapeHtml(driver.name || '-')}</strong>
        <span>${escapeHtml(driver.phone || '-')} · 쿠팡 ${escapeHtml(makeDriverLoginId(driver) || '-')} · 배민 ${escapeHtml(driver.baeminId || '-')}</span>
      </button>`).join('');
  }

  function syncLoanLedgerFromLoan(loan, options = {}) {
    const store = window.BremStorage?.deductionLedger;
    if (!store || !loan?.id) return null;
    const existing = store.findBySource?.('loan', loan.id) || null;
    return store.save({
      id: existing?.id,
      kind: 'loan',
      sourceRef: loan.id,
      driverId: loan.driverId,
      driverName: loan.driverName,
      driverPhone: loan.driverPhone,
      dailyDeduct: loan.dailyDeduct,
      balance: loan.balance,
      deductStartDate: loan.deductStartDate,
      deductEndDate: loan.deductEndDate,
      lastDayAmount: loan.lastDayAmount,
      reason: loan.reason || '대여금',
      deductionPlatform: loan.deductionPlatform || 'coupang',
      finalApplyEnabled: options.finalApplyEnabled != null
        ? options.finalApplyEnabled
        : (loan.finalApplyEnabled != null ? loan.finalApplyEnabled : Boolean(existing?.finalApplyEnabled)),
      status: loan.status || 'active'
    });
  }

  /** 미납/회수 ↔ 차감관리 잔액·상태 동기화 (전액완료·일부회수) */
  function syncLedgerFromArrear(arrear) {
    const store = window.BremStorage?.deductionLedger;
    if (!store || !arrear) return null;
    const ledgerId = String(arrear.rawData?.ledgerId || '').trim();
    const sourceRef = String(
      arrear.rawData?.ledgerSourceRef || arrear.rawData?.sourceRef || ''
    ).trim();
    let existing = ledgerId ? store.getById?.(ledgerId) : null;
    if (!existing && sourceRef) existing = store.findBySource?.('unpaid', sourceRef) || null;
    if (!existing) return null;

    const remaining = Math.max(0, Math.round(Number(arrear.unpaidAmount || 0)));
    const completedStatus = calc()?.ARREAR_STATUS?.COMPLETED || 'completed';
    const done = String(arrear.collectionStatus || '') === completedStatus || remaining <= 0;
    return store.save({
      id: existing.id,
      balance: done ? 0 : remaining,
      status: done ? 'paid' : 'active',
      finalApplyEnabled: done ? false : Boolean(existing.finalApplyEnabled),
      rawData: {
        ...(existing.rawData || {}),
        arrearId: arrear.id,
        holdViaLedger: true,
        syncedFromArrearAt: new Date().toISOString()
      }
    });
  }

  function findContractForDriver(driverId, driverName, driverPhone) {
    const contracts = erp()?.contracts?.()?.getAll?.() || [];
    const id = String(driverId || '').trim();
    if (id) {
      const byId = contracts.find(c =>
        String(c.driverId || c.rawData?.driverId || '').trim() === id
        && String(c.status || '') !== 'ended'
      ) || contracts.find(c => String(c.driverId || c.rawData?.driverId || '').trim() === id);
      if (byId) return byId;
    }
    const name = String(driverName || '').trim().toLowerCase().replace(/\s+/g, '');
    const phone = String(driverPhone || '').replace(/\D/g, '').slice(-4);
    if (!name || !phone) return null;
    return contracts.find(c => {
      const cName = String(c.driverName || c.rawData?.driverName || '').trim().toLowerCase().replace(/\s+/g, '');
      const cPhone = String(c.driverPhone || c.rawData?.driverPhone || '').replace(/\D/g, '').slice(-4);
      return cName === name && cPhone === phone;
    }) || null;
  }

  /**
   * 소급분 미납 → 미납/회수(장부) + 차감관리(홀드) 한 세트.
   * 출금 홀드는 차감「반영」만. 미납은 holdViaLedger 로 이중 홀드 방지.
   */
  function createRetroUnpaidPair(payload = {}) {
    const ledger = window.BremStorage?.deductionLedger;
    if (!ledger || !erp()) return { ok: false, reason: 'store' };
    const sourceRef = String(payload.sourceRef || '').trim();
    const unpaid = Math.max(0, Math.round(Number(payload.unpaid || 0)));
    if (!sourceRef || unpaid <= 0) return { ok: false, reason: 'amount' };
    if (ledger.findBySource?.('unpaid', sourceRef)) return { ok: false, reason: 'dup-ledger', skipped: true };

    const completed = calc()?.ARREAR_STATUS?.COMPLETED || 'completed';
    const collecting = calc()?.ARREAR_STATUS?.COLLECTING || 'collecting';
    const existingArrear = erp().arrears().getAll().find(item =>
      String(item.rawData?.sourceRef || '') === sourceRef
      && String(item.collectionStatus || '') !== completed
    );
    if (existingArrear?.rawData?.ledgerId) return { ok: false, reason: 'dup-arrear', skipped: true };

    const weekStart = String(payload.weekStart || '').slice(0, 10);
    const dailyDeduct = Math.max(0, Math.round(Number(payload.dailyDeduct != null ? payload.dailyDeduct : unpaid)));
    const driverId = String(payload.driverId || '').trim();
    const driverName = String(payload.driverName || '').trim();
    const driverPhone = String(payload.driverPhone || '').trim();
    const reason = String(payload.reason || `정산 미납 ${weekStart}`).trim();
    const deductionPlatform = payload.deductionPlatform === 'baemin' ? 'baemin' : 'coupang';
    const contract = findContractForDriver(driverId, driverName, driverPhone);
    const identity = contract
      ? contractDriverIdentity(contract)
      : { driverId, driverName, driverPhone };

    const savedLedger = ledger.save({
      kind: 'unpaid',
      sourceRef,
      driverId: identity.driverId || driverId,
      driverName: identity.driverName || driverName,
      driverPhone: identity.driverPhone || driverPhone,
      dailyDeduct: dailyDeduct > 0 ? dailyDeduct : unpaid,
      balance: unpaid,
      reason,
      deductionPlatform,
      deductStartDate: weekStart,
      finalApplyEnabled: true,
      finalAppliedAt: new Date().toISOString(),
      weekStart,
      status: 'active',
      rawData: {
        source: 'retro-settlement',
        holdViaLedger: true,
        leaseFee: Math.max(0, Math.round(Number(payload.leaseFee || 0))),
        loanFee: Math.max(0, Math.round(Number(payload.loanFee || 0))),
        prepaid: Math.max(0, Math.round(Number(payload.prepaid || 0)))
      }
    });

    let arrear;
    if (existingArrear) {
      arrear = erp().arrears().update(existingArrear.id, {
        unpaidAmount: Number(existingArrear.unpaidAmount || 0) + unpaid,
        collectionMethods: [...new Set([
          ...(existingArrear.collectionMethods || []),
          'salary_deduction',
          'separate_deposit'
        ])],
        collectionStatus: collecting,
        rawData: {
          ...(existingArrear.rawData || {}),
          ...identity,
          source: 'retro-settlement',
          sourceRef,
          ledgerId: savedLedger.id,
          ledgerSourceRef: sourceRef,
          holdViaLedger: true,
          arrearReason: existingArrear.rawData?.arrearReason || reason
        }
      });
    } else {
      arrear = erp().arrears().create({
        vehicleId: contract?.vehicleId || '',
        contractId: contract?.id || '',
        unpaidDays: 0,
        unpaidAmount: unpaid,
        paidAmount: 0,
        recoveredAmount: 0,
        collectionMethods: ['salary_deduction', 'separate_deposit'],
        collectionStatus: collecting,
        unpaidWeekStart: weekStart,
        memo: reason,
        rawData: {
          ...identity,
          arrearReason: reason,
          unpaidWeekStart: weekStart,
          source: 'retro-settlement',
          sourceRef,
          ledgerId: savedLedger.id,
          ledgerSourceRef: sourceRef,
          holdViaLedger: true
        }
      });
    }

    const linkedLedger = ledger.save({
      id: savedLedger.id,
      rawData: {
        ...(savedLedger.rawData || {}),
        arrearId: arrear.id,
        holdViaLedger: true
      }
    });

    return { ok: true, ledger: linkedLedger, arrear };
  }

  async function saveLoanForm(event) {
    event?.preventDefault?.();
    const store = window.BremStorage?.leaseLoans;
    if (!store) {
      showToast('대여 저장소를 사용할 수 없습니다.');
      return;
    }
    const driverId = String($('leaseLoanDriverId')?.value || '').trim();
    const driverName = String($('leaseLoanDriverName')?.value || '').trim();
    if (!driverId || !driverName) {
      showToast('기사를 선택하세요.');
      return;
    }
    const principal = Math.max(0, Math.round(Number($('leaseLoanPrincipal')?.value || 0)));
    const interest = Math.max(0, Math.round(Number($('leaseLoanInterest')?.value || 0)));
    const totalAmount = principal + interest;
    const dailyDeduct = Math.max(0, Math.round(Number($('leaseLoanDailyDeduct')?.value || 0)));
    if (principal <= 0 || dailyDeduct <= 0) {
      showToast('대여금(원금)과 일 차감액을 입력하세요.');
      return;
    }
    const deductStartDate = String($('leaseLoanDeductStartDate')?.value || '').slice(0, 10);
    if (!deductStartDate) {
      showToast('차감 시작일을 입력하세요.');
      return;
    }
    const schedule = syncLoanSchedulePreview();
    if (!schedule?.ok) {
      showToast('차감 스케줄을 계산할 수 없습니다. 원금·이자·일 차감·시작일을 확인하세요.');
      return;
    }
    if (schedule.total !== totalAmount) {
      showToast(`스케줄 합계(${formatMoney(schedule.total)})가 원금+이자(${formatMoney(totalAmount)})와 다릅니다. 저장을 중단합니다.`);
      return;
    }
    const balanceRaw = $('leaseLoanBalance')?.value;
    const balance = balanceRaw === '' || balanceRaw == null
      ? totalAmount
      : Math.max(0, Math.round(Number(balanceRaw || 0)));
    const editId = String($('leaseLoanEditId')?.value || '').trim();
    const existing = editId ? store.getById?.(editId) : null;
    const loan = store.save({
      id: editId || undefined,
      driverId,
      driverName,
      driverPhone: String($('leaseLoanDriverPhone')?.value || '').trim(),
      principal,
      interest,
      dailyDeduct,
      balance,
      deductStartDate,
      deductEndDate: schedule.deductEndDate,
      lastDayAmount: schedule.lastDayAmount,
      deductionPlatform: 'coupang',
      reason: String($('leaseLoanReason')?.value || '').trim() || '대여금',
      status: 'active',
      // 신규 대여 기본 = 미반영(수기납부). ERP 차감은 「ERP차감 ON」에서만.
      finalApplyEnabled: existing ? Boolean(existing.finalApplyEnabled) : false,
      externalPaid: existing?.externalPaid || 0
    });
    syncLoanLedgerFromLoan(loan);
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    resetLoanForm();
    renderDeductionLoan();
    if (state.menu === 'payment-confirm') renderPaymentConfirm();
    showToast(editId
      ? `대여 수정 · 합계 ${formatMoney(totalAmount)} · ${schedule.days}일`
      : `대여 등록 · 합계 ${formatMoney(totalAmount)} · ${schedule.days}일 · 납부확인에서 수기 완납 가능`);
  }

  function editLoan(id) {
    const loan = window.BremStorage?.leaseLoans?.getById?.(id);
    if (!loan) return;
    if ($('leaseLoanEditId')) $('leaseLoanEditId').value = loan.id;
    if ($('leaseLoanDriverId')) $('leaseLoanDriverId').value = loan.driverId || '';
    if ($('leaseLoanDriverName')) $('leaseLoanDriverName').value = loan.driverName || '';
    if ($('leaseLoanDriverPhone')) $('leaseLoanDriverPhone').value = loan.driverPhone || '';
    if ($('leaseLoanPrincipal')) $('leaseLoanPrincipal').value = loan.principal || '';
    if ($('leaseLoanInterest')) $('leaseLoanInterest').value = loan.interest != null ? loan.interest : 0;
    if ($('leaseLoanDailyDeduct')) $('leaseLoanDailyDeduct').value = loan.dailyDeduct || '';
    if ($('leaseLoanBalance')) $('leaseLoanBalance').value = loan.balance || '';
    if ($('leaseLoanReason')) $('leaseLoanReason').value = loan.reason || '';
    if ($('leaseLoanDeductStartDate')) $('leaseLoanDeductStartDate').value = loan.deductStartDate || todayDateInputValue();
    syncLoanSchedulePreview();
    const selected = $('leaseLoanDriverSelected');
    if (selected) selected.textContent = `선택: ${loan.driverName || '-'} · ${loan.driverPhone || '-'}`;
    const submit = $('leaseLoanForm')?.querySelector('button[type="submit"]');
    if (submit) submit.textContent = '대여 수정 저장';
    state.deductionTab = 'loan';
    syncDeductionTabUi();
  }

  async function deleteLoan(id) {
    if (!id || !window.confirm('이 대여 기록을 삭제할까요?')) return;
    window.BremStorage?.leaseLoans?.remove?.(id);
    const linked = window.BremStorage?.deductionLedger?.findBySource?.('loan', id);
    if (linked?.id) window.BremStorage.deductionLedger.remove(linked.id);
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    renderDeductionLoan();
    showToast('대여 기록을 삭제했습니다.');
  }

  async function setLoanFinalApply(loanId, enabled) {
    const store = window.BremStorage?.leaseLoans;
    const loan = store?.getById?.(loanId);
    if (!loan) {
      showToast('대여 기록을 찾을 수 없습니다.');
      return;
    }
    const saved = store.save({
      ...loan,
      finalApplyEnabled: Boolean(enabled),
      finalAppliedAt: enabled ? new Date().toISOString() : loan.finalAppliedAt
    });
    syncLoanLedgerFromLoan(saved, { finalApplyEnabled: Boolean(enabled) });
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    renderDeductionLoan();
    showToast(enabled
      ? `${loan.driverName || '기사'} · ERP차감 ON (정산·출금 차감)`
      : `${loan.driverName || '기사'} · 수기납부 (ERP 차감 안 함)`);
    if (state.menu === 'payment-confirm') renderPaymentConfirm();
  }

  function renderDeductionLoan() {
    const rowsEl = $('leaseDeductionLoanRows');
    const summaryEl = $('leaseDeductionLoanSummary');
    if (!rowsEl) return;
    let list = window.BremStorage?.leaseLoans?.getAll?.() || [];
    const keyword = String(state.deductionLoanSearch || $('leaseDeductionLoanSearch')?.value || '').trim().toLowerCase();
    if (keyword) {
      list = list.filter(item => [item.driverName, item.driverPhone, item.reason].join(' ').toLowerCase().includes(keyword));
    }
    const applied = list.filter(i => i.finalApplyEnabled).length;
    if (summaryEl) {
      summaryEl.textContent = `대여금 ${list.length}건 · ERP차감 ${applied}건 · 수기납부 ${list.length - applied}건 · 잔액합 ${formatMoney(list.reduce((s, i) => s + Number(i.balance || 0), 0))}`;
    }
    if (!list.length) {
      rowsEl.innerHTML = '<tr><td colspan="13" class="empty">등록된 대여금이 없습니다.</td></tr>';
      return;
    }
    rowsEl.innerHTML = list.map(loan => {
      const total = Math.max(0, Math.round(Number(loan.totalAmount != null
        ? loan.totalAmount
        : (Number(loan.principal || 0) + Number(loan.interest || 0)))));
      const schedule = window.BremStorage?.computeLoanDeductSchedule?.({
        amount: total,
        principal: total,
        dailyDeduct: loan.dailyDeduct,
        deductStartDate: loan.deductStartDate
      }) || {};
      const endDate = loan.deductEndDate || schedule.deductEndDate || '-';
      const lastAmt = loan.lastDayAmount || schedule.lastDayAmount || 0;
      return `
      <tr>
        <td>${escapeHtml(loan.driverName || '-')}</td>
        <td>${escapeHtml(loan.driverPhone || '-')}</td>
        <td>${formatMoney(loan.principal)}</td>
        <td>${formatMoney(loan.interest || 0)}</td>
        <td><strong>${formatMoney(total)}</strong></td>
        <td>${formatMoney(loan.dailyDeduct)}</td>
        <td>${formatMoney(loan.balance)}</td>
        <td>${escapeHtml(loan.deductStartDate || '-')}</td>
        <td>${escapeHtml(endDate)}</td>
        <td>${formatMoney(lastAmt)}</td>
        <td>${escapeHtml(loan.reason || '-')}</td>
        <td><span class="${loan.finalApplyEnabled ? 'lease-status--done' : 'lease-status--collecting'}">${loan.finalApplyEnabled ? 'ERP차감' : '수기납부'}</span></td>
        <td class="lease-payment-confirm-actions">
          ${loan.finalApplyEnabled
    ? `<button type="button" class="small-btn" data-loan-clear="${escapeHtml(loan.id)}" title="ERP 차감 끄고 납부확인 수기 처리">수기납부</button>`
    : `<button type="button" class="small-btn primary-btn" data-loan-apply="${escapeHtml(loan.id)}" title="정산·출금에서 대여 차감">ERP차감 ON</button>`}
          <button type="button" class="small-btn" data-loan-edit="${escapeHtml(loan.id)}">수정</button>
          <button type="button" class="small-btn danger-btn" data-loan-delete="${escapeHtml(loan.id)}">삭제</button>
        </td>
      </tr>`;
    }).join('');
  }

  function buildDeductionManageRows() {
    const rows = [];
    (window.BremStorage?.deductionLedger?.getAll?.() || [])
      .filter(item => {
        const kind = String(item.kind || '');
        if (kind !== 'unpaid' && kind !== 'manual') return false;
        return String(item.status || '') !== 'paid' && String(item.status || '') !== 'deleted';
      })
      .forEach(item => {
        rows.push({
          key: `ledger:${item.id}`,
          kind: item.kind === 'manual' ? 'manual' : 'unpaid',
          sourceId: item.id,
          driverId: item.driverId || '',
          driverName: item.driverName || '',
          driverPhone: item.driverPhone || '',
          dailyDeduct: item.dailyDeduct || 0,
          balanceOrCharge: item.balance || 0,
          deductStartDate: item.deductStartDate || item.weekStart || '',
          reason: item.reason || (item.kind === 'manual' ? '수기 차감' : '미납'),
          applied: Boolean(item.finalApplyEnabled)
        });
      });
    return rows.sort((a, b) => String(a.driverName).localeCompare(String(b.driverName), 'ko'));
  }

  function deductionKindLabel(kind) {
    if (kind === 'manual') return '수기';
    if (kind === 'unpaid') return '미납';
    return kind || '미납';
  }

  function updateDeductionManageBulkUi() {
    const applyBtn = $('leaseDeductionManageBulkApplyBtn');
    const clearBtn = $('leaseDeductionManageBulkClearBtn');
    const selectAll = $('leaseDeductionManageSelectAll');
    const count = state.deductionManageSelectedKeys.size;
    if (applyBtn) {
      applyBtn.disabled = count <= 0;
      applyBtn.textContent = count > 0 ? `선택 기사앱 반영 (${count})` : '선택 기사앱 반영';
    }
    if (clearBtn) {
      clearBtn.disabled = count <= 0;
      clearBtn.textContent = count > 0 ? `선택 반영 해제 (${count})` : '선택 반영 해제';
    }
    if (selectAll) {
      const boxes = [...document.querySelectorAll('[data-deduction-manage-select]')];
      selectAll.checked = boxes.length > 0 && boxes.every(el => el.checked);
      selectAll.indeterminate = count > 0 && !selectAll.checked;
    }
  }

  async function setManageItemApply(key, enabled, options = {}) {
    const [type, id] = String(key || '').split(':');
    if (type !== 'ledger' || !id) return false;
    const store = window.BremStorage?.deductionLedger;
    const item = store?.getById?.(id);
    if (!item) {
      if (!options.silent) showToast('차감 항목을 찾을 수 없습니다.');
      return false;
    }
    store.save({
      ...item,
      finalApplyEnabled: Boolean(enabled),
      finalAppliedAt: enabled ? new Date().toISOString() : item.finalAppliedAt
    });
    if (!options.skipPersist) {
      await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    }
    if (!options.silent) {
      showToast(enabled ? `${item.driverName || '기사'} · 차감 반영` : `${item.driverName || '기사'} · 차감 해제`);
      renderDeductionManage();
    }
    return true;
  }

  async function bulkSetManageApply(enabled) {
    const keys = [...state.deductionManageSelectedKeys];
    if (!keys.length) {
      showToast('항목을 선택하세요.');
      return;
    }
    if (!window.confirm(`선택한 ${keys.length}건을 ${enabled ? '기사앱 반영' : '반영 해제'}할까요?`)) return;
    let ok = 0;
    for (const key of keys) {
      const done = await setManageItemApply(key, enabled, { skipPersist: true, silent: true });
      if (done) ok += 1;
    }
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    state.deductionManageSelectedKeys.clear();
    renderDeductionManage();
    showToast(`${enabled ? '반영' : '해제'} ${ok}건`);
  }

  function renderDeductionManage() {
    const rowsEl = $('leaseDeductionManageRows');
    const summaryEl = $('leaseDeductionManageSummary');
    if (!rowsEl) return;
    let rows = buildDeductionManageRows();
    const kind = state.deductionManageKind || $('leaseDeductionManageKindFilter')?.value || 'all';
    state.deductionManageKind = kind;
    if (kind !== 'all') rows = rows.filter(row => row.kind === kind);
    const keyword = String(state.deductionManageSearch || $('leaseDeductionManageSearch')?.value || '').trim().toLowerCase();
    if (keyword) {
      rows = rows.filter(row => [row.driverName, row.driverPhone, row.reason, deductionKindLabel(row.kind)]
        .join(' ').toLowerCase().includes(keyword));
    }
    const appliedCount = rows.filter(row => row.applied).length;
    if (summaryEl) summaryEl.textContent = `미납·수기 ${rows.length}건 · 반영 ${appliedCount}건`;
    const visible = new Set(rows.map(row => row.key));
    [...state.deductionManageSelectedKeys].forEach(key => {
      if (!visible.has(key)) state.deductionManageSelectedKeys.delete(key);
    });
    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="10" class="empty">미납·수기 차감이 없습니다. 소급분 이관 또는 위에서 수기 등록하세요.</td></tr>';
      updateDeductionManageBulkUi();
      return;
    }
    rowsEl.innerHTML = rows.map(row => {
      const checked = state.deductionManageSelectedKeys.has(row.key) ? ' checked' : '';
      const rowSelected = checked ? ' class="row-selected"' : '';
      return `<tr${rowSelected}>
        <td class="lease-check-col"><input type="checkbox" data-deduction-manage-select="${escapeHtml(row.key)}"${checked}></td>
        <td>${escapeHtml(deductionKindLabel(row.kind))}</td>
        <td>${escapeHtml(formatDriverContractLabel(row.driverName || '-'))}</td>
        <td>${escapeHtml(row.driverPhone || '-')}</td>
        <td>${formatMoney(row.dailyDeduct)}</td>
        <td>${formatMoney(row.balanceOrCharge)}</td>
        <td>${escapeHtml(row.deductStartDate || '-')}</td>
        <td>${escapeHtml(row.reason || '-')}</td>
        <td><span class="${row.applied ? 'lease-status--done' : 'lease-status--collecting'}">${row.applied ? '반영됨' : '미반영'}</span></td>
        <td class="lease-payment-confirm-actions">
          ${row.applied
    ? `<button type="button" class="small-btn" data-deduction-manage-clear="${escapeHtml(row.key)}">반영 해제</button>`
    : `<button type="button" class="small-btn primary-btn" data-deduction-manage-apply="${escapeHtml(row.key)}">기사앱 반영</button>`}
          ${row.kind === 'manual' ? `<button type="button" class="small-btn danger-btn" data-manual-deduct-delete="${escapeHtml(row.sourceId)}">삭제</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    updateDeductionManageBulkUi();
  }

  function resetManualDeductForm() {
    if ($('leaseManualDeductEditId')) $('leaseManualDeductEditId').value = '';
    if ($('leaseManualDeductDriverId')) $('leaseManualDeductDriverId').value = '';
    if ($('leaseManualDeductDriverSearch')) $('leaseManualDeductDriverSearch').value = '';
    if ($('leaseManualDeductDriverName')) $('leaseManualDeductDriverName').value = '';
    if ($('leaseManualDeductDriverPhone')) $('leaseManualDeductDriverPhone').value = '';
    if ($('leaseManualDeductDaily')) $('leaseManualDeductDaily').value = '';
    if ($('leaseManualDeductBalance')) $('leaseManualDeductBalance').value = '';
    if ($('leaseManualDeductReason')) $('leaseManualDeductReason').value = '';
    if ($('leaseManualDeductStartDate')) $('leaseManualDeductStartDate').value = todayDateInputValue();
    const selected = $('leaseManualDeductDriverSelected');
    if (selected) selected.textContent = '선택: 없음';
    const results = $('leaseManualDeductDriverResults');
    if (results) { results.hidden = true; results.innerHTML = ''; }
  }

  function pickManualDeductDriver(driver) {
    if (!driver) return;
    if ($('leaseManualDeductDriverId')) $('leaseManualDeductDriverId').value = driver.id || '';
    if ($('leaseManualDeductDriverName')) $('leaseManualDeductDriverName').value = driver.name || '';
    if ($('leaseManualDeductDriverPhone')) $('leaseManualDeductDriverPhone').value = driver.phone || '';
    const selected = $('leaseManualDeductDriverSelected');
    if (selected) {
      selected.textContent = `선택: ${driver.name || '-'} · ${driver.phone || '-'} · 쿠팡 ${makeDriverLoginId(driver) || '-'} · 배민 ${driver.baeminId || '-'}`;
    }
    const results = $('leaseManualDeductDriverResults');
    if (results) { results.hidden = true; results.innerHTML = ''; }
  }

  function renderManualDeductDriverResults() {
    const box = $('leaseManualDeductDriverResults');
    if (!box) return;
    const keyword = String(state.manualDriverSearch || $('leaseManualDeductDriverSearch')?.value || '').trim().toLowerCase();
    if (!keyword) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const drivers = getContractDrivers();
    if (!drivers.length) {
      box.hidden = false;
      box.innerHTML = '<button type="button" class="lease-driver-picker__item" disabled>기사 목록 로딩 중…</button>';
      void ensureLeaseDriversLoaded().then(() => {
        if (getContractDrivers().length) renderManualDeductDriverResults();
      });
      return;
    }
    const list = drivers.filter(driver => {
      const hay = [driver.name, driver.phone, driver.baeminId, driver.coupangId, makeDriverLoginId(driver), driver.id]
        .join(' ').toLowerCase();
      return hay.includes(keyword);
    }).slice(0, 20);
    if (!list.length) {
      box.hidden = false;
      box.innerHTML = '<button type="button" class="lease-driver-picker__item" disabled>검색 결과 없음</button>';
      return;
    }
    box.hidden = false;
    box.innerHTML = list.map(driver => `
      <button type="button" class="lease-driver-picker__item" data-manual-pick-driver="${escapeHtml(driver.id)}">
        <strong>${escapeHtml(driver.name || '-')}</strong>
        <span>${escapeHtml(driver.phone || '-')} · 쿠팡 ${escapeHtml(makeDriverLoginId(driver) || '-')} · 배민 ${escapeHtml(driver.baeminId || '-')}</span>
      </button>`).join('');
  }

  async function saveManualDeductForm(event) {
    event?.preventDefault?.();
    const store = window.BremStorage?.deductionLedger;
    if (!store) {
      showToast('차감 저장소를 사용할 수 없습니다.');
      return;
    }
    const driverId = String($('leaseManualDeductDriverId')?.value || '').trim();
    const driverName = String($('leaseManualDeductDriverName')?.value || '').trim();
    if (!driverId || !driverName) {
      showToast('기사를 선택하세요.');
      return;
    }
    const dailyDeduct = Math.max(0, Math.round(Number($('leaseManualDeductDaily')?.value || 0)));
    const balance = Math.max(0, Math.round(Number($('leaseManualDeductBalance')?.value || 0)));
    const deductStartDate = String($('leaseManualDeductStartDate')?.value || '').slice(0, 10);
    if (dailyDeduct <= 0 || balance <= 0 || !deductStartDate) {
      showToast('일 차감액·잔액·시작일을 입력하세요.');
      return;
    }
    const editId = String($('leaseManualDeductEditId')?.value || '').trim();
    store.save({
      id: editId || undefined,
      kind: 'manual',
      sourceRef: editId ? undefined : `manual:${driverId}:${Date.now()}`,
      driverId,
      driverName,
      driverPhone: String($('leaseManualDeductDriverPhone')?.value || '').trim(),
      dailyDeduct,
      balance,
      deductStartDate,
      reason: String($('leaseManualDeductReason')?.value || '').trim() || '수기 차감',
      deductionPlatform: 'coupang',
      finalApplyEnabled: false,
      status: 'active'
    });
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    resetManualDeductForm();
    renderDeductionManage();
    showToast(editId ? '수기 차감을 수정했습니다.' : '수기 차감을 등록했습니다.');
  }

  async function deleteManualDeduct(id) {
    if (!id || !window.confirm('이 수기 차감을 삭제할까요?')) return;
    window.BremStorage?.deductionLedger?.remove?.(id);
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    renderDeductionManage();
    showToast('수기 차감을 삭제했습니다.');
  }

  async function saveLeaseDeductStartDate(contractId, value) {
    if (!erp() || !contractId) return;
    const contract = erp().contracts().getById(contractId);
    if (!contract) return;
    const deductStartDate = String(value || '').slice(0, 10);
    erp().contracts().update(contractId, {
      rawData: {
        ...(contract.rawData || {}),
        deductStartDate
      }
    });
    try {
      await erp().persistAll({ skipFlushStorage: true });
    } catch (error) {
      console.error('[saveLeaseDeductStartDate]', error);
      showToast(error?.message || '차감 시작일 저장 실패');
      return;
    }
    updateLeaseErpUnsavedBanner();
    renderDeductionLease();
  }

  function getActivePaymentContracts() {
    if (!erp()) return [];
    const ended = erp().CONTRACT_STATUS?.ENDED || 'ended';
    return erp().contracts().getAll()
      .filter(contract => String(contract.status || '') !== ended)
      .filter(contract => String(contract.driverName || contract.renter || '').trim())
      .sort((a, b) => String(a.driverName || '').localeCompare(String(b.driverName || ''), 'ko'));
  }

  function paymentConfirmStatus(contract, weekStart) {
    const completed = calc()?.ARREAR_STATUS?.COMPLETED || 'completed';
    const openArrear = erp().arrears().getAll().find(item =>
      item.contractId === contract.id && String(item.collectionStatus || '') !== completed
    );
    const payment = findWeekPaymentConfirm(contract.vehicleId, weekStart);
    const charge = Math.max(0, Number(payment?.chargeAmount || 0));
    const paid = Math.max(0, Number(payment?.paidAmount || 0));
    if (payment && charge > 0 && paid >= charge) {
      return { code: 'paid', label: '완납', cls: 'lease-status--done' };
    }
    if (openArrear) {
      const remaining = Math.max(0, Number(openArrear.unpaidAmount || 0));
      if (paid > 0 && remaining > 0) {
        return { code: 'partial', label: '부분납', cls: 'lease-status--collecting' };
      }
      return { code: 'unpaid', label: '미납', cls: 'lease-status--unpaid' };
    }
    if (payment && paid > 0 && paid < charge) {
      return { code: 'partial', label: '부분납', cls: 'lease-status--collecting' };
    }
    return { code: 'pending', label: '확인대기', cls: 'lease-status--collecting' };
  }

  function upsertWeekPaymentConfirm({ vehicleId, weekStart, chargeAmount, paidAmount, status }) {
    const existing = findWeekPaymentConfirm(vehicleId, weekStart);
    const charge = Math.max(0, Math.round(Number(chargeAmount) || 0));
    const paid = Math.max(0, Math.round(Number(paidAmount) || 0));
    const unpaid = Math.max(0, charge - paid);
    const payload = {
      vehicleId,
      dueDate: weekStart,
      paidDate: paid > 0 ? (BremLeaseProfit?.todayKey?.() || new Date().toISOString().slice(0, 10)) : '',
      chargeAmount: charge,
      paidAmount: paid,
      unpaidAmount: unpaid,
      overdueDays: 0,
      paymentStatus: status || (unpaid <= 0
        ? (BremLeaseProfit?.PAYMENT_STATUSES?.NORMAL || 'normal')
        : (BremLeaseProfit?.PAYMENT_STATUSES?.UNPAID || 'unpaid')),
      memo: paymentConfirmMemo(weekStart)
    };
    if (existing) return erp().payments().update(existing.id, payload);
    return erp().payments().create(payload);
  }

  function isWeekPaymentFullyPaid(payment) {
    if (!payment) return false;
    const charge = Math.max(0, Number(payment.chargeAmount || 0));
    const paid = Math.max(0, Number(payment.paidAmount || 0));
    if (charge > 0 && paid >= charge) return true;
    return Math.max(0, Number(payment.unpaidAmount || 0)) <= 0 && paid > 0;
  }

  function markContractWeekFullyPaid(contract, weekStart) {
    if (!contract?.vehicleId || !weekStart) return null;
    const charge = resolvePaymentConfirmCharge(contract, weekStart);
    if (charge <= 0) return null;
    return upsertWeekPaymentConfirm({
      vehicleId: contract.vehicleId,
      weekStart: String(weekStart).slice(0, 10),
      chargeAmount: charge,
      paidAmount: charge,
      status: BremLeaseProfit?.PAYMENT_STATUSES?.NORMAL || 'normal'
    });
  }

  /** 미납/회수 전액 완료 → 관련 주차 납부확인도 완납으로 맞춤 */
  function syncPaymentConfirmOnArrearCleared(contractId, arrear) {
    if (!erp() || !contractId) return;
    const contract = erp().contracts().getById(contractId);
    if (!contract) return;
    const weeks = new Set();
    weeks.add(currentWeekStart());
    const primary = String(arrear?.unpaidWeekStart || arrear?.rawData?.unpaidWeekStart || '').slice(0, 10);
    if (primary) weeks.add(primary);
    (Array.isArray(arrear?.rawData?.weekEntries) ? arrear.rawData.weekEntries : []).forEach(entry => {
      const ws = String(entry?.weekStart || '').slice(0, 10);
      if (ws) weeks.add(ws);
    });
    weeks.forEach(weekStart => markContractWeekFullyPaid(contract, weekStart));
  }

  function resolveContractForVehicle(vehicleId) {
    if (!erp() || !vehicleId) return null;
    return getActiveContractForVehicle(vehicleId)
      || erp().contracts().getAll()
        .filter(item => String(item.vehicleId || '') === String(vehicleId))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
      || null;
  }

  function listPaidPaymentConfirmRows() {
    if (!erp()) return [];
    const vehicles = new Map(erp().vehicles().getAll().map(item => [item.id, item]));
    return erp().payments().getAll()
      .filter(item => String(item.memo || '').startsWith(PAYMENT_CONFIRM_MEMO_PREFIX))
      .filter(item => isWeekPaymentFullyPaid(item))
      .map(payment => {
        const weekStart = String(payment.dueDate || '').slice(0, 10)
          || String(payment.memo || '').replace(PAYMENT_CONFIRM_MEMO_PREFIX, '').slice(0, 10);
        const vehicle = vehicles.get(payment.vehicleId);
        const contract = resolveContractForVehicle(payment.vehicleId);
        const weeklyLease = vehicleWeeklyLeaseCost(vehicle);
        const weeklyCharge = Math.max(
          Number(payment.chargeAmount || 0),
          contractRiderWeeklyCharge(contract)
        );
        return {
          payment,
          weekStart,
          weekLabel: formatPaymentWeekColumn(weekStart),
          vehicle,
          contract,
          weeklyLease,
          weeklyCharge,
          margin: weeklyCharge - weeklyLease,
          driverName: contract?.driverName || vehicle?.renter || '-',
          driverPhone: contract?.driverPhone || vehicle?.lesseePhone || '-',
          vehicleNumber: vehicle?.vehicleNumber || contract?.vehicleNumber || '-',
          model: vehicle?.model || contract?.modelType || '-'
        };
      })
      .sort((a, b) => {
        const byWeek = String(b.weekStart || '').localeCompare(String(a.weekStart || ''));
        if (byWeek) return byWeek;
        return String(a.driverName || '').localeCompare(String(b.driverName || ''), 'ko');
      });
  }

  /** 미납 잔액을 미납/회수에 등록(누적)하고 미납/회수 메뉴로 이동 */
  async function moveRemainingToArrears({ contract, weekStart, unpaidDays, unpaidAmount, paidAmount }) {
    const completed = calc().ARREAR_STATUS.COMPLETED;
    const collecting = calc().ARREAR_STATUS.COLLECTING;
    const identity = contractDriverIdentity(contract);
    const weekEntry = {
      weekStart,
      unpaidDays,
      unpaidAmount,
      paidAmount: paidAmount || 0,
      at: new Date().toISOString(),
      source: 'payment-confirm'
    };
    const openForContract = erp().arrears().getAll().find(item =>
      item.contractId === contract.id && String(item.collectionStatus || '') !== completed
    );
    if (openForContract) {
      const weekEntries = Array.isArray(openForContract.rawData?.weekEntries)
        ? [...openForContract.rawData.weekEntries]
        : [];
      weekEntries.push(weekEntry);
      erp().arrears().update(openForContract.id, {
        unpaidDays: Number(openForContract.unpaidDays || 0) + unpaidDays,
        unpaidAmount: Number(openForContract.unpaidAmount || 0) + unpaidAmount,
        paidAmount: Number(openForContract.paidAmount || 0) + Number(paidAmount || 0),
        collectionMethods: [...new Set([...(openForContract.collectionMethods || []), 'separate_deposit'])],
        collectionStatus: collecting,
        rawData: {
          ...(openForContract.rawData || {}),
          ...identity,
          arrearReason: openForContract.rawData?.arrearReason || '납부확인 미납',
          unpaidWeekStart: openForContract.rawData?.unpaidWeekStart || weekStart,
          source: 'payment-confirm',
          weekEntries
        }
      });
    } else {
      erp().arrears().create({
        vehicleId: contract.vehicleId,
        contractId: contract.id,
        unpaidDays,
        unpaidAmount,
        paidAmount: paidAmount || 0,
        unpaidWeekStart: weekStart,
        collectionMethods: ['separate_deposit'],
        collectionStatus: collecting,
        rawData: {
          ...identity,
          arrearReason: '납부확인 미납',
          unpaidWeekStart: weekStart,
          source: 'payment-confirm',
          weekEntries: [weekEntry]
        }
      });
    }
    if (contract.id) {
      erp().contracts().update(contract.id, {
        unpaidDays: Number(contract.unpaidDays || 0) + unpaidDays,
        unpaidAmount: Number(contract.unpaidAmount || 0) + unpaidAmount,
        collectionStatus: collecting
      });
    }
    await erp().persistAll({ skipFlushStorage: true });
    updateLeaseErpUnsavedBanner();
    syncArrearWeekUi(weekStart);
    setMenu('arrears');
  }

  function applyPaymentFullCore(contract, weekStart) {
    if (!contract) return { ok: false, charge: 0, reason: '계약 없음' };
    const charge = resolvePaymentConfirmCharge(contract, weekStart);
    if (charge <= 0) return { ok: false, charge: 0, reason: '일렌탈료가 없어 완납 처리할 수 없습니다' };

    upsertWeekPaymentConfirm({
      vehicleId: contract.vehicleId,
      weekStart,
      chargeAmount: charge,
      paidAmount: charge,
      status: BremLeaseProfit?.PAYMENT_STATUSES?.NORMAL || 'normal'
    });

    const completed = calc().ARREAR_STATUS.COMPLETED;
    const openArrear = erp().arrears().getAll().find(item =>
      item.contractId === contract.id && String(item.collectionStatus || '') !== completed
    );
    if (openArrear) {
      const remainingBefore = Math.max(0, Number(openArrear.unpaidAmount || 0));
      const apply = Math.min(remainingBefore, charge);
      const remaining = remainingBefore - apply;
      const history = Array.isArray(openArrear.rawData?.processingHistory)
        ? [...openArrear.rawData.processingHistory]
        : [];
      history.unshift({
        at: new Date().toISOString(),
        type: 'payment-confirm-full',
        recoveredAmount: apply,
        remainingAmount: remaining,
        weekStart,
        processedDate: BremLeaseProfit.todayKey()
      });
      erp().arrears().update(openArrear.id, {
        paidAmount: Number(openArrear.paidAmount || 0) + apply,
        recoveredAmount: Number(openArrear.recoveredAmount || 0) + apply,
        unpaidAmount: remaining,
        collectionStatus: remaining > 0 ? calc().ARREAR_STATUS.COLLECTING : completed,
        processedDate: remaining > 0 ? openArrear.processedDate : BremLeaseProfit.todayKey(),
        rawData: { ...(openArrear.rawData || {}), processingHistory: history }
      });
      if (remaining === 0) {
        erp().contracts().update(contract.id, {
          unpaidDays: 0,
          unpaidAmount: 0,
          collectionStatus: completed,
          processedDate: BremLeaseProfit.todayKey()
        });
      }
    }
    return { ok: true, charge };
  }

  async function confirmPaymentFull(contractId, options = {}) {
    if (!erp()) return false;
    const contract = erp().contracts().getById(contractId);
    if (!contract) {
      showToast('계약을 찾을 수 없습니다.');
      return false;
    }
    const weekStart = syncPaymentWeekUi(state.paymentWeekStart || currentWeekStart());
    const progressive = contractPaymentConfirmCharge(contract, weekStart);
    const charge = resolvePaymentConfirmCharge(contract, weekStart);
    if (charge <= 0) {
      showToast('일렌탈료가 없어 완납 처리할 수 없습니다. 계약의 일 렌탈료를 확인하세요.');
      return false;
    }
    if (!options.skipConfirm) {
      const chargeNote = progressive > 0
        ? '경과 일수×일렌탈료'
        : '경과 청구 0원 → 주간청구(일×7)로 수기 완납';
      if (!window.confirm(`${formatDriverContractLabel(contract.driverName || '기사')} · ${formatArrearWeekLabel(weekStart)}\n완납 ${formatMoney(charge)} 처리할까요? (${chargeNote})`)) return false;
    }

    const result = applyPaymentFullCore(contract, weekStart);
    if (!result.ok) {
      showToast(result.reason || '완납 처리에 실패했습니다.');
      return false;
    }

    if (!options.skipPersist) {
      try {
        await erp().persistAll({ skipFlushStorage: true });
      } catch (error) {
        console.error('[confirmPaymentFull]', error);
        showToast(error?.message || '완납 저장에 실패했습니다.');
        return false;
      }
      updateLeaseErpUnsavedBanner();
    }

    if (!options.silent) {
      showToast(`완납 처리 · ${formatMoney(result.charge)} · 완납 확인으로 이동`);
      state.paymentConfirmSelectedIds.delete(String(contractId));
      renderPaymentConfirm();
      renderPaymentPaid();
      refreshAfterLeaseMutation({ contract: false });
      if (!options.skipNavigate) setMenu('payment-paid');
    }
    return true;
  }

  async function bulkConfirmPaymentFull() {
    if (!erp()) return;
    const ids = [...state.paymentConfirmSelectedIds].map(String).filter(Boolean);
    if (!ids.length) {
      showToast('완납할 기사를 선택하세요.');
      return;
    }
    const weekStart = syncPaymentWeekUi(currentWeekStart());
    const contracts = ids.map(id => erp().contracts().getById(id)).filter(Boolean);
    if (!contracts.length) {
      showToast('선택한 계약을 찾을 수 없습니다.');
      return;
    }
    const totalCharge = contracts.reduce((sum, contract) => sum + resolvePaymentConfirmCharge(contract, weekStart), 0);
    if (!window.confirm(`선택한 ${contracts.length}건을 완납 처리할까요?\n합계 ${formatMoney(totalCharge)}`)) return;

    let okCount = 0;
    let failCount = 0;
    contracts.forEach(contract => {
      const result = applyPaymentFullCore(contract, weekStart);
      if (result.ok) okCount += 1;
      else failCount += 1;
    });

    try {
      await erp().persistAll({ skipFlushStorage: true });
    } catch (error) {
      console.error('[bulkConfirmPaymentFull]', error);
      showToast(error?.message || '일괄 완납 저장에 실패했습니다.');
      return;
    }
    state.paymentConfirmSelectedIds.clear();
    updateLeaseErpUnsavedBanner();
    showToast(failCount
      ? `완납 ${okCount}건 · 실패 ${failCount}건 · 완납 확인으로 이동`
      : `선택 ${okCount}건 완납 처리 · 완납 확인으로 이동`);
    renderPaymentConfirm();
    renderPaymentPaid();
    refreshAfterLeaseMutation({ contract: false });
    setMenu('payment-paid');
  }

  function updatePaymentConfirmBulkUi() {
    const btn = $('leasePaymentConfirmBulkPaidBtn');
    const selectAll = $('leasePaymentConfirmSelectAll');
    const count = state.paymentConfirmSelectedIds.size;
    if (btn) {
      btn.disabled = count <= 0;
      btn.textContent = count > 0 ? `선택 완납 (${count})` : '선택 완납';
    }
    if (selectAll) {
      const boxes = document.querySelectorAll('[data-payment-select]');
      const enabled = [...boxes].filter(el => !el.disabled);
      selectAll.checked = enabled.length > 0 && enabled.every(el => el.checked);
      selectAll.indeterminate = count > 0 && !selectAll.checked;
    }
  }

  async function deletePaidPaymentConfirm(paymentId) {
    if (!erp() || !paymentId) return;
    const payment = erp().payments().getById(paymentId);
    if (!payment) return;
    const vehicle = erp().vehicles().getById(payment.vehicleId);
    const contract = resolveContractForVehicle(payment.vehicleId);
    const weekStart = String(payment.dueDate || '').slice(0, 10);
    const label = [
      vehicle?.vehicleNumber || contract?.vehicleNumber || '-',
      contract?.driverName || vehicle?.renter || '-',
      formatPaymentWeekColumn(weekStart)
    ].join(' · ');
    if (!window.confirm(`완납 내역을 삭제할까요?\n${label}\n삭제 후 납부 확인 목록에 다시 나타날 수 있습니다.`)) return;
    try {
      erp().payments().removeById(paymentId);
      await erp().persistAll({ skipFlushStorage: true });
      updateLeaseErpUnsavedBanner();
      renderPaymentPaid();
      renderPaymentConfirm();
      refreshAfterLeaseMutation({ contract: false });
      showToast('완납 내역을 삭제했습니다.');
    } catch (error) {
      console.error('[deletePaidPaymentConfirm]', error);
      showToast(error?.message || '완납 내역 삭제에 실패했습니다.');
    }
  }

  async function confirmPaymentPartial(contractId) {
    if (!erp()) return;
    const contract = erp().contracts().getById(contractId);
    if (!contract) {
      showToast('계약을 찾을 수 없습니다.');
      return;
    }
    const weekStart = syncPaymentWeekUi(state.paymentWeekStart || currentWeekStart());
    const daily = contractRiderDailyRent(contract);
    const charge = resolvePaymentConfirmCharge(contract, weekStart);
    const days = contractActiveDaysInWeek(contract, weekStart) || 7;
    const erpOn = isContractFinalApplyEnabled(contract);
    if (charge <= 0) {
      showToast('일렌탈료가 없어 부분납 처리할 수 없습니다. 계약의 일 렌탈료를 확인하세요.');
      return;
    }
    const promptHint = erpOn
      ? '납부 금액을 입력하세요. (ERP차감 ON · 수금액만 기록, 미납이관 안 함)'
      : '납부 금액을 입력하세요. (0원이면 전액 미납 → 미납/회수 이동)';
    const raw = window.prompt(
      `${formatDriverContractLabel(contract.driverName || '기사')} · 이번주 청구 ${formatMoney(charge)} (${days}일×${formatMoney(daily)})\n${promptHint}`,
      String(Math.round(charge / 2))
    );
    if (raw == null) return;
    const paid = Math.max(0, Math.round(Number(String(raw).replace(/[^0-9.-]/g, '')) || 0));
    if (paid > charge) {
      showToast(`납부액이 청구액(${formatMoney(charge)})을 초과합니다.`);
      return;
    }
    if (paid >= charge) {
      await confirmPaymentFull(contractId, { skipConfirm: true });
      return;
    }
    const unpaidAmount = charge - paid;
    const unpaidDays = daily > 0 ? Math.max(1, Math.round(unpaidAmount / daily)) : Math.max(1, days);
    upsertWeekPaymentConfirm({
      vehicleId: contract.vehicleId,
      weekStart,
      chargeAmount: charge,
      paidAmount: paid,
      status: BremLeaseProfit?.PAYMENT_STATUSES?.UNPAID || 'unpaid'
    });
    try {
      // ERP차감 ON: 정산·출금이 이미 깎으므로 미납이관은 이중 — 수금액만 납부확인에 기록
      if (erpOn) {
        await erp().persistAll({ skipFlushStorage: true });
        updateLeaseErpUnsavedBanner();
        showToast(`부분납 ${formatMoney(paid)} 기록 · 미납 ${formatMoney(unpaidAmount)} (ERP차감 중 · 미납이관 안 함)`);
        renderPaymentConfirm();
        refreshAfterLeaseMutation({ contract: false });
        return;
      }
      await moveRemainingToArrears({
        contract,
        weekStart,
        unpaidDays,
        unpaidAmount,
        paidAmount: paid
      });
      showToast(paid > 0
        ? `부분납 ${formatMoney(paid)} · 미납 ${formatMoney(unpaidAmount)} → 미납/회수로 이동`
        : `미납 ${formatMoney(unpaidAmount)} → 미납/회수로 이동`);
      refreshAfterLeaseMutation({ contract: false });
    } catch (error) {
      console.error('[confirmPaymentPartial]', error);
      showToast(error?.message || '부분납/미납 처리에 실패했습니다.');
    }
  }

  function loanPaymentStatus(loan) {
    const principal = Math.max(0, Math.round(Number(loan?.principal || 0)));
    const balance = Math.max(0, Math.round(Number(loan?.balance || 0)));
    const externalPaid = Math.max(0, Math.round(Number(loan?.externalPaid || 0)));
    if (String(loan?.status || '') === 'paid' || balance <= 0) {
      return { code: 'paid', label: '완납', cls: 'lease-status--done' };
    }
    if (externalPaid > 0 || (principal > 0 && balance < principal)) {
      return { code: 'partial', label: '부분납', cls: 'lease-status--collecting' };
    }
    return { code: 'pending', label: '확인대기', cls: 'lease-status--collecting' };
  }

  function syncPaymentConfirmTabUi() {
    const source = state.paymentSource === 'loan' ? 'loan' : 'lease';
    const status = ['open', 'partial', 'paid'].includes(state.paymentStatusFilter)
      ? state.paymentStatusFilter
      : 'open';
    state.paymentSource = source;
    state.paymentStatusFilter = status;
    document.querySelectorAll('[data-payment-source]').forEach(btn => {
      const active = btn.dataset.paymentSource === source;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-payment-status]').forEach(btn => {
      const active = btn.dataset.paymentStatus === status;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const selectWrap = $('leasePaymentConfirmSelectAllWrap');
    const bulkBtn = $('leasePaymentConfirmBulkPaidBtn');
    const showBulk = source === 'lease' && status === 'open';
    if (selectWrap) selectWrap.hidden = !showBulk;
    if (bulkBtn) bulkBtn.hidden = !showBulk;
  }

  function syncPaymentPaidTabUi() {
    const source = state.paymentPaidSource === 'loan' ? 'loan' : 'lease';
    state.paymentPaidSource = source;
    document.querySelectorAll('[data-payment-paid-source]').forEach(btn => {
      const active = btn.dataset.paymentPaidSource === source;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function matchesPaymentStatusFilter(statusCode, filter) {
    if (filter === 'paid') return statusCode === 'paid';
    if (filter === 'partial') return statusCode === 'partial';
    // open = 미확인: pending + unpaid (부분납·완납 제외)
    return statusCode === 'pending' || statusCode === 'unpaid';
  }

  async function confirmLoanPaymentFull(loanId) {
    const store = window.BremStorage?.leaseLoans;
    const loan = store?.getById?.(loanId);
    if (!loan) return;
    const balance = Math.max(0, Math.round(Number(loan.balance || 0)));
    if (balance <= 0) {
      showToast('이미 완납된 대여입니다.');
      return;
    }
    if (!window.confirm(`${loan.driverName || '기사'} · 대여 잔액 ${formatMoney(balance)}을 완납 처리할까요?\n(계좌이체 등 외부 납부로 잔액을 0으로 만듭니다. ERP차감은 해제됩니다.)`)) {
      return;
    }
    const saved = store.save({
      ...loan,
      balance: 0,
      externalPaid: Math.max(0, Math.round(Number(loan.externalPaid || 0))) + balance,
      status: 'paid',
      paidAt: contractTodayKey(),
      finalApplyEnabled: false
    });
    syncLoanLedgerFromLoan(saved, { finalApplyEnabled: false });
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    renderPaymentConfirm();
    renderPaymentPaid();
    renderDeductionLoan();
    renderWeeklyLoan();
    renderMonthlyLoan();
    showToast(`${loan.driverName || '기사'} · 대여 완납 처리`);
  }

  async function confirmLoanPaymentPartial(loanId) {
    const store = window.BremStorage?.leaseLoans;
    const loan = store?.getById?.(loanId);
    if (!loan) return;
    const balance = Math.max(0, Math.round(Number(loan.balance || 0)));
    if (balance <= 0) {
      showToast('이미 완납된 대여입니다.');
      return;
    }
    const raw = window.prompt(
      `${loan.driverName || '기사'} · 잔액 ${formatMoney(balance)}\n부분납 금액을 입력하세요.`,
      String(balance)
    );
    if (raw == null) return;
    const paid = Math.max(0, Math.round(Number(String(raw).replace(/,/g, ''))));
    if (!Number.isFinite(paid) || paid <= 0) {
      showToast('부분납 금액이 올바르지 않습니다.');
      return;
    }
    if (paid > balance) {
      showToast(`잔액(${formatMoney(balance)})을 초과할 수 없습니다.`);
      return;
    }
    const nextBalance = balance - paid;
    const saved = store.save({
      ...loan,
      balance: nextBalance,
      externalPaid: Math.max(0, Math.round(Number(loan.externalPaid || 0))) + paid,
      status: nextBalance <= 0 ? 'paid' : 'active',
      paidAt: nextBalance <= 0 ? contractTodayKey() : (loan.paidAt || ''),
      finalApplyEnabled: nextBalance <= 0 ? false : Boolean(loan.finalApplyEnabled)
    });
    syncLoanLedgerFromLoan(saved, {
      finalApplyEnabled: nextBalance <= 0 ? false : Boolean(loan.finalApplyEnabled)
    });
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    renderPaymentConfirm();
    renderPaymentPaid();
    renderDeductionLoan();
    renderWeeklyLoan();
    renderMonthlyLoan();
    showToast(nextBalance <= 0
      ? `${loan.driverName || '기사'} · 대여 완납`
      : `${loan.driverName || '기사'} · 부분납 ${formatMoney(paid)} · 잔액 ${formatMoney(nextBalance)}`);
  }

  function renderPaymentConfirm() {
    const rowsEl = $('leasePaymentConfirmRows');
    const headEl = $('leasePaymentConfirmHead');
    const summaryEl = $('leasePaymentConfirmSummary');
    if (!rowsEl) return;
    syncPaymentConfirmTabUi();
    const source = state.paymentSource;
    const statusFilter = state.paymentStatusFilter;
    const keyword = String(state.paymentConfirmSearch || $('leasePaymentConfirmSearch')?.value || '').trim().toLowerCase();

    if (source === 'loan') {
      if (headEl) {
        headEl.innerHTML = `<tr>
          <th>기사</th><th>연락처</th><th>대여금</th><th>잔액</th><th>외부납부</th>
          <th>일 차감</th><th>시작~종료</th><th>마지막날</th><th>납부상태</th><th>관리</th>
        </tr>`;
      }
      let loans = (window.BremStorage?.leaseLoans?.getAll?.() || []).filter(loan =>
        matchesPaymentStatusFilter(loanPaymentStatus(loan).code, statusFilter)
      );
      if (keyword) {
        loans = loans.filter(loan => [loan.driverName, loan.driverPhone, loan.reason]
          .join(' ').toLowerCase().includes(keyword));
      }
      if (summaryEl) {
        summaryEl.textContent = `대여 · ${statusFilter === 'paid' ? '완납' : (statusFilter === 'partial' ? '부분납' : '미확인')} ${loans.length}건`;
      }
      if (!loans.length) {
        rowsEl.innerHTML = '<tr><td colspan="10" class="empty">해당 조건의 대여 납부 건이 없습니다.</td></tr>';
        updatePaymentConfirmBulkUi();
        return;
      }
      rowsEl.innerHTML = loans.map(loan => {
        const status = loanPaymentStatus(loan);
        const total = Math.max(0, Math.round(Number(loan.totalAmount != null
          ? loan.totalAmount
          : (Number(loan.principal || 0) + Number(loan.interest || 0)))));
        const schedule = window.BremStorage?.computeLoanDeductSchedule?.({
          amount: total,
          principal: total,
          dailyDeduct: loan.dailyDeduct,
          deductStartDate: loan.deductStartDate
        }) || {};
        const endDate = loan.deductEndDate || schedule.deductEndDate || '-';
        const lastAmt = loan.lastDayAmount || schedule.lastDayAmount || 0;
        const actions = status.code === 'paid'
          ? '<span class="muted-inline">완납</span>'
          : `<button type="button" class="small-btn primary-btn" data-loan-payment-full="${escapeHtml(loan.id)}">완납</button>
             <button type="button" class="small-btn" data-loan-payment-partial="${escapeHtml(loan.id)}">부분납</button>`;
        const interest = Math.max(0, Math.round(Number(loan.interest || 0)));
        const principalLabel = interest > 0
          ? `${formatMoney(total)}<br><span class="muted-inline">원금 ${formatMoney(loan.principal)}+이자 ${formatMoney(interest)}</span>`
          : formatMoney(loan.principal);
        const modeBadge = loan.finalApplyEnabled
          ? ' <span class="lease-status--done">ERP차감</span>'
          : ' <span class="lease-status--collecting">수기납부</span>';
        return `<tr>
          <td>${escapeHtml(loan.driverName || '-')}${modeBadge}</td>
          <td>${escapeHtml(loan.driverPhone || '-')}</td>
          <td>${principalLabel}</td>
          <td>${formatMoney(loan.balance)}</td>
          <td>${formatMoney(loan.externalPaid)}</td>
          <td>${formatMoney(loan.dailyDeduct)}</td>
          <td>${escapeHtml(loan.deductStartDate || '-')} ~ ${escapeHtml(endDate)}</td>
          <td>${formatMoney(lastAmt)}</td>
          <td><span class="${status.cls}">${escapeHtml(status.label)}</span></td>
          <td class="lease-payment-confirm-actions">${actions}</td>
        </tr>`;
      }).join('');
      updatePaymentConfirmBulkUi();
      return;
    }

    // 리스
    if (!erp()) return;
    if (headEl) {
      headEl.innerHTML = `<tr>
        <th class="lease-check-col">선택</th>
        <th>주차(수~화)</th><th>차량번호</th><th>기종</th><th>렌탈/리스자</th><th>연락처</th>
        <th>주간리스비</th><th>이번주청구</th><th>납부액</th><th>차액</th><th>납부상태</th><th>관리</th>
      </tr>`;
    }
    const weekStart = syncPaymentWeekUi(currentWeekStart());
    const weekLabel = formatPaymentWeekColumn(weekStart);
    const vehicles = erp().vehicles().getAll();
    const vehicleMap = new Map(vehicles.map(item => [item.id, item]));

    if (statusFilter === 'paid') {
      let rows = listPaidPaymentConfirmRows().filter(row => row.weekStart === weekStart || true);
      if (keyword) {
        rows = rows.filter(row => [row.driverName, row.driverPhone, row.vehicleNumber, row.model]
          .join(' ').toLowerCase().includes(keyword));
      }
      if (summaryEl) summaryEl.textContent = `리스 · 완납 ${rows.length}건`;
      if (!rows.length) {
        rowsEl.innerHTML = '<tr><td colspan="12" class="empty">완납 내역이 없습니다.</td></tr>';
        updatePaymentConfirmBulkUi();
        return;
      }
      rowsEl.innerHTML = rows.map(row => {
        const marginCls = row.margin < 0 ? 'lease-money--deficit' : (row.margin > 0 ? 'lease-money--profit' : '');
        const paidAmt = Math.max(0, Number(row.payment?.paidAmount || row.weeklyCharge || 0));
        return `<tr>
          <td class="lease-check-col"></td>
          <td class="lease-payment-week-cell"><strong>${escapeHtml(row.weekLabel)}</strong></td>
          <td>${escapeHtml(row.vehicleNumber)}</td>
          <td>${escapeHtml(row.model)}</td>
          <td>${escapeHtml(formatDriverContractLabel(row.driverName))}</td>
          <td>${escapeHtml(row.driverPhone)}</td>
          <td>${formatMoney(row.weeklyLease)}</td>
          <td>${formatMoney(row.weeklyCharge)}</td>
          <td><strong>${formatMoney(paidAmt)}</strong></td>
          <td class="${marginCls}">${formatMoney(row.margin)}</td>
          <td><span class="lease-status--done">완납</span></td>
          <td><button type="button" class="small-btn danger-btn" data-delete-paid-payment="${escapeHtml(row.payment.id)}">삭제</button></td>
        </tr>`;
      }).join('');
      updatePaymentConfirmBulkUi();
      return;
    }

    let contracts = getActivePaymentContracts().filter(contract =>
      matchesPaymentStatusFilter(paymentConfirmStatus(contract, weekStart).code, statusFilter)
    );
    if (keyword) {
      contracts = contracts.filter(contract => {
        const vehicle = vehicleMap.get(contract.vehicleId);
        const hay = [
          contract.driverName,
          contract.driverPhone,
          contract.vehicleNumber,
          vehicle?.vehicleNumber,
          vehicle?.model
        ].join(' ').toLowerCase();
        return hay.includes(keyword);
      });
    }
    if (summaryEl) {
      const label = statusFilter === 'partial' ? '부분납' : '미확인';
      summaryEl.textContent = `리스 · 이번주 ${weekLabel} · ${label} ${contracts.length}건`;
    }
    const visibleIds = new Set(contracts.map(contract => String(contract.id)));
    [...state.paymentConfirmSelectedIds].forEach(id => {
      if (!visibleIds.has(String(id))) state.paymentConfirmSelectedIds.delete(String(id));
    });
    if (!contracts.length) {
      rowsEl.innerHTML = vehicles.length
        ? '<tr><td colspan="12" class="empty">해당 조건의 리스 납부 건이 없습니다.</td></tr>'
        : '<tr><td colspan="12" class="empty">등록된 차량이 없습니다. 차량관리에서 먼저 등록하세요.</td></tr>';
      updatePaymentConfirmBulkUi();
      return;
    }
    rowsEl.innerHTML = contracts.map(contract => {
      const vehicle = vehicleMap.get(contract.vehicleId);
      const weeklyLease = vehicleWeeklyLeaseCost(vehicle);
      const progressiveCharge = contractPaymentConfirmCharge(contract, weekStart);
      const settleCharge = resolvePaymentConfirmCharge(contract, weekStart);
      const displayCharge = progressiveCharge > 0 ? progressiveCharge : settleCharge;
      const payment = findWeekPaymentConfirm(contract.vehicleId, weekStart);
      const paidAmt = Math.max(0, Number(payment?.paidAmount || 0));
      const margin = displayCharge - Math.round(weeklyLease * (Math.max(1, contractActiveDaysInWeek(contract, weekStart) || 7) / 7));
      const marginCls = margin < 0 ? 'lease-money--deficit' : (margin > 0 ? 'lease-money--profit' : '');
      const status = paymentConfirmStatus(contract, weekStart);
      const applied = isContractFinalApplyEnabled(contract);
      const noDaily = settleCharge <= 0;
      const disabled = noDaily ? ' disabled' : '';
      const checked = state.paymentConfirmSelectedIds.has(String(contract.id)) ? ' checked' : '';
      const rowSelected = checked ? ' class="row-selected"' : '';
      const modeBadge = applied
        ? ' <span class="lease-status--done">ERP차감</span>'
        : ' <span class="lease-status--collecting">수기납부</span>';
      const chargeHint = progressiveCharge <= 0 && settleCharge > 0
        ? '<br><span class="muted-inline">경과0 · 주간청구</span>'
        : '';
      return `<tr${rowSelected}>
        <td class="lease-check-col">
          <input type="checkbox" data-payment-select="${escapeHtml(contract.id)}"${checked}${disabled}>
        </td>
        <td class="lease-payment-week-cell"><strong>${escapeHtml(weekLabel)}</strong></td>
        <td>${escapeHtml(vehicle?.vehicleNumber || contract.vehicleNumber || '-')}</td>
        <td>${escapeHtml(vehicle?.model || contract.modelType || '-')}</td>
        <td>${escapeHtml(formatDriverContractLabel(contract.driverName || '-'))}${modeBadge}</td>
        <td>${escapeHtml(contract.driverPhone || '-')}</td>
        <td>${formatMoney(weeklyLease)}</td>
        <td>${formatMoney(displayCharge)}${chargeHint}</td>
        <td><strong>${formatMoney(paidAmt)}</strong></td>
        <td class="${marginCls}">${formatMoney(margin)}</td>
        <td><span class="${status.cls}">${escapeHtml(status.label)}</span></td>
        <td class="lease-payment-confirm-actions">
          <button type="button" class="small-btn primary-btn" data-payment-full="${escapeHtml(contract.id)}"${disabled}>완납</button>
          <button type="button" class="small-btn" data-payment-partial="${escapeHtml(contract.id)}"${disabled}>부분납</button>
        </td>
      </tr>`;
    }).join('');
    updatePaymentConfirmBulkUi();
  }

  function renderPaymentPaid() {
    const rowsEl = $('leasePaymentPaidRows');
    const headEl = $('leasePaymentPaidHead');
    const summaryEl = $('leasePaymentPaidSummary');
    if (!rowsEl) return;
    syncPaymentPaidTabUi();
    const source = state.paymentPaidSource;
    const keyword = String(state.paymentPaidSearch || $('leasePaymentPaidSearch')?.value || '').trim().toLowerCase();

    if (source === 'loan') {
      if (headEl) {
        headEl.innerHTML = `<tr>
          <th>기사</th><th>연락처</th><th>대여금</th><th>외부납부</th><th>시작~종료</th><th>이유</th><th>상태</th>
        </tr>`;
      }
      let loans = (window.BremStorage?.leaseLoans?.getAll?.() || [])
        .filter(loan => loanPaymentStatus(loan).code === 'paid');
      if (keyword) {
        loans = loans.filter(loan => [loan.driverName, loan.driverPhone, loan.reason]
          .join(' ').toLowerCase().includes(keyword));
      }
      if (summaryEl) summaryEl.textContent = `대여 완납 ${loans.length}건`;
      if (!loans.length) {
        rowsEl.innerHTML = '<tr><td colspan="7" class="empty">대여 완납 내역이 없습니다.</td></tr>';
        return;
      }
      rowsEl.innerHTML = loans.map(loan => {
        const endDate = loan.deductEndDate || '-';
        const total = Math.max(0, Math.round(Number(loan.totalAmount != null
          ? loan.totalAmount
          : (Number(loan.principal || 0) + Number(loan.interest || 0)))));
        return `<tr>
          <td>${escapeHtml(loan.driverName || '-')}</td>
          <td>${escapeHtml(loan.driverPhone || '-')}</td>
          <td>${formatMoney(total)}${Number(loan.interest || 0) > 0 ? ` <span class="muted-inline">(이자 ${formatMoney(loan.interest)})</span>` : ''}</td>
          <td>${formatMoney(loan.externalPaid)}</td>
          <td>${escapeHtml(loan.deductStartDate || '-')} ~ ${escapeHtml(endDate)}</td>
          <td>${escapeHtml(loan.reason || '-')}</td>
          <td><span class="lease-status--done">완납</span></td>
        </tr>`;
      }).join('');
      return;
    }

    if (!erp()) return;
    if (headEl) {
      headEl.innerHTML = `<tr>
        <th>주차(수~화)</th><th>차량번호</th><th>기종</th><th>렌탈/리스자</th><th>연락처</th>
        <th>주간리스비</th><th>주간청구액</th><th>차액</th><th>납부액</th><th>완납일</th><th>상태</th><th>관리</th>
      </tr>`;
    }
    let rows = listPaidPaymentConfirmRows();
    if (keyword) {
      rows = rows.filter(row => {
        const hay = [
          row.driverName,
          row.driverPhone,
          row.vehicleNumber,
          row.model,
          row.weekLabel
        ].join(' ').toLowerCase();
        return hay.includes(keyword);
      });
    }
    if (summaryEl) {
      summaryEl.textContent = keyword
        ? `리스 완납 ${listPaidPaymentConfirmRows().length}건 · 검색 ${rows.length}건`
        : `리스 완납 ${rows.length}건`;
    }
    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="12" class="empty">완납 내역이 없습니다. 납부 확인에서 완납 처리하거나 미납/회수에서 전액 회수하면 여기에 표시됩니다.</td></tr>';
      return;
    }
    rowsEl.innerHTML = rows.map(row => {
      const marginCls = row.margin < 0 ? 'lease-money--deficit' : (row.margin > 0 ? 'lease-money--profit' : '');
      return `<tr>
        <td class="lease-payment-week-cell"><strong>${escapeHtml(row.weekLabel)}</strong></td>
        <td>${escapeHtml(row.vehicleNumber)}</td>
        <td>${escapeHtml(row.model)}</td>
        <td>${escapeHtml(formatDriverContractLabel(row.driverName))}</td>
        <td>${escapeHtml(row.driverPhone)}</td>
        <td>${formatMoney(row.weeklyLease)}</td>
        <td>${formatMoney(row.weeklyCharge)}</td>
        <td class="${marginCls}">${formatMoney(row.margin)}</td>
        <td>${formatMoney(row.payment.paidAmount)}</td>
        <td>${formatDate(row.payment.paidDate)}</td>
        <td><span class="lease-status--done">완납</span></td>
        <td>
          <button type="button" class="small-btn danger-btn" data-delete-paid-payment="${escapeHtml(row.payment.id)}">삭제</button>
        </td>
      </tr>`;
    }).join('');
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
      const autoTag = item.rawData?.source === 'weekly-auto'
        ? ' <span class="lease-status-badge lease-arrear-auto-tag">주정산</span>'
        : (item.rawData?.source === 'retro-settlement' || item.rawData?.ledgerId
          ? ' <span class="lease-status-badge lease-arrear-auto-tag">정산연동·차감</span>'
          : '');
      const driverLabel = contract?.driverName
        || item.rawData?.driverName
        || vehicle?.renter
        || '-';
      return `
        <tr>
          <td>${escapeHtml(vehicle?.vehicleNumber || '-')}</td>
          <td>${escapeHtml(vehicle?.model || '-')}</td>
          <td>${escapeHtml(driverLabel)}${autoTag}</td>
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
    const updated = erp().arrears().update(id, {
      paidAmount: Number(item.paidAmount || 0) + amount,
      recoveredAmount: Number(item.recoveredAmount || 0) + amount,
      unpaidAmount: remaining,
      collectionStatus: remaining > 0 ? collecting : completed,
      processedDate: remaining > 0 ? item.processedDate : BremLeaseProfit.todayKey(),
      rawData: { ...(item.rawData || {}), processingHistory: history }
    });
    syncLedgerFromArrear(updated || {
      ...item,
      unpaidAmount: remaining,
      collectionStatus: remaining > 0 ? collecting : completed,
      recoveredAmount: Number(item.recoveredAmount || 0) + amount
    });
    if (item.contractId && remaining === 0) {
      erp().contracts().update(item.contractId, {
        collectionStatus: completed,
        recoveredAmount: Number(item.recoveredAmount || 0) + amount,
        unpaidDays: 0,
        unpaidAmount: 0,
        processedDate: BremLeaseProfit.todayKey()
      });
      syncPaymentConfirmOnArrearCleared(item.contractId, {
        ...item,
        unpaidAmount: 0,
        recoveredAmount: Number(item.recoveredAmount || 0) + amount
      });
    }
    try {
      await erp().persistAll({ skipFlushStorage: true });
      await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    } catch (error) {
      console.error('[recordPartialArrearRecovery]', error);
      showToast(error?.message || '회수 내역 저장에 실패했습니다.');
      return;
    }
    updateLeaseErpUnsavedBanner();
    showToast(remaining > 0
      ? `일부 회수 ${formatMoney(amount)} · 잔액 ${formatMoney(remaining)} (차감관리 잔액 동기화)`
      : `전액 회수 완료 (${formatMoney(amount)}) · 차감관리 완납 · 납부확인도 완납 처리`);
    renderArrears();
    renderPaymentConfirm();
    renderPaymentPaid();
    if (state.menu === 'deduction') renderDeductionActivePane();
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
    const updated = erp().arrears().update(id, {
      collectionStatus: calc().ARREAR_STATUS.COMPLETED,
      processedDate: BremLeaseProfit.todayKey(),
      recoveredAmount: recovered,
      unpaidAmount: Math.max(0, item.unpaidAmount - recovered),
      paidAmount: item.paidAmount + recovered,
      memo,
      rawData: { ...(item.rawData || {}), processingHistory: history }
    });
    // 전액완료 패널은 회수 처리 완료로 보고 차감도 완납(잔액 0)
    syncLedgerFromArrear({
      ...(updated || item),
      unpaidAmount: 0,
      collectionStatus: calc().ARREAR_STATUS.COMPLETED
    });
    if (item.contractId) {
      erp().contracts().update(item.contractId, {
        collectionStatus: calc().ARREAR_STATUS.COMPLETED,
        recoveredAmount: recovered,
        unpaidDays: 0,
        unpaidAmount: 0,
        processedDate: BremLeaseProfit.todayKey()
      });
      syncPaymentConfirmOnArrearCleared(item.contractId, item);
    }
    try {
      await erp().persistAll({ skipFlushStorage: true });
      await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    } catch (error) {
      console.error('[confirmCompleteArrear]', error);
      showToast(error?.message || '미납 처리 저장에 실패했습니다.');
      return;
    }
    hideArrearCompletePanel();
    updateLeaseErpUnsavedBanner();
    showToast('미납 처리 완료 · 차감관리 완납 · 납부확인도 완납으로 반영');
    renderArrears();
    renderPaymentConfirm();
    renderPaymentPaid();
    if (state.menu === 'deduction') renderDeductionActivePane();
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
    $('leaseContractVehicleSearch')?.addEventListener('input', event => {
      state.contractVehicleSearch = String(event.target.value || '');
      renderLeaseContractVehicleResults();
    });
    $('leaseContractVehicleSearch')?.addEventListener('focus', () => {
      renderLeaseContractVehicleResults();
    });
    $('leaseContractVehicleResults')?.addEventListener('click', event => {
      const button = event.target.closest('[data-lease-pick-vehicle]');
      if (!button) return;
      const vehicle = erp()?.vehicles().getById(button.dataset.leasePickVehicle);
      if (vehicle) selectLeaseContractVehicle(vehicle);
    });
    document.addEventListener('click', event => {
      const box = $('leaseContractVehicleResults');
      const input = $('leaseContractVehicleSearch');
      if (!box || !input) return;
      if (box.contains(event.target) || input.contains(event.target)) return;
      box.hidden = true;
    });
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
    $('leaseDashVehicleSearch')?.addEventListener('input', event => {
      state.dashVehicleSearch = String(event.target.value || '');
      paintDashboardVehicleOverview();
    });
    $('leaseDashVehicleFilter')?.addEventListener('change', event => {
      state.dashVehicleFilter = String(event.target.value || 'all');
      paintDashboardVehicleOverview();
    });
    document.querySelectorAll('#lease-management [data-dash-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.dashSort;
        if (!key) return;
        if (state.dashVehicleSort.key === key) {
          state.dashVehicleSort.dir = state.dashVehicleSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.dashVehicleSort = { key, dir: 'asc' };
        }
        paintDashboardVehicleOverview();
      });
    });
    document.querySelectorAll('[data-contract-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.contractSort;
        if (state.contractSort.key === key) {
          state.contractSort.dir = state.contractSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.contractSort = { key, dir: 'asc' };
        }
        updateContractSortIndicators();
        renderContractList();
      });
    });
    updateContractSortIndicators();
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
    CONTRACT_DATE_FIELD_IDS.forEach(id => {
      $(id)?.addEventListener('change', () => {
        refreshContractDateLabel(id);
        if (id === 'leaseRentalDealEndDate') syncContractReturnDateWithEndDate();
        syncContractCalc();
      });
      $(id)?.addEventListener('input', () => {
        refreshContractDateLabel(id);
        syncContractCalc();
      });
    });
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
    $('leaseLoanWeekStart')?.addEventListener('change', () => {
      syncLeaseLoanWeeklyWeekUi($('leaseLoanWeekStart')?.value);
      renderWeeklyLoan();
    });
    $('leaseLoanWeekRefreshBtn')?.addEventListener('click', () => {
      syncLeaseLoanWeeklyWeekUi($('leaseLoanWeekStart')?.value || state.weekStart || currentWeekStart());
      renderWeeklyLoan();
    });
    $('leaseLoanWeekExportBtn')?.addEventListener('click', exportWeeklyLoanExcel);
    $('leaseLoanMonthKey')?.addEventListener('change', renderMonthlyLoan);
    $('leaseLoanMonthRefreshBtn')?.addEventListener('click', renderMonthlyLoan);
    $('leaseLoanMonthExportBtn')?.addEventListener('click', exportMonthlyLoanExcel);
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
        if (contract) {
          if (state.menu !== 'contract') setMenu('contract', { keepContractForm: true });
          fillContractForm(contract);
        }
        return;
      }
      const deleteContractBtn = event.target.closest('[data-delete-contract]');
      if (deleteContractBtn) {
        void deleteContract(deleteContractBtn.dataset.deleteContract);
        return;
      }
      const editEmpty = event.target.closest('[data-edit-empty-vehicle]');
      if (editEmpty) {
        setMenu('vehicle', { keepVehicleForm: true });
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
        return;
      }
      const paymentFullBtn = event.target.closest('[data-payment-full]');
      if (paymentFullBtn) {
        void confirmPaymentFull(paymentFullBtn.dataset.paymentFull);
        return;
      }
      const paymentPartialBtn = event.target.closest('[data-payment-partial]');
      if (paymentPartialBtn) {
        void confirmPaymentPartial(paymentPartialBtn.dataset.paymentPartial);
        return;
      }
      const loanPaymentFull = event.target.closest('[data-loan-payment-full]');
      if (loanPaymentFull) {
        void confirmLoanPaymentFull(loanPaymentFull.dataset.loanPaymentFull);
        return;
      }
      const loanPaymentPartial = event.target.closest('[data-loan-payment-partial]');
      if (loanPaymentPartial) {
        void confirmLoanPaymentPartial(loanPaymentPartial.dataset.loanPaymentPartial);
        return;
      }
      const paymentSourceBtn = event.target.closest('[data-payment-source]');
      if (paymentSourceBtn) {
        state.paymentSource = paymentSourceBtn.dataset.paymentSource === 'loan' ? 'loan' : 'lease';
        state.paymentConfirmSelectedIds.clear();
        renderPaymentConfirm();
        return;
      }
      const paymentStatusBtn = event.target.closest('[data-payment-status]');
      if (paymentStatusBtn) {
        const next = paymentStatusBtn.dataset.paymentStatus;
        state.paymentStatusFilter = ['open', 'partial', 'paid'].includes(next) ? next : 'open';
        state.paymentConfirmSelectedIds.clear();
        renderPaymentConfirm();
        return;
      }
      const paymentPaidSourceBtn = event.target.closest('[data-payment-paid-source]');
      if (paymentPaidSourceBtn) {
        state.paymentPaidSource = paymentPaidSourceBtn.dataset.paymentPaidSource === 'loan' ? 'loan' : 'lease';
        renderPaymentPaid();
        return;
      }
      const deletePaidBtn = event.target.closest('[data-delete-paid-payment]');
      if (deletePaidBtn) {
        void deletePaidPaymentConfirm(deletePaidBtn.dataset.deletePaidPayment);
        return;
      }
      const deductionApplyBtn = event.target.closest('[data-deduction-lease-apply]');
      if (deductionApplyBtn) {
        const id = deductionApplyBtn.dataset.deductionLeaseApply;
        const startInput = document.querySelector(`[data-lease-deduct-start="${CSS.escape(id)}"]`);
        void setContractFinalApply(id, true, {
          deductStartDate: startInput?.value || ''
        });
        return;
      }
      const deductionClearBtn = event.target.closest('[data-deduction-lease-clear]');
      if (deductionClearBtn) {
        void setContractFinalApply(deductionClearBtn.dataset.deductionLeaseClear, false);
        return;
      }
      const loanPick = event.target.closest('[data-loan-pick-driver]');
      if (loanPick) {
        const driver = getContractDrivers().find(item => String(item.id) === String(loanPick.dataset.loanPickDriver));
        pickLoanDriver(driver);
        return;
      }
      const loanApply = event.target.closest('[data-loan-apply]');
      if (loanApply) {
        void setLoanFinalApply(loanApply.dataset.loanApply, true);
        return;
      }
      const loanClear = event.target.closest('[data-loan-clear]');
      if (loanClear) {
        void setLoanFinalApply(loanClear.dataset.loanClear, false);
        return;
      }
      const loanEdit = event.target.closest('[data-loan-edit]');
      if (loanEdit) {
        editLoan(loanEdit.dataset.loanEdit);
        return;
      }
      const loanDelete = event.target.closest('[data-loan-delete]');
      if (loanDelete) {
        void deleteLoan(loanDelete.dataset.loanDelete);
        return;
      }
      const manualPick = event.target.closest('[data-manual-pick-driver]');
      if (manualPick) {
        const driver = getContractDrivers().find(item => String(item.id) === String(manualPick.dataset.manualPickDriver));
        pickManualDeductDriver(driver);
        return;
      }
      const manualDelete = event.target.closest('[data-manual-deduct-delete]');
      if (manualDelete) {
        void deleteManualDeduct(manualDelete.dataset.manualDeductDelete);
        return;
      }
      const manageApply = event.target.closest('[data-deduction-manage-apply]');
      if (manageApply) {
        void setManageItemApply(manageApply.dataset.deductionManageApply, true);
        return;
      }
      const manageClear = event.target.closest('[data-deduction-manage-clear]');
      if (manageClear) {
        void setManageItemApply(manageClear.dataset.deductionManageClear, false);
      }
    });

    document.addEventListener('change', event => {
      const startInput = event.target?.closest?.('[data-lease-deduct-start]');
      if (startInput) {
        void saveLeaseDeductStartDate(startInput.dataset.leaseDeductStart, startInput.value);
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
    $('leaseArrearBulkWeeklyBtn')?.addEventListener('click', () => { void bulkRegisterWeeklyLeaseArrears(); });
    $('leaseArrearCompleteConfirmBtn')?.addEventListener('click', () => { void confirmCompleteArrear(); });
    $('leaseArrearCompleteCancelBtn')?.addEventListener('click', hideArrearCompletePanel);

    $('leasePaymentConfirmSearch')?.addEventListener('input', event => {
      state.paymentConfirmSearch = String(event.target.value || '');
      renderPaymentConfirm();
    });
    $('leasePaymentPaidSearch')?.addEventListener('input', event => {
      state.paymentPaidSearch = String(event.target.value || '');
      renderPaymentPaid();
    });
    $('leasePaymentConfirmBulkPaidBtn')?.addEventListener('click', () => { void bulkConfirmPaymentFull(); });
    $('leasePaymentConfirmSelectAll')?.addEventListener('change', event => {
      const checked = !!event.target.checked;
      document.querySelectorAll('[data-payment-select]').forEach(el => {
        if (el.disabled) return;
        el.checked = checked;
        const id = String(el.dataset.paymentSelect || '');
        if (!id) return;
        if (checked) state.paymentConfirmSelectedIds.add(id);
        else state.paymentConfirmSelectedIds.delete(id);
        el.closest('tr')?.classList.toggle('row-selected', checked);
      });
      updatePaymentConfirmBulkUi();
    });

    document.querySelectorAll('[data-deduction-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.deductionTab;
        state.deductionTab = ['lease', 'loan', 'manage'].includes(next) ? next : 'lease';
        syncDeductionTabUi();
        renderDeductionActivePane();
      });
    });
    $('leaseDeductionLeaseSearch')?.addEventListener('input', event => {
      state.deductionLeaseSearch = String(event.target.value || '');
      renderDeductionLease();
    });
    $('leaseDeductionLoanSearch')?.addEventListener('input', event => {
      state.deductionLoanSearch = String(event.target.value || '');
      renderDeductionLoan();
    });
    $('leaseDeductionManageSearch')?.addEventListener('input', event => {
      state.deductionManageSearch = String(event.target.value || '');
      renderDeductionManage();
    });
    $('leaseDeductionManageKindFilter')?.addEventListener('change', event => {
      state.deductionManageKind = String(event.target.value || 'all');
      renderDeductionManage();
    });
    $('leaseLoanDriverSearch')?.addEventListener('input', event => {
      state.loanDriverSearch = String(event.target.value || '');
      renderLoanDriverResults();
    });
    $('leaseLoanForm')?.addEventListener('submit', event => { void saveLoanForm(event); });
    $('leaseLoanFormResetBtn')?.addEventListener('click', () => resetLoanForm());
    ['leaseLoanPrincipal', 'leaseLoanInterest', 'leaseLoanDailyDeduct', 'leaseLoanDeductStartDate'].forEach(id => {
      $(id)?.addEventListener('input', () => syncLoanSchedulePreview());
      $(id)?.addEventListener('change', () => syncLoanSchedulePreview());
    });
    $('leaseManualDeductDriverSearch')?.addEventListener('input', event => {
      state.manualDriverSearch = String(event.target.value || '');
      renderManualDeductDriverResults();
    });
    $('leaseManualDeductForm')?.addEventListener('submit', event => { void saveManualDeductForm(event); });
    $('leaseManualDeductFormResetBtn')?.addEventListener('click', () => resetManualDeductForm());
    $('leaseDeductionLeaseBulkApplyBtn')?.addEventListener('click', () => { void bulkSetContractFinalApply(true); });
    $('leaseDeductionLeaseBulkClearBtn')?.addEventListener('click', () => { void bulkSetContractFinalApply(false); });
    $('leaseDeductionManageBulkApplyBtn')?.addEventListener('click', () => { void bulkSetManageApply(true); });
    $('leaseDeductionManageBulkClearBtn')?.addEventListener('click', () => { void bulkSetManageApply(false); });
    $('leaseDeductionLeaseSelectAll')?.addEventListener('change', event => {
      const checked = !!event.target.checked;
      document.querySelectorAll('[data-deduction-lease-select]').forEach(el => {
        el.checked = checked;
        const id = String(el.dataset.deductionLeaseSelect || '');
        if (!id) return;
        if (checked) state.deductionLeaseSelectedIds.add(id);
        else state.deductionLeaseSelectedIds.delete(id);
        el.closest('tr')?.classList.toggle('row-selected', checked);
      });
      updateDeductionLeaseBulkUi();
    });
    $('leaseDeductionManageSelectAll')?.addEventListener('change', event => {
      const checked = !!event.target.checked;
      document.querySelectorAll('[data-deduction-manage-select]').forEach(el => {
        el.checked = checked;
        const key = String(el.dataset.deductionManageSelect || '');
        if (!key) return;
        if (checked) state.deductionManageSelectedKeys.add(key);
        else state.deductionManageSelectedKeys.delete(key);
        el.closest('tr')?.classList.toggle('row-selected', checked);
      });
      updateDeductionManageBulkUi();
    });

    document.addEventListener('change', event => {
      const deductionLeaseCheck = event.target.closest('[data-deduction-lease-select]');
      if (deductionLeaseCheck) {
        const id = String(deductionLeaseCheck.dataset.deductionLeaseSelect || '');
        if (!id) return;
        if (deductionLeaseCheck.checked) state.deductionLeaseSelectedIds.add(id);
        else state.deductionLeaseSelectedIds.delete(id);
        deductionLeaseCheck.closest('tr')?.classList.toggle('row-selected', deductionLeaseCheck.checked);
        updateDeductionLeaseBulkUi();
        return;
      }
      const deductionManageCheck = event.target.closest('[data-deduction-manage-select]');
      if (deductionManageCheck) {
        const key = String(deductionManageCheck.dataset.deductionManageSelect || '');
        if (!key) return;
        if (deductionManageCheck.checked) state.deductionManageSelectedKeys.add(key);
        else state.deductionManageSelectedKeys.delete(key);
        deductionManageCheck.closest('tr')?.classList.toggle('row-selected', deductionManageCheck.checked);
        updateDeductionManageBulkUi();
        return;
      }
      const paymentCheck = event.target.closest('[data-payment-select]');
      if (paymentCheck) {
        const id = String(paymentCheck.dataset.paymentSelect || '');
        if (!id) return;
        if (paymentCheck.checked) state.paymentConfirmSelectedIds.add(id);
        else state.paymentConfirmSelectedIds.delete(id);
        paymentCheck.closest('tr')?.classList.toggle('row-selected', paymentCheck.checked);
        updatePaymentConfirmBulkUi();
        return;
      }
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
      fillVehicleSelect($('leaseCalcVehicleId'));
      if ($('leaseWeekStart')) syncLeaseWeeklyWeekUi(currentWeekStart());
      if ($('leaseLoanWeekStart')) syncLeaseLoanWeeklyWeekUi(currentWeekStart());
      syncArrearWeekUi(currentWeekStart());
      if ($('leaseMonthKey') && !$('leaseMonthKey').value) $('leaseMonthKey').value = currentMonthKey();
      if ($('leaseLoanMonthKey') && !$('leaseLoanMonthKey').value) {
        $('leaseLoanMonthKey').value = currentMonthKey();
      }
      updateLeaseDashWeekUi();
      resetLoanForm();
      resetManualDeductForm();
    }
    void ensureLeaseDriversLoaded();
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
    fillVehicleSelect($('leaseCalcVehicleId'));
    renderDashboardKpis();
    paintDashboardVehicleOverview();
    if (options.loadRemote !== false) {
      await renderDashboardVehicleOverview();
    }
    if (state.menu === 'weekly') renderWeekly();
    if (state.menu === 'monthly') renderMonthly();
    if (state.menu === 'weekly-loan') renderWeeklyLoan();
    if (state.menu === 'monthly-loan') renderMonthlyLoan();
    if (state.menu === 'arrears') renderArrears();
    if (state.menu === 'payment-confirm') renderPaymentConfirm();
    if (state.menu === 'payment-paid') renderPaymentPaid();
    if (state.menu === 'deduction') renderDeductionActivePane();
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
    renderWeeklyLoan,
    renderMonthlyLoan,
    renderArrears,
    renderPaymentConfirm,
    renderPaymentPaid,
    renderEmpty,
    renderDashboard,
    renderDashboardKpis,
    paintDashboardVehicleOverview,
    renderDashboardVehicleOverview,
    updateLeaseDashWeekUi,
    syncLeaseDashWeekUi,
    handleDashboardWeekChange,
    handleWeeklyWeekChange,
    handleLoanWeeklyWeekChange,
    handleArrearWeekChange,
    handlePaymentWeekChange,
    syncLeaseWeeklyWeekUi,
    syncLeaseLoanWeeklyWeekUi,
    syncArrearWeekUi,
    syncPaymentWeekUi,
    commitLeaseErpSave,
    updateLeaseErpUnsavedBanner,
    renderStatusTagsHtml,
    currentWeekStart,
    renderContractList,
    syncLedgerFromArrear,
    createRetroUnpaidPair
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

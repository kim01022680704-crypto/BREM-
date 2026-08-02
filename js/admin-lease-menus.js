/**
 * 리스 ERP — 11개 서브메뉴 (대시보드 · 차량 · 계약 · 납부확인 · 완납확인 · 자동계산 · 미납 · 공차 · 주간/월간 · 일괄)
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
    if (menu === 'dashboard') {
      syncLeaseDashWeekUi(currentWeekStart());
      renderDashboard();
    }
    if (menu === 'weekly') renderWeekly();
    if (menu === 'monthly') renderMonthly();
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
    const checked = document.querySelector('input[name="leaseContractDeductionPlatform"]:checked');
    const value = checked?.value === 'baemin' ? 'baemin' : 'coupang';
    return value;
  }

  function setContractDeductionPlatform(platform) {
    const target = platform === 'baemin' ? 'baemin' : 'coupang';
    document.querySelectorAll('input[name="leaseContractDeductionPlatform"]').forEach(input => {
      input.checked = input.value === target;
    });
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

  /** 계약 시 정한 주간 청구액(라이더 부담) = 일렌탈료 × 7 */
  function contractRiderWeeklyCharge(contract) {
    if (!contract) return 0;
    const daily = contractRiderDailyRent(contract);
    if (daily > 0) return Math.round(daily * 7);
    return Math.max(0, Math.round(Number(contract.weeklyRent || 0)));
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
    const vehicleId = contract?.vehicleId;
    const vehicle = vehicleId ? erp()?.vehicles().getById(vehicleId) : null;
    const open = hasOpenArrear(vehicleId);
    const amount = resolveVehicleUnpaidAmount(vehicleId, { unpaidAmount: vehicle?.unpaidAmount });
    const days = Math.max(0, Number(vehicle?.unpaidDays || 0));
    return { isUnpaid: open || amount > 0 || days > 0, amount, days };
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
      const unpaidTag = unpaid.isUnpaid
        ? ` <span class="lease-status-badge lease-status-badge--unpaid lease-unpaid-tag">미납${unpaid.amount > 0 ? ' ' + formatMoney(unpaid.amount) : ''}</span>`
        : '';
      const weeklyLease = vehicleWeeklyLeaseCost(vehicle);
      const weeklyCharge = contractRiderWeeklyCharge(contract);
      const margin = weeklyCharge - weeklyLease;
      const marginCls = margin < 0 ? 'lease-money--deficit' : (margin > 0 ? 'lease-money--profit' : '');
      const driverLabel = ended
        ? escapeHtml(contract.driverName || '-')
        : escapeHtml(formatDriverContractLabel(contract.driverName || '-'));
      return `
        <tr class="${ended ? 'lease-contract-row--ended' : ''}${unpaid.isUnpaid ? ' lease-contract-row--unpaid' : ''}">
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
      showToast(wasEdit ? '계약을 수정했습니다. Supabase 저장을 눌러주세요.' : '계약을 추가했습니다. Supabase 저장을 눌러주세요.');

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

  // 선택 주(수~화) 안에서 계약이 활성인 일수(오늘까지만 카운트)
  function contractActiveDaysInWeek(contract, weekStart) {
    const range = calc()?.weekRange?.(weekStart);
    if (!range?.start || !range?.end) return 0;
    const cStart = String(contract.startDate || '').slice(0, 10);
    const cEnd = String(contract.returnDate || contract.endDate || '').slice(0, 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cur = new Date(`${range.start}T00:00:00`);
    const end = new Date(`${range.end}T00:00:00`);
    let days = 0;
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      const afterStart = !cStart || key >= cStart;
      const beforeEnd = !cEnd || key <= cEnd;
      const notFuture = cur.getTime() <= today.getTime();
      if (afterStart && beforeEnd && notFuture) days += 1;
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  // 주정산(수~화) 반영 시 리스비 미차감분을 미납/회수에 일괄 등록
  // (정산에서 이미 차감된 기사는 회수완료로 처리하면 됨)
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
    erp().contracts().getAll().forEach(contract => {
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
      showToast('이번 주에 신규 등록할 리스 미납이 없습니다.');
      return;
    }
    const total = candidates.reduce((sum, item) => sum + item.charge, 0);
    if (!window.confirm(
      `주정산(${weekStart}~) 리스비 미납 ${candidates.length}건 · 합계 ${formatMoney(total)} 을 미납/회수에 등록할까요?\n`
      + '정산에서 이미 리스비가 차감된 기사는 등록 후 「회수완료」로 처리하세요.'
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
    const charge = contractRiderWeeklyCharge(contract);
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

  async function confirmPaymentFull(contractId, options = {}) {
    if (!erp()) return;
    const contract = erp().contracts().getById(contractId);
    if (!contract) {
      showToast('계약을 찾을 수 없습니다.');
      return;
    }
    const weekStart = syncPaymentWeekUi(state.paymentWeekStart || currentWeekStart());
    const charge = contractRiderWeeklyCharge(contract);
    if (charge <= 0) {
      showToast('주간 청구액이 없어 완납 처리할 수 없습니다. 계약/렌탈에서 일 렌탈료를 확인하세요.');
      return;
    }
    if (!options.skipConfirm) {
      if (!window.confirm(`${formatDriverContractLabel(contract.driverName || '기사')} · ${formatArrearWeekLabel(weekStart)}\n완납 ${formatMoney(charge)} 처리할까요?`)) return;
    }

    upsertWeekPaymentConfirm({
      vehicleId: contract.vehicleId,
      weekStart,
      chargeAmount: charge,
      paidAmount: charge,
      status: BremLeaseProfit?.PAYMENT_STATUSES?.NORMAL || 'normal'
    });

    // 같은 주 미납이 열려 있으면 해당 주 청구분만큼 차감·완료 처리
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

    try {
      await erp().persistAll({ skipFlushStorage: true });
    } catch (error) {
      console.error('[confirmPaymentFull]', error);
      showToast(error?.message || '완납 저장에 실패했습니다.');
      return;
    }
    updateLeaseErpUnsavedBanner();
    showToast(`완납 처리 · ${formatMoney(charge)} · 완납 확인으로 이동`);
    renderPaymentConfirm();
    renderPaymentPaid();
    refreshAfterLeaseMutation({ contract: false });
    setMenu('payment-paid');
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
    const charge = contractRiderWeeklyCharge(contract);
    if (charge <= 0) {
      showToast('주간 청구액이 없어 부분납 처리할 수 없습니다.');
      return;
    }
    const raw = window.prompt(
      `${formatDriverContractLabel(contract.driverName || '기사')} · 주간청구 ${formatMoney(charge)}\n납부 금액을 입력하세요. (0원이면 전액 미납 → 미납/회수 이동)`,
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
    const unpaidDays = daily > 0 ? Math.max(1, Math.round(unpaidAmount / daily)) : 7;
    upsertWeekPaymentConfirm({
      vehicleId: contract.vehicleId,
      weekStart,
      chargeAmount: charge,
      paidAmount: paid,
      status: BremLeaseProfit?.PAYMENT_STATUSES?.UNPAID || 'unpaid'
    });
    try {
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

  function renderPaymentConfirm() {
    const rowsEl = $('leasePaymentConfirmRows');
    const summaryEl = $('leasePaymentConfirmSummary');
    if (!rowsEl || !erp()) return;
    const weekStart = syncPaymentWeekUi(currentWeekStart());
    const weekLabel = formatPaymentWeekColumn(weekStart);
    const vehicles = erp().vehicles().getAll();
    const vehicleMap = new Map(vehicles.map(item => [item.id, item]));
    let contracts = getActivePaymentContracts().filter(contract =>
      paymentConfirmStatus(contract, weekStart).code !== 'paid'
    );
    const keyword = String(state.paymentConfirmSearch || $('leasePaymentConfirmSearch')?.value || '').trim().toLowerCase();
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
      const paidCount = listPaidPaymentConfirmRows().filter(row => row.weekStart === weekStart).length;
      summaryEl.textContent = `이번주 ${weekLabel} · 미확인 ${contracts.length}건 · 완납 ${paidCount}건(완납 확인)`;
    }
    if (!contracts.length) {
      rowsEl.innerHTML = vehicles.length
        ? '<tr><td colspan="10" class="empty">이번주 납부 확인할 계약이 없습니다. 완납 내역은 「완납 확인」에서 보세요.</td></tr>'
        : '<tr><td colspan="10" class="empty">등록된 차량이 없습니다. 차량관리에서 먼저 등록하세요.</td></tr>';
      return;
    }
    rowsEl.innerHTML = contracts.map(contract => {
      const vehicle = vehicleMap.get(contract.vehicleId);
      const weeklyLease = vehicleWeeklyLeaseCost(vehicle);
      const weeklyCharge = contractRiderWeeklyCharge(contract);
      const margin = weeklyCharge - weeklyLease;
      const marginCls = margin < 0 ? 'lease-money--deficit' : (margin > 0 ? 'lease-money--profit' : '');
      const status = paymentConfirmStatus(contract, weekStart);
      const disabled = weeklyCharge <= 0 ? ' disabled' : '';
      return `<tr>
        <td class="lease-payment-week-cell"><strong>${escapeHtml(weekLabel)}</strong></td>
        <td>${escapeHtml(vehicle?.vehicleNumber || contract.vehicleNumber || '-')}</td>
        <td>${escapeHtml(vehicle?.model || contract.modelType || '-')}</td>
        <td>${escapeHtml(formatDriverContractLabel(contract.driverName || '-'))}</td>
        <td>${escapeHtml(contract.driverPhone || '-')}</td>
        <td>${formatMoney(weeklyLease)}</td>
        <td>${formatMoney(weeklyCharge)}</td>
        <td class="${marginCls}">${formatMoney(margin)}</td>
        <td><span class="${status.cls}">${escapeHtml(status.label)}</span></td>
        <td class="lease-payment-confirm-actions">
          <button type="button" class="small-btn primary-btn" data-payment-full="${escapeHtml(contract.id)}"${disabled}>완납</button>
          <button type="button" class="small-btn" data-payment-partial="${escapeHtml(contract.id)}"${disabled}>부분납</button>
        </td>
      </tr>`;
    }).join('');
  }

  function renderPaymentPaid() {
    const rowsEl = $('leasePaymentPaidRows');
    const summaryEl = $('leasePaymentPaidSummary');
    if (!rowsEl || !erp()) return;
    let rows = listPaidPaymentConfirmRows();
    const keyword = String(state.paymentPaidSearch || $('leasePaymentPaidSearch')?.value || '').trim().toLowerCase();
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
        ? `완납 ${listPaidPaymentConfirmRows().length}건 · 검색 ${rows.length}건`
        : `완납 ${rows.length}건`;
    }
    if (!rows.length) {
      rowsEl.innerHTML = '<tr><td colspan="11" class="empty">완납 내역이 없습니다. 납부 확인에서 완납 처리하거나 미납/회수에서 전액 회수하면 여기에 표시됩니다.</td></tr>';
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
        : '';
      return `
        <tr>
          <td>${escapeHtml(vehicle?.vehicleNumber || '-')}</td>
          <td>${escapeHtml(vehicle?.model || '-')}</td>
          <td>${escapeHtml(contract?.driverName || vehicle?.renter || '-')}${autoTag}</td>
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
      syncPaymentConfirmOnArrearCleared(item.contractId, {
        ...item,
        unpaidAmount: 0,
        recoveredAmount: Number(item.recoveredAmount || 0) + amount
      });
    }
    try {
      await erp().persistAll({ skipFlushStorage: true });
    } catch (error) {
      console.error('[recordPartialArrearRecovery]', error);
      showToast(error?.message || '회수 내역 저장에 실패했습니다.');
      return;
    }
    updateLeaseErpUnsavedBanner();
    showToast(remaining > 0
      ? `일부 회수 ${formatMoney(amount)} · 잔액 ${formatMoney(remaining)}`
      : `전액 회수 완료 (${formatMoney(amount)}) · 납부확인도 완납 처리`);
    renderArrears();
    renderPaymentConfirm();
    renderPaymentPaid();
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
      syncPaymentConfirmOnArrearCleared(item.contractId, item);
    }
    try {
      await erp().persistAll({ skipFlushStorage: true });
    } catch (error) {
      console.error('[confirmCompleteArrear]', error);
      showToast(error?.message || '미납 처리 저장에 실패했습니다.');
      return;
    }
    hideArrearCompletePanel();
    updateLeaseErpUnsavedBanner();
    showToast('미납 처리 완료 · 납부확인도 완납으로 반영');
    renderArrears();
    renderPaymentConfirm();
    renderPaymentPaid();
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
    fillVehicleSelect($('leaseCalcVehicleId'));
    renderDashboardKpis();
    paintDashboardVehicleOverview();
    if (options.loadRemote !== false) {
      await renderDashboardVehicleOverview();
    }
    if (state.menu === 'weekly') renderWeekly();
    if (state.menu === 'monthly') renderMonthly();
    if (state.menu === 'arrears') renderArrears();
    if (state.menu === 'payment-confirm') renderPaymentConfirm();
    if (state.menu === 'payment-paid') renderPaymentPaid();
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
    handleArrearWeekChange,
    handlePaymentWeekChange,
    syncLeaseWeeklyWeekUi,
    syncArrearWeekUi,
    syncPaymentWeekUi,
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

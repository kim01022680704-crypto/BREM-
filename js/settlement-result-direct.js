const BremSettlementResultDirect = (function () {
  const $ = selector => document.querySelector(selector);
  const PROMO_TAX_RATE = 0.033;

  // week: 빈 문자열이면 주 필터 없음(전체 주). 정산주는 항상 수요일 시작.
  const state = { platform: 'baemin', settlementId: '', week: '', withdrawals: [] };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  // 날짜를 로컬 기준으로 찍는다. toISOString 을 쓰면 UTC+9 에서 하루씩 밀린다.
  function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function weekStartKey(dateValue = dateKey(new Date())) {
    if (window.BremDatePicker?.weekStartKey) return window.BremDatePicker.weekStartKey(dateValue);
    const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return dateKey(date);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
  }

  function promoTax(sum) {
    return Math.floor(Number(sum || 0) * PROMO_TAX_RATE);
  }

  function driverName(driverId, fallback) {
    const driver = window.BremStorage?.drivers?.getById?.(driverId);
    return driver?.name || fallback || '(이름 없음)';
  }

  // --- 정산서 선택 ---------------------------------------------------------

  function platformSettlements() {
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => String(record.platform || '') === state.platform)
      .slice()
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }

  // 정산주를 고르면 그 주의 정산서만 남긴다. 주를 안 골랐으면 전체를 보여준다.
  function settlementList() {
    const all = platformSettlements();
    if (!state.week) return all;
    return all.filter(record => settlementWeek(record) === state.week);
  }

  function currentSettlement() {
    const list = settlementList();
    if (!list.length) return null;
    return list.find(item => item.id === state.settlementId) || list[0];
  }

  // 최초 진입 시 기본 정산주 = 가장 최근 정산서의 주.
  function ensureWeek() {
    if (state.week) return state.week;
    const latest = platformSettlements()[0];
    state.week = latest ? settlementWeek(latest) : weekStartKey();
    return state.week;
  }

  function renderWeekButton() {
    const btn = $('#settlementResultWeekBtn');
    if (!btn) return;
    btn.textContent = state.week ? `${formatDate(state.week)}(수) 주` : '전체 주';
    const hidden = $('#settlementResultWeek');
    if (hidden) hidden.value = state.week;
  }

  function setWeek(value) {
    state.week = value ? weekStartKey(value) : '';
    state.settlementId = '';
    void refresh(state.platform);
  }

  function shiftWeek(deltaWeeks) {
    const base = ensureWeek();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + deltaWeeks * 7);
    setWeek(dateKey(date));
  }

  function settlementWeek(record) {
    if (!record) return weekStartKey();
    return weekStartKey(String(record.startDate || '').slice(0, 10) || weekStartKey());
  }

  function settlementOptionLabel(record) {
    const riders = Array.isArray(record.riders) ? record.riders.length : 0;
    const region = record.region ? ` · ${record.region}` : '';
    return `${formatDate(record.startDate)} ~ ${formatDate(record.endDate)}${region} · ${riders}명`;
  }

  function renderSettlementPicker() {
    const select = $('#settlementResultSettlementSelect');
    const info = $('#settlementResultWeekRange');
    const platformLabel = $('#settlementResultPlatformLabel');
    if (platformLabel) platformLabel.textContent = state.platform === 'coupang' ? '· 쿠팡' : '· 배민';
    if (!select) return;

    renderWeekButton();

    const list = settlementList();
    const active = currentSettlement();
    state.settlementId = active?.id || '';

    if (!list.length) {
      select.innerHTML = '<option value="">저장된 정산서 없음</option>';
      select.disabled = true;
      if (info) {
        const total = platformSettlements().length;
        info.textContent = state.week && total
          ? `${formatDate(state.week)}(수) 주에 저장된 정산서가 없습니다. 다른 주를 고르거나 「전체 주」를 누르세요. (전체 ${total}건)`
          : '「주정산서 업로드 (직계약)」에서 정산서를 먼저 저장하세요.';
      }
      return;
    }

    select.disabled = false;
    select.innerHTML = list
      .map(item => `<option value="${escapeHtml(item.id)}"${item.id === state.settlementId ? ' selected' : ''}>${escapeHtml(settlementOptionLabel(item))}</option>`)
      .join('');

    const weekInput = $('#settlementResultWeek');
    if (weekInput) weekInput.value = settlementWeek(active);

    if (info && active) {
      const file = active.fileName ? ` · 파일 ${active.fileName}` : '';
      info.textContent = `기간 ${formatDate(active.startDate)} ~ ${formatDate(active.endDate)} · 정산주 ${formatDate(settlementWeek(active))}(수)${file}`;
    }
  }

  // --- 계산 ---------------------------------------------------------------

  // 콜수수료 단가(급여일정산 설정) × 콜수
  function callFeeUnit() {
    const fees = window.BremStorage?.payrollDailySettlement?.getFees?.(state.platform) || {};
    return Math.max(0, Math.round(Number(fees.callFee || 0)));
  }

  function withdrawalRowFee(row) {
    if (row.feeAmount != null) return Math.max(0, Math.round(Number(row.feeAmount) || 0));
    const fees = window.BremStorage?.payrollDailySettlement?.getFees?.(row.platform || state.platform) || {};
    const resolve = window.BremStorage?.payrollDailySettlement?.resolveDailySettlementFee;
    return typeof resolve === 'function' ? resolve(Number(row.amount || 0), fees) : 0;
  }

  // 이 주 선정산(일정산) 처리완료 금액·수수료 맵: driverId → { prepaid, fee }
  function completedWithdrawalMap(week) {
    const platform = state.platform;
    const map = new Map();
    (Array.isArray(state.withdrawals) ? state.withdrawals : []).forEach(row => {
      if (String(row.status || '') !== 'completed') return;
      if (String(row.weekStart || '').slice(0, 10) !== week) return;
      const rowPlatform = String(row.platform || '');
      if (rowPlatform && rowPlatform !== platform) return;
      const driverId = String(row.driverId || '').trim();
      if (!driverId) return;
      const prev = map.get(driverId) || { prepaid: 0, fee: 0 };
      prev.prepaid += Math.max(0, Math.round(Number(row.amount || 0)));
      prev.fee += withdrawalRowFee(row);
      map.set(driverId, prev);
    });
    return map;
  }

  function computeRows() {
    const settlement = currentSettlement();
    if (!settlement) return [];
    const week = settlementWeek(settlement);
    const platform = state.platform;

    const store = window.BremStorage?.directSettlementAdjustments;
    const promoMap = store?.getSettlement?.('promotion', settlement.id) || {};
    const otherMap = store?.getSettlement?.('other', settlement.id) || {};
    const withdrawMap = completedWithdrawalMap(week);
    const unitCallFee = callFeeUnit();

    const rows = [];
    (Array.isArray(settlement.riders) ? settlement.riders : []).forEach(rider => {
      const driverId = String(rider.matchedRiderId || '').trim();
      const amounts = rider.amounts || {};
      const idLabel = platform === 'coupang'
        ? (rider.coupangLoginKey || '-')
        : (rider.baeminUserId || '-');
      const promo = driverId ? Number(promoMap[driverId]?.amount || 0) : 0;
      const other = driverId ? Number(otherMap[driverId]?.amount || 0) : 0;
      const deliveryFee = Number(amounts.deliveryFee || 0);
      const missionPay = Number(amounts.missionPay || 0);
      const grossPay = deliveryFee + missionPay + other + promo;

      const callCount = Number(rider.weeklyOrderCount || rider.systemCallCount || 0);
      const employmentInsurance = Number(amounts.employmentInsurance || 0);
      const accidentInsurance = Number(amounts.accidentInsurance || 0);
      const hourlyInsurance = Number(amounts.hourlyInsurance || 0);
      const withholdingTax = Number(amounts.withholdingTax || 0);
      const promotionWithholdingTax = promoTax(promo + other);
      const callFee = callCount * unitCallFee;
      const wd = driverId ? (withdrawMap.get(driverId) || { prepaid: 0, fee: 0 }) : { prepaid: 0, fee: 0 };
      const dailySettlementFee = wd.fee;
      const prepaid = wd.prepaid;
      const deductTotal = employmentInsurance + accidentInsurance + hourlyInsurance
        + withholdingTax + promotionWithholdingTax + callFee + dailySettlementFee + prepaid;
      const netPay = grossPay - deductTotal;

      rows.push({
        name: driverName(driverId, rider.driverName || rider.riderName || rider.originalName),
        idLabel,
        callCount,
        deliveryFee, missionPay, other, promo, grossPay,
        employmentInsurance, accidentInsurance, hourlyInsurance,
        withholdingTax, promotionWithholdingTax, callFee, dailySettlementFee, prepaid,
        deductTotal, netPay
      });
    });
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko-KR'));
    return rows;
  }

  // 표 헤더·본문·엑셀이 같은 정의를 쓰게 한 곳에 모아둔다. 따로 두면 열이 어긋난다.
  // 쿠팡 정산서에는 추가지급(배민미션) 항목이 없어 그 열은 쿠팡에서 빼고 보여준다.
  const ALL_COLUMNS = [
    { key: 'name', label: '기사', money: false, strong: true },
    { key: 'idLabel', label: 'ID', money: false },
    { key: 'callCount', label: '콜수' },
    { key: 'deliveryFee', label: '배달비' },
    { key: 'missionPay', label: '배민미션', baeminOnly: true },
    { key: 'other', label: '기타지급' },
    { key: 'promo', label: 'BREM프로모션' },
    { key: 'grossPay', label: '지급합계', strong: true },
    { key: 'employmentInsurance', label: '고용보험' },
    { key: 'accidentInsurance', label: '산재보험' },
    { key: 'hourlyInsurance', label: '시간제보험' },
    { key: 'withholdingTax', label: '원천세' },
    { key: 'promotionWithholdingTax', label: '프로모션원천세' },
    { key: 'callFee', label: '콜수수료' },
    { key: 'dailySettlementFee', label: '일정산수수료' },
    { key: 'prepaid', label: '선정산(처리완료)' },
    { key: 'deductTotal', label: '공제합계' },
    { key: 'netPay', label: '총지급액', strong: true }
  ];

  function columns() {
    if (state.platform === 'coupang') return ALL_COLUMNS.filter(col => !col.baeminOnly);
    return ALL_COLUMNS;
  }

  function renderHead() {
    const head = $('#settlementResultHead');
    if (!head) return;
    head.innerHTML = `<tr>${columns().map(col => `<th>${escapeHtml(col.label)}</th>`).join('')}</tr>`;
  }

  function render() {
    const body = $('#settlementResultRows');
    const summaryEl = $('#settlementResultSummary');
    if (!body) return;
    renderSettlementPicker();
    renderHead();
    const settlement = currentSettlement();
    const colspan = columns().length;

    if (!settlement) {
      body.innerHTML = `<tr><td colspan="${colspan}" class="empty">이 플랫폼에 저장된 직계약 정산서가 없습니다. (주정산서 업로드 · 직계약 확인)</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    const rows = computeRows();
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colspan}" class="empty">선택한 정산서에 라이더 데이터가 없습니다.</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    const totals = rows.reduce((acc, row) => {
      acc.grossPay += row.grossPay;
      acc.deductTotal += row.deductTotal;
      acc.netPay += row.netPay;
      acc.promo += row.promo;
      acc.other += row.other;
      return acc;
    }, { grossPay: 0, deductTotal: 0, netPay: 0, promo: 0, other: 0 });

    const cols = columns();
    body.innerHTML = rows.map(row => `
      <tr>${cols.map(col => {
      const value = col.money === false ? escapeHtml(row[col.key]) : formatNumber(row[col.key]);
      const cls = col.money === false ? '' : ' class="weekly-amount-cell"';
      return `<td${cls}>${col.strong ? `<strong>${value}</strong>` : value}</td>`;
    }).join('')}</tr>`).join('');

    if (summaryEl) {
      summaryEl.innerHTML = `대상 <strong>${rows.length}</strong>명 · 지급합계 <strong>${formatNumber(totals.grossPay)}</strong> · 공제합계 <strong>${formatNumber(totals.deductTotal)}</strong> · 총지급액 <strong>${formatNumber(totals.netPay)}</strong>원`
        + ` <span class="muted-inline">(불러온 BREM프로모션 ${formatNumber(totals.promo)} · 기타지급 ${formatNumber(totals.other)})</span>`;
    }
  }

  function exportExcel() {
    const rows = computeRows();
    if (!rows.length) {
      showToast('내보낼 데이터가 없습니다.');
      return;
    }
    if (!window.XLSX) {
      showToast('엑셀 모듈을 불러오지 못했습니다.');
      return;
    }
    const cols = columns();
    const data = [
      cols.map(col => col.label),
      ...rows.map(row => cols.map(col => row[col.key]))
    ];
    const ws = window.XLSX.utils.aoa_to_sheet(data);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '정산결과');
    const platform = state.platform === 'coupang' ? '쿠팡' : '배민';
    const week = settlementWeek(currentSettlement());
    window.XLSX.writeFile(wb, `정산결과_직계약_${platform}_${week}.xlsx`);
  }

  async function loadWithdrawals() {
    const week = settlementWeek(currentSettlement());
    try {
      const fetchApi = window.BremStorage?.payrollWithdrawal?.fetchFromAdminApi;
      if (typeof fetchApi === 'function') {
        state.withdrawals = await fetchApi({ weekStart: week });
        return;
      }
    } catch (error) {
      console.warn('[BREM] settlement-result: withdrawal fetch failed, fallback to cache:', error);
    }
    state.withdrawals = window.BremStorage?.payrollWithdrawal?.getAll?.() || [];
  }

  async function reload() {
    await window.BremStorage?.ensureSectionLoaded?.('settlement-result-direct');
    await loadWithdrawals();
    render();
    showToast('정산결과를 다시 불러왔습니다.');
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    $('#settlementResultSettlementSelect')?.addEventListener('change', async event => {
      state.settlementId = event.target.value || '';
      await loadWithdrawals();
      render();
    });
    $('#settlementResultWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#settlementResultWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    $('#settlementResultWeekAllBtn')?.addEventListener('click', () => setWeek(''));
    $('#settlementResultReloadBtn')?.addEventListener('click', () => { void reload(); });
    $('#settlementResultExportBtn')?.addEventListener('click', exportExcel);
  }

  async function refresh(platform) {
    if (!$('#settlementResultRows')) return;
    const next = platform === 'coupang' ? 'coupang' : 'baemin';
    if (next !== state.platform) {
      state.platform = next;
      state.settlementId = '';
      state.week = '';
    }
    ensureWeek();
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('settlement-result-direct');
    await loadWithdrawals();
    render();
  }

  function init() {
    if (!$('#settlementResultRows')) return;
    bindEvents();
  }

  return { init, refresh, state, onWeekPicked: setWeek };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremSettlementResultDirect.init();
});

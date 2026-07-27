const BremSettlementResultDirect = (function () {
  const $ = selector => document.querySelector(selector);
  const PROMO_TAX_RATE = 0.033;

  const state = { platform: 'baemin', settlementId: '', withdrawals: [] };

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

  function weekStartKey(dateValue = new Date().toISOString().slice(0, 10)) {
    if (window.BremDatePicker?.weekStartKey) return window.BremDatePicker.weekStartKey(dateValue);
    const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return date.toISOString().slice(0, 10);
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

  function settlementList() {
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => String(record.platform || '') === state.platform)
      .slice()
      .sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }

  function currentSettlement() {
    const list = settlementList();
    if (!list.length) return null;
    return list.find(item => item.id === state.settlementId) || list[0];
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

    const list = settlementList();
    const active = currentSettlement();
    state.settlementId = active?.id || '';

    if (!list.length) {
      select.innerHTML = '<option value="">저장된 정산서 없음</option>';
      select.disabled = true;
      if (info) info.textContent = '「주정산서 업로드 (직계약)」에서 정산서를 먼저 저장하세요.';
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

  function render() {
    const body = $('#settlementResultRows');
    const summaryEl = $('#settlementResultSummary');
    if (!body) return;
    renderSettlementPicker();
    const settlement = currentSettlement();

    if (!settlement) {
      body.innerHTML = '<tr><td colspan="18" class="empty">이 플랫폼에 저장된 직계약 정산서가 없습니다. (주정산서 업로드 · 직계약 확인)</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    const rows = computeRows();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="18" class="empty">선택한 정산서에 라이더 데이터가 없습니다.</td></tr>';
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

    body.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td>${escapeHtml(row.idLabel)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.callCount)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.deliveryFee)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.missionPay)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.other)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.promo)}</td>
        <td class="weekly-amount-cell"><strong>${formatNumber(row.grossPay)}</strong></td>
        <td class="weekly-amount-cell">${formatNumber(row.employmentInsurance)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.accidentInsurance)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.hourlyInsurance)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.withholdingTax)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.promotionWithholdingTax)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.callFee)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.dailySettlementFee)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.prepaid)}</td>
        <td class="weekly-amount-cell">${formatNumber(row.deductTotal)}</td>
        <td class="weekly-amount-cell"><strong>${formatNumber(row.netPay)}</strong></td>
      </tr>`).join('');

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
    const header = ['기사', 'ID', '콜수', '배달비', '배민미션', '기타지급', 'BREM프로모션', '지급합계',
      '고용보험', '산재보험', '시간제보험', '원천세', '프로모션원천세', '콜수수료', '일정산수수료', '선정산(처리완료)', '공제합계', '총지급액'];
    const data = [header, ...rows.map(row => [
      row.name, row.idLabel, row.callCount, row.deliveryFee, row.missionPay, row.other, row.promo, row.grossPay,
      row.employmentInsurance, row.accidentInsurance, row.hourlyInsurance, row.withholdingTax,
      row.promotionWithholdingTax, row.callFee, row.dailySettlementFee, row.prepaid, row.deductTotal, row.netPay
    ])];
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
    $('#settlementResultReloadBtn')?.addEventListener('click', () => { void reload(); });
    $('#settlementResultExportBtn')?.addEventListener('click', exportExcel);
  }

  async function refresh(platform) {
    if (!$('#settlementResultRows')) return;
    const next = platform === 'coupang' ? 'coupang' : 'baemin';
    if (next !== state.platform) {
      state.platform = next;
      state.settlementId = '';
    }
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('settlement-result-direct');
    await loadWithdrawals();
    render();
  }

  function init() {
    if (!$('#settlementResultRows')) return;
    bindEvents();
  }

  return { init, refresh, state };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremSettlementResultDirect.init();
});

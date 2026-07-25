const BremSettlementResultDirect = (function () {
  const $ = selector => document.querySelector(selector);
  const PROMO_TAX_RATE = 0.033;

  const state = { platform: 'baemin', week: '', withdrawals: [] };

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

  function weekEndKey(weekStart) {
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return end.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${value}T00:00:00`));
  }

  function promoTax(sum) {
    return Math.floor(Number(sum || 0) * PROMO_TAX_RATE);
  }

  function currentWeek() {
    if (!state.week) state.week = weekStartKey();
    return state.week;
  }

  function driverName(driverId, fallback) {
    const driver = window.BremStorage?.drivers?.getById?.(driverId);
    return driver?.name || fallback || '(이름 없음)';
  }

  function ensureWeekInput() {
    const input = $('#settlementResultWeek');
    if (input && !input.value) input.value = currentWeek();
    const label = $('#settlementResultWeekRange');
    if (label) {
      const wk = currentWeek();
      label.textContent = `표시 범위: ${formatDate(wk)}(수) ~ ${formatDate(weekEndKey(wk))}(화)`;
    }
    const platformLabel = $('#settlementResultPlatformLabel');
    if (platformLabel) platformLabel.textContent = state.platform === 'coupang' ? '· 쿠팡' : '· 배민';
  }

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
  function completedWithdrawalMap() {
    const week = currentWeek();
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
    const week = currentWeek();
    const platform = state.platform;
    const records = (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => String(record.platform || '') === platform
        && String(record.weekStart || '').slice(0, 10) === week);

    const promoMap = window.BremStorage?.directPayAdjustments?.getWeek?.('promotion', week) || {};
    const otherMap = window.BremStorage?.directPayAdjustments?.getWeek?.('other', week) || {};
    const withdrawMap = completedWithdrawalMap();
    const unitCallFee = callFeeUnit();

    const rows = [];
    records.forEach(record => {
      (Array.isArray(record.riders) ? record.riders : []).forEach(rider => {
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
    });
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko-KR'));
    return rows;
  }

  function render() {
    const body = $('#settlementResultRows');
    const summaryEl = $('#settlementResultSummary');
    if (!body) return;
    ensureWeekInput();
    const rows = computeRows();

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="18" class="empty">이 주·플랫폼에 정산 데이터가 없습니다. (주정산서 업로드/직계약 확인)</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    const totals = rows.reduce((acc, row) => {
      acc.grossPay += row.grossPay;
      acc.deductTotal += row.deductTotal;
      acc.netPay += row.netPay;
      return acc;
    }, { grossPay: 0, deductTotal: 0, netPay: 0 });

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
      summaryEl.innerHTML = `대상 <strong>${rows.length}</strong>명 · 지급합계 <strong>${formatNumber(totals.grossPay)}</strong> · 공제합계 <strong>${formatNumber(totals.deductTotal)}</strong> · 총지급액 <strong>${formatNumber(totals.netPay)}</strong>원`;
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
    window.XLSX.writeFile(wb, `정산결과_직계약_${platform}_${currentWeek()}.xlsx`);
  }

  async function loadWithdrawals() {
    const week = currentWeek();
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

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    $('#settlementResultWeek')?.addEventListener('change', async event => {
      state.week = weekStartKey(event.target.value || weekStartKey());
      event.target.value = state.week;
      await loadWithdrawals();
      render();
    });
    $('#settlementResultExportBtn')?.addEventListener('click', exportExcel);
  }

  async function refresh(platform) {
    if (!$('#settlementResultRows')) return;
    state.platform = platform === 'coupang' ? 'coupang' : 'baemin';
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('settlement-result-direct');
    await loadWithdrawals();
    render();
  }

  function init() {
    if (!$('#settlementResultRows')) return;
    bindEvents();
    ensureWeekInput();
  }

  return { init, refresh };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremSettlementResultDirect.init();
});

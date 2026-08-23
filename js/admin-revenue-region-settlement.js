// 수익 관리 · 지역별 정산 — 정산주(수~화) 단위로 직계약 정산서를 지역별 합산하고
// 공급대가·부가세 입력과 부가세 세무처리비(조절 가능 %)를 비교한다.
(function () {
  const LOAD_TIMEOUT_MS = 20000;

  const state = {
    weekStart: '',
    taxFeePercent: 20,
    rows: [],
    draftRegions: {},
    loading: false,
    savedAt: ''
  };

  function $(id) {
    return document.getElementById(id);
  }

  function Calc() {
    return window.BremDirectSettlementCalc;
  }

  function Revenue() {
    return window.BremStorage?.revenue;
  }

  function today() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekStartKey(dateValue = today()) {
    const calc = Calc();
    if (calc?.weekStartKey) return calc.weekStartKey(dateValue);
    const date = new Date(`${String(dateValue).slice(0, 10)}T00:00:00`);
    const diff = (date.getDay() - 3 + 7) % 7;
    date.setDate(date.getDate() - diff);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekEndKey(weekStart) {
    const picker = window.BremDatePicker;
    if (picker?.weekEndKey) return picker.weekEndKey(weekStart);
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return [
      end.getFullYear(),
      String(end.getMonth() + 1).padStart(2, '0'),
      String(end.getDate()).padStart(2, '0')
    ].join('-');
  }

  function formatDate(value) {
    if (!value) return '-';
    if (window.BremDatePicker?.formatDate) return window.BremDatePicker.formatDate(value);
    return String(value).slice(0, 10);
  }

  function formatWeekRange(weekStart) {
    if (!weekStart) return '정산주를 선택하세요';
    return `${formatDate(weekStart)} ~ ${formatDate(weekEndKey(weekStart))}`;
  }

  function formatMoney(value) {
    return `${Math.round(Number(value || 0)).toLocaleString('ko-KR')}원`;
  }

  function formatPercent(value) {
    if (value == null || !Number.isFinite(value)) return '-';
    return `${value.toFixed(1)}%`;
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

  function setLoadStatus(message) {
    const el = $('revenueRegionLoadStatus');
    if (el) el.textContent = message || '-';
  }

  function setSavedStatus(message) {
    const el = $('revenueRegionSavedStatus');
    if (el) el.textContent = message || '아직 저장되지 않았습니다.';
  }

  function loadSavedDraft(weekStart) {
    const saved = Revenue()?.getRegionSettlementByWeek?.(weekStart);
    state.savedAt = saved?.savedAt || '';
    state.taxFeePercent = Math.max(0, Math.min(100, Number(saved?.taxFeePercent ?? 20)));
    state.draftRegions = saved?.regions && typeof saved.regions === 'object'
      ? { ...saved.regions }
      : {};
    const taxInput = $('revenueRegionTaxFeePercent');
    if (taxInput) taxInput.value = String(state.taxFeePercent);
    if (state.savedAt) {
      setSavedStatus(`마지막 저장 ${new Date(state.savedAt).toLocaleString('ko-KR')}`);
    } else {
      setSavedStatus('아직 저장되지 않았습니다.');
    }
  }

  function collectDraftFromInputs() {
    const regions = { ...state.draftRegions };
    document.querySelectorAll('[data-region-supply]').forEach(input => {
      const region = String(input.dataset.regionSupply || '').trim();
      if (!region) return;
      if (!regions[region]) regions[region] = {};
      regions[region].supplyPaid = Math.round(Number(input.value || 0));
    });
    document.querySelectorAll('[data-region-vat]').forEach(input => {
      const region = String(input.dataset.regionVat || '').trim();
      if (!region) return;
      if (!regions[region]) regions[region] = {};
      regions[region].vat = Math.round(Number(input.value || 0));
    });
    state.draftRegions = regions;
    return regions;
  }

  function draftForRegion(region) {
    const saved = state.draftRegions[region] || {};
    return {
      supplyPaid: Math.round(Number(saved.supplyPaid || 0)),
      vat: Math.round(Number(saved.vat || 0))
    };
  }

  function settlementsForWeek(weekStart) {
    const calc = Calc();
    if (!calc) return [];
    const normalized = weekStartKey(weekStart);
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => calc.settlementWeek(record) === normalized);
  }

  function aggregateRegions(weekStart) {
    const calc = Calc();
    const normalized = weekStartKey(weekStart);
    if (!calc || !normalized) return { settlements: [], regions: [] };

    const settlements = settlementsForWeek(normalized);
    const byRegion = new Map();

    settlements.forEach(settlement => {
      calc.computeRows(settlement, { withdrawals: [] }).forEach(row => {
        const region = String(row.region || settlement.region || '').trim() || '미지정';
        const bucket = byRegion.get(region) || {
          region,
          grossPay: 0,
          riderCount: 0,
          ...Object.fromEntries((calc.GENERAL_DEDUCT_KEYS || []).map(key => [key, 0]))
        };
        bucket.grossPay += Number(row.grossPay || 0);
        (calc.GENERAL_DEDUCT_KEYS || []).forEach(key => {
          bucket[key] += Number(row[key] || 0);
        });
        bucket.riderCount += 1;
        byRegion.set(region, bucket);
      });
    });

    const regions = [...byRegion.values()]
      .map(bucket => {
        const generalDeduct = calc.generalDeductTotal(bucket);
        const payAmount = Math.round(Number(bucket.grossPay || 0)) - generalDeduct;
        const withholdingTaxTotal = calc.withholdingTaxTotal(bucket);
        const draft = draftForRegion(bucket.region);
        const supplyPaid = draft.supplyPaid;
        const vat = draft.vat;
        const taxFee = Math.round(vat * (state.taxFeePercent / 100));
        // 원천세는 회사 수익이라 사용 가능한 재원에 더해 사용률을 다시 본다.
        const payWithTax = payAmount + withholdingTaxTotal;
        const usageRate = payAmount > 0 && supplyPaid > 0
          ? (supplyPaid / payAmount) * 100
          : null;
        const usageRateWithTax = payWithTax > 0 && supplyPaid > 0
          ? (supplyPaid / payWithTax) * 100
          : null;
        const overrun = supplyPaid > payAmount ? supplyPaid - payAmount : 0;
        return {
          ...bucket,
          generalDeduct,
          payAmount,
          payWithTax,
          withholdingTaxTotal,
          supplyPaid,
          vat,
          taxFee,
          usageRate,
          usageRateWithTax,
          overrun
        };
      })
      .sort((a, b) => String(a.region).localeCompare(String(b.region), 'ko-KR'));

    return { settlements, regions };
  }

  function updateWeekUi() {
    const hidden = $('revenueRegionWeekDate');
    if (hidden) hidden.value = state.weekStart || '';
    const preview = $('revenueRegionWeekRangePreview');
    if (preview) preview.textContent = formatWeekRange(state.weekStart);
    const label = $('revenueRegionWeekLabel');
    if (label && state.weekStart) {
      label.textContent = formatDate(state.weekStart);
    }
  }

  function render() {
    const body = $('revenueRegionBody');
    const foot = $('revenueRegionFoot');
    if (!body) return;

    const weekStart = state.weekStart || weekStartKey();
    state.weekStart = weekStartKey(weekStart);
    updateWeekUi();

    const saveBtn = $('revenueRegionSaveBtn');
    const reloadBtn = $('revenueRegionReloadBtn');
    if (saveBtn) saveBtn.disabled = state.loading;
    if (reloadBtn) reloadBtn.disabled = state.loading;

    const { settlements, regions } = aggregateRegions(state.weekStart);
    state.rows = regions;

    const weekHint = $('revenueRegionWeekHint');
    if (weekHint) {
      weekHint.textContent = settlements.length
        ? `${formatWeekRange(state.weekStart)} · 직계약 정산서 ${settlements.length}건`
        : `${formatWeekRange(state.weekStart)} · 저장된 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」에서 먼저 저장하세요.`;
    }

    if (!regions.length) {
      body.innerHTML = '<tr><td colspan="10" class="empty">표시할 지역이 없습니다.</td></tr>';
      if (foot) foot.innerHTML = '';
      updateSummaryTotals([]);
      return;
    }

    body.innerHTML = regions.map(row => `
      <tr data-region-row="${escapeHtml(row.region)}">
        <td class="revenue-region-col-region"><strong>${escapeHtml(row.region)}</strong><br><span class="muted-inline">${Number(row.riderCount || 0).toLocaleString('ko-KR')}명</span></td>
        <td class="revenue-region-input-cell">
          <input type="number" class="admin-period-input revenue-region-money-input" data-region-supply="${escapeHtml(row.region)}" min="0" step="1" value="${row.supplyPaid || ''}" placeholder="0">
        </td>
        <td class="revenue-region-input-cell">
          <input type="number" class="admin-period-input revenue-region-money-input" data-region-vat="${escapeHtml(row.region)}" min="0" step="1" value="${row.vat || ''}" placeholder="0">
        </td>
        <td class="weekly-amount-cell">${formatMoney(row.taxFee)}</td>
        <td class="weekly-amount-cell">${formatMoney(row.grossPay)}</td>
        <td class="weekly-amount-cell">${formatMoney(row.payAmount)}</td>
        <td class="weekly-amount-cell">${formatMoney(row.withholdingTaxTotal)}</td>
        <td class="weekly-amount-cell${row.usageRate != null && row.usageRate > 100 ? ' revenue-region-overrun' : ''}">${formatPercent(row.usageRate)}</td>
        <td class="weekly-amount-cell${row.usageRateWithTax != null && row.usageRateWithTax > 100 ? ' revenue-region-overrun' : ''}">${formatPercent(row.usageRateWithTax)}</td>
        <td class="weekly-amount-cell${row.overrun > 0 ? ' revenue-region-overrun' : ''}">${row.overrun > 0 ? formatMoney(row.overrun) : '-'}</td>
      </tr>
    `).join('');

    const totals = regions.reduce((acc, row) => {
      acc.grossPay += row.grossPay;
      acc.payAmount += row.payAmount;
      acc.supplyPaid += row.supplyPaid;
      acc.withholdingTaxTotal += row.withholdingTaxTotal;
      acc.vat += row.vat;
      acc.taxFee += row.taxFee;
      acc.overrun += row.overrun;
      return acc;
    }, {
      grossPay: 0,
      payAmount: 0,
      supplyPaid: 0,
      withholdingTaxTotal: 0,
      vat: 0,
      taxFee: 0,
      overrun: 0
    });
    totals.payWithTax = totals.payAmount + totals.withholdingTaxTotal;
    totals.usageRate = totals.payAmount > 0 && totals.supplyPaid > 0
      ? (totals.supplyPaid / totals.payAmount) * 100
      : null;
    totals.usageRateWithTax = totals.payWithTax > 0 && totals.supplyPaid > 0
      ? (totals.supplyPaid / totals.payWithTax) * 100
      : null;

    if (foot) {
      foot.innerHTML = `
        <tr class="revenue-region-total-row">
          <td class="revenue-region-col-region"><strong>합계</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.supplyPaid)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.vat)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.taxFee)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.grossPay)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.payAmount)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.withholdingTaxTotal)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatPercent(totals.usageRate)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatPercent(totals.usageRateWithTax)}</strong></td>
          <td class="weekly-amount-cell"><strong>${totals.overrun > 0 ? formatMoney(totals.overrun) : '-'}</strong></td>
        </tr>`;
    }

    updateSummaryTotals(regions, totals);
  }

  function updateSummaryTotals(regions, totals = null) {
    const t = totals || regions.reduce((acc, row) => {
      acc.grossPay += row.grossPay;
      acc.payAmount += row.payAmount;
      acc.supplyPaid += row.supplyPaid;
      acc.withholdingTaxTotal += row.withholdingTaxTotal;
      acc.vat += row.vat;
      acc.taxFee += row.taxFee;
      return acc;
    }, { grossPay: 0, payAmount: 0, supplyPaid: 0, withholdingTaxTotal: 0, vat: 0, taxFee: 0 });

    const countEl = $('revenueRegionCount');
    if (countEl) countEl.textContent = String(regions.length);
    const grossEl = $('revenueRegionGrossTotal');
    if (grossEl) grossEl.textContent = formatMoney(t.grossPay);
    const payEl = $('revenueRegionPayTotal');
    if (payEl) payEl.textContent = formatMoney(t.payAmount);
    const taxEl = $('revenueRegionTaxTotal');
    if (taxEl) taxEl.textContent = formatMoney(t.withholdingTaxTotal);
    const supplyEl = $('revenueRegionSupplyTotal');
    if (supplyEl) supplyEl.textContent = formatMoney(t.supplyPaid);
    const vatEl = $('revenueRegionVatTotal');
    if (vatEl) vatEl.textContent = formatMoney(t.vat);
    const taxFeeEl = $('revenueRegionTaxFeeTotal');
    if (taxFeeEl) taxFeeEl.textContent = formatMoney(t.taxFee);
  }

  async function loadSettlementData() {
    state.loading = true;
    setLoadStatus('직계약 정산서를 불러오는 중…');
    render();

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
    });

    try {
      await Promise.race([
        window.BremStorage?.ensureSectionLoaded?.('revenue-region-settlement'),
        timeout
      ]);
      const count = settlementsForWeek(state.weekStart || weekStartKey()).length;
      setLoadStatus(count
        ? `정산서 ${count}건 불러옴 · ${formatWeekRange(state.weekStart)}`
        : `정산서 없음 · ${formatWeekRange(state.weekStart)}`);
    } catch (error) {
      console.warn('[revenue region settlement] load failed:', error);
      setLoadStatus('정산 데이터를 불러오지 못했습니다. 「불러오기」를 다시 눌러주세요.');
      showToast('정산 데이터 로드에 실패했습니다. 잠시 후 다시 시도하세요.');
    } finally {
      state.loading = false;
      render();
    }
  }

  function saveDraft() {
    const weekStart = weekStartKey(state.weekStart || weekStartKey());
    if (!Revenue()?.saveRegionSettlement) {
      showToast('저장 기능을 사용할 수 없습니다. 페이지를 새로고침하세요.');
      return;
    }
    const regions = collectDraftFromInputs();
    const taxFeePercent = Math.max(0, Math.min(100, Number($('revenueRegionTaxFeePercent')?.value || state.taxFeePercent || 20)));
    state.taxFeePercent = taxFeePercent;
    const saved = Revenue().saveRegionSettlement(weekStart, { regions, taxFeePercent });
    state.savedAt = saved?.savedAt || new Date().toISOString();
    state.draftRegions = { ...regions };
    setSavedStatus(`저장 완료 · ${new Date(state.savedAt).toLocaleString('ko-KR')}`);
    showToast('공급대가·부가세 입력을 저장했습니다.');
    render();
  }

  function exportExcel() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    collectDraftFromInputs();
    const weekStart = state.weekStart || weekStartKey();
    const { regions } = aggregateRegions(weekStart);
    if (!regions.length) {
      showToast('다운로드할 지역별 정산 데이터가 없습니다.');
      return;
    }

    const rows = [
      ['지역별 정산', formatWeekRange(weekStart)],
      ['세무처리비율(%)', state.taxFeePercent],
      [],
      [
        '지역', '기사수', '공급대가(실지급액)', '부가세', '세무처리비',
        '지급합계', '입급가액', '원천세합', '사용률(%)', '원천세포함 사용률(%)', '초과지급'
      ]
    ];
    regions.forEach(row => {
      rows.push([
        row.region,
        row.riderCount,
        row.supplyPaid,
        row.vat,
        row.taxFee,
        row.grossPay,
        row.payAmount,
        row.withholdingTaxTotal,
        row.usageRate != null ? Number(row.usageRate.toFixed(2)) : '',
        row.usageRateWithTax != null ? Number(row.usageRateWithTax.toFixed(2)) : '',
        row.overrun
      ]);
    });

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '지역별정산');
    window.XLSX.writeFile(wb, `지역별정산_${weekStartKey(weekStart)}.xlsx`);
    showToast('지역별 정산 엑셀을 저장했습니다.');
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('revenueRegionTaxFeePercent')?.addEventListener('input', event => {
      const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
      state.taxFeePercent = value;
      render();
    });

    $('revenueRegionSaveBtn')?.addEventListener('click', saveDraft);
    $('revenueRegionReloadBtn')?.addEventListener('click', () => { void loadSettlementData(); });
    $('revenueRegionExportBtn')?.addEventListener('click', exportExcel);

    $('revenueRegionBody')?.addEventListener('change', event => {
      if (!event.target.matches('[data-region-supply], [data-region-vat]')) return;
      collectDraftFromInputs();
      render();
    });
  }

  async function refresh() {
    if (!$('revenueRegionBody')) return;
    bindEvents();

    if (!state.weekStart) state.weekStart = weekStartKey();
    loadSavedDraft(state.weekStart);
    await loadSettlementData();
  }

  function setWeekStart(value) {
    collectDraftFromInputs();
    state.weekStart = weekStartKey(value || today());
    loadSavedDraft(state.weekStart);
    void loadSettlementData();
  }

  bindEvents();
  window.BremRevenueRegionSettlement = { refresh, setWeekStart, render, loadSettlementData };
})();

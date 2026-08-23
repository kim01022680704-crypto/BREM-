// 수익 관리 · 지역별 정산 — 월별 직계약 정산서를 지역 단위로 합산하고
// 공급대가·부가세 입력과 부가세 세무처리비(조절 가능 %)를 비교한다.
(function () {
  const STORE_KEY = 'brem_revenue_region_settlement_v1';

  const state = {
    monthKey: '',
    taxFeePercent: 20,
    rows: []
  };

  function $(id) {
    return document.getElementById(id);
  }

  function Calc() {
    return window.BremDirectSettlementCalc;
  }

  function todayMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function formatMonthLabel(monthKey) {
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return '월을 선택하세요';
    const [year, month] = monthKey.split('-');
    return `${year}년 ${month}월`;
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

  function weekEndKey(weekStart) {
    const calc = Calc();
    if (calc?.weekEndKey) return calc.weekEndKey(weekStart);
    const end = new Date(`${weekStart}T00:00:00`);
    end.setDate(end.getDate() + 6);
    return [
      end.getFullYear(),
      String(end.getMonth() + 1).padStart(2, '0'),
      String(end.getDate()).padStart(2, '0')
    ].join('-');
  }

  function weekInMonth(weekStart, monthKey) {
    return weekEndKey(String(weekStart || '').slice(0, 10)).slice(0, 7) === monthKey;
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { taxFeePercent: 20, months: {} };
      const parsed = JSON.parse(raw);
      return {
        taxFeePercent: Number(parsed?.taxFeePercent) || 20,
        months: parsed?.months && typeof parsed.months === 'object' ? parsed.months : {}
      };
    } catch (_) {
      return { taxFeePercent: 20, months: {} };
    }
  }

  function writeStore(store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }

  function monthDraft(monthKey) {
    const store = readStore();
    if (!store.months[monthKey]) store.months[monthKey] = { regions: {} };
    return store.months[monthKey];
  }

  function saveRegionInput(monthKey, region, patch) {
    const store = readStore();
    if (!store.months[monthKey]) store.months[monthKey] = { regions: {} };
    const regions = store.months[monthKey].regions;
    regions[region] = { ...(regions[region] || {}), ...patch };
    writeStore(store);
  }

  function saveTaxFeePercent(value) {
    const store = readStore();
    store.taxFeePercent = value;
    writeStore(store);
  }

  function settlementsForMonth(monthKey) {
    const calc = Calc();
    if (!calc) return [];
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => weekInMonth(calc.settlementWeek(record), monthKey));
  }

  function aggregateRegions(monthKey) {
    const calc = Calc();
    if (!calc) return { weeks: [], regions: [] };

    const settlements = settlementsForMonth(monthKey);
    const weekSet = new Set(settlements.map(record => calc.settlementWeek(record)));
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

    const draft = monthDraft(monthKey);
    const regions = [...byRegion.values()]
      .map(bucket => {
        const generalDeduct = calc.generalDeductTotal(bucket);
        const payAmount = Math.round(Number(bucket.grossPay || 0)) - generalDeduct;
        const withholdingTaxTotal = calc.withholdingTaxTotal(bucket);
        const saved = draft.regions[bucket.region] || {};
        const supplyPaid = Math.round(Number(saved.supplyPaid || 0));
        const vat = Math.round(Number(saved.vat || 0));
        const taxFee = Math.round(vat * (state.taxFeePercent / 100));
        const usageRate = payAmount > 0 && supplyPaid > 0
          ? (supplyPaid / payAmount) * 100
          : null;
        const overrun = supplyPaid > payAmount ? supplyPaid - payAmount : 0;
        return {
          ...bucket,
          generalDeduct,
          payAmount,
          withholdingTaxTotal,
          supplyPaid,
          vat,
          taxFee,
          usageRate,
          overrun
        };
      })
      .sort((a, b) => String(a.region).localeCompare(String(b.region), 'ko-KR'));

    return {
      weeks: [...weekSet].sort(),
      regions
    };
  }

  function render() {
    const body = $('revenueRegionBody');
    const foot = $('revenueRegionFoot');
    if (!body) return;

    const monthKey = state.monthKey || todayMonthKey();
    const { weeks, regions } = aggregateRegions(monthKey);
    state.rows = regions;

    const monthLabel = $('revenueRegionMonthLabel');
    if (monthLabel) monthLabel.textContent = formatMonthLabel(monthKey);

    const weekHint = $('revenueRegionWeekHint');
    if (weekHint) {
      weekHint.textContent = weeks.length
        ? `포함 정산주 ${weeks.length}개 · ${weeks.join(', ')} (화요일 종료 기준)`
        : '이 달에 해당하는 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」에서 먼저 저장하세요.';
    }

    if (!regions.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">표시할 지역이 없습니다.</td></tr>';
      if (foot) foot.innerHTML = '';
      updateSummaryTotals([]);
      return;
    }

    body.innerHTML = regions.map(row => `
      <tr data-region-row="${escapeHtml(row.region)}">
        <td><strong>${escapeHtml(row.region)}</strong><br><span class="muted-inline">${Number(row.riderCount || 0).toLocaleString('ko-KR')}명</span></td>
        <td class="revenue-region-input-cell">
          <input type="number" class="admin-period-input revenue-region-money-input" data-region-supply="${escapeHtml(row.region)}" min="0" step="1" value="${row.supplyPaid || ''}" placeholder="0">
        </td>
        <td class="weekly-amount-cell">${formatMoney(row.payAmount)}</td>
        <td class="weekly-amount-cell">${formatMoney(row.withholdingTaxTotal)}</td>
        <td class="revenue-region-input-cell">
          <input type="number" class="admin-period-input revenue-region-money-input" data-region-vat="${escapeHtml(row.region)}" min="0" step="1" value="${row.vat || ''}" placeholder="0">
        </td>
        <td class="weekly-amount-cell">${formatMoney(row.taxFee)}</td>
        <td class="weekly-amount-cell">${formatPercent(row.usageRate)}</td>
        <td class="weekly-amount-cell${row.overrun > 0 ? ' revenue-region-overrun' : ''}">${row.overrun > 0 ? formatMoney(row.overrun) : '-'}</td>
      </tr>
    `).join('');

    const totals = regions.reduce((acc, row) => {
      acc.payAmount += row.payAmount;
      acc.supplyPaid += row.supplyPaid;
      acc.withholdingTaxTotal += row.withholdingTaxTotal;
      acc.vat += row.vat;
      acc.taxFee += row.taxFee;
      acc.overrun += row.overrun;
      return acc;
    }, {
      payAmount: 0,
      supplyPaid: 0,
      withholdingTaxTotal: 0,
      vat: 0,
      taxFee: 0,
      overrun: 0
    });
    totals.usageRate = totals.payAmount > 0 && totals.supplyPaid > 0
      ? (totals.supplyPaid / totals.payAmount) * 100
      : null;

    if (foot) {
      foot.innerHTML = `
        <tr class="revenue-region-total-row">
          <td><strong>합계</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.supplyPaid)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.payAmount)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.withholdingTaxTotal)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.vat)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.taxFee)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatPercent(totals.usageRate)}</strong></td>
          <td class="weekly-amount-cell"><strong>${totals.overrun > 0 ? formatMoney(totals.overrun) : '-'}</strong></td>
        </tr>`;
    }

    updateSummaryTotals(regions, totals);
  }

  function updateSummaryTotals(regions, totals = null) {
    const t = totals || regions.reduce((acc, row) => {
      acc.payAmount += row.payAmount;
      acc.supplyPaid += row.supplyPaid;
      acc.vat += row.vat;
      acc.taxFee += row.taxFee;
      return acc;
    }, { payAmount: 0, supplyPaid: 0, vat: 0, taxFee: 0 });

    const countEl = $('revenueRegionCount');
    if (countEl) countEl.textContent = String(regions.length);
    const payEl = $('revenueRegionPayTotal');
    if (payEl) payEl.textContent = formatMoney(t.payAmount);
    const supplyEl = $('revenueRegionSupplyTotal');
    if (supplyEl) supplyEl.textContent = formatMoney(t.supplyPaid);
    const vatEl = $('revenueRegionVatTotal');
    if (vatEl) vatEl.textContent = formatMoney(t.vat);
    const taxFeeEl = $('revenueRegionTaxFeeTotal');
    if (taxFeeEl) taxFeeEl.textContent = formatMoney(t.taxFee);
  }

  function exportExcel() {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const monthKey = state.monthKey || todayMonthKey();
    const { regions } = aggregateRegions(monthKey);
    if (!regions.length) {
      showToast('다운로드할 지역별 정산 데이터가 없습니다.');
      return;
    }

    const rows = [
      ['지역별 정산', formatMonthLabel(monthKey)],
      ['세무처리비율(%)', state.taxFeePercent],
      [],
      ['지역', '기사수', '공급대가(실지급액)', '입급가액', '원천세합', '부가세', '세무처리비', '사용률(%)', '초과지급']
    ];
    regions.forEach(row => {
      rows.push([
        row.region,
        row.riderCount,
        row.supplyPaid,
        row.payAmount,
        row.withholdingTaxTotal,
        row.vat,
        row.taxFee,
        row.usageRate != null ? Number(row.usageRate.toFixed(2)) : '',
        row.overrun
      ]);
    });

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '지역별정산');
    window.XLSX.writeFile(wb, `지역별정산_${monthKey}.xlsx`);
    showToast('지역별 정산 엑셀을 저장했습니다.');
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('revenueRegionMonthInput')?.addEventListener('change', event => {
      state.monthKey = event.target.value || todayMonthKey();
      render();
    });

    $('revenueRegionTaxFeePercent')?.addEventListener('change', event => {
      const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
      state.taxFeePercent = value;
      event.target.value = String(value);
      saveTaxFeePercent(value);
      render();
    });

    $('revenueRegionTaxFeePercent')?.addEventListener('input', event => {
      const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
      state.taxFeePercent = value;
      render();
    });

    $('revenueRegionExportBtn')?.addEventListener('click', exportExcel);

    $('revenueRegionBody')?.addEventListener('change', event => {
      const supplyInput = event.target.closest('[data-region-supply]');
      const vatInput = event.target.closest('[data-region-vat]');
      const monthKey = state.monthKey || todayMonthKey();
      if (supplyInput) {
        saveRegionInput(monthKey, supplyInput.dataset.regionSupply, {
          supplyPaid: Math.round(Number(supplyInput.value || 0))
        });
        render();
        return;
      }
      if (vatInput) {
        saveRegionInput(monthKey, vatInput.dataset.regionVat, {
          vat: Math.round(Number(vatInput.value || 0))
        });
        render();
      }
    });
  }

  async function refresh() {
    if (!$('revenueRegionBody')) return;
    bindEvents();

    const store = readStore();
    state.taxFeePercent = Number(store.taxFeePercent) || 20;

    if (!state.monthKey) state.monthKey = todayMonthKey();
    const monthInput = $('revenueRegionMonthInput');
    if (monthInput) monthInput.value = state.monthKey;

    const taxInput = $('revenueRegionTaxFeePercent');
    if (taxInput) taxInput.value = String(state.taxFeePercent);

    await window.BremStorage?.ensureSectionLoaded?.('settlement-result-direct');
    render();
  }

  function setMonthKey(value) {
    state.monthKey = String(value || '').slice(0, 7) || todayMonthKey();
    const monthInput = $('revenueRegionMonthInput');
    if (monthInput) monthInput.value = state.monthKey;
    void refresh();
  }

  bindEvents();
  window.BremRevenueRegionSettlement = { refresh, setMonthKey, render };
})();

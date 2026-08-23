// 수익 관리 · 지역별 정산 — 정산주(수~화) 단위로 직계약 정산서를 지역별 합산하고
// 공급대가·부가세 입력과 부가세 세무처리비(조절 가능 %)를 비교한다.
(function () {
  const LOAD_TIMEOUT_MS = 20000;

  const state = {
    weekStart: '',
    taxFeePercent: 20,
    rows: [],
    draftRegions: {},
    uploadRows: [],
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

  // 재원에서 지출을 뺀 값. 양수면 남은 돈, 음수면 재원을 넘겨 쓴 돈.
  function formatRemain(value) {
    const num = Math.round(Number(value || 0));
    if (!num) return '-';
    return num > 0 ? `${formatMoney(num)} 남음` : `${formatMoney(Math.abs(num))} 초과`;
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
        // 공급대가(받은 재원) 대비 입급가액(실제 지급한 돈)이 사용률.
        // 원천세도 수익이라 포함하면 재원이 늘어 사용률은 내려간다.
        // 사용률 기준(100%) = 공급대가 − 부가세. 부가세는 수익이라 재원에서 뺀다.
        // 원천세도 수익이라 포함하면 재원이 늘어 사용률은 내려간다.
        const supplyBase = supplyPaid - vat;
        const supplyBaseWithTax = supplyBase + withholdingTaxTotal;
        const usageRate = supplyBase > 0 ? (payAmount / supplyBase) * 100 : null;
        const usageRateWithTax = supplyBase > 0 && supplyBaseWithTax > 0
          ? (payAmount / supplyBaseWithTax) * 100
          : null;
        // 실제 남는 현금 = 받은 공급대가(부가세 포함) + 원천세 − 지급한 임금 − 세무처리비
        const remain = supplyPaid > 0
          ? supplyPaid + withholdingTaxTotal - payAmount - taxFee
          : 0;
        return {
          ...bucket,
          generalDeduct,
          payAmount,
          supplyBase,
          supplyBaseWithTax,
          withholdingTaxTotal,
          supplyPaid,
          vat,
          taxFee,
          usageRate,
          usageRateWithTax,
          remain
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
      renderPreview();
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
        <td class="weekly-amount-cell${row.remain < 0 ? ' revenue-region-overrun' : ''}">${formatRemain(row.remain)}</td>
      </tr>
    `).join('');

    const totals = regions.reduce((acc, row) => {
      acc.grossPay += row.grossPay;
      acc.payAmount += row.payAmount;
      acc.supplyPaid += row.supplyPaid;
      acc.withholdingTaxTotal += row.withholdingTaxTotal;
      acc.vat += row.vat;
      acc.taxFee += row.taxFee;
      acc.remain += row.remain;
      return acc;
    }, {
      grossPay: 0,
      payAmount: 0,
      supplyPaid: 0,
      withholdingTaxTotal: 0,
      vat: 0,
      taxFee: 0,
      remain: 0
    });
    totals.supplyBase = totals.supplyPaid - totals.vat;
    totals.supplyBaseWithTax = totals.supplyBase + totals.withholdingTaxTotal;
    totals.usageRate = totals.supplyBase > 0
      ? (totals.payAmount / totals.supplyBase) * 100
      : null;
    totals.usageRateWithTax = totals.supplyBaseWithTax > 0 && totals.supplyBase > 0
      ? (totals.payAmount / totals.supplyBaseWithTax) * 100
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
          <td class="weekly-amount-cell${totals.remain < 0 ? ' revenue-region-overrun' : ''}"><strong>${formatRemain(totals.remain)}</strong></td>
        </tr>`;
    }

    updateSummaryTotals(regions, totals);
    renderPreview();
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

  function saveDraft(options = {}) {
    const silent = options.silent === true;
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
    if (!silent) showToast('공급대가·부가세 입력을 저장했습니다.');
    render();
  }

  // --- 정산서 업로드 --------------------------------------------------------

  function Parser() {
    return typeof BremSettlementParser !== 'undefined' ? BremSettlementParser : null;
  }

  function cellString(row, index) {
    const value = Array.isArray(row) ? row[index] : '';
    const parser = Parser();
    const text = parser?.cellText ? parser.cellText(value) : value;
    return String(text ?? '').trim();
  }

  function cellNumber(row, index) {
    const text = cellString(row, index).replace(/[^\d.\-]/g, '');
    const num = Number(text);
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function rowText(row) {
    return (Array.isArray(row) ? row : []).map(cell => String(cell ?? '')).join(' ');
  }

  // 시도 접두사(울산_ 경남_)와 (Z) 같은 꼬리표를 떼고 비교용 키를 만든다.
  function normalizeRegionKey(value) {
    return String(value || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/^[가-힣]{2}[_\-\s]/, '')
      .replace(/[\s_\-·.]/g, '')
      .toLowerCase()
      .trim();
  }

  function availableRegionNames() {
    return state.rows.map(row => row.region).filter(Boolean);
  }

  function matchRegionByLabel(label, regionNames, aliasMap) {
    const raw = String(label || '').trim();
    if (!raw) return '';
    if (aliasMap[raw]) return aliasMap[raw];
    const key = normalizeRegionKey(raw);
    if (!key) return '';
    const exact = regionNames.find(name => normalizeRegionKey(name) === key);
    if (exact) return exact;
    const partial = regionNames.filter(name => {
      const nk = normalizeRegionKey(name);
      return nk && (nk.includes(key) || key.includes(nk));
    });
    return partial.length === 1 ? partial[0] : '';
  }

  function matchRegionByFileName(fileName, regionNames, aliasMap) {
    const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
    if (aliasMap[base]) return aliasMap[base];
    const key = normalizeRegionKey(base);
    if (!key) return '';
    // 더 구체적인(긴) 지역명이 우선 매칭되게 정렬한다.
    const sorted = [...regionNames].sort(
      (a, b) => normalizeRegionKey(b).length - normalizeRegionKey(a).length
    );
    const hit = sorted.find(name => {
      const nk = normalizeRegionKey(name);
      return nk && key.includes(nk);
    });
    return hit || matchRegionByLabel(base, regionNames, aliasMap);
  }

  async function readSheetRows(file, password, { sheetIndexes = [0, 1, 2], validateRows } = {}) {
    const parser = Parser();
    if (!parser?.openWorkbookSheetRows) {
      throw new Error('엑셀 읽기 모듈을 불러오지 못했습니다. 페이지를 새로고침하세요.');
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pwd = parser.normalizePassword(password);
    let lastError = null;
    for (const sheetIndex of sheetIndexes) {
      try {
        const rows = await parser.openWorkbookSheetRows(buffer, pwd, { sheetIndex, validateRows });
        if (rows?.length) return rows;
      } catch (error) {
        lastError = error;
        if (error?.code === 'PASSWORD_REQUIRED' || error?.code === 'WRONG_PASSWORD') throw error;
      }
    }
    throw lastError || new Error('엑셀에서 정산 내역을 찾지 못했습니다.');
  }

  function findRowIndex(rows, pattern, from = 0) {
    for (let i = from; i < rows.length; i += 1) {
      if (pattern.test(rowText(rows[i]))) return i;
    }
    return -1;
  }

  // 쿠팡: 한 파일에 전 지역. C열 지역구 · G열 부가세 · J열 실지급액.
  function parseCoupangRows(rows) {
    let headerIndex = -1;
    let regionCol = 2;
    let vatCol = 6;
    let netCol = 9;

    for (let i = 0; i < rows.length; i += 1) {
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      const idx = row.findIndex(cell => /지역\s*구/.test(String(cell ?? '')));
      if (idx < 0) continue;
      headerIndex = i;
      regionCol = idx;
      const vatIdx = row.findIndex(cell => /부가세/.test(String(cell ?? '')));
      const netIdx = row.findIndex(cell => /실\s*지급/.test(String(cell ?? '')));
      if (vatIdx >= 0) vatCol = vatIdx;
      if (netIdx >= 0) netCol = netIdx;
      break;
    }

    const items = [];
    let blankRun = 0;
    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      const label = cellString(row, regionCol);
      if (!label) {
        blankRun += 1;
        if (blankRun >= 5 && items.length) break;
        continue;
      }
      blankRun = 0;
      if (/지역\s*구|합계|소계|^총/.test(label)) continue;
      const vat = cellNumber(row, vatCol);
      const supplyPaid = cellNumber(row, netCol);
      if (!vat && !supplyPaid) continue;
      items.push({
        source: label,
        vat,
        supplyPaid,
        note: `부가세 ${formatMoney(vat)} · 실지급액 ${formatMoney(supplyPaid)}`
      });
    }
    return items;
  }

  function coupangRowsLookValid(rows) {
    return Array.isArray(rows) && rows.length > 0 && findRowIndex(rows, /지역\s*구/) >= 0;
  }

  // 배민: 파일 1개 = 지역 1개. C31 부가세액 · D31 공급대가 − (I열 고용보험 + J열 산재보험).
  function parseBaeminSheet(rows) {
    let vat = 0;
    let supplyTotal = 0;

    const taxHeader = findRowIndex(rows, /공급\s*대가/);
    if (taxHeader >= 0) {
      const header = rows[taxHeader] || [];
      const vatCol = header.findIndex(cell => /부가세\s*액/.test(String(cell ?? '')));
      const supplyCol = header.findIndex(cell => /공급\s*대가/.test(String(cell ?? '')));
      for (let i = taxHeader + 1; i < Math.min(rows.length, taxHeader + 4); i += 1) {
        const row = rows[i] || [];
        const v = vatCol >= 0 ? cellNumber(row, vatCol) : 0;
        const s = supplyCol >= 0 ? cellNumber(row, supplyCol) : 0;
        if (v || s) {
          vat = v;
          supplyTotal = s;
          break;
        }
      }
    }
    if (!supplyTotal) {
      // 라벨 탐색 실패 시 고정 위치(C31·D31)로 되돌린다.
      vat = cellNumber(rows[30] || [], 2);
      supplyTotal = cellNumber(rows[30] || [], 3);
    }

    let employment = 0;
    let accident = 0;
    let employmentLabel = 'I열';
    let accidentLabel = 'J열';
    const weekHeader = findRowIndex(rows, /정산\s*시작일|배달료/);
    if (weekHeader >= 0) {
      const header = rows[weekHeader] || [];
      employmentLabel = cellString(header, 8) || employmentLabel;
      accidentLabel = cellString(header, 9) || accidentLabel;
      for (let i = weekHeader + 1; i < Math.min(rows.length, weekHeader + 5); i += 1) {
        const row = rows[i] || [];
        if (!rowText(row).trim()) continue;
        employment = cellNumber(row, 8);
        accident = cellNumber(row, 9);
        break;
      }
    }

    const supplyPaid = supplyTotal - (employment + accident);
    return {
      vat,
      supplyTotal,
      supplyPaid,
      employment,
      accident,
      note: `공급대가 ${formatMoney(supplyTotal)} − ${employmentLabel} ${formatMoney(employment)} − ${accidentLabel} ${formatMoney(accident)}`
    };
  }

  function baeminRowsLookValid(rows) {
    return Array.isArray(rows) && rows.length > 0 && findRowIndex(rows, /공급\s*대가/) >= 0;
  }

  function uploadPassword() {
    return String($('revenueRegionExcelPassword')?.value || '');
  }

  function setUploadStatus(message) {
    const el = $('revenueRegionUploadStatus');
    if (el) el.textContent = message || '';
  }

  function uploadErrorMessage(error) {
    if (error?.code === 'PASSWORD_REQUIRED') return '비밀번호가 필요한 파일입니다. 엑셀 비밀번호를 입력한 뒤 다시 올려주세요.';
    if (error?.code === 'WRONG_PASSWORD') return '비밀번호가 맞지 않습니다. 다시 확인해 주세요.';
    return error?.message || '엑셀을 읽지 못했습니다.';
  }

  async function handleCoupangUpload(file) {
    if (!file) return;
    if (!availableRegionNames().length) {
      showToast('먼저 정산주를 선택해 지역 목록을 불러오세요.');
      return;
    }
    setUploadStatus(`쿠팡 정산서 읽는 중… (${file.name})`);
    try {
      const rows = await readSheetRows(file, uploadPassword(), {
        sheetIndexes: [0, 1, 2],
        validateRows: coupangRowsLookValid
      });
      const parsed = parseCoupangRows(rows);
      if (!parsed.length) {
        setUploadStatus('쿠팡 정산서에서 지역구 표를 찾지 못했습니다. C열 지역구 · G열 부가세 · J열 실지급액 형식인지 확인하세요.');
        return;
      }
      const regionNames = availableRegionNames();
      const aliasMap = Revenue()?.getRegionAliasMap?.() || {};
      const rowsForPreview = parsed.map(item => ({
        kind: 'coupang',
        fileName: file.name,
        source: item.source,
        region: matchRegionByLabel(item.source, regionNames, aliasMap),
        supplyPaid: item.supplyPaid,
        vat: item.vat,
        note: item.note
      }));
      mergePreviewRows(rowsForPreview);
      const matched = rowsForPreview.filter(row => row.region).length;
      setUploadStatus(`쿠팡 ${parsed.length}개 지역 읽음 · 자동 매칭 ${matched}개. 매칭 안 된 줄은 「반영할 지역」에서 골라주세요.`);
    } catch (error) {
      console.warn('[revenue region settlement] coupang upload failed:', error);
      setUploadStatus(uploadErrorMessage(error));
      showToast(uploadErrorMessage(error));
    }
  }

  async function handleBaeminUpload(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!availableRegionNames().length) {
      showToast('먼저 정산주를 선택해 지역 목록을 불러오세요.');
      return;
    }
    setUploadStatus(`배민 정산서 ${files.length}개 읽는 중…`);
    const regionNames = availableRegionNames();
    const aliasMap = Revenue()?.getRegionAliasMap?.() || {};
    const collected = [];
    const failed = [];

    for (const file of files) {
      try {
        const rows = await readSheetRows(file, uploadPassword(), {
          sheetIndexes: [0, 1, 2],
          validateRows: baeminRowsLookValid
        });
        const parsed = parseBaeminSheet(rows);
        if (!parsed.supplyTotal && !parsed.vat) {
          failed.push(`${file.name} (공급대가·부가세액 없음)`);
          continue;
        }
        collected.push({
          kind: 'baemin',
          fileName: file.name,
          source: file.name.replace(/\.[^.]+$/, ''),
          region: matchRegionByFileName(file.name, regionNames, aliasMap),
          supplyPaid: parsed.supplyPaid,
          vat: parsed.vat,
          note: parsed.note
        });
      } catch (error) {
        console.warn('[revenue region settlement] baemin upload failed:', file.name, error);
        failed.push(`${file.name} (${uploadErrorMessage(error)})`);
      }
    }

    if (collected.length) mergePreviewRows(collected);
    const matched = collected.filter(row => row.region).length;
    const parts = [`배민 ${collected.length}개 파일 읽음 · 자동 매칭 ${matched}개`];
    if (failed.length) parts.push(`실패 ${failed.length}건: ${failed.join(' / ')}`);
    setUploadStatus(parts.join(' · '));
  }

  function mergePreviewRows(rows) {
    const next = [...state.uploadRows];
    rows.forEach(row => {
      const at = next.findIndex(item => item.kind === row.kind && item.source === row.source);
      if (at >= 0) next[at] = row;
      else next.push(row);
    });
    state.uploadRows = next;
    renderPreview();
  }

  function clearPreview() {
    state.uploadRows = [];
    renderPreview();
    setUploadStatus('미리보기를 지웠습니다.');
  }

  function renderPreview() {
    const wrap = $('revenueRegionPreviewWrap');
    const body = $('revenueRegionPreviewBody');
    const actions = $('revenueRegionPreviewActions');
    if (!wrap || !body || !actions) return;

    if (!state.uploadRows.length) {
      wrap.hidden = true;
      actions.hidden = true;
      body.innerHTML = '';
      return;
    }

    const regionNames = availableRegionNames();
    wrap.hidden = false;
    actions.hidden = false;
    body.innerHTML = state.uploadRows.map((row, index) => {
      const options = ['<option value="">(반영 안 함)</option>']
        .concat(regionNames.map(name => (
          `<option value="${escapeHtml(name)}"${name === row.region ? ' selected' : ''}>${escapeHtml(name)}</option>`
        )))
        .join('');
      return `
        <tr class="${row.region ? '' : 'revenue-region-preview-unmatched'}">
          <td>${row.kind === 'coupang' ? '쿠팡' : '배민'}</td>
          <td>${escapeHtml(row.source)}<br><span class="muted-inline">${escapeHtml(row.fileName)}</span></td>
          <td><select class="admin-period-input" data-preview-region="${index}">${options}</select></td>
          <td class="weekly-amount-cell">${formatMoney(row.supplyPaid)}</td>
          <td class="weekly-amount-cell">${formatMoney(row.vat)}</td>
          <td><span class="muted-inline">${escapeHtml(row.note || '')}</span></td>
        </tr>`;
    }).join('');
  }

  function applyPreview() {
    if (!state.uploadRows.length) return;
    collectDraftFromInputs();

    const merged = {};
    const aliases = {};
    const leftover = [];
    state.uploadRows.forEach(row => {
      if (!row.region) {
        leftover.push(row);
        return;
      }
      if (!merged[row.region]) merged[row.region] = { supplyPaid: 0, vat: 0 };
      merged[row.region].supplyPaid += Math.round(Number(row.supplyPaid || 0));
      merged[row.region].vat += Math.round(Number(row.vat || 0));
      aliases[row.source] = row.region;
    });

    const appliedRegions = Object.keys(merged).length;
    if (!appliedRegions) {
      showToast('반영할 지역을 하나 이상 골라주세요.');
      return;
    }

    Object.entries(merged).forEach(([region, values]) => {
      state.draftRegions[region] = { ...(state.draftRegions[region] || {}), ...values };
    });
    Revenue()?.saveRegionAliases?.(aliases);

    // 반영한 줄은 목록에서 지우고, 매칭 못 한 줄만 남겨 이어서 처리하게 한다.
    state.uploadRows = leftover;
    render();
    saveDraft({ silent: true });

    const tail = leftover.length ? ` · 매칭 안 된 ${leftover.length}건은 아래에 남겨뒀습니다.` : '';
    setUploadStatus(`${appliedRegions}개 지역 반영·저장 완료.${tail}`);
    showToast(`${appliedRegions}개 지역 반영·저장 완료${leftover.length ? ` · 미매칭 ${leftover.length}건 남음` : ''}`);
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
        '지급합계', '입급가액', '원천세합',
        '사용률(%)', '원천세포함 사용률(%)', '남은 금액'
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
        row.remain
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

    $('revenueRegionSaveBtn')?.addEventListener('click', () => saveDraft());
    $('revenueRegionReloadBtn')?.addEventListener('click', () => { void loadSettlementData(); });
    $('revenueRegionExportBtn')?.addEventListener('click', exportExcel);

    $('revenueRegionBody')?.addEventListener('change', event => {
      if (!event.target.matches('[data-region-supply], [data-region-vat]')) return;
      collectDraftFromInputs();
      render();
    });

    $('revenueRegionCoupangFile')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      await handleCoupangUpload(file);
    });

    $('revenueRegionBaeminFile')?.addEventListener('change', async event => {
      const files = event.target.files;
      const list = files ? Array.from(files) : [];
      event.target.value = '';
      await handleBaeminUpload(list);
    });

    $('revenueRegionUploadClearBtn')?.addEventListener('click', clearPreview);
    $('revenueRegionApplyUploadBtn')?.addEventListener('click', applyPreview);

    $('revenueRegionPreviewBody')?.addEventListener('change', event => {
      const select = event.target.closest('[data-preview-region]');
      if (!select) return;
      const index = Number(select.dataset.previewRegion);
      if (!state.uploadRows[index]) return;
      state.uploadRows[index].region = String(select.value || '');
      renderPreview();
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
  window.BremRevenueRegionSettlement = {
    refresh,
    setWeekStart,
    render,
    loadSettlementData,
    parseCoupangRows,
    parseBaeminSheet,
    normalizeRegionKey,
    matchRegionByLabel,
    matchRegionByFileName
  };
})();

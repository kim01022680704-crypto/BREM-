// 수익 관리 · 지역별 정산 — 엑셀 A열 권역 · B열 실지급액 · C열 부가세를 붙여넣고
// 남은 금액 = 실지급액 − 부가세×세무처리비율 − 최종입금(지역별) − 선정산(지역별) 로 본다.
(function () {
  const LOAD_TIMEOUT_MS = 20000;

  const state = {
    weekStart: '',
    taxFeePercent: 20,
    rows: [],
    draftRegions: {},
    uploadRows: [],
    baeminRaw: [],
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

  // 실지급액 − 부가세의 N% − 최종입금(지역별) − 선정산(지역별)
  function computeRemain({
    supplyPaid = 0,
    vat = 0,
    taxFeePercent = 20,
    finalDeposit = 0,
    prepaid = 0
  } = {}) {
    const paid = Math.round(Number(supplyPaid) || 0);
    const tax = Math.round(Number(vat) || 0);
    if (!paid && !tax) return 0;
    const taxFee = Math.round(tax * (Number(taxFeePercent) || 0) / 100);
    return paid - taxFee - Math.round(Number(finalDeposit) || 0) - Math.round(Number(prepaid) || 0);
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
    state.draftRegions = migrateDraftRegionKeys(
      saved?.regions && typeof saved.regions === 'object' ? saved.regions : {}
    );
    const taxInput = $('revenueRegionTaxFeePercent');
    if (taxInput) taxInput.value = String(state.taxFeePercent);
    if (state.savedAt) {
      setSavedStatus(`마지막 저장 ${new Date(state.savedAt).toLocaleString('ko-KR')}`);
    } else {
      setSavedStatus('아직 저장되지 않았습니다.');
    }
  }

  function collectDraftFromInputs() {
    const regions = migrateDraftRegionKeys(state.draftRegions);
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
    const exact = state.draftRegions[region];
    if (exact && (Number(exact.supplyPaid) || Number(exact.vat))) {
      return {
        supplyPaid: Math.round(Number(exact.supplyPaid || 0)),
        vat: Math.round(Number(exact.vat || 0))
      };
    }
    const key = regionCompareKey(region);
    let supplyPaid = 0;
    let vat = 0;
    Object.entries(state.draftRegions || {}).forEach(([name, values]) => {
      if (!key || regionCompareKey(name) !== key) return;
      supplyPaid += Math.round(Number(values?.supplyPaid || 0));
      vat += Math.round(Number(values?.vat || 0));
    });
    return { supplyPaid, vat };
  }

  function settlementsForWeek(weekStart) {
    const calc = Calc();
    if (!calc) return [];
    const normalized = weekStartKey(weekStart);
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => calc.settlementWeek(record) === normalized);
  }

  function buildPayoutComputeOptions(settlements, weekKey) {
    const options = { withdrawals: window.BremStorage?.payrollWithdrawal?.getAll?.() || [] };
    const calc = Calc();
    if (!calc?.allocateWeekWithdrawals || !calc.buildWeekCapacityMap) return options;
    try {
      const dailySettlements = window.BremStorage?.settlements?.getAll?.() || [];
      const dateRange = calc.partDateRange?.(settlements) || {};
      const allocation = calc.allocateWeekWithdrawals(
        options.withdrawals,
        weekKey,
        calc.buildWeekCapacityMap(settlements),
        { dateRange, weekSettlements: settlements, dailySettlements }
      );
      options.weekSettlements = settlements;
      options.dateRange = dateRange;
      options.dailySettlements = dailySettlements;
      options._allocation = allocation;
      options._prepaidRemain = new Map();
      options._leaseConsumed = new Set();
      options._loanConsumed = new Set();
      if (typeof calc.buildLeaseLoanSpilloverAllocation === 'function') {
        options._leaseLoanSpill = calc.buildLeaseLoanSpilloverAllocation(settlements, {
          week: weekKey,
          withdrawals: options.withdrawals,
          dateRange,
          dailySettlements,
          _allocation: allocation
        });
      }
    } catch (error) {
      console.warn('[revenue region] prepaid allocation skipped', error);
    }
    return options;
  }

  function emptyRegionBucket(region) {
    return {
      region,
      riderCount: 0,
      finalDeposit: 0,
      prepaid: 0
    };
  }

  function aggregateRegions(weekStart) {
    const calc = Calc();
    const normalized = weekStartKey(weekStart);
    if (!calc || !normalized) return { settlements: [], regions: [] };

    const settlements = settlementsForWeek(normalized);
    const rowOptions = buildPayoutComputeOptions(settlements, normalized);
    const byRegion = new Map();

    settlements.forEach(settlement => {
      calc.computeRows(settlement, rowOptions).forEach(row => {
        const region = canonicalRegionLabel(row.region || settlement.region) || '미지정';
        const bucket = byRegion.get(region) || emptyRegionBucket(region);
        const net = Math.round(Number(row.netPay || 0));
        if (net > 0) bucket.finalDeposit += net;
        bucket.prepaid += Math.round(Number(row.prepaid || 0));
        bucket.riderCount += 1;
        byRegion.set(region, bucket);
      });
    });

    Object.entries(state.draftRegions || {}).forEach(([name, values]) => {
      const region = canonicalRegionLabel(name) || name;
      if (!region || byRegion.has(region)) return;
      if (!Math.round(Number(values?.supplyPaid || 0)) && !Math.round(Number(values?.vat || 0))) return;
      byRegion.set(region, emptyRegionBucket(region));
    });

    const regions = [...byRegion.values()]
      .map(bucket => {
        const draft = draftForRegion(bucket.region);
        const supplyPaid = draft.supplyPaid;
        const vat = draft.vat;
        const taxFee = Math.round(vat * (state.taxFeePercent / 100));
        const remain = computeRemain({
          supplyPaid,
          vat,
          taxFeePercent: state.taxFeePercent,
          finalDeposit: bucket.finalDeposit,
          prepaid: bucket.prepaid
        });
        return {
          ...bucket,
          supplyPaid,
          vat,
          taxFee,
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
        ? `${formatWeekRange(state.weekStart)} · 직계약 정산서 ${settlements.length}건 · 권역 ${regions.length}곳`
        : `${formatWeekRange(state.weekStart)} · 저장된 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」에서 먼저 저장하세요.`;
    }

    if (!regions.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">표시할 지역이 없습니다. 엑셀 A~C열을 붙여넣거나 주정산서를 먼저 저장하세요.</td></tr>';
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
        <td class="weekly-amount-cell">${formatMoney(row.finalDeposit)}</td>
        <td class="weekly-amount-cell">${formatMoney(row.prepaid)}</td>
        <td class="weekly-amount-cell${row.remain < 0 ? ' revenue-region-overrun' : ''}">${formatRemain(row.remain)}</td>
      </tr>
    `).join('');

    const totals = regions.reduce((acc, row) => {
      acc.supplyPaid += row.supplyPaid;
      acc.vat += row.vat;
      acc.taxFee += row.taxFee;
      acc.finalDeposit += row.finalDeposit;
      acc.prepaid += row.prepaid;
      acc.remain += row.remain;
      return acc;
    }, {
      supplyPaid: 0,
      vat: 0,
      taxFee: 0,
      finalDeposit: 0,
      prepaid: 0,
      remain: 0
    });

    if (foot) {
      foot.innerHTML = `
        <tr class="revenue-region-total-row">
          <td class="revenue-region-col-region"><strong>합계</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.supplyPaid)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.vat)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.taxFee)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.finalDeposit)}</strong></td>
          <td class="weekly-amount-cell"><strong>${formatMoney(totals.prepaid)}</strong></td>
          <td class="weekly-amount-cell${totals.remain < 0 ? ' revenue-region-overrun' : ''}"><strong>${formatRemain(totals.remain)}</strong></td>
        </tr>`;
    }

    updateSummaryTotals(regions, totals);
    renderPreview();
  }

  function updateSummaryTotals(regions, totals = null) {
    const t = totals || regions.reduce((acc, row) => {
      acc.supplyPaid += row.supplyPaid;
      acc.vat += row.vat;
      acc.taxFee += row.taxFee;
      acc.finalDeposit += row.finalDeposit;
      acc.prepaid += row.prepaid;
      acc.remain += row.remain;
      return acc;
    }, { supplyPaid: 0, vat: 0, taxFee: 0, finalDeposit: 0, prepaid: 0, remain: 0 });

    const countEl = $('revenueRegionCount');
    if (countEl) countEl.textContent = String(regions.length);
    const supplyEl = $('revenueRegionSupplyTotal');
    if (supplyEl) supplyEl.textContent = formatMoney(t.supplyPaid);
    const vatEl = $('revenueRegionVatTotal');
    if (vatEl) vatEl.textContent = formatMoney(t.vat);
    const taxFeeEl = $('revenueRegionTaxFeeTotal');
    if (taxFeeEl) taxFeeEl.textContent = formatMoney(t.taxFee);
    const finalEl = $('revenueRegionFinalTotal');
    if (finalEl) finalEl.textContent = formatMoney(t.finalDeposit);
    const prepaidEl = $('revenueRegionPrepaidTotal');
    if (prepaidEl) prepaidEl.textContent = formatMoney(t.prepaid);
    const remainEl = $('revenueRegionRemainTotal');
    if (remainEl) remainEl.textContent = formatRemain(t.remain);
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
        Promise.all([
          window.BremStorage?.ensureSectionLoaded?.('revenue-region-settlement'),
          window.BremStorage?.ensureSectionLoaded?.('final-deposit')
        ]),
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
    if (!silent) showToast('실지급액·부가세 입력을 저장했습니다.');
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

  // 119·이글스 회사명과 DP 코드를 떼고 권역만 남긴다.
  // `주식회사 119컴퍼니_표준울산남A… + 배달 이글스_표준울산남A…` → 표준울산남A
  function canonicalRegionPart(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const ws = window.BremWeeklySettlement;
    if (typeof ws?.canonicalBaeminTeamRegion === 'function') {
      return String(ws.canonicalBaeminTeamRegion(raw) || raw).trim();
    }
    return raw
      .replace(/주식회사\s*119컴퍼니/gi, '')
      .replace(/주식회사119컴퍼니/gi, '')
      .replace(/119\s*라이더스/gi, '')
      .replace(/119컴퍼니/gi, '')
      .replace(/배달\s*이글스/gi, '')
      .replace(/[_-\s]*DP\d+/gi, '')
      .replace(/^[\s_+-]+|[\s_+-]+$/g, '')
      .trim() || raw;
  }

  function canonicalRegionLabel(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parts = raw.split(/\s*\+\s*/).map(part => canonicalRegionPart(part)).filter(Boolean);
    if (!parts.length) return raw;
    const unique = [];
    const seen = new Set();
    parts.forEach(part => {
      const key = normalizeRegionKey(part);
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(part);
    });
    return unique.length ? unique.join(' + ') : raw;
  }

  function regionCompareKey(value) {
    return normalizeRegionKey(canonicalRegionLabel(value));
  }

  function migrateDraftRegionKeys(regions) {
    const out = {};
    Object.entries(regions || {}).forEach(([name, values]) => {
      const canon = canonicalRegionLabel(name) || name;
      if (!out[canon]) out[canon] = { supplyPaid: 0, vat: 0 };
      out[canon].supplyPaid += Math.round(Number(values?.supplyPaid || 0));
      out[canon].vat += Math.round(Number(values?.vat || 0));
    });
    return out;
  }

  function availableRegionNames() {
    const names = new Set();
    (state.rows || []).forEach(row => {
      if (row?.region) names.add(row.region);
    });
    settlementsForWeek(state.weekStart || weekStartKey()).forEach(record => {
      const label = canonicalRegionLabel(record.region);
      if (label) names.add(label);
    });
    (window.BremStorage?.weeklySettlements?.getAll?.('direct') || []).forEach(record => {
      const label = canonicalRegionLabel(record.region);
      if (label) names.add(label);
    });
    Object.keys(state.draftRegions || {}).forEach(name => {
      const label = canonicalRegionLabel(name) || name;
      if (label) names.add(label);
    });
    return [...names];
  }

  function matchRegionByLabel(label, regionNames, aliasMap) {
    const raw = String(label || '').trim();
    if (!raw) return '';
    if (aliasMap[raw]) return aliasMap[raw];
    const key = regionCompareKey(raw) || normalizeRegionKey(raw);
    if (!key) return '';
    const exact = regionNames.find(name => {
      const nk = regionCompareKey(name) || normalizeRegionKey(name);
      return nk === key;
    });
    if (exact) return exact;
    const partial = regionNames.filter(name => {
      const nk = regionCompareKey(name) || normalizeRegionKey(name);
      return nk && (nk.includes(key) || key.includes(nk));
    });
    return partial.length === 1 ? partial[0] : '';
  }

  function parseBaeminUploadMeta(fileName) {
    const ws = window.BremWeeklySettlement;
    if (ws?.parseBaeminFileName) {
      const parsed = ws.parseBaeminFileName(fileName) || {};
      const startDate = String(parsed.startDate || '').slice(0, 10);
      const weekStart = startDate
        ? (ws.baeminWeekStartKey?.(startDate) || weekStartKey(startDate))
        : '';
      return {
        teamName: String(parsed.teamName || '').trim(),
        startDate,
        weekStart
      };
    }
    const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
    const match = base.match(/^(\d{8})\s*[-~]\s*(\d{8})[\s_\-]*(.+)$/);
    if (!match) return { teamName: '', startDate: '', weekStart: '' };
    const startDate = `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}`;
    return {
      teamName: String(match[3] || '').replace(/_?정산서$/i, '').trim(),
      startDate,
      weekStart: weekStartKey(startDate)
    };
  }

  function matchRegionByFileName(fileName, regionNames, aliasMap) {
    const meta = parseBaeminUploadMeta(fileName);
    if (meta.teamName) {
      const byTeam = matchRegionByLabel(meta.teamName, regionNames, aliasMap);
      if (byTeam) return byTeam;
    }
    const base = String(fileName || '').replace(/\.[^.]+$/, '').trim();
    if (aliasMap[base]) return aliasMap[base];
    const key = regionCompareKey(base) || normalizeRegionKey(base);
    if (!key) return '';
    // 더 구체적인(긴) 지역명이 우선 매칭되게 정렬한다.
    const sorted = [...regionNames].sort(
      (a, b) => (regionCompareKey(b) || normalizeRegionKey(b)).length
        - (regionCompareKey(a) || normalizeRegionKey(a)).length
    );
    const hit = sorted.find(name => {
      const nk = regionCompareKey(name) || normalizeRegionKey(name);
      return nk && (key.includes(nk) || normalizeRegionKey(base).includes(nk));
    });
    return hit || matchRegionByLabel(base, regionNames, aliasMap);
  }

  function baeminUploadGroupKey(row) {
    const meta = parseBaeminUploadMeta(row?.fileName || '');
    const week = meta.weekStart || weekStartKey(state.weekStart || today());
    const label = row?.region || meta.teamName || '';
    const canon = regionCompareKey(label);
    if (canon) return `region:${canon}|${week}`;
    return `file:${String(row?.fileName || row?.source || '').trim()}`;
  }

  function groupBaeminUploadRows(rows) {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (!row) return;
      const key = baeminUploadGroupKey(row);
      const names = Array.isArray(row.fileNames) && row.fileNames.length
        ? row.fileNames.map(name => String(name || '').trim()).filter(Boolean)
        : [String(row.fileName || '').trim()].filter(Boolean);
      if (!groups.has(key)) {
        groups.set(key, {
          kind: 'baemin',
          fileName: names.join(' + '),
          fileNames: [...names],
          source: row.source || names[0] || '',
          region: row.region || '',
          supplyPaid: Math.round(Number(row.supplyPaid || 0)),
          vat: Math.round(Number(row.vat || 0)),
          note: row.note || '',
          notes: row.note ? [row.note] : []
        });
        return;
      }
      const group = groups.get(key);
      names.forEach(name => {
        if (name && !group.fileNames.includes(name)) group.fileNames.push(name);
      });
      group.supplyPaid += Math.round(Number(row.supplyPaid || 0));
      group.vat += Math.round(Number(row.vat || 0));
      if (row.note && !group.notes.includes(row.note)) group.notes.push(row.note);
      if (!group.region && row.region) group.region = row.region;
      group.fileName = group.fileNames.join(' + ');
      group.source = group.region || group.source;
      group.note = group.fileNames.length > 1
        ? `${group.fileNames.length}파일 합산 · ${group.notes.join(' / ')}`
        : (group.notes[0] || '');
    });
    return [...groups.values()];
  }

  function parseMoneyText(value) {
    const text = String(value ?? '').replace(/[^\d.\-]/g, '');
    const num = Number(text);
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function isPasteHeaderRow(source, supplyRaw, vatRaw) {
    const joined = `${source} ${supplyRaw} ${vatRaw}`;
    if (!/권역|지역|매칭|실지급|부가세|공급대가|vat/i.test(joined)) return false;
    return !String(supplyRaw ?? '').replace(/[^\d.\-]/g, '');
  }

  function parsePasteRows(text, options = {}) {
    const kind = options.kind === 'baemin' ? 'baemin' : 'coupang';
    const rows = [];
    String(text || '').split(/\r?\n/).forEach((line, index) => {
      if (!String(line || '').trim()) return;
      const cells = line.includes('\t')
        ? line.split('\t')
        : line.split(',');
      const source = String(cells[0] ?? '').trim().replace(/^"|"$/g, '');
      const supplyRaw = cells[1];
      const vatRaw = cells[2];
      const supplyPaid = parseMoneyText(supplyRaw);
      const vat = parseMoneyText(vatRaw);
      if (!source && !supplyPaid && !vat) return;
      if (!rows.length && isPasteHeaderRow(source, supplyRaw, vatRaw)) return;
      rows.push({
        kind,
        source,
        supplyPaid,
        vat,
        fileName: '엑셀 붙여넣기',
        fileNames: [`붙여넣기 ${index + 1}행`],
        note: `${index + 1}행`
      });
    });
    return rows;
  }

  function groupPasteRows(rows) {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (!row) return;
      const region = String(row.region || '').trim();
      const sourceKey = regionCompareKey(row.source) || normalizeRegionKey(row.source) || String(row.source || row.fileName || '');
      const key = region ? `region:${regionCompareKey(region)}` : `unmatched:${sourceKey}`;
      const names = Array.isArray(row.fileNames) && row.fileNames.length
        ? row.fileNames.map(name => String(name || '').trim()).filter(Boolean)
        : [String(row.fileName || row.source || '').trim()].filter(Boolean);
      if (!groups.has(key)) {
        groups.set(key, {
          kind: row.kind || 'coupang',
          fileName: names.join(' + ') || '엑셀 붙여넣기',
          fileNames: [...names],
          source: row.source || names[0] || '',
          region,
          supplyPaid: Math.round(Number(row.supplyPaid || 0)),
          vat: Math.round(Number(row.vat || 0)),
          note: row.note || '',
          notes: row.note ? [row.note] : []
        });
        return;
      }
      const group = groups.get(key);
      names.forEach(name => {
        if (name && !group.fileNames.includes(name)) group.fileNames.push(name);
      });
      group.supplyPaid += Math.round(Number(row.supplyPaid || 0));
      group.vat += Math.round(Number(row.vat || 0));
      if (row.note && !group.notes.includes(row.note)) group.notes.push(row.note);
      if (!group.region && region) group.region = region;
      if (row.kind && group.kind !== row.kind) group.kind = 'mixed';
      group.fileName = group.fileNames.join(' + ') || group.fileName;
      group.note = group.fileNames.length > 1
        ? `${group.fileNames.length}건 합산${group.notes.length ? ` · ${group.notes.join(' / ')}` : ''}`
        : (group.notes[0] || '');
    });
    return [...groups.values()];
  }

  function matchIncomingRows(rows) {
    const regionNames = availableRegionNames();
    const aliases = Revenue()?.getRegionAliasMap?.() || {};
    return (rows || []).map(row => ({
      ...row,
      region: row.region
        || matchRegionByLabel(row.source, regionNames, aliases)
        || matchRegionByFileName(row.source, regionNames, aliases)
        || matchRegionByFileName(row.fileName, regionNames, aliases)
    }));
  }

  function handlePaste() {
    const kind = document.querySelector('input[name="revenueRegionPasteKind"]:checked')?.value === 'baemin'
      ? 'baemin'
      : 'coupang';
    const parsed = parsePasteRows($('revenueRegionPasteInput')?.value || '', { kind });
    if (!parsed.length) {
      showToast('A열 권역 · B열 실지급액 · C열 부가세를 붙여넣어 주세요.');
      return;
    }
    state.uploadRows = groupPasteRows(matchIncomingRows((state.uploadRows || []).concat(parsed)));
    const unmatched = state.uploadRows.filter(row => !row.region).length;
    const matched = state.uploadRows.length - unmatched;
    setUploadStatus(
      unmatched
        ? `매칭 ${matched}건 · 미매칭 ${unmatched}건 — 아래 표에서 지역을 고르세요.`
        : `매칭 ${matched}건 · 표에 합산합니다.`
    );
    applyPreview({ mode: 'add' });
    if (!state.uploadRows.length) {
      const input = $('revenueRegionPasteInput');
      if (input) input.value = '';
    }
  }

  function syncUploadRowsFromRaw() {
    const coupang = (state.uploadRows || []).filter(row => row.kind === 'coupang');
    state.uploadRows = [...coupang, ...groupBaeminUploadRows(state.baeminRaw)];
    renderPreview();
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

  // 표 헤더 줄만 찾는다. 안내문("…배달료, 수기정산금, 관리비입니다.")은 한 셀에
  // 긴 문장으로 들어와 있어 셀 길이 제한으로 걸러낸다.
  function findHeaderRowIndex(rows, pattern, maxCellLength = 24) {
    for (let i = 0; i < rows.length; i += 1) {
      const row = Array.isArray(rows[i]) ? rows[i] : [];
      const hit = row.some(cell => {
        const text = String(cell ?? '').trim();
        return text && text.length <= maxCellLength && pattern.test(text);
      });
      if (hit) return i;
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

    const taxHeader = findHeaderRowIndex(rows, /^공급\s*대가$/);
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

    // 회사가 부담하는 몫만 뺀다. 사업주부담 고용보험료(I열)·산재보험료(K열).
    // 라이더부담(J·L열)은 라이더 급여에서 공제되므로 제외한다.
    let employment = 0;
    let accident = 0;
    let employmentLabel = 'I열';
    let accidentLabel = 'K열';
    let insuranceFound = false;
    const weekHeader = findHeaderRowIndex(rows, /^정산\s*시작일$/);
    if (weekHeader >= 0) {
      const header = rows[weekHeader] || [];
      const squashed = index => String(header[index] ?? '').replace(/\s+/g, '');
      let employmentCol = header.findIndex(
        (_, index) => /사업주부담.*고용보험/.test(squashed(index))
      );
      let accidentCol = header.findIndex(
        (_, index) => /사업주부담.*산재보험/.test(squashed(index))
      );
      insuranceFound = employmentCol >= 0 && accidentCol >= 0;
      if (employmentCol < 0) employmentCol = 8;
      if (accidentCol < 0) accidentCol = 10;
      employmentLabel = cellString(header, employmentCol).replace(/\s+/g, ' ') || employmentLabel;
      accidentLabel = cellString(header, accidentCol).replace(/\s+/g, ' ') || accidentLabel;
      for (let i = weekHeader + 1; i < Math.min(rows.length, weekHeader + 5); i += 1) {
        const row = rows[i] || [];
        if (!rowText(row).trim()) continue;
        employment = cellNumber(row, employmentCol);
        accident = cellNumber(row, accidentCol);
        break;
      }
    }

    const supplyPaid = supplyTotal - (employment + accident);
    const note = insuranceFound
      ? `공급대가 ${formatMoney(supplyTotal)} − ${employmentLabel} ${formatMoney(employment)} − ${accidentLabel} ${formatMoney(accident)}`
      : `공급대가 ${formatMoney(supplyTotal)} · 사업주부담 고용·산재보험료를 찾지 못했습니다 (주차별 정산내역 I·K열 확인)`;
    return {
      vat,
      supplyTotal,
      supplyPaid,
      employment,
      accident,
      insuranceFound,
      note
    };
  }

  function baeminRowsLookValid(rows) {
    return Array.isArray(rows)
      && rows.length > 0
      && findHeaderRowIndex(rows, /^공급\s*대가$/) >= 0
      && findHeaderRowIndex(rows, /^정산\s*시작일$/) >= 0;
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
        let rows;
        try {
          rows = await readSheetRows(file, uploadPassword(), {
            sheetIndexes: [0, 1, 2],
            validateRows: baeminRowsLookValid
          });
        } catch (strictError) {
          if (strictError?.code === 'PASSWORD_REQUIRED' || strictError?.code === 'WRONG_PASSWORD') {
            throw strictError;
          }
          // 주차별 정산내역이 없는 형식이면 세금계산서 표만 있는 시트라도 읽는다.
          rows = await readSheetRows(file, uploadPassword(), {
            sheetIndexes: [0, 1, 2],
            validateRows: candidate => findHeaderRowIndex(candidate, /^공급\s*대가$/) >= 0
          });
        }
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

    if (collected.length) {
      collected.forEach(row => {
        const at = state.baeminRaw.findIndex(item => item.fileName === row.fileName);
        if (at >= 0) state.baeminRaw[at] = row;
        else state.baeminRaw.push(row);
      });
      syncUploadRowsFromRaw();
    }
    const grouped = groupBaeminUploadRows(collected);
    const matched = grouped.filter(row => row.region).length;
    const splitCount = grouped.filter(row => (row.fileNames || []).length > 1).length;
    const parts = [`배민 ${collected.length}개 파일 → ${grouped.length}개 지역`];
    if (splitCount) parts.push(`파일 합산 ${splitCount}곳`);
    parts.push(`자동 매칭 ${matched}개`);
    if (failed.length) parts.push(`실패 ${failed.length}건: ${failed.join(' / ')}`);
    setUploadStatus(parts.join(' · '));
  }

  function mergePreviewRows(rows) {
    const next = [...state.uploadRows];
    rows.forEach(row => {
      if (row.kind === 'baemin') {
        const at = state.baeminRaw.findIndex(item => item.fileName === row.fileName);
        if (at >= 0) state.baeminRaw[at] = row;
        else state.baeminRaw.push(row);
        return;
      }
      const at = next.findIndex(item => item.kind === row.kind && item.source === row.source);
      if (at >= 0) next[at] = row;
      else next.push(row);
    });
    state.uploadRows = next.filter(row => row.kind !== 'baemin');
    syncUploadRowsFromRaw();
  }

  function clearPreview() {
    state.uploadRows = [];
    state.baeminRaw = [];
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
    const banner = $('revenueRegionUnmatchedBanner');
    if (banner) {
      banner.hidden = true;
      banner.textContent = '';
    }
    return;
  }

    const regionNames = availableRegionNames();
    wrap.hidden = false;
    actions.hidden = false;
    const unmatched = state.uploadRows.filter(row => !row.region).length;
    const banner = $('revenueRegionUnmatchedBanner');
    if (banner) {
      banner.hidden = unmatched === 0;
      banner.textContent = unmatched
        ? `미매칭 ${unmatched}건 — 반영할 지역을 고른 뒤 「표에 반영」을 누르세요.`
        : '';
    }

    body.innerHTML = state.uploadRows.map((row, index) => {
      const options = ['<option value="">(반영 안 함)</option>']
        .concat(regionNames.map(name => (
          `<option value="${escapeHtml(name)}"${name === row.region ? ' selected' : ''}>${escapeHtml(name)}</option>`
        )))
        .join('');
      const kindText = row.kind === 'baemin' ? '배민' : row.kind === 'mixed' ? '쿠팡+배민' : '쿠팡';
      return `
        <tr class="${row.region ? '' : 'revenue-region-preview-unmatched'}">
          <td>${kindText}</td>
          <td>${escapeHtml(row.source)}<br><span class="muted-inline">${escapeHtml(row.fileName)}</span>${
            (row.fileNames || []).length > 1
              ? `<br><span class="muted-inline">${(row.fileNames || []).length}건 합산</span>`
              : ''
          }</td>
          <td><select class="admin-period-input" data-preview-region="${index}">${options}</select></td>
          <td class="weekly-amount-cell">${formatMoney(row.supplyPaid)}</td>
          <td class="weekly-amount-cell">${formatMoney(row.vat)}</td>
          <td><span class="muted-inline">${escapeHtml(row.note || '')}</span></td>
        </tr>`;
    }).join('');
  }

  function applyPreview(options = {}) {
    if (!state.uploadRows.length) return;
    collectDraftFromInputs();
    const add = options.mode !== 'replace';

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
      if (row.source) aliases[row.source] = row.region;
      (row.fileNames || [row.fileName]).forEach(name => {
        if (name) aliases[String(name).replace(/\.[^.]+$/, '')] = row.region;
      });
    });

    const appliedRegions = Object.keys(merged).length;
    if (!appliedRegions) {
      renderPreview();
      showToast('매칭된 줄이 없습니다. 미매칭 줄에서 지역을 고르세요.');
      return;
    }

    Object.entries(merged).forEach(([region, values]) => {
      const prev = state.draftRegions[region] || {};
      state.draftRegions[region] = add
        ? {
          ...prev,
          supplyPaid: Math.round(Number(prev.supplyPaid || 0)) + values.supplyPaid,
          vat: Math.round(Number(prev.vat || 0)) + values.vat
        }
        : { ...prev, ...values };
    });
    Revenue()?.saveRegionAliases?.(aliases);

    const leftoverNames = new Set();
    leftover.forEach(row => {
      (row.fileNames || String(row.fileName || '').split(/\s*\+\s*/))
        .map(name => String(name || '').trim())
        .filter(Boolean)
        .forEach(name => leftoverNames.add(name));
    });
    state.baeminRaw = state.baeminRaw.filter(row => leftoverNames.has(row.fileName));
    state.uploadRows = leftover;
    render();
    saveDraft({ silent: true });

    const tail = leftover.length ? ` · 매칭 안 된 ${leftover.length}건은 아래에서 지역을 고르세요.` : '';
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
      ['계산', '실지급액 - 부가세×비율 - 최종입금(지역별) - 선정산(지역별)'],
      [],
      [
        '지역', '기사수', '실지급액', '부가세', '세무처리비',
        '최종입금', '선정산', '남은 금액'
      ]
    ];
    regions.forEach(row => {
      rows.push([
        row.region,
        row.riderCount,
        row.supplyPaid,
        row.vat,
        row.taxFee,
        row.finalDeposit,
        row.prepaid,
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
    $('revenueRegionPasteBtn')?.addEventListener('click', handlePaste);
    $('revenueRegionPasteInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handlePaste();
      }
    });
    $('revenueRegionClearAmountsBtn')?.addEventListener('click', () => {
      if (!Object.keys(state.draftRegions || {}).length) {
        showToast('지울 실지급액·부가세가 없습니다.');
        return;
      }
      if (!window.confirm('이 주의 실지급액·부가세 입력을 모두 지울까요?')) return;
      Object.keys(state.draftRegions).forEach(region => {
        state.draftRegions[region] = { supplyPaid: 0, vat: 0 };
      });
      saveDraft({ silent: true });
      showToast('실지급액·부가세 입력을 비웠습니다.');
    });

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
      const region = String(select.value || '');
      state.uploadRows[index].region = region;
      const names = new Set(
        (state.uploadRows[index].fileNames || [state.uploadRows[index].fileName])
          .map(name => String(name || '').trim())
          .filter(Boolean)
      );
      state.baeminRaw.forEach(row => {
        if (names.has(row.fileName)) row.region = region;
      });
      state.uploadRows = groupPasteRows(state.uploadRows);
      renderPreview();
    });

    bindDropZone($('revenueRegionCoupangDrop'), files => handleCoupangUpload(files[0]));
    bindDropZone($('revenueRegionBaeminDrop'), files => handleBaeminUpload(files));
  }

  function excelFilesFromList(fileList) {
    return Array.from(fileList || []).filter(file => /\.xlsx?$/i.test(file.name || ''));
  }

  function bindDropZone(el, onFiles) {
    if (!el) return;
    const setHover = on => el.classList.toggle('is-dragover', !!on);
    ['dragenter', 'dragover'].forEach(type => {
      el.addEventListener(type, event => {
        if (![...event.dataTransfer?.types || []].includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        setHover(true);
      });
    });
    el.addEventListener('dragleave', event => {
      if (event.relatedTarget && el.contains(event.relatedTarget)) return;
      setHover(false);
    });
    el.addEventListener('drop', event => {
      event.preventDefault();
      event.stopPropagation();
      setHover(false);
      const files = excelFilesFromList(event.dataTransfer?.files);
      if (!files.length) {
        showToast('엑셀 파일(.xlsx, .xls)만 올릴 수 있습니다.');
        return;
      }
      void onFiles(files);
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
    matchRegionByFileName,
    groupBaeminUploadRows,
    groupPasteRows,
    baeminUploadGroupKey,
    canonicalRegionLabel,
    aggregateRegions,
    parsePasteRows,
    computeRemain,
    handlePaste,
    applyPreview
  };
})();

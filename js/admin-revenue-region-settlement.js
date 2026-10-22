// 수익 관리 · 지역별 정산
// A열 정산서 이름 → 정산서 지역과 매칭, B열 실지급액(배민·쿠팡에서 직접 받는 금액), C열 부가세
// 남은 금액 = 실지급액 − 최종입금 − 선정산 − 부가세×20%
(function () {
  const LOAD_TIMEOUT_MS = 20000;

  const state = {
    weekStart: '',
    followLatestIfEmpty: true,
    taxFeePercent: 20,
    rows: [],
    draftRegions: {},
    groups: [],
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

  // 실지급액 − 최종입금 − 선정산 − 부가세의 N%(기본 20%)
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

  // 소진율 = (최종입금 + 선정산) ÷ (실지급액 − 부가세) × 100
  // 실지급액−부가세를 100%로 보고, 그 돈을 얼마나 썼는지·얼마나 넘겼는지 본다.
  function usageRatio(supplyPaid, vat, finalDeposit, prepaid) {
    const base = Math.round(Number(supplyPaid) || 0) - Math.round(Number(vat) || 0);
    const used = Math.round(Number(finalDeposit) || 0) + Math.round(Number(prepaid) || 0);
    if (base <= 0) return { base, used, ratio: null, over: 0 };
    const ratio = used / base * 100;
    return { base, used, ratio, over: ratio - 100 };
  }

  function formatUsage(usage) {
    if (!usage || usage.ratio == null) return '-';
    const pct = formatPercent(usage.ratio);
    if (usage.over > 0.05) {
      return `${pct}<br><span class="muted-inline">+${usage.over.toFixed(1)}%p 초과</span>`;
    }
    return pct;
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
    const key = weekStartKey(weekStart);
    if (state.clearedWeek && state.clearedWeek === key) {
      state.draftRegions = {};
      state.groups = [];
      state.savedAt = '';
      setSavedStatus('실지급액·부가세를 지웠습니다.');
      return;
    }
    const saved = Revenue()?.getRegionSettlementByWeek?.(weekStart);
    state.savedAt = saved?.savedAt || '';
    state.taxFeePercent = Math.max(0, Math.min(100, Number(saved?.taxFeePercent ?? 20)));
    const rawRegions = saved?.regions && typeof saved.regions === 'object' ? { ...saved.regions } : {};
    state.groups = normalizeGroups(rawRegions.__groups);
    delete rawRegions.__groups;
    state.draftRegions = migrateDraftRegionKeys(rawRegions);
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
      if (!regions[region]) regions[region] = { supplyPaid: 0, vat: 0, source: region };
      regions[region].supplyPaid = parseMoneyText(input.value);
    });
    document.querySelectorAll('[data-region-vat]').forEach(input => {
      const region = String(input.dataset.regionVat || '').trim();
      if (!region) return;
      if (!regions[region]) regions[region] = { supplyPaid: 0, vat: 0, source: region };
      regions[region].vat = parseMoneyText(input.value);
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

  function directSettlements() {
    return window.BremStorage?.weeklySettlements?.getAll?.('direct') || [];
  }

  function settlementsForWeek(weekStart) {
    const calc = Calc();
    if (!calc) return [];
    const normalized = weekStartKey(weekStart);
    const list = directSettlements();
    if (typeof calc.recordMatchesWeek === 'function') {
      return list.filter(record => calc.recordMatchesWeek(record, normalized));
    }
    return list.filter(record => calc.settlementWeek(record) === normalized);
  }

  function latestDirectSettlementWeek() {
    const calc = Calc();
    if (!calc?.settlementWeek) return '';
    let latest = '';
    directSettlements().forEach(record => {
      const week = String(calc.settlementWeek(record) || '').slice(0, 10);
      if (week && week > latest) latest = week;
    });
    return latest;
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

  function buildPayoutLookup(settlements, weekKey) {
    const byKey = new Map();
    const calc = Calc();
    if (!calc || !weekKey) return byKey;
    const rowOptions = buildPayoutComputeOptions(settlements, weekKey);
    (settlements || []).forEach(settlement => {
      let rows = [];
      try {
        rows = calc.computeRows(settlement, rowOptions) || [];
      } catch (error) {
        console.warn('[revenue region] computeRows failed', error);
        try {
          rows = calc.computeRows(settlement, { withdrawals: [] }) || [];
        } catch (_) {
          rows = [{ region: settlement.region, netPay: 0, prepaid: 0 }];
        }
      }
      rows.forEach(row => {
        const region = canonicalRegionLabel(row.region || settlement.region) || '미지정';
        const key = regionCompareKey(region);
        if (!key) return;
        const bucket = byKey.get(key) || emptyRegionBucket(region);
        const net = Math.round(Number(row.netPay || 0));
        if (net > 0) bucket.finalDeposit += net;
        bucket.prepaid += Math.round(Number(row.prepaid || 0));
        bucket.riderCount += 1;
        byKey.set(key, bucket);
      });
    });
    return byKey;
  }

  function payoutForRegion(lookup, region) {
    const key = regionCompareKey(region);
    if (key && lookup.has(key)) return lookup.get(key);
    const names = [...lookup.values()].map(bucket => bucket.region);
    const matched = matchRegionByLabel(region, names, Revenue()?.getRegionAliasMap?.() || {});
    if (matched) {
      const matchedKey = regionCompareKey(matched);
      if (matchedKey && lookup.has(matchedKey)) return lookup.get(matchedKey);
    }
    return emptyRegionBucket(region);
  }

  function rowMoney(row) {
    const taxFee = Math.round(Number(row.vat || 0) * (state.taxFeePercent / 100));
    return {
      ...row,
      taxFee,
      remain: computeRemain({
        supplyPaid: row.supplyPaid,
        vat: row.vat,
        taxFeePercent: state.taxFeePercent,
        finalDeposit: row.finalDeposit,
        prepaid: row.prepaid
      }),
      usage: usageRatio(row.supplyPaid, row.vat, row.finalDeposit, row.prepaid)
    };
  }

  function aggregateRegions(weekStart) {
    const normalized = weekStartKey(weekStart);
    const calc = Calc();
    const settlements = calc && normalized ? settlementsForWeek(normalized) : [];
    const lookup = calc && normalized ? buildPayoutLookup(settlements, normalized) : new Map();
    const byKey = new Map();

    settlements.forEach(record => {
      const region = canonicalRegionLabel(record.region) || String(record.region || '').trim();
      const key = regionCompareKey(region);
      if (!region || !key || byKey.has(key)) return;
      const pay = payoutForRegion(lookup, region);
      byKey.set(key, {
        region,
        source: region,
        unmatched: false,
        riderCount: pay.riderCount,
        finalDeposit: pay.finalDeposit,
        prepaid: pay.prepaid,
        supplyPaid: 0,
        vat: 0,
        kind: record.platform || ''
      });
    });

    Object.entries(state.draftRegions || {}).forEach(([name, values]) => {
      const unmatched = values?.unmatched === true;
      const source = String(values?.source || name || '').trim();
      const region = unmatched
        ? (source || name)
        : (canonicalRegionLabel(name) || name);
      if (!region) return;
      const supplyPaid = Math.round(Number(values?.supplyPaid || 0));
      const vat = Math.round(Number(values?.vat || 0));
      if (unmatched) {
        byKey.set(`unmatched:${source || region}`, {
          region,
          source,
          unmatched: true,
          riderCount: 0,
          finalDeposit: 0,
          prepaid: 0,
          supplyPaid,
          vat,
          kind: values?.kind || ''
        });
        return;
      }
      if (!supplyPaid && !vat) return;
      const key = regionCompareKey(region) || region;
      const prev = byKey.get(key);
      const pay = prev || payoutForRegion(lookup, region);
      byKey.set(key, {
        region: prev?.region || region,
        source: source || prev?.source || region,
        unmatched: false,
        riderCount: prev?.riderCount || pay.riderCount || 0,
        finalDeposit: prev ? prev.finalDeposit : pay.finalDeposit,
        prepaid: prev ? prev.prepaid : pay.prepaid,
        supplyPaid: Math.round(Number(prev?.supplyPaid || 0)) + supplyPaid,
        vat: Math.round(Number(prev?.vat || 0)) + vat,
        kind: values?.kind || prev?.kind || ''
      });
    });

    const regions = [...byKey.values()]
      .map(rowMoney)
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

  function groupKey() {
    return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function normalizeGroups(value) {
    if (!Array.isArray(value)) return [];
    return value.map(group => ({
      id: String(group?.id || groupKey()),
      members: [...new Set((group?.members || []).map(name => String(name || '').trim()).filter(Boolean))]
    })).filter(group => group.members.length >= 2);
  }

  function sumMoney(rows) {
    return (rows || []).reduce((acc, row) => {
      acc.supplyPaid += Math.round(Number(row?.supplyPaid) || 0);
      acc.vat += Math.round(Number(row?.vat) || 0);
      acc.finalDeposit += Math.round(Number(row?.finalDeposit) || 0);
      acc.prepaid += Math.round(Number(row?.prepaid) || 0);
      acc.riderCount += Math.round(Number(row?.riderCount) || 0);
      return acc;
    }, { supplyPaid: 0, vat: 0, finalDeposit: 0, prepaid: 0, riderCount: 0 });
  }

  // 묶음은 각 줄의 부가세 20%를 더한 값이 아니라, 부가세 합계에 20%를 한 번 적용한다.
  function summarizeBundle(rows, taxFeePercent = state.taxFeePercent) {
    const summed = sumMoney(rows);
    const taxFee = Math.round(summed.vat * (Number(taxFeePercent) || 0) / 100);
    return {
      ...summed,
      taxFee,
      remain: summed.supplyPaid - taxFee - summed.finalDeposit - summed.prepaid,
      usage: usageRatio(summed.supplyPaid, summed.vat, summed.finalDeposit, summed.prepaid)
    };
  }

  function activeGroups(regions) {
    const names = new Set((regions || []).map(row => row.region));
    return state.groups
      .map(group => ({
        ...group,
        members: group.members.filter(name => names.has(name))
      }))
      .filter(group => group.members.length >= 2);
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
        ? `${formatWeekRange(state.weekStart)} · 정산서 ${settlements.length}건 · 지역 ${regions.length}곳`
        : `${formatWeekRange(state.weekStart)} · 이 주에 올린 직계약 정산서가 없습니다.`;
    }

    if (!regions.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty">${escapeHtml(formatWeekRange(state.weekStart))}에 올린 직계약 정산서가 없습니다.</td></tr>`;
      if (foot) foot.innerHTML = '';
      updateSummaryTotals([]);
      updateUnmatchedBanner([]);
      return;
    }

    const groups = activeGroups(regions);
    state.groups = groups;
    const groupedNames = new Set(groups.flatMap(group => group.members));
    const byName = new Map(regions.map(row => [row.region, row]));
    const lines = [];
    const consumed = new Set();
    groups.forEach(group => {
      const members = group.members.map(name => byName.get(name)).filter(Boolean);
      lines.push({ kind: 'group', group, summary: summarizeBundle(members) });
      members.forEach(row => {
        consumed.add(row.region);
        if (group.expanded) lines.push({ kind: 'member', row, groupId: group.id });
      });
    });
    regions.forEach(row => {
      if (!groupedNames.has(row.region) && !consumed.has(row.region)) lines.push({ kind: 'leaf', row });
    });

    body.innerHTML = lines.map(line => {
      if (line.kind === 'group') return groupRowHtml(line.group, line.summary);
      return regionRowHtml(line.row, line.kind === 'member');
    }).join('');
    const checkAll = $('revenueRegionCheckAll');
    if (checkAll) checkAll.checked = false;

    writeTotals(foot, summarizeBundle(regions));
    updateSummaryTotals(regions, summarizeBundle(regions));
    updateUnmatchedBanner(regions);
  }

  function moneyCells(row) {
    return `
      <td class="weekly-amount-cell" data-money="final">${formatMoney(row.finalDeposit)}</td>
      <td class="weekly-amount-cell" data-money="prepaid">${formatMoney(row.prepaid)}</td>
      <td class="weekly-amount-cell" data-money="tax">${formatMoney(row.taxFee)}</td>
      <td class="weekly-amount-cell${row.remain < 0 ? ' revenue-region-overrun' : ''}" data-money="remain">${formatRemain(row.remain)}</td>
      <td class="weekly-amount-cell${row.usage && row.usage.over > 0 ? ' revenue-region-overrun' : ''}" data-money="usage">${formatUsage(row.usage)}</td>`;
  }

  function regionRowHtml(row, inGroup) {
    return `
      <tr class="${row.unmatched ? 'revenue-region-unmatched' : ''} ${inGroup ? 'revenue-region-member' : ''}" data-region-row="${escapeHtml(row.region)}">
        <td class="revenue-region-col-check">${inGroup ? '' : `<input type="checkbox" data-region-check value="${escapeHtml(row.region)}" aria-label="${escapeHtml(row.region)} 선택">`}</td>
        <td class="revenue-region-col-region"><strong>${escapeHtml(row.region)}</strong>${
          row.unmatched
            ? `<br>${regionFixSelect(row)}<br><span class="muted-inline">미매칭</span>`
            : `<br><span class="muted-inline">${inGroup ? '묶음 안 · ' : ''}${Number(row.riderCount || 0).toLocaleString('ko-KR')}명</span>`
        }</td>
        <td class="revenue-region-input-cell">
          <input type="text" inputmode="numeric" class="admin-period-input revenue-region-money-input" data-region-supply="${escapeHtml(row.region)}" value="${row.supplyPaid || ''}" placeholder="0">
        </td>
        <td class="revenue-region-input-cell">
          <input type="text" inputmode="numeric" class="admin-period-input revenue-region-money-input" data-region-vat="${escapeHtml(row.region)}" value="${row.vat || ''}" placeholder="0">
        </td>
        ${moneyCells(row)}
      </tr>`;
  }

  function groupRowHtml(group, summary) {
    const title = group.members.join(' + ');
    return `
      <tr class="revenue-region-group" data-group-row="${escapeHtml(group.id)}">
        <td class="revenue-region-col-check"><input type="checkbox" data-group-check value="${escapeHtml(group.id)}" aria-label="묶음 선택"></td>
        <td class="revenue-region-col-region">
          <strong>${escapeHtml(title)}</strong>
          <br><span class="muted-inline">묶음 ${group.members.length}곳 · 부가세 합계×20%로 계산</span>
          <button type="button" class="small-btn" data-toggle-group="${escapeHtml(group.id)}">${group.expanded ? '접기' : '펼치기'}</button>
          <button type="button" class="small-btn revenue-region-ungroup" data-ungroup="${escapeHtml(group.id)}">해제</button>
        </td>
        <td class="weekly-amount-cell" data-money="supply"><strong>${formatMoney(summary.supplyPaid)}</strong></td>
        <td class="weekly-amount-cell" data-money="vat"><strong>${formatMoney(summary.vat)}</strong></td>
        <td class="weekly-amount-cell" data-money="final"><strong>${formatMoney(summary.finalDeposit)}</strong></td>
        <td class="weekly-amount-cell" data-money="prepaid"><strong>${formatMoney(summary.prepaid)}</strong></td>
        <td class="weekly-amount-cell" data-money="tax"><strong>${formatMoney(summary.taxFee)}</strong></td>
        <td class="weekly-amount-cell${summary.remain < 0 ? ' revenue-region-overrun' : ''}" data-money="remain"><strong>${formatRemain(summary.remain)}</strong></td>
        <td class="weekly-amount-cell${summary.usage && summary.usage.over > 0 ? ' revenue-region-overrun' : ''}" data-money="usage"><strong>${formatUsage(summary.usage)}</strong></td>
      </tr>`;
  }

  function writeTotals(foot, totals) {
    if (!foot) return;
    foot.innerHTML = `
      <tr class="revenue-region-total-row">
        <td class="revenue-region-col-check"></td>
        <td class="revenue-region-col-region"><strong>합계</strong><br><span class="muted-inline">세로 합 · 묶음은 한 번</span></td>
        <td class="weekly-amount-cell"><strong>${formatMoney(totals.supplyPaid)}</strong></td>
        <td class="weekly-amount-cell"><strong>${formatMoney(totals.vat)}</strong></td>
        <td class="weekly-amount-cell"><strong>${formatMoney(totals.finalDeposit)}</strong></td>
        <td class="weekly-amount-cell"><strong>${formatMoney(totals.prepaid)}</strong></td>
        <td class="weekly-amount-cell"><strong>${formatMoney(totals.taxFee)}</strong></td>
        <td class="weekly-amount-cell${totals.remain < 0 ? ' revenue-region-overrun' : ''}"><strong>${formatRemain(totals.remain)}</strong></td>
        <td class="weekly-amount-cell${totals.usage && totals.usage.over > 0 ? ' revenue-region-overrun' : ''}"><strong>${formatUsage(totals.usage)}</strong></td>
      </tr>`;
  }

  function updateUnmatchedBanner(regions) {
    const banner = $('revenueRegionUnmatchedBanner');
    if (!banner) return;
    const unmatched = (regions || []).filter(row => row.unmatched).length;
    banner.hidden = unmatched === 0;
    banner.textContent = unmatched
      ? `미매칭 ${unmatched}건 — 노란 줄에서 지역을 고르면 최종입금·선정산이 붙습니다.`
      : '';
  }

  function regionFixSelect(row) {
    const names = [...new Set(settlementRegionNames())]
      .sort((a, b) => String(a).localeCompare(String(b), 'ko-KR'));
    if (!names.length) {
      return '<span class="muted-inline">정산서 지역이 없어 최종입금·선정산을 붙일 수 없습니다</span>';
    }
    const options = ['<option value="">지역 선택</option>']
      .concat(names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`))
      .join('');
    return `<select class="admin-period-input revenue-region-fix" data-region-fix="${escapeHtml(row.region)}">${options}</select>`;
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
    const usageEl = $('revenueRegionUsageTotal');
    if (usageEl) {
      const usage = t.usage || usageRatio(t.supplyPaid, t.vat, t.finalDeposit, t.prepaid);
      usageEl.innerHTML = usage.ratio == null
        ? '-'
        : `${formatPercent(usage.ratio)}${usage.over > 0.05 ? ` <span class="muted-inline">+${usage.over.toFixed(1)}%p 초과</span>` : ''}`;
      usageEl.classList.toggle('revenue-region-overrun', usage.over > 0);
    }
  }

  function paintMoney(tr, row) {
    const finalCell = tr.querySelector('[data-money="final"]');
    const prepaidCell = tr.querySelector('[data-money="prepaid"]');
    const taxCell = tr.querySelector('[data-money="tax"]');
    const remainCell = tr.querySelector('[data-money="remain"]');
    const usageCell = tr.querySelector('[data-money="usage"]');
    const supplyCell = tr.querySelector('[data-money="supply"]');
    const vatCell = tr.querySelector('[data-money="vat"]');
    const isGroup = tr.hasAttribute('data-group-row');
    if (supplyCell) supplyCell.innerHTML = `<strong>${formatMoney(row.supplyPaid)}</strong>`;
    if (vatCell) vatCell.innerHTML = `<strong>${formatMoney(row.vat)}</strong>`;
    if (finalCell) finalCell.innerHTML = isGroup ? `<strong>${formatMoney(row.finalDeposit)}</strong>` : formatMoney(row.finalDeposit);
    if (prepaidCell) prepaidCell.innerHTML = isGroup ? `<strong>${formatMoney(row.prepaid)}</strong>` : formatMoney(row.prepaid);
    if (taxCell) taxCell.innerHTML = isGroup ? `<strong>${formatMoney(row.taxFee)}</strong>` : formatMoney(row.taxFee);
    if (remainCell) {
      remainCell.innerHTML = isGroup ? `<strong>${formatRemain(row.remain)}</strong>` : formatRemain(row.remain);
      remainCell.classList.toggle('revenue-region-overrun', row.remain < 0);
    }
    if (usageCell) {
      usageCell.innerHTML = isGroup ? `<strong>${formatUsage(row.usage)}</strong>` : formatUsage(row.usage);
      usageCell.classList.toggle('revenue-region-overrun', !!(row.usage && row.usage.over > 0));
    }
  }

  function refreshCalculated() {
    const { regions } = aggregateRegions(state.weekStart);
    state.rows = regions;
    const byName = new Map(regions.map(row => [row.region, row]));
    document.querySelectorAll('[data-region-row]').forEach(tr => {
      const row = byName.get(tr.getAttribute('data-region-row') || '');
      if (!row) return;
      paintMoney(tr, row);
    });
    activeGroups(regions).forEach(group => {
      const tr = document.querySelector(`[data-group-row="${group.id}"]`);
      if (!tr) return;
      const members = group.members.map(name => byName.get(name)).filter(Boolean);
      paintMoney(tr, summarizeBundle(members));
    });
    const totals = summarizeBundle(regions);
    writeTotals($('revenueRegionFoot'), totals);
    updateSummaryTotals(regions, totals);
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
      if (state.followLatestIfEmpty && !settlementsForWeek(state.weekStart).length) {
        const latest = latestDirectSettlementWeek();
        if (latest && latest !== state.weekStart) {
          state.weekStart = latest;
          state.lockedWeek = latest;
          state.followLatestIfEmpty = false;
          loadSavedDraft(state.weekStart);
        }
      }
      const count = settlementsForWeek(state.weekStart || weekStartKey()).length;
      setLoadStatus(count
        ? `정산서 ${count}건 불러옴 · ${formatWeekRange(state.weekStart)}`
        : `이 주 정산서 없음 · ${formatWeekRange(state.weekStart)}`);
    } catch (error) {
      console.warn('[revenue region settlement] load failed:', error);
      setLoadStatus('정산 데이터를 불러오지 못했습니다. 「불러오기」를 다시 눌러주세요.');
      showToast('정산 데이터 로드에 실패했습니다. 잠시 후 다시 시도하세요.');
    } finally {
      state.loading = false;
      if (state.clearedWeek && state.clearedWeek === state.weekStart) {
        state.draftRegions = {};
        state.groups = [];
        Revenue()?.saveRegionSettlement?.(state.weekStart, {
          regions: {},
          taxFeePercent: state.taxFeePercent
        });
      }
      rematchDraftToSettlements();
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
    const regions = options.regions != null ? options.regions : collectDraftFromInputs();
    const taxFeePercent = Math.max(0, Math.min(100, Number($('revenueRegionTaxFeePercent')?.value || state.taxFeePercent || 20)));
    state.taxFeePercent = taxFeePercent;
    const saved = Revenue().saveRegionSettlement(weekStart, {
      regions: { ...regions, __groups: state.groups },
      taxFeePercent
    });
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

  // 시도 접두사(울산_ 경남_)는 떼고, (Z)는 남겨 포항중앙과 포항중앙(Z)를 구분한다.
  function normalizeRegionKey(value) {
    const raw = String(value || '');
    const isZ = /\(\s*z\s*\)/i.test(raw);
    const key = raw
      .replace(/\(\s*z\s*\)/gi, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/^[가-힣]{2}[_\-\s]/, '')
      .replace(/[\s_\-·.]/g, '')
      .toLowerCase()
      .trim();
    return key ? (isZ ? `${key}z` : key) : '';
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
      if (String(name).startsWith('__')) return;
      const unmatched = values?.unmatched === true;
      const source = String(values?.source || name || '').trim();
      const canon = unmatched
        ? (source || name)
        : (canonicalRegionLabel(name) || name);
      if (!canon) return;
      if (!out[canon]) {
        out[canon] = {
          supplyPaid: 0,
          vat: 0,
          source: source || canon,
          unmatched,
          kind: values?.kind || ''
        };
      }
      out[canon].supplyPaid += parseMoneyText(values?.supplyPaid);
      out[canon].vat += parseMoneyText(values?.vat);
      if (values?.kind && !out[canon].kind) out[canon].kind = values.kind;
      if (source) out[canon].source = source;
      if (unmatched) out[canon].unmatched = true;
    });
    return out;
  }

  function sameRegionZFlag(leftKey, rightKey) {
    return /z$/.test(String(leftKey || '')) === /z$/.test(String(rightKey || ''));
  }

  function settlementRegionNames() {
    const names = new Set();
    const addSettlementName = record => {
      const raw = String(record?.region || '').trim();
      if (raw) names.add(raw);
      const label = canonicalRegionLabel(raw);
      if (label) names.add(label);
    };
    settlementsForWeek(state.weekStart || weekStartKey()).forEach(addSettlementName);
    (window.BremStorage?.weeklySettlements?.getAll?.('direct') || []).forEach(addSettlementName);
    return [...names];
  }

  function availableRegionNames() {
    return settlementRegionNames();
  }

  // 정산서 이름과 엑셀 A열을 같은 키로 본다.
  // 표준·경남·경북·필드는 표기 차이이고, 청원성산은 창원성산과 같다.
  function foldRegionKey(value) {
    const key = regionCompareKey(value) || normalizeRegionKey(value);
    return String(key || '')
      .replace(/표준/g, '')
      .replace(/필드/g, '')
      .replace(/경남/g, '')
      .replace(/경북/g, '')
      .replace(/청원성산/g, '창원성산');
  }

  function regionBaseKey(key) {
    return String(key || '').replace(/z$/, '');
  }

  // 같은 권역이 긴 회사명·짧은 이름·표준 이름으로 여러 개면 표준 이름을 고른다.
  function pickRegionHit(hits) {
    const byKey = new Map();
    (hits || []).forEach(name => {
      const nk = regionCompareKey(name) || normalizeRegionKey(name);
      if (!nk || byKey.has(nk)) return;
      byKey.set(nk, canonicalRegionLabel(name) || name);
    });
    const labels = [...byKey.values()];
    if (labels.length === 1) return labels[0];
    const standard = labels.filter(name => String(name).includes('표준'));
    return standard.length === 1 ? standard[0] : '';
  }

  function matchRegionByLabel(label, regionNames, aliasMap) {
    const raw = String(label || '').trim();
    if (!raw) return '';
    const key = regionCompareKey(raw) || normalizeRegionKey(raw);
    if (!key) return '';
    const folded = foldRegionKey(raw);
    const sameZ = name => sameRegionZFlag(key, regionCompareKey(name) || normalizeRegionKey(name));
    const foldedHits = regionNames.filter(name => {
      if (!sameZ(name)) return false;
      const nk = regionCompareKey(name) || normalizeRegionKey(name);
      if (nk && nk === key) return true;
      const fk = foldRegionKey(name);
      return !!(folded && fk && fk === folded);
    });
    const foldedPick = pickRegionHit(foldedHits);
    // 정산서 이름과 접히면 그 이름을 쓴다. 예전에 잘못 저장된 별칭이 다른 지역을 덮지 않게 한다.
    if (foldedPick) return foldedPick;
    if (aliasMap[raw]) return aliasMap[raw];
    const partial = regionNames.filter(name => {
      const nk = regionCompareKey(name) || normalizeRegionKey(name);
      if (!nk || !sameZ(name)) return false;
      return nk.includes(key) || key.includes(nk);
    });
    const partialPick = pickRegionHit(partial);
    if (partialPick) return partialPick;
    // (Z) 표기만 다르고 정산서가 하나뿐이면 그 정산서에 붙인다.
    // 일반·(Z)가 둘 다 있으면 붙이지 않는다.
    const base = regionBaseKey(folded || key);
    const zLoose = regionNames.filter(name => regionBaseKey(foldRegionKey(name)) === base);
    return pickRegionHit(zLoose);
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
      if (!nk || !sameRegionZFlag(key, nk)) return false;
      return key.includes(nk) || normalizeRegionKey(base).includes(nk);
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
    if (!text || text === '-' || text === '.') return 0;
    const num = Number(text);
    return Number.isFinite(num) ? Math.round(num) : 0;
  }

  function splitPasteLine(line) {
    const raw = String(line || '').replace(/\u00a0/g, ' ').trim();
    if (!raw) return [];
    if (raw.includes('\t')) return raw.split('\t').map(cell => cell.trim());
    const twoSpace = raw.match(/^(.*\S)[ ]{2,}(-?[\d,]+(?:\.\d+)?)[ ]{2,}(-?[\d,]+(?:\.\d+)?)\s*$/);
    if (twoSpace) return [twoSpace[1].trim(), twoSpace[2], twoSpace[3]];
    const spaced = raw.match(/^(.*[가-힣A-Za-z)])\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)\s*$/);
    if (spaced) return [spaced[1].trim(), spaced[2], spaced[3]];
    const csv = raw.match(/^(.*[가-힣A-Za-z)]),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\s*$/);
    if (csv) return [csv[1].trim(), csv[2], csv[3]];
    return [raw];
  }

  function isPasteHeaderRow(source, supplyRaw, vatRaw) {
    const joined = `${source} ${supplyRaw} ${vatRaw}`;
    if (!/권역|지역|매칭|정산서|실지급|부가세|공급대가|vat/i.test(joined)) return false;
    return !String(supplyRaw ?? '').replace(/[^\d.\-]/g, '');
  }

  function parsePasteRows(text, options = {}) {
    const kind = options.kind === 'baemin' ? 'baemin' : 'coupang';
    const rows = [];
    String(text || '').split(/\r?\n/).forEach((line, index) => {
      if (!String(line || '').trim()) return;
      const cells = splitPasteLine(line);
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
          notes: row.note ? [row.note] : [],
          unmatched: !!row.unmatched
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
      if (row.unmatched) group.unmatched = true;
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
    return (rows || []).map(row => {
      const matched = row.region
        || matchRegionByLabel(row.source, regionNames, aliases)
        || matchRegionByFileName(row.source, regionNames, aliases)
        || matchRegionByFileName(row.fileName, regionNames, aliases);
      return {
        ...row,
        region: matched || canonicalRegionLabel(row.source) || String(row.source || '').trim(),
        unmatched: !matched
      };
    });
  }

  function rematchDraftToSettlements() {
    const names = settlementRegionNames();
    const aliases = Revenue()?.getRegionAliasMap?.() || {};
    const next = {};
    Object.entries(state.draftRegions || {}).forEach(([name, values]) => {
      const matched = matchRegionByLabel(name, names, aliases)
        || matchRegionByLabel(values?.source, names, aliases);
      const region = matched
        || canonicalRegionLabel(values?.source || name)
        || name;
      if (!region) return;
      if (!next[region]) {
        next[region] = {
          supplyPaid: 0,
          vat: 0,
          source: values?.source || name,
          unmatched: !matched,
          kind: values?.kind || ''
        };
      }
      next[region].supplyPaid += parseMoneyText(values?.supplyPaid);
      next[region].vat += parseMoneyText(values?.vat);
      if (matched) next[region].unmatched = false;
      else next[region].unmatched = true;
      if (values?.kind && !next[region].kind) next[region].kind = values.kind;
    });
    state.draftRegions = next;
  }

  function findDraftKey(label, { unmatched = false, source = '' } = {}) {
    if (state.draftRegions[label]) return label;
    if (unmatched) {
      const bySource = Object.keys(state.draftRegions).find(name => {
        const row = state.draftRegions[name];
        return row?.unmatched && (name === label || row.source === (source || label));
      });
      return bySource || label;
    }
    const key = regionCompareKey(label);
    if (!key) return label;
    return Object.keys(state.draftRegions).find(name => regionCompareKey(name) === key) || label;
  }

  function addRowsToDraft(rows, { add = true } = {}) {
    collectDraftFromInputs();
    const aliases = {};
    (rows || []).forEach(row => {
      const unmatched = !!row.unmatched;
      const label = String(row.region || row.source || '').trim();
      if (!label) return;
      const key = findDraftKey(label, { unmatched, source: row.source || label });
      const prev = state.draftRegions[key] || { supplyPaid: 0, vat: 0 };
      const supply = Math.round(Number(row.supplyPaid || 0));
      const vat = Math.round(Number(row.vat || 0));
      state.draftRegions[key] = {
        supplyPaid: add ? Math.round(Number(prev.supplyPaid || 0)) + supply : supply,
        vat: add ? Math.round(Number(prev.vat || 0)) + vat : vat,
        source: row.source || prev.source || label,
        unmatched: unmatched && prev.unmatched !== false,
        kind: row.kind || prev.kind || ''
      };
      if (!unmatched && row.source && foldRegionKey(row.source) === foldRegionKey(key)) {
        aliases[row.source] = key;
      }
    });
    if (Object.keys(aliases).length) Revenue()?.saveRegionAliases?.(aliases);
  }

  function applyRegionFix(fromName, toRegion) {
    collectDraftFromInputs();
    const from = state.draftRegions[fromName];
    const region = String(toRegion || '').trim();
    if (!from || !region) return;
    const aliases = {};
    if (from.source) aliases[from.source] = region;
    const prev = state.draftRegions[region] || { supplyPaid: 0, vat: 0 };
    state.draftRegions[region] = {
      supplyPaid: Math.round(Number(prev.supplyPaid || 0)) + Math.round(Number(from.supplyPaid || 0)),
      vat: Math.round(Number(prev.vat || 0)) + Math.round(Number(from.vat || 0)),
      source: from.source || region,
      unmatched: false,
      kind: from.kind || prev.kind || ''
    };
    if (fromName !== region) delete state.draftRegions[fromName];
    Revenue()?.saveRegionAliases?.(aliases);
    render();
    saveDraft({ silent: true });
  }

  function handlePaste(rawText) {
    state.clearedWeek = '';
    const input = $('revenueRegionPasteInput');
    const text = rawText != null ? String(rawText) : (input?.value || '');
    if (!String(text).trim()) return false;
    const kind = document.querySelector('input[name="revenueRegionPasteKind"]:checked')?.value === 'baemin'
      ? 'baemin'
      : 'coupang';
    const parsed = parsePasteRows(text, { kind });
    if (!parsed.length) {
      showToast('A열 권역 · B열 실지급액 · C열 부가세를 붙여넣어 주세요.');
      return false;
    }
    const incoming = groupPasteRows(matchIncomingRows(parsed));
    addRowsToDraft(incoming, { add: false });
    const unmatched = incoming.filter(row => row.unmatched).length;
    const merged = parsed.length - incoming.length;
    setUploadStatus(
      unmatched
        ? `붙여넣기 ${incoming.length}곳 · 미매칭 ${unmatched}곳은 표에서 지역을 고르세요.`
        : `붙여넣기 ${incoming.length}곳을 반영했습니다. 다시 붙여넣으면 그 지역 금액이 바뀝니다.`
    );
    if (input) input.value = '';
    render();
    saveDraft({ silent: true });
    showToast(unmatched
      ? `${incoming.length}곳 반영 · 미매칭 ${unmatched}곳은 표에서 지역을 고르세요.`
      : (merged
        ? `${incoming.length}곳으로 반영했습니다. 같은 이름 ${merged}곳은 한 줄로 합쳤고, 다시 붙여넣으면 금액이 바뀝니다.`
        : `${incoming.length}곳으로 반영했습니다. 다시 붙여넣으면 더하지 않고 금액이 바뀝니다.`));
    return true;
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
      const incoming = groupPasteRows(matchIncomingRows(parsed.map(item => ({
        kind: 'coupang',
        fileName: file.name,
        source: item.source,
        supplyPaid: item.supplyPaid,
        vat: item.vat,
        note: item.note
      }))));
      addRowsToDraft(incoming, { add: true });
      const unmatched = incoming.filter(row => row.unmatched).length;
      setUploadStatus(
        unmatched
          ? `쿠팡 ${incoming.length}곳 반영 · 미매칭 ${unmatched}건은 표에서 지역을 고르세요.`
          : `쿠팡 ${incoming.length}곳을 표에 합산했습니다.`
      );
      render();
      saveDraft({ silent: true });
    } catch (error) {
      console.warn('[revenue region settlement] coupang upload failed:', error);
      setUploadStatus(uploadErrorMessage(error));
      showToast(uploadErrorMessage(error));
    }
  }

  async function handleBaeminUpload(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploadStatus(`배민 정산서 ${files.length}개 읽는 중…`);
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
      const incoming = groupPasteRows(matchIncomingRows(groupBaeminUploadRows(collected)));
      addRowsToDraft(incoming, { add: true });
      const unmatched = incoming.filter(row => row.unmatched).length;
      const splitCount = incoming.filter(row => (row.fileNames || []).length > 1).length;
      const parts = [`배민 ${collected.length}개 파일 → ${incoming.length}곳 반영`];
      if (splitCount) parts.push(`파일 합산 ${splitCount}곳`);
      if (unmatched) parts.push(`미매칭 ${unmatched}건은 표에서 지역을 고르세요`);
      if (failed.length) parts.push(`실패 ${failed.length}건: ${failed.join(' / ')}`);
      setUploadStatus(parts.join(' · '));
      render();
      saveDraft({ silent: true });
      return;
    }
    setUploadStatus(failed.length ? `실패 ${failed.length}건: ${failed.join(' / ')}` : '배민 정산서에서 숫자를 찾지 못했습니다.');
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
    const incoming = groupPasteRows(matchIncomingRows(state.uploadRows || []));
    if (!incoming.length) return;
    addRowsToDraft(incoming, { add: options.mode !== 'replace' });
    state.uploadRows = [];
    state.baeminRaw = [];
    render();
    saveDraft({ silent: true });
    setUploadStatus(`${incoming.length}곳을 표에 합산했습니다.`);
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
      ['계산', '실지급액 - 최종입금 - 선정산 - 부가세×비율'],
      [],
      [
        '정산서 이름', '기사수', '실지급액', '부가세',
        '최종입금', '선정산', '부가세 20%', '남은 금액'
      ]
    ];
    regions.forEach(row => {
      rows.push([
        row.region,
        row.riderCount,
        row.supplyPaid,
        row.vat,
        row.finalDeposit,
        row.prepaid,
        row.taxFee,
        row.remain
      ]);
    });

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(rows), '지역별정산');
    window.XLSX.writeFile(wb, `지역별정산_${weekStartKey(weekStart)}.xlsx`);
    showToast('지역별 정산 엑셀을 저장했습니다.');
  }

  function checkedBundleMembers() {
    const names = [...document.querySelectorAll('[data-region-check]:checked')].map(el => el.value);
    document.querySelectorAll('[data-group-check]:checked').forEach(el => {
      const group = state.groups.find(item => item.id === el.value);
      if (group) names.push(...group.members);
    });
    return [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))];
  }

  function clearAmounts() {
    document.querySelectorAll('[data-region-supply], [data-region-vat]').forEach(input => {
      input.value = '';
    });
    state.draftRegions = {};
    state.groups = [];
    state.clearedWeek = weekStartKey(state.weekStart || weekStartKey());
    saveDraft({ silent: true, regions: {} });
  }

  function groupSelected() {
    collectDraftFromInputs();
    const members = checkedBundleMembers();
    if (members.length < 2) {
      showToast('묶을 지역을 2곳 이상 선택하세요.');
      return;
    }
    state.groups = state.groups.filter(group => !group.members.some(name => members.includes(name)));
    state.groups.push({ id: groupKey(), members, expanded: false });
    render();
    showToast(`${members.length}곳을 묶었습니다. 남은 금액은 합계로 계산됩니다.`);
  }

  function ungroupSelected(ids) {
    const set = new Set((ids || []).filter(Boolean));
    if (!set.size) {
      showToast('해제할 묶음을 선택하세요.');
      return;
    }
    state.groups = state.groups.filter(group => !set.has(group.id));
    render();
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
    $('revenueRegionGroupBtn')?.addEventListener('click', groupSelected);
    $('revenueRegionUngroupBtn')?.addEventListener('click', () => {
      ungroupSelected([...document.querySelectorAll('[data-group-check]:checked')].map(el => el.value));
    });
    $('revenueRegionCheckAll')?.addEventListener('change', event => {
      document.querySelectorAll('[data-region-check]').forEach(el => {
        el.checked = event.target.checked;
      });
    });
    $('revenueRegionPasteBtn')?.addEventListener('click', () => {
      if (!String($('revenueRegionPasteInput')?.value || '').trim()) {
        showToast('A열 권역 · B열 실지급액 · C열 부가세를 붙여넣어 주세요.');
        return;
      }
      handlePaste();
    });
    $('revenueRegionPasteInput')?.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text');
      if (!String(text || '').trim()) return;
      event.preventDefault();
      handlePaste(text);
    });
    $('revenueRegionPasteInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handlePaste();
      }
    });
    $('revenueRegionClearAmountsBtn')?.addEventListener('click', () => {
      collectDraftFromInputs();
      const hasAmount = Object.values(state.draftRegions || {}).some(row => Number(row?.supplyPaid) || Number(row?.vat));
      if (!hasAmount) {
        showToast('지울 실지급액·부가세가 없습니다.');
        return;
      }
      if (!window.confirm('이 주의 실지급액·부가세를 모두 지울까요?')) return;
      clearAmounts();
      showToast('실지급액·부가세를 지웠습니다.');
    });

    $('revenueRegionBody')?.addEventListener('paste', event => {
      const target = event.target.closest('[data-region-supply], [data-region-vat]');
      if (!target) return;
      const text = event.clipboardData?.getData('text') || '';
      if (text.includes('\t') || text.includes('\n')) {
        event.preventDefault();
        handlePaste(text);
        return;
      }
      event.preventDefault();
      const parsed = parseMoneyText(text);
      target.value = parsed ? String(parsed) : '';
      collectDraftFromInputs();
      refreshCalculated();
    });
    $('revenueRegionBody')?.addEventListener('input', event => {
      if (!event.target.matches('[data-region-supply], [data-region-vat]')) return;
      collectDraftFromInputs();
      refreshCalculated();
    });
    $('revenueRegionBody')?.addEventListener('click', event => {
      const toggle = event.target.closest('[data-toggle-group]');
      if (toggle) {
        const id = toggle.getAttribute('data-toggle-group');
        state.groups = state.groups.map(group => (
          group.id === id ? { ...group, expanded: !group.expanded } : group
        ));
        render();
        return;
      }
      const ungroupBtn = event.target.closest('[data-ungroup]');
      if (ungroupBtn) ungroupSelected([ungroupBtn.getAttribute('data-ungroup')]);
    });
    $('revenueRegionBody')?.addEventListener('change', event => {
      const fix = event.target.closest('[data-region-fix]');
      if (fix) {
        applyRegionFix(fix.getAttribute('data-region-fix') || '', fix.value);
        return;
      }
      if (!event.target.matches('[data-region-supply], [data-region-vat]')) return;
      const parsed = parseMoneyText(event.target.value);
      event.target.value = parsed ? String(parsed) : '';
      collectDraftFromInputs();
      refreshCalculated();
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

    if (!state.weekStart) {
      state.weekStart = weekStartKey();
      state.followLatestIfEmpty = true;
    }
    loadSavedDraft(state.weekStart);
    await loadSettlementData();
  }

  function setWeekStart(value) {
    collectDraftFromInputs();
    const next = weekStartKey(value || today());
    const calendarWeek = weekStartKey();
    if (state.lockedWeek && next === calendarWeek && state.lockedWeek !== calendarWeek) {
      state.weekStart = state.lockedWeek;
      state.followLatestIfEmpty = false;
      loadSavedDraft(state.weekStart);
      void loadSettlementData();
      return;
    }
    if (next !== calendarWeek) state.lockedWeek = next;
    state.followLatestIfEmpty = next === calendarWeek && !state.lockedWeek;
    state.weekStart = next;
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
    splitPasteLine,
    parseMoneyText,
    computeRemain,
    usageRatio,
    summarizeBundle,
    clearAmounts,
    handlePaste,
    addRowsToDraft,
    applyRegionFix,
    rematchDraftToSettlements,
    applyPreview
  };
})();

// 세무관리 — 원천세 신고용 월별 지급합계 집계
// 엑셀 양식 v2: 이름·지급합계·ERPID·쿠팡ID·배민ID (주민번호 없음)
const BremTaxManagementAdmin = (function () {
  const $ = selector => document.querySelector(selector);
  const Calc = () => window.BremDirectSettlementCalc;

  const state = {
    month: '',
    excludedSettlementIds: new Set(),
    calculated: null
  };

  let monthPicker = null;

  function escapeHtml(value) {
    return Calc().escapeHtml(value);
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
  }

  function formatMonthLabel(value) {
    if (window.BremDatePicker?.formatMonthLabel) {
      return window.BremDatePicker.formatMonthLabel(value, '월 선택');
    }
    if (!value) return '월 선택';
    const [year, month] = String(value).split('-');
    return `${year}년 ${month}월`;
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function platformLabel(platform) {
    return platform === 'coupang' ? '쿠팡' : '배민';
  }

  function currentMonthKey() {
    return window.BremDatePicker?.currentMonth?.()
      || new Date().toISOString().slice(0, 7);
  }

  /** 정산주(수요일)가 속한 달. 지급일이 다음 달이어도 그 주로 묶는다. */
  function recordMonthKey(record) {
    const week = Calc().settlementWeek(record).slice(0, 7);
    return /^\d{4}-\d{2}$/.test(week) ? week : '';
  }

  function allSettlements() {
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .slice()
      .sort((a, b) => (
        String(b.startDate || '').localeCompare(String(a.startDate || ''))
        || String(a.platform || '').localeCompare(String(b.platform || ''))
        || String(a.region || '').localeCompare(String(b.region || ''), 'ko-KR')
      ));
  }

  function ensureMonth() {
    if (state.month) return state.month;
    const latest = allSettlements()[0];
    state.month = latest ? recordMonthKey(latest) : currentMonthKey();
    return state.month;
  }

  function monthSettlements() {
    const month = ensureMonth();
    return allSettlements().filter(record => recordMonthKey(record) === month);
  }

  function checkedSettlements() {
    return monthSettlements().filter(record => !state.excludedSettlementIds.has(String(record.id)));
  }

  function clearCalculated() {
    state.calculated = null;
  }

  function setMonth(value) {
    const next = String(value || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(next)) return;
    if (next === state.month) return;
    state.month = next;
    state.excludedSettlementIds.clear();
    clearCalculated();
    render();
  }

  function shiftMonth(deltaMonths) {
    const base = ensureMonth();
    const [year, month] = base.split('-').map(Number);
    const date = new Date(year, month - 1 + deltaMonths, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthPicker?.setMonth?.(next);
    setMonth(next);
  }

  function driverExportIds(driverId, row = {}) {
    const id = String(driverId || '').trim();
    const driver = id ? window.BremStorage?.drivers?.getById?.(id) : null;
    const utils = window.BremDriverUtils;
    const erpId = utils?.makeDriverLoginId?.(driver) || '';
    const coupangId = utils?.getErpCoupangId?.(driver)
      || String(driver?.coupangId || driver?.coupangLoginKey || '').trim()
      || '';
    const baeminId = String(driver?.baeminId || driver?.raw_data?.baeminId || '').trim()
      || '';
    // 정산서 매칭 ID 보조 (기사 DB에 없을 때)
    const labels = String(row.idLabel || '').split('/').map(s => s.trim()).filter(s => s && s !== '-');
    const coupangFromRow = labels.find(l => /[가-힣a-zA-Z]/.test(l) && /\d{3,}$/.test(l.replace(/\s/g, '')));
    const baeminFromRow = labels.find(l => /^\d+$/.test(l.replace(/\s/g, '')));
    return {
      erpId,
      coupangId: coupangId || coupangFromRow || '',
      baeminId: baeminId || baeminFromRow || ''
    };
  }

  function buildRowsFromSettlements(settlements) {
    return Calc().buildGrossPayTotals(settlements).map(row => ({
      ...row,
      ...driverExportIds(row.driverId, row)
    }));
  }

  function renderMonthButton() {
    const label = $('#taxManagementMonthLabel');
    const hidden = $('#taxManagementMonth');
    const month = ensureMonth();
    if (label) label.textContent = formatMonthLabel(month);
    if (hidden) hidden.value = month;
  }

  function renderSettlementPicker() {
    const listEl = $('#taxManagementSettlementList');
    const rangeEl = $('#taxManagementMonthRange');
    if (!listEl) return;

    const list = monthSettlements();
    const monthLabel = formatMonthLabel(ensureMonth());
    if (rangeEl) {
      rangeEl.textContent = list.length
        ? `${monthLabel} · 직계약 정산서 ${list.length}건 — 신고에 포함할 정산서를 고르세요`
        : `${monthLabel}에 해당하는 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」을 확인하세요.`;
    }

    if (!list.length) {
      listEl.innerHTML = '<p class="empty">이 달에 해당하는 정산서가 없습니다.</p>';
      const allChk = $('#taxManagementSettlementAll');
      if (allChk) allChk.checked = false;
      return;
    }

    const cardHtml = record => {
      const id = String(record.id);
      const checked = !state.excludedSettlementIds.has(id);
      const riders = Array.isArray(record.riders) ? record.riders.length : 0;
      const region = record.region ? ` · ${escapeHtml(record.region)}` : '';
      const file = record.fileName ? `<span class="muted-inline">${escapeHtml(record.fileName)}</span>` : '';
      const payNote = record.paymentDate
        ? `<span class="muted-inline">지급 ${formatDate(record.paymentDate)}</span>`
        : '';
      return `
        <label class="final-deposit-settlement">
          <input type="checkbox" data-tax-settlement="${escapeHtml(id)}"${checked ? ' checked' : ''}>
          <span class="final-deposit-settlement-body">
            <strong>${escapeHtml(platformLabel(record.platform))}</strong>${region}
            <span class="muted-inline">${formatDate(record.startDate)} ~ ${formatDate(record.endDate)} · ${formatNumber(riders)}명</span>
            ${payNote}
            ${file}
          </span>
        </label>`;
    };

    const groupHtml = (platform, label) => {
      const items = list.filter(r => Calc().normalizePlatform(r.platform) === platform);
      if (!items.length) return '';
      return `
        <div class="final-deposit-settlement-group">
          <p class="final-deposit-settlement-group-head">${label} 정산서 · ${items.length}건</p>
          <div class="final-deposit-settlement-grid">${items.map(cardHtml).join('')}</div>
        </div>`;
    };
    listEl.innerHTML = groupHtml('coupang', '쿠팡') + groupHtml('baemin', '배민');

    const allChk = $('#taxManagementSettlementAll');
    if (allChk) allChk.checked = list.every(record => !state.excludedSettlementIds.has(String(record.id)));
  }

  function renderTable() {
    const body = $('#taxManagementRows');
    const summary = $('#taxManagementSummary');
    const exportBtn = $('#taxManagementExportBtn');
    const calcBtn = $('#taxManagementCalculateBtn');
    if (!body) return;

    const selectedCount = checkedSettlements().length;
    if (calcBtn) calcBtn.disabled = selectedCount <= 0;

    if (!state.calculated) {
      if (summary) {
        summary.textContent = selectedCount
          ? `정산서 ${selectedCount}건 선택됨 · 「계산하기」를 눌러 지급합계를 집계하세요.`
          : '신고월을 고른 뒤 정산서를 선택하고 「계산하기」를 누르세요.';
      }
      if (exportBtn) exportBtn.disabled = true;
      body.innerHTML = '<tr><td colspan="6" class="empty">월 선택 → 정산서 선택 → 계산하기</td></tr>';
      return;
    }

    const { settlements, rows } = state.calculated;
    const totalGross = rows.reduce((sum, row) => sum + Number(row.grossPay || 0), 0);
    const missingIds = rows.filter(row => !row.erpId && !row.coupangId && !row.baeminId).length;

    if (summary) {
      summary.textContent = `${formatMonthLabel(ensureMonth())} · 선택 정산서 ${settlements.length}건`
        + ` · 기사 ${formatNumber(rows.length)}명 · 지급합계 합 ${formatNumber(totalGross)}원`
        + (missingIds ? ` · ID 미확인 ${formatNumber(missingIds)}명` : '');
    }

    if (exportBtn) exportBtn.disabled = !rows.length;

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">집계할 기사가 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td class="weekly-amount-cell">${formatNumber(row.grossPay)}</td>
        <td class="muted-inline">${escapeHtml(row.erpId || '-')}</td>
        <td class="muted-inline">${escapeHtml(row.coupangId || '-')}</td>
        <td class="muted-inline">${escapeHtml(row.baeminId || '-')}</td>
        <td class="muted-inline">${escapeHtml(row.platformLabel || '-')}</td>
      </tr>`).join('');
  }

  function render() {
    renderMonthButton();
    renderSettlementPicker();
    renderTable();
  }

  async function calculate() {
    const settlements = checkedSettlements();
    if (!settlements.length) {
      showToast('정산서를 하나 이상 선택하세요.');
      return;
    }
    await window.BremStorage?.ensureSectionLoaded?.('tax-management');
    const rows = buildRowsFromSettlements(settlements);
    state.calculated = { settlements, rows };
    renderTable();
    const totalGross = rows.reduce((sum, row) => sum + Number(row.grossPay || 0), 0);
    showToast(`기사 ${formatNumber(rows.length)}명 · 지급합계 ${formatNumber(totalGross)}원 집계했습니다.`);
  }

  function exportExcel() {
    const rows = state.calculated?.rows || [];
    if (!rows.length) {
      showToast('먼저 「계산하기」로 집계하세요.');
      return;
    }
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const month = ensureMonth();
    const sheetRows = rows.map(row => [
      String(row.name || '').trim(),
      Number(row.grossPay || 0),
      row.erpId || '',
      row.coupangId || '',
      row.baeminId || ''
    ]);
    const ws = window.XLSX.utils.aoa_to_sheet([
      ['이름', '지급합계', 'ERPID', '쿠팡ID', '배민ID'],
      ...sheetRows
    ]);
    ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '원천세신고');
    window.XLSX.writeFile(wb, `원천세신고_${month}.xlsx`);
    showToast(`엑셀 ${formatNumber(rows.length)}명 · 이름·지급합계·ID 5열`);
  }

  function setupMonthPicker() {
    if (setupMonthPicker.bound || !window.BremDatePicker?.setupMonthSingle) return;
    setupMonthPicker.bound = true;
    monthPicker = window.BremDatePicker.setupMonthSingle({
      popup: $('#taxManagementMonthCalendar'),
      monthsContainer: $('#taxManagementMonthGrid'),
      titleEl: $('#taxManagementMonthTitle'),
      prevBtn: $('#taxManagementMonthPrev'),
      nextBtn: $('#taxManagementMonthNext'),
      todayBtn: $('#taxManagementMonthThisMonth'),
      hiddenInput: $('#taxManagementMonth'),
      openButton: $('#taxManagementMonthBtn'),
      labelEl: $('#taxManagementMonthLabel'),
      emptyLabel: '월 선택',
      onSelect(value) {
        setMonth(value);
      }
    });
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('#taxManagementMonthPrevBtn')?.addEventListener('click', () => shiftMonth(-1));
    $('#taxManagementMonthNextBtn')?.addEventListener('click', () => shiftMonth(1));
    $('#taxManagementReloadBtn')?.addEventListener('click', () => { void reload(); });
    $('#taxManagementCalculateBtn')?.addEventListener('click', () => { void calculate(); });
    $('#taxManagementExportBtn')?.addEventListener('click', exportExcel);

    const section = $('#tax-management');
    if (!section) return;

    section.addEventListener('change', event => {
      const settlementChk = event.target.closest('[data-tax-settlement]');
      if (settlementChk) {
        const id = String(settlementChk.dataset.taxSettlement);
        if (settlementChk.checked) state.excludedSettlementIds.delete(id);
        else state.excludedSettlementIds.add(id);
        clearCalculated();
        render();
        return;
      }
      if (event.target.id === 'taxManagementSettlementAll') {
        if (event.target.checked) state.excludedSettlementIds.clear();
        else monthSettlements().forEach(record => state.excludedSettlementIds.add(String(record.id)));
        clearCalculated();
        render();
      }
    });
  }

  async function reload() {
    await window.BremStorage?.ensureSectionLoaded?.('tax-management');
    clearCalculated();
    render();
    showToast('세무관리 데이터를 다시 불러왔습니다.');
  }

  async function refresh() {
    if (!$('#taxManagementRows')) return;
    setupMonthPicker();
    ensureMonth();
    monthPicker?.setMonth?.(ensureMonth());
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('tax-management');
    render();
  }

  function init() {
    if (!$('#taxManagementRows')) return;
    setupMonthPicker();
    bindEvents();
  }

  return { init, refresh, onMonthPicked: setMonth };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremTaxManagementAdmin.init();
});

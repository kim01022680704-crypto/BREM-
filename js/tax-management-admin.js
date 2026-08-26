// 세무관리 — 원천세 신고용 지급합계 집계
const BremTaxManagementAdmin = (function () {
  const $ = selector => document.querySelector(selector);
  const Calc = () => window.BremDirectSettlementCalc;

  const state = {
    week: '',
    excludedSettlementIds: new Set()
  };

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

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function platformLabel(platform) {
    return platform === 'coupang' ? '쿠팡' : '배민';
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

  function weekSettlements() {
    const week = ensureWeek();
    return allSettlements().filter(record => Calc().settlementWeek(record) === week);
  }

  function checkedSettlements() {
    return weekSettlements().filter(record => !state.excludedSettlementIds.has(String(record.id)));
  }

  function ensureWeek() {
    if (state.week) return state.week;
    const latest = allSettlements()[0];
    state.week = latest ? Calc().settlementWeek(latest) : Calc().weekStartKey();
    return state.week;
  }

  function setWeek(value) {
    const next = value ? Calc().weekStartKey(value) : Calc().weekStartKey();
    if (next === state.week) return;
    state.week = next;
    state.excludedSettlementIds.clear();
    void refresh();
  }

  function shiftWeek(deltaWeeks) {
    const base = ensureWeek();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + deltaWeeks * 7);
    setWeek(Calc().dateKey(date));
  }

  function residentNumberForDriver(driverId) {
    const id = String(driverId || '').trim();
    if (!id) return '';
    const driver = window.BremStorage?.drivers?.getById?.(id);
    if (!driver) return '';
    if (driver.hiddenFields?.residentNumber) return '';
    const raw = driver.residentNumber || driver.raw_data?.residentNumber || '';
    return window.BremDriverUtils?.formatResidentNumber?.(raw) || String(raw || '').trim();
  }

  function aggregateRows() {
    const settlements = checkedSettlements();
    if (!settlements.length) return { settlements, rows: [] };
    const rows = Calc().buildGrossPayTotals(settlements).map(row => ({
      ...row,
      residentNumber: residentNumberForDriver(row.driverId)
    }));
    return { settlements, rows };
  }

  function renderWeekButton() {
    const btn = $('#taxManagementWeekBtn');
    if (btn) btn.textContent = `${formatDate(ensureWeek())}(수) 주`;
    const hidden = $('#taxManagementWeek');
    if (hidden) hidden.value = ensureWeek();
  }

  function renderSettlementPicker() {
    const listEl = $('#taxManagementSettlementList');
    const rangeEl = $('#taxManagementWeekRange');
    if (!listEl) return;

    const list = weekSettlements();
    if (rangeEl) {
      rangeEl.textContent = list.length
        ? `정산주 ${formatDate(ensureWeek())}(수) · 정산서 ${list.length}건 — 체크한 정산서만 지급합계에 합산됩니다`
        : `${formatDate(ensureWeek())}(수) 주에 저장된 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」에서 먼저 저장하세요.`;
    }

    if (!list.length) {
      listEl.innerHTML = '<p class="empty">이 주에 저장된 직계약 정산서가 없습니다.</p>';
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
      return `
        <label class="final-deposit-settlement">
          <input type="checkbox" data-tax-settlement="${escapeHtml(id)}"${checked ? ' checked' : ''}>
          <span class="final-deposit-settlement-body">
            <strong>${escapeHtml(platformLabel(record.platform))}</strong>${region}
            <span class="muted-inline">${formatDate(record.startDate)} ~ ${formatDate(record.endDate)} · ${formatNumber(riders)}명</span>
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
    if (!body) return;

    const { settlements, rows } = aggregateRows();
    const totalGross = rows.reduce((sum, row) => sum + Number(row.grossPay || 0), 0);
    const missingResident = rows.filter(row => !row.residentNumber).length;

    if (summary) {
      if (!settlements.length) {
        summary.textContent = '정산서를 선택하면 기사별 지급합계가 표시됩니다.';
      } else if (!rows.length) {
        summary.textContent = '선택한 정산서에 집계할 기사가 없습니다.';
      } else {
        summary.textContent = `선택 정산서 ${settlements.length}건 · 기사 ${formatNumber(rows.length)}명`
          + ` · 지급합계 합 ${formatNumber(totalGross)}원`
          + (missingResident ? ` · 주민번호 미등록 ${formatNumber(missingResident)}명` : '');
      }
    }

    if (exportBtn) exportBtn.disabled = !rows.length;

    if (!settlements.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">정산서를 선택하세요.</td></tr>';
      return;
    }
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">집계할 기사가 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong></td>
        <td>${escapeHtml(row.residentNumber || '-')}</td>
        <td class="weekly-amount-cell">${formatNumber(row.grossPay)}</td>
        <td class="muted-inline">${escapeHtml(row.platformLabel || '-')}</td>
      </tr>`).join('');
  }

  function render() {
    renderWeekButton();
    renderSettlementPicker();
    renderTable();
  }

  function exportExcel() {
    const { rows } = aggregateRows();
    if (!rows.length) {
      showToast('보낼 데이터가 없습니다. 정산서를 선택하세요.');
      return;
    }
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return;
    }
    const week = ensureWeek();
    const sheetRows = rows.map(row => [
      String(row.name || '').trim(),
      row.residentNumber || ''
    ]);
    const ws = window.XLSX.utils.aoa_to_sheet([['이름', '주민번호'], ...sheetRows]);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, '원천세신고');
    window.XLSX.writeFile(wb, `원천세신고_${week}.xlsx`);
    showToast(`엑셀 ${formatNumber(rows.length)}명보냈습니다.`);
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('#taxManagementWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#taxManagementWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    $('#taxManagementReloadBtn')?.addEventListener('click', () => { void reload(); });
    $('#taxManagementExportBtn')?.addEventListener('click', exportExcel);

    const section = $('#tax-management');
    if (!section) return;

    section.addEventListener('change', event => {
      const settlementChk = event.target.closest('[data-tax-settlement]');
      if (settlementChk) {
        const id = String(settlementChk.dataset.taxSettlement);
        if (settlementChk.checked) state.excludedSettlementIds.delete(id);
        else state.excludedSettlementIds.add(id);
        render();
        return;
      }
      if (event.target.id === 'taxManagementSettlementAll') {
        if (event.target.checked) state.excludedSettlementIds.clear();
        else weekSettlements().forEach(record => state.excludedSettlementIds.add(String(record.id)));
        render();
      }
    });
  }

  async function reload() {
    await window.BremStorage?.ensureSectionLoaded?.('tax-management');
    render();
    showToast('세무관리 데이터를 다시 불러왔습니다.');
  }

  async function refresh() {
    if (!$('#taxManagementRows')) return;
    ensureWeek();
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('tax-management');
    render();
  }

  function init() {
    if (!$('#taxManagementRows')) return;
    bindEvents();
  }

  return { init, refresh, onWeekPicked: setWeek };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremTaxManagementAdmin.init();
});

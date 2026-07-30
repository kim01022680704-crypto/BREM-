const BremSettlementResultDirect = (function () {
  const $ = selector => document.querySelector(selector);
  // 지급내역·공제내역 정의와 계산은 「최종입금」과 공유한다. (js/direct-settlement-calc.js)
  const Calc = () => window.BremDirectSettlementCalc;

  // week: 빈 문자열이면 주 필터 없음(전체 주). 정산주는 항상 수요일 시작.
  const state = { platform: 'baemin', settlementId: '', week: '', withdrawals: [] };

  function escapeHtml(value) {
    return Calc().escapeHtml(value);
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function dateKey(date) {
    return Calc().dateKey(date);
  }

  function weekStartKey(dateValue) {
    return Calc().weekStartKey(dateValue);
  }

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
  }

  function settlementWeek(record) {
    return Calc().settlementWeek(record);
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
      setDeleteButtonsEnabled(false);
      if (info) {
        const total = platformSettlements().length;
        info.textContent = state.week && total
          ? `${formatDate(state.week)}(수) 주에 저장된 정산서가 없습니다. 다른 주를 고르거나 「전체 주」를 누르세요. (전체 ${total}건)`
          : '「주정산서 업로드 (직계약)」에서 정산서를 먼저 저장하세요.';
      }
      return;
    }

    select.disabled = false;
    setDeleteButtonsEnabled(true);
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

  function setDeleteButtonsEnabled(enabled) {
    const deleteBtn = $('#settlementResultDeleteBtn');
    const deleteWeekBtn = $('#settlementResultDeleteWeekBtn');
    if (deleteBtn) deleteBtn.disabled = !enabled;
    if (deleteWeekBtn) deleteWeekBtn.disabled = !enabled;
  }

  // 정산결과 화면에서 「처음부터」다시 할 때 쓰는 삭제.
  // 정산서 + 업로드 로그 + 그 정산서에 붙인 프로모션/기타지급까지 지운다.
  async function deleteCurrentSettlement() {
    const settlement = currentSettlement();
    if (!settlement) {
      showToast('삭제할 정산서가 없습니다.');
      return;
    }
    const platform = state.platform === 'coupang' ? '쿠팡' : '배민';
    const riders = Array.isArray(settlement.riders) ? settlement.riders.length : 0;
    const ok = window.confirm(
      `${platform} 정산서를 삭제할까요?\n`
      + `${formatDate(settlement.startDate)} ~ ${formatDate(settlement.endDate)}`
      + `${settlement.region ? ` · ${settlement.region}` : ''} · ${riders}명\n\n`
      + '주정산서·업로드 기록·이 정산서에 등록한 BREM프로모션/기타지급도 함께 지워집니다.\n'
      + '최종입금에서도 사라지고, 「주정산서 업로드 (직계약)」에서 처음부터 다시 올릴 수 있습니다.'
    );
    if (!ok) return;

    try {
      await BremWeeklySettlement.deleteDirectSettlementCascade(settlement.id);
    } catch (error) {
      console.error('[BREM] settlement-result delete failed:', error);
      showToast(error.message || '정산서 삭제에 실패했습니다.');
      await refresh(state.platform);
      return;
    }
    state.settlementId = '';
    notifyRelatedScreens();
    await loadWithdrawals();
    render();
    showToast('정산서를 삭제했습니다. 주정산서 업로드(직계약)에서 다시 올리세요.');
  }

  // 지금 고른 정산주의 같은 플랫폼 정산서를 전부 지운다.
  async function deleteWeekSettlements() {
    const week = ensureWeek();
    const list = platformSettlements().filter(record => settlementWeek(record) === week);
    if (!list.length) {
      showToast('이 주에 삭제할 정산서가 없습니다.');
      return;
    }
    const platform = state.platform === 'coupang' ? '쿠팡' : '배민';
    const ok = window.confirm(
      `${platform} · ${formatDate(week)}(수) 주 정산서 ${list.length}건을 모두 삭제할까요?\n\n`
      + '주정산서·업로드 기록·프로모션/기타지급도 함께 지워집니다.\n'
      + '처음부터 다시 업로드할 수 있습니다.'
    );
    if (!ok) return;

    try {
      for (const record of list) {
        await BremWeeklySettlement.deleteDirectSettlementCascade(record.id);
      }
    } catch (error) {
      console.error('[BREM] settlement-result week delete failed:', error);
      showToast(error.message || '정산서 삭제에 실패했습니다.');
      await refresh(state.platform);
      return;
    }
    state.settlementId = '';
    notifyRelatedScreens();
    await loadWithdrawals();
    render();
    showToast(`${platform} ${formatDate(week)}(수) 주 정산서 ${list.length}건을 삭제했습니다.`);
  }

  function notifyRelatedScreens() {
    if (typeof BremWeeklySettlementAdmin !== 'undefined') {
      BremWeeklySettlementAdmin.refresh?.('direct');
    }
    if (typeof BremPromotionApplyAdmin !== 'undefined') BremPromotionApplyAdmin.refresh?.();
    if (typeof BremDirectAdjustmentAdmin !== 'undefined') {
      BremDirectAdjustmentAdmin.refresh?.(state.platform);
    }
    if (typeof BremFinalDeposit !== 'undefined') void BremFinalDeposit.refresh?.();
  }

  // --- 계산 ---------------------------------------------------------------

  function computeRows() {
    const settlement = currentSettlement();
    if (!settlement) return [];
    // 쿠팡 출금 → 쿠팡 정산만, 배민 출금 → 배민 정산만.
    // 한쪽에 몰아 넣고 남은 금액을 반대편에서 까지 않는다.
    return Calc().sortByName(Calc().computeRows(settlement, {
      withdrawals: state.withdrawals
    }));
  }

  // 쿠팡·배민 열을 통일했다. 한쪽에만 있는 항목(배민 추가지급, 쿠팡 차감내역)도
  // 0으로 보여주어 두 플랫폼 표가 같은 모양이 되게 한다.
  function columns() {
    return Calc().COLUMNS;
  }

  function renderHead() {
    const head = $('#settlementResultHead');
    if (!head) return;
    head.innerHTML = Calc().theadHtml(columns());
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

    const totals = Calc().sumRows(rows);
    const cols = columns();
    body.innerHTML = rows.map(row => `
      <tr>${cols.map(col => cellHtml(col, row)).join('')}</tr>`).join('');

    if (summaryEl) {
      // 선정산은 처리완료 실금액을 그대로 반영한다(총지급액이 음수여도 표기).
      // "한도초과" 개념은 쓰지 않는다. 다만 플랫폼 태그가 없어 어느 쪽에도
      // 매칭 못 한 출금만 별도로 알린다(쿠팡/배민 매칭 누락 방지).
      const untagged = Number(totals.untaggedWithdrawalCount || 0);
      const untaggedNote = untagged
        ? ` · <span class="muted-inline">플랫폼 미지정 출금 <strong>${untagged}</strong>건(${formatNumber(totals.untaggedWithdrawalAmount)}원)은 매칭 안 됨 — 출금내역에서 쿠팡/배민 지정 필요</span>`
        : '';
      summaryEl.innerHTML = `대상 <strong>${rows.length}</strong>명 · 지급합계 <strong>${formatNumber(totals.grossPay)}</strong> · 공제합계 <strong>${formatNumber(totals.deductTotal)}</strong> · 총지급액 <strong>${formatNumber(totals.netPay)}</strong>원`
        + ` <span class="muted-inline">(불러온 BREM프로모션 ${formatNumber(totals.promo)} · 기타지급 ${formatNumber(totals.other)} · 선정산(처리완료) ${formatNumber(totals.prepaid)})</span>`
        + untaggedNote;
    }
  }

  // 엑셀에는 원본 값이 나가야 하므로 태그는 화면 렌더에서만 씌운다.
  function cellHtml(col, row) {
    if (col.tag) return `<td class="settle-col-${col.group}"><span class="weekly-id-tag">${escapeHtml(row[col.key])}</span></td>`;
    const value = col.money === false ? escapeHtml(row[col.key]) : formatNumber(row[col.key]);
    const classes = [`settle-col-${col.group}`];
    if (col.money !== false) classes.push('weekly-amount-cell');
    if (col.note) classes.push('settle-col-note');
    return `<td class="${classes.join(' ')}">${col.strong ? `<strong>${value}</strong>` : value}</td>`;
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
    $('#settlementResultDeleteBtn')?.addEventListener('click', () => { void deleteCurrentSettlement(); });
    $('#settlementResultDeleteWeekBtn')?.addEventListener('click', () => { void deleteWeekSettlements(); });
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

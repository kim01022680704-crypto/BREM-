const BremSettlementResultDirect = (function () {
  const $ = selector => document.querySelector(selector);
  // 지급내역·공제내역 정의와 계산은 「최종입금」과 공유한다. (js/direct-settlement-calc.js)
  const Calc = () => window.BremDirectSettlementCalc;

  // week: 빈 문자열이면 주 필터 없음(전체 주). 정산주는 항상 수요일 시작.
  // viewMode: platform | final | retroUnpaid
  const state = {
    platform: 'baemin',
    settlementId: '',
    week: '',
    withdrawals: [],
    viewMode: 'platform',
    retroWeekFilter: '',
    retroSearch: ''
  };

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
    const label = state.week ? `${formatDate(state.week)}(수) 주` : '전체 주';
    const btn = $('#settlementResultWeekBtn');
    if (btn) btn.textContent = label;
    // 최종결산 카드에도 같은 정산주를 표시한다.
    const finalBtn = $('#settlementFinalWeekBtn');
    if (finalBtn) finalBtn.textContent = state.week ? label : '수요일 선택';
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

  // 이 주의 쿠팡+배민 직계약 정산서 전체 (스필오버 한도 계산용)
  function weekAllPlatformSettlements(settlement) {
    const week = settlementWeek(settlement);
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => settlementWeek(record) === week);
  }

  function computeRows() {
    const settlement = currentSettlement();
    if (!settlement) return [];
    // 각 플랫폼 실지급 한도까지 선정산을 잡고 초과분은 반대 플랫폼으로 넘긴다(스필오버).
    // 한 사람의 쿠팡/배민 정산서를 함께 넘겨 사람 단위로 배분한다.
    return Calc().sortByName(Calc().computeRows(settlement, {
      withdrawals: state.withdrawals,
      weekSettlements: weekAllPlatformSettlements(settlement)
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
    // 최종결산 카드가 열려 있으면 정산주 변경 시 함께 갱신한다.
    if (!$('#settlementFinalCard')?.hidden) renderFinal();
    const settlement = currentSettlement();
    const colspan = columns().length;

    if (!settlement) {
      const total = platformSettlements().length;
      const platformKo = state.platform === 'coupang' ? '쿠팡' : '배민';
      let emptyMsg = `이 플랫폼(${platformKo})에 저장된 직계약 정산서가 없습니다. (주정산서 업로드 · 직계약 확인)`;
      if (state.week && total > 0) {
        emptyMsg = `${formatDate(state.week)}(수) 주 · ${platformKo} 직계약 정산서가 없습니다. `
          + `다른 주를 고르거나 「전체 주」를 누르세요. (${platformKo} 전체 ${total}건)`;
      } else if (!state.week && total <= 0) {
        emptyMsg = `${platformKo} 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」에서 먼저 저장하세요.`;
      }
      body.innerHTML = `<tr><td colspan="${colspan}" class="empty">${escapeHtml(emptyMsg)}</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    try {
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
        // 선정산(처리완료)은 이 플랫폼에서 실제 출금한 금액을 그대로 공제한다.
        // 다 못 빼면 총지급액이 음수로 표기된다. 플랫폼 미지정 출금은 반영 못 하므로 알린다.
        const platformLabelKo = state.platform === 'coupang' ? '쿠팡' : '배민';
        const negative = Number(totals.negativeNetCount || 0);
        const untagged = Number(totals.untaggedWithdrawalCount || 0);
        const notes = [];
        if (negative) {
          notes.push(`총지급액 음수 <strong>${negative}</strong>명(선정산이 지급액보다 큼 — 정상 표기)`);
        }
        if (untagged) {
          notes.push(`플랫폼 미지정 출금 <strong>${untagged}</strong>건(${formatNumber(totals.untaggedWithdrawalAmount)}원) 미반영 — 출금내역에서 쿠팡/배민 지정 필요`);
        }
        const extraNote = notes.length ? ` · <span class="muted-inline">${notes.join(' · ')}</span>` : '';
        const negativeCount = rows.filter(r => Math.round(Number(r.netPay || 0)) < 0).length;
        const negNote = negativeCount
          ? ` · <span class="muted-inline">총지급액 음수 <strong>${negativeCount}</strong>명 — 「마이너스 일괄 맞추기」로 0원 처리 가능</span>`
          : '';
        summaryEl.innerHTML = `대상 <strong>${rows.length}</strong>명 · 지급합계 <strong>${formatNumber(totals.grossPay)}</strong> · 공제합계 <strong>${formatNumber(totals.deductTotal)}</strong> · 총지급액 <strong>${formatNumber(totals.netPay)}</strong>원`
          + ` <span class="muted-inline">(BREM프로모션 ${formatNumber(totals.promo)} · 기타지급 ${formatNumber(totals.other)} · ${platformLabelKo} 선정산(처리완료) ${formatNumber(totals.prepaid)} · 리스차감 ${formatNumber(totals.leaseFee)} · 대여차감 ${formatNumber(totals.loanFee)})</span>`
          + extraNote + negNote;
      }

      if (state.viewMode === 'retroUnpaid') renderRetro();
      if (state.viewMode === 'final') renderFinal();
    } catch (error) {
      console.error('[settlement-result-direct] render failed', error);
      body.innerHTML = `<tr><td colspan="${colspan}" class="empty">정산 계산 중 오류가 발생했습니다. 새로고침 후에도 같으면 관리자에게 알려주세요. (${escapeHtml(error?.message || error)})</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      showToast(error?.message || '정산결과 표시에 실패했습니다.');
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

  // 마이너스(총지급액<0) 를 0으로 만들기 위해 기타지급에 얹을 그로스업 금액.
  // 기타지급 X 를 올리면 프로모션원천세 3.3% 도 오르므로, 순증 = X*(1-0.033).
  // 스필오버에서도 선정산_A 는 고정이라 net' = net + X - Δ원천세 로 정확히 0에 도달한다.
  function grossUpForZero(row) {
    const net = Math.round(Number(row.netPay || 0));
    if (net >= 0) return 0;
    const promoPlusOther = Math.round(Number(row.promo || 0) + Number(row.other || 0));
    const curTax = Math.floor(promoPlusOther * 0.033);
    const start = Math.max(0, Math.floor(-net / (1 - 0.033)) - 5);
    for (let x = start; x <= start + 200; x += 1) {
      const newTax = Math.floor((promoPlusOther + x) * 0.033);
      const newNet = net + x - (newTax - curTax);
      if (newNet >= 0) return x;
    }
    return Math.ceil(-net / (1 - 0.033));
  }

  async function batchFixNegatives() {
    const settlement = currentSettlement();
    if (!settlement) { showToast('정산서를 먼저 선택하세요.'); return; }
    const rows = computeRows();
    const negatives = rows.filter(r => Math.round(Number(r.netPay || 0)) < 0 && r.driverId);
    if (!negatives.length) { showToast('마이너스(총지급액<0)인 기사가 없습니다.'); return; }

    const store = window.BremStorage?.directSettlementAdjustments;
    if (!store) { showToast('조정 저장소를 사용할 수 없습니다.'); return; }
    const otherMap = store.getSettlement('other', settlement.id) || {};
    const week = settlementWeek(settlement);

    const entries = [];
    const retro = [];
    negatives.forEach(row => {
      const x = grossUpForZero(row);
      if (x <= 0) return;
      const prev = otherMap[row.driverId] || {};
      entries.push({
        driverId: row.driverId,
        amount: Math.round(Number(prev.amount || 0)) + x, // 기존 기타지급 + 소급 그로스업
        driverName: row.name,
        baeminId: prev.baeminId || (state.platform === 'baemin' ? row.idLabel : ''),
        coupangId: prev.coupangId || (state.platform === 'coupang' ? row.idLabel : '')
      });
      const unpaidBalance = Math.abs(Math.round(Number(row.netPay || 0)));
      retro.push({
        driverId: row.driverId,
        name: row.name,
        idLabel: row.idLabel,
        platform: row.platform,
        amount: x,
        grossUpAmount: x,
        unpaidBalance,
        status: 'logged',
        reason: '',
        settlementId: settlement.id
      });
    });
    if (!entries.length) { showToast('맞출 금액이 없습니다.'); return; }

    const preview = retro.slice(0, 15)
      .map(r => `· ${r.name} (${r.idLabel}) 미납 ${formatNumber(r.unpaidBalance)}원 · 그로스업 +${formatNumber(r.amount)}원`);
    const more = retro.length > 15 ? `\n외 ${retro.length - 15}명` : '';
    const ok = window.confirm(
      [
        `${entries.length}명의 마이너스를 0원으로 맞춥니다.`,
        '마이너스만큼 기타지급을 올리고, 원천세 3.3%까지 반영(그로스업)합니다.',
        '총 출금액·선정산은 그대로이며, 「소급분 및 미납금」탭에 기록됩니다.',
        '차감관리 이관은 자동이 아닙니다. 탭에서 선택해 보내세요.',
        '',
        ...preview
      ].join('\n') + more + '\n\n적용할까요?'
    );
    if (!ok) return;

    store.applyEntries('other', settlement.id, entries);
    window.BremStorage?.directRetroAdjustments?.add?.(week, retro);
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    render();
    if (typeof BremFinalDeposit !== 'undefined') void BremFinalDeposit.refresh?.();
    showToast(`${entries.length}명 일괄 맞춤 완료 · 총지급액 0원 처리 (소급분 기록)`);
  }

  function retroStatusLabel(status) {
    if (status === 'sent_to_deduction') return '차감관리 이관';
    if (status === 'skipped') return '제외';
    return '기록됨';
  }

  function collectRetroRows() {
    const store = window.BremStorage?.directRetroAdjustments;
    const all = store?.getAll?.() || {};
    const q = String(state.retroSearch || '').trim().toLowerCase();
    const weekFilter = String(state.retroWeekFilter || '').slice(0, 10);
    const rows = [];
    Object.keys(all).sort((a, b) => b.localeCompare(a)).forEach(wk => {
      if (weekFilter && wk !== weekFilter) return;
      Object.entries(all[wk] || {}).forEach(([entryKey, r]) => {
        if (!r) return;
        const name = String(r.name || '');
        const idLabel = String(r.idLabel || '');
        if (q && !`${name} ${idLabel} ${r.driverId || ''}`.toLowerCase().includes(q)) return;
        rows.push({
          weekStart: wk,
          entryKey,
          ...r,
          unpaidBalance: Math.max(0, Math.round(Number(r.unpaidBalance != null ? r.unpaidBalance : 0))),
          grossUpAmount: Math.max(0, Math.round(Number(r.grossUpAmount != null ? r.grossUpAmount : r.amount || 0))),
          status: String(r.status || 'logged')
        });
      });
    });
    return rows;
  }

  function fillRetroWeekFilter() {
    const select = $('#settlementRetroWeekFilter');
    if (!select) return;
    const all = window.BremStorage?.directRetroAdjustments?.getAll?.() || {};
    const weeks = Object.keys(all).sort((a, b) => b.localeCompare(a));
    const current = state.retroWeekFilter || select.value || '';
    select.innerHTML = `<option value="">전체 주</option>${weeks.map(wk =>
      `<option value="${escapeHtml(wk)}"${wk === current ? ' selected' : ''}>${escapeHtml(wk)}(수)</option>`
    ).join('')}`;
    state.retroWeekFilter = select.value || '';
  }

  function renderRetro() {
    const body = $('#settlementResultRetroBody');
    const summaryEl = $('#settlementRetroSummary');
    if (!body) return;
    fillRetroWeekFilter();
    const rows = collectRetroRows();
    if (!rows.length) {
      body.innerHTML = '<p class="form-help">표시할 소급분·미납 내역이 없습니다. 「마이너스 일괄 맞추기」후 여기에 쌓입니다.</p>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    let unpaidSum = 0;
    let grossSum = 0;
    let sentCount = 0;
    rows.forEach(r => {
      unpaidSum += r.unpaidBalance;
      grossSum += r.grossUpAmount;
      if (r.status === 'sent_to_deduction') sentCount += 1;
    });
    if (summaryEl) {
      summaryEl.innerHTML = `표시 <strong>${rows.length}</strong>건 · 미납잔액 합 <strong>${formatNumber(unpaidSum)}</strong>원 · 그로스업 합 <strong>${formatNumber(grossSum)}</strong>원 · 이관됨 ${sentCount}건`;
    }

    const byWeek = new Map();
    rows.forEach(r => {
      if (!byWeek.has(r.weekStart)) byWeek.set(r.weekStart, []);
      byWeek.get(r.weekStart).push(r);
    });

    const weekBlocks = [...byWeek.entries()].map(([wk, list]) => {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
      const unpaidWeek = list.reduce((s, r) => s + r.unpaidBalance, 0);
      const rowsHtml = list.map(r => {
        const sent = r.status === 'sent_to_deduction';
        const checkDisabled = sent ? ' disabled' : '';
        const checkVal = `${escapeHtml(r.weekStart)}||${escapeHtml(r.entryKey)}`;
        return `
        <tr class="${sent ? 'settlement-retro-row--sent' : ''}">
          <td><input type="checkbox" class="settlement-retro-check" value="${checkVal}"${checkDisabled}></td>
          <td class="settlement-retro-name"><strong>${escapeHtml(r.name || '-')}</strong></td>
          <td class="settlement-retro-id">${escapeHtml(r.idLabel || '-')}</td>
          <td class="settlement-retro-platform">${escapeHtml(r.platform === 'coupang' ? '쿠팡' : (r.platform === 'baemin' ? '배민' : '-'))}</td>
          <td class="settlement-retro-amount weekly-amount-cell"><strong>${formatNumber(r.unpaidBalance)}</strong>원</td>
          <td class="settlement-retro-amount weekly-amount-cell">${formatNumber(r.grossUpAmount)}원</td>
          <td>${escapeHtml(r.reason || '-')}</td>
          <td>${escapeHtml(retroStatusLabel(r.status))}</td>
        </tr>`;
      }).join('');
      return `
        <div class="settlement-retro-week">
          <p class="settlement-retro-week-head"><strong>${escapeHtml(wk)}(수)</strong> 주 · ${list.length}건 · 미납합 <strong>${formatNumber(unpaidWeek)}</strong>원</p>
          <div class="table-wrap">
            <table class="weekly-settlement-saved-table settlement-retro-table">
              <thead>
                <tr>
                  <th><input type="checkbox" class="settlement-retro-check-all" data-week="${escapeHtml(wk)}" title="이 주 선택"></th>
                  <th class="settlement-retro-name">기사</th>
                  <th class="settlement-retro-id">아이디</th>
                  <th class="settlement-retro-platform">플랫폼</th>
                  <th class="settlement-retro-amount">미납잔액</th>
                  <th class="settlement-retro-amount">그로스업액(참고)</th>
                  <th>이유/메모</th>
                  <th>이관상태</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');

    body.innerHTML = weekBlocks;
    body.querySelectorAll('.settlement-retro-check-all').forEach(master => {
      master.addEventListener('change', () => {
        const week = master.getAttribute('data-week') || '';
        body.querySelectorAll('.settlement-retro-check:not([disabled])').forEach(cb => {
          if (String(cb.value || '').startsWith(`${week}||`)) cb.checked = master.checked;
        });
      });
    });
  }

  async function sendSelectedToDeduction() {
    const body = $('#settlementResultRetroBody');
    if (!body) return;
    const checked = [...body.querySelectorAll('.settlement-retro-check:checked:not([disabled])')];
    if (!checked.length) {
      showToast('이관할 건을 선택하세요.');
      return;
    }

    const selected = checked.map(cb => {
      const raw = String(cb.value || '');
      const sep = raw.indexOf('||');
      return { weekStart: raw.slice(0, sep), entryKey: raw.slice(sep + 2) };
    }).filter(x => x.weekStart && x.entryKey);

    const store = window.BremStorage?.directRetroAdjustments;
    const ledger = window.BremStorage?.deductionLedger;
    if (!store || !ledger) {
      showToast('저장소를 사용할 수 없습니다.');
      return;
    }

    const drivers = window.BremStorage?.drivers?.getAll?.() || [];
    const driverById = new Map(drivers.map(d => [String(d.id), d]));

    const previewRows = [];
    selected.forEach(({ weekStart, entryKey }) => {
      const entry = store.getWeek?.(weekStart)?.[entryKey];
      if (!entry) return;
      if (entry.status === 'sent_to_deduction') return;
      const unpaid = Math.max(0, Math.round(Number(entry.unpaidBalance || 0)));
      previewRows.push({ weekStart, entryKey, entry, unpaid });
    });
    if (!previewRows.length) {
      showToast('이관 가능한 선택 건이 없습니다. (이미 이관됐거나 데이터 없음)');
      return;
    }

    const defaultDaily = previewRows.length === 1 ? previewRows[0].unpaid : '';
    const dailyRaw = window.prompt(
      [
        `${previewRows.length}건을 차감관리(미납)로 보냅니다.`,
        '일 차감액을 입력하세요. (비우면 각 건의 미납잔액 전액 = 일 1회 완납 차감)',
        previewRows.slice(0, 8).map(p =>
          `· ${p.entry.name} 미납 ${formatNumber(p.unpaid)}원`
        ).join('\n')
      ].join('\n'),
      defaultDaily === '' ? '' : String(defaultDaily)
    );
    if (dailyRaw === null) return;
    const dailyOverride = String(dailyRaw).trim() === ''
      ? null
      : Math.max(0, Math.round(Number(String(dailyRaw).replace(/,/g, ''))));
    if (dailyOverride !== null && (!Number.isFinite(dailyOverride) || dailyOverride <= 0)) {
      showToast('일 차감액이 올바르지 않습니다.');
      return;
    }

    const ok = window.confirm(
      `${previewRows.length}건을 차감관리로 이관할까요?\n일 차감: ${dailyOverride == null ? '건별 미납잔액' : `${formatNumber(dailyOverride)}원`}`
    );
    if (!ok) return;

    let created = 0;
    let skipped = 0;
    for (const item of previewRows) {
      const sourceRef = `${item.weekStart}|${item.entryKey}`;
      const existing = ledger.findBySource?.('unpaid', sourceRef);
      if (existing || item.entry.status === 'sent_to_deduction' || item.entry.ledgerId) {
        skipped += 1;
        continue;
      }
      const unpaid = item.unpaid;
      if (unpaid <= 0) {
        skipped += 1;
        continue;
      }
      const dailyDeduct = dailyOverride != null ? Math.min(dailyOverride, unpaid) : unpaid;
      const driver = driverById.get(String(item.entry.driverId)) || null;
      const saved = ledger.save({
        kind: 'unpaid',
        sourceRef,
        driverId: item.entry.driverId,
        driverName: item.entry.name || driver?.name || '',
        driverPhone: driver?.phone || driver?.mobile || '',
        dailyDeduct,
        balance: unpaid,
        reason: item.entry.reason || `소급/미납 ${item.weekStart}`,
        deductionPlatform: item.entry.platform === 'baemin' ? 'baemin' : 'coupang',
        finalApplyEnabled: false,
        weekStart: item.weekStart,
        status: 'active'
      });
      store.updateEntry?.(item.weekStart, item.entryKey, {
        status: 'sent_to_deduction',
        ledgerId: saved.id
      });
      created += 1;
    }

    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    renderRetro();
    showToast(`차감관리 이관 ${created}건${skipped ? ` · 건너뜀 ${skipped}건` : ''}`);
  }

  // ── 최종결산 (그 주 전체, 쿠팡+배민, 합치지 않음) ────────────────────────
  function finalWeek() {
    const cur = currentSettlement();
    return state.week || (cur ? settlementWeek(cur) : weekStartKey());
  }

  function finalWeekSettlements() {
    const week = finalWeek();
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .filter(record => settlementWeek(record) === week);
  }

  // 그 주 모든 정산서(쿠팡+배민)의 라이더 행을 합치지 않고 모은다.
  function finalRows() {
    const settlements = finalWeekSettlements();
    const rows = [];
    const leaseConsumed = new Set();
    const loanConsumed = new Set();
    settlements.forEach(settlement => {
      Calc().computeRows(settlement, {
        withdrawals: state.withdrawals,
        weekSettlements: settlements,
        _leaseConsumed: leaseConsumed,
        _loanConsumed: loanConsumed
      }).forEach(r => rows.push(r));
    });
    // 쿠팡 먼저, 그다음 배민, 각 그룹 내 이름순
    return rows.sort((a, b) => {
      if (a.platform !== b.platform) return a.platform === 'coupang' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'ko');
    });
  }

  function renderFinal() {
    const head = $('#settlementFinalHead');
    const body = $('#settlementFinalRows');
    const summaryEl = $('#settlementFinalSummary');
    if (!body) return;

    const rows = finalRows();
    // 헤더: 기사 · 플랫폼 · ID + 정산 열들
    const cols = Calc().COLUMNS;
    if (head) {
      const lead = '<th rowspan="2">플랫폼</th>';
      head.innerHTML = Calc().theadHtml(cols, lead);
    }
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty">이 주에 저장된 직계약 정산서가 없습니다.</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      return;
    }
    body.innerHTML = rows.map(row => {
      const tag = row.platform === 'coupang'
        ? '<span class="settle-platform-tag settle-platform-tag--coupang">쿠팡</span>'
        : '<span class="settle-platform-tag settle-platform-tag--baemin">배민</span>';
      const cells = cols.map(col => {
        if (col.tag) return `<td class="settle-col-${col.group}"><span class="weekly-id-tag">${escapeHtml(row[col.key])}</span></td>`;
        const value = col.money === false ? escapeHtml(row[col.key]) : formatNumber(row[col.key]);
        const cls = [`settle-col-${col.group}`];
        if (col.money !== false) cls.push('weekly-amount-cell');
        return `<td class="${cls.join(' ')}">${col.strong ? `<strong>${value}</strong>` : value}</td>`;
      }).join('');
      return `<tr><td>${tag}</td>${cells}</tr>`;
    }).join('');

    if (summaryEl) {
      const t = Calc().sumRows(rows);
      const coupangCount = rows.filter(r => r.platform === 'coupang').length;
      const baeminCount = rows.filter(r => r.platform === 'baemin').length;
      summaryEl.innerHTML = `전체 <strong>${rows.length}</strong>줄 (쿠팡 ${coupangCount} · 배민 ${baeminCount})`
        + ` · 총프로모션 <strong>${formatNumber(t.promo)}</strong>`
        + ` · 총기타지급 <strong>${formatNumber(t.other)}</strong>`
        + ` · 총선정산 <strong>${formatNumber(t.prepaid)}</strong>`
        + ` · 총리스차감 <strong>${formatNumber(t.leaseFee)}</strong>`
        + ` · 총대여차감 <strong>${formatNumber(t.loanFee)}</strong>`
        + ` · 총콜수수료 <strong>${formatNumber(t.callFee)}</strong>`
        + ` · 총일정산수수료 <strong>${formatNumber(t.dailySettlementFee)}</strong>`
        + ` · <span class="final-deposit-total">총지급액 <strong>${formatNumber(t.netPay)}</strong>원</span>`;
    }
  }

  function setSettlementView(mode) {
    const next = mode === 'final' || mode === 'retroUnpaid' ? mode : 'platform';
    state.viewMode = next;
    const finalCard = $('#settlementFinalCard');
    const mainCard = $('#settlementResultMainCard');
    const retroCard = $('#settlementResultRetroCard');
    const finalTab = $('#settlementFinalTabBtn');
    const retroTab = $('#settlementRetroUnpaidTabBtn');
    if (mainCard) mainCard.hidden = next !== 'platform';
    if (finalCard) finalCard.hidden = next !== 'final';
    if (retroCard) retroCard.hidden = next !== 'retroUnpaid';
    if (finalTab) finalTab.classList.toggle('active', next === 'final');
    if (retroTab) retroTab.classList.toggle('active', next === 'retroUnpaid');
    if (next !== 'platform') {
      document.querySelectorAll('[data-admin-platform-tab="settlement-result-direct"]').forEach(btn => btn.classList.remove('active'));
    } else {
      document.querySelectorAll('[data-admin-platform-tab="settlement-result-direct"]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-platform') === state.platform);
      });
    }
    if (next === 'final') renderFinal();
    if (next === 'retroUnpaid') renderRetro();
  }

  function toggleFinalView(show) {
    setSettlementView(show ? 'final' : 'platform');
  }

  async function publishFinalPayslips() {
    const rows = finalRows().filter(r => r.driverId);
    if (!rows.length) { showToast('반영할 정산 행이 없습니다.'); return; }
    const week = finalWeek();
    const ok = window.confirm(
      [
        `${week}(수) 주 전체 ${rows.length}줄을 기사앱 주급명세서로 반영합니다.`,
        '쿠팡·배민 각 줄이 각각 반영되고, 라이더앱에 즉시 노출됩니다.',
        '',
        '반영할까요?'
      ].join('\n')
    );
    if (!ok) return;
    try {
      const result = await window.BremStorage.publishDirectSettlementPayslips({ weekStart: week, rows });
      if (!result?.ok) throw new Error(result?.error || result?.message || '반영 실패');
      showToast(result.message || `급여명세서 반영 완료 · ${result.published || rows.length}건 (라이더앱 즉시 공개)`);
    } catch (error) {
      console.error('[direct payslip publish]', error);
      showToast(error.message || '급여명세서 반영에 실패했습니다.');
    }
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    $('#settlementFinalTabBtn')?.addEventListener('click', () => setSettlementView('final'));
    $('#settlementRetroUnpaidTabBtn')?.addEventListener('click', () => setSettlementView('retroUnpaid'));
    $('#settlementFinalReloadBtn')?.addEventListener('click', async () => { await loadWithdrawals(); renderFinal(); });
    $('#settlementFinalPublishBtn')?.addEventListener('click', () => { void publishFinalPayslips(); });
    $('#settlementFinalWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#settlementFinalWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    document.querySelectorAll('[data-admin-platform-tab="settlement-result-direct"]').forEach(btn => {
      btn.addEventListener('click', () => setSettlementView('platform'));
    });
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
    $('#settlementResultBatchFixBtn')?.addEventListener('click', () => { void batchFixNegatives(); });
    $('#settlementRetroReloadBtn')?.addEventListener('click', () => renderRetro());
    $('#settlementRetroSendBtn')?.addEventListener('click', () => { void sendSelectedToDeduction(); });
    $('#settlementRetroWeekFilter')?.addEventListener('change', event => {
      state.retroWeekFilter = event.target.value || '';
      renderRetro();
    });
    $('#settlementRetroSearch')?.addEventListener('input', event => {
      state.retroSearch = event.target.value || '';
      renderRetro();
    });
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

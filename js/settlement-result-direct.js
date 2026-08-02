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
        + ` <span class="muted-inline">(BREM프로모션 ${formatNumber(totals.promo)} · 기타지급 ${formatNumber(totals.other)} · ${platformLabelKo} 선정산(처리완료) ${formatNumber(totals.prepaid)})</span>`
        + extraNote + negNote;
    }

    if (!$('#settlementResultRetroCard')?.hidden) renderRetro();
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
      retro.push({
        driverId: row.driverId,
        name: row.name,
        idLabel: row.idLabel,
        platform: row.platform,
        amount: x,
        settlementId: settlement.id
      });
    });
    if (!entries.length) { showToast('맞출 금액이 없습니다.'); return; }

    const preview = retro.slice(0, 15)
      .map(r => `· ${r.name} (${r.idLabel}) +${formatNumber(r.amount)}원`);
    const more = retro.length > 15 ? `\n외 ${retro.length - 15}명` : '';
    const ok = window.confirm(
      [
        `${entries.length}명의 마이너스를 0원으로 맞춥니다.`,
        '마이너스만큼 기타지급을 올리고, 원천세 3.3%까지 반영(그로스업)합니다.',
        '총 출금액·선정산은 그대로이며, 소급분 메뉴에 기록됩니다.',
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

  function toggleRetroView(force) {
    const card = $('#settlementResultRetroCard');
    if (!card) return;
    const show = typeof force === 'boolean' ? force : card.hidden;
    card.hidden = !show;
    if (show) renderRetro();
  }

  function renderRetro() {
    const body = $('#settlementResultRetroBody');
    if (!body) return;
    const store = window.BremStorage?.directRetroAdjustments;
    const all = store?.getAll?.() || {};
    const weeks = Object.keys(all).sort((a, b) => b.localeCompare(a));
    if (!weeks.length) {
      body.innerHTML = '<p class="form-help">아직 소급분(일괄 맞추기) 내역이 없습니다.</p>';
      return;
    }
    let grandTotal = 0;
    let grandCount = 0;
    weeks.forEach(wk => {
      Object.values(all[wk] || {}).forEach(r => {
        grandTotal += Number(r.amount || 0);
        grandCount += 1;
      });
    });

    const weekBlocks = weeks.map(wk => {
      const map = all[wk] || {};
      const list = Object.values(map).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
      if (!list.length) return '';
      const total = list.reduce((s, r) => s + Number(r.amount || 0), 0);
      const rowsHtml = list.map(r => `
        <tr>
          <td class="settlement-retro-name"><strong>${escapeHtml(r.name || '-')}</strong></td>
          <td class="settlement-retro-id">${escapeHtml(r.idLabel || '-')}</td>
          <td class="settlement-retro-platform">${escapeHtml(r.platform === 'coupang' ? '쿠팡' : (r.platform === 'baemin' ? '배민' : '-'))}</td>
          <td class="settlement-retro-amount">${formatNumber(r.amount)}원</td>
        </tr>`).join('');
      return `
        <div class="settlement-retro-week">
          <p class="settlement-retro-week-head"><strong>${escapeHtml(wk)}(수)</strong> 주 · ${list.length}명 · 소급 합계 <strong>${formatNumber(total)}</strong>원</p>
          <div class="table-wrap">
            <table class="weekly-settlement-saved-table settlement-retro-table">
              <thead>
                <tr>
                  <th class="settlement-retro-name">이름</th>
                  <th class="settlement-retro-id">아이디</th>
                  <th class="settlement-retro-platform">플랫폼</th>
                  <th class="settlement-retro-amount">소급 기타지급</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
              <tfoot>
                <tr class="settlement-retro-total-row">
                  <td colspan="3">합계 (${list.length}명)</td>
                  <td class="settlement-retro-amount"><strong>${formatNumber(total)}원</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>`;
    }).join('');

    body.innerHTML = `
      <p class="settlement-retro-grand">전체 소급 합계 · ${grandCount}건 · <strong>${formatNumber(grandTotal)}</strong>원</p>
      ${weekBlocks}`;
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
    settlements.forEach(settlement => {
      Calc().computeRows(settlement, {
        withdrawals: state.withdrawals,
        weekSettlements: settlements,
        _leaseConsumed: leaseConsumed
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
        + ` · 총콜수수료 <strong>${formatNumber(t.callFee)}</strong>`
        + ` · 총일정산수수료 <strong>${formatNumber(t.dailySettlementFee)}</strong>`
        + ` · <span class="final-deposit-total">총지급액 <strong>${formatNumber(t.netPay)}</strong>원</span>`;
    }
  }

  function toggleFinalView(show) {
    const finalCard = $('#settlementFinalCard');
    const mainCard = $('#settlementResultMainCard');
    const finalTab = $('#settlementFinalTabBtn');
    if (!finalCard) return;
    finalCard.hidden = !show;
    if (mainCard) mainCard.hidden = show;
    if (finalTab) finalTab.classList.toggle('active', show);
    // 쿠팡/배민 탭 active 는 show 일 때 해제
    if (show) {
      document.querySelectorAll('[data-admin-platform-tab="settlement-result-direct"]').forEach(btn => btn.classList.remove('active'));
      renderFinal();
    }
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
    $('#settlementFinalTabBtn')?.addEventListener('click', () => toggleFinalView(true));
    $('#settlementFinalReloadBtn')?.addEventListener('click', async () => { await loadWithdrawals(); renderFinal(); });
    $('#settlementFinalPublishBtn')?.addEventListener('click', () => { void publishFinalPayslips(); });
    $('#settlementFinalWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#settlementFinalWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    document.querySelectorAll('[data-admin-platform-tab="settlement-result-direct"]').forEach(btn => {
      btn.addEventListener('click', () => toggleFinalView(false));
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
    $('#settlementResultRetroBtn')?.addEventListener('click', () => toggleRetroView());
    $('#settlementResultRetroCloseBtn')?.addEventListener('click', () => toggleRetroView(false));
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

const BremSettlementResultDirect = (function () {
  const $ = selector => document.querySelector(selector);
  // 지급내역·공제내역 정의와 계산은 「최종입금」과 공유한다. (js/direct-settlement-calc.js)
  const Calc = () => window.BremDirectSettlementCalc;

  // week: 빈 문자열이면 주 필터 없음(전체 주). 정산주는 항상 수요일 시작.
  // viewMode: platform | final | retroUnpaid | spillover
  const state = {
    platform: 'baemin',
    settlementId: '',
    week: '',
    withdrawals: [],
    viewMode: 'platform',
    retroWeekFilter: '',
    retroSearch: '',
    finalSearch: '',
    spillFilter: 'crossed'
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
    // 최종결산·스필오버 카드에도 같은 정산주를 표시한다.
    const finalBtn = $('#settlementFinalWeekBtn');
    if (finalBtn) finalBtn.textContent = state.week ? label : '수요일 선택';
    const spillBtn = $('#settlementSpillWeekBtn');
    if (spillBtn) spillBtn.textContent = state.week ? label : '수요일 선택';
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
    // 열린 보조 카드는 정산주 변경 시 함께 갱신한다.
    if (!$('#settlementFinalCard')?.hidden) renderFinal();
    if (!$('#settlementSpilloverCard')?.hidden) renderSpillover();
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
      <tr data-result-row="1"
        data-settlement-id="${escapeHtml(row.settlementId || '')}"
        data-driver-id="${escapeHtml(row.driverId || '')}"
        data-platform="${escapeHtml(row.platform || '')}"
        style="cursor:pointer;"
        title="클릭하여 추가지급·기타지급·리스·대여 조정">${cols.map(col => cellHtml(col, row)).join('')}</tr>`).join('');

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
      if (state.viewMode === 'spillover') renderSpillover();
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

    // 리스차감·대여차감: 클릭해서 이번 정산서만 금액 수정/0/자동복원
    if ((col.key === 'leaseFee' || col.key === 'loanFee') && row.driverId && row.settlementId) {
      classes.push('settle-fee-editable');
      const title = `${col.label} — 클릭하여 수정 (0=없앰, 자동=ERP복원)`;
      return `<td class="${classes.join(' ')}" title="${escapeHtml(title)}"
        data-settle-fee-edit="1"
        data-fee-kind="${escapeHtml(col.key)}"
        data-settlement-id="${escapeHtml(row.settlementId)}"
        data-driver-id="${escapeHtml(row.driverId)}"
        data-driver-name="${escapeHtml(row.name || '')}"
        data-current-amount="${Math.max(0, Math.round(Number(row[col.key] || 0)))}"
        style="cursor:pointer;">${value}</td>`;
    }

    return `<td class="${classes.join(' ')}">${col.strong ? `<strong>${value}</strong>` : value}</td>`;
  }

  function closeFinalDetailModal() {
    const modal = $('#settlementFinalDetailModal');
    if (modal) modal.hidden = true;
  }

  function moneyLi(label, value) {
    return `<li>${escapeHtml(label)}: <strong>${formatNumber(value)}</strong>원</li>`;
  }

  function refreshAfterDetailSave() {
    if (state.viewMode === 'final') renderFinal();
    else {
      render();
      if (state.viewMode === 'spillover') renderSpillover();
    }
  }

  function openFinalDetailModal(row) {
    if (!row?.driverId || !row?.settlementId) {
      showToast('이 행은 지급·차감을 수정할 수 없습니다.');
      return;
    }
    const modal = $('#settlementFinalDetailModal');
    if (!modal) return;
    const platKo = row.platform === 'coupang' ? '쿠팡' : '배민';
    const titleEl = $('#settlementFinalDetailTitle');
    const metaEl = $('#settlementFinalDetailMeta');
    const payList = $('#settlementFinalDetailPayList');
    const deductList = $('#settlementFinalDetailDeductList');
    if (titleEl) titleEl.textContent = `${row.name || '-'} · 지급·차감 조정`;
    if (metaEl) {
      metaEl.textContent = `${platKo} · ID ${row.idLabel || '-'} · 건수 ${formatNumber(row.callCount)} · 총지급액 ${formatNumber(row.netPay)}원`;
    }
    if (payList) {
      payList.innerHTML = [
        moneyLi('배달료', row.deliveryFee),
        moneyLi('추가지급(미션)', row.missionPay),
        moneyLi('기타지급', row.other),
        moneyLi('BREM프로모션', row.promo),
        moneyLi('지급합계', row.grossPay)
      ].join('');
    }
    if (deductList) {
      deductList.innerHTML = [
        moneyLi('차감내역', row.deductionDetail),
        moneyLi('고용보험', row.employmentInsurance),
        moneyLi('산재보험', row.accidentInsurance),
        moneyLi('시간제보험', row.hourlyInsurance),
        moneyLi('원천세', row.withholdingTax),
        moneyLi('프로모션원천세', row.promotionWithholdingTax),
        moneyLi('콜수수료', row.callFee),
        moneyLi('일일정산수수료', row.dailySettlementFee),
        moneyLi('선정산(처리완료)', row.prepaid),
        moneyLi('리스차감(현재)', row.leaseFee),
        moneyLi('대여차감(현재)', row.loanFee),
        moneyLi('공제합계', row.deductTotal)
      ].join('');
    }
    const sid = $('#settlementFinalDetailSettlementId');
    const did = $('#settlementFinalDetailDriverId');
    const dname = $('#settlementFinalDetailDriverName');
    const missionInput = $('#settlementFinalDetailMissionPay');
    const otherInput = $('#settlementFinalDetailOtherPay');
    const leaseInput = $('#settlementFinalDetailLeaseFee');
    const loanInput = $('#settlementFinalDetailLoanFee');
    if (sid) sid.value = row.settlementId || '';
    if (did) did.value = row.driverId || '';
    if (dname) dname.value = row.name || '';
    if (missionInput) missionInput.value = String(Math.max(0, Math.round(Number(row.missionPay || 0))));
    if (otherInput) otherInput.value = String(Math.max(0, Math.round(Number(row.other || 0))));
    if (leaseInput) leaseInput.value = String(Math.max(0, Math.round(Number(row.leaseFee || 0))));
    if (loanInput) loanInput.value = String(Math.max(0, Math.round(Number(row.loanFee || 0))));
    modal.hidden = false;
    missionInput?.focus?.();
  }

  function parseMoneyInput(selector) {
    return Math.max(0, Math.round(Number(String($(selector)?.value || '0').replace(/,/g, '')) || 0));
  }

  function saveFinalDetailFees({ restoreAuto = false } = {}) {
    const settlementId = String($('#settlementFinalDetailSettlementId')?.value || '').trim();
    const driverId = String($('#settlementFinalDetailDriverId')?.value || '').trim();
    const driverName = String($('#settlementFinalDetailDriverName')?.value || '').trim();
    const store = window.BremStorage?.directSettlementAdjustments;
    if (!settlementId || !driverId || !store?.applyEntries) {
      showToast('저장할 수 없습니다.');
      return;
    }
    if (restoreAuto) {
      // 추가지급 → 주정산서 금액, 기타지급 → 0, 리스·대여 → ERP 자동
      store.removeDriver('missionPay', settlementId, driverId);
      store.removeDriver('other', settlementId, driverId);
      store.removeDriver('leaseFee', settlementId, driverId);
      store.removeDriver('loanFee', settlementId, driverId);
      void window.BremStorage.flushStorage?.();
      showToast('자동복원 · 추가지급(주정산서) · 기타지급 0 · 리스·대여 ERP');
      closeFinalDetailModal();
      refreshAfterDetailSave();
      return;
    }
    const missionPay = parseMoneyInput('#settlementFinalDetailMissionPay');
    const otherPay = parseMoneyInput('#settlementFinalDetailOtherPay');
    const leaseFee = parseMoneyInput('#settlementFinalDetailLeaseFee');
    const loanFee = parseMoneyInput('#settlementFinalDetailLoanFee');
    if (![missionPay, otherPay, leaseFee, loanFee].every(Number.isFinite)) {
      showToast('금액은 숫자로 입력하세요.');
      return;
    }
    const entry = { driverId, driverName, source: 'manual' };
    store.applyEntries('missionPay', settlementId, [{ ...entry, amount: missionPay }]);
    store.applyEntries('other', settlementId, [{ ...entry, amount: otherPay }]);
    store.applyEntries('leaseFee', settlementId, [{ ...entry, amount: leaseFee }]);
    store.applyEntries('loanFee', settlementId, [{ ...entry, amount: loanFee }]);
    void window.BremStorage.flushStorage?.();
    showToast(
      `저장 · 추가 ${missionPay.toLocaleString('ko-KR')} · 기타 ${otherPay.toLocaleString('ko-KR')}`
      + ` · 리스 ${leaseFee.toLocaleString('ko-KR')} · 대여 ${loanFee.toLocaleString('ko-KR')}`
    );
    closeFinalDetailModal();
    refreshAfterDetailSave();
  }

  function editLeaseLoanFeeCell(cell) {
    const kind = String(cell.getAttribute('data-fee-kind') || '').trim();
    const settlementId = String(cell.getAttribute('data-settlement-id') || '').trim();
    const driverId = String(cell.getAttribute('data-driver-id') || '').trim();
    const driverName = String(cell.getAttribute('data-driver-name') || '').trim();
    const current = Math.max(0, Math.round(Number(cell.getAttribute('data-current-amount') || 0)));
    if ((kind !== 'leaseFee' && kind !== 'loanFee') || !settlementId || !driverId) return;
    const store = window.BremStorage?.directSettlementAdjustments;
    if (!store?.applyEntries || !store?.removeDriver) {
      showToast('저장소를 불러오지 못했습니다.');
      return;
    }
    const label = kind === 'leaseFee' ? '리스차감' : '대여차감';
    const input = window.prompt(
      `${label} (${driverName || driverId})\n`
        + `숫자 = 이번 정산서에 적용 · 0 = 없앰 · 자동 = ERP 자동계산으로 복원\n`
        + `현재: ${current.toLocaleString('ko-KR')}원`,
      String(current)
    );
    if (input == null) return;
    const trimmed = String(input).trim();
    if (!trimmed || trimmed === '자동' || trimmed.toLowerCase() === 'auto') {
      store.removeDriver(kind, settlementId, driverId);
      void window.BremStorage.flushStorage?.();
      showToast(`${label} 자동계산으로 복원했습니다.`);
      if (state.viewMode === 'final') renderFinal();
      else {
        render();
        if (state.viewMode === 'spillover') renderSpillover();
      }
      return;
    }
    const amount = Math.max(0, Math.round(Number(String(trimmed).replace(/,/g, ''))));
    if (!Number.isFinite(amount)) {
      showToast('금액을 숫자로 입력하세요. (자동복원은 「자동」)');
      return;
    }
    store.applyEntries(kind, settlementId, [{
      driverId,
      amount,
      driverName,
      source: 'manual'
    }]);
    void window.BremStorage.flushStorage?.();
    showToast(`${label} ${amount.toLocaleString('ko-KR')}원으로 반영했습니다.`);
    if (state.viewMode === 'final') renderFinal();
    else {
      render();
      if (state.viewMode === 'spillover') renderSpillover();
    }
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
      const shortfall = Math.abs(Math.round(Number(row.netPay || 0)));
      const leaseFee = Math.max(0, Math.round(Number(row.leaseFee || 0)));
      const loanFee = Math.max(0, Math.round(Number(row.loanFee || 0)));
      const prepaid = Math.max(0, Math.round(Number(row.prepaid || 0)));
      const feeSum = leaseFee + loanFee + prepaid;
      // 리스·대여·선정산이 있을 때만 회수(미납) 대상. 없으면 고용·산재 회사로스.
      const unpaidBalance = feeSum > 0 ? shortfall : 0;
      const reasonParts = [];
      if (leaseFee > 0) reasonParts.push(`리스차감 ${leaseFee.toLocaleString('ko-KR')}`);
      if (loanFee > 0) reasonParts.push(`대여차감 ${loanFee.toLocaleString('ko-KR')}`);
      if (prepaid > 0) reasonParts.push(`선정산 ${prepaid.toLocaleString('ko-KR')}`);
      if (feeSum <= 0) reasonParts.push('고용·산재 로스(회사부담)');
      retro.push({
        driverId: row.driverId,
        name: row.name,
        idLabel: row.idLabel,
        platform: row.platform,
        amount: x,
        grossUpAmount: x,
        unpaidBalance,
        leaseFee,
        loanFee,
        prepaid,
        status: 'logged',
        lossType: feeSum > 0 ? 'recoverable' : 'insurance_loss',
        reason: reasonParts.join(' · ') || '',
        settlementId: settlement.id
      });
    });
    if (!entries.length) { showToast('맞출 금액이 없습니다.'); return; }

    const recoverable = retro.filter(r => r.unpaidBalance > 0 || (r.leaseFee + r.loanFee + r.prepaid) > 0);
    const insuranceLoss = retro.length - recoverable.length;
    const preview = retro.slice(0, 15)
      .map(r => {
        const transfer = resolveTransferUnpaid(r);
        return `· ${r.name} (${r.idLabel}) 이관 ${formatNumber(transfer)}원 · 그로스업 +${formatNumber(r.amount)}원`
          + (transfer <= 0 ? ' [회사로스]' : '')
          + (r.reason ? ` [${r.reason}]` : '');
      });
    const more = retro.length > 15 ? `\n외 ${retro.length - 15}명` : '';
    const ok = window.confirm(
      [
        `${entries.length}명의 마이너스를 0원으로 맞춥니다.`,
        '마이너스만큼 기타지급을 올리고, 원천세 3.3%까지 반영(그로스업)합니다.',
        `회수대상(리스·대여·선정산·미납) ${recoverable.length}명 · 고용·산재 회사로스 ${insuranceLoss}명(이관 선택 불가)`,
        '차감관리 이관은 자동이 아닙니다. 「소급분」탭에서 이관액 있는 건만 선택해 보내세요.',
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

  /** 차감/미납으로 보낼 금액. 그로스업(회사 고용·산재 로스)은 포함하지 않음. */
  function resolveTransferUnpaid(entry) {
    const leaseFee = Math.max(0, Math.round(Number(entry?.leaseFee || 0)));
    const loanFee = Math.max(0, Math.round(Number(entry?.loanFee || 0)));
    const prepaid = Math.max(0, Math.round(Number(entry?.prepaid || 0)));
    const feeSum = leaseFee + loanFee + prepaid;
    const unpaid = Math.max(0, Math.round(Number(entry?.unpaidBalance || 0)));
    // 리스·대여·선정산이 전혀 없으면 회사로스 → 이관액 0
    if (feeSum <= 0 && unpaid <= 0) return 0;
    if (feeSum <= 0) return 0;
    return unpaid > 0 ? unpaid : feeSum;
  }

  function isCompanyLoss(row) {
    return resolveTransferUnpaid(row) <= 0;
  }

  function isRetroSelectable(row) {
    if (String(row?.status || '') === 'sent_to_deduction') return false;
    return resolveTransferUnpaid(row) > 0;
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
          leaseFee: Math.max(0, Math.round(Number(r.leaseFee || 0))),
          loanFee: Math.max(0, Math.round(Number(r.loanFee || 0))),
          prepaid: Math.max(0, Math.round(Number(r.prepaid || 0))),
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
    let transferSum = 0;
    let sentCount = 0;
    let lossCount = 0;
    rows.forEach(r => {
      unpaidSum += r.unpaidBalance;
      grossSum += r.grossUpAmount;
      const t = resolveTransferUnpaid(r);
      if (t > 0 && r.status !== 'sent_to_deduction') transferSum += t;
      if (r.status === 'sent_to_deduction') sentCount += 1;
      if (isCompanyLoss(r) && r.status !== 'sent_to_deduction') lossCount += 1;
    });
    const selectableCount = rows.filter(isRetroSelectable).length;
    if (summaryEl) {
      summaryEl.innerHTML = `표시 <strong>${rows.length}</strong>건`
        + ` · <strong style="color:#b45309;">이관가능 ${selectableCount}건 / ${formatNumber(transferSum)}원</strong>`
        + ` · 회사로스(고용·산재) ${lossCount}건`
        + ` · 그로스업(참고) ${formatNumber(grossSum)}원`
        + ` · 이관됨 ${sentCount}건`;
    }

    const byWeek = new Map();
    rows.forEach(r => {
      if (!byWeek.has(r.weekStart)) byWeek.set(r.weekStart, []);
      byWeek.get(r.weekStart).push(r);
    });

    const weekBlocks = [...byWeek.entries()].map(([wk, list]) => {
      list.sort((a, b) => {
        const ta = resolveTransferUnpaid(a);
        const tb = resolveTransferUnpaid(b);
        if (tb !== ta) return tb - ta;
        return String(a.name).localeCompare(String(b.name), 'ko');
      });
      const transferWeek = list.reduce((s, r) => (
        r.status === 'sent_to_deduction' ? s : s + resolveTransferUnpaid(r)
      ), 0);
      const rowsHtml = list.map(r => {
        const sent = r.status === 'sent_to_deduction';
        const transferAmt = resolveTransferUnpaid(r);
        const companyLoss = transferAmt <= 0;
        const checkDisabled = (sent || companyLoss) ? ' disabled' : '';
        const checkTitle = sent
          ? '이미 차감관리로 이관됨'
          : (companyLoss
            ? '고용·산재 회사로스 — 차감 이관 대상 아님'
            : `선택 후 「미납·차감으로 보내기」→ 이관액 ${transferAmt.toLocaleString('ko-KR')}원`);
        const kindLabel = sent
          ? '이관완료'
          : (companyLoss ? '회사로스' : '회수대상');
        const checkVal = `${escapeHtml(r.weekStart)}||${escapeHtml(r.entryKey)}`;
        const rowClass = [
          sent ? 'settlement-retro-row--sent' : '',
          companyLoss && !sent ? 'settlement-retro-row--no-unpaid' : '',
          !companyLoss && !sent ? 'settlement-retro-row--recoverable' : ''
        ].filter(Boolean).join(' ');
        return `
        <tr class="${rowClass}">
          <td class="settlement-retro-check-cell"><input type="checkbox" class="settlement-retro-check" value="${checkVal}" title="${escapeHtml(checkTitle)}"${checkDisabled}></td>
          <td class="settlement-retro-name"><strong>${escapeHtml(r.name || '-')}</strong></td>
          <td class="settlement-retro-id">${escapeHtml(r.idLabel || '-')}</td>
          <td class="settlement-retro-platform">${escapeHtml(r.platform === 'coupang' ? '쿠팡' : (r.platform === 'baemin' ? '배민' : '-'))}</td>
          <td class="settlement-retro-amount weekly-amount-cell"><strong style="color:${transferAmt > 0 ? '#b45309' : 'inherit'};">${formatNumber(transferAmt)}</strong>원</td>
          <td>${escapeHtml(kindLabel)}</td>
          <td class="settlement-retro-amount weekly-amount-cell">${formatNumber(r.unpaidBalance)}원</td>
          <td class="settlement-retro-amount weekly-amount-cell">${formatNumber(r.leaseFee)}원</td>
          <td class="settlement-retro-amount weekly-amount-cell">${formatNumber(r.loanFee)}원</td>
          <td class="settlement-retro-amount weekly-amount-cell">${formatNumber(r.prepaid)}원</td>
          <td class="settlement-retro-amount weekly-amount-cell">${formatNumber(r.grossUpAmount)}원</td>
          <td>${escapeHtml(r.reason || '-')}</td>
          <td>${escapeHtml(retroStatusLabel(r.status))}</td>
        </tr>`;
      }).join('');
      return `
        <div class="settlement-retro-week">
          <p class="settlement-retro-week-head"><strong>${escapeHtml(wk)}(수)</strong> 주 · ${list.length}건 · <strong>이관액 합 ${formatNumber(transferWeek)}원</strong></p>
          <div class="table-wrap">
            <table class="weekly-settlement-saved-table settlement-retro-table">
              <thead>
                <tr>
                  <th class="settlement-retro-check-cell" title="이 주 선택"><input type="checkbox" class="settlement-retro-check-all" data-week="${escapeHtml(wk)}" title="이 주 · 회수대상(이관액&gt;0)만 선택"></th>
                  <th class="settlement-retro-name">기사</th>
                  <th class="settlement-retro-id">아이디</th>
                  <th class="settlement-retro-platform">플랫폼</th>
                  <th class="settlement-retro-amount">이관액</th>
                  <th>구분</th>
                  <th class="settlement-retro-amount">미납잔액</th>
                  <th class="settlement-retro-amount">리스차감</th>
                  <th class="settlement-retro-amount">대여차감</th>
                  <th class="settlement-retro-amount">선정산</th>
                  <th class="settlement-retro-amount">그로스업(참고)</th>
                  <th>이유/메모</th>
                  <th>이관상태</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');

    body.innerHTML = `<p class="settlement-retro-select-hint">☑ <strong>이관액</strong>이 있는 회수대상만 체크 → 「미납·차감으로 보내기」(이관 가능 ${selectableCount}건 / ${formatNumber(transferSum)}원 · 회사로스 ${lossCount}건은 선택 불가)</p>${weekBlocks}`;
    const updateSelectHint = () => {
      const checked = [...body.querySelectorAll('input.settlement-retro-check:checked:not([disabled])')];
      const n = checked.length;
      let selectedSum = 0;
      checked.forEach(cb => {
        const raw = String(cb.value || '');
        const sep = raw.indexOf('||');
        const weekStart = raw.slice(0, sep);
        const entryKey = raw.slice(sep + 2);
        const entry = window.BremStorage?.directRetroAdjustments?.getWeek?.(weekStart)?.[entryKey];
        if (entry) selectedSum += resolveTransferUnpaid(entry);
      });
      const hint = body.querySelector('.settlement-retro-select-hint');
      if (hint) {
        hint.innerHTML = n > 0
          ? `☑ <strong>${n}건</strong> 선택 · 이관 예정 <strong>${formatNumber(selectedSum)}원</strong> → 「미납·차감으로 보내기」`
          : `☑ <strong>이관액</strong>이 있는 회수대상만 체크 → 「미납·차감으로 보내기」(이관 가능 ${selectableCount}건 / ${formatNumber(transferSum)}원 · 회사로스 ${lossCount}건은 선택 불가)`;
      }
    };
    body.querySelectorAll('.settlement-retro-check-all').forEach(master => {
      master.addEventListener('change', () => {
        const week = master.getAttribute('data-week') || '';
        body.querySelectorAll('input.settlement-retro-check:not([disabled])').forEach(cb => {
          if (String(cb.value || '').startsWith(`${week}||`)) cb.checked = master.checked;
        });
        updateSelectHint();
      });
    });
    body.querySelectorAll('input.settlement-retro-check:not([disabled])').forEach(cb => {
      cb.addEventListener('change', updateSelectHint);
    });
  }

  async function sendSelectedToDeduction() {
    const body = $('#settlementResultRetroBody');
    if (!body) return;
    const checked = [...body.querySelectorAll('input.settlement-retro-check:checked:not([disabled])')];
    if (!checked.length) {
      showToast('이관할 건을 먼저 체크하세요. (전체 자동 전송 없음)');
      return;
    }

    const selected = checked.map(cb => {
      const raw = String(cb.value || '');
      const sep = raw.indexOf('||');
      return { weekStart: raw.slice(0, sep), entryKey: raw.slice(sep + 2) };
    }).filter(x => x.weekStart && x.entryKey);

    const store = window.BremStorage?.directRetroAdjustments;
    const ledger = window.BremStorage?.deductionLedger;
    const pairFn = window.BremAdminLeaseMenus?.createRetroUnpaidPair;
    if (!store || !ledger) {
      showToast('저장소를 사용할 수 없습니다.');
      return;
    }
    if (typeof pairFn !== 'function') {
      showToast('미납/회수 연동 기능을 불러오지 못했습니다. 페이지를 새로고침하세요.');
      return;
    }

    const drivers = window.BremStorage?.drivers?.getAll?.() || [];
    const driverById = new Map(drivers.map(d => [String(d.id), d]));

    const previewRows = [];
    selected.forEach(({ weekStart, entryKey }) => {
      const entry = store.getWeek?.(weekStart)?.[entryKey];
      if (!entry) return;
      if (entry.status === 'sent_to_deduction') return;
      const unpaid = resolveTransferUnpaid(entry);
      previewRows.push({ weekStart, entryKey, entry, unpaid });
    });
    if (!previewRows.length) {
      showToast('이관 가능한 선택 건이 없습니다. (이미 이관됐거나 데이터 없음)');
      return;
    }

    const sendRows = previewRows.filter(p => p.unpaid > 0);
    if (!sendRows.length) {
      showToast('이관액이 있는 회수대상만 보낼 수 있습니다. (고용·산재 회사로스는 제외)');
      return;
    }
    const totalTransfer = sendRows.reduce((s, p) => s + p.unpaid, 0);
    const defaultDaily = sendRows.length === 1 ? sendRows[0].unpaid : '';
    const dailyRaw = window.prompt(
      [
        `${sendRows.length}건 · 합계 ${formatNumber(totalTransfer)}원을 「미납/회수」+「차감관리」로 보냅니다.`,
        '· 미납/회수: 장부·회수 관리',
        '· 차감관리: 출금가능 홀드(반영 ON)',
        '· 이관액 = 미납잔액(없으면 리스+대여+선정산). 그로스업은 보내지 않음',
        '',
        '일 차감액을 입력하세요. (비우면 각 건의 이관액 전액)',
        sendRows.slice(0, 10).map(p =>
          `· ${p.entry.name} 이관 ${formatNumber(p.unpaid)}원`
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
      `${sendRows.length}건 / ${formatNumber(totalTransfer)}원을 미납/회수 + 차감관리로 이관할까요?\n일 차감: ${dailyOverride == null ? '건별 이관액' : `${formatNumber(dailyOverride)}원`}`
    );
    if (!ok) return;

    let created = 0;
    let skipped = 0;
    for (const item of sendRows) {
      const sourceRef = `${item.weekStart}|${item.entryKey}`;
      const existing = ledger.findBySource?.('unpaid', sourceRef);
      if (existing || item.entry.status === 'sent_to_deduction' || item.entry.ledgerId) {
        skipped += 1;
        continue;
      }
      const unpaid = item.unpaid;
      const dailyDeduct = dailyOverride != null ? Math.min(dailyOverride, unpaid) : unpaid;
      const driver = driverById.get(String(item.entry.driverId)) || null;
      const result = pairFn({
        sourceRef,
        weekStart: item.weekStart,
        unpaid,
        dailyDeduct,
        driverId: item.entry.driverId,
        driverName: item.entry.name || driver?.name || '',
        driverPhone: driver?.phone || driver?.mobile || '',
        reason: item.entry.reason || `소급/미납 ${item.weekStart}`,
        deductionPlatform: item.entry.platform === 'baemin' ? 'baemin' : 'coupang',
        leaseFee: item.entry.leaseFee,
        loanFee: item.entry.loanFee,
        prepaid: item.entry.prepaid
      });
      if (!result?.ok) {
        skipped += 1;
        continue;
      }
      store.updateEntry?.(item.weekStart, item.entryKey, {
        status: 'sent_to_deduction',
        ledgerId: result.ledger?.id || '',
        arrearId: result.arrear?.id || ''
      });
      created += 1;
    }

    try {
      await window.BremLeaseErp?.persistAll?.({ skipFlushStorage: true });
    } catch (_err) { /* ignore */ }
    await window.BremStorage?.awaitPersist?.(window.BremStorage.flushStorage?.());
    renderRetro();
    try {
      window.BremAdminLeaseMenus?.refresh?.({ loadRemote: false });
    } catch (_err) { /* ignore */ }
    showToast(`미납/회수·차감 이관 ${created}건${skipped ? ` · 건너뜀 ${skipped}건` : ''}`);
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

  function addDaysKey(dateKeyValue, days) {
    const raw = String(dateKeyValue || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
    const dt = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return '';
    dt.setDate(dt.getDate() + Number(days || 0));
    return dateKey(dt);
  }

  function findDriversByQuery(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const list = window.BremStorage?.drivers?.getAll?.() || [];
    return list.filter(d => {
      const name = String(d.name || '').toLowerCase();
      const id = String(d.id || '').toLowerCase();
      const baeminId = String(d.baeminId || d.raw_data?.baeminId || '').toLowerCase();
      const coupangId = String(d.coupangId || d.coupangLoginKey || d.raw_data?.coupangId || '').toLowerCase();
      const phone = String(d.phone || d.mobile || '').replace(/\D/g, '');
      const qDigits = q.replace(/\D/g, '');
      return name.includes(q)
        || id.includes(q)
        || baeminId.includes(q)
        || coupangId.includes(q)
        || (qDigits && phone.includes(qDigits));
    }).slice(0, 20);
  }

  function pickDriverInteractive(query) {
    const matches = findDriversByQuery(query);
    if (!matches.length) {
      showToast(`「${query}」 기사를 찾지 못했습니다. 기사등록을 확인하세요.`);
      return null;
    }
    if (matches.length === 1) return matches[0];
    const lines = matches.map((d, i) => {
      const ids = [
        d.baeminId ? `배민 ${d.baeminId}` : '',
        (d.coupangId || d.coupangLoginKey) ? `쿠팡 ${d.coupangId || d.coupangLoginKey}` : ''
      ].filter(Boolean).join(' · ');
      return `${i + 1}. ${d.name || '-'} (${ids || d.id})`;
    }).join('\n');
    const pick = window.prompt(`여러 명이 검색됐습니다. 번호를 입력하세요.\n${lines}`, '1');
    if (pick == null) return null;
    const idx = Math.max(1, Math.round(Number(pick))) - 1;
    return matches[idx] || null;
  }

  function ensureFinalSettlement(week, platform) {
    const p = platform === 'coupang' ? 'coupang' : 'baemin';
    const existing = finalWeekSettlements().find(s => String(s.platform || '') === p);
    if (existing) return existing;
    const endDate = addDaysKey(week, 6) || week;
    const record = {
      id: (window.crypto?.randomUUID?.() || `manual-${p}-${week}-${Date.now()}`),
      platform: p,
      channel: 'direct',
      region: '',
      fileName: '수동추가',
      fileNames: ['수동추가'],
      baseSettlementDate: week,
      startDate: week,
      endDate,
      paymentDate: '',
      settlementWeekLabel: `${week}~${endDate}`,
      uploadedAt: new Date().toISOString(),
      riders: [],
      summary: {
        channel: 'direct',
        totalExtracted: 0,
        matchedRiders: 0,
        unmatchedRiders: 0,
        callCountMismatches: 0
      }
    };
    return window.BremStorage.weeklySettlements.save(record);
  }

  function buildManualRiderStub(driver, platform) {
    const name = String(driver?.name || '').trim();
    return {
      originalName: name,
      riderName: name,
      driverName: name,
      matchedRiderId: String(driver?.id || '').trim(),
      matched: true,
      weeklyOrderCount: 0,
      systemCallCount: 0,
      callCountMatched: true,
      callCountIgnored: false,
      coupangLoginKey: String(driver?.coupangId || driver?.coupangLoginKey || driver?.raw_data?.coupangId || '').trim(),
      baeminUserId: String(driver?.baeminId || driver?.raw_data?.baeminId || '').trim(),
      warnings: ['수동추가'],
      amounts: {
        deliveryFee: 0,
        missionPay: 0,
        totalDeliveryPay: 0,
        deductionBase: 0,
        deductionDetail: 0,
        hourlyInsurance: 0,
        employmentInsurance: 0,
        accidentInsurance: 0,
        withholdingTax: 0
      }
    };
  }

  async function addDriverToFinalSettlement() {
    const week = finalWeek();
    if (!week) {
      showToast('정산주(수요일)를 먼저 선택하세요.');
      return;
    }
    const nameHint = String(state.finalSearch || '').trim();
    const nameInput = window.prompt('추가할 기사 이름(또는 ID)을 입력하세요.', nameHint);
    if (nameInput == null) return;
    const query = String(nameInput).trim();
    if (!query) {
      showToast('이름을 입력하세요.');
      return;
    }
    const driver = pickDriverInteractive(query);
    if (!driver?.id) return;

    const platformRaw = window.prompt(
      `${driver.name || driver.id}\n플랫폼을 입력하세요. (쿠팡 / 배민)`,
      '배민'
    );
    if (platformRaw == null) return;
    const platformText = String(platformRaw).trim();
    const platform = /쿠팡|coupang/i.test(platformText) ? 'coupang' : 'baemin';

    const leaseRaw = window.prompt('리스차감 금액 (없으면 0)', '0');
    if (leaseRaw == null) return;
    const loanRaw = window.prompt('대여차감 금액 (없으면 0)', '0');
    if (loanRaw == null) return;
    const leaseFee = Math.max(0, Math.round(Number(String(leaseRaw).replace(/,/g, '')) || 0));
    const loanFee = Math.max(0, Math.round(Number(String(loanRaw).replace(/,/g, '')) || 0));
    if (!Number.isFinite(leaseFee) || !Number.isFinite(loanFee)) {
      showToast('금액은 숫자로 입력하세요.');
      return;
    }

    await window.BremStorage?.ensureSectionLoaded?.('settlement-result-direct');
    const settlement = ensureFinalSettlement(week, platform);
    const riders = Array.isArray(settlement.riders) ? [...settlement.riders] : [];
    const already = riders.some(r => String(r.matchedRiderId || '').trim() === String(driver.id).trim());
    if (!already) {
      riders.push(buildManualRiderStub(driver, platform));
      settlement.riders = riders;
      settlement.summary = {
        ...(settlement.summary || {}),
        channel: 'direct',
        totalExtracted: riders.length,
        matchedRiders: riders.filter(r => r.matchedRiderId).length,
        unmatchedRiders: riders.filter(r => !r.matchedRiderId).length,
        callCountMismatches: riders.filter(r => r.callCountMatched === false && r.callCountIgnored !== true).length
      };
      settlement.matchedNamesLabel = riders.map(r => r.driverName || r.riderName).filter(Boolean).join(', ');
      window.BremStorage.weeklySettlements.save(settlement);
    }

    const adj = window.BremStorage.directSettlementAdjustments;
    // 입력한 리스/대여 금액을 이번 정산서에 반영 (0도 가능)
    adj.applyEntries('leaseFee', settlement.id, [{
      driverId: driver.id,
      amount: leaseFee,
      driverName: driver.name || '',
      source: 'manual'
    }]);
    adj.applyEntries('loanFee', settlement.id, [{
      driverId: driver.id,
      amount: loanFee,
      driverName: driver.name || '',
      source: 'manual'
    }]);

    void window.BremStorage.flushStorage?.();
    state.finalSearch = String(driver.name || query).trim();
    state.viewMode = 'final';
    setSettlementView('final');
    renderFinal();
    const platKo = platform === 'coupang' ? '쿠팡' : '배민';
    showToast(
      already
        ? `${driver.name} · ${platKo} 행이 이미 있어 차감만 반영했습니다.`
        : `${driver.name} · ${platKo} 행을 추가했습니다. (리스 ${leaseFee.toLocaleString('ko-KR')} · 대여 ${loanFee.toLocaleString('ko-KR')})`
    );
  }

  // 그 주 모든 정산서(쿠팡+배민)의 라이더 행을 합치지 않고 모은다.
  function finalRows() {
    const settlements = finalWeekSettlements();
    const rows = [];
    const leaseConsumed = new Set();
    const loanConsumed = new Set();
    const week = finalWeek();
    const spill = Calc().buildLeaseLoanSpilloverAllocation(settlements, {
      week,
      withdrawals: state.withdrawals
    });
    settlements.forEach(settlement => {
      Calc().computeRows(settlement, {
        withdrawals: state.withdrawals,
        weekSettlements: settlements,
        _leaseLoanSpill: spill,
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

    const searchEl = $('#settlementFinalSearch');
    if (searchEl && document.activeElement !== searchEl) {
      searchEl.value = state.finalSearch || '';
    }
    const q = String(state.finalSearch || '').trim().toLowerCase();
    const allRows = finalRows();
    const rows = q
      ? allRows.filter(row => {
        const name = String(row.name || '').toLowerCase();
        const idLabel = String(row.idLabel || '').toLowerCase();
        const driverId = String(row.driverId || '').toLowerCase();
        return name.includes(q) || idLabel.includes(q) || driverId.includes(q);
      })
      : allRows;

    // 헤더: 기사 · 플랫폼 · ID + 정산 열들
    const cols = Calc().COLUMNS;
    if (head) {
      const lead = '<th rowspan="2">플랫폼</th>';
      head.innerHTML = Calc().theadHtml(cols, lead);
    }
    if (!allRows.length) {
      body.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty">이 주에 저장된 직계약 정산서가 없습니다.</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      return;
    }
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${cols.length + 1}" class="empty">검색 결과가 없습니다.</td></tr>`;
    } else {
      body.innerHTML = rows.map(row => {
        const tag = row.platform === 'coupang'
          ? '<span class="settle-platform-tag settle-platform-tag--coupang">쿠팡</span>'
          : '<span class="settle-platform-tag settle-platform-tag--baemin">배민</span>';
        const cells = cols.map(col => {
          if (col.key === 'name') {
            return `<td class="settle-col-${col.group}" style="cursor:pointer;text-decoration:underline;">`
              + `<strong>${escapeHtml(row.name || '-')}</strong></td>`;
          }
          return cellHtml(col, row);
        }).join('');
        return `<tr class="settle-final-row" style="cursor:pointer;" title="클릭하면 지급·공제 팝업"
          data-final-row="1"
          data-settlement-id="${escapeHtml(row.settlementId || '')}"
          data-driver-id="${escapeHtml(row.driverId || '')}"
          data-platform="${escapeHtml(row.platform || '')}">
          <td>${tag}</td>${cells}</tr>`;
      }).join('');
    }

    if (summaryEl) {
      const t = Calc().sumRows(rows);
      const coupangCount = rows.filter(r => r.platform === 'coupang').length;
      const baeminCount = rows.filter(r => r.platform === 'baemin').length;
      const searchNote = q ? ` · 검색 “${escapeHtml(state.finalSearch)}”` : '';
      summaryEl.innerHTML = `표시 <strong>${rows.length}</strong>줄 / 전체 ${allRows.length}줄 (쿠팡 ${coupangCount} · 배민 ${baeminCount})${searchNote}`
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

  function renderSpillover() {
    const body = $('#settlementSpillRows');
    const summaryEl = $('#settlementSpillSummary');
    if (!body) return;
    const filterEl = $('#settlementSpillFilter');
    if (filterEl) state.spillFilter = filterEl.value === 'all' ? 'all' : 'crossed';

    const week = finalWeek();
    if (!week) {
      body.innerHTML = '<tr><td colspan="14" class="empty">정산주(수요일)를 선택하세요.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }
    const settlements = finalWeekSettlements();
    if (!settlements.length) {
      body.innerHTML = '<tr><td colspan="14" class="empty">이 주에 저장된 직계약 정산서가 없습니다.</td></tr>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }

    const report = Calc().buildSpilloverReport(settlements, {
      week,
      withdrawals: state.withdrawals
    });
    let rows = report.rows || [];
    if (state.spillFilter === 'crossed') rows = rows.filter(r => r.crossed);
    const crossedCount = (report.rows || []).filter(r => r.crossed).length;

    if (summaryEl) {
      summaryEl.innerHTML = `${week}(수) 주 · 배분 대상 <strong>${(report.rows || []).length}</strong>명`
        + ` · 크로스 스필 <strong>${crossedCount}</strong>명`
        + ` · 표시 <strong>${rows.length}</strong>건`;
    }
    if (!rows.length) {
      body.innerHTML = state.spillFilter === 'crossed'
        ? '<tr><td colspan="14" class="empty">양쪽으로 나뉜 스필오버 건이 없습니다. 「전체」로 바꾸면 단일 플랫폼 배분도 볼 수 있습니다.</td></tr>'
        : '<tr><td colspan="14" class="empty">리스·대여·선정산 배분 대상이 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = rows.map(r => {
      const prefer = r.prefer === 'baemin' ? '배민' : '쿠팡';
      const badge = r.crossed
        ? '<span class="settle-platform-tag settle-platform-tag--coupang">크로스</span>'
        : '<span class="muted-inline">단일</span>';
      const nameSub = [
        r.coupangId ? `쿠팡 ${r.coupangId}` : '',
        r.baeminId ? `배민 ${r.baeminId}` : ''
      ].filter(Boolean).join(' · ');
      return `<tr class="${r.crossed ? 'settlement-spill-row--crossed' : ''}">
        <td class="settlement-retro-name"><strong>${escapeHtml(r.name || '-')}</strong>${nameSub ? `<br><span class="muted-inline">${escapeHtml(nameSub)}</span>` : ''}</td>
        <td>${escapeHtml(prefer)}</td>
        <td class="weekly-amount-cell">${formatNumber(r.capacityCoupang)}</td>
        <td class="weekly-amount-cell">${formatNumber(r.capacityBaemin)}</td>
        <td class="weekly-amount-cell"><strong>${formatNumber(r.leaseTotal)}</strong></td>
        <td class="weekly-amount-cell">${formatNumber(r.leaseCoupang)}</td>
        <td class="weekly-amount-cell">${formatNumber(r.leaseBaemin)}</td>
        <td class="weekly-amount-cell"><strong>${formatNumber(r.loanTotal)}</strong></td>
        <td class="weekly-amount-cell">${formatNumber(r.loanCoupang)}</td>
        <td class="weekly-amount-cell">${formatNumber(r.loanBaemin)}</td>
        <td class="weekly-amount-cell"><strong>${formatNumber(r.prepaidTotal)}</strong></td>
        <td class="weekly-amount-cell">${formatNumber(r.prepaidCoupang)}</td>
        <td class="weekly-amount-cell">${formatNumber(r.prepaidBaemin)}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');
  }

  function setSettlementView(mode) {
    const next = mode === 'final' || mode === 'retroUnpaid' || mode === 'spillover' ? mode : 'platform';
    state.viewMode = next;
    const finalCard = $('#settlementFinalCard');
    const mainCard = $('#settlementResultMainCard');
    const retroCard = $('#settlementResultRetroCard');
    const spillCard = $('#settlementSpilloverCard');
    const finalTab = $('#settlementFinalTabBtn');
    const retroTab = $('#settlementRetroUnpaidTabBtn');
    const spillTab = $('#settlementSpilloverTabBtn');
    if (mainCard) mainCard.hidden = next !== 'platform';
    if (finalCard) finalCard.hidden = next !== 'final';
    if (retroCard) retroCard.hidden = next !== 'retroUnpaid';
    if (spillCard) spillCard.hidden = next !== 'spillover';
    if (finalTab) finalTab.classList.toggle('active', next === 'final');
    if (retroTab) retroTab.classList.toggle('active', next === 'retroUnpaid');
    if (spillTab) spillTab.classList.toggle('active', next === 'spillover');
    if (next !== 'platform') {
      document.querySelectorAll('[data-admin-platform-tab="settlement-result-direct"]').forEach(btn => btn.classList.remove('active'));
    } else {
      document.querySelectorAll('[data-admin-platform-tab="settlement-result-direct"]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-platform') === state.platform);
      });
    }
    if (next === 'final') renderFinal();
    if (next === 'retroUnpaid') renderRetro();
    if (next === 'spillover') renderSpillover();
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
    $('#settlementSpilloverTabBtn')?.addEventListener('click', () => setSettlementView('spillover'));
    $('#settlementRetroUnpaidTabBtn')?.addEventListener('click', () => setSettlementView('retroUnpaid'));
    $('#settlementFinalReloadBtn')?.addEventListener('click', async () => { await loadWithdrawals(); renderFinal(); });
    $('#settlementSpillReloadBtn')?.addEventListener('click', async () => { await loadWithdrawals(); renderSpillover(); });
    $('#settlementSpillFilter')?.addEventListener('change', () => renderSpillover());
    $('#settlementSpillWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#settlementSpillWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
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
    $('#settlementResultTable')?.addEventListener('click', (event) => {
      const cell = event.target?.closest?.('[data-settle-fee-edit="1"]');
      if (cell && $('#settlementResultTable')?.contains(cell)) {
        event.stopPropagation();
        editLeaseLoanFeeCell(cell);
        return;
      }
      const rowEl = event.target?.closest?.('tr[data-result-row="1"]');
      if (!rowEl || !$('#settlementResultTable')?.contains(rowEl)) return;
      const settlementId = String(rowEl.getAttribute('data-settlement-id') || '').trim();
      const driverId = String(rowEl.getAttribute('data-driver-id') || '').trim();
      const platform = String(rowEl.getAttribute('data-platform') || '').trim();
      const row = computeRows().find(r => (
        String(r.settlementId || '') === settlementId
        && String(r.driverId || '') === driverId
        && String(r.platform || '') === platform
      ));
      if (row) openFinalDetailModal(row);
    });
    $('#settlementFinalTable')?.addEventListener('click', (event) => {
      const rowEl = event.target?.closest?.('tr[data-final-row="1"]');
      if (!rowEl || !$('#settlementFinalTable')?.contains(rowEl)) return;
      const settlementId = String(rowEl.getAttribute('data-settlement-id') || '').trim();
      const driverId = String(rowEl.getAttribute('data-driver-id') || '').trim();
      const platform = String(rowEl.getAttribute('data-platform') || '').trim();
      const row = finalRows().find(r => (
        String(r.settlementId || '') === settlementId
        && String(r.driverId || '') === driverId
        && String(r.platform || '') === platform
      ));
      if (row) openFinalDetailModal(row);
    });
    $('#settlementFinalSearch')?.addEventListener('input', (event) => {
      state.finalSearch = event.target.value || '';
      renderFinal();
    });
    document.querySelectorAll('[data-close-settlement-final-detail]').forEach(el => {
      el.addEventListener('click', () => closeFinalDetailModal());
    });
    $('#settlementFinalDetailSaveBtn')?.addEventListener('click', () => saveFinalDetailFees());
    $('#settlementFinalDetailAutoBtn')?.addEventListener('click', () => saveFinalDetailFees({ restoreAuto: true }));
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

// 최종입금 — 한 정산주의 직계약 정산서(쿠팡·배민)를 체크로 골라
// 기사 한 명당 한 줄로 합쳐 실제 입금할 금액을 보여준다.
// 지급내역·공제내역 정의와 계산은 「정산결과 (직계약)」과 동일한 공용 모듈을 쓴다.
const BremFinalDeposit = (function () {
  const $ = selector => document.querySelector(selector);
  const Calc = () => window.BremDirectSettlementCalc;

  const state = {
    week: '',
    withdrawals: [],
    // 기본값은 「전체 선택」이다. 새 정산서가 올라와도 자동으로 포함되게
    // 체크 목록이 아니라 제외 목록을 들고 있는다.
    excludedSettlementIds: new Set(),
    excludedDriverKeys: new Set()
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

  function formatDate(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
  }

  function platformLabel(platform) {
    return platform === 'coupang' ? '쿠팡' : '배민';
  }

  // --- 정산주 / 정산서 목록 -------------------------------------------------

  function allSettlements() {
    return (window.BremStorage?.weeklySettlements?.getAll?.('direct') || [])
      .slice()
      .sort((a, b) => (
        String(b.startDate || '').localeCompare(String(a.startDate || ''))
        || String(a.platform || '').localeCompare(String(b.platform || ''))
        || String(a.region || '').localeCompare(String(b.region || ''), 'ko-KR')
      ));
  }

  // 최종입금은 「그 주」 단위로 입금하므로 주 필터를 항상 건다.
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
    // 주가 바뀌면 다른 주의 체크 상태를 물려받지 않게 초기화한다.
    state.excludedSettlementIds.clear();
    state.excludedDriverKeys.clear();
    void refresh();
  }

  function shiftWeek(deltaWeeks) {
    const base = ensureWeek();
    const date = new Date(`${base}T00:00:00`);
    date.setDate(date.getDate() + deltaWeeks * 7);
    setWeek(Calc().dateKey(date));
  }

  function renderWeekButton() {
    const btn = $('#finalDepositWeekBtn');
    if (btn) btn.textContent = `${formatDate(ensureWeek())}(수) 주`;
    const hidden = $('#finalDepositWeek');
    if (hidden) hidden.value = ensureWeek();
  }

  function renderSettlementPicker() {
    const listEl = $('#finalDepositSettlementList');
    const rangeEl = $('#finalDepositWeekRange');
    if (!listEl) return;

    const list = weekSettlements();
    if (rangeEl) {
      const total = allSettlements().length;
      rangeEl.textContent = list.length
        ? `정산주 ${formatDate(ensureWeek())}(수) · 정산서 ${list.length}건 (체크한 정산서만 최종입금에 합산됩니다)`
        : `${formatDate(ensureWeek())}(수) 주에 저장된 직계약 정산서가 없습니다. 「주정산서 업로드 (직계약)」에서 먼저 저장하세요. (전체 ${total}건)`;
    }

    if (!list.length) {
      listEl.innerHTML = '<p class="empty">이 주에 저장된 직계약 정산서가 없습니다.</p>';
      const allChk = $('#finalDepositSettlementAll');
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
          <input type="checkbox" data-fd-settlement="${escapeHtml(id)}"${checked ? ' checked' : ''}>
          <span class="final-deposit-settlement-body">
            <strong>${escapeHtml(platformLabel(record.platform))}</strong>${region}
            <span class="muted-inline">${formatDate(record.startDate)} ~ ${formatDate(record.endDate)} · ${formatNumber(riders)}명</span>
            ${file}
          </span>
        </label>`;
    };

    // 쿠팡 그룹 → 배민 그룹으로 위아래 분리 (한 페이지에 모두 표시)
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

    const allChk = $('#finalDepositSettlementAll');
    if (allChk) allChk.checked = list.every(record => !state.excludedSettlementIds.has(String(record.id)));
  }

  // --- 기사 단위 합산 -------------------------------------------------------

  // 쿠팡·배민을 한 사람으로 묶는 키. 기사 매칭이 안 된 줄은 플랫폼+ID로 따로 둔다.
  // 쿠팡/배민을 위아래로 나누므로 키에 플랫폼을 포함해 사람도 플랫폼별로 분리한다.
  // (같은 플랫폼의 여러 지역 정산서는 여전히 한 줄로 합친다.)
  function driverKey(row) {
    const base = row.driverId ? `d:${row.driverId}` : `u:${row.idLabel}:${row.name}`;
    return `${base}|${row.platform}`;
  }

  /**
   * @param {{ allSettlements?: boolean, allDrivers?: boolean }} [options]
   * allSettlements: 화면에서 끈 정산서도 포함 (엑셀 전체 인원용)
   * allDrivers: 화면에서 끈 기사도 포함
   */
  function mergedRows(options = {}) {
    const allSettlements = Boolean(options.allSettlements);
    const allDrivers = Boolean(options.allDrivers);
    const numericKeys = Calc().NUMERIC_KEYS;
    const byDriver = new Map();

    // 스필오버 배분을 정산서들 사이에서 공유한다(사람별 플랫폼 한도 기준).
    // consumed 로 같은 사람의 같은 플랫폼 선정산이 중복 반영되지 않게 한다.
    const week = ensureWeek();
    const weekAll = weekSettlements();
    const sourceList = allSettlements ? weekAll : checkedSettlements();
    const allocation = Calc().allocateWeekWithdrawals(
      state.withdrawals,
      week,
      Calc().buildWeekCapacityMap(weekAll)
    );
    const consumed = new Set();
    const leaseConsumed = new Set();
    const loanConsumed = new Set();
    const spill = Calc().buildLeaseLoanSpilloverAllocation(weekAll, {
      week,
      withdrawals: state.withdrawals,
      _allocation: allocation
    });
    sourceList.forEach(settlement => {
      Calc().computeRows(settlement, {
        withdrawals: state.withdrawals,
        weekSettlements: weekAll,
        _allocation: allocation,
        _consumed: consumed,
        _leaseLoanSpill: spill,
        _leaseConsumed: leaseConsumed,
        _loanConsumed: loanConsumed
      }).forEach(row => {
        const key = driverKey(row);
        const existing = byDriver.get(key);
        if (!existing) {
          byDriver.set(key, {
            ...row,
            key,
            platforms: new Set([row.platform]),
            idLabels: new Set(row.idLabel && row.idLabel !== '-' ? [row.idLabel] : []),
            regions: new Set(row.region ? [row.region] : []),
            settlementCount: 1
          });
          return;
        }
        numericKeys.forEach(field => { existing[field] += Number(row[field] || 0); });
        existing.platforms.add(row.platform);
        if (row.idLabel && row.idLabel !== '-') existing.idLabels.add(row.idLabel);
        if (row.region) existing.regions.add(row.region);
        existing.settlementCount += 1;
        if (!existing.driverId && row.driverId) existing.driverId = row.driverId;
      });
    });

    // 표기 순서는 정산서를 읽은 순서와 무관하게 항상 쿠팡 → 배민으로 고정한다.
    const rows = [...byDriver.values()].map(row => ({
      ...row,
      platformLabel: ['coupang', 'baemin'].filter(id => row.platforms.has(id)).map(platformLabel).join('+'),
      idLabel: [...row.idLabels].join(' / ') || '-',
      regionLabel: [...row.regions].join(', ') || '-',
      checked: allDrivers ? true : !state.excludedDriverKeys.has(row.key)
    }));
    return Calc().sortByName(rows);
  }

  /** 정산서에 적힌 라이더 칸 수(파일·지역 합, 같은 사람 중복 가능) */
  function settlementRiderSlotCount(list) {
    return (list || []).reduce((sum, record) => (
      sum + (Array.isArray(record.riders) ? record.riders.length : 0)
    ), 0);
  }

  function transferStatus(info) {
    if (Number(info?.netPay || 0) <= 0) return '입금0원';
    if (!info?.complete) return '계좌미등록';
    return '이체가능';
  }

  // --- 표 ------------------------------------------------------------------

  // 정산결과와 같은 지급내역·공제내역에 「플랫폼」만 덧붙인다.
  function columns() {
    const out = [];
    Calc().COLUMNS.forEach(col => {
      out.push(col);
      if (col.key === 'name') {
        out.push({ key: 'platformLabel', label: '플랫폼', group: 'info', money: false });
      }
    });
    return out;
  }

  function renderHead() {
    const head = $('#finalDepositHead');
    if (!head) return;
    const lead = '<th rowspan="2" class="final-deposit-check-th"><input type="checkbox" id="finalDepositSelectAll" title="전체 선택"></th>';
    head.innerHTML = Calc().theadHtml(columns(), lead);
  }

  function cellHtml(col, row) {
    if (col.tag) return `<td class="settle-col-${col.group}"><span class="weekly-id-tag">${escapeHtml(row[col.key])}</span></td>`;
    const value = col.money === false ? escapeHtml(row[col.key]) : formatNumber(row[col.key]);
    const classes = [`settle-col-${col.group}`];
    if (col.money !== false) classes.push('weekly-amount-cell');
    if (col.note) classes.push('settle-col-note');
    return `<td class="${classes.join(' ')}">${col.strong ? `<strong>${value}</strong>` : value}</td>`;
  }

  function render() {
    const body = $('#finalDepositRows');
    if (!body) return;
    renderWeekButton();
    renderSettlementPicker();
    renderHead();

    const cols = columns();
    const colspan = cols.length + 1;
    const rows = mergedRows();
    const summaryEl = $('#finalDepositSummary');

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colspan}" class="empty">체크한 정산서에 정산 대상이 없습니다. 위에서 정산서를 체크하세요.</td></tr>`;
      if (summaryEl) summaryEl.textContent = '';
      const allChk = $('#finalDepositSelectAll');
      if (allChk) allChk.checked = false;
      return;
    }

    // 쿠팡 그룹 → 배민 그룹 순서로 위아래 분리해서 보여준다. 각 그룹 소계 포함.
    const rowHtml = row => `
      <tr class="${row.checked ? '' : 'final-deposit-row-off'}">
        <td class="final-deposit-check-td"><input type="checkbox" data-fd-driver="${escapeHtml(row.key)}"${row.checked ? ' checked' : ''}></td>
        ${cols.map(col => cellHtml(col, row)).join('')}
      </tr>`;
    const groupHtml = (platform, label) => {
      const list = rows.filter(row => row.platform === platform);
      if (!list.length) return '';
      const sub = Calc().sumRows(list.filter(row => row.checked));
      return `
        <tr class="final-deposit-group-row"><td colspan="${colspan}">${escapeHtml(label)} 정산 · ${list.length}명</td></tr>
        ${list.map(rowHtml).join('')}
        <tr class="final-deposit-subtotal-row"><td colspan="${colspan}">
          ${escapeHtml(label)} 소계 · 지급합계 <strong>${formatNumber(sub.grossPay)}</strong>
          · 공제합계 <strong>${formatNumber(sub.deductTotal)}</strong>
          · 선정산(처리완료) <strong>${formatNumber(sub.prepaid)}</strong>
          · 최종입금 <strong>${formatNumber(sub.netPay)}</strong>원
        </td></tr>`;
    };
    body.innerHTML = groupHtml('coupang', '쿠팡') + groupHtml('baemin', '배민');

    const allChk = $('#finalDepositSelectAll');
    if (allChk) allChk.checked = rows.every(row => row.checked);

    const picked = rows.filter(row => row.checked);
    const totals = Calc().sumRows(picked);
    if (summaryEl) {
      summaryEl.innerHTML = `체크 <strong>${picked.length}</strong>명 / 전체 ${rows.length}명`
        + ` · 지급합계 <strong>${formatNumber(totals.grossPay)}</strong>`
        + ` · 공제합계 <strong>${formatNumber(totals.deductTotal)}</strong>`
        + ` · 선정산(처리완료) <strong>${formatNumber(totals.prepaid)}</strong>`
        + ` · 리스차감 <strong>${formatNumber(totals.leaseFee)}</strong>`
        + ` · 대여차감 <strong>${formatNumber(totals.loanFee)}</strong>`
        + ` · <span class="final-deposit-total">최종입금 <strong>${formatNumber(totals.netPay)}</strong>원</span>`;
    }
    renderReconcile();
  }

  // 처리완료 출금인데 정산서에 매칭 안 돼 선정산에 반영되지 못한 건을 찾아낸다.
  // (그 사람의 해당 플랫폼 정산서가 없거나 플랫폼 미지정인 경우)
  function renderReconcile() {
    const box = $('#finalDepositReconcile');
    if (!box) return;
    const week = ensureWeek();
    const canon = Calc().canonicalDriverKey;
    const normP = Calc().normalizeWithdrawalPlatform;

    // 스필오버 반영 기준: 사람이 쿠팡/배민 중 한 곳이라도 정산서가 있으면 선정산이 반영된다.
    // 그러므로 "정산서가 아예 없는 사람"의 처리완료 출금만 미반영으로 잡는다.
    const presentPersons = new Set();
    checkedSettlements().forEach(settlement => {
      (Array.isArray(settlement.riders) ? settlement.riders : []).forEach(rider => {
        const key = canon(String(rider.matchedRiderId || '').trim());
        if (key) presentPersons.add(key);
      });
    });

    const completed = (Array.isArray(state.withdrawals) ? state.withdrawals : [])
      .filter(w => String(w.status || '') === 'completed'
        && String(w.weekStart || '').slice(0, 10) === week);

    const unmatched = [];
    let unmatchedTotal = 0;
    completed.forEach(w => {
      const amount = Math.max(0, Math.round(Number(w.amount || 0)));
      if (amount <= 0) return;
      const platform = normP(w.platform);
      const key = canon(String(w.driverId || '').trim());
      const reflected = key && presentPersons.has(key);
      if (reflected) return;
      const reason = !key ? '기사 매칭 불가' : '직계약 정산서 없음';
      unmatched.push({
        name: w.driverName || w.driverId || '-',
        platform: platform || 'unknown',
        amount,
        reason
      });
      unmatchedTotal += amount;
    });

    if (!unmatched.length) {
      box.innerHTML = '<p class="final-deposit-reconcile ok">✔ 처리완료 출금이 모두 정산서에 반영되었습니다.</p>';
      return;
    }

    unmatched.sort((a, b) => b.amount - a.amount);
    const rowsHtml = unmatched.map(u => `
      <tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${escapeHtml(u.platform === 'coupang' ? '쿠팡' : (u.platform === 'baemin' ? '배민' : '미지정'))}</td>
        <td class="weekly-amount-cell">${formatNumber(u.amount)}원</td>
        <td>${escapeHtml(u.reason)}</td>
      </tr>`).join('');

    box.innerHTML = `
      <div class="final-deposit-reconcile warn">
        <p class="final-deposit-reconcile-head">
          ⚠ 선정산 미반영 처리완료 출금 <strong>${unmatched.length}</strong>건 · 합계 <strong>${formatNumber(unmatchedTotal)}</strong>원
          <span class="final-deposit-reconcile-hint">— 이 금액이 「주정산 출금내역 처리완료」와 「최종입금 선정산」의 차이입니다. 해당 기사의 플랫폼을 바로잡거나(플랫폼 자동 교정), 정산서 누락을 확인하세요.</span>
        </p>
        <div class="table-wrap">
          <table class="weekly-settlement-saved-table">
            <thead><tr><th>이름</th><th>플랫폼</th><th>출금액</th><th>사유</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  function driverForRow(row) {
    const id = String(row?.driverId || '').trim();
    if (!id) return null;
    return window.BremStorage?.drivers?.getById?.(id) || null;
  }

  function loginIdForDriver(driver) {
    if (!driver) return '';
    const makeId = window.BremDriverUtils?.makeDriverLoginId;
    return typeof makeId === 'function' ? String(makeId(driver) || '').trim() : '';
  }

  function bankScore(driver) {
    if (!driver) return 0;
    let score = 0;
    if (String(driver.bankName || '').trim()) score += 2;
    if (String(driver.accountNumber || '').trim()) score += 4;
    if (String(driver.accountHolder || '').trim()) score += 1;
    return score;
  }

  function idLabelsOf(row) {
    return String(row?.idLabel || '')
      .split('/')
      .map(part => part.trim())
      .filter(part => part && part !== '-');
  }

  // 삭제·미매칭·계좌 빈 기사도 ERP ID·이름으로 다시 찾아 구멍을 줄인다.
  function resolveDriverForExport(row) {
    const utils = window.BremDriverUtils;
    const list = window.BremStorage?.drivers?.getAll?.() || [];
    let best = driverForRow(row);
    let bestScore = bankScore(best);

    const consider = (candidate) => {
      if (!candidate) return;
      const score = bankScore(candidate);
      if (!best || score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    };

    idLabelsOf(row).forEach(label => {
      consider(utils?.matchDriverByCoupangErpId?.(label, list));
      consider(utils?.matchDriverByBaeminErpId?.(label, list));
      const byLogin = list.find(driver => loginIdForDriver(driver) === label.replace(/\s/g, ''));
      consider(byLogin || null);
    });

    const name = String(row?.name || '').replace(/\s+/g, '');
    if (name) {
      const sameName = list.filter(driver => String(driver.name || '').replace(/\s+/g, '') === name);
      if (sameName.length === 1) consider(sameName[0]);
      else {
        const withBank = sameName.filter(driver => bankScore(driver) > 0);
        if (withBank.length === 1) consider(withBank[0]);
      }
    }

    return best;
  }

  function normalizeAccountNumber(value) {
    return String(value || '').trim().replace(/[^\d]/g, '');
  }

  function transferInfoForRow(row) {
    const driver = resolveDriverForExport(row);
    const bankName = String(driver?.bankName || '').trim();
    const accountNumber = String(driver?.accountNumber || '').trim();
    const accountHolder = String(driver?.accountHolder || driver?.name || row?.name || '').trim();
    const erpId = loginIdForDriver(driver)
      || idLabelsOf(row).find(label => /\d{3,}$/.test(label.replace(/\s/g, '')))
      || idLabelsOf(row)[0]
      || '';
    const riderName = String(driver?.name || row?.name || '').trim();
    return {
      driver,
      bankName,
      accountNumber,
      accountHolder,
      erpId,
      riderName,
      netPay: Math.round(Number(row?.netPay) || 0),
      complete: Boolean(bankName && accountNumber && accountHolder)
    };
  }

  // 입금 시트는 이체 1건=1줄. 쿠팡/배민으로 갈라진 같은 사람은 금액만 합친다.
  // includeZero=true 이면 최종입금 0원도 포함(누락 점검용).
  function buildTransferRows(rows, { includeZero = false } = {}) {
    const byKey = new Map();
    rows.forEach(row => {
      const info = transferInfoForRow(row);
      if (!includeZero && info.netPay === 0) return;
      const acctKey = normalizeAccountNumber(info.accountNumber);
      const mergeKey = info.driver?.id
        ? `d:${info.driver.id}`
        : (acctKey
          ? `a:${acctKey}`
          : (info.erpId ? `e:${info.erpId}` : `r:${row.key}`));
      const existing = byKey.get(mergeKey);
      if (!existing) {
        byKey.set(mergeKey, { ...info });
        return;
      }
      existing.netPay += info.netPay;
      if (bankScore(info.driver) > bankScore(existing.driver)) {
        existing.driver = info.driver;
        existing.bankName = info.bankName;
        existing.accountNumber = info.accountNumber;
        existing.accountHolder = info.accountHolder;
        existing.erpId = info.erpId || existing.erpId;
        existing.riderName = info.riderName || existing.riderName;
        existing.complete = info.complete;
      } else {
        if (!existing.bankName && info.bankName) existing.bankName = info.bankName;
        if (!existing.accountNumber && info.accountNumber) existing.accountNumber = info.accountNumber;
        if (!existing.accountHolder && info.accountHolder) existing.accountHolder = info.accountHolder;
        if (!existing.erpId && info.erpId) existing.erpId = info.erpId;
        existing.complete = Boolean(existing.bankName && existing.accountNumber && existing.accountHolder);
      }
    });
    return [...byKey.values()].sort((a, b) => (
      String(a.riderName || a.erpId).localeCompare(String(b.riderName || b.erpId), 'ko-KR')
    ));
  }

  function appendAccountTextColumn(sheet, rowCount, colIndex) {
    for (let r = 1; r < rowCount; r += 1) {
      const cell = sheet[window.XLSX.utils.encode_cell({ r, c: colIndex })];
      if (cell && cell.v !== undefined && cell.v !== '') {
        cell.t = 's';
        cell.v = String(cell.v);
        cell.z = '@';
      }
    }
  }

  function exportExcel() {
    if (!window.XLSX) {
      showToast('엑셀 모듈을 불러오지 못했습니다.');
      return;
    }

    const weekList = weekSettlements();
    if (!weekList.length) {
      showToast('이 주에 저장된 직계약 정산서가 없습니다.');
      return;
    }

    // 엑셀은 화면 체크와 무관하게 「그 주 정산서 전원」을 넣는다. (누락 방지)
    const excludedSettlementCount = weekList.filter(record =>
      state.excludedSettlementIds.has(String(record.id))
    ).length;
    const rows = mergedRows({ allSettlements: true, allDrivers: true });
    if (!rows.length) {
      showToast('정산서에 라이더가 없습니다.');
      return;
    }

    const allPeople = buildTransferRows(rows, { includeZero: true });
    const ready = allPeople.filter(info => info.netPay > 0 && info.complete);
    const missing = allPeople.filter(info => info.netPay > 0 && !info.complete);
    const zeroPay = allPeople.filter(info => info.netPay <= 0);
    const slotCount = settlementRiderSlotCount(weekList);
    const weekLabel = formatDate(ensureWeek());

    if (!window.confirm(
      `${weekLabel}(수) 주 최종입금 엑셀 — 전원 포함\n\n`
      + `· 정산서 ${weekList.length}건 · 파일 라이더칸 합 ${slotCount} (지역·파일 중복 가능)\n`
      + `· 화면 행(쿠팡/배민 분리): ${rows.length}행\n`
      + `· 「입금」시트 전원: ${allPeople.length}명 (0원·계좌미등록 포함)\n`
      + `  └ 이체가능 ${ready.length} · 계좌미등록 ${missing.length} · 입금0원 ${zeroPay.length}\n`
      + (excludedSettlementCount
        ? `\n※ 화면에서 정산서 ${excludedSettlementCount}건을 꺼두었어도 엑셀에는 전부 넣습니다.\n`
        : '\n')
      + `※ 정산서 「N명」을 다 더하면 같은 사람이 두 번 잡힐 수 있습니다.\n`
      + `   맞는 기준은 「입금」시트 ${allPeople.length}명입니다.`
    )) return;

    const cols = columns();
    const detail = [
      cols.map(col => col.label),
      ...rows.map(row => cols.map(col => row[col.key]))
    ];

    // 「입금」= 전원. 상태 열로 구분. (이체파일용은 「입금_이체가능」)
    const transfer = [
      ['상태', '입금은행', '입금계좌번호', '입금액', '받는사람', '비고', '기사명'],
      ...allPeople.map(info => [
        transferStatus(info),
        info.bankName || '',
        info.accountNumber || '',
        info.netPay,
        info.accountHolder || info.riderName || '',
        info.erpId || '',
        info.riderName || ''
      ])
    ];
    const transferReady = [
      ['입금은행', '입금계좌번호', '입금액', '받는사람', '비고'],
      ...ready.map(info => [
        info.bankName,
        info.accountNumber,
        info.netPay,
        info.accountHolder,
        info.erpId
      ])
    ];

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(detail), '최종입금');

    const transferSheet = window.XLSX.utils.aoa_to_sheet(transfer);
    appendAccountTextColumn(transferSheet, transfer.length, 2);
    window.XLSX.utils.book_append_sheet(wb, transferSheet, '입금');

    const readySheet = window.XLSX.utils.aoa_to_sheet(transferReady);
    appendAccountTextColumn(readySheet, transferReady.length, 1);
    window.XLSX.utils.book_append_sheet(wb, readySheet, '입금_이체가능');

    if (missing.length) {
      const missingSheet = [
        ['기사명', 'ERP ID', '입금액', '입금은행', '입금계좌번호', '예금주', '비고'],
        ...missing.map(info => [
          info.riderName,
          info.erpId,
          info.netPay,
          info.bankName,
          info.accountNumber,
          info.accountHolder,
          '기사목록에서 은행·계좌·예금주를 등록한 뒤 다시 내보내세요'
        ])
      ];
      const ms = window.XLSX.utils.aoa_to_sheet(missingSheet);
      appendAccountTextColumn(ms, missingSheet.length, 4);
      window.XLSX.utils.book_append_sheet(wb, ms, '계좌미등록');
    }

    if (zeroPay.length) {
      const zeroSheet = [
        ['기사명', 'ERP ID', '최종입금', '입금은행', '입금계좌번호', '예금주', '비고'],
        ...zeroPay.map(info => [
          info.riderName,
          info.erpId,
          info.netPay,
          info.bankName,
          info.accountNumber,
          info.accountHolder,
          '공제 후 0원 이하'
        ])
      ];
      const zs = window.XLSX.utils.aoa_to_sheet(zeroSheet);
      appendAccountTextColumn(zs, zeroSheet.length, 4);
      window.XLSX.utils.book_append_sheet(wb, zs, '입금0원');
    }

    const summary = [
      ['항목', '인원/행수', '설명'],
      ['정산주', ensureWeek(), `${weekLabel}(수) ~`],
      ['정산서 건수', weekList.length, '그 주 저장된 직계약 정산서'],
      ['파일 라이더칸 합', slotCount, '정산서별 N명 합(같은 사람 중복 가능)'],
      ['화면 행', rows.length, '쿠팡·배민 분리 행'],
      ['입금 시트(전원)', allPeople.length, '0원·계좌미등록 포함 · 쿠팡+배민 한 줄'],
      ['이체가능', ready.length, '최종입금>0 + 계좌완비'],
      ['계좌미등록', missing.length, '최종입금>0 이지만 계좌 없음'],
      ['입금0원', zeroPay.length, '최종입금 0원 이하'],
      ['검증', ready.length + missing.length + zeroPay.length, '입금 시트 전원과 같아야 함']
    ];
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(summary), '인원요약');

    window.XLSX.writeFile(wb, `최종입금_${ensureWeek()}.xlsx`);
    showToast(`엑셀 저장 · 입금 전원 ${allPeople.length}명 (이체가능 ${ready.length} · 계좌미등록 ${missing.length} · 0원 ${zeroPay.length})`);
  }

  // --- 데이터 로딩 ----------------------------------------------------------

  async function loadWithdrawals() {
    const week = ensureWeek();
    try {
      const fetchApi = window.BremStorage?.payrollWithdrawal?.fetchFromAdminApi;
      if (typeof fetchApi === 'function') {
        state.withdrawals = await fetchApi({ weekStart: week });
        return;
      }
    } catch (error) {
      console.warn('[BREM] final-deposit: withdrawal fetch failed, fallback to cache:', error);
    }
    state.withdrawals = window.BremStorage?.payrollWithdrawal?.getAll?.() || [];
  }

  async function reload() {
    await window.BremStorage?.ensureSectionLoaded?.('final-deposit');
    await loadWithdrawals();
    render();
    showToast('최종입금 내역을 다시 불러왔습니다.');
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;

    $('#finalDepositWeekPrevBtn')?.addEventListener('click', () => shiftWeek(-1));
    $('#finalDepositWeekNextBtn')?.addEventListener('click', () => shiftWeek(1));
    $('#finalDepositReloadBtn')?.addEventListener('click', () => { void reload(); });
    $('#finalDepositExportBtn')?.addEventListener('click', exportExcel);

    const section = $('#final-deposit');
    if (!section) return;

    section.addEventListener('change', event => {
      const settlementChk = event.target.closest('[data-fd-settlement]');
      if (settlementChk) {
        const id = String(settlementChk.dataset.fdSettlement);
        if (settlementChk.checked) state.excludedSettlementIds.delete(id);
        else state.excludedSettlementIds.add(id);
        render();
        return;
      }
      if (event.target.id === 'finalDepositSettlementAll') {
        if (event.target.checked) state.excludedSettlementIds.clear();
        else weekSettlements().forEach(record => state.excludedSettlementIds.add(String(record.id)));
        render();
        return;
      }
      const driverChk = event.target.closest('[data-fd-driver]');
      if (driverChk) {
        const key = String(driverChk.dataset.fdDriver);
        if (driverChk.checked) state.excludedDriverKeys.delete(key);
        else state.excludedDriverKeys.add(key);
        render();
        return;
      }
      if (event.target.id === 'finalDepositSelectAll') {
        if (event.target.checked) state.excludedDriverKeys.clear();
        else mergedRows().forEach(row => state.excludedDriverKeys.add(row.key));
        render();
      }
    });
  }

  async function refresh() {
    if (!$('#finalDepositRows')) return;
    ensureWeek();
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('final-deposit');
    await loadWithdrawals();
    render();
  }

  function init() {
    if (!$('#finalDepositRows')) return;
    bindEvents();
  }

  return { init, refresh, state, onWeekPicked: setWeek };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremFinalDeposit.init();
});

if (typeof window !== 'undefined') window.BremFinalDeposit = BremFinalDeposit;

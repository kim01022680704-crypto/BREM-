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

    listEl.innerHTML = list.map(record => {
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
    }).join('');

    const allChk = $('#finalDepositSettlementAll');
    if (allChk) allChk.checked = list.every(record => !state.excludedSettlementIds.has(String(record.id)));
  }

  // --- 기사 단위 합산 -------------------------------------------------------

  // 쿠팡·배민을 한 사람으로 묶는 키. 기사 매칭이 안 된 줄은 플랫폼+ID로 따로 둔다.
  function driverKey(row) {
    if (row.driverId) return `d:${row.driverId}`;
    return `u:${row.platform}:${row.idLabel}:${row.name}`;
  }

  function mergedRows() {
    const numericKeys = Calc().NUMERIC_KEYS;
    const byDriver = new Map();

    // 여러 지역 정산서에 걸쳐 같은 사람의 같은 플랫폼 출금이 중복 반영되지 않도록
    // 선정산 맵과 소비(consumed) 집합을 정산서들 사이에서 공유한다.
    const week = ensureWeek();
    const prepaidMap = Calc().buildWeekPrepaidByPlatform(state.withdrawals, week);
    const consumed = new Set();
    checkedSettlements().forEach(settlement => {
      Calc().computeRows(settlement, {
        withdrawals: state.withdrawals,
        _prepaidMap: prepaidMap,
        _consumed: consumed
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
      checked: !state.excludedDriverKeys.has(row.key)
    }));
    return Calc().sortByName(rows);
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

    body.innerHTML = rows.map(row => `
      <tr class="${row.checked ? '' : 'final-deposit-row-off'}">
        <td class="final-deposit-check-td"><input type="checkbox" data-fd-driver="${escapeHtml(row.key)}"${row.checked ? ' checked' : ''}></td>
        ${cols.map(col => cellHtml(col, row)).join('')}
      </tr>`).join('');

    const allChk = $('#finalDepositSelectAll');
    if (allChk) allChk.checked = rows.every(row => row.checked);

    const picked = rows.filter(row => row.checked);
    const totals = Calc().sumRows(picked);
    if (summaryEl) {
      summaryEl.innerHTML = `체크 <strong>${picked.length}</strong>명 / 전체 ${rows.length}명`
        + ` · 지급합계 <strong>${formatNumber(totals.grossPay)}</strong>`
        + ` · 공제합계 <strong>${formatNumber(totals.deductTotal)}</strong>`
        + ` · 선정산(처리완료) <strong>${formatNumber(totals.prepaid)}</strong>`
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

    // 반영 기준: 실제 최종입금에 합쳐지는 정산서(체크된 것)의 (사람, 플랫폼) 존재 여부
    const presentSet = new Set();
    checkedSettlements().forEach(settlement => {
      const platform = Calc().normalizePlatform(settlement.platform);
      (Array.isArray(settlement.riders) ? settlement.riders : []).forEach(rider => {
        const key = canon(String(rider.matchedRiderId || '').trim());
        if (key) presentSet.add(`${key}:${platform}`);
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
      const reflected = platform && key && presentSet.has(`${key}:${platform}`);
      if (reflected) return;
      const reason = !platform
        ? '플랫폼 미지정'
        : `${platformLabel(platform)} 정산서 없음`;
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

  function exportExcel() {
    const rows = mergedRows().filter(row => row.checked);
    if (!rows.length) {
      showToast('체크된 기사가 없습니다.');
      return;
    }
    if (!window.XLSX) {
      showToast('엑셀 모듈을 불러오지 못했습니다.');
      return;
    }
    const cols = columns();
    const detail = [
      cols.map(col => col.label),
      ...rows.map(row => cols.map(col => row[col.key]))
    ];
    // 2시트: 은행 이체용. 받는사람=예금주, 비고=BREM 로그인ID.
    const transfer = [
      ['입금은행', '입금계좌번호', '입금액', '받는사람', '비고'],
      ...rows.map(row => {
        const driver = driverForRow(row);
        return [
          String(driver?.bankName || '').trim(),
          String(driver?.accountNumber || '').trim(),
          Number(row.netPay) || 0,
          String(driver?.accountHolder || '').trim(),
          loginIdForDriver(driver)
        ];
      })
    ];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(detail), '최종입금');
    const transferSheet = window.XLSX.utils.aoa_to_sheet(transfer);
    // 계좌번호가 숫자로 깨지지 않게 텍스트로 고정한다.
    for (let r = 1; r < transfer.length; r += 1) {
      const cell = transferSheet[window.XLSX.utils.encode_cell({ r, c: 1 })];
      if (cell && cell.v !== undefined && cell.v !== '') {
        cell.t = 's';
        cell.v = String(cell.v);
        cell.z = '@';
      }
    }
    window.XLSX.utils.book_append_sheet(wb, transferSheet, '입금');
    window.XLSX.writeFile(wb, `최종입금_${ensureWeek()}.xlsx`);
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

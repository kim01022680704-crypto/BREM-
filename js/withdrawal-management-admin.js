const BremWithdrawalManagementAdmin = (function () {
  const $ = selector => document.querySelector(selector);

  const HEADER_MARKERS = ['erp', 'id', '아이디', '배민', 'baemin', '금액', 'amount', '이체', '은행'];

  const state = {
    rows: [],
    unmatched: [],
    busy: false
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function parseMoney(value) {
    return window.BremPayrollSlipUtils?.parseMoney?.(value)
      ?? (Number(String(value ?? '').replace(/[^\d.-]/g, '')) || 0);
  }

  function baeminIdMatchKey(value) {
    if (window.BremDriverUtils?.baeminIdMatchKey) {
      return window.BremDriverUtils.baeminIdMatchKey(value);
    }
    if (window.BremWeeklySettlement?.baeminIdMatchKey) {
      return window.BremWeeklySettlement.baeminIdMatchKey(value);
    }
    const raw = String(value || '').trim().replace(/\s+/g, '');
    if (!raw) return '';
    return /^\d+$/.test(raw) ? (raw.replace(/^0+/, '') || '0') : raw.toLowerCase();
  }

  function erpIdOf(driver) {
    return String(window.BremDriverUtils?.makeDriverLoginId?.(driver) || '').replace(/\s/g, '');
  }

  function coupangIdOf(driver) {
    return String(
      window.BremDriverUtils?.getErpCoupangId?.(driver)
      || driver?.coupangLoginKey
      || driver?.coupangId
      || ''
    ).replace(/\s/g, '');
  }

  function normalizeLookup(value) {
    return String(value || '').trim().replace(/\s/g, '').toLowerCase();
  }

  function isHeaderRow(idText, amountText) {
    const id = String(idText || '').trim().toLowerCase();
    if (!id) return false;
    const amountIsNumeric = /^[\d,]+(\.\d+)?$/.test(String(amountText || '').trim().replace(/\s/g, ''));
    if (amountIsNumeric) return false;
    return HEADER_MARKERS.some(marker => id.includes(marker) || String(amountText || '').toLowerCase().includes(marker));
  }

  function splitPasteLine(line) {
    const raw = String(line || '').replace(/\u00a0/g, ' ').trim();
    if (!raw) return ['', ''];
    if (raw.includes('\t')) {
      const parts = raw.split('\t').map(part => part.trim());
      return [parts[0] || '', parts[1] || ''];
    }
    if (raw.includes(',')) {
      const parts = raw.split(',').map(part => part.trim());
      return [parts[0] || '', parts[1] || ''];
    }
    const spaced = raw.split(/\s{2,}/).map(part => part.trim()).filter(Boolean);
    if (spaced.length >= 2) return [spaced[0], spaced[1]];
    const lastSpace = raw.lastIndexOf(' ');
    if (lastSpace > 0) {
      return [raw.slice(0, lastSpace).trim(), raw.slice(lastSpace + 1).trim()];
    }
    return [raw, ''];
  }

  function parsePasteText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const rows = [];
    lines.forEach((line, index) => {
      if (!String(line || '').trim()) return;
      const [idText, amountText] = splitPasteLine(line);
      if (isHeaderRow(idText, amountText)) return;
      const id = String(idText || '').trim();
      const amount = Math.round(parseMoney(amountText));
      if (!id && !amount) return;
      rows.push({
        rowNumber: index + 1,
        rawId: id,
        amount
      });
    });
    return rows;
  }

  function pushIndex(map, key, driver) {
    const k = normalizeLookup(key);
    if (!k) return;
    const list = map.get(k) || [];
    if (!list.some(item => item.id === driver.id)) list.push(driver);
    map.set(k, list);
  }

  function buildDriverIndexes(drivers) {
    const byBaemin = new Map();
    const byErp = new Map();
    (Array.isArray(drivers) ? drivers : []).forEach(driver => {
      if (!driver?.id) return;
      pushIndex(byBaemin, baeminIdMatchKey(driver.baeminId || driver.raw_data?.baeminId), driver);
      pushIndex(byErp, erpIdOf(driver), driver);
      pushIndex(byErp, coupangIdOf(driver), driver);
    });
    return { byBaemin, byErp };
  }

  function uniqueDrivers(lists) {
    const byId = new Map();
    lists.flat().forEach(driver => {
      if (driver?.id && !byId.has(driver.id)) byId.set(driver.id, driver);
    });
    return [...byId.values()];
  }

  function matchPasteRow(row, indexes) {
    const raw = String(row.rawId || '').trim();
    if (!raw) return { status: 'empty_id', reason: 'ID 없음' };
    const erpHits = indexes.byErp.get(normalizeLookup(raw)) || [];
    const baeminHits = indexes.byBaemin.get(baeminIdMatchKey(raw)) || [];
    const hits = uniqueDrivers([erpHits, baeminHits]);
    if (hits.length === 1) {
      const via = erpHits.some(item => item.id === hits[0].id) ? 'erp' : 'baemin';
      return { status: 'matched', driver: hits[0], matchBy: via };
    }
    if (hits.length > 1) {
      return {
        status: 'duplicate',
        reason: `동명이인/중복ID ${hits.length}명 (${hits.map(item => item.name || '-').join(', ')})`
      };
    }
    return { status: 'unmatched', reason: '등록된 기사가 없습니다' };
  }

  function transferRowFromDriver(driver, amount, rawId, matchBy) {
    const accountHidden = window.BremDriverUtils?.isDriverFieldHidden?.(driver, 'accountNumber');
    const accountNumber = accountHidden ? '' : String(driver?.accountNumber || '').trim();
    return {
      driverId: driver.id,
      name: String(driver?.name || '').trim() || '-',
      accountHolder: String(driver?.accountHolder || driver?.name || '').trim(),
      bankName: String(driver?.bankName || '').trim(),
      accountNumber,
      erpId: erpIdOf(driver),
      baeminId: String(driver?.baeminId || '').trim(),
      amount: Math.round(Number(amount || 0)),
      rawIds: [rawId].filter(Boolean),
      matchBy,
      lineCount: 1,
      missingAccount: !accountNumber
    };
  }

  function mergeMatched(parsed, indexes) {
    const byDriver = new Map();
    const unmatched = [];
    parsed.forEach(row => {
      const hit = matchPasteRow(row, indexes);
      if (hit.status !== 'matched') {
        unmatched.push({
          rawId: row.rawId || '(ID 없음)',
          amount: row.amount,
          reason: hit.reason || '미매칭'
        });
        return;
      }
      const prev = byDriver.get(hit.driver.id);
      if (prev) {
        prev.amount += row.amount;
        prev.lineCount += 1;
        if (row.rawId && !prev.rawIds.includes(row.rawId)) prev.rawIds.push(row.rawId);
        return;
      }
      byDriver.set(hit.driver.id, transferRowFromDriver(hit.driver, row.amount, row.rawId, hit.matchBy));
    });
    const unmatchedMerged = new Map();
    unmatched.forEach(item => {
      const key = `${item.rawId}|${item.reason}`;
      const prev = unmatchedMerged.get(key);
      if (prev) {
        prev.amount += item.amount;
        prev.lineCount += 1;
        return;
      }
      unmatchedMerged.set(key, { ...item, lineCount: 1 });
    });
    const rows = [...byDriver.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko-KR'));
    return { rows, unmatched: [...unmatchedMerged.values()] };
  }

  function setActionEnabled(enabled) {
    const copyBtn = $('#withdrawalManageCopyBtn');
    const exportBtn = $('#withdrawalManageExportBtn');
    if (copyBtn) copyBtn.disabled = !enabled;
    if (exportBtn) exportBtn.disabled = !enabled;
  }

  function render() {
    const body = $('#withdrawalManageRows');
    const unmatchedBody = $('#withdrawalManageUnmatchedRows');
    const unmatchedBox = $('#withdrawalManageUnmatchedBox');
    const summary = $('#withdrawalManageSummary');
    if (!body) return;

    if (!state.rows.length && !state.unmatched.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty">붙여넣기 결과가 여기에 나옵니다.</td></tr>';
      if (unmatchedBody) unmatchedBody.innerHTML = '';
      if (unmatchedBox) unmatchedBox.hidden = true;
      if (summary) summary.textContent = '엑셀을 붙여넣은 뒤 「리스트 만들기」를 누르세요.';
      setActionEnabled(false);
      return;
    }

    if (!state.rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty">매칭된 기사가 없습니다. 아래 미매칭을 확인하세요.</td></tr>';
    } else {
      body.innerHTML = state.rows.map(row => {
        const accountClass = row.missingAccount ? 'promotion-status-no' : '';
        const accountText = row.missingAccount ? '계좌 없음' : escapeHtml(row.accountNumber);
        const mergeNote = row.lineCount > 1 ? ` <span class="muted-inline">(${row.lineCount}줄 합산)</span>` : '';
        return `<tr>
          <td>${escapeHtml(row.bankName || '-')}</td>
          <td class="${accountClass}">${accountText}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.erpId || '-')}</td>
          <td class="weekly-amount-cell">${formatNumber(row.amount)}${mergeNote}</td>
        </tr>`;
      }).join('');
    }

    if (unmatchedBox) unmatchedBox.hidden = !state.unmatched.length;
    if (unmatchedBody) {
      unmatchedBody.innerHTML = state.unmatched.map(item => `
        <tr class="promotion-row-unpaid">
          <td>${escapeHtml(item.rawId)}</td>
          <td class="weekly-amount-cell">${formatNumber(item.amount)}</td>
          <td class="promotion-status-no">${escapeHtml(item.reason)}</td>
        </tr>
      `).join('');
    }

    const total = state.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const missingAccount = state.rows.filter(row => row.missingAccount).length;
    if (summary) {
      summary.innerHTML = `이체 목록 <strong>${formatNumber(state.rows.length)}</strong>명 · 합계 <strong>${formatNumber(total)}</strong>원`
        + (missingAccount ? ` · 계좌없음 <strong class="promotion-status-no">${missingAccount}</strong>명` : '')
        + (state.unmatched.length ? ` · 미매칭 <strong class="promotion-status-no">${state.unmatched.length}</strong>건` : '');
    }
    setActionEnabled(state.rows.length > 0);
  }

  async function ensureDrivers() {
    await window.BremStorage?.ensureSectionLoaded?.('withdrawal-management');
    if (typeof window.BremStorage?.awaitDriversFullyLoaded === 'function') {
      await window.BremStorage.awaitDriversFullyLoaded({ includeInactive: true });
    }
    return window.BremStorage?.drivers?.getAll?.() || [];
  }

  async function parseAndRender() {
    if (state.busy) return;
    const text = String($('#withdrawalManagePaste')?.value || '');
    if (!text.trim()) {
      showToast('엑셀에서 복사한 내용을 붙여넣으세요.');
      return;
    }
    const parsed = parsePasteText(text);
    if (!parsed.length) {
      showToast('행을 인식하지 못했습니다. A열 ID · B열 금액을 확인하세요.');
      return;
    }
    state.busy = true;
    const parseBtn = $('#withdrawalManageParseBtn');
    if (parseBtn) parseBtn.disabled = true;
    try {
      showToast('기사 목록을 맞추는 중입니다…');
      const drivers = await ensureDrivers();
      const indexes = buildDriverIndexes(drivers);
      const next = mergeMatched(parsed, indexes);
      state.rows = next.rows;
      state.unmatched = next.unmatched;
      render();
      const merged = parsed.length - next.rows.length - next.unmatched.length;
      showToast(`리스트 ${next.rows.length}명 · 미매칭 ${next.unmatched.length}건${merged > 0 ? ` · ${merged}줄 합산` : ''}`);
    } catch (error) {
      console.error('[withdrawal-management] parse failed:', error);
      showToast(error?.message || '리스트를 만들지 못했습니다.');
    } finally {
      state.busy = false;
      if (parseBtn) parseBtn.disabled = false;
    }
  }

  function copyList() {
    if (!state.rows.length) {
      showToast('복사할 목록이 없습니다.');
      return;
    }
    const text = [
      ['은행', '계좌번호', '이름', 'ERP ID', '금액'].join('\t'),
      ...state.rows.map(row => [
        row.bankName || '',
        row.accountNumber || '',
        row.name || '',
        row.erpId || '',
        row.amount || 0
      ].join('\t'))
    ].join('\n');
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(
        () => showToast(`이체 목록 ${state.rows.length}명을 복사했습니다.`),
        () => showToast('복사에 실패했습니다. 표에서 직접 선택해 복사하세요.')
      );
      return;
    }
    showToast('이 브라우저에서는 복사를 지원하지 않습니다.');
  }

  function exportExcel() {
    if (!window.XLSX) {
      showToast('엑셀 모듈을 불러오지 못했습니다.');
      return;
    }
    if (!state.rows.length) {
      showToast('내보낼 목록이 없습니다.');
      return;
    }
    const transfer = [
      ['입금은행', '입금계좌번호', '신청금액', '받는사람', '비고'],
      ...state.rows.map(row => [
        row.bankName || '',
        row.accountNumber || '',
        Number(row.amount) || 0,
        row.accountHolder || row.name || '',
        row.erpId || ''
      ])
    ];
    const sheet = window.XLSX.utils.aoa_to_sheet(transfer);
    for (let r = 1; r < transfer.length; r += 1) {
      const cell = sheet[window.XLSX.utils.encode_cell({ r, c: 1 })];
      if (cell && cell.v !== undefined && cell.v !== '') {
        cell.t = 's';
        cell.v = String(cell.v);
        cell.z = '@';
      }
    }
    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, sheet, '대량이체');
    const today = new Date().toISOString().slice(0, 10);
    window.XLSX.writeFile(workbook, `출금관리_대량이체_${today}.xlsx`);
    showToast(`대량이체 엑셀 ${state.rows.length}명을 내려받았습니다.`);
  }

  function clearAll() {
    state.rows = [];
    state.unmatched = [];
    const paste = $('#withdrawalManagePaste');
    if (paste) paste.value = '';
    render();
    showToast('출금 목록을 비웠습니다.');
  }

  function bindEvents() {
    if (bindEvents.bound) return;
    bindEvents.bound = true;
    $('#withdrawalManageParseBtn')?.addEventListener('click', () => { void parseAndRender(); });
    $('#withdrawalManageCopyBtn')?.addEventListener('click', copyList);
    $('#withdrawalManageExportBtn')?.addEventListener('click', exportExcel);
    $('#withdrawalManageClearBtn')?.addEventListener('click', clearAll);
    $('#withdrawalManagePaste')?.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void parseAndRender();
      }
    });
  }

  async function refresh() {
    if (!$('#withdrawalManageCard')) return;
    bindEvents();
    await window.BremStorage?.ensureSectionLoaded?.('withdrawal-management');
    render();
  }

  function init() {
    if (!$('#withdrawalManageCard')) return;
    bindEvents();
  }

  return { init, refresh };
})();

document.addEventListener('DOMContentLoaded', () => {
  BremWithdrawalManagementAdmin.init();
});

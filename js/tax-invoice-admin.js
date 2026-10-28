// 계산서 관리 — 수~화 주차, 배민/쿠팡 엑셀 합계 등록
const BremTaxInvoiceAdmin = (function () {
  const $ = selector => document.querySelector(selector);
  const Parse = () => BremTaxInvoiceParse;

  const PLATFORMS = ['baemin', 'coupang'];
  const monthState = { month: '' };
  let monthPicker = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString('ko-KR');
  }

  function showToast(message) {
    document.dispatchEvent(new CustomEvent('brem-admin-toast', { detail: { message } }));
  }

  function platformLabel(platform) {
    return platform === 'coupang' ? '쿠팡' : '배민';
  }

  function fieldsFor(platform) {
    const parse = Parse();
    return platform === 'coupang' ? parse.COUPANG_FIELDS : parse.BAEMIN_FIELDS;
  }

  function baeminNetPay(row) {
    return Number(Parse()?.baeminNetPay?.(row) || 0);
  }

  function hasNetPay(platform) {
    return platform === 'baemin';
  }

  function dateKeyFromDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function paintWeek(platform, value) {
    const picker = typeof BremDatePicker !== 'undefined' ? BremDatePicker : null;
    const hidden = $(`#taxInvoiceWeek-${platform}`);
    const button = $(`#taxInvoiceWeekBtn-${platform}`);
    const range = $(`#taxInvoiceWeekRange-${platform}`);
    if (!picker || !hidden) return '';
    const normalized = picker.applyWeekWednesday(value || picker.weekStartKey());
    hidden.value = normalized;
    if (button) {
      const weekday = picker.formatWeekdayKo(normalized);
      button.textContent = weekday
        ? `${picker.formatDate(normalized)}(${weekday})`
        : picker.formatDate(normalized);
    }
    if (range) range.textContent = picker.formatWednesdayWeekRangeLong(normalized) || '';
    return normalized;
  }

  function ensureWeek(platform) {
    const hidden = $(`#taxInvoiceWeek-${platform}`);
    const current = hidden?.value || (typeof BremDatePicker !== 'undefined' ? BremDatePicker.weekStartKey() : '') || '';
    return paintWeek(platform, current);
  }

  function readList() {
    let raw = window.BremStorage?.taxInvoices?.getAll?.() || [];
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = []; }
    }
    return Array.isArray(raw) ? raw : [];
  }

  function regionKey(region) {
    return String(region || '').replace(/\s+/g, '').toLowerCase();
  }

  function guessRegion(fileName, platform) {
    const weekly = window.BremWeeklySettlement;
    const base = String(fileName || '').replace(/\.(xlsx|xls)$/i, '').trim();
    if (platform === 'baemin') {
      const parsed = weekly?.parseBaeminFileName?.(fileName);
      let team = String(parsed?.teamName || '').trim();
      if (team && weekly?.canonicalBaeminTeamRegion) {
        team = weekly.canonicalBaeminTeamRegion(team) || team;
      }
      if (team) return team;
    } else {
      const parsed = weekly?.parseCoupangFileName?.(fileName);
      const region = String(parsed?.region || '').trim();
      if (region) return region;
    }
    return base || String(fileName || '파일');
  }

  function weekRows(platform) {
    const weekStart = ensureWeek(platform);
    return readList()
      .filter(item => item.platform === platform && item.weekStart === weekStart)
      .sort((a, b) => String(a.region || '').localeCompare(String(b.region || ''), 'ko'));
  }

  function render(platform) {
    const body = $(`#taxInvoiceRows-${platform}`);
    const summary = $(`#taxInvoiceSummary-${platform}`);
    if (!body) return;
    const fields = fieldsFor(platform);
    const rows = weekRows(platform);
    const netCol = hasNetPay(platform) ? 1 : 0;
    const colSpan = fields.length + 3 + netCol;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colSpan}" class="empty">이 주차에 등록된 ${platformLabel(platform)} 계산서가 없습니다.</td></tr>`;
      if (summary) summary.textContent = '엑셀을 고르고 비밀번호를 입력한 뒤 「엑셀 등록」을 누르세요.';
      return;
    }
    const totals = {};
    fields.forEach(field => { totals[field.key] = 0; });
    let netTotal = 0;
    body.innerHTML = rows.map(row => {
      fields.forEach(field => {
        totals[field.key] += Number(row[field.key] || 0);
      });
      const net = hasNetPay(platform) ? baeminNetPay(row) : 0;
      netTotal += net;
      const amountCells = fields.map(field => (
        `<td class="weekly-amount-cell">${formatMoney(row[field.key])}</td>`
      )).join('');
      const netCell = hasNetPay(platform)
        ? `<td class="weekly-amount-cell">${formatMoney(net)}</td>`
        : '';
      const sheetTitle = row.sourceSheet ? `시트 ${row.sourceSheet}` : '';
      return `<tr>
        <td>${escapeHtml(row.region || '-')}</td>
        <td title="${escapeHtml(sheetTitle)}">${escapeHtml(row.fileName || '-')}</td>
        ${amountCells}
        ${netCell}
        <td><button type="button" class="small-btn danger-btn" data-tax-invoice-delete="${escapeHtml(row.id)}">삭제</button></td>
      </tr>`;
    }).join('');
    const totalCells = fields.map(field => (
      `<td class="weekly-amount-cell">${formatMoney(totals[field.key])}</td>`
    )).join('');
    const netTotalCell = hasNetPay(platform)
      ? `<td class="weekly-amount-cell">${formatMoney(netTotal)}</td>`
      : '';
    body.insertAdjacentHTML('beforeend', `<tr>
      <td colspan="2"><strong>합계 ${rows.length}건</strong></td>
      ${totalCells}
      ${netTotalCell}
      <td></td>
    </tr>`);
    if (summary) {
      summary.textContent = `${platformLabel(platform)} ${rows.length}건 · 같은 지역을 다시 올리면 그 줄이 바뀝니다.`;
    }
  }

  function refresh() {
    PLATFORMS.forEach(platform => {
      ensureWeek(platform);
      render(platform);
    });
  }

  function onWeekPicked(platform, value) {
    paintWeek(platform, value);
    render(platform);
  }

  function shiftWeek(platform, delta) {
    const picker = typeof BremDatePicker !== 'undefined' ? BremDatePicker : null;
    const current = ensureWeek(platform);
    const date = new Date(`${current}T00:00:00`);
    if (Number.isNaN(date.getTime())) return;
    date.setDate(date.getDate() + (delta * 7));
    const next = picker?.applyWeekWednesday?.(dateKeyFromDate(date)) || dateKeyFromDate(date);
    paintWeek(platform, next);
    render(platform);
  }

  async function readSheets(file, password) {
    const client = typeof BremSettlementParser !== 'undefined' ? BremSettlementParser : null;
    if (!client?.readAllSheetCellMaps) {
      throw new Error('엑셀 읽기 모듈이 없습니다. 페이지를 새로고침하세요.');
    }
    const buffer = new Uint8Array(await file.arrayBuffer());
    const sheets = await client.readAllSheetCellMaps(buffer, password);
    if (!sheets?.length) {
      throw new Error('엑셀 시트를 읽지 못했습니다.');
    }
    return sheets;
  }

  async function parseFile(file, password, platform) {
    const sheets = await readSheets(file, password);
    const parse = Parse();
    const picked = parse.pickSheet(
      sheets,
      platform === 'coupang' ? parse.extractCoupang : parse.extractBaemin
    );
    if (!picked) {
      if (platform === 'coupang') {
        throw new Error('공급가액·총합계금액·총실지급액 항목을 찾지 못했습니다.');
      }
      throw new Error('공급가액 B31, 부가세액 C31, 공급대가 D31 칸을 읽지 못했습니다.');
    }
    return {
      region: guessRegion(file.name, platform),
      fileName: file.name,
      sourceSheet: picked.sheetName,
      amounts: picked.amounts
    };
  }

  async function upload(platform) {
    const fileInput = $(`#taxInvoiceFiles-${platform}`);
    const passwordInput = $(`#taxInvoicePassword-${platform}`);
    const button = $(`#taxInvoiceUploadBtn-${platform}`);
    const errorsEl = $(`#taxInvoiceErrors-${platform}`);
    const files = Array.from(fileInput?.files || []);
    const password = String(passwordInput?.value || '');
    if (!password.trim()) {
      showToast('엑셀 비밀번호를 입력하세요.');
      return;
    }
    if (!files.length) {
      showToast('엑셀 파일을 선택하세요. 여러 개도 한 번에 고를 수 있습니다.');
      return;
    }
    const weekStart = ensureWeek(platform);
    if (!weekStart) {
      showToast('정산 주(수요일)를 선택하세요.');
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = `0/${files.length} 읽는 중`;
    }
    if (errorsEl) errorsEl.textContent = '';

    const parsed = [];
    const errors = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (button) button.textContent = `${i + 1}/${files.length} 읽는 중`;
      try {
        parsed.push(await parseFile(file, password, platform));
      } catch (error) {
        errors.push(`${file.name}: ${error.message || '읽기 실패'}`);
      }
    }

    if (parsed.length) {
      const list = readList();
      let replaced = 0;
      parsed.forEach(item => {
        const key = regionKey(item.region);
        const index = list.findIndex(row => (
          row.platform === platform
          && row.weekStart === weekStart
          && regionKey(row.region) === key
        ));
        const record = {
          id: index >= 0 ? list[index].id : (window.BremStorage?.createId?.() || `inv_${Date.now()}`),
          platform,
          weekStart,
          region: item.region,
          fileName: item.fileName,
          sourceSheet: item.sourceSheet,
          uploadedAt: new Date().toISOString(),
          ...item.amounts
        };
        if (index >= 0) {
          list[index] = record;
          replaced += 1;
        } else {
          list.push(record);
        }
      });
      try {
        const result = window.BremStorage?.taxInvoices?.saveAll?.(list);
        if (window.BremStorage?.awaitPersist) await window.BremStorage.awaitPersist(result);
        const fresh = parsed.length - replaced;
        showToast(`${platformLabel(platform)} 계산서 ${parsed.length}건 등록 (신규 ${fresh} · 갱신 ${replaced})`);
      } catch (error) {
        errors.push(error.message || '저장에 실패했습니다.');
      }
    }

    if (fileInput) fileInput.value = '';
    if (button) {
      button.disabled = false;
      button.textContent = '엑셀 등록';
    }
    if (errorsEl) errorsEl.textContent = errors.join('\n');
    if (!parsed.length && errors.length) showToast(errors[0]);
    render(platform);
  }

  async function removeRecord(id) {
    const list = readList();
    const row = list.find(item => item.id === id);
    if (!row) return;
    const label = `${row.region || row.fileName || '이 계산서'}`;
    if (!window.confirm(`${label} 계산서를 이 주차에서 삭제할까요?`)) return;
    const next = list.filter(item => item.id !== id);
    const result = window.BremStorage?.taxInvoices?.saveAll?.(next);
    if (window.BremStorage?.awaitPersist) await window.BremStorage.awaitPersist(result);
    showToast('계산서를 삭제했습니다.');
    render(row.platform);
  }

  function amountHeaders(platform) {
    const headers = ['지역', '파일', ...fieldsFor(platform).map(field => field.label)];
    if (hasNetPay(platform)) headers.push('실지급액');
    return headers;
  }

  function amountLine(platform, row) {
    const line = fieldsFor(platform).map(field => Number(row[field.key] || 0));
    if (hasNetPay(platform)) line.push(baeminNetPay(row));
    return line;
  }

  function writeWorkbook(filename, sheets) {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return false;
    }
    const workbook = window.XLSX.utils.book_new();
    sheets.forEach(sheet => {
      const worksheet = window.XLSX.utils.aoa_to_sheet(sheet.rows);
      worksheet['!cols'] = sheet.rows[0].map((cell, index) => (
        { wch: index < 2 ? 18 : 16 }
      ));
      const name = String(sheet.name || '계산서').slice(0, 31);
      window.XLSX.utils.book_append_sheet(workbook, worksheet, name);
    });
    window.XLSX.writeFile(workbook, filename);
    return true;
  }

  function exportWeek(platform) {
    const rows = weekRows(platform);
    if (!rows.length) {
      showToast('이 주차에 보낼 계산서가 없습니다.');
      return;
    }
    const fields = fieldsFor(platform);
    const header = amountHeaders(platform);
    const body = rows.map(row => [row.region || '', row.fileName || '', ...amountLine(platform, row)]);
    const totals = fields.map(field => rows.reduce((sum, row) => sum + Number(row[field.key] || 0), 0));
    if (hasNetPay(platform)) totals.push(rows.reduce((sum, row) => sum + baeminNetPay(row), 0));
    const weekStart = ensureWeek(platform);
    const ok = writeWorkbook(`계산서_${platformLabel(platform)}_${weekStart}.xlsx`, [{
      name: platformLabel(platform),
      rows: [header, ...body, ['합계', `${rows.length}건`, ...totals]]
    }]);
    if (ok) showToast(`${platformLabel(platform)} 계산서 ${rows.length}건을 엑셀로 보냈습니다.`);
  }

  function currentMonthKey() {
    return (typeof BremDatePicker !== 'undefined' && BremDatePicker.currentMonth)
      ? BremDatePicker.currentMonth()
      : new Date().toISOString().slice(0, 7);
  }

  function formatMonthLabel(value) {
    if (typeof BremDatePicker !== 'undefined' && BremDatePicker.formatMonthLabel) {
      return BremDatePicker.formatMonthLabel(value, '월 선택');
    }
    if (!value) return '월 선택';
    const [year, month] = String(value).split('-');
    return `${year}년 ${Number(month)}월`;
  }

  function ensureMonth() {
    if (/^\d{4}-\d{2}$/.test(monthState.month)) return monthState.month;
    const latest = readList()
      .map(item => String(item.weekStart || '').slice(0, 7))
      .filter(value => /^\d{4}-\d{2}$/.test(value))
      .sort()
      .pop();
    monthState.month = latest || currentMonthKey();
    return monthState.month;
  }

  function shortWeek(weekStart) {
    const match = String(weekStart || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (!match) return String(weekStart || '');
    return `${Number(match[1])}/${Number(match[2])}`;
  }

  function monthSourceRows(platform, month) {
    return readList().filter(item => (
      item.platform === platform && String(item.weekStart || '').slice(0, 7) === month
    ));
  }

  function monthRegionRows(platform, month) {
    const fields = fieldsFor(platform);
    const grouped = new Map();
    monthSourceRows(platform, month).forEach(row => {
      const key = regionKey(row.region) || String(row.id || row.fileName || '');
      if (!grouped.has(key)) {
        const amounts = {};
        fields.forEach(field => { amounts[field.key] = 0; });
        grouped.set(key, {
          region: row.region || '-',
          weeks: new Set(),
          fileCount: 0,
          amounts
        });
      }
      const bucket = grouped.get(key);
      bucket.weeks.add(row.weekStart);
      bucket.fileCount += 1;
      fields.forEach(field => {
        bucket.amounts[field.key] += Number(row[field.key] || 0);
      });
    });
    return [...grouped.values()]
      .map(bucket => ({
        region: bucket.region,
        weeks: [...bucket.weeks].filter(Boolean).sort(),
        fileCount: bucket.fileCount,
        ...bucket.amounts
      }))
      .sort((a, b) => String(a.region).localeCompare(String(b.region), 'ko'));
  }

  function renderMonthTable(platform) {
    const body = $(`#taxInvoiceMonthRows-${platform}`);
    if (!body) return { rows: [], weeks: [] };
    const month = ensureMonth();
    const fields = fieldsFor(platform);
    const rows = monthRegionRows(platform, month);
    const weeks = [...new Set(monthSourceRows(platform, month).map(row => row.weekStart))].filter(Boolean).sort();
    const netCol = hasNetPay(platform) ? 1 : 0;
    const colSpan = fields.length + 2 + netCol;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colSpan}" class="empty">${formatMonthLabel(month)}에 등록된 ${platformLabel(platform)} 계산서가 없습니다.</td></tr>`;
      return { rows, weeks };
    }
    const totals = {};
    fields.forEach(field => { totals[field.key] = 0; });
    let netTotal = 0;
    body.innerHTML = rows.map(row => {
      fields.forEach(field => { totals[field.key] += Number(row[field.key] || 0); });
      const net = hasNetPay(platform) ? baeminNetPay(row) : 0;
      netTotal += net;
      const weekTitle = row.weeks.map(shortWeek).join(', ');
      const amountCells = fields.map(field => (
        `<td class="weekly-amount-cell">${formatMoney(row[field.key])}</td>`
      )).join('');
      const netCell = hasNetPay(platform)
        ? `<td class="weekly-amount-cell">${formatMoney(net)}</td>`
        : '';
      return `<tr>
        <td>${escapeHtml(row.region)}</td>
        <td title="${escapeHtml(weekTitle)}">${row.weeks.length}주 · ${row.fileCount}건</td>
        ${amountCells}
        ${netCell}
      </tr>`;
    }).join('');
    const totalCells = fields.map(field => (
      `<td class="weekly-amount-cell">${formatMoney(totals[field.key])}</td>`
    )).join('');
    const netTotalCell = hasNetPay(platform)
      ? `<td class="weekly-amount-cell">${formatMoney(netTotal)}</td>`
      : '';
    body.insertAdjacentHTML('beforeend', `<tr>
      <td colspan="2"><strong>합계 ${rows.length}지역</strong></td>
      ${totalCells}
      ${netTotalCell}
    </tr>`);
    return { rows, weeks };
  }

  function renderMonthly() {
    const month = ensureMonth();
    const label = $('#taxInvoiceMonthLabel');
    const hidden = $('#taxInvoiceMonth');
    if (label) label.textContent = formatMonthLabel(month);
    if (hidden) hidden.value = month;
    const baemin = renderMonthTable('baemin');
    const coupang = renderMonthTable('coupang');
    const weeks = [...new Set([...baemin.weeks, ...coupang.weeks])].sort();
    const range = $('#taxInvoiceMonthRange');
    if (range) {
      const weekText = weeks.length ? weeks.map(shortWeek).join(', ') : '등록된 주 없음';
      range.textContent = `${formatMonthLabel(month)} · 정산주(수요일)가 이 달인 계산서 · ${weekText}`;
    }
    const summary = $('#taxInvoiceMonthSummary');
    if (summary) {
      summary.textContent = `배민 ${baemin.rows.length}지역 · 쿠팡 ${coupang.rows.length}지역`
        + ' · 같은 지역은 그 달 주차를 더한 값입니다. 배민 실지급액은 공급대가에서 보험 5항목을 뺀 값입니다.';
    }
    const exportBtn = $('#taxInvoiceMonthExportBtn');
    if (exportBtn) exportBtn.disabled = !baemin.rows.length && !coupang.rows.length;
  }

  function setMonth(value) {
    const next = String(value || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(next) || next === monthState.month) return;
    monthState.month = next;
    renderMonthly();
  }

  function shiftMonth(deltaMonths) {
    const base = ensureMonth();
    const [year, month] = base.split('-').map(Number);
    const date = new Date(year, month - 1 + deltaMonths, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthState.month = next;
    monthPicker?.setMonth?.(next);
    renderMonthly();
  }

  function exportMonth() {
    const month = ensureMonth();
    const sheets = PLATFORMS.map(platform => {
      const rows = monthRegionRows(platform, month);
      if (!rows.length) return null;
      const fields = fieldsFor(platform);
      const header = ['지역', '주차', ...fields.map(field => field.label)];
      if (hasNetPay(platform)) header.push('실지급액');
      const body = rows.map(row => [
        row.region,
        row.weeks.map(shortWeek).join(', '),
        ...amountLine(platform, row)
      ]);
      const totals = fields.map(field => rows.reduce((sum, row) => sum + Number(row[field.key] || 0), 0));
      if (hasNetPay(platform)) totals.push(rows.reduce((sum, row) => sum + baeminNetPay(row), 0));
      return {
        name: platformLabel(platform),
        rows: [header, ...body, ['합계', `${rows.length}지역`, ...totals]]
      };
    }).filter(Boolean);
    if (!sheets.length) {
      showToast('이 달에 보낼 계산서가 없습니다.');
      return;
    }
    const ok = writeWorkbook(`계산서월별_${month}.xlsx`, sheets);
    if (ok) showToast(`${formatMonthLabel(month)} 계산서를 엑셀로 보냈습니다.`);
  }

  function setupMonthPicker() {
    if (monthPicker || typeof BremDatePicker === 'undefined' || !BremDatePicker.setupMonthSingle) return;
    if (!$('#taxInvoiceMonthCalendar')) return;
    monthPicker = BremDatePicker.setupMonthSingle({
      popup: $('#taxInvoiceMonthCalendar'),
      monthsContainer: $('#taxInvoiceMonthGrid'),
      titleEl: $('#taxInvoiceMonthTitle'),
      prevBtn: $('#taxInvoiceMonthPrev'),
      nextBtn: $('#taxInvoiceMonthNext'),
      todayBtn: $('#taxInvoiceMonthThisMonth'),
      hiddenInput: $('#taxInvoiceMonth'),
      openButton: $('#taxInvoiceMonthBtn'),
      labelEl: $('#taxInvoiceMonthLabel'),
      emptyLabel: '월 선택',
      onSelect(value) {
        setMonth(value);
      }
    });
  }

  async function reloadMonthly() {
    try {
      await window.BremStorage?.ensureSectionLoaded?.('tax-invoice-monthly', { force: true });
    } catch (error) {
      showToast(error.message || '불러오지 못했습니다.');
    }
    renderMonthly();
    showToast('계산서 월별을 불러왔습니다.');
  }

  function refreshMonthly() {
    setupMonthPicker();
    ensureMonth();
    monthPicker?.setMonth?.(ensureMonth());
    renderMonthly();
  }

  function bind() {
    if (bind.done) return;
    bind.done = true;
    PLATFORMS.forEach(platform => {
      $(`#taxInvoiceForm-${platform}`)?.addEventListener('submit', event => {
        event.preventDefault();
        void upload(platform);
      });
      $(`#taxInvoiceWeekPrevBtn-${platform}`)?.addEventListener('click', () => shiftWeek(platform, -1));
      $(`#taxInvoiceWeekNextBtn-${platform}`)?.addEventListener('click', () => shiftWeek(platform, 1));
      $(`#taxInvoiceExportBtn-${platform}`)?.addEventListener('click', () => exportWeek(platform));
      $(`#taxInvoiceReloadBtn-${platform}`)?.addEventListener('click', async () => {
        try {
          await window.BremStorage?.ensureSectionLoaded?.('tax-invoice-management', { force: true });
        } catch (error) {
          showToast(error.message || '불러오지 못했습니다.');
        }
        refresh();
      });
    });
    $('#taxInvoiceMonthPrevBtn')?.addEventListener('click', () => shiftMonth(-1));
    $('#taxInvoiceMonthNextBtn')?.addEventListener('click', () => shiftMonth(1));
    $('#taxInvoiceMonthReloadBtn')?.addEventListener('click', () => { void reloadMonthly(); });
    $('#taxInvoiceMonthExportBtn')?.addEventListener('click', exportMonth);
    setupMonthPicker();
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-tax-invoice-delete]');
      if (!button) return;
      void removeRecord(button.getAttribute('data-tax-invoice-delete'));
    });
  }

  bind();

  return { refresh, refreshMonthly, onWeekPicked };
})();

window.BremTaxInvoiceAdmin = BremTaxInvoiceAdmin;

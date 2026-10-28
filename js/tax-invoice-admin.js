// 계산서 관리 — 수~화 주차, 배민/쿠팡 엑셀 합계 등록
const BremTaxInvoiceAdmin = (function () {
  const $ = selector => document.querySelector(selector);
  const Parse = () => BremTaxInvoiceParse;

  const PLATFORMS = ['baemin', 'coupang'];
  const monthState = { month: '', feeApplied: false };
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

  function baeminInsuranceSum(row) {
    const parse = Parse();
    if (parse.baeminInsuranceSum) return Number(parse.baeminInsuranceSum(row) || 0);
    return Number(row?.hourlyInsurance || 0)
      + Number(row?.employerEmploymentIns || 0)
      + Number(row?.riderEmploymentIns || 0)
      + Number(row?.employerIndustrialIns || 0)
      + Number(row?.riderIndustrialIns || 0);
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

  function fileKey(fileName) {
    return String(fileName || '').replace(/\s+/g, '').toLowerCase();
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
      .sort((a, b) => (
        String(a.region || '').localeCompare(String(b.region || ''), 'ko')
        || String(a.fileName || '').localeCompare(String(b.fileName || ''), 'ko')
      ));
  }

  function render(platform) {
    const body = $(`#taxInvoiceRows-${platform}`);
    const summary = $(`#taxInvoiceSummary-${platform}`);
    if (!body) return;
    const fields = fieldsFor(platform);
    const rows = weekRows(platform);
    const netCol = hasNetPay(platform) ? 2 : 0;
    const colSpan = fields.length + 3 + netCol;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colSpan}" class="empty">이 주차에 등록된 ${platformLabel(platform)} 계산서가 없습니다.</td></tr>`;
      if (summary) summary.textContent = '엑셀을 고르고 비밀번호를 입력한 뒤 「엑셀 등록」을 누르세요.';
      return;
    }
    const totals = {};
    fields.forEach(field => { totals[field.key] = 0; });
    let netTotal = 0;
    let insuranceTotal = 0;
    body.innerHTML = rows.map(row => {
      fields.forEach(field => {
        totals[field.key] += Number(row[field.key] || 0);
      });
      const net = hasNetPay(platform) ? baeminNetPay(row) : 0;
      const insurance = hasNetPay(platform) ? baeminInsuranceSum(row) : 0;
      netTotal += net;
      insuranceTotal += insurance;
      const amountCells = fields.map(field => (
        `<td class="weekly-amount-cell">${formatMoney(row[field.key])}</td>`
      )).join('');
      const insuranceCell = hasNetPay(platform)
        ? `<td class="weekly-amount-cell">${formatMoney(insurance)}</td>`
        : '';
      const netCell = hasNetPay(platform)
        ? `<td class="weekly-amount-cell">${formatMoney(net)}</td>`
        : '';
      const sheetTitle = row.sourceSheet ? `시트 ${row.sourceSheet}` : '';
      return `<tr>
        <td>${escapeHtml(row.region || '-')}</td>
        <td title="${escapeHtml(sheetTitle)}">${escapeHtml(row.fileName || '-')}</td>
        ${amountCells}
        ${insuranceCell}
        ${netCell}
        <td><button type="button" class="small-btn danger-btn" data-tax-invoice-delete="${escapeHtml(row.id)}">삭제</button></td>
      </tr>`;
    }).join('');
    const totalCells = fields.map(field => (
      `<td class="weekly-amount-cell">${formatMoney(totals[field.key])}</td>`
    )).join('');
    const insuranceTotalCell = hasNetPay(platform)
      ? `<td class="weekly-amount-cell">${formatMoney(insuranceTotal)}</td>`
      : '';
    const netTotalCell = hasNetPay(platform)
      ? `<td class="weekly-amount-cell">${formatMoney(netTotal)}</td>`
      : '';
    body.insertAdjacentHTML('beforeend', `<tr>
      <td colspan="2"><strong>합계 ${rows.length}건</strong></td>
      ${totalCells}
      ${insuranceTotalCell}
      ${netTotalCell}
      <td></td>
    </tr>`);
    if (summary) {
      summary.textContent = `${platformLabel(platform)} ${rows.length}건 · 한 지역에 파일이 여러 개면 전부 남고 합계에 더합니다. 같은 파일 이름만 다시 올리면 그 줄이 바뀝니다.`;
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

  async function loadSavedList() {
    const local = readList();
    try {
      await window.BremStorage?.ensureSectionLoaded?.('tax-invoice-management', { force: true });
    } catch {
      // 서버를 다시 못 읽어도 화면에 있던 목록은 유지한다.
    }
    const remote = readList();
    const merged = new Map();
    const put = row => {
      if (!row || typeof row !== 'object') return;
      const id = String(row.id || '').trim();
      const key = id || `${row.platform}|${row.weekStart}|${fileKey(row.fileName)}`;
      if (!merged.has(key)) merged.set(key, row);
    };
    remote.forEach(put);
    local.forEach(row => {
      if (!row || typeof row !== 'object') return;
      const id = String(row.id || '').trim();
      const key = id || `${row.platform}|${row.weekStart}|${fileKey(row.fileName)}`;
      merged.set(key, row);
    });
    return [...merged.values()];
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
        throw new Error('공급가액 F19, 부가세 G19, 총합계금액 H19 칸을 읽지 못했습니다.');
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
      const list = await loadSavedList();
      let replaced = 0;
      parsed.forEach((item, itemIndex) => {
        const key = fileKey(item.fileName);
        const index = list.findIndex(row => (
          row.platform === platform
          && row.weekStart === weekStart
          && fileKey(row.fileName) === key
        ));
        const record = {
          id: index >= 0 ? list[index].id : (window.BremStorage?.createId?.() || `inv_${Date.now()}_${itemIndex}`),
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
        showToast(replaced
          ? `${platformLabel(platform)} 계산서 ${fresh}건 추가, 같은 파일 ${replaced}건만 바꿨습니다. 다른 파일은 그대로입니다.`
          : `${platformLabel(platform)} 계산서 ${fresh}건을 추가했습니다. 먼저 올린 파일은 그대로입니다.`);
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
    if (hasNetPay(platform)) headers.push('보험료합계', '실지급액');
    return headers;
  }

  function amountLine(platform, row) {
    const line = fieldsFor(platform).map(field => Number(row[field.key] || 0));
    if (hasNetPay(platform)) {
      line.push(baeminInsuranceSum(row));
      line.push(baeminNetPay(row));
    }
    return line;
  }

  function writeWorkbook(filename, sheets) {
    if (!window.XLSX) {
      showToast('엑셀 라이브러리를 불러오지 못했습니다.');
      return false;
    }
    const workbook = window.XLSX.utils.book_new();
    sheets.forEach(sheet => {
      const rows = sheet.rows || [];
      const worksheet = window.XLSX.utils.aoa_to_sheet(rows);
      const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
      worksheet['!cols'] = Array.from({ length: colCount }, () => ({ wch: 10 }));
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
    if (hasNetPay(platform)) {
      totals.push(rows.reduce((sum, row) => sum + baeminInsuranceSum(row), 0));
      totals.push(rows.reduce((sum, row) => sum + baeminNetPay(row), 0));
    }
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

  function monthDetailRows(platform, month) {
    return monthSourceRows(platform, month).slice().sort((a, b) => (
      String(a.weekStart || '').localeCompare(String(b.weekStart || ''))
      || String(a.region || '').localeCompare(String(b.region || ''), 'ko')
      || String(a.fileName || '').localeCompare(String(b.fileName || ''), 'ko')
    ));
  }

  function weekLabel(weekStart) {
    const picker = typeof BremDatePicker !== 'undefined' ? BremDatePicker : null;
    return picker?.formatWednesdayWeekRange?.(weekStart) || shortWeek(weekStart);
  }

  function feeOn(explicit) {
    return explicit == null ? monthState.feeApplied : Boolean(explicit);
  }

  function shownAmount(platform, row, field, useFee) {
    const raw = Number(row[field.key] || 0);
    if (!feeOn(useFee)) return raw;
    const parse = Parse();
    if (field.key === 'supplyAmount' || field.key === 'vatAmount') return parse.deductTwoPercent(raw);
    if (platform === 'baemin' && field.key === 'supplyTotal') return parse.invoiceAmountAfterFee(row);
    if (platform === 'coupang' && field.key === 'subtotal') return parse.invoiceAmountAfterFee(row);
    if (platform === 'coupang' && field.key === 'netPay') return parse.coupangNetPayAfterFee(row);
    return raw;
  }

  function shownNet(platform, row, useFee) {
    if (platform !== 'baemin') return 0;
    const parse = Parse();
    return feeOn(useFee) ? parse.baeminNetPayAfterFee(row) : baeminNetPay(row);
  }

  function fieldLabel(platform, field, useFee) {
    if (!feeOn(useFee)) return field.label;
    if (field.key === 'supplyAmount') return '공급가액(2%적용)';
    if (field.key === 'vatAmount') return field.label === '부가세' ? '부가세(2%적용)' : '부가세액(2%적용)';
    if (platform === 'baemin' && field.key === 'supplyTotal') return '계산서 금액';
    if (platform === 'coupang' && field.key === 'subtotal') return '계산서 금액';
    if (platform === 'coupang' && field.key === 'netPay') return '실지급액';
    return field.label;
  }

  function paintMonthHeaders() {
    const fee = monthState.feeApplied;
    const baeminTotal = $('#taxInvoiceMonthHead-baemin-supplyTotal');
    if (baeminTotal) baeminTotal.textContent = fee ? '계산서 금액' : '공급대가';
    const coupangSum = $('#taxInvoiceMonthHead-coupang-subtotal');
    if (coupangSum) coupangSum.textContent = fee ? '계산서 금액' : '합계';
    const coupangNet = $('#taxInvoiceMonthHead-coupang-netPay');
    if (coupangNet) coupangNet.textContent = fee ? '실지급액' : '총실지급액';
    const button = $('#taxInvoiceMonthFeeBtn');
    if (button) {
      button.textContent = fee ? '2% 계산식 해제' : '2% 계산식 적용';
      button.classList.toggle('active', fee);
    }
  }

  function renderMonthTable(platform) {
    const body = $(`#taxInvoiceMonthRows-${platform}`);
    if (!body) return { rows: [], weeks: [] };
    const month = ensureMonth();
    const fields = fieldsFor(platform);
    const rows = monthDetailRows(platform, month);
    const weeks = [...new Set(rows.map(row => row.weekStart))].filter(Boolean).sort();
    const netCol = hasNetPay(platform) ? 2 : 0;
    const colSpan = fields.length + 3 + netCol;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="${colSpan}" class="empty">${formatMonthLabel(month)}에 등록된 ${platformLabel(platform)} 계산서가 없습니다.</td></tr>`;
      return { rows, weeks };
    }
    const totals = {};
    fields.forEach(field => { totals[field.key] = 0; });
    let netTotal = 0;
    let insuranceTotal = 0;
    body.innerHTML = rows.map(row => {
      fields.forEach(field => { totals[field.key] += shownAmount(platform, row, field); });
      const net = shownNet(platform, row);
      const insurance = hasNetPay(platform) ? baeminInsuranceSum(row) : 0;
      netTotal += net;
      insuranceTotal += insurance;
      const amountCells = fields.map(field => (
        `<td class="weekly-amount-cell">${formatMoney(shownAmount(platform, row, field))}</td>`
      )).join('');
      const insuranceCell = hasNetPay(platform)
        ? `<td class="weekly-amount-cell">${formatMoney(insurance)}</td>`
        : '';
      const netCell = hasNetPay(platform)
        ? `<td class="weekly-amount-cell">${formatMoney(net)}</td>`
        : '';
      return `<tr>
        <td>${escapeHtml(weekLabel(row.weekStart))}</td>
        <td>${escapeHtml(row.region || '-')}</td>
        <td>${escapeHtml(row.fileName || '-')}</td>
        ${amountCells}
        ${insuranceCell}
        ${netCell}
      </tr>`;
    }).join('');
    const totalCells = fields.map(field => (
      `<td class="weekly-amount-cell">${formatMoney(totals[field.key])}</td>`
    )).join('');
    const insuranceTotalCell = hasNetPay(platform)
      ? `<td class="weekly-amount-cell">${formatMoney(insuranceTotal)}</td>`
      : '';
    const netTotalCell = hasNetPay(platform)
      ? `<td class="weekly-amount-cell">${formatMoney(netTotal)}</td>`
      : '';
    body.insertAdjacentHTML('beforeend', `<tr>
      <td colspan="3"><strong>합계 ${rows.length}건</strong></td>
      ${totalCells}
      ${insuranceTotalCell}
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
    paintMonthHeaders();
    const weeks = [...new Set([...baemin.weeks, ...coupang.weeks])].sort();
    const range = $('#taxInvoiceMonthRange');
    if (range) {
      const weekText = weeks.length ? weeks.map(shortWeek).join(', ') : '등록된 주 없음';
      range.textContent = `${formatMonthLabel(month)} · 정산주(수요일)가 이 달인 계산서 · ${weekText}`;
    }
    const summary = $('#taxInvoiceMonthSummary');
    if (summary) {
      summary.textContent = `배민 ${baemin.rows.length}건 · 쿠팡 ${coupang.rows.length}건`
        + (monthState.feeApplied
          ? ' · 2% 적용 중. 계산서 금액은 공급가액·부가세에서 2%를 뺀 합입니다.'
          : ' · 등록한 계산서를 주차별로 그대로 보여 줍니다. 배민 실지급액은 공급대가에서 보험 5항목을 뺀 값입니다.');
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

  function monthWeeks(month) {
    const weeks = new Set();
    PLATFORMS.forEach(platform => {
      monthSourceRows(platform, month).forEach(row => {
        if (row.weekStart) weeks.add(row.weekStart);
      });
    });
    return [...weeks].sort();
  }

  function compactWeek(weekStart) {
    const picker = typeof BremDatePicker !== 'undefined' ? BremDatePicker : null;
    const start = picker?.applyWeekWednesday?.(weekStart) || weekStart;
    const end = picker?.weekEndKey?.(start);
    if (!end) return shortWeek(start);
    return `${shortWeek(start)}~${shortWeek(end)}`;
  }

  function excelFieldLabel(platform, field, useFee) {
    const label = fieldLabel(platform, field, useFee)
      .replace('(2%적용)', '')
      .replace('사업주부담 고용보험', '사업주고용')
      .replace('라이더부담 고용보험', '라이더고용')
      .replace('사업주부담 산재보험', '사업주산재')
      .replace('라이더부담 산재보험', '라이더산재')
      .replace('시간제보험', '시간제');
    return label;
  }

  function weekSheetRows(weekStart, month, fee) {
    const rows = [['주차', compactWeek(weekStart)]];
    PLATFORMS.forEach(platform => {
      const list = monthDetailRows(platform, month).filter(row => row.weekStart === weekStart);
      if (!list.length) return;
      const fields = fieldsFor(platform);
      rows.push([]);
      rows.push([platformLabel(platform)]);
      rows.push([
        '지역',
        '파일',
        ...fields.map(field => excelFieldLabel(platform, field, fee)),
        ...(hasNetPay(platform) ? ['보험료합계', '실지급'] : [])
      ]);
      list.forEach(row => {
        rows.push([
          row.region || '',
          row.fileName || '',
          ...fields.map(field => shownAmount(platform, row, field, fee)),
          ...(hasNetPay(platform) ? [baeminInsuranceSum(row), shownNet(platform, row, fee)] : [])
        ]);
      });
      const totals = fields.map(field => list.reduce((sum, row) => sum + shownAmount(platform, row, field, fee), 0));
      if (hasNetPay(platform)) {
        totals.push(list.reduce((sum, row) => sum + baeminInsuranceSum(row), 0));
        totals.push(list.reduce((sum, row) => sum + shownNet(platform, row, fee), 0));
      }
      rows.push(['합계', `${list.length}건`, ...totals]);
    });
    return rows;
  }

  function weekSheetName(month, index) {
    const monthNo = Number(String(month).slice(5, 7));
    return `${monthNo}월${index}주`;
  }

  function exportMonth(useFee) {
    const fee = feeOn(useFee);
    const month = ensureMonth();
    const weeks = monthWeeks(month);
    const sheets = weeks.map((weekStart, weekIndex) => ({
      name: weekSheetName(month, weekIndex + 1),
      rows: weekSheetRows(weekStart, month, fee)
    })).filter(sheet => sheet.rows.length > 1);
    if (!sheets.length) {
      showToast('이 달에 보낼 계산서가 없습니다.');
      return;
    }
    const filename = fee ? `계산서월별_2퍼센트_${month}.xlsx` : `계산서월별_${month}.xlsx`;
    const ok = writeWorkbook(filename, sheets);
    if (ok) {
      showToast(`${formatMonthLabel(month)} 계산서를 주차 ${sheets.length}개 시트로 보냈습니다. 한 시트에 배민·쿠팡이 함께 있습니다.`);
    }
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
    $('#taxInvoiceMonthExportBtn')?.addEventListener('click', () => exportMonth(false));
    $('#taxInvoiceMonthFeeBtn')?.addEventListener('click', () => {
      monthState.feeApplied = !monthState.feeApplied;
      renderMonthly();
    });
    $('#taxInvoiceMonthFeeExportBtn')?.addEventListener('click', () => exportMonth(true));
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

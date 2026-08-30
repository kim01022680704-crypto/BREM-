const BremSettlementParser = (function () {
  let officeCryptoPromise;
  let bufferPromise;
  let excelJsPromise;

  function normalizePassword(value) {
    return String(value || '').trim();
  }

  function passwordVariants(password) {
    const raw = String(password ?? '');
    const trimmed = raw.trim();
    // ZWSP·BOM·NBSP 제거
    const compact = trimmed.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
    const noSpaces = compact.replace(/\s+/g, '');
    const nfc = compact.normalize ? compact.normalize('NFC') : compact;
    const nfkc = compact.normalize ? compact.normalize('NFKC') : compact;
    // 전각 → 반각 숫자·영문·기호 보정
    const halfWidth = nfc.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
    return [...new Set([trimmed, raw, compact, noSpaces, nfc, nfkc, halfWidth].filter(Boolean))];
  }

  function normalizeMatchName(value, format) {
    if (format?.cleanName) return format.cleanName(value);
    return String(value || '').trim().replace(/\s+/g, '');
  }

  function normalizeDriverName(value, format) {
    return normalizeMatchName(value, format);
  }

  function parseNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const cleaned = String(value).replace(/[,원%\s]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** U·V열 등 필수값 빈칸·대시·0 = 무효 */
  function isBlankBaeminCell(value) {
    const raw = cellText(value).trim();
    if (!raw) return true;
    const compact = raw.replace(/\s/g, '');
    if (!compact) return true;
    if (/^[-–—./\\|_…]+$/.test(compact)) return true;
    if (/^(없음|미도착|null|n\/a|na|#n\/a|미입력|공란)$/i.test(compact)) return true;
    if (/^0([.,]0*)?(원|%)?$/i.test(compact)) return true;
    return false;
  }

  function isValidBaeminRequiredField(value) {
    return !isBlankBaeminCell(value);
  }

  function isValidBaeminStoreArrival(value) {
    return isValidBaeminRequiredField(value);
  }

  function isValidBaeminColumnV(value) {
    return isValidBaeminRequiredField(value);
  }

  /** AH열 0·빈값·0으로 시작 = 배달 미수행 */
  function isValidBaeminDeliveryAmount(value) {
    const raw = cellText(value).trim();
    if (!raw) return false;
    const compact = raw.replace(/\s/g, '');
    if (/^0([.,]0*)?(원|%)?$/i.test(compact)) return false;
    const numeric = parseNumber(value);
    return numeric > 0;
  }

  /** U·V·AH 중 하나라도 무효면 해당 행 전체 제외 */
  function classifyBaeminDeliveryRow(storeArrivalCell, columnVCell, amountCell) {
    const uValid = isValidBaeminStoreArrival(storeArrivalCell);
    const vValid = isValidBaeminColumnV(columnVCell);
    const amountValid = isValidBaeminDeliveryAmount(amountCell);
    if (uValid && vValid && amountValid) return 'valid';
    if (!uValid) return 'empty_store_arrival';
    if (!vValid) return 'empty_column_v';
    if (!amountValid) return 'invalid_amount';
    return 'invalid';
  }

  function isValidBaeminDeliveryRow(storeArrivalCell, columnVCell, amountCell) {
    return classifyBaeminDeliveryRow(storeArrivalCell, columnVCell, amountCell) === 'valid';
  }

  function cellText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if (Array.isArray(value.richText)) {
        return value.richText.map(part => part.text || '').join('').trim();
      }
      // ExcelJS: text 가 표시문자(앞자리 0 포함)라 value 숫자보다 우선한다.
      if (value.text !== undefined && value.text !== null && String(value.text).trim() !== '') {
        return String(value.text).trim();
      }
      if (value.result !== undefined && value.result !== null) return String(value.result).trim();
      if (value instanceof Date) {
        return [
          value.getFullYear(),
          String(value.getMonth() + 1).padStart(2, '0'),
          String(value.getDate()).padStart(2, '0')
        ].join('-');
      }
    }
    // 숫자로 읽히면 앞 0 이 이미 사라진 상태 — 문자열로만 보존
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number.isInteger(value) ? String(value) : String(value);
    }
    return String(value).trim();
  }

  function readCell(row, columnIndex) {
    if (columnIndex < 0) return '';
    return row[columnIndex];
  }

  function parseSettlementDateFromFilename(filename) {
    const baseName = String(filename || '').replace(/\.(xlsx|xls)$/i, '');
    const segments = baseName.split('_').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';

    function toDateString(year, month, day) {
      const date = new Date(`${year}-${month}-${day}T00:00:00`);
      if (Number.isNaN(date.getTime())) return '';
      if (date.getFullYear() !== Number(year)) return '';
      if (date.getMonth() + 1 !== Number(month)) return '';
      if (date.getDate() !== Number(day)) return '';
      return `${year}-${month}-${day}`;
    }

    if (/^\d{8}$/.test(lastSegment)) {
      const parsed = toDateString(
        lastSegment.slice(0, 4),
        lastSegment.slice(4, 6),
        lastSegment.slice(6, 8)
      );
      if (parsed) return parsed;
    }

    const inline = baseName.match(/(\d{4})(\d{2})(\d{2})/);
    if (inline) {
      return toDateString(inline[1], inline[2], inline[3]);
    }

    return '';
  }

  function parseDriverRows(rows, format) {
    if (!rows.length) {
      throw new Error('엑셀 데이터가 비어 있습니다.');
    }

    const nameCol = SettlementFormats.columnToIndex(format.columns.name);
    const orderCol = SettlementFormats.columnToIndex(format.columns.orderCount);
    const amountCol = SettlementFormats.columnToIndex(format.columns.settlementAmount);
    const hourlyInsuranceCol = SettlementFormats.columnToIndex(format.columns.hourlyInsurance || '');
    // 원천세·고용보험·산재보험 기준 금액(AC). 정산금액(AL)은 콜수수료가 빠진 값이라 기준이 못 된다.
    const deductionBaseCol = SettlementFormats.columnToIndex(format.columns.deductionBase || '');
    const startIndex = Math.max(0, Number(format.startRow) - 1);
    const parsedRows = [];

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i] || [];
      const rawName = cellText(readCell(row, nameCol));
      if (!rawName) continue;

      const name = format.cleanName(rawName);
      if (!name) continue;

      const settlementAmount = parseNumber(readCell(row, amountCol));
      parsedRows.push({
        rawName,
        name,
        riderId: '',
        orderCount: parseNumber(readCell(row, orderCol)),
        hourlyInsurance: hourlyInsuranceCol >= 0
          ? Math.abs(parseNumber(readCell(row, hourlyInsuranceCol)))
          : 0,
        deductionBase: deductionBaseCol >= 0
          ? Math.abs(parseNumber(readCell(row, deductionBaseCol)))
          : 0,
        deliveryAmount: settlementAmount,
        settlementAmount
      });
    }

    if (!parsedRows.length) {
      throw new Error(`${format.startRow}행부터 기사 데이터를 읽지 못했습니다.`);
    }

    return {
      parsedRows,
      totalDeliveries: 0,
      totalDeliveryAmount: parsedRows.reduce((sum, row) => sum + Number(row.deliveryAmount || 0), 0)
    };
  }

  function parseBaeminDeliveryRows(rows, format) {
    if (!rows.length) {
      throw new Error('엑셀 데이터가 비어 있습니다.');
    }

    const riderIdCol = SettlementFormats.columnToIndex(format.columns.riderId);
    const nameCol = SettlementFormats.columnToIndex(format.columns.name);
    const storeArrivalCol = SettlementFormats.columnToIndex(format.columns.storeArrival || 'U');
    const columnVCol = SettlementFormats.columnToIndex(format.columns.columnV || 'V');
    const amountCol = SettlementFormats.columnToIndex(format.columns.deliveryAmount);
    const weatherCol = SettlementFormats.columnToIndex(format.columns.weatherSurcharge || 'AC');
    const startIndex = Math.max(0, Number(format.startRow || 1) - 1);
    const groups = new Map();
    let totalDeliveries = 0;
    let totalDeliveryAmount = 0;
    const skippedRows = {
      emptyStoreArrival: 0,
      emptyColumnV: 0,
      invalidAmount: 0,
      otherInvalid: 0
    };

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i] || [];
      const rawName = cellText(readCell(row, nameCol));
      const riderId = normalizeBaeminUserId(cellText(readCell(row, riderIdCol)));
      if (!riderId) continue;
      // 앞자리 0 유무만 다른 ID(010… / 10…)는 같은 라이더로 합친다.
      const groupKey = baeminIdMatchKey(riderId) || riderId;

      const name = format.cleanName(rawName) || riderId;
      const storeArrivalCell = readCell(row, storeArrivalCol);
      const columnVCell = readCell(row, columnVCol);
      const amountCell = readCell(row, amountCol);
      const rowKind = classifyBaeminDeliveryRow(storeArrivalCell, columnVCell, amountCell);
      if (rowKind !== 'valid') {
        if (rowKind === 'empty_store_arrival') skippedRows.emptyStoreArrival += 1;
        else if (rowKind === 'empty_column_v') skippedRows.emptyColumnV += 1;
        else if (rowKind === 'invalid_amount') skippedRows.invalidAmount += 1;
        else skippedRows.otherInvalid += 1;
        continue;
      }
      const amount = parseNumber(amountCell);
      const weatherCell = readCell(row, weatherCol);
      const hasWeather = parseNumber(weatherCell) > 0 || !isBlankBaeminCell(weatherCell);

      totalDeliveries += 1;
      totalDeliveryAmount += amount;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          rawName: rawName || name,
          name,
          // 앞 0 이 있는 원문을 우선 보존
          riderId: riderId.startsWith('0') ? riderId : riderId,
          orderCount: 0,
          deliveryAmount: 0,
          settlementAmount: 0,
          deliveryFees: [],
          weatherFlags: []
        });
      }

      const entry = groups.get(groupKey);
      // 그룹에 앞 0 없는 ID만 있으면, 나중에 앞 0 있는 값이 오면 교체
      if (riderId.startsWith('0') && !String(entry.riderId || '').startsWith('0')) {
        entry.riderId = riderId;
      }
      entry.orderCount += 1;
      entry.deliveryAmount += amount;
      entry.settlementAmount += amount;
      entry.deliveryFees.push(amount);
      entry.weatherFlags.push(hasWeather);
    }

    const parsedRows = Array.from(groups.values());
    if (!parsedRows.length) {
      throw new Error('K열(User ID)·U열(가게도착)·V열·AH열에서 배민 배달 데이터를 읽지 못했습니다.');
    }

    return {
      parsedRows,
      totalDeliveries,
      totalDeliveryAmount,
      skippedRows
    };
  }

  function parseCoupangDeliveryRows(rows, format) {
    if (!rows.length) {
      throw new Error('엑셀 데이터가 비어 있습니다.');
    }

    const nameCol = SettlementFormats.columnToIndex(format.columns.name || 'B');
    const amountCol = SettlementFormats.columnToIndex(format.columns.deliveryAmount || 'Y');
    const startIndex = Math.max(0, Number(format.startRow || 1) - 1);
    const groups = new Map();
    let totalDeliveries = 0;
    let totalDeliveryAmount = 0;

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i] || [];
      const rawName = cellText(readCell(row, nameCol));
      const name = (format.cleanName ? format.cleanName(rawName) : String(rawName || '').trim().replace(/\s+/g, '')) || '';
      if (!name) continue;
      if (/^(이름|성함|라이더|rider|name)$/i.test(name)) continue;

      const amount = parseNumber(readCell(row, amountCol));
      if (!(amount > 0)) continue;

      totalDeliveries += 1;
      totalDeliveryAmount += amount;

      if (!groups.has(name)) {
        groups.set(name, {
          rawName: rawName || name,
          name,
          riderId: name,
          orderCount: 0,
          deliveryAmount: 0,
          settlementAmount: 0,
          deliveryFees: []
        });
      }

      const entry = groups.get(name);
      entry.orderCount += 1;
      entry.deliveryAmount += amount;
      entry.settlementAmount += amount;
      entry.deliveryFees.push(amount);
    }

    const parsedRows = Array.from(groups.values());
    if (!parsedRows.length) {
      throw new Error('3시트 오더별 상세내역에서 B열(이름)·Y열(정산금액) 데이터를 읽지 못했습니다.');
    }

    return {
      parsedRows,
      totalDeliveries,
      totalDeliveryAmount,
      skippedRows: null
    };
  }

  function parseRowsWithFormat(rows, format) {
    if (SettlementFormats.isBaeminDelivery(format)) {
      return parseBaeminDeliveryRows(rows, format);
    }
    if (typeof SettlementFormats.isCoupangDelivery === 'function' && SettlementFormats.isCoupangDelivery(format)) {
      return parseCoupangDeliveryRows(rows, format);
    }
    return parseDriverRows(rows, format);
  }

  function resolveFormatArgument(formatOrOptions) {
    if (!formatOrOptions) return null;
    if (formatOrOptions.format) return formatOrOptions.format;
    if (formatOrOptions.formatId) return SettlementFormats.getFormat(formatOrOptions.formatId);
    if (formatOrOptions.mode || formatOrOptions.columns) return formatOrOptions;
    return null;
  }

  function hasEnoughRows(rows, format) {
    if (!Array.isArray(rows) || !rows.length) return false;

    if (SettlementFormats.isBaeminDelivery(format)) {
      const riderIdCol = SettlementFormats.columnToIndex(format.columns.riderId);
      if (riderIdCol >= 0) {
        const hasUserId = rows.some(row => String(cellText(readCell(row || [], riderIdCol)) || '').trim());
        if (hasUserId) return true;
      }
      const nameCol = SettlementFormats.columnToIndex(format.columns.name);
      return rows.some(row => String(cellText(readCell(row || [], nameCol)) || '').trim());
    }

    if (typeof SettlementFormats.isCoupangDelivery === 'function' && SettlementFormats.isCoupangDelivery(format)) {
      const nameCol = SettlementFormats.columnToIndex(format.columns.name || 'B');
      const amountCol = SettlementFormats.columnToIndex(format.columns.deliveryAmount || 'Y');
      return rows.some(row => {
        const name = String(cellText(readCell(row || [], nameCol)) || '').trim();
        if (!name || /^(이름|성함|라이더|rider|name)$/i.test(name)) return false;
        return parseNumber(readCell(row || [], amountCol)) > 0;
      });
    }

    return rows.length >= Number(format?.startRow || 0);
  }

  async function loadBuffer() {
    if (!bufferPromise) {
      bufferPromise = import('https://esm.sh/buffer@6.0.3')
        .then(module => module.Buffer);
    }
    return bufferPromise;
  }

  async function loadOfficeCrypto() {
    if (!officeCryptoPromise) {
      // 로컬 서버와 같은 버전으로 고정 (esm.sh latest 드리프트 방지)
      officeCryptoPromise = Promise.all([
        loadBuffer(),
        import('https://esm.sh/officecrypto-tool@0.0.19')
      ])
        .then(([Buffer, module]) => ({
          Buffer,
          officeCrypto: module.default || module
        }))
        .catch(() => {
          const error = new Error('비밀번호 해제 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하거나 페이지를 새로고침해주세요.');
          error.code = 'CRYPTO_LOAD_FAILED';
          throw error;
        });
    }
    return officeCryptoPromise;
  }

  async function openSheetRowsViaServer(buffer, password, options = {}) {
    const form = new FormData();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    form.append('file', blob, options.fileName || 'settlement.xlsx');
    form.append('password', String(password || ''));
    if (options.sheetIndex != null) form.append('sheetIndex', String(options.sheetIndex));
    if (options.sheetName) form.append('sheetName', String(options.sheetName));

    const response = await fetch('/api/settlement/open-sheet', {
      method: 'POST',
      body: form,
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || '서버에서 엑셀을 열지 못했습니다.');
      error.code = data.code || (response.status === 401 ? 'WRONG_PASSWORD' : 'SERVER_OPEN_FAILED');
      throw error;
    }
    if (!Array.isArray(data.rows)) {
      throw new Error('서버 엑셀 응답 형식이 올바르지 않습니다.');
    }
    return data.rows;
  }

  async function loadExcelJS() {
    if (!excelJsPromise) {
      excelJsPromise = import('https://esm.sh/@zurmokeeper/exceljs@4.4.0')
        .then(module => module.default || module)
        .catch(() => null);
    }
    return excelJsPromise;
  }

  // SheetJS: 문자열 셀(t=s/str)은 앞자리 0 을 살리고, 숫자 셀만 숫자 문자열로 읽는다.
  function sheetToRowsPreserveText(sheet) {
    if (!sheet || !window.XLSX) return [];
    const ref = sheet['!ref'];
    if (!ref) return [];
    const range = window.XLSX.utils.decode_range(ref);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = sheet[window.XLSX.utils.encode_cell({ r, c })];
        if (!cell) {
          row.push('');
          continue;
        }
        if (cell.t === 's' || cell.t === 'str') {
          row.push(String(cell.v ?? '').trim());
          continue;
        }
        // 표시문자에 앞 0 이 있으면(사용자 지정 서식) 그걸 우선
        const formatted = cell.w != null ? String(cell.w).trim() : '';
        if (formatted && /^0\d+$/.test(formatted.replace(/\s/g, ''))) {
          row.push(formatted.replace(/\s/g, ''));
          continue;
        }
        if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
          row.push(Number.isInteger(cell.v) ? String(cell.v) : String(cell.v));
          continue;
        }
        if (formatted) {
          row.push(formatted);
          continue;
        }
        row.push(cellText(cell.v));
      }
      rows.push(row);
    }
    return rows;
  }

  function readWorkbookRows(buffer) {
    if (!window.XLSX) {
      throw new Error('엑셀 읽기 모듈이 로드되지 않았습니다. 페이지를 새로고침해주세요.');
    }

    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('엑셀 시트를 찾을 수 없습니다.');
    }

    const preserved = sheetToRowsPreserveText(workbook.Sheets[sheetName]);
    if (preserved.length) return preserved;

    return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: ''
    });
  }

  function canReadWorkbook(buffer) {
    try {
      readWorkbookRows(buffer);
      return true;
    } catch {
      return false;
    }
  }

  async function readRowsWithExcelJS(buffer, password, options = {}) {
    const ExcelJS = await loadExcelJS();
    if (!ExcelJS) return null;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer, password ? { password } : undefined);

    const names = workbook.worksheets.map(item => item.name);
    const resolvedName = resolveWorkbookSheetName({ SheetNames: names }, options);
    let sheet = resolvedName ? workbook.getWorksheet(resolvedName) : null;
    if (!sheet) {
      sheet = workbook.worksheets[Number(options.sheetIndex || 0)] || workbook.worksheets[0] || null;
    }
    if (!sheet) return null;

    const rows = [];
    sheet.eachRow(row => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // cell.text 는 표시값이라 텍스트로 저장된 앞자리 0 을 살린다.
        const display = cell.text != null ? String(cell.text).trim() : '';
        values[colNumber - 1] = display || cellText(cell.value);
      });
      rows.push(values);
    });

    return rows.length ? rows : null;
  }

  async function tryOfficeCryptoDecrypt(officeCrypto, Buffer, input, password) {
    const candidates = [
      input instanceof Buffer ? input : Buffer.from(input),
      input instanceof Uint8Array ? input : new Uint8Array(input)
    ];
    const optionCandidates = [{ password }, { password, type: 'standard' }];

    for (const candidate of candidates) {
      for (const options of optionCandidates) {
        try {
          const decrypted = await officeCrypto.decrypt(candidate, options);
          if (decrypted instanceof Uint8Array) return decrypted;
          if (decrypted?.buffer) return new Uint8Array(decrypted);
          return new Uint8Array(Buffer.from(decrypted));
        } catch {
          // try next combination
        }
      }
    }

    return null;
  }

  async function openWorkbookRows(buffer, password, formatOrOptions) {
    const format = resolveFormatArgument(formatOrOptions);
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const passwords = passwordVariants(password);

    if (canReadWorkbook(input) && hasEnoughRows(readWorkbookRows(input), format)) {
      return readWorkbookRows(input);
    }

    if (!passwords.length) {
      const error = new Error('비밀번호가 필요한 파일입니다.');
      error.code = 'PASSWORD_REQUIRED';
      throw error;
    }

    for (const pwd of passwords) {
      try {
        const rows = await readRowsWithExcelJS(input, pwd);
        if (hasEnoughRows(rows, format)) return rows;
      } catch {
        // try next method
      }
    }

    try {
      const { Buffer, officeCrypto } = await loadOfficeCrypto();
      for (const pwd of passwords) {
        const decrypted = await tryOfficeCryptoDecrypt(officeCrypto, Buffer, input, pwd);
        if (!decrypted) continue;

        if (canReadWorkbook(decrypted) && hasEnoughRows(readWorkbookRows(decrypted), format)) {
          return readWorkbookRows(decrypted);
        }

        try {
          const rows = await readRowsWithExcelJS(decrypted, pwd);
          if (hasEnoughRows(rows, format)) return rows;
        } catch {
          // try next password
        }
      }
    } catch (error) {
      if (error.code === 'CRYPTO_LOAD_FAILED') throw error;
    }

    const error = new Error(
      '엑셀을 열지 못했습니다. 비밀번호를 다시 확인하거나, Microsoft Excel에서 비밀번호 없이 다른 이름으로 저장 후 업로드해주세요.'
    );
    error.code = 'WRONG_PASSWORD';
    throw error;
  }

  function normalizeBaeminUserId(value) {
    if (window.BremWeeklySettlement?.normalizeBaeminUserId) {
      return BremWeeklySettlement.normalizeBaeminUserId(value);
    }
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    // 엑셀 소수점 .0 만 제거하고 앞자리 0 은 보존한다(예전엔 숫자변환으로 0이 사라졌다).
    const m = raw.match(/^(\d+)\.0+$/);
    return m ? m[1] : raw;
  }

  // 매칭용: 엑셀이 숫자로 읽어 앞 0 이 빠진 경우와 등록 ID(앞 0 유지)를 같게 본다.
  function baeminIdMatchKey(value) {
    if (window.BremWeeklySettlement?.baeminIdMatchKey) {
      return BremWeeklySettlement.baeminIdMatchKey(value);
    }
    const v = normalizeBaeminUserId(value).replace(/\s+/g, '');
    if (!v) return '';
    return /^\d+$/.test(v) ? (v.replace(/^0+/, '') || '0') : v.toLowerCase();
  }

  function normalizeCoupangLoginKey(rawName) {
    return String(rawName || '').trim().replace(/\s+/g, '');
  }

  function makeCoupangLoginKeyForDriver(driver) {
    if (window.BremDriverUtils?.getErpCoupangId) {
      return normalizeCoupangLoginKey(BremDriverUtils.getErpCoupangId(driver));
    }
    if (window.BremDriverUtils?.makeDriverLoginId) {
      return normalizeCoupangLoginKey(BremDriverUtils.makeDriverLoginId(driver));
    }
    const name = String(driver?.name || '').replace(/\s/g, '');
    const phone = String(driver?.phone || '').replace(/[^0-9]/g, '').slice(-4);
    return `${name}${phone}`;
  }

  function driverPhoneTail(driver) {
    return String(driver?.phone || '').replace(/[^0-9]/g, '').slice(-4);
  }

  /** 정산서 성함칸("이름+전화뒤4")에서 뒤4자리만 뽑는다. 없으면 빈 문자열. */
  function sheetPhoneTail(rawName) {
    return (String(rawName || '').match(/(\d{4})\s*$/) || [])[1] || '';
  }

  // 관리자가 「미매칭 매칭」 툴에서 직접 지정한 매핑.
  // originalName 에는 쿠팡 정산서 성함(=쿠팡ID) 또는 배민 라이더 User ID 가 들어간다.
  function loadManualMappings(platform) {
    try {
      const all = window.BremStorage?.manualNameMappings?.getAll?.() || [];
      return platform ? all.filter(item => item?.platform === platform) : all;
    } catch (_) {
      return [];
    }
  }

  function buildManualMappingIndex(mappings, format, isBaemin) {
    const byIdKey = new Map();
    const byNameKey = new Map();
    const ambiguousNames = new Set();
    (mappings || []).forEach(item => {
      const driverId = String(item?.driverId || '').trim();
      const original = String(item?.originalName || '').trim();
      if (!driverId || !original) return;
      const idKey = isBaemin ? baeminIdMatchKey(original) : normalizeCoupangLoginKey(original);
      if (idKey && !byIdKey.has(idKey)) byIdKey.set(idKey, driverId);
      // 배민 라이더 ID 가 비어 있는 행만 이름으로 매핑한다.
      // 쿠팡 성함칸은 항상 "이름+뒤4자리"라, 이름으로 매핑하면 동명이인에게 잘못 붙는다.
      if (!isBaemin) return;
      const nameKey = normalizeDriverName(original, format);
      if (!nameKey) return;
      const prev = byNameKey.get(nameKey);
      if (prev && prev !== driverId) ambiguousNames.add(nameKey);
      else if (!prev) byNameKey.set(nameKey, driverId);
    });
    ambiguousNames.forEach(key => byNameKey.delete(key));
    return { byIdKey, byNameKey };
  }

  function matchDrivers(parsedRows, driverList, format, options = {}) {
    const matched = [];
    const unmatched = [];
    const isBaemin = SettlementFormats.isBaeminDelivery(format);
    const manualIndex = buildManualMappingIndex(
      Array.isArray(options.manualMappings)
        ? options.manualMappings
        : loadManualMappings(format?.platform),
      format,
      isBaemin
    );
    const byDriverId = new Map();
    (driverList || []).forEach(item => {
      if (item?.id) byDriverId.set(String(item.id), item);
    });
    // 대량 일정산에서 O(n²) find 를 피하기 위해 쿠팡/배민 키 인덱스를 한 번만 만든다.
    const byBaeminKey = new Map();
    const byCoupangKey = new Map();
    const byName = new Map();
    // 같은 키를 쓰는 기사가 둘 이상이면 그 키로는 사람을 특정할 수 없다.
    // 먼저 등록된 쪽을 조용히 고르면 남의 정산이 붙으므로 키를 아예 버린다.
    const ambiguousBaeminKeys = new Set();
    const ambiguousCoupangKeys = new Set();
    const indexKey = (map, ambiguous, key, item) => {
      if (!key) return;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, item);
        return;
      }
      if (String(prev.id) !== String(item.id)) ambiguous.add(key);
    };
    (driverList || []).forEach(item => {
      indexKey(byBaeminKey, ambiguousBaeminKeys, baeminIdMatchKey(item?.baeminId), item);
      indexKey(byCoupangKey, ambiguousCoupangKeys, makeCoupangLoginKeyForDriver(item), item);
      indexKey(
        byCoupangKey,
        ambiguousCoupangKeys,
        normalizeCoupangLoginKey(item?.coupangId || item?.coupangLoginId || item?.loginId),
        item
      );
      const nameKey = normalizeDriverName(item?.name, format);
      if (nameKey) {
        const list = byName.get(nameKey) || [];
        list.push(item);
        byName.set(nameKey, list);
      }
    });

    parsedRows.forEach(row => {
      const normalizedRowName = normalizeDriverName(row.name, format);
      const normalizedRiderId = normalizeBaeminUserId(row.riderId);
      let driver = null;
      let unmatchedReason = '';

      // 1) 정확한 쿠팡ID/배민ID. 키가 맞는 기사가 있으면 수동매핑보다 우선한다.
      //    매핑을 먼저 쓰면, 아직 등록 안 된 동명이인을 기존 1명에게 붙인 뒤
      //    진짜 주인이 등록돼도 계속 잘못된 쪽에 간다 (박준혁4453 → 8013).
      if (isBaemin) {
        const riderKey = baeminIdMatchKey(normalizedRiderId || row.riderId);
        if (!riderKey) {
          unmatchedReason = '정산서에 배민 User ID 가 없습니다.';
        } else if (ambiguousBaeminKeys.has(riderKey)) {
          unmatchedReason = `배민ID ${riderKey} 가 여러 기사에 등록돼 있습니다. 중복 등록을 정리해 주세요.`;
        } else {
          driver = byBaeminKey.get(riderKey) || null;
          if (!driver) unmatchedReason = `배민ID ${riderKey} 로 등록된 기사가 없습니다.`;
        }
      } else {
        const loginKey = normalizeCoupangLoginKey(row.rawName || row.name);
        if (loginKey && ambiguousCoupangKeys.has(loginKey)) {
          unmatchedReason = `쿠팡ID ${loginKey} 가 여러 기사에 등록돼 있습니다. 중복 등록을 정리해 주세요.`;
        } else if (loginKey) {
          driver = byCoupangKey.get(loginKey) || null;
        }
      }

      // 2) 키가 안 맞을 때만 수동매핑 (같은 사람·쿠팡 번호만 다른 경우)
      if (!driver && (manualIndex.byIdKey.size || manualIndex.byNameKey.size)) {
        const manualIdKey = isBaemin
          ? baeminIdMatchKey(normalizedRiderId || row.riderId)
          : normalizeCoupangLoginKey(row.rawName || row.name);
        const manualDriverId = manualIdKey
          ? (manualIndex.byIdKey.get(manualIdKey) || '')
          : (normalizedRowName ? (manualIndex.byNameKey.get(normalizedRowName) || '') : '');
        if (manualDriverId) {
          driver = byDriverId.get(String(manualDriverId)) || null;
          if (driver) unmatchedReason = '';
        }
      }

      // 3) 쿠팡 이름 백업. 뒤4가 맞을 때만. 다르면 미매칭으로 남겨 사람이 확인한다.
      if (!driver && !isBaemin && !unmatchedReason && normalizedRowName) {
        const sheetTail = sheetPhoneTail(row.rawName || row.name);
        const nameMatches = byName.get(normalizedRowName) || [];
        if (nameMatches.length === 1) {
          const only = nameMatches[0];
          const ownTail = driverPhoneTail(only);
          if (!sheetTail || !ownTail || sheetTail === ownTail) {
            driver = only;
          } else {
            unmatchedReason = `이름은 같지만 전화 뒤4자리가 다릅니다 (정산서 ${sheetTail} / 등록 ${ownTail}).`
              + ' 미등록 기사이거나 등록 번호가 플랫폼 계정과 다릅니다.';
          }
        } else if (nameMatches.length > 1) {
          unmatchedReason = `이름이 같은 기사가 ${nameMatches.length}명 있어 특정할 수 없습니다.`;
        } else {
          unmatchedReason = '등록된 기사와 매칭되지 않습니다.';
        }
      }

      const payload = {
        rawName: row.rawName,
        name: row.name,
        riderId: row.riderId || '',
        orderCount: row.orderCount,
        hourlyInsurance: Math.abs(Number(row.hourlyInsurance || 0)),
        deductionBase: Math.abs(Number(row.deductionBase || 0)),
        deliveryAmount: Number(row.deliveryAmount ?? row.settlementAmount ?? 0),
        settlementAmount: Number(row.settlementAmount ?? row.deliveryAmount ?? 0)
      };

      if (driver) {
        matched.push({
          ...payload,
          driverId: driver.id,
          driverName: driver.name
        });
      } else {
        unmatched.push({ ...payload, reason: unmatchedReason });
      }
    });

    return { matched, unmatched };
  }

  async function parseSettlementFile({ file, password, drivers, period, formatId }) {
    const format = SettlementFormats.getFormat(formatId);
    const arrayBuffer = await file.arrayBuffer();
    const filenamePeriod = parseSettlementDateFromFilename(file.name);
    const rows = await openWorkbookRows(
      new Uint8Array(arrayBuffer),
      normalizePassword(password),
      format
    );
    const parsed = parseRowsWithFormat(rows, format);
    const parsedRows = parsed.parsedRows;
    const resolvedPeriod = period || filenamePeriod || '';
    const { matched, unmatched } = matchDrivers(parsedRows, drivers, format);
    const totalDeliveryAmount = parsed.totalDeliveryAmount ?? parsedRows.reduce(
      (sum, row) => sum + Number(row.deliveryAmount ?? row.settlementAmount ?? 0),
      0
    );

    return {
      period: resolvedPeriod,
      formatId: format.id,
      matched,
      unmatched,
      totalRows: parsedRows.length,
      totalDeliveries: parsed.totalDeliveries || 0,
      totalDeliveryAmount,
      totalRiders: parsedRows.length,
      skippedBaeminRows: parsed.skippedRows || null
    };
  }

  async function openWorkbookSheetRows(buffer, password, options = {}) {
    const format = options.format || (options.formatId ? SettlementFormats.getFormat(options.formatId) : null);
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    // trim 전·후 모두 시도 (앞뒤 공백/보이지 않는 문자 대비)
    const passwords = passwordVariants(password);
    const validateRows = typeof options.validateRows === 'function'
      ? options.validateRows
      : (rows) => Boolean(rows?.length) && (!format || hasEnoughRows(rows, format));

    async function rowsFromBuffer(source) {
      if (!window.XLSX) {
        throw new Error('엑셀 읽기 모듈이 로드되지 않았습니다. 페이지를 새로고침해주세요.');
      }

      let workbook;
      try {
        workbook = window.XLSX.read(source, { type: 'array', cellDates: true });
      } catch {
        return null;
      }

      const sheetName = resolveWorkbookSheetName(workbook, options);
      if (!sheetName || !workbook.Sheets[sheetName]) return null;

      const preserved = sheetToRowsPreserveText(workbook.Sheets[sheetName]);
      if (preserved.length) return preserved;

      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: ''
      });

      return rows?.length ? rows : null;
    }

    let openedWithoutPassword = false;
    let rows = await rowsFromBuffer(input);
    if (rows && validateRows(rows)) return rows;
    if (rows) openedWithoutPassword = true;

    if (!passwords.length) {
      if (rows) return rows;
      const error = new Error('비밀번호가 필요한 파일입니다.');
      error.code = 'PASSWORD_REQUIRED';
      throw error;
    }

    let decryptSucceeded = false;
    let lastSheetMiss = false;

    for (const pwd of passwords) {
      try {
        const excelRows = await readRowsWithExcelJS(input, pwd, options);
        if (excelRows?.length) {
          decryptSucceeded = true;
          if (validateRows(excelRows)) return excelRows;
          lastSheetMiss = true;
        }
      } catch {
        // try next method
      }
    }

    try {
      const { Buffer, officeCrypto } = await loadOfficeCrypto();
      for (const pwd of passwords) {
        const decrypted = await tryOfficeCryptoDecrypt(officeCrypto, Buffer, input, pwd);
        if (!decrypted) continue;
        decryptSucceeded = true;
        rows = await rowsFromBuffer(decrypted);
        if (rows && validateRows(rows)) return rows;
        if (rows) lastSheetMiss = true;

        try {
          const excelRows = await readRowsWithExcelJS(decrypted, pwd, options);
          if (excelRows?.length && validateRows(excelRows)) return excelRows;
          if (excelRows?.length) lastSheetMiss = true;
        } catch {
          // try next password
        }
      }
    } catch (error) {
      // 브라우저 모듈 로드 실패는 서버 폴백으로 이어간다 (바로 throw 하지 않음)
      if (error.code && error.code !== 'CRYPTO_LOAD_FAILED') throw error;
    }

    if (decryptSucceeded || openedWithoutPassword || lastSheetMiss) {
      const error = new Error(
        '파일은 열렸지만 시간제보험 시트(B열 ID·H열 금액)를 찾지 못했습니다. 시트명에 「협력사」「시간제」「보험」이 포함돼 있는지 확인하세요.'
      );
      error.code = 'SHEET_NOT_FOUND';
      throw error;
    }

    // 브라우저 암호해제 실패 → 서버(Node officecrypto)로 재시도
    if (passwords.length) {
      try {
        for (const pwd of passwords) {
          try {
            const serverRows = await openSheetRowsViaServer(input, pwd, options);
            if (serverRows?.length && validateRows(serverRows)) return serverRows;
            if (serverRows?.length) {
              const error = new Error(
                '파일은 열렸지만 필요한 시트를 찾지 못했습니다. 시트명·시작행을 확인하세요.'
              );
              error.code = 'SHEET_NOT_FOUND';
              throw error;
            }
          } catch (serverError) {
            if (serverError.code === 'SHEET_NOT_FOUND') throw serverError;
            if (serverError.code === 'PASSWORD_REQUIRED') throw serverError;
            // WRONG_PASSWORD 등 → 다음 비밀번호 변형 시도
          }
        }
      } catch (serverError) {
        if (serverError.code === 'SHEET_NOT_FOUND' || serverError.code === 'PASSWORD_REQUIRED') {
          throw serverError;
        }
      }
    }

    const error = new Error(
      passwords.length
        ? '엑셀을 열지 못했습니다. 비밀번호가 정확한지 다시 확인하세요. (쿠팡 열람 암호) 그래도 안 되면 Microsoft Excel에서 비밀번호 없이 「다른 이름으로 저장」 후 올려주세요.'
        : '비밀번호가 필요한 파일입니다. 엑셀 비밀번호를 입력하세요.'
    );
    error.code = 'WRONG_PASSWORD';
    throw error;
  }

  function resolveWorkbookSheetName(workbook, options = {}) {
    const names = workbook?.SheetNames || [];
    if (!names.length) return '';

    if (options.sheetName && names.includes(options.sheetName)) {
      return options.sheetName;
    }

    if (typeof options.sheetMatcher === 'function') {
      const matched = names.find(options.sheetMatcher);
      if (matched) return matched;
    }

    if (typeof options.sheetMatcher === 'string') {
      const keyword = options.sheetMatcher.trim();
      const matched = names.find(name => name.includes(keyword) || name === keyword);
      if (matched) return matched;
    }

    if (Number.isFinite(Number(options.sheetIndex))) {
      const byIndex = names[Number(options.sheetIndex)];
      if (byIndex) return byIndex;
    }

    return names[0] || '';
  }

  function rowsLookLikeBaeminHourlyInsurance(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return false;
    let idHits = 0;
    const limit = Math.min(rows.length, 40);
    for (let i = 0; i < limit; i += 1) {
      const id = normalizeBaeminUserId(cellText(readCell(rows[i] || [], 1)));
      if (!id) continue;
      if (/아이디|id|협력사|라이더|시간제|정산/i.test(id)) continue;
      idHits += 1;
      if (idHits >= 2) return true;
    }
    return idHits >= 1;
  }

  function findBaeminSettlementSheet(workbook) {
    // 배민 정산서는 라이더 정산 시트가 두 번째다. 시트명은 파일마다 달라질 수 있다.
    const names = workbook?.SheetNames || [];
    return names[1]
      || names.find(name => String(name || '').includes('을지_협력사 소속 라이더 정산 확인용'))
      || names[0]
      || '';
  }

  async function readWorkbookMeta(buffer, password) {
    const rows = await openWorkbookSheetRows(buffer, password, {});
    if (!window.XLSX) return { sheetNames: [] };
    try {
      const workbook = window.XLSX.read(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), {
        type: 'array',
        cellDates: true
      });
      return { sheetNames: workbook.SheetNames || [], baeminSheet: findBaeminSettlementSheet(workbook) };
    } catch {
      return { sheetNames: [], baeminSheet: '' };
    }
  }

  async function parseBaeminHourlyInsuranceFile({ file, password, drivers, period }) {
    if (!file) throw new Error('시간제보험 엑셀 파일을 선택하세요.');

    const filenamePeriod = parseSettlementDateFromFilename(file.name);
    const arrayBuffer = await file.arrayBuffer();
    const bulk = window.BremPayrollHourlyInsuranceBulk;
    const sheetName = bulk?.SHEET_NAME || '을지_협력사 소속 라이더 정산 확인용';
    const rows = await openWorkbookSheetRows(
      new Uint8Array(arrayBuffer),
      password,
      {
        sheetName,
        sheetIndex: Number.isFinite(Number(bulk?.SHEET_INDEX)) ? Number(bulk.SHEET_INDEX) : 1,
        sheetMatcher: name => {
          const value = String(name || '');
          return value.includes('협력사')
            || value.includes('시간제')
            || value.includes('보험')
            || value.includes('정산 확인')
            || value === sheetName;
        },
        validateRows: rowsLookLikeBaeminHourlyInsurance
      }
    );

    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(`"${sheetName}" 시트에서 데이터를 읽지 못했습니다.`);
    }

    const platformIdCol = 1; // B
    const hourlyInsuranceCol = 7; // H
    const headerMarkers = ['아이디', 'id', '시간제', '협력사', '라이더', '정산'];
    const driverList = Array.isArray(drivers) ? drivers : [];
    const matchedMap = new Map();
    const unmatched = [];

    function isHeaderRow(row) {
      const samples = [
        cellText(readCell(row, platformIdCol)),
        cellText(readCell(row, hourlyInsuranceCol))
      ].map(value => String(value || '').trim().toLowerCase());
      return headerMarkers.some(marker => samples.some(text => text.includes(marker.toLowerCase())));
    }

    rows.forEach((row, index) => {
      if (!Array.isArray(row) || isHeaderRow(row)) return;
      const baeminId = normalizeBaeminUserId(cellText(readCell(row, platformIdCol)));
      const hourlyInsurance = Math.abs(parseNumber(readCell(row, hourlyInsuranceCol)));
      if (!baeminId && !hourlyInsurance) return;

      if (!baeminId) {
        unmatched.push({
          rawName: '',
          name: '',
          riderId: '',
          baeminId: '',
          hourlyInsurance,
          rowNumber: index + 1,
          reason: 'B열 배민 ID 없음'
        });
        return;
      }

      const riderKey = baeminIdMatchKey(baeminId);
      const driver = riderKey
        ? (driverList.find(item => baeminIdMatchKey(item.baeminId) === riderKey) || null)
        : null;

      if (!driver) {
        unmatched.push({
          rawName: baeminId,
          name: baeminId,
          riderId: baeminId,
          baeminId,
          hourlyInsurance,
          rowNumber: index + 1,
          reason: '등록된 기사와 매칭 실패'
        });
        return;
      }

      const existing = matchedMap.get(driver.id);
      if (existing) {
        existing.hourlyInsurance += hourlyInsurance;
        return;
      }

      matchedMap.set(driver.id, {
        driverId: driver.id,
        driverName: driver.name || '',
        riderId: baeminId,
        baeminId,
        rawName: baeminId,
        name: driver.name || baeminId,
        hourlyInsurance,
        rowNumber: index + 1
      });
    });

    const matched = Array.from(matchedMap.values());
    if (!matched.length && !unmatched.length) {
      throw new Error('B열(배민 ID)·H열(시간제보험료)에서 데이터를 읽지 못했습니다.');
    }

    const totalHourlyInsurance = matched.reduce(
      (sum, row) => sum + Number(row.hourlyInsurance || 0),
      0
    );

    return {
      period: period || filenamePeriod || '',
      filenamePeriod,
      matched,
      unmatched,
      totalRows: matched.length + unmatched.length,
      totalHourlyInsurance
    };
  }

  return {
    parseSettlementFile,
    parseBaeminHourlyInsuranceFile,
    parseSettlementDateFromFilename,
    parseRowsWithFormat,
    matchDrivers,
    openWorkbookRows,
    openWorkbookSheetRows,
    resolveWorkbookSheetName,
    findBaeminSettlementSheet,
    readWorkbookMeta,
    cellText,
    parseNumber,
    normalizePassword,
    normalizeBaeminUserId,
    baeminIdMatchKey,
    isValidBaeminDeliveryRow,
    isValidBaeminDeliveryAmount,
    isValidBaeminStoreArrival,
    isValidBaeminColumnV,
    isValidBaeminRequiredField,
    classifyBaeminDeliveryRow
  };
})();

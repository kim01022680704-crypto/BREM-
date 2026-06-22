const BremSettlementParser = (function () {
  let officeCryptoPromise;
  let bufferPromise;
  let excelJsPromise;

  function normalizePassword(value) {
    return String(value || '').trim();
  }

  function passwordVariants(password) {
    const raw = String(password || '');
    const trimmed = raw.trim();
    return [...new Set([trimmed, raw].filter(Boolean))];
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

  /** U열(가게도착) 빈칸 = 배달 미수행 행 */
  function isValidBaeminStoreArrival(value) {
    return Boolean(cellText(value).trim());
  }

  /** AH열 0·빈값·0으로 시작하는 문자열 = 배달 미수행 행 */
  function isValidBaeminDeliveryAmount(value) {
    const raw = cellText(value).trim();
    if (!raw) return false;
    const compact = raw.replace(/\s/g, '');
    if (/^0([.,]0*)?(원|%)?$/i.test(compact)) return false;
    const numeric = parseNumber(value);
    return numeric > 0;
  }

  /** U열 가게도착 있음 + AH열 금액>0 둘 다 만족해야 유효 1건 */
  function isValidBaeminDeliveryRow(amountCell, storeArrivalCell) {
    return isValidBaeminStoreArrival(storeArrivalCell) && isValidBaeminDeliveryAmount(amountCell);
  }

  function cellText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if (Array.isArray(value.richText)) {
        return value.richText.map(part => part.text || '').join('').trim();
      }
      if (value.result !== undefined && value.result !== null) return String(value.result).trim();
      if (value.text !== undefined && value.text !== null) return String(value.text).trim();
      if (value instanceof Date) {
        return [
          value.getFullYear(),
          String(value.getMonth() + 1).padStart(2, '0'),
          String(value.getDate()).padStart(2, '0')
        ].join('-');
      }
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
    const startIndex = Math.max(0, Number(format.startRow) - 1);
    const parsedRows = [];

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i] || [];
      const rawName = cellText(readCell(row, nameCol));
      if (!rawName) continue;

      const name = format.cleanName(rawName);
      if (!name) continue;

      parsedRows.push({
        rawName,
        name,
        riderId: '',
        orderCount: parseNumber(readCell(row, orderCol)),
        deliveryAmount: parseNumber(readCell(row, amountCol)),
        settlementAmount: parseNumber(readCell(row, amountCol))
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
    const amountCol = SettlementFormats.columnToIndex(format.columns.deliveryAmount);
    const startIndex = Math.max(0, Number(format.startRow || 1) - 1);
    const groups = new Map();
    let totalDeliveries = 0;
    let totalDeliveryAmount = 0;

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i] || [];
      const rawName = cellText(readCell(row, nameCol));
      const riderId = normalizeBaeminUserId(cellText(readCell(row, riderIdCol)));
      if (!riderId) continue;

      const name = format.cleanName(rawName) || riderId;
      const amountCell = readCell(row, amountCol);
      const storeArrivalCell = readCell(row, storeArrivalCol);
      if (!isValidBaeminDeliveryRow(amountCell, storeArrivalCell)) continue;
      const amount = parseNumber(amountCell);

      totalDeliveries += 1;
      totalDeliveryAmount += amount;

      if (!groups.has(riderId)) {
        groups.set(riderId, {
          rawName: rawName || name,
          name,
          riderId,
          orderCount: 0,
          deliveryAmount: 0,
          settlementAmount: 0,
          deliveryFees: []
        });
      }

      const entry = groups.get(riderId);
      entry.orderCount += 1;
      entry.deliveryAmount += amount;
      entry.settlementAmount += amount;
      entry.deliveryFees.push(amount);
    }

    const parsedRows = Array.from(groups.values());
    if (!parsedRows.length) {
      throw new Error('K열(User ID)·U열(가게도착)·AH열에서 배민 배달 데이터를 읽지 못했습니다.');
    }

    return {
      parsedRows,
      totalDeliveries,
      totalDeliveryAmount
    };
  }

  function parseRowsWithFormat(rows, format) {
    if (SettlementFormats.isBaeminDelivery(format)) {
      return parseBaeminDeliveryRows(rows, format);
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
      officeCryptoPromise = Promise.all([loadBuffer(), import('https://esm.sh/officecrypto-tool')])
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

  async function loadExcelJS() {
    if (!excelJsPromise) {
      excelJsPromise = import('https://esm.sh/@zurmokeeper/exceljs@4.4.0')
        .then(module => module.default || module)
        .catch(() => null);
    }
    return excelJsPromise;
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

    let sheet = null;
    if (options.sheetName) {
      sheet = workbook.getWorksheet(options.sheetName);
    } else if (options.sheetMatcher) {
      const names = workbook.worksheets.map(item => item.name);
      const matchedName = resolveWorkbookSheetName({ SheetNames: names }, options);
      sheet = matchedName ? workbook.getWorksheet(matchedName) : null;
    } else {
      sheet = workbook.worksheets[Number(options.sheetIndex || 0)] || workbook.worksheets[0];
    }

    if (!sheet) return null;

    const rows = [];
    sheet.eachRow(row => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        values[colNumber - 1] = cellText(cell.value);
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
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^\d+(\.0+)?$/.test(raw)) return String(Math.round(Number(raw)));
    return raw;
  }

  function normalizeCoupangLoginKey(rawName) {
    return String(rawName || '').trim().replace(/\s+/g, '');
  }

  function makeCoupangLoginKeyForDriver(driver) {
    const name = String(driver?.name || '').replace(/\s/g, '');
    const phone = String(driver?.phone || '').replace(/[^0-9]/g, '').slice(-4);
    return `${name}${phone}`;
  }

  function matchDrivers(parsedRows, driverList, format) {
    const matched = [];
    const unmatched = [];
    const isBaemin = SettlementFormats.isBaeminDelivery(format);

    parsedRows.forEach(row => {
      const normalizedRowName = normalizeDriverName(row.name, format);
      const normalizedRiderId = normalizeBaeminUserId(row.riderId);
      let driver = null;

      if (isBaemin) {
        if (normalizedRiderId) {
          driver = driverList.find(item =>
            normalizeBaeminUserId(item.baeminId) === normalizedRiderId
          ) || null;
        }
      } else {
        driver = driverList.find(item =>
          normalizeDriverName(item.name, format) === normalizedRowName
        ) || null;
        if (!driver) {
          const loginKey = normalizeCoupangLoginKey(row.rawName || row.name);
          if (loginKey) {
            driver = driverList.find(item => makeCoupangLoginKeyForDriver(item) === loginKey) || null;
          }
        }
      }

      const payload = {
        rawName: row.rawName,
        name: row.name,
        riderId: row.riderId || '',
        orderCount: row.orderCount,
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
        unmatched.push(payload);
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
      totalRiders: parsedRows.length
    };
  }

  async function openWorkbookSheetRows(buffer, password, options = {}) {
    const format = options.format || SettlementFormats.getFormat(options.formatId);
    const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const passwords = passwordVariants(normalizePassword(password));

    async function rowsFromBuffer(source, pwd) {
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
      if (!sheetName) return null;

      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: ''
      });

      return rows?.length ? rows : null;
    }

    let rows = await rowsFromBuffer(input);
    if (rows && (!format || hasEnoughRows(rows, format))) return rows;

    if (!passwords.length) {
      if (rows) return rows;
      const error = new Error('비밀번호가 필요한 파일입니다.');
      error.code = 'PASSWORD_REQUIRED';
      throw error;
    }

    for (const pwd of passwords) {
      try {
        const excelRows = await readRowsWithExcelJS(input, pwd, options);
        if (excelRows?.length) {
          rows = excelRows;
          if (!format || hasEnoughRows(rows, format)) return rows;
        }
      } catch {
        // continue
      }
    }

    try {
      const { Buffer, officeCrypto } = await loadOfficeCrypto();
      for (const pwd of passwords) {
        const decrypted = await tryOfficeCryptoDecrypt(officeCrypto, Buffer, input, pwd);
        if (!decrypted) continue;
        rows = await rowsFromBuffer(decrypted);
        if (rows && (!format || hasEnoughRows(rows, format))) return rows;
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

  function resolveWorkbookSheetName(workbook, options = {}) {
    const names = workbook?.SheetNames || [];
    if (!names.length) return '';

    if (options.sheetName && names.includes(options.sheetName)) {
      return options.sheetName;
    }

    if (typeof options.sheetMatcher === 'function') {
      return names.find(options.sheetMatcher) || '';
    }

    if (typeof options.sheetMatcher === 'string') {
      const keyword = options.sheetMatcher.trim();
      return names.find(name => name.includes(keyword) || name === keyword) || '';
    }

    const index = Number(options.sheetIndex ?? 0);
    return names[index] || names[0];
  }

  function findBaeminSettlementSheet(workbook) {
    return resolveWorkbookSheetName(workbook, {
      sheetMatcher: name => name.includes('을지_협력사 소속 라이더 정산 확인용')
    });
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

  return {
    parseSettlementFile,
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
    isValidBaeminDeliveryRow,
    isValidBaeminDeliveryAmount,
    isValidBaeminStoreArrival
  };
})();

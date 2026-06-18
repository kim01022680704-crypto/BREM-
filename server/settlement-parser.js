const XLSX = require('xlsx');
const officeCrypto = require('officecrypto-tool');

const HEADER_ALIASES = {
  name: ['기사명', '이름', '성명', '기사', 'name', 'driver'],
  phone: ['전화번호', '연락처', '휴대폰', '휴대폰번호', 'phone', 'mobile'],
  period: ['정산월', '정산기간', '적용월', '기준월', 'period', 'month'],
  callCount: ['콜수', '총콜수', '배달건수', '건수', 'call', 'calls'],
  settlementAmount: ['정산금', '정산금액', '정산', 'settlement'],
  promotionAmount: ['프로모션금', '프로모션', '프로모션금액', 'promotion'],
  employmentInsurance: ['고용보험', '고용보험료', 'employment'],
  industrialInsurance: ['산재보험', '산재보험료', 'industrial'],
  finalPayment: ['최종지급액', '최종지급', '실지급액', '지급액', 'final', 'payment']
};

function normalizeText(value) {
  return String(value || '').replace(/\s/g, '').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[,원%\s]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cellText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function findHeaderRow(rows) {
  const scanLimit = Math.min(rows.length, 15);
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
    const row = rows[rowIndex] || [];
    const normalizedCells = row.map(cell => normalizeText(cell));
    const hasName = normalizedCells.some(text => HEADER_ALIASES.name.some(alias => text.includes(normalizeText(alias))));
    const hasPhoneOrPayment = normalizedCells.some(text => (
      HEADER_ALIASES.phone.some(alias => text.includes(normalizeText(alias)))
      || HEADER_ALIASES.finalPayment.some(alias => text.includes(normalizeText(alias)))
    ));
    if (hasName && hasPhoneOrPayment) return rowIndex;
  }
  return 0;
}

function mapHeaders(headerRow) {
  const mapping = {};
  headerRow.forEach((cell, index) => {
    const text = normalizeText(cell);
    if (!text) return;

    Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
      if (mapping[field] !== undefined) return;
      if (aliases.some(alias => text.includes(normalizeText(alias)))) {
        mapping[field] = index;
      }
    });
  });
  return mapping;
}

function readCell(row, index) {
  if (index === undefined || index < 0) return '';
  return row[index];
}

function normalizePeriod(value) {
  const text = cellText(value);
  if (!text) return '';

  const monthMatch = text.match(/(\d{4})[-./년\s]*(\d{1,2})/);
  if (monthMatch) {
    return `${monthMatch[1]}-${String(monthMatch[2]).padStart(2, '0')}`;
  }

  if (/^\d{4}-\d{2}$/.test(text)) return text;
  return text;
}

function parseWorkbookBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('엑셀 시트를 찾을 수 없습니다.');
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: ''
  });

  if (!rows.length) {
    throw new Error('엑셀 데이터가 비어 있습니다.');
  }

  const headerRowIndex = findHeaderRow(rows);
  const headerRow = rows[headerRowIndex] || [];
  const columnMap = mapHeaders(headerRow);

  if (columnMap.name === undefined) {
    throw new Error('기사명 열을 찾을 수 없습니다. 헤더(기사명, 전화번호 등)를 확인해주세요.');
  }

  let detectedPeriod = '';
  const parsedRows = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = cellText(readCell(row, columnMap.name));
    const phone = cellText(readCell(row, columnMap.phone));
    if (!name && !phone) continue;

    const period = normalizePeriod(readCell(row, columnMap.period));
    if (period && !detectedPeriod) detectedPeriod = period;

    parsedRows.push({
      name,
      phone,
      period,
      callCount: parseNumber(readCell(row, columnMap.callCount)),
      settlementAmount: parseNumber(readCell(row, columnMap.settlementAmount)),
      promotionAmount: parseNumber(readCell(row, columnMap.promotionAmount)),
      employmentInsurance: parseNumber(readCell(row, columnMap.employmentInsurance)),
      industrialInsurance: parseNumber(readCell(row, columnMap.industrialInsurance)),
      finalPayment: parseNumber(readCell(row, columnMap.finalPayment))
    });
  }

  if (!parsedRows.length) {
    throw new Error('정산표에서 기사 데이터를 읽지 못했습니다.');
  }

  return {
    period: detectedPeriod,
    rows: parsedRows
  };
}

async function decryptWorkbookBuffer(buffer, password) {
  if (officeCrypto.isEncrypted(buffer)) {
    if (!password) {
      const error = new Error('비밀번호가 필요한 파일입니다.');
      error.code = 'PASSWORD_REQUIRED';
      throw error;
    }

    try {
      return await officeCrypto.decrypt(buffer, { password });
    } catch {
      const error = new Error('엑셀 비밀번호가 올바르지 않습니다.');
      error.code = 'WRONG_PASSWORD';
      throw error;
    }
  }

  return buffer;
}

function matchDrivers(parsedRows, drivers, fallbackPeriod) {
  const matched = [];
  const unmatched = [];

  parsedRows.forEach(row => {
    const rowPhone = normalizePhone(row.phone);
    const rowName = normalizeText(row.name);

    let driver = drivers.find(item => normalizePhone(item.phone) === rowPhone && rowPhone);
    if (!driver && rowPhone.length >= 4) {
      driver = drivers.find(item => {
        const driverPhone = normalizePhone(item.phone);
        return normalizeText(item.name) === rowName
          && driverPhone.slice(-4) === rowPhone.slice(-4);
      });
    }
    if (!driver && rowName) {
      driver = drivers.find(item => normalizeText(item.name) === rowName);
    }

    const payload = {
      name: row.name,
      phone: row.phone,
      period: row.period || fallbackPeriod || '',
      callCount: row.callCount,
      settlementAmount: row.settlementAmount,
      promotionAmount: row.promotionAmount,
      employmentInsurance: row.employmentInsurance,
      industrialInsurance: row.industrialInsurance,
      finalPayment: row.finalPayment
    };

    if (driver) {
      matched.push({
        ...payload,
        driverId: driver.id,
        driverName: driver.name,
        driverPhone: driver.phone
      });
    } else {
      unmatched.push(payload);
    }
  });

  return { matched, unmatched };
}

async function parseSettlementFile({ buffer, password, drivers, period }) {
  const decrypted = await decryptWorkbookBuffer(buffer, password);
  const parsed = parseWorkbookBuffer(decrypted);
  const resolvedPeriod = period || parsed.period || '';
  const { matched, unmatched } = matchDrivers(parsed.rows, drivers, resolvedPeriod);

  return {
    period: resolvedPeriod,
    matched,
    unmatched,
    totalRows: parsed.rows.length
  };
}

module.exports = {
  parseSettlementFile
};

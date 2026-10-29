// 계산서 엑셀에서 주차 합계 칸만 뽑는다. 기사 행은 읽지 않는다.
const BremTaxInvoiceParse = (function () {
  const BAEMIN_FIELDS = [
    { key: 'supplyAmount', label: '공급가액', cells: ['B31'] },
    { key: 'vatAmount', label: '부가세액', cells: ['C31'] },
    { key: 'supplyTotal', label: '공급대가', cells: ['D31'] },
    { key: 'hourlyInsurance', label: '시간제보험', cells: ['H25'] },
    { key: 'employerEmploymentIns', label: '사업주부담 고용보험', cells: ['I25'] },
    // 사업주부담이 I25라 라이더부담은 바로 옆 J25. 같은 I25를 두 번 읽지 않는다.
    { key: 'riderEmploymentIns', label: '라이더부담 고용보험', cells: ['J25'] },
    { key: 'employerIndustrialIns', label: '사업주부담 산재보험', cells: ['K25'] },
    // L25가 비어 있으면 L2.
    { key: 'riderIndustrialIns', label: '라이더부담 산재보험', cells: ['L25', 'L2'] }
  ];

  const COUPANG_FIELDS = [
    { key: 'supplyAmount', label: '공급가액', cells: ['F19'] },
    { key: 'vatAmount', label: '부가세', cells: ['G19'] },
    // 합계 칸은 없다. 공급가액합계 F19 + 부가세합계 G19.
    { key: 'subtotal', label: '합계', sum: ['supplyAmount', 'vatAmount'] },
    { key: 'grandTotal', label: '총합계금액', cells: ['H19'] },
    { key: 'totalInsurance', label: '총보험료', cells: ['I19'] },
    { key: 'netPay', label: '총실지급액', cells: ['J19'] }
  ];

  function parseMoney(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.abs(Math.round(value));
    const raw = String(value ?? '').trim();
    if (!raw || /^[-–—]+$/.test(raw)) return null;
    const cleaned = raw
      .replace(/[₩원,\s]/g, '')
      .replace(/^\((.+)\)$/, '-$1');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    const amount = Number(cleaned);
    if (!Number.isFinite(amount)) return null;
    return Math.abs(Math.round(amount));
  }

  function readFirstMoney(cells, addresses) {
    const source = cells || {};
    for (let i = 0; i < addresses.length; i += 1) {
      const addr = addresses[i];
      if (!Object.prototype.hasOwnProperty.call(source, addr)) continue;
      const amount = parseMoney(source[addr]);
      if (amount != null) return amount;
    }
    return null;
  }

  /** 공급대가 − 시간제·고용(사업주·라이더)·산재(사업주·라이더). */
  function baeminNetPay(row) {
    const n = key => Number(row?.[key] || 0);
    return n('supplyTotal')
      - n('hourlyInsurance')
      - n('employerEmploymentIns')
      - n('riderEmploymentIns')
      - n('employerIndustrialIns')
      - n('riderIndustrialIns');
  }

  /** 금액에서 2%를 뺀 원 단위. 100만원이면 2만원을 빼 98만원. */
  function deductTwoPercent(amount) {
    const n = Math.round(Number(amount) || 0);
    return n - Math.round(n * 0.02);
  }

  function invoiceAmountAfterFee(row) {
    return deductTwoPercent(row?.supplyAmount) + deductTwoPercent(row?.vatAmount);
  }

  function baeminInsuranceSum(row) {
    const n = key => Number(row?.[key] || 0);
    return n('hourlyInsurance')
      + n('employerEmploymentIns')
      + n('riderEmploymentIns')
      + n('employerIndustrialIns')
      + n('riderIndustrialIns');
  }

  function baeminNetPayAfterFee(row) {
    return invoiceAmountAfterFee(row) - baeminInsuranceSum(row);
  }

  function coupangNetPayAfterFee(row) {
    return invoiceAmountAfterFee(row) - Number(row?.totalInsurance || 0);
  }

  function zeroFill(amounts) {
    const next = {};
    Object.keys(amounts || {}).forEach(key => {
      next[key] = amounts[key] == null ? 0 : amounts[key];
    });
    return next;
  }

  function extractBaemin(cells) {
    const amounts = {};
    let found = 0;
    BAEMIN_FIELDS.forEach(field => {
      const value = readFirstMoney(cells, field.cells);
      amounts[field.key] = value;
      if (value != null) found += 1;
    });
    const anchor = amounts.supplyAmount != null
      || amounts.vatAmount != null
      || amounts.supplyTotal != null;
    return { amounts, found, ok: Boolean(anchor && found > 0) };
  }

  function squashCell(value) {
    return String(value ?? '').replace(/\s+/g, '');
  }

  function shortHeaderEntries(cols) {
    return Object.keys(cols || {}).map(col => ({
      col,
      text: squashCell(cols[col])
    })).filter(entry => entry.text && entry.text.length <= 40);
  }

  function findHeaderColumn(entries, pattern) {
    return entries.find(entry => pattern.test(entry.text))?.col || '';
  }

  function sheetDateLabel(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return `${value.getMonth() + 1}/${value.getDate()}`;
    }
    if (typeof value === 'number' && value > 20000 && value < 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
      return `${utc.getUTCMonth() + 1}/${utc.getUTCDate()}`;
    }
    const raw = String(value ?? '').trim();
    const iso = raw.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (!iso) return '';
    return `${Number(iso[2])}/${Number(iso[3])}`;
  }

  function companyTag(cols) {
    const blob = Object.values(cols || {}).map(value => String(value ?? '')).join(' ');
    if (/이글스/.test(blob)) return '이글스';
    if (/119/.test(blob)) return '119';
    return '';
  }

  function isSectionBreak(cols) {
    const blob = Object.values(cols || {}).map(squashCell).join(' ');
    return /공급가액|정산시작일|주별합계|주차별/.test(blob) && !/\d{4}-\d{2}-\d{2}/.test(blob);
  }

  /**
   * 주별합계가 두 줄(119·이글스, 월말 분할)이면 각 줄을 매출로 만든다.
   * 한 줄짜리 파일은 빈 배열을 돌려 기존 B31 읽기를 유지한다.
   */
  function extractBaeminLines(cells) {
    const rows = rowsFromCells(cells);
    const rowNos = [...rows.keys()].sort((a, b) => a - b);
    let weekHeader = 0;
    let weekCols = {
      start: 'B', end: 'C', delivery: 'D', extra: 'E', fee: 'F', vat: 'G',
      hourly: 'H', employerEmployment: 'I', riderEmployment: 'J',
      employerIndustrial: 'K', riderIndustrial: 'L'
    };
    let taxHeader = 0;
    let taxCols = { supply: 'B', vat: 'C', total: 'D' };

    rowNos.forEach(rowNo => {
      const entries = shortHeaderEntries(rows.get(rowNo));
      if (!weekHeader && entries.some(entry => entry.text === '정산시작일')) {
        weekHeader = rowNo;
        weekCols = {
          start: findHeaderColumn(entries, /^정산시작일/) || weekCols.start,
          end: findHeaderColumn(entries, /^정산종료일/) || weekCols.end,
          delivery: findHeaderColumn(entries, /^배달료/) || weekCols.delivery,
          extra: findHeaderColumn(entries, /^추가정산/) || weekCols.extra,
          fee: findHeaderColumn(entries, /^관리비/) || weekCols.fee,
          vat: findHeaderColumn(entries, /^부가세액/) || weekCols.vat,
          hourly: findHeaderColumn(entries, /시간제보험/) || weekCols.hourly,
          employerEmployment: findHeaderColumn(entries, /사업주부담.*고용/) || weekCols.employerEmployment,
          riderEmployment: findHeaderColumn(entries, /라이더부담.*고용/) || weekCols.riderEmployment,
          employerIndustrial: findHeaderColumn(entries, /사업주부담.*산재/) || weekCols.employerIndustrial,
          riderIndustrial: findHeaderColumn(entries, /라이더부담.*산재/) || weekCols.riderIndustrial
        };
      }
      if (!taxHeader && entries.some(entry => entry.text === '공급가액')) {
        taxHeader = rowNo;
        taxCols = {
          supply: findHeaderColumn(entries, /^공급가액/) || taxCols.supply,
          vat: findHeaderColumn(entries, /^부가세액/) || taxCols.vat,
          total: findHeaderColumn(entries, /^공급대가/) || taxCols.total
        };
      }
    });

    function followingRows(headerRow, accept) {
      if (!headerRow) return [];
      const found = [];
      let skipped = 0;
      rowNos.filter(rowNo => rowNo > headerRow).forEach(rowNo => {
        if (found.length >= 6 || skipped >= 2) return;
        const cols = rows.get(rowNo);
        if (isSectionBreak(cols) && found.length) {
          skipped = 2;
          return;
        }
        if (!accept(cols)) {
          if (found.length) skipped += 1;
          return;
        }
        skipped = 0;
        found.push({ rowNo, cols });
      });
      return found;
    }

    const weekRows = followingRows(weekHeader, cols => {
      const delivery = parseMoney(cols[weekCols.delivery]);
      const vat = parseMoney(cols[weekCols.vat]);
      const hourly = parseMoney(cols[weekCols.hourly]);
      return delivery != null || vat != null || hourly != null || Boolean(sheetDateLabel(cols[weekCols.start]));
    });
    const taxRows = followingRows(taxHeader, cols => (
      parseMoney(cols[taxCols.supply]) != null
      || parseMoney(cols[taxCols.vat]) != null
      || parseMoney(cols[taxCols.total]) != null
    )).filter(row => !/^(합계|총계|총합계|소계)$/.test(squashCell(row.cols.A || row.cols.B)));

    function insuranceOf(cols) {
      if (!cols) {
        return {
          hourlyInsurance: 0,
          employerEmploymentIns: 0,
          riderEmploymentIns: 0,
          employerIndustrialIns: 0,
          riderIndustrialIns: 0
        };
      }
      const read = col => parseMoney(cols[col]) || 0;
      return {
        hourlyInsurance: read(weekCols.hourly),
        employerEmploymentIns: read(weekCols.employerEmployment),
        riderEmploymentIns: read(weekCols.riderEmployment),
        employerIndustrialIns: read(weekCols.employerIndustrial),
        riderIndustrialIns: read(weekCols.riderIndustrial)
      };
    }

    function weekAmount(row) {
      const cols = row.cols;
      const delivery = parseMoney(cols[weekCols.delivery]) || 0;
      const extra = parseMoney(cols[weekCols.extra]) || 0;
      const fee = parseMoney(cols[weekCols.fee]) || 0;
      const supplyAmount = delivery + extra + fee;
      const vatAmount = parseMoney(cols[weekCols.vat]) || 0;
      const start = sheetDateLabel(cols[weekCols.start]);
      const end = sheetDateLabel(cols[weekCols.end]);
      const range = start && end ? `${start}~${end}` : (start || '');
      let company = companyTag(cols);
      if (!company) {
        for (let cursor = row.rowNo - 1; cursor > weekHeader; cursor -= 1) {
          const above = rows.get(cursor);
          if (!above) continue;
          if (parseMoney(above[weekCols.delivery]) != null || sheetDateLabel(above[weekCols.start])) break;
          company = companyTag(above);
          if (company) break;
        }
      }
      return {
        name: [company, range].filter(Boolean).join(' '),
        supplyAmount,
        vatAmount,
        supplyTotal: supplyAmount + vatAmount,
        ...insuranceOf(cols)
      };
    }

    function taxAmount(row, index) {
      const cols = row.cols;
      const supplyAmount = parseMoney(cols[taxCols.supply]) || 0;
      const vatAmount = parseMoney(cols[taxCols.vat]) || 0;
      const supplyTotal = parseMoney(cols[taxCols.total]);
      const week = weekRows[index];
      const weekLine = week ? weekAmount(week) : null;
      return {
        name: weekLine?.name || companyTag(cols) || '',
        supplyAmount,
        vatAmount,
        supplyTotal: supplyTotal == null ? supplyAmount + vatAmount : supplyTotal,
        ...insuranceOf(week?.cols)
      };
    }

    let lines = [];
    if (taxRows.length >= 2) {
      lines = taxRows.map(taxAmount);
    } else if (weekRows.length >= 2) {
      lines = weekRows.map(weekAmount);
    }
    if (lines.length < 2) return [];
    lines.forEach((line, index) => {
      if (!line.name) line.name = `주별합계 ${index + 1}`;
    });
    return lines;
  }

  function cellPosition(address) {
    const match = /^([A-Z]+)(\d+)$/.exec(String(address || ''));
    if (!match) return null;
    return { col: match[1], row: Number(match[2]) };
  }

  function isCoupangTotalLabel(value) {
    const text = String(value || '').replace(/\s+/g, '');
    if (!text) return true;
    return /^(합계|총계|총합계|소계|공급가액합계|부가세합계|정산서|정산서명|이름)$/.test(text);
  }

  /**
   * 쿠팡 계산서 본문. C열은 정산서 이름, F~J는 그 줄 금액.
   * 19행은 파일 전체 합계라 매출 줄에서 뺀다.
   */
  function rowsFromCells(cells) {
    const rows = new Map();
    Object.keys(cells || {}).forEach(address => {
      const pos = cellPosition(address);
      if (!pos) return;
      if (!rows.has(pos.row)) rows.set(pos.row, {});
      rows.get(pos.row)[pos.col] = cells[address];
    });
    return rows;
  }

  function coupangLineColumns(rows) {
    const columns = { name: 'C', supply: 'F', vat: 'G', insurance: 'I', net: 'J', headerRow: 0 };
    const rowNos = [...rows.keys()].sort((a, b) => a - b);
    for (let i = 0; i < rowNos.length; i += 1) {
      const cols = rows.get(rowNos[i]);
      const entries = Object.keys(cols).map(col => ({
        col,
        text: String(cols[col] ?? '').replace(/\s+/g, '')
      }));
      const nameHit = entries.find(entry => /정산서/.test(entry.text));
      const supplyHit = entries.find(entry => /공급가액/.test(entry.text));
      if (!nameHit || !supplyHit) continue;
      columns.name = nameHit.col;
      columns.supply = supplyHit.col;
      columns.headerRow = rowNos[i];
      const vatHit = entries.find(entry => /부가세/.test(entry.text));
      const insuranceHit = entries.find(entry => /보험/.test(entry.text));
      const netHit = entries.find(entry => /실지급/.test(entry.text));
      if (vatHit) columns.vat = vatHit.col;
      if (insuranceHit) columns.insurance = insuranceHit.col;
      if (netHit) columns.net = netHit.col;
      break;
    }
    return columns;
  }

  function extractCoupangLines(cells) {
    const rows = rowsFromCells(cells);
    const columns = coupangLineColumns(rows);
    const lines = [];
    [...rows.keys()].sort((a, b) => a - b).forEach(rowNo => {
      if (rowNo === 19 || rowNo === columns.headerRow) return;
      const cols = rows.get(rowNo);
      const name = String(cols[columns.name] ?? '').trim();
      if (isCoupangTotalLabel(name)) return;
      const supply = parseMoney(cols[columns.supply]);
      const vat = parseMoney(cols[columns.vat]);
      const insurance = parseMoney(cols[columns.insurance]);
      const net = parseMoney(cols[columns.net]);
      if (supply == null && vat == null && insurance == null && net == null) return;
      const supplyAmount = supply || 0;
      const vatAmount = vat || 0;
      const totalInsurance = insurance || 0;
      const subtotal = supplyAmount + vatAmount;
      lines.push({
        name,
        supplyAmount,
        vatAmount,
        subtotal,
        totalInsurance,
        netPay: net == null ? subtotal - totalInsurance : net
      });
    });
    return lines;
  }

  function extractCoupang(cells) {
    const amounts = {};
    let found = 0;
    COUPANG_FIELDS.forEach(field => {
      if (field.sum) return;
      const value = readFirstMoney(cells, field.cells || []);
      amounts[field.key] = value;
      if (value != null) found += 1;
    });
    const supply = amounts.supplyAmount;
    const vat = amounts.vatAmount;
    amounts.subtotal = (supply == null && vat == null) ? null : Number(supply || 0) + Number(vat || 0);
    if (amounts.subtotal != null) found += 1;
    const anchor = amounts.supplyAmount != null
      || amounts.grandTotal != null
      || amounts.netPay != null;
    return { amounts, found, ok: Boolean(anchor && found > 0) };
  }

  function pickSheet(sheets, extract) {
    let best = null;
    (sheets || []).forEach(sheet => {
      const result = extract(sheet?.cells || {});
      if (!result.ok) return;
      if (!best || result.found > best.found) {
        best = {
          amounts: zeroFill(result.amounts),
          found: result.found,
          sheetName: String(sheet?.name || '')
        };
      }
    });
    return best;
  }

  return {
    BAEMIN_FIELDS,
    COUPANG_FIELDS,
    parseMoney,
    baeminNetPay,
    baeminInsuranceSum,
    deductTwoPercent,
    invoiceAmountAfterFee,
    baeminNetPayAfterFee,
    coupangNetPayAfterFee,
    extractBaemin,
    extractBaeminLines,
    extractCoupang,
    extractCoupangLines,
    pickSheet
  };
})();

if (typeof window !== 'undefined') window.BremTaxInvoiceParse = BremTaxInvoiceParse;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BremTaxInvoiceParse;
}

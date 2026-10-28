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
    extractCoupang,
    pickSheet
  };
})();

if (typeof window !== 'undefined') window.BremTaxInvoiceParse = BremTaxInvoiceParse;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BremTaxInvoiceParse;
}

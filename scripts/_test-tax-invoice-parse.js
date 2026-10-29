const assert = require('assert');
const XLSX = require('xlsx');
const Parse = require('../js/tax-invoice-parse');
const { openSheetRows } = require('../server/settlement-parser');

function testBaeminCells() {
  const cells = {
    B31: 1000, C31: '100', D31: '1,100원',
    H25: 1, I25: 2, J25: 3, K25: 4, L25: 5
  };
  const result = Parse.extractBaemin(cells);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.amounts.supplyAmount, 1000);
  assert.strictEqual(result.amounts.vatAmount, 100);
  assert.strictEqual(result.amounts.supplyTotal, 1100);
  assert.strictEqual(result.amounts.employerEmploymentIns, 2);
  assert.strictEqual(result.amounts.riderEmploymentIns, 3);
  assert.strictEqual(result.amounts.riderIndustrialIns, 5);
}

function testBaeminNetPay() {
  assert.strictEqual(Parse.baeminNetPay({
    supplyTotal: 8742800,
    hourlyInsurance: 39492,
    employerEmploymentIns: 79770,
    riderEmploymentIns: 79770,
    employerIndustrialIns: 54390,
    riderIndustrialIns: 54390
  }), 8434988);
  assert.strictEqual(Parse.baeminInsuranceSum({
    hourlyInsurance: 39492,
    employerEmploymentIns: 79770,
    riderEmploymentIns: 79770,
    employerIndustrialIns: 54390,
    riderIndustrialIns: 54390
  }), 307812);
}

function testBaeminL2Fallback() {
  const cells = { B31: 10, L2: 9 };
  const result = Parse.extractBaemin(cells);
  assert.strictEqual(result.amounts.riderIndustrialIns, 9);
}

function testCoupangFixedCells() {
  const cells = {
    F18: '공급가액합계', G18: '부가세합계', H18: '총합계금액', I18: '총보험료', J18: '총실지급액',
    F19: '1,000', G19: 100, H19: 2000, I19: 7, J19: 900,
    A1: '합계', B1: 10,
    A3: '공급가액', B3: 5
  };
  const result = Parse.extractCoupang(cells);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.amounts.supplyAmount, 1000);
  assert.strictEqual(result.amounts.vatAmount, 100);
  assert.strictEqual(result.amounts.subtotal, 1100);
  assert.strictEqual(result.amounts.grandTotal, 2000);
  assert.strictEqual(result.amounts.totalInsurance, 7);
  assert.strictEqual(result.amounts.netPay, 900);
}

function testCoupangLines() {
  const cells = {
    C4: '119라이더스_양산_2026_10-4',
    F4: 1000,
    G4: 100,
    I4: 30,
    J4: 1070,
    C5: '119라이더스_중구중앙_2026_10-4',
    F5: 2000,
    G5: 200,
    H5: 9999,
    I5: 50,
    J5: 2150,
    C18: '정산서명',
    F18: '공급가액합계',
    F19: 3000,
    G19: 300,
    I19: 80,
    J19: 3220
  };
  const lines = Parse.extractCoupangLines(cells);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].name, '119라이더스_양산_2026_10-4');
  assert.strictEqual(lines[0].supplyAmount, 1000);
  assert.strictEqual(lines[0].vatAmount, 100);
  assert.strictEqual(lines[0].subtotal, 1100);
  assert.strictEqual(lines[0].totalInsurance, 30);
  assert.strictEqual(lines[0].netPay, 1070);
  assert.strictEqual(lines[1].subtotal, 2200);
  assert.strictEqual(lines[1].netPay, 2150);
}

function testPickRicherSheet() {
  const sheets = [
    { name: '라이더', cells: { A1: '합계', B1: 999, F19: 1 } },
    {
      name: '계산서',
      cells: { F19: 50, G19: 5, H19: 80, J19: 70 }
    }
  ];
  const picked = Parse.pickSheet(sheets, Parse.extractCoupang);
  assert.strictEqual(picked.sheetName, '계산서');
  assert.strictEqual(picked.amounts.supplyAmount, 50);
  assert.strictEqual(picked.amounts.subtotal, 55);
  assert.strictEqual(picked.amounts.grandTotal, 80);
}

async function testServerCellMap() {
  const sheet = {
    B31: { t: 'n', v: 4321 },
    C31: { t: 'n', v: 432 },
    D31: { t: 'n', v: 4753 },
    H25: { t: 'n', v: 11 },
    '!ref': 'A1:L31'
  };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '표지');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const opened = await openSheetRows({ buffer, password: '', allSheets: true });
  const cells = opened.sheets[0].cells;
  assert.strictEqual(Number(cells.B31), 4321);
  assert.strictEqual(Number(cells.H25), 11);
  const parsed = Parse.extractBaemin(cells);
  assert.strictEqual(parsed.amounts.supplyAmount, 4321);
  assert.strictEqual(parsed.amounts.supplyTotal, 4753);
}

function testBaeminTwoWeekTotals() {
  const cells = {
    B24: '정산시작일', C24: '정산종료일', D24: '배달료', E24: '추가정산', F24: '관리비',
    G24: '부가세액', H24: '시간제보험료',
    I24: '사업주부담고용보험료', J24: '라이더부담고용보험료',
    K24: '사업주부담산재보험료', L24: '라이더부담산재보험료',
    A25: '119컴퍼니',
    B25: '2026-10-21', C25: '2026-10-23',
    D25: 1000, E25: 0, F25: 0, G25: 100,
    H25: 1, I25: 2, J25: 3, K25: 4, L25: 5,
    A26: '배달 이글스',
    B26: '2026-10-24', C26: '2026-10-27',
    D26: 2000, E26: 50, F26: 20, G26: 200,
    H26: 10, I26: 20, J26: 30, K26: 40, L26: 50,
    B30: '공급가액', C30: '부가세액', D30: '공급대가',
    B31: 1000, C31: 100, D31: 1100,
    B32: 2070, C32: 200, D32: 2270
  };
  const lines = Parse.extractBaeminLines(cells);
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].name.includes('119'), true);
  assert.strictEqual(lines[0].supplyAmount, 1000);
  assert.strictEqual(lines[0].supplyTotal, 1100);
  assert.strictEqual(lines[0].hourlyInsurance, 1);
  assert.strictEqual(lines[0].riderIndustrialIns, 5);
  assert.strictEqual(lines[1].name.includes('이글스'), true);
  assert.strictEqual(lines[1].supplyAmount, 2070);
  assert.strictEqual(lines[1].vatAmount, 200);
  assert.strictEqual(lines[1].supplyTotal, 2270);
  assert.strictEqual(lines[1].employerEmploymentIns, 20);
  assert.strictEqual(lines[1].riderIndustrialIns, 50);
  const single = Parse.extractBaeminLines({ B31: 10, C31: 1, D31: 11, H25: 4 });
  assert.strictEqual(single.length, 0);
}

function testTwoPercentInvoice() {
  assert.strictEqual(Parse.deductTwoPercent(1000000), 980000);
  assert.strictEqual(Parse.invoiceAmountAfterFee({
    supplyAmount: 1000000,
    vatAmount: 100000
  }), 1078000);
  assert.strictEqual(Parse.baeminNetPayAfterFee({
    supplyAmount: 1000000,
    vatAmount: 100000,
    hourlyInsurance: 1000,
    employerEmploymentIns: 2000,
    riderEmploymentIns: 3000,
    employerIndustrialIns: 4000,
    riderIndustrialIns: 5000
  }), 1063000);
  assert.strictEqual(Parse.coupangNetPayAfterFee({
    supplyAmount: 1000000,
    vatAmount: 100000,
    totalInsurance: 30000
  }), 1048000);
}

async function main() {
  testBaeminCells();
  testBaeminNetPay();
  testBaeminL2Fallback();
  testCoupangFixedCells();
  testCoupangLines();
  testBaeminTwoWeekTotals();
  testTwoPercentInvoice();
  testPickRicherSheet();
  await testServerCellMap();
  console.log('tax invoice parse ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

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

async function main() {
  testBaeminCells();
  testBaeminNetPay();
  testBaeminL2Fallback();
  testCoupangFixedCells();
  testPickRicherSheet();
  await testServerCellMap();
  console.log('tax invoice parse ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

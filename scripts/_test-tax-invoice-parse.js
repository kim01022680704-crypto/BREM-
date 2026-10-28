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

function testBaeminL2Fallback() {
  const cells = { B31: 10, L2: 9 };
  const result = Parse.extractBaemin(cells);
  assert.strictEqual(result.amounts.riderIndustrialIns, 9);
}

function testCoupangLabelsDoNotCollide() {
  const cells = {
    A1: '합계', B1: 10,
    A2: '총합계금액', B2: 20,
    A3: '공급가액', B3: '1,000',
    A4: '부가세', B4: 100,
    A5: '총보험료', B5: 7,
    A6: '총실지급액', B6: 900
  };
  const result = Parse.extractCoupang(cells);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.amounts.subtotal, 10);
  assert.strictEqual(result.amounts.grandTotal, 20);
  assert.strictEqual(result.amounts.supplyAmount, 1000);
  assert.strictEqual(result.amounts.vatAmount, 100);
  assert.strictEqual(result.amounts.totalInsurance, 7);
  assert.strictEqual(result.amounts.netPay, 900);
}

function testPickRicherSheet() {
  const sheets = [
    { name: '라이더', cells: { A1: '합계', B1: 999 } },
    {
      name: '계산서',
      cells: {
        A1: '공급가액', B1: 50,
        A2: '총합계금액', B2: 80,
        A3: '총실지급액', B3: 70
      }
    }
  ];
  const picked = Parse.pickSheet(sheets, Parse.extractCoupang);
  assert.strictEqual(picked.sheetName, '계산서');
  assert.strictEqual(picked.amounts.supplyAmount, 50);
  assert.strictEqual(picked.amounts.subtotal, 0);
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
  testBaeminL2Fallback();
  testCoupangLabelsDoNotCollide();
  testPickRicherSheet();
  await testServerCellMap();
  console.log('tax invoice parse ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

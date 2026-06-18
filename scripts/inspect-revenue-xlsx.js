const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const base = 'C:\\Users\\user\\Desktop\\브라더 공유폴더\\★BREM 경리일보★';
const files = fs.readdirSync(base).filter(f => f.endsWith('.xlsx') && f.includes('★'));

for (const file of files) {
  const full = path.join(base, file);
  console.log('\n========', file, '========');
  const wb = XLSX.readFile(full, { cellDates: true });
  console.log('Sheets:', wb.SheetNames.join(' | '));
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
    console.log('\n---', name, `(rows: ${rows.length}) ---`);
    rows.slice(0, 30).forEach((row, i) => {
      const cells = row.slice(0, 15).map(v => String(v ?? '').replace(/\s+/g, ' ').trim());
      if (cells.some(Boolean)) console.log(String(i + 1).padStart(3), cells.join(' | '));
    });
  }
}

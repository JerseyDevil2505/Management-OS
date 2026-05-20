/* eslint-disable */
const XLSX = require('xlsx');
const wb = XLSX.readFile('/tmp/dl/king.xlsx');
wb.SheetNames.forEach(name => {
  console.log('\n=== Sheet:', name, '===');
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  rows.forEach((r, i) => {
    console.log(String(i).padStart(3), '|', r.map(c => String(c).slice(0, 20)).join(' | '));
  });
});

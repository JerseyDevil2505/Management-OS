const fs = require('fs');
const b = require('@babel/parser');

const f = 'src/components/job-modules/market-tabs/LandValuationTab.jsx';
let s = fs.readFileSync(f, 'utf8');
const edits = JSON.parse(fs.readFileSync('scripts/lv-patch.json', 'utf8'));

for (const e of edits) {
  const expected = e.count || 1;
  const n = s.split(e.old).length - 1;
  if (n !== expected) {
    console.log('ABORT: found ' + n + ', expected ' + expected + ' for: ' + e.old.slice(0, 70));
    process.exit(1);
  }
  s = s.split(e.old).join(e.new);
}

try {
  b.parse(s, { sourceType: 'module', plugins: ['jsx'] });
} catch (err) {
  console.log('PARSE FAIL ' + err.message);
  process.exit(1);
}

fs.writeFileSync(f, s);
console.log('APPLIED + PARSE OK');

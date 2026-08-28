const fs = require('fs');

const raw = fs.readFileSync(__dirname + '/pat-berkeley-land-valuation.csv', 'utf8');

function parseLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const lines = raw.split('\n').filter(l => l.trim() !== '');
const rows = lines.slice(1).map(parseLine);

const bad = rows.filter(r => r.length !== 20);
if (bad.length) {
  console.error('Rows with wrong column count:', bad.length);
  bad.slice(0, 5).forEach(r => console.error(r.length, r.join('|')));
  process.exit(1);
}

const q = v => (v === null || v === undefined || v === '') ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";

const values = rows.map((r, i) => {
  const [include, block, lotRaw, qual, address, cls, , , , vcs, , , specialRegion, category, saleDate, salePrice, , , pkg, notes] = r;
  const lot = lotRaw.replace(/\s*\(\+\d+\s+more\)\s*/i, '').trim();
  const isPackage = /^Y/i.test(pkg.trim());
  return `(${[
    "'f8eecbf5-c18e-42fa-80e3-312f41e79952'",
    i + 1,
    q(include.trim()),
    q(block.trim()),
    q(lot),
    q(qual.trim()),
    q(address.trim()),
    q(cls.trim()),
    q(vcs.trim()),
    q(specialRegion.trim()),
    q(category.trim()),
    q(saleDate.trim()),
    q(salePrice.trim()),
    isPackage ? 'true' : 'false',
    q(notes.trim())
  ].join(',')})`;
});

const sql = `insert into public.land_valuation_csv_restore
(job_id,row_num,include,block,lot,qual,address,class,vcs,special_region,category,sale_date,sale_price,is_package,notes)
values\n${values.join(',\n')};`;

fs.writeFileSync(__dirname + '/pat-csv-insert.sql', sql);

console.log('rows:', rows.length);
console.log('package rows:', rows.filter(r => /^Y/i.test(r[18].trim())).length);
console.log('include Y:', rows.filter(r => r[0].trim() === 'Y').length);
console.log('with notes:', rows.filter(r => r[19].trim() !== '').length);
console.log('lot noise cleaned:', rows.filter(r => /\(\+\d+ more\)/i.test(r[2])).length);
console.log('sql bytes:', sql.length);

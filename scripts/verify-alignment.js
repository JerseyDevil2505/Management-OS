const fs = require('fs');
const crypto = require('crypto');

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

const rows = raw.split('\n').filter(l => l.trim() !== '').slice(1).map(parseLine);

const tuples = rows.map((r, i) => {
  const block = r[1].trim();
  const lot = r[2].replace(/\s*\(\+\d+\s+more\)\s*/i, '').trim();
  const address = r[4].trim();
  const date = r[14].trim();
  const h = crypto.createHash('md5').update(`${block}|${lot}|${address}|${date}`).digest('hex').slice(0, 10);
  return `(${i + 1},'${h}')`;
});

fs.writeFileSync(__dirname + '/alignment-values.txt', tuples.join(','));
console.log('tuples:', tuples.length, 'bytes:', tuples.join(',').length);

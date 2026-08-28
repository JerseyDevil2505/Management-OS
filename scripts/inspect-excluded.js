const fs = require('fs');

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

const rows = fs.readFileSync(__dirname + '/pat-berkeley-land-valuation.csv', 'utf8')
  .split('\n').filter(l => l.trim()).slice(1).map(parseLine);

const norm = c => (c === 'building-lot' ? 'building_lot' : c);
const cats = {};
rows.forEach(r => {
  const c = norm(r[13].trim()) || '(blank)';
  cats[c] = cats[c] || { Y: 0, N: 0, nNotes: 0 };
  cats[c][r[0].trim() === 'Y' ? 'Y' : 'N']++;
  if (r[0].trim() !== 'Y' && r[19].trim()) cats[c].nNotes++;
});

console.log('category          included  excluded  (excluded w/ notes)');
Object.entries(cats).sort((a, b) => (b[1].Y + b[1].N) - (a[1].Y + a[1].N))
  .forEach(([k, v]) => console.log(
    `${k.padEnd(18)}${String(v.Y).padStart(6)}${String(v.N).padStart(10)}${String(v.nNotes).padStart(12)}`));

const totalN = rows.filter(r => r[0].trim() !== 'Y').length;
console.log(`\ntotal excluded: ${totalN}`);

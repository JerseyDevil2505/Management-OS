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

const tally = {};
rows.forEach(r => {
  const cat = r[13].trim();
  if (!cat.startsWith('building')) return;
  const key = `${cat.padEnd(13)} Include=${r[0].trim()}  ${r[19].trim() ? 'has-notes' : 'no-notes '}`;
  tally[key] = (tally[key] || 0) + 1;
});

Object.entries(tally).sort().forEach(([k, v]) => console.log(String(v).padStart(4), k));

console.log('\nSample building-lot (hyphen) rows:');
rows.filter(r => r[13].trim() === 'building-lot').slice(0, 3)
  .forEach(r => console.log(`  blk ${r[1]} lot ${r[2]} ${r[4]} | notes: "${r[19].trim()}"`));

console.log('\nSample building_lot (underscore) rows:');
rows.filter(r => r[13].trim() === 'building_lot').slice(0, 3)
  .forEach(r => console.log(`  blk ${r[1]} lot ${r[2]} ${r[4]} | notes: "${r[19].trim()}"`));

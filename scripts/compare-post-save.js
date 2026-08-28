// Compares Berkeley's current market_land_valuation Method 1 state against the CSV baseline.
require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const JOB_ID = 'f8eecbf5-c18e-42fa-80e3-312f41e79952';
const db = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

function parseLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

(async () => {
  const { data, error } = await db
    .from('market_land_valuation')
    .select('vacant_sales_analysis, updated_at')
    .eq('job_id', JOB_ID)
    .single();
  if (error) throw error;

  const sales = data.vacant_sales_analysis?.sales || [];
  const excluded = data.vacant_sales_analysis?.excluded_sales || [];
  console.log('updated_at        :', data.updated_at);
  console.log('saved sales       :', sales.length);
  console.log('excluded_sales    :', Array.isArray(excluded) ? excluded.length : 'n/a');

  const included = sales.filter(s => s.included).length;
  const notes = sales.filter(s => s.notes && String(s.notes).trim()).length;
  const regions = sales.filter(s => s.special_region && s.special_region !== 'Normal').length;
  const withIdentity = sales.filter(s => s.block || s.lot || s.address).length;
  console.log('included          :', included);
  console.log('notes             :', notes);
  console.log('special regions   :', regions);
  console.log('with identity     :', withIdentity);

  const idKinds = { current: 0, prior: 0, package: 0 };
  sales.forEach(s => {
    const id = s.id || '';
    if (id.startsWith('package_')) idKinds.package++;
    else if (id.includes('::prev')) idKinds.prior++;
    else idKinds.current++;
  });
  console.log('id kinds          :', JSON.stringify(idKinds));

  const cats = {};
  sales.forEach(s => { const c = s.category || '(none)'; cats[c] = (cats[c] || 0) + 1; });
  console.log('categories        :');
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('   ', k.padEnd(18), v));

  const badExcluded = sales.filter(s => !s.included && s.category && s.category !== 'uncategorized');
  console.log('excluded w/ non-uncategorized category:', badExcluded.length);
  const includedUncat = sales.filter(s => s.included && s.category === 'uncategorized');
  console.log('included but uncategorized           :', includedUncat.length);

  // CSV baseline
  const rows = fs.readFileSync(__dirname + '/pat-berkeley-land-valuation.csv', 'utf8')
    .split('\n').filter(l => l.trim()).slice(1).map(parseLine);
  const csvIncluded = rows.filter(r => r[0].trim().toUpperCase() === 'Y').length;
  const csvNotes = rows.filter(r => (r[19] || '').trim()).length;
  const csvRegions = rows.filter(r => (r[12] || '').trim() && (r[12] || '').trim() !== 'Normal').length;
  console.log('---- CSV baseline ----');
  console.log('csv rows          :', rows.length);
  console.log('csv included      :', csvIncluded);
  console.log('csv notes         :', csvNotes);
  console.log('csv regions       :', csvRegions);

  console.log('---- deltas (db - csv) ----');
  console.log('rows     :', sales.length - rows.length);
  console.log('included :', included - csvIncluded);
  console.log('notes    :', notes - csvNotes);
  console.log('regions  :', regions - csvRegions);
})();

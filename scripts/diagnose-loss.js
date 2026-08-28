/**
 * Compares the live market_land_valuation against what the CSV restore wrote,
 * to identify which sales lost notes/include flags and whether those rows
 * correlate with property ids the file update orphaned.
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const JOB_ID = 'f8eecbf5-c18e-42fa-80e3-312f41e79952';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
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

const csv = fs.readFileSync(__dirname + '/pat-berkeley-land-valuation.csv', 'utf8')
  .split('\n').filter(l => l.trim()).slice(1).map(parseLine).map(r => ({
    include: r[0].trim() === 'Y',
    block: r[1].trim(),
    lot: r[2].replace(/\s*\(\+\d+\s+more\)\s*/i, '').trim(),
    address: r[4].trim(),
    specialRegion: r[12].trim() || 'Normal',
    notes: r[19].trim()
  }));

async function main() {
  const { data: mlv, error } = await supabase
    .from('market_land_valuation')
    .select('vacant_sales_analysis')
    .eq('job_id', JOB_ID).single();
  if (error) throw error;

  const sales = mlv.vacant_sales_analysis.sales;
  console.log(`live sales ${sales.length}, csv rows ${csv.length}`);

  const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || '');
  const ids = [...new Set(sales.map(s => s.id).filter(isUuid))];
  const live = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await supabase.from('property_records')
      .select('id').in('id', ids.slice(i, i + 500));
    data.forEach(p => live.add(p.id));
  }

  let lostNotes = 0, lostInclude = 0, lostRegion = 0;
  let lostNotesOrphan = 0, lostIncludeOrphan = 0;
  let identityDrift = 0;

  sales.forEach((s, i) => {
    const c = csv[i];
    const orphan = !live.has(s.id);

    if ((s.block || '') !== c.block || (s.address || '') !== c.address) identityDrift++;

    if (c.notes && !(s.notes || '')) { lostNotes++; if (orphan) lostNotesOrphan++; }
    if (c.include && !s.included) { lostInclude++; if (orphan) lostIncludeOrphan++; }
    if (c.specialRegion !== 'Normal' && (s.special_region || 'Normal') === 'Normal') lostRegion++;
  });

  const orphanCount = sales.filter(s => !live.has(s.id)).length;

  console.log(`\nsales pointing at a non-existent property: ${orphanCount}`);
  console.log(`rows whose block/address no longer match the CSV position: ${identityDrift}`);
  console.log(`\nlost notes    : ${lostNotes}  (of which orphaned: ${lostNotesOrphan})`);
  console.log(`lost include  : ${lostInclude}  (of which orphaned: ${lostIncludeOrphan})`);
  console.log(`lost region   : ${lostRegion}`);
}

main().catch(e => { console.error(e); process.exit(1); });

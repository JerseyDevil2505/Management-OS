/**
 * Restores Pat's Berkeley Land Valuation Method 1 work from his CSV export.
 *
 * The export writes one row per entry of vacant_sales_analysis.sales in array
 * order, so CSV row N maps to sales[N-1]. That correspondence is re-verified
 * here against property_records before anything is written.
 *
 * Usage: node restore-pat-berkeley.js [--apply]
 */
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const JOB_ID = 'f8eecbf5-c18e-42fa-80e3-312f41e79952';
const APPLY = process.argv.includes('--apply');

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

function loadCsv() {
  const raw = fs.readFileSync(__dirname + '/pat-berkeley-land-valuation.csv', 'utf8');
  return raw.split('\n').filter(l => l.trim() !== '').slice(1).map(parseLine).map(r => ({
    include: r[0].trim() === 'Y',
    block: r[1].trim(),
    lot: r[2].replace(/\s*\(\+\d+\s+more\)\s*/i, '').trim(),
    qual: r[3].trim(),
    address: r[4].trim(),
    specialRegion: r[12].trim() || 'Normal',
    category: r[13].trim() === 'building-lot' ? 'building_lot' : r[13].trim(),
    rawCategory: r[13].trim(),
    saleDate: r[14].trim(),
    isPackage: /^Y/i.test(r[18].trim()),
    notes: r[19].trim()
  }));
}

async function main() {
  const csv = loadCsv();

  const { data: mlv, error } = await supabase
    .from('market_land_valuation')
    .select('id, vacant_sales_analysis')
    .eq('job_id', JOB_ID)
    .single();
  if (error) throw error;

  const sales = mlv.vacant_sales_analysis.sales;
  console.log(`CSV rows: ${csv.length}   saved sales: ${sales.length}`);
  if (csv.length !== sales.length) {
    console.error('ABORT: row count mismatch, positional mapping is unsafe.');
    process.exit(1);
  }

  // Resolve the still-live property rows so alignment can be re-verified.
  const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || '');
  const ids = [...new Set(sales.map(s => s.id).filter(isUuid))];
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error: e } = await supabase
      .from('property_records')
      .select('id, property_block, property_lot, property_location, sales_date')
      .in('id', ids.slice(i, i + 500));
    if (e) throw e;
    data.forEach(p => byId.set(p.id, p));
  }

  let verified = 0, orphaned = 0;
  const misaligned = [];
  csv.forEach((row, i) => {
    const p = byId.get(sales[i].id);
    if (!p) { orphaned++; return; }
    const ok =
      (p.property_block || '') === row.block &&
      (p.property_lot || '') === row.lot &&
      (p.property_location || '') === row.address &&
      (p.sales_date || '') === row.saleDate;
    if (ok) verified++;
    else misaligned.push({ row: i + 1, csv: `${row.block}|${row.lot}|${row.address}|${row.saleDate}`,
      db: `${p.property_block}|${p.property_lot}|${p.property_location}|${p.sales_date}` });
  });

  console.log(`\nAlignment: verified ${verified}, orphaned(unverifiable) ${orphaned}, MISALIGNED ${misaligned.length}`);
  if (misaligned.length) {
    console.log('\nMisaligned rows:');
    misaligned.slice(0, 40).forEach(m => console.log(`  row ${m.row}\n    csv: ${m.csv}\n    db : ${m.db}`));
    if (misaligned.length > 40) console.log(`  ... and ${misaligned.length - 40} more`);
  }

  // Build restored array.
  let catChanged = 0, notesAdded = 0, includeChanged = 0, regionChanged = 0;
  const restored = sales.map((s, i) => {
    const row = csv[i];
    if ((s.category || '') !== row.category) catChanged++;
    if (!(s.notes || '') && row.notes) notesAdded++;
    if (Boolean(s.included) !== row.include) includeChanged++;
    if ((s.special_region || 'Normal') !== row.specialRegion) regionChanged++;
    return {
      ...s,
      block: row.block || null,
      lot: row.lot || null,
      qualifier: row.qual || null,
      address: row.address || null,
      included: row.include,
      category: row.category || null,
      special_region: row.specialRegion,
      notes: row.notes || null,
      is_package: row.isPackage
    };
  });

  const excluded = restored.filter(s => !s.included).map(s => s.id);

  console.log('\nWould change:');
  console.log(`  categories differing : ${catChanged}`);
  console.log(`  notes restored       : ${notesAdded}`);
  console.log(`  include flags changed: ${includeChanged}`);
  console.log(`  special regions      : ${regionChanged}`);
  console.log(`  included / excluded  : ${restored.filter(s => s.included).length} / ${excluded.length}`);
  console.log(`  package rows flagged : ${restored.filter(s => s.is_package).length}`);

  const cats = {};
  restored.forEach(s => { cats[s.category || '(none)'] = (cats[s.category || '(none)'] || 0) + 1; });
  console.log('\nRestored category breakdown:');
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  if (!APPLY) {
    console.log('\nDRY RUN - nothing written. Re-run with --apply to commit.');
    return;
  }

  if (misaligned.length) {
    console.error('\nABORT: refusing to write with misaligned rows.');
    process.exit(1);
  }

  const payload = {
    ...mlv.vacant_sales_analysis,
    sales: restored,
    excluded_sales: excluded
  };
  const { error: uErr } = await supabase
    .from('market_land_valuation')
    .update({ vacant_sales_analysis: payload })
    .eq('id', mlv.id);
  if (uErr) throw uErr;
  console.log('\nAPPLIED. market_land_valuation updated.');
}

main().catch(e => { console.error(e); process.exit(1); });

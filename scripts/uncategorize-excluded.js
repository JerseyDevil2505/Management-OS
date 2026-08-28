/**
 * Clears the category on every excluded Method 1 sale in Berkeley.
 *
 * Category analysis only ever reads included sales (checkedSales in
 * LandValuationTab), so this changes no computed rate - it just stops excluded
 * rows from displaying a category they no longer act on. Notes are untouched.
 *
 * Usage: node uncategorize-excluded.js [--apply]
 */
const { createClient } = require('@supabase/supabase-js');

const JOB_ID = 'f8eecbf5-c18e-42fa-80e3-312f41e79952';
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

async function main() {
  const { data: mlv, error } = await supabase
    .from('market_land_valuation')
    .select('id, vacant_sales_analysis')
    .eq('job_id', JOB_ID)
    .single();
  if (error) throw error;

  const sales = mlv.vacant_sales_analysis.sales;
  const before = {};
  sales.forEach(s => {
    const k = `${s.category || '(none)'} / ${s.included ? 'included' : 'excluded'}`;
    before[k] = (before[k] || 0) + 1;
  });

  let changed = 0, notesKept = 0;
  const updated = sales.map(s => {
    if (s.included) return s;
    if (s.notes) notesKept++;
    if ((s.category || '') === 'uncategorized') return s;
    changed++;
    return { ...s, category: 'uncategorized' };
  });

  console.log('Before:');
  Object.entries(before).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  const after = {};
  updated.forEach(s => {
    const k = `${s.category || '(none)'} / ${s.included ? 'included' : 'excluded'}`;
    after[k] = (after[k] || 0) + 1;
  });
  console.log('\nAfter:');
  Object.entries(after).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log(`\ncategories cleared : ${changed}`);
  console.log(`excluded notes kept: ${notesKept}`);
  console.log(`total sales        : ${updated.length}`);
  console.log(`still included     : ${updated.filter(s => s.included).length}`);

  if (!APPLY) {
    console.log('\nDRY RUN - nothing written. Re-run with --apply to commit.');
    return;
  }

  const { error: uErr } = await supabase
    .from('market_land_valuation')
    .update({
      vacant_sales_analysis: { ...mlv.vacant_sales_analysis, sales: updated }
    })
    .eq('id', mlv.id);
  if (uErr) throw uErr;
  console.log('\nAPPLIED.');
}

main().catch(e => { console.error(e); process.exit(1); });

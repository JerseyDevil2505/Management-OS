/**
 * The 430 orphaned Method 1 sales still reference property_records rows that the
 * file update replaced. Relying on the loader to remap them at render time is
 * what keeps losing Pat's work, so this resolves them in the stored data instead.
 *
 * Reports match quality only; --apply rewrites the ids.
 */
const { createClient } = require('@supabase/supabase-js');

const JOB_ID = 'f8eecbf5-c18e-42fa-80e3-312f41e79952';
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

const norm = v => (v || '').trim().toUpperCase().replace(/\s+/g, ' ');

async function main() {
  const { data: mlv, error } = await supabase
    .from('market_land_valuation')
    .select('id, vacant_sales_analysis')
    .eq('job_id', JOB_ID).single();
  if (error) throw error;
  const sales = mlv.vacant_sales_analysis.sales;

  // Full Berkeley parcel set, paged.
  const props = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await supabase
      .from('property_records')
      .select('id, property_block, property_lot, property_qualifier, property_location, property_m4_class')
      .eq('job_id', JOB_ID)
      .range(from, from + 999);
    if (e) throw e;
    props.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`live parcels: ${props.length}`);

  const liveIds = new Set(props.map(p => p.id));

  // block|lot|address  and  block|lot|qualifier|address
  const idx3 = new Map();
  const idx4 = new Map();
  const add = (m, k, id) => {
    if (!m.has(k)) m.set(k, id);
    else if (m.get(k) !== id) m.set(k, null); // ambiguous
  };
  props.forEach(p => {
    add(idx3, `${norm(p.property_block)}|${norm(p.property_lot)}|${norm(p.property_location)}`, p.id);
    add(idx4, `${norm(p.property_block)}|${norm(p.property_lot)}|${norm(p.property_qualifier)}|${norm(p.property_location)}`, p.id);
  });

  let alive = 0, byQual = 0, byAddr = 0, ambiguous = 0, unmatched = 0, nonUuid = 0;
  const misses = [];
  const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || '');

  const updated = sales.map(s => {
    if (liveIds.has(s.id)) { alive++; return s; }
    if (!isUuid(s.id)) { nonUuid++; return s; }

    const k4 = `${norm(s.block)}|${norm(s.lot)}|${norm(s.qualifier)}|${norm(s.address)}`;
    const k3 = `${norm(s.block)}|${norm(s.lot)}|${norm(s.address)}`;

    const m4 = idx4.get(k4);
    if (m4) { byQual++; return { ...s, id: m4, _repointed: true }; }

    const m3 = idx3.get(k3);
    if (m3) { byAddr++; return { ...s, id: m3, _repointed: true }; }

    if (idx3.has(k3) && idx3.get(k3) === null) { ambiguous++; misses.push(`AMBIG ${k3}`); }
    else { unmatched++; misses.push(`MISS  ${k3}`); }
    return s;
  });

  console.log(`\nalready live      : ${alive}`);
  console.log(`repointed (qual)  : ${byQual}`);
  console.log(`repointed (addr)  : ${byAddr}`);
  console.log(`ambiguous         : ${ambiguous}`);
  console.log(`unmatched         : ${unmatched}`);
  console.log(`non-uuid (manual) : ${nonUuid}`);
  console.log(`resolved total    : ${alive + byQual + byAddr} / ${sales.length}`);

  if (misses.length) {
    console.log('\nUnresolved:');
    misses.slice(0, 30).forEach(m => console.log('  ' + m));
    if (misses.length > 30) console.log(`  ... and ${misses.length - 30} more`);
  }

  if (!APPLY) { console.log('\nDRY RUN - nothing written.'); return; }

  const clean = updated.map(({ _repointed, ...s }) => s);
  const { error: uErr } = await supabase
    .from('market_land_valuation')
    .update({ vacant_sales_analysis: { ...mlv.vacant_sales_analysis, sales: clean } })
    .eq('id', mlv.id);
  if (uErr) throw uErr;
  console.log('\nAPPLIED - sale ids repointed.');
}

main().catch(e => { console.error(e); process.exit(1); });

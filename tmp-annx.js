const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
(async () => {
  const job = 'f8eecbf5-c18e-42fa-80e3-312f41e79952';
  let keys = new Set(), from = 0;
  while (true) {
    const { data, error } = await db.from('property_records').select('property_composite_key,property_vcs').eq('job_id', job).eq('property_vcs','ANNX').range(from, from+999);
    if (error) return console.error(error.message);
    data.forEach(r => keys.add(r.property_composite_key)); if (data.length < 1000) break; from += 1000;
  }
  console.log('ANNX parcels (records):', keys.size);
  const { data: mlv, error } = await db.from('market_land_valuation').select('quality_check_results, ignored_issues, quality_check_last_run').eq('job_id', job).single();
  if (error) return console.error(error.message);
  const res = mlv.quality_check_results || {};
  console.log('last run', mlv.quality_check_last_run, 'ignored now', (mlv.ignored_issues||[]).length);
  let total = 0, annx = 0, already = 0; const byCheck = {};
  const ign = new Set(mlv.ignored_issues || []);
  const sample = Object.values(res).flat()[0]; console.log('sample', JSON.stringify(sample).slice(0,300));
  Object.entries(res).forEach(([cat, arr]) => (arr||[]).forEach(r => {
    total++;
    if (keys.has(r.property_key)) { annx++; byCheck[r.check] = (byCheck[r.check]||0)+1; if (ign.has(`${r.property_key}-${r.check}`)) already++; }
  }));
  console.log({ total, annx, already }); console.log(byCheck);
})();

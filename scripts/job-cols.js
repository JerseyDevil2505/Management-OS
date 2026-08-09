// Temporary: inspect job rows to distinguish revaluation jobs from Lojik jobs.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const db = createClient(
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false } }
);

(async () => {
  const { data, error } = await db.from('jobs').select('*');
  if (error) return console.error('ERR', error.message);

  console.log('COLUMNS:\n' + Object.keys(data[0]).join(', ') + '\n');

  const names = ['Jackson', 'Atlantic City', 'Barnegat Light', 'Califon'];
  data
    .filter((j) => names.includes(j.job_name || j.municipality))
    .forEach((j) => {
      console.log('---', j.job_name || j.municipality);
      Object.entries(j).forEach(([k, v]) => {
        if (v === null || v === '' || typeof v === 'object') return;
        if (String(v).length > 60) return;
        console.log('   ', k, '=', v);
      });
    });
})();

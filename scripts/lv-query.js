// Ad-hoc read helper for land valuation analysis. Run: node scripts/lv-query.js <command>
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!key) {
  console.error('SUPABASE_SECRET_KEY is not set');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function jobs() {
  const { data, error } = await db
    .from('jobs')
    .select('id, job_name, municipality, status, start_date, end_date, total_properties')
    .order('job_name');
  if (error) return console.error('ERR', error.message);
  console.log('total jobs:', data.length);
  data.forEach((j) => {
    console.log(
      [
        String(j.status || '').padEnd(10),
        String(j.job_name || j.municipality || '').padEnd(30),
        'end=' + j.end_date,
        'start=' + j.start_date,
        'props=' + j.total_properties
      ].join('  ')
    );
  });
  const byEnd = {};
  data.forEach((j) => {
    byEnd[j.end_date] = (byEnd[j.end_date] || 0) + 1;
  });
  console.log('\nend_date distribution:', byEnd);
}

const commands = { jobs };

const cmd = process.argv[2] || 'jobs';
if (!commands[cmd]) {
  console.error('unknown command:', cmd, '- available:', Object.keys(commands).join(', '));
  process.exit(1);
}
commands[cmd]();

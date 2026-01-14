const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://fzxwrllwgfaainebstbb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6eHdybGx3Z2ZhYWluZWJzdGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU5MjA3ODEsImV4cCI6MjA1MTQ5Njc4MX0.hTpYNjm60LQfqMcHNmXMiFg6sWwGDQUYhJP6bKwcZ2s'
);

async function checkJob() {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, job_name, start_year, created_at, ccdd, county')
    .eq('id', 'be01c481-573a-48f6-a03b-e8552de327bf')
    .single();
    
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Cedar Grove Job Data:');
    console.log(JSON.stringify(data, null, 2));
  }
  
  // Also check a sample property composite key
  const { data: propData, error: propError } = await supabase
    .from('property_records')
    .select('property_composite_key')
    .eq('job_id', 'be01c481-573a-48f6-a03b-e8552de327bf')
    .limit(3);
    
  if (!propError && propData) {
    console.log('\nSample property composite keys:');
    propData.forEach(p => console.log(p.property_composite_key));
  }
}

checkJob().then(() => process.exit(0));

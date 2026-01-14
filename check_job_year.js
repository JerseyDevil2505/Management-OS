const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://zxvavttfvpsagzluqqwn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4dmF2dHRmdnBzYWd6bHVxcXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIzNDA4NjcsImV4cCI6MjA2NzkxNjg2N30.Rrn2pTnImCpBIoKPcdlzzZ9hMwnYtIO5s7i1ejwQReg'
);

async function checkJob() {
  // Get all columns
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .ilike('job_name', '%cedar grove%')
    .single();
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Cedar Grove Job - Available Fields:');
  console.log('ID:', data.id);
  console.log('Job Name:', data.job_name);
  console.log('County:', data.county);
  console.log('CCDD:', data.ccdd);
  console.log('Created At:', data.created_at);
  console.log('All field names:', Object.keys(data).filter(k => !k.includes('config') && !k.includes('vcs')));
  
  // Check for year-related fields
  const yearFields = Object.keys(data).filter(k => 
    k.toLowerCase().includes('year') || 
    k.toLowerCase().includes('date') ||
    k === 'created_at'
  );
  console.log('\nYear-related fields:');
  yearFields.forEach(f => {
    console.log(`  ${f}: ${data[f]}`);
  });
  
  // Check composite keys
  const { data: propData, error: propError } = await supabase
    .from('property_records')
    .select('property_composite_key')
    .eq('job_id', data.id)
    .limit(5);
    
  if (!propError && propData) {
    console.log('\nSample property composite keys:');
    propData.forEach(p => console.log('  ' + p.property_composite_key));
  }
}

checkJob().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

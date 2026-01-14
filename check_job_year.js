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
  } else {
    console.log('Cedar Grove Job Data:');
    console.log(JSON.stringify(data, null, 2));
  }
  
  // Also check a sample property composite key
  if (data && data.id) {
    const { data: propData, error: propError } = await supabase
      .from('property_records')
      .select('property_composite_key')
      .eq('job_id', data.id)
      .limit(3);
      
    if (!propError && propData) {
      console.log('\nSample property composite keys:');
      propData.forEach(p => console.log(p.property_composite_key));
    }
  }
}

checkJob().then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

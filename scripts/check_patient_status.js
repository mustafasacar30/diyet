const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatus() {
  const { data, error } = await supabase
    .from('patients')
    .select('id, full_name, status');
    
  if (error) {
    console.error('Error fetching patients:', error);
  } else {
    console.log(`Found ${data.length} patients.`);
    const pending = data.filter(p => p.status === 'pending');
    const active = data.filter(p => p.status === 'active');
    const nullStatus = data.filter(p => !p.status);
    console.log(`Pending: ${pending.length}, Active: ${active.length}, Null: ${nullStatus.length}`);
    
    if (pending.length > 0) {
      console.log('Sample pending patients:', pending.slice(0, 3));
    }
  }
}
checkStatus();

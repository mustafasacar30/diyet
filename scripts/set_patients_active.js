const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function setAllActive() {
  const { data, error } = await supabase
    .from('patients')
    .update({ status: 'active' })
    .neq('status', 'active');
    
  if (error) {
    console.error('Error updating patients:', error);
  } else {
    console.log('Successfully updated pending patients to active.');
  }
}
setAllActive();

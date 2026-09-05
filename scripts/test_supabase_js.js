const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  console.log('Connecting to Supabase REST API:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  const { data, error } = await supabase.from('profiles').select('*').limit(1);
  if (error) {
    console.error('REST API connection failed:', error);
  } else {
    console.log('REST API connection successful! Profiles found:', data);
  }
}
test();

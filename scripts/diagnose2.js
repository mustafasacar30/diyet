const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // 1. ALL program_templates (including inactive)
  const { data: allPt } = await supabase.from('program_templates').select('id, name, is_active').order('name');
  console.log('=== ALL program_templates ===');
  console.table(allPt);

  // 2. diet_weeks structure - check columns
  const { data: dw, error: dwErr } = await supabase.from('diet_weeks').select('*').limit(3);
  console.log('\n=== diet_weeks sample ===');
  if (dwErr) console.log('ERROR:', dwErr.message);
  else {
    if (dw && dw.length > 0) console.log('Columns:', Object.keys(dw[0]));
    console.table(dw);
  }

  // 3. Find weeks for patient "1 dene" (7547ee95...) - maybe through a different column
  const patientId = '7547ee95-91de-4d01-a63f-691a548b320c';
  
  // Try via user_id
  const { data: dwUser, error: dwUserErr } = await supabase.from('diet_weeks').select('*').eq('user_id', patientId).limit(5);
  console.log('\n=== diet_weeks via user_id ===');
  if (dwUserErr) console.log('ERROR:', dwUserErr.message);
  else console.table(dwUser);

  // 4. Check duplicate patients detail
  const dupeIds = [
    'ee53de79-3804-4128-9a93-ddb1c4f5eb54', '2c193cd9-a142-4469-a8bf-a7e2ef4ce9a4',
    '7088f03c-c565-42db-b885-ea69f670419b', 'd0cbf077-21e8-4551-802b-ed9c1c28fc86'
  ];
  const { data: dupes } = await supabase.from('patients').select('id, full_name, email, created_at, status, user_id').in('id', dupeIds);
  console.log('\n=== Duplicate patients detail ===');
  console.table(dupes);
}
check();

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testInsert() {
  const { data: plan, error: planErr } = await supabase.from('diet_plans').select('id, patient_id').limit(1).single();
  if (planErr) return console.log(planErr);

  const { data: dietType, error: dtErr } = await supabase.from('diet_types').select('id').limit(1).single();

  console.log('Trying to insert for plan:', plan.id);
  const weekData = {
    diet_plan_id: plan.id,
    week_number: 1,
    title: 'Hafta 1',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0],
    meal_types: ['Kahvaltı', 'Öğle', 'Akşam'],
    slot_configs: {},
    weight_log: null,
    assigned_diet_type_id: dietType.id,
    activity_level_log: 'Masa başı (Hareketsiz)'
  };
  
  const { error } = await supabase.from('diet_weeks').insert([weekData]);
  if (error) {
    console.error('Insert failed:', error);
  } else {
    console.log('Insert succeeded');
  }
}

testInsert();

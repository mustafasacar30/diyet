const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkDietWeeksColumns() {
  const { data, error } = await supabase.from('diet_weeks').select('*').limit(1);
  if (error) {
    console.error('Error fetching diet_weeks:', error);
  } else {
    if (data.length > 0) {
      console.log('Columns in diet_weeks:', Object.keys(data[0]));
    } else {
      console.log('No rows in diet_weeks. Trying to insert an empty object to see the schema error, or fetching via RPC if we had one.');
      // Actually we can just do a select with a non-existent column to see if it errors
      const testCols = ['week_number', 'title', 'start_date', 'end_date', 'meal_types', 'slot_configs', 'weight_log', 'assigned_diet_type_id', 'activity_level_log', 'created_at', 'updated_at', 'meal_slots'];
      for (const col of testCols) {
        const { error: colErr } = await supabase.from('diet_weeks').select(col).limit(1);
        if (colErr) console.log(`Missing column: ${col} -> ${colErr.message}`);
        else console.log(`Column exists: ${col}`);
      }
    }
  }
}

checkDietWeeksColumns();

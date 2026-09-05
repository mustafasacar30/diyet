const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCols(table, testCols) {
  const { data, error } = await supabase.from(table).select('*').limit(1);
  if (error) {
    console.error(`Error fetching ${table}:`, error);
  } else {
    if (data.length > 0) {
      console.log(`Columns in ${table}:`, Object.keys(data[0]));
    } else {
      console.log(`No rows in ${table}.`);
    }
    for (const col of testCols) {
      const { error: colErr } = await supabase.from(table).select(col).limit(1);
      if (colErr) console.log(`[MISSING in ${table}]: ${col} -> ${colErr.message}`);
      else console.log(`[EXISTS in ${table}]: ${col}`);
    }
  }
}

async function run() {
  await checkCols('diet_days', ['diet_week_id', 'day_number', 'notes', 'is_active', 'id', 'created_at']);
  await checkCols('diet_meals', ['id', 'meal_time', 'portion_multiplier', 'custom_notes', 'sort_order', 'is_locked', 'food_id', 'custom_name', 'calories', 'protein', 'carbs', 'fat', 'is_custom', 'created_at', 'original_food_id', 'swapped_by', 'is_consumed']);
  await checkCols('diet_notes', ['id', 'content', 'is_locked', 'sort_order', 'original_note_id']);
}

run();

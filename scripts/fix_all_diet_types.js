const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixAllDietTypes() {
  const { data: types, error } = await supabase.from('diet_types').select('*');
  if (error) return console.error('Error fetching:', error);

  // Group by name
  const grouped = {};
  for (const t of types) {
    if (!grouped[t.name]) grouped[t.name] = [];
    grouped[t.name].push(t);
  }

  for (const name in grouped) {
    const items = grouped[name];
    if (items.length > 1) {
      console.log(`Duplicate found for ${name} (${items.length} items)`);
      // Sort by created_at (ascending, oldest first)
      items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      
      // Keep the oldest one (index 0), delete the rest
      const toDelete = items.slice(1);
      for (const t of toDelete) {
        console.log(`Deleting duplicate ${t.name} created at ${t.created_at} with id ${t.id}`);
        const { error: delErr } = await supabase.from('diet_types').delete().eq('id', t.id);
        if (delErr) {
          console.error(`Failed to delete ${t.id}:`, delErr);
        } else {
          console.log(`Deleted successfully.`);
        }
      }
    }
  }
}

fixAllDietTypes();

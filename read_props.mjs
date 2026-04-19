import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data } = await supabase.from('food_proposals').select('id, suggested_name, ingredients').order('created_at', { ascending: false }).limit(2);
  console.log(JSON.stringify(data, null, 2));
}
run();

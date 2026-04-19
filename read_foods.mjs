import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: foods } = await supabase.from('foods').select('id, name, ingredients, meta').order('created_at', { ascending: false }).limit(2);
  const { data: props } = await supabase.from('food_proposals').select('id, suggested_name, ingredients').order('created_at', { ascending: false }).limit(2);
  
  fs.writeFileSync('foods_out.json', JSON.stringify({foods, props}, null, 2));
}
run();

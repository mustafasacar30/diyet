import { supabaseAdmin } from './src/lib/supabase-admin';
async function run() {
    const { data } = await supabaseAdmin.from('foods').select('id, name, meta').order('created_at', { ascending: false }).limit(5);
    console.log(JSON.stringify(data, null, 2));
}
run();

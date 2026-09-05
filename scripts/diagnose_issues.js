const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // 1. Check if program_templates table exists
  const { data: pt, error: ptErr } = await supabase.from('program_templates').select('id, name').limit(5);
  console.log('=== program_templates ===');
  if (ptErr) console.log('  ERROR:', ptErr.message);
  else console.log('  Data:', pt);

  // 2. Check if program_template_weeks table exists
  const { data: ptw, error: ptwErr } = await supabase.from('program_template_weeks').select('*').limit(5);
  console.log('\n=== program_template_weeks ===');
  if (ptwErr) console.log('  ERROR:', ptwErr.message);
  else console.log('  Data:', ptw);

  // 3. Check patients table for duplicate-related columns
  const { data: patients, error: pErr } = await supabase
    .from('patients')
    .select('id, full_name, status, program_template_id')
    .order('full_name')
    .limit(50);
  console.log('\n=== patients (first 50) ===');
  if (pErr) console.log('  ERROR:', pErr.message);
  else {
    // Check for name duplicates
    const names = patients.map(p => p.full_name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      console.log('  DUPLICATE NAMES FOUND:', [...new Set(dupes)]);
      dupes.forEach(d => {
        const matches = patients.filter(p => p.full_name === d);
        console.log(`    "${d}":`, matches.map(m => ({ id: m.id, status: m.status })));
      });
    } else {
      console.log('  No duplicate names found.');
    }
    console.log('  Total:', patients.length);
  }

  // 4. Check Hafta Ayarları -> diet_weeks and diet_type linkage
  const { data: weeks, error: wErr } = await supabase
    .from('diet_weeks')
    .select('id, patient_id, week_number, diet_type_id, name')
    .eq('patient_id', '7547ee95-91de-4d01-a63f-691a548b320c')
    .order('week_number');
  console.log('\n=== diet_weeks for "1 dene" patient ===');
  if (wErr) console.log('  ERROR:', wErr.message);
  else console.table(weeks);
}
check();

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Credentials missing in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const JSON_FILE = path.join(__dirname, '../___supabase_yedekler/diyet_yedek_2026-05-21.json');

async function main() {
  if (!fs.existsSync(JSON_FILE)) {
    console.error('Backup file not found at:', JSON_FILE);
    return;
  }

  console.log('Reading JSON backup...');
  const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  const patients = rawData.patients || [];
  console.log(`Found ${patients.length} patients in backup.`);

  let updatedCount = 0;
  let errorCount = 0;

  for (const p of patients) {
    console.log(`Restoring fields for patient: ${p.full_name} (${p.id})...`);
    const { error } = await supabase
      .from('patients')
      .update({
        updated_at: p.updated_at || null,
        dismissed_global_rule_ids: p.dismissed_global_rule_ids || [],
        patient_goals: p.patient_goals || [],
        phone: p.phone || null,
        can_self_plan: p.can_self_plan ?? false
      })
      .eq('id', p.id);

    if (error) {
      console.error(`  ❌ Error updating patient ${p.full_name}:`, error.message);
      errorCount++;
    } else {
      console.log(`  ✅ Successfully updated patient ${p.full_name}`);
      updatedCount++;
    }
  }

  console.log('\n=======================================');
  console.log(`🎉 Restore completed!`);
  console.log(`Successful updates: ${updatedCount}`);
  console.log(`Failed updates: ${errorCount}`);
  console.log('=======================================');
}

main();

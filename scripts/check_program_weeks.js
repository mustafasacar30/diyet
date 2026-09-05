const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // 1. All program_templates with their weeks
  const { data: templates } = await supabase
    .from('program_templates')
    .select('id, name, is_active, program_template_weeks(id, week_start, week_end, diet_type_id, rule_set_id)')
    .order('name');
  
  console.log('=== Program Templates with Weeks ===');
  for (const t of templates) {
    console.log(`\n📋 ${t.name} (${t.id}) [active: ${t.is_active}]`);
    if (t.program_template_weeks && t.program_template_weeks.length > 0) {
      for (const w of t.program_template_weeks) {
        console.log(`   Hafta ${w.week_start}-${w.week_end} → diet_type_id: ${w.diet_type_id || '❌ NULL'} | rule_set_id: ${w.rule_set_id || 'null'}`);
      }
    } else {
      console.log('   ❌ No weeks defined');
    }
  }

  // 2. All diet_types for reference
  const { data: dietTypes } = await supabase.from('diet_types').select('id, name, abbreviation').order('name');
  console.log('\n=== Available Diet Types ===');
  console.table(dietTypes);

  // 3. Check backup data for program_template_weeks diet_type_id
  const fs = require('fs');
  const backupPath = require('path').join(__dirname, '../supabase_backup_full.json');
  if (fs.existsSync(backupPath)) {
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
    if (backup.program_template_weeks) {
      console.log('\n=== Backup: program_template_weeks ===');
      backup.program_template_weeks.forEach(w => {
        console.log(`   id: ${w.id} | template: ${w.program_template_id} | weeks ${w.week_start}-${w.week_end} → diet_type_id: ${w.diet_type_id || '❌ NULL'}`);
      });
    }
    if (backup.program_templates) {
      console.log('\n=== Backup: program_templates ===');
      backup.program_templates.forEach(t => {
        console.log(`   id: ${t.id} | name: ${t.name}`);
      });
    }
  } else {
    console.log('\n⚠️ No backup file found at', backupPath);
  }
}
check();

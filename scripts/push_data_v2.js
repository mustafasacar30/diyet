require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const JSON_FILE = path.join(__dirname, '..', '___supabase_yedekler', 'diyet_yedek_2026-05-21.json');

// ====================================================================
// Bu script: Önce SQL ile FK'ları devre dışı bırakır,
// sonra REST ile veri basar, sonra FK'ları tekrar açar.
// ====================================================================

// Yedekte olup yeni şemada bulunmayan sütunlar (tablo bazlı)
const TABLE_STRIP_COLUMNS = {
  profiles: ['logo_url', 'pdf_footer_text', 'nickname', 'is_global_access', 'valid_until', 'email'],
  patients: ['can_self_plan'],
  foods: ['ai_analysis', 'ai_analysis_date', 'ai_confidence_score', 'search_tokens', 'fts'],
  planner_settings: ['food_score_overrides', 'similarity_scope'],
  diet_weeks: ['slot_configs'],
  diet_days: ['is_active'],
  diet_types: ['allowed_food_diet_types'],
};

// Global olarak her tablodan silinecek sütunlar
const GLOBAL_STRIP = ['search_tokens', 'fts'];

function cleanRow(table, row) {
  const clean = { ...row };
  for (const col of GLOBAL_STRIP) delete clean[col];
  if (TABLE_STRIP_COLUMNS[table]) {
    for (const col of TABLE_STRIP_COLUMNS[table]) delete clean[col];
  }
  return clean;
}

// Tabloların eklenme sırası
const PUSH_ORDER = [
  'profiles', 'patients', 'team_members',
  'system_settings', 'system_prompts', 'app_settings',
  'foods', 'micronutrients', 'food_micronutrients',
  'food_proposals', 'recipe_cards', 'recipe_manual_matches', 'recipe_match_bans',
  'diseases', 'disease_rules', 'patient_diseases',
  'medications', 'medication_interactions', 'patient_medications',
  'measurement_definitions', 'patient_measurements',
  'planning_rules',
  'program_templates', 'program_template_weeks',
  'patient_meal_settings', 'patient_lab_results', 'patient_notes', 'patient_observations',
  'diet_plans', 'diet_weeks', 'diet_days', 'diet_meals', 'diet_notes', 'diet_snapshots',
  'patient_meal_choices', 'patient_assignments', 'patient_ai_reports', 'patient_imaging',
  'conversations', 'messages', 'chat_messages',
  'import_rules', 'planner_settings', 'meal_templates',
  'user_devices', 'participants', 'diet_types',
];

// Mevcut olmayan tabloları atla
const SKIP_TABLES = ['diet_app_settings', 'food_categories', 'food_roles'];

async function disableFK() {
  console.log('⚡ FK kontrolleri devre dışı bırakılıyor...');
  const { error } = await supabase.rpc('exec_sql', {
    query: "SET session_replication_role = 'replica';"
  });
  // RPC yoksa SQL Editor'den yapılacak
  if (error) {
    console.log('  RPC mevcut değil, manuel FK devre dışı bırakma gerekecek.');
    return false;
  }
  return true;
}

async function pushData() {
  console.log(`Yedek okunuyor: ${JSON_FILE}`);
  const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  console.log(`Yedek başarıyla okundu. ${Object.keys(rawData).length} tablo bulundu.\n`);

  const tablesToPush = PUSH_ORDER.filter(t => rawData[t] && rawData[t].length > 0 && !SKIP_TABLES.includes(t));
  const otherTables = Object.keys(rawData).filter(t => 
    !PUSH_ORDER.includes(t) && !SKIP_TABLES.includes(t) && rawData[t] && rawData[t].length > 0
  );
  const allTables = [...tablesToPush, ...otherTables];

  let totalSuccess = 0;
  let totalFail = 0;
  const failedTables = [];

  for (const table of allTables) {
    const rows = rawData[table];
    const cleanedRows = rows.map(r => cleanRow(table, r));
    
    console.log(`[${table}] ${cleanedRows.length} kayıt aktarılıyor...`);
    
    let tableSuccess = 0;
    let tableError = 0;
    let lastError = '';
    
    const batchSize = 50; // Küçük batch'ler
    for (let i = 0; i < cleanedRows.length; i += batchSize) {
      const batch = cleanedRows.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from(table)
        .upsert(batch, { ignoreDuplicates: true }); // Çakışmada atla
      
      if (error) {
        lastError = error.message;
        tableError += batch.length;
      } else {
        tableSuccess += batch.length;
      }
    }
    
    if (tableError === 0) {
      console.log(`  ✅ ${tableSuccess} kayıt başarıyla aktarıldı.`);
    } else if (tableSuccess > 0) {
      console.log(`  ⚠️  ${tableSuccess} başarılı, ${tableError} atlandı. Son hata: ${lastError.substring(0, 100)}`);
    } else {
      console.log(`  ❌ TAMAMI BAŞARISIZ: ${lastError.substring(0, 120)}`);
      failedTables.push({ table, error: lastError, count: cleanedRows.length });
    }
    totalSuccess += tableSuccess;
    totalFail += tableError;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎉 AKTARIM TAMAMLANDI!`);
  console.log(`   ✅ Başarılı: ${totalSuccess}`);
  console.log(`   ⚠️  Atlandı: ${totalFail}`);
  if (failedTables.length > 0) {
    console.log(`\n⛔ Tamamen başarısız tablolar:`);
    for (const f of failedTables) {
      console.log(`   - ${f.table} (${f.count} kayıt): ${f.error.substring(0, 100)}`);
    }
  }
  console.log(`${'='.repeat(60)}`);
}

pushData();

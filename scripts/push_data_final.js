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

// Tabloların eklenme sırası (FK bağımlılıkları dikkate alınmış)
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

// Sütun cache'i
const columnCache = {};

async function getTableColumns(table) {
  if (columnCache[table]) return columnCache[table];
  
  const { data, error } = await supabase.rpc('get_table_columns', { p_table: table });
  
  if (error || !data) {
    console.log(`  ⚠️  [${table}] sütunları alınamadı: ${error?.message || 'boş sonuç'}`);
    return null;
  }
  
  columnCache[table] = data;
  return data;
}

function cleanRow(validColumns, row) {
  const clean = {};
  for (const col of validColumns) {
    if (row.hasOwnProperty(col)) {
      clean[col] = row[col];
    }
  }
  return clean;
}

async function pushData() {
  console.log(`Yedek okunuyor: ${JSON_FILE}`);
  const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  console.log(`Yedek başarıyla okundu. ${Object.keys(rawData).length} tablo bulundu.\n`);

  const tablesToPush = PUSH_ORDER.filter(t => rawData[t] && rawData[t].length > 0);
  const otherTables = Object.keys(rawData).filter(t => 
    !PUSH_ORDER.includes(t) && rawData[t] && rawData[t].length > 0
  );
  const allTables = [...tablesToPush, ...otherTables];

  let totalSuccess = 0;
  let totalFail = 0;
  const failedTables = [];

  for (const table of allTables) {
    const rows = rawData[table];
    
    // Veritabanından bu tablonun gerçek sütunlarını öğren
    const validColumns = await getTableColumns(table);
    
    if (!validColumns) {
      console.log(`[${table}] ⏭️  Tablo veritabanında bulunamadı, atlanıyor.`);
      continue;
    }
    
    // Yedekteki fazlalık sütunları otomatik olarak temizle
    const dataColumns = Object.keys(rows[0]);
    const strippedCols = dataColumns.filter(c => !validColumns.includes(c));
    
    const cleanedRows = rows.map(r => cleanRow(validColumns, r));
    
    console.log(`[${table}] ${cleanedRows.length} kayıt aktarılıyor...`);
    if (strippedCols.length > 0) {
      console.log(`  🧹 Temizlenen sütunlar: ${strippedCols.join(', ')}`);
    }
    
    let tableSuccess = 0;
    let tableError = 0;
    let lastError = '';
    
    const batchSize = 50;
    for (let i = 0; i < cleanedRows.length; i += batchSize) {
      const batch = cleanedRows.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from(table)
        .upsert(batch, { ignoreDuplicates: true });
      
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
      console.log(`  ⚠️  ${tableSuccess} başarılı, ${tableError} atlandı. Hata: ${lastError.substring(0, 100)}`);
    } else {
      console.log(`  ❌ BAŞARISIZ: ${lastError.substring(0, 120)}`);
      failedTables.push({ table, error: lastError, count: cleanedRows.length });
    }
    totalSuccess += tableSuccess;
    totalFail += tableError;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎉 AKTARIM TAMAMLANDI!`);
  console.log(`   ✅ Başarılı: ${totalSuccess}`);
  console.log(`   ⚠️  Atlandı/Hatalı: ${totalFail}`);
  if (failedTables.length > 0) {
    console.log(`\n⛔ Başarısız tablolar:`);
    for (const f of failedTables) {
      console.log(`   - ${f.table} (${f.count} kayıt): ${f.error.substring(0, 120)}`);
    }
  }
  console.log(`${'='.repeat(60)}`);
}

pushData();

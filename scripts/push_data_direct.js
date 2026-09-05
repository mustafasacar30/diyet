const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Yeni Supabase DB bağlantısı
const DATABASE_URL = 'postgresql://postgres.lpabhijqrccssooozuoe:Dr_mistik2020@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const JSON_FILE = path.join(__dirname, '..', '___supabase_yedekler', 'diyet_yedek_2026-05-21.json');

// Tabloların eklenme sırası (FK bağımlılıkları dikkate alınmış)
const PUSH_ORDER = [
  'profiles', 'patients', 'team_members',
  'system_settings', 'system_prompts', 'app_settings',
  'food_categories', 'food_roles', 'foods', 'micronutrients', 'food_micronutrients',
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
  'user_devices', 'participants', 'diet_types', 'diet_app_settings',
];

// Yedekte olup yeni şemada olmayan sütunlar (tablo bazlı veya global)
const GLOBAL_STRIP_COLUMNS = [
  'search_tokens', 'fts',
];

const TABLE_STRIP_COLUMNS = {
  profiles: ['logo_url', 'pdf_footer_text', 'nickname', 'is_global_access', 'valid_until', 'email'],
  patients: ['can_self_plan'],
  foods: ['ai_analysis', 'ai_analysis_date', 'ai_confidence_score'],
  planner_settings: ['food_score_overrides', 'similarity_scope'],
  diet_weeks: ['slot_configs'],
  diet_days: ['is_active'],
  diet_types: ['allowed_food_diet_types'],
};

function cleanRow(table, row) {
  const clean = { ...row };
  // Global sütunları sil
  for (const col of GLOBAL_STRIP_COLUMNS) {
    delete clean[col];
  }
  // Tabloya özel sütunları sil
  if (TABLE_STRIP_COLUMNS[table]) {
    for (const col of TABLE_STRIP_COLUMNS[table]) {
      delete clean[col];
    }
  }
  return clean;
}

async function pushData() {
  console.log(`Yedek okunuyor: ${JSON_FILE}`);
  const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  console.log('Yedek başarıyla okundu.\n');

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('PostgreSQL bağlantısı kuruldu.\n');

  // FK kontrollerini devre dışı bırak
  await client.query("SET session_replication_role = 'replica';");
  console.log('⚡ FK kontrolleri GEÇİCİ OLARAK devre dışı bırakıldı.\n');

  // JSON'daki tabloları sıralı + ekstra olarak birleştir
  const tablesToPush = PUSH_ORDER.filter(t => rawData[t] && rawData[t].length > 0);
  const otherTables = Object.keys(rawData).filter(t => !PUSH_ORDER.includes(t) && rawData[t] && rawData[t].length > 0);
  const allTables = [...tablesToPush, ...otherTables];

  let totalSuccess = 0;
  let totalFail = 0;

  for (const table of allTables) {
    const rows = rawData[table];
    const cleanedRows = rows.map(r => cleanRow(table, r));
    
    if (cleanedRows.length === 0) continue;
    
    // İlk satırdan sütun isimlerini al
    const columns = Object.keys(cleanedRows[0]);
    
    console.log(`[${table}] ${cleanedRows.length} kayıt aktarılıyor...`);
    
    let tableSuccess = 0;
    let tableError = 0;
    
    // Tek tek INSERT ON CONFLICT DO UPDATE (upsert)
    for (let i = 0; i < cleanedRows.length; i++) {
      const row = cleanedRows[i];
      const cols = Object.keys(row);
      const vals = cols.map((_, idx) => `$${idx + 1}`);
      const updateSet = cols.filter(c => c !== 'id').map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');
      
      const sql = `INSERT INTO public."${table}" (${cols.map(c => `"${c}"`).join(', ')})
        VALUES (${vals.join(', ')})
        ON CONFLICT (id) DO UPDATE SET ${updateSet || '"id" = EXCLUDED."id"'}`;
      
      try {
        await client.query(sql, cols.map(c => row[c]));
        tableSuccess++;
      } catch (err) {
        if (tableError < 3) {
          console.error(`  ❌ Satır ${i}: ${err.message.substring(0, 120)}`);
        }
        tableError++;
      }
    }
    
    if (tableError === 0) {
      console.log(`  ✅ ${tableSuccess}/${cleanedRows.length} kayıt başarıyla aktarıldı.`);
    } else {
      console.log(`  ⚠️  ${tableSuccess} başarılı, ${tableError} hatalı (toplam ${cleanedRows.length})`);
    }
    totalSuccess += tableSuccess;
    totalFail += tableError;
  }

  // FK kontrollerini tekrar aç
  await client.query("SET session_replication_role = 'origin';");
  console.log('\n🔒 FK kontrolleri tekrar etkinleştirildi.');
  
  await client.end();
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🎉 AKTARIM TAMAMLANDI!`);
  console.log(`   Başarılı: ${totalSuccess}`);
  console.log(`   Hatalı:   ${totalFail}`);
  console.log(`${'='.repeat(50)}`);
}

pushData().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});

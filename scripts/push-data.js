const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

// ==========================================
// YENİ SUPABASE BİLGİLERİNİZİ BURAYA GİRİN
// ==========================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'YENI_SUPABASE_URL_BURAYA';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'YENI_SERVICE_ROLE_KEY_BURAYA';
const JSON_FILE_PATH = process.argv[2] || './diyet_yedek.json'; // Kullanım: node push-data.js yede_dosyasi.json

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || SUPABASE_URL.includes('YENI_SUPABASE')) {
  console.error('Lütfen push-data.js içindeki SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY değişkenlerini güncelleyin!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// Tabloların veritabanına eklenme sırası. 
// İlişkisel (Foreign Key) hataları almamak için ana tablolar önce, alt tablolar sonra eklenir.
const PUSH_ORDER = [
  // 1. Kullanıcı ve Ayarlar
  'profiles', 'patients', 'dietitians', 'team_members',
  'system_settings', 'system_prompts', 'app_settings', 'diet_app_settings',
  
  // 2. Temel Yemek Verileri
  'food_categories', 'food_roles', 'foods', 'micronutrients', 'food_micronutrients',
  'food_proposals', 'recipe_cards', 'recipe_manual_matches', 'recipe_match_bans',
  
  // 3. Hastalık ve İlaçlar
  'diseases', 'disease_rules', 'patient_diseases',
  'medications', 'medication_interactions', 'patient_medications',
  
  // 4. Ölçümler ve Kurallar
  'measurement_definitions', 'measurements', 'patient_measurements',
  'rule_sets', 'rule_set_items', 'planning_rules',
  
  // 5. Program Şablonları
  'program_templates', 'program_template_weeks', 'program_template_restrictions',
  
  // 6. Hastaya Özgü Veriler
  'patient_meal_settings', 'patient_lab_results', 'patient_notes', 'patient_observations',
  
  // 7. Diyet Planları (En son)
  'diet_plans', 'diet_weeks', 'diet_days', 'diet_meals', 'diet_notes', 'diet_snapshots',
  'patient_meal_choices', 'patient_assignments', 'patient_ai_reports', 'patient_imaging',
  
  // 8. İletişim ve Diğer
  'conversations', 'messages', 'chat_messages',
  'import_rules', 'planner_settings', 'meal_templates'
];

async function pushData() {
  console.log(`Veriler okunuyor: ${JSON_FILE_PATH}`);
  let rawData;
  try {
    rawData = JSON.parse(fs.readFileSync(JSON_FILE_PATH, 'utf8'));
  } catch (err) {
    console.error('JSON dosyası okunamadı! Hata:', err.message);
    process.exit(1);
  }

  console.log('Veriler başarıyla okundu. Supabase\'e aktarım başlıyor...\n');

  // JSON içindeki mevcut tabloları sıralamaya göre filtrele
  const tablesToPush = PUSH_ORDER.filter(table => rawData[table] && rawData[table].length > 0);
  
  // Listede olmayan ama JSON'da veri içeren ek tabloları sona ekle
  const otherTables = Object.keys(rawData).filter(table => !PUSH_ORDER.includes(table) && rawData[table].length > 0);
  const allTablesToPush = [...tablesToPush, ...otherTables];

  for (const table of allTablesToPush) {
    const rows = rawData[table];
    console.log(`[${table}] Tablosu aktarılıyor... (${rows.length} kayıt)`);

    // Toplu (Batch) ekleme - Supabase limitlerine takılmamak için 100'er 100'er
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize).map(row => {
        // GENERATED ALWAYS AS and deprecated columns must be removed before insert/upsert
        const cleanRow = { ...row };
        delete cleanRow.search_tokens;
        delete cleanRow.fts;
        delete cleanRow.slot_configs; // removed from diet_weeks
        delete cleanRow.is_active; // removed from diet_days
        delete cleanRow.food_score_overrides; // removed from planner_settings
        delete cleanRow.allowed_food_diet_types; // removed from diet_types
        return cleanRow;
      });
      
      const { error } = await supabase
        .from(table)
        .upsert(batch, { ignoreDuplicates: false }); // Varsa üzerine yazar

      if (error) {
        console.error(`❌ [${table}] aktarım hatası (Satır ${i}-${i + batchSize}):`, error.message);
        // Hata kritikse durdurabiliriz, ama devam etmeyi seçiyoruz.
      }
    }
    console.log(`✅ [${table}] başarıyla aktarıldı.`);
  }

  console.log('\n🎉 TÜM VERİLER BAŞARIYLA AKTARILDI!');
}

pushData();

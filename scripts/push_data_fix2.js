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

const columnCache = {};
async function getTableColumns(table) {
  if (columnCache[table]) return columnCache[table];
  const { data } = await supabase.rpc('get_table_columns', { p_table: table });
  if (data) columnCache[table] = data;
  return data;
}

function cleanRow(validColumns, row) {
  const clean = {};
  for (const col of validColumns) {
    if (row.hasOwnProperty(col)) clean[col] = row[col];
  }
  return clean;
}

async function deleteTable(table) {
  const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) {
    console.log(`  ⚠️  Delete ${table}: ${error.message.substring(0, 80)}`);
    return false;
  }
  console.log(`  🗑️  ${table} temizlendi.`);
  return true;
}

async function insertTable(table, rows) {
  const validColumns = await getTableColumns(table);
  if (!validColumns) { console.log(`  ⏭️  ${table} bulunamadı`); return 0; }
  
  const cleanedRows = rows.map(r => cleanRow(validColumns, r));
  let success = 0;
  const batchSize = 50;
  
  for (let i = 0; i < cleanedRows.length; i += batchSize) {
    const batch = cleanedRows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { ignoreDuplicates: true });
    if (error) {
      console.log(`  ❌ Batch ${i}: ${error.message.substring(0, 100)}`);
    } else {
      success += batch.length;
    }
  }
  return success;
}

async function main() {
  const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  console.log('Yedek okundu. Son düzeltmeler yapılıyor...\n');

  // ============================================================
  // 1. Medications zinciri: Sil → Yeniden ekle
  // ============================================================
  console.log('=== MEDICATIONS ZİNCİRİ ===');
  
  console.log('[1/6] Bağımlı tablolar siliniyor...');
  await deleteTable('patient_medications');
  await deleteTable('medication_interactions');
  
  console.log('[2/6] Medications siliniyor...');
  await deleteTable('medications');
  
  console.log('[3/6] Medications yeniden ekleniyor...');
  let n = await insertTable('medications', rawData.medications || []);
  console.log(`  ✅ ${n} medications eklendi.`);
  
  console.log('[4/6] Medication interactions ekleniyor...');
  n = await insertTable('medication_interactions', rawData.medication_interactions || []);
  console.log(`  ✅ ${n} medication_interactions eklendi.`);
  
  console.log('[5/6] Patient medications ekleniyor...');
  n = await insertTable('patient_medications', rawData.patient_medications || []);
  console.log(`  ✅ ${n} patient_medications eklendi.`);

  // ============================================================
  // 2. Patient lab results: micronutrient_id düzeltmesi
  // ============================================================
  console.log('\n=== PATIENT LAB RESULTS ===');
  
  console.log('[1/2] Mevcut lab results siliniyor...');
  await deleteTable('patient_lab_results');
  
  console.log('[2/2] Patient lab results yeniden ekleniyor...');
  n = await insertTable('patient_lab_results', rawData.patient_lab_results || []);
  console.log(`  ✅ ${n} patient_lab_results eklendi.`);

  // ============================================================
  // 3. Diet meals: diet_day_id referansları
  // ============================================================
  console.log('\n=== DIET MEALS ===');
  
  console.log('[1/2] Mevcut diet meals siliniyor...');
  await deleteTable('diet_meals');
  
  console.log('[2/2] Diet meals yeniden ekleniyor...');
  n = await insertTable('diet_meals', rawData.diet_meals || []);
  console.log(`  ✅ ${n} diet_meals eklendi.`);

  console.log('\n' + '='.repeat(60));
  console.log('🎉 SON DÜZELTMELER TAMAMLANDI!');
  console.log('='.repeat(60));
}

main();

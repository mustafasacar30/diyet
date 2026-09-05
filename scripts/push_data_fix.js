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

// Tablolara özel conflict sütunları (id yerine)
const CONFLICT_COLUMNS = {
  system_settings: 'key',
  system_prompts: 'key',
  micronutrients: 'name',
  medications: 'name',
};

// Nullable FK sütunları - referans bulunamazsa NULL yapılacak
const NULLABLE_FK_COLUMNS = {
  diet_weeks: ['assigned_diet_type_id'],
  planning_rules: ['source_rule_id'],
  patient_lab_results: ['micronutrient_id'],
  program_template_weeks: ['diet_type_id'],
};

// Sadece başarısız olan tabloları tekrar dene (sıralı)
const RETRY_ORDER = [
  'system_settings', 'system_prompts',
  'micronutrients', 'medications',
  'food_micronutrients', 'medication_interactions', 'patient_medications',
  'planning_rules',
  'program_template_weeks', 'patient_lab_results',
  'diet_weeks', 'diet_days', 'diet_meals', 'diet_notes', 'diet_snapshots',
];

const columnCache = {};

async function getTableColumns(table) {
  if (columnCache[table]) return columnCache[table];
  const { data, error } = await supabase.rpc('get_table_columns', { p_table: table });
  if (error || !data) return null;
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

async function pushTable(table, rows, validColumns) {
  const cleanedRows = rows.map(r => {
    const clean = cleanRow(validColumns, r);
    // Nullable FK sütunlarını NULL yap
    if (NULLABLE_FK_COLUMNS[table]) {
      for (const col of NULLABLE_FK_COLUMNS[table]) {
        if (clean[col]) clean[col] = null;
      }
    }
    return clean;
  });

  let tableSuccess = 0;
  let tableError = 0;
  let lastError = '';

  const batchSize = 50;
  const conflictCol = CONFLICT_COLUMNS[table];

  for (let i = 0; i < cleanedRows.length; i += batchSize) {
    const batch = cleanedRows.slice(i, i + batchSize);
    
    let result;
    if (conflictCol) {
      // Özel conflict sütunu kullan
      result = await supabase
        .from(table)
        .upsert(batch, { onConflict: conflictCol, ignoreDuplicates: false });
    } else {
      result = await supabase
        .from(table)
        .upsert(batch, { ignoreDuplicates: true });
    }

    if (result.error) {
      lastError = result.error.message;
      tableError += batch.length;
    } else {
      tableSuccess += batch.length;
    }
  }

  return { tableSuccess, tableError, lastError };
}

async function main() {
  console.log('Yedek okunuyor...');
  const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  console.log('Yedek okundu. Başarısız tabloları yeniden deniyorum...\n');

  let totalSuccess = 0;
  let totalFail = 0;
  const stillFailing = [];

  for (const table of RETRY_ORDER) {
    if (!rawData[table] || rawData[table].length === 0) continue;

    const validColumns = await getTableColumns(table);
    if (!validColumns) {
      console.log(`[${table}] ⏭️  Tablo bulunamadı, atlanıyor.`);
      continue;
    }

    const rows = rawData[table];
    const dataColumns = Object.keys(rows[0]);
    const strippedCols = dataColumns.filter(c => !validColumns.includes(c));

    console.log(`[${table}] ${rows.length} kayıt aktarılıyor...`);
    if (strippedCols.length > 0) console.log(`  🧹 Temizlenen: ${strippedCols.join(', ')}`);
    if (CONFLICT_COLUMNS[table]) console.log(`  🔑 Conflict sütunu: ${CONFLICT_COLUMNS[table]}`);
    if (NULLABLE_FK_COLUMNS[table]) console.log(`  🔗 NULL yapılan FK: ${NULLABLE_FK_COLUMNS[table].join(', ')}`);

    const { tableSuccess, tableError, lastError } = await pushTable(table, rows, validColumns);

    if (tableError === 0) {
      console.log(`  ✅ ${tableSuccess} kayıt başarıyla aktarıldı.`);
    } else if (tableSuccess > 0) {
      console.log(`  ⚠️  ${tableSuccess} başarılı, ${tableError} hatalı. Hata: ${lastError.substring(0, 100)}`);
    } else {
      console.log(`  ❌ BAŞARISIZ: ${lastError.substring(0, 120)}`);
      stillFailing.push({ table, error: lastError, count: rows.length });
    }
    totalSuccess += tableSuccess;
    totalFail += tableError;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎉 DÜZELTME TAMAMLANDI!`);
  console.log(`   ✅ Başarılı: ${totalSuccess}`);
  console.log(`   ⚠️  Hatalı: ${totalFail}`);
  if (stillFailing.length > 0) {
    console.log(`\n⛔ Hâlâ başarısız:`);
    for (const f of stillFailing) {
      console.log(`   - ${f.table} (${f.count}): ${f.error.substring(0, 120)}`);
    }
  }
  console.log(`${'='.repeat(60)}`);
}

main();

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

// 1. Kök dizindeki tüm .sql dosyalarını bul
const allFiles = fs.readdirSync(projectRoot);
const sqlFiles = allFiles.filter(f => 
  f.toLowerCase().endsWith('.sql') && 
  (f.toLowerCase().startsWith('supabase') || f.toLowerCase().startsWith('setup') || f.toLowerCase().startsWith('add')) &&
  !f.toLowerCase().includes('rollback') &&
  !f.includes('v43_FixRPC_Assets') && 
  !f.includes('v45_UpdateAdminView')
);

// 2. Dosyaları mantıklı bir sıraya diz
const sortedFiles = sqlFiles.map(f => {
  let order = 999;
  
  // Ana şema dosyası her zaman ilk
  if (f.toLowerCase() === 'supabase_schema.sql') {
    order = 1;
  } else if (f.toLowerCase() === 'add_program_scope_migration.sql') {
    order = 97.5;
  } else {
    // v2, v3...v65 gibi versiyonları bul
    const match = f.match(/_v(\d+)/i);
    if (match) {
      order = parseInt(match[1]) + 1; // v2 -> 3, v3 -> 4 vs.
    } else {
      const lowerF = f.toLowerCase();
      if (lowerF.includes('medications')) order = 2;
      else if (lowerF.includes('planner')) order = 20.5; // v19'dan sonra, v20'dan önce
      else if (lowerF.includes('micronutrients')) order = 30.5; // v31'den önce
      else if (lowerF.includes('diseases')) order = 47.5; // v48'den önce
      else if (lowerF.includes('recipe_integration')) order = 58.5; // v59'dan önce
      else if (lowerF.includes('proposals')) order = 58.6; // v59'dan önce
      else if (lowerF.includes('schema_ai')) order = 59.5; // v60'dan önce
      else if (lowerF.includes('sync_patients')) order = 65.5; // v66'dan önce
      else if (lowerF.includes('access') || lowerF.includes('security') || lowerF.includes('fix') || lowerF.includes('check') || lowerF.includes('update') || lowerF.includes('policy') || lowerF.includes('policies')) order = 800; // Güvenlik ve fixler sona
      else order = 700; // Geri kalan tüm kurulumlar (setup vb) ana güncellemeler bittikten sonraya (v65 sonrasına) gitsin
    }
  }
  
  return { name: f, order: order };
}).sort((a, b) => a.order - b.order);

// 3. Dosyaları oku ve birleştir
console.log(`${sortedFiles.length} adet SQL dosyası bulundu. Birleştiriliyor...`);

let combinedSql = `-- DİYET PROJESİ TAM ŞEMA (OTOMATİK BİRLEŞTİRİLMİŞTİR)\n`;
combinedSql += `-- Toplam Dosya Sayısı: ${sortedFiles.length}\n\n`;

for (const fileObj of sortedFiles) {
  const filePath = path.join(projectRoot, fileObj.name);
  const content = fs.readFileSync(filePath, 'utf8');
  
  combinedSql += `\n\n--------------------------------------------------------\n`;
  combinedSql += `-- DOSYA: ${fileObj.name} (Sıra: ${fileObj.order})\n`;
  combinedSql += `--------------------------------------------------------\n\n`;
  combinedSql += content;
  
  console.log(`Eklendi: ${fileObj.name} (Sıra: ${fileObj.order})`);
}

// 4. Çıktıyı kaydet
const outputPath = path.join(projectRoot, 'Tam_Sema.sql');
fs.writeFileSync(outputPath, combinedSql);

console.log(`\n✅ BAŞARILI! Tüm şema dosyaları birleştirildi: Tam_Sema.sql`);

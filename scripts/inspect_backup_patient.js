const fs = require('fs');
const path = require('path');

const JSON_FILE = path.join(__dirname, '../___supabase_yedekler/diyet_yedek_2026-05-21.json');

function inspect() {
  if (!fs.existsSync(JSON_FILE)) {
    console.error('Backup file not found at:', JSON_FILE);
    return;
  }
  const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  const patients = rawData.patients || [];
  console.log(`Total patients in backup: ${patients.length}`);
  if (patients.length > 0) {
    console.log('Sample patient record from backup:', JSON.stringify(patients[0], null, 2));
  } else {
    console.log('No patients found in backup.');
  }
}
inspect();

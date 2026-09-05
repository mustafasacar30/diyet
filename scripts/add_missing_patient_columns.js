require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const JSON_FILE = path.join(__dirname, '..', '___supabase_yedekler', 'diyet_yedek_2026-05-21.json');

async function main() {
  console.log('Connecting to database...');
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Connected successfully!');

  try {
    console.log('Adding missing columns to public.patients...');
    await client.query(`
      ALTER TABLE public.patients
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS dismissed_global_rule_ids UUID[] DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS patient_goals TEXT[] DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS can_self_plan BOOLEAN DEFAULT FALSE;
    `);
    console.log('Columns added successfully!');

    // Read json backup
    console.log('Reading JSON backup to restore patient columns...');
    const rawData = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    const patients = rawData.patients || [];
    console.log(`Found ${patients.length} patients in backup.`);

    // Update each patient
    for (const p of patients) {
      console.log(`Updating patient: ${p.full_name} (${p.id})`);
      await client.query(
        `UPDATE public.patients 
         SET updated_at = $1, 
             dismissed_global_rule_ids = $2, 
             patient_goals = $3, 
             phone = $4, 
             can_self_plan = $5 
         WHERE id = $6`,
        [
          p.updated_at || null,
          p.dismissed_global_rule_ids || [],
          p.patient_goals || [],
          p.phone || null,
          p.can_self_plan ?? false,
          p.id
        ]
      );
    }
    console.log('All patients updated with restored columns!');
  } catch (error) {
    console.error('Error during execution:', error);
  } finally {
    await client.end();
  }
}

main();

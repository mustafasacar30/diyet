const { Client } = require('pg');

async function test() {
  const url = "postgresql://postgres.lpabhijqrccssooozuoe:Dr_mistik2020@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
  console.log('Connecting to pooler on 5432:', url);
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    console.log('Success!');
    const res = await client.query('SELECT NOW()');
    console.log('Time:', res.rows[0]);
  } catch (err) {
    console.error('Connection failed:', err);
  } finally {
    await client.end();
  }
}
test();

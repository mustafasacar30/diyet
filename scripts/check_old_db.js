const { Client } = require('pg');
const client = new Client('postgresql://postgres:Dr_mistdenx2@db.edcxbjneplsktmlrkvix.supabase.co:5432/postgres');
client.connect()
  .then(() => client.query('SELECT count(*) FROM auth.users'))
  .then(res => { console.log("User count:", res.rows[0].count); client.end(); })
  .catch(console.error);

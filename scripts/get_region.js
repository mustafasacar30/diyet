const https = require('https');

function check() {
  const req = https.request('https://lpabhijqrccssooozuoe.supabase.co/rest/v1/', {
    method: 'GET',
    headers: {
      'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    }
  }, (res) => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers);
  });
  req.on('error', (e) => {
    console.error(e);
  });
  req.end();
}
// Read env file
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
check();

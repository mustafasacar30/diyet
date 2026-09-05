const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function fixAdmin() {
  const email = 'mustafasacar@hotmail.com';
  console.log(`Looking up user: ${email}`);

  // Find user by email
  const { data: users, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Error listing users:', listError);
    return;
  }

  const user = users.users.find(u => u.email === email);
  if (!user) {
    console.log(`User ${email} not found in auth.users. Creating it...`);
    const { data: newAuth, error: createError } = await supabase.auth.admin.createUser({
      email: email,
      password: '123456',
      email_confirm: true,
      user_metadata: { full_name: 'Mustafa Saçar', role: 'admin' }
    });
    if (createError) {
      console.error('Failed to create user:', createError);
      return;
    }
    console.log('Created user with ID:', newAuth.user.id);
    
    // Check/create profile
    const { error: profError } = await supabase.from('profiles').upsert({
      id: newAuth.user.id,
      full_name: 'Mustafa Saçar',
      role: 'admin'
    });
    if (profError) console.error('Failed to upsert profile:', profError);
    else console.log('Profile created/updated to admin.');
    
  } else {
    console.log(`Found user! ID: ${user.id}. Updating password to 123456...`);
    const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
      password: '123456',
      email_confirm: true
    });
    if (updateError) {
      console.error('Failed to update password:', updateError);
    } else {
      console.log('Password updated successfully.');
    }
    
    console.log('Ensuring profile is admin...');
    const { error: profError } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', user.id);
    if (profError) {
      console.error('Failed to update profile to admin:', profError);
    } else {
      console.log('Profile role confirmed as admin.');
    }
  }
}

fixAdmin();

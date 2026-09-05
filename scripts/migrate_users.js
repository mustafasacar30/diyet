require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Credentials missing');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const data = require('../___supabase_yedekler/diyet_yedek_2026-05-21.json');

async function migrateUsers() {
    console.log(`Found ${data.profiles.length} profiles to migrate to auth.users`);
    
    for (const profile of data.profiles) {
        if (!profile.email) {
            console.log(`Skipping profile ${profile.id} - no email`);
            continue;
        }
        
        console.log(`Creating auth.user for ${profile.email} (${profile.id})...`);
        const { data: user, error } = await supabase.auth.admin.createUser({
            id: profile.id, // Trying to preserve the UUID!
            email: profile.email,
            password: 'Diyet!User2026',
            email_confirm: true,
            user_metadata: {
                full_name: profile.full_name,
                avatar_url: profile.avatar_url
            }
        });
        
        if (error) {
            console.error(`  Error creating user ${profile.email}:`, error.message);
        } else {
            console.log(`  Success! User created with ID: ${user.user.id}`);
        }
    }
    console.log("Done!");
}

migrateUsers();

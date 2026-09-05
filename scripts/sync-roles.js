const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function syncRolesToMetadata() {
    console.log("Fetching all profiles...");
    const { data: profiles, error: fetchError } = await supabase.from('profiles').select('id, role, email');
    
    if (fetchError) {
        console.error("Error fetching profiles:", fetchError);
        return;
    }

    console.log(`Found ${profiles.length} profiles. Syncing to Auth metadata...`);

    let updated = 0;
    for (const profile of profiles) {
        const { data: userResp, error: userError } = await supabase.auth.admin.getUserById(profile.id);
        
        if (userError || !userResp.user) {
            console.error(`Could not fetch user for profile ${profile.id}:`, userError);
            continue;
        }

        const currentMeta = userResp.user.user_metadata || {};
        if (currentMeta.role !== profile.role) {
            console.log(`Updating user ${profile.email} (${profile.id}) from role '${currentMeta.role}' to '${profile.role}'...`);
            
            const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
                user_metadata: { ...currentMeta, role: profile.role }
            });

            if (updateError) {
                console.error(`Failed to update ${profile.id}:`, updateError);
            } else {
                updated++;
            }
        }
    }

    console.log(`Done! Updated ${updated} users' metadata.`);
}

syncRolesToMetadata();

// Security audit using Supabase Management API to check RLS status
const SUPABASE_URL = 'https://lpabhijqrccssooozuoe.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwYWJoaWpxcmNjc3Nvb296dW9lIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM4NjI5OSwiZXhwIjoyMDk0OTYyMjk5fQ.-MyVjEY1Ee0ZFwUVQmYlgQzeXiaBBU0-dlKz1b7gjNU';

// Tables we know exist from the API listing
const KNOWN_TABLES = [
    'patient_meal_choices', 'patient_activity_logs', 'medication_interactions',
    'diet_types', 'measurement_definitions', 'food_micronutrients',
    'team_food_overrides', 'planner_settings', 'program_diet_type_overrides',
    'disease_rules', 'diet_days', 'patient_assignments',
    'team_program_override_weeks', 'diet_notes', 'diet_plans',
    'program_template_weeks', 'team_food_micronutrient_overrides',
    'conversations', 'medications', 'planning_rules',
    'diet_snapshots', 'recipe_cards', 'foods', 'import_rules',
    'recipe_match_bans', 'diet_meals', 'rule_sets',
    'team_program_override_restrictions', 'planner_settings_scope_checkpoint_v97',
    'profiles', 'user_devices', 'food_proposals',
    'program_template_restrictions', 'messages', 'patient_imaging',
    'patients', 'program_templates', 'team_members',
    'diseases', 'patient_notes', 'system_prompts',
    'patient_observations', 'patient_ai_reports',
    'menu_import_pool', 'patient_food_usage', 'participants',
    'patient_medications', 'micronutrients', 'patient_measurements',
    'team_program_overrides', 'system_settings', 'team_diet_type_overrides',
    'patient_meal_settings', 'app_settings', 'patient_lab_results',
    'chat_messages', 'diet_weeks', 'patient_diseases',
    'meal_templates', 'rule_set_items', 'recipe_manual_matches'
];

// Views we know exist
const KNOWN_VIEWS = ['user_management_view'];

async function testTableAccess(tableName, isView = false) {
    const type = isView ? 'VIEW' : 'TABLE';
    
    // Test with anon key (simulating public access)
    const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwYWJoaWpxcmNjc3Nvb296dW9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzODYyOTksImV4cCI6MjA5NDk2MjI5OX0.ujKzNBCuvf96sV-Po4NyjCpCYG4dAGMgTIRLu7Ec_lo';
    
    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?limit=1`, {
            headers: {
                'apikey': ANON_KEY,
                'Authorization': `Bearer ${ANON_KEY}`,
            }
        });
        
        const status = resp.status;
        let rowCount = 0;
        let hasData = false;
        
        if (status === 200) {
            const data = await resp.json();
            rowCount = data.length;
            hasData = rowCount > 0;
        }
        
        return { tableName, type, status, hasData, rowCount };
    } catch (err) {
        return { tableName, type, status: 'ERROR', error: err.message };
    }
}

async function main() {
    console.log('=== SUPABASE ANON ACCESS AUDIT ===');
    console.log('Testing what data is accessible with anon (unauthenticated) key...\n');

    const results = [];
    
    // Test all tables and views
    const allEntities = [
        ...KNOWN_TABLES.map(t => ({ name: t, isView: false })),
        ...KNOWN_VIEWS.map(v => ({ name: v, isView: true }))
    ];

    // Process in batches of 5
    for (let i = 0; i < allEntities.length; i += 5) {
        const batch = allEntities.slice(i, i + 5);
        const batchResults = await Promise.all(
            batch.map(e => testTableAccess(e.name, e.isView))
        );
        results.push(...batchResults);
    }

    // Categorize results
    const accessible = results.filter(r => r.status === 200 && r.hasData);
    const emptyButAccessible = results.filter(r => r.status === 200 && !r.hasData);
    const blocked = results.filter(r => r.status !== 200);

    console.log('🚨 CRITICAL: Tables/Views returning data to ANON users:');
    if (accessible.length === 0) {
        console.log('  None! ✅');
    } else {
        accessible.forEach(r => {
            console.log(`  ❌ ${r.tableName} (${r.type}) - ${r.rowCount} rows visible`);
        });
    }

    console.log(`\n⚠️  Tables accessible but empty (${emptyButAccessible.length}):`);
    emptyButAccessible.forEach(r => {
        console.log(`  ⚠️  ${r.tableName} (${r.type})`);
    });

    console.log(`\n✅ Tables blocked from anon access (${blocked.length}):`);
    blocked.forEach(r => {
        console.log(`  ✅ ${r.tableName} (${r.type}) - HTTP ${r.status}`);
    });

    // Special check: user_management_view
    console.log('\n--- SPECIAL CHECK: user_management_view ---');
    const viewResp = await fetch(`${SUPABASE_URL}/rest/v1/user_management_view?limit=3`, {
        headers: {
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwYWJoaWpxcmNjc3Nvb296dW9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzODYyOTksImV4cCI6MjA5NDk2MjI5OX0.ujKzNBCuvf96sV-Po4NyjCpCYG4dAGMgTIRLu7Ec_lo',
            'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwYWJoaWpxcmNjc3Nvb296dW9lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzODYyOTksImV4cCI6MjA5NDk2MjI5OX0.ujKzNBCuvf96sV-Po4NyjCpCYG4dAGMgTIRLu7Ec_lo`,
        }
    });
    if (viewResp.status === 200) {
        const viewData = await viewResp.json();
        if (viewData.length > 0) {
            console.log('  🚨 user_management_view IS ACCESSIBLE TO ANON!');
            console.log('  Columns exposed:', Object.keys(viewData[0]).join(', '));
        } else {
            console.log('  ✅ Empty or RLS blocks data');
        }
    } else {
        console.log('  ✅ Blocked (HTTP', viewResp.status, ')');
    }

    console.log('\n=== AUDIT COMPLETE ===');
}

main().catch(console.error);

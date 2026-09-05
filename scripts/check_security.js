// Check Supabase security issues: RLS disabled tables, exposed views, sensitive columns
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://lpabhijqrccssooozuoe.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwYWJoaWpxcmNjc3Nvb296dW9lIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM4NjI5OSwiZXhwIjoyMDk0OTYyMjk5fQ.-MyVjEY1Ee0ZFwUVQmYlgQzeXiaBBU0-dlKz1b7gjNU';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSecurity() {
    console.log('=== SUPABASE SECURITY CHECK ===\n');

    // 1. Check tables with RLS disabled
    const { data: rlsData, error: rlsError } = await supabase.rpc('exec_sql', {
        query: `
            SELECT schemaname, tablename, rowsecurity
            FROM pg_tables 
            WHERE schemaname = 'public'
            ORDER BY tablename;
        `
    });

    // If rpc doesn't work, try direct query via REST
    if (rlsError) {
        console.log('RPC not available, trying REST API...');
        
        // Use PostgREST to query pg_catalog
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
            method: 'POST',
            headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Direct REST status:', response.status);
    }

    if (rlsData) {
        console.log('--- Tables with RLS DISABLED ---');
        const noRls = rlsData.filter(t => !t.rowsecurity);
        noRls.forEach(t => console.log(`  ❌ ${t.tablename} (RLS: OFF)`));
        console.log(`\n  Total: ${noRls.length} tables without RLS\n`);
        
        console.log('--- Tables with RLS ENABLED ---');
        const withRls = rlsData.filter(t => t.rowsecurity);
        withRls.forEach(t => console.log(`  ✅ ${t.tablename}`));
        console.log(`\n  Total: ${withRls.length} tables with RLS\n`);
    }

    // 2. Check views in public schema
    const { data: viewData, error: viewError } = await supabase.rpc('exec_sql', {
        query: `
            SELECT table_name, view_definition 
            FROM information_schema.views 
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `
    });

    if (viewData) {
        console.log('--- Public Views ---');
        viewData.forEach(v => {
            const defPreview = (v.view_definition || '').substring(0, 100);
            console.log(`  📋 ${v.table_name}: ${defPreview}...`);
        });
        console.log(`\n  Total: ${viewData.length} views\n`);
    }

    // 3. Check if auth.users is exposed
    const { data: authViewData, error: authViewError } = await supabase.rpc('exec_sql', {
        query: `
            SELECT table_name 
            FROM information_schema.views 
            WHERE table_schema = 'public' 
            AND (view_definition ILIKE '%auth.users%' OR table_name ILIKE '%user%');
        `
    });

    if (authViewData) {
        console.log('--- Views exposing auth.users ---');
        authViewData.forEach(v => console.log(`  🚨 ${v.table_name}`));
        if (authViewData.length === 0) console.log('  None found');
        console.log('');
    }

    console.log('=== CHECK COMPLETE ===');
}

checkSecurity().catch(console.error);

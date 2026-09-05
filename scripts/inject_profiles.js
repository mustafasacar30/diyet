const fs = require('fs');
let sql = fs.readFileSync('Tam_Sema_V2_GUNCEL.sql', 'utf8');

const profilesSql = `
--------------------------------------------------------
-- PROFILES TABLE (Injected to fix dependency order)
--------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY, -- REFERENCES auth.users(id) ON DELETE CASCADE
    role TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'dietitian', 'patient')),
    full_name TEXT NOT NULL,
    title TEXT,
    avatar_url TEXT,
    max_devices INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
`;

if (!sql.includes('-- PROFILES TABLE (Injected to fix dependency order)')) {
    sql = sql.replace('create extension if not exists "uuid-ossp";', 'create extension if not exists "uuid-ossp";\n' + profilesSql);
    fs.writeFileSync('Tam_Sema_V2_GUNCEL.sql', sql);
    console.log('Injected profiles table at the top.');
} else {
    console.log('Profiles table already injected.');
}

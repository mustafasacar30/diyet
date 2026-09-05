const fs = require('fs');

const filePath = 'Tam_Sema.sql';
let sql = fs.readFileSync(filePath, 'utf8');

// Regex to find CREATE POLICY statements
// Matches: CREATE POLICY "policy name" ON table_name
const regex = /CREATE\s+POLICY\s+(["']?[a-zA-Z0-9_\s\-]+["']?)\s+ON\s+([a-zA-Z0-9_".]+)/gi;

sql = sql.replace(regex, (match, p1, p2) => {
    // Skip dynamic SQL like ON public.%I
    if (p2.endsWith('.')) {
        return match;
    }
    // Return the DROP POLICY IF EXISTS followed by the original CREATE POLICY
    return `DROP POLICY IF EXISTS ${p1} ON ${p2};\n${match}`;
});

fs.writeFileSync(filePath, sql);
console.log('Tam_Sema.sql updated with DROP POLICY IF EXISTS (supports multi-line).');

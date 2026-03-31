-- 1. Add hidden_from_cardmaker to foods table
ALTER TABLE foods 
ADD COLUMN IF NOT EXISTS hidden_from_cardmaker boolean DEFAULT false;

-- 2. Ensure system_settings table exists
CREATE TABLE IF NOT EXISTS system_settings (
    key text PRIMARY KEY,
    value jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);

-- 3. Ensure settings exist
INSERT INTO system_settings (key, value)
VALUES ('cardmaker_templates', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO system_settings (key, value)
VALUES ('discovery_search_sites', '[]'::jsonb)
ON CONFLICT (key) DO NOTHING;

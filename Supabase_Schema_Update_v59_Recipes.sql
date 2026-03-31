-- Supabase Schema Update v59
-- Adds recipe and ingredients columns to support AI Food Discovery Engine

-- 1. Update foods table
ALTER TABLE foods ADD COLUMN IF NOT EXISTS ingredients TEXT;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS recipe_text TEXT;
ALTER TABLE foods ADD COLUMN IF NOT EXISTS source_url TEXT;

-- 2. Update food_proposals table
ALTER TABLE food_proposals ADD COLUMN IF NOT EXISTS ingredients TEXT;
ALTER TABLE food_proposals ADD COLUMN IF NOT EXISTS recipe_text TEXT;
ALTER TABLE food_proposals ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE food_proposals ADD COLUMN IF NOT EXISTS source_url TEXT;

-- (Optional) Update views or security policies if necessary

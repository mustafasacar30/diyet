-- Add hidden_from_cardmaker column to foods table
-- This replaces the localStorage-based hidden foods feature
ALTER TABLE foods ADD COLUMN IF NOT EXISTS hidden_from_cardmaker boolean DEFAULT false;

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_foods_hidden_cardmaker ON foods(hidden_from_cardmaker);

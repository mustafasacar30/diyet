-- Add AI limit columns to patients table
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS auto_plan_limit_count INTEGER,
ADD COLUMN IF NOT EXISTS auto_plan_limit_period_hours INTEGER,
ADD COLUMN IF NOT EXISTS ai_analysis_limit_count INTEGER,
ADD COLUMN IF NOT EXISTS ai_analysis_limit_period_hours INTEGER,
ADD COLUMN IF NOT EXISTS ai_photo_limit_count INTEGER,
ADD COLUMN IF NOT EXISTS ai_photo_limit_period_hours INTEGER,
ADD COLUMN IF NOT EXISTS ai_search_limit_count INTEGER,
ADD COLUMN IF NOT EXISTS ai_search_limit_period_hours INTEGER,
ADD COLUMN IF NOT EXISTS macro_target_mode TEXT DEFAULT 'calculated',
ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT '{}'::jsonb;

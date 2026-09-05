-- ==============================================================================
-- Supabase Team-Based Security ROLLBACK (v67)
-- Author: Antigravity
-- ==============================================================================

BEGIN;

-- 1. Redefine tables and drop "Restricted Access" policies
DO $$
DECLARE
    table_name_val TEXT;
    tables TEXT[] := ARRAY[
        'patients', 'diet_plans', 'diet_weeks', 'diet_days', 'diet_meals', 
        'patient_meal_settings', 'patient_meal_choices', 'measurements', 
        'conversations', 'messages', 'patient_notes'
    ];
BEGIN
    FOREACH table_name_val IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = table_name_val) THEN
            EXECUTE format('DROP POLICY IF EXISTS "Restricted Access" ON public.%I', table_name_val);
            EXECUTE format('DROP POLICY IF EXISTS "Public Access" ON public.%I', table_name_val);
            EXECUTE format('CREATE POLICY "Public Access" ON public.%I FOR ALL USING (true)', table_name_val);
        END IF;
    END LOOP;
END $$;

-- 2. Note: Helper functions and profiles column are kept as they are harmless infrastructure

COMMIT;

NOTIFY pgrst, 'reload schema';
SELECT 'Security rolled back to Public Access (USING true). UI should be fully open again.' as status;

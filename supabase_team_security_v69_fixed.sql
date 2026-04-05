-- ==============================================================================
-- Supabase Team-Based Security (v69.1 - FIXED HIERARCHY)
-- Author: Antigravity
-- ==============================================================================

BEGIN;

-- 1. CLEANUP: Ensure we are starting from a known state (Nuke v69 broken policies)
DO $$
DECLARE
    table_name_val TEXT;
    tables TEXT[] := ARRAY[
        'patients', 'diet_plans', 'diet_weeks', 'diet_days', 'diet_meals', 
        'patient_meal_settings', 'patient_meal_choices', 'patient_measurements',
        'conversations', 'messages', 'patient_notes'
    ];
BEGIN
    FOREACH table_name_val IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = table_name_val) THEN
            EXECUTE format('DROP POLICY IF EXISTS "Restricted Access" ON public.%I', table_name_val);
            EXECUTE format('DROP POLICY IF EXISTS "Emergency Open" ON public.%I', table_name_val);
            EXECUTE format('DROP POLICY IF EXISTS "Baseline Patient Read" ON public.%I', table_name_val);
        END IF;
    END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 2. Metadata-Based Role Checker (Recursion-Free)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------------------------
-- 3. Core Access Helper (Safe and Fast)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_current_user_access_patient(target_patient_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    curr_uid UUID := auth.uid();
    curr_role TEXT := (auth.jwt() -> 'user_metadata' ->> 'role');
BEGIN
    -- 1. ADMIN
    IF curr_role = 'admin' THEN RETURN TRUE; END IF;

    -- 2. THE PATIENT THEMSELVES
    IF curr_uid = target_patient_id THEN RETURN TRUE; END IF;

    -- 3. STAFF ACCESS (Dietitian or Doctor)
    IF curr_role IN ('dietitian', 'doctor') THEN
        -- Assigned Dietitian
        IF EXISTS (SELECT 1 FROM public.patient_assignments WHERE patient_id = target_patient_id AND dietitian_id = curr_uid) THEN
            RETURN TRUE;
        END IF;

        -- Supervisor (Doctor) of Assigned Dietitian
        IF EXISTS (
            SELECT 1 FROM public.team_members tm
            JOIN public.patient_assignments pa ON tm.member_id = pa.dietitian_id
            WHERE pa.patient_id = target_patient_id AND tm.supervisor_id = curr_uid
        ) THEN
            RETURN TRUE;
        END IF;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------------------------
-- 4. Apply Corrected Policies (Explicitly handling nested structures)
-- ------------------------------------------------------------------------------

-- --- 1. patients ---
CREATE POLICY "Restricted Access" ON public.patients FOR ALL TO authenticated USING (can_current_user_access_patient(id));

-- --- 2. diet_plans ---
CREATE POLICY "Restricted Access" ON public.diet_plans FOR ALL TO authenticated USING (can_current_user_access_patient(patient_id));

-- --- 3. diet_weeks ---
-- Corrected: Links to plans -> patient_id
CREATE POLICY "Restricted Access" ON public.diet_weeks FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.diet_plans WHERE id = diet_plan_id AND can_current_user_access_patient(patient_id))
);

-- --- 4. diet_days ---
-- Corrected: Links to weeks -> plans -> patient_id
CREATE POLICY "Restricted Access" ON public.diet_days FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.diet_weeks w
        JOIN public.diet_plans p ON w.diet_plan_id = p.id
        WHERE w.id = diet_week_id AND can_current_user_access_patient(p.patient_id)
    )
);

-- --- 5. diet_meals ---
-- Corrected: Links to days -> weeks -> plans -> patient_id
CREATE POLICY "Restricted Access" ON public.diet_meals FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.diet_days d
        JOIN public.diet_weeks w ON d.diet_week_id = w.id
        JOIN public.diet_plans p ON w.diet_plan_id = p.id
        WHERE d.id = diet_day_id AND can_current_user_access_patient(p.patient_id)
    )
);

-- --- 6. Direct Patient Links ---
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_meal_settings') THEN
        CREATE POLICY "Restricted Access" ON public.patient_meal_settings FOR ALL TO authenticated USING (can_current_user_access_patient(patient_id));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_meal_choices') THEN
        CREATE POLICY "Restricted Access" ON public.patient_meal_choices FOR ALL TO authenticated USING (can_current_user_access_patient(patient_id));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_measurements') THEN
        CREATE POLICY "Restricted Access" ON public.patient_measurements FOR ALL TO authenticated USING (can_current_user_access_patient(patient_id));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'patient_notes') THEN
        CREATE POLICY "Restricted Access" ON public.patient_notes FOR ALL TO authenticated USING (can_current_user_access_patient(patient_id));
    END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
SELECT 'Safe Hierarchical Security (v69.1) applied successfully!' as status;

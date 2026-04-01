-- ==============================================================================
-- Supabase Team-Based Security & Patient Privacy (v67)
-- Author: Antigravity
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Profiles Table Update
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_global_access BOOLEAN DEFAULT false;

-- ------------------------------------------------------------------------------
-- 2. Security Helper Functions
-- ------------------------------------------------------------------------------

-- Check if user is Admin or a Doctor with Global Access
CREATE OR REPLACE FUNCTION public.is_admin_or_global()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role = 'admin' OR (role = 'doctor' AND is_global_access = true))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- CORE FUNCTION: Can the current user view this patient's data?
CREATE OR REPLACE FUNCTION public.can_view_patient(target_patient_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_id_val UUID := auth.uid();
BEGIN
    -- 1. ADMIN or GLOBAL DOCTOR
    IF public.is_admin_or_global() THEN
        RETURN TRUE;
    END IF;

    -- 2. THE PATIENT THEMSELVES
    -- Note: patients.id is the same as profile.id
    IF user_id_val = target_patient_id THEN
        RETURN TRUE;
    END IF;

    -- 3. ASSIGNED DIETITIAN
    IF EXISTS (
        SELECT 1 FROM public.patient_assignments
        WHERE patient_id = target_patient_id AND dietitian_id = user_id_val
    ) THEN
        RETURN TRUE;
    END IF;

    -- 4. DOCTOR / SUPERVISOR OF THE ASSIGNED DIETITIAN
    IF EXISTS (
        SELECT 1 FROM public.team_members tm
        JOIN public.patient_assignments pa ON tm.member_id = pa.dietitian_id
        WHERE pa.patient_id = target_patient_id AND tm.supervisor_id = user_id_val
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------------------------
-- 3. Apply Restricted Policies (CLEANUP & REBUILD)
-- ------------------------------------------------------------------------------

-- Helper to drop "Public Access" or "Enable all for authenticated" policies
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
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name_val);
        EXECUTE format('DROP POLICY IF EXISTS "Public Access" ON public.%I', table_name_val);
        EXECUTE format('DROP POLICY IF EXISTS "Enable all for authenticated" ON public.%I', table_name_val);
        EXECUTE format('DROP POLICY IF EXISTS "Restricted Access" ON public.%I', table_name_val);
    END LOOP;
END $$;

-- --- 1. patients ---
CREATE POLICY "Restricted Access" ON public.patients 
FOR ALL TO authenticated USING (can_view_patient(id));

-- --- 2. diet_plans ---
CREATE POLICY "Restricted Access" ON public.diet_plans 
FOR ALL TO authenticated USING (can_view_patient(patient_id));

-- --- 3. diet_weeks ---
CREATE POLICY "Restricted Access" ON public.diet_weeks
FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.diet_plans WHERE id = diet_plan_id AND can_view_patient(patient_id))
);

-- --- 4. diet_days ---
CREATE POLICY "Restricted Access" ON public.diet_days
FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.diet_weeks w
        JOIN public.diet_plans p ON w.diet_plan_id = p.id
        WHERE w.id = diet_week_id AND can_view_patient(p.patient_id)
    )
);

-- --- 5. diet_meals ---
CREATE POLICY "Restricted Access" ON public.diet_meals
FOR ALL TO authenticated USING (
    EXISTS (
        SELECT 1 FROM public.diet_days d
        JOIN public.diet_weeks w ON d.diet_week_id = w.id
        JOIN public.diet_plans p ON w.diet_plan_id = p.id
        WHERE d.id = diet_day_id AND can_view_patient(p.patient_id)
    )
);

-- --- 6. settings & choices ---
CREATE POLICY "Restricted Access" ON public.patient_meal_settings 
FOR ALL TO authenticated USING (can_view_patient(patient_id));

CREATE POLICY "Restricted Access" ON public.patient_meal_choices 
FOR ALL TO authenticated USING (can_view_patient(patient_id));

-- --- 7. Messaging ---
-- Re-defining messaging to be strictly participant-based
CREATE POLICY "Restricted Access" ON public.conversations
FOR ALL TO authenticated USING (
    is_admin_or_global() OR
    EXISTS (SELECT 1 FROM public.participants WHERE conversation_id = id AND user_id = auth.uid()) OR
    -- Supervisor access
    EXISTS (
        SELECT 1 FROM public.participants pt
        JOIN public.team_members tm ON pt.user_id = tm.member_id
        WHERE pt.conversation_id = conversations.id AND tm.supervisor_id = auth.uid()
    )
);

CREATE POLICY "Restricted Access" ON public.messages
FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.conversations WHERE id = conversation_id) -- Inherited from conversation policy
);

COMMIT;

NOTIFY pgrst, 'reload schema';
SELECT 'Team-based security applied! All core tables are now restricted by valid assignment or ownership.' as status;

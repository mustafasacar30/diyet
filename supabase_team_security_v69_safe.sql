-- ==============================================================================
-- Supabase Team-Based Security (v69 - NON-RECURSIVE SAFE VERSION)
-- Author: Antigravity
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Metadata-Based Role Checker (Recursion-Free)
-- ------------------------------------------------------------------------------
-- This function checks the JWT metadata first (fast) or queries the profile 
-- table using a subplan that avoids direct self-referential policy loops.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check JWT metadata first (Propagated from auth.users.raw_user_meta_data)
  IF (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' THEN
    RETURN TRUE;
  END IF;
  
  -- Fallback: Use a direct bypass check if role is not in metadata
  -- We assume if RLS is DISABLED on the view/base, we can check it.
  -- But for most Supabase setups, relying on metadata is safer for RLS.
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------------------------
-- 2. Core Access Helper (Safe and Fast)
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
    -- This inner query on other tables (assignments/members) will NOT recurse 
    -- because it doesn't reference the table being checked (patients/others).
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
-- 3. Reset & Protect
-- ------------------------------------------------------------------------------

-- Ensure basics are open but protected
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Profile Read" ON public.profiles;
DROP POLICY IF EXISTS "Restricted Profile Access" ON public.profiles;
DROP POLICY IF EXISTS "Baseline Profile Read" ON public.profiles;

-- RULE: Anyone can read basic profile info (prevents UI lock), 
-- but only Admins and Owners can see/do more.
CREATE POLICY "Profiles are readable by authenticated"
ON public.profiles FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id);

-- --- RESTRICT PATIENTS & CORE DATA ---
DO $$
DECLARE
    table_name_val TEXT;
    tables TEXT[] := ARRAY[
        'patients', 'diet_plans', 'diet_weeks', 'diet_days', 'diet_meals', 
        'patient_meal_settings', 'patient_meal_choices', 'patient_measurements'
    ];
BEGIN
    FOREACH table_name_val IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = table_name_val) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name_val);
            EXECUTE format('DROP POLICY IF EXISTS "Emergency Open" ON public.%I', table_name_val);
            EXECUTE format('DROP POLICY IF EXISTS "Baseline Patient Read" ON public.%I', table_name_val);
            EXECUTE format('DROP POLICY IF EXISTS "Restricted Access" ON public.%I', table_name_val);
            
            -- Apply the new safe policy
            IF table_name_val = 'patients' THEN
                EXECUTE format('CREATE POLICY "Restricted Access" ON public.%I FOR ALL TO authenticated USING (can_current_user_access_patient(id))', table_name_val);
            ELSE
                EXECUTE format('CREATE POLICY "Restricted Access" ON public.%I FOR ALL TO authenticated USING (can_current_user_access_patient(patient_id))', table_name_val);
            END IF;
        END IF;
    END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
SELECT 'Safe team-based security (v69) applied! No recursion risk.' as status;

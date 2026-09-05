-- ==============================================================================
-- Supabase Security Hardening Fixes (v66)
-- Author: Antigravity
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Profiles Table: Add Email and Enable RLS
-- ------------------------------------------------------------------------------
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='profiles' AND COLUMN_NAME='email') THEN
        ALTER TABLE public.profiles ADD COLUMN email TEXT;
    END IF;
END $$;

-- Populate existing emails
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. Auth Sync Trigger
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, full_name, email, avatar_url)
  VALUES (
    NEW.id, 
    COALESCE(NEW.raw_user_meta_data->>'role', 'patient'),
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(profiles.full_name, EXCLUDED.full_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 3. user_management_view: Remove Auth Dependency and Security Definer
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.user_management_view;

CREATE VIEW public.user_management_view AS
SELECT 
    p.id,
    p.role,
    p.full_name,
    p.title,
    p.avatar_url,
    p.max_devices,
    p.valid_until,
    p.created_at,
    p.updated_at,
    p.email  -- Now coming from public.profiles
FROM public.profiles p;

GRANT SELECT ON public.user_management_view TO authenticated;
GRANT SELECT ON public.user_management_view TO service_role;

-- ------------------------------------------------------------------------------
-- 4. Function Search Path Hardening
-- ------------------------------------------------------------------------------
-- Apply SET search_path = public to all identified functions

ALTER FUNCTION public.is_assigned_dietitian(uuid) SET search_path = public;
ALTER FUNCTION public.get_my_role() SET search_path = public;
ALTER FUNCTION public.auto_assign_created_patient() SET search_path = public;
ALTER FUNCTION public.handle_profile_patient_sync() SET search_path = public;
ALTER FUNCTION public.get_or_create_conversation(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.handle_new_message() SET search_path = public;
ALTER FUNCTION public.get_unread_counts(uuid) SET search_path = public;
ALTER FUNCTION public.get_my_dietitian() SET search_path = public;
ALTER FUNCTION public.is_participant(uuid) SET search_path = public;

-- Add others from screenshot if they exist
DO $$ 
BEGIN
    -- These might exist under different signatures or names, we use DO block to avoid errors if missing
    BEGIN ALTER FUNCTION public.update_medications_timestamp() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER FUNCTION public.resolve_patient_id_from_user(uuid) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER FUNCTION public.get_active_patient_medications(uuid) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER FUNCTION public.get_patient_medication_history(uuid) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER FUNCTION public.update_planner_timestamp() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER FUNCTION public.remove_persistent_lock(text) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER FUNCTION public.add_persistent_lock(text, interval) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER FUNCTION public.delete_propagated_notes(uuid) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER FUNCTION public.propagate_diet_note() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
SELECT 'Security fixes applied successfully!' as status;

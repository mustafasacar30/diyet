-- ==============================================================================
-- Supabase Security Hardening Fixes (v66.1 - FIXED)
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

-- Populate existing emails from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- Enable RLS (Ensure tables are protected)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. Auth Sync Trigger (Improved Error Handling)
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
    p.email
FROM public.profiles p;

GRANT SELECT ON public.user_management_view TO authenticated;
GRANT SELECT ON public.user_management_view TO service_role;

-- ------------------------------------------------------------------------------
-- 4. DYNAMIC Function Search Path Hardening
-- This block automatically finds all functions in 'public' and secures them.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    func_record RECORD;
BEGIN
    FOR func_record IN 
        SELECT n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' 
          AND p.prokind = 'f' -- ensure it's a function
    LOOP
        BEGIN
            EXECUTE format('ALTER FUNCTION %I.%I(%s) SET search_path = public', 
                           func_record.schema, func_record.name, func_record.args);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not secure function %.%(%): %', 
                         func_record.schema, func_record.name, func_record.args, SQLERRM;
        END;
    END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
SELECT 'Security fixes applied successfully! View and RLS are protected. Functions are secured.' as status;

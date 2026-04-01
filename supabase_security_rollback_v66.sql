-- ==============================================================================
-- Supabase Security Hardening ROLLBACK (v66)
-- Author: Antigravity
-- ==============================================================================

BEGIN;

-- 1. Restore View (Original Join-Based)
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
    u.email
FROM public.profiles p
LEFT JOIN auth.users u ON p.id = u.id;

GRANT SELECT ON public.user_management_view TO authenticated;
GRANT SELECT ON public.user_management_view TO service_role;

-- 2. Optional: Disable RLS if it caused UI breakage
-- ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.team_members DISABLE ROW LEVEL SECURITY;

-- Note: We keep the email column in profiles as it doesn't harm anything.
-- We also keep SET search_path on functions as it is a pure security benefit.

COMMIT;

NOTIFY pgrst, 'reload schema';
SELECT 'Rollback completed. UI should be back to original state.' as status;

-- Rollback for v99: team program template overrides

BEGIN;

DROP POLICY IF EXISTS "Team Program Override Restrictions Delete v99" ON public.team_program_override_restrictions;
DROP POLICY IF EXISTS "Team Program Override Restrictions Update v99" ON public.team_program_override_restrictions;
DROP POLICY IF EXISTS "Team Program Override Restrictions Insert v99" ON public.team_program_override_restrictions;
DROP POLICY IF EXISTS "Team Program Override Restrictions Select v99" ON public.team_program_override_restrictions;

DROP POLICY IF EXISTS "Team Program Override Weeks Delete v99" ON public.team_program_override_weeks;
DROP POLICY IF EXISTS "Team Program Override Weeks Update v99" ON public.team_program_override_weeks;
DROP POLICY IF EXISTS "Team Program Override Weeks Insert v99" ON public.team_program_override_weeks;
DROP POLICY IF EXISTS "Team Program Override Weeks Select v99" ON public.team_program_override_weeks;

DROP POLICY IF EXISTS "Team Program Overrides Delete v99" ON public.team_program_overrides;
DROP POLICY IF EXISTS "Team Program Overrides Update v99" ON public.team_program_overrides;
DROP POLICY IF EXISTS "Team Program Overrides Insert v99" ON public.team_program_overrides;
DROP POLICY IF EXISTS "Team Program Overrides Select v99" ON public.team_program_overrides;

DROP TRIGGER IF EXISTS trg_team_program_overrides_updated_at ON public.team_program_overrides;
DROP FUNCTION IF EXISTS public.set_team_program_overrides_updated_at();
DROP FUNCTION IF EXISTS public.is_current_user_in_team(UUID);

DROP TABLE IF EXISTS public.team_program_override_restrictions;
DROP TABLE IF EXISTS public.team_program_override_weeks;
DROP TABLE IF EXISTS public.team_program_overrides;

COMMIT;

NOTIFY pgrst, 'reload schema';

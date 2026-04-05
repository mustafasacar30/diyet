-- v98: Add team scope support to planner_settings
-- Target inheritance chain: global -> team -> program -> patient

BEGIN;

ALTER TABLE public.planner_settings
ADD COLUMN IF NOT EXISTS team_owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.planner_settings DROP CONSTRAINT IF EXISTS planner_settings_scope_check;
ALTER TABLE public.planner_settings
ADD CONSTRAINT planner_settings_scope_check
CHECK (scope IS NULL OR scope IN ('global', 'team', 'program', 'patient'));

CREATE INDEX IF NOT EXISTS idx_planner_settings_scope_team_owner
ON public.planner_settings(scope, team_owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_planner_settings_program_team
ON public.planner_settings(program_template_id, team_owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_planner_settings_patient_team
ON public.planner_settings(patient_id, team_owner_id, updated_at DESC);

-- Backfill: doctor-owned rows become doctor team roots.
UPDATE public.planner_settings ps
SET team_owner_id = ps.user_id
FROM public.profiles p
WHERE ps.user_id = p.id
  AND p.role = 'doctor'
  AND ps.scope IN ('team', 'program', 'patient')
  AND ps.team_owner_id IS NULL;

-- Backfill: dietitian-owned rows inherit team owner from active supervisor.
UPDATE public.planner_settings ps
SET team_owner_id = tm.supervisor_id
FROM public.profiles p
JOIN public.team_members tm
  ON tm.member_id = p.id
 AND tm.status = 'active'
WHERE ps.user_id = p.id
  AND p.role = 'dietitian'
  AND ps.scope IN ('team', 'program', 'patient')
  AND ps.team_owner_id IS NULL;

COMMIT;

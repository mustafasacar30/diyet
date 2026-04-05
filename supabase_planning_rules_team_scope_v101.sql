-- v101: planning_rules team scope support
-- Target inheritance chain for rules:
-- global -> team -> program -> patient

BEGIN;

ALTER TABLE public.planning_rules
ADD COLUMN IF NOT EXISTS team_owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.planning_rules
DROP CONSTRAINT IF EXISTS planning_rules_scope_check;

ALTER TABLE public.planning_rules
ADD CONSTRAINT planning_rules_scope_check
CHECK (scope IS NULL OR scope IN ('global', 'team', 'program', 'patient'));

CREATE INDEX IF NOT EXISTS idx_planning_rules_scope_team_owner
ON public.planning_rules(scope, team_owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_planning_rules_program_team
ON public.planning_rules(program_template_id, team_owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_planning_rules_patient_team
ON public.planning_rules(patient_id, team_owner_id, updated_at DESC);

-- Backfill: doctor-authored scoped rows
UPDATE public.planning_rules pr
SET team_owner_id = pr.user_id
FROM public.profiles p
WHERE pr.user_id = p.id
  AND p.role = 'doctor'
  AND pr.scope IN ('team', 'program', 'patient')
  AND pr.team_owner_id IS NULL;

-- Backfill: dietitian-authored scoped rows map to active supervisor
UPDATE public.planning_rules pr
SET team_owner_id = tm.supervisor_id
FROM public.profiles p
JOIN public.team_members tm
  ON tm.member_id = p.id
 AND tm.status = 'active'
WHERE pr.user_id = p.id
  AND p.role = 'dietitian'
  AND pr.scope IN ('team', 'program', 'patient')
  AND pr.team_owner_id IS NULL;

COMMENT ON COLUMN public.planning_rules.team_owner_id IS
'Team owner (doctor) for team/program/patient scoped rules (v101).';

COMMIT;

NOTIFY pgrst, 'reload schema';

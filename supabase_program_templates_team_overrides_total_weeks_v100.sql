-- v100: team_program_overrides -> add total_weeks parity with global program_templates
-- This keeps team-scoped program cards consistent for "Toplam Hafta".

BEGIN;

ALTER TABLE public.team_program_overrides
ADD COLUMN IF NOT EXISTS total_weeks INTEGER NULL CHECK (total_weeks BETWEEN 1 AND 52);

CREATE INDEX IF NOT EXISTS idx_team_program_overrides_total_weeks
ON public.team_program_overrides(total_weeks);

COMMENT ON COLUMN public.team_program_overrides.total_weeks IS
'Optional team-specific override for program_templates.total_weeks (v100).';

COMMIT;

NOTIFY pgrst, 'reload schema';

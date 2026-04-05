-- v105: program-scoped diet type overrides
-- Goal:
-- Add a dedicated "program" layer for diet type parameters so changes can be
-- scoped per program (and per team context), without mutating global/team rows.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.program_diet_type_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_owner_id UUID NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    program_template_id UUID NOT NULL REFERENCES public.program_templates(id) ON DELETE CASCADE,
    base_diet_type_id UUID NOT NULL REFERENCES public.diet_types(id) ON DELETE CASCADE,
    name TEXT NULL,
    abbreviation TEXT NULL,
    description TEXT NULL,
    carb_factor NUMERIC NULL,
    protein_factor NUMERIC NULL,
    fat_factor NUMERIC NULL,
    allowed_tags TEXT[] NULL,
    banned_keywords TEXT[] NULL,
    banned_tags TEXT[] NULL,
    banned_details JSONB NULL,
    created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_diet_type_overrides_team_notnull
ON public.program_diet_type_overrides(team_owner_id, program_template_id, base_diet_type_id)
WHERE team_owner_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_program_diet_type_overrides_team_null
ON public.program_diet_type_overrides(program_template_id, base_diet_type_id)
WHERE team_owner_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_program_diet_type_overrides_program
ON public.program_diet_type_overrides(program_template_id);

CREATE INDEX IF NOT EXISTS idx_program_diet_type_overrides_team
ON public.program_diet_type_overrides(team_owner_id);

CREATE INDEX IF NOT EXISTS idx_program_diet_type_overrides_base
ON public.program_diet_type_overrides(base_diet_type_id);

CREATE OR REPLACE FUNCTION public.set_program_diet_type_overrides_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.program_diet_type_overrides') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS trg_program_diet_type_overrides_updated_at ON public.program_diet_type_overrides';
    END IF;
END $$;

CREATE TRIGGER trg_program_diet_type_overrides_updated_at
BEFORE UPDATE ON public.program_diet_type_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_program_diet_type_overrides_updated_at();

ALTER TABLE public.program_diet_type_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Program Diet Type Overrides Select v105" ON public.program_diet_type_overrides;
DROP POLICY IF EXISTS "Program Diet Type Overrides Insert v105" ON public.program_diet_type_overrides;
DROP POLICY IF EXISTS "Program Diet Type Overrides Update v105" ON public.program_diet_type_overrides;
DROP POLICY IF EXISTS "Program Diet Type Overrides Delete v105" ON public.program_diet_type_overrides;

CREATE POLICY "Program Diet Type Overrides Select v105"
ON public.program_diet_type_overrides
FOR SELECT TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Program Diet Type Overrides Insert v105"
ON public.program_diet_type_overrides
FOR INSERT TO authenticated
WITH CHECK (
    public.is_current_user_in_team(team_owner_id)
    AND created_by = auth.uid()
);

CREATE POLICY "Program Diet Type Overrides Update v105"
ON public.program_diet_type_overrides
FOR UPDATE TO authenticated
USING (public.is_current_user_in_team(team_owner_id))
WITH CHECK (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Program Diet Type Overrides Delete v105"
ON public.program_diet_type_overrides
FOR DELETE TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

COMMENT ON TABLE public.program_diet_type_overrides IS
'Program-scoped overrides for diet types (supports team-aware program layer) (v105).';

COMMIT;

NOTIFY pgrst, 'reload schema';

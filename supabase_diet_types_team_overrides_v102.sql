-- v102: team-scoped diet type overrides
-- Goal:
-- Keep global diet_types immutable while allowing doctor-team specific
-- overrides (name, macros, tags, bans) without impacting global records.

BEGIN;

CREATE TABLE IF NOT EXISTS public.team_diet_type_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_owner_id, base_diet_type_id)
);

CREATE INDEX IF NOT EXISTS idx_team_diet_type_overrides_team_owner
ON public.team_diet_type_overrides(team_owner_id);

CREATE INDEX IF NOT EXISTS idx_team_diet_type_overrides_base
ON public.team_diet_type_overrides(base_diet_type_id);

CREATE INDEX IF NOT EXISTS idx_team_diet_type_overrides_team_updated
ON public.team_diet_type_overrides(team_owner_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_team_diet_type_overrides_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_diet_type_overrides_updated_at ON public.team_diet_type_overrides;
CREATE TRIGGER trg_team_diet_type_overrides_updated_at
BEFORE UPDATE ON public.team_diet_type_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_team_diet_type_overrides_updated_at();

ALTER TABLE public.team_diet_type_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team Diet Type Overrides Select v102" ON public.team_diet_type_overrides;
DROP POLICY IF EXISTS "Team Diet Type Overrides Insert v102" ON public.team_diet_type_overrides;
DROP POLICY IF EXISTS "Team Diet Type Overrides Update v102" ON public.team_diet_type_overrides;
DROP POLICY IF EXISTS "Team Diet Type Overrides Delete v102" ON public.team_diet_type_overrides;

CREATE POLICY "Team Diet Type Overrides Select v102"
ON public.team_diet_type_overrides
FOR SELECT TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Team Diet Type Overrides Insert v102"
ON public.team_diet_type_overrides
FOR INSERT TO authenticated
WITH CHECK (
    public.is_current_user_in_team(team_owner_id)
    AND created_by = auth.uid()
);

CREATE POLICY "Team Diet Type Overrides Update v102"
ON public.team_diet_type_overrides
FOR UPDATE TO authenticated
USING (public.is_current_user_in_team(team_owner_id))
WITH CHECK (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Team Diet Type Overrides Delete v102"
ON public.team_diet_type_overrides
FOR DELETE TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

COMMENT ON TABLE public.team_diet_type_overrides IS
'Team-scoped overrides for global diet types (v102).';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- v104: Team-scoped food micronutrient overrides
-- Goal:
-- Keep global food_micronutrients immutable while allowing team-specific
-- micronutrient mapping edits for foods.

BEGIN;

CREATE TABLE IF NOT EXISTS public.team_food_micronutrient_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    base_food_id UUID NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,
    micronutrient_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],

    created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(team_owner_id, base_food_id)
);

CREATE INDEX IF NOT EXISTS idx_team_food_micro_overrides_team_owner
ON public.team_food_micronutrient_overrides(team_owner_id);

CREATE INDEX IF NOT EXISTS idx_team_food_micro_overrides_base_food
ON public.team_food_micronutrient_overrides(base_food_id);

CREATE INDEX IF NOT EXISTS idx_team_food_micro_overrides_updated
ON public.team_food_micronutrient_overrides(team_owner_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_team_food_micro_overrides_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_food_micro_overrides_updated_at ON public.team_food_micronutrient_overrides;
CREATE TRIGGER trg_team_food_micro_overrides_updated_at
BEFORE UPDATE ON public.team_food_micronutrient_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_team_food_micro_overrides_updated_at();

ALTER TABLE public.team_food_micronutrient_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team Food Micro Overrides Select v104" ON public.team_food_micronutrient_overrides;
DROP POLICY IF EXISTS "Team Food Micro Overrides Insert v104" ON public.team_food_micronutrient_overrides;
DROP POLICY IF EXISTS "Team Food Micro Overrides Update v104" ON public.team_food_micronutrient_overrides;
DROP POLICY IF EXISTS "Team Food Micro Overrides Delete v104" ON public.team_food_micronutrient_overrides;

CREATE POLICY "Team Food Micro Overrides Select v104"
ON public.team_food_micronutrient_overrides
FOR SELECT TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Team Food Micro Overrides Insert v104"
ON public.team_food_micronutrient_overrides
FOR INSERT TO authenticated
WITH CHECK (
    public.is_current_user_in_team(team_owner_id)
    AND created_by = auth.uid()
);

CREATE POLICY "Team Food Micro Overrides Update v104"
ON public.team_food_micronutrient_overrides
FOR UPDATE TO authenticated
USING (public.is_current_user_in_team(team_owner_id))
WITH CHECK (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Team Food Micro Overrides Delete v104"
ON public.team_food_micronutrient_overrides
FOR DELETE TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

COMMENT ON TABLE public.team_food_micronutrient_overrides IS
'Team-scoped overrides for food micronutrient associations (v104).';

COMMIT;

NOTIFY pgrst, 'reload schema';

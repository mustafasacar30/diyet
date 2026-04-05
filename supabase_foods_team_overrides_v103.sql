-- v103: Team-scoped food overrides
-- Goal:
-- Keep global foods immutable while allowing team-level food edits
-- without affecting the base dataset.

BEGIN;

CREATE TABLE IF NOT EXISTS public.team_food_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    base_food_id UUID NOT NULL REFERENCES public.foods(id) ON DELETE CASCADE,

    name TEXT NULL,
    category TEXT NULL,
    role TEXT NULL,
    calories NUMERIC NULL,
    protein NUMERIC NULL,
    carbs NUMERIC NULL,
    fat NUMERIC NULL,
    portion_unit TEXT NULL,
    standard_amount NUMERIC NULL,
    tags TEXT[] NULL,
    meta JSONB NULL,
    min_quantity NUMERIC NULL,
    max_quantity NUMERIC NULL,
    step NUMERIC NULL,
    multiplier NUMERIC NULL,
    portion_fixed BOOLEAN NULL,
    keto BOOLEAN NULL,
    lowcarb BOOLEAN NULL,
    vegan BOOLEAN NULL,
    vejeteryan BOOLEAN NULL,
    elimination_diet BOOLEAN NULL,
    meal_types TEXT[] NULL,
    filler_lunch BOOLEAN NULL,
    filler_dinner BOOLEAN NULL,
    season_start INTEGER NULL,
    season_end INTEGER NULL,
    is_reversed_season BOOLEAN NULL,
    compatibility_tags TEXT[] NULL,
    incompatibility_tags TEXT[] NULL,
    notes TEXT NULL,
    diet_types TEXT[] NULL,
    diet_tags TEXT[] NULL,
    ingredients TEXT NULL,
    recipe_text TEXT NULL,
    source_url TEXT NULL,
    priority_score INTEGER NULL,
    min_weekly_freq INTEGER NULL,
    max_weekly_freq INTEGER NULL,
    hidden_from_cardmaker BOOLEAN NULL,

    created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(team_owner_id, base_food_id)
);

CREATE INDEX IF NOT EXISTS idx_team_food_overrides_team_owner
ON public.team_food_overrides(team_owner_id);

CREATE INDEX IF NOT EXISTS idx_team_food_overrides_base_food
ON public.team_food_overrides(base_food_id);

CREATE INDEX IF NOT EXISTS idx_team_food_overrides_team_updated
ON public.team_food_overrides(team_owner_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_team_food_overrides_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_food_overrides_updated_at ON public.team_food_overrides;
CREATE TRIGGER trg_team_food_overrides_updated_at
BEFORE UPDATE ON public.team_food_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_team_food_overrides_updated_at();

ALTER TABLE public.team_food_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team Food Overrides Select v103" ON public.team_food_overrides;
DROP POLICY IF EXISTS "Team Food Overrides Insert v103" ON public.team_food_overrides;
DROP POLICY IF EXISTS "Team Food Overrides Update v103" ON public.team_food_overrides;
DROP POLICY IF EXISTS "Team Food Overrides Delete v103" ON public.team_food_overrides;

CREATE POLICY "Team Food Overrides Select v103"
ON public.team_food_overrides
FOR SELECT TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Team Food Overrides Insert v103"
ON public.team_food_overrides
FOR INSERT TO authenticated
WITH CHECK (
    public.is_current_user_in_team(team_owner_id)
    AND created_by = auth.uid()
);

CREATE POLICY "Team Food Overrides Update v103"
ON public.team_food_overrides
FOR UPDATE TO authenticated
USING (public.is_current_user_in_team(team_owner_id))
WITH CHECK (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Team Food Overrides Delete v103"
ON public.team_food_overrides
FOR DELETE TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

COMMENT ON TABLE public.team_food_overrides IS
'Team-scoped overrides for global foods (v103).';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- v99: Team-scoped program template overrides
-- Adds team-level override tables for:
-- - program template metadata (name/description/default activity/is_active)
-- - week -> diet type mappings
-- - program restrictions
--
-- Goal:
-- Keep global program templates as the source of truth while allowing
-- each doctor team to override behavior without affecting global data.

BEGIN;

-- -------------------------------------------------------------------
-- 1) Core override table (one row per team + base program template)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_program_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    program_template_id UUID NOT NULL REFERENCES public.program_templates(id) ON DELETE CASCADE,
    name TEXT NULL,
    description TEXT NULL,
    default_activity_level INTEGER NULL CHECK (default_activity_level BETWEEN 1 AND 5),
    is_active BOOLEAN NULL,
    created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(team_owner_id, program_template_id)
);

CREATE INDEX IF NOT EXISTS idx_team_program_overrides_team_owner
    ON public.team_program_overrides(team_owner_id);

CREATE INDEX IF NOT EXISTS idx_team_program_overrides_program
    ON public.team_program_overrides(program_template_id);

CREATE INDEX IF NOT EXISTS idx_team_program_overrides_team_updated
    ON public.team_program_overrides(team_owner_id, updated_at DESC);

-- -------------------------------------------------------------------
-- 2) Week mapping overrides (override table owns full week mappings)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_program_override_weeks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    override_id UUID NOT NULL REFERENCES public.team_program_overrides(id) ON DELETE CASCADE,
    week_start INTEGER NOT NULL,
    week_end INTEGER NOT NULL,
    diet_type_id UUID NULL REFERENCES public.diet_types(id) ON DELETE SET NULL,
    notes TEXT NULL,
    UNIQUE(override_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_team_program_override_weeks_override
    ON public.team_program_override_weeks(override_id);

-- -------------------------------------------------------------------
-- 3) Restriction overrides (override table owns full restriction set)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_program_override_restrictions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    override_id UUID NOT NULL REFERENCES public.team_program_overrides(id) ON DELETE CASCADE,
    restriction_type TEXT NOT NULL CHECK (restriction_type IN ('keyword', 'tag', 'food_id')),
    restriction_value TEXT NOT NULL,
    reason TEXT NULL,
    severity TEXT NOT NULL DEFAULT 'warn' CHECK (severity IN ('warn', 'block'))
);

CREATE INDEX IF NOT EXISTS idx_team_program_override_restrictions_override
    ON public.team_program_override_restrictions(override_id);

-- -------------------------------------------------------------------
-- 4) Utility function: check if current user belongs to team context
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_current_user_in_team(target_team_owner UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    curr_uid UUID := auth.uid();
    curr_role TEXT := auth.jwt() -> 'user_metadata' ->> 'role';
    curr_global BOOLEAN := COALESCE((auth.jwt() -> 'user_metadata' ->> 'is_global_access')::BOOLEAN, FALSE);
BEGIN
    IF curr_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    IF curr_role = 'admin' OR curr_global THEN
        RETURN TRUE;
    END IF;

    IF curr_uid = target_team_owner THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.team_members tm
        WHERE tm.member_id = curr_uid
          AND tm.supervisor_id = target_team_owner
          AND tm.status = 'active'
    );
END;
$$;

-- -------------------------------------------------------------------
-- 5) updated_at trigger for core override row
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_team_program_overrides_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_program_overrides_updated_at ON public.team_program_overrides;
CREATE TRIGGER trg_team_program_overrides_updated_at
BEFORE UPDATE ON public.team_program_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_team_program_overrides_updated_at();

-- -------------------------------------------------------------------
-- 6) RLS policies
-- -------------------------------------------------------------------
ALTER TABLE public.team_program_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_program_override_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_program_override_restrictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team Program Overrides Select v99" ON public.team_program_overrides;
DROP POLICY IF EXISTS "Team Program Overrides Insert v99" ON public.team_program_overrides;
DROP POLICY IF EXISTS "Team Program Overrides Update v99" ON public.team_program_overrides;
DROP POLICY IF EXISTS "Team Program Overrides Delete v99" ON public.team_program_overrides;

CREATE POLICY "Team Program Overrides Select v99"
ON public.team_program_overrides
FOR SELECT TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Team Program Overrides Insert v99"
ON public.team_program_overrides
FOR INSERT TO authenticated
WITH CHECK (
    public.is_current_user_in_team(team_owner_id)
    AND created_by = auth.uid()
);

CREATE POLICY "Team Program Overrides Update v99"
ON public.team_program_overrides
FOR UPDATE TO authenticated
USING (public.is_current_user_in_team(team_owner_id))
WITH CHECK (public.is_current_user_in_team(team_owner_id));

CREATE POLICY "Team Program Overrides Delete v99"
ON public.team_program_overrides
FOR DELETE TO authenticated
USING (public.is_current_user_in_team(team_owner_id));

DROP POLICY IF EXISTS "Team Program Override Weeks Select v99" ON public.team_program_override_weeks;
DROP POLICY IF EXISTS "Team Program Override Weeks Insert v99" ON public.team_program_override_weeks;
DROP POLICY IF EXISTS "Team Program Override Weeks Update v99" ON public.team_program_override_weeks;
DROP POLICY IF EXISTS "Team Program Override Weeks Delete v99" ON public.team_program_override_weeks;

CREATE POLICY "Team Program Override Weeks Select v99"
ON public.team_program_override_weeks
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
);

CREATE POLICY "Team Program Override Weeks Insert v99"
ON public.team_program_override_weeks
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
);

CREATE POLICY "Team Program Override Weeks Update v99"
ON public.team_program_override_weeks
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
);

CREATE POLICY "Team Program Override Weeks Delete v99"
ON public.team_program_override_weeks
FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
);

DROP POLICY IF EXISTS "Team Program Override Restrictions Select v99" ON public.team_program_override_restrictions;
DROP POLICY IF EXISTS "Team Program Override Restrictions Insert v99" ON public.team_program_override_restrictions;
DROP POLICY IF EXISTS "Team Program Override Restrictions Update v99" ON public.team_program_override_restrictions;
DROP POLICY IF EXISTS "Team Program Override Restrictions Delete v99" ON public.team_program_override_restrictions;

CREATE POLICY "Team Program Override Restrictions Select v99"
ON public.team_program_override_restrictions
FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
);

CREATE POLICY "Team Program Override Restrictions Insert v99"
ON public.team_program_override_restrictions
FOR INSERT TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
);

CREATE POLICY "Team Program Override Restrictions Update v99"
ON public.team_program_override_restrictions
FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
);

CREATE POLICY "Team Program Override Restrictions Delete v99"
ON public.team_program_override_restrictions
FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.team_program_overrides o
        WHERE o.id = override_id
          AND public.is_current_user_in_team(o.team_owner_id)
    )
);

COMMENT ON TABLE public.team_program_overrides IS
'Team-scoped overrides for global program templates (v99).';

COMMENT ON TABLE public.team_program_override_weeks IS
'Team override week mappings for program templates (v99).';

COMMENT ON TABLE public.team_program_override_restrictions IS
'Team override restrictions for program templates (v99).';

COMMIT;

NOTIFY pgrst, 'reload schema';

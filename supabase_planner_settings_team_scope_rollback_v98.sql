-- v98 rollback helper for planner_settings team scope rollout.
-- This script does not drop the column to avoid irreversible data loss.
-- It only restores scope check and clears team_owner_id where needed.

BEGIN;

-- Optional: clear team_owner_id if you want to fully stop using team-scoped rows.
-- UPDATE public.planner_settings SET team_owner_id = NULL WHERE scope IN ('team', 'program', 'patient');

ALTER TABLE public.planner_settings DROP CONSTRAINT IF EXISTS planner_settings_scope_check;
ALTER TABLE public.planner_settings
ADD CONSTRAINT planner_settings_scope_check
CHECK (scope IS NULL OR scope IN ('global', 'program', 'patient'));

-- If you enabled team scope rows and need strict rollback,
-- convert team rows to global fallback before tightening app logic.
-- Example (disabled):
-- UPDATE public.planner_settings
-- SET scope = 'global'
-- WHERE scope = 'team';

COMMIT;

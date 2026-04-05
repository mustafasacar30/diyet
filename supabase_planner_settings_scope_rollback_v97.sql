-- v97 rollback: restore planner_settings from checkpoint table.
-- IMPORTANT: Run only after checkpoint script has been executed.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.planner_settings_scope_checkpoint_v97') IS NULL THEN
        RAISE EXCEPTION 'Checkpoint table public.planner_settings_scope_checkpoint_v97 does not exist. Run checkpoint first.';
    END IF;
END $$;

-- Keep a safety copy of current state before restoring old rows.
CREATE TABLE IF NOT EXISTS planner_settings_scope_before_rollback_v97 AS
SELECT * FROM planner_settings WHERE 1 = 0;

TRUNCATE TABLE planner_settings_scope_before_rollback_v97;

INSERT INTO planner_settings_scope_before_rollback_v97
SELECT *
FROM planner_settings;

TRUNCATE TABLE planner_settings;

INSERT INTO planner_settings
SELECT *
FROM planner_settings_scope_checkpoint_v97;

COMMIT;

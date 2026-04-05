-- v97: planner_settings checkpoint before team-layer rollout
-- Run this once before applying major scope/inheritance changes.

BEGIN;

CREATE TABLE IF NOT EXISTS planner_settings_scope_checkpoint_v97 AS
SELECT * FROM planner_settings WHERE 1 = 0;

TRUNCATE TABLE planner_settings_scope_checkpoint_v97;

INSERT INTO planner_settings_scope_checkpoint_v97
SELECT *
FROM planner_settings;

COMMENT ON TABLE planner_settings_scope_checkpoint_v97 IS
'Checkpoint for planner_settings before team-layer changes (2026-04-02).';

COMMIT;

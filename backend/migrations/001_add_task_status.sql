-- Migration 001: Replace completed boolean with status field
-- Status values: 'planned', 'in_progress', 'done'

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'planned';

UPDATE tasks SET status = CASE WHEN completed = true THEN 'done' ELSE 'planned' END
WHERE status = 'planned' AND completed IS NOT NULL;

ALTER TABLE tasks DROP COLUMN IF EXISTS completed;

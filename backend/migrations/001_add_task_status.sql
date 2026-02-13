-- Migration 001: Replace completed boolean with status field
-- Status values: 'planned', 'in_progress', 'done'

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'planned';

-- Update only if the old 'completed' column exists (legacy data migration)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'completed'
  ) THEN
    UPDATE tasks SET status = CASE WHEN completed = true THEN 'done' ELSE 'planned' END
    WHERE status = 'planned' AND completed IS NOT NULL;
  END IF;
END $$;

ALTER TABLE tasks DROP COLUMN IF EXISTS completed;

-- Migration 004: Extend task model for task tracker v2
-- New fields: description, priority, due_at, all_day, completed_at, deleted_at
-- New statuses: backlog, canceled, archived (added to existing planned, in_progress, done)

-- Add new columns
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS all_day BOOLEAN DEFAULT true;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Update status column to allow new values (no constraint change needed,
-- validation happens in application layer)

-- Set completed_at for existing done tasks
UPDATE tasks SET completed_at = NOW() WHERE status = 'done' AND completed_at IS NULL;

-- Create index for soft delete queries (most queries filter by deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks (deleted_at);

-- Create index for due_at queries (sorting/filtering by deadline)
CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks (due_at);

-- Create index for priority queries
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority);

-- Recurrence rules for repeating tasks
CREATE TABLE IF NOT EXISTS recurrence_rules (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  frequency VARCHAR(10) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval INTEGER NOT NULL DEFAULT 1,
  days_of_week INTEGER[] DEFAULT NULL,
  end_date DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Link generated instances back to the original task
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

-- Index for quick lookup of parent task instances
CREATE INDEX IF NOT EXISTS idx_tasks_recurrence ON tasks(recurrence_id) WHERE recurrence_id IS NOT NULL;

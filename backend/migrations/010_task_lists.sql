-- Migration 010: Task lists (projects)
-- Allows grouping tasks into lists/projects within a family

CREATE TABLE IF NOT EXISTS task_lists (
  id SERIAL PRIMARY KEY,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  color VARCHAR(7) NOT NULL DEFAULT '#6c5ce7',
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add list_id to tasks (nullable — tasks can exist without a list)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS list_id INTEGER REFERENCES task_lists(id) ON DELETE SET NULL;

-- File attachments for tasks
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  filename VARCHAR(255) NOT NULL,
  filepath TEXT NOT NULL,
  mimetype VARCHAR(100) NOT NULL,
  size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for quick lookup by task
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);

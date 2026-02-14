-- Migration 006: Tags system
-- Tags belong to a family and can be attached to tasks (many-to-many)

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#6c5ce7',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(family_id, name)
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

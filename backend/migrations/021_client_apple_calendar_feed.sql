-- Per-client Apple Calendar feed tokens (strictly scoped to one master+client pair)
CREATE TABLE IF NOT EXISTS client_calendar_feeds (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(128) NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(master_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_calendar_feeds_master_client
  ON client_calendar_feeds(master_id, client_id);

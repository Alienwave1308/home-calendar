-- Migration 016: Master personal blocks (busy time)
-- Masters can manually block time slots (lunch, personal, etc.)

CREATE TABLE IF NOT EXISTS master_blocks (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  title VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_block_range CHECK (start_at < end_at)
);

CREATE INDEX IF NOT EXISTS idx_master_blocks_time ON master_blocks(master_id, start_at, end_at);

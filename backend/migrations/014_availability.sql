-- Migration 014: Availability rules and exclusions
-- Masters define working hours per day of week and exclusion dates

CREATE TABLE IF NOT EXISTS availability_rules (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_granularity_minutes INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_time_range CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_master ON availability_rules(master_id);

CREATE TABLE IF NOT EXISTS availability_exclusions (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exclusions_master_date ON availability_exclusions(master_id, date);

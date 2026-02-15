-- Migration 015: Bookings (client appointments)
-- Core table for the booking system with atomic slot reservation

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'canceled', 'completed', 'no_show')),
  source VARCHAR(20) NOT NULL DEFAULT 'telegram_link'
    CHECK (source IN ('telegram_link', 'admin_created')),
  client_note TEXT,
  master_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_booking_range CHECK (start_at < end_at)
);

-- Index for overlap checks and calendar queries
CREATE INDEX IF NOT EXISTS idx_bookings_master_time ON bookings(master_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(master_id, status);

-- Exclusion constraint to prevent overlapping confirmed bookings for the same master
-- Only applies to non-canceled bookings
-- Note: requires btree_gist extension
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE bookings ADD CONSTRAINT no_overlapping_bookings
  EXCLUDE USING gist (
    master_id WITH =,
    tstzrange(start_at, end_at, '()') WITH &&
  ) WHERE (status NOT IN ('canceled'));

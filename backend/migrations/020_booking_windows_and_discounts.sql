-- Migration 020: Date-based availability windows and pricing settings

CREATE TABLE IF NOT EXISTS availability_windows (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(master_id, date, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS idx_availability_windows_master_date
  ON availability_windows(master_id, date);

ALTER TABLE master_settings
  ADD COLUMN IF NOT EXISTS first_visit_discount_percent INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS min_booking_notice_minutes INTEGER NOT NULL DEFAULT 60;

UPDATE master_settings
SET first_visit_discount_percent = 15
WHERE first_visit_discount_percent IS NULL;

UPDATE master_settings
SET min_booking_notice_minutes = 60
WHERE min_booking_notice_minutes IS NULL;

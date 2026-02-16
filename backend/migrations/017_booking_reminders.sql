-- Migration 017: Booking reminders and master settings
-- Automated reminders before appointments + master notification preferences

CREATE TABLE IF NOT EXISTS booking_reminders (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  remind_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_pending ON booking_reminders(remind_at) WHERE sent = false;

CREATE TABLE IF NOT EXISTS master_settings (
  master_id INTEGER PRIMARY KEY REFERENCES masters(id) ON DELETE CASCADE,
  reminder_hours JSONB NOT NULL DEFAULT '[24, 2]',
  quiet_hours_start TIME,
  quiet_hours_end TIME
);

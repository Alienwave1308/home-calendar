-- Migration 012: Master profiles for booking system
-- Each user can become a master (service provider) with their own calendar

CREATE TABLE IF NOT EXISTS masters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(100) NOT NULL,
  timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/Moscow',
  booking_slug VARCHAR(20) NOT NULL UNIQUE,
  cancel_policy_hours INTEGER NOT NULL DEFAULT 24,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_masters_slug ON masters(booking_slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_masters_user ON masters(user_id);

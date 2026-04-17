-- Migration 033: Web booking confirmation support
-- Adds pending_confirmation status, web source, and confirm token for web bookings

ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check,
  ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'confirmed', 'canceled', 'completed', 'no_show', 'pending_confirmation'));

ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_source_check,
  ADD CONSTRAINT bookings_source_check
    CHECK (source IN ('telegram_link', 'admin_created', 'vk', 'web'));

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS web_confirm_token VARCHAR(64),
  ADD COLUMN IF NOT EXISTS web_contact_channel VARCHAR(10)
    CHECK (web_contact_channel IN ('vk', 'tg'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_web_confirm_token
  ON bookings(web_confirm_token)
  WHERE web_confirm_token IS NOT NULL;

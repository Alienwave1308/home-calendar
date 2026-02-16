-- Migration 019: Apple Calendar feed settings for master
-- Allows secure subscription to booking feed via .ics URL

ALTER TABLE master_settings
  ADD COLUMN IF NOT EXISTS apple_calendar_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS apple_calendar_token VARCHAR(128);

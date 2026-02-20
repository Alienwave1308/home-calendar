-- Migration 022: Multi-service bookings
-- Adds extra_service_ids column to store additional services selected during booking.
-- The primary service_id remains as the "first" service for backward compat.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS extra_service_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN bookings.extra_service_ids IS
  'Array of additional service IDs when client books multiple zones in one appointment. Primary service_id stays as the first selected service.';

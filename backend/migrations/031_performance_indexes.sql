-- Performance indexes for common query patterns

-- tasks: filter by user + soft-delete, sort by created_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_user_deleted
  ON tasks (user_id, deleted_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_user_status
  ON tasks (user_id, status)
  WHERE deleted_at IS NULL;

-- bookings: filter by master + status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_master_status
  ON bookings (master_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_master_start
  ON bookings (master_id, start_at);

-- booking_reminders: find pending reminders efficiently
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_reminders_pending
  ON booking_reminders (sent, remind_at)
  WHERE sent = false;

-- family_members: lookup by family
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_members_family
  ON family_members (family_id);

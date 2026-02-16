-- WARNING:
-- This script fully clears application business data.
-- Use only before the first production launch of the TG Mini App.

BEGIN;

TRUNCATE TABLE
  external_event_mappings,
  calendar_sync_bindings,
  booking_reminders,
  bookings,
  master_blocks,
  availability_exclusions,
  availability_rules,
  services,
  master_settings,
  masters,
  attachments,
  comments,
  checklist_items,
  task_assignments,
  task_tags,
  tags,
  task_lists,
  recurrence_rules,
  shopping_items,
  notifications,
  notification_settings,
  audit_events,
  tasks,
  family_members,
  families,
  password_reset_tokens,
  users
RESTART IDENTITY CASCADE;

COMMIT;

-- Retention policy: permanently delete soft-deleted tasks older than 1 year.
-- This function is called periodically by the reminder worker.
CREATE OR REPLACE FUNCTION cleanup_old_deleted_tasks()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM tasks
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - INTERVAL '1 year';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

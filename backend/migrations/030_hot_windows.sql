-- Migration 030: Hot windows — time slots with automatic discounts

CREATE TABLE IF NOT EXISTS hot_windows (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  reward_type VARCHAR(20) NOT NULL
    CHECK (reward_type IN ('percent', 'gift_service')),
  discount_percent INTEGER,
  gift_service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT hot_windows_reward_check CHECK (
    (reward_type = 'percent' AND discount_percent BETWEEN 1 AND 90 AND gift_service_id IS NULL)
    OR
    (reward_type = 'gift_service' AND gift_service_id IS NOT NULL AND discount_percent IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_hot_windows_master_date
  ON hot_windows(master_id, date);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'hot_window_id'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN hot_window_id INTEGER REFERENCES hot_windows(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'hot_window_reward_type'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN hot_window_reward_type VARCHAR(20);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'hot_window_discount_percent'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN hot_window_discount_percent INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'hot_window_gift_service_id'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN hot_window_gift_service_id INTEGER REFERENCES services(id) ON DELETE SET NULL;
  END IF;
END $$;

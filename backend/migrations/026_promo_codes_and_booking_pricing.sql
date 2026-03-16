-- Migration 026: Promo codes and booking pricing snapshots

CREATE TABLE IF NOT EXISTS master_promo_codes (
  id SERIAL PRIMARY KEY,
  master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  code VARCHAR(64) NOT NULL,
  reward_type VARCHAR(20) NOT NULL
    CHECK (reward_type IN ('percent', 'gift_service')),
  discount_percent INTEGER,
  gift_service_id INTEGER REFERENCES services(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT master_promo_codes_master_code_unique UNIQUE (master_id, code),
  CONSTRAINT master_promo_codes_reward_check CHECK (
    (reward_type = 'percent' AND discount_percent BETWEEN 1 AND 90 AND gift_service_id IS NULL)
    OR
    (reward_type = 'gift_service' AND gift_service_id IS NOT NULL AND discount_percent IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_master_promo_codes_master
  ON master_promo_codes(master_id);

CREATE INDEX IF NOT EXISTS idx_master_promo_codes_master_active
  ON master_promo_codes(master_id, is_active);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'promo_code_id'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN promo_code_id INTEGER REFERENCES master_promo_codes(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'promo_code'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN promo_code VARCHAR(64);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'promo_reward_type'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN promo_reward_type VARCHAR(20);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'promo_discount_percent'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN promo_discount_percent INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'promo_gift_service_id'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN promo_gift_service_id INTEGER REFERENCES services(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'pricing_base'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN pricing_base NUMERIC(10, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'pricing_final'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN pricing_final NUMERIC(10, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
      AND column_name = 'pricing_discount_amount'
  ) THEN
    ALTER TABLE bookings
      ADD COLUMN pricing_discount_amount NUMERIC(10, 2);
  END IF;
END $$;

UPDATE bookings b
SET
  pricing_base = COALESCE(b.pricing_base, s.price),
  pricing_final = COALESCE(b.pricing_final, s.price),
  pricing_discount_amount = COALESCE(b.pricing_discount_amount, 0)
FROM services s
WHERE s.id = b.service_id;

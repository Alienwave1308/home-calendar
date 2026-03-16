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

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS promo_code_id INTEGER REFERENCES master_promo_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promo_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS promo_reward_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS promo_discount_percent INTEGER,
  ADD COLUMN IF NOT EXISTS promo_gift_service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pricing_base NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS pricing_final NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS pricing_discount_amount NUMERIC(10, 2);

UPDATE bookings b
SET
  pricing_base = COALESCE(b.pricing_base, s.price),
  pricing_final = COALESCE(b.pricing_final, s.price),
  pricing_discount_amount = COALESCE(b.pricing_discount_amount, 0)
FROM services s
WHERE s.id = b.service_id;

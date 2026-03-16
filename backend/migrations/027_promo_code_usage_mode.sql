ALTER TABLE master_promo_codes
  ADD COLUMN IF NOT EXISTS usage_mode VARCHAR(20) NOT NULL DEFAULT 'always';

ALTER TABLE master_promo_codes
  ADD COLUMN IF NOT EXISTS uses_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'master_promo_codes_usage_mode_check'
  ) THEN
    ALTER TABLE master_promo_codes
      ADD CONSTRAINT master_promo_codes_usage_mode_check
      CHECK (usage_mode IN ('always', 'single_use'));
  END IF;
END $$;

UPDATE master_promo_codes
SET usage_mode = 'always'
WHERE usage_mode IS NULL;

UPDATE master_promo_codes
SET uses_count = 0
WHERE uses_count IS NULL;

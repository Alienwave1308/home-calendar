DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'master_promo_codes'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'master_promo_codes'
        AND column_name = 'fixed_amount_rub'
    ) THEN
      ALTER TABLE master_promo_codes
        ADD COLUMN fixed_amount_rub INTEGER;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'master_promo_codes'
        AND column_name = 'gift_complex_discount_rub'
    ) THEN
      ALTER TABLE master_promo_codes
        ADD COLUMN gift_complex_discount_rub INTEGER;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'master_promo_codes_reward_check'
        AND conrelid = 'master_promo_codes'::regclass
    ) THEN
      ALTER TABLE master_promo_codes
        DROP CONSTRAINT master_promo_codes_reward_check;
    END IF;

    ALTER TABLE master_promo_codes
      ADD CONSTRAINT master_promo_codes_reward_check
      CHECK (
        (reward_type = 'percent'
          AND discount_percent BETWEEN 1 AND 100
          AND fixed_amount_rub IS NULL
          AND gift_complex_discount_rub IS NULL)
        OR
        (reward_type = 'gift_service'
          AND discount_percent IS NULL
          AND fixed_amount_rub IS NULL
          AND (gift_complex_discount_rub IS NULL OR gift_complex_discount_rub >= 0))
        OR
        (reward_type = 'fixed_amount'
          AND fixed_amount_rub >= 1
          AND discount_percent IS NULL
          AND gift_service_id IS NULL
          AND gift_complex_discount_rub IS NULL)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'bookings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'bookings'
        AND column_name = 'promo_fixed_amount_rub'
    ) THEN
      ALTER TABLE bookings
        ADD COLUMN promo_fixed_amount_rub INTEGER;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'bookings'
        AND column_name = 'promo_gift_complex_discount_rub'
    ) THEN
      ALTER TABLE bookings
        ADD COLUMN promo_gift_complex_discount_rub INTEGER;
    END IF;
  END IF;
END $$;

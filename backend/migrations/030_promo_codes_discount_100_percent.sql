DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'master_promo_codes'
  ) THEN
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
        (reward_type = 'percent' AND discount_percent BETWEEN 1 AND 100 AND gift_service_id IS NULL)
        OR
        (reward_type = 'gift_service' AND discount_percent IS NULL)
      );
  END IF;
END $$;

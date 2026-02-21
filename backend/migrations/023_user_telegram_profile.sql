ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_users_telegram_username
  ON users(telegram_username);

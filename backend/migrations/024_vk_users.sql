ALTER TABLE users ADD COLUMN IF NOT EXISTS vk_user_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_vk_user_id
  ON users(vk_user_id)
  WHERE vk_user_id IS NOT NULL;

-- Allow VK users to be created without a password
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

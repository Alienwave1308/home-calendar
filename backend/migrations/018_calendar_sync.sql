-- Calendar sync: OAuth bindings and external event mappings

CREATE TABLE IF NOT EXISTS calendar_sync_bindings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'google',
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expire_at TIMESTAMP,
  scope VARCHAR(255),
  external_calendar_id VARCHAR(255),
  sync_mode VARCHAR(10) NOT NULL DEFAULT 'push',
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS external_event_mappings (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL DEFAULT 'google',
  external_event_id VARCHAR(255) NOT NULL,
  last_pushed_hash VARCHAR(64),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (booking_id, provider)
);

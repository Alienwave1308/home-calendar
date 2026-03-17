const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

function quoteIdent(identifier) {
  return '"' + String(identifier).replace(/"/g, '""') + '"';
}

async function tableExists(tableName) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return Boolean(rows[0] && rows[0].exists);
}

async function columnExists(tableName, columnName) {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = $1
         AND column_name = $2
     ) AS exists`,
    [tableName, columnName]
  );
  return Boolean(rows[0] && rows[0].exists);
}

async function ensureColumn(tableName, columnName, definitionSql) {
  if (!(await tableExists(tableName))) return false;
  if (await columnExists(tableName, columnName)) return false;

  await pool.query(
    `ALTER TABLE ${quoteIdent(tableName)}
     ADD COLUMN ${quoteIdent(columnName)} ${definitionSql}`
  );
  console.log(`Schema compatibility: added ${tableName}.${columnName}`);
  return true;
}

async function ensureRuntimeSchemaCompatibility() {
  for (const [columnName, definition] of [
    ['display_name', `VARCHAR(100) NOT NULL DEFAULT 'Мастер'`],
    ['timezone', `VARCHAR(50) NOT NULL DEFAULT 'Asia/Novosibirsk'`],
    ['cancel_policy_hours', 'INTEGER NOT NULL DEFAULT 24'],
    ['brand_name', 'VARCHAR(120)'],
    ['brand_subtitle', 'VARCHAR(120)'],
    ['profile_name', 'VARCHAR(120)'],
    ['profile_role', 'VARCHAR(120)'],
    ['profile_city', 'VARCHAR(120)'],
    ['profile_experience', 'VARCHAR(120)'],
    ['profile_phone', 'VARCHAR(120)'],
    ['profile_address', 'VARCHAR(255)'],
    ['profile_bio', 'TEXT'],
    ['gift_text', 'VARCHAR(255)'],
    ['gift_url', 'VARCHAR(255)']
  ]) {
    try {
      await ensureColumn('masters', columnName, definition);
    } catch (error) {
      console.error(`Schema compatibility: failed to ensure masters.${columnName}:`, error);
    }
  }

  for (const [columnName, definition] of [
    ['description', 'TEXT'],
    ['buffer_before_minutes', 'INTEGER NOT NULL DEFAULT 0'],
    ['buffer_after_minutes', 'INTEGER NOT NULL DEFAULT 0'],
    ['is_active', 'BOOLEAN NOT NULL DEFAULT true'],
    ['created_at', 'TIMESTAMP DEFAULT NOW()']
  ]) {
    try {
      await ensureColumn('services', columnName, definition);
    } catch (error) {
      console.error(`Schema compatibility: failed to ensure services.${columnName}:`, error);
    }
  }

  try {
    await pool.query('UPDATE services SET is_active = true WHERE is_active IS NULL');
  } catch (error) {
    console.error('Schema compatibility: failed to backfill services.is_active:', error);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS master_settings (
        master_id INTEGER PRIMARY KEY REFERENCES masters(id) ON DELETE CASCADE,
        reminder_hours JSONB NOT NULL DEFAULT '[24, 2]',
        quiet_hours_start TIME,
        quiet_hours_end TIME
      )
    `);
  } catch (error) {
    console.error('Schema compatibility: failed to ensure master_settings table:', error);
  }

  for (const [columnName, definition] of [
    ['first_visit_discount_percent', 'INTEGER NOT NULL DEFAULT 15'],
    ['min_booking_notice_minutes', 'INTEGER NOT NULL DEFAULT 60'],
    ['apple_calendar_enabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['apple_calendar_token', 'VARCHAR(120)']
  ]) {
    try {
      await ensureColumn('master_settings', columnName, definition);
    } catch (error) {
      console.error(`Schema compatibility: failed to ensure master_settings.${columnName}:`, error);
    }
  }

  try {
    await pool.query(
      'UPDATE master_settings SET min_booking_notice_minutes = 60 WHERE min_booking_notice_minutes IS NULL'
    );
  } catch (error) {
    console.error('Schema compatibility: failed to backfill master_settings.min_booking_notice_minutes:', error);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS availability_rules (
        id SERIAL PRIMARY KEY,
        master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        slot_granularity_minutes INTEGER NOT NULL DEFAULT 30,
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT valid_rule_time CHECK (start_time < end_time)
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_availability_rules_master_day ON availability_rules(master_id, day_of_week)'
    );
  } catch (error) {
    console.error('Schema compatibility: failed to ensure availability rules schema:', error);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS availability_windows (
        id SERIAL PRIMARY KEY,
        master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(master_id, date, start_time, end_time)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_availability_windows_master_date
        ON availability_windows(master_id, date)
    `);
  } catch (error) {
    console.error('Schema compatibility: failed to ensure availability windows schema:', error);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS availability_exclusions (
        id SERIAL PRIMARY KEY,
        master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_exclusions_master_date
        ON availability_exclusions(master_id, date)
    `);
  } catch (error) {
    console.error('Schema compatibility: failed to ensure availability exclusions schema:', error);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS master_blocks (
        id SERIAL PRIMARY KEY,
        master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        title VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT valid_block_range CHECK (start_at < end_at)
      )
    `);
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_master_blocks_time ON master_blocks(master_id, start_at, end_at)'
    );
  } catch (error) {
    console.error('Schema compatibility: failed to ensure master_blocks schema:', error);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS master_promo_codes (
        id SERIAL PRIMARY KEY,
        master_id INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
        code VARCHAR(64) NOT NULL,
        reward_type VARCHAR(20) NOT NULL,
        discount_percent INTEGER,
        gift_service_id INTEGER REFERENCES services(id) ON DELETE RESTRICT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } catch (error) {
    console.error('Schema compatibility: failed to ensure master_promo_codes table:', error);
  }

  for (const [columnName, definition] of [
    ['usage_mode', `VARCHAR(20) NOT NULL DEFAULT 'always'`],
    ['uses_count', 'INTEGER NOT NULL DEFAULT 0']
  ]) {
    try {
      await ensureColumn('master_promo_codes', columnName, definition);
    } catch (error) {
      console.error(`Schema compatibility: failed to ensure master_promo_codes.${columnName}:`, error);
    }
  }

  try {
    await pool.query('UPDATE master_promo_codes SET usage_mode = $1 WHERE usage_mode IS NULL', ['always']);
    await pool.query('UPDATE master_promo_codes SET uses_count = 0 WHERE uses_count IS NULL');
    const constraintRes = await pool.query(
      `SELECT 1
       FROM pg_constraint
       WHERE conname = 'master_promo_codes_usage_mode_check'
       LIMIT 1`
    );
    if (!constraintRes.rows.length) {
      await pool.query(
        `ALTER TABLE master_promo_codes
         ADD CONSTRAINT master_promo_codes_usage_mode_check
         CHECK (usage_mode IN ('always', 'single_use'))`
      );
    }
  } catch (error) {
    console.error('Schema compatibility: failed to ensure promo usage mode constraint:', error);
  }

  try {
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS master_promo_codes_master_code_unique ON master_promo_codes(master_id, code)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_master_promo_codes_master ON master_promo_codes(master_id)'
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS idx_master_promo_codes_master_active ON master_promo_codes(master_id, is_active)'
    );
  } catch (error) {
    console.error('Schema compatibility: failed to ensure promo indexes:', error);
  }

  for (const [columnName, definition] of [
    ['promo_code_id', 'INTEGER REFERENCES master_promo_codes(id) ON DELETE SET NULL'],
    ['promo_code', 'VARCHAR(64)'],
    ['promo_reward_type', 'VARCHAR(20)'],
    ['promo_discount_percent', 'INTEGER'],
    ['promo_gift_service_id', 'INTEGER REFERENCES services(id) ON DELETE SET NULL'],
    ['pricing_base', 'NUMERIC(10, 2)'],
    ['pricing_final', 'NUMERIC(10, 2)'],
    ['pricing_discount_amount', 'NUMERIC(10, 2)']
  ]) {
    try {
      await ensureColumn('bookings', columnName, definition);
    } catch (error) {
      console.error(`Schema compatibility: failed to ensure bookings.${columnName}:`, error);
    }
  }

  try {
    await pool.query(
      `UPDATE bookings b
       SET
         pricing_base = COALESCE(b.pricing_base, s.price),
         pricing_final = COALESCE(b.pricing_final, s.price),
         pricing_discount_amount = COALESCE(b.pricing_discount_amount, 0)
       FROM services s
       WHERE s.id = b.service_id`
    );
  } catch (error) {
    console.error('Schema compatibility: failed to backfill booking pricing snapshots:', error);
  }
}

// Run pending SQL migrations from backend/migrations/
async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT id FROM migrations WHERE name = $1', [file]
    );

    if (rows.length === 0) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
      await pool.query(
        'INSERT INTO migrations (name) VALUES ($1)', [file]
      );
      console.log(`Migration applied: ${file}`);
    }
  }
}

async function initDB() {
  let migrationFailed = false;
  try {
    // Migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Tasks table (new schema for fresh installs)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        date VARCHAR(10) NOT NULL,
        status VARCHAR(20) DEFAULT 'planned'
      )
    `);

    await runMigrations();
    console.log('Database initialized: tasks table ready');
  } catch (error) {
    migrationFailed = true;
    console.error('Error initializing database:', error);
  }

  try {
    await ensureRuntimeSchemaCompatibility();
    if (migrationFailed) {
      console.log('Database initialized with compatibility fallback');
    }
  } catch (compatError) {
    console.error('Error ensuring runtime schema compatibility:', compatError);
  }
}

module.exports = { pool, initDB };

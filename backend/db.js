const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

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
    console.error('Error initializing database:', error);
  }
}

module.exports = { pool, initDB };

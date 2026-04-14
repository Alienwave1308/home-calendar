const { pool } = require('../db');

/**
 * Middleware: validates that the authenticated user has master access.
 * Master access is determined by:
 *   1. MASTER_TELEGRAM_USER_ID env var (explicit binding to a Telegram account), OR
 *   2. The first master record in the DB (first registered master)
 * Skipped in test environment.
 */
async function masterAuthFn(req, res, next) {
  if (process.env.NODE_ENV === 'test') return next();

  const masterTelegramId = String(process.env.MASTER_TELEGRAM_USER_ID || '').trim();
  if (masterTelegramId) {
    if (req.user.username !== `tg_${masterTelegramId}`) {
      return res.status(403).json({ error: 'Master access is restricted to configured Telegram account' });
    }
    return next();
  }

  try {
    const { rows } = await pool.query(
      'SELECT user_id FROM masters ORDER BY id ASC LIMIT 1'
    );
    if (rows.length === 0) {
      return res.status(503).json({ error: 'Master profile is not initialized yet' });
    }
    if (Number(rows[0].user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Master access is restricted to the first Telegram master account' });
    }
    return next();
  } catch (error) {
    console.error('Error validating master access:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = masterAuthFn;

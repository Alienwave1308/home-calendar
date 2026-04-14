const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const masterAuth = require('../middleware/masterAuth');
const { loadMaster } = require('./master-shared');
const asyncRoute = require('../lib/asyncRoute');
const { sendTelegramMessage, parseTelegramUserId } = require('../lib/telegram-notify');
const { BOOKING_STATUSES } = require('../lib/constants');

// All master routes require authentication + master access
router.use(authenticateToken);
router.use(masterAuth);

// ─── Misc ─────────────────────────────────────────────────────────────────────

// POST /api/master/test-notification — send a test Telegram message to the master
router.post('/test-notification', loadMaster, asyncRoute(async (req, res) => {
  const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [req.user.id]);
  const username = userRes.rows[0]?.username;
  const chatId = parseTelegramUserId(username);
  if (!chatId) {
    return res.status(400).json({ ok: false, reason: 'username_format', username: username || null });
  }
  const result = await sendTelegramMessage(chatId, '✅ Тестовое уведомление — бот работает корректно.');
  return res.json({ ok: result.ok, skipped: result.skipped, chatId, status: result.status, tgError: result.tgError });
}));

// ─── Sub-routers ──────────────────────────────────────────────────────────────

router.use(require('./master-setup'));
router.use(require('./master-services'));
router.use(require('./master-availability'));
router.use(require('./master-blocks'));
router.use(require('./master-settings'));
router.use(require('./master-bookings'));
router.use(require('./master-leads'));
router.use(require('./master-promo-codes'));
router.use(require('./master-hot-windows'));

module.exports = router;

// Re-export for backwards compat (used by tests and other modules)
module.exports.BOOKING_STATUSES = BOOKING_STATUSES;

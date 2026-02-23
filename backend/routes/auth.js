const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { URLSearchParams } = require('url');
const { Buffer } = require('buffer');
const { nanoid } = require('nanoid');
const router = express.Router();
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const TELEGRAM_ONLY_ERROR = 'Only Telegram Mini App authentication is allowed';

function buildToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function parseTelegramInitData(initData) {
  const params = new URLSearchParams(initData || '');
  const data = {};
  params.forEach((value, key) => {
    data[key] = value;
  });
  return data;
}

function isValidTelegramInitData(initData, botToken) {
  const parsed = parseTelegramInitData(initData);
  const receivedHash = parsed.hash;
  if (!receivedHash) return false;

  const checkEntries = Object.entries(parsed)
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);

  const dataCheckString = checkEntries.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const computedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  const computedBuffer = Buffer.from(computedHash, 'hex');
  const receivedBuffer = Buffer.from(receivedHash, 'hex');
  if (computedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(computedBuffer, receivedBuffer);
}

function isLegacyAuthAllowed() {
  return process.env.ALLOW_PASSWORD_AUTH === 'true' || process.env.NODE_ENV === 'test';
}

function rejectWhenTelegramOnly(req, res, next) {
  if (isLegacyAuthAllowed()) return next();
  return res.status(403).json({ error: TELEGRAM_ONLY_ERROR });
}

function getConfiguredMasterTelegramId() {
  const masterTelegramId = String(process.env.MASTER_TELEGRAM_USER_ID || '').trim();
  return masterTelegramId || null;
}

function resolveTelegramDisplayName(rawUser) {
  if (!rawUser || typeof rawUser !== 'object') return null;
  const firstName = String(rawUser.first_name || '').trim();
  const lastName = String(rawUser.last_name || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) return fullName;
  const tgUsername = String(rawUser.username || '').trim();
  if (tgUsername) return `@${tgUsername}`;
  return null;
}

async function syncTelegramUserProfile(userId, rawUser) {
  if (!userId || !rawUser) return;
  const displayName = resolveTelegramDisplayName(rawUser);
  const avatarUrl = typeof rawUser.photo_url === 'string' ? rawUser.photo_url : null;
  const telegramUsername = typeof rawUser.username === 'string' ? rawUser.username : null;

  await pool.query(
    `UPDATE users
     SET
       display_name = COALESCE($1, display_name),
       avatar_url = COALESCE($2, avatar_url),
       telegram_username = COALESCE($3, telegram_username)
     WHERE id = $4`,
    [displayName, avatarUrl, telegramUsername, userId]
  );
}

async function ensureMasterProfileForUser(user, rawUser) {
  const defaultTimezone = process.env.MASTER_TIMEZONE || 'Asia/Novosibirsk';
  const defaultDisplayName = process.env.MASTER_DISPLAY_NAME || rawUser?.first_name || rawUser?.username || 'Мастер';
  const masterByUser = await pool.query(
    'SELECT id, booking_slug FROM masters WHERE user_id = $1',
    [user.id]
  );

  if (masterByUser.rows.length > 0) {
    return masterByUser.rows[0];
  }

  const insertedMaster = await pool.query(
    `INSERT INTO masters (user_id, display_name, timezone, booking_slug)
     VALUES ($1, $2, $3, $4)
     RETURNING id, booking_slug`,
    [user.id, defaultDisplayName, defaultTimezone, nanoid(10)]
  );
  return insertedMaster.rows[0];
}

async function resolveRoleAndMaster(user, telegramId, rawUser) {
  const configuredMasterTelegramId = getConfiguredMasterTelegramId();

  if (configuredMasterTelegramId) {
    if (String(telegramId) === configuredMasterTelegramId) {
      const master = await ensureMasterProfileForUser(user, rawUser);
      return { role: 'master', master };
    }

    const configuredMaster = await pool.query(
      `SELECT m.id, m.booking_slug
       FROM masters m
       JOIN users u ON u.id = m.user_id
       WHERE u.username = $1`,
      [`tg_${configuredMasterTelegramId}`]
    );
    if (configuredMaster.rows.length > 0) {
      return { role: 'client', master: configuredMaster.rows[0] };
    }

    const firstMaster = await pool.query(
      'SELECT id, booking_slug FROM masters ORDER BY id ASC LIMIT 1'
    );
    return { role: 'client', master: firstMaster.rows[0] || null };
  }

  const masterByUser = await pool.query(
    'SELECT id, user_id, booking_slug FROM masters WHERE user_id = $1',
    [user.id]
  );
  if (masterByUser.rows.length > 0) {
    return { role: 'master', master: masterByUser.rows[0] };
  }

  const firstMaster = await pool.query(
    'SELECT id, user_id, booking_slug FROM masters ORDER BY id ASC LIMIT 1'
  );
  if (firstMaster.rows.length === 0) {
    const master = await ensureMasterProfileForUser(user, rawUser);
    return { role: 'master', master };
  }

  return { role: 'client', master: firstMaster.rows[0] };
}

router.post('/register', rejectWhenTelegramOnly);
router.post('/login', rejectWhenTelegramOnly);
router.post('/forgot-password', rejectWhenTelegramOnly);
router.post('/reset-password', rejectWhenTelegramOnly);

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if username already exists
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, passwordHash]
    );

    const user = result.rows[0];
    const token = buildToken(user);

    res.status(201).json({ user: { id: user.id, username: user.username }, token });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = buildToken(user);

    res.json({ user: { id: user.id, username: user.username }, token });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/forgot-password — generate reset token
router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (user.rows.length === 0) {
      return res.json({ message: 'If the user exists, a reset token has been generated' });
    }

    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false',
      [user.rows[0].id]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.rows[0].id, token, expiresAt]
    );

    res.json({ message: 'If the user exists, a reset token has been generated', token });
  } catch (error) {
    console.error('Error in forgot-password:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password — reset password using token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const tokenResult = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > NOW()',
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const resetToken = tokenResult.rows[0];

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, resetToken.user_id]
    );

    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE id = $1',
      [resetToken.id]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error in reset-password:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/telegram
router.post('/telegram', async (req, res) => {
  try {
    const { initData } = req.body;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!botToken) {
      return res.status(503).json({ error: 'Telegram auth is not configured' });
    }

    if (!initData || typeof initData !== 'string') {
      return res.status(400).json({ error: 'initData is required' });
    }

    if (!isValidTelegramInitData(initData, botToken)) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const parsed = parseTelegramInitData(initData);
    const authDate = Number(parsed.auth_date || 0);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!authDate || nowSeconds - authDate > 86400) {
      return res.status(401).json({ error: 'Telegram initData expired' });
    }

    const rawUser = parsed.user ? JSON.parse(parsed.user) : null;
    const telegramId = rawUser && rawUser.id ? String(rawUser.id) : null;
    if (!telegramId) {
      return res.status(400).json({ error: 'Telegram user payload is missing' });
    }

    const username = `tg_${telegramId}`;

    let userResult = await pool.query(
      'SELECT id, username FROM users WHERE username = $1',
      [username]
    );

    if (userResult.rows.length === 0) {
      const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
      userResult = await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
        [username, randomPasswordHash]
      );
    }

    const user = userResult.rows[0];
    await syncTelegramUserProfile(user.id, rawUser);
    const token = buildToken(user);
    const { role, master } = await resolveRoleAndMaster(user, telegramId, rawUser);

    res.json({
      user: { id: user.id, username: user.username },
      token,
      role,
      booking_slug: master ? master.booking_slug : null,
      master_id: master ? master.id : null
    });
  } catch (error) {
    console.error('Error in Telegram auth:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

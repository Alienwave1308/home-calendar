const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { URLSearchParams } = require('url');
const { Buffer } = require('buffer');
const router = express.Router();
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

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
    const token = buildToken(user);
    res.json({ user: { id: user.id, username: user.username }, token });
  } catch (error) {
    console.error('Error in Telegram auth:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { URL, URLSearchParams } = require('url');
const { Buffer } = require('buffer');
const { nanoid } = require('nanoid');
const router = express.Router();
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const asyncRoute = require('../lib/asyncRoute');
const { getWebBookingAvailability } = require('../lib/web-booking');
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
router.post('/register', asyncRoute(async (req, res) => {
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
}));

// POST /api/auth/login
router.post('/login', asyncRoute(async (req, res) => {
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
}));

// POST /api/auth/forgot-password — generate reset token
router.post('/forgot-password', asyncRoute(async (req, res) => {
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
}));

// POST /api/auth/reset-password — reset password using token
router.post('/reset-password', asyncRoute(async (req, res) => {
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
}));

// ─── VK Mini App auth ─────────────────────────────────────────────────────────

/**
 * Верифицировать подпись VK Mini App launch params.
 * paramsString — строка query params из URL (window.location.search).
 */
function isValidVkLaunchParams(paramsString, appSecret) {
  if (!paramsString || !appSecret) return false;

  const normalized = String(paramsString).trim().replace(/^[?#]/, '');
  if (!normalized) return false;

  const url = new URLSearchParams(normalized);
  const receivedSign = String(url.get('sign') || '').trim();
  if (!receivedSign) return false;

  const rawPairs = normalized
    .split('&')
    .filter(Boolean)
    .map((chunk) => {
      const idx = chunk.indexOf('=');
      if (idx === -1) return [chunk, ''];
      return [chunk.slice(0, idx), chunk.slice(idx + 1)];
    });

  const decodedPairs = [];
  url.forEach((value, key) => {
    if (key === 'sign') return;
    decodedPairs.push([key, value]);
  });

  const rawPairsWithoutSign = rawPairs.filter(([key]) => key !== 'sign');
  const rawVkPairs = rawPairsWithoutSign.filter(([key]) => key.startsWith('vk_'));
  const decodedVkPairs = decodedPairs.filter(([key]) => key.startsWith('vk_'));
  const encodedDecodedPairs = decodedPairs.map(([key, value]) => [key, encodeURIComponent(String(value))]);
  const encodedDecodedVkPairs = encodedDecodedPairs.filter(([key]) => key.startsWith('vk_'));

  const sortPairs = (pairs) => pairs.slice().sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) {
      if (aValue === bValue) return 0;
      return aValue < bValue ? -1 : 1;
    }
    return aKey < bKey ? -1 : 1;
  });

  const variants = new Set();
  const addVariants = (pairs) => {
    if (!pairs.length) return;
    variants.add(sortPairs(pairs).map(([k, v]) => `${k}=${v}`).join('&'));
    variants.add(pairs.map(([k, v]) => `${k}=${v}`).join('&'));
  };

  addVariants(rawVkPairs);
  addVariants(rawPairsWithoutSign);
  addVariants(decodedVkPairs);
  addVariants(decodedPairs);
  addVariants(encodedDecodedVkPairs);
  addVariants(encodedDecodedPairs);

  const decodeSignToDigest = (input) => {
    const raw = String(input || '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    try {
      const digest = Buffer.from(padded, 'base64');
      return digest.length ? digest : null;
    } catch {
      return null;
    }
  };

  const receivedDigest = decodeSignToDigest(receivedSign);
  if (!receivedDigest) return false;

  for (const checkString of variants) {
    if (!checkString) continue;
    const computedDigest = crypto
      .createHmac('sha256', appSecret)
      .update(checkString)
      .digest();

    if (computedDigest.length !== receivedDigest.length) continue;
    if (crypto.timingSafeEqual(computedDigest, receivedDigest)) {
      return true;
    }
  }
  return false;
}

function getVkMiniAppSecrets() {
  const rawValues = [
    process.env.VK_MINI_APP_SECRET,
    process.env.VK_APP_SECRET,
    process.env.VK_SECRET,
    process.env.VK_MINI_APP_SECRETS
  ];

  const unique = new Set();
  for (const raw of rawValues) {
    if (!raw) continue;
    const chunks = String(raw).split(/[\n,;]/g);
    for (const chunk of chunks) {
      const value = String(chunk || '').trim();
      if (value) unique.add(value);
    }
  }
  return Array.from(unique);
}

function isVkMiniUnverifiedFallbackEnabled() {
  return String(process.env.VK_MINI_ALLOW_UNVERIFIED || '').trim() === 'true';
}

// POST /api/auth/vk
router.post('/vk', asyncRoute(async (req, res) => {
  const { launchParams } = req.body;
  const appSecrets = getVkMiniAppSecrets();
  const allowUnverifiedFallback = isVkMiniUnverifiedFallbackEnabled();

  if (!appSecrets.length && !allowUnverifiedFallback) {
    return res.status(503).json({ error: 'VK auth is not configured' });
  }
  if (!launchParams || typeof launchParams !== 'string') {
    return res.status(400).json({ error: 'launchParams is required' });
  }
  const launchParamsMap = new URLSearchParams(String(launchParams).replace(/^[?#]/, ''));
  const expectedAppId = String(process.env.VK_APP_ID || '').trim();
  const launchAppId = String(launchParamsMap.get('vk_app_id') || '').trim();
  if (expectedAppId && launchAppId && launchAppId !== expectedAppId) {
    return res.status(401).json({
      error: 'VK launch params are from another app',
      expected_app_id: expectedAppId,
      launch_app_id: launchAppId
    });
  }

  const hasValidSignature = appSecrets.some((secret) => isValidVkLaunchParams(launchParams, secret));
  if (!hasValidSignature) {
    const vkUserIdRaw = String(launchParamsMap.get('vk_user_id') || '').trim();
    const vkTsRaw = String(launchParamsMap.get('vk_ts') || '').trim();
    const vkPlatform = String(launchParamsMap.get('vk_platform') || '').trim();
    const canUseUnverifiedFallback = allowUnverifiedFallback
      && /^\d+$/.test(vkUserIdRaw)
      && /^\d+$/.test(vkTsRaw)
      && Boolean(vkPlatform)
      && (!expectedAppId || !launchAppId || launchAppId === expectedAppId);

    if (!canUseUnverifiedFallback) {
      console.warn('[vk-mini] invalid launch params signature', {
        vk_app_id: launchParamsMap.get('vk_app_id') || null,
        vk_platform: launchParamsMap.get('vk_platform') || null,
        has_vk_user_id: Boolean(vkUserIdRaw),
        secrets_count: appSecrets.length,
        allow_unverified_fallback: allowUnverifiedFallback
      });
      return res.status(401).json({ error: 'Invalid VK launch params signature' });
    }

    console.warn('[vk-mini] unverified fallback accepted', {
      vk_app_id: launchAppId || null,
      vk_platform: vkPlatform || null
    });
  }

  const params = new URLSearchParams(launchParams);
  const vkUserId = parseInt(params.get('vk_user_id'), 10);
  if (!vkUserId || vkUserId <= 0) {
    return res.status(400).json({ error: 'vk_user_id missing in launch params' });
  }

  const username = `vk_${vkUserId}`;

  let userResult = await pool.query(
    'SELECT id, username, vk_user_id FROM users WHERE vk_user_id = $1 OR username = $2 LIMIT 1',
    [vkUserId, username]
  );

  if (userResult.rows.length === 0) {
    userResult = await pool.query(
      'INSERT INTO users (username, vk_user_id) VALUES ($1, $2) RETURNING id, username',
      [username, vkUserId]
    );
  } else if (!userResult.rows[0].vk_user_id) {
    await pool.query('UPDATE users SET vk_user_id = $1 WHERE id = $2', [vkUserId, userResult.rows[0].id]);
  }

  const user = userResult.rows[0];
  const token = buildToken(user);

  const masterResult = await pool.query('SELECT id, booking_slug FROM masters ORDER BY id ASC LIMIT 1');
  const master = masterResult.rows[0] || null;

  res.json({
    user: { id: user.id, username: user.username },
    token,
    role: 'client',
    booking_slug: master ? master.booking_slug : null,
    master_id: master ? master.id : null
  });
}));

// POST /api/auth/telegram
router.post('/telegram', asyncRoute(async (req, res) => {
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
}));

// POST /api/auth/guest — creates or reuses a guest account for web booking
// Guest accounts are identified by a stable browser fingerprint stored in localStorage.
// Rate-limited by the general limiter; no sensitive data is exposed.
router.post('/guest', asyncRoute(async (req, res) => {
  const availability = await getWebBookingAvailability(req.body.slug);
  if (!availability.ok) {
    return res.status(availability.status).json({
      error: availability.error,
      reason: availability.reason
    });
  }

  const guestId = String(req.body.guest_id || '').trim();
  if (!guestId || guestId.length < 16 || guestId.length > 64) {
    return res.status(400).json({ error: 'guest_id required (16-64 chars)' });
  }

  const username = `guest_${guestId}`;
  let userResult = await pool.query(
    'SELECT id, username FROM users WHERE username = $1 LIMIT 1',
    [username]
  );
  if (userResult.rows.length === 0) {
    userResult = await pool.query(
      'INSERT INTO users (username) VALUES ($1) RETURNING id, username',
      [username]
    );
  }

  const user = userResult.rows[0];
  const token = buildToken(user);
  res.json({ token });
}));

// --- Telegram Login Widget ---

function isValidTelegramWidgetData(data, botToken) {
  const hash = data.hash;
  if (!hash) return false;

  const checkString = Object.entries(data)
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Widget uses SHA256(botToken) as secret key, unlike Mini App which uses HMAC("WebAppData", botToken)
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  const computedBuffer = Buffer.from(computedHash, 'hex');
  const receivedBuffer = Buffer.from(hash, 'hex');
  if (computedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(computedBuffer, receivedBuffer);
}

function sanitizeReturnTo(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/';

  try {
    const parsed = new URL(raw, 'https://rova-epil.local');
    if (parsed.origin !== 'https://rova-epil.local') return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}

function sanitizeSessionKey(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 200) return '';
  return raw.replace(/[^\w:-]/g, '');
}

function applyPopupFriendlyHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
}

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function generateVkPkceVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

function buildVkPkceChallenge(verifier) {
  return crypto.createHash('sha256').update(String(verifier)).digest('base64url');
}

function getVkOAuthStateSecret() {
  return process.env.VK_OAUTH_STATE_SECRET || JWT_SECRET || process.env.VK_APP_SECRET || 'vk-oauth-state-secret';
}

function buildAuthCompletionPage({ token, sessionKey, error, returnTo }) {
  const payload = {
    type: 'web-auth-result',
    token: token || '',
    sessionKey: sessionKey || '',
    error: error || ''
  };
  const safeReturnTo = sanitizeReturnTo(returnTo);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Authorization</title>
</head>
<body>
  <script>
    (function () {
      var payload = ${JSON.stringify(payload)};
      var returnTo = ${JSON.stringify(safeReturnTo)};

      try {
        if (payload.token) {
          localStorage.setItem('token', payload.token);
          if (payload.sessionKey) {
            localStorage.setItem('bookingAuthSession', payload.sessionKey);
          }
        }
      } catch (error) {
        void error;
      }

      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
          window.close();
          return;
        }
      } catch (error) {
        void error;
      }

      if (returnTo) {
        window.location.replace(returnTo);
        return;
      }

      document.body.textContent = payload.error || 'Авторизация завершена';
    })();
  </script>
</body>
</html>`;
}

// POST /api/auth/telegram-widget — Telegram Login Widget (browser, not Mini App)
router.post('/telegram-widget', asyncRoute(async (req, res) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.status(503).json({ error: 'Telegram auth is not configured' });
  }

  const body = req.body;
  if (!body || !body.id || !body.hash || !body.auth_date) {
    return res.status(400).json({ error: 'Invalid widget data: id, hash and auth_date are required' });
  }

  // Normalise to strings to prevent type-injection attacks
  const widgetData = {};
  for (const key of ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']) {
    if (body[key] !== undefined) widgetData[key] = String(body[key]);
  }

  const authDate = Number(widgetData.auth_date);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDate || nowSeconds - authDate > 600) {
    return res.status(401).json({ error: 'Telegram widget data expired (max 10 minutes)' });
  }

  if (!isValidTelegramWidgetData(widgetData, botToken)) {
    return res.status(401).json({ error: 'Invalid Telegram widget signature' });
  }

  const telegramId = widgetData.id;
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
  const rawUser = {
    id: body.id,
    first_name: body.first_name,
    last_name: body.last_name,
    username: body.username,
    photo_url: body.photo_url
  };
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
}));

// GET /api/auth/telegram-widget/callback — redirect target for Telegram Login Widget
router.get('/telegram-widget/callback', asyncRoute(async (req, res) => {
  applyPopupFriendlyHeaders(res);

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return res.type('html').send(buildAuthCompletionPage({
      error: 'Telegram auth is not configured',
      returnTo: req.query.return_to
    }));
  }

  const widgetData = {};
  for (const key of ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']) {
    if (req.query[key] !== undefined) widgetData[key] = String(req.query[key]);
  }

  if (!widgetData.id || !widgetData.hash || !widgetData.auth_date) {
    return res.type('html').send(buildAuthCompletionPage({
      error: 'Invalid Telegram widget data',
      returnTo: req.query.return_to,
      sessionKey: sanitizeSessionKey(req.query.session_key)
    }));
  }

  const authDate = Number(widgetData.auth_date);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDate || nowSeconds - authDate > 600) {
    return res.type('html').send(buildAuthCompletionPage({
      error: 'Telegram widget data expired',
      returnTo: req.query.return_to,
      sessionKey: sanitizeSessionKey(req.query.session_key)
    }));
  }

  if (!isValidTelegramWidgetData(widgetData, botToken)) {
    return res.type('html').send(buildAuthCompletionPage({
      error: 'Invalid Telegram widget signature',
      returnTo: req.query.return_to,
      sessionKey: sanitizeSessionKey(req.query.session_key)
    }));
  }

  const telegramId = widgetData.id;
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
  await syncTelegramUserProfile(user.id, {
    id: widgetData.id,
    first_name: widgetData.first_name,
    last_name: widgetData.last_name,
    username: widgetData.username,
    photo_url: widgetData.photo_url
  });

  return res.type('html').send(buildAuthCompletionPage({
    token: buildToken(user),
    sessionKey: sanitizeSessionKey(req.query.session_key),
    returnTo: req.query.return_to
  }));
}));

// --- VK OAuth (server callback flow) ---

function encodeVkOAuthState({ returnTo, sessionKey, codeVerifier }) {
  const payload = {
    returnTo: sanitizeReturnTo(returnTo),
    sessionKey: sanitizeSessionKey(sessionKey),
    codeVerifier: String(codeVerifier || ''),
    issuedAt: Date.now()
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', getVkOAuthStateSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function decodeVkOAuthState(rawState) {
  if (!rawState) return { returnTo: '/', sessionKey: '', codeVerifier: '', valid: false };

  try {
    const [encodedPayload, signature] = String(rawState).split('.');
    if (!encodedPayload || !signature) {
      return { returnTo: '/', sessionKey: '', codeVerifier: '', valid: false };
    }

    const expectedSignature = crypto
      .createHmac('sha256', getVkOAuthStateSecret())
      .update(encodedPayload)
      .digest('base64url');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return { returnTo: '/', sessionKey: '', codeVerifier: '', valid: false };
    }

    const parsed = JSON.parse(Buffer.from(String(encodedPayload), 'base64url').toString('utf8'));
    const codeVerifier = String(parsed.codeVerifier || '');
    return {
      returnTo: sanitizeReturnTo(parsed.returnTo),
      sessionKey: sanitizeSessionKey(parsed.sessionKey),
      codeVerifier: /^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier) ? codeVerifier : '',
      valid: true
    };
  } catch {
    return { returnTo: '/', sessionKey: '', codeVerifier: '', valid: false };
  }
}

function getVkOAuthRedirectUri(req) {
  if (process.env.VK_OAUTH_REDIRECT_URI) return process.env.VK_OAUTH_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/api/auth/vk-oauth/callback`;
}

function getVkOAuthOrigin(req) {
  try {
    return new URL(getVkOAuthRedirectUri(req)).origin;
  } catch {
    return '';
  }
}

function getVkIdAuthorizeUrl() {
  return process.env.VK_ID_AUTHORIZE_URL || 'https://id.vk.com/authorize';
}

function getVkOAuthScope() {
  const value = String(process.env.VK_OAUTH_SCOPE || '').trim();
  return value || 'phone email';
}

function getVkIdTokenUrl() {
  return process.env.VK_ID_TOKEN_URL || 'https://id.vk.com/oauth2/auth';
}

function getVkIdUserInfoUrl() {
  return process.env.VK_ID_USER_INFO_URL || 'https://id.vk.com/oauth2/user_info';
}

function parseVkOAuthCallback(req) {
  let payload = {};
  if (typeof req.query.payload === 'string' && req.query.payload.trim()) {
    try {
      payload = JSON.parse(req.query.payload);
    } catch {
      payload = {};
    }
  }

  const getValue = function (key) {
    const queryValue = req.query[key];
    if (queryValue !== undefined && queryValue !== null && String(queryValue).trim() !== '') {
      return String(queryValue);
    }
    const payloadValue = payload && typeof payload === 'object' ? payload[key] : undefined;
    if (payloadValue !== undefined && payloadValue !== null && String(payloadValue).trim() !== '') {
      return String(payloadValue);
    }
    return '';
  };

  return {
    code: getValue('code'),
    deviceId: getValue('device_id'),
    state: getValue('state'),
    error: getValue('error'),
    errorDescription: getValue('error_description')
  };
}

async function findOrCreateVkUser(vkUserId) {
  const username = `vk_${vkUserId}`;
  let userResult = await pool.query(
    'SELECT id, username, vk_user_id FROM users WHERE vk_user_id = $1 OR username = $2 LIMIT 1',
    [vkUserId, username]
  );

  if (userResult.rows.length === 0) {
    userResult = await pool.query(
      'INSERT INTO users (username, vk_user_id) VALUES ($1, $2) RETURNING id, username',
      [username, vkUserId]
    );
  } else if (!userResult.rows[0].vk_user_id) {
    await pool.query('UPDATE users SET vk_user_id = $1 WHERE id = $2', [vkUserId, userResult.rows[0].id]);
  }

  return userResult.rows[0];
}

// GET /api/auth/vk-oauth — redirect browser to VK ID consent screen (OAuth 2.1 + PKCE)
router.get('/vk-oauth', (req, res) => {
  const appId = process.env.VK_APP_ID;
  if (!appId) {
    applyPopupFriendlyHeaders(res);
    return res.status(503).type('html').send(buildAuthCompletionPage({
      error: 'VK OAuth is not configured',
      returnTo: req.query.return_to,
      sessionKey: sanitizeSessionKey(req.query.session_key)
    }));
  }

  const codeVerifier = generateVkPkceVerifier();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: getVkOAuthRedirectUri(req),
    response_type: 'code',
    code_challenge: buildVkPkceChallenge(codeVerifier),
    code_challenge_method: 's256',
    state: encodeVkOAuthState({
      returnTo: req.query.return_to,
      sessionKey: req.query.session_key,
      codeVerifier
    })
  });
  const scope = getVkOAuthScope();
  if (scope) params.set('scope', scope);
  if (String(req.query.auth_mode || '').trim() === 'popup') {
    const origin = getVkOAuthOrigin(req);
    if (origin) params.set('origin', origin);
  }
  res.redirect(`${getVkIdAuthorizeUrl()}?${params}`);
});

// GET /api/auth/vk-oauth/callback — exchange VK ID code, create/find user and complete auth
router.get('/vk-oauth/callback', asyncRoute(async (req, res) => {
  applyPopupFriendlyHeaders(res);

  const callback = parseVkOAuthCallback(req);
  const state = decodeVkOAuthState(callback.state);
  if (!state.valid || !state.codeVerifier) {
    return res.type('html').send(buildAuthCompletionPage({
      error: 'Некорректное состояние авторизации ВКонтакте',
      returnTo: req.query.return_to,
      sessionKey: sanitizeSessionKey(req.query.session_key)
    }));
  }

  const { code, deviceId, error, errorDescription } = callback;
  if (error || !code) {
    return res.type('html').send(buildAuthCompletionPage({
      error: errorDescription || 'VK авторизация отменена',
      returnTo: state.returnTo,
      sessionKey: state.sessionKey
    }));
  }

  if (!deviceId) {
    return res.type('html').send(buildAuthCompletionPage({
      error: 'ВКонтакте не вернул device_id',
      returnTo: state.returnTo,
      sessionKey: state.sessionKey
    }));
  }

  const appId = process.env.VK_APP_ID;
  if (!appId) {
    return res.type('html').send(buildAuthCompletionPage({
      error: 'VK OAuth is not configured',
      returnTo: state.returnTo,
      sessionKey: state.sessionKey
    }));
  }

  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: appId,
    redirect_uri: getVkOAuthRedirectUri(req),
    code_verifier: state.codeVerifier,
    device_id: deviceId,
    code: String(code),
    state: callback.state
  });

  let tokenData;
  try {
    const tokenRes = await fetch(getVkIdTokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });
    tokenData = await tokenRes.json();
  } catch (fetchErr) {
    console.error('[vk-id] token exchange failed:', fetchErr);
    return res.type('html').send(buildAuthCompletionPage({
      error: 'Ошибка связи с ВКонтакте',
      returnTo: state.returnTo,
      sessionKey: state.sessionKey
    }));
  }

  if (tokenData.error || !tokenData.access_token) {
    console.error('[vk-id] token error:', tokenData.error, tokenData.error_description);
    return res.type('html').send(buildAuthCompletionPage({
      error: tokenData.error_description || 'Ошибка авторизации ВКонтакте',
      returnTo: state.returnTo,
      sessionKey: state.sessionKey
    }));
  }

  let userInfoData;
  try {
    const userInfoRes = await fetch(getVkIdUserInfoUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: String(tokenData.access_token),
        client_id: appId
      }).toString()
    });
    userInfoData = await userInfoRes.json();
  } catch (fetchErr) {
    console.error('[vk-id] user info failed:', fetchErr);
    return res.type('html').send(buildAuthCompletionPage({
      error: 'Не удалось получить профиль ВКонтакте',
      returnTo: state.returnTo,
      sessionKey: state.sessionKey
    }));
  }

  const vkUserId = Number(
    userInfoData?.user?.user_id
    || userInfoData?.user?.id
    || tokenData.user_id
  );
  if (!vkUserId || !Number.isFinite(vkUserId)) {
    console.error('[vk-id] invalid user info:', userInfoData);
    return res.type('html').send(buildAuthCompletionPage({
      error: 'Не удалось определить пользователя ВКонтакте',
      returnTo: state.returnTo,
      sessionKey: state.sessionKey
    }));
  }

  const user = await findOrCreateVkUser(vkUserId);
  return res.type('html').send(buildAuthCompletionPage({
    token: buildToken(user),
    sessionKey: state.sessionKey,
    returnTo: state.returnTo
  }));
}));

// POST /api/auth/vk-oauth-token — legacy implicit-flow endpoint, retained for compatibility
router.post('/vk-oauth-token', asyncRoute(async (req, res) => {
  const { access_token, user_id } = req.body;

  if (!access_token || !user_id) {
    return res.status(400).json({ error: 'Missing access_token or user_id' });
  }

  const vkUserId = Number(user_id);
  if (!vkUserId || !Number.isFinite(vkUserId)) {
    return res.status(400).json({ error: 'Invalid user_id' });
  }

  let apiUserId;
  try {
    const apiRes = await fetch(`https://api.vk.com/method/users.get?access_token=${encodeURIComponent(String(access_token))}&v=5.199`);
    const data = await apiRes.json();
    if (data.error || !data.response || !data.response[0]) {
      return res.status(401).json({ error: 'Invalid VK token' });
    }
    apiUserId = Number(data.response[0].id);
  } catch (fetchErr) {
    console.error('[vk-oauth-token] VK API call failed:', fetchErr);
    return res.status(503).json({ error: 'Ошибка связи с ВКонтакте' });
  }

  if (apiUserId !== vkUserId) {
    return res.status(401).json({ error: 'VK user_id mismatch' });
  }

  const user = await findOrCreateVkUser(vkUserId);
  res.json({ token: buildToken(user) });
}));

module.exports = router;

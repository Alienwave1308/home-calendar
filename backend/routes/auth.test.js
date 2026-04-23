const request = require('supertest');
const app = require('../server');
const { pool } = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

describe('Auth API', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  function buildTelegramInitData(botToken, userId = 42, authDate = Math.floor(Date.now() / 1000)) {
    const user = JSON.stringify({
      id: userId,
      first_name: 'Test',
      username: 'tguser'
    });
    const payload = {
      auth_date: String(authDate),
      query_id: 'AAEAAAE',
      user
    };
    const dataCheckString = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key]}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const params = new URLSearchParams(payload);
    params.set('hash', hash);
    return params.toString();
  }

  function buildTelegramWidgetPayload(botToken, userId = 42, authDate = Math.floor(Date.now() / 1000)) {
    const payload = {
      id: String(userId),
      first_name: 'Test',
      username: 'tguser',
      auth_date: String(authDate)
    };
    const checkString = Object.keys(payload)
      .sort()
      .map((key) => `${key}=${payload[key]}`)
      .join('\n');
    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    payload.hash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
    return payload;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'telegram-test-bot-token';
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_PASSWORD_AUTH;
    delete process.env.MASTER_TELEGRAM_USER_ID;
    delete process.env.WEB_BOOKING_ENABLED;
    delete process.env.WEB_BOOKING_ALLOWED_SLUGS;
    delete process.env.VK_OAUTH_REDIRECT_URI;
    delete process.env.VK_OAUTH_STATE_SECRET;
    delete process.env.VK_APP_ID;
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe('Telegram-only mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_PASSWORD_AUTH;
    });

    it('should reject password login in production mode', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' })
        .expect(403);

      expect(response.body.error).toMatch(/telegram mini app/i);
    });

    it('should reject password registration in production mode', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'password123' })
        .expect(403);

      expect(response.body.error).toMatch(/telegram mini app/i);
    });
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // username check
        .mockResolvedValueOnce({
          rows: [{ id: 1, username: 'testuser', created_at: new Date() }]
        });

      const response = await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: 'password123' })
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body.user.username).toBe('testuser');
    });

    it('should return 400 if username is missing', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ password: 'password123' })
        .expect(400);
    });

    it('should return 400 if password is too short', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ username: 'testuser', password: '123' })
        .expect(400);
    });

    it('should return 409 if username already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await request(app)
        .post('/api/auth/register')
        .send({ username: 'taken', password: 'password123' })
        .expect(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const hash = await bcrypt.hash('password123', 10);
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, username: 'testuser', password_hash: hash }]
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body.user.username).toBe('testuser');

      // Verify token is valid
      const decoded = jwt.verify(response.body.token, JWT_SECRET);
      expect(decoded.id).toBe(1);
    });

    it('should return 401 for wrong password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, username: 'testuser', password_hash: hash }]
      });

      await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrongpassword' })
        .expect(401);
    });

    it('should return 401 for non-existent user', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/auth/login')
        .send({ username: 'nobody', password: 'password123' })
        .expect(401);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should generate reset token for existing user', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // user found
        .mockResolvedValueOnce({ rows: [] }) // invalidate old tokens
        .mockResolvedValueOnce({ rows: [] }); // insert new token

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ username: 'testuser' })
        .expect(200);

      expect(res.body.token).toBeTruthy();
      expect(res.body.token.length).toBe(64); // 32 bytes hex
    });

    it('should return success even for non-existent user', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // user not found

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ username: 'nobody' })
        .expect(200);

      expect(res.body.message).toMatch(/reset token/);
      expect(res.body.token).toBeUndefined();
    });

    it('should return 400 if username missing', async () => {
      await request(app)
        .post('/api/auth/forgot-password')
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('should reset password with valid token', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, user_id: 1, token: 'abc', used: false, expires_at: new Date(Date.now() + 3600000) }]
        }) // valid token
        .mockResolvedValueOnce({ rows: [] }) // update password
        .mockResolvedValueOnce({ rows: [] }); // mark token used

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'abc', password: 'newpassword' })
        .expect(200);

      expect(res.body.message).toMatch(/reset successfully/);
    });

    it('should return 400 for invalid token', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // no valid token

      await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'badtoken', password: 'newpassword' })
        .expect(400);
    });

    it('should return 400 for short password', async () => {
      await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'abc', password: '123' })
        .expect(400);
    });

    it('should return 400 if token or password missing', async () => {
      await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'abc' })
        .expect(400);

      await request(app)
        .post('/api/auth/reset-password')
        .send({ password: 'newpassword' })
        .expect(400);
    });
  });

  describe('POST /api/auth/telegram', () => {
    it('should reject when initData is missing', async () => {
      await request(app)
        .post('/api/auth/telegram')
        .send({})
        .expect(400);
    });

    it('should reject invalid initData hash', async () => {
      await request(app)
        .post('/api/auth/telegram')
        .send({ initData: 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef' })
        .expect(401);
    });

    it('should login existing telegram user', async () => {
      const initData = buildTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, 55);
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 7, username: 'tg_55' }] })
        .mockResolvedValueOnce({ rows: [] }) // syncTelegramUserProfile
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 1, booking_slug: 'master-slug' }] });

      const response = await request(app)
        .post('/api/auth/telegram')
        .send({ initData })
        .expect(200);

      expect(response.body.user).toEqual({ id: 7, username: 'tg_55' });
      expect(response.body).toHaveProperty('token');
      expect(response.body.role).toBe('client');
      expect(response.body.booking_slug).toBe('master-slug');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users'),
        expect.arrayContaining([7])
      );
    });

    it('should create telegram user if missing', async () => {
      const initData = buildTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, 77);
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 9, username: 'tg_77' }] })
        .mockResolvedValueOnce({ rows: [] }) // syncTelegramUserProfile
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 1, booking_slug: 'master-slug' }] });

      const response = await request(app)
        .post('/api/auth/telegram')
        .send({ initData })
        .expect(200);

      expect(response.body.user).toEqual({ id: 9, username: 'tg_77' });
      expect(pool.query).toHaveBeenNthCalledWith(
        1,
        'SELECT id, username FROM users WHERE username = $1',
        ['tg_77']
      );
    });

    it('should mark configured telegram account as master', async () => {
      process.env.MASTER_TELEGRAM_USER_ID = '91';
      const initData = buildTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, 91);
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 12, username: 'tg_91' }] })
        .mockResolvedValueOnce({ rows: [] }) // syncTelegramUserProfile
        .mockResolvedValueOnce({ rows: [{ id: 4, booking_slug: 'master-own-slug' }] });

      const response = await request(app)
        .post('/api/auth/telegram')
        .send({ initData })
        .expect(200);

      expect(response.body.role).toBe('master');
      expect(response.body.booking_slug).toBe('master-own-slug');
    });

    it('should assign first telegram user as master when master env is not set', async () => {
      const initData = buildTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, 101);
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 21, username: 'tg_101' }] })
        .mockResolvedValueOnce({ rows: [] }) // syncTelegramUserProfile
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 8, booking_slug: 'first-master-slug' }] });

      const response = await request(app)
        .post('/api/auth/telegram')
        .send({ initData })
        .expect(200);

      expect(response.body.role).toBe('master');
      expect(response.body.booking_slug).toBe('first-master-slug');
    });

    it('should reject expired initData', async () => {
      const staleAuthDate = Math.floor(Date.now() / 1000) - 86500;
      const initData = buildTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, 88, staleAuthDate);

      await request(app)
        .post('/api/auth/telegram')
        .send({ initData })
        .expect(401);
    });
  });

  // ─── POST /api/auth/vk ────────────────────────────────────────────────────

  describe('POST /api/auth/vk', () => {
    const VK_APP_SECRET = 'test-vk-secret';

    function buildVkLaunchParams(userId = 123456, overrides = {}) {
      const params = new URLSearchParams({
        vk_user_id: String(userId),
        vk_app_id: '1234567',
        vk_ts: String(Math.floor(Date.now() / 1000)),
        ...overrides
      });

      // Sort vk_* keys, build check string
      const entries = [];
      params.forEach((value, key) => {
        if (key.startsWith('vk_')) entries.push([key, value]);
      });
      entries.sort(([a], [b]) => a.localeCompare(b));
      const checkString = entries.map(([k, v]) => `${k}=${v}`).join('&');

      const sign = crypto.createHmac('sha256', VK_APP_SECRET)
        .update(checkString)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      params.set('sign', sign);
      return params.toString();
    }

    function buildVkLaunchParamsBase64Sign(userId = 123456, overrides = {}) {
      const params = new URLSearchParams({
        vk_user_id: String(userId),
        vk_app_id: '1234567',
        vk_ts: String(Math.floor(Date.now() / 1000)),
        ...overrides
      });

      const entries = [];
      params.forEach((value, key) => {
        if (key.startsWith('vk_')) entries.push([key, value]);
      });
      entries.sort(([a], [b]) => a.localeCompare(b));
      const checkString = entries.map(([k, v]) => `${k}=${v}`).join('&');
      const sign = crypto.createHmac('sha256', VK_APP_SECRET)
        .update(checkString)
        .digest('base64');

      params.set('sign', sign);
      return params.toString();
    }

    beforeEach(() => {
      jest.clearAllMocks();
      process.env.VK_APP_SECRET = VK_APP_SECRET;
      delete process.env.VK_MINI_APP_SECRET;
      delete process.env.VK_MINI_APP_SECRETS;
      delete process.env.VK_SECRET;
      delete process.env.VK_MINI_ALLOW_UNVERIFIED;
    });

    it('возвращает 503 если VK_APP_SECRET не настроен', async () => {
      delete process.env.VK_APP_SECRET;
      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams: 'vk_user_id=1&sign=x' });
      expect(res.status).toBe(503);
    });

    it('принимает подпись из VK_MINI_APP_SECRET если VK_APP_SECRET не совпадает', async () => {
      process.env.VK_APP_SECRET = 'wrong-secret';
      process.env.VK_MINI_APP_SECRET = VK_APP_SECRET;
      const launchParams = buildVkLaunchParams(333333);

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 3, username: 'vk_333333', vk_user_id: 333333 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, booking_slug: 'lera' }] });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('принимает подпись из VK_SECRET как fallback', async () => {
      process.env.VK_APP_SECRET = 'wrong-secret';
      process.env.VK_SECRET = VK_APP_SECRET;
      const launchParams = buildVkLaunchParams(454545);

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 11, username: 'vk_454545', vk_user_id: 454545 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, booking_slug: 'lera' }] });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('принимает launchParams с ведущим вопросительным знаком', async () => {
      const launchParams = `?${buildVkLaunchParams(212121)}`;

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 13, username: 'vk_212121', vk_user_id: 212121 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, booking_slug: 'lera' }] });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('принимает sign в обычном base64 формате', async () => {
      const launchParams = buildVkLaunchParamsBase64Sign(323232);

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 14, username: 'vk_323232', vk_user_id: 323232 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, booking_slug: 'lera' }] });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('возвращает явную ошибку при launch params от другого app_id', async () => {
      process.env.VK_APP_ID = '54478943';
      const launchParams = buildVkLaunchParams(565656, { vk_app_id: '99999999' });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('VK launch params are from another app');
      expect(res.body.expected_app_id).toBe('54478943');
      expect(res.body.launch_app_id).toBe('99999999');
    });

    it('возвращает 400 если launchParams отсутствует', async () => {
      const res = await request(app)
        .post('/api/auth/vk')
        .send({});
      expect(res.status).toBe(400);
    });

    it('возвращает 401 при неверной подписи', async () => {
      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams: 'vk_user_id=123&sign=bad_signature' });
      expect(res.status).toBe(401);
    });

    it('разрешает аварийный fallback без подписи при включенном флаге', async () => {
      process.env.VK_MINI_ALLOW_UNVERIFIED = 'true';
      process.env.VK_APP_SECRET = '';
      process.env.VK_APP_ID = '54478943';
      const launchParams = new URLSearchParams({
        vk_app_id: '54478943',
        vk_user_id: '777001',
        vk_ts: String(Math.floor(Date.now() / 1000)),
        vk_platform: 'mobile_web'
      }).toString();

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 19, username: 'vk_777001', vk_user_id: 777001 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, booking_slug: 'lera' }] });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.username).toBe('vk_777001');
    });

    it('создаёт нового пользователя и возвращает token для нового VK userId', async () => {
      const launchParams = buildVkLaunchParams(555555);

      // Первый SELECT — не найден
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        // INSERT — возвращает нового пользователя
        .mockResolvedValueOnce({ rows: [{ id: 10, username: 'vk_555555' }] })
        // SELECT master
        .mockResolvedValueOnce({ rows: [{ id: 1, booking_slug: 'lera' }] });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.role).toBe('client');
      expect(res.body.booking_slug).toBe('lera');
    });

    it('возвращает существующего пользователя по vk_user_id', async () => {
      const launchParams = buildVkLaunchParams(777777);

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 5, username: 'vk_777777', vk_user_id: 777777 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, booking_slug: 'lera' }] });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.username).toBe('vk_777777');
    });

    it('JWT-токен содержит корректный userId', async () => {
      const launchParams = buildVkLaunchParams(888888);

      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 99, username: 'vk_888888', vk_user_id: 888888 }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/vk')
        .send({ launchParams });

      expect(res.status).toBe(200);
      const decoded = jwt.verify(res.body.token, JWT_SECRET);
      expect(decoded.id).toBe(99);
    });
  });

  describe('POST /api/auth/guest', () => {
    it('should create a guest token when web booking is enabled', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 77, username: 'guest_abcdef1234567890' }] });

      const response = await request(app)
        .post('/api/auth/guest')
        .send({ guest_id: 'abcdef1234567890' })
        .expect(200);

      expect(response.body.token).toBeTruthy();
    });

    it('should reject guest auth when web booking is disabled explicitly', async () => {
      process.env.WEB_BOOKING_ENABLED = 'false';

      const response = await request(app)
        .post('/api/auth/guest')
        .send({ guest_id: 'abcdef1234567890' })
        .expect(503);

      expect(response.body.reason).toBe('web_booking_disabled');
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/auth/telegram-widget/callback', () => {
    it('returns popup-safe HTML that completes Telegram auth on our origin', async () => {
      const widgetData = buildTelegramWidgetPayload(process.env.TELEGRAM_BOT_TOKEN, 55);
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 7, username: 'tg_55' }] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/api/auth/telegram-widget/callback')
        .query({
          ...widgetData,
          return_to: '/book/lera',
          session_key: 'guest:abcdef1234567890'
        })
        .expect(200);

      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
      expect(response.text).toContain('"type":"web-auth-result"');
      expect(response.text).toContain('"sessionKey":"guest:abcdef1234567890"');
      expect(response.text).toContain('window.opener.postMessage');
      expect(response.text).toContain('var returnTo = "/book/lera";');
      expect(response.text).toContain('window.location.replace(returnTo)');
    });
  });

  describe('GET /api/auth/vk-oauth/callback', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('exchanges the VK ID code and returns popup-safe HTML', async () => {
      process.env.VK_APP_ID = '54478943';
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          json: async () => ({ access_token: 'vk-token' })
        })
        .mockResolvedValueOnce({
          json: async () => ({ user: { user_id: 123456, first_name: 'Test' } })
        });
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 5, username: 'vk_123456', vk_user_id: 123456 }]
      });

      const verifier = crypto.randomBytes(64).toString('base64url');
      const encodedPayload = Buffer.from(JSON.stringify({
        returnTo: '/book/lera',
        sessionKey: 'guest:abcdef1234567890',
        codeVerifier: verifier,
        issuedAt: Date.now()
      })).toString('base64url');
      const signature = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(encodedPayload)
        .digest('base64url');
      const state = `${encodedPayload}.${signature}`;

      const response = await request(app)
        .get('/api/auth/vk-oauth/callback')
        .query({ code: 'oauth-code', device_id: 'device-123', state })
        .expect(200);

      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://id.vk.com/oauth2/auth',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: expect.stringContaining('grant_type=authorization_code')
        })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://id.vk.com/oauth2/user_info',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      );
      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
      expect(response.text).toContain('"type":"web-auth-result"');
      expect(response.text).toContain('"sessionKey":"guest:abcdef1234567890"');
      expect(response.text).toContain('window.opener.postMessage');
    });
  });

  describe('GET /api/auth/vk-oauth', () => {
    it('redirects browser auth to VK ID with PKCE and callback state preserved', async () => {
      process.env.VK_APP_ID = '54478943';

      const response = await request(app)
        .get('/api/auth/vk-oauth')
        .query({
          return_to: '/book/lera',
          session_key: 'guest:abcdef1234567890'
        })
        .expect(302);

      const location = response.headers.location;
      const target = new URL(location);
      expect(target.origin + target.pathname).toBe('https://id.vk.com/authorize');
      expect(target.searchParams.get('client_id')).toBe('54478943');
      expect(target.searchParams.get('response_type')).toBe('code');
      expect(target.searchParams.get('scope')).toBe('phone email');
      expect(target.searchParams.get('code_challenge_method')).toBe('s256');
      expect(target.searchParams.get('code_challenge')).toBeTruthy();
      expect(target.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/vk-oauth\/callback$/);
      expect(target.searchParams.get('origin')).toBeNull();
      const [encodedPayload, signature] = String(target.searchParams.get('state')).split('.');
      expect(signature).toBeTruthy();
      const state = JSON.parse(Buffer.from(String(encodedPayload), 'base64url').toString('utf8'));
      expect(state.returnTo).toBe('/book/lera');
      expect(state.sessionKey).toBe('guest:abcdef1234567890');
      expect(state.codeVerifier).toMatch(/^[A-Za-z0-9\-_]{43,128}$/);
    });

    it('adds origin for popup auth so VK ID can talk back to the opener', async () => {
      process.env.VK_APP_ID = '54478943';

      const response = await request(app)
        .get('/api/auth/vk-oauth')
        .set('host', 'rova-epil.ru')
        .set('x-forwarded-proto', 'https')
        .query({
          return_to: '/book/lera',
          session_key: 'guest:abcdef1234567890',
          auth_mode: 'popup'
        })
        .expect(302);

      const target = new URL(response.headers.location);
      expect(target.searchParams.get('origin')).toBe('https://rova-epil.ru');
    });

    it('overrides default scope when VK_OAUTH_SCOPE is configured', async () => {
      process.env.VK_APP_ID = '54478943';
      process.env.VK_OAUTH_SCOPE = 'phone email';

      const response = await request(app)
        .get('/api/auth/vk-oauth')
        .query({
          return_to: '/book/lera',
          session_key: 'guest:abcdef1234567890'
        })
        .expect(302);

      const target = new URL(response.headers.location);
      expect(target.searchParams.get('scope')).toBe('phone email');
      delete process.env.VK_OAUTH_SCOPE;
    });

    it('supports custom explicit scope values', async () => {
      process.env.VK_APP_ID = '54478943';
      process.env.VK_OAUTH_SCOPE = 'vkid.personal_info';

      const response = await request(app)
        .get('/api/auth/vk-oauth')
        .query({
          return_to: '/book/lera',
          session_key: 'guest:abcdef1234567890'
        })
        .expect(302);

      const target = new URL(response.headers.location);
      expect(target.searchParams.get('scope')).toBe('vkid.personal_info');
      delete process.env.VK_OAUTH_SCOPE;
    });

    it('uses VK_OAUTH_REDIRECT_URI when it is explicitly configured', async () => {
      process.env.VK_APP_ID = '54478943';
      process.env.VK_OAUTH_REDIRECT_URI = 'https://rova-epil.ru/api/auth/vk-oauth/callback';

      const response = await request(app)
        .get('/api/auth/vk-oauth')
        .query({
          return_to: '/book/lera',
          session_key: 'guest:abcdef1234567890'
        })
        .expect(302);

      const target = new URL(response.headers.location);
      expect(target.searchParams.get('redirect_uri')).toBe('https://rova-epil.ru/api/auth/vk-oauth/callback');
    });

    it('rejects callback with invalid signed state', async () => {
      process.env.VK_APP_ID = '54478943';

      const response = await request(app)
        .get('/api/auth/vk-oauth/callback')
        .query({
          code: 'oauth-code',
          device_id: 'device-123',
          state: 'broken.state'
        })
        .expect(200);

      expect(response.text).toContain('Некорректное состояние авторизации ВКонтакте');
    });
  });

  describe('GET /book/:slug', () => {
    it('relaxes COOP for popup-based web auth', async () => {
      const response = await request(app)
        .get('/book/lera')
        .expect(200);

      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
      expect(response.text).toContain('window.__TG_BOT_USERNAME__');
      expect(response.text).toContain('/booking.js?v=20260423-vklaunchfix1');
    });
  });
});

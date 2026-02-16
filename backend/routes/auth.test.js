const request = require('supertest');
const app = require('../server');
const { pool } = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { URLSearchParams } = require('url');
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

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'telegram-test-bot-token';
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_PASSWORD_AUTH;
    delete process.env.MASTER_TELEGRAM_USER_ID;
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
    });

    it('should create telegram user if missing', async () => {
      const initData = buildTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, 77);
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 9, username: 'tg_77' }] })
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
});

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
      pool.query.mockResolvedValueOnce({ rows: [{ id: 7, username: 'tg_55' }] });

      const response = await request(app)
        .post('/api/auth/telegram')
        .send({ initData })
        .expect(200);

      expect(response.body.user).toEqual({ id: 7, username: 'tg_55' });
      expect(response.body).toHaveProperty('token');
    });

    it('should create telegram user if missing', async () => {
      const initData = buildTelegramInitData(process.env.TELEGRAM_BOT_TOKEN, 77);
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 9, username: 'tg_77' }] });

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

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

const user1 = { id: 1, username: 'alice' };
const token1 = `Bearer ${jwt.sign(user1, JWT_SECRET, { expiresIn: '1h' })}`;

describe('Users API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).get('/api/users/me').expect(401);
  });

  describe('GET /api/users/me', () => {
    it('should return user profile', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: 1, username: 'alice', display_name: 'Alice', avatar_url: null,
          timezone: 'UTC', quiet_hours_start: null, quiet_hours_end: null
        }]
      });

      const res = await request(app)
        .get('/api/users/me')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.username).toBe('alice');
      expect(res.body.display_name).toBe('Alice');
    });

    it('should return 404 if user not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/users/me')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('PUT /api/users/me', () => {
    it('should update display_name', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, username: 'alice', display_name: 'Alice W', timezone: 'UTC' }]
      });

      const res = await request(app)
        .put('/api/users/me')
        .set('Authorization', token1)
        .send({ display_name: 'Alice W' })
        .expect(200);

      expect(res.body.display_name).toBe('Alice W');
    });

    it('should update timezone', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, username: 'alice', timezone: 'Europe/Moscow' }]
      });

      const res = await request(app)
        .put('/api/users/me')
        .set('Authorization', token1)
        .send({ timezone: 'Europe/Moscow' })
        .expect(200);

      expect(res.body.timezone).toBe('Europe/Moscow');
    });

    it('should update quiet hours', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, quiet_hours_start: '22:00', quiet_hours_end: '08:00' }]
      });

      const res = await request(app)
        .put('/api/users/me')
        .set('Authorization', token1)
        .send({ quiet_hours_start: '22:00', quiet_hours_end: '08:00' })
        .expect(200);

      expect(res.body.quiet_hours_start).toBe('22:00');
      expect(res.body.quiet_hours_end).toBe('08:00');
    });

    it('should return 400 for invalid timezone', async () => {
      await request(app)
        .put('/api/users/me')
        .set('Authorization', token1)
        .send({ timezone: 'Invalid/Zone' })
        .expect(400);
    });

    it('should return 400 for invalid quiet_hours_start format', async () => {
      await request(app)
        .put('/api/users/me')
        .set('Authorization', token1)
        .send({ quiet_hours_start: '25:00' })
        .expect(400);
    });

    it('should return 400 for invalid quiet_hours_end format', async () => {
      await request(app)
        .put('/api/users/me')
        .set('Authorization', token1)
        .send({ quiet_hours_end: 'midnight' })
        .expect(400);
    });

    it('should return 400 if no fields provided', async () => {
      await request(app)
        .put('/api/users/me')
        .set('Authorization', token1)
        .send({})
        .expect(400);
    });

    it('should clear display_name with empty string', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, username: 'alice', display_name: null }]
      });

      const res = await request(app)
        .put('/api/users/me')
        .set('Authorization', token1)
        .send({ display_name: '' })
        .expect(200);

      expect(res.body.display_name).toBeNull();
    });
  });

  describe('PUT /api/users/me/avatar', () => {
    it('should update avatar URL', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, avatar_url: 'https://example.com/avatar.png' }]
      });

      const res = await request(app)
        .put('/api/users/me/avatar')
        .set('Authorization', token1)
        .send({ avatar_url: 'https://example.com/avatar.png' })
        .expect(200);

      expect(res.body.avatar_url).toBe('https://example.com/avatar.png');
    });

    it('should clear avatar with null', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, avatar_url: null }]
      });

      const res = await request(app)
        .put('/api/users/me/avatar')
        .set('Authorization', token1)
        .send({ avatar_url: null })
        .expect(200);

      expect(res.body.avatar_url).toBeNull();
    });

    it('should return 400 for non-string avatar_url', async () => {
      await request(app)
        .put('/api/users/me/avatar')
        .set('Authorization', token1)
        .send({ avatar_url: 123 })
        .expect(400);
    });
  });
});

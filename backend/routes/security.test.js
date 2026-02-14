const request = require('supertest');
const app = require('../server');
const { pool } = require('../db');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

describe('Security middleware', () => {
  it('should set security headers via helmet', async () => {
    const res = await request(app).get('/health').expect(200);

    // Helmet sets these headers
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('should set CORS headers', async () => {
    const res = await request(app)
      .options('/api/tasks')
      .set('Origin', 'http://localhost:3000')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBeTruthy();
    expect(res.headers['access-control-allow-methods']).toContain('GET');
  });

  it('should include rate limit headers on API calls', async () => {
    const res = await request(app).get('/api/tasks').expect(401);

    // express-rate-limit standard headers
    expect(res.headers['ratelimit-limit']).toBe('100');
    expect(res.headers['ratelimit-remaining']).toBeTruthy();
  });

  it('should have stricter rate limit on auth endpoints', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // user not found

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test', password: 'test123' })
      .expect(401);

    // Auth limiter: 10 req/min
    expect(res.headers['ratelimit-limit']).toBe('10');
  });

  it('should return JSON on health check', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('OK');
  });
});

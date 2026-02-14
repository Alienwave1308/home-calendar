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

  it('should not block requests in test mode (rate limit disabled)', async () => {
    // In test mode, rate limiting is disabled (max: 0)
    // Verify we can make many requests without being blocked
    for (let i = 0; i < 5; i++) {
      await request(app).get('/api/tasks').expect(401); // 401 = auth needed, not 429
    }
  });

  it('should allow auth requests in test mode', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', password: 'test123' })
        .expect(401); // not 429
    }
  });

  it('should return JSON on health check', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('OK');
  });
});

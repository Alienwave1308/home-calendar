const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

const testUser = { id: 1, username: 'testuser' };
const authToken = jwt.sign(testUser, JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('Dashboard API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).get('/api/dashboard').expect(401);
  });

  it('should return aggregated dashboard data', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 11, title: 'Today task', date: '2026-02-14', status: 'planned', priority: 'medium' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 12, title: 'Overdue task', date: '2026-02-10', status: 'in_progress', priority: 'high' }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 13, title: 'Upcoming task', date: '2026-02-16', status: 'planned', priority: 'low' }]
      })
      .mockResolvedValueOnce({
        rows: [{ done_week: 4 }]
      });

    const response = await request(app)
      .get('/api/dashboard')
      .set('Authorization', authHeader)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.today).toHaveLength(1);
    expect(response.body.overdue).toHaveLength(1);
    expect(response.body.upcoming).toHaveLength(1);
    expect(response.body.stats).toEqual({
      done_week: 4,
      today_count: 1,
      overdue_count: 1,
      upcoming_count: 1
    });
  });

  it('should return empty arrays and zero stats when no data', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ done_week: 0 }] });

    const response = await request(app)
      .get('/api/dashboard')
      .set('Authorization', authHeader)
      .expect(200);

    expect(response.body.today).toEqual([]);
    expect(response.body.overdue).toEqual([]);
    expect(response.body.upcoming).toEqual([]);
    expect(response.body.stats.done_week).toBe(0);
    expect(response.body.stats.today_count).toBe(0);
    expect(response.body.stats.overdue_count).toBe(0);
    expect(response.body.stats.upcoming_count).toBe(0);
  });

  it('should return 500 when database fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('DB down'));

    const response = await request(app)
      .get('/api/dashboard')
      .set('Authorization', authHeader)
      .expect(500);

    expect(response.body).toHaveProperty('error');
  });
});

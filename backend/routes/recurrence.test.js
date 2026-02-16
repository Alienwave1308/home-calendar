const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { generateDates } = require('./recurrence');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

const user1 = { id: 1, username: 'alice' };
const token1 = `Bearer ${jwt.sign(user1, JWT_SECRET, { expiresIn: '1h' })}`;

describe('Recurrence API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).post('/api/tasks/1/recurrence').expect(401);
  });

  describe('POST /api/tasks/:id/recurrence', () => {
    it('should create a recurrence rule', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({ rows: [] }) // no existing rule
        .mockResolvedValueOnce({
          rows: [{ id: 1, task_id: 1, frequency: 'weekly', interval: 1, days_of_week: null, end_date: null }]
        });

      const res = await request(app)
        .post('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'weekly' })
        .expect(201);

      expect(res.body.frequency).toBe('weekly');
      expect(res.body.interval).toBe(1);
    });

    it('should create with days_of_week and end_date', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, task_id: 1, frequency: 'weekly', interval: 2, days_of_week: [1, 3, 5], end_date: '2026-12-31' }]
        });

      const res = await request(app)
        .post('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'weekly', interval: 2, days_of_week: [1, 3, 5], end_date: '2026-12-31' })
        .expect(201);

      expect(res.body.days_of_week).toEqual([1, 3, 5]);
      expect(res.body.interval).toBe(2);
    });

    it('should return 400 for invalid frequency', async () => {
      await request(app)
        .post('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'biweekly' })
        .expect(400);
    });

    it('should return 400 for missing frequency', async () => {
      await request(app)
        .post('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .send({})
        .expect(400);
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/tasks/99/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'daily' })
        .expect(404);
    });

    it('should return 409 if rule already exists', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing rule

      await request(app)
        .post('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'daily' })
        .expect(409);
    });
  });

  describe('GET /api/tasks/:id/recurrence', () => {
    it('should return recurrence rule', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({
          rows: [{ id: 1, task_id: 1, frequency: 'daily', interval: 1 }]
        });

      const res = await request(app)
        .get('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.frequency).toBe('daily');
    });

    it('should return null if no rule', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toBeNull();
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/tasks/99/recurrence')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('PUT /api/tasks/:id/recurrence', () => {
    it('should update recurrence rule', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({
          rows: [{ id: 1, frequency: 'daily', interval: 1, days_of_week: null, end_date: null }]
        }) // existing rule
        .mockResolvedValueOnce({
          rows: [{ id: 1, frequency: 'weekly', interval: 2, days_of_week: null, end_date: null }]
        });

      const res = await request(app)
        .put('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'weekly', interval: 2 })
        .expect(200);

      expect(res.body.frequency).toBe('weekly');
      expect(res.body.interval).toBe(2);
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/tasks/99/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'daily' })
        .expect(404);
    });

    it('should return 404 if no existing rule', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'daily' })
        .expect(404);
    });

    it('should return 400 for invalid frequency', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, frequency: 'daily', interval: 1, days_of_week: null, end_date: null }]
        });

      await request(app)
        .put('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .send({ frequency: 'biweekly' })
        .expect(400);
    });
  });

  describe('DELETE /api/tasks/:id/recurrence', () => {
    it('should delete recurrence rule and detach instances', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // rule deleted
        .mockResolvedValueOnce({ rows: [] }); // detach instances

      const res = await request(app)
        .delete('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.message).toBe('Recurrence rule deleted');
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/tasks/99/recurrence')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 404 if no rule exists', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/tasks/1/recurrence')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('POST /api/tasks/:id/recurrence/generate', () => {
    it('should generate task instances', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Daily task', date: '2026-03-01', description: 'Test', priority: 'medium', user_id: 1 }]
        }) // source task
        .mockResolvedValueOnce({
          rows: [{ id: 1, task_id: 1, frequency: 'daily', interval: 1, days_of_week: null, end_date: null }]
        }) // rule
        .mockResolvedValueOnce({ rows: [] }) // existing instances
        .mockResolvedValueOnce({ rows: [{ id: 2, title: 'Daily task', date: '2026-03-02' }] }) // created 1
        .mockResolvedValueOnce({ rows: [{ id: 3, title: 'Daily task', date: '2026-03-03' }] }); // created 2

      const res = await request(app)
        .post('/api/tasks/1/recurrence/generate')
        .set('Authorization', token1)
        .send({ until: '2026-03-03' })
        .expect(201);

      expect(res.body.generated).toBe(2);
      expect(res.body.tasks).toHaveLength(2);
    });

    it('should return 400 without until date', async () => {
      await request(app)
        .post('/api/tasks/1/recurrence/generate')
        .set('Authorization', token1)
        .send({})
        .expect(400);
    });

    it('should return 400 for invalid until date', async () => {
      await request(app)
        .post('/api/tasks/1/recurrence/generate')
        .set('Authorization', token1)
        .send({ until: 'not-a-date' })
        .expect(400);
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/tasks/99/recurrence/generate')
        .set('Authorization', token1)
        .send({ until: '2026-03-31' })
        .expect(404);
    });

    it('should return 404 if no recurrence rule', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-03-01', user_id: 1 }]
        })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/tasks/1/recurrence/generate')
        .set('Authorization', token1)
        .send({ until: '2026-03-31' })
        .expect(404);
    });

    it('should skip already existing dates', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Daily task', date: '2026-03-01', description: null, priority: 'low', user_id: 1 }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, task_id: 1, frequency: 'daily', interval: 1, days_of_week: null, end_date: null }]
        })
        .mockResolvedValueOnce({ rows: [{ date: '2026-03-02' }] }) // already exists
        .mockResolvedValueOnce({ rows: [{ id: 3, title: 'Daily task', date: '2026-03-03' }] }); // only this one created

      const res = await request(app)
        .post('/api/tasks/1/recurrence/generate')
        .set('Authorization', token1)
        .send({ until: '2026-03-03' })
        .expect(201);

      expect(res.body.generated).toBe(1);
    });
  });

  describe('POST /api/tasks/:id/recurrence/skip', () => {
    it('should skip (soft-delete) a recurrence instance', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 5, recurrence_id: 1 }] }) // task with recurrence_id
        .mockResolvedValueOnce({ rows: [{ id: 5, deleted_at: '2026-03-01' }] });

      const res = await request(app)
        .post('/api/tasks/5/recurrence/skip')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.deleted_at).toBeTruthy();
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/tasks/99/recurrence/skip')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 400 if task is not a recurrence instance', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, recurrence_id: null }] });

      await request(app)
        .post('/api/tasks/1/recurrence/skip')
        .set('Authorization', token1)
        .expect(400);
    });
  });

  describe('POST /api/tasks/:id/recurrence/detach', () => {
    it('should detach instance from series', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 5, recurrence_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 5, recurrence_id: null }] });

      const res = await request(app)
        .post('/api/tasks/5/recurrence/detach')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.recurrence_id).toBeNull();
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/tasks/99/recurrence/detach')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 400 if task is not a recurrence instance', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1, recurrence_id: null }] });

      await request(app)
        .post('/api/tasks/1/recurrence/detach')
        .set('Authorization', token1)
        .expect(400);
    });
  });
});

describe('generateDates', () => {
  it('should generate daily dates', () => {
    const rule = { frequency: 'daily', interval: 1, days_of_week: null, end_date: null };
    const dates = generateDates('2026-03-01', rule, new Date('2026-03-05T00:00:00'));

    expect(dates).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']);
  });

  it('should generate daily dates with interval', () => {
    const rule = { frequency: 'daily', interval: 3, days_of_week: null, end_date: null };
    const dates = generateDates('2026-03-01', rule, new Date('2026-03-10T00:00:00'));

    expect(dates).toEqual(['2026-03-04', '2026-03-07', '2026-03-10']);
  });

  it('should generate weekly dates', () => {
    const rule = { frequency: 'weekly', interval: 1, days_of_week: null, end_date: null };
    const dates = generateDates('2026-03-01', rule, new Date('2026-03-22T00:00:00'));

    expect(dates).toEqual(['2026-03-08', '2026-03-15', '2026-03-22']);
  });

  it('should generate weekly dates with specific days', () => {
    const rule = { frequency: 'weekly', interval: 1, days_of_week: [1, 3, 5], end_date: null }; // Mon, Wed, Fri
    // 2026-03-02 is Monday
    const dates = generateDates('2026-03-02', rule, new Date('2026-03-09T00:00:00'));

    // Should include Wed Mar 4, Fri Mar 6, Mon Mar 9
    expect(dates).toEqual(['2026-03-04', '2026-03-06', '2026-03-09']);
  });

  it('should generate monthly dates', () => {
    const rule = { frequency: 'monthly', interval: 1, days_of_week: null, end_date: null };
    const dates = generateDates('2026-01-15', rule, new Date('2026-04-15T00:00:00'));

    expect(dates).toEqual(['2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('should generate yearly dates', () => {
    const rule = { frequency: 'yearly', interval: 1, days_of_week: null, end_date: null };
    const dates = generateDates('2024-06-01', rule, new Date('2027-06-01T00:00:00'));

    expect(dates).toEqual(['2025-06-01', '2026-06-01', '2027-06-01']);
  });

  it('should respect end_date', () => {
    const rule = { frequency: 'daily', interval: 1, days_of_week: null, end_date: '2026-03-03' };
    const dates = generateDates('2026-03-01', rule, new Date('2026-03-10T00:00:00'));

    expect(dates).toEqual(['2026-03-02', '2026-03-03']);
  });

  it('should return empty for date past end_date', () => {
    const rule = { frequency: 'daily', interval: 1, days_of_week: null, end_date: '2026-03-01' };
    const dates = generateDates('2026-03-01', rule, new Date('2026-03-10T00:00:00'));

    expect(dates).toEqual([]);
  });
});

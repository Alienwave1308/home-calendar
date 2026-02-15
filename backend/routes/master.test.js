const request = require('supertest');
const app = require('../server');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

// Mock nanoid to return predictable values
jest.mock('nanoid', () => ({
  nanoid: () => 'abc123test'
}));

const token = jwt.sign({ id: 1, username: 'master1' }, JWT_SECRET);
const authHeader = `Bearer ${token}`;

const masterRow = {
  id: 1, user_id: 1, display_name: 'Мастер Анна', timezone: 'Europe/Moscow',
  booking_slug: 'abc123test', cancel_policy_hours: 24, created_at: new Date()
};

describe('Master API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // === SETUP ===

  describe('POST /api/master/setup', () => {
    it('should create master profile', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // no existing master
        .mockResolvedValueOnce({ rows: [masterRow] }); // insert

      const res = await request(app)
        .post('/api/master/setup')
        .set('Authorization', authHeader)
        .send({ display_name: 'Мастер Анна' })
        .expect(201);

      expect(res.body.display_name).toBe('Мастер Анна');
      expect(res.body.booking_slug).toBe('abc123test');
    });

    it('should return 400 if display_name is missing', async () => {
      await request(app)
        .post('/api/master/setup')
        .set('Authorization', authHeader)
        .send({})
        .expect(400);
    });

    it('should return 409 if already a master', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // existing master

      await request(app)
        .post('/api/master/setup')
        .set('Authorization', authHeader)
        .send({ display_name: 'Мастер Анна' })
        .expect(409);
    });

    it('should return 401 without token', async () => {
      await request(app)
        .post('/api/master/setup')
        .send({ display_name: 'Test' })
        .expect(401);
    });
  });

  // === PROFILE ===

  describe('GET /api/master/profile', () => {
    it('should return master profile', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      const res = await request(app)
        .get('/api/master/profile')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.display_name).toBe('Мастер Анна');
      expect(res.body.booking_slug).toBe('abc123test');
    });

    it('should return 404 if not a master', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/master/profile')
        .set('Authorization', authHeader)
        .expect(404);
    });
  });

  describe('PUT /api/master/profile', () => {
    it('should update master profile', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [{ ...masterRow, display_name: 'Новое имя' }] });

      const res = await request(app)
        .put('/api/master/profile')
        .set('Authorization', authHeader)
        .send({ display_name: 'Новое имя' })
        .expect(200);

      expect(res.body.display_name).toBe('Новое имя');
    });

    it('should return 400 if no fields', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] }); // loadMaster

      await request(app)
        .put('/api/master/profile')
        .set('Authorization', authHeader)
        .send({})
        .expect(400);
    });

    it('should reject short display_name', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] }); // loadMaster

      await request(app)
        .put('/api/master/profile')
        .set('Authorization', authHeader)
        .send({ display_name: 'A' })
        .expect(400);
    });
  });

  // === SERVICES ===

  describe('POST /api/master/services', () => {
    it('should create a service', async () => {
      const svc = { id: 1, master_id: 1, name: 'Маникюр', duration_minutes: 60, price: 2000, is_active: true };
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [svc] });

      const res = await request(app)
        .post('/api/master/services')
        .set('Authorization', authHeader)
        .send({ name: 'Маникюр', duration_minutes: 60, price: 2000 })
        .expect(201);

      expect(res.body.name).toBe('Маникюр');
      expect(res.body.duration_minutes).toBe(60);
    });

    it('should return 400 if name is missing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .post('/api/master/services')
        .set('Authorization', authHeader)
        .send({ duration_minutes: 60 })
        .expect(400);
    });

    it('should return 400 if duration too short', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .post('/api/master/services')
        .set('Authorization', authHeader)
        .send({ name: 'Test', duration_minutes: 3 })
        .expect(400);
    });
  });

  describe('GET /api/master/services', () => {
    it('should list services', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Маникюр' }, { id: 2, name: 'Педикюр' }] });

      const res = await request(app)
        .get('/api/master/services')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });
  });

  describe('PUT /api/master/services/:id', () => {
    it('should update a service', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // ownership check
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Маникюр+', duration_minutes: 90 }] });

      const res = await request(app)
        .put('/api/master/services/1')
        .set('Authorization', authHeader)
        .send({ name: 'Маникюр+', duration_minutes: 90 })
        .expect(200);

      expect(res.body.name).toBe('Маникюр+');
    });

    it('should return 404 for unknown service', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [] }); // not found

      await request(app)
        .put('/api/master/services/999')
        .set('Authorization', authHeader)
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /api/master/services/:id', () => {
    it('should deactivate a service', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1, is_active: false }] });

      const res = await request(app)
        .delete('/api/master/services/1')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.is_active).toBe(false);
    });
  });

  // === AVAILABILITY ===

  describe('POST /api/master/availability', () => {
    it('should create availability rule', async () => {
      const rule = { id: 1, master_id: 1, day_of_week: 1, start_time: '09:00', end_time: '18:00', slot_granularity_minutes: 30 };
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [rule] });

      const res = await request(app)
        .post('/api/master/availability')
        .set('Authorization', authHeader)
        .send({ day_of_week: 1, start_time: '09:00', end_time: '18:00' })
        .expect(201);

      expect(res.body.day_of_week).toBe(1);
    });

    it('should reject invalid day_of_week', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .post('/api/master/availability')
        .set('Authorization', authHeader)
        .send({ day_of_week: 8, start_time: '09:00', end_time: '18:00' })
        .expect(400);
    });
  });

  describe('GET /api/master/availability', () => {
    it('should list availability rules', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1, day_of_week: 1 }, { id: 2, day_of_week: 2 }] });

      const res = await request(app)
        .get('/api/master/availability')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });
  });

  describe('DELETE /api/master/availability/:id', () => {
    it('should delete a rule', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await request(app)
        .delete('/api/master/availability/1')
        .set('Authorization', authHeader)
        .expect(200);
    });

    it('should return 404 for unknown rule', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/master/availability/999')
        .set('Authorization', authHeader)
        .expect(404);
    });
  });

  // === EXCLUSIONS ===

  describe('POST /api/master/availability/exclusions', () => {
    it('should create exclusion', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1, date: '2026-03-01', reason: 'Отпуск' }] });

      const res = await request(app)
        .post('/api/master/availability/exclusions')
        .set('Authorization', authHeader)
        .send({ date: '2026-03-01', reason: 'Отпуск' })
        .expect(201);

      expect(res.body.reason).toBe('Отпуск');
    });

    it('should return 400 if date is missing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .post('/api/master/availability/exclusions')
        .set('Authorization', authHeader)
        .send({})
        .expect(400);
    });

    it('should return 409 for duplicate date', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockRejectedValueOnce({ code: '23505' });

      await request(app)
        .post('/api/master/availability/exclusions')
        .set('Authorization', authHeader)
        .send({ date: '2026-03-01' })
        .expect(409);
    });
  });

  describe('GET /api/master/availability/exclusions', () => {
    it('should list exclusions', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1, date: '2026-03-01' }] });

      const res = await request(app)
        .get('/api/master/availability/exclusions')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });
  });

  // === SLOTS PREVIEW ===

  describe('GET /api/master/availability/preview', () => {
    it('should return 400 without required params', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .get('/api/master/availability/preview')
        .set('Authorization', authHeader)
        .expect(400);
    });

    it('should return 404 for unknown service', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [] }); // service not found

      await request(app)
        .get('/api/master/availability/preview?service_id=999&date_from=2026-03-01&date_to=2026-03-02')
        .set('Authorization', authHeader)
        .expect(404);
    });

    it('should return slots for valid request', async () => {
      const service = { id: 1, duration_minutes: 60, buffer_before_minutes: 0, buffer_after_minutes: 0 };
      const rules = [{ day_of_week: 1, start_time: '09:00', end_time: '12:00', slot_granularity_minutes: 60 }];

      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [service] }) // service
        .mockResolvedValueOnce({ rows: rules }) // rules
        .mockResolvedValueOnce({ rows: [] }) // exclusions
        .mockResolvedValueOnce({ rows: [] }) // bookings
        .mockResolvedValueOnce({ rows: [] }); // blocks

      // 2026-03-02 is a Monday (day_of_week=1)
      const res = await request(app)
        .get('/api/master/availability/preview?service_id=1&date_from=2026-03-02&date_to=2026-03-02')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.slots.length).toBeGreaterThan(0);
    });
  });
});

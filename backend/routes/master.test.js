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

jest.mock('../lib/reminders', () => ({
  createReminders: jest.fn(),
  deleteReminders: jest.fn(),
  processPendingReminders: jest.fn(),
  isQuietHours: jest.fn()
}));

jest.mock('../lib/telegram-notify', () => ({
  notifyMasterBookingEvent: jest.fn().mockResolvedValue({ ok: true }),
  notifyClientBookingEvent: jest.fn().mockResolvedValue({ ok: true })
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

  describe('POST /api/master/services/bootstrap-default', () => {
    it('should seed default services for empty master catalog', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // existing count
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValue({
          rows: [{ id: 100, master_id: 1, name: 'Сахар: Бёдра', duration_minutes: 40, price: 900, is_active: true }]
        }); // inserts + COMMIT

      const res = await request(app)
        .post('/api/master/services/bootstrap-default')
        .set('Authorization', authHeader)
        .send({})
        .expect(201);

      expect(res.body.inserted_count).toBeGreaterThan(20);
      expect(res.body.overwrite).toBe(false);
      expect(Array.isArray(res.body.services)).toBe(true);
    });

    it('should return 409 when services already exist without overwrite', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [{ total: 2 }] }); // existing count

      const res = await request(app)
        .post('/api/master/services/bootstrap-default')
        .set('Authorization', authHeader)
        .send({})
        .expect(409);

      expect(res.body.active_services).toBe(2);
    });

    it('should overwrite existing services when overwrite=true', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [{ total: 3 }] }) // existing count
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // deactivate old
        .mockResolvedValue({
          rows: [{ id: 101, master_id: 1, name: 'Воск: Ноги полностью', duration_minutes: 60, price: 2000, is_active: true }]
        }); // inserts + COMMIT

      const res = await request(app)
        .post('/api/master/services/bootstrap-default')
        .set('Authorization', authHeader)
        .send({ overwrite: true })
        .expect(201);

      expect(res.body.overwrite).toBe(true);
      expect(res.body.inserted_count).toBeGreaterThan(20);
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

  // === BOOKINGS (Master management) ===

  describe('GET /api/master/bookings', () => {
    it('should list bookings', async () => {
      const bookings = [
        { id: 1, status: 'confirmed', service_name: 'Маникюр', client_name: 'client1' },
        { id: 2, status: 'pending', service_name: 'Педикюр', client_name: 'client2' }
      ];
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: bookings });

      const res = await request(app)
        .get('/api/master/bookings')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it('should filter bookings by status', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'confirmed' }] });

      const res = await request(app)
        .get('/api/master/bookings?status=confirmed')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });
  });

  describe('GET /api/master/calendar', () => {
    it('should return bookings and blocks', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'confirmed' }] }) // bookings
        .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Обед' }] }); // blocks

      const res = await request(app)
        .get('/api/master/calendar?date_from=2026-03-02&date_to=2026-03-08')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.bookings).toHaveLength(1);
      expect(res.body.blocks).toHaveLength(1);
    });

    it('should return 400 without dates', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .get('/api/master/calendar')
        .set('Authorization', authHeader)
        .expect(400);
    });
  });

  describe('GET /api/master/clients', () => {
    it('should return clients aggregated from bookings', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({
          rows: [{
            user_id: 2,
            username: 'tg_123456',
            telegram_user_id: 123456,
            bookings_total: 4,
            upcoming_total: 1,
            last_booking_at: '2026-03-02T10:00:00.000Z'
          }]
        });

      const res = await request(app)
        .get('/api/master/clients')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].telegram_user_id).toBe(123456);
      expect(res.body[0].bookings_total).toBe(4);
    });
  });

  describe('GET /api/master/clients/:client_id/bookings', () => {
    it('should return selected client booking history', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({
          rows: [{ id: 1, client_id: 2, service_name: 'Шугаринг', status: 'confirmed' }]
        });

      const res = await request(app)
        .get('/api/master/clients/2/bookings')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].service_name).toBe('Шугаринг');
    });

    it('should reject invalid client_id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] }); // loadMaster

      await request(app)
        .get('/api/master/clients/abc/bookings')
        .set('Authorization', authHeader)
        .expect(400);
    });
  });

  describe('PATCH /api/master/bookings/:id', () => {
    it('should update booking status', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending' }] }) // find booking
        .mockResolvedValueOnce({ rows: [{ id: 1, status: 'confirmed' }] }); // update

      const res = await request(app)
        .patch('/api/master/bookings/1')
        .set('Authorization', authHeader)
        .send({ status: 'confirmed' })
        .expect(200);

      expect(res.body.status).toBe('confirmed');
    });

    it('should return 404 for unknown booking', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .patch('/api/master/bookings/999')
        .set('Authorization', authHeader)
        .send({ status: 'confirmed' })
        .expect(404);
    });

    it('should reject invalid status', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await request(app)
        .patch('/api/master/bookings/1')
        .set('Authorization', authHeader)
        .send({ status: 'invalid' })
        .expect(400);
    });

    it('should update master_note', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, master_note: 'Заметка' }] });

      const res = await request(app)
        .patch('/api/master/bookings/1')
        .set('Authorization', authHeader)
        .send({ master_note: 'Заметка' })
        .expect(200);

      expect(res.body.master_note).toBe('Заметка');
    });

    it('should return 400 if no fields', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await request(app)
        .patch('/api/master/bookings/1')
        .set('Authorization', authHeader)
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/master/bookings', () => {
    it('should create booking manually', async () => {
      const service = { id: 1, duration_minutes: 60 };
      const booking = { id: 1, master_id: 1, client_id: 2, status: 'confirmed', source: 'admin_created' };
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [service] }) // service
        .mockResolvedValueOnce({ rows: [booking] }); // insert

      const res = await request(app)
        .post('/api/master/bookings')
        .set('Authorization', authHeader)
        .send({ client_id: 2, service_id: 1, start_at: '2026-03-02T10:00:00Z' })
        .expect(201);

      expect(res.body.source).toBe('admin_created');
      expect(res.body.status).toBe('confirmed');
    });

    it('should return 400 if fields are missing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .post('/api/master/bookings')
        .set('Authorization', authHeader)
        .send({ client_id: 2 })
        .expect(400);
    });

    it('should return 404 for unknown service', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/master/bookings')
        .set('Authorization', authHeader)
        .send({ client_id: 2, service_id: 999, start_at: '2026-03-02T10:00:00Z' })
        .expect(404);
    });

    it('should return 409 on time conflict', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1, duration_minutes: 60 }] })
        .mockRejectedValueOnce({ code: '23P01' }); // exclusion constraint

      await request(app)
        .post('/api/master/bookings')
        .set('Authorization', authHeader)
        .send({ client_id: 2, service_id: 1, start_at: '2026-03-02T10:00:00Z' })
        .expect(409);
    });

    it('should reject invalid status', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .post('/api/master/bookings')
        .set('Authorization', authHeader)
        .send({ client_id: 2, service_id: 1, start_at: '2026-03-02T10:00:00Z', status: 'invalid' })
        .expect(400);
    });
  });

  describe('PUT /api/master/bookings/:id', () => {
    it('should edit booking fields', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({
          rows: [{ id: 1, service_id: 1, start_at: '2026-03-02T10:00:00.000Z', duration_minutes: 60 }]
        }) // current booking
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // client exists
        .mockResolvedValueOnce({
          rows: [{ id: 1, client_id: 2, status: 'completed', master_note: 'Готово' }]
        }); // update

      const res = await request(app)
        .put('/api/master/bookings/1')
        .set('Authorization', authHeader)
        .send({
          client_id: 2,
          start_at: '2026-03-02T11:00:00Z',
          status: 'completed',
          master_note: 'Готово'
        })
        .expect(200);

      expect(res.body.status).toBe('completed');
      expect(res.body.master_note).toBe('Готово');
    });

    it('should return 404 for unknown booking', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/master/bookings/999')
        .set('Authorization', authHeader)
        .send({ status: 'confirmed' })
        .expect(404);
    });

    it('should reject invalid status', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, service_id: 1, start_at: '2026-03-02T10:00:00.000Z', duration_minutes: 60 }]
        });

      await request(app)
        .put('/api/master/bookings/1')
        .set('Authorization', authHeader)
        .send({ status: 'invalid' })
        .expect(400);
    });

    it('should return 404 for unknown service', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, service_id: 1, start_at: '2026-03-02T10:00:00.000Z', duration_minutes: 60 }]
        })
        .mockResolvedValueOnce({ rows: [] }); // service missing

      await request(app)
        .put('/api/master/bookings/1')
        .set('Authorization', authHeader)
        .send({ service_id: 999 })
        .expect(404);
    });

    it('should return 409 on time conflict', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, service_id: 1, start_at: '2026-03-02T10:00:00.000Z', duration_minutes: 60 }]
        })
        .mockRejectedValueOnce({ code: '23P01' });

      await request(app)
        .put('/api/master/bookings/1')
        .set('Authorization', authHeader)
        .send({ start_at: '2026-03-02T10:30:00Z' })
        .expect(409);
    });
  });

  // === BLOCKS ===

  describe('GET /api/master/blocks', () => {
    it('should list blocks', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Обед' }, { id: 2, title: 'Личное' }] });

      const res = await request(app)
        .get('/api/master/blocks')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });
  });

  describe('POST /api/master/blocks', () => {
    it('should create a block', async () => {
      const block = { id: 1, master_id: 1, title: 'Обед', start_at: '2026-03-02T12:00:00Z', end_at: '2026-03-02T13:00:00Z' };
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [block] });

      const res = await request(app)
        .post('/api/master/blocks')
        .set('Authorization', authHeader)
        .send({ start_at: '2026-03-02T12:00:00Z', end_at: '2026-03-02T13:00:00Z', title: 'Обед' })
        .expect(201);

      expect(res.body.title).toBe('Обед');
    });

    it('should return 400 if times missing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .post('/api/master/blocks')
        .set('Authorization', authHeader)
        .send({ title: 'Обед' })
        .expect(400);
    });

    it('should reject if start >= end', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .post('/api/master/blocks')
        .set('Authorization', authHeader)
        .send({ start_at: '2026-03-02T13:00:00Z', end_at: '2026-03-02T12:00:00Z' })
        .expect(400);
    });
  });

  describe('PUT /api/master/blocks/:id', () => {
    it('should update a block', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // find
        .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Новый' }] });

      const res = await request(app)
        .put('/api/master/blocks/1')
        .set('Authorization', authHeader)
        .send({ title: 'Новый' })
        .expect(200);

      expect(res.body.title).toBe('Новый');
    });

    it('should return 404 for unknown block', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/master/blocks/999')
        .set('Authorization', authHeader)
        .send({ title: 'X' })
        .expect(404);
    });
  });

  describe('DELETE /api/master/blocks/:id', () => {
    it('should delete a block', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await request(app)
        .delete('/api/master/blocks/1')
        .set('Authorization', authHeader)
        .expect(200);
    });

    it('should return 404 for unknown block', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/master/blocks/999')
        .set('Authorization', authHeader)
        .expect(404);
    });
  });

  // === SETTINGS ===

  describe('GET /api/master/settings', () => {
    it('should return defaults when no settings exist', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [] }); // no settings row

      const res = await request(app)
        .get('/api/master/settings')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.reminder_hours).toEqual([24, 2]);
      expect(res.body.quiet_hours_start).toBeNull();
      expect(res.body.quiet_hours_end).toBeNull();
      expect(res.body.apple_calendar_enabled).toBe(false);
      expect(res.body.apple_calendar_token).toBeNull();
    });

    it('should return saved settings', async () => {
      const settings = {
        master_id: 1, reminder_hours: [48, 12, 1],
        quiet_hours_start: '22:00', quiet_hours_end: '08:00'
      };
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [settings] });

      const res = await request(app)
        .get('/api/master/settings')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.reminder_hours).toEqual([48, 12, 1]);
      expect(res.body.quiet_hours_start).toBe('22:00');
    });
  });

  describe('PUT /api/master/settings', () => {
    it('should upsert settings', async () => {
      const saved = {
        master_id: 1, reminder_hours: [12, 1],
        quiet_hours_start: '23:00', quiet_hours_end: '07:00'
      };
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [saved] });

      const res = await request(app)
        .put('/api/master/settings')
        .set('Authorization', authHeader)
        .send({ reminder_hours: [12, 1], quiet_hours_start: '23:00', quiet_hours_end: '07:00' })
        .expect(200);

      expect(res.body.reminder_hours).toEqual([12, 1]);
      expect(res.body.quiet_hours_start).toBe('23:00');
    });

    it('should reject non-array reminder_hours', async () => {
      pool.query.mockResolvedValueOnce({ rows: [masterRow] });

      await request(app)
        .put('/api/master/settings')
        .set('Authorization', authHeader)
        .send({ reminder_hours: 'not-array' })
        .expect(400);
    });
  });

  describe('Apple Calendar settings', () => {
    it('should enable apple calendar feed', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({ rows: [] }) // existing token
        .mockResolvedValueOnce({
          rows: [{ master_id: 1, apple_calendar_enabled: true, apple_calendar_token: 'abc' }]
        });

      const res = await request(app)
        .post('/api/master/settings/apple-calendar/enable')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.apple_calendar_enabled).toBe(true);
      expect(res.body.apple_calendar_token).toBeDefined();
    });

    it('should rotate apple calendar token', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({
          rows: [{ master_id: 1, apple_calendar_enabled: true, apple_calendar_token: 'new-token' }]
        });

      const res = await request(app)
        .post('/api/master/settings/apple-calendar/rotate')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.apple_calendar_enabled).toBe(true);
      expect(res.body.apple_calendar_token).toBeDefined();
    });

    it('should disable apple calendar feed', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] })
        .mockResolvedValueOnce({ rows: [{ master_id: 1, apple_calendar_enabled: false }] });

      const res = await request(app)
        .delete('/api/master/settings/apple-calendar')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.apple_calendar_enabled).toBe(false);
    });
  });

  describe('GET /api/master/leads/metrics', () => {
    it('should return current/previous lead metrics with conversion', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({
          rows: [{
            current_start_local: '2026-02-21T00:00:00.000Z',
            current_end_local: '2026-02-22T00:00:00.000Z',
            previous_start_local: '2026-02-20T00:00:00.000Z',
            previous_end_local: '2026-02-21T00:00:00.000Z'
          }]
        })
        .mockResolvedValueOnce({
          rows: [{ visitors: 20, booking_started: 8, booking_created: 5 }]
        })
        .mockResolvedValueOnce({
          rows: [{ visitors: 10, booking_started: 4, booking_created: 2 }]
        });

      const res = await request(app)
        .get('/api/master/leads/metrics?period=day')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.period).toBe('day');
      expect(res.body.data_source).toBe('current_entities_proxy');
      expect(res.body.current.metrics.visitors).toBe(20);
      expect(res.body.previous.metrics.booking_created).toBe(2);
      expect(res.body.current.conversion.visit_to_booking_created).toBe(25);
    });

    it('should fallback to day period and return zero metrics when no data', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({
          rows: [{
            current_start_local: '2026-02-21T00:00:00.000Z',
            current_end_local: '2026-02-22T00:00:00.000Z',
            previous_start_local: '2026-02-20T00:00:00.000Z',
            previous_end_local: '2026-02-21T00:00:00.000Z'
          }]
        })
        .mockResolvedValueOnce({ rows: [{}] })
        .mockResolvedValueOnce({ rows: [{}] });

      const res = await request(app)
        .get('/api/master/leads/metrics?period=unknown')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.period).toBe('day');
      expect(res.body.current.metrics).toEqual({
        visitors: 0,
        auth_started: 0,
        auth_success: 0,
        booking_started: 0,
        booking_created: 0
      });
      expect(res.body.current.conversion.visit_to_booking_created).toBeNull();
    });
  });

  describe('GET /api/master/leads/registrations', () => {
    it('should return telegram registrations for selected period', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [masterRow] }) // loadMaster
        .mockResolvedValueOnce({
          rows: [{
            current_start_local: '2026-02-21T00:00:00.000Z',
            current_end_local: '2026-02-22T00:00:00.000Z',
            previous_start_local: '2026-02-20T00:00:00.000Z',
            previous_end_local: '2026-02-21T00:00:00.000Z'
          }]
        })
        .mockResolvedValueOnce({
          rows: [{
            user_id: 101,
            username: 'tg_123456',
            telegram_username: 'irina_client',
            display_name: 'Ирина',
            avatar_url: 'https://example.com/avatar.jpg',
            telegram_user_id: 123456,
            registered_at: '2026-02-21T10:00:00.000Z',
            bookings_total: 2,
            first_booking_created_at: '2026-02-21T10:15:00.000Z'
          }]
        });

      const res = await request(app)
        .get('/api/master/leads/registrations?period=day')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.period).toBe('day');
      expect(Array.isArray(res.body.users)).toBe(true);
      expect(res.body.users[0].username).toBe('tg_123456');
      expect(res.body.users[0].telegram_username).toBe('irina_client');
      expect(res.body.users[0].avatar_url).toBe('https://example.com/avatar.jpg');
      expect(res.body.users[0].telegram_user_id).toBe(123456);
    });
  });
});

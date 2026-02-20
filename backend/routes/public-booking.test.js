const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

jest.mock('../lib/reminders', () => ({
  createReminders: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../lib/telegram-notify', () => ({
  notifyMasterBookingEvent: jest.fn().mockResolvedValue({ ok: true })
}));

describe('Public Booking API', () => {
  const token = jwt.sign({ id: 42, username: 'tg_42' }, JWT_SECRET, { expiresIn: '1h' });
  const authHeader = `Bearer ${token}`;

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
  });

  it('should return master profile and active services by slug', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Мастер', timezone: 'Europe/Moscow', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 11, master_id: 3, name: 'Шугаринг', duration_minutes: 60 }]
      })
      .mockResolvedValueOnce({
        rows: [{ reminder_hours: [24, 2], first_visit_discount_percent: 15, min_booking_notice_minutes: 60 }]
      });

    const res = await request(app)
      .get('/api/public/master/master-slug')
      .expect(200);

    expect(res.body.master.display_name).toBe('Мастер');
    expect(res.body.services).toHaveLength(1);
  });

  it('should return 400 when slot query params are missing', async () => {
    await request(app)
      .get('/api/public/master/master-slug/slots')
      .expect(400);
  });

  it('should return 400 when booking export ics params are missing', async () => {
    const res = await request(app)
      .get('/api/public/export/booking.ics')
      .expect(400);

    expect(res.body.error).toContain('start_at and end_at are required');
  });

  it('should return single-event ics export with valid params', async () => {
    const res = await request(app)
      .get('/api/public/export/booking.ics')
      .query({
        title: 'Запись на депиляцию: Ноги',
        details: 'Комментарий клиента: тест',
        start_at: '2026-03-05T10:00:00.000Z',
        end_at: '2026-03-05T11:00:00.000Z',
        timezone: 'Asia/Novosibirsk'
      })
      .expect(200);

    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('SUMMARY:Запись на депиляцию: Ноги');
    expect(res.text).toContain('X-WR-TIMEZONE:Asia/Novosibirsk');
  });

  it('should require auth for booking creation', async () => {
    await request(app)
      .post('/api/public/master/master-slug/book')
      .send({ service_id: 1, start_at: new Date().toISOString() })
      .expect(401);
  });

  it('should create booking for authenticated client', async () => {
    const startAt = '2026-03-05T10:00:00.000Z';
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Мастер', timezone: 'Asia/Novosibirsk', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 11, master_id: 3, name: 'Шугаринг', duration_minutes: 60, is_active: true }]
      })
      .mockResolvedValueOnce({
        rows: [{ reminder_hours: [24, 2], first_visit_discount_percent: 15, min_booking_notice_minutes: 60 }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1 }]
      })
      .mockResolvedValueOnce({
        rows: [{ active_count: 0 }]
      })
      .mockResolvedValueOnce({
        rows: []
      })
      .mockResolvedValueOnce({
        rows: [{ id: 99, master_id: 3, client_id: 42, service_id: 11, start_at: startAt, status: 'confirmed' }]
      });

    const res = await request(app)
      .post('/api/public/master/master-slug/book')
      .set('Authorization', authHeader)
      .send({ service_id: 11, start_at: startAt, client_note: 'Зона: ноги' })
      .expect(201);

    expect(res.body.id).toBe(99);
    expect(pool.query).toHaveBeenCalledTimes(7);
    expect(res.body.pricing.first_visit_discount_percent).toBe(15);
  });

  it('should block booking creation when client already has 3 active bookings', async () => {
    const startAt = '2026-03-05T10:00:00.000Z';
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Мастер', timezone: 'Asia/Novosibirsk', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 11, master_id: 3, name: 'Шугаринг', duration_minutes: 60, is_active: true }]
      })
      .mockResolvedValueOnce({
        rows: [{ reminder_hours: [24, 2], first_visit_discount_percent: 15, min_booking_notice_minutes: 60 }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 1 }]
      })
      .mockResolvedValueOnce({
        rows: [{ active_count: 3 }]
      });

    const res = await request(app)
      .post('/api/public/master/master-slug/book')
      .set('Authorization', authHeader)
      .send({ service_id: 11, start_at: startAt, client_note: 'Зона: ноги' })
      .expect(429);

    expect(res.body.error).toContain('3 активные записи');
    expect(res.body.error).toContain('@RoVVVVa');
  });

  it('should return 403 for apple calendar feed with invalid token', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Мастер', timezone: 'Europe/Moscow', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({
        rows: [{ apple_calendar_enabled: true, apple_calendar_token: 'valid-token' }]
      });

    await request(app)
      .get('/api/public/master/master-slug/calendar.ics?token=bad-token')
      .expect(403);
  });

  it('should return ics feed for valid apple token', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Мастер', timezone: 'Europe/Moscow', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({
        rows: [{ apple_calendar_enabled: true, apple_calendar_token: 'valid-token' }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 55,
          start_at: '2026-03-05T10:00:00.000Z',
          end_at: '2026-03-05T11:00:00.000Z',
          client_note: 'Тест',
          master_note: null,
          service_name: 'Шугаринг',
          client_name: 'tg_42',
          status: 'confirmed'
        }]
      });

    const res = await request(app)
      .get('/api/public/master/master-slug/calendar.ics?token=valid-token')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('UID:booking-55@rova-epil.ru');
    expect(res.text).toContain('SUMMARY:Запись: Шугаринг');
  });

  it('should return 403 for client calendar feed with invalid token', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Мастер', timezone: 'Europe/Moscow', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({ rows: [] });

    await request(app)
      .get('/api/public/master/master-slug/client-calendar.ics?token=bad-token')
      .expect(403);
  });

  it('should return client calendar feed scoped only to token owner', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Лера', timezone: 'Asia/Novosibirsk', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({ rows: [{ client_id: 42 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          start_at: '2026-03-05T10:00:00.000Z',
          end_at: '2026-03-05T11:00:00.000Z',
          client_note: 'Только моя запись',
          service_name: 'Воск: Ноги полностью',
          status: 'confirmed'
        }]
      });

    const res = await request(app)
      .get('/api/public/master/master-slug/client-calendar.ics?token=client-token')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toContain('BEGIN:VCALENDAR');
    expect(res.text).toContain('UID:client-booking-77@rova-epil.ru');
    expect(res.text).toContain('SUMMARY:Запись: Воск: Ноги полностью');
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('AND b.client_id = $2'),
      [3, 42]
    );
  });

  // ===== Multi-service booking tests =====

  it('should create multi-service booking with service_ids array and sum duration+price', async () => {
    const startAt = '2026-03-05T10:00:00.000Z';
    pool.query
      // loadMasterBySlug
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Лера', timezone: 'Asia/Novosibirsk', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      // loadService for id=11 (Бёдра, 40мин, 900р) — parallel
      .mockResolvedValueOnce({
        rows: [{ id: 11, master_id: 3, name: 'Сахар: Бёдра', duration_minutes: 40, price: 900, is_active: true }]
      })
      // loadService for id=12 (Голень, 35мин, 800р) — parallel
      .mockResolvedValueOnce({
        rows: [{ id: 12, master_id: 3, name: 'Сахар: Голень', duration_minutes: 35, price: 800, is_active: true }]
      })
      // loadMasterSettings
      .mockResolvedValueOnce({
        rows: [{ reminder_hours: [24, 2], first_visit_discount_percent: 15, min_booking_notice_minutes: 60 }]
      })
      // window coverage check (total duration = 75 min)
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      // active bookings count
      .mockResolvedValueOnce({ rows: [{ active_count: 0 }] })
      // first booking check → no previous → first visit → discount 15%
      .mockResolvedValueOnce({ rows: [] })
      // INSERT
      .mockResolvedValueOnce({
        rows: [{ id: 100, master_id: 3, client_id: 42, service_id: 11, extra_service_ids: '[12]', start_at: startAt, status: 'confirmed' }]
      });

    const res = await request(app)
      .post('/api/public/master/master-slug/book')
      .set('Authorization', authHeader)
      .send({ service_ids: [11, 12], start_at: startAt })
      .expect(201);

    expect(res.body.id).toBe(100);
    // Total duration: 40 + 35 = 75 min → end_at should be 75 min after start
    const insertCall = pool.query.mock.calls[7];
    expect(insertCall[0]).toContain('INSERT INTO bookings');
    // end_at = startAt + 75 min
    const expectedEnd = new Date(new Date(startAt).getTime() + 75 * 60000).toISOString();
    expect(insertCall[1][5]).toBe(expectedEnd);
    // primary service_id = 11
    expect(insertCall[1][2]).toBe(11);
    // extra_service_ids = [12]
    expect(JSON.parse(insertCall[1][3])).toEqual([12]);

    // Pricing: base = 900+800=1700, discount 15%, final = 1700 - 255 = 1445
    expect(res.body.pricing.base_price).toBe(1700);
    expect(res.body.pricing.first_visit_discount_percent).toBe(15);
    expect(res.body.pricing.final_price).toBe(1445);
  });

  it('should return 400 when service_ids is empty', async () => {
    const res = await request(app)
      .post('/api/public/master/master-slug/book')
      .set('Authorization', authHeader)
      .send({ service_ids: [], start_at: '2026-03-05T10:00:00.000Z' })
      .expect(400);

    expect(res.body.error).toContain('service_ids');
  });

  it('should return 404 when one of service_ids does not belong to master', async () => {
    const startAt = '2026-03-05T10:00:00.000Z';
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Лера', timezone: 'Asia/Novosibirsk', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      // first service found
      .mockResolvedValueOnce({
        rows: [{ id: 11, master_id: 3, name: 'Сахар: Бёдра', duration_minutes: 40, price: 900, is_active: true }]
      })
      // second service NOT found (belongs to another master)
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/public/master/master-slug/book')
      .set('Authorization', authHeader)
      .send({ service_ids: [11, 99], start_at: startAt })
      .expect(404);

    expect(res.body.error).toContain('99');
  });

  it('should accept legacy service_id (single) and treat it as service_ids=[id]', async () => {
    const startAt = '2026-03-05T10:00:00.000Z';
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Лера', timezone: 'Asia/Novosibirsk', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 11, master_id: 3, name: 'Шугаринг', duration_minutes: 60, price: 1500, is_active: true }]
      })
      .mockResolvedValueOnce({
        rows: [{ reminder_hours: [24, 2], first_visit_discount_percent: 0, min_booking_notice_minutes: 60 }]
      })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ active_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 50 }] }) // has previous booking → no discount
      .mockResolvedValueOnce({
        rows: [{ id: 101, master_id: 3, client_id: 42, service_id: 11, extra_service_ids: '[]', start_at: startAt, status: 'confirmed' }]
      });

    const res = await request(app)
      .post('/api/public/master/master-slug/book')
      .set('Authorization', authHeader)
      .send({ service_id: 11, start_at: startAt })
      .expect(201);

    expect(res.body.id).toBe(101);
    expect(res.body.pricing.base_price).toBe(1500);
    expect(res.body.pricing.first_visit_discount_percent).toBe(0);
  });

  it('slots endpoint: should use duration_minutes override for multi-service', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 3, display_name: 'Лера', timezone: 'Asia/Novosibirsk', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 11, master_id: 3, name: 'Сахар: Бёдра', duration_minutes: 40, price: 900,
          buffer_before_minutes: 0, buffer_after_minutes: 0, is_active: true }]
      })
      .mockResolvedValueOnce({
        rows: [{ reminder_hours: [24, 2], first_visit_discount_percent: 15, min_booking_notice_minutes: 60 }]
      })
      // availability_windows, bookings, blocks — all empty (parallel)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/public/master/master-slug/slots')
      .query({ service_id: 11, date_from: '2026-03-10', date_to: '2026-03-10', duration_minutes: 75 })
      .expect(200);

    expect(res.body).toHaveProperty('slots');
    // slots should be an array (may be empty since windows are empty, but no error)
    expect(Array.isArray(res.body.slots)).toBe(true);
  });
});

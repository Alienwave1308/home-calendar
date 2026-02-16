const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
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
        rows: [{ id: 3, display_name: 'Мастер', timezone: 'Europe/Moscow', booking_slug: 'master-slug', cancel_policy_hours: 24 }]
      })
      .mockResolvedValueOnce({
        rows: [{ id: 11, master_id: 3, name: 'Шугаринг', duration_minutes: 60, is_active: true }]
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
    expect(pool.query).toHaveBeenCalledTimes(3);
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
});

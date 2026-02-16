const request = require('supertest');
const app = require('../server');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

// Mock google-calendar lib
jest.mock('../lib/google-calendar', () => ({
  getAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock'),
  handleCallback: jest.fn(),
  getAuthenticatedClient: jest.fn(),
  pushBookingToCalendar: jest.fn(),
  deleteCalendarEvent: jest.fn(),
  pullBusyTimes: jest.fn(),
  disconnectCalendar: jest.fn(),
  createOAuth2Client: jest.fn()
}));

const gcal = require('../lib/google-calendar');

const token = jwt.sign({ id: 1, username: 'master1' }, JWT_SECRET);
const authHeader = `Bearer ${token}`;

describe('Calendar Sync API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/calendar-sync/status', () => {
    it('should return not connected when no binding', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/calendar-sync/status')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.connected).toBe(false);
    });

    it('should return connected with binding info', async () => {
      const binding = { id: 1, provider: 'google', sync_mode: 'push', last_sync_at: null };
      pool.query.mockResolvedValueOnce({ rows: [binding] });

      const res = await request(app)
        .get('/api/calendar-sync/status')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.connected).toBe(true);
      expect(res.body.binding.provider).toBe('google');
    });
  });

  describe('GET /api/calendar-sync/connect', () => {
    it('should return OAuth URL', async () => {
      const res = await request(app)
        .get('/api/calendar-sync/connect')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.url).toContain('https://accounts.google.com');
    });
  });

  describe('GET /api/calendar-sync/callback', () => {
    it('should exchange code and return binding', async () => {
      const binding = { id: 1, provider: 'google' };
      gcal.handleCallback.mockResolvedValueOnce(binding);

      const res = await request(app)
        .get('/api/calendar-sync/callback?code=auth_code&state=1')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.connected).toBe(true);
      expect(gcal.handleCallback).toHaveBeenCalledWith('auth_code', 1);
    });

    it('should return 400 without code', async () => {
      await request(app)
        .get('/api/calendar-sync/callback?state=1')
        .set('Authorization', authHeader)
        .expect(400);
    });

    it('should return 403 on user mismatch', async () => {
      await request(app)
        .get('/api/calendar-sync/callback?code=abc&state=999')
        .set('Authorization', authHeader)
        .expect(403);
    });
  });

  describe('POST /api/calendar-sync/push/:bookingId', () => {
    it('should push booking to Google Calendar', async () => {
      const booking = { id: 1, master_id: 1, service_id: 1, client_id: 2, start_at: '2026-03-02T10:00:00Z', end_at: '2026-03-02T11:00:00Z', status: 'confirmed', service_name: 'Маникюр', client_name: 'Анна' };
      pool.query
        .mockResolvedValueOnce({ rows: [booking] }) // load booking
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // verify master

      gcal.pushBookingToCalendar.mockResolvedValueOnce({ id: 1, external_event_id: 'gcal_1' });

      const res = await request(app)
        .post('/api/calendar-sync/push/1')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.pushed).toBe(true);
    });

    it('should return 404 for unknown booking', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/calendar-sync/push/999')
        .set('Authorization', authHeader)
        .expect(404);
    });

    it('should return 403 if not master of booking', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, master_id: 5 }] }) // booking
        .mockResolvedValueOnce({ rows: [] }); // master check fails

      await request(app)
        .post('/api/calendar-sync/push/1')
        .set('Authorization', authHeader)
        .expect(403);
    });

    it('should return 400 if calendar not connected', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, master_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] });

      gcal.pushBookingToCalendar.mockResolvedValueOnce(null);

      await request(app)
        .post('/api/calendar-sync/push/1')
        .set('Authorization', authHeader)
        .expect(400);
    });
  });

  describe('GET /api/calendar-sync/busy', () => {
    it('should return busy times', async () => {
      gcal.pullBusyTimes.mockResolvedValueOnce([
        { start: '2026-03-02T10:00:00Z', end: '2026-03-02T11:00:00Z' }
      ]);

      const res = await request(app)
        .get('/api/calendar-sync/busy?date_from=2026-03-02&date_to=2026-03-08')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(1);
    });

    it('should return 400 without dates', async () => {
      await request(app)
        .get('/api/calendar-sync/busy')
        .set('Authorization', authHeader)
        .expect(400);
    });
  });

  describe('PUT /api/calendar-sync/settings', () => {
    it('should update sync settings', async () => {
      const updated = { id: 1, sync_mode: 'hybrid', external_calendar_id: 'cal_123' };
      pool.query.mockResolvedValueOnce({ rows: [updated] });

      const res = await request(app)
        .put('/api/calendar-sync/settings')
        .set('Authorization', authHeader)
        .send({ sync_mode: 'hybrid', external_calendar_id: 'cal_123' })
        .expect(200);

      expect(res.body.sync_mode).toBe('hybrid');
    });

    it('should reject invalid sync_mode', async () => {
      await request(app)
        .put('/api/calendar-sync/settings')
        .set('Authorization', authHeader)
        .send({ sync_mode: 'invalid' })
        .expect(400);
    });

    it('should return 404 when not connected', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/calendar-sync/settings')
        .set('Authorization', authHeader)
        .send({ sync_mode: 'push' })
        .expect(404);
    });
  });

  describe('DELETE /api/calendar-sync/disconnect', () => {
    it('should disconnect calendar', async () => {
      gcal.disconnectCalendar.mockResolvedValueOnce();

      const res = await request(app)
        .delete('/api/calendar-sync/disconnect')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.disconnected).toBe(true);
      expect(gcal.disconnectCalendar).toHaveBeenCalledWith(1);
    });
  });
});

const request = require('supertest');
const app = require('../server');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn()
  },
  initDB: jest.fn()
}));

jest.mock('../lib/reminders', () => ({
  createReminders: jest.fn().mockResolvedValue(undefined),
  deleteReminders: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../lib/telegram-notify', () => ({
  notifyMasterBookingEvent: jest.fn().mockResolvedValue({ ok: true })
}));

const token = jwt.sign({ id: 10, username: 'client1' }, JWT_SECRET);
const authHeader = `Bearer ${token}`;

const bookingRow = {
  id: 1, master_id: 1, client_id: 10, service_id: 1,
  start_at: new Date(Date.now() + 48 * 3600000).toISOString(), // 48h from now
  end_at: new Date(Date.now() + 49 * 3600000).toISOString(),
  status: 'confirmed', cancel_policy_hours: 24, duration_minutes: 60
};

describe('Client Bookings API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/client/bookings', () => {
    it('should return client bookings list', async () => {
      pool.query.mockResolvedValueOnce({ rows: [bookingRow] });

      const res = await request(app)
        .get('/api/client/bookings')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(bookingRow.id);
    });
  });

  describe('GET /api/client/bookings/:id', () => {
    it('should return one booking for current client', async () => {
      pool.query.mockResolvedValueOnce({ rows: [bookingRow] });

      const res = await request(app)
        .get('/api/client/bookings/1')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.id).toBe(1);
    });

    it('should return 404 for unknown booking', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/client/bookings/404')
        .set('Authorization', authHeader)
        .expect(404);
    });
  });

  describe('GET /api/client/bookings/:id/calendar-feed', () => {
    it('should return per-client calendar feed path', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1, master_id: 1, booking_slug: 'master-slug' }] })
        .mockResolvedValueOnce({ rows: [{ token: 'client-token-1' }] });

      const res = await request(app)
        .get('/api/client/bookings/1/calendar-feed')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.feed_path).toBe('/api/public/master/master-slug/client-calendar.ics?token=client-token-1');
    });

    it('should return 404 for unknown booking on calendar-feed endpoint', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/client/bookings/404/calendar-feed')
        .set('Authorization', authHeader)
        .expect(404);
    });
  });

  // === CANCEL ===

  describe('PATCH /api/client/bookings/:id/cancel', () => {
    it('should cancel booking within policy', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [bookingRow] }) // load booking
        .mockResolvedValueOnce({ rows: [{ ...bookingRow, status: 'canceled' }] }); // update

      const res = await request(app)
        .patch('/api/client/bookings/1/cancel')
        .set('Authorization', authHeader)
        .expect(200);

      expect(res.body.status).toBe('canceled');
    });

    it('should return 404 for unknown booking', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .patch('/api/client/bookings/999/cancel')
        .set('Authorization', authHeader)
        .expect(404);
    });

    it('should return 400 if already canceled', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ ...bookingRow, status: 'canceled' }]
      });

      await request(app)
        .patch('/api/client/bookings/1/cancel')
        .set('Authorization', authHeader)
        .expect(400);
    });

    it('should return 400 if completed', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ ...bookingRow, status: 'completed' }]
      });

      await request(app)
        .patch('/api/client/bookings/1/cancel')
        .set('Authorization', authHeader)
        .expect(400);
    });

    it('should return 403 if too late to cancel', async () => {
      // Booking starting in 2 hours, policy is 24 hours
      const soonBooking = {
        ...bookingRow,
        start_at: new Date(Date.now() + 2 * 3600000).toISOString(),
        cancel_policy_hours: 24
      };
      pool.query.mockResolvedValueOnce({ rows: [soonBooking] });

      await request(app)
        .patch('/api/client/bookings/1/cancel')
        .set('Authorization', authHeader)
        .expect(403);
    });

    it('should return 401 without token', async () => {
      await request(app)
        .patch('/api/client/bookings/1/cancel')
        .expect(401);
    });
  });

  // === RESCHEDULE ===

  describe('PATCH /api/client/bookings/:id/reschedule', () => {
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    beforeEach(() => {
      pool.connect.mockResolvedValue(mockClient);
      mockClient.query.mockReset();
      mockClient.release.mockReset();
    });

    it('should reschedule booking to new time', async () => {
      const newStart = new Date(Date.now() + 72 * 3600000).toISOString();

      pool.query.mockResolvedValueOnce({ rows: [bookingRow] }); // load booking
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // no conflict
        .mockResolvedValueOnce({ rows: [{ ...bookingRow, start_at: newStart }] }) // update
        .mockResolvedValueOnce({}); // COMMIT

      await request(app)
        .patch('/api/client/bookings/1/reschedule')
        .set('Authorization', authHeader)
        .send({ new_start_at: newStart })
        .expect(200);

      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should return 400 if new_start_at missing', async () => {
      await request(app)
        .patch('/api/client/bookings/1/reschedule')
        .set('Authorization', authHeader)
        .send({})
        .expect(400);
    });

    it('should return 404 for unknown booking', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .patch('/api/client/bookings/999/reschedule')
        .set('Authorization', authHeader)
        .send({ new_start_at: '2026-03-10T10:00:00Z' })
        .expect(404);
    });

    it('should return 400 for canceled booking', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ ...bookingRow, status: 'canceled' }]
      });

      await request(app)
        .patch('/api/client/bookings/1/reschedule')
        .set('Authorization', authHeader)
        .send({ new_start_at: '2026-03-10T10:00:00Z' })
        .expect(400);
    });

    it('should return 403 if too late to reschedule', async () => {
      const soonBooking = {
        ...bookingRow,
        start_at: new Date(Date.now() + 2 * 3600000).toISOString(),
        cancel_policy_hours: 24
      };
      pool.query.mockResolvedValueOnce({ rows: [soonBooking] });

      await request(app)
        .patch('/api/client/bookings/1/reschedule')
        .set('Authorization', authHeader)
        .send({ new_start_at: '2026-03-10T10:00:00Z' })
        .expect(403);
    });

    it('should return 409 on time conflict', async () => {
      pool.query.mockResolvedValueOnce({ rows: [bookingRow] });
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 99 }] }) // conflict found
        .mockResolvedValueOnce({}); // ROLLBACK

      await request(app)
        .patch('/api/client/bookings/1/reschedule')
        .set('Authorization', authHeader)
        .send({ new_start_at: '2026-03-10T10:00:00Z' })
        .expect(409);

      expect(mockClient.release).toHaveBeenCalled();
    });
  });
});

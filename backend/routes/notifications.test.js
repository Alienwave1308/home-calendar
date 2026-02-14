const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { createNotification } = require('./notifications');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

const user1 = { id: 1, username: 'alice' };
const token1 = `Bearer ${jwt.sign(user1, JWT_SECRET, { expiresIn: '1h' })}`;

describe('Notifications API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).get('/api/notifications').expect(401);
  });

  describe('GET /api/notifications', () => {
    it('should return all notifications', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { id: 1, type: 'task_assigned', title: 'New task', is_read: false },
          { id: 2, type: 'comment_added', title: 'New comment', is_read: true }
        ]
      });

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toHaveLength(2);
    });

    it('should filter unread notifications', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, type: 'task_assigned', title: 'New task', is_read: false }]
      });

      const res = await request(app)
        .get('/api/notifications?unread=true')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toHaveLength(1);
      // Verify query includes is_read filter
      const queryCall = pool.query.mock.calls[0];
      expect(queryCall[0]).toContain('is_read = false');
    });
  });

  describe('GET /api/notifications/count', () => {
    it('should return unread count', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ count: '5' }] });

      const res = await request(app)
        .get('/api/notifications/count')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.count).toBe(5);
    });

    it('should return 0 when no unread', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const res = await request(app)
        .get('/api/notifications/count')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.count).toBe(0);
    });
  });

  describe('PUT /api/notifications/:id/read', () => {
    it('should mark notification as read', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, is_read: true }]
      });

      const res = await request(app)
        .put('/api/notifications/1/read')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.is_read).toBe(true);
    });

    it('should return 404 if not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/notifications/99/read')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('PUT /api/notifications/read-all', () => {
    it('should mark all as read', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });

      const res = await request(app)
        .put('/api/notifications/read-all')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.marked).toBe(3);
    });

    it('should return 0 if none unread', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .put('/api/notifications/read-all')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.marked).toBe(0);
    });
  });

  describe('GET /api/notifications/settings', () => {
    it('should return settings with defaults', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ type: 'task_assigned', enabled: false }]
      });

      const res = await request(app)
        .get('/api/notifications/settings')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.task_assigned).toBe(false);
      expect(res.body.comment_added).toBe(true); // default
      expect(res.body.task_due).toBe(true); // default
    });

    it('should return all defaults when no settings saved', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/notifications/settings')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.task_assigned).toBe(true);
      expect(res.body.task_completed).toBe(true);
    });
  });

  describe('PUT /api/notifications/settings', () => {
    it('should update settings', async () => {
      // Each upsert call
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // upsert task_assigned
        .mockResolvedValueOnce({
          rows: [
            { type: 'task_assigned', enabled: false }
          ]
        }); // final select

      const res = await request(app)
        .put('/api/notifications/settings')
        .set('Authorization', token1)
        .send({ task_assigned: false })
        .expect(200);

      expect(res.body.task_assigned).toBe(false);
    });

    it('should return 400 for invalid type', async () => {
      await request(app)
        .put('/api/notifications/settings')
        .set('Authorization', token1)
        .send({ invalid_type: true })
        .expect(400);
    });

    it('should return 400 for non-boolean value', async () => {
      await request(app)
        .put('/api/notifications/settings')
        .set('Authorization', token1)
        .send({ task_assigned: 'yes' })
        .expect(400);
    });

    it('should return 400 for missing body', async () => {
      await request(app)
        .put('/api/notifications/settings')
        .set('Authorization', token1)
        .expect(400);
    });
  });
});

describe('createNotification helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create notification when type is enabled', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // no setting = default enabled
      .mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 1, type: 'task_assigned', title: 'Test' }]
      });

    const notif = await createNotification(1, 'task_assigned', 'Test', 'Details', 'task', 5);
    expect(notif).toBeTruthy();
    expect(notif.type).toBe('task_assigned');
  });

  it('should skip notification when type is disabled', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ enabled: false }] });

    const notif = await createNotification(1, 'task_assigned', 'Test');
    expect(notif).toBeNull();
  });
});

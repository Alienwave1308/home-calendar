const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const { logAudit } = require('./audit');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

const user1 = { id: 1, username: 'alice' };
const token1 = `Bearer ${jwt.sign(user1, JWT_SECRET, { expiresIn: '1h' })}`;

describe('Audit API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logAudit helper', () => {
    it('should insert an audit event', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await logAudit(1, 1, 'task.created', 'task', 5, { title: 'New task' });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const call = pool.query.mock.calls[0];
      expect(call[0]).toContain('INSERT INTO audit_events');
      expect(call[1]).toEqual([1, 1, 'task.created', 'task', 5, '{"title":"New task"}']);
    });

    it('should not throw on error', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB error'));

      // Should not throw
      await logAudit(1, 1, 'task.created', 'task', 5);
    });
  });

  describe('GET /api/audit', () => {
    it('should return audit events with pagination', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // getUserFamilyId
        .mockResolvedValueOnce({
          rows: [
            { id: 1, action: 'task.created', entity_type: 'task', entity_id: 1, username: 'alice', created_at: new Date() },
            { id: 2, action: 'task.updated', entity_type: 'task', entity_id: 1, username: 'alice', created_at: new Date() }
          ]
        })
        .mockResolvedValueOnce({ rows: [{ total: '2' }] });

      const res = await request(app)
        .get('/api/audit')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.events).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
    });

    it('should respect limit and offset', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 2, action: 'task.deleted' }] })
        .mockResolvedValueOnce({ rows: [{ total: '10' }] });

      const res = await request(app)
        .get('/api/audit?limit=1&offset=1')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.events).toHaveLength(1);
      expect(res.body.total).toBe(10);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(1);
    });

    it('should return 404 if workspace missing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/audit')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('GET /api/audit/entity/:type/:id', () => {
    it('should return history for a specific entity', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({
          rows: [
            { id: 3, action: 'task.updated', entity_type: 'task', entity_id: 5, username: 'alice', details: { status: 'done' } },
            { id: 1, action: 'task.created', entity_type: 'task', entity_id: 5, username: 'alice', details: { title: 'Test' } }
          ]
        });

      const res = await request(app)
        .get('/api/audit/entity/task/5')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].action).toBe('task.updated');
    });

    it('should return empty array for entity with no events', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/audit/entity/task/999')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });

    it('should return 404 if workspace missing', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/audit/entity/task/1')
        .set('Authorization', token1)
        .expect(404);
    });
  });
});

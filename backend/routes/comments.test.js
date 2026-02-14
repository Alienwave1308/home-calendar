const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

const user1 = { id: 1, username: 'alice' };
const user2 = { id: 2, username: 'bob' };
const token1 = `Bearer ${jwt.sign(user1, JWT_SECRET, { expiresIn: '1h' })}`;
const token2 = `Bearer ${jwt.sign(user2, JWT_SECRET, { expiresIn: '1h' })}`;

describe('Comments API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/comments/task/:taskId', () => {
    it('should return comments with pagination', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { id: 1, task_id: 1, user_id: 1, text: 'First comment', username: 'alice', created_at: new Date() },
            { id: 2, task_id: 1, user_id: 2, text: 'Second comment', username: 'bob', created_at: new Date() }
          ]
        })
        .mockResolvedValueOnce({ rows: [{ total: '2' }] });

      const res = await request(app)
        .get('/api/comments/task/1')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.comments).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.limit).toBe(50);
      expect(res.body.offset).toBe(0);
    });

    it('should respect limit and offset', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 2, text: 'Second' }] })
        .mockResolvedValueOnce({ rows: [{ total: '5' }] });

      const res = await request(app)
        .get('/api/comments/task/1?limit=1&offset=1')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.comments).toHaveLength(1);
      expect(res.body.total).toBe(5);
      expect(res.body.limit).toBe(1);
      expect(res.body.offset).toBe(1);
    });
  });

  describe('POST /api/comments/task/:taskId', () => {
    it('should add a comment', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({
          rows: [{ id: 1, task_id: 1, user_id: 1, text: 'Great task!' }]
        });

      const res = await request(app)
        .post('/api/comments/task/1')
        .set('Authorization', token1)
        .send({ text: 'Great task!' })
        .expect(201);

      expect(res.body.text).toBe('Great task!');
    });

    it('should return 400 for empty text', async () => {
      await request(app)
        .post('/api/comments/task/1')
        .set('Authorization', token1)
        .send({ text: '' })
        .expect(400);
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/comments/task/99')
        .set('Authorization', token1)
        .send({ text: 'Hello' })
        .expect(404);
    });
  });

  describe('PUT /api/comments/:id', () => {
    it('should edit own comment', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, user_id: 1, text: 'Old text' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, user_id: 1, text: 'Updated text' }]
        });

      const res = await request(app)
        .put('/api/comments/1')
        .set('Authorization', token1)
        .send({ text: 'Updated text' })
        .expect(200);

      expect(res.body.text).toBe('Updated text');
    });

    it('should return 403 when editing others comment', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, user_id: 1, text: 'Alice comment' }]
      });

      await request(app)
        .put('/api/comments/1')
        .set('Authorization', token2) // bob trying to edit alice's comment
        .send({ text: 'Hacked' })
        .expect(403);
    });

    it('should return 404 if comment not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/comments/99')
        .set('Authorization', token1)
        .send({ text: 'Updated' })
        .expect(404);
    });

    it('should return 400 for empty text', async () => {
      await request(app)
        .put('/api/comments/1')
        .set('Authorization', token1)
        .send({ text: '' })
        .expect(400);
    });
  });

  describe('DELETE /api/comments/:id', () => {
    it('should delete own comment', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, user_id: 1, text: 'My comment' }]
        })
        .mockResolvedValueOnce({ rows: [] }); // delete

      await request(app)
        .delete('/api/comments/1')
        .set('Authorization', token1)
        .expect(204);
    });

    it('should let owner delete others comment', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, user_id: 2, text: 'Bob comment' }] // bob's comment
        })
        .mockResolvedValueOnce({
          rows: [{ role: 'owner' }] // alice is owner
        })
        .mockResolvedValueOnce({ rows: [] }); // delete

      await request(app)
        .delete('/api/comments/1')
        .set('Authorization', token1) // alice (owner)
        .expect(204);
    });

    it('should let admin delete others comment', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, user_id: 1, text: 'Alice comment' }]
        })
        .mockResolvedValueOnce({
          rows: [{ role: 'admin' }] // bob is admin
        })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/comments/1')
        .set('Authorization', token2) // bob (admin)
        .expect(204);
    });

    it('should return 403 when member tries to delete others comment', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, user_id: 1, text: 'Alice comment' }]
        })
        .mockResolvedValueOnce({
          rows: [{ role: 'member' }] // bob is member
        });

      await request(app)
        .delete('/api/comments/1')
        .set('Authorization', token2)
        .expect(403);
    });

    it('should return 404 if comment not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/comments/99')
        .set('Authorization', token1)
        .expect(404);
    });
  });
});

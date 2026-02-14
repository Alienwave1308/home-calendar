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
const token1 = `Bearer ${jwt.sign(user1, JWT_SECRET, { expiresIn: '1h' })}`;

describe('Lists API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/lists', () => {
    it('should return lists for user family', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // getUserFamilyId
        .mockResolvedValueOnce({
          rows: [
            { id: 1, name: 'Groceries', color: '#ff0000', task_count: '3', created_by_username: 'alice' },
            { id: 2, name: 'Chores', color: '#00ff00', task_count: '1', created_by_username: 'alice' }
          ]
        });

      const res = await request(app)
        .get('/api/lists')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBe('Groceries');
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // no family

      await request(app)
        .get('/api/lists')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('POST /api/lists', () => {
    it('should create a list', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // getUserFamilyId
        .mockResolvedValueOnce({
          rows: [{ id: 1, family_id: 1, name: 'Shopping', color: '#6c5ce7', created_by: 1 }]
        });

      const res = await request(app)
        .post('/api/lists')
        .set('Authorization', token1)
        .send({ name: 'Shopping' })
        .expect(201);

      expect(res.body.name).toBe('Shopping');
    });

    it('should create with custom color and description', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Work', description: 'Work tasks', color: '#ff0000' }]
        });

      const res = await request(app)
        .post('/api/lists')
        .set('Authorization', token1)
        .send({ name: 'Work', description: 'Work tasks', color: '#ff0000' })
        .expect(201);

      expect(res.body.color).toBe('#ff0000');
      expect(res.body.description).toBe('Work tasks');
    });

    it('should return 400 for empty name', async () => {
      await request(app)
        .post('/api/lists')
        .set('Authorization', token1)
        .send({ name: '' })
        .expect(400);
    });

    it('should return 400 for invalid color', async () => {
      await request(app)
        .post('/api/lists')
        .set('Authorization', token1)
        .send({ name: 'Test', color: 'red' })
        .expect(400);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/lists')
        .set('Authorization', token1)
        .send({ name: 'Test' })
        .expect(404);
    });
  });

  describe('PUT /api/lists/:id', () => {
    it('should update a list', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // getUserFamilyId
        .mockResolvedValueOnce({
          rows: [{ id: 1, family_id: 1, name: 'Old', description: null, color: '#6c5ce7' }]
        }) // existing
        .mockResolvedValueOnce({
          rows: [{ id: 1, family_id: 1, name: 'Updated', description: null, color: '#6c5ce7' }]
        });

      const res = await request(app)
        .put('/api/lists/1')
        .set('Authorization', token1)
        .send({ name: 'Updated' })
        .expect(200);

      expect(res.body.name).toBe('Updated');
    });

    it('should return 404 if list not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] }); // not found

      await request(app)
        .put('/api/lists/99')
        .set('Authorization', token1)
        .send({ name: 'Updated' })
        .expect(404);
    });

    it('should return 400 for empty name', async () => {
      await request(app)
        .put('/api/lists/1')
        .set('Authorization', token1)
        .send({ name: '' })
        .expect(400);
    });

    it('should return 400 for invalid color', async () => {
      await request(app)
        .put('/api/lists/1')
        .set('Authorization', token1)
        .send({ color: 'invalid' })
        .expect(400);
    });
  });

  describe('DELETE /api/lists/:id', () => {
    it('should delete a list', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // getUserFamilyId
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // deleted

      await request(app)
        .delete('/api/lists/1')
        .set('Authorization', token1)
        .expect(204);
    });

    it('should return 404 if list not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/lists/99')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/lists/1')
        .set('Authorization', token1)
        .expect(404);
    });
  });
});

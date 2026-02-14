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

describe('Shopping API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).get('/api/shopping').expect(401);
  });

  describe('GET /api/shopping', () => {
    it('should return 404 if user has no family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/shopping')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return shopping items for the family', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // getUserFamily
        .mockResolvedValueOnce({
          rows: [
            { id: 1, title: 'Milk', is_bought: false, added_by_name: 'alice' },
            { id: 2, title: 'Bread', is_bought: true, added_by_name: 'alice', bought_by_name: 'bob' }
          ]
        });

      const res = await request(app)
        .get('/api/shopping')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].title).toBe('Milk');
    });
  });

  describe('POST /api/shopping', () => {
    it('should add a shopping item', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, family_id: 1, title: 'Eggs', is_bought: false, added_by: 1 }]
        });

      const res = await request(app)
        .post('/api/shopping')
        .set('Authorization', token1)
        .send({ title: 'Eggs' })
        .expect(201);

      expect(res.body.title).toBe('Eggs');
      expect(res.body.is_bought).toBe(false);
    });

    it('should return 400 for empty title', async () => {
      await request(app)
        .post('/api/shopping')
        .set('Authorization', token1)
        .send({ title: '' })
        .expect(400);
    });

    it('should return 400 for missing title', async () => {
      await request(app)
        .post('/api/shopping')
        .set('Authorization', token1)
        .send({})
        .expect(400);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/shopping')
        .set('Authorization', token1)
        .send({ title: 'Milk' })
        .expect(404);
    });
  });

  describe('PUT /api/shopping/:id', () => {
    it('should update item title', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Whole milk', is_bought: false }]
        });

      const res = await request(app)
        .put('/api/shopping/1')
        .set('Authorization', token1)
        .send({ title: 'Whole milk' })
        .expect(200);

      expect(res.body.title).toBe('Whole milk');
    });

    it('should return 400 for empty title', async () => {
      await request(app)
        .put('/api/shopping/1')
        .set('Authorization', token1)
        .send({ title: '  ' })
        .expect(400);
    });

    it('should return 404 if item not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/shopping/99')
        .set('Authorization', token1)
        .send({ title: 'Test' })
        .expect(404);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/shopping/1')
        .set('Authorization', token1)
        .send({ title: 'Test' })
        .expect(404);
    });
  });

  describe('PUT /api/shopping/:id/toggle', () => {
    it('should toggle item to bought', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, is_bought: false }] }) // current state
        .mockResolvedValueOnce({
          rows: [{ id: 1, is_bought: true, bought_by: 1, bought_at: '2026-02-14' }]
        });

      const res = await request(app)
        .put('/api/shopping/1/toggle')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.is_bought).toBe(true);
      expect(res.body.bought_by).toBe(1);
    });

    it('should toggle item to unbought', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, is_bought: true, bought_by: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, is_bought: false, bought_by: null, bought_at: null }]
        });

      const res = await request(app)
        .put('/api/shopping/1/toggle')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.is_bought).toBe(false);
      expect(res.body.bought_by).toBeNull();
    });

    it('should return 404 if item not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/shopping/99/toggle')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .put('/api/shopping/1/toggle')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('DELETE /api/shopping/:id', () => {
    it('should delete item', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] });

      await request(app)
        .delete('/api/shopping/1')
        .set('Authorization', token1)
        .expect(204);
    });

    it('should return 404 if item not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/shopping/99')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/shopping/1')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('POST /api/shopping/:id/to-task', () => {
    it('should convert item to task', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Groceries' }] }) // item
        .mockResolvedValueOnce({
          rows: [{ id: 10, title: 'Buy: Groceries', status: 'planned', date: '2026-02-14' }]
        }) // created task
        .mockResolvedValueOnce({ rows: [] }); // delete item

      const res = await request(app)
        .post('/api/shopping/1/to-task')
        .set('Authorization', token1)
        .expect(201);

      expect(res.body.title).toBe('Buy: Groceries');
      expect(res.body.status).toBe('planned');
    });

    it('should return 404 if item not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/shopping/99/to-task')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/shopping/1/to-task')
        .set('Authorization', token1)
        .expect(404);
    });
  });
});

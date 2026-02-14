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

describe('Tags API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).get('/api/tags').expect(401);
  });

  describe('GET /api/tags', () => {
    it('should return 404 if user has no family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // no family

      await request(app)
        .get('/api/tags')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return tags for user family', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // family membership
        .mockResolvedValueOnce({
          rows: [
            { id: 1, family_id: 1, name: 'Urgent', color: '#ff0000' },
            { id: 2, family_id: 1, name: 'Work', color: '#00ff00' }
          ]
        });

      const res = await request(app)
        .get('/api/tags')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].name).toBe('Urgent');
    });
  });

  describe('POST /api/tags', () => {
    it('should create a tag', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // family membership
        .mockResolvedValueOnce({ rows: [] }) // no duplicate
        .mockResolvedValueOnce({
          rows: [{ id: 1, family_id: 1, name: 'Work', color: '#6c5ce7' }]
        });

      const res = await request(app)
        .post('/api/tags')
        .set('Authorization', token1)
        .send({ name: 'Work' })
        .expect(201);

      expect(res.body.name).toBe('Work');
      expect(res.body.color).toBe('#6c5ce7');
    });

    it('should create a tag with custom color', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, family_id: 1, name: 'Home', color: '#ff6600' }]
        });

      const res = await request(app)
        .post('/api/tags')
        .set('Authorization', token1)
        .send({ name: 'Home', color: '#ff6600' })
        .expect(201);

      expect(res.body.color).toBe('#ff6600');
    });

    it('should return 400 for empty name', async () => {
      await request(app)
        .post('/api/tags')
        .set('Authorization', token1)
        .send({ name: '' })
        .expect(400);
    });

    it('should return 400 for invalid color', async () => {
      await request(app)
        .post('/api/tags')
        .set('Authorization', token1)
        .send({ name: 'Test', color: 'red' })
        .expect(400);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/tags')
        .set('Authorization', token1)
        .send({ name: 'Test' })
        .expect(404);
    });

    it('should return 409 for duplicate name', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // duplicate exists

      await request(app)
        .post('/api/tags')
        .set('Authorization', token1)
        .send({ name: 'Work' })
        .expect(409);
    });
  });

  describe('PUT /api/tags/:id', () => {
    it('should update tag name', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Work', color: '#6c5ce7' }] })
        .mockResolvedValueOnce({ rows: [] }) // no duplicate
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Office', color: '#6c5ce7' }]
        });

      const res = await request(app)
        .put('/api/tags/1')
        .set('Authorization', token1)
        .send({ name: 'Office' })
        .expect(200);

      expect(res.body.name).toBe('Office');
    });

    it('should update tag color', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Work', color: '#6c5ce7' }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Work', color: '#ff0000' }]
        });

      const res = await request(app)
        .put('/api/tags/1')
        .set('Authorization', token1)
        .send({ color: '#ff0000' })
        .expect(200);

      expect(res.body.color).toBe('#ff0000');
    });

    it('should return 404 if tag not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] }); // tag not found

      await request(app)
        .put('/api/tags/99')
        .set('Authorization', token1)
        .send({ name: 'New' })
        .expect(404);
    });

    it('should return 409 for duplicate name on update', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Work', color: '#6c5ce7' }] })
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }); // duplicate exists

      await request(app)
        .put('/api/tags/1')
        .set('Authorization', token1)
        .send({ name: 'Home' })
        .expect(409);
    });
  });

  describe('DELETE /api/tags/:id', () => {
    it('should delete a tag', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // deleted

      await request(app)
        .delete('/api/tags/1')
        .set('Authorization', token1)
        .expect(204);
    });

    it('should return 404 if tag not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] }); // not found

      await request(app)
        .delete('/api/tags/99')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('POST /api/tags/:tagId/tasks/:taskId (attach)', () => {
    it('should attach tag to task', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] }) // family
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // tag exists
        .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // task exists
        .mockResolvedValueOnce({ rows: [] }) // not yet linked
        .mockResolvedValueOnce({ rows: [] }); // insert

      await request(app)
        .post('/api/tags/1/tasks/5')
        .set('Authorization', token1)
        .expect(201);
    });

    it('should return 404 if tag not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [] }); // tag not found

      await request(app)
        .post('/api/tags/99/tasks/5')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 404 if task not found', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // tag exists
        .mockResolvedValueOnce({ rows: [] }); // task not found

      await request(app)
        .post('/api/tags/1/tasks/99')
        .set('Authorization', token1)
        .expect(404);
    });

    it('should return 409 if already attached', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ family_id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: 5 }] })
        .mockResolvedValueOnce({ rows: [{ task_id: 5, tag_id: 1 }] }); // already linked

      await request(app)
        .post('/api/tags/1/tasks/5')
        .set('Authorization', token1)
        .expect(409);
    });
  });

  describe('DELETE /api/tags/:tagId/tasks/:taskId (detach)', () => {
    it('should detach tag from task', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ task_id: 5, tag_id: 1 }]
      });

      await request(app)
        .delete('/api/tags/1/tasks/5')
        .set('Authorization', token1)
        .expect(204);
    });

    it('should return 404 if not attached', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/tags/1/tasks/99')
        .set('Authorization', token1)
        .expect(404);
    });
  });
});

describe('Tasks API - tag filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should filter tasks by tag', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, title: 'Tagged task', date: '2026-02-15', status: 'planned' }
      ]
    });

    const res = await request(app)
      .get('/api/tasks?tag=1')
      .set('Authorization', token1)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Tagged task');

    // Verify the JOIN query was used
    const queryCall = pool.query.mock.calls[0];
    expect(queryCall[0]).toContain('task_tags');
    expect(queryCall[1]).toEqual([1, 1]); // userId=1, tagId=1
  });

  it('should return all tasks without tag filter', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, title: 'Task 1' },
        { id: 2, title: 'Task 2' }
      ]
    });

    const res = await request(app)
      .get('/api/tasks')
      .set('Authorization', token1)
      .expect(200);

    expect(res.body).toHaveLength(2);

    // Verify simple query was used (no JOIN)
    const queryCall = pool.query.mock.calls[0];
    expect(queryCall[0]).not.toContain('task_tags');
  });
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

// Helper: generate valid token for test user
const testUser = { id: 1, username: 'testuser' };
const authToken = jwt.sign(testUser, JWT_SECRET, { expiresIn: '1h' });
const authHeader = `Bearer ${authToken}`;

describe('Tasks API', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).get('/api/tasks').expect(401);
  });

  // GET all tasks
  describe('GET /api/tasks', () => {
    it('should return all tasks (excluding soft-deleted)', async () => {
      pool.query.mockResolvedValue({
        rows: [
          { id: 1, title: 'Test Task', date: '2026-02-15', status: 'planned', priority: 'medium', deleted_at: null }
        ]
      });

      const response = await request(app)
        .get('/api/tasks')
        .set('Authorization', authHeader)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0].status).toBe('planned');
    });
  });

  // GET single task
  describe('GET /api/tasks/:id', () => {
    it('should return a task by id', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, title: 'Test Task', date: '2026-02-15', status: 'planned', priority: 'medium' }]
      });

      const response = await request(app)
        .get('/api/tasks/1')
        .set('Authorization', authHeader)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('id', 1);
      expect(response.body).toHaveProperty('status', 'planned');
    });

    it('should return 404 for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/api/tasks/9999')
        .set('Authorization', authHeader)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  // POST create task
  describe('POST /api/tasks', () => {
    it('should create a task with default status and priority', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, title: 'Test Task', date: '2026-02-20', status: 'planned', priority: 'medium' }]
      });

      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', authHeader)
        .send({ title: 'Test Task', date: '2026-02-20' })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe('Test Task');
      expect(response.body.status).toBe('planned');
      expect(response.body.priority).toBe('medium');
    });

    it('should create a task with explicit status', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 2, title: 'Urgent', date: '2026-02-20', status: 'in_progress', priority: 'medium' }]
      });

      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', authHeader)
        .send({ title: 'Urgent', date: '2026-02-20', status: 'in_progress' })
        .expect(201);

      expect(response.body.status).toBe('in_progress');
    });

    it('should create a task with backlog status', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 3, title: 'Later', date: '2026-03-01', status: 'backlog', priority: 'low' }]
      });

      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', authHeader)
        .send({ title: 'Later', date: '2026-03-01', status: 'backlog', priority: 'low' })
        .expect(201);

      expect(response.body.status).toBe('backlog');
      expect(response.body.priority).toBe('low');
    });

    it('should create a task with description', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 4, title: 'Detailed', date: '2026-02-20', status: 'planned', priority: 'high', description: 'Some details' }]
      });

      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', authHeader)
        .send({ title: 'Detailed', date: '2026-02-20', priority: 'high', description: 'Some details' })
        .expect(201);

      expect(response.body.priority).toBe('high');
      expect(response.body.description).toBe('Some details');
    });

    it('should return 400 if title is missing', async () => {
      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', authHeader)
        .send({ date: '2026-02-20' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for invalid status', async () => {
      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', authHeader)
        .send({ title: 'Test', date: '2026-02-20', status: 'invalid' })
        .expect(400);

      expect(response.body.error).toMatch(/Invalid status/);
    });

    it('should return 400 for invalid priority', async () => {
      const response = await request(app)
        .post('/api/tasks')
        .set('Authorization', authHeader)
        .send({ title: 'Test', date: '2026-02-20', priority: 'super' })
        .expect(400);

      expect(response.body.error).toMatch(/Invalid priority/);
    });
  });

  // PUT update task
  describe('PUT /api/tasks/:id', () => {
    it('should update task status', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'planned', priority: 'medium', description: null, completed_at: null }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'done', priority: 'medium', completed_at: '2026-02-15T10:00:00Z' }]
        });

      const response = await request(app)
        .put('/api/tasks/1')
        .set('Authorization', authHeader)
        .send({ status: 'done' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.status).toBe('done');
    });

    it('should update task priority', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'planned', priority: 'medium', description: null, completed_at: null }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'planned', priority: 'urgent' }]
        });

      const response = await request(app)
        .put('/api/tasks/1')
        .set('Authorization', authHeader)
        .send({ priority: 'urgent' })
        .expect(200);

      expect(response.body.priority).toBe('urgent');
    });

    it('should update task description', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'planned', priority: 'medium', description: null, completed_at: null }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'planned', priority: 'medium', description: 'Updated desc' }]
        });

      const response = await request(app)
        .put('/api/tasks/1')
        .set('Authorization', authHeader)
        .send({ description: 'Updated desc' })
        .expect(200);

      expect(response.body.description).toBe('Updated desc');
    });

    it('should set completed_at when status changes to done', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'planned', priority: 'medium', description: null, completed_at: null }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'done', completed_at: '2026-02-15T12:00:00Z' }]
        });

      await request(app)
        .put('/api/tasks/1')
        .set('Authorization', authHeader)
        .send({ status: 'done' })
        .expect(200);

      // Verify the query was called with a completed_at timestamp
      const updateCall = pool.query.mock.calls[1];
      expect(updateCall[1][5]).not.toBeNull(); // completed_at should be set
    });

    it('should clear completed_at when status changes from done', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'done', priority: 'medium', description: null, completed_at: '2026-02-15T12:00:00Z' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'in_progress', completed_at: null }]
        });

      await request(app)
        .put('/api/tasks/1')
        .set('Authorization', authHeader)
        .send({ status: 'in_progress' })
        .expect(200);

      const updateCall = pool.query.mock.calls[1];
      expect(updateCall[1][5]).toBeNull(); // completed_at should be cleared
    });

    it('should return 400 for invalid status', async () => {
      await request(app)
        .put('/api/tasks/1')
        .set('Authorization', authHeader)
        .send({ status: 'bad_status' })
        .expect(400);
    });

    it('should return 400 for invalid priority', async () => {
      await request(app)
        .put('/api/tasks/1')
        .set('Authorization', authHeader)
        .send({ priority: 'super' })
        .expect(400);
    });

    it('should return 404 for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await request(app)
        .put('/api/tasks/9999')
        .set('Authorization', authHeader)
        .send({ status: 'done' })
        .expect(404);
    });
  });

  // DELETE task (soft delete)
  describe('DELETE /api/tasks/:id', () => {
    it('should soft delete a task', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, title: 'Test', date: '2026-02-15', status: 'planned', deleted_at: '2026-02-15T12:00:00Z' }]
      });

      await request(app)
        .delete('/api/tasks/1')
        .set('Authorization', authHeader)
        .expect(204);
    });

    it('should return 404 for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await request(app)
        .delete('/api/tasks/9999')
        .set('Authorization', authHeader)
        .expect(404);
    });
  });
});

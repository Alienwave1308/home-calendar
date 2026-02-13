const request = require('supertest');
const app = require('../server');
const { pool } = require('../db');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

describe('Tasks API', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // GET all tasks
  describe('GET /api/tasks', () => {
    it('should return all tasks', async () => {
      pool.query.mockResolvedValue({
        rows: [
          { id: 1, title: 'Test Task', date: '2026-02-15', status: 'planned' }
        ]
      });

      const response = await request(app)
        .get('/api/tasks')
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
        rows: [{ id: 1, title: 'Test Task', date: '2026-02-15', status: 'planned' }]
      });

      const response = await request(app)
        .get('/api/tasks/1')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('id', 1);
      expect(response.body).toHaveProperty('status', 'planned');
    });

    it('should return 404 for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/api/tasks/9999')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  // POST create task
  describe('POST /api/tasks', () => {
    it('should create a task with default status planned', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, title: 'Test Task', date: '2026-02-20', status: 'planned' }]
      });

      const response = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test Task', date: '2026-02-20' })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe('Test Task');
      expect(response.body.status).toBe('planned');
    });

    it('should create a task with explicit status', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 2, title: 'Urgent', date: '2026-02-20', status: 'in_progress' }]
      });

      const response = await request(app)
        .post('/api/tasks')
        .send({ title: 'Urgent', date: '2026-02-20', status: 'in_progress' })
        .expect(201);

      expect(response.body.status).toBe('in_progress');
    });

    it('should return 400 if title is missing', async () => {
      const response = await request(app)
        .post('/api/tasks')
        .send({ date: '2026-02-20' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for invalid status', async () => {
      const response = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test', date: '2026-02-20', status: 'invalid' })
        .expect(400);

      expect(response.body.error).toMatch(/Invalid status/);
    });
  });

  // PUT update task
  describe('PUT /api/tasks/:id', () => {
    it('should update task status', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'planned' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Task', date: '2026-02-15', status: 'done' }]
        });

      const response = await request(app)
        .put('/api/tasks/1')
        .send({ status: 'done' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.status).toBe('done');
    });

    it('should return 400 for invalid status', async () => {
      await request(app)
        .put('/api/tasks/1')
        .send({ status: 'bad_status' })
        .expect(400);
    });

    it('should return 404 for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await request(app)
        .put('/api/tasks/9999')
        .send({ status: 'done' })
        .expect(404);
    });
  });

  // DELETE task
  describe('DELETE /api/tasks/:id', () => {
    it('should delete a task', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, title: 'Test', date: '2026-02-15', status: 'planned' }]
      });

      await request(app)
        .delete('/api/tasks/1')
        .expect(204);
    });

    it('should return 404 for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await request(app)
        .delete('/api/tasks/9999')
        .expect(404);
    });
  });
});

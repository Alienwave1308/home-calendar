// Тесты для API задач
const request = require('supertest');
const app = require('../server');
const { pool } = require('../db');

// Мокаем (подделываем) модуль базы данных
jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

describe('Tasks API', () => {

  // Очищаем моки перед каждым тестом
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Тест: Получить все задачи
  describe('GET /api/tasks', () => {
    it('should return all tasks', async () => {
      // Настраиваем мок: pool.query вернёт эти данные
      pool.query.mockResolvedValue({
        rows: [
          { id: 1, title: 'Test Task', date: '2026-02-15', completed: false }
        ]
      });

      const response = await request(app)
        .get('/api/tasks')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  // Тест: Получить одну задачу по ID
  describe('GET /api/tasks/:id', () => {
    it('should return a task by id', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, title: 'Test Task', date: '2026-02-15', completed: false }]
      });

      const response = await request(app)
        .get('/api/tasks/1')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('id', 1);
      expect(response.body).toHaveProperty('title');
    });

    it('should return 404 for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/api/tasks/9999')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  // Тест: Создать новую задачу
  describe('POST /api/tasks', () => {
    it('should create a new task', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, title: 'Test Task', date: '2026-02-20', completed: false }]
      });

      const response = await request(app)
        .post('/api/tasks')
        .send({ title: 'Test Task', date: '2026-02-20' })
        .expect('Content-Type', /json/)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.title).toBe('Test Task');
      expect(response.body.completed).toBe(false);
    });

    it('should return 400 if title is missing', async () => {
      const response = await request(app)
        .post('/api/tasks')
        .send({ date: '2026-02-20' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  // Тест: Обновить задачу
  describe('PUT /api/tasks/:id', () => {
    it('should update a task', async () => {
      // Первый вызов - SELECT (проверка существования)
      // Второй вызов - UPDATE
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Old Task', date: '2026-02-15', completed: false }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, title: 'Old Task', date: '2026-02-15', completed: true }]
        });

      const response = await request(app)
        .put('/api/tasks/1')
        .send({ completed: true })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.completed).toBe(true);
    });

    it('should return 404 for non-existent task', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      await request(app)
        .put('/api/tasks/9999')
        .send({ completed: true })
        .expect(404);
    });
  });

  // Тест: Удалить задачу
  describe('DELETE /api/tasks/:id', () => {
    it('should delete a task', async () => {
      pool.query.mockResolvedValue({
        rows: [{ id: 1, title: 'Test', date: '2026-02-15', completed: false }]
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
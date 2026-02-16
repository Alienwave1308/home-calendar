const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../server');
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
  initDB: jest.fn()
}));

const user1 = { id: 1, username: 'alice' };
const token1 = `Bearer ${jwt.sign(user1, JWT_SECRET, { expiresIn: '1h' })}`;

describe('Attachments API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).get('/api/tasks/1/attachments').expect(401);
  });

  describe('POST /api/tasks/:id/attachments', () => {
    it('should upload a file', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // attachment count
        .mockResolvedValueOnce({
          rows: [{ id: 1, task_id: 1, filename: 'test.txt', mimetype: 'text/plain', size: 11 }]
        });

      const res = await request(app)
        .post('/api/tasks/1/attachments')
        .set('Authorization', token1)
        .attach('file', Buffer.from('hello world'), 'test.txt')
        .expect(201);

      expect(res.body.filename).toBe('test.txt');

      // Clean up uploaded file
      const uploadsDir = path.join(__dirname, '../../uploads');
      const files = fs.readdirSync(uploadsDir);
      for (const f of files) {
        if (f.endsWith('.txt')) {
          fs.unlinkSync(path.join(uploadsDir, f));
        }
      }
    });

    it('should return 400 without file', async () => {
      await request(app)
        .post('/api/tasks/1/attachments')
        .set('Authorization', token1)
        .expect(400);
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // task not found

      const res = await request(app)
        .post('/api/tasks/99/attachments')
        .set('Authorization', token1)
        .attach('file', Buffer.from('data'), 'test.txt')
        .expect(404);

      expect(res.body.error).toMatch(/Task not found/);
    });

    it('should return 400 if max files reached', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({ rows: [{ count: '10' }] }); // max reached

      const res = await request(app)
        .post('/api/tasks/1/attachments')
        .set('Authorization', token1)
        .attach('file', Buffer.from('data'), 'test.txt')
        .expect(400);

      expect(res.body.error).toMatch(/Maximum/);
    });
  });

  describe('GET /api/tasks/:id/attachments', () => {
    it('should list attachments for a task', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // task exists
        .mockResolvedValueOnce({
          rows: [
            { id: 1, filename: 'doc.pdf', mimetype: 'application/pdf', size: 1024 },
            { id: 2, filename: 'img.png', mimetype: 'image/png', size: 2048 }
          ]
        });

      const res = await request(app)
        .get('/api/tasks/1/attachments')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].filename).toBe('doc.pdf');
    });

    it('should return 404 if task not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/tasks/99/attachments')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('GET /api/attachments/:id', () => {
    it('should return 404 if attachment not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/attachments/99')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('DELETE /api/attachments/:id', () => {
    it('should delete an attachment', async () => {
      // Create a temp file to delete
      const uploadsDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      const tempFile = 'test-delete-file.txt';
      fs.writeFileSync(path.join(uploadsDir, tempFile), 'test');

      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, filepath: tempFile, filename: 'test.txt' }]
        }) // attachment found
        .mockResolvedValueOnce({ rows: [] }); // delete

      await request(app)
        .delete('/api/attachments/1')
        .set('Authorization', token1)
        .expect(204);

      // Verify file was deleted
      expect(fs.existsSync(path.join(uploadsDir, tempFile))).toBe(false);
    });

    it('should return 404 if attachment not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .delete('/api/attachments/99')
        .set('Authorization', token1)
        .expect(404);
    });
  });
});

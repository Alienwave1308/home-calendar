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

describe('Families API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 without token', async () => {
    await request(app).get('/api/families').expect(401);
  });

  describe('GET /api/families', () => {
    it('should return null if user has no family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/families')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.family).toBeNull();
    });

    it('should return family with members', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Smiths', invite_code: 'abc12345', owner_id: 1, role: 'owner' }]
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 1, username: 'alice', role: 'owner', joined_at: new Date() },
            { id: 2, username: 'bob', role: 'member', joined_at: new Date() }
          ]
        });

      const res = await request(app)
        .get('/api/families')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.family.name).toBe('Smiths');
      expect(res.body.family.members).toHaveLength(2);
    });
  });

  describe('POST /api/families', () => {
    it('should create a new family', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // not in a family
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Smiths', invite_code: 'abc12345', owner_id: 1 }]
        })
        .mockResolvedValueOnce({ rows: [] }); // insert member

      const res = await request(app)
        .post('/api/families')
        .set('Authorization', token1)
        .send({ name: 'Smiths' })
        .expect(201);

      expect(res.body.family.name).toBe('Smiths');
      expect(res.body.family.role).toBe('owner');
      expect(res.body.family.invite_code).toBeTruthy();
    });

    it('should return 400 for short name', async () => {
      await request(app)
        .post('/api/families')
        .set('Authorization', token1)
        .send({ name: 'A' })
        .expect(400);
    });

    it('should return 409 if already in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // already in family

      await request(app)
        .post('/api/families')
        .set('Authorization', token1)
        .send({ name: 'Another' })
        .expect(409);
    });
  });

  describe('POST /api/families/join', () => {
    it('should join a family by invite code', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // not in family
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: 'Smiths', invite_code: 'abc12345', owner_id: 1 }]
        })
        .mockResolvedValueOnce({ rows: [] }) // insert member
        .mockResolvedValueOnce({
          rows: [
            { id: 1, username: 'alice', role: 'owner', joined_at: new Date() },
            { id: 2, username: 'bob', role: 'member', joined_at: new Date() }
          ]
        });

      const res = await request(app)
        .post('/api/families/join')
        .set('Authorization', token2)
        .send({ invite_code: 'abc12345' })
        .expect(200);

      expect(res.body.family.name).toBe('Smiths');
      expect(res.body.family.role).toBe('member');
    });

    it('should return 404 for invalid invite code', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // not in family
        .mockResolvedValueOnce({ rows: [] }); // no such code

      await request(app)
        .post('/api/families/join')
        .set('Authorization', token2)
        .send({ invite_code: 'badcode1' })
        .expect(404);
    });

    it('should return 409 if already in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // already in family

      await request(app)
        .post('/api/families/join')
        .set('Authorization', token2)
        .send({ invite_code: 'abc12345' })
        .expect(409);
    });
  });

  describe('POST /api/families/leave', () => {
    it('should let a member leave', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 5, family_id: 1, role: 'member' }]
        })
        .mockResolvedValueOnce({ rows: [] }); // delete member

      const res = await request(app)
        .post('/api/families/leave')
        .set('Authorization', token2)
        .expect(200);

      expect(res.body.message).toMatch(/Left family/);
    });

    it('should delete family when owner leaves', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 1, family_id: 1, role: 'owner' }]
        })
        .mockResolvedValueOnce({ rows: [] }); // delete family

      await request(app)
        .post('/api/families/leave')
        .set('Authorization', token1)
        .expect(200);
    });

    it('should return 404 if not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/api/families/leave')
        .set('Authorization', token1)
        .expect(404);
    });
  });

  describe('DELETE /api/families/members/:userId', () => {
    it('should let owner kick a member', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ family_id: 1, role: 'owner' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 5, family_id: 1, user_id: 2, role: 'member' }]
        });

      const res = await request(app)
        .delete('/api/families/members/2')
        .set('Authorization', token1)
        .expect(200);

      expect(res.body.message).toMatch(/Member removed/);
    });

    it('should return 403 if not owner', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ family_id: 1, role: 'member' }]
      });

      await request(app)
        .delete('/api/families/members/1')
        .set('Authorization', token2)
        .expect(403);
    });

    it('should return 400 when owner tries to kick themselves', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ family_id: 1, role: 'owner' }]
      });

      await request(app)
        .delete('/api/families/members/1')
        .set('Authorization', token1)
        .expect(400);
    });
  });
});

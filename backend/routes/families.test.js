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
const user3 = { id: 3, username: 'charlie' };
const token1 = `Bearer ${jwt.sign(user1, JWT_SECRET, { expiresIn: '1h' })}`;
const token2 = `Bearer ${jwt.sign(user2, JWT_SECRET, { expiresIn: '1h' })}`;
const token3 = `Bearer ${jwt.sign(user3, JWT_SECRET, { expiresIn: '1h' })}`;

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

    it('should let admin kick a member', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ family_id: 1, role: 'admin' }]
        })
        .mockResolvedValueOnce({
          rows: [{ role: 'member' }] // target is member
        })
        .mockResolvedValueOnce({
          rows: [{ id: 6, family_id: 1, user_id: 3, role: 'member' }]
        });

      const res = await request(app)
        .delete('/api/families/members/3')
        .set('Authorization', token2)
        .expect(200);

      expect(res.body.message).toMatch(/Member removed/);
    });

    it('should not let admin kick owner', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ family_id: 1, role: 'admin' }]
        })
        .mockResolvedValueOnce({
          rows: [{ role: 'owner' }] // target is owner
        });

      await request(app)
        .delete('/api/families/members/1')
        .set('Authorization', token2)
        .expect(403);
    });

    it('should not let admin kick another admin', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ family_id: 1, role: 'admin' }]
        })
        .mockResolvedValueOnce({
          rows: [{ role: 'admin' }] // target is also admin
        });

      await request(app)
        .delete('/api/families/members/3')
        .set('Authorization', token2)
        .expect(403);
    });

    it('should return 403 if member tries to kick', async () => {
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

  describe('PUT /api/families/members/:userId/role', () => {
    it('should let owner change role to admin', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ family_id: 1, role: 'owner' }] // caller is owner
        })
        .mockResolvedValueOnce({
          rows: [{ id: 5, role: 'member' }] // target exists
        })
        .mockResolvedValueOnce({
          rows: [{ id: 5, family_id: 1, user_id: 2, role: 'admin', role_changed_at: new Date() }]
        });

      const res = await request(app)
        .put('/api/families/members/2/role')
        .set('Authorization', token1)
        .send({ role: 'admin' })
        .expect(200);

      expect(res.body.member.role).toBe('admin');
    });

    it('should let owner change role to child', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ family_id: 1, role: 'owner' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 5, role: 'member' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 5, family_id: 1, user_id: 2, role: 'child', role_changed_at: new Date() }]
        });

      const res = await request(app)
        .put('/api/families/members/2/role')
        .set('Authorization', token1)
        .send({ role: 'child' })
        .expect(200);

      expect(res.body.member.role).toBe('child');
    });

    it('should let owner change role to guest', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ family_id: 1, role: 'owner' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 5, role: 'member' }]
        })
        .mockResolvedValueOnce({
          rows: [{ id: 5, family_id: 1, user_id: 2, role: 'guest', role_changed_at: new Date() }]
        });

      const res = await request(app)
        .put('/api/families/members/2/role')
        .set('Authorization', token1)
        .send({ role: 'guest' })
        .expect(200);

      expect(res.body.member.role).toBe('guest');
    });

    it('should return 400 for invalid role', async () => {
      await request(app)
        .put('/api/families/members/2/role')
        .set('Authorization', token1)
        .send({ role: 'superadmin' })
        .expect(400);
    });

    it('should return 400 when trying to assign owner role', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ family_id: 1, role: 'owner' }]
      });

      await request(app)
        .put('/api/families/members/2/role')
        .set('Authorization', token1)
        .send({ role: 'owner' })
        .expect(400);
    });

    it('should return 400 when owner tries to change own role', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ family_id: 1, role: 'owner' }]
      });

      await request(app)
        .put('/api/families/members/1/role')
        .set('Authorization', token1)
        .send({ role: 'admin' })
        .expect(400);
    });

    it('should return 403 if non-owner tries to change role', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ family_id: 1, role: 'admin' }] // admin, not owner
      });

      await request(app)
        .put('/api/families/members/3/role')
        .set('Authorization', token2)
        .send({ role: 'member' })
        .expect(403);
    });

    it('should return 404 if target not in family', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ family_id: 1, role: 'owner' }]
        })
        .mockResolvedValueOnce({
          rows: [] // target not found
        });

      await request(app)
        .put('/api/families/members/99/role')
        .set('Authorization', token1)
        .send({ role: 'admin' })
        .expect(404);
    });

    it('should return 404 if caller not in a family', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }); // caller not in family

      await request(app)
        .put('/api/families/members/2/role')
        .set('Authorization', token3)
        .send({ role: 'admin' })
        .expect(404);
    });
  });
});

describe('Family middleware', () => {
  const { VALID_ROLES, ROLE_PERMISSIONS, hasPermission } = require('../middleware/family');

  it('should have 5 valid roles', () => {
    expect(VALID_ROLES).toEqual(['owner', 'admin', 'member', 'child', 'guest']);
  });

  it('should define permissions for all roles', () => {
    for (const role of VALID_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });

  it('owner should have all permissions', () => {
    expect(hasPermission('owner', 'manage_family')).toBe(true);
    expect(hasPermission('owner', 'manage_roles')).toBe(true);
    expect(hasPermission('owner', 'view')).toBe(true);
  });

  it('guest should only have view permission', () => {
    expect(hasPermission('guest', 'view')).toBe(true);
    expect(hasPermission('guest', 'create_tasks')).toBe(false);
    expect(hasPermission('guest', 'manage_family')).toBe(false);
  });

  it('child should have limited permissions', () => {
    expect(hasPermission('child', 'view')).toBe(true);
    expect(hasPermission('child', 'comment')).toBe(true);
    expect(hasPermission('child', 'manage_assigned_tasks')).toBe(true);
    expect(hasPermission('child', 'create_tasks')).toBe(false);
  });

  it('admin should not manage family or roles', () => {
    expect(hasPermission('admin', 'manage_members')).toBe(true);
    expect(hasPermission('admin', 'manage_family')).toBe(false);
    expect(hasPermission('admin', 'manage_roles')).toBe(false);
  });
});

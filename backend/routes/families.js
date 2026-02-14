const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { VALID_ROLES } = require('../middleware/family');

// All family routes require authentication
router.use(authenticateToken);

// Generate random 8-char invite code
function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex');
}

// GET /api/families — get user's family (or null)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.name, f.invite_code, f.owner_id, fm.role
       FROM family_members fm
       JOIN families f ON f.id = fm.family_id
       WHERE fm.user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.json({ family: null });
    }

    const family = result.rows[0];

    // Get all members
    const members = await pool.query(
      `SELECT u.id, u.username, fm.role, fm.joined_at
       FROM family_members fm
       JOIN users u ON u.id = fm.user_id
       WHERE fm.family_id = $1
       ORDER BY fm.joined_at`,
      [family.id]
    );

    res.json({
      family: {
        id: family.id,
        name: family.name,
        invite_code: family.invite_code,
        owner_id: family.owner_id,
        role: family.role,
        members: members.rows
      }
    });
  } catch (error) {
    console.error('Error getting family:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/families — create a new family
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Family name must be at least 2 characters' });
    }

    // Check if user already in a family
    const existing = await pool.query(
      'SELECT id FROM family_members WHERE user_id = $1',
      [req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You are already in a family. Leave first.' });
    }

    const inviteCode = generateInviteCode();

    const result = await pool.query(
      'INSERT INTO families (name, invite_code, owner_id) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), inviteCode, req.user.id]
    );

    const family = result.rows[0];

    // Add creator as owner member
    await pool.query(
      'INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3)',
      [family.id, req.user.id, 'owner']
    );

    res.status(201).json({
      family: {
        id: family.id,
        name: family.name,
        invite_code: family.invite_code,
        owner_id: family.owner_id,
        role: 'owner',
        members: [{ id: req.user.id, username: req.user.username, role: 'owner' }]
      }
    });
  } catch (error) {
    console.error('Error creating family:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/families/join — join a family by invite code
router.post('/join', async (req, res) => {
  try {
    const { invite_code } = req.body;

    if (!invite_code) {
      return res.status(400).json({ error: 'Invite code is required' });
    }

    // Check if user already in a family
    const existing = await pool.query(
      'SELECT id FROM family_members WHERE user_id = $1',
      [req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You are already in a family. Leave first.' });
    }

    // Find family by invite code
    const familyResult = await pool.query(
      'SELECT * FROM families WHERE invite_code = $1',
      [invite_code]
    );
    if (familyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const family = familyResult.rows[0];

    // Add user as member
    await pool.query(
      'INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, $3)',
      [family.id, req.user.id, 'member']
    );

    // Get all members
    const members = await pool.query(
      `SELECT u.id, u.username, fm.role, fm.joined_at
       FROM family_members fm
       JOIN users u ON u.id = fm.user_id
       WHERE fm.family_id = $1
       ORDER BY fm.joined_at`,
      [family.id]
    );

    res.json({
      family: {
        id: family.id,
        name: family.name,
        invite_code: family.invite_code,
        owner_id: family.owner_id,
        role: 'member',
        members: members.rows
      }
    });
  } catch (error) {
    console.error('Error joining family:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/families/leave — leave the family
router.post('/leave', async (req, res) => {
  try {
    // Find user's membership
    const membership = await pool.query(
      `SELECT fm.id, fm.family_id, fm.role
       FROM family_members fm
       WHERE fm.user_id = $1`,
      [req.user.id]
    );

    if (membership.rows.length === 0) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const { family_id, role } = membership.rows[0];

    if (role === 'owner') {
      // Owner leaving = delete the whole family
      await pool.query('DELETE FROM families WHERE id = $1', [family_id]);
    } else {
      // Member just removes themselves
      await pool.query(
        'DELETE FROM family_members WHERE family_id = $1 AND user_id = $2',
        [family_id, req.user.id]
      );
    }

    res.json({ message: 'Left family successfully' });
  } catch (error) {
    console.error('Error leaving family:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/families/members/:userId — kick a member (owner or admin)
router.delete('/members/:userId', async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);

    // Check caller's role
    const callerMembership = await pool.query(
      'SELECT family_id, role FROM family_members WHERE user_id = $1',
      [req.user.id]
    );

    if (callerMembership.rows.length === 0) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const { family_id, role } = callerMembership.rows[0];

    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Only owner or admin can remove members' });
    }

    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'Cannot kick yourself. Use leave instead.' });
    }

    // Admin cannot kick owner or other admins
    if (role === 'admin') {
      const targetMembership = await pool.query(
        'SELECT role FROM family_members WHERE family_id = $1 AND user_id = $2',
        [family_id, targetUserId]
      );
      if (targetMembership.rows.length > 0) {
        const targetRole = targetMembership.rows[0].role;
        if (targetRole === 'owner' || targetRole === 'admin') {
          return res.status(403).json({ error: 'Admin cannot remove owner or other admins' });
        }
      }
    }

    const result = await pool.query(
      'DELETE FROM family_members WHERE family_id = $1 AND user_id = $2 RETURNING *',
      [family_id, targetUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User is not a member of your family' });
    }

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/families/members/:userId/role — change a member's role (owner only)
router.put('/members/:userId/role', async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.userId);
    const { role: newRole } = req.body;

    if (!newRole || !VALID_ROLES.includes(newRole)) {
      return res.status(400).json({ error: `Invalid role. Must be: ${VALID_ROLES.join(', ')}` });
    }

    // Check caller is owner
    const callerMembership = await pool.query(
      'SELECT family_id, role FROM family_members WHERE user_id = $1',
      [req.user.id]
    );

    if (callerMembership.rows.length === 0) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const { family_id, role: callerRole } = callerMembership.rows[0];

    if (callerRole !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can change roles' });
    }

    if (targetUserId === req.user.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    if (newRole === 'owner') {
      return res.status(400).json({ error: 'Cannot assign owner role. Transfer ownership instead.' });
    }

    // Check target is in the same family
    const targetMembership = await pool.query(
      'SELECT id, role FROM family_members WHERE family_id = $1 AND user_id = $2',
      [family_id, targetUserId]
    );

    if (targetMembership.rows.length === 0) {
      return res.status(404).json({ error: 'User is not a member of your family' });
    }

    // Update role
    const result = await pool.query(
      'UPDATE family_members SET role = $1, role_changed_at = NOW() WHERE family_id = $2 AND user_id = $3 RETURNING *',
      [newRole, family_id, targetUserId]
    );

    res.json({ member: result.rows[0] });
  } catch (error) {
    console.error('Error changing role:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

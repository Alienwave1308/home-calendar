const { pool } = require('../db');

// Valid roles in order of privilege (highest to lowest)
const VALID_ROLES = ['owner', 'admin', 'member', 'child', 'guest'];

// Role hierarchy: what each role can do
const ROLE_PERMISSIONS = {
  owner:  ['manage_family', 'manage_members', 'manage_roles', 'manage_tasks', 'create_tasks', 'comment', 'view'],
  admin:  ['manage_members', 'manage_tasks', 'create_tasks', 'comment', 'view'],
  member: ['manage_own_tasks', 'create_tasks', 'comment', 'view'],
  child:  ['manage_assigned_tasks', 'comment', 'view'],
  guest:  ['view']
};

/**
 * Middleware: load user's family membership and attach to req.familyMember
 * Sets req.familyMember = { family_id, role } or null
 */
async function loadFamilyMembership(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT family_id, role FROM family_members WHERE user_id = $1',
      [req.user.id]
    );
    req.familyMember = result.rows.length > 0 ? result.rows[0] : null;
    next();
  } catch (error) {
    console.error('Error loading family membership:', error);
    res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Middleware factory: check that user has one of the allowed roles in their family
 * Must be used after authenticateToken and loadFamilyMembership
 *
 * Usage: checkRole('owner', 'admin')
 */
function checkRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.familyMember) {
      return res.status(404).json({ error: 'You are not in a family' });
    }
    if (!allowedRoles.includes(req.familyMember.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Check if a role has a specific permission
 */
function hasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.includes(permission) : false;
}

module.exports = { VALID_ROLES, ROLE_PERMISSIONS, loadFamilyMembership, checkRole, hasPermission };

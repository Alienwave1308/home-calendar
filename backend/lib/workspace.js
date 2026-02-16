const { pool } = require('../db');

async function getUserWorkspaceId(userId) {
  const result = await pool.query(
    'SELECT family_id AS workspace_id FROM family_members WHERE user_id = $1 LIMIT 1',
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return row.workspace_id || row.family_id || row.id || null;
}

module.exports = {
  getUserWorkspaceId
};

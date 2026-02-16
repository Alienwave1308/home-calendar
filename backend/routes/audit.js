const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { getUserWorkspaceId } = require('../lib/workspace');

// All audit routes require authentication
router.use(authenticateToken);

// Helper: log an audit event (used by other routes too)
async function logAudit(workspaceId, userId, action, entityType, entityId, details = {}) {
  try {
    await pool.query(
      'INSERT INTO audit_events (family_id, user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
      [workspaceId, userId, action, entityType, entityId, JSON.stringify(details)]
    );
  } catch (error) {
    console.error('Error logging audit event:', error);
  }
}

// GET /api/audit — get workspace activity feed (with pagination)
router.get('/', async (req, res) => {
  try {
    const workspaceId = await getUserWorkspaceId(req.user.id);
    if (!workspaceId) {
      return res.status(404).json({ error: 'Рабочее пространство не найдено' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT ae.*, u.username
       FROM audit_events ae
       JOIN users u ON u.id = ae.user_id
       WHERE ae.family_id = $1
       ORDER BY ae.created_at DESC
       LIMIT $2 OFFSET $3`,
      [workspaceId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) AS total FROM audit_events WHERE family_id = $1',
      [workspaceId]
    );

    res.json({
      events: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    });
  } catch (error) {
    console.error('Error getting audit events:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/audit/entity/:type/:id — get history for a specific entity (e.g. task)
router.get('/entity/:type/:id', async (req, res) => {
  try {
    const workspaceId = await getUserWorkspaceId(req.user.id);
    if (!workspaceId) {
      return res.status(404).json({ error: 'Рабочее пространство не найдено' });
    }

    const entityType = req.params.type;
    const entityId = parseInt(req.params.id);

    const result = await pool.query(
      `SELECT ae.*, u.username
       FROM audit_events ae
       JOIN users u ON u.id = ae.user_id
       WHERE ae.family_id = $1 AND ae.entity_type = $2 AND ae.entity_id = $3
       ORDER BY ae.created_at DESC`,
      [workspaceId, entityType, entityId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting entity history:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.logAudit = logAudit;

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const VALID_TYPES = [
  'task_assigned',
  'task_completed',
  'task_due',
  'comment_added',
  'family_invite',
  'family_joined',
  'shopping_added'
];

router.use(authenticateToken);

// GET /api/notifications — list notifications (optionally filter by unread)
router.get('/', async (req, res) => {
  try {
    const { unread } = req.query;
    let query = 'SELECT * FROM notifications WHERE user_id = $1';
    const params = [req.user.id];

    if (unread === 'true') {
      query += ' AND is_read = false';
    }

    query += ' ORDER BY created_at DESC LIMIT 50';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting notifications:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notifications/count — get unread count
router.get('/count', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Error getting notification count:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/notifications/:id/read — mark one as read
router.put('/:id/read', async (req, res) => {
  try {
    const notifId = parseInt(req.params.id);

    const result = await pool.query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [notifId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error marking notification read:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/notifications/read-all — mark all as read
router.put('/read-all', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false RETURNING id',
      [req.user.id]
    );

    res.json({ marked: result.rows.length });
  } catch (error) {
    console.error('Error marking all notifications read:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notifications/settings — get user notification preferences
router.get('/settings', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT type, enabled FROM notification_settings WHERE user_id = $1',
      [req.user.id]
    );

    // Return all types with defaults (enabled=true) for missing ones
    const settings = {};
    for (const type of VALID_TYPES) {
      settings[type] = true; // default
    }
    for (const row of result.rows) {
      settings[row.type] = row.enabled;
    }

    res.json(settings);
  } catch (error) {
    console.error('Error getting notification settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/notifications/settings — update notification preferences
router.put('/settings', async (req, res) => {
  try {
    const updates = req.body;

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Settings object required' });
    }

    for (const [type, enabled] of Object.entries(updates)) {
      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid notification type: ${type}` });
      }
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: `Value for ${type} must be boolean` });
      }

      await pool.query(
        `INSERT INTO notification_settings (user_id, type, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, type) DO UPDATE SET enabled = $3`,
        [req.user.id, type, enabled]
      );
    }

    // Return updated settings
    const result = await pool.query(
      'SELECT type, enabled FROM notification_settings WHERE user_id = $1',
      [req.user.id]
    );

    const settings = {};
    for (const type of VALID_TYPES) {
      settings[type] = true;
    }
    for (const row of result.rows) {
      settings[row.type] = row.enabled;
    }

    res.json(settings);
  } catch (error) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Helper: create a notification (used by other modules)
async function createNotification(userId, type, title, message, entityType, entityId) {
  // Check if user has this type enabled
  const setting = await pool.query(
    'SELECT enabled FROM notification_settings WHERE user_id = $1 AND type = $2',
    [userId, type]
  );

  // Default is enabled if no setting exists
  if (setting.rows.length > 0 && !setting.rows[0].enabled) {
    return null;
  }

  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, type, title, message || null, entityType || null, entityId || null]
  );

  return result.rows[0];
}

module.exports = router;
module.exports.createNotification = createNotification;
module.exports.VALID_TYPES = VALID_TYPES;

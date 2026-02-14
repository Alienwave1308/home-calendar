const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const VALID_TIMEZONES = Intl.supportedValuesOf('timeZone');
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

router.use(authenticateToken);

// GET /api/users/me — get current user profile
router.get('/me', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, display_name, avatar_url, timezone,
              quiet_hours_start, quiet_hours_end, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/users/me — update current user profile
router.put('/me', async (req, res) => {
  try {
    const { display_name, timezone, quiet_hours_start, quiet_hours_end } = req.body;

    // Validate timezone
    if (timezone !== undefined && !VALID_TIMEZONES.includes(timezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Validate quiet hours format (HH:MM)
    if (quiet_hours_start !== undefined && quiet_hours_start !== null && !TIME_REGEX.test(quiet_hours_start)) {
      return res.status(400).json({ error: 'Invalid quiet_hours_start format. Use HH:MM' });
    }
    if (quiet_hours_end !== undefined && quiet_hours_end !== null && !TIME_REGEX.test(quiet_hours_end)) {
      return res.status(400).json({ error: 'Invalid quiet_hours_end format. Use HH:MM' });
    }

    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    if (display_name !== undefined) {
      fields.push(`display_name = $${idx++}`);
      values.push(display_name || null);
    }
    if (timezone !== undefined) {
      fields.push(`timezone = $${idx++}`);
      values.push(timezone);
    }
    if (quiet_hours_start !== undefined) {
      fields.push(`quiet_hours_start = $${idx++}`);
      values.push(quiet_hours_start || null);
    }
    if (quiet_hours_end !== undefined) {
      fields.push(`quiet_hours_end = $${idx++}`);
      values.push(quiet_hours_end || null);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.user.id);

    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')}
       WHERE id = $${idx}
       RETURNING id, username, display_name, avatar_url, timezone, quiet_hours_start, quiet_hours_end, created_at`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/users/me/avatar — upload avatar URL
router.put('/me/avatar', async (req, res) => {
  try {
    const { avatar_url } = req.body;

    if (avatar_url !== undefined && avatar_url !== null && typeof avatar_url !== 'string') {
      return res.status(400).json({ error: 'avatar_url must be a string or null' });
    }

    const result = await pool.query(
      `UPDATE users SET avatar_url = $1
       WHERE id = $2
       RETURNING id, username, display_name, avatar_url, timezone, quiet_hours_start, quiet_hours_end, created_at`,
      [avatar_url || null, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating avatar:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

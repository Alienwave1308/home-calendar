const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { nanoid } = require('nanoid');
const { generateSlots } = require('../lib/slots');

// All master routes require authentication
router.use(authenticateToken);

// Middleware: load master profile for the authenticated user
async function loadMaster(req, res, next) {
  const { rows } = await pool.query(
    'SELECT * FROM masters WHERE user_id = $1',
    [req.user.id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Master profile not found. Use POST /api/master/setup first.' });
  }
  req.master = rows[0];
  next();
}

// POST /api/master/setup — create master profile
router.post('/setup', async (req, res) => {
  try {
    const { display_name, timezone } = req.body;

    if (!display_name || display_name.length < 2) {
      return res.status(400).json({ error: 'display_name is required (min 2 chars)' });
    }

    // Check if already a master
    const existing = await pool.query('SELECT id FROM masters WHERE user_id = $1', [req.user.id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Master profile already exists' });
    }

    const booking_slug = nanoid(10);
    const tz = timezone || 'Europe/Moscow';

    const result = await pool.query(
      `INSERT INTO masters (user_id, display_name, timezone, booking_slug)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, display_name, timezone, booking_slug, cancel_policy_hours, created_at`,
      [req.user.id, display_name, tz, booking_slug]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating master profile:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/master/profile
router.get('/profile', loadMaster, async (req, res) => {
  const { id, user_id, display_name, timezone, booking_slug, cancel_policy_hours, created_at } = req.master;
  res.json({ id, user_id, display_name, timezone, booking_slug, cancel_policy_hours, created_at });
});

// PUT /api/master/profile
router.put('/profile', loadMaster, async (req, res) => {
  try {
    const { display_name, timezone, cancel_policy_hours } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (display_name !== undefined) {
      if (display_name.length < 2) {
        return res.status(400).json({ error: 'display_name must be at least 2 chars' });
      }
      updates.push(`display_name = $${idx++}`);
      values.push(display_name);
    }
    if (timezone !== undefined) {
      updates.push(`timezone = $${idx++}`);
      values.push(timezone);
    }
    if (cancel_policy_hours !== undefined) {
      const hours = Number(cancel_policy_hours);
      if (isNaN(hours) || hours < 0) {
        return res.status(400).json({ error: 'cancel_policy_hours must be a non-negative number' });
      }
      updates.push(`cancel_policy_hours = $${idx++}`);
      values.push(hours);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.master.id);
    const result = await pool.query(
      `UPDATE masters SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING id, user_id, display_name, timezone, booking_slug, cancel_policy_hours, created_at`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating master profile:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// === SERVICES ===

// GET /api/master/services
router.get('/services', loadMaster, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM services WHERE master_id = $1 ORDER BY created_at',
      [req.master.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing services:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/services
router.post('/services', loadMaster, async (req, res) => {
  try {
    const { name, duration_minutes, price, description, buffer_before_minutes, buffer_after_minutes } = req.body;

    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'name is required (min 2 chars)' });
    }
    const duration = Number(duration_minutes);
    if (!duration || duration < 5) {
      return res.status(400).json({ error: 'duration_minutes is required (min 5)' });
    }

    const result = await pool.query(
      `INSERT INTO services (master_id, name, duration_minutes, price, description,
                             buffer_before_minutes, buffer_after_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.master.id, name, duration, price || null, description || null,
       buffer_before_minutes || 0, buffer_after_minutes || 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/master/services/:id
router.put('/services/:id', loadMaster, async (req, res) => {
  try {
    const { name, duration_minutes, price, description, buffer_before_minutes, buffer_after_minutes, is_active } = req.body;

    // Verify ownership
    const service = await pool.query(
      'SELECT id FROM services WHERE id = $1 AND master_id = $2',
      [req.params.id, req.master.id]
    );
    if (service.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name);
    }
    if (duration_minutes !== undefined) {
      updates.push(`duration_minutes = $${idx++}`);
      values.push(Number(duration_minutes));
    }
    if (price !== undefined) {
      updates.push(`price = $${idx++}`);
      values.push(price);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description);
    }
    if (buffer_before_minutes !== undefined) {
      updates.push(`buffer_before_minutes = $${idx++}`);
      values.push(Number(buffer_before_minutes));
    }
    if (buffer_after_minutes !== undefined) {
      updates.push(`buffer_after_minutes = $${idx++}`);
      values.push(Number(buffer_after_minutes));
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(Boolean(is_active));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE services SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating service:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/master/services/:id
router.delete('/services/:id', loadMaster, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE services SET is_active = false WHERE id = $1 AND master_id = $2 RETURNING *',
      [req.params.id, req.master.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error deactivating service:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// === AVAILABILITY ===

// GET /api/master/availability
router.get('/availability', loadMaster, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM availability_rules WHERE master_id = $1 ORDER BY day_of_week, start_time',
      [req.master.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing availability:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/availability
router.post('/availability', loadMaster, async (req, res) => {
  try {
    const { day_of_week, start_time, end_time, slot_granularity_minutes } = req.body;

    const dow = Number(day_of_week);
    if (isNaN(dow) || dow < 0 || dow > 6) {
      return res.status(400).json({ error: 'day_of_week must be 0-6 (Sun-Sat)' });
    }
    if (!start_time || !end_time) {
      return res.status(400).json({ error: 'start_time and end_time are required (HH:MM)' });
    }

    const result = await pool.query(
      `INSERT INTO availability_rules (master_id, day_of_week, start_time, end_time, slot_granularity_minutes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.master.id, dow, start_time, end_time, slot_granularity_minutes || 30]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating availability rule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/master/availability/:id
router.put('/availability/:id', loadMaster, async (req, res) => {
  try {
    const { day_of_week, start_time, end_time, slot_granularity_minutes } = req.body;

    const rule = await pool.query(
      'SELECT id FROM availability_rules WHERE id = $1 AND master_id = $2',
      [req.params.id, req.master.id]
    );
    if (rule.rows.length === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (day_of_week !== undefined) { updates.push(`day_of_week = $${idx++}`); values.push(Number(day_of_week)); }
    if (start_time !== undefined) { updates.push(`start_time = $${idx++}`); values.push(start_time); }
    if (end_time !== undefined) { updates.push(`end_time = $${idx++}`); values.push(end_time); }
    if (slot_granularity_minutes !== undefined) { updates.push(`slot_granularity_minutes = $${idx++}`); values.push(Number(slot_granularity_minutes)); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE availability_rules SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating availability rule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/master/availability/:id
router.delete('/availability/:id', loadMaster, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM availability_rules WHERE id = $1 AND master_id = $2 RETURNING id',
      [req.params.id, req.master.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    res.json({ message: 'Rule deleted' });
  } catch (error) {
    console.error('Error deleting availability rule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// === EXCLUSIONS ===

// GET /api/master/availability/exclusions
router.get('/availability/exclusions', loadMaster, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM availability_exclusions WHERE master_id = $1 ORDER BY date',
      [req.master.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing exclusions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/availability/exclusions
router.post('/availability/exclusions', loadMaster, async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    }

    const result = await pool.query(
      `INSERT INTO availability_exclusions (master_id, date, reason)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.master.id, date, reason || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Exclusion for this date already exists' });
    }
    console.error('Error creating exclusion:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/master/availability/exclusions/:id
router.delete('/availability/exclusions/:id', loadMaster, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM availability_exclusions WHERE id = $1 AND master_id = $2 RETURNING id',
      [req.params.id, req.master.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Exclusion not found' });
    }
    res.json({ message: 'Exclusion deleted' });
  } catch (error) {
    console.error('Error deleting exclusion:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// === SLOTS PREVIEW ===

// GET /api/master/availability/preview?service_id=&date_from=&date_to=
router.get('/availability/preview', loadMaster, async (req, res) => {
  try {
    const { service_id, date_from, date_to } = req.query;

    if (!service_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'service_id, date_from, date_to are required' });
    }

    // Load service
    const svc = await pool.query(
      'SELECT * FROM services WHERE id = $1 AND master_id = $2 AND is_active = true',
      [service_id, req.master.id]
    );
    if (svc.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Load rules, exclusions, bookings, blocks
    const [rules, exclusions, bookings, blocks] = await Promise.all([
      pool.query('SELECT * FROM availability_rules WHERE master_id = $1', [req.master.id]),
      pool.query('SELECT date FROM availability_exclusions WHERE master_id = $1', [req.master.id]),
      pool.query(
        `SELECT start_at, end_at FROM bookings
         WHERE master_id = $1 AND status NOT IN ('canceled')
           AND start_at < $3 AND end_at > $2`,
        [req.master.id, date_from, date_to]
      ),
      pool.query(
        `SELECT start_at, end_at FROM master_blocks
         WHERE master_id = $1 AND start_at < $3 AND end_at > $2`,
        [req.master.id, date_from, date_to]
      )
    ]);

    const slots = generateSlots({
      service: svc.rows[0],
      rules: rules.rows,
      exclusions: exclusions.rows.map(e => e.date),
      bookings: bookings.rows,
      blocks: blocks.rows,
      dateFrom: date_from,
      dateTo: date_to,
      timezone: req.master.timezone
    });

    res.json({ slots });
  } catch (error) {
    console.error('Error generating slots preview:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

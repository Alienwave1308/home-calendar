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

// === BOOKINGS (Master management) ===

// GET /api/master/bookings?status=&date_from=&date_to=
router.get('/bookings', loadMaster, async (req, res) => {
  try {
    const { status, date_from, date_to } = req.query;
    let query = `
      SELECT b.*, s.name AS service_name, s.duration_minutes,
             u.username AS client_name
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      JOIN users u ON b.client_id = u.id
      WHERE b.master_id = $1`;
    const values = [req.master.id];
    let idx = 2;

    if (status) {
      query += ` AND b.status = $${idx++}`;
      values.push(status);
    }
    if (date_from) {
      query += ` AND b.start_at >= $${idx++}`;
      values.push(date_from);
    }
    if (date_to) {
      query += ` AND b.start_at <= $${idx++}`;
      values.push(date_to);
    }

    query += ' ORDER BY b.start_at';

    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (error) {
    console.error('Error listing master bookings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/master/calendar?date_from=&date_to=
router.get('/calendar', loadMaster, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    if (!date_from || !date_to) {
      return res.status(400).json({ error: 'date_from and date_to are required' });
    }

    const [bookingsRes, blocksRes] = await Promise.all([
      pool.query(
        `SELECT b.*, s.name AS service_name, s.duration_minutes,
                u.username AS client_name
         FROM bookings b
         JOIN services s ON b.service_id = s.id
         JOIN users u ON b.client_id = u.id
         WHERE b.master_id = $1 AND b.status != 'canceled'
           AND b.start_at < $3 AND b.end_at > $2
         ORDER BY b.start_at`,
        [req.master.id, date_from, date_to]
      ),
      pool.query(
        `SELECT * FROM master_blocks
         WHERE master_id = $1 AND start_at < $3 AND end_at > $2
         ORDER BY start_at`,
        [req.master.id, date_from, date_to]
      )
    ]);

    res.json({
      bookings: bookingsRes.rows,
      blocks: blocksRes.rows
    });
  } catch (error) {
    console.error('Error loading master calendar:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/master/bookings/:id — change status, add notes
router.patch('/bookings/:id', loadMaster, async (req, res) => {
  try {
    const { status, master_note } = req.body;

    const booking = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND master_id = $2',
      [req.params.id, req.master.id]
    );
    if (booking.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const validStatuses = ['pending', 'confirmed', 'canceled', 'completed', 'no_show'];
    const updates = [];
    const values = [];
    let idx = 1;

    if (status !== undefined) {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }
      updates.push(`status = $${idx++}`);
      values.push(status);
    }
    if (master_note !== undefined) {
      updates.push(`master_note = $${idx++}`);
      values.push(master_note);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE bookings SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/bookings — create booking manually (admin_created)
router.post('/bookings', loadMaster, async (req, res) => {
  try {
    const { client_id, service_id, start_at, master_note } = req.body;

    if (!client_id || !service_id || !start_at) {
      return res.status(400).json({ error: 'client_id, service_id, start_at are required' });
    }

    // Load service to calculate end_at
    const svc = await pool.query(
      'SELECT * FROM services WHERE id = $1 AND master_id = $2 AND is_active = true',
      [service_id, req.master.id]
    );
    if (svc.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const service = svc.rows[0];
    const startDate = new Date(start_at);
    const endDate = new Date(startDate.getTime() + service.duration_minutes * 60000);

    const result = await pool.query(
      `INSERT INTO bookings (master_id, client_id, service_id, start_at, end_at, status, source, master_note)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', 'admin_created', $6)
       RETURNING *`,
      [req.master.id, client_id, service_id, startDate.toISOString(), endDate.toISOString(), master_note || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23P01') {
      return res.status(409).json({ error: 'Time slot is already taken' });
    }
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// === BLOCKS (Master busy time) ===

// GET /api/master/blocks
router.get('/blocks', loadMaster, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM master_blocks WHERE master_id = $1 ORDER BY start_at',
      [req.master.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error listing blocks:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/blocks
router.post('/blocks', loadMaster, async (req, res) => {
  try {
    const { start_at, end_at, title } = req.body;

    if (!start_at || !end_at) {
      return res.status(400).json({ error: 'start_at and end_at are required' });
    }
    if (new Date(start_at) >= new Date(end_at)) {
      return res.status(400).json({ error: 'start_at must be before end_at' });
    }

    const result = await pool.query(
      `INSERT INTO master_blocks (master_id, start_at, end_at, title)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.master.id, start_at, end_at, title || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating block:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/master/blocks/:id
router.put('/blocks/:id', loadMaster, async (req, res) => {
  try {
    const { start_at, end_at, title } = req.body;

    const block = await pool.query(
      'SELECT id FROM master_blocks WHERE id = $1 AND master_id = $2',
      [req.params.id, req.master.id]
    );
    if (block.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (start_at !== undefined) { updates.push(`start_at = $${idx++}`); values.push(start_at); }
    if (end_at !== undefined) { updates.push(`end_at = $${idx++}`); values.push(end_at); }
    if (title !== undefined) { updates.push(`title = $${idx++}`); values.push(title); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE master_blocks SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating block:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/master/blocks/:id
router.delete('/blocks/:id', loadMaster, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM master_blocks WHERE id = $1 AND master_id = $2 RETURNING id',
      [req.params.id, req.master.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Block not found' });
    }
    res.json({ message: 'Block deleted' });
  } catch (error) {
    console.error('Error deleting block:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

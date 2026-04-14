const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { generateSlots } = require('../lib/slots');
const asyncRoute = require('../lib/asyncRoute');
const { loadMaster } = require('./master-shared');

// GET /api/master/availability
router.get('/availability', loadMaster, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM availability_rules WHERE master_id = $1 ORDER BY day_of_week, start_time',
    [req.master.id]
  );
  res.json(rows);
}));

// POST /api/master/availability
router.post('/availability', loadMaster, asyncRoute(async (req, res) => {
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
}));

// PUT /api/master/availability/:id
router.put('/availability/:id', loadMaster, asyncRoute(async (req, res) => {
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
}));

// DELETE /api/master/availability/:id
router.delete('/availability/:id', loadMaster, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'DELETE FROM availability_rules WHERE id = $1 AND master_id = $2 RETURNING id',
    [req.params.id, req.master.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Rule not found' });
  }
  res.json({ message: 'Rule deleted' });
}));

// === EXCLUSIONS ===

// GET /api/master/availability/exclusions
router.get('/availability/exclusions', loadMaster, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM availability_exclusions WHERE master_id = $1 ORDER BY date',
    [req.master.id]
  );
  res.json(rows);
}));

// POST /api/master/availability/exclusions
router.post('/availability/exclusions', loadMaster, asyncRoute(async (req, res) => {
  const { date, reason } = req.body;
  if (!date) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  }

  try {
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
    throw error;
  }
}));

// DELETE /api/master/availability/exclusions/:id
router.delete('/availability/exclusions/:id', loadMaster, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'DELETE FROM availability_exclusions WHERE id = $1 AND master_id = $2 RETURNING id',
    [req.params.id, req.master.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Exclusion not found' });
  }
  res.json({ message: 'Exclusion deleted' });
}));

// === DATE-BASED AVAILABILITY WINDOWS ===

// GET /api/master/availability/windows
router.get('/availability/windows', loadMaster, asyncRoute(async (req, res) => {
  const { date_from, date_to } = req.query;
  const values = [req.master.id];
  let where = 'master_id = $1';

  if (date_from) {
    values.push(date_from);
    where += ` AND date >= $${values.length}`;
  }
  if (date_to) {
    values.push(date_to);
    where += ` AND date <= $${values.length}`;
  }

  const { rows } = await pool.query(
    `SELECT id, master_id, date, start_time, end_time, created_at
     FROM availability_windows
     WHERE ${where}
     ORDER BY date ASC, start_time ASC`,
    values
  );
  res.json(rows);
}));

// POST /api/master/availability/windows
router.post('/availability/windows', loadMaster, asyncRoute(async (req, res) => {
  const { date, start_time, end_time } = req.body;
  if (!date || !start_time || !end_time) {
    return res.status(400).json({ error: 'date, start_time and end_time are required' });
  }
  if (String(start_time) >= String(end_time)) {
    return res.status(400).json({ error: 'start_time must be earlier than end_time' });
  }

  const result = await pool.query(
    `INSERT INTO availability_windows (master_id, date, start_time, end_time)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (master_id, date, start_time, end_time) DO NOTHING
     RETURNING id, master_id, date, start_time, end_time, created_at`,
    [req.master.id, date, start_time, end_time]
  );

  if (result.rows.length === 0) {
    return res.status(409).json({ error: 'Window already exists' });
  }
  res.status(201).json(result.rows[0]);
}));

// DELETE /api/master/availability/windows/:id
router.delete('/availability/windows/:id', loadMaster, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'DELETE FROM availability_windows WHERE id = $1 AND master_id = $2 RETURNING id',
    [req.params.id, req.master.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Window not found' });
  }
  res.json({ message: 'Window deleted' });
}));

// === SLOTS PREVIEW ===

// GET /api/master/availability/preview
router.get('/availability/preview', loadMaster, asyncRoute(async (req, res) => {
  const { service_id, date_from, date_to } = req.query;

  if (!service_id || !date_from || !date_to) {
    return res.status(400).json({ error: 'service_id, date_from, date_to are required' });
  }

  const svc = await pool.query(
    'SELECT * FROM services WHERE id = $1 AND master_id = $2 AND is_active = true',
    [service_id, req.master.id]
  );
  if (svc.rows.length === 0) {
    return res.status(404).json({ error: 'Service not found' });
  }

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
}));

module.exports = router;

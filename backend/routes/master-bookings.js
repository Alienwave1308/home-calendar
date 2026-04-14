const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { createReminders, deleteReminders } = require('../lib/reminders');
const { notifyMasterBookingEvent, notifyClientBookingEvent } = require('../lib/telegram-notify');
const asyncRoute = require('../lib/asyncRoute');
const { loadMaster } = require('./master-shared');
const { BOOKING_STATUSES } = require('../lib/constants');

const VALID_STATUSES = BOOKING_STATUSES;

// GET /api/master/bookings
router.get('/bookings', loadMaster, asyncRoute(async (req, res) => {
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

  if (status) { query += ` AND b.status = $${idx++}`; values.push(status); }
  if (date_from) { query += ` AND b.start_at >= $${idx++}`; values.push(date_from); }
  if (date_to) { query += ` AND b.start_at <= $${idx}`; values.push(date_to); }

  query += ' ORDER BY b.start_at';

  const { rows } = await pool.query(query, values);
  res.json(rows);
}));

// GET /api/master/calendar
router.get('/calendar', loadMaster, asyncRoute(async (req, res) => {
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

  res.json({ bookings: bookingsRes.rows, blocks: blocksRes.rows });
}));

// GET /api/master/clients
router.get('/clients', loadMaster, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       u.id AS user_id,
       u.username,
       CASE
         WHEN u.username ~ '^tg_[0-9]+$' THEN substring(u.username from 4)::bigint
         ELSE NULL
       END AS telegram_user_id,
       COUNT(b.id)::int AS bookings_total,
       COUNT(*) FILTER (WHERE b.start_at >= NOW() AND b.status NOT IN ('canceled'))::int AS upcoming_total,
       MAX(b.start_at) AS last_booking_at
     FROM bookings b
     JOIN users u ON u.id = b.client_id
     WHERE b.master_id = $1
     GROUP BY u.id, u.username
     ORDER BY MAX(b.start_at) DESC`,
    [req.master.id]
  );
  res.json(rows);
}));

// GET /api/master/clients/:client_id/bookings
router.get('/clients/:client_id/bookings', loadMaster, asyncRoute(async (req, res) => {
  const clientId = Number(req.params.client_id);
  if (!clientId || Number.isNaN(clientId)) {
    return res.status(400).json({ error: 'client_id must be a valid number' });
  }

  const { rows } = await pool.query(
    `SELECT
       b.id, b.client_id, b.service_id, b.start_at, b.end_at,
       b.status, b.client_note, b.master_note, b.created_at, b.updated_at,
       s.name AS service_name
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     WHERE b.master_id = $1 AND b.client_id = $2
     ORDER BY b.start_at DESC`,
    [req.master.id, clientId]
  );
  res.json(rows);
}));

// PATCH /api/master/bookings/:id — change status, add notes
router.patch('/bookings/:id', loadMaster, asyncRoute(async (req, res) => {
  const { status, master_note } = req.body;

  const booking = await pool.query(
    'SELECT * FROM bookings WHERE id = $1 AND master_id = $2',
    [req.params.id, req.master.id]
  );
  if (booking.rows.length === 0) {
    return res.status(404).json({ error: 'Booking not found' });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
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
  const updated = result.rows[0];

  try {
    if (status !== undefined) {
      if (['canceled', 'completed', 'no_show'].includes(updated.status)) {
        await deleteReminders(updated.id);
      } else if (updated.status === 'confirmed') {
        await deleteReminders(updated.id);
        await createReminders(updated.id, updated.master_id, updated.start_at);
      }
    }
    await notifyMasterBookingEvent(updated.id, 'updated');
    if (status !== undefined || master_note !== undefined) {
      await notifyClientBookingEvent(updated.id, updated.status === 'canceled' ? 'canceled' : 'updated');
    }
  } catch (notifyError) {
    console.error('Error handling booking patch side-effects:', notifyError);
  }

  res.json(updated);
}));

// POST /api/master/bookings — create booking manually
router.post('/bookings', loadMaster, asyncRoute(async (req, res) => {
  const { client_id, service_id, start_at, master_note, status } = req.body;

  if (!client_id || !service_id || !start_at) {
    return res.status(400).json({ error: 'client_id, service_id, start_at are required' });
  }
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

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

  try {
    const result = await pool.query(
      `INSERT INTO bookings (master_id, client_id, service_id, start_at, end_at, status, source, master_note)
       VALUES ($1, $2, $3, $4, $5, $6, 'admin_created', $7)
       RETURNING *`,
      [req.master.id, client_id, service_id, startDate.toISOString(), endDate.toISOString(),
       status || 'confirmed', master_note || null]
    );

    const created = result.rows[0];

    try {
      if (created.status === 'confirmed') {
        await createReminders(created.id, created.master_id, created.start_at);
      }
      await notifyMasterBookingEvent(created.id, 'created');
    } catch (notifyError) {
      console.error('Error handling booking create side-effects:', notifyError);
    }

    res.status(201).json(created);
  } catch (error) {
    if (error.code === '23P01') {
      return res.status(409).json({ error: 'Time slot is already taken' });
    }
    throw error;
  }
}));

// PUT /api/master/bookings/:id — edit booking details
router.put('/bookings/:id', loadMaster, asyncRoute(async (req, res) => {
  const { client_id, service_id, start_at, status, master_note } = req.body;

  if (client_id === undefined && service_id === undefined && start_at === undefined
      && status === undefined && master_note === undefined) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const currentRes = await pool.query(
    `SELECT b.*, s.duration_minutes
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     WHERE b.id = $1 AND b.master_id = $2`,
    [req.params.id, req.master.id]
  );
  if (currentRes.rows.length === 0) {
    return res.status(404).json({ error: 'Booking not found' });
  }
  const current = currentRes.rows[0];

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  if (client_id !== undefined) {
    const clientRes = await pool.query('SELECT id FROM users WHERE id = $1', [client_id]);
    if (clientRes.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
  }

  let nextServiceId = current.service_id;
  let nextDuration = current.duration_minutes;
  if (service_id !== undefined) {
    const svcRes = await pool.query(
      'SELECT id, duration_minutes FROM services WHERE id = $1 AND master_id = $2 AND is_active = true',
      [service_id, req.master.id]
    );
    if (svcRes.rows.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    nextServiceId = service_id;
    nextDuration = svcRes.rows[0].duration_minutes;
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (client_id !== undefined) { updates.push(`client_id = $${idx++}`); values.push(client_id); }
  if (service_id !== undefined) { updates.push(`service_id = $${idx++}`); values.push(nextServiceId); }

  if (start_at !== undefined || service_id !== undefined) {
    const startDate = start_at !== undefined ? new Date(start_at) : new Date(current.start_at);
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'start_at must be a valid datetime' });
    }
    const endDate = new Date(startDate.getTime() + nextDuration * 60000);
    updates.push(`start_at = $${idx++}`); values.push(startDate.toISOString());
    updates.push(`end_at = $${idx++}`); values.push(endDate.toISOString());
  }

  if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }
  if (master_note !== undefined) { updates.push(`master_note = $${idx++}`); values.push(master_note); }

  updates.push('updated_at = NOW()');
  values.push(req.params.id);

  try {
    const result = await pool.query(
      `UPDATE bookings SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    const updated = result.rows[0];

    try {
      if (['canceled', 'completed', 'no_show'].includes(updated.status)) {
        await deleteReminders(updated.id);
      } else if (updated.status === 'confirmed') {
        await deleteReminders(updated.id);
        await createReminders(updated.id, updated.master_id, updated.start_at);
      }
      await notifyMasterBookingEvent(updated.id, 'updated');
      await notifyClientBookingEvent(updated.id, updated.status === 'canceled' ? 'canceled' : 'updated');
    } catch (notifyError) {
      console.error('Error handling booking edit side-effects:', notifyError);
    }

    res.json(updated);
  } catch (error) {
    if (error.code === '23P01') {
      return res.status(409).json({ error: 'Time slot is already taken' });
    }
    throw error;
  }
}));

module.exports = router;

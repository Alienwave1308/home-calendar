const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { createReminders, deleteReminders } = require('../lib/reminders');
const { notifyMasterBookingEvent } = require('../lib/telegram-notify');

// All client booking routes require authentication
router.use(authenticateToken);

// GET /api/client/bookings
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH first_booking AS (
         SELECT master_id, client_id, MIN(id) AS first_booking_id
         FROM bookings
         GROUP BY master_id, client_id
       )
       SELECT b.*, s.name AS service_name, s.price AS service_price,
              m.display_name AS master_name, m.timezone AS master_timezone,
              CASE
                WHEN b.id = fb.first_booking_id
                  THEN COALESCE(ms.first_visit_discount_percent, 0)
                ELSE 0
              END AS discount_percent,
              CASE
                WHEN s.price IS NULL THEN NULL
                WHEN b.id = fb.first_booking_id
                  THEN GREATEST(0, ROUND(s.price * (100 - COALESCE(ms.first_visit_discount_percent, 0)) / 100.0)::int)
                ELSE s.price
              END AS final_price
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN masters m ON b.master_id = m.id
       LEFT JOIN master_settings ms ON ms.master_id = b.master_id
       LEFT JOIN first_booking fb ON fb.master_id = b.master_id AND fb.client_id = b.client_id
       WHERE b.client_id = $1
       ORDER BY b.start_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (error) {
    console.error('Error loading client bookings:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/client/bookings/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `WITH first_booking AS (
         SELECT master_id, client_id, MIN(id) AS first_booking_id
         FROM bookings
         GROUP BY master_id, client_id
       )
       SELECT b.*, s.name AS service_name, s.price AS service_price,
              m.display_name AS master_name, m.timezone AS master_timezone,
              CASE
                WHEN b.id = fb.first_booking_id
                  THEN COALESCE(ms.first_visit_discount_percent, 0)
                ELSE 0
              END AS discount_percent,
              CASE
                WHEN s.price IS NULL THEN NULL
                WHEN b.id = fb.first_booking_id
                  THEN GREATEST(0, ROUND(s.price * (100 - COALESCE(ms.first_visit_discount_percent, 0)) / 100.0)::int)
                ELSE s.price
              END AS final_price
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN masters m ON b.master_id = m.id
       LEFT JOIN master_settings ms ON ms.master_id = b.master_id
       LEFT JOIN first_booking fb ON fb.master_id = b.master_id AND fb.client_id = b.client_id
       WHERE b.id = $1 AND b.client_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    return res.json(rows[0]);
  } catch (error) {
    console.error('Error loading client booking:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/client/bookings/:id/cancel
router.patch('/:id/cancel', async (req, res) => {
  try {
    // Load booking with master's cancel policy
    const { rows } = await pool.query(
      `SELECT b.*, m.cancel_policy_hours
       FROM bookings b
       JOIN masters m ON b.master_id = m.id
       WHERE b.id = $1 AND b.client_id = $2`,
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = rows[0];

    if (booking.status === 'canceled') {
      return res.status(400).json({ error: 'Booking is already canceled' });
    }
    if (booking.status === 'completed') {
      return res.status(400).json({ error: 'Cannot cancel a completed booking' });
    }

    // Check cancel policy: must be at least X hours before start
    const hoursUntilStart = (new Date(booking.start_at) - Date.now()) / 3600000;
    if (hoursUntilStart < booking.cancel_policy_hours) {
      return res.status(403).json({
        error: `Cannot cancel less than ${booking.cancel_policy_hours} hours before the appointment`
      });
    }

    const result = await pool.query(
      `UPDATE bookings SET status = 'canceled', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    try {
      await deleteReminders(booking.id);
    } catch (notifyError) {
      console.error('Error deleting reminders for canceled booking:', notifyError);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error canceling booking:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/client/bookings/:id/reschedule
router.patch('/:id/reschedule', async (req, res) => {
  try {
    const { new_start_at } = req.body;

    if (!new_start_at) {
      return res.status(400).json({ error: 'new_start_at is required' });
    }

    // Load booking with master's cancel policy and service duration
    const { rows } = await pool.query(
      `SELECT b.*, m.cancel_policy_hours, s.duration_minutes
       FROM bookings b
       JOIN masters m ON b.master_id = m.id
       JOIN services s ON b.service_id = s.id
       WHERE b.id = $1 AND b.client_id = $2`,
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = rows[0];

    if (booking.status === 'canceled' || booking.status === 'completed') {
      return res.status(400).json({ error: `Cannot reschedule a ${booking.status} booking` });
    }

    // Check cancel policy
    const hoursUntilStart = (new Date(booking.start_at) - Date.now()) / 3600000;
    if (hoursUntilStart < booking.cancel_policy_hours) {
      return res.status(403).json({
        error: `Cannot reschedule less than ${booking.cancel_policy_hours} hours before the appointment`
      });
    }

    // Calculate new end time
    const newStart = new Date(new_start_at);
    const newEnd = new Date(newStart.getTime() + booking.duration_minutes * 60000);

    // Atomically check for conflicts and update
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check for overlapping bookings (excluding current one)
      const conflict = await client.query(
        `SELECT id FROM bookings
         WHERE master_id = $1
           AND id != $2
           AND status NOT IN ('canceled')
           AND tstzrange(start_at, end_at, '()') && tstzrange($3, $4, '()')
         FOR UPDATE`,
        [booking.master_id, booking.id, newStart.toISOString(), newEnd.toISOString()]
      );

      if (conflict.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'New time slot is already taken' });
      }

      const result = await client.query(
        `UPDATE bookings SET start_at = $1, end_at = $2, updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [newStart.toISOString(), newEnd.toISOString(), booking.id]
      );

      await client.query('COMMIT');
      const updated = result.rows[0];

      try {
        await deleteReminders(updated.id);
        if (updated.status === 'confirmed') {
          await createReminders(updated.id, updated.master_id, updated.start_at);
        }
        await notifyMasterBookingEvent(updated.id, 'updated');
      } catch (notifyError) {
        console.error('Error handling reschedule side-effects:', notifyError);
      }

      res.json(updated);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error.code === '23P01') {
      return res.status(409).json({ error: 'New time slot is already taken' });
    }
    console.error('Error rescheduling booking:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const crypto = require('crypto');
const asyncRoute = require('../lib/asyncRoute');
const { loadMaster } = require('./master-shared');

// GET /api/master/settings
router.get('/settings', loadMaster, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM master_settings WHERE master_id = $1',
    [req.master.id]
  );
  if (rows.length === 0) {
    return res.json({
      master_id: req.master.id,
      reminder_hours: [24, 2],
      quiet_hours_start: null,
      quiet_hours_end: null,
      first_visit_discount_percent: 15,
      min_booking_notice_minutes: 60,
      apple_calendar_enabled: false,
      apple_calendar_token: null
    });
  }
  res.json(rows[0]);
}));

// PUT /api/master/settings
router.put('/settings', loadMaster, asyncRoute(async (req, res) => {
  const {
    reminder_hours,
    quiet_hours_start,
    quiet_hours_end,
    apple_calendar_enabled,
    first_visit_discount_percent,
    min_booking_notice_minutes
  } = req.body;
  let reminderHoursValue = null;

  if (reminder_hours !== undefined && !Array.isArray(reminder_hours)) {
    return res.status(400).json({ error: 'reminder_hours must be an array of numbers' });
  }
  if (reminder_hours !== undefined && reminder_hours.length !== 2) {
    return res.status(400).json({ error: 'reminder_hours must contain exactly 2 values' });
  }
  if (reminder_hours !== undefined) {
    const parsed = reminder_hours.map((v) => Number(v));
    const valid = parsed.every((v) => Number.isInteger(v) && v > 0 && v <= 168);
    if (!valid) {
      return res.status(400).json({ error: 'reminder_hours values must be integers from 1 to 168' });
    }
    reminderHoursValue = JSON.stringify(parsed);
  }
  if (apple_calendar_enabled !== undefined && typeof apple_calendar_enabled !== 'boolean') {
    return res.status(400).json({ error: 'apple_calendar_enabled must be boolean' });
  }
  if (
    first_visit_discount_percent !== undefined
    && (!Number.isInteger(Number(first_visit_discount_percent)) || Number(first_visit_discount_percent) < 0 || Number(first_visit_discount_percent) > 90)
  ) {
    return res.status(400).json({ error: 'first_visit_discount_percent must be between 0 and 90' });
  }
  if (
    min_booking_notice_minutes !== undefined
    && (!Number.isInteger(Number(min_booking_notice_minutes)) || Number(min_booking_notice_minutes) < 0 || Number(min_booking_notice_minutes) > 1440)
  ) {
    return res.status(400).json({ error: 'min_booking_notice_minutes must be between 0 and 1440' });
  }

  const result = await pool.query(
    `INSERT INTO master_settings (
       master_id, reminder_hours, quiet_hours_start, quiet_hours_end, apple_calendar_enabled,
       first_visit_discount_percent, min_booking_notice_minutes
     )
     VALUES ($1, COALESCE($2::jsonb, '[24, 2]'::jsonb), $3, $4, COALESCE($5, false), COALESCE($6, 15), COALESCE($7, 60))
     ON CONFLICT (master_id) DO UPDATE SET
       reminder_hours = COALESCE($2::jsonb, master_settings.reminder_hours),
       quiet_hours_start = $3,
       quiet_hours_end = $4,
       apple_calendar_enabled = COALESCE($5, master_settings.apple_calendar_enabled),
       first_visit_discount_percent = COALESCE($6, master_settings.first_visit_discount_percent),
       min_booking_notice_minutes = COALESCE($7, master_settings.min_booking_notice_minutes)
     RETURNING *`,
    [
      req.master.id,
      reminderHoursValue,
      quiet_hours_start || null,
      quiet_hours_end || null,
      apple_calendar_enabled,
      first_visit_discount_percent !== undefined ? Number(first_visit_discount_percent) : null,
      min_booking_notice_minutes !== undefined ? Number(min_booking_notice_minutes) : null
    ]
  );

  res.json(result.rows[0]);
}));

// POST /api/master/settings/apple-calendar/enable
router.post('/settings/apple-calendar/enable', loadMaster, asyncRoute(async (req, res) => {
  const existing = await pool.query(
    'SELECT apple_calendar_token FROM master_settings WHERE master_id = $1',
    [req.master.id]
  );
  const token = existing.rows[0]?.apple_calendar_token || crypto.randomBytes(24).toString('hex');

  const result = await pool.query(
    `INSERT INTO master_settings (master_id, reminder_hours, apple_calendar_enabled, apple_calendar_token)
     VALUES ($1, '[24,2]'::jsonb, true, $2)
     ON CONFLICT (master_id) DO UPDATE SET
       apple_calendar_enabled = true,
       apple_calendar_token = COALESCE(master_settings.apple_calendar_token, $2)
     RETURNING master_id, apple_calendar_enabled, apple_calendar_token`,
    [req.master.id, token]
  );

  res.json(result.rows[0]);
}));

// POST /api/master/settings/apple-calendar/rotate
router.post('/settings/apple-calendar/rotate', loadMaster, asyncRoute(async (req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  const result = await pool.query(
    `INSERT INTO master_settings (master_id, reminder_hours, apple_calendar_enabled, apple_calendar_token)
     VALUES ($1, '[24,2]'::jsonb, true, $2)
     ON CONFLICT (master_id) DO UPDATE SET
       apple_calendar_enabled = true,
       apple_calendar_token = $2
     RETURNING master_id, apple_calendar_enabled, apple_calendar_token`,
    [req.master.id, token]
  );
  res.json(result.rows[0]);
}));

// DELETE /api/master/settings/apple-calendar
router.delete('/settings/apple-calendar', loadMaster, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `INSERT INTO master_settings (master_id, reminder_hours, apple_calendar_enabled)
     VALUES ($1, '[24,2]'::jsonb, false)
     ON CONFLICT (master_id) DO UPDATE SET apple_calendar_enabled = false
     RETURNING master_id, apple_calendar_enabled`,
    [req.master.id]
  );
  res.json(result.rows[0]);
}));

module.exports = router;

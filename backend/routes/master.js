const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { nanoid } = require('nanoid');
const crypto = require('crypto');
const { generateSlots } = require('../lib/slots');
const { DEFAULT_SERVICES, toDescription } = require('../lib/default-services');
const { createReminders, deleteReminders } = require('../lib/reminders');
const { notifyMasterBookingEvent, notifyClientBookingEvent } = require('../lib/telegram-notify');

// All master routes require authentication
router.use(authenticateToken);

router.use(async (req, res, next) => {
  if (process.env.NODE_ENV === 'test') return next();

  const masterTelegramId = String(process.env.MASTER_TELEGRAM_USER_ID || '').trim();
  if (masterTelegramId) {
    if (req.user.username !== `tg_${masterTelegramId}`) {
      return res.status(403).json({ error: 'Master access is restricted to configured Telegram account' });
    }
    return next();
  }

  try {
    const { rows } = await pool.query(
      'SELECT user_id FROM masters ORDER BY id ASC LIMIT 1'
    );
    if (rows.length === 0) {
      return res.status(503).json({ error: 'Master profile is not initialized yet' });
    }
    if (Number(rows[0].user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Master access is restricted to the first Telegram master account' });
    }
    return next();
  } catch (error) {
    console.error('Error validating master access:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

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

const LEAD_PERIODS = {
  day: {
    sqlStart: "date_trunc('day', now() AT TIME ZONE $1)",
    sqlEnd: "date_trunc('day', now() AT TIME ZONE $1) + interval '1 day'",
    sqlPrevStart: "date_trunc('day', now() AT TIME ZONE $1) - interval '1 day'",
    sqlPrevEnd: "date_trunc('day', now() AT TIME ZONE $1)"
  },
  week: {
    sqlStart: "date_trunc('week', now() AT TIME ZONE $1)",
    sqlEnd: "date_trunc('week', now() AT TIME ZONE $1) + interval '1 week'",
    sqlPrevStart: "date_trunc('week', now() AT TIME ZONE $1) - interval '1 week'",
    sqlPrevEnd: "date_trunc('week', now() AT TIME ZONE $1)"
  },
  month: {
    sqlStart: "date_trunc('month', now() AT TIME ZONE $1)",
    sqlEnd: "date_trunc('month', now() AT TIME ZONE $1) + interval '1 month'",
    sqlPrevStart: "date_trunc('month', now() AT TIME ZONE $1) - interval '1 month'",
    sqlPrevEnd: "date_trunc('month', now() AT TIME ZONE $1)"
  }
};

function normalizeLeadPeriod(value) {
  const key = String(value || 'day').toLowerCase();
  return LEAD_PERIODS[key] ? key : 'day';
}

function toPercent(numerator, denominator) {
  if (!denominator || denominator <= 0) return null;
  return Math.round((Number(numerator) / Number(denominator)) * 1000) / 10;
}

function buildLeadConversion(metrics) {
  const visitors = Number(metrics.visitors || 0);
  const authStarted = Number(metrics.auth_started || 0);
  const authSuccess = Number(metrics.auth_success || 0);
  const bookingStarted = Number(metrics.booking_started || 0);
  const bookingCreated = Number(metrics.booking_created || 0);

  return {
    visit_to_auth_start: toPercent(authStarted, visitors),
    auth_start_to_auth_success: toPercent(authSuccess, authStarted),
    auth_success_to_booking_created: toPercent(bookingCreated, authSuccess),
    visit_to_booking_created: toPercent(bookingCreated, visitors),
    booking_started_to_booking_created: toPercent(bookingCreated, bookingStarted)
  };
}

async function telegramApiCall(method, payload) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || typeof fetch !== 'function') return null;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    return data && data.ok ? data.result : null;
  } catch (error) {
    console.error(`Error calling Telegram API ${method}:`, error);
    return null;
  }
}

async function getTelegramFileUrl(fileId) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !fileId) return null;
  const file = await telegramApiCall('getFile', { file_id: fileId });
  if (!file || !file.file_path) return null;
  return `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
}

async function resolveTelegramProfile(telegramUserId) {
  const chat = await telegramApiCall('getChat', { chat_id: telegramUserId });
  if (!chat) return null;

  const firstName = String(chat.first_name || '').trim();
  const lastName = String(chat.last_name || '').trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const telegramUsername = typeof chat.username === 'string' ? chat.username : null;
  let avatarUrl = null;
  if (chat.photo && (chat.photo.big_file_id || chat.photo.small_file_id)) {
    avatarUrl = await getTelegramFileUrl(chat.photo.big_file_id || chat.photo.small_file_id);
  }

  return {
    display_name: fullName || (telegramUsername ? `@${telegramUsername}` : null),
    telegram_username: telegramUsername,
    avatar_url: avatarUrl
  };
}

async function enrichLeadUsersWithTelegramProfile(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const candidates = rows.filter((item) => (
    Number(item.telegram_user_id || 0) > 0
    && (!item.display_name || !item.telegram_username || !item.avatar_url)
  )).slice(0, 25);

  for (const user of candidates) {
    const profile = await resolveTelegramProfile(Number(user.telegram_user_id));
    if (!profile) continue;

    if (profile.display_name) user.display_name = profile.display_name;
    if (profile.telegram_username) user.telegram_username = profile.telegram_username;
    if (profile.avatar_url) user.avatar_url = profile.avatar_url;

    try {
      await pool.query(
        `UPDATE users
         SET
           display_name = COALESCE($1, display_name),
           telegram_username = COALESCE($2, telegram_username),
           avatar_url = COALESCE($3, avatar_url)
         WHERE id = $4`,
        [profile.display_name, profile.telegram_username, profile.avatar_url, user.user_id]
      );
    } catch (error) {
      console.error('Error updating Telegram profile for lead user:', error);
    }
  }

  return rows;
}

async function loadLeadBounds(timezone, periodSql) {
  const boundsRes = await pool.query(
    `SELECT
       (${periodSql.sqlStart})::timestamp AS current_start_local,
       (${periodSql.sqlEnd})::timestamp AS current_end_local,
       (${periodSql.sqlPrevStart})::timestamp AS previous_start_local,
       (${periodSql.sqlPrevEnd})::timestamp AS previous_end_local`,
    [timezone]
  );
  return boundsRes.rows[0];
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
    const tz = timezone || process.env.MASTER_TIMEZONE || 'Asia/Novosibirsk';

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

// POST /api/master/services/bootstrap-default
router.post('/services/bootstrap-default', loadMaster, async (req, res) => {
  const overwrite = Boolean(req.body && req.body.overwrite);

  try {
    const existing = await pool.query(
      'SELECT COUNT(*)::int AS total FROM services WHERE master_id = $1 AND is_active = true',
      [req.master.id]
    );
    const activeCount = Number(existing.rows[0]?.total || 0);

    if (activeCount > 0 && !overwrite) {
      return res.status(409).json({
        error: 'Services already exist. Pass { overwrite: true } to replace them.',
        active_services: activeCount
      });
    }

    await pool.query('BEGIN');

    if (overwrite) {
      await pool.query(
        'UPDATE services SET is_active = false WHERE master_id = $1 AND is_active = true',
        [req.master.id]
      );
    }

    const inserted = [];
    for (const item of DEFAULT_SERVICES) {
      const result = await pool.query(
        `INSERT INTO services (master_id, name, duration_minutes, price, description,
                               buffer_before_minutes, buffer_after_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.master.id, item.name, item.duration_minutes, item.price, toDescription(item), 0, 0]
      );
      inserted.push(result.rows[0]);
    }

    await pool.query('COMMIT');
    return res.status(201).json({
      inserted_count: inserted.length,
      overwrite,
      services: inserted
    });
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Error bootstrapping default services:', error);
    return res.status(500).json({ error: 'Server error' });
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

// === DATE-BASED AVAILABILITY WINDOWS ===

// GET /api/master/availability/windows?date_from=&date_to=
router.get('/availability/windows', loadMaster, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error listing availability windows:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/availability/windows
router.post('/availability/windows', loadMaster, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error creating availability window:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/master/availability/windows/:id
router.delete('/availability/windows/:id', loadMaster, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM availability_windows WHERE id = $1 AND master_id = $2 RETURNING id',
      [req.params.id, req.master.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Window not found' });
    }
    res.json({ message: 'Window deleted' });
  } catch (error) {
    console.error('Error deleting availability window:', error);
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

// === CLIENTS (from bookings history) ===

// GET /api/master/clients
router.get('/clients', loadMaster, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error loading clients list:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/master/clients/:client_id/bookings
router.get('/clients/:client_id/bookings', loadMaster, async (req, res) => {
  try {
    const clientId = Number(req.params.client_id);
    if (!clientId || Number.isNaN(clientId)) {
      return res.status(400).json({ error: 'client_id must be a valid number' });
    }

    const { rows } = await pool.query(
      `SELECT
         b.id,
         b.client_id,
         b.service_id,
         b.start_at,
         b.end_at,
         b.status,
         b.client_note,
         b.master_note,
         b.created_at,
         b.updated_at,
         s.name AS service_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.master_id = $1 AND b.client_id = $2
       ORDER BY b.start_at DESC`,
      [req.master.id, clientId]
    );

    res.json(rows);
  } catch (error) {
    console.error('Error loading client booking history:', error);
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
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/bookings — create booking manually (admin_created)
router.post('/bookings', loadMaster, async (req, res) => {
  try {
    const { client_id, service_id, start_at, master_note, status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'canceled', 'completed', 'no_show'];

    if (!client_id || !service_id || !start_at) {
      return res.status(400).json({ error: 'client_id, service_id, start_at are required' });
    }
    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
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
       VALUES ($1, $2, $3, $4, $5, $6, 'admin_created', $7)
       RETURNING *`,
      [
        req.master.id,
        client_id,
        service_id,
        startDate.toISOString(),
        endDate.toISOString(),
        status || 'confirmed',
        master_note || null
      ]
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
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/master/bookings/:id — edit booking details
router.put('/bookings/:id', loadMaster, async (req, res) => {
  try {
    const { client_id, service_id, start_at, status, master_note } = req.body;
    const validStatuses = ['pending', 'confirmed', 'canceled', 'completed', 'no_show'];

    if (
      client_id === undefined
      && service_id === undefined
      && start_at === undefined
      && status === undefined
      && master_note === undefined
    ) {
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

    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
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

    if (client_id !== undefined) {
      updates.push(`client_id = $${idx++}`);
      values.push(client_id);
    }
    if (service_id !== undefined) {
      updates.push(`service_id = $${idx++}`);
      values.push(nextServiceId);
    }

    if (start_at !== undefined || service_id !== undefined) {
      const startDate = start_at !== undefined ? new Date(start_at) : new Date(current.start_at);
      if (Number.isNaN(startDate.getTime())) {
        return res.status(400).json({ error: 'start_at must be a valid datetime' });
      }
      const endDate = new Date(startDate.getTime() + nextDuration * 60000);
      updates.push(`start_at = $${idx++}`);
      values.push(startDate.toISOString());
      updates.push(`end_at = $${idx++}`);
      values.push(endDate.toISOString());
    }

    if (status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(status);
    }
    if (master_note !== undefined) {
      updates.push(`master_note = $${idx++}`);
      values.push(master_note);
    }

    updates.push('updated_at = NOW()');
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE bookings
       SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
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
    console.error('Error editing booking:', error);
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

// === REMINDER SETTINGS ===

// GET /api/master/settings
router.get('/settings', loadMaster, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/master/settings
router.put('/settings', loadMaster, async (req, res) => {
  try {
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
       VALUES ($1, COALESCE($2::jsonb, '[24, 2]'::jsonb), $3, $4, $5, $6, $7)
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
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/settings/apple-calendar/enable
router.post('/settings/apple-calendar/enable', loadMaster, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error enabling Apple Calendar feed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/master/settings/apple-calendar/rotate
router.post('/settings/apple-calendar/rotate', loadMaster, async (req, res) => {
  try {
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
  } catch (error) {
    console.error('Error rotating Apple Calendar token:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/master/settings/apple-calendar
router.delete('/settings/apple-calendar', loadMaster, async (req, res) => {
  try {
    const result = await pool.query(
      `INSERT INTO master_settings (master_id, reminder_hours, apple_calendar_enabled)
       VALUES ($1, '[24,2]'::jsonb, false)
       ON CONFLICT (master_id) DO UPDATE SET apple_calendar_enabled = false
       RETURNING master_id, apple_calendar_enabled`,
      [req.master.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error disabling Apple Calendar feed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/master/leads/metrics?period=day|week|month
router.get('/leads/metrics', loadMaster, async (req, res) => {
  try {
    const period = normalizeLeadPeriod(req.query.period);
    const tz = req.master.timezone || process.env.MASTER_TIMEZONE || 'Asia/Novosibirsk';
    const periodSql = LEAD_PERIODS[period];
    const bounds = await loadLeadBounds(tz, periodSql);
    const {
      current_start_local,
      current_end_local,
      previous_start_local,
      previous_end_local
    } = bounds;

    async function loadPeriodProxyMetrics(startLocal, endLocal) {
      const result = await pool.query(
        `SELECT
           COALESCE((
             SELECT COUNT(DISTINCT u.id)::int
             FROM users u
             WHERE u.id <> $5
               AND u.username ~ '^tg_[0-9]+$'
               AND u.created_at >= ($2::timestamp AT TIME ZONE $4)
               AND u.created_at < ($3::timestamp AT TIME ZONE $4)
           ), 0) AS visitors,
           COALESCE((
             SELECT COUNT(DISTINCT b.client_id)::int
             FROM bookings b
             WHERE b.master_id = $1
               AND b.source = 'telegram_link'
               AND b.created_at >= ($2::timestamp AT TIME ZONE $4)
               AND b.created_at < ($3::timestamp AT TIME ZONE $4)
           ), 0) AS booking_started,
           COALESCE((
             SELECT COUNT(DISTINCT b.client_id)::int
             FROM bookings b
             WHERE b.master_id = $1
               AND b.source = 'telegram_link'
               AND b.status <> 'canceled'
               AND b.created_at >= ($2::timestamp AT TIME ZONE $4)
               AND b.created_at < ($3::timestamp AT TIME ZONE $4)
           ), 0) AS booking_created`,
        [req.master.id, startLocal, endLocal, tz, req.master.user_id]
      );

      const row = result.rows[0] || {};
      const visitors = Number(row.visitors || 0);
      return {
        visitors,
        auth_started: visitors,
        auth_success: visitors,
        booking_started: Number(row.booking_started || 0),
        booking_created: Number(row.booking_created || 0)
      };
    }

    const [current, previous] = await Promise.all([
      loadPeriodProxyMetrics(current_start_local, current_end_local),
      loadPeriodProxyMetrics(previous_start_local, previous_end_local)
    ]);

    return res.json({
      period,
      timezone: tz,
      data_source: 'current_entities_proxy',
      current: {
        range_start_local: current_start_local,
        range_end_local: current_end_local,
        metrics: current,
        conversion: buildLeadConversion(current)
      },
      previous: {
        range_start_local: previous_start_local,
        range_end_local: previous_end_local,
        metrics: previous,
        conversion: buildLeadConversion(previous)
      }
    });
  } catch (error) {
    console.error('Error loading lead metrics:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/master/leads/registrations?period=day|week|month
router.get('/leads/registrations', loadMaster, async (req, res) => {
  try {
    const period = normalizeLeadPeriod(req.query.period);
    const tz = req.master.timezone || process.env.MASTER_TIMEZONE || 'Asia/Novosibirsk';
    const periodSql = LEAD_PERIODS[period];
    const bounds = await loadLeadBounds(tz, periodSql);

    const usersRes = await pool.query(
      `SELECT
         u.id AS user_id,
         u.username,
         CASE
           WHEN u.telegram_username ~ '^tg_[0-9]+$' THEN NULL
           ELSE u.telegram_username
         END AS telegram_username,
         u.display_name,
         u.avatar_url,
         CASE
           WHEN u.username ~ '^tg_[0-9]+$' THEN substring(u.username from 4)::bigint
           ELSE NULL
         END AS telegram_user_id,
         u.created_at AS registered_at,
         COUNT(b.id)::int AS bookings_total,
         MIN(b.created_at) AS first_booking_created_at
       FROM users u
       LEFT JOIN bookings b
         ON b.client_id = u.id
        AND b.master_id = $1
       WHERE u.id <> $2
         AND u.username ~ '^tg_[0-9]+$'
         AND u.created_at >= ($3::timestamp AT TIME ZONE $5)
         AND u.created_at < ($4::timestamp AT TIME ZONE $5)
       GROUP BY u.id, u.username, u.telegram_username, u.display_name, u.avatar_url, u.created_at
       ORDER BY u.created_at DESC
       LIMIT 300`,
      [
        req.master.id,
        req.master.user_id,
        bounds.current_start_local,
        bounds.current_end_local,
        tz
      ]
    );

    const users = await enrichLeadUsersWithTelegramProfile(usersRes.rows);

    return res.json({
      period,
      timezone: tz,
      range_start_local: bounds.current_start_local,
      range_end_local: bounds.current_end_local,
      users: users
    });
  } catch (error) {
    console.error('Error loading lead registrations:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

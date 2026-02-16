const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { generateSlots } = require('../lib/slots');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toUtcIcsDate(isoString) {
  const d = new Date(isoString);
  return (
    d.getUTCFullYear()
    + pad2(d.getUTCMonth() + 1)
    + pad2(d.getUTCDate()) + 'T'
    + pad2(d.getUTCHours())
    + pad2(d.getUTCMinutes())
    + pad2(d.getUTCSeconds()) + 'Z'
  );
}

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

async function loadMasterBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT id, user_id, display_name, timezone, booking_slug, cancel_policy_hours
     FROM masters
     WHERE booking_slug = $1`,
    [slug]
  );
  return rows[0] || null;
}

async function loadService(masterId, serviceId) {
  const { rows } = await pool.query(
    `SELECT id, master_id, name, duration_minutes, price, description,
            buffer_before_minutes, buffer_after_minutes, is_active
     FROM services
     WHERE id = $1 AND master_id = $2 AND is_active = true`,
    [serviceId, masterId]
  );
  return rows[0] || null;
}

// GET /api/public/export/booking.ics?title=&details=&start_at=&end_at=&timezone=
router.get('/export/booking.ics', async (req, res) => {
  try {
    const title = String(req.query.title || 'Запись на процедуру');
    const details = String(req.query.details || '');
    const timezone = String(req.query.timezone || 'UTC');
    const startAt = String(req.query.start_at || '');
    const endAt = String(req.query.end_at || '');

    if (!startAt || !endAt) {
      return res.status(400).json({ error: 'start_at and end_at are required' });
    }

    const startDate = new Date(startAt);
    const endDate = new Date(endAt);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'start_at and end_at must be valid ISO datetime' });
    }
    if (endDate <= startDate) {
      return res.status(400).json({ error: 'end_at must be after start_at' });
    }

    const dtStamp = toUtcIcsDate(new Date().toISOString());
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//RoVa Epil//Booking Export//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-TIMEZONE:${escapeIcsText(timezone)}`,
      'BEGIN:VEVENT',
      `UID:export-${Date.now()}@rova-epil.ru`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${toUtcIcsDate(startDate.toISOString())}`,
      `DTEND:${toUtcIcsDate(endDate.toISOString())}`,
      `SUMMARY:${escapeIcsText(title)}`,
      details ? `DESCRIPTION:${escapeIcsText(details)}` : '',
      'END:VEVENT',
      'END:VCALENDAR',
      ''
    ].filter(Boolean).join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="booking.ics"');
    return res.status(200).send(ics);
  } catch (error) {
    console.error('Error generating booking export ics:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/public/master/:slug
router.get('/master/:slug', async (req, res) => {
  try {
    const master = await loadMasterBySlug(req.params.slug);
    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const services = await pool.query(
      `SELECT id, master_id, name, duration_minutes, price, description,
              buffer_before_minutes, buffer_after_minutes, is_active
       FROM services
       WHERE master_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [master.id]
    );

    return res.json({
      master: {
        id: master.id,
        display_name: master.display_name,
        timezone: master.timezone,
        booking_slug: master.booking_slug,
        cancel_policy_hours: master.cancel_policy_hours
      },
      services: services.rows
    });
  } catch (error) {
    console.error('Error loading public master profile:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/public/master/:slug/slots?service_id=&date_from=&date_to=
router.get('/master/:slug/slots', async (req, res) => {
  try {
    const { service_id, date_from, date_to } = req.query;
    if (!service_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'service_id, date_from, date_to are required' });
    }

    const master = await loadMasterBySlug(req.params.slug);
    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const service = await loadService(master.id, service_id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const [rules, exclusions, bookings, blocks] = await Promise.all([
      pool.query('SELECT * FROM availability_rules WHERE master_id = $1', [master.id]),
      pool.query('SELECT date FROM availability_exclusions WHERE master_id = $1', [master.id]),
      pool.query(
        `SELECT start_at, end_at FROM bookings
         WHERE master_id = $1 AND status NOT IN ('canceled')
           AND start_at < $3 AND end_at > $2`,
        [master.id, date_from, date_to]
      ),
      pool.query(
        `SELECT start_at, end_at FROM master_blocks
         WHERE master_id = $1 AND start_at < $3 AND end_at > $2`,
        [master.id, date_from, date_to]
      )
    ]);

    const slots = generateSlots({
      service,
      rules: rules.rows,
      exclusions: exclusions.rows.map((item) => item.date),
      bookings: bookings.rows,
      blocks: blocks.rows,
      dateFrom: date_from,
      dateTo: date_to,
      timezone: master.timezone
    });

    return res.json({ slots });
  } catch (error) {
    console.error('Error loading public slots:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/public/master/:slug/calendar.ics?token=...
router.get('/master/:slug/calendar.ics', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!token) {
      return res.status(400).json({ error: 'token query param is required' });
    }

    const master = await loadMasterBySlug(req.params.slug);
    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const settingsRes = await pool.query(
      'SELECT apple_calendar_enabled, apple_calendar_token FROM master_settings WHERE master_id = $1',
      [master.id]
    );
    if (settingsRes.rows.length === 0) {
      return res.status(403).json({ error: 'Apple Calendar feed is not enabled' });
    }
    const settings = settingsRes.rows[0];
    if (!settings.apple_calendar_enabled || settings.apple_calendar_token !== token) {
      return res.status(403).json({ error: 'Invalid Apple Calendar token' });
    }

    const bookingsRes = await pool.query(
      `SELECT b.id, b.start_at, b.end_at, b.client_note, b.master_note, b.status,
              s.name AS service_name, u.username AS client_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN users u ON u.id = b.client_id
       WHERE b.master_id = $1
         AND b.status NOT IN ('canceled')
         AND b.start_at >= NOW() - interval '30 days'
       ORDER BY b.start_at ASC`,
      [master.id]
    );

    const dtStamp = toUtcIcsDate(new Date().toISOString());
    const events = bookingsRes.rows.map((b) => {
      const description = [
        `Клиент: ${b.client_name || 'не указан'}`,
        b.client_note ? `Комментарий клиента: ${b.client_note}` : '',
        b.master_note ? `Комментарий мастера: ${b.master_note}` : ''
      ].filter(Boolean).join('\n');

      return [
        'BEGIN:VEVENT',
        `UID:booking-${b.id}@rova-epil.ru`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${toUtcIcsDate(b.start_at)}`,
        `DTEND:${toUtcIcsDate(b.end_at)}`,
        `SUMMARY:${escapeIcsText('Запись: ' + (b.service_name || 'Услуга'))}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        'END:VEVENT'
      ].join('\r\n');
    });

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//RoVa Epil//Master Feed//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcsText(master.display_name + ' — Записи')}`,
      `X-WR-TIMEZONE:${escapeIcsText(master.timezone || 'UTC')}`,
      ...events,
      'END:VCALENDAR',
      ''
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="bookings.ics"');
    return res.status(200).send(ics);
  } catch (error) {
    console.error('Error generating Apple calendar feed:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/public/master/:slug/book
router.post('/master/:slug/book', authenticateToken, async (req, res) => {
  try {
    const { service_id, start_at, client_note } = req.body;
    if (!service_id || !start_at) {
      return res.status(400).json({ error: 'service_id and start_at are required' });
    }

    const master = await loadMasterBySlug(req.params.slug);
    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const service = await loadService(master.id, service_id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const startDate = new Date(start_at);
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'start_at must be valid ISO datetime' });
    }
    const endDate = new Date(startDate.getTime() + service.duration_minutes * 60000);

    const result = await pool.query(
      `INSERT INTO bookings (master_id, client_id, service_id, start_at, end_at, status, source, client_note)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', 'telegram_link', $6)
       RETURNING *`,
      [master.id, req.user.id, service.id, startDate.toISOString(), endDate.toISOString(), client_note || null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23P01') {
      return res.status(409).json({ error: 'Time slot is already taken' });
    }
    console.error('Error creating public booking:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

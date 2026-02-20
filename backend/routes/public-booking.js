const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { generateSlotsFromWindows, localDateTimeToUtcMs } = require('../lib/slots');
const { createReminders } = require('../lib/reminders');
const { notifyMasterBookingEvent } = require('../lib/telegram-notify');

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

function dateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function timeInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
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

async function loadMasterSettings(masterId) {
  const { rows } = await pool.query(
    `SELECT reminder_hours, first_visit_discount_percent, min_booking_notice_minutes
     FROM master_settings
     WHERE master_id = $1`,
    [masterId]
  );
  if (!rows.length) {
    return {
      reminder_hours: [24, 2],
      first_visit_discount_percent: 15,
      min_booking_notice_minutes: 60
    };
  }
  return rows[0];
}

function resolveMasterTimezone(master) {
  if (master && master.timezone) return master.timezone;
  return process.env.MASTER_TIMEZONE || 'Asia/Novosibirsk';
}

// GET /api/public/export/booking.ics?title=&details=&location=&calendar_name=&start_at=&end_at=&timezone=
router.get('/export/booking.ics', async (req, res) => {
  try {
    const title = String(req.query.title || 'Запись на процедуру');
    const details = String(req.query.details || '');
    const location = String(req.query.location || 'Мкр Околица д.1, квартира 60');
    const calendarName = String(req.query.calendar_name || 'RoVa Epil');
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
      `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
      `X-WR-TIMEZONE:${escapeIcsText(timezone)}`,
      'BEGIN:VEVENT',
      `UID:export-${Date.now()}@rova-epil.ru`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${toUtcIcsDate(startDate.toISOString())}`,
      `DTEND:${toUtcIcsDate(endDate.toISOString())}`,
      `SUMMARY:${escapeIcsText(title)}`,
      details ? `DESCRIPTION:${escapeIcsText(details)}` : '',
      location ? `LOCATION:${escapeIcsText(location)}` : '',
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

    const timezone = resolveMasterTimezone(master);
    return res.json({
      master: {
        id: master.id,
        display_name: master.display_name,
        timezone: timezone,
        booking_slug: master.booking_slug,
        cancel_policy_hours: master.cancel_policy_hours
      },
      services: services.rows,
      settings: await loadMasterSettings(master.id)
    });
  } catch (error) {
    console.error('Error loading public master profile:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/public/master/:slug/slots?service_id=&date_from=&date_to=&duration_minutes=
// duration_minutes is optional override for multi-service total duration
router.get('/master/:slug/slots', async (req, res) => {
  try {
    const { service_id, date_from, date_to, duration_minutes } = req.query;
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

    // Allow overriding duration for multi-service bookings (sum of selected zones)
    const overrideDuration = parseInt(duration_minutes, 10);
    const effectiveService = (overrideDuration > 0 && overrideDuration !== service.duration_minutes)
      ? { ...service, duration_minutes: overrideDuration }
      : service;

    const timezone = resolveMasterTimezone(master);
    const settings = await loadMasterSettings(master.id);
    const queryStartUtc = new Date(localDateTimeToUtcMs(date_from, '00:00:00', timezone)).toISOString();
    const queryEndUtc = new Date(localDateTimeToUtcMs(date_to, '23:59:59', timezone)).toISOString();

    const [windows, bookings, blocks] = await Promise.all([
      pool.query(
        `SELECT id, date, start_time, end_time
         FROM availability_windows
         WHERE master_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date, start_time`,
        [master.id, date_from, date_to]
      ),
      pool.query(
        `SELECT start_at, end_at FROM bookings
         WHERE master_id = $1 AND status NOT IN ('canceled')
           AND start_at < $3 AND end_at > $2`,
        [master.id, queryStartUtc, queryEndUtc]
      ),
      pool.query(
        `SELECT start_at, end_at FROM master_blocks
         WHERE master_id = $1 AND start_at < $3 AND end_at > $2`,
        [master.id, queryStartUtc, queryEndUtc]
      )
    ]);

    const slots = generateSlotsFromWindows({
      service: effectiveService,
      windows: windows.rows,
      bookings: bookings.rows,
      blocks: blocks.rows,
      timezone,
      stepMinutes: 10,
      minLeadMinutes: settings.min_booking_notice_minutes || 60
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
        `LOCATION:${escapeIcsText('Мкр Околица д.1, квартира 60')}`,
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

// GET /api/public/master/:slug/client-calendar.ics?token=...
// Personal client feed: one token -> one (master_id, client_id) pair
router.get('/master/:slug/client-calendar.ics', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!token) {
      return res.status(400).json({ error: 'token query param is required' });
    }

    const master = await loadMasterBySlug(req.params.slug);
    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const feedRes = await pool.query(
      `SELECT client_id
       FROM client_calendar_feeds
       WHERE master_id = $1 AND token = $2 AND enabled = true
       LIMIT 1`,
      [master.id, token]
    );
    if (!feedRes.rows.length) {
      return res.status(403).json({ error: 'Invalid client calendar token' });
    }
    const clientId = feedRes.rows[0].client_id;

    const bookingsRes = await pool.query(
      `SELECT b.id, b.start_at, b.end_at, b.client_note, b.status,
              s.name AS service_name
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.master_id = $1
         AND b.client_id = $2
         AND b.status NOT IN ('canceled')
         AND b.start_at >= NOW() - interval '30 days'
       ORDER BY b.start_at ASC`,
      [master.id, clientId]
    );

    const dtStamp = toUtcIcsDate(new Date().toISOString());
    const events = bookingsRes.rows.map((b) => {
      const description = [
        `Услуга: ${b.service_name || 'Услуга'}`,
        b.client_note ? `Комментарий: ${b.client_note}` : '',
        'Адрес: Мкр Околица д.1, квартира 60'
      ].filter(Boolean).join('\n');

      return [
        'BEGIN:VEVENT',
        `UID:client-booking-${b.id}@rova-epil.ru`,
        `DTSTAMP:${dtStamp}`,
        `DTSTART:${toUtcIcsDate(b.start_at)}`,
        `DTEND:${toUtcIcsDate(b.end_at)}`,
        `SUMMARY:${escapeIcsText('Запись: ' + (b.service_name || 'Услуга'))}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        `LOCATION:${escapeIcsText('Мкр Околица д.1, квартира 60')}`,
        'END:VEVENT'
      ].join('\r\n');
    });

    const displayName = master.display_name || 'Лера';
    const timezone = resolveMasterTimezone(master);
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//RoVa Epil//Client Feed//RU',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcsText(displayName + ' — Мои записи')}`,
      `X-WR-TIMEZONE:${escapeIcsText(timezone)}`,
      ...events,
      'END:VCALENDAR',
      ''
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="my-bookings.ics"');
    return res.status(200).send(ics);
  } catch (error) {
    console.error('Error generating client Apple calendar feed:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/public/master/:slug/book
// Accepts either { service_id, start_at } (legacy single) or { service_ids: [...], start_at } (multi-service).
// Complexes must be booked alone (service_ids.length === 1 if any complex is selected).
router.post('/master/:slug/book', authenticateToken, async (req, res) => {
  try {
    const { start_at, client_note } = req.body;

    // Normalize to array of IDs
    let rawIds = req.body.service_ids;
    if (!rawIds) {
      rawIds = req.body.service_id ? [req.body.service_id] : [];
    }
    const serviceIds = (Array.isArray(rawIds) ? rawIds : [rawIds])
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (!serviceIds.length || !start_at) {
      return res.status(400).json({ error: 'service_ids (or service_id) and start_at are required' });
    }

    const master = await loadMasterBySlug(req.params.slug);
    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    // Load and validate all requested services
    const loadedServices = await Promise.all(
      serviceIds.map((id) => loadService(master.id, id))
    );
    const missingIdx = loadedServices.findIndex((s) => !s);
    if (missingIdx !== -1) {
      return res.status(404).json({ error: `Service ${serviceIds[missingIdx]} not found or inactive` });
    }

    const settings = await loadMasterSettings(master.id);
    const timezone = resolveMasterTimezone(master);

    const startDate = new Date(start_at);
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'start_at must be valid ISO datetime' });
    }
    const minute = startDate.getUTCMinutes();
    if (minute % 10 !== 0) {
      return res.status(400).json({ error: 'Start time must be aligned to 10 minutes' });
    }
    const minNoticeMinutes = Number(settings.min_booking_notice_minutes || 60);
    if (startDate.getTime() < Date.now() + minNoticeMinutes * 60000) {
      return res.status(400).json({ error: `Booking is allowed at least ${minNoticeMinutes} minutes in advance` });
    }

    // Calculate totals across all services
    const totalDurationMinutes = loadedServices.reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
    const totalBasePrice = loadedServices.reduce((sum, s) => sum + Number(s.price || 0), 0);

    const localDate = dateInTimezone(startDate, timezone);
    const windowCoverage = await pool.query(
      `SELECT id
       FROM availability_windows
       WHERE master_id = $1
         AND date = $2
         AND start_time <= $3::time
         AND end_time >= $4::time
       LIMIT 1`,
      [
        master.id,
        localDate,
        timeInTimezone(startDate, timezone),
        timeInTimezone(new Date(startDate.getTime() + totalDurationMinutes * 60000), timezone)
      ]
    );
    if (!windowCoverage.rows.length) {
      return res.status(409).json({ error: 'Selected time is outside available windows' });
    }

    const activeBookingsCountRes = await pool.query(
      `SELECT COUNT(*)::int AS active_count
       FROM bookings
       WHERE master_id = $1
         AND client_id = $2
         AND status IN ('pending', 'confirmed')
         AND start_at >= NOW()`,
      [master.id, req.user.id]
    );
    const activeBookingsCount = Number(activeBookingsCountRes.rows[0]?.active_count || 0);
    if (activeBookingsCount >= 3) {
      return res.status(429).json({
        error: 'У вас уже есть 3 активные записи. Чтобы записаться дополнительно, свяжитесь с мастером в Telegram: @RoVVVVa'
      });
    }

    const firstBookingCheck = await pool.query(
      `SELECT id FROM bookings WHERE master_id = $1 AND client_id = $2 LIMIT 1`,
      [master.id, req.user.id]
    );
    const isFirstVisit = firstBookingCheck.rows.length === 0;
    const discountPercent = isFirstVisit ? Number(settings.first_visit_discount_percent || 0) : 0;
    const discountAmount = Math.round(totalBasePrice * discountPercent) / 100;
    const finalPrice = Math.max(0, totalBasePrice - discountAmount);

    const primaryServiceId = serviceIds[0];
    const extraServiceIds = serviceIds.slice(1);
    const endDate = new Date(startDate.getTime() + totalDurationMinutes * 60000);

    const result = await pool.query(
      `INSERT INTO bookings
         (master_id, client_id, service_id, extra_service_ids, start_at, end_at, status, source, client_note)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'telegram_link', $7)
       RETURNING *`,
      [
        master.id,
        req.user.id,
        primaryServiceId,
        JSON.stringify(extraServiceIds),
        startDate.toISOString(),
        endDate.toISOString(),
        client_note || null
      ]
    );
    const created = result.rows[0];

    try {
      await createReminders(created.id, created.master_id, created.start_at);
      await notifyMasterBookingEvent(created.id, 'created');
    } catch (notifyError) {
      console.error('Error handling public booking side-effects:', notifyError);
    }

    return res.status(201).json({
      ...created,
      pricing: {
        base_price: totalBasePrice,
        first_visit_discount_percent: discountPercent,
        final_price: finalPrice
      }
    });
  } catch (error) {
    if (error.code === '23P01') {
      return res.status(409).json({ error: 'Time slot is already taken' });
    }
    console.error('Error creating public booking:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

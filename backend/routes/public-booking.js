const express = require('express');
const router = express.Router();
const { URL: NodeURL } = require('url');
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { generateSlotsFromWindows, localDateTimeToUtcMs } = require('../lib/slots');
const { createReminders } = require('../lib/reminders');
const { notifyMasterBookingEvent, notifyClientBookingEvent } = require('../lib/telegram-notify');

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

const DEFAULT_PUBLIC_PROFILE = Object.freeze({
  brand: 'Ro Va',
  subtitle: 'Epil & Care',
  name: 'Лера',
  role: 'Мастер эпиляции',
  city: 'Новосибирск',
  experience: '',
  phone: '',
  address: '',
  bio: '',
  gift_text: 'Подарок от меня на первое посещение по ссылке:',
  gift_url: 'https://vk.cc/cVmuLI'
});

function normalizeOptionalText(value, maxLength) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (maxLength && trimmed.length > maxLength) return trimmed.slice(0, maxLength);
  return trimmed;
}

function normalizeGiftUrl(value) {
  const normalized = normalizeOptionalText(value, 255);
  if (!normalized) return null;
  const withProtocol = /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
  try {
    const parsed = new NodeURL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildPublicProfile(row) {
  const fallbackName = normalizeOptionalText(row && row.display_name, 120);
  return {
    brand: normalizeOptionalText(row && row.brand_name, 120) || DEFAULT_PUBLIC_PROFILE.brand,
    subtitle: normalizeOptionalText(row && row.brand_subtitle, 120) || DEFAULT_PUBLIC_PROFILE.subtitle,
    name: normalizeOptionalText(row && row.profile_name, 120) || fallbackName || DEFAULT_PUBLIC_PROFILE.name,
    role: normalizeOptionalText(row && row.profile_role, 120) || DEFAULT_PUBLIC_PROFILE.role,
    city: normalizeOptionalText(row && row.profile_city, 120) || DEFAULT_PUBLIC_PROFILE.city,
    experience: normalizeOptionalText(row && row.profile_experience, 120) || DEFAULT_PUBLIC_PROFILE.experience,
    phone: normalizeOptionalText(row && row.profile_phone, 120) || DEFAULT_PUBLIC_PROFILE.phone,
    address: normalizeOptionalText(row && row.profile_address, 255) || DEFAULT_PUBLIC_PROFILE.address,
    bio: normalizeOptionalText(row && row.profile_bio, 1200) || DEFAULT_PUBLIC_PROFILE.bio,
    gift_text: normalizeOptionalText(row && row.gift_text, 255) || DEFAULT_PUBLIC_PROFILE.gift_text,
    gift_url: normalizeGiftUrl(row && row.gift_url) || DEFAULT_PUBLIC_PROFILE.gift_url
  };
}

async function loadMasterBySlug(slug) {
  const attempts = [
    `SELECT * FROM masters WHERE booking_slug = $1`,
    `SELECT id, user_id, display_name, timezone, booking_slug, cancel_policy_hours
     FROM masters WHERE booking_slug = $1`,
    `SELECT id, user_id, display_name, timezone, booking_slug
     FROM masters WHERE booking_slug = $1`,
    `SELECT id, user_id, booking_slug
     FROM masters WHERE booking_slug = $1`,
    `SELECT id, booking_slug
     FROM masters WHERE booking_slug = $1`
  ];

  for (const sql of attempts) {
    try {
      const { rows } = await pool.query(sql, [slug]);
      if (!rows.length) return null;
      const row = rows[0];
      return {
        id: Number(row.id),
        user_id: row.user_id !== undefined ? Number(row.user_id) : null,
        display_name: String(row.display_name || process.env.MASTER_DISPLAY_NAME || 'Мастер'),
        timezone: String(row.timezone || process.env.MASTER_TIMEZONE || 'Asia/Novosibirsk'),
        booking_slug: String(row.booking_slug || slug),
        cancel_policy_hours: Number(row.cancel_policy_hours ?? 24),
        profile: buildPublicProfile(row)
      };
    } catch (error) {
      if (error.code === '42P01') return null;
      if (error.code === '42703') continue;
      throw error;
    }
  }

  return null;
}

async function loadService(masterId, serviceId) {
  try {
    const { rows } = await pool.query(
      `SELECT id, master_id, name, duration_minutes, price, description,
              buffer_before_minutes, buffer_after_minutes, is_active
       FROM services
       WHERE id = $1 AND master_id = $2 AND is_active = true`,
      [serviceId, masterId]
    );
    return rows[0] || null;
  } catch (error) {
    // Legacy schema compatibility: missing/typed-differently is_active and buffer columns.
    if (!isLegacySchemaCompatibilityError(error)) throw error;
    const fallback = await pool.query(
      `SELECT id, master_id, name, duration_minutes, price
       FROM services
       WHERE id = $1 AND master_id = $2`,
      [serviceId, masterId]
    );
    if (!fallback.rows.length) return null;
    return {
      ...fallback.rows[0],
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      is_active: true
    };
  }
}

function normalizeServiceRow(service) {
  return {
    ...service,
    buffer_before_minutes: Number(service && service.buffer_before_minutes ? service.buffer_before_minutes : 0),
    buffer_after_minutes: Number(service && service.buffer_after_minutes ? service.buffer_after_minutes : 0),
    is_active: service && service.is_active !== undefined ? Boolean(service.is_active) : true
  };
}

async function loadPublicServices(masterId) {
  try {
    const services = await pool.query(
      `SELECT id, master_id, name, duration_minutes, price, description,
              buffer_before_minutes, buffer_after_minutes, is_active
       FROM services
       WHERE master_id = $1 AND is_active = true
       ORDER BY created_at ASC`,
      [masterId]
    );
    return services.rows.map(normalizeServiceRow);
  } catch (error) {
    if (error.code === '42P01') return [];
    if (!isLegacySchemaCompatibilityError(error)) throw error;

    // Legacy schema fallback for services table without newer columns.
    try {
      const fallback = await pool.query(
        `SELECT id, master_id, name, duration_minutes, price
         FROM services
         WHERE master_id = $1
         ORDER BY id ASC`,
        [masterId]
      );
      return fallback.rows.map(normalizeServiceRow);
    } catch (fallbackError) {
      if (isLegacySchemaCompatibilityError(fallbackError)) return [];
      throw fallbackError;
    }
  }
}

async function loadMasterSettings(masterId) {
  const defaults = {
    reminder_hours: [24, 2],
    min_booking_notice_minutes: 60
  };

  try {
    const { rows } = await pool.query(
      `SELECT reminder_hours, min_booking_notice_minutes
       FROM master_settings
       WHERE master_id = $1`,
      [masterId]
    );
    if (!rows.length) return defaults;
    return {
      reminder_hours: rows[0].reminder_hours || defaults.reminder_hours,
      min_booking_notice_minutes: Number(rows[0].min_booking_notice_minutes ?? defaults.min_booking_notice_minutes)
    };
  } catch (error) {
    // Compatibility for partially migrated DB: fallback to minimal settings.
    if (!isLegacySchemaCompatibilityError(error)) throw error;
    try {
      const { rows } = await pool.query(
        `SELECT reminder_hours
         FROM master_settings
         WHERE master_id = $1`,
        [masterId]
      );
      if (!rows.length) return defaults;
      return {
        reminder_hours: rows[0].reminder_hours || defaults.reminder_hours,
        min_booking_notice_minutes: defaults.min_booking_notice_minutes
      };
    } catch {
      return defaults;
    }
  }
}

function normalizePromoCode(rawPromoCode) {
  return String(rawPromoCode || '').trim().toUpperCase();
}

function isLegacySchemaCompatibilityError(error) {
  return Boolean(error && ['42P01', '42703', '42883'].includes(error.code));
}

async function loadActivePromoCode(masterId, normalizedCode) {
  if (!normalizedCode) return null;

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.master_id, p.code, p.reward_type, p.discount_percent, p.gift_service_id, p.is_active,
              p.usage_mode, p.uses_count,
              gs.id AS gift_id, gs.master_id AS gift_master_id, gs.name AS gift_name,
              gs.duration_minutes AS gift_duration_minutes, gs.price AS gift_price,
              gs.description AS gift_description, gs.buffer_before_minutes AS gift_buffer_before_minutes,
              gs.buffer_after_minutes AS gift_buffer_after_minutes, gs.is_active AS gift_is_active
       FROM master_promo_codes p
       LEFT JOIN services gs ON gs.id = p.gift_service_id
       WHERE p.master_id = $1
         AND p.code = $2
         AND p.is_active = true
         AND (COALESCE(p.usage_mode, 'always') <> 'single_use' OR COALESCE(p.uses_count, 0) < 1)
       LIMIT 1`,
      [masterId, normalizedCode]
    );
    return rows[0] || null;
  } catch (error) {
    // Compatibility mode: promo schema can be absent on partially migrated DB.
    if (error.code === '42P01') return null;
    if (error.code === '42703') {
      try {
        const fallback = await pool.query(
          `SELECT p.id, p.master_id, p.code, p.reward_type, p.discount_percent, p.gift_service_id, p.is_active
           FROM master_promo_codes p
           WHERE p.master_id = $1
             AND p.code = $2
             AND p.is_active = true
           LIMIT 1`,
          [masterId, normalizedCode]
        );
        const row = fallback.rows[0];
        if (!row) return null;

        const normalized = {
          ...row,
          usage_mode: 'always',
          uses_count: 0,
          gift_id: null,
          gift_master_id: null,
          gift_name: null,
          gift_duration_minutes: 0,
          gift_price: 0,
          gift_description: null,
          gift_buffer_before_minutes: 0,
          gift_buffer_after_minutes: 0,
          gift_is_active: false
        };

        const giftId = Number(row.gift_service_id || 0);
        if (giftId > 0) {
          normalized.gift_id = giftId;
          try {
            const giftService = await loadService(masterId, giftId);
            if (giftService) {
              normalized.gift_master_id = Number(giftService.master_id || masterId);
              normalized.gift_name = giftService.name || null;
              normalized.gift_duration_minutes = Number(giftService.duration_minutes || 0);
              normalized.gift_price = Number(giftService.price || 0);
              normalized.gift_description = giftService.description || null;
              normalized.gift_buffer_before_minutes = Number(giftService.buffer_before_minutes || 0);
              normalized.gift_buffer_after_minutes = Number(giftService.buffer_after_minutes || 0);
              normalized.gift_is_active = Boolean(giftService.is_active);
            }
          } catch (giftLoadError) {
            // Keep promo code usable even if gift service cannot be fetched on legacy schema.
            void giftLoadError;
          }
        }

        return normalized;
      } catch (fallbackError) {
        if (fallbackError.code === '42P01') return null;
        throw fallbackError;
      }
    }
    throw error;
  }
}

function isComplexServiceRow(service) {
  const name = String(service && service.name ? service.name : '');
  const description = String(service && service.description ? service.description : '');
  return /комплекс/i.test(name) || /комплекс/i.test(description);
}

function selectCheapestService(services) {
  if (!Array.isArray(services) || !services.length) return null;
  return services.reduce((best, service) => {
    if (!best) return service;
    const price = Number(service && service.price ? service.price : 0);
    const bestPrice = Number(best && best.price ? best.price : 0);
    if (price !== bestPrice) return price < bestPrice ? service : best;
    return Number(service && service.id ? service.id : 0) < Number(best && best.id ? best.id : 0)
      ? service
      : best;
  }, null);
}

function resolvePromoGiftService(appliedPromo, selectedServices) {
  const services = Array.isArray(selectedServices) ? selectedServices.filter(Boolean) : [];
  const configuredGiftServiceId = Number(
    (appliedPromo && (appliedPromo.gift_id || appliedPromo.gift_service_id)) || 0
  );

  if (configuredGiftServiceId > 0) {
    const configuredService = services.find((service) => Number(service.id) === configuredGiftServiceId);
    if (!configuredService) {
      return {
        giftService: null,
        error: 'Для этого промокода выберите подарочную зону, указанную мастером'
      };
    }
    if (isComplexServiceRow(configuredService)) {
      return {
        giftService: null,
        error: 'Подарочная зона промокода должна быть зоной эпиляции'
      };
    }
    return { giftService: configuredService, error: null };
  }

  const zoneServices = services.filter((service) => !isComplexServiceRow(service));
  if (!zoneServices.length) {
    return {
      giftService: null,
      error: 'Промокод «Зона в подарок» действует только на зоны эпиляции'
    };
  }
  return {
    giftService: selectCheapestService(zoneServices),
    error: null
  };
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

    const services = await loadPublicServices(master.id);

    const timezone = resolveMasterTimezone(master);
    return res.json({
      master: {
        id: master.id,
        display_name: master.display_name,
        timezone: timezone,
        booking_slug: master.booking_slug,
        cancel_policy_hours: master.cancel_policy_hours,
        profile: master.profile || DEFAULT_PUBLIC_PROFILE
      },
      services: services,
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

    let windows = { rows: [] };
    try {
      windows = await pool.query(
        `SELECT id, date, start_time, end_time
         FROM availability_windows
         WHERE master_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date, start_time`,
        [master.id, date_from, date_to]
      );
    } catch (windowError) {
      if (windowError.code !== '42P01') throw windowError;
    }

    let bookings;
    try {
      bookings = await pool.query(
        `SELECT start_at, end_at FROM bookings
         WHERE master_id = $1 AND status NOT IN ('canceled')
           AND start_at < $3 AND end_at > $2`,
        [master.id, queryStartUtc, queryEndUtc]
      );
    } catch (bookingError) {
      if (bookingError.code !== '42703') throw bookingError;
      bookings = await pool.query(
        `SELECT b.start_at,
                (b.start_at + ((COALESCE(s.duration_minutes, 0))::text || ' minutes')::interval) AS end_at
         FROM bookings b
         JOIN services s ON s.id = b.service_id
         WHERE b.master_id = $1
           AND b.status NOT IN ('canceled')
           AND b.start_at >= $2
           AND b.start_at <= $3`,
        [master.id, queryStartUtc, queryEndUtc]
      );
    }

    let blocks = { rows: [] };
    try {
      blocks = await pool.query(
        `SELECT start_at, end_at FROM master_blocks
         WHERE master_id = $1 AND start_at < $3 AND end_at > $2`,
        [master.id, queryStartUtc, queryEndUtc]
      );
    } catch (blockError) {
      if (blockError.code !== '42P01') throw blockError;
    }

    const rawSlots = generateSlotsFromWindows({
      service: effectiveService,
      windows: windows.rows,
      bookings: bookings.rows,
      blocks: blocks.rows,
      timezone,
      stepMinutes: 10,
      minLeadMinutes: settings.min_booking_notice_minutes ?? 60
    });

    // Load hot windows for this date range
    let hotWindows = [];
    try {
      const hwRes = await pool.query(
        `SELECT hw.id, hw.date, hw.start_time, hw.end_time,
                hw.reward_type, hw.discount_percent,
                hw.gift_service_id, s.name AS gift_service_name
         FROM hot_windows hw
         LEFT JOIN services s ON s.id = hw.gift_service_id
         WHERE hw.master_id = $1
           AND hw.date >= $2 AND hw.date <= $3
           AND hw.is_active = true`,
        [master.id, date_from, date_to]
      );
      hotWindows = hwRes.rows;
    } catch (hwError) {
      if (hwError.code !== '42P01') throw hwError;
    }

    const effectiveDurationMs = Number(effectiveService.duration_minutes || 0) * 60000;

    // Annotate each slot that overlaps >= 50% with a hot window
    const slots = rawSlots.map((slot) => {
      if (!hotWindows.length) return slot;
      const slotStartMs = new Date(slot.start).getTime();
      const slotEndMs = slotStartMs + effectiveDurationMs;
      for (const hw of hotWindows) {
        const dateStr = hw.date instanceof Date ? hw.date.toISOString().slice(0, 10) : String(hw.date).slice(0, 10);
        const hwStartMs = localDateTimeToUtcMs(dateStr, hw.start_time, timezone);
        const hwEndMs = localDateTimeToUtcMs(dateStr, hw.end_time, timezone);
        const overlap = Math.max(0, Math.min(slotEndMs, hwEndMs) - Math.max(slotStartMs, hwStartMs));
        if (effectiveDurationMs > 0 && overlap / effectiveDurationMs >= 0.5) {
          return {
            ...slot,
            hot_window: {
              id: hw.id,
              reward_type: hw.reward_type,
              discount_percent: hw.discount_percent,
              gift_service_id: hw.gift_service_id,
              gift_service_name: hw.gift_service_name
            }
          };
        }
      }
      return slot;
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
router.post('/master/:slug/pricing-preview', async (req, res) => {
  try {
    let rawIds = req.body && req.body.service_ids;
    if (!rawIds) {
      rawIds = req.body && req.body.service_id ? [req.body.service_id] : [];
    }
    const serviceIds = (Array.isArray(rawIds) ? rawIds : [rawIds])
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);
    const normalizedServiceIds = [...new Set(serviceIds)];

    if (!normalizedServiceIds.length) {
      return res.status(400).json({ error: 'service_ids (or service_id) is required' });
    }

    const master = await loadMasterBySlug(req.params.slug);
    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    const loadedServices = await Promise.all(
      normalizedServiceIds.map((id) => loadService(master.id, id))
    );
    const missingIdx = loadedServices.findIndex((service) => !service);
    if (missingIdx !== -1) {
      return res.status(404).json({ error: `Service ${normalizedServiceIds[missingIdx]} not found or inactive` });
    }

    const servicesById = new Map(loadedServices.map((service) => [Number(service.id), service]));
    const promoCodeInput = normalizePromoCode(req.body && req.body.promo_code);
    let appliedPromo = null;
    let promoGiftService = null;
    let promoDiscountPercent = null;

    if (promoCodeInput) {
      appliedPromo = await loadActivePromoCode(master.id, promoCodeInput);
      if (!appliedPromo) {
        return res.status(400).json({ error: 'Промокод не найден или неактивен' });
      }

      if (appliedPromo.reward_type === 'percent') {
        promoDiscountPercent = Number(appliedPromo.discount_percent || 0);
      } else if (appliedPromo.reward_type === 'gift_service') {
        const giftResolution = resolvePromoGiftService(appliedPromo, loadedServices);
        if (giftResolution.error) {
          return res.status(400).json({ error: giftResolution.error });
        }
        promoGiftService = giftResolution.giftService;
      } else {
        return res.status(400).json({ error: 'Неподдерживаемый тип промокода' });
      }
    }

    const effectiveServices = normalizedServiceIds.map((id) => servicesById.get(id)).filter(Boolean);
    if (effectiveServices.length !== normalizedServiceIds.length) {
      return res.status(400).json({ error: 'Не удалось собрать услуги для расчёта' });
    }

    const totalDurationMinutes = effectiveServices.reduce((sum, service) => sum + Number(service.duration_minutes || 0), 0);
    const totalBasePrice = effectiveServices.reduce((sum, service) => sum + Number(service.price || 0), 0);
    let discountAmount = 0;
    if (promoDiscountPercent !== null) {
      discountAmount = Math.round(totalBasePrice * promoDiscountPercent) / 100;
    } else if (promoGiftService) {
      discountAmount = Number(promoGiftService.price || 0);
    }
    discountAmount = Math.min(totalBasePrice, Math.max(0, discountAmount));
    const finalPrice = Math.max(0, Math.round((totalBasePrice - discountAmount) * 100) / 100);

    return res.json({
      service_ids: normalizedServiceIds,
      total_duration_minutes: totalDurationMinutes,
      pricing: {
        base_price: totalBasePrice,
        final_price: finalPrice,
        discount_amount: discountAmount,
        promo_code: appliedPromo ? String(appliedPromo.code) : null,
        promo_reward_type: appliedPromo ? String(appliedPromo.reward_type) : null,
        promo_usage_mode: appliedPromo ? String(appliedPromo.usage_mode || 'always') : null,
        promo_discount_percent: promoDiscountPercent,
        promo_gift_service_name: promoGiftService ? promoGiftService.name : null,
        promo_gift_service_added: false
      }
    });
  } catch (error) {
    console.error('Error calculating public pricing preview:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/master/:slug/book', authenticateToken, async (req, res) => {
  try {
    const { start_at } = req.body;
    const client_note = req.body.client_note ? String(req.body.client_note).slice(0, 500) : null;

    // Normalize to array of IDs
    let rawIds = req.body.service_ids;
    if (!rawIds) {
      rawIds = req.body.service_id ? [req.body.service_id] : [];
    }
    const serviceIds = (Array.isArray(rawIds) ? rawIds : [rawIds])
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);
    const normalizedServiceIds = [...new Set(serviceIds)];

    if (!normalizedServiceIds.length || !start_at) {
      return res.status(400).json({ error: 'service_ids (or service_id) and start_at are required' });
    }

    const master = await loadMasterBySlug(req.params.slug);
    if (!master) {
      return res.status(404).json({ error: 'Master not found' });
    }

    // Load and validate all requested services
    const loadedServices = await Promise.all(
      normalizedServiceIds.map((id) => loadService(master.id, id))
    );
    const missingIdx = loadedServices.findIndex((s) => !s);
    if (missingIdx !== -1) {
      return res.status(404).json({ error: `Service ${normalizedServiceIds[missingIdx]} not found or inactive` });
    }
    const servicesById = new Map(loadedServices.map((service) => [Number(service.id), service]));

    const promoCodeInput = normalizePromoCode(req.body.promo_code);
    let appliedPromo = null;
    let promoGiftService = null;
    let promoDiscountPercent = null;

    if (promoCodeInput) {
      appliedPromo = await loadActivePromoCode(master.id, promoCodeInput);
      if (!appliedPromo) {
        return res.status(400).json({ error: 'Промокод не найден или неактивен' });
      }

      if (appliedPromo.reward_type === 'percent') {
        promoDiscountPercent = Number(appliedPromo.discount_percent || 0);
      } else if (appliedPromo.reward_type === 'gift_service') {
        const giftResolution = resolvePromoGiftService(appliedPromo, loadedServices);
        if (giftResolution.error) {
          return res.status(400).json({ error: giftResolution.error });
        }
        promoGiftService = giftResolution.giftService;
      } else {
        return res.status(400).json({ error: 'Неподдерживаемый тип промокода' });
      }
    }

    const effectiveServices = normalizedServiceIds.map((id) => servicesById.get(id)).filter(Boolean);
    if (effectiveServices.length !== normalizedServiceIds.length) {
      return res.status(400).json({ error: 'Не удалось собрать услуги для записи' });
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
    const minNoticeMinutes = Number(settings.min_booking_notice_minutes ?? 60);
    if (startDate.getTime() < Date.now() + minNoticeMinutes * 60000) {
      return res.status(400).json({ error: `Booking is allowed at least ${minNoticeMinutes} minutes in advance` });
    }

    // Calculate totals across all services
    const totalDurationMinutes = effectiveServices.reduce((sum, s) => sum + Number(s.duration_minutes || 0), 0);
    const totalBasePrice = effectiveServices.reduce((sum, s) => sum + Number(s.price || 0), 0);

    // Check for applicable hot window (only if no promo code used)
    let appliedHotWindow = null;
    let hotWindowGiftService = null;
    if (!appliedPromo) {
      try {
        const localDate2 = dateInTimezone(startDate, timezone);
        const slotStartMs = startDate.getTime();
        const slotEndMs = slotStartMs + totalDurationMinutes * 60000;
        const hwRes = await pool.query(
          `SELECT hw.*, s.name AS gift_service_name, s.price AS gift_service_price
           FROM hot_windows hw
           LEFT JOIN services s ON s.id = hw.gift_service_id
           WHERE hw.master_id = $1 AND hw.date = $2 AND hw.is_active = true`,
          [master.id, localDate2]
        );
        for (const hw of hwRes.rows) {
          const dateStr = hw.date instanceof Date ? hw.date.toISOString().slice(0, 10) : String(hw.date).slice(0, 10);
          const hwStartMs = localDateTimeToUtcMs(dateStr, hw.start_time, timezone);
          const hwEndMs = localDateTimeToUtcMs(dateStr, hw.end_time, timezone);
          const overlap = Math.max(0, Math.min(slotEndMs, hwEndMs) - Math.max(slotStartMs, hwStartMs));
          if (totalDurationMinutes > 0 && overlap / (totalDurationMinutes * 60000) >= 0.5) {
            appliedHotWindow = hw;
            if (hw.reward_type === 'gift_service' && hw.gift_service_id) {
              hotWindowGiftService = { id: hw.gift_service_id, name: hw.gift_service_name, price: Number(hw.gift_service_price || 0) };
            }
            break;
          }
        }
      } catch (hwError) {
        if (hwError.code !== '42P01') throw hwError;
      }
    }

    let discountAmount = 0;
    if (promoDiscountPercent !== null) {
      discountAmount = Math.round(totalBasePrice * promoDiscountPercent) / 100;
    } else if (promoGiftService) {
      discountAmount = Number(promoGiftService.price || 0);
    } else if (appliedHotWindow) {
      if (appliedHotWindow.reward_type === 'percent') {
        discountAmount = Math.round(totalBasePrice * Number(appliedHotWindow.discount_percent || 0)) / 100;
      } else if (hotWindowGiftService) {
        discountAmount = hotWindowGiftService.price;
      }
    }
    discountAmount = Math.min(totalBasePrice, Math.max(0, discountAmount));
    const finalPrice = Math.max(0, Math.round((totalBasePrice - discountAmount) * 100) / 100);

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

    const primaryServiceId = normalizedServiceIds[0];
    const extraServiceIds = normalizedServiceIds.slice(1);
    const endDate = new Date(startDate.getTime() + totalDurationMinutes * 60000);

    const insertSql = `INSERT INTO bookings
         (master_id, client_id, service_id, extra_service_ids, start_at, end_at, status, source, client_note,
          promo_code_id, promo_code, promo_reward_type, promo_discount_percent, promo_gift_service_id,
          hot_window_id, hot_window_reward_type, hot_window_discount_percent, hot_window_gift_service_id,
          pricing_base, pricing_final, pricing_discount_amount)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', 'telegram_link', $7,
               $8, $9, $10, $11, $12,
               $13, $14, $15, $16,
               $17, $18, $19)
       RETURNING *`;
    const insertParams = [
      master.id,
      req.user.id,
      primaryServiceId,
      JSON.stringify(extraServiceIds),
      startDate.toISOString(),
      endDate.toISOString(),
      client_note || null,
      appliedPromo ? Number(appliedPromo.id) : null,
      appliedPromo ? String(appliedPromo.code) : null,
      appliedPromo ? String(appliedPromo.reward_type) : null,
      promoDiscountPercent,
      promoGiftService ? Number(promoGiftService.id) : null,
      appliedHotWindow ? Number(appliedHotWindow.id) : null,
      appliedHotWindow ? String(appliedHotWindow.reward_type) : null,
      appliedHotWindow && appliedHotWindow.reward_type === 'percent' ? Number(appliedHotWindow.discount_percent) : null,
      hotWindowGiftService ? Number(hotWindowGiftService.id) : null,
      totalBasePrice,
      finalPrice,
      discountAmount
    ];

    let created = null;
    const promoUsageMode = appliedPromo ? String(appliedPromo.usage_mode || 'always') : 'always';
    if (appliedPromo && promoUsageMode === 'single_use') {
      let txOpened = false;
      try {
        await pool.query('BEGIN');
        txOpened = true;

        const consumeRes = await pool.query(
          `UPDATE master_promo_codes
           SET uses_count = COALESCE(uses_count, 0) + 1,
               is_active = false,
               updated_at = NOW()
           WHERE id = $1
             AND master_id = $2
             AND is_active = true
             AND usage_mode = 'single_use'
             AND COALESCE(uses_count, 0) < 1
           RETURNING id`,
          [Number(appliedPromo.id), master.id]
        );
        if (!consumeRes.rows.length) {
          await pool.query('ROLLBACK');
          txOpened = false;
          return res.status(400).json({ error: 'Промокод уже использован' });
        }

        const txResult = await pool.query(insertSql, insertParams);
        created = txResult.rows[0];

        await pool.query('COMMIT');
      } catch (txError) {
        if (txOpened) {
          await pool.query('ROLLBACK').catch(() => {});
        }
        throw txError;
      }
    } else {
      const result = await pool.query(insertSql, insertParams);
      created = result.rows[0];
    }

    try {
      await createReminders(created.id, created.master_id, created.start_at);
      await notifyMasterBookingEvent(created.id, 'created');
      await notifyClientBookingEvent(created.id, 'created');
    } catch (notifyError) {
      console.error('Error handling public booking side-effects:', notifyError);
    }

    return res.status(201).json({
      ...created,
      pricing: {
        base_price: totalBasePrice,
        final_price: finalPrice,
        discount_amount: discountAmount,
        promo_code: appliedPromo ? String(appliedPromo.code) : null,
        promo_reward_type: appliedPromo ? String(appliedPromo.reward_type) : null,
        promo_usage_mode: appliedPromo ? String(appliedPromo.usage_mode || 'always') : null,
        promo_discount_percent: promoDiscountPercent,
        promo_gift_service_name: promoGiftService ? promoGiftService.name : null,
        promo_gift_service_added: false,
        hot_window_id: appliedHotWindow ? Number(appliedHotWindow.id) : null,
        hot_window_reward_type: appliedHotWindow ? String(appliedHotWindow.reward_type) : null,
        hot_window_discount_percent: appliedHotWindow && appliedHotWindow.reward_type === 'percent' ? Number(appliedHotWindow.discount_percent) : null,
        hot_window_gift_service_name: hotWindowGiftService ? hotWindowGiftService.name : null
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

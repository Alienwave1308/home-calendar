const { pool } = require('../db');
const asyncRoute = require('../lib/asyncRoute');
const { URL: NodeURL } = require('url');

// ─── Public profile helpers ──────────────────────────────────────────────────

const DEFAULT_MASTER_PUBLIC_PROFILE = Object.freeze({
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
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (maxLength && trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }
  return trimmed;
}

function normalizeGiftUrl(value) {
  const normalized = normalizeOptionalText(value, 255);
  if (normalized === undefined) return undefined;
  if (normalized === null) return null;
  const withProtocol = /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
  try {
    const parsed = new NodeURL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildMasterPublicProfile(masterRow) {
  const fallbackName = String(masterRow && masterRow.display_name ? masterRow.display_name : '').trim();
  const giftUrl = normalizeGiftUrl(masterRow && masterRow.gift_url);
  return {
    brand: normalizeOptionalText(masterRow && masterRow.brand_name, 120) || DEFAULT_MASTER_PUBLIC_PROFILE.brand,
    subtitle: normalizeOptionalText(masterRow && masterRow.brand_subtitle, 120) || DEFAULT_MASTER_PUBLIC_PROFILE.subtitle,
    name: normalizeOptionalText(masterRow && masterRow.profile_name, 120) || fallbackName || DEFAULT_MASTER_PUBLIC_PROFILE.name,
    role: normalizeOptionalText(masterRow && masterRow.profile_role, 120) || DEFAULT_MASTER_PUBLIC_PROFILE.role,
    city: normalizeOptionalText(masterRow && masterRow.profile_city, 120) || DEFAULT_MASTER_PUBLIC_PROFILE.city,
    experience: normalizeOptionalText(masterRow && masterRow.profile_experience, 120) || DEFAULT_MASTER_PUBLIC_PROFILE.experience,
    phone: normalizeOptionalText(masterRow && masterRow.profile_phone, 120) || DEFAULT_MASTER_PUBLIC_PROFILE.phone,
    address: normalizeOptionalText(masterRow && masterRow.profile_address, 255) || DEFAULT_MASTER_PUBLIC_PROFILE.address,
    bio: normalizeOptionalText(masterRow && masterRow.profile_bio, 1200) || DEFAULT_MASTER_PUBLIC_PROFILE.bio,
    gift_text: normalizeOptionalText(masterRow && masterRow.gift_text, 255) || DEFAULT_MASTER_PUBLIC_PROFILE.gift_text,
    gift_url: giftUrl || DEFAULT_MASTER_PUBLIC_PROFILE.gift_url
  };
}

async function loadMasterFn(req, res, next) {
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

module.exports = {
  loadMaster: asyncRoute(loadMasterFn),
  LEAD_PERIODS,
  normalizeLeadPeriod,
  toPercent,
  buildLeadConversion,
  DEFAULT_MASTER_PUBLIC_PROFILE,
  normalizeOptionalText,
  normalizeGiftUrl,
  buildMasterPublicProfile
};

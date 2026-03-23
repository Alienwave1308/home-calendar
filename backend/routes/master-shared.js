const { pool } = require('../db');
const asyncRoute = require('../lib/asyncRoute');

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
  buildLeadConversion
};

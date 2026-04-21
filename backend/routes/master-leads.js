const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const asyncRoute = require('../lib/asyncRoute');
const { telegramApiCall, buildTelegramFileUrl } = require('../lib/telegram-notify');
const { loadMaster, LEAD_PERIODS, normalizeLeadPeriod, buildLeadConversion } = require('./master-shared');

async function getTelegramFileUrl(fileId) {
  if (!fileId) return null;
  const fileRes = await telegramApiCall('getFile', { file_id: fileId }, { timeoutMs: 8000 });
  if (!fileRes.ok || !fileRes.result || !fileRes.result.file_path) return null;
  return buildTelegramFileUrl(fileRes.result.file_path, fileRes.apiBase);
}

async function resolveTelegramProfile(telegramUserId) {
  const chatRes = await telegramApiCall('getChat', { chat_id: telegramUserId }, { timeoutMs: 8000 });
  const chat = chatRes.ok ? chatRes.result : null;
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

// GET /api/master/leads/metrics
router.get('/leads/metrics', loadMaster, asyncRoute(async (req, res) => {
  const period = normalizeLeadPeriod(req.query.period);
  const tz = req.master.timezone || process.env.MASTER_TIMEZONE || 'Asia/Novosibirsk';
  const periodSql = LEAD_PERIODS[period];
  const bounds = await loadLeadBounds(tz, periodSql);
  const { current_start_local, current_end_local, previous_start_local, previous_end_local } = bounds;

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
}));

// GET /api/master/leads/registrations
router.get('/leads/registrations', loadMaster, asyncRoute(async (req, res) => {
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
    [req.master.id, req.master.user_id, bounds.current_start_local, bounds.current_end_local, tz]
  );

  const users = await enrichLeadUsersWithTelegramProfile(usersRes.rows);

  return res.json({
    period,
    timezone: tz,
    range_start_local: bounds.current_start_local,
    range_end_local: bounds.current_end_local,
    users
  });
}));

module.exports = router;

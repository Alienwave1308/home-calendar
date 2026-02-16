const { google } = require('googleapis');
const crypto = require('crypto');
const { pool } = require('../db');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Create an OAuth2 client configured from env vars.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Generate the Google OAuth2 consent URL.
 *
 * @param {number} userId - stored in state param for callback
 * @returns {string} Authorization URL
 */
function getAuthUrl(userId) {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: String(userId)
  });
}

/**
 * Exchange authorization code for tokens and save binding.
 *
 * @param {string} code - auth code from Google callback
 * @param {number} userId
 * @returns {Object} The saved binding row
 */
async function handleCallback(code, userId) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);

  const expireAt = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : null;

  const { rows } = await pool.query(
    `INSERT INTO calendar_sync_bindings
       (user_id, provider, access_token, refresh_token, token_expire_at, scope, sync_mode)
     VALUES ($1, 'google', $2, $3, $4, $5, 'push')
     ON CONFLICT (user_id, provider) DO UPDATE SET
       access_token = $2,
       refresh_token = COALESCE($3, calendar_sync_bindings.refresh_token),
       token_expire_at = $4,
       scope = $5
     RETURNING *`,
    [userId, tokens.access_token, tokens.refresh_token, expireAt, SCOPES.join(' ')]
  );

  return rows[0];
}

/**
 * Get an authenticated OAuth2 client for a user, refreshing token if needed.
 *
 * @param {number} userId
 * @returns {{ client: OAuth2Client, binding: Object } | null}
 */
async function getAuthenticatedClient(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM calendar_sync_bindings WHERE user_id = $1 AND provider = $2',
    [userId, 'google']
  );

  if (rows.length === 0) return null;

  const binding = rows[0];
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: binding.access_token,
    refresh_token: binding.refresh_token
  });

  // Check if token is expired or about to expire (5 min buffer)
  const now = Date.now();
  const expireAt = binding.token_expire_at ? new Date(binding.token_expire_at).getTime() : 0;

  if (expireAt && expireAt - now < 300000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    const newExpireAt = credentials.expiry_date
      ? new Date(credentials.expiry_date).toISOString()
      : null;

    await pool.query(
      `UPDATE calendar_sync_bindings
       SET access_token = $1, token_expire_at = $2
       WHERE user_id = $3 AND provider = 'google'`,
      [credentials.access_token, newExpireAt, userId]
    );

    oauth2Client.setCredentials(credentials);
  }

  return { client: oauth2Client, binding };
}

/**
 * Compute a hash of booking data to detect changes (idempotency).
 */
function bookingHash(booking) {
  const data = `${booking.start_at}|${booking.end_at}|${booking.status}|${booking.service_name || ''}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * Push a booking as a Google Calendar event.
 * Creates or updates the event based on existing mapping.
 *
 * @param {number} userId - master's user_id
 * @param {Object} booking - booking row with service_name, client_name, start_at, end_at, status
 * @returns {Object|null} - mapping row or null if no binding
 */
async function pushBookingToCalendar(userId, booking) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) return null;

  const calendar = google.calendar({ version: 'v3', auth: auth.client });
  const hash = bookingHash(booking);

  // Check existing mapping
  const { rows: mappings } = await pool.query(
    'SELECT * FROM external_event_mappings WHERE booking_id = $1 AND provider = $2',
    [booking.id, 'google']
  );

  const calendarId = auth.binding.external_calendar_id || 'primary';

  const eventBody = {
    summary: `${booking.service_name || 'Запись'} — ${booking.client_name || 'Клиент'}`,
    start: { dateTime: new Date(booking.start_at).toISOString() },
    end: { dateTime: new Date(booking.end_at).toISOString() },
    status: booking.status === 'canceled' ? 'cancelled' : 'confirmed',
    location: 'Мкр Околица д.1, квартира 60',
    description: [
      `Услуга: ${booking.service_name || 'Услуга'}`,
      `Клиент: ${booking.client_name || 'Клиент'}`,
      `Статус: ${booking.status}`,
      booking.client_note ? `Комментарий клиента: ${booking.client_note}` : ''
    ].filter(Boolean).join('\n')
  };

  if (mappings.length > 0) {
    const mapping = mappings[0];

    // Idempotency: skip if hash matches
    if (mapping.last_pushed_hash === hash) return mapping;

    // Update existing event
    await calendar.events.update({
      calendarId,
      eventId: mapping.external_event_id,
      requestBody: eventBody
    });

    await pool.query(
      'UPDATE external_event_mappings SET last_pushed_hash = $1 WHERE id = $2',
      [hash, mapping.id]
    );

    return { ...mapping, last_pushed_hash: hash };
  }

  // Create new event
  const event = await calendar.events.insert({
    calendarId,
    requestBody: eventBody
  });

  const { rows: newMapping } = await pool.query(
    `INSERT INTO external_event_mappings (booking_id, provider, external_event_id, last_pushed_hash)
     VALUES ($1, 'google', $2, $3)
     RETURNING *`,
    [booking.id, event.data.id, hash]
  );

  return newMapping[0];
}

/**
 * Delete a Google Calendar event when booking is canceled.
 *
 * @param {number} userId
 * @param {number} bookingId
 */
async function deleteCalendarEvent(userId, bookingId) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) return;

  const { rows: mappings } = await pool.query(
    'SELECT * FROM external_event_mappings WHERE booking_id = $1 AND provider = $2',
    [bookingId, 'google']
  );

  if (mappings.length === 0) return;

  const calendar = google.calendar({ version: 'v3', auth: auth.client });
  const calendarId = auth.binding.external_calendar_id || 'primary';

  try {
    await calendar.events.delete({
      calendarId,
      eventId: mappings[0].external_event_id
    });
  } catch (err) {
    // Event may already be deleted — ignore 404/410
    if (err.code !== 404 && err.code !== 410) throw err;
  }

  await pool.query(
    'DELETE FROM external_event_mappings WHERE id = $1',
    [mappings[0].id]
  );
}

/**
 * Pull busy times from Google Calendar (for hybrid sync mode).
 * Returns array of { start, end } in ISO format.
 *
 * @param {number} userId
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} dateTo - YYYY-MM-DD
 * @returns {Array<{start: string, end: string}>}
 */
async function pullBusyTimes(userId, dateFrom, dateTo) {
  const auth = await getAuthenticatedClient(userId);
  if (!auth) return [];

  if (auth.binding.sync_mode !== 'hybrid') return [];

  const calendar = google.calendar({ version: 'v3', auth: auth.client });
  const calendarId = auth.binding.external_calendar_id || 'primary';

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: new Date(dateFrom + 'T00:00:00Z').toISOString(),
      timeMax: new Date(dateTo + 'T23:59:59Z').toISOString(),
      items: [{ id: calendarId }]
    }
  });

  const busy = response.data.calendars[calendarId]?.busy || [];

  await pool.query(
    'UPDATE calendar_sync_bindings SET last_sync_at = NOW() WHERE user_id = $1 AND provider = $2',
    [userId, 'google']
  );

  return busy.map(b => ({ start: b.start, end: b.end }));
}

/**
 * Remove calendar binding (disconnect).
 *
 * @param {number} userId
 */
async function disconnectCalendar(userId) {
  const auth = await getAuthenticatedClient(userId);
  if (auth) {
    try {
      await auth.client.revokeToken(auth.binding.access_token);
    } catch {
      // Revoke may fail if token already invalid — safe to ignore
    }
  }

  await pool.query(
    'DELETE FROM calendar_sync_bindings WHERE user_id = $1 AND provider = $2',
    [userId, 'google']
  );

  // Clean up event mappings for this user's bookings
  await pool.query(
    `DELETE FROM external_event_mappings
     WHERE provider = 'google' AND booking_id IN (
       SELECT b.id FROM bookings b
       JOIN masters m ON b.master_id = m.id
       WHERE m.user_id = $1
     )`,
    [userId]
  );
}

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  handleCallback,
  getAuthenticatedClient,
  bookingHash,
  pushBookingToCalendar,
  deleteCalendarEvent,
  pullBusyTimes,
  disconnectCalendar
};

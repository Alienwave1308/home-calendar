const { pool } = require('../db');

/**
 * Create reminders for a booking based on master's settings.
 * Called when a booking is confirmed.
 *
 * @param {number} bookingId
 * @param {number} masterId
 * @param {Date|string} startAt - booking start time
 */
async function createReminders(bookingId, masterId, startAt) {
  // Load master settings
  const { rows } = await pool.query(
    'SELECT reminder_hours FROM master_settings WHERE master_id = $1',
    [masterId]
  );

  // Default: [24, 2] hours before
  const hours = rows.length > 0 ? rows[0].reminder_hours : [24, 2];
  const startMs = new Date(startAt).getTime();

  for (const h of hours) {
    const remindAt = new Date(startMs - h * 3600000);

    // Only create if reminder time is in the future
    if (remindAt.getTime() > Date.now()) {
      await pool.query(
        `INSERT INTO booking_reminders (booking_id, remind_at)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [bookingId, remindAt.toISOString()]
      );
    }
  }
}

/**
 * Find and return unsent reminders that are due.
 * Marks them as sent atomically.
 *
 * @returns {Array} Array of { id, booking_id, remind_at, booking details }
 */
async function processPendingReminders() {
  const { rows } = await pool.query(
    `UPDATE booking_reminders
     SET sent = true
     WHERE sent = false AND remind_at <= NOW()
     RETURNING id, booking_id, remind_at`
  );

  if (rows.length === 0) return [];

  // Load booking details for each reminder
  const results = [];
  for (const reminder of rows) {
    const booking = await pool.query(
      `SELECT b.*, s.name AS service_name, s.duration_minutes,
              m.display_name AS master_name, m.timezone,
              u.username AS client_name
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN masters m ON b.master_id = m.id
       JOIN users u ON b.client_id = u.id
       WHERE b.id = $1 AND b.status NOT IN ('canceled')`,
      [reminder.booking_id]
    );

    if (booking.rows.length > 0) {
      results.push({
        reminder_id: reminder.id,
        remind_at: reminder.remind_at,
        booking: booking.rows[0]
      });
    }
  }

  return results;
}

/**
 * Check if a given time falls within quiet hours.
 *
 * @param {Date} time
 * @param {string|null} quietStart - HH:MM
 * @param {string|null} quietEnd - HH:MM
 * @returns {boolean}
 */
function isQuietHours(time, quietStart, quietEnd) {
  if (!quietStart || !quietEnd) return false;

  const t = time.getUTCHours() * 60 + time.getUTCMinutes();
  const [sh, sm] = quietStart.split(':').map(Number);
  const [eh, em] = quietEnd.split(':').map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  // Handle overnight quiet hours (e.g. 22:00 - 08:00)
  if (start > end) {
    return t >= start || t < end;
  }
  return t >= start && t < end;
}

/**
 * Delete reminders for a canceled/rescheduled booking.
 *
 * @param {number} bookingId
 */
async function deleteReminders(bookingId) {
  await pool.query(
    'DELETE FROM booking_reminders WHERE booking_id = $1 AND sent = false',
    [bookingId]
  );
}

module.exports = { createReminders, processPendingReminders, isQuietHours, deleteReminders };

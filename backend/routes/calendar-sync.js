const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  getAuthUrl,
  handleCallback,
  pushBookingToCalendar,
  deleteCalendarEvent,
  pullBusyTimes,
  disconnectCalendar
} = require('../lib/google-calendar');
const { pool } = require('../db');

// All routes require auth
router.use(authenticateToken);

// GET /api/calendar-sync/status — check if Google Calendar is connected
router.get('/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, provider, sync_mode, last_sync_at, external_calendar_id, created_at FROM calendar_sync_bindings WHERE user_id = $1 AND provider = $2',
      [req.user.id, 'google']
    );

    if (rows.length === 0) {
      return res.json({ connected: false });
    }

    res.json({ connected: true, binding: rows[0] });
  } catch (error) {
    console.error('Error checking sync status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/calendar-sync/connect — start OAuth2 flow
router.get('/connect', (req, res) => {
  const url = getAuthUrl(req.user.id);
  res.json({ url });
});

// GET /api/calendar-sync/callback — OAuth2 callback (handle code exchange)
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // state contains userId — verify it matches authenticated user
    const stateUserId = Number(state);
    if (stateUserId !== req.user.id) {
      return res.status(403).json({ error: 'User mismatch' });
    }

    const binding = await handleCallback(code, req.user.id);
    res.json({ connected: true, binding });
  } catch (error) {
    console.error('Error handling Google callback:', error);
    res.status(500).json({ error: 'Failed to connect Google Calendar' });
  }
});

// POST /api/calendar-sync/push/:bookingId — push booking to Google Calendar
router.post('/push/:bookingId', async (req, res) => {
  try {
    const bookingId = Number(req.params.bookingId);

    // Load booking with details
    const { rows } = await pool.query(
      `SELECT b.*, s.name AS service_name, u.username AS client_name
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       JOIN users u ON b.client_id = u.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = rows[0];

    // Verify user owns this booking (is the master)
    const { rows: masters } = await pool.query(
      'SELECT id FROM masters WHERE user_id = $1 AND id = $2',
      [req.user.id, booking.master_id]
    );

    if (masters.length === 0) {
      return res.status(403).json({ error: 'Not your booking' });
    }

    const mapping = await pushBookingToCalendar(req.user.id, booking);
    if (!mapping) {
      return res.status(400).json({ error: 'Google Calendar not connected' });
    }

    res.json({ pushed: true, mapping });
  } catch (error) {
    console.error('Error pushing to Google Calendar:', error);
    res.status(500).json({ error: 'Failed to push event' });
  }
});

// DELETE /api/calendar-sync/event/:bookingId — remove event from Google Calendar
router.delete('/event/:bookingId', async (req, res) => {
  try {
    const bookingId = Number(req.params.bookingId);
    await deleteCalendarEvent(req.user.id, bookingId);
    res.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// GET /api/calendar-sync/busy — pull busy times (hybrid mode)
router.get('/busy', async (req, res) => {
  try {
    const { date_from, date_to } = req.query;

    if (!date_from || !date_to) {
      return res.status(400).json({ error: 'date_from and date_to required' });
    }

    const busy = await pullBusyTimes(req.user.id, date_from, date_to);
    res.json(busy);
  } catch (error) {
    console.error('Error pulling busy times:', error);
    res.status(500).json({ error: 'Failed to pull busy times' });
  }
});

// PUT /api/calendar-sync/settings — update sync mode / calendar ID
router.put('/settings', async (req, res) => {
  try {
    const { sync_mode, external_calendar_id } = req.body;

    if (sync_mode && !['push', 'hybrid'].includes(sync_mode)) {
      return res.status(400).json({ error: 'sync_mode must be push or hybrid' });
    }

    const { rows } = await pool.query(
      `UPDATE calendar_sync_bindings
       SET sync_mode = COALESCE($1, sync_mode),
           external_calendar_id = COALESCE($2, external_calendar_id)
       WHERE user_id = $3 AND provider = 'google'
       RETURNING id, provider, sync_mode, external_calendar_id, last_sync_at`,
      [sync_mode || null, external_calendar_id || null, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Google Calendar not connected' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error updating sync settings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/calendar-sync/disconnect — disconnect Google Calendar
router.delete('/disconnect', async (req, res) => {
  try {
    await disconnectCalendar(req.user.id);
    res.json({ disconnected: true });
  } catch (error) {
    console.error('Error disconnecting Google Calendar:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

module.exports = router;

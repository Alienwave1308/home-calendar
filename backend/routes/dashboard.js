const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

router.get('/', async (req, res) => {
  try {
    const today = new Date();
    const todayIso = toIsoDate(today);
    const upcomingToIso = toIsoDate(addDays(today, 3));
    const weekAgo = addDays(today, -7).toISOString();

    const todayResult = await pool.query(
      `SELECT id, title, date, status, priority
       FROM tasks
       WHERE user_id = $1 AND deleted_at IS NULL AND date = $2
       ORDER BY id DESC`,
      [req.user.id, todayIso]
    );

    const overdueResult = await pool.query(
      `SELECT id, title, date, status, priority
       FROM tasks
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND date < $2
         AND status NOT IN ('done', 'canceled', 'archived')
       ORDER BY date ASC, id ASC`,
      [req.user.id, todayIso]
    );

    const upcomingResult = await pool.query(
      `SELECT id, title, date, status, priority
       FROM tasks
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND date > $2
         AND date <= $3
         AND status NOT IN ('done', 'canceled', 'archived')
       ORDER BY date ASC, id ASC`,
      [req.user.id, todayIso, upcomingToIso]
    );

    const statsResult = await pool.query(
      `SELECT COUNT(*)::int AS done_week
       FROM tasks
       WHERE user_id = $1
         AND deleted_at IS NULL
         AND status = 'done'
         AND completed_at >= $2`,
      [req.user.id, weekAgo]
    );

    res.json({
      today: todayResult.rows,
      overdue: overdueResult.rows,
      upcoming: upcomingResult.rows,
      stats: {
        done_week: statsResult.rows[0].done_week,
        today_count: todayResult.rows.length,
        overdue_count: overdueResult.rows.length,
        upcoming_count: upcomingResult.rows.length
      }
    });
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

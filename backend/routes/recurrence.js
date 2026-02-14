const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const VALID_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];

router.use(authenticateToken);

// POST /api/tasks/:id/recurrence — attach recurrence rule to a task
router.post('/tasks/:id/recurrence', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { frequency, interval, days_of_week, end_date } = req.body;

    if (!frequency || !VALID_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: `Invalid frequency. Must be: ${VALID_FREQUENCIES.join(', ')}` });
    }

    const ruleInterval = Math.max(parseInt(interval) || 1, 1);

    // Verify task belongs to user
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check for existing rule
    const existing = await pool.query(
      'SELECT id FROM recurrence_rules WHERE task_id = $1',
      [taskId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Task already has a recurrence rule' });
    }

    const daysArray = Array.isArray(days_of_week)
      ? days_of_week.filter(d => d >= 0 && d <= 6)
      : null;

    const result = await pool.query(
      `INSERT INTO recurrence_rules (task_id, frequency, interval, days_of_week, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [taskId, frequency, ruleInterval, daysArray, end_date || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating recurrence rule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tasks/:id/recurrence — get recurrence rule for a task
router.get('/tasks/:id/recurrence', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await pool.query(
      'SELECT * FROM recurrence_rules WHERE task_id = $1',
      [taskId]
    );

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting recurrence rule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/tasks/:id/recurrence — update recurrence rule
router.put('/tasks/:id/recurrence', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { frequency, interval, days_of_week, end_date } = req.body;

    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const existing = await pool.query(
      'SELECT * FROM recurrence_rules WHERE task_id = $1',
      [taskId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'No recurrence rule found' });
    }

    const current = existing.rows[0];
    const newFrequency = frequency || current.frequency;
    if (!VALID_FREQUENCIES.includes(newFrequency)) {
      return res.status(400).json({ error: `Invalid frequency. Must be: ${VALID_FREQUENCIES.join(', ')}` });
    }

    const newInterval = interval !== undefined ? Math.max(parseInt(interval) || 1, 1) : current.interval;
    const newDays = days_of_week !== undefined
      ? (Array.isArray(days_of_week) ? days_of_week.filter(d => d >= 0 && d <= 6) : null)
      : current.days_of_week;
    const newEndDate = end_date !== undefined ? (end_date || null) : current.end_date;

    const result = await pool.query(
      `UPDATE recurrence_rules SET frequency = $1, interval = $2, days_of_week = $3, end_date = $4
       WHERE task_id = $5 RETURNING *`,
      [newFrequency, newInterval, newDays, newEndDate, taskId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating recurrence rule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tasks/:id/recurrence — remove recurrence rule (break series)
router.delete('/tasks/:id/recurrence', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await pool.query(
      'DELETE FROM recurrence_rules WHERE task_id = $1 RETURNING *',
      [taskId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No recurrence rule found' });
    }

    // Detach generated instances from the series
    await pool.query(
      'UPDATE tasks SET recurrence_id = NULL WHERE recurrence_id = $1',
      [taskId]
    );

    res.json({ message: 'Recurrence rule deleted' });
  } catch (error) {
    console.error('Error deleting recurrence rule:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks/:id/recurrence/generate — generate instances up to a given date
router.post('/tasks/:id/recurrence/generate', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { until } = req.body;

    if (!until) {
      return res.status(400).json({ error: 'until date is required' });
    }

    const untilDate = new Date(until);
    if (isNaN(untilDate.getTime())) {
      return res.status(400).json({ error: 'Invalid until date' });
    }

    // Get source task
    const taskResult = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (taskResult.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const sourceTask = taskResult.rows[0];

    // Get rule
    const ruleResult = await pool.query(
      'SELECT * FROM recurrence_rules WHERE task_id = $1',
      [taskId]
    );
    if (ruleResult.rows.length === 0) {
      return res.status(404).json({ error: 'No recurrence rule found' });
    }

    const rule = ruleResult.rows[0];

    // Get existing generated dates to avoid duplicates
    const existingResult = await pool.query(
      'SELECT date FROM tasks WHERE recurrence_id = $1 AND deleted_at IS NULL',
      [taskId]
    );
    const existingDates = new Set(existingResult.rows.map(r => r.date));
    // Also exclude source task date
    existingDates.add(sourceTask.date);

    // Generate dates
    const dates = generateDates(sourceTask.date, rule, untilDate);
    const newDates = dates.filter(d => !existingDates.has(d));

    // Create task instances
    const created = [];
    for (const date of newDates) {
      const result = await pool.query(
        `INSERT INTO tasks (title, date, status, description, priority, user_id, recurrence_id)
         VALUES ($1, $2, 'planned', $3, $4, $5, $6) RETURNING *`,
        [sourceTask.title, date, sourceTask.description, sourceTask.priority, req.user.id, taskId]
      );
      created.push(result.rows[0]);
    }

    res.status(201).json({ generated: created.length, tasks: created });
  } catch (error) {
    console.error('Error generating recurrence instances:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks/:id/recurrence/skip — skip (soft-delete) a specific instance
router.post('/tasks/:id/recurrence/skip', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    // Task must be a generated instance (has recurrence_id)
    const task = await pool.query(
      'SELECT id, recurrence_id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (!task.rows[0].recurrence_id) {
      return res.status(400).json({ error: 'Task is not a recurrence instance' });
    }

    const result = await pool.query(
      'UPDATE tasks SET deleted_at = NOW() WHERE id = $1 RETURNING *',
      [taskId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error skipping recurrence instance:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks/:id/recurrence/detach — detach an instance from the series
router.post('/tasks/:id/recurrence/detach', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    const task = await pool.query(
      'SELECT id, recurrence_id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (!task.rows[0].recurrence_id) {
      return res.status(400).json({ error: 'Task is not a recurrence instance' });
    }

    const result = await pool.query(
      'UPDATE tasks SET recurrence_id = NULL WHERE id = $1 RETURNING *',
      [taskId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error detaching recurrence instance:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// === Date Generation Logic ===

function generateDates(startDate, rule, untilDate) {
  const dates = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = rule.end_date ? new Date(rule.end_date + 'T00:00:00') : untilDate;
  const limit = end < untilDate ? end : untilDate;
  const maxInstances = 365; // safety limit

  let current = new Date(start);

  for (let i = 0; i < maxInstances; i++) {
    current = nextOccurrence(current, rule);
    if (current > limit) break;

    const iso = toIsoDate(current);
    dates.push(iso);
  }

  return dates;
}

function nextOccurrence(date, rule) {
  const next = new Date(date);

  if (rule.frequency === 'daily') {
    next.setDate(next.getDate() + rule.interval);
    return next;
  }

  if (rule.frequency === 'weekly') {
    if (rule.days_of_week && rule.days_of_week.length > 0) {
      // Advance day by day until we hit a matching day of week
      const days = rule.days_of_week;
      let attempt = new Date(next);
      for (let i = 0; i < 7 * rule.interval + 7; i++) {
        attempt.setDate(attempt.getDate() + 1);
        if (days.includes(attempt.getDay())) {
          return attempt;
        }
      }
      // Fallback
      next.setDate(next.getDate() + 7 * rule.interval);
      return next;
    }
    next.setDate(next.getDate() + 7 * rule.interval);
    return next;
  }

  if (rule.frequency === 'monthly') {
    next.setMonth(next.getMonth() + rule.interval);
    return next;
  }

  if (rule.frequency === 'yearly') {
    next.setFullYear(next.getFullYear() + rule.interval);
    return next;
  }

  return next;
}

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

module.exports = router;
module.exports.generateDates = generateDates;

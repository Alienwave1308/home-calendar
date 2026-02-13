const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const VALID_STATUSES = ['planned', 'in_progress', 'done'];

// All task routes require authentication
router.use(authenticateToken);

// GET /api/tasks - get all tasks
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE user_id = $1 ORDER BY id',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting tasks:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tasks/family — get all family members' tasks
router.get('/family', async (req, res) => {
  try {
    // Find user's family
    const membership = await pool.query(
      'SELECT family_id FROM family_members WHERE user_id = $1',
      [req.user.id]
    );

    if (membership.rows.length === 0) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const familyId = membership.rows[0].family_id;

    // Get all tasks from all family members
    const result = await pool.query(
      `SELECT t.*, u.username
       FROM tasks t
       JOIN family_members fm ON fm.user_id = t.user_id
       JOIN users u ON u.id = t.user_id
       WHERE fm.family_id = $1
       ORDER BY t.date, t.id`,
      [familyId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting family tasks:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tasks/:id - get single task
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks - create task
router.post('/', async (req, res) => {
  try {
    const { title, date, status } = req.body;

    if (!title || !date) {
      return res.status(400).json({ error: 'Title and date are required' });
    }

    const taskStatus = status || 'planned';
    if (!VALID_STATUSES.includes(taskStatus)) {
      return res.status(400).json({ error: 'Invalid status. Must be: planned, in_progress, or done' });
    }

    const result = await pool.query(
      'INSERT INTO tasks (title, date, status, user_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, date, taskStatus, req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/tasks/:id - update task
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, date, status } = req.body;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: planned, in_progress, or done' });
    }

    const existing = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const current = existing.rows[0];
    const newTitle = title !== undefined ? title : current.title;
    const newDate = date !== undefined ? date : current.date;
    const newStatus = status !== undefined ? status : current.status;

    const result = await pool.query(
      'UPDATE tasks SET title = $1, date = $2, status = $3 WHERE id = $4 AND user_id = $5 RETURNING *',
      [newTitle, newDate, newStatus, id, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tasks/:id - delete task
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

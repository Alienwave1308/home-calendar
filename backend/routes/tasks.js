const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const VALID_STATUSES = ['backlog', 'planned', 'in_progress', 'done', 'canceled', 'archived'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

// All task routes require authentication
router.use(authenticateToken);

// GET /api/tasks - get all tasks (excludes soft-deleted)
// Supports ?tag=tagId for filtering by tag
router.get('/', async (req, res) => {
  try {
    const tagId = req.query.tag ? parseInt(req.query.tag) : null;

    let query;
    let params;

    if (tagId) {
      query = `SELECT t.* FROM tasks t
        JOIN task_tags tt ON tt.task_id = t.id
        WHERE t.user_id = $1 AND t.deleted_at IS NULL AND tt.tag_id = $2
        ORDER BY t.id`;
      params = [req.user.id, tagId];
    } else {
      query = 'SELECT * FROM tasks WHERE user_id = $1 AND deleted_at IS NULL ORDER BY id';
      params = [req.user.id];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting tasks:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tasks/family — get all family members' tasks (excludes soft-deleted)
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
       WHERE fm.family_id = $1 AND t.deleted_at IS NULL
       ORDER BY t.date, t.id`,
      [familyId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting family tasks:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tasks/:id - get single task (excludes soft-deleted)
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
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
    const { title, date, status, description, priority } = req.body;

    if (!title || !date) {
      return res.status(400).json({ error: 'Title and date are required' });
    }

    const taskStatus = status || 'planned';
    if (!VALID_STATUSES.includes(taskStatus)) {
      return res.status(400).json({ error: `Invalid status. Must be: ${VALID_STATUSES.join(', ')}` });
    }

    const taskPriority = priority || 'medium';
    if (!VALID_PRIORITIES.includes(taskPriority)) {
      return res.status(400).json({ error: `Invalid priority. Must be: ${VALID_PRIORITIES.join(', ')}` });
    }

    const result = await pool.query(
      `INSERT INTO tasks (title, date, status, description, priority, user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, date, taskStatus, description || null, taskPriority, req.user.id]
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
    const { title, date, status, description, priority } = req.body;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be: ${VALID_STATUSES.join(', ')}` });
    }

    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority. Must be: ${VALID_PRIORITIES.join(', ')}` });
    }

    const existing = await pool.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const current = existing.rows[0];
    const newTitle = title !== undefined ? title : current.title;
    const newDate = date !== undefined ? date : current.date;
    const newStatus = status !== undefined ? status : current.status;
    const newDescription = description !== undefined ? description : current.description;
    const newPriority = priority !== undefined ? priority : current.priority;

    // Set completed_at when transitioning to done
    let completedAt = current.completed_at;
    if (newStatus === 'done' && current.status !== 'done') {
      completedAt = new Date().toISOString();
    } else if (newStatus !== 'done' && current.status === 'done') {
      completedAt = null;
    }

    const result = await pool.query(
      `UPDATE tasks SET title = $1, date = $2, status = $3, description = $4,
       priority = $5, completed_at = $6
       WHERE id = $7 AND user_id = $8 RETURNING *`,
      [newTitle, newDate, newStatus, newDescription, newPriority, completedAt, id, req.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tasks/:id - soft delete task
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query(
      'UPDATE tasks SET deleted_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *',
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

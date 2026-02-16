const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { getUserWorkspaceId } = require('../lib/workspace');

// All list routes require authentication
router.use(authenticateToken);

// GET /api/lists — get all lists for current workspace
router.get('/', async (req, res) => {
  try {
    const workspaceId = await getUserWorkspaceId(req.user.id);
    if (!workspaceId) {
      return res.status(404).json({ error: 'Рабочее пространство не найдено' });
    }

    const result = await pool.query(
      `SELECT tl.*, u.username AS created_by_username,
        (SELECT COUNT(*) FROM tasks t WHERE t.list_id = tl.id AND t.deleted_at IS NULL) AS task_count
       FROM task_lists tl
       JOIN users u ON u.id = tl.created_by
       WHERE tl.family_id = $1
       ORDER BY tl.name`,
      [workspaceId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting lists:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/lists — create a list
router.post('/', async (req, res) => {
  try {
    const { name, description, color } = req.body;

    if (!name || name.trim().length < 1) {
      return res.status(400).json({ error: 'List name is required' });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'List name must be 100 characters or less' });
    }

    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g. #ff0000)' });
    }

    const workspaceId = await getUserWorkspaceId(req.user.id);
    if (!workspaceId) {
      return res.status(404).json({ error: 'Рабочее пространство не найдено' });
    }

    const result = await pool.query(
      'INSERT INTO task_lists (family_id, name, description, color, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [workspaceId, name.trim(), description || null, color || '#6c5ce7', req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating list:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/lists/:id — update a list
router.put('/:id', async (req, res) => {
  try {
    const listId = parseInt(req.params.id);
    const { name, description, color } = req.body;

    if (name !== undefined && name.trim().length < 1) {
      return res.status(400).json({ error: 'List name is required' });
    }

    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g. #ff0000)' });
    }

    const workspaceId = await getUserWorkspaceId(req.user.id);
    if (!workspaceId) {
      return res.status(404).json({ error: 'Рабочее пространство не найдено' });
    }

    // Check list exists and belongs to current workspace
    const existing = await pool.query(
      'SELECT * FROM task_lists WHERE id = $1 AND family_id = $2',
      [listId, workspaceId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }

    const current = existing.rows[0];
    const newName = name !== undefined ? name.trim() : current.name;
    const newDescription = description !== undefined ? description : current.description;
    const newColor = color !== undefined ? color : current.color;

    const result = await pool.query(
      'UPDATE task_lists SET name = $1, description = $2, color = $3 WHERE id = $4 RETURNING *',
      [newName, newDescription, newColor, listId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating list:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/lists/:id — delete a list (tasks keep their list_id set to NULL)
router.delete('/:id', async (req, res) => {
  try {
    const listId = parseInt(req.params.id);

    const workspaceId = await getUserWorkspaceId(req.user.id);
    if (!workspaceId) {
      return res.status(404).json({ error: 'Рабочее пространство не найдено' });
    }

    const result = await pool.query(
      'DELETE FROM task_lists WHERE id = $1 AND family_id = $2 RETURNING *',
      [listId, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'List not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting list:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

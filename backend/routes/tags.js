const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// All tag routes require authentication
router.use(authenticateToken);

// Helper: get user's family_id or null
async function getUserFamilyId(userId) {
  const result = await pool.query(
    'SELECT family_id FROM family_members WHERE user_id = $1',
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0].family_id : null;
}

// GET /api/tags — get all tags for user's family
router.get('/', async (req, res) => {
  try {
    const familyId = await getUserFamilyId(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const result = await pool.query(
      'SELECT * FROM tags WHERE family_id = $1 ORDER BY name',
      [familyId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting tags:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tags — create a tag
router.post('/', async (req, res) => {
  try {
    const { name, color } = req.body;

    if (!name || name.trim().length < 1) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    if (name.trim().length > 50) {
      return res.status(400).json({ error: 'Tag name must be 50 characters or less' });
    }

    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g. #ff0000)' });
    }

    const familyId = await getUserFamilyId(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    // Check for duplicate name in same family
    const existing = await pool.query(
      'SELECT id FROM tags WHERE family_id = $1 AND name = $2',
      [familyId, name.trim()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Tag with this name already exists' });
    }

    const result = await pool.query(
      'INSERT INTO tags (family_id, name, color) VALUES ($1, $2, $3) RETURNING *',
      [familyId, name.trim(), color || '#6c5ce7']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/tags/:id — update a tag
router.put('/:id', async (req, res) => {
  try {
    const tagId = parseInt(req.params.id);
    const { name, color } = req.body;

    if (name !== undefined && name.trim().length < 1) {
      return res.status(400).json({ error: 'Tag name is required' });
    }

    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return res.status(400).json({ error: 'Color must be a valid hex color (e.g. #ff0000)' });
    }

    const familyId = await getUserFamilyId(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    // Check tag exists and belongs to user's family
    const existing = await pool.query(
      'SELECT * FROM tags WHERE id = $1 AND family_id = $2',
      [tagId, familyId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    const current = existing.rows[0];
    const newName = name !== undefined ? name.trim() : current.name;
    const newColor = color !== undefined ? color : current.color;

    // Check for duplicate name if name changed
    if (newName !== current.name) {
      const duplicate = await pool.query(
        'SELECT id FROM tags WHERE family_id = $1 AND name = $2 AND id != $3',
        [familyId, newName, tagId]
      );
      if (duplicate.rows.length > 0) {
        return res.status(409).json({ error: 'Tag with this name already exists' });
      }
    }

    const result = await pool.query(
      'UPDATE tags SET name = $1, color = $2 WHERE id = $3 RETURNING *',
      [newName, newColor, tagId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating tag:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tags/:id — delete a tag
router.delete('/:id', async (req, res) => {
  try {
    const tagId = parseInt(req.params.id);

    const familyId = await getUserFamilyId(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const result = await pool.query(
      'DELETE FROM tags WHERE id = $1 AND family_id = $2 RETURNING *',
      [tagId, familyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting tag:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tags/:tagId/tasks/:taskId — attach tag to task
router.post('/:tagId/tasks/:taskId', async (req, res) => {
  try {
    const tagId = parseInt(req.params.tagId);
    const taskId = parseInt(req.params.taskId);

    const familyId = await getUserFamilyId(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    // Verify tag belongs to user's family
    const tag = await pool.query(
      'SELECT id FROM tags WHERE id = $1 AND family_id = $2',
      [tagId, familyId]
    );
    if (tag.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    // Verify task belongs to user
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if already linked
    const existing = await pool.query(
      'SELECT task_id FROM task_tags WHERE task_id = $1 AND tag_id = $2',
      [taskId, tagId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Tag already attached to this task' });
    }

    await pool.query(
      'INSERT INTO task_tags (task_id, tag_id) VALUES ($1, $2)',
      [taskId, tagId]
    );

    res.status(201).json({ message: 'Tag attached' });
  } catch (error) {
    console.error('Error attaching tag:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tags/:tagId/tasks/:taskId — detach tag from task
router.delete('/:tagId/tasks/:taskId', async (req, res) => {
  try {
    const tagId = parseInt(req.params.tagId);
    const taskId = parseInt(req.params.taskId);

    const result = await pool.query(
      'DELETE FROM task_tags WHERE task_id = $1 AND tag_id = $2 RETURNING *',
      [taskId, tagId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag not attached to this task' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error detaching tag:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

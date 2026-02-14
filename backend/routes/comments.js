const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// All comment routes require authentication
router.use(authenticateToken);

// GET /api/comments/task/:taskId — get comments for a task (with pagination)
router.get('/task/:taskId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT c.*, u.username
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.task_id = $1
       ORDER BY c.created_at ASC
       LIMIT $2 OFFSET $3`,
      [taskId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) AS total FROM comments WHERE task_id = $1',
      [taskId]
    );

    res.json({
      comments: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    });
  } catch (error) {
    console.error('Error getting comments:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/comments/task/:taskId — add a comment
router.post('/task/:taskId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId);
    const { text } = req.body;

    if (!text || text.trim().length < 1) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    // Verify task exists (not soft-deleted)
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND deleted_at IS NULL',
      [taskId]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await pool.query(
      'INSERT INTO comments (task_id, user_id, text) VALUES ($1, $2, $3) RETURNING *',
      [taskId, req.user.id, text.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/comments/:id — edit own comment
router.put('/:id', async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);
    const { text } = req.body;

    if (!text || text.trim().length < 1) {
      return res.status(400).json({ error: 'Comment text is required' });
    }

    // Check comment exists and belongs to caller
    const existing = await pool.query(
      'SELECT * FROM comments WHERE id = $1',
      [commentId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (existing.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }

    const result = await pool.query(
      'UPDATE comments SET text = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [text.trim(), commentId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/comments/:id — delete own comment (or owner/admin can delete any)
router.delete('/:id', async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);

    const existing = await pool.query(
      'SELECT * FROM comments WHERE id = $1',
      [commentId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = existing.rows[0];

    // Allow delete if own comment
    if (comment.user_id === req.user.id) {
      await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
      return res.status(204).send();
    }

    // Check if caller is owner/admin in the task owner's family
    const callerRole = await pool.query(
      'SELECT fm.role FROM family_members fm WHERE fm.user_id = $1',
      [req.user.id]
    );

    if (callerRole.rows.length > 0 &&
        (callerRole.rows[0].role === 'owner' || callerRole.rows[0].role === 'admin')) {
      await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
      return res.status(204).send();
    }

    return res.status(403).json({ error: 'You can only delete your own comments' });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

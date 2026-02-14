const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// Helper: get user's family_id
async function getUserFamily(userId) {
  const result = await pool.query(
    'SELECT family_id FROM family_members WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows.length > 0 ? result.rows[0].family_id : null;
}

// GET /api/shopping — list all items for the family
router.get('/', async (req, res) => {
  try {
    const familyId = await getUserFamily(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const result = await pool.query(
      `SELECT s.*, u1.username AS added_by_name, u2.username AS bought_by_name
       FROM shopping_items s
       LEFT JOIN users u1 ON s.added_by = u1.id
       LEFT JOIN users u2 ON s.bought_by = u2.id
       WHERE s.family_id = $1
       ORDER BY s.is_bought ASC, s.created_at DESC`,
      [familyId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting shopping list:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/shopping — add item
router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const familyId = await getUserFamily(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const result = await pool.query(
      `INSERT INTO shopping_items (family_id, title, added_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [familyId, title.trim(), req.user.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding shopping item:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/shopping/:id — update item title
router.put('/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const familyId = await getUserFamily(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const result = await pool.query(
      'UPDATE shopping_items SET title = $1 WHERE id = $2 AND family_id = $3 RETURNING *',
      [title.trim(), itemId, familyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating shopping item:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/shopping/:id/toggle — toggle bought status
router.put('/:id/toggle', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);

    const familyId = await getUserFamily(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    // Get current state
    const current = await pool.query(
      'SELECT * FROM shopping_items WHERE id = $1 AND family_id = $2',
      [itemId, familyId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = current.rows[0];
    const newBought = !item.is_bought;

    const result = await pool.query(
      `UPDATE shopping_items
       SET is_bought = $1, bought_by = $2, bought_at = $3
       WHERE id = $4 RETURNING *`,
      [newBought, newBought ? req.user.id : null, newBought ? new Date() : null, itemId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error toggling shopping item:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/shopping/:id — remove item
router.delete('/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);

    const familyId = await getUserFamily(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const result = await pool.query(
      'DELETE FROM shopping_items WHERE id = $1 AND family_id = $2 RETURNING *',
      [itemId, familyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting shopping item:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/shopping/:id/to-task — convert shopping item to a task
router.post('/:id/to-task', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);

    const familyId = await getUserFamily(req.user.id);
    if (!familyId) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const item = await pool.query(
      'SELECT * FROM shopping_items WHERE id = $1 AND family_id = $2',
      [itemId, familyId]
    );

    if (item.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const today = new Date().toISOString().split('T')[0];

    const task = await pool.query(
      `INSERT INTO tasks (title, date, status, description, priority, user_id)
       VALUES ($1, $2, 'planned', 'Created from shopping list', 'medium', $3) RETURNING *`,
      [`Buy: ${item.rows[0].title}`, today, req.user.id]
    );

    // Remove the shopping item after conversion
    await pool.query('DELETE FROM shopping_items WHERE id = $1', [itemId]);

    res.status(201).json(task.rows[0]);
  } catch (error) {
    console.error('Error converting shopping item to task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

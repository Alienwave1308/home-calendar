const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const VALID_STATUSES = ['backlog', 'planned', 'in_progress', 'done', 'canceled', 'archived'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

// All task routes require authentication
router.use(authenticateToken);

// GET /api/tasks - get all tasks (excludes soft-deleted)
// Supports ?tag=tagId and ?assignee=userId for filtering
router.get('/', async (req, res) => {
  try {
    const tagId = req.query.tag ? parseInt(req.query.tag) : null;
    const assigneeId = req.query.assignee ? parseInt(req.query.assignee) : null;

    let query;
    let params;

    if (tagId && assigneeId) {
      query = `SELECT DISTINCT t.* FROM tasks t
        JOIN task_tags tt ON tt.task_id = t.id
        JOIN task_assignments ta ON ta.task_id = t.id
        WHERE t.user_id = $1 AND t.deleted_at IS NULL AND tt.tag_id = $2 AND ta.user_id = $3
        ORDER BY t.id`;
      params = [req.user.id, tagId, assigneeId];
    } else if (tagId) {
      query = `SELECT t.* FROM tasks t
        JOIN task_tags tt ON tt.task_id = t.id
        WHERE t.user_id = $1 AND t.deleted_at IS NULL AND tt.tag_id = $2
        ORDER BY t.id`;
      params = [req.user.id, tagId];
    } else if (assigneeId) {
      query = `SELECT t.* FROM tasks t
        JOIN task_assignments ta ON ta.task_id = t.id
        WHERE t.user_id = $1 AND t.deleted_at IS NULL AND ta.user_id = $2
        ORDER BY t.id`;
      params = [req.user.id, assigneeId];
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

// GET /api/tasks/:id/assignees — get assignees for a task
router.get('/:id/assignees', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    const result = await pool.query(
      `SELECT ta.id, ta.role, ta.assigned_at, u.id AS user_id, u.username
       FROM task_assignments ta
       JOIN users u ON u.id = ta.user_id
       WHERE ta.task_id = $1
       ORDER BY ta.assigned_at`,
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error getting assignees:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks/:id/assign — assign a user to a task
router.post('/:id/assign', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { user_id: targetUserId, role } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    const assignRole = role || 'assignee';
    if (!['assignee', 'watcher'].includes(assignRole)) {
      return res.status(400).json({ error: 'Role must be assignee or watcher' });
    }

    // Check task exists and belongs to caller
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check target user is in same family
    const callerFamily = await pool.query(
      'SELECT family_id FROM family_members WHERE user_id = $1',
      [req.user.id]
    );
    if (callerFamily.rows.length === 0) {
      return res.status(404).json({ error: 'You are not in a family' });
    }

    const targetFamily = await pool.query(
      'SELECT family_id FROM family_members WHERE user_id = $1 AND family_id = $2',
      [targetUserId, callerFamily.rows[0].family_id]
    );
    if (targetFamily.rows.length === 0) {
      return res.status(404).json({ error: 'Target user is not in your family' });
    }

    // Check if already assigned
    const existing = await pool.query(
      'SELECT id FROM task_assignments WHERE task_id = $1 AND user_id = $2',
      [taskId, targetUserId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already assigned to this task' });
    }

    const result = await pool.query(
      'INSERT INTO task_assignments (task_id, user_id, role) VALUES ($1, $2, $3) RETURNING *',
      [taskId, targetUserId, assignRole]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error assigning user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tasks/:id/assign/:userId — unassign a user from a task
router.delete('/:id/assign/:userId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const targetUserId = parseInt(req.params.userId);

    // Check task belongs to caller
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await pool.query(
      'DELETE FROM task_assignments WHERE task_id = $1 AND user_id = $2 RETURNING *',
      [taskId, targetUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error unassigning user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// === CHECKLIST ITEMS ===

// GET /api/tasks/:id/checklist — get checklist items
router.get('/:id/checklist', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    // Verify task belongs to caller
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await pool.query(
      'SELECT * FROM checklist_items WHERE task_id = $1 ORDER BY position, id',
      [taskId]
    );

    const total = result.rows.length;
    const completed = result.rows.filter(i => i.is_done).length;

    res.json({ items: result.rows, progress: { completed, total } });
  } catch (error) {
    console.error('Error getting checklist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks/:id/checklist — add checklist item
router.post('/:id/checklist', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { title } = req.body;

    if (!title || title.trim().length < 1) {
      return res.status(400).json({ error: 'Title is required' });
    }

    // Verify task belongs to caller
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Get next position
    const maxPos = await pool.query(
      'SELECT COALESCE(MAX(position), -1) AS max_pos FROM checklist_items WHERE task_id = $1',
      [taskId]
    );
    const position = maxPos.rows[0].max_pos + 1;

    const result = await pool.query(
      'INSERT INTO checklist_items (task_id, title, position) VALUES ($1, $2, $3) RETURNING *',
      [taskId, title.trim(), position]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding checklist item:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/tasks/:id/checklist/:itemId — update checklist item (title, is_done)
router.put('/:id/checklist/:itemId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);
    const { title, is_done } = req.body;

    // Verify task belongs to caller
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Get existing item
    const existing = await pool.query(
      'SELECT * FROM checklist_items WHERE id = $1 AND task_id = $2',
      [itemId, taskId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }

    const current = existing.rows[0];
    const newTitle = title !== undefined ? title.trim() : current.title;
    const newIsDone = is_done !== undefined ? is_done : current.is_done;

    const result = await pool.query(
      'UPDATE checklist_items SET title = $1, is_done = $2 WHERE id = $3 RETURNING *',
      [newTitle, newIsDone, itemId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating checklist item:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tasks/:id/checklist/:itemId — delete checklist item
router.delete('/:id/checklist/:itemId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);

    // Verify task belongs to caller
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await pool.query(
      'DELETE FROM checklist_items WHERE id = $1 AND task_id = $2 RETURNING *',
      [itemId, taskId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Checklist item not found' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting checklist item:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/tasks/:id/checklist/reorder — reorder checklist items
router.put('/:id/checklist-reorder', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);
    const { order } = req.body; // array of item IDs in new order

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: 'order must be a non-empty array of item IDs' });
    }

    // Verify task belongs to caller
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Update positions
    for (let i = 0; i < order.length; i++) {
      await pool.query(
        'UPDATE checklist_items SET position = $1 WHERE id = $2 AND task_id = $3',
        [i, order[i], taskId]
      );
    }

    const result = await pool.query(
      'SELECT * FROM checklist_items WHERE task_id = $1 ORDER BY position, id',
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error reordering checklist:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

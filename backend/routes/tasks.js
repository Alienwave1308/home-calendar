// Роуты для работы с задачами
const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// GET /api/tasks - получить все задачи
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tasks ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error getting tasks:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tasks/:id - получить одну задачу по ID
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks - создать новую задачу
router.post('/', async (req, res) => {
  try {
    const { title, date } = req.body;

    if (!title || !date) {
      return res.status(400).json({ error: 'Title and date are required' });
    }

    const result = await pool.query(
      'INSERT INTO tasks (title, date, completed) VALUES ($1, $2, false) RETURNING *',
      [title, date]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/tasks/:id - обновить задачу
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { title, date, completed } = req.body;

    // Сначала проверяем, существует ли задача
    const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Обновляем только те поля, которые пришли
    const current = existing.rows[0];
    const newTitle = title !== undefined ? title : current.title;
    const newDate = date !== undefined ? date : current.date;
    const newCompleted = completed !== undefined ? completed : current.completed;

    const result = await pool.query(
      'UPDATE tasks SET title = $1, date = $2, completed = $3 WHERE id = $4 RETURNING *',
      [newTitle, newDate, newCompleted, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tasks/:id - удалить задачу
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [id]);

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
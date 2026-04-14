const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const asyncRoute = require('../lib/asyncRoute');
const { loadMaster } = require('./master-shared');

// GET /api/master/blocks
router.get('/blocks', loadMaster, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM master_blocks WHERE master_id = $1 ORDER BY start_at',
    [req.master.id]
  );
  res.json(rows);
}));

// POST /api/master/blocks
router.post('/blocks', loadMaster, asyncRoute(async (req, res) => {
  const { start_at, end_at, title } = req.body;

  if (!start_at || !end_at) {
    return res.status(400).json({ error: 'start_at and end_at are required' });
  }
  if (new Date(start_at) >= new Date(end_at)) {
    return res.status(400).json({ error: 'start_at must be before end_at' });
  }

  const result = await pool.query(
    `INSERT INTO master_blocks (master_id, start_at, end_at, title)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.master.id, start_at, end_at, title || null]
  );

  res.status(201).json(result.rows[0]);
}));

// PUT /api/master/blocks/:id
router.put('/blocks/:id', loadMaster, asyncRoute(async (req, res) => {
  const { start_at, end_at, title } = req.body;

  const block = await pool.query(
    'SELECT id FROM master_blocks WHERE id = $1 AND master_id = $2',
    [req.params.id, req.master.id]
  );
  if (block.rows.length === 0) {
    return res.status(404).json({ error: 'Block not found' });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (start_at !== undefined) { updates.push(`start_at = $${idx++}`); values.push(start_at); }
  if (end_at !== undefined) { updates.push(`end_at = $${idx++}`); values.push(end_at); }
  if (title !== undefined) { updates.push(`title = $${idx++}`); values.push(title); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE master_blocks SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  res.json(result.rows[0]);
}));

// DELETE /api/master/blocks/:id
router.delete('/blocks/:id', loadMaster, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'DELETE FROM master_blocks WHERE id = $1 AND master_id = $2 RETURNING id',
    [req.params.id, req.master.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Block not found' });
  }
  res.json({ message: 'Block deleted' });
}));

module.exports = router;

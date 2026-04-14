const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const asyncRoute = require('../lib/asyncRoute');
const { loadMaster } = require('./master-shared');

// GET /api/master/hot-windows
router.get('/hot-windows', loadMaster, asyncRoute(async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT hw.*, s.name AS gift_service_name
       FROM hot_windows hw
       LEFT JOIN services s ON s.id = hw.gift_service_id
       WHERE hw.master_id = $1
       ORDER BY hw.date DESC, hw.start_time`,
      [req.master.id]
    );
    res.json(rows);
  } catch (error) {
    if (error.code === '42P01') return res.json([]);
    throw error;
  }
}));

// POST /api/master/hot-windows
router.post('/hot-windows', loadMaster, asyncRoute(async (req, res) => {
  const { date, start_time, end_time, reward_type } = req.body;

  if (!date || !start_time || !end_time) {
    return res.status(400).json({ error: 'date, start_time, end_time are required' });
  }
  if (!['percent', 'gift_service'].includes(reward_type)) {
    return res.status(400).json({ error: 'reward_type must be percent or gift_service' });
  }
  if (start_time >= end_time) {
    return res.status(400).json({ error: 'start_time must be before end_time' });
  }

  let discountPercent = null;
  let giftServiceId = null;

  if (reward_type === 'percent') {
    discountPercent = Number(req.body.discount_percent);
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 90) {
      return res.status(400).json({ error: 'discount_percent must be integer between 1 and 90' });
    }
  } else {
    giftServiceId = Number(req.body.gift_service_id);
    if (!Number.isFinite(giftServiceId) || giftServiceId <= 0) {
      return res.status(400).json({ error: 'gift_service_id is required for gift_service reward type' });
    }
    const svcCheck = await pool.query(
      'SELECT id FROM services WHERE id = $1 AND master_id = $2 AND is_active = true',
      [giftServiceId, req.master.id]
    );
    if (!svcCheck.rows.length) {
      return res.status(404).json({ error: 'Gift service not found or inactive' });
    }
  }

  const result = await pool.query(
    `INSERT INTO hot_windows
       (master_id, date, start_time, end_time, reward_type, discount_percent, gift_service_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [req.master.id, date, start_time, end_time, reward_type, discountPercent, giftServiceId]
  );
  res.status(201).json(result.rows[0]);
}));

// DELETE /api/master/hot-windows/:id
router.delete('/hot-windows/:id', loadMaster, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'DELETE FROM hot_windows WHERE id = $1 AND master_id = $2 RETURNING id',
    [req.params.id, req.master.id]
  );
  if (!result.rows.length) {
    return res.status(404).json({ error: 'Hot window not found' });
  }
  res.json({ ok: true });
}));

module.exports = router;

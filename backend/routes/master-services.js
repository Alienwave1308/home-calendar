const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { DEFAULT_SERVICES, toDescription } = require('../lib/default-services');
const asyncRoute = require('../lib/asyncRoute');
const { loadMaster } = require('./master-shared');

// GET /api/master/services
router.get('/services', loadMaster, asyncRoute(async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM services WHERE master_id = $1 ORDER BY created_at',
      [req.master.id]
    );
    res.json(rows);
  } catch (error) {
    if (error.code !== '42703') throw error;
    // Legacy schema: created_at may not exist — fall back to ORDER BY id
    const { rows } = await pool.query(
      'SELECT * FROM services WHERE master_id = $1 ORDER BY id',
      [req.master.id]
    );
    res.json(rows.map((row) => ({
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      is_active: true,
      ...row
    })));
  }
}));

// POST /api/master/services/bootstrap-default — must come before POST /services/:id
router.post('/services/bootstrap-default', loadMaster, asyncRoute(async (req, res) => {
  const overwrite = Boolean(req.body && req.body.overwrite);

  let activeCount;
  try {
    const existing = await pool.query(
      'SELECT COUNT(*)::int AS total FROM services WHERE master_id = $1 AND is_active = true',
      [req.master.id]
    );
    activeCount = Number(existing.rows[0]?.total || 0);
  } catch (countError) {
    if (countError.code !== '42703') throw countError;
    // Legacy schema: is_active may not exist
    const existing = await pool.query(
      'SELECT COUNT(*)::int AS total FROM services WHERE master_id = $1',
      [req.master.id]
    );
    activeCount = Number(existing.rows[0]?.total || 0);
  }

  if (activeCount > 0 && !overwrite) {
    return res.status(409).json({
      error: 'Services already exist. Pass { overwrite: true } to replace them.',
      active_services: activeCount
    });
  }

  try {
    await pool.query('BEGIN');

    if (overwrite) {
      try {
        await pool.query(
          'UPDATE services SET is_active = false WHERE master_id = $1 AND is_active = true',
          [req.master.id]
        );
      } catch (deactivateError) {
        if (deactivateError.code !== '42703') throw deactivateError;
        // is_active column doesn't exist — skip deactivation
      }
    }

    const inserted = [];
    for (const item of DEFAULT_SERVICES) {
      let result;
      try {
        result = await pool.query(
          `INSERT INTO services (master_id, name, duration_minutes, price, description,
                                 buffer_before_minutes, buffer_after_minutes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [req.master.id, item.name, item.duration_minutes, item.price, toDescription(item), 0, 0]
        );
      } catch (insertError) {
        if (insertError.code !== '42703') throw insertError;
        // Legacy schema: description/buffer columns may not exist
        result = await pool.query(
          `INSERT INTO services (master_id, name, duration_minutes, price)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [req.master.id, item.name, item.duration_minutes, item.price]
        );
      }
      inserted.push(result.rows[0]);
    }

    await pool.query('COMMIT');
    return res.status(201).json({
      inserted_count: inserted.length,
      overwrite,
      services: inserted
    });
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    throw error;
  }
}));

// POST /api/master/services
router.post('/services', loadMaster, asyncRoute(async (req, res) => {
  const { name, duration_minutes, price, description, buffer_before_minutes, buffer_after_minutes } = req.body;

  if (!name || name.length < 2) {
    return res.status(400).json({ error: 'name is required (min 2 chars)' });
  }
  const duration = Number(duration_minutes);
  if (!duration || duration < 5) {
    return res.status(400).json({ error: 'duration_minutes is required (min 5)' });
  }

  let result;
  try {
    result = await pool.query(
      `INSERT INTO services (master_id, name, duration_minutes, price, description,
                             buffer_before_minutes, buffer_after_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.master.id, name, duration, price || null, description || null,
       buffer_before_minutes || 0, buffer_after_minutes || 0]
    );
  } catch (error) {
    if (error.code !== '42703') throw error;
    // Legacy schema: description/buffer columns may not exist
    result = await pool.query(
      `INSERT INTO services (master_id, name, duration_minutes, price)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.master.id, name, duration, price || null]
    );
    if (result.rows[0]) {
      result.rows[0].description = null;
      result.rows[0].buffer_before_minutes = 0;
      result.rows[0].buffer_after_minutes = 0;
      result.rows[0].is_active = true;
    }
  }

  res.status(201).json(result.rows[0]);
}));

// PUT /api/master/services/:id
router.put('/services/:id', loadMaster, asyncRoute(async (req, res) => {
  const { name, duration_minutes, price, description, buffer_before_minutes, buffer_after_minutes, is_active } = req.body;

  const service = await pool.query(
    'SELECT id FROM services WHERE id = $1 AND master_id = $2',
    [req.params.id, req.master.id]
  );
  if (service.rows.length === 0) {
    return res.status(404).json({ error: 'Service not found' });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
  if (duration_minutes !== undefined) { updates.push(`duration_minutes = $${idx++}`); values.push(Number(duration_minutes)); }
  if (price !== undefined) { updates.push(`price = $${idx++}`); values.push(price); }
  if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
  if (buffer_before_minutes !== undefined) { updates.push(`buffer_before_minutes = $${idx++}`); values.push(Number(buffer_before_minutes)); }
  if (buffer_after_minutes !== undefined) { updates.push(`buffer_after_minutes = $${idx++}`); values.push(Number(buffer_after_minutes)); }
  if (is_active !== undefined) { updates.push(`is_active = $${idx++}`); values.push(Boolean(is_active)); }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(req.params.id);
  let result;
  try {
    result = await pool.query(
      `UPDATE services SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
  } catch (error) {
    if (error.code !== '42703') throw error;
    // Legacy schema: some columns may not exist — fallback to minimal update
    const safeUpdates = [];
    const safeValues = [];
    let safeIdx = 1;
    if (name !== undefined) { safeUpdates.push(`name = $${safeIdx++}`); safeValues.push(name); }
    if (duration_minutes !== undefined) { safeUpdates.push(`duration_minutes = $${safeIdx++}`); safeValues.push(Number(duration_minutes)); }
    if (price !== undefined) { safeUpdates.push(`price = $${safeIdx++}`); safeValues.push(price); }
    safeValues.push(req.params.id);
    result = await pool.query(
      `UPDATE services SET ${safeUpdates.join(', ')} WHERE id = $${safeIdx} RETURNING *`,
      safeValues
    );
    if (result.rows[0]) {
      result.rows[0].buffer_before_minutes = result.rows[0].buffer_before_minutes ?? 0;
      result.rows[0].buffer_after_minutes = result.rows[0].buffer_after_minutes ?? 0;
      result.rows[0].is_active = result.rows[0].is_active ?? true;
    }
  }

  res.json(result.rows[0]);
}));

// DELETE /api/master/services/:id
router.delete('/services/:id', loadMaster, asyncRoute(async (req, res) => {
  let result;
  try {
    result = await pool.query(
      'UPDATE services SET is_active = false WHERE id = $1 AND master_id = $2 RETURNING *',
      [req.params.id, req.master.id]
    );
  } catch (error) {
    if (error.code !== '42703') throw error;
    // Legacy schema: is_active column may not exist — hard delete
    result = await pool.query(
      'DELETE FROM services WHERE id = $1 AND master_id = $2 RETURNING *',
      [req.params.id, req.master.id]
    );
    if (result.rows[0]) {
      result.rows[0].is_active = false;
    }
  }
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Service not found' });
  }
  res.json(result.rows[0]);
}));

module.exports = router;

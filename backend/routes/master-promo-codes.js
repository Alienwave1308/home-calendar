const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const asyncRoute = require('../lib/asyncRoute');
const { loadMaster } = require('./master-shared');

function normalizePromoCode(code) {
  return String(code || '').trim().toUpperCase();
}

// GET /api/master/promo-codes
router.get('/promo-codes', loadMaster, asyncRoute(async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.master_id, p.code, p.reward_type, p.discount_percent, p.gift_service_id,
              p.usage_mode, p.uses_count,
              p.is_active, p.created_at, p.updated_at,
              s.name AS gift_service_name,
              COUNT(b.id)::int AS actual_uses_count
       FROM master_promo_codes p
       LEFT JOIN services s ON s.id = p.gift_service_id
       LEFT JOIN bookings b ON b.promo_code = p.code
         AND b.master_id = p.master_id
         AND b.status != 'canceled'
       WHERE p.master_id = $1
       GROUP BY p.id, s.name
       ORDER BY p.created_at DESC, p.id DESC`,
      [req.master.id]
    );
    res.json(rows);
  } catch (error) {
    if (error.code === '42P01') {
      return res.json([]);
    }
    if (error.code === '42703') {
      try {
        const fallback = await pool.query(
          `SELECT p.id, p.master_id, p.code, p.reward_type, p.discount_percent, p.gift_service_id,
                  p.is_active, p.created_at, p.updated_at,
                  s.name AS gift_service_name
           FROM master_promo_codes p
           LEFT JOIN services s ON s.id = p.gift_service_id
           WHERE p.master_id = $1
           ORDER BY p.created_at DESC, p.id DESC`,
          [req.master.id]
        );
        return res.json(fallback.rows.map((row) => ({
          ...row,
          usage_mode: 'always',
          uses_count: 0
        })));
      } catch (fallbackError) {
        if (fallbackError.code === '42P01') {
          return res.json([]);
        }
        console.error('Error loading promo codes (legacy fallback):', fallbackError);
        return res.status(500).json({ error: 'Server error' });
      }
    }
    console.error('Error loading promo codes:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}));

// POST /api/master/promo-codes
router.post('/promo-codes', loadMaster, asyncRoute(async (req, res) => {
  const rawCode = normalizePromoCode(req.body.code);
  const rewardType = String(req.body.reward_type || '').trim();
  const usageMode = String(req.body.usage_mode || 'always').trim();

  if (!rawCode || rawCode.length < 3 || rawCode.length > 64) {
    return res.status(400).json({ error: 'Промокод должен содержать от 3 до 64 символов' });
  }
  if (!/^[A-Z0-9_-]+$/.test(rawCode)) {
    return res.status(400).json({ error: 'Промокод может содержать только латинские буквы A-Z, цифры, "_" и "-"' });
  }
  if (!['percent', 'gift_service'].includes(rewardType)) {
    return res.status(400).json({ error: 'reward_type must be percent or gift_service' });
  }
  if (!['always', 'single_use'].includes(usageMode)) {
    return res.status(400).json({ error: 'usage_mode must be always or single_use' });
  }

  let discountPercent = null;
  let giftServiceId = null;

  if (rewardType === 'percent') {
    discountPercent = Number(req.body.discount_percent);
    if (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 100) {
      return res.status(400).json({ error: 'discount_percent must be integer between 1 and 100' });
    }
  }

  let result;
  try {
    result = await pool.query(
      `INSERT INTO master_promo_codes
         (master_id, code, reward_type, discount_percent, gift_service_id, usage_mode, uses_count, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 0, true)
       RETURNING *`,
      [req.master.id, rawCode, rewardType, discountPercent, giftServiceId, usageMode]
    );
  } catch (insertError) {
    if (insertError.code !== '42703') throw insertError;
    result = await pool.query(
      `INSERT INTO master_promo_codes
         (master_id, code, reward_type, discount_percent, gift_service_id, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [req.master.id, rawCode, rewardType, discountPercent, giftServiceId]
    );
    if (result.rows[0]) {
      result.rows[0].usage_mode = 'always';
      result.rows[0].uses_count = 0;
    }
  }

  if (!result || !result.rows[0]) {
    throw new Error('Insert returned no rows');
  }
  if (result.rows[0].code === '23505') {
    return res.status(409).json({ error: 'promo code already exists' });
  }
  res.status(201).json(result.rows[0]);
}));

// PATCH /api/master/promo-codes/:id
router.patch('/promo-codes/:id', loadMaster, asyncRoute(async (req, res) => {
  if (typeof req.body.is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be boolean' });
  }

  const promoRes = await pool.query(
    `SELECT id, usage_mode, uses_count
     FROM master_promo_codes
     WHERE id = $1 AND master_id = $2
     LIMIT 1`,
    [req.params.id, req.master.id]
  );
  if (!promoRes.rows.length) {
    return res.status(404).json({ error: 'Promo code not found' });
  }
  const promo = promoRes.rows[0];
  if (req.body.is_active === true
    && String(promo.usage_mode) === 'single_use'
    && Number(promo.uses_count || 0) >= 1) {
    return res.status(400).json({ error: 'Одноразовый промокод уже использован и не может быть включён' });
  }

  const result = await pool.query(
    `UPDATE master_promo_codes
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2 AND master_id = $3
     RETURNING *`,
    [req.body.is_active, req.params.id, req.master.id]
  );
  res.json(result.rows[0]);
}));

// DELETE /api/master/promo-codes/:id
router.delete('/promo-codes/:id', loadMaster, asyncRoute(async (req, res) => {
  const result = await pool.query(
    'DELETE FROM master_promo_codes WHERE id = $1 AND master_id = $2 RETURNING id',
    [req.params.id, req.master.id]
  );
  if (!result.rows.length) {
    return res.status(404).json({ error: 'Promo code not found' });
  }
  res.json({ message: 'Promo code deleted' });
}));

module.exports = router;

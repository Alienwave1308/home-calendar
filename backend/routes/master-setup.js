const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { nanoid } = require('nanoid');
const asyncRoute = require('../lib/asyncRoute');
const { loadMaster, normalizeOptionalText, normalizeGiftUrl, buildMasterPublicProfile } = require('./master-shared');

// POST /api/master/setup — create master profile
router.post('/setup', asyncRoute(async (req, res) => {
  const { display_name, timezone } = req.body;

  if (!display_name || display_name.length < 2) {
    return res.status(400).json({ error: 'display_name is required (min 2 chars)' });
  }

  const existing = await pool.query('SELECT id FROM masters WHERE user_id = $1', [req.user.id]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Master profile already exists' });
  }

  const booking_slug = nanoid(10);
  const tz = timezone || process.env.MASTER_TIMEZONE || 'Asia/Novosibirsk';

  const result = await pool.query(
    `INSERT INTO masters (user_id, display_name, timezone, booking_slug)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, display_name, timezone, booking_slug, cancel_policy_hours, created_at`,
    [req.user.id, display_name, tz, booking_slug]
  );

  res.status(201).json(result.rows[0]);
}));

// GET /api/master/profile
router.get('/profile', loadMaster, asyncRoute(async (req, res) => {
  const { id, user_id, display_name, timezone, booking_slug, cancel_policy_hours, created_at } = req.master;
  res.json({
    id,
    user_id,
    display_name,
    timezone,
    booking_slug,
    cancel_policy_hours,
    created_at,
    profile: buildMasterPublicProfile(req.master)
  });
}));

// PUT /api/master/profile
router.put('/profile', loadMaster, asyncRoute(async (req, res) => {
  const { display_name, timezone, cancel_policy_hours } = req.body;
  const payloadProfile = req.body && typeof req.body.profile === 'object' && req.body.profile
    ? req.body.profile
    : {};
  const profileFields = {
    brand_name: req.body.brand !== undefined ? req.body.brand : payloadProfile.brand,
    brand_subtitle: req.body.subtitle !== undefined ? req.body.subtitle : payloadProfile.subtitle,
    profile_name: req.body.name !== undefined ? req.body.name : payloadProfile.name,
    profile_role: req.body.role !== undefined ? req.body.role : payloadProfile.role,
    profile_city: req.body.city !== undefined ? req.body.city : payloadProfile.city,
    profile_experience: req.body.experience !== undefined ? req.body.experience : payloadProfile.experience,
    profile_phone: req.body.phone !== undefined ? req.body.phone : payloadProfile.phone,
    profile_address: req.body.address !== undefined ? req.body.address : payloadProfile.address,
    profile_bio: req.body.bio !== undefined ? req.body.bio : payloadProfile.bio,
    gift_text: req.body.gift_text !== undefined ? req.body.gift_text : payloadProfile.gift_text,
    gift_url: req.body.gift_url !== undefined ? req.body.gift_url : payloadProfile.gift_url
  };
  const updates = [];
  const values = [];
  let idx = 1;

  if (display_name !== undefined) {
    const normalized = String(display_name || '').trim();
    if (normalized.length < 2) {
      return res.status(400).json({ error: 'display_name must be at least 2 chars' });
    }
    updates.push(`display_name = $${idx++}`);
    values.push(normalized);
  }
  if (timezone !== undefined) {
    const normalizedTimezone = String(timezone || '').trim();
    if (!normalizedTimezone) {
      return res.status(400).json({ error: 'timezone must be a non-empty string' });
    }
    updates.push(`timezone = $${idx++}`);
    values.push(normalizedTimezone);
  }
  if (cancel_policy_hours !== undefined) {
    const hours = Number(cancel_policy_hours);
    if (isNaN(hours) || hours < 0) {
      return res.status(400).json({ error: 'cancel_policy_hours must be a non-negative number' });
    }
    updates.push(`cancel_policy_hours = $${idx++}`);
    values.push(hours);
  }

  for (const key of [
    'brand_name',
    'brand_subtitle',
    'profile_name',
    'profile_role',
    'profile_city',
    'profile_experience',
    'profile_phone',
    'profile_address',
    'profile_bio',
    'gift_text'
  ]) {
    if (profileFields[key] === undefined) continue;
    const maxLength = key === 'profile_bio' ? 1200 : key === 'profile_address' ? 255 : 120;
    updates.push(`${key} = $${idx++}`);
    values.push(normalizeOptionalText(profileFields[key], maxLength));
  }

  if (profileFields.gift_url !== undefined) {
    const rawGiftUrl = String(profileFields.gift_url || '').trim();
    const giftUrl = normalizeGiftUrl(profileFields.gift_url);
    if (rawGiftUrl && !giftUrl) {
      return res.status(400).json({ error: 'gift_url must be a valid http/https URL' });
    }
    updates.push(`gift_url = $${idx++}`);
    values.push(giftUrl);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  values.push(req.master.id);
  const result = await pool.query(
    `UPDATE masters SET ${updates.join(', ')} WHERE id = $${idx}
     RETURNING *`,
    values
  );
  const row = result.rows[0];
  res.json({
    id: row.id,
    user_id: row.user_id,
    display_name: row.display_name,
    timezone: row.timezone,
    booking_slug: row.booking_slug,
    cancel_policy_hours: row.cancel_policy_hours,
    created_at: row.created_at,
    profile: buildMasterPublicProfile(row)
  });
}));

module.exports = router;

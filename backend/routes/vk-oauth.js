'use strict';

/**
 * VK OAuth для web-версии booking.
 *
 * GET  /api/auth/vk/oauth    — редирект на VK OAuth
 * GET  /api/auth/vk/callback — обработка кода, выдача JWT, редирект на /book/:slug
 */

const express = require('express');
const crypto = require('crypto');
const { URL } = require('url');
const router = express.Router();
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');
const jwt = require('jsonwebtoken');

function buildToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

// GET /api/auth/vk/oauth?slug=lera&redirect=confirm
router.get('/oauth', (req, res) => {
  const appId = process.env.VK_APP_ID;
  if (!appId) {
    return res.status(503).send('VK OAuth не настроен');
  }

  const domain = process.env.APP_DOMAIN || 'rova-epil.ru';
  const redirectUri = `https://${domain}/api/auth/vk/callback`;
  const slug = req.query.slug || '';
  const state = Buffer.from(JSON.stringify({ slug })).toString('base64url');

  const url = new URL('https://oauth.vk.com/authorize');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('display', 'popup');
  url.searchParams.set('scope', '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('v', '5.131');
  url.searchParams.set('state', state);

  return res.redirect(url.toString());
});

// GET /api/auth/vk/callback?code=...&state=...
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code) {
    return res.redirect('/book/lera?vk_auth_error=1');
  }

  const appId = process.env.VK_APP_ID;
  const appSecret = process.env.VK_APP_SECRET;
  const domain = process.env.APP_DOMAIN || 'rova-epil.ru';
  const redirectUri = `https://${domain}/api/auth/vk/callback`;

  let slug = 'lera';
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString());
    slug = parsed.slug || slug;
  } catch {
    // использовать дефолт
  }

  try {
    // Обмениваем code на access_token
    const tokenUrl = new URL('https://oauth.vk.com/access_token');
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = await tokenRes.json();

    if (tokenData.error || !tokenData.user_id) {
      console.error('[vk-oauth] token exchange error:', tokenData);
      return res.redirect(`/book/${slug}?vk_auth_error=1`);
    }

    const vkUserId = Number(tokenData.user_id);
    const username = `vk_${vkUserId}`;

    let userResult = await pool.query(
      'SELECT id, username FROM users WHERE vk_user_id = $1 OR username = $2 LIMIT 1',
      [vkUserId, username]
    );

    if (userResult.rows.length === 0) {
      userResult = await pool.query(
        'INSERT INTO users (username, vk_user_id) VALUES ($1, $2) RETURNING id, username',
        [username, vkUserId]
      );
    } else if (!userResult.rows[0].vk_user_id) {
      await pool.query('UPDATE users SET vk_user_id = $1 WHERE id = $2', [vkUserId, userResult.rows[0].id]);
      userResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [userResult.rows[0].id]);
    }

    const user = userResult.rows[0];
    const jwtToken = buildToken(user);

    // Редиректим обратно на страницу записи с токеном в hash
    // Frontend читает #vk_token=... и сохраняет в localStorage
    const nonce = crypto.randomBytes(8).toString('hex');
    return res.redirect(`/book/${slug}#vk_token=${jwtToken}&vk_nonce=${nonce}`);
  } catch (err) {
    console.error('[vk-oauth] callback error:', err);
    return res.redirect(`/book/${slug}?vk_auth_error=1`);
  }
});

module.exports = router;

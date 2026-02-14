const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { pool } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if username already exists
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ user: { id: user.id, username: user.username }, token });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ user: { id: user.id, username: user.username }, token });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/forgot-password — generate reset token
router.post('/forgot-password', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (user.rows.length === 0) {
      // Don't reveal whether user exists — return success anyway
      return res.json({ message: 'If the user exists, a reset token has been generated' });
    }

    // Invalidate old tokens
    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false',
      [user.rows[0].id]
    );

    // Generate token (32 bytes → 64 hex chars)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.rows[0].id, token, expiresAt]
    );

    // In production, send email with token. For now, return it directly.
    res.json({ message: 'If the user exists, a reset token has been generated', token });
  } catch (error) {
    console.error('Error in forgot-password:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password — reset password using token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Find valid token
    const tokenResult = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > NOW()',
      [token]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const resetToken = tokenResult.rows[0];

    // Update password
    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, resetToken.user_id]
    );

    // Mark token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used = true WHERE id = $1',
      [resetToken.id]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error in reset-password:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

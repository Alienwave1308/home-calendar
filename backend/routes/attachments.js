const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES_PER_TASK = 10;
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE }
});

router.use(authenticateToken);

// POST /api/tasks/:id/attachments — upload a file
router.post('/tasks/:id/attachments', upload.single('file'), async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Verify task belongs to user
    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check attachment count limit
    const countResult = await pool.query(
      'SELECT COUNT(*) AS count FROM attachments WHERE task_id = $1',
      [taskId]
    );
    if (parseInt(countResult.rows[0].count) >= MAX_FILES_PER_TASK) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `Maximum ${MAX_FILES_PER_TASK} files per task` });
    }

    const result = await pool.query(
      `INSERT INTO attachments (task_id, user_id, filename, filepath, mimetype, size)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [taskId, req.user.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    // Clean up file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error uploading attachment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/tasks/:id/attachments — list attachments for a task
router.get('/tasks/:id/attachments', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id);

    const task = await pool.query(
      'SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [taskId, req.user.id]
    );
    if (task.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const result = await pool.query(
      'SELECT id, task_id, user_id, filename, mimetype, size, created_at FROM attachments WHERE task_id = $1 ORDER BY created_at DESC',
      [taskId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error listing attachments:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/attachments/:id — download a file
router.get('/attachments/:id', async (req, res) => {
  try {
    const attachmentId = parseInt(req.params.id);

    const result = await pool.query(
      `SELECT a.* FROM attachments a
       JOIN tasks t ON a.task_id = t.id
       WHERE a.id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL`,
      [attachmentId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const attachment = result.rows[0];
    const filePath = path.join(UPLOADS_DIR, attachment.filepath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
    res.setHeader('Content-Type', attachment.mimetype);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error downloading attachment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/attachments/:id — delete an attachment
router.delete('/attachments/:id', async (req, res) => {
  try {
    const attachmentId = parseInt(req.params.id);

    const result = await pool.query(
      `SELECT a.* FROM attachments a
       JOIN tasks t ON a.task_id = t.id
       WHERE a.id = $1 AND t.user_id = $2 AND t.deleted_at IS NULL`,
      [attachmentId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const attachment = result.rows[0];

    // Delete from DB
    await pool.query('DELETE FROM attachments WHERE id = $1', [attachmentId]);

    // Delete file from disk
    const filePath = path.join(UPLOADS_DIR, attachment.filepath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting attachment:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

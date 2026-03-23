/**
 * Express error handler middleware.
 * Catches errors passed via next(err) — typically from asyncRoute wrappers.
 * Must be registered last in server.js: app.use(errorHandler).
 */
module.exports = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(`[${req.method} ${req.path}]`, err);
  res.status(500).json({ error: 'Server error' });
};

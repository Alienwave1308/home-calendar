/**
 * Wraps an async route handler to automatically pass errors to next().
 * Eliminates repetitive try-catch in route handlers.
 *
 * Usage:
 *   router.get('/path', asyncRoute(async (req, res) => {
 *     const data = await pool.query(...);
 *     res.json(data.rows);
 *   }));
 */
module.exports = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

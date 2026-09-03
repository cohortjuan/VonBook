import { Router } from 'express';
import { pool } from '../db/pool.js';

export const adminRouter = Router();

// POST /api/admin/grant-dev -- one-time helper to flip is_dev on for
// whoever's calling this (never a different user -- there's no target id
// param on purpose). is_dev has no self-service claim path like
// FOUNDER_CLAIM_CODE does; this is the same one-off-secret pattern the
// earlier media migration endpoint used. delete this route (and ADMIN_KEY)
// once it's actually been used.
adminRouter.post('/grant-dev', async (req, res, next) => {
  try {
    const key = req.get('X-Admin-Key');
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'not allowed' });
    }

    const result = await pool.query('UPDATE users SET is_dev = true WHERE id = $1 RETURNING id, username, is_dev', [
      req.user.id,
    ]);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

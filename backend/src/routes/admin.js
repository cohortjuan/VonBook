import { Router } from 'express';
import { pool } from '../db/pool.js';

export const adminRouter = Router();

// POST /api/admin/grant-dev -- flips is_dev on for whoever's calling this
// (never a different user -- there's no target id param on purpose).
// is_dev has no self-service claim path like FOUNDER_CLAIM_CODE does, so
// this stays around as the one way to grant it -- kept intentionally,
// not a one-time migration helper meant to be deleted after use.
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

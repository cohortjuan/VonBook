import { Router } from 'express';
import { pool } from '../db/pool.js';

export const adminRouter = Router();

// POST /api/admin/migrate-media { pairs: [{ old_url, new_url }] }
//
// one-time helper for the move from local disk storage to cloudinary:
// rewrites any users.avatar_url / users.cover_url / post_media.media_url
// row that currently equals old_url to new_url instead. gated behind a
// one-off secret (env var, never committed) rather than is_dev since it
// writes urls onto other people's rows and has no other business being
// reachable by a regular logged-in user. meant to be deleted once it's
// actually been run against production once -- not permanent surface area.
adminRouter.post('/migrate-media', async (req, res, next) => {
  try {
    const key = req.get('X-Migration-Key');
    if (!process.env.MIGRATION_KEY || key !== process.env.MIGRATION_KEY) {
      return res.status(403).json({ error: 'not allowed' });
    }

    const pairs = Array.isArray(req.body.pairs) ? req.body.pairs : [];
    let usersUpdated = 0;
    let mediaUpdated = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const pair of pairs) {
        const oldUrl = pair?.old_url;
        const newUrl = pair?.new_url;
        if (!oldUrl || !newUrl) continue;

        const a = await client.query('UPDATE users SET avatar_url = $2 WHERE avatar_url = $1', [oldUrl, newUrl]);
        const c = await client.query('UPDATE users SET cover_url = $2 WHERE cover_url = $1', [oldUrl, newUrl]);
        const m = await client.query('UPDATE post_media SET media_url = $2 WHERE media_url = $1', [oldUrl, newUrl]);
        usersUpdated += a.rowCount + c.rowCount;
        mediaUpdated += m.rowCount;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ usersUpdated, mediaUpdated });
  } catch (err) {
    next(err);
  }
});

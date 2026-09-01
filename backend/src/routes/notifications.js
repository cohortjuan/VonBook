import { Router } from 'express';
import { pool } from '../db/pool.js';

export const notificationsRouter = Router();

// GET /api/notifications?before=<id> -- newest first, with the actor's
// public info joined in so the frontend doesn't need a second lookup
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const before = Number(req.query.before) || null;
    const result = await pool.query(
      `SELECT n.id, n.type, n.payload, n.read_at, n.created_at,
              a.id AS actor_id, a.username AS actor_username, a.display_name AS actor_display_name,
              a.avatar_url AS actor_avatar_url, a.is_founder AS actor_is_founder, a.is_dev AS actor_is_dev
       FROM notifications n
       LEFT JOIN users a ON a.id = n.actor_id
       WHERE n.recipient_id = $1 AND ($2::int IS NULL OR n.id < $2)
       ORDER BY n.id DESC
       LIMIT 30`,
      [req.user.id, before],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

notificationsRouter.get('/unread-count', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1 AND read_at IS NULL',
      [req.user.id],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    await pool.query('UPDATE notifications SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL', [req.user.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    const result = await pool.query(
      'UPDATE notifications SET read_at = now() WHERE id = $1 AND recipient_id = $2 RETURNING id',
      [req.params.id, req.user.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'notification not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

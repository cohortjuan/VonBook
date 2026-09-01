import { Router } from 'express';
import { pool } from '../db/pool.js';
import { isBlockedEitherWay } from '../lib/blocks.js';
import { createNotification } from '../lib/notify.js';

export const friendsRouter = Router();

const PUBLIC_COLUMNS = 'u.id, u.username, u.display_name, u.avatar_url, u.is_founder, u.founder_title, u.now_playing';

function parseUserId(req, res) {
  const id = Number(req.params.userId);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid user id' });
    return null;
  }
  return id;
}

// GET /api/friends -- everyone you're currently friends with
friendsRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS}
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1) AND u.deleted_at IS NULL
       ORDER BY u.display_name`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/friends/requests -- pending requests sent TO you
friendsRouter.get('/requests', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT f.id AS friendship_id, f.created_at, ${PUBLIC_COLUMNS}
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/friends/requests/sent -- requests you're waiting on
friendsRouter.get('/requests/sent', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT f.id AS friendship_id, f.created_at, ${PUBLIC_COLUMNS}
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1 AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/friends/blocked -- who you've blocked (never who blocked you --
// that's not this account's business to know)
friendsRouter.get('/blocked', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS}, b.created_at AS blocked_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/friends/:userId/request
friendsRouter.post('/:userId/request', async (req, res, next) => {
  try {
    const targetId = parseUserId(req, res);
    if (targetId === null) return;
    if (targetId === req.user.id) return res.status(400).json({ error: "can't friend yourself" });
    if (await isBlockedEitherWay(req.user.id, targetId)) {
      return res.status(403).json({ error: 'not available' });
    }

    const result = await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')
       RETURNING id, status`,
      [req.user.id, targetId],
    );

    await createNotification({
      io: req.app.get('io'),
      recipientId: targetId,
      actorId: req.user.id,
      type: 'friend_request',
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'a friend request already exists between you two' });
    }
    next(err);
  }
});

// POST /api/friends/:userId/accept -- only the addressee of a pending
// request can accept it
friendsRouter.post('/:userId/accept', async (req, res, next) => {
  try {
    const requesterId = parseUserId(req, res);
    if (requesterId === null) return;

    const result = await pool.query(
      `UPDATE friendships SET status = 'accepted', responded_at = now()
       WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING id`,
      [requesterId, req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'no pending request from that user' });
    }

    await createNotification({
      io: req.app.get('io'),
      recipientId: requesterId,
      actorId: req.user.id,
      type: 'friend_accept',
    });

    res.status(200).json({ status: 'accepted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/friends/:userId/decline -- declines an incoming request, or
// cancels one you sent
friendsRouter.post('/:userId/decline', async (req, res, next) => {
  try {
    const otherId = parseUserId(req, res);
    if (otherId === null) return;

    await pool.query(
      `DELETE FROM friendships
       WHERE status = 'pending'
         AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [req.user.id, otherId],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// DELETE /api/friends/:userId -- unfriend. severs the connection: the
// friendships row is gone, so a fresh request has to be sent (and
// accepted) again from scratch to reconnect.
friendsRouter.delete('/:userId', async (req, res, next) => {
  try {
    const otherId = parseUserId(req, res);
    if (otherId === null) return;

    await pool.query(
      `DELETE FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [req.user.id, otherId],
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /api/friends/:userId/block -- severs everything: deletes any
// friendship, then records the block so future requests/messages/feed
// visibility are shut both ways (see lib/blocks.js).
friendsRouter.post('/:userId/block', async (req, res, next) => {
  try {
    const targetId = parseUserId(req, res);
    if (targetId === null) return;
    if (targetId === req.user.id) return res.status(400).json({ error: "can't block yourself" });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM friendships
         WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
        [req.user.id, targetId],
      );
      await client.query(
        `INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [req.user.id, targetId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

friendsRouter.delete('/:userId/block', async (req, res, next) => {
  try {
    const targetId = parseUserId(req, res);
    if (targetId === null) return;
    await pool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, targetId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

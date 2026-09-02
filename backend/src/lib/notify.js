import { pool } from '../db/pool.js';

// the one place that writes a notifications row. also pushes it over the
// recipient's socket room (see sockets/index.js) if they're online right
// now, so the bell icon updates live instead of waiting for a page reload.
// io is optional so this stays callable from anywhere that doesn't have it
// handy (falls back to db-only -- the recipient just sees it next fetch).
//
// the actor's public info is joined in on the way out (same columns as
// GET /api/notifications) so a live socket push has everything the
// frontend needs to name a name in a native OS notification, not just an id.
export async function createNotification({ io, recipientId, actorId = null, type, payload = null }) {
  // no point notifying yourself (liking/commenting on your own post, etc.)
  if (actorId === recipientId) return null;

  const result = await pool.query(
    `WITH inserted AS (
       INSERT INTO notifications (recipient_id, actor_id, type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING id, recipient_id, actor_id, type, payload, read_at, created_at
     )
     SELECT n.id, n.recipient_id, n.type, n.payload, n.read_at, n.created_at,
            a.id AS actor_id, a.username AS actor_username, a.display_name AS actor_display_name,
            a.avatar_url AS actor_avatar_url, a.is_founder AS actor_is_founder, a.is_dev AS actor_is_dev
     FROM inserted n
     LEFT JOIN users a ON a.id = n.actor_id`,
    [recipientId, actorId, type, payload ? JSON.stringify(payload) : null],
  );
  const notification = result.rows[0];

  if (io) {
    io.to(`user:${recipientId}`).emit('notification', notification);
  }

  return notification;
}

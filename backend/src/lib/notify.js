import { pool } from '../db/pool.js';

// the one place that writes a notifications row. also pushes it over the
// recipient's socket room (see sockets/index.js) if they're online right
// now, so the bell icon updates live instead of waiting for a page reload.
// io is optional so this stays callable from anywhere that doesn't have it
// handy (falls back to db-only -- the recipient just sees it next fetch).
export async function createNotification({ io, recipientId, actorId = null, type, payload = null }) {
  // no point notifying yourself (liking/commenting on your own post, etc.)
  if (actorId === recipientId) return null;

  const result = await pool.query(
    `INSERT INTO notifications (recipient_id, actor_id, type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id, recipient_id, actor_id, type, payload, read_at, created_at`,
    [recipientId, actorId, type, payload ? JSON.stringify(payload) : null],
  );
  const notification = result.rows[0];

  if (io) {
    io.to(`user:${recipientId}`).emit('notification', notification);
  }

  return notification;
}

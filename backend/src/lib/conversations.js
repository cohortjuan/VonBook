import { pool } from '../db/pool.js';

// finds the existing 1:1 (non-group) conversation between two users, or
// creates one. used by both routes/messages.js and sockets/index.js (calls
// need a conversation to log against too), so it lives here instead of
// being duplicated.
export async function getOrCreateDirectConversation(userIdA, userIdB) {
  const existing = await pool.query(
    `SELECT c.id
     FROM conversations c
     JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
     JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
     WHERE c.is_group = false
     LIMIT 1`,
    [userIdA, userIdB],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO conversations (is_group) VALUES (false) RETURNING id`,
    );
    const conversationId = rows[0].id;
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [conversationId, userIdA, userIdB],
    );
    await client.query('COMMIT');
    return conversationId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function isParticipant(conversationId, userId) {
  const result = await pool.query(
    `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId],
  );
  return result.rows.length > 0;
}

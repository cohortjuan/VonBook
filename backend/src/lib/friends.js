import { pool } from '../db/pool.js';

// used by the feed (posts.js), presence broadcast (sockets/index.js), and
// anywhere else that needs "everyone this user is currently friends with"
export async function getFriendIds(userId) {
  const result = await pool.query(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
     FROM friendships
     WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
    [userId],
  );
  return result.rows.map((r) => r.friend_id);
}

export async function areFriends(userIdA, userIdB) {
  const result = await pool.query(
    `SELECT 1 FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [userIdA, userIdB],
  );
  return result.rows.length > 0;
}

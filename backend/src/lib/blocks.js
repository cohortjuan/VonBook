import { pool } from '../db/pool.js';

// true if either user has blocked the other. checked before letting two
// users message each other, friend each other, or see each other's
// profile/feed/comments -- this is what "blocking severs the connection"
// actually means at the data layer (see database/schema.sql's comment on
// the blocks table).
export async function isBlockedEitherWay(userIdA, userIdB) {
  const result = await pool.query(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = $1 AND blocked_id = $2)
        OR (blocker_id = $2 AND blocked_id = $1)
     LIMIT 1`,
    [userIdA, userIdB],
  );
  return result.rows.length > 0;
}

// express middleware factory: 403s if req.user is blocked (either way)
// with the user id found at req.params[paramName]. use on any route that
// takes another user's id as a param.
export function requireNotBlocked(paramName = 'userId') {
  return async (req, res, next) => {
    try {
      const otherId = Number(req.params[paramName]);
      if (!Number.isInteger(otherId)) {
        return res.status(400).json({ error: `invalid ${paramName}` });
      }
      if (await isBlockedEitherWay(req.user.id, otherId)) {
        return res.status(403).json({ error: 'not available' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

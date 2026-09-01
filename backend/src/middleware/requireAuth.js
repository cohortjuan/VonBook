import { pool } from '../db/pool.js';
import { SESSION_COOKIE_NAME, hashToken } from '../lib/session.js';

// validates the session cookie against the sessions table (existence +
// not expired), attaches req.user and req.session, or 401s.
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'not logged in' });
    }

    const result = await pool.query(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
              u.id AS user_id, u.email, u.username, u.display_name,
              u.avatar_url, u.is_founder, u.founder_title
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND u.deleted_at IS NULL`,
      [hashToken(token)],
    );

    const row = result.rows[0];
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'session expired or invalid' });
    }

    req.user = {
      id: row.user_id,
      email: row.email,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      is_founder: row.is_founder,
      founder_title: row.founder_title,
    };
    // csrf.js reads req.session.csrfToken; must run requireAuth before it
    req.session = { id: row.session_id, csrfToken: row.csrf_token };
    next();
  } catch (err) {
    next(err);
  }
}

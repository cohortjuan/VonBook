import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { hashPassword, verifyPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } from '../lib/password.js';
import { normalizeEmail, normalizeUsername, isValidUsername } from '../lib/normalize.js';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  SESSION_TTL_MS,
  generateToken,
  hashToken,
  resolveCookieOptions,
} from '../lib/session.js';

export const authRouter = Router();

const LOCK_THRESHOLD = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

// a real bcrypt hash of a random string that was never anyone's actual
// password -- run against it on "no such account" so that path takes about
// as long as a real wrong-password check, instead of returning fast and
// leaking which emails/usernames have accounts via response timing
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8xoUpG5UJRVLuHYd8sVj9ju8YbXqZO';

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many signup attempts, please try again later' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many login attempts, please try again later' },
});

function setAuthCookies(res, { token, csrfToken }) {
  const { secure, sameSite } = resolveCookieOptions();
  res.cookie(SESSION_COOKIE_NAME, token, { httpOnly: true, secure, sameSite, path: '/', maxAge: SESSION_TTL_MS });
  res.cookie(CSRF_COOKIE_NAME, csrfToken, { httpOnly: false, secure, sameSite, path: '/', maxAge: SESSION_TTL_MS });
}

function clearAuthCookies(res) {
  const { secure, sameSite } = resolveCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/', secure, sameSite });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/', secure, sameSite });
}

async function createSessionForUser(userId, userAgent) {
  const token = generateToken();
  const csrfToken = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), csrfToken, userAgent || null, expiresAt],
  );
  return { token, csrfToken };
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    cover_url: row.cover_url,
    birthday: row.birthday,
    is_founder: row.is_founder,
    founder_title: row.founder_title,
    is_dev: row.is_dev,
    now_playing: row.now_playing,
    created_at: row.created_at,
  };
}

// POST /api/auth/signup { email, username, password, display_name, birthday?, founder_code? }
// -> 201 user, does NOT log in -- call /login afterward
authRouter.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const username = normalizeUsername(req.body.username);
    const { password, display_name, birthday, founder_code } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'a valid email is required' });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'username must be 3-20 characters: letters, numbers, underscore only' });
    }
    if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
      return res.status(400).json({ error: 'display_name is required' });
    }
    if (!isPasswordStrongEnough(password)) {
      return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const claimingFounder =
      typeof founder_code === 'string' &&
      founder_code.length > 0 &&
      process.env.FOUNDER_CLAIM_CODE &&
      founder_code === process.env.FOUNDER_CLAIM_CODE;

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (email, username, password_hash, display_name, birthday, is_founder, founder_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        email,
        username,
        passwordHash,
        display_name.trim(),
        birthday || null,
        claimingFounder,
        claimingFounder ? 'Founder & Birthday Star' : null,
      ],
    );

    res.status(201).json(publicUser(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'idx_users_one_founder') {
        return res.status(409).json({ error: 'the founder code has already been claimed' });
      }
      if (err.constraint?.includes('username')) {
        return res.status(409).json({ error: 'that username is taken' });
      }
      return res.status(409).json({ error: 'an account with that email already exists' });
    }
    next(err);
  }
});

// POST /api/auth/login { identifier, password } -- identifier is email or username
authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const identifierRaw = typeof req.body.identifier === 'string' ? req.body.identifier.trim() : '';
    const { password } = req.body;
    const reject = () => res.status(401).json({ error: 'incorrect login or password' });

    if (!identifierRaw || typeof password !== 'string') {
      return reject();
    }

    const isEmail = identifierRaw.includes('@');
    const identifier = isEmail ? normalizeEmail(identifierRaw) : normalizeUsername(identifierRaw);
    const column = isEmail ? 'email' : 'username';

    const result = await pool.query(`SELECT * FROM users WHERE ${column} = $1`, [identifier]);
    const user = result.rows[0];
    const isLocked = !!(user && user.locked_until && new Date(user.locked_until) > new Date());
    const isDeleted = !!(user && user.deleted_at);

    // always run a real bcrypt compare so a nonexistent account, a locked
    // account, and a genuinely wrong password all take about the same time
    const passwordMatches = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || isLocked || isDeleted || !passwordMatches) {
      if (user && !isLocked && !isDeleted && !passwordMatches) {
        // one atomic UPDATE so concurrent failed attempts against the same
        // account can't all read the same stale counter and under-count
        await pool.query(
          `UPDATE users
           SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0 ELSE failed_login_attempts + 1 END,
               locked_until = CASE WHEN failed_login_attempts + 1 >= $2 THEN $3 ELSE locked_until END,
               updated_at = now()
           WHERE id = $1`,
          [user.id, LOCK_THRESHOLD, new Date(Date.now() + LOCK_DURATION_MS)],
        );
      }
      return reject();
    }

    await pool.query(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
      [user.id],
    );

    const { token, csrfToken } = await createSessionForUser(user.id, req.get('user-agent'));
    setAuthCookies(res, { token, csrfToken });

    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, csrfProtection, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.session.id]);
    clearAuthCookies(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json(publicUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

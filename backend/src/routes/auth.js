import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import { hashPassword, verifyPassword, isPasswordStrongEnough, MIN_PASSWORD_LENGTH } from '../lib/password.js';
import { normalizeEmail, normalizeUsername, isValidUsername } from '../lib/normalize.js';
import { sendMail } from '../lib/mailer.js';
import { issueSocketTicket } from '../lib/socketTickets.js';
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

// same shape as loginLimiter -- requesting a reset is still "does this
// email have an account", the same enumeration/brute-force risk as login
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests, please try again later' },
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

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

// GET /api/auth/socket-ticket -- see lib/socketTickets.js for why the
// socket connection needs this instead of just using the session cookie
authRouter.get('/socket-ticket', requireAuth, (req, res) => {
  res.json({ ticket: issueSocketTicket(req.user.id) });
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json(publicUser(result.rows[0]));
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/forgot-password { email }
// -> always 200 with the same generic message, whether or not that email
// has an account -- a different response for "no such email" would let
// anyone check who's signed up just by trying addresses. If it does match
// an account, this mails a one-hour link (logged to the server console
// instead, until SMTP_HOST is actually configured -- see lib/mailer.js).
authRouter.post('/forgot-password', forgotPasswordLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const genericResponse = { message: "if that email has an account, we've sent a reset link" };
    if (!email || !email.includes('@')) return res.json(genericResponse);

    const result = await pool.query('SELECT id, display_name FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
    const user = result.rows[0];

    if (user) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, hashToken(token), expiresAt],
      );

      const frontendUrl = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
      const resetLink = `${frontendUrl}/reset-password?token=${token}`;

      // not awaited before responding -- an email provider being slow or
      // down should never delay this response (which is identical either
      // way, see genericResponse above)
      sendMail({
        to: email,
        subject: 'Reset your VonBook password',
        text: `Hey ${user.display_name},\n\nSomeone (hopefully you) asked to reset your VonBook password. This link works for 1 hour:\n\n${resetLink}\n\nIf this wasn't you, just ignore this -- your password hasn't changed.`,
      }).catch(() => {});
    }

    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password { token, password }
authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const { password } = req.body;
    if (!token) return res.status(400).json({ error: 'missing reset token' });
    if (!isPasswordStrongEnough(password)) {
      return res.status(400).json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const result = await pool.query(
      `SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1`,
      [hashToken(token)],
    );
    const resetRow = result.rows[0];
    if (!resetRow || resetRow.used_at || new Date(resetRow.expires_at) < new Date()) {
      return res.status(400).json({ error: 'that reset link is invalid or has expired -- request a new one' });
    }

    const passwordHash = await hashPassword(password);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // conditioned on used_at IS NULL, not just the earlier SELECT --
      // same "atomic claim" reasoning as the invite-code redemption
      // pattern in Whispers App: two requests racing to use the same
      // token could otherwise both pass the check above and both succeed
      const claimed = await client.query(
        `UPDATE password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id`,
        [resetRow.id],
      );
      if (claimed.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'that reset link is invalid or has expired -- request a new one' });
      }

      await client.query(
        `UPDATE users SET password_hash = $2, failed_login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
        [resetRow.user_id, passwordHash],
      );
      // a password reset revokes every existing session -- if the account
      // was compromised, this is what actually locks the old owner out
      await client.query('DELETE FROM sessions WHERE user_id = $1', [resetRow.user_id]);

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

import crypto from 'crypto';

// httpOnly session cookie -- client-side js literally cannot read this one
export const SESSION_COOKIE_NAME = 'vonbook_session';

// NOT httpOnly -- frontend js reads this cookie's value and echoes it back
// in the X-CSRF-Token request header on every state-changing request. this
// is the "double-submit" half of csrf protection; middleware/csrf.js checks
// header === cookie === the value stored on the session row in the db.
export const CSRF_COOKIE_NAME = 'vonbook_csrf';

export const CSRF_HEADER_NAME = 'X-CSRF-Token';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days -- this is a kid's social app, not a bank

// raw token: this is what goes in the cookie and what the client holds.
// never stored server-side in this form.
export function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// what actually gets stored in the sessions table -- same principle as
// hashing a password, a copy of the database alone shouldn't be enough to
// forge a valid session
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// explicit env override, else guess from NODE_ENV, so local dev (plain
// http, can't set Secure at all) and a real deploy both just work.
//
// SameSite=Lax, same as Whispers App: the frontend's vercel.json proxies
// /api/* and /uploads/* to this backend, so from the browser's point of
// view every REST call is same-origin -- it never talks to the Render
// domain directly. (An earlier version of this had the frontend calling
// Render directly and set SameSite=None here to compensate -- that
// doesn't actually work: modern browsers block cross-site cookies as
// "third party" regardless of SameSite=None, so login would appear to
// succeed but every subsequent request silently wouldn't carry the
// cookie. Same-origin via the proxy is what actually fixes it, not a
// cookie attribute.) The one thing that's still genuinely cross-site is
// the Socket.IO connection (can't be proxied the same way) -- that
// authenticates with a short-lived ticket instead of this cookie, see
// lib/socketTickets.js.
export function resolveCookieOptions() {
  const secureProd =
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');

  return { secure: secureProd, sameSite: 'lax' };
}
